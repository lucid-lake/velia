// The throttle lever (src/stations/sloop/throttleLever.js, seamanship.js): the notches, the stepping, the auto-start,
// W / S always trim, and the sprite's frame and the scale's marks follow the lever.
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTCHES, LEVER, notchIndex, stepNotch, autoStart, frameOf, knobY, leverAtY, slotY, leverAtSlot, SLOT, fingerNotch, FINGER_LEVER } from '../src/stations/sloop/throttleLever.js';
import { Engine, ENGINE } from '../src/sim/boat/engine.js';
import { NOTES } from '../src/ui/skipper.js';

const ids = NOTCHES.map((n) => n.id);
test('six notches, ahead to astern, STOP in neutral', () => {
  assert.deepEqual(ids, ['full-ahead', 'half', 'slow', 'stop', 'slow-astern', 'full-astern']);
  assert.ok(NOTCHES.every((n, i) => i === 0 || n.v < NOTCHES[i - 1].v));
  assert.ok(Math.abs(NOTCHES[3].v) < ENGINE.detent, 'STOP is inside the neutral band');
  for (const n of NOTCHES) if (n.id !== 'stop') assert.ok(Math.abs(n.v) >= ENGINE.detent, `${n.id} is in gear`);
});

test('stepping: a notch at a time, through STOP, it stops at the ends; from between notches the next one that way', () => {
  let v = 0; const seq = [];
  for (let i = 0; i < 5; i++) { v = stepNotch(v, 1); seq.push(NOTCHES[notchIndex(v)].id); }
  assert.deepEqual(seq, ['slow', 'half', 'full-ahead', 'full-ahead', 'full-ahead']);
  const back = []; for (let i = 0; i < 6; i++) { v = stepNotch(v, -1); back.push(NOTCHES[notchIndex(v)].id); }
  assert.deepEqual(back, ['half', 'slow', 'stop', 'slow-astern', 'full-astern', 'full-astern']);
  assert.equal(stepNotch(0.45, 1), 0.6); assert.equal(stepNotch(0.45, -1), 0.3); assert.equal(stepNotch(0.3, 0), 0.3);
});

test('out of STOP with the engine off, it starts; not from a gear, not with it on, not into STOP', () => {
  assert.equal(autoStart({ from: 0, to: 0.3, engineOn: false }), true);
  assert.equal(autoStart({ from: 0, to: -0.35, engineOn: false }), true);
  assert.equal(autoStart({ from: 0, to: 0.3, engineOn: true }), false);
  assert.equal(autoStart({ from: 0.3, to: 0.6, engineOn: false }), false);
  assert.equal(autoStart({ from: 0.3, to: 0, engineOn: false }), false);
  // the engine itself: start() cranks, then it runs at the lever
  const e = new Engine(); assert.equal(e.state, 'off'); e.start(); e.setLever(0.3); assert.equal(e.state, 'cranking');
});

test('the lever draws the state: the knob\'s place in the slot follows the lever (ahead up, the ends at the slot\'s ends); a drag inverts it', () => {
  assert.equal(frameOf(-1), 0); assert.equal(frameOf(1), LEVER.frames - 1); assert.equal(frameOf(0), (LEVER.frames - 1) / 2);   // the probes' frame count
  assert.ok(knobY(1) < knobY(0) && knobY(0) < knobY(-1), 'ahead is up');
  assert.equal(slotY(1), SLOT.top); assert.equal(slotY(-1), SLOT.bottom);
  assert.ok(slotY(0.6) < slotY(0.3) && slotY(0.3) < slotY(0) && slotY(0) < slotY(-0.35));
  for (const v of [-1, -0.35, 0, 0.3, 0.6, 1]) { assert.ok(Math.abs(leverAtY(knobY(v)) - v) < 1e-9); assert.ok(Math.abs(leverAtSlot(slotY(v)) - v) < 1e-9); }
  assert.ok(leverAtSlot(0) > 1 - 1e-9, 'a drag past the top is full ahead'); assert.ok(leverAtSlot(200) < -1 + 1e-9);
});

test('W / S always trim (never the throttle); + − 0 work the lever, a tap a notch, held a notch every 0.3 s', () => {
  // Sail's real controls (controls.js, seamanship.js) in node: keys in, the sheet and the engine's lever out
  const s = mountSail(), eng = s.phys.engine, DEG = Math.PI / 180;
  try {
    s.step(30);
    for (const [pull, ease] of [['KeyW', 'KeyS'], ['ArrowUp', 'ArrowDown']]) {
      const a = s.c.sheet; s.key(pull); s.step(15); s.key(pull, false);
      const b = s.c.sheet; s.key(ease); s.step(15); s.key(ease, false);
      assert.ok(b < a - 3 * DEG && s.c.sheet > b + 3 * DEG, `${pull} pulls the sheet in, ${ease} eases it (${(a / DEG).toFixed(1)}° → ${(b / DEG).toFixed(1)}° → ${(s.c.sheet / DEG).toFixed(1)}°)`);
      assert.equal(eng.lever, 0, `${pull} / ${ease} never move the throttle`); assert.equal(eng.on, false, `${pull} / ${ease} never start the engine`);
    }
    // + (Equal): a tap is one notch; out of STOP with the engine off, it starts
    s.tap('Equal'); assert.equal(eng.lever, 0.3); assert.equal(eng.on, true, 'out of STOP it starts');
    // held: a notch every 0.3 s, and it stays where it stops
    s.tap('Digit0'); assert.equal(eng.lever, 0, '0: neutral');
    s.key('Equal');
    const seen = [{ v: eng.lever, t: 0 }]; let t = 0;
    for (let i = 0; i < 70; i++) { s.step(1, 1 / 100); t += 1 / 100; if (seen.at(-1).v !== eng.lever) seen.push({ v: eng.lever, t: +t.toFixed(3) }); }
    s.key('Equal', false);
    assert.deepEqual(seen.map((x) => x.v), [0.3, 0.6, 1], 'slow, half, full ahead');
    for (let i = 1; i < seen.length; i++) { const gap = seen[i].t - seen[i - 1].t; assert.ok(gap > 0.3 - 1e-6 && gap < 0.3 + 0.01 + 1e-6, `a notch every 0.3 s (at ${seen.map((x) => x.t).join(', ')} s)`); }
    s.step(10); assert.equal(eng.lever, 1, 'let go: it stays');
    s.tap('Minus'); assert.equal(eng.lever, 0.6, '−: a notch back');
  } finally { s.dispose(); }
});

test('the skipper\'s engine lines', () => {
  assert.match(NOTES.motorKeys.text, /more power.*slow.*holds the setting/);
  assert.equal(NOTES.sailsDown.text, 'Sails down? Press Y');
  assert.match(NOTES.engine.text, /The sails can carry her now/);
});

test('the control panel: no ENGINE anywhere (the lever starts and stops it); the order by use (SAILS first and largest, MOOR small)', async () => {
  const { PANEL, PHONE_KEYS } = await import('../src/stations/sloop/controlPanel.js');
  assert.deepEqual(PANEL.map((p) => p[1]), ['SAILS', 'BINOCULARS', 'TRIM', 'ANCHOR', 'MOOR', 'REEF']);
  assert.deepEqual(PANEL.map((p) => p[3]), ['big', 'mid', 'mid', 'mid', 'small', 'mid']);
  assert.deepEqual(PANEL.filter((p) => p[2] === 'rocker').map((p) => p[0]), ['sails', 'anchor']);
  assert.match(PANEL[0][4].up, /hoist/); assert.match(PANEL[0][4].down, /lower and furl/);
  assert.deepEqual(PHONE_KEYS, ['sails', 'anchor', 'more', 'chart']);
});

test('a finger\'s lever is relative (owner 2026-11-15): still inside the slop nothing moves; up is ahead, a notch per notchPx, held at the ends', () => {
  const N = NOTCHES.findIndex((n) => n.id === 'stop'), P = FINGER_LEVER.notchPx;
  assert.equal(fingerNotch(N, FINGER_LEVER.slopPx - 1), null, 'a tap moves nothing');
  assert.equal(fingerNotch(N, FINGER_LEVER.slopPx - 1, true), 0, 'once dragged, back near the start is N again');
  assert.equal(fingerNotch(N, -2 * P), NOTCHES.find((n) => n.id === 'half').v);
  assert.equal(fingerNotch(N, P), NOTCHES.find((n) => n.id === 'slow-astern').v);
  assert.equal(fingerNotch(N, -20 * P), NOTCHES[0].v);
  assert.equal(fingerNotch(N, 20 * P), NOTCHES[NOTCHES.length - 1].v);
});
