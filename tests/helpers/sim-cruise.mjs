// Cruise's live path in node for the determinism record: the page's physics loop (src/modes/chill/index.js sailFor →
// helm.js: the navigator plans, the AI skipper sails, one 1/60 s tick at a time from the frame's accumulator; main's
// fixture was recorded from sailFor's own loop, copied here, at 2f3a967) on the real
// terrain, the real Tahoe wind at Cruise's hour and the real bottom (src/boat/ground.js), at a jittery wall clock
// (sim-record.mjs FRAME_DTS), until 120 s of sim time. Each tick is recorded (sim-record.mjs).
import { chillWorld } from '../../src/modes/chill/sim.js';
import { chooseStart, scenicRoute, Navigator } from '../../src/sim/modes/chill/navigator.js';
import { CruisePilot } from '../../src/sim/modes/chill/pilot.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { BoatPhysics, CONTROLS } from '../../src/sim/boat.js';
import { createGround } from '../../src/sim/boat/ground.js';
import { groundTerrain } from '../../src/sim/boat/groundTerrain.js';
import { analyticSun } from '../../src/sim/timeOfDay.js';
import { createCruiseHelm } from '../../classic/src/modes/chill/helm.js';
import { clampFrame } from '../../src/sim/sail/stepper.js';
import { createSimulation } from '../../src/sim/sail/simulation.js';
import { DT } from '../../src/sim/boat.js';
import { recorder, frameDt } from './sim-record.mjs';

const DEG = Math.PI / 180;
export const CRUISE_SECONDS = 120;
const worlds = new Map();

export function cruiseSetup(seed) {
  const hour = parseFloat(CHILL.hour);
  if (!worlds.has(seed)) worlds.set(seed, chillWorld({ seed, hour }));
  const W = worlds.get(seed), { terrain, wind, chart, traffic, clock } = W;
  const w0 = wind.sample(CHILL.start.x, CHILL.start.z, 0);
  const S = chooseStart(chart, { seed, traffic, t0: 0, windFrom: Math.atan2(-w0.vx, w0.vz) });
  const phys = new BoatPhysics({ x: S.x, z: S.z, heading: S.headingDeg * DEG, speed: S.speed });
  const nav = new Navigator({ chart, route: scenicRoute(chart, { seed }), seed });
  nav.pickNearest(phys.state.x, phys.state.z);
  const ground = createGround(groundTerrain(terrain));
  // assemble.js's env, without the GPU's sea
  const env = (t) => ({ t, ext: ground.ext, post: ground.post, windAt: (x, z, tt) => { const w = wind.sample(x, z, tt); return { vx: w.vx, vz: w.vz }; } });
  const pilot = new CruisePilot({ nav, skill: 1, seed, windAt: (x, z, t) => env(t).windAt(x, z, t) });
  const sunElevDeg = (t) => Math.asin(analyticSun(((clock(t) % 24) + 24) % 24).y) / DEG;
  return { phys, nav, pilot, env, traffic, ground, sunElevDeg, ctl: { ...CONTROLS } };
}

export function runCruise({ seed = 1, seconds = CRUISE_SECONDS, keepInputs = false } = {}) {
  const { phys, pilot, nav, env, traffic, sunElevDeg, ctl } = cruiseSetup(seed);
  const rec = recorder(), inputs = [];
  const start = { x: phys.state.x, z: phys.state.z, heading: phys.state.heading, speed: phys.state.u };
  const speed = CHILL.simSpeed;
  let sun = 0, i = 0;
  // the page's helm (src/modes/chill/index.js sailFor → helm.js): the recorder sees each tick's controls and state
  const step = phys.step.bind(phys);
  phys.step = (dt, c, e) => { if (keepInputs) inputs.push({ t: e.t, ctl: { ...c } }); const out = step(dt, c, e); rec.tick(out, e.t); return out; };
  const helm = createCruiseHelm({ phys, pilot, nav, ctl, env, traffic, sunElevDeg: () => sun, t0: 0 });
  while (helm.sim.t < seconds) {
    const dt = clampFrame(frameDt(i++));
    sun = sunElevDeg(helm.sim.t);   // the page's core.sun, once a frame
    helm.advance(dt * speed);
  }
  return { ...rec.out(), start, frames: i, ...(keepInputs ? { inputs, seed } : {}) };
}

// The pure Simulation on a run's inputs (the pilot's controls each tick): no navigator, no skipper; the same start, the
// same world (the wind, a fresh bottom), one step(DT, inputs) a tick. at: stop after this many ticks (the sim returned too,
// to snapshot: tests/helpers/sim-snapshots.mjs)
export function replayCruise(run, { at = Infinity } = {}) {
  const { env } = cruiseSetup(run.seed), rec = recorder();
  const sim = createSimulation({ boat: { start: run.start, env }, t0: 0 });
  for (let i = 0; i < run.inputs.length && i < at; i++) { const inp = run.inputs[i]; sim.step(DT, inp.ctl); rec.tick(sim.state, inp.t); }
  return { ...rec.out(), sim };
}
