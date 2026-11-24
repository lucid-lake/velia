// The import directions in v2 (refactor round 3, Phase C step 6; v2/README.md § Import directions): a lint over every
// v2/**/*.js (tests and the Vite config excepted), static and dynamic imports, comments stripped. It fails on an import
// against the layering below, naming each edge. The layers, lowest first:
//   sim      pure state and maths (no GPU, no DOM but the OS's reduce-motion read): may import sim/, terrain/ (the height and
//            channel data) and src/; nothing else in v2 (not render/, ui/, engine/, audio/, living/, the modes)
//   terrain, forest, towns   the world's data and its builders: not ui/, the modes, living/, (root)
//   render   GPU drawing: reads sim/; not ui/, audio/, the modes (regatta/, cruise/), stage/, photo/, (root)
//   audio    Web Audio: reads sim/; not render/, ui/, the modes, (root)
//   ui       DOM: reads sim/, render/, engine/, audio/; not the modes (regatta/, cruise/) nor (root)
//   engine   the page's frame, flags, quality, the mode table: not ui/, render/, (root)
//   living, stage, photo, regatta, cruise   features and modes that compose the layers: not (root)
//   (root)   main.js, start.js: the boot; nobody imports it
// Cycles: no two v2 modules may reach each other through imports (any length; v2 files only, src/ is v1's and outside).
// ALLOWED names the few edges the rules would flag that are deliberate, each with its reason. A new entry needs one too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = join(ROOT, 'v2');
const MODES = ['regatta', 'cruise'];
export const FORBID = Object.freeze({
  sim: (to) => to !== 'sim' && to !== 'terrain' && to !== 'src',
  terrain: (to) => ['ui', 'living', 'stage', 'photo', '(root)', ...MODES].includes(to),
  forest: (to) => ['ui', 'living', 'stage', 'photo', '(root)', ...MODES].includes(to),
  towns: (to) => ['ui', 'living', 'stage', 'photo', '(root)', ...MODES].includes(to),
  render: (to) => ['ui', 'audio', 'stage', 'photo', '(root)', ...MODES].includes(to),
  audio: (to) => ['render', 'ui', '(root)', ...MODES].includes(to),
  ui: (to) => ['(root)', ...MODES].includes(to),
  engine: (to) => ['ui', 'render', '(root)'].includes(to),
  living: (to) => to === '(root)', stage: (to) => to === '(root)', photo: (to) => to === '(root)',
  regatta: (to) => to === '(root)', cruise: (to) => to === '(root)', assets: (to) => to === '(root)',
});
export const ALLOWED = Object.freeze({
  'sim/knockdownGame.js -> engine/modes.js': 'the mode table (pure rows: each mode\'s knockdown end); engine/modes.js reads only the modes\' plan.js data',
  'sim/tessieSwap.js -> engine/modes.js': 'the mode table (which modes are races)',
  'ui/planChart.js -> cruise/chartRows.js': 'the chart\'s world rows (data, dynamic import), kept with Cruise\'s chart',
  'ui/planChart.js -> cruise/chartWorld.json': 'the same rows\' data file',
});

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (['golden', 'node_modules', 'tests'].includes(f) ? [] : walk(p)) : [p]; });
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const IMPORT = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w*\s{},$]*?\s*from\s*)?['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const layer = (f) => { const r = relative(ROOT, f).split('/'); return r[0] !== 'v2' ? r[0] : r.length > 2 ? r[1] : '(root)'; };

// every v2 module's relative imports: [{ from, to }] as v2-relative paths (src/ files as ../src/…)
export function v2Edges() {
  const out = [];
  for (const f of walk(V2).filter((p) => p.endsWith('.js') && !p.endsWith('vite.config.js'))) {
    for (const m of strip(readFileSync(f, 'utf8')).matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec || !spec.startsWith('.')) continue;
      out.push({ from: f, to: resolve(dirname(f), spec.split('?')[0]) });
    }
  }
  return out;
}
const name = (f) => relative(V2, f);

export function backEdges(edges = v2Edges()) {
  return edges.filter(({ from, to }) => { const a = layer(from), b = layer(to); return a !== b && FORBID[a]?.(b) && !ALLOWED[`${name(from)} -> ${name(to)}`]; })
    .map(({ from, to }) => `${name(from)} -> ${name(to)}`);
}

test('import directions: no v2 module imports against the layering (sim pure; render, audio below ui; ui below the modes)', () => {
  const bad = backEdges();
  assert.deepEqual(bad, [], `${bad.length} back-edge(s):\n  ${bad.join('\n  ')}`);
});

test('the lint fails on a back-edge (a made-up sim → render import is caught)', () => {
  const fake = [{ from: join(V2, 'sim/x.js'), to: join(V2, 'render/y.js') }, { from: join(V2, 'render/y.js'), to: join(V2, 'sim/x.js') }];
  assert.deepEqual(backEdges(fake), ['sim/x.js -> render/y.js']);
});

test('every allowed edge still exists (a stale entry is removed)', () => {
  const have = new Set(v2Edges().map(({ from, to }) => `${name(from)} -> ${name(to)}`));
  for (const k of Object.keys(ALLOWED)) assert.ok(have.has(k), `ALLOWED '${k}' is no longer an import: remove it`);
  for (const k of Object.keys(ALLOWED)) assert.ok(existsSync(join(V2, k.split(' -> ')[0])), k);
});

// every import cycle among v2's own modules (Tarjan's strongly connected components of more than one file, or a self-import)
export function cycles(edges = v2Edges()) {
  const inV2 = (f) => !relative(V2, f).startsWith('..');
  const adj = new Map();
  for (const { from, to } of edges) if (inV2(to)) { if (!adj.has(from)) adj.set(from, new Set()); adj.get(from).add(to); }
  let i = 0; const idx = new Map(), low = new Map(), stack = [], on = new Set(), out = [];
  const visit = (v) => {
    idx.set(v, i); low.set(v, i); i++; stack.push(v); on.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const c = []; let w; do { w = stack.pop(); on.delete(w); c.push(w); } while (w !== v);
      if (c.length > 1 || adj.get(v)?.has(v)) out.push(c.map(name).sort());
    }
  };
  for (const v of adj.keys()) if (!idx.has(v)) visit(v);
  return out;
}

test('no import cycle among v2\'s modules', () => {
  const c = cycles();
  assert.deepEqual(c, [], `${c.length} cycle(s):\n  ${c.map((x) => x.join(' <-> ')).join('\n  ')}`);
});

test('the cycle check fails on a cycle (a made-up a → b → a is caught)', () => {
  const a = join(V2, 'sim/a.js'), b = join(V2, 'sim/b.js');
  assert.deepEqual(cycles([{ from: a, to: b }, { from: b, to: a }]), [['sim/a.js', 'sim/b.js']]);
});

// classic/ is v1's private code (refactor round 3 C7b): nothing v2 runs and no shared
// src/ module may import from it (static, dynamic or new URL(…, import.meta.url)). The exceptions are the v2 tests that
// compare v2's copy against v1's original on purpose (parity tests, or v1's lake-wide ground as the reference); a new one
// needs a line here.
export const CLASSIC_PARITY = Object.freeze([
  'v2/tests/birds.test.mjs', 'v2/tests/captain.test.mjs', 'v2/tests/cockpit-rig.test.mjs', 'v2/tests/day-clock.test.mjs',
  'v2/tests/frame-look.test.mjs', 'v2/tests/front-door.test.mjs', 'v2/tests/plan.test.mjs', 'v2/tests/sea-parity.test.mjs',
  'v2/tests/shuffle.test.mjs', 'v2/tests/storm.test.mjs', 'v2/tests/terrain-shadow.test.mjs', 'v2/tests/vhf-set.test.mjs',
  'v2/tests/world-audit.test.mjs',
]);
const walkAll = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (['node_modules', 'golden'].includes(f) ? [] : walkAll(p)) : [p]; });
const URL_RE = /new URL\(\s*['"`]([^'"`$]+)['"`]\s*,\s*import\.meta\.url/g;
// the classic/ targets of one file's imports: ['<file> -> classic/…']
export function classicEdges(file, text = readFileSync(file, 'utf8')) {
  const s = strip(text);
  const specs = [...s.matchAll(IMPORT)].map((m) => m[1] ?? m[2]).concat([...s.matchAll(URL_RE)].map((m) => m[1]));
  const out = [];
  for (const spec of specs) {
    if (!spec || !(spec.startsWith('.') || spec.startsWith('/'))) continue;
    const to = spec.startsWith('/') ? join(ROOT, spec.split('?')[0]) : resolve(dirname(file), spec.split('?')[0]);
    if (relative(ROOT, to).split('/')[0] === 'classic') out.push(`${relative(ROOT, file)} -> ${relative(ROOT, to)}`);
  }
  return out;
}
const SELF = fileURLToPath(import.meta.url);   // its own guard test names classic/ paths in a string
const v2AndShared = () => [...walkAll(V2), ...walkAll(join(ROOT, 'src'))].filter((p) => /\.m?js$/.test(p) && p !== SELF);

test('classic/ is v1\'s alone: no v2 file and no shared src/ file imports from it (but the named parity tests)', () => {
  const bad = v2AndShared().flatMap((f) => classicEdges(f)).filter((e) => !CLASSIC_PARITY.includes(e.split(' -> ')[0]));
  assert.deepEqual(bad, [], `${bad.length} import(s) of classic/:\n  ${bad.join('\n  ')}`);
});

test('the classic guard fails on an import of classic/, and every parity test still imports it', () => {
  const fake = "import { x } from '../../classic/src/main.js';\nconst m = await import('/classic/src/core/sky.js');\nconst u = new URL('../../classic/src/core/stbn.bin', import.meta.url);\n";
  assert.equal(classicEdges(join(V2, 'tests', 'fake.test.mjs'), fake).length, 3);
  assert.equal(classicEdges(join(ROOT, 'src', 'fake.js'), "import { y } from '../classic/src/water.js';").length, 1);
  for (const p of CLASSIC_PARITY) assert.ok(classicEdges(join(ROOT, p)).length > 0, `CLASSIC_PARITY '${p}' no longer imports classic/: remove it`);
});
