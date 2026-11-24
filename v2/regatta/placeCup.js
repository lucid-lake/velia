// "Sail the cup" (owner go 2026-11-19 with every default): a cup's races back to back (the ones this device
// can run, in the cup's order), the same fleet in each (PLACE_CUP.rivals rivals: every boat sails every race, so the points add up),
// low-point scoring as the Emerald Cup (cup.js points: 1st 1 point, 2nd 2 …, a DNF the fleet's size + 1; the lowest total wins, ties by
// more better places, then the last race), the standings after each race, the cup's result after the last. One series kept in the
// browser (a new one replaces it), checked on read. Pure (v2/tests/regatta-places-2.test.mjs).
//   PLACE_CUP_KEY, PLACE_CUP   newPlaceCup(cupId, raceIds, seed) → a series    loadPlaceCup(store) / savePlaceCup(store, pc)
//   recordPlaceRace(pc, places) → the series with this race's places   placeCupState(pc, names) → { done, raceN, of, next, rows, me }
//   placeCupWords(pc, names, cupName) → the results card's lines        placesOf(order, finished) as cup.js cupPlaces, for this fleet
import { points } from './cup.js';
import { FLEET } from './session.js';

const PLACE_CUP_KEY = 'lakeshore.regatta.placecup.v1';
export const PLACE_CUP = Object.freeze({ rivals: 4 });
const IDS = Object.freeze(['me', ...FLEET.slice(0, PLACE_CUP.rivals).map((f) => f.id)]);
const int = (v) => Number.isInteger(v);

export function newPlaceCup(cupId, raceIds, seed = 1) {
  return { v: 1, cup: String(cupId), races: [...raceIds], results: [], seed: seed >>> 0 };
}
function clampPlaces(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {}, seen = new Set();
  for (const id of IDS) { const v = p[id]; if (v == null || v === 0) { out[id] = null; continue; } if (!int(v) || v < 1 || v > IDS.length || seen.has(v)) return null; seen.add(v); out[id] = v; }
  return out;
}
function clampPlaceCup(j) {
  if (!j || typeof j !== 'object' || j.v !== 1 || typeof j.cup !== 'string' || !Array.isArray(j.races) || !j.races.length || j.races.some((r) => typeof r !== 'string')) return null;
  const results = [];
  for (const r of (Array.isArray(j.results) ? j.results : []).slice(0, j.races.length)) { const c = clampPlaces(r); if (!c) break; results.push(c); }
  return { v: 1, cup: j.cup, races: j.races.slice(), results, seed: (j.seed >>> 0) || 1 };
}
export function loadPlaceCup(store = globalThis.localStorage) { try { return clampPlaceCup(JSON.parse(store?.getItem(PLACE_CUP_KEY) ?? 'null')); } catch { return null; } }
export function savePlaceCup(store = globalThis.localStorage, pc) {
  const c = clampPlaceCup(pc);
  try { if (c) store?.setItem(PLACE_CUP_KEY, JSON.stringify(c)); else store?.removeItem(PLACE_CUP_KEY); } catch { /* full or blocked */ }
  return c;
}
// a race's places from its order (the player unfinished: no place; a rival that did not finish keeps its order's place only if it finished)
export function placesOf(order, finished = {}) {
  const out = Object.fromEntries(IDS.map((id) => [id, null]));
  let k = 1;
  for (const id of order ?? []) if (id in out && out[id] == null && finished[id] !== false) out[id] = k++;
  return out;
}
export function recordPlaceRace(pc, places) {
  if (!pc || pc.results.length >= pc.races.length) return pc;
  const p = clampPlaces(places);
  return p ? { ...pc, results: [...pc.results, p] } : pc;
}
function placeStandings(pc, names = {}) {
  if (!pc) return [];
  const fleet = IDS.length, rows = IDS.map((id) => { const places = pc.results.map((r) => r[id] ?? null); return { id, name: id === 'me' ? 'You' : names[id] ?? id, places, pts: places.reduce((a, p) => a + points(p, fleet), 0) }; });
  const by = (a, b) => {
    const sa = a.places.map((p) => points(p, fleet)).sort((x, y) => x - y), sb = b.places.map((p) => points(p, fleet)).sort((x, y) => x - y);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    for (let i = a.places.length - 1; i >= 0; i--) { const x = points(a.places[i], fleet), y = points(b.places[i], fleet); if (x !== y) return x - y; }
    return IDS.indexOf(a.id) - IDS.indexOf(b.id);
  };
  rows.sort((a, b) => a.pts - b.pts || by(a, b)); rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export function placeCupState(pc, names = {}) {
  if (!pc) return { none: true, done: false, raceN: 0, of: 0, next: null, rows: [], me: null };
  const rows = placeStandings(pc, names), me = rows.find((r) => r.id === 'me'), n = pc.results.length, done = n >= pc.races.length;
  return { none: false, done, raceN: done ? pc.races.length : n + 1, sailed: n, of: pc.races.length, next: done ? null : pc.races[n], rows, me: me ? { rank: me.rank, ord: ORD[me.rank - 1], pts: me.pts } : null };
}
