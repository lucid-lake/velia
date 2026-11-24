// The helm station's pure parts: the input maths (src/stations/sloop/helmInput.js), the layout (helmStation.js
// helmLayout), the hand's nudge (sheets.js), the jib's own trim (boat.js), the keys (keys.js) and the dial's always-on mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, BOAT, DT, steadyWind, jibHandRange } from '../src/sim/boat.js';
import { HELM_IN, wrap, turnCW, wheelPx, scrollSheet, dragSheet, crankSheet, WinchGesture, WheelGesture, StepHold, sailState, drumAngle, wheelAngle, wheelScroll } from '../src/stations/sloop/helmInput.js';
import { HandSheets, HAND } from '../src/sim/sail/sheets.js';
import { KEYMAP } from '../src/sail/keys.js';

const DEG = Math.PI / 180;
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);
const C = { x: 100, y: 100 };

test('a turn on screen (y down): 12 → 3 o\'clock is clockwise (+), 3 → 12 is counter-clockwise (−)', () => {
  near(turnCW(C, { x: 100, y: 50 }, { x: 150, y: 100 }), Math.PI / 2);
  near(turnCW(C, { x: 150, y: 100 }, { x: 100, y: 50 }), -Math.PI / 2);
  near(wrap(3 * Math.PI / 2), -Math.PI / 2);
});

test('the crank: clockwise pulls in, counter-clockwise eases; one turn = crankTurnSheet', () => {
  near(crankSheet(2 * Math.PI), HELM_IN.crankTurnSheet);
  const g = new WinchGesture();
  // press on the grip (given), then go a quarter turn clockwise round the centre
  g.press({ x: 100, y: 60 }, { centre: C, radius: 40, grip: { x: 100, y: 60 } });
  assert.equal(g.mode, 'crank');
  let d = 0;
  for (let i = 1; i <= 9; i++) { const a = -Math.PI / 2 + (i / 9) * Math.PI / 2; d += g.move({ x: 100 + 40 * Math.cos(a), y: 100 + 40 * Math.sin(a) }); }
  near(d, HELM_IN.crankTurnSheet / 4, 1e-9);
  assert.ok(d > 0, 'clockwise = in');
  const h = new WinchGesture(); h.press({ x: 100, y: 60 }, { centre: C, radius: 40, grip: { x: 100, y: 60 } });
  let e = 0; for (let i = 1; i <= 9; i++) { const a = -Math.PI / 2 - (i / 9) * Math.PI / 2; e += h.move({ x: 100 + 40 * Math.cos(a), y: 100 + 40 * Math.sin(a) }); }
  assert.ok(e < 0, 'counter-clockwise = ease');
});

test('the straight drag: down pulls in, up eases, in proportion; away from the grip it is a drag', () => {
  near(dragSheet(0, HELM_IN.dragPxPerDeg * 10), 10 * DEG);
  near(dragSheet(40, 0), -40 / HELM_IN.dragPxPerDeg * DEG);
  const g = new WinchGesture();
  assert.equal(g.press({ x: 90, y: 100 }, { centre: C, radius: 40, grip: { x: 100, y: 60 } }), 'drag');
  let d = 0; for (let i = 1; i <= 5; i++) d += g.move({ x: 90, y: 100 + 8 * i });
  near(d, dragSheet(100, 140), 1e-12);
  assert.ok(d > 0);
});

test('a drag that goes round far enough becomes a crank', () => {
  const g = new WinchGesture(); g.press({ x: 140, y: 100 }, { centre: C, radius: 40, grip: { x: 100, y: 60 } });
  assert.equal(g.mode, 'drag');
  for (let i = 1; i <= 24; i++) { const a = (i / 24) * 200 * DEG; g.move({ x: 100 + 40 * Math.cos(a), y: 100 + 40 * Math.sin(a) }); }
  assert.equal(g.mode, 'crank');
});

test('the scroll: pixel and line deltas normalised, down = in, up = ease, capped per event', () => {
  near(wheelPx({ deltaY: 3, deltaMode: 1 }), 3 * HELM_IN.lineToPx);
  near(wheelPx({ deltaY: 1, deltaMode: 2 }), HELM_IN.pageToPx);
  near(wheelPx({ deltaY: 7.5, deltaMode: 0 }), 7.5);
  // a mouse notch (Chrome: 100 px) and a Firefox notch (3 lines = 48 px) both pull in by a small step
  assert.ok(scrollSheet({ deltaY: 100 }) > 0 && scrollSheet({ deltaY: 100 }) <= HELM_IN.scrollMaxDeg * DEG);
  assert.ok(scrollSheet({ deltaY: 3, deltaMode: 1 }) > 0);
  assert.ok(scrollSheet({ deltaY: -100 }) < 0, 'scrolling up eases');
  // a trackpad's small pixel deltas add up in proportion
  near(scrollSheet({ deltaY: 4 }) * 10, scrollSheet({ deltaY: 40 }), 1e-12);
  // an inertia burst is capped
  near(scrollSheet({ deltaY: 5000 }), HELM_IN.scrollMaxDeg * DEG);
  // natural scrolling (macOS) inverts the fingers, not the event: the page's deltaY sign is what we read, so a page and a winch agree
  assert.ok(scrollSheet({ deltaY: 30 }) > 0 && scrollSheet({ deltaY: -30 }) < 0);
});

test('the step buttons: a click is one step at once; held past holdMs it is a held key until released', () => {
  const s = new StepHold();
  near(s.down(1, 1000), HELM_IN.step);
  assert.equal(s.tick(1000 + HELM_IN.holdMs - 1), 0);
  assert.equal(s.tick(1000 + HELM_IN.holdMs + 1), 1);
  s.up(); assert.equal(s.tick(5000), 0);
  near(s.down(-1, 0), -HELM_IN.step);
  assert.equal(s.tick(HELM_IN.holdMs), -1);
});

test('the wheel: a drag clockwise steers to starboard, relative to the grab, clamped at the stops', () => {
  const g = new WheelGesture().press({ x: 150, y: 100 }, { centre: C, wheel: 0 });
  // 3 → 6 o'clock: a quarter turn clockwise = 90° of wheel = 22.5° of rudder
  let cmd = 0; for (let i = 1; i <= 9; i++) { const a = (i / 9) * Math.PI / 2; cmd = g.move({ x: 100 + 50 * Math.cos(a), y: 100 + 50 * Math.sin(a) }); }
  near(cmd, (90 / 4) / 25, 1e-9);
  // grabbing at another spoke does not jump: the start angle is the wheel's own
  const h = new WheelGesture().press({ x: 100, y: 40 }, { centre: C, wheel: 40 * DEG });
  near(h.command, 40 * DEG / (100 * DEG));
  for (let i = 1; i <= 40; i++) { const a = -Math.PI / 2 + (i / 40) * Math.PI * 1.5; h.move({ x: 100 + 60 * Math.cos(a), y: 100 + 60 * Math.sin(a) }); }
  near(h.command, 1, 1e-12);
  near(wheelAngle(10 * DEG), 40 * DEG);
  assert.ok(wheelScroll({ deltaY: 50 }) > 0 && wheelScroll({ deltaX: -50, deltaY: 1 }) < 0);
});

test('the drum draws the sheet: in turns it clockwise; the marker reads the sail', () => {
  assert.ok(drumAngle(20 * DEG) > drumAngle(30 * DEG));
  near(drumAngle(30 * DEG) - drumAngle(31 * DEG), HELM_IN.drumPerSheet * DEG, 1e-12);
  assert.equal(sailState({ fill: 0.9, stall: 0.1, awa: 40 * DEG, twa: 60 * DEG }), 'draw');
  assert.equal(sailState({ fill: 0.3, stall: 0, awa: 40 * DEG, twa: 60 * DEG }), 'luff');
  assert.equal(sailState({ fill: 0.9, stall: 0.8, awa: 40 * DEG, twa: 60 * DEG }), 'stall');
  assert.equal(sailState({ fill: 0.9, stall: 0.8, awa: 120 * DEG, twa: 150 * DEG }), 'draw', 'a run is a flat plate by nature');
  assert.equal(sailState({ fill: 0.9, furl: 1 }), 'off');
  assert.equal(sailState({ fill: 0.1, twa: 20 * DEG }), 'off', 'head to wind: no sheet helps');
});

test('a hand on the sheet (the winch) is a sheet key: it moves the sheet, the crew lets go', () => {
  const h = new HandSheets({ sheet: 40 * DEG }); h.crew = true; h.idle = 30;
  h.nudge(5 * DEG); near(h.sheet, 35 * DEG);
  assert.equal(h.crew, false); assert.equal(h.idle, 0); assert.equal(h.touched, true);
  h.nudge(-500 * DEG); near(h.sheet, HAND.max);
  h.nudge(500 * DEG); near(h.sheet, HAND.min);
});

test('the jib has its own trim and its keys: R in, F out in basic mode, no clash with pro or raw', () => {
  // the physics (boat.js): no hand on it (jibTrim 0) the jib sits on the crew's match; the winch moves it off the match, as
  // far as the hand's range (past the crew's own stops) and no further; with the player's sheet (Day Sail) and with the crew's
  assert.equal(CONTROLS.jibTrim, 0, 'by default no hand on the jib');
  const [lo, hi] = jibHandRange(BOAT), env = { windAt: steadyWind(6, 0), t: 0 };
  for (const sheet of [35 * DEG, null]) {
    const at = (jibTrim) => { const b = new BoatPhysics({ heading: 90 * DEG, speed: 2 }); let st; for (let i = 0; i < 30; i++) st = b.step(DT, { ...CONTROLS, sheet, jibTrim }, env); return st; };
    const tag = sheet == null ? 'the crew\'s sheet' : 'the player\'s sheet';
    const off = at(0); near(off.jibSheet, off.jibMatch, 1e-12);
    const eased = at(5 * DEG); near(eased.jibSheet, eased.jibMatch + 5 * DEG, 1e-9);
    assert.ok(eased.jibSheet > off.jibSheet + 3 * DEG, `${tag}: + eases the jib`);
    near(at(3).jibSheet, hi, 1e-12); near(at(-3).jibSheet, lo, 1e-12);
    assert.ok(hi > BOAT.jib.maxDeg * DEG && lo < BOAT.jib.lead, `${tag}: the hand's range passes the crew's stops`);
  }
  const r = KEYMAP.filter((k) => k.code === 'KeyR' && (k.modes ?? []).includes('basic'));
  assert.equal(r.length, 1); assert.match(r[0].action, /jib sheet in/);
});

test('the boat\'s own wheel turns clockwise as the helmsman sees it when the rudder goes to starboard (Boat.js)', async () => {
  const THREE = await import('three/webgpu');
  const { Boat } = await import('../classic/src/boat/Boat.js');
  const b = new Boat();
  const st = { x: 0, z: 0, heave: 0, heading: 0, pitch: 0, heel: 0, rudderAngle: 10 * DEG, boomAngle: 0, jibAngle: 0, throttle: 0, engineRpm: 0, engineGear: 0 };
  b.update(st, 0);
  // the helmsman stands aft (+z) facing forward (−z): his right is +x (starboard). The wheel's top must go to his right.
  const top = new THREE.Vector3(0, 1, 0).applyEuler(b.sockets.wheel.rotation);
  assert.ok(top.x > 0.5, `top of the wheel at x ${top.x.toFixed(3)} (starboard is +x)`);
  near(-b.sockets.wheel.rotation.z, 4 * 10 * DEG, 1e-9);
  // and the station's drawn wheel uses the same sense: clockwise on screen = starboard
  near(wheelAngle(10 * DEG), 40 * DEG);
});
