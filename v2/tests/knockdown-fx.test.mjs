// K2 the knockdown's look: nothing below 34–40° of heel (the goldens' frames never heel that far); the roll, the
// flog and the wildness ramp in past 40°; the Boat view eases out and up (30, 60 and 120 Hz the same curve); the Helm view cuts to
// the Boat view once per excursion at 45°; the spray's burst along the lee rail and the rig's slap only past 40°, more while she goes
// over, none at gain 0; the water's hull mask (render/hullMask.js) matches the drawing's frame and keeps the water out of the hull
// and the cockpit at every heel to 90°.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kdRoll, kdMix, createKnockdownFx, kdPose, KDFX, KD_CAM } from '../sim/knockdownFx.js';
import { createSpraySim } from '../sim/spray.js';
import { hullLocal, inHull, hullTable, HULL_MASK_WGSL } from '../render/hullMask.js';
import { hullShape } from '../render/boat/hullShape.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

const DEG = Math.PI / 180;

test('the amounts: exactly 0 upright (34° for the drawing, 40° for the roll), full past 62°', () => {
  for (let d = 0; d <= 34; d += 0.5) { assert.equal(kdMix(d * DEG), 0); assert.equal(kdRoll(d * DEG), 0); }
  for (let d = 34; d <= 40; d += 0.5) assert.equal(kdRoll(-d * DEG), 0);
  assert.equal(kdMix(38 * DEG), 1); assert.ok(kdRoll(50 * DEG) > 0.2 && kdRoll(50 * DEG) < 0.8); assert.equal(kdRoll(-70 * DEG), 1);
  const fx = createKnockdownFx();
  const s = fx.update(1 / 60, { heel: 30 * DEG });
  assert.deepEqual([s.k, s.mix, s.flog, s.wild, s.cam, s.cut], [0, 0, 0, 0, 0, false]);
});

test('the camera eases out and up, the same at 30, 60 and 120 Hz; back to none when she rights; off: none', () => {
  const run = (hz) => { const fx = createKnockdownFx(); let s; for (let i = 0; i < 2 * hz; i++) s = fx.update(1 / hz, { heel: 70 * DEG }); return s.cam; };
  const a = run(30), b = run(60), c = run(120);
  assert.ok(a > 0.8 && Math.abs(a - b) < 1e-9 && Math.abs(b - c) < 1e-9, `${a} ${b} ${c}`);
  const fx = createKnockdownFx();
  for (let i = 0; i < 120; i++) fx.update(1 / 60, { heel: 70 * DEG });
  for (let i = 0; i < 60 * 30; i++) fx.update(1 / 60, { heel: 10 * DEG });
  assert.equal(fx.state.cam, 0);
  for (let i = 0; i < 120; i++) fx.update(1 / 60, { heel: 70 * DEG, on: false });
  assert.equal(fx.state.cam, 0);
  const p = { pos: [0, 4, 10], target: [0, 1, 0], fov: 50 }, q = kdPose(p, 1);
  assert.ok(q.pos[2] > 10 + KD_CAM.backM - 1e-9 && q.pos[1] === 4 + KD_CAM.upM && q.fov === 50, 'back, up, the same lens');
  assert.equal(kdPose(p, 0), p);
});

test('the Helm view cuts to the Boat view once per excursion at 45°, never in the Boat view', () => {
  const fx = createKnockdownFx(); let cuts = 0;
  for (let d = 30; d <= 70; d += 0.5) cuts += fx.update(1 / 60, { heel: d * DEG, view: 'helm' }).cut ? 1 : 0;
  for (let d = 70; d >= 40; d -= 0.5) cuts += fx.update(1 / 60, { heel: d * DEG, view: 'helm' }).cut ? 1 : 0;
  assert.equal(cuts, 1);
  for (let i = 0; i < 10; i++) fx.update(1 / 60, { heel: 20 * DEG, view: 'helm' });
  assert.ok(fx.update(1 / 60, { heel: KDFX.cutDeg * DEG, view: 'helm' }).cut, 'a new excursion cuts again');
  const f2 = createKnockdownFx(); let c2 = 0;
  for (let d = 30; d <= 70; d += 1) c2 += f2.update(1 / 60, { heel: d * DEG, view: 'follow' }).cut ? 1 : 0;
  assert.equal(c2, 0);
});

function sprayRun({ heel, rate = 0, gain = 1, secs = 1, boom = 0.5 }) {
  const S = createSpraySim({ seed: 3 }); S.gain.kd = gain;
  let h = heel[0];
  for (let i = 0; i < secs * 60; i++) {
    h += rate / 60; if (h > heel[1]) h = heel[1];
    S.update({ x: 0, z: 0, heading: 0, u: 2, sog: 2, heel: h, boomAngle: boom, trueWind: { speed: 15, angle: 1.4 } }, { heave: 0, pitch: 0, roll: 0 }, 1 / 60);
  }
  return S;
}

test('the spray: none upright; a heavy burst along the lee rail and the rig slapping past 40°, more while she goes over; gain 0 none', () => {
  const up = sprayRun({ heel: [25 * DEG, 25 * DEG] });
  assert.equal(up.fed.kdRail + up.fed.kdSlap, 0);
  const held = sprayRun({ heel: [60 * DEG, 60 * DEG] });
  assert.ok(held.fed.kdRail > 150, `rail ${held.fed.kdRail}`);
  assert.ok(held.fed.kdSlap > 50, `slap ${held.fed.kdSlap}`);
  const going = sprayRun({ heel: [45 * DEG, 62 * DEG], rate: 40 * DEG });
  const still = sprayRun({ heel: [45 * DEG, 62 * DEG], rate: 0.1 * DEG });
  assert.ok(going.fed.kdRail > still.fed.kdRail * 1.5, `${going.fed.kdRail} vs ${still.fed.kdRail}`);
  const off = sprayRun({ heel: [60 * DEG, 60 * DEG], gain: 0 });
  assert.equal(off.fed.kdRail + off.fed.kdSlap, 0);
  assert.ok(held.alive <= 640, 'inside the pool');
  // upright, the knockdown's gain changes nothing at all (the speed feel's pool bit for bit)
  const a = sprayRun({ heel: [28 * DEG, 28 * DEG], gain: 1, secs: 3 }), b = sprayRun({ heel: [28 * DEG, 28 * DEG], gain: 0, secs: 3 });
  assert.deepEqual(Array.from(a.core.pos), Array.from(b.core.pos));
});

// the drawing's frame (render/boat.js): T(x, heave, z) · Ry(−heading) · Rx(pitch) · Rz(−heel), applied to a hull-frame point
function toWorld(l, P) {
  const rz = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
  const rx = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const ry = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
  const w = ry(rx(rz(l, -P.heel), P.pitch), -P.heading);
  return [w[0] + P.x, w[1] + P.heave, w[2] + P.z];
}

test('the hull mask: the drawing\'s frame undone exactly; the cockpit and the deck inside, the water beside the hull outside, to 90°', () => {
  const T = hullTable(), S = hullShape(), Pp = S.P;
  for (const P of [{ x: 10, z: -4, heave: 0.2, heading: 0.7, pitch: 0.05, heel: 0.4 }, { x: -3, z: 8, heave: -0.1, heading: -2.2, pitch: -0.03, heel: -1.3 }]) {
    for (const l of [[0.3, 0.5, 1.2], [-1.1, -0.2, -2.5], [0.9, 1.0, 3.0]]) {
      const back = hullLocal(toWorld(l, P), P);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - l[k]) < 1e-9, `${back} vs ${l}`);
    }
  }
  const cockpitZ = 0.5 * (Pp.cockpit[0] + Pp.cockpit[1]);   // hull z of the cockpit's middle (aft +)
  for (let d = 0; d <= 90; d += 5) {
    const P = { x: 0, z: 0, heave: 0, heading: 0.3, pitch: 0, heel: d * DEG };
    // the cockpit's sole and the deck's middle: inside at every heel
    assert.ok(inHull(toWorld([0, Pp.sole, cockpitZ], P), P, T), `cockpit ${d}°`);
    assert.ok(inHull(toWorld([0.4, 0.8, -1.0], P), P, T), `deck ${d}°`);
    // a point 0.3 m outboard of the sheer, and one past the transom: outside
    const zs = -1.0, hb = S.halfBeamSheer(-zs);
    assert.equal(inHull(toWorld([hb + 0.3, 0.5, zs], P), P, T), false, `beside ${d}°`);
    assert.equal(inHull(toWorld([0, 0.3, T.z1 + 0.4], P), P, T), false, `astern ${d}°`);
    // beside the round bilge (under the waterline, out at the sheer's half-beam): the water is there, never cut away
    assert.equal(inHull(toWorld([S.halfBeamSheer(1.0) * 0.95, -0.4, -1.0], P), P, T), false, `bilge ${d}°`);
  }
  assert.deepEqual(lintWgsl(HULL_MASK_WGSL(T), 'hullMask'), [], 'the WGSL passes the Safari lint');
});
