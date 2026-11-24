// The source link (v2/ui/source.js): v2's card has no language chip; its foot carries one GitHub link (the mark and its word) to the
// repo, between Support Velia and the version; Help › About says Velia is open source and links the repo. v1's card keeps its chip.
// The browser half: v2/tests/pages/mapCard.page.mjs (the panel's foot shows it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, shellBody } from '../../tests/helpers/dom-card.mjs';
import { SOURCE, GH_MARK } from '../ui/source.js';
import { aboutHtml } from '../ui/aboutPage.js';

const REPO = 'https://github.com/lucid-lake/velia';

test('the card: one GitHub link in the foot (href, a new tab, noopener, its label, the mark), no language chip', () => {
  installDom({ body: shellBody(new URL('../', import.meta.url)) });
  const links = [...document.querySelectorAll('#lk-load a.lk-gh')];
  assert.equal(links.length, 1, 'one per card');
  const a = links[0];
  assert.equal(a.getAttribute('href'), REPO); assert.equal(SOURCE.url, REPO);
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener');
  assert.equal(a.getAttribute('aria-label'), 'Velia on GitHub');
  assert.equal(a.textContent.trim(), 'GitHub', 'the mark and the word');
  const svg = a.querySelector('svg.lk-ghm');
  assert.ok(svg, 'the GitHub mark'); assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.ok(svg.innerHTML.includes(GH_MARK.slice(9, 40)), 'the mark is source.js\'s path');
  const foot = document.querySelector('#lk-load .lk-foot');
  assert.ok(foot.contains(a), 'in the foot');
  const order = [...foot.children].map((n) => n.className.split(' ')[0]);
  assert.ok(order.indexOf('lk-supc') < order.indexOf('lk-gh') && order.indexOf('lk-gh') < order.indexOf('lk-ver'), `Support, GitHub, the version (${order})`);
  assert.equal(document.querySelectorAll('#lk-load .lk-lang, #lk-load .lk-langbtn').length, 0, 'no language chip on v2\'s card');
});

test('v1\'s card is unchanged: its language chip, no GitHub link', () => {
  installDom({ body: shellBody() });
  assert.equal(document.querySelectorAll('#lk-load .lk-gh').length, 0);
  assert.equal(document.querySelectorAll('#lk-load .lk-lang .lk-langbtn').length, 1);
});

test('About: "Velia is open source (MIT)." and the repo\'s address as a link in a new tab', () => {
  const h = aboutHtml({ versionLine: 'Version 0.8 · dev' });
  const m = h.match(/<p class="ab-by ab-src">([^<]*)<a ([^>]*)>([^<]*)<\/a><\/p>/);
  assert.ok(m, 'a line under the studio line');
  assert.equal(m[1].trim(), 'Velia is open source (MIT).');
  assert.match(m[2], new RegExp(`href="${REPO}"`)); assert.match(m[2], /target="_blank"/); assert.match(m[2], /rel="noopener"/);
  assert.match(m[2], /aria-label="Velia on GitHub"/);
  assert.equal(m[3], 'github.com/lucid-lake/velia');
  assert.equal(h.match(/github\.com\/lucid-lake\/velia"/g).length, 1, 'one link');
});
