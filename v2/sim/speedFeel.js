// Speed feel (owner, 2026-11-17, a sailor: "the thrill is the boat cutting the water: heel, max speed, like cutting butter,
// silky"): the speed and heel she already has, felt a little more. Nothing is faked: every amount reads the physics' own
// state (the speed over the ground, the drawn heel: the physics' heel plus the waves' roll) and none moves the boat.
//   speedK(sog)        0..1: from 45 % of hull speed to hull speed (Fn 0.40: 6.5 kn for the C28's 7.26 m waterline)
//   leeK(heel)         0..1: the lee side working, 12° to 24° of heel
//   railWet(heel)      0..1: the lee deck edge at the water: its clearance amidships (v1's src/sim/boat/thrill.js
//                      railClearance: the sheer 0.95 m over the 1.575 m half-beam) from 0.15 m to 0.02 m (≈ 26.5° to 30.5°)
//   leeFoam(pose, q)   the water's lee-side foam: { strength, wet, side, speed } (render/wake.js draws it by the hull)
//   createSpeedCam()   the Boat view's speed camera: a touch lower and wider as she reaches hull speed (below)
//   FEEL_Q[level]      what each quality level keeps: the foam band, the rail's droplets, the bow's spray (engine/quality.js levels)
// Pure: v2/tests/speed-feel.test.mjs. Nothing here allocates a frame.
import { railClearance } from '../../src/sim/boat/thrill.js';
import { ease } from './ease.js';

const DEG = Math.PI / 180, KN = 1852 / 3600;
import { smooth } from '../../src/sim/core/math.js';

export const FEEL = Object.freeze({
  hullKn: 6.5,            // Fn 0.40 for the 7.26 m waterline (thrill.js SURF.fn)
  speed: [0.45, 1.0],     // speedK's ramp, as a share of hull speed
  leeDeg: [12, 24],       // leeK's ramp (°)
  wetM: [0.15, 0.02],     // railWet: the rail's clearance (m) where it starts and where it is awash
});
export const speedK = (sogMs) => smooth(FEEL.speed[0], FEEL.speed[1], Math.max(0, sogMs ?? 0) / (FEEL.hullKn * KN));
export const leeK = (heel) => smooth(FEEL.leeDeg[0] * DEG, FEEL.leeDeg[1] * DEG, Math.abs(heel ?? 0));
export const railWet = (heel) => 1 - smooth(FEEL.wetM[1], FEEL.wetM[0], railClearance(heel ?? 0));

// the quality levels (engine/quality.js LEVELS): L0 and L1 everything; L2 the foam a little less and half the droplets; L3 none
// (a weak phone keeps its frame). foam: the water's lee band; rail: the droplets off the lee rail; bow: the bow's spray in chop
export const FEEL_Q = Object.freeze([
  Object.freeze({ foam: 1, rail: 1, bow: 1 }),
  Object.freeze({ foam: 1, rail: 1, bow: 1 }),
  Object.freeze({ foam: 0.8, rail: 0.5, bow: 0.5 }),
  Object.freeze({ foam: 0, rail: 0, bow: 0 }),
]);
const FEEL_OFF = Object.freeze({ foam: 0, rail: 0, bow: 0 });
export const feelQ = (level, on = true) => (on ? FEEL_Q[Math.max(0, Math.min(FEEL_Q.length - 1, level | 0))] : FEEL_OFF);

// the lee-side foam for the water (render/wake.js lee uniform): strength 0..1 (the speed × the lee side working, more with the
// rail wet), wet (the rail awash), side (+1: starboard is the lee), speed (m/s, the streaks' drift aft). Written into out.
export function leeFoam(pose, q = FEEL_Q[0], out = { strength: 0, wet: 0, side: 1, speed: 0 }) {
  const heel = pose?.heel ?? 0, sog = pose?.sog ?? 0, k = speedK(sog), wet = railWet(heel);
  out.strength = q.foam * k * (0.45 * leeK(heel) + 0.55 * wet);
  out.wet = q.foam * wet; out.side = heel < 0 ? -1 : 1; out.speed = Math.max(0, pose?.u ?? sog);
  return out;
}

// The speed camera (the Boat view only): as speedK rises the eye eases CAM.dropM lower toward the water and the lens CAM.fovDeg
// wider; easing back as she slows. One amount, eased by sim/ease.js (a rate per second compounded for the frame's real dt:
// 30, 60 and 120 Hz follow the same curve). Off (eased to none) in the Helm view and under Cruise's autopilot; Reduce Motion
// (reduced motion) zeroes it at once. Applied to the follow pose before the trim nudge, so the two compose.
export const CAM = Object.freeze({ dropM: 0.6, fovDeg: 4, rate: 0.7, clearM: 0.8 });
export function createSpeedCam(C = CAM) {
  let x = 0;
  return {
    get amount() { return x; },
    // dt s; sog m/s; view 'follow' | 'helm'; cruise: the autopilot sails; reduced: the OS's Reduce Motion; on: the feature's switch
    update(dt, { sog = 0, view = 'follow', cruise = false, reduced = false, on = true } = {}) {
      if (reduced || !on) { x = 0; return x; }
      const target = view === 'follow' && !cruise ? speedK(sog) : 0;
      x = ease(x, target, C.rate, dt);
      if (target === 0 && x < 1e-3) x = 0;   // the last 0.06 cm and 0.004°: done
      return x;
    },
    reset(v = 0) { x = Math.min(1, Math.max(0, v)); },   // a settle's camera: at its amount at once
  };
}
// the follow pose { pos, target, fov } changed in place by the amount: the eye lowered (never under the aim point + clearM),
// the lens widened. c: the boat's centre (follow.c), unused but for symmetry with nudgePose. Returns p.
export function speedPose(p, amount, C = CAM) {
  if (!(amount > 0) || !p) return p;
  const floor = p.target[1] + C.clearM;
  p.pos[1] = Math.max(Math.min(p.pos[1], floor), p.pos[1] - C.dropM * amount);
  p.fov += C.fovDeg * amount;
  return p;
}
