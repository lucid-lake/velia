// The `curious` kind (pure): a boat drawn toward a point on the water (play as Tessie's Lure, v2/sim/tessieLure.js), the opposite sign of
// an evade. Its own module so the busy lake, the kayakers and the glass boat (loaded on every device) never pull her code onto a phone.
//   curiousHeading(s { x, z, heading }, at { x, z }, windFrom, noGoDeg) → the heading toward the point, never inside the no-go cone
import { wrap } from '../../src/sim/core/math.js';

const DEG = Math.PI / 180;
export const CURIOUS = Object.freeze({
  arriveM: 25,        // m: a curious sailboat or the glass boat this near the point stops closing (luffs and drifts)
  kayakArriveM: 10,   // m: a curious kayaker stops paddling this near
  slowM: 60,          // m: inside this a curious sailboat eases her sheets (she slows to look)
  easeDeg: 80,        // the sheets eased to this while she slows
  noGoDeg: 50,        // the no-go cone either side of the wind (the busy lake's)
});

export function curiousHeading(s, at, windFrom, noGoDeg = CURIOUS.noGoDeg) {
  const h = Math.atan2(at.x - s.x, -(at.z - s.z)), off = wrap(h - windFrom), lim = noGoDeg * DEG;
  return Math.abs(off) >= lim ? h : wrap(windFrom + (off >= 0 ? lim : -lim));   // inside the cone: its nearer edge (a close reach toward it)
}
