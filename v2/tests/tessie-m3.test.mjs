// Tessie M3 (owner, 2026-11-18). Behaviour only: her sim, the revenge, the behaviours, the boat's real
// physics, the clearance proxy, the stage's moment picker and Cruise's camera cut are called and their state read.
//   the boat is solid to her: the proxy holds every sampled point of the hull, keel, rudder, mast and sails at any heel; on every
//   frame of the revenge's strike (through the knockdown roll), swimming alongside, the dive under the hull and a rise under the
//   boat, every point of her body keeps CLEAR.margin (0.15 m) from it (measured by a proxy of its own, posed as the boat is drawn)
//   the strike reads physical: her back meets the keel and the bilge (the gap at the push is the margin's neighbourhood)
//   alongside: 25–40 m abeam at the boat's speed for up to 20 s; under: below the keel, up 30–50 m off the other side
//   the rare moments: the sunset breach and the lightning neck (her neck up at the flash); the night glow's share; Cruise's cut
//   turns at most 15°/s, eased, holds and returns
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE, reachAt } from '../sim/tessie.js';
import { createRevenge } from '../sim/tessieRevenge.js';
import { createBehave, BEHAVE } from '../sim/tessieBehave.js';
import { createBoatClear, boatShape, CLEAR } from '../sim/tessieClear.js';
import { createCamCut, CAMCUT } from '../sim/tessieCamCut.js';
import { pickMoment, momentFlag, neckReady, glowShare, NECK, MOMENTS } from '../stage/tessieMoments.js';
import { start as tessieStart, PLACE_S } from '../stage/act-tessie.js';
import { createBoatSim, waterFor, START, KN } from '../sim/boat.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import { GROUND } from '../../src/sim/boat/ground.js';

const DEG = Math.PI / 180, DT = 1 / 30, deep = () => 40, M = CLEAR.margin;
const view = (b) => ({ x: b.x - Math.sin(b.heading) * 32, z: b.z + Math.cos(b.heading) * 32, yaw: b.heading, hHalf: 0.6 });
// the referee: a proxy of its own, posed as the boat is drawn, and her body's reach at each spine frame
function gapOf(t, pose) { const C = createBoatClear().pose(pose); return C.clearOf(t.state.spine, t.L, (s) => reachAt(s, t.L)); }

// the boat's own surface, sampled in the hull frame (x starboard, y up, z aft; src/sim/boat/dims.js): the canoe body as an
// ellipse under the waterline to the station's draft, the topsides to the sheer, the fin keel, the spade rudder, the mast, the boom
// end and points inside the two sails
function boatSamples(boomAngle = 0.4, jibAngle = 0.3) {
  const { HULL, RIG } = DEFAULT_DIMS, L = HULL.loa, B = HULL.beam, pts = [];
  const half = (x) => { const t = (x + L / 2) / L; return B / 2 * (t < 0.55 ? 0.82 + 0.18 * Math.sin(t / 0.55 * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2.2))); };
  const draft = (x) => 0.1 + 0.34 * Math.max(0, 1 - (x / 4.3) ** 2) ** 0.6;
  for (let i = 0; i <= 40; i++) {
    const x = -L / 2 + L * i / 40, hb = half(x), d = draft(x);
    for (let k = 0; k <= 12; k++) { const th = Math.PI * k / 12; pts.push([hb * Math.cos(th), -d * Math.sin(th), -x]); }
    for (const y of [0.3, 0.6, HULL.freeboard]) { pts.push([hb, y, -x], [-hb, y, -x]); }
  }
  for (const k of GROUND.keel) for (let y = 0; y >= -k.d; y -= 0.2) pts.push([0, y, -k.x]);
  pts.push([0, -GROUND.rudder.d, GROUND.rudder.x === undefined ? HULL.rudderZ : -GROUND.rudder.x], [0, -0.6, HULL.rudderZ]);
  const sy = HULL.mastStepY, sz = HULL.mastStepZ;
  for (let y = 0; y <= RIG.mastTop; y += 1) pts.push([0, sy + y, sz]);
  const g = [0, sy + RIG.gooseneck, sz + 0.1], h = [0, sy + RIG.gooseneck + RIG.mainLuff, sz + 0.1], c = [Math.sin(boomAngle) * RIG.boom, g[1], g[2] + Math.cos(boomAngle) * RIG.boom];
  for (const [u, v] of [[0.2, 0.2], [0.5, 0.2], [0.2, 0.6], [0.33, 0.33], [0, 1], [1, 0]]) pts.push([g[0] + (h[0] - g[0]) * v + (c[0] - g[0]) * u, g[1] + (h[1] - g[1]) * v + (c[1] - g[1]) * u, g[2] + (h[2] - g[2]) * v + (c[2] - g[2]) * u]);
  const jt = [0, sy + RIG.tack[1], sz + RIG.tack[2]], jh = [0, sy + RIG.head[1], sz + RIG.head[2]], jc = [jt[0] + Math.sin(jibAngle) * RIG.jibLP, jt[1] + 0.35, jt[2] + Math.cos(jibAngle) * RIG.jibLP];
  for (const [u, v] of [[0.25, 0.25], [0.5, 0.1], [0.1, 0.7]]) pts.push([jt[0] + (jh[0] - jt[0]) * v + (jc[0] - jt[0]) * u, jt[1] + (jh[1] - jt[1]) * v + (jc[1] - jt[1]) * u, jt[2] + (jh[2] - jt[2]) * v + (jc[2] - jt[2]) * u]);
  return pts;
}
// a hull-frame point to the world as the boat is drawn (v2/render/boat.js: T · Ry(−heading) · Rx(pitch) · Rz(−heel))
function toWorld(p, q) {
  let [x, y, z] = p;
  { const c = Math.cos(-q.heel), s = Math.sin(-q.heel); [x, y] = [c * x - s * y, s * x + c * y]; }
  { const c = Math.cos(q.pitch), s = Math.sin(q.pitch); [y, z] = [c * y - s * z, s * y + c * z]; }
  { const c = Math.cos(-q.heading), s = Math.sin(-q.heading); [x, z] = [c * x + s * z, -s * x + c * z]; }
  return [x + q.x, y + q.heave, z + q.z];
}

test('the proxy holds the boat: every sample of its hull, keel, rudder, mast and sails is inside, at any heel, pitch and heading', () => {
  assert.ok(boatShape().boxes.length >= 20);
  for (const q of [{ heel: 0, pitch: 0, heading: 0 }, { heel: 0.4, pitch: 0.05, heading: 1.2 }, { heel: -1.2, pitch: -0.08, heading: -2.5 }, { heel: 1.57, pitch: 0, heading: 3 }]) {
    const pose = { x: 12, z: -7, heave: 0.2, boomAngle: -0.5, jibAngle: -0.35, ...q };
    const C = createBoatClear().pose(pose);
    for (const p of boatSamples(pose.boomAngle, pose.jibAngle)) { const w = toWorld(p, pose); assert.ok(C.sdf(...w) <= 1e-6, `sample ${p.map((v) => v.toFixed(2))} at heel ${q.heel}: sdf ${C.sdf(...w).toFixed(3)}`); }
    // and it is not a fog: a point 1 m off the beam at the waterline amidships, and 1 m under the keel, are outside
    assert.ok(C.sdf(...toWorld([DEFAULT_DIMS.HULL.beam / 2 + 1, 0, 0], pose)) > 0.5);
    assert.ok(C.sdf(...toWorld([0, -DEFAULT_DIMS.HULL.draft - 1, 0], pose)) > 0.5);
  }
});

// the revenge on the real boat (as tessie-revenge.test.mjs's fail: the boat dithers, she catches it, the strike shoves it); every
// frame the referee measures her body against the boat as drawn (its pose: heave, heel, pitch, boom and jib)
function strikeRun({ seed = 2, kn = 7 } = {}) {
  const wind = { sample: () => ({ vx: 0, vz: kn * KN }) };
  const B = createBoatSim({ water: waterFor(() => 0), wind, start: { x: START.x, z: START.z, headingDeg: -80, speed: 1 }, flags: { knockdown: true } });
  const kd = []; B.onKnockdown = (e) => kd.push(e);
  const t = createTessie({ seed, depthAt: deep }), R = createRevenge({ sim: t, depthAt: deep });
  const s0 = B.state, fx = Math.sin(s0.heading), fz = -Math.cos(s0.heading);
  t.step(DT, { playing: true, boat: { x: s0.x, z: s0.z + 500, heading: 0, speed: 0 }, view: view({ x: s0.x, z: s0.z + 500, heading: 0 }) });
  t.ambush(s0.x + fx * 36 - fz * 20, s0.z + fz * 36 + fx * 20, s0.heading + Math.PI / 2); t.hunt(false);
  const S = { minGap: Infinity, minGapRoll: Infinity, strike: null, heelMax: 0, frames: 0, kd, subs: [] };
  let struckAt = null;
  for (let k = 0; k < 75 / DT; k++) {
    const T = k * DT, pre = T < 7;
    B.step(DT, { steer: 0, pull: 0 });
    if (!pre && !R.state.count) { const h = t.state.centre; B.state.heading = Math.atan2(h[0] - B.state.x, -(h[1] - B.state.z)); }
    const p = B.pose, bo = { x: B.state.x, z: B.state.z, heading: B.state.heading, speed: B.state.sog ?? 0, heel: p.heel, pitch: p.pitch, heave: p.heave, boomAngle: p.boomAngle, jibAngle: p.jibAngle };
    if (!pre && !R.state.count) bo.speed = 3;
    t.step(DT, { playing: true, boat: bo, view: view(bo) });
    if (!pre) R.step(DT, { boat: { ...bo, heel: B.state.heel }, playing: true });
    if (R.state.sub && S.subs[S.subs.length - 1] !== R.state.sub) S.subs.push(R.state.sub);
    for (const e of R.events) if (e.type === 'strike') { S.strike = e; struckAt = T; const P = B.phys.P; B.shove({ K: e.K * P.mass * 9.81 * P.gm }); }
    if (t.state.visible) {
      const g = gapOf(t, bo); S.minGap = Math.min(S.minGap, g); S.frames++;
      if (Math.abs(B.state.heel) > 30 * DEG) S.minGapRoll = Math.min(S.minGapRoll, g);
    }
    S.heelMax = Math.max(S.heelMax, Math.abs(B.state.heel) / DEG);
    if (struckAt != null && T > struckAt + 9) break;
  }
  return S;
}

test('the strike: her body never in the boat (0.15 m on every frame, through the knockdown roll); her back meets the keel and the bilge, the boat rolls away', () => {
  for (const [seed, kn] of [[2, 7], [1, 12], [3, 16]]) {
    const S = strikeRun({ seed, kn });
    assert.ok(S.strike, `caught (seed ${seed}, ${kn} kn)`);
    assert.deepEqual(S.subs, ['down', 'in', 'up'], 'down beside the hull, in under the bilge, up against the keel');
    assert.ok(S.strike.touch, 'the push comes when she touches');
    assert.ok(S.strike.clear >= M - 1e-6 && S.strike.clear <= M + 0.2, `the gap at the push ${S.strike.clear} m: touching, not through`);
    assert.ok(S.minGap >= M - 1e-6, `least gap ${S.minGap.toFixed(3)} m over ${S.frames} frames (seed ${seed}, ${kn} kn)`);
    assert.ok(Number.isFinite(S.minGapRoll) && S.minGapRoll >= M - 1e-6, `during the roll past 30°: ${S.minGapRoll.toFixed(3)} m`);
    assert.ok(S.heelMax > 55 && S.kd.length === 1, `knocked down: ${S.heelMax.toFixed(0)}°`);
  }
});

// a behaviour on a scripted boat sailing straight at u m/s (heeled `heel` rad), every frame measured by the referee
function behaveRun(kind, { u = 2, heel = -0.25, seed = 1, secs = 70 } = {}) {
  const t = createTessie({ seed, depthAt: deep }), H = createBehave({ sim: t, depthAt: deep });
  const b = { x: 0, z: 0, heading: 0.4, speed: u, heel, pitch: 0.02, heave: 0.1, boomAngle: 0.6, jibAngle: 0.35 };
  t.step(DT, { playing: true, boat: b, view: view(b) });
  const ok = H.start(kind, { boat: { ...b, vx: Math.sin(b.heading) * u, vz: -Math.cos(b.heading) * u }, view: view(b) });
  const S = { ok, minGap: Infinity, lats: [], alongS: 0, under: false, underClear: Infinity, outLat: null, phases: [], first: t.sightings.length, prev: null, jump: 0 };
  for (let k = 0; k < secs / DT; k++) {
    b.x += Math.sin(b.heading) * u * DT; b.z -= Math.cos(b.heading) * u * DT;
    t.step(DT, { playing: true, boat: { ...b }, view: view(b) });
    H.step(DT, { boat: { ...b } });
    if (S.phases[S.phases.length - 1] !== H.state.phase) { S.phases.push(H.state.phase); if (H.state.phase === 'away') S.outLat = Math.abs(H.state.lat); }
    if (!t.state.visible) break;
    S.minGap = Math.min(S.minGap, gapOf(t, b));
    if (H.state.phase === 'with') S.lats.push(H.state.lat);
    const sp = t.state.spine, fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
    for (let i = 0; i < sp.length / 8; i++) {
      const dx = sp[i * 8] - b.x, dz = sp[i * 8 + 2] - b.z, al = dx * fx + dz * fz, ac = dx * -fz + dz * fx;
      if (Math.abs(al) < 4.3 && Math.abs(ac) < 1.6) { S.under = true; S.underClear = Math.min(S.underClear, -DEFAULT_DIMS.HULL.draft - (sp[i * 8 + 1] + reachAt(i * t.L / 63, t.L))); }
    }
    // her nose never jumps (the hold bends her, it never teleports her)
    if (S.prev) S.jump = Math.max(S.jump, Math.hypot(sp[0] - S.prev[0], sp[1] - S.prev[1], sp[2] - S.prev[2]));
    S.prev = [sp[0], sp[1], sp[2]];
  }
  S.alongS = H.state.alongS;
  return S;
}

test('alongside: she rises abeam and swims beside the boat 25–40 m off at its speed for up to 20 s, then peels away; never within 0.15 m', () => {
  for (const u of [0, 1.5, 3]) {
    const S = behaveRun('alongside', { u });
    assert.ok(S.ok, 'started');
    assert.ok(S.alongS >= 15 && S.alongS <= BEHAVE.alongside.holdS + 0.1, `alongside ${S.alongS.toFixed(1)} s at ${u} m/s`);
    assert.ok(Math.min(...S.lats) >= 25 && Math.max(...S.lats) <= 40, `abeam ${Math.min(...S.lats)}–${Math.max(...S.lats)} m`);
    assert.ok(S.phases.includes('peel'), 'then she peels away and dives');
    assert.ok(S.minGap >= M, `least gap ${S.minGap.toFixed(2)} m`);
  }
  // a boat faster than she swims leaves her behind: she peels away early
  const fast = behaveRun('alongside', { u: 6 });
  assert.ok(fast.alongS < 15, `a 6 m/s boat: ${fast.alongS.toFixed(1)} s`);
});

test('under the hull: she crosses below the keel with room, comes up 30–50 m off the other side; never within 0.15 m, through any heel', () => {
  for (const [u, heel] of [[0, 0], [1.5, -0.3], [3, 0.35], [5, -0.2]]) {
    const S = behaveRun('under', { u, heel });
    assert.ok(S.ok, 'started');
    assert.ok(S.under, `she passes under the hull's footprint (u ${u})`);
    assert.ok(S.underClear >= M, `under the footprint every part of her is ${S.underClear.toFixed(2)} m below the keel`);
    assert.ok(S.phases.includes('cross') && S.phases.includes('out') && S.phases.includes('away'), S.phases.join('>'));
    assert.ok(S.outLat >= 30 && S.outLat <= 50, `up ${S.outLat} m off the other side`);
    assert.ok(S.minGap >= M, `least gap ${S.minGap.toFixed(2)} m`);
    assert.ok(S.jump < 0.4, `no jump: ${S.jump.toFixed(2)} m a frame`);
  }
});

test('a rise under the boat (her breach beside the hull, and right under it): the boat is solid, she bends round it', () => {
  for (const lat of [0, 2.5, -3]) {
    const t = createTessie({ seed: 4, depthAt: deep });
    const b = { x: 0, z: 0, heading: 0, speed: 0, heel: 0.2, pitch: 0, heave: 0, boomAngle: 0.3, jibAngle: 0.2 };
    t.step(DT, { playing: true, boat: b, view: view(b) });
    t.riseUnder(b.x + lat, b.z, { from: 40, heading: Math.PI / 2, speed: 3 });
    let minGap = Infinity, seen = 0;
    for (let k = 0; k < 40 / DT; k++) {
      t.step(DT, { playing: true, boat: b, view: view(b) });
      if (!t.state.visible) break;
      seen++; minGap = Math.min(minGap, gapOf(t, b));
    }
    assert.ok(seen > 100, 'she rose');
    assert.ok(minGap >= M, `lateral ${lat}: least gap ${minGap.toFixed(2)} m`);
  }
});

test('the boat rolling down onto her (a knockdown with her alongside the lee side): she is held outside, on every frame', () => {
  const t = createTessie({ seed: 5, depthAt: deep });
  const b = { x: 0, z: 0, heading: 0, speed: 0, heel: 0, pitch: 0, heave: 0, boomAngle: 1.0, jibAngle: 0.6 };
  t.step(DT, { playing: true, boat: b, view: view(b) });
  t.ambush(3.4, 20, 0, 0.5); t.behave(true);   // her nose ahead, her body along the starboard side, 3.4 m off the centreline
  t.swimTo(3.4, -200, 0.5);
  let minGap = Infinity;
  for (let k = 0; k < 14 / DT; k++) {
    const T = k * DT;
    b.heel = Math.min(1.45, Math.max(0, (T - 6) * 0.6));   // to starboard (onto her), 0 → 83° over 2.4 s
    t.step(DT, { playing: true, boat: { ...b }, view: view(b) });
    if (t.state.visible && T > 5) minGap = Math.min(minGap, gapOf(t, b));
  }
  assert.ok(minGap >= M, `least gap ${minGap.toFixed(2)} m`);
});

test('the rare moments: a flag forces one; the storm\'s neck and the sunset breach near her water, once a session; the opening is the plain sighting', () => {
  assert.equal(momentFlag('alongside'), 'alongside'); assert.equal(momentFlag('lightning'), 'neck'); assert.equal(momentFlag('nonsense'), null); assert.equal(momentFlag(null), null);
  assert.equal(pickMoment({ force: 'under', n: 0 }), 'under');
  assert.equal(pickMoment({ near: true, hour: 19.8, n: 0 }), 'breach', 'near sunset, her first appearance near her water');
  assert.equal(pickMoment({ near: true, hour: 19.8, n: 3, done: { breach: true } }) === 'breach', false, 'once a session');
  assert.equal(pickMoment({ near: false, hour: 19.8, n: 0 }), 'sighting', 'away from her water: no breach');
  assert.equal(pickMoment({ near: true, hour: 15, n: 0 }), 'sighting', 'not near sunset');
  assert.equal(pickMoment({ near: true, storm: true, hour: 15, n: 2 }), 'neck', 'a storm near her water');
  assert.notEqual(pickMoment({ near: true, storm: true, hour: 15, n: 2, done: { neck: true } }), 'neck');
  const later = new Set(); for (let n = 1; n < 40; n++) later.add(pickMoment({ n, seed: 3 }));
  for (const k of ['sighting', 'alongside', 'under']) assert.ok(later.has(k), `${k} among the later ones`);
  assert.equal(pickMoment({ n: 5, seed: 3 }), pickMoment({ n: 5, seed: 3 }), 'seeded');
  assert.ok(neckReady(12) && !neckReady(5) && !neckReady(30) && !neckReady(null));
  assert.equal(MOMENTS.sunset[0] <= 20.5 && MOMENTS.sunset[1] >= 20.5, true);
});

test('the lightning neck: placed in view, her neck up when the flash comes, gone soon after; the sunset breach breaks the water', () => {
  const b = { x: 0, z: 0, heading: 0.3, speed: 1.5 };
  for (const flashIn of [10, 13, 16]) {
    const t = createTessie({ seed: 2, depthAt: deep });
    t.step(DT, { playing: true, boat: b, view: view(b) });
    t.cue({ kind: 'neck', flashAt: t.playT + flashIn });
    let headAt = null, maxHead = -9, goneAt = null;
    for (let k = 0; k < 60 / DT; k++) {
      t.step(DT, { playing: true, boat: b, view: view(b) });
      const T = (k + 1) * DT;
      if (t.state.visible) maxHead = Math.max(maxHead, t.state.spine[1]);
      if (headAt == null && T >= flashIn) headAt = t.state.spine[1];
      if (goneAt == null && T > flashIn && !t.state.visible) goneAt = T;
    }
    assert.equal(t.sightings[0].kind, 'neck');
    assert.ok(t.sightings[0].inView !== false, 'in view');
    assert.ok(headAt > 1.5, `her head ${headAt.toFixed(2)} m up at the flash (${flashIn} s)`);
    assert.ok(goneAt != null && goneAt - flashIn < 20, `gone ${goneAt && (goneAt - flashIn).toFixed(1)} s after it`);
  }
  const t = createTessie({ seed: 2, depthAt: deep });
  t.step(DT, { playing: true, boat: b, view: view(b) });
  t.cue({ kind: 'breach' });
  let breach = false, top = -9;
  for (let k = 0; k < 20 / DT; k++) { t.step(DT, { playing: true, boat: b, view: view(b) }); if (t.state.phase === 'breach') breach = true; if (t.state.visible) top = Math.max(top, t.state.spine[1]); }
  assert.equal(t.sightings[0].kind, 'breach');
  assert.ok(breach && top > 4, `the breach: her head ${top.toFixed(1)} m up`);
});

test('the lightning neck waits for a flash (the act holds up to NECK.waitS); the act hands the kind to the plug-in', () => {
  const calls = [];
  const sim = { sightings: [], state: { visible: false }, cue: () => calls.push('cue'), cancel: () => calls.push('cancel'), play: () => {} };
  const T = { sim, moment: () => 'neck', begin: (k) => calls.push(`begin:${k}`), cancelMoment: () => calls.push('cancelMoment') };
  const h = tessieStart({ tessie: T });
  assert.deepEqual(calls, ['begin:neck']);
  for (let k = 0; k < (PLACE_S + 5) / DT; k++) h.step(DT);
  assert.equal(h.result, undefined, 'still waiting for its flash past PLACE_S');
  for (let k = 0; k < (NECK.waitS + 1) / DT; k++) h.step(DT);
  assert.equal(h.result, 'skipped');
  assert.ok(calls.includes('cancelMoment'));
});

test('the night wake glow: none by day, all of it in the dark, eased between; a flag forces it', () => {
  assert.equal(glowShare(0.5), 0); assert.equal(glowShare(-0.01), 0);
  assert.equal(glowShare(-0.2), 1);
  const mid = glowShare(-0.08); assert.ok(mid > 0.2 && mid < 0.8);
  assert.equal(glowShare(0.5, true), 1);
});

test('Cruise\'s camera cut: it turns to her at most 15°/s, eased (no sharp start or stop), holds a few seconds, then returns', () => {
  const K = createCamCut(), ang = 40 * DEG;
  let prevYaw = 0, prevRate = 0, maxRate = 0, maxAcc = 0, held = 0, back = null, T = 0;
  for (let k = 0; k < 30 / DT; k++) {
    T = k * DT;
    const yaw = K.step(DT, { cue: k === 0, angle: ang });
    const rate = (yaw - prevYaw) / DT;
    maxRate = Math.max(maxRate, Math.abs(rate)); maxAcc = Math.max(maxAcc, Math.abs(rate - prevRate) / DT);
    if (K.state.phase === 'hold') held += DT;
    if (back == null && K.state.phase === 'idle' && k > 10) back = T;
    prevYaw = yaw; prevRate = rate;
  }
  assert.ok(maxRate <= CAMCUT.rateDeg * DEG + 1e-6, `${(maxRate / DEG).toFixed(2)}°/s`);
  assert.ok(maxAcc <= CAMCUT.accDeg * DEG * 1.05 + 1e-6, `eased: ${(maxAcc / DEG).toFixed(1)}°/s²`);
  assert.ok(held >= CAMCUT.holdS - 0.05, `held ${held.toFixed(1)} s on her`);
  assert.ok(back != null && Math.abs(K.state.yaw) < 1e-4, 'back on the shot');
  assert.equal(K.state.cuts, 1);
  // the player's look sends it back at once, gently; a sighting already in the middle of the shot is not cut to
  const K2 = createCamCut(); for (let k = 0; k < 2 / DT; k++) K2.step(DT, { cue: k === 0, angle: ang });
  K2.step(DT, { angle: ang, input: true }); assert.equal(K2.state.phase, 'back');
  const K3 = createCamCut(); K3.step(DT, { cue: true, angle: 2 * DEG }); assert.equal(K3.state.phase, 'idle');
});
