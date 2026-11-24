// The ground photo's tiles (M5c, v2/terrain/photo.js and the cut set in v2/photo): the two sets match v1's photo layout,
// every tile of every level exists with the manifest's bytes, the full set stays inside the 4 MB budget, the tiles cover
// each level exactly once, the stream order is nearest-the-eye first and deterministic, and the first tiles from v1's
// cam I hold the island's ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHOTO_SETS, LAYER, TILE, BUDGET_BYTES, tilesOf, tileFile, textureSize, streamOrder, nearTiles, tileDist2 } from '../terrain/photo.js';
import { NAIP_EXTENT, NAIP_FILES, NAIP_ALPHA } from '../../src/naip-layout.js';
import { cameraPose } from '../engine/camera.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHOTO = resolve(ROOT, 'v2/photo');
const manifest = JSON.parse(readFileSync(resolve(PHOTO, 'manifest.json'), 'utf8'));

test('the sets are v1\'s photo levels: the bay at 2 / 4 m, the region at 32 / 64 m, their extents and sizes', () => {
  for (const [set, texels] of [['full', { bay: 2, region: 32 }], ['phone', { bay: 4, region: 64 }]]) {
    for (const name of ['bay', 'region']) {
      const L = PHOTO_SETS[set][name], [file, w, h] = NAIP_FILES[name][texels[name]], E = NAIP_EXTENT[name];
      assert.equal(L.texel, texels[name]); assert.equal(L.file, file); assert.equal(L.w, w); assert.equal(L.h, h);
      assert.equal(L.x0, E.x0); assert.equal(L.z0, E.z0);
      assert.ok(Math.abs((E.x1 - E.x0) / L.texel - w) < 1e-9 && Math.abs((E.z1 - E.z0) / L.texel - h) < 1e-9, `${set}/${name}: the extent is w × h texels`);
      const m = manifest.sets[set].levels[name];
      assert.equal(m.w, w); assert.equal(m.h, h); assert.equal(m.texel, L.texel); assert.equal(m.tiles, tilesOf(L).length);
      assert.ok(m.alpha[0] >= NAIP_ALPHA.base, `${set}/${name}: every texel's alpha ≥ 64 (the shader's landed flag)`);
    }
  }
  assert.equal(LAYER.bay, 0); assert.equal(LAYER.region, 1); assert.equal(TILE, 256);
  assert.deepEqual(textureSize(PHOTO_SETS.full), [2816, 1920]); assert.deepEqual(textureSize(PHOTO_SETS.phone), [1408, 960]);
});

test('every tile exists with the manifest\'s bytes; the full set is 2–4 MB, the phone set under 1.5 MB', () => {
  for (const set of ['full', 'phone']) {
    let total = 0;
    for (const name of ['bay', 'region']) {
      const L = PHOTO_SETS[set][name], m = manifest.sets[set].levels[name];
      let bytes = 0;
      for (const t of tilesOf(L)) {
        const f = resolve(PHOTO, tileFile(set, name, t.tx, t.ty));
        assert.ok(existsSync(f), `missing ${f}`);
        const b = statSync(f).size; assert.equal(b, m.files[`${t.tx}-${t.ty}`], `${f}: the manifest's bytes`); bytes += b;
        assert.ok(b > 200 && b < 120000, `${f}: ${b} B`);
      }
      assert.equal(bytes, m.bytes); total += bytes;
    }
    assert.equal(total, manifest.sets[set].bytes);
    if (set === 'full') assert.ok(total <= BUDGET_BYTES && total >= 2 * 1048576, `full set ${(total / 1048576).toFixed(2)} MB`);
    else assert.ok(total <= 1.5 * 1048576, `phone set ${(total / 1048576).toFixed(2)} MB`);
  }
});

test('the tiles cover a level exactly once: 256² inside, partial at the last column and row, no overlap, no hole', () => {
  for (const set of Object.values(PHOTO_SETS)) for (const L of Object.values(set)) {
    const ts = tilesOf(L);
    const cols = Math.ceil(L.w / TILE), rows = Math.ceil(L.h / TILE);
    assert.equal(ts.length, cols * rows);
    let area = 0; const seen = new Set();
    for (const t of ts) {
      assert.ok(t.w >= 1 && t.w <= TILE && t.h >= 1 && t.h <= TILE);
      assert.equal(t.px, t.tx * TILE); assert.equal(t.py, t.ty * TILE);
      assert.ok(t.px + t.w <= L.w && t.py + t.h <= L.h);
      if (t.tx < cols - 1) assert.equal(t.w, TILE); if (t.ty < rows - 1) assert.equal(t.h, TILE);
      assert.ok(!seen.has(`${t.tx}-${t.ty}`)); seen.add(`${t.tx}-${t.ty}`);
      area += t.w * t.h;
      assert.ok(Math.abs(t.x0 - (L.x0 + t.px * L.texel)) < 1e-9 && Math.abs(t.x1 - t.x0 - t.w * L.texel) < 1e-9, 'the world box follows the pixels');
    }
    assert.equal(area, L.w * L.h, 'the tiles sum to the level');
  }
});

test('the stream order: the bay nearest the eye first, then the region nearest first; every tile once; deterministic', () => {
  for (const flags of [{ cam: 'I' }, { cam: 'A' }, { cam: 'B' }, { campos: '1200,3,-1050', camlook: '900,40,-1150' }]) {
    const p = cameraPose(flags), set = PHOTO_SETS.full;
    const o1 = streamOrder(set, p.eye[0], p.eye[2]), o2 = streamOrder(set, p.eye[0], p.eye[2]);
    assert.deepEqual(o1.map((t) => `${t.level}:${t.tx}-${t.ty}`), o2.map((t) => `${t.level}:${t.tx}-${t.ty}`), 'the same order twice');
    assert.equal(o1.length, tilesOf(set.bay).length + tilesOf(set.region).length);
    const firstRegion = o1.findIndex((t) => t.level === 'region');
    assert.equal(firstRegion, tilesOf(set.bay).length, 'the bay before the region');
    for (const level of ['bay', 'region']) {
      const ts = o1.filter((t) => t.level === level);
      for (let i = 1; i < ts.length; i++) assert.ok(ts[i - 1].d2 <= ts[i].d2 + 1e-9, `${level}: nearest first`);
      assert.equal(new Set(ts.map((t) => `${t.tx}-${t.ty}`)).size, ts.length, 'every tile once');
      assert.ok(ts.every((t) => t.layer === LAYER[level]));
    }
    assert.equal(o1[0].d2, 0, 'the first tile holds the eye\'s spot');
    const near = nearTiles(o1, p.eye[0], p.eye[2], 1500);
    assert.ok(near.every((t) => t.level === 'region' || tileDist2(t, p.eye[0], p.eye[2]) <= 1500 * 1500));
    assert.equal(near.filter((t) => t.level === 'region').length, tilesOf(set.region).length, 'every region tile is near (the far shores)');
  }
  // from cam I the first bay tile holds Fannette Island's summit (the origin)
  const pI = cameraPose({ cam: 'I' }), first = streamOrder(PHOTO_SETS.full, pI.eye[0], pI.eye[2])[0];
  assert.ok(first.x0 <= 0 && 0 <= first.x1 && first.z0 <= 0 && 0 <= first.z1, `the first tile (${first.tx}-${first.ty}) holds the island`);
});
