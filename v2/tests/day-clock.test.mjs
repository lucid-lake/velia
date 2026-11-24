// The day clock on v2 (engine/clock.js, engine/flags.js clockParams, ui/dayClock.js): v1's Sail schedule and rate to the
// digit, its start hour (from ?hour, as v1), fixed time in captures, films and under ?timerate=0, the cuts and the pace changes keep the hour continuous, the
// time menu's picks, v1's night-sky line, Sail's night at the day's rate (owner, 2026-11-15) and the fireworks as a pure time
// event (no evening: no clock change, no lines). The browser half: v2/tests/pages/dayClock.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimClock, sailSchedule, SAIL_CLOCK } from '../engine/clock.js';
import { parseV2Flags, sceneParams, clockParams, GAME_SPEED } from '../engine/flags.js';
import * as DC from '../ui/dayClock.js';
const { createDayClock, starsCue, STARS_LINE, NIGHT_SKY, FADE } = DC;
import { TimeOfDay, timeParams, DEFAULT_TIMERATE, SAIL_HOUR, NIGHT_LINE, analyticSun, dayClockSchedule, DAY_CLOCK } from '../../src/sim/timeOfDay.js';
import { sailCoreOptions, daySchedule } from '../../classic/src/sail/options.js';
import { parseFlags } from '../../src/sim/core/flags.js';
import { TIME_ROWS } from '../../src/ui/timeMenu.js';
import { SHOW_START, LINES } from '../../src/fireworks/evening.js';
import { NIGHT_MOMENT } from '../../classic/src/ui/nightMoment.js';
import { liveShowClock, SHOW_LENGTH } from '../sim/fireworks.js';
import { WindField } from '../../src/sim/wind.js';
import { sailWindOptions } from '../sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const P = (q) => sceneParams(parseV2Flags(q));
const live = () => { const p = P(''); return createSimClock({ step: 1 / 120, hour0: p.hour, timerate: p.timerate, schedule: p.clockMode === 'day' ? sailSchedule() : null }); };
const elev = (h) => { const s = analyticSun(h); return Math.asin(s.y / Math.hypot(s.x, s.y, s.z)) * 180 / Math.PI; };

test('a live page with no ?hour runs v1 Sail\'s day clock: its start hour, its base rate, its schedule', () => {
  const p = P(''), v1 = sailCoreOptions(parseFlags(''));
  assert.equal(p.hour, parseFloat(v1.defaultHour), 'v1 Sail\'s 18:45');
  assert.equal(p.hour, parseFloat(SAIL_HOUR));
  assert.equal(p.clockMode, 'day'); assert.equal(p.timerate, v1.timeRate); assert.equal(p.timerate, DEFAULT_TIMERATE);
  assert.equal(p.speed, GAME_SPEED, 'the 2 x game speed the rate is counted on');
  // ?clock=flat: v1's constant rate, no schedule (v1: clockIsFlat → timeSchedule null)
  assert.equal(sailCoreOptions(parseFlags('clock=flat')).timeSchedule, null);
  assert.deepEqual(clockParams(parseV2Flags('?clock=flat')), { clockMode: 'rate', timerate: DEFAULT_TIMERATE });
});

test('the hour on v2\'s clock equals v1\'s TimeOfDay on Sail\'s v2 schedule (v1\'s, the night at the day\'s rate) at every sim time (two game days)', () => {
  const c = live();
  const v1 = new TimeOfDay({ hour: parseFloat(SAIL_HOUR), rate: DEFAULT_TIMERATE, schedule: dayClockSchedule({ base: DEFAULT_TIMERATE, clock: { ...DAY_CLOCK, nightMult: 1 } }) });   // v1's TimeOfDay, v1's table with nightMult 1
  let worst = 0, worstRate = 0;
  for (let t = 0; t <= 2 * 3900; t += 7.3) {
    worst = Math.max(worst, Math.abs(c.hourUnwrappedAt(t) - v1.hourAt(t)));
    worstRate = Math.max(worstRate, Math.abs(c.rateAt(t) - v1.rateAt(t)));
    assert.ok(Math.abs(c.hourAt(t) - v1.hourOfDay(t)) < 1e-9 || Math.abs(Math.abs(c.hourAt(t) - v1.hourOfDay(t)) - 24) < 1e-9);
  }
  assert.ok(worst < 1e-9, `hours within ${worst}`); assert.ok(worstRate < 1e-9, `rates within ${worstRate}`);
});

test('the rate: 1 game hour per 3 real minutes by day at 2 x; golden hour slower; Sail\'s deep night at the day\'s rate (v1\'s table: 4 x)', () => {
  // by day (the sun over 25 deg): DEFAULT_TIMERATE game s per sim s, the sim at 2 x real time → 3600 / 20 = 180 real s an hour
  const c = createSimClock({ step: 1 / 120, hour0: 12.5, timerate: DEFAULT_TIMERATE, schedule: dayClockSchedule({ base: DEFAULT_TIMERATE }), maxSteps: 20 });
  assert.ok(elev(12.5) > 25 && elev(13.5) > 25);
  for (let i = 0; i < 180 * 60; i++) c.advance((1 / 60) * GAME_SPEED);
  assert.ok(Math.abs(c.hour - 13.5) < 0.002, `180 real s moved the noon hour to ${c.hour.toFixed(4)}`);
  assert.ok(Math.abs(c.rateAt(c.t) - DEFAULT_TIMERATE) < 1e-9);
  const r = (h) => dayClockSchedule({ base: DEFAULT_TIMERATE })(h);
  assert.ok(Math.abs(r(19.6) - 0.6 * DEFAULT_TIMERATE) < 1e-9, 'golden hour: 0.6 x (sun between −6 and +10 deg)');
  assert.ok(Math.abs(r(0.5) - 4 * DEFAULT_TIMERATE) < 1e-9, 'v1\'s deep night: 4 x (Cruise keeps it)');
  const sr = sailSchedule();
  assert.equal(SAIL_CLOCK.nightMult, 1); assert.equal(DAY_CLOCK.nightMult, 4, 'v1\'s table unchanged');
  assert.ok(Math.abs(sr(0.5) - DEFAULT_TIMERATE) < 1e-9, 'Sail\'s deep night: 1 x (owner, 2026-11-15)');
  for (const h of [13, 19.6, 6]) assert.ok(Math.abs(sr(h) - r(h)) < 1e-9, `Sail = v1 by day and at golden hour (${h})`);
  for (let h = 19; h < 30; h += 0.05) assert.ok(sr(h % 24) <= DEFAULT_TIMERATE + 1e-9, `never quicker than the day (${(h % 24).toFixed(2)})`);
});

test('a live page with ?hour runs v1\'s day clock from that hour (#36, owner 2026-11-14: v1 parity)', () => {
  const p = P('?mode=sail&hour=13');
  assert.equal(p.hour, 13); assert.equal(p.clockMode, 'day'); assert.equal(p.timerate, DEFAULT_TIMERATE);
  // v1's own clock on the same URL (src/core/index.js: timeParams, then Sail's schedule unless ?timerate)
  const v1 = sailCoreOptions(parseFlags('mode=sail&hour=13'));
  const t1 = timeParams(parseFlags('mode=sail&hour=13'), { defaultHour: v1.defaultHour, defaultRate: v1.timeRate });
  assert.equal(t1.hour, 13); assert.equal(t1.rate, p.timerate);
  const c = createSimClock({ step: 1 / 120, hour0: p.hour, timerate: p.timerate, schedule: dayClockSchedule({ base: DEFAULT_TIMERATE }), maxSteps: 20 });
  const ref = new TimeOfDay({ hour: 13, rate: DEFAULT_TIMERATE, schedule: daySchedule() });
  for (let i = 0; i < 60 * 30; i++) c.advance(GAME_SPEED / 60);   // 30 real s at Sail's 2 x: 60 sim s
  assert.ok(Math.abs(c.hourUnwrapped - ref.hourAt(c.t)) < 1e-9, 'the same hour as v1\'s TimeOfDay');
  assert.ok(Math.abs((c.hour - 13) * 60 - 10) < 0.01, `13:00 → 13:10 after 30 real s (v1's live page): ${(c.hour * 60 % 60).toFixed(3)} min`);
  assert.equal(c.running, true); assert.equal(c.mode, 'day');
  assert.deepEqual(clockParams(parseV2Flags('?hour=13&clock=flat')), { clockMode: 'rate', timerate: DEFAULT_TIMERATE });
  assert.equal(P('?mode=cruise&hour=17.9').clockMode, 'day', 'Cruise with ?hour: its own day clock from there, as v1');
});

test('fixed time: every capture, ?timerate=0 and a ?filmui=1 film with ?hour keep the hour; only ?timerate or ?filmrate run a capture', () => {
  for (const q of ['?hour=15&filmui=1&wind=2&hud=full', '?hour=15&filmui=1&once=0&seed=1', '?hour=13&headless=1', '?headless=1', '?hour=20&headless=1&timerate=10', '?timerate=0', '?hour=13&timerate=0']) {
    const p = P(q);
    assert.equal(p.clockMode, 'frozen', q); assert.equal(p.timerate, 0, q);
    const c = createSimClock({ hour0: p.hour, timerate: p.timerate, schedule: null });
    for (let i = 0; i < 600; i++) c.advance(1 / 60);
    assert.equal(c.hour, p.hour, `${q}: the hour stands`); assert.equal(c.running, false); assert.equal(c.mode, 'frozen');
  }
  assert.equal(P('?headless=1').hour, 18.75, 'a capture with no ?hour pins v1 Sail\'s start');
  assert.deepEqual(clockParams(parseV2Flags('?headless=1&filmrate=480&hour=19')), { clockMode: 'film', timerate: 480 });
  assert.deepEqual(clockParams(parseV2Flags('?hour=19&timerate=25')), { clockMode: 'rate', timerate: 25 });
  // the same capture twice is the same hours (no wall clock anywhere: renderOnce steps)
  const a = createSimClock({ hour0: 19, timerate: 480 }), b = createSimClock({ hour0: 19, timerate: 480 });
  for (let i = 0; i < 400; i++) { a.step(); b.step(); }
  assert.equal(a.hour, b.hour);
});

test('a cut jumps the hour and keeps the schedule; a pace change and its resume keep the hour continuous', () => {
  const c = live(), seen = [];
  const off = c.onCut((e) => seen.push(e));
  for (let i = 0; i < 600; i++) c.advance(1 / 30);
  const t1 = c.t, h1 = c.hourUnwrapped;
  c.setHour(h1 + 2.5);
  assert.equal(c.cuts, 1); assert.equal(seen.length, 1); assert.ok(Math.abs(seen[0].from - h1) < 1e-12 && seen[0].to === h1 + 2.5 && seen[0].t === t1);
  assert.ok(Math.abs(c.hourUnwrapped - (h1 + 2.5)) < 1e-12);
  assert.equal(c.mode, 'day'); assert.ok(Math.abs(c.rate - sailSchedule()(c.hour)) < 0.05, 'the schedule runs on from the new hour');
  off(); c.setHour(c.hourUnwrapped + 1); assert.equal(seen.length, 1, 'unsubscribed');
  // the evening's pace: a constant rate, then back to the schedule, continuous at both ends
  c.advance(0.05); const h2 = c.hourUnwrapped;
  c.setRate(2); assert.ok(Math.abs(c.hourUnwrapped - h2) < 1e-12); assert.equal(c.rate, 2);
  for (let i = 0; i < 120; i++) c.advance(1 / 60);
  assert.ok(Math.abs(c.hourUnwrapped - (h2 + 2 * 2 / 3600)) < 1e-6, 'two sim seconds at 2 game s per sim s');
  const h3 = c.hourUnwrapped; c.resume(); assert.ok(Math.abs(c.hourUnwrapped - h3) < 1e-12);
  assert.ok(Math.abs(c.rate - sailSchedule()(c.hour)) < 0.05);
  // monotonic across midnight (the wind's day reads unwrapped hours)
  const m = createSimClock({ hour0: 23.9, timerate: 3600 });
  assert.ok(m.hourUnwrappedAt(1) > 24 && m.hourAt(1) < 1);
});

test('the time menu on v2\'s clock: v1\'s rows; a pick is a forward cut to its hour', () => {
  const c = live();
  const dc = createDayClock({ clock: c, speed: 2 });
  assert.deepEqual(dc.menu.rows.map((r) => r.id), TIME_ROWS.map((r) => r.id));
  assert.equal(dc.menu.current(), 'golden', '18:45 is golden hour');
  const h0 = c.hourUnwrapped;
  assert.equal(dc.menu.pick('night'), 'time');
  assert.ok(Math.abs(c.hour - 22.5) < 1e-9 && c.hourUnwrapped > h0, 'Night: 22:30 the same evening');
  assert.equal(dc.menu.current(), 'night');
  dc.menu.pick('dawn');
  assert.ok(Math.abs(c.hour - 5.6) < 1e-9 && c.hourUnwrapped > 24, 'Dawn: forward to the next morning');
  // a frozen page's pick sets the hour and it stays
  const f = createSimClock({ hour0: 12 });
  createDayClock({ clock: f }).menu.pick('golden');
  f.advance(10); assert.equal(f.hour, 19.25);
});

test('the Fireworks row and its pick are there only where the feature is on (the registry, never a device check; owner, 2026-11-19)', () => {
  const ids = (on) => createDayClock({ clock: live(), fireworks: true, on }).menu.rows.map((r) => r.id);
  assert.deepEqual(ids((n) => n === 'fireworks'), TIME_ROWS.map((r) => r.id), 'on: every row, Fireworks last');
  assert.deepEqual(ids(() => false), ['dawn', 'midday', 'golden', 'night'], 'off (a phone): the four hours only');
  const c = live(), h0 = c.hourUnwrapped, dc = createDayClock({ clock: c, fireworks: true, on: () => false });
  assert.equal(dc.menu.pick('fireworks'), null, 'a stale Fireworks pick does nothing on a phone');
  assert.equal(c.hourUnwrapped, h0, 'the clock stays');
  const asked = []; createDayClock({ clock: live(), on: (n) => (asked.push(n), true) });
  assert.deepEqual(asked, ['fireworks'], 'the one question is the fireworks row');
});

test('Sail\'s night: no "The night passes…"; v1\'s night-sky line "The stars come out…" once a night, on v1\'s night-moment rule', () => {
  assert.equal(STARS_LINE, LINES.lapse); assert.equal(STARS_LINE, 'The stars come out\u2026');
  for (const k of ['minLevel', 'waitS', 'maxCoverage']) assert.equal(NIGHT_SKY[k], NIGHT_MOMENT[k], `v1's ${k}`);
  const c = live(), said = [];
  let band = 0, cover = 0.2, sun = 5;
  const dc = createDayClock({ clock: c, say: (t) => said.push(t), stars: () => ({ band, coverage: cover, storm: false, sun }) });
  const run = (s) => { for (let i = 0; i < s * 60; i++) { c.advance(2 / 60); dc.update(1 / 60); } };
  run(2); assert.equal(said.length, 0, 'golden hour: nothing');
  c.setHour(c.hourUnwrapped + (25 - c.hour) + 0.5); sun = -30; band = 0.95;   // 00:30, a dark clear night
  run(5); assert.equal(said.length, 0, 'not before the band has held 6 s');
  run(2); assert.deepEqual(said, [STARS_LINE], 'once');
  run(30); assert.deepEqual(said, [STARS_LINE], 'once a night, never repeated');
  assert.ok(!said.includes(NIGHT_LINE));
  sun = 10; band = 0; run(1); sun = -30; band = 0.9; cover = 0.9; run(10); assert.equal(said.length, 1, 'an overcast night: no line');
  cover = 0.1; run(7); assert.equal(said.length, 2, 'the next clear night: once again');
  // the cue's rule alone: a storm holds it; a moonlit dip under the rearm level does not re-arm while the sun is down
  const q = starsCue(); let fired = 0;
  for (let i = 0; i < 600; i++) fired += q.step(1 / 60, { band: 0.9, coverage: 0, storm: true, sun: -20 }) ? 1 : 0;
  assert.equal(fired, 0, 'no line in a storm');
  for (let i = 0; i < 600; i++) fired += q.step(1 / 60, { band: 0.9, coverage: 0, storm: false, sun: -20 }) ? 1 : 0;
  for (let i = 0; i < 60; i++) fired += q.step(1 / 60, { band: 0.1, sun: -20 }) ? 1 : 0;
  for (let i = 0; i < 600; i++) fired += q.step(1 / 60, { band: 0.9, sun: -20 }) ? 1 : 0;
  assert.equal(fired, 1, 'a full moon\'s dip does not re-arm it');
  const quiet = createDayClock({ clock: c, cue: false, say: (t) => said.push(t), stars: () => ({ band: 1, sun: -30 }) }), n = said.length;
  for (let i = 0; i < 600; i++) quiet.update(1 / 60);
  assert.equal(said.length, n, 'no line under an explicit ?timerate');
});

test('the fireworks are a time event in Sail (owner, 2026-11-15): 21:00-22:15 no rate change, no "night passes", no lines; the show starts at 21:44 on its own clock', () => {
  const c = createSimClock({ hour0: 21, timerate: DEFAULT_TIMERATE, schedule: sailSchedule(), maxSteps: 40 });
  const said = [], marks = [], chart = { setDestination: (d) => marks.push(d) };
  const L = liveShowClock();
  let showT = null, firstShowHour = null, maxShow = -Infinity, realSince = 0;
  const dc = createDayClock({ clock: c, fireworks: true, show: () => showT, say: (t) => said.push(t), chart: () => chart });
  const sched = sailSchedule(), segs0 = c.cuts;
  const rateWas = [];
  // a live Sail page at 60 fps from 21:00 to 22:15 (2 sim s a real s), the show clock as the plug-in runs it
  while (c.hour < 22.25) {
    c.advance(2 / 60);
    showT = L.step({ hour: c.hour, dt: 1 / 60, rate: c.rate * 2, cuts: c.cuts });
    dc.update(1 / 60);
    if (firstShowHour != null) realSince += 1 / 60;
    if (showT != null && showT >= 0 && firstShowHour == null) firstShowHour = c.hour;
    if (showT != null) maxShow = Math.max(maxShow, showT);
    rateWas.push(Math.abs(c.rate - sched(c.hour)));
  }
  assert.ok(Math.max(...rateWas) < 0.05, `the clock runs its own schedule all evening (worst ${Math.max(...rateWas)})`);
  assert.equal(c.cuts, segs0, 'no cut');
  assert.ok(sched(22) <= DEFAULT_TIMERATE + 1e-9, 'no quick night');
  assert.deepEqual(said, [], 'no lines: no "The night passes…", no fireworks hints');
  assert.ok(firstShowHour != null && Math.abs(firstShowHour - SHOW_START) < 0.002, `the show starts at 21:44 (${firstShowHour?.toFixed(4)})`);
  // its own clock: real seconds from 21:44 (the clock's 31 game min to 22:15 at 20 game s a real s: about 93 s of show, not 465)
  assert.ok(maxShow > 80 && Math.abs(maxShow - realSince) < 0.1, `the show ran in real time (${maxShow.toFixed(2)} show s in ${realSince.toFixed(2)} real s)`);
  assert.deepEqual(marks, [], 'no chart destination for the show: no target (owner, 2026-11-18)');
  // the time menu's Fireworks (the sheet's ✳ on the sun strip) with no veil on the page: one cut, at once, to 10 game s before the
  // show; no target and no beacon (owner, 2026-11-18); nothing else (the clock keeps its schedule). The fade: the next tests
  const d = createSimClock({ hour0: 19, timerate: DEFAULT_TIMERATE, schedule: sailSchedule() });
  let st = null; const L2 = liveShowClock(); const marked = [];
  const dc2 = createDayClock({ clock: d, fireworks: true, show: () => st, showMark: (p) => marked.push(p) });   // showMark: the old hook, never called now
  assert.equal(dc2.menu.pick('fireworks'), 'show');
  assert.equal(d.cuts, 1, 'one cut');
  assert.ok(Math.abs(d.hourUnwrapped - (SHOW_START - 10 / 3600)) < 1e-9 && !d.gliding, 'a jump, no glide: 10 game s before the show');
  assert.deepEqual(marked, [], 'no beacon: the pick sets no target (owner, 2026-11-18)');
  assert.equal(DC.SHOW_SITE, undefined, 'no show site to mark');
  assert.equal(DC.FW_GLIDE_S, undefined, 'no glide left');
  // an hour's pick still cuts at once, with no beacon
  const e = createSimClock({ hour0: 12, timerate: DEFAULT_TIMERATE, schedule: sailSchedule() });
  createDayClock({ clock: e, fireworks: true, showMark: (p) => marked.push(p) }).menu.pick('night');
  assert.ok(Math.abs(e.hour - 22.5) < 1e-9 && marked.length === 0, 'Night: a cut, no glide, no beacon');
  for (let i = 0; i < 120; i++) { d.advance(2 / 60); st = L2.step({ hour: d.hour, dt: 1 / 60, rate: d.rate * 2, cuts: d.cuts }); dc2.update(1 / 60); }
  assert.ok(st > 0 && st < 2, `the show running from its start (${st})`);
  assert.equal(dc2.menu.current(), 'fireworks', 'the menu lights Fireworks in the show');
  assert.ok(Math.abs(d.rate - sailSchedule()(d.hour)) < 0.05, 'the day clock\'s own rate in the show');
});

test('the live show clock: real seconds from 21:44 whatever the clock\'s rate; a cut before re-arms it, a cut into the window lands in it, a cut past misses it', () => {
  const L = liveShowClock();
  assert.equal(L.step({ hour: 21, dt: 1 / 60, rate: 20 }), null, '21:00: outside the window');
  let t = L.step({ hour: 21.7, dt: 1 / 60, rate: 20 });
  assert.ok(t < 0 && t > -10, `21:42: a real-s countdown at the clock's pace (${t})`);
  t = L.step({ hour: SHOW_START + 40 / 3600, dt: 1 / 60, rate: 20 });
  assert.ok(Math.abs(t - 2) < 1e-6, `the overshoot in real s (${t})`);
  for (let i = 0; i < 600; i++) t = L.step({ hour: 22 + i / 600, dt: 0.1, rate: 80 });
  assert.ok(Math.abs(t - 62) < 1e-6, `60 real s later at any rate: 62 (${t})`);
  t = L.step({ hour: 23, dt: 1 / 60, rate: 20, cuts: 1 });
  assert.equal(t, null, 'a cut past the window: missed');
  t = L.step({ hour: SHOW_START + 200 * 4 / 3600, dt: 1 / 60, rate: 20, cuts: 5 });
  assert.ok(Math.abs(t - 200) < 1e-6, 'a cut into the window: v1\'s show time for the hour');
  t = L.step({ hour: 21.73, dt: 1 / 60, rate: 20, cuts: 2 });
  assert.ok(t < 0, 'a cut before it: the countdown again');
  // a page opened in the show: v1's show time for its hour
  assert.ok(Math.abs(liveShowClock().step({ hour: SHOW_START + 100 * 4 / 3600, dt: 0, rate: 20 }) - 100) < 1e-6);
  // over after its length and the smoke's 120 s
  const M = liveShowClock(); M.step({ hour: 21.7, rate: 20 }); M.step({ hour: SHOW_START, rate: 20 });
  let last = 0; for (let i = 0; i < (SHOW_LENGTH + 121) * 10; i++) last = M.step({ hour: 22 + i * 1e-4, dt: 0.1, rate: 20 });
  assert.equal(last, null);
});

test('Sail\'s night wind holds the chosen level (owner, 2026-11-15): never under the band\'s bottom 21:00-06:00; v1\'s field still goes calm', () => {
  const KT = 0.514444;
  for (const level of [1, 3]) {
    const mk = (hold) => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({ wind: String(level) }, { hour: 18.75, rate: 0 }) }); w.nightHold = hold; return w; };
    const held = mk(true), v1 = mk(false);
    const bottom = [4, 8, 13, 18][level - 1];
    let worst = Infinity, v1Worst = Infinity, lastDir = null, worstVeer = 0;
    for (let h = 21; h < 30; h += 1 / 120) {
      const d = held.dayAt(h % 24), kn = d.speedMs * held.lv.scale0 / KT;
      worst = Math.min(worst, kn); v1Worst = Math.min(v1Worst, v1.dayAt(h % 24).speedMs * v1.lv.scale0 / KT);
      if (lastDir != null) worstVeer = Math.max(worstVeer, Math.abs(((d.dirDeg - lastDir + 540) % 360) - 180));
      lastDir = d.dirDeg;
    }
    assert.ok(worst >= bottom, `level ${level}: the night's base at least ${bottom} kn (${worst.toFixed(2)})`);
    assert.ok(v1Worst < 2, `v1's field: the calm night drainage (${v1Worst.toFixed(2)} kn)`);
    assert.ok(worstVeer < 6, `no flip: the dawn veer at most ${worstVeer.toFixed(2)} deg in 30 game s`);
    for (const h of [13, 16, 19, 20.5, 6.5, 9]) assert.deepEqual(held.dayAt(h), v1.dayAt(h), `by day the same wind as v1 (${h})`);
  }
});

test('the VHF\'s forecast reads the running clock (ui/captain.js forecastWind): the wind\'s day on the clock, no 1 h / h stand-in', async () => {
  const { forecastWind } = await import('../ui/captain.js');
  const { WindField } = await import('../../src/sim/wind.js');
  const { sailWindOptions } = await import('../sim/wind.js');
  const c = live();
  const w = new WindField({ seed: 1, ...sailWindOptions({}, { hour: c.hour, rate: DEFAULT_TIMERATE }) });
  w.setClock((tt) => c.hourUnwrappedAt(tt));   // main.js on a running clock
  assert.equal(forecastWind(w, 0), w, 'the field itself: its hours are the clock\'s');
  assert.ok(Math.abs(w.hourAt(600) - c.hourUnwrappedAt(600)) < 1e-12);
  // a frozen page: the stand-in 1 h / h clock, as before
  const f = new WindField({ seed: 1, ...sailWindOptions({}, { hour: 15, rate: 0 }) });
  const fw = forecastWind(f, 0);
  assert.notEqual(fw, f); assert.ok(Math.abs(fw.hourAt(3600) - 16) < 1e-9);
});

// a live page's frame at 60 fps in Sail (main.js: the clock advances, the UI steps the fade, then the frame draws the sky and the
// show at the clock's hour) and a fake veil: the opacity a CSS transition would show, linear from where it was
function livePage({ hour0 = 23, reduced = false } = {}) {
  const d = createSimClock({ hour0, timerate: DEFAULT_TIMERATE, schedule: sailSchedule() });
  const L = liveShowClock(); let st = null, realT = 0;
  const v = { from: 0, to: 0, at: 0, secs: 0, calls: [] };
  const opacity = (t = realT) => { const u = v.secs > 0 ? Math.min(1, (t - v.at) / v.secs) : 1; return v.from + (v.to - v.from) * u; };
  const veil = (op, secs) => { v.from = opacity(); v.to = op; v.at = realT; v.secs = secs; v.calls.push({ op, secs, at: realT }); };
  const dc = createDayClock({ clock: d, fireworks: true, show: () => st, veil, reduced: () => reduced });
  const frame = () => {
    realT += 1 / 60; d.advance(2 / 60); dc.step(1 / 60);
    st = L.step({ hour: d.hour, dt: 1 / 60, rate: d.rate * 2, cuts: d.cuts, gliding: d.gliding });
    return { t: realT, hour: d.hour, un: d.hourUnwrapped, cuts: d.cuts, op: opacity(), show: st };
  };
  return { d, dc, frame, v, opacity, get st() { return st; } };
}

test('a time pick jumps under a short fade (owner, 2026-11-18): Fireworks at 23:00 never samples an hour in between, no daylight, one cut under full dark', () => {
  const p = livePage({ hour0: 23 });
  for (let i = 0; i < 30; i++) p.frame();
  const h0 = p.d.hourUnwrapped, cuts0 = p.d.cuts;
  assert.equal(p.dc.menu.pick('fireworks'), 'show');
  assert.equal(p.d.cuts, cuts0, 'no cut yet: the veil goes dark first');
  assert.ok(p.dc.switching);
  assert.deepEqual(p.v.calls, [{ op: 1, secs: FADE.outS, at: p.v.calls[0].at }], 'the veil to dark over the fade-out');
  assert.ok(FADE.outS >= 0.3 && FADE.outS <= 0.4 && FADE.inS >= 0.4 && FADE.inS <= 0.5, `a short fade (${FADE.outS} s out, ${FADE.inS} s in)`);
  const rows = [];
  for (let i = 0; i < 120; i++) rows.push(p.frame());
  assert.equal(p.dc.switching, false, 'over within 2 real s');
  const target = 24 + SHOW_START - 10 / 3600;   // the next 21:43:50, the next evening (the clock started at 23:00 on day 0)
  const cutRow = rows.findIndex((r) => r.cuts !== cuts0);
  assert.ok(cutRow > 0 && p.d.cuts === cuts0 + 1, 'one cut');
  const cut = rows[cutRow];
  assert.ok(cut.t - p.v.calls[0].at >= FADE.outS - 1e-9 && cut.op > 0.999, `the cut lands under full dark (${(cut.t - p.v.calls[0].at).toFixed(3)} s after the veil, opacity ${cut.op.toFixed(3)})`);
  assert.ok(Math.abs(cut.un - target) < 0.001, `straight to the next occurrence (${cut.un.toFixed(4)} vs ${target.toFixed(4)})`);
  // every hour the sky drew: near 23:00 before the cut, near 21:44 after it, nothing in between (no daylight)
  for (const r of rows) {
    assert.ok(r.un < h0 + 0.01 || (r.un >= target - 1e-9 && r.un < target + 0.01), `no hour in between (${r.un.toFixed(4)})`);
    assert.ok(elev(r.hour) < -4, `no daylight drawn (${r.hour.toFixed(3)}, sun ${elev(r.hour).toFixed(1)} deg)`);
  }
  // the veil lifts after one frame drawn dark on the new hour, over the fade-in, and ends clear
  const up = p.v.calls[1];
  assert.ok(up && up.op === 0 && up.secs === FADE.inS && up.at > cut.t, `the veil up after the cut's frame (${JSON.stringify(up)})`);
  assert.equal(p.v.calls.length, 2); assert.equal(p.opacity(), 0, 'clear at the end');
  // the show starts clean: counting down from 10 s before the first shell where the cut landed, then running from its start
  assert.ok(cut.show != null && cut.show < 0 && cut.show > -10, `the show counts down from the cut (${cut.show})`);
  const after = rows.slice(cutRow).map((r) => r.show);
  for (let i = 0; i < 1200 && !(after.at(-1) >= 0); i++) after.push(p.frame().show);
  const first = after.find((s) => s != null && s >= 0);
  assert.ok(after.slice(0, after.indexOf(first)).every((s) => s != null && s < 0), 'a steady countdown to the first shell');
  assert.ok(first >= 0 && first < 0.05, `the show from its start (${first})`);
  // the unwrapped clock stays forward-only and on its schedule
  assert.ok(Math.abs(p.d.rate - sailSchedule()(p.d.hour)) < 0.05, 'the day clock\'s own rate after the jump');
});

test('the fade: an hour pick too; a second pick in the fade-out takes the new target in the same dark; reduced motion cuts at once', () => {
  const p = livePage({ hour0: 13 });
  p.frame();
  p.dc.menu.pick('night'); p.frame();
  p.dc.menu.pick('golden');   // changed mind while it goes dark
  const rows = []; for (let i = 0; i < 90; i++) rows.push(p.frame());
  assert.equal(p.d.cuts, 1, 'one cut');
  assert.ok(Math.abs(p.d.hour - 19.25) < 0.02, `Golden hour, not Night (${p.d.hour.toFixed(3)})`);
  assert.equal(p.v.calls.length, 2, 'one fade out, one fade in');
  assert.ok(rows.every((r) => r.hour < 13.05 || (r.hour >= 19.25 && r.hour < 19.3)), 'no hour in between');
  // reduced motion: no veil, the cut at once
  const q = livePage({ hour0: 23, reduced: true });
  q.frame(); q.dc.menu.pick('fireworks');
  assert.equal(q.d.cuts, 1); assert.equal(q.v.calls.length, 0, 'no fade');
  assert.ok(Math.abs(q.d.hour - (SHOW_START - 10 / 3600)) < 1e-9 && !q.dc.switching, 'an instant cut');
  // a pick a few game s before its hour: the cut never steps the clock back
  const r = livePage({ hour0: 22.5 - 3 / 3600 });
  r.dc.menu.pick('night');
  let last = -Infinity; for (let i = 0; i < 90; i++) { const f = r.frame(); assert.ok(f.un >= last, 'never back'); last = f.un; }
});

test('Fireworks picked again in the show (fix 2026-11-18): the show runs on under the fade-out, cleared at the cut, then from 10 s before it; Golden hour clears it at its cut', () => {
  const p = livePage({ hour0: 19 });
  p.dc.menu.pick('fireworks');
  for (let i = 0; i < 2400 && !(p.st > 20); i++) p.frame();
  assert.ok(p.st > 20, `the show running (${p.st})`);
  const cuts0 = p.d.cuts;
  p.dc.menu.pick('fireworks');
  let f; do f = p.frame(); while (f.cuts === cuts0);
  assert.ok(f.op > 0.999 && f.show != null && f.show < 0, `at the cut, under the dark: the show back to its countdown (${f.show})`);
  for (let i = 0; i < 1200 && !(p.st > 0); i++) p.frame();
  assert.ok(p.st > 0 && p.st < 0.05, `the show again from its start (${p.st})`);
  // Golden hour in the show: the show clock off at the cut
  const c1 = p.d.cuts;
  p.dc.menu.pick('golden');
  do f = p.frame(); while (f.cuts === c1);
  assert.equal(f.show, null, 'Golden hour: no show from the cut on');
});

test('the boat\'s radio row (the fireworks evening) shows only where the Fireworks feature is on (owner, 2026-11-19)', async () => {
  const { FEATURE_SETUP } = await import('../../src/features/setup.js');
  const flags = parseFlags('');
  assert.equal(FEATURE_SETUP.fireworks.shown(flags, () => true), true, 'on: the row');
  assert.equal(FEATURE_SETUP.fireworks.shown(flags, () => false), false, 'off (a phone): no row');
  assert.equal(FEATURE_SETUP.fireworks.shown(parseFlags('fireworks=0'), () => true), false, '?fireworks=0: no row, as before');
});
