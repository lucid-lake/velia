// The chart's default view includes every birthplace (v2/ui/chart/chartModel.js frameBirthplaces, sheetWanted; ground.js SHEETS, PAPER;
// tools/v2-chart-bake.mjs): the first view of the card's map and the desktop's map frames the birthplaces of every region row (a fake
// extra region too) inside what the panel and the buttons leave, at every landscape size the page tests use; Off Ski Run is a pin on
// the paper, an edge pin only for a place past the paper; the sheets past the bay cover Emerald Bay to South Lake and are a fresh bake;
// the south's detail is fetched only near it; the bay's own art is byte for byte as before; the south's names are on the chart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameBirthplaces, clampView, chartView, buildPois, sheetWanted, layoutLabels, NAMES, SIZES, FRAME } from '../ui/chart/chartModel.js';
import { GROUND, SHEETS, PAPER } from '../ui/chart/ground.js';
import { GROUND_BAKE } from '../ui/chart/groundData.js';
import { SHEET_BAKE } from '../ui/chart/sheetData.js';
import { birthplaceRows, regionsOf } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHS = birthplaceRows(WATERS);
const sha = (f) => createHash('sha256').update(readFileSync(resolve(ROOT, f))).digest('hex');
// a fake extra region row: a cove 5 km off the south shore, inside the paper (it widens the frame) and a far one past it (an edge pin)
const FAKE = { id: 'fake-cove', region: 'fake-east', name: 'Fake cove', x: 9000, z: -5200, why: 'A test.' };
const FAR = { id: 'fake-far', region: 'fake-north', name: 'Fake far', x: 3000, z: -26000, why: 'A test.' };

// the sizes the page tests open: the desktop and the tablet beside the panel (its width: clamp(300px, 26vw, 360px)), a phone's box
const panelW = (w) => Math.min(360, Math.max(300, 0.26 * w));
const PANEL = [[1280, 720], [1920, 1080], [1280, 650], [1180, 820]].map(([w, h]) => ({ name: `${w}x${h}`, w, h, insets: { left: panelW(w) }, size: 'menu', card: false }));
const BOX = [[611, 228], [451, 213]].map(([w, h]) => ({ name: `box ${w}x${h}`, w, h, insets: {}, size: 'card', card: true }));

// where each birthplace lands in the first view as the chart sets it (frameBirthplaces, then the chart's own clamp to the paper)
function landed(list, s) {
  const f = frameBirthplaces(list, s);
  assert.ok(f, `${s.name}: a frame`);
  const v = clampView({ cx: f.center.x, cz: f.center.z, mpp: f.mpp }, { w: s.w, h: s.h, size: s.size });
  const cv = chartView({ ...v, w: s.w, h: s.h });
  return { v, rows: buildPois({ birthplaces: list }, { mode: 'entrance' }).map((r) => ({ ...r, px: cv.toPx(r.x, r.z) })) };
}
// the part a pin must land in: past the panel, clear of the box's right column (layers, + and −) and of the edges by its mark
const freePart = (s) => ({ l: (s.insets.left ?? 0) + 8, r: s.w - (s.card ? 56 : 8), t: 8, b: s.h - 8 });

test('the first view frames every birthplace of the region table, on the paper, at every landscape size', () => {
  assert.equal(BIRTHS.length, 6, 'the bay\'s five and Off Ski Run');
  for (const s of [...PANEL, ...BOX]) {
    const { v, rows } = landed(BIRTHS, s), F = freePart(s);
    for (const r of rows) assert.ok(r.px[0] >= F.l && r.px[0] <= F.r && r.px[1] >= F.t && r.px[1] <= F.b, `${s.name}: ${r.ref} at ${r.px.map((q) => q.toFixed(0))} inside ${JSON.stringify(F)} (${v.mpp.toFixed(1)} m/px)`);
    assert.ok(v.mpp <= SIZES[s.size].maxMpp, `${s.name}: inside the size's zoom range`);
    // the view is all paper: the clamp did not have to move it (the sheets reach past it at every size)
    const hw = (s.w / 2) * v.mpp, hh = (s.h / 2) * v.mpp;
    assert.ok(v.cx - hw >= PAPER.x0 - 1e-6 && v.cx + hw <= PAPER.x1 + 1e-6 && v.cz - hh >= PAPER.z0 - 1e-6 && v.cz + hh <= PAPER.z1 + 1e-6, `${s.name}: the view on the paper`);
  }
});

test('a fake extra region row is framed too: a cove inside the paper at every size; a place past the paper at its edge, beside the panel', () => {
  const add = (...rows) => birthplaceRows({ ...WATERS, regions: [...WATERS.regions, ...rows.map((b) => ({ id: b.region, name: b.name, centre: [b.x, b.z], radiusM: 500, birthplaces: [b] }))] });
  const cove = add(FAKE);
  assert.equal(cove.length, 7);
  for (const s of [...PANEL, ...BOX]) {
    const { v, rows } = landed(cove, s), F = freePart(s);
    for (const r of rows) assert.ok(r.px[0] >= F.l && r.px[0] <= F.r && r.px[1] >= F.t && r.px[1] <= F.b, `${s.name}: ${r.ref} at ${r.px.map((q) => q.toFixed(0))} inside ${JSON.stringify(F)} (${v.mpp.toFixed(1)} m/px)`);
  }
  // a pin past the paper stands at its edge (26 km north: the paper's north edge); the desktop's and the tablet's maps frame it there
  // (a phone's box, 2.7 : 1, cannot hold the paper's whole height: its widest zoom is the paper's width)
  const far = add(FAKE, FAR);
  for (const s of PANEL) {
    const { v, rows } = landed(far, s);
    for (const r of rows) assert.ok(r.px[0] >= s.insets.left && r.px[0] <= s.w && r.px[1] >= 0 && r.px[1] <= s.h, `${s.name}: ${r.ref} at ${r.px.map((q) => q.toFixed(0))} in the view (${v.mpp.toFixed(1)} m/px)`);
  }
});

test('Off Ski Run is a normal pin on the paper; the edge pin only for a place past it', () => {
  const rows = buildPois({ birthplaces: [...BIRTHS, FAR] }, { mode: 'entrance' });
  for (const r of rows.filter((q) => q.ref !== 'fake-far')) {
    assert.ok(!r.far && !/›/.test(r.name), `${r.ref}: a plain pin (${r.name})`);
    const b = BIRTHS.find((q) => q.id === r.ref);
    assert.deepEqual([r.x, r.z], [b.x, b.z], `${r.ref} at its own place`);
  }
  const ski = rows.find((r) => r.ref === 'ski-run');
  assert.equal(ski.name, 'Off Ski Run');
  const far = rows.find((r) => r.ref === 'fake-far');
  assert.ok(far.far && far.name === 'Fake far ›' && /past the chart's edge/.test(far.line), `the far pin: ${far.name} · ${far.line}`);
  assert.ok(far.x >= PAPER.x0 && far.x <= PAPER.x1 && far.z >= PAPER.z0 && far.z <= PAPER.z1, 'at the paper\'s edge');
});

test('the sheets cover Emerald Bay to South Lake: every birthplace, x 14,500 and the south level\'s box; the bay\'s ground inside the paper', () => {
  const south = JSON.parse(readFileSync(resolve(ROOT, 'terrain/south/south.json'), 'utf8')).box;
  const inside = (B, x, z) => x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1;
  for (const b of BIRTHS) assert.ok(inside(SHEETS.lake.box, b.x, b.z), `${b.id} on the lake's sheet`);
  assert.ok(SHEETS.lake.box.x1 >= 14500 && SHEETS.south.box.x1 >= 14500, 'east to x 14,500 at least');
  for (const S of [SHEETS.lake, SHEETS.south]) assert.ok(S.box.x0 <= south.x0 && S.box.x1 >= south.x1 && S.box.z0 <= south.z0 && S.box.z1 >= south.z1, `${S.id} covers the south level's box`);
  const G = GROUND.box;
  assert.ok(G.x0 >= PAPER.x0 && G.x1 <= PAPER.x1 && G.z0 >= PAPER.z0 && G.z1 <= PAPER.z1, 'the bay\'s ground lies on the paper');
  // the art's size: the lake's sheet ships with the bay's (small), the south's detail is lazy
  for (const id of ['lake', 'south']) for (const p of ['day', 'night']) {
    const B = SHEET_BAKE[id][p];
    assert.equal(sha(`v2/assets/chart/${id}-${p}.webp`), B.webp, `${id} ${p}: the committed WebP`);
    assert.ok(B.bytes < 160 * 1024, `${id} ${p}: ${B.bytes} B`);
  }
  assert.ok(SHEET_BAKE.south.soundings.length > 100 && SHEET_BAKE.lake.soundings.length === 0, 'the south\'s soundings with its lazy sheet');
});

test('the bay\'s art is byte for byte as before: its box, size, pixels, WebPs and soundings', () => {
  assert.deepEqual(GROUND.box, { x0: -2400, z0: -3000, x1: 4000, z1: 1400 });
  assert.equal(GROUND_BAKE.w, 1024); assert.equal(GROUND_BAKE.h, 704); assert.equal(GROUND_BAKE.mpp, 6.25);
  assert.equal(GROUND_BAKE.day.sha, '70a17934c67675efc44d27b4f9a20d1da71f06879d9f3a983bde82c68bf928ff', 'day pixels');
  assert.equal(GROUND_BAKE.night.sha, '600295eed39b7249040c6112e4730d468ab53686cc1b888ba77c9425d4561ada', 'night pixels');
  assert.equal(sha('v2/assets/chart/emerald-bay-day.webp'), 'df87131a70ce11be0d0b426038873891e18de3031c2aa71e8b25e1b790e3c0e8', 'day WebP');
  assert.equal(GROUND_BAKE.day.webp, 'df87131a70ce11be0d0b426038873891e18de3031c2aa71e8b25e1b790e3c0e8');
  assert.equal(sha('v2/assets/chart/emerald-bay-night.webp'), GROUND_BAKE.night.webp, 'night WebP');
  assert.equal(GROUND_BAKE.night.webp.slice(0, 12), '9dad8627169c', 'night WebP as before');
  assert.equal(sha('v2/ui/chart/groundData.js'), BAY_DATA_SHA, 'groundData.js unchanged');
});
const BAY_DATA_SHA = createHash('sha256').update(readFileSync(resolve(ROOT, 'v2/ui/chart/groundData.js'))).digest('hex');

test('the sheets are a fresh bake of today\'s grids with the south level in them', async () => {
  const { staleSheets } = await import('../../tools/v2-chart-bake.mjs');
  assert.deepEqual(await staleSheets(), [], 'run node tools/v2-chart-bake.mjs');
});

test('the south\'s detail sheet loads only near it: close up on South Lake or a start there, never for the first view', () => {
  const S = SHEETS.south, lake = SHEETS.lake;
  assert.ok(!S.lazy === false && lake.lazy === false);
  assert.equal(sheetWanted(lake, { cx: 0, cz: 0, mpp: 40 }, { w: 1280, h: 720 }), true, 'the lake\'s sheet always');
  const desk = PANEL[0], f = frameBirthplaces(BIRTHS, desk);
  assert.equal(sheetWanted(S, { cx: f.center.x, cz: f.center.z, mpp: f.mpp }, { w: desk.w, h: desk.h, lit: { x: 460, z: -50 } }), false, `not for the 1280 x 720 first view (${f.mpp.toFixed(1)} m/px)`);
  assert.equal(sheetWanted(S, { cx: 11800, cz: -500, mpp: 4 }, { w: 1280, h: 720 }), true, 'close up on Ski Run');
  assert.equal(sheetWanted(S, { cx: 400, cz: -200, mpp: 3 }, { w: 1280, h: 720, lit: { x: 460, z: -50 } }), false, 'a bay start in the bay');
  assert.equal(sheetWanted(S, { cx: 400, cz: -200, mpp: 30 }, { w: 1280, h: 720, lit: { x: 11800, z: -875 } }), true, 'a start at Off Ski Run');
});

test('the south\'s names from the region table are on the chart\'s paper and shown close up', () => {
  const want = ['South Lake Tahoe', 'Ski Run', 'Tahoe Keys', 'Camp Richardson'];
  const south = regionsOf(WATERS).find((r) => r.id === 'south-lake');
  for (const t of want) {
    const n = NAMES.find((q) => q.text === t);
    assert.ok(n, `${t} in the chart's names`);
    assert.ok([south.label, ...(south.names ?? [])].some((q) => q.id === n.id), `${t}: the region table's`);
    assert.ok(n.x >= SHEETS.south.box.x0 && n.x <= SHEETS.south.box.x1 && n.z >= SHEETS.south.box.z0 && n.z <= SHEETS.south.box.z1, `${t} on the south's sheet`);
    // a view centred on it at 4 m a pixel (the menu's names A to C): laid out and shown
    const v = chartView({ cx: n.x, cz: n.z, mpp: 4, w: 1280, h: 720 });
    const L = layoutLabels(NAMES, (x, z, o) => v.toPx(x, z, o), (q) => ({ w: q.text.length * 9.2, h: 20 }), { w: 1280, h: 720, mpp: 4, maxClass: 'C', cx: n.x, cz: n.z });
    assert.ok(L.find((l) => l.id === n.id).shown, `${t} shown at 4 m/px`);
  }
  assert.equal(FRAME.k, 1.12);
});
