// The shore and island boulders (M5c): v1's rounded granite lumps (src/landmarks.js boulders(): an icosahedron squashed
// and lumped, instanced) on v1's rules (v2/terrain/rocks-rules.js: the shore band, about half of it, never a beach; the
// rules' rocks on open 20–50° ground), scattered on the GPU from the same heights and cover the terrain bakes (one
// candidate per 8 m cell over the bay's 2 m grid box: 315 k slots, re-run at every grid swap), culled per frame (the
// frustum, the screen size), one indirect instanced draw. Lit as the terrain is (the M1 sun through the transmittance
// LUT, the sky, the terrain's shadow, the aerial perspective, the clouds); below the waterline the rock is seen through
// the water column as the bed is (the same numbers: no seam at the surface); wet and dark in the wash. The culled set
// casts into the terrain shadow map (render/shadow.js). Deterministic: hashes of the cell; the shore rocks' cull appends
// with an atomic (goldens:v2 --twice holds it). The bed's stones do not: their draw order moved terrain pixels (on this
// Mac's GPU the terrain's dpdx near hidden stones changed with the order, 1-12 levels at the far waterline), so their
// placed list and their near and far lists keep a fixed order (slot order; fix/v2-boulders-determinism).
import { TERRAIN_BIND, TERRAIN_HEIGHT, COVER_BIND, GROUND_WGSL, WATER_WGSL } from './terrain.js';
import { ATMO_WGSL, SKY_READ, AP_READ, LAND_SKY, LAND_LOOK } from './sky.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { ROCKS, ROCKS_WGSL, SLOT_COUNT, COLS } from '../terrain/rocks-rules.js';
import { frustumPlanes } from '../terrain/quadtree.js';
import { BED, BED_HASH_WGSL, BED_CELL_WGSL, BED_MORAINE_WGSL, BIG, PHOTO_LOOK, TINT_SHELF, WATER_LOOK, WARP_WGSL, IMAGE_SCATTER, DIRECT_SHARE } from './bed.js';
import { CAUSTIC_WGSL } from './caustics.js';
import { UNDERWATER_WGSL } from './underwater.js';
import { UNDER_WGSL } from './underMedium.js';   // play as Tessie, phase 2a
import { underPipe } from './underState.js';
import { NIGHT } from '../sim/night.js';
import { BED3D } from '../sim/bedBoulders.js';

export const CAP = 65536;   // visible boulders a frame
export const PLACED_CAP = 131072;   // rocks placed over the box (the twin counts ≈ 40 k; the scatter drops any past this)
// feat/v2-boulders-3d: the bed's 3D stones (a desktop and a tablet at L0-L1): their own placed room, the visible cap, the
// painted big layer's cells over the same box (render/bed.js BIG: one candidate a cell, as the paint)
export const BED_PLACED = 262144, BED_CAP_NEAR = 8192, BED_CAP_FAR = 24576;
const bedGrid = (L) => { const ix0 = Math.floor(ROCKS.box.x0 / L.cell), iz0 = Math.floor(ROCKS.box.z0 / L.cell); return { ix0, iz0, cols: Math.ceil(ROCKS.box.x1 / L.cell) - ix0, rows: Math.ceil(ROCKS.box.z1 / L.cell) - iz0 }; };
// the painted layers' grids, then the emergent stones' (round 2): one slot a cell each
export const BED_GRIDS = [...BIG.layers, BED3D.emerge].map(bedGrid);
const BL_N = BED_GRIDS.length;   // the painted layers, then the emergent stones (the last)
const BED_REGION_MAX = 4;   // BED_REGION.maxDiscs (below)
export const BED_SLOTS = BED_GRIDS.reduce((n, g) => n + g.cols * g.rows, 0);
export const BED_W = Math.ceil(BED_SLOTS / 64);   // the bed scatter's workgroups at most (64 slots each): its counts and first indices
// (owner, 2026-11-19: "Do we need to load all the stones at once? Shall we load stones based on birthplace?"):
// the bed's stones are placed only round the player's regions (v2/living/busyLake.js REGIONS: the one she is in and its
// neighbours, each a disc of its radius + BED_REGION.marginM), not over the whole box. The scatter runs over the window (each
// layer's cells inside the discs' bounding box, cut to the box) and skips a cell outside every disc, so a future whole lake pays
// only where people sail. Deterministic: a stone is its cell's (the same hash wherever the window lies) and the placed list keeps
// the window's slot order; one window → one list. bedWindow(null) is the whole box (no regions: v1's waters, a URL start far off)
export const BED_REGION = Object.freeze({ marginM: 250, maxDiscs: 4 });
const BED_CELLS = [...BIG.layers, BED3D.emerge].map((l) => l.cell);
export function bedWindow(discs = null, G = BED_GRIDS) {
  const B = ROCKS.box, ds = (discs ?? []).slice(0, BED_REGION.maxDiscs);
  let x0 = B.x0, z0 = B.z0, x1 = B.x1, z1 = B.z1;
  if (ds.length) {
    x0 = Math.max(B.x0, Math.min(...ds.map((d) => d[0] - d[2]))); x1 = Math.min(B.x1, Math.max(...ds.map((d) => d[0] + d[2])));
    z0 = Math.max(B.z0, Math.min(...ds.map((d) => d[1] - d[2]))); z1 = Math.min(B.z1, Math.max(...ds.map((d) => d[1] + d[2])));
  }
  let end = 0;
  const layers = G.map((g, i) => {
    const c = BED_CELLS[i];
    const ixa = Math.max(g.ix0, Math.floor(x0 / c)), ixb = Math.min(g.ix0 + g.cols, Math.ceil(x1 / c));
    const iza = Math.max(g.iz0, Math.floor(z0 / c)), izb = Math.min(g.iz0 + g.rows, Math.ceil(z1 / c));
    const cols = Math.max(0, ixb - ixa), rows = cols > 0 ? Math.max(0, izb - iza) : 0;
    end += cols * rows;
    return { ix0: ixa, iz0: iza, cols, rows, end };
  });
  return { layers, discs: ds, slots: end, W: Math.ceil(end / 64), key: JSON.stringify(ds) };
}
// the window as the scatter's uniform (BWIN): per layer (ix0, iz0, cols, end), then (workgroups, discs, 0, 0), then the discs
export const BWIN_N = BED_GRIDS.length + 1 + BED_REGION.maxDiscs;
export function bedWindowData(win, out = new Float32Array(BWIN_N * 4)) {
  out.fill(0);
  win.layers.forEach((l, i) => { out[4 * i] = l.ix0; out[4 * i + 1] = l.iz0; out[4 * i + 2] = l.cols; out[4 * i + 3] = l.end; });
  const k = 4 * win.layers.length; out[k] = win.W; out[k + 1] = win.discs.length;
  win.discs.forEach(([x, z, r], i) => { out[k + 4 + 4 * i] = x; out[k + 5 + 4 * i] = z; out[k + 6 + 4 * i] = r; });
  return out;
}
export const BED_CW = BED_PLACED / 64;   // the bed cull's workgroups at most (64 placed stones each)
export const RANGE_M = 2500, MIN_PX = 0.7;
// v1's two granite tones (landmarks.js: 0x5d5a54 → 0x8a867c by a noise, read pale under v1's AgX and sun), linear,
// lifted to the clarity bed's weathered granite (clarity-optics.js BED.graniteDark … granite) so the shore reads as v1's
export const TONES = Object.freeze([[0.26, 0.245, 0.215], [0.60, 0.565, 0.49]]);

const HASH_WGSL = `
fn hashU(x: u32) -> u32 { var h = x; h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return h; }
fn cellHash(i: i32, j: i32, k: i32) -> f32 { return f32(hashU((bitcast<u32>(i) * 73856093u) ^ (bitcast<u32>(j) * 19349663u) ^ (bitcast<u32>(k) * 83492791u)) >> 8u) / 16777216.0; }`;
const PACK_WGSL = `
// a record: x, y, z and the packed rest: r (0.01 m, 10 bits), yaw (8), tone (8), kind (2: 0 shore, 1 slope, 2 the bed's 3D
// stone), valid (1); a bed stone packs r (10), its height over r × flat (8), its stretch (4) and tone (4) instead
fn packRock(r: f32, yaw: f32, tone: f32, kind: f32, valid: bool) -> f32 {
  let b = min(u32(r * 100.0 + 0.5), 1023u) | (min(u32(yaw / 6.2831853 * 255.0 + 0.5), 255u) << 10u) | (min(u32(tone * 255.0 + 0.5), 255u) << 18u) | (u32(kind) << 26u) | (select(0u, 1u, valid) << 28u);
  return bitcast<f32>(b);
}
fn packBed(r: f32, aFrac: f32, st: f32, tone: f32, emerge: bool) -> f32 {
  let b = min(u32(r * 100.0 + 0.5), 1023u) | (min(u32(clamp(aFrac, 0.0, 1.0) * 255.0 + 0.5), 255u) << 10u) | (min(u32(clamp((st - 0.78) / 0.44, 0.0, 1.0) * 15.0 + 0.5), 15u) << 18u)
    | (min(u32(tone * 15.0 + 0.5), 15u) << 22u) | (2u << 26u) | (1u << 28u) | (select(0u, 1u, emerge) << 29u);
  return bitcast<f32>(b);
}
fn packBedT(r: f32, aFrac: f32, st: f32, tone: f32, emerge: bool, tilt: u32) -> f32 { return bitcast<f32>(bitcast<u32>(packBed(r, aFrac, st, tone, emerge)) | ((tilt & 3u) << 30u)); }
fn rockKind(b: u32) -> u32 { return (b >> 26u) & 3u; }
fn bedTilt(b: u32) -> u32 { return (b >> 30u) & 3u; }
fn bedA(b: u32) -> f32 { return f32((b >> 10u) & 255u) / 255.0; }
fn bedSt(b: u32) -> f32 { return 0.78 + f32((b >> 18u) & 15u) / 15.0 * 0.44; }
fn bedTone(b: u32) -> f32 { return f32((b >> 22u) & 15u) / 15.0; }
fn bedEmerge(b: u32) -> bool { return ((b >> 29u) & 1u) == 1u; }
fn rockR(b: u32) -> f32 { return f32(b & 1023u) * 0.01; }
fn rockYaw(b: u32) -> f32 { return f32((b >> 10u) & 255u) / 255.0 * 6.2831853; }
fn rockTone(b: u32) -> f32 { return f32((b >> 18u) & 255u) / 255.0; }
fn rockValid(b: u32) -> bool { return ((b >> 28u) & 1u) == 1u; }`;

export const scatterWgsl = ({ bed = false } = {}) => `
${TERRAIN_BIND(0)}
${COVER_BIND(1)}
${TERRAIN_HEIGHT}
${GROUND_WGSL}
${HASH_WGSL}
${PACK_WGSL}
${ROCKS_WGSL}
@group(2) @binding(0) var<storage, read_write> inst: array<vec4f>;
@group(2) @binding(1) var<storage, read_write> cnt: array<atomic<u32>, 4>;   // the rocks placed, the cull's workgroups, 1, 1 (dispatchWorkgroupsIndirect)
${bed ? BED_SCATTER_WGSL : ''}
// the slots with a rock, packed (the cull then runs over the rocks alone, not the 315 k cells; the order is the GPU's,
// and the draw is opaque and depth-tested, so the image does not depend on it)
@compute @workgroup_size(64) fn scatterMain(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= RK_N) { return; }
  let o = rockSlot(i32(i % RK_COLS), i32(i / RK_COLS));
  if (!o.valid) { return; }
  let slot = atomicAdd(&cnt[0], 1u);
  if (slot >= arrayLength(&inst)) { return; }
  inst[slot] = vec4f(o.x, o.y, o.z, packRock(o.r, o.yaw, o.tone, o.kind, true));
}
@compute @workgroup_size(1) fn scatterDone() { let n = min(atomicLoad(&cnt[0]), arrayLength(&inst)); atomicStore(&cnt[0], n); atomicStore(&cnt[1], (n + 63u) / 64u); atomicStore(&cnt[2], 1u); atomicStore(&cnt[3], 1u); }`;
export const SCATTER_WGSL = scatterWgsl();
const v3b = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
// the bed's 3D stones (feat/v2-boulders-3d): one candidate in each of the painted big layers' cells, kept exactly where the
// paint keeps one (the same hash, centre, radius and density at the cell's centre), cut to the clearance rule (v2/sim/
// bedBoulders.js topMax: no keel or hull ever meets one), none in the clear zones (moorings, boats at anchor, the starts)
const BED_SCATTER_WGSL = `
@group(2) @binding(2) var<storage, read_write> binst: array<vec4f>;
@group(2) @binding(3) var<storage, read_write> bcnt: array<atomic<u32>, 4>;
@group(2) @binding(4) var<uniform> ZN: array<vec4f, 64>;   // the clear zones: x, z, r (r 0: unused)
@group(2) @binding(5) var<storage, read_write> bwg: array<u32>;   // per workgroup of 64 slots: its stones' count, then (from BED_W) its first stone's index
@group(2) @binding(6) var<uniform> BWIN: array<vec4f, ${BWIN_N}>;   // the regions' window (bedWindowData)
${BED_HASH_WGSL}
${BED_CELL_WGSL}
${BED_MORAINE_WGSL}
const BB_FLATS = ${BIG.flats}; const BB_R0 = ${BIG.rocky[0]}; const BB_R1 = ${BIG.rocky[1]}; const BB_D0 = ${BIG.depthFull}.0; const BB_D1 = ${BIG.depthNone}.0;
const BB_MOR = ${BIG.moraine.k.toFixed(2)}; const EM_MOR = ${BED3D.emerge.moraine.toFixed(2)};
const BB_DP = ${BIG.depthPack}.0; const BB_DS = ${BIG.deepShare}; const BB_PATCHY = ${BIG.patchy};
const BB_FLAT = ${BED3D.flat}; const BB_MINA = ${BED3D.minA}; const BB_SINKS = ${BED3D.sinkSlope}; const BB_STACK = ${BED3D.stack};
const BB_KEEL = ${(BED3D.keel + BED3D.under).toFixed(3)}; const BB_BAND0 = ${BED3D.band[0]}; const BB_BAND1 = ${BED3D.band[1]}; const BB_BR0 = ${BED3D.breach[0]}; const BB_BR1 = ${BED3D.breach[1]}; const BB_WADE = ${BED3D.wade};
const BL_CELL = array<f32, ${BL_N}>(${[...BIG.layers, BED3D.emerge].map((l) => l.cell.toFixed(2)).join(', ')});
const BL_R0 = array<f32, ${BL_N}>(${[...BIG.layers, BED3D.emerge].map((l) => l.rMin.toFixed(2)).join(', ')});
const BL_R1 = array<f32, ${BL_N}>(${[...BIG.layers, BED3D.emerge].map((l) => l.rMax.toFixed(2)).join(', ')});
const BL_SALT = array<f32, ${BL_N}>(${[...BIG.layers, BED3D.emerge].map((l) => l.salt.toFixed(2)).join(', ')});
const BL_DENS = array<f32, ${BL_N}>(${[...BIG.layers, BED3D.emerge].map((l) => l.density.toFixed(2)).join(', ')});
// the window's slots: layer li's cells (ix0, iz0, cols) end at slot BWIN[li].w; BWIN[BL_N]: the workgroups, the discs
fn blEnd(li: u32) -> u32 { return u32(BWIN[li].w); }
fn bedWg() -> u32 { return u32(BWIN[${BL_N}].x); }
// a cell centre inside one of the regions' discs (none given: everywhere)
fn inRegion(c: vec2f) -> bool {
  let n = u32(BWIN[${BL_N}].y); if (n == 0u) { return true; }
  for (var q = 0u; q < ${BED_REGION_MAX}u; q++) { if (q < n) { let d = BWIN[${BL_N + 1} + q]; if (dot(c - d.xy, c - d.xy) < d.z * d.z) { return true; } } }
  return false;
}
const EM_H0 = ${BED3D.emerge.h[0]}; const EM_H1 = ${BED3D.emerge.h[1]}; const EM_S0 = ${BED3D.emerge.steep[0]}; const EM_S1 = ${BED3D.emerge.steep[1]};
const EM_TARGET = ${BED3D.emerge.target}; const EM_R0 = ${BED3D.emerge.rMin}; const EM_R1 = ${BED3D.emerge.rMax}; const EM_LONE = ${BED3D.emerge.lone}; const EM_SLAB = ${BED3D.emerge.slab}; const EM_CL = ${BED3D.emerge.cluster}.0; const EM_ISLE = vec4f(${BED3D.emerge.isle.map((x) => x.toFixed(1)).join(', ')}); const EM_SINK = ${BED3D.emerge.sink};
// the highest a stone's top may stand over dep m of water (v2/sim/bedBoulders.js topMax)
fn topMax(dep: f32) -> f32 {
  if (dep <= BB_BR0) { return BB_BR1; }
  if (dep <= BB_BAND0) { return mix(BB_BR1, BB_WADE, (dep - BB_BR0) / (BB_BAND0 - BB_BR0)); }
  if (dep < BB_BAND1) { return -dep - 2.0; }
  return -BB_KEEL;
}
fn bigDepthK(dep: f32) -> f32 { return mix(1.0, BB_DS, smoothstep(BB_DP, BB_D0, dep)) * (1.0 - smoothstep(BB_D0, BB_D1, dep)); }
fn slopeAt(x: f32, z: f32) -> f32 { return length(vec2f(terrainHeight(x + 2.0, z) - terrainHeight(x - 2.0, z), terrainHeight(x, z + 2.0) - terrainHeight(x, z - 2.0))) / 4.0; }
fn inZone(x: f32, z: f32) -> bool {
  for (var q = 0; q < 64; q++) { let zq = ZN[q]; if (zq.z > 0.0 && dot(vec2f(x, z) - zq.xy, vec2f(x, z) - zq.xy) < zq.z * zq.z) { return true; } }
  return false;
}
// the painted big stone of layer 0 under point c (its centre, radius, stretch, clamped height and centre height), if it is there
struct Big0 { on: bool, c: vec2f, r: f32, st: f32, a: f32, cy: f32 }
fn big0At(c: vec2f) -> Big0 {
  var o: Big0; o.on = false;
  let id = floor(c / BL_CELL[0]);
  let bc = bedCellAt(id, BL_CELL[0], BL_R0[0], BL_R1[0], BL_SALT[0]);
  let h = terrainHeight(bc.c.x, bc.c.y); let dep = -h;
  if (dep <= 0.0 || dep > BB_D1) { return o; }
  let steep = slopeAt(bc.c.x, bc.c.y);
  let dk = max(mix(BB_FLATS, 1.0, smoothstep(BB_R0, BB_R1, steep)), bedMoraine(bc.c) * BB_MOR) * (bedPatchy(bc.c) * BB_PATCHY + 1.0 - BB_PATCHY) * bigDepthK(dep);
  if (bc.hx >= BL_DENS[0] * dk) { return o; }
  let sink = bc.r * BB_SINKS * min(steep, 1.0) + 0.05;
  o.a = min(bc.r * BB_FLAT, topMax(dep) + dep + sink); o.cy = h - sink; o.on = o.a >= BB_MINA;
  o.c = bc.c; o.r = bc.r; o.st = bc.st;
  return o;
}
// a cheap value noise on the cell hash (the emergent stones' clusters)
fn vnoiseH(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i).x, hash2(i + vec2f(1.0, 0.0)).x, u.x), mix(hash2(i + vec2f(0.0, 1.0)).x, hash2(i + vec2f(1.0, 1.0)).x, u.x), u.y);
}
// a slot's stones (none to 3): their count; with put, each written from index base on in the slot's own order (bedWrite:
// the placed list in slot order, never the GPU's, so it and the cull's lists after it are the same on every load)
fn bedPut(put: bool, base: u32, n: ptr<function, u32>, rec: vec4f) {
  if (put && base + *n < arrayLength(&binst)) { binst[base + *n] = rec; }
  atomicAdd(&wgSum, 1u);   // bedCount's sum; in bedWrite it only keeps Metal's compiler from unrolling the slot's loops (without an atomic here the pipeline took over a minute to build)
  *n += 1u;
}
fn bedSlot(k: u32, put: bool, base: u32) -> u32 {
  var o = 0u;
  if (k >= blEnd(${BL_N - 1}u)) { return o; }
  var li = 0u; for (var q = 0u; q < ${BL_N - 1}u; q++) { if (k >= blEnd(q)) { li = q + 1u; } }
  var j = k; if (li > 0u) { j = k - blEnd(li - 1u); }
  let cols = max(u32(BWIN[li].z), 1u);
  let id = vec2f(BWIN[li].x + f32(j % cols), BWIN[li].y + f32(j / cols));
  if (!inRegion((id + 0.5) * BL_CELL[li])) { return o; }   // outside the player's regions
  let bc = bedCellAt(id, BL_CELL[li], BL_R0[li], BL_R1[li], BL_SALT[li]);
  let x = bc.c.x; let z = bc.c.y;
  let h = terrainHeight(x, z);
  let steep = slopeAt(x, z);
  let tone = hash2(id + BL_SALT[li] + 5.7).x;
  if (li == ${BL_N - 1}u) {
    // round 3 (irregular clusters of 2-3 with real gaps, no even row): each cell is only a chance of a cluster seed,
    // anywhere in the cell (no rhythm); the seed lives where the shore is steep, on a point (the land higher than its
    // surroundings 25 m round) and outside the empty stretches (a 90 m noise); a seed is a lone big block (EM_LONE of them) or
    // 2-3 stones of mixed size round it (1 m cobbles to 7 m blocks, some tilted flat slabs), each moved onto the waterline
    let s0 = hash2(id + 71.3); let s1 = hash2(id + 13.9);
    let seed = (id + s0) * BL_CELL[li];
    let hs = terrainHeight(seed.x, seed.y);
    if (hs < -6.0 || hs > 6.0) { return o; }   // nowhere near the waterline
    let avg = 0.25 * (terrainHeight(seed.x + 25.0, seed.y) + terrainHeight(seed.x - 25.0, seed.y) + terrainHeight(seed.x, seed.y + 25.0) + terrainHeight(seed.x, seed.y - 25.0));
    let point = smoothstep(0.3, 3.0, hs - avg);
    let isle = select(1.0, EM_ISLE.w, distance(seed, EM_ISLE.xy) < EM_ISLE.z);
    let gaps = smoothstep(0.3, 0.5, vnoiseH(seed / EM_CL));
    let dk = max(smoothstep(EM_S0, EM_S1, slopeAt(seed.x, seed.y)), bedMoraine(seed) * EM_MOR) * gaps * (0.5 + 1.2 * point) * isle;   // the moraine's gentle shores too
    if (s1.x >= BL_DENS[li] * dk) { return o; }
    let lone = s1.y < EM_LONE;
    let n = select(2u + u32(hash2(id + 3.3).x * 1.999), 1u, lone);
    for (var m = 0u; m < n; m++) {
      let hm = hash2(id + f32(m) * 7.77 + 2.2); let hn = hash2(id + f32(m) * 5.31 + 9.4);
      var q = seed + vec2f(cos(hm.x * 6.2831853), sin(hm.x * 6.2831853)) * select(1.5 + hm.y * 3.5, 0.0, lone);
      var hq = terrainHeight(q.x, q.y);
      for (var it = 0; it < 4; it++) {
        let g = vec2f(terrainHeight(q.x + 1.0, q.y) - terrainHeight(q.x - 1.0, q.y), terrainHeight(q.x, q.y + 1.0) - terrainHeight(q.x, q.y - 1.0)) * 0.5;
        let g2 = max(dot(g, g), 1e-4);
        q = q - g * clamp((hq - mix(EM_TARGET, 0.1, hn.y)) / g2, -6.0, 6.0);   // some at the wash, some just up the shore
        hq = terrainHeight(q.x, q.y);
      }
      if (hq < EM_H0 || hq > EM_H1 || distance(q, seed) > 9.0 || inZone(q.x, q.y)) { continue; }
      // the size: a lone block 5.2-7 m; in a cluster mostly small (1-3 m) with now and then a big one (a skewed draw)
      let r = select(mix(EM_R0, EM_R1, pow(hn.x, 1.8)), mix(EM_R1 * 0.75, EM_R1, hn.x), lone);
      let slab = hm.y > 1.0 - EM_SLAB;   // a tilted, flattened slab
      let aF = select(1.0, 0.42, slab);
      let tilt = select(0u, 1u + u32(hn.y * 2.999), slab);
      let st = mix(0.78, 1.22, hash2(id + f32(m) * 3.7).x);
      bedPut(put, base, &o, vec4f(q.x, hq - r * EM_SINK * select(1.0, 0.4, slab), q.y, packBedT(r, aF, st, hash2(id + f32(m) * 1.9).y, true, tilt)));
    }
    return o;
  }
  let dep = -h;
  if (dep <= 0.0 || dep > BB_D1) { return o; }
  let rocky = max(mix(BB_FLATS, 1.0, smoothstep(BB_R0, BB_R1, steep)), bedMoraine(bc.c) * BB_MOR);   // the mouth's moraine (the paint's rule)
  let dk = rocky * (bedPatchy(bc.c) * BB_PATCHY + 1.0 - BB_PATCHY) * bigDepthK(dep);
  if (bc.hx >= BL_DENS[li] * dk || inZone(x, z)) { return o; }
  let sink = bc.r * BB_SINKS * min(steep, 1.0) + 0.05;
  var cy = h - sink;
  var a = min(bc.r * BB_FLAT, topMax(dep) - cy);
  // stacked: a smaller stone on a big one's dome sits on it (BB_STACK of them), its top still kept to the rule
  if (li > 0u && hash2(id + BL_SALT[li] + 9.1).x < BB_STACK) {
    let g = big0At(bc.c);
    if (g.on) {
      let q = bc.c - g.c; let rho2 = (q.x * g.st) * (q.x * g.st) / (g.r * g.r) + (q.y / g.st) * (q.y / g.st) / (g.r * g.r);
      if (rho2 < 0.7) {
        let cyS = g.cy + g.a * sqrt(1.0 - rho2) - 0.3 * bc.r * BB_FLAT;
        let aS = min(bc.r * BB_FLAT, topMax(dep) - cyS);
        if (aS >= BB_MINA && cyS > cy) { cy = cyS; a = aS; }
      }
    }
  }
  if (a < BB_MINA) { return o; }
  bedPut(put, base, &o, vec4f(x, cy, z, packBed(bc.r, a / (bc.r * BB_FLAT), bc.st, tone, false)));
  return o;
}
fn bedDone() { let n = min(atomicLoad(&bcnt[0]), arrayLength(&binst)); atomicStore(&bcnt[0], n); atomicStore(&bcnt[1], (n + 63u) / 64u); atomicStore(&bcnt[2], 1u); atomicStore(&bcnt[3], 1u); }
// the placed list in slot order (fix/v2-boulders-determinism): an atomic append put the stones in the GPU's order, which
// changed with every load, and the far stones' draw order then moved pixels at the waterline. Three passes, once per
// scatter: bedCount counts each workgroup's stones (and keeps each slot's count, 2 bits), bedScan sums the counts in
// workgroup order, bedWrite has each workgroup with stones write them from its first index, its lanes in slot order
const BED_W = ${BED_W}u; const BW_BITS = ${2 * BED_W}u;   // bwg: the counts, the first indices, the slots' counts
var<workgroup> wgSum: atomic<u32>;
var<workgroup> wgBits: array<atomic<u32>, 4>;
var<workgroup> wgN: u32;
var<workgroup> wgScan: array<u32, 256>;
@compute @workgroup_size(64) fn bedCount(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) l: u32) {
  let w = wid.x + wid.y * 65535u; if (w >= bedWg()) { return; }
  let c = bedSlot(w * 64u + l, false, 0u);
  atomicOr(&wgBits[l / 16u], c << ((l % 16u) * 2u));
  workgroupBarrier();
  if (l == 0u) { bwg[w] = atomicLoad(&wgSum); }
  if (l < 4u) { bwg[BW_BITS + w * 4u + l] = atomicLoad(&wgBits[l]); }
}
@compute @workgroup_size(64) fn bedWrite(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) l: u32) {
  let w = wid.x + wid.y * 65535u; if (w >= bedWg()) { return; }
  if (l == 0u) { wgN = bwg[w]; }
  if (workgroupUniformLoad(&wgN) == 0u) { return; }
  let n = (bwg[BW_BITS + w * 4u + l / 16u] >> ((l % 16u) * 2u)) & 3u;
  wgScan[l] = n; workgroupBarrier();
  for (var s = 1u; s < 64u; s = s << 1u) { var t = 0u; if (l >= s) { t = wgScan[l - s]; } workgroupBarrier(); wgScan[l] += t; workgroupBarrier(); }
  if (n > 0u) { bedSlot(w * 64u + l, true, bwg[BED_W + w] + wgScan[l] - n); }
}
@compute @workgroup_size(256) fn bedScan(@builtin(local_invocation_index) l: u32) {
  var run = 0u;
  let nw = bedWg();
  for (var c = 0u; c < (nw + 255u) / 256u; c++) {
    let w = c * 256u + l; var v = 0u; if (w < nw) { v = bwg[w]; }
    wgScan[l] = v; workgroupBarrier();
    for (var o = 1u; o < 256u; o = o << 1u) { var t = 0u; if (l >= o) { t = wgScan[l - o]; } workgroupBarrier(); wgScan[l] += t; workgroupBarrier(); }
    if (w < nw) { bwg[BED_W + w] = run + wgScan[l] - v; }
    run += wgScan[255]; workgroupBarrier();
  }
  if (l == 0u) { atomicStore(&bcnt[0], run); bedDone(); }
}`;

export const cullWgsl = ({ bed = false } = {}) => `
struct RU { planes: array<vec4f, 5>, eye: vec4f, p: vec4f }   // eye: xyz, focal px;  p: range m, min px, cap, 0
@group(0) @binding(0) var<uniform> R: RU;
@group(0) @binding(1) var<storage, read> inst: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vis: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> args: array<atomic<u32>, 8>;   // drawIndexedIndirect: indexCount, instanceCount, firstIndex, baseVertex, firstInstance; [5] the total
@group(0) @binding(4) var<storage, read> cnt: array<u32, 4>;
${bed ? `@group(0) @binding(5) var<storage, read> binst: array<vec4f>;
@group(0) @binding(6) var<storage, read> bcnt: array<u32, 4>;
@group(0) @binding(7) var<storage, read_write> bvis: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> bargs: array<atomic<u32>>;   // the near draw's args at 0 ([5] the total, [6] the placed), the far draw's at 8;
// from 16: per workgroup of 64 placed stones, its near count | its far count << 16, then its lanes' lists (the ordered
// cull's; the stage holds 8 buffers)` : ''}
${PACK_WGSL}
@compute @workgroup_size(1) fn reset() { atomicStore(&args[1], 0u); atomicStore(&args[5], 0u);${bed ? ' atomicStore(&bargs[1], 0u); atomicStore(&bargs[5], 0u); atomicStore(&bargs[9], 0u);' : ''} }
${bed ? `// the bed's stones: inside the grow range (BED3D.grow[1]: past it a stone has sunk into the bed and the paint holds it), an
// emergent one to BED3D.emerge.range; the near list (the 320-triangle mesh) within BED3D.lod, the far list (80) past it
// fix/v2-boulders-determinism: the lists in the placed list's order, not the GPU's (an atomic append changed the far
// stones' draw order with every load, and that order moved pixels at the waterline). Two passes a frame: cullBed counts
// each workgroup's near and far stones; cullBedPut has each workgroup with stones sum the counts before its own and write
// its stones there, its lanes in order (workgroup 0 sums them all: the draws' instance counts)
fn bedSeen(i: u32) -> u32 {   // 0 culled, 1 the near list, 2 the far list
  if (i >= bcnt[0]) { return 0u; }
  let rec = binst[i]; let b = bitcast<u32>(rec.w);
  let r = rockR(b) * 1.3;
  let d = distance(rec.xz, R.eye.xz); let d3 = distance(rec.xyz, R.eye.xyz);
  if (d > select(R.p.w, ${BED3D.emerge.range}.0, bedEmerge(b)) || r / max(d3, 1.0) * R.eye.w < R.p.y) { return 0u; }
  for (var k = 0; k < 5; k++) { if (dot(R.planes[k].xyz, rec.xyz) + R.planes[k].w < -r) { return 0u; } }
  return select(2u, 1u, d3 < ${BED3D.lod}.0 + r);
}
var<workgroup> cbN: atomic<u32>;
var<workgroup> cbF: atomic<u32>;
var<workgroup> cbW: u32;
var<workgroup> cbScan: array<u32, 64>;
var<workgroup> cbBits: array<atomic<u32>, 4>;
const CB_BITS = ${16 + BED_CW}u;   // bargs from here: each lane's list (2 bits, 4 words a workgroup), so cullBedPut need not test again
@compute @workgroup_size(64) fn cullBed(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) l: u32) {
  let k = bedSeen(wid.x * 64u + l);
  if (k == 1u) { atomicAdd(&cbN, 1u); } else if (k == 2u) { atomicAdd(&cbF, 1u); }
  atomicOr(&cbBits[l / 16u], k << ((l % 16u) * 2u));
  workgroupBarrier();
  if (l == 0u) { atomicStore(&bargs[16u + wid.x], atomicLoad(&cbN) | (atomicLoad(&cbF) << 16u)); }   // at most 64 each
  if (l < 4u) { atomicStore(&bargs[CB_BITS + wid.x * 4u + l], atomicLoad(&cbBits[l])); }
}
@compute @workgroup_size(64) fn cullBedPut(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) l: u32) {
  let w = wid.x;
  if (l == 0u) { cbW = atomicLoad(&bargs[16u + w]); }
  if (workgroupUniformLoad(&cbW) == 0u && w != 0u) { return; }
  let upto = select(w, (bcnt[0] + 63u) / 64u, w == 0u);
  var sn = 0u; var sf = 0u;
  for (var q = l; q < upto; q += 64u) { let c = atomicLoad(&bargs[16u + q]); sn += c & 0xffffu; sf += c >> 16u; }
  atomicAdd(&cbN, sn); atomicAdd(&cbF, sf);
  workgroupBarrier();
  let tn = atomicLoad(&cbN); let tf = atomicLoad(&cbF);
  if (w == 0u && l == 0u) { atomicStore(&bargs[1], min(tn, ${BED_CAP_NEAR}u)); atomicStore(&bargs[9], min(tf, ${BED_CAP_FAR}u)); atomicStore(&bargs[5], tn + tf); }
  let i = w * 64u + l; let k = (atomicLoad(&bargs[CB_BITS + w * 4u + l / 16u]) >> ((l % 16u) * 2u)) & 3u;
  let v = select(0u, select(65536u, 1u, k == 1u), k != 0u);   // near in the low half, far in the high
  cbScan[l] = v; workgroupBarrier();
  for (var s = 1u; s < 64u; s = s << 1u) { var t = 0u; if (l >= s) { t = cbScan[l - s]; } workgroupBarrier(); cbScan[l] += t; workgroupBarrier(); }
  let ex = cbScan[l] - v;
  let n0 = select(tn, 0u, w == 0u); let f0 = select(tf, 0u, w == 0u);
  if (k == 1u) { let slot = n0 + (ex & 0xffffu); if (slot < ${BED_CAP_NEAR}u) { bvis[slot] = binst[i]; } }
  else if (k == 2u) { let slot = f0 + (ex >> 16u); if (slot < ${BED_CAP_FAR}u) { bvis[${BED_CAP_NEAR}u + slot] = binst[i]; } }
}` : ''}
@compute @workgroup_size(64) fn cull(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= cnt[0]) { return; }
  let rec = inst[i]; let b = bitcast<u32>(rec.w);
  let r = rockR(b) * 1.2;
  let d = distance(rec.xyz, R.eye.xyz);
  if (d > R.p.x || r / max(d, 1.0) * R.eye.w < R.p.y) { return; }
  for (var k = 0; k < 5; k++) { if (dot(R.planes[k].xyz, rec.xyz) + R.planes[k].w < -r) { return; } }
  atomicAdd(&args[5], 1u);
  let slot = atomicAdd(&args[1], 1u);
  if (slot >= u32(R.p.z)) { atomicSub(&args[1], 1u); return; }
  vis[slot] = rec;
}`;
export const CULL_WGSL = cullWgsl();

const ROCK_VS = `
struct RV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) tone: f32 }
const SQ = vec3f(${ROCKS.squash.join(', ')});
fn rockWorld(p: vec3f, n: vec3f, rec: vec4f, wp: ptr<function, vec3f>, wn: ptr<function, vec3f>) -> f32 {
  let b = bitcast<u32>(rec.w);
  let r = rockR(b); let yaw = rockYaw(b); let c = cos(yaw); let s = sin(yaw);
  let q = p * SQ * r;
  *wp = rec.xyz + vec3f(q.x * c + q.z * s, q.y, -q.x * s + q.z * c);
  let nq = normalize(n / SQ);
  *wn = vec3f(nq.x * c + nq.z * s, nq.y, -nq.x * s + nq.z * c);
  return rockTone(b);
}`;

export const ROCK_DRAW_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
@group(2) @binding(0) var<storage, read> vis: array<vec4f>;
@group(2) @binding(1) var tShadowR: texture_depth_2d;
@group(2) @binding(2) var sShadowR: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(3) var<uniform> SH: Shadow;
${PACK_WGSL}
${ROCK_VS}
${WATER_WGSL}
${SHADOW_READ('tShadowR', 'sShadowR')}
fn hash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn vnoise(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y); }
const T0 = vec3f(${TONES[0].join(', ')}); const T1 = vec3f(${TONES[1].join(', ')});
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> RV {
  var wp: vec3f; var wn: vec3f;
  let tone = rockWorld(p, n, vis[ii], &wp, &wn);
  var o: RV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.tone = tone; return o;
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;   // × the storm cell's shade (1 fair): the land under the deck, as the water and the boat (v1's sunShade)
}
@fragment fn fs(v: RV) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  // v1's granite: two tones by a 1.3 /m noise, a per-rock tone, lichen-dark on about one in five; wet and dark in the wash
  var A = mix(T0, T1, vnoise(p.xz * 1.3 + p.y * 0.7) * 0.6 + v.tone * 0.4);
  A = mix(A, A * 0.45, smoothstep(0.85, 0.9, v.tone));
  A *= mix(0.55, 1.0, smoothstep(0.0, 0.5, p.y));
  let nl = max(dot(n, s), 0.0);
  let shadow = shadowAt(p, nl);
  let eSky = LIGHT.sky.rgb;
  var col: vec3f;
  if (p.y < 0.0) {
    // under the surface: the water column over the rock's face, as the bed's (the same K, R∞ and up-share: no seam)
    let dep = -p.y;
    let V = normalize(F.cam.xyz - p);
    let sinT = sqrt(max(1.0 - V.y * V.y, 0.0)) / NW; let cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
    let sinS = sqrt(max(1.0 - s.y * s.y, 0.0)) / NW; let cosS = sqrt(max(1.0 - sinS * sinS, 0.0));
    let T = exp(-WK * (dep / max(cosT, 0.05) + dep / max(cosS, 0.1)));
    let E = 0.98 * (LIGHT.sun.rgb * shadow + eSky + nightLand());   // M5e: v1's night lift
    let lit = A * (0.35 + 0.65 * (0.75 * nl + 0.25 * (0.5 + 0.5 * n.y)));
    col = WUP * E / PI * (lit * T + RINF * (1.0 - T));
  } else {
    let E = sunAt(p.y, s) * nl * shadow + landSky(n, ${LAND_SKY.terrain.toFixed(3)}, ${LAND_SKY.desat.toFixed(3)});   // fix(v2) terrain shadow: the terrain's sky (render/sky.js landSky), so a boulder in shade reads as the ground round it
    col = depthTint(A, p, vec3f(${LAND_LOOK.slate.join(", ")})) * E / PI;   // fix(v2) mountains: v1's depth tint on the ground's boulders
  }
  var out = select(aerialLand(col, v.pos.xy, p), aerial(col, v.pos.xy, p), p.y < 0.0);   // the land's air (v1's far look)
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, 1.0);
}`;

export const ROCK_SHADOW_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
@group(1) @binding(0) var<storage, read> vis: array<vec4f>;
${SHADOW_STRUCT}
@group(1) @binding(1) var<uniform> SH: Shadow;
${PACK_WGSL}
${ROCK_VS}
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  var wp: vec3f; var wn: vec3f;
  rockWorld(p, n, vis[ii], &wp, &wn);
  return SH.vp * vec4f(wp, 1.0);
}`;

// the bed's 3D stones (feat/v2-boulders-3d): a smooth rounded dome sized and stretched as its painted twin, its top
// cut to the clearance, sunk into the bed with distance (BED3D.grow: no pop, the paint holds it far off); under the surface
// drawn where the refracted eye ray finds it and lit through the water column exactly as the bed (render/bed.js bedRadiance's
// detailed path: the refracted sun and sky, the caustics, the image fading into the bed's mean, the shelf's tint by the bed's
// depth, the exposure keep), above it wet granite darkening to the waterline (the shore rocks' light)
export const ROCK_BED_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
@group(2) @binding(0) var<storage, read> vis: array<vec4f>;
@group(2) @binding(1) var tShadowR: texture_depth_2d;
@group(2) @binding(2) var sShadowR: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(3) var<uniform> SH: Shadow;
@group(2) @binding(4) var tCaustic: texture_2d_array<f32>;
@group(2) @binding(5) var sSlope: sampler;
struct BedU { bed2: vec4f }   // x: the fine caustic layer on (1), w: the caustics on
@group(2) @binding(6) var<uniform> M: BedU;
${PACK_WGSL}
${WATER_WGSL}
${SHADOW_READ('tShadowR', 'sShadowR')}
${UNDERWATER_WGSL}
${WARP_WGSL}
${CAUSTIC_WGSL}
fn hash12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn vnoise(p: vec2f) -> f32 { let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y); }
const PL_MOSS = ${v3b(PHOTO_LOOK.moss)}; const PL_MOSSD = ${v3b(PHOTO_LOOK.mossDark)}; const PL_PALE = ${v3b(PHOTO_LOOK.pale)};
const BMEAN = ${v3b(BED.mean)}; const TINT_SHELF = ${v3b(TINT_SHELF)}; const TINT_M0 = ${PHOTO_LOOK.shelfM}.0; const TINT_M1 = ${WATER_LOOK.deepM}.0;
const ISCAT = ${IMAGE_SCATTER}; const DSHARE = ${DIRECT_SHARE}; const BB_FLAT = ${BED3D.flat}; const G0 = ${BED3D.grow[0]}.0; const G1 = ${BED3D.grow[1]}.0;
struct BV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) drawn: vec3f, @location(3) @interpolate(flat) k: vec2f }   // k: the bed's depth under the stone, its tone
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @builtin(instance_index) ii: u32) -> BV {
  let rec = vis[ii]; let b = bitcast<u32>(rec.w);
  let r = rockR(b); let st = bedSt(b); let a = bedA(b) * r * BB_FLAT;
  let grow = select(1.0 - smoothstep(G0, G1, distance(F.cam.xz, rec.xz)), 1.0, bedEmerge(b));   // an emergent stone stays (a hero detail from the boat)
  let sc = vec3f(r / st * 1.12, max(a * grow, 0.02) / 1.1, r * st * 1.12);   // the mesh's lumps reach 1.1 of its radius: the top keeps the clearance
  var lp = p * sc; var ln = n / sc;
  let tl = bedTilt(b);
  if (tl > 0u) {
    // round 3: a tilted slab, 22 degrees about x, z or the diagonal (its own axis by the code)
    let ax = select(select(normalize(vec3f(1.0, 0.0, 1.0)), vec3f(0.0, 0.0, 1.0), tl == 2u), vec3f(1.0, 0.0, 0.0), tl == 1u);
    let c = 0.927; let sn = 0.375;
    lp = lp * c + cross(ax, lp) * sn + ax * dot(ax, lp) * (1.0 - c);
    ln = ln * c + cross(ax, ln) * sn + ax * dot(ax, ln) * (1.0 - c);
  }
  var wp = rec.xyz + lp - vec3f(0.0, (1.0 - grow) * (a + 0.3), 0.0);   // far off it sinks wholly under the bed
  let wn = normalize(ln);
  var o: BV; o.world = wp; o.n = wn; o.drawn = wp; o.k = vec2f(-rec.y, bedTone(b));
  if (wp.y < 0.0) { o.drawn = uwApparent(wp).p; }
  o.pos = F.viewProj * vec4f(o.drawn, 1.0); return o;
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;
}
@fragment fn fs(v: BV) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  let tone = v.k.y;
  // mossy green-teal on top, the grey granite showing on the steep flanks, about one in five a paler, cleaner stone
  let moss = mix(PL_MOSS, PL_MOSSD, smoothstep(0.0, 0.8, tone));
  let flank = mix(PL_PALE * 0.7, moss, smoothstep(0.25, 0.7, n.y));
  var A = mix(flank, PL_PALE, step(0.85, tone)) * (vnoise(p.xz * 1.7 + p.y * 1.3) * 0.3 + 0.85);
  let nl = max(dot(n, s), 0.0);
  let shadow = shadowAt(p, nl);
  var col: vec3f;
  if (p.y < 0.0) {
    let d = -p.y; let dBed = v.k.x;
    let V = normalize(F.cam.xyz - p);
    let sinT = sqrt(max(1.0 - V.y * V.y, 0.0)) / NW; let tDown = sqrt(max(1.0 - sinT * sinT, 0.0025));
    let sunDownY = uwSunDownY(); let sunU = vec3f(s.x / NW, sunDownY, s.z / NW);
    let E = 0.98 * (LIGHT.sun.rgb * shadow + LIGHT.sky.rgb + nightLand()) * mix(1.0, ${NIGHT.bedLight.toFixed(2)}, min(F.night.x, 1.0));
    let fD = smoothstep(0.0, 0.35, s.y) * DSHARE;
    let fade = exp(-d * ISCAT / tDown); let fadeBig = sqrt(fade);
    let lambert = max(dot(n, sunU), 0.0) / sunDownY;
    let fp = max(length(dpdx(p)), length(dpdy(p)));
    var caust = 1.0;
    let ck = causticStrength(d, s.y) * M.bed2.w;
    if (ck > 0.0) { caust = mix(1.0, waveCaustic(p.xz, d, sunU, log2(max(fp, 1e-3))), ck * fade); }
    let albedo = mix(mix(BMEAN, mix(PL_MOSS, PL_MOSSD, 0.45), 0.5), A, fadeBig);
    let dirF = mix(1.0, lambert, fadeBig); let amb = mix(1.0, n.y * 0.65 + 0.35, fadeBig);
    let TE = exp(-WK * (d / tDown + d / max(sunDownY, 0.1)));
    let up = WUP / PI * ((E * (1.0 - fD) * amb + E * fD * dirF * caust) * albedo * TE + E * RINF * (1.0 - TE));
    col = up * mix(mix(TINT_SHELF, vec3f(1.0), clamp(F.night.x, 0.0, 1.0)), vec3f(select(1.0, F.look.x, F.look.x > 0.0)), smoothstep(TINT_M0, TINT_M1, dBed));
  } else {
    // above the surface (the photos' emergent stones): dry pale granite with dark lichen specks and a weathered mottle, the wet
    // dark band just above the waterline (the wash), a thin moss line at the water
    // round 3 (darker, wetter tones that stand apart from the island's pale granite): warm grey-brown dry tops, dark
    // lichen, the stone wet and dark to about 0.9 m over the water (spray and wash), damp above that, a dark moss line at the water
    let lich = smoothstep(0.62, 0.78, vnoise(p.xz * 9.0 + vec2f(p.y * 7.0, 0.0))) * 0.5;
    let dry = vec3f(0.16, 0.145, 0.125) * (1.0 - lich) * (vnoise(p.xz * 0.9 + vec2f(0.0, p.y * 1.7)) * 0.35 + 0.82);
    let wet = 1.0 - smoothstep(0.35, 0.95, p.y + (vnoise(p.xz * 2.0) - 0.5) * 0.3);
    A = mix(dry, dry * 0.3, wet);
    A = mix(A, A * 0.7, (1.0 - smoothstep(0.8, 1.8, p.y)) * 0.6);   // damp above the wet band
    A = mix(A, PL_MOSSD * 0.45, (1.0 - smoothstep(0.0, 0.2, p.y)) * 0.75);
    let E = sunAt(p.y, s) * nl * shadow + landSky(n, ${LAND_SKY.terrain.toFixed(3)}, ${LAND_SKY.desat.toFixed(3)});
    col = depthTint(A, p, vec3f(${LAND_LOOK.slate.join(", ")})) * E / PI;
  }
  var out = select(aerialLand(col, v.pos.xy, p), aerial(col, v.pos.xy, v.drawn), p.y < 0.0);
  let toP = v.drawn - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let kc = cloudAt(toP / max(dist, 1e-3)); out = out * kc.a + kc.rgb; }
  return vec4f(out, 1.0);
}`;

// v1's boulder mesh (landmarks.js): an icosahedron subdivided once (42 vertices, 80 faces), each vertex pushed by a lump
// term, squashed in the instance (SQ); per-vertex normals from the lumped faces. Pure.
export function boulderMesh({ subdiv = 1, lump = 1 } = {}) {
  const t = (1 + Math.sqrt(5)) / 2;
  const base = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const verts = base.slice(), mid = new Map();
  const midpoint = (a, b) => { const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (mid.has(k)) return mid.get(k); const v = [0, 1, 2].map((i) => (verts[a][i] + verts[b][i]) / 2), l = Math.hypot(...v); verts.push(v.map((x) => x / l)); mid.set(k, verts.length - 1); return verts.length - 1; };
  for (let k = 0; k < subdiv; k++) faces = faces.flatMap(([a, b, c]) => { const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  const pos = new Float32Array(verts.length * 3), nrm = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => { const [x, y, z] = v, n = 1 + lump * (0.18 * Math.sin(x * 3.1 + z * 2.3) + 0.1 * Math.cos(y * 4.7)); pos[3 * i] = x * n; pos[3 * i + 1] = y * n; pos[3 * i + 2] = z * n; });
  const idx = new Uint16Array(faces.length * 3);
  faces.forEach((f, i) => { idx[3 * i] = f[0]; idx[3 * i + 1] = f[1]; idx[3 * i + 2] = f[2]; });
  for (const [a, b, c] of faces) {
    const A = pos.subarray(3 * a, 3 * a + 3), B = pos.subarray(3 * b, 3 * b + 3), Cc = pos.subarray(3 * c, 3 * c + 3);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
    const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const k of [a, b, c]) { nrm[3 * k] += fn[0]; nrm[3 * k + 1] += fn[1]; nrm[3 * k + 2] += fn[2]; }
  }
  for (let i = 0; i < verts.length; i++) { const l = Math.hypot(nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]) || 1; nrm[3 * i] /= l; nrm[3 * i + 1] /= l; nrm[3 * i + 2] /= l; }
  return { pos, nrm, idx, vertices: verts.length, triangles: faces.length };
}

// Play as Tessie, phase 2a: the boulders seen from under the water, appended to each draw's own text in a module of its
// own (the draws' modules stay byte for byte): the rock's own colour, lit by the light left at its depth (umLit), the bed's stones with
// the waves' caustics; then the straight path to the eye (umFog). Over the water a stone is behind the surface (its window shows the sky).
export const ROCK_DRAW_UNDER_WGSL = () => `
${UNDER_WGSL}
@fragment fn fsUnder(v: RV) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  if (p.y >= 0.0) { return vec4f(umBack(normalize(p - F.cam.xyz)), 1.0); }   // 2c: above the water a stone is the surface's (its window): the water's own light, never a black patch on the horizon
  var A = mix(T0, T1, vnoise(p.xz * 1.3 + p.y * 0.7) * 0.6 + v.tone * 0.4);
  A = mix(A, A * 0.45, smoothstep(0.85, 0.9, v.tone));
  A *= 0.55;
  let shadow = shadowAt(p, max(dot(n, s), 0.0));
  return vec4f(umFog(umLit(A, n, -p.y, shadow), p), 1.0);
}`;
export const ROCK_BED_UNDER_WGSL = () => `
${UNDER_WGSL}
@fragment fn fsUnder(v: BV) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  if (p.y >= 0.0) { return vec4f(umBack(normalize(p - F.cam.xyz)), 1.0); }   // 2c: above the water a stone is the surface's (its window): the water's own light, never a black patch on the horizon
  let tone = v.k.y;
  let moss = mix(PL_MOSS, PL_MOSSD, smoothstep(0.0, 0.8, tone));
  let flank = mix(PL_PALE * 0.7, moss, smoothstep(0.25, 0.7, n.y));
  let A = mix(flank, PL_PALE, step(0.85, tone)) * (vnoise(p.xz * 1.7 + p.y * 1.3) * 0.3 + 0.85);
  let d = -p.y;
  let shadow = shadowAt(p, max(dot(n, s), 0.0));
  var caust = 1.0;
  let ck = causticStrength(d, s.y) * M.bed2.w;
  if (ck > 0.0) { let fp = max(length(dpdx(p)), length(dpdy(p))); caust = mix(1.0, waveCaustic(p.xz, d, umSunU(), log2(max(fp, 1e-3))), ck * smoothstep(0.1, 0.6, n.y)); }
  return vec4f(umFog(umLit(A, n, d, shadow * caust), p), 1.0);
}`;

export function createRocks({ device, reg, frameBGL, frameBG, U, frameStruct, sky, terrain, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', bed = false, zones = [], region = null, under = false }) {   // under: phase 2a's twins (src/core/features.js tessieUnder)
  const C = GPUShaderStage.COMPUTE, VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const inst = device.createBuffer({ label: 'rocks-placed', size: PLACED_CAP * 16, usage: GPUBufferUsage.STORAGE });
  const cnt = device.createBuffer({ label: 'rocks-count', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const vis = device.createBuffer({ label: 'rocks-visible', size: CAP * 16, usage: GPUBufferUsage.STORAGE });
  const args = device.createBuffer({ label: 'rocks-args', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const ru = device.createBuffer({ label: 'rocks-uniform', size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const ruData = new Float32Array(32);
  const mesh = boulderMesh();
  const vb = (a, label) => { const b = device.createBuffer({ label, size: a.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, a); return b; };
  const posBuf = vb(mesh.pos, 'rocks-pos'), nrmBuf = vb(mesh.nrm, 'rocks-nrm');
  const idxBuf = device.createBuffer({ label: 'rocks-idx', size: Math.ceil(mesh.idx.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(idxBuf, 0, mesh.idx);
  device.queue.writeBuffer(args, 0, new Uint32Array([mesh.idx.length, 0, 0, 0, 0, 0, 0, 0]));

  const sb = (b, type, v = C) => ({ binding: b, visibility: v, buffer: { type } });
  // feat/v2-boulders-3d: the bed's stones' buffers (only where the bed's big boulders are on: a phone builds none of this)
  const B3 = bed ? (() => {
    const binst = device.createBuffer({ label: 'rocks-bed-placed', size: BED_PLACED * 16, usage: GPUBufferUsage.STORAGE });
    const bcnt = device.createBuffer({ label: 'rocks-bed-count', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const bvis = device.createBuffer({ label: 'rocks-bed-visible', size: (BED_CAP_NEAR + BED_CAP_FAR) * 16, usage: GPUBufferUsage.STORAGE });   // near, then far
    const bargs = device.createBuffer({ label: 'rocks-bed-args', size: 64 + BED_CW * 20, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const zn = device.createBuffer({ label: 'rocks-bed-zones', size: 64 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    // the ordered passes' per-workgroup counts (the scatter's: counts, then first indices; the cull's ride in its args buffer)
    const swg = device.createBuffer({ label: 'rocks-bed-scatter-groups', size: BED_W * 6 * 4, usage: GPUBufferUsage.STORAGE });
    const zd = new Float32Array(64 * 4); zones.slice(0, 64).forEach(([x, z, r], i) => { zd[4 * i] = x; zd[4 * i + 1] = z; zd[4 * i + 2] = r; });
    device.queue.writeBuffer(zn, 0, zd);
    const win = device.createBuffer({ label: 'rocks-bed-window', size: BWIN_N * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });   //
    const bu = device.createBuffer({ label: 'rocks-bed-look', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(bu, 0, new Float32Array([1, 0, 0, 1]));
    const mesh = boulderMesh({ subdiv: 2, lump: 0.35 });
    const vbb = (a, label) => { const b = device.createBuffer({ label, size: a.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, a); return b; };
    const ib = device.createBuffer({ label: 'rocks-bed-idx', size: Math.ceil(mesh.idx.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ib, 0, mesh.idx);
    // the caustics' texture comes later (render/caustics.js onView): flat light (1) until then
    const none = device.createTexture({ label: 'rocks-bed-caustic-none', size: [1, 1, 2], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: none }, new Uint8Array(8).fill(255), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, 2]);
    const sSlope = device.createSampler({ label: 'rocks-bed-slope', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
    // the far list (the LOD past BED3D.lod): the 80-triangle mesh
    const meshF = boulderMesh({ subdiv: 1, lump: 0.35 });
    const ibF = device.createBuffer({ label: 'rocks-bed-idx-far', size: Math.ceil(meshF.idx.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibF, 0, meshF.idx);
    device.queue.writeBuffer(bargs, 0, new Uint32Array([mesh.idx.length, 0, 0, 0, 0, 0, 0, 0, meshF.idx.length, 0, 0, 0, 0, 0, 0, 0]));
    return { binst, bcnt, bvis, bargs, zn, swg, win, bu, mesh, pos: vbb(mesh.pos, 'rocks-bed-pos'), nrm: vbb(mesh.nrm, 'rocks-bed-nrm'), ib, caustic: none.createView({ dimension: '2d-array' }), sSlope, drawBG: null,
      meshF, posF: vbb(meshF.pos, 'rocks-bed-pos-far'), nrmF: vbb(meshF.nrm, 'rocks-bed-nrm-far'), ibF, drawBGF: null };
  })() : null;
  const scatterBGL = device.createBindGroupLayout({ label: 'rocks-scatter', entries: [sb(0, 'storage'), sb(1, 'storage'), ...(B3 ? [sb(2, 'storage'), sb(3, 'storage'), { binding: 4, visibility: C, buffer: { type: 'uniform' } }, sb(5, 'storage'), { binding: 6, visibility: C, buffer: { type: 'uniform' } }] : [])] });
  const scatterBG = device.createBindGroup({ layout: scatterBGL, entries: [{ binding: 0, resource: { buffer: inst } }, { binding: 1, resource: { buffer: cnt } },
    ...(B3 ? [{ binding: 2, resource: { buffer: B3.binst } }, { binding: 3, resource: { buffer: B3.bcnt } }, { binding: 4, resource: { buffer: B3.zn } }, { binding: 5, resource: { buffer: B3.swg } }, { binding: 6, resource: { buffer: B3.win } }] : [])] });
  const cullBGL = device.createBindGroupLayout({ label: 'rocks-cull', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, sb(1, 'read-only-storage'), sb(2, 'storage'), sb(3, 'storage'), sb(4, 'read-only-storage'),
    ...(B3 ? [sb(5, 'read-only-storage'), sb(6, 'read-only-storage'), sb(7, 'storage'), sb(8, 'storage')] : [])] });
  const cullBG = device.createBindGroup({ layout: cullBGL, entries: [{ binding: 0, resource: { buffer: ru } }, { binding: 1, resource: { buffer: inst } }, { binding: 2, resource: { buffer: vis } }, { binding: 3, resource: { buffer: args } }, { binding: 4, resource: { buffer: cnt } },
    ...(B3 ? [{ binding: 5, resource: { buffer: B3.binst } }, { binding: 6, resource: { buffer: B3.bcnt } }, { binding: 7, resource: { buffer: B3.bvis } }, { binding: 8, resource: { buffer: B3.bargs } }] : [])] });
  const drawBGL = device.createBindGroupLayout({ label: 'rocks-draw', entries: [sb(0, 'read-only-storage', VX), { binding: 1, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 2, visibility: FR, sampler: { type: 'comparison' } }, { binding: 3, visibility: FR, buffer: { type: 'uniform' } }] });
  const drawBG = device.createBindGroup({ layout: drawBGL, entries: [{ binding: 0, resource: { buffer: vis } }, { binding: 1, resource: shadow.view }, { binding: 2, resource: shadow.sampler }, { binding: 3, resource: { buffer: shadow.buffer } }] });
  const shBGL = device.createBindGroupLayout({ label: 'rocks-shadow', entries: [sb(0, 'read-only-storage', VX), { binding: 1, visibility: VX, buffer: { type: 'uniform' } }] });
  const shBG = device.createBindGroup({ layout: shBGL, entries: [{ binding: 0, resource: { buffer: vis } }, { binding: 1, resource: { buffer: shadow.buffer } }] });
  const pl = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
  const f3 = (loc) => ({ arrayStride: 12, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x3' }] });
  const mS = reg.shader('rocks-scatter', scatterWgsl({ bed: !!B3 }));
  reg.add('rocks-scatter', { layout: pl(terrain.hbgl, terrain.coverBGL, scatterBGL), compute: { module: mS, entryPoint: 'scatterMain' } });
  reg.add('rocks-scatter-done', { layout: pl(terrain.hbgl, terrain.coverBGL, scatterBGL), compute: { module: mS, entryPoint: 'scatterDone' } });
  if (B3) for (const e of ['bedCount', 'bedScan', 'bedWrite']) reg.add(`rocks-${e}`, { layout: pl(terrain.hbgl, terrain.coverBGL, scatterBGL), compute: { module: mS, entryPoint: e } });   // the bed's stones in slot order
  const mC = reg.shader('rocks-cull', cullWgsl({ bed: !!B3 }));
  reg.add('rocks-reset', { layout: pl(cullBGL), compute: { module: mC, entryPoint: 'reset' } });
  reg.add('rocks-cull', { layout: pl(cullBGL), compute: { module: mC, entryPoint: 'cull' } });
  if (B3) reg.add('rocks-cull-bed', { layout: pl(cullBGL), compute: { module: mC, entryPoint: 'cullBed' } });   // the same module, a second entry
  if (B3) reg.add('rocks-cull-bed-put', { layout: pl(cullBGL), compute: { module: mC, entryPoint: 'cullBedPut' } });   // its lists in the placed order
  const mD = reg.shader('rocks-draw', ROCK_DRAW_WGSL(frameStruct));
  reg.add('rocks-draw', { layout: pl(frameBGL, sky.skyBGL, drawBGL), vertex: { module: mD, entryPoint: 'vs', buffers: [f3(0), f3(1)] }, fragment: { module: mD, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const underAdd = (name, text, bglx) => {   // phase 2a: the draw's under-water twin (its own module; the deferred 'under' group)
    if (!under) return;
    const prevU = reg.group?.('under');
    const mU = reg.shader(name + '-under', text);
    reg.add(name + '-under', { layout: pl(frameBGL, sky.skyBGL, bglx), vertex: { module: mU, entryPoint: 'vs', buffers: [f3(0), f3(1)] }, fragment: { module: mU, entryPoint: 'fsUnder', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
    if (prevU != null) reg.group(prevU);
  };
  underAdd('rocks-draw', ROCK_DRAW_WGSL(frameStruct) + ROCK_DRAW_UNDER_WGSL(), drawBGL);
  // feat/v2-boulders-3d: the bed's stones' one draw pipeline (its group 2: the visible list, the sun's shadow, the caustics)
  let bedBGL = null;
  if (B3) {
    bedBGL = device.createBindGroupLayout({ label: 'rocks-bed-draw', entries: [sb(0, 'read-only-storage', VX), { binding: 1, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 2, visibility: FR, sampler: { type: 'comparison' } }, { binding: 3, visibility: FR, buffer: { type: 'uniform' } },
      { binding: 4, visibility: FR, texture: { sampleType: 'float', viewDimension: '2d-array' } }, { binding: 5, visibility: FR, sampler: {} }, { binding: 6, visibility: FR, buffer: { type: 'uniform' } }] });
    const mB = reg.shader('rocks-bed-draw', ROCK_BED_WGSL(frameStruct));
    reg.add('rocks-bed-draw', { layout: pl(frameBGL, sky.skyBGL, bedBGL), vertex: { module: mB, entryPoint: 'vs', buffers: [f3(0), f3(1)] }, fragment: { module: mB, entryPoint: 'fs', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
    underAdd('rocks-bed-draw', ROCK_BED_WGSL(frameStruct) + ROCK_BED_UNDER_WGSL(), bedBGL);
  }
  const bedDrawBG = (far = false) => device.createBindGroup({ layout: bedBGL, entries: [{ binding: 0, resource: far ? { buffer: B3.bvis, offset: BED_CAP_NEAR * 16, size: BED_CAP_FAR * 16 } : { buffer: B3.bvis, offset: 0, size: BED_CAP_NEAR * 16 } }, { binding: 1, resource: shadow.view }, { binding: 2, resource: shadow.sampler }, { binding: 3, resource: { buffer: shadow.buffer } },
    { binding: 4, resource: B3.caustic }, { binding: 5, resource: B3.sSlope }, { binding: 6, resource: { buffer: B3.bu } }] });
  if (B3) { B3.drawBG = bedDrawBG(); B3.drawBGF = bedDrawBG(true); }
  const mH = reg.shader('rocks-shadow', ROCK_SHADOW_WGSL(frameStruct));
  reg.add('rocks-shadow', { layout: pl(frameBGL, shBGL), vertex: { module: mH, entryPoint: 'vs', buffers: [f3(0), f3(1)] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' } });

  const stats = { slots: SLOT_COUNT, cols: COLS, scatters: 0, visible: 0, total: 0, placed: 0, active: false, bed: !!B3, bedVisible: 0, bedFar: 0, bedTotal: 0, bedPlaced: 0, bedOn: true, bedSlots: 0, bedRegions: 0 };
  //: the bed's window (the player's regions; the whole box until told)
  let bedWin = null; const winData = new Float32Array(BWIN_N * 4);
  const setWindow = (discs) => {
    const w = bedWindow(discs && discs.length ? discs : null);
    if (bedWin && w.key === bedWin.key) return false;
    bedWin = w; stats.bedSlots = w.slots; stats.bedRegions = w.discs.length;
    if (B3) device.queue.writeBuffer(B3.win, 0, bedWindowData(w, winData));
    return true;
  };
  setWindow(region);
  const planes = new Float64Array(20);
  let lastSwaps = -1, scatterDirty = true, active = false;
  // the visible count, read back a few frames late (a ring of 3; nothing made per frame)
  const ring = Array.from({ length: 3 }, (_, i) => ({ buf: device.createBuffer({ label: `rocks-args-read-${i}`, size: 96, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), busy: false }));
  let slot = 0;
  const zero4 = new Uint32Array(4);
  function dispatchScatter(pass) {
    device.queue.writeBuffer(cnt, 0, zero4);   // before this frame's submit: the count starts at 0
    if (B3) device.queue.writeBuffer(B3.bcnt, 0, zero4);
    pass.setPipeline(reg.get('rocks-scatter')); pass.setBindGroup(0, terrain.heightsBindGroup); pass.setBindGroup(1, terrain.coverBindGroup); pass.setBindGroup(2, scatterBG);
    pass.dispatchWorkgroups(Math.ceil(SLOT_COUNT / 64));
    pass.setPipeline(reg.get('rocks-scatter-done')); pass.dispatchWorkgroups(1); stats.scatters++;
    if (B3) {   // the bed's stones in slot order: count, sum, write (over 65,535 groups: rows of 65,535, the shader's wid.y), over the window
      const xy = [Math.min(bedWin.W, 65535), Math.ceil(bedWin.W / 65535)];
      pass.setPipeline(reg.get('rocks-bedCount')); pass.dispatchWorkgroups(...xy);
      pass.setPipeline(reg.get('rocks-bedScan')); pass.dispatchWorkgroups(1);
      pass.setPipeline(reg.get('rocks-bedWrite')); pass.dispatchWorkgroups(...xy);
    }
  }
  const self = {
    stats, mesh, CAP,
    // a capture: the slots scattered before the first frame (one submit)
    async prime() {
      lastSwaps = terrain.stats.swaps; scatterDirty = false;
      const enc = device.createCommandEncoder({ label: 'rocks-prime' });
      const pass = enc.beginComputePass({ label: 'rocks-prime' }); dispatchScatter(pass); pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    },
    // per frame, before the graph: a swap since the last frame re-scatters; the cull's uniform
    update(eye, viewProj, focalPx) {
      if (terrain.stats.swaps !== lastSwaps) { lastSwaps = terrain.stats.swaps; scatterDirty = true; }
      frustumPlanes(viewProj, planes);
      for (let i = 0; i < 20; i++) ruData[i] = planes[i];
      ruData[20] = eye[0]; ruData[21] = eye[1]; ruData[22] = eye[2]; ruData[23] = focalPx;
      ruData[24] = RANGE_M; ruData[25] = MIN_PX; ruData[26] = CAP; ruData[27] = BED3D.grow[1];
      device.queue.writeBuffer(ru, 0, ruData);
      active = stats.scatters > 0 || scatterDirty;
    },
    // the compute pass (with the forest's): the scatter when due, then reset → cull
    run(pass, c) {
      if (scatterDirty) { dispatchScatter(pass); scatterDirty = false; c.dispatches++; }
      pass.setBindGroup(0, cullBG);
      pass.setPipeline(reg.get('rocks-reset')); pass.dispatchWorkgroups(1);
      pass.setPipeline(reg.get('rocks-cull')); pass.dispatchWorkgroupsIndirect(cnt, 4); c.dispatches += 2;
      // the bed's stones: the count, then the lists in the placed order
      if (B3 && stats.bedOn) { pass.setPipeline(reg.get('rocks-cull-bed')); pass.dispatchWorkgroupsIndirect(B3.bcnt, 4); pass.setPipeline(reg.get('rocks-cull-bed-put')); pass.dispatchWorkgroupsIndirect(B3.bcnt, 4); c.dispatches += 2; }
      stats.active = active;
    },
    draw(pass, c) {
      if (!active) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, drawBG);
      pass.setPipeline(reg.get(underPipe(reg, 'rocks-draw'))); pass.setVertexBuffer(0, posBuf); pass.setVertexBuffer(1, nrmBuf); pass.setIndexBuffer(idxBuf, 'uint16');
      pass.drawIndexedIndirect(args, 0); c.calls++; c.triangles += mesh.triangles * stats.visible;
      if (B3 && stats.bedOn) {
        pass.setBindGroup(2, B3.drawBG);
        pass.setPipeline(reg.get(underPipe(reg, 'rocks-bed-draw'))); pass.setVertexBuffer(0, B3.pos); pass.setVertexBuffer(1, B3.nrm); pass.setIndexBuffer(B3.ib, 'uint16');
        pass.drawIndexedIndirect(B3.bargs, 0); c.calls++; c.triangles += B3.mesh.triangles * stats.bedVisible;
        pass.setBindGroup(2, B3.drawBGF); pass.setVertexBuffer(0, B3.posF); pass.setVertexBuffer(1, B3.nrmF); pass.setIndexBuffer(B3.ibF, 'uint16');
        pass.drawIndexedIndirect(B3.bargs, 32); c.calls++; c.triangles += B3.meshF.triangles * stats.bedFar;
      }
    },
    // the caustics' texture (render/caustics.js onView) for the bed's stones; the in-page A/B switch (tools/v2-lakebed-shots.mjs)
    attachCaustic(view) { if (!B3 || !view) return; B3.caustic = view; B3.drawBG = bedDrawBG(); B3.drawBGF = bedDrawBG(true); },
    setBed(on) { stats.bedOn = !!on; },
    //: the player's regions as discs [[x, z, r], …] (v2/sim/bedBoulders.js createStoneRegion); a new set
    // re-places the bed's stones at the next frame's compute pass (one scatter; null or [] is the whole box)
    setRegion(discs) { if (setWindow(discs)) scatterDirty = true; return bedWin; },
    get region() { return bedWin; },
    // into the terrain shadow map (render/shadow.js: the pass has the frame group bound)
    shadowCaster: { draw(pass, c) {
      if (!active) return;
      pass.setBindGroup(1, shBG);
      pass.setPipeline(reg.get('rocks-shadow')); pass.setVertexBuffer(0, posBuf); pass.setVertexBuffer(1, nrmBuf); pass.setIndexBuffer(idxBuf, 'uint16');
      pass.drawIndexedIndirect(args, 0); c.calls++;
    } },
    // the readback of the count (call from the graph's hooks)
    copyCount(enc) { const r = ring[slot]; if (r.busy) return false; enc.copyBufferToBuffer(cnt, 0, args, 24, 4); enc.copyBufferToBuffer(args, 0, r.buf, 0, 32);
      if (B3) { enc.copyBufferToBuffer(B3.bcnt, 0, B3.bargs, 24, 4); enc.copyBufferToBuffer(B3.bargs, 0, r.buf, 32, 64); } return true; },   // [6] the placed count rides along
    afterSubmit(copied) {
      if (!copied) return;
      const r = ring[slot]; r.busy = true;
      r.buf.mapAsync(GPUMapMode.READ).then(() => { const a = new Uint32Array(r.buf.getMappedRange()); stats.visible = a[1]; stats.total = a[5]; stats.placed = a[6]; if (B3) { stats.bedVisible = a[9]; stats.bedTotal = a[13]; stats.bedPlaced = a[14]; stats.bedFar = a[17]; } r.buf.unmap(); r.busy = false; }, () => { r.busy = false; });
      slot = (slot + 1) % ring.length;
    },
  };
  return self;
}
