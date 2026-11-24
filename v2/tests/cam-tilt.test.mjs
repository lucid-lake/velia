// The Boat view's pose and tilt (v2/sim/camTilt.js, owner 2026-11-17): the low, near pose (BOAT_VIEW) and the aim turned up about a fixed eye.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tiltPose, TILT, BOAT_VIEW, BOAT_VIEW_FLAT } from '../sim/camTilt.js';
import { FollowCamera, FOLLOW } from '../../src/sim/boat/followCamera.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { speedPose } from '../sim/speedFeel.js';
import { nudgePose } from '../sim/trimNudge.js';

const DEG = Math.PI / 180;
const elev = (p) => Math.atan2(p.target[1] - p.pos[1], Math.hypot(p.target[0] - p.pos[0], p.target[2] - p.pos[2])) / DEG;
const pose = () => ({ pos: [0, 12, 30], target: [0, 1.5, -10], fov: 40 });

test('tilt: the aim rises by the angle, the eye, the yaw, the aim distance and the lens stay', () => {
  const p = pose(), q = tiltPose(p, 5.5);
  assert.deepEqual(q.pos, p.pos); assert.equal(q.fov, 40);
  assert.ok(Math.abs(elev(q) - elev(p) - 5.5) < 1e-9, `${elev(q) - elev(p)}`);
  const R = (a) => Math.hypot(a.target[0] - a.pos[0], a.target[1] - a.pos[1], a.target[2] - a.pos[2]);
  assert.ok(Math.abs(R(q) - R(p)) < 1e-9);
  assert.ok(Math.abs(q.target[0]) < 1e-9, 'yaw unchanged');
  assert.equal(tiltPose(p, 0), p);
});

test('tilt composes with the speed camera and the trim nudge: the same extra tilt on top', () => {
  const base = pose(), c = [0, 0, 0];
  const both = nudgePose(speedPose({ ...pose() }, 1), c, 0.7);
  const a = tiltPose(both, 5.5);
  assert.ok(Math.abs(elev(a) - elev(both) - 5.5) < 1e-9);
  assert.deepEqual(a.pos, both.pos);
  assert.ok(elev(base) !== elev(both));
});

test('the sim: the Boat view is tilted up by the default, and ?camtilt=0 leaves the follow pose as it was', () => {
  const wind = { sample: (x, z, t) => { const v = steadyWind(9, 161)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const mk = (flags) => { const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, flags }); B.viewOf = () => 'follow'; B.settle(20); return B; };
  const a = mk({}), b = mk({ camtilt: '0' });
  let pa, pb; for (let i = 0; i < 30; i++) { a.step(1 / 60, { steer: 0, pull: 0 }); b.step(1 / 60, { steer: 0, pull: 0 }); pa = a.camera(1 / 60); pb = b.camera(1 / 60); }
  assert.ok(Math.abs(elev(pa) - elev(pb) - TILT.deg) < 1e-6, `${elev(pa)} vs ${elev(pb)}`);
});


// the Boat view's frame from a pose: the horizon, the boat's waterline and her masthead (12.4 m air draft) as shares of the
// frame's height from the top (the vertical lens is the frame's: every aspect frames the same shares)
const HULL = 9.1, MAST = 12.9, STERN = 3.6;   // the vane's top over the water; her waterline's after end, aft of her centre (the hull's lowest visible point from behind)
function frame(p, boat) {
  const f = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], fl = Math.hypot(...f); f.forEach((v, i) => { f[i] = v / fl; });
  const hl = Math.hypot(f[0], f[2]), up = [-f[0] / hl * f[1], hl, -f[2] / hl * f[1]], t = Math.tan(p.fov * DEG / 2);
  const y = (q) => { const d = [q[0] - p.pos[0], q[1] - p.pos[1], q[2] - p.pos[2]], z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; return 0.5 - (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / z / t / 2; };
  return { horizon: y([p.pos[0] + f[0] / hl * 2e4, 0, p.pos[2] + f[2] / hl * 2e4]), waterline: y([boat[0], 0, boat[2]]), mast: y([boat[0], MAST, boat[2]]), stern: y([boat[0], 0, boat[2] + STERN]), eyeH: p.pos[1] };
}
const settled = (pose, sog = 0) => { const c = new FollowCamera({ hull: HULL, x: 0, z: 0, heading: 0, pose }); let p; for (let i = 0; i < 600; i++) p = c.update(1 / 60, { x: 0, z: 0, heave: 0, heading: 0, sog }); return { c, p }; };

test('the Boat view (owner, 2026-11-17: "this angle and distance is already good enough"): the owner\'s frame (horizon 53 %, vane 27 %, hull 77 %, cockpit up), the stern over the cockpit at rest too', () => {
  const now = settled(BOAT_VIEW);
  const F = frame(tiltPose(now.p, BOAT_VIEW.tiltDeg), [0, 0, 0]);
  assert.ok(F.eyeH > 5.5 && F.eyeH < 7.5, `eye ${F.eyeH.toFixed(2)} m`);
  assert.ok(F.horizon > 0.49 && F.horizon < 0.55, `horizon ${(100 * F.horizon).toFixed(1)} %`);
  assert.ok(F.mast > 0.23 && F.mast < 0.31, `vane ${(100 * F.mast).toFixed(1)} %`);
  // at rest (no speed camera: the narrowest lens, the boat largest) her stern still clears the guard bar (about 84 %)
  assert.ok(F.stern <= 0.81, `stern ${(100 * F.stern).toFixed(1)} %`);
  // underway at the owner's 5.3 kn with the speed camera's 0.8: the owner's frame within about 2 %
  const c = new FollowCamera({ hull: HULL, pose: BOAT_VIEW }); let p, z = 0;
  for (let i = 0; i < 900; i++) { z -= 2.73 / 60; p = c.update(1 / 60, { x: 0, z, heave: 0, heading: 0, sog: 2.73 }); }
  const G = frame(tiltPose(speedPose({ ...p, pos: [...p.pos], target: [...p.target] }, 0.8), BOAT_VIEW.tiltDeg), [0, 0, z]);
  assert.ok(Math.abs(G.horizon - 0.53) < 0.025 && Math.abs(G.mast - 0.274) < 0.035, JSON.stringify(G));
});

test('the Boat view underway holds her size: the speed pull (negative) takes back the follow\'s lag behind a moving boat', () => {
  const at = (sog) => { const c = new FollowCamera({ hull: HULL, pose: BOAT_VIEW }); let p, z = 0; for (let i = 0; i < 900; i++) { z -= sog / 60; p = c.update(1 / 60, { x: 0, z, heave: 0, heading: 0, sog }); } return Math.hypot(p.pos[0], p.pos[1] - FOLLOW.aimUp, p.pos[2] - z); };
  const rest = at(0);
  // never farther than at rest; nearer by at most 1.5 m here (the page's own lag is about twice the bare camera's: there it held 26.0 m
  // at 5.5 kn against 25.9 m at rest, tools/v2-boat-view.mjs --clip)
  for (const sog of [1.3, 2.1, 3.6]) { const d = at(sog); assert.ok(d < rest + 0.5 && d > rest - 1.5, `${sog} m/s: ${d.toFixed(2)} m vs ${rest.toFixed(2)} m at rest`); }
});

test('a phone\'s flat pose (no cockpit, a taller top bar): the vane under the 12.8 % bar, the hull clear of the bottom', () => {
  const s = settled(BOAT_VIEW_FLAT), F = frame(tiltPose(s.p, BOAT_VIEW_FLAT.tiltDeg), [0, 0, 0]);
  assert.ok(F.mast >= 0.145 && F.stern <= 0.86 && F.horizon > 0.48 && F.horizon < 0.56, JSON.stringify(F));
});

test('the Boat view at hull speed: the speed camera lowers and widens it, the stern still clear, the rig in frame', () => {
  const c = new FollowCamera({ hull: HULL, pose: BOAT_VIEW }); let p, z = 0;
  for (let i = 0; i < 900; i++) { z -= 3.6 / 60; p = c.update(1 / 60, { x: 0, z, heave: 0, heading: 0, sog: 3.6 }); }
  const q = speedPose({ ...p, pos: [...p.pos], target: [...p.target] }, 1);
  const F = frame(tiltPose(q, BOAT_VIEW.tiltDeg), [0, 0, z]);
  assert.ok(F.stern <= 0.81 && F.mast >= 0.15 && F.horizon < 0.56 && F.eyeH > 4, JSON.stringify(F));
});

test('the drag range: the default sits inside it with room both ways; the floor keeps the eye over the water; v1 keeps FOLLOW', () => {
  assert.ok(BOAT_VIEW.pitchMin < BOAT_VIEW.pitch - 3 * DEG && BOAT_VIEW.pitchMax > BOAT_VIEW.pitch + 3 * DEG);
  const low = new FollowCamera({ hull: HULL, pose: BOAT_VIEW });
  let p; for (let i = 0; i < 240; i++) p = low.update(1 / 60, { x: 0, z: 0, heave: 0, heading: 0, sog: 0 }, i < 60 ? { orbit: [0, -0.05] } : {});
  assert.ok(low.pitch >= BOAT_VIEW.pitchMin - 1e-9 && p.pos[1] > 2, `floor: pitch ${(low.pitch / DEG).toFixed(2)}°, eye ${p.pos[1].toFixed(2)} m`);
  const v1 = new FollowCamera({ hull: HULL });
  assert.equal(v1.F, FOLLOW); assert.equal(v1.pitch, FOLLOW.pitch); assert.equal(v1.dist, FOLLOW.dist);
});

test('Cruise keeps v1\'s follow pose (its astern view and director), Sail gets the Boat view back; ?campitch wins', () => {
  const wind = { sample: (x, z, t) => { const v = steadyWind(9, 161)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, flags: {} });
  assert.equal(B.follow.dist, BOAT_VIEW.dist); assert.equal(B.follow.pitch, BOAT_VIEW.pitch);
  B.followPose('cruise');
  assert.equal(B.follow.F, FOLLOW); assert.equal(B.follow.dist, FOLLOW.dist); assert.equal(B.follow.pitch, FOLLOW.pitch);
  B.followPose('sail');
  assert.equal(B.follow.dist, BOAT_VIEW.dist); assert.equal(B.follow.pitch, BOAT_VIEW.pitch); assert.equal(B.follow.F.pitchMin, BOAT_VIEW.pitchMin);
  B.setFlat(true); assert.equal(B.follow.dist, BOAT_VIEW_FLAT.dist); assert.equal(B.follow.F.tiltDeg, BOAT_VIEW_FLAT.tiltDeg);
  B.setFlat(false); assert.equal(B.follow.dist, BOAT_VIEW.dist);
  const P = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, flags: { campitch: '12' } });
  P.followPose('cruise'); P.followPose('sail');
  assert.ok(Math.abs(P.follow.pitch - 12 * DEG) < 1e-12);
});
