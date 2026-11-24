// The lidar treetops: real crowns for the bay's box, from USGS 3DEP CA_SierraNevada_5_2022 first returns
// (public domain; tools/ground/lidar_ept.py, build_lidar.py; ATTRIBUTION.md). Plain JS: node tests, the bake workers and
// src/trees-scatter.js share it.
//
//   const tops = decodeTops(arrayBuffer);  setTops(tops);   // once, in the page and in each bake worker
//   forEachTop(xa, xb, za, zb, (i) => …)                    // indexes of the tops with xa <= x < xb, za <= z < zb
//   tops.x[i], tops.z[i] (world m), tops.h[i] (m), tops.r[i] (crown radius m), tops.kind[i] (0 tree, 1 shrub)
//
// File treetops.tps: 'TPS1', u32 n, n x 8 bytes (u16 x, u16 z in 0.1 m from the box corner; u8 height 0.25 m; u8 radius
// 0.1 m; u8 kind; u8 reserved). The box is the bay level's (naip-layout.js NAIP_EXTENT.bay).
import { terrainVariant, workerPrime } from '../../../src/sim/terrain-data.js';
import { fetchBytes } from '../../../src/fetchGz.js';
import { TOPS } from '../../../src/forest/topsBox.js';   // the file names and the box (its own module: the cameras' solid reads the box without this file's loaders)
export { TOPS };

let current = null;
export const getTops = () => current;
export const setTops = (t) => { current = t; };

export function decodeTops(buf) {
  const dv = new DataView(buf), n = dv.getUint32(4, true), b = TOPS.box;
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'TPS1') throw new Error('treetops: bad magic');
  const x = new Float32Array(n), z = new Float32Array(n), h = new Float32Array(n), r = new Float32Array(n), kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 8;
    x[i] = b.x0 + dv.getUint16(o, true) * 0.1; z[i] = b.z0 + dv.getUint16(o + 2, true) * 0.1;
    h[i] = dv.getUint8(o + 4) * 0.25; r[i] = dv.getUint8(o + 5) * 0.1; kind[i] = dv.getUint8(o + 6);
  }
  // a bucket grid (48 m) over the box: order = the indexes sorted by bucket, start[k] .. start[k + 1]
  const bw = Math.ceil((b.x1 - b.x0) / TOPS.bucket), bh = Math.ceil((b.z1 - b.z0) / TOPS.bucket), count = new Uint32Array(bw * bh + 1);
  const bk = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const k = Math.min(bh - 1, Math.floor((z[i] - b.z0) / TOPS.bucket)) * bw + Math.min(bw - 1, Math.floor((x[i] - b.x0) / TOPS.bucket)); bk[i] = k; count[k + 1]++; }
  for (let k = 0; k < bw * bh; k++) count[k + 1] += count[k];
  const fill = count.slice(0, bw * bh), order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[fill[bk[i]]++] = i;
  return { n, x, z, h, r, kind, bw, bh, start: count, order };
}

export function forEachTop(xa, xb, za, zb, fn, t = current) {
  if (!t) return;
  const b = TOPS.box, S = TOPS.bucket;
  const i0 = Math.max(0, Math.floor((xa - b.x0) / S)), i1 = Math.min(t.bw - 1, Math.floor((xb - b.x0) / S));
  const j0 = Math.max(0, Math.floor((za - b.z0) / S)), j1 = Math.min(t.bh - 1, Math.floor((zb - b.z0) / S));
  const hits = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = j * t.bw + i;
    for (let q = t.start[k]; q < t.start[k + 1]; q++) { const id = t.order[q]; if (t.x[id] >= xa && t.x[id] < xb && t.z[id] >= za && t.z[id] < zb) hits.push(id); }
  }
  hits.sort((a, c) => a - c);   // the file's order: the same trees in the same order for any tile cut
  for (const id of hits) fn(id);
}
export const inTopsBox = (x, z) => { const b = TOPS.box; return x >= b.x0 && x < b.x1 && z >= b.z0 && z < b.z1; };

// load once: the page and each worker (fetch), node (fs). Resolves null if the file is absent (the rules scatter then runs everywhere).
let loading = null;
export function loadTops(url = terrainVariant() === 'phone' ? TOPS.phoneFile : TOPS.file) {
  return (loading ??= (async () => {
    try {
      let buf;
      if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
        const fs = await import(/* @vite-ignore */ 'node:fs'), path = await import(/* @vite-ignore */ 'node:path'), u = await import(/* @vite-ignore */ 'node:url');
        const f = path.resolve(path.dirname(u.fileURLToPath(import.meta.url)), '../../..', url.replace(/^\//, ''));
        if (!fs.existsSync(f)) return null;
        const b = fs.readFileSync(f); buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      } else {
        if (workerPrime.wait) await workerPrime.wait;   // a phone's worker: the page posts them when they land (primeTops)
        const primed = workerPrime.tops;   // a phone's worker: the page posted them (src/terrain-data.js primeWorker)
        if (primed) buf = primed;
        else buf = await fetchBytes(url);   // the gzip twin in a production build (perf/slow-loading: 5.5 MB to 3.2 MB), else the file
      }
      return decodeTops(buf);
    } catch (e) { return null; }
  })());
}
