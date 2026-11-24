// Refactor round 3, A1 bug 3: the revenge is cancelled when the player takes Tessie; while she is played the page has no boat to read,
// and the drone, the ducked beds and the gloom must still fade out to rest (they used to hold their level for the whole visit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createRevenge } from '../sim/tessieRevenge.js';

const DT = 1 / 30, DEG = Math.PI / 180, deep = () => 40;
const view = (b) => ({ x: b.x - Math.sin(b.heading) * 32, z: b.z + Math.cos(b.heading) * 32, yaw: b.heading, hHalf: 0.6 });

test('cancelled by play, the revenge\'s drone, dip and gloom fade to rest with no boat to read', () => {
  const t = createTessie({ seed: 1, depthAt: deep }), R = createRevenge({ sim: t, depthAt: deep, mode: () => 'sail' });
  const far = { x: 0, z: 300, heading: 0, speed: 0 };
  t.step(DT, { playing: true, boat: far, view: view(far) });
  t.ambush(0, -200, Math.PI / 2, TESSIE.U); t.hunt(false);
  for (let k = 0; k < 7 / DT; k++) t.step(DT, { playing: true, boat: far, view: view(far) });
  const c = t.state.centre, psi = t.state.nose.psi;
  const bx = c[0] + Math.cos(psi) * 35, bz = c[1] + Math.sin(psi) * 35, toHer = Math.atan2(c[0] - bx, -(c[1] - bz));
  let b = { x: bx, z: bz, heading: toHer, speed: 3, heel: -0.1 };
  for (let k = 0; k < 3 / DT; k++) { t.step(DT, { playing: true, boat: b, view: view(b) }); R.step(DT, { boat: b, playing: true }); }
  assert.ok(R.active && R.state.drone > 0.5 && R.state.gloom > 0.5, `a revenge under way: drone ${R.state.drone.toFixed(2)}`);
  R.cancel('play');   // the player takes her (living/tessie.js)
  // played: the page steps the revenge with no boat
  for (let k = 0; k < 20 / DT; k++) { t.step(DT, { playing: true, boat: null, view: null }); R.step(DT, { boat: null, playing: true }); }
  assert.ok(R.state.drone < 0.01 && R.state.dip < 0.01 && R.state.gloom < 0.01, `faded: drone ${R.state.drone.toFixed(3)} dip ${R.state.dip.toFixed(3)} gloom ${R.state.gloom.toFixed(3)}`);
});
