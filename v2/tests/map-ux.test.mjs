// the map's crosshair, layers and wake (v2/ui/chart/mapUx.js; ?mapux=0 none): the eased follow, the magnet, the reading, the layers, the wake store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { easeToward, snapTo, readout, distWords, dmLine, layerOf, LAYERS, RACES_LAYER, barLayers, nearestOf, createWakeStore, UX } from '../ui/chart/mapUx.js';
import { buildPois, poiShown, hitTest } from '../ui/chart/chartModel.js';
import { parseV2Flags } from '../engine/flags.js';

test('the flag: on by default (owner, 2026-11-18), ?mapux=0 turns it off for one release', () => {
  assert.equal(parseV2Flags('').mapux, true);
  assert.equal(parseV2Flags('?mapux=0').mapux, false);
  assert.equal(parseV2Flags('?mapux=1').mapux, true);
});

test('the eased crosshair: the same path at 30 and 120 fps, it lags then settles, no lag with tau 0', () => {
  const run = (fps, secs) => { let c = { x: 0, y: 0 }; for (let i = 0; i < Math.round(fps * secs); i++) c = easeToward(c, { x: 100, y: 50 }, 1 / fps); return c; };
  const a = run(30, 0.1), b = run(120, 0.1);
  assert.ok(Math.abs(a.x - b.x) < 1e-9, `frame-rate independent (${a.x} vs ${b.x})`);
  assert.ok(a.x > 60 && a.x < 66, `one tau in, about 63 % of the way (${a.x.toFixed(1)})`);
  assert.ok(run(60, 0.5).x > 99, 'settled within 0.5 s');
  assert.deepEqual(easeToward({ x: 0, y: 0 }, { x: 5, y: 6 }, 0.016, 0), { x: 5, y: 6 });
});

test('the magnet: the nearest point within 22 px, none beyond', () => {
  const pts = [{ id: 'a', px: 100, py: 100 }, { id: 'b', px: 112, py: 100 }];
  assert.equal(snapTo(pts, 109, 100)?.id, 'b');
  assert.equal(snapTo(pts, 100, 100 + UX.snapPx + 1), null);
});

test('the reading: bearing true and distance from the boat; the position without one', () => {
  assert.equal(readout(0, -1852, { x: 0, z: 0 }).main, '000°T  1.00 nm');
  assert.equal(readout(100, 0, { x: 0, z: 0 }).main, '090°T  100 m');
  assert.equal(readout(0, 0).main, '38°57.25′ N  120°06.03′ W', 'Fannette Island, the origin');
  assert.equal(distWords(180.4), '180 m'); assert.equal(distWords(926), '0.50 nm');
  assert.equal(dmLine(-120.0, 'E', 'W'), '120°00.00′ W');
});

test('the bar by mode: exactly Birthplaces · Anchorages in Sail and Cruise; Regatta adds Races; no All, no Marks (owner 2026-11-25)', () => {
  assert.deepEqual(barLayers(false).map((l) => l.word), ['Birthplaces', 'Anchorages']);
  assert.deepEqual(barLayers(true).map((l) => l.word), ['Birthplaces', 'Anchorages', 'Races']);
  assert.deepEqual(LAYERS.map((l) => l.id), ['birthplaces', 'anchorages']);
  for (const w of [...barLayers(true)].map((l) => l.word.toLowerCase())) assert.ok(!/^(all|marks|places|wildlife|your wake)$/.test(w), w);
});

test('only birthplaces, anchorages and the race pins are in a chip; every other kind keeps drawing by the zoom rules', () => {
  assert.equal(layerOf('birthplace'), 'birthplaces');
  assert.equal(layerOf('anchorage'), 'anchorages');
  assert.equal(layerOf('racePin'), RACES_LAYER.id);
  for (const k of ['place', 'corner', 'area', 'buoy', 'channel', 'raceMark', 'barge', 'wake']) assert.equal(layerOf(k), null, k);
  const rows = buildPois({ birthplaces: [{ id: 'a', name: 'A', x: 0, z: 0 }], places: [{ id: 'p', name: 'P', x: 9, z: 9 }], aids: [{ id: 'b', x: 5, z: 5, number: '1' }],
    areas: [{ id: 't', name: 'T', x: 50, z: 50, r: 10 }], barges: [{ x: 1, z: 1 }], corners: [{ id: 'c', name: 'C', x: 2, z: 2 }] }, { mode: 'play' });
  assert.deepEqual(rows.map((r) => r.kind).sort(), ['area', 'barge', 'birthplace', 'buoy', 'corner', 'place'], 'nothing is removed from the chart');
  const pl = rows.find((r) => r.kind === 'place');
  assert.ok(!poiShown(pl, 25, 'C') && poiShown(pl, 3, 'C'), 'a place still appears only as you zoom in');
});

test('birthplaces and anchorages show at every zoom, and a tap at the overview takes them', () => {
  const src = { birthplaces: [{ id: 'a', name: 'A', x: 0, z: 0 }], anchorages: [{ x: 500, z: 100, name: 'Shallows by Fannette', depth: 8 }] };
  for (const mode of ['play', 'entrance']) {
    const rows = buildPois(src, { mode });
    for (const r of rows) for (const mpp of [3, 6, 12, 25]) for (const mc of ['B', 'C']) assert.ok(poiShown(r, mpp, mc), `${r.kind} at ${mpp} m/px (max ${mc})`);
    const toPx = (x, z, o) => { o[0] = x / 25; o[1] = z / 25; };
    assert.equal(hitTest(rows, toPx, 20, 4, 16, 25, 'B')?.kind, 'anchorage', 'a tap at the overview takes the anchorage');
    assert.equal(hitTest(rows, toPx, 0, 0, 16, 25, 'B')?.kind, 'birthplace');
  }
});

test('where to: the nearest place or anchorage to the boat, the next on a second tap, the one she is at left out', () => {
  const rows = [
    { id: 'an-far', kind: 'anchorage', x: 900, z: 0 }, { id: 'an-near', kind: 'anchorage', x: 200, z: 0 }, { id: 'an-here', kind: 'anchorage', x: 5, z: 0, lit: true },
    { id: 'pl-a', kind: 'birthplace', x: 0, z: -400 }, { id: 'pl-b', kind: 'birthplace', x: 0, z: 100 }, { id: 'bp-far', kind: 'birthplace', x: 0, z: 50, far: true },
    { id: 'cn-1', kind: 'corner', x: 0, z: 10 }, { id: 'ar-t', kind: 'area', x: 0, z: 3 }, { id: 'bu-1', kind: 'buoy', x: 0, z: 1 },
  ];
  const boat = { x: 0, z: 0 }, A = LAYERS[1].kinds, P = LAYERS[0].kinds;
  assert.equal(nearestOf(rows, A, boat, 0).id, 'an-near');
  assert.equal(nearestOf(rows, A, boat, 1).id, 'an-far', 'the second tap: the next nearest');
  assert.equal(nearestOf(rows, A, boat, 2).id, 'an-near', 'and round again');
  assert.equal(nearestOf(rows, P, boat, 0).id, 'pl-b', 'a far pin, a hunts corner and Tessie\'s water are not where to');
  assert.equal(nearestOf(rows, P, boat, 1).id, 'pl-a');
  assert.equal(nearestOf(rows, P, { x: 0, z: -390 }, 0).id, 'pl-a', 'from the start or the map centre when there is no boat');
  assert.equal(nearestOf([], A, boat), null);
});

const memStore = (init = {}) => { const mem = new Map(Object.entries(init)); return { mem, getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) }; };
// a voyage: one session's store sails a straight line along z in 1 m steps (a point each 12 m), then saves
const sailVoyage = (storage, z, opt = {}) => { const w = createWakeStore({ storage, ...opt }); for (let i = 0; i <= 60; i++) w.sample(i, z); w.save(); return w; };

test('the wake: a point each 12 m, a new segment after a jump, kept in storage and read back, capped', () => {
  const storage = memStore();
  const w = createWakeStore({ storage, max: 50 });
  for (let i = 0; i <= 100; i++) w.sample(i, 0);   // 100 m in 1 m steps: 9 points
  assert.equal(w.count, 9);
  w.sample(400, 0); w.sample(420, 0);
  assert.equal(w.voyages.length, 1, 'a move in play is a new segment of the same voyage');
  assert.equal(w.voyages[0].segs.length, 2, 'the jump starts a segment');
  w.save();
  const again = createWakeStore({ storage });
  assert.deepEqual(again.segments, w.segments, 'read back on the next visit');
  for (let i = 0; i < 100; i++) w.sample(1000 + i * 13, 0);
  assert.equal(w.count, 50, 'capped: the oldest go first');
  const broken = createWakeStore({ storage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
  assert.ok(broken.sample(0, 0) && broken.sample(20, 0), 'blocked storage: the wake lives for the visit');
});

test('the wake keeps only the last 3 voyages: a session is one voyage, the 4th drops the oldest, order oldest first', () => {
  const storage = memStore();
  for (let n = 0; n < 3; n++) sailVoyage(storage, n * 100);
  let w = createWakeStore({ storage });
  assert.deepEqual(w.voyages.map((o) => o.segs[0][0][1]), [0, 100, 200], 'three sessions, three voyages, oldest first');
  assert.equal(createWakeStore({ storage }).voyages.length, 3, 'a session that never sails adds none');
  sailVoyage(storage, 300);   // the 4th session
  w = createWakeStore({ storage });
  assert.deepEqual(w.voyages.map((o) => o.segs[0][0][1]), [100, 200, 300], 'the oldest is gone');
  assert.equal(JSON.parse(storage.getItem('lakeshore.wake.v2')).voyages.length, 3, 'and dropped from storage');
  // this session's own voyage begins at its first sample: the current voyage plus the 2 before it
  const cur = createWakeStore({ storage });
  assert.equal(cur.voyages.length, 3);
  cur.sample(0, 400);
  assert.equal(cur.voyages.length, 3, 'one point is not a voyage yet');
  cur.sample(20, 400);
  assert.equal(cur.voyages.length, 3);
  assert.deepEqual(cur.voyages.map((o) => o.segs[0][0][1]), [200, 300, 400]);
});

test('the wake migrates v1: everything already stored is one old voyage, and v1 is removed', () => {
  const old = [[[0, 0], [20, 0], [40, 0]], [[500, 0], [520, 0]]];
  const storage = memStore({ 'lakeshore.wake.v1': JSON.stringify(old) });
  const w = createWakeStore({ storage });
  assert.equal(w.voyages.length, 1);
  assert.deepEqual(w.voyages[0].segs, old, 'its segments kept');
  w.sample(0, 900); w.sample(20, 900); w.save();
  assert.equal(w.voyages.length, 2, 'this session is a new voyage after it');
  assert.equal(storage.getItem('lakeshore.wake.v1'), null, 'v1 removed on the next save');
  assert.equal(JSON.parse(storage.getItem('lakeshore.wake.v2')).voyages.length, 2);
  assert.equal(createWakeStore({ storage: memStore({ 'lakeshore.wake.v1': 'not json' }) }).voyages.length, 0, 'garbage forgotten, not thrown');
  assert.equal(createWakeStore({ storage: memStore({ 'lakeshore.wake.v2': '{"v":2,"voyages":[{"t":1,"s":[[[1,2],[3,4]]]},{"t":2,"s":[]}]}' }) }).voyages.length, 1, 'an empty stored voyage is dropped');
});

test('the wake stays bounded: the point cap runs over all voyages, the oldest voyage first', () => {
  const storage = memStore();
  for (let n = 0; n < 3; n++) sailVoyage(storage, n * 100, { max: 20 });
  const w = createWakeStore({ storage, max: 20 });
  assert.ok(w.count <= 20, `${w.count} points stored`);
  for (let i = 0; i < 60; i++) w.sample(2000 + i * 13, 777);
  assert.equal(w.count, 20);
  assert.equal(w.voyages.at(-1).segs.at(-1).at(-1)[1], 777, 'the current voyage keeps its newest points');
  assert.ok(storage.getItem('lakeshore.wake.v2') === null || storage.getItem('lakeshore.wake.v2').length < 2000, 'a small string');
});

test('the idle boat at the start screen (one point, or a move before she sails) makes no voyage', () => {
  const storage = memStore();
  sailVoyage(storage, 0);
  const w = createWakeStore({ storage });
  w.sample(5, 5); w.sample(900, 900); w.sample(900, 905);   // a point, a move far away, a point inside one step
  assert.equal(w.voyages.length, 1, 'still just the stored voyage');
  w.sample(930, 900);
  assert.equal(w.voyages.length, 2, 'the first step sailed starts this session\'s voyage');
  assert.deepEqual(w.voyages[1].segs[0][0], [900, 900], 'from the point she was at when the move ended');
});

test('forget clears every voyage; she sails on into a new one', () => {
  const storage = memStore();
  for (let n = 0; n < 3; n++) sailVoyage(storage, n * 100);
  const w = createWakeStore({ storage });
  assert.equal(w.voyages.length, 3);
  const v0 = w.version; w.clear();
  assert.equal(w.count, 0); assert.equal(w.voyages.length, 0); assert.ok(w.version > v0);
  assert.equal(createWakeStore({ storage }).voyages.length, 0, 'gone from storage');
  w.sample(0, 5); w.sample(30, 5);
  assert.equal(w.voyages.length, 1, 'a new voyage starts');
});
