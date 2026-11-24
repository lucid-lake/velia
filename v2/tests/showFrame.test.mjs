// Cruise's camera during the fireworks (v2/sim/showFrame.js; owner, 2026-11-15: "we might just have a camera to look at that
// fireworks angle"): the weight eases in over 2 s before the first riser, holds, eases out over 2 s after the finale, never
// jumps when the show clock does, lets go when the player looks, and a capture sets it at once. The pose keeps its position
// and turns toward the show. Behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShowFrame, SHOW_FRAME_CRUISE as F } from '../sim/showFrame.js';

const AIM = [1135, -850], LEN = 300, DT = 1 / 60;
const run = (sf, t0, t1, o = {}) => { const ws = []; for (let t = t0; t <= t1 + 1e-9; t += DT) ws.push(sf.step(DT, t, o)); return ws; };
const maxStep = (ws) => ws.slice(1).reduce((m, w, i) => Math.max(m, Math.abs(w - ws[i])), 0);
const dirOf = (p) => { const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]], l = Math.hypot(...d); return d.map((x) => x / l); };

test('the weight: 0 before the show, eased up over 2 s from t = −2, 1 through the show, eased down over 2 s after it', () => {
  const sf = createShowFrame({ aim: AIM, length: LEN });
  assert.equal(sf.step(DT, null), 0);
  assert.equal(run(sf, -30, -2.1).at(-1), 0);
  const up = run(sf, -2, 0.5);
  const at1 = up[Math.round(1 / DT)];
  assert.ok(at1 > 0.3 && at1 < 0.7, `half way at 1 s (${at1})`);
  assert.equal(up.at(-1), 1);
  assert.ok(maxStep(up) < 0.03, `no snap on the way in (${maxStep(up)})`);
  assert.equal(run(sf, 0.5, LEN - DT).at(-1), 1);
  const down = run(sf, LEN, LEN + 3);
  assert.ok(down[Math.round(1 / DT)] > 0.3 && down[Math.round(1 / DT)] < 0.7);
  assert.equal(down.at(-1), 0);
  assert.ok(maxStep(down) < 0.03, `no snap on the way out (${maxStep(down)})`);
});

test('a jump of the show clock (the time menu) never snaps the view', () => {
  const sf = createShowFrame({ aim: AIM, length: LEN });
  run(sf, -40, -35);
  const ws = [sf.step(DT, 120), ...run(sf, 120 + DT, 123)];
  assert.ok(ws[0] < 0.03, `the first frame after the jump (${ws[0]})`);
  assert.ok(maxStep(ws) < 0.03);
  assert.equal(ws.at(-1), 1);
});

test('the player\'s look wins: a drag lets the view go for the rest of that show; the next show frames again', () => {
  const sf = createShowFrame({ aim: AIM, length: LEN });
  run(sf, -2, 10);
  assert.equal(sf.weight, 1);
  sf.step(DT, 10, { input: true });
  const ws = run(sf, 10 + DT, 12);   // no input after the drag: still let go
  assert.equal(ws.at(-1), 0);
  assert.ok(sf.yielded);
  assert.ok(maxStep(ws) < 0.05, 'it lets go smoothly');
  run(sf, 12, LEN + 5);
  assert.equal(sf.weight, 0);
  assert.equal(sf.yielded, false);
  sf.step(DT, null); run(sf, -2, 1);
  assert.equal(sf.weight, 1, 'the next show frames again');
});

test('a capture (instant) sets the weight from the show clock at once, the same every run', () => {
  const a = createShowFrame({ aim: AIM, length: LEN }), b = createShowFrame({ aim: AIM, length: LEN });
  run(b, -2, 50);
  assert.equal(a.step(1, 100, { instant: true }), 1);
  assert.equal(b.step(1, 100, { instant: true }), 1);
  assert.equal(a.step(1, LEN + 10, { instant: true }), 0);
  assert.equal(a.step(1, -100, { instant: true }), 0);
});

test('the pose: its position kept, its forward turned toward the show and up, the lens a little wider', () => {
  const sf = createShowFrame({ aim: AIM, length: LEN });
  // a camera at the boat's start looking west, away from the show
  const pose = { pos: [1200, 3, -1050], target: [1100, 2, -1050], up: [0, 1, 0], fov: 40, near: 0.1 };
  assert.equal(sf.apply(pose, 0), pose);
  const full = sf.apply(pose, 1), half = sf.apply(pose, 0.5);
  assert.deepEqual(full.pos, pose.pos); assert.deepEqual(full.up, pose.up); assert.equal(full.near, 0.1);
  const d = dirOf(full), flat = [AIM[0] - pose.pos[0], AIM[1] - pose.pos[2]], fl = Math.hypot(...flat);
  assert.ok(Math.abs(d[0] / Math.hypot(d[0], d[2]) - flat[0] / fl) < 1e-6 && Math.abs(d[2] / Math.hypot(d[0], d[2]) - flat[1] / fl) < 1e-6, 'it faces the show');
  const pitch = Math.asin(d[1]) * 180 / Math.PI;
  assert.ok(pitch >= F.pitchMin - 1e-6 && pitch <= F.pitchMax + 1e-6, `tilted up, inside the limits (${pitch})`);
  assert.equal(full.fov, 40 + F.fov);
  assert.equal(half.fov, 40 + F.fov / 2);
  // half way is between the two
  const d0 = dirOf(pose), dh = dirOf(half), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(dot(dh, d) > dot(d0, d) && dot(dh, d0) > dot(d, d0));
  // a lens already at the cap is not widened
  assert.equal(sf.apply({ ...pose, fov: 90 }, 1).fov, 90);
});
