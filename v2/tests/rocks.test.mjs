// The boulders' placement (M5c, v2/terrain/rocks-rules.js rockSlot: the JS twin of the GPU scatter) over the real grids
// (v1's sampler: the full heights and the NLCD cover, as the GPU's): none floating (the ground holds the rock's bottom
// under its centre and its footprint), none on the deep bed (the shore band stops at −1.5 m), none on a beach, the slope
// rocks on 20–50° open ground, every rock showing above the ground; the counts in v1's range; deterministic; and the
// lumped icosahedron mesh (v1's boulder) is sane.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROCKS, SLOT_COUNT, COLS, rockSlot, cellHash } from '../terrain/rocks-rules.js';
import { boulderMesh, PLACED_CAP } from '../render/rocks.js';
import { makeSampler, loadTerrain } from '../../src/sim/terrain-data.js';   // the cover grids: v2 has no CPU cover twin (the GPU samples them); C7b list
import { ground } from './helpers/ground.mjs';   // v2's own height field
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { pickDay } from '../../src/sim/day.js';
import { TAHOE } from './helpers/ground.mjs';

const ctxP = Promise.all([loadTerrain('full'), ground('full')]).then(([D, G]) => {
  const Sm = makeSampler(D), tmp = new Float32Array(11);
  return { field: { height: (x, z) => G.height(x, z) }, cover: (x, z) => Array.from(Sm.cover(x, z, tmp)), S: pickDay(CURRENT_WATERS, 'highlight').season, y0: TAHOE.y0 ?? 1897.89 };
});
const ROWS = SLOT_COUNT / COLS;
function* cells(step = 5) { for (let cj = 1; cj < ROWS; cj += step) for (let ci = 2; ci < COLS; ci += step) yield [ci, cj]; }
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

test('the slots tile the bay\'s 2 m box at the cell; the hash is the forest\'s (u32 exact)', () => {
  assert.equal(COLS, Math.ceil((ROCKS.box.x1 - ROCKS.box.x0) / ROCKS.cell)); assert.equal(SLOT_COUNT, COLS * Math.ceil((ROCKS.box.z1 - ROCKS.box.z0) / ROCKS.cell));
  assert.ok(SLOT_COUNT > 300000 && SLOT_COUNT < 400000, `${SLOT_COUNT} slots`);
  assert.equal(cellHash(3, 4, 21), cellHash(3, 4, 21)); assert.notEqual(cellHash(3, 4, 21), cellHash(3, 4, 22));
});

test('every rock stands on the ground: none floating, none on the deep bed, none on a beach; the shore band and the slopes as v1\'s', async () => {
  const ctx = await ctxP;
  const why = {}; let n = 0, shore = 0, slope = 0; const seen = [];
  for (const [ci, cj] of cells()) {
    const o = rockSlot(ci, cj, ctx); n++;
    if (!o.valid) { why[o.why] = (why[o.why] ?? 0) + 1; continue; }
    const h = ctx.field.height(o.x, o.z), ry = ROCKS.squash[1] * o.r, bottom = o.y - ry, top = o.y + ry;
    assert.ok(h >= ROCKS.shore.yMin, `a rock on the deep bed at ${o.x.toFixed(0)}, ${o.z.toFixed(0)}: ${h.toFixed(2)} m`);
    assert.ok(h >= bottom, 'the ground under the centre holds the rock');
    // the footprint: at half a radius out in four directions the ground stays above the bottom (the rock touches down
    // everywhere it is wide; a steep downhill side may stand clear by less than its radius, as a real boulder does)
    for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
      const hf = ctx.field.height(o.x + dx * o.r, o.z + dz * o.r);
      assert.ok(hf >= bottom - 0.05 * o.r, `floating: the ground at (${dx}, ${dz}) r is ${(hf - bottom).toFixed(2)} m under the rock's bottom`);
    }
    assert.ok(top > h - 0.75 * o.r, 'the rock shows (not buried whole)');
    const gx = (ctx.field.height(o.x + 2, o.z) - ctx.field.height(o.x - 2, o.z)) / 4, gz = (ctx.field.height(o.x, o.z + 2) - ctx.field.height(o.x, o.z - 2)) / 4, steep = Math.hypot(gx, gz);
    const c = ctx.cover(o.x, o.z), urban = (c[2] + c[3] * 0.4) * 0.5;
    const beach = smoothstep(0.16, 0.06, steep) * (1 - smoothstep(0.8, 1.8, h)) * (1 - Math.min(urban, 1));
    if (o.kind === 0) {
      shore++;
      assert.ok(h <= ROCKS.shore.yMax, 'the shore band'); assert.ok(beach <= ROCKS.shore.beachMax, 'never on a beach');
      assert.ok(h <= ROCKS.shore.flatMaxY || steep >= ROCKS.shore.steepMin, 'above 0.8 m only where the ground climbs');
      assert.ok(o.r >= ROCKS.shore.r[0] - 1e-9 && o.r <= ROCKS.shore.r[1] + 1e-9);
    } else {
      slope++;
      assert.ok(h > ROCKS.shore.yMax && steep >= ROCKS.slope.steep[0] && steep <= ROCKS.slope.steep[1], `a slope rock on ${(Math.atan(steep) * 180 / Math.PI).toFixed(0)}° at ${h.toFixed(0)} m`);
      assert.ok(o.r >= ROCKS.slope.r[0] - 1e-9 && o.r <= ROCKS.slope.r[1] + 1e-9);
    }
    assert.ok(o.yaw >= 0 && o.yaw < 2 * Math.PI && o.tone >= 0 && o.tone < 1);
    seen.push(`${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)},${o.r.toFixed(3)}`);
  }
  assert.ok(shore > 40, `${shore} shore rocks of ${n} sampled slots (${JSON.stringify(why)})`);
  assert.ok(slope > 30, `${slope} slope rocks of ${n} sampled slots`);
  assert.ok(why.deep > n * 0.25, 'much of the box is the lake');
  assert.ok((shore + slope) / n * SLOT_COUNT < PLACED_CAP * 0.8, `the placed buffer holds the box's rocks (${Math.round((shore + slope) / n * SLOT_COUNT)} expected)`);
  // deterministic: a second pass gives the same rocks
  let k = 0;
  for (const [ci, cj] of cells()) { const o = rockSlot(ci, cj, ctx); if (!o.valid) continue; assert.equal(`${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)},${o.r.toFixed(3)}`, seen[k++]); }
});

test('the boulder mesh: v1\'s lumped icosahedron, 42 vertices, 80 faces, unit normals, radii within the lump', () => {
  const m = boulderMesh();
  assert.equal(m.vertices, 42); assert.equal(m.triangles, 80); assert.equal(m.idx.length, 240);
  for (let i = 0; i < m.vertices; i++) {
    const r = Math.hypot(m.pos[3 * i], m.pos[3 * i + 1], m.pos[3 * i + 2]);
    assert.ok(r > 0.7 && r < 1.3, `vertex ${i} radius ${r}`);
    const nl = Math.hypot(m.nrm[3 * i], m.nrm[3 * i + 1], m.nrm[3 * i + 2]);
    assert.ok(Math.abs(nl - 1) < 1e-6);
    const dot = (m.pos[3 * i] * m.nrm[3 * i] + m.pos[3 * i + 1] * m.nrm[3 * i + 1] + m.pos[3 * i + 2] * m.nrm[3 * i + 2]) / r;
    assert.ok(dot > 0.5, `vertex ${i}: the normal points outward (${dot.toFixed(2)})`);
  }
  for (const k of m.idx) assert.ok(k < m.vertices);
});
