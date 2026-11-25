// The lake-wide shore distance (v2/sim/lake.js + terrain/levels.js SHORE_LEVELS): the island's and the bay's fine grids,
// then v1's basin (20 m) and lake (64 m) grids as the fallbacks, so v2's lake answers anywhere on the water.
//   - v1's shoreDistance (src/sim/terrain.js, all of v1's grids) within 60 m at named points past the bay and on a lattice
//     of the lake's near-shore water; where v1's basin grid reads too far (its north-east), the lake grid's value instead
//   - the bay unchanged: the bay grid's interior reads exactly what the island and bay grids alone read
//   - no step at any grid's edge: on the water, the distance changes by at most 3 m per metre across each edge (a distance
//     field changes by 1 m per metre; two grids that differ by up to the repair's 3 lake texels, blended over 240 m, add
//     up to 2 more); the check fails on v1's unrepaired basin (7.4 km over its 240 m blend: 45 m per metre)
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { heightAt, shoreDistance, shoreLevels, manifests } from './helpers/ground.mjs';
import { shoreDistance as v1Shore } from '../../src/sim/terrain.js';   // the parity reference: v1's sampler on all its grids
import { shoreSampler, SHORE_LEVELS, SHORE_REPAIR, shoreFiles } from '../sim/lake.js';

const LV = await shoreLevels();
const named = (names) => LV.filter((L) => names.includes(L.name));
const BAY = LV.find((L) => L.name === 'bay'), BASIN = LV.find((L) => L.name === 'basin');
const edge = (L) => ({ x0: L.dx0, x1: L.dx0 + (L.dw - 1) * L.dstep, z0: L.dz0, z1: L.dz0 + (L.dh - 1) * L.dstep });

// past the bay (x > 3,325): the south shore (Ski Run, El Dorado, the Tahoe Keys, Camp Richardson), the lake's middle, the
// west shore; m: the shore distance, negative on the water
const POINTS = {
  'off Ski Run': [12000, -250], 'off Camp Richardson': [5900, 1500], 'off the Tahoe Keys': [9000, 1000], 'El Dorado beach': [10500, 1200],
  'the lake\'s middle': [5000, -20000], 'east of the bay': [4000, -3000],
};

test('the lake-wide grids ship: island, bay, then basin and lake, the same files in both sets (+516 kB)', () => {
  assert.deepEqual([...SHORE_LEVELS], ['island', 'bay', 'basin', 'lake']);
  const full = shoreFiles(manifests.full), phone = shoreFiles(manifests.phone);
  assert.deepEqual(full, phone, 'the phone set reads the same shore grids');
  const size = (f) => statSync(new URL(`../../terrain/${f}`, import.meta.url)).size;
  const added = size('basin-d.lsh') + size('lake-d.lsh');
  assert.ok(added > 500e3 && added < 530e3, `${added} B added`);
});

test('past the bay the shore distance is v1\'s (within 60 m), not the bay grid\'s edge', () => {
  const bayOnly = shoreSampler(named(['island', 'bay'])).distance;
  for (const [name, [x, z]] of Object.entries(POINTS)) {
    const v2 = shoreDistance(x, z), v1 = v1Shore(x, z);
    assert.ok(heightAt(x, z) < 0 || name === 'El Dorado beach', `${name} is on the water`);
    assert.ok(Math.abs(v2 - v1) <= 60, `${name}: v2 ${v2.toFixed(0)} m, v1 ${v1.toFixed(0)} m`);
  }
  // the bay grid's edge value, as before: off Ski Run 1,365 m against 569 m, the lake's middle 1,547 m against 7,087 m
  assert.ok(Math.abs(bayOnly(...POINTS['off Ski Run']) - v1Shore(...POINTS['off Ski Run'])) > 500, 'the bay grid alone was far off');
  assert.ok(Math.abs(bayOnly(...POINTS['the lake\'s middle']) - v1Shore(...POINTS['the lake\'s middle'])) > 5000);
});

test('the lake\'s near-shore water: v1\'s shore distance within 60 m on a 400 m lattice (within 1 km of the shore)', () => {
  let n = 0, worst = 0, at = null;
  for (let z = -45000; z <= 15000; z += 400) for (let x = -13000; x <= 26000; x += 400) {
    if (heightAt(x, z) >= 0) continue;
    const v1 = v1Shore(x, z); if (v1 < -1000) continue;
    const d = Math.abs(shoreDistance(x, z) - v1); n++;
    if (d > worst) { worst = d; at = [x, z]; }
  }
  assert.ok(n > 500, `${n} points`);
  assert.ok(worst <= 60, `the worst ${worst.toFixed(1)} m at ${at}`);
});

test('where v1\'s basin grid reads too far (its north-east, the nearest shore outside its box), v2 reads the lake grid', () => {
  const v1Way = shoreSampler(LV, { repair: [] }).distance, lakeOnly = shoreSampler(named(['lake'])).distance;
  const [x, z] = [10000, -9000];
  assert.ok(Math.abs(v1Way(x, z) - v1Shore(x, z)) < 1e-6, 'without the repair the sampler is v1\'s');
  assert.ok(v1Shore(x, z) < -9000, `v1: ${v1Shore(x, z).toFixed(0)} m`);
  assert.ok(Math.abs(shoreDistance(x, z) - lakeOnly(x, z)) < 1, `v2 ${shoreDistance(x, z).toFixed(0)} m, the lake grid ${lakeOnly(x, z).toFixed(0)} m`);
  assert.deepEqual([...SHORE_REPAIR], ['basin']);
  assert.ok(shoreSampler(LV).repaired > 50000, 'tens of thousands of the basin\'s texels eased');
});

test('the bay unchanged: inside the bay grid (clear of its 12-texel blend) the distance is the island and bay grids\' alone', () => {
  const bayOnly = shoreSampler(named(['island', 'bay'])).distance, e = edge(BAY), m = 12 * BAY.dstep;
  let n = 0;
  for (let z = e.z0 + m; z <= e.z1 - m; z += 23) for (let x = e.x0 + m; x <= e.x1 - m; x += 29) {
    assert.equal(shoreDistance(x, z), bayOnly(x, z), `(${x}, ${z})`); n++;
  }
  assert.ok(n > 10000);
});

// the steepest change per metre on the water along lines across a grid's four edges (2 m steps, 400 m in, 300 m out)
function steepest(S, L) {
  const e = edge(L), lines = [], step = (e.x1 - e.x0) / 40;
  for (let k = 1; k < 40; k++) {
    const x = e.x0 + k * step, z = e.z0 + k * (e.z1 - e.z0) / 40;
    lines.push([x, e.z0 - 300, x, e.z0 + 400], [x, e.z1 - 400, x, e.z1 + 300], [e.x0 - 300, z, e.x0 + 400, z], [e.x1 - 400, z, e.x1 + 300, z]);
  }
  let worst = 0, at = null;
  for (const [x0, z0, x1, z1] of lines) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2), len = Math.hypot(x1 - x0, z1 - z0) / n;
    let prev = S(x0, z0);
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, d = S(x, z);
      if (d < 0 && prev < 0) { const s = Math.abs(d - prev) / len; if (s > worst) { worst = s; at = [Math.round(x), Math.round(z)]; } }
      prev = d;
    }
  }
  return { worst, at };
}

test('no step at the grids\' edges: on the water at most 3 m of distance per metre across the bay\'s and the basin\'s edges', () => {
  for (const L of [BAY, BASIN]) {
    const { worst, at } = steepest(shoreDistance, L);
    assert.ok(worst <= 3, `${L.name}: ${worst.toFixed(2)} m/m at ${at}`);
  }
  // the check can fail: v1's unrepaired basin changes by kilometres over its 240 m blend into the lake grid
  const v1Way = shoreSampler(LV, { repair: [] }).distance;
  assert.ok(steepest(v1Way, BASIN).worst > 10, 'v1\'s basin edge steps');
});
