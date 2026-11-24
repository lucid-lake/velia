// The ground tackle seen close (owner, 2026-11-18: "The anchor line is too thin to be noticed, and too simple, missing details ...
// These details are desktop only"): the chain's catenary (its length, its ends at the roller and the shackle, its sag against the
// pull as she falls back), where the anchor is through stow, drop, hold and weigh, the links that run with the chain, the meshes'
// budget, and the policy (a desktop and a tablet draw it; a phone keeps its plain anchor and line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GEAR, rodeShape, rodeAt, rodeSag, rodePullN, rodePath, gearPose, layLinks } from '../sim/anchorGear.js';
import { linkMesh, anchorMesh, windlassMesh } from '../render/anchorGearMesh.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';

const lengthOf = (S, n = 4000) => { let len = 0, p = rodeAt(S, 0, [0, 0, 0]); const q = [0, 0, 0]; for (let i = 1; i <= n; i++) { rodeAt(S, S.L * i / n, q); len += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); p = q.slice(); } return len; };
// 10 m of water and the roller 0.9 m up, 3 : 1: 32.7 m of chain
const h = 10.9, L = 32.7;

test('the catenary: its length is the chain out and its ends are the roller and the shackle, in every shape', () => {
  for (const X of [3, 15, 22, 26, 29, 30.5]) {
    const S = rodeShape({ h, X, L });
    assert.ok(['slack', 'touch', 'lifted'].includes(S.kind), `${X} m: ${S.kind}`);
    const a = rodeAt(S, 0), b = rodeAt(S, L);
    assert.ok(Math.abs(a[0]) < 1e-6 && Math.abs(a[1] - h) < 1e-6, `${X} m: from the roller (${a})`);
    assert.ok(Math.abs(b[0] - X) < 1e-3 && Math.abs(b[1]) < 1e-3 && Math.abs(b[2]) < 1e-3, `${X} m: to the shackle (${b})`);
    assert.ok(Math.abs(lengthOf(S) - L) < 0.03 * (S.kind === 'slack' ? 3 : 1), `${X} m: ${lengthOf(S).toFixed(3)} m long, want ${L}`);
    // never under the bottom, never over the roller
    for (let i = 0; i <= 50; i++) { const p = rodeAt(S, L * i / 50); assert.ok(p[1] >= -1e-6 && p[1] <= h + 1e-6, `${X} m: in the water column at ${i}`); }
  }
  // the kinds: lying over it, touching down, all of it lifted, and straight past its length (the nylon's stretch)
  assert.equal(rodeShape({ h, X: 5, L }).kind, 'slack');
  assert.equal(rodeShape({ h, X: 25, L }).kind, 'touch');
  assert.equal(rodeShape({ h, X: 30.5, L }).kind, 'lifted');
  assert.equal(rodeShape({ h, X: 33, L }).kind, 'taut');
  assert.equal(rodeShape({ h, X: 0, L: 4 }).kind, 'hang');
});

test('the sag answers the pull: as she falls back on it the chain straightens and the pull rises; she swings, it follows', () => {
  const w = 0.6 * 9.81 * 0.4;
  let lastSag = Infinity, lastPull = -1;
  for (const X of [22, 25, 27, 28.5, 29.5, 30.2, 30.8, 31.2]) {
    const S = rodeShape({ h, X, L }), sag = rodeSag(S), H = rodePullN(S, w);
    assert.ok(sag < lastSag, `${X} m: sag ${sag.toFixed(3)} m < ${lastSag.toFixed(3)}`);
    assert.ok(H > lastPull, `${X} m: pull ${H.toFixed(0)} N > ${lastPull.toFixed(0)}`);
    lastSag = sag; lastPull = H;
  }
  // the touchdown moves toward the anchor as the pull rises (less chain on the bottom)
  assert.ok(rodeShape({ h, X: 28, L }).bottom < rodeShape({ h, X: 24, L }).bottom);
  // in the world: her bow swung 30° about the anchor, the chain's ends still the roller and the shackle
  const shackle = [100, -10, 50], bottomY = -10;
  for (const deg of [0, 30, -45]) {
    const a = deg * Math.PI / 180, roller = [shackle[0] - Math.sin(a) * 26, 0.9, shackle[2] + Math.cos(a) * 26];
    const X = Math.hypot(shackle[0] - roller[0], shackle[2] - roller[2]), ux = (shackle[0] - roller[0]) / X, uz = (shackle[2] - roller[2]) / X;
    const path = rodePath(rodeShape({ h: roller[1] - bottomY, X, L }), roller, ux, uz, bottomY), o = [0, 0, 0];
    path(0, o); assert.ok(Math.hypot(o[0] - roller[0], o[1] - roller[1], o[2] - roller[2]) < 1e-6, `${deg}°: at the roller`);
    path(L, o); assert.ok(Math.hypot(o[0] - shackle[0], o[1] - shackle[1], o[2] - shackle[2]) < 2e-3, `${deg}°: at the shackle`);
  }
});

test('the anchor: on the roller stowed, sliding over it, hanging as it falls, on its side on the bottom until it sets, then dug in; the same back up', () => {
  const roller = [0, 1.17, -4.5], bottomY = -10, anchorXZ = [0.5, -30], o = {};
  const at = (phase, out, set = 0) => gearPose({ phase, out, roller, bottomY, anchorXZ, heading: 0, set, t: 1 }, o);
  assert.equal(at('stowed', 0).where, 'roller');
  assert.equal(at('falling', 0.2).where, 'slide'); assert.ok(o.slide > 0.3 && o.slide < 0.5);
  at('falling', 5);
  assert.equal(o.where, 'hang'); assert.ok(Math.abs(o.shackle[1] - (roller[1] - (5 - GEAR.slideM))) < 1e-9, 'it hangs on the chain out');
  assert.ok(Math.abs(o.shackle[0] - roller[0]) < 1e-9 && Math.abs(o.shackle[2] - roller[2]) < 1e-9, 'under the roller');
  at('falling', 40); assert.ok(o.shackle[1] >= bottomY + GEAR.anchorLen - 1e-9, 'never through the bottom');
  at('down', 20, 0);
  assert.equal(o.where, 'bottom'); assert.deepEqual([o.shackle[0], o.shackle[2]], anchorXZ);
  assert.ok(o.shackle[1] > bottomY && o.shackle[1] - bottomY < GEAR.toeY + 0.05, `on the bed, its toe in it (shackle ${(o.shackle[1] - bottomY).toFixed(2)} m up)`);
  assert.ok(o.roll > 1, `on its side before it sets (${o.roll.toFixed(2)} rad)`); assert.equal(o.bury, 0);
  // the shank points away from the boat (the chain pulls the shackle toward her): the anchor is 25 m ahead (−z), the yaw 0
  assert.ok(Math.abs(Math.sin(o.yaw)) < 0.05 && Math.cos(o.yaw) > 0.99, `its shank points away from her (${o.yaw.toFixed(3)})`);
  at('held', 32.7, 1);
  assert.equal(o.roll, GEAR.setRoll, 'righted once set'); assert.equal(o.bury, GEAR.bury, 'dug in');
  assert.ok(o.shackle[1] - o.bury - GEAR.toeY * Math.cos(o.roll) < bottomY, 'the toe under the bed\'s surface once set');
  assert.equal(at('weighing', 15, 1).where, 'bottom', 'on the bottom until it breaks out');
  assert.equal(at('up', 8).where, 'hang', 'broken out: hanging, coming up');
  assert.equal(at('up', 0.3).where, 'slide', 'home over the roller');
  assert.equal(at('stowed', 0).where, 'roller');
});

test('the links: about one a pitch along the chain near the eye, every other turned 90°, running with the chain out; none far away', () => {
  const roller = [0, 1.17, 0], bottomY = -10, X = 26, S = rodeShape({ h: roller[1] - bottomY, X, L }), path = rodePath(S, roller, 0, -1, bottomY);
  const buf = new Float32Array(GEAR.maxLinks * 12);
  const n = layLinks({ L, path, eye: [0, 5, 10], out: L, nearM: 1e6 }, buf);
  assert.ok(Math.abs(n - Math.floor(L / GEAR.pitch) - 1) <= 1, `${n} links for ${L} m`);
  // neighbours: their across axes at right angles (the chain's alternate links)
  for (const k of [0, 10, 400]) { const a = k * 12, b = (k + 1) * 12; const d = buf[a + 8] * buf[b + 8] + buf[a + 9] * buf[b + 9] + buf[a + 10] * buf[b + 10]; assert.ok(Math.abs(d) < 0.05, `links ${k}, ${k + 1} at 90° (${d.toFixed(3)})`); }
  // the first link at the shackle, the spacing a pitch
  const d01 = Math.hypot(buf[0] - buf[12], buf[1] - buf[13], buf[2] - buf[14]);
  assert.ok(Math.abs(d01 - GEAR.pitch) < 0.002, `a pitch apart: ${d01.toFixed(4)} m`);
  // the chain running out 0.013 m (half a pitch): the link that was nearest the roller moved half a pitch along
  const near = (buf2, m) => { let best = 1e9, i0 = -1; for (let i = 0; i < m; i++) { const dd = Math.hypot(buf2[i * 12] - roller[0], buf2[i * 12 + 1] - roller[1], buf2[i * 12 + 2] - roller[2]); if (dd < best) { best = dd; i0 = i; } } return best; };
  const S2 = rodeShape({ h: roller[1] - bottomY, X, L: L + 0.013 }), b2 = new Float32Array(GEAR.maxLinks * 12);
  const n2 = layLinks({ L: L + 0.013, path: rodePath(S2, roller, 0, -1, bottomY), eye: [0, 5, 10], out: L + 0.013, nearM: 1e6 }, b2);
  assert.ok(Math.abs(near(buf, n) - near(b2, n2)) > 0.008, 'the links slide over the roller as the chain runs');
  // the LOD: the eye 200 m off, no links; 16 m round the eye at the bow, only the near part
  assert.equal(layLinks({ L, path, eye: [0, 5, 300], out: L }, buf), 0);
  const nNear = layLinks({ L, path, eye: [0, 3, 6], out: L }, buf);
  assert.ok(nNear > 100 && nNear < n, `near the eye only: ${nNear} of ${n}`);
  // wet: a link in the water is wet, one on the roller dry
  layLinks({ L, path, eye: [0, 5, 10], out: L, nearM: 1e6 }, buf);
  assert.equal(buf[7], 1, 'the shackle\'s link (on the bottom) wet');
});

test('the meshes: a real anchor, a link and a windlass in a small budget', () => {
  const l = linkMesh(), a = anchorMesh(), w = windlassMesh();
  assert.ok(l.triangles <= 200, `a link: ${l.triangles} triangles`);
  assert.ok(a.triangles >= 200 && a.triangles <= 1500, `the anchor: ${a.triangles}`);
  assert.ok(w.triangles <= 1200, `the windlass: ${w.triangles}`);
  // the link's size: 10 mm wire, about 50 × 35 mm outside
  let mx = [0, 0, 0]; for (let i = 0; i < l.position.length; i += 3) for (let c = 0; c < 3; c++) mx[c] = Math.max(mx[c], Math.abs(l.position[i + c]));
  assert.ok(Math.abs(2 * mx[0] - GEAR.linkL) < 0.002 && Math.abs(2 * mx[1] - GEAR.linkW) < 0.002 && Math.abs(2 * mx[2] - GEAR.wire) < 0.002, `link ${mx.map((x) => (2 * x * 1000).toFixed(1)).join(' × ')} mm`);
  // the anchor: about 0.62 m from the shackle to the toe, about 0.3 m across the fluke
  let lo = [9, 9, 9], hi = [-9, -9, -9]; for (let i = 0; i < a.position.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], a.position[i + c]); hi[c] = Math.max(hi[c], a.position[i + c]); }
  assert.ok(hi[0] - lo[0] > 0.28 && hi[0] - lo[0] < 0.4, `fluke ${(hi[0] - lo[0]).toFixed(2)} m across`);
  assert.ok(hi[2] - lo[2] > 0.6 && hi[2] - lo[2] < 0.8, `${(hi[2] - lo[2]).toFixed(2)} m long`);
});

// the policy: a desktop and a tablet draw it, a phone never (src/core/features.js anchorDetail)
const fakeProfile = (win) => ({ get: () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu: 1 }), on: () => () => {} });
const tierOn = (dev, flags = {}, headless = false) => createFeatures({ profile: fakeProfile({ ...DEVICES[dev], location: { search: '' } }), doc: null }).configure({ headless, flags }).feature('anchorDetail');
test('desktop and tablet only: a phone keeps its plain anchor and line; ?anchordetail= overrides', () => {
  const want = { desktop: 'on', smallDesktop: 'on', touchLaptop: 'on', ipadTrackpad: 'on', iphoneTurned: 'off', androidSideways: 'off' };
  for (const [dev, t] of Object.entries(want)) { const f = tierOn(dev); assert.equal(f.tier, t, dev); assert.equal(f.fixed, true); }
  assert.equal(tierOn('desktop', { anchordetail: '0' }).tier, 'off');
  assert.equal(tierOn('iphoneTurned', { anchordetail: '1' }).tier, 'on');
  assert.equal(tierOn('desktop', {}, true).tier, 'on', 'a capture draws it');
});

// the bow camera frames it (sea.hang: the gear drawn close): near the roller on her own side, the aim at the water by the bow, the turn
// still at most 15°/s, following her as she backs down and swings (no lag of metres)
test('the bow camera close in: the eye about 5 m from the roller, aimed at the bow\'s water, at most 15°/s, with her as she backs down', async () => {
  const { createBoatSim, waterFor, KN } = await import('../sim/boat.js');
  const { createSeamanship, ANCHORING, hullToWorld } = await import('../sim/seamanship.js');
  const { steadyWind } = await import('../../src/sim/boat.js');
  const { DEFAULT_DIMS } = await import('../../src/sim/boat/dims.js');
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -9, wind: { sample: (px, pz, t) => steadyWind(10 * KN, 0)(px, pz, t) }, start: { x: 0, z: 0, headingDeg: 90, speed: 2.6 } });
  const sea = createSeamanship({ B, depthAt: () => 9, timeScale: 1 });
  B.sea = sea; sea.hang = true; B.viewOf = () => 'follow';
  sea.actions.anchor();
  const follow = (s) => { const fx = Math.sin(s.heading), fz = -Math.cos(s.heading); return { pos: [s.x - fx * 14, 4, s.z - fz * 14], target: [s.x + fx * 10, 1, s.z + fz * 10], fov: 50, near: 0.5 }; };
  const dir = (q) => { const d = [q.target[0] - q.pos[0], q.target[1] - q.pos[1], q.target[2] - q.pos[2]], n = Math.hypot(...d); return d.map((v) => v / n); };
  const dt = 1 / 60; let prev = null, maxRate = 0, worst = 0, held = 0;
  for (let i = 0; i < 40 * 60; i++) {
    B.step(dt, { steer: 0, pull: 0 }, dt);
    const c = sea.camera(dt, follow(B.state)), d = dir(c);
    if (prev) maxRate = Math.max(maxRate, Math.acos(Math.min(1, prev[0] * d[0] + prev[1] * d[1] + prev[2] * d[2])) * 180 / Math.PI / dt);
    prev = d;
    if (i > 12 * 60 && sea.bowLook) {   // eased in: the eye near the roller and aimed by the bow
      const R = hullToWorld(B.pose, DEFAULT_DIMS.HULL.anchorRoller);
      const eyeD = Math.hypot(c.pos[0] - R[0], c.pos[2] - R[2]), aimD = Math.hypot(c.target[0] - R[0], c.target[2] - R[2]);
      worst = Math.max(worst, Math.abs(eyeD - ANCHORING.bow.near.dist), aimD); held++;
    }
  }
  assert.ok(held > 60, 'the bow look held');
  assert.ok(maxRate <= ANCHORING.bow.maxDegS, `max turn ${maxRate.toFixed(1)}°/s`);
  assert.ok(worst < 1.5, `with her: the eye's distance and the aim within ${worst.toFixed(2)} m of the frame`);
});
