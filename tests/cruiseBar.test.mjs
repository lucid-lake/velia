// Cruise's one bar (owner, 2026-11-11, 37c § 4): the bottom bar and the Mood are gone. What they held lives on:
// the day's periods and the clock's forward jump (src/ui/timeMenu.js), the photo's name (src/ui/photo.js), the wake and fade
// shared with the Calm HUD, steering as the hand-over, and the double-tap mark (src/modes/chill/markTap.js, the real navigator's checks).
// The bar itself (slots, the camera menu, the Locker, the chevrons): tests/viewSwitch.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMES, timeOf, hourJump, TIME_ROWS } from '../src/ui/timeMenu.js';
import { photoName } from '../src/ui/photo.js';
import { CalmClock, CALM } from '../src/ui/calmHud.js';
import { cruiseKind } from '../src/sail/keys.js';
import { keyClass } from '../src/modes/chill/intent.js';
import { DoubleTap, MARK_TAP, markScreen, createMarkRing, createMarkRings } from '../src/modes/chill/markTap.js';
import { installDom } from './helpers/dom-cascade.mjs';
import * as THREE from 'three';

test('the time periods and the clock jump: the word follows the hour; a pick always moves the clock ahead', () => {
  assert.equal(timeOf(5.8).id, 'dawn'); assert.equal(timeOf(9).id, 'morning'); assert.equal(timeOf(13).id, 'noon');
  assert.equal(timeOf(19.2).id, 'golden'); assert.equal(timeOf(20.6).id, 'dusk'); assert.equal(timeOf(23).id, 'night'); assert.equal(timeOf(2).id, 'night');
  for (const t of TIMES.filter((x) => x.hour != null)) assert.equal(timeOf(t.hour).id, t.id, `${t.name}'s own hour reads as ${t.name}`);
  assert.deepEqual(TIME_ROWS.filter((r) => r.hour != null).map((r) => r.hour), [5.6, 13, 19.25, 22.5], 'the clock menu\'s four hours');
  assert.equal(hourJump(17.9, 19.25), 19.25);
  assert.equal(hourJump(17.9, 5.6), 29.6, 'dawn is the next morning');
  assert.equal(hourJump(43.9, 13), 61, 'unwrapped: from the day the clock is on');
  assert.ok(hourJump(19.25, 19.25) > 19.25, 'never backwards');
});

test('the photo\'s file name: velia, the place, the hour', () => {
  assert.equal(photoName('the waterfall', 19.07), 'velia-the-waterfall-19-04.png');
  assert.equal(photoName('Fannette Island', 6.5), 'velia-fannette-island-06-30.png');
  assert.equal(photoName(null, 0), 'velia-00-00.png');
});

test('wake and fade: the one bar comes and goes with the Calm HUD (5 s idle); an open menu holds it', () => {
  const c = new CalmClock();
  const run = (s) => { let v; for (let t = 0; t < s - 1e-9; t += 0.1) v = c.tick(0.1); return v; };
  assert.equal(run(CALM.idleS + 0.2).bar, false, 'idle: nothing');
  c.wake('bar'); assert.equal(c.view.bar, true, 'a mouse move, a tap or (in Cruise) a key');
  assert.equal(run(CALM.idleS - 0.2).bar, true);
  assert.equal(run(0.4).bar, false, 'and it leaves');
  assert.equal(c.tick(0.1, { busy: true }).bar, true, 'an open menu (busy) holds it');
});

test('taking the helm by steering: A D and the arrows are intent (the hand-over), the passenger keys are not', () => {
  for (const code of ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight']) assert.equal(keyClass({ code, key: code }), 'intent', code);
  for (const code of ['KeyC', 'KeyN', 'KeyB']) assert.equal(cruiseKind(code, false), 'passenger', code);
});

// Your mark by a double-tap (owner, 2026-11-11, pattern C): two taps within 350 ms and 24 px, no drag; a single tap
// is the wake, a slow or far second tap starts a new pair. The ring sits on the mark's spot on screen; a double-tap within 36 px of it clears.
test('the double-tap rule: a second tap within 350 ms and 24 px makes a pair; slow, far or third taps do not', () => {
  assert.deepEqual([MARK_TAP.ms, MARK_TAP.px], [350, 24]);
  const d = new DoubleTap();
  assert.equal(d.tap({ x: 100, y: 100, t: 0 }), false, 'one tap: the wake, not a mark');
  assert.equal(d.tap({ x: 110, y: 108, t: 300 }), true, 'the second, close and quick: a mark');
  assert.equal(d.tap({ x: 110, y: 108, t: 400 }), false, 'a third tap starts over (no triple marks)');
  assert.equal(d.tap({ x: 110, y: 108, t: 800 }), false, 'too slow: a new first tap');
  assert.equal(d.tap({ x: 160, y: 108, t: 900 }), false, 'too far (50 px): a new first tap');
  assert.equal(d.tap({ x: 162, y: 110, t: 1100 }), true);
  d.tap({ x: 0, y: 0, t: 2000 }); d.reset(); assert.equal(d.tap({ x: 0, y: 0, t: 2100 }), false, 'a drag between resets the pair');
});

test('the ring: the mark\'s spot projected on screen (null behind the camera), and a double-tap on it is "near"', () => {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 5000);
  cam.position.set(0, 10, 50); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const rect = { left: 0, top: 0, width: 1600, height: 900 };
  const at = markScreen(cam, rect, 0, 0);
  assert.ok(at && Math.abs(at[0] - 800) < 0.5 && Math.abs(at[1] - 450) < 0.5, `the look point lands mid-screen (${at})`);
  const far = markScreen(cam, rect, 0, -400); assert.ok(far[1] < 450, 'a farther mark sits higher, toward the horizon');
  assert.equal(markScreen(cam, rect, 0, 200), null, 'behind the camera: no ring');
  const dom = installDom({ w: 1600, h: 900 });
  try {
    const ring = createMarkRing();
    assert.equal(ring.el.hidden, true, 'no mark: no ring');
    ring.update({ at }); assert.equal(ring.el.hidden, false);
    assert.ok(ring.near(at[0] + 20, at[1] - 20), 'a double-tap on the ring');
    assert.ok(!ring.near(at[0] + 60, at[1]), 'a double-tap beside it sets a new mark');
    ring.update({ at: null }); assert.equal(ring.el.hidden, true, 'cleared: gone'); assert.ok(!ring.near(at[0], at[1]));
    ring.dispose();
  } finally { dom.uninstall(); }
});

test('a route\'s rings: one a waypoint, the first amber and the rest cream; a double-tap finds which', () => {
  const dom = installDom({ w: 1600, h: 900 });
  try {
    const rings = createMarkRings();
    rings.update({ ats: [[400, 500], [900, 420], null] });
    assert.equal(rings.count, 2, 'two on screen, one off it');
    const els = [...document.querySelectorAll('.lk-mark')];
    assert.equal(els.length, 3); assert.ok(!els[0].classList.contains('next') && els[1].classList.contains('next'), 'the active ring amber, the next cream');
    assert.equal(rings.nearIndex(910, 430), 1); assert.equal(rings.nearIndex(400, 500), 0); assert.equal(rings.nearIndex(650, 300), -1);
    rings.update({ ats: [] }); assert.equal(rings.count, 0); assert.ok(els.every((e) => e.hidden));
    rings.dispose(); assert.equal(document.querySelectorAll('.lk-mark').length, 0);
  } finally { dom.uninstall(); }
});
