// The hands' mapping (M3, v2/sim/controls.js): v1's steering and sheet keys (src/sail/keys.js KEYMAP) give the two
// verbs; the keys and a phone's hands sum and clamp; the helm strip, the orbit and the zoom are pure maps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, CODES, keysToAxes, sumHands, helmFromDrag, orbitFromDrag, zoomFromWheel, isPortrait } from '../sim/controls.js';
import { KEYMAP } from '../../src/sail/keys.js';

const actionsOf = (code) => KEYMAP.filter((k) => k.code === code).map((k) => k.action);

test('every code v2 listens for is a v1 steering or sheet key, with v1\'s meaning', () => {
  for (const c of KEYS.port) assert.ok(actionsOf(c).includes('steer to port'), c);
  for (const c of KEYS.starboard) assert.ok(actionsOf(c).includes('steer to starboard'), c);
  for (const c of KEYS.pullIn) assert.ok(actionsOf(c).includes('pull the sheets in'), c);
  for (const c of KEYS.ease) assert.ok(actionsOf(c).includes('ease the sheets'), c);
  assert.equal(new Set(CODES).size, CODES.length, 'no code twice');
  assert.equal(CODES.length, 8);
});

test('keys → axes: A/← port, D/→ starboard, W/↑ in, S/↓ ease; both sides held cancel', () => {
  assert.deepEqual(keysToAxes(new Set()), { steer: 0, pull: 0 });
  assert.deepEqual(keysToAxes(new Set(['KeyA'])), { steer: -1, pull: 0 });
  assert.deepEqual(keysToAxes(new Set(['ArrowRight', 'KeyW'])), { steer: 1, pull: 1 });
  assert.deepEqual(keysToAxes(new Set(['KeyA', 'KeyD', 'ArrowDown'])), { steer: 0, pull: -1 });
  assert.deepEqual(keysToAxes(new Set(['KeyQ', 'Space'])), { steer: 0, pull: 0 }, 'other keys do nothing here');
});

test('the hands sum and clamp; the helm strip is linear to its full width; the orbit and zoom maps', () => {
  assert.deepEqual(sumHands({ steer: 1, pull: 0 }, { steer: 0.5, pull: -1 }), { steer: 1, pull: -1 });
  assert.deepEqual(sumHands({ steer: -0.3 }, null, { pull: 0.4 }), { steer: -0.3, pull: 0.4 });
  assert.equal(helmFromDrag(0, 100), 0); assert.equal(helmFromDrag(50, 100), 0.5); assert.equal(helmFromDrag(-300, 100), -1);
  const [ox, oy] = orbitFromDrag(100, -50);
  assert.ok(ox > 0 && oy < 0 && Math.abs(ox) < 1 && Math.abs(oy) < 1, 'a drag right orbits right, up looks up, in radians');
  assert.ok(zoomFromWheel(100) > 1 && zoomFromWheel(-100) < 1 && Math.abs(zoomFromWheel(100) * zoomFromWheel(-100) - 1) < 1e-9, 'the wheel zooms both ways symmetrically');
  assert.ok(Math.abs(zoomFromWheel(100) - Math.exp(0.1)) < 1e-12, 'v1\'s deck: exp(deltaY × 0.001) (each camera clamps its own zoom)');
  assert.equal(isPortrait(390, 844), true); assert.equal(isPortrait(1280, 720), false);
});
