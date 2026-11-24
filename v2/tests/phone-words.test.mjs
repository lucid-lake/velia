// No desktop words on a phone (fix/v2-phone-desktop-text; owner 2026-11-15: "I feel we are showing lots of desktop version info on the
// phone"; "binoculars is not needed for phone"; "I need the enter mode gone"). Behaviour of the pure parts: the hand, the keyless labels,
// the phone's Controls page, the touch words of What's new and Tutorials, Setup's plain quality line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handOf, keyless, HAND_CSS, hand } from '../../src/ui/hand.js';
import { keysPageHtml, TOUCH_ROWS } from '../../src/ui/keysContent.js';
import { NEWS } from '../ui/news.js';   // v2's What's new (its releases on top of v1's)
import { TUTORIALS, TUTORIALS_TOUCH, byHand } from '../../src/ui/homePages.js';
import { qualityStatus, QUALITY_WORDS } from '../ui/setup.js';
import { FAIL_LINE } from '../ui/loading.js';

const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('the hand: a finger is touch, a key, a pad or a mouse is keys; before any input the device decides', () => {
  assert.equal(handOf({}, true), 'touch');
  assert.equal(handOf({}, false), 'keys');
  assert.equal(handOf({ kind: 'mouse', pointer: 'touch' }, false), 'touch');
  assert.equal(handOf({ kind: 'mouse', pointer: 'mouse' }, true), 'keys');
  assert.equal(handOf({ kind: 'keys' }, true), 'keys');
  assert.equal(handOf({ kind: 'pad' }, true), 'keys');
  assert.equal(hand({ doc: { documentElement: { dataset: { hand: 'touch' } } } }), 'touch', 'the attribute is the answer once set');
});

test('keyless: a label loses its bracketed key, nothing else', () => {
  for (const [a, b] of [['Menu (Esc)', 'Menu'], ['Close menu (Esc)', 'Close menu'], ['Boat view (C)', 'Boat view'], ['Take the helm (A D)', 'Take the helm'],
    ['Cruise: let her sail herself (`)', 'Cruise: let her sail herself'], ['next song (])', 'next song'], ['Full screen (Shift+F)', 'Full screen'],
    ['View · Boat (C)', 'View · Boat'], ['binoculars (B)', 'binoculars'], ['Regatta (soon)', 'Regatta (soon)'], ['panel: VHF, reef', 'panel: VHF, reef'], ['Weather · fair', 'Weather · fair']]) assert.equal(keyless(a), b, a);
});

test('binoculars: every way in is hidden for a finger (the PANEL cell, the cockpit target, the dock, the Locker and View rows)', () => {
  for (const sel of ['.c[data-id=binoculars]', '.lk-dock .it[data-id=binoculars]', '[data-id=binoculars]', '[data-id=glasses]']) assert.ok(HAND_CSS.includes(sel), sel);
  assert.match(HAND_CSS, /^:root\[data-f-binoculars=off\]/, 'only where the registry turns them off (a finger-only device: src/core/features.js)');
  assert.ok(!TOUCH_ROWS.some(([a, b]) => /binoc|glasses/i.test(`${a} ${b}`)), 'no Controls row names them');
});

test('the phone\'s Controls page: the touch rows alone, no tab, no cap, no pad line; the keyboard\'s card is as before', () => {
  const p = keysPageHtml({ phone: true, pro: true });
  assert.doesNotMatch(p, /role="tab"/); assert.doesNotMatch(p, /class="cap/); assert.doesNotMatch(p, /d-pad/);
  assert.equal((p.match(/class="tr"/g) ?? []).length, TOUCH_ROWS.length, 'one row per touch row');
  const k = keysPageHtml({});
  assert.deepEqual([...k.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]), ['keys', 'boat', 'hand', 'pro']);
});

test('What\'s new and Tutorials: every line that names a key has a finger\'s words, which name none', () => {
  const KEYED = /\b(press|Space|Esc|Hold H)\b|^[A-Z] opens/;
  for (const n of NEWS) {
    if (KEYED.test(n.text)) { assert.ok(n.touchText, `touchText for "${n.text}"`); assert.doesNotMatch(n.touchText, KEYED); }
    if (KEYED.test(n.see)) { assert.ok(n.touchSee, `touchSee for "${n.see}"`); assert.doesNotMatch(n.touchSee, KEYED); }
    if (/Binoculars/.test(n.text)) assert.doesNotMatch(n.touchText ?? '', /Binoculars/, 'a phone has no binoculars');
  }
  for (const [w, , d] of TUTORIALS) if (KEYED.test(d)) { assert.ok(TUTORIALS_TOUCH[w], w); assert.doesNotMatch(TUTORIALS_TOUCH[w].join(' '), KEYED); }
  assert.equal(byHand('Keys', 'Controls'), '<span class="hk-k">Keys</span><span class="hk-t">Controls</span>');
});

test('Setup › Screen: the quality line in plain words, no rung name or engine part', () => {
  const settings = { get: () => 'auto' };
  assert.equal(qualityStatus({ state: () => ({ id: 0, name: 'L0 full', pending: ['cloud key full'] }) }, settings).active(), 'auto: High, more after a reload');
  assert.equal(qualityStatus({ state: () => ({ name: 'L3', pending: [] }) }, { get: () => 'low' }).active(), 'Lightest');
  assert.equal(QUALITY_WORDS.length, 4);
});

test('the start failure names the browsers that run v2 on any device, not "desktop" ones', () => {
  assert.doesNotMatch(FAIL_LINE, /desktop/i);
  assert.match(FAIL_LINE, /Safari 26/);
});
