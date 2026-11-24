// The cinematic intro (v2/ui/cinematicIntro.js; owner 2026-11-18): the timeline, the letterbox's size, the camera's fit, the
// lens look's pieces (render/bloom.js LENS), and the controller's once-only rule, with no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INTRO, introAt, barPx, bandShare, fitScale, ndcYMax, createIntro } from '../ui/cinematicIntro.js';
import { lensVignette, lensFringe, LENS } from '../render/bloom.js';

test('the letterbox is 2.39:1, at most 22 % of the height a bar', () => {
  assert.ok(Math.abs(1920 / (1080 - 2 * barPx(1920, 1080)) - 2.39) < 1e-9, '1920 × 1080: the band is 2.39:1');
  assert.ok(Math.abs(barPx(1920, 1080) - 138.33) < 0.01);
  assert.equal(barPx(1024, 768), 0.22 * 768, 'a 4:3 window: capped');
  assert.equal(barPx(3840, 1600), 0, 'an ultrawide wider than 2.39: no bars');
  assert.ok(Math.abs(bandShare(1280, 720) - 535.56 / 720) < 1e-3);
});

test('the timeline: held to 4.8 s, the bars out over 1 s, the top bar, then the cockpit 0.2 s after the retract starts, done at 5.8 s', () => {
  const a = introAt(1);
  assert.equal(a.cover, 1); assert.equal(a.lens, 1); assert.deepEqual(a.hud, { bar: false, cockpit: false, rest: false });
  assert.ok(a.drift > 0 && a.drift <= INTRO.drift, 'the slow push-in');
  assert.equal(introAt(INTRO.holdS).cover, 1);
  const mid = introAt(INTRO.holdS + INTRO.outS / 2);
  assert.ok(Math.abs(mid.cover - 0.5) < 1e-9 && Math.abs(mid.lens - 0.5) < 1e-9, 'the lens fades with the bars');
  assert.equal(introAt(INTRO.holdS + 0.1).hud.bar, false); assert.equal(introAt(INTRO.holdS + 0.16).hud.bar, true);
  assert.equal(introAt(INTRO.holdS + 0.19).hud.cockpit, false); assert.equal(introAt(INTRO.holdS + 0.21).hud.cockpit, true);
  const end = introAt(INTRO.holdS + INTRO.outS);
  assert.equal(end.done, true); assert.equal(end.cover, 0); assert.equal(end.lens, 0); assert.equal(end.fit, 0); assert.equal(end.drift, 0);
  let prev = 2; for (let t = 0; t <= 6; t += 0.05) { const c = introAt(t).cover; assert.ok(c <= prev + 1e-12, 'the bars never come back'); prev = c; }
});

test('a skip: everything shown at once, the bars and the lens out over 0.4 s from wherever they were', () => {
  const s = introAt(2.0, { skipAt: 2.0 });
  assert.deepEqual(s.hud, { bar: true, cockpit: true, rest: true }); assert.equal(s.a.rest, 0); assert.equal(s.cover, 1); assert.equal(introAt(2.4, { skipAt: 2.0 }).a.bar, 1, "every piece in after 0.4 s");
  assert.ok(Math.abs(introAt(2.2, { skipAt: 2.0 }).cover - 0.5) < 1e-9);
  assert.equal(introAt(2.4, { skipAt: 2.0 }).done, true);
  const r = introAt(5.4, { skipAt: 5.3 }), r0 = introAt(5.3);
  assert.ok(r.cover < r0.cover && r.cover > 0, 'a skip mid-retract eases from where it was');
});

test('reduced motion: no bars, no lens, no camera; the HUD fades in over 0.4 s', () => {
  const s = introAt(0, { reduced: true });
  assert.equal(s.cover, 0); assert.equal(s.lens, 0); assert.equal(s.fit, 0); assert.equal(s.drift, 0);
  assert.deepEqual(s.hud, { bar: true, cockpit: true, rest: true }); assert.equal(s.a.bar, 0); assert.ok(Math.abs(introAt(0.2, { reduced: true }).a.bar - 0.5) < 1e-9, "the HUD half in at 0.2 s");
  assert.equal(introAt(0.41, { reduced: true }).done, true);
});

test('the fit: the lens widens just enough to put the farthest boat point inside the band with its margin', () => {
  assert.equal(fitScale(0.5, 0.744), 1, 'already inside: unchanged');
  const k = fitScale(0.9, 0.744);
  assert.ok(Math.abs(0.9 / k - 0.744 * (1 - INTRO.margin)) < 1e-9);
  // a camera 30 m behind and 6 m up looking at the boat; a 14 m mast top is out of the band until the fit
  const c = { pos: [0, 6, 30], target: [0, 3, 0], up: [0, 1, 0], fov: 40 };
  const pts = [[0, 14, 0], [0, 0, -4], [0, 0, 4]];
  const y = ndcYMax(c, pts); assert.ok(y > 0 && y < 2);
  const s = fitScale(y, 0.744), c2 = { ...c, fov: 2 * Math.atan(Math.tan(c.fov * Math.PI / 360) * s) * 180 / Math.PI };
  assert.ok(ndcYMax(c2, pts) <= 0.744 * (1 - INTRO.margin) + 1e-9, 'every point in the band after the fit');
});

test('the controller: once a page load, Sail or Cruise only; a first Regatta spends it; a skip before 0.25 s is the entry\'s own input', () => {
  const a = createIntro({ enabled: true, doc: null, win: null });
  assert.equal(a.start('regatta'), false); assert.equal(a.start('sail'), false, 'Regatta first: no intro later');
  const b = createIntro({ enabled: true, doc: null, win: null });
  assert.equal(b.start('sail'), true); assert.equal(b.playing, true); assert.equal(b.cockpitHeld, true); assert.equal(b.lens.amount, 1);
  assert.equal(b.skip(), false, 'the entering tap does not skip');
  b.step(0.1); b.step(0.1); b.step(0.1);
  assert.equal(b.skip(), true);
  for (let i = 0; i < 6; i++) b.step(0.1);
  assert.equal(b.playing, false); assert.equal(b.lens.amount, 0); assert.equal(b.cockpitHeld, false);
  assert.equal(b.start('sail'), false, 'never twice');
  const c = createIntro({ enabled: false, doc: null, win: null });
  assert.equal(c.start('sail'), false, 'off (a phone, a capture, ?cinema=0)');
  const d = createIntro({ enabled: true, doc: null, win: null });
  d.start('cruise'); let n = 0; while (d.playing && n < 400) { d.step(1 / 30); n++; }
  assert.ok(Math.abs(n / 30 - (INTRO.holdS + INTRO.outS)) < 0.1, `Cruise plays the whole ${(n / 30).toFixed(2)} s`);
});

test('the camera: the pose keeps its eye and aim; only the lens widens, and not at all once done', () => {
  const b = createIntro({ enabled: true, doc: null, win: null });
  const c = { pos: [1, 2, 3], target: [0, 0, 0], fov: 40 };
  assert.equal(b.camera(c, () => 2, 0.7), c, 'not playing: unchanged');
  b.start('sail');
  const c2 = b.camera(c, () => 2, 0.7);
  assert.deepEqual(c2.pos, c.pos); assert.deepEqual(c2.target, c.target); assert.ok(c2.fov > 40 && c2.fov < 120);
});

test('the lens look: a vignette only toward the corners, a fringe of about 2.4 px in a 1080 p corner and none near the centre', () => {
  assert.equal(lensVignette(960, 540, 1920, 1080), 1);
  assert.ok(Math.abs(lensVignette(0, 0, 1920, 1080) - (1 - LENS.vignette)) < 0.02);
  assert.equal(lensVignette(0, 0, 1920, 1080, 0), 1, 'off at 0');
  const [fx, fy] = lensFringe(0, 0, 1920, 1080); assert.ok(Math.hypot(fx, fy) > 2 && Math.hypot(fx, fy) < 3);
  assert.ok(Math.hypot(...lensFringe(1200, 700, 1920, 1080)) < 0.5, 'under half a pixel near the centre');
});
