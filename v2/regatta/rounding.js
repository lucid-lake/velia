// A game's rounding (owner 2026-11-17, after racing: "Our definition of finishing a leg is too strict. I think I crossed leg 1's
// target, but it wasn't clearly counted, and leg 2 didn't light up"). Beginner and Club count a mark when the boat crosses the mark's
// ROUNDING LINE: from the mark, square to the leg she sails (the leg's direction u, from the last mark or the line's middle to this
// mark), out on the side she must pass (port rounding: the mark on her left, so the line runs out to her right) for ROUND.reachK zone
// radii, set ROUND.leadK of a zone back toward her (a turn begun a moment early still counts). No sweep round the mark, no zone to be
// inside: crossing it on the right side counts at once, and the beacon, the next leg and the watch move on that tick.
//   Beginner: a crossing a little on the wrong side (within ROUND.wrongOkK of a zone) still counts, with a gentle coach note (close).
//   Club: a wrong-side crossing does not count: 'wrongSide' at once (the coach: "Go round mark 1 — keep it on your left"; the gate
//         glows); she dips back below the line and crosses it on the right side.
//   A crossing wide on the right side (past the reach: she overstood) counts as soon as she comes within the reach while still past
//   the line. A wrong-side crossing far off does not, until she comes back below the line and crosses it again.
//   Pro keeps the real rule (src/sim/marks/course.js CourseTracker: the sweep across the outside bearing within its zone), unchanged.
// The AI fleet is judged by the same tracker (rules.js holds one per boat), so a rival's rounding is the player's rule (fairness).
// The finish is unchanged (rules.js: any crossing of the line toward the pre-start side). Pure: v2/tests/regatta-rounding.test.mjs.
//   roundRule(level)                    → null (Pro: strict) | { reachM, leadM, wrongOkM, level }
//   lineCoords(from, to, rounding, x, z) → { a, s, d }: a metres past the mark along the leg (< 0 short of it), s metres off the leg's
//                                          axis toward the side to pass (> 0 the right side), d metres to the mark
//   new RoundingTracker(course, { positions, rule })   the CourseTracker's api (update, target, k, done, log, reset)
//   roundingCue({ a, s, d }, rule)      → true while she is near the mark and it has not counted (the watch's "Round mark 1 →", the
//                                          gate brightened)
import { CourseTracker } from '../../src/sim/marks/course.js';
import { ZONE_M } from './geometry.js';

export const ROUND = Object.freeze({ reachK: 2, leadK: 0.25, wrongOkK: 0.5, nearK: 1.6, pastK: 3 });

export function roundRule(level, zoneM = ZONE_M) {
  if (level !== 'beginner' && level !== 'club') return null;
  return Object.freeze({ level, reachM: ROUND.reachK * zoneM, leadM: ROUND.leadK * zoneM, wrongOkM: level === 'beginner' ? ROUND.wrongOkK * zoneM : 0, zoneM });
}

export function lineCoords(from, to, rounding, x, z) {
  let ux = to[0] - from[0], uz = to[1] - from[1]; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l;
  const dx = x - to[0], dz = z - to[1], sgn = rounding === 'starboard' ? -1 : 1;   // port: the side to pass is her right, (−uz, ux)
  return { a: dx * ux + dz * uz, s: sgn * (-dx * uz + dz * ux), d: Math.hypot(dx, dz) };
}

// near the mark and not counted yet: within nearK zones, or past the line (within pastK zones) without a rounding
export function roundingCue(c, rule, zoneM = ZONE_M) {
  if (!c || !rule) return false;
  return c.d < ROUND.nearK * zoneM || (c.a >= -rule.leadM && c.d < ROUND.pastK * zoneM);
}

export class RoundingTracker extends CourseTracker {
  constructor(course, { rule, ...o } = {}) { super(course, o); this.rule = rule; this.last = null; this.ok = null; this.guide = null; this.wrongNow = -1; }
  roundingAt(k) { return this.course.roundings?.[k] ?? this.course.rounding; }
  target() { const t = super.target(); if (t) t.rounding = this.roundingAt(this.k); return t; }
  update(boat, t) {
    if (this.done) return [];
    const out = [], g = this.geometry(), R = this.rule;
    if (!g) return out;
    if (this.t0 == null) this.t0 = t;
    const rounding = this.roundingAt(this.k), c = lineCoords([g.prev.x, g.prev.z], [g.mark.x, g.mark.z], rounding, boat.x, boat.z);
    const k = this.k, a = c.a + R.leadM, last = this.last?.k === k ? this.last : null;
    this.last = { k, a, s: c.s };
    // the side she crossed on (s at the crossing, interpolated): a forward crossing sets it, a crossing back clears it
    if (last && last.a < 0 && a >= 0) {
      const f = last.a / (last.a - a), s = last.s + (c.s - last.s) * f;
      if (s >= 0) this.ok = { k, sure: s <= R.reachM, close: false };
      else if (s >= -R.wrongOkM) this.ok = { k, sure: true, close: true };
      else {
        this.ok = { k, wrong: true };
        if (s >= -R.reachM && this.wrongNow !== k) { this.wrongNow = k; out.push(this.emit({ type: 'wrongSide', mark: g.id, index: k, side: rounding === 'port' ? 'starboard' : 'port', t })); }
      }
    } else if (last && last.a >= 0 && a < 0 && this.ok?.k === k) this.ok = null;
    // counted: a sure crossing (held by rules.js while a penalty is owed, it counts again on the next tick past the line), or a wide one
    // once she is within the reach on the right side
    const o = this.ok?.k === k && !this.ok.wrong ? this.ok : null;
    const counts = a >= 0 && o && (o.sure || (c.s >= 0 && c.d <= R.reachM));
    this.guide = { k, a: c.a, s: c.s, d: c.d, wrong: this.ok?.k === k && !!this.ok.wrong };
    if (counts) {
      out.push(this.emit({ type: 'rounded', mark: g.id, index: k, lap: this.target().lap, side: o.close ? (rounding === 'port' ? 'starboard' : 'port') : rounding, close: o.close, t, elapsed: t - this.t0 }));
      this.k++;
      if (this.k >= this.seq.length) { this.done = true; out.push(this.emit({ type: 'finished', t, elapsed: t - this.t0 })); }
    }
    return out;
  }
  reset() { super.reset(); this.last = null; this.ok = null; this.guide = null; this.wrongNow = -1; }
}

// the race's tracker factory for a level (rules.js createRace's `tracker`): Pro (null) keeps v1's CourseTracker
export function trackerFor(level, course) {
  const rule = roundRule(level);
  if (!rule) return null;
  const roundings = course.markIds.map((id) => course.byId[id].rounding);
  return (tc, o) => new RoundingTracker({ ...tc, roundings }, { ...o, rule });
}
