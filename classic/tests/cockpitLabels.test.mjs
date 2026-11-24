// The JIB / TACK / MAIN words (src/stations/sloop/cockpit3d.js labelConsts; owner 2026-11-10: "more rooms for the control buttons", then the
// ruling: names engraved on each part's own placard, no band). The default gives the band's height to the recesses, and their controls grow;
// ?cockpitlabels=a keeps the old band for one release. A phone takes the same change over its own numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COCKPIT, cockpitConsts, labelConsts, LABEL_MODES } from '../src/stations/sloop/cockpit3d.js';

test('a is the old band, untouched', () => {
  assert.deepEqual(LABEL_MODES, ['a', 'b']);
  assert.equal(labelConsts('a'), COCKPIT);
  assert.equal(COCKPIT.band, 'face');
});

for (const [name, C0] of [['desktop', COCKPIT], ['phone', cockpitConsts(true)]]) {
  test(`the default (${name}): placards, no band, taller recesses, bigger controls`, () => {
    for (const C of [labelConsts(undefined, C0), labelConsts('b', C0), labelConsts('zz', C0)]) {
      assert.equal(C.band, 'plate');
      assert.ok(C.platePx >= 15, 'the placards\' letters at the floor or over (no text under 15 px)');
      assert.ok(C.RY1 > C0.RY1 && C.RY1 < C0.CH - 0.03, `the recesses' head rises, under the lip (${C.RY1})`);
      assert.ok(C.toggleScale > C0.toggleScale && C.btnScale > 1.3 && C.carScale > 1, 'the toggles, buttons and cars grow');
      assert.ok(C.pro.btnPx > C0.pro.px && C.togglePx > C0.togglePx, 'the buttons\' and toggles\' words grow');
      // the recess (look C3): a 2 x 2 grid on one pitch, each word the same height over its track,
      // the top row's scale clear of the bottom row's word, the bottom row's scale over the recess's own foot (the footwell)
      const P = C.pro, h = P.car[1] / 2, t2 = P.trackY - P.rowPitch, w2 = t2 + (P.wordY - P.trackY), foot = C.holes.pro[3] ?? C.RY0;
      assert.ok(P.wordY < C.RY1 && P.wordY - P.trackY > h + 0.02 && P.trackY - h - P.scaleH > w2 + 0.025 && t2 - h - P.scaleH > foot, 'the grid\'s rows in order');
      assert.deepEqual(C.x, C0.x); assert.deepEqual(C.holes, C0.holes);   // a phone keeps its own places
    }
  });
}
