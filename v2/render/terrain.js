// The terrain (M2): Tahoe's real elevation grids on the GPU, streamed, with the lake bed seen through the water.
//   Data: v1's five nested grids (v2/terrain/levels.js), each a "slot" texture (r16uint codes, the GPU reads them with
//   textureLoad: the same codes, the same clamped bilinear and the same level blend as v1's sampler, so the drawn ground
//   is v1's heightAt to the f32 rounding; the probe below proves it in the browser). Three NLCD cover grids (r8uint).
//   A worker fetches and decodes (v2/terrain/worker.js); the page uploads a slice a frame (≤ UPLOAD_BYTES) into a new
//   texture and swaps it in when whole, so a frame never waits on a 10 MB upload; the slot's bind group and its level
//   record (a small uniform buffer written only at a swap) change at that moment, never in between.
//   Mesh: CDLOD (v2/terrain/quadtree.js): the CPU picks node quadrants a frame and writes their (x0, z0, level, cell)
//   records; the vertex shader builds each vertex from its instance and the grids, morphing the far 30 % of a level onto
//   the next level's grid. One 33 × 33 patch, one instanced draw.
//   Shading: the normal from the height function at the pixel's footprint (finite differences: no normal map, no
//   aliasing far off); cover classes, slope (granite past ≈ 40°), the season's snow (the map's day: early July, the line
//   at 3,000 m, north faces 300 m lower) and beaches (low, gentle ground at the water) give the albedo (v1's coverAt
//   rules, src/sim/terrain.js); the M1 sun through the transmittance LUT at the point's altitude plus the sky's
//   hemispheric light; the aerial perspective's froxels (render/sky.js) on top. Below the lake surface the same pass
//   draws the bed as seen through the water column: Tahoe's per-channel attenuation and backscatter (src/sim/
//   water-spectrum.js WATER_K, WATER_B; v1's clarity-optics bodyRadiance) along the refracted view and the refracted
//   sun, so the water surface (render/water.js) only adds its Fresnel reflection, glint and foam over it.
import { wgslStruct } from '../engine/uniforms.js';
import { ATMO_WGSL, SKY_READ, AP_READ, TRANS_READ, NIGHT_SKY_WGSL, STORM_FOG_WGSL, LAND_SKY, LAND_LOOK } from './sky.js';
import { NIGHT } from '../sim/night.js';   // look/v2-night-look: the mirrored land's share of the airglow
import { SLOTS, COVER_SLOTS, BLEND } from '../terrain/levels.js';
const BED_SLOT = SLOTS.indexOf('bay');   // the height slot the bed's fragment reads (bedHeightAt)
import { TREE, PATCH, createBounds, createSelector, frustumPlanes } from '../terrain/quadtree.js';
import { createHeightField } from '../terrain/sample.js';
import { WATER_K, WATER_B } from '../../src/sim/water-spectrum.js';
import { bedWgsl } from './bed.js';
import { UNDER_WGSL } from './underMedium.js';   // play as Tessie, phase 2a: the bed from under the water
import { underPipe } from './underState.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { MIRROR_HAZE_M } from './water-aa.js';   // M5d: v1's mirror haze on the reflected land
import { TOWNS_BIND, TOWNS_READ, TOWNS_PAINT_WGSL } from '../towns/wgsl.js';
import { lmPoint } from '../engine/loadMarks.js';   // the load report: the terrain worker made, its first reply   // 10a: the ski runs and the Hwy 89 cut (render/towns.js)
import { CANOPY_READ } from './canopy.js';   // T3: the far forest's canopy grid (render/canopy.js, forest/canopy.js)
import { CANOPY } from '../forest/canopy.js';
import { ROCK_DETAIL_WGSL } from './rockDetail.js';   // feat/v2-look-ponlai: the close rock (hex-tiled CC0 rock inside 40 m)

// M5d (2026-11-13): v1's granite relief (src/terrain-mesh.js normalNode: a 3-D noise's gradient bends the rock's normal
// within 500 m, gain 0.32) and the rock's look under v2's light: a local material match, as the sail's CLOTH_AMB. v1's
// AgX shows the island's photo texels as a pale, cool lichen grey; v2's ACES fit left the same texels darker, redder and
// more saturated (cam I's rock pixels, linear mean, v1 / v2: 0.127,0.131,0.099 / 0.098,0.089,0.058). ROCK_LOOK is that
// ratio on the photo's bare rock (cliffs and the bare class), nothing else: not the forest floor, the beaches or the snow.
export const RELIEF = Object.freeze({ k: 0.2, nearM: 150, farM: 500 });   // v1's 0.32 on a Perlin gradient; the value noise's gradient runs steeper, 0.2 reads the same depth of joint
export const ROCK_LOOK = Object.freeze([1.35, 1.56, 1.76]);   // the first fit (1.30, 1.47, 1.72) re-measured once with the relief in: cam I's rock mean then 98,98,88 against v1's 100,101,89, a touch redder and bluer than v1's green-grey

export const UPLOAD_BYTES = 1 << 20;   // per frame: one slice of a landed grid (1 MB: ≈ 0.2 ms of queue copy on the Mac)
export const N_WATER = 1.333;
// the ground's albedos (linear): v1's material families without its photo (granite, conifer canopy as seen from afar
// until M5's trees, manzanita, meadow fresh → straw by the season, decomposed-granite sand, the lake bed's sand and silt)
export const ALBEDO = Object.freeze({
  urban: [0.13, 0.12, 0.105], open: [0.14, 0.13, 0.10], rock: [0.20, 0.19, 0.165], forest: [0.022, 0.036, 0.021], shrub: [0.040, 0.047, 0.027],
  grassFresh: [0.055, 0.085, 0.030], grassDry: [0.13, 0.115, 0.07], snow: [0.80, 0.83, 0.88], sand: [0.40, 0.37, 0.30], wet: [0.20, 0.18, 0.145],
  bed: [0.46, 0.43, 0.36], silt: [0.20, 0.19, 0.16], pond: [0.02, 0.035, 0.06],
  floor: [0.068, 0.066, 0.058],   // M5b: the forest floor between the drawn trees (needle duff and granite grit, in their shade)
});
// the water's optics: diffuse attenuation K and backscatter b per channel (1/m), so the deep colour is b / 2K; the
// radiance crossing the surface up into the air keeps t / n² ≈ 0.54 of itself
export const WATER = Object.freeze({ K: WATER_K, Rinf: WATER_K.map((k, c) => WATER_B[c] / (2 * k)), up: 0.54 });

const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
// the water column's constants for any shader (the bed here, the deep body in render/water.js: the same numbers, so the
// bed at depth and the water's own opaque body meet without a seam)
export const WATER_WGSL = `const WK = ${v3(WATER.K)}; const RINF = ${v3(WATER.Rinf)}; const WUP = ${WATER.up}; const NW = ${N_WATER};`;

// --- the WGSL pieces (the water shares the bindings and the height function at its own group) ---
export const TERRAIN_STRUCT = `
struct Level { a: vec4f, b: vec4f }   // a: x0, z0, 1/step, held (0 | 1); b: w, h, step, 0
struct TerrainU { lv: array<Level, ${SLOTS.length}>, cv: array<Level, ${COVER_SLOTS.length}>, hs: vec4f, season: vec4f, season2: vec4f, forest: vec4f, canopy: vec4f, canopy2: vec4f }`;   // forest: M5b's card range (thin, fade, far, on); T3's canopy grid: x0, z0, 1 / texel, nx | nz, on, the cards' wmax, texel
// the heights group (the water's group 3, the probe's group 0; the first six bindings of the terrain's own group 2)
export const TERRAIN_BIND = (g) => `${TERRAIN_STRUCT}
@group(${g}) @binding(0) var<uniform> TU: TerrainU;
${SLOTS.map((s, k) => `@group(${g}) @binding(${1 + k}) var tH${k}: texture_2d<u32>;`).join('\n')}`;
// the terrain's own group 2 beyond the heights: the baked maps (M5c: one texture a slot, the normal + cavity in its
// left half and the albedo + forest share in its right half, so the five slots take 5 of the stage's 16 sampled
// textures, not 10), their sampler, the instances; then M5c's bindings: the ground photo's tiles (one array texture,
// the bay level and the region level as its layers), the detail set (v1's six CC0 layers: albedo 0–5, normal + height
// 6–11), the water's slope cascades (the bed's refraction wobble and the caustics' blur), the terrain shadow map and
// its comparison sampler, the M5c uniform (the photo's records, the shadow's matrix, the bed's look)
const B = { maps: 1 + SLOTS.length };
B.sampler = B.maps + SLOTS.length; B.inst = B.sampler + 1;
B.photo = B.inst + 1; B.detail = B.photo + 1; B.slope = B.detail + 1; B.shadow = B.slope + 1;
B.sPhoto = B.shadow + 1; B.sDetail = B.sPhoto + 1; B.sSlope = B.sDetail + 1; B.sShadow = B.sSlope + 1; B.m5c = B.sShadow + 1; B.shadowU = B.m5c + 1;
B.towns = B.shadowU + 1;   // 10a: the towns' mask (a storage buffer: no sampled texture, the stage's 16 stay as they were)
// ultra M2 (texture room): the bay's height codes for the fragment stage (bedHeightAt) as a storage buffer, a GPU copy of
// the bay slot's texture (copyTextureToBuffer at its swap: the same codes, two to a u32, rows padded to 256 bytes); the
// bay's texture now reaches the vertex stage only, so the fragment stage samples 15 textures, and the caustics (render/
// caustics.js: one rgba16float array, two cascades' layers, the three depth slices in each layer's channels) take the 16th
B.bedH = B.towns + 1; B.caustic = B.bedH + 1;
B.canopy = B.caustic + 1;   // T3: the canopy grid's packed words (render/canopy.js: a storage buffer, the vertex's lift and the fragment's layer)
export const M5C_STRUCT = `
struct PhotoL { a: vec4f, b: vec4f }   // a: x0, z0, 1/texel, on;  b: w (px), h (px), tile (px), layer
struct M5cU { photo: array<PhotoL, 2>, bed: vec4f, bed2: vec4f, detail: vec4f, grid: vec4f }`;
// bed: big boulders on, 0, 0, bed detail on;  bed2: fine (the phone pass: 1 full, 0 v1's phone path), 0, 0, caustics on;  detail: detail on, photo on, time, tiles across (bay);  grid: tiles across (region), 0, 0, 0
const DRAW_BIND = (g) => `${M5C_STRUCT}
${SLOTS.map((s, k) => `@group(${g}) @binding(${B.maps + k}) var tM${k}: texture_2d<f32>;`).join('\n')}
@group(${g}) @binding(${B.sampler}) var sN: sampler;
@group(${g}) @binding(${B.inst}) var<storage, read> inst: array<vec4f>;
@group(${g}) @binding(${B.photo}) var tPhoto: texture_2d_array<f32>;
@group(${g}) @binding(${B.detail}) var tDetail: texture_2d_array<f32>;
@group(${g}) @binding(${B.slope}) var tWSlope: texture_2d_array<f32>;
@group(${g}) @binding(${B.shadow}) var tTShadow: texture_depth_2d;
@group(${g}) @binding(${B.sPhoto}) var sPhoto: sampler;
@group(${g}) @binding(${B.sDetail}) var sDetail: sampler;
@group(${g}) @binding(${B.sSlope}) var sSlope: sampler;
@group(${g}) @binding(${B.sShadow}) var sTShadow: sampler_comparison;
@group(${g}) @binding(${B.m5c}) var<uniform> M: M5cU;
@group(${g}) @binding(${B.bedH}) var<storage, read> bedH: array<u32>;
@group(${g}) @binding(${B.caustic}) var tCaustic: texture_2d_array<f32>;
@group(${g}) @binding(${B.canopy}) var<storage, read> canopyB: array<u32>;`;
// the bake's group 1: the level records (binding 0) and the three cover grids
export const COVER_BIND = (g) => `
${COVER_SLOTS.map((s, k) => `@group(${g}) @binding(${1 + k}) var tC${k}: texture_2d<u32>;`).join('\n')}`;
export const TERRAIN_HEIGHT = `
const BLEND = ${BLEND.toFixed(1)};
// v1's clamped bilinear (src/sim/terrain-data.js bil) on slot k's codes at fractional texel (fx, fz); one function a slot
// (the speed pass: a slot picked by a switch inside the level loop cost the water's pixels every slot's loads)
${SLOTS.map((s, k) => `fn hBil${k}(fx0: f32, fz0: f32, w: f32, h: f32) -> f32 {
  let fx = clamp(fx0, 0.0, w - 1.0); let fz = clamp(fz0, 0.0, h - 1.0);
  let i = min(floor(fx), w - 2.0); let j = min(floor(fz), h - 2.0);
  let u = fx - i; let v = fz - j; let p = vec2i(i32(i), i32(j));
  let a = f32(textureLoad(tH${k}, p, 0).r); let b = f32(textureLoad(tH${k}, p + vec2i(1, 0), 0).r); let c = f32(textureLoad(tH${k}, p + vec2i(0, 1), 0).r); let d = f32(textureLoad(tH${k}, p + vec2i(1, 1), 0).r);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}`).join('\n')}
// metres above the lake surface (negative: the lake bed); the finest held level, blended into the next over BLEND texels.
// The level loop unrolled (each level's own texture, no switch): the same arithmetic in the same order as the loop
fn terrainHeight(x: f32, z: f32) -> f32 {
  var acc = 0.0; var left = 1.0; let last = u32(TU.hs.z);
${SLOTS.map((s, k) => `  if (${k}u <= last) {
    let L = TU.lv[${k}];
    if (L.a.w >= 0.5) {
      let fx = (x - L.a.x) * L.a.z; let fz = (z - L.a.y) * L.a.z; let w = L.b.x; let h = L.b.y;
      let m = min(min(fx, fz), min(w - 1.0 - fx, h - 1.0 - fz));
      if (!(m <= 0.0 && ${k}u < last)) {
        let v = TU.hs.x + TU.hs.y * hBil${k}(fx, fz, w, h);
        if (m >= BLEND || ${k}u == last) { return acc + left * v; }
        let t = m / BLEND; let s = t * t * (3.0 - 2.0 * t);
        acc += left * s * v; left *= 1.0 - s;
      }
    }
  }`).join('\n')}
  return acc;
}
// the finest held grid's spacing at (x, z)
fn terrainSpacing(x: f32, z: f32) -> f32 {
  let last = u32(TU.hs.z);
  for (var k = 0u; k <= last; k++) {
    let L = TU.lv[k];
    if (L.a.w < 0.5) { continue; }
    let fx = (x - L.a.x) * L.a.z; let fz = (z - L.a.y) * L.a.z;
    if (min(min(fx, fz), min(L.b.x - 1.0 - fx, L.b.y - 1.0 - fz)) > 1.0) { return L.b.z; }
  }
  return TU.lv[last].b.z;
}`;

export const NOISE_WGSL = `
fn hash(p: vec2f) -> f32 {   // Hoskins' hash12 (no sin: cheaper, and stable in f32 far from the origin)
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn hash3(p: vec3f) -> f32 {   // Hoskins' hash13
  var p3 = fract(p * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z);
}
// a 3-D value noise, −1..1 (M5d: v1's granite relief, terrain-mesh.js normalNode, used mx_noise_float in −1..1)
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i), hash3(i + vec3f(1.0, 0.0, 0.0)), u.x), mix(hash3(i + vec3f(0.0, 1.0, 0.0)), hash3(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hash3(i + vec3f(0.0, 0.0, 1.0)), hash3(i + vec3f(1.0, 0.0, 1.0)), u.x), mix(hash3(i + vec3f(0.0, 1.0, 1.0)), hash3(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z) * 2.0 - 1.0;
}
fn reliefF(q: vec3f) -> f32 { return vnoise3(q) + 0.4 * vnoise3(q * 3.3); }`;

// the draw's material read: each held level's baked maps (normal + cavity, albedo), walked and blended as the height;
// minStep skips levels finer than a third of the pixel's footprint (the five levels are the maps' mip chain: far ground
// lights its mean slope and colour and never sparkles)
const MATERIAL_READ = `
struct Mat { n: vec4f, a: vec4f }
// M5c: one map a slot, the normal + cavity (as 0..1) in its left half, the albedo + forest share in its right; the
// bilinear never crosses the middle (a sample sits between the first and the last texel centre of its half)
fn mSample(k: u32, uv: vec2f) -> Mat {
  var m: Mat;
  let uL = vec2f(uv.x * 0.5, uv.y); let uR = vec2f(uv.x * 0.5 + 0.5, uv.y);
  switch k {
${SLOTS.map((s, k) => `    case ${k}u: { m.n = textureSampleLevel(tM${k}, sN, uL, 0.0) * 2.0 - 1.0; m.a = textureSampleLevel(tM${k}, sN, uR, 0.0); }`).join('\n')}
    default: { m.n = vec4f(0.0, 1.0, 0.0, 0.0); m.a = vec4f(0.4, 0.4, 0.4, 0.5); }
  }
  return m;
}
fn terrainMaterial(x: f32, z: f32, minStep: f32) -> Mat {
  var acc: Mat; acc.n = vec4f(0.0); acc.a = vec4f(0.0); var left = 1.0; let last = u32(TU.hs.z);
  for (var k = 0u; k <= last; k++) {
    let L = TU.lv[k];
    if (L.a.w < 0.5 || (L.b.z < minStep && k < last)) { continue; }
    let fx = (x - L.a.x) * L.a.z; let fz = (z - L.a.y) * L.a.z; let w = L.b.x; let h = L.b.y;
    let m = min(min(fx, fz), min(w - 1.0 - fx, h - 1.0 - fz));
    if (m <= 0.0 && k < last) { continue; }
    let v = mSample(k, (vec2f(fx, fz) + 0.5) / vec2f(w, h));
    if (m >= BLEND || k == last) { acc.n += left * v.n; acc.a += left * v.a; return acc; }
    let t = m / BLEND; let s = t * t * (3.0 - 2.0 * t);
    acc.n += left * s * v.n; acc.a += left * s * v.a; left *= 1.0 - s;
  }
  return acc;
}`;

// the bake's ground: v1's coverAt rules (src/sim/terrain.js) at a world point of height h with normal n → linear albedo
export const GROUND_WGSL = `
${NOISE_WGSL}
// the finest cover grid's spacing at (x, z) (32 m past every cover grid)
fn terrainCoverStep(x: f32, z: f32) -> f32 {
  for (var k = 0u; k < ${COVER_SLOTS.length}u; k++) {
    let L = TU.cv[k];
    if (L.a.w < 0.5) { continue; }
    let fx = (x - L.a.x) * L.a.z; let fz = (z - L.a.y) * L.a.z;
    if (fx >= 0.0 && fz >= 0.0 && fx <= L.b.x - 1.0 && fz <= L.b.y - 1.0) { return L.b.z; }
  }
  return 32.0;
}
fn cTexel(k: u32, p: vec2i) -> u32 {
  switch k {
${COVER_SLOTS.map((s, k) => `    case ${k}u: { return textureLoad(tC${k}, p, 0).r; }`).join('\n')}
    default: { return 0u; }
  }
}
// the class weights of the four nearest texels of the finest cover grid that holds (x, z) (v1's sampler cover())
fn coverAt(x: f32, z: f32) -> array<f32, 11> {
  var out = array<f32, 11>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var k = 0u; k < ${COVER_SLOTS.length}u; k++) {
    let L = TU.cv[k];
    if (L.a.w < 0.5) { continue; }
    let fx = (x - L.a.x) * L.a.z; let fz = (z - L.a.y) * L.a.z;
    if (fx < 0.0 || fz < 0.0 || fx > L.b.x - 1.0 || fz > L.b.y - 1.0) { continue; }
    let i = min(floor(fx), L.b.x - 2.0); let j = min(floor(fz), L.b.y - 2.0); let u = fx - i; let v = fz - j;
    let p = vec2i(i32(i), i32(j));
    out[min(cTexel(k, p), 10u)] += (1.0 - u) * (1.0 - v);
    out[min(cTexel(k, p + vec2i(1, 0)), 10u)] += u * (1.0 - v);
    out[min(cTexel(k, p + vec2i(0, 1)), 10u)] += (1.0 - u) * v;
    out[min(cTexel(k, p + vec2i(1, 1)), 10u)] += u * v;
    return out;
  }
  return out;
}
fn groundAlbedo(p: vec2f, h: f32, n: vec3f) -> vec4f {
  if (h < 0.0) {   // the lake bed: decomposed-granite sand, silt below 25 m
    return vec4f(mix(${v3(ALBEDO.bed)}, ${v3(ALBEDO.silt)}, smoothstep(4.0, 25.0, -h)) * (0.85 + 0.3 * vnoise(p * 0.15)), 0.0);
  }
  let steep = length(n.xz) / max(n.y, 1e-4);
  let elev = h + TU.season2.w;
  // the NLCD grids are 4–32 m squares: their edges are warped by a few texels of value noise, so a class boundary reads
  // as a stand's edge, not a staircase
  let cw = 1.6 * terrainCoverStep(p.x, p.y);
  let wq = vec2f(vnoise(p / (2.5 * cw)), vnoise(p / (2.5 * cw) + vec2f(17.3, 5.1))) - 0.5;
  let c = coverAt(p.x + wq.x * 2.0 * cw, p.y + wq.y * 2.0 * cw);
  var water = c[1]; var forest = c[5]; var rock = c[4]; var shrub = c[6] + c[8] * 0.5; var grass = c[7] + c[8] * 0.5;
  // NLCD's developed classes are 30 m cells: a 10 m road through the pines reads 30–60 m wide, so half of "urban" and
  // most of "open developed" stay canopy (towns keep their grey; the Hwy 89 cut stays a thin line, not a band)
  var urban = (c[2] + c[3] * 0.4) * 0.5; var open = c[3] * 0.6 * 0.3; let pond = c[10];
  forest += (c[2] + c[3] * 0.4) * 0.5 + c[3] * 0.6 * 0.7;
  var known = 0.0; for (var i = 0u; i < 11u; i++) { known += c[i]; }
  let treeline = TU.season2.z;
  if (known < 0.5) {   // past the cover grids (the far ring): forest below the treeline, rock above
    let t = smoothstep(treeline - 250.0, treeline, elev);
    forest = 0.7 * (1.0 - t); shrub = 0.3 * (1.0 - t); rock = t; grass = 0.0; urban = 0.0; open = 0.0; water = 0.0;
  }
  let cliff = smoothstep(0.85, 1.2, steep);
  forest *= 1.0 - cliff; shrub *= 1.0 - cliff; grass *= 1.0 - cliff; rock = min(1.0, rock + cliff * (1.0 - rock));
  // the season's snow (v1's snowAt): north faces hold it aspectM lower, none on slopes past maxSlope
  let north = -n.z / max(length(n.xz), 1e-6);
  let line = TU.season.x - TU.season.z * north * min(1.0, steep * 3.0);
  let snow = smoothstep(line, line + TU.season.y, elev) * (1.0 - smoothstep(TU.season.w * 0.8, TU.season.w * 1.2, steep));
  // beaches: low, gentle ground at the water (v1's rule without the shore-distance grid)
  let beach = (1.0 - smoothstep(0.06, 0.16, steep)) * (1.0 - smoothstep(0.8, 1.8, h)) * (1.0 - min(urban, 1.0));
  let keep = 1.0 - max(snow, beach);
  let grassC = mix(${v3(ALBEDO.grassFresh)}, ${v3(ALBEDO.grassDry)}, TU.season2.x);
  let wsum = forest + rock + shrub + grass + urban + open + pond + water;
  var base = (forest * ${v3(ALBEDO.forest)} + rock * ${v3(ALBEDO.rock)} + shrub * ${v3(ALBEDO.shrub)} + grass * grassC
    + urban * ${v3(ALBEDO.urban)} + open * ${v3(ALBEDO.open)} + (pond + water) * ${v3(ALBEDO.pond)}) / max(wsum, 1e-3);
  if (wsum < 1e-3) { base = ${v3(ALBEDO.rock)}; }
  // a little large-scale variety (the photo's job later): ±15 % over 40 m and 320 m
  base *= 0.85 + 0.2 * vnoise(p / 40.0) + 0.1 * vnoise(p / 320.0);
  let sandC = mix(${v3(ALBEDO.wet)}, ${v3(ALBEDO.sand)}, smoothstep(0.15, 0.7, h));
  // the forest's share of this albedo (M5b, the alpha of the albedo map): where the trees are drawn as cards the
  // terrain shows the forest floor under them instead of the canopy's far colour (forestNear in the draw)
  let fshare = select(forest / max(wsum, 1e-3), 0.0, wsum < 1e-3) * keep;
  return vec4f(base * keep + ${v3(ALBEDO.snow)} * snow + sandC * beach * (1.0 - snow), fshare);
}`;

// M5c: the ground photo (v1's NAIP, de-lit and graded: src/naip.js) as streamed tiles in one array texture (a layer a
// level: the bay, the region; v2/terrain/photo.js), read at the pixel's footprint's mip; its alpha is v1's class index
// (forest, brush, bare) on the bay level and the landed flag on both (an unlanded tile reads 0)
const PHOTO_READ = `
fn srgbToLin(c: vec3f) -> vec3f { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }   // the cubic fit of the sRGB curve (≤ 0.3 % off; three pows a pixel were 0.1 ms at 2560 × 1600)
struct Photo { rgb: vec3f, w: f32, forest: f32, bare: f32 }
fn photoLevel(l: u32, xz: vec2f, fp: f32) -> Photo {
  var o: Photo; o.rgb = vec3f(0.0); o.w = 0.0; o.forest = 0.0; o.bare = 1.0;
  let L = M.photo[l];
  if (L.a.w < 0.5) { return o; }
  let px = (xz - L.a.xy) * L.a.z;
  if (px.x < 0.0 || px.y < 0.0 || px.x > L.b.x || px.y > L.b.y) { return o; }
  let sz = vec2f(textureDimensions(tPhoto));
  let lod = max(log2(max(fp * L.a.z, 1.0)), 0.0);
  let t = textureSampleLevel(tPhoto, sPhoto, px / sz, i32(L.b.w), lod);
  o.rgb = srgbToLin(t.rgb);
  o.w = smoothstep(0.08, 0.2, t.a);   // landed (the bay's class alpha ≥ 64 / 255)
  // the bay's class index (src/naip-layout.js naipClass): 64 + 191 · (forest + brush / 2)
  let s = clamp((t.a * 255.0 - 64.0) / 191.0, 0.0, 1.0);
  o.forest = smoothstep(0.62, 0.88, s); o.bare = 1.0 - smoothstep(0.12, 0.38, s);
  // the level's soft edge (200 m), so the finer level fades into the coarser
  let e = min(min(px.x, px.y), min(L.b.x - px.x, L.b.y - px.y)) / L.a.z;
  o.w *= smoothstep(0.0, 200.0, e);
  return o;
}
fn photoAt(xz: vec2f, fp: f32) -> Photo {
  let b = photoLevel(0u, xz, fp);
  if (b.w >= 0.999) { return b; }   // the bay's level alone where it is whole (one sample a pixel over the bay)
  let r = photoLevel(1u, xz, fp);
  var o: Photo;
  o.w = max(b.w, r.w);
  let kb = select(0.0, b.w / max(o.w, 1e-4), o.w > 0.0);
  o.rgb = mix(r.rgb, b.rgb, kb); o.forest = mix(r.forest, b.forest, kb); o.bare = mix(r.bare, b.bare, kb);
  return o;
}`;
// M5c: v1's detail set close up (src/ground.js: six CC0 ambientCG layers, albedo 0–5 and the normal + height pack
// 6–11 of one array texture; the layer rules of v1's terrain-mesh.js terrainMaterial, cut down to what the pixel knows
// here: the slope, the height, the photo's class, the forest share, the season's snow), two layers a pixel blended by
// height (Mishkinis), each anti-tiled with two taps (Quilez); the texture's grain rides on the photo's colour as a ratio to
// the layer's mean (its last mip), so the photo keeps its tone and the ground gains its grit within 350–700 m
const DETAIL_READ = `
const TILE_M = array<f32, 6>(4.0, 3.0, 3.0, 2.5, 3.0, 4.0);   // granite, talus (DG), duff, sand, grass, snow (src/ground-layout.js)
fn antiTile(uv: vec2f, layer: i32, k: f32, lod: f32) -> vec4f {
  let l = k * 8.0; let ia = floor(l); let f = fract(l);
  let offa = sin(vec2f(3.0, 7.0) * ia); let offb = sin(vec2f(3.0, 7.0) * (ia + 1.0));
  let ca = textureSampleLevel(tDetail, sDetail, uv + offa, layer, lod); let cb = textureSampleLevel(tDetail, sDetail, uv + offb, layer, lod);
  let d = ca - cb; let s = d.x + d.y + d.z;
  return mix(ca, cb, smoothstep(0.2, 0.8, f - s * 0.1));
}
struct Detail { grain: vec3f, n: vec2f, w: f32 }
// weights → the two heaviest layers, blended by height; grain = the albedo over the layer's mean (linear), n the pack's
// tangent normal xy, w how much detail the pixel takes (0 past 700 m)
fn detailAt(p: vec3f, n: vec3f, fp: f32, dist: f32, wts: array<f32, 6>) -> Detail {
  var o: Detail; o.grain = vec3f(1.0); o.n = vec2f(0.0); o.w = 0.0;
  if (M.detail.x < 0.5 || dist > 700.0) { return o; }
  let xz = p.xz; let x_ = p.x; let y_ = p.y; let z_ = p.z;
  let steep = length(n.xz) / max(n.y, 1e-4);
  var i0 = 0; var w0 = wts[0];
  for (var k = 1; k < 6; k++) { if (wts[k] > w0) { w0 = wts[k]; i0 = k; } }
  var i1 = select(0, 1, i0 == 0); var w1 = -1.0;
  for (var k = 0; k < 6; k++) { if (k != i0 && wts[k] > w1) { w1 = wts[k]; i1 = k; } }
  let b = w1 / max(w0 + w1, 1e-4);
  let kcell = vnoise(xz * 0.31 / 3.0 + vec2f(11.3, 5.7));
  let uv0 = xz / TILE_M[i0]; let uv1 = xz / TILE_M[i1];
  let lod0 = max(log2(max(fp / TILE_M[i0] * 512.0, 1.0)), 0.0); let lod1 = max(log2(max(fp / TILE_M[i1] * 512.0, 1.0)), 0.0);
  var a0 = antiTile(uv0, i0, kcell, lod0); var a1 = antiTile(uv1, i1, kcell, lod1);
  var p0 = antiTile(uv0, i0 + 6, kcell, lod0); var p1 = antiTile(uv1, i1 + 6, kcell, lod1);
  // cliffs: the side projections (v1's triplanar, GPU Gems 3 ch. 1 § 1.5) weighted by the normal's x and z over the
  // top-down tap, so a steep face shows granite grain at its own scale, not the stretched top-down texels
  let tri = smoothstep(0.42, 0.62, steep);
  if (tri > 0.01) {
    let ax = abs(n.x); let az = abs(n.z); let sx = ax / max(ax + az, 1e-3);
    let uvX0 = vec2f(z_, y_) / TILE_M[i0]; let uvZ0 = vec2f(x_, y_) / TILE_M[i0]; let uvX1 = vec2f(z_, y_) / TILE_M[i1]; let uvZ1 = vec2f(x_, y_) / TILE_M[i1];
    let s0 = mix(textureSampleLevel(tDetail, sDetail, uvZ0, i0, lod0), textureSampleLevel(tDetail, sDetail, uvX0, i0, lod0), sx);
    let s1 = mix(textureSampleLevel(tDetail, sDetail, uvZ1, i1, lod1), textureSampleLevel(tDetail, sDetail, uvX1, i1, lod1), sx);
    a0 = mix(a0, s0, tri); a1 = mix(a1, s1, tri);
    let q0 = mix(textureSampleLevel(tDetail, sDetail, uvZ0, i0 + 6, lod0), textureSampleLevel(tDetail, sDetail, uvX0, i0 + 6, lod0), sx);
    let q1 = mix(textureSampleLevel(tDetail, sDetail, uvZ1, i1 + 6, lod1), textureSampleLevel(tDetail, sDetail, uvX1, i1 + 6, lod1), sx);
    p0 = mix(p0, q0, tri); p1 = mix(p1, q1, tri);
  }
  // height blend: the higher of the two layers' heights wins at the seam
  let h0 = p0.b; let h1 = p1.b;
  let A0 = h0 + (1.0 - b); let A1 = h1 + b; let ma = max(A0, A1) - 0.25;
  let b0 = max(A0 - ma, 0.0); let b1 = max(A1 - ma, 0.0); let bb = b1 / max(b0 + b1, 1e-4);
  // v1's rule: the layers' grain rides on the photo as a LUMINANCE ratio (terrain-mesh.js detail: nearC's luma over
  // the mean's, clamped 0.4–1.8), never per channel (a per-channel ratio tinted the island mauve with the granite's veins)
  let m0 = textureSampleLevel(tDetail, sDetail, vec2f(0.5), i0, 9.0).rgb; let m1 = textureSampleLevel(tDetail, sDetail, vec2f(0.5), i1, 9.0).rgb;
  let LW = vec3f(0.3, 0.55, 0.15);
  let near = mix(srgbToLin(a0.rgb), srgbToLin(a1.rgb), bb); let mean = mix(srgbToLin(m0), srgbToLin(m1), bb);
  o.grain = vec3f(clamp(dot(near, LW) / max(dot(mean, LW), 0.02), 0.4, 1.8));
  o.n = (mix(p0.rg, p1.rg, bb) * 2.0 - 1.0) * (1.0 - tri);
  o.w = 1.0 - smoothstep(350.0, 700.0, dist);
  return o;
}`;

// ultra M2: the bay slot's codes as copyTextureToBuffer lays them out (bedPackLayout): row j starts at j × the row's words
// (its bytes padded to 256), texel i is the low (i even) or high (i odd) half of word i / 2. bedHeightAt is the old
// texture read's arithmetic, term for term (hBil's clamps, its bilinear, the level's scale and offset), on these codes
export const BED_HEIGHT_WGSL = `
fn bedCode(i: u32, j: u32, w: u32) -> u32 {
  let row = (w * 2u + 255u) / 256u * 64u;
  return (bedH[j * row + (i >> 1u)] >> ((i & 1u) * 16u)) & 0xffffu;
}
fn hBilBed(fx0: f32, fz0: f32, w: f32, h: f32) -> f32 {
  let fx = clamp(fx0, 0.0, w - 1.0); let fz = clamp(fz0, 0.0, h - 1.0);
  let i = min(floor(fx), w - 2.0); let j = min(floor(fz), h - 2.0);
  let u = fx - i; let v = fz - j; let p = vec2u(u32(i), u32(j)); let wi = u32(w);
  let a = f32(bedCode(p.x, p.y, wi)); let b = f32(bedCode(p.x + 1u, p.y, wi)); let c = f32(bedCode(p.x, p.y + 1u, wi)); let d = f32(bedCode(p.x + 1u, p.y + 1u, wi));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// the bed's height for the column's optics (render/bed.js): the bay level only (2 m, or the phone set's 4 m; it holds every
// shore a player sees the bed at), the fallback (the drawn bed point's own height) outside it or before it lands
fn bedHeightAt(xz: vec2f, fallback: f32) -> f32 {
  let L = TU.lv[${BED_SLOT}u];
  if (L.a.w < 0.5) { return fallback; }
  let fx = (xz.x - L.a.x) * L.a.z; let fz = (xz.y - L.a.y) * L.a.z;
  if (min(min(fx, fz), min(L.b.x - 1.0 - fx, L.b.y - 1.0 - fz)) <= 1.0) { return fallback; }
  return TU.hs.x + TU.hs.y * hBilBed(fx, fz, L.b.x, L.b.y);
}`;
// the buffer's layout for a w × h grid of 16-bit codes (bytesPerRow padded to WebGPU's 256): the JS twin of bedCode
export function bedPackLayout(w, h) {
  const bytesPerRow = Math.ceil((w * 2) / 256) * 256;
  return { bytesPerRow, rowWords: bytesPerRow / 4, bytes: bytesPerRow * h };
}
export function bedCodeAt(words, i, j, w) {
  const { rowWords } = bedPackLayout(w, 1);
  return (words[j * rowWords + (i >>> 1)] >>> ((i & 1) * 16)) & 0xffff;
}

// Fannette Island's granite (owner, 2026-11-18: "use this chance to fix the terrain, the granite texture: our island is not close
// to the photo";'s look). The photo (NAIP, 2 m) shows the island as a green-grey smear and the detail
// layers as generic rock; the real island is pale, warm-grey granite in big rounded boulders and sheets, split by dark cracks,
// patched with darker lichen and streaked down its faces, with green shrubs and pines between the rocks. Inside the island's
// disc (ISLE: centre, the full radius, the edge; the bay's shores are 300 m off): the photo's green stays (the shrubs, and noise
// patches of brush on the gentler rock), the rest becomes the granite. 'full' (a desktop): the boulders (a jittered cell grid at
// 2.6 m, sheared with height so the faces break too, and joints at 0.9 m), their cracks and edges, the lichen, the streaks, each
// boulder's dome in the normal; 'lite' (a phone, a tablet): the granite's colours alone, on the photo's own light and dark
// (no cell grid, no normal). The same pipeline either way. An ascending smoothstep everywhere (Safari).
export const ISLE = Object.freeze({ x: -20, z: 24, r0: 100, r1: 125 });
export const GRANITE = Object.freeze({ rock: [0.31, 0.293, 0.262], lichen: [0.095, 0.098, 0.085], shrub: [0.045, 0.07, 0.028] });
const ISLE_GRANITE_WGSL = (tier) => {
  const v = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
  const head = `const ISLE = vec4f(${ISLE.x.toFixed(1)}, ${ISLE.z.toFixed(1)}, ${ISLE.r0.toFixed(1)}, ${ISLE.r1.toFixed(1)});
const G_ROCK = ${v(GRANITE.rock)}; const G_LICHEN = ${v(GRANITE.lichen)}; const G_SHRUB = ${v(GRANITE.shrub)};`;
  if (tier === 'off') return `fn isleGranite(p: vec3f, steep: f32, dist: f32, fp: f32, snow: f32, A: ptr<function, vec3f>, n: ptr<function, vec3f>) {}`;
  const shared = `${head}
// the share of the island here (its disc, above the waterline, no snow) and the photo's green (a shrub, a pine's floor)
fn isleShare(p: vec3f, snow: f32) -> f32 { return (1.0 - smoothstep(ISLE.z, ISLE.w, distance(p.xz, ISLE.xy))) * smoothstep(0.15, 1.1, p.y) * (1.0 - snow); }
fn isleGreen(a: vec3f) -> f32 { return smoothstep(1.06, 1.3, a.g / max(0.5 * (a.r + a.b), 1e-4)); }`;
  if (tier === 'lite') return `${shared}
fn isleGranite(p: vec3f, steep: f32, dist: f32, fp: f32, snow: f32, A: ptr<function, vec3f>, n: ptr<function, vec3f>) {
  let k = isleShare(p, snow);
  if (k < 0.001) { return; }
  let a = *A; let lum = dot(a, vec3f(0.3, 0.55, 0.15));
  let rock = G_ROCK * clamp(lum / 0.16, 0.55, 1.25);   // the photo's own light and dark, in the granite's colour
  let g = isleGreen(a);
  *A = mix(a, mix(rock, G_SHRUB * clamp(lum / 0.12, 0.6, 1.4), g), k);
}`;
  return `${shared}
// a jittered cell grid (Hoskins' hash): F1, the gap to the second nearest (F2 − F1: the crack), the cell's tone and the offset to
// its centre (the dome's slope)
struct IsleCell { f1: f32, gap: f32, id: f32, toC: vec2f }
fn isleCell(q: vec2f) -> IsleCell {
  let i = floor(q); let f = q - i;
  var d1 = 9.0; var d2 = 9.0; var id = 0.0; var toC = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y)); let c = i + g;
      let o = vec2f(hash(c), hash(c + vec2f(17.3, 9.1)));
      let r = g + 0.12 + 0.76 * o - f; let d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = o.x; toC = r; } else if (d < d2) { d2 = d; }
    }
  }
  var out: IsleCell; out.f1 = sqrt(d1); out.gap = sqrt(d2) - sqrt(d1); out.id = id; out.toC = toC; return out;
}
fn isleGranite(p: vec3f, steep: f32, dist: f32, fp: f32, snow: f32, A: ptr<function, vec3f>, n: ptr<function, vec3f>) {
  let k = isleShare(p, snow);
  if (k < 0.001) { return; }
  let a = *A;
  // the boulders and sheets (2.6 m, sheared up the faces) and their joints (0.9 m); fade to the mean tone once a cell is under a few pixels
  // the cells' lines warped (granite cracks wander; a straight-edged cell grid reads as crazy paving)
  let q0 = p.xz / 2.6 + vec2f(p.y * 0.38, -p.y * 0.21);
  let q = q0 + (vec2f(vnoise(q0 * 0.7), vnoise(q0 * 0.7 + vec2f(7.3, 2.1))) - 0.5) * 0.9;
  let c = isleCell(q);
  let fine = 1.0 - smoothstep(0.06, 0.3, fp);          // the joints while a pixel is under 0.3 m
  let near = 1.0 - smoothstep(0.25, 1.1, fp);          // the boulders while a pixel is under 1.1 m
  let gentle = 1.0 - smoothstep(0.12, 0.5, steep);   // the flat slabs and terraces: fewer, fainter joints
  // only some of the cells' edges open as cracks (a noise along them): sheets and slabs, not a closed web
  let opn = smoothstep(0.42, 0.62, vnoise(q * 0.55 + vec2f(11.0, 4.0)));
  var crack = (1.0 - smoothstep(0.015, 0.075, c.gap)) * near * mix(1.0, 0.45, gentle) * opn;
  if (fine > 0.0) { let j = isleCell(p.xz / 0.9 + vec2f(p.y * 0.5 + 13.1, 7.7)); crack = max(crack, (1.0 - smoothstep(0.01, 0.05, j.gap)) * 0.3 * fine * smoothstep(0.5, 0.7, vnoise(p.xz / 1.7 + vec2f(2.0, 9.0)))); }
  let edge = mix(1.0, 0.88 + 0.12 * smoothstep(0.0, 0.3, c.gap), near * mix(0.4, 1.0, opn));   // a boulder's rim turned from the sky, where it is split
  // feat/v2-look-ponlai: every per-cell value eases to the mean over the cell's last 0.12 of its gap (cells' edges): a cell's own tone,
  // lean and green switched at its straight Voronoi edge, and on a steep face (the cells sheared up it) the island read as pale and
  // green triangles from the water; the lichen and the green clumps are continuous noise now
  let cE = smoothstep(0.0, 0.12, c.gap);
  var G = G_ROCK * mix(1.0, 0.93 + 0.14 * c.id, near * cE);
  let lich = smoothstep(0.5, 0.8, vnoise(p.xz / 1.9 + vec2f(5.3, p.y * 0.3)));
  G = mix(G, G_LICHEN, lich * 0.55);
  // the weathering's broad patches (6 m and 22 m: the faces' grey bands, darker where water runs), so the far rock is not flat
  G = G * (0.72 + 0.4 * vnoise(p.xz / 6.0 + vec2f(p.y * 0.15, 4.1))) * (0.8 + 0.3 * vnoise(p.xz / 22.0 + vec2f(9.3, p.y * 0.05)));
  let streak = smoothstep(0.35, 1.2, steep) * smoothstep(0.55, 0.9, vnoise(vec2f((p.x + p.z) * 0.8, p.y * 0.09)));
  // the big blocks (7 m: the photos' faces from the water), each its own facet and tone, split by wide dark joints seen from 300 m
  let bq0 = p.xz / 7.0 + vec2f(p.y * 0.55 + 31.0, -p.y * 0.33);
  let bq = bq0 + (vec2f(vnoise(bq0 * 0.8 + vec2f(3.1, 0.0)), vnoise(bq0 * 0.8 + vec2f(0.0, 5.7))) - 0.5) * 0.8;
  let bc = isleCell(bq);
  let bigCrack = (1.0 - smoothstep(0.03, 0.13, bc.gap)) * mix(1.0, 0.25, gentle) * smoothstep(0.3, 0.55, vnoise(bq * 0.6 + vec2f(1.0, 13.0)));
  let bE = smoothstep(0.0, 0.12, bc.gap);   // the block's own tone and lean ease to the mean at its edge (above)
  G = G * mix(1.0, 0.8 + 0.3 * bc.id, (1.0 - 0.6 * gentle) * bE) * (1.0 - 0.55 * bigCrack);
  G = G * (1.0 - 0.32 * streak) * edge * (1.0 - 0.6 * crack);
  G = G * clamp(0.75 + 0.5 * dot(a, vec3f(0.3, 0.55, 0.15)) / 0.16, 0.7, 1.2);   // a little of the photo's light and dark (shade of the crowns)
  // the shoreline's boulders, bleached by the lake's rise and fall: a pale band in the first 2 m over the water
  G = mix(G, G_ROCK * (1.12 + 0.2 * c.id) * (1.0 - 0.4 * crack), 1.0 - smoothstep(1.0, 2.4, p.y));
  // the green: the photo's own, plus brush in the gentler rock's hollows (patches 6–8 m, never on a cliff)
  let brush = smoothstep(0.5, 0.7, vnoise(p.xz / 6.0 + vec2f(3.7, 1.9))) * (1.0 - smoothstep(0.45, 1.1, steep)) * smoothstep(0.2, 0.6, c.gap + 0.3);
  // the photo's green as clumps (its 2 m pixels smear the shrubs into lawns): granite between them, as the island from above
  let clump = smoothstep(0.38, 0.62, vnoise(p.xz / 3.2 + vec2f(1.7, 0.0)) * 0.7 + vnoise(p.xz / 9.0 + vec2f(5.5, 2.2)) * 0.45);
  let g = max(isleGreen(a) * clump, brush * 0.85);
  let shrubC = G_SHRUB * (0.55 + 0.8 * vnoise(p.xz / 1.3)) * (0.8 + 0.4 * vnoise(p.xz / 4.0 + vec2f(1.3, 8.2)));   // clumps, darker hearts
  *A = mix(a, mix(G, shrubC, g), k);
  // each boulder's dome: the face tilts out from its centre (the gap's slope), strongest near, none on the green
  let tilt = -normalize(vec2f(c.toC.x + 1e-5, c.toC.y)) * (0.25 * opn * smoothstep(0.1, 0.6, c.f1)) * near * k * (1.0 - g) * (1.0 - smoothstep(60.0, 260.0, dist));
  // each big block a facet (its own lean, from its cell), out to 700 m: the faces catch the sun and the shade unevenly
  let fa = bc.id * 18.85;   // the block's own hash: one lean per block
  let facet = vec2f(cos(fa), sin(fa)) * mix(0.42, 0.15, gentle) * bE * k * (1.0 - g) * (1.0 - smoothstep(300.0, 700.0, dist));
  *n = normalize(*n + vec3f(tilt.x + facet.x, 0.0, tilt.y + facet.y));
}`;
};
export const TERRAIN_DRAW_WGSL = (fs, { granite = 'full', bedBoulders = 'full', rock = 'off' } = {}) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${TERRAIN_BIND(2)}
${DRAW_BIND(2)}
${SHADOW_STRUCT}
@group(2) @binding(${B.shadowU}) var<uniform> SH: Shadow;
${TOWNS_BIND(2, B.towns)}
${TERRAIN_HEIGHT}
${MATERIAL_READ}
${NOISE_WGSL}
${TOWNS_READ}
${TOWNS_PAINT_WGSL}
${PHOTO_READ}
${DETAIL_READ}
${CANOPY_READ}
const ROOT = ${TREE.origin.toFixed(1)}; const M1 = ${PATCH + 1}u; const RANGE0 = ${TREE.range0.toFixed(1)}; const MORPH = ${TREE.morph};
${WATER_WGSL}
${BED_HEIGHT_WGSL}
${bedWgsl({ big: bedBoulders === 'full' })}
${SHADOW_READ('tTShadow', 'sTShadow')}
${ISLE_GRANITE_WGSL(granite)}
${ROCK_DETAIL_WGSL(rock)}
struct TV { @builtin(position) pos: vec4f, @location(0) world: vec3f }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TV {
  let I = inst[ii];
  let g = vec2f(f32(vi % M1), f32(vi / M1));
  let cell = I.w;
  var xz = I.xy + g * cell;
  // CDLOD morph: past MORPH of this level's range the odd vertices slide onto the even ones (the next level's grid);
  // the distance is horizontal, as the selection's (quadtree.js: the seam invariant)
  let d = distance(F.cam.xz, xz);
  let range = RANGE0 * exp2(I.z);
  let k = clamp((d - MORPH * range) / ((1.0 - MORPH) * range), 0.0, 1.0);
  let gi = g + (I.xy - vec2f(ROOT)) / cell;   // the vertex's index on the level's world grid (exact integers)
  xz -= fract(gi * 0.5) * 2.0 * cell * k;
  var p = vec3f(xz.x, terrainHeight(xz.x, xz.y), xz.y);
  // T3: past the cards the ground rises by the canopy (its top × its cover, the cards' fading share): a far skyline keeps
  // its forest's height, and the last cards sink into the blanket as it rises (not at the water: it grows in over the first 2–30 m above the lake, so a shore never stands as a wall); the
  // cover as a skyline's slant sees it (the from-above share c as 1 − (1 − c)^4)
  if (TU.canopy2.y > 0.5 && p.y > 0.0) {
    let dv = distance(F.cam.xyz, p);
    if (dv > TU.forest.x) {
      let c = canopyAt(p.xz);
      p.y += c.y * (1.0 - pow(1.0 - c.x, 4.0)) * canopyIn(p.xz) * (1.0 - forestNear(dv)) * ${CANOPY.lift.toFixed(3)} * smoothstep(2.0, 30.0, p.y);
    }
  }
  var o: TV; o.pos = F.viewProj * vec4f(p, 1.0); o.world = p; return o;
}
// M5b: the share of the ground the forest's cards still cover at distance d (v2/forest/lod.js coverNear)
const FLOOR = ${v3(ALBEDO.floor)};
const LAND_SKY = vec3f(${LAND_SKY.terrain.toFixed(3)}, ${LAND_SKY.forest.toFixed(3)}, ${LAND_SKY.desat.toFixed(3)});   // fix(v2) terrain shadow: the sky's share (render/sky.js)
const RELIEF_K = ${RELIEF.k}; const ROCK_LOOK = ${v3(ROCK_LOOK)};   // M5d: v1's granite relief gain; the rock's local look match
fn forestNear(d: f32) -> f32 {
  let L = TU.forest;
  if (d >= L.z) { return 0.0; }
  let k = select(1.0, (L.x / d) * (L.x / d), d > L.x);
  let c = min(1.0, k * min(TU.canopy2.z, 1.0 / sqrt(k)));   // T3: the cards' own wmax (was 2 fixed)
  return select(c, c * (1.0 - (d - L.y) / (L.z - L.y)), d > L.y);
}
// the sun's irradiance on a surface square to it at altitude (m above the lake) h, HDR scale; zero below the horizon
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;   // × the storm cell's shade (1 fair): the land under the deck, as the water and the boat (v1's sunShade)
}
@fragment fn fs(v: TV) -> @location(0) vec4f {
  let p = v.world; let h = p.y;
  // the ground's baked normal (the granite's lidar detail near), cavity and albedo (cover, slope, snow, beach, the bed:
  // BAKE_WGSL), from the finest level whose texel is at least a third of the pixel's footprint
  // the pixel's footprint (m). feat/v2-look-ponlai: near the eye it is taken across the view ray (dpdx's share square to the ray:
  // the same on every triangle) and stretched by the smooth baked normal's tilt, not by each triangle's own plane: a steep shore's
  // triangles each read their own footprint, and every threshold on it (the granite's joints and boulders, the photo's and the
  // detail's mips) switched per triangle, so a close face showed pale and dark triangles. Past 150–400 m the old footprint (no seam
  // reads there: the thresholds sit near)
  let dist = distance(p, F.cam.xyz);
  let Vf = (F.cam.xyz - p) / max(dist, 1e-3);
  let px = dpdx(p); let py = dpdy(p);
  let fpTri = max(length(px), length(py));
  let fpIso = max(length(px - Vf * dot(px, Vf)), length(py - Vf * dot(py, Vf)));
  let farFp = smoothstep(150.0, 400.0, dist);
  let m = terrainMaterial(p.x, p.z, mix(fpIso, fpTri, farFp) / 3.0);
  var n = normalize(m.n.xyz);
  var A = m.a.rgb * m.a.rgb;   // stored as its square root (rgba8: the dark canopy keeps fine steps)
  let fp = mix(fpIso / max(abs(dot(n, Vf)), 0.3), fpTri, farFp);
  let s = normalize(F.sun.xyz);
  let eSky = LIGHT.sky.rgb + nightLand();   // M5e: v1's night lift on the land
  // M5c: the terrain's sun shadow (render/shadow.js): the north walls and the island's lee at a low sun
  let nl = max(dot(n, s), 0.0);
  var col: vec3f;
  var farRock = 0.0;
  if (h < 0.0) {
    // the bed through the water column (render/bed.js): v1's clarity bed, its caustics, the refraction wobble and the
    // shelf's look; the sun's share takes the terrain's shadow (the island's lee on the shelf; one tap: the water blurs it)
    let V = normalize(F.cam.xyz - p);
    let E = 0.98 * (LIGHT.sun.rgb * shadowAt1(p) + eSky) * mix(1.0, ${NIGHT.bedLight.toFixed(2)}, min(F.night.x, 1.0));   // look/v2-night-look: the night lift once (it had nightLand() × 3.5 more), and the column dims it by night   // M5e: the night light reaches the bed through the column (v1's near water reads a lit blue by night)
    col = bedRadiance(p, A, n, E, s, V, fp, F.cam.w);
  } else {
    // M5c: the photo above the water's edge (its colour; the class steers the detail), then the detail's grain and normal
    let ph = photoAt(p.xz, fp);
    let steep = length(n.xz) / max(n.y, 1e-4);
    let elev = h + TU.season2.w;
    // fix(v2) mountains: v1's ground snow (src/terrain-mesh.js snowW, the far look's spring line LAND_LOOK.snowLine): north
    // faces hold it aspectM lower, patchy by a 500 m and a 30 m noise, none past 1 − n.y ≈ 0.32–0.5 (the cliffs stay
    // granite); the day's own line (TU.season.x) still rules the trees and the towns
    let slope1 = 1.0 - n.y;
    let northness = -n.z * smoothstep(0.02, 0.3, slope1);
    let nBig = vnoise(p.xz * 0.0021) * 2.0 - 1.0; let nSmall = vnoise(p.xz * 0.031) * 2.0 - 1.0; let nFine = vnoise(p.xz * 0.23) * 2.0 - 1.0;
    let line = ${LAND_LOOK.snowLine.toFixed(1)} - northness * TU.season.z + nBig * ${LAND_LOOK.snowNoise[0].toFixed(1)} + nSmall * ${LAND_LOOK.snowNoise[1].toFixed(1)};
    let snow = smoothstep(line, line + TU.season.y, elev) * (1.0 - smoothstep(${LAND_LOOK.snowSlope[0].toFixed(2)}, ${LAND_LOOK.snowSlope[1].toFixed(2)}, slope1 + nFine * 0.05));
    let top = ph.w * smoothstep(-0.5, 0.15, h) * (1.0 - snow) * M.detail.y;
    // the forest share here: the bake's (the cover) or the photo's class where it has landed
    var fshare = mix(m.a.a, ph.forest, top) * (1.0 - snow);
    A = mix(A, ph.rgb, top);
    A = mix(A, ${v3(ALBEDO.snow)}, snow);
    townsPaint(p, n, fp, &A, &fshare);   // 10a: v1's ski runs and Hwy 89's asphalt and cut over the photo (render/towns.js)
    // M5b: where the forest's cards stand (render/forest.js), the ground between them is the forest floor; the canopy's
    // far colour returns as the cards thin with distance (v2/forest/lod.js coverNear: the same curve)
    if (TU.forest.w > 0.5) { A = max(A + fshare * forestNear(dist) * (FLOOR - ${v3(ALBEDO.forest)}), vec3f(0.0)); }
    // the detail layers' weights (v1's rules, from what the pixel knows): cliffs and the photo's bare rock → granite;
    // gentle bare ground → decomposed granite; the forest's floor → duff; low gentle ground at the water → sand; brush
    // on gentle ground → grass; the season's snow
    let cliff = smoothstep(0.2, 0.36, steep);
    let beach = (1.0 - smoothstep(0.06, 0.16, steep)) * (1.0 - smoothstep(0.8, 1.8, h));
    let bare = mix(1.0 - fshare, ph.bare, top);
    let slabs = smoothstep(-0.1, 0.6, vnoise(p.xz / 90.0) * 2.0 - 1.0 + (vnoise(p.xz / 4.0) * 2.0 - 1.0) * 0.35);
    let brush = max(1.0 - fshare - bare, 0.0);
    let openFlat = (1.0 - smoothstep(0.05, 0.16, steep));
    var wts = array<f32, 6>(max(cliff, bare * slabs * 0.9), bare * (1.0 - slabs) + brush * 0.6 + 0.05, fshare * (1.0 - cliff), beach, brush * openFlat * 0.8, snow * 2.0);
    let det = detailAt(p, n, fp, dist, wts);
    A *= pow(det.grain, vec3f(det.w));
    n = normalize(n + vec3f(det.n.x, 0.0, -det.n.y) * (0.9 * det.w * (1.0 - smoothstep(150.0, 350.0, dist))));
    // M5d: v1's granite relief (terrain-mesh.js normalNode): within 500 m a 3-D noise's gradient bends the normal on
    // rock (flatter along y: the joints of sheeted granite), so the island's knob and the walls read as broken, jointed
    // stone, not a smooth skin (the 1 m lidar holds the shape, not the ledges); a branch: forest and far ground skip it
    let rockW = max(cliff, bare);
    let relief = rockW * (1.0 - smoothstep(150.0, 500.0, dist));
    if (relief > 0.02) {
      let q = p * vec3f(0.55, 0.9, 0.55); let e = 0.06; let f0 = reliefF(q);
      let g = vec3f(reliefF(q + vec3f(e, 0.0, 0.0)) - f0, reliefF(q + vec3f(0.0, e, 0.0)) - f0, reliefF(q + vec3f(0.0, 0.0, e)) - f0) / e;
      n = normalize(n - (g - n * dot(g, n)) * (relief * RELIEF_K));
    }
    // M5d: the rock's look under v2's light (a local material match, as the sail cloth's CLOTH_AMB): v1's AgX tone map
    // shows the island's granite as a pale, cool lichen grey where v2's ACES fit left the same photo texels darker,
    // redder and more saturated; the photo's bare rock is lifted toward v1's samples (ROCK_LOOK), nothing else
    A *= mix(vec3f(1.0), ROCK_LOOK, rockW * top);
    // Fannette Island's granite (ISLE_GRANITE_WGSL: the boulders, cracks, lichen and shrubs; the colours alone on a phone)
    isleGranite(p, steep, dist, fp, snow, &A, &n);
    // feat/v2-look-ponlai: the close rock (render/rockDetail.js): steep faces and bare rock inside 40 m, half on the green (the brush
    // on a face is rooted in the rock), none on the beach or the snow; an empty function where rockDetail is off
    let rockK = max(smoothstep(0.45, 0.9, steep), rockW) * (1.0 - beach) * (1.0 - snow) * mix(1.0, 0.5, smoothstep(1.06, 1.3, A.g / max(0.5 * (A.r + A.b), 1e-4)));
    rockDetail(p, dist, fp, rockK, &A, &n);
    // fix(v2) mountains: v1's far ground (src/core/farLook.js albedoK, src/terrain-mesh.js depthTint): darker past 6–18 km
    // (never the snow), a little richer and darker within 0.6–2.2 km, toward the deep slate past 2.5–14 km
    A *= mix(1.0, ${LAND_LOOK.albedoK.toFixed(3)}, smoothstep(${LAND_LOOK.albedoNear.toFixed(1)}, ${LAND_LOOK.albedoFar.toFixed(1)}, dist) * (1.0 - snow));
    A = depthTint(A, p, ${v3(LAND_LOOK.slate)});
    farRock = smoothstep(${LAND_LOOK.farRock.far[0].toFixed(1)}, ${LAND_LOOK.farRock.far[1].toFixed(1)}, dist) * (1.0 - snow);   // the far crest's rock (its filter after the air)
    let nl2 = max(dot(n, s), 0.0);
    var shadow = 0.0;
    if (nl2 > 0.001) { if (dist < 1500.0) { shadow = shadowAt(p, nl); } else { shadow = shadowAt1(p); } }   // a face turned from the sun needs no read; far ground one tap (2.4 m texels are under a pixel there)
    // fix(v2) terrain shadow: the sky's light as v1's (the atmosphere light's sky irradiance by the face's tilt plus the
    // sky's environment diffuse, render/sky.js skyIrrN), so a face in shadow or turned from the sun keeps the sky
    // fix(v2) mountains: the sky's share by the ground's open sky (v1's skyline visibility, src/horizon-fine.js sky()^3, as
    // its ambient occlusion): here the bake's cavity, a gully darker and a ridge lighter, so a face out of the sun keeps
    // its relief
    let skyAO = clamp(1.0 + ${LAND_LOOK.cavitySky.toFixed(2)} * m.n.w, 0.35, 1.5);
    let E = sunAt(h, s) * nl2 * shadow + landSky(n, LAND_SKY.x, LAND_SKY.z) * skyAO + nightLand() * (0.5 + 0.5 * n.y);
    col = A * (1.0 + 0.18 * m.n.w) * E / PI + landSpec(n, normalize(F.cam.xyz - p), s, sunAt(h, s) * nl2 * shadow, ${LAND_LOOK.rough.toFixed(2)});   // fix(v2) mountains: v1's ground specular
    // T3: the far forest's canopy (render/canopy.js: every tree the cards draw, splatted into a grid) takes
    // the ground the cards leave as they thin (1 − coverNear: the cards' own curve, so the forest's cover holds through the
    // hand-off): the needles' colour on the canopy's own normal (the ground's slope plus the crowns' surface: the sun rakes
    // the clumps), the trees' far tint (sky.js depthTintTree, as the cards'), the air on top. Past the grid (the rules'
    // region, 5–6 km out) a blanket from the cover's forest share; none on the painted snow
    if (TU.canopy2.y > 0.5) {
      let fN = select(0.0, forestNear(dist), TU.forest.w > 0.5);
      if (fN < 0.999) {
        let cg = canopyAt(p.xz); let inG = canopyIn(p.xz);
        // the cover seen from here: a slant view shows the crowns' sides, so a far slope reads denser than from above
        let sinA = max(abs(dot(normalize(F.cam.xyz - p), normalize(m.n.xyz))), 0.05);
        let slant = min(${CANOPY.look.view.k.toFixed(3)} * (1.0 + ${CANOPY.look.view.side.toFixed(3)} * sqrt(max(1.0 - sinA * sinA, 0.0)) / sinA), ${CANOPY.look.view.max.toFixed(3)});
        let cov = 1.0 - pow(max(1.0 - mix(fshare * ${CANOPY.fallback}, cg.x, inG), 1e-4), slant);
        let wc = cov * (1.0 - fN) * (1.0 - snow);
        if (wc > 0.002) {
          let n0 = normalize(m.n.xyz);
          let gG = -n0.xz / max(n0.y, 0.05);   // the ground's slope (east, south; m / m)
          let nc = normalize(vec3f(-(gG.x + cg.z * inG), 1.0, -(gG.y + cg.w * inG)));
          let top = mix(${CANOPY.fallbackTop.toFixed(1)}, cg.y, inG);
          // the crowns' grain while a pixel is under a texel or two (clumps at 14 m and 45 m; gone past it: no shimmer), the
          // stand's tone over 230 m, the gaps between crowns in their shade (thin cover darker)
          let gw = 1.0 - smoothstep(6.0, 20.0, fp);
          var grain = 0.0; if (gw > 0.0) { grain = (vnoise(p.xz / 14.0) - 0.5) * 0.5 + (vnoise(p.xz / 45.0 + vec2f(7.1, 3.3)) - 0.5) * 0.4; }
          var Ac = ${v3(CANOPY.look.albedo)} * (0.82 + 0.36 * vnoise(p.xz / 230.0)) * (1.0 + grain * gw) * mix(0.7, 1.0, sqrt(saturate(cg.x * 3.0)));
          Ac = mix(Ac, Ac * vec3f(0.86, 0.96, 1.12), smoothstep(14.0, 32.0, top));   // tall stands (the firs) a bluer green
          let sC = sunAt(h, s) * saturate((dot(nc, s) + ${CANOPY.look.wrap.toFixed(3)}) / ${(1 + CANOPY.look.wrap).toFixed(2)}) * shadow * ${CANOPY.look.sunK.toFixed(3)};   // (the ground's own shadow read: a face turned from the sun keeps the sky only)
          let Ec = sC + landSky(nc, LAND_SKY.y, LAND_SKY.z) * ${CANOPY.look.skyK.toFixed(3)} + nightLand() * (0.37 + 0.18 * nc.y);
          col = mix(col, depthTintTree(Ac * Ec * mix(1.0, ${NIGHT.treeNight.toFixed(2)}, clamp(F.night.x, 0.0, 1.0)) / PI, p), wc);   // feat/v2-night-clouds: the far canopy as the crowns (NIGHT.treeNight)
        }
      }
    }
  }
  var out = select(aerialLand(col, v.pos.xy, p), aerial(col, v.pos.xy, p), h < 0.0);   // fix(v2) mountains: the land's air as v1's (the bed under the water keeps the full air)
  out *= mix(vec3f(1.0), ${v3(LAND_LOOK.farRock.tint)}, farRock * smoothstep(${Math.sin(LAND_LOOK.farRock.dayDeg[0] * Math.PI / 180).toFixed(4)}, ${Math.sin(LAND_LOOK.farRock.dayDeg[1] * Math.PI / 180).toFixed(4)}, s.y));   // the far crest's rock filter
  // M5a: a cloud nearer than this ground along the view ray lies over it (the key's mean distance; one fetch each)
  let toP = p - F.cam.xyz;
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, 1.0);
}`;

// Play as Tessie, phase 2a (§ 3.12): the bed seen from under the water (fsUnder), appended to the terrain's own text in a
// module of its own (the terrain's module stays byte for byte). The bed's own detail as from above (bed.js: the sand and its ripples, the
// four packed boulder layers, the cobbles, the caustics), read at the point itself (no refraction: the eye is in the water), lit by the
// light left at its depth (K down the refracted sun and the sky's light), with no column tint and no crossing; then the straight path to
// the eye (umFog: T(t) into the water's own light). Over the water the land is behind the surface (its window shows the sky and the ridge).
export const TERRAIN_UNDER_WGSL = () => `
${UNDER_WGSL}
fn bedUnder(p: vec3f, A0: vec3f, nBed: vec3f, s: vec3f, fp: f32) -> vec3f {
  let dep = max(-p.y, 0.05);
  let pd = p.xz;
  let sunU = umSunU(); let sunDownY = umSunDY();
  let blur = fp;
  let grad = -nBed.xz / max(nBed.y, 0.2);
  let rocky = max(mix(BG_FLATS, 1.0, smoothstep(BG_ROCKY0, BG_ROCKY1, length(grad))), bedMoraine(pd) * ${0.75.toFixed(2)});
  let aMean = bedMeanAlbedo(dep, rocky);
  let shade = clamp(A0 / mix(${v3([0.46, 0.43, 0.36])}, ${v3([0.20, 0.19, 0.16])}, smoothstep(4.0, 25.0, dep)), vec3f(0.7), vec3f(1.3));
  let wNear = (1.0 - smoothstep(NEAR_BLUR * 0.3, NEAR_BLUR, blur)) * M.bed.w;
  var wDet = wNear;
  if (BED_BIG && M.bed.x > 0.5) { wDet = max(wNear, (1.0 - smoothstep(BG_BLUR * 0.35, BG_BLUR, blur)) * (1.0 - smoothstep(BG_D1 - 1.0, BG_D1 + 2.0, dep)) * M.bed.w); }
  var albedo = aMean * shade; var dirF = max(dot(nBed, sunU), 0.0) / sunDownY; var amb = 1.0;
  if (wDet > 0.0) {
    let patchy = smoothstep(0.25, 0.75, (sin(pd.x * 0.021 + 1.3) * sin(pd.y * 0.017 - 0.4) + sin((pd.x + pd.y) * 0.013 + 2.1)) * 0.25 + 0.5);
    var bo: BL;
    if (BED_BIG && M.bed.x > 0.5) {
      let dk = rocky * (patchy * BG_PATCHY + 1.0 - BG_PATCHY) * bigDepthK(dep);
      let b1 = bedLayer(pd, BG_CELL1, BG_R01, BG_R11, BG_FLAT1, true, BG_SALT1, BG_DENS1 * dk, sunU, blur, BG_LUMP);
      var b2 = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
      if (blur < BG_BLUR2) { b2 = bedLayer(pd, BG_CELL2, BG_R02, BG_R12, BG_FLAT2, true, BG_SALT2, BG_DENS2 * dk * (1.0 - smoothstep(BG_BLUR2 * 0.6, BG_BLUR2, blur)), sunU, blur, BG_LUMP); }
      var b3 = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
      if (blur < BG_BLUR3) {
        let f3 = BG_DENS3 * dk * (1.0 - smoothstep(BG_BLUR3 * 0.6, BG_BLUR3, blur));
        b3 = bedLayer(pd, BG_CELL3, BG_R03, BG_R13, BG_FLAT3, true, BG_SALT3, f3, sunU, blur, BG_LUMP);
        let b4 = bedLayer(pd, BG_CELL4, BG_R04, BG_R14, BG_FLAT4, true, BG_SALT4, f3 * BG_DENS4, sunU, blur, BG_LUMP);
        let m3 = max(b3.m, b4.m); let s3 = max(b3.shadeC * (1.0 - b4.m), b4.shadeC * (1.0 - b3.m)); let c3 = max(b3.contact * (1.0 - b4.m), b4.contact * (1.0 - b3.m));
        if (b4.h > b3.h) { b3 = b4; }
        b3.m = m3; b3.shadeC = s3; b3.contact = c3;
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
    var sandA = BSAND; var nSand = nBed;
    var co = BL(0.0, 0.0, vec3f(0.0, 1.0, 0.0), 0.0, 0.0, 0.0);
    if (wNear > 0.0) {
      let dC = 0.5 * (patchy * 0.6 + 0.4) * (1.0 - smoothstep(CO_D0, CO_D1, dep)) * (1.0 - bo.m) * (1.0 - smoothstep(0.04, 0.12, blur));
      if (blur < 0.12 && M.bed2.x > 0.5) { co = bedLayer(pd, CO_CELL, CO_R0, CO_R1, CO_FLAT, false, 11.9, dC, sunU, 0.0, 1.0); }
      let dn = vnoise(pd * 0.3 + vec2f(7.7, 3.1)) * 2.0 - 1.0;
      let drift = dn * 0.12 + 1.0;
      let wq = pd * RP_WS;
      let warp = vec2f(vnoise(wq + vec2f(1.7, 9.2)), vnoise(wq + vec2f(5.3, 2.8))) * 2.0 - 1.0;
      let lead = smoothstep(-0.25, 0.25, vnoise(wq * 0.5 + vec2f(3.3, 7.1)) * 2.0 - 1.0);
      let pw = pd + warp * RP_WARP;
      let d1 = vec2f(0.8, 0.6); let d2 = vec2f(0.8 * cos(RP_TURN) - 0.6 * sin(RP_TURN), 0.8 * sin(RP_TURN) + 0.6 * cos(RP_TURN));
      let ph1 = dot(pw, d1) * (2.0 * PI / RP_L0); let ph2 = dot(pw, d2) * (2.0 * PI / RP_L1) + warp.y * 2.5;
      let aa1 = 1.0 - smoothstep(0.2 * RP_L0, 0.45 * RP_L0, blur); let aa2 = 1.0 - smoothstep(0.2 * RP_L1, 0.45 * RP_L1, blur);
      let ampR = smoothstep(-0.05, 0.3, dn) * (1.0 - smoothstep(RP_D0, RP_D1, dep));
      let hR = mix(sin(ph1) * aa1, sin(ph2) * aa2, lead) * ampR;
      let gR = mix(d1 * (cos(ph1) * aa1), d2 * (cos(ph2) * aa2), lead) * (ampR * RP_TILT);
      nSand = normalize(nBed + vec3f(gR.x * wNear, 0.0, gR.y * wNear));
      sandA = BSAND * mix(1.0, drift * (hR * RP_ALB + 1.0), wNear);
    }
    var a = sandA; if (bo.m > 0.0) { a = mix(sandA, rockAlbedo(pd, bo, blur, dep), bo.m); }
    var nB = mix(nSand, bo.n, bo.m);
    var shadeC = bo.shadeC; var contact = bo.contact; var rm = bo.m;
    if (co.m > 0.0) { a = mix(a, rockAlbedo(pd, co, blur, dep), co.m); } nB = mix(nB, co.n, co.m);
    shadeC = max(shadeC, co.shadeC); contact = max(contact, co.contact); rm = max(rm, co.m);
    albedo = mix(aMean * shade, a * shade, wDet);
    let nn = normalize(nB);
    dirF = mix(dirF, max(dot(nn, sunU), 0.0) / sunDownY * (1.0 - shadeC * 0.85), wDet);
    amb = mix(1.0, (1.0 - contact * 0.45) * mix(1.0, nn.y * 0.65 + 0.35, rm), wDet);
  }
  // the caustics (render/caustics.js: the waves' own focus), at the point's depth
  var caust = 1.0;
  let ck = causticStrength(dep, s.y) * M.bed2.w;
  if (ck > 0.0) { caust = mix(1.0, waveCaustic(pd, dep, sunU, log2(max(blur, 1e-3))), ck); }
  let eSun = 0.98 * LIGHT.sun.rgb * shadowAt1(p) * exp(-WK * dep / sunDownY);
  let eSky = 0.98 * umSkyE() * exp(-WK * dep * 1.2);
  return albedo / PI * (eSky * amb + eSun * dirF * caust) * umKeep();
}
@fragment fn fsUnder(v: TV) -> @location(0) vec4f {
  let p = v.world;
  if (p.y >= 0.0) { return vec4f(umBack(normalize(p - F.cam.xyz)), 1.0); }   // over the water: behind the surface (its window shows what is there); 2c: the water's own light, never a black seam on the horizon (no discard: the early depth test kept)
  let dist = distance(p, F.cam.xyz);
  let Vf = (F.cam.xyz - p) / max(dist, 1e-3);
  let px = dpdx(p); let py = dpdy(p);
  let fpIso = max(length(px - Vf * dot(px, Vf)), length(py - Vf * dot(py, Vf)));
  let m = terrainMaterial(p.x, p.z, fpIso / 3.0);
  let n = normalize(m.n.xyz);
  let A = m.a.rgb * m.a.rgb;
  let fp = fpIso / max(abs(dot(n, Vf)), 0.3);
  return vec4f(umFog(bedUnder(p, A, n, normalize(F.sun.xyz), fp), p), 1.0);
}`;

// the probe: heights at fixed points, on the GPU, into a buffer read once (the browser's proof that the WGSL is v1's sampler)
export const TERRAIN_PROBE_WGSL = `${TERRAIN_BIND(0)}
${TERRAIN_HEIGHT}
@group(1) @binding(0) var<storage, read> pts: array<vec2f>;
@group(1) @binding(1) var<storage, read_write> outH: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= arrayLength(&pts)) { return; }
  outH[g.x] = terrainHeight(pts[g.x].x, pts[g.x].y);
}`;
// ultra M2: the bay's codes in the storage buffer, read as the bed's fragment reads them (bedCode), against the slot's
// texture (textureLoad), at every texel of a strided grid and at the probe points' bilinear heights: the page test wants 0
export const BED_PACK_PROBE_WGSL = `${TERRAIN_BIND(0)}
${TERRAIN_HEIGHT}
@group(1) @binding(0) var<storage, read> pts: array<vec2f>;
@group(1) @binding(1) var<storage, read_write> outC: array<atomic<u32>, 4>;   // texels differing, texels read, heights differing, heights read
@group(1) @binding(2) var<storage, read> bedH: array<u32>;
${BED_HEIGHT_WGSL}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let L = TU.lv[${BED_SLOT}u];
  if (L.a.w < 0.5) { return; }
  let w = u32(L.b.x); let h = u32(L.b.y);
  // every texel: invocation g.x reads rows g.x, g.x + n, … (each row whole)
  let n = 64u * 64u;
  if (g.x < n) {
    var bad = 0u; var seen = 0u;
    for (var j = g.x; j < h; j += n) { for (var i = 0u; i < w; i++) {
      let a = textureLoad(tH${BED_SLOT}, vec2i(i32(i), i32(j)), 0).r; let b = bedCode(i, j, w);
      seen++; if (a != b) { bad++; }
    } }
    atomicAdd(&outC[0], bad); atomicAdd(&outC[1], seen);
  }
  if (g.x < arrayLength(&pts)) {
    let p = pts[g.x];
    let fx = (p.x - L.a.x) * L.a.z; let fz = (p.y - L.a.y) * L.a.z;
    if (min(min(fx, fz), min(L.b.x - 1.0 - fx, L.b.y - 1.0 - fz)) > 1.0) {
      let a = TU.hs.x + TU.hs.y * hBil${BED_SLOT}(fx, fz, L.b.x, L.b.y);
      let b = bedHeightAt(p, -999.0);
      atomicAdd(&outC[3], 1u); if (bitcast<u32>(a) != bitcast<u32>(b)) { atomicAdd(&outC[2], 1u); }
    }
  }
}`;

// the bake: one dispatch per landed grid (at its swap, never a frame) and again for every held grid when a cover grid
// lands: from the grid's own codes, the central-difference normal (xyz) and a cavity term (w: the 4 neighbours' mean
// over the texel, ± one step of rise → −1..1: gullies darker, ridges lighter) into rgba8snorm; the ground's albedo at the
// texel (GROUND_WGSL: cover, slope, snow, beach, the bed) as its square root into rgba8unorm. Both filtered when read.
export const BAKE_WGSL = `${TERRAIN_STRUCT}
@group(1) @binding(0) var<uniform> TU: TerrainU;
${COVER_BIND(1)}
${GROUND_WGSL}
struct NP { step: f32, hstep: f32, w: f32, h: f32, x0: f32, z0: f32, hoff: f32, pad: f32 }
@group(0) @binding(0) var<uniform> P: NP;
@group(0) @binding(1) var src: texture_2d<u32>;
@group(0) @binding(2) var dstM: texture_storage_2d<rgba8unorm, write>;   // M5c: [2w × h]: the normal + cavity left, the albedo right
fn at(i: i32, j: i32) -> f32 { return f32(textureLoad(src, vec2i(clamp(i, 0, i32(P.w) - 1), clamp(j, 0, i32(P.h) - 1)), 0).r) * P.hstep; }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (f32(g.x) >= P.w || f32(g.y) >= P.h) { return; }
  let i = i32(g.x); let j = i32(g.y);
  let l = at(i - 1, j); let r = at(i + 1, j); let u = at(i, j - 1); let d = at(i, j + 1); let c = at(i, j);
  let n = normalize(vec3f(-(r - l) / (2.0 * P.step), 1.0, -(d - u) / (2.0 * P.step)));
  let cav = clamp(((l + r + u + d) * 0.25 - c) / max(P.step, 1.0) * 1.5, -1.0, 1.0);
  textureStore(dstM, vec2i(i, j), vec4f(n, -cav) * 0.5 + 0.5);
  let A = groundAlbedo(vec2f(P.x0 + f32(i) * P.step, P.z0 + f32(j) * P.step), c + P.hoff, n);
  textureStore(dstM, vec2i(i + i32(P.w), j), vec4f(sqrt(clamp(A.rgb, vec3f(0.0), vec3f(1.0))), clamp(A.a, 0.0, 1.0)));
}`;


// The water's mirror of the land (M2): a flat mirror shows the scene as seen from the camera's mirror point under the
// surface (x, −eye, z), so for every azimuth one march out from that point gives, for each elevation, the first ground a
// reflected ray meets: exact for the skyline at any distance (the waves only blur it, through the lifted ray). 256
// azimuths × 16 elevation bins (0–35°, packed toward the horizon), rgb the ground's light there (its elevation's albedo:
// forest under the treeline, granite above and on cliffs, the season's snow; the sun and the sky; a haze toward the
// horizon's sky), a its cover (0: sky). Re-made every frame in the aerial pass (≈ 0.03 ms); the water reads it at its
// reflected ray and mixes it over the sky.
export const REFLECT = Object.freeze({ az: 256, bins: 16, maxDeg: 35, steps: 192, t0: 12, grow: 1.047 });
export const REFLECT_READ = `
fn reflectedLand(R: vec3f) -> vec4f {
  let e = asin(clamp(R.y, 0.0, 1.0));
  let b = sqrt(e / ${(REFLECT.maxDeg * Math.PI / 180).toFixed(6)}) * ${REFLECT.bins - 1}.0;
  let v = clamp((b + 0.5) / ${REFLECT.bins}.0, ${(0.5 / REFLECT.bins).toFixed(6)}, ${(1 - 0.5 / REFLECT.bins).toFixed(6)});
  return textureSampleLevel(tRefl, sRep, vec2f(atan2(R.z, R.x) / (2.0 * PI) + 0.5, v), 0.0);
}`;
export const REFLECT_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${TERRAIN_BIND(1)}
${TERRAIN_HEIGHT}
@group(2) @binding(0) var tT: texture_2d<f32>;
@group(2) @binding(1) var tV: texture_2d<f32>;
@group(2) @binding(2) var sLin: sampler;
@group(2) @binding(3) var sView: sampler;
@group(2) @binding(4) var outR: texture_storage_2d<rgba16float, write>;
${TRANS_READ}
${NIGHT_SKY_WGSL}
${STORM_FOG_WGSL}
// look/v2-night-look: the mirrored land takes the world's night sky light (NIGHT.airLight of the airglow) and fades into
// the sky as drawn (nightSkyShown): with the whole airglow the far shore mirrored as a pale cyan sheet by night
fn skyRadiance(d: vec3f) -> vec3f {
  let eh = horizonElev(Rg + F.sky.z);
  return textureSampleLevel(tV, sView, skyViewUV(d, eh), 0.0).rgb * F.sky.x + nightSkyK(d, ${NIGHT.airLight.toFixed(3)});
}
fn skyRadianceShown(d: vec3f) -> vec3f {
  let eh = horizonElev(Rg + F.sky.z);
  return textureSampleLevel(tV, sView, skyViewUV(d, eh), 0.0).rgb * F.sky.x + nightSkyShown(d);
}
const NB = ${REFLECT.bins}u; const EMAX = ${(REFLECT.maxDeg * Math.PI / 180).toFixed(6)}; const NS = ${REFLECT.steps}u;
var<workgroup> first: array<atomic<u32>, ${REFLECT.bins}>;
// one workgroup an azimuth, one thread a step out (latency, not arithmetic, bounds a serial march: 0.5 ms → 0.03 ms).
// A ray at elevation e from the mirror point runs under the water until it crosses the surface at t = eye / tan e; the
// first step past that whose ground stands above the ray is its hit (an atomicMin per bin)
@compute @workgroup_size(${REFLECT.steps}) fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) i: u32) {
  if (i < NB) { atomicStore(&first[i], 0xffffu); }
  workgroupBarrier();
  let az = (f32(wg.x) + 0.5) / ${REFLECT.az}.0 * 2.0 * PI - PI;
  let dir = vec2f(cos(az), sin(az));
  let eye = max(F.cam.y, 0.5);   // the mirror point stands eye metres under the surface
  let t = ${REFLECT.t0.toFixed(1)} * pow(${REFLECT.grow}, f32(i));
  let xz = F.cam.xz + dir * t;
  let h = terrainHeight(xz.x, xz.y);
  let a = atan2(h + eye, t);
  for (var b = 1u; b < NB; b++) {
    let eb = EMAX * pow(f32(b) / f32(NB - 1u), 2.0);
    if (a >= eb && t * tan(eb) >= eye) { atomicMin(&first[b], i); }
  }
  workgroupBarrier();
  let s = normalize(F.sun.xyz);
  for (var b = 0u; b < NB; b++) {
    let f = atomicLoad(&first[b]);
    if (f == 0xffffu && i == 0u) { textureStore(outR, vec2i(i32(wg.x), i32(b)), vec4f(0.0)); }
    if (f != i) { continue; }
    // the ground here: its slope at a spacing that grows with the distance, its albedo by elevation and slope
    let rS = Rg + F.sky.z - F.cam.y * 0.001;
    let sunE = F.sky.x * transAt(rS, s.y) * step(0.0, raySphere(vec3f(0.0, rS, 0.0), s, Rg) * -1.0);
    let eSky = PI * 0.25 * (skyRadiance(vec3f(0.7071, 0.7071, 0.0)) + skyRadiance(vec3f(-0.7071, 0.7071, 0.0)) + skyRadiance(vec3f(0.0, 0.7071, 0.7071)) + skyRadiance(vec3f(0.0, 0.7071, -0.7071)));
    let haze = skyRadianceShown(normalize(vec3f(dir.x, 0.02, dir.y)));
    let e = max(t * 0.01, 8.0);
    let dx = (terrainHeight(xz.x + e, xz.y) - terrainHeight(xz.x - e, xz.y)) / (2.0 * e);
    let dz = (terrainHeight(xz.x, xz.y + e) - terrainHeight(xz.x, xz.y - e)) / (2.0 * e);
    let n = normalize(vec3f(-dx, 1.0, -dz));
    let steep = length(n.xz) / max(n.y, 1e-4);
    let elev = h + TU.season2.w;
    let rockW = max(smoothstep(TU.season2.z - 250.0, TU.season2.z, elev), smoothstep(0.85, 1.2, steep));
    let north = -n.z / max(length(n.xz), 1e-6);
    let line = TU.season.x - TU.season.z * north * min(1.0, steep * 3.0);
    let snow = smoothstep(line, line + TU.season.y, elev) * (1.0 - smoothstep(TU.season.w * 0.8, TU.season.w * 1.2, steep));
    var A = mix(${v3(ALBEDO.forest)} * 1.3, ${v3(ALBEDO.rock)}, rockW);
    A = mix(A, ${v3(ALBEDO.snow)}, snow);
    var col = A * (sunE * max(dot(n, s), 0.0) + eSky * (0.5 + 0.5 * n.y)) / PI;
    // the air over the mirrored path: the same medium as the terrain's aerial perspective (v2's extinction at the
    // lake's altitude, the horizon sky in that azimuth as the in-scattered light), then v1's mirror haze (src/water-
    // reflect.js hazeM 9 km): the reflected land fades toward the sky it stands under, so a far shore mirrors soft and
    // pale and the ridge line in the water is never darker than the land above it reads
    let Tair = exp(-medium(rS).ext * t * 0.001);
    col = mix(col * Tair + haze * (1.0 - Tair), haze, 1.0 - exp(-t / ${MIRROR_HAZE_M.toFixed(1)}));
    // fix(v2) frame look: the storm's mist on the mirrored land as on the land itself (the hit seen from the camera: sky.js
    // stormFog). Without it the fogged-out far ridges stood in the water as a black band across the bay's mouth
    col = mix(col, stormFogColour(), stormFog(vec3f(xz.x, h, xz.y)));
    textureStore(outR, vec2i(i32(wg.x), i32(b)), vec4f(col, 1.0));
  }
}`;

// the probe's points: the island, the bay (the head, the mouth, the walls), the basin (Tallac), the lake, the ring, and
// points inside each level's blend band (seeded, fixed)
export function probePoints(n = 256) {
  const pts = new Float32Array(n * 2);
  const fixed = [[0, 0], [-100, 40], [800, -560], [1050, -820], [-600, 250], [1690, -1270], [-1800, -900], [2500, 4200], [4200, -5200], [6000, -30000], [-30000, 5000], [40000, -40000], [-190, 0], [-2290, 0], [3300, 0], [0, 1780], [-10220, 0], [10200, 0]];
  let k = 0;
  for (const [x, z] of fixed) { pts[k++] = x; pts[k++] = z; }
  let s = 0x9e3779b9;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  while (k < n * 2) { const r = 40 * Math.exp(rnd() * Math.log(45000 / 40)), a = rnd() * 2 * Math.PI; pts[k++] = Math.round(r * Math.cos(a) * 8) / 8; pts[k++] = Math.round(r * Math.sin(a) * 8) / 8; }
  return pts;
}

// --- the GPU side ---
export function createTerrain({ device, reg, frameBGL, frameBG, U, frameStruct = wgslStruct(), sky, hdrTarget, msaa = 1, depthFormat = 'depth32float', H, season, treeline, surfaceY0, errors = [], granite = 'full', bedBoulders = 'full', rock = 'off', under = false }) {
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, ALL = VF | GPUShaderStage.COMPUTE;
  const nS = SLOTS.length, nC = COVER_SLOTS.length;
  const FR = GPUShaderStage.FRAGMENT, VX = GPUShaderStage.VERTEX;
  // the heights group (the water's group 3 and the probe's group 0): the level records and five height slots
  const hEntries = [{ binding: 0, visibility: ALL, buffer: { type: 'uniform' } }];
  for (let k = 0; k < nS; k++) hEntries.push({ binding: 1 + k, visibility: ALL, texture: { sampleType: 'uint' } });
  const hbgl = device.createBindGroupLayout({ label: 'terrain-heights', entries: hEntries });
  // the terrain's own group 2: the records, the heights (vertex), the baked normal and albedo maps (fragment), the
  // instances. Per stage the sampled textures stay under WebGPU's 16 (fragment: 4 sky + 5 normal + 5 albedo; vertex:
  // 4 sky + 5 heights)
  const entries = [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }];
  // the bay's heights (slot BED_SLOT) also reach the fragment stage: the bed's refracted depth (bed.js bedHeightAt); one
  // more sampled texture there (the other four slots would pass WebGPU's 16 a stage)
  // ultra M2: the bay's heights reach the fragment stage as a storage buffer (B.bedH), not this texture: vertex only
  for (let k = 0; k < nS; k++) entries.push({ binding: 1 + k, visibility: VX, texture: { sampleType: 'uint' } });
  for (let k = 0; k < nS; k++) entries.push({ binding: B.maps + k, visibility: FR, texture: { sampleType: 'float' } });
  entries.push({ binding: B.sampler, visibility: FR, sampler: {} });
  entries.push({ binding: B.inst, visibility: VX, buffer: { type: 'read-only-storage' } });
  // M5c: the photo tiles, the detail set, the water's slopes, the shadow map, their samplers, the M5c and Shadow records
  // (fragment: 6 sky + 5 maps + 4 = 15 sampled textures of the stage's 16)
  entries.push({ binding: B.photo, visibility: FR, texture: { sampleType: 'float', viewDimension: '2d-array' } });
  entries.push({ binding: B.detail, visibility: FR, texture: { sampleType: 'float', viewDimension: '2d-array' } });
  entries.push({ binding: B.slope, visibility: FR, texture: { sampleType: 'float', viewDimension: '2d-array' } });
  entries.push({ binding: B.shadow, visibility: FR, texture: { sampleType: 'depth' } });
  entries.push({ binding: B.sPhoto, visibility: FR, sampler: {} });
  entries.push({ binding: B.sDetail, visibility: FR, sampler: {} });
  entries.push({ binding: B.sSlope, visibility: FR, sampler: {} });
  entries.push({ binding: B.sShadow, visibility: FR, sampler: { type: 'comparison' } });
  entries.push({ binding: B.m5c, visibility: FR, buffer: { type: 'uniform' } });
  entries.push({ binding: B.shadowU, visibility: FR, buffer: { type: 'uniform' } });
  entries.push({ binding: B.towns, visibility: FR, buffer: { type: 'read-only-storage' } });   // 10a
  entries.push({ binding: B.bedH, visibility: FR, buffer: { type: 'read-only-storage' } });   // ultra M2: the bay's codes (bedHeightAt)
  entries.push({ binding: B.caustic, visibility: FR, texture: { sampleType: 'float', viewDimension: '2d-array' } });   // ultra M2: the splatted caustics (render/caustics.js: the 12 m and 2.1 m cascades' layers; read with sSlope)
  entries.push({ binding: B.canopy, visibility: VF, buffer: { type: 'read-only-storage' } });   // T3: the canopy grid (render/canopy.js; a storage buffer: the fragment's 16 sampled textures are taken)
  const bgl = device.createBindGroupLayout({ label: 'terrain', entries });
  const sN = device.createSampler({ label: 'terrain-maps', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const sPhoto = device.createSampler({ label: 'terrain-photo', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: 4 });
  const sDetail = device.createSampler({ label: 'terrain-detail', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: 4 });
  const sSlope = device.createSampler({ label: 'terrain-slope', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const sShadowDflt = device.createSampler({ label: 'terrain-shadow-none', compare: 'less' });
  // M5c: the externals until attach(): 1 × 1 stand-ins (the photo and the detail off, the shadow off, flat water)
  const dummyArr = (label) => device.createTexture({ label, size: [1, 1, 2], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING }).createView({ dimension: '2d-array' });
  const dummyDepth = device.createTexture({ label: 'terrain-shadow-none', size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
  const slopeNone = device.createTexture({ label: 'terrain-slope-none', size: [1, 1, 4], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView({ dimension: '2d-array' });
  const townsNone = device.createBuffer({ label: 'terrain-towns-none', size: 16, usage: GPUBufferUsage.STORAGE });   // 10a: no rasters until the towns' mask lands
  // ultra M2: the bay's codes for the fragment (a GPU copy of the slot's texture at its swap) and the caustics' stand-in
  // (1 × 1, every slice 1: flat water's light) until render/caustics.js attaches its texture
  const bedNone = device.createBuffer({ label: 'terrain-bed-heights-none', size: 16, usage: GPUBufferUsage.STORAGE });
  let bedBuf = null;
  const causticNone = device.createTexture({ label: 'terrain-caustic-none', size: [1, 1, 2], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: causticNone }, new Uint16Array(8).fill(0x3c00), { bytesPerRow: 8, rowsPerImage: 1 }, [1, 1, 2]);
  const canopyNone = device.createBuffer({ label: 'terrain-canopy-none', size: 16, usage: GPUBufferUsage.STORAGE });   // T3: until the forest attaches its grid
  const ext = { canopy: null, photo: dummyArr('terrain-photo-none'), detail: dummyArr('terrain-detail-none'), slope: slopeNone, shadow: dummyDepth, sShadow: sShadowDflt, shadowU: null, towns: null, caustic: causticNone.createView({ dimension: '2d-array' }) };
  // the M5c record: the photo's two level records, the bed's look, the detail and photo switches (M5C_STRUCT)
  const m5cData = new Float32Array(32);
  const m5cBuf = device.createBuffer({ label: 'terrain-m5c', size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const shadowNone = device.createBuffer({ label: 'terrain-shadow-none-u', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const look = { bed: 1, caustics: 1, detail: 0, photo: 0, fine: 1, big: 1 };   // big: the big-boulder bed where it is compiled in (0 the lite layer, the in-page A/B)   // the bed's tint is v1's WATER_LOOK, fixed in render/bed.js (no knob); fine: the phone pass's shallows detail (1 the cobbles and the second caustic net, 0 v1's phone path)
  function writeM5c() {
    m5cData[16] = look.big; m5cData[19] = look.bed; m5cData[23] = look.caustics; m5cData[20] = look.fine;
    m5cData[24] = look.detail; m5cData[25] = look.photo;
    device.queue.writeBuffer(m5cBuf, 0, m5cData);
  }
  // the bake: group 0 the grid (its record, its codes, the map it writes), group 1 the level records + the covers
  const C = GPUShaderStage.COMPUTE;
  const kbgl0 = device.createBindGroupLayout({ label: 'terrain-bake', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, texture: { sampleType: 'uint' } },
    { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm' } }] });
  const kbgl1 = device.createBindGroupLayout({ label: 'terrain-bake-cover', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, ...COVER_SLOTS.map((s, k) => ({ binding: 1 + k, visibility: C, texture: { sampleType: 'uint' } }))] });

  const UFLOATS = (nS + nC) * 8 + 24;
  const forestU = [2500, 6000, 8000, 0];   // M5b: the cards' range (setForest): thin, fade, far, on
  const canopyU = [0, 0, 1, 1, 1, 0, 2, 1];   // T3: the canopy grid (x0, z0, 1 / texel, nx | nz, on, the cards' wmax, texel)
  const uData = new Float32Array(UFLOATS);
  const ubuf = device.createBuffer({ label: 'terrain-levels', size: UFLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const instBuf = device.createBuffer({ label: 'terrain-instances', size: TREE.maxInstances * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const dummy = (format) => device.createTexture({ label: `terrain-empty-${format}`, size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING });
  const emptyH = dummy('r16uint'), emptyC = dummy('r8uint'), emptyM = dummy('rgba8unorm');
  const tex = new Array(nS).fill(null), ctex = new Array(nC).fill(null), mtex = new Array(nS).fill(null);
  const grids = new Array(nS).fill(null), cgrids = new Array(nC).fill(null);

  const field = createHeightField(H);
  // audit W1: the height grids as they land, for a worker's own copy of the field (sim/windTex.js: the wind texture's terrain)
  const slotData = new Array(nS).fill(null), slotFns = [];
  const bounds = createBounds();
  const selector = createSelector(bounds);
  const planes = new Float64Array(20);

  function writeLevels() {
    uData.fill(0);
    const put = (base, g) => { if (!g) return; uData[base] = g.x0; uData[base + 1] = g.z0; uData[base + 2] = 1 / g.step; uData[base + 3] = 1; uData[base + 4] = g.w; uData[base + 5] = g.h; uData[base + 6] = g.step; };
    for (let k = 0; k < nS; k++) put(k * 8, grids[k]);
    for (let k = 0; k < nC; k++) put((nS + k) * 8, cgrids[k]);
    let last = 0; for (let k = 0; k < nS; k++) if (grids[k]) last = k;
    const o = (nS + nC) * 8;
    uData[o] = H.offset; uData[o + 1] = H.step; uData[o + 2] = last;
    uData[o + 4] = season.snowLine; uData[o + 5] = season.fullM; uData[o + 6] = season.aspectM; uData[o + 7] = season.maxSlope;
    uData[o + 8] = season.grassDry; uData[o + 9] = season.bloom; uData[o + 10] = treeline; uData[o + 11] = surfaceY0;
    for (let i = 0; i < 4; i++) uData[o + 12 + i] = forestU[i];
    for (let i = 0; i < 8; i++) uData[o + 16 + i] = canopyU[i];
    device.queue.writeBuffer(ubuf, 0, uData);
  }
  let bg = null, hbg = null, cbg = null;
  function rebind() {
    const h = [{ binding: 0, resource: { buffer: ubuf } }];
    for (let k = 0; k < nS; k++) h.push({ binding: 1 + k, resource: (tex[k] ?? emptyH).createView() });
    hbg = device.createBindGroup({ label: 'terrain-heights', layout: hbgl, entries: h });
    const e = h.slice();
    for (let k = 0; k < nS; k++) e.push({ binding: B.maps + k, resource: (mtex[k] ?? emptyM).createView() });
    e.push({ binding: B.sampler, resource: sN });
    e.push({ binding: B.inst, resource: { buffer: instBuf } });
    e.push({ binding: B.photo, resource: ext.photo }); e.push({ binding: B.detail, resource: ext.detail }); e.push({ binding: B.slope, resource: ext.slope }); e.push({ binding: B.shadow, resource: ext.shadow });
    e.push({ binding: B.sPhoto, resource: sPhoto }); e.push({ binding: B.sDetail, resource: sDetail }); e.push({ binding: B.sSlope, resource: sSlope }); e.push({ binding: B.sShadow, resource: ext.sShadow });
    e.push({ binding: B.m5c, resource: { buffer: m5cBuf } }); e.push({ binding: B.shadowU, resource: { buffer: ext.shadowU ?? shadowNone } });
    e.push({ binding: B.towns, resource: { buffer: ext.towns ?? townsNone } });   // 10a
    e.push({ binding: B.bedH, resource: { buffer: bedBuf ?? bedNone } }); e.push({ binding: B.caustic, resource: ext.caustic });   // ultra M2
    e.push({ binding: B.canopy, resource: { buffer: ext.canopy?.buffer ?? canopyNone } });   // T3
    bg = device.createBindGroup({ label: 'terrain', layout: bgl, entries: e });
    const c = [{ binding: 0, resource: { buffer: ubuf } }];
    for (let k = 0; k < nC; k++) c.push({ binding: 1 + k, resource: (ctex[k] ?? emptyC).createView() });
    cbg = device.createBindGroup({ label: 'terrain-bake-cover', layout: kbgl1, entries: c });
  }
  // a height grid's map (normal + cavity | albedo + forest share, side by side), baked when it swaps in and again when a
  // cover grid lands (their own encoder and submit: a stream event, not a frame). Returns the map texture.
  const kpBuf = device.createBuffer({ label: 'terrain-bake-params', size: 256 * nS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  let bakes = 0;
  function bake(k, g, src) {
    const tm = device.createTexture({ label: `terrain-maps-${g.slot}-${g.variant}`, size: [2 * g.w, g.h], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    device.queue.writeBuffer(kpBuf, 256 * k, new Float32Array([g.step, H.step, g.w, g.h, g.x0, g.z0, H.offset, 0]));
    const b0 = device.createBindGroup({ layout: kbgl0, entries: [{ binding: 0, resource: { buffer: kpBuf, offset: 256 * k, size: 32 } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: tm.createView() }] });
    const enc = device.createCommandEncoder({ label: 'terrain-bake' });
    const pass = enc.beginComputePass({ label: 'terrain-bake' });
    pass.setPipeline(reg.get('terrain-bake')); pass.setBindGroup(0, b0); pass.setBindGroup(1, cbg); pass.dispatchWorkgroups(Math.ceil(g.w / 8), Math.ceil(g.h / 8)); pass.end();
    device.queue.submit([enc.finish()]);
    bakes++;
    return tm;
  }
  // ultra M2: the bay slot's codes into a storage buffer for the fragment stage (one GPU copy at the swap, its own submit:
  // a stream event, never a frame); the old buffer goes once the new one is bound
  function copyBed(g) {
    const lay = bedPackLayout(g.w, g.h);
    const nb = device.createBuffer({ label: `terrain-bed-heights-${g.variant}`, size: lay.bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder({ label: 'terrain-bed-heights' });
    enc.copyTextureToBuffer({ texture: tex[BED_SLOT] }, { buffer: nb, bytesPerRow: lay.bytesPerRow, rowsPerImage: g.h }, [g.w, g.h, 1]);
    device.queue.submit([enc.finish()]);
    bedBuf?.destroy(); bedBuf = nb;
  }
  function bakeInto(k) { const tm = bake(k, grids[k], tex[k]); mtex[k]?.destroy(); mtex[k] = tm; }

  // pipelines (built with every other at load)
  const mDraw = reg.shader('terrain', TERRAIN_DRAW_WGSL(frameStruct, { granite, bedBoulders, rock }));
  reg.add('terrain', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mDraw, entryPoint: 'vs' }, fragment: { module: mDraw, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  if (under) {   // phase 2a: the bed from under the water (a module of its own; the deferred 'under' group)
    const prevU = reg.group?.('under');
    const mU = reg.shader('terrain-under', TERRAIN_DRAW_WGSL(frameStruct, { granite, bedBoulders, rock }) + TERRAIN_UNDER_WGSL());
    reg.add('terrain-under', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mU, entryPoint: 'vs' }, fragment: { module: mU, entryPoint: 'fsUnder', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  }
  const probePts = probePoints();
  const pbgl = device.createBindGroupLayout({ label: 'terrain-probe', entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
  // ultra M2: the bay's codes in the buffer against the texture (runBedProbe; built with the rest at load)
  const bpbgl = device.createBindGroupLayout({ label: 'terrain-bed-probe', entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }] });
  // perf(v2) iOS pipelines: the two probes (checks, never drawn) are their own group, built after the first frame; a probe
  // waits for it (whenReady)
  const probeGroup = reg.group?.('probes');
  const mBedProbe = reg.shader('terrain-bed-probe', BED_PACK_PROBE_WGSL);
  reg.add('terrain-bed-probe', { layout: device.createPipelineLayout({ bindGroupLayouts: [hbgl, bpbgl] }), compute: { module: mBedProbe, entryPoint: 'main' } });
  const mProbe = reg.shader('terrain-probe', TERRAIN_PROBE_WGSL);
  reg.add('terrain-probe', { layout: device.createPipelineLayout({ bindGroupLayouts: [hbgl, pbgl] }), compute: { module: mProbe, entryPoint: 'main' } });
  if (probeGroup != null) reg.group(probeGroup);
  const probesIn = () => reg.whenReady?.('probes');
  // the mirror's horizon texture and its pipeline (dispatched in the aerial pass: runReflect)
  const reflTex = device.createTexture({ label: 'terrain-reflect', size: [REFLECT.az, REFLECT.bins], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const rbgl = device.createBindGroupLayout({ label: 'terrain-reflect', entries: [{ binding: 0, visibility: C, texture: {} }, { binding: 1, visibility: C, texture: {} }, { binding: 2, visibility: C, sampler: {} }, { binding: 3, visibility: C, sampler: {} },
    { binding: 4, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } }] });
  const sLin = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const sView = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  const rbg = device.createBindGroup({ layout: rbgl, entries: [{ binding: 0, resource: sky.textures.tT.createView() }, { binding: 1, resource: sky.textures.tV.createView() }, { binding: 2, resource: sLin }, { binding: 3, resource: sView }, { binding: 4, resource: reflTex.createView() }] });
  const mRefl = reg.shader('terrain-reflect', REFLECT_WGSL(frameStruct));
  reg.add('terrain-reflect', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, hbgl, rbgl] }), compute: { module: mRefl, entryPoint: 'main' } });
  const mBake = reg.shader('terrain-bake', BAKE_WGSL);
  reg.add('terrain-bake', { layout: device.createPipelineLayout({ bindGroupLayouts: [kbgl0, kbgl1] }), compute: { module: mBake, entryPoint: 'main' } });

  // the patch: 33 × 33 vertices (positions come from the instance and the vertex index), one index buffer
  const quads = PATCH * PATCH, idx = new Uint16Array(quads * 6), M1 = PATCH + 1;
  for (let j = 0, o = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) {
    const v0 = j * M1 + i, v1 = v0 + 1, v2 = v0 + M1, v3 = v2 + 1;
    // split along the diagonal that alternates (a crossed lattice reads less as a grid on ridges)
    if ((i + j) & 1) { idx[o++] = v0; idx[o++] = v2; idx[o++] = v1; idx[o++] = v1; idx[o++] = v2; idx[o++] = v3; }
    else { idx[o++] = v0; idx[o++] = v2; idx[o++] = v3; idx[o++] = v0; idx[o++] = v3; idx[o++] = v1; }
  }
  const ibuf = device.createBuffer({ label: 'terrain-patch', size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, idx);

  // --- the stream: worker → upload queue → swap ---
  const stats = { bytes: 0, firstBytes: 0, files: 0, swaps: 0, uploads: 0, uploadBytes: 0, decodeMs: 0, landMsMax: 0, swapMsMax: 0, stage: -1, done: false, log: [] };
  const queue = [];   // { grid, codes, target, row, rows, bpt }
  let worker = null, nextId = 1;
  const pending = new Map();
  function ensureWorker() {
    if (worker) return worker;
    lmPoint('worker.terrain');
    worker = new Worker(new URL('../terrain/worker.js', import.meta.url), { type: 'module', name: 'velia-terrain' });
    worker.onmessage = (e) => { lmPoint('worker.terrain.reply'); const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data); };
    worker.onerror = (e) => { errors.push(`terrain worker: ${e.message}`); };
    return worker;
  }
  // perf/v2-phone-load: the first stage's files fetched by the page (prefetch), before the world build's long task, so
  // the download runs while the main thread builds (a module worker boots only when the main thread is free); the bytes
  // go to the worker (transferred), which decodes them as if it had fetched them itself
  const early = new Map();   // url → Promise<ArrayBuffer | null>
  const fetchGrid = async (grid, url) => {
    const pre = early.get(url); early.delete(url);
    const buf = pre ? await pre : null;
    return new Promise((resolve, reject) => {
      const id = nextId++; pending.set(id, { resolve, reject });
      ensureWorker().postMessage({ id, url, buf, grid: { kind: grid.kind, w: grid.w, h: grid.h, x0: grid.x0, z0: grid.z0, step: grid.step }, H, cells: { ox: TREE.origin, oz: TREE.origin, cell: TREE.cell } }, buf ? [buf] : []);
    });
  };
  // a landed grid: its bounds now (conservative at once), its texture made and queued for slices
  function land(grid, msg, first) {
    const t0 = performance.now();
    stats.bytes += msg.bytes; stats.files++; stats.decodeMs += msg.ms;
    if (first) stats.firstBytes += msg.bytes;
    if (msg.bounds) bounds.merge(msg.bounds);
    const isH = grid.kind === 'h', bpt = isH ? 2 : 1;
    const target = device.createTexture({ label: `terrain-${grid.slot}-${grid.variant}`, size: [grid.w, grid.h], format: isH ? 'r16uint' : 'r8uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (isH ? GPUTextureUsage.COPY_SRC : 0) });   // ultra M2: a height grid may be copied (the bay's codes for the fragment)
    queue.push({ grid, codes: msg.codes, target, row: 0, bpt });
    const ms = performance.now() - t0; stats.landMsMax = Math.max(stats.landMsMax, ms);
    stats.log.push(`${grid.file} ${(msg.bytes / 1024).toFixed(0)} KB ${msg.ms.toFixed(0)} ms`);
  }
  function swap(job) {
    const t0 = performance.now();
    swapOne(job);
    stats.swapMsMax = Math.max(stats.swapMsMax, performance.now() - t0);
  }
  function swapOne(job) {
    const g = job.grid;
    if (g.kind === 'h') {
      const k = SLOTS.indexOf(g.slot);
      // a coarser variant never replaces a finer one that is already in (stages land in order, but be sure)
      if (grids[k] && grids[k].step < g.step) { job.target.destroy(); return; }
      tex[k]?.destroy(); tex[k] = job.target; grids[k] = g; field.setSlot(k, g, job.codes);
      if (k === BED_SLOT) copyBed(g);   // ultra M2: the fragment's copy of the bay's codes
      slotData[k] = { k, grid: g, codes: job.codes }; for (const fn of slotFns) fn(slotData[k]);
      writeLevels(); rebind();
      if (ready) bakeInto(k); else { mtex[k]?.destroy(); mtex[k] = null; }   // before the pipelines exist (stage 0): baked in ready()
    } else {
      const k = COVER_SLOTS.indexOf(g.slot);
      ctex[k]?.destroy(); ctex[k] = job.target; cgrids[k] = g;
      writeLevels(); rebind();
      if (ready) for (let s = 0; s < nS; s++) if (tex[s]) bakeInto(s);   // the albedo reads the cover: every held grid again
    }
    stats.swaps++;
    rebind();
  }
  // upload up to `budget` bytes of the queue's head; a finished grid swaps in; returns the bytes written
  function pump(budget = UPLOAD_BYTES) {
    let done = 0;
    while (queue.length && done < budget) {
      const j = queue[0], g = j.grid, rowBytes = g.w * j.bpt;
      const rows = Math.max(1, Math.min(g.h - j.row, Math.floor((budget - done) / rowBytes)));
      device.queue.writeTexture({ texture: j.target, origin: [0, j.row, 0] }, j.codes, { offset: j.row * rowBytes, bytesPerRow: rowBytes, rowsPerImage: rows }, [g.w, rows, 1]);
      j.row += rows; done += rows * rowBytes; stats.uploads++; stats.uploadBytes += rows * rowBytes;
      if (j.row >= g.h) { queue.shift(); swap(j); }
    }
    return done;
  }
  // fetch one stage (its files in parallel); each grid queues as it lands
  async function loadStage(stage, base, first = false) {
    await Promise.all(stage.map(async (g) => land(g, await fetchGrid(g, new URL(g.file, base).href), first)));
  }

  let ready = false;
  writeLevels(); writeM5c(); rebind();
  let probe = null, probeBG = null, probeOut = null, probeRead = null;
  return {
    bgl, hbgl, field, bounds, selector, stats, triangles: 0, look,
    heightScale: H,   // audit W1: the codes' offset and step (createHeightField's H)
    onSlot(fn) { slotFns.push(fn); for (const d of slotData) if (d) fn(d); },   // audit W1: every height grid, now and as each lands
    patch: { index: ibuf, count: idx.length },   // M5c: the shadow pass draws the same patch
    coverBGL: kbgl1, get coverBindGroup() { return cbg; },   // M5b: the forest's scatter reads the cover grids as the bake does
    // M5c: the externals the draw reads (render/ground.js: the photo tiles and the detail set; render/water.js: the slope
    // cascades; render/shadow.js: the map, its sampler, its record); all before the first frame, then a rebind
    attach({ photo, detail, slope, shadow, sShadow, shadowU, towns, caustic, canopy } = {}) {
      if (canopy) { ext.canopy = canopy; const G = canopy.G; canopyU.splice(0, 8, G.x0, G.z0, 1 / G.texel, G.nx, G.nz, 1, canopyU[6], G.texel); writeLevels(); }   // T3: render/canopy.js's grid
      if (photo) ext.photo = photo; if (detail) ext.detail = detail; if (slope) ext.slope = slope;
      if (caustic) ext.caustic = caustic;   // ultra M2: render/caustics.js's texture
      if (towns) ext.towns = towns;   // 10a: the towns' mask buffer (render/towns.js), when it lands
      if (shadow) ext.shadow = shadow; if (sShadow) ext.sShadow = sShadow; if (shadowU) ext.shadowU = shadowU;
      rebind();
    },
    // M5c: the photo's level records (render/ground.js): x0, z0, texel, on, w, h, tile, layer
    setPhotoLevel(l, { x0, z0, texel, w, h, tile, layer, on = 1 }) {
      const o = l * 8; m5cData[o] = x0; m5cData[o + 1] = z0; m5cData[o + 2] = 1 / texel; m5cData[o + 3] = on; m5cData[o + 4] = w; m5cData[o + 5] = h; m5cData[o + 6] = tile; m5cData[o + 7] = layer;
      writeM5c();
    },
    setLook(o) { Object.assign(look, o); writeM5c(); },
    // M5b: the forest's card range (v2/forest/lod.js FOREST): the floor shows under the drawn trees, the canopy past them
    setForest(L, on) { forestU[0] = L.thin; forestU[1] = L.fade; forestU[2] = L.far; forestU[3] = on ? 1 : 0; canopyU[6] = L.wmax ?? 2; writeLevels(); },   // T3: the cards' wmax (the canopy takes what they leave)
    setCanopyOn(on) { if (ext.canopy) { canopyU[5] = on ? 1 : 0; writeLevels(); } },   // T3: the in-page A/B (the canopy layer off and on, the same frame)
    get bindGroup() { return bg; },
    get bakes() { return bakes; },
    get heightsBindGroup() { return hbg; },
    // after buildAll(): bake the normal maps of the grids that landed before the pipelines existed
    ready() {
      ready = true;
      for (let k = 0; k < nS; k++) if (tex[k]) bakeInto(k);
      rebind();
    },
    get queued() { return queue.length; },
    get grids() { return grids.map((g) => (g ? `${g.slot}:${g.step}` : null)); },
    // perf/v2-phone-load: the first stage's requests out now (and the worker made), ahead of start(); a failed early fetch
    // leaves the file to the worker (its own fetch, its own error)
    prefetch(stage, base) {
      for (const g of stage) {
        const url = new URL(g.file, base).href;
        if (!early.has(url)) early.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
      }
      ensureWorker();
    },
    // stage 0 in full before the first frame (fetch, decode, upload, swap: no budget), the rest later (stream())
    async start(stages, base) {
      stats.stage = 0;
      await loadStage(stages[0], base, true);
      while (queue.length) pump(Infinity);
      return stats;
    },
    // the rest, stage by stage, in the background; uploads go out through pump() a slice a frame (budget Infinity: at once)
    async stream(stages, base, { budget = UPLOAD_BYTES, onStage } = {}) {
      for (let s = 1; s < stages.length; s++) { stats.stage = s; await loadStage(stages[s], base); onStage?.(s); }
      if (budget === Infinity) while (queue.length) pump(Infinity);
      stats.streamed = true;
    },
    pump,
    // per frame: the node quadrants for this camera into the instance buffer (one writeBuffer of count × 16 bytes)
    select(eye, viewProj) {
      frustumPlanes(viewProj, planes);
      const n = selector.select(eye, planes);
      if (n) device.queue.writeBuffer(instBuf, 0, selector.inst.buffer, 0, n * 16);
      this.triangles = n * quads * 2;
      return n;
    },
    draw(pass, c) {
      const n = selector.count; if (!n) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setPipeline(reg.get(underPipe(reg, 'terrain'))); pass.setIndexBuffer(ibuf, 'uint16'); pass.drawIndexed(idx.length, n); c.calls++; c.triangles += n * quads * 2;
    },
    // the GPU's heights at the probe points vs the CPU twin (call when the stream is done; one dispatch, one read)
    async runProbe() {
      await probesIn();
      if (!probe) {
        const pb = device.createBuffer({ label: 'terrain-probe-pts', size: probePts.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(pb, 0, probePts);
        probeOut = device.createBuffer({ label: 'terrain-probe-out', size: probePts.length * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        probeRead = device.createBuffer({ label: 'terrain-probe-read', size: probePts.length * 2, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        probeBG = device.createBindGroup({ layout: pbgl, entries: [{ binding: 0, resource: { buffer: pb } }, { binding: 1, resource: { buffer: probeOut } }] });
        probe = true;
      }
      const enc = device.createCommandEncoder({ label: 'terrain-probe' });
      const pass = enc.beginComputePass(); pass.setPipeline(reg.get('terrain-probe')); pass.setBindGroup(0, hbg); pass.setBindGroup(1, probeBG); pass.dispatchWorkgroups(Math.ceil(probePts.length / 2 / 64)); pass.end();
      enc.copyBufferToBuffer(probeOut, 0, probeRead, 0, probePts.length * 2);
      device.queue.submit([enc.finish()]);
      await probeRead.mapAsync(GPUMapMode.READ);
      const gpu = new Float32Array(probeRead.getMappedRange().slice(0));
      probeRead.unmap();
      let maxErr = 0, at = null;
      for (let i = 0; i < gpu.length; i++) { const cpu = field.height(probePts[2 * i], probePts[2 * i + 1]), err = Math.abs(cpu - gpu[i]); if (err > maxErr) { maxErr = err; at = [probePts[2 * i], probePts[2 * i + 1], +cpu.toFixed(3), +gpu[i].toFixed(3)]; } }
      return { n: gpu.length, maxErrM: +maxErr.toFixed(4), worst: at };
    },
    // ultra M2: the bay's codes as the bed's fragment reads them (the storage buffer) against the slot's texture: every
    // texel, and the bilinear height at the probe points; { texels, texelsDiffer, heights, heightsDiffer, w, h } (a page test)
    async runBedProbe() {
      const g = grids[BED_SLOT]; if (!g || !bedBuf) return null;
      await probesIn();
      const pb = device.createBuffer({ label: 'terrain-bed-probe-pts', size: probePts.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(pb, 0, probePts);
      const out = device.createBuffer({ label: 'terrain-bed-probe-out', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const rd = device.createBuffer({ label: 'terrain-bed-probe-read', size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const b1 = device.createBindGroup({ layout: bpbgl, entries: [{ binding: 0, resource: { buffer: pb } }, { binding: 1, resource: { buffer: out } }, { binding: 2, resource: { buffer: bedBuf } }] });
      const enc = device.createCommandEncoder({ label: 'terrain-bed-probe' });
      const pass = enc.beginComputePass(); pass.setPipeline(reg.get('terrain-bed-probe')); pass.setBindGroup(0, hbg); pass.setBindGroup(1, b1); pass.dispatchWorkgroups(64); pass.end();
      enc.copyBufferToBuffer(out, 0, rd, 0, 16);
      device.queue.submit([enc.finish()]);
      await rd.mapAsync(GPUMapMode.READ);
      const [texelsDiffer, texels, heightsDiffer, heights] = new Uint32Array(rd.getMappedRange().slice(0));
      rd.unmap(); pb.destroy(); out.destroy(); rd.destroy();
      return { texels, texelsDiffer, heights, heightsDiffer, w: g.w, h: g.h, step: g.step };
    },
    reflectView: reflTex.createView(),
    // every frame, in the aerial pass: the mirror's horizon for this camera
    runReflect(pass, c) {
      pass.setPipeline(reg.get('terrain-reflect')); pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, hbg); pass.setBindGroup(2, rbg);
      pass.dispatchWorkgroups(REFLECT.az); c.dispatches++;
    },
    stop() { worker?.terminate(); worker = null; },
  };
}
