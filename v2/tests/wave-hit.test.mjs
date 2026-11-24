// The bow's wave hits (fix/v2-wave-hit-sound, 2026-11-15): ?wavehit= picks the sound of v1's slap and slam events on v2's beds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WAVE_HIT, waveHitMode } from '../audio/recorded.js';
import { parseV2Flags } from '../engine/flags.js';

test('?wavehit= reads rec, synth, today or off; anything else (or none) is the default, the recording', () => {
  assert.equal(WAVE_HIT.dflt, 'rec');
  for (const m of ['rec', 'synth', 'today', 'off']) assert.equal(waveHitMode(parseV2Flags(`?wavehit=${m}`).wavehit), m);
  assert.equal(waveHitMode(parseV2Flags('').wavehit), 'rec');
  assert.equal(waveHitMode(parseV2Flags('?wavehit=metal').wavehit), 'rec');
});
