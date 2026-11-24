// The new top bar's pure parts (v2/ui/topBar.js): the flag, the pill's words, the compass, the sun strip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newBarOn, condWords, compass8, sunPoint, SUN, BAR_ORDER, PARKED, fwMark, SEG_NAMES } from '../ui/topBar.js';
import { SHOW_START_HOUR } from '../../src/features/timeRows.js';
import { parseV2Flags, V2_ROWS } from '../engine/flags.js';

test('the new bar is the default; ?bar=old keeps the old bar for one release', () => {
  for (const q of ['', '?mode=sail', '?mode=cruise&seed=1', '?bar=new', '?bar=1']) assert.equal(newBarOn(q), true, q);
  for (const q of ['?bar=old', '?mode=cruise&bar=old&seed=1']) assert.equal(newBarOn(q), false, q);
  assert.ok(V2_ROWS.some((r) => r.name === 'bar'), 'a row of v2\'s flag table');
  assert.equal(parseV2Flags('?bar=old').bar, 'old');
});

test('the pill says the time and the wind as a sailor does', () => {
  const w = condWords({ hour: 14.3, kn: 14.6, fromDeg: 205 });
  assert.equal(w.time, '14:18');
  assert.equal(w.wind, '15 kn SW');
  assert.match(w.label, /^Conditions · 14:18 · 15 kn SW$/);
  assert.equal(condWords({ hour: 9.5 }).wind, '', 'no wind reading: the time alone');
  assert.equal(condWords({ hour: 9.5, kn: 8 }).wind, '8 kn', 'no direction: the speed alone');
  assert.equal(condWords({}).time, '');
});

test('compass8 rounds to the nearest of eight points, wrapping', () => {
  assert.deepEqual([0, 22, 23, 90, 180, 200, 270, 337, 338, 360, -45].map(compass8), ['N', 'N', 'NE', 'E', 'S', 'S', 'W', 'NW', 'N', 'N', 'NW']);
});

test('the sun strip: up between rise and set, highest at the middle of the day, below the horizon at night', () => {
  const noon = sunPoint((SUN.rise + SUN.set) / 2), early = sunPoint(SUN.rise + 1), night = sunPoint(23);
  assert.ok(noon.up && early.up && !night.up);
  assert.ok(noon.y < early.y, 'higher (smaller y) at midday');
  assert.ok(night.y > early.y, 'the moon sits under the horizon line');
  assert.ok(sunPoint(0).x < sunPoint(12).x && sunPoint(12).x < sunPoint(23.9).x, 'left to right through the day');
});

test('the order and the parked buttons', () => {
  assert.deepEqual(BAR_ORDER.sail, ['menu', 'fullscreen', 'mode', 'view', 'cond']);
  assert.deepEqual(BAR_ORDER.cruise, ['menu', 'fullscreen', 'mode', 'views', 'cond']);
  for (const p of ['settings', 'sound', 'wind', 'weather', 'clock', 'take', 'locker']) assert.ok(PARKED.includes(p), p);
});

test('the fireworks marker sits on the strip at the show\'s time, in the night after sunset, and names it', () => {
  const m = fwMark();
  assert.equal(m.time, '21:44');
  assert.equal(m.label, 'Fireworks 21:44');
  assert.ok(Math.abs(m.x - sunPoint(SHOW_START_HOUR).x) < 1e-9 && m.x > sunPoint(SUN.set).x, 'after sunset, at its hour');
  assert.ok(m.pct > 80 && m.pct < 95, `on the strip's right (${m.pct.toFixed(1)} %)`);
});

test('the time segments say short words, so four sit as equal parts of one bar', () => {
  assert.equal(SEG_NAMES.golden, 'Golden');
});
