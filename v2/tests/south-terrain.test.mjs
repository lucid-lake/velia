// The south region's data (terrain/south/: tools/terrain/build_tahoe.py --region south, tools/ground/build_naip.py
// --levels south, tools/v2-photo-tiles.mjs --region south). Not wired into the loader yet: these tests read the files
// alone. They check the manifests against the files (names, sizes, grid shapes), the load budget, the lake-wide frame
// and codes, the depth at the Ski Run pin and in the deep water, and that the 4 m heights meet the shipped 10 m and 32 m
// levels where they overlap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflate, unpredict, metres } from '../terrain/decode.js';
import { tilesOf, tileFile, TILE } from '../terrain/photo.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (...p) => resolve(ROOT, 'terrain', ...p);
const S = (f) => T('south', f);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lake = json(T('tahoe.json'));
const full = json(S('south.json')), phone = json(S('south-phone.json')), photo = json(S('photo/manifest.json'));
const size = (p) => statSync(p).size;

// a decoded height level (metres) and a clamped bilinear read at world (x, z), as the sampler's
async function heights(dir, L, H) {
  const q = unpredict(await inflate(readFileSync(resolve(dir, L.height))), L.w, L.h);
  const m = new Float32Array(q.length); for (let i = 0; i < q.length; i++) m[i] = metres(q[i], H);
  return { L, m, at(x, z) {
    const fx = Math.min(Math.max((x - L.x0) / L.step, 0), L.w - 1), fz = Math.min(Math.max((z - L.z0) / L.step, 0), L.h - 1);
    const i = Math.min(Math.floor(fx), L.w - 2), j = Math.min(Math.floor(fz), L.h - 2), u = fx - i, v = fz - j, k = j * L.w + i;
    return (m[k] * (1 - u) + m[k + 1] * u) * (1 - v) + (m[k + L.w] * (1 - u) + m[k + L.w + 1] * u) * v;
  } };
}
const south = heights(T('south'), full.levels[0], full.height);
const southPhone = heights(T('south'), phone.levels[0], phone.height);
const byName = Object.fromEntries(lake.levels.map((L) => [L.name, L]));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

test('the south manifests: the lake-wide frame and codes, the box, the grid shapes', () => {
  for (const M of [full, phone]) {
    assert.equal(M.proj, lake.proj); assert.equal(M.y0, lake.y0);
    assert.deepEqual(M.height, lake.height); assert.deepEqual(M.distance, lake.distance);
    assert.deepEqual(M.box, { x0: 6992, z0: -1504, x1: 14512, z1: 3008 });
    assert.equal(M.levels.length, 1); assert.equal(M.levels[0].name, 'south');
  }
  const L = full.levels[0], P = phone.levels[0];
  // the box holds the plan's (x 7,000 to 14,500, z -1,500 to 3,000), texel edges on the box
  assert.ok(full.box.x0 <= 7000 && full.box.x1 >= 14500 && full.box.z0 <= -1500 && full.box.z1 >= 3000);
  assert.deepEqual([L.step, L.x0, L.z0, L.w, L.h], [4, 6994, -1502, 1880, 1128]);
  assert.deepEqual([P.step, P.x0, P.z0, P.w, P.h], [8, 6996, -1500, 940, 564]);
  assert.deepEqual([L.dk, L.dw, L.dh, L.ck, L.cw, L.ch], [1, 1880, 1128, 2, 940, 564]);
  assert.deepEqual([P.dk, P.dw, P.dh, P.dstep, P.cstep], [2, 940, 564, 8, 8]);
  assert.equal(P.cover, L.cover);   // the cover grid is shared
});

test('the south files: present, the manifests\' bytes, inside the load budget', async () => {
  const bytes = (M) => { const L = M.levels[0]; return [L.height, L.distance, L.cover].reduce((s, f) => s + size(S(f)), 0); };
  assert.equal(bytes(full), full.bytes); assert.equal(bytes(phone), phone.bytes);
  // every grid inflates to its declared shape (heights and distance: 2 bytes a texel; cover: 1)
  for (const M of [full, phone]) {
    const L = M.levels[0];
    assert.equal((await inflate(readFileSync(S(L.height)))).length, 2 * L.w * L.h, L.height);
    assert.equal((await inflate(readFileSync(S(L.distance)))).length, 2 * L.dw * L.dh, L.distance);
    assert.equal((await inflate(readFileSync(S(L.cover)))).length, L.cw * L.ch, L.cover);
  }
  // the photo tiles: the manifest's grid, every tile on disk at its listed size, nothing extra
  let photoBytes = {};
  for (const [set, texel] of [['full', 4], ['phone', 8]]) {
    const P = photo.sets[set].levels.south;
    assert.equal(P.texel, texel); assert.equal(photo.tile, TILE);
    assert.deepEqual([P.x0, P.z0, P.w * texel, P.h * texel], [6992, -1504, 7520, 4512]);
    const tiles = tilesOf({ ...P, texel });
    assert.equal(tiles.length, P.tiles);
    let sum = 0;
    for (const t of tiles) { const n = size(T('south', 'photo', tileFile(set, 'south', t.tx, t.ty))); assert.equal(n, P.files[`${t.tx}-${t.ty}`]); sum += n; }
    assert.equal(sum, P.bytes);
    assert.equal(readdirSync(T('south', 'photo', set, 'south')).length, P.tiles);
    assert.deepEqual(P.alpha, [64, 255]);   // the class index rides in alpha, as the lake-wide tiles'
    photoBytes[set] = sum;
  }
  // the plan's budget: desktop about 2.5 MB in all, phones about 0.7 MB (kept under 2.6 MB and 0.8 MB)
  assert.ok(full.bytes + photoBytes.full < 2.6e6, `desktop ${full.bytes + photoBytes.full} B`);
  assert.ok(phone.bytes + photoBytes.phone < 0.8e6, `phone ${phone.bytes + photoBytes.phone} B`);
});

test('known depths: the Ski Run pin, the survey\'s deep water, the town on land', async () => {
  const H = await south, P = await southPhone;
  // the pin 650 m off Ski Run Marina's pier: 17.4 m (the survey's edge depth carried into its gap); the same spot on
  // the 32 m level reads 17.6 m. 800 m due north of the pier the survey gives 22-23 m.
  assert.ok(Math.abs(H.at(12000, -250) + 17.4) < 0.3, `pin ${H.at(12000, -250)}`);
  assert.ok(Math.abs(H.at(12211, -437) + 22.9) < 0.5, `north of the pier ${H.at(12211, -437)}`);
  // DDS-55 surveyed cells (the bed = the survey's elevation - 1,899 m): 2 km off Pope Beach, 3.5 km off the Keys
  assert.ok(Math.abs(H.at(9000, -1000) + 198.5) < 0.5, `${H.at(9000, -1000)}`);
  assert.ok(Math.abs(H.at(8000, -1400) + 317.4) < 0.5, `${H.at(8000, -1400)}`);
  // land: the casino corner at Stateline and the slope under Heavenly stand above the lake
  for (const [x, z] of [[14000, 1500], [13500, 2500]]) assert.ok(H.at(x, z) > 2, `land at ${x}, ${z}: ${H.at(x, z)}`);
  // the phone set agrees with the desktop set (block means) within a metre on the water away from the shore
  for (const [x, z] of [[12000, -250], [9000, -1000], [11000, -800]]) assert.ok(Math.abs(P.at(x, z) - H.at(x, z)) < 1, `${x}, ${z}`);
});

test('the seams: the 4 m heights meet the shipped 10 m and 32 m levels where they overlap', async () => {
  const H = await south;
  for (const [name, landTol, waterTol] of [['basin', 0.6, 0.6], ['lake', 1.5, 0.8]]) {
    const C = await heights(T(), byName[name], lake.height);
    const dl = [], dw = [];
    const B = full.box, xEnd = Math.min(B.x1, C.L.x0 + (C.L.w - 1) * C.L.step);
    for (let x = B.x0 + 40; x < xEnd - 40; x += 64) for (let z = B.z0 + 40; z < B.z1 - 40; z += 64) {
      const a = H.at(x, z), c = C.at(x, z);
      if (a > 0.5 && c > 0.5) dl.push(Math.abs(a - c));
      else if (a < -30 && c < -30) dw.push(Math.abs(a - c));   // the survey's water (the shelves differ by the grid's step)
    }
    assert.ok(dl.length > 500 && dw.length > 500, `${name}: ${dl.length} land, ${dw.length} water points`);
    assert.ok(median(dl) < landTol, `${name} land: median ${median(dl).toFixed(2)} m`);
    assert.ok(median(dw) < waterTol, `${name} deep water: median ${median(dw).toFixed(2)} m`);
  }
});
