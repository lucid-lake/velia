// The dynamic-resolution governor (v2/engine/governor.js): pure, fed with ms and a time stamp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGovernor } from '../engine/governor.js';

// feed `seconds` of frames at `ms` each from time t (ms), 60 frames a second of wall time; returns the end time
const run = (g, t, seconds, ms, fps = 60) => { for (let i = 0; i < seconds * fps; i++) { t += 1000 / fps; g.feed(ms, t); } return t; };

test('warm-up: nothing moves in the first 3 s, however slow', () => {
  const g = createGovernor({ budgetMs: 16.7 });
  run(g, 0, 2.9, 40);
  assert.equal(g.scale, 1);
});

test('two slow windows cut 10 %; very slow cuts 20 %; the floor is 0.6', () => {
  const g = createGovernor({ budgetMs: 16.7 });
  let t = run(g, 0, 3.1, 10);
  t = run(g, t, 2.2, 22);              // > 1.2 × budget, two windows
  assert.ok(Math.abs(g.scale - 0.9) < 1e-9, `10 % cut, got ${g.scale}`);
  t = run(g, t, 2.2, 40);              // > 1.67 × budget
  assert.ok(Math.abs(g.scale - 0.72) < 1e-9, `20 % cut, got ${g.scale}`);
  run(g, t, 20, 60);
  assert.equal(g.scale, 0.6, 'the floor');
  assert.ok(g.state().cuts <= 5, 'at most 5 cuts');
});

test('a single slow window between fast ones does not cut', () => {
  const g = createGovernor({ budgetMs: 16.7 });
  let t = run(g, 0, 3.1, 10);
  t = run(g, t, 1.1, 30);
  t = run(g, t, 1.1, 10);
  t = run(g, t, 1.1, 30);
  assert.equal(g.scale, 1);
});

test('twelve fast windows raise 8 %, at most once per 20 s, never above max', () => {
  const g = createGovernor({ budgetMs: 16.7, start: 0.6 });
  let t = run(g, 0, 3.1, 5);
  t = run(g, t, 12.5, 5);
  assert.ok(Math.abs(g.scale - 0.648) < 1e-9, `one raise, got ${g.scale}`);
  t = run(g, t, 12.5, 5);             // 12 more fast windows but inside the 20 s cooldown
  assert.ok(Math.abs(g.scale - 0.648) < 1e-9, `cooldown holds, got ${g.scale}`);
  t = run(g, t, 60, 5);
  assert.ok(g.scale > 0.75 && g.scale <= 1, `keeps rising, got ${g.scale}`);
  run(g, t, 600, 5);
  assert.equal(g.scale, 1, 'capped at max');
});

test('disabled: the scale never moves; bad samples are ignored', () => {
  const g = createGovernor({ enabled: false });
  run(g, 0, 10, 100);
  assert.equal(g.scale, 1);
  const h = createGovernor();
  let t = run(h, 0, 3.1, 10);
  for (let i = 0; i < 200; i++) { t += 16; h.feed(NaN, t); h.feed(-1, t); h.feed(10, NaN); }
  assert.equal(h.scale, 1);
});

test('state() reports the numbers the stats hook shows', () => {
  const g = createGovernor({ budgetMs: 8.3 });
  const t = run(g, 0, 3.1, 4);
  run(g, t, 2.2, 20);
  const s = g.state();
  assert.deepEqual(Object.keys(s).sort(), ['budgetMs', 'ceiling', 'cuts', 'enabled', 'fast', 'frameMs', 'lastMean', 'min', 'raises', 'scale', 'slow', 'why']);
  assert.equal(s.cuts, 1); assert.equal(s.budgetMs, 8.3); assert.equal(s.lastMean, 20);
});

test('perf(v2) phone round 2: on the GPU span (slowK 1.05, fastK 0.85) an 18 ms frame on a 60 Hz phone cuts; 15 ms holds', () => {
  const old = createGovernor({ budgetMs: 1000 / 60 });
  let t = run(old, 0, 3.1, 18); run(old, t, 3, 18);
  assert.equal(old.scale, 1, 'the frame-time rule (1.2 ×) never cut a frame that missed every vsync');
  const g = createGovernor({ budgetMs: 1000 / 60, slowK: 1.05, fastK: 0.85 });
  t = run(g, 0, 3.1, 18); t = run(g, t, 2.2, 18);
  assert.ok(Math.abs(g.scale - 0.9) < 1e-9, `one 10 % cut, got ${g.scale}`);
  t = run(g, t, 30, 15.4);
  assert.ok(Math.abs(g.scale - 0.9) < 1e-9, '15.4 ms (between 0.85 and 1.05 ×) neither cuts nor raises');
  run(g, t, 40, 12);
  assert.ok(g.scale > 0.9, 'a raise after 12 fast windows under 0.85 ×');
});
