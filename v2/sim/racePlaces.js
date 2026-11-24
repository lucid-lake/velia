// Regatta's place races and cups ("Games by place"; owner go 2026-11-19 with every default): a race PINNED to its place
// on the real map. Its marks, gates and lines never turn to the wind and never move for fair wind (Custom keeps that); the race sets
// its own hour instead, and the hour sets the wind (src/sim/wind.js's day: from about 15° at night and in the morning, about 200° in
// the afternoon). The Regatta engine runs it as any race (index.js: the start, the marks and gates, the finish, the rivals on the same
// physics, the results). Pure: no DOM, no GPU (v2/tests/regatta-places.test.mjs).
//
// ---- The registry API (the hub reads this; nothing else needs to be known) ----
//   CUPS                       [{ id, name, line, races: [raceId …] }]  the cups in hub order (Emerald Bay, The Mouth)
//   PLACE_RACES                the data rows (below), frozen; one row per race
//   listCups({ store, has })   → [{ id, name, line, races: [RaceInfo …] }]: every cup with its races, for the hub's plates and rows
//     RaceInfo = { id, name, cup, line, lengthM, km, mins, hour, rivals, hooks, available, best: { timeS, medal, at } | null }
//       lengthM / km : the course's metres along its legs (start line's middle → marks and gates → the finish line's middle)
//       mins         : about how long it takes at the race's pace in Fresh air (setup.js minutesFor's rule)
//       hour         : the race's own hour (local, 2026-07-04): it sets the wind
//       at           : [x, z] the start line's middle (world metres): the race's pin on the chart
//       hooks        : the race's hero features (['salute'], ['tessie']); available: false when the device lacks a feature the race
//                      needs (has(name) → bool: features.js feature(name).on; a phone has no Tessie, so Tessie's Deep is off there:
//                      the hub hides an unavailable race, as)
//       best         : the player's best finish on this race (this browser): the time (s), its medal ('gold' | 'silver' | 'bronze' |
//                      null) and the day it was set; null before a first finish
//   raceInfo(id, o)            → one RaceInfo (the same fields) or null;  isPlace(id) → bool;  placeOf(id) → the row or null
//   placeCourse(id, windFromDeg) → the laid course (src/sim/race/course.js loadCourse's shape + finish, gates as marks of kind 'gate')
//   placeHand(id, setup, { seed }) → the race's hand (setup.js's shape, hand.place = id): what index.js R.racePlace(id) sails
//   recordPlace(store, id, { timeS, medal }) → { isNew, best }  (index.js calls it at a finish);  loadPlaces(store) → { [id]: best }
//   listCups({ …, hunts }) each cup's hunt { id, name, found, of } (hunts.js);  hasFrom(feature) the device's needs;  cupAt(x, z) the
//   cup of the area a point is in (the hub opens on it)
//   Phase 2 (owner go 2026-11-19, 4.6, 4.7): Glass Boat Chase (needs the glass boat: desktop and tablet), Storm Run
//   (needs the storm: desktop and tablet), Lights on the Lake (the show where the device has fireworks; a phone races it lit, no show)
//   Starting one: R.racePlace(id) on the Regatta mode (index.js; from the hub or anywhere in Regatta), or the URL ?course=<id>.
//
// A row: { id, cup, name, line, hour, rivals, start: { a, b }, legs: [{ to, kind: 'gate', green, red, names } | { to, kind: 'mark', at,
// rounding }], finish: { a, b } | { centre, lengthM }, hooks: [...], needs: [feature names], phone: words } (world metres: x east,
// z south, Fannette's summit at 0, 0). The start line's course side faces its first mark; the finish line is crossed the way of the
// last leg. Coordinates:'s resolved stations).
import { loadCourse } from '../../src/sim/race/course.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { cupsOf, cupAtOf, huntNamesOf } from './regions.js';   // the region table (refactor round 3 C5): the cups and their areas

const DEG = Math.PI / 180;
const brg = (dx, dz) => ((Math.atan2(dx, -dz) / DEG) + 360) % 360;

// the cups in hub order: each region row's cup in the lake profile's region table (v2/sim/regions.js; refactor round 3 C5)
export const CUPS = cupsOf(CURRENT_WATERS);

const freeze = (o) => Object.freeze(o);
export const PLACE_RACES = Object.freeze([
  // 4.1 Tea House Run: from off Vikingsholm round Fannette and finish under the tea house's steps; the shortcut is inside the island's
  // boulder shallows (coordinates there; the marks are left to starboard: the course turns clockwise)
  freeze({
    id: 'tea-house-run', cup: 'emerald-bay', name: 'Tea House Run', line: 'From Vikingsholm, round Fannette to the tea house. Cut inside the boulders and you save about 80 m, if the keel clears.',
    hour: 15, rivals: 4,
    start: { a: [-260, 180], b: [-200, 240] },
    legs: [
      { to: 'M1', kind: 'mark', at: [-60, -110], rounding: 'starboard' },   // north of the island
      { to: 'M2', kind: 'mark', at: [130, -20], rounding: 'starboard' },    // east of it; then a short beat to the landing
    ],
    finish: { centre: [55, 110], lengthM: 130 },   // under the steps ('s ends (20, 110)–(90, 110), turned square to the last leg and widened to 130 m so a beat can lay it)
    // the shortcut: the first leg's straight line runs over the island's boulder shallows (1–5 m, the 3 m shelf of bedBoulders.js); the
    // safe line swings out to `safeVia` (deep water). A keel on a stone is the existing grounding
    shortcut: { leg: 'M1', via: [-164, 87], safeVia: [-260, 0], risk: 'grounding' },
    hooks: ['shortcut'], needs: [], phone: 'the same race (the ruin itself is desktop and tablet only)',
  }),
  // 4.5 Pass the Channel: out of Emerald Bay through the three buoy gates, red to port going out; the barges' salute at the finish
  freeze({
    id: 'pass-the-channel', cup: 'the-mouth', name: 'Pass the Channel', line: 'Thread the three buoy gates out of the bay. Clear the mouth and the barges fire a salute.',
    hour: 20 + 40 / 60, rivals: 3,
    start: { a: [1238, -951], b: [1294, -889] },   // the no-wake buoys NW1, NW2
    legs: [
      { to: 'G1', kind: 'gate', green: [1428, -1032], red: [1396, -1068], names: ['5', '6'] },
      { to: 'G2', kind: 'gate', green: [1548, -1139], red: [1516, -1175], names: ['3', '4'] },
      { to: 'G3', kind: 'gate', green: [1589, -1205], red: [1548, -1229], names: ['1', '2'] },
    ],
    finish: { a: [1660, -1410], b: [1740, -1330] },
    hooks: ['salute'], needs: [], phone: 'no salute (no fireworks on phones): the committee horn',
  }),
  // 4.2 Tessie's Deep: a dog-leg through her water; she hunts the fleet the whole race (tessieDeep.js)
  freeze({
    id: 'tessies-deep', cup: 'emerald-bay', name: "Tessie's Deep", line: 'A dog-leg through her water. She hunts the fleet: when she comes for you, tack or bear away.',
    hour: 16 + 10 / 60, rivals: 3,
    start: { a: [80, -100], b: [140, -20] },
    legs: [{ to: 'M1', kind: 'mark', at: [330, -300], rounding: 'starboard' }],   // the run, then a right turn onto the close reach
    finish: { centre: [560, -40], lengthM: 80 },   // square to the last leg ('s ends ran along it)
    hooks: ['tessie'], needs: ['tessie'], phone: 'skipped (Tessie is desktop and tablet only)',
  }),
  // 4.3 Glass Boat Chase (phase 2): Velia Travel leaves her stop off Fannette just before the countdown (her head start) on her own route (v2/sim/tourBoat.js
  // TOUR_ROUTE, 4 kn in the bay); the fleet starts astern of her and races her to the Boat Camp's no-wake buoy. Her wash slows a boat
  // sitting in it (glassChase.js washAt, on her wake's points): pass her to windward. Desktop and tablet (she is not on phones)
  freeze({
    id: 'glass-boat-chase', cup: 'emerald-bay', name: 'Glass Boat Chase', line: 'Velia Travel has just left her stop off Fannette. Catch her and reach the Boat Camp buoy first; her wash slows you, so pass to windward.',
    hour: 15, rivals: 2,
    start: { a: [-215, 90], b: [-155, 100] },   // astern of her stop (-140, 60); its square (10°) on the first leg's own gybe (port), so no boat gybes off the line
    legs: [{ to: 'M1', kind: 'mark', at: [-130, -130], rounding: 'starboard' }],   // north-west of the island: a broad reach on port, the gybe at the mark, a broad reach on starboard to the Boat Camp (no dead run)
    finish: { centre: [430, -540], lengthM: 80 },   // at the no-wake buoy off the Boat Camp
    glass: { stop: 'fannette', leadS: 8 },   // she left her stop 8 s before the fleet's countdown: under way at the gun, about 40 m along her route
    hooks: ['glass'], needs: ['glassBoat'], phone: 'skipped (the glass boat is desktop and tablet only)',
  }),
  // 4.6 Storm Run (phase 2): from the open lake back to the mouth while a squall builds from the gun (the page's storm, stormRun.js)
  freeze({
    id: 'storm-run', cup: 'the-mouth', name: 'Storm Run', line: 'From the open lake back to the mouth before the squall hits. Reef early, or ease in the gusts.',
    hour: 15, rivals: 4,
    start: { a: [2392, -1420], b: [2408, -1340] },   // off the open lake, square to the beam reach west
    legs: [{ to: 'M1', kind: 'mark', at: [1980, -1460], rounding: 'port' }],
    finish: { centre: [1700, -1370], lengthM: 110 },   // on the mouth's outer line (Pass the Channel's finish), square to the last leg, crossed inbound
    hooks: ['storm'], needs: ['storm'], phone: 'skipped (no storm on phones)',
  }),
  // 4.7 Lights on the Lake (phase 2, The Mouth's finale): a night race out to the barges and home under the full show (21:44)
  freeze({
    id: 'lights-on-the-lake', cup: 'the-mouth', name: 'Lights on the Lake', line: 'The finale at night: out to the barges and home under the whole Fourth of July show.',
    hour: 21 + 42 / 60, rivals: 5,
    start: { a: [2061, -1510], b: [2139, -1490] },   // square to the night's wind from about 15°
    legs: [{ to: 'M1', kind: 'mark', at: [2330, -1660], rounding: 'starboard' }],   // about 240 m off the barges; the run home on their south side
    finish: { a: [1660, -1410], b: [1740, -1330] },   // the mouth's outer line
    hooks: ['show'], needs: [], phone: 'the lit race without the show (no fireworks on phones)',
  }),
]);

const byId = new Map(PLACE_RACES.map((r) => [r.id, r]));
export const isPlace = (id) => typeof id === 'string' && byId.has(id);
export const placeOf = (id) => byId.get(id) ?? null;

// the lines and the marks as numbers: the start's course side faces the first mark; the finish line square to (or given across) the
// last leg, crossed the way the boat sails it
function geometryOf(row) {
  const s = row.start, sc = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  const pts = row.legs.map((l) => (l.kind === 'gate' ? [(l.green[0] + l.red[0]) / 2, (l.green[1] + l.red[1]) / 2] : l.at));
  const f = row.finish, last = pts.at(-1);
  let fa, fb, fc;
  if (f.centre) {
    fc = f.centre; const dx = fc[0] - last[0], dz = fc[1] - last[1], l = Math.hypot(dx, dz) || 1, ax = -dz / l, az = dx / l, h = f.lengthM / 2;
    fa = [fc[0] - ax * h, fc[1] - az * h]; fb = [fc[0] + ax * h, fc[1] + az * h];
  } else { fa = f.a; fb = f.b; fc = [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2]; }
  const normalToward = (a, b, c, to) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; let nx = dz / l, nz = -dx / l; if ((to[0] - c[0]) * nx + (to[1] - c[1]) * nz < 0) { nx = -nx; nz = -nz; } return brg(nx, nz); };
  const lineUp = normalToward(s.a, s.b, sc, pts[0]);
  const finUp = normalToward(fa, fb, fc, [fc[0] + (fc[0] - last[0]), fc[1] + (fc[1] - last[1])]);
  const all = [sc, ...pts, fc];
  let m = 0; for (let i = 1; i < all.length; i++) m += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
  return { sc, pts, fa, fb, fc, lineUp, finUp, lengthM: m };
}

// the course JSON (src/sim/race/course.js loadCourse's input) for this race at a wind: the wind only names the race's wind (the rules'
// port and starboard, the fleet's mind); nothing moves with it
function placeCourseJson(id, windFromDeg = 200) {
  const row = placeOf(id); if (!row) throw new Error(`places: no race ${id}`);
  const g = geometryOf(row);
  // the start line: committee boat at b, pin at a (a boat on the course side sees the committee boat on its right when the line faces
  // the course; the props and tags only need the two ends)
  const marks = row.legs.map((l) => (l.kind === 'gate' ? { id: l.to, kind: 'gate', green: l.green, red: l.red, names: l.names ?? null, rounding: 'port' } : { id: l.to, kind: 'sphere', colour: 'orange', at: l.at, rounding: l.rounding ?? 'port' }));
  return { id: row.id, waters: 'tahoe-emerald', name: row.name, blurb: row.line, designWindFrom: Math.round(((windFromDeg % 360) + 360) % 360), place: row.id,
    line: { committee: row.start.b, pin: row.start.a }, lineUp: g.lineUp, finish: { a: g.fa, b: g.fb, up: g.finUp },
    marks, legs: [...row.legs.map((l) => ({ to: l.to })), { to: 'finish' }], laps: 1, timeLimitS: Math.max(900, Math.ceil(g.lengthM / 0.6)) };
}
export function placeCourse(id, windFromDeg = 200) {
  const c = loadCourse(placeCourseJson(id, windFromDeg)), row = placeOf(id);
  c.shortcut = row.shortcut ?? null;   // Tea House Run: the rivals that take it (session.js) and its shelf
  return c;
}

// about how long, in real minutes at the hand's pace (setup.js minutesFor: 0.7 min + 6.05 min a km at 2 ×, Fresh)
export const placeKm = (id) => { const r = placeOf(id); return r ? geometryOf(r).lengthM / 1000 : 0; };
const placeMins = (id, pace = 2) => Math.max(2, Math.round((0.7 + 6.05 * placeKm(id)) * (2 / (pace || 2))));

// the best finishes (this browser): one object, checked on read
export const PLACES_KEY = 'lakeshore.regatta.places.v1';
const MEDALS = ['gold', 'silver', 'bronze'];
export function loadPlaces(store = globalThis.localStorage) {
  let j = null; try { j = JSON.parse(store?.getItem(PLACES_KEY) ?? 'null'); } catch { j = null; }
  const out = {};
  if (j && typeof j === 'object') for (const [id, b] of Object.entries(j)) if (isPlace(id) && b && Number.isFinite(b.timeS) && b.timeS > 0) out[id] = { timeS: b.timeS, medal: MEDALS.includes(b.medal) ? b.medal : null, at: typeof b.at === 'string' ? b.at.slice(0, 10) : null };
  return out;
}
// a finish: the best time kept, and the best medal ever won on it (a gold stays gold)
export function recordPlace(store = globalThis.localStorage, id, { timeS, medal = null, at = null } = {}) {
  if (!isPlace(id) || !(timeS > 0)) return { isNew: false, best: null };
  const all = loadPlaces(store), prev = all[id] ?? null, rank = (m) => (m ? MEDALS.indexOf(m) : 9);
  const isNew = !prev || timeS < prev.timeS;
  const best = { timeS: isNew ? timeS : prev.timeS, medal: rank(medal) < rank(prev?.medal) ? medal : prev?.medal ?? null, at: isNew ? at : prev?.at ?? null };
  all[id] = best;
  try { store?.setItem(PLACES_KEY, JSON.stringify(all)); } catch { /* full or blocked */ }
  return { isNew, best };
}

export function raceInfo(id, { store = null, has = () => true, best = null } = {}) {
  const r = placeOf(id); if (!r) return null;
  const g = geometryOf(r), b = best ?? (store ? loadPlaces(store) : {});
  return { id: r.id, name: r.name, cup: r.cup, line: r.line, lengthM: Math.round(g.lengthM), km: +(g.lengthM / 1000).toFixed(2), mins: placeMins(r.id), hour: r.hour, rivals: r.rivals,
    hooks: [...r.hooks], at: [Math.round(g.sc[0]), Math.round(g.sc[1])], available: r.needs.every((n) => !!has(n)), phone: r.phone, best: b[r.id] ?? null };
}
// hunts: { [huntId]: { found, of } } (hunts.js huntCounts): each cup's hunt with its count, for the hub's hunt row ("Chart the Bay 3/8")
export function listCups({ store = null, has = () => true, hunts = null } = {}) {
  const best = store ? loadPlaces(store) : {};
  return CUPS.map((c) => ({ id: c.id, name: c.name, line: c.line, races: c.races.map((id) => raceInfo(id, { has, best })),
    hunt: c.hunt ? { id: c.hunt, name: HUNT_NAMES[c.hunt] ?? c.hunt, found: hunts?.[c.hunt]?.found ?? 0, of: hunts?.[c.hunt]?.of ?? 8 } : null }));
}
const HUNT_NAMES = huntNamesOf(CURRENT_WATERS);   // each region row's cup.huntName (v2/sim/regions.js)
// the device's features as the registry's needs read them (features.js feature(name)): the glass boat is on at any tier but 'off';
// Tessie and the storm are 'on' or not. One rule for the hub, the chart's pins and the page (v2/main.js, v2/ui/sail.js)
export const hasFrom = (feature) => (name) => { try { const f = feature(name); return name === 'glassBoat' ? f.tier !== 'off' : !!f.on; } catch { return true; } };
// the cup of the area a point is in (the hub opens on it): each region row's `area` (v2/sim/regions.js): The Mouth past the narrows
// (east of x 1100 or north of z -1000), else Emerald Bay (the row with no area: the rest of the lake)
export const cupAt = cupAtOf(CURRENT_WATERS);

// the race's hand (setup.js makeHand's fields, so the hub's words, the pace and the level work as for any hand): the row's hour, its
// rivals, a flying start, Fresh air, steady shifts by default (the place's own valley wind still swings), a fair sky
export function placeHand(id, setup = {}, { seed = 1, levels = null, rivals = null } = {}) {   // rivals: a cup series' fixed fleet (placeCup.js)
  const r = placeOf(id); if (!r) throw new Error(`places: no race ${id}`);
  const aids = ['beginner', 'club', 'pro'].includes(setup.aids) ? setup.aids : 'beginner', skill = ['easy', 'medium', 'hard', 'pro'].includes(setup.skill) ? setup.skill : 'easy';
  const L = levels?.[aids] ?? {};
  return { seed: seed >>> 0, place: r.id, event: 'fleet', course: r.id, length: 'full', scale: 1, laps: 1, wind: 3, shifts: 'steady', time: 'place', hour: r.hour, sky: r.hooks.includes('show') ? 'clear' : 'fair',
    rivals: Number.isFinite(rivals) ? Math.max(1, Math.min(5, rivals | 0)) : r.rivals, skill, tier: skill, aids, laylines: aids === 'pro' ? !!setup.laylines : L.laylines === true, helper: L.helper ?? aids === 'beginner', forgiving: L.forgiving ?? aids === 'beginner',
    pace: L.pace ?? (aids === 'pro' ? 1.5 : 2), prestartS: 0, raceSeed: 1 + (seed % 9999), custom: false };
}
