// The region detail levels (v2/terrain/region.js; owner, 2026-11-24: every birthplace outside the bay loads when it is selected):
//   - the region row: South Lake's row declares its level; only a start at one of its birthplaces picks it (not the bay's, not a
//     URL pose, not Regatta, not the fireworks evening's own start)
//   - for EVERY birthplace of EVERY region row (and a fake second region): the files a start fetches hold exactly its region's level
//     files (or the bay's) and none of another region's
//   - the plan: the region's grid fills the bay's slot in stage 0 (4 m on a desktop, 8 m on a phone), the bay's heights and photo
//     are not fetched; the coarser levels stay; the load budget (desktop about 2.26 MB, phone about 0.75 MB)
//   - the seams: the live sampler (v2/terrain/sample.js, the GPU's twin) and the shore distance (v2/sim/lake.js) have no step where
//     the south level blends into the basin and lake levels; the depth at the Ski Run pin is 22.85 m through the live sampler
//   - the wind: the pin lies outside the wind's bay box (the level's reference only); its wind is the open lake's
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { regionsOf, regionNamesOf, birthplaceRows } from '../sim/regions.js';
import { regionLevels, levelOfBirth, levelKeyOfBirth, startRegionLevel, composeLevel, shoreManifest, regionPhotoLevel, startFiles, levelFiles, manifestFile } from '../terrain/region.js';
import { streamPlan, shoreFiles, SLOTS } from '../terrain/levels.js';
import { PHOTO_SETS, tilesOf, tileUrl } from '../terrain/photo.js';
import { createHeightField } from '../terrain/sample.js';
import { shoreSampler, shoreGrid } from '../sim/lake.js';
import { shoreLevels as shoreLevelsOf } from '../terrain/levels.js';
import { inflate, unpredict } from '../terrain/decode.js';
import { listBirthplaces } from '../sim/birthplace.js';
import { NAMES, buildPois } from '../ui/chart/chartModel.js';
import { WindField } from '../../src/sim/wind.js';

const W = CURRENT_WATERS;
const T = (f) => new URL(`../../terrain/${f}`, import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(T(p), 'utf8'));
const lake = { full: readJson('tahoe.json'), phone: readJson('tahoe-phone.json') };
// fetchLevel's answer, read from the repo (no fetch)
const levelFor = (level, variant) => { const manifest = readJson(manifestFile(level, variant)), photo = readJson(`${level.dir}/${level.photo}`); return { level, manifest, photo, composed: composeLevel(level, manifest), photoLevel: regionPhotoLevel(level, photo, variant) }; };
const files = (variant, region) => startFiles({ lake, variant, region, photoSets: PHOTO_SETS, tilesOf, tileUrl, streamPlan, shoreFiles });
const pageBytes = (p) => statSync(new URL(`../../${p.startsWith('photo/') ? 'v2/' : ''}${p}`, import.meta.url)).size;
// the bay's own detail files (heights, cover, shore, photo layer 0)
const isBayFile = (f) => /^terrain\/bay-/.test(f) || /^photo\/(full|phone)\/bay\//.test(f);
const regionDirOf = (f, levels) => levels.find((l) => f.startsWith(`terrain/${l.dir}/`))?.id ?? null;

test('the region row: South Lake Tahoe, its level, the pin, neighbours both ways, the chart names', () => {
  const R = Object.fromEntries(regionsOf(W).map((r) => [r.id, r]));
  const S = R['south-lake'];
  assert.ok(S, 'a south-lake row');
  assert.equal(S.label.text, 'South Lake Tahoe');
  assert.ok(Math.hypot(S.centre[0] - 10500, S.centre[1] - 500) < 1 && S.radiusM === 2500);
  assert.deepEqual([...S.neighbours], ['tahoe-west']); assert.ok(R['tahoe-west'].neighbours.includes('south-lake'));
  assert.deepEqual({ ...S.level }, { dir: 'south', full: 'south.json', phone: 'south-phone.json', photo: 'photo/manifest.json' });
  const bp = S.birthplaces.find((b) => b.id === 'ski-run');
  assert.deepEqual([bp.x, bp.z], [11800, -875]);
  assert.ok(Math.hypot(bp.x - S.centre[0], bp.z - S.centre[1]) < S.radiusM, 'the pin inside its region\'s circle');
  assert.deepEqual(regionLevels(W).map((l) => l.id), ['south-lake'], 'only South Lake declares a level today');
  // the chart: the region's name and its towns, from the region table
  for (const t of ['South Lake Tahoe', 'Ski Run', 'Tahoe Keys', 'Camp Richardson']) assert.ok(NAMES.some((n) => n.text === t), t);
  assert.deepEqual(regionNamesOf(W).map((n) => n.text), ['Ski Run', 'Tahoe Keys', 'Camp Richardson']);
  assert.ok(listBirthplaces(W).some((b) => b.id === 'ski-run' && b.region === 'south-lake' && !b.locked), 'the pin is on the list (the card, the chart)');
  // the chart's pin: past the bay's chart paper, so it stands at the paper's east edge with the continuation mark; a tap picks ski-run
  const pin = buildPois({ birthplaces: listBirthplaces(W) }).find((r) => r.ref === 'ski-run');
  assert.ok(pin.far && pin.name === 'Off Ski Run \u203a' && pin.x > 3500 && pin.x < 4000 && Math.abs(pin.z + 800) < 200 && /km east/.test(pin.line), JSON.stringify(pin));
  assert.deepEqual(pin.at, [11800, -875]);
});

test('the loader picks a region\'s level only for a start at one of its birthplaces', () => {
  const south = regionLevels(W)[0];
  for (const b of birthplaceRows(W)) {
    const want = b.region === 'south-lake' ? south : null;
    assert.deepEqual(startRegionLevel({ waters: W, birth: { id: b.id, source: 'flag' } }), want, b.id);
    assert.equal(levelKeyOfBirth(W, b.id), want ? 'south-lake' : 'bay');
  }
  const skiRun = { id: 'ski-run', source: 'saved' };
  assert.deepEqual(startRegionLevel({ waters: W, birth: skiRun }), south);
  assert.equal(startRegionLevel({ waters: W, birth: null }), null, 'a URL pose (?start=, ?heading=): the bay\'s');
  assert.equal(startRegionLevel({ waters: W, birth: skiRun, race: true }), null, 'Regatta: its own start in the bay');
  assert.equal(startRegionLevel({ waters: W, birth: skiRun, show: true }), null, 'the fireworks evening\'s own start');
  assert.equal(levelOfBirth(W, 'nowhere'), null);
});

// every birthplace of every region row: exactly its region's level (or the bay's), none of another region's. Run on the real
// profile and on one with a fake second region (a north-shore row whose level is a copy of South Lake's under another folder)
function checkEveryBirthplace(waters, levelOf) {
  const levels = regionLevels(waters);
  for (const variant of ['full', 'phone']) for (const b of birthplaceRows(waters)) {
    const lv = startRegionLevel({ waters, birth: { id: b.id, source: 'flag' } });
    const f = files(variant, lv ? levelOf(lv, variant) : null);
    const regions = new Set(f.map((x) => regionDirOf(x, levels)).filter(Boolean));
    if (lv) {
      assert.deepEqual([...regions], [lv.id], `${b.id} (${variant}): only ${lv.id}'s level`);
      assert.ok(!f.some(isBayFile), `${b.id} (${variant}): none of the bay's detail`);
      for (const want of [manifestFile(lv, variant), `${lv.dir}/${lv.photo}`]) assert.ok(f.includes(`terrain/${want}`), `${b.id}: ${want}`);
    } else {
      assert.equal(regions.size, 0, `${b.id} (${variant}): no region's level (${[...regions]})`);
      assert.ok(f.includes(`terrain/${variant === 'phone' ? 'bay-h2.lsh' : 'bay-h.lsh'}`) && f.includes('terrain/bay-c.lsh') && f.includes('terrain/bay-d.lsh'), `${b.id}: the bay's level`);
    }
  }
}

test('every birthplace: its start fetches its own region\'s level (or the bay\'s) and no other region\'s', () => {
  checkEveryBirthplace(W, levelFor);
  // a fake second region with its own level: every reader picks it up from the row alone
  const north = { id: 'tahoe-city', name: 'Tahoe City', centre: [0, -40000], radiusM: 2000, neighbours: [], level: { dir: 'north', full: 'n.json', phone: 'n-phone.json', photo: 'photo/manifest.json' },
    birthplaces: [{ id: 'commons', name: 'Commons Beach', x: 0, z: -40000, look: [0, -41000], why: 'A test row.' }] };
  const fake = { ...W, regions: [...W.regions, north] };
  const southLv = regionLevels(W)[0];
  const asNorth = (lv, variant) => { const r = levelFor(southLv, variant), man = r.manifest; return { level: lv, manifest: man, photo: r.photo, composed: composeLevel(lv, man), photoLevel: { ...r.photoLevel, base: 'terrain/north/photo/' } }; };
  checkEveryBirthplace(fake, (lv, v) => (lv.id === 'tahoe-city' ? asNorth(lv, v) : levelFor(lv, v)));
  assert.deepEqual(regionLevels(fake).map((l) => l.id), ['south-lake', 'tahoe-city']);
});

test('the plan: South Lake\'s grid in the bay\'s slot in stage 0; the bay\'s heights and photo not fetched; the budget', () => {
  const lv = regionLevels(W)[0];
  for (const [variant, h, step] of [['full', 'south/south-h.lsh', 4], ['phone', 'south/south-h2.lsh', 8]]) {
    const R = levelFor(lv, variant), st = streamPlan(lake.full, lake.phone, variant, R.composed);
    const bay = st[0].filter((g) => g.slot === 'bay');
    assert.deepEqual(bay.map((g) => [g.kind, g.file, g.step]), [['h', h, step], ['c', 'south/south-c.lsh', 8]]);
    assert.ok(!st.flat().some((g) => /^bay-/.test(g.file)), `${variant}: no bay grid`);
    // the coarser levels stay as they are (the island too): the same grids as a bay start, the bay's slot apart
    const plain = streamPlan(lake.full, lake.phone, variant).flat().filter((g) => g.slot !== 'bay').map((g) => g.file);
    assert.deepEqual(st.flat().filter((g) => g.slot !== 'bay').map((g) => g.file), plain);
    assert.deepEqual(shoreFiles(shoreManifest(lake.full, R.composed)), ['island-d.lsh', `south/${variant === 'phone' ? 'south-d2.lsh' : 'south-d.lsh'}`, 'basin-d.lsh', 'lake-d.lsh']);
  }
  // the bytes: the south files a Ski Run start fetches against a bay start's (desktop about 2.26 MB, phone about 0.75 MB)
  const south = (v) => files(v, levelFor(lv, v)).filter((f) => f.startsWith('terrain/south/')).reduce((s, f) => s + pageBytes(f), 0);
  const bay = (v) => files(v, null).filter(isBayFile).reduce((s, f) => s + pageBytes(f), 0);
  const d = south('full'), p = south('phone');
  assert.ok(d > 2.2e6 && d < 2.32e6, `desktop ${d} B`); assert.ok(p > 0.7e6 && p < 0.8e6, `phone ${p} B`);
  assert.ok(bay('full') > 2.66e6 + 2.28e6, `a bay start's bay detail ${bay('full')} B (the 2 m heights and photo among it)`);
  // every file the starts name exists in the repo, and a build ships every file of the level (v2/vite.config.js levelFiles)
  const ship = new Set(levelFiles(lv, readJson).map((f) => `terrain/${f}`));
  for (const v of ['full', 'phone']) for (const f of files(v, levelFor(lv, v)).filter((x) => x.startsWith('terrain/south/'))) assert.ok(ship.has(f), f);
});

// the live sampler with what a Ski Run start holds (every height grid of the plan in its slot)
async function field(variant, region) {
  const F = createHeightField(lake.full.height);
  for (const g of streamPlan(lake.full, lake.phone, variant, region?.composed ?? null).flat().filter((q) => q.kind === 'h')) F.setSlot(SLOTS.indexOf(g.slot), g, unpredict(await inflate(readFileSync(T(g.file))), g.w, g.h));
  return F;
}
async function shoreOf(manifest) {
  const levels = await Promise.all(shoreLevelsOf(manifest).map(shoreGrid).map(async (g) => ({ ...g, D: unpredict(await inflate(readFileSync(T(g.file))), g.dw, g.dh) })));
  return shoreSampler(levels).distance;
}
const lv0 = regionLevels(W)[0], RF = levelFor(lv0, 'full'), RP = levelFor(lv0, 'phone');
const FS = await field('full', RF), FB = await field('full', null), FP = await field('phone', RP);
const SS = await shoreOf(shoreManifest(lake.full, RF.composed)), SB = await shoreOf(lake.full);
const box = (() => { const L = RF.composed; return { x0: L.x0, z0: L.z0, x1: L.x0 + (L.w - 1) * L.step, z1: L.z0 + (L.h - 1) * L.step }; })();

test('the depth at the Ski Run pin through the live sampler: 22.85 m (desktop), within 0.5 m on a phone', () => {
  const d = -FS.height(11800, -875);
  assert.ok(Math.abs(d - 22.85) < 0.1, `${d.toFixed(2)} m`);
  assert.ok(Math.abs(-FP.height(11800, -875) - d) < 0.5, `phone ${(-FP.height(11800, -875)).toFixed(2)} m`);
  assert.equal(FS.spacing(11800, -875), 4); assert.equal(FP.spacing(11800, -875), 8);
  // the bay start reads the lake level there (32 m): the region level is what puts 4 m under her
  assert.equal(FB.spacing(11800, -875), 32);
});

// the steepest change per metre along lines across the level's four edges (1 m steps, 300 m in, 300 m out); onWater: only
// steps between two water points (the shore distance)
function steepest(S, { onWater = null, step = 1 } = {}) {
  let worst = 0, at = null;
  const lines = [];
  for (let k = 1; k < 40; k++) {
    const x = box.x0 + k * (box.x1 - box.x0) / 40, z = box.z0 + k * (box.z1 - box.z0) / 40;
    lines.push([x, box.z0 - 300, x, box.z0 + 300], [x, box.z1 - 300, x, box.z1 + 300], [box.x0 - 300, z, box.x0 + 300, z], [box.x1 - 300, z, box.x1 + 300, z]);
  }
  for (const [x0, z0, x1, z1] of lines) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step), len = Math.hypot(x1 - x0, z1 - z0) / n;
    let prev = S(x0, z0), pw = onWater?.(x0, z0);
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, d = S(x, z), w = onWater?.(x, z);
      if (!onWater || (w && pw)) { const s = Math.abs(d - prev) / len; if (s > worst) { worst = s; at = [Math.round(x), Math.round(z)]; } }
      prev = d; pw = w;
    }
  }
  return { worst, at };
}

test('the seams: no step where the south level blends into the basin and lake levels (heights and shore distance)', () => {
  // heights: across the edges the ground is no steeper than the coarser levels' own ground there (a crack or step would spike it)
  const h = steepest((x, z) => FS.height(x, z)), hb = steepest((x, z) => FB.height(x, z));
  assert.ok(h.worst < Math.max(1.5, 1.5 * hb.worst), `heights: ${h.worst.toFixed(2)} m/m at ${h.at} (coarse alone ${hb.worst.toFixed(2)})`);
  // on the water the blend band adds at most 0.1 m per metre of slope over the coarse levels' (the two beds agree within metres)
  const water = (x, z) => FS.height(x, z) < -2;
  const hw = steepest((x, z) => FS.height(x, z), { onWater: water }), hbw = steepest((x, z) => FB.height(x, z), { onWater: water });
  assert.ok(hw.worst < hbw.worst + 0.35, `bed: ${hw.worst.toFixed(3)} m/m at ${hw.at} (coarse alone ${hbw.worst.toFixed(3)})`);
  // the shore distance: at most 3 m per metre on the water across the edges (a distance field changes by 1 m per metre)
  const s = steepest(SS, { onWater: (x, z) => SS(x, z) < 0, step: 2 });
  assert.ok(s.worst <= 3, `shore: ${s.worst.toFixed(2)} m/m at ${s.at}`);
  // inside the level (past its blend) the shore distance is the south grid's: off Ski Run's pier it reads the 4 m grid, near
  // the lake-wide grids' value
  const pier = SS(12200, 200), coarse = SB(12200, 200);
  assert.ok(pier < 0 && Math.abs(pier - coarse) < 80, `off the pier ${pier.toFixed(0)} m (lake-wide ${coarse.toFixed(0)} m)`);
});

test('the wind: the pin is outside the wind\'s bay box (the level\'s reference), so it sails the open lake\'s wind', () => {
  const B = W.windBay, [x, z] = [11800, -875];
  assert.ok(!(x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1));
  // the level's reference (the bay box's mean factor) on the south start's ground against the bay start's: within 2 %
  const ref = (F) => { const wf = new WindField({ seed: 1, bay: B }); wf.setTerrain((a, b) => F.height(a, b)); return wf.refFactor('bay'); };
  const rs = ref(FS), rb = ref(FB);
  assert.ok(Math.abs(rs / rb - 1) < 0.02, `bay box factor: south start ${rs.toFixed(4)}, bay start ${rb.toFixed(4)}`);
});
