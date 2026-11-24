// The fixed-step sim clock (v2/engine/clock.js): deterministic steps, a capped catch-up, the hour from sim time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimClock } from '../engine/clock.js';

test('advance runs whole steps and carries the remainder; the same dts give the same t on any machine', () => {
  const a = createSimClock({ step: 1 / 120 }), b = createSimClock({ step: 1 / 120 });
  const dts = [0.0167, 0.0166, 0.0168, 0.033, 0.001, 0.0167];
  for (const d of dts) a.advance(d);
  for (const d of dts) b.advance(d);
  assert.equal(a.t, b.t); assert.equal(a.steps, b.steps);
  assert.equal(a.steps, Math.floor(dts.reduce((s, x) => s + x, 0) * 120));
  assert.ok(Math.abs(a.t - a.steps / 120) < 1e-12);
});

test('a stall runs at most maxSteps and drops the rest (never replays a minute later)', () => {
  const c = createSimClock({ step: 1 / 120, maxSteps: 10 });
  assert.equal(c.advance(2.0), 10);
  assert.equal(c.advance(1 / 120), 1, 'nothing carried from the stall');
  assert.equal(c.advance(0), 0); assert.equal(c.advance(-1), 0); assert.equal(c.advance(NaN), 0);
});

test('headless: step() is exactly one step; 30 steps at 1/120 s is 0.25 s', () => {
  const c = createSimClock({ step: 1 / 120, t0: 0 });
  for (let i = 0; i < 30; i++) c.step();
  assert.ok(Math.abs(c.t - 0.25) < 1e-12); assert.equal(c.steps, 30);
});

test('the hour is a pure function of sim time: hour0 + t × timerate / 3600, wrapped at 24', () => {
  const frozen = createSimClock({ hour0: 13, timerate: 0 });
  frozen.advance(100); assert.equal(frozen.hour, 13);
  const c = createSimClock({ hour0: 23.5, timerate: 3600, t0: 0 });   // 1 h per sim s
  assert.equal(c.hour, 23.5);
  assert.ok(Math.abs(c.hourAt(1) - 0.5) < 1e-9);
  assert.ok(Math.abs(c.hourAt(2.25) - 1.75) < 1e-9);
  const t0 = createSimClock({ hour0: 6, timerate: 10, t0: 360 });
  assert.ok(Math.abs(t0.hour - 7) < 1e-9, '?t pins the start sim time');
});

test('glide: one cut that eases the hour to its target over secs, then the schedule runs on from it; never backwards', () => {
  const c = createSimClock({ hour0: 18, timerate: 10 });
  const seen = []; c.onCut((e) => seen.push(e));
  c.advance(0.5);
  c.glide(21.5, 2);
  assert.equal(c.cuts, 1);
  assert.deepEqual(seen.map((e) => [e.to, e.secs]), [[21.5, 2]]);
  const t0 = c.t, h0 = c.hourUnwrapped;
  let prev = h0;
  for (let i = 1; i <= 20; i++) { const h = c.hourUnwrappedAt(t0 + i * 0.1); assert.ok(h >= prev, `monotonic at ${i}`); prev = h; }
  assert.ok(Math.abs(c.hourUnwrappedAt(t0 + 1) - (h0 + 21.5) / 2) < 1e-9, 'smoothstep: half way at half time');
  assert.ok(Math.abs(c.hourUnwrappedAt(t0 + 2) - 21.5) < 1e-9, 'lands on the target');
  assert.ok(Math.abs(c.hourUnwrappedAt(t0 + 2 + 360) - 22.5) < 1e-9, 'then the rate runs on from the target (10 game s per s)');
  assert.equal(c.rateAt(t0 + 0.5), 10, 'the glide reports the pace it lands on');
});
