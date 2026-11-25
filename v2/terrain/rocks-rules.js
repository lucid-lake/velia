// The boulders' placement rules (M5c): v1's shore boulders (src/landmarks.js boulders(): a jittered 7 m grid over the
// bay, kept on the shore band, never on a beach, about half the band, 0.25–1.25 m, sunk 0.35 r) and the rules' rocks on
// the slopes (src/trees-scatter.js: granite boulders among the brush on steeper open ground), without v1's shore-distance
// grid (M2's rule: the band by height and slope). One candidate per CELL over the bay's 2 m grid box, on the GPU
// (render/rocks.js ROCKS_WGSL, from the same heights and cover the terrain bakes); rockSlot() is its JS twin, line for
// line, for the tests (none floating, none on the deep bed, none on a beach). Deterministic: u32 hashes of the cell.
import { hashU, cellHash } from '../forest/scatter.js';

export { hashU, cellHash };
export const ROCKS = Object.freeze({
  cell: 8,                                          // m: one candidate a cell (v1's shore grid is 7 m)
  box: { x0: -2303, z0: -1791, x1: 3328, z1: 1792 },   // the bay's 2 m grid (terrain/tahoe.json): the shore and the walls round it
  shore: { yMin: -1.5, yMax: 3.0, flatMaxY: 0.8, steepMin: 0.10, keep: 0.55, r: [0.3, 1.2], beachMax: 0.3 },   // the band: v1's −1.5..5 m of shore distance, as a height band (above 0.8 m only where the ground climbs: the bay's flat head is not shore rock)
  slope: { yMin: 2.5, steep: [0.36, 1.2], keep: 0.08, r: [0.5, 1.6], forestMax: 0.6 },   // the rules' rocks: 20–50°, open or brush ground, not under a stand
  sink: 0.35, sinkSlope: 0.4,                       // the centre sits sink · r under the ground, more on a slope (never floating downhill)
  squash: [1.15, 0.7, 1.0],                         // v1's lump: wider, flatter
});
export const SLOT_COUNT = Math.ceil((ROCKS.box.x1 - ROCKS.box.x0) / ROCKS.cell) * Math.ceil((ROCKS.box.z1 - ROCKS.box.z0) / ROCKS.cell);
export const COLS = Math.ceil((ROCKS.box.x1 - ROCKS.box.x0) / ROCKS.cell);
// The rocks' box follows the start's detail level (South Lake's look; v2/terrain/region.js): a page that starts on a region
// level scatters the shore rocks, the slope rocks and the bed's stones over that level's box (its 4 m heights and cover
// fill the bay's slot, so the same rules read the same slots); a start in the bay keeps ROCKS.box. rocksFor(levelKey) →
// { box, cols, slots, wgsl }: the bay's are the constants above (the tests pin them).
export const ROCK_BOXES = Object.freeze({   // by the level's key (v2/terrain/region.js levelKeyOfBirth: the region's id, or 'bay')
  bay: ROCKS.box,
  'south-lake': Object.freeze({ x0: 6992, z0: -1504, x1: 14512, z1: 3008 }),   // terrain/south/south.json's box (Camp Richardson to Stateline)
});
// The south shore is sand: its bed is the build's 1:6 shelf from the waterline, which the bay's band rule reads as a rocky shore
// (steep past the beach's 0.06–0.16), so every beach there grew a row of boulders. On the south level a shore rock stands only
// where the land behind it climbs too (the ground slope 12 m uphill of the candidate at least `inland`: a rocky point, the
// walls east toward Stateline), never under a flat beach or lawn. The bay keeps inland 0 (the same text, the same rocks).
export const SHORE_INLAND = Object.freeze({ bay: 0, 'south-lake': 0.09 });
export function rocksFor(levelKey = 'bay') {
  const key = ROCK_BOXES[levelKey] ? levelKey : 'bay', box = ROCK_BOXES[key], inland = SHORE_INLAND[key] ?? 0;
  const cols = Math.ceil((box.x1 - box.x0) / ROCKS.cell), slots = cols * Math.ceil((box.z1 - box.z0) / ROCKS.cell);
  return Object.freeze({ key, box, cols, slots, inland, wgsl: rocksWgsl(box, cols, slots, inland) });
}

import { smooth as smoothstep } from '../../src/sim/core/math.js';

// the twin: cell (ci, cj) → { valid, x, y, z, r, yaw, tone, kind (0 shore, 1 slope), why }
//   field: { height(x, z) }, cover(x, z) → 11 class weights (v1's sampler), S: the season, y0: the lake surface (m ASL)
export function rockSlot(ci, cj, { field, cover, S, y0 }, box = ROCKS.box, inland = 0) {
  const R = ROCKS, C = R.cell;
  const x = box.x0 + (ci + 0.15 + 0.7 * cellHash(ci, cj, 21)) * C, z = box.z0 + (cj + 0.15 + 0.7 * cellHash(ci, cj, 22)) * C;
  const no = (why) => ({ valid: false, x, z, why });
  const h = field.height(x, z);
  if (h < R.shore.yMin) return no('deep');
  const gx = (field.height(x + 2, z) - field.height(x - 2, z)) / 4, gz = (field.height(x, z + 2) - field.height(x, z - 2)) / 4;
  const steep = Math.hypot(gx, gz);
  const c = cover(x, z);
  const water = c[1], forest = c[5] + 0.5 * (c[2] + 0.4 * c[3]) + 0.42 * c[3], urban = (c[2] + c[3] * 0.4) * 0.5;
  const beach = smoothstep(0.16, 0.06, steep) * (1 - smoothstep(0.8, 1.8, h)) * (1 - Math.min(urban, 1));
  let kind = -1, r = 0;
  if (h <= R.shore.yMax) {
    if (h > R.shore.flatMaxY && steep < R.shore.steepMin) return no('flat');
    if (beach > R.shore.beachMax) return no('beach');
    if (urban > 0.3) return no('urban');
    if (inland > 0) {   // the land behind must climb too (a sand beach's 1:6 shelf is not a rocky shore): the rise from 12 to 30 m uphill
      const g = Math.max(steep, 1e-6), dx = gx / g, dz = gz / g;
      if ((field.height(x + 30 * dx, z + 30 * dz) - field.height(x + 12 * dx, z + 12 * dz)) / 18 < inland) return no('beach');
    }
    if (cellHash(ci, cj, 23) >= R.shore.keep) return no('sparse');
    const u = cellHash(ci, cj, 24); r = R.shore.r[0] + (R.shore.r[1] - R.shore.r[0]) * u * u; kind = 0;
  } else {
    if (steep < R.slope.steep[0] || steep > R.slope.steep[1]) return no('slope');
    if (water > 0.3 || urban > 0.3) return no('cover');
    if (forest > R.slope.forestMax) return no('forest');
    const nl = Math.hypot(gx, 1, gz), nz = -gz / nl, nh = steep / nl;
    const north = -nz / Math.max(nh, 1e-6), line = S.snowLine - S.aspectM * north * Math.min(1, steep * 3);
    const snow = smoothstep(line, line + S.fullM, h + y0) * (1 - smoothstep(S.maxSlope * 0.8, S.maxSlope * 1.2, steep));
    if (snow > 0.4) return no('snow');
    if (cellHash(ci, cj, 23) >= R.slope.keep) return no('sparse');
    const u = cellHash(ci, cj, 24); r = R.slope.r[0] + (R.slope.r[1] - R.slope.r[0]) * u * u; kind = 1;
  }
  const y = h - r * (R.sink + R.sinkSlope * Math.min(steep, 1));
  return { valid: true, x, y, z, r, yaw: cellHash(ci, cj, 25) * Math.PI * 2, tone: cellHash(ci, cj, 26), kind, why: '' };
}

// the WGSL twin (render/rocks.js prepends the terrain's heights, the cover reader and the noise): rockSlot(ci, cj) → the record
// the south's inland test as WGSL for the bed's stones too (render/rocks.js): the rise from 12 to 30 m uphill of p is under `inland`
export const inlandFlatWgsl = (inland) => `fn inlandFlat(p: vec2f) -> bool {
  let g = vec2f(terrainHeight(p.x + 2.0, p.y) - terrainHeight(p.x - 2.0, p.y), terrainHeight(p.x, p.y + 2.0) - terrainHeight(p.x, p.y - 2.0)) * 0.25;
  let d = g / max(length(g), 1e-6);
  return (terrainHeight(p.x + 30.0 * d.x, p.y + 30.0 * d.y) - terrainHeight(p.x + 12.0 * d.x, p.y + 12.0 * d.y)) / 18.0 < ${inland.toFixed(3)};
}`;
export const rocksWgsl = (box = ROCKS.box, cols = COLS, slots = SLOT_COUNT, inland = 0) => `
const RK_X0 = ${box.x0.toFixed(1)}; const RK_Z0 = ${box.z0.toFixed(1)}; const RK_C = ${ROCKS.cell}.0; const RK_COLS = ${cols}u; const RK_N = ${slots}u;
struct Rock { valid: bool, x: f32, y: f32, z: f32, r: f32, yaw: f32, tone: f32, kind: f32 }
fn rockSlot(ci: i32, cj: i32) -> Rock {
  var o: Rock; o.valid = false;
  let x = RK_X0 + (f32(ci) + 0.15 + 0.7 * cellHash(ci, cj, 21)) * RK_C; let z = RK_Z0 + (f32(cj) + 0.15 + 0.7 * cellHash(ci, cj, 22)) * RK_C;
  o.x = x; o.z = z;
  let h = terrainHeight(x, z);
  if (h < ${ROCKS.shore.yMin}) { return o; }
  let gx = (terrainHeight(x + 2.0, z) - terrainHeight(x - 2.0, z)) / 4.0; let gz = (terrainHeight(x, z + 2.0) - terrainHeight(x, z - 2.0)) / 4.0;
  let steep = length(vec2f(gx, gz));
  let c = coverAt(x, z);
  let water = c[1]; let forest = c[5] + 0.5 * (c[2] + 0.4 * c[3]) + 0.42 * c[3]; let urban = (c[2] + c[3] * 0.4) * 0.5;
  let beach = (1.0 - smoothstep(0.06, 0.16, steep)) * (1.0 - smoothstep(0.8, 1.8, h)) * (1.0 - min(urban, 1.0));
  var r = 0.0; var kind = 0.0;
  if (h <= ${ROCKS.shore.yMax}) {
    if (h > ${ROCKS.shore.flatMaxY} && steep < ${ROCKS.shore.steepMin}) { return o; }
    if (beach > ${ROCKS.shore.beachMax} || urban > 0.3) { return o; }${inland > 0 ? `
    { let g = max(steep, 1e-6); let dx = gx / g; let dz = gz / g;   // the land behind must climb too (SHORE_INLAND): the rise from 12 to 30 m uphill
      if ((terrainHeight(x + 30.0 * dx, z + 30.0 * dz) - terrainHeight(x + 12.0 * dx, z + 12.0 * dz)) / 18.0 < ${inland.toFixed(3)}) { return o; } }` : ''}
    if (cellHash(ci, cj, 23) >= ${ROCKS.shore.keep}) { return o; }
    let u = cellHash(ci, cj, 24); r = ${ROCKS.shore.r[0]} + ${ROCKS.shore.r[1] - ROCKS.shore.r[0]} * u * u; kind = 0.0;
  } else {
    if (steep < ${ROCKS.slope.steep[0]} || steep > ${ROCKS.slope.steep[1]}) { return o; }
    if (water > 0.3 || urban > 0.3 || forest > ${ROCKS.slope.forestMax}) { return o; }
    let nl = length(vec3f(gx, 1.0, gz)); let nz = -gz / nl; let nh = steep / nl;
    let north = -nz / max(nh, 1e-6); let line = TU.season.x - TU.season.z * north * min(1.0, steep * 3.0);
    let snow = smoothstep(line, line + TU.season.y, h + TU.season2.w) * (1.0 - smoothstep(TU.season.w * 0.8, TU.season.w * 1.2, steep));
    if (snow > 0.4) { return o; }
    if (cellHash(ci, cj, 23) >= ${ROCKS.slope.keep}) { return o; }
    let u = cellHash(ci, cj, 24); r = ${ROCKS.slope.r[0]} + ${ROCKS.slope.r[1] - ROCKS.slope.r[0]} * u * u; kind = 1.0;
  }
  o.valid = true; o.y = h - r * (${ROCKS.sink} + ${ROCKS.sinkSlope} * min(steep, 1.0)); o.r = r;
  o.yaw = cellHash(ci, cj, 25) * 6.2831853; o.tone = cellHash(ci, cj, 26); o.kind = kind;
  return o;
}`;
export const ROCKS_WGSL = rocksWgsl();
