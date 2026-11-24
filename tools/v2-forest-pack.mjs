// v2's forest data (M5b): v1's lidar forest exactly as v1 places it, re-packed small for v2.
//   node tools/v2-forest-pack.mjs   → v2/forest/data/trees.vft (gzip) + v2/forest/data/shrubs.vft (gzip) + a summary line
// Source: terrain/forest/treetops.tps (USGS 3DEP CA_SierraNevada_5_2022 first returns, public domain; tools/ground/
// lidar_ept.py, build_lidar.py; ATTRIBUTION.md). The placement is v1's own: src/trees-scatter.js scatterTrees() over the
// bay box with the lidar on (its lidar branch: a crown on land ≥ 1 m above the lake and ≥ 2 m from the shore, never on
// snow, a beach or water, out of the keep-outs; a tree ≥ 3.5 m; the species from the spot and the crown's slimness; 5 %
// snags; the brush class's shrubs at v1's drawn height). The crown radius comes from the file (v1 draws a crown from its
// species instead). Format: v2/forest/format.js. Deterministic: the same inputs give the same bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { decodeTops, setTops, TOPS } from '../classic/src/forest/treetops.js';
import { scatterTrees, TREE_RULES, TREE_STRIDE } from '../classic/src/trees-scatter.js';
import { SPECIES } from '../classic/src/forest/species.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { encodeForest, LAYER_OF_V1, BOX } from '../v2/forest/format.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'v2/forest/data');

export async function packForest() {
  const b = readFileSync(resolve(ROOT, 'terrain/forest/treetops.tps'));
  const tops = decodeTops(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  setTops(tops);
  // the crown radius by position (the scatter returns the position and height, not the radius)
  const rAt = new Map();
  for (let i = 0; i < tops.n; i++) rAt.set(`${tops.x[i]},${tops.z[i]}`, tops.r[i]);
  const terrain = makeTerrain({ seed: 1 });
  if (BOX.x0 !== TOPS.box.x0 || BOX.z1 !== TOPS.box.z1) throw new Error('v2 forest box differs from v1\'s');
  const s = scatterTrees(terrain, { seed: 1, rules: { ...TREE_RULES, region: { ...TOPS.box } } });
  const trees = [], shrubs = [];
  for (let i = 0; i < s.count; i++) {
    const k = i * TREE_STRIDE, x = s.data[k], z = s.data[k + 2], h = s.data[k + 3], sp = s.species[i];
    const r = rAt.get(`${x},${z}`);
    if (r == null) throw new Error(`no lidar crown at ${x}, ${z}`);   // the rules' own cells are all inside the box: skipped
    if (SPECIES[sp].kind === 'shrub') shrubs.push({ x, z, h, r: 0, layer: LAYER_OF_V1[sp] });
    else trees.push({ x, z, h, r: Math.max(0.6, r), layer: LAYER_OF_V1[sp] });
  }
  const t = gzipSync(encodeForest(trees, { kind: 0 }), { level: 9 }), sh = gzipSync(encodeForest(shrubs, { kind: 1 }), { level: 9 });
  return { trees, shrubs, files: { 'trees.vft': t, 'shrubs.vft': sh }, src: b.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = await packForest();
  mkdirSync(OUT, { recursive: true });
  for (const [f, bytes] of Object.entries(p.files)) writeFileSync(resolve(OUT, f), bytes);
  const per = new Array(7).fill(0); for (const r of p.trees) per[r.layer]++;
  console.log(`trees ${p.trees.length} (${(p.files['trees.vft'].length / 1e3).toFixed(0)} kB) per layer ${per.join('/')}; shrubs ${p.shrubs.length} (${(p.files['shrubs.vft'].length / 1e3).toFixed(0)} kB); v1's file ${(p.src / 1e6).toFixed(2)} MB`);
}
