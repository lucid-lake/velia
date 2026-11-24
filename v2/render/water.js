// The FFT water as WebGPU compute on our own engine. The simulation is Ultra-Water's (MIT; src/waters/ultra/LICENSE,
// ATTRIBUTION.md): Tessendorf's h(k, t) from the h0 table (v2/sim/spectrum.js, on the CPU), a Stockham radix-2 inverse
// FFT (8 stages an axis, 16 in all) over three 256² cascades (600 / 85 / 12 m tiles) stacked in one storage buffer,
// then an assemble pass: the centred-k sign undone, the jacobian and its foam recovery, the displacement
// (λDx, Dy, λDz, turbulence) and the slopes (sx, sz, sx², sz²) into two rgba16float array textures, whose 8 mip
// levels a box-filter compute pass makes (so far water keeps a filtered slope mean and a slope variance for its
// roughness, LEAN style). The rest is ours: the WGSL, the surface mesh, the shading, the readback.
//   Mesh: a camera-centred grid of (2K+1)² vertices whose offsets grow exponentially from the eye, o(i) = a(e^{b|i|} − 1)
//   (a 0.167 m first cell, 6 % growth, 40 km at the edge), snapped to the first cell as the camera moves, so a triangle
//   covers about the same number of pixels at every distance and one static index buffer draws the whole lake. It
//   was picked over a projected grid (which wobbles at the horizon and inverts when the camera pitches up) and over
//   clipmap rings (per-level index buffers and seam stitching for the same screen-space density).
//   Shading: slopes → normal; the slope variance over the pixel's footprint (the mips at the footprint's level, plus the
//   screen-space spread; water-aa.js) → GGX roughness; Schlick Fresnel averaged over the unresolved facets, between the
//   mirror (the sky-view LUT, the clouds' key and the land's ridge line, each averaged over the facets' spread round the
//   ray off the footprint's mean normal) and the lake's body (M2: the bed through the water, the deep body past 40 m);
//   the sun's glint as a GGX lobe never narrower than half the clean sea's, rolled off toward 4 × the sky round the sun;
//   foam from the jacobian, subtle (grey-white, only in wind over 5 m/s, at most half cover); the aerial perspective.
//   M5c (2026-11-13): the filtering above replaced one normal + one ray per pixel, which flashed white dots at distance.
//   Readback: the assemble pass writes a 64 × 64 texel window of each cascade's f32 displacement round the grid's centre
//   into a storage buffer; each frame it is copied into a 3-slot staging ring (v2/engine/readback.js) and the CPU
//   surface (v2/sim/surface.js) adopts it: water.heightAt(x, z) is the boat's (M3) height on the drawn water.
import { wgslStruct } from '../engine/uniforms.js';
import { createReadbackRing } from '../engine/readback.js';
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { TERRAIN_BIND, TERRAIN_HEIGHT, WATER_WGSL, REFLECT_READ, REFLECT } from './terrain.js';
import { AA_WGSL, MIRROR_TAPS } from './water-aa.js';
import { SKY_CURVE_WGSL } from './grade.js';   // fix(v2) frame look: the mirror reflects v1's sky at grazing rays (SKY_MATCH, MIRROR_SKY)
import { MIRROR_DECK } from '../sim/clouds.js';   // fix(v2) frame look: the deck in the mirror without the camera's gain
import { NIGHT_READ } from './night-read.js';   // M5e: the Milky Way in the mirror
import { NIGHT } from '../sim/night.js';   // feat/v2-night-clouds: the night deck's sheen in the mirror (NIGHT.deckMirror)
import { MIRROR_READ_WGSL, MIRROR } from './towns.js';   // #41c: the shore's mirror (the piers, the boathouses, the harbour)
import { TREE } from '../terrain/quadtree.js';
import { N, LENGTHS, CPU_CASCADES, SEA, seaTables, seaWeights, composeSea, bayShares, seaStats, hsLaw, V1_SEA, FADES } from '../sim/spectrum.js';
import { SURF, SURF_WGSL, SURF_FNS_WGSL, SURF_BITS, SURF_ALL, SURF_DEFAULT, FOAM_BAKE_WGSL, FOAM_TEX, whitecapJ0Field, capShare, J0_HIST, j0Glide } from './water-surface.js';   // #56 M1: v1's drawing recipe, Ultra's foam, crest light and glint (MIT)
import { createSurface, WIN, WINDOW_FLOATS, OFFSETS, COARSE_OFFSETS, COARSE_N, COARSE_C } from '../sim/surface.js';
import { createSeaField, SEA_FIELD_WGSL, FIELD_BYTES } from '../sim/seaField.js';   // #21, #25: the shallows' calm and the sea across the lake
import { SPUME_WGSL } from './spume.js';
import { WIND_WATER_WGSL, WIND_BINDING, BITS, LANE, GUST_FX } from './windWater.js';
import { WIND_TEX } from '../sim/windTex.js';   // audit W1–W3: the gusts, v1's whitecaps, the lanes
import { GUST_LOOK } from '../../src/sim/water-spectrum.js';
import { STREAK_ONSET } from '../../src/sim/windCues.js';   // v1's spume: the whitecaps' foam blown along the wind lanes past 12 m/s
import { SHORE_STUB_WGSL } from './shore.js';   // #56 M3: the breakers, the swash and the wet sand (Ultra-Water's shore, MIT)
import { SHORE as SHORE_M3 } from '../sim/shoreField.js';
import { UNDER_WGSL, UNDER } from './underMedium.js';   // play as Tessie, phase 2a: the eye under the water
import { UNDER_STATE } from './underState.js';
import { createFoamMap, FOAM_MAP_READ_WGSL, FOAM_MAP } from './web-ocean/foamMap.js';   // waterDetail, fix 2: the persistent foam (web-ocean, MIT)

export const C = LENGTHS.length, NN = N * N, LOOP = 300, LOG_N = 8;   // 4 cascades: 600 / 85 / 12 / 2.1 m
export const GRID = Object.freeze({ K: 160, a: 2.71, b: 0.06 });   // (2K+1)² vertices; o(i) = a(e^{b|i|} − 1): 0.167 m first cell, 40.0 km at i = K
const SIDE = 2 * GRID.K + 1;
export const DEEP_M = [40, -TREE.floorCut];   // m: the bed's share fades to the water's own body between these depths
// the starlit night's water (fix/v2-fireworks-water-look, owner 2026-11-15: "the water color and wave also look suspicious"):
// f0, v1's NIGHT_F0 (src/water.js: the Fresnel floor over water's 0.02, smooth from the sun e0 to e1 degrees: the near water
// mirrors the night sky with a sheen, so its waves read); body, the night light on the lake's body (nightLand ×; M5e had 9, then
// 2: the deep water read royal blue under the night sky); sky, the body's share of the sky's light by night (look/v2-night-look:
// the sky light now carries the airglow's night share, so the body takes 0.3 of it, the water no brighter than the land);
// both come in from the sunset (e0) to −8° (e1), with the night light. None acts by day (the day's water is unchanged to the bit)
export const NIGHT_WATER = Object.freeze({ f0: 0.15, body: 0.3, sky: 0.3, e0: 0, e1: -8 });
// The far water's sky tint (owner, 2026-11-20: "Look comparison", item 2, after Ponlai's SeaOptics.ts: the deep sea takes
// the sky's colour): past `near` m the lake's deep body leans toward the colour of the sky just over the horizon in the view's own
// direction (its hue, at the body's own luminance or `floor` of the sky's, the larger), up to `k` of the way by `far` m, so the far water reads the sky's grade
// (blue by day, the dusk's pink-lavender and gold, the night's deep blue) instead of one flat navy. The navy past the shelf near the
// boat (inside `near`) and the clarity in the shallows (the bed's share) are untouched; none under a storm (its slate rules); the
// lite water (a phone, L2-L3) has none. up: the sky's sample over the horizon (sine)
export const WATER_FAR = Object.freeze({ near: 250, far: 2500, k: 0.4, up: 0.05, floor: 0.08 });

// the moon's glitter path (look/v2-night-look, owner 2026-11-15: "a beautiful night light and water effect"): the glint's lobe
// off the moon's direction over the pixel's own slope spread × lobe (no wide floor, so the near waves' faces catch it or not
// and the path breaks), k its light at a full moon high (HDR, × moonShare), glitter the far facet cells' weight (the sun's
// is 0.35; faded in over the sun's 4–30 m, so no cell reads near), cap the roll-off's knee (no facet blows white), colour a
// cool silver
export const MOON_GLINT = Object.freeze({ k: 0.02, lobe: 2.5, glitter: 1.0, cap: 0.05, colour: [0.86, 0.92, 1.0] });
export const SHORE_SOFT_M = 0.35;   // the soft shore: the surface fades in over this much water
export const FOAM = Object.freeze({ onset: 0.45, full: 0.1, windLo: 5, windHi: 11, cover: 0.35 });

// --- the WGSL ---
// the tiles' domain warp (the draw's vertex and fragment stages, waterDetail's foam map)
export const WARP_WGSL = `fn warpOf(x: f32, z: f32) -> vec2f {
  return vec2f(2.5 * sin(0.0419 * z + 0.0113 * x + 1.3) + sin(0.113 * x - 0.071 * z + 0.7),
               2.5 * sin(0.0377 * x - 0.0097 * z + 0.4) + sin(0.097 * z + 0.083 * x + 2.1));
}`;
export const FOAM_MAP_BINDING = 16;   // waterDetail: the persistent foam's buffer and uniform (16, 17), after the shore's 15
const HEAD = (frameStruct) => `${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
const C = ${C}u; const CPU_C = ${CPU_CASCADES}u;`;
const COMMON = (frameStruct) => `${HEAD(frameStruct)}
const N = 256u; const NN = 65536u; const HALF = 128u; const WIN = ${WIN};
const PI = 3.14159265359; const G = 9.81; const ST = 7.4e-5; const LOOP = ${LOOP}.0;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn pack2(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x - b.y, a.y + b.x); }`;

export const EVOLVE_WGSL = (fs) => `${COMMON(fs)}
@group(1) @binding(0) var<storage, read> h0: array<vec4f>;
@group(1) @binding(1) var<storage, read_write> p0: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> p1: array<vec4f>;
// h(k, t) from h0 into the two packed complex fields: IFFT(A + iB) = a + ib gives two real fields per transform
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= C * NN) { return; }
  let cf = i / NN; let r = i % NN; let y = r / N; let x = r % N;
  let L = F.water[cf]; let dk = 2.0 * PI / L;
  let kx = (f32(x) - 128.0) * dk; let kz = (f32(y) - 128.0) * dk; let kl = sqrt(kx * kx + kz * kz);
  var ik = 0.0; if (kl > 1e-6) { ik = 1.0 / kl; }
  let om = sqrt(G * kl + ST * kl * kl * kl);
  let W0 = 2.0 * PI / LOOP;
  // ω quantised to multiples of 2π/LOOP so the sim loops at LOOP s and fp32 phase never degrades; reduced before sin/cos
  let ph = 2.0 * PI * fract(floor(om / W0) * (F.wind.w / LOOP));
  let e = vec2f(cos(ph), sin(ph)); let h0v = h0[i];
  let h = (cmul(h0v.xy, e) + cmul(h0v.zw, vec2f(e.x, -e.y))) * F.wind.z;
  let ih = vec2f(-h.y, h.x);
  let dx = ih * kx * ik; let dz = ih * kz * ik;
  let dxdx = -h * kx * kx * ik; let dzdz = -h * kz * kz * ik; let dxdz = -h * kx * kz * ik;
  p0[i] = vec4f(pack2(dx, dz), pack2(h, dxdz));
  p1[i] = vec4f(pack2(ih * kx, ih * kz), pack2(dxdx, dzdz));
}`;

export const FFT_WGSL = `
const N = 256u; const NN = 65536u; const C = ${C}u; const HALF = 128u; const PI = 3.14159265359;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
struct Axis { vert: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<storage, read> in0: array<vec4f>;
@group(0) @binding(1) var<storage, read> in1: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> out0: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> out1: array<vec4f>;
@group(1) @binding(0) var<uniform> S: Axis;
var<workgroup> w0: array<vec4f, 256>;
var<workgroup> w1: array<vec4f, 256>;
// the 8 Stockham radix-2 inverse stages (e^{+i}) of one line, along x (vert 0) or y (vert 1), in workgroup memory: one
// workgroup a line of a cascade, one thread a point (the speed pass: 16 dispatches of 8 MB round trips became 2). The same
// butterfly, twiddle and order as the old one-stage-a-dispatch kernel: stage s has sub = 2^s, hs = 2^(s-1)
@compute @workgroup_size(256) fn main(@builtin(local_invocation_index) il: u32, @builtin(workgroup_id) wg: vec3u) {
  let cf = wg.x / N; let line = wg.x % N; let base = cf * NN;
  var gi = base + line * N + il;                       // along x: the line is a row, the thread its column
  if (S.vert == 1u) { gi = base + il * N + line; }     // along y: the line is a column, the thread its row
  w0[il] = in0[gi]; w1[il] = in1[gi];
  workgroupBarrier();
  for (var st = 1u; st <= 8u; st++) {
    let sub = 1u << st; let hs = 1u << (st - 1u);
    let e = (il / sub) * hs + (il % hs);
    let a = 2.0 * PI * f32(il % sub) / f32(sub); let tw = vec2f(cos(a), sin(a));
    let e0 = w0[e]; let o0 = w0[e + HALF]; let e1 = w1[e]; let o1 = w1[e + HALF];
    workgroupBarrier();
    w0[il] = vec4f(e0.xy + cmul(tw, o0.xy), e0.zw + cmul(tw, o0.zw));
    w1[il] = vec4f(e1.xy + cmul(tw, o1.xy), e1.zw + cmul(tw, o1.zw));
    workgroupBarrier();
  }
  out0[gi] = w0[il]; out1[gi] = w1[il];
}`;

export const ASSEMBLE_WGSL = (fs, dt, rec = SEA.foamRecovery) => `${COMMON(fs)}
const DT = ${dt}; const REC = ${rec};   // #56 M1: the foam's memory (render/water-surface.js SURF.foamRec; ?m1=0 Ultra's 0.7)
@group(1) @binding(0) var<storage, read> p0: array<vec4f>;
@group(1) @binding(1) var<storage, read> p1: array<vec4f>;
@group(1) @binding(2) var<storage, read_write> turb: array<f32>;
@group(1) @binding(3) var<storage, read_write> win: array<vec4f>;
@group(1) @binding(4) var dispOut: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(5) var slopeOut: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(256) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= C * NN) { return; }
  let cf = i / NN; let r = i % NN; let y = r / N; let x = r % N;
  let s = select(-1.0, 1.0, ((x + y) & 1u) == 0u);   // the centred-k frequency shift, undone
  let a = p0[i] * s; let b = p1[i] * s;               // a: Dx, Dz, Dy, Dxz;  b: Dyx, Dyz, Dxx, Dzz
  let lam = F.params.w;
  let dxx = lam * b.z; let dzz = lam * b.w; let dxz = lam * a.w;
  let jac = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  let sl = vec2f(b.x / max(1.0 + dxx, 0.2), b.y / max(1.0 + dzz, 0.2));
  let prev = turb[i];
  let tb = min(jac, prev + DT * REC / max(jac, 0.5));   // foam follows the jacobian down at once and recovers at a rate
  turb[i] = tb;
  let dv = vec4f(lam * a.x, a.z, lam * a.y, tb);
  textureStore(dispOut, vec2i(i32(x), i32(y)), i32(cf), dv);
  textureStore(slopeOut, vec2i(i32(x), i32(y)), i32(cf), vec4f(sl, sl * sl));
  // the CPU's window (f32): a 64-texel square round the grid's centre for the 600 and 85 m tiles, the whole 12 m tile
  // (its tile break warp is wider than a window); the same origin formula and layout as v2/sim/surface.js
  if (cf >= CPU_C) { return; }
  // the whole 600 and 85 m tiles at half resolution after the 12 m tile (every other texel: v2/sim/surface.js COARSE_OFFSETS), so the
  // CPU reads the sea anywhere on the lake (the rivals' hulls)
  if (cf < ${COARSE_C}u && (x & 1u) == 0u && (y & 1u) == 0u) { win[${COARSE_OFFSETS[0]}u + cf * ${COARSE_N * COARSE_N}u + (y >> 1u) * ${COARSE_N}u + (x >> 1u)] = dv; }
  let L = F.water[cf];
  let full = cf == 2u;
  let W = select(64, 256, full); let off = select(cf * 4096u, 8192u, full);
  var ox = 0; var oz = 0;
  if (!full) { ox = i32(floor(F.grid.x / L * 256.0)) - 32; oz = i32(floor(F.grid.y / L * 256.0)) - 32; }
  let wx = ((i32(x) - ox) % 256 + 256) % 256; let wz = ((i32(y) - oz) % 256 + 256) % 256;
  if (wx < W && wz < W) { win[off + u32(wz) * u32(W) + u32(wx)] = dv; }
}`;

export const MIP_WGSL = `
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
// one level down: the 2 × 2 box mean of every layer (the slope means and second moments stay means)
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let sz = textureDimensions(dst); if (g.x >= sz.x || g.y >= sz.y) { return; }
  let p = vec2i(g.xy) * 2; let l = i32(g.z);
  let v = (textureLoad(src, p, l, 0) + textureLoad(src, p + vec2i(1, 0), l, 0) + textureLoad(src, p + vec2i(0, 1), l, 0) + textureLoad(src, p + vec2i(1, 1), l, 0)) * 0.25;
  textureStore(dst, vec2i(g.xy), l, v);
}`;

// perf(v2) phone round 2: four mip levels in one dispatch (one texture, one layer a z): each 8 × 8 workgroup reads a 16 × 16
// block of the source level and writes the next four levels, the in-between values kept in workgroup memory rounded to f16
// as a store would round them, so each level is the same 2 × 2 box mean of the level above as MIP_WGSL's (same order of
// adds). Two dispatches a texture (levels 1–4 from 0, 5–8 from 4) for MIP_WGSL's eight
export const MIP4_WGSL = `
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var d1: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(2) var d2: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var d3: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(4) var d4: texture_storage_2d_array<rgba16float, write>;
var<workgroup> t1: array<vec4f, 64>;
var<workgroup> t2: array<vec4f, 16>;
var<workgroup> t3: array<vec4f, 4>;
fn h(v: vec4f) -> vec4f { return vec4f(unpack2x16float(pack2x16float(v.xy)), unpack2x16float(pack2x16float(v.zw))); }
@compute @workgroup_size(8, 8, 1) fn main(@builtin(local_invocation_id) li: vec3u, @builtin(workgroup_id) wg: vec3u) {
  let l = i32(wg.z); let x = li.x; let y = li.y;
  let n1 = textureDimensions(d1);
  let o1 = wg.xy * 8u + li.xy;
  var v1 = vec4f(0.0);
  if (o1.x < n1.x && o1.y < n1.y) {
    let p = vec2i(o1) * 2;
    v1 = h((textureLoad(src, p, l, 0) + textureLoad(src, p + vec2i(1, 0), l, 0) + textureLoad(src, p + vec2i(0, 1), l, 0) + textureLoad(src, p + vec2i(1, 1), l, 0)) * 0.25);
    textureStore(d1, vec2i(o1), l, v1);
  }
  t1[y * 8u + x] = v1;
  workgroupBarrier();
  if (x < 4u && y < 4u) {
    let i = (2u * y) * 8u + 2u * x;
    let v2 = h((t1[i] + t1[i + 1u] + t1[i + 8u] + t1[i + 9u]) * 0.25);
    t2[y * 4u + x] = v2;
    let o2 = wg.xy * 4u + li.xy; let n2 = textureDimensions(d2);
    if (o2.x < n2.x && o2.y < n2.y) { textureStore(d2, vec2i(o2), l, v2); }
  }
  workgroupBarrier();
  if (x < 2u && y < 2u) {
    let i = (2u * y) * 4u + 2u * x;
    let v3 = h((t2[i] + t2[i + 1u] + t2[i + 4u] + t2[i + 5u]) * 0.25);
    t3[y * 2u + x] = v3;
    let o3 = wg.xy * 2u + li.xy; let n3 = textureDimensions(d3);
    if (o3.x < n3.x && o3.y < n3.y) { textureStore(d3, vec2i(o3), l, v3); }
  }
  workgroupBarrier();
  if (x == 0u && y == 0u) {
    let v4 = h((t3[0] + t3[1] + t3[2] + t3[3]) * 0.25);
    let n4 = textureDimensions(d4);
    if (wg.x < n4.x && wg.y < n4.y) { textureStore(d4, vec2i(wg.xy), l, v4); }
  }
}`;
// perf(v2) phone round 2: the 2.1 m cascade dropped from the sim (the phone path's waterCascades 3): its slope layer holds
// no ripples, only their roughness, the slope variance its last full step measured (the top mip's moments) at every texel
// of mips 0–7 (the top level keeps the measurement), so the sun's path and the mirror keep their width; the near water
// loses the finest ripples' normals (2.1 m tile: 8 mm texels, sharp only within metres of the camera at 0.6 Mpx)
export const FLAT3_WGSL = `
@group(0) @binding(0) var top: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let sz = textureDimensions(dst); if (g.x >= sz.x || g.y >= sz.y) { return; }
  let m = textureLoad(top, vec2i(0), 3, 0);
  textureStore(dst, vec2i(g.xy), 3, vec4f(0.0, 0.0, max(m.zw - m.xy * m.xy, vec2f(0.0))));
}`;

// --- the wake block (render/wake.js): the boat's Kelvin map, foam map and bow, bound in group 2 at WAKE_BINDING; without
// a wake the same functions return nothing (the shading below then is exactly the wakeless water's) ---
export const WAKE_BINDING = 8;   // after the night's 4–7 (render/night.js waterBind)
export const SHORE_MIRROR_BINDING = 12;   // #41c: after the wake's 8–9 and the sea field's 10–11 (render/towns.js createShoreMirrorTarget: a storage buffer)
export const SURF_BINDING = 13;   // #56 M1: the surface's uniform (render/water-surface.js Surf)
export const FOAM_LAYER = C;      // #56 M1: Ultra's baked foam in the slope array's last layer (the fragment stage is at 16 sampled textures)
export const SHORE_BINDING = 15;  // #56 M3: the shore field (render/shore.js: a storage buffer; after the wind's 14)
const WAKE_STUB = `struct WakeS { slope: vec2f, foam: f32, rough: f32, roll: f32, glow: f32 }
const WAKE_GLOW = vec3f(0.0);
fn wakeAt(xz: vec2f, fp: f32) -> WakeS { var o: WakeS; return o; }
fn wakeSlick(xz: vec2f, rough: f32, t: f32) -> f32 { return 0.0; }
fn wakeGain(c: u32, calm: f32) -> f32 { return 1.0; }
fn wakeFoamVisible(xz: vec2f, foam: f32, t: f32, churn: f32, fp: f32) -> f32 { return 0.0; }
fn wakeFoamColour(n: vec3f, s: vec3f, eSky: vec3f, eSun: vec3f) -> vec3f { return vec3f(0.0); }
fn wakeInHull(p: vec3f) -> bool { return false; }
const WAKE_CALM = 0.0;`;
const WAKE_WGSL = (wake) => (wake ? wake.readWGSL(WAKE_BINDING) : WAKE_STUB);   // wake: render/wake.js createWakeFx
// #21, #25 (2026-11-14): the sea field's uniform and fetch map (sim/seaField.js), the vertex stage only, after the wake's two
export const SEA_BINDING = WAKE_BINDING + 2;
// --- end of the wake block ---

// perf(v2) phone: LITE_TAPS, the lite water's mirror (L2 and L3, the phone path): the land at 3 taps, the clouds' key at 2,
// each cloud tap filtered over twice the spacing (its mip chain carries the spread the dropped taps sampled)
export const LITE_TAPS = Object.freeze({ land: Object.freeze({ offsets: [-1.2, 0, 1.2], weights: [0.25, 0.5, 0.25] }), cloud: Object.freeze({ offsets: [-0.8, 0.8], weights: [0.5, 0.5] }) });
// #18: the storm's water. Under the cell the body lost the sun (the cell's shade, down to 0.08) and the grade halves what is
// left and takes 70 % of its colour, so the deep water read grey-black where v1's keeps navy (tools/v2-storm.mjs: v1 5, 8, 17
// at the follow camera, 147 s). The overcast deck scatters the sun's light down as sky light (≈ 3 x a clear sky's at the
// sun's 20 degrees) and v1's camera (its fixed exposure and AgX) holds the navy: the body's sky light x `body` at the storm's
// full dark, fitted at the follow camera (5, 7, 16) and checked at dusk (8, 9, 15 against 5, 7, 13)
// fix(v2) frame look: under v1's camera (AgX, then v1's LUT, which lifts a dark blue's chroma × 1.25) the same body read a
// bright blue (1, 10, 34 at the follow camera), so the body's storm light is re-fitted for it (bodyV1); ?look=v2 keeps 45
export const STORM_WATER = Object.freeze({ body: 45, bodyV1: 15, foam: 0.6, capLit: 0.75,
  // round 4: the persistent marbled field (jacL's age band, the lace's two scales per m, the web's threshold fresh → old and its
  // softness, the core's age band, opacities and light, the far footprint band m/px and the sheen's share), the caps kept
  capKeep: 0.3, ageJ: [0.5, 0.85], marble: [0.028, 0.011], warp: 1.4, cellM: [4.5, 1.6], lineW: [0.03, 0.24], core: [0.8, 0.97],
  webA: 0.5, coreA: 0.65, webLit: 0.55, marbleFar: [0.12, 0.45], sheen: 0.35 });
// waterDetail (features.js waterDetail: a desktop or a tablet at L0-L1): two fragment-only answers to "too much pattern". The CPU surface,
// the vertex displacement and the foam read the tiles as before, so the boat rides the same water.
//   1. a variation layer: each cascade's slopes (mean and moments) × a gain from an aperiodic value noise (two octaves, 290 and
//      123 m, rotated, an offset per cascade), so the copies of the 85 m and 12 m tiles no longer carry the same contrast; its
//      mean is 1 (the lake's average roughness, its colour and its mirror unchanged); W2.amp per cascade (600 / 85 / 12 / 2.1 m)
//   2. the 2.1 m layer (slopes only, never read by the CPU) sampled in a frame turned W2.turn degrees, its slopes turned back:
//      its lattice no longer lines up with the 12 m tile's (12 / 2.1 = 5.7 within 0.3 of a whole number every 6 copies)
export const W2 = Object.freeze({ amp: [0.15, 1.0, 1.0, 0.6], scale: [290, 123], mix: [0.65, 0.35], clamp: [0.35, 1.8], turn: 27 });
const W2_C = Math.cos(W2.turn * Math.PI / 180), W2_S = Math.sin(W2.turn * Math.PI / 180);
const W2_F = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
export const WATER2_WGSL = `
const W2_ROT = mat2x2f(${W2_F(+W2_C.toFixed(6))}, ${W2_F(+W2_S.toFixed(6))}, ${W2_F(+(-W2_S).toFixed(6))}, ${W2_F(+W2_C.toFixed(6))});
fn w2Hash(p: vec2i) -> f32 {
  var h = (bitcast<u32>(p.x) * 0x8da6b343u) ^ (bitcast<u32>(p.y) * 0xd8163841u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du; h = (h ^ (h >> 12u)) * 0x297a2d39u; h = h ^ (h >> 15u);
  return f32(h >> 8u) / 8388607.5 - 1.0;
}
fn w2Noise(x: vec2f) -> f32 {
  let i = vec2i(floor(x)); let f = fract(x); let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(w2Hash(i), w2Hash(i + vec2i(1, 0)), u.x), mix(w2Hash(i + vec2i(0, 1)), w2Hash(i + vec2i(1, 1)), u.x), u.y);
}
fn w2Gain(xz: vec2f) -> vec4f {
  // three aperiodic noises (290 m, 123 m and 181 m, each turned), shared by the cascades in different mixes
  let a = w2Noise(xz / ${W2_F(W2.scale[0])} + vec2f(17.3, 5.1));
  let b = w2Noise(mat2x2f(0.8, 0.6, -0.6, 0.8) * xz / ${W2_F(W2.scale[1])} + vec2f(3.7, 11.9));
  let c = w2Noise(mat2x2f(0.28, -0.96, 0.96, 0.28) * xz / 181.0 + vec2f(9.2, 2.4));
  let n = vec4f(${W2_F(W2.mix[0])} * a + ${W2_F(W2.mix[1])} * b, ${W2_F(W2.mix[0])} * b + ${W2_F(W2.mix[1])} * c, ${W2_F(W2.mix[0])} * c + ${W2_F(W2.mix[1])} * a, ${W2_F(W2.mix[0])} * a - ${W2_F(W2.mix[1])} * c);
  let amp = vec4f(${W2.amp.map(W2_F).join(', ')});
  return clamp(vec4f(1.0) + amp * n * 2.0, vec4f(${W2_F(W2.clamp[0])}), vec4f(${W2_F(W2.clamp[1])}));
}
// a turned tile's slopes back to the world: the mean exactly, the second moments without their cross term (not stored)
fn w2Back(t: vec4f) -> vec4f {
  let c = ${W2_F(+W2_C.toFixed(6))}; let s = ${W2_F(+W2_S.toFixed(6))};
  return vec4f(c * t.x + s * t.y, -s * t.x + c * t.y, c * c * t.z + s * s * t.w, s * s * t.z + c * c * t.w);
}
`;
export const WATER_DRAW_WGSL = (fs, wake = null, lite = false, shore = null, detail = false) => `diagnostic(off, derivative_uniformity);
${detail && !lite ? WATER2_WGSL : ''}
const STORM_BODY = ${STORM_WATER.body.toFixed(1)}; const STORM_BODY_V1 = ${STORM_WATER.bodyV1.toFixed(1)}; const STORM_FOAM = ${STORM_WATER.foam.toFixed(2)};   // #18: the body's sky light under the storm's dark (STORM_WATER)
${HEAD(fs)}
${ATMO_WGSL}
${SKY_READ}
${SKY_CURVE_WGSL}
${AP_READ}
${TERRAIN_BIND(3)}
${TERRAIN_HEIGHT}
@group(2) @binding(0) var tDisp: texture_2d_array<f32>;
@group(2) @binding(1) var tSlope: texture_2d_array<f32>;
@group(2) @binding(2) var sRep: sampler;
@group(2) @binding(3) var tRefl: texture_2d<f32>;
${NIGHT_READ(2, 4)}
${REFLECT_READ}
${MIRROR_READ_WGSL(2, SHORE_MIRROR_BINDING)}
${AA_WGSL}
${WAKE_WGSL(wake)}
${SEA_FIELD_WGSL(SEA_BINDING)}
${SURF_WGSL}${SURF_FNS_WGSL}
@group(2) @binding(${SURF_BINDING}) var<uniform> SU: Surf;
const FOAM_LAYER = ${FOAM_LAYER};
${SPUME_WGSL}
${WIND_WATER_WGSL(WIND_BINDING)}
${detail && !lite ? FOAM_MAP_READ_WGSL(FOAM_MAP_BINDING) : ''}
${shore ? shore.readWGSL(SHORE_BINDING, lite) : SHORE_STUB_WGSL}
const SH_WET = ${SHORE_M3.wetDark.toFixed(3)};   // #56 M3: the wet sand's darkening
// #56 M3: the shore trains' sea: the drawn sea's Hs at the point before the depth's calm (each displacement tile's Hs at the
// boat × the sea field's gain here), so a wave keeps its size from the open water onto the beach (the vertex stage)
fn shoreHs(x: f32, z: f32) -> f32 { return length(SU.hs.xyz * seaGains(x, z, vec2f(1.0)).xyz); }
const K = ${GRID.K}; const SIDE = ${SIDE}u;
const NBINS = ${REFLECT.bins}.0; const EMAXR = ${(REFLECT.maxDeg * Math.PI / 180).toFixed(6)};
// the mirror's texel at azimuth u (0–1) and elevation e (rad): REFLECT_READ's mapping (terrain.js), the elevation given
fn landAt(u: f32, e: f32) -> vec4f {
  let b = sqrt(max(e, 0.0) / EMAXR) * (NBINS - 1.0);
  let v = clamp((b + 0.5) / NBINS, 0.5 / NBINS, 1.0 - 0.5 / NBINS);
  return textureSampleLevel(tRefl, sRep, vec2f(u, v), 0.0);
}
// the mirror averaged over the facets the pixel cannot resolve: the land read at ${MIRROR_TAPS.land.offsets.length} taps and the clouds' key at
// ${MIRROR_TAPS.cloud.offsets.length} up and down the reflected elevation (dE the spread, rad; the sky's LUT is smooth: once, at the ray). One tap
// at one ray flashed a cloud edge, or land against sky, per pixel per frame at distance: the "white dots" of 2026-11-13
// fix(v2) the far water's shimmer (2026-11-13): each cloud tap reads the key's mip chain over its share of the spread
// (water-aa.js cloudTapGrad; render/clouds.js KEY_MIP_WGSL): five point taps of a key packed toward the horizon
// flickered past the middle distance, where the taps' spacing outgrew a row of the key
fn mirrorBlur(R: vec3f, dE: f32, landK: f32, Rs: vec3f) -> vec3f {
  let u = atan2(R.z, R.x) / (2.0 * PI) + 0.5; let e0 = asin(clamp(R.y, 0.0, 1.0));
  var cl = vec4f(0.0); var land = vec4f(0.0);
${(lite ? LITE_TAPS : MIRROR_TAPS).land.offsets.map((o, i) => `  land += ${(lite ? LITE_TAPS : MIRROR_TAPS).land.weights[i]} * landAt(u, max(e0 + ${o.toFixed(2)} * dE, 0.0));`).join('\n')}
${(lite ? LITE_TAPS : MIRROR_TAPS).cloud.offsets.map((o, i) => `  { let e = max(e0 + ${o.toFixed(2)} * dE, 0.0); cl += ${(lite ? LITE_TAPS : MIRROR_TAPS).cloud.weights[i]} * cloudAtUEGrad(u, e, cloudTapGrad(e, ${lite ? '2.0 * dE' : 'dE'})); }`).join('\n')}
  // M5e: the Milky Way in the mirror (once, at the ray: the map is soft at the facets' spread), under the air and the clouds
  // fix(v2) frame look: at grazing angles the mirror holds v1's sky (render/grade.js SKY_MATCH: v1 mirrors its sky without the
  // polariser), toward the vertical v2's own (render/grade.js MIRROR_SKY: v1's near water reads navy, its far water bright)
  // and the deck without its camera gain (sim/clouds.js MIRROR_DECK: the match's gain over the light's own is the screen's)
  // feat/v2-night-clouds: by night the deck in the mirror keeps a long exposure's sheen, NIGHT.deckMirror × its own light (as the clear
  // sky's mirror takes airMirror of the airglow, not airSky): the deck went dark toward v1's, the water that mirrors it stays readable
  let deckNight = mix(1.0, ${NIGHT.deckMirror.toFixed(2)}, clamp(F.night.x, 0.0, 1.0));
  let sky = (mirrorSky(skyRadianceMirror(R), R.y) + milkyWay(R) * transAt(Rg + F.sky.z, max(R.y, 0.0))) * cl.a + cl.rgb * mix(1.0, ${MIRROR_DECK.toFixed(4)}, max(F.look.w, 0.0)) * deckNight;
  let base = sky * (1.0 - land.a * landK) + land.rgb * landK;
  // #41c: the shore over the land at the land's taps (premultiplied), the same share on a rough sea; none near: one word
  if (SHM[0] == 0u) { return base; }
  let sc = shoreCols(atan2(Rs.z, Rs.x) / (2.0 * PI) + 0.5);
  if (max(sc.t0, sc.t1) == 0u) { return base; }
  let es = asin(clamp(Rs.y, 0.0, 1.0));
  var shore = vec4f(0.0);
${(lite ? LITE_TAPS : MIRROR_TAPS).land.offsets.map((o, i) => `  shore += ${(lite ? LITE_TAPS : MIRROR_TAPS).land.weights[i]} * shoreAt(sc, max(es + ${(o * MIRROR.spread).toFixed(3)} * dE, 0.0));`).join('\n')}
  return base * (1.0 - shore.a * landK) + shore.rgb * landK;
}
// --- M5e: the storm's terms on the water (v1's src/weather/uniforms.js waterRain, frontBand, waterSky), off at F.storm.x = 0 ---
const DX = ${Math.sin(70 * Math.PI / 180).toFixed(6)}; const DZ = ${(-Math.cos(70 * Math.PI / 180)).toFixed(6)};   // the cell's drift (stormArc.js DIR)
fn hash2w(q: vec2f) -> f32 { return fract(sin(dot(q, vec2f(127.1, 311.7))) * 43758.5453); }
// storm round 4: Worley's F2 − F1 at p (cell units): 0 on the cells' borders (the foam's web), larger inside (its dark holes)
fn worleyEdgeW(p: vec2f) -> f32 {
  let i = floor(p); let f = p - i; var d1 = 9.0; var d2 = 9.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let g = vec2f(f32(x), f32(y)); let c = i + g;
    let o = vec2f(hash2w(c), hash2w(c + vec2f(17.3, 41.9)));
    let d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  } }
  return d2 - d1;
}
// the rain's rings: each cell holds one drop every ≈ 0.9 s (its own phase), an expanding ring 0–0.35 m that fades as it grows; a slope
fn ringsAt(p: vec2f, t: f32, cellM: f32, salt: f32) -> vec2f {
  let g = p / cellM + salt; let id = floor(g); let f = fract(g) - 0.5;
  let h = hash2w(id + salt * 7.3); let h2 = hash2w(id + salt * 3.1 + 11.0);
  let ph = fract(t * 1.1 + h);
  let c = vec2f(h - 0.5, h2 - 0.5) * 0.5;
  let d = f - c; let r = length(d) * cellM;
  let R = ph * 0.35;
  let x = (r - R) * 40.0;
  let prof = cos(x * 3.0) * exp(-x * x) * (1.0 - ph) * (1.0 - ph);
  return d / max(length(d), 1e-4) * (prof * 0.07);
}
// the outflow line on the water (stormWind.js's ragged edge): 1 on the band, 0.4 behind it, 0 ahead
fn frontBand(xz: vec2f) -> f32 {
  let d0 = xz - F.front.xy;
  let a = d0.x * DX + d0.y * DZ; let c = -d0.x * DZ + d0.y * DX;
  let dx = a - F.front.z + sin(c / 310.0 + 1.3) * 60.0 + sin(c / 130.0 - 0.4) * 35.0;
  let edge = exp(-(dx / 130.0) * (dx / 130.0));
  let behind = (1.0 - smoothstep(-40.0, 80.0, dx)) * 0.4;
  return max(edge, behind) * F.front.w;
}
// the rain and the line in the slope and the roughness: rings only where a ring spans many pixels (the near water), a matte hiss far, the band rough and dark
fn stormSlope(rest: vec2f, footprint: f32) -> vec3f {
  if (F.storm.x < 0.5) { return vec3f(0.0); }
  let near = 1.0 - smoothstep(0.008, 0.025, footprint);
  let sl = (ringsAt(rest, F.bow.w, 0.6, 0.0) + ringsAt(rest, F.bow.w + 0.47, 0.75, 0.37)) * near * F.rain.x;
  return vec3f(sl, F.rain.x * 0.05 * (1.0 - near * 0.5) + frontBand(rest) * 0.07);
}
// the mirror under the storm: a dark grey lid (the sky's LUT and the key are the fair sky's; the cell's dark base is overhead)
fn stormSky(sky: vec3f) -> vec3f {
  if (F.storm.x < 0.5) { return sky; }
  let l = dot(sky, vec3f(0.2126, 0.7152, 0.0722));
  // v1's lid (luminance × cool grey × 0.42, 0.85 of the way at full dark), eased in by sqrt(dark): v1's mirror reflects its own
  // per-pixel cell deck, which covers the sky over the eye well before the dark peaks; v2's mirror reads the fair sky's probe
  return mix(sky, vec3f(l) * vec3f(0.82, 0.9, 1.0) * 0.42, sqrt(F.storm.z) * 0.85);
}
// v1's approach (2026-11-18: the water stays real, just some colour change): under the storm's overcast the light that
// comes up out of the water is the grey overcast's, not the fair sky's blue: the body's colour toward its luminance in a cool
// grey by sqrt(dark), inside the water's own shading (its mirror, glint, foam and veil untouched); identity with no storm
fn stormSlate(c: vec3f) -> vec3f {
  if (F.storm.x < 0.5) { return c; }
  return mix(c, vec3f(dot(c, vec3f(0.2126, 0.7152, 0.0722))) * vec3f(0.85, 0.93, 1.05), sqrt(F.storm.z));
}
// #18: the storm's water term (v2 sky doc § The storm's water, undersides, shelf and curtains): the deck seals the sun's disc
// for the glint as it does in the sky (v1's cloudSeal: under 1.5 % of the light through the deck, none); 1 with no storm
fn stormGlint(s: vec3f) -> f32 {
  if (F.storm.x < 0.5) { return 1.0; }
  // r2: v1's low-sun rule (its shadowAt casts a low sun as if 15 degrees up, the 2026-11-05 ruling): the deck's light
  // toward the sun is read at least 15 degrees up, so a dusk sun under the deck's base stays behind the cell
  let T = cloudAt(normalize(vec3f(s.x, max(s.y, 0.268 * length(s.xz)), s.z))).a;
  return T * mix(1.0, smoothstep(0.015, 0.05, T), F.cell.w);
}
const SHORE = ${SHORE_SOFT_M};   // m of water over the bed in which the surface fades in (the soft shore)
const DEEP0 = ${DEEP_M[0].toFixed(1)}; const DEEP1 = ${DEEP_M[1].toFixed(1)};   // the water's own body takes over from the bed between these depths
${WATER_WGSL}
struct WV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) uv0: vec2f${lite ? ', @location(2) ground: f32' : ''}, @location(3) gain: vec4f, @location(4) damp: vec2f, @location(5) hole: f32, @location(6) boost: vec2f, @location(7) shv: vec4f${detail && !lite ? ', @location(8) vg: vec4f' : ''} }   // #56 M3: shv.x the sea's Hs before the depth's calm where the shore field is (0 elsewhere)   // perf(v2) phone: the lite water's ground height per vertex; #56 M1: the 85 and 12 m tiles' slope gains (v1's BAY_SLOPE)
fn offsetOf(i: i32) -> f32 { return sign(f32(i)) * F.grid.z * (exp(F.grid.w * abs(f32(i))) - 1.0); }
fn cellOf(i: i32) -> f32 { return F.grid.z * F.grid.w * exp(F.grid.w * abs(f32(i))); }
${WARP_WGSL}
// the mesh's centre: the eye snapped to the first cell (M3: F.grid.xy is the readback window's centre, the boat's)
const S0 = ${(GRID.a * (Math.exp(GRID.b) - 1)).toFixed(9)};
@vertex fn vs(@builtin(vertex_index) vi: u32) -> WV {
  let ix = i32(vi % SIDE) - K; let iz = i32(vi / SIDE) - K;
  let cx = floor(F.cam.x / S0) * S0; let cz = floor(F.cam.z / S0) * S0;
  let x0 = cx + offsetOf(ix); let z0 = cz + offsetOf(iz);
  let cell = max(cellOf(ix), cellOf(iz));
  var p = vec3f(x0, 0.0, z0);
  // #21, #25: v1's per-point sea, each cascade's gain: the depth's calm (the swell under 14 m, the chop under 2 m) × the sea's
  // size here against the boat's own (the fetch map; 1 at the boat); the fragment's slopes take the same gains
  ${lite ? 'let gd = terrainHeight(x0, z0);' : ''}
  var dmp = vec2f(1.0); var gn = vec4f(1.0); var shr = SU.share.xyz;   // #56 M1: the bay's share of each tile (the boat's without the map)
  if (SF.map.w < 0.5) {   // the A/B's off switch (seaField.off): the old water, no depth read
    ${lite ? '' : 'let gd = terrainHeight(x0, z0);'}
    dmp = seaDamp(-gd); gn = seaGainsShare(x0, z0, dmp, &shr);
  }
  let w = warpOf(x0, z0);
  for (var c = 0u; c < CPU_C; c++) {   // the displacement cascades (the 2.1 m layer moves millimetres: slopes only)
    let L = F.water[c];
    var xz = vec2f(x0, z0); if (c > 0u) { xz += w; }
    let lod = log2(max(cell / (L / 256.0), 1.0));
    p += textureSampleLevel(tDisp, sRep, xz / L, i32(c), lod).xyz * gn[c];
  }
  // #56 M3: the shore (render/shore.js): over the bed the trains' displacement (faded where a cell outgrows the wave: the
  // fragment's slopes carry it there); over the sand the swash's film, the vertex lifted onto the beach so the film and the
  // wet sand draw over it (eps over the ground for the depth test, growing with the cell)
  var shv = vec4f(0.0);
  if (shOn()) {
    let gS = ${lite ? 'gd' : 'terrainHeight(x0, z0)'};
    if (gS > -SH_DIN && gS < SH_LAND) {
      let tx = shoreTex(vec2f(x0, z0));
      if (tx.fade > 0.0) {
        let hsU = shoreHs(x0, z0);
        shv.x = max(hsU, 1e-4);
        if (gS < 0.0) {
          let sw = shoreWaves(vec2f(x0, z0), -gS, hsU, F.cam.w, tx);
          let lam = 2.0 * PI / max(sw.k0, 1e-3);
          p += sw.disp * (1.0 - smoothstep(0.12 * lam, 0.35 * lam, cell));
        } else {
          let s = swashAt(vec2f(x0, z0), gS, hsU, F.cam.w, tx);
          if (gS < max(1.6 * s.w, 0.03)) { p.y = max(p.y, gS + s.x + 0.02 + 0.012 * cell); shv.y = 1.0; }
        }
      }
    }
  }
  var o: WV; o.pos = F.viewProj * vec4f(p, 1.0); o.world = p; o.uv0 = vec2f(x0, z0); o.shv = shv;
  ${detail && !lite ? 'o.vg = w2Gain(vec2f(x0, z0));   // waterDetail: the variation layer per vertex (its noise is 123 m and longer: interpolated, it is the same)' : ''}
  o.gain = gn; o.damp = dmp;
  o.boost = select(vec2f(1.0), vec2f(slopeBoost(shr.y, SU.reach.z), slopeBoost(shr.z, SU.reach.w)), suOn(${SURF_BITS.boost}u));   // #56 M1: v1 draws the bay's slopes × 2
  // fix(v2) frame look: does the straight view ray through this vertex reach the floor cut (DEEP1 under the surface) without
  // meeting the bed? The scene is rasterised without refraction, so a grazing ray over a shallow sill shows the bed far
  // beyond, where the terrain draws no node (wholly under 60 m): there the water must be its own opaque body, or the
  // cleared background showed through (the black band across Emerald Bay's mouth from cam E). The ray is tested at depths
  // DEEP1 / 16, / 8, / 4, / 2, 3/4 and all of it (six height reads); hole = the share it passes the cut clear. Only where it
  // can matter: water over a bed shallower than DEEP1 seen at a grazing angle (the ray runs 3 × further than it sinks); over
  // the deep lake the body is opaque anyway, and over land or a steep view the bed below is the one drawn (one read)
  { let toE = F.cam.xyz - p; let hz = max(length(toE.xz), 1e-3); let dirH = -toE.xz / hz; let k = hz / max(toE.y, 0.05);
    var clear = 0.0;
    let d0 = -${lite ? 'gd' : 'terrainHeight(x0, z0)'};   // the lite water has read it already
    if (d0 > 0.0 && d0 < DEEP1 && k > 3.0) {
      clear = 1.0;
      var dd = array<f32, 6>(0.0625, 0.125, 0.25, 0.5, 0.75, 1.0);
      for (var j = 0; j < 6; j++) { let dj = DEEP1 * dd[j]; let q = vec2f(x0, z0) + dirH * min(dj * k, 4000.0);
        let g = terrainHeight(q.x, q.y); clear *= smoothstep(-6.0, 0.0, -(g + dj)); }   // the bed under the ray there (g < −dj) keeps it clear
    }
    o.hole = clear; }
  ${lite ? 'o.ground = gd;   // perf(v2) phone: the lite water reads the ground once a vertex, interpolated (the full water: once a pixel)' : ''}
  return o;
}
// the sun's glint: a Beckmann highlight over the slope distribution (v1's; its tails fall off exponentially, where GGX's
// long tails washed the whole sea round the path), s2 the total mean-square slope, Schlick on the half vector, capped
fn glintOf(n: vec3f, v: vec3f, l: vec3f, s2: f32) -> f32 {
  let h = normalize(v + l);
  let nh = max(dot(n, h), 1e-3); let nh2 = nh * nh; let nv = max(dot(n, v), 0.1); let vh = max(dot(v, h), 0.0);
  let d = exp(-(1.0 - nh2) / (nh2 * s2)) / (PI * s2 * nh2 * nh2);
  let f = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
  return min(d * f * 0.25 / nv, 40.0);
}
@fragment fn fs(v: WV) -> @location(0) vec4f {
  // K2: knocked down, no water inside the hull or the cockpit (render/hullMask.js; off upright): the premultiplied output × 0 there.
  // A multiply, not a discard: a discard in this stage moved the goldens' pixels (the compiler's code for the whole stage changed)
  let hullK = select(1.0, 0.0, wakeInHull(v.world));
  let toEye = F.cam.xyz - v.world; let dist = length(toEye); let V = toEye / max(dist, 1e-3);
  let w = warpOf(v.uv0.x, v.uv0.y);
  // the pixel's footprint on the water (its major axis, m): the anisotropic sample's level follows the minor axis (the
  // detail), so the slope's spread is read again at the level whose texel covers the whole footprint (water-aa.js)
  let xzw = v.uv0 + w;
  let fp = sqrt(max(max(dot(dpdx(xzw), dpdx(xzw)), dot(dpdy(xzw), dpdy(xzw))), 1e-12));
  // wake: the boat's maps here, and the slick's calm on the short cascades' ripples (v1's wakeCalm)
  let wk = wakeAt(v.uv0, fp);
  let calm = 1.0 - wakeSlick(v.uv0, wk.rough, F.cam.w) * WAKE_CALM;
  // the ground under the pixel (the soft shore's depth below; #56 M3: the shore's band)
  let gP = ${lite ? 'v.ground' : 'terrainHeight(v.uv0.x, v.uv0.y)'};
  // #56 M3: the shore here: the trains over the bed, the swash over the sand (none off the band or with no shore in view)
  var shAct = false; var shW: ShW; var shS = vec4f(0.0);
  if (shOn() && v.shv.x > 0.0 && gP > -SH_DIN && gP < SH_LAND) {
    let shTx = shoreTex(v.uv0);
    if (shTx.fade > 0.0) {
      shAct = true;
      if (gP < 0.0) { shW = shoreWaves(v.uv0, -gP, v.shv.x, F.cam.w, shTx); } else { shS = swashAt(v.uv0, gP, v.shv.x, F.cam.w, shTx); }
    }
  }
  // --- the wind on the water (render/windWater.js, audit W1–W3): the local wind, the lanes, the gust patch ---
  let wl = windLocal(v.world.xz); let wv = wl.xy; let localU = length(wv); let aroundU = wl.z;
  let fpV = v1Footprint(toEye);
  var lane = 0.0;   // W3: v1's wind lanes as drawn (signed: rough lanes, smooth slicks), along the local wind
  if (wfxOn(${BITS.lanes}u) && localU > ${STREAK_ONSET[0]}.0) { let lv = laneVisAt(v.uv0, toEye, fpV); if (lv > 0.0) { lane = spLane(v.uv0, localU, atan2(wv.y, wv.x), F.cam.w) * lv; } }
  var gustW = 0.0;   // W1: the gust look's weight
  if (wfxOn(${BITS.gust}u)) { gustW = gustWeight(v.world.xz, wv, localU, aroundU); }
  gustW = clamp(gustW + max(lane, 0.0) * ${LANE.dark}, 0.0, 1.0);   // a lane darkens like a gust
  let laneRip = 1.0 + lane * ${LANE.rip};
  let rr = select(1.0, ripRel(localU), wfxOn(${BITS.gust}u));   // the short cascades follow the local wind
  var sl = vec2f(0.0); var slC = vec2f(0.0); var vr = vec2f(0.0); var jac = 1.0;
  var jacL = 1.0;   // the folds of the 600 and 85 m tiles alone (the whitecaps read the 12 m tile's through foldCells)
  var gn = v.gain;
  let on = SU.hs.w > 0.5;   // #56 M1 (?m1=0, water.m1 = false: the water before)
  // the displacement tiles first: the folds (the foam) and, #56 M1, the long waves' height here (v1's eta, the MTF's and the crest's)
  var eta = 0.0;
  for (var c = 0u; c < CPU_C; c++) {
    let L = F.water[c];
    var xz = v.uv0; if (c > 0u) { xz += w; }
    let d4 = textureSample(tDisp, sRep, xz / L, i32(c));
    let jc = mix(1.0, d4.w, select(v.damp.y, v.damp.x, c == 0u));   // v1: the folds fade with the depth's calm
    jac = min(jac, jc); if (c < 2u) { jacL = min(jacL, jc); }
    eta += d4.y * gn[c];
  }
  let hsLoc = length(SU.hs.xyz * gn.xyz);   // the sea's Hs here (each tile's at the boat × its gain here)
  let mtf = select(1.0, mtfMod(eta, hsLoc), suOn(${SURF_BITS.mtf}u));   // #56 M1 (v1's MTF): the short waves pile on the long waves' crests
  // #56 M1: v1's slope gain on the 85 and 12 m tiles where the pixel resolves their waves (SURF.boostReach)
  let bst = vec2f(mix(1.0, v.boost.x, 1.0 - smoothstep(0.5 * SU.reach.x, SU.reach.x, fp)), mix(1.0, v.boost.y, 1.0 - smoothstep(0.5 * SU.reach.y, SU.reach.y, fp)));
  ${detail && !lite ? 'let vg = v.vg;   // waterDetail (features.js waterDetail): each cascade\'s slope gain from an aperiodic noise' : ''}
  for (var c = 0u; c < C; c++) {
    let L = F.water[c];
    var xz = v.uv0; if (c > 0u) { xz += w; }
    ${detail && !lite ? `if (c == 3u) { xz = W2_ROT * xz + vec2f(0.37, 1.13); }   // waterDetail: the 2.1 m layer turned off the other tiles' lattice
    var s4 = textureSample(tSlope, sRep, xz / L, i32(c));
    var m4 = textureSampleLevel(tSlope, sRep, xz / L, i32(c), footprintLod(fp, L));
    if (c == 3u) { s4 = w2Back(s4); m4 = w2Back(m4); }
    s4 = vec4f(s4.xy * vg[c], s4.zw * vg[c] * vg[c]); m4 = vec4f(m4.xy * vg[c], m4.zw * vg[c] * vg[c]);` : `let s4 = textureSample(tSlope, sRep, xz / L, i32(c));                               // the mean slope
    let m4 = textureSampleLevel(tSlope, sRep, xz / L, i32(c), footprintLod(fp, L));    // the moments over the footprint`}
    // wake: 1 outside the slick; #21, #25: the cascade's gain here; #56 M1: v1's slope gain on the 85 and 12 m tiles, its MTF on the 12 and 2.1 m
    let g0 = wakeGain(c, calm) * gn[c] * select(1.0, mtf, c >= 2u) * mix(1.0, rr * laneRip, WIND_RESP[min(c, 3u)]);   // W1, W3: the local wind and the lanes
    let gk = g0 * select(select(1.0, bst.y, c == 2u), bst.x, c == 1u);
    let gm = select(g0, gk, suOn(${SURF_BITS.boostMirror}u));   // the mirror's mean ray: the gain too only with its own bit
    sl += s4.xy * gk; slC += m4.xy * gm; vr += max(m4.zw - m4.xy * m4.xy, vec2f(0.0)) * gk * gk;
  }
  let st = stormSlope(v.uv0, fp);   // M5e: the rain's rings (near), its hiss and the outflow's band (roughness)
  sl += st.xy;
  sl += wk.slope; slC += wk.slope;   // wake: the Kelvin crests bend the normal, the mirror's ray with it (v1's)
  // #56 M3: the shore trains' slopes where the pixel resolves their wave; past it their slope is roughness (steady, no flicker)
  var shV = 0.0;
  if (shAct && shW.a0 > 0.0) {
    let lam = 2.0 * PI / max(shW.k0, 1e-3); let rs = 1.0 - smoothstep(0.15 * lam, 0.5 * lam, fp);
    sl += shW.slope * rs; slC += shW.slope * rs; shV = 0.5 * dot(shW.slope, shW.slope) * (1.0 - rs);
  }
  // W1: the gust's fine ripples (v1's D1: 13 and 8.3 cm, crossed, along the local wind, slope² 0.04 at full weight), as
  // roughness only (lostG, the rough Fresnel: a patch mirrors less and reads darker). v1 also bends the near normal with the
  // two cosines; on v2's smoother short cascades they drew a regular glinting lattice over the near water (v1's own note:
  // "the two fixed cosines made the regular stipple"), so they stay unresolved here (steady, never a flicker)
  var lostG = 0.0;
  if (gustW > 0.0) { let gs = sqrt(gustW * ${GUST_LOOK.slope2} * gustFine(v.uv0)) * calm * laneRip; lostG = gs * gs; }
  let n = normalize(vec3f(-sl.x, 1.0, -sl.y));
  // the unresolved slope variance: the footprint's (the mips) + the screen-space spread + a floor under the finest ripple
  // W3: the lanes roughen
  let sigma2 = 0.5 * (vr.x + vr.y) + screenVariance(dpdx(sl), dpdy(sl)) + AA_FLOOR + st.z + max(lane, 0.0) * ${LANE.slope2} + shV;
  let nv = max(dot(n, V), 1e-3);
  // Schlick, averaged over the facets the pixel cannot resolve (v1's rough Fresnel); #56 M1: × v1's Smith masking (the steeper
  // slopes' facets hide each other at grazing: the light goes to the next wave and the body, so troughs read dark)
  var fres = roughFresnel(nv, sigma2 + lostG) * select(1.0, smithMask(nv, 2.0 * sigma2), suOn(${SURF_BITS.mask}u)) * (1.0 - gustW * ${GUST_FX.fres});   // W1: a gust patch mirrors less
  // the starlit night's Fresnel floor (v1's NIGHT_F0): 0 with the sun above e0, all of it under e1
  let nk = clamp((asin(clamp(normalize(F.sun.xyz).y, -1.0, 1.0)) * 57.29578 - ${NIGHT_WATER.e0.toFixed(1)}) / ${(NIGHT_WATER.e1 - NIGHT_WATER.e0).toFixed(1)}, 0.0, 1.0);
  let nightF0 = ${NIGHT_WATER.f0.toFixed(3)} * nk * nk * (3.0 - 2.0 * nk);
  if (nightF0 > 0.0) { fres = fres + nightF0 * (1.0 - fres); }
  // the water over the bed here: the surface fades in over the first SHORE metres, so the shoreline is soft and the
  // waves' rise and fall moves it (the bed's own colour through the water column is the terrain pass's)
  let depth = v.world.y - gP;
  let soft = smoothstep(0.0, SHORE, depth);
  // the mirror's ray off the footprint's mean normal (its facets' spread is in the roughness, not in the ray: a ray off
  // the pixel's own normal re-rolled the mirror every frame; the glint keeps the pixel's normal, so the path glitters),
  // lifted by the roughness: a rough patch's lobe straddles the horizon and the half below it sees water, not sky, so
  // its mean reflection is the sky a little above the horizon (bluer and darker than the band at it)
  // #56 M1: where the footprint resolves the ripples (near the eye) the ray follows the pixel's own normal (v1's per-wave
  // mirror: dark troughs, bright faces); past SU_NEAR1 the footprint's mean, as before
  // (a facet tilted so far that its own ray dips under the horizon keeps the mean ray: the floor below would read the far
  // shore's waterline, a sand-coloured fleck, where the facet really sees the next wave)
  let nPix = vec3f(-sl.x, 1.0, -sl.y);
  let wPix = select(0.0, (1.0 - smoothstep(SU_NEAR0, SU_NEAR1, fp)) * smoothstep(0.02, 0.08, reflect(-V, normalize(nPix)).y), suOn(${SURF_BITS.near}u));
  let nC = normalize(mix(vec3f(-slC.x, 1.0, -slC.y), nPix, wPix));
  // M5d: the lift only within the horizon band (it fades to nothing by 3√σ² of elevation): above it the lobe clears the
  // horizon and a lifted ray missed the land a true mirror shows (the bay's walls stood 8° too low in the mirror at
  // cam I). Measured on the flicker metric against main at the same poses: with it 7.87 / 1.87 % and 16.6 / 3.38 %
  // (13:00 and 18:45, 1280 × 720), without it 9.0 / 2.78 % and 17.2 / 3.72 %
  var R = reflect(-V, nC);
  let sp = sqrt(sigma2);
  R = normalize(vec3f(R.x, max(R.y + 1.5 * sp * (1.0 - smoothstep(0.0, 3.0 * sp, R.y)), 0.015), R.z));
  // the sky, M5a's deck and the land (terrain.js REFLECT) in the mirror, averaged over the facets' spread in elevation
  // (a slope's tilt doubles in the mirror: 2√σ²); a rough sea scatters the land: past a slope variance of 0.004 its
  // share fades to 60 %, the sky between the facets
  // #41c: the shore's ray off the footprint's normal with its slope damped (MIRROR.damp, as v1's reflections damp the
  // waves' bend): a pier or a boathouse mirrors as one soft, steady shape that sways with the swell, never broken into
  // flecks that re-roll every frame
  let Rs0 = reflect(-V, normalize(vec3f(-slC.x * ${MIRROR.damp.toFixed(3)}, 1.0, -slC.y * ${MIRROR.damp.toFixed(3)})));
  let Rs = normalize(vec3f(Rs0.x, max(Rs0.y, 0.015), Rs0.z));
  var skyR = stormSky(mirrorBlur(R, 2.0 * sqrt(sigma2), mix(1.0, 0.6, smoothstep(0.004, 0.03, sigma2)), Rs));
  if (gustW > 0.0) { skyR = gustSky(skyR, gustW, skyRadiance(normalize(vec3f(R.x, ${GUST_FX.skyUp}, R.z)))); }   // W1: a patch's facets see the open sky above
  // the light on the surface (the foam's): the sky's irradiance (four 45° samples × π) and the sun's
  let eSky = LIGHT.sky.rgb; let eSun = LIGHT.sun.rgb; let eSkyB = eSky + vec3f(0.86, 0.92, 1.0) * dot(eSky, vec3f(0.2126, 0.7152, 0.0722)) * ((select(STORM_BODY, STORM_BODY_V1, F.look.x > 0.0) - 1.0) * F.storm.x * F.storm.z);   // the frame's light, once (the aerial pass); #18: the body's sky light under the storm's dark. v1's approach (2026-11-18): the overcast's extra light is grey, as the boat's (render/boat.js STORM_BOAT_SKY), not the fair sky's blue × 15 (that read a saturated blue lake under a storm sky)
  let s = normalize(F.sun.xyz);
  let rCam = Rg + F.sky.z;
  let sunPerp = F.sky.x * transAt(rCam, s.y) * step(0.0, raySphere(vec3f(0.0, rCam, 0.0), s, Rg) * -1.0) * F.storm.y;   // M5e: the cell's shade on the glint
  // the glint over a lobe never narrower than half the clean sea's for the wind (a glitter path stays broad from the
  // sub-pixel ripples), rolled off softly toward 4 × the sky's luminance round the sun: no facet blows a pixel to white
  // #56 M1: Ultra's GGX lobe and Smith term over the same slope variance, its facet glitter with the twinkle smoothed
  // (render/water-surface.js); ?m1=0 v1's Beckmann lobe
  let fwv = fwidth(v.uv0); let fwUV = max(fwv.x, fwv.y); let fgx = dpdx(v.uv0); let fgy = dpdy(v.uv0);   // outside the branches below
  var glintL = 0.0;
  if (suOn(${SURF_BITS.glint}u)) {
    let gg = glintGGX(n, V, s, glintSigma2(sigma2, F.wind.x)); glintL = gg.x;
    ${lite ? '// the lite water (L2, L3): no glitter (its cells are under a pixel at the phone\'s 0.6 Mpx)' : 'if (glintL > 0.01 && suOn(' + SURF_BITS.glitter + 'u)) { glintL *= mix(1.0, glitter(v.uv0, fwUV, gg.y, gg.z, gg.w, F.cam.w), SU_GLITTER * smoothstep(SU_GN0, SU_GN1, dist)); }'}
  } else { glintL = glintOf(n, V, s, glintSigma2(sigma2, F.wind.x)); }
  var glint = rollOff(sunPerp * glintL, AA_CAP_MUL * dot(skyRadiance(s), LUMA)) * stormGlint(s) * (1.0 - gustW * ${GUST_FX.glint});   // #18: sealed by the deck; W1: a patch's rough facets scatter the glitter
  // the moon's glitter path (look/v2-night-look): the sun's lobe off the moon, each facet cell on its own clock (the glint's
  // glitter, weighted MOON_GLINT.glitter: a broken path of sparkles, not a stripe); only with the moon up at night (a uniform
  // branch: no cost by day); its light the moon's share × MOON_GLINT.k, sealed by the deck and the storm as the sun's
  if (F.moon.y > 0.0 && F.night.x > 0.0) {
    let mDir = normalize(F.moon.xyz);
    let mPerp = ${MOON_GLINT.k.toFixed(4)} * moonShare() * transAt(rCam, mDir.y) * F.storm.y;
    let gm4 = glintGGX(n, V, mDir, 2.0 * sigma2 * ${MOON_GLINT.lobe.toFixed(2)}); var mL = gm4.x;   // the pixel's own slopes, no wide floor: each wave face catches the moon or not
    ${lite ? '' : `if (mL > 0.01) { let gq = glitter(v.uv0 + 3.7, fwUV, gm4.y, gm4.z, gm4.w, F.cam.w); mL *= mix(1.0, gq * gq, ${MOON_GLINT.glitter.toFixed(3)} * smoothstep(SU_GN0, SU_GN1, dist)); }   // squared: the far path a scatter of sparkles, each cell on its own clock`}
    glint += rollOff(vec3f(${MOON_GLINT.colour.map((c) => c.toFixed(3)).join(', ')}) * (mPerp * mL), ${MOON_GLINT.cap.toFixed(4)}) * stormGlint(mDir) * (1.0 - gustW * ${GUST_FX.glint});
  }
  // premultiplied over the bed (the terrain pass drew it through the water): the surface reflects F of the sky and
  // passes 1 − F of what is below; foam covers both; the air's transmittance and in-scatter (the aerial perspective)
  // apply to what the surface adds and, through the alpha, to the bed's share it lets through
  // wake: the strip as the eye sees it and the bow wave's roll (v1's: at most 0.95 and 0.85), over the whitecaps' foam
  let wakeF = max(min(wakeFoamVisible(v.uv0, wk.foam, F.cam.w, smoothstep(0.01, 0.12, length(sl)), fp), 0.95), min(wk.roll, 0.85));
  var capF = (1.0 - smoothstep(${FOAM.full}, ${FOAM.onset}, jac)) *   /* Safari: edges ordered (low < high), the phone pass */ smoothstep(${FOAM.windLo}.0, ${FOAM.windHi}.0, F.wind.x) * ${FOAM.cover};
  var capCol = vec3f(0.55) * (eSky + eSun) / PI;
  // #56 M1: Ultra's whitecap foam (render/water-surface.js capCover) on v1's coverage: the fold's depth under J0 (the turbulence's
  // quantile at Monahan's share for the wind, SU.share.w) is the density, the baked pattern eroded by it (young foam solid,
  // ageing foam thinning to lace as the turbulence recovers), v1's wind onset the share drawn; the billows' bump and crease
  // shade, thin foam tinted by the water under it, the sun through thin foam, a sheen on the bubble tops
  if (suOn(${SURF_BITS.foam}u)) {
    capF = 0.0;
    // audit W2: the onset on the LOCAL wind (v1's whitecaps gate on it: gusts cap, lees do not); off (the A/B): the frame's wind
    // storm round 2 (2026-11-18): under the outflow the whitecaps and the spume read the storm's wind (STORM_WATER.foam: the local
    // wind × (1 + foam × the outflow's strength)), so they start at the storm's ~10 m/s, not only past 12, and fade as it clears
    let foamU = localU * (1.0 + STORM_FOAM * F.front.w * F.storm.x);
    var windF = smoothstep(SU_ON0, SU_ON1, select(F.wind.x, foamU, wfxOn(${BITS.caps}u)));
    // the 12 m tile's fold through world cells (render/water-surface.js foldCells; under the onset, no tap): its copies no
    // longer fold in step on a 12 m lattice (white dots flashing together at dusk, 2026-11-15)
    var dens = 0.0;
    var fmFilm = 0.0;   // waterDetail: the remembered foam's thin film (web-ocean's translucent margin), over the eroded caps
    if (windF > 0.0) {
      let fc = foldCells(v.uv0 + w, F.water[2], 2, fgx, fgy, v.damp.y, F.cam.w);   // the cell's weight on the density: the foam erodes as it closes
      dens = max(clamp((SU.share.w - jacL) / SU_FSPAN, 0.0, 1.0), clamp((SU.share.w - fc.x) / SU_FSPAN, 0.0, 1.0) * fc.y);
      ${detail && !lite ? `// waterDetail, fix 2 (web-ocean's foam map, MIT): the caps' foam remembered where it broke, fading over seconds, drifting
      // downwind; aged foam (no freshness left) broken into wind-aligned streaks, fresh foam dense (its read); never more than
      // the density's own ceiling, so the caps' share and their shading stay v2's; the depth's calm as the caps'
      let fm = fmAt(v.uv0);
      if (fm.x > 0.002) {
        let wd = vec2f(cos(F.wind.y), sin(F.wind.y));
        let su = vec2f(dot(v.uv0, wd), dot(v.uv0, vec2f(-wd.y, wd.x))) * FM_STREAK;
        let sgx = vec2f(dot(fgx, wd), dot(fgx, vec2f(-wd.y, wd.x))) * FM_STREAK; let sgy = vec2f(dot(fgy, wd), dot(fgy, vec2f(-wd.y, wd.x))) * FM_STREAK;
        let st = textureSampleGrad(tSlope, sRep, su, FOAM_LAYER, sgx, sgy).r;
        let freshK = clamp(fm.y * 2.0, 0.0, 1.0);
        let aged = clamp(fm.x * FM_GAIN, 0.0, 1.0) * mix(smoothstep(0.25, 0.75, st) * 1.2, 1.0, freshK);
        dens = max(dens, aged * v.damp.y);
        fmFilm = aged * v.damp.y * (1.0 - freshK) * FM_FILM;
      }` : ''}
    }
    // storm round 4 (2026-11-18, the NOAA Beaufort 6 and 7 plates): the storm's foam is a persistent field, not flakes. The long
    // tiles' turbulence (jacL: the 600 and 85 m waves' Jacobian with Ultra's memory, render/water.js ASSEMBLE: it follows a fold
    // down at once and recovers at SURF.foamRec / s) is the foam's age where a big breaker collapsed: fresh, a bright core;
    // ageing, a marbled web (the baked Voronoi lace at two large scales, thresholded higher as it ages: thin foam lines round
    // dark holes) that dissolves over seconds. It sits in the surface's rest frame (v.uv0), so it rides with the water. Far
    // (the web past STORM_WATER.marbleFar m a pixel) it turns into an even sheen of its own mean (the mips, no flicker). The
    // short (12 m) folds stay the whitecaps: fewer, on the big crests only. 0 with no storm
    let skB = F.storm.x * F.front.w;
    var mF = 0.0; var mCol = vec3f(0.0);
    if (skB > 0.0) {
      dens *= mix(1.0, ${STORM_WATER.capKeep.toFixed(2)} * smoothstep(0.1, 0.7, eta / max(hsLoc, 0.05)), skB);
      let age = 1.0 - smoothstep(${STORM_WATER.ageJ[0].toFixed(2)}, ${STORM_WATER.ageJ[1].toFixed(2)}, jacL);
      if (age > 0.0) {
        // the marbling: a Worley cell network (F2 − F1: thin lines round dark holes) at two scales, its cells warped by the baked lace
        // so no line is straight; the lines thick while fresh (the patch nearly filled), thinning to a fine web as it ages
        let mk0 = ${STORM_WATER.marble[0].toFixed(4)};
        let warp = (textureSampleGrad(tSlope, sRep, v.uv0 * mk0 + 0.31, FOAM_LAYER, fgx * mk0, fgy * mk0).rg - 0.5) * ${STORM_WATER.warp.toFixed(2)};
        let e0 = worleyEdgeW(v.uv0 / ${STORM_WATER.cellM[0].toFixed(1)} + warp);
        let e1 = worleyEdgeW(v.uv0 / ${STORM_WATER.cellM[1].toFixed(1)} + warp * 1.7 + 7.3);
        let wid = mix(${STORM_WATER.lineW[0].toFixed(3)}, ${STORM_WATER.lineW[1].toFixed(3)}, age);   // the line's half width, cell units: old → fresh
        let px0 = fp / ${STORM_WATER.cellM[0].toFixed(1)}; let px1 = fp / ${STORM_WATER.cellM[1].toFixed(1)};   // a pixel in cell units (the lines' AA)
        let lines = max(1.0 - smoothstep(wid, wid + px0 + 0.02, e0), (1.0 - smoothstep(wid * 0.7, wid * 0.7 + px1 + 0.02, e1)) * 0.5);
        let core = smoothstep(${STORM_WATER.core[0].toFixed(2)}, ${STORM_WATER.core[1].toFixed(2)}, age);
        var cov = max(lines, core) * smoothstep(0.0, 0.12, age);
        let farK = smoothstep(${STORM_WATER.marbleFar[0].toFixed(2)}, ${STORM_WATER.marbleFar[1].toFixed(2)}, fp);
        cov = mix(cov, age * ${STORM_WATER.sheen.toFixed(2)}, farK);
        mF = cov * skB * mix(${STORM_WATER.webA.toFixed(2)}, ${STORM_WATER.coreA.toFixed(2)}, core);
        mCol = stormMurkColour() * mix(${STORM_WATER.webLit.toFixed(2)}, ${STORM_WATER.capLit.toFixed(2)}, core) * mix(1.0, 0.85, farK);
      }
    }
    if (dens > 0.0 && windF > 0.0) {
      let t0 = textureSampleGrad(tSlope, sRep, v.uv0 * SU_FS0, FOAM_LAYER, fgx * SU_FS0, fgy * SU_FS0);
      ${lite ? 'let pat = t0.r;   // the lite water: the pattern\'s fine tap only' : 'let pat = t0.r * SU_FM0 + textureSampleGrad(tSlope, sRep, v.uv0 * SU_FS1 + SU_FOFF, FOAM_LAYER, fgx * SU_FS1, fgy * SU_FS1).r * SU_FM1;'}
      let fh = t0.g; let fg = (t0.ba - 0.5) * 64.0 * SU_FS0;
      let fN = normalize(n - vec3f(fg.x, 0.0, fg.y) * (0.03 + 0.12 * dens));
      let ao = mix(0.45, 1.0, smoothstep(0.15, 0.75, fh));
      let solid = smoothstep(0.2, 0.9, dens * (0.55 + 0.7 * fh));
      let alb = mix(SU_FTINT, vec3f(0.95), max(solid, smoothstep(0.3, 0.9, pat) * 0.6));
      let lit = sunPerp * ((0.15 + 0.85 * clamp(dot(fN, s) * 0.8 + 0.2, 0.0, 1.0)) * mix(ao, 1.0, 0.4) + pow(clamp(dot(s, -V), 0.0, 1.0), 4.0) * 0.4 * (1.0 - solid)) + eSky * 1.1 * ao;
      capCol = (SU_FBRIGHT * alb * lit + sunPerp * pow(max(dot(fN, normalize(V + s)), 0.0), 90.0) * 0.5 * smoothstep(0.55, 0.85, fh) * solid) / PI;
      // storm round 4: the caps white as the overcast (STORM_WATER.capLit), never a glow (the bloom's knee stays above it)
      capCol = mix(capCol, stormMurkColour() * ${STORM_WATER.capLit.toFixed(2)} * mix(0.7, 1.0, solid), F.storm.x * F.storm.z);
      capF = foamCover(dens, pat) * mix(0.8, 1.0, solid) * windF * mix(1.0, SU_FFARK, smoothstep(SU_FFAR0, SU_FFAR1, fp));   // the far specks at half
      // v1's spume (render/spume.js): past 12 m/s of local wind the folds' foam streaks along the lanes, added to the caps
      // (v1's clamp(cap + spume, 0, 1)), the fold's depth as v1's breaking measure
      if (wfxOn(${BITS.caps}u)) { capF = min(capF + spumeOf(foamU, dens, lane), 1.0); }
      ${detail && !lite ? 'capF = max(capF, fmFilm * (0.55 + 0.45 * pat) * windF * mix(1.0, SU_FFARK, smoothstep(SU_FFAR0, SU_FFAR1, fp)));   // waterDetail: the film under the lace' : ''}
    }
    if (mF > 0.0) { let tot = 1.0 - (1.0 - capF) * (1.0 - mF); capCol = (capCol * capF + mCol * mF * (1.0 - capF)) / max(tot, 1e-4); capF = tot; }
    // (the storm's wind streaks, round 3, are removed (2026-11-18): thin foam lines drawn along the wind that shook frame to frame
    // on the storm water; the caps, the marbled patches and v1's spume stay)
    // #56 M3: the shore's white water in M1's foam (Ultra's, render/shore.js): the breakers' whitewater riding shoreward with the
    // bore (a two-phase flow map), the lace left in the surf zone drifting in, the swash's bore line and the waterline's edge;
    // the pattern and shading are the whitecaps', so all the lake's foam matches
    if (shAct) {
      var sCov = 0.0; var sPat = 0.0; var sFh = 0.5; var sFg = vec2f(0.0); var sDen = 0.0;
      let shF0 = clamp(shW.foam, 0.0, 1.0);
      if (shF0 > 0.0) {
        let vel = shW.dir * shW.w0 / max(shW.k0, 1e-3); let sc = 0.3;
        let f0 = fract(F.cam.w / 2.5); let f1 = fract(F.cam.w / 2.5 + 0.5); let wb = abs(2.0 * f0 - 1.0);
        let b0 = textureSampleGrad(tSlope, sRep, (v.uv0 - vel * (f0 * 2.5)) * sc, FOAM_LAYER, fgx * sc, fgy * sc);
        let b1 = textureSampleGrad(tSlope, sRep, (v.uv0 - vel * (f1 * 2.5)) * sc + 0.43, FOAM_LAYER, fgx * sc, fgy * sc);
        let sh_ = mix(b0.g, b1.g, wb);
        let pt = mix(b0.r, b1.r, wb) * 0.3 + sh_ * 0.45 + textureSampleGrad(tSlope, sRep, v.uv0 * 0.06 + 0.5, FOAM_LAYER, fgx * 0.06, fgy * 0.06).r * 0.25;
        sCov = smoothstep(1.0 - shF0 * 1.1, 1.2 - shF0 * 1.1, pt) * sqrt(shF0);
        sPat = pt; sFh = sh_; sDen = shF0; sFg = (mix(b0.ba, b1.ba, wb) - 0.5) * 64.0 * sc;
      }
      ${lite ? '' : `if (shW.residual > 0.0 && shPart(4u)) {
        let fq = fract(F.cam.w / 8.0); let drift = shW.dir * 1.5; let sc2 = 0.12;
        let r0 = textureSampleGrad(tSlope, sRep, (v.uv0 - drift * fq) * sc2, FOAM_LAYER, fgx * sc2, fgy * sc2).r;
        let r1 = textureSampleGrad(tSlope, sRep, (v.uv0 - drift * fract(fq + 0.5)) * sc2 + 0.5, FOAM_LAYER, fgx * sc2, fgy * sc2).r;
        let rp = mix(r0, r1, abs(2.0 * fq - 1.0));
        let rc = smoothstep(1.2 - shW.residual, 1.35 - shW.residual, rp) * shW.residual;
        if (rc >= sCov) { sPat = rp; sFh = 0.5; sFg = vec2f(0.0); sDen = shW.residual * 0.5; }
        sCov = max(sCov, rc);
      }`}
      // the swash's bore line and the edge where the water thins to nothing on the bed (the contact line moves with the waves)
      let filmFoam = smoothstep(0.0, 0.01, shS.x) * (1.0 - smoothstep(0.02, 0.12, shS.x)) * 0.55;   // the thin swash is bubbly (the bore's foam carried up and back)
      let eD = clamp(max(max(shS.y * 0.9, filmFoam), (1.0 - smoothstep(0.0, 0.12, depth)) * smoothstep(0.01, 0.04, shW.a0) * 0.8 * step(gP, 0.0)) * shF(10u), 0.0, 1.0);   // shF(10u): the whitewater's wind share (render/shore.js P.white)
      if (eD > 0.0) {
        let lc = textureSampleGrad(tSlope, sRep, v.uv0 * 0.35, FOAM_LAYER, fgx * 0.35, fgy * 0.35);
        let ec = smoothstep(1.0 - eD, 1.25 - eD, lc.r * 0.6 + lc.g * 0.4) * sqrt(eD);
        if (ec >= sCov) { sPat = lc.r; sFh = lc.g; sFg = (lc.ba - 0.5) * 64.0 * 0.35; sDen = eD; }
        sCov = max(sCov, ec);
      }
      // where the pixel's footprint outgrows the pattern (past ≈ 0.15–0.6 m), its mean in place of the thresholded lace: a far
      // beach's white line steady, never flecks that flip with a millimetre of camera (the no-flicker ruling)
      let sRes = 1.0 - smoothstep(0.15, 0.6, fp);
      sCov = mix(0.45 * max(clamp(shW.foam, 0.0, 1.0), max(shW.residual * 0.5, eD)), sCov, sRes);
      if (sCov > 0.0) {
        let fN = normalize(n - vec3f(sFg.x, 0.0, sFg.y) * (0.03 + 0.12 * sDen));
        let ao = mix(0.45, 1.0, smoothstep(0.15, 0.75, sFh));
        let solid = smoothstep(0.2, 0.9, sDen * (0.55 + 0.7 * sFh));
        let alb = mix(SU_FTINT, vec3f(0.95), max(solid, smoothstep(0.3, 0.9, sPat) * 0.6));
        let lit = sunPerp * ((0.15 + 0.85 * clamp(dot(fN, s) * 0.8 + 0.2, 0.0, 1.0)) * mix(ao, 1.0, 0.4) + pow(clamp(dot(s, -V), 0.0, 1.0), 4.0) * 0.4 * (1.0 - solid)) + eSky * 1.1 * ao;
        let sCol = (SU_FBRIGHT * alb * lit + sunPerp * pow(max(dot(fN, normalize(V + s)), 0.0), 90.0) * 0.5 * smoothstep(0.55, 0.85, sFh) * solid) / PI;
        let sF = sCov * mix(0.8, 1.0, solid);
        if (sF >= capF) { capCol = sCol; }
        capF = max(capF, sF);
      }
    }
  }
  let foam = max(capF, wakeF);
  let foamCol = mix(capCol, wakeFoamColour(n, s, eSky, eSun), wakeF / max(foam, 1e-4));
  // past DEEP0 the bed fades out (the terrain stops drawing it below 60 m) and the water's own body, the bed's limit at
  // depth (the backscatter R∞ under the same light, terrain.js), takes its place
  let deep = max(smoothstep(DEEP0, DEEP1, depth), v.hole);   // fix(v2) frame look: the bed seen past a sill is not drawn (WV.hole)
  // the body is v2's own navy at every depth past the shelf (2026-11-13: round 4's mid-water tint removed)
  var body = stormSlate(WUP * 0.98 * (eSun + eSkyB * mix(1.0, ${NIGHT_WATER.sky.toFixed(2)}, nk * nk * (3.0 - 2.0 * nk)) + nightLand() * ${NIGHT_WATER.body.toFixed(2)}) / PI * RINF);   // stormSlate: the storm overcast's grey (v1's approach); M5e: v1's night light on the lake's body (its hemisphere light lit the water by night)
${lite ? '' : `  // feat/v2-look-ponlai: the far body takes the hue of the sky over the horizon ahead (WATER_FAR), its luminance kept
  let farSky = ${WATER_FAR.k.toFixed(3)} * smoothstep(${WATER_FAR.near.toFixed(1)}, ${WATER_FAR.far.toFixed(1)}, dist) * (1.0 - F.storm.x);
  if (farSky > 0.0) {
    let hzD = normalize(vec3f(-V.x, ${WATER_FAR.up.toFixed(3)}, -V.z)); let hz = duskGlow(hzD, skyRadiance(hzD));   // the low sun's band in it (render/sky.js DUSK)
    body = mix(body, hz * max(dot(body, LUMA) / max(dot(hz, LUMA), 1e-6), ${WATER_FAR.floor.toFixed(3)}), farSky);
  }
`}  // #56 M1: Ultra's crest subsurface (its k1): sun through a thin crest seen against the sun, the crest's height in Hs units
  // (a lake's crest is a tenth of Ultra's ocean's), thin folding crests more (v1's), in the body's own colour per unit light
  var sss = vec3f(0.0);
  if (suOn(${SURF_BITS.sss}u)) {
    let k1 = SU_SSS * SU_CREST * clamp(eta / max(hsLoc, 0.03), 0.0, 1.5) * pow(clamp(dot(s, -V), 0.0, 1.0), 4.0) * pow(0.5 - 0.5 * dot(n, s), 3.0) * (1.0 + SU_THIN * (1.0 - smoothstep(0.45, 0.95, jac)));
    sss = k1 * sunPerp * WUP * 0.98 * RINF / PI;
  }
  // #56 M3: the breaking lip, sun through its thin water (Ultra's lip glow), strongest looking into the sun; the lake's blue-green
  if (shAct && shW.lip > 0.0) { sss += shW.lip * sunPerp * vec3f(0.012, 0.055, 0.065) * (0.3 + 2.5 * pow(clamp(dot(s, -V), 0.0, 1.0), 3.0)) / PI; }
  let a = ((fres + (1.0 - fres) * deep) * (1.0 - foam) + foam) * soft;
  var Tair = vec3f(1.0);
  let inS = aerialParts(v.pos.xy, v.world, &Tair);
  let col = (Tair * ((fres * skyR + glint + (1.0 - fres) * (deep * body + sss)) * (1.0 - foam) + foamCol * foam) + inS * a / max(soft, 1e-4)) * soft;
  // v1's approach (2026-11-18): the water stays physical under a storm; its colour changes only through its inputs (the
  // mirror's dark grey lid, stormSky; the cell's shade on the sun and the glint; the rain's rings and roughness); its veil is the
  // height fog every draw shares (aerialParts), and the steel and the dark are the frame's grade (render/shaders.js stormGrade)
  // fix(v2) frame look: the navy kept. v1's camera exposes the day at EXPOSURE.v1Base (whites and greys as v1's under AgX's
  // shoulder); the water's surface (its mirror, body and foam over the bed) is never brighter than M2 drew it (sim/exposure.js waterKeep, F.look.x),
  // so the deep water reads its value before the change (the bed's column eases to the same past the shelf: render/bed.js)
  // #56 M1: the whitecaps' foam is white water, not the lake's surface: it keeps its own light (under the keep the old flat
  // foam read as tan smudges); the wake's foam keeps the keep (its look is the wake's)
  let keep = select(1.0, F.look.x, F.look.x > 0.0);
  let capPart = select(vec3f(0.0), Tair * capCol * (foam - min(wakeF, foam)) * soft, suOn(${SURF_BITS.foam}u));
  // #56 M3: the shore's own endings
  if (shAct) {
    if (gP >= 0.0) {
      // over the sand: the swash's thin film (its Fresnel share of the sky and the glint, the bore's foam) and the wet sand behind
      // it (the terrain drew the dry sand: the premultiplied alpha darkens it, glossy just after the backwash, drying in 5 s)
      let filmK = smoothstep(0.0, 0.008, shS.x);
      let wetA = SH_WET * max(shS.z, filmK);
      let fF = fres * filmK;
      let aB = 1.0 - (1.0 - fF) * (1.0 - wetA) * (1.0 - foam);
      let sheen = 0.35 * fres * smoothstep(0.55, 1.0, shS.z) * (1.0 - filmK);
      let colB = Tair * ((fF + sheen) * skyR + glint * filmK) * (1.0 - foam) + inS * aB;
      return vec4f(colB * keep + Tair * capCol * foam, aB) * hullK;
    }
    // over the bed: the foam reaches the waterline (the surface's soft fade is the calm water's edge)
    let sfo = max(soft, smoothstep(0.0, 0.03, depth));
    let aS = (fres + (1.0 - fres) * deep) * (1.0 - foam) * soft + foam * sfo;
    let colS = Tair * (fres * skyR + glint + (1.0 - fres) * (deep * body + sss)) * (1.0 - foam) * soft + Tair * foamCol * foam * sfo + inS * aS;
    let capS = select(vec3f(0.0), Tair * capCol * (foam - min(wakeF, foam)) * sfo, suOn(${SURF_BITS.foam}u));
    return vec4f(colS * keep + capS * (1.0 - keep), aS) * hullK;
  }
  // M3: Tessie's night wake glow (wake.js: 0 by day, on a phone and with no creature map; an emission over the water)
  return vec4f(col * keep + capPart * (1.0 - keep) + WAKE_GLOW * wk.glow * Tair, a) * hullK;
}`;

// Play as Tessie, phase 2a: the surface from below (fsUnder), the same mesh and its slopes, a second fragment entry,
// appended to the water's own text in a module of its own (the water's module stays byte for byte, so every frame above the water is the same).
//   Snell's window (k = 1 − n² (1 − cos² θ)), its edge soft over k ∈ [0, 0.22] (Abyssal Garden's win = ss(0, .22, k); MIT © 2026 Maksymilian
//   Dendura, render/LICENSE-abyssal-garden.txt); inside it the sky, the clouds, the land's ridge and the refracted sun, by (1 − R) (Fresnel on
//   the transmitted cosine, Abyssal Garden's pow(1 − sqrt(k), 5)); outside, total internal reflection: the water's own light along the
//   reflected ray (Abyssal Garden's cheap mirror: no scene copy); the whitecaps' and the wake's foam from below, lit from above; then the
//   path to the eye (umFog). The normal is the footprint's mean (the mips), so the far underside is steady (no sparkle); the window's sun
//   widens with the slopes' variance (the glint by footprint, as the top side). Opaque: what lies past the surface is the window's.
export const WATER_UNDER_WGSL = () => `
${UNDER_WGSL}
const UM_EDGE = ${UNDER.edge.toFixed(3)}; const UM_F0 = ${UNDER.f0.toFixed(3)}; const UM_SUN0 = ${UNDER.sunTight.toFixed(1)}; const UM_SUN1 = ${UNDER.sunWide.toFixed(1)};
@fragment fn fsUnder(v: WV) -> @location(0) vec4f {
  let toEye = F.cam.xyz - v.world; let dist = length(toEye); let V = toEye / max(dist, 1e-3);
  let w = warpOf(v.uv0.x, v.uv0.y);
  let xzw = v.uv0 + w;
  let fp = sqrt(max(max(dot(dpdx(xzw), dpdx(xzw)), dot(dpdy(xzw), dpdy(xzw))), 1e-12));
  // the footprint's mean slope and its variance (the mips' moments), each cascade by its gain; the long tiles' folds (the whitecaps)
  var slC = vec2f(0.0); var vr = vec2f(0.0); var jac = 1.0;
  for (var c = 0u; c < C; c++) {
    let L = F.water[c];
    var xz = v.uv0; if (c > 0u) { xz += w; }
    let m4 = textureSampleLevel(tSlope, sRep, xz / L, i32(c), footprintLod(fp, L));
    let g = v.gain[min(c, 3u)];
    slC += m4.xy * g; vr += max(m4.zw - m4.xy * m4.xy, vec2f(0.0)) * g * g;
  }
  for (var c = 0u; c < CPU_C; c++) {
    let L = F.water[c]; var xz = v.uv0; if (c > 0u) { xz += w; }
    let d4 = textureSample(tDisp, sRep, xz / L, i32(c));
    jac = min(jac, mix(1.0, d4.w, select(v.damp.y, v.damp.x, c == 0u)));
  }
  let wk = wakeAt(v.uv0, fp);
  slC += wk.slope;
  let sigma2 = 0.5 * (vr.x + vr.y) + 0.0004;
  let nUp = normalize(vec3f(-slC.x, 1.0, -slC.y));
  let nD = -nUp;                       // the surface's face toward the eye under it
  let I = -V;                          // the eye's ray, up toward the surface
  let ci = clamp(dot(V, nD), 0.0, 1.0);
  let k = 1.0 - NW * NW * (1.0 - ci * ci);
  let win = smoothstep(0.0, UM_EDGE, k);
  // total internal reflection: the water's own light along the reflected ray, from the surface down
  let Rd = reflect(I, nD);
  let below = umLinf(normalize(vec3f(Rd.x, min(Rd.y, -0.05), Rd.z)), 0.0) * 0.9;
  // inside the window: the air along the refracted ray (the sky, the clouds, the land's ridge, the sun)
  var inside = vec3f(0.0); var R = 1.0;
  if (k > 0.0) {
    let ct = sqrt(k);
    let Tv = normalize(refract(I, nD, NW) + vec3f(0.0, 1e-4, 0.0));
    var air = skyRadianceShown(Tv);
    let land = reflectedLand(vec3f(Tv.x, max(Tv.y, 0.0), Tv.z));
    air = mix(air, land.rgb, land.a * (1.0 - smoothstep(0.35, 0.6, Tv.y)));
    let cl = cloudAt(Tv); air = air * cl.a + cl.rgb;
    // the refracted sun: a tight core and a wider glow, widened by the slopes' spread (steady: the footprint's normal)
    let s = normalize(F.sun.xyz); let mu = max(dot(Tv, s), 0.0);
    let wide = UM_SUN1 / (1.0 + 400.0 * sigma2); let tight = UM_SUN0 / (1.0 + 4000.0 * sigma2);
    air += sunIrradiance() / max(s.y, 0.05) * (pow(mu, tight) * tight * 0.02 + pow(mu, wide) * wide * 0.004) / PI;
    R = UM_F0 + (1.0 - UM_F0) * pow(1.0 - ct, 5.0);
    inside = (1.0 - R) * NW * NW * air;   // the radiance gains n² entering the denser water (n² L / n² is kept along a ray)
  }
  var col = mix(below, inside + R * below, win);
  // the foam from below: the whitecaps' (the folds) and the wake's, white patches lit from above (thin foam lets light through)
  let capF = (1.0 - smoothstep(${FOAM.full}, ${FOAM.onset}, jac)) * smoothstep(${FOAM.windLo}.0, ${FOAM.windHi}.0, F.wind.x) * ${FOAM.cover};
  let wakeF = min(wakeFoamVisible(v.uv0, wk.foam, F.cam.w, smoothstep(0.01, 0.12, length(slC)), fp), 0.95);
  let foam = max(capF, wakeF);
  col = mix(col, 0.98 * (LIGHT.sun.rgb + LIGHT.sky.rgb) * 0.5 / PI, foam * 0.85);
  return vec4f(umFog(col, v.world), 1.0);
}`;

// perf(v2) phone: the phone path's numbers (engine/quality.js's L2 and L3 rows pick them)
export const PHONE = Object.freeze({ aniso: 2 });
export const FULL_EVERY = 64;
export const SEA_BUDGET = 8192;   // #25: a live page's sea-field work a frame (sim/seaField.js update: 16 mask rows or 128 fetch cells)   // perf(v2) phone round 2: under waterCascades 3, one sim step in 64 runs the 2.1 m cascade (its roughness re-measured)
// the coarse grid's indices: every other vertex of the (side × side) grid, the same winding as the fine one
export function coarseGridIndices(side) {
  const n = (side - 1) >> 1, out = new Uint32Array(n * n * 6);
  for (let j = 0, o = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v0 = 2 * j * side + 2 * i, v1 = v0 + 2, v2 = v0 + 2 * side, v3 = v2 + 2;
    out[o++] = v0; out[o++] = v2; out[o++] = v1; out[o++] = v1; out[o++] = v2; out[o++] = v3;
  }
  return out;
}

// --- the GPU side ---
export function createWater({ liteFirst = false, device, reg, graph, frameBGL, frameBG, U, frameStruct = wgslStruct(), sky, night, terrainBGL, reflectView, hdrTarget, msaa = 1, depthFormat = 'depth32float', seed = 1337, dt = 1 / 120, wake = null, asyncSea = false, groundAt = null, shoreMirror = null, m1 = true, shore = null, detail = false, under = false }) {   // under: phase 2a's surface from below (src/core/features.js tessieUnder; its pipeline in the deferred 'under' group)   // shore: #56 M3, render/shore.js createShore (none: the water before M3)   // m1: #56 M1's surface (false: ?m1=0, the water before: M5c's fades and shading)   // shoreMirror: #41c, render/towns.js createShoreMirrorTarget (a zeroed stand-in without it)   // asyncSea: a live page builds the sea's tables in a worker (sim/sea-worker.js); captures and the film clock in the frame   // night: render/night.js (M5e): its record and maps ride the draw group (bindings 4–7)
  const count = C * NN, ST = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
  const buf = (label, bytes, usage, init = null) => { const b = device.createBuffer({ label, size: bytes, usage, mappedAtCreation: !!init }); if (init) { new Float32Array(b.getMappedRange()).set(init); b.unmap(); } return b; };
  const h0Buf = buf('water-h0', count * 16, ST | CD);
  const P = [buf('water-p0', count * 16, ST), buf('water-p1', count * 16, ST)], Q = [buf('water-q0', count * 16, ST), buf('water-q1', count * 16, ST)];
  const turbBuf = buf('water-turb', count * 4, ST | CD, new Float32Array(count).fill(1));
  const winBuf = buf('water-window', WINDOW_FLOATS * 4, ST | CS);
  // the two axis records at 256 B each (a dynamic offset picks one): vert 0 (rows), 1 (columns)
  const stage = new Uint32Array(2 * 64);
  stage[64] = 1;
  const stageBuf = device.createBuffer({ label: 'water-stages', size: stage.byteLength, usage: GPUBufferUsage.UNIFORM | CD });
  device.queue.writeBuffer(stageBuf, 0, stage);

  const mips = LOG_N + 1;
  const tex = (label, layers = C) => device.createTexture({ label, size: [N, N, layers], format: 'rgba16float', mipLevelCount: mips, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const disp = tex('water-disp'), slope = tex('water-slope', C + 1);   // #56 M1: the slope array's last layer holds Ultra's foam (FOAM_LAYER)
  const level = (t, l) => t.createView({ dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 });
  const sRep = device.createSampler({ label: 'water-repeat', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
  // perf(v2) phone: the phone path's sampler (L2, L3): anisotropy 2 on the cascades (8 reads a grazing pixel became 2)
  const sRepLo = device.createSampler({ label: 'water-repeat-lo', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: PHONE.aniso });

  const CP = GPUShaderStage.COMPUTE, VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const ro = { buffer: { type: 'read-only-storage' } }, rw = { buffer: { type: 'storage' } };
  const storArr = { storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } };
  const texArr = { texture: { sampleType: 'float', viewDimension: '2d-array' } };
  const bglEvolve = device.createBindGroupLayout({ label: 'water-evolve', entries: [{ binding: 0, visibility: CP, ...ro }, { binding: 1, visibility: CP, ...rw }, { binding: 2, visibility: CP, ...rw }] });
  const bglFft = device.createBindGroupLayout({ label: 'water-fft', entries: [0, 1].map((b) => ({ binding: b, visibility: CP, ...ro })).concat([2, 3].map((b) => ({ binding: b, visibility: CP, ...rw }))) });
  const bglStage = device.createBindGroupLayout({ label: 'water-stage', entries: [{ binding: 0, visibility: CP, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
  const bglAssemble = device.createBindGroupLayout({ label: 'water-assemble', entries: [{ binding: 0, visibility: CP, ...ro }, { binding: 1, visibility: CP, ...ro }, { binding: 2, visibility: CP, ...rw }, { binding: 3, visibility: CP, ...rw }, { binding: 4, visibility: CP, ...storArr }, { binding: 5, visibility: CP, ...storArr }] });
  const bglMip = device.createBindGroupLayout({ label: 'water-mip', entries: [{ binding: 0, visibility: CP, ...texArr }, { binding: 1, visibility: CP, ...storArr }] });
  const bglMip4 = device.createBindGroupLayout({ label: 'water-mip4', entries: [{ binding: 0, visibility: CP, ...texArr }, ...[1, 2, 3, 4].map((b) => ({ binding: b, visibility: CP, ...storArr }))] });   // perf(v2) phone round 2
  const nb = night.waterBind(4);
  // #21, #25: the sea field (sim/seaField.js): the fetch map (r16float, 128²) and its 64-byte uniform, written at load and when
  // they change (no allocation a frame); groundAt(x, z): the terrain's CPU twin (the land mask, the depth under the CPU surface)
  const sea = createSeaField({ heightAt: groundAt ?? (() => -100) });
  const seaTex = device.createTexture({ label: 'water-sea-fetch', size: [sea.field.n, sea.field.n], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  const seaBuf = device.createBuffer({ label: 'water-sea-field', size: FIELD_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(seaBuf, 0, sea.uniform);   // all zero: no map yet, the gains are the depth's calm alone
  const seaLayout = [{ binding: SEA_BINDING, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, { binding: SEA_BINDING + 1, visibility: GPUShaderStage.VERTEX, texture: {} }];
  const seaEntries = [{ binding: SEA_BINDING, resource: { buffer: seaBuf } }, { binding: SEA_BINDING + 1, resource: seaTex.createView() }];
  // #56 M1: the surface's uniform (48 B: each displacement tile's Hs at the boat and the parts on, the boat's bay shares and the
  // whitecaps' J0, the slope gain's reach on the 85 and 12 m tiles), written
  // when the sea moves; Ultra's foam is baked into the slope array's last layer on the first frame (run)
  const surfBuf = device.createBuffer({ label: 'water-surface', size: 48, usage: GPUBufferUsage.UNIFORM | CD });
  const surfU = new Float32Array(12); surfU[3] = m1 ? SURF_DEFAULT : 0; surfU[8] = SURF.boostReach[0]; surfU[9] = SURF.boostReach[1]; surfU[10] = SURF.tileSlope[0] ** 2 - 1; surfU[11] = SURF.tileSlope[1] ** 2 - 1;
  const jHist = new Uint32Array(J0_HIST.bins); let jNext = 1, jSeen = false, jAim = 0, jRead = 0;   // the whitecaps' J0 (setWind): no allocation a frame
  device.queue.writeBuffer(surfBuf, 0, surfU);
  const surfLayout = [{ binding: SURF_BINDING, visibility: VF, buffer: { type: 'uniform' } }];
  const surfEntries = [{ binding: SURF_BINDING, resource: { buffer: surfBuf } }];
  const bglDraw = device.createBindGroupLayout({ label: 'water-draw', entries: [{ binding: 0, visibility: VF, ...texArr }, { binding: 1, visibility: VF, ...texArr }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} }, ...nb.layout, ...(wake ? wake.layoutEntries(WAKE_BINDING) : []), ...seaLayout, { binding: SHORE_MIRROR_BINDING, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, ...surfLayout, { binding: WIND_BINDING, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, ...(shore ? [shore.layoutEntry(SHORE_BINDING)] : []), ...(detail ? [{ binding: FOAM_MAP_BINDING, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } }, { binding: FOAM_MAP_BINDING + 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] : [])] });   // waterDetail: the foam map; wake: its maps and uniform; #21, #25: the sea field; #41c: the shore's mirror; #56 M1; #56 M3: the shore field
  // audit W1–W3: the wind texture (sim/windTex.js: wind x, z, the mean speed as half floats, 256² texels of 16 m) in a storage
  // buffer (the fragment stage is at the 16 sampled textures' limit), written when a fill lands
  const windTexture = device.createBuffer({ label: 'water-wind', size: WIND_TEX * WIND_TEX * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const shoreMirrorBuf = shoreMirror?.buffer ?? device.createBuffer({ label: 'water-shore-mirror-none', size: 16, usage: GPUBufferUsage.STORAGE });   // #41c: its count word 0: no shore

  const bg = (layout, res) => device.createBindGroup({ layout, entries: res.map((r, i) => ({ binding: i, resource: r.buffer ? r : (r instanceof GPUBuffer ? { buffer: r } : r) })) });
  const bgEvolve = bg(bglEvolve, [h0Buf, P[0], P[1]]);
  const bgPQ = bg(bglFft, [P[0], P[1], Q[0], Q[1]]), bgQP = bg(bglFft, [Q[0], Q[1], P[0], P[1]]);
  const bgStage = device.createBindGroup({ layout: bglStage, entries: [{ binding: 0, resource: { buffer: stageBuf, size: 16 } }] });
  const bgAssemble = bg(bglAssemble, [P[0], P[1], turbBuf, winBuf, level(disp, 0), level(slope, 0)]);
  const bgMip = [disp, slope].map((t) => Array.from({ length: LOG_N }, (_, l) => bg(bglMip, [level(t, l), level(t, l + 1)])));
  // perf(v2) phone round 2: the fused chain (levels 1–4 from 0, 5–8 from 4) and the flat 2.1 m layer (mips 0–7 from the top)
  const bgMip4 = [disp, slope].map((t) => [0, 4].map((l0) => bg(bglMip4, [level(t, l0), level(t, l0 + 1), level(t, l0 + 2), level(t, l0 + 3), level(t, l0 + 4)])));
  const bgFlat = Array.from({ length: LOG_N }, (_, l) => bg(bglMip, [level(slope, LOG_N), level(slope, l)]));
  // #56 M1: the foam's bake (the slope array's level 0, layer FOAM_LAYER); its mips by the slope's own mip groups over every layer
  const bglBake = device.createBindGroupLayout({ label: 'water-foam-bake', entries: [{ binding: 0, visibility: CP, ...storArr }] });
  const bgBake = bg(bglBake, [level(slope, 0)]);
  let foamBaked = false;
  const drawGroup = (sampler, fp = 0) => device.createBindGroup({ layout: bglDraw, entries: [...(foamMap ? foamMap.entries(FOAM_MAP_BINDING, fp) : []), { binding: 0, resource: disp.createView({ dimension: '2d-array' }) }, { binding: 1, resource: slope.createView({ dimension: '2d-array' }) }, { binding: 2, resource: sampler }, { binding: 3, resource: reflectView }, ...nb.entries, ...(wake ? wake.entries(WAKE_BINDING) : []), ...seaEntries, { binding: SHORE_MIRROR_BINDING, resource: { buffer: shoreMirrorBuf } }, ...surfEntries, { binding: WIND_BINDING, resource: { buffer: windTexture } }, ...(shore ? [shore.entry(SHORE_BINDING)] : [])] });   // wake: its maps and uniform; #21, #25: the sea field; #41c; #56 M1; #56 M3
  // waterDetail, fix 2: the persistent foam (the draw reads the buffer its last run wrote: one draw group per parity)
  const foamMap = detail ? createFoamMap({ device, reg, frameBGL, dispView: disp.createView({ dimension: '2d-array' }), sampler: sRep, surfBuf,
    headWgsl: `${HEAD(frameStruct)}\nconst PI = 3.14159265359;\n${SURF_WGSL}${SURF_FNS_WGSL}\n${WARP_WGSL}` }) : null;
  const bgDrawP = [0, 1].map((p) => [drawGroup(sRep, p), drawGroup(sRepLo, p)]);   // perf(v2) phone: the second with anisotropy 2
  let foamWind = { speedMs: 0, travelRad: 0 };

  const mEv = reg.shader('water-evolve', EVOLVE_WGSL(frameStruct)), mFft = reg.shader('water-fft', FFT_WGSL), mAs = reg.shader('water-assemble', ASSEMBLE_WGSL(frameStruct, dt.toFixed(8), m1 ? SURF.foamRec : SEA.foamRecovery));
  const mMip = reg.shader('water-mip', MIP_WGSL), mDraw = reg.shader('water', WATER_DRAW_WGSL(frameStruct, wake, false, shore, detail));
  const mLite = reg.shader('water-lite', WATER_DRAW_WGSL(frameStruct, wake, true, shore));   // perf(v2) phone: the lite water (built at load with the rest)
  const pl = (...layouts) => device.createPipelineLayout({ bindGroupLayouts: layouts });
  reg.add('water-evolve', { layout: pl(frameBGL, bglEvolve), compute: { module: mEv, entryPoint: 'main' } });
  reg.add('water-fft', { layout: pl(bglFft, bglStage), compute: { module: mFft, entryPoint: 'main' } });
  reg.add('water-assemble', { layout: pl(frameBGL, bglAssemble), compute: { module: mAs, entryPoint: 'main' } });
  reg.add('water-mip', { layout: pl(bglMip), compute: { module: mMip, entryPoint: 'main' } });
  reg.add('water-mip4', { layout: pl(bglMip4), compute: { module: reg.shader('water-mip4', MIP4_WGSL), entryPoint: 'main' } });   // perf(v2) phone round 2
  reg.add('water-flat3', { layout: pl(bglMip), compute: { module: reg.shader('water-flat3', FLAT3_WGSL), entryPoint: 'main' } });
  reg.add('water-foam-bake', { layout: pl(bglBake), compute: { module: reg.shader('water-foam-bake', FOAM_BAKE_WGSL(FOAM_LAYER)), entryPoint: 'main' } });   // #56 M1
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const drawLayout = pl(frameBGL, sky.skyBGL, bglDraw, terrainBGL);
  // perf(v2) iOS pipelines: the variant the start level does not draw is its own group ('water-alt'), built after the first
  // frame; until then the draw keeps the built one (liteFirst: the start level draws the lite water)
  for (const [name, m] of [['water', mDraw], ['water-lite', mLite]]) {
    const prev = name === (liteFirst ? 'water' : 'water-lite') ? reg.group?.('water-alt') : null;
    reg.add(name, { layout: drawLayout, vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
    if (prev != null) reg.group(prev);
  }
  // phase 2a: the surface from below, the same vertex stage, the water's own text with fsUnder appended (a module of its own)
  if (under) {
    const prevU = reg.group?.('under');
    const mU = reg.shader('water-under', WATER_DRAW_WGSL(frameStruct, wake, false, shore, detail) + WATER_UNDER_WGSL());
    reg.add('water-under', { layout: drawLayout, vertex: { module: mU, entryPoint: 'vs' }, fragment: { module: mU, entryPoint: 'fsUnder', targets: [{ ...hdrTarget, blend }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  }

  // the grid's one index buffer
  const quads = (SIDE - 1) * (SIDE - 1), idx = new Uint32Array(quads * 6);
  for (let j = 0, o = 0; j < SIDE - 1; j++) for (let i = 0; i < SIDE - 1; i++) {
    const v0 = j * SIDE + i, v1 = v0 + 1, v2 = v0 + SIDE, v3 = v2 + 1;
    idx[o++] = v0; idx[o++] = v2; idx[o++] = v1; idx[o++] = v1; idx[o++] = v2; idx[o++] = v3;
  }
  const ibuf = device.createBuffer({ label: 'water-grid', size: idx.byteLength, usage: GPUBufferUsage.INDEX | CD });
  device.queue.writeBuffer(ibuf, 0, idx);
  // perf(v2) phone: the coarse grid (L2, L3): every other vertex of the same grid, so the same vertex shader and offsets
  // (a 0.33 m first cell, 12 % growth, the same 40 km edge): a quarter of the triangles (51 k for 205 k)
  const coarseIdx = coarseGridIndices(SIDE);
  const ibufCoarse = device.createBuffer({ label: 'water-grid-coarse', size: coarseIdx.byteLength, usage: GPUBufferUsage.INDEX | CD });
  device.queue.writeBuffer(ibufCoarse, 0, coarseIdx);
  const look = { grid: 'fine', aniso: 8, lite: false, cascades: C, fused: false };

  // the readback ring and the CPU surface
  const surface = createSurface();
  const depthAt = (x, z) => (groundAt ? -groundAt(x, z) : 100);
  surface.setGains((x, z, out) => sea.gainsAt(x, z, depthAt(x, z), out));   // #21, #25: the CPU surface is the drawn one, gains and all
  const metaRing = Array.from({ length: 3 }, () => new Float64Array(3));   // cx, cz, t per slot: no object a frame
  const ring = createReadbackRing({ device, bytes: WINDOW_FLOATS * 4, slots: 3, label: 'water-window', onData: (view, meta) => surface.adopt(view, meta), mapMode: GPUMapMode.READ });
  const centre = { x: 0, z: 0, t: 0 };
  // perf(v2) phone round 2: the window is copied only on a frame whose assemble wrote it, with that frame's centre and the
  // waves' own time (the evolve's: a split step's first frame). Round 1 copied it every frame with the frame's centre while
  // the half-rate sim's window still held the last step's origin (a texel off whenever the snapped centre moved)
  let assembled = false, waveT = 0, waveTa = 0;
  graph.onBeforeSubmit((enc) => { if (!assembled) return; assembled = false; const m = metaRing[ring.slot]; m[0] = centre.x; m[1] = centre.z; m[2] = waveT; ring.copy(enc, winBuf, m); });
  graph.onAfterSubmit(() => ring.afterSubmit());
  graph.onDrain(() => ring.drain());

  let tKey = '', T = null, hs = 0, h0 = null, wLast = null, mix = null;
  let keyU = NaN, keyRad = NaN, keyStr = '';   // refactor-3 B2: the last wind key's inputs and its string
  const wtA = { lake: [0, 0, 0, 0], bay: 0 }, wtB = { lake: [0, 0, 0, 0], bay: 0 }, shareBuf = [0, 0, 0], tileSq = [0, 0, 0];   // reused each composition
  // the day clock, 2026-11-13: a live page's wind moves (the evening's fade with the clock, a level, a storm), and each new key's
  // build (≈ 40–90 ms) stopped a frame; there it runs in a worker, one job at a time (the newest key wins), the old tables
  // re-composed meanwhile. The first build is in the frame (nothing to show without it); captures keep the in-frame path
  let seaWorker = null, seaJob = 0, seaBusy = null, seaWant = null, seaReady = null;
  const seaPost = (kU, travelRad, key) => {
    if (!seaWorker) {
      try { seaWorker = new Worker(new URL('../sim/sea-worker.js', import.meta.url), { type: 'module', name: 'velia-sea' }); } catch { seaWorker = false; }
      if (seaWorker) seaWorker.onmessage = (e) => { if (e.data.id === seaJob) seaReady = e.data.T; seaBusy = null; if (seaWant && seaWant.key !== tKey) { const w = seaWant; seaWant = null; seaPost(w.kU, w.travelRad, w.key); } };
    }
    if (!seaWorker) return false;
    if (seaBusy) { seaWant = { kU, travelRad, key }; return true; }
    seaBusy = key; seaJob++;
    seaWorker.postMessage({ id: seaJob, speedMs: kU, travelRad, seed, fades: m1 ? 'v1' : 'm5c' });
    return true;
  };
  const gain = 1;   // v1's two sims' gains are in the composed table (spectrum.js composeSea); F.wind.z stays 1
  const groups = Math.ceil(count / 256);
  let steps = 0;   // perf(v2) phone round 2: the sim's steps (a 4-cascade step every FULL_EVERY under waterCascades 3)
  const s0 = GRID.a * (Math.exp(GRID.b) - 1);
  return {
    disp, slope, surface, ring, lengths: LENGTHS, grid: GRID, triangles: quads * 2, indexCount: idx.length,
    // perf(v2) phone: the phone path's rows, live (both pipelines, samplers and index buffers exist from the load)
    get look() { return { ...look }; },
    setLook(o = {}) {
      if (o.grid) look.grid = o.grid === 'coarse' ? 'coarse' : 'fine'; if (o.aniso) look.aniso = o.aniso <= PHONE.aniso ? PHONE.aniso : 8; if (o.lite != null) look.lite = !!o.lite;
      if (o.fused != null) look.fused = !!o.fused;   // perf(v2) phone round 2: the fused mip chain
      if (o.cascades) { const k = o.cascades <= CPU_CASCADES ? CPU_CASCADES : C; if (k !== look.cascades) { look.cascades = k; steps = 0; } }   // perf(v2) phone round 2: the next step is a full one (it measures the 2.1 m layer's roughness)
    },
    get significantHeight() { return hs; },
    windTexture,   // audit W1–W3: main.js uploads sim/windTex.js's fills into it
    // #56 M1's shading on (true) or the water before (false), live: the in-page A/B (tools/v2-ab-m1.mjs). The fades are the h0
    // table's (fixed at load: ?m1=0 builds M5c's); this switch is the shading's (the slope gain, MTF, mirror ray, foam, crest, glint)
    get m1() { return surfU[3] > 0.5; },
    set m1(v) { surfU[3] = v ? SURF_DEFAULT : 0; device.queue.writeBuffer(surfBuf, 0, surfU); },
    // the parts one by one (render/water-surface.js SURF_BITS: the ablations, the per-part A/B)
    get m1bits() { return surfU[3]; },
    set m1bits(b) { surfU[3] = b & SURF_ALL; device.queue.writeBuffer(surfBuf, 0, surfU); },
    // the slope gain's reach (m of footprint) on the 85 and 12 m tiles (SURF.boostReach; the tuning harness)
    get m1reach() { return [surfU[8], surfU[9], Math.sqrt(surfU[10] + 1), Math.sqrt(surfU[11] + 1)]; },
    set m1reach([a, b, k1 = Math.sqrt(surfU[10] + 1), k2 = Math.sqrt(surfU[11] + 1)]) { surfU[8] = a; surfU[9] = b; surfU[10] = k1 * k1 - 1; surfU[11] = k2 * k2 - 1; device.queue.writeBuffer(surfBuf, 0, surfU); },
    get gain() { return gain; },
    get sea() { return mix; },   // the point's weights (m, beta, feel, the tiles') and the fetch, for the harness
    // v1's sea from the boat's wind (spectrum.js: v1's lake and bay sims summed into one table, weighted by the fetch at the
    // boat): speedMs the wind there (m/s), travelRad its travel, fetchM the fetch (m) at (x, z). The two sims' tables are rebuilt
    // only when the wind moves 0.5 m/s or 0.6° (≈ 40 ms on the CPU); between, their sizes follow the wind's Hs law and the
    // fetch's weights in a cheap re-composition (≈ 3 ms) when a weight moves 1 %
    setWind({ speedMs, travelRad, fetchM = V1_SEA.fetchMaxM, x = 0, z = 0, capK = 1 }) {   // capK: the storm's whitecap share × (v2/sim/stormSea.js; 1 fair)
      foamWind.speedMs = speedMs; foamWind.travelRad = travelRad;   // waterDetail: the foam map's drift
      const kU = Math.max(1, Math.round(Math.max(1, speedMs) * 2) / 2);
      if (kU !== keyU || travelRad !== keyRad) { keyU = kU; keyRad = travelRad; keyStr = `${kU.toFixed(1)}|${travelRad.toFixed(2)}`; }   // refactor-3 B2: the key string only when its inputs move
      const key = keyStr;
      let changed = false;
      if (seaReady) { T = seaReady; tKey = T.key; seaReady = null; changed = true; }   // a worker's tables landed (the key it was built for)
      if (key !== tKey) {
        if (asyncSea && T) { if (seaBusy !== key && seaWant?.key !== key) seaPost(kU, travelRad, key); }   // the old tables stand until the new land
        else { T = seaTables({ speedMs: kU, travelRad, seed, fades: m1 ? FADES.v1 : FADES.m5c }); tKey = key; changed = true; }   // #56 M1: v1's short-wave fades
      }
      const w = seaWeights({ U: speedMs, fetchM, x, z });
      const kT = parseFloat(tKey);   // the speed the tables were built for (kU, or the last a worker built while a new one is under way)
      const rL = hsLaw(speedMs, V1_SEA.lakeFetchKm * 1000) / hsLaw(kT, V1_SEA.lakeFetchKm * 1000), rB = hsLaw(speedMs, V1_SEA.bayFetchKm * 1000) / hsLaw(kT, V1_SEA.bayFetchKm * 1000);
      const wt = wLast === wtA ? wtB : wtA;   // refactor-3 B2: two weight records in turn (wLast keeps the last composed one)
      for (let i = 0; i < 4; i++) wt.lake[i] = w.lake[i] * rL;
      wt.bay = w.bay * rB;
      // #21, #25: the sea field: its map (rebuilt when the wind's direction moves 2°; a live page spreads the trace over frames,
      // a capture traces it here), the boat's sea as its reference (the gain at the boat is 1), the uniform each frame (64 B)
      if (sea.update(travelRad, asyncSea ? SEA_BUDGET : Infinity)) device.queue.writeTexture({ texture: seaTex }, sea.half, { bytesPerRow: sea.field.n * 2 }, [sea.field.n, sea.field.n]);
      sea.setRef({ U: speedMs, T, rL, rB, x, z });
      device.queue.writeBuffer(seaBuf, 0, sea.uniform);
      // #56 M1: the whitecaps' threshold (v1's gpuBridge jacQuantile): the 12 m tile's turbulence at the caps' share for the wind
      // (render/water-surface.js capShare); none until the first read. v1 took it every 30th read from 4096 texels (a
      // handful under J0) and half-stepped to it, while the tile's few deep folds made the share under a held J0 swing 3× in
      // seconds: every cap on the lake whitened and cleared together. Now the whole tile's own quantile (render/water-surface.js
      // whitecapJ0Field: every 4th texel, one pass) every SURF.j0Every-th read, glided to, so its share of foam stays put
      if (m1 && surface.adopted >= jNext) {
        jNext = surface.adopted + SURF.j0Every;
        jAim = whitecapJ0Field(surface.field, OFFSETS[2] * 4, 65536, 4, Math.min(0.4, capShare(speedMs) * capK), jHist);
        if (!jSeen) { surfU[7] = jAim; jSeen = true; jRead = surface.adopted; device.queue.writeBuffer(surfBuf, 0, surfU); }
      }
      if (jSeen && surface.adopted !== jRead) {
        surfU[7] = j0Glide(surfU[7], jAim, surface.adopted - jRead); jRead = surface.adopted;
        device.queue.writeBuffer(surfBuf, 0, surfU);
      }
      const moved = !wLast || wt.lake.some((v, i) => Math.abs(v - wLast.lake[i]) > 0.01 * Math.max(v, wLast.lake[i], 0.05)) || Math.abs(wt.bay - wLast.bay) > 0.01 * Math.max(wt.bay, wLast.bay, 0.05);
      mix = { ...w, fetchM, speedMs };
      if (!changed && !moved) return false;
      wLast = wt;
      h0 = composeSea(T, wt, h0 ?? undefined);
      hs = seaStats(h0, tileSq);   // = significantHeight(h0, LENGTHS, CPU_CASCADES), with each tile's Σ h0² (refactor-3 B2: one pass)
      const shares = bayShares(T, wt, shareBuf);
      surface.setBayShares(shares);
      device.queue.writeBuffer(h0Buf, 0, h0);
      // #56 M1: each displacement tile's Hs (the MTF's and the crest's scale) and the bay's shares at the boat (the slope gain's
      // fallback where the sea field has no map yet)
      for (let c = 0; c < CPU_CASCADES; c++) { surfU[c] = 4 * Math.sqrt(tileSq[c]); surfU[4 + c] = shares[c]; }
      device.queue.writeBuffer(surfBuf, 0, surfU);
      return true;
    },
    // the readback window's centre for this frame (F.grid's x, z): the boat's spot (M3) so its hull sits inside the 21 m
    // window of the 85 m cascade; the mesh itself is centred on the eye in the vertex shader (snapped to the first cell)
    centreFor(wx, wz, t) { centre.x = Math.floor(wx / s0) * s0; centre.z = Math.floor(wz / s0) * s0; centre.t = t; return centre; },
    // the water-sim compute pass: evolve, the FFT (2 dispatches of 8 stages), assemble, the mips. step (perf(v2) phone):
    //   true | 'full' the whole step;  false | 'skip' none (the textures stand; the wake's maps still follow the boat);
    //   'a' | 'b' (round 2, the phone path's simSplit) the step over two frames: 'a' the evolve and the rows' FFT, 'b' the
    //   columns' FFT, the assemble and the mips: each frame half the work, the waves still at the half rate (the P and Q
    //   buffers are read by nothing else between). Under waterCascades 3 the 2.1 m cascade runs one step in FULL_EVERY,
    //   then its layer is flattened to its roughness (FLAT3_WGSL); the mips are the fused chain (MIP4_WGSL) on the phone path
    run(pass, ctx, c, step = true) {
      const st = step === true ? 'full' : step === false ? 'skip' : step;
      if (!foamBaked) {   // #56 M1: Ultra's foam texture, once (the first frame), then its mips
        foamBaked = true;
        pass.setPipeline(reg.get('water-foam-bake')); pass.setBindGroup(0, bgBake); pass.dispatchWorkgroups(FOAM_TEX / 8, FOAM_TEX / 8, 1); c.dispatches++;
        pass.setPipeline(reg.get('water-mip'));   // every layer's mips (the cascades' are rebuilt by the step below)
        for (let l = 0; l < LOG_N; l++) { const gg = Math.ceil((N >> (l + 1)) / 8); pass.setBindGroup(0, bgMip[1][l]); pass.dispatchWorkgroups(gg, gg, C + 1); c.dispatches++; }
      }
      if (st === 'skip') { wake?.run(pass, c); return; }
      if (st !== 'b') { waveTa = centre.t; }
      const full = look.cascades === C || steps % FULL_EVERY === 0, Cn = full ? C : look.cascades, g = Math.ceil(Cn * NN / 256);
      if (st === 'full' || st === 'a') {
        pass.setPipeline(reg.get('water-evolve')); pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bgEvolve); pass.dispatchWorkgroups(g); c.dispatches++;
        pass.setPipeline(reg.get('water-fft')); pass.setBindGroup(0, bgPQ); pass.setBindGroup(1, bgStage, [0]); pass.dispatchWorkgroups(Cn * N); c.dispatches++;   // the rows P → Q (8 stages in workgroup memory)
      }
      if (st === 'full' || st === 'b') {
        pass.setPipeline(reg.get('water-fft')); pass.setBindGroup(0, bgQP); pass.setBindGroup(1, bgStage, [256]); pass.dispatchWorkgroups(Cn * N); c.dispatches++;   // the columns Q → P
        pass.setPipeline(reg.get('water-assemble')); pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bgAssemble); pass.dispatchWorkgroups(g); c.dispatches++;
        if (look.fused) {
          pass.setPipeline(reg.get('water-mip4'));
          for (let t = 0; t < 2; t++) for (let k = 0; k < 2; k++) { const n1 = N >> (4 * k + 1), w = Math.ceil(n1 / 8); pass.setBindGroup(0, bgMip4[t][k]); pass.dispatchWorkgroups(w, w, Cn); c.dispatches++; }
        } else {
          pass.setPipeline(reg.get('water-mip'));
          for (let l = 0; l < LOG_N; l++) { const sz = N >> (l + 1), gg = Math.ceil(sz / 8); for (let t = 0; t < 2; t++) { pass.setBindGroup(0, bgMip[t][l]); pass.dispatchWorkgroups(gg, gg, Cn); c.dispatches++; } }
        }
        if (full && look.cascades < C) {   // the 2.1 m layer measured this step: its roughness at every texel from now on
          pass.setPipeline(reg.get('water-flat3'));
          for (let l = 0; l < LOG_N; l++) { const gg = Math.ceil((N >> l) / 8); pass.setBindGroup(0, bgFlat[l]); pass.dispatchWorkgroups(gg, gg, 1); c.dispatches++; }
        }
        if (foamMap) foamMap.run(pass, c, frameBG, U.byteOffset, centre, centre.t, foamWind.speedMs, foamWind.travelRad);   // waterDetail, fix 2
        assembled = true; waveT = st === 'b' ? waveTa : centre.t; steps++;
      }
      wake?.run(pass, c);   // wake: its Kelvin and foam maps for this frame (render/wake.js)
    },
    draw(pass, c, terrainBG) {
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bgDrawP[foamMap ? foamMap.parity : 0][look.aniso === 8 ? 0 : 1]); pass.setBindGroup(3, terrainBG);
      pass.setPipeline(reg.get(UNDER_STATE.on && reg.has?.('water-under') ? 'water-under' : (look.lite ? reg.has?.('water-lite') !== false : reg.has?.('water') === false) ? 'water-lite' : 'water'));   // perf(v2) iOS pipelines: the built variant until the other is in   // phase 2a: the surface from below while the eye is under
      if (look.grid === 'coarse') { pass.setIndexBuffer(ibufCoarse, 'uint32'); pass.drawIndexed(coarseIdx.length); c.triangles += coarseIdx.length / 3; }
      else { pass.setIndexBuffer(ibuf, 'uint32'); pass.drawIndexed(idx.length); c.triangles += quads * 2; }
      c.calls++;
    },
    heightAt: (x, z, o) => surface.heightAt(x, z, o),   // o: the hull's filters and the wave clock's t (v2/sim/surface.js; none: the drawn surface)
    velocityAt: (x, z, o, out) => surface.velocityAt(x, z, o, out),   // #21: the waves' orbital velocity (v1's orbitAt)
    seaField: sea,   // #21, #25: the fetch map, the reference, the CPU gains (the tests and the harness)
    // the foam's memory back to its start (M3: a capture's settle renders a few frames to fill the readback ring before
    // the boat settles; without this the foam had recovered by those frames and the M2 goldens moved by 0.3 %)
    resetFoam() { device.queue.writeBuffer(turbBuf, 0, new Float32Array(count).fill(1)); foamMap?.reset(); },
    detail,   // waterDetail: the variation layer, the turned 2.1 m layer and the persistent foam (src/core/features.js waterDetail)
  };
}
