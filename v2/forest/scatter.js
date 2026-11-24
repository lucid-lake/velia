// The rules' forest round the lidar box (M5b): where v1 has no crowns, trees stand where the ground cover says forest,
// as v1's rule scatter does (src/trees-scatter.js scatterTrees: one candidate per cell, jittered; kept by a grove field
// and the cover's forest share; none on cliffs (the terrain's granite past ≈ 40°), snow, beaches, water, or above a
// ragged treeline; the species by elevation). It runs on the GPU (render/forest.js, SCATTER_WGSL below, over the same
// cover grids and heights the terrain's bake reads, so a tree stands only where the terrain is drawn as forest or brush);
// scatterSlot() is its JS twin, line for line, for the node tests (no tree in the lake, none on snow or bare rock, the
// heights within the lidar's range). Deterministic: u32 hashes of the cell index, no Math.random().
import { REGION, inBox } from './lod.js';

export const RULES = Object.freeze({
  minH: 2.5,          // m above the lake: v1's TREE_RULES.minH (and the guard: never in the lake)
  treelineJitter: 60, thinM: 110, cliff: [0.85, 1.2], snowCut: 0.4,
  keep: [0.45, 0.55], shrubKeep: 0.12,
  stand: 1.2,         // a rule tree's crown × this: one candidate per 164 m² against the lidar's 305 trees a hectare
  h: [3.5, 34, 1.8],  // height = a + b · u^c (m): the lidar's own spread (median ≈ 13 m, few past 40 m)
});

// --- the hash (u32, exact in JS and WGSL) and a lattice value noise ---
export function hashU(x) {
  let h = x >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
export const cellHash = (i, j, k) => (hashU((Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) >>> 0) >>> 8) / 16777216;
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), u = x - xi, v = z - zi, uu = u * u * (3 - 2 * u), vv = v * v * (3 - 2 * v);
  const a = cellHash(xi, zi, s), b = cellHash(xi + 1, zi, s), c = cellHash(xi, zi + 1, s), d = cellHash(xi + 1, zi + 1, s);
  return a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv;
}
import { smooth as smoothstep } from '../../src/sim/core/math.js';
const band = (e, lo, hi) => Math.min(1, Math.max(0, (e - (lo - 120)) / 120)) * Math.min(1, Math.max(0, (hi + 120 - e) / 120));
// the species' layer weights by height above the lake (v1's species bands, src/forest/species.js; hemlock drawn as red fir)
export function layerWeights(e) {
  return [1.0 * band(e, 0, 450) + 0.35 * band(e, 0, 420), 0.5 * band(e, 0, 900), 0.9 * band(e, 0, 500), 0.9 * band(e, 380, 1100) + 0.6 * band(e, 700, 1300), 0.45 * band(e, 0, 400)];
}

// the twin: cell (ci, cj) of the region's global cell grid → { valid, x, z, y, h, r, layer, why }
//   field: { height(x, z) } (v2/terrain/sample.js), cover(x, z) → 11 class weights (v1's sampler cover()), S: the season
//   ({ snowLine, fullM, aspectM, maxSlope }), treeline (m ASL), y0 (the lake surface, m ASL)
export function scatterSlot(ci, cj, { field, cover, S, treeline, y0 }) {
  const R = REGION, C = R.cell;
  const x = R.x0 + (ci + 0.15 + 0.7 * cellHash(ci, cj, 1)) * C, z = R.z0 + (cj + 0.15 + 0.7 * cellHash(ci, cj, 2)) * C;
  const no = (why) => ({ valid: false, x, z, why });
  if (inBox(x, z)) return no('box');
  const y = field.height(x, z);
  if (y < RULES.minH) return no('low');
  const gx = (field.height(x + 4, z) - field.height(x - 4, z)) / 8, gz = (field.height(x, z + 4) - field.height(x, z - 4)) / 8;
  const steep = Math.hypot(gx, gz), nl = Math.hypot(gx, 1, gz), nz = -gz / nl, nh = Math.hypot(gx, gz) / nl;
  const c = cover(x, z);
  let known = 0; for (let i = 0; i < 11; i++) known += c[i];
  let forest = c[5] + 0.5 * (c[2] + 0.4 * c[3]) + 0.42 * c[3], shrub = c[6] + 0.5 * c[8];
  const elev = y + y0;
  if (known < 0.5) { const t = smoothstep(treeline - 250, treeline, elev); forest = 0.7 * (1 - t); shrub = 0.3 * (1 - t); }
  const cliff = smoothstep(RULES.cliff[0], RULES.cliff[1], steep);
  forest *= 1 - cliff; shrub *= 1 - cliff;
  const north = -nz / Math.max(nh, 1e-6), line = S.snowLine - S.aspectM * north * Math.min(1, steep * 3);
  const snow = smoothstep(line, line + S.fullM, elev) * (1 - smoothstep(S.maxSlope * 0.8, S.maxSlope * 1.2, steep));
  if (snow > RULES.snowCut) return no('snow');
  const tl = treeline + RULES.treelineJitter * (2 * vnoise(x / 300, z / 300, 13) - 1);
  if (elev > tl) return no('treeline');
  const thin = Math.min(1, Math.max(0, (tl - elev) / RULES.thinM));
  const grove = 0.55 * vnoise(x / 420, z / 420, 11) + 0.30 * vnoise(x / 60, z / 60, 12) + 0.15 * vnoise(x / 18, z / 18, 14);
  const p = (forest * (RULES.keep[0] + RULES.keep[1] * smoothstep(0.25, 0.75, grove)) + shrub * RULES.shrubKeep) * Math.min(1, thin * thin + 0.04);
  if (cellHash(ci, cj, 3) >= p) return no(forest + shrub < 0.05 ? 'cover' : 'sparse');
  let h = (RULES.h[0] + RULES.h[1] * cellHash(ci, cj, 5) ** RULES.h[2]) * (0.4 + 0.6 * Math.min(1, (tl - elev) / 275));
  h = Math.max(4, h);
  const r = (0.9 + 0.09 * h) * (0.8 + 0.4 * cellHash(ci, cj, 6)) * RULES.stand;
  const w = layerWeights(y); let tot = 0; for (const v of w) tot += v;
  let layer = 0;
  if (tot > 0) { let pick = cellHash(ci, cj, 4) * tot; for (let k = 0; k < w.length; k++) { pick -= w[k]; if (pick <= 0) { layer = k; break; } layer = k; } }
  if (cellHash(ci, cj, 7) < 0.03) { layer = 5; h *= 0.8; }
  return { valid: true, x, z, y, h, r, layer, why: '' };
}

// the WGSL (render/forest.js prepends the terrain's heights, cover reader and noise): scatter(ci, cj) → the GPU record
export const SCATTER_WGSL = `
const RX0 = ${REGION.x0.toFixed(1)}; const RZ0 = ${REGION.z0.toFixed(1)}; const RC = ${REGION.cell};
fn hashU(x: u32) -> u32 { var h = x; h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u; return h; }
fn cellHash(i: i32, j: i32, k: i32) -> f32 { return f32(hashU((bitcast<u32>(i) * 73856093u) ^ (bitcast<u32>(j) * 19349663u) ^ (bitcast<u32>(k) * 83492791u)) >> 8u) / 16777216.0; }
fn lnoise(x: f32, z: f32, s: i32) -> f32 {
  let xi = floor(x); let zi = floor(z); let u = x - xi; let v = z - zi; let uu = u * u * (3.0 - 2.0 * u); let vv = v * v * (3.0 - 2.0 * v);
  let i = i32(xi); let j = i32(zi);
  let a = cellHash(i, j, s); let b = cellHash(i + 1, j, s); let c = cellHash(i, j + 1, s); let d = cellHash(i + 1, j + 1, s);
  return a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv;
}
fn bandW(e: f32, lo: f32, hi: f32) -> f32 { return clamp((e - (lo - 120.0)) / 120.0, 0.0, 1.0) * clamp((hi + 120.0 - e) / 120.0, 0.0, 1.0); }
fn inBox(x: f32, z: f32) -> bool { return x >= -2304.0 && x < 3328.0 && z >= -1792.0 && z < 1792.0; }
fn packTree(h: f32, r: f32, layer: u32) -> u32 { return min(1023u, u32(round(h * 10.0))) | (min(255u, u32(round(r * 10.0))) << 10u) | (layer << 18u) | (1u << 23u); }
fn scatter(ci: i32, cj: i32) -> vec4f {
  let x = RX0 + (f32(ci) + 0.15 + 0.7 * cellHash(ci, cj, 1)) * RC; let z = RZ0 + (f32(cj) + 0.15 + 0.7 * cellHash(ci, cj, 2)) * RC;
  let none = vec4f(x, z, 0.0, 0.0);
  if (inBox(x, z)) { return none; }
  let y = terrainHeight(x, z);
  if (y < ${RULES.minH.toFixed(2)}) { return none; }
  let gx = (terrainHeight(x + 4.0, z) - terrainHeight(x - 4.0, z)) / 8.0; let gz = (terrainHeight(x, z + 4.0) - terrainHeight(x, z - 4.0)) / 8.0;
  let steep = length(vec2f(gx, gz)); let nl = length(vec3f(gx, 1.0, gz)); let nz = -gz / nl; let nh = steep / nl;
  let c = coverAt(x, z);
  var known = 0.0; for (var i = 0u; i < 11u; i++) { known += c[i]; }
  var forest = c[5] + 0.5 * (c[2] + 0.4 * c[3]) + 0.42 * c[3]; var shrub = c[6] + 0.5 * c[8];
  let elev = y + TU.season2.w; let treeline = TU.season2.z;
  if (known < 0.5) { let t = smoothstep(treeline - 250.0, treeline, elev); forest = 0.7 * (1.0 - t); shrub = 0.3 * (1.0 - t); }
  let cliff = smoothstep(${RULES.cliff[0]}, ${RULES.cliff[1]}, steep);
  forest *= 1.0 - cliff; shrub *= 1.0 - cliff;
  let north = -nz / max(nh, 1e-6); let line = TU.season.x - TU.season.z * north * min(1.0, steep * 3.0);
  let snow = smoothstep(line, line + TU.season.y, elev) * (1.0 - smoothstep(TU.season.w * 0.8, TU.season.w * 1.2, steep));
  if (snow > ${RULES.snowCut}) { return none; }
  let tl = treeline + ${RULES.treelineJitter.toFixed(1)} * (2.0 * lnoise(x / 300.0, z / 300.0, 13) - 1.0);
  if (elev > tl) { return none; }
  let thin = clamp((tl - elev) / ${RULES.thinM.toFixed(1)}, 0.0, 1.0);
  let grove = 0.55 * lnoise(x / 420.0, z / 420.0, 11) + 0.30 * lnoise(x / 60.0, z / 60.0, 12) + 0.15 * lnoise(x / 18.0, z / 18.0, 14);
  let p = (forest * (${RULES.keep[0]} + ${RULES.keep[1]} * smoothstep(0.25, 0.75, grove)) + shrub * ${RULES.shrubKeep}) * min(1.0, thin * thin + 0.04);
  if (cellHash(ci, cj, 3) >= p) { return none; }
  var h = (${RULES.h[0]} + ${RULES.h[1].toFixed(1)} * pow(cellHash(ci, cj, 5), ${RULES.h[2]})) * (0.4 + 0.6 * min(1.0, (tl - elev) / 275.0));
  h = max(4.0, h);
  let r = (0.9 + 0.09 * h) * (0.8 + 0.4 * cellHash(ci, cj, 6)) * ${RULES.stand};
  let w = array<f32, 5>(1.0 * bandW(y, 0.0, 450.0) + 0.35 * bandW(y, 0.0, 420.0), 0.5 * bandW(y, 0.0, 900.0), 0.9 * bandW(y, 0.0, 500.0), 0.9 * bandW(y, 380.0, 1100.0) + 0.6 * bandW(y, 700.0, 1300.0), 0.45 * bandW(y, 0.0, 400.0));
  var tot = 0.0; for (var k = 0u; k < 5u; k++) { tot += w[k]; }
  var layer = 0u;
  if (tot > 0.0) { var pick = cellHash(ci, cj, 4) * tot; for (var k = 0u; k < 5u; k++) { pick -= w[k]; layer = k; if (pick <= 0.0) { break; } } }
  if (cellHash(ci, cj, 7) < 0.03) { layer = 5u; h *= 0.8; }
  return vec4f(x, z, y, bitcast<f32>(packTree(h, r, layer)));
}`;
