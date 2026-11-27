// The buildings (v2/towns/buildings.js, tools/v2-buildings-pack.mjs, v2/render/buildings.js): the file's round trip, the
// shipped sets against a fresh pack, the sets a start loads, the cull, the policy (off on a phone), the grounding on the
// terrain at sample points (no floating or buried box), the landmarks (the Stateline towers, the gondola, the marina's
// boats), the south's night lights, and no brand text anywhere in what ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { encodeBuildings, decodeBuildings, instanceArray, groundBox, pickChunks, setsFor, SETS, KIND, MODE, CLASS, RANGE, INST_FLOATS, GROUND } from '../towns/buildings.js';
import { packBuildings, inputs, sameContent, southLights, RULES } from '../../tools/v2-buildings-pack.mjs';
import { packLights } from '../../tools/v2-lights-pack.mjs';
import { decodeLights } from '../sim/night.js';
import { unitMesh } from '../render/buildings.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shipped = (f) => gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/towns', f)));
const I = await inputs();
const fresh = await packBuildings(I);

test('the file: records round-trip within their steps (1/64 m, 1 cm, 1 dm, 5 cm, 2π/256), sorted far first then by cell', () => {
  const recs = [
    { x: 12345.678, z: -876.543, len: 22.37, wid: 9.81, h: 6.2, y: 0, shear: 0, yaw: 1.234, roof: 3.4, kind: KIND.house, mode: MODE.ground, tint: 0x35, facade: 0, lit: 0, cls: CLASS.near },
    { x: 13669.2, z: -686.1, len: 100.5, wid: 45, h: 63, y: 0, shear: 0, yaw: 4.9, roof: 0, kind: KIND.high, mode: MODE.ground, tint: 2, facade: 2, lit: 0.7, cls: CLASS.far },
    { x: -15.5, z: 2999.99, len: 120, wid: 0.35, h: 0.35, y: 412.6, shear: -61.25, yaw: 0.7, roof: 0, kind: KIND.part, mode: MODE.abs, tint: 0x22, facade: 0, lit: 0, cls: CLASS.far },
    { x: 12880.1, z: -510.9, len: 7.5, wid: 2.55, h: 1.15, y: -0.35, shear: 0, yaw: 5.5, roof: 0, kind: KIND.hull, mode: MODE.abs, tint: 0x71, facade: 0, lit: 0, cls: CLASS.near },
  ];
  const D = decodeBuildings(encodeBuildings(recs, () => 10));
  assert.equal(D.count, 4);
  const cls = Array.from({ length: 4 }, (_, i) => D.rec(i).cls);
  assert.deepEqual(cls, [CLASS.far, CLASS.far, CLASS.near, CLASS.near], 'the far class first');
  assert.equal(D.chunks.length, 3, 'the two boats in one cell share its chunk');
  const back = Array.from({ length: 4 }, (_, i) => D.rec(i));
  for (const r of recs) {
    const b = back.find((q) => Math.abs(q.x - r.x) < 0.02 && Math.abs(q.z - r.z) < 0.02);
    assert.ok(b, `record at ${r.x}, ${r.z}`);
    assert.ok(Math.abs(b.len - r.len) <= 0.005 && Math.abs(b.wid - r.wid) <= 0.005 && Math.abs(b.h - r.h) <= 0.005);
    assert.ok(Math.abs(b.y - r.y) <= 0.05 + 1e-9 && Math.abs(b.shear - r.shear) <= 0.025 + 1e-9 && Math.abs(b.roof - r.roof) <= 0.05 + 1e-9);
    assert.ok(Math.abs(Math.atan2(Math.sin(b.yaw - r.yaw), Math.cos(b.yaw - r.yaw))) <= Math.PI / 256 + 1e-9);
    assert.equal(b.kind, r.kind); assert.equal(b.mode, r.mode); assert.equal(b.tint, r.tint); assert.equal(b.facade, r.facade); assert.ok(Math.abs(b.lit - r.lit) < 0.003);
  }
  // the GPU's records: 64 bytes each, the position and the dimensions as decoded
  const G = new Float32Array(instanceArray(D).buffer);
  assert.equal(G.length, 4 * INST_FLOATS);
  assert.equal(G[0], D.rec(0).x); assert.equal(G[4], D.rec(0).len);
  assert.throws(() => decodeBuildings(new Uint8Array(32)), /VBD1/);
});

test('the shipped sets are a fresh pack of OSM\'s footprints (decoded content, record by record)', () => {
  for (const s of Object.values(SETS)) assert.equal(sameContent(shipped(s.file), fresh.files[s.file]), null, s.file);
  // the lights-south.bin the night loads is the lights pack's pack of southLights
  const L = decodeLights(readFileSync(resolve(ROOT, 'v2/assets/night/lights-south.bin')));
  const want = decodeLights(packLights(southLights(I)));
  assert.equal(L.count, want.count); assert.deepEqual(Array.from(L.data), Array.from(want.data));
});

test('the sets: a bay start loads the lake set only; a start in the south box loads the south too (the owner\'s per-region rule)', () => {
  assert.deepEqual(setsFor(1200, -1050), ['lake'], 'Emerald Bay');
  assert.deepEqual(setsFor(300, -400), ['lake']);
  assert.deepEqual(setsFor(11800, -875), ['lake', 'south'], 'the Ski Run pin');
  assert.deepEqual(setsFor(NaN, NaN), ['lake']);
  // the lake set stays small (the bay's own buildings, the big ones round the lake, the gondola); the south its region's detail
  const lake = decodeBuildings(shipped(SETS.lake.file)), south = decodeBuildings(shipped(SETS.south.file));
  assert.ok(lake.count > 1500 && lake.count < 3000, `lake ${lake.count}`);
  assert.ok(south.count > 4000, `south ${south.count}`);
  for (let i = 0; i < south.count; i += 7) { const r = south.rec(i); assert.ok(r.x >= SETS.south.box[0] - 1 && r.x <= SETS.south.box[1] + 1 && r.z >= SETS.south.box[2] - 1 && r.z <= SETS.south.box[3] + 1, `south record ${i} in its box`); }
  // Emerald Bay's own buildings are in the lake set
  let bay = 0; for (let i = 0; i < lake.count; i++) { const r = lake.rec(i); if (r.kind < KIND.hull && Math.hypot(r.x - 300, r.z + 400) < 4000) bay++; }
  assert.ok(bay > 20, `the bay's buildings in the lake set: ${bay}`);
});

test('the cull: a chunk draws within its class\'s range (4 km; the landmarks 16 km) and in the frustum', () => {
  const chunks = [
    { cls: CLASS.near, count: 3, box: [3000, 0, 0, 3100, 10, 100] },     // 3.0 km
    { cls: CLASS.near, count: 5, box: [4500, 0, 0, 4600, 10, 100] },     // 4.5 km: out
    { cls: CLASS.far, count: 2, box: [15000, 0, 0, 15100, 60, 100] },    // 15 km, far: in
    { cls: CLASS.far, count: 9, box: [17000, 0, 0, 17100, 60, 100] },    // 17 km: out
  ];
  const out = [];
  assert.equal(pickChunks(chunks, [0, 2, 50], null, null, out), 5); assert.deepEqual(out, [0, 2]);
  assert.equal(RANGE[CLASS.near], 4000); assert.equal(RANGE[CLASS.far], 16000);
  assert.equal(pickChunks(chunks, [0, 2, 50], [], () => false, out), 0, 'behind the camera: none');
  assert.equal(pickChunks(chunks, [0, 2, 50], [], () => true, out), 5);
});

test('the policy: the buildings are off on a phone, on a desktop and a tablet; ?buildings= overrides', () => {
  const tier = (dev, flags = {}) => { const win = { ...DEVICES[dev], location: { search: '' } }; return createFeatures({ profile: { get: () => profileOf(readFacts(win), forcedOf(''), { gpu: 1 }), on: () => () => {} }, doc: null }).configure({ headless: false, flags }).feature('buildings').tier; };
  assert.equal(tier('desktop'), 'on'); assert.equal(tier('ipadTrackpad'), 'on'); assert.equal(tier('iphoneTurned'), 'off'); assert.equal(tier('androidSideways'), 'off');
  assert.equal(tier('desktop', { buildings: '0' }), 'off'); assert.equal(tier('iphoneTurned', { buildings: '1' }), 'on');  // the mesh's tier: the full mesh near on a desktop and a strong tablet; the far mesh everywhere at L2-L3; a capture is full
  const mt = (dev, gpu, headless = false) => { const win = { ...DEVICES[dev], location: { search: '' } }; return createFeatures({ profile: { get: () => profileOf(readFacts(win), forcedOf(''), { gpu }), on: () => () => {} }, doc: null }).configure({ headless, flags: {} }).feature('buildingsTier').tier; };
  assert.equal(mt('desktop', 1), 'full'); assert.equal(mt('ipadTrackpad', 1), 'full'); assert.equal(mt('desktop', 2), 'lite'); assert.equal(mt('desktop', 3, true), 'full');
});

test('the grounding: every sampled box stands on the terrain (its foot under its lowest corner, at most 6.5 m under its mean, its eaves over its mean ground); the mesh is closed upward', () => {
  const h = I.heightAt;
  let n = 0;
  for (const s of Object.values(SETS)) {
    const D = decodeBuildings(shipped(s.file));
    for (let i = 0; i < D.count; i += 11) {
      const r = D.rec(i);
      if (r.mode !== MODE.ground) continue;
      const [base, top] = groundBox(h, r), ca = Math.cos(r.yaw), sa = Math.sin(r.yaw);
      const ys = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([u, v]) => h(r.x + u * r.len / 2 * ca + v * r.wid / 2 * sa, r.z - u * r.len / 2 * sa + v * r.wid / 2 * ca));
      const lo = Math.min(...ys.slice(0, 4)), hi = Math.max(...ys.slice(0, 4)), mean = ys.slice(0, 4).reduce((a, b) => a + b) / 4;
      assert.ok(base <= lo - GROUND.under + 1e-6 || base <= mean - GROUND.sinkMax - GROUND.under + 1e-6, `${s.id} ${i}: floats (base ${base.toFixed(2)}, low corner ${lo.toFixed(2)})`);
      assert.ok(base >= mean - GROUND.sinkMax - GROUND.under - 1e-6, `${s.id} ${i}: sunk (base ${base.toFixed(2)}, mean ${mean.toFixed(2)})`);
      // v1's rule lets a long block on a steep slope run its uphill end into the hill; its eaves still stand over its mean ground
      assert.ok(top > mean + Math.min(2, r.h) && top - base > 2, `${s.id} ${i}: buried (top ${top.toFixed(2)}, mean ${mean.toFixed(2)}, high corner ${hi.toFixed(2)})`);
      assert.ok(Math.min(...ys.slice(0, 4)) > -40, `${s.id} ${i}: on land`);
      n++;
    }
  }
  assert.ok(n > 600, `${n} boxes sampled`);
  // the unit mesh, no floor: the main block (4 walls in 6 quads, the top in 2, two slopes, two gables), the wing (4 walls, two
  // slopes, two gables), each block's soffits (the slopes' undersides) and fascia (2 eaves, 4 rakes), the chimney (4 sides, a cap);
  // the far mesh is the walls, slopes and gables only, a subset of the full one's faces
  const M = unitMesh(), main = 2 * 6 + 2 * 2 + 2 * 2 + 2, wing = 2 * 4 + 2 * 2 + 2, trim = 2 * 2 + 6 * 2, chimney = 5 * 2;
  assert.equal(M.near / 3, main + wing + 2 * trim + chimney);
  assert.equal(M.farCount / 3, main + wing);
  const tri = (a) => Array.from({ length: a.length / 3 }, (_, i) => [a[3 * i], a[3 * i + 1], a[3 * i + 2]].join());
  const full = new Set(tri(M.I.subarray(0, M.near)));
  for (const t of tri(M.I.subarray(M.farFirst, M.farFirst + M.farCount))) assert.ok(full.has(t), 'a far face is a full-mesh face');
});

test('the landmarks: the Stateline high-rises at their sources\' heights, the gondola up the mountain, boats in the marina\'s slips', () => {
  const lake = decodeBuildings(shipped(SETS.lake.file)), south = decodeBuildings(shipped(SETS.south.file));
  const all = (D) => Array.from({ length: D.count }, (_, i) => D.rec(i));
  const L = all(lake), S = all(south);
  // the two tallest towers about 1.8 km east of the Ski Run pin's shore (x 11,800): 18 and 19 floors (≈ 60 and 63 m), far class
  const towers = L.filter((r) => r.kind === KIND.high && r.h > 45).sort((a, b) => b.h - a.h);
  assert.ok(towers.length >= 2, `${towers.length} towers`);
  for (const t of towers.slice(0, 2)) { assert.ok(t.h > 55 && t.h < 70, `tower ${t.h} m`); assert.ok(t.x - 11800 > 1500 && t.x - 11800 < 2500, `tower at x ${t.x}`); assert.equal(t.cls, CLASS.far); }
  // the gondola: pylons (foot grounded) climbing from the shore toward the summit, two cables (sheared spans), cabins
  const pylons = L.filter((r) => r.kind === KIND.part && r.mode === MODE.foot);
  const cables = L.filter((r) => r.kind === KIND.part && r.mode === MODE.abs && r.len > 50);
  const cabins = L.filter((r) => r.kind === KIND.part && r.mode === MODE.abs && r.cls === CLASS.near);
  assert.ok(pylons.length >= 10, `${pylons.length} pylons`); assert.equal(cables.length % 2, 0); assert.ok(cables.length >= 2 * (pylons.length + 1) - 1, `${cables.length} cable spans`);
  assert.ok(cabins.length > 40, `${cabins.length} cabins`);
  const tops = pylons.map((p) => p.y).sort((a, b) => a - b);
  assert.ok(tops[0] < 200 && tops.at(-1) > 700, `the line climbs (${tops[0].toFixed(0)}–${tops.at(-1).toFixed(0)} m)`);
  for (const p of pylons) assert.ok(p.y - I.heightAt(p.x, p.z) >= RULES.gondola.headM - 1, 'a pylon\'s head over its foot');
  // the cables clear the ground between the pylons (sampled along each span)
  for (const c of cables) {
    const ca = Math.cos(c.yaw), sa = Math.sin(c.yaw);
    for (let t = -0.45; t <= 0.45; t += 0.05) { const y = c.y + c.h / 2 + c.shear * t, g = I.heightAt(c.x + t * c.len * ca, c.z - t * c.len * sa); assert.ok(y - g > RULES.gondola.clearM - 1.5, `a cable ${(y - g).toFixed(1)} m over the ground`); }
  }
  // the marina: hulls afloat in at least 1.2 m of water, inside the south set, bows pinched (kind hull)
  const hulls = S.filter((r) => r.kind === KIND.hull);
  assert.ok(hulls.length >= 20, `${hulls.length} boats`);
  for (const b of hulls) { assert.ok(I.heightAt(b.x, b.z) < -1.1, 'afloat'); assert.ok(b.y < 0 && b.y + b.h > 0.5, 'her freeboard over the water'); }
});

test('the south\'s night lights: the towers\' facades and the docks, a few hundred glows; none on the bay', () => {
  const L = decodeLights(readFileSync(resolve(ROOT, 'v2/assets/night/lights-south.bin')));
  assert.ok(L.count > 300 && L.count < 4000, `${L.count} lights`);
  for (let i = 0; i < L.count; i++) { const x = L.data[i * 8], z = L.data[i * 8 + 2]; assert.ok(x > 6000 && z > -6000 && z < 4500, `light ${i} in the south`); }
});

test('no brand text: what ships (the sets, the south\'s lights, the pack\'s stats) names no casino, resort or business', () => {
  const BRANDS = ['harrah', 'harvey', 'montbleu', 'hard rock', 'hardrock', 'bally', 'caesar', 'heavenly', 'lakeside inn', 'golden nugget', 'tahoe queen', 'ski run marina'];
  const texts = [...Object.values(SETS).map((s) => shipped(s.file).toString('latin1')), readFileSync(resolve(ROOT, 'v2/assets/night/lights-south.bin')).toString('latin1'), JSON.stringify(fresh.stats)];
  for (const t of texts) for (const b of BRANDS) assert.ok(!t.toLowerCase().includes(b), b);
  // the records carry numbers only: no field is a string
  const D = decodeBuildings(shipped(SETS.lake.file));
  for (const v of Object.values(D.rec(0))) assert.equal(typeof v, 'number');
});
