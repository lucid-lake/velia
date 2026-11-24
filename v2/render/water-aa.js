import { KEY_ANISO } from './cloud-read.js';
// The water's specular anti-aliasing (M5c, 2026-11-13; the owner: v2's water was "small white dots … constantly flashing").
// Pure maths, in JS (tested: v2/tests/water-aa.test.mjs) and as the same formulas in WGSL (AA_WGSL, render/water.js).
//
// A pixel of far water covers many ripples. Shading it with one normal and a narrow lobe lights one facet per pixel, a
// different one every frame: the sparkle. The fix is LEAN / Toksvig style: what the pixel cannot resolve goes into the
// roughness, so the lobe widens to the facets' spread and the pixel shows their mean (broad, still patches of sky).
//   1. The footprint's slope variance. The slope texture's mips hold E[s] and E[s²] (the box filter keeps both means).
//      The hardware's anisotropic sample picks its level from the footprint's MINOR axis (the detail), so at grazing
//      angles (ratios past 8 : 1) its E[s²] − E[s]² misses most of the spread along the view. The second moments are
//      read again at the level of the footprint's MAJOR axis (footprintLod): their variance is the whole spread.
//   2. The screen-space spread (Kaplanyan 2016, simplified): the slope's finite difference between neighbouring pixels,
//      squared and halved, clamped; it catches aliasing from any source the mips do not see (the mesh, the warp).
//   3. The sun's glint: a Cox–Munk floor on its slope variance (never under half the clean sea's for the wind, v1's rule:
//      a glitter path stays broad from the sub-pixel ripples), and a soft roll-off of its luminance toward CAP_MUL × the sky's
//      luminance round the sun: L' = L / (1 + L / (2 cap)), identity when dim, never above 2 cap (one facet can no longer
//      blow a pixel to white; the path keeps the sun's colour and its light-dark texture).
//   4. The Fresnel averaged over the unresolved facets (v1's rough-Fresnel): they face the viewer more than the mean
//      surface, so a rough pixel at grazing mirrors less sky than its mean normal says, and the mirror's share no longer
//      swings with the normal's sampling.
export const AA = Object.freeze({
  N: 256,            // the slope texture's side (texels)
  floor: 0.0005,     // slope variance under the finest ripple the sim carries (M1's)
  ssGain: 0.5,       // the finite difference's share: var ≈ ½ Δ² for a step between two samples
  ssMax: 0.02,       // the screen-space term's cap (a resolved crest's own slope change is not roughness)
  cox: [0.00512, 0.003],       // Cox–Munk (1954) clean-sea mean-square slope ≈ 0.003 + 0.00512 U (U at 12.5 m, m/s)
  coxShare: 0.5, minWind: 1.5, // the glint's floor: half of it, the wind never read under 1.5 m/s (v1's)
  capMul: 4,         // the glint's roll-off: toward 4 × the sky's luminance round the sun (v1's)
  roughK: 0.9,       // the unresolved slope's share in the rough-Fresnel average (v1's by day)
});

// the mirror's elevation taps (render/water.js mirrorBlur): offsets in units of the spread dE, Gaussian-like weights (sum 1);
// the land's ridge line (a 256 × 16 texture: cheap) and the clouds' key (large: its own count) each
export const MIRROR_TAPS = Object.freeze({
  land: Object.freeze({ offsets: [-1.6, -0.8, 0, 0.8, 1.6], weights: [0.1, 0.25, 0.3, 0.25, 0.1] }),
  cloud: Object.freeze({ offsets: [-1.6, -0.8, 0, 0.8, 1.6], weights: [0.1, 0.25, 0.3, 0.25, 0.1] }),
});
// the clouds' key filtered at each tap over the taps' spacing (the far water's shimmer fix, 2026-11-13). The key packs
// v = sqrt(e / 90°) toward the horizon, so a far pixel's taps, spread over several degrees just above it, spanned tens of
// rows each: five point samples of cloud edges finer than the spread, each flipping between cloud and gap as the waves
// moved the ray (the "bouncing" past a line in the middle distance, where the spacing outgrew a row of the key). Each
// tap now reads the key's mip chain (render/clouds.js) by gradient over its share of the spread, s = the spacing × dE:
// dv the rows [e − s/2, e + s/2] cover, du the same angle in azimuth; the sampler's anisotropy (KEY_ANISO) keeps the
// azimuth sharper than the elevation where the packing stretches the rows. Near the eye the spread is under a texel:
// level 0, as before
export const CLOUD_TAP_SPAN = MIRROR_TAPS.cloud.offsets[1] - MIRROR_TAPS.cloud.offsets[0];   // 0.8: the taps' spacing in units of dE
export const keyV = (e) => Math.sqrt(Math.max(e, 0) / (Math.PI / 2));
// the tap's gradients in key uv units: [du, dv]
export const cloudTapGrad = (e, dE, span = CLOUD_TAP_SPAN) => [(span * dE) / (2 * Math.PI), keyV(e + 0.5 * span * dE) - keyV(e - 0.5 * span * dE)];
// the level the hardware reads for those gradients on a W × H key: the anisotropic rule (λ = log2(ρmax / N), N the ratio
// up to `aniso`; continuous here, where the hardware rounds N up and spreads N reads along the major axis, so the width
// it filters stays ρmax along the elevation and ρmax / N across)
export function cloudTapLod(e, dE, W, H, aniso = KEY_ANISO) {
  const [du, dv] = cloudTapGrad(e, dE), px = du * W, py = dv * H, hi = Math.max(px, py), lo = Math.min(px, py);
  if (!(hi > 1)) return 0;
  return Math.max(Math.log2(hi / Math.min(Math.max(hi / Math.max(lo, 1e-9), 1), aniso)), 0);
}
// the mirrored land's haze (v1's src/water-reflect.js hazeM): a reflected hit t metres off fades toward the sky it stands
// under by 1 − exp(−t / hazeM), on top of the air's own extinction over the path (render/terrain.js REFLECT_WGSL), so a
// far shore mirrors soft and pale, as v1's does (2 km: 20 %; 10 km: 67 %; 30 km: 96 %)
export const MIRROR_HAZE_M = 9000;
export const mirrorHaze = (tM, hazeM = MIRROR_HAZE_M) => 1 - Math.exp(-tM / hazeM);
// the land's share at elevation e0 below a ridge at eRidge, by the same taps on a hard 0/1 ridge (the JS twin of landBlur's a)
export const landShare = (e0, eRidge, dE) => MIRROR_TAPS.land.offsets.reduce((s, o, i) => s + MIRROR_TAPS.land.weights[i] * (Math.max(e0 + o * dE, 0) < eRidge ? 1 : 0), 0);

// the mip level whose texel covers a footprint of `fpM` metres on a tile of `L` metres (0 at or under a texel)
export const footprintLod = (fpM, L, N = AA.N) => Math.log2(Math.max((fpM * N) / L, 1));
// the slope variance from first and second moments (per axis, the mean of the two axes)
export const varianceOf = (m) => 0.5 * (Math.max(m.sxx - m.sx * m.sx, 0) + Math.max(m.szz - m.sz * m.sz, 0));
// the screen-space term from the slope's finite differences (vec2 each)
export const screenVariance = (dsx, dsy) => Math.min(AA.ssGain * 0.5 * (dsx[0] * dsx[0] + dsx[1] * dsx[1] + dsy[0] * dsy[0] + dsy[1] * dsy[1]), AA.ssMax);
// the pixel's slope variance (one axis)
export const sigma2Of = (mipVar, ssVar) => mipVar + ssVar + AA.floor;
// the glint's total mean-square slope (both axes; sigma2 is one axis's): never under half the clean sea's for the wind
export const glintSigma2 = (sigma2, windMs) => Math.max(2 * sigma2, AA.coxShare * (AA.cox[0] * Math.max(windMs, AA.minWind) + AA.cox[1]));
// the glint's soft roll-off toward the cap (cap = capMul × the sky's luminance round the sun)
export const rollOff = (L, cap) => L / (1 + L / (2 * cap));
// Schlick's Fresnel of water, averaged over the unresolved facets
export const roughFresnel = (nv, sigma2, k = AA.roughK) => { const c = Math.min(Math.max(nv + k * Math.sqrt(sigma2), 0), 1); return 0.02 + 0.98 * (1 - c) ** 5; };

// the JS twin of render/water.js MIP_WGSL on one layer: a 2 × 2 box mean of every channel, one level down
export function boxDown(src, n) {
  const h = n >> 1, dst = new Float32Array(h * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) for (let k = 0; k < 4; k++) {
    const o = (2 * y * n + 2 * x) * 4 + k;
    dst[(y * h + x) * 4 + k] = 0.25 * (src[o] + src[o + 4] + src[o + n * 4] + src[o + n * 4 + 4]);
  }
  return dst;
}

export const AA_WGSL = `
const AA_FLOOR = ${AA.floor}; const AA_SS_GAIN = ${AA.ssGain}; const AA_SS_MAX = ${AA.ssMax};
const AA_COX_A = ${AA.cox[0]}; const AA_COX_B = ${AA.cox[1]}; const AA_COX_SHARE = ${AA.coxShare}; const AA_MIN_WIND = ${AA.minWind};
const AA_CAP_MUL = ${AA.capMul}.0; const AA_ROUGH_K = ${AA.roughK};
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
fn footprintLod(fpM: f32, L: f32) -> f32 { return log2(max(fpM * ${AA.N}.0 / L, 1.0)); }
fn screenVariance(dsx: vec2f, dsy: vec2f) -> f32 { return min(AA_SS_GAIN * 0.5 * (dot(dsx, dsx) + dot(dsy, dsy)), AA_SS_MAX); }
fn glintSigma2(sigma2: f32, windMs: f32) -> f32 { return max(2.0 * sigma2, AA_COX_SHARE * (AA_COX_A * max(windMs, AA_MIN_WIND) + AA_COX_B)); }
fn rollOff(c: vec3f, cap: f32) -> vec3f { let L = max(dot(c, LUMA), 1e-6); return c * (1.0 / (1.0 + L / (2.0 * cap))); }
fn keyV(e: f32) -> f32 { return sqrt(max(e, 0.0) / 1.5707963); }
// the cloud tap's gradients (cloudTapGrad): du, dv in key uv units
fn cloudTapGrad(e: f32, dE: f32) -> vec2f { let s = ${(MIRROR_TAPS.cloud.offsets[1] - MIRROR_TAPS.cloud.offsets[0]).toFixed(4)} * dE; return vec2f(s / 6.2831853, keyV(e + 0.5 * s) - keyV(e - 0.5 * s)); }
fn roughFresnel(nv: f32, sigma2: f32) -> f32 { let c = clamp(nv + AA_ROUGH_K * sqrt(sigma2), 0.0, 1.0); return 0.02 + 0.98 * pow(1.0 - c, 5.0); }`;
