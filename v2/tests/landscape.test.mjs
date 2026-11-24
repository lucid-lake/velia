// Phones are landscape-only (v2/ui/landscape.js): the turn's rule, its point and rect maths, and the stylesheet flips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rotatedFor, toLayout, toScreen, rectToLayout, flipMedia, flipDecls, flipRules } from '../ui/landscape.js';

test('rotatedFor: only a touch phone held upright turns; ?portrait=1, sideways phones, tablets and desktops do not', () => {
  assert.equal(rotatedFor({ w: 390, h: 844, coarse: true }), true);
  assert.equal(rotatedFor({ w: 402, h: 874, coarse: true }), true);
  assert.equal(rotatedFor({ w: 390, h: 844, coarse: true, portrait: true }), false, '?portrait=1');
  assert.equal(rotatedFor({ w: 844, h: 390, coarse: true }), false, 'sideways');
  assert.equal(rotatedFor({ w: 820, h: 1180, coarse: true }), false, 'an iPad upright');
  assert.equal(rotatedFor({ w: 390, h: 844, coarse: false }), false, 'a narrow desktop window');
});

test('the turn: a screen point and its layout point map both ways; the layout top is the screen right (home indicator right)', () => {
  const W = 390;
  for (const [sx, sy] of [[0, 0], [390, 844], [12.5, 700], [300, 40]]) assert.deepEqual(toScreen(...toLayout(sx, sy, W), W), [sx, sy]);
  assert.deepEqual(toLayout(390, 0, W), [0, 0], 'the layout origin is the screen top-right');
  assert.deepEqual(toLayout(0, 844, W), [844, 390], 'the layout far corner is the screen bottom-left');
  const [lx0] = toLayout(200, 100, W), [lx1] = toLayout(200, 300, W);
  assert.ok(lx1 > lx0, 'a finger moving down the upright screen moves right in the layout');
  // a rect: the screen box of a layout box
  const r = rectToLayout({ left: 300, top: 40, width: 50, height: 120 }, W);
  assert.deepEqual(r, { left: 40, top: 40, width: 120, height: 50 });
});

test('flipMedia: width ↔ height, portrait ↔ landscape, aspect ratios inverted; twice is the same query', () => {
  assert.equal(flipMedia('(max-width: 640px)'), '(max-height: 640px)');
  assert.equal(flipMedia('(orientation: portrait) and (max-width: 600px)'), '(orientation: landscape) and (max-height: 600px)');
  assert.equal(flipMedia('(max-height: 520px) and (min-aspect-ratio: 5/4)'), '(max-width: 520px) and (max-aspect-ratio: 4/5)');
  assert.equal(flipMedia('(max-width:640px),(max-aspect-ratio:4/5)'), '(max-height:640px),(min-aspect-ratio:5/4)');
  assert.equal(flipMedia('(pointer: coarse)'), '(pointer: coarse)');
  for (const q of ['(max-width: 640px)', '(min-width:641px) and (min-aspect-ratio:4/5)', '(orientation:landscape) and (max-height:500px)']) assert.equal(flipMedia(flipMedia(q)), q);
});

test('flipDecls: a viewport unit becomes a share of the turned body (--lk-rw wide, --lk-rh high); the insets a quarter turn', () => {
  assert.equal(flipDecls('width: 100vw; height: 100dvh; font-size: clamp(15px, 1.95vh, 19px)'),
    'width: calc(var(--lk-rw) * 1); height: calc(var(--lk-rh) * 1); font-size: clamp(15px, calc(var(--lk-rh) * 0.0195), 19px)');
  assert.equal(flipDecls('transform: translateX(-50vw); left: 5svw'), 'transform: translateX(calc(var(--lk-rw) * -0.5)); left: calc(var(--lk-rw) * 0.05)');
  assert.equal(flipDecls('top: max(10px, env(safe-area-inset-top)); left: env(safe-area-inset-left)'), 'top: max(10px, env(safe-area-inset-right)); left: env(safe-area-inset-top)');
  assert.equal(flipDecls('right: env(safe-area-inset-right); bottom: env(safe-area-inset-bottom)'), 'right: env(safe-area-inset-bottom); bottom: env(safe-area-inset-left)');
  assert.equal(flipDecls('margin: 4px; color: rgb(1 2 3)'), 'margin: 4px; color: rgb(1 2 3)');
});

test('flipRules: turns @media and nested rules in place, and the turn back restores each rule\'s own text', () => {
  const style = (t) => ({ cssText: t });
  const inner = { style: style('left: 5vw') };
  const media = { media: { mediaText: '(max-width: 640px)' }, cssRules: [inner] };
  const plain = { style: style('height: 100vh; color: red') };
  const orig = new WeakMap();
  flipRules([media, plain], 1, orig);
  assert.equal(media.media.mediaText, '(max-height: 640px)');
  assert.equal(inner.style.cssText, 'left: calc(var(--lk-rw) * 0.05)');
  assert.equal(plain.style.cssText, 'height: calc(var(--lk-rh) * 1); color: red');
  flipRules([media, plain], -1, orig);
  assert.equal(media.media.mediaText, '(max-width: 640px)');
  assert.equal(inner.style.cssText, 'left: 5vw');
  assert.equal(plain.style.cssText, 'height: 100vh; color: red');
});
