// fix(v2) governor: the owner's iPhone 16 Pro (Safari, 2026-11-14 07:21, deployment a1f42146, ?diag=2, upright): 59.7 fps,
// frames 16.7 ms, "GPU 22.50 ms avg (busy span; passes sum 23.1; idle 11.7)", own ms scene 4.53, water-sim 3.78,
// boat-shadow 1.53, terrain-shadow 0.46, cloud-key 0.27, composite 0.22; the governor at its floor (0.60, 4 cuts) and L2,
// later L3 sideways. The page held 60 fps, yet the governor read the busy span (idle gaps in it) and cut to the floor.
// Here the governor and the ladder run the page's own loop (v2/main.js tick) against a model of that phone built from those
// numbers, before (the span, round 2's rule) and after (the work, GOV_WORK), and must settle sharp: scale ≥ 0.85 at L2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor, createRefreshProbe, idleBudget, budgetFromRefresh, GOV_WORK } from '../engine/governor.js';
import { createLadder, LEVELS, readStored, writeStored, startLevel, STORE_KEY } from '../engine/quality.js';
import { backingSize } from '../engine/canvas.js';

// --- the phone, from the screenshot ---
const OWN = { scene: 4.53, 'water-sim': 3.78, 'boat-shadow': 1.53, 'terrain-shadow': 0.46, 'cloud-key': 0.27, composite: 0.22 };
const FIXED_MS = OWN['water-sim'] + OWN['boat-shadow'] + OWN['terrain-shadow'] + OWN['cloud-key'];   // 6.04: compute and shadow maps, no screen pixels
const PIX_MS = OWN.scene + OWN.composite;                                                             // 4.75: drawn at the backing size
const CSS = [402, 660], DPR = 3;                     // Safari's visible box upright (bars shown), DPR 3
const pxOf = (level, scale, css = CSS) => { const [w, h] = backingSize({ cssW: css[0], cssH: css[1], dpr: DPR, dprCap: LEVELS[level].dprCap, maxPx: LEVELS[level].maxPx, scale }); return w * h; };
const PX0 = pxOf(2, 0.6);                            // the screenshot's backing: L2 at scale 0.60 ≈ 0.215 Mpx
// conservative: the whole scene pass is pixel-bound (its vertex work in fact is not), so the work grows as fast as it can
const MS_PER_PX = PIX_MS / PX0;
const IDLE = 11.7;                                   // the span's idle gaps (the screenshot)
const VSYNC = 1000 / 60;
// Safari sideways (L3 at the floor, 21:44): the span 15.09 ms with 6.8 idle, so 8.3 ms of work at 874 × 370 css
const LAND = [874, 370];
// one frame at `px`: the GPU's work and its pixel part, with a small deterministic wobble (± 5 %)
function frameAt(px, i, msPerPx = MS_PER_PX) {
  const wob = 1 + 0.03 * Math.sin(i * 1.7) + 0.02 * Math.sin(i * 0.31);
  const pix = px * msPerPx * wob, work = FIXED_MS * wob + pix;
  return { work, pix, span: work + IDLE };
}
// the GPU's queue: a frame is submitted at its rAF tick, runs after the last one finishes, and presents on the first vsync
// after it is done; the next rAF comes a vsync later, or later while two frames are already in flight (Safari's queue).
// Returns the frame's rAF interval: the vsync while the GPU keeps up, whole vsyncs when it does not
function createQueue() {
  let gpuEnd = 0, t = 0;
  return { get t() { return t; }, step(work) {
    gpuEnd = Math.max(gpuEnd, t) + work;
    const present = Math.ceil(gpuEnd / VSYNC - 1e-9) * VSYNC;
    const next = Math.max(t + VSYNC, present - VSYNC);
    const dt = Math.round((next - t) / VSYNC) * VSYNC; t += dt; return dt;
  } };
}

// the page's loop (v2/main.js tick + applyLevel): the governor, then the ladder; a level step resets the scale to 1
function runPage({ seconds, level = 2, span = false, legacy = false, css = CSS, msPerPx = MS_PER_PX }) {
  const gov = legacy ? createGovernor({ budgetMs: VSYNC, slowK: 1.05, fastK: 0.85 }) : createGovernor({ budgetMs: VSYNC, ...GOV_WORK });
  const lad = createLadder({ level, pxAt: (k) => pxOf(k, 1, css) });
  let L = level, scale = 1, t = 0, i = 0;
  const trace = [], q = createQueue();
  while (t < seconds * 1000) {
    const px = pxOf(L, scale, css), f = frameAt(px, i++, msPerPx);
    f.dt = q.step(f.work); t = q.t;
    const cost = span ? f.span : f.work;
    scale = legacy ? gov.feed(cost, t) : gov.feed(cost, t, f.dt, f.pix);
    const st = legacy ? lad.feed(cost, t, px, gov.atFloor) : lad.feed(cost, t, px, gov.atFloor, { dt: f.dt, pixMs: f.pix });
    if (st && st.level !== L) { L = st.level; gov.reset(1, t); scale = gov.scale; }
    if (i % 60 === 0) trace.push({ t: Math.round(t / 1000), L, scale: +scale.toFixed(3), work: +f.work.toFixed(2), fps: +(1000 / f.dt).toFixed(1) });
  }
  const px = pxOf(L, scale, css), f = frameAt(px, i, msPerPx);
  const late = trace.filter((x) => x.t >= seconds - 60);
  return { level: L, scale, work: f.work, fps: late.reduce((a, x) => a + x.fps, 0) / late.length, px, gov: gov.state(), lad: lad.state(), trace };
}

test('the model reproduces the screenshot: L2 at scale 0.60 is 10.8 ms of work, a 22.5 ms span, on vsync', () => {
  const f = frameAt(PX0, 0), q = createQueue();
  assert.ok(Math.abs(FIXED_MS + PIX_MS - 10.79) < 0.01);
  assert.ok(Math.abs(f.work - 10.8) < 0.5 && Math.abs(f.span - 22.5) < 0.5, `work ${f.work}, span ${f.span}`);
  for (let i = 0; i < 100; i++) assert.equal(q.step(frameAt(PX0, i).work), VSYNC, '60 fps');
  for (let i = 0; i < 20; i++) q.step(20);
  assert.equal(q.step(20), 2 * VSYNC, '20 ms of work a frame: every 2nd vsync');
});

test('before: on the busy span the governor sinks to its floor although every frame is on vsync', () => {
  const r = runPage({ seconds: 180, span: true, legacy: true });
  assert.ok(r.scale <= 0.61, `the floor: scale ${r.scale.toFixed(3)} (L${r.level})`);
});

test('after: on the GPU work the page settles sharp: scale ≥ 0.85 at L2 or better, 60 fps, no oscillation', () => {
  const r = runPage({ seconds: 300 });
  console.log(`  owner's iPhone, upright, after: L${r.level}, scale ${r.scale.toFixed(3)}, ${(r.px / 1e6).toFixed(3)} Mpx, work ${r.work.toFixed(2)} ms, ${r.fps.toFixed(1)} fps; governor "${r.gov.why}"`);
  console.log(`  trace (every 60 frames, first 12 s): ${r.trace.filter((x) => x.t <= 12).map((x) => `${x.t}s L${x.L} ${x.scale}`).join(' · ')}`);
  assert.ok(r.level <= 2, `L${r.level}`);
  assert.ok(r.scale >= 0.85, `scale ${r.scale.toFixed(3)}`);
  assert.ok(r.fps > 59, `fps ${r.fps}`);
  assert.ok(r.px > 2 * PX0, `${(r.px / 1e6).toFixed(3)} Mpx against the screenshot's ${(PX0 / 1e6).toFixed(3)}`);
  // steady: the last 3 minutes hold one scale and one level
  const late = r.trace.filter((x) => x.t >= 120);
  assert.ok(late.every((x) => x.scale === late[0].scale && x.L === late[0].L), `steady: ${late.map((x) => x.scale).join(',')}`);
  assert.ok(late.every((x) => x.fps > 59), 'every late frame on vsync');
});

test('after: from the floor (the old page\'s state) it climbs back to ≥ 0.85 within a minute', () => {
  const gov = createGovernor({ budgetMs: VSYNC, start: 0.6, ...GOV_WORK });
  let t = 0, i = 0, scale = 0.6, firstSharp = null; const q = createQueue();
  while (t < 120000) {
    const f = frameAt(pxOf(2, scale), i++); f.dt = q.step(f.work); t = q.t;
    scale = gov.feed(f.work, t, f.dt, f.pix);
    if (firstSharp == null && scale >= 0.85) firstSharp = t;
  }
  assert.ok(scale >= 0.85, `scale ${scale}`);
  assert.ok(firstSharp != null && firstSharp < 60000, `sharp after ${(firstSharp / 1000).toFixed(0)} s`);
  assert.match(gov.why, /hold: frames on vsync/);
});

test('after: sideways (Safari landscape, its own screenshot) the page leaves L3 and the floor', () => {
  const landMsPerPx = (8.29 - FIXED_MS) / pxOf(3, 0.6, LAND);   // the 21:44 screenshot: 8.3 ms of work at L3, scale 0.60
  assert.ok(Math.abs(frameAt(pxOf(3, 0.6, LAND), 0, landMsPerPx).work - 8.3) < 0.4);
  // the next visit: the stale L3 record is re-measured from the guess (L2)
  const r = runPage({ seconds: 300, level: 2, css: LAND, msPerPx: landMsPerPx });
  console.log(`  owner's iPhone, landscape: L${r.level}, scale ${r.scale.toFixed(3)}, ${(r.px / 1e6).toFixed(3)} Mpx (was ${(pxOf(3, 0.6, LAND) / 1e6).toFixed(3)} at L3 0.60), work ${r.work.toFixed(2)} ms, ${r.fps.toFixed(1)} fps`);
  assert.ok(r.fps > 59);
  assert.ok(r.level <= 2 && r.scale >= 0.85, `L${r.level} at ${r.scale}`);
  // the conservative upright model (the whole scene pixel-bound) sideways: never the floor, at least L3's full pixels
  const c = runPage({ seconds: 300, level: 2, css: LAND });
  console.log(`  landscape on the conservative upright model: L${c.level}, scale ${c.scale.toFixed(3)}, ${(c.px / 1e6).toFixed(3)} Mpx, ${c.fps.toFixed(1)} fps`);
  assert.ok(c.fps > 59 && c.px >= pxOf(3, 1, LAND) * 0.99);
});

test('the governor never cuts frames on vsync; cuts a page that misses them; a raise that fails sets a ceiling', () => {
  const run = (g, t, s, work, dt, pix = work / 2) => { for (let k = 0; k < s * 1000 / dt; k++) { t += dt; g.feed(work, t, dt, pix); } return t; };
  const g = createGovernor({ budgetMs: VSYNC, ...GOV_WORK });
  let t = run(g, 0, 3.1, 18, VSYNC);
  t = run(g, t, 10, 18, VSYNC);
  assert.equal(g.scale, 1, '18 ms of work but every frame on vsync (a pipelined GPU): no cut');
  assert.match(g.why, /hold: frames on vsync/);
  t = run(g, t, 2.2, 20, 2 * VSYNC);
  assert.ok(g.scale < 1 && g.scale >= 0.8, `missing vsync at 20 ms: one cut to the projected fit, got ${g.scale}`);
  assert.match(g.why, /cut 1 → 0\.\d+: work 20 ms > 16\.67, frames 33\.33/);
  // a raise that is cut within 15 s: its scale becomes a ceiling for 2 minutes
  const h = createGovernor({ budgetMs: VSYNC, start: 0.7, ...GOV_WORK });
  t = run(h, 0, 3.1, 10, VSYNC, 5);
  t = run(h, t, 8, 10, VSYNC, 5);
  const raised = h.scale; assert.ok(raised > 0.7, `raised to ${raised}`);
  t = run(h, t, 2.2, 19, 2 * VSYNC, 9);
  assert.ok(h.scale < raised && h.state().ceiling === +raised.toFixed(4), `ceiling ${h.state().ceiling}`);
  t = run(h, t, 60, 10, VSYNC, 5);
  assert.ok(h.scale < raised, `held under the ceiling for 2 minutes: ${h.scale} < ${raised}`);
  run(h, t, 120, 10, VSYNC, 5);
  assert.equal(h.state().ceiling, null, 'the ceiling expires');
});

test('refresh: the owner\'s hitchy first second is 60 Hz, not 56; ProMotion at 120 and a 90 Hz display read as such', () => {
  // 60 frames at 60 Hz with every 3rd frame late (the load streaming): the median sat at 18 ms ("56 Hz")
  const hitchy = Array.from({ length: 60 }, (_, i) => (i % 5 < 2 ? 22 + (i % 3) : 16.7 + ((i * 7) % 5 - 2) * 0.1));
  assert.ok(Math.abs(budgetFromRefresh(hitchy) - VSYNC) < 1e-9, `${1000 / budgetFromRefresh(hitchy)} Hz`);
  assert.ok(Math.abs(budgetFromRefresh(Array(40).fill(18)) - VSYNC) < 1e-9, '18 ms steady snaps to 60 Hz');
  assert.ok(Math.abs(budgetFromRefresh(Array(40).fill(11.1)) - 1000 / 90) < 1e-9, '90 Hz');
  assert.ok(Math.abs(budgetFromRefresh(Array(40).fill(8.4)) - 1000 / 120) < 1e-9, '120 Hz');
  // the probe fed the work (not the span): every frame of the owner's page is evidence, the reading 60 Hz
  let b = null, info = null;
  const probe = createRefreshProbe((x, i) => { b = x; info = i; });
  probe.setIdle(idleBudget(hitchy));
  let t = 0;
  for (let i = 0; i < 80; i++) { probe.sample(t, 10.8); t += hitchy[i % 60]; }
  assert.ok(Math.abs(b - VSYNC) < 1e-9 && info.source === 'frames', `${1000 / b} Hz from ${info?.source}`);
});

test('the stored level: a record from the busy span is re-measured from the guess; a work record is kept and re-checked', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const key = 'apple|?|phone', now = Date.UTC(2026, 10, 14, 8);
  // what a1f42146 stored: L3, the span metric (no `metric`)
  mem.set(STORE_KEY, JSON.stringify({ v: 1, gpu: key, level: 3, at: now - 3600e3, why: 'settled', measured: { spanMs: 22.5, level: 2, px: 600000, hz: 56 } }));
  const old = readStored(storage, key, now);
  assert.equal(old.stale, true);
  const s = startLevel({ stored: old, guess: { level: 2, why: 'guess: a phone, Apple GPU' } });
  assert.equal(s.level, 2, 'boots at the guess, not the stale L3');
  assert.equal(s.source, 'guess'); assert.match(s.why, /stored L3 \(2026-11-14\) was measured on the busy span: re-measuring/);
  // the settle at the guess, on the work, keeps L2 and stores a work record; the next visit boots there
  const r = runPage({ seconds: 8, level: 2 });
  assert.equal(r.lad.phase, 'settled'); assert.equal(r.lad.level, 2);
  assert.equal(r.lad.measured.metric, 'work');
  writeStored(storage, key, r.lad.level, r.lad.why, now, r.lad.measured);
  const again = readStored(storage, key, now + 1000);
  assert.equal(again.stale, false);
  const s2 = startLevel({ stored: again, guess: { level: 2, why: '' } });
  assert.equal(s2.source, 'stored'); assert.equal(s2.level, 2); assert.match(s2.why, /ms GPU work at L2/);
  // a work record at L3 is re-checked by the settle (a step up needs L2's full pixels inside 0.8 × the budget: the
  // conservative upright model keeps L3, at full scale, not the floor)
  const up = runPage({ seconds: 60, level: 3 });
  assert.equal(up.lad.phase, 'settled'); assert.match(up.lad.why, /GPU work at L3/);
  assert.ok(up.scale >= 0.99, `L3 at scale ${up.scale}`);
});

test('the ladder: frames on vsync never step down; a step up that fails needs twice the calm windows', () => {
  const PX = [1.32e6, 1.2e6, 0.7e6, 0.45e6];
  const feed = (lad, t, s, ms, px, floor, dt, pix = null) => { let r = null; for (let k = 0; k < s * 60; k++) { t += 1000 / 60; const x = lad.feed(ms, t, px, floor, { dt, pixMs: pix }); if (x) r = x; } return [t, r]; };
  const lad = createLadder({ level: 2, pxAt: (k) => PX[k] });
  let [t, r] = feed(lad, 0, 7, 12, PX[2], false, VSYNC); assert.equal(r.level, 2);
  [t, r] = feed(lad, t, 5, 30, PX[2], true, VSYNC); assert.equal(r, null, '30 ms of work at the floor but on vsync: no step');
  [t, r] = feed(lad, t, 5, 30, PX[2], true, 2 * VSYNC); assert.equal(r.level, 3, 'missing vsync at the floor: a step down');
  [t, r] = feed(lad, t, 62, 5, PX[3], false, VSYNC); assert.equal(r.level, 2, '60 calm windows: back up');
  [t, r] = feed(lad, t, 12, 30, PX[2], true, 2 * VSYNC); assert.equal(r.level, 3, 'it did not hold');
  assert.deepEqual(lad.state().failedUp, [2]);
  [t, r] = feed(lad, t, 70, 5, PX[3], false, VSYNC); assert.equal(r, null, '60 calm windows are not enough now');
  [t, r] = feed(lad, t, 55, 5, PX[3], false, VSYNC); assert.equal(r.level, 2, '120 calm windows step up');
});

test('#32 reconciled: without a GPU timer (Safari without ?diag) the work-done probe is the governor\'s cost: up from the floor on vsync, never cut on it', () => {
  // the page's rule (v2/main.js tick): the probe's span, never over the frame's interval; the interval alone until it has samples
  const gov = createGovernor({ budgetMs: VSYNC, start: 0.6, ...GOV_WORK });
  let t = 0, i = 0, scale = 0.6; const q = createQueue();
  while (t < 120000) {
    const f = frameAt(pxOf(2, scale), i++), dt = q.step(f.work); t = q.t;
    const busy = i > 8 ? f.work * 1.15 : null;   // an upper bound on the span: the promise's own latency on top
    scale = gov.feed(busy != null ? Math.min(busy, dt) : dt, t, dt, null);
  }
  assert.ok(scale >= 0.75 && scale < 1, `up from the floor on the probe (75 % pixel-bound rule, 15 % over): ${scale.toFixed(3)}`);
  const vs = createGovernor({ budgetMs: VSYNC, ...GOV_WORK });
  t = 0; for (let k = 0; k < 1200; k++) { t += VSYNC; vs.feed(VSYNC, t, VSYNC, null); }
  assert.equal(vs.scale, 1, 'the interval alone on vsync: no cut (and no blind raise)');
});
