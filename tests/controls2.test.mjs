// Day Sail's controls: the hand on the sheets, the crew's net, the wind levels and the physics' sheet
// control. Plain-JS checks; the live feel is tools/probe_controls2.mjs. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandSheets, HAND, trimBoost, WIND_LEVELS, DEFAULT_WIND_LEVEL } from '../src/sim/sail/sheets.js';
import { BoatPhysics, CONTROLS, Helm, steadyWind, KN } from '../src/sim/boat.js';
import { travellerCarX } from '../classic/src/boat/lines.js';

const DEG = Math.PI / 180;
// sail a fixed true wind angle for `s` seconds with a sheet rule; returns the state
function sail({ twaDeg, kn, seconds = 25, sheet = () => null, start = null }) {
  const h = -twaDeg * DEG, boat = start ?? new BoatPhysics({ heading: h, speed: 2.7 }), helm = new Helm();
  const env = { windAt: steadyWind(kn * KN, 0), t: boat.t };
  for (let i = 0; i < seconds * 60; i++) { env.t = boat.t; boat.step(1 / 60, { ...CONTROLS, rudder: helm.toHeading(boat.state, h), sheet: sheet(boat.state) }, env); }
  return boat;
}

test('the crew’s sheet draws; 16° eased luffs and slows; the sheet stays where it is left', () => {
  const crew = sail({ twaDeg: 60, kn: 12 }).state;
  assert.ok(crew.mainFill > 0.95 && crew.crewSheet > 12 * DEG, `crew fill ${crew.mainFill}, sheet ${crew.crewSheet / DEG}°`);
  const eased = sail({ twaDeg: 60, kn: 12, sheet: (s) => s.crewSheet + 16 * DEG }).state;
  assert.ok(eased.mainFill < 0.7, `eased fill ${eased.mainFill}`);
  assert.ok(eased.u < crew.u * 0.93, `eased ${eased.u / KN} kn vs ${crew.u / KN} kn`);
  assert.ok(Math.abs(eased.heel) < Math.abs(crew.heel) * 0.8, 'less heel when luffing');
  assert.equal(+(eased.mainSheet / DEG).toFixed(1), +((eased.crewSheet + 16 * DEG) / DEG).toFixed(1), 'the sheet is the player’s');
});

test('over-trimmed on a reach: the main past the stall, slower; stall is 0 at the crew’s trim', () => {
  const crew = sail({ twaDeg: 90, kn: 12 }).state;
  assert.ok(crew.mainStall < 0.1, `stall at trim ${crew.mainStall}`);
  const tight = sail({ twaDeg: 90, kn: 12, sheet: (s) => s.crewSheet - 20 * DEG }).state;
  assert.ok(tight.mainStall > 0.8, `stalled ${tight.mainStall}`);
  assert.ok(tight.u < crew.u * 0.97, `tight ${tight.u / KN} kn vs ${crew.u / KN} kn`);
});

test('the jib follows the main: eased main, eased jib', () => {
  const a = sail({ twaDeg: 60, kn: 12, sheet: (s) => s.crewSheet }).state;
  const b = sail({ twaDeg: 60, kn: 12, sheet: (s) => s.crewSheet + 8 * DEG }).state;
  assert.ok(b.jibSheet > a.jibSheet + 5 * DEG, `jib ${a.jibSheet / DEG}° → ${b.jibSheet / DEG}°`);
});

test('HandSheets: starts eased off the crew, W pulls in at the rate, S eases, the crew’s net after 12 s of luffing', () => {
  const h = new HandSheets();
  assert.equal(h.update(1 / 60, 0, { mainSheet: 0 }), null, 'before the first tick: the crew');
  const s = { mainSheet: 25 * DEG, crewSheet: 25 * DEG, mainFill: 1, mainStall: 0, apparentWind: { angle: 0.7 }, trueWind: { angle: 1.0 } };
  const s0 = h.update(1 / 60, 0, s);
  assert.equal(+(s0 / DEG).toFixed(2), +((25 * DEG + HAND.startEase) / DEG).toFixed(2));
  // on a close reach the crew sails the main at a high angle of attack: eased until it lifts (AoA 0.5°), not just 15°
  const close = new HandSheets().update(1 / 60, 0, { ...s, crewSheet: 18 * DEG, apparentWind: { angle: -36 * DEG } });
  assert.equal(+(close / DEG).toFixed(2), 35.5);
  // held, the rate rises from 12°/s to boost × over HAND.rampS (owner, 2026-10-30: trim responds faster; a tap stays fine)
  const ramp = (n, dir, rate) => { let d = 0; for (let i = 1; i <= n; i++) d += rate * trimBoost((i - 1) / 60, dir) / 60; return d; };
  for (let i = 0; i < 60; i++) h.update(1 / 60, 1, s);                       // 1 s of W
  assert.equal(+(h.sheet / DEG).toFixed(1), +((s0 - ramp(60, 1, HAND.rate)) / DEG).toFixed(1), '12°/s in, rising to 2.4 ×');
  assert.ok(ramp(6, 1, HAND.rate) < HAND.rate * 0.11, 'a 0.1 s tap is still the base rate');
  const mid = h.sheet;
  for (let i = 0; i < 30; i++) h.update(1 / 60, -1, s);                      // 0.5 s of S
  assert.equal(+(h.sheet / DEG).toFixed(1), +((mid + ramp(30, -1, HAND.easeRate)) / DEG).toFixed(1), '25°/s out, rising');
  assert.ok(h.touched && !h.crew);
  // hands off, the sails luffing: nothing for 12 s, then the crew trims to its own sheet
  const luff = { ...s, mainFill: 0.2, crewSheet: 20 * DEG };
  const before = h.sheet;
  for (let i = 0; i < 11 * 60; i++) h.update(1 / 60, 0, luff);
  assert.equal(h.sheet, before, 'nothing for 11 s'); assert.ok(!h.crew);
  for (let i = 0; i < 2 * 60; i++) h.update(1 / 60, 0, luff);
  assert.ok(h.crew, 'the crew takes the sheet after 12 s');
  for (let i = 0; i < 10 * 60; i++) h.update(1 / 60, 0, luff);
  assert.ok(Math.abs(h.sheet - 20 * DEG) < 1 * DEG && !h.crew, `trimmed to the crew’s ${h.sheet / DEG}°`);
  // a sail that draws is never touched, nor is one head to wind
  const draw = { ...s, mainFill: 1 }; const b2 = h.sheet;
  for (let i = 0; i < 30 * 60; i++) h.update(1 / 60, 0, draw);
  assert.equal(h.sheet, b2);
  const irons = { ...luff, trueWind: { angle: 0.3 } };
  for (let i = 0; i < 30 * 60; i++) h.update(1 / 60, 0, irons);
  assert.equal(h.sheet, b2);
  // a key press cancels the net at once
  const luff2 = { ...luff, crewSheet: 40 * DEG };                            // 20° away: still trimming at 13 s
  for (let i = 0; i < 13 * 60; i++) h.update(1 / 60, 0, luff2); assert.ok(h.crew);
  h.update(1 / 60, 1, luff2); assert.ok(!h.crew);
});

test('the wind levels: re-exported from the WindField (tests/wind.test.mjs has the field’s own checks)', () => {
  assert.equal(DEFAULT_WIND_LEVEL, 3);
  assert.deepEqual(WIND_LEVELS.map((l) => l.kn), [[4, 7], [8, 12], [13, 17], [18, 24]]);
});

test('the traveller car follows the boom inside its 1.16 m of travel', () => {
  assert.equal(travellerCarX(0), 0);
  assert.ok(travellerCarX(20 * DEG) > 0.1 && travellerCarX(20 * DEG) <= 0.58);
  assert.equal(travellerCarX(80 * DEG), 0.58); assert.equal(travellerCarX(-80 * DEG), -0.58);
});

test('the sheet tail: longer off the winch as the sheet comes in; it lifts taut while W hauls; it stays off the deck', async () => {
  const { sheetTail, lineSet } = await import('../classic/src/boat/lines.js');
  const len = (pts) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]), 0);
  const inn = sheetTail({ mainSheet: 14 * DEG }, -1), out = sheetTail({ mainSheet: 75 * DEG }, -1);
  assert.ok(len(inn) > len(out) + 0.5, `hauled in ${len(inn).toFixed(2)} m vs eased ${len(out).toFixed(2)} m`);
  const haul = sheetTail({ mainSheet: 30 * DEG }, -1, 1), rest = sheetTail({ mainSheet: 30 * DEG }, -1, 0);
  assert.ok(haul.at(-1)[1] > rest.at(-1)[1] + 0.2, 'the tail lifts toward the hand while hauling');
  assert.ok(lineSet({ mainSheet: 30 * DEG, boomAngle: -0.4, jibAngle: -0.3, mainFill: 1, jibFill: 1 }).some((l) => l.name === 'jibsheet-tail'));
});

test('gamepad and touch mappings: the stick’s dead zone and curve, RT pulls and LT eases, the rope hauls at the winch’s rate', async () => {
  const { stickCurve, triggerPull, TouchSheet, PAD } = await import('../src/sail/pads.js');
  assert.equal(stickCurve(0.1), 0); assert.equal(stickCurve(-PAD.dead), 0);
  assert.equal(stickCurve(1), 1); assert.equal(stickCurve(-1), -1);
  assert.ok(stickCurve(0.5) > 0 && stickCurve(0.5) < 0.3, `half the stick: ${stickCurve(0.5).toFixed(2)} of the helm (fine near the middle)`);
  for (let x = -1; x < 1; x += 0.05) assert.ok(stickCurve(x + 0.05) >= stickCurve(x), 'monotonic');
  assert.equal(triggerPull(1, 0), 1); assert.equal(triggerPull(0, 1), -1); assert.equal(triggerPull(0.04, 0), 0);
  assert.equal(triggerPull(1, 1), 0, 'both triggers cancel');
  const r = new TouchSheet(200); r.drag(100);                                  // a quick 100-unit drag down
  let hauled = 0, frames = 0; for (let i = 0; i < 120; i++) { const p = r.update(1 / 60); if (p) frames++; hauled += p / 60; assert.ok(p <= 1); }
  assert.ok(Math.abs(hauled * 200 - 100) < 1, `the whole drag is hauled (${(hauled * 200).toFixed(1)})`);
  assert.ok(frames >= 29, `at the winch’s rate: over ${frames} frames, not at once`);
  r.drag(-30); assert.ok(r.update(1 / 60) < 0, 'a drag up eases');
});
