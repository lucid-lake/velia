// The logbook on v2 (fix(v2): LOG, owner 2026-11-13): v1's src/sail/logbook.js on a core of v2's parts (v2/ui/logbook.js).
// No browser: the baked world is v1's own (a fresh bake matches the committed file; v1's chart and places come out the same from
// it as from v1's world), the camera's quaternion gives v1's forward back, aground is read from the ground's state, and a sail
// on a small DOM records what v1 records: today's line, the finds (the narrows, the first tack, aground) with their hour, place
// and picture, the first find said in the skipper's line, the save in v1's key and format, the last sail kept on pagehide.
// The browser half: v2/tests/pages/logbook.page.mjs (LOG on the card opens the card over the live lake). The card's wiring:
// v2/tests/logbook-card.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bakeWorld, stringify, OUT } from '../../tools/v2-logbook-bake.mjs';
import { makeTerrain, heightAt } from './helpers/ground.mjs';   // v2's own lake (v2/sim/lake.js over v2/terrain/sample.js, the lake-wide shore grids)
import { layoutShoreline } from '../../src/shoreline-layout.js';
import { harbourLayout } from '../../src/harbour-layout.js';
import { buildChart } from '../../src/ui/logbookChart.js';
import { placesFrom } from '../../src/sail/discoveries.js';
import { createServices } from '../../src/sim/core/services.js';
import { createSkills } from '../../src/sail/skills.js';
import { createWords } from '../../src/ui/words.js';
import { WORLD, quatFromForward, terrainFor, groundWatch, createV2Logbook } from '../ui/logbook.js';
import { installDom, memStorage } from '../../tests/helpers/dom-helm.mjs';

test('the baked world is v1\'s own: a fresh bake equals the committed logbookWorld.json', async () => {
  assert.equal(readFileSync(OUT, 'utf8'), stringify(await bakeWorld()), 'stale: run node tools/v2-logbook-bake.mjs');
});

test('v1\'s chart and places from the baked world equal v1\'s from its own world', () => {
  const T = makeTerrain({ seed: 1 }), L = layoutShoreline(T, { seed: 1 }), H = harbourLayout({ terrain: T, seed: 1 });
  const v1Chart = buildChart(T, { shoreline: L, harbour: { x: H.entrance.centre[0], z: H.entrance.centre[1] } });
  const t2 = terrainFor(heightAt), W = WORLD;
  const v2Chart = buildChart(t2, { shoreline: W.shoreline, harbour: { x: W.harbour.entrance.centre[0], z: W.harbour.entrance.centre[1] } });
  // to 1e-6 m: the world was baked on v1's terrain; v2's heights are v1's to 1e-6 m (terrain-data.test.mjs), so a place
  // found by a march on v2's lake differs in its last digits
  closeTo(v2Chart, v1Chart, 1e-6);
  closeTo(placesFrom({ terrain: t2, shoreline: W.shoreline, harbour: W.harbour }), placesFrom({ terrain: T, shoreline: L, harbour: H }), 1e-6);
});

// deep equality with numbers to tol
function closeTo(a, b, tol, path = '') {
  if (typeof a === 'number' && typeof b === 'number') return assert.ok(Math.abs(a - b) <= tol, `${path}: ${a} vs ${b}`);
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: keys`);
    for (const k of Object.keys(a)) closeTo(a[k], b[k], tol, `${path}.${k}`);
    return;
  }
  assert.equal(a, b, path);
}

test('the camera\'s quaternion turns v1\'s −z into the forward (v1\'s camSample)', () => {
  const back = (q) => { const { x, y, z, w } = q; return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))]; };
  for (const f of [[0, 0, -1], [1, 0, 0], [0.3, -0.2, -0.9], [-0.7, 0.1, 0.7], [0, 0, 1], [0, -1, 0.001]]) {
    const l = Math.hypot(...f), u = f.map((v) => v / l), b = back(quatFromForward(f));
    b.forEach((v, i) => assert.ok(Math.abs(v - u[i]) < 1e-9, `${f}: ${b} vs ${u}`));
  }
});

test('aground: once per grounding, read from the ground\'s mode', () => {
  const g = { state: { mode: 'afloat' } }, w = groundWatch(g);
  w.tick(); assert.equal(w.consumeAground(), false);
  g.state.mode = 'touch'; w.tick(); g.state.mode = 'aground'; w.tick(); w.tick();
  assert.equal(w.consumeAground(), true); assert.equal(w.consumeAground(), false);
  g.state.mode = 'afloat'; w.tick(); g.state.mode = 'aground'; w.tick();
  assert.equal(w.consumeAground(), true);
});

test('a sail records what v1 records: the line, the finds with their pictures, the first find said, v1\'s save', async () => {
  const D = installDom();
  const storage = memStorage();
  const saved = { localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  // what a page has and the small DOM lacks: the canvas and image classes the logbook's image loader checks
  const Canvas = document.createElement('canvas').constructor;
  globalThis.HTMLCanvasElement = Canvas; globalThis.HTMLImageElement = class {};
  globalThis.Image = class { set src(v) { this._src = v; this.naturalWidth = 300; this.naturalHeight = 188; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } };
  try {
    const services = createServices(), said = [];
    const hint = { el: document.createElement('div'), get free() { return true; }, flash: (text) => { said.push(text); return true; } };
    const skills = createSkills({ storage: null }), words = createWords({ storage: null, skills });
    const ui = { services, hint, skills, words, pro: false };
    // the boat in the bay's mouth (the narrows), close-hauled, then a tack, then aground
    const M = WORLD.terrain.lake.mouth, mx = (M.a[0] + M.b[0]) / 2, mz = (M.a[1] + M.b[1]) / 2;
    const state = { x: mx, z: mz, heading: 0.5, sog: 2, trueWind: { speed: 5, angle: 0.75 }, surf: 0, roundUp: 0 };
    const B = { t: 0, phys: { state }, ground: { state: { mode: 'afloat' } } };
    const clock = { hour: 15.5 };
    const view = () => ({ pos: [state.x - 20, 6, state.z + 20], target: [state.x, 1, state.z], fov: 50, aspect: 16 / 9 });
    const log = createV2Logbook({ ui, B, terrain: { field: { height: heightAt } }, clock, view, sun: () => ({ elevDeg: 30 }) });
    assert.equal(services.get('logbook'), log.api, 'the logbook is Sail\'s \'logbook\' service (the card\'s LOG and the Calm HUD read it)');
    const frame = document.createElement('canvas'); frame.width = 1280; frame.height = 720;
    const h0 = state.heading;
    for (let i = 0; i <= 400; i++) {
      const t = i * 0.1; B.t = t;
      if (t >= 10 && t < 14) { const k = (t - 10) / 4; state.heading = h0 - 1.6 * k; state.trueWind.angle = 0.75 - 1.5 * k; }
      else if (t >= 14) { state.heading = h0 - 1.6; state.trueWind.angle = -0.75; }
      state.x += Math.sin(state.heading) * state.sog * 0.1; state.z -= Math.cos(state.heading) * state.sog * 0.1;
      if (t >= 30) B.ground.state.mode = 'aground';
      log.update(); log.afterFrame(frame);
    }
    // the pictures: treated off the frame (v1's slices with no worker), then saved
    const saveOf = () => JSON.parse(storage.getItem('lakeshore.logbook.v1') ?? '{"entries":{}}');
    for (let k = 0; k < 200 && Object.keys(saveOf().entries).length < 3; k++) await new Promise((r) => setTimeout(r, 20));
    const s = saveOf();
    assert.equal(s.v, 1, 'v1\'s format');
    assert.deepEqual(Object.keys(s.entries).sort(), ['aground', 'narrows', 'tack'], 'the narrows, the first tack and aground found');
    for (const [id, e] of Object.entries(s.entries)) {
      assert.ok(e.foundAt && Number.isFinite(e.hour) && Number.isFinite(e.at.x) && Number.isFinite(e.at.z), `${id}: when and where (${JSON.stringify({ ...e, image: undefined })})`);
      assert.ok(typeof e.image === 'string' && e.image.startsWith('data:'), `${id}: its picture`);
      assert.equal(e.hour, 15.5, `${id}: the hour from v2's clock`);
    }
    assert.ok(log.logbook.found('tack') && log.logbook.found('narrows'));
    // the first find is said once the bow is steady (v1's findLine: "… — added to your logbook", the L after it)
    for (let i = 0; i < 5; i++) { B.t += 0.1; log.update(); }
    assert.ok(said.some((l) => /— added to your logbook$/.test(l)), `the first find said: ${JSON.stringify(said)}`);
    // today's line: a point each 1.5 s of sim time
    assert.ok(log.track.length >= 26 && log.track.length <= 29, `track points ${log.track.length}`);
    assert.ok(log.track.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z) && p.v === 2));
    // the card: open shows the chart's foot with today's distance
    log.logbook.open({ now: true });
    assert.equal(log.logbook.isOpen, true);
    assert.equal(services.get('logbook').logbook.isOpen, true, 'Sail\'s stations and bar read it to step aside');
    log.logbook.page = 'log';
    // pagehide keeps today's line as the next visit's faint last sail
    dispatchEvent(new Event('pagehide'));
    const last = saveOf().lastTrack;
    assert.ok(Array.isArray(last) && last.length === log.track.length && last[0].length === 3, `lastTrack ${JSON.stringify(last?.slice(0, 2))}`);
    log.dispose();
    assert.equal(services.get('logbook'), undefined, 'disposed: the service is gone');
  } finally {
    if (saved.localStorage) Object.defineProperty(globalThis, 'localStorage', saved.localStorage);
    delete globalThis.HTMLCanvasElement; delete globalThis.HTMLImageElement; delete globalThis.Image;
    D.uninstall();
  }
});
