// M5d: the island ground's look (v2/render/terrain.js): v1's granite relief constants and the rock's local look match,
// and the forest's shrub shape (v2/render/forest.js): v1's manzanita colour family, a mound as wide as the frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RELIEF, ROCK_LOOK, NOISE_WGSL } from '../render/terrain.js';
import { SHAPES } from '../render/forest.js';

test('the granite relief: v1\'s band (150–500 m) and a gain under v1\'s 0.32 (a value noise\'s gradient runs steeper than Perlin\'s)', () => {
  assert.equal(RELIEF.nearM, 150); assert.equal(RELIEF.farM, 500);
  assert.ok(RELIEF.k > 0 && RELIEF.k <= 0.32, `gain ${RELIEF.k}`);
  // the 3-D noise the relief reads and its two-octave field are in the shared noise WGSL (the terrain draw and the bake include it)
  assert.ok(NOISE_WGSL.includes('fn vnoise3(') && NOISE_WGSL.includes('fn reliefF('), 'vnoise3 and reliefF');
  assert.ok(NOISE_WGSL.includes('0.4 * vnoise3(q * 3.3)'), 'v1\'s second octave: 0.4 × the noise at 3.3×');
});

test('the rock look: a lift toward v1\'s cool lichen grey on the photo\'s bare rock, nothing darker, blue the most, red the least', () => {
  assert.equal(ROCK_LOOK.length, 3);
  for (const c of ROCK_LOOK) assert.ok(c >= 1 && c <= 2, `a lift, not a cut: ${c}`);
  assert.ok(ROCK_LOOK[2] > ROCK_LOOK[1] && ROCK_LOOK[1] > ROCK_LOOK[0], 'cooler: blue > green > red');
  // the fit's target: cam I's rock mean, v1 (0.127, 0.131, 0.099) over v2 (0.098, 0.089, 0.058) in linear light, within 10 %
  const target = [0.1273 / 0.0977, 0.1306 / 0.0889, 0.0994 / 0.0578];
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(ROCK_LOOK[c] / target[c] - 1) < 0.1, `channel ${c}: ${ROCK_LOOK[c]} against the measured ${target[c].toFixed(3)}`);
});

test('the shrub shape: v1\'s manzanita colour family (grey-olive, green over red over blue), the mound fills its frame, as wide as tall', () => {
  const s = SHAPES.find((x) => x.id === 'shrub');
  assert.equal(s.kind, 4);
  assert.ok(s.needle[1] > s.needle[0] && s.needle[0] > s.needle[2], 'olive: G > R > B');
  // v1's leaf colour (src/forest/species.js manzanita 0.105, 0.138, 0.066) in hue: the ratios within 10 %
  assert.ok(Math.abs(s.needle[0] / s.needle[1] - 0.105 / 0.138) < 0.1 * 0.76 && Math.abs(s.needle[2] / s.needle[1] - 0.066 / 0.138) < 0.1 * 0.48, 'v1\'s hue');
  assert.ok(s.rho === 1.0 && s.R >= s.rho, 'the frame holds the mound');
});
