// A headless sail with the AI skipper on the real physics (tests/aiSkipper.test.mjs, tools).
import { BoatPhysics, CONTROLS, DT, KN } from '../../src/sim/boat.js';
import { AISkipper, polarTargets } from '../../src/sim/ai/skipper.js';

export const DEG = Math.PI / 180;

// windAt(x, z, t) → { vx, vz }; a wind FROM fromDeg at kn knots, with an optional shift(t) in degrees and gust(x, z, t) factor
export function windFn({ kn = 12, fromDeg = 0, shift = () => 0, gust = () => 1 } = {}) {
  return (x, z, t) => {
    const f = (fromDeg + shift(t, x, z)) * DEG, v = kn * KN * gust(x, z, t);
    return { vx: -Math.sin(f) * v, vz: Math.cos(f) * v };
  };
}

// sail to a waypoint (or a route); returns the log. stop: (s, t) => bool
export function sail({ windAt, skill = 1, seed = 1, start = [0, 0], heading = -42 * DEG, speed = 2.5, wp = [0, -2000], seconds = 1500, stop = null, onTick = null, clear = null, params = {}, autoReef = true } = {}) {
  const phys = new BoatPhysics({ x: start[0], z: start[1], heading, speed, params });
  const sk = new AISkipper({ skill, seed, windAt, clear });
  const ctl = { ...CONTROLS, autoReef };
  const env = { t: 0, windAt };
  const n = Math.round(seconds / DT);
  const log = { t: 0, tacks: [], maxHeel: 0, track: [], reached: false, rep: null };
  let lastSide = 0, maxHeelT = 0;
  for (let i = 0; i < n; i++) {
    const t = i * DT; env.t = t;
    const rep = sk.update(DT, phys.state, ctl, { t, waypoint: wp, legKey: 'wp' });
    const s = phys.step(DT, ctl, env);
    const side = Math.sign(s.trueWind.angle);
    if (lastSide && side !== lastSide && Math.abs(s.trueWind.angle) < 90 * DEG) log.tacks.push(t);
    lastSide = side || lastSide;
    log.maxHeel = Math.max(log.maxHeel, Math.abs(s.heel)); if (Math.abs(s.heel) >= log.maxHeel) maxHeelT = t;
    if (i % 60 === 0) log.track.push([s.x, s.z, s.u]);
    onTick?.(t, s, sk, ctl);
    log.t = t; log.rep = rep;
    if (Math.hypot(s.x - wp[0], s.z - wp[1]) < 60) { log.reached = true; break; }
    if (stop?.(s, t)) break;
  }
  log.state = phys.state; log.sk = sk; log.maxHeelT = maxHeelT;
  return log;
}
export { polarTargets, KN };

// the crew's boat for comparison: auto-trim, the helm on the best close-hauled angle (no pro hands)
import { Helm } from '../../src/sim/boat.js';
export function crewBoat({ windAt, seconds = 120, heading = -42 * DEG, speed = 2.5, twaDeg = 42, fromDeg = 0 } = {}) {
  const phys = new BoatPhysics({ x: 0, z: 0, heading, speed }), h = new Helm(), ctl = { ...CONTROLS }, env = { t: 0, windAt };
  let maxHeel = 0;
  for (let i = 0; i < seconds / DT; i++) {
    env.t = i * DT;
    const s = phys.step(DT, { ...ctl, rudder: h.toTWA(phys.state, twaDeg * DEG, fromDeg * DEG) }, env);
    maxHeel = Math.max(maxHeel, Math.abs(s.heel));
  }
  return { maxHeel, state: phys.state };
}
