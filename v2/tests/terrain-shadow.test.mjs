// fix(v2) terrain shadow (2026-11-14): the land keeps the sky's light out of the sun. The aerial pass projects the sky onto
// L1 harmonics once a frame (render/sky.js skyIrradianceSH; skySH is its JS mirror) and the terrain, the boulders and the
// forest's cards read it by their normal (skyIrrN). These check the projection's behaviour; the frames themselves are held
// to v1's by v2/tests/pages/terrainShadow.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skySH, skyIrrN, SKY_SH, LIGHT_BYTES, LAND_SKY } from '../render/sky.js';

const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const UP = [0, 1, 0], DOWN = [0, -1, 0], E = [1, 0, 0], W = [-1, 0, 0];

test('a uniform sky lights every face with π L, whatever its tilt', () => {
  const L = [0.2, 0.5, 1.0];
  const sh = skySH(() => L);
  for (const n of [UP, DOWN, E, W, [0, 0, 1], [0.6, 0.8, 0], [0, -0.6, 0.8]]) {
    const e = skyIrrN(sh, n);
    e.forEach((v, c) => assert.ok(close(v, Math.PI * L[c], 1e-6), `n ${n}: ${v} vs ${Math.PI * L[c]}`));
  }
});

test('a face turned from the lit sky keeps light (the horizon\'s haze), and no sky gives no light', () => {
  // a sky three times brighter overhead than at the horizon (a clear day's gradient)
  const sh = skySH((d) => { const k = 1 + 2 * Math.max(d[1], 0); return [0.1 * k, 0.2 * k, 0.4 * k]; });
  const up = skyIrrN(sh, UP)[2], side = skyIrrN(sh, E)[2], down = skyIrrN(sh, DOWN)[2];
  assert.ok(up > side && side > down, `up ${up} > side ${side} > down ${down}`);
  assert.ok(down > 0.25 * up, `a face to the ground still sees the horizon: ${down} of ${up}`);
  const dark = skySH(() => [0, 0, 0]);
  assert.deepEqual(skyIrrN(dark, UP), [0, 0, 0]);
});

test('the sun\'s side of the sky lights the faces turned to it more (the directional term)', () => {
  const sh = skySH((d) => { const k = 1 + 4 * Math.max(d[0], 0) ** 4; return [k, k, k]; });   // bright toward +x (the sun's azimuth)
  assert.ok(skyIrrN(sh, E)[0] > 1.3 * skyIrrN(sh, W)[0]);
});

test('the light record holds the level sky, the sun and three channels of harmonics; the land\'s share is set', () => {
  assert.equal(LIGHT_BYTES, 5 * 16);
  assert.ok(SKY_SH.bands % 2 === 0 && SKY_SH.az >= 8);
  for (const k of ['terrain', 'forest']) assert.ok(LAND_SKY[k] >= 0.5 && LAND_SKY[k] <= 2, k);
  assert.ok(LAND_SKY.desat >= 0 && LAND_SKY.desat < 1);
});

// fix(v2) mountains: v1's far look on the land, held to v1's own numbers (src/core/farLook.js, src/terrain-mesh.js depthTint)
import { LAND_LOOK } from '../render/sky.js';
import { FAR_LOOK } from '../../classic/src/core/farLook.js';
const lin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
test('the land\'s far look is v1\'s: the haze kept, the mist, the far albedo, the slate and the spring snow line', () => {
  assert.equal(LAND_LOOK.hazeK, FAR_LOOK.hazeK);
  assert.equal(LAND_LOOK.mistGain, FAR_LOOK.mistGain);
  assert.equal(LAND_LOOK.mistK, FAR_LOOK.mistK);
  assert.equal(LAND_LOOK.albedoK, FAR_LOOK.albedoK);
  assert.deepEqual([LAND_LOOK.albedoNear, LAND_LOOK.albedoFar], [FAR_LOOK.albedoNear, FAR_LOOK.albedoFar]);
  assert.equal(LAND_LOOK.snowLine, FAR_LOOK.snowLine);
  lin(FAR_LOOK.slate).forEach((v, i) => assert.ok(Math.abs(v - LAND_LOOK.slate[i]) < 1e-3, `slate ${i}`));
  lin(0x55697a).forEach((v, i) => assert.ok(Math.abs(v - LAND_LOOK.treeFar[i]) < 1e-3, `tree far ${i}`));
});
