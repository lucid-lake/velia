// fix/ios-start: a NaN from the water (a GPU read-back gone wrong) must not freeze the boat for good
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, stateFinite } from '../src/sim/boat.js';

const env = () => ({ t: 0, windAt: () => ({ vx: 0, vz: 5 }) });

test('a tick that makes NaN keeps the last good state, counts it, and the boat sails on after', () => {
  const b = new BoatPhysics({ x: 0, z: 0, heading: Math.PI / 2, speed: 3 });
  const e = env();
  b.step(1, CONTROLS, e);
  const before = { x: b.state.x, z: b.state.z };
  // force a non-number the way a broken surface would
  const tick = b.tick.bind(b); b.tick = (c, en) => { tick(c, en); b.state.u = NaN; b.state.x = NaN; };
  b.step(0.5, CONTROLS, e);
  assert.ok(stateFinite(b.state), JSON.stringify({ x: b.state.x, u: b.state.u }));
  assert.ok(b.nanTrips > 0);
  b.tick = tick;
  b.step(3, CONTROLS, e);
  assert.ok(Math.hypot(b.state.x - before.x, b.state.z - before.z) > 3, 'the boat moves again');
});

test('a finite run is the same with the guard (bit for bit)', () => {
  const a = new BoatPhysics({ x: 5, z: -3, heading: 1, speed: 2.5 });
  for (let i = 0; i < 600; i++) a.step(1 / 60, CONTROLS, env());
  assert.ok(stateFinite(a.state)); assert.equal(a.nanTrips ?? 0, 0);
});
