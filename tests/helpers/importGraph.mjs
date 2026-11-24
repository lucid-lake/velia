// The import graph of src/ (static imports, re-exports and literal dynamic imports), parsed with Vite's own parser.
// Used by tests/simPure.test.mjs: nothing under src/sim/ may reach three or the sky library.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'vite';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A bare specifier the shared sim must never reach: three (any subpath) and @takram/* (built on three).
export const FORBIDDEN = (spec) => spec === 'three' || spec.startsWith('three/') || spec.startsWith('@takram/');

function walk(node, out) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'ImportExpression' && node.source?.type === 'Literal' && typeof node.source.value === 'string') out.push(node.source.value);
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) { if (c && typeof c === 'object') walk(c, out); }
    else if (v && typeof v === 'object' && k !== 'source') walk(v, out);
  }
}

// Every specifier one file names: import/export … from, bare import, and import('literal').
export function specifiers(file) {
  const ast = parseAst(readFileSync(file, 'utf8'));
  const out = [];
  for (const n of ast.body) {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) out.push(n.source.value);
  }
  walk(ast, out);
  return out;
}

function resolveRel(from, spec) {
  const p = resolve(dirname(from), spec.split('?')[0]);
  if (existsSync(p) && statSync(p).isFile()) return p;
  for (const ext of ['.js', '.mjs', '/index.js']) if (existsSync(p + ext)) return p + ext;
  return null;
}

// Walk from `entries` (absolute paths). Returns { forbidden: [{ spec, chain }], missing: [{ spec, from }] }.
// `chain` is the import path from the entry to the module that names the forbidden specifier.
export function reach(entries) {
  const seen = new Map();   // file -> parent file (null for an entry)
  const queue = [];
  for (const e of entries) if (!seen.has(e)) { seen.set(e, null); queue.push(e); }
  const forbidden = [], missing = [];
  const chainOf = (f) => { const c = []; for (let x = f; x; x = seen.get(x)) c.unshift(relative(ROOT, x)); return c; };
  while (queue.length) {
    const f = queue.shift();
    if (!/\.(m?js)$/.test(f)) continue;   // JSON, CSS, workers' ?url assets: data, no imports
    for (const s of specifiers(f)) {
      if (s.startsWith('.') || s.startsWith('/')) {
        const t = resolveRel(f, s);
        if (!t) { missing.push({ spec: s, from: relative(ROOT, f) }); continue; }
        if (!seen.has(t)) { seen.set(t, f); queue.push(t); }
      } else if (FORBIDDEN(s)) forbidden.push({ spec: s, chain: chainOf(f) });
    }
  }
  return { forbidden, missing, files: [...seen.keys()] };
}

export function listJs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listJs(p));
    else if (/\.m?js$/.test(n)) out.push(p);
  }
  return out.sort();
}
