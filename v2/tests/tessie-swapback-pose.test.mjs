// Refactor round 3, A1 bug 4: while she is played the page keeps handing the player the boat's own camera; the swap-back must judge the
// veil against where the boat is NOW, not where it was when she was taken (a far boat cuts, never glides 300-1,000 m).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';

const DT = 1 / 30, deep = () => 40;
const cam = (x, z) => ({ pos: [x, 3, z + 20], target: [x, 1, z], fov: 55 });

test('swap-back after a long visit cuts under the veil when the boat has sailed far while she was played', () => {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const veils = [];
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: (...a) => veils.push(a), storage: null });
  // the boat near her: she rises and the player takes her
  const b0 = { x: 0, z: 0, heading: 0, speed: 0 };
  sim.ambush(30, -40, Math.PI / 2, TESSIE.U); sim.hunt(false);
  for (let k = 0; k < 8 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: 0, z: 20, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, cam(0, 0));
  P.swap.step(DT, { on: true, shown: true, distM: 50 });   // the swap pill is up (she is in view and near)
  const r = P.become('swap');
  assert.ok(r.ok, JSON.stringify(r));
  P.camera(DT, cam(0, 0));
  // she is played for minutes; the boat's camera (handed in each frame) goes 800 m away
  for (let k = 0; k < 20; k++) P.camera(DT, cam(0, -40 * k - 40));
  P.camera(DT, cam(0, -800));
  veils.length = 0;
  assert.ok(P.back());
  assert.equal(P.stats().glide, false, 'no glide across 800 m');
  assert.ok(veils.length > 0, 'the veil cuts instead');
});
