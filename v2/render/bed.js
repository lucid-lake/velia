// The lake bed through Tahoe's clear water (M5c): v1's clarity bed (src/waters/clarity.js, owner-approved on cam I) in
// WGSL for the terrain pass, which draws the bed as geometry under the water surface (render/terrain.js).
//   - the detail: pale decomposed-granite sand with wave ripples in patches, rounded granite boulders and cobbles (one
//     jittered candidate a cell per layer, so each pixel reads one cell), each lit by the refracted sun on its own normal,
//     with a contact shade on the sand and a shadeC shadow; a brown-green film on the rocks' tops in the shallows;
//   - sun caustics (ultra M2, replacing M5c's two drifting Worley nets): the light the 12 m cascade's waves focus,
//     splatted each frame by render/caustics.js (Ultra-Water's area-ratio method) and read here at the sun's entry
//     point, at the bed's depth, the pixel's footprint and the sun disc's blur; mean 1 (no light added, only gathered);
//   - the refraction wobble: the detail is read at the bed point the view reaches through a calmed surface normal (the
//     FFT slope × WOBBLE), so the stones sway with the waves, as v1's;
//   - the image fades with the path up to the eye (IMAGE_SCATTER), the mean light still comes through (T), so the hue
//     still runs sand → turquoise → navy; boulders fade at half the rate (the first thing a player sees);
//   - the shelf's look (SHELF): v1's water tints its body by bed depth (src/water.js WATER_LOOK: a turquoise shelf easing
//     into the deep over 6–16 m). v2's deep body is the brand's sampled navy (render/water.js, kept), so the tint here
//     is relative: the shallows' upwelling light × tint × gain, easing to 1 by the deep.
//   The numbers are v1's (src/waters/clarity-optics.js BED, CAUSTIC_LINE, IMAGE_SCATTER, DIRECT_SHARE, N_WATER): one
//   source for both engines; v2/tests/bed.test.mjs holds the twins.
import { BED, CAUSTIC_LINE, IMAGE_SCATTER, DIRECT_SHARE, N_WATER, causticMean, boulderFits } from '../../src/waters/clarity-optics.js';
import { CAUSTIC_WGSL } from './caustics.js';
import { BIG } from '../sim/bedBoulders.js';

export { BED, CAUSTIC_LINE, IMAGE_SCATTER, DIRECT_SHARE, N_WATER, causticMean, boulderFits };
export const WOBBLE = 0.06;        // how much of the surface's slope the bed's detail is read through (v1)
export const NEAR_BLUR = 0.4;      // m: the blur (the pixel's footprint plus a rough surface's) past which the bed is the plain bed (v1: 0.6; 0.4 here keeps the Sail start's 2560 × 1600 frame in budget, the detail past it is under a pixel)
// v1's body tint by bed depth (src/water.js WATER_LOOK, S5: the water body × shelf easing into deep over
// shelfM..deepM; that file imports three, so the numbers are copied here), and the relative form the bed uses: the tint
// over its deep value, so v2's deep body (the owner's navy) is untouched and the shelf and the drop-off turn as v1's
export const WATER_LOOK = Object.freeze({ shelf: [0.62, 1.85, 1.12], deep: [0.5, 2.6, 3.2], shelfM: 6, deepM: 16 });
// v1's light entering the water is its horizon sky's colour (src/water.js: E = horizon × 0.9 + sun × 0.08, a blue-white
// radiance in v1's own HDR scale, under v1's AgX); v2's is the physical sun + sky irradiance (white, the deep body is
// calibrated on it). The same tint ratio under a white E turns the shelf sand-yellow (tried 2026-11-13: cam I's near
// shore (125, 140, 96) against v1's (15, 102, 98)), so the entering light's balance is set once, against v1's cam I
// samples, as ENTER (the shelf's relative tint × the balance); the band from the shelf to the deep keeps v1's shape
export const ENTER = Object.freeze([0.032, 0.54, 1.04]);   // the horizon-blue balance of v1's E, relative to v2's white E (fitted on cam I: the shelf's hue, then × 0.8 for its level)
// (owner, 2026-11-18: the Emerald Bay photos, "the similar clear water, big stone effect"): the shallows are a
// green-teal (the photos' sand under 2-6 m reads G over B by 1.0-1.15, ours 0.97), the teal holds deeper (to about 9 m)
// and turns to v2's navy over a shorter band (9-16 m: the photos' sharp drop-off); the navy past 16 m is untouched
export const PHOTO_LOOK = Object.freeze({
  green: 1.12,       // the shelf tint's green over v1's (its blue and red kept)
  shelfM: 9,         // m: the teal holds to here (v1's WATER_LOOK.shelfM 6), then eases to 1 by deepM (16 m, unchanged)
  // the bed's boulders: granite under a mossy periphyton film, dark green-teal tops (the photos' boulder tops read 0.6-0.8 of
  // the sand between them, greener), about one in six a paler, cleaner grey granite; linear albedo
  moss: [0.20, 0.30, 0.17], mossDark: [0.10, 0.17, 0.10], pale: [0.50, 0.49, 0.42],
});
export const TINT_SHELF = WATER_LOOK.shelf.map((c, i) => c / WATER_LOOK.deep[i] * ENTER[i] * (i === 1 ? PHOTO_LOOK.green : 1));
// BIG (the big-boulder bed's numbers) lives in sim/bedBoulders.js beside the 3D stones that share it (refactor round 3 C6)
export { BIG };
// No mid-water tint (owner, 2026-11-13, on round 4's "brighter mid water": "it is not real and uncomfortable to the eye"):
// past the shelf tint's end (deepM, 16 m) every depth is v2's own navy, in the bay as in the open lake. Round 4's
// TINT_MID (v1's luminous blue over 8–60 m) is removed here and in the surface's body (render/water.js).
// the plain column's bed past the shelf: M2's silt (render/terrain.js ALBEDO.silt, copied: terrain.js imports this file),
// eased in over `band` m of bed depth (M2 eased 4–25 m; 12 m keeps round 2's sand under the whole shelf tint)
export const SILT = Object.freeze({ albedo: [0.20, 0.19, 0.16], band: [12, 25] });
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the bed's far mean (the shader's bedMeanAlbedo): the sand with the boulders' share in their mean tone; rocky 0-1 (the
// shader's BG_FLATS..1 by the bed's slope), big: the desktop's two layers (else v1's one layer, BIG.coverLite)
// the packed field's density with depth (the shader's bigDepthK): 1 to depthPack, deepShare by depthFull, 0 by depthNone
// the moraine zones' weight at (x, z) (the WGSL bedMoraine's twin)
export const bedMoraine = (x, z) => Math.max(0, ...BIG.moraine.zones.map(([cx, cz, r]) => 1 - sm(r * (1 - BIG.moraine.edge), r, Math.hypot(x - cx, z - cz))));
export const bigDepthK = (dep) => (1 + (BIG.deepShare - 1) * sm(BIG.depthPack, BIG.depthFull, dep)) * (1 - sm(BIG.depthFull, BIG.depthNone, dep));
export const ROCK_MEAN = PHOTO_LOOK.moss.map((c, i) => c * 0.55 + PHOTO_LOOK.mossDark[i] * 0.45);
export function bedMean(dep, { rocky = 1, big = true } = {}) {
  const k = big ? BIG.cover * rocky * bigDepthK(dep) : BIG.coverLite * (1 - sm(BED.boulders.depthFull, BED.boulders.depthNone, dep));
  return BED.mean.map((c, i) => c * (1 - k) + ROCK_MEAN[i] * k);
}
// the plain column's bed albedo at a depth (the shader's aPlain); o: bedMean's (none given: the bare sand, no boulders)
export const plainAlbedo = (dep, o = null) => { const k = sm(SILT.band[0], SILT.band[1], dep); const m = o ? bedMean(dep, o) : BED.mean; return m.map((c, i) => c * (1 - k) + SILT.albedo[i] * k); };
export function bodyTint(dep, L = WATER_LOOK) {
  const k = sm(PHOTO_LOOK.shelfM, L.deepM, dep);
  return TINT_SHELF.map((c) => c * (1 - k) + k);
}
// the pixel's share of the bed's detail (the shader's wNear): 1 when its footprint plus the surface's blur resolves the
// bed, 0 past NEAR_BLUR of blur or 24 m of depth
export function nearWeight(footprintM, depM, sigma2 = 0.0005) {
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const blur = footprintM + depM * Math.sqrt(sigma2) * 0.15;
  return (1 - sm(NEAR_BLUR * 0.3, NEAR_BLUR, blur)) * (1 - sm(18, 24, depM));
}

const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;

// the water's cascade warp (render/water.js reads the slope cascades 1–3 through it; the same text, so the bed reads the
// slope the surface draws)
export const WARP_WGSL = `
fn warpOf(x: f32, z: f32) -> vec2f {
  return vec2f(2.5 * sin(0.0419 * z + 0.0113 * x + 1.3) + sin(0.113 * x - 0.071 * z + 0.7),
               2.5 * sin(0.0377 * x - 0.0097 * z + 0.4) + sin(0.097 * z + 0.083 * x + 2.1));
}`;

// needs: F (Frame), tWSlope + sSlope (the water's slope cascades), tCaustic (render/caustics.js, read with sSlope), vnoise(vec2f)
// (terrain.js NOISE_WGSL), NW, PI, bedHeightAt(xz, fallback) (terrain.js: the bay level's heights, from its storage buffer)
// the cell hash the painted stones are placed by; render/rocks.js places the 3D stones by the same text (feat/v2-boulders-3d),
// so each 3D stone stands on its painted twin
export const BED_HASH_WGSL = `fn hash2(p: vec2f) -> vec2f { return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453); }`;
// the painted big layer's stone in a cell (bedLayer's first lines and the BIG branch's density, the same expressions): its
// centre, radius, the presence hash and the stretch; the 3D scatter (render/rocks.js) calls it at the cell's centre
export const BED_CELL_WGSL = `
struct BedCell { c: vec2f, r: f32, hx: f32, st: f32 }
fn bedCellAt(id: vec2f, cell: f32, rMin: f32, rMax: f32, salt: f32) -> BedCell {
  let h1 = hash2(id + salt); let h2 = hash2(id + salt + 17.31);
  let r = mix(rMin, rMax, h1.y);
  let room = max(cell * 0.5 - r, 0.0);
  var o: BedCell; o.c = (id + 0.5) * cell + (h2 - 0.5) * 2.0 * room; o.r = r; o.hx = h1.x; o.st = mix(0.78, 1.22, h2.y);
  return o;
}
fn bedPatchy(pd: vec2f) -> f32 { return smoothstep(0.25, 0.75, (sin(pd.x * 0.021 + 1.3) * sin(pd.y * 0.017 - 0.4) + sin((pd.x + pd.y) * 0.013 + 2.1)) * 0.25 + 0.5); }`;
// the moraine zones (BIG.moraine) as WGSL: the paint (bedWgsl) and the 3D scatter (render/rocks.js) read the same text
export const BED_MORAINE_WGSL = `
// 1 inside a zone, soft over its edge, 0 outside (× k by the callers' rocky)
fn bedMoraine(p: vec2f) -> f32 {
  var m = 0.0;
${BIG.moraine.zones.map(([x, z, r]) => `  m = max(m, 1.0 - smoothstep(${(r * (1 - BIG.moraine.edge)).toFixed(1)}, ${r.toFixed(1)}, distance(p, vec2f(${x.toFixed(1)}, ${z.toFixed(1)}))));`).join('\n')}
  return m;
}`;
export const bedWgsl = ({ big = true } = {}) => `
const BED_BIG = ${big ? 'true' : 'false'};
const BG_CELL1 = ${BIG.layers[0].cell}; const BG_R01 = ${BIG.layers[0].rMin}; const BG_R11 = ${BIG.layers[0].rMax}; const BG_FLAT1 = ${BIG.layers[0].flat}; const BG_DENS1 = ${BIG.layers[0].density}; const BG_SALT1 = ${BIG.layers[0].salt};
const BG_CELL2 = ${BIG.layers[1].cell}; const BG_R02 = ${BIG.layers[1].rMin}; const BG_R12 = ${BIG.layers[1].rMax}; const BG_FLAT2 = ${BIG.layers[1].flat}; const BG_DENS2 = ${BIG.layers[1].density}; const BG_SALT2 = ${BIG.layers[1].salt};
const BG_D0 = ${BIG.depthFull}.0; const BG_D1 = ${BIG.depthNone}.0; const BG_DP = ${BIG.depthPack}.0; const BG_DS = ${BIG.deepShare}; const BG_PATCHY = ${BIG.patchy}; const BG_ROCKY0 = ${BIG.rocky[0]}; const BG_ROCKY1 = ${BIG.rocky[1]}; const BG_FLATS = ${BIG.flats};
const BG_BLUR = ${BIG.blur}; const BG_BLUR2 = ${BIG.blur2}; const BG_BLUR3 = ${BIG.blur3};
const BG_CELL4 = ${BIG.layers[3].cell}; const BG_R04 = ${BIG.layers[3].rMin}; const BG_R14 = ${BIG.layers[3].rMax}; const BG_FLAT4 = ${BIG.layers[3].flat}; const BG_DENS4 = ${BIG.layers[3].density}; const BG_SALT4 = ${BIG.layers[3].salt};
const BG_CELL3 = ${BIG.layers[2].cell}; const BG_R03 = ${BIG.layers[2].rMin}; const BG_R13 = ${BIG.layers[2].rMax}; const BG_FLAT3 = ${BIG.layers[2].flat}; const BG_DENS3 = ${BIG.layers[2].density}; const BG_SALT3 = ${BIG.layers[2].salt}; const BG_LUMP = ${BIG.lump}; const BG_COVER = ${(big ? BIG.cover : BIG.coverLite).toFixed(3)};
const PL_MOSS = ${v3(PHOTO_LOOK.moss)}; const PL_MOSSD = ${v3(PHOTO_LOOK.mossDark)}; const PL_PALE = ${v3(PHOTO_LOOK.pale)};
const WOBBLE = ${WOBBLE}; const NEAR_BLUR = ${NEAR_BLUR};
const ISCAT = ${IMAGE_SCATTER}; const DSHARE = ${DIRECT_SHARE};
const BSAND = ${v3(BED.sand)}; const BMEAN = ${v3(BED.mean)}; const BGRAN = ${v3(BED.granite)}; const BGRAND = ${v3(BED.graniteDark)};
const BSILT = ${v3(SILT.albedo)}; const SILT_M0 = ${SILT.band[0]}.0; const SILT_M1 = ${SILT.band[1]}.0;
const BLICH = ${v3(BED.lichen)}; const BFILM = ${v3(BED.film)};
const BO_CELL = ${BED.boulders.cell}; const BO_R0 = ${BED.boulders.rMin}; const BO_R1 = ${BED.boulders.rMax}; const BO_FLAT = ${BED.boulders.flat}; const BO_DENS = ${BED.boulders.density}; const BO_D0 = ${BED.boulders.depthFull}.0; const BO_D1 = ${BED.boulders.depthNone}.0;
const CO_CELL = ${BED.cobbles.cell}; const CO_R0 = ${BED.cobbles.rMin}; const CO_R1 = ${BED.cobbles.rMax}; const CO_FLAT = ${BED.cobbles.flat}; const CO_D0 = ${BED.cobbles.depthFull}; const CO_D1 = ${BED.cobbles.depthNone}.0;
const RP_L0 = ${BED.ripples.lambda[0]}; const RP_L1 = ${BED.ripples.lambda[1]}; const RP_TURN = ${BED.ripples.turn}; const RP_WARP = ${BED.ripples.warp}; const RP_WS = ${BED.ripples.warpScale};
const TINT_SHELF = ${v3(TINT_SHELF)}; const TINT_M0 = ${PHOTO_LOOK.shelfM}.0; const TINT_M1 = ${WATER_LOOK.deepM}.0;
const RP_D0 = ${BED.ripples.depthFull}.0; const RP_D1 = ${BED.ripples.depthNone}.0; const RP_TILT = ${BED.ripples.tilt}; const RP_ALB = ${BED.ripples.albedo};
${WARP_WGSL}
${CAUSTIC_WGSL}
${BED_HASH_WGSL}
${BED_MORAINE_WGSL}
// one rounded-boulder layer at bed point p: inside (soft), height, normal, tone, shadeC + contact shade (v1's layer())
struct BL { m: f32, h: f32, n: vec3f, tone: f32, shadeC: f32, contact: f32 }
fn bedLayer(p: vec2f, cell: f32, rMin: f32, rMax: f32, flat: f32, even: bool, salt: f32, density: f32, sunU: vec3f, soft: f32, lump: f32) -> BL {
  let id = floor(p / cell);
  let h1 = hash2(id + salt); let h2 = hash2(id + salt + 17.31);
  let r = mix(rMin, rMax, select(h1.y * h1.y, h1.y, even));   // cobbles: many small, a few big; boulders: even
  let pres = 1.0 - step(density, h1.x);
  let room = max(cell * 0.5 - r, 0.0);
  let c = (id + 0.5) * cell + (h2 - 0.5) * 2.0 * room;
  let q0 = p - c;
  let a = r * flat;
  let off = vec2f(sunU.x, sunU.z) / sunU.y * (a * 0.6);
  // cost: nothing to draw in an empty cell, or past the contact ring (rho2 2.4) and the shadow's disk: the
  // stretch keeps at least 0.78 of a distance, the lumps move the rim at most 0.23 r × lump
  let reach = max((1.55 + 0.23 * lump) * r, (1.0 + 0.23 * lump) * r + length(off)) / 0.78;
  if (pres == 0.0 || dot(q0, q0) > reach * reach) { return BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), h2.x, 0.0, 0.0); }
  // not a disc: stretched one way, lumpy round its rim
  let st = mix(0.78, 1.22, h2.y);
  let q1 = vec2f(q0.x * st, q0.y / st);
  let q = q1 + vec2f(sin(q1.y / r * 2.3 + h1.x * 40.0), sin(q1.x / r * 1.9 + h2.x * 40.0)) * (r * 0.16 * lump)
             + vec2f(sin(q1.y / r * 5.1 + h2.y * 30.0), sin(q1.x / r * 4.7 + h1.y * 30.0)) * (r * 0.07 * lump);
  let rho2 = dot(q, q) / (r * r);
  let inn = clamp(1.0 - rho2, 0.0, 1.0); let sq = sqrt(inn);
  let m = (1.0 - smoothstep(1.0 - max(0.1, soft / r), 1.0, rho2)) * pres;   // soft: the edge widens with the pixel's footprint (m), so a far stone never shimmers
  let n = normalize(vec3f(q.x, r * sq / flat + 1e-3, q.y));
  // the dome's shadeC shadow on the sand: a disk shifted away from the sun by 0.6 of its height along the refracted sun (off)
  let qs = q + off; let shadeC = (1.0 - smoothstep(0.75, 1.0, dot(qs, qs) / (r * r))) * pres * (1.0 - m);
  let contact = (1.0 - smoothstep(1.0, 2.4, rho2)) * pres * (1.0 - m);   // a soft dark ring where sand meets rock
  return BL(m, a * sq * pres, n, h2.x, shadeC, contact);
}
// rock (the Emerald Bay photos): granite under a mossy periphyton film, dark green-teal, each stone its own
// shade, about one in six a paler, cleaner grey granite; a speckle and a weathered blotch; the film thins on the steep flanks
fn rockAlbedo(p: vec2f, L: BL, blur: f32, dep: f32) -> vec3f {
  let speck = sin(p.x * 7.3 + L.tone * 20.0) * sin(p.y * 6.1 - L.tone * 13.0) * (0.12 * (1.0 - smoothstep(0.03, 0.1, blur))) + 1.0;
  let blotch = (sin(p.x * 1.7 + L.tone * 31.0) * sin(p.y * 1.3 - L.tone * 17.0) + sin((p.x + p.y) * 3.3 + L.tone * 9.0) * 0.5) * 0.12 * (1.0 - smoothstep(0.3, 1.0, blur)) + 1.0;
  let moss = mix(PL_MOSS, PL_MOSSD, smoothstep(0.0, 0.8, L.tone));
  let flank = mix(PL_PALE * 0.7, moss, smoothstep(0.25, 0.7, L.n.y));   // the steep flanks show more of the bare grey granite
  return mix(flank, PL_PALE, smoothstep(0.82, 0.86, L.tone)) * blotch * speck;
}
// the far mean of the bed under the column: the sand with the boulders' share in their mean tone (a rocky shore's green band)
// the packed field's density with depth (bigDepthK in JS)
fn bigDepthK(dep: f32) -> f32 { return mix(1.0, BG_DS, smoothstep(BG_DP, BG_D0, dep)) * (1.0 - smoothstep(BG_D0, BG_D1, dep)); }
fn bedMeanAlbedo(dep: f32, rocky: f32) -> vec3f {
  let rockMean = mix(PL_MOSS, PL_MOSSD, 0.45);
  var k = BG_COVER * (1.0 - smoothstep(BO_D0, BO_D1, dep));
  if (BED_BIG) { k = BG_COVER * rocky * bigDepthK(dep); }
  return mix(BMEAN, rockMean, k);
}
// the water's slope under the eye ray's surface crossing (the four FFT cascades, as the surface draws them): xy the
// slope, z the slope variance (the mips' second moments; the surface's roughness)
fn surfaceSlope(sp: vec2f, lod: f32) -> vec3f {
  let w = warpOf(sp.x, sp.y);
  var sl = vec2f(0.0); var sl2 = vec2f(0.0);
  for (var c = 0u; c < 4u; c++) {
    let L = F.water[c];
    var xz = sp; if (c > 0u) { xz += w; }
    let s4 = textureSampleLevel(tWSlope, sSlope, xz / L, i32(c), lod);
    sl += s4.xy; sl2 += s4.zw;
  }
  let vr = max(sl2 - sl * sl, vec2f(0.0));
  return vec3f(sl, 0.5 * (vr.x + vr.y) + 0.0005);
}
// the bed's upwelling radiance (before the air) at bed point p (y < 0): A0 the baked bed albedo, E the light entering
// the water (sun + sky irradiance on the surface), s the sun, V toward the eye, fp the pixel's footprint on the bed (m),
// tScene the sim time; the result is v1's bedLight × albedo × T + E × R∞ × (1 − T), the shelf's look on top
fn bedRadiance(p: vec3f, A0: vec3f, nBed: vec3f, E: vec3f, s: vec3f, V: vec3f, fpHit: f32, tScene: f32) -> vec3f {
  // the surface point the eye ray crosses
  let above = F.cam.y > 0.05;
  let t = F.cam.y / max(F.cam.y - p.y, 1e-3);
  let sp = select(p.xz, F.cam.xz + (p.xz - F.cam.xz) * t, above);
  // The bed the eye sees through the surface (fix(v2) bed edges, 2026-11-13): the terrain pass rasterises the bed along
  // the straight eye ray, but the water bends that ray down (Snell: 49 deg from the vertical at grazing). From a low eye
  // the straight ray runs on under the surface and meets the bed far away: past every lip (a shelf's edge, a rise) the
  // pixel showed the deep floor hundreds of metres on, so each lip drew as a hard navy horizon line, straight where
  // the contour is straight (the shelves off Fannette, the north shore). v1 reads the bed where the refracted ray
  // lands (src/water.js dBed, one fixed-point step); so does the column here: the depth under the crossing, then at
  // the refracted landing (two height reads), and the detail and the caustics at that landing. Looking down, the
  // landing is the hit point to within the refraction's shift.
  let tr0 = refract(-V, vec3f(0.0, 1.0, 0.0), 1.0 / NW);
  let run = tr0.xz / max(-tr0.y, 0.05);   // horizontal metres per metre of depth along the refracted view
  var dep = -p.y;
  var pb = p.xz;
  if (above) {
    let d0 = clamp(-bedHeightAt(sp, p.y), 0.05, 400.0);
    let q0 = sp + run * d0;
    dep = clamp(-bedHeightAt(q0, p.y), 0.05, 400.0);
    pb = sp + run * dep;
  }
  // the pixel's footprint on that bed: the drawn footprint scaled from the straight ray's length to the refracted path's
  // (the eye to the surface crossing, then the depth): the beam keeps the surface's stretch at a low angle, so the detail
  // ends where it did before, but it fades with the distance to the bed the eye sees, not along the lip the straight ray
  // passes (past a lip the straight ray's footprint was the far floor's, hundreds of metres on)
  let distHit = max(distance(F.cam.xyz, p), 1e-3);
  let fp = select(fpHit, fpHit * min(1.0, (distance(F.cam.xyz, vec3f(sp.x, 0.0, sp.y)) + dep) / distHit), above);
  // the slopes: the four cascades where the pixel could resolve the bed, else one (the 85 m tile) for the wave wobble of
  // the depth the optics see (the four taps on every bed pixel cost 2 ms a frame at 2560 × 1600 over the bay)
  let lod = log2(max(fp * 128.0 / 12.0, 1.0));
  let wNear0 = (1.0 - smoothstep(NEAR_BLUR * 0.3, NEAR_BLUR, fp)) * (1.0 - smoothstep(18.0, 24.0, dep)) * M.bed.w;
  var ss = vec3f(0.0, 0.0, 0.0005);
  let grad = -nBed.xz / max(nBed.y, 0.2);
  if (wNear0 > 0.0) { ss = surfaceSlope(sp, lod); }
  else if (dep < 30.0 && fp < 2.0 && dot(grad, grad) > 0.01) { let w1 = warpOf(sp.x, sp.y); ss = vec3f(textureSampleLevel(tWSlope, sSlope, (sp + w1) / F.water[1], 1, lod).xy, 0.0005); }   // the sway matters only where the bed slopes (a drop-off) and the pixel is fine enough to show it, not on the flat floor
  let sigma2 = ss.z;
  // the refracted view and sun (cosines from the vertical)
  let sinT = sqrt(max(1.0 - V.y * V.y, 0.0)) / NW; let tDown = sqrt(max(1.0 - sinT * sinT, 0.0025));
  let sunDownY = sqrt(max(1.0 - (1.0 - s.y * s.y) / (NW * NW), 0.01));
  let sunU = vec3f(s.x / NW, sunDownY, s.z / NW);
  // v1 reads the bed's depth where the view refracted through the rippled surface lands (src/water.js dBed: the full
  // normal, one fixed-point step), so the depth its column uses sways with the waves and a drop-off is never one crisp
  // line. The bed here is geometry: the same sway comes from the bed's own slope (the baked normal) along the shift the
  // full normal gives against the flat one
  var depOpt = min(dep, 60.0);
  if (ss.x != 0.0 || ss.y != 0.0) {
    let trF = refract(-V, normalize(vec3f(-ss.x, 1.0, -ss.y)), 1.0 / NW); let trZ = refract(-V, vec3f(0.0, 1.0, 0.0), 1.0 / NW);
    let shift = (trF.xz / max(-trF.y, 0.05) - trZ.xz / max(-trZ.y, 0.05)) * dep;
    depOpt = clamp(dep - dot(grad, shift), 0.05, 60.0);
  }
  // the detail the pixel can resolve: its footprint, widened by the blur a rough surface gives a bed dep m down
  let blur = fp + dep * sqrt(sigma2) * 0.15;
  let wNear = (1.0 - smoothstep(NEAR_BLUR * 0.3, NEAR_BLUR, blur)) * (1.0 - smoothstep(18.0, 24.0, dep)) * M.bed.w;
  let fD = smoothstep(0.0, 0.35, s.y) * DSHARE;
  let Esun = E * fD; let Esky = E * (1.0 - fD);
  // the bed's albedo under the column is v1's sand everywhere (src/water.js L1: BED.mean; M2's silt below 4–25 m made the
  // mid-depth bed dark, which is what cut the luminous band over the drop-off); the bake's own noise shade stays
  let shade = clamp(A0 / mix(${v3([0.46, 0.43, 0.36])}, ${v3([0.20, 0.19, 0.16])}, smoothstep(4.0, 25.0, dep)), vec3f(0.7), vec3f(1.3));
  // the bed's slope says where the shore is rocky (the boulders pack there) and where it is a sand flat (the head)
  let rocky = max(mix(BG_FLATS, 1.0, smoothstep(BG_ROCKY0, BG_ROCKY1, length(grad))), bedMoraine(pb) * ${BIG.moraine.k.toFixed(2)});   // the mouth's moraine
  let aMean = bedMeanAlbedo(depOpt, rocky);
  // the big stones resolve farther than the sand's small detail (BG_BLUR: a 3 m stone is still a few pixels); a phone: wNear
  var wDet = wNear;
  if (BED_BIG && M.bed.x > 0.5) { wDet = max(wNear, (1.0 - smoothstep(BG_BLUR * 0.35, BG_BLUR, blur)) * (1.0 - smoothstep(BG_D1 - 1.0, BG_D1 + 2.0, dep)) * M.bed.w); }
  var albedo = aMean * shade; var dirF = 1.0; var amb = 1.0; var dEff = depOpt; var rockM = 0.0; var caust = 1.0;
  var pd = pb;
  if (wDet > 0.0) {
    // the detail's bed point: the view refracted through the calmed normal (the slope x WOBBLE) against the flat one
    let nW = normalize(vec3f(-ss.x * WOBBLE, 1.0, -ss.y * WOBBLE));
    let trW = refract(-V, nW, 1.0 / NW);
    pd = pb + (trW.xz / max(-trW.y, 0.05) - run) * dep;
    let fade = exp(-dep * ISCAT / tDown);
    let fadeBig = sqrt(fade);
    let patchy = smoothstep(0.25, 0.75, (sin(pd.x * 0.021 + 1.3) * sin(pd.y * 0.017 - 0.4) + sin((pd.x + pd.y) * 0.013 + 2.1)) * 0.25 + 0.5);
    var bo: BL;
    if (BED_BIG && M.bed.x > 0.5) {
      // four packed layers (BIG), the highest dome wins where they meet; patchy thins them only a little (the photos' fields are dense)
      let dk = rocky * (patchy * BG_PATCHY + 1.0 - BG_PATCHY) * bigDepthK(dep);
      let b1 = bedLayer(pd, BG_CELL1, BG_R01, BG_R11, BG_FLAT1, true, BG_SALT1, BG_DENS1 * dk, sunU, blur, BG_LUMP);
      var b2 = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
      if (blur < BG_BLUR2) { b2 = bedLayer(pd, BG_CELL2, BG_R02, BG_R12, BG_FLAT2, true, BG_SALT2, BG_DENS2 * dk * (1.0 - smoothstep(BG_BLUR2 * 0.6, BG_BLUR2, blur)), sunU, blur, BG_LUMP); }
      var b3 = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
      var b4 = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
      if (blur < BG_BLUR3) {
        let f3 = BG_DENS3 * dk * (1.0 - smoothstep(BG_BLUR3 * 0.6, BG_BLUR3, blur));
        b3 = bedLayer(pd, BG_CELL3, BG_R03, BG_R13, BG_FLAT3, true, BG_SALT3, f3, sunU, blur, BG_LUMP);
        b4 = bedLayer(pd, BG_CELL4, BG_R04, BG_R14, BG_FLAT4, true, BG_SALT4, f3 * BG_DENS4, sunU, blur, BG_LUMP);
        let m3 = max(b3.m, b4.m); let s3 = max(b3.shadeC * (1.0 - b4.m), b4.shadeC * (1.0 - b3.m)); let c3 = max(b3.contact * (1.0 - b4.m), b4.contact * (1.0 - b3.m));
        if (b4.h > b3.h) { b3 = b4; }
        b3.m = m3; b3.shadeC = s3; b3.contact = c3;   // the third and fourth sets as one (the higher dome's shape)
      }
      if (b1.h >= b2.h) { bo = b1; } else { bo = b2; }
      let m12 = max(b1.m, b2.m);
      let sh12 = max(b1.shadeC * (1.0 - b2.m), b2.shadeC * (1.0 - b1.m)); let ct12 = max(b1.contact * (1.0 - b2.m), b2.contact * (1.0 - b1.m));
      if (b3.h > bo.h) { bo = b3; }
      bo.m = max(m12, b3.m);
      bo.shadeC = max(sh12 * (1.0 - b3.m), b3.shadeC * (1.0 - m12));
      bo.contact = max(ct12 * (1.0 - b3.m), b3.contact * (1.0 - m12));
    } else {
      let dB = BO_DENS * (patchy * 0.5 + 0.5) * (1.0 - smoothstep(BO_D0, BO_D1, dep));
      bo = bedLayer(pd, BO_CELL, BO_R0, BO_R1, BO_FLAT, true, 3.7, dB, sunU, 0.0, 1.0);
    }
    var sandA = BSAND; var nSand = vec3f(0.0, 1.0, 0.0);
    var co = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
    if (wNear > 0.0) {
      let dC = 0.5 * (patchy * 0.6 + 0.4) * (1.0 - smoothstep(CO_D0, CO_D1, dep)) * (1.0 - bo.m) * (1.0 - smoothstep(0.04, 0.12, blur));
      if (blur < 0.12 && M.bed2.x > 0.5) { co = bedLayer(pd, CO_CELL, CO_R0, CO_R1, CO_FLAT, false, 11.9, dC, sunU, 0.0, 1.0); }   // the cobbles only where the pixel can show them (dC is 0 past this blur anyway)
      // sand: a tonal drift and small wave ripples in patches in the wave-washed shallows (two sets on a domain warp)
      let dn = vnoise(pd * 0.3 + vec2f(7.7, 3.1)) * 2.0 - 1.0;
      let drift = dn * 0.12 + 1.0;
      let wq = pd * RP_WS;
      let warp = vec2f(vnoise(wq + vec2f(1.7, 9.2)), vnoise(wq + vec2f(5.3, 2.8))) * 2.0 - 1.0;
      let lead = smoothstep(-0.25, 0.25, vnoise(wq * 0.5 + vec2f(3.3, 7.1)) * 2.0 - 1.0);
      let pw = pd + warp * RP_WARP;
      let d1 = vec2f(0.8, 0.6); let d2 = vec2f(0.8 * cos(RP_TURN) - 0.6 * sin(RP_TURN), 0.8 * sin(RP_TURN) + 0.6 * cos(RP_TURN));
      let ph1 = dot(pw, d1) * (2.0 * PI / RP_L0); let ph2 = dot(pw, d2) * (2.0 * PI / RP_L1) + warp.y * 2.5;
      let rippleFoot = blur;
      let aa1 = 1.0 - smoothstep(0.2 * RP_L0, 0.45 * RP_L0, rippleFoot); let aa2 = 1.0 - smoothstep(0.2 * RP_L1, 0.45 * RP_L1, rippleFoot);
      let ampR = smoothstep(-0.05, 0.3, dn) * (1.0 - smoothstep(RP_D0, RP_D1, dep));
      let hR = mix(sin(ph1) * aa1, sin(ph2) * aa2, lead) * ampR;
      let gR = mix(d1 * (cos(ph1) * aa1), d2 * (cos(ph2) * aa2), lead) * (ampR * RP_TILT);
      // past the sand's own detail (the big stones' far band) the sand eases to its plain tone
      nSand = normalize(vec3f(gR.x * wNear, 1.0, gR.y * wNear));
      sandA = BSAND * mix(1.0, drift * (hR * RP_ALB + 1.0), wNear);
    }
    var a = sandA; if (bo.m > 0.0) { a = mix(sandA, rockAlbedo(pd, bo, blur, dep), bo.m); } var nB = mix(nSand, bo.n, bo.m); var hB = bo.h;
    var shadeC = bo.shadeC; var contact = bo.contact; var rm = bo.m;
    if (co.m > 0.0) { a = mix(a, rockAlbedo(pd, co, blur, dep), co.m); } nB = mix(nB, co.n, co.m); hB = max(hB, co.h);
    shadeC = max(shadeC, co.shadeC); contact = max(contact, co.contact); rm = max(rm, co.m);
    rockM = rm;
    // the baked bed's own tone (sand to silt with depth, its noise) carries the sand's colour: the bed's mean x the bake's shade
    albedo = mix(aMean * shade, a * shade, mix(fade, fadeBig, rm));
    let nn = normalize(nB); let lambert = max(dot(nn, sunU), 0.0) / sunDownY;
    dirF = mix(1.0, lambert * (1.0 - shadeC * 0.85), fadeBig);
    amb = mix(1.0, (1.0 - contact * 0.45) * mix(1.0, nn.y * 0.65 + 0.35, rm), fadeBig);
    dEff = max(depOpt - hB * fade, 0.05);
  }
  // v1's column (src/water.js L1 / clarity-optics bodyRadiance): the path down the refracted sun and up the refracted
  // view, Beer–Lambert per channel, the bed's light × T plus the water's own backscatter R∞ × (1 − T)
  // v1 blends the detailed bed into the plain column by wNear (clarity.js: mix(legacy, nearCol, wNear)); without that
  // blend the detail's edge (a screen-space contour of the footprint) drew as a straight line across the shallows
  // ultra M2: the sun's caustics, splatted from the 12 m cascade (render/caustics.js, Ultra-Water's area-ratio method):
  // the light at the bed point the eye sees (the detail's wobbled point where the bed resolves, eased by wNear), at its
  // depth, blurred to the pixel's footprint and the sun disc's spread; none with the sun down, soft at a low sun, eased in
  // over the first 1.5 m and out past 10 m, its contrast fading as the bed's image does (the path up to the eye)
  let ck = causticStrength(dEff, s.y) * M.bed2.w;
  if (ck > 0.0) {
    let pc = mix(pb, pd, wDet);
    caust = mix(1.0, waveCaustic(pc, dEff, sunU, log2(max(blur, 1e-3))), ck * exp(-dEff * ISCAT / tDown));
  }
  let pathP = depOpt / max(tDown, 0.05) + depOpt / max(sunDownY, 0.1);
  let TP = exp(-WK * pathP);
  // the plain column's bed: v1's sand over the shelf, M2's silt past it (2026-11-13: the water past the shelf is v2's
  // navy as at 35b4b692; round 2's constant sand lifted a 20–40 m bed's transmitted light into a blue that read "not
  // real"); the ease starts inside the shelf tint's end so no step sits between the two
  let aPlain = mix(aMean, BSILT, smoothstep(SILT_M0, SILT_M1, depOpt));
  let plain = WUP / PI * (E * aPlain * shade * TP * mix(1.0, caust, fD) + E * RINF * (1.0 - TP));
  let pathE = dEff / max(tDown, 0.05) + dEff / max(sunDownY, 0.1);
  let TE = exp(-WK * pathE);
  let bedLight = Esky * amb + Esun * dirF * caust;
  let up = mix(plain, WUP / PI * (bedLight * albedo * TE + E * RINF * (1.0 - TE)), wDet);
  // v1's body tint by bed depth (src/water.js WATER_LOOK: shelf (0.62, 1.85, 1.12) → deep (0.5, 2.6, 3.2) over 6–16 m),
  // taken relative to its deep value, so the shelf and the drop-off take v1's emerald-to-blue turn and the deep body
  // stays v2's own navy, with no seam: the ratio is 1 from 16 m down (2026-11-13: no tint past the shelf)
  // fix(v2) frame look: past the shelf the column is never brighter than M2 drew it under v1's camera, as the water's surface
  // (sim/exposure.js waterKeep, F.look.x), over the shelf tint's own 6–16 m: the shelf takes the frame's exposure, the navy stays
  return up * mix(mix(TINT_SHELF, vec3f(1.0), clamp(F.night.x, 0.0, 1.0)), vec3f(select(1.0, F.look.x, F.look.x > 0.0)), smoothstep(TINT_M0, TINT_M1, depOpt));
}`;

// the desktop's big-boulder bed (the tests and any caller that does not say)
export const BED_WGSL = bedWgsl();
