// A small lake for the UI tests: src/terrain.js loads its grids with a top-level await (≈ 110 ms of gunzip in
// node for the real 25 MB); the controls' tests need none of it (the bottom they read is core.terrain, a stand-in). This
// module primes the loader's file map (src/terrain-data.js readFile reads workerPrime.files first) with
// two levels: open water 20 m deep, 5 km from any shore, and a round island 10 m high at the origin (terrain.js fits its
// LAKE.island from the land near the origin). Import it before anything that imports src/terrain.js: first in the import
// list (modules run in import order).
import { gzipSync } from 'node:zlib';
import { workerPrime } from '../../src/sim/terrain-data.js';   // imports no terrain.js: the priming lands first

const height = { offset: -600, step: 0.05 }, distance = { step: 0.5 };
const H = (m) => Math.round((m - height.offset) / height.step), D = (m) => 32768 + Math.round(m / distance.step);
// a .lsh grid (terrain-data.js): gzip of the 2-D predicted uint16 grid (left + up − up-left), hi-byte plane then lo-byte plane
function lsh(w, h, at) {
  const q = new Uint16Array(w * h), p = new Uint8Array(2 * w * h), n = w * h;
  for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k++) {
    q[k] = at(i, j);
    const left = i ? q[k - 1] : 0, up = j ? q[k - w] : 0, ul = i && j ? q[k - w - 1] : 0;
    const r = (q[k] - (j && i ? left + up - ul : j ? up : left)) & 0xffff;
    p[k] = r >> 8; p[n + k] = r & 255;
  }
  return gzipSync(p);
}
const IS = 64, ISTEP = 10, IX0 = -315;   // the island's level: 64 × 64 texels, 10 m apart, centred on the origin
const land = (i, j) => Math.hypot(IX0 + i * ISTEP, IX0 + j * ISTEP) < 60;
const manifest = { version: 1, origin: { lat: 38.954159, lon: -120.100464 }, y0: 1897.89, height, distance, levels: [
  { name: 'isle', step: ISTEP, x0: IX0, z0: IX0, w: IS, h: IS, height: 'isle-h.lsh', distance: 'isle-d.lsh', dk: 1, dw: IS, dh: IS },
  { name: 'flat', step: 32000, x0: -48000, z0: -48000, w: 4, h: 4, height: 'flat-h.lsh', distance: 'flat-d.lsh', dk: 1, dw: 4, dh: 4 },
] };
const files = {
  'tahoe.json': new TextEncoder().encode(JSON.stringify(manifest)),
  'isle-h.lsh': lsh(IS, IS, (i, j) => H(land(i, j) ? 10 : -20)), 'isle-d.lsh': lsh(IS, IS, (i, j) => D(land(i, j) ? 20 : -5000)),
  'flat-h.lsh': lsh(4, 4, () => H(-20)), 'flat-d.lsh': lsh(4, 4, () => D(-5000)),
};
workerPrime.files ??= new Map(Object.entries(files).map(([k, v]) => [k, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)]));
