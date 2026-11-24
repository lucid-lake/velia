// Course progress, positions and the gap. Plain JS, no clock: every time is passed in.
//   progressM(course, leg, x, z)  metres sailed along the rhumb line of the course (0 at the line, totalM at the finish)
//   rank(boats)                   boats: [{ id, finishedAt?, progressM }] → ids, first to last (finished first, by time)
//   const g = new GapLog(); g.record(id, t, progressM); g.gapS(leaderId, trailerProgressM, tNow) → seconds the trailer is behind
import { BOAT_LENGTH_M } from './course.js';

export function progressM(course, leg, x, z) {
  if (leg >= course.legs.length) return course.totalM;
  const L = course.legs[Math.max(0, leg)], ux = (L.to[0] - L.from[0]) / (L.len || 1), uz = (L.to[1] - L.from[1]) / (L.len || 1);
  const along = (x - L.from[0]) * ux + (z - L.from[1]) * uz;
  return L.cum + Math.min(Math.max(along, 0), L.len);
}
export const toLengths = (m) => m / BOAT_LENGTH_M;
export const distToNext = (course, leg, x, z) => (leg >= course.legs.length ? 0 : Math.hypot(course.legs[leg].to[0] - x, course.legs[leg].to[1] - z));

export function rank(boats) {
  return [...boats].sort((a, b) => {
    const fa = a.finishedAt != null, fb = b.finishedAt != null;
    if (fa && fb) return a.finishedAt - b.finishedAt;
    if (fa !== fb) return fa ? -1 : 1;
    return b.progressM - a.progressM;
  }).map((b) => b.id);
}

// each boat's progress against time; the gap of a trailer is how long ago the leader was where the trailer is now
export class GapLog {
  constructor() { this.log = new Map(); }
  record(id, t, p) {
    const a = this.log.get(id) ?? []; this.log.set(id, a);
    const last = a.at(-1);
    if (last && p <= last[1]) { if (t > last[0] && p === last[1]) return; p = Math.max(p, last[1]); }   // monotonic: a boat that sails back keeps its best
    a.push([t, p]);
  }
  // the time the boat first reached progress p (interpolated), or null if it has not
  timeAt(id, p) {
    const a = this.log.get(id); if (!a?.length || a.at(-1)[1] < p) return null;
    for (let i = 1; i < a.length; i++) if (a[i][1] >= p) { const [t0, p0] = a[i - 1], [t1, p1] = a[i]; return p1 === p0 ? t1 : t0 + (t1 - t0) * (p - p0) / (p1 - p0); }
    return a[0][0];
  }
  gapS(leaderId, trailerP, tNow) { const t = this.timeAt(leaderId, trailerP); return t == null ? 0 : Math.max(0, tNow - t); }
}
export function fmtGap(s, m) { const sgn = s < 0 ? '-' : '+', a = Math.abs(Math.round(s)); const n = Math.round(Math.abs(m) / BOAT_LENGTH_M); return `${sgn}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')} · ${n} ${n === 1 ? 'length' : 'lengths'}`; }
