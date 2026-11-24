// fix/first-load (2026-10-31): Cruise and Regatta never name a key on a touch device. Every line Cruise shows, Regatta's
// card words and the skipper's key notes, scanned for a key cap under the touch modality; the keyboard wording keeps its keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CRUISE_LINES, REGATTA_WORDS, cruiseLine, touchNow, KEYCAP } from '../src/ui/modeLines.js';
import { NOTES } from '../src/ui/skipper.js';
import { createServices } from '../src/sim/core/services.js';

test('the key-cap pattern finds the keys the old lines named', () => {
  for (const s of ['look round · C the camera · A D to take the helm', 'From above · north up · V course up', 'Start (Enter)', 'any key to skip', 'Sails down? Press Y', '<span class="cap">C</span>'])
    assert.match(s, KEYCAP, s);
  for (const s of ['look round · tap Cinematic to change the camera · Take the helm to steer', 'You have the helm', 'Aye. Setting a course for your mark.', 'tap to skip'])
    assert.doesNotMatch(s, KEYCAP, s);
});

test('Cruise and Regatta lines under touch name no key', () => {
  for (const id of [...Object.keys(CRUISE_LINES), ...Object.keys(REGATTA_WORDS)]) {
    const t = cruiseLine(id, { touch: true });
    assert.ok(t, id);
    assert.doesNotMatch(t, KEYCAP, `${id}: ${t}`);
  }
  assert.equal(cruiseLine('look', { touch: true, camera: 'Cinematic' }), 'look round · tap Cinematic to change the camera · Take the helm to steer', 'the bar\'s camera button by its own word');
  assert.equal(cruiseLine('look', { touch: true, camera: 'Island' }), 'look round · tap Island to change the camera · Take the helm to steer', 'it follows the camera on screen');
  assert.match(cruiseLine('look', { touch: true }), /tap the camera button to change the camera/, 'no camera known: a plain name');
  assert.doesNotMatch(cruiseLine('look', { touch: true, camera: 'Cinematic' }), /\bView\b/, 'no View: that button is gone');
  assert.match(cruiseLine('look', { touch: false }), /C the camera/);   // the Mac's line is unchanged
  assert.equal(cruiseLine('start', { touch: false }), 'Start (Enter)');
});

test('the skipper notes that name a key have touch wording without one', () => {
  for (const [id, n] of Object.entries(NOTES)) {
    if (!KEYCAP.test(n.text) && !/^[+−-] /.test(n.text)) continue;
    assert.ok(n.touch, `${id} names a key but has no touch wording`);
    assert.doesNotMatch(n.touch, KEYCAP, id); assert.doesNotMatch(n.touchSpeak ?? n.touch, KEYCAP, id);
  }
});

test('touchNow reads Sail\'s modality, then Cruise\'s own, then the device', () => {
  const sail = createServices(); sail.provide('modality', { touch: true });
  assert.equal(touchNow({ touch: false }, () => false, sail), true);
  assert.equal(touchNow({ touch: false }, () => true, createServices()), false);
  assert.equal(touchNow({ touch: false }, () => true), false);
  assert.equal(touchNow(null, () => true), true);
});

