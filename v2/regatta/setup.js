// Regatta's front door, the pure half (§ 6 step A): the race settings the player keeps (the two dials: the rivals'
// skill and the player's aids, with Beginner / Club / Pro as presets over both), stored as one object checked and clamped on read,
// and "today's hand": a seeded pick on each dial the race already has (the course, its length and laps, the wind's level and shift
// pattern, the sky, the time of day, the fleet's size) dealt by sensible rules, so a tap on Regatta shows a different race each time;
// step B: Custom race, the same dials picked by the player and remembered (customHand). No DOM, no GPU: v2/tests/regatta-hub.test.mjs,
// v2/tests/regatta-custom.test.mjs. The hub (hub.js) shows a hand; the race (index.js) sails it.
//   customHand(setup, seed) → the Custom race's hand; clampCustom(c) → the stored picks checked on read
//   SETUP_KEY, loadSetup(store) → setup, saveSetup(store, setup) → setup   (the old level.v1 key is read once when no setup is stored)
//   PRESETS[id] → { skill, aids }, presetOf(setup) → 'beginner' | 'club' | 'pro' | null (the dials moved apart: a custom pair)
//   handSeed(day, n) → a 32-bit seed for the n-th hand of a day ('YYYY-MM-DD'); dealHand(seed, setup, { last }) → hand
//   validHand(hand) → true when every dial is in its range; handKey(hand) → the dials as a short string (the "not twice running" rule)
//   describeHand(hand) → the words the hub shows; minutesFor(hand) → about how long it takes in real time
//   hubAtEnter(flags, live) → does Regatta open on the hub (a live page with no race-shaping URL flag) or straight in the box
//   windNow(windField, level, { t, at }) → the wind's level set at once over the whole lake (no front blowing in: the hand's wind
//   is the race's wind from the gun); hourCut(clock, hour) → the clock cut forward to that hour of day (none when it is there)
import { LEVELS, LEVEL_IDS, loadLevel } from '../sim/raceLevels.js';
import { courseFor, courseIds, DEFAULT_SCALES, MAX_LAPS } from '../../src/sim/race/course.js';
import { SHIFT_IDS, shiftOf } from './shifts.js';
import { FLEET_TIER } from './fleet.js';
import { RACE } from './plan.js';
import { EVENT_IDS, eventOf, rivalsFor, dealEvent, isEvent } from './events.js';   // step C: the race types (fleet, match, time trial, pursuit)
import { analyticSun } from '../../src/sim/timeOfDay.js';   // the page's sun on the page's day (the lake, the date)
import { NIGHT } from '../../src/ui/theme.js';
import { placeOf, placeKm } from '../sim/racePlaces.js';   // a place race's hand (hand.place): its own length and hour              // the night-red theme's sun limits (night under −1°, day again over +1°)

export const SETUP_KEY = 'lakeshore.regatta.setup.v1';
// the rivals' skill: the fleet's tiers (fleet.js FLEET_TIER, Pro 0.95 included); the player's aids: the levels' aids (levels.js)
export const SKILL_IDS = Object.freeze(['easy', 'medium', 'hard', 'pro']);
export const SKILL_LABEL = Object.freeze({ easy: 'Easy', medium: 'Club', hard: 'Hard', pro: 'Pro' });
const AID_IDS = LEVEL_IDS;
// a preset sets both dials (Beginner = easy rivals + every aid, as LEVELS bundled them)
export const PRESETS = Object.freeze({
  beginner: Object.freeze({ skill: 'easy', aids: 'beginner' }),
  club: Object.freeze({ skill: 'medium', aids: 'club' }),
  pro: Object.freeze({ skill: 'hard', aids: 'pro' }),
});

// the hand's dials (every value one the race already sails)
//   course  a course of the lake (src/race/courses/<waters>/, its JSON: name, blurb, laps, scales); step B: Harbour Dash, the Island
//           Sprint, Twice Round (2 laps), Bay Tour (Club and Pro only in a dealt hand, never at Full length or in Light air)
//   length  the course's scale (its JSON's scales: [short, club, full]; the Island Sprint's 0.35, 0.6, 1)
//   laps    1 to 3 (the course's own in a dealt hand; Custom's Laps row)
//   wind    the wind's level, 1–4 (src/ui/viewSwitch.js WIND_LEVELS: Light 4–7, Moderate 8–12, Fresh 13–17, Strong 18–24 kn)
//   shifts  the race's shift pattern (shifts.js: steady, oscillating, persistent left or right)
//   time    Dawn just after sunrise (below), the clock menu's Midday and Golden hour, the race's own 15:00; step D (owner 2026-11-17):
//           Night at 22:00 with the marks lit (nightMarks.js), dealt at Club and Pro only (DEAL_NIGHT, its own stream), any level in Custom
//   sky     the Weather menu's Clear and Fair; no Storm yet (its gust front in a race is untested with the start helper)
//   rivals  2–5 computer boats in a dealt hand; 0–5 in Custom (0: the course alone against the clock)
//   start   the start: a flying start (s 0: the fleet already sailing at the line, a short countdown; the default, and every
//           Beginner and Club hand), or a classic pre-start in the box at −0:45, −1:30 or −3:00 (Custom; a Pro hand now and then)
//   pace    the race's game speed: the aids' own in a dealt hand (2 ×, Pro 1.5 ×); Custom's Pace row 1 ×, 1.5 ×, 2 ×
//   event   step C (owner 2026-11-17): the race type (events.js): a fleet race, a match race (1 rival), a time trial (none), a pursuit
//           (a staggered start, always flying); dealt by the aids (Beginner: fleet and time trial; Club and Pro all four); Custom's
//           Race type row
export const WATERS = 'tahoe-emerald';
export const LENGTHS = Object.freeze([
  Object.freeze({ id: 'short', label: 'Short', i: 0, scale: DEFAULT_SCALES[0] }),
  Object.freeze({ id: 'club', label: 'Club', i: 1, scale: DEFAULT_SCALES[1] }),
  Object.freeze({ id: 'full', label: 'Full', i: 2, scale: DEFAULT_SCALES[2] }),
]);
export const WINDS = Object.freeze([
  Object.freeze({ level: 1, name: 'Light', range: '4–7 kn' }),
  Object.freeze({ level: 2, name: 'Moderate', range: '8–12 kn' }),
  Object.freeze({ level: 3, name: 'Fresh', range: '13–17 kn' }),
  Object.freeze({ level: 4, name: 'Strong', range: '18–24 kn' }),
]);
// the race's Dawn (owner, 2026-11-16): just after sunrise, so the night-red theme never applies on the hub or in the race: sunrise
// (the sun's upper limb at the horizon, −0.833°) + 15 min, and never before the sun is DAWN.minElevDeg up (3° over the theme's day
// limit), rounded up to 5 minutes; from the day's own sun (2026-07-04 at Tahoe: sunrise 05:40, Dawn 06:10)
export const DAWN = Object.freeze({ afterSunriseMin: 15, sunriseDeg: -0.833, minElevDeg: NIGHT.above + 3, stepMin: 5 });
export const sunElevDeg = (hour, sunAt = analyticSun) => Math.asin(Math.max(-1, Math.min(1, sunAt(hour).y))) * 180 / Math.PI;
export function sunriseHour(sunAt = analyticSun, deg = DAWN.sunriseDeg) {
  let lo = 2, hi = 10;   // the morning: the sun below the limit at 02:00 and above it by 10:00
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (sunElevDeg(m, sunAt) < deg) lo = m; else hi = m; }
  return hi;
}
export function dawnHour(sunAt = analyticSun) {
  const h = Math.max(sunriseHour(sunAt) + DAWN.afterSunriseMin / 60, sunriseHour(sunAt, DAWN.minElevDeg)), step = DAWN.stepMin / 60;
  return Math.round(Math.ceil(h / step - 1e-9) * step * 1e6) / 1e6;
}
export const TIMES = Object.freeze([
  Object.freeze({ id: 'dawn', label: 'Dawn', hour: dawnHour() }),
  Object.freeze({ id: 'midday', label: 'Midday', hour: 13 }),
  Object.freeze({ id: 'afternoon', label: 'Afternoon', hour: RACE.hour }),
  Object.freeze({ id: 'golden', label: 'Golden hour', hour: 19.25 }),
  Object.freeze({ id: 'night', label: 'Night', hour: 22, night: true }),   // step D: the lit marks (the sun 13° under the horizon on 2026-07-04)
]);
export const DAY_TIMES = Object.freeze(TIMES.filter((t) => !t.night));
// a dealt hand's Night (step D, owner 2026-11-17): Club and Pro only, this often, drawn from its own stream (the other dials deal as before)
export const DEAL_NIGHT = Object.freeze({ beginner: 0, club: 0.12, pro: 0.2 });
export const isNightHand = (h) => !!h && !!TIMES.find((t) => t.id === h.time)?.night;
export const SKIES = Object.freeze([Object.freeze({ id: 'clear', label: 'Clear' }), Object.freeze({ id: 'fair', label: 'Fair' })]);
export const RIVALS = Object.freeze({ min: 2, max: RACE.maxRivals, customMin: 0 });
export const STARTS = Object.freeze([
  Object.freeze({ s: 0, flying: true, label: 'Flying start', short: 'Flying' }),
  Object.freeze({ s: 45, label: 'Line −0:45', short: '−0:45' }),
  Object.freeze({ s: 90, label: 'Line −1:30', short: '−1:30' }),
  Object.freeze({ s: 180, label: 'Line −3:00', short: '−3:00' }),
]);
export const PACES = Object.freeze([1, 1.5, 2]);
export const LAPS = Object.freeze({ min: 1, max: MAX_LAPS });
// the lake's courses, from their JSON (a new lake's folder adds its own): one lap's legs and metres at Full, the course's own laps
const shortName = (n) => n.replace(/^The /, '');
const DEAL_FULL_M = 1200;   // a dealt hand sails Full length only on a course this short at Full (the Island Sprint, Harbour Dash)
export const COURSES = Object.freeze(courseIds(WATERS).map((id) => {
  const c = courseFor(WATERS, id), one = courseFor(WATERS, id, { laps: 1 });
  return Object.freeze({ id, name: c.name, short: shortName(c.name), blurb: c.blurb, legs: one.legSpec.length, marks: one.markIds.length, laps: c.laps, scales: Object.freeze([...c.scales]),
    lapM: Math.round(one.totalM), lapsM: Object.freeze([1, 2, 3].map((n) => Math.round(courseFor(WATERS, id, { laps: n }).totalM))), dealt: id === 'bay-tour' ? 'clubPro' : 'all',
    dealtFull: c.totalM * c.scales[2] <= DEAL_FULL_M });
}));
export const courseOf = (id) => COURSES.find((c) => c.id === id) ?? COURSES[0];
export const scaleFor = (courseId, lengthId) => courseOf(courseId).scales[LENGTHS.find((l) => l.id === lengthId)?.i ?? 0];
// the start's label; the shift pattern's words live in shifts.js
const startOf = (s) => STARTS.find((x) => x.s === s) ?? STARTS[0];
// Custom race (mock 2): the dials the player picks, remembered, checked on read; the two dials (rivals' skill,
// your aids) are the setup's own, shared with the dealt hands
export const DEFAULT_CUSTOM = Object.freeze({ event: 'fleet', course: COURSES[0].id, length: 'short', laps: COURSES[0].laps, wind: 3, shifts: 'oscillating', sky: 'fair', time: 'afternoon', rivals: RACE.rivals, start: 0, pace: 2 });
// a Pro hand deals a classic start this often (−0:45 or −1:30, evenly); Beginner and Club always sail a flying start
export const DEAL_CLASSIC = Object.freeze({ pro: 0.25, starts: Object.freeze([45, 90]) });
export const isFlying = (h) => !!h && h.prestartS === 0;

const clampInt = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
export function clampCustom(c) {
  const j = c && typeof c === 'object' ? c : {}, D = DEFAULT_CUSTOM;
  const course = COURSES.some((x) => x.id === j.course) ? j.course : D.course;
  return {
    event: isEvent(j.event) ? j.event : D.event,
    course,
    length: LENGTHS.some((l) => l.id === j.length) ? j.length : D.length,
    laps: clampInt(j.laps, LAPS.min, LAPS.max, courseOf(course).laps),
    wind: WINDS.some((w) => w.level === j.wind) ? j.wind : D.wind,
    shifts: SHIFT_IDS.includes(j.shifts) ? j.shifts : D.shifts,
    sky: SKIES.some((x) => x.id === j.sky) ? j.sky : D.sky,
    time: TIMES.some((t) => t.id === j.time) ? j.time : D.time,
    rivals: clampInt(j.rivals, RIVALS.customMin, RIVALS.max, D.rivals),
    start: STARTS.some((x) => x.s === j.start) ? j.start : STARTS.reduce((a, b) => (Math.abs(b.s - Number(j.start)) < Math.abs(a.s - Number(j.start)) ? b : a), STARTS[0]).s,
    pace: PACES.includes(j.pace) ? j.pace : Number.isFinite(Number(j.pace)) ? PACES.reduce((a, b) => (Math.abs(b - j.pace) < Math.abs(a - j.pace) ? b : a)) : D.pace,
  };
}
export const DEFAULT_SETUP = Object.freeze({ v: 1, skill: 'easy', aids: 'beginner', laylines: false, dealt: 0, raced: 0, last: '', useCustom: false, custom: DEFAULT_CUSTOM });
const fields = (j) => ({
  v: 1,
  skill: SKILL_IDS.includes(j.skill) ? j.skill : DEFAULT_SETUP.skill,
  aids: AID_IDS.includes(j.aids) ? j.aids : DEFAULT_SETUP.aids,
  laylines: j.laylines === true,
  dealt: clampInt(j.dealt, 0, 1e9, 0),
  raced: clampInt(j.raced, 0, 1e9, 0),
  last: typeof j.last === 'string' ? j.last.slice(0, 80) : '',
  useCustom: j.useCustom === true,
  custom: clampCustom(j.custom),
});

// one stored object, every field checked on read: a wrong or missing value falls back to its default (a broken store never breaks
// the race); with nothing stored, the old level key's choice carries over (its aids, its rivals' tier)
export function loadSetup(store = globalThis.localStorage) {
  let j = null;
  try { j = JSON.parse(store?.getItem(SETUP_KEY) ?? 'null'); } catch { j = null; }
  if (!j || typeof j !== 'object') {
    const old = loadLevel(store);
    if (old.chosen) return { ...DEFAULT_SETUP, custom: { ...DEFAULT_CUSTOM }, ...PRESETS[old.level], laylines: old.laylines, chosen: true, migrated: true };
    return { ...DEFAULT_SETUP, custom: { ...DEFAULT_CUSTOM }, chosen: false };
  }
  return { ...fields(j), chosen: true };
}
export function saveSetup(store = globalThis.localStorage, s = {}) {
  const o = fields(s);
  try { store?.setItem(SETUP_KEY, JSON.stringify(o)); } catch { /* full or blocked */ }
  return { ...o, chosen: true };
}
export const presetOf = (s) => LEVEL_IDS.find((id) => PRESETS[id].skill === s?.skill && PRESETS[id].aids === s?.aids) ?? null;
export function withPreset(s, id) { const p = PRESETS[id]; return p ? { ...s, skill: p.skill, aids: p.aids, laylines: id === 'pro' ? !!s.laylines : false } : s; }

// a small, fast, seeded generator (mulberry32) and a string hash (FNV-1a): the same seed deals the same hand on every device
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash32(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
export const handSeed = (day, n = 0) => hash32(`${day}#${n}`);
export const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pick = (r, list, w) => { const tot = w.reduce((a, b) => a + b, 0); let x = r() * tot; for (let i = 0; i < list.length; i++) { x -= w[i]; if (x < 0) return list[i]; } return list[list.length - 1]; };

// the weights by the player's aids: a Beginner meets no Strong wind, no Full course and no Bay Tour; Club and Pro meet everything
// (the courses' weights in COURSES order: the Island Sprint, Harbour Dash, Twice Round, Bay Tour; a new course weighs 1)
//): Harbour Dash, Twice Round and Bay Tour are retired from the hub's dealt hands (weight 0);
// Custom keeps their courses (COURSES lists them all). The hub's place races come from places.js
const W = {
  course: { beginner: { 'island-sprint': 3, 'harbour-dash': 0, 'twice-round': 0, 'bay-tour': 0 }, club: { 'island-sprint': 3, 'harbour-dash': 0, 'twice-round': 0, 'bay-tour': 0 }, pro: { 'island-sprint': 3, 'harbour-dash': 0, 'twice-round': 0, 'bay-tour': 0 } },
  length: { beginner: [6, 3, 0], club: [4, 4, 2], pro: [3, 4, 3] },
  wind: { beginner: [2, 4, 3, 0], club: [1, 3, 4, 2], pro: [1, 2, 4, 3] },
  shifts: { beginner: [3, 3, 1, 1], club: [2, 4, 1.5, 1.5], pro: [1, 4, 2, 2] },
  time: [2, 3, 3, 4],
  sky: [1, 1],
  rivals: [1, 2, 3, 4],   // 2, 3, 4, 5 boats: a full fleet most often
};
// the hand a pick of dials makes (the aids' own helper, penalties and laylines; the pace given, or the aids' own)
export function makeHand(seed, d, setup, raceSeed, custom = false) {
  const aids = AID_IDS.includes(setup.aids) ? setup.aids : 'beginner', skill = SKILL_IDS.includes(setup.skill) ? setup.skill : 'easy', L = LEVELS[aids];
  const t = TIMES.find((x) => x.id === d.time) ?? TIMES[2], event = isEvent(d.event) ? d.event : 'fleet';
  return { seed: seed >>> 0, event, course: d.course, length: d.length, scale: scaleFor(d.course, d.length), laps: d.laps, wind: d.wind, shifts: d.shifts, time: t.id, hour: t.hour, sky: d.sky,
    rivals: rivalsFor(event, d.rivals), skill, tier: skill, aids, laylines: aids === 'pro' ? !!setup.laylines : L.laylines === true, helper: L.helper, forgiving: L.forgiving, pace: d.pace ?? L.pace,
    prestartS: event === 'pursuit' ? 0 : d.start ?? 0, raceSeed, custom };   // a pursuit always starts flying (its own staggered gate)
}
export function dealHand(seed, setup = DEFAULT_SETUP, { last = '' } = {}) {
  const aids = AID_IDS.includes(setup.aids) ? setup.aids : 'beginner';
  let hand = null;
  for (let k = 0; k < 8; k++) {
    const r = rng((seed + k * 0x9E3779B1) >>> 0);
    const course = pick(r, COURSES, COURSES.map((c) => W.course[aids][c.id] ?? 1));
    const big = course.dealt === 'clubPro';   // the long course: never Light air; a long course never Full
    const length = pick(r, LENGTHS, W.length[aids].map((w, i) => (!course.dealtFull && i === 2 ? 0 : w))), wind = pick(r, WINDS, W.wind[aids].map((w, i) => (big && i === 0 ? 0 : w)));
    const shifts = pick(r, SHIFT_IDS, W.shifts[aids]), time0 = pick(r, DAY_TIMES, W.time), sky = pick(r, SKIES, W.sky), rivals = pick(r, [2, 3, 4, 5], W.rivals);
    const raceSeed = 1 + Math.floor(r() * 9999);
    // the start (drawn last: the other dials deal as before): flying, but a Pro hand now and then a classic box
    const start = aids === 'pro' && r() < DEAL_CLASSIC.pro ? DEAL_CLASSIC.starts[Math.floor(r() * DEAL_CLASSIC.starts.length) % DEAL_CLASSIC.starts.length] : 0;
    // the race type from its own stream (step C: the other dials deal exactly as before)
    const event = dealEvent(rng((seed ^ 0x2545F491) + k * 0x9E3779B1), aids);
    // step D: Night from its own stream (Club and Pro only); the day's time otherwise
    const time = rng(((seed ^ 0x6A09E667) + k * 0x9E3779B1) >>> 0)() < (DEAL_NIGHT[aids] ?? 0) ? TIMES.find((t) => t.night) : time0;
    hand = makeHand(seed, { event, course: course.id, length: length.id, laps: course.laps, wind: wind.level, shifts, time: time.id, sky: sky.id, rivals, start }, setup, raceSeed);
    if (handKey(hand) !== last) break;   // the hand just sailed (or just shown) is never dealt twice running
  }
  return hand;
}
// Custom race's hand: the stored picks (clamped) with the setup's two dials; the race's seed from the given seed
export function customHand(setup = DEFAULT_SETUP, seed = 1) {
  const c = clampCustom(setup.custom);
  return makeHand(seed, c, setup, 1 + (hash32(`custom#${seed}`) % 9999), true);
}
// the dials a player sees change (not the race's seed): two hands with one key look the same on the hub
export const handKey = (h) => (h ? `${h.event && h.event !== 'fleet' ? `${h.event}|` : ''}${h.course}|${h.length}|${h.laps}|${h.wind}|${h.shifts}|${h.time}|${h.sky}|${h.rivals}|${h.prestartS ?? 0}` : '');
export function validHand(h) {
  return !!h && (h.event == null || isEvent(h.event)) && (h.event == null || h.rivals === rivalsFor(h.event, h.rivals)) && COURSES.some((c) => c.id === h.course) && LENGTHS.some((l) => l.id === h.length) && h.scale === scaleFor(h.course, h.length)
    && Number.isInteger(h.laps) && h.laps >= LAPS.min && h.laps <= LAPS.max && SHIFT_IDS.includes(h.shifts)
    && WINDS.some((w) => w.level === h.wind) && TIMES.some((t) => t.id === h.time && t.hour === h.hour) && SKIES.some((s) => s.id === h.sky)
    && Number.isInteger(h.rivals) && h.rivals >= RIVALS.customMin && h.rivals <= RIVALS.max && FLEET_TIER[h.tier] != null && SKILL_IDS.includes(h.skill)
    && AID_IDS.includes(h.aids) && STARTS.some((x) => x.s === h.prestartS) && PACES.includes(h.pace) && Number.isInteger(h.raceSeed) && h.raceSeed >= 1;
}

// about how long the race takes in real time: R4 measured the Island Sprint at 0.35 (400 m of legs) at about 3 minutes at 2 × in
// Fresh air; the minutes follow the course's metres (one lap at Full × the length's scale × the laps), light air is slower, the pace
// divides; a longer pre-start adds its own
const WIND_K = { 1: 1.35, 2: 1.12, 3: 1, 4: 0.95 };
export const raceKm = (h) => { if (h?.place) return placeKm(h.place); const c = courseOf(h.course); return ((c.lapsM[(h.laps || 1) - 1] ?? c.lapM) * h.scale) / 1000; };
export const minutesFor = (h) => Math.max(2, Math.round(((0.7 + 6.05 * raceKm(h)) * (WIND_K[h.wind] ?? 1) + Math.max(0, (h.prestartS ?? 45) - 45) / 60) * (2 / (h.pace || 2))));
const hhmm = (hr) => { const m = Math.round((((hr % 24) + 24) % 24) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export function describeHand(h) {
  const pr = h.place ? placeOf(h.place) : null;
  const c = pr ? { name: pr.name, short: pr.name, laps: 1, marks: pr.legs.length } : courseOf(h.course), w = WINDS.find((x) => x.level === h.wind), t = TIMES.find((x) => x.id === h.time) ?? { label: hhmm(h.hour) }, s = SKIES.find((x) => x.id === h.sky), L = LENGTHS.find((x) => x.id === h.length);
  const sh = shiftOf(h.shifts), level = LEVELS[h.aids]?.label ?? 'Beginner', preset = presetOf(h), lapsX = h.laps !== c.laps ? ` × ${h.laps}` : '';
  const ev = eventOf(h.event), rv = h.event === 'match' ? '1 v 1' : h.event === 'trial' ? 'You alone, against the clock' : h.event === 'pursuit' ? `${h.rivals} rivals, staggered start` : h.rivals === 1 ? '1 rival' : `${h.rivals} rivals`;
  const rvShort = h.event === 'match' ? '1 v 1' : h.event === 'trial' ? 'Solo' : h.event === 'pursuit' ? `Pursuit · ${h.rivals}` : rv;
  return {
    event: ev.label, eventId: ev.id, name: `${c.name}${lapsX}`, short: `${c.short}${lapsX}`, legs: c.marks * (h.laps || 1) + 1, laps: h.laps, km: raceKm(h),
    wind: `${w.name} ${w.range}`, windWord: w.name, time: t.label, sky: s.label, length: L.label, mins: minutesFor(h), shifts: sh.label,
    skill: SKILL_LABEL[h.skill], aids: level, level: preset ? LEVELS[preset].label : 'Custom', start: startOf(h.prestartS).label, pace: `${h.pace} ×`,
    line1: `${w.name} · ${sh.label.toLowerCase()} · ${t.label.toLowerCase()} · ${s.label.toLowerCase()} sky`,
    line2: `${rv} · ${preset ? LEVELS[preset].label : `${SKILL_LABEL[h.skill]} rivals, ${level} aids`} · about ${minutesFor(h)} min`,
    compact1: `${w.name} · ${sh.label.toLowerCase()} · ${t.label.toLowerCase()}`,   // a compact screen's plate: two short lines
    compact2: `${rvShort} · ${preset ? LEVELS[preset].label : 'Custom'} · ${minutesFor(h)} min`,
  };
}

// Regatta opens on the hub on a live page unless the URL already shapes the race (the captures, the page tests and shared links keep
// going straight in the box); ?quick=1 deals a hand and goes straight in the box
const RACE_FLAGS = ['rivals', 'course', 'autoplay', 'autotier', 'racet', 'speed', 'wind', 'windspeed', 'winddir'];
const has = (v) => v != null && v !== '' && v !== false;   // a parsed boolean row (autoplay) is false when absent
export function hubAtEnter(flags = {}, live = true) {
  if (!live) return { hub: false, deal: false };
  if (flags.quick === '1' || flags.quick === true) return { hub: false, deal: true };
  if (RACE_FLAGS.some((k) => has(flags[k]))) return { hub: false, deal: false };
  return { hub: true, deal: true };
}

// the wind's level over the whole lake at once (src/sim/wind.js setLevel blows a change in as a front over about 25 s; a race laid on a
// level still blowing in would start in the old wind): the new level's scale is the settled scale, no front in flight
export function windNow(wf, level, { t, at } = {}) {
  if (!wf?.setLevel) return null;
  const to = wf.setLevel(level, { t, at, overS: 1 });
  if (wf.lv && to != null) { wf.lv.scale0 = to; wf.lv.fronts.length = 0; wf.clockT = undefined; }
  return to;
}
// the clock cut forward to an hour of day (engine/clock.js setHour, unwrapped: the day only runs on), none when it is within a minute
export function hourCut(clock, hour) {
  if (!clock?.setHour) return false;
  const t = clock.t ?? 0, un = clock.hourUnwrappedAt ? clock.hourUnwrappedAt(t) : clock.hour, now = ((un % 24) + 24) % 24;
  let d = (((hour - now) % 24) + 24) % 24;
  if (d < 1 / 60 || d > 24 - 1 / 60) return false;
  clock.setHour(un + d, t);
  return true;
}
