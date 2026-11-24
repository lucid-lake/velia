// The pure Simulation (src/sail/simulation.js) and the shared stepper (src/sail/stepper.js): the stepper's semantics, and
// multiplayer-readiness: the state serialised (JSON text), restored into a new Simulation and stepped gives the same next
// state as the original, bit for bit, and goes on to main's recorded run (tests/fixtures/sim-*.json).
import './helpers/terrain-small.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStepper, clampFrame, FRAME_MAX } from '../src/sim/sail/stepper.js';
import { createSimulation, restoreSimulation, encodeState, decodeState } from '../src/sim/sail/simulation.js';
import { createTackle } from '../src/sim/boat/tackle.js';
import { CONTROLS, DT, steadyWind } from '../src/sim/boat.js';
import { runSail, replaySail } from './helpers/sim-sail.mjs';
import { runRegatta, regattaFleet } from './helpers/sim-regatta.mjs';
import { fixture } from './helpers/cases-sim.mjs';
import { firstDiff, recorder } from './helpers/sim-record.mjs';

test('the stepper: whole ticks, the remainder carried, alpha = remainder × 60 as the modes computed it', () => {
  const st = createStepper();
  let n = 0, m = 0, acc = 0;
  for (const d of [1 / 144, 1 / 30, 0.05, 1 / 90, 0.1, 1 / 60, 1 / 60, 0.0001]) {
    st.advance(d, () => n++);
    acc += d; while (acc >= 1 / 60) { m++; acc -= 1 / 60; }   // main's loop (src/sail/controls.js at 2f3a967)
    assert.ok(Object.is(st.acc, acc) && Object.is(st.alpha, acc * 60), `acc ${st.acc} vs ${acc}`);
  }
  assert.equal(n, m);
  assert.equal(1 / (1 / 60), 60);
  // a cap drops the backlog and keeps the remainder under a tick
  const cap = createStepper({ maxSteps: 3 });
  assert.equal(cap.advance(0.5, () => {}), 3);
  assert.ok(cap.acc < DT && cap.alpha < 1);
  assert.equal(clampFrame(0.25), FRAME_MAX); assert.equal(clampFrame(0.02), 0.02);
});

test('plain data: −0, ±Infinity and NaN keep their bits through the JSON text', () => {
  const d = decodeState(encodeState({ a: -0, b: Infinity, c: -Infinity, d: NaN, e: [0, -0], f: { $n: 1 } }));
  assert.ok(Object.is(d.a, -0) && d.b === Infinity && d.c === -Infinity && Number.isNaN(d.d) && Object.is(d.e[1], -0));
  assert.deepEqual(d.f, { $n: 1 });
});

const K = 4300;   // 72 s in: under engine at full ahead with the sails down, a reef in, pro trim set, the wind's level-4 front in flight
test('Sail: serialise the state at 72 s, restore it, step: the same next state, then main\'s run to the end', () => {
  const run = runSail({ seed: 1, keepInputs: true });
  const a = replaySail(run, { at: K }), b = replaySail(run, { at: K });   // two copies of the world, up to the same tick
  const text = encodeState(a.sim.snapshot());
  assert.equal(typeof JSON.parse(text).boats[0].physics.state.x, 'number');
  assert.ok(a.sim.phys.engine.on, 'the engine is running');
  assert.ok(a.sim.state.furl > 0.5, 'the sails are down');
  const c = restoreSimulation(decodeState(text), { boat: b.envFor() });
  assert.equal(encodeState(c.snapshot()), text, 'the restored state reads back the same');
  const a1 = replaySail(run, { from: a.sim, wind: a.wind, at: K + 1 }), c1 = replaySail(run, { from: c, wind: b.wind, at: K + 1 });
  assert.equal(c1.rows, a1.rows);
  assert.equal(encodeState(c.snapshot()), encodeState(a.sim.snapshot()), 'the whole next state, bit for bit');
  const rest = replaySail(run, { from: c, wind: b.wind });
  const want = fixture('sail')[1];
  assert.equal(rest.rows, want.rows.slice((K + 1) * 8), 'on to 120 s as main sailed it');
});

test('Regatta: the two-boat fleet serialised mid-race steps on as the original', () => {
  const run = runRegatta({ seed: 1, tier: 'medium', keepInputs: true });
  const A = regattaFleet(run), B = regattaFleet(run);
  const at = 2 * K;   // inputs come in pairs (ours, the rival's)
  const feed = (sim, from, to) => { for (let i = from; i < to; i += 2) sim.step(DT, { [run.inputs[i].id]: run.inputs[i].ctl, [run.inputs[i + 1].id]: run.inputs[i + 1].ctl }); };
  feed(A.sim, 0, at);
  const C = restoreSimulation(decodeState(encodeState(A.sim.snapshot())), { boats: [{ id: 'me', env: B.envs.me }, { id: 'wren', env: B.envs.wren }] });
  // B's winds read B's boats (the dirty air): point them at C's restored ones
  B.S.me = C.boat('me').phys; B.S.wren = C.boat('wren').phys;
  feed(A.sim, at, at + 2); feed(C, at, at + 2);
  assert.equal(encodeState(C.snapshot()), encodeState(A.sim.snapshot()));
  feed(A.sim, at + 2, run.inputs.length); feed(C, at + 2, run.inputs.length);
  assert.equal(encodeState(C.snapshot()), encodeState(A.sim.snapshot()), 'to 120 s');
  assert.equal(C.ticks, fixture('regatta')[1].wren.ticks);
});

test('the anchor as an input: dropped, holding; serialised with the tackle, the restored boat swings as the original', () => {
  const env = (t) => ({ t, windAt: steadyWind(5, 200) });
  const make = () => createSimulation({ boat: { start: { x: 400, z: 400, heading: 0.3, speed: 0.4 }, env, tackle: createTackle({ depthAt: () => 8 }) } });
  const inputs = (i) => ({ ...CONTROLS, furl: 1, anchor: i >= 120 ? true : null });
  const a = make(), whole = make(), rec = recorder();
  for (let i = 0; i < 1800; i++) { a.step(DT, inputs(i)); whole.step(DT, inputs(i)); }
  assert.equal(a.boat('boat').tackle.mode, 'anchor');
  const c = restoreSimulation(decodeState(encodeState(a.snapshot())), { boat: { env, tackle: createTackle({ depthAt: () => 8 }) } });
  assert.equal(c.boat('boat').tackle.state.anchor.phase, a.boat('boat').tackle.state.anchor.phase);
  for (let i = 1800; i < 3600; i++) { c.step(DT, inputs(i)); whole.step(DT, inputs(i)); rec.tick(c.state, c.t); }
  assert.equal(encodeState(c.snapshot()), encodeState(whole.snapshot()));
  assert.ok(Math.hypot(c.state.x - 400, c.state.z - 400) < 60, 'held on its rode');
  // weighed: the input goes false
  c.step(DT, { ...inputs(0), anchor: false });
  assert.notEqual(c.boat('boat').tackle.state.anchor.phase, 'held');
  assert.equal(firstDiff(rec.out(), rec.out()), null);
});
