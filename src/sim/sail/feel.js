// Day Sail's load feel (owner, 2026-10-29: "real sailing thrills through the body"). Plain JS, no DOM:
// tests/feel.test.mjs.
//
// 1. The winch. A crew grinds at about a constant power, so the sheet comes in slower as its load rises: speed ×
//    tension ≈ power. winchRate(F) is 12°/s in light air (the sails' force under ≈ 900 N), and falls as a power limit
//    above WINCH.kneeN: ≈ 6°/s at 2 kN (a level-3 gust) and ≈ 4.7°/s at 2.8 kN (a level-4 gust, reefed); never under
//    WINCH.minDeg. Easing stays at the full 25°/s (the sheet runs out on its own: the relief). The load is the sails'
//    force, hypot(drive, side) (src/boat.js), smoothed over WINCH.tau, the same force the boat's sound reads.
// 2. The weather helm. The physics has it (src/boat.js § 8: the drive's lever to leeward of the heeled hull and the
//    heeled hull's own turn): heel rounds the boat up. weatherHelm(s) estimates the yaw moment those two terms make
//    and the rudder that cancels it, so the controls can weight the helm (bearing away against it is slower) and the
//    debug line can show it. The pilot's own rudder is the true answer; this is its estimate from the state. The sails'
//    side force (its centre forward of the keel's) takes some back; WH_FIT folds that in, fitted to the physics' own
//    held rudder at TWA 50°, 6–21 kn, no reef (heel 5.5 / 12.1 / 18.6 / 21.8°: physics 0.2 / 2.4 / 5.9 / 8.2°, fit
//    0.5 / 2.6 / 5.0 / 6.5°; tests/feel.test.mjs).
import { BOAT } from '../boat.js';

const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';

export const WINCH = {
  fastDeg: 12,      // °/s with a light sheet
  kneeN: 1100,      // N: the force where the grinder's power starts to bind
  sharp: 4,         // the knee's sharpness (a soft min of "fast" and "power / F")
  minDeg: 3.5,      // °/s: never slower (a crew leans in)
  easeDeg: 25,      // °/s easing: unchanged by the load
  tau: 0.3,         // s, the load's smoothing
};

// the sail force (N) → the pull-in rate (rad/s): monotonic, never rising with the load
export function winchRate(forceN, W = WINCH) {
  const f = Math.max(0, forceN) / W.kneeN;
  const deg = W.fastDeg / Math.pow(1 + Math.pow(f, W.sharp), 1 / W.sharp);
  return Math.max(W.minDeg, deg) * DEG;
}
export const sailForce = (s) => Math.hypot(s?.drive ?? 0, s?.side ?? 0);

const WH_FIT = { k: 0.94, offDeg: 2.6 };   // refitted 2026-10-29 after the rudder ventilation moved to 22–40° (feat/thrill)
// the yaw tendency to windward from the heel (N·m, + rounds up) and the rudder (rad, its magnitude) that cancels it
export function weatherHelm(s, P = BOAT) {
  const phi = Math.abs(s?.heel ?? 0), u = Math.max(0, s?.u ?? 0);
  const drive = Math.max(0, s?.drive ?? 0);
  const hullN = P.hull.yawHeel * Math.sin(phi) * u * u;            // the heeled hull's turn
  const leverN = P.main.z * Math.sin(phi) * drive;                  // the drive acting to leeward of the centreline
  const moment = hullN + leverN;
  const slope = 2 * Math.PI / (1 + 2 / P.rudder.ar);
  // mirrors src/boat.js's rudder ventilation (P.rudder.vent, smoothstep between its two heels)
  const [v0, v1] = P.rudder.vent ?? [25 * DEG, 55 * DEG], vt = clamp((phi - v0) / (v1 - v0), 0, 1);
  const vent = 1 - 0.7 * vt * vt * (3 - 2 * vt);
  const perRad = Math.abs(P.rudder.x) * 0.5 * 1025 * u * u * P.rudder.area * slope * vent;   // N·m per rad of rudder
  const raw = perRad > 1 ? moment / perRad : 0;
  const need = clamp(WH_FIT.k * raw - WH_FIT.offDeg * DEG, 0, P.rudder.maxDeg * DEG);
  return { moment, need };
}

// The helm's weight under the player's hand: the wheel follows the key at tau 0.4 s, slower when it bears away
// against the weather helm (up to × (1 + HELM.heavy) at HELM.fullDeg of needed rudder), as a loaded wheel is.
export const HELM = { tau: 0.4, heavy: 1.5, fullDeg: 8 };
// steer −1..1 (the key's side), awaSign: + wind from starboard; returns the time constant (s)
export function helmTau(steer, awaSign, needRad) {
  // the boat rounds up toward the wind's side: with the wind from starboard (+), heading up is a turn to starboard
  // (+ rudder). Steering the other way (bearing away) fights the weather helm.
  const against = steer !== 0 && Math.sign(steer) === -Math.sign(awaSign || 1);
  return HELM.tau * (1 + (against ? HELM.heavy * clamp(needRad / (HELM.fullDeg * DEG), 0, 1) : 0));
}
