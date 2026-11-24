// The gust cap (owner, 2026-10-30): the peak gust is at most 1.5 x the local mean at every level, hour and seed; the
// gusts and lulls keep their frequency (a soft limiter, not a flat wind). Numbers "before" are main at 7e0169a
// (tools/probe_gust_cap.mjs, seeds 1-5, bay lattice, 5 s steps).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gustShape } from '../src/sim/wind.js';
import { gustStats } from '../tools/probe_gust_cap.mjs';

const BEFORE = {   // [lull share, gusts of 1.2 x the point's mean per 600 s]
  '18.75/1': [0.206, 4.07], '18.75/2': [0.216, 5.24], '18.75/3': [0.216, 6.11], '18.75/4': [0.203, 7.49],
  '15/1': [0.167, 3.82], '15/2': [0.162, 5.27], '15/3': [0.160, 6.41], '15/4': [0.158, 8.00],
};
// fix/wind-level-range (2026-11-04): 15:00 used to blow over the band (level 3: 21.8 kn of bay mean; the pooled means
// below, main before the fix). It is now capped in the band, and gusts carried by a slower wind pass a point less often,
// so at 15:00 the gust count is compared per knot of mean wind (gusts per km of air), not per 600 s.
const MEAN_15_BEFORE = { 1: 7.9, 2: 14.8, 3: 21.8, 4: 30.1 };
const stats = gustStats();

test('the limiter is smooth, monotone, leaves lulls alone and stays under the cap', () => {
  let prev = -1;
  for (let f = 0; f <= 4; f += 0.01) {
    const g = gustShape(f);
    assert.ok(g >= prev - 1e-12, `monotone at ${f}`);
    assert.ok(g < 1.4, `under the cap at ${f}: ${g}`);
    if (f <= 1.1) assert.equal(g, f);
    prev = g;
  }
  assert.ok(gustShape(1.2) - gustShape(1.15) > 0.02, 'still rising through a mild gust');
  assert.ok(gustShape(2) - gustShape(1.6) > 1e-4, 'no hard clip');
});

test('peak <= 1.5 x the point’s local mean: levels 1-4, seeds 1-5, 18:45 and 15:00', () => {
  assert.equal(stats.length, 8);
  for (const q of stats) assert.ok(q.worstPoint <= 1.5, `${q.hour} L${q.L}: ${q.worstPoint.toFixed(3)}`);
});

test('lull share and gust frequency stay within 20 % of before; gusts are still there', () => {
  for (const q of stats) {
    const [lull, gusts] = BEFORE[`${q.hour}/${q.L}`];
    assert.ok(Math.abs(q.lullShare / lull - 1) <= 0.2, `${q.hour} L${q.L}: lull ${q.lullShare.toFixed(3)} vs ${lull}`);
    const ref = q.hour === 15 ? gusts * q.meanKn / MEAN_15_BEFORE[q.L] : gusts;
    assert.ok(Math.abs(q.gustsPer600 / ref - 1) <= 0.2, `${q.hour} L${q.L}: gusts ${q.gustsPer600.toFixed(2)} vs ${ref.toFixed(2)}`);
    assert.ok(q.p95Kn / q.meanKn > 1.25, `${q.hour} L${q.L}: p95/mean ${(q.p95Kn / q.meanKn).toFixed(2)}`);
  }
});

test('level 4 at 18:45 stays in its band (18-24 kn) with the cap', () => {
  const q = stats.find((s) => s.hour === 18.75 && s.L === 4);
  assert.ok(q.meanKn >= 18 && q.meanKn <= 24, `mean ${q.meanKn}`);
});
