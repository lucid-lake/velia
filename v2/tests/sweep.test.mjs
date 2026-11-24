// perf(v2) phone: the diag sweep (v2/engine/sweep.js): each case alternated with and without in short ABBA blocks, every
// span booked by the frame's tag (read back frames later); a part's cost, a lever's saving (whichever state it started
// in), the spread; every case restored; robust to a drifting clock and to the readback's lag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSweep } from '../engine/sweep.js';

// drive a sweep like the page: a tag before each render, the span read back `lag` frames later
function drive(sw, cost, { lag = 3, drift = () => 0, noise = () => 0 } = {}) {
  const q = [];
  let i = 0;
  sw.start(0);
  while (sw.running && i < 100000) {
    const tag = sw.next(i * 16.7);
    q.push([tag, cost() + drift(i) + noise(i)]);
    if (q.length > lag) { const [t, ms] = q.shift(); sw.feed(t, ms); }
    i++;
  }
  return i;
}

test('the sweep: parts cost what dropping them saves; levers save the full path minus the phone path; each case restored', () => {
  const st = { water: true, sim: true, lite: true };
  const flips = [];
  const cost = () => 10 + (st.water ? 12 : 0) + (st.sim ? 4 : 0) + (st.lite ? 5 : 8);
  const sw = createSweep({ cases: [
    { name: 'water', kind: 'part', flip: (on) => { st.water = !on; flips.push(['water', on]); } },
    { name: 'water-sim', kind: 'pass', flip: (on) => { st.sim = !on; } },
    { name: 'lite', kind: 'lever', phoneOn: true, flip: (on) => { st.lite = !on; } },
  ] });
  assert.deepEqual(sw.lines(0), []);
  sw.start(0);
  assert.ok(sw.running);
  sw.next(0);
  assert.match(sw.lines(0)[0], /^sweep 1\/3: water \(pair 1\/8\) · \d+ s left/);
  const frames = drive(sw, cost);
  assert.ok(sw.done && !sw.running && frames < 3 * 8 * 2 * 4 + 20, `done in ${frames} frames`);
  const r = Object.fromEntries(sw.results().map((x) => [x.name, x]));
  assert.equal(r.water.ms, 12); assert.equal(r['water-sim'].ms, 4); assert.equal(r.lite.ms, 3);
  assert.equal(r.water.n, 8); assert.equal(r.water.spread, 0);
  assert.deepEqual(st, { water: true, sim: true, lite: true }, 'every case restored');
  assert.equal(flips.filter(([, on]) => on).length, 4, 'one flip on every two pairs (ABBA joins their middle blocks)');
  assert.deepEqual(flips.at(-1), ['water', false]);
  const lines = sw.lines().join('\n');
  assert.match(lines, /ABBA/);
  assert.match(lines, /parts ms: water 12\.00 ±0\.00/);
  assert.match(lines, /passes ms: water-sim 4\.00/);
  assert.match(lines, /phone path saves ms: lite 3\.00/);
});

test('the sweep: a lever measured from the full path reads the same sign; a drifting, noisy clock still gives the cost', () => {
  const st = { lite: false, part: true };
  const sw = createSweep({ cases: [
    { name: 'lite', kind: 'lever', phoneOn: false, flip: (on) => { st.lite = on; } },
    { name: 'towns', kind: 'part', flip: (on) => { st.part = !on; } },
  ], pairs: 12 });
  // a clock that ramps 10 ms over the sweep (a 30 Hz phone's GPU clock settling) and a ± 3 ms jitter
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  drive(sw, () => 20 + (st.lite ? 0 : 5) + (st.part ? 0.6 : 0), { drift: (i) => i * 0.05, noise: () => (rnd() - 0.5) * 6 });
  const r = Object.fromEntries(sw.results().map((x) => [x.name, x]));
  assert.ok(Math.abs(r.lite.ms - 5) < 1.2, `lite ${r.lite.ms}`);
  assert.ok(Math.abs(r.towns.ms - 0.6) < 1.2, `towns ${r.towns.ms}`);
  assert.ok(r.lite.spread > 0 && r.lite.spread < 3, `spread ${r.lite.spread}`);
  assert.deepEqual(st, { lite: false, part: true });
});

test('the sweep: an outlier frame in a block (a shadow redraw) does not move the case; untagged spans are ignored', () => {
  const st = { on: true }; let k = 0;
  const sw = createSweep({ cases: [{ name: 'boat', kind: 'part', flip: (on) => { st.on = !on; } }] });
  drive(sw, () => { k++; return 10 + (st.on ? 2 : 0) + (k % 12 === 0 ? 30 : 0); });
  sw.feed(0, 999);
  assert.equal(sw.results()[0].ms, 2);
});

test('fix(v2) governor: a case whose spread is not smaller than its value prints as unclear, never as a number', async () => {
  const { isClear } = await import('../engine/sweep.js');
  assert.equal(isClear(2, 0.5), true); assert.equal(isClear(-2, 0.5), true, 'a clear negative stays (signed)');
  assert.equal(isClear(0.3, 1.2), false); assert.equal(isClear(1.2, 1.2), false); assert.equal(isClear(NaN, 0), false); assert.equal(isClear(0, 0), false);
  const st = { big: true, tiny: true };
  let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const sw = createSweep({ cases: [
    { name: 'water', kind: 'part', flip: (on) => { st.big = !on; } },
    { name: 'towns', kind: 'part', flip: (on) => { st.tiny = !on; } },
  ] });
  drive(sw, () => 10 + (st.big ? 4 : 0) + (st.tiny ? 0.05 : 0), { noise: () => (rnd() - 0.5) * 3 });
  const r = Object.fromEntries(sw.results().map((x) => [x.name, x]));
  assert.equal(r.water.clear, true); assert.equal(r.towns.clear, false, `towns ${r.towns.ms} ±${r.towns.spread}`);
  const lines = sw.lines().join('\n');
  assert.match(lines, /sweep \(GPU work,/);
  assert.match(lines, /parts ms: water \d/);
  assert.ok(!/parts ms: .*towns/.test(lines), lines);
  assert.match(lines, /unclear \(spread ≥ value\): towns/);
});
