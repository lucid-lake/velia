// The front-door review (2026-11-04): the no-WebGPU path, the cache headers, the stripped inline comments, the title screen's words.
// The no-WebGPU path runs in a real browser: tests/pages/frontDoor.page.mjs (src/core/index.js boot() with no navigator.gpu).
import { test } from 'node:test';
import { stripHtmlComments } from '../tools/build/scrub.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { layoutLabel } from '../src/ui/keyLabels.js';
import { createWords } from '../src/ui/words.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('no WebGPU: the hard-stop card names the browsers that work (the boot path itself: tests/pages/frontDoor.page.mjs)', () => {
  assert.match(read('index.html'), /Try desktop Chrome, Edge, Safari or Firefox/);
});

test('hashed assets are cached for a year, immutable; HTML is not listed', () => {
  const h = read('public/_headers');
  assert.match(h, /^\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable$/m);
  assert.doesNotMatch(h, /^\/(index\.html)?$/m);
});

test('the title screen reads "any key for the float plan"; the sail hint has one wording', () => {
  assert.match(read('index.html'), /any key<\/span> for the float plan/);
  // the trim hints say the same words for the mouse as for the keys, at both levels (no "the sail line in" variant)
  const w = createWords(), pro = createWords({ mode: 'sailor' });
  for (const k of ['pull', 'ease']) {
    assert.equal(w.expand(`§${k}§`, { mouse: true }), w.expand(`§${k}§`), `${k}: one wording`);
    assert.equal(pro.expand(`§${k}§`, { mouse: true }), pro.expand(`§${k}§`), `${k}: one sailor's wording`);
  }
  assert.equal(w.expand('§pull§', { mouse: true }), 'pull the sails in');
  assert.doesNotMatch(w.expand('§pull§', { mouse: true }) + pro.expand('§pull§', { mouse: true }), /sail line/);
});

test('the build strips inline-script comments; the Chinese option stays disabled', () => {
  const strip = stripHtmlComments().transformIndexHtml;   // the shared production scrub (tools/build/scrub.mjs), v1 and v2
  const out = strip('<!-- a note -->\n<script>const u = "https://x"; // a note\n</script><style>a{} /* a note */</style>');
  assert.ok(!out.includes('a note') && out.includes('https://x'), out);
  assert.match(read('index.html'), /data-lang="zh" aria-selected="false" aria-disabled="true"/);
});

test('key caps keep the US names without a layout map', () => {
  assert.equal(layoutLabel('Equal', '+'), '+');
});
