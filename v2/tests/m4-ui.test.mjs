// M4: the UI's pure wiring. The keys Sail's UI owns (v2/ui/keys.js) are v1's own codes; the views (v2/ui/views.js) run v1's
// helm camera and blend (the helm eye in the cockpit, the ≈ 1 s move); the station's hands reach the sim as v1's controller
// passes them (v2/sim/boat.js station(): the wheel in the hand, each winch's sheet, the Tack assist); the wind keys reach the
// shared WindField's setLevel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyAction, UI_KEYS } from '../ui/keys.js';
import { createViews } from '../ui/views.js';
import { HORIZON } from '../sim/steadyCamera.js';
import { KEYMAP } from '../../src/sail/keys.js';
import { createBoatSim, waterFor, START } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { HELM_CAM } from '../../src/sim/boat/helmCamera.js';

const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });

test('keys: every code the UI owns is bound in v1\'s KEYMAP with the same meaning; the lean set has no wind keys, no reef, no wing, no chase', () => {
  const bound = new Set(KEYMAP.map((k) => k.code));
  for (const c of [UI_KEYS.view, UI_KEYS.tack, UI_KEYS.fold]) assert.ok(bound.has(c), `${c} in v1's KEYMAP`);
  assert.deepEqual(Object.keys(UI_KEYS).sort(), ['fold', 'tack', 'view'], 'C, Space and H only');
  for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyK']) assert.equal(keyAction({ code }), null, `${code}: no key`);
  assert.deepEqual(keyAction({ code: 'KeyC' }), { view: 'toggle' });
  assert.equal(keyAction({ code: 'KeyC', shiftKey: true }), null, 'Shift+C: no chase camera');
  assert.equal(keyAction({ code: 'KeyC', repeat: true }), null, 'a held C does not flap the view');
  assert.deepEqual(keyAction({ code: 'Space' }), { tack: true });
  assert.equal(keyAction({ code: 'Space', typing: true }), null, 'Space on a focused button is the button\'s');
  assert.equal(keyAction({ code: 'KeyC', metaKey: true }), null);
  assert.equal(keyAction({ code: 'KeyA' }), null, 'the helm is the boat\'s own key (main.js)');
});

test('views: the helm view puts the eye in the cockpit (v1\'s helm camera), the move takes about 1 s, and back', () => {
  const V = createViews({ vessel: CURRENT_VESSEL, followYaw: () => 0 });
  const boat = { x: 100, z: 200, heading: 0.5, heel: 0.1, pitch: 0, heave: 0 };
  const follow = { pos: [100 - 30 * Math.sin(0.5), 8, 200 + 30 * Math.cos(0.5)], target: [100, 2, 200], fov: 50 };
  assert.equal(V.view, 'follow'); assert.equal(V.pose(1 / 60, follow, boat).pos[0], follow.pos[0]);
  V.set('helm');
  let p = null, t = 0;
  while (V.k < 1 && t < 3) { p = V.pose(1 / 60, follow, boat); t += 1 / 60; }
  assert.ok(t > 0.75 && t < 1.25, `the move took ${t.toFixed(2)} s`);
  const d = Math.hypot(p.pos[0] - boat.x, p.pos[2] - boat.z);
  assert.ok(d < 4, `the eye is on the boat (${d.toFixed(2)} m from its origin)`);
  assert.ok(Math.abs(p.fov - HELM_CAM.fov) < 1e-9 && p.up, 'the helm camera\'s field and its tilted up vector');
  assert.equal(V.helmCam.horizon, HORIZON, 'the steady horizon');
  V.toggle(); assert.equal(V.view, 'follow');
});

test('the station\'s hands: the wheel steers, the main\'s winch moves the sheet, the jib\'s its trim, the Tack assist steers', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(6, 200) });
  B.settle(10);
  B.station({ helm: 0.8 });
  for (let i = 0; i < 60; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(B.ctl.rudder > 0.5, `the wheel held the rudder over (${B.ctl.rudder.toFixed(2)})`);
  B.station({ helm: null });
  B.step(1 / 60, { steer: 0, pull: 0 });
  const s0 = B.hand.sheet;
  B.station({ main: 0.1 }); B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(B.hand.sheet < s0, 'a pull on the main\'s winch brings the sheet in');
  const j0 = B.ctl.jibTrim ?? 0;
  B.station({ jibHold: -1 }); for (let i = 0; i < 30; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok((B.ctl.jibTrim ?? 0) > j0, 'the jib\'s ease step lets its sheet out');
  B.station({ jibHold: 0, ext: -1 }); for (let i = 0; i < 30; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(B.ctl.rudder < 0, 'the Tack assist turns the helm');
});

test('the wind level (the Conditions sheet\'s) reaches the shared WindField (v1\'s setLevel, blown in over 25 s)', () => {
  const W = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, day: { hour: 15, rate: 0 }, level: 2 });
  assert.equal(W.level, 2);
  W.setLevel(4, { t: 0, at: { x: START.x, z: START.z }, overS: 25 });
  assert.equal(W.level, 4);
});

test('let fly: a click on the JIB winch throws its sheet off (v1\'s LetFly), a second one grinds it back in', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(6, 200) });
  B.settle(10);
  B.station({ fly: { jib: true } }); B.step(1 / 60, { steer: 0, pull: 0 });
  assert.equal(B.free.jib, true); assert.equal(B.ctl.jibFree, true);
  B.station({ fly: { jib: true } }); B.step(1 / 60, { steer: 0, pull: 0 });
  assert.equal(B.free.jib, false, 'back in');
});
