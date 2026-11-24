// The terrain's data path (M2): v2's decoder gives v1's arrays byte for byte; the stream plan's first stage stays under
// 1.5 MB and still covers the camera's whole view; every grid is fetched once; the per-cell bounds hold every height
// the sampler can return in their cell; the CPU twin of the WGSL height function is v1's heightAt (full set and phone
// set) at thousands of points, the level blend bands included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflate, unpredict, cellBounds } from '../terrain/decode.js';
import { streamPlan, shippedFiles, SLOTS, COVER_SLOTS, pickVariant } from '../terrain/levels.js';
import { createHeightField } from '../terrain/sample.js';
import { TREE } from '../terrain/quadtree.js';
import { loadTerrain, makeSampler } from '../../src/sim/terrain-data.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (f) => resolve(ROOT, 'terrain', f);
const full = JSON.parse(readFileSync(T('tahoe.json'), 'utf8')), phone = JSON.parse(readFileSync(T('tahoe-phone.json'), 'utf8'));
const decode = async (g) => { const p = await inflate(readFileSync(T(g.file))); return g.kind === 'h' ? unpredict(p, g.w, g.h) : p.slice(0, g.w * g.h); };
const v1full = loadTerrain('full');   // v1's own loader (node: the file system), decoded once for every test here

// a seeded set of points: log-distributed out to 48 km, plus every level's edges and blend bands
function points(n = 4000) {
  let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  const out = [];
  for (let i = 0; i < n; i++) { const r = 5 * Math.exp(rnd() * Math.log(48000 / 5)), a = rnd() * 2 * Math.PI; out.push([r * Math.cos(a), r * Math.sin(a)]); }
  for (const L of [...full.levels, ...phone.levels]) for (let k = 0; k <= 20; k++) {
    const x1 = L.x0 + (L.w - 1) * L.step, z1 = L.z0 + (L.h - 1) * L.step;
    out.push([L.x0 + k * L.step * 0.7, (L.z0 + z1) / 2], [x1 - k * L.step * 0.7, (L.z0 + z1) / 2], [(L.x0 + x1) / 2, L.z0 + k * L.step * 0.7], [(L.x0 + x1) / 2, z1 - k * L.step * 0.7]);
  }
  return out;
}

test('the decoder gives v1\'s arrays exactly (heights and cover, both sets)', async () => {
  const D = await v1full;
  const byName = Object.fromEntries(D.levels.map((L) => [L.name, L]));
  for (const g of streamPlan(full, phone, 'full').flat()) {
    const mine = await decode(g);
    if (g.variant === 'full' || (g.kind === 'h' && g.slot === 'island')) assert.deepEqual(mine, byName[g.slot].H, `${g.file}`);
    if (g.kind === 'c') assert.deepEqual(new Uint8Array(mine), new Uint8Array(byName[g.slot].C), `${g.file}`);
    assert.equal(mine.length, g.w * g.h, `${g.file}: ${g.w}×${g.h}`);
  }
});

test('the stream plan: stage 0 ≤ 1.5 MB with every slot but the basin; each grid once; phone stops after the basin', () => {
  const plan = streamPlan(full, phone, 'full');
  assert.equal(plan.length, 3);
  const bytes = (st) => st.reduce((a, g) => a + statSync(T(g.file)).size, 0) + statSync(T('tahoe.json')).size + statSync(T('tahoe-phone.json')).size;
  const first = bytes(plan[0]);
  assert.ok(first <= 1.5e6, `first load ${first} bytes`);
  const s0 = new Set(plan[0].filter((g) => g.kind === 'h').map((g) => g.slot));
  for (const s of SLOTS) if (s !== 'basin') assert.ok(s0.has(s), `${s} in stage 0`);
  const files = plan.flat().map((g) => g.file);
  assert.equal(new Set(files).size, files.length, 'no grid twice');
  for (const s of COVER_SLOTS) assert.ok(files.includes(full.levels.find((L) => L.name === s).cover));
  // the full grids are finer than the phone ones they replace
  for (const g of plan[2]) { const p = plan.flat().find((q) => q.slot === g.slot && q.variant === 'phone'); assert.ok(g.step < p.step, `${g.slot}: ${g.step} < ${p.step}`); }
  const ph = streamPlan(full, phone, 'phone');
  assert.equal(ph.length, 2);
  assert.ok(ph.flat().every((g) => g.variant !== 'full'));
  // what a build ships: both sets' heights and the cover grids, never the shore distance
  const ship = shippedFiles(full, phone);
  assert.ok(ship.every((f) => !/-d\.lsh$/.test(f)));
  assert.ok(files.every((f) => ship.includes(f)));
  assert.equal(pickVariant({ terrain: 'phone' }), 'phone'); assert.equal(pickVariant({ headless: '1' }), 'full');
});

test('per-cell bounds hold every height the sampler returns in the cell (the frustum and LOD boxes)', async () => {
  const D = await v1full, S = makeSampler(D);
  const cells = { ox: TREE.origin, oz: TREE.origin, cell: TREE.cell };
  const grid = new Map();
  for (const L of D.levels) {
    const b = cellBounds(L.H, L, full.height, cells);
    for (let j = 0; j < b.ch; j++) for (let i = 0; i < b.cw; i++) {
      const k = `${b.cx0 + i},${b.cz0 + j}`, lo = b.mm[2 * (j * b.cw + i)], hi = b.mm[2 * (j * b.cw + i) + 1];
      const g = grid.get(k) ?? [Infinity, -Infinity]; grid.set(k, [Math.min(g[0], lo), Math.max(g[1], hi)]);
    }
  }
  let checked = 0;
  for (const [x, z] of points(3000)) {
    const cx = Math.floor((x - cells.ox) / cells.cell), cz = Math.floor((z - cells.oz) / cells.cell);
    let lo = Infinity, hi = -Infinity;   // the dilated cell: its 8 neighbours too (quadtree.js createBounds)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const g = grid.get(`${cx + dx},${cz + dz}`); if (g) { lo = Math.min(lo, g[0]); hi = Math.max(hi, g[1]); } }
    if (!(lo <= hi)) continue;
    const h = S.height(x, z);
    assert.ok(h >= lo - 1e-3 && h <= hi + 1e-3, `(${x.toFixed(1)}, ${z.toFixed(1)}): ${h} outside [${lo}, ${hi}]`);
    checked++;
  }
  assert.ok(checked > 2500, `${checked} points checked`);
});

test('the height twin (the WGSL\'s mirror) is v1\'s heightAt: the full set, every grid in', async () => {
  const D = await v1full, S = makeSampler(D);
  const F = createHeightField(full.height);
  const plan = streamPlan(full, phone, 'full').flat();
  for (const g of plan.filter((q) => q.kind === 'h' && q.variant === 'phone')) F.setSlot(SLOTS.indexOf(g.slot), g, await decode(g));
  for (const g of plan.filter((q) => q.kind === 'h' && q.variant === 'full')) F.setSlot(SLOTS.indexOf(g.slot), g, await decode(g));
  let max = 0;
  for (const [x, z] of points()) max = Math.max(max, Math.abs(F.height(x, z) - S.height(x, z)));
  assert.ok(max < 1e-6, `max |v2 − v1| = ${max} m`);
  for (const [x, z] of [[0, 0], [800, -560], [-600, 250]]) assert.equal(F.spacing(x, z), S.spacing(x, z));
  // and through v1's public query itself (src/sim/terrain.js heightAt: the boat, the marks and the cameras use it)
  const { heightAt } = await import('../../src/sim/terrain.js');
  for (const [x, z] of points(800)) assert.ok(Math.abs(F.height(x, z) - heightAt(x, z)) < 1e-6, `(${x}, ${z})`);
});

test('the phone set (stages 0 and 1) is v1\'s phone sampler; stage 0 alone answers everywhere', async () => {
  const D = await loadTerrain('phone'), S = makeSampler(D);
  const F = createHeightField(full.height);
  const [s0, s1] = streamPlan(full, phone, 'phone');
  for (const g of s0.filter((q) => q.kind === 'h')) F.setSlot(SLOTS.indexOf(g.slot), g, await decode(g));
  for (const [x, z] of points(500)) assert.ok(Number.isFinite(F.height(x, z)), 'stage 0 answers everywhere');
  for (const g of s1.filter((q) => q.kind === 'h')) F.setSlot(SLOTS.indexOf(g.slot), g, await decode(g));
  let max = 0;
  for (const [x, z] of points()) max = Math.max(max, Math.abs(F.height(x, z) - S.height(x, z)));
  assert.ok(max < 1e-6, `max |v2 − v1 phone| = ${max} m`);
});
