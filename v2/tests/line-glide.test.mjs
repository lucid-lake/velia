// The build card's line glides on the compositor between real steps (v2/ui/lineGlide.js, v2/ui/buildCard.js lineSteps;
// owner 2026-11-18: "a loading bar that keeps moving even while the phone is busy building shaders"): one transform-only
// animation a step, never back, never past the next expected step, still moving long into a slow step, 1 only when ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import { glide, createLineGlide, CATCH_MS, PACE } from '../ui/lineGlide.js';
import { lineSteps, NEXT_MAX } from '../ui/buildCard.js';

test('one glide: eases up to the step, then creeps toward the cap, never reaching it, still moving late', () => {
  const g = glide(0.2, 0.3, 0.31, 500);
  assert.equal(g.values[0], 0.2);
  assert.ok(Math.abs(g.at(CATCH_MS) - 0.3) < 1e-9, 'at the step after the catch-up');
  for (let ms = 0, prev = -1; ms <= g.duration + 100; ms += 37) { const v = g.at(ms); assert.ok(v >= prev - 1e-12, `never back at ${ms}`); assert.ok(v < 0.31, `never at the cap (${v})`); prev = v; }
  assert.ok(g.at(CATCH_MS + 2000) - g.at(CATCH_MS + 1500) > 1e-4, 'still moving 1.5 to 2 s into the step');
  assert.deepEqual([g.offsets[0], g.offsets.at(-1)], [0, 1]);
  assert.ok(g.offsets.every((o, i) => i === 0 || o > g.offsets[i - 1]), 'offsets rise');
  const flat = glide(0.3, 0.3, 0.31, 500);
  assert.equal(flat.values[0], 0.3, 'already there: no catch-up, the creep at once');
});

function fakeFill() {
  return { anims: [], animate(frames, opts) { const a = { frames, opts, cancelled: false, cancel() { this.cancelled = true; } }; this.anims.push(a); return a; } };
}
const scales = (a) => a.frames.map((f) => parseFloat(/scaleX\(([\d.]+)\)/.exec(f.transform)[1]));

test('the driver: transform-only keyframes, never back, never past the next step, the pace follows the steps, done ends at 1', () => {
  globalThis.getComputedStyle = () => ({ transform: 'none' });
  let t = 0; const f = fakeFill();
  const g = createLineGlide(f, { now: () => t });
  let prevStart = 0;
  for (let k = 1; k <= 12; k++) {
    t += k === 6 ? 4000 : 280;   // one long compile in the middle
    const p = k / 40, next = (k + 1) / 40;
    g.step(p, next);
    const a = f.anims.at(-1), s = scales(a);
    assert.ok(a.frames.every((fr) => Object.keys(fr).every((key) => key === 'transform' || key === 'offset')), 'transform only (the compositor runs it)');
    assert.equal(a.opts.fill, 'forwards');
    assert.ok(s[0] >= prevStart - 1e-9, `step ${k}: starts where the line was, never back (${s[0]} after ${prevStart})`);
    assert.ok(Math.max(...s) < next + 1e-9, `step ${k}: never past the next step`);
    assert.ok(s.at(-1) > p, `step ${k}: still heading on past the step`);
    prevStart = s[0];
  }
  assert.ok(f.anims.slice(0, -1).every((a) => a.cancelled), 'each glide replaces the last');
  assert.ok(g.pace >= PACE.min && g.pace <= PACE.max, `the pace in bounds (${g.pace})`);
  const n = f.anims.length; g.step(12 / 40, 13 / 40); assert.equal(f.anims.length, n, 'the same step again: nothing new');
  t += 100; g.done();
  const end = scales(f.anims.at(-1)); assert.equal(end.at(-1), 1); assert.ok(end[0] >= prevStart);
  g.step(0.5, 0.6); assert.equal(scales(f.anims.at(-1)).at(-1), 1, 'nothing after done');
  g.stop(); assert.ok(f.anims.at(-1).cancelled);
  delete globalThis.getComputedStyle;
});

test('no animate() (an old browser, the stub DOM): a no-op', () => {
  const g = createLineGlide({}); g.step(0.5, 0.6); g.done(); assert.equal(g.value(), 0);
});

test('the line\'s steps: pipelines and assets one item each, the next one ahead, never 1 before ready', () => {
  assert.deepEqual(lineSteps({ ready: true }), [1, 1]);
  const [p, next] = lineSteps({ built: 40, total: 88, assets: { lake: true } });
  assert.ok(Math.abs(p - 41 / 91) < 1e-12 && Math.abs(next - 42 / 91) < 1e-12);
  const [p2, n2] = lineSteps({ built: 88, total: 88, assets: { lake: true, forest: true } });
  assert.ok(p2 < 1 && n2 <= NEXT_MAX && n2 >= p2);
  const [p0, n0] = lineSteps({ built: 0, total: 0, assets: {} });
  assert.ok(p0 === 0 && n0 > 0 && n0 <= 0.02, 'before the first frame: a short way only');
});
