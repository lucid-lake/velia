// The gust cells (src/wind-cells.js, wow/gusts): puffs with a sharp leading edge, carried with the air.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, cellFactor, cellRaster, cellLife, cellsOption } from '../src/sim/wind-cells.js';
import { WindField } from '../src/sim/wind.js';

test('cells: deterministic, off by default, mean-neutral over open water (CELLS.mean)', () => {
  assert.equal(new WindField({ seed: 1 }).cells, null);
  assert.equal(cellsOption(true), CELLS);
  assert.equal(cellsOption({ gain: [0.1, 0.2] }).gain[1], 0.2);
  assert.equal(cellFactor(120, -340, 77, [300, 90], 200, 3), cellFactor(120, -340, 77, [300, 90], 200, 3));
  let s = 0, n = 0;
  for (let t = 0; t < 1800; t += 13) for (let x = -2000; x < 2000; x += 61) for (let z = -2000; z < 2000; z += 67) { s += cellFactor(x, z, t, [t * 7, t * 3], 200, 1); n++; }
  assert.ok(Math.abs(s / n - 1) < 0.01, `mean ${(s / n).toFixed(4)}`);
});

test('cells: a life that spreads in, holds and fades; gone between cycles', () => {
  assert.equal(cellLife(-1), 0);
  assert.equal(cellLife(0), 0);
  assert.equal(cellLife(CELLS.riseS + 1), 1);
  assert.ok(cellLife(CELLS.riseS + CELLS.holdS + CELLS.fadeS / 2) > 0.3);
  assert.equal(cellLife(CELLS.riseS + CELLS.holdS + CELLS.fadeS + 1), 0);
});

test('cells: ride downwind at the air speed (the same pattern, carried by the advection)', () => {
  const t = 40, adv0 = [0, 0], d = [55, -80];
  for (const [x, z] of [[0, 0], [130, -260], [-410, 75]]) assert.equal(cellFactor(x + d[0], z + d[1], t, d, 200, 2), cellFactor(x, z, t, adv0, 200, 2));
});

test('cells: a sharp leading edge (the rise over ≤ 30 m downwind) and a softer tail; a boat meets several every 10 min', () => {
  // a line through the strongest point found, along the wind (from 270°: downwind is +x)
  let best = null;
  for (let x = -1500; x < 1500; x += 10) for (let z = -1500; z < 1500; z += 10) { const f = cellFactor(x, z, 50, [0, 0], 270, 1); if (!best || f > best.f) best = { x, z, f }; }
  assert.ok(best.f * CELLS.mean > 1 + CELLS.gain[0] * 0.8, `core ${best.f}`);
  const along = []; for (let a = -300; a <= 300; a += 1) along.push(cellFactor(best.x + a, best.z, 50, [0, 0], 270, 1) * CELLS.mean - 1);
  const peak = Math.max(...along), at = (k) => along.findIndex((v, i) => i > 300 && v < k * peak), back = (k) => 300 - [...along.slice(0, 301)].reverse().findIndex((v) => v < k * peak);
  const frontW = at(0.1) - at(0.9), backW = back(0.9) - back(0.1);   // the 90 → 10 % widths, m
  assert.ok(frontW > 0 && frontW <= 30, `front ${frontW} m`);
  assert.ok(backW > frontW * 2, `back ${backW} m vs front ${frontW} m`);
  // a boat at 4 m/s across a 8 m/s wind: the gusts it sails into (upcrossings of +12 %)
  const dirR = 200 * Math.PI / 180, ux = -Math.sin(dirR), uz = Math.cos(dirR);
  let up = 0, prev = 1;
  for (let t = 0; t < 1800; t += 0.5) { const f = cellFactor(300 + 4 * t, -300, t, [ux * 8 * t, uz * 8 * t], 200, 1) * CELLS.mean; if (f > 1.12 && prev <= 1.12) up++; prev = f; }
  assert.ok(up / 3 >= 3 && up / 3 <= 12, `${(up / 3).toFixed(1)} gusts per 10 min`);
});

test('cells: the raster draws exactly cellFactor at every texel centre', () => {
  const n = 64, E = 4096, cell = E / n, cx = 512, cz = -512, px = new Float64Array(n * n), pz = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { px[j * n + i] = cx - E / 2 + (i + 0.5) * cell; pz[j * n + i] = cz - E / 2 + (j + 0.5) * cell; }
  for (const t of [10, 95, 333]) {
    const adv = [t * 6.1, -t * 2.3], r = cellRaster(px, pz, n, cell, t, adv, 215, 4);
    for (let p = 0; p < n * n; p++) assert.equal(r[p], cellFactor(px[p], pz[p], t, adv, 215, 4));
  }
});

test('cells in the field: sample() and toTexture() agree, and the gust cap still holds (≤ 1.5 × the local mean)', () => {
  const a = new WindField({ seed: 2, base: { dirDeg: 200, speedMs: 7 }, cells: true });
  const N = 32, E = 2048, t = 60, tex = a.toTexture(N, E, t, 0, 0), cell = E / N;
  for (const [i, j] of [[3, 4], [16, 16], [30, 2], [11, 27]]) {
    const s = a.sample(-E / 2 + (i + 0.5) * cell, -E / 2 + (j + 0.5) * cell, t), p = j * N + i;
    assert.ok(Math.abs(tex[2 * p] - s.vx) < 1e-4 && Math.abs(tex[2 * p + 1] - s.vz) < 1e-4);
  }
  const w = new WindField({ seed: 1, day: { hour: 18.75, rate: 1 }, level: 3, cells: true });
  for (const [x, z] of [[300, -300], [800, -700], [100, -900]]) {
    const v = []; for (let t2 = 0; t2 < 1800; t2 += 2) v.push(w.sample(x, z, t2).speed);
    const m = v.reduce((q, b) => q + b, 0) / v.length;
    assert.ok(Math.max(...v) / m <= 1.5, `peak/mean ${(Math.max(...v) / m).toFixed(2)} at ${x},${z}`);
  }
});
