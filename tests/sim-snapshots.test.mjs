// The snapshot gate (refactor round 2, Phase C step 5): Sail seed 1's Simulation snapshots byte for byte as recorded on
// main before the craft seam (tests/helpers/sim-snapshots.mjs); the slow lane runs the other eight mode × seed pairs.
// The negative control: the same inputs on a second boat (tests/fixtures/profiles/second.mjs) give other bytes, so the
// gate is known to bite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSail, replaySail } from './helpers/sim-sail.mjs';
import { snapshotCase, recordRun, readFixture, digest } from './helpers/sim-snapshots.mjs';
import { encodeState } from '../src/sim/sail/simulation.js';
import { TEST_BOAT } from './fixtures/profiles/second.mjs';

snapshotCase('sail', 1, runSail, replaySail);

test('the snapshot gate bites: another boat, or one input changed, gives other bytes at tick 600', () => {
  const r = recordRun('sail', 1, (o) => runSail({ ...o, seconds: 12 }));
  const want = readFixture().snapshots.sail[1][600];
  const same = encodeState(replaySail(r, { at: 600 }).sim.snapshot());
  assert.deepEqual(digest(same), want, 'the control: the short run replays to the recorded bytes');
  const other = encodeState(replaySail(r, { at: 600, vessel: TEST_BOAT }).sim.snapshot());
  assert.notDeepEqual(digest(other), want, 'a second boat');
  const nudged = { ...r, inputs: r.inputs.map((x, i) => (i === 300 ? { ...x, ctl: { ...x.ctl, rudder: x.ctl.rudder + 1e-9 } } : x)) };
  assert.notDeepEqual(digest(encodeState(replaySail(nudged, { at: 600 }).sim.snapshot())), want, 'a rudder 1e-9 off at tick 300');
});
