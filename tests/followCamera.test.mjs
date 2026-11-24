// The follow camera (src/boat/followCamera.js): it frames the boat, never rolls, follows smoothly, keeps its limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FollowCamera, FOLLOW } from '../src/sim/boat/followCamera.js';

const boatAt = (x, z, heading = 0, sog = 3) => ({ x, z, heading, heave: 0, sog });
const DEG = Math.PI / 180;

test('default framing: 20° down, ≈3.5 hull lengths back, aimed ahead of the boat', () => {
  const cam = new FollowCamera({ x: 0, z: 0, heading: 0 });
  let p; for (let i = 0; i < 600; i++) p = cam.update(1 / 60, boatAt(0, 0, 0, 0));
  const dx = p.pos[0], dy = p.pos[1] - FOLLOW.aimUp, dz = p.pos[2];
  const r = Math.hypot(dx, dy, dz);
  assert.ok(Math.abs(r - FOLLOW.dist * FOLLOW.hull) < 0.5, `distance ${r.toFixed(2)} m`);
  assert.ok(Math.abs(Math.atan2(dy, Math.hypot(dx, dz)) - 20 * DEG) < 0.5 * DEG, 'pitch 20°');
  assert.ok(dz > 0 && Math.abs(dx) < 1e-6, 'behind the boat (south of a north-heading boat)');
  assert.ok(p.target[2] < 0, 'aims ahead of the boat, so the boat sits low in the frame');
});

test('never rolls: the camera has no roll term and keeps y above the water', () => {
  const cam = new FollowCamera();
  for (let i = 0; i < 1200; i++) {
    const p = cam.update(1 / 60, { ...boatAt(Math.sin(i / 50) * 30, -i * 0.05, Math.sin(i / 80)), heel: 0.4 });
    assert.ok(p.pos[1] > 2, `camera height ${p.pos[1].toFixed(2)} m`);
    assert.equal(Object.keys(p).sort().join(','), 'fov,pos,target');
  }
});

test('smooth follow: a sudden jump of the boat is followed without a step', () => {
  const cam = new FollowCamera();
  let prev = cam.update(1 / 60, boatAt(0, 0, 0, 0)).pos, worst = 0;
  for (let i = 0; i < 240; i++) {
    const p = cam.update(1 / 60, boatAt(i < 60 ? 0 : 20, 0, 0, 0)).pos;   // a 20 m teleport at frame 60
    worst = Math.max(worst, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]));
    prev = p;
  }
  assert.ok(worst < 1.5, `largest per-frame move ${worst.toFixed(2)} m (a step would be ≈20 m)`);
});

test('the chase swings behind the boat slowly; orbit and zoom stay inside their limits', () => {
  const cam = new FollowCamera({ heading: 0 });
  for (let i = 0; i < 60; i++) cam.update(1 / 60, boatAt(0, 0, Math.PI / 2, 0));
  assert.ok(cam.yaw > 0 && cam.yaw <= FOLLOW.chaseRate * 1.01, `chase after 1 s: ${cam.yaw.toFixed(3)} rad`);
  cam.update(1 / 60, boatAt(0, 0, 0, 0), { orbit: [0, 10], zoom: 100 });
  assert.ok(cam.pitch <= FOLLOW.pitchMax + 1e-9 && cam.dist <= FOLLOW.distMax + 1e-9);
  cam.update(1 / 60, boatAt(0, 0, 0, 0), { orbit: [0, -10], zoom: 0.001 });
  assert.ok(cam.pitch >= FOLLOW.pitchMin - 1e-9 && cam.look <= FOLLOW.lookUp + 1e-9 && cam.dist >= FOLLOW.distMin - 1e-9);
});

test('a drag past the lowest orbit looks up at the sky, low over the water, and stays; the default framing is unchanged', () => {
  const cam = new FollowCamera({ heading: 0 }), b = boatAt(0, 0, 0, 0);
  const elOf = (p) => Math.atan2(p.target[1] - p.pos[1], Math.hypot(p.target[0] - p.pos[0], p.target[2] - p.pos[2])) * 180 / Math.PI;
  const p0 = cam.update(1 / 60, b);
  assert.ok(elOf(p0) < 0, 'the default looks down at the boat');
  cam.update(1 / 60, b, { orbit: [0, -10] });   // all the way: the full look up
  let p = cam.update(1 / 60, b);
  for (let i = 0; i < 600; i++) p = cam.update(1 / 60, b);   // 10 s hands off
  assert.ok(elOf(p) > 35, `looks up ${elOf(p).toFixed(1)}°`);
  assert.ok(p.pos[1] < p0.pos[1], 'the camera sinks toward the water');
  const q = new FollowCamera({ heading: 0 }).update(1 / 60, b);
  assert.deepEqual(q, p0, 'a fresh camera: the same default pose');
  cam.update(1 / 60, b, { orbit: [0, 10] });   // dragged back down: the orbit again, looking at the boat
  assert.ok(cam.look === 0 && elOf(cam.update(1 / 60, b)) < 0);
  const low = new FollowCamera({ heading: 0, pitchDeg: 3 });   // ?campitch=3 (the whitecaps golden): the lowest orbit, no look up
  assert.ok(elOf(low.update(1 / 60, b)) < 0 && low.look === 0);
});

test('the camera breathes with speed: a surge widens and lowers it slowly, never in a step', () => {
  const cam = new FollowCamera({ heading: 0 });
  let p = null; for (let i = 0; i < 600; i++) p = cam.update(1 / 60, boatAt(0, -i * 0.02, 0, 1.2));
  const slow = p;
  let worst = 0, prevFov = slow.fov;
  for (let i = 0; i < 600; i++) { p = cam.update(1 / 60, boatAt(0, -12 - i * 0.06, 0, 3.6)); worst = Math.max(worst, Math.abs(p.fov - prevFov)); prevFov = p.fov; }
  assert.ok(p.fov > slow.fov + 1 && p.fov <= 40 + FOLLOW.fovBreath + 1e-9, `fov ${slow.fov.toFixed(2)} → ${p.fov.toFixed(2)}`);
  assert.ok(worst < 0.05, `fov step ${worst.toFixed(3)}° per frame`);
});
