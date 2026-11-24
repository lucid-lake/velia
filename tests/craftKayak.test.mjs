// The kayak craft (refactor round 2, Phase C step 5): KayakPhysics is the
// lake fleet's hull model behind the Simulation's interface. Parity with a bare fleet agent bit for bit, a snapshot round
// trip that steps on bit for bit, the hull's numbers from the profile, and the sloop-only commands ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KayakPhysics, KAYAK_INPUTS } from '../src/sim/craft/kayak/physics.js';
import { CRAFTS, vesselFor } from '../src/sim/craft/index.js';
import { stepHull, HULL, GAIT } from '../src/sim/kayaks/agent.js';
import { targetWeights } from '../src/sim/props/paddler/motion.js';
import { createSimulation, restoreSimulation, encodeState, decodeState } from '../src/sim/sail/simulation.js';

const KAYAK = vesselFor('kayak');
const env = (t) => ({ t });
// the intent script (s → intent): rest, cruise, sprint, a sweep, back, a cruise with a turn, rest
const SCRIPT = [[0, 0, 0], [2, 0.5, 0], [60, 1, 0], [120, 0, -1], [180, -0.6, 0], [240, 0.5, 0.7], [420, 0, 0]];
const intentAt = (s) => { let r = SCRIPT[0]; for (const e of SCRIPT) if (e[0] <= s) r = e; return { throttle: r[1], turn: r[2] }; };

test('parity: a KayakPhysics and a bare fleet agent on one intent script, 36,000 ticks bit for bit', () => {
  const k = new KayakPhysics({ x: 5, z: -7, heading: 0.3, speed: 0 });
  const w = Object.fromEntries(Object.keys(GAIT).map((g) => [g, targetWeights({ throttle: 0, turn: 0 })[g] ?? 0]));
  const a = { x: 5, z: -7, heading: 0.3, v: 0, r: 0, w, wm: { ...w }, phase: 0, intent: { throttle: 0, turn: 0 }, turning: 0 };
  let moved = 0, turned = 0;
  for (let i = 0; i < 36000; i++) {
    const it = intentAt(i / 60);
    k.step(1 / 60, it, env(i / 60));
    stepHull(a, 1 / 60, { ...it });
    for (const f of ['x', 'z', 'heading', 'v', 'r', 'phase']) if (!Object.is(k.a[f], a[f])) assert.fail(`tick ${i}: ${f} ${k.a[f]} != ${a[f]}`);
    moved = Math.max(moved, Math.abs(a.v)); turned = Math.max(turned, Math.abs(a.r));
  }
  assert.ok(moved > 1.5 && turned > 0.1, `the script exercises the hull (v up to ${moved.toFixed(2)} m/s, r up to ${turned.toFixed(3)} rad/s)`);
  assert.equal(k.state.x, a.x); assert.equal(k.state.u, a.v); assert.equal(k.state.yawRate, a.r);
});

test('round trip: a kayak Simulation snapshot restores a KayakPhysics that steps on bit for bit', () => {
  const sim = createSimulation({ boat: { start: { x: 1, z: 2, heading: 0.5, speed: 0.4 }, env, vessel: KAYAK } });
  assert.ok(sim.phys instanceof KayakPhysics);
  for (let i = 0; i < 600; i++) sim.step(1 / 60, intentAt(i / 10));
  const data = sim.snapshot();
  assert.equal(data.boats[0].physics.vesselId, 'kayak');
  const again = restoreSimulation(decodeState(encodeState(data)), { boat: { env } });
  assert.ok(again.phys instanceof KayakPhysics, 'the snapshot names its craft through vesselId');
  assert.equal(again.phys.vessel, KAYAK);
  for (let i = 600; i < 1200; i++) { const it = intentAt(i / 10); sim.step(1 / 60, it); again.step(1 / 60, it); }
  assert.equal(encodeState(again.snapshot()), encodeState(sim.snapshot()));
});

test('the hull model\'s numbers come from the kayak\'s profile', () => {
  assert.deepEqual({ ...HULL }, { M: 108, K: 7.5, C: 6, I: 120, D: 140 });
  assert.deepEqual(KAYAK.physics, { ...HULL });
  assert.equal(CRAFTS.kayak.kind, 'paddle');
  assert.equal(CRAFTS.kayak.inputs, KAYAK_INPUTS);
});

test('the sloop-only commands (engine, anchor) are skipped on a kayak', () => {
  const sim = createSimulation({ boat: { start: { speed: 1 }, env, vessel: KAYAK } });
  assert.doesNotThrow(() => sim.step(1 / 60, { engine: true, anchor: true }));
  assert.doesNotThrow(() => sim.step(1 / 60, { engine: false, anchor: false, throttle: 0.5 }));
  assert.equal(sim.phys.engine, undefined);
});
