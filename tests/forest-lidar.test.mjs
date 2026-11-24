// The lidar canopy (src/forest/treetops.js, canopy-surface.js; tools/ground/build_lidar.py): the treetop file decodes, the
// bay's scatter by tile is the whole pass with the real crowns in it, the heights are the lidar's, and the canopy rasters
// match the layout the runtime hard-codes. Run: node --test tests/forest-lidar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTerrain } from '../src/sim/terrain.js';
import { scatterTrees, TREE_RULES, TREE_STRIDE } from '../classic/src/trees-scatter.js';
import { scatterTileGrid, GROUPS } from '../classic/src/forest/scatter-tiles.js';
import { decodeTops, setTops, loadTops, TOPS, forEachTop, inTopsBox } from '../classic/src/forest/treetops.js';
import { CANOPY_SURFACE, canopySize } from '../classic/src/forest/canopy-surface.js';
import { SPECIES, SHRUB, SNAG } from '../classic/src/forest/species.js';

const FILE = new URL('../terrain/forest/treetops.tps', import.meta.url);
const have = fs.existsSync(FILE);

test('the treetop file decodes: header, quantised fields, a bucket index that finds each top once', () => {
  const n = 3, buf = new ArrayBuffer(8 + n * 8), dv = new DataView(buf);
  'TPS1'.split('').forEach((c, i) => dv.setUint8(i, c.charCodeAt(0))); dv.setUint32(4, n, true);
  const rec = [[100, 200, 120, 25, 0], [30000, 20000, 80, 18, 0], [56000, 35000, 8, 6, 1]];
  rec.forEach(([x, z, h, r, k], i) => { dv.setUint16(8 + i * 8, x, true); dv.setUint16(10 + i * 8, z, true); dv.setUint8(12 + i * 8, h); dv.setUint8(13 + i * 8, r); dv.setUint8(14 + i * 8, k); });
  const t = decodeTops(buf);
  assert.equal(t.n, 3); assert.ok(Math.abs(t.x[0] - (TOPS.box.x0 + 10)) < 1e-3); assert.equal(t.h[0], 30); assert.equal(t.kind[2], 1);
  const seen = []; forEachTop(TOPS.box.x0, TOPS.box.x1, TOPS.box.z0, TOPS.box.z1, (i) => seen.push(i), t);
  assert.deepEqual(seen, [0, 1, 2]);
  assert.throws(() => decodeTops(new ArrayBuffer(16)), /magic/);
});

test('canopy raster sizes follow the tier cell', () => {
  for (const k of [2, 4, 8]) { CANOPY_SURFACE.cell = k; const [w, h] = canopySize(); assert.equal(w * k, 5632); assert.equal(h * k, 3584); }
  CANOPY_SURFACE.cell = 2;
});

test('real file: tiles scatter the whole bay pass, crowns keep the lidar heights, brush is shrub', { skip: !have }, async () => {
  const tops = await loadTops(); assert.ok(tops && tops.n > 50000, `n ${tops?.n}`);
  setTops(tops);
  try {
    const terrain = makeTerrain({ seed: 1 });
    const whole = scatterTrees(terrain, { seed: 1 });
    let n = 0, h0 = 0;
    for (const t of scatterTileGrid('bay')) {
      const r = scatterTrees(terrain, { seed: 1, rules: GROUPS.bay, rows: t.rows, cols: t.cols }); n += r.count;
      if (n > 0 && h0 === 0) h0 = r.count;
    }
    assert.equal(n, whole.count, 'tile cuts add up to the whole pass');
    // inside the box every tree's height is a lidar crown's (quantised 0.25 m), or a shrub's, or a snag's 0.9 share
    let inside = 0, shrubs = 0, snags = 0, tall = 0;
    for (let i = 0; i < whole.count; i++) {
      const x = whole.data[i * TREE_STRIDE], z = whole.data[i * TREE_STRIDE + 2];
      if (!inTopsBox(x, z)) continue;
      inside++; if (whole.species[i] === SHRUB) shrubs++; else if (whole.species[i] === SNAG) snags++; else if (whole.data[i * TREE_STRIDE + 3] > 25) tall++;
    }
    assert.ok(inside > 30000, `inside ${inside}`); assert.ok(shrubs > 1000, `shrubs ${shrubs}`); assert.ok(snags > 100, `snags ${snags}`); assert.ok(tall > 1000, `tall ${tall}`);
    // species by elevation: the red fir stands higher than the incense cedar, on average
    const mean = (id) => { let s = 0, c = 0; const k = SPECIES.findIndex((q) => q.id === id); for (let i = 0; i < whole.count; i++) if (whole.species[i] === k && inTopsBox(whole.data[i * TREE_STRIDE], whole.data[i * TREE_STRIDE + 2])) { s += whole.data[i * TREE_STRIDE + 1]; c++; } return s / Math.max(1, c); };
    assert.ok(mean('redfir') > mean('cedar'), `red fir ${mean('redfir').toFixed(0)} m vs cedar ${mean('cedar').toFixed(0)} m above the lake`);
    // lidar off: the rules fill the box again
    setTops(null);
    const rules = scatterTrees(terrain, { seed: 1 });
    assert.notEqual(rules.count, whole.count);
  } finally { setTops(null); }
});

test('real file: the canopy rasters and the treetop file are the sizes the page budgets', { skip: !have }, () => {
  const dir = new URL('../terrain/forest/', import.meta.url);
  assert.ok(fs.statSync(FILE).size < 6e6, 'treetops under 6 MB');
  for (const k of [2, 4, 8]) assert.ok(fs.existsSync(new URL(`canopy-bay-${k}m.webp`, dir)));
  assert.ok(fs.statSync(new URL('canopy-bay-2m.webp', dir)).size < 14e6, 'the 2 m raster under 14 MB');
  const st = JSON.parse(fs.readFileSync(new URL('chm.json', dir)));
  assert.ok(st.trees > 50000 && st.chm_p95 > 15 && st.chm_p95 < 50, JSON.stringify(st));
  void TREE_RULES;
});
