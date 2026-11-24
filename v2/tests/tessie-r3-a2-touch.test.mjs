// Refactor round 3, A2 bug 7: swap-back drops a held tablet stick, so the next visit takes a fresh pointerdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';

const DT = 1 / 30, deep = () => 40;
const cam = (x, z) => ({ pos: [x, 3, z + 20], target: [x, 1, z], fov: 55 });

// A bare DOM: every element records its listeners; querySelector hands back one stub per selector.
function mk(tag = 'div') {
  const listeners = {}, kids = {};
  return {
    tagName: tag.toUpperCase(), dataset: {}, style: {}, listeners, hidden: false, children: [],
    addEventListener(t, f) { (listeners[t] ??= []).push(f); }, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, hasAttribute() { return false; },
    appendChild(c) { return c; }, prepend() {}, append() {}, after() {}, before() {}, replaceChildren() {}, insertBefore(c) { return c; }, remove() {}, matches() { return false; }, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    querySelector(s) { return (kids[s] ??= mk()); }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

test('swap-back drops a held tablet stick: a new pointerdown is taken on the next visit', () => {
  let made = null; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.document = { createElement: (t) => { const e = mk(t); if (t === 'div') made ??= e; return e; }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: mk('body'), head: mk('head'), documentElement: mk('html'), activeElement: null, addEventListener() {}, removeEventListener() {} };
  try {
    const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
    const sim = createTessie({ seed: 1, depthAt: deep });
    const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
    const P = createTessiePlayer({ plugin, B, depthAt: deep, touch: () => true, veil: () => {}, storage: null });
    sim.ambush(30, -40, Math.PI / 2, TESSIE.U); sim.hunt(false);
    for (let k = 0; k < 8 / DT; k++) sim.step(DT, { playing: true, boat: { x: 0, z: 0, heading: 0, speed: 0 }, view: { x: 0, z: 20, yaw: 0, hHalf: 0.6 } });
    P.camera(DT, cam(0, 0));
    P.swap.step(DT, { on: true, shown: true, distM: 50 });
    assert.ok(P.become('swap').ok);
    P.camera(DT, cam(0, 0));
    assert.ok(made, 'the touch layer was built');
    const zone = made.querySelector('.tp-zone');
    const down = (id) => { let taken = false; for (const f of zone.listeners.pointerdown) f({ pointerId: id, clientX: 50, clientY: 50, preventDefault() { taken = true; } }); return taken; };
    assert.equal(down(1), true, 'the first touch takes the stick');
    assert.ok(P.back());
    P.camera(DT, cam(0, 0));
    P.swap.step(DT, { on: true, shown: true, distM: 50 });
    const r2 = P.become('swap');
    assert.ok(r2.ok, JSON.stringify(r2));
    assert.equal(down(2), true, 'a new touch takes the stick after swap-back');
  } finally { delete globalThis.document; delete globalThis.addEventListener; delete globalThis.removeEventListener; }
});
