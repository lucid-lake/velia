// Regatta's step B: the courses (Harbour Dash, Twice Round, Bay Tour beside the Island Sprint: each valid, laid in
// deep water, raced to the finish by the computer fleet in sim), two laps (the marks rounded twice in order, the results, the lap on
// the watch), the shift patterns (each with its own wind signature on the wind module; the fleet and the coach cope), Custom race
// (the picks reach the session; stored, clamped on read; Deal for me), the baked course cards. The browser half:
// v2/tests/pages/regattaCustom.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoatPhysics, DT, steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, courseIds, loadCourse, snapCourse, trackerCourse } from '../../src/sim/race/course.js';
import { createRegattaSession } from '../regatta/session.js';
import { courseToWind } from '../regatta/geometry.js';
import { createRegatta } from '../regatta/index.js';
import { makePattern, shiftTo, SHIFTS, OSC, PERSIST } from '../regatta/shifts.js';
import { loadSetup, saveSetup, clampCustom, customHand, dealHand, handSeed, handKey, validHand, describeHand, minutesFor, COURSES, DEFAULT_SETUP, DEFAULT_CUSTOM, SETUP_KEY, PRESETS, STARTS, PACES, WATERS } from '../regatta/setup.js';
import { customDials } from '../regatta/hub.js';
import { resultCard } from '../regatta/review.js';
import { watchLines } from '../regatta/ui.js';
import { markNumbers, legLine } from '../regatta/marks.js';
import { bakeText, OUT } from '../../tools/v2-regatta-outlines.mjs';

const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const DEG = Math.PI / 180;

// ---------------- the courses ----------------
test('the lake\'s courses: four shipped JSONs, each valid; Twice Round sails the marks twice; every course keeps its own lengths', () => {
  assert.deepEqual(courseIds(WATERS), ['island-sprint', 'harbour-dash', 'twice-round', 'bay-tour']);
  for (const id of courseIds(WATERS)) {
    const c = courseFor(WATERS, id);
    assert.ok(c.name && c.blurb && c.legs.length >= 3 && c.legs.at(-1).toId === 'finish', id);
    assert.equal(c.scales.length, 3); assert.ok(c.scales[0] < c.scales[1] && c.scales[1] < c.scales[2] && c.scales[2] <= 1, id);
    assert.equal(c.markIds.length, (c.lapLegs.length - 1) * c.laps);
    assert.equal(trackerCourse(c).sequence.length, c.markIds.length);
    // any lap count 1–3 lays the marks that many times, then the finish
    for (const n of [1, 2, 3]) { const k = courseFor(WATERS, id, { laps: n }); assert.equal(k.legs.length, (c.lapLegs.length - 1) * n + 1); assert.equal(k.laps, n); }
  }
  assert.deepEqual(courseFor(WATERS, 'twice-round').markIds, ['W', 'I', 'W', 'I']);
  assert.deepEqual(courseFor(WATERS, 'harbour-dash').markIds, ['W', 'L']);
  assert.deepEqual(courseFor(WATERS, 'bay-tour').markIds, ['W', 'M', 'E', 'I']);
  assert.throws(() => courseFor(WATERS, 'island-sprint', { laps: 4 }), /laps/);
  // a course turned to another wind keeps its laps (the legs not doubled twice)
  const t = courseToWind(courseFor(WATERS, 'twice-round'), 190, { loadCourse, scale: 0.35 });
  assert.deepEqual(t.markIds, ['W', 'I', 'W', 'I']); assert.ok(t.timeLimitS >= 900);
  // the time limit grows with the course: Bay Tour's never cuts a slow boat short
  const b = courseToWind(courseFor(WATERS, 'bay-tour'), 200, { loadCourse, scale: 0.85 });
  assert.ok(b.timeLimitS >= b.totalM / 0.7, `${b.timeLimitS} s for ${b.totalM.toFixed(0)} m`);
  // about how long, from the course's metres: Harbour Dash about 3 min at Short, Bay Tour about 14 at Club (Fresh, 2 ×)
  const h = (course, length) => customHand({ ...DEFAULT_SETUP, custom: { ...DEFAULT_CUSTOM, course, length, laps: COURSES.find((c) => c.id === course).laps, wind: 3, pace: 2 } });
  assert.equal(minutesFor(h('harbour-dash', 'short')), 3); assert.equal(minutesFor(h('island-sprint', 'short')), 3);
  assert.ok(Math.abs(minutesFor(h('bay-tour', 'club')) - 14) <= 1, `${minutesFor(h('bay-tour', 'club'))} min`);
});

test('the course cards\' art is baked from the courses (outlines.json is current; the wind from the top, every mark drawn)', () => {
  assert.equal(readFileSync(OUT, 'utf8'), bakeText(), 'run node tools/v2-regatta-outlines.mjs');
  const o = JSON.parse(readFileSync(OUT, 'utf8'))[WATERS];
  assert.deepEqual(Object.keys(o), courseIds(WATERS));
  for (const id of courseIds(WATERS)) {
    const c = courseFor(WATERS, id, { laps: 1 });
    assert.match(o[id].card, /^<svg viewBox="0 0 240 150"/); assert.match(o[id].mini, /^<svg viewBox="0 0 96 64"/);
    for (const [, n] of markNumbers(c)) assert.match(o[id].card, new RegExp(`>${n} [\u27F2\u27F3]<`), `${id}: mark ${n} labelled by its number`);
    assert.doesNotMatch(o[id].mini, /<text/, 'the thumbnail has no letters (nothing under 15 px)');
  }
});

// a fleet race with the player parked far away: the rivals alone to the last finisher (the wind field without terrain, a pattern on it)
function fleetRace({ id, scale, laps, rivals = 5, dir = 210, shifts = null, seed = 1, maxS = 2400, prestartS = 45, level = 3 } = {}) {
  const course = courseToWind(courseFor(WATERS, id), dir, { loadCourse, snapCourse, scale, laps });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs: [0, 3, 5, 7.5, 10][level] } });
  const tGun = prestartS;
  if (shifts) wf.pattern = makePattern(shifts, { tGun, raceS: 400 });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed, tier: 'medium', forgiving: true, prestartS });
  const log = []; let t = 0;
  while (t < maxS + prestartS && !S.rivals.every((r) => S.race.view(r.id).status === 'finished')) { t += DT; S.advanceTo(t); log.push(...S.drain()); }
  return { S, log, course, wf };
}
const roundings = (log, id) => log.filter((e) => e.type === 'rounded' && e.id === id).map((e) => e.mark);

test('every course is raced to the finish by the computer fleet, each rounding its marks in order (each under a shift pattern)', () => {
  const runs = [
    { id: 'harbour-dash', scale: 0.35, rivals: 3, shifts: 'oscillating' },
    { id: 'twice-round', scale: 0.35, rivals: 2, shifts: 'left' },
    { id: 'bay-tour', scale: 0.55, rivals: 1, shifts: 'right', level: 4 },
  ];
  for (const r of runs.slice(0, 1)) {   // the other courses: v2/tests/slow/regatta-custom.slow.mjs
    const { S, log, course } = fleetRace(r);
    for (const b of S.rivals) {
      assert.equal(S.race.view(b.id).status, 'finished', `${r.id}: ${b.name} finished (${S.race.view(b.id).status}, leg ${S.race.view(b.id).leg})`);
      assert.deepEqual(roundings(log, b.id), course.markIds, `${r.id}: ${b.name} rounded ${roundings(log, b.id).join(', ')}`);
      assert.ok(!log.some((e) => e.type === 'ocs' && e.id === b.id), `${r.id}: ${b.name} never over early`);
    }
    // the results: the rivals placed 1st to last in the order they crossed (the parked player last, unfinished)
    const fin = log.filter((e) => e.type === 'finished'), order = S.race.order();
    assert.deepEqual(fin.map((e) => e.place), S.rivals.map((_, i) => i + 1), `${r.id}: places`);
    assert.deepEqual(order.slice(0, S.rivals.length), fin.map((e) => e.id), `${r.id}: the order is the finish order`); assert.equal(order.at(-1), 'me');
  }
});

test('a −3:00 and a −1:30 pre-start: the fleet waits in the box and starts clean', () => {
  for (const prestartS of [90]) {   // the −3:00 box too: v2/tests/slow/regatta-custom.slow.mjs
    const course = courseToWind(courseFor(WATERS, 'harbour-dash'), 210, { loadCourse, snapCourse, scale: 0.35 });
    const windAt = (x, z, t) => steadyWind(7, 210)(x, z, t);
    const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
    const S = createRegattaSession({ course, me: { phys }, rivals: 3, windAt, seed: 2, tier: 'medium', prestartS });
    assert.ok(S.race.clock <= -prestartS + 1e-9);
    const log = []; let t = 0;
    while (t < prestartS + 25) { t += DT; S.advanceTo(t); log.push(...S.drain()); }
    for (const b of S.rivals) {
      const st = log.find((e) => e.type === 'started' && e.id === b.id);
      assert.ok(st && st.delayS >= 0 && st.delayS < 15, `−${prestartS} s: ${b.name} started ${st?.delayS?.toFixed(1)} s after the gun`);
      assert.ok(!log.some((e) => e.type === 'ocs' && e.id === b.id && !e.early), `−${prestartS} s: ${b.name} not over at the gun`);
    }
  }
});

// ---------------- the shift patterns ----------------
test('the shift patterns: steady holds, oscillating swings ±10° every 90 s, persistent turns 12° to its side; on the wind module', () => {
  const wf = new WindField({ seed: 3, bay: CURRENT_WATERS.windBay, base: { dirDeg: 200, speedMs: 6 }, shifts: true });
  const dirs = (id, T = 400) => { wf.pattern = id ? makePattern(id, { tGun: 45, raceS: 300 }) : null; const o = []; for (let t = 0; t <= T; t += 1) o.push(wf.dirAt(300, -200, t) - 200); return o; };
  const lake = dirs(null), steady = dirs('steady'), osc = dirs('oscillating'), left = dirs('left'), right = dirs('right');
  const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  assert.ok(sd(lake) > 0.5, `the lake's own shifts wander (${sd(lake).toFixed(2)}°)`);
  assert.ok(sd(steady) < 1e-9, 'steady: no shift at all');
  // oscillating: ±10°, zero at the gun (t 45) and at the pre-start's start (t 0), a period of 90 s (zero crossings 45 s apart)
  assert.ok(Math.abs(Math.max(...osc) - OSC.ampDeg) < 0.05 && Math.abs(Math.min(...osc) + OSC.ampDeg) < 0.05, `${Math.min(...osc).toFixed(1)} … ${Math.max(...osc).toFixed(1)}`);
  assert.ok(Math.abs(osc[45]) < 1e-6 && Math.abs(osc[0]) < 1e-6);
  const ups = []; for (let i = 1; i < osc.length; i++) if (osc[i - 1] < 0 && osc[i] >= 0) ups.push(i);
  assert.ok(ups.length >= 3 && ups.slice(1).every((u, i) => Math.abs(u - ups[i] - OSC.periodS) <= 1), `upward crossings ${ups.join(', ')}`);
  // persistent: 0 until the gun, then a steady turn to its side, the whole 12° by the race's end, never back
  for (const [a, s] of [[left, -1], [right, 1]]) {
    assert.equal(a[30], 0); assert.ok(Math.abs(a[45 + 300] - s * PERSIST.deg) < 1e-6, `${a[345]}`);
    for (let i = 46; i < a.length; i++) assert.ok(s * (a[i] - a[i - 1]) >= -1e-9, 'monotonic');
    assert.ok(s * a[45 + 150] > 4 && s * a[45 + 150] < 8, `half-way ${a[195].toFixed(1)}°`);
  }
  // the whole field sees it: the sampled wind turns with the pattern (the valley's own bend on top, unchanged)
  wf.pattern = makePattern('right', { tGun: 0, raceS: 300 });
  const at = (t) => { const w = wf.sample(300, -200, t); return Math.atan2(-w.vx, w.vz) / DEG; };
  const d0 = at(0), d1 = at(300);
  assert.ok(Math.abs(((d1 - d0 + 540) % 360) - 180 - PERSIST.deg) < 1.5, `sampled ${d0.toFixed(1)} → ${d1.toFixed(1)}`);
  wf.pattern = null;
  // a header and a lift: starboard tack is headed by a backing wind, port by a veer
  assert.equal(shiftTo(-8, 'stbd'), 'header'); assert.equal(shiftTo(8, 'stbd'), 'lift'); assert.equal(shiftTo(8, 'port'), 'header'); assert.equal(shiftTo(-8, 'port'), 'lift');
  assert.deepEqual(SHIFTS.map((s) => s.id), ['steady', 'oscillating', 'left', 'right']);
});

// ---------------- Custom race on the page's race in node ----------------
// a fake wind that turns with the race's pattern (as the WindField does) and records the level asked for
function raceInNode({ flags = {}, store = memStore() } = {}) {
  const wind = { pattern: null, base: { dirDeg: 210, speedMs: 6 }, levelSet: [], setLevel(n) { this.levelSet.push(n); this.level = n; return 1; },
    sample(x, z, t) { const d = 210 + (this.pattern ? this.pattern.deg(t) : 0), v = steadyWind(6, d)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSimLite(wind);
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const skies = [];
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true, sky: (id) => skies.push(id) });
  return { R, B, wind, store, skies, hour: () => hour };
}
import { createBoatSim, waterFor } from '../sim/boat.js';
const createBoatSimLite = (wind) => createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });

const PICK = { event: 'fleet', course: 'harbour-dash', length: 'club', laps: 2, wind: 2, shifts: 'left', sky: 'clear', time: 'golden', rivals: 2, start: 90, pace: 1.5 };
test('Custom race: every pick reaches the session (course, length, laps, wind, shifts, sky, time, rivals, start, pace; the two dials)', async () => {
  const store = memStore(), { R, wind, skies, hour } = raceInNode({ store });
  await R.enter({ hub: true, deal: true });
  assert.ok(R.hubOpen && !R.hand.custom);
  for (const [k, v] of Object.entries(PICK)) R.custom({ [k]: v });
  R.adjust({ skill: 'hard', aids: 'club' });
  assert.deepEqual(clampCustom(R.setup.custom), PICK, 'the picks stored');
  assert.ok(R.hubOpen, 'a pick does not start the race');
  R.raceCustom();
  const h = R.hand;
  assert.equal(R.hubOpen, false); assert.ok(h.custom && validHand(h), JSON.stringify(h));
  assert.equal(R.course.id, 'harbour-dash'); assert.equal(R.course.laps, 2); assert.deepEqual(R.course.markIds, ['W', 'L', 'W', 'L']);
  const full = courseFor(WATERS, 'harbour-dash', { laps: 2 }).totalM;
  assert.ok(Math.abs(R.course.totalM / full - 0.5) < 0.05, `the Club scale (${(R.course.totalM / full).toFixed(3)})`);
  assert.equal(wind.levelSet.at(-1), 2); assert.equal(skies.at(-1), 'clear'); assert.ok(Math.abs((hour() % 24) - 19.25) < 1e-9);
  assert.equal(R.session.rivals.length, 2); assert.equal(R.hand.tier, 'hard'); assert.equal(R.aids.level, 'club'); assert.equal(R.aids.helper, false);
  assert.ok(Math.abs(R.state().clock + 90) < 0.1, `the box at −1:30 (${R.state().clock})`);
  assert.equal(R.speed(), 1.5);
  assert.equal(wind.pattern?.id, 'left'); assert.equal(R.stats.shifts, 'left');
  assert.equal(describeHand(h).start, 'Line −1:30');
  // remembered: the picks stay for the Custom row
  assert.equal(R.setup.useCustom, true);
  R.leave(); assert.equal(wind.pattern, null, 'the lake\'s own shifts again after the race');
  const b = raceInNode({ store }); await b.R.enter({ hub: true, deal: true });
  assert.ok(!b.R.hand.custom && !!b.R.hand.place); assert.deepEqual(clampCustom(b.R.setup.custom), PICK, 'the picks kept for the Custom row');   // select, then go: the hub opens on a race, not on the Custom race
  // Deal for me: back to the selected race
  b.R.dealForMe();
  assert.equal(b.R.setup.useCustom, false); assert.ok(!b.R.hand.custom && b.R.hubOpen); assert.deepEqual(clampCustom(b.R.setup.custom), PICK, 'the picks kept for next time');
});

test('the remembered picks are checked and clamped on read; a broken store never breaks the race', () => {
  const st = memStore();
  st.setItem(SETUP_KEY, JSON.stringify({ skill: 'medium', aids: 'club', useCustom: true, custom: { course: 'nowhere', length: 'huge', laps: 9, wind: 7, shifts: 'gusty', sky: 'storm', time: 'midnight', rivals: -2, start: 200, pace: 5 } }));
  const s = loadSetup(st);
  assert.equal(s.useCustom, true);
  assert.deepEqual(s.custom, { ...DEFAULT_CUSTOM, laps: 3, rivals: 0, start: 180, pace: 2 });
  assert.ok(validHand(customHand(s, 3)));
  st.setItem(SETUP_KEY, JSON.stringify({ custom: { course: 'bay-tour', laps: 2.7, rivals: 3.9, start: 100, pace: 1.4 } }));
  const c = loadSetup(st).custom;
  assert.equal(c.course, 'bay-tour'); assert.equal(c.laps, 2); assert.equal(c.rivals, 3); assert.equal(c.start, 90); assert.equal(c.pace, 1.5);
  st.setItem(SETUP_KEY, JSON.stringify({ custom: 'junk' })); assert.deepEqual(loadSetup(st).custom, DEFAULT_CUSTOM);
  // a course's own laps when none is stored
  st.setItem(SETUP_KEY, JSON.stringify({ custom: { course: 'twice-round' } })); assert.equal(loadSetup(st).custom.laps, 2);
  // saved and read back as given
  saveSetup(st, { ...DEFAULT_SETUP, custom: PICK, useCustom: true }); assert.deepEqual(loadSetup(st).custom, PICK);
  for (const s of STARTS) assert.equal(clampCustom({ start: s.s }).start, s.s);
  for (const p of PACES) assert.equal(clampCustom({ pace: p }).pace, p);
});

test('the Custom sheet\'s rows: every dial the deal uses, each with its value and one chosen option', () => {
  const m = { setup: { ...DEFAULT_SETUP, ...PRESETS.pro, laylines: true, custom: PICK } };
  const D = customDials(m), dials = D.flatMap((r) => (r.cards ? ['course'] : r.pickers.map((p) => p.dial)));
  for (const d of ['course', 'length', 'laps', 'wind', 'shifts', 'sky', 'time', 'rivals', 'skill', 'aids', 'laylines', 'start', 'pace']) assert.ok(dials.includes(d), d);
  for (const r of D) {
    assert.ok(r.value && r.label, r.id);
    if (r.cards) { assert.equal(r.cards.filter((c) => c.on).length, 1); assert.equal(r.cards.length, COURSES.length); assert.ok(r.cards.every((c) => /^\d+ legs · about \d+ min$/.test(c.facts))); }
    else for (const p of r.pickers) assert.equal(p.options.filter((o) => o.on).length, 1, `${r.id}/${p.dial}`);
  }
  assert.equal(D.find((r) => r.id === 'wind').value, 'Moderate 8–12 kn'); assert.equal(D.find((r) => r.id === 'shifts').value, 'Persistent left');
  assert.equal(D.find((r) => r.id === 'start').value, 'Line −1:30'); assert.equal(D.find((r) => r.id === 'pace').value, '1.5 ×');
  // three sections, one dial per row, the course row a card with its facts
  assert.deepEqual([...new Set(D.map((r) => r.section))], ['course', 'cond', 'fleet']);
  for (const r of D) if (!r.cards) assert.equal(r.pickers.length, 1, r.id);
  assert.match(D.find((r) => r.id === 'course').facts, /^5 legs · about \d+ min$/);
  // laylines only at Pro aids
  assert.ok(!customDials({ setup: { ...DEFAULT_SETUP, custom: PICK } }).flatMap((r) => r.pickers ?? []).some((p) => p.dial === 'laylines'));
});

test('the deal: the Island Sprint only (Harbour Dash, Twice Round and Bay Tour retired from the hub) and the shift patterns', () => {
  for (const [aids, want] of [['beginner', ['island-sprint']], ['club', ['island-sprint']], ['pro', ['island-sprint']]]) {
    const seen = new Set(), sh = new Set(), setup = { ...DEFAULT_SETUP, ...PRESETS[aids] };
    for (let n = 0; n < 300; n++) { const h = dealHand(handSeed('b', n), setup); seen.add(h.course); sh.add(h.shifts); assert.ok(validHand(h)); }
    assert.deepEqual([...seen].sort(), [...want].sort(), aids); assert.equal(sh.size, 4, `${aids}: ${[...sh]}`);
  }
});

// ---------------- two laps, in node: the order, the watch, the results; the coach on the shifts ----------------
test('Twice Round in node: the marks rounded W, I, W, I, the watch says the lap, the finish and the results card; the coach names the shifts', async () => {
  const { R } = raceInNode({ flags: { autoplay: '1' } });
  await R.enter({ hub: true, deal: true });
  R.custom({ course: 'twice-round', length: 'short', laps: 2, wind: 3, shifts: 'oscillating', rivals: 1, start: 45, pace: 2 });
  R.adjust({ ...PRESETS.club });
  R.raceCustom();
  assert.deepEqual(R.course.markIds, ['W', 'I', 'W', 'I']);
  const rounds = [], laps = new Set();
  for (let k = 0; k < 1500 && !R.stats.result; k++) {
    R.settle(1);
    const v = R.session.race.view('me');
    for (const s of v.splits) if (!rounds.some((r) => r.at === s.at)) rounds.push(s);
    if (v.status === 'racing' && v.target) laps.add(v.target.lap);
  }
  const me = R.session.race.view('me');
  assert.equal(me.status, 'finished', `she finished (${me.status}, leg ${me.leg})`);
  assert.deepEqual(rounds.map((s) => s.mark), ['W', 'I', 'W', 'I'], 'rounded in order, twice');
  assert.deepEqual([...laps].sort(), [1, 2], 'the tracker counts the laps');
  assert.ok(rounds.every((s, i) => i === 0 || s.t > rounds[i - 1].t));
  assert.ok(R.stats.result && R.stats.result.place >= 1 && R.stats.result.place <= 2 && /^\d+:\d\d/.test(R.stats.result.time), JSON.stringify(R.stats.result));
  // the results card's model from the race (two boats, the time, the gap)
  const order = R.session.race.order(), views = Object.fromEntries(order.map((id) => [id, R.session.race.view(id)]));
  const card = resultCard({ order, views, names: { me: 'You', wren: 'Osprey' }, me: 'me', level: 'club', faults: R.review.faults });
  assert.ok(card.finished && card.boats === 2 && card.timeS > 0, JSON.stringify(card));
  // the watch's leg line names the lap (owner 2026-11-16: "2 (lap 2)"); line 2 keeps only the amber cue
  const c2 = R.course;
  assert.equal(watchLines({ clock: 60, status: 'racing', next: { text: legLine(c2, 2) } }).l1, 'Leg 3 of 5 \u00b7 Mark 1 (lap 2) \u00b7 round to port');
  assert.equal(watchLines({ clock: 60, status: 'racing', next: { text: legLine(c2, 3, true) } }).l1, 'Leg 4/5 \u00b7 \u27F2 2 (lap 2)');
  assert.equal(watchLines({ clock: 60, status: 'racing', next: { text: legLine(c2, 1) } }).l2, '');
  // the coach named the day's shifts after the gun
  assert.ok(R.stats.shiftLines.some((l) => l.id === 'shiftIntro'), JSON.stringify(R.stats.shiftLines));
});
