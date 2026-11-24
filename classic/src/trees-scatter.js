// Where the forest stands: a seeded scatter over the terrain, by species. Plain JS, no three.js (node tests and the
// bake workers read it; src/prebake.js runs it in row bands).
//
//   import { scatterTrees, TREE_RULES } from './trees-scatter.js';
//   const s = scatterTrees(terrain, { seed: 1 });
//   // → { count, data: Float32Array [x, y, z, heightM, phase, yaw, gnx, gnz] × count   (gnx, gnz: the ground normal's
//   //     horizontal parts: the aspect), species: Uint8Array (index into SPECIES), variant: Uint8Array (0 .. VARIANTS−1),
//   //     snag: Uint8Array (1 = a snag), logs: Float32Array [x, y, z, lenM, yaw, radiusM] × nLogs,
//   //     rocks: Float32Array [x, y, z, radiusM, yaw, squash] × nRocks, nLogs, nRocks }
//
// The stand: a mixed-age, open stand with groves and gaps. One candidate per 12 m cell,
// jittered; kept where a density field (groves at 420 m and 60 m, texture at 18 m) says so, thinner on steep
// granite (slabs: manzanita and boulders there instead), open near the water (a third as dense at the shore, full by
// 80 m), a ragged treeline (TREE_RULES.treeline ± 60 m, krummholz over its last 110 m), none past the species' slope,
// none within 6 m of the shore, none in the terrain's keep-outs (the beach, the house, the creek, the ruin) or where
// the shared land cover says rock, snow, beach or urban (terrain.cover(x, z)). The
// species at a spot comes from each species' weight there (elevation band, aspect, slope, shore; src/forest/species.js).
// Heights: the species' range, a quarter of the trees young (mixed age), shorter toward the treeline, crest trees up
// to 1.4 × taller. Snags: 7 % within 120 m of the water, 3 % elsewhere, 9 % on crests. Fallen logs and granite
// boulders as their own lists. Deterministic for a seed: no Math.random().
import { getTops, forEachTop, inTopsBox, TOPS } from './forest/treetops.js';
import { SPECIES, TREE_SPECIES, SPECIES_INDEX, VARIANTS, SNAG, SHRUB, speciesWeight } from './forest/species.js';

import { LIDAR_LAND, TREE_RULES } from '../../src/forest/rules.js';   // the crown and tree rules (their own module: the cameras' solid reads them without the scatter)
export { LIDAR_LAND, TREE_RULES };
export const TREE_STRIDE = 8, LOG_STRIDE = 6, ROCK_STRIDE = 6;
// The lake rim and the slopes round it, out to ≈ 20 km (art/trees-rim): a coarse pass past the bay's region, one
// candidate per 48 m cell, each kept one a stand card (an impostor 4 × wider, 1.25 × taller); no shrubs, logs or rocks.
// The bay's own region is skipped (the fine scatter covers it). 36 × 48 km: ≈ 750 k candidates, in the bake workers.
export const RIM_RULES = {
  ...TREE_RULES, lidar: false, cell: 48, exclude: TREE_RULES.region, stand: { wide: 4, tall: 1.25 },
  density: { ...TREE_RULES.density, keep: 0.28 }, snags: { withinM: 120, share: 0.03, inland: 0.01, crest: 0.03 },
  logs: { ...TREE_RULES.logs, share: 0 }, rocks: { ...TREE_RULES.rocks, share: 0 }, shrubs: { ...TREE_RULES.shrubs, share: 0 },
  region: { x0: -16000, x1: 20000, z0: -38000, z1: 10000 },   // the whole lake and its rim (the island at the origin)
};
// Fannette's brush on a 4 m cell (the 12 m scatter gives ≈ 40 clumps on 9,100 m²; the real island is brush all over):
// manzanita only, 55 % of the cells inside the island, clear of the summit's keep-out. Same layout as scatterTrees.
export function scatterIsland(terrain, { seed = 1, cell = 4, share = 0.55 } = {}) {
  const out = [], species = [], variant = [], snag = [], shrub = SPECIES[SHRUB], [h0, h1] = TREE_RULES.shrubs.heightM;
  if (!terrain.islandR) return { count: 0, data: new Float32Array(0), species: new Uint8Array(0), variant: new Uint8Array(0), snag: new Uint8Array(0), logs: new Float32Array(0), rocks: new Float32Array(0), nLogs: 0, nRocks: 0 };
  for (let j = -40; j < 40; j++) for (let i = -40; i < 40; i++) {
    const x = (i + 0.15 + 0.7 * hash(i, j, seed * 11 + 1)) * cell, z = (j + 0.15 + 0.7 * hash(i, j, seed * 11 + 2)) * cell;
    if (terrain.islandR(x, z) >= 1) continue;
    const y = terrain.heightAt(x, z);
    if (y < 1.5 || (terrain.keepOut && terrain.keepOut(x, z)) || hash(i, j, seed * 11 + 3) > share) continue;
    const gx = (terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z)) / 4, gz = (terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2)) / 4, nl = Math.hypot(gx, 1, gz);
    out.push(x, y, z, (h0 + (h1 - h0) * hash(i, j, seed * 11 + 5)) * 0.8, hash(i, j, seed * 11 + 10) * Math.PI * 2, hash(i, j, seed * 11 + 11) * Math.PI * 2, -gx / nl, -gz / nl);
    species.push(SHRUB); variant.push(Math.floor(hash(i, j, seed * 11 + 12) * VARIANTS)); snag.push(0);
  }
  void shrub;
  return { count: out.length / TREE_STRIDE, data: new Float32Array(out), species: Uint8Array.from(species), variant: Uint8Array.from(variant), snag: Uint8Array.from(snag), logs: new Float32Array(0), rocks: new Float32Array(0), nLogs: 0, nRocks: 0 };
}

function hash(x, y, s) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// smooth value noise in [0, 1] on a lattice of `scale` metres
function vnoise(x, z, scale, s) {
  const fx = x / scale, fz = z / scale, xi = Math.floor(fx), zi = Math.floor(fz);
  const u = fx - xi, v = fz - zi, uu = u * u * (3 - 2 * u), vv = v * v * (3 - 2 * v);
  const a = hash(xi, zi, s), b = hash(xi + 1, zi, s), c = hash(xi, zi + 1, s), d = hash(xi + 1, zi + 1, s);
  return a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv;
}

// rows [j0, j1) of the cell grid only (default: all): row bands concatenated in order equal the whole scatter, value
// for value (src/prebake.js bakes them in workers). scatterRowCount(rules) is the grid's row count.
export function scatterRowCount(rules = TREE_RULES) { return Math.floor((rules.region.z1 - rules.region.z0) / rules.cell); }
export function scatterColCount(rules = TREE_RULES) { return Math.floor((rules.region.x1 - rules.region.x0) / rules.cell); }

// towns: { keepOut(x, z), treeDensity(x, z) } from src/towns-layout.js (art/towns), when the caller has it
export function scatterTrees(terrain, { seed = 1, rules = TREE_RULES, rows = null, cols = null, towns = null } = {}) {
  const R = rules, { x0, x1, z0, z1 } = R.region, step = 4, DEG = Math.PI / 180;
  const out = [], species = [], variant = [], snag = [], logs = [], rocks = [];
  const nx = Math.floor((x1 - x0) / R.cell), nz = Math.floor((z1 - z0) / R.cell);
  const [ja, jb] = rows ?? [0, nz], [ia, ib] = cols ?? [0, nx];   // rows, cols: a band or a tile of the cell grid (world streaming: src/forest/scatter-tiles.js)
  const elevScale = R.treeline / 1000;                                       // the species' bands are for a 1,000 m treeline
  // the shared land cover: coverAt → weights { water, forest, rock, snow, beach, urban, shrub };
  // a plain cover(x, z) → a name serves the tests and the old terrain
  const coverAt = terrain.coverAt ?? null, coverName = terrain.cover ?? null;
  const cover = coverAt ? (x, z) => {
    const w = coverAt(x, z);
    if ((w.water ?? 0) > 0.5) return 'water';
    if ((w.snow ?? 0) > 0.5) return 'snow';
    if ((w.urban ?? 0) > 0.6) return 'urban';
    if ((w.beach ?? 0) > 0.5) return 'beach';
    if ((w.rock ?? 0) > 0.5) return 'rock';
    if ((w.shrub ?? 0) > (w.forest ?? 0) && (w.shrub ?? 0) > 0.4) return 'shrub';
    return 'forest';
  } : coverName;
  const weights = new Float64Array(TREE_SPECIES.length);
  const tops = R.lidar ? getTops() : null;   // the bay box's real crowns replace the rule-based candidates inside it
  const shrubSp = SPECIES[SHRUB], [sh0, sh1] = R.shrubs.heightM;
  for (let j = ja; j < jb; j++) for (let i = Math.max(0, ia); i < Math.min(nx, ib); i++) {
    const x = x0 + (i + 0.15 + 0.7 * hash(i, j, seed * 7 + 1)) * R.cell;
    const z = z0 + (j + 0.15 + 0.7 * hash(i, j, seed * 7 + 2)) * R.cell;
    const ex = R.exclude;
    if (ex && x >= ex.x0 && x < ex.x1 && z >= ex.z0 && z < ex.z1) continue;   // the rim pass skips the bay's own region
    if (tops && inTopsBox(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < R.minH) continue;
    const line = R.treeline + R.treelineJitter * (2 * vnoise(x, z, 300, seed + 13) - 1);
    if (y > line) continue;
    const c = cover ? cover(x, z) : 'forest';
    if (c === 'snow' || c === 'beach' || c === 'water') continue;
    if (c === 'urban' && !towns) continue;                                   // built ground: the towns' masks thin it (55 % kept) and clear the footprints; without them, bare
    if (terrain.keepOut && terrain.keepOut(x, z)) continue;                // L2: the beach, the house, the creek, the ruin
    if (towns && towns.keepOut(x, z)) continue;                               // a building, a run, a lift line, a road
    const sd = terrain.shoreDistance ? terrain.shoreDistance(x, z) : 1e9;
    if (sd < R.shoreGap) continue;
    const gx = (terrain.heightAt(x + step, z) - terrain.heightAt(x - step, z)) / (2 * step);
    const gz = (terrain.heightAt(x, z + step) - terrain.heightAt(x, z - step)) / (2 * step);
    const grad = Math.hypot(gx, gz), slopeDeg = Math.atan(grad) / DEG;
    const nl = Math.hypot(gx, 1, gz), gnx = -gx / nl, gnz = -gz / nl;      // the ground normal; gnz > 0 faces south
    const onIsland = terrain.islandR ? terrain.islandR(x, z) < 0.85 : false;   // L2: trees over the island's top
    const granite = c === 'rock' || slopeDeg > R.density.graniteSlopeDeg;
    // the density field: groves and gaps; the threshold rises near the shore and on granite
    const dens = 0.55 * vnoise(x, z, 420, seed + 11) + 0.30 * vnoise(x, z, 60, seed + 12) + 0.15 * vnoise(x, z, 18, seed + 14);
    const near = Math.min(1, Math.max(0, 1 - (sd - R.shoreGap) / R.open.fullM));
    let keep = R.density.keep + (R.density.shoreKeep - R.density.keep) * near;
    if (granite) keep = Math.max(keep, R.density.granite);
    if (c === 'shrub') keep += 0.2;                                          // the cover's shrubland: a thin stand
    if (coverAt) keep += 0.25 * (1 - Math.min(1, (coverAt(x, z).forest ?? 1) + (coverAt(x, z).shrub ?? 0) * 0.5));
    const u = hash(i, j, seed * 7 + 3);
    let tree = onIsland ? u < R.island.trees : dens > keep && c !== 'rock';   // the shared cover's rock: slabs, no trees; the island by its own share
    if (tree && !onIsland && hash(i, j, seed * 7 + 6) > R.open.nearShore + (1 - R.open.nearShore) * (1 - near)) tree = false;   // open conifer at the water
    if (tree && towns && hash(i, j, seed * 7 + 16) > towns.treeDensity(x, z)) tree = false;   // the towns stand in the trees, thinned
    // the treeline: thinning over its last `thin` metres, the survivors short (krummholz)
    const tl = Math.min(1, Math.max(0, (line - y) / R.thin));
    if (tree && tl < 1 && hash(i, j, seed * 7 + 9) > tl * tl + 0.04) tree = false;
    // the species at this spot
    let sp = -1;
    if (tree) {
      let total = 0;
      for (let k = 0; k < TREE_SPECIES.length; k++) { weights[k] = speciesWeight(TREE_SPECIES[k], { elevM: y, elevScale, aspect: gnz, slopeDeg: onIsland ? 0 : slopeDeg, shoreM: sd }); total += weights[k]; }
      if (total <= 0) tree = false;
      else {
        let pick = hash(i, j, seed * 7 + 4) * total;
        for (let k = 0; k < TREE_SPECIES.length; k++) { pick -= weights[k]; if (pick <= 0) { sp = SPECIES_INDEX[TREE_SPECIES[k].id]; break; } }
        if (sp < 0) sp = SPECIES_INDEX[TREE_SPECIES[TREE_SPECIES.length - 1].id];
      }
    }
    if (!tree) {
      // no tree: on steep ground a manzanita dome or a granite boulder; on gentle forest floor now and then a log
      if (onIsland ? u < R.island.trees + R.island.shrubs : (slopeDeg > R.shrubs.slopeDeg && slopeDeg < shrubSp.slope && u < R.shrubs.share && c !== 'snow')) {
        const h = sh0 + (sh1 - sh0) * hash(i, j, seed * 7 + 5);
        out.push(x, y, z, h, hash(i, j, seed * 7 + 10) * Math.PI * 2, hash(i, j, seed * 7 + 11) * Math.PI * 2, gnx, gnz);
        species.push(SHRUB); variant.push(Math.floor(hash(i, j, seed * 7 + 12) * VARIANTS)); snag.push(0);
      } else if (slopeDeg > R.rocks.slopeDeg && u < R.shrubs.share + R.rocks.share) {
        const [r0, r1] = R.rocks.radiusM, r = r0 + (r1 - r0) * hash(i, j, seed * 7 + 5) ** 2;
        rocks.push(x, y, z, r, hash(i, j, seed * 7 + 11) * Math.PI * 2, 0.45 + 0.4 * hash(i, j, seed * 7 + 12));
      } else if (slopeDeg < 30 && dens > R.density.keep - 0.12 && u < R.logs.share && !onIsland) {
        const [l0, l1] = R.logs.lenM, [q0, q1] = R.logs.radiusM, len = l0 + (l1 - l0) * hash(i, j, seed * 7 + 5);
        const yaw = Math.atan2(gnx, gnz) + (hash(i, j, seed * 7 + 11) - 0.5) * 1.2;   // roughly downslope
        logs.push(x, y, z, len, yaw, q0 + (q1 - q0) * hash(i, j, seed * 7 + 12));
      }
      continue;
    }
    const S = SPECIES[sp];
    // the height: the species' range, mixed age, short at the treeline, tall on crests
    const [h0, h1] = S.heightM;
    let h = h0 + (h1 - h0) * hash(i, j, seed * 7 + 5) ** 1.3;
    if (hash(i, j, seed * 7 + 7) < R.young.share) h *= R.young.scale[0] + (R.young.scale[1] - R.young.scale[0]) * hash(i, j, seed * 7 + 15);
    h *= 0.4 + 0.6 * Math.min(1, (line - y) / (2.5 * R.thin));          // short toward the treeline (krummholz at it)
    if (onIsland) h = Math.min(h, 26);
    const cr = R.crest, ring = (terrain.heightAt(x + cr.ringM, z) + terrain.heightAt(x - cr.ringM, z) + terrain.heightAt(x, z + cr.ringM) + terrain.heightAt(x, z - cr.ringM)) / 4;
    const crest = Math.min(1, Math.max(0, (y - ring - cr.riseM) / (cr.fullM - cr.riseM)));
    h *= 1 + (cr.boost - 1) * crest;
    h = Math.max(4, h);
    if (R.stand) h *= R.stand.tall;                                          // a rim card is a stand: taller, and wider in the shader
    // snags: dead trees near the water, on crests, a few anywhere
    const snagShare = sd < R.snags.withinM ? R.snags.share : crest > 0.5 ? R.snags.crest : R.snags.inland;
    const dead = hash(i, j, seed * 7 + 8) < snagShare ? 1 : 0;
    out.push(x, y, z, dead ? h * 0.8 : h, hash(i, j, seed * 7 + 10) * Math.PI * 2, hash(i, j, seed * 7 + 11) * Math.PI * 2, gnx, gnz);
    species.push(dead ? SNAG : sp); variant.push(Math.floor(hash(i, j, seed * 7 + 12) * VARIANTS)); snag.push(dead);
  }
  if (tops) {
    // the lidar's crowns in this cut of the cell grid: real positions and heights; the species from the spot (elevation, aspect,
    // slope, shore) and the crown's shape (narrow: fir; broad: pine); a share are dead (snags); brush from the NAIP class
    const xa = Math.max(TOPS.box.x0, x0 + Math.max(0, ia) * R.cell), xb = Math.min(TOPS.box.x1, x0 + Math.min(nx, ib) * R.cell);
    const za = Math.max(TOPS.box.z0, z0 + ja * R.cell), zb = Math.min(TOPS.box.z1, z0 + jb * R.cell);
    const keepShare = R.lidarKeep ?? 1;
    if (xb > xa && zb > za) forEachTop(xa, xb, za, zb, (id) => {
      const x = tops.x[id], z = tops.z[id], hq = Math.round(x * 10), zq = Math.round(z * 10);
      if (keepShare < 1 && hash(hq, zq, seed * 7 + 21) > keepShare) return;
      const y = terrain.heightAt(x, z);
      if (y < LIDAR_LAND.minY) return;
      const c = cover ? cover(x, z) : 'forest';
      if (c === 'snow' || c === 'beach' || c === 'water') return;
      if (terrain.keepOut && terrain.keepOut(x, z)) return;
      if (towns && towns.keepOut(x, z)) return;
      const sd = terrain.shoreDistance ? terrain.shoreDistance(x, z) : 1e9;
      if (sd < LIDAR_LAND.shoreGap) return;
      const gx = (terrain.heightAt(x + step, z) - terrain.heightAt(x - step, z)) / (2 * step), gz = (terrain.heightAt(x, z + step) - terrain.heightAt(x, z - step)) / (2 * step);
      const nl = Math.hypot(gx, 1, gz), gnx = -gx / nl, gnz = -gz / nl, slopeDeg = Math.atan(Math.hypot(gx, gz)) / DEG;
      const ph = hash(hq, zq, seed * 7 + 10) * Math.PI * 2, yaw = hash(hq, zq, seed * 7 + 11) * Math.PI * 2, vr = Math.floor(hash(hq, zq, seed * 7 + 12) * VARIANTS);
      if (tops.kind[id] === 1) {   // a shrub (manzanita, huckleberry oak) from the NAIP brush class
        out.push(x, y, z, Math.min(1.6, Math.max(0.7, tops.h[id] * 0.5)), ph, yaw, gnx, gnz); species.push(SHRUB); variant.push(vr); snag.push(0);
        // granite boulders among the brush on the steeper ground (the rules' rocks are skipped inside the box)
        if (slopeDeg > 12 && hash(hq, zq, seed * 7 + 31) < 0.06) { rocks.push(x + 1.5, terrain.heightAt(x + 1.5, z), z, 0.4 + 1.1 * hash(hq, zq, seed * 7 + 32) ** 2, hash(hq, zq, seed * 7 + 33) * Math.PI * 2, 0.45 + 0.4 * hash(hq, zq, seed * 7 + 34)); }
        return;
      }
      const hgt = tops.h[id]; if (hgt < 3.5) return;
      const slim = tops.r[id] / Math.max(hgt, 1);   // crown radius over height: about 0.08 a spire, 0.2 a spreading pine
      let total = 0;
      for (let k = 0; k < TREE_SPECIES.length; k++) {
        const S = TREE_SPECIES[k];
        let w = speciesWeight(S, { elevM: y, elevScale, aspect: gnz, slopeDeg, shoreM: sd });
        const pine = S.crown.shape === 'pine' || S.crown.shape === 'sugar';
        w *= pine ? (slim > 0.13 ? 1.7 : 0.6) : (slim > 0.13 ? 0.6 : 1.5);
        weights[k] = w; total += w;
      }
      if (total <= 0) return;
      let pick = hash(hq, zq, seed * 7 + 4) * total, sp = SPECIES_INDEX[TREE_SPECIES[TREE_SPECIES.length - 1].id];
      for (let k = 0; k < TREE_SPECIES.length; k++) { pick -= weights[k]; if (pick <= 0) { sp = SPECIES_INDEX[TREE_SPECIES[k].id]; break; } }
      const dead = hash(hq, zq, seed * 7 + 8) < R.lidarSnags ? 1 : 0;
      out.push(x, y, z, dead ? hgt * 0.9 : hgt, ph, yaw, gnx, gnz);
      species.push(dead ? SNAG : sp); variant.push(vr); snag.push(dead);
    });
  }
  return {
    count: out.length / TREE_STRIDE, data: new Float32Array(out), species: Uint8Array.from(species), variant: Uint8Array.from(variant),
    snag: Uint8Array.from(snag), logs: new Float32Array(logs), rocks: new Float32Array(rocks), nLogs: logs.length / LOG_STRIDE, nRocks: rocks.length / ROCK_STRIDE,
  };
}
