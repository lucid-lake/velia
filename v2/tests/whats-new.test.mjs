// v2's own What's new (v2/ui/news.js; v1 at /classic/ keeps src/ui/news.js, frozen): the Help page the v2 card builds
// (src/ui/homePages.js pagesHtml with news: V2_NEWS) shows v2's releases on top of v1's and v2's version; v1's page does not.
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { pagesHtml } from '../../src/ui/homePages.js';
import { NEWS as NEWS_V1, VERSION_LINE, prettyDate } from '../../src/ui/news.js';
import { NEWS_V2, V2_NEWS } from '../ui/news.js';
import { WATERS, WATERS_SOON } from '../../src/sim/waters/index.js';
import { VESSELS, VESSELS_SOON } from '../../src/sim/vessels/index.js';

const page = (html, id) => html.match(new RegExp(`<section[^>]*data-page="${id}"[\\s\\S]*?</section>`))?.[0] ?? '';
const build = (news) => pagesHtml({ waters: WATERS, vessels: VESSELS, wChosen: WATERS[0].id, vChosen: VESSELS[0].id, wSoon: WATERS_SOON, vSoon: VESSELS_SOON, news });
const dates = (html) => [...page(html, 'news').matchAll(/<span class="rd">([^<]+)<\/span>/g)].map((m) => m[1]);

test('the v2 card: v2\'s releases first (the newest open), then v1\'s; v2\'s version on What\'s new and About', () => {
  const html = build(V2_NEWS);
  assert.equal(dates(html)[0], prettyDate(NEWS_V2[0].date));
  assert.deepEqual(dates(html), [...new Set([...NEWS_V2, ...NEWS_V1].map((n) => n.date))].map(prettyDate));
  assert.equal((page(html, 'news').match(/class="nw"/g) ?? []).length, NEWS_V2.length + NEWS_V1.length);
  assert.match(page(html, 'news'), /<details class="rel" data-rel="[^"]+" open>/);
  for (const id of ['news', 'about']) assert.ok(page(html, id).includes(V2_NEWS.versionLine), `${id}: ${V2_NEWS.versionLine}`);
  assert.doesNotMatch(page(html, 'news'), /Fireworks over the lake/, 'no fireworks line while the night is being fixed');
});

test('the v1 card (no news passed): v1\'s list and version only, none of v2\'s lines', () => {
  const html = build(null);
  assert.equal(dates(html)[0], prettyDate(NEWS_V1[0].date));
  for (const n of NEWS_V2) assert.ok(!page(html, 'news').includes(n.text.replace(/’/g, '’')), n.text);
  assert.ok(page(html, 'news').includes(VERSION_LINE) && !page(html, 'news').includes(V2_NEWS.versionLine));
});

test('the v2 first paint (owner 2026-11-17; 2026-11-18: Log reads Logbook, the panel adds Tutorial): the row\'s buttons are ENTER Chart Logbook Keys Setup Tutorial (the desktop panel shows Set sail SETUP KEYS TUTORIAL LOGBOOK, the phone CHART LOGBOOK CONTROLS SETUP), the foot link is About, v1\'s page keeps ABOUT in the row and What\'s new in the foot', () => {
  const words = (f) => { const h = readFileSync(new URL(f, import.meta.url), 'utf8'); return { row: [...h.match(/<nav class="lk-links"[^>]*>([\s\S]*?)<div class="lk-foot">/)[1].matchAll(/<button class="lk-link[^"]*"[^>]*>(?:<span class="pq">)?([^<]+)/g)].map((m) => m[1]), foot: h.match(/<button class="lk-news"[^>]*data-go="(\w+)"[^>]*><span class="t">([^<]+)</).slice(1) }; };
  assert.deepEqual(words('../index.html'), { row: ['ENTER', 'Chart', 'Logbook', 'Keys', 'Setup', 'Tutorial'], foot: ['about', 'About '] });
  assert.deepEqual(words('../../index.html'), { row: ['ENTER', 'Log', 'Keys', 'Setup', 'About'], foot: ['news', 'What’s new '] });
});
