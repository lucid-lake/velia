// The chartplotter: the world-to-chart transform, the laylines for a known wind, the contour
// extraction, the N toggle, and the base built from the real terrain. Plain JS; the live checks are
// tools/probe_chart.mjs. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLOT, makeView, buildGrid, contourSegments, paintBase, PALETTES, band, laylineRays, laylinePlan, vmgTo, nightOf, ChartToggle, gridHeight } from '../src/ui/chartplotterData.js';
import { bestVmg } from '../src/sim/boat/groove.js';
import { heightAt, LAKE } from '../src/sim/terrain.js';
import { budget } from './helpers/budget.mjs';

const DEG = Math.PI / 180;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('the transform: north-up keeps north up and east right; head-up puts the heading up; the round trip holds', () => {
  const n = makeView({ cx: 100, cz: 200, mPerPx: 5, rot: 0, ox: 110, oy: 110 });
  assert.deepEqual(n.toPx(100, 200), [110, 110]);
  const [nx, ny] = n.toPx(100, 200 - 500);                 // 500 m north: 100 px up
  assert.ok(near(nx, 110) && near(ny, 10), `north ${nx}, ${ny}`);
  const [ex, ey] = n.toPx(600, 200);                       // 500 m east: 100 px right
  assert.ok(near(ex, 210) && near(ey, 110), `east ${ex}, ${ey}`);
  for (const rot of [0, 30 * DEG, 251 * DEG, -100 * DEG]) {
    const v = makeView({ cx: 1200, cz: -1050, mPerPx: 9.1, rot, ox: 110, oy: 136 });
    // a point 400 m along the bearing `rot` is straight up
    const [ux, uy] = v.toPx(1200 + Math.sin(rot) * 400, -1050 - Math.cos(rot) * 400);
    assert.ok(near(ux, 110, 1e-9) && near(uy, 136 - 400 / 9.1, 1e-9), `rot ${rot / DEG}°: ${ux}, ${uy}`);
    // 90° to starboard of it is to the right
    const [rx, ry] = v.toPx(1200 + Math.sin(rot + Math.PI / 2) * 400, -1050 - Math.cos(rot + Math.PI / 2) * 400);
    assert.ok(near(rx, 110 + 400 / 9.1, 1e-9) && near(ry, 136, 1e-9), `starboard ${rx}, ${ry}`);
    for (const [x, z] of [[0, 0], [1700, -1300], [-900, 400]]) {
      const [px, py] = v.toPx(x, z), [wx, wz] = v.toWorld(px, py);
      assert.ok(near(wx, x, 1e-6) && near(wz, z, 1e-6), 'round trip');
    }
    const [dx, dy] = v.dirPx(rot); assert.ok(near(dx, 0, 1e-12) && near(dy, -1, 1e-12), 'dirPx of the heading is up');
  }
});

test('the laylines for a known wind: from the north, 45° tacks, the rays run back SE and SW from the mark', () => {
  const wp = { x: 0, z: -1000 };
  const [stbd, port] = laylineRays(wp, 0, 45 * DEG, 1000);
  // starboard tack sails 315° (NW) to the mark, so its layline lies to the SE of it: bearing 135°
  assert.ok(near(stbd[2], Math.sin(135 * DEG) * 1000, 1e-9) && near(stbd[3], -1000 - Math.cos(135 * DEG) * 1000, 1e-9), `stbd ${stbd}`);
  assert.ok(near(port[2], Math.sin(225 * DEG) * 1000, 1e-9) && near(port[3], -1000 - Math.cos(225 * DEG) * 1000, 1e-9), `port ${port}`);
  // a boat sailing close-hauled along a layline reaches the mark: start on the starboard layline 600 m out, sail 315°
  const st = { x: stbd[0] + (stbd[2] - stbd[0]) * 0.6, z: stbd[1] + (stbd[3] - stbd[1]) * 0.6 };
  const h = -45 * DEG, end = { x: st.x + Math.sin(h) * 600, z: st.z - Math.cos(h) * 600 };
  assert.ok(Math.hypot(end.x - wp.x, end.z - wp.z) < 1e-6, 'the starboard layline fetches the mark');
  // the plan: the polar's own tacking angle upwind, its gybing angle down; a wind from 200° (the bay's evening breeze)
  const boat = { x: 1200, z: -1050 };
  const up = laylinePlan(boat, { x: 1200 + Math.sin(200 * DEG) * 800, z: -1050 - Math.cos(200 * DEG) * 800 }, 200 * DEG, 12);
  assert.equal(up.upwind, true);
  assert.equal(up.twaDeg, bestVmg(12, true).twa);
  assert.ok(up.twaDeg >= 35 && up.twaDeg <= 55, `upwind tack angle ${up.twaDeg}°`);
  const dn = laylinePlan(boat, { x: 1200 - Math.sin(200 * DEG) * 800, z: -1050 + Math.cos(200 * DEG) * 800 }, 200 * DEG, 12);
  assert.equal(dn.upwind, false);
  assert.ok(dn.twaDeg >= 130 && dn.twaDeg <= 180, `downwind angle ${dn.twaDeg}°`);
  // the rays of a downwind mark run back upwind of it
  const [r] = dn.rays, wpx = dn.rays[0][0], wpz = dn.rays[0][1];
  const along = (r[2] - wpx) * Math.sin(200 * DEG) - (r[3] - wpz) * Math.cos(200 * DEG);
  assert.ok(along > 0, 'the downwind laylines lie upwind of the mark');
});

test('VMG toward a point: the speed along the bearing, signed', () => {
  const wp = { x: 0, z: -1000 };
  assert.ok(near(vmgTo({ x: 0, z: 0, sog: 3, cog: 0 }, wp), 3, 1e-9));
  assert.ok(near(vmgTo({ x: 0, z: 0, sog: 3, cog: 60 * DEG }, wp), 1.5, 1e-9));
  assert.ok(near(vmgTo({ x: 0, z: 0, sog: 3, cog: Math.PI }, wp), -3, 1e-9));
});

test('the contours: a bowl’s 10 m contour is a circle of the right radius; levels nest; marching squares closes it', () => {
  // a cone 40 m deep at the centre, 1 m of depth per 10 m out, land past 400 m
  const hAt = (x, z) => -40 + Math.hypot(x, z) / 10;
  const g = buildGrid(hAt, { x0: -600, x1: 600, z0: -600, z1: 600 }, 8);
  for (const d of [5, 10, 30]) {
    const s = contourSegments(g, d), r = (40 - d) * 10;
    assert.ok(s.length > 40, `${d} m: ${s.length / 4} segments`);
    let worst = 0;
    for (let i = 0; i < s.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(s[i], s[i + 1]) - r));
    assert.ok(worst < 0.5, `${d} m: off the ${r} m circle by ${worst.toFixed(2)} m`);
    // closed: every end point is shared by exactly two segment ends
    const key = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`, n = new Map();
    for (let i = 0; i < s.length; i += 2) n.set(key(s[i], s[i + 1]), (n.get(key(s[i], s[i + 1])) ?? 0) + 1);
    assert.ok([...n.values()].every((c) => c === 2), `${d} m: open ends`);
  }
  assert.equal(contourSegments(g, 80).length, 0, 'no contour deeper than the bowl');
  // slices add up to the whole
  const whole = contourSegments(g, 10).length, parts = contourSegments(g, 10, 0, 60).length + contourSegments(g, 10, 60, g.h - 1).length;
  assert.equal(parts, whole);
});

test('the real bay: the base grid, the shore, the contours and the sill’s hatch from the terrain', () => {
  const B = { x0: -1300, x1: 2200, z0: -2000, z1: 600 };
  const t0 = performance.now(), g = buildGrid(heightAt, B, PLOT.gridM), ms = performance.now() - t0;
  budget(ms, 400, 'the bay\'s base grid');   // gates with LAKESHORE_STRICT=1
  assert.ok(near(gridHeight(g, 1200, -1050), heightAt(1200, -1050), 1.5), 'the grid matches the terrain at the start');
  const shore = contourSegments(g, 0), c5 = contourSegments(g, 5), c60 = contourSegments(g, 60);
  assert.ok(shore.length / 4 > 500, `shore ${shore.length / 4} segments`);
  assert.ok(c5.length > 0 && c60.length > 0, '5 m and 60 m contours exist in the bay');
  // the 60 m contour sits inside the 5 m one: every 60 m point is deeper than 5 m
  for (let i = 0; i < c60.length; i += 16) assert.ok(-heightAt(c60[i], c60[i + 1]) > 5, '60 m contour inside the 5 m');
  // the base over the same frame at 5 m/px: the sill (water under the keel + 1 m near the mouth) hatched, one px in 5
  const m = LAKE.mouth, sill = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2];
  const BW = Math.round((B.x1 - B.x0) / 5), BH = Math.round((B.z1 - B.z0) / 5), big = new Uint8ClampedArray(BW * BH * 4);
  paintBase(big, BW, BH, g, PALETTES.day, { sill });
  let hatch = 0, shallow = 0;
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
    const wx = B.x0 + (x + 0.5) * 5, wz = B.z0 + (y + 0.5) * 5, h = gridHeight(g, wx, wz);
    if (h < 0 && -h < PLOT.hazardM && Math.hypot(wx - sill[0], wz - sill[1]) < PLOT.sillR) {
      shallow++; const o = (y * BW + x) * 4; if (big[o] > 150) hatch++;
    }
  }
  assert.ok(shallow > 200, `the sill's shallow water ${shallow} px`);
  assert.ok(hatch / shallow > 0.12 && hatch / shallow < 0.3, `the hatch covers ${(hatch / shallow * 100).toFixed(0)} % (one px in 5)`);
  assert.equal(band(1), 0); assert.equal(band(7), 2); assert.equal(band(45), 4); assert.equal(band(200), 5);
});

test('N: a tap opens the big chart and the next closes it; a hold enlarges while held and returns; the small chart is never hidden', () => {
  const c = new ChartToggle(0.3);
  c.shown = true;   // the dashboard's circle is always up
  assert.deepEqual(c.update(0), { shown: true, big: false }, 'the small chart is up');
  c.down(1); c.update(1.1); c.up(1.15);
  assert.deepEqual(c.state, { shown: true, big: true }, 'a tap opens the big chart');
  c.down(2); c.up(2.1);
  assert.deepEqual(c.state, { shown: true, big: false }, 'the next tap closes it; the small chart stays');
  c.down(3); c.update(3.2); assert.equal(c.big, false, 'not yet a hold');
  c.update(3.35); assert.equal(c.big, true, 'held 0.35 s: enlarged');
  c.down(3.4); c.update(4); assert.equal(c.big, true, 'a key repeat changes nothing');
  c.up(4.1); assert.deepEqual(c.state, { shown: true, big: false }, 'released: back to small');
  c.pin(); assert.equal(c.big, true, 'pinned');
  c.up(8); assert.deepEqual(c.state, { shown: true, big: true }, 'a stray key-up does nothing');
  c.down(9); c.up(9.05); assert.deepEqual(c.state, { shown: true, big: false }, 'a tap lets go of the pin, the small chart stays');
});

test('the night palette: none by day, full under −5°, dimmer ink', () => {
  assert.equal(nightOf(20), 0); assert.equal(nightOf(3), 0); assert.equal(nightOf(-5), 1);
  assert.ok(nightOf(-1) > 0.3 && nightOf(-1) < 0.7);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(PALETTES.night.ink) < lum(PALETTES.day.ink) * 0.85);
  assert.ok(lum(PALETTES.night.water[0]) < lum(PALETTES.day.water[0]));
});

// ---- the passage plan on the enlarged chart: the DOM, no GPU ----
async function planChart({ course = null, onPick = undefined } = {}) {
  const { installDom } = await import('./helpers/dom-helm.mjs');
  const dom = installDom();
  const { createChartplotter } = await import('../src/ui/chartplotter.js');
  const state = { x: 0, z: 0, heading: 0, sog: 2, cog: 0, trueWind: { angle: 0.4, speed: 5 } };
  const cp = createChartplotter({ terrain: { heightAt: () => -20 }, boat: () => state, places: { island: { x: 400, z: -600 } }, plan: true, course, ...(onPick !== undefined ? { onPick } : {}) });
  cp.toggle.shown = true; cp.toggle.pin();
  for (let i = 0; i < 3; i++) cp.update(0.2);
  const big = cp.el.querySelector('.big'), cv = big.querySelector('canvas');
  const S = 550, mpp = PLOT.bigR[PLOT.bigZoom] / (S / 2), px = (x, z) => [S / 2 + x / mpp, S / 2 + z / mpp];   // north-up, the boat at the centre
  const tap = (x, z, { drag = null } = {}) => {
    const [cx, cy] = px(x, z);
    big.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
    if (drag) { const [dx, dy] = px(...drag); dispatchEvent(new PointerEvent('pointermove', { clientX: dx, clientY: dy })); dispatchEvent(new PointerEvent('pointerup', { clientX: dx, clientY: dy })); }
    else dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy }));
    cp.update(0.2);
  };
  const redraw = () => { cv.drawnArcs.length = 0; cv.drawnText.length = 0; cp.update(0.2); return { rings: cv.drawnArcs.filter((a) => a[2] === 9).length, dots: cv.drawnArcs.filter((a) => a[2] === 2.2).length, text: cv.drawnText.slice() }; };
  const btn = (key) => big.querySelector(`button[data-key="${key}"]`);
  return { dom, cp, big, tap, redraw, btn, state };
}

test('b. the plan: a tap on the water appends a ring, a second a second; a tap on a ring removes it; a drag moves it; a name, a midpoint', async () => {
  const { dom, cp, tap, redraw } = await planChart();
  assert.equal(redraw().rings, 0, 'no route: no rings');
  tap(600, 300);
  assert.equal(cp.route.length, 1); assert.ok(Math.abs(cp.route[0].x - 600) < 10 && Math.abs(cp.route[0].z - 300) < 10, JSON.stringify(cp.route));
  tap(-500, 200);
  assert.equal(cp.route.length, 2);
  const d = redraw();
  assert.equal(d.rings, 2, 'two rings'); assert.equal(d.dots, 2, 'two legs (a midpoint dot each)');
  assert.ok(d.text.includes('1') && d.text.includes('2'), 'numbered');
  tap(600, 300);   // the ring: removed
  assert.equal(cp.route.length, 1); assert.ok(Math.abs(cp.route[0].x + 500) < 10);
  tap(-500, 200, { drag: [-200, 500] });   // dragged: moved, not removed
  assert.equal(cp.route.length, 1); assert.ok(Math.abs(cp.route[0].x + 200) < 10 && Math.abs(cp.route[0].z - 500) < 10, JSON.stringify(cp.route));
  tap(400, -600);   // the island's name: that place, named, appended
  assert.equal(cp.route.length, 2); assert.equal(cp.route[1].name, 'the island'); assert.deepEqual([cp.route[1].x, cp.route[1].z], [400, -600]);
  tap(-100, 250);   // the first leg's midpoint dot (the boat at 0, 0 to waypoint 1): a waypoint inserted first
  assert.equal(cp.route.length, 3); assert.ok(Math.abs(cp.route[0].x + 100) < 10 && Math.abs(cp.route[0].z - 250) < 10, JSON.stringify(cp.route));
  assert.equal(redraw().rings, 3);
  cp.dispose(); dom.uninstall();
});

test('b. the tools row: Set course and Clear only with a route; Race ▾ folds the Lay buttons while a plan exists; the owner hears every edit', async () => {
  const course = { kinds: [{ id: 'wl', label: 'Windward-leeward' }, { id: 'tri', label: 'Triangle' }], laid: false, lay() {}, clear() {}, marks: () => [], sequence: [], next: null, label: '' };
  const picks = [];
  const { dom, cp, tap, btn } = await planChart({ course, onPick: (p) => { picks.push(p); } });
  const vis = (k) => !btn(k).hidden;
  assert.ok(!vis('set') && !vis('clearRoute') && !vis('race'), 'no route: no plan buttons');
  assert.ok(vis('wl') && vis('tri') && !vis('clear'), 'the Lay buttons as today');
  tap(600, 300);
  assert.equal(picks.at(-1).op, 'add'); assert.equal(cp.route.length, 0, 'the owner decides: nothing drawn until it answers');
  cp.setRoute([{ x: 600, z: 300 }]); cp.update(0.2);
  assert.ok(vis('set') && vis('clearRoute') && vis('race'), 'a route: Set course · Clear · Race ▾');
  assert.ok(!vis('wl') && !vis('tri'), 'the Lay buttons fold');
  btn('race').click(); cp.update(0.2);
  assert.ok(vis('wl') && vis('tri') && btn('race').textContent === 'Race ▴', 'Race ▾ unfolds them');
  btn('set').click(); assert.equal(picks.at(-1).op, 'set');
  picks.length = 0; dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })); assert.equal(picks.at(-1)?.op, 'set', 'Enter is Set course');
  btn('clearRoute').click(); assert.equal(picks.at(-1).op, 'clear');
  cp.setRoute([{ x: 600, z: 300 }], { active: 0 }); cp.update(0.2);
  assert.ok(!vis('set') && vis('clearRoute'), 'a course set: no Set course, Clear stays');
  cp.setRoute([{ x: 600, z: 300 }], { live: true }); cp.update(0.2);
  assert.ok(!vis('set'), 'a live route (Cruise): no Set course');
  cp.setRoute([]); cp.update(0.2);
  assert.ok(!vis('set') && !vis('clearRoute') && !vis('race') && vis('wl'), 'cleared: as today');
  cp.dispose(); dom.uninstall();
});

test('b. the small chart shows the active leg and its ring only', async () => {
  const { installDom } = await import('./helpers/dom-helm.mjs');
  const dom = installDom();
  const { createChartplotter } = await import('../src/ui/chartplotter.js');
  const state = { x: 0, z: 0, heading: 0, sog: 2, cog: 0 };
  const cp = createChartplotter({ terrain: { heightAt: () => -20 }, boat: () => state, plan: true });
  cp.toggle.shown = true;
  const cv = cp.el.querySelectorAll('canvas')[0];
  for (let i = 0; i < 3; i++) cp.update(0.2);
  cv.drawnArcs.length = 0; cp.update(0.2);
  const n0 = cv.drawnArcs.filter((a) => a[2] === 5).length;
  cp.setRoute([{ x: 200, z: -300 }, { x: 400, z: -300 }], { active: 0 }); cv.drawnArcs.length = 0; cp.update(0.2);
  assert.equal(cv.drawnArcs.filter((a) => a[2] === 5).length - n0, 1, 'one ring: the active waypoint');
  cp.dispose(); dom.uninstall();
});
