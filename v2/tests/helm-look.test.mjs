// The helm view's look (owner, 2026-11-13: "in helm view, unlike v1, I can no longer use mouse to update view"): v1's
// deck (src/deck/index.js) and its helm camera (src/sim/boat/helmCamera.js) on v2's hands (v2/ui/touch.js), the routing
// (v2/sim/controls.js routeLook, v2/sim/boat.js camera()) and the views (v2/ui/views.js). Behaviour only: the modules are
// called, their outputs read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orbitFromDrag, zoomFromWheel, routeLook, LOOK } from '../sim/controls.js';
import { createViews } from '../ui/views.js';
import { createTouch } from '../ui/touch.js';
import { createBoatSim } from '../sim/boat.js';
import { HELM_CAM } from '../../src/sim/boat/helmCamera.js';
import { LOOK as TOUCH_LOOK } from '../../src/ui/touchLook.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';

const DEG = Math.PI / 180;
const boat = { x: 100, z: -200, heading: 0.7, heel: 0, pitch: 0, heave: 0 };
const follow = { pos: [100, 10, -170], target: [100, 2, -200], fov: 50 };
// the helm view's look direction in the hull frame: yaw (+ starboard) and elevation from the pose (heading 0.7, level boat)
const lookOf = (p) => {
  const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], l = Math.hypot(...d);
  const c = Math.cos(boat.heading), s = Math.sin(boat.heading);   // world → hull: undo Ry(−heading)
  const hx = d[0] * c + d[2] * s, hz = -d[0] * s + d[2] * c;
  return { yaw: Math.atan2(hx, -hz), el: Math.asin(d[1] / l) };
};
const run = (V, secs, look = null, zoom = 1, view = V.view) => { let p; for (let i = 0; i < Math.round(secs * 60); i++) p = V.pose(1 / 60, follow, boat, { look: typeof look === 'function' ? look(i) : look, zoom }); return p; };

test('the drag and the wheel are v1\'s deck numbers, and the two-finger look is v1\'s TwoFinger scale', () => {
  assert.deepEqual(orbitFromDrag(100, -50), [0.5, -0.2]);
  assert.equal(LOOK.dragX, TOUCH_LOOK.dragX); assert.equal(LOOK.dragY, TOUCH_LOOK.dragY);
  assert.ok(Math.abs(zoomFromWheel(120) - Math.exp(0.12)) < 1e-12 && Math.abs(zoomFromWheel(-120) * zoomFromWheel(120) - 1) < 1e-12);
});

test('routeLook: the follow camera takes the look only in the follow view, the helm camera only in the helm view', () => {
  assert.deepEqual(routeLook('follow', [0.1, 0.2], 1.2), { orbit: [0.1, 0.2], followZoom: 1.2, helmLook: null, helmZoom: 1 });
  assert.deepEqual(routeLook('helm', [0.1, 0.2], 1.2), { orbit: null, followZoom: 0, helmLook: [0.1, 0.2], helmZoom: 1.2 });
  assert.deepEqual(routeLook('helm', null, 0), { orbit: null, followZoom: 0, helmLook: null, helmZoom: 1 });
  assert.deepEqual(routeLook('follow', [0, 0], 0).orbit, [0, 0], 'a held drag reaches the camera as [0, 0]');
});

test('a drag in the helm view looks round: right is starboard, up is up; v1\'s limits hold (±120°, −40° … +70°)', () => {
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm' });
  const rest = lookOf(run(V, 1));
  assert.ok(Math.abs(rest.yaw) < 1e-3 && Math.abs(rest.el - HELM_CAM.pitchDeg * DEG) < 1e-3, `rests ahead, ${HELM_CAM.pitchDeg}° down`);
  // a drag right by 100 px (0.5 rad) and up by 50 px
  const p = lookOf(run(V, 1, (i) => (i === 0 ? orbitFromDrag(100, -50) : [0, 0])));
  assert.ok(Math.abs(p.yaw - 0.5) < 0.01, `yaw 0.5 rad to starboard (${p.yaw.toFixed(3)})`);
  assert.ok(Math.abs(p.el - (HELM_CAM.pitchDeg * DEG + 0.2)) < 0.01, `up 0.2 rad (${p.el.toFixed(3)})`);
  // far past the stops
  const q = lookOf(run(V, 1, (i) => (i === 0 ? orbitFromDrag(5000, -5000) : [0, 0])));
  assert.ok(Math.abs(q.yaw - 120 * DEG) < 0.01, `yaw stops at 120° (${(q.yaw / DEG).toFixed(1)})`);
  assert.ok(Math.abs(q.el - 70 * DEG) < 0.01, `up stops at 70° (${(q.el / DEG).toFixed(1)})`);
  const r = lookOf(run(V, 1, (i) => (i === 0 ? orbitFromDrag(-20000, 20000) : [0, 0])));
  assert.ok(Math.abs(r.yaw + 120 * DEG) < 0.01 && Math.abs(r.el + 40 * DEG) < 0.01, `port 120°, down 40° (${(r.yaw / DEG).toFixed(1)}, ${(r.el / DEG).toFixed(1)})`);
});

test('the spring back: held, the look stays; let go, it waits 3 s and eases back to the bow (a look high up stays)', () => {
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm' });
  run(V, 0.5, (i) => (i === 0 ? orbitFromDrag(160, 0) : [0, 0]));   // 0.8 rad to starboard, then held still for 5 s more
  const held = lookOf(run(V, 5, [0, 0]));
  assert.ok(Math.abs(held.yaw - 0.8) < 0.01, `a hand still on the mouse keeps the look (${held.yaw.toFixed(3)})`);
  const wait = lookOf(run(V, HELM_CAM.returnAfter - 0.1, null));
  assert.ok(Math.abs(wait.yaw - 0.8) < 0.01, `let go: no move for ${HELM_CAM.returnAfter} s (${wait.yaw.toFixed(3)})`);
  const back = lookOf(run(V, 8, null));
  assert.ok(Math.abs(back.yaw) < 0.02, `then back to the bow (${back.yaw.toFixed(3)})`);
  run(V, 0.5, (i) => (i === 0 ? orbitFromDrag(0, -200) : null));   // up 0.8 rad: past holdUpDeg
  const up = lookOf(run(V, 10, null));
  assert.ok(up.el / DEG > HELM_CAM.holdUpDeg, `a look up past ${HELM_CAM.holdUpDeg}° stays (${(up.el / DEG).toFixed(1)}°)`);
});

test('the wheel zooms the helm view\'s lens between v1\'s 30° and 70°; the follow view\'s drag never reaches the helm camera', () => {
  const V = createViews({ vessel: CURRENT_VESSEL, view: 'helm' });
  assert.equal(run(V, 0.2).fov, HELM_CAM.fov);
  assert.ok(Math.abs(run(V, 0.1, null, zoomFromWheel(-100)).fov - HELM_CAM.fov * Math.exp(-0.1) ** 6) < 1e-9, 'scroll up: narrower');
  assert.ok(Math.abs(run(V, 1, null, zoomFromWheel(-3000)).fov - HELM_CAM.fovMin) < 1e-9);
  assert.ok(Math.abs(run(V, 1, null, zoomFromWheel(3000)).fov - HELM_CAM.fovMax) < 1e-9);
  const F = createViews({ vessel: CURRENT_VESSEL, view: 'follow' });
  F.pose(1 / 60, follow, boat, { look: [1, 0.5], zoom: 2 });
  assert.equal(F.helmCam.yawT, 0); assert.equal(F.helmCam.zoom, 1);
});

test('the boat routes its hands by the view: the follow camera orbits in the follow view, the helm camera looks in the helm view', () => {
  const B = createBoatSim({ water: { heightAt: () => 0, surface: { heightAt: () => 0 }, waveAt: () => ({ y: 0, nx: 0, nz: 0 }) }, wind: { sample: () => ({ vx: 4, vz: 0 }) }, start: { x: 0, z: 0, headingDeg: 90, speed: 2 } });
  for (let i = 0; i < 30; i++) { B.step(1 / 60); B.camera(1 / 60); }
  let view = 'follow'; B.viewOf = () => view;
  const yaw0 = B.follow.yaw;
  B.input({ orbit: [0.3, 0], zoom: 0 }); B.camera(1 / 60);
  assert.ok(Math.abs(B.follow.yaw - yaw0 - 0.3) < 1e-9, 'the follow view: the follow camera orbits');
  assert.equal(B.helmLook.look, null);
  view = 'helm';
  const yaw1 = B.follow.yaw;
  B.input({ orbit: [0.3, 0.1], zoom: 1.1 }); B.camera(1 / 60);
  assert.deepEqual(B.helmLook.look, [0.3, 0.1]); assert.equal(B.helmLook.zoom, 1.1);
  assert.ok(Math.abs(B.follow.yaw - yaw1) < 0.05, 'the helm view: the follow camera does not orbit');
  B.camera(1 / 60);
  assert.equal(B.helmLook.look, null, 'consumed: the next frame has no look');
});

// a canvas stand-in: listeners by type, and the window's height for the swipe band
function fakeCanvas() {
  const on = {};
  return { style: {}, on, addEventListener: (t, f) => { (on[t] ??= []).push(f); }, setPointerCapture() {}, fire(t, e) { for (const f of on[t] ?? []) f({ preventDefault() {}, ...e }); } };
}

test('the hands on the canvas: v1\'s 5 px click threshold, any button drags, held = [0, 0], the wheel, two fingers look and pinch', () => {
  globalThis.innerHeight = 720; globalThis.innerWidth = 1280;
  const c = fakeCanvas(), H = createTouch({ canvas: c, host: null, show: false });
  assert.equal(c.style.touchAction, 'none');
  let defaulted = false; c.fire('contextmenu', { preventDefault() { defaulted = true; } });
  assert.ok(defaulted, 'no context menu: the right button drags');
  // a click: under 5 px, no look
  c.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 600, clientY: 300 });
  c.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 603, clientY: 301 });
  assert.equal(H.read().orbit, null, 'a click travels under 5 px: no look');
  // past the threshold: the first move carries the travel so far
  c.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 620, clientY: 290 });
  assert.deepEqual(H.read().orbit, orbitFromDrag(20, -10));
  assert.deepEqual(H.read().orbit, [0, 0], 'held still: [0, 0], the drag still held');
  c.fire('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 640, clientY: 290 });
  assert.deepEqual(H.read().orbit, orbitFromDrag(20, 0), 'then the move since the last');
  c.fire('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 640, clientY: 290 });
  assert.equal(H.read().orbit, null, 'let go: no look');
  // the right button drags too
  c.fire('pointerdown', { pointerId: 2, pointerType: 'mouse', button: 2, clientX: 600, clientY: 300 });
  c.fire('pointermove', { pointerId: 2, pointerType: 'mouse', clientX: 560, clientY: 300 });
  assert.deepEqual(H.read().orbit, orbitFromDrag(-40, 0), 'a right drag looks');
  c.fire('pointerup', { pointerId: 2, pointerType: 'mouse', clientX: 560, clientY: 300 }); H.read();
  // the wheel
  c.fire('wheel', { deltaY: 100 }); c.fire('wheel', { deltaY: 100 });
  assert.ok(Math.abs(H.read().zoom - Math.exp(0.2)) < 1e-12, 'two wheel notches multiply');
  assert.equal(H.read().zoom, 0, 'consumed');
  // nothing within 24 px of the bottom edge (the phone's swipe)
  c.fire('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 600, clientY: 710 });
  c.fire('pointermove', { pointerId: 3, pointerType: 'touch', clientX: 680, clientY: 700 });
  assert.equal(H.read().orbit, null, 'the swipe band is the phone\'s');
  c.fire('pointerup', { pointerId: 3, pointerType: 'touch', clientX: 680, clientY: 700 });
  // two fingers: their midpoint looks, their spread zooms (apart → closer, < 1)
  c.fire('pointerdown', { pointerId: 4, pointerType: 'touch', clientX: 500, clientY: 300 });
  c.fire('pointerdown', { pointerId: 5, pointerType: 'touch', clientX: 700, clientY: 300 });
  c.fire('pointermove', { pointerId: 5, pointerType: 'touch', clientX: 900, clientY: 300 });
  const g = H.read();
  assert.ok(g.orbit && Math.abs(g.orbit[0] - 100 * TOUCH_LOOK.dragX) < 1e-12, `the midpoint moved 100 px: a look (${g.orbit})`);
  assert.ok(Math.abs(g.zoom - 200 / 400) < 1e-12, `the fingers spread 200 → 400 px: zoom 0.5 (${g.zoom})`);
  c.fire('pointerup', { pointerId: 4, pointerType: 'touch' }); c.fire('pointerup', { pointerId: 5, pointerType: 'touch' });
  assert.equal(H.read().orbit, null);
});
