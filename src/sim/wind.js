// The wind field: one module every effect reads (water, grass, clouds, sails). Plain JS, no three.js.
// World frame: x east, z south, metres; t in seconds. dirDeg is where the wind comes FROM, compass degrees
// (0 = a north wind, blowing toward +z; 270 = a west wind, blowing toward +x), as a sailor says it.
//
// sample(x, z, t) = base × gust × channel × lee × crest, the direction turned by the shift and the valley:
//   day     with day: { hour }, the base (direction, speed, gustiness) follows a mountain lake's day on the scene
//           clock (dayWind below, 11): glassy dawn, a light down-valley morning drift, a lull ≈13:30,
//           the up-lake afternoon breeze from ≈14:15 at 12–20 kt, fading at sunset; now and then an advisory day.
//   gust    a 3-octave gradient-noise field, ~scaleM across, plus a ~1.5 km patch octave (one side of the lake
//           gusting while the other lulls), advected downwind and slowly evolving over periodS; factor
//           1 + strength × n, n in [−1, 1] with mean ≈ 0. Evaluated on a world grid of scaleM / 8 and read bilinearly.
//   shift   a slow direction wander of ± shift.deg over shift.periodS, carried downwind with the air.
//   valley  with setTerrain(heightAt): in a valley the wind turns toward the valley's axis (the cross-axis part is
//           damped by the channel strength), runs faster through narrows and slower across wide bays; headlands and
//           side-valley mouths (where the channel bends or changes) are gustier and shiftier. The axis and strength
//           come from the structure tensor of the terrain's slopes within ≈1.2 km, the strength also from the
//           valley's depth (both sides higher) and the point's height (ridge tops see the free wind).
//   lee     behind relief within LEE_REACH upwind along the local (channelled) direction: down to LEE_MIN within
//           10 H, back to 1 by 40 H; relief past 1.2 km counts less and less (a 1 km range 3 km away no longer
//           shades the whole lake: the valley wind runs along it).
//   crest   on a windward slope or crest the speed rises by up to 80 % (CREST_* below); the lake (h ≤ 0) sees none.
//   first   with firstGust: one placed gust patch, × (1 + gain) inside a soft-edged ellipse (long across the wind, as a
//           gust line is), still or drifting slowly downwind, fading after holdS. Day Sail places it ahead of the start
//           (firstGustFor below), so the first dark patch on the water is a real one: steer into it and the boat surges.
//   level   day mode: Day Sail's wind level 1–4 (4–7, 8–12, 13–17, 18–24 kn; 3 by default) on the open bay at 18:45
//           (LEVEL_REF_HOUR, Day Sail's start).
//           A constant scale on the day's base, so the day's gusts and lulls stay as variation on top; the scaled base
//           is floored at the band's bottom by day and capped at its top at every hour (LEVEL_BAND). The level holds
//           through golden hour: the day's evening fade waits for the sun to set (+2°), and the base floors at the
//           band's bottom until the sun is −6°; then the floor lets go (by −9°) into the calm night (eveningHour below).
//           setLevel() blows a change in as a front: a ragged edge carried downwind across the water, so the new
//           wind (and the water's darkening) arrives from upwind over ≈ 25 s, not as a global fade (WIND_LEVELS below).
// The terrain parts are cached per 5° of the free-air direction on world lattices and read bilinearly, so sample()
// and toTexture() read the same numbers and cost lookups, not terrain marches.

import { analyticSun } from './timeOfDay.js';
import { CURRENT_WATERS } from './waters/current.js';
// ---- pro: readable wind shifts (feat/pro-sailing, src/wind-shifts.js) ----
import { WindShifts } from './wind-shifts.js';
// ---- Sail's shifts by experience (owner, 2026-11-17; src/sim/sail-shifts.js): in place of the wander and the readable shifts while a profile is set ----
import { SailShifts } from './sail-shifts.js';
// ---- end pro ----
// the modifiers (src/wind-modifiers.js): the gust cells (wow/gusts, field.cells) and the storm's outflow (wow/storm,
// field.storm), each on when its state is set
import { WIND_MODIFIERS } from './wind-modifiers.js';
import { cellsOption } from './wind-cells.js';

const DEG = Math.PI / 180;
const FLOW = new Float64Array(2);   // the flow modifiers' [vx, vz] (sample() and toTexture(): no allocation a point)
const LEE_MIN = 0.5, LEE_FULL = 4, LEE_RECOVER = 12;
const LEE_REACH = 1600, LEE_FADE = 800;           // m: relief further upwind than LEE_FADE counts less, none past LEE_REACH
const LEE_D = [30, 50, 80, 115, 160, 215, 280, 360, 450, 560, 690, 840, 1010, 1200, 1400, 1600];   // ray samples, m upwind
const LEE_CELL = 50;                               // m, the lee lattice
// crest speed-up: Δs = 1.6 H / L at the crest (L = upwind distance from the crest to half height; Taylor & Lee's
// guideline for a 2-D ridge), capped at 0.8 (steeper slopes separate), falling linearly to 0 at 1.5 L from the
// crest (the ASCE 7 topographic factor's K2 for a ridge)
const CREST_K = 1.6, CREST_MAX = 0.8, CREST_STEP = 30, CREST_W = 1500, CREST_LOOK = 4, CREST_CELL = 125;
const H_CELL = 25, H_TILE = 32;                    // the height cache: 25 m cells, 800 m tiles
const S_CELL = 100;                                // m, the valley (steering) lattice
const TILE = 32;                                   // lattice points per tile side
const CHANNEL = 0.8;                               // at most 80 % of the cross-valley wind is turned away
const W_REF = 2000;                                // m, the valley width at which the channel neither speeds nor slows
const ROUGH_GAIN = 0.6;                            // gust strength and shift × (1 + 0.6 × rough) at headlands and mouths
const PATCH = 0.45, PATCH_SCALE = 5;               // the patch octave: × 0.45 of the gust strength, 5 × scaleM across
const BIN = 5;                                     // degrees per terrain cache bin
// the texture caches' sizes: centres kept, and direction bins per centre (each bin is 24 B a texel). Phones keep fewer
// centres (fix/ios-start: up to 58 MB of bins on the phone profile); the numbers read are the same, a far centre is rebuilt
export const WIND_CACHE = Object.freeze({ tex: 8, bins: 24, f32: false });   // f32: the bins in Float32 (phones: half the memory; the wind they give differs by under 1e-6 m/s)
// a field's own caches: new WindField({ cache: { tex: 3, f32: true } }) on a phone (src/quality/apply.js tierFor: wind)
// The gust cap (owner, 2026-10-30): the 10-min peak is at most 1.5 x the local 10-min mean at every level, hour and seed.
// The factor 1 + strength x rough x n is shaped by a soft limiter: untouched up to GUST_KNEE, then it bends smoothly
// (tanh) toward GUST_CAP, which it never reaches, so a gust still builds and fades instead of clipping flat. The lulls
// (factor below 1) are untouched.
const GUST_KNEE = 1.1, GUST_CAP = 1.25;
export const gustShape = (f) => (f <= GUST_KNEE ? f : GUST_KNEE + (GUST_CAP - GUST_KNEE) * Math.tanh((f - GUST_KNEE) / (GUST_CAP - GUST_KNEE)));
const GUST_GAIN = 2.5;   // the 3-octave gradient fbm spans about ±0.4; this maps it to about ±1 before the clamp

function hash3(x, y, z, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
import { lerp } from './core/math.js';
import { clampT as clamp } from './core/math.js';
import { smooth } from './core/math.js';

// 3D gradient (Perlin) noise, about [−1, 1] with mean 0: no value-noise blocks on the lake
const GRADS = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
function grad3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const c = (dx, dy, dz) => {
    const g = GRADS[Math.floor(hash3(xi + dx, yi + dy, zi + dz, seed) * 12)];
    return g[0] * (fx - dx) + g[1] * (fy - dy) + g[2] * (fz - dz);
  };
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

// space octaves (each turned 37° so no grid axis lines up) over a time axis that every octave shares:
// small gusts don't churn faster than big ones
const ROT = [Math.cos(0.65), Math.sin(0.65)];
function fbm3(x, y, z, seed, octaves = 3) {
  let a = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    a += grad3(x * f + i * 17.1, y * f - i * 9.7, z + i * 3.3, seed + i) * amp;
    norm += amp; amp *= 0.5; f *= 2;
    [x, y] = [x * ROT[0] - y * ROT[1], x * ROT[1] + y * ROT[0]];
  }
  return a / norm;
}

// 1D smooth noise in [−1, 1] (the shift's wander)
function wander(s, seed) {
  const i = Math.floor(s);
  return 2 * lerp(hash3(i, 0, 0, seed), hash3(i + 1, 0, 0, seed), fade(s - i)) - 1;
}

// ---- the day ---------------------------------------------------------------------------------------------------
// A mountain lake's summer day (Tahoe's west shore with Garda's two phases), in local clock hours (PDT,
// the scene's hour since 2026-10-29: src/place.js; local solar time is ≈ 1 h earlier).
// The lake runs north–south and its valley rises to the north: the morning drift comes down it (from ≈15°), the
// afternoon breeze up it from the SSW (≈200°). Each regime is a wind vector with a weight over the hours; the base
// is their sum, so a direction change happens through a lull, never as a swing at speed. Per seed: the afternoon
// peak (12–20 kt), its start (±20 min) and the morning drift (3–8 kt). advisory: a SW gale day (14–20 mph, gusts to
// 35–45 mph: a gust strength of 1.35) from late morning. Returns { dirDeg, speedMs, gust, shift, regime }.
const KT = 0.514444;
// the advisory's share of an advisory day's base at an hour (0–1): from late morning to the evening (the VHF forecast
// reads it: src/vhf/forecast.js)
export const advisoryWeight = (hour) => { const h = ((hour % 24) + 24) % 24; return smooth(10, 12, h) * (1 - smooth(19, 21, h)); };
export function dayWind(hour, { seed = 1, advisory = false } = {}) {
  const r = (k) => hash3(k, 17, 3, seed);
  const h = ((hour % 24) + 24) % 24;
  const peak = (12 + 8 * r(1)) * KT, drift = (3 + 5 * r(2)) * KT, start = 14.25 + (r(3) - 0.5) * 0.66;
  const parts = [
    // [weight, fromDeg, speed m/s, gust strength, gust scale m, shift deg, name]
    [smooth(20.5, 22, h) + 1 - smooth(5.5, 7, h), 15, 0.6, 0.6, 250, 25, 'night drainage'],
    [smooth(6, 7, h) * (1 - smooth(7, 8, h)), 15, 0.25, 0.8, 200, 30, 'glassy dawn'],
    [smooth(7.5, 9.5, h) * (1 - smooth(11, 13, h)), 15, drift, 0.45, 300, 15, 'morning down-valley drift'],
    [smooth(12.5, 13.3, h) * (1 - smooth(start - 0.2, start + 0.2, h)), 200, 0.3, 0.9, 200, 40, 'early-afternoon lull'],
    [smooth(start, start + 0.75, h) * (1 - smooth(17.5, 20.5, h)), 200, peak, 0.35, 300, 12, 'afternoon up-lake breeze'],
    [smooth(17.8, 19.5, h) * (1 - smooth(20.5, 22, h)), 195, 1.2, 0.5, 300, 20, 'evening fade'],
  ];
  if (advisory) {
    const w = advisoryWeight(h);
    for (const p of parts) p[0] *= 1 - w;
    parts.push([w, 215, (14 + 6 * r(4)) * 0.44704, 1.35, 600, 15, 'lake wind advisory']);
  }
  let vx = 0, vz = 0, wsum = 0, gs = 0, gl = 0, sh = 0, top = parts[0];
  for (const p of parts) {
    const [w, from, sp, g, gsc, sd] = p;
    vx += w * -Math.sin(from * DEG) * sp; vz += w * Math.cos(from * DEG) * sp;
    wsum += w; gs += w * g; gl += w * gsc; sh += w * sd;
    if (w > top[0]) top = p;
  }
  wsum = Math.max(wsum, 1e-6);
  const speed = Math.max(Math.hypot(vx, vz), 0.15);
  const dirDeg = ((Math.atan2(-vx, vz) / DEG) + 360) % 360;
  return {
    dirDeg, speedMs: speed,
    gust: { strength: gs / wsum, scaleM: gl / wsum, periodS: 40 },
    shift: { deg: sh / wsum, periodS: 120 },
    regime: top[6],
  };
}

// ---- the evening with a level (the integrator, 2026-10-29) --------------------------------------------------------
// The chosen level holds through golden hour. From 18:45 (the level's reference hour) until the sun is down to
// EVENING.fadeDeg the day stands at 18:45; then the day's own fade runs from 18:45 on, faster, so its hour catches up
// with the clock by EVENING.nightHour (22:00, the night drainage whole). floor: 1 while the sun is above
// EVENING.floorDeg, easing to 0 by EVENING.releaseDeg: the base keeps the band's bottom until then. Pure in the hour
// (the analytic sun, as the clock's rate schedule): the same hour gives the same wind on any clock.
// Returns { hour (the hour dayWind reads), floor (0–1) }.
const elevAt = (h) => Math.asin(analyticSun(h).y) / DEG;
let EVE_CACHE = null;
function eveningHours() {
  if (EVE_CACHE) return EVE_CACHE;
  // the evening crossings of an elevation, by bisection between noon and midnight (the sun falls all evening)
  const cross = (deg) => { let a = 12, b = 24; for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (elevAt(m) > deg) a = m; else b = m; } return (a + b) / 2; };
  EVE_CACHE = { fade: cross(EVENING.fadeDeg), floor: cross(EVENING.floorDeg), release: cross(EVENING.releaseDeg) };
  return EVE_CACHE;
}
export function eveningHour(hour) {
  const h = ((hour % 24) + 24) % 24, E = eveningHours(), R = LEVEL_REF_HOUR, N = EVENING.nightHour;
  if (h < R || h >= N || E.fade <= R) return { hour: h, floor: 0 };
  const shifted = h <= E.fade ? R : R + (h - E.fade) * (N - R) / (N - E.fade);
  // the floor: whole until the floor's hour, eased off by the release's
  const floor = 1 - smooth(E.floor, E.release, h);
  return { hour: shifted, floor };
}
// the level's floor weight at any hour (0-1): the evening's (eveningHour) from 18:45 to the night hour; otherwise 1 with
// the sun over EVENING.floorDeg, 0 under releaseDeg (the calm night; the floor eases back in at dawn, the evening's mirror)
function levelFloorWeight(hour, e = eveningHour(hour)) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= LEVEL_REF_HOUR && h < EVENING.nightHour) return e.floor;
  return smooth(EVENING.releaseDeg, EVENING.floorDeg, elevAt(h));
}

// The night held (Velia v2's Sail, owner 2026-11-15: the night is sailable; v1 never sets it): a WindField with nightHold
// keeps the level's floor whole all evening and night, and the evening's own wind (the evening fade, from about 195°) at the
// hour the floor would have let go (the release's shifted hour), so the bay never goes flat while the player sails; at dawn
// (the sun from −12° to −6°) it blends into the morning's own wind, floored, and from −6° the day is v1's again. A gentle
// drop: the base settles at the band's bottom (× floorMargin) instead of the drainage's 0.6 m/s.
// Returns { hour (the hour dayWind reads), blend (0 the held evening … 1 the day's own hour) } or null (v1's day).
export const NIGHT_HOLD = { dawnDeg: [-12, -6] };
function heldHour(hour) {
  const h = ((hour % 24) + 24) % 24, E = eveningHours();
  const hold = eveningHour(E.release).hour;
  if (h >= LEVEL_REF_HOUR && h < EVENING.nightHour) return { hour: Math.min(eveningHour(h).hour, hold), blend: 0 };   // the floor whole from 18:45 (v1's is whole until −6° too)
  if (h >= EVENING.nightHour) return { hour: hold, blend: 0 };
  if (h < 12) { const m = smooth(NIGHT_HOLD.dawnDeg[0], NIGHT_HOLD.dawnDeg[1], elevAt(h)); return m >= 1 ? null : { hour: hold, blend: m }; }
  return null;
}

// two days' winds mixed (the held night into the morning), weight w on b: the direction veers through the shorter arc at the
// mixed speed (a vector mix of 195° and 15° would cancel to a lull and flip in seconds)
function blendDay(a, b, w) {
  if (w <= 0) return a;
  const mix = (x, y) => x + (y - x) * w;
  const d = ((b.dirDeg - a.dirDeg + 540) % 360) - 180;
  return {
    dirDeg: (a.dirDeg + w * d + 360) % 360, speedMs: Math.max(mix(a.speedMs, b.speedMs), 0.15),
    gust: { strength: mix(a.gust.strength, b.gust.strength), scaleM: mix(a.gust.scaleM, b.gust.scaleM), periodS: a.gust.periodS },
    shift: { deg: mix(a.shift.deg, b.shift.deg), periodS: a.shift.periodS },
    regime: w < 0.5 ? a.regime : b.regime,
  };
}

// ---- tiles: lazily built world lattices ---------------------------------------------------------------------
class Tiles {
  constructor(cell, n, fill, stride = 1) { this.cell = cell; this.n = n; this.fill = fill; this.stride = stride; this.map = new Map(); }
  // the tile holding lattice point (i, j), built on first use: fill(x0, z0, cell, n, out) writes n × n × stride values
  tile(ti, tj) {
    const key = ti * 1048576 + tj;
    let t = this.map.get(key);
    if (!t) {
      t = new Float32Array((this.n + 1) * (this.n + 1) * this.stride);          // one point of overlap: no seams
      this.fill(ti * this.n * this.cell, tj * this.n * this.cell, this.cell, this.n + 1, t);
      this.map.set(key, t);
    }
    return t;
  }
  // bilinear read of channel k at a world point
  at(x, z, k = 0) {
    const fx = x / this.cell, fz = z / this.cell, i = Math.floor(fx), j = Math.floor(fz);
    const ti = Math.floor(i / this.n), tj = Math.floor(j / this.n), li = i - ti * this.n, lj = j - tj * this.n;
    const t = this.tile(ti, tj), m = this.n + 1, s = this.stride, q = (lj * m + li) * s + k;
    const u = fx - i, v = fz - j;
    return (t[q] * (1 - u) + t[q + s] * u) * (1 - v) + (t[q + m * s] * (1 - u) + t[q + m * s + s] * u) * v;
  }
}

// The first gust (Day Sail, D1): a patch placed ahead of the start pose so the boat meets it
// ≈ 15–25 s after the start (at the default 2× speed: 30–50 s of scene time, ≈ 60–100 m from rest), slightly off the
// bow so the player steers into it. On a run (the default start) a patch carried at the wind speed would outrun the
// boat, so this one lands and stays (driftFrac 0: a downdraft puff spreading on the water), then fades after holdS.
// Returns the WindField's firstGust option. headingDeg: compass degrees (0 = north, −z); side: +1 starboard, −1 port.
export function firstGustFor({ x = 0, z = 1100, headingDeg = 10, aheadM = 160, side = 1, offsetM = 45, ...rest } = {}) {
  const h = headingDeg * DEG, fx = Math.sin(h), fz = -Math.cos(h), sx = Math.cos(h), sz = Math.sin(h);
  return {
    x: x + fx * aheadM + sx * side * offsetM, z: z + fz * aheadM + sz * side * offsetM,
    alongM: 95, acrossM: 150, edgeM: 30, gain: 0.3, holdS: 150, fadeS: 60, driftFrac: 0, ...rest,
  };
}

// ---- the wind level (Day Sail, owner 2026-10-29) -------------------------------------------------
// The level is set on the open bay (owner's call 1): the bay's mean wind at the reference hour falls in the level's
// band. A day whose bay already blows inside the band is left exactly as its seed made it; any other is scaled to the
// band's mean. The reference hour is Day Sail's start, 18:45 PDT (the coordinator, 2026-10-29, with the June sun:
// at 18:00 the level was set 45 min before the start, while the breeze fades, and the start sailed 25 % under it).
// Seed 1 at level 3 is then ×1.2 (the afternoon breeze at 18:45 is 12.9 kn, the bay's below the band).
// The open bay on the real map (2026-10-29): Emerald Bay's outer basin, north of Fannette Island to the sill. Not the
// open lake outside the mouth: the sill is 0.5–3 m deep (its deepest crossing 0.55 m) and the keel draws 1.6 m, so no
// boat of ours sails out there, and the lake's free wind (≈ 1.0 × the day) would set a level ≈ 25 % stronger than the
// bay ever blows. Not the whole bay: the head, south of the island under the 300 m walls, is a lee (≈ 0.55 × at
// 18:00 from 200°); counting it would scale every day up until the outer bay blew a level too high.
export const WIND_LEVELS = [
  { kn: [4, 7], meanKn: 5.5 }, { kn: [8, 12], meanKn: 10 }, { kn: [13, 17], meanKn: 15 }, { kn: [18, 24], meanKn: 21 },
];
export const DEFAULT_WIND_LEVEL = 3;
export const LEVEL_REF_HOUR = 18.75;   // 18:45 PDT, SAIL_HOUR (src/timeOfDay.js)
// The open bay: lattice points in the outer bay's box (x −300…1400, z −1100…−200, 150 × 100 m) over water deeper
// than 20 m (43 points). Its 10-min mean at 18:00 (seeds 1–5, no level) is 0.93–0.99 × dayWind × the terrain factor:
// the gusts' and shifts' mean, GUST_MEAN.
// The box is the lake profile's (src/waters/<id>.json windBay; a WindField's `bay` option, this page's lake by default):
// { x0, x1, dx, z0, z1, dz, deep, factor (the bay's mean terrain factor, channel × lee × crest, at 18:00 on the real
// terrain: 0.962, used before setTerrain), levelAt ([x, z]: where a level change blows in first, 600, −650) }.
const GUST_MEAN = 0.95;     // the bay's sampled mean over dayWind × terrain factor (0.934–0.986 before the gust cap; seeds 1–5)
// the evening (the integrator, 2026-10-29): the level holds until the sun is at +2° (≈ 19:39), the fade then runs on
// the day's own curve, floored at the band's bottom until −6° (≈ 20:38); the floor lets go by −9° (≈ 21:04)
// (floorMargin: 8 % over the bottom (5 % before the gust cap, which trims the gust mean ≈ 2 %), so the bay’s mean stays in the band whatever the seed’s gust mean)
export const EVENING = { fadeDeg: 2, floorDeg: -6, releaseDeg: -9, nightHour: 22, floorMargin: 1.08 };
// The band holds all day (fix/wind-level-range, 2026-11-04: an outside tester saw level 3 go 6 -> 26 kn in a minute).
// The level's scale is fixed at 18:45, but the day's own base runs 0.3 m/s in the 13:30 lull to 12-20 kt in the
// afternoon, so a level scaled the whole day: level 3 sailed 0.5 kn at 13:00 and 21.5 kn of mean at 15:00 (seed 1,
// the bay). Now the base is floored at the band's bottom (x floorMargin) whenever the sun is over EVENING.floorDeg
// (morning and evening alike, eased over releaseDeg -> floorDeg), and capped at the band's top / ceilMargin at every
// hour, so the bay's mean stays in the band and the gusts (<= 1.25 x) ride on it.
// While floored, the gust strength and the shift are capped at a breeze's (gustMax: the 18:45 mix is 0.42, the
// afternoon breeze 0.35; shiftMaxDeg: the evening's 20°), so 18:45 and the afternoon are unchanged.
const LEVEL_BAND = { ceilMargin: 1.08, gustMax: 0.45, shiftMaxDeg: 20 };
// A change blows in over overS (scene s; Day Sail passes 25 real s × its time rate) at the `at` point: the front's
// leading edge reaches it at lead × overS, the new wind is whole there at overS. The front moves downwind at the
// stronger wind's base speed (3–12 m/s), so its edge is ≈ 100–200 m wide: narrow enough to read as a line of darker
// (or glassier) water sweeping in, as a gust line does. The edge is ragged across the wind by ± rag of its width.
export const LEVEL_BLOW = { overS: 25, lead: 0.6, minMs: 3, maxMs: 12, rag: 0.35, ragM: 260 };

export class WindField {
  // level (day mode): the wind level, DEFAULT_WIND_LEVEL unless given; null leaves the day as it is (an advisory day
  // always is). levelRef: 'bay' (default) or { x, z }, the point whose mean wind the level sets.
  constructor({ seed = 1, base = {}, gust = {}, shift = {}, day = null, firstGust = null, level, levelRef = 'bay', shifts, sailShifts = null, cells = null, cache = null, bay = CURRENT_WATERS.windBay } = {}) {
    this.seed = seed | 0;
    this.bay = bay;   // the open bay's box (the lake profile's windBay): the level's reference
    this.cache = { ...WIND_CACHE, ...cache };   // the texture caches' sizes (WIND_CACHE; a phone keeps fewer, in Float32)
    this.cells = cellsOption(cells);   // gust cells (src/wind-cells.js): null (off) unless the mode asks
    this.base = { dirDeg: base.dirDeg ?? 270, speedMs: base.speedMs ?? 5 };
    this.gust = { strength: gust.strength ?? 0.35, scaleM: gust.scaleM ?? 300, periodS: gust.periodS ?? 40 };
    this.shift = { deg: shift.deg ?? 10, periodS: shift.periodS ?? 120 };
    // day: { hour (at t = 0), rate (scene hours per hour of t; 1 = real time), advisory }
    this.day = day ? { hour: day.hour ?? 15, rate: day.rate ?? 1, advisory: !!day.advisory } : null;
    this.regime = null;
    this.heightAt = null;
    this.advect = [[0, 0]];                        // the day's gust advection, every ADV_DT s from t = 0
    this.tex = new Map();
    this.nightHold = false;   // Velia v2's Sail sets it (heldHour above); v1 never does
    this.lv = day && !day.advisory && level !== null
      ? { level: clamp((level ?? DEFAULT_WIND_LEVEL) | 0, 1, WIND_LEVELS.length), ref: levelRef, scale0: 1, fronts: [], at: { x: bay.levelAt[0], z: bay.levelAt[1] } }
      : null;
    this.levelInit();
    this.at(0);
    // the first gust's axis: the free-air direction at t = 0 unless given
    this.storm = null;   // wow/storm: the outflow's state (src/weather/stormWind.js), set by the storm through setStorm()
    this.modifiers = [...WIND_MODIFIERS];   // src/wind-modifiers.js, in order: the gust cells, the storm's outflow
    this.first = firstGust ? { alongM: 95, acrossM: 150, edgeM: 30, gain: 0.3, holdS: 150, fadeS: 60, driftFrac: 0,
      dirDeg: this.base.dirDeg, speedMs: this.base.speedMs, ...firstGust } : null;
    // ---- pro: readable wind shifts (src/wind-shifts.js): on with shifts: true or {…} (Day Sail turns them on) ----
    this.shifts = !shifts ? null
      : new WindShifts(this, { dayRefMs: day ? this.dayAt(LEVEL_REF_HOUR).speedMs : null, ...(typeof shifts === 'object' ? shifts : {}) });
    // ---- end pro ----
    // a race's shift pattern (v2/regatta/shifts.js): { deg(t), maxDeg } in place of the wander and the readable shifts while it is
    // set (steady, oscillating, persistent); null: the lake's own shifts. The valley still steers the pattern's wind.
    this.pattern = null;
    // Sail's shifts by the player's experience (src/sim/sail-shifts.js): sailShifts: 'new' | 'sail' | 'race' (null: none; the page
    // sets the profile live, null in Cruise and Regatta), carried downwind at the level's mean wind
    this.sailShifts = sailShifts ? new SailShifts({ seed: this.seed, profile: sailShifts,
      carryMs: this.lv ? WIND_LEVELS[this.lv.level - 1].meanKn * KT : this.base.speedMs }) : null;
  }

  // the first gust's factor at a point and time: 1 outside, up to 1 + gain inside (see firstGustFor)
  firstGustAt(x, z, t) {
    const F = this.first;
    if (!F) return 1;
    let life = 1 - smooth(F.holdS, F.holdS + F.fadeS, t);
    if (F.riseS) life *= smooth(F.riseAt ?? 0, (F.riseAt ?? 0) + F.riseS, t);   // laid during play (the staged first visit): it spreads in, never pops
    if (life <= 0) return 1;
    const [ux, uz] = WindField.toward(F.dirDeg), drift = F.driftFrac * F.speedMs * t;
    const dx = x - (F.x + ux * drift), dz = z - (F.z + uz * drift);
    const a = dx * ux + dz * uz, c = -dx * uz + dz * ux;                 // downwind, across (m)
    const q = Math.hypot(a / F.alongM, c / F.acrossM);
    // a ragged, not elliptical, edge: two slow lobes around the patch
    const th = Math.atan2(a / F.alongM, c / F.acrossM);
    const r = 1 + 0.1 * Math.sin(3 * th + 1.3) + 0.06 * Math.sin(5 * th - 0.4);
    const e = F.edgeM / Math.min(F.alongM, F.acrossM);
    return 1 + F.gain * life * (1 - smooth(r - e, r + e, q));
  }

  // the direction the air moves toward, as a unit (x, z) vector, for a FROM direction in degrees
  static toward(dirDeg) {
    return [-Math.sin(dirDeg * DEG), Math.cos(dirDeg * DEG)];
  }

  // the hour of the day at scene time t (day mode)
  hourAt(t) {
    if (!this.day) return null;
    return this.day.clock ? this.day.clock(t) : this.day.hour + t * this.day.rate / 3600;
  }
  // D2 (time of day): the day follows a clock, hourAt(t) → unwrapped hours (src/timeOfDay.js TimeOfDay.hourAt), so a
  // rate change or a pause moves the wind with the light. Advection already cached keeps its history (no jump).
  // wow/storm: the thunderstorm's outflow on this field (src/weather/storm.js, the storm system): its state as plain
  // data (a copy), or null when it ends
  setStorm(state) { this.storm = state ? { ...state } : null; }
  setClock(clock) {
    if (!this.day) return;
    this.day.clock = clock;
    this.clockT = undefined;   // re-evaluate the base on the next sample
  }

  // ---- the wind level ----
  get level() { return this.lv?.level ?? null; }

  // the terrain's factor on the reference hour's wind at the level's reference: the open bay's mean, or one point's
  refFactor(ref = this.lv?.ref ?? 'bay') {
    const d = dayWind(LEVEL_REF_HOUR, { seed: this.seed });
    const BAY = this.bay;
    if (!this.heightAt) return ref === 'bay' ? BAY.factor : 1;
    const [k, w] = WindField.bins(d.dirDeg);
    const at = (x, z) => { const a = this.binAt(k, x, z), b = this.binAt(k + 1, x, z); return a[2] * (1 - w) + b[2] * w; };
    if (ref !== 'bay') return at(ref.x, ref.z);
    let sum = 0, n = 0;
    for (let z = BAY.z0; z <= BAY.z1; z += BAY.dz) for (let x = BAY.x0; x <= BAY.x1; x += BAY.dx) {
      if (this.height(x, z) < BAY.deep) { sum += at(x, z); n++; }
    }
    return n ? sum / n : BAY.factor;
  }

  // the scale on the day's base for a level: 1 when the reference already sees the band at the reference hour, else to its mean
  levelScale(level = this.lv?.level ?? DEFAULT_WIND_LEVEL, ref = this.lv?.ref ?? 'bay') {
    const L = WIND_LEVELS[clamp(level | 0, 1, WIND_LEVELS.length) - 1];
    const refMs = this.refMs(ref);
    const kn = refMs / KT;
    return kn >= L.kn[0] && kn <= L.kn[1] ? 1 : L.meanKn * KT / refMs;
  }

  // the reference's expected mean wind at the reference hour with no level (m/s): the day × the terrain factor × the gusts' mean
  refMs(ref = this.lv?.ref ?? 'bay') {
    return dayWind(LEVEL_REF_HOUR, { seed: this.seed }).speedMs * this.refFactor(ref) * GUST_MEAN;
  }

  // the evening floor on the day's base (m/s, before the level's scale): the bottom of the level's band at the reference
  levelFloorMs(level = this.lv?.level ?? DEFAULT_WIND_LEVEL, ref = this.lv?.ref ?? 'bay') {
    const L = WIND_LEVELS[clamp(level | 0, 1, WIND_LEVELS.length) - 1];
    return L.kn[0] * EVENING.floorMargin * KT / (this.refMs(ref) / dayWind(LEVEL_REF_HOUR, { seed: this.seed }).speedMs) / this.levelScale(level, ref);
  }
  // the ceiling on the day's base (m/s, before the level's scale): the top of the level's band (LEVEL_BAND)
  levelCeilMs(level = this.lv?.level ?? DEFAULT_WIND_LEVEL, ref = this.lv?.ref ?? 'bay') {
    const L = WIND_LEVELS[clamp(level | 0, 1, WIND_LEVELS.length) - 1];
    return L.kn[1] / LEVEL_BAND.ceilMargin * KT / (this.refMs(ref) / dayWind(LEVEL_REF_HOUR, { seed: this.seed }).speedMs) / this.levelScale(level, ref);
  }

  // the day at an hour as the level sails it: dayWind on the evening-shifted hour, floored (eveningHour); without a
  // level (an advisory day, level: null) the day as it is
  dayAt(hour) {
    if (!this.lv) return dayWind(hour, { seed: this.seed, advisory: this.day.advisory });
    const e = eveningHour(hour);
    const held = this.nightHold ? heldHour(hour) : null;
    const d = held ? blendDay(dayWind(held.hour, { seed: this.seed }), dayWind(hour, { seed: this.seed }), held.blend) : dayWind(e.hour, { seed: this.seed });
    const floor = held ? 1 : levelFloorWeight(hour, e);
    if (floor > 0 && this.lv.floorMs > d.speedMs) d.speedMs += (this.lv.floorMs - d.speedMs) * floor;
    if (d.speedMs > this.lv.ceilMs) d.speedMs = this.lv.ceilMs;
    // a floored lull or dawn keeps a breeze's gustiness and shift, not the light air's (0.9 and ±40° in the 13:30 lull
    // made 0 -> 21 kn swings on a floored level 3)
    if (floor > 0) {
      d.gust.strength -= Math.max(0, d.gust.strength - LEVEL_BAND.gustMax) * floor;
      d.shift.deg -= Math.max(0, d.shift.deg - LEVEL_BAND.shiftMaxDeg) * floor;
    }
    return d;
  }

  // (re)derive the settled scale (construction and setTerrain: nothing has blown in yet)
  levelInit() {
    if (!this.lv) return;
    this.lv.scale0 = this.levelScale(); this.lv.fronts = [];
    this.lv.floorMs = this.levelFloorMs();
    this.lv.ceilMs = this.levelCeilMs();
    this.advect = [[0, 0]];   // the gusts drift at the level's wind
    this.clockT = undefined;
  }

  // Day Sail's 1–4: blow the new level in as a front from upwind. t: the scene time now; at: the point where the
  // change should arrive over overS scene seconds (the boat); ref as the constructor. Returns the target scale.
  setLevel(level, { ref, t = this.clockT ?? 0, at, overS = LEVEL_BLOW.overS } = {}) {
    if (!this.lv) return null;
    const lv = this.lv;
    if (ref !== undefined) lv.ref = ref;
    if (at) lv.at = { x: at.x, z: at.z };
    lv.level = clamp(level | 0, 1, WIND_LEVELS.length);
    lv.floorMs = this.levelFloorMs(lv.level, lv.ref);
    lv.ceilMs = this.levelCeilMs(lv.level, lv.ref);
    const to = this.levelScale(lv.level, lv.ref);
    this.at(t);
    const from = this.levelScaleAt(lv.at.x, lv.at.z, t);
    // the level already blowing everywhere (no front in flight, the settled scale the target): nothing to carry in
    if (!lv.fronts.length && Math.abs(to - lv.scale0) < 1e-9) return to;
    const [ux, uz] = WindField.toward(this.base.dirDeg);
    const v = clamp(this.dayMs * Math.max(from, to), LEVEL_BLOW.minMs, LEVEL_BLOW.maxMs);
    const ramp = (1 - LEVEL_BLOW.lead) * overS, w = Math.max(v * ramp, 1);
    // the edge's middle reaches `at` half way through its ramp
    const s0 = lv.at.x * ux + lv.at.z * uz - v * (overS - ramp / 2);
    lv.fronts.push({ t0: t, to, ux, uz, v, w, s0, k: lv.fronts.length + 1 });
    // fronts long gone (an hour old) fold into the settled scale
    while (lv.fronts.length > 1 && t - lv.fronts[0].t0 > 3600) lv.scale0 = lv.fronts.shift().to;
    if (lv.fronts.length > 12) lv.scale0 = lv.fronts.shift().to;
    this.clockT = undefined;
    return to;
  }

  // the point whose wind base.speedMs reports (the boat; the water's wave bands read base.speedMs)
  setListener(x, z) {
    if (!this.lv || (this.lv.at.x === x && this.lv.at.z === z)) return;
    this.lv.at = { x, z };
    if (this.lv.fronts.length) this.clockT = undefined;
  }

  // the level's scale on the day's base at a point and time: the settled scale, then each front that has reached it
  levelScaleAt(x, z, t) {
    const lv = this.lv;
    if (!lv) return 1;
    let v = lv.scale0;
    for (const f of lv.fronts) {
      if (t <= f.t0) continue;
      const along = x * f.ux + z * f.uz, across = -x * f.uz + z * f.ux;
      const edge = f.s0 + f.v * (t - f.t0) + LEVEL_BLOW.rag * f.w * wander(across / LEVEL_BLOW.ragM, this.seed + 211 + f.k);
      const p = smooth(-f.w / 2, f.w / 2, edge - along);   // 0 ahead of the edge (downwind), 1 once it has passed
      v += (f.to - v) * p;
    }
    return v;
  }

  // the base speed at a point (m/s): the day's times the level there; a fixed wind's base as given
  baseAt(x, z, t) {
    return this.lv && this.day ? this.dayMs * this.levelScaleAt(x, z, t) : this.base.speedMs;
  }

  // day mode: set base, gust and shift for scene time t (in place: readers holding wind.base see the change)
  at(t) {
    if (!this.day || t === this.clockT) return;
    this.clockT = t;
    const d = this.dayAt(this.hourAt(t));
    this.dayMs = d.speedMs;
    this.base.dirDeg = d.dirDeg; this.base.speedMs = this.lv ? d.speedMs * this.levelScaleAt(this.lv.at.x, this.lv.at.z, t) : d.speedMs;
    Object.assign(this.gust, d.gust); Object.assign(this.shift, d.shift);
    this.regime = d.regime;
  }

  setTerrain(heightAt) {
    this.heightAt = heightAt;
    const H = (x0, z0, cell, n, out) => { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = heightAt(x0 + i * cell, z0 + j * cell); };
    this.h = new Tiles(H_CELL, H_TILE, H);
    this.hc = new Tiles(S_CELL, H_TILE, H);                          // 100 m heights for the valley analysis
    this.valley = new Tiles(S_CELL, TILE / 2, (x0, z0, cell, n, out) => {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.valleyPoint(x0 + i * cell, z0 + j * cell, out, (j * n + i) * 4);
    }, 4);
    this.bins = new Map();
    this.tex.clear();
    this.levelInit();   // the bay's real terrain factor
  }

  // the terrain height from the cache (bilinear on 25 m cells)
  height(x, z) { return this.h.at(x, z); }

  // ---- the valley ----
  // one valley lattice point: [c cos 2α, c sin 2α, narrows, depth] where α is the axis angle (x east, z south), c the
  // channel strength 0..CHANNEL. The axis is the structure tensor's minor direction over rings of 600, 1100, 1700 and 2400 m (the valley walls).
  valleyPoint(x, z, out, o) {
    const h = (a, b) => this.hc.at(a, b);
    const h0 = this.height(x, z);
    let jxx = 0, jxz = 0, jzz = 0;
    for (const [r, w] of [[600, 1], [1100, 1], [1700, 0.8], [2400, 0.6]]) {
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a = (k + (r === 1100 || r === 2400 ? 0.5 : 0)) * Math.PI * 2 / n, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const gx = (h(px + 100, pz) - h(px - 100, pz)) / 200, gz = (h(px, pz + 100) - h(px, pz - 100)) / 200;
        jxx += w * gx * gx; jxz += w * gx * gz; jzz += w * gz * gz;
      }
    }
    const tr = jxx + jzz, coh = tr > 1e-9 ? Math.hypot(jxx - jzz, 2 * jxz) / tr : 0;
    const across = 0.5 * Math.atan2(2 * jxz, jxx - jzz);               // the major (slope) direction
    const ax = Math.cos(across), az = Math.sin(across);
    // march across the valley both ways: the highest ground within 2.5 km each side, and the water's width
    let hiA = -Infinity, hiB = -Infinity, wA = -1, wB = -1, pa = h0, pb = h0;
    for (let d = 50; d <= 2500; d += 50) {
      const a = h(x + ax * d, z + az * d), b = h(x - ax * d, z - az * d);
      hiA = Math.max(hiA, a); hiB = Math.max(hiB, b);
      if (wA < 0 && a >= 20) wA = d - 50 * (a - 20) / Math.max(a - pa, 1e-6);   // the 20 m contour, interpolated
      if (wB < 0 && b >= 20) wB = d - 50 * (b - 20) / Math.max(b - pb, 1e-6);
      pa = a; pb = b;
    }
    if (wA < 0) wA = 2500;
    if (wB < 0) wB = 2500;
    const base = Math.max(h0, 0), depth = Math.min(hiA, hiB) - base;
    const c = CHANNEL * smooth(0.1, 0.45, coh) * smooth(60, 250, depth) * (1 - smooth(60, 400, h0));
    this.dbg = { coh, depth };
    const width = h0 < 20 ? Math.max(wA + wB, 200) : W_REF;
    const narrows = 1 + (clamp(Math.sqrt(W_REF / width), 0.8, 1.3) - 1) * (1 - smooth(0, 60, h0));
    const alpha = across + Math.PI / 2;
    out[o] = c * Math.cos(2 * alpha); out[o + 1] = c * Math.sin(2 * alpha); out[o + 2] = narrows; out[o + 3] = depth;
  }

  // the valley at a point: { c, ax, az (the axis, either sign), narrows }
  valleyAt(x, z) {
    const e1 = this.valley.at(x, z, 0), e2 = this.valley.at(x, z, 1);
    const c = Math.hypot(e1, e2), a = 0.5 * Math.atan2(e2, e1);
    return { c, ax: Math.cos(a), az: Math.sin(a), narrows: this.valley.at(x, z, 2) };
  }

  // headland / valley-mouth roughness 0..1: how fast the channel's axis turns and the valley narrows within ±300 m
  // (weighted by the channel's strength: a weak channel's axis means little)
  roughAt(x, z) {
    if (!this.heightAt) return 0;
    const d = 300, P = [[x + d, z], [x - d, z], [x, z + d], [x, z - d]].map(([a, b]) => {
      const e1 = this.valley.at(a, b, 0), e2 = this.valley.at(a, b, 1), c = Math.hypot(e1, e2) + 1e-9;
      return [e1 / c, e2 / c, c, this.valley.at(a, b, 2)];
    });
    const turn = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) * Math.min(p[2], q[2]);
    const s = turn(P[0], P[1]) + turn(P[2], P[3]) + 2 * (Math.abs(P[0][3] - P[1][3]) + Math.abs(P[2][3] - P[3][3]));
    return smooth(0.5, 1.3, s);
  }

  // the channelled FROM direction and speed factor at a point for a free-air FROM direction
  steer(x, z, dirDeg) {
    if (!this.heightAt) return { dirDeg, f: 1 };
    const { c, ax, az, narrows } = this.valleyAt(x, z);
    const [vx, vz] = WindField.toward(dirDeg);
    const along = vx * ax + vz * az, cross = -vx * az + vz * ax;
    const ka = 1 + c * (narrows - 1), kc = 1 - c;
    const ox = ax * along * ka - az * cross * kc, oz = az * along * ka + ax * cross * kc;
    const f = Math.hypot(ox, oz);
    return { dirDeg: f > 1e-9 ? Math.atan2(-ox, oz) / DEG : dirDeg, f };
  }

  // ---- lee and crest along the local direction ----
  // the lee factor at a point for a FROM direction: 1 in free air, down to LEE_MIN behind relief within LEE_REACH.
  // Three upwind rays (± 6°, weights ¼ ½ ¼) soften the wake's sides, as a real wake spreads.
  leeAt(x, z, dirDeg) {
    if (!this.heightAt) return 1;
    return 0.25 * this.leeRay(x, z, dirDeg - 6) + 0.5 * this.leeRay(x, z, dirDeg) + 0.25 * this.leeRay(x, z, dirDeg + 6);
  }

  // one ray: the steepest upwind horizon within reach, max (h − h0) / d, relief beyond LEE_FADE weighted down
  leeRay(x, z, dirDeg) {
    const [ux, uz] = WindField.toward(dirDeg);
    const h0 = Math.max(this.height(x, z), 0);
    let m = 0;
    for (const d of LEE_D) m = Math.max(m, (this.height(x - ux * d, z - uz * d) - h0) / d * (1 - smooth(LEE_FADE, LEE_REACH, d)));
    return leeOfSlope(m);
  }

  // the crest speed-up at a point: 1 on the lake, up to 1 + CREST_MAX near a crest. Find the crest along the wind
  // line (climb from the point), its height H over the upwind base and L (crest to half height, upwind), then
  // Δs = min(0.8, 1.6 H / L) × max(0, 1 − |distance to the crest| / (1.5 L)).
  crestAt(x, z, dirDeg, heightAt = (a, b) => this.height(a, b)) {
    if (!this.heightAt) return 1;
    const h0 = heightAt(x, z);
    if (h0 <= 0) return 1;
    const [ux, uz] = WindField.toward(dirDeg), S = CREST_STEP;
    const h = (s) => heightAt(x + ux * s, z + uz * s);               // s: metres downwind of the point
    // climb toward the higher side, looking CREST_LOOK steps ahead so a small bump doesn't stop the climb
    const ahead = (s0, dn) => { let bs = s0, bh = -Infinity; for (let k = 1; k <= CREST_LOOK; k++) { const v = h(s0 + k * dn); if (v > bh) { bh = v; bs = s0 + k * dn; } } return [bs, bh]; };
    let sc = 0, hc = h0;
    const [, up] = ahead(0, S), [, upw] = ahead(0, -S);
    const dn = up > h0 && up >= upw ? S : (upw > h0 ? -S : 0);
    if (dn) while (Math.abs(sc) < CREST_W) { const [bs, bh] = ahead(sc, dn); if (bh <= hc) break; sc = bs; hc = bh; }
    let base = hc;
    for (let d = S; d <= CREST_W; d += S) base = Math.min(base, h(sc - d));
    const H = hc - base;
    if (H <= 0) return 1;
    let L = CREST_W, prev = hc;
    for (let d = S; d <= CREST_W; d += S) {
      const hd = h(sc - d);
      if (hd <= base + H / 2) { L = d - S + S * (prev - (base + H / 2)) / Math.max(prev - hd, 1e-9); break; }
      prev = hd;
    }
    L = Math.max(L, S);
    const k2 = Math.max(0, 1 - Math.abs(sc) / (1.5 * L));
    return 1 + Math.min(CREST_MAX, CREST_K * H / L) * k2;
  }

  // the terrain's factor on the wind at a point for a local FROM direction (direct, uncached): lee × crest
  terrainAt(x, z, dirDeg) {
    return this.heightAt ? this.leeAt(x, z, dirDeg) * this.crestAt(x, z, dirDeg) : 1;
  }

  // one 5° bin of the free-air direction: lattices of lee (50 m) and crest (125 m) along the channelled direction
  bin(k) {
    let b = this.bins.get(k);
    if (!b) {
      const dir = k * BIN;
      b = {
        lee: new Tiles(LEE_CELL, TILE, (x0, z0, cell, n, out) => {
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = x0 + i * cell, z = z0 + j * cell; out[j * n + i] = this.leeAt(x, z, this.steer(x, z, dir).dirDeg); }
        }),
        crest: new Tiles(CREST_CELL, TILE / 2, (x0, z0, cell, n, out) => {
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = x0 + i * cell, z = z0 + j * cell; out[j * n + i] = this.crestAt(x, z, this.steer(x, z, dir).dirDeg); }
        }),
      };
      if (this.bins.size > 96) this.bins.clear();
      this.bins.set(k, b);
    }
    return b;
  }

  // the terrain at a point for one bin: [the local flow's unit vector x, z, channel × lee × crest]
  binAt(k, x, z) {
    const s = this.steer(x, z, k * BIN), b = this.bin(k), [ux, uz] = WindField.toward(s.dirDeg);
    return [ux, uz, s.f * b.lee.at(x, z) * b.crest.at(x, z)];
  }

  // the free-air FROM direction at a point and time: the base plus the shift carried downwind (before the valley)
  dirAt(x, z, t) {
    this.at(t);
    const [ux, uz] = WindField.toward(this.base.dirDeg);
    const along = x * ux + z * uz;                                   // metres downwind of the origin
    if (this.pattern) return this.base.dirDeg + this.pattern.deg(t);   // a race's pattern
    const s = (t - along / Math.max(this.base.speedMs, 2)) / this.shift.periodS;
    const S = this.sailShifts, lw = S ? S.legacyW(t) : 1;
    if (lw >= 1) return this.base.dirDeg + this.shift.deg * this.roughMul(x, z) * wander(s, this.seed + 101)
      + (this.shifts ? this.shifts.deg(x, z, t) : 0);   // pro: the readable shifts (src/wind-shifts.js)
    // Sail's shifts by experience (src/sim/sail-shifts.js), the lake's own eased out while a profile change blends
    const own = lw > 0 ? lw * (this.shift.deg * this.roughMul(x, z) * wander(s, this.seed + 101) + (this.shifts ? this.shifts.deg(x, z, t) : 0)) : 0;
    return this.base.dirDeg + S.deg(x, z, t, this.base.dirDeg) + own;
  }
  roughMul(x, z) { return 1 + ROUGH_GAIN * this.roughAt(x, z); }

  // the gust x terrain factor, limited as a whole: the shift moves the wind between lee bins, which swells the factor
  // too (up to 1.35 at the bay's edge), so the cap is on gust x (ter / ter0) and the speed is ter0 x that
  limit(gust, ter, ter0) {
    if (this.day?.advisory) return gust * ter;   // a forecast gale day keeps its own gusts (35–45 mph on 14–20 mph): the cap is for the levels' days
    return ter0 * gustShape(gust * (ter0 > 1e-6 ? ter / ter0 : 1)); }

  // the gust factor at a point and time (≥ 0), bilinear on the gust grid
  gustAt(x, z, t) { return (this.day?.advisory ? this.gustRaw(x, z, t) : gustShape(this.gustRaw(x, z, t))) * this.firstGustAt(x, z, t); }
  // the factor before the limiter
  gustRaw(x, z, t) {
    this.at(t);
    const G = this.gust.scaleM / 8, fx = x / G, fz = z / G, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const adv = this.advection(t), n = (a, b) => this.gustNoise(a * G, b * G, t, adv);
    const g = (n(i, j) * (1 - u) + n(i + 1, j) * u) * (1 - v) + (n(i, j + 1) * (1 - u) + n(i + 1, j + 1) * u) * v;
    let f = Math.max(0, 1 + this.gust.strength * this.roughMul(x, z) * g);
    // × the 'gust' modifiers (src/wind-modifiers.js: the gust cells) at the point itself, not on the grid
    const M = this.modifiers;
    for (let k = 0; k < M.length; k++) if (M[k].stage === 'gust' && M[k].on(this)) f *= M[k].at(this, x, z, t, adv);
    return f;
  }

  // the gust noise at a grid point: 3 octaves at scaleM and a patch octave, advected with the air, in [−1, 1]
  gustNoise(x, z, t, [ox, oz] = this.advection(t)) {
    const L = this.gust.scaleM;
    const n = fbm3((x - ox) / L, (z - oz) / L, t / this.gust.periodS, this.seed);
    const p = grad3((x - ox) / (L * PATCH_SCALE) + 31.7, (z - oz) / (L * PATCH_SCALE) - 12.3, t / (this.gust.periodS * 3), this.seed + 7);
    return clamp((n + PATCH * p) * GUST_GAIN, -1, 1);
  }

  // how far the air has carried the gusts by time t (m, x and z): base speed × t, or the day's integral
  advection(t) {
    if (!this.day) { const [ux, uz] = WindField.toward(this.base.dirDeg); return [ux * this.base.speedMs * t, uz * this.base.speedMs * t]; }
    const DT = 10, k = Math.floor(t / DT);
    if (k < 0) return [0, 0];
    while (this.advect.length <= k + 1) {
      const i = this.advect.length - 1, d = this.dayAt(this.hourAt((i + 0.5) * DT));
      const [ux, uz] = WindField.toward(d.dirDeg), [px, pz] = this.advect[i];
      const sp = d.speedMs * (this.lv?.scale0 ?? 1);
      this.advect.push([px + ux * sp * DT, pz + uz * sp * DT]);
    }
    const f = t / DT - k, a = this.advect[k], b = this.advect[k + 1];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
  }

  // the free-air direction's two bins and the weight of the upper
  static bins(dirDeg) { const f = dirDeg / BIN, k = Math.floor(f); return [k, f - k]; }

  // m/s at a world point and time
  sample(x, z, t) {
    this.at(t);
    const free = this.dirAt(x, z, t);
    let [ux, uz] = WindField.toward(free), ter = 1, ter0 = 1;
    if (this.heightAt) {
      const [k0, w0] = WindField.bins(this.base.dirDeg);
      ter0 = this.binAt(k0, x, z)[2] * (1 - w0) + this.binAt(k0 + 1, x, z)[2] * w0;   // the terrain factor with no shift
      // the two bins' local flows, blended and normalised (toTexture does the same, in the same order)
      const [k, w] = WindField.bins(free), a = this.binAt(k, x, z), b = this.binAt(k + 1, x, z);
      ux = a[0] * (1 - w) + b[0] * w; uz = a[1] * (1 - w) + b[1] * w;
      const n = Math.hypot(ux, uz) || 1;
      ux /= n; uz /= n;
      ter = a[2] * (1 - w) + b[2] * w;
    }
    let speed = this.baseAt(x, z, t) * this.limit(this.gustRaw(x, z, t), ter, ter0) * this.firstGustAt(x, z, t);
    if (this.sailShifts) speed *= this.sailShifts.gustMul(x, z, t, this.base.dirDeg);   // a big shift's gust line (src/sim/sail-shifts.js)
    // the 'flow' modifiers (src/wind-modifiers.js: the storm's outflow), after the terrain
    const M = this.modifiers;
    let flowed = false;
    for (let k = 0; k < M.length; k++) {
      if (M[k].stage !== 'flow' || !M[k].on(this)) continue;
      if (!flowed) { FLOW[0] = ux * speed; FLOW[1] = uz * speed; flowed = true; }
      M[k].frame(this, t)(FLOW[0], FLOW[1], x, z, FLOW);
    }
    if (flowed) {
      const vx = FLOW[0], vz = FLOW[1], sp = Math.hypot(vx, vz), d = Math.atan2(-vx, vz) / DEG;
      return { vx, vz, speed: sp, dirDeg: ((d % 360) + 360) % 360 };
    }
    const dirDeg = Math.atan2(-ux, uz) / DEG;
    return { vx: ux * speed, vz: uz * speed, speed, dirDeg: ((dirDeg % 360) + 360) % 360 };
  }

  // vx, vz per texel, row-major, rows from north (−z) to south, columns from west to east, texel centres,
  // centred on (cx, cz): sample() at every texel centre. The static parts (the valley, lee and crest per 5° bin, the
  // roughness) are cached per texel; a frame costs the gust grid, the shift and a blend per texel.
  toTexture(sizePx, extentM, t = 0, cx = 0, cz = 0) {
    this.at(t);
    const key = `${sizePx}:${extentM}:${cx}:${cz}`;
    let T = this.tex.get(key);
    const cell = extentM / sizePx;
    if (!T) {
      // refactor round 3 B6b: a centre moved by whole texels (the texture's 512 m snap) shares most texels with the last one:
      // their roughness and bin values are copied from it (the same point, so the same numbers: binAt and roughMul read only
      // the never-evicted terrain caches), the rest computed. A one-snap move cost 177–255 ms of capture frame
      const n = sizePx * sizePx, px = new Float64Array(n), pz = new Float64Array(n), rough = new Float32Array(n);
      let D = null;
      for (const U of this.tex.values()) {
        const di = (cx - U.cx) / cell, dj = (cz - U.cz) / cell;
        if (U.size === sizePx && U.extent === extentM && Number.isInteger(di) && Number.isInteger(dj) && Math.abs(di) < sizePx && Math.abs(dj) < sizePx
          && (!D || Math.abs(di) + Math.abs(dj) < Math.abs(D.di) + Math.abs(D.dj))) D = { U, di, dj };
      }
      if (D) D.U.from = null;   // one level of donors only (no chain of old centres kept alive)
      for (let j = 0; j < sizePx; j++) for (let i = 0; i < sizePx; i++) {
        const p = j * sizePx + i;
        px[p] = cx - extentM / 2 + (i + 0.5) * cell; pz[p] = cz - extentM / 2 + (j + 0.5) * cell;
        const si = D ? i + D.di : -1, sj = D ? j + D.dj : -1;
        rough[p] = si >= 0 && si < sizePx && sj >= 0 && sj < sizePx ? D.U.rough[sj * sizePx + si] : this.roughMul(px[p], pz[p]);
      }
      T = { px, pz, rough, bins: new Map(), cx, cz, size: sizePx, extent: extentM, from: D };
      if (this.tex.size > this.cache.tex) this.tex.clear();
      this.tex.set(key, T);
    }
    const binArr = (k) => {
      let a = T.bins.get(k);
      if (!a) {
        a = new (this.cache.f32 ? Float32Array : Float64Array)(T.px.length * 3);
        const D = T.from, src = D ? D.U.bins.get(k) : null;
        if (src && src.constructor === a.constructor) {
          // the shared block from the donor (the same world points), the rest by binAt
          for (let j = 0; j < sizePx; j++) {
            const sj = j + D.dj, inRow = sj >= 0 && sj < sizePx;
            for (let i = 0; i < sizePx; i++) {
              const p = j * sizePx + i, si = i + D.di;
              if (inRow && si >= 0 && si < sizePx) { const q = 3 * (sj * sizePx + si); a[3 * p] = src[q]; a[3 * p + 1] = src[q + 1]; a[3 * p + 2] = src[q + 2]; }
              else { const r = this.binAt(k, T.px[p], T.pz[p]); a[3 * p] = r[0]; a[3 * p + 1] = r[1]; a[3 * p + 2] = r[2]; }
            }
          }
        } else for (let p = 0; p < T.px.length; p++) { const r = this.binAt(k, T.px[p], T.pz[p]); a[3 * p] = r[0]; a[3 * p + 1] = r[1]; a[3 * p + 2] = r[2]; }
        if (T.bins.size > this.cache.bins) T.bins.clear();
        T.bins.set(k, a);
        if (D && [...D.U.bins.keys()].every((b) => T.bins.has(b))) T.from = null;   // every donor bin taken: let it go
      }
      return a;
    };
    // the gust grid over the texture
    const G = this.gust.scaleM / 8, half = extentM / 2;
    const gi0 = Math.floor((cx - half) / G), gj0 = Math.floor((cz - half) / G);
    const gn = Math.floor((cx + half) / G) - gi0 + 2, gm = Math.floor((cz + half) / G) - gj0 + 2;
    const gg = new Float32Array(gn * gm);
    const adv = this.advection(t);
    for (let j = 0; j < gm; j++) for (let i = 0; i < gn; i++) gg[j * gn + i] = this.gustNoise((gi0 + i) * G, (gj0 + j) * G, t, adv);
    // the 'gust' modifiers per texel (src/wind-modifiers.js: the gust cells, each live cell drawn into its own box)
    const M = this.modifiers, rasters = [];
    for (let k = 0; k < M.length; k++) if (M[k].stage === 'gust' && M[k].on(this)) rasters.push(M[k].raster(this, T, sizePx, extentM / sizePx, t, adv));
    // the shift, as dirAt: the wander depends on the distance downwind only, so it is read from a 1-D table per frame
    const [bx, bz] = WindField.toward(this.base.dirDeg), sp = Math.max(this.base.speedMs, 2);
    const reach = half * (Math.abs(bx) + Math.abs(bz)) + Math.abs(cx * bx + cz * bz) + 2, WS = 2;
    const wn = Math.ceil(2 * reach / WS) + 2, wt = new Float64Array(wn);
    for (let i = 0; i < wn; i++) wt[i] = wander((t - (-reach + i * WS) / sp) / this.shift.periodS, this.seed + 101);
    const out = new Float32Array(sizePx * sizePx * 2), S = this.base.speedMs, str = this.gust.strength, sd = this.shift.deg, bd = this.base.dirDeg;
    let lastK = null, A = null, B = null;
    const [k0, w0] = WindField.bins(bd), A0 = this.heightAt ? binArr(k0) : null, B0 = this.heightAt ? binArr(k0 + 1) : null;
    const pat = this.pattern ? this.pattern.deg(t) : null;   // a race's pattern: the same turn everywhere, no wander
    // Sail's shifts by experience (src/sim/sail-shifts.js), as dirAt: a 1-D table along the wind (the turn and the gust line by
    // s), each texel's ragged offset across the wind; the lake's own shifts scaled by lw while a profile change blends
    const SS = pat == null ? this.sailShifts : null, lw = SS ? SS.legacyW(t) : 1;
    let st = null;
    if (SS) {
      const R = SS.o.rag.m, sn = Math.ceil(2 * (reach + R) / WS) + 2, deg = new Float64Array(sn), gm = new Float64Array(sn);
      for (let i = 0; i < sn; i++) { const s = t - (-reach - R + i * WS) / SS.carry; deg[i] = lw < 1 ? SS.degAtS(s, t) : 0; gm[i] = SS.gustAtS(s, t); }
      st = { R, deg, gm, n: sn };
    }
    const shiftTex = this.shifts && pat == null && lw > 0 ? this.shifts.texture(t, sizePx, extentM, cx, cz) : null;   // pro: the readable shifts (src/wind-shifts.js)
    const fronts = this.lv && this.day && this.lv.fronts.length > 0;   // a level blowing in: the base varies over the texture
    for (let p = 0; p < T.px.length; p++) {
      const x = T.px[p], z = T.pz[p];
      const fa = (x * bx + z * bz + reach) / WS, ia = Math.floor(fa), wa = fa - ia;
      let free, gl = 1;
      if (!st || lw >= 1) free = pat != null ? bd + pat : bd + sd * T.rough[p] * (wt[ia] + (wt[ia + 1] - wt[ia]) * wa) + (shiftTex ? shiftTex[p] : 0);
      if (st) {
        const fs = (x * bx + z * bz + st.R * SS.ragAt(-x * bz + z * bx) + reach + st.R) / WS, is = Math.min(st.n - 2, Math.max(0, Math.floor(fs))), ws = fs - is;
        gl = st.gm[is] + (st.gm[is + 1] - st.gm[is]) * ws;
        if (lw < 1) free = bd + st.deg[is] + (st.deg[is + 1] - st.deg[is]) * ws + (lw > 0 ? lw * (sd * T.rough[p] * (wt[ia] + (wt[ia + 1] - wt[ia]) * wa) + (shiftTex ? shiftTex[p] : 0)) : 0);
      }
      let ux, uz, ter = 1, ter0 = 1;
      if (this.heightAt) {
        const f = free / BIN, k = Math.floor(f), w = f - k;
        if (k !== lastK) { A = binArr(k); B = binArr(k + 1); lastK = k; }
        ux = A[3 * p] * (1 - w) + B[3 * p] * w; uz = A[3 * p + 1] * (1 - w) + B[3 * p + 1] * w;
        const n = Math.hypot(ux, uz) || 1;
        ux /= n; uz /= n;
        ter = A[3 * p + 2] * (1 - w) + B[3 * p + 2] * w;
        ter0 = A0[3 * p + 2] * (1 - w0) + B0[3 * p + 2] * w0;
      } else { ux = -Math.sin(free * DEG); uz = Math.cos(free * DEG); }
      const fx = x / G, fz = z / G, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, q = (j - gj0) * gn + (i - gi0);
      const g = (gg[q] * (1 - u) + gg[q + 1] * u) * (1 - v) + (gg[q + gn] * (1 - u) + gg[q + gn + 1] * u) * v;
      let cf = 1;
      for (let r = 0; r < rasters.length; r++) cf *= rasters[r][p];
      let speed = (fronts ? this.dayMs * this.levelScaleAt(x, z, t) : S) * this.limit(Math.max(0, 1 + str * T.rough[p] * g) * cf, ter, ter0) * (this.first ? this.firstGustAt(x, z, t) : 1);
      if (st) speed *= gl;
      out[2 * p] = ux * speed;
      out[2 * p + 1] = uz * speed;
    }
    // the 'flow' modifiers (the storm's outflow), in order on each texel's vector, as sample() applies them
    const flows = [];
    for (let k = 0; k < M.length; k++) if (M[k].stage === 'flow' && M[k].on(this)) flows.push(M[k].frame(this, t));
    if (flows.length) for (let p = 0; p < T.px.length; p++) {
      FLOW[0] = out[2 * p]; FLOW[1] = out[2 * p + 1];
      for (let k = 0; k < flows.length; k++) flows[k](FLOW[0], FLOW[1], T.px[p], T.pz[p], FLOW);
      out[2 * p] = FLOW[0]; out[2 * p + 1] = FLOW[1];
    }
    return out;
  }

  // World streaming: toTexture()'s per-texel cache for a centre the camera is heading
  // to, built off the main thread (src/bake-worker.js job 'windtex' calls textureCache on its own field) and adopted
  // here before the camera gets there, so crossing a 512 m snap no longer stops a frame for 120–280 ms. The cache
  // holds terrain-only numbers (roughness, and per direction bin the valley, lee and crest), the same functions in
  // the same order as toTexture(): it then reads the same numbers.
  textureCache(sizePx, extentM, cx, cz, bins = this.textureBins()) {
    const n = sizePx * sizePx, cell = extentM / sizePx, px = new Float64Array(n), pz = new Float64Array(n), rough = new Float32Array(n);
    for (let j = 0; j < sizePx; j++) for (let i = 0; i < sizePx; i++) {
      const p = j * sizePx + i;
      px[p] = cx - extentM / 2 + (i + 0.5) * cell; pz[p] = cz - extentM / 2 + (j + 0.5) * cell;
      rough[p] = this.roughMul(px[p], pz[p]);
    }
    const out = [];
    if (this.heightAt) for (const k of bins) {
      const a = new (this.cache.f32 ? Float32Array : Float64Array)(n * 3);
      for (let p = 0; p < n; p++) { const r = this.binAt(k, px[p], pz[p]); a[3 * p] = r[0]; a[3 * p + 1] = r[1]; a[3 * p + 2] = r[2]; }
      out.push([k, a]);
    }
    return { px, pz, rough, bins: out };
  }
  adoptTexture(sizePx, extentM, cx, cz, c) {
    const key = `${sizePx}:${extentM}:${cx}:${cz}`;
    let T = this.tex.get(key);
    if (!T) {
      if (this.tex.size > this.cache.tex) this.tex.delete(this.tex.keys().next().value);   // the oldest, not the one in use
      T = { px: c.px, pz: c.pz, rough: c.rough, bins: new Map() };
      this.tex.set(key, T);
    }
    for (const [k, a] of c.bins) if (!T.bins.has(k)) { if (T.bins.size > this.cache.bins) T.bins.clear(); T.bins.set(k, a); }
  }
  // the direction bins toTexture() can read now: the base direction ± the shift at its roughest (× 1.6)
  textureBins() {
    const SS = this.sailShifts, own = Math.abs(this.shift.deg) * (1 + ROUGH_GAIN);
    const bd = this.base.dirDeg, sd = this.pattern ? Math.abs(this.pattern.maxDeg ?? 0) : SS ? SS.maxDeg() + (SS.legacyW(this.clockT ?? 0) > 0 ? own : 0) : own;
    const out = []; for (let k = Math.floor((bd - sd) / BIN); k <= Math.floor((bd + sd) / BIN) + 1; k++) out.push(k);
    return out;
  }
  // is the cache for this centre complete (texels and the bins in reach)?
  texturePrepared(sizePx, extentM, cx, cz) {
    const T = this.tex.get(`${sizePx}:${extentM}:${cx}:${cz}`);
    return !!T && (!this.heightAt || this.textureBins().every((k) => T.bins.has(k)));
  }
}

// the lee factor for the steepest upwind horizon slope m = max (h − h0) / d: r = 1 / m is the distance in ridge
// heights; LEE_MIN within 10 H, smoothstep back to 1 by 40 H
function leeOfSlope(m) {
  if (m <= 0) return 1;
  const r = 1 / m;
  if (r >= LEE_FULL + LEE_RECOVER) return 1;
  const k = r <= LEE_FULL ? 0 : (r - LEE_FULL) / LEE_RECOVER;
  return LEE_MIN + (1 - LEE_MIN) * k * k * (3 - 2 * k);
}
