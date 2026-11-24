// T3: the far forest's canopy grid (v2/forest/canopy.js: the JS twin of the GPU's splat and resolves) over
// the real forest: its cover stands only where trees stand (none on the lake, on snow or on the cliffs the rules leave
// bare), follows the trees' own density, conserves the crowns' area; the hand-off: the cards' share and the canopy's
// sum to 1 at every distance (no gap, no double band) and are continuous; the cards end at the new far range and their
// count past 3.5 km drops; deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve as rp, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { CANOPY, gridOf, splatTree, resolve, unpackWord, canopyShare } from '../forest/canopy.js';
import { FOREST, REGION, keepAt, coverNear } from '../forest/lod.js';
import { decodeForest, unpackBits } from '../forest/format.js';
import { scatterSlot } from '../forest/scatter.js';
import { makeSampler, loadTerrain } from '../../src/sim/terrain-data.js';   // the cover grids: v2 has no CPU cover twin (the GPU samples them); C7b list
import { ground } from './helpers/ground.mjs';   // v2's own height field
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { pickDay } from '../../src/sim/day.js';
import { TAHOE } from './helpers/ground.mjs';

const ROOT = rp(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = decodeForest(gunzipSync(readFileSync(rp(ROOT, 'v2/forest/data/trees.vft'))));
const ctxP = Promise.all([loadTerrain('full'), ground('full')]).then(([D, G]) => {
  const Sm = makeSampler(D), tmp = new Float32Array(11);
  return { field: { height: (x, z) => G.height(x, z) }, cover: (x, z) => Array.from(Sm.cover(x, z, tmp)), S: pickDay(CURRENT_WATERS, 'highlight').season, treeline: CURRENT_WATERS.treeline, y0: TAHOE.y0 ?? 1897.89 };
});
// a block of the desktop grid (its own texel lattice) and the trees in it
function block(i0, j0, n) { const G = gridOf('desktop'); return { ...G, x0: G.x0 + i0 * G.texel, z0: G.z0 + j0 * G.texel, nx: n, nz: n }; }
function splatAll(G, trees) {
  const c = new Uint32Array(G.nx * G.nz), t = new Uint32Array(G.nx * G.nz);
  for (const tr of trees) splatTree(G, c, t, tr.x, tr.z, tr.h, tr.r);
  return { c, t, words: resolve(G, c, t) };
}
const near = (trees, x, z, m) => trees.some((t) => Math.hypot(t.x - x, t.z - z) < m);

test('the grid: the rules\' region at 8 m (desktop) and 16 m (phone); two u32 buffers ≤ 16 MB / 4 MB', () => {
  const d = gridOf('desktop'), p = gridOf('phone');
  assert.equal(d.x0, REGION.x0); assert.equal(d.nx * d.texel, REGION.tw * REGION.tile); assert.equal(d.nz * d.texel, REGION.th * REGION.tile);
  assert.ok(2 * d.nx * d.nz * 4 <= 16e6, `desktop ${2 * d.nx * d.nz * 4} B`); assert.ok(2 * p.nx * p.nz * 4 <= 4e6, `phone ${2 * p.nx * p.nz * 4} B`);
});

test('the lidar\'s crowns: the cover stands only where trees are, follows their density, conserves their area; deterministic', () => {
  // a 1 km block round Fannette Island (the bay's water, the island, the shores' forest)
  const G = block(Math.round((-700 - REGION.x0) / 8), Math.round((-500 - REGION.z0) / 8), 128);
  const trees = [];
  for (let q = 0; q < T.n; q++) {
    const f = new Float32Array(T.inst.buffer, q * 16, 2), b = unpackBits(T.inst[4 * q + 3]);
    if (b.layer === 5) continue;   // a snag: no crown (the GPU's rule)
    if (f[0] >= G.x0 && f[0] < G.x0 + G.nx * 8 && f[1] >= G.z0 && f[1] < G.z0 + G.nz * 8) trees.push({ x: f[0], z: f[1], h: b.h, r: b.r });
  }
  assert.ok(trees.length > 2000, `${trees.length} trees in the block`);
  const A = splatAll(G, trees), B = splatAll(G, trees);
  assert.deepEqual(A.words, B.words, 'deterministic');
  // the crowns' area: the sums hold it (each crown's share rounded once a texel)
  let sum = 0, area = 0; for (const v of A.c) sum += v / CANOPY.fix * 64;
  for (const t of trees) { const R = Math.min(CANOPY.rMax, Math.max(0.5, CANOPY.crownK * t.r)); area += Math.PI * R * R; }
  const edge = 0.03;   // the crowns at the block's edge lose their outer share
  assert.ok(Math.abs(sum / area - 1) < edge, `area held: ${(sum / area).toFixed(4)}`);
  let bare = 0, bareCovered = 0, dense = [], sparse = [];
  for (let j = 2; j < G.nz - 2; j++) for (let i = 2; i < G.nx - 2; i++) {
    const x = G.x0 + (i + 0.5) * 8, z = G.z0 + (j + 0.5) * 8, w = unpackWord(A.words[j * G.nx + i]);
    if (!near(trees, x, z, 40)) { bare++; if (w.cover > 0) bareCovered++; continue; }
    // the trees' own crown area within 24 m against the cover there
    let a = 0; for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 24) a += Math.PI * (CANOPY.crownK * t.r) ** 2;
    (a / (Math.PI * 24 * 24) > 0.5 ? dense : a / (Math.PI * 24 * 24) < 0.15 ? sparse : []).push(w.cover);
  }
  assert.ok(bare > 100, `${bare} texels with no tree within 40 m (the lake)`);
  assert.equal(bareCovered, 0, `no cover where no tree stands (${bareCovered} of ${bare})`);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(dense.length > 100 && sparse.length > 100, `${dense.length} dense, ${sparse.length} sparse texels`);
  assert.ok(mean(dense) > 2 * mean(sparse) && mean(dense) > 0.35, `density followed: dense ${mean(dense).toFixed(3)}, sparse ${mean(sparse).toFixed(3)}`);
});

test('the rules\' trees: no canopy where the rules leave the ground bare (the lake, snow, cliffs, past the treeline)', async () => {
  const ctx = await ctxP;
  // two 2 km blocks: the open lake's shore east of the box (the lake), the high ground in the region's south-west (granite,
  // snow, the treeline)
  let checked = 0, wrong = 0, nTrees = 0, nBare = 0;
  for (const [bx, bz] of [[3400, -2500], [-4500, 3600]]) {
  const G = block(Math.round((bx - REGION.x0) / 8), Math.round((bz - REGION.z0) / 8), 256);
  const trees = [], bareWhy = [];
  const c0 = Math.floor((G.x0 - REGION.x0) / REGION.cell), r0 = Math.floor((G.z0 - REGION.z0) / REGION.cell), nC = Math.ceil(G.nx * 8 / REGION.cell);
  for (let cj = r0; cj < r0 + nC; cj++) for (let ci = c0; ci < c0 + nC; ci++) {
    const s = scatterSlot(ci, cj, ctx);
    if (s.valid) { if (s.layer !== 5) trees.push({ x: s.x, z: s.z, h: s.h, r: s.r }); } else if (['low', 'snow', 'treeline'].includes(s.why)) bareWhy.push(s);
  }
  nTrees += trees.length; nBare += bareWhy.length;
  const { words } = splatAll(G, trees);
  for (const s of bareWhy) {
    if (near(trees, s.x, s.z, 40)) continue;   // a bare slot inside a stand's reach (its neighbours' crowns)
    const i = Math.floor((s.x - G.x0) / 8), j = Math.floor((s.z - G.z0) / 8);
    if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) continue;
    checked++; if (unpackWord(words[j * G.nx + i]).cover > 0) wrong++;
  }
  }
  assert.ok(nTrees > 1000 && nBare > 200, `${nTrees} trees, ${nBare} bare slots`);
  assert.ok(checked > 100, `${checked} bare slots checked`);
  assert.equal(wrong, 0, `canopy on ${wrong} of ${checked} bare slots (lake, snow, treeline)`);
});

test('the hand-off: the cards\' share and the canopy\'s sum to 1 at every distance, continuous; the cards end at far', () => {
  for (const L of [FOREST.desktop, FOREST.phone, { ...FOREST.desktop, thin: FOREST.desktop.thin * 0.6, fade: FOREST.desktop.fade * 0.6, far: FOREST.desktop.far * 0.6 }]) {
    let prev = canopyShare(0, L, coverNear);
    assert.equal(prev, 0, 'no canopy under the near cards');
    for (let d = 0; d <= L.far + 500; d += 10) {
      const c = canopyShare(d, L, coverNear);
      assert.ok(Math.abs(c + coverNear(d, L) - 1) < 1e-12, `${d} m: a gap or a double band`);
      assert.ok(c >= prev - 1e-12 && c - prev < 0.02, `${d} m: a step ${prev.toFixed(3)} → ${c.toFixed(3)}`);
      prev = c;
    }
    assert.equal(canopyShare(L.far, L, coverNear), 1);
    // the cards' own coverage (Monte Carlo of the cull's keep rule × the widening) is the curve the canopy fills
    for (const d of [L.thin * 1.2, (L.fade + L.far) / 2]) {
      let cov = 0; const n = 20000; for (let i = 0; i < n; i++) cov += keepAt(d, (i + 0.5) / n, L);
      assert.ok(Math.abs(cov / n - coverNear(d, L)) < 0.01, `${d} m: the cards cover ${(cov / n).toFixed(3)}, the curve ${coverNear(d, L).toFixed(3)}`);
    }
  }
});

test('the card count past 3.5 km drops (desktop): fewer than half of T1\'s, none past 5 km', () => {
  const before = { thin: 2500, fade: 6000, far: 8000, wmax: 2.0 }, L = FOREST.desktop;
  // trees uniform on the ground in rings from 3.5 to 8 km: the count ∝ ∫ keep(d) · d dd
  const count = (P) => { let s = 0; for (let d = 3500; d < 8000; d += 5) { let k = 0; const n = 400; for (let i = 0; i < n; i++) if (keepAt(d, (i + 0.5) / n, P)) k++; s += k / n * d; } return s; };
  const a = count(before), b = count(L);
  assert.ok(b < 0.5 * a, `past 3.5 km: ${(b / a * 100).toFixed(0)} % of T1's cards`);
  assert.equal(keepAt(L.far, 0, L), 0); assert.equal(keepAt(5001, 0, L), 0);
  assert.ok(L.far <= 5000 && FOREST.phone.far <= 2800 && L.wmax <= 1.5);
});
