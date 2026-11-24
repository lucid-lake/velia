// K2, the knockdown's look (owner 2026-11-17): what the eye and the ear get while she is over, read from the
// physics' own heel only (nothing here moves the boat). Every amount is 0 while she is upright, so nothing runs and nothing is
// drawn differently then (the goldens' pinned frames never heel past 35°).
//   kdRoll(heel)          0..1: the roll's share, 40° to 62° of heel (the lee rail under, then the boom and the sails in the water)
//   kdMix(heel)           0..1: the drawing's large-angle switch, 34° to 38° (the hull's waterline cut by the world's water, the
//                         water kept out of the hull and cockpit); 0 at and under 34° exactly
//   createKnockdownFx()   per frame: fx.update(dt, { heel, view, calm, on }) → { k, mix, flog, wild, cam, cut }
//     k     the roll (kdRoll on the heel) · flog  the sails' flog (42° to 55°) · wild  the vane and telltales (40° to 52°)
//     cam   the Boat view's ease out and up (0..1, eased by sim/ease.js: 30, 60 and 120 Hz the same curve)
//     cut   true once per excursion when the Helm view passes 45°: the page cuts to the Boat view (a 90° horizon makes people sick)
//   kdPose(p, amount)     the follow pose eased back CAM.backM along the view and CAM.upM up (no shake, no blur, no zoom)
// Pure: v2/tests/knockdown-fx.test.mjs.
import { ease } from './ease.js';

const DEG = Math.PI / 180;
import { smooth } from '../../src/sim/core/math.js';

export const KDFX = Object.freeze({
  rollDeg: [40, 62],      // kdRoll's ramp
  mixDeg: [34, 38],       // the drawing's large-angle switch (exactly 0 at and under 34°)
  flogDeg: [42, 55],      // the sails flog as the boom and the leech meet the water
  wildDeg: [40, 52],      // the vane and the telltales go wild
  cutDeg: 45,             // the Helm view cuts to the Boat view here
  rearmDeg: 30,           // a new excursion after she is back under this
});
// the spray's share by quality level (engine/quality.js LEVELS; render/wake.js's pool): every device gets the burst, a weak phone less
export const KD_Q = Object.freeze([1, 1, 0.6, 0.35]);
export const KD_LIFT = 0.6;   // the droplets' extra share of the sky's whole light at the full roll (render/wake.js setSprayLift)
export const KD_CAM = Object.freeze({ backM: 4, upM: 1.8, rate: 0.9, rateOut: 0.5 });

export const kdRoll = (heel) => smooth(KDFX.rollDeg[0] * DEG, KDFX.rollDeg[1] * DEG, Math.abs(heel ?? 0));
export const kdMix = (heel) => smooth(KDFX.mixDeg[0] * DEG, KDFX.mixDeg[1] * DEG, Math.abs(heel ?? 0));

export function createKnockdownFx(C = KD_CAM) {
  const out = { k: 0, mix: 0, flog: 0, wild: 0, cam: 0, cut: false };
  let cam = 0, armed = true;
  return {
    get state() { return out; },
    // dt s (the frame's real dt); heel rad (the drawn heel); view 'follow' | 'helm'; on: the feature's switch
    update(dt, { heel = 0, view = 'follow', on = true } = {}) {
      const h = Math.abs(heel ?? 0);
      out.cut = false;
      if (!on) { out.k = out.mix = out.flog = out.wild = 0; cam = 0; out.cam = 0; armed = true; return out; }
      out.k = kdRoll(h); out.mix = kdMix(h);
      out.flog = smooth(KDFX.flogDeg[0] * DEG, KDFX.flogDeg[1] * DEG, h);
      out.wild = smooth(KDFX.wildDeg[0] * DEG, KDFX.wildDeg[1] * DEG, h);
      cam = ease(cam, out.k, out.k > cam ? C.rate : C.rateOut, dt);
      if (out.k === 0 && cam < 1e-3) cam = 0;
      out.cam = cam;
      if (h < KDFX.rearmDeg * DEG) armed = true;
      if (armed && view === 'helm' && h >= KDFX.cutDeg * DEG) { out.cut = true; armed = false; }
      return out;
    },
    reset() { cam = 0; armed = true; out.k = out.mix = out.flog = out.wild = out.cam = 0; out.cut = false; },
  };
}

// the follow pose { pos, target, fov } eased back along the view's level direction and up (a new object; p untouched)
export function kdPose(p, amount, C = KD_CAM) {
  if (!(amount > 0) || !p) return p;
  const dx = p.pos[0] - p.target[0], dz = p.pos[2] - p.target[2], l = Math.hypot(dx, dz) || 1;
  const b = C.backM * amount;
  return { ...p, pos: [p.pos[0] + dx / l * b, p.pos[1] + C.upM * amount, p.pos[2] + dz / l * b], target: [p.target[0], p.target[1] + 0.35 * C.upM * amount, p.target[2]] };
}
