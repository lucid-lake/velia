// The slow lane (npm run test:slow): our boat rammed at each barge and its tug (about 12 s a barge; the first ran in the
// fast suite until 2026-11-12), and Cruise's trips past the barges (in the fast suite until 2026-11-12, about 6 s).
// Bodies: tests/helpers/solids-ram.mjs rammingSweep, tests/helpers/fireworks-trip.mjs runTrip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rammingSweep, onBody } from '../helpers/solids-ram.mjs';
import { runTrip } from '../helpers/fireworks-trip.mjs';
import { solidGap, chartObjects, showBodies, BARGE_POLYS } from '../../classic/src/fireworks/solids.js';

rammingSweep(0);
rammingSweep(1);

test('Cruise passes clear: the props are on its chart and the trip to the viewing spot past the barges keeps ≥ 20 m off every prop (without them on its chart it sailed through a barge)', async () => {
  const { heightAt } = await import('../../src/sim/terrain.js');
  const bodies = showBodies(heightAt), extra = chartObjects(bodies);
  // the tug's stern (51 m past the barge's middle) is inside the chart's circles with room to spare
  for (const b of bodies.filter((q) => q.kind === 'barge')) {
    for (const [bx, by] of BARGE_POLYS.flat()) {
      const p = onBody(b, bx, by, 0);
      assert.ok(extra.some(([x, z, r]) => Math.hypot(p.x - x, p.z - z) < r + 1), `the outline point (${bx}, ${by}) is charted`);
    }
  }
  for (const start of [{ x: 600, z: -400, headingDeg: 60, speed: 2.5 }, { x: 800, z: -700, headingDeg: 45, speed: 2.5 }]) {
    let min = Infinity;
    const r = runTrip({ start, minutes: 12, extra, onStep: (st) => { for (const b of bodies) min = Math.min(min, solidGap(st, b)); } });
    assert.ok(min > 20, `from ${start.x}, ${start.z}: ${min.toFixed(1)} m from the nearest prop`);
    assert.ok(r.rec.states.includes('anchored'), `anchored at the spot (${r.rec.states.join(' → ')})`);
  }
});
