// The Tahoe look, week 1: the pure parts of each step. Run: node --test tests/lookWeek1.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twilightWeight, TWILIGHT_MIRROR as M, createWater } from '../classic/src/water.js';
import { WindField } from '../src/sim/wind.js';

test('M6: the twilight mirror weighs in only at low sun, smoothly, and is off with wmirror=0', () => {
  assert.equal(twilightWeight(30), 0, 'noon: the day mirror as before');
  assert.equal(twilightWeight(M.highDeg), 0);
  assert.equal(twilightWeight(M.lowDeg), 1);
  assert.equal(twilightWeight(-4.5), 1, '05:18 (the sun 4.5 deg down): full');
  assert.equal(twilightWeight(-20), 1, 'the night keeps it (the long-exposure night is brighter, never darker)');
  let last = 1;
  for (let e = M.lowDeg; e <= M.highDeg; e += 0.25) { const w = twilightWeight(e); assert.ok(w <= last + 1e-12, 'falls with the sun'); last = w; }
  assert.ok(Math.abs(twilightWeight((M.highDeg + M.lowDeg) / 2) - 0.5) < 1e-9, 'smooth, centred');
  assert.equal(twilightWeight(-4.5, null), 0, 'wmirror=0');
  assert.ok(M.roughK < 0.9 && M.mask > 0.45 && M.cloudGain > 0 && M.followM >= 500, 'a calmer mirror than by day; the probe re-centres past a few hundred metres');
});

test('M6: the water builds with and without the mirror, and takes the cloud deck', () => {
  const wind = new WindField({ seed: 1 });
  for (const mirror of [undefined, null]) {
    const w = createWater({ wind, ...(mirror === null ? { mirror: null } : {}) });
    assert.equal(typeof w.setCloudDeck, 'function');
    w.setCloudDeck({ value: 0.6 });
    w.mesh.userData.daylight({ sunDir: { x: 0.8, y: -0.08, z: -0.56 }, elevDeg: -4.5, light: 0.004, starlit: false });
  }
});

test('S5: the shelf tint leans green; the bed sand stays pale (L* >= 65); wcolour=old builds', async () => {
  const { WATER_LOOK: L } = await import('../classic/src/water.js');
  const { BED } = await import('../src/waters/clarity-optics.js');
  assert.ok(L.shelf[1] > L.shelf[2] && L.shelf[1] > L.shelf[0], 'shelf: green over blue and red (turquoise)');
  assert.ok(L.shelfM < L.deepM);
  const lin = BED.sand, Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const Lstar = Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  assert.ok(Lstar >= 65, `sand L* ${Lstar.toFixed(1)}`);
  createWater({ wind: new WindField({ seed: 1 }), colour: null });
});

test('deep water (owner 2026-11-13): v2-style navy past the shelf, by the sun; the hue holds between knots', async () => {
  const { WATER_LOOK: L, deepTintAt } = await import('../classic/src/water.js');
  const { WATER_K, WATER_B } = await import('../src/sim/water-spectrum.js');
  const k = L.deepSun;
  for (let i = 1; i < k.length; i++) assert.ok(k[i][0] > k[i - 1][0], 'knots by rising sun');
  for (const [e, c] of k) assert.deepEqual(deepTintAt(e), [...c]);
  assert.deepEqual(deepTintAt(-40), [...k[0][1]], 'held under the first knot');
  assert.deepEqual(deepTintAt(90), [...k[k.length - 1][1]], 'held over the last knot');
  assert.deepEqual(L.deep, k[k.length - 1][1], 'deep: the high-sun tint');
  // between two knots each channel eases by the same ratio per degree, so a channel ratio at the midpoint is the
  // geometric mean of the knots' ratios (a linear blend of the 18 deg knot into the dusk one went purple)
  for (let i = 1; i < k.length; i++) {
    const [e0, a] = k[i - 1], [e1, b] = k[i], m = deepTintAt((e0 + e1) / 2);
    for (const [p, q] of [[0, 2], [1, 2]]) assert.ok(Math.abs(m[p] / m[q] - Math.sqrt((a[p] / a[q]) * (b[p] / b[q]))) < 1e-9);
  }
  // the deep body (the backscatter's colour x the tint): at noon a darker blue and green than the old cobalt
  // (0.5, 2.6, 3.2) with more red (v2's navy leans violet: AgX draws a little red in a deep blue as near black), blue
  // still the strongest by far; darker at dusk than at noon
  const body = (t) => t.map((c, i) => c * WATER_B[i] / (2 * WATER_K[i]));
  const noon = body(deepTintAt(74)), dusk = body(deepTintAt(2)), old = body([0.5, 2.6, 3.2]);
  assert.ok(noon[2] < 0.5 * old[2] && noon[1] < 0.5 * old[1], 'navy: under half the cobalt in blue and green');
  assert.ok(noon[0] > old[0], 'navy: more red than the cobalt');
  assert.ok(noon[2] > 3 * noon[0] && noon[2] > 3 * noon[1], 'blue the strongest by 3x');
  for (let c = 0; c < 3; c++) assert.ok(dusk[c] < noon[c], 'dusk body darker than noon');
  // ?wcolour=old (colour: null): no tint, the body as before S5
  assert.deepEqual(deepTintAt(30, null), [1, 1, 1]);
});

test('S1 + S2: the grade keeps neutrals and the brand colours near, pulls the highlights, deepens a pale blue; strength by the sun', async () => {
  const { gradeSrgb, gradeLutData, gradeStrength, skyStrength, gradeMode, srgbToLab, GRADE, SKY } = await import('../classic/src/core/grade.js');
  const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
  const dL = (a, b) => srgbToLab(a)[0] - srgbToLab(b)[0];
  // white stays under clipping (the clouds keep their modelling); black stays black
  const w = gradeSrgb([1, 1, 1]);
  assert.ok(srgbToLab(w)[0] < 99 && srgbToLab(w)[0] > 90, 'white pulled, not dimmed to grey');
  assert.ok(srgbToLab(gradeSrgb([0, 0, 0]))[0] < 2);
  // a pale noon sky (L* 72, C* 14) comes out richer
  const sky = hex(0x9eb5cc), g = gradeSrgb(sky), C = (c) => Math.hypot(srgbToLab(c)[1], srgbToLab(c)[2]);
  assert.ok(C(g) > C(sky) * 1.15, `sky chroma ${C(sky).toFixed(1)} -> ${C(g).toFixed(1)}`);
  // a neutral grey keeps its chroma under 3
  assert.ok(C(gradeSrgb([0.5, 0.5, 0.5])) < 3);
  assert.ok(Math.abs(dL(gradeSrgb([0.5, 0.5, 0.5]), [0.5, 0.5, 0.5])) < 6, 'mid grey within 6 L*');
  assert.equal(gradeLutData().length, GRADE.size ** 3 * 4);
  assert.equal(gradeStrength(30), 1); assert.equal(gradeStrength(-20), GRADE.night);
  assert.equal(skyStrength(30), 1); assert.equal(skyStrength(-5), 0, 'no sky curve at twilight or night');
  assert.deepEqual(gradeMode({ grade: '0' }), { lut: false, sky: false });
  assert.deepEqual(gradeMode({}), { lut: true, sky: true });
  assert.ok(SKY.lum < 1 && SKY.sat > 1);
});

test('S3 + S4: the far look is on by default and off with far=old; the haze is a share, the snow line the spring one', async () => {
  const { FAR_LOOK: F, farLookOn } = await import('../classic/src/core/farLook.js');
  assert.equal(farLookOn({}), true);
  assert.equal(farLookOn({ far: 'old' }), false);
  assert.ok(F.hazeK > 0 && F.hazeK < 1 && F.albedoK > 0 && F.albedoK < 1 && F.mistK > 0 && F.mistK <= 1);
  assert.ok(F.albedoNear < F.albedoFar);
  assert.equal(F.snowLine, 2500);
});
