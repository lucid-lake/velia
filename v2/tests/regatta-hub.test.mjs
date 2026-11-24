// Regatta's front door: the deal (the same seed deals the same hand, seeds deal varied hands, every hand valid and
// inside the dials' ranges, the sensible rules), the stored setup (clamped on read, the old level key carried over), the hub's flow on
// the page's race in node (Regatta opens on the hub with the race held in the box; In the box starts the race with the hand's
// settings; Race again skips the hub; Another hand deals again; the presets and the two dials reach the session), the URL's skips, the
// course board's drawing. The browser half: v2/tests/pages/regattaHub.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { isPlace } from '../sim/racePlaces.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { ground } from './helpers/ground.mjs';   // v2's own height field (v2/terrain/sample.js), every grid in
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor, START } from '../sim/boat.js';
import { sailWindOptions } from '../sim/wind.js';
import { layFairCourse } from '../regatta/geometry.js';
import { createRegatta } from '../regatta/index.js';
import { LEVEL_KEY, saveLevel } from '../sim/raceLevels.js';
import { FLEET_TIER } from '../regatta/fleet.js';
import { dealHand, validHand, handKey, handSeed, describeHand, loadSetup, saveSetup, SETUP_KEY, DEFAULT_SETUP, PRESETS, presetOf, hubAtEnter, windNow, hourCut,
  LENGTHS, WINDS, TIMES, DAY_TIMES, SKIES, RIVALS, minutesFor, sunriseHour, dawnHour, sunElevDeg, DAWN, scaleFor, courseOf, isNightHand } from '../regatta/setup.js';
import { NIGHT, isNight } from '../../src/ui/theme.js';
import { courseSvg } from '../regatta/hub.js';

const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const SETUPS = Object.keys(PRESETS).map((id) => ({ ...DEFAULT_SETUP, ...PRESETS[id] }));

// ---------------- the deal ----------------
test('the deal: one seed deals one hand; different seeds deal different hands', () => {
  for (const s of SETUPS) {
    assert.deepEqual(dealHand(12345, s), dealHand(12345, s));
    assert.deepEqual(dealHand(handSeed('2026-11-16', 3), s), dealHand(handSeed('2026-11-16', 3), s));
  }
  // 200 seeds: many distinct hands, every value of every dial seen (Beginner: no Strong wind, no Full course)
  for (const s of SETUPS) {
    const keys = new Set(), seen = { length: new Set(), wind: new Set(), time: new Set(), sky: new Set(), rivals: new Set() };
    for (let n = 0; n < 200; n++) { const h = dealHand(handSeed('2026-11-16', n), s); keys.add(handKey(h)); for (const k of Object.keys(seen)) if (k !== 'rivals' || h.event === 'fleet') seen[k].add(h[k]); }   // step C: a match race sails 1 rival, a time trial none
    assert.ok(keys.size >= 60, `${s.aids}: ${keys.size} distinct hands in 200`);
    const beg = s.aids === 'beginner';
    assert.equal(seen.length.size, beg ? 2 : 3, `${s.aids} lengths ${[...seen.length]}`);
    assert.equal(seen.wind.size, beg ? 3 : 4, `${s.aids} winds ${[...seen.wind]}`);
    assert.equal(seen.time.size, beg ? DAY_TIMES.length : TIMES.length, `${s.aids} times ${[...seen.time]}`); assert.equal(seen.sky.size, SKIES.length);   // step D: Night at Club and Pro only
    assert.deepEqual([...seen.rivals].sort(), [2, 3, 4, 5]);
    if (beg) { assert.ok(!seen.wind.has(4) && !seen.length.has('full')); }
  }
  // consecutive hands of a day differ, and a day's hands differ from the next day's
  const a = dealHand(handSeed('2026-11-16', 0), SETUPS[1]), b = dealHand(handSeed('2026-11-17', 0), SETUPS[1]);
  assert.notDeepEqual(a, b);
});

test('every hand is valid and inside the dials\' ranges; the settings ride along; never the last hand twice running', () => {
  for (const s of [...SETUPS, { ...DEFAULT_SETUP, skill: 'pro', aids: 'beginner' }, { ...DEFAULT_SETUP, skill: 'easy', aids: 'pro', laylines: true }]) {
    for (let n = 0; n < 300; n++) {
      const h = dealHand(handSeed('d', n), s);
      assert.ok(validHand(h), JSON.stringify(h));
      assert.equal(h.scale, scaleFor(h.course, h.length)); assert.ok(h.scale >= 0.35 && h.scale <= 1);
      assert.ok(WINDS.some((w) => w.level === h.wind) && (h.event === 'match' ? h.rivals === 1 : h.event === 'trial' ? h.rivals === 0 : h.rivals >= RIVALS.min && h.rivals <= RIVALS.max), `${h.event}: ${h.rivals} rivals`);
      assert.ok(TIMES.some((t) => t.hour === h.hour) && (isNightHand(h) ? s.aids !== 'beginner' : h.hour > sunriseHour() && h.hour < 20.4), `after sunrise, before sunset, or a Club or Pro night (${h.hour})`);
      assert.equal(h.skill, s.skill); assert.equal(h.tier, s.skill); assert.equal(h.aids, s.aids); assert.ok(FLEET_TIER[h.tier] != null);
      assert.ok(s.aids === 'pro' ? [0, 45, 90].includes(h.prestartS) : h.prestartS === 0, `a flying start (Pro: now and then the box) ${h.prestartS}`); assert.equal(h.laps, courseOf(h.course).laps, 'a dealt hand sails the course\'s own laps');
      assert.ok(minutesFor(h) >= 2 && minutesFor(h) <= (h.course === 'bay-tour' ? 22 : 16), `${h.course} ${minutesFor(h)} min`);
      if (h.course === 'bay-tour') assert.ok(s.aids !== 'beginner' && h.length !== 'full' && h.wind >= 2, `the Bay Tour: Club and Pro only, never Full or Light (${JSON.stringify(h)})`);
      const d = describeHand(h); assert.ok(d.name && d.line1 && d.line2 && /about \d+ min/.test(d.line2), JSON.stringify(d));
    }
  }
  // the laylines: always on at Beginner and Club, the player's option at Pro
  assert.equal(dealHand(1, { ...DEFAULT_SETUP, ...PRESETS.pro, laylines: false }).laylines, false);
  assert.equal(dealHand(1, { ...DEFAULT_SETUP, ...PRESETS.pro, laylines: true }).laylines, true);
  assert.equal(dealHand(1, { ...DEFAULT_SETUP, ...PRESETS.club }).laylines, true);
  // the last hand is not dealt again: over 300 seeds, a hand never equals the hand passed as last
  for (let n = 0; n < 300; n++) { const prev = dealHand(handSeed('x', n), SETUPS[0]), next = dealHand(handSeed('x', n), SETUPS[0], { last: handKey(prev) }); assert.notEqual(handKey(next), handKey(prev)); }
  // a broken hand is not valid
  const h = dealHand(7, SETUPS[0]);
  for (const bad of [{ wind: 5 }, { rivals: 6 }, { rivals: -1 }, { scale: 0.2 }, { hour: 22.5 }, { sky: 'storm' }, { tier: 'ace' }, { laps: 4 }, { laps: 0 }, { course: 'nowhere' }, { shifts: 'gusty' }, { prestartS: 60 }, { pace: 3 }]) assert.equal(validHand({ ...h, ...bad }), false, JSON.stringify(bad));
});

test('the setup: one stored object, clamped on read; the old level key carried over once; presets over both dials', () => {
  const st = memStore();
  assert.deepEqual({ ...loadSetup(st), chosen: undefined }, { ...DEFAULT_SETUP, chosen: undefined });
  assert.equal(loadSetup(st).chosen, false);
  // the old key: Pro with laylines → Pro's preset (hard rivals, Pro aids) and its laylines
  saveLevel(st, { level: 'pro', laylines: true });
  const m = loadSetup(st); assert.equal(m.skill, 'hard'); assert.equal(m.aids, 'pro'); assert.equal(m.laylines, true); assert.equal(m.migrated, true);
  // saved and read back; junk fields clamp to their defaults
  saveSetup(st, { skill: 'pro', aids: 'beginner', laylines: true, dealt: 4, raced: 2, last: 'k' });
  const r = loadSetup(st); assert.equal(r.skill, 'pro'); assert.equal(r.aids, 'beginner'); assert.equal(r.dealt, 4); assert.equal(r.raced, 2); assert.equal(presetOf(r), null);
  st.setItem(SETUP_KEY, JSON.stringify({ skill: 'ace', aids: 7, laylines: 'yes', dealt: -3, raced: 'x', last: 5 }));
  const c = loadSetup(st); assert.equal(c.skill, 'easy'); assert.equal(c.aids, 'beginner'); assert.equal(c.laylines, false); assert.equal(c.dealt, 0); assert.equal(c.raced, 0); assert.equal(c.last, '');
  st.setItem(SETUP_KEY, '{not json'); assert.equal(loadSetup(st).skill, 'hard', 'a broken setup reads as none: the old key (Pro) carries over');
  st.removeItem(LEVEL_KEY); assert.equal(loadSetup(st).skill, 'easy');
  for (const id of Object.keys(PRESETS)) assert.equal(presetOf({ ...PRESETS[id] }), id);
  // a store that throws: defaults, no throw
  const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadSetup(bad).aids, 'beginner'); assert.equal(saveSetup(bad, { aids: 'club' }).aids, 'club');
});

test('the URL: a live page opens on the hub; a race-shaping flag sails the URL\'s race; ?quick=1 deals and goes straight in the box; a capture never deals', () => {
  assert.deepEqual(hubAtEnter({ mode: 'regatta', seed: '1', once: '0', autoplay: false, rivals: null, quick: null }, true), { hub: true, deal: true });   // the parsed rows' empties
  for (const k of ['rivals', 'course', 'autoplay', 'racet', 'speed', 'wind']) assert.deepEqual(hubAtEnter({ mode: 'regatta', [k]: '2' }, true), { hub: false, deal: false }, k);
  assert.deepEqual(hubAtEnter({ quick: '1' }, true), { hub: false, deal: true });
  assert.deepEqual(hubAtEnter({}, false), { hub: false, deal: false });
});

test('the page\'s conditions: the wind\'s level at once over the lake (no front blowing in); the clock cut forward to the hour, never a day for nothing', () => {
  const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 15, rate: 0, start: START }) });
  wf.at(0);
  windNow(wf, 1, { t: 0, at: { x: 0, z: 0 } }); wf.at(0); const light = wf.base.speedMs;
  windNow(wf, 4, { t: 0, at: { x: 0, z: 0 } }); wf.at(0); const strong = wf.base.speedMs;
  assert.equal(wf.level, 4); assert.ok(strong > light * 2, `${light.toFixed(1)} → ${strong.toFixed(1)} m/s`);
  // the same at a point 2 km off: no front still on its way
  assert.ok(Math.abs(wf.levelScaleAt(2000, -2000, 0) - wf.levelScaleAt(0, 0, 0)) < 1e-9);
  let hour = 15.0, cuts = 0; const clock = { t: 10, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; cuts++; } };
  assert.equal(hourCut(clock, 19.25), true); assert.equal(hour, 19.25);
  assert.equal(hourCut(clock, 19.25), false); assert.equal(cuts, 1);   // already there: no cut a day ahead
  assert.equal(hourCut(clock, 6.25), true); assert.ok(Math.abs(hour - (24 + 6.25)) < 1e-9, `forward only (${hour})`);
});

test('no day hand starts before sunrise: Dawn is sunrise + 15 min from the day\'s sun, the night-red theme never applies from the hub to the finish of a day hand', () => {
  const rise = sunriseHour(), dawn = dawnHour();
  assert.ok(Math.abs(rise - (5 + 40 / 60)) < 3 / 60, `sunrise ${rise.toFixed(3)} h (05:40 on 2026-07-04 at Tahoe)`);
  assert.ok(dawn >= rise + DAWN.afterSunriseMin / 60 - 1e-9 && dawn <= rise + 45 / 60, `Dawn ${dawn.toFixed(3)} h`);
  assert.equal(TIMES.find((t) => t.id === 'dawn').hour, dawn);
  // every hand over every seed and setup: after sunrise, and the theme is day (even coming from night: the +1° limit) at the hand's
  // hour, while the hub is up and through the race's end
  for (const s of SETUPS) for (let n = 0; n < 200; n++) {
    const h = dealHand(handSeed('sun', n), s);
    if (isNightHand(h)) continue;   // step D: a night hand is night by choice (the marks lit: regatta-step-d.test.mjs)
    assert.ok(h.hour > rise, `${h.time} at ${h.hour} before sunrise ${rise.toFixed(3)}`);
    for (const dtH of [0, 2 / 60, (minutesFor(h) + 3) / 60]) {
      const e = sunElevDeg(h.hour + dtH);
      assert.ok(e > NIGHT.above && !isNight('auto', e, true), `${h.time} +${(dtH * 60).toFixed(0)} min: the sun at ${e.toFixed(1)}°`);
    }
  }
});

// ---------------- the hub's flow on the page's race in node ----------------
const fakeLines = () => ({ stats: { active: false, count: 0 }, setActive(on) { this.stats.active = on; }, write(f, n) { this.stats.count = n; } });
const fakeProps = () => ({ stats: { instances: 0 }, setActive() {}, begin() {}, put() {}, end() {} });
function raceInNode({ flags = {}, store = memStore(), onLeave } = {}) {
  const wind = { sample: (x, z, t) => { const v = steadyWind(6, 210)(x, z, t); return { vx: v.vx, vz: v.vz }; }, base: { dirDeg: 210, speedMs: 6 }, levelSet: [], setLevel(n) { this.levelSet.push(n); this.level = n; return 1; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const skies = [];
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', ...flags }, P: { headless: true }, lines: fakeLines(), props: fakeProps(),
    store, persist: true, sky: (id) => skies.push(id), ...(onLeave ? { onLeave } : {}) });
  return { R, B, wind, store, skies, hour: () => hour };
}

test('open Regatta: the hub with the race held in the box; In the box starts the race with the hand\'s settings', async () => {
  const { R, wind, skies, hour } = raceInNode();
  await R.enter({ hub: true, deal: true });
  const h = R.hand;
  assert.ok(R.on && R.hubOpen && (validHand(h) || !!h.place), JSON.stringify(h));   // the hub opens on the area's first place race (select, then go)
  assert.ok(isPlace(R.selected) && h.place === R.selected, String(R.selected));
  // the page took the hand's conditions
  assert.equal(wind.levelSet.at(-1), h.wind); assert.equal(skies.at(-1), h.sky); assert.ok(Math.abs((hour() % 24) - h.hour) < 1e-9, `${hour()} vs ${h.hour}`);
  // the start is laid with the hand's fleet (a Beginner hand: a flying start, the countdown 8.5 s × the pace); nothing advances behind
  // the hub (the clock holds, the boat stays on her mark)
  assert.equal(R.session.rivals.length, h.rivals); assert.equal(h.prestartS, 0); assert.equal(R.session.flying, true);
  const pre = R.session.prestartS; assert.ok(Math.abs(pre - 8.5 * h.pace) < 1e-9, `the countdown ${pre}`);
  for (let k = 0; k < 4; k++) R.settle(1);
  const s0 = R.state(); assert.ok(s0.clock <= -pre + 0.1, `held at ${s0.clock}`); assert.equal(s0.hub, true);
  assert.equal(R.session.race.view('me').status, 'prestart');
  // the course at the hand's scale (the Island Sprint's legs scale with it)
  assert.equal(R.course.place, h.place); assert.ok(R.course.totalM > 300, `the place race's course laid behind the hub (${R.course.totalM.toFixed(0)} m)`);
  // In the box: the race runs from −0:45 with the hand's rivals, tier, aids and seed
  R.go();
  assert.equal(R.hubOpen, false);
  const tierSkill = FLEET_TIER[h.tier];
  assert.ok(Math.abs(R.session.rivals[0].skill - (tierSkill + 0.03)) < 1e-9 || Math.abs(R.session.rivals[0].brain.base - (tierSkill + 0.03)) < 1e-6, `the rivals at ${h.tier}`);
  assert.equal(R.aids.level, h.aids); assert.equal(R.aids.helper, h.helper); assert.equal(R.speed(), h.pace);
  R.settle(5); assert.ok(R.state().clock > -pre + 4, `the race runs (${R.state().clock})`);
  // stored: a hand sailed, the next visit deals another
  assert.equal(R.setup.raced, 1); assert.equal(R.setup.last, handKey(h));
  // Race again: instant, back in the box, no hub, the same hand
  R.restart();
  assert.equal(R.hubOpen, false); assert.ok(R.state().clock < -pre + 0.1); assert.equal(handKey(R.hand), handKey(h));
});

test('Another hand deals again (a different hand, the box laid again); the presets and the two dials reach the session', async () => {
  const { R } = raceInNode();
  await R.enter({ hub: true, deal: true });
  const keys = new Set([handKey(R.hand)]);
  for (let k = 0; k < 5; k++) { const before = handKey(R.hand); R.deal(); assert.notEqual(handKey(R.hand), before); keys.add(handKey(R.hand)); assert.equal(R.session.rivals.length, R.hand.rivals); assert.ok(R.hubOpen); }
  assert.ok(keys.size >= 4, `${keys.size} hands in 6 deals`);
  assert.equal(R.setup.dealt, 5);
  // a preset sets both dials; the dials apart are a custom pair; the session's rivals follow the skill dial, the helper the aids dial
  R.adjust({ ...PRESETS.pro });
  assert.equal(R.hand.tier, 'hard'); assert.equal(R.aids.level, 'pro'); assert.equal(R.session.helper, false); assert.equal(R.speed(), 1.5);
  const hard = R.session.rivals[0].skill;
  R.adjust({ skill: 'pro', aids: 'beginner' });
  assert.equal(R.hand.tier, 'pro'); assert.equal(R.aids.level, 'beginner'); assert.equal(R.session.helper, true); assert.equal(presetOf(R.setup), null);
  assert.ok(R.session.rivals[0].skill > hard, `Pro rivals sharper than Hard (${R.session.rivals[0].skill} > ${hard})`);
  R.adjust({ skill: 'easy' });
  assert.equal(R.hand.tier, 'easy'); assert.equal(R.aids.level, 'beginner'); assert.equal(presetOf(R.setup), 'beginner');
  // the hand's conditions are untouched by the dials
  const k0 = handKey(R.hand); R.adjust({ ...PRESETS.club }); assert.equal(handKey(R.hand), k0);
});

test('the setup persists across visits: the next visit opens on the first race, with the dials kept', async () => {
  const store = memStore();
  const a = raceInNode({ store }); await a.R.enter({ hub: true, deal: true });
  a.R.adjust({ skill: 'hard', aids: 'club' }); const first = handKey(a.R.hand); a.R.go();
  const b = raceInNode({ store }); await b.R.enter({ hub: true, deal: true });
  assert.equal(b.R.setup.skill, 'hard'); assert.equal(b.R.setup.aids, 'club'); assert.equal(b.R.hand.tier, 'hard');
  assert.equal(b.R.hand.place, a.R.hand.place ?? b.R.hand.place); assert.ok(isPlace(b.R.hand.place), 'the next visit opens on a race again');
  assert.ok(store.getItem(SETUP_KEY) && store.getItem(LEVEL_KEY));
});

test('the URL\'s race (no hub, no hand) is as before: ?course=short sails its own scale and the level\'s rivals', async () => {
  const { R } = raceInNode({ flags: { course: 'short', handseed: undefined } });
  await R.enter();
  assert.equal(R.hubOpen, false); assert.equal(R.hand, null); assert.ok(R.state().clock < -44);
});

// ---------------- the course board ----------------
test('the course board: the course turned so the first beat goes up, every mark and the line inside the drawing', () => {
  const c = courseFor('tahoe-emerald', 'island-sprint');
  const svg = courseSvg(c, { w: 412, h: 250 });
  assert.match(svg, /^<svg viewBox="0 0 412 250"/);
  const nums = [...svg.matchAll(/(?:cx|cy|x|y)="(-?[\d.]+)"/g)].map((m) => +m[1]);
  assert.ok(nums.length >= 6 && nums.every((v) => v >= -1 && v <= 413), JSON.stringify(nums));
  // W (the windward mark) is drawn above the start line
  const wy = +svg.match(/<circle cx="[\d.]+" cy="([\d.]+)" r="6"/)[1], line = svg.match(/<circle cx="[\d.]+" cy="([\d.]+)" r="3.2"/);
  assert.ok(wy < +line[1], `W at y ${wy} above the pin at ${line[1]}`);
  // the marks by number and their rounding (owner 2026-11-16), F at the line; the course's ids stay internal
  assert.match(svg, />1 \u27F2</); assert.match(svg, />2 \u27F2</); assert.match(svg, />F</); assert.doesNotMatch(svg, />[WI]</);
  // the small one: no letters (nothing under 15 px)
  assert.doesNotMatch(courseSvg(c, { w: 150, h: 118, labels: false }), /<text/);
});

// ---------------- the hand's courses on the real terrain ----------------
const terrainP = ground('full');
test('every length and time a hand deals lays a course in deep water on the real terrain', async () => {
  const S = await terrainP, h = (x, z) => S.height(x, z);
  const C = courseFor('tahoe-emerald', 'island-sprint');
  for (const L of LENGTHS) for (const T of TIMES) {
    const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({ wind: 3 }, { hour: T.hour, rate: 0, start: START }) });
    wf.setTerrain(h); wf.at(0);
    const dir = Math.round(wf.base.dirDeg), [k, w] = WindField.bins(wf.base.dirDeg);
    const r = layFairCourse(C, dir, { loadCourse, snapCourse, depthAt: (x, z) => -h(x, z), factorAt: (x, z) => wf.binAt(k, x, z)[2] * (1 - w) + wf.binAt(k + 1, x, z)[2] * w, scale: L.scale });
    for (const m of r.course.marks) assert.ok(-h(m.at[0], m.at[1]) >= 8, `${L.id} ${T.id}: mark ${m.id} in ${(-h(m.at[0], m.at[1])).toFixed(1)} m`);
    assert.ok(-h(r.course.line.centre[0], r.course.line.centre[1]) >= 8, `${L.id} ${T.id}: the line in deep water`);
  }
});

test('select, then go: a selection lays that race behind the hub (its marks, lines, hour), changes nothing else, and To the line starts it', async () => {
  const { R, hour } = raceInNode();
  await R.enter({ hub: true, deal: true });
  const a = R.selected, c0 = R.course.line.centre.map(Math.round);
  const b = a === 'tea-house-run' ? 'pass-the-channel' : 'tea-house-run';
  R.select(b);
  assert.equal(R.selected, b); assert.equal(R.hand.place, b); assert.ok(R.hubOpen && !R.state().racing, 'a selection never starts');
  assert.equal(R.course.id, b); assert.notDeepEqual(R.course.line.centre.map(Math.round), c0, 'the start area moved to the new race');
  assert.ok(Math.abs((hour() % 24) - R.hand.hour) < 1e-9, 'the sky took the race\'s hour');
  R.select('not-a-race'); assert.equal(R.selected, b, 'an unknown race changes nothing');
  R.go();
  assert.equal(R.hubOpen, false); assert.equal(R.placeRace?.id, b);
});

test('select, then go: the cup\'s Race all three and its Explore row preview the cup\'s first race; Explore leaves for free sailing', async () => {
  let left = 0;
  const { R } = raceInNode({ onLeave: () => { left++; } });
  await R.enter({ hub: true, deal: true });
  R.select('hunt:chart-the-bay');
  assert.equal(R.selected, 'hunt:chart-the-bay'); assert.equal(R.hand.place, 'tea-house-run', 'the water keeps the cup\'s first race behind the hunt row');
  R.select('cup:the-mouth');
  assert.equal(R.selected, 'cup:the-mouth'); assert.equal(R.hand.place, 'pass-the-channel'); assert.ok(R.hubOpen);
  R.select('hunt:nope'); assert.equal(R.selected, 'cup:the-mouth', 'an unknown hunt changes nothing');
  R.select('hunt:chart-the-mouth'); R.explore();
  assert.equal(left, 1, 'Explore leaves Regatta for free sailing');
});
