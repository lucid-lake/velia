// The Emerald Cup (§ 6 C4; owner 2026-11-17): a series of 4 fleet races in a row, a mix of courses and conditions
// dealt for the series, low-point scoring (1st = 1 point, 2nd = 2 …, DNF = the fleet's size + 1; the lowest total wins), the standings
// after each race, the podium at the end; one object kept in the browser, checked and clamped on read. Pure: no DOM, no GPU;
// v2/tests/regatta-cup.test.mjs.
//   CUP_KEY, CUP   newCup(seed, setup) → a cup (its 4 races dealt)    loadCup(store) → cup | null    saveCup(store, cup) → cup
//   clampCup(j) → cup | null    points(place, fleet)    recordRace(cup, places) → a new cup (the next race's places added)
//   standings(cup, names) → [{ id, name, pts, places, rank }]    cupState(cup, names) → { done, raceN, of, me, next, leader }
//   podium(cup, names) → the top 3    cupHand(cup, setup) → the next race's hand (setup.js makeHand's fields)
//   cupPlaces(order, finished) → a race's places from the race's order (the player unfinished: DNF; the rivals by their order)
import { COURSES, LENGTHS, WINDS, TIMES, SKIES, STARTS, dealHand, rng, hash32, courseOf, makeHand } from './setup.js';
import { SHIFT_IDS } from './shifts.js';

export const CUP_KEY = 'lakeshore.regatta.cup.v1';
// the fleet: the player and 5 rivals (the full fleet, owner 2026-11-14); four races, none of them the long Bay Tour (14 min) nor at Full
export const CUP = Object.freeze({ name: 'Emerald Cup', races: 4, rivals: 5, ids: Object.freeze(['me', 'wren', 'tern', 'kestrel', 'heron', 'plover']) });
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => fin(v) && Math.floor(v) === v;
// the races' picks as stored (the dials only; the rivals' skill and the aids are the setup's at each race)
const pickOf = (h) => ({ course: h.course, length: h.length, laps: h.laps, wind: h.wind, shifts: h.shifts, time: h.time, sky: h.sky, start: h.prestartS ?? 0, raceSeed: h.raceSeed });
function clampPick(p) {
  if (!p || typeof p !== 'object') return null;
  const c = COURSES.find((x) => x.id === p.course);
  if (!c || !LENGTHS.some((l) => l.id === p.length) || !int(p.laps) || p.laps < 1 || p.laps > 3 || !WINDS.some((w) => w.level === p.wind) || !SHIFT_IDS.includes(p.shifts)
    || !TIMES.some((t) => t.id === p.time) || !SKIES.some((s) => s.id === p.sky) || !STARTS.some((s) => s.s === p.start) || !int(p.raceSeed) || p.raceSeed < 1) return null;
  return { course: p.course, length: p.length, laps: p.laps, wind: p.wind, shifts: p.shifts, time: p.time, sky: p.sky, start: p.start, raceSeed: p.raceSeed };
}
// one race's places: { id: place } for every boat (a place 1..fleet, or null: did not finish)
function clampPlaces(p, fleet = CUP.ids.length) {
  if (!p || typeof p !== 'object') return null;
  const out = {}, seen = new Set();
  for (const id of CUP.ids) {
    const v = p[id];
    if (v === null || v === undefined || v === 0) { out[id] = null; continue; }
    if (!int(v) || v < 1 || v > fleet || seen.has(v)) return null;
    seen.add(v); out[id] = v;
  }
  return out;
}
export function clampCup(j) {
  if (!j || typeof j !== 'object' || j.v !== 1 || !int(j.id)) return null;
  const races = (Array.isArray(j.races) ? j.races : []).slice(0, CUP.races).map(clampPick);
  if (races.length !== CUP.races || races.some((r) => !r)) return null;
  const results = [];
  for (const r of (Array.isArray(j.results) ? j.results : []).slice(0, CUP.races)) { const c = clampPlaces(r); if (!c) break; results.push(c); }
  return { v: 1, id: j.id >>> 0, name: CUP.name, races, results };
}
export function loadCup(store = globalThis.localStorage) {
  try { return clampCup(JSON.parse(store?.getItem(CUP_KEY) ?? 'null')); } catch { return null; }
}
export function saveCup(store = globalThis.localStorage, cup) {
  const c = clampCup(cup);
  try { if (c) store?.setItem(CUP_KEY, JSON.stringify(c)); else store?.removeItem(CUP_KEY); } catch { /* full or blocked */ }
  return c;
}
// four races dealt from the cup's seed with the player's dials: fleet races, a different course each time where it can, never Bay
// Tour nor Full length (a Cup is about 15–20 minutes in all), always the full fleet
export function newCup(seed, setup = {}) {
  const races = [];
  let last = '', k = 0;
  const r = rng(hash32(`cup#${seed}`));
  while (races.length < CUP.races && k < 64) {
    const h = dealHand(hash32(`cup#${seed}#${k++}`), { ...setup, aids: setup.aids === 'pro' ? 'pro' : 'club' }, { last });
    if (h.course === 'bay-tour' || h.length === 'full' || races.some((x) => x.course === h.course && races.length < 3 && x.length === h.length)) continue;
    last = `${h.course}`;
    races.push(pickOf({ ...h, prestartS: setup.aids === 'pro' ? h.prestartS : 0 }));
  }
  while (races.length < CUP.races) races.push(pickOf({ course: COURSES[0].id, length: 'short', laps: COURSES[0].laps, wind: 3, shifts: 'oscillating', time: 'afternoon', sky: 'fair', prestartS: 0, raceSeed: 1 + Math.floor(r() * 9999) }));
  return { v: 1, id: seed >>> 0, name: CUP.name, races, results: [] };
}
export function cupPlaces(order, finished = {}) {
  const places = Object.fromEntries(CUP.ids.map((id) => [id, null]));
  let k = 1;
  for (const id of order ?? []) if (id in places && places[id] == null && (id !== 'me' || finished.me)) places[id] = k++;
  return places;
}
export const points = (place, fleet = CUP.ids.length) => (int(place) && place >= 1 ? place : fleet + 1);
// the next race's places added (a cup already done is returned unchanged)
export function recordRace(cup, places) {
  if (!cup || cup.results.length >= cup.races.length) return cup;
  const p = clampPlaces(places);
  return p ? { ...cup, results: [...cup.results, p] } : cup;
}
// the standings: the total points, lowest first; a tie goes to the boat with more better places (more wins, then more seconds …),
// then to the better place in the last race (the Racing Rules' Appendix A8)
export function standings(cup, names = {}) {
  if (!cup) return [];
  const fleet = CUP.ids.length, rows = CUP.ids.map((id) => {
    const places = cup.results.map((r) => r[id] ?? null);
    return { id, name: id === 'me' ? 'You' : names[id] ?? id, places, pts: places.reduce((a, p) => a + points(p, fleet), 0) };
  });
  const byPlaces = (a, b) => {
    const sa = a.places.map((p) => points(p, fleet)).sort((x, y) => x - y), sb = b.places.map((p) => points(p, fleet)).sort((x, y) => x - y);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    for (let i = a.places.length - 1; i >= 0; i--) { const x = points(a.places[i], fleet), y = points(b.places[i], fleet); if (x !== y) return x - y; }
    return CUP.ids.indexOf(a.id) - CUP.ids.indexOf(b.id);
  };
  rows.sort((a, b) => a.pts - b.pts || byPlaces(a, b));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export function cupState(cup, names = {}) {
  if (!cup) return { none: true, done: false, raceN: 0, of: CUP.races };
  const st = standings(cup, names), me = st.find((r) => r.id === 'me'), n = cup.results.length, done = n >= cup.races.length;
  const next = done ? null : cup.races[n];
  return { none: false, done, raceN: done ? cup.races.length : n + 1, sailed: n, of: cup.races.length, me: me ? { rank: me.rank, ord: ORD[me.rank - 1], pts: me.pts } : null,
    next: next ? { ...next, name: courseOf(next.course).short } : null, leader: st[0], rows: st };
}
export const podium = (cup, names) => standings(cup, names).slice(0, 3);
// the next race's hand: the stored picks with the setup's two dials (the rivals' skill, the aids), the full fleet, a fleet race
export function cupHand(cup, setup = {}) {
  const n = cup?.results.length ?? 0, p = cup?.races[n];
  if (!p) return null;
  const h = makeHand(hash32(`cup#${cup.id}#race${n}`), { ...p, rivals: CUP.rivals, event: 'fleet', start: p.start, pace: undefined }, setup, p.raceSeed);
  return { ...h, cup: { id: cup.id, i: n, of: cup.races.length } };
}
// the hub's words for the Cup card
export function cupWords(cup, names = {}) {
  const s = cupState(cup, names);
  if (s.none) return { state: 'none', title: CUP.name, line: `${CUP.races} races, low points win`, button: 'Start the Cup ›', compact: CUP.name };
  if (s.done) return { state: 'done', title: `${CUP.name} · complete`, line: `You finished ${s.me.ord} on ${s.me.pts} pts`, button: 'Start a new Cup ›', compact: `${CUP.name} · ${s.me.ord}` };
  const nx = s.next, w = WINDS.find((x) => x.level === nx.wind)?.name ?? '';
  const st = s.sailed ? `you are ${s.me.ord} on ${s.me.pts} pts` : 'no races sailed yet';
  return { state: 'on', title: `${CUP.name} · race ${s.raceN} of ${s.of}`, line: `${st[0].toUpperCase()}${st.slice(1)}`, next: `Next: ${nx.name} · ${w}`, button: s.sailed ? 'Continue the Cup ›' : 'Start the Cup ›', compact: `Cup · race ${s.raceN}/${s.of}` };
}
