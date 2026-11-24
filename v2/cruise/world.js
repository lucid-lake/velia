// What Cruise's navigator and cameras read on a v2 page, made from what v2 already ships:
//   lakeOf({ kayaks, terrain, tBase, manifest, headless })   v1's lake terrain (v2/sim/lake.js: v2's heights + v1's shore-distance
//                                                           grids for the island and the bay): the kayaks' own when the page has
//                                                           them (one load), else loaded here; call once the heights are whole
//   topsFromForest(files)                                   the forest's lidar crowns (v2/forest/data/*.vft, already fetched by the
//                                                           forest) as v1's treetops shape { n, x, z, h, r } for crownSolid
//   loadTops(variant)                                       fetch + inflate + decode them (trees and shrubs; a phone: the trees
//                                                           only, as v1's treetops-phone.tps)
//   chartIn()                                               v1's page chart objects (v2/cruise/chartWorld.json: piers, buoys, the
//                                                           harbour; tools/v2-cruise-bake.mjs)
// v1's crowns (src/forest/crowns.js crownSolid) rasterise them as v1's do; v2's lattice is 0.25 m (v1's file: 0.1 m) and a shrub's
// radius is the forest's own (v2/forest/format.js), so a sight line can differ from v1's by a fraction of the 2 m cell.
import { lakeTerrain, shoreSampler, loadShore } from '../sim/lake.js';
import { inflate, unpredict } from '../terrain/decode.js';
import { decodeForest, unpackBits } from '../forest/format.js';
import { chartInputs } from './chartRows.js';

export async function lakeOf({ kayaks = null, terrain, tBase, manifest }) {
  if (kayaks?.lakeReady) { try { const L = await kayaks.lakeReady(); if (L) return L; } catch { /* load our own below */ } }
  const shore = await loadShore({ base: tBase, manifest, decode: (bytes, w, h) => inflate(bytes).then((p) => unpredict(p, w, h)) });
  return lakeTerrain({ height: (x, z) => terrain.field.height(x, z), distance: shoreSampler(shore.levels).distance });
}

// decoded forest files → { n, x, z, h, r } (Float32Arrays), v1's treetops shape
export function topsFromForest(files) {
  const n = files.reduce((a, f) => a + f.n, 0);
  const x = new Float32Array(n), z = new Float32Array(n), h = new Float32Array(n), r = new Float32Array(n);
  let o = 0;
  for (const f of files) {
    const fl = new Float32Array(f.inst.buffer, f.inst.byteOffset, f.inst.length);
    for (let i = 0; i < f.n; i++, o++) { const b = unpackBits(f.inst[4 * i + 3]); x[o] = fl[4 * i]; z[o] = fl[4 * i + 1]; h[o] = b.h; r[o] = b.r; }
  }
  return { n, x, z, h, r };
}

const FOREST = { trees: new URL('../forest/data/trees.vft', import.meta.url).href, shrubs: new URL('../forest/data/shrubs.vft', import.meta.url).href };
export async function loadTops(variant = 'full') {
  const names = variant === 'phone' ? ['trees'] : ['trees', 'shrubs'];
  const files = await Promise.all(names.map(async (k) => {
    const res = await fetch(FOREST[k]); if (!res.ok) throw new Error(`${k}.vft: ${res.status}`);
    return decodeForest(await inflate(new Uint8Array(await res.arrayBuffer())));
  }));
  return topsFromForest(files);
}

let chartWorld = null;
export async function chartIn() {
  chartWorld ??= import('./chartWorld.json').then((m) => chartInputs(m.default ?? m));
  return chartWorld;
}
