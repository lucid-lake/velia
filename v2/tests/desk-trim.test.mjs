// The desktop's faster trim (owner, 2026-11-16: "W/S sheet trim is too slow visually"; the Pro trims' change hard to see):
// a desk page's held sheet (W/S, the cockpit's held winch) pulls in at about twice v1's winch and eases at 35°/s, still
// slower under load; a phone (no DESK_TRIM: its rings nudge the sheet directly) keeps v1's rates exactly. The Pro keys move
// the traveller, the vang (twist), the backstay and the jib lead at twice v1's rate; the Pro panels' steps are twice v1's;
// the traveller car and the jib car slide with their controls (v1's lines.js).
// Times here are the hands' seconds (the page runs the hands on the real clock; Sail's sim runs at 2 ×).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, KN, DESK_TRIM, PRO_RATE } from '../sim/boat.js';
import { steadyWind, PRO } from '../../src/sim/boat.js';
import { winchRate, WINCH } from '../../src/sim/sail/feel.js';
import { HAND } from '../../src/sim/sail/sheets.js';
import { stepF } from '../../src/stations/sloop/proRecess.js';
import { stepValue, TRIM, STEP } from '../../src/stations/sloop/trimPanel.js';
import { travellerCarX, lineSet } from '../render/boat/mesh.js';
import { stubState } from '../../src/boat/rig.js';

const DEG = Math.PI / 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });

// a full trim at 15 kn: the sheet eased to 70°, then W held until 15°; returns the seconds (and the ease back out)
function fullTrim(trim) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200), trim });
  B.settle(20);
  let n = 0;
  while ((B.ctl.sheet ?? 0) < 70 * DEG && n++ < 1200) B.step(1 / 60, { steer: 0, pull: -1 });
  for (let i = 0; i < 60; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  let t0 = B.t; n = 0;
  while (B.ctl.sheet > 15 * DEG && n++ < 1800) B.step(1 / 60, { steer: 0, pull: 1 });
  const pullS = B.t - t0;
  t0 = B.t; n = 0;
  while (B.ctl.sheet < 70 * DEG && n++ < 1800) B.step(1 / 60, { steer: 0, pull: -1 });
  return { pullS, easeS: B.t - t0, B };
}

test('the desk winch: about twice v1\'s in light air (25°/s), slower under load, never under 12°/s; the ease 35°/s', () => {
  const W = DESK_TRIM.winch, d = (F) => winchRate(F, W) / DEG;
  assert.ok(Math.abs(d(0) - 25) < 0.01 && Math.abs(d(0) / (winchRate(0) / DEG) - 25 / 12) < 0.01, `light air ${d(0).toFixed(1)}°/s`);
  let prev = Infinity;
  for (let F = 0; F <= 4000; F += 100) { assert.ok(d(F) <= prev + 1e-9, `never rising with the load (${F} N)`); prev = d(F); assert.ok(d(F) >= 12 - 1e-9, `never under 12°/s (${F} N: ${d(F)})`); }
  assert.ok(d(2000) < 15 && d(2000) > 12, `slower at 2 kN: ${d(2000).toFixed(1)}°/s`);
  assert.ok(Math.abs(DESK_TRIM.easeRate / DEG - 35) < 1e-9, 'the ease 35°/s');
  assert.deepEqual({ fast: WINCH.fastDeg, min: WINCH.minDeg, ease: HAND.easeRate / DEG }, { fast: 12, min: 3.5, ease: 25 }, 'v1\'s rates unchanged');
});

test('a full trim 70° → 15° at 15 kn: the desk about twice as fast as a phone; the ease quicker', () => {
  const phone = fullTrim(null), desk = fullTrim(DESK_TRIM);
  const ratio = desk.pullS / phone.pullS;
  assert.ok(phone.pullS > 1.9 && phone.pullS < 2.7, `a phone (v1's rates, the held boost) ${phone.pullS.toFixed(2)} s`);
  assert.ok(desk.pullS > 0.8 && desk.pullS < 1.6, `the desk ${desk.pullS.toFixed(2)} s`);
  assert.ok(ratio > 0.4 && ratio < 0.62, `about half the time (${ratio.toFixed(2)})`);
  assert.ok(desk.easeS < phone.easeS - 0.15, `the ease 15° → 70°: ${phone.easeS.toFixed(2)} → ${desk.easeS.toFixed(2)} s`);
});

test('a phone\'s ring is untouched: its nudge moves the sheet by exactly its own amount, desk rates or not', () => {
  for (const trim of [null, DESK_TRIM]) {
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200), trim });
    B.settle(10);
    for (let i = 0; i < 30; i++) B.step(1 / 60, { steer: 0, pull: -1 });   // eased off the stop
    for (let i = 0; i < 30; i++) B.step(1 / 60, { steer: 0, pull: 0 });
    const s0 = B.ctl.sheet;
    B.station({ main: 0.1, mainHold: 0, jibHold: 0 }); B.step(1 / 60, { steer: 0, pull: 0 });
    assert.ok(Math.abs((s0 - B.ctl.sheet) - 0.1) < 1e-9, `the ring's 0.1 rad in (${trim ? 'desk' : 'phone'}): ${(s0 - B.ctl.sheet).toFixed(4)}`);
  }
  // no trim given: the pull rate is v1's winch at the load
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200) });
  assert.equal(B.trimRates, null);
  assert.ok(Math.abs(B.pullRate - winchRate(0)) < 1e-12);
});

test('the Pro keys: the traveller, the vang, the backstay and the jib lead at twice v1\'s rate (a full sweep in 2 s, was 4 s)', () => {
  assert.equal(PRO_RATE, 2 * PRO.rate);
  const sweep = (key, axis, lo, hi) => {
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200) });
    B.settle(5); B.pro = true; B.ctl[key] = lo;
    let n = 0;
    while ((B.ctl[key] ?? lo) < hi - 1e-9 && n++ < 600) B.step(1 / 60, { steer: 0, pull: 0, trim: { [axis]: 1 } });
    return n / 60;
  };
  for (const [key, axis, lo, hi] of [['traveller', 'trav', -1, 1], ['twist', 'twist', -1, 1], ['jibLead', 'lead', -1, 1], ['backstay', 'backstay', 0, 1]]) {
    const s = sweep(key, axis, lo, hi), want = (hi - lo) / (2 * PRO.rate);
    assert.ok(Math.abs(s - want) < 0.05, `${key}: ${s.toFixed(2)} s end to end (want ${want} s)`);
  }
});

test('the Pro panels\' steps: twice v1\'s (the recess a tenth of the track, the trim panel a fifth of the range); v1\'s defaults kept', () => {
  assert.ok(Math.abs(stepF(0.5, 1, 0.1) - 0.6) < 1e-9 && Math.abs(stepF(0.5, 1) - 0.55) < 1e-9);
  const trav = TRIM.find((t) => t.id === 'traveller');
  const one = (st) => stepValue(trav, 0, 1, st) - 0;
  assert.ok(Math.abs(one(2 * STEP) - 2 * one(STEP)) < 1e-9 && Math.abs(stepValue(trav, 0, 1) - one(STEP)) < 1e-9);
});

test('the cars follow their controls: the traveller car slides 0.35 m each way, the jib sheet\'s lead car 0.3 m along its track', () => {
  const b = 5 * DEG;
  assert.ok(Math.abs(travellerCarX(b, 0) - travellerCarX(b, 1) - 0.35) < 1e-9 && Math.abs(travellerCarX(b, -1) - travellerCarX(b, 0) - 0.35) < 1e-9, 'the traveller car');
  // the working sheet's turning point: the point at the car's height (the side deck), the leg's lowest
  const car = (jl) => {
    const w = lineSet({ ...stubState(), jibLead: jl }).find((l) => l.name === 'jibsheet-working').points;
    return w.reduce((a, p) => (p[1] < a[1] ? p : a));
  };
  const fwd = car(-1), mid = car(0), aft = car(1);
  assert.ok(Math.abs(aft[2] - mid[2] - 0.3) < 0.03 && Math.abs(mid[2] - fwd[2] - 0.3) < 0.03, `the jib car moves with the lead (z ${fwd[2].toFixed(2)} / ${mid[2].toFixed(2)} / ${aft[2].toFixed(2)} m)`);
});
