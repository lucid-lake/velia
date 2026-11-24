// Regatta's session in node for the determinism record: src/modes/regatta/session.js with both boats sailed by the AI
// (?autoplay=1: the pro skipper on ours, the rival at its tier), the Island Sprint, Sail's Tahoe day wind at the race's
// 15:00 (level 3, the gust cells, the shifts), at a jittery wall clock (sim-record.mjs FRAME_DTS) as the mode's
// autoplay update feeds it, until 120 s of sim time. Each tick of each boat is recorded (sim-record.mjs).
import { BoatPhysics } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { courseFor } from '../../src/sim/race/course.js';
import { startPoses } from '../../src/sim/race/sim.js';
import { createSession } from '../../classic/src/modes/regatta/session.js';
import { createSimulation } from '../../src/sim/sail/simulation.js';
import { shadowed } from '../../src/sim/race/dirtyAir.js';
import { DT } from '../../src/sim/boat.js';
import { recorder, frameDt } from './sim-record.mjs';

export const REGATTA_SECONDS = 120;
const DEG = Math.PI / 180;

export function regattaSetup({ seed = 1, tier = 'medium' } = {}) {
  const course = courseFor('tahoe-emerald', 'island-sprint');
  const wind = new WindField({ seed, day: { hour: 15, rate: 1 }, level: 3, cells: true, shifts: true });
  const baseWind = (x, z, t) => { const w = wind.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const layout = { a: [0.85, 0.15] };
  const [a, b] = startPoses(course, course.designWindFrom * DEG, ['me', 'wren'], layout);
  const mk = (p) => new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed });
  return { course, baseWind, layout, seed, tier, me: mk(a), wren: mk(b) };
}

export function runRegatta({ seed = 1, tier = 'medium', seconds = REGATTA_SECONDS, keepInputs = false } = {}) {
  const S = regattaSetup({ seed, tier });
  const recMe = recorder(), recWren = recorder(), inputs = [];
  const hook = (phys, rec, id) => (dt, ctl, t, windAt) => {
    if (keepInputs) inputs.push({ id, t, ctl: { ...ctl } });
    phys.step(dt, ctl, { t, windAt }); rec.tick(phys.state, t);
  };
  const session = createSession({ course: S.course, baseWind: S.baseWind, layout: S.layout, seed, tier, autoplay: true,
    me: { phys: S.me, step: hook(S.me, recMe, 'me') }, wren: { phys: S.wren, step: hook(S.wren, recWren, 'wren') } });
  let i = 0;
  while (session.sim < seconds) session.step(Math.min(frameDt(i++), 0.1));
  const out = { me: recMe.out(), wren: recWren.out(), frames: i, clock: session.race.clock, events: session.log.length };
  return keepInputs ? { ...out, inputs, seed, tier } : out;
}

// The pure Simulation on a run's inputs (both brains' controls each tick): no rules, no brains; the same starts, the same
// wind with each boat in the other's dirty air, the fleet's clock as the session's ('end'), one step(DT, inputs) a tick
export function regattaFleet(run) {
  const S = regattaSetup({ seed: run.seed, tier: run.tier });
  const meWind = shadowed(S.baseWind, () => [S.wren.state]), wrenWind = shadowed(S.baseWind, () => [S.me.state]);
  const sim = createSimulation({ clock: 'end', boats: [{ id: 'me', phys: S.me, env: (t) => ({ t, windAt: meWind }) }, { id: 'wren', phys: S.wren, env: (t) => ({ t, windAt: wrenWind }) }] });
  return { sim, S, envs: { me: (t) => ({ t, windAt: meWind }), wren: (t) => ({ t, windAt: wrenWind }) } };
}
// at: stop after this many ticks (the fleet's sim returned too, to snapshot: tests/helpers/sim-snapshots.mjs)
export function replayRegatta(run, { at = Infinity } = {}) {
  const { sim, S } = regattaFleet(run), me = recorder(), wren = recorder();
  for (let i = 0; i < run.inputs.length && i / 2 < at; i += 2) {
    const a = run.inputs[i], b = run.inputs[i + 1];
    sim.step(DT, { [a.id]: a.ctl, [b.id]: b.ctl });
    me.tick(S.me.state, a.t); wren.tick(S.wren.state, b.t);
  }
  return { me: me.out(), wren: wren.out(), sim };
}
