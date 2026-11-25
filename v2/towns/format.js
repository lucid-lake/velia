// The towns' data for v2 (10a, trimmed by the owner 2026-11-13 to what Sail sees from Emerald Bay: the piers and
// breakwaters, the Hwy 89 cut and the ski runs). v1's own layout (src/towns-layout.js, src/shoreline-layout.js,
// src/harbour.js on OpenStreetMap's lines: data/geo/tahoe-towns.json, ODbL) packed by tools/v2-towns-pack.mjs into two
// gzip files under v2/assets/towns/. Plain JS, no DOM: the pack tool, the loader (v2/render/towns.js) and the node tests
// share it.
//
// mask.vtm (the ground's paint and the forest's keep-out; the GPU reads the inflated bytes as one storage buffer):
//   words 0–3   'VTM1', u32 rasters (≤ 4), u32 bytes (the whole file), 0
//   per raster  16 words at 4 + 16 r: f32 x0, f32 z0 (the corner, world m), f32 cell (m), u32 w, u32 h, u32 ch (bytes a
//               texel), u32 levels (≤ 8), u32 kind (RASTER), then u32 × 8: each level's byte offset in the file
//   then        the levels' bytes: level l is ⌈w / 2^l⌉ × ⌈h / 2^l⌉ texels of ch bytes, row-major from the corner, each a
//               2 × 2 mean of the level under it; a texel's centre sits at x0 + (i + 0.5) · cell · 2^l (v1's sampler)
//   Raster kinds: FINE (v1's L.fine, 2.5 m over Emerald Bay's walls: byte 0 Hwy 89's asphalt, byte 1 the cut's scar) and
//   SKI (v1's L.mask channel G, 25 m: the runs and the lift lines), each cropped to its marked cells.
//
// shore.vsh (the piers, the boathouses, the light tower, the harbour, the breakwaters):
//   words 0–3   'VSH1', u32 meshes, u32 instances, 0
//   per mesh    16 words: u32 verts, u32 indices, u32 first instance, u32 instances, u32 flags, 0, 0, 0, f32 × 3 the
//               vertices' box min, f32 × 3 its max, 0, 0
//   per mesh    its planes: u16 × 3 × verts (positions over the box), i8 × 4 × verts (normal), u8 × 4 × verts (sRGB
//               colour, alpha the vertex's roughness × 255: 255 when the mesh has none), u16 × indices (0: a plain
//               triangle list); each plane padded to 4 bytes
//   instances   f32 × 12 each (a 3 × 4 affine, column-major: the x, y, z axes, then the origin), then u8 × 4 each (sRGB
//               tint, then the material byte: matByte, v1's roughness and metalness; 0 = the vertices' roughness); the
//               pilings' feet and the breakwaters' toes already reach the bed (the pack reads v1's heights)
//   Instances run mesh by mesh, each mesh's sorted by its 1 km chunk (the loader's culling cells).
// Deterministic: v1's layouts hash indices only; the same inputs give the same bytes (the test demands the shipped ones).

export const MASK_MAGIC = 'VTM1', SHORE_MAGIC = 'VSH1';
export const RASTER = Object.freeze({ FINE: 0, SKI: 1 });
export const MESH = Object.freeze({ box: 0, pile: 1, roof: 2, tower: 3, harbour: 4, rock: 5 });
export const CHUNK = 1000;   // m: the loader's culling cells
// v1's keep-out thresholds (src/towns-layout.js makeQueries keepOut) and the ski runs' thinning (treeDensity)
// reach: v2's own (its cards draw a crown 1.35 × the lidar's radius): the road and the cut are tested out to 1.1 × r
export const KEEP = Object.freeze({ ski: 0.6, road: 0.3, cut: 0.3, thinA: 0.3, thinB: 0.6, thinShare: 0.55, reach: 1.1 });

const pad4 = (n) => (n + 3) & ~3;

// #41b: an instance's material in one byte (v1's MeshStandardMaterial: roughness, metalness 0 or 0.1): bits 0–6 the
// roughness × 100, bit 7 metalness 0.1 (v1's towns' decks, src/towns.js propMat); 0 leaves it to the mesh's vertices
export const matByte = (rough, metal = 0) => Math.min(100, Math.max(1, Math.round(rough * 100))) | (metal > 0 ? 128 : 0);
export const matOf = (b) => ({ rough: (b & 127) / 100, metal: b & 128 ? 0.1 : 0 });

// ---- the mask ----
// a raster { x0, z0, cell, w, h, ch, data: Uint8Array (w·h·ch) } → its 2 × 2 mean pyramid (≥ 1 level, ≤ 8)
export function pyramid(r, maxLevels = 8) {
  const out = [{ w: r.w, h: r.h, data: r.data }];
  while (out.length < maxLevels) {
    const p = out[out.length - 1];
    if (p.w <= 16 && p.h <= 16) break;
    const w = Math.ceil(p.w / 2), h = Math.ceil(p.h / 2), d = new Uint8Array(w * h * r.ch);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < r.ch; c++) {
      let s = 0;
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const x = 2 * i + a, y = 2 * j + b; if (x < p.w && y < p.h) s += p.data[(y * p.w + x) * r.ch + c]; }
      d[(j * w + i) * r.ch + c] = Math.round(s / 4);
    }
    out.push({ w, h, data: d });
  }
  return out;
}

// rasters [{ kind, x0, z0, cell, w, h, ch, data }] → the file's bytes (uncompressed)
export function encodeMask(rasters) {
  if (rasters.length > 4) throw new Error('towns mask: at most 4 rasters');
  const pyr = rasters.map((r) => pyramid(r));
  let off = 16 + 64 * rasters.length;
  const offs = pyr.map((levels, k) => levels.map((l) => { const o = off; off = pad4(off + l.w * l.h * rasters[k].ch); return o; }));
  const out = new Uint8Array(off), dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = MASK_MAGIC.charCodeAt(i);
  dv.setUint32(4, rasters.length, true); dv.setUint32(8, off, true);
  rasters.forEach((r, k) => {
    const o = 16 + 64 * k;
    dv.setFloat32(o, r.x0, true); dv.setFloat32(o + 4, r.z0, true); dv.setFloat32(o + 8, r.cell, true);
    dv.setUint32(o + 12, r.w, true); dv.setUint32(o + 16, r.h, true); dv.setUint32(o + 20, r.ch, true);
    dv.setUint32(o + 24, pyr[k].length, true); dv.setUint32(o + 28, r.kind, true);
    pyr[k].forEach((l, i) => { dv.setUint32(o + 32 + 4 * i, offs[k][i], true); out.set(l.data, offs[k][i]); });
  });
  return out;
}

export function decodeMask(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== MASK_MAGIC) throw new Error(`towns mask: bad magic ${magic}`);
  const n = dv.getUint32(4, true), rasters = [];
  for (let k = 0; k < n; k++) {
    const o = 16 + 64 * k, levels = dv.getUint32(o + 24, true);
    rasters.push({ x0: dv.getFloat32(o, true), z0: dv.getFloat32(o + 4, true), cell: dv.getFloat32(o + 8, true), w: dv.getUint32(o + 12, true), h: dv.getUint32(o + 16, true),
      ch: dv.getUint32(o + 20, true), levels, kind: dv.getUint32(o + 28, true), offs: Array.from({ length: levels }, (_, i) => dv.getUint32(o + 32 + 4 * i, true)) });
  }
  return { bytes, rasters, size: dv.getUint32(8, true) };
}

// the JS twin of the WGSL reader (towns/wgsl.js twSample): raster r's channel c at (x, z), level l, bilinear on the
// texel centres, 0 outside (v1's sampler)
export function sampleRaster(M, r, x, z, c, l = 0) {
  const R = M.rasters[r], s = 2 ** l, cell = R.cell * s, w = Math.ceil(R.w / s), h = Math.ceil(R.h / s), base = R.offs[l], b = M.bytes;
  const fx = (x - R.x0) / cell - 0.5, fz = (z - R.z0) / cell - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const at = (a, q) => (a < 0 || q < 0 || a >= w || q >= h) ? 0 : b[base + (q * w + a) * R.ch + c];
  return ((at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v) / 255;
}
// the ground's marks at (x, z) at level 0: { road, cut, ski }
export function maskAt(M, x, z) {
  const o = { road: 0, cut: 0, ski: 0 };
  M.rasters.forEach((R, k) => {
    if (R.kind === RASTER.FINE) { o.road = Math.max(o.road, sampleRaster(M, k, x, z, 0)); o.cut = Math.max(o.cut, sampleRaster(M, k, x, z, 1)); }
    else if (R.kind === RASTER.SKI) o.ski = Math.max(o.ski, sampleRaster(M, k, x, z, 0));
  });
  return o;
}
// v1's keep-out (src/towns-layout.js makeQueries keepOut, without the footprints: v2 has no buildings yet)
export function keepOut(M, x, z) { const m = maskAt(M, x, z); return m.ski > KEEP.ski || m.road > KEEP.road || m.cut > KEEP.cut; }
// v1's treeDensity on the runs (the towns' thinning of built ground waits for the buildings)
export function keepOutR(M, x, z, r) {
  if (keepOut(M, x, z)) return true;
  for (let k = 0; k < 4; k++) { const a = k * 1.5707963, d = r * KEEP.reach, m = maskAt(M, x + Math.cos(a) * d, z + Math.sin(a) * d); if (m.road > KEEP.road || m.cut > KEEP.cut) return true; }
  return false;
}

// ---- the shore meshes ----
// meshes [{ pos: Float32Array, nrm: Float32Array, col: Uint8Array (sRGB rgb per vertex, or null: white), alpha: Uint8Array|null
// (roughness × 255 per vertex), idx: Uint32Array|null, flags }], instances per mesh [{ m: number[12], tint: [r, g, b] (sRGB
// bytes), flags (matByte) }] → the file's bytes
export function encodeShore(meshes, insts) {
  let nInst = 0; for (const l of insts) nInst += l.length;
  const parts = meshes.map((m) => {
    const n = m.pos.length / 3, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.pos[3 * i + c]); hi[c] = Math.max(hi[c], m.pos[3 * i + c]); }
    const P = new Uint16Array(n * 3);
    for (let i = 0; i < n * 3; i++) { const c = i % 3, span = hi[c] - lo[c] || 1; P[i] = Math.round((m.pos[i] - lo[c]) / span * 65535); }
    const N = new Int8Array(n * 4);
    for (let i = 0; i < n; i++) { const x = m.nrm[3 * i], y = m.nrm[3 * i + 1], z = m.nrm[3 * i + 2], l = Math.hypot(x, y, z) || 1; N[4 * i] = Math.round(x / l * 127); N[4 * i + 1] = Math.round(y / l * 127); N[4 * i + 2] = Math.round(z / l * 127); }
    const C = new Uint8Array(n * 4).fill(255);
    if (m.col) for (let i = 0; i < n; i++) { C[4 * i] = m.col[3 * i]; C[4 * i + 1] = m.col[3 * i + 1]; C[4 * i + 2] = m.col[3 * i + 2]; }
    if (m.alpha) for (let i = 0; i < n; i++) C[4 * i + 3] = m.alpha[i];   // #41b: the vertex's roughness
    const I = m.idx ? Uint16Array.from(m.idx) : new Uint16Array(0);
    if (m.idx && n > 65535) throw new Error('towns shore: an indexed mesh over 65,535 vertices');
    return { n, lo, hi, P, N, C, I, flags: m.flags ?? 0 };
  });
  let size = 16 + 64 * meshes.length;
  for (const p of parts) size += pad4(p.P.byteLength) + p.N.byteLength + p.C.byteLength + pad4(p.I.byteLength);
  size += nInst * 52;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = SHORE_MAGIC.charCodeAt(i);
  dv.setUint32(4, meshes.length, true); dv.setUint32(8, nInst, true);
  let o = 16 + 64 * meshes.length, first = 0;
  parts.forEach((p, k) => {
    const h = 16 + 64 * k;
    dv.setUint32(h, p.n, true); dv.setUint32(h + 4, p.I.length, true); dv.setUint32(h + 8, first, true); dv.setUint32(h + 12, insts[k].length, true); dv.setUint32(h + 16, p.flags, true);
    for (let c = 0; c < 3; c++) { dv.setFloat32(h + 32 + 4 * c, p.lo[c], true); dv.setFloat32(h + 44 + 4 * c, p.hi[c], true); }
    first += insts[k].length;
    out.set(new Uint8Array(p.P.buffer), o); o += pad4(p.P.byteLength);
    out.set(new Uint8Array(p.N.buffer), o); o += p.N.byteLength;
    out.set(p.C, o); o += p.C.byteLength;
    out.set(new Uint8Array(p.I.buffer), o); o += pad4(p.I.byteLength);
  });
  // instances: the matrices as one plane, the tints as another (the gzip likes planes)
  const all = insts.flat();
  all.forEach((it, i) => { for (let c = 0; c < 12; c++) dv.setFloat32(o + (i * 12 + c) * 4, it.m[c], true); });
  o += nInst * 48;
  all.forEach((it, i) => { out[o + 4 * i] = it.tint[0]; out[o + 4 * i + 1] = it.tint[1]; out[o + 4 * i + 2] = it.tint[2]; out[o + 4 * i + 3] = it.flags ?? 0; });
  return out;
}

// → { meshes: [{ verts, pos: Float32Array (xyz), nrm: Int8Array (4/vertex), col: Uint8Array (4/vertex), idx: Uint16Array|null,
// first, count, flags }], instances, mats: Float32Array (12/instance), tints: Uint8Array (4/instance) }
export function decodeShore(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== SHORE_MAGIC) throw new Error(`towns shore: bad magic ${magic}`);
  const nm = dv.getUint32(4, true), ni = dv.getUint32(8, true), meshes = [];
  let o = 16 + 64 * nm;
  const slice = (Ctor, at, n) => { const a = new Ctor(n); new Uint8Array(a.buffer).set(bytes.subarray(at, at + n * Ctor.BYTES_PER_ELEMENT)); return a; };
  for (let k = 0; k < nm; k++) {
    const h = 16 + 64 * k, n = dv.getUint32(h, true), ni_ = dv.getUint32(h + 4, true);
    const lo = [0, 1, 2].map((c) => dv.getFloat32(h + 32 + 4 * c, true)), hi = [0, 1, 2].map((c) => dv.getFloat32(h + 44 + 4 * c, true));
    const P = slice(Uint16Array, o, n * 3); o += pad4(n * 6);
    const N = slice(Int8Array, o, n * 4); o += n * 4;
    const C = slice(Uint8Array, o, n * 4); o += n * 4;
    const I = ni_ ? slice(Uint16Array, o, ni_) : null; o += pad4(ni_ * 2);
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) { const c = i % 3; pos[i] = lo[c] + P[i] / 65535 * (hi[c] - lo[c]); }
    meshes.push({ verts: n, pos, nrm: N, col: C, idx: I, first: dv.getUint32(h + 8, true), count: dv.getUint32(h + 12, true), flags: dv.getUint32(h + 16, true), lo, hi });
  }
  const mats = slice(Float32Array, o, ni * 12); o += ni * 48;
  const tints = slice(Uint8Array, o, ni * 4);
  return { meshes, instances: ni, mats, tints };
}

// ---- the phone's set (owner 2026-11-17: "drop ski runs and the far towns' detail" on a phone) ----
// Emerald Bay and its mouth: v1's shoreline region (src/shoreline-layout.js SHORE_REGION), where Sail starts and the bay's
// piers, boathouses, tower and harbour stand; the phone's shore keeps the instances whose origin is inside it
export const BAY = Object.freeze({ x0: -1300, x1: 6000, z0: -2400, z1: 2400 });
export const inBay = (x, z) => x > BAY.x0 && x < BAY.x1 && z > BAY.z0 && z < BAY.z1;
// a shore file's bytes → the same file with only the instances keep(x, z, mesh) passes (the meshes' planes byte for byte; each
// mesh's first and count re-written; the order kept, so each mesh's chunks stay sorted)
export function filterShore(bytes, keep = inBay) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nm = dv.getUint32(4, true), ni = dv.getUint32(8, true);
  let o = 16 + 64 * nm;
  for (let k = 0; k < nm; k++) { const h = 16 + 64 * k, n = dv.getUint32(h, true), nIdx = dv.getUint32(h + 4, true); o += pad4(n * 6) + n * 8 + pad4(nIdx * 2); }
  const matsAt = o, tintsAt = o + ni * 48, kept = [], per = [];
  for (let k = 0; k < nm; k++) {
    const h = 16 + 64 * k, first = dv.getUint32(h + 8, true), count = dv.getUint32(h + 12, true); let c = 0;
    for (let i = first; i < first + count; i++) if (keep(dv.getFloat32(matsAt + (i * 12 + 9) * 4, true), dv.getFloat32(matsAt + (i * 12 + 11) * 4, true), k)) { kept.push(i); c++; }
    per.push(c);
  }
  const out = new Uint8Array(matsAt + kept.length * 52), ov = new DataView(out.buffer);
  out.set(bytes.subarray(0, matsAt));
  ov.setUint32(8, kept.length, true);
  let first = 0;
  for (let k = 0; k < nm; k++) { const h = 16 + 64 * k; ov.setUint32(h + 8, first, true); ov.setUint32(h + 12, per[k], true); first += per[k]; }
  kept.forEach((i, j) => {
    out.set(bytes.subarray(matsAt + i * 48, matsAt + i * 48 + 48), matsAt + j * 48);
    out.set(bytes.subarray(tintsAt + i * 4, tintsAt + i * 4 + 4), matsAt + kept.length * 48 + j * 4);
  });
  return out;
}
// a mask file's bytes → a mask of only the rasters whose kind is in kinds (re-encoded from their level 0: the same pyramid)
export function filterMask(bytes, kinds = [RASTER.FINE]) {
  const M = decodeMask(bytes);
  return encodeMask(M.rasters.filter((r) => kinds.includes(r.kind)).map((r) => ({ kind: r.kind, x0: r.x0, z0: r.z0, cell: r.cell, w: r.w, h: r.h, ch: r.ch,
    data: bytes.slice(r.offs[0], r.offs[0] + r.w * r.h * r.ch) })));
}

// ---- the south shore's piers: their own file, loaded only on a south start (the owner's rule: a birthplace outside the bay
// loads its region's detail only when it is picked) ----
// shore-south.vsh is a shore file of two meshes (MESH.box, MESH.pile: the same unit shapes) whose instances every pier,
// breakwater and dock of OpenStreetMap inside `area` (world m: x 7,000 to 14,500, z -1,500 to 3,000) needs, on pilings that reach
// the south level's bed (tools/v2-towns-pack.mjs). The shared shore file holds none of them. `box` is the start's trigger,
// the buildings' south box (v2/towns/buildings.js SETS.south): a start or a move inside it loads the file.
export const SHORE_SETS = Object.freeze({
  south: Object.freeze({ id: 'south', file: 'shore-south.vsh.gz', box: Object.freeze([6000, 19000, -6000, 4500]), area: Object.freeze([7000, 14500, -1500, 3000]) }),
});
export const inArea = (a, x, z) => x >= a[0] && x <= a[1] && z >= a[2] && z <= a[3];
// the extra shore files a start at (x, z) loads (pure)
export function shoreSetsFor(x, z) {
  return Object.values(SHORE_SETS).filter((s) => Number.isFinite(x) && Number.isFinite(z) && inArea(s.box, x, z)).map((s) => s.id);
}
// a decoded shore plus decoded extra shores (their meshes' instances appended to the same-index mesh of the base, each mesh's
// instances re-sorted by 1 km chunk, stable) → a decoded shore (the base's meshes; no copy of the extras' geometry)
export function mergeShore(base, extras) {
  const chunkKey = (m, i) => Math.floor(m[i * 12 + 11] / CHUNK) * 100000 + Math.floor(m[i * 12 + 9] / CHUNK);
  const per = base.meshes.map((m, k) => {
    const list = [];
    const take = (S, mesh) => { for (let i = mesh.first; i < mesh.first + mesh.count; i++) list.push({ m: S.mats.subarray(i * 12, i * 12 + 12), t: S.tints.subarray(i * 4, i * 4 + 4), key: chunkKey(S.mats, i) }); };
    take(base, m);
    for (const S of extras) if (S.meshes[k]) take(S, S.meshes[k]);
    list.forEach((it, i) => { it.i = i; });
    list.sort((a, b) => a.key - b.key || a.i - b.i);
    return list;
  });
  const n = per.reduce((s, l) => s + l.length, 0), mats = new Float32Array(n * 12), tints = new Uint8Array(n * 4);
  let first = 0;
  const meshes = base.meshes.map((m, k) => {
    per[k].forEach((it, j) => { mats.set(it.m, (first + j) * 12); tints.set(it.t, (first + j) * 4); });
    const out = { ...m, first, count: per[k].length }; first += per[k].length; return out;
  });
  return { meshes, instances: n, mats, tints };
}
