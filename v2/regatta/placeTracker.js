// A place race's tracker (owner go 2026-11-19): the marks in order, as the game's rounding (rounding.js), and the
// GATES: two buoys a boat passes between, red to port going through (red right returning: the outbound way). Pure: no DOM, no GPU
// (v2/tests/regatta-places.test.mjs).
//   gateDir(gate)                       → [dx, dz]: the unit way through the gate (red on the port hand, green on starboard)
//   gateCross(gate, p0, p1, { padM })   → null, or { through: bool (between the buoys), right: bool (the outbound way), f (0..1 of the step) }:
//                                         the step p0 → p1 crossed the gate's line (between the buoys, or out to padM beyond either one)
//   new PlaceTracker(course, { positions, rule, gates })   the CourseTracker's api (update, target, k, done, log, reset); a gate counts
//                                         when she crosses it between the buoys the outbound way ('rounded'); beside it, out to GATE_RULE.padM
//                                         past a buoy, is 'gateMissed' (go back through it: the gate stays the target, so a boat that
//                                         skipped gate 1 must come back through it, then sail gate 2 again); through it the wrong way
//                                         is 'gateWrong' (no count). A gate's target route: GATE_RULE.leadM before its middle, the middle,
//                                         leadM after it (the fleet's skipper steers through the three points)
//   placeTrackerFor(level, course)      → createRace's tracker factory: every boat (the fleet too) on the same rule (the level's gate
//                                         slack: GATE_RULE.slack); Pro keeps the
//                                         game's Club line for the marks (a place race has no zone sweep)
import { RoundingTracker, roundRule } from './rounding.js';

// slackM: how far past a buoy a crossing still counts as through the gate, by level (a game's forgiveness, as rounding.js's wrong-side
// margin: Beginner 12 m, Club 6 m, Pro 1.5 m: the hull's half beam); leadM: the route's approach (on the gate's axis) and exit points
export const GATE_RULE = Object.freeze({ padM: 120, leadM: [40, 12, 30], slack: Object.freeze({ beginner: 12, club: 6, pro: 1.5 }), slackM: 1.5 });
const DEG = Math.PI / 180;

export function gateDir(g) {
  const vx = g.red[0] - g.green[0], vz = g.red[1] - g.green[1], l = Math.hypot(vx, vz) || 1;
  // the port hand of a heading's way (dx, dz) is (dz, −dx) (x east, z south); the red buoy on it: the way is (−vz, vx) / l
  return [-vz / l, vx / l];
}

export function gateCross(g, p0, p1, { padM = GATE_RULE.padM, slackM = GATE_RULE.slackM } = {}) {
  const d = gateDir(g), c = [(g.green[0] + g.red[0]) / 2, (g.green[1] + g.red[1]) / 2];
  const s0 = (p0[0] - c[0]) * d[0] + (p0[1] - c[1]) * d[1], s1 = (p1[0] - c[0]) * d[0] + (p1[1] - c[1]) * d[1];
  if (s0 === s1 || (s0 >= 0) === (s1 >= 0)) return null;
  const f = s0 / (s0 - s1), x = p0[0] + (p1[0] - p0[0]) * f, z = p0[1] + (p1[1] - p0[1]) * f;
  const half = Math.hypot(g.red[0] - g.green[0], g.red[1] - g.green[1]) / 2, ax = [-d[1], d[0]];   // along the gate's line
  const a = Math.abs((x - c[0]) * ax[0] + (z - c[1]) * ax[1]);
  if (a > half + padM) return null;
  return { through: a <= half + slackM, right: s1 > s0, f };
}

class PlaceTracker extends RoundingTracker {
  constructor(course, { gates = {}, slackM = GATE_RULE.slackM, ...o } = {}) { super(course, o); this.gates = gates; this.slackM = slackM; this.lastPos = null; this.gateSaid = new Set(); }
  gateAt(k = this.k) { const id = this.seq[k]; return id ? this.gates[id] ?? null : null; }
  target() {
    const g = this.gateAt();
    if (!g) return super.target();
    const id = this.seq[this.k], d = gateDir(g), c = [(g.green[0] + g.red[0]) / 2, (g.green[1] + g.red[1]) / 2], [a, b, e] = GATE_RULE.leadM;
    // on the gate's axis: a point well before it, one just before it (she lines up), one after it (she carries through)
    return { mark: id, at: { x: c[0], z: c[1] }, rounding: 'gate', gate: true, leg: this.k, lap: 1, route: [[c[0] - d[0] * a, c[1] - d[1] * a], [c[0] - d[0] * b, c[1] - d[1] * b], [c[0] + d[0] * e, c[1] + d[1] * e]], done: this.done };
  }
  update(boat, t) {
    if (this.done) return [];
    const p = [boat.x, boat.z], p0 = this.lastPos ?? p;
    this.lastPos = p;
    const g = this.gateAt();
    if (!g) { this.guide = null; return super.update(boat, t); }
    if (this.t0 == null) this.t0 = t;
    this.last = null; this.ok = null;   // the rounding line's memory belongs to the marks
    const out = [], id = this.seq[this.k], x = gateCross(g, p0, p, { slackM: this.slackM });
    this.guide = null;
    if (!x) return out;
    if (x.through && x.right) {
      out.push(this.emit({ type: 'rounded', mark: id, index: this.k, lap: 1, side: 'gate', t, elapsed: t - this.t0 }));
      this.k++; this.prev = null;
      if (this.k >= this.seq.length) { this.done = true; out.push(this.emit({ type: 'finished', t, elapsed: t - this.t0 })); }
    } else if (x.through && !x.right) out.push(this.emit({ type: 'gateWrong', mark: id, index: this.k, t }));
    else if (x.right) out.push(this.emit({ type: 'gateMissed', mark: id, index: this.k, t }));
    return out;
  }
  reset() { super.reset(); this.lastPos = null; this.gateSaid.clear(); }
}

export function placeTrackerFor(level, course) {
  const rule = roundRule(level) ?? roundRule('club');
  const roundings = course.markIds.map((id) => course.byId[id].rounding);
  const gates = Object.fromEntries(course.marks.filter((m) => m.kind === 'gate').map((m) => [m.id, { green: m.green, red: m.red }]));
  const slackM = GATE_RULE.slack[level] ?? GATE_RULE.slackM;
  return (tc, o) => new PlaceTracker({ ...tc, roundings }, { ...o, rule, gates, slackM });
}
