// Refactor round 3, A2 bugs 5 and 7: swap-back detaches only Tessie's own flee driver, and drops a held tablet stick.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';

const DT = 1 / 30, deep = () => 40;
const cam = (x, z) => ({ pos: [x, 3, z + 20], target: [x, 1, z], fov: 55 });

function rig() {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage: null });
  const b0 = { x: 0, z: 0, heading: 0, speed: 0 };
  sim.ambush(30, -40, Math.PI / 2, TESSIE.U); sim.hunt(false);
  for (let k = 0; k < 8 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: 0, z: 20, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, cam(0, 0));
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  const r = P.become('swap');
  assert.ok(r.ok, JSON.stringify(r));
  P.camera(DT, cam(0, 0));
  return { B, P };
}

test('swap-back keeps an autopilot that took the boat while she was played', () => {
  const { B, P } = rig();
  assert.ok(B.driven, 'her flee drives the Halcyon');
  const cruise = () => {};
  B.drive(cruise);   // Cruise picked from the menu
  assert.ok(P.back());
  assert.ok(B.driven && B.drivenBy(cruise), "Cruise's driver survives");
});

test('swap-back still detaches her own flee', () => {
  const { B, P } = rig();
  assert.ok(P.back());
  assert.equal(B.driven, false);
});
