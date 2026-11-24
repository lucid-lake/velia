// The drawn trim (owner, 2026-11-16: the trim must read on screen): two drawing-only changes on the boat's pose, the physics
// untouched (its forces, fills and the state every other reader sees). Pure: v2/tests/drawn-trim.test.mjs.
//
// 1. The boom follows the sheet across its whole range. The physics' boom sits at the sail's free (luffing) angle once the
//    sheet is eased past it (src/sim/boat.js: the sheet only limits the boom), so from fully eased in to that angle (≈ 30° on a
//    close reach) W showed nothing for most of the trim. A luffing main in real life is not still: the slack sheet lets the
//    flogging cloth carry the boom out past the wind and back. So the drawn boom takes DRAWN.follow of the sheet's slack (the
//    sheet's boom angle less the physics' boom): it eases out and comes in with the sheet all the way, and the cloth's flog
//    (its fill, the physics' own: low when eased past the luff) carries the luff. Near the centreline (head to wind, the
//    boom crossing on a tack or a gybe) the follow fades to nothing over DRAWN.centreDeg, so the boom never jumps sides. The
//    jib's clew the same way, except backed (held to windward) or furled.
// 2. The Pro shape changes drawn DRAWN.twist × (the vang's and the backstay's leech twist, the jib lead's twist) and the jib
//    lead's foot depth DRAWN.lead × (the car's own move stays v1's 0.3 m); a Pro backstay's flattening drawn DRAWN.draft ×
//    down to DRAWN.draftMin (0.5 at full backstay would need a negative depth at 3 ×). Basic sailing's descriptors are unchanged.
const DEG = Math.PI / 180;
import { clampT as clamp } from '../../../src/sim/core/math.js';
import { smooth } from '../../../src/sim/core/math.js';

// MAIN_TWIST / JIB_TWIST: src/sim/boat.js MAIN_TWIST_DEG, JIB_TWIST_DEG (the boom and the clew are the sheet's angle less them);
// MAIN_MAX: the boom's stop (the vessel's main.maxDeg 80, less the twist)
export const DRAWN = { follow: 0.6, centreDeg: [2, 10], twist: 3, lead: 3, draft: 3, draftMin: 0.15, MAIN_TWIST: 8, JIB_TWIST: 8, MAIN_MAX: 72 };

// the drawn angle (rad, signed) for a physics angle `a` (rad, signed) under a sheet (rad, the sheet's own angle, its twist in)
export function followAngle(a, sheet, twistDeg, maxDeg, D = DRAWN) {
  if (!(sheet > 0)) return a;
  const m = Math.abs(a), slack = Math.max(0, sheet - twistDeg * DEG - m);
  const w = smooth(D.centreDeg[0] * DEG, D.centreDeg[1] * DEG, m);
  return Math.sign(a) * Math.min(maxDeg * DEG, m + D.follow * slack * w);
}

// pose → the drawn pose (into out, reused; the physics' pose untouched)
export function drawnPose(pose, out = {}, D = DRAWN) {
  Object.assign(out, pose);
  out.boomAngle = followAngle(pose.boomAngle ?? 0, pose.mainSheet, D.MAIN_TWIST, D.MAIN_MAX, D);
  if (!pose.jibBacked && !(pose.furl > 0.5)) out.jibAngle = followAngle(pose.jibAngle ?? 0, pose.jibSheet, D.JIB_TWIST, 90, D);
  return out;
}

// a sail descriptor (src/boat/rig.js sailParams: { main, jib }) → the drawn one: the Pro twist, lead and backstay exaggerated;
// proBackstay: the Pro backstay (0 … 1) or null (the crew's flattening: drawn as it is)
export function drawnSail(sp, proBackstay = null, D = DRAWN) {
  const main = { ...sp.main }, jib = { ...sp.jib };
  if (main.twistX) main.twistX *= D.twist;
  if (jib.twistX) jib.twistX *= D.twist;
  if (jib.lead) jib.lead *= D.lead;
  if (proBackstay != null) for (const s of [main, jib]) s.draft = Math.max(D.draftMin, 1 - D.draft * (1 - (s.draft ?? 1)));
  return { main, jib };
}
