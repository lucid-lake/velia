// L4: the shoreline layout (src/shoreline-layout.js; the three.js side is checked by the demo captures).
// Run: node --test tests/shoreline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain } from '../src/sim/terrain.js';
import { layoutShoreline, SHORE_RULES as R } from '../src/shoreline-layout.js';

const terrain = makeTerrain({ seed: 1 });
const L = layoutShoreline(terrain, { seed: 1 });
const sd = (p) => terrain.shoreDistance(p.x, p.z);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('deterministic for a seed, different for another', () => {
  const again = layoutShoreline(makeTerrain({ seed: 1 }), { seed: 1 });
  assert.deepEqual(again.piers, L.piers);
  assert.deepEqual(again.tower, L.tower);
  const other = layoutShoreline(terrain, { seed: 2, shore: L.shore.map((p) => ({ ...p })) });
  assert.notDeepEqual(other.piers.map((q) => q.s), L.piers.map((q) => q.s));
});

test('the shoreline is the lake\'s own loop, on the shore, normals to the water', () => {
  assert.ok(L.shore.length * R.resample > 8000, `${(L.shore.length * R.resample / 1000).toFixed(1)} km of shore`);
  // the normal points to the water 10 m out, but for the few points in the creek's lagoon at the head (< 10 m wide)
  const wrong = L.shore.filter((p) => terrain.shoreDistance(p.x + p.nx * 10, p.z + p.nz * 10) >= 0).length;
  assert.ok(wrong / L.shore.length < 0.02, `${wrong} of ${L.shore.length} normals miss the water`);
  for (const p of L.shore) {
    assert.ok(Math.abs(sd(p)) < 3, `shore point ${sd(p).toFixed(2)} m off the line`);   // the 8 m trace over a 4–20 m distance grid
    assert.ok(terrain.shoreDistance(p.x + p.nx * 2, p.z + p.nz * 2) < 1, 'the normal points to the water');
  }
});

test('piers: 100–200 m apart along the developed shore, 30–60 m, straight out, over water, ending deep enough', () => {
  assert.ok(L.piers.length >= 15, `${L.piers.length} piers`);   // L2's steeper walls leave less gentle shore (19 at seed 1; was ≥ 20)
  const bh = L.piers.filter((q) => q.boathouse).length / L.piers.length;
  assert.ok(bh > 0.2 && bh < 0.6, `boathouses on ${(bh * 100).toFixed(0)} %`);
  L.piers.forEach((q, i) => {
    assert.ok(q.length >= R.pier.length[0] && q.length <= R.pier.length[1], `pier ${i} ${q.length.toFixed(1)} m`);
    assert.ok(Math.abs(sd(q)) < 1.5, `pier ${i} root ${sd(q).toFixed(1)} m from the shore`);
    for (let a = 4; a <= q.length; a += 2) assert.ok(terrain.shoreDistance(q.x + q.dirX * a, q.z + q.dirZ * a) < 0, `pier ${i} crosses land at ${a} m`);
    assert.ok(q.endDepth >= R.pier.minDepth, `pier ${i} ends in ${q.endDepth.toFixed(2)} m`);
    if (i) assert.ok(q.s - L.piers[i - 1].s >= R.pier.spacing[0] - 1e-9, `piers ${i - 1}–${i} ${(q.s - L.piers[i - 1].s).toFixed(0)} m apart`);
    for (const j of L.piers.keys()) if (j !== i) assert.ok(d2(q, L.piers[j]) > 60, `piers ${i} and ${j} ${d2(q, L.piers[j]).toFixed(0)} m apart`);
  });
  // none at the reserved places
  for (const q of L.piers) {
    assert.ok(d2(q, L.places.bayHead) >= R.reserve.bayHeadM && d2(q, L.places.headland) >= R.reserve.headlandM, 'a pier at a reserved place');
    for (const m of L.places.mouth) assert.ok(d2(q, m) >= R.reserve.mouthM, 'a pier at the bay mouth');
  }
});

test('no floats (owner, 2026-11-05): no mooring balls, no boats on them, no hazard or 5-mph buoys', () => {
  assert.deepEqual([L.balls, L.field, L.hazards, L.speedLine], [[], [], [], []]);
});

test('the tower on the headland\'s rock', () => {
  const T = L.tower;
  assert.ok(sd(T) > 0 && sd(T) < 20, `the tower ${sd(T).toFixed(1)} m inland`);
  assert.ok(Math.abs(T.y - terrain.heightAt(T.x, T.z)) < 1e-9 && T.y > 0, 'on the ground');
  assert.ok(d2(T, L.places.headland) < R.reserve.headlandM, 'on the headland');
});

test('createShoreline draws the piers, the boathouses and the tower, nothing on the water', async () => {
  const { createShoreline } = await import('../classic/src/shoreline.js');   // three.js maths runs in node
  const s = createShoreline({ terrain, seed: 1, layout: L });
  const names = s.group.children.map((o) => o.name);
  assert.deepEqual(names, ['pier-decks', 'pier-pilings', 'boathouse-walls', 'boathouse-roofs', 'boathouse-doors', 'light-tower']);
  assert.equal(s.stats.piers, L.piers.length); assert.equal(s.stats.boathouses, L.piers.filter((q) => q.boathouse).length);
});

test('L2: no pier on keep-out ground (the beach, the stone house, the creek) or in the mouth channel', () => {
  if (!terrain.keepOut || !terrain.mouth) return;   // the pre-L2 basin has neither
  const [ax, az] = terrain.mouth.a, [bx, bz] = terrain.mouth.b, vx = bx - ax, vz = bz - az;
  for (const q of L.piers) {
    for (const k of [0, 10]) assert.ok(!terrain.keepOut(q.x - q.dirX * k, q.z - q.dirZ * k), `pier at (${q.x.toFixed(0)}, ${q.z.toFixed(0)}) on keep-out ground`);
    const u = Math.max(0, Math.min(1, ((q.x - ax) * vx + (q.z - az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(q.x - ax - u * vx, q.z - az - u * vz);
    assert.ok(d >= 190 + R.reserve.channelM, `pier at (${q.x.toFixed(0)}, ${q.z.toFixed(0)}) ${d.toFixed(0)} m from the channel's axis`);
  }
});
