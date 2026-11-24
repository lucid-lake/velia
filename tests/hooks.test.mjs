// The hooks that replaced the kayak fleet's patches (refactor round 2, Phase D): the follow camera's input observers
// and the film service's onStep list (src/kayaks/fleet.js uses both).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FollowCamera } from '../src/sim/boat/followCamera.js';
import { withStepHooks } from '../classic/src/core/filmHooks.js';

const state = { x: 0, z: 0, heave: 0, heading: 0, sog: 2 };

test('the follow camera: an input observer sees each update\'s input before the camera moves; off stops it; the pose is unchanged', () => {
  const a = new FollowCamera(), b = new FollowCamera();
  const seen = [];
  const off = a.onInput((input) => seen.push([input, a.yaw]));
  const drag = { orbit: [0.1, 0] };
  const pa = a.update(1 / 60, state, drag), pb = b.update(1 / 60, state, drag);
  assert.deepEqual(pa, pb, 'the same pose with or without an observer');
  assert.equal(seen.length, 1); assert.equal(seen[0][0], drag); assert.equal(seen[0][1], 0, 'seen before the orbit turned the camera');
  a.update(1 / 60, state);
  assert.deepEqual(seen[1][0], {}, 'no input: an empty one');
  off(); a.update(1 / 60, state, drag);
  assert.equal(seen.length, 2, 'off: no more calls');
});

test('the film service: onStep hooks run after each step, in order, with its dt; step returns the mode\'s state; off removes one', () => {
  const log = [];
  const film = withStepHooks({ state: () => 's', step: (dt) => { log.push(['mode', dt]); return { t: dt }; } });
  const offA = film.onStep((dt) => log.push(['a', dt]));
  film.onStep((dt) => log.push(['b', dt]));
  assert.deepEqual(film.step(0.5), { t: 0.5 });
  assert.deepEqual(log, [['mode', 0.5], ['a', 0.5], ['b', 0.5]]);
  offA(); log.length = 0; film.step(0.25);
  assert.deepEqual(log, [['mode', 0.25], ['b', 0.25]]);
});
