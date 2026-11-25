// v1's lake as a terrain object for v2's living lake (the kayaks, the birds, Cruise): src/sim/lake.js buildLakeOn (v1's own
// builder: the fitted island, the bay's mouth, the places, heightAt, shoreDistance …) over a sampler made of v2's height
// field (the CPU twin of the drawn ground, v2/terrain/sample.js) and v1's shore-distance grids, finest first: the island
// (1 m), the bay (4 m), then the lake-wide fallbacks, the basin (20 m) and the lake (64 m): four -d.lsh files (≈ 835 kB)
// streamed after the first frame, beside the terrain's stage 2 (a capture: before it). The lake answers anywhere on the
// water: the bay's fine grid where it covers, the coarser grids elsewhere, each blending into the next. Pure but for the fetch.
//   const S = shoreSampler(levels)                       levels: [{ name, dx0, dz0, dstep, dw, dh, D (Uint16Array) }] finest first
//   const T = lakeTerrain({ height: (x, z) => …, distance: S.distance, waters, day })   → v1's terrain object
//   await loadShore({ base, manifest, decode })          fetch + decode the SHORE_LEVELS grids → levels
import { buildLakeOn } from '../../src/sim/lake.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { pickDay, dayChoice } from '../../src/sim/day.js';

import { SHORE_LEVELS, shoreFiles } from '../terrain/levels.js';
export { SHORE_LEVELS, shoreFiles };
const BLEND = 12;   // texels: v1's terrain-data.js level blend
const DS = 0.5;     // m per code step: v1's manifest distance.step

// a level's distance grid placement, v1's makeSampler rule (the phone set names dx0, dz0, dstep; the full one implies them)
export function shoreGrid(L) {
  return { name: L.name, file: L.distance, dx0: L.dx0 ?? L.x0, dz0: L.dz0 ?? L.z0, dstep: L.dstep ?? L.step * L.dk, dw: L.dw, dh: L.dh };
}

// The basin's grid was baked inside its own 20 km box: where the nearest shore lies outside it (the lake's east and north
// shores, past x 10,235 and z −10,235) it reads too far from the shore, up to 8.3 km too far at its north-east corner. v1
// reads it as it is, so its shore distance changes by up to 7.4 km over the 240 m band where the basin blends into the lake
// grid. shoreSampler repairs a level named here once, at build: a texel that reads farther from the shore than the coarser
// levels by more than REPAIR_TOL of their texels eases to their value (all the way at twice that), so the blend joins two
// grids that agree. The island's and the bay's grids stay v1's (behaviour in the bay unchanged; both read up to 195 m too
// far in places near their own edges, as in v1).
export const SHORE_REPAIR = Object.freeze(['basin']);
const REPAIR_TOL = 3;   // texels of the next coarser level

// v1's distance sampler (src/sim/terrain-data.js makeSampler's distance(), copied: that module carries v1's fetch and
// node paths): bilinear on each level's grid, a level blending into the next coarser over its last BLEND texels, the
// coarsest clamped at its edge. Negative on the lake. v2/tests/kayaks.test.mjs demands v1's numbers on the real grids;
// v2/tests/shore-lake.test.mjs the lake-wide ones and the level edges.
function bil(g, w, h, fx, fz) {
  if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
  if (fz < 0) fz = 0; else if (fz > h - 1) fz = h - 1;
  let i = fx | 0, j = fz | 0;
  if (i > w - 2) i = w - 2; if (j > h - 2) j = h - 2;
  const u = fx - i, v = fz - j, k = j * w + i;
  const a = g[k], b = g[k + 1], c = g[k + w], d = g[k + w + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function blended(levels) {
  const n = levels.length;
  return function distance(x, z) {
    let acc = 0, left = 1;
    for (let k = 0; k < n; k++) {
      const L = levels[k], fx = (x - L.dx0) / L.dstep, fz = (z - L.dz0) / L.dstep, w = L.dw, h = L.dh;
      const m = Math.min(fx, fz, w - 1 - fx, h - 1 - fz);
      if (m <= 0 && k < n - 1) continue;
      const v = DS * (bil(L.D, w, h, fx, fz) - 32768);
      if (m >= BLEND || k === n - 1) return acc + left * v;
      const t = m / BLEND, s = t * t * (3 - 2 * t);
      acc += left * s * v; left *= 1 - s;
    }
    return acc;
  };
}
// a level's codes with the texels that read too far eased to the coarser levels' value (a new array; the input is untouched)
export function repairLevel(L, coarser, tolM) {
  const D = new Uint16Array(L.D.length);
  let n = 0;
  for (let j = 0; j < L.dh; j++) for (let i = 0; i < L.dw; i++) {
    const k = j * L.dw + i, v = DS * (L.D[k] - 32768), c = coarser(L.dx0 + i * L.dstep, L.dz0 + j * L.dstep);
    const t = (Math.abs(v) - Math.abs(c) - tolM) / tolM;
    if (t <= 0) { D[k] = L.D[k]; continue; }
    const s = t >= 1 ? 1 : t * t * (3 - 2 * t);
    D[k] = Math.round((v + (c - v) * s) / DS + 32768); n++;
  }
  return { D, n };
}
export function shoreSampler(levels, { repair = SHORE_REPAIR } = {}) {
  const out = levels.slice();
  let repaired = 0;
  for (let k = out.length - 2; k >= 0; k--) {
    if (!repair.includes(out[k].name)) continue;
    const r = repairLevel(out[k], blended(out.slice(k + 1)), REPAIR_TOL * out[k + 1].dstep);
    out[k] = { ...out[k], D: r.D }; repaired += r.n;
  }
  return { distance: blended(out), repaired };
}

// v1's terrain object on v2's heights: buildLakeOn over { height, distance, spacing, cover } (the cover is v1's "no grid
// here": all zero, so coverAt falls back to its elevation rules; the living lake reads none of it)
export function lakeTerrain({ height, distance, waters = CURRENT_WATERS, day = pickDay(waters, dayChoice()) }) {
  const S = {
    height, distance,
    spacing: (x, z) => (Math.abs(x) < 180 && Math.abs(z) < 180 ? 1 : 2),
    cover: (x, z, out = new Float32Array(11)) => out.fill(0),
  };
  return buildLakeOn(waters, S, day);
}

// fetch and decode the SHORE_LEVELS grids (decode: (bytes, w, h) → Uint16Array, the terrain's own inflate +
// unpredict, in a worker on a page)
export async function loadShore({ base, manifest, decode }) {
  const grids = manifest.levels.filter((L) => SHORE_LEVELS.includes(L.name)).map(shoreGrid);
  let bytes = 0;
  const levels = await Promise.all(grids.map(async (g) => {
    const r = await fetch(new URL(g.file, base));
    if (!r.ok) throw new Error(`${g.file}: ${r.status}`);
    const raw = new Uint8Array(await r.arrayBuffer());
    bytes += raw.length;
    return { ...g, D: await decode(raw, g.dw, g.dh) };
  }));
  return { levels, bytes };
}
