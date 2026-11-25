// The forest's LOD and its per-frame tile pick (M5b). Plain JS, no DOM: render/forest.js and the node tests.
//
// Three sources of trees, all in world-anchored tiles:
//   lidar   v1's real crowns in the bay box (v2/forest/format.js): 64 m tiles, the trees' and the shrubs' ranges
//   region  the rules' trees round the box (v2/forest/scatter.js, on the GPU): 256 m tiles of 20 × 20 cells of 12.8 m, a
//           fixed slot a cell (an empty slot is flagged invalid), out to v1's TREE_RULES.region (≈ 5–6 km from the bay)
//   (past `far`: the terrain's canopy layer, T3: render/canopy.js splats these same trees into a grid the terrain draws)
// Per frame the CPU picks the tiles in range and in the frustum (≈ 7 k box tests, ≤ 0.15 ms) and writes their
// (first, count, source) records; the GPU culls every instance of those tiles (render/forest.js CULL_WGSL) with the
// rule below, and draws the survivors with one indirect draw.
//
// The rule (the cull's, mirrored by keepAt for the tests): past `thin` m a tree is kept when its hash < (thin / d)² and
// drawn up to wmax × wider (v1's THIN: the cover holds while the count falls); from `fade` to `far` the kept share falls
// to 0 (a dither per tree, so no ring pops); shrubs to `shrubFar` (their last 30 % faded); a card under a pixel tall is
// dropped. The terrain shows the forest floor where trees are drawn and blends to the canopy layer as they thin
// (render/terrain.js forestNear), so the slope's tone holds from the boat to the far shore.
// T3: the cards thin sooner (thin 2,500 → 2,000 m desktop, 1,200 → 1,000 m phone: the canopy takes the
// share they leave, so the far slopes' wallpaper goes) and end sooner (desktop fade / far 6,000 / 8,000 → 3,500 / 5,000 m, phone 3,500 / 4,500 →
// 2,000 / 2,800 m) and widen less (wmax 2 → 1.5: fewer equal blobs); the canopy carries the far forest.
export const FOREST = Object.freeze({
  desktop: Object.freeze({ thin: 2000, fade: 3500, far: 5000, wmax: 1.5, shrubFar: 450, cap: 262144, frame: [128, 256], shrubs: true }),
  phone: Object.freeze({ thin: 1000, fade: 2000, far: 2800, wmax: 1.5, shrubFar: 0, cap: 65536, frame: [64, 128], shrubs: false }),
});
export const SOURCE = Object.freeze({ trees: 0, shrubs: 1, region: 2 });
export const MAX_TILES = 8192;
// the rules' region: v1's TREE_RULES.region (−4500..5900, −6000..5700) on a 256 m grid that the bay box's edges fall on
export const REGION = Object.freeze({ x0: -4608, z0: -6144, tile: 256, tw: 41, th: 47, n: 20, cell: 12.8 });
export const REGION_SLOTS = REGION.tw * REGION.th * REGION.n * REGION.n;
// The rules' region follows the start's detail level (South Lake's look): a page that starts on a region level (v2/terrain/
// region.js) scatters the rules' trees over a box of the same tile count round that shore, so the slot count, the instance
// buffer and the scatter's dispatch are the bay's to the byte; the bay's region is unchanged. A start in the bay (or anywhere
// without a level) keeps REGION. south: Camp Richardson's east edge to Heavenly's summit (x 6,656 to 17,152, z −6,144 to 5,888).
// The south's desktop cells are finer (28 a tile, 9.14 m: 1.96 × the slots, a 24 MB instance buffer): Heavenly's face is the hero
// view at 1.5–4 km, where the lidar's 305 trees a hectare round the bay read as a forest and 12.8 m cells read as dots on a
// green wall; a phone keeps the bay's 20 (its reach ends at 2.8 km, its memory is the tighter budget).
export const REGIONS = Object.freeze({   // by the level's key (v2/terrain/region.js levelKeyOfBirth: the region's id, or 'bay')
  bay: REGION,
  'south-lake': Object.freeze({ x0: 6656, z0: -6144, tile: 256, tw: 41, th: 47, n: 28, cell: 256 / 28 }),
});
const PHONE_N = 20;
export const forestRegion = (levelKey, variant = 'full') => {
  const R = REGIONS[levelKey] ?? REGION;
  return variant === 'phone' && R.n !== PHONE_N ? Object.freeze({ ...R, n: PHONE_N, cell: R.tile / PHONE_N }) : R;
};
export const regionSlots = (R = REGION) => R.tw * R.th * R.n * R.n;
export const TREE_TOP = 60;    // m: the tallest crown a tile's box allows above its ground (lidar max 59 m)

// the cull's per-tree rule at distance d (m) from the eye; u: the tree's hash in [0, 1). → widen (> 0: drawn), or 0
export function keepAt(d, u, L, shrub = false) {
  if (shrub) { if (d >= L.shrubFar) return 0; const f = (L.shrubFar - d) / (0.3 * L.shrubFar); return u < f ? 1 : 0; }
  if (d >= L.far) return 0;
  let keep = d > L.thin ? (L.thin / d) ** 2 : 1;
  const widen = Math.min(L.wmax, 1 / Math.sqrt(keep));
  if (d > L.fade) keep *= 1 - (d - L.fade) / (L.far - L.fade);
  return u < keep ? widen : 0;
}
// the share of the ground the drawn cards still cover at d (relative to near): the terrain's floor ↔ canopy weight
export function coverNear(d, L) {
  if (d >= L.far) return 0;
  const k = d > L.thin ? (L.thin / d) ** 2 : 1;
  const c = Math.min(1, k * Math.min(L.wmax, 1 / Math.sqrt(k)));   // the cards widen, they do not grow taller
  return d > L.fade ? c * (1 - (d - L.fade) / (L.far - L.fade)) : c;
}

// the tile picker. sources: { trees, shrubs } decoded files (v2/forest/format.js; either may be null) and region (bool:
// the GPU scatter has run). ground(x0, z0, x1, z1, out) → out = [lo, hi] (m) of the terrain over a box, or lo > hi
// when no grid holds it. Returns { out (Uint32Array MAX_TILES × 4), count, pick(eye, planes) → count, tested }
// offsets: where the shrubs and the region's slots start in the one instance buffer (render/forest.js CAP); region: the rules'
// box (REGION, or the start level's: forestRegion)
export function createTilePicker({ L, ground, boxInFrustum, offsets = { shrubs: 0, region: 0 }, region = REGION }) {
  const out = new Uint32Array(MAX_TILES * 4), gb = new Float64Array(2);
  const src = { trees: null, shrubs: null, region: false };
  let count = 0, tested = 0, overflow = 0;
  let far2 = 0, shrub2 = 0;   // read from L at each pick (a quality level may change the reach live)
  function push(first, n, s) { if (count >= MAX_TILES) { overflow++; return; } const o = count * 4; out[o] = first; out[o + 1] = n; out[o + 2] = s; out[o + 3] = 0; count++; }
  function d2box(ex, ez, x0, z0, x1, z1) { const dx = ex < x0 ? x0 - ex : ex > x1 ? ex - x1 : 0, dz = ez < z0 ? z0 - ez : ez > z1 ? ez - z1 : 0; return dx * dx + dz * dz; }
  return {
    out, src,
    get count() { return count; }, get tested() { return tested; }, get overflow() { return overflow; },
    pick(eye, planes) {
      count = 0; tested = 0; overflow = 0;
      far2 = L.far * L.far; shrub2 = L.shrubFar * L.shrubFar;
      const ex = eye[0], ez = eye[2];
      const lid = src.trees ?? src.shrubs;
      if (lid) {
        const { x0, z0, tile, tw, th } = lid, T = src.trees, S = src.shrubs;
        // only the tile rows and columns within `far` of the eye
        const i0 = Math.max(0, Math.floor((ex - L.far - x0) / tile)), i1 = Math.min(tw - 1, Math.floor((ex + L.far - x0) / tile));
        const j0 = Math.max(0, Math.floor((ez - L.far - z0) / tile)), j1 = Math.min(th - 1, Math.floor((ez + L.far - z0) / tile));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = j * tw + i, nt = T ? T.start[k + 1] - T.start[k] : 0, ns = S ? S.start[k + 1] - S.start[k] : 0;
          if (!nt && !ns) continue;
          const bx0 = x0 + i * tile, bz0 = z0 + j * tile, d2 = d2box(ex, ez, bx0, bz0, bx0 + tile, bz0 + tile);
          if (d2 > far2) continue;
          ground(bx0, bz0, bx0 + tile, bz0 + tile, gb);
          if (!(gb[0] <= gb[1])) continue;
          tested++;
          if (!boxInFrustum(planes, bx0, gb[0] - 1, bz0, bx0 + tile, gb[1] + TREE_TOP, bz0 + tile)) continue;
          if (nt) push(T.start[k], nt, SOURCE.trees);
          if (ns && d2 < shrub2) push(S.start[k] + offsets.shrubs, ns, SOURCE.shrubs);
        }
      }
      if (src.region) {
        const R = region, per = R.n * R.n, base = offsets.region;
        const i0 = Math.max(0, Math.floor((ex - L.far - R.x0) / R.tile)), i1 = Math.min(R.tw - 1, Math.floor((ex + L.far - R.x0) / R.tile));
        const j0 = Math.max(0, Math.floor((ez - L.far - R.z0) / R.tile)), j1 = Math.min(R.th - 1, Math.floor((ez + L.far - R.z0) / R.tile));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const bx0 = R.x0 + i * R.tile, bz0 = R.z0 + j * R.tile;
          if (inBox(bx0 + 1, bz0 + 1)) continue;   // the lidar's own tiles
          if (d2box(ex, ez, bx0, bz0, bx0 + R.tile, bz0 + R.tile) > far2) continue;
          ground(bx0, bz0, bx0 + R.tile, bz0 + R.tile, gb);
          if (!(gb[0] <= gb[1]) || gb[1] < 2.5) continue;   // no data, or all lake: no rule tree stands there
          tested++;
          if (!boxInFrustum(planes, bx0, gb[0] - 1, bz0, bx0 + R.tile, gb[1] + TREE_TOP, bz0 + R.tile)) continue;
          push(base + (j * R.tw + i) * per, per, SOURCE.region);
        }
      }
      return count;
    },
  };
}
// the bay box (v2/forest/format.js BOX): the lidar's; the rules stay out of it
const BX = { x0: -2304, z0: -1792, x1: 3328, z1: 1792 };
export const inBox = (x, z) => x >= BX.x0 && x < BX.x1 && z >= BX.z0 && z < BX.z1;
