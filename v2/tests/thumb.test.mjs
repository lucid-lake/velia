// (owner, 2026-11-15): an upright phone's one-thumb controls, their pure rules (v2/ui/thumb.js). The page check is
// v2/tests/pages/phoneControls.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { THUMB, actionFor, dragKind, arcDeg, railLever, railY, railSnap } from '../ui/thumb.js';
import { tillerFromDrag } from '../ui/touch.js';
import { HELM_IN } from '../../src/stations/sloop/helmInput.js';

test('the action button: the rail under motor, the running manoeuvre, Sails up with the sails down, then the offer, else none', () => {
  assert.equal(actionFor({ motor: true, offer: 'tack' }), null, 'motor: the throttle rail takes its place');
  assert.deepEqual(actionFor({ active: 'gybe', offer: 'tack' }), { id: 'gybe', lit: true, go: true });
  assert.deepEqual(actionFor({ sailsDown: true, offer: 'tack' }), { id: 'sails', lit: false, go: false });
  assert.deepEqual(actionFor({ offer: 'tack' }), { id: 'tack', lit: true, go: false });
  assert.deepEqual(actionFor({ offer: 'gybe' }), { id: 'gybe', lit: true, go: false });
  assert.equal(actionFor({}), null, 'a reach: nothing to offer');
});

test('a drag in the steer zone: sideways steers, vertical first (12 px) is the sheet', () => {
  assert.equal(dragKind(2, 3), null, 'not yet');
  assert.equal(dragKind(8, 2), 'steer');
  assert.equal(dragKind(3, THUMB.trimPx), 'trim');
  assert.equal(dragKind(3, -THUMB.trimPx), 'trim', 'up eases');
  assert.equal(dragKind(14, 13), 'steer', 'more sideways than down');
  // the steer is the water's tiller: the same feel as today's touch steering
  assert.equal(tillerFromDrag(0.06 * 390, 390), 0.5);
});

test('the rudder arc: full rudder at the arc\'s ends, port to the left', () => {
  assert.equal(arcDeg(0), 0);
  assert.equal(arcDeg(HELM_IN.rudderMax), THUMB.arcHalfDeg);
  assert.equal(arcDeg(-HELM_IN.rudderMax / 2), -THUMB.arcHalfDeg / 2);
  assert.equal(arcDeg(-9), -THUMB.arcHalfDeg, 'clamped');
});

test('the throttle rail: ahead up, astern down, N a detent, the release on a notch', () => {
  assert.equal(railLever(0, 0, 170), 1);
  assert.equal(railLever(170, 0, 170), -1);
  assert.equal(railLever(85, 0, 170), 0);
  assert.equal(railLever(80, 0, 170), 0, 'inside the detent');
  assert.ok(railLever(40, 0, 170) > 0.5);
  assert.equal(railY(0, 170), 85); assert.equal(railY(1, 170), 0); assert.equal(railY(-1, 170), 170);
  assert.equal(railSnap(0.55), 0.6); assert.equal(railSnap(0.05), 0); assert.equal(railSnap(-0.9), -1);
});

// the coordinator's phone audit (2026-11-15, row 18): on the one-thumb controls the skipper names what is on screen, never the
// wheel, the winches, the SAILS rocker or the lever they replace; the Keys card's finger sheet the same
test('the skipper\'s touch lines and the finger sheet name the one-thumb controls', async () => {
  const { createWords, PHRASES } = await import('../../src/ui/words.js');
  const { NOTES } = await import('../../src/ui/skipper.js');
  const { THUMB_ROWS, V2_TOUCH_ROWS, keysPageHtml } = await import('../../src/ui/keysContent.js');
  const OLD = /\bwinch|\bwheel\b|helm strip|throttle|Tap Sails\b/i;
  const plain = (h) => h.replace(/<[^>]*>/g, '');
  const thumbW = createWords({ oneThumb: () => true, mode: 'both' }), sailorW = createWords({ oneThumb: () => true, mode: 'sailor' }), grid = createWords({ oneThumb: () => false });
  for (const [k, p] of Object.entries(PHRASES)) {
    if (!p.touch) continue;
    assert.ok(p.thumb && p.thumbSailor, `${k}: a thumb wording`);
    for (const w of [thumbW, sailorW]) { const s = plain(w.expand(`§${k}§`, { touch: true })); assert.ok(!OLD.test(s), `${k}: "${s}"`); }
    assert.equal(plain(grid.expand(`§${k}§`, { touch: true })), plain(grid.expand(`§${k}§`, { touch: true, thumb: false })), `${k}: the wheel and winch layouts keep their words`);
  }
  assert.match(plain(thumbW.expand('§pull§', { touch: true })), /drag down low on the screen/);
  assert.match(plain(grid.expand('§pull§', { touch: true })), /winch/, 'the cockpit and ?thumb=0 still say winch');
  assert.match(plain(thumbW.expand('§pull§', { mouse: true })), /pull the sails in/, 'a mouse never gets the thumb words');
  for (const [id, n] of Object.entries(NOTES)) if (n.touch && OLD.test(n.touch)) assert.ok(n.thumb && !OLD.test(n.thumb) && n.thumbSpeak, `note ${id}: a thumb line`);
  for (const [a, b] of THUMB_ROWS) assert.ok(!OLD.test(`${a} ${b}`), `Keys › Touch row ${a}: ${b}`);
  assert.ok(!V2_TOUCH_ROWS.some(([, b]) => /helm strip/.test(b)), 'v2 has no helm strip on any layout');
  assert.match(keysPageHtml({ touch: true, rows: THUMB_ROWS }), /drag sideways low on the screen/);
});
