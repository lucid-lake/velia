// The voyage bar (owner, 2026-11-17: "consider using it in the loading bar as well, i.e. boat + Tessie"): the shell's loading line
// carries the engraved sloop and Tessie's humps inline (src/ui/voyageBar.js, the one source), painted before any script, no new
// request, small in bytes; the helper sets the progress and the aria value; reduced motion stills the bob and the surfacing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOYAGE_CSS, VOYAGE_SVG, voyageBarHtml, setVoyage } from '../../src/ui/voyageBar.js';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('the shell: the boat and Tessie inline in the loading line, before any script, with no request', () => {
  const bar = page.indexOf('class="lk-prog"'), svg = page.indexOf(VOYAGE_SVG), firstScript = page.search(/<script[^>]*\ssrc=/);   // the head's tiny inline stub aside: before any fetched script
  assert.ok(bar > 0 && svg > bar, 'the voyage SVG sits in the progress bar');
  assert.ok(firstScript < 0 || svg < firstScript, 'before the first script');
  assert.ok(page.includes(VOYAGE_CSS), 'its CSS inline in the shell');
  assert.ok(!/(href|src)=/.test(VOYAGE_SVG) && !/url\((?!#)/.test(VOYAGE_CSS + VOYAGE_SVG), 'no request: no href, src or url() but its own clip');
  assert.match(VOYAGE_SVG, /class="lk-tw"/); assert.match(VOYAGE_SVG, /#c9a45a|class="gd"/); assert.match(VOYAGE_CSS, /#c9a45a/);
  const bytes = Buffer.byteLength(VOYAGE_SVG) + Buffer.byteLength(VOYAGE_CSS);
  assert.ok(bytes < 4096, `${bytes} bytes (SVG ${Buffer.byteLength(VOYAGE_SVG)}, CSS ${Buffer.byteLength(VOYAGE_CSS)})`);
});

test('reduced motion: no bob, no surfacing, only the position', () => {
  assert.match(VOYAGE_CSS, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.lk-tw[^}]*animation:none/);
  assert.match(VOYAGE_CSS, /\.lk-psloop\{[^}]*left:calc\(var\(--p\) \* 100%\)/);
});

test('the helper: the markup for another screen, --p and aria-valuenow', () => {
  assert.ok(voyageBarHtml().startsWith('<div class="lk-line"><i class="lk-sailed"></i><span class="lk-psloop"'));
  const attrs = {}, props = {};
  const bar = { getAttribute: (k) => (k === 'role' ? 'progressbar' : null), setAttribute: (k, v) => { attrs[k] = v; }, style: { setProperty: (k, v) => { props[k] = v; } } };
  setVoyage(bar, 0.426); assert.equal(props['--p'], '0.4260'); assert.equal(attrs['aria-valuenow'], '43');
  setVoyage(bar, 7); assert.equal(props['--p'], '1.0000');
  setVoyage(null, 0.5);   // no element: nothing, no throw
});
