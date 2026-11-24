// A WGSL lint for the constructs iPhone Safari's WebGPU rejects or mis-handles (the phone pass, 2026-11-13). Pure: it
// reads a module's text and returns its hits; v2/tests/pages/safariWgsl.page.mjs runs it over every module a live page
// builds (device.js keeps their text: gpu.modules), and v2/tests/wgsl-lint.test.mjs holds the rules to samples.
// Not a runtime rewrite: v2's own shaders are fixed at the source.
//
// The rules, each from a public source (read 2026-11-13):
//   smoothstep-reversed  smoothstep(low, high, x) with low >= high, both known numbers. The WGSL group resolved it a
//                        module-creation error for const-expressions (gpuweb/gpuweb#4561, minutes 2024-04-30:
//                        https://github.com/gpuweb/gpuweb/wiki/WGSL-2024%E2%80%9004%E2%80%9030-Minutes); Chrome's Tint later
//                        relaxed it to low == high only (Dawn fedd80c, 2024-12-11:
//                        https://dawn.googlesource.com/dawn/+/fedd80c74b5e614196c95843923db2a11ea49a03), so Chrome passes a
//                        module Safari refuses whole: Cold Smoke's iPhone black screen (b735e8c, its fixSmoothstep, MIT).
//                        With `let` edges it is not a const-expression, but the GPU languages leave reversed edges
//                        undefined (GLSL ES: https://registry.khronos.org/OpenGL-Refpages/es3/html/smoothstep.xhtml), so
//                        Metal may mis-handle it: flagged too (kind 'let').
//   smoothstep-equal     low == high: an error on every browser for const-expressions (the same sources).
//   clamp-reversed       clamp(x, low, high) with low > high, both const: a shader-creation error (WGSL § 17.5.10,
//                        https://www.w3.org/TR/WGSL/#clamp-builtin).
//   f16-without-enable   an `h` literal or the f16 type without `enable f16;` (WGSL § 3.5.2 Numeric Literals); iPhones
//                        may not offer shader-f16, and v2 never asks for it.
//   f32-overflow         a float literal past f32's 3.40282347e38 (WGSL § 3.5.2: a shader-creation error).
//   lintWgsl(code, label) → [{ rule, label, line, kind, text, detail }]

const F32_MAX = 3.40282347e38;

// --- a tiny constant folder: numbers, + - * / unary minus, parentheses, f32()/abs/min/max/sqrt/pow and scalar vecN(x) ---
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const m = /^(?:0[xX][0-9a-fA-F.]+(?:[pP][+-]?\d+)?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)[fhiu]?/.exec(s.slice(i));
    if (m && /[\d.]/.test(c)) { out.push({ t: 'n', v: m[0] }); i += m[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  return out;
}
const numOf = (lit) => { const s = lit.replace(/[fhiu]$/, ''); return /^0[xX]/.test(s) && !/[.pP]/.test(s) ? parseInt(s, 16) : parseFloat(s); };
const FN = { f32: (a) => a, f16: (a) => a, abs: Math.abs, min: Math.min, max: Math.max, sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log, radians: (a) => a * Math.PI / 180 };

// fold(expr, env) → { v: number, kind: 'const' | 'let' } or null when it is not a known number
export function fold(expr, env = new Map()) {
  const tk = tokenize(expr); let p = 0, kind = 'const';
  const peek = () => tk[p], eat = (v) => { if (tk[p] && tk[p].v === v) { p++; return true; } return false; };
  function prim() {
    const t = tk[p++];
    if (!t) throw 0;
    if (t.t === 'n') return numOf(t.v);
    if (t.v === '(') { const v = add(); if (!eat(')')) throw 0; return v; }
    if (t.v === '-') return -prim();
    if (t.v === '+') return prim();
    if (t.t === 'id') {
      if (eat('(')) {
        const args = [];
        if (!eat(')')) { do args.push(add()); while (eat(',')); if (!eat(')')) throw 0; }
        if (/^vec[234][fhiu]?$/.test(t.v) && args.length === 1) return args[0];   // a splat: the scalar compares the same
        const f = FN[t.v]; if (!f) throw 0;
        return f(...args);
      }
      if (eat('<')) throw 0;   // a templated type: not folded
      const e = env.get(t.v); if (!e) throw 0;
      if (e.kind === 'let') kind = 'let';
      return e.v;
    }
    throw 0;
  }
  function mul() { let v = prim(); for (;;) { if (eat('*')) v *= prim(); else if (eat('/')) v /= prim(); else return v; } }
  function add() { let v = mul(); for (;;) { if (eat('+')) v += mul(); else if (eat('-')) v -= mul(); else return v; } }
  try { const v = add(); if (p !== tk.length || !Number.isFinite(v)) return null; void peek; return { v, kind }; } catch { return null; }
}

// the top-level arguments of a call whose '(' is at `open`; null when unbalanced
export function callArgs(code, open) {
  const args = []; let depth = 0, start = open + 1;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (depth === 0) { args.push(code.slice(start, i)); return { args, end: i + 1 }; } }
    else if (c === ',' && depth === 1) { args.push(code.slice(start, i)); start = i + 1; }
  }
  return null;
}

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

// the names a module declares with a known number: `const X = …;`, `let X = …;` (scalars only), in order (a later
// declaration of the same name replaces it: a shadowing let in another function is the usual case, so a reused name
// whose values differ is dropped as unknown)
function constants(code) {
  const env = new Map(), seen = new Map();
  const re = /\b(const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*[A-Za-z0-9_<>]+\s*)?=\s*([^;]+);/g;
  let m;
  while ((m = re.exec(code))) {
    const [, decl, name, expr] = m;
    const r = fold(expr, env);
    if (!r) { if (env.has(name)) env.delete(name); seen.set(name, 'unknown'); continue; }
    const kind = decl === 'const' && r.kind === 'const' ? 'const' : 'let';
    if (seen.has(name) && (seen.get(name) === 'unknown' || seen.get(name) !== r.v)) { env.delete(name); seen.set(name, 'unknown'); continue; }
    seen.set(name, r.v); env.set(name, { v: r.v, kind });
  }
  return env;
}

const lineAt = (code, i) => code.slice(0, i).split('\n').length;

export function lintWgsl(code, label = '') {
  const hits = [], src = stripComments(String(code ?? ''));
  const env = constants(src);
  const lines = String(code ?? '').split('\n');
  const push = (rule, i, kind, detail) => { const line = lineAt(src, i); hits.push({ rule, label, line, kind, text: (lines[line - 1] ?? '').trim().slice(0, 160), detail }); };
  for (const [name, test] of [['smoothstep', null], ['clamp', null]]) {
    void test;
    const re = new RegExp(`\\b${name}\\s*\\(`, 'g'); let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length - 1, c = callArgs(src, open);
      if (!c || c.args.length !== 3) continue;
      if (name === 'smoothstep') {
        const lo = fold(c.args[0], env), hi = fold(c.args[1], env);
        if (!lo || !hi) continue;
        const kind = lo.kind === 'const' && hi.kind === 'const' ? 'const' : 'let';
        if (lo.v > hi.v) push('smoothstep-reversed', m.index, kind, `low ${lo.v} > high ${hi.v}: write 1.0 - smoothstep(${c.args[1].trim()}, ${c.args[0].trim()}, …)`);
        else if (lo.v === hi.v) push('smoothstep-equal', m.index, kind, `low == high == ${lo.v}`);
      } else {
        const lo = fold(c.args[1], env), hi = fold(c.args[2], env);
        if (lo && hi && lo.kind === 'const' && hi.kind === 'const' && lo.v > hi.v) push('clamp-reversed', m.index, 'const', `low ${lo.v} > high ${hi.v}`);
      }
    }
  }
  if (!/\benable\s+f16\s*;/.test(src)) {
    const re = /(?<![A-Za-z0-9_.])(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?h\b|\bf16\b|vec[234]h\b|mat[234]x[234]h\b/g; let m;
    while ((m = re.exec(src))) push('f16-without-enable', m.index, 'const', `'${m[0]}' needs enable f16 (and the shader-f16 feature)`);
  }
  {
    const re = /(?<![A-Za-z0-9_.])(?:\d+\.\d*|\.\d+|\d+)[eE][+-]?\d+f?\b/g; let m;
    while ((m = re.exec(src))) { const v = parseFloat(m[0]); if (!Number.isFinite(v) || Math.abs(v) > F32_MAX) push('f32-overflow', m.index, 'const', `${m[0]} is past f32's range`); }
  }
  return hits.sort((a, b) => a.line - b.line);
}

// every module of a page: [{ label, code }] → hits across them
export function lintModules(mods) {
  const out = [];
  for (const { label, code } of mods) out.push(...lintWgsl(code, label));
  return out;
}
