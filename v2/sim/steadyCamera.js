// The helm camera's steadiness (owner, 2026-11-19: no "Calm camera" setting; 2026-11-25: "in the Helm view the camera rocks up
// and down a lot; a normal user might not be able to stay in that mode for a long time"). No setting and nothing stored:
//
//   The steady horizon  the Helm view holds the horizon as a sailor's eye does (HelmHorizonCamera): the eye rides in the
//                 cockpit, but the head keeps the world level. The view's pitch and roll against the world take only a small,
//                 slow share of the hull's (HORIZON: 20 % of the pitch, 15 % of the heel, each low-passed over 2.5 s, critically
//                 damped: a 3 s wave reaches the view at under 3 % of the hull's swing, a steady 20° heel tilts it 3°). The
//                 cockpit, the wheel and the bow stay rigid with the hull, so they heel and pitch IN the frame against the still
//                 horizon: the boat works, the world holds. The eye's wave bob is taken out up to ± 0.15 m (the slow swell stays;
//                 a bigger bob still lifts the eye, so the cockpit never moves more than that against it: the boom is
//                 ≈ 0.5 m over the eye, the dodger forward of it). The Boat view is untouched.
//   Reduce Motion the OS's prefers-reduced-motion holds it steadier still (HORIZON_REDUCED: 8 % and 6 % over 3.5 s, the bob out to
//                 ± 0.22 m) in the Helm view; the Boat view keeps 35 % of the heave and drops the surf breath. Read live (System
//                 Settings › Accessibility › Display › Reduce motion). No UI, no flag.
// Pure apart from matchMedia (reducedNow): v2/tests/launch-gate.test.mjs, v2/tests/helm-horizon.test.mjs.
import { HelmCamera, toWorldDir } from '../../src/sim/boat/helmCamera.js';

// Reduce Motion in the Boat view (the follow camera's pose: calmPose)
export const CALM = Object.freeze({
  heave: 0.35,      // share of the boat's heave the follow camera keeps
  surf: 0,          // the follow camera's surf cue (state.surf) scaled by this
});

// the Helm view's horizon: the share of the hull's pitch and heel the view keeps (after the low-pass), the low-pass's time
// constant (s), and the eye's bob taken out (the eye's height low-passed over heaveTau; the difference capped at heaveCapM)
export const HORIZON = Object.freeze({ pitch: 0.2, roll: 0.15, tau: 2.5, heaveTau: 2.5, heaveCapM: 0.15 });
export const HORIZON_REDUCED = Object.freeze({ pitch: 0.08, roll: 0.06, tau: 3.5, heaveTau: 3.5, heaveCapM: 0.22 });

export const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// v1's helm camera (the eye in the cockpit, the drag's look, the lens zoom) with the view's orientation held level: the eye
// rides the drawn hull (steady 0, v1's 0.1 s smoothing); the look's yaw is the hull's heading and the drag's, its pitch and
// roll the hull's slow share (h: HORIZON or HORIZON_REDUCED, swapped live by the views). Returns { pos, target, up, fov, near }.
// a critically damped low-pass whose time constant is read each step (sim/ease.js createLowPass's step, solved exactly per step:
// 30, 60 and 120 Hz give the same curve; Reduce Motion's switch keeps the state, so it never pops). The first sample is taken as is.
function slowOf() {
  let x = null, v = 0;
  return {
    step(h, dt, tau) {
      if (!Number.isFinite(h)) return x ?? 0;
      if (x == null || !(dt >= 0)) { x = h; v = 0; return h; }
      if (dt > 0) { const w = 2 / tau, e = Math.exp(-w * dt), d = x - h, t = (v + w * d) * dt; x = h + (d + t) * e; v = (v - w * t) * e; }
      return x;
    },
    reset() { x = null; v = 0; },
  };
}

// v1's helm camera (the eye in the cockpit, the drag's look, the lens zoom) with the view's orientation held level: the eye
// rides the drawn hull (steady 0, v1's 0.1 s smoothing); the look's yaw is the hull's heading and the drag's, its pitch and
// roll the hull's slow share (horizon: HORIZON or HORIZON_REDUCED, set live by the views). Returns { pos, target, up, fov, near }.
export class HelmHorizonCamera extends HelmCamera {
  constructor(cfg = {}, horizon = HORIZON) {
    super(cfg);
    this.steady = 0;
    this.horizon = horizon;
    this.f = { heel: slowOf(), pitch: slowOf(), eye: slowOf() };
    this.share = { ...horizon };   // the shares in force: eased toward this.horizon's over ~1 s (Reduce Motion switched live never pops)
    this.held = { heel: 0, pitch: 0, bob: 0 };   // the view's heel and pitch against the world (rad) and the eye's bob taken out (m): tests, probes
  }
  reset() { super.reset(); for (const f of Object.values(this.f ?? {})) f.reset(); if (this.horizon) this.share = { ...this.horizon }; }
  update(dt, pose, input = {}) {
    const p0 = super.update(dt, pose, input), C = this.cfg, h = this.share, k = dt > 0 ? 1 - Math.exp(-dt) : 0;
    for (const key of Object.keys(h)) h[key] += (this.horizon[key] - h[key]) * k;
    const heel = this.f.heel.step(this.s.heel, dt, h.tau) * h.roll, pitch = this.f.pitch.step(this.s.pitch, dt, h.tau) * h.pitch;
    const y = p0.pos[1], bob = clamp(y - this.f.eye.step(y, dt, h.heaveTau), -h.heaveCapM, h.heaveCapM);
    const pos = [p0.pos[0], y - bob, p0.pos[2]];
    this.held.heel = heel; this.held.pitch = pitch; this.held.bob = bob;
    const po = { heading: pose.heading ?? 0, heel, pitch };
    const el = C.pitchDeg * DEG + this.pitch, ya = this.yaw;
    const dir = toWorldDir([Math.sin(ya) * Math.cos(el), Math.sin(el), -Math.cos(ya) * Math.cos(el)], po);
    return { pos, target: [pos[0] + dir[0] * 10, pos[1] + dir[1] * 10, pos[2] + dir[2] * 10], up: toWorldDir([0, 1, 0], po), fov: p0.fov, near: p0.near };
  }
}

// the boat's drawn pose as the camera sees it under Reduce Motion: the heave scaled; the surf cue scaled (the follow camera's
// breath). A fresh object; the boat's own pose is never changed.
export function calmPose(pose, on) {
  if (!on || !pose) return pose;
  return { ...pose, heave: (pose.heave ?? 0) * CALM.heave, surf: (pose.surf ?? 0) * CALM.surf };
}

// The one Reduce Motion signal for v2 (the OS's prefers-reduced-motion, read live; the query object is kept per matchMedia). Every
// accessibility check (this camera, the speed camera, the trim nudge, the menu drift, the cinematic intro, the fly-over, the
// cockpit's glide) reads it; there is no other flag, setting or stored choice.
let lastMM = null, lastMQ = null;
export function reducedNow() {
  try {
    const mm = globalThis.matchMedia;
    if (typeof mm !== 'function') return false;
    if (mm !== lastMM) { lastMM = mm; lastMQ = mm.call(globalThis, REDUCED_QUERY); }
    return !!lastMQ?.matches;
  } catch { return false; }
}
