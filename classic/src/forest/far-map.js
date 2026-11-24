// The far map: the lake rim's forest past ≈ 5 km as a top-down raster on
// the terrain, not 327,000 stand cards. Plain JS: node tests and src/trees.js share it; the texture is
// src/forest/far-map-texture.js.
//
// Per 32 m texel over the rim's region (RIM_RULES.region, 36 × 48 km: 1,125 × 1,500): R the stands' crown cover
// (each stand a disc of its card's half width, the rim's 4 × wide frame), G the tallest stand's top (0 .. 64 m). It is
// painted from the rim's own scatter as its tiles stream in, so it holds exactly the stands the cards drew. The terrain
// material (src/terrain-mesh.js) darkens the far ground to the forest's canopy by R, lit per pixel by the moving sun,
// and lifts the far vertices by G × R so the ridgelines keep the forest's thickness. The cards fade out over the same
// distances (FARMAP.near .. FARMAP.far), a dither per stand, so no ring pops. ?farmap=0: the cards to 24 km, as before.
import { RIM_RULES, TREE_STRIDE } from '../trees-scatter.js';
import { SPECIES } from './species.js';
import { FLAGS } from '../../../src/sim/core/flags.js';

export const FARMAP = Object.freeze({ cell: 32, region: RIM_RULES.region, near: 4000, far: 6000, topM: 64, coverK: 1.0 });
// the far map for a quality tier (src/quality/tiers.js forest.farMapCell: the texel); High's is FARMAP
export const farMapFor = (tier = null) => (tier?.forest?.farMapCell && tier.forest.farMapCell !== FARMAP.cell ? { ...FARMAP, cell: tier.forest.farMapCell } : FARMAP);
export const farMapOn = () => typeof location === 'undefined' || FLAGS.farmap;
export function farMapSize(F = FARMAP) {
  const { x0, x1, z0, z1 } = F.region;
  return { w: Math.ceil((x1 - x0) / F.cell), h: Math.ceil((z1 - z0) / F.cell) };
}

// the painter: integer cover sums (1/4096ths: the same bytes in any tile order) and the tallest top per texel; bytes
// written for the texels a tile touched
export function farMapPainter(F = FARMAP) {
  const { w, h } = farMapSize(F), { x0, z0 } = F.region, cell = F.cell, FIX = 4096;
  const cover = new Uint32Array(w * h), top = new Float32Array(w * h), data = new Uint8Array(w * h * 2);
  const crownR = (height) => Math.min(7, Math.max(1.5, height * 0.22)) * RIM_RULES.stand.wide;   // a stand card's half width
  // t: a scatter tile (src/forest/scatter-tiles.js) of the rim pass; returns the texel box it wrote
  function paint(t) {
    let ia = w, ib = -1, ja = h, jb = -1;
    for (let i = 0; i < t.count; i++) {
      if (SPECIES[t.species[i]]?.kind === 'shrub') continue;
      const k = i * TREE_STRIDE, x = t.data[k], z = t.data[k + 2], ht = t.data[k + 3] * RIM_RULES.stand.tall, r = crownR(t.data[k + 3]);
      const ci = (x - x0) / cell, cj = (z - z0) / cell, rc = r / cell, area = Math.PI * r * r / (cell * cell);
      const i0 = Math.max(0, Math.floor(ci - rc)), i1 = Math.min(w - 1, Math.floor(ci + rc)), j0 = Math.max(0, Math.floor(cj - rc)), j1 = Math.min(h - 1, Math.floor(cj + rc));
      if (i1 < i0 || j1 < j0) continue;
      const add = Math.round(FIX * area / ((i1 - i0 + 1) * (j1 - j0 + 1)));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) { const q = j * w + ii; cover[q] += add; if (ht > top[q]) top[q] = ht; }
      ia = Math.min(ia, i0); ib = Math.max(ib, i1); ja = Math.min(ja, j0); jb = Math.max(jb, j1);
    }
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const q = j * w + i;
      data[q * 2] = Math.min(255, Math.round(255 * Math.min(1, cover[q] / FIX * F.coverK)));
      data[q * 2 + 1] = Math.min(255, Math.round(255 * Math.min(1, top[q] / F.topM)));
    }
    return ib >= ia ? { ia, ib, ja, jb } : null;
  }
  return { w, h, data, paint };
}
