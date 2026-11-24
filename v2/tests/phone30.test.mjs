// perf(v2) phone 30 fps (owner, 2026-11-15: "phone should target at 30fps not 60 and push for the picture quality"): a
// phone's budget is 33.3 ms on any display, the limiter draws evenly spaced frames, the boat's speed per real second is
// unchanged under it, a strong phone boots at L1, and the old phone records are stale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameBudget, createGovernor, GOV_WORK, PHONE_AIM } from '../engine/governor.js';
import { createPacer } from '../engine/pacer.js';
import { createLadder, readSignals, guessLevel, gpuKey, readStored, writeStored, startLevel, STORE_KEY, LEVELS, levelPixels } from '../engine/quality.js';
import { createSimClock } from '../engine/clock.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const B30 = 1000 / 30;
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('budget: a phone is held at 30 fps (33.3 ms) on 60 and 120 Hz, aiming at 78 % for heat; a tablet too', () => {
  for (const hz of [60, 120, 90]) {
    const p = frameBudget(1000 / hz, { kind: 'phone' });
    assert.ok(Math.abs(p.budgetMs - B30) < 1e-9, `${hz} Hz`); assert.equal(p.hz, hz); assert.equal(p.limit, true); assert.equal(p.aimK, PHONE_AIM);
    assert.equal(p.why, 'budget 33.3 ms: phone held at 30 fps (quality first)');
  }
  assert.equal(PHONE_AIM, 0.78);
  assert.equal(frameBudget(1000 / 120, { kind: 'tablet' }).why, 'budget 33.3 ms: tablet held at 30 fps (quality first)');
  assert.equal(frameBudget(1000 / 120, { kind: 'tablet' }).limit, true);
  // a desk keeps no limiter (its own test file holds the rest)
  assert.equal(frameBudget(1000 / 120, { desk: true }).limit, false);
});

// a fake rAF clock: callbacks at the display's vsync (with jitter), the page's pacer deciding which draw
function run(hz, ms, { jitter = 0, slowAt = -1 } = {}) {
  const p = createPacer({ targetMs: B30 }), v = 1000 / hz, drawn = [];
  let k = 0;
  for (let t = 0; t < ms; t += v, k++) {
    if (k === slowAt || k === slowAt + 1) continue;   // a frame that overran: two vsyncs without a callback
    const ts = t + (jitter ? Math.sin(k * 1.7) * jitter : 0);
    if (p.due(ts)) drawn.push(ts);
  }
  return { p, drawn, iv: drawn.slice(1).map((x, i) => x - drawn[i]) };
}

test('limiter: frames evenly spaced at 33.3 ms on 60, 120 and 90 Hz (every 2nd, 4th, 3rd vsync); a 30 Hz display draws every vsync', () => {
  for (const [hz, every] of [[60, 2], [120, 4], [90, 3]]) {
    const { p, iv } = run(hz, 5000, { jitter: 0.3 });
    const steady = iv.slice(8);   // after the first vsyncs are measured
    for (const d of steady) assert.ok(Math.abs(d - B30) < 1.0, `${hz} Hz: an interval of ${d.toFixed(2)} ms`);
    assert.equal(p.every, every); assert.equal(p.state().hz, hz);
    assert.ok(Math.abs(p.state().p50 - B30) < 0.7 && p.state().p95 < B30 + 1, `${hz} Hz p50 ${p.state().p50} p95 ${p.state().p95}`);
    assert.match(p.line(), new RegExp(`pacing 30\\.\\d fps: every ${every === 2 ? '2nd' : every === 3 ? '3rd' : '4th'} vsync of ${hz} Hz · frames p50 33\\.\\d+ / p95 3\\d\\.\\d+ ms`));
  }
  const slow = run(30, 3000);
  assert.equal(slow.p.every, 1); assert.ok(slow.iv.slice(4).every((d) => Math.abs(d - B30) < 0.5));
  // off (?pace=0): every vsync
  const off = createPacer({ targetMs: B30, on: false }); let n = 0;
  for (let t = 0; t < 1000; t += 1000 / 60) if (off.due(t)) n++;
  assert.ok(n >= 59, `${n} frames`);
});

test('limiter: a late frame draws at once and the cadence picks up from it (no catch-up burst)', () => {
  const { iv } = run(60, 3000, { slowAt: 60 });
  const after = iv.slice(-50);
  assert.ok(after.every((d) => d > B30 - 1), 'never a 16.7 ms burst after the late one');
  assert.ok(iv.some((d) => d > 40), 'the late frame shows as one long interval');
});

test('the boat sails the same distance per real second under the limiter (the sim reads the real time between drawn frames)', () => {
  const sail = (paced) => {
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { sample: (x, z, t) => { const w = steadyWind(6, 200)(x, z, t); return { vx: w.vx, vz: w.vz }; } } });
    B.settle(20);
    const clock = createSimClock({ step: 1 / 120, hour0: 12, timerate: 0 });
    const pacer = paced ? createPacer({ targetMs: B30 }) : null, x0 = B.state.x, z0 = B.state.z;
    let prev = 0, frames = 0;
    for (let t = 1000 / 120; t <= 20000 + 1e-6; t += 1000 / 120) {   // a 120 Hz display, 20 s of real time
      if (pacer && !pacer.due(t)) continue;
      const dt = Math.min(0.25, (t - prev) / 1000); prev = t; frames++;
      const n = clock.advance(dt * 2);   // Sail's 2 × game speed, as the page's tick
      if (n > 0) B.step(n * clock.dt, { steer: 0, pull: 0 }, dt);
    }
    return { d: Math.hypot(B.state.x - x0, B.state.z - z0), frames, simT: clock.t };
  };
  const a = sail(false), b = sail(true);
  assert.ok(b.frames < a.frames / 3.5, `${b.frames} drawn frames vs ${a.frames}`);
  assert.ok(Math.abs(b.simT - a.simT) < 0.05, `sim time ${b.simT.toFixed(3)} vs ${a.simT.toFixed(3)} s`);
  assert.ok(Math.abs(b.d / a.d - 1) < 0.01, `distance ${b.d.toFixed(2)} vs ${a.d.toFixed(2)} m`);
});

test('a strong phone (Apple GPU, Adreno 7xx+) boots at L1 (MSAA 4, the full water path); weak phones keep L3', () => {
  const iphone = readSignals({ adapterInfo: { vendor: 'apple', architecture: 'common-3' }, ua: UA_IPHONE, touch: 5, screen: { w: 390, h: 844, dpr: 3 } });
  const g = guessLevel(iphone); assert.equal(g.level, 1); assert.equal(LEVELS[1].msaa, 4); assert.equal(LEVELS[1].waterLite, false);
  const a8 = readSignals({ adapterInfo: { vendor: 'qualcomm', architecture: 'adreno-8xx' }, ua: UA_PIXEL, touch: 5, screen: { w: 412, h: 915, dpr: 2.625 }, deviceMemory: 8 });
  assert.equal(guessLevel(a8).level, 1);
  const a6 = readSignals({ adapterInfo: { vendor: 'qualcomm', architecture: 'adreno-6xx' }, ua: UA_PIXEL, touch: 5, screen: { w: 412, h: 915, dpr: 2.625 } });
  assert.equal(guessLevel(a6).level, 3);
});

test('ladder at 30 fps: a strong phone keeps L1 at 26 ms of work (the old 60 fps rule dropped it); at 36 ms (over 78 % of 33.3 even at the governor\'s 0.85 scale) it settles lower', () => {
  const px = (k) => levelPixels(k, 390, 844, 3), fb = frameBudget(1000 / 120, { kind: 'phone' });
  const mk = () => { const l = createLadder({ level: 1, pxAt: px }); l.setBudget(fb.budgetMs, { held: true, aimK: fb.aimK }); return l; };
  const feed = (lad, work) => { let r = null; for (let t = 0; t < 7000; t += B30) r = lad.feed(work, t, px(1), false, { dt: B30, pixMs: work * 0.7 }) ?? r; return r; };
  const ok = mk(), r = feed(ok, 26);
  assert.equal(r.level, 1); assert.equal(ok.state().budgetMs, 26); assert.match(r.why, /78 % of 33\.3 ms, quality first/);
  const hot = mk(); assert.ok(feed(hot, 36).level >= 2, '36 ms at L1 does not leave thermal headroom');
  // under the old 60 fps rule the same 26 ms dropped L1
  const old = createLadder({ level: 1, pxAt: px }); assert.ok(feed(old, 26).level >= 2);
});

test('governor at 30 fps on a phone: raises only up to 78 % of the budget; frames held at 33.3 ms by the limiter are never cut', () => {
  const fb = frameBudget(1000 / 60, { kind: 'phone' });
  const g = createGovernor({ budgetMs: fb.budgetMs, start: 0.7, ...GOV_WORK }); g.setAim(fb.aimK);
  assert.equal(g.aim, 0.78);
  // work scales with the scale squared (all pixel-bound): 30 ms at scale 1
  for (let t = 0; t < 120000; t += B30) { const w = 30 * g.scale ** 2; g.feed(w, t, B30, w); }
  const w = 30 * g.scale ** 2;
  assert.ok(w <= 26.1, `work ${w.toFixed(1)} ms ≤ 26 ms (scale ${g.scale})`); assert.ok(g.scale > 0.85, `raised to ${g.scale}`);
  assert.equal(g.state().cuts, 0);
});

test('stored: a phone record from before the 30 fps hold is stale (boots at the new guess, L1); a new one is kept', () => {
  const now = Date.UTC(2026, 10, 15);
  const iphone = readSignals({ adapterInfo: { vendor: 'apple', architecture: 'common-3' }, ua: UA_IPHONE, touch: 5, screen: { w: 390, h: 844, dpr: 3 } });
  const key = gpuKey(iphone), s = memStore();
  s.setItem(STORE_KEY, JSON.stringify({ v: 1, gpu: key, level: 2, at: now - 864e5, why: 'old', measured: { workMs: 14, level: 2, px: 0.7e6, hz: 60, metric: 'vsync', vsync: true } }));
  const old = readStored(s, key, now);
  assert.equal(old.stale, true);
  const st = startLevel({ stored: old, guess: guessLevel(iphone), nowMs: now });
  assert.equal(st.level, 1); assert.equal(st.source, 'guess'); assert.match(st.why, /stored L2 .* was measured before phones were held at 30 fps: re-measuring/);
  // a step down stored under the new rule is kept: the next load builds the lower level's boat shadow and cloud key
  writeStored(s, key, 2, 'governor: L1 → L2', now, { workMs: 35, level: 1, px: 1.2e6, hz: 30 });
  const fresh = readStored(s, key, now + 1000);
  assert.equal(fresh.stale, false);
  const next = startLevel({ stored: fresh, guess: guessLevel(iphone), nowMs: now + 1000 });
  assert.equal(next.level, 2); assert.equal(LEVELS[next.level].boatShadow, 1024); assert.equal(LEVELS[next.level].cloudKey, 'small');
});

test('picture quality at 30 fps: a live phone\'s L2 and L3 draw more pixels (L2 up to 0.95 Mpx at DPR 2); captures and desks keep the caps', async () => {
  const { levelCaps, MOBILE30_CAPS } = await import('../engine/quality.js');
  assert.deepEqual(levelCaps(2, { mobile: true }), { dprCap: 2, maxPx: 0.95e6 });
  assert.deepEqual(levelCaps(3, { mobile: true }), { dprCap: 1.5, maxPx: 0.6e6 });
  assert.deepEqual(levelCaps(1, { mobile: true }), { dprCap: LEVELS[1].dprCap, maxPx: LEVELS[1].maxPx }, 'L1 as before');
  assert.deepEqual(levelCaps(2), { dprCap: LEVELS[2].dprCap, maxPx: LEVELS[2].maxPx }, 'a capture: the level caps');
  assert.equal(levelPixels(2, 390, 844, 3, { mobile: true }), 0.95e6);
  assert.equal(levelPixels(2, 390, 844, 3), 0.7e6);
  assert.ok(MOBILE30_CAPS[2].maxPx > LEVELS[2].maxPx);
});

test('heat: a phone\'s governor cuts work held over 82 % of 33.3 ms even with the frames on the limiter\'s 33.3 ms; a desk does not', () => {
  const mk = (kind) => { const fb = frameBudget(1000 / 60, { kind }); const g = createGovernor({ budgetMs: fb.budgetMs, ...GOV_WORK }); g.setAim(fb.aimK); return g; };
  const p = mk('phone'), d = mk('desk');
  for (let t = 0; t < 10000; t += B30) { p.feed(30 * p.scale ** 2, t, B30, 30 * p.scale ** 2); d.feed(30, t, B30, 30); }
  assert.ok(p.scale < 1 && 30 * p.scale ** 2 <= 27.4, `phone cut to ${p.scale} (${(30 * p.scale ** 2).toFixed(1)} ms)`);
  assert.equal(d.scale, 1, 'a desk at 30 ms keeps its pixels (30 fps held)');
});

test('settle under the held budget steps down one level at most (L1 → L2, never L1 → L3 on a pixel projection)', () => {
  const px = (k) => levelPixels(k, 402, 660, 3, { mobile: true }), fb = frameBudget(1000 / 60, { kind: 'phone' });
  const lad = createLadder({ level: 1, pxAt: px }); lad.setBudget(fb.budgetMs, { held: true, aimK: fb.aimK });
  let r = null; for (let t = 0; t < 7000; t += B30) r = lad.feed(40, t, px(1), false, { dt: 50, pixMs: 28 }) ?? r;
  assert.equal(r.level, 2); assert.match(r.why, /L1 → L2/);
});
