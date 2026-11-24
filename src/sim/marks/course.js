// Practice courses and mark rounding (feat/marks). Plain JS, no DOM: tests/marks-course.test.mjs.
//
//   const course = layCourse({ kind: 'windward-leeward' | 'triangle', origin: { x, z }, windFrom: rad, lengthM, rounding: 'port', laps });
//   → { kind, rounding, laps, lengthM, windFrom, marks: [{ id, type, role, colour, x, z }], line: { a: committee, b: pin },
//       sequence: [mark ids in rounding order, the laps unrolled], label }
//   const tracker = new CourseTracker(course, { positions: () => ({ id: { x, z } }), onEvent(ev) });
//   tracker.update(boat { x, z }, t)        // each frame; events: 'rounded', 'wrongSide', 'finished'
//   tracker.target() → the mark to round next, and the points a skipper steers through (roundMark, src/ai/skipper.js)
//
// Frames: x east, z south, bearings clockwise from north (−z). windFrom: the bearing the wind blows FROM. The course is
// laid for the current wind: the windward mark dead upwind of the start line, 0.4 to 0.8 nautical miles away. Rounding
// 'port' leaves each mark on the boat's left (a counter-clockwise turn round it), 'starboard' on its right.
export const NM = 1852;
export const LENGTH_RANGE = [0.4 * NM, 0.8 * NM];
const TAU = Math.PI * 2;
const wrap = (a) => a - TAU * Math.round(a / TAU);
const dir = (b) => [Math.sin(b), -Math.cos(b)];     // a bearing's unit vector (x east, z south)

export const COURSE_KINDS = {
  'windward-leeward': { name: 'windward-leeward', laps: 2 },
  triangle: { name: 'triangle', laps: 1 },
};

export function layCourse({ kind = 'windward-leeward', origin = { x: 0, z: 0 }, windFrom = 0, lengthM = 0.5 * NM, rounding = 'port', laps = null, lineM = 110, colour = 'orange' } = {}) {
  const K = COURSE_KINDS[kind] ?? COURSE_KINDS['windward-leeward'];
  const L = Math.max(LENGTH_RANGE[0], Math.min(LENGTH_RANGE[1], lengthM));
  const sgn = rounding === 'starboard' ? 1 : -1;   // port: the wing mark lies to the port side of the beat
  const u = dir(windFrom), c = [Math.cos(windFrom), Math.sin(windFrom)];   // upwind; across (starboard when facing upwind)
  const at = (a, b) => ({ x: origin.x + u[0] * a + c[0] * b, z: origin.z + u[1] * a + c[1] * b });
  const marks = [];
  const add = (id, type, role, p, col) => marks.push({ id, type, role, colour: col, x: p.x, z: p.z });
  // the start line: the committee boat at the starboard end, the pin buoy at the port end, across the wind
  const cb = at(0, lineM / 2), pin = at(0, -lineM / 2);
  add('committee', 'committee', 'start', cb, 'white'); add('pin', 'pin', 'start', pin, 'orange');
  let seq, lapsN = laps ?? K.laps;
  if (K.name === 'triangle') {
    // an equilateral triangle: the windward mark dead upwind, the wing mark a reach away on the course's rounding side,
    // the gybe mark just below the line (the sides are one length, 60° apart)
    add('m1', 'sphere', 'mark', at(L, 0), colour);
    add('m2', 'tetra', 'mark', at(L / 2, sgn * L * Math.sqrt(3) / 2), 'yellow');
    add('m3', 'cylinder', 'mark', at(-40, 0), colour);
    seq = ['m1', 'm2', 'm3'];
  } else {
    // windward-leeward: the windward mark, and a leeward mark a little below the line (a gate's worth, one mark here)
    add('windward', 'sphere', 'mark', at(L, 0), colour);
    add('leeward', 'cylinder', 'mark', at(-50, sgn * 30), 'yellow');
    seq = ['windward', 'leeward'];
  }
  const sequence = []; for (let i = 0; i < lapsN; i++) sequence.push(...seq);
  const label = `${K.name === 'triangle' ? 'Triangle' : 'Windward-leeward'}, ${(L / NM).toFixed(2)} nm, ${rounding}`;
  return { kind: K.name, rounding, laps: lapsN, lengthM: L, windFrom, origin: { ...origin }, marks, line: { a: 'committee', b: 'pin' }, sequence, label };
}

const bearing = (dx, dz) => Math.atan2(dx, -dz);

// Where a boat sails to round mark `m` (live positions p) coming from `prev` and going to `next`: the three points a
// skipper steers through, and the bearing (from the mark) of the line it must cross: the outside of the turn.
export function roundingGeometry(prev, m, next, rounding = 'port', R = 22) {
  const px = prev.x - m.x, pz = prev.z - m.z, nx = next.x - m.x, nz = next.z - m.z, pl = Math.hypot(px, pz) || 1, nl = Math.hypot(nx, nz) || 1;
  let bx = px / pl + nx / nl, bz = pz / pl + nz / nl;
  const side = rounding === 'starboard' ? 1 : -1;   // the turn's direction: dθ < 0 for port
  let outward;
  if (Math.hypot(bx, bz) < 0.15) outward = bearing(-px, -pz) + (side < 0 ? Math.PI / 2 : -Math.PI / 2);   // straight through: abeam, on the side the boat passes
  else outward = bearing(-bx, -bz);   // away from the middle of the two legs
  return { outward, side, approach: pointAt(m, outward - side * (Math.PI / 2 + 0.35), R), outside: pointAt(m, outward, R), exit: pointAt(m, outward + side * (Math.PI / 2 + 0.35), R) };
}
const pointAt = (m, b, r) => { const d = dir(b); return [m.x + d[0] * r, m.z + d[1] * r]; };

export class CourseTracker {
  // positions: () => { id: { x, z } } the live marks (they swing on their rodes); zoneM: how close counts as rounding
  constructor(course, { positions, onEvent = null, zoneM = 55, minM = 3 } = {}) {
    this.course = course; this.positions = positions; this.onEvent = onEvent; this.zoneM = zoneM; this.minM = minM;
    this.k = 0; this.prev = null; this.log = []; this.wrong = new Set(); this.t0 = null; this.done = false;
    this.start = null;
  }
  get seq() { return this.course.sequence; }
  get current() { return this.seq[this.k] ?? null; }
  emit(ev) { this.log.push(ev); this.onEvent?.(ev); return ev; }
  // the live points a rounding at the current mark uses (prev: the line's middle at the start, then the last mark)
  geometry() {
    const P = this.positions(), seq = this.seq, id = seq[this.k];
    if (!id || !P[id]) return null;
    const mid = (a, b) => ({ x: (P[a].x + P[b].x) / 2, z: (P[a].z + P[b].z) / 2 });
    const line = this.course.line, centre = P[line.a] && P[line.b] ? mid(line.a, line.b) : this.course.origin;
    const prev = this.k === 0 ? centre : P[seq[this.k - 1]] ?? centre;
    const next = this.k + 1 < seq.length ? P[seq[this.k + 1]] : centre;
    return { id, mark: P[id], prev, next, ...roundingGeometry(prev, P[id], next, this.course.rounding) };
  }
  // what the AI skipper reads (roundMark): the mark to round next and the points to steer through
  target() {
    const g = this.geometry();
    if (!g) return null;
    return { mark: g.id, at: g.mark, rounding: this.course.rounding, leg: this.k, lap: Math.floor(this.k / (this.seq.length / this.course.laps)) + 1,
      route: [g.approach, g.outside, g.exit], done: this.done };
  }
  update(boat, t) {
    if (this.done) return [];
    const out = [], g = this.geometry();
    if (!g) return out;
    const dx = boat.x - g.mark.x, dz = boat.z - g.mark.z, d = Math.hypot(dx, dz), theta = bearing(dx, dz);
    if (this.t0 == null) this.t0 = t;
    if (d <= this.zoneM && d >= this.minM && this.prev && this.prev.id === g.id && this.prev.in) {
      // crossing the outside bearing: the sign of the turn says which side the mark was left on
      const a = wrap(this.prev.theta - g.outward), b = wrap(theta - g.outward);
      if (Math.abs(a) < Math.PI / 2 && Math.abs(b) < Math.PI / 2 && a * b <= 0 && a !== b) {
        const turn = b < a ? -1 : 1;   // dθ < 0: counter-clockwise, the mark to port
        const sideNow = turn < 0 ? 'port' : 'starboard';
        if (sideNow === this.course.rounding) {
          out.push(this.emit({ type: 'rounded', mark: g.id, index: this.k, lap: this.target().lap, side: sideNow, t, elapsed: t - this.t0 }));
          this.k++; this.prev = null;
          if (this.k >= this.seq.length) { this.done = true; out.push(this.emit({ type: 'finished', t, elapsed: t - this.t0 })); }
          return out;
        }
        if (!this.wrong.has(`${this.k}`)) { this.wrong.add(`${this.k}`); out.push(this.emit({ type: 'wrongSide', mark: g.id, index: this.k, side: sideNow, t })); }
      }
    }
    this.prev = { id: g.id, theta, in: d <= this.zoneM && d >= this.minM };
    return out;
  }
  reset() { this.k = 0; this.prev = null; this.log = []; this.wrong.clear(); this.t0 = null; this.done = false; }
}

// a short line for the logbook / the quiet hint
export function eventLine(ev, course) {
  const name = { windward: 'the windward mark', leeward: 'the leeward mark', m1: 'the windward mark', m2: 'the wing mark', m3: 'the gybe mark' }[ev.mark] ?? 'a mark';
  if (ev.type === 'rounded') return `Rounded ${name} to ${ev.side}`;
  if (ev.type === 'wrongSide') return `${name[0].toUpperCase()}${name.slice(1)}: wrong side, go round again`;
  if (ev.type === 'finished') { const m = Math.floor(ev.elapsed / 60), s = Math.round(ev.elapsed % 60); return `Course sailed: ${course?.label ?? 'practice'}, ${m} min ${String(s).padStart(2, '0')} s`; }
  if (ev.type === 'markTouched') return 'Touched a mark';
  return '';
}

// Find room on the water for a course: the first origin (near the boat, then farther out) where every mark and every leg
// is in deep enough water. depthAt(x, z) → m of water (≤ 0: land). Shorter courses are tried before giving up
// (down to 0.4 nm). Returns the course, or null with no room.
export function findRoom({ depthAt, boat, windFrom, kind = 'windward-leeward', lengthM = 0.5 * NM, rounding = 'port', laps = null, minDepth = 8, legDepth = 4 } = {}) {
  const lengths = [lengthM, lengthM * 0.8, lengthM * 0.6, LENGTH_RANGE[0]].filter((v, i, a) => v >= LENGTH_RANGE[0] - 1e-6 && a.indexOf(v) === i).sort((a, b) => b - a);
  const heading = boat.heading ?? 0;
  const clearOf = (c) => {
    for (const m of c.marks) if (!(depthAt(m.x, m.z) >= minDepth)) return false;
    const P = Object.fromEntries(c.marks.map((m) => [m.id, m])), pts = [c.origin, ...c.sequence.map((id) => P[id])];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 80);
      for (let k = 1; k < n; k++) if (!(depthAt(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n) >= legDepth)) return false;
    }
    return true;
  };
  for (const L of lengths) for (const r of [120, 250, 450, 800, 1300, 2000]) for (let k = 0; k < 16; k++) {
    const b = heading + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 8), d = dir(b);
    const c = layCourse({ kind, origin: { x: boat.x + d[0] * r, z: boat.z + d[1] * r }, windFrom, lengthM: L, rounding, laps });
    if (clearOf(c)) return c;
  }
  return null;
}
