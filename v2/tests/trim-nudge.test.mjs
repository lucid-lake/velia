// The trim camera nudge (v2/sim/trimNudge.js; owner, 2026-11-16): trimming in the Boat view eases the follow camera off the
// centreline toward the boom's side and up; 2 s after the trim stops it eases back; never while the player drags the
// camera (and 1 s after), never in the Helm view or under Cruise's autopilot; off with Reduce Motion.
// On the boat sim: W held nudges the camera, hands off it comes back to the exact follow pose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrimNudge, nudgePose, NUDGE } from '../sim/trimNudge.js';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const DEG = Math.PI / 180, DT = 1 / 60;
const run = (n, s, o) => { let x = 0; for (let i = 0; i < Math.round(s / DT); i++) x = n.update(DT, o); return x; };

test('trimming eases in toward the boom\'s side, smoothly; 2 s after it stops, eases back to none', () => {
  const n = createTrimNudge(); let prev = 0, maxStep = 0;
  for (let i = 0; i < 120; i++) { const x = n.update(DT, { trimming: true, boom: 20 * DEG }); maxStep = Math.max(maxStep, Math.abs(x - prev)); assert.ok(x >= prev - 1e-12, 'never backs off while trimming'); prev = x; }
  assert.ok(prev > 0.9, `in after 2 s: ${prev.toFixed(3)}`);
  assert.ok(maxStep < 0.06, `no jerk: largest step a frame ${maxStep.toFixed(3)}`);
  assert.ok(run(n, 1.9, { trimming: false, boom: 20 * DEG }) > 0.9, 'held for 2 s after the trim stops');
  assert.equal(run(n, 4, { trimming: false, boom: 20 * DEG }), 0, 'then back to none');
  const p = createTrimNudge();
  assert.ok(run(p, 1.5, { trimming: true, boom: -20 * DEG }) < -0.9, 'the boom to port: the other side');
});

test('never during a camera drag (and 1 s after), never in the Helm view or under Cruise; off at once under Reduce Motion', () => {
  const n = createTrimNudge();
  assert.equal(run(n, 1, { trimming: true, dragging: true, boom: 0.3 }), 0, 'dragging');
  assert.equal(run(n, 0.5, { trimming: true, boom: 0.3 }), 0, 'just after a drag');
  assert.ok(run(n, 1.5, { trimming: true, boom: 0.3 }) > 0.5, 'then it eases in');
  assert.ok(Math.abs(run(n, 3, { trimming: true, dragging: true, boom: 0.3 })) < 1e-3, 'a drag mid-nudge: eased back out');
  for (const o of [{ view: 'helm' }, { cruise: true }, { reduced: true }]) assert.equal(run(createTrimNudge(), 2, { trimming: true, boom: 0.3, ...o }), 0, JSON.stringify(o));
  const m = createTrimNudge(); run(m, 2, { trimming: true, boom: 0.3 });
  assert.equal(m.update(DT, { trimming: true, boom: 0.3, reduced: true }), 0, 'reduced motion: none at once');
});

test('the pose: turned round the boat toward the boom\'s side by 15°, raised by 4° of its distance; none at 0', () => {
  const c = [0, 0, 0], p = { pos: [0, 10, 30], target: [0, 1.5, -20], fov: 40 };   // behind a boat heading north (−z)
  assert.equal(nudgePose(p, c, 0), p);
  const q = nudgePose(p, c, 1);
  assert.ok(q.pos[0] > 0, 'the boom to starboard: the camera onto the starboard quarter');
  assert.ok(Math.abs(Math.atan2(q.pos[0], q.pos[2]) - NUDGE.yawDeg * DEG) < 1e-9, 'by 15°');
  assert.ok(Math.abs(Math.hypot(q.pos[0], q.pos[2]) - 30) < 1e-9 && Math.abs(q.pos[1] - (10 + 30 * Math.tan(4 * DEG))) < 1e-9, 'same distance, higher');
  assert.ok(nudgePose(p, c, -1).pos[0] < 0, 'to port');
});

test('on the boat: W held in the Boat view nudges the camera; hands off it comes back to the follow pose exactly', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200) });
  B.settle(10);
  const frame = (pull) => { B.step(DT, { steer: 0, pull }); return B.camera(DT); };
  for (let i = 0; i < 60; i++) frame(-1);   // eased: the sheet in the hand already
  for (let i = 0; i < 60; i++) frame(1);
  assert.ok(Math.abs(B.nudge) > 0.8, `nudged: ${B.nudge}`);
  for (let i = 0; i < 420; i++) frame(0);
  assert.equal(B.nudge, 0, 'back');
  const C = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(15 * KN, 200) });
  C.settle(10); C.viewOf = () => 'helm';
  for (let i = 0; i < 60; i++) { C.step(DT, { steer: 0, pull: 1 }); C.camera(DT); }
  assert.equal(C.nudge, 0, 'the Helm view: none');
});
function steady(ms, d) { return { sample: (x, z, t) => { const v = steadyWind(ms, d)(x, z, t); return { vx: v.vx, vz: v.vz }; } }; }
