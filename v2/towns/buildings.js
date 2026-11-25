// The lake's buildings and the south shore's landmarks for v2 (Phase B of the South Lake birthplace): OpenStreetMap's
// footprints (data/geo/tahoe-towns.json, ODbL: each an oriented box with its eaves' and ridge's heights, its kind and, for the
// Stateline high-rises, a facade) packed by tools/v2-buildings-pack.mjs into small gzip files under v2/assets/towns/, one a
// set; the gondola's line, pylons and cabins and the boats in the marina's slips are packed as boxes in the same records.
// Plain JS, no DOM, no GPU: the pack tool, the loader (v2/render/buildings.js) and the node tests share it.
//
// buildings-<set>.vbd (little-endian):
//   bytes 0–15   'VBD1', u32 records, u32 chunks, u32 0
//   per chunk    16 bytes: i16 cx, i16 cz (the 1 km cell: floor(x / 1000), floor(z / 1000)), u32 first record, u16 records,
//                u8 class (CLASS: how far it draws), u8 0, i16 ylo, i16 yhi (m: the ground under it and its tops, for the cull)
//   per record   20 bytes: u16 dx, u16 dz (1/64 m from the cell's corner), u16 len, u16 wid, u16 h (cm), u16 y (dm, + 100 m:
//                an absolute height for the modes that read it), i16 shear (5 cm: the far end's rise over the near end's, a
//                cable span), u8 yaw (2π / 256, about +y from +x toward −z), u8 roof (dm: a gable's height), u8 kind | mode << 4,
//                u8 tint (low nibble the walls' palette index, high the roof's), u8 facade, u8 lit (the share of windows lit at
//                night, × 255)
//   Records run chunk by chunk (the far class first); the loader culls by chunk and draws the kept ones in one instanced draw.
// Heights: a building's eaves stand `h` over its mean ground and its walls go down below its lowest corner (MODE.ground: the
// GPU grounds each box on the terrain it draws, the coarse levels or the south level once in; groundBox is the CPU's twin);
// a pylon's foot is grounded and its head absolute (MODE.foot); a cable span, a cabin or a boat is absolute (MODE.abs).
// Deterministic: the same inputs give the same bytes (the data test demands the shipped ones).

export const MAGIC = 'VBD1';
export const HEADER = 16, CHUNK_BYTES = 16, RECORD = 20, CELL = 1000;
// what a record is: OSM's six building kinds (tools/geo's build_towns: house, low commercial, high-rise, lodge, mid-rise,
// boathouse), then a boat's hull (its bow pinched to a point) and a plain part (a pylon, a cable, a cabin, a mast)
export const KIND = Object.freeze({ house: 0, low: 1, high: 2, lodge: 3, mid: 4, boathouse: 5, hull: 6, part: 7 });
export const MODE = Object.freeze({ ground: 0, abs: 1, foot: 2 });
// how far a chunk draws (m, from the eye to its box): the buildings within 4 km; the landmarks (the high-rises, the gondola)
// to the far range, so a 60 m tower never pops in at 4 km
export const CLASS = Object.freeze({ far: 0, near: 1 });
export const RANGE = Object.freeze({ [CLASS.far]: 16000, [CLASS.near]: 4000 });

// The sets: which records ship in which file, and when a page loads each (the owner's rule: a birthplace outside the bay loads
// its region's detail only when it is picked). lake: the bay's buildings, every big one round the lake (a footprint of
// BIG_M2 or more, the mid- and high-rises) and the gondola; south: the south shore's other buildings and the marina's
// boats, loaded only for a start inside its box (the Ski Run pin and the south shore's coming pins).
export const BIG_M2 = 600;
export const SETS = Object.freeze({
  lake: Object.freeze({ id: 'lake', file: 'buildings-lake.vbd.gz', always: true }),
  south: Object.freeze({ id: 'south', file: 'buildings-south.vbd.gz', box: Object.freeze([6000, 19000, -6000, 4500]) }),
});
export const inBox = (b, x, z) => x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3];
// the sets a start at (x, z) loads (pure)
export function setsFor(x, z) {
  return Object.values(SETS).filter((s) => s.always || (s.box && Number.isFinite(x) && Number.isFinite(z) && inBox(s.box, x, z))).map((s) => s.id);
}

// the palettes (sRGB): v1's earth tones (classic towns: the basin's design standards, dark, matte walls and roofs), the
// high-rises' four facades, and the parts' colours (steel, a white hull, the cable, the cabins, the boats' topsides, a deck)
export const WALLS = Object.freeze([0x5b4634, 0x6e5a44, 0x4a3b2e, 0x7d6e5a, 0x6b6760, 0x55594d, 0x8a7e6a, 0x3f4538, 0x7a6450]);
export const ROOFS = Object.freeze([0x2e2a27, 0x3a2f27, 0x2f3a2f, 0x403f3d, 0x4a3426, 0x262b2c, 0x37403a]);
export const BIG = Object.freeze([0x8b8478, 0x7a776f, 0x9a9182, 0x6d6a62, 0x857a68]);
export const BIG_ROOF = 0x45433f;
export const FACADE = Object.freeze([0, 0x46524f, 0x3b3a35, 0x7a604a, 0xb3a994]);
export const PART = Object.freeze([0x3b3e40, 0xe8e6df, 0x1e2022, 0x9a3b30, 0x1d3557, 0x2f5d50, 0x7a1f1f, 0x8a7458, 0xd8d2c4]);
export const PART_ID = Object.freeze({ steel: 0, white: 1, cable: 2, cabin: 3, navy: 4, green: 5, maroon: 6, teak: 7, canvas: 8 });
const isBig = (k) => k === KIND.low || k === KIND.high || k === KIND.mid;

// v1's index hash (classic towns-layout: the same mix), 0–1
export const hash = (i, s) => {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) ^ Math.imul(s + 0x632be5ab, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// a record's two colours (sRGB 0–255 × 3 each): its walls (or body) and its roof (or deck), with v1's ±15 % shade by index
export function coloursOf(r, i) {
  const pick = (hex, j) => { const k = 0.85 + 0.3 * hash(i, j); return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => Math.min(255, Math.round(v * k))); };
  const wi = r.tint & 15, ri = r.tint >> 4;
  if (r.kind === KIND.hull || r.kind === KIND.part) return { wall: pick(PART[wi % PART.length], 5), roof: pick(PART[ri % PART.length], 6) };
  const wall = r.facade ? FACADE[r.facade] : isBig(r.kind) ? BIG[wi % BIG.length] : WALLS[wi % WALLS.length];
  return { wall: pick(wall, 5), roof: pick(isBig(r.kind) ? BIG_ROOF : ROOFS[ri % ROOFS.length], 6) };
}

// ---- the file ----
const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
// records [{ x, z, len, wid, h, y, shear, yaw, roof, kind, mode, tint, facade, lit, cls }] → the file's bytes: sorted by class,
// then cell (z row, then x), then input order (stable)
export function encodeBuildings(records, groundAt = null) {
  const keyed = records.map((r, i) => ({ r, i, cx: Math.floor(r.x / CELL), cz: Math.floor(r.z / CELL), cls: r.cls ?? CLASS.near }));
  keyed.sort((a, b) => a.cls - b.cls || a.cz - b.cz || a.cx - b.cx || a.i - b.i);
  const chunks = [];
  for (const k of keyed) {
    let c = chunks[chunks.length - 1];
    if (!c || c.cx !== k.cx || c.cz !== k.cz || c.cls !== k.cls || c.count >= 65535) { c = { cx: k.cx, cz: k.cz, cls: k.cls, first: chunks.reduce((s, q) => s + q.count, 0), count: 0, ylo: Infinity, yhi: -Infinity }; chunks.push(c); }
    c.count++;
    const r = k.r, g = groundAt ? groundAt(r.x, r.z) : 0;
    const lo = r.mode === MODE.abs ? r.y - Math.abs(r.shear ?? 0) / 2 : Math.min(g, r.mode === MODE.foot ? r.y : g) - 8;
    const hi = r.mode === MODE.ground ? g + r.h + (r.roof ?? 0) + 6 : (r.y ?? 0) + r.h + Math.abs(r.shear ?? 0) / 2 + 1;
    c.ylo = Math.min(c.ylo, lo); c.yhi = Math.max(c.yhi, hi);
  }
  const n = keyed.length, buf = new ArrayBuffer(HEADER + chunks.length * CHUNK_BYTES + n * RECORD), dv = new DataView(buf), u8 = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) u8[i] = MAGIC.charCodeAt(i);
  dv.setUint32(4, n, true); dv.setUint32(8, chunks.length, true);
  chunks.forEach((c, j) => {
    const o = HEADER + j * CHUNK_BYTES;
    dv.setInt16(o, c.cx, true); dv.setInt16(o + 2, c.cz, true); dv.setUint32(o + 4, c.first, true); dv.setUint16(o + 8, c.count, true);
    u8[o + 10] = c.cls; dv.setInt16(o + 12, clampI(Math.floor(c.ylo), -32768, 32767), true); dv.setInt16(o + 14, clampI(Math.ceil(c.yhi), -32768, 32767), true);
  });
  const base = HEADER + chunks.length * CHUNK_BYTES;
  keyed.forEach((k, i) => {
    const r = k.r, o = base + i * RECORD;
    dv.setUint16(o, clampI((r.x - k.cx * CELL) * 64, 0, 65535), true); dv.setUint16(o + 2, clampI((r.z - k.cz * CELL) * 64, 0, 65535), true);
    dv.setUint16(o + 4, clampI(r.len * 100, 1, 65535), true); dv.setUint16(o + 6, clampI(r.wid * 100, 1, 65535), true); dv.setUint16(o + 8, clampI(r.h * 100, 1, 65535), true);
    dv.setUint16(o + 10, clampI(((r.y ?? 0) + 100) * 10, 0, 65535), true); dv.setInt16(o + 12, clampI((r.shear ?? 0) * 20, -32768, 32767), true);
    u8[o + 14] = clampI((((r.yaw ?? 0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) * 256, 0, 256) & 255;
    u8[o + 15] = clampI((r.roof ?? 0) * 10, 0, 255); u8[o + 16] = (r.kind & 15) | ((r.mode ?? 0) << 4); u8[o + 17] = r.tint & 255;
    u8[o + 18] = r.facade ?? 0; u8[o + 19] = clampI((r.lit ?? 0) * 255, 0, 255);
  });
  return new Uint8Array(buf);
}

// the file's bytes → { count, chunks: [{ cx, cz, first, count, cls, box: [x0, y0, z0, x1, y1, z1] }], rec(i) → a record }
export function decodeBuildings(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== MAGIC) throw new Error('buildings: not a VBD1 file');
  const n = dv.getUint32(4, true), nc = dv.getUint32(8, true), base = HEADER + nc * CHUNK_BYTES;
  if (bytes.byteLength < base + n * RECORD) throw new Error('buildings: short file');
  const chunks = [];
  for (let j = 0; j < nc; j++) {
    const o = HEADER + j * CHUNK_BYTES, cx = dv.getInt16(o, true), cz = dv.getInt16(o + 2, true);
    chunks.push({ cx, cz, first: dv.getUint32(o + 4, true), count: dv.getUint16(o + 8, true), cls: bytes[o + 10], box: [cx * CELL, dv.getInt16(o + 12, true), cz * CELL, (cx + 1) * CELL, dv.getInt16(o + 14, true), (cz + 1) * CELL] });
  }
  // a chunk's box reaches over its cell by its widest record (a 230 m block at the cell's edge)
  for (const c of chunks) { let m = 0; for (let i = c.first; i < c.first + c.count; i++) { const o = base + i * RECORD; m = Math.max(m, Math.hypot(dv.getUint16(o + 4, true), dv.getUint16(o + 6, true)) / 200); } c.box[0] -= m; c.box[2] -= m; c.box[3] += m; c.box[5] += m; }
  const cellOf = new Int32Array(n); chunks.forEach((c, j) => cellOf.fill(j, c.first, c.first + c.count));
  function rec(i) {
    const o = base + i * RECORD, c = chunks[cellOf[i]], km = bytes[o + 16];
    return { x: c.cx * CELL + dv.getUint16(o, true) / 64, z: c.cz * CELL + dv.getUint16(o + 2, true) / 64, len: dv.getUint16(o + 4, true) / 100, wid: dv.getUint16(o + 6, true) / 100,
      h: dv.getUint16(o + 8, true) / 100, y: dv.getUint16(o + 10, true) / 10 - 100, shear: dv.getInt16(o + 12, true) / 20, yaw: bytes[o + 14] / 256 * 2 * Math.PI,
      roof: bytes[o + 15] / 10, kind: km & 15, mode: km >> 4, tint: bytes[o + 17], facade: bytes[o + 18], lit: bytes[o + 19] / 255, cls: c.cls };
  }
  return { count: n, chunks, rec };
}

// ---- the GPU's records: 64 bytes an instance (vec4f a: x, y, z, yaw; b: len, wid, h, roof; c: shear, kind | mode << 4 |
// facade << 8, lit, 0; vec4u d: the walls' sRGB, the roof's sRGB, 0, 0). first: the index of the set's first record in the
// page's whole list (the colours' hash runs on it, so a set draws the same wherever it lands)
export const INST_FLOATS = 16;
export function instanceArray(D, first = 0) {
  const out = new ArrayBuffer(D.count * INST_FLOATS * 4), f = new Float32Array(out), u = new Uint32Array(out);
  for (let i = 0; i < D.count; i++) {
    const r = D.rec(i), o = i * INST_FLOATS, { wall, roof } = coloursOf(r, first + i);
    f[o] = r.x; f[o + 1] = r.y; f[o + 2] = r.z; f[o + 3] = r.yaw;
    f[o + 4] = r.len; f[o + 5] = r.wid; f[o + 6] = r.h; f[o + 7] = r.roof;
    f[o + 8] = r.shear; f[o + 9] = r.kind | (r.mode << 4) | (r.facade << 8); f[o + 10] = r.lit; f[o + 11] = 0;
    u[o + 12] = wall[0] | (wall[1] << 8) | (wall[2] << 16); u[o + 13] = roof[0] | (roof[1] << 8) | (roof[2] << 16);
  }
  return new Uint8Array(out);
}

// ---- the grounding (the GPU's compute pass is its twin, render/buildings.js GROUND_WGSL): a box's foot and eaves on the
// terrain under its four corners and its middle (v1's rule: the walls from below the low corner, at most 6 m under the mean,
// to `h` over the mean, up to 4 m more on the uphill side). → [base, top] (m above the lake)
export const GROUND = Object.freeze({ sinkMax: 6, under: 0.5, uphill: 4, uphillFree: 3, footSink: 1 });
export function groundBox(heightAt, r) {
  if (r.mode === MODE.abs) return [r.y, r.y + r.h];
  const ca = Math.cos(r.yaw), sa = Math.sin(r.yaw), hl = r.len / 2, hw = r.wid / 2;
  if (r.mode === MODE.foot) return [heightAt(r.x, r.z) - GROUND.footSink, r.y];
  let y0 = Infinity, y1 = -Infinity, ym = 0;
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const y = heightAt(r.x + u * hl * ca + v * hw * sa, r.z - u * hl * sa + v * hw * ca);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y); ym += y / 4;
  }
  const base = Math.max(y0, ym - GROUND.sinkMax) - GROUND.under;
  return [base, ym + r.h + Math.min(GROUND.uphill, Math.max(0, y1 - GROUND.uphillFree - ym))];
}

// ---- the cull: the chunks within their class's range of the eye and in the frustum (planes null: range only) → the kept
// chunks' indices into out (allocation-free); returns their records' count
export function pickChunks(chunks, eye, planes, boxIn, out, range = RANGE) {
  out.length = 0; let n = 0;
  for (let j = 0; j < chunks.length; j++) {
    const c = chunks[j], b = c.box;
    const dx = Math.max(b[0] - eye[0], 0, eye[0] - b[3]), dz = Math.max(b[2] - eye[2], 0, eye[2] - b[5]);
    if (dx * dx + dz * dz >= range[c.cls] * range[c.cls]) continue;
    if (planes && !boxIn(planes, b[0], b[1], b[2], b[3], b[4], b[5])) continue;
    out.push(j); n += c.count;
  }
  return n;
}
