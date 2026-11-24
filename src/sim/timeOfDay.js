// D2: the time-of-day clock. Plain JS, no three.js, so the tests
// run in node. It owns the hour; src/daylight.js applies it to the scene (sun, exposure, light levels, the probe).
//
//   const clock = new TimeOfDay({ hour: 18.75, rate: 10, sunAt });   // rate: game seconds per SIM second
//   const f = clock.tick(simT);   // every frame: { hour, hourUnwrapped, sun, elevDeg, exposure, light, probe, cut }
//   wind.setClock((t) => clock.hourAt(t));   // the wind's day follows the same clock (unwrapped hours)
//
// Time follows SIM time, not wall time: the 1×/2×/4× game speed runs the day too (so 4× skips an evening faster), a
// pause stops it, and the hour is a pure function of sim time and the rate history (deterministic, replayable).
// DEFAULT_TIMERATE = 10 game s per sim s: at the default 2× game speed that is 20× real time, 1 game hour per 3 real
// minutes (the owner's "about 1 h per 3 min"). At 1× it is 1 h per 6 min; at 4× 1 h per 90 s.
//
// A rate schedule (Chill's quick night): the rate as a smooth function of the hour of day,
// new TimeOfDay({ hour, schedule: nightSchedule({ base: 20, fast: 9 }) }). The hour stays a pure, continuous function of
// sim time: the schedule is integrated once into a table (RateTable), and hourAt() reads it.
//
// URL contract: ?hour=<0–24> the start hour, local clock time at Tahoe (PDT; src/place.js) on the map's day (src/day.js):
// sail default 18.75 (sun +17.8° on the highlight day 2026-07-04; +17.4° on the normal day 2026-06-15), fly 6.5 (+7.8°;
// +8.8°), the June elevations matched the old 47° N defaults (18:00, 05:12); ?timerate=<game s per sim s>.
// Without ?timerate: sail runs at DEFAULT_TIMERATE, fly stays frozen, and ?headless=1 is always frozen, so the goldens
// and every capture keep their hour.

import { makePlace, timeAt } from './place.js';
import { CURRENT_WATERS } from './waters/current.js';
import { clamp } from './core/math.js';
const HERE = makePlace(CURRENT_WATERS);   // this page's lake on this page's day (src/day.js): the analytic sun's default place and date

export const DEFAULT_TIMERATE = 10;
const DAY_H = 24;
// The default start hours (local PDT), chosen on the normal day (2026-06-15) for the sun elevation the approved look had
//: Day Sail 18:45 (+17.4°, az 286°; the old 18:00 at 47° N was +17.2°, az 286°); fly 06:30 (+8.8°; old
// 05:12 +9.0°). Kept as clock hours on the highlight day (2026-07-04: +17.8° and +7.8°; sunrise is 6 min later).
export const SAIL_HOUR = '18.75';
export const FLY_HOUR = '6.5';

const DEG = Math.PI / 180;
const wrap24 = (h) => ((h % DAY_H) + DAY_H) % DAY_H;

// The URL's time parameters. flags: the page's or a mode's flags (src/core/flags.js). defaultHour and defaultRate: the
// mode's own (its coreOptions: Sail SAIL_HOUR and DEFAULT_TIMERATE; fly FLY_HOUR and 0, the light stays).
export function timeParams(flags, { defaultHour = FLY_HOUR, headless = flags.headless != null, defaultRate = 0 } = {}) {
  const hour = clamp(parseFloat(flags.hour ?? defaultHour), 0, DAY_H);
  const tr = flags.timerate;
  let rate;
  if (tr != null && tr !== '') rate = Math.max(0, Number.isFinite(parseFloat(tr)) ? parseFloat(tr) : 0);
  else rate = headless ? 0 : defaultRate;
  return { hour, rate };
}

// The sun's declination and the equation of time at an instant (ms since the epoch): NOAA's solar equations (the NOAA
// Solar Calculator spreadsheet, after Meeus, "Astronomical Algorithms": accurate to ≈ 0.01° and ≈ 0.1 min for
// 1800–2100; https://gml.noaa.gov/grad/solcalc/calcdetails.html). Any date works: no per-date constants.
// 2026-06-15 19:00 UTC: +23.33°, −0.59 min (this file typed +23.33°, −0.62 in); 2026-07-04 19:00 UTC: +22.82°, −4.51 min.
export function solarDeclEqTime(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;   // Julian centuries since J2000.0
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;   // geometric mean longitude, deg
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);                           // mean anomaly, deg
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);                      // the orbit's eccentricity
  const Mr = M * DEG;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * DEG;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * DEG;                // apparent longitude
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * DEG;                               // corrected obliquity
  const declDeg = Math.asin(Math.sin(eps) * Math.sin(lambda)) / DEG;
  const y = Math.tan(eps / 2) ** 2, L = L0 * DEG;
  const eqTimeMin = 4 / DEG * (y * Math.sin(2 * L) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L)
    - 0.5 * y * y * Math.sin(4 * L) - 1.25 * e * e * Math.sin(2 * Mr));
  return { declDeg, eqTimeMin };
}

// The day's pair, taken at the place's mean solar noon (Tahoe: 20:00 UTC; the old constants were read at 19:00 UTC):
// one pair per day, so the sun is continuous when the hour wraps past midnight (the map's day repeats; it never
// advances). Over a day they change by < 0.2° and < 0.2 min (tests/timeOfDay: within 0.05° of the sky model all day).
const DAY_SUN = new Map();
function daySun(date, utcOffsetH, lonDeg) {
  const k = `${date} ${utcOffsetH} ${lonDeg}`;
  let s = DAY_SUN.get(k);
  if (!s) { s = solarDeclEqTime(timeAt(12 - lonDeg / 15 + utcOffsetH, { date, utcOffsetH })); DAY_SUN.set(k, s); }
  return s;
}

// An analytic sun for the tests and for a scene without a sky model: the scene's place and day (src/place.js:
// Fannette Island, 38.954° N 120.100° W, on the map's day: the highlight day 2026-07-04, ?day=normal 2026-06-15),
// hour = local clock time (PDT, UTC−7). Local solar time is the clock hour − the UTC offset + longitude / 15 + the
// equation of time: on 2026-07-04 PDT − 1 h 05 min here, solar noon 13:05 (13:01 on 2026-06-15). declDeg and eqTimeMin
// are computed for the day (solarDeclEqTime at its solar noon, daySun above; pass them to pin them). Returns { x, y, z } toward the sun in
// the world frame (x east, y up, z south). Within 0.05° of the sky model's (astronomy-engine) direction over the day
// (tests/timeOfDay). Before 2026-10-29 the defaults were 47° N on the Greenwich meridian, 2026-06-21, hour = UTC.
export function analyticSun(hour, { latDeg = HERE.latDeg, lonDeg = HERE.lonDeg, utcOffsetH = HERE.utcOffsetH, date = HERE.date, declDeg = null, eqTimeMin = null } = {}) {
  if (declDeg == null || eqTimeMin == null) {
    const s = daySun(date, utcOffsetH, lonDeg);
    declDeg ??= s.declDeg; eqTimeMin ??= s.eqTimeMin;
  }
  const solar = hour - utcOffsetH + lonDeg / 15 + eqTimeMin / 60;   // local apparent solar time, h
  const H = (solar - 12) * 15 * DEG;   // hour angle, + after noon
  const phi = latDeg * DEG, d = declDeg * DEG;
  // east-north-up: the sun at hour angle H, declination d, seen from latitude phi
  const e = -Math.cos(d) * Math.sin(H);
  const n = Math.cos(phi) * Math.sin(d) - Math.sin(phi) * Math.cos(d) * Math.cos(H);
  const u = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
  return { x: e, y: u, z: -n };
}

// ---- light levels by sun elevation ------------------------------------------------------------------------------
// Two curves, both keyed on the sun's elevation in degrees, calibrated on the sail camera. The
// hours below are the old 47° N clock's (UTC); the curves read only the elevation, so they hold at Tahoe:
//  SKY_LIGHT  the scene's physical brightness relative to 18:00 (sun +17°): the sky and ridges above the horizon, from
//             the exposure that matched their 18:00 luma at each hour. lightAt() is it relative to the knee and capped
//             at 1: it scales the hand-set colours that the sky model does not light (the water's sky and body tints,
//             the mist, the spray, the wires) so dusk dims them too, and leaves them as today by day.
//  EXPOSURE   the AgX exposure. 6 (today's hand-tuned value) wherever the sun is above +8.5°, so the dawn (+9.0°) and
//             sail (+17.2°) goldens keep it exactly; below, it rises to hold dusk readable, compensating 70 % of the
//             light lost in stops (0.7: a dusk that reads as dusk, never black), and holds a night floor.
const SKY_LIGHT = [   // [elevDeg, relative light]; measured 2026-10-29 down to −7.1° (renders/daytime/cal), extrapolated below
  [-14, 4e-6], [-10, 1.5e-5], [-7.12, 2.4e-4], [-4.93, 2.1e-3], [-3.4, 8.37e-3], [-2.21, 2.04e-2], [-1, 4.76e-2],
  [0.66, 0.169], [3.22, 0.390], [7.7, 0.688], [17.22, 1.0], [27.24, 1.22], [47.47, 1.63], [66.43, 2.01],
];
const EXPOSURE_GAIN = 0.7;      // the share of the lost light (in stops) the exposure gives back below the knee
export const EXPOSURE_KNEE_DEG = 8.5;  // at and above this the exposure is the base (6)
const EXPOSURE_MAX_GAIN = 362;  // the night floor (2^8.5): at most base × 362

// log-linear between the knots (the light spans 19 stops), flat outside
function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) { const [x0, y0] = table[i - 1]; return Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * (x - x0) / (x1 - x0)); }
  }
  return table[table.length - 1][1];
}

function skyLightAt(elevDeg) { return interp(SKY_LIGHT, elevDeg); }
// The light level for the hand-set colours: 1 at and above the knee (today's look, unchanged), the sky's own fall below.
export function lightAt(elevDeg) { return Math.min(1, skyLightAt(elevDeg) / skyLightAt(EXPOSURE_KNEE_DEG)); }

// The suggested exposure for a sun elevation. base: the scene's hand-tuned exposure (6, or ?exposure).
export function exposureAt(elevDeg, base = 6) {
  if (elevDeg >= EXPOSURE_KNEE_DEG) return base;
  return base * Math.min(EXPOSURE_MAX_GAIN, Math.pow(1 / lightAt(elevDeg), EXPOSURE_GAIN));
}

// ---- rate schedules ---------------------------------------------------------------------------------------------------
import { smooth as smoothstep } from './core/math.js';
const elevAt = (hour, sunAt) => { const s = sunAt(hour); return Math.asin(clamp(s.y / (Math.hypot(s.x, s.y, s.z) || 1), -1, 1)) / DEG; };

// The quick night: base game s per sim s by day; once the sun sinks past duskDeg[0] the rate climbs (log-smoothly, a
// smoothstep in elevation) to base × fast by duskDeg[1]; at dawn it holds base × fast up to dawnDeg[0] and eases back
// to base by dawnDeg[1]. The evening side is the hours from noon to midnight, the morning side the rest. Keyed on the
// analytic sun (within ≈ 0.4° of the sky model), so the table is pure and the headless sims get the same clock.
// Returns hourOfDay → rate (game s per sim s).
export function nightSchedule({ base = 20, fast = 9, duskDeg = [-6.5, -9.5], dawnDeg = [-9, 6], sunAt = analyticSun } = {}) {
  return (hour) => {
    const e = elevAt(hour, sunAt);
    const m = hour >= 12 ? smoothstep(-duskDeg[0], -duskDeg[1], -e) : 1 - smoothstep(dawnDeg[0], dawnDeg[1], e);
    return base * Math.pow(fast, m);
  };
}

// ---- the day clock (owner, 2026-10-30): the rate follows the sun ------------------------------------------------------
// "The 24 hours shouldn't run at one speed": the golden hours and twilight run slow (the best light lasts), the day at
// its normal pace, the deep night as a quicker pace (owner, 2026-11-09: long enough for the Milky Way): the whole night under -12 deg passes
// in about 5 real minutes, eased in after dusk and out before dawn. Pure in the sun's elevation, so the morning side is
// the evening's mirror and dawn arrives at the same slow pace. The multiplier is log-linear between the knots with a
// smoothstep on each span: continuous, flat at every knot. Without it (?clock=flat) the modes keep their old clocks.
export const DAY_CLOCK = {
  nightMult: 4,            // x the day's rate with the sun under nightDeg: 6.7 h of deep night in about 5 real min at the Sail and Cruise base (owner, 2026-11-09: "a dark sky with the Milky Way for several minutes, not 45 s"; was 27: 45 s)
  goldenMult: 0.6,         // x the day's rate from twilightDeg up to goldenDeg: 1.67x slower than the day
  nightDeg: -12,           // at and below: the full night rate
  twilightDeg: -6,         // nightDeg -> twilightDeg: the rate eases from night to golden
  goldenDeg: 10,           // twilightDeg -> goldenDeg: golden hour and twilight, held slow
  dayDeg: 25,              // goldenDeg -> dayDeg: eases to the normal rate; above: 1
};
export function dayClockMult(elevDeg, c = DAY_CLOCK) {
  const L = Math.log;
  if (elevDeg <= c.nightDeg) return c.nightMult;
  if (elevDeg < c.twilightDeg) return Math.exp(L(c.nightMult) + (L(c.goldenMult) - L(c.nightMult)) * smoothstep(c.nightDeg, c.twilightDeg, elevDeg));
  if (elevDeg <= c.goldenDeg) return c.goldenMult;
  if (elevDeg < c.dayDeg) return Math.exp(L(c.goldenMult) * (1 - smoothstep(c.goldenDeg, c.dayDeg, elevDeg)));
  return 1;
}
// base: game s per sim s in the day (Sail 10 at its 2x speed, Cruise 20 at 1x: both 20 game s per real second).
export function dayClockSchedule({ base = 20, sunAt = analyticSun, clock = DAY_CLOCK } = {}) {
  return (hour) => base * dayClockMult(elevAt(hour, sunAt), clock);
}
// ?clock=flat: today's clocks (Sail a constant rate, Cruise the old quick night)
export const clockIsFlat = (flags) => flags.clock === 'flat';
// The "time is speeding" cue: on when the rate is >= onX times the day's, off below offX (a gap, so it never flickers)
export class SpeedCue {
  constructor({ onX = 4, offX = 2.5 } = {}) { this.onX = onX; this.offX = offX; this.on = false; }
  // x: rate / day rate. Returns 'on' / 'off' on the frame it changes, else null
  step(x) {
    if (!this.on && x >= this.onX) { this.on = true; return 'on'; }
    if (this.on && x < this.offX) { this.on = false; return 'off'; }
    return null;
  }
}
export const NIGHT_LINE = 'The night passes\u2026';

// A schedule integrated over one day: sim seconds from 00:00 to each hour, on a 3.75 game-second grid (the rate is held
// within a cell, so the hour is piecewise linear in sim time: continuous, monotonic, a pure function of t). The day
// repeats: T(h + 24) = T(h) + dayS.
export class RateTable {
  constructor(schedule, { cellH = 1 / 960 } = {}) {
    const n = Math.round(DAY_H / cellH);
    this.n = n; this.dh = DAY_H / n;
    this.rate = new Float64Array(n); this.cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      this.rate[i] = Math.max(1e-6, schedule((i + 0.5) * this.dh));
      this.cum[i + 1] = this.cum[i] + this.dh * 3600 / this.rate[i];
    }
    this.dayS = this.cum[n];
  }
  cell(w) { return Math.min(this.n - 1, Math.max(0, Math.floor(w / this.dh))); }
  // sim seconds from hour 0 (unwrapped) to hour h
  simAt(h) {
    const k = Math.floor(h / DAY_H), w = h - k * DAY_H, i = this.cell(w);
    return k * this.dayS + this.cum[i] + (w - i * this.dh) * 3600 / this.rate[i];
  }
  // the unwrapped hour tau sim seconds from hour 0
  hourAtSim(tau) {
    const k = Math.floor(tau / this.dayS), w = tau - k * this.dayS;
    let lo = 0, hi = this.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.cum[mid] <= w) lo = mid; else hi = mid - 1; }
    return k * DAY_H + lo * this.dh + (w - this.cum[lo]) * this.rate[lo] / 3600;
  }
  // the hour dt sim seconds after hour h0
  hourAfter(h0, dt) { return this.hourAtSim(this.simAt(h0) + dt); }
  rateAt(h) { return this.rate[this.cell(wrap24(h))]; }
}

// ---- the clock ------------------------------------------------------------------------------------------------------
export class TimeOfDay {
  // hour: the hour at sim time t0; rate: game seconds per sim second (0 frozen); sunAt(hour) → { x, y, z } (world);
  // baseExposure: 6 or ?exposure; probeDeg: recapture the water's probe when the sun has moved this far since the last.
  // probeStops: … or when the light level has changed this many stops (at dusk the light falls ≈ 1.4 stops per degree)
  // schedule: hourOfDay → rate (nightSchedule above); it replaces the constant rate until setRate().
  constructor({ hour = 18, rate = DEFAULT_TIMERATE, t0 = 0, sunAt = analyticSun, baseExposure = 6, probeDeg = 1.0, probeStops = 0.25, schedule = null } = {}) {
    // the hour(t) segments: each a constant rate (piecewise linear) or a schedule's table; a change keeps it continuous
    this.seg = [schedule ? { t: t0, h: hour, table: new RateTable(schedule) } : { t: t0, h: hour, rate: Math.max(0, rate) }];
    this.sunAt = sunAt;
    this.baseExposure = baseExposure;
    this.probeDeg = probeDeg;
    this.probeStops = probeStops;
    this.probeLight = null;
    this.probeSun = null;    // the sun direction at the last probe request
    this.pendingCut = 'start';   // the first tick applies everything at once; the load-time probe capture covers it
    this.lastT = t0;
  }

  // the rate now (game s per sim s): the constant, or the schedule's at the current hour
  get rate() { return this.rateAt(this.lastT); }
  rateAt(t) { const s = this.segAt(t); return s.table ? s.table.rateAt(this.hourAt(t)) : s.rate; }

  // the segment holding t (searching back from the newest: the wind's advection history asks for old times)
  segAt(t) {
    for (let i = this.seg.length - 1; i > 0; i--) if (t >= this.seg[i].t) return this.seg[i];
    return this.seg[0];
  }
  // unwrapped hours (monotonic in t; 18 → 30 across midnight): what the wind wants (dayWind wraps itself)
  hourAt(t) { const s = this.segAt(t); return s.table ? s.table.hourAfter(s.h, t - s.t) : s.h + (t - s.t) * s.rate / 3600; }
  // the hour of day in [0, 24)
  hourOfDay(t) { return wrap24(this.hourAt(t)); }

  // change the rate from sim time t on (the hour keeps going from where it is); a constant rate ends a schedule
  setRate(rate, t = this.lastT) {
    const h = this.hourAt(t);
    this.seg.push({ t, h, rate: Math.max(0, rate) });
  }
  // run a schedule from sim time t on (continuous at t)
  setSchedule(schedule, t = this.lastT) {
    const h = this.hourAt(t);
    this.seg.push({ t, h, table: new RateTable(schedule) });
  }
  // jump to an hour at sim time t (a cut: "wait for sunrise", a debug key); the probe and history recapture at once.
  // A schedule keeps running from the new hour.
  setHour(hour, t = this.lastT) {
    const s = this.segAt(t);
    this.seg.push(s.table ? { t, h: hour, table: s.table } : { t, h: hour, rate: s.rate });
    this.pendingCut = true;
  }

  // Every frame, with the sim time. Returns the frame's light (a fresh object; cheap).
  tick(t) {
    this.lastT = t;
    const hourUnwrapped = this.hourAt(t), hour = wrap24(hourUnwrapped);
    const s = this.sunAt(hour);
    const len = Math.hypot(s.x, s.y, s.z) || 1;
    const sun = { x: s.x / len, y: s.y / len, z: s.z / len };
    const elevDeg = Math.asin(clamp(sun.y, -1, 1)) / DEG;
    const cut = this.pendingCut !== false;
    let probe = this.pendingCut === true;   // a jump recaptures; the start does not (main.js captured it at load)
    this.pendingCut = false;
    const light = lightAt(elevDeg);
    if (!probe && this.probeSun) {
      const c = clamp(sun.x * this.probeSun.x + sun.y * this.probeSun.y + sun.z * this.probeSun.z, -1, 1);
      probe = Math.acos(c) / DEG >= this.probeDeg || Math.abs(Math.log2(light / this.probeLight)) >= this.probeStops;
    }
    if (probe || !this.probeSun) { this.probeSun = sun; this.probeLight = light; }
    return {
      t, hour, hourUnwrapped, sun, elevDeg,
      exposure: exposureAt(elevDeg, this.baseExposure),
      light,   // 1 by day; the hand-set colours' level below the knee
      probe,   // the water's reflection probe is due (start a spread recapture)
      cut,     // a jump: apply everything now (full probe capture, cloud history reset)
    };
  }
}
