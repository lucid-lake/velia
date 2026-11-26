// A passing wave's roll on a BoatPhysics hull (play as Tessie's Tail Surge, the RPG): the hull carried from its heel to a target heel
// over riseS, held holdS, then let go over fallS (the righting arm brings her back up). Its own module, no Tessie code, so the busy
// lake and the boat (loaded on every device) never pull hers onto a phone. Pure: no clock of its own (u: s since the wave arrived).
//   const w = { heel }            the target (rad, signed as the heel: + starboard down); a hull already leaning that far that way: nothing
//   waveRollStep(w, u, phys, dt)  the roll rate's change this step (phys.p); false once the wave has passed
import { rightingArm } from '../../src/sim/boat.js';

export const WAVE_ROLL = Object.freeze({ riseS: 0.5, holdS: 0.6, fallS: 0.9, hz: 1.6, zeta: 0.85 });
const sm = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function waveRollStep(w, u, phys, dt, R = WAVE_ROLL) {
  if (!w || !phys || !(dt > 0)) return false;
  const s = phys.state, P = phys.P;
  if (u < 0) return true;
  if (w.h0 == null) { w.h0 = s.heel ?? 0; if (w.heel * w.h0 > 0 && Math.abs(w.h0) >= Math.abs(w.heel)) return false; }   // she already leans that far: the wave adds nothing
  const end = R.riseS + R.holdS + R.fallS; if (u >= end) return false;
  const x = u / R.riseS, k = u < R.riseS + R.holdS ? 1 : 1 - (u - R.riseS - R.holdS) / R.fallS;
  const want = w.h0 + (w.heel - w.h0) * sm(x), wantV = u < R.riseS ? (w.heel - w.h0) * 6 * x * (1 - x) / R.riseS : 0;
  const om = 2 * Math.PI * R.hz, phi = s.heel ?? 0;
  // track the path (a stiff spring and its damper) plus the righting arm's moment at the path's heel (the wave holds her there)
  const acc = om * om * (want - phi) + 2 * R.zeta * om * (wantV - phys.p) + P.mass * 9.81 * rightingArm(want, P) / P.ixx;
  phys.p += k * acc * dt;
  w.maxHeel = Math.max(w.maxHeel ?? 0, Math.abs(phi));
  return true;
}
