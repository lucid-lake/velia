// v1's lake as a terrain object for v2's living lake (the kayaks; the birds): src/sim/lake.js buildLakeOn (v1's own
// builder: the fitted island, the bay's mouth, the places, heightAt, shoreDistance …) over a sampler made of v2's height
// field (the CPU twin of the drawn ground, v2/terrain/sample.js) and v1's shore-distance grids for the island (1 m) and the
// bay (4 m): the two -d.lsh files (≈ 318 kB) streamed after the first frame (a capture: before it). Past the bay's grid the
// distance is the bay grid's edge (the kayaks and the birds keep to the bay). Pure but for the fetch.
//   const S = shoreSampler(levels)                       levels: [{ dx0, dz0, dstep, dw, dh, D (Uint16Array) }] finest first
//   const T = lakeTerrain({ height: (x, z) => …, distance: S.distance, waters, day })   → v1's terrain object
//   await loadShore({ base, manifest, decode })          fetch + decode the island's and the bay's grids → levels
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

// v1's distance sampler (src/sim/terrain-data.js makeSampler's distance(), copied: that module carries v1's fetch and
// node paths): bilinear on each level's grid, a level blending into the next coarser over its last BLEND texels, the
// coarsest clamped at its edge. Negative on the lake. v2/tests/kayaks-lake.test.mjs demands v1's numbers on the real grids
export function shoreSampler(levels) {
  const n = levels.length;
  function bil(g, w, h, fx, fz) {
    if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
    if (fz < 0) fz = 0; else if (fz > h - 1) fz = h - 1;
    let i = fx | 0, j = fz | 0;
    if (i > w - 2) i = w - 2; if (j > h - 2) j = h - 2;
    const u = fx - i, v = fz - j, k = j * w + i;
    const a = g[k], b = g[k + 1], c = g[k + w], d = g[k + w + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function distance(x, z) {
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
  }
  return { distance };
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

// fetch and decode the island's and the bay's grids (decode: (bytes, w, h) → Uint16Array, the terrain's own inflate +
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
