// The night's Purkinje shift (feat/v2-look-ponlai): render/purkinje.js's model and v2/sim/night.js's amount
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purkinjeShift, PURKINJE_WGSL } from '../render/purkinje.js';
import { PURKINJE, purkinjeAmount, purkinjeScale, nightLevels } from '../sim/night.js';

const S = purkinjeScale(), A = PURKINJE.strength;
const rel = (c, o, i) => (o[i] - c[i]) / c[i];

test('by day nothing moves: amount 0 is the colour itself, and the day\'s levels give amount 0', () => {
  assert.deepEqual(purkinjeShift([0.2, 0.3, 0.4], S, 0), [0.2, 0.3, 0.4]);
  assert.equal(purkinjeAmount(nightLevels({ sunElevDeg: 30 })), 0);
  assert.equal(purkinjeAmount(nightLevels({ sunElevDeg: 2 })), 0);
});

test('at night the dark tones lift toward blue, the bright ones barely', () => {
  const dark = [0.01, 0.01, 0.01], bright = [0.8, 0.8, 0.8];
  const d = purkinjeShift(dark, S, A), b = purkinjeShift(bright, S, A);
  assert.ok(d[2] > dark[2] && d[2] - dark[2] > d[0] - dark[0], 'blue lifts most');
  assert.ok(rel(dark, d, 2) > 3 * rel(bright, b, 2), `dark ${rel(dark, d, 2)} vs bright ${rel(bright, b, 2)}`);
  assert.ok(rel(bright, b, 2) < 0.1, 'a lit white keeps its colour');
  for (const v of d.concat(b)) assert.ok(v >= 0);
});

test('a slight lift: a dark grey\'s luminance rises under a fifth', () => {
  const c = [0.02, 0.02, 0.02], o = purkinjeShift(c, S, A);
  const Y = (x) => 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
  assert.ok(Y(o) > Y(c) && Y(o) < 1.2 * Y(c), `${Y(c)} → ${Y(o)}`);
});

test('the amount: full by night, less under a full moon high, never over the strength', () => {
  const night = nightLevels({ sunElevDeg: -20, moonAltDeg: -30, moonLit: 0 });
  assert.equal(purkinjeAmount(night), A);
  const moon = nightLevels({ sunElevDeg: -20, moonAltDeg: 60, moonLit: 1 });
  assert.ok(purkinjeAmount(moon) < A && purkinjeAmount(moon) >= A * (1 - PURKINJE.moon) - 1e-9);
  assert.ok(A > 0 && A <= 0.05, 'subtle');
});

test('the shader carries the same function', () => {
  assert.match(PURKINJE_WGSL, /fn purkinje\(c: vec3f, scale: f32, amount: f32\) -> vec3f/);
  assert.match(PURKINJE_WGSL, /inverseSqrt/);
});
