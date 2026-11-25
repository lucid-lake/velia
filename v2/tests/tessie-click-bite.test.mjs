// Play as Tessie: a left click on the water bites, as Space (owner, 2026-11-24); F no longer bites (owner, the same day: "space and
// click is enough"). The rule (living/tessiePlayer.js createClickBite): a canvas press released within 250 ms and under 5 px bites on
// its release; a press that travels further is the look drag, never a bite; a press on anything over the canvas never bites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createTessiePlayer, createClickBite, TESSIE_KEYS } from '../living/tessiePlayer.js';
import { KEY_TESSIE, keyTable } from '../ui/keyMap.js';
import { LEGEND } from '../ui/tessieHud.js';
import { keysPageHtml } from '../../src/ui/keysContent.js';

const DT = 1 / 30, deep = () => 40;
const cam = (x, z) => ({ pos: [x, 3, z + 20], target: [x, 1, z], fov: 55 });

// a bare DOM: every element records its listeners; querySelector hands back one stub per selector
function mk(tag = 'div') {
  const listeners = {}, kids = {};
  return {
    tagName: tag.toUpperCase(), dataset: {}, style: {}, listeners, hidden: false, children: [],
    addEventListener(t, f) { (listeners[t] ??= []).push(f); }, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, hasAttribute() { return false; },
    appendChild(c) { return c; }, prepend() {}, append() {}, after() {}, before() {}, replaceChildren() {}, insertBefore(c) { return c; }, remove() {}, matches() { return false; }, setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    querySelector(s) { return (kids[s] ??= mk()); }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

// the page as far as the player needs it: a canvas, the window's key listeners; she is played (the swap) and stepped with her sim
function rig({ touch = false } = {}) {
  const win = {};
  globalThis.addEventListener = (t, f) => { (win[t] ??= []).push(f); }; globalThis.removeEventListener = () => {};
  globalThis.document = { createElement: (t) => mk(t), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: mk('body'), head: mk('head'), documentElement: mk('html'), activeElement: null, addEventListener() {} };
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const canvas = mk('canvas');
  const P = createTessiePlayer({ plugin, B, depthAt: deep, canvas, touch: () => touch, veil: () => {}, storage: null });
  const b0 = { x: 0, z: 0, heading: 0, speed: 0 };
  sim.ambush(30, -40, Math.PI / 2, TESSIE.U); sim.hunt(false);
  for (let k = 0; k < 8 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: 0, z: 20, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, cam(0, 0));
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  const r = P.become('swap'); assert.ok(r.ok, JSON.stringify(r));
  plugin.playing = true;
  let t = 1000, bites = 0;
  // n frames of the page: her sim, then the player (its hands, the controller); the bites started counted from the controller's events
  const run = (n = 1) => { for (let k = 0; k < n; k++) { sim.step(DT, { playing: true, boat: b0, view: { x: 0, z: 20, yaw: 0, hHalf: 0.6 } }); P.step(DT); P.camera(DT, cam(0, 0)); bites += P.ctl.events.filter((e) => e.type === 'bite').length; t += DT * 1000; } };
  const fire = (type, o) => { for (const f of canvas.listeners[type] ?? []) f({ pointerId: 1, pointerType: 'mouse', button: 0, target: canvas, timeStamp: t, ...o }); };
  // a press at (x, y), moved to (x + dx, y + dy), released after ms
  const press = (ms = 90, dx = 0, dy = 0, o = {}) => { fire('pointerdown', { clientX: 400, clientY: 300, ...o }); if (dx || dy) fire('pointermove', { clientX: 400 + dx, clientY: 300 + dy, timeStamp: t + ms / 2, ...o }); fire('pointerup', { clientX: 400 + dx, clientY: 300 + dy, timeStamp: t + ms, ...o }); };
  const key = (type, code) => { let stopped = false; for (const f of win[type] ?? []) f({ code, repeat: false, preventDefault() {}, stopImmediatePropagation() { stopped = true; } }); return stopped; };   // true: the boat's listeners never see it
  run(2);
  return { P, run, press, fire, key, get bites() { return bites; }, canvas };
}
const cleanup = () => { delete globalThis.document; delete globalThis.addEventListener; delete globalThis.removeEventListener; };

test('the click rule: a quick still press bites on its release; a drag, a slow press, the right button or a finger never does', () => {
  let n = 0;
  const K = createClickBite({ bite: () => n++ });
  const go = (o = {}, { dx = 0, ms = 100 } = {}) => { const e = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10, ...o }; K.down({ ...e, timeStamp: 1 }); if (dx) K.move({ ...e, clientX: 10 + dx }); return K.up({ ...e, clientX: 10 + dx, timeStamp: 1 + ms }); };
  assert.equal(go(), true, 'a click bites'); assert.equal(n, 1);
  assert.equal(go({}, { dx: 4 }), true, '4 px of travel is still a click');
  assert.equal(go({}, { dx: 30 }), false, 'a drag looks, never bites');
  // travel that comes back is still a drag (the look already moved)
  K.down({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10, timeStamp: 1 }); K.move({ pointerId: 1, clientX: 60, clientY: 10 });
  assert.equal(K.up({ pointerId: 1, clientX: 10, clientY: 10, timeStamp: 50 }), false, 'out and back: a drag');
  assert.equal(go({}, { ms: 400 }), false, 'a press held 400 ms is not a click');
  assert.equal(go({ button: 2 }), false, 'the right button: unchanged (it looks)');
  assert.equal(go({ pointerType: 'touch' }), false, 'a finger: the tablet has its Bite button');
  assert.equal(go({ ctrlKey: true }), false, 'Ctrl-click (a Mac\'s right click) never bites');
  assert.equal(n, 2);
  let on = false; const K2 = createClickBite({ on: () => on, bite: () => n++ });
  K2.down({ pointerId: 1, button: 0, clientX: 0, clientY: 0, timeStamp: 1 }); assert.equal(K2.up({ pointerId: 1, clientX: 0, clientY: 0, timeStamp: 50 }), false, 'off while the boat is played');
});

test('as Tessie: a quick click bites through the controller (the bite event), a drag does not', () => {
  try {
    const R = rig();
    const b0 = R.bites;
    R.press(80); R.run(3);
    assert.equal(R.bites - b0, 1, 'one click, one bite');
    assert.ok(R.P.ctl.state.bite, 'the bite plays');
    R.run(90);   // the bite, its verdict and the cooldown done
    const b1 = R.bites;
    R.press(150, 40, 20); R.run(30);
    assert.equal(R.bites - b1, 0, 'a drag never bites');
  } finally { cleanup(); }
});

test('as Tessie: a press on a UI element over the water never bites', () => {
  try {
    const R = rig();
    const b0 = R.bites;
    R.press(80, 0, 0, { target: mk('button') }); R.run(10);
    assert.equal(R.bites - b0, 0, 'a button over the canvas takes its own press');
  } finally { cleanup(); }
});

test('the click shares Space\'s cooldown: a click while the Space bite plays starts no second bite; after it, a click bites', () => {
  try {
    const R = rig();
    const b0 = R.bites;
    R.key('keydown', 'Space'); R.run(1); R.key('keyup', 'Space'); R.run(5);
    assert.equal(R.bites - b0, 1, 'Space bites');
    R.press(80); R.run(20);
    assert.equal(R.bites - b0, 1, 'the click inside the bite and its cooldown: no second bite');
    R.run(90);
    R.press(80); R.run(3);
    assert.equal(R.bites - b0, 2, 'once ready, the click bites');
  } finally { cleanup(); }
});

test('F no longer bites (owner, 2026-11-24): it does nothing as Tessie, and the boat never sees it', () => {
  try {
    const R = rig();
    const b0 = R.bites;
    assert.equal(R.key('keydown', 'KeyF'), true, 'F stops here (the Pro jib key never reaches the boat)'); R.run(1); R.key('keyup', 'KeyF'); R.run(10);
    assert.equal(R.bites - b0, 0, 'F: no bite');
    assert.ok(!TESSIE_KEYS.has('KeyF'), 'F is not one of her keys');
  } finally { cleanup(); }
});

test('a tablet: a mouse-like click on the canvas never bites (its own Bite button does)', () => {
  try {
    const R = rig({ touch: true });
    const b0 = R.bites;
    R.press(80); R.run(5);
    assert.equal(R.bites - b0, 0);
  } finally { cleanup(); }
});

test('the Keys page and her legend: bite is Space or click, no F', () => {
  const row = KEY_TESSIE.rows.find((r) => r.id === 't-bite');
  assert.deepEqual(row.k, ['Space', 'click']);
  assert.deepEqual(row.codes, ['Space']);
  const html = keysPageHtml({ table: keyTable({ tessie: true }) });
  const m = html.match(/<div class="kr2" data-row="t-bite"[^>]*>(.*?)<\/div>/);
  assert.ok(m, 'the t-bite row');
  const caps = [...m[1].matchAll(/data-k="([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(caps, ['Space', 'click'], 'the row shows Space and click only');
  const bite = LEGEND.find((l) => l.id === 'bite');
  assert.deepEqual(bite.caps, ['Space', 'click']);
  assert.ok(!bite.codes.includes('KeyF'));
});
