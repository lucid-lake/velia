// The v1-vs-v2 audit's sim and controls rows, on v2's boat with
// no browser: the trim keys reach the boat (DRV-1, DRV-2; U1–U3), Pro reaches the boat (DRV-3), the tack carry (DRV-5), the URL's
// assists (DRV-6), the pilot switch (DRV-7; U11), a new start keeps Setup's rows and frees the sheets (DRV-8), the island grounds
// as rock (ENG-2), the dawn wait reads the unwrapped hour (ENG-6). The mode switch: mode-switch.test.mjs; the browser half:
// v2/tests/pages/modeSwitch.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, islandRFor, PRO_RATE } from '../sim/boat.js';
import { keysToTrim, HELD_CODES, CODES } from '../sim/controls.js';
import { keyAction, UI_KEYS } from '../ui/keys.js';
import { createSeamanship } from '../sim/seamanship.js';
import { steadyWind, KN, PRO } from '../../src/sim/boat.js';
import { KEYMAP } from '../../src/sail/keys.js';
import { parseV2Flags } from '../engine/flags.js';

const DEG = Math.PI / 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => steadyWind(ms, fromDeg)(x, z, t) });
const flat = waterFor(() => 0);
function boat({ windKn = 12, windFrom = 0, heading = 90, speed = 3, flags = {}, heightAt = null } = {}) {
  const B = createBoatSim({ water: flat, heightAt, wind: steady(windKn * KN, windFrom), start: { x: 0, z: 0, headingDeg: heading, speed }, flags });
  return B;
}
const keys = (...c) => new Set(c);
// s seconds of the hands with these keys held (the page: main.js readHands → B.step's input)
function hold(B, s, held, o = {}) { const trim = keysToTrim(held); for (let i = 0; i < Math.round(s * 60); i++) B.step(1 / 60, { steer: o.steer ?? 0, pull: 0, trim }); }

test('keys: the trim keys are v1\'s (R/F the jib sheet in Pro, Q/E the traveller, Z/X the twist, Shift+Z/X the backstay) and are held; G is no key (the crew flies the gennaker), not wing on wing', () => {
  const bound = new Set(KEYMAP.map((k) => k.code));
  for (const c of HELD_CODES) assert.ok(bound.has(c) || /^Shift/.test(c), `${c} in v1's KEYMAP`);
  for (const c of CODES) assert.ok(HELD_CODES.includes(c));
  assert.deepEqual(keysToTrim(keys('KeyR')), { jib: 1, lead: 0, trav: 0, twist: 0, backstay: 0 }, 'v2: R/F the jib sheet, no lead key (owner 2026-11-16)');
  assert.deepEqual(keysToTrim(keys('KeyE', 'KeyZ')), { jib: 0, lead: 0, trav: 1, twist: 1, backstay: 0 });
  assert.deepEqual(keysToTrim(keys('ShiftLeft', 'KeyX', 'KeyF')), { jib: 0, lead: 0, trav: 0, twist: 0, backstay: 1 }, 'Shift: Z/X the backstay; Shift+F is full screen');
  assert.equal(UI_KEYS.wing, undefined);
});

test('DRV-1, U2: in Pro, Q and Z move the traveller and the twist at v2\'s PRO_RATE (twice v1\'s PRO.rate: −0.60, +0.60 in 0.6 s); without Pro they do nothing', () => {
  const B = boat(); hold(B, 1, keys());
  B.pro = true; B.ctl.traveller = 0; B.ctl.twist = 0; B.ctl.backstay = 0; B.ctl.jibLead = 0;
  assert.equal(PRO_RATE, 2 * PRO.rate);
  hold(B, 0.6, keys('KeyQ'));
  assert.ok(Math.abs(B.ctl.traveller + PRO_RATE * 0.6) < 0.03, `traveller ${B.ctl.traveller}`);
  hold(B, 0.6, keys('KeyZ'));
  assert.ok(Math.abs(B.ctl.twist - PRO_RATE * 0.6) < 0.03, `twist ${B.ctl.twist}`);
  hold(B, 1, keys('ShiftRight', 'KeyX'));
  assert.ok(B.ctl.backstay > 0.3, `backstay ${B.ctl.backstay}`);
  const jl = B.ctl.jibLead; hold(B, 1, keys('KeyF'));
  assert.equal(B.ctl.jibLead, jl, 'v2: F eases the jib sheet in Pro, the lead stays (the PRO panel\'s)');
  const C = boat(); hold(C, 1, keys()); C.ctl.traveller = null;
  hold(C, 1.2, keys('KeyQ'));
  assert.equal(C.ctl.traveller, null, 'basic: Q is not bound');
});

test('DRV-2, U1, U3: R pulls the jib\'s own sheet in basic and Pro (v1: 0 → −0.51 in 1.2 s), F eases it; G and WING toggle wing on wing', () => {
  const B = boat({ heading: 60 }); hold(B, 2, keys());
  const j0 = B.ctl.jibTrim ?? 0;
  hold(B, 1.2, keys('KeyR'));
  assert.ok(B.ctl.jibTrim < j0 - 0.2, `R: jibTrim ${j0} → ${B.ctl.jibTrim}`);
  const j1 = B.ctl.jibTrim;
  hold(B, 1.2, keys('KeyF'));
  assert.ok(B.ctl.jibTrim > j1 + 0.2, `F: ${j1} → ${B.ctl.jibTrim}`);
  assert.equal(B.ctl.jibSide, 0);
  const side = B.wing();
  assert.equal(Math.abs(side), 1); assert.equal(side, -Math.sign(B.state.boomAngle || 1), 'the jib out opposite the boom');
  assert.equal(B.wing(), 0, 'and back');
  B.pro = true; const lead0 = B.ctl.jibLead, jt = B.ctl.jibTrim;
  hold(B, 1, keys('KeyR'));
  assert.ok(B.ctl.jibTrim < jt - 0.2, 'v2: in Pro R is still the jib sheet (owner 2026-11-16)'); assert.equal(B.ctl.jibLead, lead0, 'the lead untouched (the PRO panel\'s)');
});

test('DRV-3: the boat knows Pro: let go head to wind, the Pro pilot holds the heading she is on, basic bears away to 40°', () => {
  for (const pro of [false, true]) {
    const B = boat({ heading: 15, windFrom: 0, speed: 2 }); B.pro = pro;
    hold(B, 0.5, keys(), { steer: -1 }); hold(B, 1 / 60, keys());
    const h = B.state.heading, held = B.holdHeading;
    if (pro) assert.ok(Math.abs(held - h) < 0.5 * DEG, 'Pro: the heading as left');
    else assert.ok(Math.abs(held - h) > 5 * DEG, `basic: bears away (${(held / DEG).toFixed(1)}° vs ${(h / DEG).toFixed(1)}°)`);
  }
});

test('DRV-5: a beginner\'s tack let go mid-turn is carried through; in Pro the pilot takes her back', () => {
  const run = (pro) => {
    const B = boat({ heading: 45, windFrom: 0, speed: 3.5, windKn: 12 }); B.pro = pro;
    hold(B, 3, keys());
    let t = 0; while (Math.abs(B.state.trueWind.angle) > 25 * DEG && t < 6) { hold(B, 1 / 60, keys(), { steer: -1 }); t += 1 / 60; }
    hold(B, 8, keys());
    return { twa: B.state.trueWind.angle / DEG, rudder: B.ctl.rudder };
  };
  const basic = run(false), pro = run(true);
  assert.ok(basic.twa > 0, `basic: carried through the eye of the wind (TWA ${basic.twa.toFixed(1)}°, from port before)`);
  assert.ok(basic.rudder < -0.5, 'the carry keeps the helm over');
  assert.ok(pro.twa < 0, `Pro: no carry, the pilot holds her on the old tack (TWA ${pro.twa.toFixed(1)}°)`);
});

test('DRV-6: ?pilot=0 starts the pilot off and ?hand=0 gives the main to the crew (the page\'s flags carry both)', () => {
  const f = parseV2Flags('?pilot=0&hand=0');
  assert.equal(f.pilot, '0'); assert.equal(f.hand, '0');
  const B = boat({ flags: f });
  assert.equal(B.assists.pilot, false); assert.equal(B.assists.crewTrim, true);
  const D = boat({ flags: parseV2Flags('') });
  assert.equal(D.assists.pilot, true); assert.equal(D.assists.crewTrim, false);
});

test('DRV-7, U11: the pilot switch turns the pilot off and on, and the course it held is read again', () => {
  const B = boat(); hold(B, 1, keys());
  assert.ok(B.holdHeading != null);
  assert.equal(B.setPilot(false), false); assert.equal(B.assists.pilot, false); assert.equal(B.holdHeading, null);
  hold(B, 0.5, keys()); assert.equal(B.holdHeading, null, 'off: no course held');
  B.setPilot(true); hold(B, 1 / 60, keys());
  assert.ok(Math.abs(B.holdHeading - B.state.heading) < 0.01, 'on: the heading she is on now, not the stale one');
});

test('DRV-8: a new start keeps the reef selector and frees a sheet left flying', () => {
  const B = boat(); hold(B, 1, keys());
  B.setReef('A'); B.setReef(2);
  const fly0 = B.fly; fly0.free.main = true;
  B.place({ x: 50, z: 60, headingDeg: 10, speed: 2 });
  assert.equal(B.reefSel, 2, 'the reef selector as the player left it'); assert.equal(B.ctl.reef, 2); assert.equal(B.ctl.autoReef, false);
  assert.notEqual(B.fly, fly0); assert.equal(!!B.free.main, false, 'a fresh let-fly');
  assert.equal(B.ctl.rudder, 0, 'the rest of the controls fresh');
});

test('ENG-2: the island grounds as rock (v1\'s islandR from the lake\'s fitted ellipse); open water and a sand shore do not', () => {
  const I = { x: -19.6, z: 17.3, a: 79.1, b: 39.8, rotDeg: -34.9 };
  const r = islandRFor(I);
  assert.ok(Math.abs(r(I.x, I.z)) < 1e-9);
  const c = Math.cos(I.rotDeg * DEG), s = Math.sin(I.rotDeg * DEG);
  assert.ok(Math.abs(r(I.x + I.a * c, I.z + I.a * s) - 1) < 1e-9, 'r = 1 at the end of the long axis');
  const B = boat({ heightAt: () => -2 });
  assert.equal(B.groundTerrain.rockAt(I.x, I.z), false, 'until the island is known');
  B.setIsland(I);
  assert.equal(B.groundTerrain.rockAt(I.x, I.z), true);
  assert.equal(B.groundTerrain.rockAt(I.x + 400, I.z), false);
});

test('ENG-6: wait for dawn after midnight reads the unwrapped hour, so the clock moves on to the next morning, never back a day', () => {
  const B = boat({ windKn: 3, speed: 0, heightAt: () => -8 });
  const clock = { hourAt: () => 1.01, hourUnwrappedAt: () => 25.01, setHour: () => {} };
  const sea = createSeamanship({ B, depthAt: () => 8, clock, sun: () => -20, timeScale: 1 });
  B.sea = sea;
  B.phys.furlPos = 1; sea.actions.sails();
  sea.actions.anchor();
  for (let i = 0; i < 90 * 60 && sea.tackle.state.anchor.phase !== 'held'; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.equal(sea.tackle.state.anchor.phase, 'held');
  const h = sea.actions.sunrise();
  assert.ok(h > 24 && h < 31, `the dawn after 01:00 is the next morning's, unwrapped (${h})`);
});
