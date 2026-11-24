// The far water's sky tint (feat/v2-look-ponlai; render/water.js WATER_FAR): past `near` m the deep body leans
// toward the sky's hue over the horizon ahead, the navy near the boat kept; the lite water (a phone, L2-L3) has none
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATER_FAR, WATER_DRAW_WGSL } from '../render/water.js';
import { wgslStruct } from '../engine/uniforms.js';

test('the tint starts past the near water and stays a share, never the whole body', () => {
  assert.ok(WATER_FAR.near >= 200, 'the navy near the boat kept');
  assert.ok(WATER_FAR.far > WATER_FAR.near);
  assert.ok(WATER_FAR.k > 0 && WATER_FAR.k <= 0.5, 'subtle');
  assert.ok(WATER_FAR.up > 0 && WATER_FAR.up < 0.2, 'the sky just over the horizon');
});

test('the full water carries the tint, the lite water none', () => {
  const fs = wgslStruct();
  assert.match(WATER_DRAW_WGSL(fs, null, false), /let farSky = 0\.\d+ \* smoothstep/);
  assert.doesNotMatch(WATER_DRAW_WGSL(fs, null, true), /let farSky = 0\.\d+ \* smoothstep/);
});
