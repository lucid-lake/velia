// T4b / art/trees: the forest scatter, the species rules, the skyline map, the impostor's octahedral mapping, and the
// fetch map (plain JS; the three.js side is checked by the captures). Run: node --test tests/trees.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, fetchMap, heightAt } from '../src/sim/terrain.js';
import { scatterTrees, TREE_RULES, TREE_STRIDE, LOG_STRIDE, ROCK_STRIDE, scatterRowCount } from '../classic/src/trees-scatter.js';
import { SPECIES, SPECIES_INDEX, VARIANTS, SNAG, SHRUB, speciesWeight } from '../classic/src/forest/species.js';
import { horizonMap, HORIZON } from '../classic/src/forest/horizon.js';
import { octEncode, octDecode, frameBasis, FRAMES } from '../classic/src/forest/impostor.js';

const t = makeTerrain({ seed: 1 });
const s = scatterTrees(t, { seed: 1 });
const S = TREE_STRIDE;
const isTree = (i) => SPECIES[s.species[i]].kind === 'tree';

test('scatter: deterministic, and a forest-sized count', () => {
  const again = scatterTrees(makeTerrain({ seed: 1 }), { seed: 1 });
  assert.equal(again.count, s.count);
  assert.deepEqual(again.data.slice(0, 500), s.data.slice(0, 500));
  assert.deepEqual(again.species.slice(0, 500), s.species.slice(0, 500));
  let trees = 0; for (let i = 0; i < s.count; i++) if (isTree(i)) trees++;
  assert.ok(trees > 150000 && trees < 400000, `${trees} trees`);
  assert.ok(s.nLogs > 500 && s.nRocks > 5000, `${s.nLogs} logs, ${s.nRocks} rocks`);
});

test('scatter: row bands concatenate to the whole, value for value (the bake workers)', () => {
  const n = scatterRowCount(), parts = [[0, 100], [100, 400], [400, n]].map((rows) => scatterTrees(t, { seed: 1, rows }));
  const data = Float32Array.from(parts.flatMap((p) => Array.from(p.data)));
  assert.equal(data.length, s.data.length);
  assert.deepEqual(data, s.data);
  assert.deepEqual(Uint8Array.from(parts.flatMap((p) => Array.from(p.variant))), s.variant);
  assert.equal(parts.reduce((a, p) => a + p.nRocks, 0), s.nRocks);
});

test('scatter: every tree on dry ground below the treeline, clear of the shore band, inside its species\' slope', () => {
  const R = TREE_RULES;
  for (let i = 0; i < s.count; i += 7) {                                     // every 7th: ≈ 45,000 checks
    const [x, y, z, h] = s.data.slice(i * S, i * S + 4), sp = SPECIES[s.species[i]];
    assert.ok(y >= R.minH && y <= R.treeline + R.treelineJitter, `${sp.id} ${i} at ${y.toFixed(1)} m`);
    assert.ok(Math.abs(y - heightAt(x, z)) < 0.01, `${sp.id} ${i} stands ${(y - heightAt(x, z)).toFixed(3)} m off the ground`);
    assert.ok(t.shoreDistance(x, z) >= R.shoreGap, `${sp.id} ${i} ${t.shoreDistance(x, z).toFixed(1)} m from the shore`);
    const gx = (heightAt(x + 4, z) - heightAt(x - 4, z)) / 8, gz = (heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
    const slope = Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI;
    const onIsland = t.islandR(x, z) < 0.85;
    if (!onIsland) assert.ok(slope <= sp.slope + 1e-6, `${sp.id} ${i} on a ${slope.toFixed(0)}° slope (max ${sp.slope})`);
    if (sp.kind === 'tree') assert.ok(h >= 4 && h <= sp.heightM[1] * R.crest.boost + 1e-3, `${sp.id} ${i} ${h.toFixed(1)} m tall`);
    assert.ok(s.variant[i] < VARIANTS);
    const [, , , , , , gnx, gnz] = s.data.slice(i * S, i * S + 8);
    assert.ok(Math.hypot(gnx, gnz) <= 1.0001, 'the ground normal');
  }
});

test('scatter: species by elevation (Jeffrey pine and white fir low, red fir and hemlock high) and by the shore (lodgepole)', () => {
  const low = new Map(), high = new Map();
  let nearLodge = 0, nearAll = 0, inLodge = 0, inAll = 0;
  for (let i = 0; i < s.count; i++) {
    if (!isTree(i)) continue;
    const y = s.data[i * S + 1], id = SPECIES[s.species[i]].id, sd = t.shoreDistance(s.data[i * S], s.data[i * S + 2]);
    const m = y < 200 ? low : y > 450 ? high : null;
    if (m) m.set(id, (m.get(id) ?? 0) + 1);
    if (sd < 40) { nearAll++; if (id === 'lodgepole') nearLodge++; } else if (sd > 200 && sd < 400) { inAll++; if (id === 'lodgepole') inLodge++; }
  }
  const share = (m, id) => (m.get(id) ?? 0) / [...m.values()].reduce((a, b) => a + b, 0);
  assert.ok(share(low, 'jeffrey') + share(low, 'whitefir') > 0.4, `low: jeffrey ${share(low, 'jeffrey').toFixed(2)} white fir ${share(low, 'whitefir').toFixed(2)}`);
  assert.ok(share(high, 'redfir') > share(low, 'redfir') && share(high, 'redfir') > 0.3, `red fir low ${share(low, 'redfir').toFixed(2)} high ${share(high, 'redfir').toFixed(2)}`);
  assert.ok(share(high, 'hemlock') > share(low, 'hemlock'), 'hemlock higher up');
  assert.equal(share(low, 'hemlock'), 0, 'no hemlock at the lake');
  assert.ok(nearLodge / nearAll > 1.5 * (inLodge / inAll), `lodgepole at the water ${(nearLodge / nearAll).toFixed(2)} vs inland ${(inLodge / inAll).toFixed(2)}`);
});

test('scatter: aspect — white fir prefers north-facing slopes, Jeffrey pine south-facing', () => {
  let nFirN = 0, nFirS = 0, nJefN = 0, nJefS = 0;
  for (let i = 0; i < s.count; i++) {
    if (!isTree(i)) continue;
    const gnz = s.data[i * S + 7], id = SPECIES[s.species[i]].id;
    if (Math.abs(gnz) < 0.25) continue;
    const north = gnz < 0;
    if (id === 'whitefir') { if (north) nFirN++; else nFirS++; }
    if (id === 'jeffrey') { if (north) nJefN++; else nJefS++; }
  }
  assert.ok(nFirN / (nFirN + nFirS) > nJefN / (nJefN + nJefS), `white fir north share ${(nFirN / (nFirN + nFirS)).toFixed(2)}, jeffrey ${(nJefN / (nJefN + nJefS)).toFixed(2)}`);
});

test('scatter: mixed age (a quarter young), snags near the water, shrubs and boulders on steep granite, logs on gentle ground', () => {
  let young = 0, trees = 0, snags = 0, snagsNear = 0, shrubs = 0, shrubSteep = 0, nearTrees = 0;
  for (let i = 0; i < s.count; i++) {
    const sp = SPECIES[s.species[i]], h = s.data[i * S + 3], x = s.data[i * S], z = s.data[i * S + 2];
    if (sp.kind === 'tree') { trees++; if (h < sp.heightM[0] * 0.8) young++; if (t.shoreDistance(x, z) < TREE_RULES.snags.withinM) nearTrees++; }
    if (sp.kind === 'snag') { snags++; assert.equal(s.snag[i], 1); if (t.shoreDistance(x, z) < TREE_RULES.snags.withinM) snagsNear++; }
    if (sp.kind === 'shrub') { shrubs++; const gx = (heightAt(x + 4, z) - heightAt(x - 4, z)) / 8, gz = (heightAt(x, z + 4) - heightAt(x, z - 4)) / 8; if (Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI > TREE_RULES.shrubs.slopeDeg - 1) shrubSteep++; }
  }
  assert.ok(young / trees > 0.1 && young / trees < 0.45, `young ${(young / trees).toFixed(2)}`);
  assert.ok(snags > 1000 && snagsNear / (snagsNear + nearTrees) > 1.5 * ((snags - snagsNear) / (trees - nearTrees)), `${snags} snags; near the water ${(snagsNear / (snagsNear + nearTrees)).toFixed(3)} vs inland ${((snags - snagsNear) / (trees - nearTrees)).toFixed(3)}`);
  assert.ok(shrubs > 10000 && shrubSteep > 0.9 * shrubs, `${shrubs} shrubs, ${shrubSteep} on steep ground`);   // the island's brush sits on its gentler top too
  for (let i = 0; i < s.nRocks; i += 50) {
    const x = s.rocks[i * ROCK_STRIDE], z = s.rocks[i * ROCK_STRIDE + 2], r = s.rocks[i * ROCK_STRIDE + 3];
    assert.ok(r >= TREE_RULES.rocks.radiusM[0] && r <= TREE_RULES.rocks.radiusM[1], `rock ${i} r ${r}`);
    assert.ok(Math.abs(s.rocks[i * ROCK_STRIDE + 1] - heightAt(x, z)) < 0.01, `rock ${i} off the ground`);
  }
  for (let i = 0; i < s.nLogs; i += 10) {
    const x = s.logs[i * LOG_STRIDE], z = s.logs[i * LOG_STRIDE + 2], len = s.logs[i * LOG_STRIDE + 3];
    assert.ok(len >= TREE_RULES.logs.lenM[0] && len <= TREE_RULES.logs.lenM[1]);
    const gx = (heightAt(x + 4, z) - heightAt(x - 4, z)) / 8, gz = (heightAt(x, z + 4) - heightAt(x, z - 4)) / 8;
    assert.ok(Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI < 30, `log ${i} on steep ground`);
  }
});

test('scatter: spires on crests (crest trees taller on average than the rest)', () => {
  const R = TREE_RULES.crest;
  let cs = 0, cn = 0, os = 0, on = 0;
  for (let i = 0; i < s.count; i += 3) {
    if (!isTree(i)) continue;
    const [x, y, z, h] = s.data.slice(i * S, i * S + 4);
    const ring = (heightAt(x + R.ringM, z) + heightAt(x - R.ringM, z) + heightAt(x, z + R.ringM) + heightAt(x, z - R.ringM)) / 4;
    if (y - ring > R.fullM) { cs += h; cn++; } else { os += h; on++; }
  }
  assert.ok(cn > 100 && cs / cn > 1.1 * (os / on), `${cn} crest trees ${(cs / cn).toFixed(1)} m on average, others ${(os / on).toFixed(1)} m`);
});

test('scatter: thinning with height (more trees at 100–300 m than in the treeline\'s last 150 m), short at the treeline', () => {
  let low = 0, high = 0, hs = 0, hn = 0, ls = 0, ln = 0;
  for (let i = 0; i < s.count; i++) {
    if (!isTree(i)) continue;
    const y = s.data[i * S + 1], h = s.data[i * S + 3];
    const TL = TREE_RULES.treeline;
    if (y > 100 && y < 300) { low++; ls += h; ln++; } else if (y > TL - 150 && y < TL) { high++; hs += h; hn++; }
  }
  assert.ok(low > high, `${low} trees at 100–300 m, ${high} at 550–700 m`);
  assert.ok(hs / hn < 0.92 * (ls / ln), `treeline trees ${(hs / hn).toFixed(1)} m vs ${(ls / ln).toFixed(1)} m low`);
});

test('L2: no trees on the beach, round the stone house, in the creek gully or at the ruin; open conifer at the water', () => {
  let inside = 0;
  for (let i = 0; i < s.count; i++) if (t.keepOut(s.data[i * S], s.data[i * S + 2])) inside++;
  assert.equal(inside, 0, `${inside} in a keep-out`);
  let nearN = 0, inN = 0;
  for (let i = 0; i < s.count; i++) {
    if (!isTree(i)) continue;
    const x = s.data[i * S], z = s.data[i * S + 2], sd = t.shoreDistance(x, z);
    if (Math.abs(x) > 2000 || z < -1600 || z > 2200) continue;          // the bay
    if (sd < 40) nearN++; else if (sd > 150 && sd < 300) inN++;
  }
  assert.ok(nearN / 34 < 0.7 * (inN / 150), `near the water ${(nearN / 34).toFixed(1)} per m of band, inland ${(inN / 150).toFixed(1)}`);
});

test('scatter: the shared land cover is honoured (rock: no trees; urban and snow: nothing)', () => {
  const cover = (x, z) => (x < 0 ? 'rock' : z < 0 ? 'urban' : 'forest');
  const c = scatterTrees({ ...t, coverAt: undefined, cover }, { seed: 1, rows: [300, 340] });   // the name form (the real terrain's coverAt would win)
  for (let i = 0; i < c.count; i++) {
    const x = c.data[i * S], z = c.data[i * S + 2];
    if (x < 0) assert.notEqual(SPECIES[c.species[i]].kind, 'tree', 'a tree on rock');
    else assert.ok(z >= 0, 'something in the town');
  }
});

test('species: the weight bands (elevation, slope, shore)', () => {
  const J = SPECIES[SPECIES_INDEX.jeffrey], RF = SPECIES[SPECIES_INDEX.redfir], L = SPECIES[SPECIES_INDEX.lodgepole];
  assert.ok(speciesWeight(J, { elevM: 100, elevScale: 0.7 }) > 0);
  assert.equal(speciesWeight(J, { elevM: 100, slopeDeg: 45 }), 0, 'too steep');
  assert.equal(speciesWeight(RF, { elevM: 50, elevScale: 0.7 }), 0, 'red fir not at the lake');
  assert.ok(speciesWeight(RF, { elevM: 500, elevScale: 0.7 }) > 0);
  assert.ok(speciesWeight(L, { elevM: 20, shoreM: 10 }) > 1.5 * speciesWeight(L, { elevM: 20, shoreM: 500 }), 'lodgepole at the water');
  assert.equal(SNAG, SPECIES_INDEX.snag); assert.equal(SHRUB, SPECIES_INDEX.manzanita);
});

test('horizon: row bands equal the whole; the bay\'s west shore sees a higher west skyline than the open lake', () => {
  const all = horizonMap(t.heightAt);
  const bands = [[0, 60], [60, 256]].map((rows) => horizonMap(t.heightAt, { rows }));
  assert.equal(all.length, HORIZON.size * HORIZON.size * HORIZON.dirs);
  assert.deepEqual(Uint8Array.from([...bands[0], ...bands[1]]), all);
  const Sz = HORIZON.size, cell = (HORIZON.region.x1 - HORIZON.region.x0) / Sz;
  const at = (x, z, k) => all[((Math.floor((z - HORIZON.region.z0) / cell)) * Sz + Math.floor((x - HORIZON.region.x0) / cell)) * 8 + k] * 90 / 255;
  assert.ok(at(-700, -300, 6) > 8, `west shore, west bin ${at(-700, -300, 6).toFixed(1)}°`);   // the bay's west wall
  assert.ok(at(-700, -300, 6) > at(0, -3000, 6), 'the open lake sees less');
  for (let p = 0; p < all.length; p += 997) assert.ok(all[p] <= 255);
});

test('impostor: the hemi-octahedral mapping round-trips, and the frame grid covers the horizon and the zenith', () => {
  for (const d of [[0, 1, 0], [1, 0, 0], [0, 0, 1], [-0.6, 0.2, 0.7], [0.3, 0.9, -0.3]]) {
    const l = Math.hypot(...d), u = d.map((v) => v / l), [eu, ev] = octEncode(...u), back = octDecode(eu, ev);
    assert.ok(eu >= 0 && eu <= 1 && ev >= 0 && ev <= 1);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - u[k]) < 1e-9, `${d}: ${back} vs ${u}`);
  }
  assert.deepEqual(octDecode(0.5, 0.5).map((v) => +v.toFixed(6)), [0, 1, 0], 'the centre is straight up');
  const corner = octDecode(0, 0); assert.ok(Math.abs(corner[1]) < 1e-9, 'a corner is on the horizon');
  const { right, up } = frameBasis([1, 0, 0]);
  assert.deepEqual(up.map((v) => +v.toFixed(6)), [0, 1, 0]); assert.deepEqual(right.map((v) => +v.toFixed(6)), [0, 0, -1]);
  assert.equal(FRAMES, 6);
});

const F = fetchMap(128, 4096);
const at = (x, z, k) => {
  const c = F.extent / F.size, i = Math.floor((x - (F.cx - F.extent / 2)) / c), j = Math.floor((z - (F.cz - F.extent / 2)) / c);
  return F.data[(j * F.size + i) * F.dirs + k];
};

test('fetch: layout, cache, land is zero', () => {
  assert.equal(F.data.length, 128 * 128 * 16);
  assert.equal(fetchMap(128, 4096), F, 'the second call returns the cached map');
  let land = 0;
  for (let j = 0; j < 128; j += 4) for (let i = 0; i < 128; i += 4) {
    const x = F.cx - F.extent / 2 + (i + 0.5) * 32, z = F.cz - F.extent / 2 + (j + 0.5) * 32;
    if (heightAt(x, z) > 1) { land++; for (let k = 0; k < 16; k++) assert.equal(F.data[(j * 128 + i) * 16 + k], 0); }
  }
  assert.ok(land > 50);
});

test('fetch: up the bay for a south-west wind at cam B, the open lake for a north-east one, short across', () => {
  // cam B (800, −560) in Emerald Bay: ≈ 1.5 km of water up the bay to its head (SW), the open lake through the mouth
  // (NE: the cap), ≈ 0.5 km east to Eagle Point's shore
  assert.ok(at(800, -560, 10) > 1200 && at(800, -560, 10) < 1900, `south-west ${at(800, -560, 10)} m`);
  assert.ok(at(800, -560, 2) >= 5000, `north-east ${at(800, -560, 2)} m`);
  assert.ok(at(800, -560, 4) < 700, `east ${at(800, -560, 4)} m`);
});

test('fetch: matches a fine brute-force march to within two mask cells', () => {
  const cell = F.extent / (F.size * 2);
  for (const [x, z] of [[800, -560], [1050, -820], [350, -250], [-250, 80]]) {
    const i = Math.floor((x - (F.cx - F.extent / 2)) / 32), j = Math.floor((z - (F.cz - F.extent / 2)) / 32);
    const tx = F.cx - F.extent / 2 + (i + 0.5) * 32, tz = F.cz - F.extent / 2 + (j + 0.5) * 32;   // the texel centre
    for (const k of [0, 3, 6, 9, 12, 15]) {
      const a = k * 22.5 * Math.PI / 180, fx = Math.sin(a), fz = -Math.cos(a);
      let d = 0; while (d < F.cap && heightAt(tx + fx * d, tz + fz * d) < 0) d += 1;
      assert.ok(Math.abs(F.data[(j * F.size + i) * 16 + k] - d) <= 2 * cell + 1, `(${x}, ${z}) dir ${k * 22.5}°: map ${F.data[(j * F.size + i) * 16 + k]} m, march ${d} m`);
    }
  }
});
