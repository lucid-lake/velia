// The water's specular anti-aliasing maths (v2/render/water-aa.js; the WGSL in render/water.js carries the same formulas
// from the same constants): the mips' moments give the footprint's slope variance, the level follows the footprint,
// the roughness and the glint's floor behave, the roll-off never blows a pixel out, the rough Fresnel averages, and the
// mirror's taps turn a hard ridge line into a smooth share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AA, MIRROR_TAPS, MIRROR_HAZE_M, mirrorHaze, footprintLod, varianceOf, screenVariance, sigma2Of, glintSigma2, rollOff, roughFresnel, boxDown, landShare } from '../render/water-aa.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);

// a 64² slope field (two crossed sines, as a cascade's slopes), stored as the assemble pass writes it: (sx, sz, sx², sz²)
const n = 64;
const field = new Float32Array(n * n * 4);
const slope = (x, z) => [0.12 * Math.sin(0.9 * x + 0.3) + 0.05 * Math.sin(2.7 * z), 0.08 * Math.cos(1.3 * z - 0.2 * x)];
for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const [sx, sz] = slope(x, z); field.set([sx, sz, sx * sx, sz * sz], (z * n + x) * 4); }

test('box mips keep E[s] and E[s²]: the variance read at level k is the slope variance inside each 2^k block', () => {
  let lvl = field, side = n;
  for (let k = 1; k <= 4; k++) {
    lvl = boxDown(lvl, side); side >>= 1;
    const b = 1 << k;
    for (const [bx, bz] of [[0, 0], [1, 2], [side - 1, side - 1]]) {
      // the block's own moments, straight from the field
      let sx = 0, sz = 0, sxx = 0, szz = 0;
      for (let z = bz * b; z < (bz + 1) * b; z++) for (let x = bx * b; x < (bx + 1) * b; x++) { const [a, c] = slope(x, z); sx += a; sz += c; sxx += a * a; szz += c * c; }
      const m = b * b;
      const direct = varianceOf({ sx: sx / m, sz: sz / m, sxx: sxx / m, szz: szz / m });
      const o = (bz * side + bx) * 4;
      const read = varianceOf({ sx: lvl[o], sz: lvl[o + 1], sxx: lvl[o + 2], szz: lvl[o + 3] });
      near(read, direct, 1e-6, `level ${k} block ${bx},${bz}`);
      assert.ok(k < 3 || read > 1e-4, `a block of ${b} texels holds real spread at level ${k}: ${read}`);
    }
  }
});

test('the moments level follows the footprint: one texel → level 0, 8 texels → 3, never negative, finer tiles higher', () => {
  const L = 12, texel = L / AA.N;
  assert.equal(footprintLod(texel, L), 0);
  assert.equal(footprintLod(texel / 4, L), 0);
  near(footprintLod(8 * texel, L), 3, 1e-9);
  near(footprintLod(1.0, 2.1), Math.log2(256 / 2.1), 1e-9, 'a 1 m footprint on the 2.1 m tile');
  assert.ok(footprintLod(1.0, 2.1) > footprintLod(1.0, 12) && footprintLod(1.0, 12) > footprintLod(1.0, 600));
});

test('the roughness: floor under a flat sea, grows with the spread, the screen-space term is capped', () => {
  assert.equal(sigma2Of(0, 0), AA.floor);
  assert.ok(sigma2Of(0.01, 0) > sigma2Of(0.001, 0));
  near(screenVariance([0.1, 0], [0, 0.1]), AA.ssGain * 0.5 * 0.02, 1e-12, 'half the summed squares, scaled');
  assert.equal(screenVariance([1, 1], [1, 1]), AA.ssMax, 'a resolved crest\'s step is capped');
  assert.equal(screenVariance([0, 0], [0, 0]), 0);
});

test('the glint\'s lobe never narrower than half the clean sea\'s for the wind; the wind read no lower than 1.5 m/s', () => {
  const calm = glintSigma2(0, 0), five = glintSigma2(0, 5);
  near(calm, 0.5 * (AA.cox[0] * 1.5 + AA.cox[1]), 1e-12);
  near(five, 0.5 * (AA.cox[0] * 5 + AA.cox[1]), 1e-12);
  assert.ok(five > calm);
  near(glintSigma2(0.05, 5), 0.1, 1e-12, 'a rougher pixel keeps its own spread (both axes)');
  assert.ok(glintSigma2(0, 5) > 10 * AA.floor, 'the floor is far wider than M1\'s minimum lobe (the sparkle)');
});

test('the roll-off: identity when dim, the cap at twice the cap, never above twice the cap, monotone', () => {
  const cap = 100;
  near(rollOff(1, cap), 1, 0.01, 'dim glitter keeps its value');
  near(rollOff(2 * cap, cap), cap, 1e-9);
  assert.ok(rollOff(1e9, cap) < 2 * cap && rollOff(1e9, cap) > 1.99 * cap);
  let prev = -1; for (let L = 0; L < 1e5; L += 97) { const r = rollOff(L, cap); assert.ok(r >= prev); prev = r; }
});

test('the rough Fresnel: Schlick on a smooth sea, less than the mean normal\'s at grazing on a rough one, never above 1', () => {
  const schlick = (nv) => 0.02 + 0.98 * (1 - nv) ** 5;
  for (const nv of [0.05, 0.3, 0.9]) near(roughFresnel(nv, 0), schlick(nv), 1e-12);
  assert.ok(roughFresnel(0.05, 0.01) < schlick(0.05), 'a rough grazing pixel mirrors less');
  assert.ok(roughFresnel(0.05, 0.03) < roughFresnel(0.05, 0.01));
  near(roughFresnel(0.9, 0.01), schlick(0.9), 0.003, 'near water (facing the eye) barely moves');
  assert.ok(roughFresnel(0.001, 10) >= 0.02 && roughFresnel(0.001, 10) <= 1);
});

test('the mirror\'s taps: weights sum to 1 and are symmetric; a hard ridge becomes a smooth share that steps by at most 0.3', () => {
  for (const t of [MIRROR_TAPS.land, MIRROR_TAPS.cloud]) {
    near(t.weights.reduce((a, b) => a + b, 0), 1, 1e-9);
    t.offsets.forEach((o, i) => near(o, -t.offsets[t.offsets.length - 1 - i], 1e-12, 'symmetric offsets'));
    t.offsets.forEach((o, i) => near(t.weights[i], t.weights[t.offsets.length - 1 - i], 1e-12, 'symmetric weights'));
  }
  const ridge = 0.12, dE = 0.2;   // a 7° ridge, an 11° spread (σ² 0.01)
  let prev = landShare(0, ridge, dE), worst = 0;
  for (let e = 0; e < 0.6; e += 0.005) { const s = landShare(e, ridge, dE); assert.ok(s <= prev + 1e-12, 'monotone down'); worst = Math.max(worst, prev - s); prev = s; }
  near(landShare(0, 0.6, dE), 1, 1e-9, 'well under a high ridge: all land');
  assert.equal(landShare(0.6, ridge, dE), 0, 'well over it: all sky');
  near(landShare(ridge, ridge, dE), MIRROR_TAPS.land.weights.filter((w, i) => MIRROR_TAPS.land.offsets[i] < 0).reduce((a, b) => a + b, 0), 1e-9, 'at the ridge line: the taps below it');
  assert.ok(worst <= Math.max(...MIRROR_TAPS.land.weights) + 1e-12, `the largest step between neighbouring elevations ${worst}`);
  assert.equal(landShare(ridge + 0.001, ridge, 0), 0, 'a calm mirror keeps its sharp ridge line');
});

test('the mirrored land\'s haze (v1\'s hazeM 9 km): none at the shore, 20 % at 2 km, two thirds at 10 km, almost all at 30 km, monotone', () => {
  assert.equal(MIRROR_HAZE_M, 9000);
  near(mirrorHaze(0), 0, 1e-12, 'no haze on a hit at the surface');
  near(mirrorHaze(2000), 1 - Math.exp(-2 / 9), 1e-12, '2 km');
  assert.ok(mirrorHaze(2000) > 0.19 && mirrorHaze(2000) < 0.21, 'a far shore across the bay keeps 80 % of its colour');
  assert.ok(mirrorHaze(10000) > 0.66 && mirrorHaze(10000) < 0.68, '10 km: two thirds sky');
  assert.ok(mirrorHaze(30000) > 0.96, 'the far shore of the lake mirrors as sky');
  let prev = -1;
  for (let t = 0; t <= 60000; t += 500) { const h = mirrorHaze(t); assert.ok(h > prev && h < 1, `monotone, under 1 at ${t}`); prev = h; }
});

// fix(v2) the far water's shimmer (2026-11-13): the clouds' key read at each mirror tap over its share of the spread
import { CLOUD_TAP_SPAN, keyV, cloudTapGrad, cloudTapLod } from '../render/water-aa.js';
import { KEY } from '../sim/clouds.js';
import { keyMips } from '../render/clouds.js';

// one azimuth column of a key (v = sqrt(e / 90°), 512 rows): a cloud deck's transmittance seen from the eye, its gaps
// fixed on the ground, so they crowd toward the horizon in elevation as a real deck's do; its mip chain by 2-row means
const KH = KEY.desktop[1], KW = KEY.desktop[0];
const eOfV = (v) => v * v * Math.PI / 2;
const column = Float64Array.from({ length: KH }, (_, r) => { const e = eOfV((r + 0.5) / KH); return 0.5 + 0.5 * Math.sign(Math.sin(2 * Math.PI * (2000 / Math.tan(Math.max(e, 1e-4))) / 900)); });
const chain = [column];
while (chain.at(-1).length > 1) { const a = chain.at(-1); chain.push(Float64Array.from({ length: a.length >> 1 }, (_, i) => 0.5 * (a[2 * i] + a[2 * i + 1]))); }
// the sampler: linear within a level (clamp to edge), linear between levels
const at = (lvl, v) => { const a = chain[lvl], x = Math.min(Math.max(v * a.length - 0.5, 0), a.length - 1), i = Math.floor(x), f = x - i; return a[i] * (1 - f) + a[Math.min(i + 1, a.length - 1)] * f; };
const read = (v, lod) => { const l = Math.min(Math.max(lod, 0), chain.length - 1), i = Math.floor(l), f = l - i; return f > 0 && i + 1 < chain.length ? at(i, v) * (1 - f) + at(i + 1, v) * f : at(i, v); };
// the mirror's five cloud taps round e0 (render/water.js mirrorBlur): point taps at level 0 (before) or each filtered over
// its rows (after: along the elevation the anisotropic read integrates the whole dv, the level of dv × rows in one column)
const taps = (e0, dE, filtered) => MIRROR_TAPS.cloud.offsets.reduce((s, o, i) => { const e = Math.max(e0 + o * dE, 0); return s + MIRROR_TAPS.cloud.weights[i] * read(keyV(e), filtered ? Math.log2(Math.max(cloudTapGrad(e, dE)[1] * KH, 1)) : 0); }, 0);
// a pixel's reading as the waves move its ray by up to ±0.15° over 60 frames: the temporal std and the mean
const wobble = (e0, dE, filtered) => { const r = Array.from({ length: 60 }, (_, k) => taps(e0 + (0.15 * Math.PI / 180) * Math.sin(k * 0.7) * Math.cos(k * 0.23), dE, filtered)); const m = r.reduce((a, b) => a + b, 0) / r.length; return { m, sd: Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length) }; };
// the reference: the same Gaussian-like envelope over the spread, integrated by 801 point taps at level 0
const dense = (e0, dE) => { let s = 0, w = 0; for (let k = -400; k <= 400; k++) { const o = (2 * k) / 400, wt = Math.exp(-(o * o) / (2 * 0.8 * 0.8)); s += wt * read(keyV(Math.max(e0 + o * dE, 0)), 0); w += wt; } return s / w; };

test('the cloud taps\' footprint: the spacing in key rows, zero spread → level 0, continuous with no step, the azimuth kept sharper', () => {
  assert.equal(CLOUD_TAP_SPAN, 0.8);
  assert.equal(keyMips(KH), 10, 'down to one row');
  const [du, dv] = cloudTapGrad(0.3, 0.05);
  near(du, 0.04 / (2 * Math.PI), 1e-12, 'du: the spacing as an azimuth angle');
  near(dv, keyV(0.32) - keyV(0.28), 1e-12, 'dv: the rows the spacing covers');
  assert.equal(cloudTapLod(0.4, 0, KW, KH), 0, 'no spread: level 0 (the near water, as before)');
  assert.equal(cloudTapLod(0.4, 0.002, KW, KH), 0, 'under a texel: level 0');
  // the far pixel (3° up, a spread of 0.1 rad) reads several levels up; the anisotropic read stays under the isotropic level
  const far = cloudTapLod(0.052, 0.1, KW, KH), iso = Math.log2(cloudTapGrad(0.052, 0.1)[1] * KH);
  assert.ok(far > 3 && far < iso, `far level ${far} (isotropic ${iso})`);
  // along a view line the ray drops and the spread grows: the level rises smoothly, never a jump of half a level (no seam)
  let last = null;
  for (let k = 0; k <= 400; k++) {
    const d = 5 * 1.012 ** k, e = Math.atan(12 / d), dE = 2 * Math.sqrt(0.0005 + 0.01 * (1 - Math.exp(-d / 150)));
    const l = cloudTapLod(e, dE, KW, KH);
    if (last !== null) assert.ok(Math.abs(l - last) < 0.5, `step at ${d.toFixed(0)} m: ${last} → ${l}`);
    last = l;
  }
});

test('the far water\'s mirror: point taps flicker over a crowded deck, the filtered taps hold steady at the spread\'s mean; the near water is unchanged', () => {
  for (const [e0, dE] of [[0.052, 0.03], [0.09, 0.05], [0.15, 0.08], [0.035, 0.02]]) {   // far pixels: 2–9° up, the taps above the horizon
    const before = wobble(e0, dE, false), after = wobble(e0, dE, true);
    assert.ok(after.sd < before.sd / 3 && before.sd > 0.02, `e0 ${e0}: std ${before.sd.toFixed(4)} → ${after.sd.toFixed(4)}`);
    const ref = dense(e0, dE);
    assert.ok(Math.abs(after.m - ref) <= Math.max(0.08, Math.abs(before.m - ref)), `e0 ${e0}: the filtered mean ${after.m.toFixed(3)} near the spread's true mean ${ref.toFixed(3)} (point taps ${before.m.toFixed(3)})`);
  }
  // a near pixel: high in the sky, a spread under a row → level 0 → the same reading as before, to the last bit
  for (const e0 of [0.4, 0.6]) assert.equal(taps(e0, 0.001, true), taps(e0, 0.001, false));
});
