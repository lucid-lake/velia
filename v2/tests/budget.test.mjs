// The governor's frame budget from the display's refresh (v2/engine/governor.js budgetFromRefresh, createRefreshProbe):
// 120 Hz gives 8.33 ms, 60 Hz 16.67 ms, jitter and dropped frames do not move it, an odd rate is kept as measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetFromRefresh, createRefreshProbe, createGovernor, REFRESH_RATES } from '../engine/governor.js';

const jitter = (ms, n, drops = 0) => { const a = []; for (let i = 0; i < n; i++) a.push(ms + ((i * 7919) % 11 - 5) * 0.03); for (let i = 0; i < drops; i++) a[i * 5] = ms * 2; return a; };

test('120 Hz → 8.33 ms; 60 Hz → 16.67 ms; ProMotion jitter and a few dropped frames do not move it', () => {
  assert.ok(Math.abs(budgetFromRefresh(jitter(8.33, 60)) - 1000 / 120) < 1e-9);
  assert.ok(Math.abs(budgetFromRefresh(jitter(16.7, 60, 6)) - 1000 / 60) < 1e-9);
  assert.ok(Math.abs(budgetFromRefresh(jitter(8.6, 60, 8)) - 1000 / 120) < 1e-9, 'within 6 % of 120 Hz, with drops');
  assert.ok(Math.abs(budgetFromRefresh(jitter(6.94, 50)) - 1000 / 144) < 1e-9);
});

test('too few samples: the default; an odd rate snaps to the nearest known one; nonsense is filtered', () => {
  assert.equal(budgetFromRefresh([]), 1000 / 60);
  assert.equal(budgetFromRefresh([8, 8, 8]), 1000 / 60);
  assert.equal(budgetFromRefresh([8, 8, 8], { dflt: 8.3 }), 8.3);
  // fix(v2) governor: every reading snaps (no display runs at 82.6 or 56 Hz): 12.1 ms is 85 Hz
  assert.ok(Math.abs(budgetFromRefresh(jitter(12.1, 40)) - 1000 / 85) < 1e-9);
  assert.ok(Math.abs(budgetFromRefresh([0, 0, 1, 500, ...jitter(8.33, 30)]) - 1000 / 120) < 1e-9);
  assert.ok(REFRESH_RATES.includes(120) && REFRESH_RATES.includes(60));
});

test('the probe reports once after skip + n frames and the governor takes the budget', () => {
  const g = createGovernor({ budgetMs: 1000 / 60 });
  let reported = 0;
  const probe = createRefreshProbe((b) => { reported++; g.setBudget(b); }, { n: 20, skip: 5 });
  let t = 1000;
  for (let i = 0; i < 25; i++) { probe.sample(t); t += 8.33; }
  assert.equal(reported, 0, 'not yet: 24 intervals seen, 5 skipped, 20 needed');
  probe.sample(t); t += 8.33;
  assert.equal(reported, 1, 'the 25th interval is the 20th kept'); assert.ok(probe.done);
  assert.ok(Math.abs(g.budgetMs - 1000 / 120) < 1e-9); assert.equal(g.state().budgetMs, 8.33);
  for (let i = 0; i < 100; i++) { probe.sample(t); t += 16.7; }
  assert.equal(reported, 1, 'once only');
  g.setBudget(NaN); g.setBudget(-1);
  assert.ok(Math.abs(g.budgetMs - 1000 / 120) < 1e-9, 'bad budgets ignored');
});

test('with the 8.33 ms budget the governor cuts at 10 ms frames and holds at 7 ms', () => {
  const run = (g, t, s, ms) => { for (let i = 0; i < s * 120; i++) { t += 1000 / 120; g.feed(ms, t); } return t; };
  const g = createGovernor({ budgetMs: 1000 / 60 }); g.setBudget(1000 / 120);
  let t = run(g, 0, 3.1, 7);
  t = run(g, t, 2.2, 7); assert.equal(g.scale, 1, '7 ms holds at 120 Hz');
  run(g, t, 3.2, 10.5); assert.ok(g.scale < 1, '10.5 ms (> 1.2 × 8.33) cuts after two slow windows');
});

test('perf(v2) phone round 2: GPU-bound frames quantized to 30 Hz on a 60 Hz display are not read as a 30 Hz display', async () => {
  const { refreshEvidence, idleBudget } = await import('../engine/governor.js');
  assert.equal(refreshEvidence(33.3, 20), false, 'a 20 ms span in a 33 ms interval: a missed vsync, not evidence');
  assert.equal(refreshEvidence(33.3, 12), true, 'a 12 ms span in a 33 ms interval: the display is 30 Hz');
  assert.equal(refreshEvidence(16.7, 15), true, 'a short interval is always evidence');
  assert.equal(refreshEvidence(33.3, null), true, 'no timer: the old rule');
  const run = (dt, gpu, idle = null) => { let b = null, info = null; const p = createRefreshProbe((x, i) => { b = x; info = i; }, { n: 30, skip: 2 }); if (idle) p.setIdle(idle); let t = 0; for (let i = 0; i < 40; i++) { p.sample(t, gpu); t += dt; } return { b, info }; };
  let r = run(33.33, 20);
  assert.ok(Math.abs(r.b - 1000 / 60) < 1e-9, `60 Hz assumed: ${r.b}`); assert.equal(r.info.source, 'default'); assert.equal(r.info.quantized, true);
  r = run(33.33, 20, idleBudget(Array(30).fill(16.7).concat(Array(10).fill(50))));
  assert.ok(Math.abs(r.b - 1000 / 60) < 1e-9); assert.equal(r.info.source, 'idle');
  r = run(33.33, 20, 1000 / 30);
  assert.ok(Math.abs(r.b - 1000 / 30) < 1e-9, 'Low Power Mode: 30 Hz at load too');
  r = run(33.33, 12);
  assert.ok(Math.abs(r.b - 1000 / 30) < 1e-9, 'light frames at 33 ms: a 30 Hz display'); assert.equal(r.info.source, 'frames');
  r = run(33.33, 12, 1000 / 60);
  assert.ok(Math.abs(r.b - 1000 / 60) < 1e-9, 'a faster idle reading wins over a 30 Hz frames reading');
  r = run(8.33, 5);
  assert.ok(Math.abs(r.b - 1000 / 120) < 1e-9, 'a 120 Hz Mac');
  assert.equal(idleBudget([16.7, 16.6]), null, 'too few');
  assert.ok(Math.abs(idleBudget([16.7, 16.6, 16.8, 33, 40, 70, 16.7, 16.7, 50, 16.6, 16.7, 33, 90, 16.7]) - 1000 / 60) < 1e-9, 'a busy load: the lowest third');
});
