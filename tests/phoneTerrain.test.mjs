// fix/ios-start-2: the phone grid set is the same land, averaged down; the shore (distance) grids are shared
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTerrain, makeSampler } from '../src/sim/terrain-data.js';
import { downsample, predict } from '../tools/terrain/phone_terrain.mjs';

const full = makeSampler(await loadTerrain('full')), phone = makeSampler(await loadTerrain('phone'));

test('the phone heights follow the full ones (the bay, where the boat sails, and the whole basin)', () => {
  const stats = (x0, x1, z0, z1, n) => { let s = 0, m = 0, k = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = x0 + (x1 - x0) * (i + 0.5) / n, z = z0 + (z1 - z0) * (j + 0.5) / n, d = Math.abs(full.height(x, z) - phone.height(x, z)); s += d; m = Math.max(m, d); k++; } return { mean: s / k, max: m }; };
  const bay = stats(-2000, 3000, -1600, 1600, 60), basin = stats(-9000, 9000, -9000, 9000, 60);
  assert.ok(bay.mean < 1.5, JSON.stringify(bay)); assert.ok(basin.mean < 4, JSON.stringify(basin));
  // the start pose's water: deep either way
  assert.ok(phone.height(1200, -1050) < -4 && full.height(1200, -1050) < -4);
});

test('the shore distance is the same grid in both sets (the boat grounds where it did)', () => {
  for (const [x, z] of [[1200, -1050], [0, 0], [-500, 300], [2500, -200], [6000, 4000]]) assert.equal(phone.distance(x, z), full.distance(x, z));
});

test('the encoder round-trips: predict, then the unpredict of the loader, gives the grid back', async () => {
  const w = 7, h = 5, q = Uint16Array.from({ length: w * h }, (_, i) => (i * 7919) & 0xffff);
  const p = predict(q, w, h);
  const n = w * h, back = new Uint16Array(n);
  for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k++) { const r = (p[k] << 8) | p[n + k], l = i ? back[k - 1] : 0, u = j ? back[k - w] : 0, ul = i && j ? back[k - w - 1] : 0; back[k] = (r + (j && i ? l + u - ul : j ? u : l)) & 0xffff; }
  assert.deepEqual(back, q);
  assert.deepEqual([...downsample(Uint16Array.from([1, 3, 5, 7]), 2, 2, 2).q], [4]);
});
