// Results, best times and the logbook line (§ 5). Pure but for the optional store (localStorage `lakeshore.regatta.v1`).
//   const r = buildResult({ course, order, views, names, tier, seed })     // { order, rows, winner, marginS, photo }
//   recordBest(store, { course: r.course, tier, t })                         // → { best, isNew }; only a better time replaces it
//   logLine(r, 'me')                                                         // "The Island Sprint: 1st, 7:42.3, Osprey +0:08.1"
import { cardRows, mmss1 } from './plates.js';

export const KEY = 'lakeshore.regatta.v1';
export const PHOTO_S = 2;   // a gap under this at the line is a photo finish

export function buildResult({ course, order, views, names, tier = 'medium', seed = 1 }) {
  const lead = views[order[0]], second = views[order[1]];
  const marginS = lead?.finishedAt != null && second?.finishedAt != null ? second.finishedAt - lead.finishedAt : null;
  return { course: course.id, courseName: course.name, tier, seed, order: [...order], winner: order[0], marginS, photo: marginS != null && marginS < PHOTO_S,
    times: Object.fromEntries(order.map((id) => [id, views[id].finishedAt])), ...cardRows({ order, views, names }) };
}

export function logLine(r, me = 'me') {
  const i = r.order.indexOf(me), row = r.rows[i], other = r.rows.find((x) => x.id !== me);
  const ord = ['1st', '2nd', '3rd'][i] ?? `${i + 1}th`;
  if (row.time === 'DNF') return `${r.courseName}: did not finish`;
  return `${r.courseName}: ${ord}, ${mmss1(r.times[me])}${other ? `, ${other.name} ${i === 0 ? other.time : mmss1(r.times[other.id])}` : ''}`;
}

const read = (store) => { try { return JSON.parse(store?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
const bestKey = (course, tier) => `${course}:${tier}`;
export const loadBest = (store, course, tier) => read(store)[bestKey(course, tier)] ?? null;
// the best time per course and tier updates only when the new time is better
export function recordBest(store, { course, tier, t }) {
  const all = read(store), k = bestKey(course, tier), prev = all[k] ?? null, isNew = prev == null || t < prev;
  if (isNew) { all[k] = t; try { store?.setItem(KEY, JSON.stringify(all)); } catch { /* full or blocked */ } }
  return { best: isNew ? t : prev, isNew, prev };
}
export const bestLine = ({ best, isNew, prev }) => (isNew ? (prev == null ? `First time round: ${mmss1(best)}` : `New best: ${mmss1(best)} (was ${mmss1(prev)})`) : `Best: ${mmss1(best)}`);
