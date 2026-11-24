// K1 knockdown (?knockdown=1): the large-angle curve, the heel below 35° unchanged, the watch's events, and
// a set-up gust (14 kn, then 43 kn on the beam over 3 s for 11 s, reef 0, the sheet held where it is) that easing and reef A
// survive by at least 5° under 55°; a luff alone does not (on a reach she is already rounding up: the rudder has lost its
// grip); the new sailor's crew, a little late in storm gusts, can still be knocked down; the flag off changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, START, KN } from '../sim/boat.js';
import { rightingArm, KNOCKDOWN, BOAT } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { sailWindOptions } from '../sim/wind.js';
import { KD } from '../sim/knockdown.js';

const DEG = Math.PI / 180;
const basic = (d) => BOAT.gm * Math.sin(d * DEG) * Math.max(0, 1 - d * DEG / BOAT.vanish);

test('the curve: the basic arm to 35°, its most at 60–70°, still righting at 90°', () => {
  for (let d = 0; d <= KNOCKDOWN.keepDeg; d += 2.5) assert.equal(rightingArm(d * DEG, BOAT, true), rightingArm(d * DEG, BOAT, false));
  for (const d of [-20, 10, 35]) assert.equal(rightingArm(d * DEG, BOAT, true), basic(Math.abs(d)) * Math.sign(d));
  assert.ok(Math.abs(rightingArm(35.01 * DEG, BOAT, true) - basic(35)) < 1e-3, 'continuous at 35°');
  let best = 0, at = 0;
  for (let d = 35; d <= 90; d += 0.5) { const g = rightingArm(d * DEG, BOAT, true); if (g > best) { best = g; at = d; } }
  assert.ok(at >= 60 && at <= 70, `max at ${at}°`);
  assert.ok(rightingArm(90 * DEG, BOAT, true) > 0.2 * BOAT.gm, 'positive at 90°');
  assert.ok(rightingArm(-60 * DEG, BOAT, true) < 0, 'signed as the heel');
});

function windRun(on, secs = 120) {
  const w = new WindField({ seed: 1, ...sailWindOptions({ wind: 3 }, { hour: 15.5, rate: 0, start: START }) });
  w.setTerrain(() => -40);
  const v = w.sample(START.x, START.z, 0);
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: w, start: { x: START.x, z: START.z, headingDeg: Math.atan2(-v.vx, v.vz) / DEG - 50, speed: 2.5 }, flags: on ? { knockdown: true } : {} });
  const heel = [];
  for (let i = 0; i < secs * 60; i++) { B.step(1 / 60, { steer: 0, pull: 0 }); heel.push(B.state.heel); }
  return { B, heel };
}

test('below 35°: the default wind close-hauled heels exactly as today with the flag on', () => {
  const off = windRun(false), on = windRun(true);
  const max = Math.max(...off.heel.map(Math.abs)) / DEG;
  assert.ok(max > 15 && max < 35, `max heel ${max.toFixed(1)}°`);
  assert.deepEqual(on.heel, off.heel);
  assert.equal(on.B.knockdown.count, 0); assert.equal(on.B.knockdown.warnings, 0);
});

// the set-up gust: 14 kn, a 43 kn gust from t = 20 s (a 3 s rise, 2 s fall, 14 s in all), TWA 80, reef 0; act(inp, B) after the warning
function gustRun({ gust = 43, crew = false, reef = 0, act = null, on = true, secs = 45 } = {}) {
  let t = 0;
  const sp = () => { const k = Math.min(1, Math.max(0, (t - 20) / 3)) * Math.min(1, Math.max(0, (34 - t) / 2)); return (14 + (gust - 14) * k) * KN; };
  const wind = { sample: () => ({ vx: 0, vz: sp() }) };
  const B = createBoatSim({ water: waterFor(() => 0), wind, start: { x: START.x, z: START.z, headingDeg: -80, speed: 3 }, flags: on ? { knockdown: true } : {} });
  B.setReef(reef, { silent: true }); B.assists.crewTrim = crew;
  const heard = [];
  B.onKnockdown = (e) => heard.push(e); B.onKnockdownWarn = (e) => heard.push(e);
  let mx = 0;
  for (let i = 0; i < secs * 60; i++) {
    const inp = { steer: 0, pull: 0 };
    if (act && B.knockdown.warnings > 0) act(inp, B);
    B.step(1 / 60, inp); t += 1 / 60; mx = Math.max(mx, Math.abs(B.state.heel) / DEG);
  }
  return { B, mx, heard, K: B.knockdown };
}

test('the set-up gust knocks the experienced sailor down, warned about 2 s before', () => {
  const r = gustRun();
  assert.ok(r.K.count >= 1, `max heel ${r.mx.toFixed(1)}°`);
  const kd = r.K.events.find((e) => e.type === 'knockdown');
  assert.ok(kd.heelDeg > KD.kdDeg && kd.leadS >= 1.9, `lead ${kd.leadS}`);
  assert.equal(r.heard[0].type, 'knockdownWarn'); assert.ok(r.heard.some((e) => e.type === 'knockdown'));
  assert.ok(r.K.events[0].t < kd.t && r.K.t === kd.t);
});

test('easing and reef A survive the same gust with 5° to spare; a late luff does not on a reach', () => {
  const ease = gustRun({ act: (i) => { i.pull = -1; } });
  assert.ok(ease.K.count === 0 && ease.mx <= 50, `ease: ${ease.mx.toFixed(1)}°`);
  const reefA = gustRun({ reef: 'A' });
  assert.ok(reefA.K.count === 0 && reefA.mx <= 50, `reef A: ${reefA.mx.toFixed(1)}°`);
  // a luff left until she is past 45° does not save her: the rudder has lost its grip (owner 2026-11-17: "ease, don't luff")
  const luff = gustRun({ act: (i, B) => { if (Math.abs(B.state.heel) > 45 * Math.PI / 180) i.steer = 1; } });   // the wind from the north, heading 280°: steer to starboard heads up
  assert.ok(luff.mx > 50, `a late luff: ${luff.mx.toFixed(1)}° (easing kept her at or under 50°)`);
});

test('the new sailor (crew trim, late in storm gusts) can still be knocked down; a strong-wind gust does not', () => {
  const strong = gustRun({ gust: 28, crew: true });
  assert.equal(strong.K.count, 0, `28 kn: ${strong.mx.toFixed(1)}°`);
  const r = gustRun({ crew: true });
  assert.ok(r.K.count >= 1, `43 kn: ${r.mx.toFixed(1)}°`);
});

test('the flag off: no watch, no events, the same boat as before', () => {
  const r = gustRun({ on: false });
  assert.equal(r.K.on, false); assert.equal(r.K.count, 0); assert.equal(r.heard.length, 0);
  assert.ok(!('rigWet' in r.B.state));
  assert.ok(r.mx < 55, `today's model holds her under 55° (${r.mx.toFixed(1)}°)`);
});

test('Cruise never: a boat its autopilot sails is not watched, in the same gust', () => {
  let t = 0;
  const sp = () => { const k = Math.min(1, Math.max(0, (t - 20) / 3)) * Math.min(1, Math.max(0, (34 - t) / 2)); return (14 + 29 * k) * KN; };
  const B = createBoatSim({ water: waterFor(() => 0), wind: { sample: () => ({ vx: 0, vz: sp() }) }, start: { x: START.x, z: START.z, headingDeg: -80, speed: 3 }, flags: { knockdown: true } });
  B.setReef(0, { silent: true });
  const heard = []; B.onKnockdown = (e) => heard.push(e); B.onKnockdownWarn = (e) => heard.push(e);
  const sheet = B.ctl.sheet;
  B.drive(() => { B.ctl.rudder = 0; B.ctl.sheet = sheet; });   // Cruise's autopilot: the helm amidships, the sheet held
  for (let i = 0; i < 45 * 60; i++) { B.step(1 / 60); t += 1 / 60; }
  assert.equal(heard.length, 0); assert.equal(B.knockdown.count, 0);
});

test('the event names the gust and the trim; a fresh start (place) clears the excursion and the look', () => {
  const r = gustRun();
  const kd = r.K.events.find((e) => e.type === 'knockdown');
  assert.ok(kd.gustKn >= 40 && kd.gustKn <= 43.5, `gust ${kd.gustKn}`);
  assert.ok(Number.isFinite(kd.boomDeg) && kd.reef === 0);
  let placed = 0; r.B.onPlaced = () => placed++;
  for (let i = 0; i < 60; i++) r.B.camera(1 / 60);
  r.B.place({ x: START.x, z: START.z, headingDeg: 0 });
  assert.equal(placed, 1); assert.equal(r.B.knockdown.active, false); assert.equal(r.B.kdFx.state.cam, 0);
});

test('the scripted gust (the page test and the clip): the boat\'s own wind rises to the peak and back, never under its own', () => {
  const B = createBoatSim({ water: waterFor(() => 0), wind: { sample: () => ({ vx: 0, vz: 6 }) }, start: { x: START.x, z: START.z, headingDeg: -80, speed: 3 }, flags: { knockdown: true } });
  B.setGust({ peakKn: 40, riseS: 2, holdS: 3, fallS: 1, inS: 1 });
  const tws = [];
  for (let i = 0; i < 8 * 60; i++) { B.step(1 / 60); tws.push(B.state.trueWind.speed / KN); }
  assert.ok(Math.abs(tws[30] - 6 / KN) < 0.05, 'before the gust');
  assert.ok(Math.abs(tws[4.5 * 60] - 40) < 0.05, `at the peak ${tws[270]}`);
  assert.ok(Math.abs(tws.at(-1) - 6 / KN) < 0.05, 'after it');
});
