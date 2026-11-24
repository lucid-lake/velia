// The helm camera's steadiness (owner, 2026-11-19: no "Calm camera" setting; the camera steadies itself only where it matters,
// the Helm view on rough water). Two pieces, no setting and nothing stored:
//
//   Auto-steady   the Helm view blends from the game's own helm camera in calm water (STEADY 0.4 of heel and pitch cancelled,
//                 smoothed over 0.1 s, all the heave) to a steadier one in rough water (0.7, 0.35 s, half the heave). The signal is
//                 the boat's measured heel and pitch RATE (RMS of the drawn pose's roll and pitch speed, deg/s, over ~4 s), not the
//                 wave height: a steady heel from the wind has no rate and is not "rough"; a short chop that rocks the hull is
//                 what shakes the horizon and tires the eye, whatever the wind says. The blend is eased over a few seconds both
//                 ways (slower out than in), so it never pops. The Boat view is untouched.
//   Reduce Motion the OS's prefers-reduced-motion keeps the full calm values at all times, in both views: the Helm view cancels
//                 85 % of heel and pitch over 0.5 s with 35 % of the heave; the Boat view keeps 35 % of the heave and drops the
//                 surf breath. Read live (System Settings › Accessibility › Display › Reduce motion). No UI, no flag.
// Pure apart from matchMedia (reducedNow): v2/tests/launch-gate.test.mjs (the curve, the ease, the values).

// Reduce Motion: the full calm values (were Setup's "calm camera")
export const CALM = Object.freeze({
  steady: 0.85,     // share of heel and pitch the helm view cancels
  helmTau: 0.5,     // s, the helm view's heel / pitch / heave smoothing
  heave: 0.35,      // share of the boat's heave the camera keeps (both views)
  surf: 0,          // the follow camera's surf cue (state.surf) scaled by this
});

// Auto-steady: the two ends of the helm camera and the sea that moves between them
export const AUTO = Object.freeze({
  calm: Object.freeze({ steady: 0.4, tau: 0.1, heave: 1 }),     // the game's helm camera (views.js STEADY, v1's HELM_CAM.tau)
  rough: Object.freeze({ steady: 0.7, tau: 0.35, heave: 0.5 }),
  rateLo: 2,        // deg/s of heel + pitch rate (RMS over senseS): at or under this the sea is calm for the camera
  rateHi: 6,        // at or over this it is rough
  senseS: 4,        // s, the RMS window (an exponential average of the squared rate)
  inS: 2.5,         // s, the blend's time constant going rougher
  outS: 6,          // s, going calmer (slower: a lull between sets never un-steadies it)
});

export const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

import { smooth } from '../../src/sim/core/math.js';
import { lerp } from '../../src/sim/core/math.js';

// 0 (calm) … 1 (rough) from the heel + pitch rate in deg/s
export const roughOf = (rateDegS) => smooth(AUTO.rateLo, AUTO.rateHi, rateDegS);
// the helm camera's numbers at a blend 0 … 1
export const autoAt = (k) => ({ steady: lerp(AUTO.calm.steady, AUTO.rough.steady, k), tau: lerp(AUTO.calm.tau, AUTO.rough.tau, k), heave: lerp(AUTO.calm.heave, AUTO.rough.heave, k) });

// The sea sense: fed the drawn pose each frame, it measures the heel + pitch rate and eases the blend. `rate` is the RMS (deg/s),
// `k` the eased blend the camera uses. A pose jump (a teleport, a restart) is not sea: the rate of one frame is capped.
export function createSeaSense() {
  let prev = null, e = 0, k = 0;
  const S = {
    get rate() { return Math.sqrt(e); }, get k() { return k; }, get target() { return roughOf(Math.sqrt(e)); },
    reset() { prev = null; e = 0; k = 0; },
    update(dt, pose) {
      if (!pose || !(dt > 0)) return k;
      const h = pose.heel ?? 0, p = pose.pitch ?? 0;
      if (prev) {
        const cap = 60;   // deg/s per axis
        const rh = Math.max(-cap, Math.min(cap, (h - prev.h) / dt * 180 / Math.PI)), rp = Math.max(-cap, Math.min(cap, (p - prev.p) / dt * 180 / Math.PI));
        e += (rh * rh + rp * rp - e) * (1 - Math.exp(-dt / AUTO.senseS));
      }
      prev = { h, p };
      const t = roughOf(Math.sqrt(e));
      k += (t - k) * (1 - Math.exp(-dt / (t > k ? AUTO.inS : AUTO.outS)));
      return k;
    },
  };
  return S;
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
