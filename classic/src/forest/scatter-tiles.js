// The forest's scatter in streaming tiles. Plain JS: node tests, the bake
// workers and src/trees.js share it.
//
// The scatter's cells are independent (src/trees-scatter.js: a cell's tree, rock or log comes from hashes of its own
// cell index and the terrain there), so a tile of the cell grid (rows × cols) scatters exactly the trees the whole pass
// would put there. A tile is 42 cells a side: 504 m on the bay's 12 m cells, 2,016 m on the rim's 48 m cells.
//
//   scatterTileGrid('bay' | 'rim')     → [{ key, group, ti, tj, rows, cols, rect }]  every tile of that pass
//   tilesNear(tiles, centres, R)        → the tiles within R m of any centre (the start bubble)
//   byTileRow(tiles)                    → [[rows, [tile, …]], …]   jobs share a row band (the towns' mask crop)
//   new ForestStore()                   the resident tiles: add(key, payload), near(x, z, r, fn), canopy blocks
//
// The canopy raster (src/ground-layout.js canopyRaster) is painted per block, a block being one bay tile (504 m = 63
// texels of 8 m). A block's texels take the crowns of every tree whose disc reaches them, in the whole raster's own
// order (the bay's trees by cell row then column, then the island's, then the rim's), so each texel's float sum, and
// its byte, are the same as the whole raster's. A block is painted once every tile within 16 m of it is resident.
import { TREE_RULES, RIM_RULES, TREE_STRIDE, LOG_STRIDE, ROCK_STRIDE, scatterRowCount, scatterColCount } from '../trees-scatter.js';
import { CANOPY } from '../ground-layout.js';
import { SPECIES } from './species.js';
import { rectDist } from '../stream/grid.js';

const TILE_CELLS = 42;
export const GROUPS = { bay: TREE_RULES, rim: RIM_RULES };
const ORDER = { bay: 0, isl: 1, rim: 2 };   // the canopy raster's order: the bay's fine scatter, the island's brush, the rim

const rectsTouch = (a, b, m) => a.x0 - m < b.x1 && b.x0 - m < a.x1 && a.z0 - m < b.z1 && b.z0 - m < a.z1;

export function scatterTileGrid(group) {
  const R = GROUPS[group], nz = scatterRowCount(R), nx = scatterColCount(R), out = [];
  for (let tj = 0; tj * TILE_CELLS < nz; tj++) for (let ti = 0; ti * TILE_CELLS < nx; ti++) {
    const rows = [tj * TILE_CELLS, Math.min(nz, (tj + 1) * TILE_CELLS)], cols = [ti * TILE_CELLS, Math.min(nx, (ti + 1) * TILE_CELLS)];
    const rect = { x0: R.region.x0 + cols[0] * R.cell, x1: R.region.x0 + cols[1] * R.cell, z0: R.region.z0 + rows[0] * R.cell, z1: R.region.z0 + rows[1] * R.cell };
    const ex = R.exclude;
    if (ex && rect.x0 >= ex.x0 && rect.x1 <= ex.x1 && rect.z0 >= ex.z0 && rect.z1 <= ex.z1) continue;   // all inside the bay's own region
    out.push({ key: `${group}:${ti},${tj}`, group, ti, tj, rows, cols, rect });
  }
  return out;
}
export const allScatterTiles = () => [...scatterTileGrid('bay'), ...scatterTileGrid('rim')];
export function tilesNear(tiles, centres, R) { return tiles.filter((t) => centres.some(([x, z]) => rectDist(x, z, t.rect) <= R)); }
export function byTileRow(tiles) {
  const m = new Map();
  for (const t of tiles) { const k = `${t.group}:${t.tj}`; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.values()];
}

// the cell index of a scattered thing, in its pass's own order (row, then column): the whole pass's emission order
function cellKey(group, x, z) {
  if (group === 'isl') { const cell = 4; return (Math.floor(z / cell) + 1000) * 4000 + Math.floor(x / cell) + 1000; }
  const R = GROUPS[group], nx = scatterColCount(R);
  return Math.floor((z - R.region.z0) / R.cell) * (nx + 1) + Math.floor((x - R.region.x0) / R.cell);
}

// the share of the scattered trees a tier keeps (Low: half; owner 2026-10-31, the forest goes first). Kept by a hash of the
// tile and the tree, so the same trees stay on every load; 1 keeps the arrays as they came (High and Balanced)
export const FOREST_KEEP = Object.freeze({ keep: 1 });   // High's; a tier passes its own (new ForestStore(defs, { keep }))
const keepHash = (key, i) => { let h = 2166136261; for (let c = 0; c < key.length; c++) h = Math.imul(h ^ key.charCodeAt(c), 16777619); h = Math.imul(h ^ i, 0x9e3779b1); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
export function thinPayload(p, key, keep = FOREST_KEEP.keep) {
  if (!p || !(keep < 1) || !p.count) return p;
  const idx = []; for (let i = 0; i < p.count; i++) if (keepHash(key, i) < keep) idx.push(i);
  const data = new Float32Array(idx.length * TREE_STRIDE), species = new Uint8Array(idx.length), variant = new Uint8Array(idx.length), snag = new Uint8Array(idx.length);
  idx.forEach((i, j) => { data.set(p.data.subarray(i * TREE_STRIDE, (i + 1) * TREE_STRIDE), j * TREE_STRIDE); species[j] = p.species[i]; variant[j] = p.variant[i]; if (p.snag?.length) snag[j] = p.snag[i]; });
  return { ...p, count: idx.length, data, species, variant, snag };
}

const EMPTY = () => ({ count: 0, data: new Float32Array(0), species: new Uint8Array(0), variant: new Uint8Array(0), snag: new Uint8Array(0), logs: new Float32Array(0), rocks: new Float32Array(0), nLogs: 0, nRocks: 0 });

export class ForestStore {
  constructor(defs = allScatterTiles(), { keep = FOREST_KEEP.keep } = {}) {
    this.keep = keep;                    // the share of the scattered trees kept (the tier's forest.KEEP)
    this.defs = new Map(defs.map((d) => [d.key, d]));
    this.tiles = new Map();              // key → { ...def, ...payload }
    this.counts = { trees: 0, bay: 0, island: 0, rim: 0, logs: 0, rocks: 0 };
  }
  has(key) { return this.tiles.has(key); }
  // payload: a scatterTrees() result for the tile (its arrays in the pass's order)
  add(key, payload, def = this.defs.get(key)) {
    if (this.tiles.has(key)) return this.tiles.get(key);
    const t = { ...def, ...(def?.group === 'isl' ? payload : thinPayload(payload, key, this.keep)) ?? EMPTY() };   // the island's few pines stay whole
    t.order = ORDER[t.group];
    this.tiles.set(key, t);
    this.counts.trees += t.count; this.counts[t.group === 'isl' ? 'island' : t.group] += t.count;
    this.counts.logs += t.nLogs ?? 0; this.counts.rocks += t.nRocks ?? 0;
    return t;
  }
  // every resident tile whose rect is within r m of (x, z)
  *within(x, z, r) { for (const t of this.tiles.values()) if (rectDist(x, z, t.rect) <= r) yield t; }
  complete() { for (const k of this.defs.keys()) if (!this.tiles.has(k)) return false; return true; }

  // --- the canopy raster by block ---
  canopyBlocks() {
    if (this.blocks) return this.blocks;
    const { x0, x1, z0, z1 } = CANOPY.region, cell = CANOPY.cell, W = Math.ceil((x1 - x0) / cell), H = Math.ceil((z1 - z0) / cell);
    const step = TILE_CELLS * TREE_RULES.cell / cell;   // 63 texels a block
    const all = [...this.defs.values()];
    this.blocks = [];
    for (let bj = 0; bj * step < H; bj++) for (let bi = 0; bi * step < W; bi++) {
      const i0 = bi * step, i1 = Math.min(W, (bi + 1) * step), j0 = bj * step, j1 = Math.min(H, (bj + 1) * step);
      const rect = { x0: x0 + i0 * cell, x1: x0 + i1 * cell, z0: z0 + j0 * cell, z1: z0 + j1 * cell };
      const deps = all.filter((d) => rectsTouch(d.rect, rect, 2 * (CANOPY.crownMax + cell))).map((d) => d.key);
      this.blocks.push({ i0, i1, j0, j1, rect, deps, painted: false });
    }
    this.canopyW = W; this.canopyH = H;
    return this.blocks;
  }
  blockReady(b) { return !b.painted && b.deps.every((k) => this.tiles.has(k)) && (!this.islandKey || this.tiles.has(this.islandKey)); }
  // paint one block into data (Uint8Array RG over the canopy region), exactly as canopyRaster would
  paintBlock(b, data, rules = CANOPY) {
    const { x0, z0 } = rules.region, cell = rules.cell, W = this.canopyW;
    const bw = b.i1 - b.i0, bh = b.j1 - b.j0, acc = new Float32Array(bw * bh * 2);
    const src = [];
    for (const key of b.deps) src.push(this.tiles.get(key));
    for (const t of this.tiles.values()) if (t.group === 'isl' && rectsTouch(t.rect, b.rect, 2 * (rules.crownMax + cell))) src.push(t);
    // the trees in the raster's order: by pass, then by cell (row, column), stable within a cell
    const list = [], m = rules.crownMax + 2 * cell, r = b.rect;   // only the trees whose disc can reach the block
    for (const t of src) {
      const d = t.data;
      for (let i = 0; i < t.count; i++) {
        const x = d[i * TREE_STRIDE], z = d[i * TREE_STRIDE + 2];
        if (x < r.x0 - m || x > r.x1 + m || z < r.z0 - m || z > r.z1 + m) continue;
        list.push([t.order, cellKey(t.group, x, z), list.length, t, i]);
      }
    }
    list.sort((a, c) => a[0] - c[0] || a[1] - c[1] || a[2] - c[2]);
    for (const [, , , t, i] of list) {
      const k = i * TREE_STRIDE, x = t.data[k], z = t.data[k + 2], height = t.data[k + 3];
      const shrub = SPECIES[t.species[i]]?.kind === 'shrub';
      const r = shrub ? rules.brushR : Math.min(rules.crownMax, Math.max(rules.crownMin, height * rules.crownK));
      const ch = shrub ? 1 : 0;
      const ci = (x - x0) / cell, cj = (z - z0) / cell, rc = r / cell;
      const ia = Math.max(b.i0, Math.floor(ci - rc)), ib = Math.min(b.i1 - 1, Math.ceil(ci + rc), this.canopyW - 1);
      const ja = Math.max(b.j0, Math.floor(cj - rc)), jb = Math.min(b.j1 - 1, Math.ceil(cj + rc), this.canopyH - 1);
      for (let j = ja; j <= jb; j++) for (let ii = ia; ii <= ib; ii++) {
        const dx = ii + 0.5 - ci, dz = j + 0.5 - cj, q = Math.hypot(dx, dz) / Math.max(rc, 1.0);
        const cov = q < 0.7 ? 1 : q < 1.3 ? (1.3 - q) / 0.6 : 0;
        if (cov > 0) acc[((j - b.j0) * bw + (ii - b.i0)) * 2 + ch] += cov;
      }
    }
    for (let j = b.j0; j < b.j1; j++) for (let i = b.i0; i < b.i1; i++) for (let ch = 0; ch < 2; ch++) {
      data[(j * W + i) * 2 + ch] = Math.min(255, Math.round(255 * Math.min(1, acc[((j - b.j0) * bw + (i - b.i0)) * 2 + ch])));
    }
    b.painted = true;
  }
}
export { TREE_STRIDE, LOG_STRIDE, ROCK_STRIDE };
