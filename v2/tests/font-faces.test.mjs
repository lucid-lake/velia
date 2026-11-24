//, 2026-11-17: "the duplicate font fetches fixed"): one @font-face per family, style and weight on a page
// (src/ui/fontFaces.js uniqueFaces, used by the logbook's, the skipper line's and the home pages' sheets). The page proof is the
// phone's load (tools/v2-phone-load.mjs: each font file fetched once).
import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueFaces } from '../../src/ui/fontFaces.js';

const face = (fam, style, weight, file, display = 'swap') => `@font-face{font-family:'${fam}';font-style:${style};font-weight:${weight};font-display:${display};src:url(/fonts/${file}) format('woff2')}`;
const faces = (css) => css.match(/@font-face\{[^}]*\}/g) ?? [];

test('a face the page has (its head\'s Jost) is dropped; a new one passes once; other rules untouched', () => {
  const head = [{ family: 'Jost', style: 'normal', weight: '300 500' }, { family: '"Atkinson Hyperlegible Next"', style: 'normal', weight: '400' }];
  const logbook = `${face('Jost', 'normal', '300 500', 'jost-latin.woff2')}${face('Jost', 'italic', '300 500', 'jost-italic-latin.woff2')}${face('Velia Sub A', 'normal', '400 700', 'sub/fraunces-soft.woff2')}\n.lk-log{color:red}`;
  const out = uniqueFaces(logbook, head);
  assert.deepEqual(faces(out).map((r) => /url\(([^)]+)\)/.exec(r)[1]), ['/fonts/jost-italic-latin.woff2', '/fonts/sub/fraunces-soft.woff2'], 'the head\'s Jost dropped');
  assert.ok(out.includes('.lk-log{color:red}'));
  // the skipper's line after the logbook: the page now has all three
  const page = [...head, { family: 'Jost', style: 'italic', weight: '300 500' }, { family: 'Velia Sub A', style: 'normal', weight: '400 700' }];
  const hint = `${face('Velia Sub B', 'normal', '600', 'sub/cormorant-garamond-600.woff2')}${face('Jost', 'normal', '300 500', 'jost-latin.woff2')}${face('Jost', 'italic', '300 500', 'jost-italic-latin.woff2')}${face('Velia Sub A', 'normal', '400 700', 'sub/fraunces-soft.woff2')}.lk-hint{}`;
  assert.deepEqual(faces(uniqueFaces(hint, page)).map((r) => /family:'([^']+)'/.exec(r)[1]), ['Velia Sub B']);
  // a twin inside the same text, and another weight of a family the page has
  const twin = `${face('Jost', 'italic', '300 500', 'a.woff2')}${face('Jost', 'italic', '300 500', 'a.woff2')}${face('Atkinson Hyperlegible Next', 'normal', '500', 'ahn-500.woff2')}`;
  assert.equal(faces(uniqueFaces(twin, head)).length, 2, 'one italic Jost; the 500 weight is not the head\'s 400');
  // no font set (node, an old browser): every rule kept
  assert.equal(faces(uniqueFaces(logbook, null)).length, 3);
});
