// The day clock (src/timeOfDay.js dayClockSchedule): the rate follows the sun's elevation. Table:.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeOfDay, RateTable, DAY_CLOCK, dayClockMult, dayClockSchedule, clockIsFlat, SpeedCue, timeParams, analyticSun, DEFAULT_TIMERATE } from '../src/sim/timeOfDay.js';
import { chillClock, chillSchedule, CHILL } from '../src/sim/modes/chill/params.js';
import { daySchedule } from '../classic/src/modes/daysail/index.js';
import { parseFlags } from '../src/sim/core/flags.js';

const BASE = 20;   // game s per real s: Sail 10 per sim s at 2x, Cruise 20 per sim s at 1x
const elev = (h) => { const s = analyticSun(h); return Math.asin(s.y / Math.hypot(s.x, s.y, s.z)) * 180 / Math.PI; };

test('the multiplier is continuous, flat at the knots and has the table values', () => {
  let prev = dayClockMult(-90), maxStep = 0;
  for (let e = -90; e <= 90; e += 0.01) { const m = dayClockMult(e); maxStep = Math.max(maxStep, Math.abs(Math.log(m / prev))); prev = m; }
  assert.ok(maxStep < 0.02, `largest log step per 0.01 deg ${maxStep}`);
  assert.equal(dayClockMult(-30), DAY_CLOCK.nightMult);
  assert.equal(dayClockMult(-12), 4);
  assert.ok(Math.abs(dayClockMult(-6) - 0.6) < 1e-12);
  assert.equal(dayClockMult(0), 0.6);
  assert.equal(dayClockMult(10), 0.6);
  assert.equal(dayClockMult(25), 1);
  assert.equal(dayClockMult(70), 1);
  // monotonic on each side of the golden plateau
  for (let e = -12; e < -6; e += 0.1) assert.ok(dayClockMult(e + 0.1) <= dayClockMult(e) + 1e-12);
  for (let e = 10; e < 25; e += 0.1) assert.ok(dayClockMult(e + 0.1) >= dayClockMult(e) - 1e-12);
});

test('night is >= 3x faster than the day, golden hour >= 1.5x slower than midday', () => {
  const night = dayClockMult(-20), noon = dayClockMult(elev(13)), golden = dayClockMult(elev(19.5));
  assert.ok(night / noon >= 3, `night ${night} vs noon ${noon}`);
  assert.ok(noon / golden >= 1.5, `golden ${golden} vs noon ${noon}`);
  const r = dayClockSchedule({ base: BASE });
  assert.ok(r(1) / r(13) >= 3 && r(13) / r(19.5) >= 1.5);
});

test('a full simulated day: the real duration matches the table (64.6 min at 20 game s per real s; 64.9 on the normal day)', () => {
  const T = new RateTable(dayClockSchedule({ base: BASE }));   // sim s at base 20 game s per sim s
  const dayMin = T.dayS / 60;
  assert.ok(Math.abs(dayMin - 64.6) < 0.1, `day ${dayMin} min (the highlight day, 2026-07-04)`);
  const june = new RateTable(dayClockSchedule({ base: BASE, sunAt: (h) => analyticSun(h, { date: '2026-06-15' }) })).dayS / 60;
  assert.ok(Math.abs(june - 64.9) < 0.1, `day ${june} min (the normal day, 2026-06-15)`);
  // per phase from the table: integrate by sun elevation
  const ph = [0, 0, 0, 0, 0], dh = 1 / 1800;
  for (let h = 0; h < 24; h += dh) {
    const e = elev(h + dh / 2), k = e <= -12 ? 0 : e < -6 ? 1 : e <= 10 ? 2 : e < 25 ? 3 : 4;
    ph[k] += dh * 3600 / (BASE * dayClockMult(e)) / 60;
  }
  const exp = [5.09, 3.12, 15.64, 10.55, 30.22];   // the highlight day (the normal day: 5.02, 3.16, 15.74, 10.59, 30.37)
  ph.forEach((m, i) => assert.ok(Math.abs(m - exp[i]) < 0.05, `phase ${i}: ${m} vs ${exp[i]} min`));
  // deep night in about 5 min (owner, 2026-11-09: long enough for the Milky Way; was 45 s)
  assert.ok(ph[0] * 60 > 290 && ph[0] * 60 < 320, `deep night ${ph[0] * 60} s`);
  // step the clock itself through a day at 60 fps
  const c = new TimeOfDay({ hour: 0, schedule: dayClockSchedule({ base: BASE }) });
  let t = 0, maxLogStep = 0, prev = c.rateAt(0);
  while (c.hourAt(t) < 24) { t += 1 / 60; const r = c.rateAt(t); maxLogStep = Math.max(maxLogStep, Math.abs(Math.log(r / prev))); prev = r; }
  assert.ok(Math.abs(t / 60 - dayMin) < 0.05, `stepped day ${t / 60} min vs ${dayMin}`);
  assert.ok(maxLogStep < 0.02, `rate step per frame ${maxLogStep}`);
});

test('Sail and Cruise share the table; the sun moves at most 0.05 deg per frame; wind and light read the same clock', () => {
  const sail = new TimeOfDay({ hour: 18.75, schedule: daySchedule() }), cruise = new TimeOfDay({ hour: 18.75, schedule: chillClock({ get: () => null }) });
  // Sail steps sim time at 2x: 20 game s per real s, same as Cruise's 1x at base 20
  for (let real = 0; real < 3000; real += 7) near(sail.hourAt(real * 2), cruise.hourAt(real), 1e-6);
  let prevE = null, maxDe = 0, t = 0;
  while (cruise.hourAt(t) < 24 + 8) { const f = cruise.tick(t); if (prevE !== null) maxDe = Math.max(maxDe, Math.abs(f.elevDeg - prevE)); prevE = f.elevDeg; t += 1 / 60; }
  assert.ok(maxDe < 0.05, `sun step ${maxDe} deg per frame`);
  assert.ok(t / 60 < 40, `evening 18:45 to 08:00 next day in ${t / 60} min`);
});

test('?hour pins time: headless and ?timerate are untouched, ?clock=flat gives today\'s clocks', () => {
  const P = (q) => parseFlags(q), SAIL_T = { defaultHour: '18.75', defaultRate: DEFAULT_TIMERATE };   // Sail's coreOptions (src/sail/options.js)
  assert.deepEqual(timeParams(P('mode=sail&hour=6.5&headless=1'), SAIL_T), { hour: 6.5, rate: 0 });
  assert.deepEqual(timeParams(P('mode=sail&hour=6.5&headless=1&clock=flat'), SAIL_T), { hour: 6.5, rate: 0 });
  assert.deepEqual(timeParams(P('mode=sail&hour=18'), SAIL_T), { hour: 18, rate: DEFAULT_TIMERATE });
  assert.equal(clockIsFlat(P('clock=flat')), true);
  assert.equal(clockIsFlat(P('')), false);
  // flat Cruise is the old quick night, exactly
  const a = chillClock(P('clock=flat')), b = chillSchedule();
  for (const h of [0, 5, 6.2, 12, 19, 21, 23]) assert.equal(a(h), b(h));
  // a schedule is never asked while the clock is frozen: rate 0 -> a constant clock, the hour does not move
  const frozen = new TimeOfDay({ hour: 21, rate: 0 });
  assert.equal(frozen.hourAt(1000), 21);
});

test('the Dawn button (wait for sunrise): setHour keeps the day clock running from the dawn', () => {
  const c = new TimeOfDay({ hour: 23, schedule: dayClockSchedule({ base: BASE }) });
  const rNight = c.rateAt(0);
  c.setHour(4, 10);
  assert.ok(Math.abs(c.hourAt(10) - 4) < 1e-9);
  assert.ok(c.hourAt(60) > 4);
  assert.ok(rNight > 0);
  // at dawn the sun is under -12 until ~04:25, then the rate falls to the golden pace
  assert.ok(c.rateAt(10) >= BASE * 3.5, 'still the night rate at 04:00');
  const t6 = c.seg.at(-1).table.simAt(6.5) - c.seg.at(-1).table.simAt(4) + 10;
  assert.ok(c.rateAt(t6) <= BASE * 0.7, `golden pace at 06:30 (${c.rateAt(t6)})`);
});

test('the speeding cue has a gap: on at >= 4x, off below 2.5x', () => {
  const q = new SpeedCue();
  assert.equal(q.step(1), null);
  assert.equal(q.step(3.9), null);
  assert.equal(q.step(4), 'on');
  assert.equal(q.step(3), null);
  assert.equal(q.step(2.6), null);
  assert.equal(q.step(2.4), 'off');
  assert.equal(q.step(3), null);
});

function near(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`); }

// ---- owner, 2026-11-09: the Night pick gives several real minutes of full dark; the show runs at real speed ----
const darkRealS = ({ base, timeScale }) => {   // real s from 22:30 (the Night pick) until the sun is back over -12 deg
  const c = new TimeOfDay({ hour: 22.5, schedule: dayClockSchedule({ base }) });
  let t = 0;
  while (elev(c.hourOfDay(t)) < -12 && t < 3600) t += 0.25;
  return t / timeScale;
};
test('Night pick: at least 4 real minutes of full dark before dawn\'s light starts, in Sail (base 10 per sim s, 2x) and Cruise (20 per sim s, 1x)', () => {
  const sail = darkRealS({ base: DEFAULT_TIMERATE, timeScale: 2 }), cruise = darkRealS({ base: 20, timeScale: 1 });
  assert.ok(sail >= 240, `Sail ${sail} s`); assert.ok(cruise >= 240, `Cruise ${cruise} s`);
  assert.ok(Math.abs(sail - cruise) < 1, 'the same real time in both');
});

test('the show runs at real speed in Sail (2x scene) and Cruise (1x): 300 show s take 300 real s; the lapse keeps its pace', async () => {
  const { perScene, EVENING } = await import('../src/fireworks/evening.js');
  const { SHOW_START_HOUR, SHOW_LENGTH } = await import('../src/fireworks/show.js');
  for (const timeScale of [2, 1]) {
    const c = new TimeOfDay({ hour: SHOW_START_HOUR, rate: perScene(EVENING.showRate, timeScale) });
    const realS = SHOW_LENGTH;                          // the show's own length, s
    const hour = c.hourAt(realS * timeScale);           // the scene clock runs timeScale scene s per real s
    const showS = (hour - SHOW_START_HOUR) * 3600 / EVENING.showRate;   // world.js showTimeAt: show s = game s / 4
    assert.ok(Math.abs(showS - realS) < 1e-6, `timeScale ${timeScale}: ${showS} show s in ${realS} real s`);
  }
});
