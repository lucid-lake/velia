// #56 M1, the water's surface (2026-11-14): v1's drawing recipe on v2's FFT sea, and Ultra-Water's textured whitecap foam,
// crest light and sun glint ported from its GLSL (src/water/OceanSurface.js FRAG and src/water/bakeTextures.js FOAM) to WGSL:
//   Ultra-Water, https://github.com/Humpalumps/Ultra-Water @ ce9248f, copyright (c) 2026 Humpalumps, MIT License
//   (src/waters/ultra/LICENSE; ATTRIBUTION.md). The permission notice applies to the ported foam bake, foam erosion and
//   shading, crest subsurface and glint below.
// Pure: constants, the JS twins the tests call (v2/tests/water-surface.test.mjs) and the WGSL render/water.js includes.
// What each part is (render/water.js WATER_DRAW_WGSL uses them; ?m1=0 is the water before, the A/B):
//   1. v1's short-wave fades (sim/spectrum.js FADES): the h0 table, no per-frame cost.
//   2. v1's slope gain (src/water.js BAY_SLOPE = 2: the bay sim's slopes × 2 against its heights, shading only). v2 runs one FFT
//      whose 85 m and 12 m tiles hold the lake's and the bay's waves summed, so the gain is the same energy:
//      √(1 + (2² − 1) · bayShare), the bay's share of the tile's energy at the point (sim/seaField.js seaGainsShare). 2 in the bay,
//      1 on the open lake, as v1 draws them. Heights, the CPU surface and the boat are untouched.
//   3. Dark troughs and bright faces (v1's modulation transfer, src/water.js MTF: the long waves pile the short ones on their
//      crests: the 12 m and 2.1 m tiles' slopes × clamp(1 + 2.2 η / Hs, 0.35, 2.2), η the long waves' height here); the mirror's
//      ray off the pixel's own normal where the footprint resolves the ripples (under NEAR_RAY), the footprint's mean past it.
//   5. Ultra's whitecap foam: a baked 512² texture (lace R, billow height G, its gradient BA), coverage by erosion of the pattern
//      (dense young foam solid, ageing foam thinning to lace as v2's turbulence recovers), billow bump and crease shade, thin
//      foam tinted by the water under it, the sun through thin foam. v2's coverage density and its wind ramp stay.
//   6. Ultra's crest subsurface: sun through thin crests seen against the sun (its k1 term, the crest's height in Hs units).
//   7. Ultra's glint: its height-correlated Smith term over the slope variance from the mips (on v1's Beckmann lobe: GGX's tails
//      greyed the navy), its facet glitter with the twinkle smoothed (a slow crossfade, a capped count, cells of 4 px and more), rolled off as before.
// Not here: step 4 (gust patches and v1's two fine gust ripples) is the spume and wind helper's (W1).

export const SURF = Object.freeze({
  baySlope: 2.0,                              // v1's BAY_SLOPE
  // the gain drawn on the 85 m and 12 m tiles' bay share: v1 draws both at BAY_SLOPE; the 12 m tile's short, fast waves at 2
  // added a quarter to the follow camera's jumps (60 frames: fades alone 3.45 %, 2 / 2 4.33 %, 2 / 1.5 3.73 %), so 1.5 there
  tileSlope: Object.freeze([2.0, 1.5]),
  // the gain's reach: full where the pixel's footprint is under half of it, none past it (m; the 85 m and 12 m tiles), so it
  // steepens the waves the pixel resolves; on the unresolved ones a doubled slope is per-frame flicker (the A/B in v2/notes/water.md)
  boostReach: Object.freeze([1e9, 1e9]),
  mtf: 2.2, mtfLo: 0.35, mtfHi: 2.2,          // v1's MTF and its clamp
  nearRay: Object.freeze([0.02, 0.12]),       // m of footprint: the mirror follows the pixel's normal under the first, the mean past the second
  maskFloor: 0.45,                            // v1's Smith masking on the mirror, floored (src/water.js)
  // the foam (Ultra's uFoam, uFoamTint; its pattern scales 0.11 and 0.031 per m)
  foamScale: Object.freeze([0.11, 0.031]), foamOff: 0.37, foamMix: Object.freeze([0.65, 0.35]),
  foamBias: Object.freeze([1.05, 1.3]),       // cover = smoothstep(b0 − d, b1 − d, pattern) · √d
  // the whitecaps' coverage, v1's (src/sim/water-spectrum.js WHITECAP, src/waters/ultra/gpuBridge.js jacQuantile): the fold
  // threshold J0 is the turbulence's quantile at Monahan & O'Muircheartaigh's W = 3.84e-6 U^3.41 of the water, from the 12 m
  // tile the CPU reads back; none under 4 m/s, all from 8. v2's fixed onset (J < 0.45) was never reached on the lake (its
  // 12 m tile's turbulence stays over 0.6 at wind 4: no whitecaps at all), so M1 takes v1's rule.
  // coverK: the share of Monahan's W the 12 m tile's quantile takes: the drawn foam also has the 85 m tile's folds (the shader's
  // Jacobian is the tiles' minimum) and the foam's memory; 0.4 draws ≈ 1 % of the open water's pixels white at wind 4 (the
  // follow camera; v1 0.1 %, its flecks thin streaks; 1.0 drew 3.2 %)
  monahan: Object.freeze([3.84e-6, 3.41]), coverK: 0.4, onset: Object.freeze([4, 8]),
  // the foam's density: (J0 − turbulence) / span; the turbulence recovers at rec / s (Ultra's 0.7 on an ocean whose folds run
  // 0.8 deep; a lake's run 0.1 deep, so the memory is slower, for Ultra's half-second of erosion from solid to lace)
  foamSpan: 0.05, foamRec: 0.1,
  foamTint: Object.freeze([0.62, 0.78, 0.82]), foamBright: 0.85,
  // the crest's light (Ultra's uSSS.x = 1.6; the crest's height: η / Hs × crestM, a demo-ocean crest's metres; v1's thin-crest gain)
  sssPeak: 1.6, crestM: 3.0, thin: 2.2,
  // the glint (Ultra's GGX floor 0.015; FACETS 2e4 per m²); the twinkle smoothed: 0.4 draws a second (Ultra 3), crossfaded,
  // the count's ratio capped at 3 (Ultra 300), cells 4 footprints and up (Ultra 2), weight 0.35 (Ultra 0.6)
  glintFloor: 0.015, facets: 2e4, rate: 0.4, mMax: 3, cellLog: 2, glitter: 0.35, glitterNear: Object.freeze([4, 30]),
  // the whitecaps' folds of the 12 m tile read through world cells (foldCells): every copy of the tile folded in step, so its
  // foam drew white dots on a 12 m lattice that flashed together (seen at dusk, 2026-11-15). Cells of 6.1 m (no common
  // period with any tile), turned 0.55 rad off the tile's axes, each reading the tile at its own random place; the fold fades
  // out over the outer 0.08 of a cell, so no foam is cut by a cell's edge. Each cell also breaks on its own clock: a cycle of
  // 3–7 s at a random phase, the fold let through from 0.2 to 0.6 of it (faded in and out over 0.2: the foam erodes away,
  // never pops), so the cells reading one fold of the tile never whiten together. Past a footprint of 0.3 m the caps fade to
  // half by 1.5 m: the far, grazing water's specks are where a lattice read first
  foldCell: 6.1, foldRot: 0.55, foldEdge: 0.08, foldCycle: Object.freeze([3, 7]), foldOpen: Object.freeze([0.2, 0.6, 0.2]),
  foldFar: Object.freeze([0.3, 1.5, 0.5]),
  // the whitecaps' J0: the 12 m tile's own quantile every j0Every-th read (every 4th texel), glided to at j0Ease a read, at
  // (at 7.7 m/s) coverK / foldShare of Monahan's W: foldShare gives back what the cells' edges, clocks and far fade hold back and what the
  // old J0 drew over its aim (its stale reads sat high: ≈ 0.6 % of the tile under it, not 0.17 %); 0.17 keeps the whitecaps'
  // pixels within 5 % of before over 3 s at 13:00, 15 kn, the follow camera. capLaw: the share follows the wind as the old J0
  // did in practice, not Monahan's U^3.41 (its few texels and stale reads flattened the law): as tuned at 7.7 m/s, × (U / 7.7);
  // the whitecaps' pixels at 10 m/s are then 1.2× before (2.3× at U^3.41)
  foldShare: 0.17, capLaw: Object.freeze([7.7, 1.0]), j0Every: 4, j0Ease: 0.3,
});
// the foam texture: Ultra bakes 512² RGBA8; the water's fragment stage is at WebGPU's 16 sampled textures, so v2 bakes it at
// 256² into one more layer of the slope array (render/water.js: layer FOAM_LAYER = the cascades' count, never written by the
// sim's passes, whose dispatches cover the cascades' layers only), mipped with the same box filter. 3.5 cm texels on the 9 m tile
export const FOAM_TEX = 256;

const sat = (x) => Math.min(Math.max(x, 0), 1);
import { smooth } from '../../src/sim/core/math.js'; export { smooth };
// 2: the slope gain of a tile whose bay share is s
export const slopeBoost = (share, k = SURF.baySlope) => Math.sqrt(1 + (k * k - 1) * sat(share));
// 3: the short tiles' modulation at height eta (m) on a sea of significant height hs (m)
export const modulate = (eta, hs) => Math.min(Math.max(1 + SURF.mtf * eta / Math.max(hs, 0.03), SURF.mtfLo), SURF.mtfHi);
// 3: v1's Smith masking on the mirror (the WGSL smithMask's twin): nv the view's cosine on the normal, m2 the total mean-square slope
export function smithMask(nv, m2) {
  const am = Math.max(nv, 0.001) / (Math.sqrt(Math.max(1 - nv * nv, 1e-6)) * Math.sqrt(Math.max(m2, 1e-6)));
  const t = 1 / (1 + 0.3275911 * am), ex = Math.exp(-am * am);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * ex;
  return Math.max(1 / ((erf - 1) * 0.5 + ex / (am * 2 * Math.sqrt(Math.PI)) + 1), SURF.maskFloor);
}
// 3: how much the mirror's ray follows the pixel's own normal at a footprint fp (m)
export const nearRay = (fp) => 1 - smooth(SURF.nearRay[0], SURF.nearRay[1], fp);
// 5: Ultra's erosion: the foam's cover over a pattern value p (0–1) at density d (0–1)
export const foamCover = (d, p) => (d > 0 ? smooth(SURF.foamBias[0] - d, SURF.foamBias[1] - d, p) * Math.sqrt(d) : 0);
// 5: v1's whitecap coverage: Monahan's share of the water at wind U (m/s), the threshold J0 that share of the turbulence
// falls under (values: a Float32Array, sorted in place), the wind's onset ramp
export const monahan = (U) => SURF.monahan[0] * Math.pow(Math.max(U, 0), SURF.monahan[1]);
export function whitecapJ0(values, U, k = SURF.coverK) { values.sort(); return values[Math.min(values.length - 1, Math.max(0, Math.floor(k * monahan(U) * values.length)))]; }
export const foamWind = (U) => smooth(SURF.onset[0], SURF.onset[1], U);
// 5: J0 after n reads gliding from j toward aim at SURF.j0Ease a read
export const j0Glide = (j, aim, n = 1) => aim + (j - aim) * (1 - SURF.j0Ease) ** Math.max(0, n);
// 5: the share of the 12 m tile under J0 at wind U (m/s): SURF.capLaw's, the whitecaps' coverage the old J0 drew in practice
export const capShare = (U) => (SURF.coverK / SURF.foldShare) * monahan(SURF.capLaw[0]) * Math.pow(Math.max(U, 0) / SURF.capLaw[0], SURF.capLaw[1]);
// 5: J0 from the whole 12 m tile as it is now: the turbulence (channel 3 of n RGBA texels from offset o, every stride-th
// texel) under which that share of the tile falls, by a histogram over [0.3, 1) (one pass, no sort; hist: a
// Uint32Array, reused). The tile holds only a few deep folds at a time, so the share under a fixed J0 swings 3× within
// seconds and every cap on the lake whitened and cleared together; at the tile's own quantile its share stays put
export const J0_HIST = Object.freeze({ lo: 0.3, hi: 1, bins: 700 });
export function whitecapJ0Field(f, o, n, stride, share, hist) {
  const { lo, hi, bins } = J0_HIST, sc = bins / (hi - lo);
  hist.fill(0); let m = 0;
  for (let i = 0; i < n; i += stride) { m++; const v = f[o + i * 4 + 3]; if (v < hi) hist[Math.max(0, Math.floor((v - lo) * sc))]++; }
  const want = share * m; let c = 0;
  for (let b = 0; b < bins; b++) { const h = hist[b]; if (h > 0 && c + h >= want) return lo + (b + (want - c) / h) / sc; c += h; }
  return hi;
}
// Ultra's foam density from the fold's depth under J0 (the turbulence: the Jacobian, recovering from a fold at rec / s: its age)
export const foamDensity = (jac, j0) => sat((j0 - jac) / SURF.foamSpan);
// 5: the JS twin of foldCells' cell and weight: the tile coordinate (m, in [0, L)) the point at world x, z reads for the
// whitecaps' fold, and the fold's weight there (0 at a cell's edge, 1 inside); the hash is the shader's suHash12 (f32 there)
const hash12 = (x, y) => { let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031); const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33); a += d; b += d; c += d; return fract((a + b) * c); };
export function foldCell(x, z, L = 12) {
  const cr = Math.cos(SURF.foldRot), sr = Math.sin(SURF.foldRot);
  const qx = (cr * x - sr * z) / SURF.foldCell, qz = (sr * x + cr * z) / SURF.foldCell;
  const ix = Math.floor(qx), iz = Math.floor(qz), fx = qx - ix, fz = qz - iz;
  const ox = hash12(ix + 0.37, iz + 0.37) * L, oz = hash12(ix * 1.73 + 11.1, iz * 1.73 + 11.1) * L;
  const e = Math.min(fx, 1 - fx, fz, 1 - fz);
  return { u: (((x + ox) % L) + L) % L, v: (((z + oz) % L) + L) % L, weight: smooth(0, SURF.foldEdge, e), cell: `${ix},${iz}`, ix, iz };
}
// 5: the JS twin of foldGate: the cell's clock (0: the fold held back, 1: let through) at time t (s)
export function foldGate(ix, iz, t) {
  const [c0, c1] = SURF.foldCycle, [o0, o1, of] = SURF.foldOpen;
  const T = c0 + (c1 - c0) * hash12(ix * 0.79 + 19.3, iz * 0.79 + 19.3), u = fract(t / T + hash12(ix * 2.31 + 5.7, iz * 2.31 + 5.7));
  return smooth(o0 - of, o0, u) * (1 - smooth(o1, o1 + of, u));
}
// the whitecaps' cover at a pattern value p: Ultra's erosion of the density, its solid-foam opacity, the wind's share
export function capCover(jac, j0, U, p, fh = 0.5) {
  const d = foamDensity(jac, j0), solid = smooth(0.2, 0.9, d * (0.55 + 0.7 * fh));
  return foamCover(d, p) * (0.8 + 0.2 * solid) * foamWind(U);
}
// 5: v2's turbulence (render/water.js ASSEMBLE_WGSL): it follows the Jacobian down at once and recovers at rec / s (the foam's age)
export const turbStep = (prev, jac, dt, rec) => Math.min(jac, prev + dt * rec / Math.max(jac, 0.5));

// 5: the JS twin of the bake's lace channel (FOAM_BAKE_WGSL, Ultra's FOAM): tileable Voronoi at 9, 23 and 61 cells
const fract = (x) => x - Math.floor(x);
const modp = (x, p) => x - p * Math.floor(x / p);
function hash22(px, py) {
  let a = fract(px * 0.1031), b = fract(py * 0.1030), c = fract(px * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return [fract((a + b) * c), fract((a + c) * b)];
}
export function voronoi(x, y, period) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  let f1 = 8, f2 = 8;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const [ox, oy] = hash22(modp(ix + i, period), modp(iy + j, period));
    const d = Math.hypot(i + ox - fx, j + oy - fy);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return [f1, f2];
}
export function foamLace(u, v) {
  const a = voronoi(u * 9, v * 9, 9), b = voronoi(u * 23 + 0.5, v * 23 + 0.5, 23), c = voronoi(u * 61, v * 61, 61);
  const lace = 1 - smooth(0, 0.22, a[1] - a[0]), fine = 1 - smooth(0, 0.16, b[1] - b[0]), bubbles = smooth(0.55, 0.15, c[0]);
  return sat((lace * 0.55 + fine * 0.3 + bubbles * 0.25 + (1 - a[0]) * 0.25) * 0.85);
}

// the shader's side: SURF_WGSL needs PI (render/water.js) and the frame's F
export const SURF_WGSL = `
const SU_MTF = ${SURF.mtf.toFixed(3)}; const SU_MTF_LO = ${SURF.mtfLo.toFixed(3)}; const SU_MTF_HI = ${SURF.mtfHi.toFixed(3)};
const SU_NEAR0 = ${SURF.nearRay[0].toFixed(3)}; const SU_NEAR1 = ${SURF.nearRay[1].toFixed(3)};
const SU_FS0 = ${SURF.foamScale[0].toFixed(4)}; const SU_FS1 = ${SURF.foamScale[1].toFixed(4)}; const SU_FOFF = ${SURF.foamOff.toFixed(3)};
const SU_FM0 = ${SURF.foamMix[0].toFixed(3)}; const SU_FM1 = ${SURF.foamMix[1].toFixed(3)};
const SU_FB0 = ${SURF.foamBias[0].toFixed(3)}; const SU_FB1 = ${SURF.foamBias[1].toFixed(3)}; const SU_FSPAN = ${SURF.foamSpan.toFixed(4)};
const SU_ON0 = ${SURF.onset[0].toFixed(2)}; const SU_ON1 = ${SURF.onset[1].toFixed(2)};
const SU_FTINT = vec3f(${SURF.foamTint.map((v) => v.toFixed(3)).join(', ')}); const SU_FBRIGHT = ${SURF.foamBright.toFixed(3)};
const SU_SSS = ${SURF.sssPeak.toFixed(3)}; const SU_CREST = ${SURF.crestM.toFixed(3)}; const SU_THIN = ${SURF.thin.toFixed(3)};
const SU_GFLOOR = ${SURF.glintFloor.toFixed(4)}; const SU_FACETS = ${SURF.facets.toFixed(1)}; const SU_RATE = ${SURF.rate.toFixed(3)};
const SU_MMAX = ${SURF.mMax.toFixed(2)}; const SU_CELL = ${SURF.cellLog.toFixed(1)}; const SU_GLITTER = ${SURF.glitter.toFixed(3)};
const SU_GN0 = ${SURF.glitterNear[0].toFixed(1)}; const SU_GN1 = ${SURF.glitterNear[1].toFixed(1)}; const SU_MASK = ${SURF.maskFloor.toFixed(3)};
const SU_FCELL = ${SURF.foldCell.toFixed(3)}; const SU_FR_C = ${Math.cos(SURF.foldRot).toFixed(6)}; const SU_FR_S = ${Math.sin(SURF.foldRot).toFixed(6)}; const SU_FEDGE = ${SURF.foldEdge.toFixed(3)};
const SU_FCY0 = ${SURF.foldCycle[0].toFixed(2)}; const SU_FCY1 = ${SURF.foldCycle[1].toFixed(2)}; const SU_FO0 = ${SURF.foldOpen[0].toFixed(3)}; const SU_FO1 = ${SURF.foldOpen[1].toFixed(3)}; const SU_FOF = ${SURF.foldOpen[2].toFixed(3)};
const SU_FFAR0 = ${SURF.foldFar[0].toFixed(3)}; const SU_FFAR1 = ${SURF.foldFar[1].toFixed(3)}; const SU_FFARK = ${SURF.foldFar[2].toFixed(3)};
struct Surf { hs: vec4f, share: vec4f, reach: vec4f }   // hs.xyz each displacement tile's Hs at the boat (m), hs.w the parts on (SURF_BITS; 0: the water before); share.xyz the boat's bay shares, share.w the whitecaps' J0; reach.xy the slope gain's reach on the 85 and 12 m tiles (m of footprint)
fn suOn(bit: u32) -> bool { return (u32(SU.hs.w) & bit) != 0u; }`;
// the parts, one bit each (render/water.js water.m1bits: the ablations and the per-part A/B; water.m1 = true sets them all)
export const SURF_BITS = Object.freeze({ boost: 1, mtf: 2, near: 4, mask: 8, glint: 16, glitter: 32, foam: 64, sss: 128, boostMirror: 256 });
export const SURF_ALL = Object.values(SURF_BITS).reduce((a, b) => a | b, 0);
// the default: every part but boostMirror (the slope gain on the mirror's mean ray too, v1's: the reflection's lookups then
// swing with the doubled slope and the flicker metric's jumps at the 12 m start pose rose 0.53 % → 1.86 %; on the Fresnel, the
// glint and the roughness alone, 0.54 %: the broad, steady mirror the owner asked for keeps its ray)
export const SURF_DEFAULT = SURF_ALL & ~SURF_BITS.boostMirror;
export const SURF_FNS_WGSL = `
fn slopeBoost(s: f32, k2m1: f32) -> f32 { return sqrt(1.0 + k2m1 * clamp(s, 0.0, 1.0)); }   // k2m1: the gain² − 1 (SU.reach.zw)
fn mtfMod(eta: f32, hs: f32) -> f32 { return clamp(1.0 + SU_MTF * eta / max(hs, 0.03), SU_MTF_LO, SU_MTF_HI); }
// v1's Smith masking for Beckmann slopes on the mirror (src/water.js: Λ by Abramowitz–Stegun 7.1.26's erf), floored at 0.45 (the
// light a facet masks still leaves the surface off the next wave); m2 the total mean-square slope
fn smithMask(nv: f32, m2: f32) -> f32 {
  let am = max(nv, 0.001) / (sqrt(max(1.0 - nv * nv, 1e-6)) * sqrt(max(m2, 1e-6)));
  let t = 1.0 / (1.0 + 0.3275911 * am);
  let ex = exp(-am * am);
  let erf = 1.0 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * ex;
  let lam = (erf - 1.0) * 0.5 + ex / (am * 3.5449077);
  return max(1.0 / (lam + 1.0), SU_MASK);
}
fn foamCover(d: f32, p: f32) -> f32 { return select(0.0, smoothstep(SU_FB0 - d, SU_FB1 - d, p) * sqrt(d), d > 0.0); }
// Ultra's sun lobe: its height-correlated Smith visibility, Schlick and floor (α ≥ 0.015: the sun a small area light) over
// the total mean-square slope a2; the distribution v1's Beckmann, not Ultra's GGX: GGX's long tails greyed the whole noon sea
// round the path (the follow camera's near deep water left the navy: hue −79° → −84°, chroma 31.5 → 28.1; frameLook.page.mjs)
fn glintGGX(n: vec3f, v: vec3f, l: vec3f, a2in: f32) -> vec4f {
  let a2 = max(a2in, SU_GFLOOR * SU_GFLOOR);
  // nv floored at 0.1 (v1's glint: a grazing facet's 1 / nv lit single pixels at dusk, the path's jumps)
  let h = normalize(l + v); let nh = max(dot(n, h), 1e-3); let nl = max(dot(n, l), 0.0); let nv = max(dot(n, v), 0.1); let vh = max(dot(v, h), 0.0);
  let nh2 = nh * nh; let D = exp(-(1.0 - nh2) / (nh2 * a2)) / (PI * a2 * nh2 * nh2);
  let vis = 0.5 / (nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2) + 1e-5);
  let fs = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
  return vec4f(min(D * vis * fs * nl, 40.0), D, nh, vh);
}
fn suHash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// Ultra's Poisson count with mean lam from one uniform number (inverse CDF; a logistic normal for large means)
fn suPoisson(lam: f32, u: f32) -> f32 {
  if (lam > 6.0) { return max(0.0, lam + sqrt(lam) * log(u / (1.0 - u)) / 1.702); }
  var p = exp(-lam); var F = p; var n = 0.0;
  for (var k = 0; k < 14; k++) { if (u <= F) { break; } n += 1.0; p *= lam / n; F += p; }
  return n;
}
// Ultra's glitter: the lobe as a finite number of facets per cell (mean 1, the energy kept); the twinkle smoothed (SURF)
fn glitter(xz: vec2f, fw: f32, D: f32, nh: f32, vh: f32, t: f32) -> f32 {
  let lf = log2(max(fw, 1e-3)) + 1.0 + SU_CELL; let l0 = floor(lf);
  let per = SU_FACETS * D * nh * 6.8e-5 / (4.0 * max(vh, 0.05));
  var m = 0.0;
  for (var j = 0; j < 2; j++) {
    let l = l0 + f32(j); let sz = exp2(l); let cell = floor(xz / sz); let lam = per * sz * sz;
    let tt = t * SU_RATE + suHash12(cell + l * 17.17) * 64.0; let it = floor(tt);
    let n0 = suPoisson(lam, clamp(suHash12(cell * 1.31 + it * 3.7), 1e-4, 0.9999));
    let n1 = suPoisson(lam, clamp(suHash12(cell * 1.31 + (it + 1.0) * 3.7), 1e-4, 0.9999));
    m += select(lf - l0, 1.0 - (lf - l0), j == 0) * min(mix(n0, n1, smoothstep(0.0, 1.0, tt - it)) / max(lam, 1e-4), SU_MMAX);
  }
  return m;
}
// the whitecaps' fold on the 12 m tile (SURF.foldCell): x the turbulence at the cell's own place in the tile (1: no fold),
// y the weight on its foam's density (0 at the cell's edges and while its clock holds the fold back, 1 open); xz the warped
// point, L the tile (m), gx gy its derivatives, damp the depth's calm, t the time (s)
fn foldGate(id: vec2f, t: f32) -> f32 {
  let u = fract(t / mix(SU_FCY0, SU_FCY1, suHash12(id * 0.79 + 19.3)) + suHash12(id * 2.31 + 5.7));
  return smoothstep(SU_FO0 - SU_FOF, SU_FO0, u) * (1.0 - smoothstep(SU_FO1, SU_FO1 + SU_FOF, u));
}
fn foldCells(xz: vec2f, L: f32, layer: i32, gx: vec2f, gy: vec2f, damp: f32, t: f32) -> vec2f {
  let q = vec2f(SU_FR_C * xz.x - SU_FR_S * xz.y, SU_FR_S * xz.x + SU_FR_C * xz.y) / SU_FCELL;
  let id = floor(q); let f = q - id;
  let off = vec2f(suHash12(id + 0.37), suHash12(id * 1.73 + 11.1)) * L;
  let e = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let tb = textureSampleGrad(tDisp, sRep, (xz + off) / L, layer, gx / L, gy / L).w;
  return vec2f(mix(1.0, tb, damp), smoothstep(0.0, SU_FEDGE, e) * foldGate(id, t));
}`;

// 5: Ultra's foam bake (bakeTextures.js FOAM) as a compute pass at load: R the lace pattern (coverage by erosion), G the
// whitewater billow height, BA its gradient per tile (0.5 + d/duv / 64); tileable, then box-filtered mips (render/water.js MIP_WGSL);
// into layer `layer` of the array
export const FOAM_BAKE_WGSL = (layer) => `
@group(0) @binding(0) var dst: texture_storage_2d_array<rgba16float, write>;
fn hash22(p: vec2f) -> vec2f { var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
fn modp(x: vec2f, p: f32) -> vec2f { return x - p * floor(x / p); }
fn voronoi(p: vec2f, period: f32) -> vec2f {
  let i = floor(p); let f = fract(p); var f1 = 8.0; var f2 = 8.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = vec2f(f32(x), f32(y)); let o = hash22(modp(i + g, period)); let d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  } }
  return vec2f(f1, f2);
}
// cauliflower whitewater: every Voronoi cell bulges (a dome over the distance to its edge, creased where cells meet), three scales
fn billow(uv: vec2f) -> f32 {
  let a = voronoi(uv * 7.0 + 0.3, 7.0); let b = voronoi(uv * 17.0 + 0.7, 17.0); let c = voronoi(uv * 41.0 + 0.1, 41.0);
  return 0.5 * sqrt(clamp((a.y - a.x) * 2.2, 0.0, 1.0)) + 0.32 * sqrt(clamp((b.y - b.x) * 2.2, 0.0, 1.0)) + 0.18 * sqrt(clamp((c.y - c.x) * 2.2, 0.0, 1.0));
}
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= ${FOAM_TEX}u || g.y >= ${FOAM_TEX}u) { return; }
  let uv = (vec2f(g.xy) + 0.5) / ${FOAM_TEX}.0;
  let a = voronoi(uv * 9.0, 9.0); let b = voronoi(uv * 23.0 + 0.5, 23.0); let c = voronoi(uv * 61.0, 61.0);
  let lace = 1.0 - smoothstep(0.0, 0.22, a.y - a.x);
  let fine = 1.0 - smoothstep(0.0, 0.16, b.y - b.x);
  let bubbles = 1.0 - smoothstep(0.15, 0.55, c.x);   // GLSL smoothstep(0.55, 0.15, x): the edges in order (WGSL)
  let v = lace * 0.55 + fine * 0.3 + bubbles * 0.25 + (1.0 - a.x) * 0.25;
  let e = 1.0 / 1024.0;
  let gr = vec2f(billow(uv + vec2f(e, 0.0)) - billow(uv - vec2f(e, 0.0)), billow(uv + vec2f(0.0, e)) - billow(uv - vec2f(0.0, e))) / (2.0 * e);
  textureStore(dst, vec2i(g.xy), ${layer}, vec4f(clamp(v * 0.85, 0.0, 1.0), billow(uv), clamp(0.5 + gr / 64.0, vec2f(0.0), vec2f(1.0))));
}`;
