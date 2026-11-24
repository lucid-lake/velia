// The map's day (owner, 2026-11-07): "every map is fixed at the highlight day for now, but in the system we can keep a
// normal day." Each lake profile names two days in its `day` block: `highlight` (the default: Tahoe's is the Fourth of
// July, 2026-07-04) and `normal` (kept in the system: Tahoe's 2026-06-15, the day Velia had before). Each day carries
// its date and its season (snow line, straw, bloom: src/terrain.js). Plain JS, no three.js, no DOM.
//
//   ?day=highlight (the default) | normal | YYYY-MM-DD (any date: the season of the nearer named day); ?show=fireworks
//   (the share link, S5) is always the highlight day
//   pickDay(waters, choice) → { key, date, name, utcOffsetH, season }
//   dayChoice()             → this page's (or worker's, or node's) choice: ?day, a worker's name, globalThis.__lakeshoreDay
//
// The UTC offset stays the profile's (Tahoe: PDT, −7) for any date: a winter date would be PST in life.
// A worker has no URL flags: the page names it '<variant> <lake id> <day>' (src/terrain-data.js workerName), so the
// bake workers' snow (tree scatter) follows the page's day.
import { FLAGS } from './core/flags.js';

const DAY_KEYS = ['highlight', 'normal'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s) => typeof s === 'string' && ISO.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// the profile's named days; an older profile ({ date, utcOffsetH } and a top-level season) is its own highlight and normal
function namedDays(waters) {
  const d = waters.day ?? {};
  if (d.highlight) return { highlight: d.highlight, normal: d.normal ?? d.highlight };
  const one = { date: d.date, name: waters.season?.name ?? d.date, season: waters.season };
  return { highlight: one, normal: one };
}

// day of year (0..365) of an ISO date
const doy = (s) => (Date.parse(`${s}T00:00:00Z`) - Date.parse(`${s.slice(0, 4)}-01-01T00:00:00Z`)) / 86400000;

export function pickDay(waters, choice = null) {
  const named = namedDays(waters), utcOffsetH = waters.day?.utcOffsetH ?? 0;
  const c = typeof choice === 'string' ? choice.trim().toLowerCase() : null;
  if (c && DAY_KEYS.includes(c)) {
    const d = named[c];
    return { key: c, date: d.date, name: d.name ?? d.date, utcOffsetH, season: { ...(d.season ?? waters.season) } };
  }
  if (c && isIsoDate(c)) {   // any date: the season of the named day nearer in the year
    const dist = (k) => { const x = Math.abs(doy(c) - doy(named[k].date)); return Math.min(x, 365 - x); };
    const k = dist('normal') < dist('highlight') ? 'normal' : 'highlight';
    return { key: c, date: c, name: c, utcOffsetH, season: { ...(named[k].season ?? waters.season) } };
  }
  return pickDay(waters, 'highlight');
}

const g = globalThis;
const isWorker = typeof g.WorkerGlobalScope !== 'undefined' && g instanceof g.WorkerGlobalScope;
export function dayChoice() {
  if (typeof g.__lakeshoreDay === 'string') return g.__lakeshoreDay;   // node: a test's day
  if (isWorker) return String(g.name ?? '').split(' ')[2] ?? null;
  try { return FLAGS.show === 'fireworks' ? 'highlight' : FLAGS.day ?? null; } catch { return null; }   // the share link is the show's day (S5)
}
// is this choice the highlight day's date? (?day=highlight, the default, or its date written out: ?day=2026-07-04)
export const isHighlightDay = (waters, choice = dayChoice()) => pickDay(waters, choice).date === pickDay(waters, 'highlight').date;
// the token a worker's name carries (one word: the key or the date)
export const dayToken = () => { const c = dayChoice(); return c && (DAY_KEYS.includes(c) || isIsoDate(c)) ? c : 'highlight'; };
