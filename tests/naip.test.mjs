// The photo ground (src/naip-layout.js, tools/ground/*): the layout the runtime hard-codes must match what the build
// tools wrote (terrain/naip/naip.json, horizon.json) and the terrain manifest; the horizon file must decode and hold
// physically sane values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { NAIP_EXTENT, NAIP_FILES, NAIP, HORIZON_FINE as HF, NAIP_DIR, naipClass } from '../src/naip-layout.js';
import { TIERS } from '../classic/src/quality/tiers.js';

const dir = new URL('../terrain/naip/', import.meta.url);
const json = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const meta = json('naip.json'), hz = json('horizon.json'), tahoe = JSON.parse(readFileSync(new URL('../terrain/tahoe.json', import.meta.url), 'utf8'));

test('the photo levels sit on the terrain levels they cover (texel edges)', () => {
  const edge = (L) => ({ x0: L.x0 - L.step / 2, z0: L.z0 - L.step / 2, x1: L.x0 + L.w * L.step - L.step / 2, z1: L.z0 + L.h * L.step - L.step / 2 });
  assert.deepEqual(NAIP_EXTENT.bay, edge(tahoe.levels.find((l) => l.name === 'bay')));
  assert.deepEqual(NAIP_EXTENT.region, edge(tahoe.levels.find((l) => l.name === 'lake')));
});

test('every tier file exists, has the pixel size the layout says, and the build recorded the same', () => {
  for (const [level, files] of Object.entries(NAIP_FILES)) {
    const ext = NAIP_EXTENT[level];
    for (const [texel, [file, w, h]] of Object.entries(files)) {
      assert.ok(existsSync(new URL(file, dir)), `${file} is missing`);
      assert.equal(w, (ext.x1 - ext.x0) / texel, `${file} width`); assert.equal(h, (ext.z1 - ext.z0) / texel, `${file} height`);
      const rec = meta.levels[level].files[texel];
      assert.equal(rec.file, file); assert.equal(rec.w, w); assert.equal(rec.h, h);
      const buf = readFileSync(new URL(file, dir));
      assert.equal(buf.toString('latin1', 0, 4), 'RIFF'); assert.equal(buf.toString('latin1', 8, 12), 'WEBP');
      assert.ok(Math.max(w, h) <= 8192, 'the default WebGPU texture limit is 8192');
    }
  }
});

test('the class index in alpha decodes to weights that sum to 1 and order bare < brush < forest', () => {
  for (const a of [64, 100, 160, 200, 255]) { const c = naipClass(a); assert.ok(Math.abs(c.forest + c.brush + c.bare - 1) < 1e-9, `alpha ${a}`); }
  assert.ok(naipClass(64).bare > 0.99 && naipClass(255).forest > 0.99 && naipClass(160).brush > 0.5);
});

test('the quality tiers pick levels that exist, finer on higher tiers', () => {
  const ord = ['high', 'balanced', 'low'];
  for (const t of ord) for (const [lv, m] of Object.entries(TIERS[t].ground)) assert.ok(NAIP_FILES[lv][m], `${t} ${lv} ${m} m`);
  for (const lv of ['bay', 'region']) {
    const m = ord.map((t) => TIERS[t].ground[lv]);
    assert.ok(m[0] <= m[1] && m[1] <= m[2], `${lv}: ${m}`);
  }
  assert.deepEqual(NAIP.pick, TIERS.high.ground, 'the module default is High');
});

test('the capture and grade are on record (public domain, 2022-07-21, targets)', () => {
  assert.equal(meta.capture, '2022-07-21'); assert.match(meta.source, /NAIP 2022/);
  assert.deepEqual(meta.targets, { forest: 0.0105, brush: 0.0185, bare: 0.04, sand: 0.3 });
  assert.ok(meta.sun.az > 90 && meta.sun.az < 270 && meta.sun.el >= 30);
});

test('the horizon file decodes: 17 planes, skyline 0..90 deg, sky visibility 0..1, walls shade the bay at dusk', () => {
  assert.equal(HF.w, hz.w); assert.equal(HF.h, hz.h); assert.equal(HF.texel, hz.texel); assert.equal(HF.x0, hz.x0); assert.equal(HF.z0, hz.z0); assert.equal(HF.dirs, hz.dirs);
  const raw = gunzipSync(readFileSync(new URL(HF.file, dir)));
  const n = HF.w * HF.h;
  assert.equal(raw.length, n * HF.planes);
  const at = (x, z, plane) => raw[plane * n + Math.floor((z - HF.z0) / HF.texel) * HF.w + Math.floor((x - HF.x0) / HF.texel)];
  // the bay's head (Vikingsholm, west end): the west skyline (plane 12 = 270 deg) is a wall of the Desolation slopes, tens of degrees
  const west = at(-1800, 100, 12) * 90 / 255, east = at(-1800, 100, 4) * 90 / 255;
  assert.ok(west > 8 && west <= 60, `west skyline at the bay head ${west.toFixed(1)} deg`);
  assert.ok(west > east, `the west wall (${west.toFixed(1)}) stands higher than the east side (${east.toFixed(1)})`);
  // open lake: nearly flat all round; sky visibility near 1
  const sv = at(2000, 0, 16) / 255;
  assert.ok(sv > 0.9 && sv <= 1, `sky visibility on open water ${sv}`);
  let lo = 255; for (let i = 0; i < n; i += 97) lo = Math.min(lo, raw[16 * n + i]);
  assert.ok(lo / 255 > 0.5, 'no texel is nearly closed');
});

test('the served paths are the files', () => { assert.equal(NAIP_DIR, '/terrain/naip/'); assert.ok(statSync(new URL('naip.json', dir)).size > 0); });
