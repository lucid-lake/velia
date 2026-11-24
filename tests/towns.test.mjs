// art/towns: the towns, ski runs, roads and lights data and layout. Run: node --test tests/towns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toUTM, fromUTM } from '../src/sim/geo/utm.js';
import { loadTownsData, buildTownsLayout, BSTRIDE, LSTRIDE } from '../classic/src/towns-layout.js';
import { lonLatToWorld } from '../src/sim/geo.js';

const data = await loadTownsData();
const flat = () => 5;                       // a flat shore 5 m above the lake: placement without the terrain's say
const L = buildTownsLayout(data, { heightAt: flat, lonLatToWorld });
const W = (lon, lat) => lonLatToWorld(lon, lat);

test('UTM 10N: round trip, and the island against the Krüger series (at lon0 −123°, k0 0.9996)', () => {
  for (const [lat, lon] of [[38.9542, -120.1001], [39.25, -119.95], [38.91, -120.2]]) {
    const u = toUTM(lat, lon), g = fromUTM(u.e, u.n);
    assert.ok(Math.abs(g.lat - lat) < 1e-7 && Math.abs(g.lon - lon) < 1e-7, `${lat},${lon} → ${g.lat},${g.lon}`);
  }
  const f = toUTM(38.954193, -120.100083);   // Karney's series gives 751293.43, 4315693.38
  assert.ok(Math.abs(f.e - 751293.43) < 0.05 && Math.abs(f.n - 4315693.38) < 0.05, `${f.e.toFixed(2)}, ${f.n.toFixed(2)}`);
});

test('the data carries no names (no businesses, resorts or buildings on screen or in the file)', () => {
  const raw = readFileSync(new URL('../data/geo/tahoe-towns.json', import.meta.url), 'utf8');
  assert.equal(/"name"\s*:/.test(raw), false);
  for (const brand of ['Harrah', 'Harvey', 'Caesar', 'Bally', 'Nugget', 'Heavenly', 'Palisades', 'Northstar', 'Diamond Peak', 'Mount Rose', 'Homewood'])
    assert.equal(raw.includes(brand), false, brand);
  for (const a of data.skiAreas) assert.match(a.id, /^[a-z-]+$/);
  assert.match(data.meta.licence, /ODbL/);
});

test('deterministic: two builds are equal, value for value', () => {
  const M = buildTownsLayout(data, { heightAt: flat, lonLatToWorld });
  assert.deepEqual(M.buildings.data, L.buildings.data);
  assert.deepEqual(M.lights.data, L.lights.data);
  assert.deepEqual(M.mask.data, L.mask.data);
  assert.deepEqual(M.fine.data, L.fine.data);
});

test('the towns: twenty thousand buildings; the Stateline high-rises 45 m and up', () => {
  assert.ok(L.buildings.count > 20000, `${L.buildings.count}`);
  const [sx, sz] = W(-119.941, 38.960), B = L.buildings.data;
  let tall = 0;
  for (let k = 0; k < L.buildings.count; k++) {
    const o = k * BSTRIDE;
    if (Math.hypot(B[o] - sx, B[o + 2] - sz) < 600 && B[o + 1] + B[o + 6] - B[o + 12] >= 45) tall++;
  }
  assert.ok(tall >= 4 && tall <= 6, `${tall} high-rises`);
  // the clusters: each sorted by size, largest first (the LOD draws a prefix)
  for (const c of L.clusters) for (let i = 1; i < c.count; i++) assert.ok(c.sizes[i] <= c.sizes[i - 1]);
});

test('the masks: runs on the ski areas, none on the open lake; the Hwy 89 cut in the bay window', () => {
  const lake = L.coverAt(...W(-120.03, 39.10));
  assert.deepEqual([lake.built, lake.ski, lake.road, lake.lawn], [0, 0, 0, 0]);
  assert.equal(L.keepOut(...W(-120.03, 39.10)), false);
  // the longest run's middle is cleared and kept free of trees
  const run = data.runs.filter((r) => !r.glade && !r.area).sort((a, b) => b.p.length - a.p.length)[0];
  const m = (run.p.length / 2 >> 1) * 2, g = fromUTM(run.p[m] + data.origin[0], run.p[m + 1] + data.origin[1]);
  const at = W(g.lon, g.lat);
  assert.ok(L.coverAt(...at).ski > 0.6, `ski ${L.coverAt(...at).ski}`);
  assert.equal(L.keepOut(...at), true);
  // every building's centre is kept free of trees
  for (let k = 0; k < L.buildings.count; k += 997) assert.equal(L.inFootprint(L.buildings.data[k * BSTRIDE], L.buildings.data[k * BSTRIDE + 2]), true);
  let asphalt = 0, cut = 0;
  for (let i = 0; i < L.fine.data.length; i += 2) { if (L.fine.data[i] > 128) asphalt++; if (L.fine.data[i + 1] > 64) cut++; }
  assert.ok(asphalt * 6.25 > 20000, `Hwy 89 asphalt ${asphalt * 6.25} m²`);   // ≥ 2 km of an 11 m road in the window
  assert.ok(cut > 0);
  // towns thin the forest, they do not clear it
  const town = L.treeDensity(...W(-119.99, 38.925));
  assert.ok(town >= 0.5 && town < 1, `${town}`);
});

test('night lights: thousands, warm and cool, each on its own sun elevation', () => {
  assert.ok(L.lights.count > 15000, `${L.lights.count}`);
  let sodium = 0, minOn = Infinity, maxOn = -Infinity;
  for (let k = 0; k < L.lights.count; k++) {
    const o = k * LSTRIDE, on = L.lights.data[o + 7];
    minOn = Math.min(minOn, on); maxOn = Math.max(maxOn, on);
    if (L.lights.data[o + 5] < 0.2) sodium++;
  }
  assert.ok(minOn >= -7 && maxOn <= 3, `${minOn} … ${maxOn}`);
  assert.ok(sodium > 500, `${sodium} sodium`);
});

test('the real piers: OSM lines as root → head on the real terrain, for the shoreline module', async () => {
  const { heightAt } = await import('../src/sim/terrain.js');
  const R = buildTownsLayout(data, { heightAt, lonLatToWorld });
  assert.ok(R.osmPiers.length > 300, `${R.osmPiers.length}`);
  for (const p of R.osmPiers.slice(0, 200)) {
    assert.ok(p.length >= 8 && Math.abs(Math.hypot(p.dirX, p.dirZ) - 1) < 1e-6);
    assert.ok(heightAt(p.x + p.dirX * p.length, p.z + p.dirZ * p.length) <= -0.3, 'the head is over water');
  }
});

test('the masks travel: a band\'s bundle gives the same keepOut and treeDensity as the whole layout', async () => {
  const { maskBundle, makeQueries } = await import('../classic/src/towns-layout.js');
  const z0 = -3000, z1 = -1500, Q = makeQueries(maskBundle(L, z0, z1));
  let n = 0, out = 0;
  for (let i = 0; i < 4000; i++) {
    const x = -4000 + (i * 7919) % 10000, z = z0 + ((i * 104729) % 1500);
    assert.equal(Q.keepOut(x, z), L.keepOut(x, z), `${x}, ${z}`);
    assert.ok(Math.abs(Q.treeDensity(x, z) - L.treeDensity(x, z)) < 1e-9);
    n++; if (L.keepOut(x, z)) out++;
  }
  assert.ok(n === 4000);
  // and a prebuilt layout (the worker's masks) equals a fresh one
  const P = buildTownsLayout(data, { heightAt: flat, lonLatToWorld, prebuilt: { mask: L.mask, fine: L.fine } });
  assert.deepEqual(P.mask.data, L.mask.data); assert.deepEqual(P.fine.data, L.fine.data);
});

test('the bake gives the same trees: scatter and rim bands with a mask bundle equal the in-place masks', async () => {
  const { maskBundle, makeQueries } = await import('../classic/src/towns-layout.js');
  const { scatterTrees, TREE_RULES, RIM_RULES } = await import('../classic/src/trees-scatter.js');
  const ter = await import('../src/sim/terrain.js');
  const T = ter.makeTerrain({ seed: 1 });
  const R = buildTownsLayout(data, { heightAt: ter.heightAt, lonLatToWorld, masksOnly: true });
  const whole = { keepOut: R.keepOut, treeDensity: R.treeDensity };
  // the bay's band over Hwy 89's south wall; the rim's over Stateline (z ≈ −700) and over the south shore's town
  for (const [rules, rows] of [[TREE_RULES, [560, 600]], [RIM_RULES, [768, 790]], [RIM_RULES, [830, 850]]]) {
    const zBand = [rules.region.z0 + rows[0] * rules.cell, rules.region.z0 + rows[1] * rules.cell];
    const towns = makeQueries(maskBundle({ mask: R.mask, fine: R.fine, foot: R.foot }, ...zBand));
    const a = scatterTrees(T, { seed: 1, rules, rows, towns }), b = scatterTrees(T, { seed: 1, rules, rows, towns: whole });
    assert.equal(a.count, b.count, `${rules === RIM_RULES ? 'rim' : 'bay'} rows ${rows}`);
    assert.deepEqual(a.data, b.data);
    const none = scatterTrees(T, { seed: 1, rules, rows });
    // over Stateline the masks change the stand: without them NLCD's built ground stands bare; with them the town keeps
    // 55 % of its trees and loses its footprints, roads and lots
    if (rules === RIM_RULES && rows[0] === 768) assert.ok(a.count > none.count, `the town keeps its pines (${a.count} vs ${none.count} bare)`);
  }
});
