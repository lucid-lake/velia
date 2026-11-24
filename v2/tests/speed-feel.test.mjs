// The speed feel (owner, 2026-11-17): the speed and heel she has, felt a little more. The sound (v2/audio/speedSound.js through
// v1's boat engine), the lee side's foam and droplets and the bow's chop spray (v2/sim/speedFeel.js, v2/sim/spray.js) and the
// Boat view's speed camera (v2/sim/boat.js camera). Behaviour only: the modules are called and their outputs read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { speedK, leeK, railWet, leeFoam, feelQ, FEEL_Q, createSpeedCam, speedPose, CAM } from '../sim/speedFeel.js';
import { speedLayers, createSpeedSound, SPEED_SOUND } from '../audio/speedSound.js';
import { createBoatAudio, LEVEL } from '../../src/boatAudio.js';
import { createSpraySim } from '../sim/spray.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const DEG = Math.PI / 180, KN = 1852 / 3600;
const nondecreasing = (xs, what) => { for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 1e-12, `${what} fell at step ${i}: ${xs[i - 1]} → ${xs[i]}`); };

test('the sound: the hiss band and the hum rise monotonically with speed and with heel; the rush\'s low-pass opens', () => {
  const speeds = Array.from({ length: 30 }, (_, i) => i * 0.25 * KN * 1.0);   // 0 … 7.25 kn
  const heels = Array.from({ length: 36 }, (_, i) => i * DEG);                  // 0 … 35°
  for (const h of [0, 15 * DEG, 25 * DEG, 31 * DEG]) {
    const L = speeds.map((s) => ({ ...speedLayers(s, h, 8) }));
    nondecreasing(L.map((l) => l.hiss + l.fizz), `hiss band (heel ${h / DEG}°) by speed`);
    nondecreasing(L.map((l) => l.hum), 'hum by speed');
    nondecreasing(L.map((l) => l.hullHz), 'rush low-pass by speed');
  }
  for (const kn of [3, 5, 6.5]) {
    const L = heels.map((h) => ({ ...speedLayers(kn * KN, h, 8) }));
    nondecreasing(L.map((l) => l.hiss + l.fizz), `hiss band (${kn} kn) by heel`);
  }
  const slow = speedLayers(2 * KN, 0, 8), fast = speedLayers(6.5 * KN, 0, 8);
  assert.equal(slow.hiss, 0, 'no speed hiss at 2 kn');
  assert.ok(fast.hiss > 0.05 && fast.hum > 0.04 && fast.hullHz > 11000, `at hull speed: hiss ${fast.hiss}, hum ${fast.hum}, ${fast.hullHz} Hz`);
});

test('the sound: the rail\'s fizz only when the lee deck edge is in the water', () => {
  for (const h of [0, 10, 20, 24, 26]) assert.equal(speedLayers(6 * KN, h * DEG, 8).fizz, 0, `no fizz at ${h}° (rail dry: ${railWet(h * DEG)})`);
  assert.ok(speedLayers(6 * KN, 29 * DEG, 8).fizz > 0, 'fizz at 29°');
  assert.ok(Math.abs(speedLayers(6 * KN, 31 * DEG, 8).fizz - LEVEL.hiss * SPEED_SOUND.fizz) < 0.01, 'full fizz with the rail awash');
  assert.equal(speedLayers(6 * KN, -31 * DEG, 8).fizz, speedLayers(6 * KN, 31 * DEG, 8).fizz, 'either tack');
  assert.equal(speedLayers(0.5 * KN, 31 * DEG, 8).fizz, 0, 'no fizz without way on');
});

test('the sound through v1\'s engine: the adjust hook re-weights the mix, never over the caps; off is v1\'s mix exactly', () => {
  const state = (sogKn, heelDeg) => ({ sog: sogKn * KN, heel: heelDeg * DEG, heelDrawn: heelDeg * DEG, apparentWind: { speed: 9, angle: 0.9 }, trueWind: { speed: 7, angle: 1.4 }, drive: 1500, side: 1500, mainFill: 1, jibFill: 1, rail: 0 });
  const run = (adjust, s) => { const a = createBoatAudio({ seed: 1 }); let m; for (let i = 0; i < 60; i++) m = a.update(i / 60, s, { camDist: 30, adjust }); return m; };
  const base = run(undefined, state(6.5, 31)), feel = createSpeedSound();
  const on = run(feel.adjust, state(6.5, 31));
  assert.ok(on.gains.hiss > base.gains.hiss && on.gains.hiss <= SPEED_SOUND.hissCap + 1e-12, `hiss ${base.gains.hiss} → ${on.gains.hiss}`);
  assert.ok(on.gains.hum >= base.gains.hum && on.gains.hum <= 1.4 * LEVEL.hum + 1e-12, `hum ${base.gains.hum} → ${on.gains.hum}`);
  assert.ok(on.hz.hull > base.hz.hull, 'the rush opens');
  assert.equal(on.gains.rush, base.gains.rush, 'the rush\'s level is v1\'s');
  feel.on = false;
  assert.equal(feel.adjust, null);
  assert.deepEqual(run(feel.adjust, state(6.5, 31)).gains, base.gains, 'off: v1\'s mix');
  // the rail dry: v1's near-rail hiss is replaced by the speed hiss alone (no fizz)
  const dry = run(createSpeedSound().adjust, { ...state(6, 24), rail: 0.6 });
  assert.ok(Math.abs(dry.gains.hiss - speedLayers(6 * KN, 24 * DEG, 9).hiss) < 1e-12, 'dry rail: the speed hiss only');
});

test('the lee foam: none upright or slow; rises with heel and with speed, more with the rail wet; scaled by the level', () => {
  const at = (kn, deg, q) => leeFoam({ sog: kn * KN, u: kn * KN, heel: deg * DEG }, q).strength;
  assert.equal(at(6, 0), 0); assert.equal(at(1.5, 30), 0);
  nondecreasing([0, 8, 12, 16, 20, 24, 27, 29, 31, 34].map((d) => at(6, d)), 'foam by heel');
  nondecreasing([2, 3, 4, 5, 6, 6.5, 7].map((k) => at(k, 28)), 'foam by speed');
  assert.ok(at(6.5, 31) > 0.9 && at(6.5, 20) < 0.5, `rail wet ${at(6.5, 31)} vs dry ${at(6.5, 20)}`);
  assert.equal(leeFoam({ sog: 3, heel: -0.5 }).side, -1); assert.equal(leeFoam({ sog: 3, heel: 0.5 }).side, 1);
  assert.ok(at(6.5, 31, feelQ(2)) < at(6.5, 31, feelQ(0)) && at(6.5, 31, feelQ(3)) === 0, 'L2 less, L3 none');
  assert.equal(at(6.5, 31, feelQ(0, false)), 0, 'the switch off');
  assert.deepEqual(FEEL_Q.map((q) => q.rail), [1, 1, 0.5, 0]);
});

// the spray sim stepped at 60 Hz for `s` seconds: a heel, a speed and a pitch swing (the chop)
function spray({ heelDeg, kn, chop = 0, gain = { rail: 1, bow: 1 }, s = 10 }) {
  const S = createSpraySim({ seed: 3 }); Object.assign(S.gain, gain);
  const u = kn * KN, st = { x: 0, z: 0, heading: 0, u, sog: u, heel: heelDeg * DEG, trueWind: { speed: 7, angle: 50 * DEG }, slam: 0, surf: 0 };
  for (let i = 0; i < s * 60; i++) { const t = i / 60; S.update(st, { heave: 0, pitch: chop * Math.sin(2 * Math.PI * t / 1.6), roll: 0 }, 1 / 60); }
  return S.fed;
}

test('the lee rail\'s droplets: only with the rail wet, more with speed, scaled by the level, none at gain 0', () => {
  assert.equal(spray({ heelDeg: 22, kn: 6.5 }).rail, 0, 'rail dry at 22°');
  const wet = spray({ heelDeg: 31, kn: 6.5 }).rail, slower = spray({ heelDeg: 31, kn: 4.5 }).rail;
  assert.ok(wet > 500 && wet < 800, `≈ 70 a second for 10 s: ${wet}`);
  assert.ok(slower < wet, `slower: ${slower} < ${wet}`);
  const half = spray({ heelDeg: 31, kn: 6.5, gain: { rail: 0.5, bow: 1 } }).rail;
  assert.ok(Math.abs(half - wet / 2) <= 2, `L2's half: ${half} of ${wet}`);
  assert.equal(spray({ heelDeg: 31, kn: 6.5, gain: { rail: 0, bow: 0 } }).rail, 0);
});

test('the bow\'s chop spray: none in flat water or upright; more with a bigger chop and more heel; none at gain 0', () => {
  assert.equal(spray({ heelDeg: 25, kn: 6.5, chop: 0 }).bow, 0, 'flat water');
  assert.equal(spray({ heelDeg: 2, kn: 6.5, chop: 0.08 }).bow, 0, 'upright');
  const small = spray({ heelDeg: 25, kn: 6.5, chop: 0.06 }).bow, big = spray({ heelDeg: 25, kn: 6.5, chop: 0.1 }).bow;
  const less = spray({ heelDeg: 16, kn: 6.5, chop: 0.1 }).bow;
  assert.ok(big > small && big > 0, `chop: ${small} → ${big}`);
  assert.ok(less < big, `heel: ${less} < ${big}`);
  assert.equal(spray({ heelDeg: 25, kn: 6.5, chop: 0.1, gain: { rail: 1, bow: 0 } }).bow, 0);
});

test('the speed camera: lower and wider by speed, up to 0.6 m and 4° at hull speed; frame-rate independent at 30, 60 and 120 Hz', () => {
  const settle = (hz, kn, s = 8, o = {}) => { const c = createSpeedCam(); for (let i = 0; i < s * hz; i++) c.update(1 / hz, { sog: kn * KN, ...o }); return c.amount; };
  assert.equal(settle(60, 2), 0, 'nothing at 2 kn');
  assert.ok(settle(60, 6.5) > 0.99, 'full at hull speed');
  nondecreasing([2, 3, 4, 5, 6, 6.5].map((k) => settle(60, k)), 'amount by speed');
  const pose = () => ({ pos: [0, 12, 30], target: [0, 1.5, -20], fov: 41.6 });
  const p = speedPose(pose(), 1);
  assert.ok(Math.abs(p.pos[1] - (12 - CAM.dropM)) < 1e-12 && Math.abs(p.fov - (41.6 + CAM.fovDeg)) < 1e-12, 'full: −0.6 m, +4°');
  const low = speedPose({ pos: [0, 2.6, 10], target: [0, 1.5, -5], fov: 40 }, 1);
  assert.ok(low.pos[1] >= 1.5 + CAM.clearM - 1e-12, `never under the aim + ${CAM.clearM} m: ${low.pos[1]}`);
  // the same curve at any frame rate: rising for 2 s, then slowing for 1.5 s
  const curve = (hz) => { const c = createSpeedCam(), out = []; for (let i = 0; i < 3.5 * hz; i++) { c.update(1 / hz, { sog: (i / hz < 2 ? 6.5 : 3) * KN }); if ((i + 1) % (hz / 2) === 0) out.push(c.amount); } return out; };
  const a30 = curve(30), a60 = curve(60), a120 = curve(120);
  for (let i = 0; i < a60.length; i++) assert.ok(Math.abs(a30[i] - a60[i]) < 1e-9 && Math.abs(a120[i] - a60[i]) < 1e-9, `t ${(i + 1) / 2} s: ${a30[i]} ${a60[i]} ${a120[i]}`);
  assert.ok(a60[3] > 0.7 && a60[6] < a60[3], 'eased up, then back as she slows');
});

test('the speed camera stands down: eased out in the Helm view and under Cruise; Reduce Motion and the switch zero it at once', () => {
  const c = createSpeedCam();
  for (let i = 0; i < 600; i++) c.update(1 / 60, { sog: 6.5 * KN });
  const full = c.amount;
  c.update(1 / 60, { sog: 6.5 * KN, view: 'helm' });
  assert.ok(c.amount < full && c.amount > 0.9 * full, 'helm: eased, no jump');
  for (let i = 0; i < 900; i++) c.update(1 / 60, { sog: 6.5 * KN, view: 'helm' });
  assert.equal(c.amount, 0, 'helm: gone');
  for (let i = 0; i < 600; i++) c.update(1 / 60, { sog: 6.5 * KN });
  for (let i = 0; i < 900; i++) c.update(1 / 60, { sog: 6.5 * KN, cruise: true });
  assert.equal(c.amount, 0, 'cruise: gone');
  for (let i = 0; i < 600; i++) c.update(1 / 60, { sog: 6.5 * KN });
  assert.equal(c.update(1 / 60, { sog: 6.5 * KN, reduced: true }), 0, 'reduced motion: at once');
  for (let i = 0; i < 600; i++) c.update(1 / 60, { sog: 6.5 * KN });
  assert.equal(c.update(1 / 60, { sog: 6.5 * KN, on: false }), 0, 'off: at once');
});

test('the speed camera on the boat: the Boat view lower and wider at speed, composes with the trim nudge; none in Helm, calm or off', () => {
  const wind = { sample: (x, z, t) => { const v = steadyWind(9, 161)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const make = (o = {}) => { const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, flags: o.flags ?? {} }); B.viewOf = () => o.view ?? 'follow'; if (o.calm) globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) }); B.settle(20); delete globalThis.matchMedia; return B; };
  const cam = (B, frames = 120, inp = { steer: 0, pull: 0 }) => { let c; for (let i = 0; i < frames; i++) { B.step(1 / 60, inp); c = B.camera(1 / 60); } return c; };
  const on = make(), off = make({ flags: { speedfeel: false } });
  const a = cam(on), b = cam(off), k = on.speedCam;
  assert.ok(on.state.sog / KN > 5 && k > 0.6, `${(on.state.sog / KN).toFixed(2)} kn: amount ${k}`);
  assert.ok(Math.abs(a.fov - b.fov - CAM.fovDeg * k) < 0.05, `fov +${(a.fov - b.fov).toFixed(2)}° (amount ${k.toFixed(3)})`);
  assert.ok(b.pos[1] - a.pos[1] > 0.5 * CAM.dropM * k && b.pos[1] - a.pos[1] <= CAM.dropM + 1e-9, `lower by ${(b.pos[1] - a.pos[1]).toFixed(3)} m`);
  assert.equal(off.speedCam, 0);
  // the trim nudge on top: the sheet in the hand turns the pose round the boat; the speed camera's lens stays
  const n = cam(on, 60, { steer: 0, pull: 0.2 });
  assert.ok(on.nudge !== 0 && Math.abs(n.fov - (b.fov + CAM.fovDeg * on.speedCam)) < 0.1, `nudge ${on.nudge.toFixed(2)} with the speed lens`);
  assert.equal(make({ calm: true }).speedCam, 0, 'Reduce Motion: none from the settle');
  const helm = make({ view: 'helm' }); cam(helm, 600);
  assert.equal(helm.speedCam, 0, 'helm view: none');
});
