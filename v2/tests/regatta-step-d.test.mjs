// Regatta step D (owner 2026-11-17): the race's quality ladder (steps down only, on a sustained slow p90, never
// in the race's busy moments), frame-rate-independent camera easing (the same settled frame and the same time at 30, 60 and 120 fps;
// the follow camera rides the slow heave, not each wave), the baked course cards (deterministic sources, current files), night races
// (the marks lit only at night; Night dealt at Club and Pro only). The browser half: tests/pages regatta*, home, menuCard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRaceLadder, createLadder, p90Of, RACE_Q, TOP } from '../engine/quality.js';
import { ease, easeK, createHeaveFilter } from '../sim/ease.js';
import { FollowCamera } from '../../src/sim/boat/followCamera.js';
import { raceCamEase, CAM_RATES, createRegatta, QUIET } from '../regatta/index.js';
import { createMenuDrift } from '../ui/menuDrift.js';
import { cardSvg, chartGround, CARD_KINDS } from '../regatta/cardArt.js';
import { CARDS, BOARD, SOURCES, CARD_SIZES } from '../regatta/cards.js';
import { sources, hashOf, cardsJs, OUT_JS } from '../../tools/v2-regatta-cards.mjs';
import { raceLights, nightLit, NIGHT_MARKS } from '../regatta/nightMarks.js';
import { GLOW_FLOATS } from '../sim/night.js';
import { dealHand, customHand, validHand, handSeed, describeHand, DEFAULT_SETUP, PRESETS, TIMES, DAY_TIMES, DEAL_NIGHT, isNightHand, sunElevDeg } from '../regatta/setup.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { ZONE_M } from '../regatta/geometry.js';
import { raceQualityLine } from '../ui/loadReportData.js';

// ---------------- the race's quality ladder ----------------
const B = 1000 / 30;
// feed `secs` of frames at `ms` each from `t`; returns { t, steps }
function run(rq, t, secs, ms, quiet = true, why = '') {
  const steps = [];
  for (let k = 0, n = Math.round(secs * 1000 / ms); k < n; k++) { t += ms; const s = rq.feed(ms, t, { quiet, why }); if (s) steps.push({ ...s, t }); }
  return { t, steps };
}
test('the race ladder: p90 over a window', () => {
  assert.equal(p90Of([]), null);
  assert.equal(p90Of(Array.from({ length: 10 }, (_, i) => i + 1)), 9);
  assert.equal(p90Of([5, 5, 5, 5, 5, 5, 5, 5, 5, 50]), 5, 'one slow frame in ten is not the p90');
  assert.equal(p90Of([5, 5, 5, 5, 5, 5, 5, 5, 50, 50]), 50);
});

test('the race ladder steps down only on a sustained slow p90, after its guard times, one rung at a time', () => {
  const rq = createRaceLadder({ budgetMs: B, level: 1 });
  rq.start(0, 1);
  let r = run(rq, 0, 25, 34);   // a healthy race (30 fps held): nothing
  assert.equal(r.steps.length, 0);
  // slow frames in the race's first 20 s: no judging
  const rq2 = createRaceLadder({ budgetMs: B, level: 1 }); rq2.start(0, 1);
  assert.equal(run(rq2, 0, RACE_Q.warmMs / 1000 - 1, 60).steps.length, 0, 'the first 20 s are never judged');
  // a short slow patch (2 s at 60 ms: under holdMs + the window) does not step; a long one does, the fleet first
  r = run(rq, r.t, 1, 60); assert.equal(r.steps.length, 0, 'a 1 s hitch is not sustained');
  r = run(rq, r.t, 3, 34); assert.equal(r.steps.length, 0);
  r = run(rq, r.t, 5, 60);
  assert.equal(r.steps.length, 1, JSON.stringify(r.steps)); assert.equal(r.steps[0].rung, 'fleet'); assert.equal(rq.fleetLite, true); assert.equal(rq.level, 1);
  // the next step waits afterStepMs and a new full window: then one level down
  const first = r.steps[0].t; r = run(rq, r.t, 12, 60);
  assert.ok(r.steps.length >= 1 && r.steps[0].rung === 'level' && r.steps[0].level === 2, JSON.stringify(r.steps));
  assert.ok(r.steps[0].t - first >= RACE_Q.afterStepMs + RACE_Q.buckets * RACE_Q.bucketMs, `${r.steps[0].t - first} ms after the first step`);
  // at the last rung it holds
  r = run(rq, r.t, 60, 60);
  assert.equal(rq.level, TOP); assert.ok(rq.state().why.includes('last rung'), rq.state().why);
  const lv = rq.steps.map((s) => s.level); assert.deepEqual(lv, [...lv].sort((a, b) => a - b), 'the levels only rise (step down) mid-race');
});

test('the race ladder never steps up mid-race, and holds between its two thresholds (hysteresis)', () => {
  const rq = createRaceLadder({ budgetMs: B, level: 2 }); rq.start(0, 2);
  let r = run(rq, 0, 21, 34); r = run(rq, r.t, 120, 20);   // two minutes of fast frames: no step at all, never up
  assert.equal(r.steps.length, 0); assert.equal(rq.level, 2);
  // two slow buckets start the run; buckets between clearK and overK keep it (they neither add nor clear); a third slow bucket steps
  // (frames that divide a second, from the end of the warm guard: the buckets fall on whole seconds)
  const over = 50, mid = 40, fast = 25;   // 1.5, 1.2 and 0.75 × the 33.3 ms budget (overK 1.3, clearK 1.12)
  const rq2 = createRaceLadder({ budgetMs: B, level: 0 }); rq2.start(0, 0);
  r = run(rq2, 0, RACE_Q.warmMs / 1000, 20);
  r = run(rq2, r.t, 2, over); assert.equal(rq2.state().run, 2, JSON.stringify(rq2.state()));
  r = run(rq2, r.t, 4, mid); assert.equal(rq2.state().run, 2, 'kept between the thresholds'); assert.equal(rq2.steps.length, 0);
  r = run(rq2, r.t, 1, over); assert.equal(rq2.steps.length, 1, JSON.stringify(rq2.state()));
  // a bucket under clearK clears the run
  const rq3 = createRaceLadder({ budgetMs: B, level: 0 }); rq3.start(0, 0);
  r = run(rq3, 0, RACE_Q.warmMs / 1000, 20); r = run(rq3, r.t, 2, over); assert.equal(rq3.state().run, 2);
  r = run(rq3, r.t, 1, fast); assert.equal(rq3.state().run, 0, 'cleared under clearK');
  r = run(rq3, r.t, 2, over); assert.equal(rq3.steps.length, 0);
  // the page's ladder held (a race running) never steps, up or down
  const lad = createLadder({ level: 2, pxAt: () => 1e6, budgetMs: B, warmMs: 0, settleMs: 100, cooldownMs: 0, calmWindows: 2, held: true, aimK: 1 });
  lad.hold(true);
  let t = 0, st = null;
  for (let i = 0; i < 400 && !st; i++) { t += 50; const s = lad.feed(5, t, 1e6, false, { dt: 16.7 }); if (s?.changed) st = s; }
  assert.equal(st, null, 'held: no step'); assert.equal(lad.level, 2);
  lad.hold(false);
  for (let i = 0; i < 400 && !st; i++) { t += 50; const s = lad.feed(5, t, 1e6, false, { dt: 16.7 }); if (s?.changed) st = s; }
  assert.ok(st && st.level < 2, 'released: the calm steps up again');
});

test('the race ladder waits for a quiet moment, never steps in the start, a rounding or the finish, and pauses reset it', () => {
  const rq = createRaceLadder({ budgetMs: B, level: 1 }); rq.start(0, 1);
  let r = run(rq, 0, 21, 34);
  r = run(rq, r.t, 10, 60, false, 'a rounding');
  assert.equal(r.steps.length, 0, 'not while the race is busy'); assert.equal(rq.state().pending, true); assert.match(rq.state().why, /waiting for a quiet moment \(a rounding\)/);
  r = run(rq, r.t, 0.5, 60, true);
  assert.equal(r.steps.length, 1); assert.match(r.steps[0].why, /waited for a quiet moment/);
  // a pause (a frame over pauseMs: a hidden tab) clears the window and waits afterPauseMs
  const rq2 = createRaceLadder({ budgetMs: B, level: 1 }); rq2.start(0, 1);
  r = run(rq2, 0, 21, 34); r = run(rq2, r.t, 2.5, 60);
  rq2.feed(2000, r.t + 2000, { quiet: true }); r.t += 2000;
  r = run(rq2, r.t, 3, 60); assert.equal(r.steps.length, 0, 'judging waits after a pause');
  // a new race starts the guards again; stop clears the fleet rung
  rq.stop(); assert.equal(rq.active, false); assert.equal(rq.fleetLite, false); assert.equal(rq.feed(60, 1e9, { quiet: true }), null);
  assert.match(raceQualityLine({ raceQuality: { steps: [{ rung: 'fleet', level: 1, at: 42000, p90: 51.2 }, { rung: 'level', level: 2, at: 70000, p90: 48 }] } }), /2 steps down: fleet bands at 0:42 \(p90 51\.2 ms\), L2 at 1:10/);
  assert.equal(raceQualityLine({}), null);
});

// the race's quiet moments on the page's race in node
const fakeLines = () => ({ stats: { active: false, count: 0 }, setActive(on) { this.stats.active = on; }, write(f, n) { this.stats.count = n; } });
const fakeProps = () => ({ stats: { instances: 0 }, setActive() {}, begin() {}, put() {}, end() {} });
function raceInNode({ flags = {}, windMs = 6, dir = 210 } = {}) {
  const wind = { sample: (x, z, t) => { const v = steadyWind(windMs, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; }, base: { dirDeg: dir, speedMs: windMs } };
  const Bo = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const R = createRegatta({ B: Bo, windField: wind, clock: null, terrain: { field: { height: () => -40 } }, flags: { seed: '1', ...flags }, P: { headless: true }, lines: fakeLines(), props: fakeProps() });
  return { B: Bo, R };
}
test('the race says when it is quiet: not the start, not a rounding; a race running holds the page ladder (racing)', async () => {
  const { B: Bo, R } = raceInNode({ flags: { course: 'short' } });
  assert.equal(R.racing(), false);
  await R.enter();
  assert.equal(R.racing(), true, 'the box: a race is running');
  assert.ok(R.session.race.clock < -QUIET.beforeS); assert.equal(R.quiet().quiet, true, 'early in the box: quiet');
  R.settle(-R.session.race.clock - 5);
  assert.deepEqual({ ...R.quiet() }, { quiet: false, why: 'the start' });
  R.settle(QUIET.afterS + 8);
  const v = R.session.race.view('me'), m = v.target?.at;
  assert.ok(m, 'racing to a mark');
  Bo.place({ x: m.x + ZONE_M * 0.8, z: m.z, headingDeg: 0, speed: 2 });
  assert.equal(R.quiet().why, 'a rounding');
  Bo.place({ x: m.x + ZONE_M * 6, z: m.z, headingDeg: 0, speed: 2 });
  assert.equal(R.quiet().quiet, true, 'between the marks: quiet');
  const n0 = R.raceN; R.restart(); assert.equal(R.raceN, n0 + 1, 'Race again is a new race (the guards start again)');
  R.leave(); assert.equal(R.racing(), false);
});

// ---------------- frame-rate-independent camera easing ----------------
test('easing is compounded per frame: 30, 60 and 120 fps reach the same value at the same time', () => {
  for (const rate of [0.5, 1.6, 3]) {
    const at = (fps) => { let x = 0; for (let i = 0; i < fps; i++) x = ease(x, 1, rate, 1 / fps); return x; };
    const a = at(30), b = at(60), c = at(120);
    assert.ok(Math.abs(a - c) < 1e-9 && Math.abs(b - c) < 1e-9, `${rate}: ${a} ${b} ${c}`);
    assert.ok(Math.abs(c - (1 - Math.exp(-rate))) < 1e-9);
  }
  assert.equal(easeK(3, 0), 0); assert.ok(easeK(3, 10) <= 1);
  // the race camera's three eases (the box view, the beat's rise, its turn): one second at each rate lands on the same state
  const st = (fps) => { const s = { camK: 0, liftK: 0, camYaw: 0 }; for (let i = 0; i < fps; i++) raceCamEase(s, { k: 1, lift: 1, yaw: 0.5 }, 1 / fps); return s; };
  const s30 = st(30), s120 = st(120);
  for (const k of ['camK', 'liftK', 'camYaw']) assert.ok(Math.abs(s30[k] - s120[k]) < 1e-9, `${k}: ${s30[k]} vs ${s120[k]}`);
  assert.ok(Math.abs(s120.camK - (1 - Math.exp(-CAM_RATES.box))) < 1e-9);
});

test('the follow camera settles to the same frame at the same time at 30, 60 and 120 fps, and rides the slow heave, not each wave', () => {
  // a boat sailing at 4 m/s, turning 30° at 2 s, heaving ±0.3 m with a 2.5 s wave; the camera through the heave filter as v2's boat feeds it
  const runCam = (fps) => {
    const cam = new FollowCamera({ x: 0, z: 0, heading: 0 }), hf = createHeaveFilter(), dt = 1 / fps;
    let x = 0, z = 0, h = 0, minY = Infinity, maxY = -Infinity, settledAt = null; const track = [];
    for (let i = 0, n = 12 * fps; i < n; i++) {
      const t = (i + 1) * dt; if (t > 2) h = 30 * Math.PI / 180;
      x += Math.sin(h) * 4 * dt; z -= Math.cos(h) * 4 * dt;
      const heave = 0.3 * Math.sin(2 * Math.PI * t / 2.5);
      const c = cam.update(dt, { x, z, heading: h, heave: hf.step(heave, dt), sog: 4 });
      if (t > 4) { minY = Math.min(minY, c.pos[1]); maxY = Math.max(maxY, c.pos[1]); }
      track.push([t, c.pos.slice(), [x, z]]);
    }
    const end0 = track.at(-1)[1], end = [end0[0] - x, end0[1], end0[2] - z];   // the camera from the boat (her path differs by a frame at the turn)
    // the time the camera's yaw chase settles (its pose relative to the boat within 5 cm of the end's, held to the end)
    for (let i = track.length - 1; i >= 0; i--) { const [t, p, bxz] = track[i]; if (Math.hypot(p[0] - bxz[0] - end[0], p[2] - bxz[1] - end[2]) > 0.05) { settledAt = t; break; } }
    return { end, bob: maxY - minY, settledAt, x, z };
  };
  const r30 = runCam(30), r60 = runCam(60), r120 = runCam(120);
  for (const r of [r30, r60]) {
    // within the boat's travel in one 30 fps frame's half (4 m/s × 1/60 s ≈ 0.07 m: a held input lags half a frame), 0.2° at 30 m
    assert.ok(Math.hypot(r.end[0] - r120.end[0], r.end[1] - r120.end[1], r.end[2] - r120.end[2]) < 0.08, `the settled pose: ${r.end} vs ${r120.end}`);
    assert.ok(Math.abs(r.settledAt - r120.settledAt) <= 1 / 30 + 1e-6, `settled at ${r.settledAt} vs ${r120.settledAt} s`);
  }
  assert.ok(r120.bob < 0.06, `the camera bobs ${r120.bob.toFixed(3)} m with a 0.6 m wave (unfiltered: ≈ 0.5 m)`);
  // the filter's own curve is the same at every rate (exact per step), and follows a slow change
  const hfAt = (fps) => { const f = createHeaveFilter(); let y = 0; for (let i = 0; i < 4 * fps; i++) y = f.step(1, 1 / fps); return y; };
  assert.ok(Math.abs(hfAt(30) - hfAt(120)) < 1e-9 && hfAt(120) > 0.95, `${hfAt(30)} ${hfAt(120)}`);
});

test('the Menu card\'s drift eases in and out, never jumps, and stays off under Reduce Motion', () => {
  const pose = { pos: [0, 10, 30], target: [0, 0, 0], fov: 40 };
  const md = createMenuDrift();
  assert.equal(md.step(1 / 60, false, pose), pose, 'closed: the pose as given');
  let prev = pose.pos, maxStep = 0;
  for (let i = 0; i < 600; i++) { const p = md.step(1 / 60, i < 400, pose).pos; maxStep = Math.max(maxStep, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])); prev = p; }
  assert.ok(maxStep < 0.1, `no jump: ${maxStep} m a frame`);
  const calm = createMenuDrift(); for (let i = 0; i < 200; i++) calm.step(1 / 60, true, pose, { reduced: true });
  assert.ok(calm.w < 1e-3);
});

// ---------------- the baked course cards ----------------
const pngSize = (file) => { const b = readFileSync(file); assert.equal(b.toString('latin1', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
test('the course cards: deterministic sources, current bake, every file at 1× and 2×', () => {
  const a = sources(), b = sources();
  assert.deepEqual(a.map((s) => s.svg), b.map((s) => s.svg), 'the same source twice');
  for (const s of a) assert.equal(SOURCES[s.stem], hashOf(s.svg), `${s.stem}: cards.js is stale (node tools/v2-regatta-cards.mjs)`);
  assert.equal(readFileSync(OUT_JS, 'utf8'), cardsJs(a), 'cards.js is the bake\'s own');
  assert.ok(!/Math\.random|Date\.now/.test(cardSvg({ id: 'x' }, { kind: 'board' })));
  for (const [id, c] of Object.entries(CARDS['tahoe-emerald'])) for (const kind of ['card', 'tile', 'plate']) {
    const [u1, u2] = c[kind], [w, h] = CARD_SIZES[kind];
    for (const [u, k] of [[u1, 1], [u2, 2]]) { const f = fileURLToPath(u); assert.ok(existsSync(f), f); assert.deepEqual(pngSize(f), [w * k, h * k], `${id} ${kind} @${k}x`); }
  }
  assert.deepEqual(pngSize(fileURLToPath(BOARD[1])), [CARD_SIZES.board[0] * 2, CARD_SIZES.board[1] * 2]);
  // the card shows the marks 1 … F, the rounding symbols and the wind arrow (the hub's own drawing on the chart ground)
  const card = a.find((s) => s.kind === 'card' && s.id === 'island-sprint').svg;
  assert.match(card, />F</); assert.match(card, />1 ⟲</); assert.match(card, /<path d="M120 4V/);
  assert.ok(chartGround({ w: 120, h: 80, seed: 's' }) === chartGround({ w: 120, h: 80, seed: 's' }));
  assert.notEqual(chartGround({ w: 120, h: 80, seed: 's' }), chartGround({ w: 120, h: 80, seed: 't' }), 'each course its own contours');
  assert.deepEqual(Object.keys(CARD_KINDS).sort(), Object.keys(CARD_SIZES).sort());
});

// ---------------- night races ----------------
const COURSE = { id: 't', marks: [{ id: 'W', at: [0, -300], kind: 'sphere' }, { id: 'I', at: [100, -150], kind: 'cylinder' }], line: { pin: [-40, 0], committee: [40, 0], centre: [0, 0], up: [0, -1] } };
test('the marks are lit only at night: a light on each mark, the pin and the committee boat', () => {
  const out = new Float32Array(NIGHT_MARKS.max * GLOW_FLOATS);
  for (const sun of [40, 10, 2, 0.7]) assert.equal(raceLights(out, { course: COURSE, sunElevDeg: sun }), 0, `the sun at ${sun}°: none`);
  assert.equal(nightLit(20), false); assert.equal(nightLit(-13), true);
  const n = raceLights(out, { course: COURSE, sunElevDeg: sunElevDeg(22), heightAt: () => 0.1 });
  assert.equal(n, COURSE.marks.length + 2);
  assert.equal(raceLights(out, { course: COURSE, sunElevDeg: -13, finish: true }), COURSE.marks.length + 3, 'the last leg: the finish light too');
  // the lamps on top of their props, each lit, steady (the same light twice), warm on the marks
  raceLights(out, { course: COURSE, sunElevDeg: -13, heightAt: () => 0.1 });
  assert.ok(Math.abs(out[1] - (0.1 + NIGHT_MARKS.y.markW)) < 1e-5 && Math.abs(out[GLOW_FLOATS + 1] - (0.1 + NIGHT_MARKS.y.markI)) < 1e-5);
  for (let i = 0; i < n; i++) assert.ok(out[i * GLOW_FLOATS + 7] > 0, `light ${i} on`);
  const again = new Float32Array(out.length); raceLights(again, { course: COURSE, sunElevDeg: -13, heightAt: () => 0.1 }); assert.deepEqual(again.slice(0, n * GLOW_FLOATS), out.slice(0, n * GLOW_FLOATS), 'steady: no flash');
  // dusk: dimmer than night
  raceLights(out, { course: COURSE, sunElevDeg: 0 }); const dusk = out[7]; raceLights(out, { course: COURSE, sunElevDeg: -10 }); assert.ok(dusk > 0 && dusk < out[7]);
});

test('night hands: dealt at Club and Pro only, valid, any level in Custom; the night\'s sun is under the horizon', () => {
  const night = TIMES.find((t) => t.night);
  assert.ok(night && sunElevDeg(night.hour) < -10, `Night at ${night?.hour}: the sun ${sunElevDeg(night?.hour ?? 0).toFixed(1)}°`);
  assert.ok(!DAY_TIMES.includes(night) && DAY_TIMES.length === TIMES.length - 1);
  for (const id of Object.keys(PRESETS)) {
    const s = { ...DEFAULT_SETUP, ...PRESETS[id] }; let nights = 0;
    for (let n = 0; n < 500; n++) { const h = dealHand(handSeed('night', n), s); assert.ok(validHand(h)); if (isNightHand(h)) { nights++; assert.equal(describeHand(h).time, 'Night'); } }
    if (id === 'beginner') assert.equal(nights, 0, 'Beginner never sails at night');
    else assert.ok(nights > 500 * DEAL_NIGHT[id] * 0.5 && nights < 500 * DEAL_NIGHT[id] * 1.6, `${id}: ${nights} night hands in 500`);
  }
  const c = customHand({ ...DEFAULT_SETUP, custom: { ...DEFAULT_SETUP.custom, time: 'night' } }, 3);
  assert.ok(validHand(c) && isNightHand(c) && c.aids === 'beginner', 'Custom: Night at any level');
});
