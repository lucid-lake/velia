// fix(v2) desktop quality (the owner's MacBook, 2026-11-15): its L0 draws closer to native, its old stored levels are
// stale. perf(v2) phone 30 fps (owner, the same day: "on macbook ... we should aim at high picture quality first"): a desk
// page cuts picture quality only when its frames fall under 30 fps (a 33.3 ms budget), with no frame limiter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameBudget, createGovernor, GOV_WORK } from '../engine/governor.js';
import { readStored, writeStored, startLevel, createLadder, levelCaps, levelParams, levelPixels, readSignals, gpuKey, guessLevel, STORE_KEY, LEVELS, DESK_MAXPX } from '../engine/quality.js';

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const mac = readSignals({ adapterInfo: { vendor: 'apple', architecture: 'metal-3' }, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/157', platform: 'MacIntel', screen: { w: 1512, h: 785, dpr: 2 } });
const iphone = readSignals({ adapterInfo: { vendor: 'apple', architecture: 'metal-3' }, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1', touch: 5, screen: { w: 402, h: 874, dpr: 3 } });
const B30 = 1000 / 30;

test('budget: a desktop cuts only below 30 fps (33.3 ms) on any display, with no limiter', () => {
  for (const hz of [60, 100, 120, 144, 165, 240]) {
    const d = frameBudget(1000 / hz, { desk: true });
    assert.ok(Math.abs(d.budgetMs - B30) < 1e-9, `${hz} Hz desk → 33.3 ms`); assert.equal(d.hz, hz); assert.equal(d.aimK, 1); assert.equal(d.limit, false);
  }
  assert.equal(frameBudget(1000 / 120, { desk: true }).why, 'budget 33.3 ms: quality first: cuts only below 30 fps (the 120 Hz display)');
});

test('governor: a desk on a 120 Hz display at 20 ms GPU work keeps scale 1 (no cut above 30 fps)', () => {
  const fb = frameBudget(1000 / 120, { desk: true });
  const g = createGovernor({ budgetMs: fb.budgetMs, ...GOV_WORK }); g.setAim(fb.aimK);
  for (let t = 0; t < 60000; t += 20) g.feed(20, t, 20, 15);   // 50 fps, 20 ms of work, the scene 15 ms
  assert.equal(g.scale, 1); assert.equal(g.state().cuts, 0);
  // and 8.8 ms of work, frames at 10.5 ms (the owner's MacBook): scale 1; the old 8.3 ms budget cut it
  const run = (budgetMs) => { const h = createGovernor({ budgetMs, ...GOV_WORK }); for (let t = 0; t < 60000; t += 1000 / 95) h.feed(8.8, t, 10.5, 6.5); return h.scale; };
  assert.equal(run(fb.budgetMs), 1);
  assert.ok(run(1000 / 120) < 0.9, 'the old 8.3 ms budget cuts the scale');
});

test('governor: a desk at 40 ms GPU work (25 fps) cuts the scale toward the 33.3 ms budget', () => {
  const fb = frameBudget(1000 / 120, { desk: true });
  const g = createGovernor({ budgetMs: fb.budgetMs, ...GOV_WORK }); g.setAim(fb.aimK);
  for (let t = 0; t < 10000; t += 40) g.feed(40, t, 40, 30);
  assert.ok(g.scale < 1, `cut (scale ${g.scale})`); assert.ok(g.state().cuts >= 1);
  assert.match(g.why, /cut|hold/);
});

test('ladder: a desk whose work fits 33.3 ms never steps down; one at the scale floor missing 30 fps does', () => {
  const pxAt = (k) => levelPixels(k, 1512, 785, 2, { desk: true }), fb = frameBudget(1000 / 120, { desk: true });
  const lad = createLadder({ level: 0, pxAt }); lad.setBudget(fb.budgetMs, { held: true, aimK: fb.aimK });
  const px = pxAt(0), steps = [];
  // 24 ms of GPU work, frames at 25 ms (40 fps), the governor at its floor: nothing to step (it was L1 under 60 fps)
  for (let t = 0; t < 90000; t += 25) { const r = lad.feed(24, t, px, true, { dt: 25, pixMs: 18 }); if (r?.changed) steps.push(r.level); }
  assert.deepEqual(steps, []); assert.equal(lad.level, 0); assert.equal(lad.phase, 'settled'); assert.equal(lad.state().budgetMs, 33.33);
  const slow = createLadder({ level: 0, pxAt }); slow.setBudget(fb.budgetMs, { held: true, aimK: 1 });
  for (let t = 0; t < 30000; t += 50) slow.feed(50, t, px, true, { dt: 50, pixMs: 40 });
  assert.ok(slow.level >= 1, '20 fps at the floor: a level down');
});

test('stored: a desk record from the 60 fps hold (desk60) is stale (boots at the guess); a new one is kept', () => {
  const now = Date.UTC(2026, 10, 15), key = gpuKey(mac), s = memStore();
  assert.equal(key, 'apple|metal-3|desk');
  s.setItem(STORE_KEY, JSON.stringify({ v: 1, gpu: key, level: 1, at: now - 864e5, why: 'old', measured: { workMs: 18, level: 0, px: 3.4e6, hz: 60, metric: 'work', rule: 'desk60' } }));
  const old = readStored(s, key, now);
  assert.equal(old.stale, true);
  const st = startLevel({ stored: old, guess: guessLevel(mac), nowMs: now });
  assert.equal(st.level, 0); assert.equal(st.source, 'guess'); assert.match(st.why, /before quality first \(cuts only below 30 fps\): re-measuring/);
  writeStored(s, key, 1, 'new', now, { workMs: 40, level: 0, px: 4.75e6, hz: 30 });
  const fresh = readStored(s, key, now);
  assert.equal(fresh.stale, false); assert.equal(startLevel({ stored: fresh, guess: guessLevel(mac), nowMs: now }).source, 'stored');
  assert.equal(JSON.parse(s.getItem(STORE_KEY)).measured.rule, 'q30');
  // a phone writes the same rule
  const pk = gpuKey(iphone), ps = memStore();
  writeStored(ps, pk, 2, 'phone', now, { workMs: 10, level: 2, px: 0.7e6, hz: 30 });
  assert.equal(JSON.parse(ps.getItem(STORE_KEY)).measured.rule, 'q30');
});

test('caps: a live desk page\'s L0 draws up to native (8.3 Mpx); phones, captures and L1–L3 keep the level caps', () => {
  assert.equal(levelCaps(0, { desk: true }).maxPx, DESK_MAXPX);
  assert.equal(levelCaps(0).maxPx, LEVELS[0].maxPx);
  for (const k of [1, 2, 3]) assert.deepEqual(levelCaps(k, { desk: true }), { dprCap: LEVELS[k].dprCap, maxPx: LEVELS[k].maxPx });
  assert.equal(levelPixels(0, 1512, 785, 2, { desk: true }), 3024 * 1570);   // the owner's MacBook window, native
  assert.equal(levelPixels(0, 1512, 785, 2), 3.4e6);
  assert.equal(levelParams({ maxPx: 1, dprCap: 1, msaa: 4 }, 0, new Set(), { desk: true }).maxPx, DESK_MAXPX);
  assert.equal(levelParams({ maxPx: 5e6, dprCap: 1, msaa: 4 }, 0, new Set(['maxpx']), { desk: true }).maxPx, 5e6, '?maxpx= wins');
});

test('?diag=1: a desk\'s panel names the display\'s rate and "quality first: cuts only below 30 fps"', async () => {
  const { diagLines } = await import('../engine/diag.js');
  const fb = frameBudget(1000 / 120, { desk: true });
  const t = diagLines({ frame: { avg: 10.5, worst: 16 }, budgetMs: fb.budgetMs, refreshHz: fb.hz, budgetWhy: fb.why, refreshMeasured: true, refreshSource: 'frames', gov: { scale: 1, min: 0.6, cuts: 0 }, errors: [] }).join('\n');
  assert.match(t, /pace 120 Hz display \(budget 33\.3 ms\) · scale 1\.00/);
  assert.match(t, /\n {2}budget 33\.3 ms: quality first: cuts only below 30 fps \(the 120 Hz display\)/);
  assert.doesNotMatch(t, /pacing/, 'no limiter on a desk');
});
