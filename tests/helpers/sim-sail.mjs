// Sail's live path in node for the determinism record: the real attachControls (as tests/helpers/sail-controls.mjs mounts
// it) on the real Tahoe day wind field (level 3, the gust cells, the shifts), keys pressed on a script, frames at a
// jittery wall clock (sim-record.mjs FRAME_DTS), until 120 s of sim time. Each physics tick is recorded (sim-record.mjs),
// with the controls it ran on, so the pure Simulation can replay them (tests/sim-determinism.test.mjs).
import './terrain-small.mjs';
import { mountSail } from './sail-controls.mjs';
import { WindField } from '../../src/sim/wind.js';
import { createSimulation, encodeState } from '../../src/sim/sail/simulation.js';
import { createTackle } from '../../src/sim/boat/tackle.js';
import { DT } from '../../src/sim/boat.js';
import { recorder, frameDt } from './sim-record.mjs';

export const SAIL_SECONDS = 120;
// [wall-clock second, key, down?]: the helm, the sheets, the wind level, a reef, a tack, the engine and the throttle, the
// sails down and up, pro trim (traveller, twist, backstay, jib lead), wing-on-wing
export const SAIL_SCRIPT = [
  [2, 'KeyD', true], [4, 'KeyD', false], [5, 'KeyW', true], [8, 'KeyW', false], [9, 'KeyS', true], [10.5, 'KeyS', false],
  [12, 'Digit4', true], [12.1, 'Digit4', false], [14, 'KeyA', true], [15.5, 'KeyA', false], [17, 'KeyK', true], [17.1, 'KeyK', false],
  [20, 'Space', true], [20.1, 'Space', false], [27, 'KeyI', true], [27.1, 'KeyI', false], [30, 'Equal', true], [31, 'Equal', false],
  [33, 'KeyY', true], [33.1, 'KeyY', false], [38, 'Digit0', true], [38.1, 'Digit0', false], [40, 'KeyY', true], [40.1, 'KeyY', false],
  [42, 'KeyR', true], [43, 'KeyR', false], [44, 'KeyQ', true], [45, 'KeyQ', false], [46, 'KeyZ', true], [47, 'KeyZ', false],
  [48, 'KeyX', true, { shiftKey: true }], [49, 'KeyX', false, { shiftKey: true }], [50, 'KeyF', true], [51, 'KeyF', false],
  [52, 'KeyD', true], [56, 'KeyD', false], [57, 'KeyG', true], [57.1, 'KeyG', false], [58, 'Digit2', true], [58.1, 'Digit2', false],
];

// seed: the wind field's; pro: starts in pro (?pro=1, so Q/E Z/X R/F are the trim)
const sailWind = (seed) => new WindField({ seed, day: { hour: 18.75, rate: 1 }, level: 3, cells: true, shifts: true });
const worldEnv = (wind) => (t) => ({ t, windAt: (x, z, tt) => { const w = wind.sample(x, z, tt); return { vx: w.vx, vz: w.vz }; } });

// keepInputs: also each tick's inputs (the controls, the engine on or off) and the world's events by tick (the wind's level
// and listener calls), for replaySail; liveSnap: also the live controls' own Simulation (c.sim) as encoded text at the end
// (tests/helpers/sim-snapshots.mjs)
export function runSail({ seed = 1, seconds = SAIL_SECONDS, script = SAIL_SCRIPT, keepInputs = false, liveSnap = false } = {}) {
  const wind = sailWind(seed);
  const s = mountSail({ params: 'pro=1', headingDeg: 70, wind, env: worldEnv(wind) });
  const rec = recorder(), inputs = [], world = [];
  if (keepInputs) for (const fn of ['setLevel', 'setListener']) { const f = wind[fn].bind(wind); wind[fn] = (...a) => { world.push({ tick: rec.rows.length, fn, args: structuredClone(a) }); return f(...a); }; }
  const phys = s.phys, step = phys.step.bind(phys);
  const start = { x: phys.state.x, z: phys.state.z, heading: phys.state.heading, speed: phys.state.u };
  phys.step = (dt, ctl, env) => {
    if (keepInputs) inputs.push({ t: env.t, ctl: { ...ctl, engine: phys.engine.on } });
    const out = step(dt, ctl, env);
    rec.tick(out, env.t);
    return out;
  };
  let wall = 0, k = 0, i = 0;
  const c = s.c;
  while (c.simT < seconds) {
    while (k < script.length && script[k][0] <= wall) { const [, code, down, extra] = script[k++]; s.key(code, down, extra ?? {}); }
    const dt = frameDt(i++);
    c.update(dt); s.dom.frame();
    wall += Math.min(0.1, dt);
  }
  const out = { ...rec.out(), start, frames: i, ...(liveSnap ? { liveSnap: encodeState(c.sim.snapshot()) } : {}) };
  s.dispose();
  return keepInputs ? { ...out, inputs, world, seed } : out;
}

// The pure Simulation (src/sail/simulation.js) on a run's inputs: no DOM, no controls; the same start, the same world (the
// wind field driven by the logged events, the tackle in the env as seamanship builds it), one step(DT, inputs) a tick.
// at: stop after this many ticks (the sim and its world returned, to snapshot); from: a restored sim to go on with;
// vessel: another boat's profile on the same inputs (the snapshot gate's negative control).
export function replaySail(run, { at = Infinity, from = null, wind: windIn = null, vessel = null } = {}) {
  const wind = windIn ?? sailWind(run.seed), rec = recorder();
  const sim = from ?? createSimulation({ boat: { start: run.start, env: worldEnv(wind), tackle: createTackle({ depthAt: () => 20 }), ...(vessel ? { vessel } : {}) }, t0: 0 });
  let w = 0;
  while (w < run.world.length && run.world[w].tick < sim.ticks) w++;
  for (let i = sim.ticks; i < run.inputs.length && i < at; i++) {
    for (; w < run.world.length && run.world[w].tick === i; w++) wind[run.world[w].fn](...structuredClone(run.world[w].args));
    sim.step(DT, run.inputs[i].ctl);
    rec.tick(sim.state, run.inputs[i].t);
  }
  return { ...rec.out(), sim, wind, envFor: () => ({ env: worldEnv(wind), tackle: createTackle({ depthAt: () => 20 }) }) };
}
