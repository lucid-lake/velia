// fix/ios-start: "Best on a desktop browser" only on touch devices, once on the card, then only in About
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteState, NOTE, WHY } from '../src/ui/desktopNote.js';

test('a desktop never sees it; a phone sees it once on the card and always in About', () => {
  assert.deepEqual(noteState({ touch: false, seen: false }), { card: false, about: false });
  assert.deepEqual(noteState({ touch: true, seen: false }), { card: true, about: true });
  assert.deepEqual(noteState({ touch: true, seen: true }), { card: false, about: true });
  assert.equal(NOTE, 'Best on a desktop browser');
  assert.match(WHY, /trees and clouds/);
});
