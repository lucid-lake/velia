// The guard: nothing under v2/ reaches three.js (or the sky library built on it), directly or through any chain of
// static or dynamic imports into src/. It walks the import graph from v2/index.html's scripts and every v2/**/*.js,
// following relative specifiers into files, and fails on a bare specifier 'three', 'three/*' or '@takram/*'. Any other
// bare specifier is listed too (v2 has no runtime dependencies at all in M0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const V2 = join(ROOT, 'v2');
const BANNED = /^(three(\/|$)|@takram\/)/;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === 'golden' || f === 'node_modules' ? [] : walk(p)) : [p]; });
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const IMPORT = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w*\s{},$]*?\s*from\s*)?['"]([^'"]+)['"]|(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function importGraph(entries) {
  const seen = new Map(), bare = [];
  const visit = (file, from) => {
    if (seen.has(file)) return;
    seen.set(file, from);
    if (!existsSync(file) || !/\.(m?js|json)$/.test(file)) return;
    if (file.endsWith('.json')) return;
    const src = strip(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      if (spec.startsWith('.') || spec.startsWith('/')) visit(resolve(dirname(file), spec.split('?')[0]), file);
      else bare.push([spec, file]);
    }
  };
  for (const e of entries) visit(e, null);
  return { files: seen, bare };
}

const entries = () => {
  const html = readFileSync(join(V2, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => resolve(V2, m[1]));
  return [...scripts, ...walk(V2).filter((p) => p.endsWith('.js') && !p.includes('/tests/') && !p.endsWith('vite.config.js'))];   // the Vite config is node, not the page
};

test('v2 never reaches three.js: no banned bare import anywhere in its import graph', () => {
  const { files, bare } = importGraph(entries());
  const banned = bare.filter(([s]) => BANNED.test(s)).map(([s, f]) => `${f.slice(ROOT.length + 1)} → ${s}`);
  assert.deepEqual(banned, [], 'three.js is reachable from v2/');
  const chain = [...files.keys()].filter((f) => f.includes('/src/')).map((f) => f.slice(ROOT.length + 1));
  for (const f of chain) assert.ok(!/three/i.test(strip(readFileSync(f, 'utf8')).match(/from\s*['"]([^'"]+)['"]/g)?.join(' ') ?? ''), `${f} imports three`);
});

test('v2 has no bare runtime imports at all (M0: zero dependencies in the bundle)', () => {
  const { bare } = importGraph(entries());
  assert.deepEqual(bare.map(([s, f]) => `${f.slice(ROOT.length + 1)} → ${s}`), []);
});

test('the shared src/ modules v2 reaches are three-free and none is v1\'s private code (classic/)', () => {
  const { files } = importGraph(entries());
  const shared = [...files.keys()].filter((f) => f.includes('/src/')).map((f) => f.slice(ROOT.length + 1));
  assert.ok(shared.length > 100, `${shared.length} shared files walked`);
  assert.deepEqual(shared.filter((f) => f.startsWith('classic/')), [], 'v2 reaches classic/');
  // the three-free proof is the first test (the whole graph); this list used to hand-name every shared file (110 lines, edited whenever v2 reached a module)
});

test('the guard itself catches a banned import', () => {
  // a fixture in memory: the walker is exercised on this test file's own text through a temp entry would write outside
  // the test; instead check the regexes directly
  assert.ok(BANNED.test('three'), 'three');
  assert.ok(BANNED.test('three/webgpu'), 'three/webgpu');
  assert.ok(BANNED.test('@takram/three-atmosphere'), '@takram');
  assert.ok(!BANNED.test('threefold'), 'a word that starts with three is not three');
  const src = `import * as THREE from 'three/webgpu';\nconst x = await import('three/tsl');\nimport a from './a.js';`;
  const specs = [...strip(src).matchAll(IMPORT)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(specs, ['three/webgpu', 'three/tsl', './a.js']);
});

test('M3b: the GLB reader, the model builder, its worker and the GPU side are walked, and none reaches three', () => {
  const { files, bare } = importGraph(entries());
  for (const f of ['v2/engine/gltf.js', 'v2/render/boat/models.js', 'v2/render/boat/worker.js', 'v2/render/boatModels.js']) assert.ok(files.has(join(ROOT, f)), `${f} in the graph`);
  assert.deepEqual(bare.filter(([s]) => BANNED.test(s)), []);
  // the packer is node-only (zlib) and never in the page's graph
  assert.ok(![...files.keys()].some((f) => f.endsWith('tools/build/glb-pack.mjs')), 'the packer stays out of the page');
});
