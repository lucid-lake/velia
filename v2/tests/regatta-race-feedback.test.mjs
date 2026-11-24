// The owner's phase-1 play of the place races (2026-11-20), on the engine in node (index.js createRegatta on the real boat sim):
//   1. Leave race: R.quit() leaves the race for free Sail where she is (no new place, her speed kept), the rivals, marks and lines gone,
//      nothing recorded; R.inProgress says whether the race's own controls ask first (the results card and a finished race do not)
//   2. Tessie's Deep: her ring is never drawn on the water, at any level (the warning is her drone, her shape, the coach's line)
//   3. Pass the Channel's cold start: the uneven frames of a first launch (pipelines compiling, tiles streaming) must not shake the world.
//      The race camera's eye moves smoothly in sim time over the first 5 s (no tick-sized jerks: the boat's 1/60 s physics ticks were
//      shown raw), and the eye never turns more than 1.5° in one frame from the pre-start to after the gun (the 25 m cut, the crossing's
//      cut, the beat lift laid on at once and the Boat view's tilt snapping on when the start helper lets go are gone)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegatta } from '../regatta/index.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createSimClock } from '../engine/clock.js';
import { SEG_FLOATS } from '../render/raceLines.js';
import { DEEP } from '../regatta/tessieDeep.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

function engine({ dir = 195, tessie = null, flags = {}, store = mem() } = {}) {
  const wind = { pattern: null, base: { dirDeg: dir, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const clock = createSimClock({ step: 1 / 120, maxSteps: 20, t0: 0, hour0: 15, timerate: 1 });   // main.js's: 1/120 s steps, the stall cap at 2 ×
  const writes = [];
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write(f32, n) { writes.push(f32.slice(0, n * SEG_FLOATS)); } }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true,
    onSalute: () => true, tessie: () => tessie });
  return { R, B, clock, writes, store };
}

// one frame of main.js's tick: the clock fed the frame's real dt × the race's pace, the steps owed run, then the camera
function frame(e, dt) {
  const { R, B, clock } = e;
  const n = clock.advance(dt * R.speed());
  if (n > 0) { R.beforeStep({ steer: 0 }, null); B.step(n * clock.dt, { steer: 0, pull: 0 }, dt); R.afterStep(); }
  return R.camera(dt, B.camera(dt));
}
// a cold first launch's frames (seeded): mostly 60 fps, a fifth of them 30–60 ms, one in ten a 80–250 ms compile stall
function coldFrames(seconds, seed = 7) {
  let a = seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = []; let s = 0;
  while (s < seconds) { const r = rnd(), dt = r < 0.7 ? 1 / 60 : r < 0.9 ? 0.03 + rnd() * 0.03 : 0.08 + rnd() * 0.17; out.push(Math.min(0.25, dt)); s += dt; }
  return out;
}

test('cold start: Pass the Channel\'s race camera moves smoothly in sim time over the first 5 s of uneven frames (the world does not shake)', async () => {
  const e = engine({ flags: { course: 'pass-the-channel' } });
  await e.R.enter();
  assert.equal(e.R.placeRace?.id, 'pass-the-channel');
  const fed = () => e.clock.t + e.clock.acc;   // the sim time fed so far (a stall past the cap drops the rest: never counted)
  let prev = null, worstEye = 0, worstPose = 0, worstTurn = 0, frames = 0;
  for (const dt of coldFrames(5)) {
    const t0 = fed(), c = frame(e, dt), t1 = fed(), ds = t1 - t0;
    const p = e.B.pose, f = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]], fl = Math.hypot(...f);
    const cur = { eye: [c.pos[0], c.pos[2]], boat: [p.x, p.z], f: f.map((x) => x / fl), ds };
    if (prev && ds > 1e-6 && prev.ds > 1e-6) {
      const v = (a, b, k) => [(a[0] - b[0]) / k, (a[1] - b[1]) / k];
      if (prev.v) {
        const ve = v(cur.eye, prev.eye, ds), vb = v(cur.boat, prev.boat, ds);
        const span = (ds + prev.ds) / 2;   // the acceleration between the two frames' velocities (m/s² of sim time)
        worstEye = Math.max(worstEye, Math.hypot(ve[0] - prev.v.eye[0], ve[1] - prev.v.eye[1]) / span);
        worstPose = Math.max(worstPose, Math.hypot(vb[0] - prev.v.boat[0], vb[1] - prev.v.boat[1]) / span);
        cur.v = { eye: ve, boat: vb };
      } else cur.v = { eye: v(cur.eye, prev.eye, ds), boat: v(cur.boat, prev.boat, ds) };
      worstTurn = Math.max(worstTurn, Math.acos(Math.min(1, cur.f[0] * prev.f[0] + cur.f[1] * prev.f[1] + cur.f[2] * prev.f[2])) * 180 / Math.PI);
    }
    prev = cur; frames++;
  }
  assert.ok(frames > 100, `${frames} frames`);
  // the boat's drawn pose moves in whole 1/60 s ticks: between uneven frames its speed jumps, about 10 m/s² of sim time (the check can
  // fail: this is what an eye locked to the pose showed)
  assert.ok(worstPose > 6, `the pose's tick steps are seen by the probe (${worstPose.toFixed(2)} m/s²)`);
  // the eye: only its own smooth swing toward the line (2.45 m/s² measured on these frames, 2026-11-20; an eye on the raw pose read
  // 9.98 m/s², the pose itself 10.27)
  assert.ok(worstEye < 4, `the race camera's eye: worst acceleration between frames ${worstEye.toFixed(2)} m/s² (the pose's ${worstPose.toFixed(2)} m/s²)`);
  assert.ok(worstTurn < 1.5, `the eye turns at most ${worstTurn.toFixed(2)}° in a frame`);
});

test('pre-start to after the gun at 60 fps: the race camera never cuts (no turn of more than 1.5° in a frame)', async () => {
  const e = engine({ flags: { course: 'pass-the-channel' } });
  await e.R.enter();
  let prev = null, worst = 0, at = null;
  for (let i = 0; i < 60 * 16 && e.R.session.race.clock < 6; i++) {
    const c = frame(e, 1 / 60), f = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]], fl = Math.hypot(...f);
    const u = f.map((x) => x / fl);
    if (prev) { const a = Math.acos(Math.min(1, u[0] * prev[0] + u[1] * prev[1] + u[2] * prev[2])) * 180 / Math.PI; if (a > worst) { worst = a; at = e.R.session.race.clock; } }
    prev = u;
  }
  assert.ok(e.R.session.race.clock >= 3, `the race sailed past the gun and the camera's ease (${e.R.session.race.clock.toFixed(1)} s)`);
  assert.ok(worst < 1.5, `worst turn ${worst.toFixed(2)}° in a frame (at ${at?.toFixed?.(1)} s)`);
});

test('Leave race: R.quit() leaves for free Sail where she is, the race gone and nothing recorded; inProgress says when to ask', async () => {
  const e = engine({ flags: { course: 'pass-the-channel', autoplay: '1', autotier: 'hard' } });
  await e.R.enter();
  for (let i = 0; i < 60 * 12; i++) frame(e, 1 / 60);   // into the race
  assert.equal(e.R.inProgress, true, 'a race sailed: the controls ask first');
  const s = e.B.state, before = { x: s.x, z: s.z, sog: s.sog, heading: s.heading };
  assert.equal(e.R.quit(), true);
  assert.equal(e.R.on, false); assert.equal(e.R.session, null); assert.equal(e.R.inProgress, false);
  const q = e.B.state;
  assert.ok(Math.hypot(q.x - before.x, q.z - before.z) < 0.01 && Math.abs(q.sog - before.sog) < 1e-9 && q.heading === before.heading, 'she stays where she is, at her speed');
  assert.equal(e.B.driven, false, 'the helper or the scripted sailor lets go of the helm');
  assert.equal(e.store.getItem('lakeshore.regatta.places.v1'), null, 'no time or medal recorded');
  assert.equal(e.R.quit(), false, 'nothing to leave');
  // after a finish (the results card) nothing is asked
  const f = engine({ flags: { course: 'pass-the-channel', autoplay: '1', autotier: 'hard' } });
  await f.R.enter();
  for (let s2 = 0; s2 < 900 && !f.R.stats.result; s2 += 2) f.R.settle(2);
  assert.ok(f.R.stats.result, 'the race finished');
  assert.equal(f.R.inProgress, false, 'the results card leaves at once');
  assert.equal(f.R.quit(), true); assert.equal(f.R.on, false);
});

test('Tessie\'s Deep: her ring is never drawn on the water, Beginner included (her warning is natural)', async () => {
  const st = { visible: false, centre: [0, 0], t: 0, phase: 'idle' };
  const sim = { state: st, riseUnder: (x, z) => { st.visible = true; st.phase = 'swim'; st.centre = [x, z]; }, hunt() {}, swimTo() {}, play: (n) => { if (n === 'dive') { st.visible = false; st.phase = 'idle'; } } };
  const e = engine({ dir: 200, tessie: { sim, raceCue() {} }, flags: { course: 'tessies-deep', autoplay: '1', autotier: 'hard' } });
  await e.R.enter();
  assert.equal(e.R.aids.level, 'beginner');
  let seen = 0;
  for (let i = 0; i < 400 && seen < 40; i++) {
    e.R.settle(0.5); e.writes.length = 0; e.R.frame(new Float32Array(16), 1280, 720, 1);
    const ring = e.R.deep?.ring;
    if (!ring || !e.writes.length) continue;
    seen++;
    const f = e.writes.at(-1);
    // a ring is a polygon round her: segments with both ends on her 28 m or 60 m circle
    for (let k = 0; k < f.length; k += SEG_FLOATS) {
      const da = Math.hypot(f[k] - ring.at[0], f[k + 2] - ring.at[1]), db = Math.hypot(f[k + 4] - ring.at[0], f[k + 6] - ring.at[1]);
      for (const r of [DEEP.innerM, DEEP.outerM]) assert.ok(!(Math.abs(da - r) < 0.3 && Math.abs(db - r) < 0.3), `a ring segment round her (${da.toFixed(1)}, ${db.toFixed(1)} m)`);
    }
  }
  assert.ok(seen >= 5, `her attacks were seen with the lines drawn (${seen} frames)`);
});
