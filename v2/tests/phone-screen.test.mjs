// A phone's screen space (owner 2026-11-16), the pure parts: the visible frame's tier, the safe-area fallback for the
// Safari 26 viewport-fit bug (only a notched iPhone whose insets read 0 while the page reaches the notch), the quarter turn of the
// insets for an upright phone, the Home Screen card's rules (never a first visit, once on a later one, once more after a few minutes
// on a visit after that, at most twice, never in the Home Screen app, the right card per browser, pointing at its Share button),
// the app manifest (valid, its icons there at their sizes) and index.html's Home Screen tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREEN, notchedIphone, fallbackInsets, insetsToLayout, tierFor } from '../ui/screenFit.js';
import { CARD, readRecord, onLoad, cardDue, onShown, platformOf, shareSpot } from '../ui/install.js';
import { flatLayout, FLAT } from '../ui/flat.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CRIOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

test('the tier: a browser tab (320–360 px tall) is short, a Home Screen launch (390–430 px) tall; the same line as the flat layout', () => {
  for (const h of [320, 340, 360]) assert.equal(tierFor({ w: 844, h, phone: true }), 'short', `${h}`);
  for (const h of [390, 430]) assert.equal(tierFor({ w: 844, h, phone: true }), 'tall', `${h}`);
  assert.equal(tierFor({ w: 1280, h: 720, phone: false }), null, 'a desktop has none');
  assert.equal(SCREEN.tall, FLAT.tall);
  const s = flatLayout({ w: 844, h: 340 }), t = flatLayout({ w: 844, h: 390 });
  assert.ok(s.q < t.q && s.dials.chart.d < t.dials.chart.d && s.g < t.g, 'the compact tier: smaller quarters and dials, tighter rings');
  assert.ok(s.steer.r1 - s.steer.r0 >= 44, 'its rings still a finger wide');
});

test('the safe-area fallback: a notched iPhone with every inset 0 while the page reaches the notch; never otherwise', () => {
  const side = { ua: IPHONE, sw: 390, sh: 844, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  assert.ok(notchedIphone({ ua: IPHONE, sw: 390, sh: 844 }) && !notchedIphone({ ua: IPHONE, sw: 375, sh: 667 }) && !notchedIphone({ ua: ANDROID, sw: 412, sh: 915 }));
  assert.deepEqual(fallbackInsets({ ...side, pw: 844 }), SCREEN.fallbackSide, 'sideways, the page across the whole screen, insets 0: the fallback');
  assert.equal(fallbackInsets({ ...side, pw: 726 }), null, 'a letterboxed page (Safari kept the bars): nothing to do');
  assert.equal(fallbackInsets({ ...side, pw: 844, insets: { left: 47, right: 47, bottom: 21 } }), null, 'insets read: cover works');
  assert.equal(fallbackInsets({ ...side, ua: ANDROID, sw: 412, sh: 915, pw: 915 }), null, 'Android: never');
  assert.equal(fallbackInsets({ ...side, sw: 375, sh: 667, pw: 667 }), null, 'an iPhone SE (no notch): never');
  assert.deepEqual(fallbackInsets({ ...side, pw: 390, upright: true, standalone: true }), SCREEN.fallbackUp, 'upright from the Home Screen (under the status bar): the fallback');
  assert.equal(fallbackInsets({ ...side, pw: 390, upright: true, standalone: false }), null, 'upright in a tab: the bars hold the status bar');
  assert.equal(fallbackInsets({ ...side, pw: 844, fit: 'cover' }), null, '?fit=cover: never');
  assert.deepEqual(fallbackInsets({ ua: ANDROID, fit: 'bars' }), SCREEN.fallbackSide, '?fit=bars: always');
});

test('an upright phone: the insets turn with the page (the notch on the layout\'s left, the home indicator on its right)', () => {
  assert.deepEqual(insetsToLayout({ top: 59, right: 0, bottom: 34, left: 0 }, true), { top: 0, right: 34, bottom: 0, left: 59 });
  assert.deepEqual(insetsToLayout({ top: 0, right: 47, bottom: 21, left: 47 }, false), { top: 0, right: 47, bottom: 21, left: 47 });
});

test('the Home Screen card: never on a first visit; once on a later one; once more on a visit after, after a few minutes; at most twice', () => {
  const P = 'ios';
  let r = onLoad(readRecord(null), 1e12);
  assert.equal(r.visits, 1);
  assert.equal(cardDue({ rec: r, sailedS: 3600, platform: P }), false, 'the first visit: never, however long');
  assert.equal(onLoad(r, 1e12 + 10 * 60e3).visits, 1, 'a reload within the gap is the same visit');
  r = onLoad(r, 1e12 + (CARD.visitGapMin + 1) * 60e3);
  assert.equal(r.visits, 2);
  assert.equal(cardDue({ rec: r, sailedS: CARD.firstS - 1, platform: P }), false, 'not at the load: after a little sailing');
  assert.equal(cardDue({ rec: r, sailedS: CARD.firstS, platform: P }), true, 'a later visit: once');
  r = onShown(r);
  assert.equal(cardDue({ rec: r, sailedS: 3600, platform: P }), false, 'once a visit');
  r = onLoad(r, 1e12 + 3 * (CARD.visitGapMin + 1) * 60e3);
  assert.equal(cardDue({ rec: r, sailedS: CARD.firstS, platform: P }), false, 'the second ask waits for a few minutes of sailing');
  assert.equal(cardDue({ rec: r, sailedS: CARD.againS, platform: P }), true);
  r = onShown(r);
  r = onLoad(r, 1e12 + 9 * (CARD.visitGapMin + 1) * 60e3);
  assert.equal(r.shown, CARD.max);
  assert.equal(cardDue({ rec: r, sailedS: 3600, platform: P }), false, `at most ${CARD.max} times`);
  const later = onLoad(onLoad(readRecord(null), 0), 1e9);
  assert.equal(cardDue({ rec: later, sailedS: 3600, standalone: true, platform: P }), false, 'never in the Home Screen app');
  assert.equal(cardDue({ rec: later, sailedS: 3600, platform: null }), false, 'never off a phone');
  assert.deepEqual(readRecord('{bad'), { visits: 0, lastAt: 0, shown: 0, shownVisit: 0 }, 'a broken record starts again');
});

test('the card per browser and where it points: the dialog on Android, the picture on an iPhone pointing at its Share button', () => {
  assert.equal(platformOf({ ua: ANDROID, phone: true, prompt: true }), 'android');
  assert.equal(platformOf({ ua: IPHONE, phone: true }), 'ios');
  assert.equal(platformOf({ ua: ANDROID, phone: true }), 'other');
  assert.equal(platformOf({ ua: IPHONE, phone: true, standalone: true }), null);
  assert.equal(platformOf({ ua: IPHONE, phone: false }), null);
  assert.equal(shareSpot({ ua: IPHONE, rotated: false }), 'top');
  assert.equal(shareSpot({ ua: IPHONE, rotated: true }), 'right', 'Safari upright: its toolbar at the screen\'s foot, the turned page\'s right');
  assert.equal(shareSpot({ ua: CRIOS, rotated: true }), 'left', 'Chrome upright: its top bar, the turned page\'s left');
});

test('the app manifest: valid, named Velia, full screen (standalone after), landscape, navy, its icons there at their sizes', () => {
  const m = JSON.parse(readFileSync(resolve(ROOT, 'brand/app/velia.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Velia'); assert.equal(m.short_name, 'Velia');
  assert.equal(m.display, 'fullscreen'); assert.deepEqual(m.display_override, ['fullscreen', 'standalone']);
  assert.equal(m.orientation, 'landscape');
  assert.equal(m.background_color.toLowerCase(), '#1c2340'); assert.equal(m.theme_color.toLowerCase(), '#1c2340');
  assert.equal(m.start_url, '/'); assert.equal(m.scope, '/');
  const sizes = new Set();
  for (const ic of m.icons) {
    const f = resolve(ROOT, ic.src.replace(/^\//, ''));
    assert.ok(existsSync(f), ic.src);
    const b = readFileSync(f);
    assert.equal(b.toString('ascii', 1, 4), 'PNG', `${ic.src} is a PNG`);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    assert.equal(`${w}x${h}`, ic.sizes, `${ic.src} is ${ic.sizes}`);
    sizes.add(`${ic.sizes} ${ic.purpose}`);
  }
  for (const k of ['192x192 any', '512x512 any', '512x512 maskable']) assert.ok(sizes.has(k), k);
  const html = readFileSync(resolve(ROOT, 'v2/index.html'), 'utf8');
  for (const re of [/<link rel="manifest" href="\/brand\/app\/velia\.webmanifest"/, /<link rel="apple-touch-icon"[^>]*href="\/brand\/app\/velia-icon-180\.png"/, /name="apple-mobile-web-app-capable" content="yes"/, /name="theme-color" content="#1C2340"/, /viewport-fit=cover/])
    assert.match(html, re);
});
