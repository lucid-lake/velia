// The slow lane (npm run test:slow): the bottom's matrices that tests/ground.test.mjs leaves out: the shallow-water assist
// with the wind astern and ahead (it runs the beam), the beam breeze on the other tack (in the fast suite until 2026-11-12,
// about 6 s), Cruise on the bottom seeds 2 and 3 (it runs seed 1). Bodies: tests/helpers/cases-ground.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runs, tag, assistCase, cruiseGroundCase } from '../helpers/cases-ground.mjs';

assistCase([180, 40]);
for (const seed of [2, 3]) cruiseGroundCase(seed);

test('the assist on a beam breeze on the other tack: at 6 and 8 kn it never grounds either; at 3 kn it grounds at most once in 40 (the limit: a slow boat, a beam wind, a tight corner)', () => {
  let slow = 0, n = 0;
  for (const x of runs({ assist: true, windRelDeg: -90 })) {
    if (x.kn >= 6) assert.ok(!x.r.grounded && x.r.minKeel >= 0, `${tag(x)}: aground`);
    else { n++; if (x.r.grounded || x.r.minKeel < 0) slow++; }
  }
  assert.ok(slow <= Math.ceil(n / 40), `${slow} of ${n} slow runs touched`);
});
