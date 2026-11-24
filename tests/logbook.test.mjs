// node --test tests/logbook.test.mjs — the logbook's data: the chart from the terrain, the entries and their silhouettes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, LAKE } from '../src/sim/terrain.js';
import { buildChart, CHART_BOUNDS } from '../src/ui/logbookChart.js';
import { ENTRIES, SIL, treatParams } from '../src/ui/logbook.js';

test('the chart: the bay\'s shore, the island, every place, inside the frame', () => {
  const terrain = makeTerrain({ seed: 1 });
  const c = buildChart(terrain);
  assert.ok(c.shore.length > 300 && c.shore.length < 1200, `shore points ${c.shore.length}`);
  assert.deepEqual(c.shore[0], c.shore.at(-1), 'the shore is closed');
  assert.equal(c.island.length, 25);
  assert.deepEqual(c.bounds, CHART_BOUNDS);
  for (const id of ['island', 'waterfall', 'house', 'narrows', 'harbour', 'light']) {
    const p = c.places[id];
    assert.ok(p, `place ${id}`);
    assert.ok(p.x > c.bounds.x0 && p.x < c.bounds.x1 && p.z > c.bounds.z0 && p.z < c.bounds.z1, `${id} inside the frame (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
  }
  assert.deepEqual(c.places.island, { x: LAKE.island.x, z: LAKE.island.z });
  assert.ok(!('moorings' in c.places), 'no mooring entry (the balls were deleted)');
});

test('the entries: 7 places with a sound, 7 moments, a silhouette each, ids unique', () => {
  const places = ENTRIES.filter((e) => e.kind === 'place'), moments = ENTRIES.filter((e) => e.kind === 'moment');
  assert.equal(places.length, 7); assert.equal(moments.length, 8);   // + the Milky Way (round 4, 2026-11-07)   // + the ruin and a far sail (the binoculars, 2026-10-29); aground (the keel on the bottom, 2026-10-30)
  assert.ok(places.every((e) => e.sound), 'every place has a sound memory');
  assert.ok(moments.every((e) => !e.sound), 'moments have none');
  assert.equal(new Set(ENTRIES.map((e) => e.id)).size, ENTRIES.length);
  for (const e of ENTRIES) assert.ok(SIL[e.id]?.startsWith('M'), `silhouette ${e.id}`);
  assert.ok(ENTRIES.every((e) => e.name.split(' ').length <= 3), 'a few words per entry at most');
});

test('the treatment is one colour family: cream lights, navy shadows, a fixed speed scale', () => {
  assert.deepEqual(treatParams.cream, [239, 230, 210]);
  assert.deepEqual(treatParams.navy, [11, 16, 22]);
  assert.equal(treatParams.speedFull, 3.6);
});

test('the chart\'s water closes along the frame, not by a chord across the bay (the hairline, feat/mastery)', async () => {
  const { closeOnFrame, FRAME_GAP_M } = await import('../src/ui/logbook.js');
  const c = buildChart(makeTerrain({ seed: 1 }));
  const long = c.shore.map((p, i, a) => (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0)).filter((d) => d >= FRAME_GAP_M);
  assert.ok(long.length >= 1, 'the ring leaves the frame somewhere (the open lake)');
  // the ring with its frame corners: every step either short or along the frame's edge
  const ring = closeOnFrame(c.shore.slice(0, -1), c.bounds), B = c.bounds, onEdge = (p) => [Math.abs(p[0] - B.x0), Math.abs(p[0] - B.x1), Math.abs(p[1] - B.z0), Math.abs(p[1] - B.z1)].some((d) => d < 30);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d >= FRAME_GAP_M) assert.ok(onEdge(p) && onEdge(q) && (Math.abs(p[0] - q[0]) < 30 || Math.abs(p[1] - q[1]) < 30), `a ${d.toFixed(0)} m step must run along the frame: (${p}) → (${q})`);
  }
  assert.ok(ring.length > c.shore.length - 1, 'a corner was added');
  // a ring that closes on itself is untouched
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.deepEqual(closeOnFrame(sq, B), sq);
});
