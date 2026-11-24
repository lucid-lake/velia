// Click the water to set a course (owner, 2026-10-29). A click without a drag on the water sets a
// target bearing from the boat to the clicked point, and the pilot (src/boat.js Helm) steers to it and holds it.
// A bearing inside the no-go zone is sailed close-hauled on the better tack (the one the bearing lies on; inside
// COURSE.sameTackDeg of dead upwind the tack the bow is already on, so a click there never forces a tack), and the
// glyph shows its no-go wedge. The tack is chosen once per click: the pilot never tacks by itself. A/D, the pad's
// stick, the glyph's rudder or the helm view's wheel cancel it (controls.js). Plain JS, no DOM: tests/mouse.test.mjs.
//
//   const c = new CoursePilot();
//   c.set(bearingFrom(boat, point), state);   // a click
//   holdHeading = c.update(state);             // each frame while c.active: the heading for Helm.toHeading
//   c.cancel();
//
// Angles: radians clockwise from north (−z), as src/boat/contract.js. The true wind comes FROM heading + trueWind.angle.
import { bestVmg } from '../../../src/sim/boat/groove.js';
import { CAPTAIN } from '../../../src/ui/captainView.js';

const DEG = Math.PI / 180, KN = 0.514444;
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const COURSE = {
  nogoDeg: CAPTAIN.wedgeDeg,   // the no-go zone's half-angle: the glyph's wedge (42°)
  minCloseDeg: 44,             // the close-hauled true wind angle never tighter than this (outside the wedge)
  sameTackDeg: 8,              // a bearing this close to dead upwind keeps the tack the bow is on
};

// the bearing from a boat at (x, z) to a point (px, pz)
export const bearingFrom = ({ x, z }, { x: px, z: pz }) => Math.atan2(px - x, -(pz - z));
// where the wind comes from, for a boat state
export const windFrom = (s) => wrap((s.heading ?? 0) + (s.trueWind?.angle ?? 0));
// the close-hauled true wind angle at this wind (rad): the polar's best VMG upwind, not tighter than minCloseDeg
export const closeHauled = (twsMs) => Math.max(COURSE.minCloseDeg, bestVmg(Math.max(2, (twsMs ?? 5) / KN), true).twa) * DEG;

// The heading for a bearing in a wind from `from` (rad). tack: −1 port (wind over the port bow), +1 starboard, or
// null to choose; heading: the bow now (the same-tack rule). Returns { heading, nogo, tack }.
export function courseHeading(bearing, from, { close = 45 * DEG, tack = null, heading = bearing } = {}) {
  const off = wrap(bearing - from);                  // the bearing's angle off the wind: 0 dead upwind
  if (Math.abs(off) >= COURSE.nogoDeg * DEG) return { heading: wrap(bearing), nogo: false, tack: null };
  if (tack == null) {
    const bow = wrap(heading - from);
    tack = Math.abs(off) < COURSE.sameTackDeg * DEG ? (Math.sign(bow) || Math.sign(off) || 1) : (Math.sign(off) || 1);
  }
  // tack +1: the bow to the right of the wind (the wind over the port bow) — the heading from + close
  return { heading: wrap(from + tack * close), nogo: true, tack };
}

export class CoursePilot {
  constructor() { this.bearing = null; this.tack = null; this.nogo = false; this.heading = null; this.setAt = 0; }
  get active() { return this.bearing != null; }
  set(bearing, s) {
    this.bearing = wrap(bearing); this.tack = null; this.nogo = false;
    return this.update(s);
  }
  cancel() { this.bearing = null; this.tack = null; this.nogo = false; this.heading = null; }
  // the heading to hold now (re-read each frame: the wind shifts, and a bearing can enter or leave the no-go zone)
  update(s) {
    if (this.bearing == null) return null;
    const from = windFrom(s);
    const r = courseHeading(this.bearing, from, { close: closeHauled(s.trueWind?.speed), tack: this.tack, heading: s.heading });
    this.nogo = r.nogo; this.tack = r.nogo ? r.tack : null; this.heading = r.heading;
    return r.heading;
  }
}

// A ray onto the water plane (y = level): origin and dir as [x, y, z]; returns { x, z, dist } or null (the sky, or
// past maxDist).
export function rayToWater(o, d, { level = 0, maxDist = 6000 } = {}) {
  if (!(d[1] < -1e-6)) return null;
  const t = (level - o[1]) / d[1];
  if (!(t > 0)) return null;
  const x = o[0] + d[0] * t, z = o[2] + d[2] * t, dist = Math.hypot(x - o[0], level - o[1], z - o[2]);
  return dist > maxDist ? null : { x, z, dist };
}

// Does a ray pass the boat (at bx, bz) before it meets the water? The boat as a vertical cylinder of radius r from the
// keel's depth to the masthead: a click on the hull or the sails is not a course.
export function rayHitsBoat(o, d, { x: bx, z: bz }, { r = 4, top = 14, bottom = -1 } = {}) {
  const hx = d[0], hz = d[2], h2 = hx * hx + hz * hz;
  if (h2 < 1e-9) return Math.hypot(o[0] - bx, o[2] - bz) < r;
  const t = Math.max(0, ((bx - o[0]) * hx + (bz - o[2]) * hz) / h2);
  const px = o[0] + hx * t - bx, pz = o[2] + hz * t - bz, y = o[1] + d[1] * t;
  return Math.hypot(px, pz) < r && y > bottom && y < top;
}
