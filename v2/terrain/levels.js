// The terrain's levels and the stream plan. The data are v1's grids unchanged (terrain/tahoe.json + tahoe-phone.json, the
// .lsh files): five nested, world-anchored north-up grids round Emerald Bay, finest first, each a "slot" the GPU
// samples (v2/render/terrain.js). A slot holds one variant at a time: the phone set's coarser grid first (the bay at 4 m,
// the basin at 20 m, the lake at 128 m, the ring at 384 m), then the full set's grid (2 / 10 / 32 / 96 m) replaces it
// when it lands. Three cover grids (NLCD classes: bay 4 m, basin 10 m, lake 32 m) are the same files in both sets.
// Plain JS, no DOM: main.js, the tests.
//
// The plan (stages are fetched in order; a stage's files in parallel):
//   0 first load, before the first frame (≈ 1.39 MB): the ring and the lake (phone grids), the bay at 4 m, the island
//     at 1 m, the bay's and the lake's cover; the camera's whole view at the start has real land
//   1 the basin (20 m grid + its 10 m cover: Mount Tallac, the walls round the bay)          (the phone set ends here)
//   2 the full grids: the bay at 2 m, the basin at 10 m, the lake at 32 m, the ring at 96 m (desktop; 8.6 MB)
// The shore-distance grids (-d.lsh) are not in the stream: M2's soft shore and beaches come from the height alone. The
// living lake fetches its own (SHORE_LEVELS below) after the first frame, beside stage 2.

import { feature } from '../../src/core/features.js';
export const SLOTS = Object.freeze(['island', 'bay', 'basin', 'lake', 'ring']);   // finest first (the sampler's order)
export const COVER_SLOTS = Object.freeze(['bay', 'basin', 'lake']);               // finest first
export const BLEND = 12;   // texels: a level blends into the next coarser over its last BLEND texels (v1's terrain-data.js)
export const STAGE_OF = Object.freeze({ phone: { island: 0, bay: 0, basin: 1, lake: 0, ring: 0 }, full: { island: null, bay: 2, basin: 2, lake: 2, ring: 2 }, cover: { bay: 0, basin: 1, lake: 0 } });

// a height grid's description from a manifest level: where its texel centres sit (x = x0 + i·step, z = z0 + j·step)
export const heightGrid = (L, variant) => Object.freeze({ kind: 'h', slot: L.name, variant, file: L.height, x0: L.x0, z0: L.z0, step: L.step, w: L.w, h: L.h });
// a cover grid's: the phone manifest names its position (cx0, cz0, cstep); the full one implies it (x0, z0, step · ck)
export const coverGrid = (L) => Object.freeze({ kind: 'c', slot: L.name, variant: 'cover', file: L.cover, x0: L.cx0 ?? L.x0, z0: L.cz0 ?? L.z0, step: L.cstep ?? L.step * L.ck, w: L.cw, h: L.ch });

// The stage list for a variant ('full' streams all three stages; 'phone' stops after stage 1). Every grid once: the
// island is the same file in both sets (its full entry is skipped), and so are the cover grids.
export function streamPlan(full, phone, variant = 'full') {
  const byName = (m) => Object.fromEntries(m.levels.map((L) => [L.name, L]));
  const F = byName(full), P = byName(phone);
  const stages = [[], [], []];
  for (const s of SLOTS) {
    stages[STAGE_OF.phone[s]].push(heightGrid(P[s], 'phone'));
    const fs = STAGE_OF.full[s];
    if (fs != null && F[s].height !== P[s].height) stages[fs].push(heightGrid(F[s], 'full'));
  }
  for (const s of COVER_SLOTS) stages[STAGE_OF.cover[s]].push(coverGrid(F[s]));
  if (variant === 'phone') stages.length = 2;
  for (const st of stages) st.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'h' ? -1 : 1));
  return stages.map((st) => Object.freeze(st));
}

// which set a page streams: v1's rule (src/sim/terrain-data.js terrainVariant): ?terrain=phone|full wins; captures
// (?headless) take the full land; else the registry's terrainSet (src/core/features.js: a phone or a tablet takes the phone set)
export function pickVariant(flags) {
  if (flags.terrain === 'phone' || flags.terrain === 'full') return flags.terrain;
  if (flags.headless != null) return 'full';
  return feature('terrainSet').tier;   // src/core/features.js: a phone or tablet takes the phone set
}

// the file names a build ships (both sets' heights and the cover grids; the shore grids: shoreFiles): v2/vite.config.js copies them
export function shippedFiles(full, phone) {
  const set = new Set();
  for (const m of [full, phone]) for (const L of m.levels) { set.add(L.height); if (L.cover) set.add(L.cover); }
  return [...set].sort();
}

// The living lake's shore-distance grids (v2/sim/lake.js: the kayaks' routes and minds, the birds' places, Cruise): finest
// first, the island's (1 m), the bay's (4 m), then the lake-wide fallbacks, the basin's (20 m) and the lake's (64 m), so
// the lake answers anywhere on the water (each level blends into the next over its last BLEND texels). The same -d.lsh
// files in both sets; a build ships them beside the heights (≈ 835 kB: 318 kB for the island and the bay, 516 kB for the
// basin and the lake). The ring's grid (96 m, all land past the lake grid) is not shipped: the lake grid clamps at its edge.
export const SHORE_LEVELS = Object.freeze(['island', 'bay', 'basin', 'lake']);
export function shoreFiles(manifest) {
  return manifest.levels.filter((L) => SHORE_LEVELS.includes(L.name)).map((L) => L.distance);
}
