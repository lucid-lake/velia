// node --test tests/vhf.test.mjs — the VHF forecast (src/vhf/forecast.js) against the wind model it reads: across the
// levels and the hours the range brackets the bay's sampled wind for the next hour, the fade is said when the model
// fades, the advisory day says so; every word has a voice clip; the radio's timeline and the LCD's line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WindField, WIND_LEVELS } from '../src/sim/wind.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { forecastFor, forecastJob, VOCAB, dirName, windowOf, timeAtHour, sampleBay, bayPoints, FORECAST } from '../src/vhf/forecast.js';
import { planTokens, chatterEnvelope, RADIO } from '../src/vhf/radio.js';
import { lcdView } from '../classic/src/boat/vhf.js';

const terrain = makeTerrain({ seed: 1 });
const field = (o) => { const w = new WindField({ seed: 1, ...o }); w.setTerrain(terrain.heightAt); return w; };
const HOURS = [9, 16, 18.75, 19.8];

test('the forecast brackets the bay’s sampled wind for the next hour, at every level and hour', () => {
  for (const level of [1, 2, 3, 4]) for (const hour of HOURS) {
    const w = field({ day: { hour, rate: 10 }, level, shifts: true });
    const f = forecastFor({ wind: w, t: 0, terrain });
    // an independent sample of the same hour (other times inside it): its mean inside the stated range
    const pts = bayPoints(terrain.heightAt).filter((_, i) => i % 3 === 1);
    const s = sampleBay(w, { t: 0, h0: hour + 0.05, h1: hour + 0.95, steps: 5, points: pts });
    const { lo, hi, light } = f.facts;
    if (light) assert.ok(s.mean <= FORECAST.lightKn + 1, `L${level} ${hour}: "5 knots or less" but the bay blows ${s.mean.toFixed(1)} kn`);
    else {
      assert.ok(s.mean >= lo && s.mean <= hi, `L${level} ${hour}: ${lo}–${hi} kn, the bay ${s.mean.toFixed(1)} kn`);
      assert.match(f.text, new RegExp(`${lo} to ${hi} knots`));
      const inside = s.kn.filter((k) => k >= lo - 1 && k <= hi + 1).length / s.kn.length;
      assert.ok(inside > 0.4, `L${level} ${hour}: only ${(inside * 100).toFixed(0)} % of samples in ${lo}–${hi}`);
    }
    // the direction: the day's southwesterly in the evening, the down-valley drift from the north in the morning
    if (hour >= 16 && !light) assert.match(f.facts.dir, /south/);
    if (hour === 9 && !light) assert.match(f.facts.dir, /north/);
  }
});

test('the level shows: at 18:45 the stated range covers the level’s band middle', () => {
  for (const level of [2, 3, 4]) {
    const f = forecastFor({ wind: field({ day: { hour: 18.75, rate: 10 }, level }), t: 0, terrain });
    const mid = WIND_LEVELS[level - 1].meanKn;
    assert.ok(f.facts.lo <= mid + 1 && f.facts.hi >= mid - 1, `L${level}: ${f.facts.lo}–${f.facts.hi} vs the band's ${mid}`);
  }
  const a = forecastFor({ wind: field({ day: { hour: 18.75, rate: 10 }, level: 1 }), t: 0, terrain }).facts;
  const b = forecastFor({ wind: field({ day: { hour: 18.75, rate: 10 }, level: 4 }), t: 0, terrain }).facts;
  assert.ok(b.lo > a.hi, `level 4 (${b.lo}–${b.hi}) above level 1 (${a.lo}–${a.hi})`);
});

test('the fade is said exactly when the model fades (the mean 1.5–2.5 h ahead under 75 % of the next hour’s)', () => {
  let said = 0, quiet = 0;
  for (const level of [1, 2, 3, 4]) for (const hour of [16, 17.5, 18.75, 19.5, 19.8, 20.3]) {
    const f = forecastFor({ wind: field({ day: { hour, rate: 10 }, level }), t: 0, terrain });
    const fades = f.facts.mean >= FORECAST.trendMinKn && f.facts.ratio < FORECAST.ease;
    assert.equal(/easing/.test(f.text), fades, `L${level} ${hour}: ratio ${f.facts.ratio.toFixed(2)}, "${f.text}"`);
    if (fades) { said++; if (hour >= 18 && hour < 20.4) assert.match(f.text, /easing after sunset/, `L${level} ${hour}: the sun sets inside the window`); } else quiet++;
  }
  assert.ok(said >= 4 && quiet >= 4, `both cases met: ${said} easing, ${quiet} not`);
  // the hold: at 16:00 the level's breeze holds through the next hours (no easing at level 3)
  assert.doesNotMatch(forecastFor({ wind: field({ day: { hour: 16, rate: 10 }, level: 3 }), t: 0, terrain }).text, /easing/);
});

test('the advisory: in effect on the model’s advisory day, not on an ordinary level-3 evening', () => {
  const adv = forecastFor({ wind: field({ day: { hour: 16, rate: 10, advisory: true } }), t: 0, terrain });
  assert.match(adv.text, /A lake wind advisory is in effect\./);
  assert.ok(adv.facts.dayAdvisory);
  const calm = forecastFor({ wind: field({ day: { hour: 18.75, rate: 10 }, level: 2 }), t: 0, terrain });
  assert.match(calm.text, /A lake wind advisory is not in effect\./);
  // the morning of an advisory day is not yet one
  assert.match(forecastFor({ wind: field({ day: { hour: 8, rate: 10, advisory: true } }), t: 0, terrain }).text, /is not in effect/);
});

test('the words: generic places, the hour’s window, a clip for every token, sampling leaves the field at now', () => {
  for (const hour of [7, 13, 18.75, 23]) assert.equal(forecastFor({ wind: field({ day: { hour, rate: 10 }, level: 3 }), t: 0, terrain }).facts.window, windowOf(hour));
  assert.equal(windowOf(18.75), 'evening'); assert.equal(windowOf(9), 'morning'); assert.equal(windowOf(23), 'tonight');
  assert.equal(dirName(225), 'southwest'); assert.equal(dirName(359), 'north'); assert.equal(dirName(95), 'east');
  const clips = JSON.parse(readFileSync(new URL('../audio/vhf/forecast.json', import.meta.url))).clips;
  for (const id of Object.keys(VOCAB)) assert.ok(clips[id], `no clip for ${id}`);
  const w = field({ day: { hour: 18.75, rate: 10 }, level: 3, shifts: true });
  w.at(0); const before = w.base.speedMs;
  const f = forecastFor({ wind: w, t: 0, terrain });
  assert.equal(w.base.speedMs, before, 'the field is back at now (the water reads base)');
  for (const tk of f.tokens) if (!tk.pause) assert.ok(VOCAB[tk.id] && clips[tk.id], tk.id);
  assert.doesNotMatch(f.text, /Tahoe|Emerald|Reno|NOAA/);
  assert.match(f.text, /^Lake forecast for this evening\. \w+ wind \d+ to \d+ knots/);
  // the job form: one time step per next(), the same forecast
  const g = forecastJob({ wind: field({ day: { hour: 18.75, rate: 10 }, level: 3, shifts: true }), t: 0, terrain });
  let n = 0, r; do { r = g.next(); n++; } while (!r.done);
  assert.equal(n, FORECAST.steps + 3 + 1); assert.equal(r.value.text, f.text);
});

test('timeAtHour inverts the field’s clock', () => {
  const w = field({ day: { hour: 18, rate: 10 }, level: 3 });
  const t = timeAtHour(w, 19.25, 0);
  assert.ok(Math.abs(w.hourAt(t) - 19.25) < 1e-6 && Math.abs(t - 450) < 0.01, `t ${t}`);
});

test('the radio: the plan lays the clips end to end with the pauses; the murmur has syllables and breaths', () => {
  const f = forecastFor({ wind: field({ day: { hour: 18.75, rate: 10 }, level: 3 }), t: 0, terrain });
  const clips = JSON.parse(readFileSync(new URL('../audio/vhf/forecast.json', import.meta.url))).clips;
  const p = planTokens(f.tokens, clips);
  assert.equal(p.items.length, f.tokens.filter((t) => !t.pause).length);
  for (let i = 1; i < p.items.length; i++) assert.ok(p.items[i].at >= p.items[i - 1].at + p.items[i - 1].dur + RADIO.gapS - 1e-9);
  assert.ok(p.dur > 8 && p.dur < 40, `${p.dur.toFixed(1)} s`);
  const env = chatterEnvelope(3, 2.5);
  const peaks = env.filter((v, i) => i > 0 && i < env.length - 1 && v > env[i - 1] && v >= env[i + 1] && v > 0.3).length;
  assert.ok(peaks >= 7 && peaks <= 18, `${peaks} syllables in 2.5 s`);
  assert.ok(env.some((v) => v === 0), 'gaps between syllables');
});

test('the LCD: the channel, RX while receiving, the words scrolling with the voice', () => {
  assert.deepEqual(lcdView({}), { big: '16', tag: '', line: '' });
  const text = 'Lake forecast for this evening. Southwest wind 13 to 17 knots.';
  const a = lcdView({ channel: 'WX 1', text, charAt: 4, rx: true }), b = lcdView({ channel: 'WX 1', text, charAt: 47, rx: true });
  assert.equal(a.big, 'WX 1'); assert.equal(a.tag, 'RX');
  assert.match(a.line, /^LAKE/); assert.match(b.line, /WIND/);
  assert.equal(a.line.length, 14);
});
