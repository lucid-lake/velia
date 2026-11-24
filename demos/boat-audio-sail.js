// The scripted sail for the boat-sound demo and tests: the real physics (src/boat.js) on a scripted wind and helm.
// Wind from the north. 0–20 s a calm beam reach in baseKn; 20–23 s a gust builds by gustKn, holds to 31 s, eases by
// 35 s; 40 s the helm heads up (close-hauled by ≈44 s), 44 s it puts the bow through the wind and stalls head to
// wind (the sails flog), then bears away onto the new tack (the sails refill and snap). Chop on the water grows with
// the wind (two crossing wave trains), so the bow slaps. Plain JS: node runs it (tests/boatAudio.test.mjs).
import { BoatPhysics, Helm, CONTROLS, KN, DT } from '../src/sim/boat.js';

const DEG = Math.PI / 180;
const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export const SCRIPT = { seconds: 80, gust: [20, 23, 31, 35], headUp: 40, tack: 44, newTack: 47 };

export function twsKnAt(t, { baseKn = 8, gustKn = 8 } = {}) {
  const [a, b, c, d] = SCRIPT.gust;
  return baseKn + gustKn * (ramp(t, a, b) - ramp(t, c, d));
}

// waves: two trains (6 m and 9 m long, crossing at 40°), height growing with the wind (3 → 8 m/s)
export function chopAt(x, z, t, twsMs) {
  const amp = 0.03 + 0.06 * Math.min(1, Math.max(0, (twsMs - 3) / 5));
  let y = 0, nx = 0, nz = 0;
  for (const [L, dir, a, ph] of [[6, 180, 1, 0], [9, 220, 0.7, 1.3]]) {
    const k = 2 * Math.PI / L, w = Math.sqrt(9.81 * k), dx = Math.sin(dir * DEG), dz = -Math.cos(dir * DEG);
    const p = k * (x * dx + z * dz) - w * t + ph, A = amp * a;
    y += A * Math.sin(p);
    nx -= A * k * Math.cos(p) * dx; nz -= A * k * Math.cos(p) * dz;
  }
  return { y, nx, nz };
}

// Frames at `hz` (default 60): { t, s (a copy of the state fields the sound reads), camDist, twsKn }.
export function scriptedSail({ baseKn = 8, gustKn = 8, hz = 60, camM = 35, chop = true } = {}) {
  const windAt = (x, z, t) => ({ vx: 0, vz: twsKnAt(t, { baseKn, gustKn }) * KN });   // toward the south: from the north
  const env = { windAt, t: 0, ...(chop ? { waveAt: (x, z, t) => chopAt(x, z, t, twsKnAt(t, { baseKn, gustKn }) * KN) } : {}) };
  const boat = new BoatPhysics({ heading: -100 * DEG, speed: 4 * KN });
  const helm = new Helm();
  // the target true wind angle (+ = wind from starboard): the reach, heading up, head to wind, the new tack
  const twaAt = (t) => t < SCRIPT.headUp ? 100 * DEG : t < SCRIPT.tack ? 50 * DEG : t < SCRIPT.newTack ? 0 : -60 * DEG;
  const frames = [], every = Math.max(1, Math.round(1 / DT / hz));
  for (let i = 0, n = Math.round(SCRIPT.seconds / DT); i < n; i++) {
    env.t = i * DT;
    const s = boat.step(DT, { ...CONTROLS, rudder: helm.toHeading(boat.state, -twaAt(env.t)) }, env);
    if (i % every === 0) {
      frames.push({
        t: env.t + DT, twsKn: twsKnAt(env.t, { baseKn, gustKn }), camDist: camM + 0.08 * 9.1 * s.sog,
        s: { sog: s.sog, heel: s.heel, pitch: s.pitch, mainFill: s.mainFill, jibFill: s.jibFill, drive: s.drive, side: s.side, heelMoment: s.heelMoment,
          rudderAngle: s.rudderAngle, mainSheet: s.mainSheet, apparentWind: { ...s.apparentWind }, trueWind: { ...s.trueWind }, x: s.x, z: s.z },
      });
    }
  }
  return frames;
}

// The script's events as the physics played them: the gust window, and head to wind (|AWA| < 25°) from first to last.
export function marks(frames) {
  const htw = frames.filter((f) => Math.abs(f.s.apparentWind.angle) < 25 * DEG && f.t > SCRIPT.tack);
  return { gust: SCRIPT.gust, headToWind: htw.length ? [htw[0].t, htw.at(-1).t] : null };
}
