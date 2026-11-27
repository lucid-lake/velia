// The Tessie RPG's gamer-lens follow-ups: the RPG on by default where she is playable (?tessierpg=0 off).
// Behaviour: the flag table's default, the off switch, and the page's player built with the RPG from that default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseV2Flags } from '../engine/flags.js';

test('the RPG is on by default; ?tessierpg=0 turns it off; ?tessierpg=1 still reads on', () => {
  assert.equal(parseV2Flags('').tessierpg, true, 'no flag: the RPG is on');
  assert.equal(parseV2Flags('?tessierpg=0').tessierpg, false, '?tessierpg=0: off');
  assert.equal(parseV2Flags('?tessierpg=1').tessierpg, true, 'the old URL still turns it on');
});
