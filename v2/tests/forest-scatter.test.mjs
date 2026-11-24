// The rules' forest round the lidar box (M5b, v2/forest/scatter.js scatterSlot: the JS twin of the GPU scatter) over
// the real grids (v1's sampler: the full heights and the NLCD cover, as the GPU's): no tree in the lake or under 2.5 m,
// none inside the lidar box, none on snow, none above the ragged treeline, almost none where the cover is bare rock
// or on cliffs; trees where the cover says forest; heights within the lidar's spread; deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scatterSlot, cellHash, hashU, RULES } from '../forest/scatter.js';
import { REGION, inBox } from '../forest/lod.js';
import { makeSampler, loadTerrain } from '../../src/sim/terrain-data.js';   // the cover grids: v2 has no CPU cover twin (the GPU samples them); C7b list
import { ground } from './helpers/ground.mjs';   // v2's own height field
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { pickDay } from '../../src/sim/day.js';
import { TAHOE } from './helpers/ground.mjs';

const ctxP = Promise.all([loadTerrain('full'), ground('full')]).then(([D, G]) => {
  const Sm = makeSampler(D), tmp = new Float32Array(11);
  const season = pickDay(CURRENT_WATERS, 'highlight').season;
  return { field: { height: (x, z) => G.height(x, z) }, cover: (x, z) => Array.from(Sm.cover(x, z, tmp)), S: season, treeline: CURRENT_WATERS.treeline, y0: TAHOE.y0 ?? 1897.89 };
});
// a seeded sample of the region's cells (every 7th cell in both directions: ≈ 15.7 k slots)
function* cells(step = 7) { for (let cj = 3; cj < REGION.th * REGION.n; cj += step) for (let ci = 2; ci < REGION.tw * REGION.n; ci += step) yield [ci, cj]; }

test('the hash: u32 exact (the WGSL twin), in [0, 1), spread evenly', () => {
  assert.equal(hashU(0), 0); assert.equal(hashU(1), hashU(1)); assert.notEqual(hashU(1), hashU(2));
  const bins = new Array(10).fill(0); const n = 50000;
  for (let i = 0; i < n; i++) { const u = cellHash(i % 397 - 200, Math.floor(i / 397) - 60, 3); assert.ok(u >= 0 && u < 1); bins[Math.floor(u * 10)]++; }
  for (const b of bins) assert.ok(Math.abs(b / n - 0.1) < 0.01, `bin share ${b / n}`);
});

test('the rules\' trees: never in the lake, the box, on snow or past the treeline; on forest cover; heights in the lidar\'s spread', async () => {
  const ctx = await ctxP;
  const why = {}; let valid = 0, n = 0, rockish = 0, steep = 0;
  const hs = [];
  for (const [ci, cj] of cells()) {
    const s = scatterSlot(ci, cj, ctx); n++;
    if (!s.valid) { why[s.why] = (why[s.why] ?? 0) + 1; continue; }
    valid++;
    const y = ctx.field.height(s.x, s.z);
    assert.ok(y >= RULES.minH, `a tree at ${s.x.toFixed(0)}, ${s.z.toFixed(0)}: ${y.toFixed(2)} m (the lake)`);
    assert.ok(!inBox(s.x, s.z), 'a rule tree inside the lidar box');
    assert.ok(y + ctx.y0 <= ctx.treeline + RULES.treelineJitter, 'a tree above the treeline');
    assert.ok(s.h >= (s.layer === 5 ? 3.2 : 4) && s.h <= RULES.h[0] + RULES.h[1] + 0.01, `height ${s.h}`);   // a snag: 0.8 × its height
    assert.ok(s.layer >= 0 && s.layer <= 5);
    const c = ctx.cover(s.x, s.z), known = c.reduce((a, b) => a + b, 0);
    if (known > 0.5 && c[4] > 0.9) rockish++;
    const g = Math.hypot(ctx.field.height(s.x + 4, s.z) - ctx.field.height(s.x - 4, s.z), ctx.field.height(s.x, s.z + 4) - ctx.field.height(s.x, s.z - 4)) / 8;
    if (g > RULES.cliff[1]) steep++;
    hs.push(s.h);
  }
  assert.ok(valid > 1500, `${valid} of ${n} slots hold a tree (${JSON.stringify(why)})`);
  assert.ok(why.low > 0 && why.box > 0 && why.sparse > 0, JSON.stringify(why));
  assert.ok(rockish / valid < 0.01, `${rockish} trees on bare-rock cover (the terrain draws granite there)`);
  assert.equal(steep, 0, 'trees on cliffs past the cliff ramp');
  hs.sort((a, b) => a - b);
  const med = hs[hs.length >> 1];
  assert.ok(med > 8 && med < 18, `median height ${med.toFixed(1)} m (the lidar's ≈ 13 m)`);
});

test('the rules\' trees follow the cover: forest cells are kept far more often than open or rock cells', async () => {
  const ctx = await ctxP;
  let fN = 0, fK = 0, oN = 0, oK = 0;
  for (const [ci, cj] of cells(5)) {
    const s = scatterSlot(ci, cj, ctx);
    if (s.why === 'box' || s.why === 'low') continue;
    const c = ctx.cover(s.x, s.z);
    if (c[5] > 0.9) { fN++; if (s.valid) fK++; } else if (c[4] + c[7] > 0.9) { oN++; if (s.valid) oK++; }
  }
  assert.ok(fN > 500 && oN > 100, `${fN} forest cells, ${oN} rock or grass cells`);
  assert.ok(fK / fN > 0.35, `forest kept ${(fK / fN).toFixed(2)}`);
  assert.ok(oK / oN < 0.1 * (fK / fN) + 0.02, `rock and grass kept ${(oK / oN).toFixed(3)} vs forest ${(fK / fN).toFixed(2)}`);
});

test('deterministic: the same cell gives the same tree', async () => {
  const ctx = await ctxP;
  for (const [ci, cj] of [[300, 400], [100, 900], [700, 120]]) assert.deepEqual(scatterSlot(ci, cj, ctx), scatterSlot(ci, cj, ctx));
});
