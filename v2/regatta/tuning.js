// Regatta's tuning (refactor round 3 C4: moved out of index.js, which re-exports the public ones): the race camera's
// framing and rates, the results card's timing, the course scales, the quiet moments, the coach's shift rule
import { easeK } from '../sim/ease.js';

export const DEG = Math.PI / 180;
// R3: on the beat the follow eye rises 5 m (as R2), stands 8 m further back, looks 15 m further up the course and turns toward the mark (0.6 of the angle, up to 40°) (R2's 5 m lift read the
// laylines thin near the horizon, often off the frame; mock 3)
// squareM, blendM: the pre-start eye looks toward the line's middle from squareM + blendM (25 m, the old cut) out, square to the line
// inside squareM, blended between (and as the middle comes abeam: once it is behind her the eye looks up the course)
export const RACE_CAM = Object.freeze({ back: 24, height: 7.5, ahead: 30, fov: 50, portraitBack: 34, portraitHeight: 10, easeS: 3, beatLift: 5, beatBack: 8, beatYawDeg: 40, beatYawK: 0.6, beatLookM: 15, nearM: 60, nearBack: 0.45, squareM: 10, blendM: 15 });
import { smooth as smoothstep } from '../../src/sim/core/math.js'; export { smoothstep };
export const RESULTS = Object.freeze({ afterS: 2.5, saluteS: 11 });   // saluteS: real s the card waits while the salute plays (it must be seen first)   // the results card this long after she crosses the finish
export const ROUND_FX = Object.freeze({ flashS: 2.2 });   // the watch's "Mark 1 ✓" after a rounding, real seconds (owner 2026-11-17)
// behind the hub (step D1): yaw0 rad round toward the committee boat's end (the fleet's end of the line, so the boats sit in the hub's gap,
// the line foreshortened), then ±yaw rad about the start area and mark 1's middle (mid: that share of the way up the leg), at 0.12 rad/s,
// the eye back0 + backK × the leg behind the middle and up0 + upK × the leg high (±bob m of slow rise and fall), lens fov°; lead: the aim
// led left by that share of the leg (the course sits right of the hub's one left card: lead on a wide screen, leadTight on a phone; 0 upright); inRate: hubK's rate (1/s);
// selRate: the rate (1/s) the frame glides to a newly selected race's course
export const HUB_CAM = Object.freeze({ yaw0: 0.4, yaw: 0.15, rate: 0.12, mid: 0.4, back0: 60, backK: 0.6, up0: 30, upK: 0.35, bob: 1.5, fov: 46, lead: 0.3, leadTight: 0.42, inRate: 1.6, selRate: 2.2 });
// step D3: the race camera's three eases as rates per second (camK the box view in and out, liftK the beat's
// rise, yaw its turn toward the mark), each step 1 − e^(−rate·dt): the same settled frame and the same time at 30, 60 and 120 fps
export const CAM_RATES = Object.freeze({ box: 3, lift: 1.2, yaw: 1.5 });
export function raceCamEase(st, { k, lift, yaw }, dt) {
  st.camK += (k - st.camK) * easeK(CAM_RATES.box, dt);
  st.liftK += (lift - st.liftK) * easeK(CAM_RATES.lift, dt);
  if (yaw != null) st.camYaw += (yaw - st.camYaw) * easeK(CAM_RATES.yaw, dt);
  return st;
}
export const SHORT = Object.freeze({ scale: 0.4 });      // ?course=short: the Island Sprint's marks at 0.4 of their distance (the page test's race)
// R4 (the owner's pacing note, 2026-11-14): every race sails the Island Sprint at 0.35 of its distance by default (one beat to W, the
// rounding, the reach to I, the run home: ≈ 400 m of legs; about 3 minutes of real time at 2 ×, measured);
// ?course=full is v1's whole course (1,140 m)
export const COURSE_SCALE = Object.freeze({ race: 0.35, full: 1 });
export const LINES_HZ = 10;
export const CARD = Object.freeze({ openS: 10, plateMaxM: 900 });   // the course card open this long at a race's start (real s); a mark's plate within this
export const TAG_MAX_M = 400;   // R4: a rival's tag beyond this is left off (a far boat is a few pixels; its place is on the ladder)
export const PRO_MOMENTS = new Set(['place', 'leader', 'lastLeg']);
// the coach on a shifty beat: a header of SHIFT_COACH.deg or more on her tack says "tack", at most once in SHIFT_COACH.everyS
export const QUIET = Object.freeze({ beforeS: 10, afterS: 15, markK: 2, finishM: 60 });   // step D2: the race's quiet moments (a quality step lands only in one)
export const SHIFT_COACH = Object.freeze({ deg: 6, everyS: 30, introS: 3 });
export const rivalRef = (b) => (b.ref ??= { id: b.id, state: null }, b.ref.state = b.phys.state, b.ref);
export const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
