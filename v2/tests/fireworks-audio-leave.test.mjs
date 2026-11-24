// The show's sound when the show is left (fix 2026-11-18, owner: "the last fireworks are left in the sky"; the sound too): the
// v2 wrapper (v2/audio/fireworks.js) stops the shells' voices at once (src/fireworks/sound.js hush) and, at its next update, fades
// a show piece the new hour does not want in LEAVE_FADE_S (not its own 4–10 s); the radio is the player's and plays on; a piece the
// new hour still wants (the drift home's at Night) is not touched. Behaviour only: the wrapper's calls, never the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFireworksAudio, LEAVE_FADE_S } from '../audio/fireworks.js';

function rig(want, { mode = 'sail', radio = false } = {}) {
  const core = { attach() {}, claimMusic() {}, yieldMusic() {}, mode: () => mode, radioOn: () => radio };
  const a = createFireworksAudio({ show: null, barges: [], scale: 1, core });
  const stops = [];
  let playing = want ? { want, name: want } : null;
  Object.defineProperty(a.music, 'playing', { get: () => playing });
  a.music.stop = (s) => { stops.push(s); playing = null; };
  a.music.update = () => {}; a.music.prefetch = () => {};
  return { a, stops };
}

test('leaving the show: the score stops in LEAVE_FADE_S at the next update; once only', () => {
  const { a, stops } = rig('score', { mode: 'cruise' });
  a.update(120, null, 1 / 60, 21.9);
  assert.deepEqual(stops, [], 'in the show the score plays');
  a.leave();
  assert.equal(a.leaves, 1);
  a.update(null, null, 1 / 60, 19.25);
  assert.deepEqual(stops, [LEAVE_FADE_S], 'Golden hour: the score fades at once');
  assert.ok(LEAVE_FADE_S <= 0.3);
  a.update(null, null, 1 / 60, 19.26);
  assert.equal(stops.length, 1, 'once');
});

test('leaving the show: the radio plays on (the player\'s); the drift home\'s piece stays where the new hour wants it', () => {
  const r = rig('radio', { radio: true });
  r.a.leave(); r.a.update(null, null, 1 / 60, 19.25);
  assert.deepEqual(r.stops, [], 'the radio is not stopped');
  const h = rig('home');
  h.a.leave(); h.a.update(null, null, 1 / 60, 22.5);
  assert.deepEqual(h.stops, [], 'Night: the drift home\'s piece is still wanted');
  const g = rig('home');
  g.a.leave(); g.a.update(null, null, 1 / 60, 19.25);
  assert.deepEqual(g.stops, [LEAVE_FADE_S], 'Golden hour: it fades at once');
});

test('leaving with no sound yet (the script not made, no context) does not throw', () => {
  const { a } = rig(null);
  assert.doesNotThrow(() => { a.leave(); a.update(null, null, 1 / 60, 13); });
});
