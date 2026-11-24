// Regatta's race types (§ 6 step C): a fleet race, a match race (1 v 1), a time trial (alone against
// the clock) and a pursuit (a staggered start: the slower boats first, first home wins). Pure: no DOM, no GPU; v2/tests/regatta-events.test.mjs.
//   EVENT_IDS, EVENTS[id] → { id, label, short, rivals? }   eventOf(id)   rivalsFor(event, n) → the rivals a race of this type sails
//   EVENT_DEAL[aids] → the deal's weights (Beginner: fleet and time trial; Club adds match and pursuit; Pro the same, more often)
//   dealEvent(r, aids) → an event id from a seeded generator
//   matchChip(gap) → the race chip of a match race ("Ahead 12 m", "Behind 8 m", "Level")
//   matchCard(m, rival) → a 1 v 1 results card's words over review.js resultCard's model (title, the disc, the medal, the margin)
//   pursuit: slowFactor(skill), courseTimeS(course, windFromRad, twsMs, polar), pursuitSlots(boats, T1) → { id: s after the gun },
//            pursuitOrder(slots, names, me) → { place, of, behind, gapS, text: "You start 3rd, 14 s after Osprey" }
//   time trial: TRIAL_KEY, trialKey(hand), loadTrial(store, key), recordTrial(store, key, run) → { best, isNew, prev }, clampTrial(j),
//            toFrame(line, x, z) / fromFrame(line, a, u) (the course's own frame: a run on another day's wind replays on today's),
//            ghostAt(path, t) → { x, z, heading } | null, splitDelta(t, best) → s (− faster), splitWord(n, t, best) → the split's words
import { polarKn, polarTargets } from '../../src/sim/ai/skipper.js';
import { KN } from '../../src/sim/boat.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mmss1 = (s) => { const a = Math.max(0, s); const m = Math.floor(a / 60), r = a - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };
export const EVENT_IDS = Object.freeze(['fleet', 'match', 'trial', 'pursuit']);
export const EVENTS = Object.freeze({
  fleet: Object.freeze({ id: 'fleet', label: 'Fleet race', short: 'Fleet' }),
  match: Object.freeze({ id: 'match', label: 'Match race', short: 'Match 1 v 1', rivals: 1 }),
  trial: Object.freeze({ id: 'trial', label: 'Time trial', short: 'Time trial', rivals: 0 }),
  pursuit: Object.freeze({ id: 'pursuit', label: 'Pursuit', short: 'Pursuit', minRivals: 2 }),
});
export const eventOf = (id) => EVENTS[id] ?? EVENTS.fleet;
export const isEvent = (id) => EVENT_IDS.includes(id);
// the rivals a race of this type sails: a match race one, a time trial none, a pursuit at least two (a chase needs a pack)
export function rivalsFor(event, n) {
  const e = eventOf(event);
  if (e.rivals != null) return e.rivals;
  if (e.minRivals != null) return clamp(Math.floor(Number(n) || 0), e.minRivals, 5);
  return n;
}
// the hub's deal by the player's aids (owner 2026-11-17): Beginner meets fleet races and time trials only; Club adds match races and
// pursuits; Pro the same, the duels a little more often. The Emerald Cup is its own card on the hub, never dealt
export const EVENT_DEAL = Object.freeze({
  beginner: Object.freeze({ fleet: 5, match: 0, trial: 1.5, pursuit: 0 }),
  club: Object.freeze({ fleet: 5, match: 0, trial: 1, pursuit: 1.5 }),   //): the match race is retired
  pro: Object.freeze({ fleet: 4, match: 0, trial: 1, pursuit: 2 }),       // from the hub's deal; Custom's Race type row keeps it
});
export function dealEvent(r, aids = 'beginner') {
  const w = EVENT_DEAL[aids] ?? EVENT_DEAL.beginner, tot = EVENT_IDS.reduce((a, id) => a + (w[id] ?? 0), 0);
  let x = r() * tot;
  for (const id of EVENT_IDS) { x -= w[id] ?? 0; if (x < 0) return id; }
  return 'fleet';
}

// the match race's chip (owner 2026-11-17: "Ahead 12 m" / "Behind 8 m"): gap = { m } the metres of progress, + when she leads
export function matchChip(gapM) {
  if (gapM == null || !Number.isFinite(gapM)) return 'Match · 1 v 1';
  const m = Math.round(Math.abs(gapM));
  return m < 1 ? 'Level' : gapM > 0 ? `Ahead ${m} m` : `Behind ${m} m`;
}

// the 1 v 1 results card (owner 2026-11-17): who won the match and by how much; gold for the win, nothing for the loss
export function matchCard(m, rival = 'Your rival') {
  const won = !!m.finished && m.place === 1;
  const title = won ? 'You win the match' : m.finished ? `${rival} wins the match` : 'Did not finish';
  const gap = won ? (m.leadS != null ? `By ${m.leadS.toFixed(1)} s` : `${rival} still racing`) : m.gapS != null ? `By ${m.gapS.toFixed(1)} s` : '';
  return { ...m, title, gap, medal: won ? 'gold' : null, mark: won ? '1' : m.finished ? '2' : '\u2013', won };
}

// ---- the pursuit ----
// the slower boats start first, by enough that boats sailing to their skill would cross the finish together. A boat's race time over
// a skill-1 boat's, measured on the Island Sprint and Harbour Dash at 0.35 (2026-11-17, 3 seeds each, the fleet's mind alone): skill
// 0.48 about 1.10 ×, 0.65 about 1.045 ×, 0.85 about 1.015 ×; slowFactor fits it as 1 + slowK (1 − skill)². spread: a pursuit's
// rivals spread their skill round the dial's tier this many times the fleet's own step (fleet.js FLEET_SKILL), so the chase has a
// real order; earlyS: a boat over her own start line more than this before her time owes a penalty turn (Club, Pro)
export const PURSUIT = Object.freeze({ slowK: 0.37, spread: 4, minSkill: 0.3, earlyS: 1, round: 1, courseK: 1.25 });
export const slowFactor = (skill) => 1 + PURSUIT.slowK * (1 - clamp(Number(skill) || 0, 0, 1)) ** 2;
// a skill-1 boat's time round the course (game seconds): each leg from the polar at the wind the line has (a beat at the best VMG up,
// a run at the best VMG down, a reach at the leg's angle), plus 6 s a mark for the rounding, × courseK (the tacks, the roundings and
// the valley's wind: a skill-0.98 boat alone took 1.23–1.27 × the polar's time on the Island Sprint and Harbour Dash, 2026-11-17)
export function courseTimeS(course, windFromRad, twsMs, polar) {
  const tws = Math.max(1, twsMs), tg = polarTargets(tws, polar), vmgUp = Math.max(0.3, tg.up.vmg * KN), vmgDn = Math.max(0.3, tg.down.vmg * KN);
  let T = 0;
  for (const g of course.legs ?? []) {
    const dx = g.to[0] - g.from[0], dz = g.to[1] - g.from[1], d = Math.hypot(dx, dz), brg = Math.atan2(dx, -dz);
    const off = Math.abs(Math.atan2(Math.sin(brg - windFromRad), Math.cos(brg - windFromRad)));
    if (off < tg.up.twa * DEG) T += (d * Math.cos(off)) / vmgUp;
    else if (off > tg.down.twa * DEG) T += (d * Math.abs(Math.cos(off))) / vmgDn;
    else T += d / Math.max(0.3, polarKn(tws, off / DEG, polar) * KN);
  }
  return (T + 6 * Math.max(0, (course.legs?.length ?? 1) - 1)) * PURSUIT.courseK;
}
// boats: [{ id, skill }] → { id: seconds after the gun } (the slowest 0); T1: a skill-1 boat's time (courseTimeS)
export function pursuitSlots(boats, T1) {
  const f = boats.map((b) => slowFactor(b.skill)), top = Math.max(...f), out = {};
  boats.forEach((b, i) => { out[b.id] = Math.round((T1 * (top - f[i])) / PURSUIT.round) * PURSUIT.round; });
  return out;
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export const ordOf = (n) => ORD[n - 1] ?? `${n}th`;
// the start order in words: "You start 3rd, 14 s after Osprey" (the boat that starts just before her); the first "You start first"
export function pursuitOrder(slots, names = {}, me = 'me') {
  const ids = Object.keys(slots ?? {}).sort((a, b) => slots[a] - slots[b] || (a === me ? 1 : b === me ? -1 : 0));
  const k = ids.indexOf(me);
  if (k < 0) return null;
  const prev = k > 0 ? ids[k - 1] : null, gapS = prev ? Math.round(slots[me] - slots[prev]) : 0, mine = Math.round(slots[me]);
  const text = k === 0 ? 'You start first. The fleet chases you.' : gapS < 1 ? `You start ${ordOf(k + 1)}, with ${names[prev] ?? prev}` : `You start ${ordOf(k + 1)}, ${gapS} s after ${names[prev] ?? prev}`;
  return { place: k + 1, of: ids.length, behind: prev ? names[prev] ?? prev : null, gapS, slotS: mine, order: ids, text };
}

// ---- the time trial ----
export const TRIAL_KEY = 'lakeshore.regatta.trial.v1';
export const TRIAL = Object.freeze({ everyS: 1, maxPts: 900, maxSplits: 24, maxT: 36000, drawPts: 120 });
export const trialKey = (h) => (h ? `${h.course}|${h.length}|${h.laps ?? 1}` : '');
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
// one stored run, checked on read: the time, the splits (the clock at each rounding, rising), the path ([along, up, clock] in the
// course's frame, rising clock); anything broken is dropped (a broken store never breaks the race)
export function clampTrial(j) {
  if (!j || typeof j !== 'object' || !fin(j.t) || j.t <= 0 || j.t > TRIAL.maxT) return null;
  const splits = []; for (const s of Array.isArray(j.splits) ? j.splits.slice(0, TRIAL.maxSplits) : []) { if (!fin(s) || s <= 0 || s > j.t || (splits.length && s < splits[splits.length - 1])) break; splits.push(Math.round(s * 10) / 10); }
  const path = []; for (const p of Array.isArray(j.path) ? j.path.slice(0, TRIAL.maxPts) : []) {
    if (!Array.isArray(p) || p.length < 3 || !p.slice(0, 3).every(fin) || Math.abs(p[0]) > 2e4 || Math.abs(p[1]) > 2e4 || p[2] < -600 || p[2] > j.t + 60) break;
    if (path.length && p[2] <= path[path.length - 1][2]) break;
    path.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10]);
  }
  return { t: Math.round(j.t * 10) / 10, splits, path };
}
const readAll = (store) => { try { const j = JSON.parse(store?.getItem(TRIAL_KEY) ?? '{}'); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } };
export const loadTrial = (store, key) => clampTrial(readAll(store)[key]);
// a run is kept only when it beats the best (or there is none)
export function recordTrial(store, key, run) {
  const all = readAll(store), prev = clampTrial(all[key]), r = clampTrial(run);
  if (!r) return { best: prev, isNew: false, prev };
  const isNew = !prev || r.t < prev.t;
  if (isNew) {
    const keep = {}; for (const k of Object.keys(all).slice(-40)) { const c = clampTrial(all[k]); if (c) keep[k] = c; }   // at most 40 courses kept, each checked
    keep[key] = r;
    try { store?.setItem(TRIAL_KEY, JSON.stringify(keep)); } catch { /* full or blocked */ }
  }
  return { best: isNew ? r : prev, isNew, prev };
}
// the course's frame: along the line (pin → committee) and up the course from the line's centre
export function toFrame(line, x, z) {
  const dx = x - line.centre[0], dz = z - line.centre[1], d = line.dir ?? [line.committee[0] - line.pin[0], line.committee[1] - line.pin[1]], dl = Math.hypot(d[0], d[1]) || 1;
  return [(dx * d[0] + dz * d[1]) / dl, dx * line.up[0] + dz * line.up[1]];
}
export function fromFrame(line, a, u) {
  const d = line.dir ?? [line.committee[0] - line.pin[0], line.committee[1] - line.pin[1]], dl = Math.hypot(d[0], d[1]) || 1;
  return [line.centre[0] + (d[0] / dl) * a + line.up[0] * u, line.centre[1] + (d[1] / dl) * a + line.up[1] * u];
}
// the ghost of the best run at race clock t: between the two recorded points round t (world [x, z, clock] points)
export function ghostAt(pts, t) {
  if (!pts?.length || t < pts[0][2] || t > pts[pts.length - 1][2]) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][2] <= t) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], k = b[2] > a[2] ? (t - a[2]) / (b[2] - a[2]) : 0;
  return { x: a[0] + (b[0] - a[0]) * k, z: a[1] + (b[1] - a[1]) * k, heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])) };
}
// a path thinned to at most n points for the picture (every k-th point and the last)
export function thin(pts, n = TRIAL.drawPts) {
  if (!pts || pts.length <= n) return pts ?? [];
  const k = Math.ceil(pts.length / n), out = [];
  for (let i = 0; i < pts.length; i += k) out.push(pts[i]);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}
// the results card's splits line: "Mark 1 −2.1 s · Mark 2 +0.4 s" (no best: each mark's time)
export const splitsLine = (splits) => (splits ?? []).map((x) => `Mark ${x.n} ${x.d == null ? mmss1(x.t) : `${x.d > 0 ? '+' : '\u2212'}${Math.abs(x.d).toFixed(1)} s`}`).join(' \u00b7 ');
export const splitDelta = (t, best) => (fin(t) && fin(best) ? Math.round((t - best) * 10) / 10 : null);
// "Mark 1 · 1:02.4 · 2.1 s faster" (no best: the time alone); n: the mark's number on screen ('F' the finish)
export function splitWord(n, t, best) {
  const d = splitDelta(t, best), head = `${n === 'F' ? 'Finish' : `Mark ${n}`} · ${mmss1(t)}`;
  if (d == null) return head;
  return Math.abs(d) < 0.05 ? `${head} · level with your best` : `${head} · ${Math.abs(d).toFixed(1)} s ${d < 0 ? 'faster' : 'slower'}`;
}
