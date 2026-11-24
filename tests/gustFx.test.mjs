// The gust's payoff (src/gustFx.js, wow/gusts): the onset, the snap, the rush, the spray, the camera's lean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GUSTFX, GustWatch, CameraLean, leanUp, gustSnapEvents, createGustFx, gustFxOn } from '../src/gustFx.js';
import { toWorldDir } from '../src/sim/boat/helmCamera.js';
import { parseFlags } from '../src/sim/core/flags.js';

const P = (q) => parseFlags(q);
// a true wind at the boat: steady 7 m/s, a gust rising +25 % over 2.5 s at t = 30 s, held 20 s, then a slow fade
const tws = (t) => 7 * (1 + 0.25 * Math.min(1, Math.max(0, (t - 30) / 2.5)) * (t < 50 ? 1 : Math.max(0, 1 - (t - 50) / 20)));

test('gustfx: on unless ?gustfx=0', () => {
  assert.equal(gustFxOn(P('')), true);
  assert.equal(gustFxOn(P('gustfx=0')), false);
  assert.equal(gustFxOn(null), true);
});

test('GustWatch: one onset as the gust lands (within 1.8 s), sized by its strength; none in steady or slowly varying wind', () => {
  const w = new GustWatch(), dt = 1 / 60, hits = [];
  for (let t = 0; t < 90; t += dt) { const e = w.update(dt, tws(t)); if (e) hits.push({ t, ...e }); }
  assert.equal(hits.length, 1);
  assert.ok(hits[0].t > 30 && hits[0].t < 31.8, `at ${hits[0].t.toFixed(2)} s`);
  assert.ok(hits[0].strength > 0.4 && hits[0].strength <= 1, `strength ${hits[0].strength}`);
  // a slow swell of the wind (± 8 % over 40 s): no hit
  const w2 = new GustWatch(); let n = 0;
  for (let t = 0; t < 300; t += dt) if (w2.update(dt, 7 * (1 + 0.08 * Math.sin(t / 40 * 2 * Math.PI)))) n++;
  assert.equal(n, 0);
  // two gusts 5 s apart: the second falls inside the gap (no machine-gun snaps)
  const w3 = new GustWatch(); let m = 0;
  const two = (t) => 7 * (1 + 0.25 * ((t > 20 && t < 23) || (t > 25 && t < 40) ? 1 : 0));
  for (let t = 0; t < 60; t += dt) if (w3.update(dt, two(t))) m++;
  assert.equal(m, 1);   // 25 − 20.5 s < gapS
});

test('the snap: the main, then the jib a beat later; louder for a stronger gust; nothing for a whisper', () => {
  assert.deepEqual(gustSnapEvents(0.02), []);
  const [m, j] = gustSnapEvents(1), [m2] = gustSnapEvents(0.3);
  assert.equal(m.kind, 'snap'); assert.equal(j.kind, 'snap'); assert.equal(j.delay, GUSTFX.jibDelayS);
  assert.ok(m.gain > m2.gain && j.gain < m.gain);
});

test('createGustFx: the hit lifts the rush and throws spray (more at speed), then settles; ?gustfx=0 is inert', () => {
  const fx = createGustFx({ flags: P(''), reduced: () => false }), dt = 1 / 60;
  let maxRush = 1, maxSpray = 0, events = [], t = 0;
  for (; t < 40; t += dt) { const g = fx.update(dt, { trueWind: { speed: tws(t) }, u: 3 }); maxRush = Math.max(maxRush, g.rushMul); maxSpray = Math.max(maxSpray, g.spray); events.push(...g.events); }
  assert.ok(maxRush > 1.3, `rush ×${maxRush.toFixed(2)}`);
  assert.ok(maxSpray > 0.3, `spray ${maxSpray.toFixed(2)}`);
  assert.equal(events.filter((e) => e.kind === 'snap').length, 2);
  let g; for (; t < 52; t += dt) g = fx.update(dt, { trueWind: { speed: tws(t) }, u: 3 });
  assert.ok(g.rushMul < 1.02 && g.spray < 0.01, 'settled');
  // slow: no spray at 1 kn
  const slow = createGustFx({ flags: P('') }); let sp = 0;
  for (let t2 = 0; t2 < 40; t2 += dt) sp = Math.max(sp, slow.update(dt, { trueWind: { speed: tws(t2) }, u: 0.5 }).spray);
  assert.equal(sp, 0);
  const off = createGustFx({ flags: P('gustfx=0') });
  for (let t2 = 0; t2 < 40; t2 += dt) assert.deepEqual(off.update(dt, { trueWind: { speed: tws(t2) }, u: 3 }), { onset: null, punch: 0, rushMul: 1, spray: 0, events: [] });
  const pose = { pos: [0, 5, 10], target: [0, 1, 0], fov: 40 };
  assert.equal(off.lean(dt, pose, { heel: 0.4, heading: 0 }), pose);
});

test('the lean: a share of the heel, lagging it, capped, smooth; none with reduced motion; steady horizon leans less', () => {
  const L = new CameraLean(), dt = 1 / 60, heel = -25 * Math.PI / 180;
  let r = [], prev = 0, maxStep = 0;
  for (let t = 0; t < 6; t += dt) { const x = L.update(dt, heel, 0, 0); maxStep = Math.max(maxStep, Math.abs(x - prev)); prev = x; r.push(x); }
  const goal = heel * GUSTFX.lean;
  assert.ok(Math.abs(r[Math.round(0.2 / dt)]) < Math.abs(goal) * 0.5, 'lags at 0.2 s');
  assert.ok(Math.abs(r.at(-1) - goal) < 1e-3, 'settles on the share');
  assert.ok(r.every((x) => Math.abs(x) <= Math.abs(goal) + 1e-9), 'no overshoot');
  assert.ok(maxStep < 0.2 * Math.PI / 180, 'no jump between frames');
  const big = new CameraLean(); for (let t = 0; t < 6; t += dt) big.update(dt, -60 * Math.PI / 180, 0, 0); big.share = 1;
  for (let t = 0; t < 6; t += dt) big.update(dt, -60 * Math.PI / 180, 0, 0);
  assert.ok(Math.abs(big.roll) <= GUSTFX.leanMaxDeg * Math.PI / 180 + 1e-9, 'capped');
  // the camera abeam the boat: no lean (cos 90°)
  const side = new CameraLean(); for (let t = 0; t < 6; t += dt) side.update(dt, heel, Math.PI / 2, 0);
  assert.ok(Math.abs(side.roll) < 1e-6);
  // the runtime: reduced motion → the pose unchanged; steady off leans more than steady on
  const pose = { pos: [0, 5, 10], target: [0, 1, 0], fov: 40 }, st = { heel, heading: 0 };
  const rm = createGustFx({ flags: P(''), reduced: () => true }); let pr; for (let t = 0; t < 4; t += dt) pr = rm.lean(dt, pose, st);
  assert.equal(pr, pose);
  const on = createGustFx({ flags: P(''), reduced: () => false, steady: () => true }), free = createGustFx({ flags: P(''), reduced: () => false, steady: () => false });
  for (let t = 0; t < 6; t += dt) { on.lean(dt, pose, st); free.lean(dt, pose, st); }
  assert.ok(Math.abs(free.roll) > Math.abs(on.roll) * 1.5);
});

test('leanUp matches the helm camera frame (a roll the same way as the heel)', () => {
  for (const [yaw, roll] of [[0, 0.1], [1.2, -0.08], [-2.5, 0.05]]) {
    const u = leanUp(yaw, roll), h = toWorldDir([0, 1, 0], { heading: yaw, heel: roll, pitch: 0 });
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(u[k] - h[k]) < 1e-12);
  }
});
