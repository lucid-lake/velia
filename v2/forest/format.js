// The forest's data file (M5b): the lidar's real crowns round Emerald Bay, as v1 places them (src/trees-scatter.js, its
// lidar branch over USGS 3DEP CA_SierraNevada_5_2022 first returns: terrain/forest/treetops.tps), re-packed for v2 by
// tools/v2-forest-pack.mjs. Plain JS, no DOM: the forest worker, the pack tool and the node tests share it.
//
// One file per kind (trees, shrubs), each gzip of:
//   header 32 B  'VFT1', u32 n, f32 x0, f32 z0 (the box's corner, world m), f32 tile (m), u16 tw, u16 th, u8 kind
//                (0 trees, 1 shrubs), u8 hq (the height quantum, cm), u16 0, u32 0, u32 0
//   counts       u16 × tw·th: the records per tile (row-major, tiles from the corner east then south)
//   planes       n bytes each: keyHi, keyLo (the record's key in its tile, z·256 + x on a 0.25 m lattice, sorted and
//                delta-coded from 0 within the tile), h (× hq cm); trees also r (crown radius, 0.1 m) and layer (LAYERS)
// Sorted keys and planes (not records) are what make the gzip small: 119 k trees ≈ 0.35 MB, 587 k shrubs ≈ 1.1 MB, from
// v1's 5.65 MB (3.2 MB gzip) of 8-byte records at 0.1 m.
//
//   const f = decodeForest(inflatedBytes)   → { kind, n, x0, z0, tile, tw, th, start (Uint32Array tw·th + 1),
//                                              inst (Uint32Array n × 4: the GPU's records), stats }
// The GPU record (16 B): f32 x, f32 z, f32 y (the ground: the place pass writes it), u32 packed: h (0.1 m, bits 0–9),
// r (0.1 m, bits 10–17), layer (bits 18–21), kind (bit 22: 1 a shrub), valid (bit 23: the place pass clears it on water).

export const MAGIC = 'VFT1';
export const QUANT = 0.25;   // m: the position lattice in a tile (256 steps over 64 m)
export const TILE = 64;      // m
// the atlas layers (render/forest.js bakes one tree per layer)
export const LAYERS = Object.freeze({ pine: 0, lodgepole: 1, whitefir: 2, redfir: 3, cedar: 4, snag: 5, shrub: 6 });
export const N_LAYERS = 7;
// v1's species (src/forest/species.js SPECIES order: jeffrey, whitefir, redfir, cedar, lodgepole, sugar, hemlock, snag,
// manzanita) → a layer
export const LAYER_OF_V1 = Object.freeze([0, 2, 3, 4, 1, 0, 3, 5, 6]);
// the box: v1's (src/forest/treetops.js TOPS.box), on the 64 m tile grid
export const BOX = Object.freeze({ x0: -2304, z0: -1792, x1: 3328, z1: 1792 });

export const packBits = (hM, rM, layer, shrub) => (Math.min(1023, Math.round(hM * 10)) | (Math.min(255, Math.round(rM * 10)) << 10) | ((layer & 15) << 18) | ((shrub ? 1 : 0) << 22) | (1 << 23)) >>> 0;
export const unpackBits = (p) => ({ h: (p & 1023) / 10, r: ((p >>> 10) & 255) / 10, layer: (p >>> 18) & 15, shrub: (p >>> 22) & 1, valid: (p >>> 23) & 1 });

// records: [{ x, z, h, r, layer }] (world m) → the uncompressed file bytes (the tool gzips them)
export function encodeForest(records, { kind = 0, box = BOX, tile = TILE, hq = kind ? 10 : 25 } = {}) {
  const tw = Math.round((box.x1 - box.x0) / tile), th = Math.round((box.z1 - box.z0) / tile), steps = tile / QUANT;
  const byTile = Array.from({ length: tw * th }, () => []);
  for (const r of records) {
    const fx = (r.x - box.x0) / tile, fz = (r.z - box.z0) / tile;
    const ti = Math.min(tw - 1, Math.max(0, Math.floor(fx))), tj = Math.min(th - 1, Math.max(0, Math.floor(fz)));
    const qx = Math.min(steps - 1, Math.max(0, Math.round((r.x - box.x0 - ti * tile) / QUANT - 0.5)));
    const qz = Math.min(steps - 1, Math.max(0, Math.round((r.z - box.z0 - tj * tile) / QUANT - 0.5)));
    byTile[tj * tw + ti].push({ key: qz * steps + qx, h: Math.min(255, Math.max(1, Math.round(r.h * 100 / hq))), r: Math.min(255, Math.max(1, Math.round((r.r ?? 0) * 10))), layer: r.layer ?? 0 });
  }
  const recs = [];
  for (const t of byTile) {
    t.sort((a, b) => a.key - b.key || a.h - b.h);
    // two crowns on one lattice point: the second moves to the next free key (the order stays strictly increasing)
    for (let i = 1; i < t.length; i++) if (t[i].key <= t[i - 1].key) t[i].key = t[i - 1].key + 1;
    for (const r of t) if (r.key >= steps * steps) throw new Error('forest: a tile overflowed its lattice');
    recs.push(...t);
  }
  const n = recs.length, planes = kind ? 3 : 5;
  const head = 32, out = new Uint8Array(head + tw * th * 2 + n * planes), dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = MAGIC.charCodeAt(i);
  dv.setUint32(4, n, true); dv.setFloat32(8, box.x0, true); dv.setFloat32(12, box.z0, true); dv.setFloat32(16, tile, true);
  dv.setUint16(20, tw, true); dv.setUint16(22, th, true); out[24] = kind; out[25] = hq;
  byTile.forEach((t, k) => { if (t.length > 65535) throw new Error('forest: a tile holds over 65,535 records'); dv.setUint16(head + 2 * k, t.length, true); });
  let o = head + tw * th * 2, q = 0;
  for (const t of byTile) {
    let prev = 0;
    for (const r of t) { const d = r.key - prev; prev = r.key; out[o + q] = d >> 8; out[o + n + q] = d & 255; out[o + 2 * n + q] = r.h; if (!kind) { out[o + 3 * n + q] = r.r; out[o + 4 * n + q] = r.layer; } q++; }
  }
  return out;
}

// the file's bytes (inflated) → the tile ranges and the GPU records
export function decodeForest(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== MAGIC) throw new Error('forest: bad magic');
  const n = dv.getUint32(4, true), x0 = dv.getFloat32(8, true), z0 = dv.getFloat32(12, true), tile = dv.getFloat32(16, true);
  const tw = dv.getUint16(20, true), th = dv.getUint16(22, true), kind = u8[24], hq = u8[25], planes = kind ? 3 : 5;
  const head = 32, nt = tw * th;
  if (u8.length < head + nt * 2 + n * planes) throw new Error(`forest: ${u8.length} bytes for ${n} records`);
  const start = new Uint32Array(nt + 1);
  for (let k = 0; k < nt; k++) start[k + 1] = start[k] + dv.getUint16(head + 2 * k, true);
  if (start[nt] !== n) throw new Error('forest: the tile counts do not sum to n');
  const inst = new Uint32Array(n * 4), f = new Float32Array(inst.buffer), steps = tile / QUANT;
  const o = head + nt * 2;
  let hMax = 0;
  for (let tj = 0, k = 0; tj < th; tj++) for (let ti = 0; ti < tw; ti++, k++) {
    let key = 0;
    for (let q = start[k]; q < start[k + 1]; q++) {
      key += (u8[o + q] << 8) | u8[o + n + q];
      const qx = key % steps, qz = (key - qx) / steps;
      const h = u8[o + 2 * n + q] * hq / 100;
      // a shrub's crown radius from its height (v1's manzanita domes: about 1.1 × as wide as tall, ± a hash share)
      const r = kind ? h * (0.95 + 0.3 * ((Math.imul(key ^ (k << 12), 0x9e3779b1) >>> 24) / 255)) : u8[o + 3 * n + q] / 10;
      const layer = kind ? LAYERS.shrub : u8[o + 4 * n + q];
      f[4 * q] = x0 + ti * tile + (qx + 0.5) * QUANT;
      f[4 * q + 1] = z0 + tj * tile + (qz + 0.5) * QUANT;
      f[4 * q + 2] = 0;
      inst[4 * q + 3] = packBits(h, r, layer, kind);
      if (h > hMax) hMax = h;
    }
  }
  return { kind, n, x0, z0, tile, tw, th, start, inst, stats: { n, hMax } };
}
