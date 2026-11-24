// The camera's look toward Tessie during a strike in Tessie's Deep (item 8; owner, 2026-11-19: her neck must read
// big on screen): while she strikes near the player (her ring live, within LOOK.nearM of the boat) the race's follow eye turns about the
// boat toward her, a short smooth look that returns. Never a snap: the look's weight eases in and out at rates per second (sim/ease.js,
// the same at 30, 60 and 120 fps), the turn is capped at LOOK.maxDeg and its rate at LOOK.maxDegS; the eye stays at the follow
// camera's distance and height (a turn about the boat, not a move). Off under Reduce Motion (the calm camera or the OS setting): no
// look at all. Pure (v2/tests/regatta-places-2.test.mjs).
//   const L = createTessieLook()
//   L.step(dt, pose, { active, boat: [x, z], target: [x, z] | null, reduced }) → the pose turned toward her (or the pose itself)
//   L.yawDeg, L.w     the turn now (deg) and the look's weight (0..1)
import { easeK } from '../sim/ease.js';

export const LOOK = Object.freeze({ maxDeg: 38, share: 0.75, inRate: 2.2, outRate: 1.1, maxDegS: 40, nearM: 220 });
import { wrap } from '../../src/sim/core/math.js';
const DEG = Math.PI / 180;

export function createTessieLook(K = LOOK) {
  let w = 0, yaw = 0;
  const last = [0, 0];   // the boat the turn is about (kept while the look eases out)
  return {
    get yawDeg() { return yaw / DEG; }, get w() { return w; },
    reset() { w = 0; yaw = 0; },
    step(dt, pose, { active = false, boat = null, target = null, reduced = false } = {}) {
      if (reduced) { w = 0; yaw = 0; return pose; }
      const on = !!(active && boat && target && Math.hypot(target[0] - boat[0], target[1] - boat[1]) <= K.nearM);
      w += ((on ? 1 : 0) - w) * easeK(on ? K.inRate : K.outRate, dt);
      // the turn wanted: share of the angle from the view's forward to her bearing, capped; eased by the weight, rate-limited
      let want = 0;
      if (on) {
        const fx = pose.target[0] - pose.pos[0], fz = pose.target[2] - pose.pos[2], bx = target[0] - boat[0], bz = target[1] - boat[1];
        const a = wrap(Math.atan2(fx * bz - fz * bx, fx * bx + fz * bz));
        want = Math.max(-K.maxDeg * DEG, Math.min(K.maxDeg * DEG, a * K.share));
      }
      const goal = want * w, step = K.maxDegS * DEG * Math.max(0, dt);
      yaw += Math.max(-step, Math.min(step, (on ? goal : yaw * (1 - easeK(K.outRate, dt))) - yaw));
      if (!on && w < 1e-3 && Math.abs(yaw) < 1e-4) { yaw = 0; w = 0; }
      if (boat) { last[0] = boat[0]; last[1] = boat[1]; }
      if (Math.abs(yaw) < 1e-6) return pose;
      // turn the eye and the aim about the boat (the pose's height and distance kept)
      const c = Math.cos(yaw), s = Math.sin(yaw), rot = (p) => { const x = p[0] - last[0], z = p[2] - last[1]; return [last[0] + x * c - z * s, p[1], last[1] + x * s + z * c]; };
      return { ...pose, pos: rot(pose.pos), target: rot(pose.target) };
    },
  };
}
