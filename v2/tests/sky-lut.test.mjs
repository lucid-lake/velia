// The sky's LUT parameters (v2/render/sky.js): the sizes and the atmosphere constants the WGSL is built from, the
// transmittance mapping's round trip (Bruneton's), the sky-view elevation warp's round trip and its horizon packing,
// the night floor, and that the WGSL text carries the same numbers as the JS mirrors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ATMO, LUT, SUN, transmittanceUV, uvToRMu, horizonElev, skyViewV, skyViewElev, nightFloor, ATMO_WGSL, TRANSMITTANCE_WGSL, MULTISCAT_WGSL, SKYVIEW_WGSL, SKY_DRAW_WGSL } from '../render/sky.js';

test('LUT sizes and formats: transmittance 256×64, multi-scatter 32×32, sky-view 256×128, rgba16float, multiples of the 8×8 workgroup', () => {
  assert.deepEqual(LUT.trans, [256, 64]); assert.deepEqual(LUT.ms, [32, 32]); assert.deepEqual(LUT.view, [256, 128]);
  assert.equal(LUT.format, 'rgba16float');
  for (const [w, h] of [LUT.trans, LUT.ms, LUT.view]) assert.ok(w % 8 === 0 && h % 8 === 0);
  assert.ok(LUT.viewSteps >= 24 && LUT.msDirs * LUT.msDirs === 64);
});

test('the atmosphere: Hillaire 2020\'s earth; the sun disc 0.2665°; the lake 1.897 km up', () => {
  assert.equal(ATMO.Rg, 6360); assert.equal(ATMO.Rt, 6460);
  assert.deepEqual(ATMO.rayleigh, [5.802e-3, 13.558e-3, 33.1e-3]); assert.equal(ATMO.rayleighH, 8);
  assert.equal(ATMO.mie, 3.996e-3); assert.equal(ATMO.mieAbs, 4.4e-3); assert.equal(ATMO.mieG, 0.8);
  assert.ok(Math.abs(SUN.discCos - Math.cos(0.2665 * Math.PI / 180)) < 1e-12);
  assert.equal(SUN.lakeAltKm, 1.897);
  assert.ok(SUN.illuminance > 10 && SUN.illuminance < 200, 'the HDR scale: a noon zenith about 1');
});

test('transmittance mapping: uv → (r, μ) → uv round-trips over the LUT, μ spans the horizon-grazing ray at every height', () => {
  for (let v = 0; v <= 1; v += 0.125) for (let u = 0.01; u <= 1; u += 0.11) {
    const [r, mu] = uvToRMu(u, v), [u2, v2] = transmittanceUV(r, mu);
    assert.ok(Math.abs(u2 - u) < 1e-6 && Math.abs(v2 - v) < 1e-6, `round trip at ${u},${v}: ${u2},${v2}`);
    assert.ok(r >= ATMO.Rg - 1e-9 && r <= ATMO.Rt + 1e-9);
  }
  const [, muTop] = uvToRMu(0, 0.5), [, muGraze] = uvToRMu(1, 0.5);
  assert.ok(muTop > 0.999, 'u = 0 is straight up');
  const r = uvToRMu(1, 0.5)[0];
  assert.ok(Math.abs(muGraze - -Math.sqrt(1 - (ATMO.Rg / r) ** 2)) < 1e-6, 'u = 1 grazes the ground');
});

test('sky-view elevation warp: round trip, the horizon at v = 0.5, texels packed at the horizon', () => {
  const r = ATMO.Rg + 1.9, eh = horizonElev(r);
  assert.ok(eh < 0 && eh > -0.03, `horizon ${(eh * 180 / Math.PI).toFixed(2)}° at 1.9 km`);
  for (let v = 0; v <= 1; v += 0.0625) assert.ok(Math.abs(skyViewV(skyViewElev(v, eh), eh) - v) < 1e-9, `round trip at v ${v}`);
  assert.ok(Math.abs(skyViewElev(0, eh) - Math.PI / 2) < 1e-12, 'v = 0 is the zenith');
  assert.ok(Math.abs(skyViewElev(1, eh) + Math.PI / 2) < 1e-12, 'v = 1 is the nadir');
  assert.ok(Math.abs(skyViewElev(0.5, eh) - eh) < 1e-12, 'v = 0.5 is the horizon');
  // a texel at the horizon covers less elevation than one at the zenith
  const dv = 1 / LUT.view[1];
  const atHorizon = Math.abs(skyViewElev(0.5 - dv, eh) - eh), atZenith = Math.abs(skyViewElev(0, eh) - skyViewElev(dv, eh));
  assert.ok(atHorizon < atZenith / 10, `horizon texel ${(atHorizon * 180 / Math.PI).toFixed(3)}° vs zenith texel ${(atZenith * 180 / Math.PI).toFixed(3)}°`);
  assert.ok(atHorizon * 180 / Math.PI < 0.05, 'under 0.05° at the horizon');
});

test('the night floor: 0 by day, 1 deep in the night, monotone between', () => {
  assert.equal(nightFloor(30), 0); assert.equal(nightFloor(-2), 0); assert.equal(nightFloor(-14), 1); assert.equal(nightFloor(-40), 1);
  let prev = 0; for (let e = -2; e >= -14; e -= 0.5) { const f = nightFloor(e); assert.ok(f >= prev); prev = f; }
});

test('the WGSL carries the same constants as the mirrors and declares the bindings the JS makes', () => {
  assert.match(ATMO_WGSL, /const Rg = 6360\.0; const Rt = 6460\.0;/);
  assert.match(ATMO_WGSL, /RAYLEIGH = vec3f\(0\.005802, 0\.013558, 0\.0331\)/);
  assert.match(ATMO_WGSL, /const TW = 256\.0; const TH = 64\.0; const MW = 32\.0; const MH = 32\.0; const VW = 256\.0; const VH = 128\.0;/);
  assert.match(TRANSMITTANCE_WGSL, /texture_storage_2d<rgba16float, write>/);
  assert.match(MULTISCAT_WGSL, /@group\(0\) @binding\(2\) var outM/);
  const sv = SKYVIEW_WGSL('struct Frame { sun: vec4f, sky: vec4f }');
  assert.match(sv, /@group\(1\) @binding\(3\) var outV/); assert.match(sv, /F\.sky\.z/); assert.match(sv, /F\.sun\.xyz/);
  const draw = SKY_DRAW_WGSL('struct Frame { sun: vec4f, sky: vec4f }', 'struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }\nfn viewDir(n: vec2f) -> vec3f { return vec3f(0.0, 1.0, 0.0); }');
  assert.match(draw, /@group\(1\) @binding\(1\) var tV/); assert.match(draw, /sunRadiance\(\)/);
  for (const w of [ATMO_WGSL, TRANSMITTANCE_WGSL, MULTISCAT_WGSL, sv, draw]) { const o = (w.match(/\{/g) || []).length, c = (w.match(/\}/g) || []).length; assert.equal(o, c, 'braces balance'); }
});
