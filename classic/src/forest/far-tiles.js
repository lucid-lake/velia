// The forest's far band in streaming tiles. Plain JS: node tests read it.
//
// The impostor shader (src/trees.js impostorMaterial) decides per card whether it shows: a bay tree past NEAR and
// inside FAR, kept by the thinning (its phase / 2π ≤ (THIN / d)² past THIN m); a rim stand inside RIMFAR. That rule
// stays the judge. These tiles only decide which cards are in the drawn buffer at all, and always hold a SUPERSET of
// the cards the shader can show from anywhere within `margin` m of the camera, so the picture is the same card for card:
//   - each 500 m tile's bay cards are ordered by phase (in 1,024 buckets), so the cards that survive the thinning at a
//     distance are a prefix; the tile holds the prefix (to the end of keep's bucket) for its nearest point minus the
//     margin, rounded to a quarter octave (always toward nearer, so toward more cards);
//   - its rim stands are all in or all out (inside RIMFAR + the margin).
// Drawn: from the bay start, about 340 k of the 618 k cards can show (2026-10-29), so the vertex stage runs for about
// half the instances, and the drawn buffer is sized to what is resident.
//
//   const T = farTiles(root, prm, isRim, { tile })     // root, prm: Float32Array × 4 per card (the shader's iRoot, iPrm)
//   T.tiles: [{ key, ix, iz, rect, start, nB, nR, bk }]  start: the tile's first card in T.root / T.prm (bay cards by
//                                                       phase bucket, then rim stands); bk[b]: its bay cards in buckets < b
//   tileTarget(t, x, z, margin, bands) → { nB, rim }   the cards the tile must hold for a camera at (x, z)
import { rectDist } from '../stream/grid.js';

const PH_BUCKETS = 1024;   // the thinning phase in buckets: a tile's prefix ends at a bucket's end (a superset)
export function farTiles(root, prm, isRim, { tile = 500 } = {}) {
  // a counting sort, O(n): by tile, then bay before rim, then (bay) by phase bucket
  const n = root.length / 4, slotOf = new Map(), slot = new Int32Array(n), bucket = new Int16Array(n), tiles = [];
  let lastId = -1, lastSl = -1;   // the scatter runs in rows: the next card is mostly in the same tile
  for (let k = 0; k < n; k++) {
    const ix = Math.floor(root[k * 4] / tile), iz = Math.floor(root[k * 4 + 2] / tile), id = (ix + 32768) * 65536 + (iz + 32768);
    let sl = id === lastId ? lastSl : slotOf.get(id);
    if (sl === undefined) { sl = tiles.length; slotOf.set(id, sl); tiles.push({ key: `${ix},${iz}`, ix, iz, rect: { x0: ix * tile, z0: iz * tile, x1: (ix + 1) * tile, z1: (iz + 1) * tile }, start: 0, nB: 0, nR: 0, bk: null }); }
    slot[k] = sl; lastId = id; lastSl = sl;
    // the shader's test value is phase × 0.15915 (prm.x: radians, 0 .. 2π), so 0 .. 1
    if (isRim(k)) { bucket[k] = PH_BUCKETS; tiles[sl].nR++; } else { bucket[k] = Math.min(PH_BUCKETS - 1, Math.floor(prm[k * 4] * 0.15915 * PH_BUCKETS)); tiles[sl].nB++; }
  }
  let at = 0;
  for (const t of tiles) { t.start = at; at += t.nB + t.nR; if (t.nB) t.bk = new Uint32Array(PH_BUCKETS + 1); }
  for (let k = 0; k < n; k++) { const b = bucket[k]; if (b < PH_BUCKETS) tiles[slot[k]].bk[b + 1]++; }
  for (const t of tiles) if (t.bk) for (let b = 0; b < PH_BUCKETS; b++) t.bk[b + 1] += t.bk[b];   // bk[b]: the bay cards in buckets < b
  const fill = tiles.map((t) => (t.bk ? t.bk.slice(0, PH_BUCKETS) : null)), rimAt = tiles.map((t) => t.start + t.nB);
  const outRoot = new Float32Array(n * 4), outPrm = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) {
    const sl = slot[k], b = bucket[k], d = b < PH_BUCKETS ? tiles[sl].start + fill[sl][b]++ : rimAt[sl]++;
    for (let c = 0; c < 4; c++) { outRoot[d * 4 + c] = root[k * 4 + c]; outPrm[d * 4 + c] = prm[k * 4 + c]; }
  }
  return { root: outRoot, prm: outPrm, tiles, count: n };
}

// bands: { FAR, RIMFAR, THIN } (src/trees.js BANDS). The distance is the camera's ground distance to the tile's
// rect, less the margin, then rounded DOWN to a quarter octave (so the cards held only grow as the camera nears).
export function tileTarget(t, x, z, margin, bands) {
  const d = Math.max(0, rectDist(x, z, t.rect) - margin);
  const rim = t.nR > 0 && d <= bands.RIMFAR;
  if (d > bands.FAR || t.nB === 0) return { nB: 0, rim };
  const dq = d <= bands.THIN ? d : Math.pow(2, Math.floor(Math.log2(d) * 4) / 4);
  const keep = dq <= bands.THIN ? 1 : (bands.THIN / dq) ** 2;
  // the shader keeps a card while phase × 0.15915 ≤ keep (float32: a hair of slack): every bucket up to keep's, whole
  return { nB: keep >= 1 ? t.nB : t.bk[Math.min(PH_BUCKETS, Math.floor((keep * (1 + 1e-5) + 1e-6) * PH_BUCKETS) + 1)], rim };
}

// Slots in the drawn buffer: first fit from the freed ranges, else from the end. The drawn count is the end (`top`).
export class Slots {
  constructor(capacity) { this.capacity = capacity; this.top = 0; this.free = []; this.live = 0; }   // free: [[start, n]] by start
  alloc(n) {
    if (n <= 0) return 0;
    for (let i = 0; i < this.free.length; i++) {
      const f = this.free[i];
      if (f[1] >= n) { const s = f[0]; f[0] += n; f[1] -= n; if (!f[1]) this.free.splice(i, 1); this.live += n; return s; }
    }
    if (this.top + n > this.capacity) return -1;
    const s = this.top; this.top += n; this.live += n; return s;
  }
  release(s, n) {
    if (n <= 0) return;
    this.live -= n;
    let i = 0; while (i < this.free.length && this.free[i][0] < s) i++;
    this.free.splice(i, 0, [s, n]);
    // merge neighbours, and give the end back
    for (let j = Math.max(0, i - 1); j + 1 < this.free.length;) { const a = this.free[j], b = this.free[j + 1]; if (a[0] + a[1] === b[0]) { a[1] += b[1]; this.free.splice(j + 1, 1); } else if (j >= i) break; else j++; }
    const last = this.free.at(-1); if (last && last[0] + last[1] === this.top) { this.top = last[0]; this.free.pop(); }
  }
}

// one tile's cards (a streamed scatter tile, src/forest/scatter-tiles.js): the same order as farTiles gives a tile
// (bay cards by phase bucket, then rim stands), its own arrays (start 0)
export function farTileOf(root, prm, isRim, rect, key) {
  const n = root.length / 4, bucket = new Int16Array(n), bk = new Uint32Array(PH_BUCKETS + 1);
  let nB = 0, nR = 0;
  for (let k = 0; k < n; k++) {
    if (isRim(k)) { bucket[k] = PH_BUCKETS; nR++; } else { const b = Math.min(PH_BUCKETS - 1, Math.floor(prm[k * 4] * 0.15915 * PH_BUCKETS)); bucket[k] = b; bk[b + 1]++; nB++; }
  }
  for (let b = 0; b < PH_BUCKETS; b++) bk[b + 1] += bk[b];
  const fill = bk.slice(0, PH_BUCKETS), outRoot = new Float32Array(n * 4), outPrm = new Float32Array(n * 4);
  let rimAt = nB;
  for (let k = 0; k < n; k++) {
    const b = bucket[k], d = b < PH_BUCKETS ? fill[b]++ : rimAt++;
    for (let c = 0; c < 4; c++) { outRoot[d * 4 + c] = root[k * 4 + c]; outPrm[d * 4 + c] = prm[k * 4 + c]; }
  }
  return { key, rect, start: 0, nB, nR, bk: nB ? bk : null, root: outRoot, prm: outPrm };
}
