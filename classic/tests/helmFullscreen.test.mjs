// fix/helm-fullscreen (owner, 2026-11-05): a 14-inch MacBook Pro in full screen (1512 x 982 css px, DPR 2) lost the helm's
// wheel and winches. Two causes: (1) the crisp canvas (hud3d.js) was resized while the scene's canvas was the renderer's
// target, so its cached MSAA attachments kept the old size and every frame failed WebGPU validation; (2) the desktop group
// grew with the circles' height (u = d / 220) but the room between the circles grows with the width, so on any screen
// narrower than ~1.74 : 1 the wheel slid under the chart circle. Pure checks; the browser sweep is renders/helm-fullscreen/shot.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { installDom } from '../../tests/helpers/dom-cascade.mjs';
import { createHud3d } from '../src/ui/hud3d.js';
import { helmLayout, gridUnit, gridBottom, GRID_W, overlaps } from '../src/stations/sloop/helmStation.js';

// the tokens as tokens.css computes them: --lk-d (the circles), --lk-mx (their side margin), --lk-by (the bottom gap)
const tok = (w, h) => ({ d: Math.min(Math.max(140, Math.min(0.306 * h, 340)), 0.4 * w), mx: Math.max(28, Math.min(0.032 * w, 56)), by: Math.round(Math.max(12, Math.min(0.019 * h, 16))) });
const SIZES = [[1280, 720], [1280, 800], [1440, 900], [1512, 982], [1512, 945], [1512, 916], [1728, 1117], [1920, 1080], [1920, 1200], [2560, 1440], [2560, 1600], [3024, 1964]];

test('the group is GRID_W u wide (wheel, two winch views, panel, lever, four gaps, the lit word)', () => {
  assert.ok(Math.abs(GRID_W - 730.8) < 1e-9);
  const L = helmLayout({ w: 1280, h: 720, d: 220, by: 14, mx: 40 });
  assert.ok(Math.abs(L.group.w - GRID_W * L.u) <= 1);
});

test('the MacBook Pro 14 in full screen: the old unit overlapped the chart circle; the new one clears both circles', () => {
  const { d, mx } = tok(1512, 982);
  const gap = 1512 - 2 * (mx + d);   // the room between the circles
  assert.ok(GRID_W * (d / 220) > gap + 150, `the old group ${Math.round(GRID_W * d / 220)} px in a ${Math.round(gap)} px gap`);
  const u = gridUnit({ w: 1512, d, mx });
  assert.ok(u < d / 220 && u > 1, `u ${u.toFixed(3)}`);
});

test('every laptop and desktop size: the group clears both circles by 12 px and keeps a clear foot', () => {
  for (const [w, h] of SIZES) {
    const { d, mx, by } = tok(w, h);
    const L = helmLayout({ w, h, d, by, mx, coarse: false });
    assert.equal(L.kind, 'desktop');
    assert.ok(L.group.x >= mx + d + 11, `${w}x${h}: group left ${L.group.x} vs the chart's edge ${Math.round(mx + d)}`);
    assert.ok(L.group.x + L.group.w <= w - mx - d - 11, `${w}x${h}: group right ${L.group.x + L.group.w} vs the dial's edge ${Math.round(w - mx - d)}`);
    assert.ok(L.u <= d / 220 + 1e-9, `${w}x${h}: never larger than before`);
    const foot = h - (L.wheel.y + L.wheel.h);
    assert.ok(foot >= Math.max(by, 0.026 * h) - 1, `${w}x${h}: foot ${foot} px`);
    if (h >= 900) assert.ok(foot >= 23, `${w}x${h}: foot ${foot} px, the tapes and ASTERN clear of the edge`);
    for (const [a, b] of [['wheel', 'jib'], ['jib', 'main'], ['main', 'panel'], ['panel', 'thr']]) assert.ok(!overlaps(L[a], L[b]), `${w}x${h} ${a} / ${b}`);
  }
});

test('16:9 screens keep their size (the approved 1280 x 720 and 1920 x 1080 dashboards)', () => {
  for (const [w, h] of [[1280, 720], [1920, 1080], [2560, 1440]]) {
    const { d, mx } = tok(w, h);
    assert.ok(Math.abs(gridUnit({ w, d, mx }) - d / 220) < 1e-9, `${w}x${h}`);
  }
});

test('a tablet keeps u = 1 and the shared bottom gap', () => {
  assert.equal(gridBottom({ h: 820, by: 14, kind: 'tablet' }), 14);
  const L = helmLayout({ w: 1180, h: 820, d: 200, by: 14, mx: 30, coarse: true });
  assert.equal(L.u, 1); assert.equal(L.wheel.y + L.wheel.h, 820 - 14);
});

test('a narrow desktop window: the unit floors at 0.8 (no smaller than the circles ask)', () => {
  assert.equal(gridUnit({ w: 1024, d: 235, mx: 33 }), 0.8);
  assert.equal(gridUnit({ w: 900, d: 150, mx: 28 }), Math.min(150 / 220, Math.max((900 - 2 * (28 + 150 + 12)) / GRID_W, 0.8)));
});

test('hud3d resizes the crisp canvas only while it is the renderer\'s canvas target', () => {
  // the real createHud3d on a stand-in WebGPU renderer that keeps its current canvas target; a Retina screen (DPR 2) with
  // the scene at 1x takes the crisp canvas. Every resize of a CanvasTarget is logged with the renderer's target at that moment.
  const dom = installDom({ w: 1512, h: 982 });
  const Pipe = THREE.RenderPipeline ?? THREE.PostProcessing, pipeRender = Pipe.prototype.render, setSize = THREE.CanvasTarget.prototype.setSize;
  const main = { name: 'the scene\'s canvas' }, log = [];
  const renderer = { backend: { isWebGPUBackend: true }, domElement: document.createElement('canvas'), current: main,
    getPixelRatio: () => 1, getCanvasTarget() { return this.current; }, setCanvasTarget(t) { this.current = t; },
    getRenderTarget: () => null, setRenderTarget() {}, getMRT: () => null, setMRT() {}, autoClear: true, getClearColor: (c) => c, getClearAlpha: () => 1, setClearColor() {}, render() {} };
  try {
    globalThis.devicePixelRatio = 2;
    document.body.appendChild(renderer.domElement);
    Pipe.prototype.render = function () { log.push({ draw: renderer.current !== main }); };   // the overlay's pass (no GPU here)
    THREE.CanvasTarget.prototype.setSize = function (w, h) { log.push({ size: [w, h], current: renderer.current === this }); return setSize.call(this, w, h); };
    const hud = createHud3d({ renderer, scene: new THREE.Scene(), toneMap: (c) => c });
    let rect = { x: 100, y: 600, w: 200, h: 200 };
    hud.slot({ object: new THREE.Group(), camera: new THREE.PerspectiveCamera(), rect: () => rect });
    const frame = () => { log.length = 0; hud.render(); assert.equal(hud.present(), true); assert.equal(renderer.current, main, 'the scene\'s canvas is the target again'); return log.filter((e) => e.size); };
    const first = frame();
    assert.ok(first.length > 0 && first.every((e) => e.current), 'the first frame sizes the crisp canvas while it is the target');
    assert.deepEqual(log.filter((e) => 'draw' in e), [{ draw: true }], 'and draws it while it is the target');
    assert.deepEqual(frame(), [], 'the same box: no resize');
    rect = { x: 100, y: 600, w: 300, h: 220 };   // a window going full screen: the box grows
    const grown = frame();
    assert.ok(grown.length > 0 && grown.every((e) => e.current), 'the new box: resized while it is the target, never while the scene\'s canvas is');
    assert.deepEqual(hud.overlay, { box: { x: 99, y: 599, w: 302, h: 222 }, dpr: 2, px: [604, 444] }, 'at the screen\'s density');
  } finally { Pipe.prototype.render = pipeRender; THREE.CanvasTarget.prototype.setSize = setSize; dom.uninstall(); }
});
