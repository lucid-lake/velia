// The skipper's touch lines on a phone's flat controls (v2/ui/flat.js: no wheel, no winches, no lever; html.lk-flat): every line
// the flat layout can say names the new controls (the steer ring, the sheet ring, Tack, the throttle ring, ⋯), never a winch, the
// wheel, a lever or the cockpit's "Tap Sails"; the desktop and ?portrait=1's one-thumb lines keep their own words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHRASES, createWords } from '../../src/ui/words.js';
import { NOTES, LEADS } from '../../src/ui/skipper.js';
import { FLAT_LINES, FLAT_NEXT, LINES, NEXT } from '../../src/ui/profile.js';

const OLD = /\bwinch(es)?\b|\bwheel\b|\blever\b|\bTap Sails\b/i;
const text = (html) => html.replace(/<[^>]*>/g, '');

test('every phrase a finger can see has flat wording, and on the flat layout none names a winch, the wheel, a lever or "Tap Sails"', () => {
  for (const mode of ['both', 'sailor']) {
    const W = createWords({ mode, onFlat: () => true, oneThumb: () => true });
    for (const [key, p] of Object.entries(PHRASES)) {
      if (p.touch || p.thumb) assert.ok(p.flat && p.flatSailor, `${key}: has flat wording`);
      const line = text(W.expand(`${LEADS?.[key] ?? ''} §${key}§`, { touch: true }));
      assert.ok(!OLD.test(line), `${mode} ${key}: "${line}"`);
    }
  }
});

test('the flat layout says the rings; the cockpit and the one-thumb controls keep their own touch words', () => {
  const flat = createWords({ onFlat: () => true }), cock = createWords({ onFlat: () => false, oneThumb: () => false }), thumb = createWords({ onFlat: () => false, oneThumb: () => true });
  assert.match(text(flat.expand('§pull§', { touch: true })), /sheet ring up/);
  assert.match(text(flat.expand('§steer§', { touch: true })), /steer ring/);
  assert.match(text(flat.expand('§tack§', { touch: true })), /Tack/);
  assert.match(text(cock.expand('§pull§', { touch: true })), /winch/, 'the cockpit keeps its winch line');
  assert.match(text(thumb.expand('§pull§', { touch: true })), /low on the screen/, '?portrait=1 keeps its thumb line');
  assert.equal(text(flat.expand('§pull§', { touch: false })), PHRASES.pull.plain, 'a mouse or the keys never get the flat words');
});

test('the skipper\'s notes, the first-sail line and the next suggestion on the flat layout name no old control', () => {
  for (const [id, n] of Object.entries(NOTES)) {
    if (n.touch && OLD.test(n.touch)) assert.ok(n.flat, `${id}: its touch line names an old control, so it has a flat line`);
    for (const k of ['flat', 'flatSpeak']) if (n[k]) assert.ok(!OLD.test(n[k]), `${id}.${k}: "${n[k]}"`);
  }
  assert.match(NOTES.motorKeys.flat, /throttle ring/);
  assert.match(NOTES.sailsDown.flat, /⋯/);
  for (const [k, v] of Object.entries({ ...FLAT_LINES, ...FLAT_NEXT })) assert.ok(!OLD.test(v), `${k}: "${v}"`);
  assert.match(LINES.new, /wheel/, 'the desktop keeps its first line');
  assert.match(NEXT.trim, /winch/, 'and its next suggestion');
});
