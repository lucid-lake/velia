// The time-of-day clock's contract (src/timeOfDay.js, D2). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getSunDirectionECEF } from '@takram/three-atmosphere';
import { Ellipsoid, Geodetic, radians } from '@takram/three-geospatial';
import { PLACE, timeAt, makePlace } from '../src/sim/place.js';
import { TimeOfDay, timeParams, analyticSun, solarDeclEqTime, SAIL_HOUR, FLY_HOUR, exposureAt, lightAt, DEFAULT_TIMERATE, EXPOSURE_KNEE_DEG, nightSchedule, RateTable } from '../src/sim/timeOfDay.js';
import { WindField } from '../src/sim/wind.js';
import { mixAt, LEVEL } from '../src/audio.js';
import { CHILL, chillSchedule } from '../src/sim/modes/chill/params.js';
import { parseFlags } from '../src/sim/core/flags.js';
import { pickDay } from '../src/sim/day.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';

const P = (q) => parseFlags(q);
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

test('the rate: 1 game hour per 360 s of sim time by default (3 real minutes at the default 2× game speed)', () => {
  const c = new TimeOfDay({ hour: 17 });
  assert.equal(c.rate, DEFAULT_TIMERATE);
  near(c.hourAt(360), 18, 1e-12, 'one hour later');
  near(c.hourAt(360 * 3.8), 20.8, 1e-12, 'dusk');
  const fast = new TimeOfDay({ hour: 6, rate: 3600 });   // 1 game hour per sim second
  near(fast.hourAt(2.5), 8.5, 1e-12, 'rate 3600');
});

test('monotonic: the unwrapped hour never goes back, across rate changes and a freeze', () => {
  const c = new TimeOfDay({ hour: 19, rate: 10 });
  let prev = -Infinity;
  for (let i = 0; i <= 6000; i++) {
    const t = i * 0.25;
    if (i === 1000) c.setRate(0, t);        // frozen for a while
    if (i === 2000) c.setRate(40, t);       // then 4× the default
    if (i === 3000) c.setRate(2.5, t);
    const f = c.tick(t);
    assert.ok(f.hourUnwrapped >= prev, `step ${i}: ${f.hourUnwrapped} < ${prev}`);
    prev = f.hourUnwrapped;
  }
  // a rate change keeps the hour continuous
  const d = new TimeOfDay({ hour: 10, rate: 10 });
  const before = d.hourAt(100);
  d.setRate(50, 100);
  near(d.hourAt(100), before, 1e-12, 'continuous at the change');
  near(d.hourAt(172), before + 72 * 50 / 3600, 1e-12, 'new rate after it');
  // and old times still answer with the old rate (the wind's advection history asks for them)
  near(d.hourAt(50), 10 + 50 * 10 / 3600, 1e-12, 'history');
});

test('deterministic: the same hour and rate give the same frames, whatever the frame steps', () => {
  const a = new TimeOfDay({ hour: 17.5, rate: 10 }), b = new TimeOfDay({ hour: 17.5, rate: 10 });
  let fa = null;
  for (let i = 0; i <= 600; i++) fa = a.tick(i / 60);          // 60 fps
  for (let i = 0; i <= 200; i++) b.tick(i / 20);               // 20 fps, same end time (10 s)
  const fb = b.tick(10);
  assert.equal(fa.hour, fb.hour);
  assert.deepEqual(fa.sun, fb.sun);
  assert.equal(fa.exposure, fb.exposure);
  assert.equal(fa.light, fb.light);
});

test('wrap-around at 24 h: the hour of day wraps, the unwrapped hour does not', () => {
  const c = new TimeOfDay({ hour: 23.5, rate: 3600 });   // 1 h per sim second
  const f = c.tick(1);
  near(f.hour, 0.5, 1e-9, 'hour of day');
  near(f.hourUnwrapped, 24.5, 1e-9, 'unwrapped');
  near(c.hourOfDay(25), 0.5, 1e-9, 'a whole day later');
  // the sun a day later is the same sun
  const s1 = c.tick(25).sun, s0 = analyticSun(0.5);
  for (const k of ['x', 'y', 'z']) near(s1[k], s0[k], 1e-9, `sun.${k}`);
});

test('frozen in headless unless ?timerate is given; ?timerate=0 freezes the live game', () => {
  const SAIL_T = { defaultHour: SAIL_HOUR, defaultRate: DEFAULT_TIMERATE };   // Sail's coreOptions (src/sail/options.js); fly gives none
  assert.deepEqual(timeParams(P('mode=sail&hour=18&headless=1'), SAIL_T), { hour: 18, rate: 0 });
  assert.deepEqual(timeParams(P('mode=sail&headless=1'), SAIL_T), { hour: 18.75, rate: 0 });   // the defaults: 18:45 and 06:30 PDT
  assert.deepEqual(timeParams(P('cam=A&headless=1')), { hour: 6.5, rate: 0 });
  assert.equal(SAIL_HOUR, '18.75'); assert.equal(FLY_HOUR, '6.5');
  assert.deepEqual(timeParams(P('hour=6.5&cam=A&headless=1')), { hour: 6.5, rate: 0 });
  assert.deepEqual(timeParams(P('mode=sail&hour=18&headless=1&timerate=10'), SAIL_T), { hour: 18, rate: 10 });
  assert.deepEqual(timeParams(P('mode=sail&hour=18'), SAIL_T), { hour: 18, rate: DEFAULT_TIMERATE });
  assert.deepEqual(timeParams(P('mode=sail&hour=18&timerate=0'), SAIL_T), { hour: 18, rate: 0 });
  assert.deepEqual(timeParams(P('hour=12')), { hour: 12, rate: 0 });   // fly mode: the light stays unless asked
  assert.deepEqual(timeParams(P('mode=sail&hour=30'), SAIL_T), { hour: 24, rate: DEFAULT_TIMERATE });   // clamped as main.js does
  // a frozen clock gives the start hour forever
  const c = new TimeOfDay({ hour: 18, rate: 0 });
  for (const t of [0, 1, 60, 3600, 1e6]) assert.equal(c.tick(t).hour, 18);
});

test('the probe is due when the sun has moved probeDeg, not before; a jump recaptures at once, the start does not', () => {
  const c = new TimeOfDay({ hour: 18, rate: 10, probeDeg: 1 });
  assert.equal(c.tick(0).probe, false);   // the start: main.js captured the probe at load
  let due = [];
  for (let i = 1; i <= 3600; i++) if (c.tick(i / 10).probe) due.push(i / 10);   // 6 min of sim time = 1 game hour
  // the sun moves ≈ 11–12° per hour at 18:00 PDT at Tahoe: about 11–12 recaptures, evenly spaced
  assert.ok(due.length >= 10 && due.length <= 16, `${due.length} recaptures in a game hour`);
  const gaps = due.slice(1).map((t, i) => t - due[i]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 6, `gaps ${Math.min(...gaps)}–${Math.max(...gaps)} s`);
  c.setHour(6, 400);
  const j = c.tick(400);
  assert.equal(j.probe, true); assert.equal(j.cut, true);
  assert.equal(c.tick(400.1).cut, false);
});

test('exposure: today\'s 6 at the hand-tuned hours (dawn +9.0°, sail +17.2°) and by day; rising smoothly at dusk', () => {
  for (const e of [8.98, 17.22, 30, 66]) assert.equal(exposureAt(e, 6), 6, `at ${e}°`);
  assert.equal(exposureAt(17.22, 4), 4, '?exposure scales it');
  let prev = 6;
  for (let e = EXPOSURE_KNEE_DEG; e >= -14; e -= 0.25) {
    const x = exposureAt(e, 6);
    assert.ok(x >= prev - 1e-9, `non-decreasing toward night at ${e}°`);
    assert.ok(x / prev < 1.25, `no step over 25 % per 0.25° at ${e}° (${prev} → ${x})`);
    prev = x;
  }
  assert.ok(exposureAt(-7, 6) > 6 * 4, 'civil dusk gets real gain');
  assert.equal(lightAt(17.22), 1); assert.equal(lightAt(60), 1);
  assert.ok(lightAt(-7) < 0.1 && lightAt(-7) > 0);
});

test('the normal day (?day=normal, 2026-06-15, PDT): the NOAA / USNO sun at 06:30, 13:00, 18:45, 20:00, 20:30', () => {
  const N = { date: '2026-06-15' };
  const el = (h) => Math.asin(analyticSun(h, N).y) * 180 / Math.PI;
  const az = (h) => { const s = analyticSun(h, N); return ((Math.atan2(s.x, -s.z) * 180 / Math.PI) + 360) % 360; };
  // USNO Astronomical Applications API (celnav, the computed altitude Hc and azimuth Zn, no refraction), at
  // 38.954159 N 120.100464 W; NOAA's solar equations agree to 0.01°
  for (const [h, e, a] of [[6.5, 8.79, 67.04], [13, 74.38, 179.16], [18.75, 17.40, 286.30], [20, 3.87, 297.13], [20.5, -1.21, 301.78]]) {
    near(el(h), e, 0.1, `elevation at ${h} h`);
    near(az(h), a, 0.3, `azimuth at ${h} h`);
  }
  // solar noon 13:01 PDT (USNO upper transit), the highest sun 74.4°
  let best = 0;
  for (let h = 12.5; h <= 13.5; h += 1 / 600) if (el(h) > el(best || 12.5)) best = h;
  near(best, 13.017, 0.02, 'solar noon');
  // sunset 20:28 and the end of civil twilight 21:00 PDT (USNO: the upper limb at −0.833°, the centre at −6°)
  const cross = (deg, a, b) => { for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (el(m) > deg) a = m; else b = m; } return a; };
  near(cross(-0.833, 19, 21), 20 + 28 / 60, 1.5 / 60, 'sunset');
  near(cross(-6, 20, 22), 21, 1.5 / 60, 'civil dusk');
  assert.ok(analyticSun(18, N).x < 0, 'west in the evening');
});

test('the map\'s two days: highlight (default) 2026-07-04, normal 2026-06-15; ?day=YYYY-MM-DD any date', () => {
  const H = pickDay(CURRENT_WATERS), N = pickDay(CURRENT_WATERS, 'normal');
  assert.equal(H.key, 'highlight'); assert.equal(H.date, '2026-07-04'); assert.equal(PLACE.date, '2026-07-04');
  assert.equal(N.date, '2026-06-15'); assert.equal(H.utcOffsetH, -7); assert.equal(N.utcOffsetH, -7);
  assert.deepEqual(pickDay(CURRENT_WATERS, 'highlight'), H);
  assert.deepEqual(pickDay(CURRENT_WATERS, 'nonsense'), H, 'an unknown value is the highlight day');
  assert.deepEqual(pickDay(CURRENT_WATERS, '2026-02-30'), H, 'an impossible date is the highlight day');
  const x = pickDay(CURRENT_WATERS, '2026-06-01');
  assert.equal(x.date, '2026-06-01'); assert.deepEqual(x.season, N.season, 'a date takes the nearer named day\'s season');
  assert.deepEqual(pickDay(CURRENT_WATERS, '2026-07-20').season, H.season);
  // the normal day's place is the old one: 2026-06-15 at PDT, so timeAt gives the old instants
  const P0 = makePlace(CURRENT_WATERS, N);
  assert.equal(timeAt(18.75, P0), Date.parse('2026-06-15T18:45:00-07:00'));
  assert.equal(timeAt(18.75), Date.parse('2026-07-04T18:45:00-07:00'));
});

test('the declination and equation of time are computed (NOAA solar equations) and match NOAA for both days', () => {
  // NOAA Solar Calculator equations at 19:00 UTC (https://gml.noaa.gov/grad/solcalc/calcdetails.html): 2026-06-15
  // +23.33°, −0.6 min (the constants src/timeOfDay.js used to type in); 2026-07-04 +22.82°, −4.5 min
  for (const [iso, d, e] of [['2026-06-15T19:00:00Z', 23.33, -0.6], ['2026-07-04T19:00:00Z', 22.82, -4.5], ['2026-12-21T20:00:00Z', -23.44, 1.9], ['2026-03-20T19:00:00Z', 0.07, -7.4]]) {
    const s = solarDeclEqTime(Date.parse(iso));
    near(s.declDeg, d, 0.03, `declination ${iso}`);
    near(s.eqTimeMin, e, 0.15, `equation of time ${iso}`);
  }
  // ?day=normal reproduces the old June sun: within 0.04° of the typed-in constants (+23.33°, −0.62 min) all day
  let worst = 0;
  for (let h = 0; h < 24; h += 0.25) {
    const a = analyticSun(h, { date: '2026-06-15' }), b = analyticSun(h, { declDeg: 23.33, eqTimeMin: -0.62 });
    worst = Math.max(worst, Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)) * 180 / Math.PI);
  }
  assert.ok(worst < 0.04, `June vs the old constants: worst ${worst}°`);
});

test('the highlight day (2026-07-04, PDT): sunrise, solar noon, sunset and civil dusk match the USNO almanac within 2 min', () => {
  // USNO Astronomical Applications, one-day data, 38.954159 N 120.100464 W, UTC−7 (read 2026-11-07,
  // https://aa.usno.navy.mil/api/rstt/oneday?date=2026-07-04&coords=38.954159,-120.100464&tz=-7&dst=false):
  // civil dawn 05:08, sunrise 05:40, upper transit 13:05, sunset 20:29, end of civil twilight 21:01
  const el = (h) => Math.asin(analyticSun(h).y) * 180 / Math.PI;
  const down = (deg, a, b) => { for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (el(m) > deg) a = m; else b = m; } return a; };
  const up = (deg, a, b) => { for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (el(m) < deg) a = m; else b = m; } return a; };
  const hm = (h, m) => h + m / 60;
  near(down(-0.833, 19, 22), hm(20, 29), 2 / 60, 'sunset');
  near(down(-6, 20, 23), hm(21, 1), 2 / 60, 'civil dusk');
  near(up(-0.833, 4, 7), hm(5, 40), 2 / 60, 'sunrise');
  near(up(-6, 4, 7), hm(5, 8), 2 / 60, 'civil dawn');
  let best = 12.5;
  for (let h = 12.5; h <= 13.6; h += 1 / 600) if (el(h) > el(best)) best = h;
  near(best, hm(13, 5), 2 / 60, 'solar noon');
});

test('the analytic sun agrees with the sky model (astronomy-engine, as src/core/sky.js places it) within 0.5° all day', () => {
  const origin = new Geodetic(radians(PLACE.lonDeg), radians(PLACE.latDeg), PLACE.altM).toECEF();
  const swap = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  const toWorld = Ellipsoid.WGS84.getEastNorthUpFrame(origin).multiply(swap).invert().setPosition(0, 0, 0);
  let worst = 0;
  for (let h = 0; h < 24; h += 0.25) {
    const v = getSunDirectionECEF(timeAt(h), new THREE.Vector3(), origin).applyMatrix4(toWorld).normalize();
    const a = analyticSun(h), n = Math.hypot(a.x, a.y, a.z);
    worst = Math.max(worst, Math.acos(Math.min(1, (v.x * a.x + v.y * a.y + v.z * a.z) / n)) * 180 / Math.PI);
  }
  console.log(`# analytic vs sky model: worst ${worst.toFixed(3)}° over the day`);
  assert.ok(worst < 0.5, `worst ${worst}°`);
  // the default start's light: Day Sail 18:45 at +17.8° on the highlight day; +17.4° on the normal day (the approved
  // 18:00 frame at 47° N was +17.2°, az 286°)
  const v = getSunDirectionECEF(timeAt(18.75), new THREE.Vector3(), origin).applyMatrix4(toWorld).normalize();
  near(Math.asin(v.y) * 180 / Math.PI, 17.8, 0.1, 'Day Sail start elevation, 2026-07-04');
  const v0 = getSunDirectionECEF(timeAt(18.75, makePlace(CURRENT_WATERS, pickDay(CURRENT_WATERS, 'normal'))), new THREE.Vector3(), origin).applyMatrix4(toWorld).normalize();
  near(Math.asin(v0.y) * 180 / Math.PI, 17.4, 0.1, 'Day Sail start elevation, 2026-06-15');
});

test('the wind follows the clock: setClock moves its day with the hour', () => {
  const c = new TimeOfDay({ hour: 15, rate: 10 });
  const w = new WindField({ seed: 1, day: { hour: 15, rate: 1 } });
  w.setClock((t) => c.hourAt(t));
  const at = (t) => { w.at(t); return w.base.speedMs; };
  const afternoon = at(360 * 2);    // 17:00
  const dusk = at(360 * 6.5);       // 21:30
  assert.ok(afternoon > 4, `the afternoon breeze ${afternoon} m/s`);
  assert.ok(dusk < afternoon / 2, `the evening fade ${dusk} m/s`);
  near(w.hourAt(360), 16, 1e-12, 'hourAt reads the clock');
});

// ---- a rate schedule (Chill's quick night, src/modes/chill/params.js) ------------------------------------------------
test('a rate schedule: the table round-trips, the day repeats, a constant schedule is the constant rate', () => {
  const T = new RateTable(nightSchedule({ base: 20, fast: 9 }));
  for (const h of [0, 3.1, 11.99, 12, 17, 20.93, 23.999, 30.5, 47.2]) near(T.hourAtSim(T.simAt(h)), h, 1e-9, `round trip ${h}`);
  near(T.simAt(41) - T.simAt(17), T.dayS, 1e-6, 'one day');
  const flat = new TimeOfDay({ hour: 17, schedule: () => 20 }), lin = new TimeOfDay({ hour: 17, rate: 20 });
  for (const t of [0, 1, 59.5, 1234.5, 5000]) near(flat.hourAt(t), lin.hourAt(t), 1e-9, `flat at ${t}`);
  // setRate (the hand-over to Day Sail) ends the schedule continuously; setHour keeps it
  const c = new TimeOfDay({ hour: 20.8, schedule: chillSchedule() });
  const h = c.hourAt(100);
  c.setRate(DEFAULT_TIMERATE, 100);
  near(c.hourAt(100), h, 1e-9, 'continuous at the hand-over');
  near(c.hourAt(136), h + 0.1, 1e-9, 'Day Sail\'s rate after it');
  const d = new TimeOfDay({ hour: 17, schedule: chillSchedule() });
  d.setHour(23, 50);
  assert.equal(d.rateAt(50), CHILL.timeRate * CHILL.night.fast, 'the night rate from the new hour');
});

test('Chill\'s clock: 60 real minutes from 17:54 PDT through a quick night into the morning, smooth, ≤ 2.5 min under −8°', () => {
  assert.equal(CHILL.hour, '17.9', 'Chill starts at 17:54 PDT (sun +27°)');
  const c = new TimeOfDay({ hour: 17.9, schedule: chillSchedule() });
  const dt = 1 / 60;   // the page's frames at 1× (Chill's sim speed)
  let below = 0, prevE = null, prevR = null, maxDe = 0, maxStep = 0, loonNight = Infinity, birdsS = 0;
  const at = {};
  const first = (k, t) => { if (!(k in at)) at[k] = t; };
  for (let i = 0; i <= 3600 * 60; i++) {
    const t = i * dt, f = c.tick(t), r = c.rateAt(t), h = f.hourUnwrapped;
    if (prevE !== null) { maxDe = Math.max(maxDe, Math.abs(f.elevDeg - prevE)); maxStep = Math.max(maxStep, Math.abs(Math.log(r / prevR))); }
    prevE = f.elevDeg; prevR = r;
    const mix = mixAt({ hour: f.hour, windSpeed: 0.6, shoreDist: -300 }).gains;
    if (f.elevDeg < -8 && h < 36) { below += dt;   // the first night (at Tahoe the 60 min reach the next one's start)
      loonNight = Math.min(loonNight, mix.loon); first('night', t); }
    if (h > 24 && f.elevDeg > -8) first('blue', t);
    if (h >= 30.3) first('five', t);   // 06:18, past the +6° end of the dawn ramp
    if (mix.birds_dawn > 0.2) birdsS += dt;
  }
  const hEnd = c.hourAt(3600);
  console.log(`# chill clock: under −8° ${below.toFixed(1)} s (from ${(at.night / 60).toFixed(2)} min), first blue light ${(at.blue / 60).toFixed(2)} min, 06:18 at ${(at.five / 60).toFixed(2)} min, 60 min ends ${(hEnd % 24).toFixed(2)} h; max |Δelev| per frame ${maxDe.toFixed(4)}°, max rate step per frame ${(100 * (Math.exp(maxStep) - 1)).toFixed(2)} %; birds ${(birdsS / 60).toFixed(1)} min`);
  assert.ok(below <= 150 && below >= 90, `${below.toFixed(1)} s under −8° (want ≈ 120, at most 150)`);
  assert.ok(at.blue - at.night <= 150, 'deep dusk to the first blue light in ≤ 2.5 min');
  assert.ok(Math.abs(c.rateAt(at.five) - CHILL.timeRate) < 0.5, `back to the day's pace by 06:18 (${c.rateAt(at.five)})`);
  // the day loops in ≈ 48.7 min (Tahoe's June night is longer than 47° N's was: 52.4 min), so the 60 min end in the
  // second night's start (≈ 02:45 the night after)
  assert.ok(hEnd > 24 + 20, `the session ends past the next day's dusk at ${hEnd % 24} h (morning and afternoon passed)`);
  near(c.seg[0].table.dayS / 60, 48.7, 0.3, 'the day loop (min)');
  // no light discontinuity: the sun moves at most 0.01° per frame (180 game s per sim s moves it ≈ 0.006°), and the
  // rate ramps (no step over 1 % between frames)
  assert.ok(maxDe < 0.01, `the sun jumped ${maxDe}° in a frame`);
  assert.ok(maxStep < Math.log(1.01), `a rate step of ${maxStep}`);
  // the ambience follows the clock: the loons sing through the whole night (in full by 21:36, before −8° at 21:13 they are ≥ 0.6), the
  // birds at dawn
  assert.ok(loonNight >= 0.6 * LEVEL.loon, `the loons at night ${loonNight}`);
  assert.ok(birdsS >= 5 * 60, `the birds sang ${birdsS} s`);
});
