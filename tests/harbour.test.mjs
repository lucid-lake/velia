// The harbour layout's contract (src/harbour-layout.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harbourLayout, insidePolygon, fitShore, harbourSite } from '../src/harbour-layout.js';
import { makeTerrain, LAKE } from '../src/sim/terrain.js';

const terrain = makeTerrain({ seed: 1 });
const L = harbourLayout({ terrain, seed: 1 });

// a boat's footprint as a rectangle; separating-axis overlap test, with a margin in metres
function corners(b, grow = 0) {
  const [dx, dz] = b.dir, px = -dz, pz = dx, hl = b.length / 2 + grow, hw = b.beam / 2 + grow;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => [b.x + dx * hl * s + px * hw * t, b.z + dz * hl * s + pz * hw * t]);
}
function overlap(A, B) {
  for (const poly of [A, B]) for (let i = 0; i < 4; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4], ax = z1 - z0, az = x0 - x1;
    const pa = A.map(([x, z]) => x * ax + z * az), pb = B.map(([x, z]) => x * ax + z * az);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
const dockRect = (d) => {
  const l = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
  return { x: (d.a[0] + d.b[0]) / 2, z: (d.a[1] + d.b[1]) / 2, dir: [(d.b[0] - d.a[0]) / l, (d.b[1] - d.a[1]) / l], length: l, beam: d.width };
};

test('60–80 slips, 80–90 % taken, sailboats and runabouts', () => {
  assert.ok(L.slips.length >= 60 && L.slips.length <= 80, `${L.slips.length} slips`);
  const share = L.boats.length / L.slips.length;
  assert.ok(share >= 0.75 && share <= 0.95, `occupancy ${share.toFixed(2)}`);
  const sail = L.boats.filter((b) => b.type === 'sail').length;
  assert.ok(sail > L.boats.length / 2 && sail < L.boats.length, `${sail} of ${L.boats.length} sailboats`);
});

test('every boat floats inside the breakwaters, in ≥ 2 m of water', () => {
  for (const b of L.boats) {
    assert.ok(insidePolygon(L.enclosure, b.x, b.z), `boat at slip ${b.slip} outside the basin`);
    for (const [x, z] of corners(b)) assert.ok(terrain.heightAt(x, z) < -2, `boat at slip ${b.slip}: ${terrain.heightAt(x, z).toFixed(2)} m at a corner`);
  }
});

test('no boat touches another boat, a dock, a finger or a pile (0.2 m margin)', () => {
  const B = L.boats.map((b) => corners(b, 0.2));
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) assert.ok(!overlap(B[i], B[j]), `boats ${i} and ${j} overlap`);
  const D = L.docks.map((d) => corners(dockRect(d)));
  for (let i = 0; i < B.length; i++) for (let j = 0; j < D.length; j++) assert.ok(!overlap(B[i], D[j]), `boat ${i} hits dock ${j} (${L.docks[j].kind})`);
  for (let i = 0; i < B.length; i++) for (const [x, z] of L.piles) {
    const P = corners({ x, z, dir: [1, 0], length: 0.4, beam: 0.4 });
    assert.ok(!overlap(B[i], P), `boat ${i} hits a pile at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  }
});

test('the entrance is 25–45 m clear, in deep water, and no dock or boat blocks it', () => {
  assert.ok(L.entrance.width >= 25 && L.entrance.width <= 45, `entrance ${L.entrance.width.toFixed(1)} m`);
  assert.ok(terrain.heightAt(...L.entrance.centre) < -5, 'entrance too shallow');
  const gate = corners({ x: L.entrance.centre[0], z: L.entrance.centre[1], dir: [1, 0], length: 30, beam: 30 });
  for (const d of L.docks) assert.ok(!overlap(gate, corners(dockRect(d))), `a ${d.kind} dock blocks the entrance`);
  for (const b of L.boats) assert.ok(!overlap(gate, corners(b)), 'a boat blocks the entrance');
});

test('the site comes from the terrain, not a fixed point: on the open lake\'s south shore, where the real marinas are', () => {
  const s = harbourSite(terrain);
  assert.ok(Math.abs(terrain.shoreDistance(s.x, s.z)) < 3, `site ${terrain.shoreDistance(s.x, s.z).toFixed(1)} m from the shore`);
  assert.ok(Math.abs(L.frame.origin[0] - s.x) < 60 && Math.abs(L.frame.origin[1] - s.z) < 60, 'the fitted frame wandered from the site');
  const P = terrain.places().harbour;
  assert.ok(Math.hypot(s.x - P.x, s.z - P.z) < 400, 'the site is the named one');
  // outside Emerald Bay (a state park, no marina), within a short sail of its mouth
  const d = Math.hypot(L.frame.origin[0] - terrain.mouth.b[0], L.frame.origin[1] - terrain.mouth.b[1]);
  assert.ok(d > 2000 && d < 8000, `${d.toFixed(0)} m from the mouth`);
});

test('the breakwaters join the land at both roots and reach open water', () => {
  for (const bw of L.breakwaters) {
    const root = bw.path[0], tip = bw.path[bw.path.length - 1];
    assert.ok(terrain.shoreDistance(...root) > 5, `${bw.kind} root ${terrain.shoreDistance(...root).toFixed(1)} m: not on the land`);
    assert.ok(terrain.heightAt(...tip) < -4, `${bw.kind} tip only ${terrain.heightAt(...tip).toFixed(1)} m deep`);
    // continuous from the root out to the water: the first path segment crosses the shoreline
    assert.ok(terrain.shoreDistance(...bw.path[1]) < 0, `${bw.kind} second point not in the water`);
  }
});

test('the docks start on the bank and float; the pier and the club stand on land', () => {
  for (const d of L.docks.filter((k) => k.kind === 'main' || k.kind === 'pier')) {
    if (d.head) continue;   // the pier's T head
    assert.ok(terrain.shoreDistance(...d.a) >= 0, `${d.kind} root in the water`);
    assert.ok(terrain.heightAt(...d.a) < d.deckY + 4, `${d.kind} root ${terrain.heightAt(...d.a).toFixed(1)} m: buried in the bank`);
    assert.ok(terrain.heightAt(...d.b) < -1, `${d.kind} end not in water`);
  }
  const club = L.buildings.find((b) => b.kind === 'club');
  assert.ok(terrain.shoreDistance(club.x, club.z) > 15, 'club too close to the water');
  assert.ok(Math.abs(terrain.heightAt(club.x, club.z) - club.y) < 3, 'club floor far from the ground');
});

test('out of the sail path: every element ≥ 2 km from Emerald Bay; the shore fit is level and faces the lake', () => {
  const pts = [...L.boats.map((b) => [b.x, b.z]), ...L.docks.flatMap((d) => [d.a, d.b]), ...L.breakwaters.flatMap((b) => b.path), ...L.buildings.map((b) => [b.x, b.z])];
  for (const [x, z] of pts) assert.ok(Math.hypot(x - LAKE.bay.cx, z - LAKE.bay.cz) >= 2000, `(${x.toFixed(0)}, ${z.toFixed(0)}) is in the bay`);
  const f = fitShore(terrain.shoreDistance, harbourSite(terrain));
  assert.ok(Math.abs(Math.hypot(...f.n) - 1) < 1e-9 && Math.abs(f.t[0] * f.n[0] + f.t[1] * f.n[1]) < 1e-9, 'frame not orthonormal');
  assert.ok(f.n[1] < -0.7, `the south shore's site faces north onto the lake (normal ${f.n.map((v) => v.toFixed(2))})`);
});

test('deterministic: the same seed gives the same layout; another seed fills other slips', () => {
  const strip = (x) => JSON.stringify({ ...x, toWorld: 0, dir: 0 });
  assert.equal(strip(harbourLayout({ terrain, seed: 1 })), strip(L));
  const L2 = harbourLayout({ terrain, seed: 2 });
  assert.notEqual(L2.boats.map((b) => b.slip).join(), L.boats.map((b) => b.slip).join());
  assert.equal(L2.slips.length, L.slips.length);
});

test('no names: the harbour sources carry no text that could reach the screen', () => {
  for (const f of ['../src/harbour-layout.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');   // code only, not comments
    assert.ok(!/CanvasTexture|fillText|TextGeometry|FontLoader/.test(src), `${f} draws text`);
    assert.ok(!/Math\.random|Date\.now|performance\.now/.test(src), `${f} is not deterministic`);
  }
});

test('the meshes: two draw calls, finite geometry, a budget of 100k triangles (the scene draws ≈ 1.3 M); the slips empty', async () => {
  const { createHarbour } = await import('../classic/src/harbour.js');
  const h = createHarbour({ terrain, seed: 1 });
  assert.equal(h.group.children.length, 2);
  assert.deepEqual(h.layout.boats, [], 'the slips stay empty (the low-poly boats were deleted)');
  assert.ok(h.stats.triangles < 100000, `${h.stats.triangles} triangles`);
  h.group.traverse((o) => {
    if (!o.geometry) return;
    for (const k of ['position', 'normal']) assert.ok(o.geometry.attributes[k].array.every(Number.isFinite), `${o.name} ${k} not finite`);
  });
});
