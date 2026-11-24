// Tessie's strike capsizes the Halcyon and she stays capsized (owner, 2026-11-20: "Even in Sail mode, when Tessie capsizes the boat, the end
// card appears and the boat stays capsized"). Behaviour only: the boat's real physics, B.shove (her tail sweep) and B.capsize (the hold).
//   held: on her side (about 86°) for good, her way gone, drifting slowly downwind; never righting on her own
//   a fresh start (B.place: Start again) lets go: upright and sailing
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, CAPSIZE_HOLD } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { REVENGE } from '../sim/tessieRevenge.js';

const DEG = Math.PI / 180;

test('held capsized: on her side for good, drifting, until a fresh start', () => {
  const B = createBoatSim({ water: waterFor(() => 0), wind: { sample: steadyWind(7, 0) }, start: { x: 0, z: 0, headingDeg: 90, speed: 2.5 }, flags: { knockdown: true } });
  const P = B.phys.P;
  B.shove({ K: REVENGE.rollK * P.mass * 9.81 * P.gm });
  let over = false;
  for (let i = 0; i < 60 * 3; i++) { B.step(1 / 60); if (Math.abs(B.state.heel) > 55 * DEG) over = true; }
  assert.ok(over, 'her tail sweep lays the boat over');
  B.capsize(true);
  const x0 = B.state.x, z0 = B.state.z;
  let least = Infinity;
  for (let i = 0; i < 60 * 40; i++) { B.step(1 / 60); if (i > 60 * 2) least = Math.min(least, Math.abs(B.state.heel)); }
  assert.ok(least > (CAPSIZE_HOLD.lieDeg - CAPSIZE_HOLD.bobDeg - 1) * DEG, `on her side 40 s on (least ${(least / DEG).toFixed(0)}°)`);
  assert.ok(Math.abs(B.state.u) < 0.2, `her way gone (${B.state.u.toFixed(2)} m/s)`);
  const d = Math.hypot(B.state.x - x0, B.state.z - z0);
  assert.ok(d > 3 && d < 20, `drifting slowly with the wind (${d.toFixed(1)} m in 40 s)`);
  assert.equal(B.capsized, true);
  B.place({ x: 0, z: 0, headingDeg: 90, speed: 2.5 });
  assert.equal(B.capsized, false, 'Start again lets go');
  for (let i = 0; i < 60 * 5; i++) B.step(1 / 60);
  assert.ok(Math.abs(B.state.heel) < 30 * DEG, 'upright and sailing again');
});
