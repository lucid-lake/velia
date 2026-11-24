// The Menu card over the live lake (step D1; owner 2026-11-17: "same for the home menu card"): while the in-play
// Menu card is up the camera drifts gently about its own aim (a slow sway of ±0.16 rad, never faster than 0.06 rad/s, and a 1.2 m rise), so the lake behind
// the card stays alive; the drift eases in when the card opens and out when it closes (a rate per second, compounded for the frame:
// sim/ease.js), so the card's open and close never move the view with a jump. Never under reduce motion (the OS's Reduce Motion). Pure.
//   const md = createMenuDrift();  pose = md.step(dt, open, pose, { reduced })   (the same pose object when the drift is 0)
import { easeK } from '../sim/ease.js';

const MENU_DRIFT = Object.freeze({ yaw: 0.16, freq: 0.35, lift: 1.2, inRate: 1.4 });   // the sway ±yaw rad as sin(freq · t): at most 0.056 rad/s
export function createMenuDrift(o = {}) {
  const D = { ...MENU_DRIFT, ...o };
  let w = 0, t = 0;
  const out = { pos: [0, 0, 0], target: [0, 0, 0] };
  return {
    get w() { return w; },
    step(dt, open, pose, { reduced = false } = {}) {
      w += ((open && !reduced ? 1 : 0) - w) * easeK(D.inRate, dt);
      if (open) t += dt;
      if (w < 1e-3 || !pose?.pos || !pose?.target) { if (!open) t = 0; return pose; }
      const k = w * w * (3 - 2 * w), a = D.yaw * k * Math.sin(t * D.freq), c = Math.cos(a), s = Math.sin(a);
      const [px, py, pz] = pose.pos, [tx, ty, tz] = pose.target, ex = px - tx, ez = pz - tz;
      out.pos[0] = tx + ex * c - ez * s; out.pos[1] = py + D.lift * k; out.pos[2] = tz + ex * s + ez * c;
      out.target[0] = tx; out.target[1] = ty; out.target[2] = tz;
      return { ...pose, pos: out.pos.slice(), target: out.target.slice() };
    },
  };
}
