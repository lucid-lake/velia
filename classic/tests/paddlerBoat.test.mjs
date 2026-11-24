// The paddler and the boat (split from tests/paddlerMotion.test.mjs on 2026-11-12, so the two halves run side by side):
// the planted blade stays put while the boat runs past, the speed builds from the strokes and glides, the forward motion
// comes from the blade, and no frame-to-frame judder (feat/kayak-paddler).
// Behaviour only: the modules are called and their output read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createKayak } from '../src/props/kayak/index.js';
import { createPaddler, parsePaddlerGltf } from '../src/props/paddler/index.js';

const ld = async (f) => { const b = readFileSync(new URL(`../../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
const gltf = { male: await ld('ubc-male.glb'), female: await ld('ubc-female.glb') };   // the UBC figures (Node: no images)

// ---- the planted blade (owner, 2026-11-07: "when you do that, the boat will move"): the blade locks in the water and the
// boat runs past it; the boat's speed comes from the strokes ----
function sail(sex, modes) {
  const k = createKayak({ paddle: 'held' });
  const p = createPaddler({ gltf, kayak: k, seed: 3, mode: 'rest', look: { sex } });
  let x = 0, z = 0, h = 0;
  const log = [];
  for (const [m, secs] of modes) {
    p.setMode(m);
    for (let i = 0; i < secs * 120; i++) {
      const o = p.update(1 / 120);
      h += o.boat.dyaw; x += Math.sin(h) * o.boat.advance; z -= Math.cos(h) * o.boat.advance;
      k.group.position.set(x, 0, z); k.group.rotation.set(0, -h, 0); k.group.updateMatrixWorld(true);
      const side = o.planted ? (o.planted.side === 'R' ? 'stbd' : 'port') : null;
      log.push({ m, o, v: o.boat.v, h, blade: side ? k.paddle.group.localToWorld(new THREE.Vector3(k.paddle.blades[side].centre, 0, 0)) : null });
    }
  }
  return log;
}

for (const sex of ['male', 'female']) {
  test(`${sex}: a planted blade stays put in the world while the boat runs past it (slip within budget)`, () => {
    const log = sail(sex, [['cruise', 6], ['sprint', 4], ['back', 4], ['turnLeft', 4]]);
    let start = null, worst = -1, pulls = 0;
    for (const r of log) {
      const pl = r.o.planted;
      if (!pl || !pl.locked) { start = null; continue; }
      if (!start || start.side !== pl.side || pl.travel < start.t0) { start = { side: pl.side, p: r.blade.clone(), t0: pl.travel, s0: pl.slip }; pulls++; continue; }
      // along and across the water (the planted blade's depth follows the stroke: it dips in as it bites, rises to the
      // exit): the blade moves only by the slip the model reports (under way a share of the travel; from rest more)
      const drift = Math.hypot(r.blade.x - start.p.x, r.blade.z - start.p.z);
      worst = Math.max(worst, drift - (pl.slip - start.s0 + 0.015));
    }
    assert.ok(pulls > 10, `${pulls} pulls`);   // 18 s at human rates: ≈ 20 strokes, some released early by the hip, elbow and reach rules
    assert.ok(worst <= 0, `a blade drifted ${(worst * 100).toFixed(1)} cm past its slip budget`);
  });

  test(`${sex}: the boat's speed builds over the strokes, glides in each recovery, comes to rest; sprint is faster, back goes astern`, () => {
    const log = sail(sex, [['cruise', 8], ['sprint', 5], ['rest', 8], ['back', 5]]);
    const of = (m) => log.filter((r) => r.m === m);
    const at = (m, f) => of(m)[Math.floor(f * (of(m).length - 1))].v;
    assert.ok(at('cruise', 0.05) < at('cruise', 0.3) && at('cruise', 0.3) < at('cruise', 0.95) + 0.15, 'builds');
    const cruiseTop = Math.max(...of('cruise').map((r) => r.v)), sprintTop = Math.max(...of('sprint').map((r) => r.v));
    // (the boat runs past the planted blade at about the stroke's own pace: ≈ 0.9 m/s cruising, ≈ 1.4 sprinting; K3 § Round 8)
    assert.ok(cruiseTop > 0.75 && cruiseTop < 1.8, `cruise ${cruiseTop.toFixed(2)} m/s`);
    assert.ok(sprintTop > cruiseTop * 1.35, `sprint ${sprintTop.toFixed(2)} m/s`);   // (5 s of sprint from a cruise: still building toward ≈ 2 m/s)
    // in every free step of cruise (no blade in the water) the boat slows: the glide
    const cr = of('cruise');
    for (let i = 1; i < cr.length; i++) if (!cr[i].o.planted && !cr[i - 1].o.planted && cr[i].v > 0.3) assert.ok(cr[i].v <= cr[i - 1].v + 1e-9, 'glides');
    const rest = of('rest');
    // (a kayak glides long: the square-law and linear drag halve its speed in ≈ 5–6 s from a cruise)
    assert.ok(rest.at(-1).v < 0.5 * rest[0].v, `rest glides down: ${rest[0].v.toFixed(2)} → ${rest.at(-1).v.toFixed(2)} m/s`);
    assert.ok(log.at(-1).v < -0.3, `back goes astern: ${log.at(-1).v.toFixed(2)} m/s`);
  });
}

// ---- the forward motion (owner, 2026-11-08: "the boat is not moving forward convincingly based on physics and math"):
// the boat's speed comes from the blade. From rest, cruise then rest, at 60 Hz with the kayak placed in the world: over
// each stroke's time in the water the blade moves in the world by only a little of the boat's travel (−8 to +25 %: it
// stays nearly put while the hull slides past; the round-8 build's blade rode forward with the stroke); the speed ripples 3–10 % peak to peak a stroke; the first strokes accelerate
// the boat (90 % of its cruise within 3–6 strokes); with the strokes stopped it glides on, slowing ----
test('the boat moves up to a planted blade: the blade stays nearly put in the world, the speed surges per stroke, starts and glides', () => {
  for (const sex of ['male', 'female']) {
    const k = createKayak({ paddle: 'held' });
    const p = createPaddler({ gltf, kayak: k, seed: 3, mode: 'rest', look: { sex } });
    let x = 0, z = 0, h = 0, t = 0, cur = null;
    const strokes = [], vs = [];
    for (const [m, secs] of [['cruise', 20], ['rest', 8]]) {
      p.setMode(m);
      for (let i = 0; i < secs * 60; i++) {
        const o = p.update(1 / 60); t += 1 / 60;
        h += o.boat.dyaw; x += Math.sin(h) * o.boat.advance; z -= Math.cos(h) * o.boat.advance;
        k.group.position.set(x, 0, z); k.group.rotation.set(0, -h, 0); k.group.updateMatrixWorld(true);
        vs.push({ t, v: o.boat.v, m });
        const wet = o.blades.R.depth > 0 ? 'stbd' : o.blades.L.depth > 0 ? 'port' : null;
        if (wet && m === 'cruise' && t < 19.5) {   // (whole strokes of the cruise: not the one cut off by the switch to rest)
          const bw = k.paddle.group.localToWorld(new THREE.Vector3(k.paddle.blades[wet].centre, 0, 0));
          if (!cur || cur.side !== wet) { if (cur) strokes.push(cur); cur = { side: wet, t0: t, b0: bw.clone(), x0: x, z0: z, h0: h }; }
          cur.b1 = bw.clone(); cur.x1 = x; cur.z1 = z;
        } else if (cur) { strokes.push(cur); cur = null; }
      }
    }
    const steady = strokes.filter((s2) => s2.t0 > 12 && s2.t0 < 18.8);
    assert.ok(steady.length >= 6, `${sex}: ${steady.length} steady strokes`);   // (12–18.8 s at ≈ 30 a side a minute)
    for (const s2 of steady) {
      const fx = Math.sin(s2.h0), fz = -Math.cos(s2.h0);
      const travel = (s2.x1 - s2.x0) * fx + (s2.z1 - s2.z0) * fz, back = -((s2.b1.x - s2.b0.x) * fx + (s2.b1.z - s2.b0.z) * fz);
      const slip = back / travel;
      // (over the blade's whole time in the water, catch and release included: held, it slips back ≈ 11 %; going in and
      // coming out it moves with the stroke a few centimetres)
      assert.ok(travel > 0.2 && slip >= -0.08 && slip <= 0.25, `${sex}: a stroke at ${s2.t0.toFixed(1)} s: the boat ${travel.toFixed(2)} m, the blade back ${back.toFixed(3)} m (slip ${(100 * slip).toFixed(0)} %)`);
    }
    const cr = vs.filter((r) => r.m === 'cruise' && r.t > 12).map((r) => r.v), mean = cr.reduce((a, b) => a + b, 0) / cr.length;
    const ripple = (Math.max(...cr) - Math.min(...cr)) / mean;
    assert.ok(mean > 1.2 && mean < 1.7, `${sex}: cruise ${mean.toFixed(2)} m/s`);
    assert.ok(ripple > 0.03 && ripple < 0.10, `${sex}: a ripple of ${(100 * ripple).toFixed(1)} % peak to peak`);
    const reach = vs.find((r) => r.v > 0.9 * mean), firstStrokes = strokes.filter((s2) => s2.t0 < reach.t).length;
    assert.ok(firstStrokes >= 3 && firstStrokes <= 6, `${sex}: 90 % of cruise after ${firstStrokes} strokes`);
    const rest = vs.filter((r) => r.m === 'rest' && r.t > 21.5);   // (the blend into rest finishes its last stroke)
    for (let i = 1; i < rest.length; i++) assert.ok(rest[i].v <= rest[i - 1].v + 1e-9, `${sex}: the glide never speeds up`);
    assert.ok(rest.at(-1).v > 0.1 && rest.at(-1).v < 0.6 * rest[0].v, `${sex}: a glide ${rest[0].v.toFixed(2)} → ${rest.at(-1).v.toFixed(2)} m/s in 8 s`);
  }
});

// ---- no judder (owner, 2026-11-07: "the motion glitches every frame"): at 60 Hz, in every mode and through the blends,
// the hands, elbows, head and shaft move with a smooth acceleration. A judder is a frame-to-frame zigzag: the acceleration
// reverses, then reverses back the next frame (period two). A smooth stroke reverses its acceleration too, but slowly. The
// glitching build (0c976cc) zigzagged 6–9 times a second in cruise with 400–500 m/s² peaks at the hands and its clavicles
// and upper arms 4–7 times a second with 1800–2500 rad/s² peaks; this test fails on it.
for (const sex of ['male', 'female']) {
  test(`${sex}: no frame-to-frame judder at 60 Hz in any mode or blend (no acceleration zigzag, no spike)`, (t) => {
    const k = createKayak({ paddle: 'held' });
    const p = createPaddler({ gltf, kayak: k, seed: 4, mode: 'rest', look: { sex } });
    const B = p.figure.bones, L = (o) => k.group.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
    const keys = { handL: B.MiddleHandL, handR: B.MiddleHandR, elbowL: B.LowerArmL, elbowR: B.LowerArmR, head: B.Head };
    const dt = 1 / 60, bad = [];
    let worstZ = { v: 0 }, worstA = { v: 0 }, worstR = { v: 0 }, worstC = { v: 0 };
    const kq = k.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    // the angular velocity (rad per frame, as a vector) from one rotation to the next
    const omega = (a, b) => { const d = a.clone().multiply(b.clone().invert()); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w); const sn = Math.hypot(d.x, d.y, d.z); return sn < 1e-12 ? new THREE.Vector3() : new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(2 * Math.atan2(sn, d.w) / sn); };
    for (const m of ['cruise', 'sprint', 'cruise', 'turnLeft', 'back', 'turnRight', 'rest']) {
      p.setMode(m);
      const hist = [], rot = [];
      let hz = 0;
      for (let i = 0; i < 300; i++) {   // 5 s: the blend in, then the loop
        hz = Math.max(hz, p.update(dt).state.hz);
        const x = Object.fromEntries(Object.entries(keys).map(([n, b]) => [n, L(b)])); x.shaft = k.paddle.group.position.clone();
        hist.push(x);
        const r = {};
        for (const n of ['ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR']) {
          const b = B[n]; r[n] = kq.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
          const ax = b.children.find((c) => c.isBone).position.clone().normalize(), lq = b.quaternion, d = lq.x * ax.x + lq.y * ax.y + lq.z * ax.z;
          r[`${n}twist`] = 2 * Math.atan2(Math.abs(d) * Math.sign(d || 1), lq.w);   // swing-twist: the twist about the bone's own axis
        }
        rot.push(r);
      }
      for (const n of Object.keys(hist[0])) {
        const A = [];
        for (let i = 2; i < hist.length; i++) A.push(hist[i][n].clone().sub(hist[i - 1][n]).sub(hist[i - 1][n].clone().sub(hist[i - 2][n])).multiplyScalar(1 / (dt * dt)));
        let zigzags = 0, peak = 0;
        for (let i = 0; i < A.length; i++) {
          peak = Math.max(peak, A[i].length());
          if (i >= 2 && A[i].dot(A[i - 1]) < 0 && A[i - 1].dot(A[i - 2]) < 0 && Math.min(A[i].length(), A[i - 1].length(), A[i - 2].length()) > 5) zigzags++;
        }
        const perSecond = zigzags / 5;
        if (perSecond > worstZ.v) worstZ = { v: perSecond, at: `${m} ${n}` };
        if (peak > worstA.v) worstA = { v: peak, at: `${m} ${n}` };
        if (perSecond > 3) bad.push(`${m} ${n}: ${perSecond.toFixed(1)} acceleration zigzags a second (allowed 3): a judder`);
        if (peak >= 400) bad.push(`${m} ${n}: a ${peak.toFixed(0)} m/s² spike in one frame`);
      }
      // the shoulder (owner: "the deltoid and the upper arm vibrate every frame"): the clavicle and upper-arm bones' turns,
      // as angular velocity per frame; their angular acceleration has no zigzag and no spike, and the upper arm's twist
      // about its own axis (which moves no joint, only the skin over the deltoid) changes smoothly
      for (const n of ['ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR']) {
        const W = []; for (let i = 1; i < rot.length; i++) W.push(omega(rot[i][n], rot[i - 1][n]).multiplyScalar(1 / dt));
        const A = []; for (let i = 1; i < W.length; i++) A.push(W[i].clone().sub(W[i - 1]).multiplyScalar(1 / dt));
        let zigzags = 0, peak = 0;
        for (let i = 0; i < A.length; i++) {
          peak = Math.max(peak, A[i].length());
          if (i >= 2 && A[i].dot(A[i - 1]) < 0 && A[i - 1].dot(A[i - 2]) < 0 && Math.min(A[i].length(), A[i - 1].length(), A[i - 2].length()) > 20) zigzags++;
        }
        const T = rot.map((r) => r[`${n}twist`]); for (let i = 1; i < T.length; i++) while (Math.abs(T[i] - T[i - 1]) > Math.PI) T[i] -= Math.sign(T[i] - T[i - 1]) * 2 * Math.PI;
        let tz = 0; const TA = []; for (let i = 2; i < T.length; i++) TA.push((T[i] - 2 * T[i - 1] + T[i - 2]) / (dt * dt));
        for (let i = 2; i < TA.length; i++) if (TA[i] * TA[i - 1] < 0 && TA[i - 1] * TA[i - 2] < 0 && Math.min(...TA.slice(i - 2, i + 1).map(Math.abs)) > 20) tz++;
        // rad/s²: the clavicle under 400, the upper arm under 1600 (a sprint's or a sweep's fastest swing, one frame); the
        // glitching build reached 1800–2500 on both in a plain cruise, every stroke
        // (a sprint's top arm punches up and over at 1 Hz: its upper arm may swing up to 2800 rad/s² in its fastest frame)
        const limit = n.startsWith('Shoulder') ? 400 : m === 'sprint' ? 2800 : 1600;
        if (n.startsWith('Shoulder')) { if (peak > worstC.v) worstC = { v: peak, at: `${m} ${n}` }; } else if (peak > worstR.v) worstR = { v: peak, at: `${m} ${n}` };
        if (zigzags / 5 > 3) bad.push(`${m} ${n}: ${(zigzags / 5).toFixed(1)} angular zigzags a second (allowed 3): a judder`);
        if (tz / 5 > 3) bad.push(`${m} ${n}: its twist zigzags ${(tz / 5).toFixed(1)} times a second (allowed 3)`);
        if (peak >= limit) bad.push(`${m} ${n}: a ${peak.toFixed(0)} rad/s² turn spike in one frame (allowed ${limit})`);
      }
    }
    t.diagnostic(`worst: ${worstZ.v.toFixed(1)} zigzags/s (${worstZ.at}), peak ${worstA.v.toFixed(0)} m/s² (${worstA.at}); clavicle peak ${worstC.v.toFixed(0)} rad/s² (${worstC.at}), upper arm peak ${worstR.v.toFixed(0)} rad/s² (${worstR.at})`);
    assert.deepEqual(bad, []);
  });
}
