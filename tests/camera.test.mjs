// The camera's contract (src/camera.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraAt, CameraRig, Autopilot, floorAt, FOV, IDLE_S, BLEND_S } from '../src/camera.js';
import { heightAt } from '../src/sim/terrain.js';
import { CAMERAS } from '../src/sim/core/presets.js';

const NONE = { move: [0, 0], rise: 0, look: [0, 0], stick: [0, 0], fast: false, active: false };
const input = (o) => ({ ...NONE, ...o, active: true });

test('the drift: the height floor holds every 0.05 s over the whole loop (≈ 2,240 s; 3 m over water, 8 m over land)', () => {
  const P = new Autopilot({ heightAt });
  let worst = Infinity, at = 0, land = 0;
  for (let t = 0; t <= P.period; t += 0.05) {
    const p = cameraAt(t, heightAt);
    const m = p.pos[1] - floorAt(heightAt, p.pos[0], p.pos[2]);
    if (m < worst) { worst = m; at = t; }
    if (heightAt(p.pos[0], p.pos[2]) > 0) land++;
  }
  assert.ok(worst >= 0, `${worst.toFixed(3)} m above the floor at t ${at.toFixed(2)} s`);
  assert.ok(land * 0.05 > 300, `only ${(land * 0.05).toFixed(0)} s over land: the 8 m rule is barely tested`);
});

test('the drift: 2–6 m/s, FOV 50, level horizon, the whole loop', () => {
  const P = new Autopilot({ heightAt });
  let lo = Infinity, hi = 0;
  for (let t = 0; t < P.period; t += 0.5) {
    const p = cameraAt(t, heightAt);
    const v = Math.hypot(...p.vel);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    assert.equal(p.fov, FOV);
    assert.ok(!('roll' in p) && Math.abs(p.pitch) < 0.2, `pitch ${p.pitch}`);
  }
  assert.ok(lo >= 1.99 && hi <= 6.001, `speed ${lo.toFixed(3)}–${hi.toFixed(3)} m/s`);
  assert.ok(P.period > 600, `loop ${P.period.toFixed(0)} s`);
});

test('cameraAt is deterministic, starts at cam A, and a rig with no input is cameraAt', () => {
  const a = cameraAt(123.4, heightAt), b = cameraAt(123.4, heightAt);
  assert.deepEqual(a, b);
  const s = cameraAt(0, heightAt);
  assert.ok(Math.hypot(s.pos[0] - CAMERAS.A.pos[0], s.pos[1] - CAMERAS.A.pos[1], s.pos[2] - CAMERAS.A.pos[2]) < 1, `start ${s.pos}`);
  const rig = new CameraRig({ heightAt });
  let worst = 0;
  for (let i = 1; i <= 60 * 60; i++) {
    const p = rig.update(1 / 60);
    const q = cameraAt(i / 60, heightAt);
    worst = Math.max(worst, Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1], p.pos[2] - q.pos[2]));
  }
  assert.ok(worst < 1e-6, `rig vs cameraAt: ${worst} m`);
});

// a scripted session: drift 10 s, glide forward and turn for 8 s, release; 20 s later the drift takes it back
function session(dt, script = (t) => (t >= 10 && t < 18 ? input({ move: [0.3, 1], stick: [0.4, -0.1] }) : NONE), seconds = 45) {
  const rig = new CameraRig({ heightAt });
  const out = [];
  for (let i = 1; i * dt <= seconds; i++) {
    const p = rig.update(dt, script(i * dt));
    out.push({ t: i * dt, pos: p.pos.slice(), yaw: p.yaw, mode: p.mode });
  }
  return out;
}

// the largest change of velocity between two frames (finite differences), optionally in a time window
function maxDv(rows, dt, from = 0, to = Infinity) {
  let worst = 0, at = 0;
  for (let i = 2; i < rows.length; i++) {
    if (rows[i].t < from || rows[i].t > to) continue;
    const v1 = rows[i].pos.map((x, d) => (x - rows[i - 1].pos[d]) / dt), v0 = rows[i - 1].pos.map((x, d) => (x - rows[i - 2].pos[d]) / dt);
    const dv = Math.hypot(...v1.map((x, d) => x - v0[d]));
    if (dv > worst) { worst = dv; at = rows[i].t; }
  }
  return { worst, at };
}

test('hand-over timing: input takes control at once; 20 s without input starts a 3 s blend; then the drift', () => {
  const rows = session(1 / 120);
  const mode = (t) => rows.find((r) => r.t >= t - 1e-9).mode;
  assert.equal(mode(9.9), 'auto');
  assert.equal(mode(10.01), 'manual');
  assert.equal(mode(18 + IDLE_S - 0.05), 'manual');
  assert.equal(mode(18 + IDLE_S + 0.05), 'blend');
  assert.equal(mode(18 + IDLE_S + BLEND_S + 0.05), 'auto');
});

test('the hand-over is C1: no velocity jump at the take-over, the blend start or its end', () => {
  // a real jump keeps its size as the step shrinks; a smooth path's per-frame change shrinks with the step
  const coarse = session(1 / 120), fine = session(1 / 480);
  const t1 = 18 + IDLE_S, t2 = t1 + BLEND_S;
  for (const [name, a, b] of [['take-over', 9.5, 10.5], ['blend start', t1 - 0.5, t1 + 0.5], ['blend end', t2 - 0.5, t2 + 0.5], ['whole session', 0, 45]]) {
    const c = maxDv(coarse, 1 / 120, a, b), f = maxDv(fine, 1 / 480, a, b);
    assert.ok(c.worst < 0.15, `${name}: ${c.worst.toFixed(4)} m/s in one 1/120 s frame at t ${c.at.toFixed(3)}`);
    assert.ok(f.worst < c.worst / 2.5 || f.worst < 1e-3, `${name}: Δv ${c.worst.toFixed(4)} → ${f.worst.toFixed(4)} m/s as dt / 4: a jump`);
  }
  // the heading too: no step in the yaw rate
  let worst = 0;
  for (let i = 2; i < coarse.length; i++) {
    const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
    const w1 = wrap(coarse[i].yaw - coarse[i - 1].yaw) * 120, w0 = wrap(coarse[i - 1].yaw - coarse[i - 2].yaw) * 120;
    worst = Math.max(worst, Math.abs(w1 - w0));
  }
  assert.ok(worst < 0.05, `yaw rate step ${worst.toFixed(4)} rad/s`);
});

test('a mutant: a blend with a linear weight (not smoothstep) has a velocity jump, so the C1 check can fail', () => {
  // the same check on a hand-made linear blend between two paths at rest and moving: it must see the jump
  const dt = 1 / 120, rows = [];
  for (let i = 0; i < 6 * 120; i++) {
    const t = i * dt, w = Math.min(1, Math.max(0, (t - 2) / 3));
    rows.push({ t, pos: [w * 4 * t, 10, 0] });
  }
  assert.ok(maxDv(rows, dt).worst > 0.15, 'the check missed a linear blend');
});

test('the manual glide keeps the floor too: diving at the ground for 600 s', () => {
  const rig = new CameraRig({ heightAt });
  let worst = Infinity;
  for (let i = 1; i <= 600 * 60; i++) {
    const t = i / 60;
    const p = rig.update(1 / 60, input({ move: [Math.sin(t / 40), 1], rise: -1, fast: true, stick: [0.15, 0] }));
    worst = Math.min(worst, p.pos[1] - floorAt(heightAt, p.pos[0], p.pos[2]));
  }
  assert.ok(worst >= 0, `${worst.toFixed(3)} m above the floor`);
});

test('the floor holds gliding fast and level into a steep slope (the floor rising faster than the glide climbs)', () => {
  const rig = new CameraRig({ heightAt });
  rig.update(1 / 60, input({ stick: [0, 0] }));
  rig.yawT = rig.yaw = -Math.PI / 2;                                // face west, toward the bay's west wall
  let worst = Infinity, rose = 0;
  const y0 = rig.pos[1];
  for (let i = 1; i <= 120 * 60; i++) {
    const p = rig.update(1 / 60, input({ move: [0, 1], fast: true }));
    worst = Math.min(worst, p.pos[1] - floorAt(heightAt, p.pos[0], p.pos[2]));
    rose = Math.max(rose, p.pos[1] - y0);
  }
  assert.ok(worst >= 0, `${worst.toFixed(3)} m above the floor`);
  assert.ok(rose > 200, `rose only ${rose.toFixed(0)} m: the glide never met the slope`);
});

test('a rejoin from far off the path: back on it, the gap closing at a gentle speed', () => {
  // glide 10 s sideways to starboard (north-west, toward the bay's north shore; to port, south-east, lands on the
  // drift's return leg along Eagle Point), release; the drift rejoins at the nearest point and closes the gap
  const P = new Autopilot({ heightAt });
  const rows = session(1 / 60, (t) => (t >= 5 && t < 15 ? input({ move: [1, 0] }) : NONE), 520);   // the gap closes over 1.5·gap/OFFSET_RATE ≈ 400 s
  const off = (r) => { const s = P.nearestS(r.pos[0], r.pos[2]); const q = P.poseAtS(s); return Math.hypot(q.pos[0] - r.pos[0], q.pos[2] - r.pos[2]); };
  const start = rows.find((r) => r.t >= 15 + IDLE_S);
  assert.ok(off(start) > 100, `only ${off(start).toFixed(0)} m off the path: the test isn't testing a far rejoin`);
  assert.ok(off(rows.at(-1)) < 2, `still ${off(rows.at(-1)).toFixed(1)} m off the path at the end`);
  let fastest = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].t > 35 + IDLE_S) fastest = Math.max(fastest, Math.hypot(...rows[i].pos.map((x, d) => (x - rows[i - 1].pos[d]) * 60)));
  assert.ok(fastest < 6 + 2, `${fastest.toFixed(2)} m/s during the rejoin`);
});

test('eye-level mode rides 0.8–1.6 m over the water', () => {
  const rig = new CameraRig({ heightAt });
  rig.update(1 / 60, input({ move: [0, 0.01] }));
  rig.eyeLevel = 1.2;
  let p;
  for (let i = 0; i < 6 * 60; i++) p = rig.update(1 / 60, input({ move: [0, 0.2] }));
  assert.ok(heightAt(p.pos[0], p.pos[2]) < 0, 'not over water');
  assert.ok(Math.abs(p.pos[1] - 1.2) < 0.05, `eye at ${p.pos[1].toFixed(3)} m`);
});
