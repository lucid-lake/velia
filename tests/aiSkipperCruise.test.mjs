// Cruise with the AI skipper: 20 min on the real bay (the real terrain, wind, traffic), safe and round the loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyage } from '../src/modes/chill/sim.js';
import { skipperVoyage } from './helpers/cases-chill.mjs';

// seed 3 at skill 1 here; seeds 1 and 2 and the 0.2 skipper run in the slow lane (tests/slow/aiSkipperCruise.slow.mjs)
skipperVoyage([3, 1]);

test('the same seed gives the same Cruise track', () => {
  const run = () => { let h = 0; voyage({ seed: 2, hour: 16, rate: 0, minutes: 4, skipper: 1, onTick: (t, s) => { h = (h * 31 + Math.round(s.x * 100) + Math.round(s.z * 100)) | 0; } }); return h; };
  assert.equal(run(), run());
});
