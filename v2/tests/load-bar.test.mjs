// The voyage bar's motion (v2/ui/loadBar.js, fix/v2-loading-feel): the creep's shape and the driver's rules, on fake
// elements that record their animations. The page check (the bar moving on screen under a phone throttle):
// v2/tests/pages/loadingFeel.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { creep, scaleOf, installLoadBar, MILESTONES, MAX_BEFORE_READY, REARM_MS } from '../ui/loadBar.js';
const NO_TIMER = { every: () => 0, clear: () => {} };   // the rearm interval is driven by hand here

test('a creep rises from its start, slows, never reaches its cap, and still moves long after its half time', () => {
  const c = creep(0.2, 0.6, 1000);
  assert.equal(c.values[0], 0.2);
  for (let i = 1; i < c.values.length; i++) assert.ok(c.values[i] > c.values[i - 1], 'strictly rising');
  assert.ok(c.values.at(-1) < 0.6 && c.values.at(-1) > 0.57);
  assert.equal(c.offsets[0], 0); assert.equal(c.offsets.at(-1), 1);
  assert.ok(c.at(1000) > 0.39 && c.at(1000) < 0.41, 'half the gap in its half time');
  // a stage ten times longer than planned: the line still moves more than 0.12 % of its length (a device pixel on a phone) in each 0.5 s
  assert.ok(c.at(10500) - c.at(10000) > 0.0012);
  for (let t = 0; t < c.duration; t += 37) assert.ok(c.at(t + 37) >= c.at(t));
});

test('a computed transform gives its scale', () => {
  assert.equal(scaleOf('matrix(0.25, 0, 0, 1, 0, 0)'), 0.25);
  assert.equal(scaleOf('none'), 1);
  assert.ok(Number.isNaN(scaleOf('bogus')));
});

function fakeRoot() {
  const mk = () => ({ style: {}, anims: [], animate(frames, opts) { const a = { frames, opts, cancelled: false, cancel() { this.cancelled = true; } }; this.anims.push(a); return a; } });
  const els = { '.lk-sailed': mk(), '.lk-psloop': mk() };
  return { els, querySelector: (s) => els[s] ?? null };
}
const scales = (a) => a.frames.map((f) => parseFloat(/scaleX\(([\d.]+)\)/.exec(f.transform)[1]));

test('the driver: milestones only push forward, nothing passes 0.9 before ready, ready ends at 1, the sloop matches the line', () => {
  globalThis.getComputedStyle = () => ({ transform: 'matrix(0.05, 0, 0, 1, 0, 0)' });   // the shell's CSS creep had reached 5 %
  let t = 0; const root = fakeRoot();
  const bar = installLoadBar({ root, now: () => t, ...NO_TIMER });
  const S = root.els['.lk-sailed'], B = root.els['.lk-psloop'];
  assert.equal(scales(S.anims[0])[0], 0.054, 'the hand-over starts where the CSS creep was (a hair ahead)');
  assert.equal(S.style.animation, 'none');
  const order = ['gate', 'gpu', 'terrain', 'water', 'sky', 'boat'];
  let last = 0.05;
  for (const [i, n] of order.entries()) {
    t += i === 2 ? 30000 : 200;   // one very long stage: the creep stays under its cap
    bar.mark(n);
    const s = scales(S.anims.at(-1));
    assert.ok(s[0] >= last - 1e-9, `${n}: no step back (${s[0]} after ${last})`);
    assert.ok(s[0] >= MILESTONES[n][0] - 1e-9, `${n}: at least its floor`);
    assert.ok(Math.max(...s) <= MAX_BEFORE_READY + 1e-9, `${n}: under 0.9`);
    const pct = B.anims.at(-1).frames.map((f) => parseFloat(/translateX\(([\d.]+)%\)/.exec(f.transform)[1]) / 100);
    assert.ok(pct.length === s.length && pct.every((x, k) => Math.abs(x - s[k]) < 2e-4), 'the sloop sails at the line\'s end');
    last = s[0];
  }
  assert.ok(S.anims.slice(0, -1).every((a) => a.cancelled), 'each creep replaces the last');
  t += 300; bar.ready();
  const end = scales(S.anims.at(-1));
  assert.equal(end.at(-1), 1); assert.ok(end[0] >= last);
  bar.mark('boat');
  assert.equal(scales(S.anims.at(-1)).at(-1), 1, 'nothing after ready moves it back');
  delete globalThis.getComputedStyle;
});

test('no bar markup: a no-op', () => {
  const bar = installLoadBar({ root: { querySelector: () => null }, ...NO_TIMER });
  bar.mark('gpu'); bar.ready(); bar.stop();
  assert.equal(bar.value(), 0);
});

test('a stage far past its plan: the creep restarts toward a farther cap, keeps a pace, never back, never past 0.9', () => {
  globalThis.getComputedStyle = () => ({ transform: 'none' });
  let t = 0, cleared = 0; const root = fakeRoot();
  const bar = installLoadBar({ root, now: () => t, every: () => 7, clear: (id) => { if (id === 7) cleared++; } });
  const S = root.els['.lk-sailed'];
  bar.mark('gate');
  t += REARM_MS - 1; bar.rearm();
  assert.equal(bar.log.at(-1)[0], 'gate', 'not before REARM_MS');
  let last = bar.value();
  for (let i = 0; i < 40; i++) {   // 100 s with no milestone
    t += REARM_MS; const before = bar.value(); bar.rearm();
    const s = scales(S.anims.at(-1));
    assert.ok(s[0] >= before - 1e-4 && s[0] >= last - 1e-4, 'never back (4-decimal keyframes)');
    assert.ok(Math.max(...s) <= MAX_BEFORE_READY + 1e-9, 'under 0.9');
    if (i < 10) assert.ok(s.at(-1) - s[0] > 0.01, `room left to move after ${i + 1} restarts`);
    last = s[0];
  }
  assert.ok(last > 0.6, `the long wait still sailed most of the way (${last.toFixed(2)})`);
  bar.ready(); assert.equal(cleared, 1, 'the interval stops at ready');
  delete globalThis.getComputedStyle;
});
