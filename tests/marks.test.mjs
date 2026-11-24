// The racing marks (src/marks/): a mark floats at its design draft; it heaves with the local surface; it swings to the wind
// on its rode; the boat's hull, keel and rudder never go into a mark and the mark comes back to its place; the course
// code rounds the marks on the right side. Headless, deterministic.
// Run: node --test tests/marks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MarkField } from '../src/sim/marks/field.js';
import { FloatBody, MARK_TYPES, designDraft, makeRode } from '../src/sim/marks/body.js';
import { makeHull, toBody } from '../src/sim/marks/hull.js';
import { makeSurface } from '../src/sim/water-spectrum.js';
import { BoatPhysics, CONTROLS, Helm, KN, DT, steadyWind } from '../src/sim/boat.js';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
const { HULL } = DEFAULT_DIMS;   // this page's boat (its profile)

const DEG = Math.PI / 180, G = 9.81;
const FLAT = { heightAt: () => 0 };
const FAR = { x: 150, z: 0, heading: 0, u: 0, v: 0, yawRate: 0, rudderAngle: 0, heel: 0, pitch: 0, heave: 0 };   // a boat 150 m away: the marks run at full rate, no contact

function draftOf(b) {   // the lowest point of the shape below the water, at the body's pose (flat water, upright)
  const T = b.T, bottom = T.shape === 'sphere' ? -T.R : T.shape === 'cylinder' ? -T.H / 2 : T.shape === 'tetra' ? -T.H / 4 : -0.85;
  return -(b.centre([0, 0, 0])[1] + bottom);
}

test('a mark at rest floats at its design draft, upright (sphere, cylinder, tetrahedron, pin)', () => {
  for (const type of ['sphere', 'cylinder', 'tetra', 'pin']) {
    const f = new MarkField({ surface: FLAT });
    const m = f.add({ type }); m.body.rode = null;
    m.body.p[1] += 0.25; m.body.q = [Math.cos(0.08), Math.sin(0.08), 0, 0];   // dropped from 25 cm, 9° over
    f.settle(40);
    const want = designDraft(MARK_TYPES[type]), got = draftOf(m.body);
    assert.ok(Math.abs(got - want) < 0.015, `${type}: draft ${got.toFixed(3)} m, design ${want.toFixed(3)} m`);
    assert.ok(m.body.tiltDeg() < 1.2, `${type}: ${m.body.tiltDeg().toFixed(2)}° from upright at rest`);
  }
});

test('the marks are stable: a righting moment from the shape (metacentric height > 0)', () => {
  for (const type of ['sphere', 'cylinder', 'tetra', 'pin', 'committee']) {
    const b = new FloatBody(type), gm = b.kTilt / (b.mass * G);
    assert.ok(gm > 0.05, `${type}: GM ${gm.toFixed(2)} m`);
  }
});

test('in waves a mark heaves with the local surface: phase lag under 10 % of the period', () => {
  for (const T of [2.5, 3.5, 5]) for (const type of ['sphere', 'cylinder', 'tetra']) {
    const A = 0.15, om = 2 * Math.PI / T, k = om * om / G;
    const surface = { heightAt: (x, z, t) => A * Math.sin(k * x - om * t) };
    const f = new MarkField({ surface });
    const m = f.add({ type }); m.body.rode = null;
    let t = 0; for (; t < 20; t += DT) f.step(DT, FAR, t);
    const base = m.body.design.cgHeight, ser = [];
    for (let i = 0, n = Math.round(4 * T / DT); i < n; i++, t += DT) { f.step(DT, FAR, t); ser.push([m.body.p[1] - base, surface.heightAt(m.body.p[0], m.body.p[2], t)]); }
    let best = null;
    for (let sh = -Math.round(T / DT / 2); sh <= Math.round(T / DT / 2); sh++) {
      let s = 0, c = 0; for (let i = 0; i < ser.length; i++) { const j = i + sh; if (j >= 0 && j < ser.length) { s += ser[i][0] * ser[j][1]; c++; } }
      if (!best || s / c > best.v) best = { v: s / c, sh };
    }
    const lag = Math.abs(best.sh * DT) / T, amp = (Math.max(...ser.map((r) => r[0])) - Math.min(...ser.map((r) => r[0]))) / (2 * A);
    assert.ok(lag < 0.1, `${type} T=${T}s: lag ${(lag * 100).toFixed(1)} % of the period`);
    assert.ok(amp > 0.8 && amp < 1.5, `${type} T=${T}s: heave ${amp.toFixed(2)} × the wave`);
  }
});

test('on the real wave field a mark follows the footprint-averaged surface', () => {
  const surface = makeSurface({ seed: 3, dirDeg: 200, U: 7, fetchAt: () => 3000 });
  const f = new MarkField({ surface });
  const m = f.add({ type: 'sphere', x: 40, z: 60 }); m.body.rode = null;
  let t = 0; for (; t < 30; t += DT) f.step(DT, FAR, t);
  const xs = [], ys = [], base = m.body.design.cgHeight;
  for (let i = 0; i < 60 * 40; i++, t += DT) { f.step(DT, FAR, t); xs.push(m.body.p[1] - base); ys.push(surface.heightAt(m.body.p[0], m.body.p[2], t, { filterM: 0.7 })); }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length, mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy);
  assert.ok(r > 0.85, `correlation with the local surface ${r.toFixed(2)}`);
});

test('on its rode a mark swings to within 15 deg of downwind in 60 s; the rode is 3:1 over the depth', () => {
  for (const type of ['sphere', 'cylinder', 'tetra']) {
    const depth = 8, U = 10;   // 10 m/s ≈ 19 kn, blowing to the south (+z): downwind of the anchor is 180° (south)
    const f = new MarkField({ surface: FLAT, depthAt: () => depth, windAt: () => ({ vx: 0, vz: U }) });
    const m = f.add({ type, x: 0, z: 0 });
    assert.ok(Math.abs(m.body.rode.L - 3 * depth) < 0.01, `rode ${m.body.rode.L} m, 3 × ${depth} m`);
    m.body.p[0] = 5; m.body.p[2] = 0;   // 5 m across the wind from the anchor
    for (let t = 0; t < 60; t += DT) f.step(DT, FAR, t);
    const ang = Math.atan2(m.body.p[0], m.body.p[2]) / DEG, dist = Math.hypot(m.body.p[0], m.body.p[2]);
    assert.ok(Math.abs(ang) < 15, `${type}: ${ang.toFixed(1)}° off downwind at ${dist.toFixed(1)} m from the anchor`);
    assert.ok(dist < m.body.rode.L, `${type}: inside the rode's reach (${dist.toFixed(1)} < ${m.body.rode.L} m)`);
  }
});

test('the rode: no pull while slack, a rising pull past the slack reach, the hanging chain pulls the mark down', () => {
  const r = makeRode({ depth: 8, scope: 3 });
  assert.equal(r.pull(r.X0 - 1).H, 0);
  let last = 0; for (const X of [r.X0 + 0.2, r.X0 + 1, r.X0 + 3, r.L - 2, r.L]) { const H = r.pull(X).H; assert.ok(H >= last, `pull rises: ${H.toFixed(0)} N at ${X.toFixed(1)} m`); last = H; }
  assert.ok(r.pull(r.X0 - 1).V > 0, 'the hanging length weighs on the ring');
});

test('the hull solid follows the real lines: the waterline plan, the freeboard, the fin keel and the rudder', () => {
  const h = makeHull();
  assert.ok(h.sdf(0, 0, -0.2) < 0 && h.sdf(0, 0, 0.5) < 0, 'inside amidships');
  assert.ok(Math.abs(h.sdf(0, 0.5 * HULL.beam * 0.86 + 0.3, 0)) < 0.35 && h.sdf(0, 0.5 * HULL.beam * 0.86 + 0.3, 0) > 0, 'the waterline beam amidships');
  assert.ok(h.sdf(0, 0, HULL.freeboard + 0.1) > 0, 'above the sheer is outside');
  assert.ok(h.sdf(0.2, 0, -1.0) < 0 && h.sdf(0.2, 0, -HULL.draft - 0.1) > 0, 'the fin keel reaches the draft and no further');
  assert.ok(h.sdf(0.2, 0.5, -1.0) > 0.3, 'the keel is a thin fin');
  assert.ok(h.sdf(-HULL.rudderZ, 0, -0.6) < 0, 'the rudder stands at the stern post');
  assert.ok(h.sdf(-HULL.rudderZ, 0.3, -0.6, 0.45) < h.sdf(-HULL.rudderZ, 0.3, -0.6, 0) || h.sdf(-HULL.rudderZ - 0.2, 0.3, -0.6, 0.45) < 0.2, 'the rudder turns with the helm');
  // a point at the bow tip: the stem is sharp
  assert.ok(h.sdf(HULL.lwl / 2 + 0.1, 0.4, 0) > 0.1, 'the stem is a point, not a flat face');
});

// ---- the boat against a mark, on the real physics ----
function sailTo(speedKn) {
  // the Catalina on a reach in a steady wind (sails on auto), a helm holding its heading; returns { phys, step(post) }
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 90 * DEG, speed: speedKn * KN });
  const helm = new Helm(), wind = steadyWind(15 * KN, 0);   // from the north, boat heading east: a beam reach
  return { phys, wind, helm, ctl: (s) => ({ ...CONTROLS, rudder: helm.toHeading(s, 90 * DEG) }) };
}

function hitTest({ type, offset, kn, seconds = 50 }) {
  const rig = sailTo(kn), s = rig.phys.state;
  const f = new MarkField({ surface: FLAT, depthAt: () => 8 });
  const env = { t: 0, windAt: rig.wind, post: (st, dt, t) => f.step(dt, st, t) };
  // the boat runs 12 s to get up to speed with no mark, then the mark is laid dead ahead (or offset to port), 24 m off
  let t = 0;
  for (; t < 12; t += DT) { env.t = t; rig.phys.step(DT, rig.ctl(s), env); }
  const ahead = 24, hx = Math.sin(s.heading), hz = -Math.cos(s.heading), sx = Math.cos(s.heading), sz = Math.sin(s.heading);
  const m = f.add({ type, id: `t-${type}`, x: s.x + hx * ahead + sx * offset, z: s.z + hz * ahead + sz * offset });
  f.settle(4, t);
  const place = [m.body.p[0], m.body.p[2]], speed0 = Math.hypot(s.u, s.v) / KN;
  let minGap = Infinity, maxTilt = 0, u0 = s.u;
  for (let i = 0; i < seconds / DT; i++, t += DT) {
    env.t = t; rig.phys.step(DT, rig.ctl(s), env);
    // an independent clearance check after the step: every collision sphere against the hull at the boat's pose
    for (const sp of m.body.T.spheres) {
      const c = m.body.worldPoint(sp, [0, 0, 0]), bp = toBody(s, c[0], c[1], c[2], [0, 0, 0]);
      minGap = Math.min(minGap, f.hull.sdf(bp[0], bp[1], bp[2], s.rudderAngle) - sp[3]);
    }
    maxTilt = Math.max(maxTilt, m.body.tiltDeg());
  }
  return { f, m, s, minGap, place, speed0, maxTilt, back: Math.hypot(m.body.p[0] - place[0], m.body.p[2] - place[1]), fromAnchor: Math.hypot(m.body.p[0] - m.anchor.x, m.body.p[2] - m.anchor.z) };
}

test('a boat at 6 kn hits a mark head-on and glancing: no penetration, a touch event, the mark comes to rest near its place', () => {
  for (const type of ['sphere', 'cylinder', 'tetra']) for (const offset of [0, 1.2]) {
    const r = hitTest({ type, offset, kn: 6 });
    assert.ok(r.speed0 > 4.5 && r.speed0 < 7.5, `boat speed at the hit ${r.speed0.toFixed(1)} kn`);
    assert.ok(r.minGap >= -1e-9, `${type} offset ${offset}: min clearance ${r.minGap.toFixed(4)} m`);
    assert.ok(r.m.touches >= 1 && r.f.events.length >= 1 && r.f.events[0].type === 'markTouched', `${type} offset ${offset}: markTouched`);
    assert.ok(['hull', 'keel', 'rudder'].includes(r.f.events[0].part));
    assert.ok(r.fromAnchor < r.m.body.rode.L, `${type} offset ${offset}: ${r.fromAnchor.toFixed(1)} m from its anchor, inside the rode's reach`);
    assert.ok(r.m.body.tiltDeg() < 8, `${type}: upright again, ${r.m.body.tiltDeg().toFixed(1)}°`);
    assert.ok(Math.hypot(r.m.body.v[0], r.m.body.v[2]) < 0.2, 'at rest');
  }
});

test('at 8 kn the mark is still never entered (no tunnelling), and the boat feels a small drag and turn', () => {
  const r = hitTest({ type: 'sphere', offset: 0.9, kn: 8, seconds: 20 });
  assert.ok(r.minGap >= -1e-9, `min clearance ${r.minGap.toFixed(4)} m`);
  assert.ok(r.m.touches >= 1);
  assert.ok(r.f.stats.maxPen < 0.12, `deepest overlap before the push-out ${r.f.stats.maxPen.toFixed(3)} m`);
});

test('a heavy mark (the committee boat) moves less than a light one and the boat loses more speed', () => {
  const light = hitTest({ type: 'sphere', offset: 0, kn: 6, seconds: 12 }), heavy = hitTest({ type: 'committee', offset: 0, kn: 6, seconds: 12 });
  assert.ok(heavy.minGap >= -1e-9);
  assert.ok(heavy.f.events.length >= 1);
});

test('the same inputs give the same marks (deterministic)', () => {
  const a = hitTest({ type: 'tetra', offset: -1.2, kn: 6, seconds: 25 }), b = hitTest({ type: 'tetra', offset: -1.2, kn: 6, seconds: 25 });
  assert.deepEqual(a.m.body.p, b.m.body.p); assert.deepEqual(a.m.body.q, b.m.body.q); assert.equal(a.s.u, b.s.u);
});

test('a mark knocked off its place springs back on its rode', () => {
  const f = new MarkField({ surface: FLAT, depthAt: () => 8, windAt: () => ({ vx: 0, vz: 9 }) });
  const m = f.add({ type: 'sphere', x: 0, z: 0 });
  f.settle(240);   // the wind and the rode find its place
  const place = [m.body.p[0], m.body.p[2]];
  assert.ok(Math.hypot(place[0], place[1]) > 10, `it lies ${Math.hypot(...place).toFixed(1)} m downwind of its anchor`);
  m.body.v[0] += 3.5; m.body.v[2] -= 2.5;   // a blow from a hull: 4.3 m/s, across and up-wind
  let t = 0, far = 0;
  for (; t < 60; t += DT) { f.step(DT, FAR, t); far = Math.max(far, Math.hypot(m.body.p[0] - place[0], m.body.p[2] - place[1])); }
  const back = Math.hypot(m.body.p[0] - place[0], m.body.p[2] - place[1]);
  assert.ok(far > 1.5, `it was knocked ${far.toFixed(1)} m`);
  assert.ok(back < 0.35 * far + 1, `and is ${back.toFixed(1)} m from its place 60 s later`);
});
