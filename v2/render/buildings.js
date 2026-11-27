// The lake's buildings and the south shore's landmarks (Phase B of the South Lake birthplace; data: v2/towns/buildings.js,
// tools/v2-buildings-pack.mjs): OpenStreetMap's footprints, the Stateline high-rises, the gondola's terminals, pylons, cables
// and cabins, the boats in the marina's slips. One mesh in blocks (the main body, a cross-gabled wing, a chimney: HOUSE below),
// one pipeline, two instanced draws a frame: the loaded sets' chunks within their range of the eye (4 km; the landmarks 16 km)
// and in the frustum are kept, the near ones (HOUSE.nearM) first with the full mesh, the rest with the far mesh (walls, slopes,
// gables and the wing), their records' indices written to a list (only when the kept set changes), and the draws read the
// instance through it. A compute pass grounds the kept boxes each frame on the terrain the page draws (the coarse levels, the
// south level once it is in: the terrain's own height function, render/terrain.js TERRAIN_HEIGHT; v2/towns/buildings.js
// groundBox is the CPU's twin). Lit as the piers are (render/towns.js SHORE_LIGHT_WGSL: the sun through the transmittance,
// the terrain's shadow, the sky's diffuse (toward neutral, as the tea house's) and reflection, the aerial perspective, the
// clouds in front); no texture: every surface is procedural in the fragment stage and filters to its mean when small. The
// houses (HOUSE): overhanging eaves and rakes with fascia and soffit, an L wing, a chimney, lap siding, corner boards, a stone
// foundation, framed windows and a door, shingle or metal roofs, the eave's shadow, warm lit windows at night. The big blocks:
// v1's walls and the high-rises' facades, a framed window grid, a coping band (dark glass by day; lit by a share of windows at
// night, the high-rises brightest). Desktop and tablet only (src/core/features.js buildings; buildingsTier lite: the far mesh
// everywhere).
//
//   const BD = createBuildings({ device, reg, frameBGL, frameStruct, sky, shadow, terrain, hdrTarget, msaa, depthFormat, errors })
//   BD.load(['lake', 'south']) after the first frame (a capture: await BD.prime(sets)); BD.update(eye, viewProj) in fill();
//   BD.run(pass, c) in a compute pass (the grounding); BD.draw(pass, c) in the scene, opaque, after the towns
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { TERRAIN_BIND, TERRAIN_HEIGHT } from './terrain.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { SHORE_LIGHT_WGSL } from './towns.js';
import { frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { inflate } from '../terrain/decode.js';
import { decodeBuildings, instanceArray, pickChunks, SETS, GROUND, KIND, MODE, INST_FLOATS } from '../towns/buildings.js';

export const BUILDING_FILES = Object.freeze(Object.fromEntries(Object.values(SETS).map((s) => [s.id, new URL(`../assets/towns/${s.file}`, import.meta.url)])));
// the look: the big blocks' window grid (m), the panes' share of a cell, the glass, the night's radiance of a lit window (HDR,
// × the high-rises' gain), when it comes on (the sun's elevation, as sin); the houses' own (HOUSE below)
export const LOOK = Object.freeze({ colM: 3.0, floorM: 3.2, pane: [0.16, 0.84, 0.28, 0.82], glass: 0x1d2328, glassTower: 0.8, winRad: 0.02, towerGain: 3.0, nightSin: [0.12, -0.04], rough: 0.85 });
// the houses, cabins, lodges and boathouses (OSM's small kinds) built as a real lakeside house, not a box: the eaves' and the
// rakes' overhang, the fascia (a coping band on a flat roof), a cross-gabled wing on about half the pitched ones (an L inside
// the footprint, its ridge across the main one at the same pitch), a stone chimney on about two in three; lap siding with
// corner boards, a stone foundation (the downhill side's basement wall on a slope), framed windows on a 3 m bay and a door,
// shingle or standing-seam metal roofs, the soffit's shadow line and the eave's cast shadow; warm lit windows after dusk.
// Every pattern filters to its mean as it shrinks under a few pixels, so the far house keeps its value and never pops.
export const HOUSE = Object.freeze({
  ohM: 0.55, rakeM: 0.35, fasciaM: 0.22, copingOhM: 0.18, copingM: 0.45,   // overhangs and bands (m)
  wingShare: 0.55, chimneyShare: 0.65, metalShare: 0.3,                       // how many get a wing, a chimney, a metal roof
  boardM: 0.21, bayM: 3.0, storeyM: 2.9, footM: 0.55, cornerM: 0.14,          // siding, window bays, storeys, foundation, corner boards (m)
  litShare: [0.3, 0.65], houseGain: 4.0,                                      // a lit window's share at night, its radiance × LOOK.winRad
  skyNeutral: 0.6,                                                           // the sky's light toward neutral (the tea house's rule: no blue cast)
  yardM: [2.5, 4.5], lotM: 5.0, treeShare: 0.65, shrubM: [0.9, 1.7], treeM: [11.0, 20.0],   // the yard, its shrubs and fir
  pitchK: [0.75, 1.35], nightAmb: 0.25, porchShare: 0.7,                     // the roofs' pitch spread; the night's ambient trim; porch lamps
  nearM: 800,                                                                 // a chunk this close draws the full mesh; past it, the far one
  wall: 0x5f5548, trim: [0xb9b1a1, 0x3a2c22, 0x34402f], stone: 0x6f6a62, glass: 0x141a20, door: 0x3a281c,
});
// what each vertex is: its part (the material) and, in n.w, its code: the block (0 the main body, 1 the wing, 2 the chimney)
// and how the vertex stage moves it (out along x by the rake, out along z by the eave, down by the eave's drop at the roof's
// pitch, on the roof's height scale, down by the fascia's depth)
export const PART = Object.freeze({ wall: 0, slope: 1, top: 2, bow: 3, gable: 4, fascia: 5, soffit: 6, chimney: 7, apron: 8, shrub: 9, tree: 10, trunk: 11 });
export const CODE = Object.freeze({ pushX: 8, pushZ: 16, drop: 32, roofY: 64, fdown: 128 });
// the blocks: the main body, the wing, the chimney (a big block's rooftop plant), the yard (a ring draped on the terrain round
// the footprint), two shrubs, a fir
export const BLOCK = Object.freeze({ main: 0, wing: 1, chimney: 2, apron: 3, shrubA: 4, shrubB: 5, tree: 6 });

// the unit mesh, in blocks: each block x, z ∈ [−0.5, 0.5], y ∈ [0, 1] (walls: base to eaves; with CODE.roofY: eaves to ridge).
// The main block: the walls (their bow third, x > 0.15: part bow, which a hull pinches to a point), the flat top, two slopes
// (ridge along x), two gables, the slopes' undersides (the soffit), the eaves' and the rakes' fascia. The wing: the same
// without the top and the bow. The chimney: a box. Each vertex: x, y, z, part, the normal (a slope's is made in the vertex
// stage), the code. Faces wound counter-clockwise from outside (checked here against the normal on the moved positions).
// The yard, the shrubs and the fir: free vertices (below). → { V, I, near: the full mesh's index count, farFirst, farCount: the far
// mesh's (the walls, slopes, gables, the yard and the fir) }
export function unitMesh() {
  const V = [], I = [], far = [];
  const at = (p, code) => {   // a stand-in position with every move applied (for the winding check only)
    const sx = Math.sign(p[0]), sz = Math.sign(p[2]);
    let y = p[1];
    if (code & CODE.roofY) y = 1 + p[1] * 0.5 - (code & CODE.drop ? 0.05 : 0) - (code & CODE.fdown ? 0.1 : 0);
    return [p[0] + (code & CODE.pushX ? 0.1 * sx : 0), y, p[2] + (code & CODE.pushZ ? 0.1 * sz : 0)];
  };
  const face = (pts, n, part, codes, isFar) => {
    const b = V.length / 8;
    pts.forEach((p, k) => V.push(p[0], p[1], p[2], part, n[0], n[1], n[2], codes[k]));
    const P = pts.map((p, k) => at(p, codes[k]));
    const nn = part === PART.slope ? [0, 1, n[2]] : part === PART.soffit ? [0, -1, n[2]] : n;
    const tri = (a, c, d) => {
      const A = P[a], C = P[c], D = P[d];
      const u = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
      const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const t = (x[0] * nn[0] + x[1] * nn[1] + x[2] * nn[2]) >= 0 ? [b + a, b + c, b + d] : [b + a, b + d, b + c];
      I.push(...t); if (isFar) far.push(...t);
    };
    tri(0, 1, 2); if (pts.length === 4) tri(0, 2, 3);
  };
  const { pushX, pushZ, drop, roofY, fdown } = CODE;
  function gabled(blk, withTop, bowSplit) {
    const c = (k) => blk | k, X = 0.15;
    const w4 = c(0);
    for (const s of [-1, 1]) {
      if (bowSplit) {
        face([[-0.5, 0, s * 0.5], [X, 0, s * 0.5], [X, 1, s * 0.5], [-0.5, 1, s * 0.5]], [0, 0, s], PART.wall, [w4, w4, w4, w4], true);
        face([[X, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 1, s * 0.5], [X, 1, s * 0.5]], [0, 0, s], PART.bow, [w4, w4, w4, w4], true);
        face([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0.5], [s * 0.5, 1, -0.5]], [s, 0, 0], s > 0 ? PART.bow : PART.wall, [w4, w4, w4, w4], true);
      } else {
        face([[-0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 1, s * 0.5], [-0.5, 1, s * 0.5]], [0, 0, s], PART.wall, [w4, w4, w4, w4], true);
        face([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0.5], [s * 0.5, 1, -0.5]], [s, 0, 0], PART.wall, [w4, w4, w4, w4], true);
      }
    }
    if (withTop) {
      face([[-0.5, 1, -0.5], [X, 1, -0.5], [X, 1, 0.5], [-0.5, 1, 0.5]], [0, 1, 0], PART.top, [w4, w4, w4, w4], true);
      face([[X, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [X, 1, 0.5]], [0, 1, 0], PART.top, [w4, w4, w4, w4], true);
    }
    const eave = c(roofY | pushX | pushZ | drop), ridge = c(roofY | pushX), wallTop = c(roofY);
    for (const s of [-1, 1]) {
      const sl = [[-0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 1, 0], [-0.5, 1, 0]], sc = [eave, eave, ridge, ridge];
      face(sl, [0, 1, s], PART.slope, sc, true);                   // a slope (its normal: the vertex stage's)
      face(sl, [0, -1, s], PART.soffit, sc, false);                // its underside: the soffit under the eave and the rake
      face([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0]], [s, 0, 0], PART.gable, [wallTop, wallTop, wallTop], true);   // a gable end
      // the eave's fascia (a flat roof's coping band) and the rakes' barge boards
      face([[-0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [-0.5, 0, s * 0.5]], [0, 0, s], PART.fascia, [c(roofY | pushX | pushZ | drop | fdown), c(roofY | pushX | pushZ | drop | fdown), eave, eave], false);
      for (const t of [-1, 1]) face([[s * 0.5, 0, t * 0.5], [s * 0.5, 1, 0], [s * 0.5, 1, 0], [s * 0.5, 0, t * 0.5]], [s, 0, 0], PART.fascia, [c(roofY | pushX | pushZ | drop | fdown), c(roofY | pushX | fdown), ridge, eave], false);
    }
  }
  gabled(0, true, true);
  gabled(1, false, false);
  // the chimney: four sides and its cap
  const ch = 2;
  for (const s of [-1, 1]) {
    face([[-0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 1, s * 0.5], [-0.5, 1, s * 0.5]], [0, 0, s], PART.chimney, [ch, ch, ch, ch], false);
    face([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0.5], [s * 0.5, 1, -0.5]], [s, 0, 0], PART.chimney, [ch, ch, ch, ch], false);
  }
  face([[-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]], [0, 1, 0], PART.chimney, [ch, ch, ch, ch], false);
  // free vertices with their own (smooth) normals; a triangle wound counter-clockwise seen along `out` (its outside)
  const vtx = (p, part, n, code) => { V.push(p[0], p[1], p[2], part, n[0], n[1], n[2], code); return V.length / 8 - 1; };
  const tri3 = (a, b, c, out, isFar, P) => {
    const A = P(a), B = P(b), C = P(c);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const t = x[0] * out[0] + x[1] * out[1] + x[2] * out[2] >= 0 ? [a, b, c] : [a, c, b];
    I.push(...t); if (isFar) far.push(...t);
  };
  const posOf = (i) => [V[i * 8], V[i * 8 + 1], V[i * 8 + 2]];
  // the yard: the footprint's 4 corners (samples 8–11) to a ring of 8 points out past it (samples 0–7), each point's height the
  // grounding pass's sample (p.y holds the sample's index)
  const OUT = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]], IN = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const ring = OUT.map((o, i) => vtx([o[0], i, o[1]], PART.apron, [0, 1, 0], BLOCK.apron));
  const inner = IN.map((o, i) => vtx([o[0], 8 + i, o[1]], PART.apron, [0, 1, 0], BLOCK.apron));
  const flat = (i) => { const k = V[i * 8 + 1] >= 8 ? 1 : 1.5; return [V[i * 8] * k, 0, V[i * 8 + 2] * k]; };
  for (let sd = 0; sd < 4; sd++) {
    const a = inner[sd], b = inner[(sd + 1) % 4], o0 = ring[2 * sd], o1 = ring[2 * sd + 1], o2 = ring[(2 * sd + 2) % 8];
    tri3(a, o0, o1, [0, 1, 0], true, flat); tri3(a, o1, b, [0, 1, 0], true, flat); tri3(b, o1, o2, [0, 1, 0], true, flat);
  }
  // two shrubs: a rounded clump (a 6-sided ring at the ground, a wider one at half height, a crown), smooth normals
  for (const blk of [BLOCK.shrubA, BLOCK.shrubB]) {
    const N = 6, r0 = [], r1 = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a);
      r0.push(vtx([0.75 * c, 0, 0.75 * sn], PART.shrub, [c, 0.1, sn], blk)); r1.push(vtx([c, 0.5, sn], PART.shrub, [c * 0.8, 0.6, sn * 0.8], blk));
    }
    const top = vtx([0, 1, 0], PART.shrub, [0, 1, 0], blk);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, a = ((i + 0.5) / N) * 2 * Math.PI, out = [Math.cos(a), 0.3, Math.sin(a)];
      tri3(r0[i], r0[j], r1[j], out, false, posOf); tri3(r0[i], r1[j], r1[i], out, false, posOf); tri3(r1[i], r1[j], top, [out[0], 1, out[2]], false, posOf);
    }
  }
  // a fir: three stacked cones (base y, apex y, radius, in units of its height) on a trunk
  for (const [b0, b1, r] of [[0.12, 0.55, 0.42], [0.36, 0.8, 0.31], [0.6, 1.0, 0.2]]) {
    // a ragged skirt: ten points, every other one drawn in and up (the boughs' tips and the gaps between them)
    const N = 10, ringT = [], hgt = b1 - b0;
    for (let i = 0; i < N; i++) { const a = (i / N) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a), k = i % 2 ? 0.7 : 1; ringT.push(vtx([r * k * c, b0 + (i % 2 ? 0.05 : 0), r * k * sn], PART.tree, [c * hgt, r, sn * hgt], BLOCK.tree)); }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, a = ((i + 0.5) / N) * 2 * Math.PI, c = Math.cos(a), sn = Math.sin(a);
      const apex = vtx([0, b1, 0], PART.tree, [c * hgt, r, sn * hgt], BLOCK.tree);
      tri3(ringT[i], ringT[j], apex, [c, 0.4, sn], true, posOf);
    }
  }
  { const r = 0.03, q = [[-r, -r], [r, -r], [r, r], [-r, r]];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, nx = (q[i][0] + q[j][0]) / (2 * r), nz = (q[i][1] + q[j][1]) / (2 * r);
      const a = vtx([q[i][0], 0, q[i][1]], PART.trunk, [nx, 0, nz], BLOCK.tree), b = vtx([q[j][0], 0, q[j][1]], PART.trunk, [nx, 0, nz], BLOCK.tree);
      const c = vtx([q[j][0], 0.14, q[j][1]], PART.trunk, [nx, 0, nz], BLOCK.tree), d = vtx([q[i][0], 0.14, q[i][1]], PART.trunk, [nx, 0, nz], BLOCK.tree);
      tri3(a, b, c, [nx, 0, nz], false, posOf); tri3(a, c, d, [nx, 0, nz], false, posOf);
    } }
  const near = I.length;
  I.push(...far);
  return { V: new Float32Array(V), I: new Uint16Array(I), near, farFirst: near, farCount: far.length };
}

const hexLin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(5)).join(', ')})`;
const INST_STRUCT = 'struct Inst { a: vec4f, b: vec4f, c: vec4f, d: vec4u }';
// a building's own numbers (its record's index hashed): the same in the grounding pass and the draw
const HASH_WGSL = `fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn hr(i: u32, k: u32) -> f32 { return f32(pcg(i * 16u + k) >> 8u) / 16777216.0; }
fn isHouse(kind: u32) -> bool { return kind == ${KIND.house}u || kind == ${KIND.lodge}u || kind == ${KIND.boathouse}u; }
// the yard's reach past the footprint (m): a house's 2.5–4.5, a big block's lot 5; none for a hull or a part
fn yardM(rid: u32, kind: u32) -> f32 { return select(select(0.0, ${HOUSE.lotM.toFixed(2)}, kind < ${KIND.hull}u), mix(${HOUSE.yardM[0].toFixed(2)}, ${HOUSE.yardM[1].toFixed(2)}, hr(rid, 15u)), isHouse(kind)); }`;

// the grounding: one thread a kept box; → G[k] = (base, top) for the box in slot k (groundBox's twin)
export const GROUND_WGSL = `${TERRAIN_BIND(0)}
${TERRAIN_HEIGHT}
${INST_STRUCT}
struct GP { n: u32, p1: u32, p2: u32, p3: u32 }
@group(1) @binding(0) var<storage, read> INST: array<Inst>;
@group(1) @binding(1) var<storage, read> IDX: array<u32>;
@group(1) @binding(2) var<storage, read_write> G: array<vec2f>;
@group(1) @binding(3) var<uniform> GPU_: GP;
@group(1) @binding(4) var<storage, read_write> GY: array<vec4f>;
${HASH_WGSL}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x; if (k >= GPU_.n) { return; }
  let rid = IDX[k]; let q = INST[rid];
  let mode = (u32(q.c.y) >> 4u) & 3u;
  if (mode == ${MODE.abs}u) { G[k] = vec2f(q.a.y, q.a.y + q.b.z); return; }
  if (mode == ${MODE.foot}u) { G[k] = vec2f(terrainHeight(q.a.x, q.a.z) - ${GROUND.footSink.toFixed(2)}, q.a.y); return; }
  let ca = cos(q.a.w); let sa = sin(q.a.w); let hl = q.b.x * 0.5; let hw = q.b.y * 0.5;
  var y0 = 1e9; var y1 = -1e9; var ym = 0.0;
  for (var c = 0; c < 4; c++) {
    let u = select(-1.0, 1.0, c == 1 || c == 2); let v = select(-1.0, 1.0, c >= 2);
    let y = terrainHeight(q.a.x + u * hl * ca + v * hw * sa, q.a.z - u * hl * sa + v * hw * ca);
    y0 = min(y0, y); y1 = max(y1, y); ym += 0.25 * y;
  }
  let base = max(y0, ym - ${GROUND.sinkMax.toFixed(2)}) - ${GROUND.under.toFixed(2)};
  // the yard's 12 heights: a ring of 8 past the footprint (corners and mids), then the footprint's 4 corners
  let e = yardM(rid, u32(q.c.y) & 15u);
  var hs: array<f32, 12>;
  for (var i = 0; i < 12; i++) {
    var u = 0.0; var v = 0.0; var r = 1.0;
    if (i < 8) { let o = array<vec2f, 8>(vec2f(-1.0, -1.0), vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 0.0)); u = o[i].x * (hl + e); v = o[i].y * (hw + e); }
    else { let o = array<vec2f, 4>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)); u = o[i - 8].x * hl; v = o[i - 8].y * hw; }
    hs[i] = terrainHeight(q.a.x + u * ca + v * sa, q.a.z - u * sa + v * ca);
  }
  GY[3u * k] = vec4f(hs[0], hs[1], hs[2], hs[3]); GY[3u * k + 1u] = vec4f(hs[4], hs[5], hs[6], hs[7]); GY[3u * k + 2u] = vec4f(hs[8], hs[9], hs[10], hs[11]);
  G[k] = vec2f(base, ym + q.b.z + min(${GROUND.uphill.toFixed(2)}, max(0.0, y1 - ${GROUND.uphillFree.toFixed(2)} - ym)));
}`;

export const BUILDINGS_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
@group(2) @binding(0) var tShadowT: texture_depth_2d;
@group(2) @binding(1) var sShadowT: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(2) var<uniform> SH: Shadow;
${SHADOW_READ('tShadowT', 'sShadowT')}
${INST_STRUCT}
@group(3) @binding(0) var<storage, read> INST: array<Inst>;
@group(3) @binding(1) var<storage, read> IDX: array<u32>;
@group(3) @binding(2) var<storage, read> G: array<vec2f>;
@group(3) @binding(3) var<storage, read> GY: array<vec4f>;
fn srgbToLin(c: vec3f) -> vec3f { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
fn unpackRGB(w: u32) -> vec3f { return srgbToLin(vec3f(f32(w & 255u), f32((w >> 8u) & 255u), f32((w >> 16u) & 255u)) / 255.0); }
${HASH_WGSL}
fn desat(c: vec3f, k: f32) -> vec3f { return mix(c, vec3f(dot(c, vec3f(0.2126, 0.7152, 0.0722))), k); }
fn yardH(k: u32, i: u32) -> f32 { let a = GY[3u * k + i / 4u]; let j = i % 4u; return select(select(select(a.w, a.z, j == 2u), a.y, j == 1u), a.x, j == 0u); }
struct VI { @location(0) p: vec4f, @location(1) n: vec4f }
// wl: along the face (m, from its middle), over the base (m), the face's half width (m), under the eaves (m)
// info: the material, the kind, the lit share, the building's hash; ex: the mean ground over the base, the door's x on the
// face (1e9: none; a big block: its facade), the storeys' top over the ground, the eave's overhang; rf: the roof's along-ridge
// and down-slope metres (the yard: its share of the way out, 0 at the walls, and 0)
struct VO { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) alb: vec3f, @location(3) wl: vec4f,
  @location(4) @interpolate(flat) info: vec4f, @location(5) @interpolate(flat) ex: vec4f, @location(6) rf: vec2f }
@vertex fn vs(v: VI, @builtin(instance_index) k: u32) -> VO {
  let rid = IDX[k]; let q = INST[rid]; let g = G[k];
  let flags = u32(q.c.y); let kind = flags & 15u; let part = u32(v.p.w + 0.5); let code = u32(v.n.w + 0.5); let blk = code & 7u;
  let len = q.b.x; let wid = q.b.y; let base = g.x;
  let isBld = kind < ${KIND.hull}u;
  let house = isHouse(kind);
  let pitched = isBld && q.b.w > 0.3;
  // the spread: a house's roof pitch and its eaves' height vary by its hash, so a row never repeats
  let roof = select(q.b.w, q.b.w * mix(${HOUSE.pitchK[0].toFixed(2)}, ${HOUSE.pitchK[1].toFixed(2)}, hr(rid, 13u)), house && pitched);
  let top = g.y + select(0.0, (hr(rid, 14u) - 0.5) * 0.9, house);
  let oh = select(select(0.0, ${HOUSE.copingOhM.toFixed(2)}, isBld), ${HOUSE.ohM.toFixed(2)}, pitched);
  let ohx = select(oh, ${HOUSE.rakeM.toFixed(2)}, pitched);
  let fh = select(select(0.0, ${HOUSE.copingM.toFixed(2)}, isBld), ${HOUSE.fasciaM.toFixed(2)}, pitched);
  let pitch = select(0.0, roof / max(wid * 0.5, 0.1), pitched);
  // the massing: an L (a cross-gabled wing inside the footprint) and a chimney, by the building's hash
  let hasL = house && pitched && len > 7.5 && wid > 6.5 && hr(rid, 1u) < ${HOUSE.wingShare.toFixed(2)};
  let d = select(0.0, mix(0.3, 0.42, hr(rid, 2u)), hasL);
  let mW = (1.0 - d) * wid; let mCz = -0.5 * d * wid;
  let mRoof = select(roof, pitch * mW * 0.5, pitched);
  let sgn = select(-1.0, 1.0, hr(rid, 3u) > 0.5);
  let wW = min(mix(0.38, 0.5, hr(rid, 4u)) * len, 0.85 * mW);
  let wL = wid * 0.5 - mCz;
  let wC = vec2f(sgn * (len * 0.5 - wW * 0.5), (mCz + wid * 0.5) * 0.5);
  let hasC = house && pitched && len > 5.0 && hr(rid, 5u) < ${HOUSE.chimneyShare.toFixed(2)};
  let plant = isBld && !house && !pitched && len > 12.0 && wid > 10.0;   // a big block's rooftop plant (the chimney block)
  let e = yardM(rid, kind);
  var BL = len; var BW = mW; var BR = mRoof; var en = 1.0;
  if (blk == 1u) { BL = wL; BW = wW; BR = pitch * wW * 0.5; en = select(0.0, 1.0, hasL); }
  if (blk == 2u) {
    BL = select(0.9, len * mix(0.15, 0.3, hr(rid, 16u)), plant); BW = select(0.7, wid * mix(0.2, 0.35, hr(rid, 17u)), plant); BR = 0.0;
    en = select(0.0, 1.0, hasC || plant);
  }
  var mx = v.p.x * BL; var mz = v.p.z * BW;
  if ((code & ${CODE.pushX}u) != 0u) { mx += sign(v.p.x) * ohx; }
  if ((code & ${CODE.pushZ}u) != 0u) { mz += sign(v.p.z) * oh; }
  var ly: f32;
  if (blk == 2u) { ly = select(mix(top - 0.5, top + 0.7 * mRoof + 1.1, v.p.y), mix(top - 0.3, top + 2.6, v.p.y), plant); }
  else if ((code & ${CODE.roofY}u) != 0u) {
    ly = top + v.p.y * BR;
    if ((code & ${CODE.drop}u) != 0u) { ly -= oh * pitch; }
    if ((code & ${CODE.fdown}u) != 0u) { ly -= fh; }
  } else { ly = mix(base, top, v.p.y); }
  var nl = v.n.xyz;
  if (part == ${PART.slope}u) { nl = normalize(vec3f(0.0, 0.5 * BW, v.n.z * max(BR, 1e-3))); }
  if (part == ${PART.soffit}u) { nl = -normalize(vec3f(0.0, 0.5 * BW, v.n.z * max(BR, 1e-3))); }
  if (kind == ${KIND.hull}u && blk == 0u && v.p.x > 0.15) {   // a hull's bow: the sides pinched to the stem
    mz *= 1.0 - (v.p.x - 0.15) / 0.35;
    if (part == ${PART.bow}u && abs(v.n.z) > 0.5) { nl = normalize(vec3f(0.5 * wid, 0.0, v.n.z * 0.35 * len)); }
  }
  if (blk == 0u) { ly += q.c.x * v.p.x; }   // a cable span's rise (its shear)
  let along = select(mz, mx, abs(v.n.z) > 0.5); let halfX = 0.5 * select(BW, BL, abs(v.n.z) > 0.5);
  mx *= en; mz *= en;
  var fx = mx; var fz = mCz + mz; var nf = nl;
  var yt = 0.0;   // the yard: its share of the way out
  if (blk == 1u) { fx = wC.x - mz; fz = wC.y + mx; nf = vec3f(-nl.z, nl.y, nl.x); }
  if (blk == 2u) {
    fx = select(-sgn * (len * 0.5 - 1.1), (hr(rid, 18u) - 0.5) * (len - BL) * 0.8, plant) + mx;
    fz = select(mCz + 0.15 * mW, (hr(rid, 19u) - 0.5) * (wid - BW) * 0.8, plant) + mz;
  }
  if (blk == ${BLOCK.apron}u) {
    let i = u32(v.p.y + 0.5); let out = select(e, 0.0, i >= 8u);
    fx = v.p.x * (len * 0.5 + out); fz = v.p.z * (wid * 0.5 + out); ly = yardH(k, i) + 0.07;
    yt = select(1.0, 0.0, i >= 8u);
    if (e <= 0.0) { fx = 0.0; fz = 0.0; }
  }
  if (blk >= ${BLOCK.shrubA}u) {
    // a shrub at a corner or a side's middle, a fir at another corner, each on the yard's sample there
    let c = u32(hr(rid, 20u) * 4.0) % 4u;
    var i = 2u * c; var s = mix(${HOUSE.shrubM[0].toFixed(2)}, ${HOUSE.shrubM[1].toFixed(2)}, hr(rid, 21u)); var on = house;
    var reach = 0.45;
    if (blk == ${BLOCK.shrubB}u) { i = (2u * c + 3u) % 8u; s = mix(${HOUSE.shrubM[0].toFixed(2)}, ${HOUSE.shrubM[1].toFixed(2)}, hr(rid, 22u)); on = house && hr(rid, 23u) < 0.8; reach = 0.35; }
    if (blk == ${BLOCK.tree}u) { i = (2u * c + 4u) % 8u; s = mix(${HOUSE.treeM[0].toFixed(2)}, ${HOUSE.treeM[1].toFixed(2)}, hr(rid, 24u)); on = isBld && hr(rid, 25u) < select(0.4, ${HOUSE.treeShare.toFixed(2)}, house); reach = 0.7; }
    let o = array<vec2f, 8>(vec2f(-1.0, -1.0), vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 0.0))[i];
    let gy = yardH(k, i);
    let sx = select(1.0, 1.6, blk == ${BLOCK.shrubB}u);   // the side's shrub is a longer hedge clump
    let ang = hr(rid, 26u) * 6.2831853; let cr = cos(ang); let sr = sin(ang);
    let lx = v.p.x * s * sx; let lz = v.p.z * s;
    fx = o.x * (len * 0.5 + e * reach) + (lx * cr - lz * sr); fz = o.y * (wid * 0.5 + e * reach) + (lx * sr + lz * cr);
    ly = gy - 0.15 + v.p.y * s * select(1.1, 1.0, blk == ${BLOCK.tree}u);
    nf = vec3f(nl.x * cr - nl.z * sr, nl.y, nl.x * sr + nl.z * cr);
    if (!on || e <= 0.0) { fx = 0.0; fz = 0.0; ly = base; }
  }
  let ca = cos(q.a.w); let sa = sin(q.a.w);
  let w = vec3f(q.a.x + fx * ca + fz * sa, ly, q.a.z - fx * sa + fz * ca);
  var o: VO; o.pos = F.viewProj * vec4f(w, 1.0); o.world = w; o.n = vec3f(nf.x * ca + nf.z * sa, nf.y, -nf.x * sa + nf.z * ca);
  // the materials: 0 plain (a hull, a part), 1 siding, 2 a big block's wall, 3 shingle, 4 metal, 5 a flat roof, 6 trim, 7 soffit,
  // 8 the chimney's stone, 9 a gable's siding, 10 the yard, 11 foliage, 12 bark, 13 rooftop plant
  let hb = hr(rid, 0u);
  let wallC = unpackRGB(q.d.x); let roofC = unpackRGB(q.d.y);
  let tr = hr(rid, 6u);
  let trim = select(select(${v3(hexLin(HOUSE.trim[2]))}, ${v3(hexLin(HOUSE.trim[1]))}, tr < 0.85), ${v3(hexLin(HOUSE.trim[0]))}, tr < 0.6);
  let roofPart = part == ${PART.slope}u || part == ${PART.top}u;
  let wallPart = part == ${PART.wall}u || part == ${PART.bow}u;
  var mat = 0u; var alb = select(wallC, roofC, roofPart);
  if (house) {
    let wv = desat(wallC, 0.05) * vec3f(1.05, 1.0, 0.92) * (0.72 + 0.3 * hr(rid, 7u));   // stained wood and paint, warmer and a touch darker than the palette
    let metal = hr(rid, 8u) < select(${HOUSE.metalShare.toFixed(2)}, 0.5, kind == ${KIND.lodge}u);
    let rv = desat(roofC, 0.25) * (0.7 + 0.3 * hr(rid, 9u));
    if (wallPart) { mat = 1u; alb = wv; }
    if (part == ${PART.gable}u) { mat = 9u; alb = wv; }
    if (roofPart) { mat = select(5u, select(3u, 4u, metal), pitched); alb = rv; }
    if (part == ${PART.fascia}u) { mat = 6u; alb = trim; }
    if (part == ${PART.soffit}u) { mat = 7u; alb = trim * 0.75; }
    if (part == ${PART.chimney}u) { mat = 8u; alb = ${v3(hexLin(HOUSE.stone))} * (0.8 + 0.35 * hr(rid, 10u)); }
  } else if (isBld) {
    if (wallPart || part == ${PART.gable}u) { mat = 2u; }
    if (roofPart) { mat = select(5u, 3u, pitched); alb = desat(roofC, 0.2); }
    if (part == ${PART.fascia}u) { mat = 6u; alb = ${v3(hexLin(0x8a867d))}; }
    if (part == ${PART.soffit}u) { mat = 7u; alb = ${v3(hexLin(0x5e5b55))}; }
    if (part == ${PART.chimney}u) { mat = 13u; alb = ${v3(hexLin(0x6a6c6c))} * (0.85 + 0.25 * hr(rid, 10u)); }
  }
  if (part == ${PART.apron}u) { mat = 10u; alb = select(${v3(hexLin(0x3a3b3b))}, ${v3(hexLin(0x3a3529))}, house) * (0.8 + 0.25 * hr(rid, 27u)); }
  if (part == ${PART.shrub}u || part == ${PART.tree}u) { mat = 11u; alb = ${v3(hexLin(0x2c3a26))} * mix(vec3f(0.85, 0.95, 0.9), vec3f(1.1, 1.05, 0.95), hr(rid, 28u)); }
  if (part == ${PART.trunk}u) { mat = 12u; alb = ${v3(hexLin(0x4a3a2c))}; }
  o.alb = alb;
  o.wl = vec4f(select(along, fx, part == ${PART.apron}u), select(ly - base, fz, part == ${PART.apron}u), halfX, top - ly);
  let ground = top - q.b.z - base;
  let lit = select(q.c.z, mix(${HOUSE.litShare[0].toFixed(2)}, ${HOUSE.litShare[1].toFixed(2)}, hr(rid, 11u)), house);
  o.info = vec4f(f32(mat), f32(kind), lit, hb);
  // the door: the main block's front (+z) wall, in the free part of it beside the wing (the yard: the door's x in the footprint)
  let doorX = -sgn * len * mix(0.05, 0.25, hr(rid, 12u));
  let frontOrYard = (blk == 0u && wallPart && v.n.z > 0.5) || part == ${PART.apron}u;
  let door = select(select(f32((flags >> 8u) & 15u), 1e9, house), doorX, house && frontOrYard);
  o.ex = vec4f(select(ground, wid * 0.5, part == ${PART.apron}u), door, q.b.z, select(0.0, oh, pitched));
  o.rf = select(vec2f(mx, abs(v.p.z * BW) * sqrt(1.0 + pitch * pitch)), vec2f(yt, 0.0), part == ${PART.apron}u);
  if (part == ${PART.tree}u || part == ${PART.shrub}u) { o.rf = vec2f(select(1.0, 0.0, length(v.p.xz) < 1e-4), 0.0); }   // foliage: 0 at a crown's tip, 1 at its skirt
  return o;
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;
}
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x), u.y);
}
// a box's coverage on [a, b] with the pixel's footprint w (filtered: 0..1)
fn band(x: f32, a: f32, b: f32, w: f32) -> f32 { return clamp((min(x + w, b) - max(x - w, a)) / (2.0 * w), 0.0, 1.0); }
${SHORE_LIGHT_WGSL}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let p = v.world; var n = normalize(v.n); let s = normalize(F.sun.xyz);
  let mat = u32(v.info.x + 0.5); let hb = v.info.w;
  var A = v.alb; var emit = vec3f(0.0); var rough = ${LOOK.rough.toFixed(2)}; var metal = 0.0; var ao = 1.0; var sunVis = 1.0; var specK = 1.0;
  let night = smoothstep(${LOOK.nightSin[0].toFixed(3)}, ${LOOK.nightSin[1].toFixed(3)}, s.y);
  let id = floor(hb * 997.0);
  if (mat == 2u) {
    // a big block: a ground floor of its own (stone and shop glass under a canopy line), then storeys of 3.2 m with a slab band
    // and its shadow, balconies' rails on about half, piers between recessed window bays; muted colours (no pure white)
    let yg = v.wl.y - v.ex.x;
    let fwx = max(fwidth(v.wl.x), 1e-4); let fwy = max(fwidth(v.wl.y), 1e-4);
    let lum = dot(A, vec3f(0.2126, 0.7152, 0.0722));
    A = desat(A, 0.3) * vec3f(1.06, 1.0, 0.9) * min(1.0, 0.2 / max(lum, 1e-3)) * (0.9 + 0.15 * vnoise(v.wl.xy * vec2f(0.15, 0.08) + id));
    let tower = v.ex.y > 1.5 && v.ex.y < 2.5;
    let gH = 4.0;
    let cx = v.wl.x / ${LOOK.colM.toFixed(2)}; let fx = fract(cx); let cxi = floor(cx);
    let fy = (yg - gH) / ${LOOK.floorM.toFixed(2)}; let fyy = fract(fy); let fl = floor(fy);
    let sharp = 1.0 - smoothstep(0.25, 0.6, max(fwx / ${LOOK.colM.toFixed(2)}, fwy / ${LOOK.floorM.toFixed(2)}));
    let wx = fwx / ${LOOK.colM.toFixed(2)} * 0.5; let wy = fwy / ${LOOK.floorM.toFixed(2)} * 0.5;
    let upper = smoothstep(-fwy, fwy, yg - gH) * step(fy, (v.ex.z - gH) / ${LOOK.floorM.toFixed(2)});
    let p0 = select(0.14, 0.05, tower); let p1 = 1.0 - p0;
    let win = band(fx, p0 + 0.04, p1 - 0.04, wx) * band(fyy, select(0.3, 0.12, tower), 0.86, wy);
    let recess = band(fx, p0, p1, wx) * band(fyy, 0.1, 0.9, wy);
    let slab = band(fyy, 0.0, 0.09, wy); let slabShade = band(fyy, 0.86, 1.0, wy);
    let rails = select(0.0, band(fyy, 0.12, 0.38, wy) * band(fx, p0, p1, wx), hb > 0.5 && !tower);
    let frameW = band(fx, p0 + 0.04, p1 - 0.04, wx) * band(fyy, select(0.3, 0.12, tower), 0.86, wy) - band(fx, p0 + 0.07, p1 - 0.07, wx) * band(fyy, select(0.33, 0.15, tower), 0.83, wy);
    // the means a small facade reads as (the same shares, flat)
    let wA = (p1 - p0 - 0.08) * (0.86 - select(0.3, 0.12, tower));
    let gWin = mix(wA * 0.85, win - frameW, sharp) * upper;
    var B = A;
    B = mix(B, B * 0.78, mix((p1 - p0) * 0.8, recess, sharp));
    B = mix(B, min(A * 1.35, vec3f(0.36)), mix(0.09, slab, sharp));
    B = mix(B, B * 0.62, mix(0.14, slabShade, sharp) * (1.0 - slab));
    B = mix(B, ${v3(hexLin(0x2a2c2e))}, mix(0.15, rails, sharp) * select(0.0, 1.0, hb > 0.5 && !tower) * 0.7);
    let curtain = select(0.0, 1.0, hash2(vec2f(cxi * 1.7 + id, fl * 3.1)) < 0.3);   // drawn blinds and curtains in some windows
    B = mix(B, mix(${v3(hexLin(0x101418))}, ${v3(hexLin(0x6d6253))}, curtain * sharp + 0.3 * 0.4 * (1.0 - sharp)), gWin);
    A = mix(A, B, upper);
    // the ground floor
    let gf = 1.0 - smoothstep(-fwy, fwy, yg - gH);
    let shop = band(fx, 0.08, 0.92, wx) * band(yg, 0.4, 3.0, fwy * 0.5);
    let canopy = band(yg, 3.2, 3.65, fwy * 0.5);
    var Gc = ${v3(hexLin(0x4f4a43))} * (0.85 + 0.25 * vnoise(v.wl.xy * 0.7 + id));
    Gc = mix(Gc, ${v3(hexLin(0x1c1a17))}, mix(0.6, shop, sharp));
    Gc = mix(Gc, ${v3(hexLin(0x2a2622))}, band(fract(v.wl.x / 1.5), 0.0, 0.06, fwx / 3.0) * shop * sharp);   // the shopfront's mullions
    Gc = mix(Gc, ${v3(hexLin(0x26282a))}, canopy);
    A = mix(A, Gc, gf * step(0.0, yg + 8.0));
    let glassAll = gWin + gf * mix(0.6, shop, sharp);
    rough = mix(rough, 0.4, glassAll); specK = mix(1.0, 0.45, glassAll);
    if (night > 0.0) {
      let litShare = v.info.z;
      let lit = mix(litShare, step(hash2(vec2f(cxi, fl) + vec2f(id, 0.0)), litShare), sharp);
      let gain = select(1.0, ${LOOK.towerGain.toFixed(2)}, v.info.y > 1.5 && v.info.y < 2.5);
      emit = vec3f(1.0, 0.72, 0.45) * (${LOOK.winRad.toFixed(4)} * gain * night) * (lit * gWin + 0.8 * gf * mix(0.6, shop, sharp));
    }
    ao *= 0.7 + 0.3 * smoothstep(0.0, 1.5, v.wl.y);
  }
  if (mat == 1u || mat == 9u) {
    // a house's walls: lap siding, corner boards, a stone foundation, framed windows on a bay, a door; weathered
    let yg = v.wl.y - v.ex.x;   // over the mean ground
    let fwy = max(fwidth(v.wl.y), 1e-4); let fwx = max(fwidth(v.wl.x), 1e-4);
    let bu = v.wl.y / ${HOUSE.boardM.toFixed(3)}; let bf = fract(bu); let bsh = 1.0 - smoothstep(0.25, 0.7, fwy / ${HOUSE.boardM.toFixed(3)});
    let lip = 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.22, bf));
    A *= mix(1.0 - 0.22 * 0.12, lip * (0.95 + 0.1 * hash2(vec2f(floor(bu), id))), bsh);
    A *= 0.86 + 0.22 * vnoise(vec2f(v.wl.x * 0.6, v.wl.y * 0.12) + id);   // weathering streaks
    A *= mix(0.82, 1.0, smoothstep(0.0, 1.2, yg - ${HOUSE.footM.toFixed(2)}));   // the splash line
    let trimC = select(${v3(hexLin(HOUSE.trim[0]))}, ${v3(hexLin(HOUSE.trim[1]))}, hb > 0.6);
    let corner = 1.0 - band(v.wl.x, -v.wl.z + ${HOUSE.cornerM.toFixed(2)}, v.wl.z - ${HOUSE.cornerM.toFixed(2)}, fwx * 0.5);
    A = mix(A, trimC * 0.9, corner * select(1.0, 0.0, mat == 9u));
    // windows: storeys from the foundation, bays of 3 m from the face's middle
    let storeys = max(1.0, floor((v.ex.z - ${HOUSE.footM.toFixed(2)} + 0.3) / ${HOUSE.storeyM.toFixed(2)}));
    let fy = (yg - ${HOUSE.footM.toFixed(2)}) / ${HOUSE.storeyM.toFixed(2)}; let fl = floor(fy); let uy = fract(fy) * ${HOUSE.storeyM.toFixed(2)};
    let cx = v.wl.x / ${HOUSE.bayM.toFixed(2)} + 0.5; let ci = floor(cx); let ux = (fract(cx) - 0.5) * ${HOUSE.bayM.toFixed(2)};
    let ww = 0.5 + 0.25 * fract(hb * 7.31);
    let isDoor = abs(v.wl.x - v.ex.y) < 0.55 && fl == 0.0;
    let doorBay = abs(floor(v.ex.y / ${HOUSE.bayM.toFixed(2)} + 0.5) - ci) < 0.5 && fl == 0.0;
    let has = hash2(vec2f(ci + id * 3.1, fl + 17.0)) > 0.15 && abs(v.wl.x) < v.wl.z - 0.9 && fl >= 0.0 && fl < storeys && mat == 1u && !doorBay;
    let sharp = 1.0 - smoothstep(0.3, 0.8, max(fwx, fwy) / 0.35);
    let win = band(ux, -ww, ww, fwx * 0.5) * band(uy, 0.85, 2.15, fwy * 0.5) * select(0.0, 1.0, has);
    let glassIn = band(ux, -ww + 0.08, ww - 0.08, fwx * 0.5) * band(uy, 0.93, 2.07, fwy * 0.5) * (1.0 - band(ux, -0.03, 0.03, fwx * 0.5)) * (1.0 - band(uy, 1.5, 1.56, fwy * 0.5)) * win;
    let mean = 0.85 * (2.0 * ww * 1.3) / (${HOUSE.bayM.toFixed(2)} * ${HOUSE.storeyM.toFixed(2)}) * step(0.0, fy) * step(fy, storeys) * select(0.0, 1.0, mat == 1u && abs(v.wl.x) < v.wl.z - 0.9);
    let g = mix(mean, glassIn, sharp); let fr = mix(mean * 0.35, win - glassIn, sharp);
    A = mix(A, trimC, fr);
    let cur = select(0.0, 1.0, hash2(vec2f(ci * 1.3 + id, fl * 2.7 + 5.0)) < 0.3);
    A = mix(A, mix(${v3(hexLin(HOUSE.glass))}, ${v3(hexLin(0x75695a))}, cur * sharp + 0.12 * (1.0 - sharp)), g);
    rough = mix(rough, 0.12, g);
    if (isDoor) { let dr = band(uy, 0.0, 2.1, fwy * 0.5); A = mix(A, ${v3(hexLin(HOUSE.door))}, dr * band(abs(v.wl.x - v.ex.y), -1.0, 0.47, fwx * 0.5)); }
    if (night > 0.0) {
      let lit = mix(v.info.z, step(hash2(vec2f(ci + id, fl + 3.0)), v.info.z), sharp);
      emit = vec3f(1.0, 0.68, 0.38) * (${LOOK.winRad.toFixed(4)} * ${HOUSE.houseGain.toFixed(2)} * night) * lit * g;
    }
    // the foundation: stone from the base to the floor line (a basement wall on the downhill side)
    let foot = 1.0 - smoothstep(-fwy, fwy, yg - ${HOUSE.footM.toFixed(2)});
    let st = ${v3(hexLin(HOUSE.stone))} * (0.75 + 0.4 * vnoise(vec2f(v.wl.x * 2.2, v.wl.y * 3.3) + id));
    A = mix(A, st, foot * select(1.0, 0.0, mat == 9u)); rough = mix(rough, 0.95, foot);
    ao *= 0.6 + 0.4 * smoothstep(0.0, 1.2, v.wl.y);
    // the eave's shadow line and its cast shadow on the wall (the sun's elevation seen across the wall)
    if (v.ex.w > 0.0 && mat == 1u) {
      ao *= 0.72 + 0.28 * smoothstep(0.0, 0.7, v.wl.w);
      let nxz = normalize(vec2f(n.x, n.z) + vec2f(1e-5));
      let tanE = s.y / max(dot(vec2f(s.x, s.z), nxz), 1e-3);
      sunVis = smoothstep(-0.05, 0.05, v.wl.w - v.ex.w * max(tanE, 0.0));
    }
  }
  if (mat == 3u) {
    // shingle: courses down the slope, staggered tabs, each its own shade; lichen; never shiny
    let fw = max(fwidth(v.rf.y), 1e-4); let sh = 1.0 - smoothstep(0.2, 0.6, fw / 0.2);
    let cu = v.rf.y / 0.2; let row = floor(cu);
    let tab = floor(v.rf.x / 0.34 + 0.5 * fract(row * 0.5));
    let line = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.25, 1.0 - fract(cu)));
    A *= mix(0.965, line * (0.88 + 0.24 * hash2(vec2f(tab, row) + id)), sh);
    A = mix(A, A * vec3f(0.9, 1.02, 0.85), smoothstep(0.55, 0.85, vnoise(v.rf * 0.35 + id)));
    rough = 0.93; specK = 0.6;
  }
  if (mat == 4u) {
    // standing-seam metal: a seam every 0.45 m along the ridge catches the light; aged paint, not shiny
    let u = v.rf.x / 0.45; let fw = max(fwidth(u), 1e-4); let sh = 1.0 - smoothstep(0.2, 0.6, fw);
    let seam = band(fract(u), 0.0, 0.07, fw * 0.5);
    A *= mix(1.0, 1.0 + 0.35 * seam, sh) * (0.93 + 0.1 * vnoise(v.rf * vec2f(0.2, 0.6) + id));
    rough = 0.5;
  }
  if (mat == 5u) { A *= 0.85 + 0.25 * vnoise(v.rf * 0.3 + id); rough = 0.95; specK = 0.5; }
  if (mat == 6u) { rough = 0.75; }
  if (mat == 7u) { rough = 0.9; ao *= 0.6; }
  if (mat == 8u) {
    let fw = max(fwidth(v.world.y), 1e-4); let sh = 1.0 - smoothstep(0.1, 0.4, fw / 0.18);
    let row = floor(v.world.y / 0.18);
    A *= mix(1.0, 0.8 + 0.35 * hash2(vec2f(row, floor((v.world.x + v.world.z) / 0.3)) + id), sh);
    rough = 0.95; ao *= 0.85;
  }
  if (mat == 10u) {
    // the yard: worn earth and needles (a big block's lot: asphalt), a gravel drive from the door, a ragged edge into the ground
    let t = v.rf.x;
    let nz = vnoise(p.xz * 0.45 + id) * 0.5 + vnoise(p.xz * 1.9) * 0.3 + vnoise(p.xz * 6.0) * 0.2;
    if (t > 0.25 + 0.7 * nz) { discard; }
    A *= 0.75 + 0.4 * vnoise(p.xz * 2.3 + id) * (0.6 + 0.4 * vnoise(p.xz * 9.0));
    A = mix(A, A * vec3f(0.8, 0.95, 0.7), smoothstep(0.3, 0.9, t));   // greener toward the edge, into the ground
    let drive = band(v.wl.x - v.ex.y, -1.4, 1.4, max(fwidth(v.wl.x), 1e-3)) * step(v.ex.x * 0.6, v.wl.y) * select(0.0, 1.0, v.ex.y < 1e8);
    A = mix(A, ${v3(hexLin(0x6a655c))} * (0.85 + 0.3 * vnoise(p.xz * 3.0)), drive);
    rough = 0.97; specK = 0.3; ao *= mix(0.7, 1.0, t);
  }
  if (mat == 11u) {
    // foliage: clumps and gaps, the undersides of the boughs dark
    let cl = vnoise(p.xz * 2.6 + vec2f(p.y * 2.1, p.y * 1.3)) * 0.6 + vnoise(p.xz * 7.0 + vec2f(0.0, p.y * 5.0)) * 0.4;
    if (v.rf.x > 0.72 + 0.35 * cl) { discard; }   // a ragged skirt: the boughs' ends, not a cone's rim
    A *= 0.45 + 0.85 * cl; A *= mix(0.55, 1.0, smoothstep(0.1, 0.7, n.y));
    rough = 0.95; specK = 0.2; ao *= 0.8;
  }
  if (mat == 12u) { rough = 0.95; specK = 0.3; }
  if (mat == 13u) { A *= 0.9 + 0.2 * vnoise(p.xz * 2.0); rough = 0.6; }
  // the porch lamp: a warm lamp beside the door on most houses, its pool on the wall
  if (mat == 1u && night > 0.0 && v.ex.y < 1e8 && hash2(vec2f(id, 5.0)) < ${HOUSE.porchShare.toFixed(2)}) {
    let yg = v.wl.y - v.ex.x;
    let dl = vec2f(v.wl.x - (v.ex.y + 0.85), yg - ${HOUSE.footM.toFixed(2)} - 2.25);
    let r = length(dl);
    emit += vec3f(1.0, 0.62, 0.3) * night * (${LOOK.winRad.toFixed(4)} * 18.0 * (1.0 - smoothstep(0.06, 0.12, r)) + A.g * 0.06 * exp(-r * r / 0.9));
  }
  let nl = max(dot(n, s), 0.0);
  var shadow = 0.0; if (nl > 0.001) { shadow = shadowAt(p, nl) * sunVis; }
  let eSky = LIGHT.sky.rgb + nightLand();
  let eSun = sunAt(p.y, s) * nl * shadow;
  var sk = skyIrr(n); sk = mix(sk, vec3f(dot(sk, vec3f(0.2126, 0.7152, 0.0722))), select(0.0, ${HOUSE.skyNeutral.toFixed(2)}, mat != 0u));
  let trimN = select(1.0, mix(1.0, ${HOUSE.nightAmb.toFixed(2)}, night), mat != 0u);   // at night the walls and roofs sit dark: only the windows and lamps glow
  let E = eSun + (sk + eSky * (0.5 + 0.5 * n.y)) * SKY_K * ao * trimN;
  let V = normalize(F.cam.xyz - p);
  let col = A * E / PI + shoreSpec(n, V, s, A, rough, metal, eSun) * specK * mix(1.0, ao, 0.7) * trimN + emit;
  var out = aerial(col, v.pos.xy, p);
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, 1.0);
}`;

export function createBuildings({ device, reg, frameBGL, frameStruct, sky, shadow, terrain, hdrTarget, msaa = 1, depthFormat = 'depth32float', errors = [], fetchImpl = (u) => fetch(u), lite = false }) {
  const nearM = lite ? 0 : HOUSE.nearM;   // a lite tier draws the far mesh everywhere (src/core/features.js buildingsTier)
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT, CP = GPUShaderStage.COMPUTE, BU = GPUBufferUsage;
  const mesh = unitMesh();
  const vbuf = device.createBuffer({ label: 'buildings-verts', size: mesh.V.byteLength, usage: BU.VERTEX | BU.COPY_DST }); device.queue.writeBuffer(vbuf, 0, mesh.V);
  const ibuf = device.createBuffer({ label: 'buildings-index', size: Math.ceil(mesh.I.byteLength / 4) * 4, usage: BU.INDEX | BU.COPY_DST });
  { const a = new Uint16Array(Math.ceil(mesh.I.length / 2) * 2); a.set(mesh.I); device.queue.writeBuffer(ibuf, 0, a); }
  const shBGL = device.createBindGroupLayout({ label: 'buildings-shadow', entries: [{ binding: 0, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 1, visibility: FR, sampler: { type: 'comparison' } }, { binding: 2, visibility: FR, buffer: { type: 'uniform' } }] });
  const shBG = device.createBindGroup({ label: 'buildings-shadow', layout: shBGL, entries: [{ binding: 0, resource: shadow.view }, { binding: 1, resource: shadow.sampler }, { binding: 2, resource: { buffer: shadow.buffer } }] });
  const dBGL = device.createBindGroupLayout({ label: 'buildings-draw', entries: [0, 1, 2, 3].map((b) => ({ binding: b, visibility: VX, buffer: { type: 'read-only-storage' } })) });
  const gBGL = device.createBindGroupLayout({ label: 'buildings-ground', entries: [{ binding: 0, visibility: CP, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: CP, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: CP, buffer: { type: 'storage' } }, { binding: 3, visibility: CP, buffer: { type: 'uniform' } }, { binding: 4, visibility: CP, buffer: { type: 'storage' } }] });
  const mod = reg.shader('buildings', BUILDINGS_WGSL(frameStruct));
  reg.add('buildings', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, shBGL, dBGL] }),
    vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }] },
    fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const gMod = reg.shader('buildings-ground', GROUND_WGSL);
  reg.add('buildings-ground', { layout: device.createPipelineLayout({ bindGroupLayouts: [terrain.hbgl, gBGL] }), compute: { module: gMod, entryPoint: 'main' } });
  const gpU = device.createBuffer({ label: 'buildings-ground-u', size: 16, usage: BU.UNIFORM | BU.COPY_DST });
  const gpA = new Uint32Array(4);

  const stats = { sets: [], records: 0, bytes: 0, drawn: 0, near: 0, chunks: 0, draws: 0, repicks: 0, ready: false, loadMs: null, errors: 0 };
  const loaded = new Map();   // set id → { D, first }
  let all = [], instBuf = null, idxBuf = null, gBuf = null, yBuf = null, dBG = null, gBG = null, cap = 0, n = 0;
  const kept = [], picked = [], prevKept = [], planes = new Float64Array(20);
  let nNear = 0, prevNear = -1;
  let idxArr = new Uint32Array(0), dirty = true, on = true;
  const t0 = performance.now();
  // the loaded sets as one list (lake first, then south): the GPU's records, the chunks with their records' global offsets
  function rebuild() {
    const order = Object.keys(SETS).filter((id) => loaded.has(id));
    let total = 0; for (const id of order) total += loaded.get(id).D.count;
    const inst = new Uint8Array(total * INST_FLOATS * 4);
    all = [];
    let first = 0;
    for (const id of order) {
      const { D } = loaded.get(id);
      inst.set(instanceArray(D, first), first * INST_FLOATS * 4);
      for (const c of D.chunks) all.push({ ...c, first: c.first + first });
      first += D.count;
    }
    cap = Math.max(1, total);
    instBuf?.destroy(); idxBuf?.destroy(); gBuf?.destroy(); yBuf?.destroy();
    instBuf = device.createBuffer({ label: 'buildings-inst', size: Math.max(64, inst.byteLength), usage: BU.STORAGE | BU.COPY_DST }); device.queue.writeBuffer(instBuf, 0, inst);
    idxBuf = device.createBuffer({ label: 'buildings-idx', size: cap * 4, usage: BU.STORAGE | BU.COPY_DST });
    gBuf = device.createBuffer({ label: 'buildings-ground', size: cap * 8, usage: BU.STORAGE | BU.COPY_SRC });   // COPY_SRC: readGround
    yBuf = device.createBuffer({ label: 'buildings-yard', size: cap * 48, usage: BU.STORAGE });   // the yard's 12 heights a kept box
    idxArr = new Uint32Array(cap);
    dBG = device.createBindGroup({ label: 'buildings-draw', layout: dBGL, entries: [{ binding: 0, resource: { buffer: instBuf } }, { binding: 1, resource: { buffer: idxBuf } }, { binding: 2, resource: { buffer: gBuf } }, { binding: 3, resource: { buffer: yBuf } }] });
    gBG = device.createBindGroup({ label: 'buildings-ground', layout: gBGL, entries: [{ binding: 0, resource: { buffer: instBuf } }, { binding: 1, resource: { buffer: idxBuf } }, { binding: 2, resource: { buffer: gBuf } }, { binding: 3, resource: { buffer: gpU } }, { binding: 4, resource: { buffer: yBuf } }] });
    stats.records = total; stats.sets = order; stats.ready = true; dirty = true; n = 0; nNear = 0;
  }
  const loads = new Map();
  async function fetchSet(id) {
    const r = await fetchImpl(BUILDING_FILES[id].href); if (!r.ok) throw new Error(`buildings: ${r.status} ${id}`);
    const b = new Uint8Array(await r.arrayBuffer()); stats.bytes += b.length;
    // a host (Vite's dev server among them) may send the .gz with Content-Encoding gzip: the browser inflated it already
    return decodeBuildings(b[0] === 0x1f && b[1] === 0x8b ? await inflate(b) : b);
  }
  function load(ids) {
    return Promise.all(ids.filter((id) => SETS[id]).map((id) => {
      if (!loads.has(id)) loads.set(id, fetchSet(id).then((D) => { loaded.set(id, { D }); rebuild(); stats.loadMs = +(performance.now() - t0).toFixed(1); })
        .catch((e) => { stats.errors++; errors.push(`buildings: ${e?.message ?? e}`); }));
      return loads.get(id);
    }));
  }
  return {
    stats, get loaded() { return [...loaded.keys()]; },
    load, prime: (ids) => load(ids),
    setOn(v) { on = !!v; },
    // the records of a set (the tests, the probes): its decoded file
    set(id) { return loaded.get(id)?.D ?? null; },
    update(eye, viewProj) {
      if (!stats.ready || !on) { stats.drawn = 0; stats.draws = 0; return; }
      frustumPlanes(viewProj, planes);
      pickChunks(all, eye, planes, boxInFrustum, picked);
      // the near chunks first (the full mesh), then the far ones (the far mesh): a chunk whose box is within HOUSE.nearM
      kept.length = 0; let nn = 0;
      for (const pass of [0, 1]) for (const j of picked) {
        const b = all[j].box, dx = Math.max(b[0] - eye[0], 0, eye[0] - b[3]), dz = Math.max(b[2] - eye[2], 0, eye[2] - b[5]);
        const near = dx * dx + dz * dz < nearM * nearM;
        if (near === (pass === 0)) { kept.push(j); if (near) nn++; }
      }
      let same = !dirty && kept.length === prevKept.length && nn === prevNear;
      for (let i = 0; same && i < kept.length; i++) same = kept[i] === prevKept[i];
      if (!same) {
        n = 0; nNear = 0;
        kept.forEach((j, t) => { const c = all[j]; for (let i = 0; i < c.count; i++) idxArr[n++] = c.first + i; if (t === nn - 1) nNear = n; });
        if (nn === 0) nNear = 0;
        if (n) device.queue.writeBuffer(idxBuf, 0, idxArr, 0, n);
        prevKept.length = 0; prevKept.push(...kept); prevNear = nn; dirty = false; stats.repicks++;
      }
      stats.drawn = n; stats.near = nNear; stats.chunks = kept.length; stats.draws = (nNear ? 1 : 0) + (n - nNear ? 1 : 0);
    },
    // the grounding of this frame's kept boxes (a compute pass with the terrain's heights)
    run(pass, c) {
      if (!n || !on || !terrain.heightsBindGroup) return;
      gpA[0] = n; device.queue.writeBuffer(gpU, 0, gpA);
      pass.setPipeline(reg.get('buildings-ground')); pass.setBindGroup(0, terrain.heightsBindGroup); pass.setBindGroup(1, gBG);
      pass.dispatchWorkgroups(Math.ceil(n / 64)); c.dispatches++;
    },
    draw(pass, c) {
      if (!n || !on) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, shBG); pass.setBindGroup(3, dBG);
      pass.setPipeline(reg.get('buildings')); pass.setVertexBuffer(0, vbuf); pass.setIndexBuffer(ibuf, 'uint16');
      if (nNear) { pass.drawIndexed(mesh.near, nNear); c.calls++; c.triangles += nNear * mesh.near / 3; }
      if (n > nNear) { pass.drawIndexed(mesh.farCount, n - nNear, mesh.farFirst, 0, nNear); c.calls++; c.triangles += (n - nNear) * mesh.farCount / 3; }
    },
    // the ground the GPU gave the kept boxes (allocates: the page test's, not a frame's): [{ i, base, top }]
    async readGround() {
      if (!n) return [];
      const rb = device.createBuffer({ size: n * 8, usage: BU.MAP_READ | BU.COPY_DST });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(gBuf, 0, rb, 0, n * 8); device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ); const g = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      return Array.from({ length: n }, (_, k) => ({ i: idxArr[k], base: g[2 * k], top: g[2 * k + 1] }));
    },
    // a global record index → its set and decoded record
    rec(i) { for (const id of Object.keys(SETS)) { const L = loaded.get(id); if (!L) continue; if (i < L.D.count) return { set: id, ...L.D.rec(i) }; i -= L.D.count; } return null; },
  };
}
