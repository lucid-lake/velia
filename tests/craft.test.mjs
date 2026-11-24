// The craft seam (refactor round 2, Phase C step 5): the Simulation
// builds and restores each boat's physics through its profile's craft (src/craft/index.js), so a second craft steps
// where the sloop does. The sloop's bytes are gated by tests/sim-snapshots.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRAFTS, CRAFT_VESSELS, craftOf, craftById, vesselFor } from '../src/sim/craft/index.js';
import { createSimulation, restoreSimulation, encodeState, decodeState } from '../src/sim/sail/simulation.js';
import { BoatPhysics, CONTROLS } from '../src/sim/boat.js';
import { CURRENT_VESSEL } from '../src/sim/vessels/current.js';
import { VESSELS } from '../src/sim/vessels/index.js';
import { KayakPhysics } from '../src/sim/craft/kayak/physics.js';

const START = { x: 10, z: -20, heading: 1, speed: 2 };
const env = (t) => ({ t, windAt: () => ({ vx: 3, vz: -4 }) });

test('the sloop is the default craft; an unknown craft throws, naming it', () => {
  assert.equal(craftOf(CURRENT_VESSEL).id, 'sloop');
  assert.equal(craftOf({ id: 'x' }).id, 'sloop', 'no craft field: a sloop');
  assert.equal(craftById('sloop'), CRAFTS.sloop);
  assert.equal(CRAFTS.sloop.kind, 'sail');
  assert.equal(CRAFTS.sloop.inputs, CONTROLS);
  assert.throws(() => craftOf({ craft: 'zeppelin' }), /zeppelin/);
  assert.throws(() => craftById('toString'), /toString/, 'no prototype key passes as a craft');
});

test('vesselFor: this page\'s boat by default and by its id; no craft-local id shadows a shipped boat', () => {
  assert.equal(vesselFor(null), CURRENT_VESSEL);
  assert.equal(vesselFor(CURRENT_VESSEL.id), CURRENT_VESSEL);
  for (const id of Object.keys(CRAFT_VESSELS)) assert.ok(!VESSELS.some((v) => v.id === id), `${id} is not a shipped vessel`);
  assert.equal(vesselFor('kayak').craft, 'kayak', 'the kayak\'s own profile');
  assert.equal(craftOf(vesselFor('kayak')), CRAFTS.kayak);
});

test('createSimulation builds the profile\'s craft: a BoatPhysics on this page\'s boat at the start pose', () => {
  const sim = createSimulation({ boat: { start: START, env } });
  assert.ok(sim.phys instanceof BoatPhysics);
  assert.equal(sim.phys.vessel, CURRENT_VESSEL);
  assert.deepEqual([sim.phys.state.x, sim.phys.state.z, sim.phys.state.heading, sim.phys.state.u], [10, -20, 1, 2]);
});

test('a sloop snapshot restores a BoatPhysics that steps on bit for bit', () => {
  const a = createSimulation({ boat: { start: START, env } });
  a.step(5, { ...CONTROLS, rudder: 0.2, engine: true });
  const b = restoreSimulation(decodeState(encodeState(a.snapshot())), { boat: { env } });
  assert.ok(b.phys instanceof BoatPhysics);
  assert.equal(b.phys.vessel, CURRENT_VESSEL);
  assert.ok(b.phys.engine.on, 'the engine keeps its class and its state');
  a.step(5, { ...CONTROLS, rudder: -0.1 }); b.step(5, { ...CONTROLS, rudder: -0.1 });
  assert.equal(encodeState(b.snapshot()), encodeState(a.snapshot()));
});

test('the seam bites: a snapshot whose vesselId names the kayak restores a KayakPhysics, not a BoatPhysics', () => {
  const sloop = createSimulation({ boat: { start: START, env } });
  sloop.step(1, CONTROLS);
  const data = decodeState(encodeState(sloop.snapshot()));
  const k = new KayakPhysics({ x: 3, z: 4, heading: 0.2, speed: 1 });
  k.step(1, { throttle: 0.5, turn: 0 }, env(0));
  const ks = createSimulation({ boat: { phys: k, env } }).snapshot();
  assert.equal(ks.boats[0].physics.vesselId, 'kayak');
  const r = restoreSimulation(decodeState(encodeState(ks)), { boat: { env } });
  assert.ok(r.phys instanceof KayakPhysics);
  assert.ok(!(r.phys instanceof BoatPhysics));
  assert.equal(r.phys.state.x, k.state.x);
  assert.ok(restoreSimulation(data, { boat: { env } }).phys instanceof BoatPhysics, 'and a sloop stays a sloop');
});
