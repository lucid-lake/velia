// A race course from its JSON: load and validate, snap the marks to good water, and lay the legs. Plain JS.
//   const c = loadCourse(json)                       // validates; throws a clear Error
//   const s = snapCourse(c, { depthAt, shoreDist })  // marks moved to ≥ 8 m depth and ≥ 60 m off the shore
//   courseFor('tahoe-emerald', 'island-sprint')       // the shipped courses
//   c.legs[i] = { from: [x, z], to: [x, z], to: id, len, mark }, c.totalM, c.cum[i] (metres before leg i)
//   c.tracker()  → the CourseTracker's course shape (src/marks/course.js), the rounding side and the order
//   laps: the JSON's legs are one lap; a course of n laps sails the marks n times over, then the finish (c.lapLegs keeps one lap;
//   loadCourse(json, { laps }) sails another number). scales: the course's [short, club, full] scale (v2's Length dial; default the
//   Island Sprint's 0.35, 0.6, 1)
import index from '../../race/courses/index.json' with { type: 'json' };
import islandSprint from '../../race/courses/tahoe-emerald/island-sprint.json' with { type: 'json' };
import harbourDash from '../../race/courses/tahoe-emerald/harbour-dash.json' with { type: 'json' };
import twiceRound from '../../race/courses/tahoe-emerald/twice-round.json' with { type: 'json' };
import bayTour from '../../race/courses/tahoe-emerald/bay-tour.json' with { type: 'json' };
import { makeLine } from './line.js';
import { DEFAULT_DIMS } from '../boat/dims.js';

export const BOAT_LENGTH_M = Math.round(DEFAULT_DIMS.HULL.loa * 10) / 10;   // 8.6: this page's boat's length overall, to 0.1 m (the gaps in lengths)
const FILES = { 'tahoe-emerald': { 'island-sprint': islandSprint, 'harbour-dash': harbourDash, 'twice-round': twiceRound, 'bay-tour': bayTour } };
export const DEFAULT_SCALES = Object.freeze([0.35, 0.6, 1]);
export const MAX_LAPS = 3;

export function courseIds(waters) { return index[waters] ?? []; }
export function courseFor(waters, id, opts) {
  const j = FILES[waters]?.[id ?? courseIds(waters)[0]];
  if (!j) throw new Error(`race: no course ${id} on ${waters}`);
  return loadCourse(j, opts);
}

const pt = (v, what) => { if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) throw new Error(`race course: ${what} is not [x, z]`); return v; };

export function loadCourse(j, { laps = null } = {}) {
  for (const k of ['id', 'waters', 'name']) if (typeof j[k] !== 'string' || !j[k]) throw new Error(`race course: missing ${k}`);
  if (!Number.isFinite(j.designWindFrom)) throw new Error('race course: designWindFrom');
  pt(j.line?.committee, 'line.committee'); pt(j.line?.pin, 'line.pin');
  if (!Array.isArray(j.marks) || !j.marks.length) throw new Error('race course: no marks');
  const marks = j.marks.map((m) => {
    if (!m.id || m.id === 'finish') throw new Error('race course: a mark needs an id (not "finish")');
    if (!['port', 'starboard'].includes(m.rounding)) throw new Error(`race course: mark ${m.id} rounding`);
    // a gate (v2's place races, v2/regatta/places.js): two buoys to pass between, red to port going through it (red right returning:
    // the outbound way); its `at` is the gate's middle (the legs, the progress and the beacon aim there)
    if (m.kind === 'gate') {
      const g = pt(m.green, `gate ${m.id} green`), r = pt(m.red, `gate ${m.id} red`);
      return { id: m.id, kind: 'gate', colour: 'gate', green: [...g], red: [...r], at: [(g[0] + r[0]) / 2, (g[1] + r[1]) / 2], rounding: m.rounding, names: m.names ?? null };
    }
    return { id: m.id, kind: m.kind ?? 'sphere', colour: m.colour ?? 'orange', at: [...pt(m.at, `mark ${m.id}`)], rounding: m.rounding };
  });
  if (new Set(marks.map((m) => m.id)).size !== marks.length) throw new Error('race course: duplicate mark id');
  if (!Array.isArray(j.legs) || j.legs.length < 2 || j.legs.at(-1).to !== 'finish') throw new Error('race course: the last leg goes to the finish');
  for (const l of j.legs.slice(0, -1)) if (!marks.some((m) => m.id === l.to)) throw new Error(`race course: leg to unknown mark ${l.to}`);
  const n = Math.round(laps ?? j.laps ?? 1);
  if (!(n >= 1 && n <= MAX_LAPS)) throw new Error(`race course: laps ${laps ?? j.laps} (1 to ${MAX_LAPS})`);
  const scales = j.scales ?? DEFAULT_SCALES;
  if (!Array.isArray(scales) || scales.length !== 3 || !scales.every((v, i) => Number.isFinite(v) && v > 0 && v <= 1 && (i === 0 || v >= scales[i - 1]))) throw new Error('race course: scales');
  // one lap's legs (the JSON's), and the race's: the marks n times over, then the finish
  const lapLegs = j.legs.map((l) => ({ to: l.to })), round = lapLegs.slice(0, -1), legSpec = [];
  for (let i = 0; i < n; i++) legSpec.push(...round.map((l) => ({ ...l })));
  legSpec.push({ to: 'finish' });
  const course = { id: j.id, waters: j.waters, name: j.name, blurb: typeof j.blurb === 'string' ? j.blurb : '', designWindFrom: j.designWindFrom, laps: n, lapsDefault: Math.round(j.laps ?? 1), timeLimitS: j.timeLimitS ?? 900,
    scales: [...scales], marks, lineSpec: { committee: [...j.line.committee], pin: [...j.line.pin] }, lapLegs, legSpec };
  // v2's place races (v2/regatta/places.js): lineUp, the start line's course side as a bearing (deg; the line is pinned to its place,
  // not square to the wind); finish, a finish line of its own ({ a, b, up }: up the bearing a boat crosses it on); place: the race's id
  if (j.lineUp != null) { if (!Number.isFinite(j.lineUp)) throw new Error('race course: lineUp'); course.lineUp = j.lineUp; }
  if (j.finish) { pt(j.finish.a, 'finish.a'); pt(j.finish.b, 'finish.b'); if (!Number.isFinite(j.finish.up)) throw new Error('race course: finish.up'); course.finishSpec = { a: [...j.finish.a], b: [...j.finish.b], up: j.finish.up }; }
  if (j.place) course.place = j.place;
  return lay(course);
}

// geometry from the (possibly snapped) marks
function lay(course) {
  const line = makeLine(course.lineSpec, course.lineUp ?? course.designWindFrom), byId = Object.fromEntries(course.marks.map((m) => [m.id, m]));
  // a finish line of its own (a place race): `committee` and `pin` its ends (the props and the tags read them), `up` the way through it
  const finish = course.finishSpec ? makeLine({ committee: course.finishSpec.b, pin: course.finishSpec.a }, course.finishSpec.up) : null;
  const end = finish ? finish.centre : line.centre;
  let from = line.centre, cum = 0;
  const legs = course.legSpec.map((l, i) => {
    const to = l.to === 'finish' ? end : byId[l.to].at, len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const leg = { index: i, from, to, toId: l.to, len, cum, rounding: l.to === 'finish' ? null : byId[l.to].rounding, bearing: Math.atan2(to[0] - from[0], -(to[1] - from[1])) };
    from = to; cum += len; return leg;
  });
  return { ...course, line, finish, legs, cum: legs.map((l) => l.cum), totalM: cum, markIds: course.legSpec.filter((l) => l.to !== 'finish').map((l) => l.to), byId };
}

// move each mark the least distance to water at least minDepth deep and minShore m off the shore (a spiral of 8 m steps)
export function snapCourse(course, { depthAt, shoreDist, minDepth = 8, minShore = 60, maxM = 400 } = {}) {
  const ok = (x, z) => depthAt(x, z) >= minDepth && shoreDist(x, z) >= minShore;
  const marks = course.marks.map((m) => {
    const [x, z] = m.at;
    if (ok(x, z)) return { ...m, at: [x, z], snapped: 0 };
    for (let r = 8; r <= maxM; r += 8) for (let k = 0; k < 32; k++) {
      const a = (k / 32) * 2 * Math.PI, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { ...m, at: [px, pz], snapped: r };
    }
    throw new Error(`race course: no water for mark ${m.id}`);
  });
  return lay({ ...course, marks });
}

// the CourseTracker's course (src/marks/course.js): the order the marks are rounded in, the side, the start line's ids
export function trackerCourse(course) {
  return { kind: 'regatta', rounding: course.byId[course.markIds[0]].rounding, laps: course.laps, sequence: [...course.markIds],
    line: { a: 'committee', b: 'pin' }, origin: { x: course.line.centre[0], z: course.line.centre[1] }, label: course.name, windFrom: course.designWindFrom };
}
