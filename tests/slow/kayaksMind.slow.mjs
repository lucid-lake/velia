// The slow lane (npm run test:slow): a normal sail from the start meets a kayaker within 4 minutes (tests/kayaksMind.test.mjs
// has the rest of the minds' checks; this one ran in the fast suite until 2026-11-12, about 7 s). Body: the fleet run in
// tests/helpers/kayak-fleet.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sail, runFleet } from '../helpers/kayak-fleet.mjs';

test('a normal sail from the start meets a kayaker within 4 minutes: never under 6 m, typically 8–20 m, on the morning and the evening default', () => {
  const misses = [], close = [], bests = [], holds = [];
  let runs = 0;
  for (const hour of [9, 18.75]) for (const kind of ['hold', 'island']) for (const U of [2.5, 3.0, 3.6]) for (let seed = 1; seed <= 12; seed++) {
    const r = runFleet({ seed, hour, boat: sail(kind, U), secs: 240 });
    if (!r.n) continue;   // the wind sent everyone home (the owner's default: the count follows the day's wind)
    runs++;
    const best = Math.min(...r.ks.map((k) => k.min));
    bests.push(best); if (kind === 'hold') holds.push(best);
    if (best > 60) misses.push(`${hour} ${kind} ${U} seed ${seed}: ${best.toFixed(0)} m`);
    for (const k of r.ks) { if (k.min < 6) close.push(`${hour} ${kind} ${U} ${seed} ${k.s.id}: ${k.min.toFixed(1)}`); assert.ok(k.ahead < 0.5, `${k.s.id} under the bow ${k.ahead.toFixed(1)} s`); assert.ok(k.wet); }
    assert.ok(r.pair >= 6 || r.n < 2, `kayaks ${r.pair.toFixed(1)} m apart`);
  }
  assert.ok(runs >= 100, `${runs} runs`);
  assert.ok(misses.length <= Math.floor(runs * 0.08), `${misses.length} of ${runs} sails met nobody within 60 m: ${misses.slice(0, 5).join('; ')}`);
  assert.deepEqual(close, [], 'nobody comes within 6 m');
  // typical: the median closest pass 8–20 m over all the sails, and over the sails that hold the start's heading
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  assert.ok(med(bests) >= 8 && med(bests) <= 20, `median closest ${med(bests).toFixed(1)} m`);
  assert.ok(med(holds) >= 8 && med(holds) <= 20, `median closest holding the start's heading ${med(holds).toFixed(1)} m`);
});
