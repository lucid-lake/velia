// The low sun's horizon haze and glow (feat/v2-look-ponlai; render/sky.js DUSK): on only with the sun low
// (the golden hour and the dusk), the day and the night untouched; in the sky draw and the far water's tint
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUSK, duskShare, SKY_DRAW_WGSL, SKY_READ } from '../render/sky.js';
import { wgslStruct } from '../engine/uniforms.js';
import { FULLSCREEN } from '../render/shaders.js';

test('the share: whole from just under the sunset to 6°, none by day or by night', () => {
  for (const e of [90, 45, 20, 12.5]) assert.equal(duskShare(e), 0, `day ${e}°`);
  for (const e of [-6.5, -10, -30]) assert.equal(duskShare(e), 0, `night ${e}°`);
  for (const e of [-1.5, 0, 2, 6]) assert.equal(duskShare(e), 1, `low sun ${e}°`);
  assert.ok(duskShare(9) > 0 && duskShare(9) < 1, 'the golden hour eases in');
  assert.ok(duskShare(-4) > 0 && duskShare(-4) < 1, 'the blue hour eases out');
});

test('a band of pink-lavender, a warm glow: the colours lean as named and stay a share', () => {
  const [r, g, b] = DUSK.pink; assert.ok(r > b && b > g, 'pink-lavender: red over blue over green');
  const [wr, wg, wb] = DUSK.warm; assert.ok(wr > wg && wg > wb, 'warm');
  assert.ok(DUSK.band + DUSK.bandAnti <= 1, 'the band never replaces the sky');
  assert.ok(DUSK.bandH > 0 && DUSK.bandH < 0.3, 'low over the horizon');
});

test('the sky draw lays it on after the polariser; the shared sky read carries it for the water', () => {
  const draw = SKY_DRAW_WGSL(wgslStruct(), FULLSCREEN);
  assert.ok(draw.indexOf('c = duskGlow(d, c);') > draw.indexOf('c = polarSky(c);'));
  assert.match(SKY_READ, /fn duskGlow\(d: vec3f, c: vec3f\) -> vec3f/);
  assert.match(SKY_READ, /if \(w <= 0\.0\) \{ return c; \}/);
});
