// The VHF weather forecast (owner, 2026-10-29): what a skipper hears on the weather channel, written from the game's
// own wind (src/wind.js), so it is honest: the range is the bay's sampled wind over the next hour, the gusts its top,
// the fade is said when the model fades, an advisory when the day is one or the numbers meet the criteria.
// Plain JS, no three.js and no DOM (tests/vhf.test.mjs).
//
//   const f = forecastFor({ wind, t, terrain });   // t: scene time now (the wind's clock); terrain: heightAt, shoreDistance
//   f.text     "Lake forecast for this evening. Southwest wind 13 to 17 knots, gusts to 22, easing after sunset. …"
//   f.tokens   [{ id, say }, …] or { pause } entries: the voice clips (audio/vhf/forecast.json), in order
//   f.facts    the numbers behind it (the samples' range, the means, the trend, the advisory)
//
// Words: generic places only ("the lake", "the bay", "the points"), no real station names.
// The voice: a fixed vocabulary (VOCAB) pre-rendered offline by a local Kokoro-82M (tools/vhf_voice.py), so every
// forecast the model can produce has its clips; the clips join with short gaps, the way the weather radio's own
// synthetic voice joins its words.
import { advisoryWeight, WIND_LEVELS } from '../sim/wind.js';
import { significantHeight, fetchTrace } from '../sim/water-spectrum.js';
import { analyticSun } from '../sim/timeOfDay.js';
import { CURRENT_WATERS } from '../sim/waters/current.js';

const KT = 0.514444, DEG = Math.PI / 180;
export const FORECAST = {
  aheadH: 1,            // the range: the next hour
  steps: 7,             // samples over it (every 10 min)
  laterH: [1.5, 2.5],   // the trend: the mean over this window against the next hour's
  ease: 0.75, rise: 1.33, trendMinKn: 5,
  lightKn: 5,           // a top under this: "variable wind, 5 knots or less"
  gustOverKn: 4,        // gusts are said when the gust is this far over the range's top
  rangeQ: [0.25, 0.75], // the range: the samples' middle half (the sustained wind across the bay), rounded out
  gustQ: 0.98,          // the gusts: this quantile of the samples (the top 2 %: a gust a sailor meets in the hour)
  shiftQ: 0.9,          // the shifts: this quantile of |shift| over the open bay, rounded up to 5°
  minSpanKn: 4,         // the range at least this wide (13 to 17, not 15 to 15)
  // a lake wind advisory: the day is one (wind.js advisory, its weight over half), or sustained ≥ 20 mph (17.4 kn,
  // the median sample) or gusts ≥ 30 mph (26 kn): the criteria the lake's forecast office uses (our reading)
  advisory: { weight: 0.5, sustainedKn: 17.4, gustKn: 26, gustMinHiKn: 15 },
  // the waves in the bay: Hs from the growth law (water-spectrum.js) at the range's top over the bay's fetch, in feet
  wavesFt: [1, 2, 3, 4],
};

// The vocabulary: id → the words spoken. Numbers n1 … n45 are added below.
const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty'];
const numberWords = (n) => (n < 20 ? NUM[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + NUM[n % 10] : ''));
export const DIRS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
export const VOCAB = {
  hdr: 'Lake forecast for',
  morning: 'this morning', afternoon: 'this afternoon', evening: 'this evening', tonight: 'tonight',
  ...Object.fromEntries(DIRS.map((d) => [`w_${d}`, `${d[0].toUpperCase()}${d.slice(1)} wind`])),
  variable: 'Variable wind', fiveless: 'five knots or less',
  to: 'to', knots: 'knots', gusts: 'gusts to',
  ease_sunset: 'easing after sunset', ease_tonight: 'easing tonight', ease_later: 'easing later', rise_later: 'increasing later',
  waves1: 'Waves one foot or less', waves2: 'Waves one to two feet', waves3: 'Waves two to three feet', waves4: 'Waves three to four feet',
  inbay: 'in the bay',
  shifts: 'Shifts up to', degrees: 'degrees', points: 'more near the points',
  adv_on: 'A lake wind advisory is in effect.', adv_off: 'A lake wind advisory is not in effect.',
  ...Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`n${i + 1}`, numberWords(i + 1)])),
};
// what the LCD prints for a clip (the radio's own short forms)
const SHOW = { ...Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`n${i + 1}`, String(i + 1)])),
  waves1: 'Waves 1 foot or less', waves2: 'Waves 1 to 2 feet', waves3: 'Waves 2 to 3 feet', waves4: 'Waves 3 to 4 feet', fiveless: '5 knots or less' };

import { clampT as clamp } from '../sim/core/math.js';
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
export const dirName = (fromDeg) => DIRS[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
export function windowOf(hour) {
  const h = ((hour % 24) + 24) % 24;
  return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 21.5 ? 'evening' : 'tonight';
}

// The scene time at which the wind's clock reads `hour` (bisection: the clock only runs forward)
export function timeAtHour(wind, hour, t0 = 0) {
  if (!wind.day) return t0 + (hour - 0) * 3600;
  const h0 = wind.hourAt(t0);
  if (hour <= h0) return t0;
  let a = t0, b = t0 + 60;
  for (let i = 0; i < 40 && wind.hourAt(b) < hour; i++) b = t0 + (b - t0) * 2;
  for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (wind.hourAt(m) < hour) a = m; else b = m; }
  return (a + b) / 2;
}

// The open bay's sample points (the wind's bay box, wind.bay: the lake profile's windBay, the box the level is set on,
// water deeper than 20 m)
export function bayPoints(heightAt, BAY = CURRENT_WATERS.windBay) {
  const pts = [];
  for (let z = BAY.z0; z <= BAY.z1; z += BAY.dz) for (let x = BAY.x0; x <= BAY.x1; x += BAY.dx) if (!heightAt || heightAt(x, z) < BAY.deep) pts.push([x, z]);
  return pts;
}

// The wind over the bay between two hours, one time step per call of the generator (a live page spreads the
// forecast's ≈ 20–40 ms over frames): every sample's speed (kn), the vector-mean direction, |shift| per sample
function* sampleBaySteps(wind, { t, h0, h1, steps, points }, out = { kn: [], when: [], shifts: [], vx: 0, vz: 0 }) {
  for (let i = 0; i < steps; i++) {
    const h = h0 + (h1 - h0) * (steps > 1 ? i / (steps - 1) : 0), ts = wind.day ? timeAtHour(wind, h, t) : t + (h - h0) * 3600;
    for (const [x, z] of points) {
      const s = wind.sample(x, z, ts);
      out.kn.push(s.speed / KT); out.when.push(h); out.vx += s.vx; out.vz += s.vz;
      if (wind.shifts) out.shifts.push(Math.abs(wind.shifts.deg(x, z, ts)));
    }
    wind.at?.(t);   // back to now after each step (sampling ahead moves the field's base, which the water reads)
    yield i;
  }
  out.fromDeg = ((Math.atan2(-out.vx, out.vz) / DEG) + 360) % 360;
  out.mean = out.kn.reduce((a, b) => a + b, 0) / Math.max(1, out.kn.length);
  return out;
}
export function sampleBay(wind, o) { const g = sampleBaySteps(wind, o); let r; do r = g.next(); while (!r.done); return r.value; }

// The forecast as a job: each next() samples one time step; the last returns the forecast (forecastFor below runs it
// whole). wind: the WindField; t: scene time now; terrain: { heightAt, shoreDistance } (optional: without it the
// bay's box is sampled whole and the waves use a 2 km fetch). The field is back at t after every step.
export function* forecastJob({ wind, t = 0, terrain = null, opts = FORECAST } = {}) {
  const O = { ...FORECAST, ...opts };
  const hour = wind.day ? wind.hourAt(t) : 12;
  const points = bayPoints(terrain?.heightAt, wind.bay ?? terrain?.waters?.windBay);
  const next = yield* sampleBaySteps(wind, { t, h0: hour, h1: hour + O.aheadH, steps: O.steps, points });
  const later = yield* sampleBaySteps(wind, { t, h0: hour + O.laterH[0], h1: hour + O.laterH[1], steps: 3, points });
  return compose(wind, O, hour, next, later, terrain);
}
export function forecastFor(o = {}) { const g = forecastJob(o); let r; do r = g.next(); while (!r.done); return r.value; }

function compose(wind, O, hour, next, later, terrain) {
  let lo = Math.floor(quantile(next.kn, O.rangeQ[0])), hi = Math.ceil(quantile(next.kn, O.rangeQ[1]));
  if (hi - lo < O.minSpanKn) { const m = (lo + hi) / 2; lo = Math.floor(m - O.minSpanKn / 2); hi = lo + O.minSpanKn; }
  lo = clamp(lo, 1, 44); hi = clamp(hi, lo + 1, 45);
  const top = Math.max(...next.kn), gust = Math.round(quantile(next.kn, O.gustQ));
  const light = hi <= O.lightKn;
  // the trend: the model's own mean 1.5–2.5 h ahead against the next hour's
  const ratio = later.mean / Math.max(next.mean, 0.1);
  let trend = null;
  if (next.mean >= O.trendMinKn && ratio < O.ease) {
    const elev = (h) => Math.asin(analyticSun(h).y) / DEG;
    const setsSoon = elev(hour) > 0 && elev(hour + O.laterH[1]) <= 0;
    trend = setsSoon ? 'ease_sunset' : elev(hour) <= 0 ? 'ease_tonight' : 'ease_later';
  } else if (later.mean >= O.trendMinKn && ratio > O.rise) trend = 'rise_later';
  // waves: the growth law at the range's top over the bay's fetch (the bay's middle, upwind to the shore)
  const fetch = terrain?.shoreDistance ? Math.max(200, fetchTrace(terrain.shoreDistance, 550, -650, next.fromDeg, 8000)) : 2000;
  const hsFt = significantHeight(hi * KT, fetch) / 0.3048;
  const waves = hsFt <= O.wavesFt[0] ? 'waves1' : hsFt <= O.wavesFt[1] ? 'waves2' : hsFt <= O.wavesFt[2] ? 'waves3' : 'waves4';
  const A = O.advisory, median = quantile(next.kn, 0.5);
  const dayAdv = !!wind.day?.advisory && advisoryWeight(hour) > A.weight;
  const advisory = dayAdv || median >= A.sustainedKn || (gust >= A.gustKn && hi >= A.gustMinHiKn);
  const shiftDeg = next.shifts.length ? clamp(Math.ceil(quantile(next.shifts, O.shiftQ) / 5) * 5, 5, 30) : 0;

  // the words
  const tk = [];
  const say = (...ids) => { for (const id of ids) tk.push({ id, say: VOCAB[id], show: SHOW[id] ?? VOCAB[id] }); };
  const pause = (p) => tk.push({ pause: p });
  say('hdr', windowOf(hour)); pause('.');
  if (light) { say('variable'); pause(','); say('fiveless'); }
  else {
    say(`w_${dirName(next.fromDeg)}`, `n${lo}`, 'to', `n${hi}`, 'knots');
    if (gust >= hi + O.gustOverKn) { pause(','); say('gusts', `n${clamp(gust, 1, 45)}`); }
  }
  if (trend) { pause(','); say(trend); }
  pause('.');
  say(waves, 'inbay'); pause('.');
  if (shiftDeg && !light) { say('shifts', `n${shiftDeg}`, 'degrees'); pause(','); say('points'); pause('.'); }
  say(advisory ? 'adv_on' : 'adv_off');
  const text = tk.map((x) => (x.pause ? x.pause : ' ' + x.show)).join('').replace(/\.\./g, '.').trim();
  return {
    text, tokens: tk,
    facts: { hour, window: windowOf(hour), level: wind.level ?? null, levelKn: wind.level ? WIND_LEVELS[wind.level - 1].kn : null,
      lo, hi, gust, top, mean: next.mean, laterMean: later.mean, ratio, trend, fromDeg: next.fromDeg, dir: dirName(next.fromDeg),
      samples: next.kn, wavesFt: hsFt, fetch, advisory, dayAdvisory: dayAdv, shiftDeg, light },
  };
}
