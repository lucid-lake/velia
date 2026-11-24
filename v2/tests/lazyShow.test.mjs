// The fireworks show off the boot path (v2/sim/lazyShow.js, perf/v2-phone-load): when the script is needed, made once,
// made late as the same show, and the riser memo (src/fireworks/physics.js) gives the same numbers as a fresh bisection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showNeed, createLazy, PREP_HOURS } from '../sim/lazyShow.js';
import { gameShow, showClock, createShowState, SHOW_LENGTH } from '../sim/fireworks.js';
import { riserFor } from '../../src/fireworks/physics.js';

test('a midday page never needs the show; the evening asks for it soon; the show window now', () => {
  for (const hour of [6, 12, 13.5, 19.9]) assert.equal(showNeed({ t: null, hour }), null, `hour ${hour}`);
  for (const hour of [PREP_HOURS[0], 20.5, 21]) assert.equal(showNeed({ t: null, hour }), 'soon', `hour ${hour}`);
  assert.equal(showNeed({ t: null, hour: 23.6 }), null);
  // the show clock of a page opened in the window (or ?fwt pinned) runs: needed now, whatever the hour
  const inShow = showClock({ hour0: 21.75 })(0, 21.75), pinned = showClock({ pin: 120, hour0: 12 })(0, 12), noon = showClock({ hour0: 12 })(0, 12);
  assert.ok(inShow != null && pinned != null && noon == null);
  assert.equal(showNeed({ t: inShow, hour: 21.75 }), 'now');
  assert.equal(showNeed({ t: pinned, hour: 12 }), 'now');
  assert.equal(showNeed({ t: noon, hour: 12 }), null);
});

test('createLazy builds once, on get or in one idle slice, never twice', () => {
  let builds = 0;
  const slices = [];
  const L = createLazy(() => ({ n: ++builds }), { idle: (fn) => slices.push(fn) });
  assert.equal(L.built, false); assert.equal(builds, 0);
  L.soon(); L.soon();
  assert.equal(slices.length, 1, 'one idle slice queued however often soon() is called');
  assert.equal(builds, 0, 'nothing built until the slice runs');
  slices.shift()();
  assert.equal(L.built, true); assert.equal(builds, 1);
  assert.deepEqual(L.get(), { n: 1 });
  L.soon(); assert.equal(slices.length, 0, 'built: no more slices');
  // get() before the slice runs: built at once; the slice then does nothing
  let b2 = 0; const s2 = [];
  const M = createLazy(() => ++b2, { idle: (fn) => s2.push(fn) });
  M.soon(); assert.equal(M.get(), 1); s2.shift()(); assert.equal(b2, 1);
});

test('a show made late is the same show, and the state plays it the same as one made at boot', () => {
  const early = gameShow(1, { tall: true });
  const late = gameShow(1, { tall: true });
  assert.deepEqual(late, early);
  const a = createShowState({ show: early, tier: 'phone' });
  const b = createShowState({ show: { seed: 1, length: SHOW_LENGTH, events: [] }, tier: 'phone' });
  b.setShow(late);   // the plug-in's lazy path: an empty script first, the real one before the window
  for (const s of [a, b]) { const { t0, n } = s.seekPlan(60); s.setTime(t0); for (let k = 0; k < n; k++) { s.spawnDue(s.t + 1 / 60 + 0.5); s.advance(1 / 60); } s.after(60); }
  assert.deepEqual(b.stats(), a.stats());
  assert.ok(a.stats().spawned > 0);
  assert.deepEqual(Array.from(b.staging.subarray(0, 28 * 200)), Array.from(a.staging.subarray(0, 28 * 200)));
});

test('the riser memo returns the bisection\'s own numbers', () => {
  for (const h of [40, 133, 180, 241, 300]) {
    const fresh = riserFor(h, {});   // options given: a fresh bisection, never the memo
    const memo = riserFor(h);
    assert.equal(memo.v0, fresh.v0); assert.equal(memo.t, fresh.t); assert.deepEqual([...memo.apex], fresh.apex);
    assert.equal(riserFor(h), memo, 'the second ask is the kept answer');
  }
});
