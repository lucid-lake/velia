// fix/helm-view-cockpit: the boat's own lit faces by night (src/boat/nightLight.js) and the drawn cockpit folding away in the
// helm view (src/ui/calmHud.js CalmClock.helm). The live page: tests/pages/helmView.page.mjs (retired 2026-11-18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { nightK, faceGain, cabinShare, facePalette, NIGHT_FACE } from '../src/boat/nightLight.js';
import { exposureAt } from '../src/sim/timeOfDay.js';
import { CalmClock } from '../src/ui/calmHud.js';

const frame = (elevDeg) => { const e = exposureAt(elevDeg); return { elevDeg, exposure: e, exposureComp: 6 / e }; };

test('by day the faces keep their look: gain 1, the day inks', () => {
  for (const el of [9, 20, 60]) { assert.equal(nightK(el), 0); assert.equal(faceGain(frame(el)), 1); assert.equal(cabinShare({ light: 1, ...frame(el) }), 1); }
  assert.equal(facePalette(false).bg, '#0d131b');
});

test('by night an unlit face is dim on screen, never brighter than by day, in the red set', () => {
  for (const el of [-6, -12, -20]) {
    const f = frame(el), screen = faceGain(f) * f.exposure / 6;   // its on-screen level, x the day's
    assert.equal(nightK(el), 1, `night at ${el} deg`);
    assert.ok(Math.abs(screen - NIGHT_FACE.gain) < 1e-9, `${el} deg: ${screen.toFixed(3)} x the day's on screen`);
  }
  assert.ok(frame(-12).exposure / 6 > 300, 'the old unlit faces were > 300 x the day level at -12 deg');
  assert.match(facePalette(true).ink, /^#FF/i);
  for (let el = 8; el >= -14; el -= 0.5) { const f = frame(el); assert.ok(faceGain(f) * f.exposure / 6 <= 1 + 1e-9, `${el} deg`); }
});

test('the cabin through the companionway: as before while the day lights it, a dim night light after', () => {
  assert.equal(cabinShare({ light: 0.3, exposureComp: 0.5 }), 0.3);
  const f = frame(-12), screen = cabinShare({ light: 1e-5, ...f }) * f.exposure / 6;
  assert.ok(screen <= NIGHT_FACE.cabin + 1e-6 && screen > 0.01, `the night cabin at ${screen.toFixed(3)} x the day's (was ${(0.06 * f.exposure / 6).toFixed(1)})`);
});

test("the helm view folds the drawn cockpit away; no winch peek raises it; the player's fold is untouched", () => {
  const c = new CalmClock({ mode: 'full', foldable: true });
  assert.equal(c.folded, false);
  c.helm = true;
  assert.equal(c.folded, true); assert.equal(c.fold, false);
  c.tick(0.1, { needs: { jib: true, main: true, trim: true, depth: true } });
  const v = c.view;
  assert.equal(v.need.jib || v.need.main || v.need.trim, false);
  assert.equal(v.need.depth, true); assert.equal(v.dials.chart, 'open');   // the sounder's alarm still opens the chart
  assert.equal(v.dials.wind, 'puck');
  c.helm = false; assert.equal(c.folded, false);
  const g = new CalmClock({ mode: 'full', foldable: false }); g.helm = true; assert.equal(g.folded, false);   // no cockpit: nothing changes
  const i = new CalmClock({ mode: 'instruments', foldable: true }); i.helm = true; assert.deepEqual(i.view.dials, { chart: 'open', wind: 'open' });
});
