// The forest (M5b): Tahoe's conifers as instanced impostor cards, baked at load on the GPU, culled on the GPU, drawn
// with one indirect draw.
//   Trees: v1's real lidar crowns round Emerald Bay (99,818 trees, 581,292 shrubs: v2/forest/format.js, packed by
//   tools/v2-forest-pack.mjs from v1's own placement) and, round the box out to v1's rule region, the rules' trees on
//   the GPU from the same cover grids and heights the terrain draws (v2/forest/scatter.js). Past the cards' range the
//   terrain's canopy colour carries the forest (render/terrain.js forestNear: the floor under drawn trees, the canopy
//   as they thin).
//   The cards (T5): 7 trees (Jeffrey pine, lodgepole, white fir, red fir, incense cedar, a snag, a manzanita) built as
//   meshes on the CPU (v2/forest/trees.js: Cold Smoke's boughs, sprays and curtains, MIT), plus (T1) a young
//   and an old tree for the pine and the two firs, picked per tree in the draw (13 layers), drawn once into an atlas:
//   12 azimuths × 3 elevations (0°, 30°, 60°) a tree, the needles cut per pixel; the atlas keeps the true normal + alpha,
//   and the depth, ao, tone and bark, no colour (TREE_BAKE_WGSL → CARD_DOWN → CARD_DILATE; a layer a frame on a live
//   page, then the mips). A card faces the camera in the tree's own unit frame; its pixels mix the frames round the
//   view (2 azimuths × 2 elevations; their alphas mixed, then cut), then the species' colour lit here by the M1 sun and
//   sky (Cold Smoke's needle light and own shade), then the aerial perspective. Alpha to coverage under MSAA 4.
//   Per frame: the CPU picks the tiles in range and in the frustum (v2/forest/lod.js); the 'forest' compute pass resets
//   the indirect arguments and culls every instance of those tiles (distance thinning with widening, a pixel floor, the
//   frustum, the lake guard), appending the survivors; the scene pass draws them after the terrain.
//   Stream events (never a frame's own work): a file landed (its slices uploaded ≤ 1 MB a frame), a height or cover grid
//   swapped (the place pass sets every lidar crown's ground and drops any in the lake; the scatter re-runs).
// Nothing is created in a frame: every buffer, texture and bind group is made here; pipelines are built at load.
import { wgslStruct } from '../engine/uniforms.js';
import { ATMO_WGSL, SKY_READ, AP_READ, LAND_SKY, LAND_LOOK } from './sky.js';
import { TERRAIN_BIND, TERRAIN_HEIGHT, COVER_BIND, GROUND_WGSL } from './terrain.js';
import { frustumPlanes, boxInFrustum, TREE } from '../terrain/quadtree.js';
import { FOREST, REGION, REGION_SLOTS, MAX_TILES, createTilePicker } from '../forest/lod.js';
import { SCATTER_WGSL } from '../forest/scatter.js';
import { N_LAYERS } from '../forest/format.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';   // M5c: the terrain's shadow on the cards
import { buildAll, SPECIES, SPECIES_LAYER, VARIANTS, VARIANT_SPREAD, VARIANT_SALT, FL } from '../forest/trees.js';   // T5: the trees as meshes, photographed into the atlas
import { TOWNS_BIND, TOWNS_READ } from '../towns/wgsl.js';   // 10a: no tree on a ski run, Hwy 89 or its cut (v1's keepOut)
import { SWAY, SWAY_WGSL } from '../forest/sway.js';   // the trees sway in the one wind (v1's main bending)
import { WIND_READ_WGSL } from './windWater.js';   // the local wind (sim/windTex.js), the water's own texture
import { WIND_TEX } from '../sim/windTex.js';
import { createCanopy } from './canopy.js';   // T3: the far forest's canopy grid, splatted from these same records
import { NIGHT } from '../sim/night.js';   // feat/v2-night-clouds: the tree line's night light (NIGHT.treeNight)

export const ATLAS = Object.freeze({ az: 12, el: [0, 30, 60] });
// the trees' shapes in their unit frame (height 1): crown base cb, the crown's widest radius rho, the frame's half
// width R (≥ rho), the kind (0 pine clumps, 1 fir whorls, 2 cedar, 3 snag, 4 shrub dome), tiers, droop, trunk radius;
// the needle and bark albedos (linear: v1's species colours, src/forest/species.js)
// T1: a frame wide enough for the whole crown (R = the mesh's reach + about 0.01: the bake clips no bough;
// v2/tests/forest-trees.test.mjs), rho the crown's widest radius as built (so a lidar crown maps onto the tree's own
// width); quieter bark (the pine's and the cedar's toward grey-brown, the red fir's less red) and a quieter snag (0.25,
// from a bleached 0.50); then the six variants (layers 7–12: forest/trees.js SPECIES), each with its species' colours
const BASE_SHAPES = [
  { id: 'pine', cb: 0.40, rho: 0.19, R: 0.22, kind: 0, tiers: 10, droop: 0.12, trunk: 0.018, needle: [0.040, 0.068, 0.050], bark: [0.20, 0.16, 0.12] },
  { id: 'lodgepole', cb: 0.45, rho: 0.11, R: 0.15, kind: 0, tiers: 12, droop: 0.05, trunk: 0.017, needle: [0.044, 0.074, 0.042], bark: [0.26, 0.22, 0.17] },
  { id: 'whitefir', cb: 0.05, rho: 0.215, R: 0.268, kind: 1, tiers: 16, droop: 0.22, trunk: 0.020, needle: [0.028, 0.058, 0.052], bark: [0.26, 0.25, 0.22] },
  { id: 'redfir', cb: 0.07, rho: 0.195, R: 0.246, kind: 1, tiers: 18, droop: 0.18, trunk: 0.020, needle: [0.022, 0.048, 0.046], bark: [0.22, 0.15, 0.12] },
  { id: 'cedar', cb: 0.04, rho: 0.215, R: 0.27, kind: 2, tiers: 14, droop: 0.0, trunk: 0.026, needle: [0.050, 0.080, 0.036], bark: [0.24, 0.17, 0.12] },
  { id: 'snag', cb: 0.55, rho: 0.09, R: 0.12, kind: 3, tiers: 7, droop: 0.1, trunk: 0.024, needle: [0.25, 0.24, 0.22], bark: [0.25, 0.24, 0.22] },
  { id: 'shrub', cb: 0.0, rho: 1.0, R: 1.12, kind: 4, tiers: 4, droop: 0.0, trunk: 0.06, needle: [0.046, 0.064, 0.028], bark: [0.17, 0.12, 0.09] },   // M5d: v1's manzanita (species.js 0.105, 0.138, 0.066) at the level v1's shaded leaf cards read on screen (cam I: v1 46,56,34; v1's full value read 96,113,85 under v2's light)
];
const variant = (id, of, o) => ({ ...BASE_SHAPES.find((s) => s.id === of), id, ...o });
export const SHAPES = Object.freeze([...BASE_SHAPES,
  variant('pine-young', 'pine', { cb: 0.24, rho: 0.17, R: 0.205 }),
  variant('pine-old', 'pine', { cb: 0.45, rho: 0.21, R: 0.245, trunk: 0.016 }),
  variant('whitefir-young', 'whitefir', { cb: 0.03, rho: 0.18, R: 0.222 }),
  variant('whitefir-old', 'whitefir', { cb: 0.08, rho: 0.225, R: 0.28 }),
  variant('redfir-young', 'redfir', { cb: 0.04, rho: 0.165, R: 0.202 }),
  variant('redfir-old', 'redfir', { cb: 0.10, rho: 0.22, R: 0.275 }),
].map(Object.freeze));
if (SHAPES.length !== SPECIES.length || SHAPES.some((s, l) => s.id !== SPECIES[l].id) || SPECIES_LAYER.some((d, l) => d >= N_LAYERS || (l < N_LAYERS && d !== l))) throw new Error('forest: a shape per tree');
// the atlas's layers: a tree each (the data's N_LAYERS species, then the variants)
export const ATLAS_LAYERS = SHAPES.length;
// the instance buffer: the lidar's trees, its shrubs, then the region's slots (fixed offsets: the tile picker's)
export const CAP = Object.freeze({ trees: 131072, shrubs: 655360 });
export const LIDAR_MIN_Y = 1.0;   // v1's LIDAR_LAND.minY: a crown under this (m above the lake) is no tree
const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
// the lidar's crown radius (a local-maximum segmentation) runs small against the canopy-height model's cover (71 % of the
// box's 1 m cells ≥ 2 m high, terrain/forest/chm.json): a card is drawn this much wider
export const CROWN_K = 1.35;
// T1: the widest a card is drawn, over its height (the lidar crown r × CROWN_K / rho, clamped): was 1.6
export const SXZ_MAX = 2.2;
const v3 = (a) => `vec3f(${a.map(f).join(', ')})`;
// T5: the card's alpha cut (the frames' falling alphas mixed: inside the outline 0.5 + 0.5 × the share filled) and the
// needle light's colour through the needles (× the albedo: Cold Smoke's (0.045, 0.060, 0.016) over its needle albedo, a
// warm green). fix(v2) terrain shadow: the ground's bounce (0.1 of the level ground's sun + sky) left: the sky's harmonics
// (render/sky.js skyIrrN) carry the light from under the horizon now, as v1's environment does
export const CARD_CUT = 0.6;
// T1: sunSide (the sun on the lit side, × 1.3), tips (the outer sprays' extra sun), skyFloor (the sky the crown's deepest sees)
export const TREE_LIGHT = Object.freeze({ trans: [1.6, 1.8, 0.55], sunSide: 1.3, tips: 0.35, skyFloor: 0.28 });

const SHAPES_WGSL = `
struct Shape { cb: f32, rho: f32, R: f32, kind: f32, tiers: f32, droop: f32, trunk: f32, pad: f32 }
var<private> SH: array<Shape, ${ATLAS_LAYERS}> = array<Shape, ${ATLAS_LAYERS}>(${SHAPES.map((s) => `Shape(${f(s.cb)}, ${f(s.rho)}, ${f(s.R)}, ${f(s.kind)}, ${f(s.tiers)}, ${f(s.droop)}, ${f(s.trunk)}, 0.0)`).join(', ')});
const NA = ${ATLAS.az}u; const NE = ${ATLAS.el.length}u; const AZS = ${(2 * Math.PI / ATLAS.az).toFixed(7)}; const ELS = ${(ATLAS.el[1] * Math.PI / 180).toFixed(7)};
const EMAX = ${(ATLAS.el[ATLAS.el.length - 1] * Math.PI / 180).toFixed(7)};
// the frame's window in the tree's unit frame for view elevation e: u ∈ [−R, R], v ∈ [−R|sin e|, cos e + R|sin e|]
fn vWin(e: f32, R: f32) -> vec2f { let s = abs(sin(e)); return vec2f(-R * s, cos(e) + R * s); }
fn viewBasis(d: vec3f, right: ptr<function, vec3f>, up: ptr<function, vec3f>) {
  let h = length(d.xz);
  *right = select(vec3f(1.0, 0.0, 0.0), vec3f(d.z, 0.0, -d.x) / max(h, 1e-6), h > 1e-4);
  *up = cross(d, *right);
}
// frame (fa, fe)'s view direction (from the tree toward the camera)
fn frameDir(fa: u32, fe: u32) -> vec3f { let a = f32(fa) * AZS; let e = f32(fe) * ELS; return vec3f(cos(e) * sin(a), sin(e), cos(e) * cos(a)); }`;

const HASH_WGSL = `
fn hashU(x: u32) -> u32 { var h = x; h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return h; }
fn hash01(x: u32) -> f32 { return f32(hashU(x) >> 8u) / 16777216.0; }
// a tree's own seed from its position (the quarter-metre lattice of the data, world-anchored)
fn treeSeed(x: f32, z: f32) -> u32 { return hashU((bitcast<u32>(i32(round(x * 4.0))) * 73856093u) ^ (bitcast<u32>(i32(round(z * 4.0))) * 19349663u)); }`;

// --- the bake (T5): each tree's mesh (forest/trees.js) drawn into its layer, a row of 12 frames a pass, at 2 × the atlas
// size; then each texel the share of its 2 × 2 the tree fills (CARD_DOWN_WGSL), the outline grown out as a falling alpha
// (CARD_DILATE_WGSL), the mips (CARD_MIP_WGSL). The atlas keeps what the tree IS at each texel, not how it was lit:
//   A: the true normal (the tree's unit frame; a sheet's normal turned to the viewer, plus the needles' facets) +
//      the alpha (0.5 + 0.5 × the share filled inside the outline; outside it falls 0.07 a texel, "like a distance", so
//      between two frames the outline moves over instead of doubling);
//   B: the depth toward the viewer from the card's plane (± R + 0.5 of the unit frame), the light the crown keeps from its own boughs (ao × open sky:
//      the sky's share only; the sun's shade is worked out at draw time), the needles' tone, bark (1) or foliage (0).
// The needle cut and the facets are ported from Cold Smoke (src/14_trees.js treeCut, treeSurface's needle normal; MIT,
// Copyright (c) 2026 Huisky: the notice in forest/trees.js); the tufts and the leaves are ours.
const BAKE_COMMON = `
const DRZ = 1.5;   // the bake's depth range (unit frame): the widest frame (the shrub's 1.12) fits
struct BK { layer: u32, fe: u32, H: f32, R: f32 }
@group(0) @binding(0) var<uniform> P: BK;`;
export const TREE_CUT_WGSL = `
fn hash11(x: f32) -> f32 { var p = fract(x * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
fn hash21(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// where along a spray a point lies, counted in its branchlets (Cold Smoke's sprayAt)
fn sprayAt(tx: vec4f, sd: f32) -> f32 {
  return (tx.x + 0.030 * sin(tx.y * 21.0 + sd * 5.0) + 0.018 * sin(tx.x * 33.0 + sd * 3.0) - abs(tx.y) * 0.9) / 0.115 + sd * 0.37;
}
// how much of a pixel a sheet of twigs fills (Cold Smoke's treeCut, the snow's line taken out); fw: a pixel's width on
// the sheet (m)
fn sprayCut(tx: vec4f, sd: f32, fw: f32) -> f32 {
  let ap = fw / 0.115;
  if (ap > 1.2) { return step(tx.z, 0.80); }
  let s = sprayAt(tx, sd); let k = floor(s); let f = abs(s - k - 0.5);
  let h = hash11(k + sd * 17.0);
  let e = tx.z / (0.78 + 0.22 * h);
  let comb = abs(fract(abs(tx.y) * 62.0 + h * 7.0) - 0.5) * 2.0;
  let wid = mix(0.60, 0.13, smoothstep(0.30, 1.0, e)) * (0.75 + 0.5 * fract(h * 7.3)) * mix(0.70 + 0.60 * comb, 1.0, saturate(fw * 60.0));
  var fine = saturate((wid - f) / max(ap, 0.001) + 0.5) * step(e, 1.0);
  let s2 = (tx.x - abs(tx.y) * 0.5 + 0.022 * sin(tx.y * 27.0 + sd * 9.0)) / 0.083 + sd * 0.71; let k2 = floor(s2); let f2 = abs(s2 - k2 - 0.5);
  let e2 = tx.z / (0.50 + 0.38 * hash11(k2 + sd * 23.0));
  fine = max(fine, saturate((mix(0.52, 0.10, smoothstep(0.25, 1.0, e2)) - f2) / max(fw / 0.083, 0.001) + 0.5) * step(e2, 1.0));
  return mix(fine, step(tx.z, 0.80), smoothstep(0.45, 1.2, ap));
}
// a curtain: strands a hand apart, of different lengths, thinning toward their ends (Cold Smoke's)
fn curtainCut(tx: vec4f, sd: f32, fw: f32) -> f32 {
  let ap3 = fw / 0.06;
  if (ap3 > 1.2) { return step(tx.z, 0.62); }
  let c3 = (tx.x + 0.012 * sin(tx.y * 19.0 + sd * 7.0)) / 0.06 + sd * 0.61; let k3 = floor(c3); let f3 = abs(c3 - k3 - 0.5);
  let e3 = tx.z / (0.35 + 0.65 * hash11(k3 + sd * 13.0));
  var fine3 = saturate((0.46 * (1.0 - 0.6 * e3) - f3) / max(ap3, 0.001) + 0.5) * step(e3, 1.0);
  let c4 = (tx.x - 0.010 * sin(tx.y * 23.0 + sd * 4.0)) / 0.043 + sd * 0.29; let k4 = floor(c4); let f4 = abs(c4 - k4 - 0.5);
  let e4 = tx.z / (0.20 + 0.50 * hash11(k4 + sd * 31.0));
  fine3 = max(fine3, saturate((0.42 * (1.0 - 0.6 * e4) - f4) / max(fw / 0.043, 0.001) + 0.5) * step(e4, 1.0));
  return mix(fine3, step(tx.z, 0.62), smoothstep(0.45, 1.2, ap3));
}
// a pine's tuft: long needles radiating from one point, each its own length, a dense core (tx.xy metres from the
// point, tx.z the tuft's radius)
fn tuftCut(tx: vec4f, sd: f32, fw: f32) -> f32 {
  let r = length(tx.xy); let e = r / tx.z;
  if (e > 1.0) { return 0.0; }
  if (fw > 0.07) { return step(e, 0.74 + 0.12 * hash11(floor(atan2(tx.y, tx.x) * 3.0) + sd)); }
  let th = atan2(tx.y, tx.x) / 6.2831853;
  var c = step(e, 0.24 + 0.08 * hash11(sd * 3.1));
  for (var s = 0; s < 2; s++) {
    let nn = select(34.0, 23.0, s == 1);
    let a = th * nn + sd * select(0.37, 0.71, s == 1); let k = floor(a);
    let h = hash11(k + sd * select(17.0, 29.0, s == 1));
    let len = select(0.62 + 0.38 * h, 0.40 + 0.45 * h, s == 1);
    let f = abs(a - k - 0.5) * 6.2831853 * r / nn;   // metres from the needle's line
    let wid = 0.0075 * (1.0 - 0.5 * e / len);
    c = max(c, saturate((wid - f) / max(fw, 1e-4) + 0.5) * step(e, len));
  }
  return c;
}
// the manzanita's leaves: small ovals, two offset grids of them, each turned its own way; ragged at the sheet's rim
fn leafCut(tx: vec4f, sd: f32, fw: f32) -> f32 {
  let sp = 0.05;
  if (fw > sp * 1.2) { return step(tx.z, 0.72); }
  var c = 0.0;
  for (var s = 0; s < 2; s++) {
    let g = tx.xy / sp + vec2f(sd * 0.37, sd * 0.61) + select(vec2f(0.0), vec2f(0.5), s == 1);
    let ci = floor(g); let h = hash21(ci + vec2f(sd * 7.0, f32(s) * 13.0)); let h2 = hash21(ci + vec2f(3.7, sd));
    let ang = h * 6.2831853; let cs = cos(ang); let sn = sin(ang);
    let f = fract(g) - 0.5 + (vec2f(h2, h) - 0.5) * 0.3;
    let q = vec2f(f.x * cs + f.y * sn, -f.x * sn + f.y * cs) / vec2f(0.40, 0.24) / (0.8 + 0.35 * h2);
    let l = length(q);
    c = max(c, saturate((1.0 - l) * sp * 0.27 / max(fw, 1e-4) + 0.5) * step(tx.z / (0.70 + 0.30 * h), 1.0));
  }
  return c;
}`;
export const TREE_BAKE_WGSL = `${HASH_WGSL}
${SHAPES_WGSL}
${BAKE_COMMON}
${TREE_CUT_WGSL}
fn h3(p: vec3i) -> f32 { return f32(hashU((bitcast<u32>(p.x) * 73856093u) ^ (bitcast<u32>(p.y) * 19349663u) ^ (bitcast<u32>(p.z) * 83492791u)) >> 8u) / 16777216.0; }
fn vn3(x: vec3f) -> f32 {
  let i = vec3i(floor(x)); let t = fract(x); let u = t * t * (3.0 - 2.0 * t);
  let a = mix(mix(h3(i), h3(i + vec3i(1, 0, 0)), u.x), mix(h3(i + vec3i(0, 1, 0)), h3(i + vec3i(1, 1, 0)), u.x), u.y);
  let b = mix(mix(h3(i + vec3i(0, 0, 1)), h3(i + vec3i(1, 0, 1)), u.x), mix(h3(i + vec3i(0, 1, 1)), h3(i + vec3i(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
struct VI { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) mat: vec4f, @location(3) tx: vec4f }
struct VO {
  @builtin(position) clip: vec4f,
  @location(0) n: vec3f, @location(1) bp: vec3f, @location(2) mat: vec4f, @location(3) tx: vec4f,
  @location(4) ud: vec2f,                          // the frame's u (the tile's own cut) and the depth toward the viewer
  @location(5) @interpolate(flat) fdir: vec3f,     // the frame's view direction (toward the viewer)
}
// one instance a frame of the row: an orthographic view of the unit frame into its tile
@vertex fn vs(a: VI, @builtin(instance_index) fa: u32) -> VO {
  let dir = frameDir(fa, P.fe); var right: vec3f; var up: vec3f; viewBasis(dir, &right, &up);
  let w = vWin(f32(P.fe) * ELS, P.R);
  let u = dot(a.pos, right); let v = dot(a.pos, up); let d = dot(a.pos - vec3f(0.0, 0.5, 0.0), dir);   // the depth from the card's plane (through the crown's middle, as the draw stands it)
  var o: VO;
  o.clip = vec4f((f32(fa) + (u + P.R) / (2.0 * P.R)) / f32(NA) * 2.0 - 1.0, 1.0 - (w.y - v) / (w.y - w.x) * 2.0, 0.5 - d / (2.0 * DRZ), 1.0);
  o.n = a.nrm; o.bp = a.pos; o.mat = a.mat; o.tx = a.tx; o.ud = vec2f(u, d); o.fdir = dir;
  return o;
}
struct FO { @location(0) a: vec4f, @location(1) b: vec4f }
@fragment fn fs(v: VO) -> FO {
  if (abs(v.ud.x) > P.R) { discard; }   // the next frame's tile
  let k = v.mat.x; let sd = v.mat.w;
  let bark = k > 2.5 && k < 3.5;
  let N0 = normalize(v.n);
  var Ng = normalize(cross(dpdx(v.bp), dpdy(v.bp))); if (dot(Ng, v.fdir) < 0.0) { Ng = -Ng; }
  let fc = dot(N0, Ng);
  // the pattern's coordinates (m, × the species' scale) and a pixel's width on them
  let txp = vec4f(v.tx.xy * v.tx.w, v.tx.z, 0.0);
  let d1 = dpdx(txp.xy); let d2 = dpdy(txp.xy); let fwp = sqrt(0.5 * (dot(d1, d1) + dot(d2, d2)));
  var cut = 1.0;
  if (k < 1.5) { cut = sprayCut(txp, sd, fwp); }
  else if (k < 2.5) { cut = curtainCut(txp, sd, fwp); }
  else if (k > 3.5 && k < 4.5) { cut = tuftCut(v.tx, sd, fwp); }
  else if (k > 4.5) { cut = leafCut(v.tx, sd, fwp); }
  if (cut < 0.5 || (bark && fc < -0.2)) { discard; }   // (the stem's inner faces are never seen)
  // the true normal: a sheet's own, turned to face the viewer through its face only (its lean is kept), then the
  // needles' thousand small facets (Cold Smoke's N + (detail − 0.5)·1.1; 1.9 a metre)
  var N = N0;
  if (!bark) { N = N0 - 2.0 * min(fc, 0.0) * Ng; }
  let pm = v.bp * P.H;   // model metres
  let q = pm * select(1.9, 9.0, P.layer == 6u);   // (the shrub's leaves cluster finer)
  let fac = vec3f(vn3(q), vn3(q + vec3f(17.3, 5.1, 2.9)), vn3(q + vec3f(3.7, 41.7, 11.3))) - 0.5;
  N = normalize(N + fac * select(select(1.1, 0.8, k > 4.5), 0.3, bark));
  // the needles' tone: a broad patchiness, the bough's own, more open boughs a little fresher; bark its plates
  var tone = saturate(0.55 * vn3(pm * 0.23 + vec3f(3.1, 0.0, 7.7)) + 0.30 * hash11(sd * 1.37 + f32(P.layer)) + 0.20 * v.mat.z);
  if (bark) { tone = saturate(0.3 + 0.7 * vn3(pm * vec3f(5.0, 0.9, 5.0) + vec3f(f32(P.layer) * 7.0))); }
  var o: FO;
  o.a = vec4f(N * 0.5 + 0.5, 1.0);
  o.b = vec4f(saturate(0.5 + v.ud.y / (2.0 * (P.R + 0.5))), saturate(v.mat.y * (0.3 + 0.7 * v.mat.z)), tone, select(0.0, 1.0, bark));
  return o;
}`;

// each texel of a row: the share of its 2 × 2 the tree fills; the channels averaged over what was hit
export const CARD_DOWN_WGSL = (fw, fh) => `
const NA = ${ATLAS.az}u; const FW = ${fw}u; const FH = ${fh}u;
struct DP { layer: u32, fe: u32, p2: u32, p3: u32 }   // the bake's own record (layer 0, row fe)
@group(0) @binding(0) var hA: texture_2d<f32>;
@group(0) @binding(1) var hB: texture_2d<f32>;
@group(0) @binding(2) var sA: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var sB: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> D: DP;
@compute @workgroup_size(8, 8) fn down(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= NA * FW || g.y >= FH) { return; }
  var a = vec3f(0.0); var b = vec4f(0.0); var n = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let p = vec2i(g.xy * 2u + vec2u(k & 1u, k >> 1u));
    let A = textureLoad(hA, p, 0);
    if (A.a > 0.5) { a += A.rgb * 2.0 - 1.0; b += textureLoad(hB, p, 0); n += 1.0; }
  }
  var oa = vec4f(0.0); var ob = vec4f(0.0);
  if (n > 0.0) { oa = vec4f(normalize(a + vec3f(0.0, 1e-5, 0.0)) * 0.5 + 0.5, 0.5 + 0.5 * n / 4.0); ob = b / n; }
  let q = vec2i(i32(g.x), i32(D.fe * FH + g.y));
  textureStore(sA, q, oa); textureStore(sB, q, ob);
}`;

// the outline grown out: an empty texel takes the mean of the nearest ring (Chebyshev, ≤ 6 texels, inside its own
// tile) that holds the tree, and an alpha of 0.5 − 0.07 × that ring (Cold Smoke's 6 dilation passes in one)
export const CARD_DILATE_WGSL = (fw, fh) => `
const FW = ${fw}; const FH = ${fh};
struct LP { layer: u32, p1: u32, p2: u32, p3: u32 }
@group(0) @binding(0) var sA: texture_2d<f32>;
@group(0) @binding(1) var sB: texture_2d<f32>;
@group(0) @binding(2) var dA: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var dB: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> D: LP;
@compute @workgroup_size(8, 8) fn dilate(@builtin(global_invocation_id) g: vec3u) {
  let dim = textureDimensions(sA);
  if (g.x >= dim.x || g.y >= dim.y) { return; }
  let p = vec2i(g.xy);
  var A = textureLoad(sA, p, 0); var B = textureLoad(sB, p, 0);
  if (A.a <= 0.0) {
    let t0 = (p / vec2i(FW, FH)) * vec2i(FW, FH); let t1 = t0 + vec2i(FW - 1, FH - 1);
    var sa = vec3f(0.0); var sb = vec4f(0.0); var n = 0.0; var ring = 0;
    for (var r = 1; r <= 6; r++) {
      for (var j = -r; j <= r; j++) {
        for (var i = -r; i <= r; i++) {
          if (max(abs(i), abs(j)) != r) { continue; }
          let q = p + vec2i(i, j);
          if (any(q < t0) || any(q > t1)) { continue; }
          let a = textureLoad(sA, q, 0);
          if (a.a > 0.0) { sa += a.rgb; sb += textureLoad(sB, q, 0); n += 1.0; }
        }
      }
      if (n > 0.0) { ring = r; break; }
    }
    if (n > 0.0) { A = vec4f(sa / n, 0.5 - 0.07 * f32(ring)); B = sb / n; }
    else { A = vec4f(0.5, 1.0, 0.5, 0.0); B = vec4f(0.5, 0.5, 0.5, 0.0); }
  }
  textureStore(dA, p, i32(D.layer), A); textureStore(dB, p, i32(D.layer), B);
}`;

// the atlas's mips: the alpha a plain mean; the channels weighted by it (a texel far outside the outline adds nothing)
export const CARD_MIP_WGSL = `
@group(0) @binding(0) var sA: texture_2d_array<f32>;
@group(0) @binding(1) var sN: texture_2d_array<f32>;
@group(0) @binding(2) var dA: texture_storage_2d_array<rgba8unorm, write>;
@group(0) @binding(3) var dN: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8) fn mip(@builtin(global_invocation_id) g: vec3u) {
  let dim = textureDimensions(dA);
  if (g.x >= dim.x || g.y >= dim.y) { return; }
  var a = vec3f(0.0); var b = vec4f(0.0); var c = 0.0;
  for (var k = 0u; k < 4u; k++) {
    let p = vec2i(g.xy * 2u + vec2u(k & 1u, k >> 1u));
    let A = textureLoad(sA, p, i32(g.z), 0); let B = textureLoad(sN, p, i32(g.z), 0);
    a += A.rgb * A.a; b += B * A.a; c += A.a;
  }
  var oa = vec4f(0.5, 1.0, 0.5, 0.0); var ob = vec4f(0.5, 0.5, 0.5, 0.0);
  if (c > 1e-4) { oa = vec4f(a / c, c * 0.25); ob = b / c; }
  textureStore(dA, vec2i(g.xy), i32(g.z), oa);
  textureStore(dN, vec2i(g.xy), i32(g.z), ob);
}`;

// the place pass: a lidar crown's ground from the drawn heights; one in the lake (under LIDAR_MIN_Y) is dropped
export const PLACE_WGSL = `${TERRAIN_BIND(0)}
${TERRAIN_HEIGHT}
struct PP { first: u32, count: u32, p2: u32, p3: u32 }
@group(1) @binding(0) var<uniform> PL: PP;
@group(1) @binding(1) var<storage, read_write> inst: array<vec4f>;
${TOWNS_BIND(1, 2)}
${TOWNS_READ}
@compute @workgroup_size(64) fn place(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x + g.y * 65535u * 64u;
  if (i >= PL.count) { return; }
  let r = inst[PL.first + i];
  let y = terrainHeight(r.x, r.y);
  var p = bitcast<u32>(r.w);
  p = select(p | (1u << 23u), p & ~(1u << 23u), y < ${LIDAR_MIN_Y.toFixed(2)} || twKeepOutR(r.x, r.y, f32((p >> 10u) & 255u) * 0.1));   // 10a: v1's keepOut (the lidar branch of scatterTrees)
  inst[PL.first + i] = vec4f(r.x, r.y, y, bitcast<f32>(p));
}`;

// the rules' scatter: one thread a slot of the region (v2/forest/scatter.js), a fixed slot a cell
export const SCATTER_PASS_WGSL = `${TERRAIN_BIND(0)}
${TERRAIN_HEIGHT}
${COVER_BIND(1)}
${GROUND_WGSL}
${SCATTER_WGSL}
struct SP { base: u32, p1: u32, p2: u32, p3: u32 }
@group(2) @binding(0) var<uniform> SC: SP;
@group(2) @binding(1) var<storage, read_write> inst: array<vec4f>;
${TOWNS_BIND(2, 2)}
${TOWNS_READ}
const PER = ${REGION.n * REGION.n}u; const TWR = ${REGION.tw}u; const NR = ${REGION.n}u;
@compute @workgroup_size(64) fn scatterMain(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= ${REGION_SLOTS}u) { return; }
  let t = i / PER; let c = i % PER;
  let ci = i32((t % TWR) * NR + c % NR); let cj = i32((t / TWR) * NR + c / NR);
  var rec = scatter(ci, cj);
  // 10a: v1's keepOut and the runs' thinning (scatterTrees: towns.keepOut, towns.treeDensity)
  if (rec.w != 0.0 && (twKeepOutR(rec.x, rec.y, f32((bitcast<u32>(rec.w) >> 10u) & 255u) * 0.1) || cellHash(ci, cj, 9) >= twSkiKeep(rec.x, rec.y))) { rec = vec4f(rec.x, rec.y, 0.0, 0.0); }
  inst[SC.base + i] = rec;
}`;

// the per-frame cull, in a fixed order (the image must not depend on which workgroup ran first: the goldens' --twice):
// count (a workgroup a picked tile: its survivors) → scan (one workgroup: each tile's first slot, the total, the clamp)
// → write (a workgroup a tile again: the same rule, each survivor at its tile's first slot + its rank in the tile)
// sway: the trees' sway gain (0: still; the level's knob), 0, 0, 0
const FU_STRUCT = `struct FU { planes: array<vec4f, 5>, lod: vec4f, lod2: vec4f, eye: vec4f, sway: vec4f }`;
// the card: a strip of SWAY.rows rows (2: the quad; the sway moves its top, the foot stays: forest/sway.js)
export const CARD_VERTS = 2 * SWAY.rows;
export const CULL_WGSL = `${HASH_WGSL}
${FU_STRUCT}
struct Tile { first: u32, count: u32, src: u32, pad: u32 }
struct Args { vc: u32, ic: u32, fv: u32, fi: u32, guard: atomic<u32>, total: u32, p6: u32, p7: u32 }
@group(0) @binding(0) var<uniform> U: FU;
@group(0) @binding(1) var<storage, read> inst: array<vec4f>;
@group(0) @binding(2) var<storage, read> tiles: array<Tile>;
@group(0) @binding(3) var<storage, read_write> vis: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> args: Args;
@group(0) @binding(5) var<storage, read_write> tcount: array<u32>;   // per picked tile: its survivors, then its first slot
var<workgroup> wn: u32;
var<workgroup> flags: array<u32, 64>;
var<workgroup> part: array<u32, 256>;
@compute @workgroup_size(1) fn reset() {
  args.vc = ${CARD_VERTS}u; args.ic = 0u; args.fv = 0u; args.fi = 0u; atomicStore(&args.guard, 0u); args.total = 0u;
}
// the rule for one instance: keep or not, and its record for the draw (the widening in bits 24–31)
fn decide(rec0: vec4f, guard: bool, out: ptr<function, vec4f>) -> bool {
  var rec = rec0;
  var p = bitcast<u32>(rec.w);
  if (((p >> 23u) & 1u) == 0u) { return false; }
  let thin = U.lod.x; let fade = U.lod.y; let far = U.lod.z; let wmax = U.lod.w;
  let h = f32(p & 1023u) * 0.1; let r = f32((p >> 10u) & 255u) * 0.1; let shrub = ((p >> 22u) & 1u) == 1u;
  let c = vec3f(rec.x, rec.z + 0.5 * h, rec.y);
  let d = distance(U.eye.xyz, c);
  let u = hash01(treeSeed(rec.x, rec.y) ^ 0x5bd1e995u);
  var widen = 1.0; var keep = false;
  if (shrub) {
    keep = d < U.lod2.x && u < (U.lod2.x - d) / (0.3 * U.lod2.x);
  } else if (d < far) {
    var k = select(1.0, (thin / d) * (thin / d), d > thin);
    widen = min(wmax, 1.0 / sqrt(k));
    if (d > fade) { k *= 1.0 - (d - fade) / (far - fade); }
    keep = u < k;
  }
  keep = keep && h * U.lod2.y > 0.8 * d;   // a card under 0.8 px tall is dropped
  let rad = max(0.6 * h, 1.7 * r * widen);   // the frustum: a sphere round the crown
  for (var q = 0u; q < 5u; q++) { keep = keep && dot(U.planes[q].xyz, c) + U.planes[q].w > -rad; }
  // the guard: never a tree in the lake (the place pass drops those; this counts any that slipped through)
  if (keep && rec.z < ${LIDAR_MIN_Y.toFixed(2)}) { if (guard) { atomicAdd(&args.guard, 1u); } return false; }
  if (keep) { p = (p & 0x00ffffffu) | (u32(round(clamp(widen - 1.0, 0.0, 1.0) * 255.0)) << 24u); rec.w = bitcast<f32>(p); *out = rec; }
  return keep;
}
@compute @workgroup_size(64) fn countTiles(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { wn = tiles[wg.x].count; }
  let cnt = workgroupUniformLoad(&wn);
  let T = tiles[wg.x];
  var mine = 0u; var rec: vec4f;
  for (var i = li; i < cnt; i += 64u) { if (decide(inst[T.first + i], true, &rec)) { mine++; } }
  part[li] = mine;
  workgroupBarrier();
  if (li == 0u) { var t = 0u; for (var k = 0u; k < 64u; k++) { t += part[k]; } tcount[wg.x] = t; }
}
// one workgroup: the exclusive prefix of the tiles' counts (256 threads, a chunk each), the total and the drawn count
@compute @workgroup_size(256) fn scanTiles(@builtin(local_invocation_index) li: u32) {
  let n = u32(U.eye.w);
  let per = (n + 255u) / 256u; let a = li * per; let b = min(a + per, n);
  var s = 0u; for (var k = a; k < b; k++) { s += tcount[k]; }
  part[li] = s;
  workgroupBarrier();
  var base = 0u; for (var k = 0u; k < li; k++) { base += part[k]; }
  for (var k = a; k < b; k++) { let c = tcount[k]; tcount[k] = base; base += c; }
  if (li == 255u) { args.total = base; args.ic = min(base, u32(U.lod2.z)); }
}
@compute @workgroup_size(64) fn writeTiles(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) { wn = tiles[wg.x].count; }
  let cnt = workgroupUniformLoad(&wn);
  let T = tiles[wg.x]; let first = tcount[wg.x]; let cap = u32(U.lod2.z);
  var at = first;
  for (var b = 0u; b < cnt; b += 64u) {
    let i = b + li;
    var rec: vec4f; var keep = false;
    if (i < cnt) { keep = decide(inst[T.first + i], false, &rec); }
    flags[li] = select(0u, 1u, keep);
    workgroupBarrier();
    var rank = 0u; for (var k = 0u; k < li; k++) { rank += flags[k]; }
    var all = rank; for (var k = li; k < 64u; k++) { all += flags[k]; }
    if (keep && at + rank < cap) { vis[at + rank] = rec; }
    at += all;
    workgroupBarrier();
  }
}`;

// the draw: a card facing the camera in the tree's unit frame, the 4 baked frames round the view blended (their alphas
// mixed, then cut: the outline moves from one frame to the next), lit here by the M1 sun and sky with Cold Smoke's
// needle light (src/14_trees.js treeLight and TREE_CARD_FS's own shade; MIT, Copyright (c) 2026 Huisky: the notice in
// forest/trees.js): the sun on the side that faces it, the far side of the crown in its own shade, the sky by the
// crown's own ao, a rim and the light through the needles against a low sun, the terrain's shadow where the pixel
// really stands (the depth puts it back on the tree).
export const CARD_DRAW_WGSL = (frameStruct, msaa, fw, fh) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${HASH_WGSL}
${SHAPES_WGSL}
${FU_STRUCT}
var<private> NEEDLE: array<vec3f, ${ATLAS_LAYERS}> = array<vec3f, ${ATLAS_LAYERS}>(${SHAPES.map((s) => v3(s.needle)).join(', ')});
var<private> BARK: array<vec3f, ${ATLAS_LAYERS}> = array<vec3f, ${ATLAS_LAYERS}>(${SHAPES.map((s) => v3(s.bark)).join(', ')});
@group(2) @binding(0) var<storage, read> vis: array<vec4f>;
@group(2) @binding(1) var tA: texture_2d_array<f32>;
@group(2) @binding(2) var tN: texture_2d_array<f32>;
@group(2) @binding(3) var sA: sampler;
@group(2) @binding(4) var<uniform> U: FU;
@group(2) @binding(5) var tFShadow: texture_depth_2d;
@group(2) @binding(6) var sFShadow: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(7) var<uniform> TSH: Shadow;
${SHADOW_READ('tFShadow', 'sFShadow', 'TSH')}
${WIND_READ_WGSL(8)}
${SWAY_WGSL}
struct CV {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv01: vec4f,       // frames 0 and 1 (az0 el0, az1 el0): the frame-local uv
  @location(2) uv23: vec4f,       // frames 2 and 3 (az0 el1, az1 el1)
  @location(3) w: vec4f,          // their weights
  @location(4) @interpolate(flat) fr: vec4u,   // az0, az1, el0, layer
  @location(5) @interpolate(flat) rot: vec4f,  // the tree's yaw (cos, sin), its height over its crown's scale, its tint
  @location(6) ofs: vec4f,        // the card's point from the stem's foot (world m), the tree's height
  @location(7) @interpolate(flat) dW: vec4f,   // a unit of the frame's depth toward the viewer (world m), the crown's radius (m)
  @location(8) @interpolate(flat) hue: vec4f,  // T1: the tree's hue (× the needles: toward yellow-green or blue-green), its crown's half-height (m)
}
const CROWN = ${CROWN_K};
// T1: which of its species' trees a tree is (forest/trees.js pickVariant, the same rule): the lidar's crown width over its
// height q between the species' q0 and q1, spread by the tree's own hash u, in thirds (young, the species', old)
fn treeOf(l: u32, q: f32, u: f32) -> u32 {
  var t = vec3u(l); var qr = vec2f(0.0, 1.0);
  ${VARIANTS.map((v, k) => `${k ? 'else ' : ''}if (l == ${v.layer}u) { t = vec3u(${v.trees.map((x) => `${x}u`).join(', ')}); qr = vec2f(${f(v.q0)}, ${f(v.q1)}); }`).join('\n  ')}
  else { return l; }
  let s = saturate((q - qr.x) / (qr.y - qr.x)) + (u - 0.5) * ${f(VARIANT_SPREAD)};
  return select(select(t.z, t.y, s < ${(2 / 3).toFixed(7)}), t.x, s < ${(1 / 3).toFixed(7)});
}
fn rotY(v: vec3f, c: f32, s: f32) -> vec3f { return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
fn frameUV(q: vec3f, fa: u32, fe: u32, R: f32) -> vec2f {
  let d = frameDir(fa, fe); var right: vec3f; var up: vec3f; viewBasis(d, &right, &up);
  let w = vWin(f32(fe) * ELS, R);
  return vec2f((dot(q, right) + R) / (2.0 * R), (w.y - dot(q, up)) / (w.y - w.x));
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> CV {
  let rec = vis[ii]; let p = bitcast<u32>(rec.w);
  let h = f32(p & 1023u) * 0.1; let r = f32((p >> 10u) & 255u) * 0.1; let dl = (p >> 18u) & 15u;
  let widen = 1.0 + f32(p >> 24u) / 255.0;
  let seed = treeSeed(rec.x, rec.y);
  let layer = treeOf(dl, CROWN * r / max(h, 0.1), hash01(seed ^ ${VARIANT_SALT}u));   // T1: the atlas layer (a variant of the species)
  let S = SH[layer];
  let yaw = hash01(seed) * 6.2831853; let cy = cos(yaw); let sy = sin(yaw);
  // the lidar crown's radius (a shrub: as wide as tall). T1: up to 2.2 × the height (was 1.6: the clamp held most crowns,
  // so every tree of a species had one width); the snag and the shrub keep 1.6 (a stem is not widened)
  let sxz = clamp(CROWN * r / S.rho, 0.45 * h, select(${f(SXZ_MAX)}, 1.6, dl == 5u || dl == 6u) * h) * widen;
  // sunk 0.25 m + 1.5 % so a trunk's foot never floats on a slope; a shrub (layer 6) only 0.08 m: its skirt lies on the ground
  let sink = select(0.25 + 0.015 * h, 0.08, layer == 6u);
  let base = vec3f(rec.x, rec.z - sink, rec.y);
  // the camera in the tree's unit frame (height 1, the crown's radius rho), and the view direction from the crown's centre
  let cw = rotY(F.cam.xyz - base, cy, -sy);
  let ql = vec3f(cw.x / sxz, cw.y / h, cw.z / sxz);
  let d = normalize(ql - vec3f(0.0, 0.5, 0.0));
  var right: vec3f; var up: vec3f; viewBasis(d, &right, &up);
  let e = asin(clamp(d.y, -1.0, 1.0));
  let win = vWin(e, S.R);
  // the strip's rows, foot to top (the uvs stay affine in q: the rows change no pixel of a still card)
  let cu = select(-S.R, S.R, (vi & 1u) == 1u); let cv = mix(win.x, win.y, f32(vi >> 1u) / ${f(SWAY.rows - 1)});
  let q = vec3f(0.0, 0.5, 0.0) + right * cu + up * (cv - 0.5 * cos(e));
  let ofs = rotY(vec3f(q.x * sxz, q.y * h, q.z * sxz), cy, sy);
  // the sway (forest/sway.js): the local wind at the root, the tree's own phase, bent from the foot (q.y: the height's share)
  var sw = vec2f(0.0);
  if (U.sway.x > 0.0) { sw = treeSway(windLocal(rec.xy).xy, F.cam.w, hash01(seed ^ SWAY_SALT) * 6.2831853, q.y, h, U.sway.x); }
  let world = base + ofs + vec3f(sw.x, 0.0, sw.y);
  // the 4 frames round the view: 2 azimuths × 2 elevations (from below: the 0° row)
  let a = atan2(d.x, d.z); let af = (a + select(0.0, 6.2831853, a < 0.0)) / AZS;
  let fa0 = u32(floor(af)) % NA; let fa1 = (fa0 + 1u) % NA; let wa = fract(af);
  let ef = clamp(e, 0.0, EMAX) / ELS; let fe0 = min(u32(floor(ef)), NE - 2u); let we = clamp(ef - f32(fe0), 0.0, 1.0);
  var o: CV;
  o.pos = F.viewProj * vec4f(world, 1.0); o.world = world;
  o.uv01 = vec4f(frameUV(q, fa0, fe0, S.R), frameUV(q, fa1, fe0, S.R));
  o.uv23 = vec4f(frameUV(q, fa0, fe0 + 1u, S.R), frameUV(q, fa1, fe0 + 1u, S.R));
  o.w = vec4f((1.0 - wa) * (1.0 - we), wa * (1.0 - we), (1.0 - wa) * we, wa * we);
  o.fr = vec4u(fa0, fa1, fe0, layer);
  o.rot = vec4f(cy, sy, h / sxz, 0.9 + 0.2 * hash01(seed ^ 0x9e3779b9u));
  o.ofs = vec4f(ofs, h);
  o.dW = vec4f(rotY(vec3f(d.x * sxz, d.y * h, d.z * sxz), cy, sy), S.rho * sxz);
  // T1: a hue per tree, ± 6 % toward yellow-green or blue-green (a red fir leans blue)
  let hk = clamp((hash01(seed ^ 0x68e31da4u) - 0.5) * 2.0 - select(0.0, 0.45, dl == 3u), -1.0, 1.0);
  o.hue = vec4f(vec3f(1.0) + 0.06 * hk * vec3f(0.8, 0.3, -1.0), 0.5 * h * (1.0 - S.cb));
  return o;
}
fn atlasUV(uv: vec2f, fa: u32, fe: u32) -> vec2f {
  let m = vec2f(${(0.5 / fw).toFixed(6)}, ${(0.5 / fh).toFixed(6)});   // half a texel: never the next frame's
  return vec2f((f32(fa) + clamp(uv.x, m.x, 1.0 - m.x)) / f32(NA), (f32(fe) + clamp(uv.y, m.y, 1.0 - m.y)) / f32(NE));
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;   // × the storm cell's shade (1 fair): the land under the deck, as the water and the boat (v1's sunShade)
}
@fragment fn fs(v: CV) -> @location(0) vec4f {
  let L = i32(v.fr.w); let layer = v.fr.w;
  let u0 = atlasUV(v.uv01.xy, v.fr.x, v.fr.z); let u1 = atlasUV(v.uv01.zw, v.fr.y, v.fr.z);
  let u2 = atlasUV(v.uv23.xy, v.fr.x, v.fr.z + 1u); let u3 = atlasUV(v.uv23.zw, v.fr.y, v.fr.z + 1u);
  // the raised row only when the view is raised (every boat view: none; its weight is the instance's, so the branch is
  // coherent): 4 reads, not 8
  let raised = v.w.z + v.w.w > 0.0;
  let a0 = textureSample(tA, sA, u0, L); let a1 = textureSample(tA, sA, u1, L);
  var a2 = vec4f(0.0); var a3 = vec4f(0.0);
  if (raised) { a2 = textureSample(tA, sA, u2, L); a3 = textureSample(tA, sA, u3, L); }
  // the outline: the frames' falling alphas mixed, then cut (a frame's edge moves toward the next, never doubles)
  let al = dot(v.w, vec4f(a0.a, a1.a, a2.a, a3.a));
  let thr = ${CARD_CUT.toFixed(2)};
  ${msaa > 1 ? 'let aa = clamp((al - thr) / max(fwidth(al), 1e-4) + 0.5, 0.0, 1.0);\n  if (aa <= 0.0) { discard; }' : 'if (al < thr) { discard; }\n  let aa = 1.0;'}
  let b0 = textureSample(tN, sA, u0, L); let b1 = textureSample(tN, sA, u1, L);
  var b2 = vec4f(0.0); var b3 = vec4f(0.0);
  if (raised) { b2 = textureSample(tN, sA, u2, L); b3 = textureSample(tN, sA, u3, L); }
  // the channels: each frame by its weight and its own alpha (a frame whose texel lies outside its outline says little)
  let wc = v.w * vec4f(a0.a, a1.a, a2.a, a3.a); let ws = max(wc.x + wc.y + wc.z + wc.w, 1e-4);
  let nl0 = (wc.x * a0.xyz + wc.y * a1.xyz + wc.z * a2.xyz + wc.w * a3.xyz) / ws * 2.0 - 1.0;
  let B = (wc.x * b0 + wc.y * b1 + wc.z * b2 + wc.w * b3) / ws;
  // the unit frame's normal into the world (its x and z scaled by the crown, y by the height), turned with the tree
  let n0 = normalize(rotY(vec3f(nl0.x * v.rot.z, nl0.y, nl0.z * v.rot.z), v.rot.x, v.rot.y));
  let s = normalize(F.sun.xyz);
  let V = normalize(F.cam.xyz - v.world);
  // the pixel back where it stood on the tree: the depth along the view (± the frame's half-width)
  let S = SH[layer];
  let dz = (B.x - 0.5) * 2.0 * (S.R + 0.5);   // (the bake's range: the frame's half-width + half the height, for the raised rows)
  let rel = v.ofs.xyz + v.dW.xyz * dz;   // from the stem's foot (world m)
  let wt = v.world + v.dW.xyz * dz;
  let hq = clamp(rel.y / v.ofs.w, 0.0, 1.0);
  // T1: the needles' normal blended 30 % toward the crown's own ellipsoid (its radius across, its half-height up, centred
  // on the crown): the crown shades round, a sun side and a shade side, while each spray keeps its own facets
  let hh = max(v.hue.w, 0.1); let ec = vec3f(rel.x / v.dW.w, (rel.y - (v.ofs.w - hh)) / hh, rel.z / v.dW.w);
  let nE = normalize(vec3f(ec.x / v.dW.w, ec.y / hh, ec.z / v.dW.w) + vec3f(0.0, 1e-5, 0.0));
  let n = normalize(mix(n0, nE, select(0.3, 0.0, layer == 6u) * (1.0 - B.w)));
  // the crown's own shade from the sun, worked out (Cold Smoke's ownS): the far side of the crown lies in shade, less so
  // toward its thin top; the tops of the boughs catch a high sun between the tiers; deep in the crown little of either
  let sh2 = normalize(s.xz + vec2f(1e-5, 0.0));
  let rs = dot(rel.xz, sh2);
  var ownS = smoothstep(mix(-0.45, -0.8, hq * hq), 0.25, rs / (v.dW.w * (1.0 - 0.8 * hq) + 0.3));
  ownS = max(ownS, smoothstep(0.55, 0.95, n.y) * (0.25 + 0.45 * hq) * saturate(s.y * 4.0 + 0.1));
  ownS *= mix(1.0, smoothstep(0.12, 0.55, B.y), 0.6);
  if (layer == 6u) { ownS = mix(1.0, ownS, 0.5); }   // a shrub is a mound, not a crown on a stem: its far side half
  // M5c: the terrain's shadow where the pixel stands (near cards 4 taps, far cards one)
  let distC = distance(v.world, F.cam.xyz);
  var tsh = 1.0; if (distC < 800.0) { tsh = shadowAt(wt, 0.7); } else { tsh = shadowAt1(wt); }
  let sh = tsh * ownS;
  // the albedo, chosen here: the species' needles by the tone (a tree its own tint), or its bark
  var alb = NEEDLE[layer] * (0.72 + 0.56 * B.z) * v.rot.w * v.hue.xyz;   // T1: × the tree's hue
  if (layer == 6u) { alb = NEEDLE[layer] * (0.45 + 0.60 * B.z); }   // M5d: v1's manzanita leaf value 0.55–1.3 (lower: the sun now reaches its whole lit side)
  alb = mix(alb, BARK[layer] * (0.75 + 0.5 * B.z) * select(0.6, 1.0, layer == 5u), B.w);   // (a live stem in its crown's half-light reads darker than its albedo; the snag bleached)
  let thin = 1.0 - B.w;
  let ndl = dot(n, s);
  let back = saturate(dot(-V, s)); let rim = pow(1.0 - saturate(dot(n, V)), 2.5);
  let SUN = sunAt(wt.y, s);
  // Cold Smoke's needle light in M1's units (col = albedo × irradiance / π): the sun wrapped (needles take it at a
  // glance), the sky by the crown's own ao (never on the sun), the rim of a low sun behind. fix(v2) terrain shadow: the sky
  // as v1's (render/sky.js landSky: its whole dome by the normal, the level sky by the tilt, LAND_SKY), so a crown in a
  // ridge's shadow or turned from the sun reads a dark green, not black
  // T1: the needles' sun side × 1.3 (the shade side keeps the sky: sh is 0 there; bark is not lifted), and the lit tips: the outer sprays (the bake's
  // open sky × ao high) catch the sun a little more; the crown's deep inside sees less sky (0.28, was 0.35)
  let tip = smoothstep(0.45, 0.85, B.y) * thin * select(1.0, 0.0, layer == 6u);
  let E = SUN * (mix(1.0, ${f(TREE_LIGHT.sunSide)}, thin) * saturate((ndl + 0.45) / 1.45) * sh + back * back * rim * 2.5 * sh * thin + ${f(TREE_LIGHT.tips)} * tip * sh * saturate(ndl + 0.2))
        + landSky(n, ${LAND_SKY.forest.toFixed(3)}, ${LAND_SKY.desat.toFixed(3)}) * (${f(TREE_LIGHT.skyFloor)} + ${f(1 - TREE_LIGHT.skyFloor)} * B.y)   // (the old bake's floor: the crown's deepest still sees a share of the sky)
        + nightLand() * (0.37 + 0.18 * n.y);   // M5e: v1's night lift, half the ground's (the tree line stays a silhouette)
  // the light through the needles: seen against the sun, a spray's fringe is a warm green
  let trans = alb * ${v3(TREE_LIGHT.trans)} * SUN * (thin * sh * saturate(-ndl) * (0.35 + 0.65 * back));
  // fix(v2) mountains: v1's trees step back with the ground (src/trees.js depthTint(lit, root, uFar)): richer and darker
  // within 0.6–2.2 km, toward the far slate × the day's light past 2.5–14 km; then the land's air (v1's far look). T3: the
  // forest's own haze (sky.js depthTintTree, the terrain's canopy the same), so the last cards and the canopy match
  // feat/v2-night-clouds: by night the crowns take NIGHT.treeNight of their light (the tree line a dark silhouette against the
  // night sky; the ground and the shore line keep theirs)
  let col = depthTintTree((alb * E * mix(1.0, ${NIGHT.treeNight.toFixed(2)}, clamp(F.night.x, 0.0, 1.0)) + trans) / PI, wt);
  var out = aerialLand(col, v.pos.xy, v.world);
  // M5a's clouds: a cloud nearer than this tree along the view ray lies over it (the terrain's rule)
  let toP = v.world - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, aa);
}`;

// wind: the water's wind texture (render/water.js windTexture: sim/windTex.js's fills), the one wind the trees sway in
export function createForest({ device, reg, graph, frameBGL, U, frameStruct = wgslStruct(), sky, terrain, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', variant = 'full', errors = [], reach = null, wind = null }) {
  // the phone pass: a mutable copy, so a quality level's reach (engine/quality.js forestAt: thin, fade, far, shrubFar) can
  // change live through setReach (the picker and the cull read it each frame; the terrain's floor ↔ canopy blend is told too)
  const L = { ...(variant === 'phone' ? FOREST.phone : FOREST.desktop), ...(reach ?? {}) };
  const [fw, fh] = L.frame, AW = ATLAS.az * fw, AH = ATLAS.el.length * fh;
  const mips = Math.log2(Math.min(fw, fh)) - 1;   // down to 4 × 8 a frame
  const C = GPUShaderStage.COMPUTE, VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const shrubCap = L.shrubs ? CAP.shrubs : 0;
  const OFF = { trees: 0, shrubs: CAP.trees, region: CAP.trees + shrubCap };
  const nInst = OFF.region + REGION_SLOTS;

  // --- buffers and textures (all made now) ---
  const inst = device.createBuffer({ label: 'forest-instances', size: nInst * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });   // COPY_SRC: readInst (10a's page test)
  const vis = device.createBuffer({ label: 'forest-visible', size: L.cap * 16, usage: GPUBufferUsage.STORAGE });
  const args = device.createBuffer({ label: 'forest-args', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC });
  // T3: the canopy grid (render/canopy.js) from the lidar's trees and the region's slots, re-made with every place and scatter
  const canopy = createCanopy({ device, reg, inst, variant, ranges: [{ first: OFF.trees, count: 0 }, { first: OFF.region, count: REGION_SLOTS }] });
  const tilesBuf = device.createBuffer({ label: 'forest-tiles', size: MAX_TILES * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const fuData = new Float32Array(36);
  fuData[32] = 1;   // the sway's gain (setSway)
  const fu = device.createBuffer({ label: 'forest-uniform', size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  // T5: atlas A the true normal + the alpha, atlas B (tN) the depth, ao, tone and bark (no colour: the draw lights it)
  const atlas = (what) => device.createTexture({ label: `forest-atlas-${what}`, size: [AW, AH, ATLAS_LAYERS], format: 'rgba8unorm', mipLevelCount: mips, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
  const tA = atlas('normal'), tN = atlas('depth-ao-tone');
  const view = (t, base, count = 1) => t.createView({ dimension: '2d-array', baseMipLevel: base, mipLevelCount: count });
  const sAtlas = device.createSampler({ label: 'forest-atlas', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: 1 });

  // --- T5: the trees' meshes (CPU, once) and the bake's own resources, made now and destroyed once the atlas is done:
  // the meshes' buffers, a row of frames at 2 × (two colour targets + depth), the layer's scratch before the dilation ---
  const tMesh = performance.now();
  const meshes = buildAll(SHAPES);
  const meshMs = performance.now() - tMesh;
  const bakeRes = [];
  const mk = (r) => { bakeRes.push(r); return r; };
  const vbs = meshes.map((m, l) => { const b = mk(device.createBuffer({ label: `forest-tree-${l}-v`, size: m.V.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })); device.queue.writeBuffer(b, 0, m.V); return b; });
  const ibs = meshes.map((m, l) => { const b = mk(device.createBuffer({ label: `forest-tree-${l}-i`, size: m.I.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })); device.queue.writeBuffer(b, 0, m.I); return b; });
  const RW = AW * 2, RH = fh * 2;
  const hiA = mk(device.createTexture({ label: 'forest-bake-hi-a', size: [RW, RH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
  const hiB = mk(device.createTexture({ label: 'forest-bake-hi-b', size: [RW, RH], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }));
  const hiD = mk(device.createTexture({ label: 'forest-bake-hi-depth', size: [RW, RH], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT }));
  const scA = mk(device.createTexture({ label: 'forest-bake-scratch-a', size: [AW, AH], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
  const scB = mk(device.createTexture({ label: 'forest-bake-scratch-b', size: [AW, AH], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
  const hiViews = { a: hiA.createView(), b: hiB.createView(), d: hiD.createView() };
  const NE_ = ATLAS.el.length;
  const bakeParams = mk(device.createBuffer({ label: 'forest-bake-params', size: 256 * ATLAS_LAYERS * NE_, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
  for (let l = 0; l < ATLAS_LAYERS; l++) for (let e = 0; e < NE_; e++) {
    const d = new ArrayBuffer(16); new Uint32Array(d, 0, 2).set([l, e]); new Float32Array(d, 8, 2).set([SPECIES[l].H, SHAPES[l].R]);
    device.queue.writeBuffer(bakeParams, 256 * (l * NE_ + e), d);
  }
  const bakeBGL = device.createBindGroupLayout({ label: 'forest-bake', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'uniform' } }] });
  const bakeBGs = Array.from({ length: ATLAS_LAYERS * NE_ }, (_, k) => device.createBindGroup({ layout: bakeBGL, entries: [{ binding: 0, resource: { buffer: bakeParams, offset: 256 * k, size: 16 } }] }));
  const tex2 = (b) => ({ binding: b, visibility: C, texture: { sampleType: 'unfilterable-float' } });
  const st2 = (b) => ({ binding: b, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d' } });
  const downBGL = device.createBindGroupLayout({ label: 'forest-down', entries: [tex2(0), tex2(1), st2(2), st2(3), { binding: 4, visibility: C, buffer: { type: 'uniform' } }] });
  const downBGs = Array.from({ length: NE_ }, (_, e) => device.createBindGroup({ layout: downBGL, entries: [{ binding: 0, resource: hiViews.a }, { binding: 1, resource: hiViews.b }, { binding: 2, resource: scA.createView() }, { binding: 3, resource: scB.createView() }, { binding: 4, resource: { buffer: bakeParams, offset: 256 * e, size: 16 } }] }));
  const st = (b, fmt) => ({ binding: b, visibility: C, storageTexture: { access: 'write-only', format: fmt, viewDimension: '2d-array' } });
  const dilBGL = device.createBindGroupLayout({ label: 'forest-dilate', entries: [tex2(0), tex2(1), st(2, 'rgba8unorm'), st(3, 'rgba8unorm'), { binding: 4, visibility: C, buffer: { type: 'uniform' } }] });
  const dilBGs = Array.from({ length: ATLAS_LAYERS }, (_, l) => device.createBindGroup({ layout: dilBGL, entries: [{ binding: 0, resource: scA.createView() }, { binding: 1, resource: scB.createView() }, { binding: 2, resource: view(tA, 0) }, { binding: 3, resource: view(tN, 0) }, { binding: 4, resource: { buffer: bakeParams, offset: 256 * (l * NE_), size: 16 } }] }));

  // --- layouts, bind groups, pipelines ---
  const mipBGL = device.createBindGroupLayout({ label: 'forest-mip', entries: [{ binding: 0, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, st(2, 'rgba8unorm'), st(3, 'rgba8unorm')] });
  const mipBGs = Array.from({ length: mips - 1 }, (_, k) => device.createBindGroup({ layout: mipBGL, entries: [{ binding: 0, resource: view(tA, k) }, { binding: 1, resource: view(tN, k) }, { binding: 2, resource: view(tA, k + 1) }, { binding: 3, resource: view(tN, k + 1) }] }));
  const ub = (b, vis_ = C) => ({ binding: b, visibility: vis_, buffer: { type: 'uniform' } });
  const sb = (b, type, vis_ = C) => ({ binding: b, visibility: vis_, buffer: { type } });
  const placeBGL = device.createBindGroupLayout({ label: 'forest-place', entries: [ub(0), sb(1, 'storage'), sb(2, 'read-only-storage')] });
  let townsBuf = device.createBuffer({ label: 'forest-towns-none', size: 16, usage: GPUBufferUsage.STORAGE });   // 10a: the towns' mask (render/towns.js) when it lands
  const placeParams = device.createBuffer({ label: 'forest-place-params', size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const placeBGOf = () => [0, 1].map((k) => device.createBindGroup({ layout: placeBGL, entries: [{ binding: 0, resource: { buffer: placeParams, offset: 256 * k, size: 16 } }, { binding: 1, resource: { buffer: inst } }, { binding: 2, resource: { buffer: townsBuf } }] }));
  let placeBGs = placeBGOf();
  const scatterBGL = device.createBindGroupLayout({ label: 'forest-scatter', entries: [ub(0), sb(1, 'storage'), sb(2, 'read-only-storage')] });
  const scatterParams = device.createBuffer({ label: 'forest-scatter-params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(scatterParams, 0, new Uint32Array([OFF.region, 0, 0, 0]));
  const scatterBGOf = () => device.createBindGroup({ layout: scatterBGL, entries: [{ binding: 0, resource: { buffer: scatterParams } }, { binding: 1, resource: { buffer: inst } }, { binding: 2, resource: { buffer: townsBuf } }] });
  let scatterBG = scatterBGOf();
  const tcountBuf = device.createBuffer({ label: 'forest-tile-counts', size: MAX_TILES * 4, usage: GPUBufferUsage.STORAGE });
  const cullBGL = device.createBindGroupLayout({ label: 'forest-cull', entries: [ub(0), sb(1, 'read-only-storage'), sb(2, 'read-only-storage'), sb(3, 'storage'), sb(4, 'storage'), sb(5, 'storage')] });
  const cullBG = device.createBindGroup({ layout: cullBGL, entries: [{ binding: 0, resource: { buffer: fu } }, { binding: 1, resource: { buffer: inst } }, { binding: 2, resource: { buffer: tilesBuf } }, { binding: 3, resource: { buffer: vis } }, { binding: 4, resource: { buffer: args } }, { binding: 5, resource: { buffer: tcountBuf } }] });
  // M5c: the terrain's shadow map, its comparison sampler and its record (render/shadow.js) at bindings 5–7
  const drawBGL = device.createBindGroupLayout({ label: 'forest-draw', entries: [sb(0, 'read-only-storage', VX), { binding: 1, visibility: FR, texture: { viewDimension: '2d-array' } }, { binding: 2, visibility: FR, texture: { viewDimension: '2d-array' } }, { binding: 3, visibility: FR, sampler: {} }, ub(4, VX | FR),
    { binding: 5, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 6, visibility: FR, sampler: { type: 'comparison' } }, ub(7, FR), sb(8, 'read-only-storage', VX)] });
  // the sway's wind: the water's texture (no wind texture given: a still one, the frame's mean wind read)
  const windBuf = wind ?? device.createBuffer({ label: 'forest-wind-none', size: WIND_TEX * WIND_TEX * 8, usage: GPUBufferUsage.STORAGE });
  const drawBG = device.createBindGroup({ layout: drawBGL, entries: [{ binding: 0, resource: { buffer: vis } }, { binding: 1, resource: view(tA, 0, mips) }, { binding: 2, resource: view(tN, 0, mips) }, { binding: 3, resource: sAtlas }, { binding: 4, resource: { buffer: fu } },
    { binding: 5, resource: shadow.view }, { binding: 6, resource: shadow.sampler }, { binding: 7, resource: { buffer: shadow.buffer } }, { binding: 8, resource: { buffer: windBuf } }] });

  const pl = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
  // T5: the bake draws a tree's mesh into a row of frames (two colour targets: A and B), then the down and dilate passes
  const mBake = reg.shader('forest-bake', TREE_BAKE_WGSL);
  const vAttr = [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x4' }];
  reg.add('forest-bake', { layout: pl(bakeBGL), vertex: { module: mBake, entryPoint: 'vs', buffers: [{ arrayStride: FL * 4, attributes: vAttr }] },
    fragment: { module: mBake, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' } });
  const mDown = reg.shader('forest-down', CARD_DOWN_WGSL(fw, fh));
  reg.add('forest-down', { layout: pl(downBGL), compute: { module: mDown, entryPoint: 'down' } });
  const mDil = reg.shader('forest-dilate', CARD_DILATE_WGSL(fw, fh));
  reg.add('forest-dilate', { layout: pl(dilBGL), compute: { module: mDil, entryPoint: 'dilate' } });
  const mMip = reg.shader('forest-mip', CARD_MIP_WGSL);
  reg.add('forest-mip', { layout: pl(mipBGL), compute: { module: mMip, entryPoint: 'mip' } });
  const mPlace = reg.shader('forest-place', PLACE_WGSL);
  reg.add('forest-place', { layout: pl(terrain.hbgl, placeBGL), compute: { module: mPlace, entryPoint: 'place' } });
  const mScatter = reg.shader('forest-scatter', SCATTER_PASS_WGSL);
  reg.add('forest-scatter', { layout: pl(terrain.hbgl, terrain.coverBGL, scatterBGL), compute: { module: mScatter, entryPoint: 'scatterMain' } });
  const mCull = reg.shader('forest-cull', CULL_WGSL);
  for (const e of ['reset', 'countTiles', 'scanTiles', 'writeTiles']) reg.add(`forest-${e}`, { layout: pl(cullBGL), compute: { module: mCull, entryPoint: e } });
  // #31 (MSAA live): the cut changes with the sample count (alpha to coverage under MSAA, a plain cut without), so the draw is
  // declared as a function of the count: the registry makes each count's module at load and builds each count's pipeline
  const drawLayout = pl(frameBGL, sky.skyBGL, drawBGL);
  reg.add('forest-draw', (n) => { const mDraw = reg.shader(n === msaa ? 'forest-draw' : `forest-draw@${n}x`, CARD_DRAW_WGSL(frameStruct, n, fw, fh));
    return { layout: drawLayout, vertex: { module: mDraw, entryPoint: 'vs' }, fragment: { module: mDraw, entryPoint: 'fs', targets: [hdrTarget] },
      primitive: { topology: 'triangle-strip', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: n, alphaToCoverageEnabled: n > 1 } }; });

  // --- the per-frame tile pick (CPU) ---
  const cellsB = terrain.bounds.pyramid[0], NB = TREE.cells, CB = TREE.cell, OB = TREE.origin;
  function ground(x0, z0, x1, z1, out) {   // the terrain's height bounds over a box (the 256 m cells of the quadtree's grid)
    let lo = Infinity, hi = -Infinity;
    const i0 = Math.floor((x0 - OB) / CB), i1 = Math.floor((x1 - 1e-3 - OB) / CB), j0 = Math.floor((z0 - OB) / CB), j1 = Math.floor((z1 - 1e-3 - OB) / CB);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { if (i < 0 || j < 0 || i >= NB || j >= NB) continue; const k = 2 * (j * NB + i); if (cellsB[k] < lo) lo = cellsB[k]; if (cellsB[k + 1] > hi) hi = cellsB[k + 1]; }
    out[0] = lo; out[1] = hi; return out;
  }
  const picker = createTilePicker({ L, ground, boxInFrustum, offsets: OFF });
  const planes = new Float64Array(20);

  // --- the data stream: a worker decodes; the frame uploads ≤ 1 MB slices ---
  const stats = { bytes: 0, files: 0, decodeMs: 0, trees: 0, shrubs: 0, regionRuns: 0, places: 0, baked: 0, mipsDone: false, ready: false, uploads: 0, tiles: 0, tested: 0, visible: 0, total: 0, guard: 0, overflow: 0, log: [] };
  const queue = [];   // { data: Uint32Array, dst (byte offset), off (bytes done) }
  let worker = null, nextId = 1;
  const pending = new Map();
  const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL('../forest/worker.js', import.meta.url), { type: 'module', name: 'velia-forest' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data); };
    worker.onerror = (e) => { errors.push(`forest worker: ${e.message}`); };
    return worker;
  };
  const fetchFile = (url) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ensureWorker().postMessage({ id, url }); });
  const URLS = { trees: new URL('../forest/data/trees.vft', import.meta.url).href, shrubs: new URL('../forest/data/shrubs.vft', import.meta.url).href };
  let uploadsLeft = 0, placeDirty = false, scatterDirty = false, lastSwaps = -1, bakeNext = 0;
  function land(kind, msg) {
    const fdec = msg.file, cap = kind === 'trees' ? CAP.trees : shrubCap;
    if (fdec.n > cap) throw new Error(`forest: ${fdec.n} ${kind} over the buffer's ${cap}`);
    stats.bytes += msg.bytes; stats.files++; stats.decodeMs += msg.ms; stats[kind] = fdec.n;
    stats.log.push(`${kind} ${(msg.bytes / 1024).toFixed(0)} KB ${msg.ms.toFixed(0)} ms`);
    queue.push({ kind, data: fdec.inst, dst: OFF[kind] * 16, off: 0, file: fdec });
    uploadsLeft++;
  }
  function pump(budget = 1 << 20) {
    let done = 0;
    while (queue.length && done < budget) {
      const j = queue[0], n = Math.min(j.data.byteLength - j.off, budget - done);
      device.queue.writeBuffer(inst, j.dst + j.off, j.data.buffer, j.data.byteOffset + j.off, n);
      j.off += n; done += n; stats.uploads++;
      if (j.off >= j.data.byteLength) { queue.shift(); picker.src[j.kind] = j.file; uploadsLeft--; placeDirty = true; }
    }
    return done;
  }
  async function load({ shrubs = L.shrubs } = {}) {
    const kinds = shrubs ? ['trees', 'shrubs'] : ['trees'];
    await Promise.all(kinds.map(async (k) => land(k, await fetchFile(URLS[k]))));
  }

  // --- the one-offs (stream events) and the frame's pass ---
  // T5: one tree's layer on an encoder: each row of 12 frames drawn at 2 ×, brought down into the scratch; then the
  // layer dilated into the atlas's mip 0
  function encodeBake(enc, l) {
    const m = meshes[l];
    for (let e = 0; e < NE_; e++) {
      const rp = enc.beginRenderPass({ label: `forest-bake-${l}-${e}`, colorAttachments: [{ view: hiViews.a, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }, { view: hiViews.b, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
        depthStencilAttachment: { view: hiViews.d, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' } });
      rp.setPipeline(reg.get('forest-bake')); rp.setBindGroup(0, bakeBGs[l * NE_ + e]);
      rp.setVertexBuffer(0, vbs[l]); rp.setIndexBuffer(ibs[l], 'uint32'); rp.drawIndexed(m.ni, ATLAS.az);
      rp.end();
      const cp = enc.beginComputePass({ label: `forest-down-${l}-${e}` });
      cp.setPipeline(reg.get('forest-down')); cp.setBindGroup(0, downBGs[e]); cp.dispatchWorkgroups(Math.ceil(AW / 8), Math.ceil(fh / 8));
      cp.end();
    }
    const cp = enc.beginComputePass({ label: `forest-dilate-${l}` });
    cp.setPipeline(reg.get('forest-dilate')); cp.setBindGroup(0, dilBGs[l]); cp.dispatchWorkgroups(Math.ceil(AW / 8), Math.ceil(AH / 8));
    cp.end();
    stats.baked++;
  }
  function encodeMips(enc) {
    const pass = enc.beginComputePass({ label: 'forest-mips' });
    pass.setPipeline(reg.get('forest-mip'));
    for (let k = 0; k < mips - 1; k++) { pass.setBindGroup(0, mipBGs[k]); pass.dispatchWorkgroups(Math.ceil((AW >> (k + 1)) / 8), Math.ceil((AH >> (k + 1)) / 8), ATLAS_LAYERS); }
    pass.end();
    stats.mipsDone = true;
  }
  // the bake's due work on an encoder: a layer a frame on a live page (all at once when primed), then the mips; its own
  // buffers and textures are destroyed after the submit that carries the mips (the queue finishes the work first)
  let bakeFreed = false;
  function bakeStep(enc, all) {
    while (bakeNext < ATLAS_LAYERS) { encodeBake(enc, bakeNext++); if (!all) return; }
    if (!stats.mipsDone) encodeMips(enc);
  }
  function freeBake() { if (bakeFreed || !stats.mipsDone) return; bakeFreed = true; for (const r of bakeRes) r.destroy(); }
  // perf(v2) iOS pipelines: the bake waits for the forest's group (main.js builds it after the first frame on a live page)
  const pipesIn = () => (reg.groupOf ? reg.ready(reg.groupOf('forest-bake')) : true);
  graph.onBeforeSubmit((enc) => { if (!stats.mipsDone && pipesIn()) bakeStep(enc, false); });
  graph.onAfterSubmit(freeBake);
  function dispatchPlace(pass) {
    const parts = [[OFF.trees, picker.src.trees?.n ?? 0], [OFF.shrubs, picker.src.shrubs?.n ?? 0]];
    pass.setPipeline(reg.get('forest-place')); pass.setBindGroup(0, terrain.heightsBindGroup);
    parts.forEach(([first, n], k) => { if (!n) return; pass.setBindGroup(1, placeBGs[k]); pass.dispatchWorkgroups(Math.ceil(n / 64)); });
    stats.places++;
  }
  for (let k = 0; k < 2; k++) device.queue.writeBuffer(placeParams, 256 * k, new Uint32Array([k ? OFF.shrubs : OFF.trees, 0, 0, 0]));
  function dispatchScatter(pass) {
    pass.setPipeline(reg.get('forest-scatter')); pass.setBindGroup(0, terrain.heightsBindGroup); pass.setBindGroup(1, terrain.coverBindGroup); pass.setBindGroup(2, scatterBG);
    pass.dispatchWorkgroups(Math.ceil(REGION_SLOTS / 64)); stats.regionRuns++; picker.src.region = true;
  }
  // the one-offs due now: the atlas (a layer a frame live, all at once when primed), the place and the scatter after a
  // grid swapped (every swap: the heights or the cover moved under the trees)
  function oneOffs(pass, all) {
    if (!stats.mipsDone && !all) return;   // the bake first (bakeStep, on the frame's encoder after its passes)
    let moved = false;
    if (placeDirty && picker.src.trees) {
      for (let k = 0; k < 2; k++) device.queue.writeBuffer(placeParams, 256 * k + 4, new Uint32Array([k ? picker.src.shrubs?.n ?? 0 : picker.src.trees.n]));
      dispatchPlace(pass); placeDirty = false; moved = true;
    }
    if (scatterDirty) { dispatchScatter(pass); scatterDirty = false; moved = true; }
    if (moved) { canopy.setCount(0, picker.src.trees?.n ?? 0); canopy.run(pass); }   // T3: the canopy follows the trees
    stats.ready = stats.mipsDone && !!picker.src.trees && picker.src.region && !queue.length;
  }

  // the visible count, read back a few frames late (a ring of 3 mappable copies; nothing made per frame)
  const ring = Array.from({ length: 3 }, (_, i) => ({ buf: device.createBuffer({ label: `forest-args-read-${i}`, size: 32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false }));
  let slot = 0, copied = false;
  graph.onBeforeSubmit((enc) => { const r = ring[slot]; if (r.busy || !active) { copied = false; return; } enc.copyBufferToBuffer(args, 0, r.buf, 0, 32); copied = true; });
  graph.onAfterSubmit(() => {
    if (!copied) return;
    const r = ring[slot]; r.busy = true;
    r.buf.mapAsync(GPUMapMode.READ).then(() => { const a = new Uint32Array(r.buf.getMappedRange()); stats.visible = a[1]; stats.guard = a[4]; stats.total = a[5]; stats.overflow = Math.max(0, a[5] - L.cap); r.buf.unmap(); r.busy = false; }, () => { r.busy = false; });
    slot = (slot + 1) % ring.length;
  });

  let active = false, tileCount = 0;
  return {
    canopy,   // T3: the terrain binds its packed grid (main.js: terrain.attach({ canopy }))
    L, stats, picker, OFF, atlas: { width: AW, height: AH, mips, frame: [fw, fh] },
    base: variant === 'phone' ? FOREST.phone : FOREST.desktop,
    // the sway's gain (1: v1's; 0: the trees stand still), the level's knob; read by the next update
    setSway(g = 1) { fuData[32] = Math.max(0, +g || 0); },
    get sway() { return fuData[32]; },
    setReach(o = {}) { for (const k of ['thin', 'fade', 'far', 'shrubFar']) if (Number.isFinite(o[k])) L[k] = o[k]; terrain?.setForest?.(L, true); },
    get queued() { return queue.length; },
    load, pump,
    // test only (v2/tests/pages/towns.page.mjs): records [first, first + count) of the instance buffer, read back (makes a buffer)
    regionSlots: REGION_SLOTS,
    async readInst(first, count) {
      const buf = device.createBuffer({ size: count * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(inst, first * 16, buf, 0, count * 16); device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ); const out = Array.from(new Float32Array(buf.getMappedRange().slice(0))); buf.unmap(); buf.destroy(); return out;
    },
    // 10a: the towns' mask (render/towns.js): the place and the scatter re-run with v1's keep-out
    setTowns(buf) { townsBuf = buf; placeBGs = placeBGOf(); scatterBG = scatterBGOf(); placeDirty = !!picker.src.trees; scatterDirty = true; },
    // headless: the files, the atlas, the place and the scatter, all before the first frame (one submit)
    async prime() {
      await load();
      while (queue.length) pump(Infinity);
      lastSwaps = terrain.stats.swaps; scatterDirty = true;
      const enc = device.createCommandEncoder({ label: 'forest-prime' });
      bakeStep(enc, true);
      const pass = enc.beginComputePass({ label: 'forest-prime' });
      oneOffs(pass, true);
      pass.end(); device.queue.submit([enc.finish()]);
      freeBake();
      await device.queue.onSubmittedWorkDone();
    },
    // the meshes' size and build time (the numbers in v2/notes/terrain.md; the tests read the meshes themselves)
    meshStats: { ms: meshMs, tris: meshes.map((m) => m.ni / 3), verts: meshes.map((m) => m.nv), boughs: meshes.map((m) => m.boughs), bytes: meshes.reduce((s, m) => s + m.V.byteLength + m.I.byteLength, 0) },
    // test only (tests/pages/forestBake.page.mjs): one layer's mip 0 of both atlases, read back (makes a buffer)
    async readLayer(layer) {
      const bpr = Math.ceil(AW * 4 / 256) * 256, out = {};
      for (const [k, t] of [['a', tA], ['b', tN]]) {
        const buf = device.createBuffer({ size: bpr * AH, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const enc = device.createCommandEncoder();
        enc.copyTextureToBuffer({ texture: t, mipLevel: 0, origin: [0, 0, layer] }, { buffer: buf, bytesPerRow: bpr }, [AW, AH, 1]);
        device.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const src = new Uint8Array(buf.getMappedRange()), px = new Uint8Array(AW * AH * 4);
        for (let y = 0; y < AH; y++) px.set(src.subarray(y * bpr, y * bpr + AW * 4), y * AW * 4);
        buf.unmap(); buf.destroy(); out[k] = Array.from(px);
      }
      return { width: AW, height: AH, frame: [fw, fh], az: ATLAS.az, el: ATLAS.el, R: SHAPES[layer].R, ...out };
    },
    // per frame, before the graph runs: the swaps since the last frame, the tiles in range and view, the uniform
    update(eye, viewProj, focalPx) {
      if (terrain.stats.swaps !== lastSwaps) { lastSwaps = terrain.stats.swaps; placeDirty = !!picker.src.trees; scatterDirty = true; }
      frustumPlanes(viewProj, planes);
      tileCount = stats.mipsDone ? picker.pick(eye, planes) : 0;
      if (tileCount) device.queue.writeBuffer(tilesBuf, 0, picker.out.buffer, 0, tileCount * 16);
      stats.tiles = tileCount; stats.tested = picker.tested;
      for (let i = 0; i < 20; i++) fuData[i] = planes[i];
      fuData[20] = L.thin; fuData[21] = L.fade; fuData[22] = L.far; fuData[23] = L.wmax;
      fuData[24] = L.shrubFar; fuData[25] = focalPx; fuData[26] = L.cap; fuData[27] = stats.mipsDone ? 1 : 0;
      fuData[28] = eye[0]; fuData[29] = eye[1]; fuData[30] = eye[2]; fuData[31] = tileCount;
      device.queue.writeBuffer(fu, 0, fuData);
      active = stats.mipsDone && tileCount > 0;
    },
    // the 'forest' compute pass: the one-offs due, then reset → cull → clamp
    run(pass, c) {
      oneOffs(pass, false);
      pass.setBindGroup(0, cullBG);
      pass.setPipeline(reg.get('forest-reset')); pass.dispatchWorkgroups(1); c.dispatches++;
      if (!active) return;
      pass.setPipeline(reg.get('forest-countTiles')); pass.dispatchWorkgroups(tileCount);
      pass.setPipeline(reg.get('forest-scanTiles')); pass.dispatchWorkgroups(1);
      pass.setPipeline(reg.get('forest-writeTiles')); pass.dispatchWorkgroups(tileCount); c.dispatches += 3;
    },
    // in the scene pass after the terrain: every survivor, one indirect draw (the count stays on the GPU)
    draw(pass, c) {
      if (!active) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, drawBG);
      pass.setPipeline(reg.get('forest-draw')); pass.drawIndirect(args, 0); c.calls++; c.triangles += (CARD_VERTS - 2) * stats.visible;
    },
    stop() { worker?.terminate(); worker = null; },
  };
}
