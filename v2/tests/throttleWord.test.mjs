// The throttle's lit word (v2/ui/throttleWord.js; owner, 2026-11-14): on for THR_WORD.holdS after a touch, on while a key is held,
// never on by itself. And the cockpit's one target (v2/ui/station.js cockpitTarget): whole or gone, never a peek.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ThrottleWordClock, THR_WORD } from '../ui/throttleWord.js';
import { cockpitTarget } from '../ui/station.js';

test('the throttle word: dark at the start, on after a touch, gone after its hold, back on the next touch', () => {
  const c = new ThrottleWordClock();
  assert.equal(c.tick(0.016), false, 'dark until the lever is touched');
  for (let i = 0; i < 300; i++) c.tick(0.016);
  assert.equal(c.on, false, 'still dark after 5 s with no touch');
  c.wake();
  assert.equal(c.tick(0.016), true);
  let t = 0; while (c.tick(0.05)) t += 0.05;
  assert.ok(Math.abs(t - THR_WORD.holdS) < 0.11, `held ${t.toFixed(2)} s`);
  for (let i = 0; i < 200; i++) assert.equal(c.tick(0.05), false, 'it never comes back by itself');
  c.wake();
  assert.equal(c.tick(0.016), true, 'the next touch shows it again');
});

test('the throttle word stays on while a lever key is held, and holds its time after the release', () => {
  const c = new ThrottleWordClock();
  c.hold(true);
  for (let i = 0; i < 100; i++) assert.equal(c.tick(0.05), true, 'held 5 s: on');
  c.hold(false);
  assert.equal(c.tick(1.0), true, '1 s after the release');
  assert.equal(c.tick(0.6), false, '1.6 s after the release');
});

test('the cockpit: shown whole with the dashboard up, gone whole otherwise; a peek never raises it', () => {
  assert.equal(cockpitTarget(null), 1, 'no Calm HUD: always up');
  assert.equal(cockpitTarget({ dash: true, fold: false, need: {}, wheel: 1 }), 1);
  assert.equal(cockpitTarget({ dash: false, fold: false, need: { main: true, thr: true }, wheel: 0.35 }), 0, 'a winch peek and a faint wheel: gone');
  assert.equal(cockpitTarget({ dash: false, fold: true, need: { jib: true }, wheel: 0 }), 0, 'folded with a peek: gone');
});
