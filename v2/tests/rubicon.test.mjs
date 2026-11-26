// Rubicon Point (the big lake's start, moved from the open water outside Emerald Bay's mouth): the tahoe-west row's birthplace (id
// `lake` kept: a saved pick still starts there), its own 4 m level and photo (terrain/rubicon: tools/terrain/build_tahoe.py --region
// rubicon, tools/ground/build_naip.py --levels rubicon, tools/v2-photo-tiles.mjs --region rubicon), loaded only for that start
// (v2/terrain/region.js), its look layers by the level's key (the rocks' box, the shore-break bake), the light on the cliff
// (render/lighthouse.js), and the chart (the pin in the first view, the lazy detail sheet). Behaviour, not source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURRENT_WATERS as W } from '../../src/sim/waters/current.js';
import { lonLatToWorld } from '../../src/sim/geo.js';
import { dayWind } from '../../src/sim/wind.js';
import { regionsOf, birthplaceRows } from '../sim/regions.js';
import { listBirthplaces, resolveStart, birthPose, BIRTH } from '../sim/birthplace.js';
import { levelOfRegion, levelKeyOfBirth, startRegionLevel, startFiles, composeLevel, regionPhotoLevel, manifestFile } from '../terrain/region.js';
import { streamPlan, shoreFiles } from '../terrain/levels.js';
import { PHOTO_SETS, tilesOf, tileUrl } from '../terrain/photo.js';
import { inflate, unpredict, metres } from '../terrain/decode.js';
import { rocksFor, ROCKS } from '../terrain/rocks-rules.js';
import { shoreFile, SHORE_FILE } from '../render/shore.js';
import { forestRegion, REGION } from '../forest/lod.js';
import { LIGHTHOUSE, lighthouseFor, lighthouseSeat, lighthouseParts, lighthouseTop } from '../render/lighthouse.js';
import { regionDepth, checkRows, bakedDepth } from '../../tools/birthplace-check.mjs';
import { parseV2Flags } from '../engine/flags.js';
import { SHEETS, PAPER } from '../ui/chart/ground.js';
import { SHEET_BAKE } from '../ui/chart/sheetData.js';
import { frameBirthplaces, sheetWanted, buildPois, NAMES } from '../ui/chart/chartModel.js';
import { edgePoint } from '../ui/chart/edge.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = (...p) => resolve(ROOT, 'terrain', ...p);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lake = { full: json(T('tahoe.json')), phone: json(T('tahoe-phone.json')) };
const full = json(T('rubicon', 'rubicon.json')), phone = json(T('rubicon', 'rubicon-phone.json'));
const ROW = regionsOf(W).find((r) => r.id === 'tahoe-west');
const PIN = birthplaceRows(W).find((b) => b.id === 'lake');
const LV = levelOfRegion(W, 'tahoe-west');
const R = await regionDepth(LV);   // the desktop grids the page starts it on (the plan chart's grid outside the box)
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const bearing = (x0, z0, x1, z1) => ((Math.atan2(x1 - x0, -(z1 - z0)) * 180) / Math.PI + 360) % 360;

test('the row: Rubicon Point at the drop-off off the point, the id `lake` kept, its hero the light, its region\'s level', () => {
  assert.equal(PIN.name, 'Rubicon Point'); assert.equal(PIN.region, 'tahoe-west');
  assert.deepEqual([PIN.x, PIN.z], [680, -4900]);
  assert.deepEqual(PIN.look, [LIGHTHOUSE.x, LIGHTHOUSE.z], 'the hero: the light on the cliff');
  assert.match(PIN.why, /drop-off/);
  // the point (OpenStreetMap's Rubicon Point, 38.99931 N, 120.09621 W) is 150-400 m off the pin, the light about 300 m
  const [px, pz] = lonLatToWorld(-120.0962065, 38.9993148);
  const d = Math.hypot(PIN.x - px, PIN.z - pz);
  assert.ok(d >= 150 && d <= 400, `${d.toFixed(0)} m off the point`);
  assert.ok(Math.hypot(PIN.x - LIGHTHOUSE.x, PIN.z - LIGHTHOUSE.z) < 320, 'the light about 300 m off');
  // the public light (38.99583 N, 120.09472 W) within 50 m of where ours stands on the cliff's edge
  const [lx, lz] = lonLatToWorld(-120.09472, 38.99583);
  assert.ok(Math.hypot(LIGHTHOUSE.x - lx, LIGHTHOUSE.z - lz) < 50);
  assert.deepEqual({ ...ROW.level }, { dir: 'rubicon', full: 'rubicon.json', phone: 'rubicon-phone.json', photo: 'photo/manifest.json', life: 'always' });
  assert.ok(Math.hypot(PIN.x - ROW.centre[0], PIN.z - ROW.centre[1]) < ROW.radiusM, 'inside its region\'s circle (the busy lake)');
});

test('a saved `lake` (the old Open lake) and ?birth=lake start at Rubicon Point', () => {
  const settings = { get: (k) => (k === 'birthplace' ? 'lake' : null) };
  assert.deepEqual(resolveStart({ waters: W, settings }), { id: 'lake', pick: 'lake', source: 'saved' });
  assert.equal(resolveStart({ waters: W, flags: parseV2Flags('?birth=lake') }).id, 'lake');
  assert.equal(listBirthplaces(W).find((b) => b.id === 'lake').name, 'Rubicon Point');
});

test('the start: deep water over the drop-off, clear of the shore on every bearing; the depth check passes', () => {
  const depth = R.depthAt(PIN.x, PIN.z), shore = -R.shoreAt(PIN.x, PIN.z);
  assert.ok(depth > 150, `${depth.toFixed(1)} m under her`);
  assert.ok(shore >= 200 && shore <= 320, `${shore.toFixed(0)} m off the shore`);
  const row = checkRows(W, bakedDepth(), { 'tahoe-west': R }).find((r) => r.id === 'lake');
  assert.equal(row.ok, true, row.fail.join('; '));
  assert.equal(row.ground, 'tahoe-west');
  assert.ok(row.minClear >= 150, `clear ${row.minClear} m`);
});

test('the opening view faces the cliffs: in the day\'s winds she reaches off the shore, never at it, and the camera turns to the light', () => {
  const toLight = bearing(PIN.x, PIN.z, LIGHTHOUSE.x, LIGHTHOUSE.z);
  for (const hour of [7, 10, 13, 16, 19.5]) {
    const Wd = dayWind(hour, { seed: 1 }).dirDeg, p = birthPose(PIN, { windDeg: Wd, depthAt: R.depthAt });
    assert.equal(p.blocked, false, `${hour} h`);
    // her reach: 400 m of open water ahead (the land probe): out to the deep in the morning, past the point's tip (71 m off it, 16 m
    // deep) into Rubicon Bay in the afternoon, the cliffs beside her, never ahead
    for (let d = 20; d <= BIRTH.probeM; d += 20) {
      const h = p.headingDeg * Math.PI / 180, x = PIN.x + Math.sin(h) * d, z = PIN.z - Math.cos(h) * d;
      assert.ok(R.depthAt(x, z) > 10 && -R.shoreAt(x, z) > 60, `${hour} h: ${R.depthAt(x, z).toFixed(1)} m deep, ${(-R.shoreAt(x, z)).toFixed(0)} m off the shore ${d} m ahead`);
    }
    // the follow camera starts turned toward the light: the light within 10 degrees of the view's centre
    const cam = p.headingDeg + p.camYawDeg;
    assert.ok(Math.abs(wrap180(cam - toLight)) <= 10, `${hour} h: heading ${p.headingDeg.toFixed(0)}, camera ${cam.toFixed(0)}, the light at ${toLight.toFixed(0)}`);
  }
});

test('the level: the lake-wide frame and codes, its box round the point, the files inside a small budget', async () => {
  for (const M of [full, phone]) {
    assert.equal(M.proj, lake.full.proj); assert.equal(M.y0, lake.full.y0);
    assert.deepEqual(M.height, lake.full.height); assert.deepEqual(M.distance, lake.full.distance);
    assert.deepEqual(M.box, { x0: -900, z0: -6300, x1: 1700, z1: -3700 });
  }
  const L = full.levels[0];
  assert.deepEqual([L.step, L.w, L.h], [4, 650, 650]);
  for (const p of [PIN, LIGHTHOUSE]) assert.ok(p.x > full.box.x0 + 300 && p.x < full.box.x1 - 300 && p.z > full.box.z0 + 300 && p.z < full.box.z1 - 300, 'the pin and the light well inside the box');
  // what a Rubicon start fetches from its folder (desktop under 0.5 MB, phone under 0.2 MB), and none of the bay's detail
  const levelFor = (v) => { const manifest = json(T(manifestFile(LV, v))), photo = json(T('rubicon', 'photo/manifest.json')); return { level: LV, manifest, photo, composed: composeLevel(LV, manifest), photoLevel: regionPhotoLevel(LV, photo, v) }; };
  for (const [v, cap] of [['full', 0.5e6], ['phone', 0.2e6]]) {
    const f = startFiles({ lake, variant: v, region: levelFor(v), photoSets: PHOTO_SETS, tilesOf, tileUrl, streamPlan, shoreFiles });
    const mine = f.filter((x) => x.startsWith('terrain/rubicon/'));
    const bytes = mine.reduce((s, x) => s + statSync(resolve(ROOT, x)).size, 0);
    assert.ok(bytes > 0.05e6 && bytes < cap, `${v}: ${bytes} B`);
    assert.ok(!f.some((x) => /^terrain\/bay-/.test(x) || /^photo\/(full|phone)\/bay\//.test(x)), `${v}: none of the bay's detail`);
  }
});

test('the seams: the 4 m heights meet the shipped 10 m level along the box\'s edges (the bed and the land eased in)', async () => {
  const L = full.levels[0], q = unpredict(await inflate(readFileSync(T('rubicon', L.height))), L.w, L.h);
  const B = lake.full.levels.find((x) => x.name === 'basin'), qb = unpredict(await inflate(readFileSync(T(B.height))), B.w, B.h);
  const h4 = (i, j) => metres(q[j * L.w + i], full.height);
  const h10 = (x, z) => { const fx = (x - B.x0) / B.step, fz = (z - B.z0) / B.step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * B.w + i;
    const m = (n) => metres(qb[n], lake.full.height); return (m(k) * (1 - u) + m(k + 1) * u) * (1 - v) + (m(k + B.w) * (1 - u) + m(k + B.w + 1) * u) * v; };
  const diffs = [];
  for (let k = 0; k < L.w; k += 5) for (const [i, j] of [[k, 0], [k, L.h - 1], [0, k], [L.w - 1, k]]) diffs.push(Math.abs(h4(i, j) - h10(L.x0 + i * L.step, L.z0 + j * L.step)));
  diffs.sort((a, b) => a - b);
  const med = diffs[diffs.length >> 1];
  assert.ok(med < 2, `the edges' median step ${med.toFixed(2)} m`);
});

test('region loading: only the Rubicon start loads its level and its look; the bay\'s starts load nothing new', () => {
  assert.equal(levelKeyOfBirth(W, 'lake'), 'tahoe-west');
  assert.deepEqual(startRegionLevel({ waters: W, birth: { id: 'lake', source: 'saved' } }), LV);
  assert.equal(startRegionLevel({ waters: W, birth: { id: 'lake', source: 'saved' }, race: true }), null, 'Regatta: its own start in the bay');
  for (const id of ['tessie', 'fannette', 'vikingsholm', 'narrows'].filter((i) => birthplaceRows(W).some((b) => b.id === i))) {
    const key = levelKeyOfBirth(W, id);
    assert.equal(key, 'bay', id);
    assert.equal(startRegionLevel({ waters: W, birth: { id, source: 'flag' } }), null, id);
    assert.deepEqual(rocksFor(key).box, ROCKS.box, `${id}: the bay's rocks`);
    assert.equal(shoreFile(key), SHORE_FILE, `${id}: the bay's shore field`);
    assert.equal(forestRegion(key), REGION, `${id}: the bay's forest`);
    assert.equal(lighthouseFor(key), null, `${id}: no light fetched`);
  }
  // the Rubicon start: the rocks over its level's box, its own shore-break bake, the bay's forest box (it already reaches the point)
  assert.deepEqual({ ...rocksFor('tahoe-west').box }, full.box);
  assert.match(String(shoreFile('tahoe-west')), /shore-rubicon\.vsf\.gz$/);
  assert.ok(statSync(fileURLToPath(shoreFile('tahoe-west'))).size > 50e3);
  const F = forestRegion('tahoe-west');
  assert.ok(PIN.z > F.z0 && LIGHTHOUSE.z > F.z0 + 256, 'the rules\' trees reach the point');
});

test('the light: modest and cheap, seated on the cliff\'s edge, only for its level', () => {
  assert.equal(lighthouseFor('tahoe-west'), LIGHTHOUSE);
  const seat = lighthouseSeat((x, z) => -R.depthAt(x, z));
  assert.ok(Math.abs(seat.floor - LIGHTHOUSE.seat.floor) < 0.05 && Math.abs(seat.foot - LIGHTHOUSE.seat.foot) < 0.05, `the baked seat ${JSON.stringify(LIGHTHOUSE.seat)} vs ${JSON.stringify(seat)}`);
  assert.ok(seat.groundMin > 20, 'on land, on the cliff');
  const off = R.shoreAt(LIGHTHOUSE.x, LIGHTHOUSE.z);
  assert.ok(off > 10 && off < 60, `${off.toFixed(0)} m back from the water`);
  const tall = lighthouseTop() - LIGHTHOUSE.seat.floor;
  assert.ok(tall > 3.2 && tall < 4.2, `${tall.toFixed(2)} m: the real light's 12 ft, give or take its cap`);
  const { parts, stats } = lighthouseParts();
  assert.ok(stats.triangles < 300, `${stats.triangles} triangles`);
  for (const p of parts) {
    assert.equal(p.pos.length, p.nrm.length);
    assert.ok(p.idx.every((i) => i < p.pos.length / 3));
    for (let k = 0; k < p.pos.length; k += 3) assert.ok(Math.hypot(p.pos[k] - LIGHTHOUSE.x, p.pos[k + 2] - LIGHTHOUSE.z) < 2.5 && p.pos[k + 1] >= LIGHTHOUSE.seat.foot - 1e-6 && p.pos[k + 1] <= lighthouseTop() + 1e-6);
  }
});

test('the chart: the pin is a normal pin on the paper, framed in the first view; the detail sheet loads only near it; its name', () => {
  const e = edgePoint(PIN.x, PIN.z, PAPER);
  assert.equal(e.far, false, 'on the paper');
  const pin = buildPois({ birthplaces: listBirthplaces(W) }).find((r) => r.ref === 'lake');
  assert.ok(pin && !pin.far && pin.name === 'Rubicon Point' && pin.x === PIN.x && pin.z === PIN.z, JSON.stringify(pin));
  const f = frameBirthplaces(listBirthplaces(W), { w: 1280, h: 720 });
  const hw = 640 * f.mpp, hh = 360 * f.mpp;
  assert.ok(Math.abs(PIN.x - f.center.x) < hw && Math.abs(PIN.z - f.center.z) < hh, 'in the first view');
  const S = SHEETS.rubicon, B = S.box;
  assert.ok(S.lazy && PIN.x > B.x0 && PIN.x < B.x1 && PIN.z > B.z0 && PIN.z < B.z1 && LIGHTHOUSE.z > B.z0 && LIGHTHOUSE.z < B.z1, 'the sheet holds the pin and the light');
  assert.ok(SHEET_BAKE.rubicon && SHEET_BAKE.rubicon.mpp === 6.25, 'baked at the bay\'s scale');
  assert.equal(sheetWanted(S, { cx: f.center.x, cz: f.center.z, mpp: f.mpp }, { w: 1280, h: 720, lit: { x: 460, z: -50 } }), false, 'not for the first view');
  assert.equal(sheetWanted(S, { cx: 400, cz: -200, mpp: 3 }, { w: 1280, h: 720, lit: { x: 460, z: -50 } }), false, 'a bay start in the bay');
  assert.equal(sheetWanted(S, { cx: 550, cz: -5000, mpp: 4 }, { w: 1280, h: 720 }), true, 'close up on the point');
  assert.equal(sheetWanted(S, { cx: 400, cz: -200, mpp: 30 }, { w: 1280, h: 720, lit: { x: PIN.x, z: PIN.z } }), true, 'a start at Rubicon Point');
  assert.ok(NAMES.some((n) => n.text === 'Rubicon Point'), 'the point\'s name on the chart');
});

test('life: the tahoe-west row\'s kayakers, put-ins and boats live on every start (its mouth lanes on the bay\'s ground), as before its level', async () => {
  const { REGIONS, regionLoaded } = await import('../living/busyLake.js');
  const tw = REGIONS.find((r) => r.id === 'tahoe-west'), south = REGIONS.find((r) => r.id === 'south-lake');
  assert.equal(regionLoaded(tw, 'bay'), true, 'a bay start keeps the mouth\'s kayakers');
  assert.equal(regionLoaded(tw, 'tahoe-west'), true);
  assert.equal(regionLoaded(south, 'bay'), false, 'South Lake\'s life still only on its own start');
  // one pair paddles the cliffs round the pin, 80 m or more off the shore on the 4 m level; the mouth's lanes stay
  const lane = tw.kayaks.find((k) => k.id === 'kayak-lake-round');
  assert.ok(lane.mate, 'a pair');
  for (let i = 0; i < lane.lane.length; i++) {
    const a = lane.lane[i], b = lane.lane[(i + 1) % lane.lane.length];
    for (let t = 0; t <= 1; t += 0.05) { const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t; assert.ok(-R.shoreAt(x, z) >= 80 && R.depthAt(x, z) >= 4, `(${x.toFixed(0)}, ${z.toFixed(0)}): ${(-R.shoreAt(x, z)).toFixed(0)} m off`); }
  }
  assert.deepEqual(tw.kayaks.map((k) => k.id), ['kayak-point', 'kayak-mouth-north', 'kayak-lake-round']);
  // three lake boats sail within 1.5 km of the pin, 4 m of water and 80 m off the shore on the level
  for (const id of ['lake-north', 'lake-point', 'lake-rubicon']) for (const [x, z] of tw.boats.find((b) => b.id === id).route) {
    const d = Math.hypot(x - PIN.x, z - PIN.z);
    assert.ok(d >= 250 && d <= 1500, `${id}: (${x}, ${z}) ${d.toFixed(0)} m from the pin`);
    assert.ok(R.depthAt(x, z) >= 4 && -R.shoreAt(x, z) >= 80, `${id}: (${x}, ${z}) in open water`);
  }
});
