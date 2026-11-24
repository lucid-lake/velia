// Play as Tessie, phase 1c: the camera behind her neck, on her real sim driven by the controller. Behaviour only.
//   (she rises from 4.5 m when taken: the first seconds the eye is under with her, phase 2a; it crosses up as she surfaces)
//   behind her neck, above the water, about 10 m back and 4.6 m up; no roll; at the surface the pitch within 10°
//   no snaps: the eye's step each frame within her own pace plus a little (outside the 0.3 s crossings, tessie-under.test.mjs); the yaw at
//   most 40°/s (20°/s under reduced motion)
//   phase 1's dive (underOn false, the under rig off): it rises (to about 9 m) and looks down 25–35°; it never goes under
//   reduced motion: the far camera; the glide eases from one pose to the other in 1.6 s, the veil over 120 m
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, heightAt } from '../sim/tessie.js';
import { createTessiePlay } from '../sim/tessiePlay.js';
import { createTessieCam, createGlide, needsVeil, TCAM, GLIDE } from '../ui/tessieCam.js';

const DT = 1 / 60, DEG = Math.PI / 180;
function film(secs, hands, { reduced = false, far = false, underOn = true } = {}) {
  const sim = createTessie({ seed: 5, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 }), cam = createTessieCam();
  C.begin({ x: 0, z: 0, heading: 0 });
  const rows = [];
  for (let i = 0; i < secs / DT; i++) {
    const t = i * DT;
    sim.step(DT, { playing: true }); C.step(DT, hands(t), {});
    const n = sim.state.nose;
    const c = cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, lunging: !!C.state.lunge && C.state.lunge.phase === 'breach', reduced, far, underOn });
    rows.push({ t, pos: [...c.pos], target: [...c.target], up: [...c.up], yaw: cam.state.yaw, nose: C.state.nose, n: { ...n }, crossing: c.under.crossing, medium: c.under.medium });
  }
  return rows;
}
const pitchOf = (r) => Math.atan2(r.pos[1] - r.target[1], Math.hypot(r.target[0] - r.pos[0], r.target[2] - r.pos[2]));

test('behind her neck at the surface: about 10 m back, 4.6 m up, pitch within 10°, never a roll; no snaps; yaw at most 40°/s', () => {
  const rows = film(30, (t) => ({ move: t > 8 && t < 16 ? [1, 1] : t > 20 && t < 24 ? [-1, 1] : [0, 1], camYaw: 0 }));
  let worstStep = 0, worstYaw = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (b.t > 6 && !a.crossing && !b.crossing && a.medium === b.medium) worstStep = Math.max(worstStep, Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) - (b.n.speed + 1.5) * DT);
    worstYaw = Math.max(worstYaw, Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw))) / DT);
    if (b.t > 7) { assert.ok(Math.abs(pitchOf(b)) <= 10 * DEG + 1e-6, `pitch ${(pitchOf(b) / DEG).toFixed(1)}° at ${b.t.toFixed(2)}`); }
    assert.deepEqual(b.up, [0, 1, 0]);
  }
  assert.ok(worstStep < 0.1, `the eye's worst step past her pace ${worstStep.toFixed(3)} m`);
  assert.ok(worstYaw <= 40 * DEG + 1e-6, `yaw ${(worstYaw / DEG).toFixed(1)}°/s`);
  const r = rows[rows.length - 1], d = Math.hypot(r.pos[0] - r.n.x, r.pos[2] - r.n.z);
  assert.ok(r.pos[1] > 4 && r.pos[1] < 5.2, `height ${r.pos[1].toFixed(2)} m`);
  assert.ok(d > 11 && d < 18, `behind her nose ${d.toFixed(1)} m`);
  const fx = Math.sin(r.n.psi), fz = -Math.cos(r.n.psi);
  assert.ok((r.n.x - r.pos[0]) * fx + (r.n.z - r.pos[2]) * fz > 8, 'she is ahead of the eye');
});

test('phase 1\'s dive (the under rig off): the eye rises and looks down, never under the water', () => {
  const rows = film(16, (t) => ({ move: [0, 1], pitch: t > 3 ? 35 * DEG : 0 }), { underOn: false });
  const end = rows[rows.length - 1];
  assert.ok(end.nose > 5, `she dived (${end.nose.toFixed(1)} m)`);
  assert.ok(end.pos[1] > 8 && end.pos[1] < 9.5, `the eye rose to ${end.pos[1].toFixed(1)} m`);
  const p = pitchOf(end) / DEG;
  assert.ok(p >= 25 && p <= 35, `it looks down ${p.toFixed(1)}°`);
  assert.ok(rows.filter((r) => r.t > 3).every((r) => r.pos[1] > 3), 'never under');
  let worst = 0; for (let i = 60; i < rows.length; i++) worst = Math.max(worst, Math.abs(pitchOf(rows[i]) - pitchOf(rows[i - 1])) / DT);
  assert.ok(worst < 40 * DEG, `the pitch moves at most ${(worst / DEG).toFixed(1)}°/s`);
});

test('reduced motion: third person (the far camera is gone), the yaw at most 20°/s', () => {
  const rows = film(20, (t) => ({ move: t > 5 ? [0, -1] : [0, 1] }), { reduced: true });
  let worstYaw = 0; for (let i = 1; i < rows.length; i++) worstYaw = Math.max(worstYaw, Math.abs(Math.atan2(Math.sin(rows[i].yaw - rows[i - 1].yaw), Math.cos(rows[i].yaw - rows[i - 1].yaw))) / DT);
  assert.ok(worstYaw <= 20 * DEG + 1e-6, `${(worstYaw / DEG).toFixed(1)}°/s`);
  const r = rows[rows.length - 1];   // (taken, she rises from 4.5 m: the eye comes up from under the water first)
  assert.ok(r.pos[1] > TCAM.up - 0.8 && r.pos[1] < TCAM.up + 1.5, `third person: ${r.pos[1].toFixed(1)} m up`);
});

test('the glide: 1.6 s from one pose into the other, rising between; the veil past 120 m or under reduced motion', () => {
  const G = createGlide(), a = { pos: [0, 3, 0], target: [0, 2, -10], fov: 50 }, b = { pos: [60, 4.6, 0], target: [60, 0.5, -20], fov: 55 };
  G.start(a);
  let top = 0, n = 0, prev = a.pos;
  while (G.active && n < 200) { const p = G.apply(1 / 60, b); top = Math.max(top, p.pos[1]); assert.ok(Math.hypot(p.pos[0] - prev[0], p.pos[2] - prev[2]) < 2, 'no jump'); prev = p.pos; n++; }
  assert.ok(Math.abs(n / 60 - GLIDE.s) < 0.05, `${(n / 60).toFixed(2)} s`);
  assert.ok(top > 10 && top <= 4.6 + GLIDE.rise, `the arc rises to ${top.toFixed(1)} m`);
  assert.equal(needsVeil(a, b), false); assert.equal(needsVeil(a, { ...b, pos: [200, 4, 0] }), true); assert.equal(needsVeil(a, b, { reduced: true }), true);
});

test('the look: a drag turns and tilts the camera and stays (its pitch steers her depth); with no drag it swings in behind her only while she swims', () => {
  const sim = createTessie({ seed: 5, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 }), cam = createTessieCam();
  C.begin({ x: 0, z: 0, heading: 0 });
  const step = (o) => { sim.step(DT, { playing: true }); C.step(DT, {}, {}); const n = sim.state.nose; return cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, ...o }); };
  for (let i = 0; i < 60; i++) step({});
  const p0 = cam.pitch, y0 = cam.yaw;
  for (let i = 0; i < 20; i++) step({ orbit: [0.02, 0.02] });
  assert.ok(cam.pitch - p0 > 0.25, `the drag tilts it down (${((cam.pitch - p0) / DEG).toFixed(1)}°)`);
  assert.ok(Math.abs(cam.yaw - y0) > 0.35, 'and turns it');
  for (let i = 0; i < 40; i++) step({ follow: false });   // the drag's smoothing settles
  const p1 = cam.state.look, y1 = cam.yaw;
  for (let i = 0; i < 120; i++) step({ follow: false });
  assert.ok(Math.abs(cam.state.look - p1) < 1e-6 && Math.abs(cam.yaw - y1) < 1e-6, 'it stays: no ease back, no follow at rest');
  for (let i = 0; i < 240; i++) step({ follow: true });
  assert.ok(Math.abs(Math.atan2(Math.sin(cam.yaw - sim.state.nose.psi), Math.cos(cam.yaw - sim.state.nose.psi))) < 3 * DEG, 'swimming, it swings in behind her');
});

//): C toggles first person <-> third person
const fpRig = (depthAt = () => 40) => {
  const sim = createTessie({ seed: 5, depthAt }), C = createTessiePlay({ sim, depthAt }), cam = createTessieCam();
  C.begin({ x: 0, z: 0, heading: 0 });
  const step = (hands = {}, o = {}) => { sim.step(DT, { playing: true }); C.step(DT, hands, {}); const n = sim.state.nose; return cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, follow: true, waterAt: () => 0, floorAt: () => -40, ...o }); };
  return { sim, C, cam, step };
};

test('first person: the eye 1.6 m back from the snout and 0.6 m above it, a 60° lens, world up (no roll), steady over 10 s of her humps (no bob)', () => {
  const { sim, cam, step } = fpRig();
  for (let i = 0; i < 6 / DT; i++) step({ move: [0, 1] }, { view: 'first' });
  const ys = [], ups = []; let r = null, gapWorst = 0;
  for (let i = 0; i < 10 / DT; i++) {
    r = step({ move: [0, 1] }, { view: 'first' });
    ys.push(r.pos[1]); ups.push(r.up.join());
    const sp = sim.state.spine, d = sim.L / 63, f = 1.6 / d, i0 = Math.floor(f), u = f - i0;
    const fx = sp[i0 * 8] + (sp[i0 * 8 + 8] - sp[i0 * 8]) * u, fz = sp[i0 * 8 + 2] + (sp[i0 * 8 + 10] - sp[i0 * 8 + 2]) * u;
    gapWorst = Math.max(gapWorst, Math.hypot(r.pos[0] - fx, r.pos[2] - fz));
  }
  assert.equal(r.fov, TCAM.fp.fov); assert.equal(r.view, 'first');
  assert.ok(ups.every((u) => u === '0,1,0'), 'world up: her bank never rolls the eye');
  assert.ok(gapWorst < 0.6, `the eye rides her head frame (within ${gapWorst.toFixed(2)} m over the ground at speed)`);
  // the bob: the eye's height against its own 2 s running mean (her humps run at about 1 Hz; a slow change of depth is not a bob)
  let bob = 0; const w = Math.round(2 / DT);
  for (let i = w; i < ys.length - w; i++) { let m = 0; for (let k = i - w; k <= i + w; k++) m += ys[k]; m /= 2 * w + 1; bob = Math.max(bob, Math.abs(ys[i] - m)); }
  assert.ok(bob < 0.03, `no bob: ${(bob * 100).toFixed(1)} cm about its mean`);
  assert.ok(cam.state.view === 'first');
});

test('first person: the switch is a 0.35 s eased move between the two eyes (no cut); the look level by default, -60° to +60°; under the water too', () => {
  const { C, cam, step } = fpRig();
  for (let i = 0; i < 5 / DT; i++) step({ move: [0, 1] });
  const a = { pos: [...step({ move: [0, 1] }).pos] };   // (the camera reuses its out object)
  const path = []; for (let i = 0; i < 0.5 / DT; i++) { const r = step({ move: [0, 1] }, { view: 'first' }); path.push({ pos: [...r.pos], k: r.viewK }); }
  const kAt = (t) => path[Math.round(t / DT) - 1].k;
  assert.ok(kAt(0.1) > 0 && kAt(0.1) < 0.5 && kAt(0.36) === 1, `eased in 0.35 s (${kAt(0.1).toFixed(2)} at 0.1 s)`);
  let jump = 0; for (let i = 1; i < path.length; i++) jump = Math.max(jump, Math.hypot(...path[i].pos.map((v, j) => v - path[i - 1].pos[j])));
  const gap = Math.hypot(...a.pos.map((v, j) => v - path[path.length - 1].pos[j]));
  assert.ok(gap > 4 && jump < 0.25 * gap, `no cut: at most ${jump.toFixed(2)} m a frame over a ${gap.toFixed(1)} m move`);
  cam.setLook(0); for (let i = 0; i < 20; i++) step({ move: [0, 1] }, { view: 'first' });
  const lv = step({ move: [0, 1] }, { view: 'first' }), dy = lv.target[1] - lv.pos[1];
  assert.ok(Math.abs(dy) < 0.6, `a level look (aim ${dy.toFixed(2)} m over 20 m)`);
  cam.setLook(-70 * DEG); assert.ok(Math.abs(cam.look + 60 * DEG) < 1e-9, 'up to 60° up');
  cam.setLook(70 * DEG); assert.ok(Math.abs(cam.look - 60 * DEG) < 1e-9, 'down to 60°');
  cam.setLook(0);
  for (let i = 0; i < 8 / DT; i++) step({ move: [0, 1], sink: C.state.nose < 7 }, { view: 'first' });
  const u = step({ move: [0, 1] }, { view: 'first' });
  assert.ok(C.state.nose > 5 && u.under.medium === 'water' && u.under.depth > 3, `under the water the eye goes with her (${u.under.depth.toFixed(1)} m down)`);
  for (let i = 0; i < 0.5 / DT; i++) step({ move: [0, 1] }, { view: 'third' });
  assert.equal(step({ move: [0, 1] }, { view: 'third' }).view, 'third');
});

// the share of the frame's height her head fills from the bottom edge (a level look, a 60° lens): the top of her crown in view
function headShare(sim, r, fovDeg = 60) {
  const sp = sim.state.spine, d = sim.L / 63, f = r.target.map((v, i) => v - r.pos[i]), fl = Math.hypot(...f), F = f.map((v) => v / fl);
  const hl = Math.hypot(F[0], F[2]), R = [-F[2] / hl, 0, F[0] / hl], U = [R[1] * F[2] - R[2] * F[1], R[2] * F[0] - R[0] * F[2], R[0] * F[1] - R[1] * F[0]];
  const t = Math.tan(fovDeg / 2 * DEG); let top = -1;
  for (let i = 0; i * d < 4; i++) { const p = [0, 1, 2].map((j) => sp[i * 8 + j] + sp[i * 8 + 4 + j] * heightAt(i * d, sim.L) - r.pos[j]); const z = p[0] * F[0] + p[1] * F[1] + p[2] * F[2]; if (z < 0.05) continue; const y = (p[0] * U[0] + p[1] * U[1] + p[2] * U[2]) / z / t; if (y >= -1) top = Math.max(top, y); }
  return (top + 1) / 2;
}
test('first person: her head shows at the bottom 12–15 % of the frame on a level look, at the surface and under the water', () => {
  const { sim, C, cam, step } = fpRig();
  for (let i = 0; i < 6 / DT; i++) step({ move: [0, 1] }, { view: 'first' });
  cam.setLook(0); let r; for (let i = 0; i < 30; i++) r = step({ move: [0, 1] }, { view: 'first' });
  const top = headShare(sim, r);
  for (let i = 0; i < 8 / DT; i++) r = step({ move: [0, 1], sink: C.state.nose < 7 }, { view: 'first' });
  cam.setLook(0); for (let i = 0; i < 30; i++) r = step({ move: [0, 1] }, { view: 'first' });
  const under = headShare(sim, r);
  assert.ok(C.state.nose > 5, 'under the water');
  for (const [w, v] of [['surface', top], ['under', under]]) assert.ok(v >= 0.115 && v <= 0.16, `${w}: her head fills the bottom ${(v * 100).toFixed(1)} %`);
});
