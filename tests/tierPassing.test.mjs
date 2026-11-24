// The quality tier passed into each create* (refactor Phase 2 step 3; src/quality/apply.js tierFor): every tier, on a
// desktop and on a phone, gives each module the same numbers the old load-time patch (applyBuild, the phone lines in
// boot) wrote into its constants, and no module's constants change any more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, TIER_ORDER, tierOf } from '../classic/src/quality/tiers.js';
import { tierFor } from '../classic/src/quality/apply.js';
import { STREAM, streamConfig } from '../classic/src/stream/config.js';
import { StreamManager } from '../classic/src/stream/manager.js';
import { AIR, airConfig, AirSim } from '../src/sim/air.js';
import { FARMAP, farMapFor, farMapSize } from '../classic/src/forest/far-map.js';
import { IMPOSTOR, FRAMES } from '../classic/src/forest/impostor.js';
import { LOD, SPLIT, lodLeaves } from '../classic/src/terrain-lod.js';
import { WindField, WIND_CACHE } from '../src/sim/wind.js';
import { BARK } from '../classic/src/forest/bark.js';
import { FOREST_KEEP, ForestStore } from '../classic/src/forest/scatter-tiles.js';
import { NAIP, NAIP_PHONE, naipPick, naipFile } from '../src/naip-layout.js';
import { KTX2, ktx2On } from '../classic/src/ktx2-layout.js';
import { CANOPY_SURFACE, canopyFile, canopySize } from '../classic/src/forest/canopy-surface.js';

const { BANDS, forestBands } = await import('../classic/src/trees.js');
const { TerrainLOD, TERRAIN_CACHE } = await import('../classic/src/terrain-mesh.js');

// what the old patch wrote, from the table (src/quality/apply.js applyBuild/applyLive and src/core/index.js before the change)
function oldPatch(name, phone) {
  const t = tierOf(name), phoneLow = phone && name === 'low';
  const bands = { ...BANDS }; for (const k of Object.keys(t.forest)) if (k in bands) bands[k] = t.forest[k];
  return {
    bands, keep: t.forest.KEEP ?? 1, framePx: t.forest.framePx, frames: t.forest.frames ?? 6, farMapCell: t.forest.farMapCell,
    air: { motes: t.air.motes, lines: t.air.lines, spray: t.air.spray },
    stream: { near: t.stream.near, mid: t.stream.mid, nearCap: t.stream.nearCap, budgetMs: t.stream.uploadMs, maxBudgetMs: t.stream.uploadMs * 2 },
    split: t.terrain.split,
    pick: phoneLow ? { bay: 8, region: 128 } : { bay: t.ground.bay, region: t.ground.region },
    canopyCell: phoneLow ? 16 : t.canopy.cell,
    ktx2: phoneLow ? { naip: false, ground: false, boat: false } : { naip: !!t.ktx2.naip, ground: !!t.ktx2.ground, boat: !!t.ktx2.boat },
    wind: phone ? { tex: 3, bins: 24, f32: true } : { tex: 8, bins: 24, f32: false },
    terrainCache: phone ? 250 : 600,
    bark: phone ? { slot: 256, photos: false } : { slot: 512, photos: true },
  };
}

const snapshot = () => JSON.stringify({ STREAM, AIR, FARMAP, IMPOSTOR, FRAMES, LOD, WIND_CACHE, TERRAIN_CACHE, BARK, FOREST_KEEP, BANDS, NAIP, KTX2, CANOPY_SURFACE });
const before = snapshot();

for (const name of TIER_ORDER) for (const phone of [false, true]) {
  test(`${name}${phone ? ' on a phone' : ''}: each create* gets the old patch's numbers`, () => {
    const tier = tierFor(name, { phone }), want = oldPatch(name, phone);
    assert.equal(tier.name, name);
    // the forest: its bands, the trees kept, the impostor atlas, the far map's texel, the bark
    const { BANDS: B, TB } = forestBands(tier.forest);
    assert.deepEqual(B, want.bands); assert.equal(TB.FAR, want.bands.FAR); assert.ok(TB.RIMFAR > 0);
    assert.equal(new ForestStore([], { keep: tier.forest.KEEP ?? 1 }).keep, want.keep);
    assert.equal(tier.forest.frames ?? 6, want.frames); assert.equal(tier.forest.framePx, want.framePx);
    const fm = farMapFor(tier); assert.equal(fm.cell, want.farMapCell);
    assert.deepEqual(farMapSize(fm), farMapSize({ ...FARMAP, cell: want.farMapCell }));
    assert.deepEqual({ ...BARK, ...tier.bark }, want.bark);
    // the air's pools (the mode reads core.tier.air)
    const air = new AirSim({ cfg: airConfig(1, tier.air), wind: { sample: () => ({ vx: 0, vz: 0, speed: 0 }) } });
    assert.equal(air.nMote, want.air.motes); assert.equal(air.nWisp, want.air.spray);
    assert.equal(airConfig(1, tier.air).lines.pool, want.air.lines);
    assert.equal(airConfig(2, tier.air).motes, want.air.motes, 'airboost keeps the tier\'s pools');
    // the stream: the manager's own copy, moved in play by setTier
    const sm = new StreamManager({ config: streamConfig(tier) });
    assert.deepEqual({ near: sm.cfg.bands.near, mid: sm.cfg.bands.mid, nearCap: sm.cfg.speed.nearCap, budgetMs: sm.cfg.upload.budgetMs, maxBudgetMs: sm.cfg.upload.maxBudgetMs }, want.stream);
    assert.equal(sm.budgetMs, want.stream.budgetMs); assert.equal(sm.view.nearR, want.stream.near);
    // the terrain: the split (live) and the chunks kept
    const lod = new TerrainLOD(null, { material: null, split: tier.terrain.split, ...(tier.terrainCache ? { cacheMax: tier.terrainCache } : {}) });
    assert.equal(lod.split, want.split); assert.equal(lod.cacheMax, want.terrainCache);
    const cam = { x: 500, y: 30, z: -400 };
    assert.deepEqual(lod.select(cam), lodLeaves(cam, null, want.split));
    // the wind field's caches
    assert.deepEqual(new WindField({ seed: 1, cache: tier.wind ?? null }).cache, want.wind);
    // the ground: the photo's level, the canopy's texel, the compressed set (and the boat's)
    const pick = naipPick(tier.ground);
    assert.deepEqual(pick, want.pick);
    assert.equal(naipFile('bay', pick)[0], naipFile('bay', want.pick)[0]);
    assert.equal(canopyFile(tier.canopy.cell), `canopy-bay-${want.canopyCell}m.webp`);
    assert.deepEqual(canopySize(tier.canopy.cell), canopySize(want.canopyCell));
    for (const g of ['naip', 'ground', 'boat']) assert.equal(ktx2On(g, '', tier.ktx2), want.ktx2[g], g);
  });
}

test('the live knobs move in play: the stream\'s radii and budget, the terrain\'s split (the governor\'s step down)', () => {
  const sm = new StreamManager({ config: streamConfig(tierFor('high')) });
  const lod = new TerrainLOD(null, { material: null, split: tierFor('high').terrain.split });
  const low = tierOf('low');
  sm.setTier(low); lod.setSplit(low.terrain.split);
  assert.equal(sm.cfg.bands.near, low.stream.near); assert.equal(sm.cfg.upload.maxBudgetMs, low.stream.uploadMs * 2);
  assert.equal(lod.split, low.terrain.split);
  assert.notEqual(sm.cfg, STREAM); assert.equal(STREAM.bands.near, TIERS.high.stream.near, 'the module\'s own numbers stay High\'s');
});

test('no tier: each module\'s own numbers (High\'s; the demos), and no module constant changed by any of the above', () => {
  assert.deepEqual(streamConfig(), STREAM); assert.equal(airConfig(), AIR); assert.equal(farMapFor(null), FARMAP);
  assert.equal(new TerrainLOD(null, { material: null }).split, SPLIT); assert.deepEqual(new WindField({ seed: 1 }).cache, WIND_CACHE);
  assert.deepEqual(naipPick(), NAIP.pick); assert.deepEqual(NAIP_PHONE, { bay: 8, region: 128 });
  assert.equal(snapshot(), before, 'the modules\' constants are as loaded');
  for (const c of [FARMAP, IMPOSTOR, LOD, WIND_CACHE, TERRAIN_CACHE, BARK, FOREST_KEEP, BANDS, KTX2, NAIP.pick]) assert.ok(Object.isFrozen(c));
});
