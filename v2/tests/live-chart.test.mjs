// The live chart (Phase 2a; v2/ui/chart/): the projection puts the pins and Fannette Island at their world
// places on the baked ground (every pin on water, the island on land); the zoom classes and the names' fades; hit-testing for hover and
// select; each action calls its service; the ground bake is fresh (tools/v2-chart-bake.mjs --check's half).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartView, zoomAbout, panBy, clampView, zoomRange, centreFor, classVisible, fadeTo, buildPois, actionFor, aimOf, hitTest, walkOrder,
  layoutLabels, ease, NAMES, SIZES, ZOOM_CLASS, FADE_S, HIT_PX } from '../ui/chart/chartModel.js';
import { GROUND, PAPER, groundSize } from '../ui/chart/ground.js';
import { GROUND_BAKE } from '../ui/chart/groundData.js';
import { chartActions } from '../ui/chart/liveChart.js';
import { bakeRaw, staleParts, SHIP_MPP } from '../../tools/v2-chart-bake.mjs';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { listBirthplaces } from '../sim/birthplace.js';
import { bakedDepth } from '../../tools/birthplace-check.mjs';

let rawP = null;
const raw = () => (rawP ??= bakeRaw());   // one bake for the whole file
const pins = listBirthplaces(CURRENT_WATERS, { all: true });

test('the bake is fresh: the committed pixels, WebPs and soundings match a bake of today\'s terrain', async () => {
  assert.deepEqual(await staleParts(await raw()), [], 'run node tools/v2-chart-bake.mjs');
  const { w, h } = groundSize(SHIP_MPP);
  assert.equal(w, GROUND.shipW); assert.equal(GROUND_BAKE.w, w); assert.equal(GROUND_BAKE.h, h);
  for (const p of ['day', 'night']) assert.ok(GROUND_BAKE[p].bytes < 110 * 1024, `${p} WebP ${GROUND_BAKE[p].bytes} B (about 90 kB a palette at most)`);
});

test('the bake is deterministic: twice the same pixels', async () => {
  const { heightAt } = await import('./helpers/ground.mjs');
  const { bakeGround } = await import('../ui/chart/ground.js');
  const a = bakeGround({ heightAt, mpp: 40, palette: 'day' }), b = bakeGround({ heightAt, mpp: 40, palette: 'day' });
  assert.deepEqual(a.data, b.data);
});

test('the projection: Fannette Island and every pin sit at their world places on the baked ground; the pins on water, the island on land', async () => {
  const R = await raw(), g = R.day, B = GROUND.box;
  const px = (x, z) => { const i = Math.floor((x - B.x0) / g.mpp), j = Math.floor((z - B.z0) / g.mpp), o = (j * g.w + i) * 4; return [g.data[o], g.data[o + 1], g.data[o + 2]]; };
  const isWater = ([r, , b]) => b > r + 18;   // the water's navy tones are blue over red by 20+; the land's greys, greens and sand are not
  assert.ok(!isWater(px(0, 0)), `Fannette's summit is land on the ground (${px(0, 0)})`);
  const { depthAt } = bakedDepth();
  // a pin past the bay's ground (South Lake's and Rubicon Point's: their own sheets, ground.js SHEETS) is drawn at this ground's edge
  // toward it here (ui/chart/edge.js)
  const { edgePoint } = await import('../ui/chart/edge.js');
  for (const p0 of pins) {
    const e = edgePoint(p0.x, p0.z, B), p = { ...p0, x: e.x, z: e.z };
    assert.equal(e.far, p0.id === 'ski-run' || p0.id === 'lake', `${p0.id}: past the bay's ground only South Lake's and Rubicon Point's pins`);
    assert.ok(isWater(px(p.x, p.z)), `${p.id} (${p.x}, ${p.z}) on water on the ground (${px(p.x, p.z)})`);
    assert.ok(depthAt(p.x, p.z) > 2.6, `${p.id} on navigable water`);
    assert.ok(p.x > B.x0 && p.x < B.x1 && p.z > B.z0 && p.z < B.z1, `${p.id} inside the ground's box`);
  }
  // the view: the world point at the centre of a view centred on it, and back
  const v = chartView({ cx: 0, cz: 0, mpp: 2, w: 1280, h: 720 });
  assert.deepEqual(v.toPx(0, 0), [640, 360]);
  const t = pins.find((p) => p.id === 'fannette'), q = v.toPx(t.x, t.z);
  assert.deepEqual(q, [640 + t.x / 2, 360 + t.z / 2], 'east is right, south is down, north up');
  const back = v.toWorld(q[0], q[1]);
  assert.ok(Math.abs(back[0] - t.x) < 1e-9 && Math.abs(back[1] - t.z) < 1e-9);
});

test('zoom about the pointer keeps the world point under it; pan follows the drag; the view stays inside the ground', () => {
  const v = { cx: 300, cz: -200, mpp: 4, w: 1280, h: 720 }, before = chartView(v).toWorld(900, 200);
  const z = zoomAbout(v, 900, 200, 1.5), after = chartView({ ...z, w: 1280, h: 720 }).toWorld(900, 200);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-9);
  const p = panBy(v, 100, -50);
  assert.deepEqual(chartView({ ...p, w: 1280, h: 720 }).toPx(300, -200), [740, 310], 'the map moved with the drag');
  const r = zoomRange(1280, 720, 'play');
  assert.equal(r.min, 1.2); assert.ok(r.max <= 6.5 && r.max > 4, `the widest zoom ${r.max} m/px`);
  const c = clampView({ cx: -99999, cz: 99999, mpp: 99 }, { w: 1280, h: 720, size: 'play' });
  assert.equal(c.mpp, r.max);
  assert.ok(c.cx - 640 * c.mpp >= PAPER.x0 - 1e-6 && c.cz + 360 * c.mpp <= PAPER.z1 + 1e-6, 'never past the paper\'s edge');
  const ce = centreFor(100, 50, 2, { left: 320 });
  assert.deepEqual(chartView({ ...ce, mpp: 2, w: 1280, h: 720 }).toPx(100, 50), [640 + 160, 360], 'a 320 px panel: the boat in the middle of what is left');
  assert.equal(ease(0), 0); assert.equal(ease(1), 1);
  let last = 0; for (let t = 0.05; t < 1; t += 0.05) { const e = ease(t); assert.ok(e >= last - 1e-9, 'monotonic'); last = e; }
  assert.ok(ease(0.25) > 0.5, 'cubic-bezier(.2, 0, 0, 1): a fast start, a long settle');
});

test('the zoom classes: A always, B at 6 m/px and closer, C at 2.5 and closer; a size\'s cap; the fade takes 0.2 s', () => {
  assert.deepEqual(ZOOM_CLASS, { A: Infinity, B: 6, C: 2.5 });
  assert.ok(classVisible('A', 6.5) && !classVisible('B', 6.5) && !classVisible('C', 6.5));
  assert.ok(classVisible('B', 6) && !classVisible('C', 3) && classVisible('C', 2.5));
  assert.ok(!classVisible('C', 1.2, SIZES.card.maxClass), 'the card shows A and B only');
  assert.equal(FADE_S, 0.2);
  let a = 0, s = 0; while (a < 1) { a = fadeTo(a, 1, 1 / 60); s += 1 / 60; }
  assert.ok(Math.abs(s - 0.2) < 1 / 60 + 1e-9, `faded in over ${s.toFixed(3)} s`);
  assert.equal(fadeTo(0.5, 0, 1), 0, 'never past the target');
});

test('the names\' layout: each class shows at its zoom; a lower class waits behind a higher one; nothing over a pin', () => {
  const measure = (n) => ({ w: n.text.length * 9, h: 16 });
  const at = (mpp, cx = 500, cz = -300, keep = []) => { const v = chartView({ cx, cz, mpp, w: 1280, h: 720 }); return Object.fromEntries(layoutLabels(NAMES, (x, z, o) => v.toPx(x, z, o), measure, { w: 1280, h: 720, mpp, keep, cx, cz }).map((l) => [l.id, l.shown])); };
  const wide = at(6.4), mid = at(3), cove = at(1.6, -500, 200);
  assert.ok(wide['n-bay'] && wide['n-fannette'] && !wide['n-vikingsholm'] && !wide['n-beach'], 'the whole bay: class A only');
  assert.ok(mid['n-vikingsholm'] && mid['n-narrows'] && !mid['n-beach'], 'mid: A and B');
  assert.ok(cove['n-beach'], 'a cove: C too');
  // two names on one spot: the higher class wins, the other waits
  const two = [{ id: 'hi', text: 'Alpha', x: 0, z: 0, cls: 'A', kind: 'water' }, { id: 'lo', text: 'Beta', x: 4, z: 0, cls: 'B', kind: 'water' }];
  const v = chartView({ cx: 0, cz: 0, mpp: 2, w: 800, h: 600 });
  const L = Object.fromEntries(layoutLabels(two, (x, z, o) => v.toPx(x, z, o), measure, { w: 800, h: 600, mpp: 2 }).map((l) => [l.id, l.shown]));
  assert.deepEqual(L, { hi: true, lo: false });
  const kept = layoutLabels(two.slice(0, 1), (x, z, o) => v.toPx(x, z, o), measure, { w: 800, h: 600, mpp: 2, keep: [[390, 290, 410, 310]] });
  assert.equal(kept[0].shown, false, 'a pin\'s box keeps the name off it');
});

const SRC = {
  birthplaces: pins.map((p) => ({ id: p.id, name: p.name, x: p.x, z: p.z, why: p.why, mark: p.mark })), current: 'fannette',
  anchorages: [{ x: -400, z: 0, name: 'Anchorage off Vikingsholm', depth: 13.7 }],
  places: [{ id: 'fannette', name: 'Fannette Island', x: 0, z: 0 }, { id: 'teahouse', name: 'Tea house', x: 2, z: 0, zoomClass: 'C' }],
  areas: [{ id: 'tessieWaters', name: "Tessie's water", x: 300, z: -130, r: 200 }],
  aids: [{ id: 'g1', x: 1400, z: -1100, number: '1', lightText: 'Fl G 4s', colour: 'green' }],
  channel: { pts: [[1300, -950], [1440, -1075], [1535, -1160], [1585, -1245], [1650, -1315]] },
  raceMarks: [{ id: 'windward', x: 900, z: -600 }],
};

test('the points: one action each, by where the chart is open (72 § 4)', () => {
  const rows = buildPois(SRC, { mode: 'play' }), by = (id) => rows.find((r) => r.id === id);
  assert.equal(by('bp-fannette').action, 'sail'); assert.equal(by('bp-fannette').lit, true); assert.equal(by('bp-narrows').lit, false);
  assert.equal(by('bp-fannette').mark, 'Tessie', 'Off Fannette carries Tessie\'s flag (her tiny logo) into the chart\'s row'); assert.equal(rows.filter((r) => r.mark).length, 1);
  assert.equal(by('bp-fannette').actions, undefined, 'no Be Tessie unless she can be played');
  assert.deepEqual(buildPois({ ...SRC, beTessie: true }, { mode: 'play' }).find((r) => r.id === 'bp-fannette').actions, ['sail', 'beTessie'], 'in play her card adds Be Tessie');
  assert.equal(buildPois({ ...SRC, beTessie: true }, { mode: 'entrance' }).find((r) => r.id === 'bp-fannette').actions, undefined, 'never at the entrance');
  assert.equal(buildPois({ ...SRC, areas: [], beTessie: true }, { mode: 'play' }).some((r) => r.kind === 'area'), false, 'no area point of her water');
  assert.equal(by('an--400-0').action, 'anchor');
  assert.equal(by('pl-fannette').action, 'target'); assert.equal(by('ar-tessieWaters').action, 'target'); assert.equal(by('ch-mouth').action, 'target');
  assert.equal(by('bu-g1').action, null, 'a buoy: a card only'); assert.equal(by('bu-g1').line, '"1" Fl G 4s');
  assert.equal(by('rm-windward').action, null, 'race marks start a race in the hub only');
  assert.equal(actionFor('anchorage', 'entrance'), 'target', 'at the entrance an anchorage is a first target');
  assert.equal(actionFor('raceMark', 'hub'), 'race'); assert.equal(actionFor('birthplace', 'hub'), null);
  assert.equal(by('pl-teahouse').zoomClass, 'C');
  // the aims: an area at its edge nearest the boat, the channel at its mouth, else the point
  const edge = aimOf(by('ar-tessieWaters'), { x: 300, z: 500 });
  assert.ok(Math.abs(Math.hypot(edge.x - 300, edge.z + 130) - 200) < 1e-9 && edge.z > -130);
  assert.deepEqual(aimOf(by('ch-mouth')), { x: 1650, z: -1315 });
});

test('hit-testing: the nearest shown point within the radius; hidden classes never hit; the Tab walk nearest-first', () => {
  const rows = buildPois(SRC, { mode: 'play' });
  const v = chartView({ cx: 0, cz: 0, mpp: 2, w: 1280, h: 720 }), toPx = (x, z, o) => v.toPx(x, z, o);
  const t = rows.find((r) => r.id === 'bp-fannette'), [px, py] = v.toPx(t.x, t.z);
  assert.equal(hitTest(rows, toPx, px + 5, py - 4, HIT_PX.mouse, 2)?.id, 'bp-fannette', 'hover a pin');
  assert.equal(hitTest(rows, toPx, px + 30, py, HIT_PX.mouse, 2), null, 'off it');
  assert.equal(hitTest(rows, toPx, px + 20, py, HIT_PX.touch, 2)?.id, 'bp-fannette', 'a finger reaches further');
  const [tx, ty] = v.toPx(2, 0);
  assert.equal(hitTest(rows, toPx, tx, ty, HIT_PX.mouse, 4)?.id, 'pl-fannette', 'the tea house (class C) hides at 4 m/px: the island answers');
  assert.equal(hitTest(rows, toPx, tx, ty, HIT_PX.mouse, 2)?.id, 'pl-teahouse', 'and shows at 2');
  const walk = walkOrder(rows, 0, 0, 2).map((r) => r.id);
  assert.equal(walk[0], 'pl-fannette'); assert.ok(walk.indexOf('bp-fannette') < walk.indexOf('bp-lake'), 'nearest first');
  assert.ok(!walkOrder(rows, 0, 0, 6.4).some((r) => r.id === 'pl-teahouse'), 'the walk skips what is hidden');
});

test('the actions call the right services: Sail from here (pick at the entrance, moveTo in play), Set as target, Anchor here, Start a race here', async () => {
  const calls = [];
  const services = { get: (n) => ({
    birthplace: { pick: (id) => { calls.push(['pick', id]); return { id }; }, moveTo: async (id) => { calls.push(['moveTo', id]); return id === 'lake' ? { ok: false, why: 'race' } : { ok: true, id }; } },
    chartTarget: { set: (p) => { calls.push(['set', p]); return { ok: true }; }, anchor: (p) => { calls.push(['anchor', p]); return { ok: true }; } },
    chart: { course: { lay: (k) => calls.push(['lay', k]) } },
  }[n] ?? null) };
  let mode = 'entrance';
  const A = chartActions(services, () => mode), rows = buildPois(SRC, { mode: 'play' }), by = (id) => rows.find((r) => r.id === id);
  assert.deepEqual(await A.sail(by('bp-vikingsholm')), { ok: true, picked: 'vikingsholm' });
  mode = 'play';
  assert.deepEqual(await A.sail(by('bp-narrows')), { ok: true, id: 'narrows' });
  assert.deepEqual(await A.sail(by('bp-lake')), { ok: false, why: 'race' }, 'a refusal comes back with its reason');
  assert.deepEqual(A.target(by('pl-fannette'), { x: 0, z: 0 }), { ok: true });
  assert.deepEqual(A.anchor(by('an--400-0'), { x: -400, z: 0 }), { ok: true });
  assert.deepEqual(A.race(by('rm-windward')), { ok: true });
  assert.deepEqual(calls, [['pick', 'vikingsholm'], ['moveTo', 'narrows'], ['moveTo', 'lake'], ['set', { x: 0, z: 0, name: 'Fannette Island' }],
    ['anchor', { x: -400, z: 0, name: 'Anchorage off Vikingsholm' }], ['lay', 'windward-leeward']]);
  const none = chartActions({ get: () => null });
  assert.deepEqual(await none.sail(by('bp-fannette')), { ok: false, why: 'unknown' }, 'no service: a plain refusal, never a throw');
});

test('the whole bay keeps "Fannette Island": the island\'s name before the pins\' labels, clear of the pins and the boat round it', async () => {
  const { NAMES: N, BOOKMARKS: BM } = await import('../ui/chart/chartModel.js');
  // the chart at its widest at 1280 × 720 (5 m a pixel) and at the 1 bookmark (6.5 m a pixel, the menu's whole bay), the pins' marks and the
  // anchorage kept clear, the boat at the old start (460, -50) and at the Off Fannette start (she spawns about (187, 23), by the pin)
  const wide = zoomRange(1280, 720, 'play').max;
  for (const [cx, cz, mpp, bx, bz] of [[800, -400, wide, 460, -50], [620, -560, wide, 460, -50], [500, -300, wide, 460, -50], [800, -400, wide, 187, 23], [240, -110, BM[0], 187, 23], [500, -300, BM[0], 187, 23]]) {
    const v = chartView({ cx, cz, mpp, w: 1280, h: 720 }), q = [0, 0];
    const box = (x, z, r) => { v.toPx(x, z, q); return [q[0] - r, q[1] - r, q[0] + r, q[1] + r]; };
    const keep = [...pins.map((p) => box(p.x, p.z, 8)), box(-400, 0, 6), box(bx, bz, 13)];
    const labels = [...N, ...pins.map((p) => ({ id: `n-bp-${p.id}`, text: p.name, x: p.x, z: p.z, cls: p.id === 'fannette' ? 'A' : 'B', pri: p.id === 'fannette' ? -2 : 0, kind: 'water', dx: 13, align: 'left' }))];
    const measure = (n) => ({ w: n.text.length * 9.2, h: n.cls === 'A' ? 21 : 19 });
    const L = layoutLabels(labels, (x, z, o) => v.toPx(x, z, o), measure, { w: 1280, h: 720, mpp, keep, cx, cz });
    assert.ok(L.find((l) => l.id === 'n-fannette').shown, `Fannette Island named at ${mpp.toFixed(2)} m/px centred ${cx}, ${cz}, the boat at ${bx}, ${bz}`);
  }
});

test('one name a place: a place that is also a birthplace (Vikingsholm) keeps the pin\'s label only', async () => {
  const { namesFor } = await import('../ui/chart/chartModel.js');
  const ids = namesFor(pins).map((n) => n.id);
  assert.ok(!ids.includes('n-vikingsholm'), 'the land label gives way to the pin');
  assert.ok(ids.includes('n-fannette') && ids.includes('n-falls'), 'the others stay');
  assert.ok(namesFor([]).some((n) => n.id === 'n-vikingsholm'), 'with no pins (a hub) the place keeps its name');
});

test('the night chart reads: every name at 4.5:1 or better on its darkest and brightest ground (WCAG contrast, with its halo)', async () => {
  const { NIGHT_INK } = await import('../ui/chart/chartModel.js');
  const { GROUND_PALETTES } = await import('../ui/chart/ground.js');
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const N = GROUND_PALETTES.night, lit = (c) => c.map((x) => Math.min(255, x * 1.3 + 16));   // the brightest relief: a lit slope
  const grounds = { water: N.water.map((s) => s[1]), land: [N.granite, N.forest, N.sand, N.alpine].flatMap((c) => [c, lit(c)]) };
  for (const kind of ['water', 'land']) {
    for (const g of grounds[kind]) {
      const under = mix(g, NIGHT_INK.halo, NIGHT_INK.haloA), text = mix(under, NIGHT_INK.ink, NIGHT_INK[kind]);
      assert.ok(ratio(text, under) >= 4.5, `${kind} name on ${g.map(Math.round)}: ${ratio(text, under).toFixed(2)}:1`);
    }
  }
  assert.ok(L(N.water[0][1]) > 0.08 && L(N.sand) > 0.12, 'the moonlit ground is readable, not near black');
});

test('race pins: one pin per available place race, numbered in its cup, a card line with length, minutes and best; Race here in play, none at the entrance', async () => {
  const { listCups } = await import('../sim/racePlaces.js');
  const { racePins, buildPois, actionFor, ACTION_WORDS } = await import('../ui/chart/chartModel.js');
  const store = (() => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; })();
  store.setItem('lakeshore.regatta.places.v1', JSON.stringify({ 'tea-house-run': { timeS: 178.4, medal: 'silver' } }));
  const pins = racePins(listCups({ store }));
  assert.deepEqual(pins.map((p) => [p.id, p.no]), [['tea-house-run', 1], ['tessies-deep', 2], ['glass-boat-chase', 3], ['pass-the-channel', 1], ['storm-run', 2], ['lights-on-the-lake', 3]]);
  assert.match(pins[0].line, /^0\.\d\d km · about \d min · best 2:58\.4 · silver$/);
  assert.match(pins[1].line, /^0\.\d\d km · about \d min$/);
  assert.deepEqual(racePins(listCups({ has: (f) => !['tessie', 'glassBoat', 'storm'].includes(f) })).map((p) => p.id), ['tea-house-run', 'pass-the-channel', 'lights-on-the-lake']);   // a phone
  const rows = buildPois({ racePins: pins }, { mode: 'play' });
  assert.ok(rows.every((r) => r.kind === 'racePin' && r.action === 'raceHere' && r.zoomClass === 'A'));
  assert.equal(ACTION_WORDS.raceHere, 'Race here');
  assert.equal(actionFor('racePin', 'entrance'), null);
  assert.equal(actionFor('racePin', 'hub'), 'raceHere');
});
