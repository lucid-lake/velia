// Solaria stage 1 (owner, 2026-11-06): Support Velia as a plain Ko-fi link in three fixed places
// (the card's foot, a row in About, the end of About), its support_click count, the card foot's version and What's new,
// and the feedback form's five quick rows and its technical details shown as sent. The home card runs on the stub DOM
// with the real shell markup (tests/helpers/home-mount.mjs); the browser side is tests/pages/solaria.page.mjs (retired 2026-11-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUPPORT, CUP_ICON, supportLink, supportSource } from '../src/ui/support.js';
import { NEWS, VERSION, CARD_VERSION_LINE, prettyDate } from '../src/ui/news.js';
import { EVENTS, SUPPORT_SOURCES, createMetrics } from '../src/metrics.js';
import { pointOf } from '../functions/api/e.js';
import { feedbackBody, feedbackMailto, ratingLines, techLines, RATINGS, sceneLines } from '../src/ui/feedback.js';
import { mountHome } from './helpers/home-mount.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const attrs = (a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), source: a.dataset.support });

test('the link: the studio\'s Ko-fi page, a new tab, rel noopener; no widget script, no pixel', () => {
  assert.equal(SUPPORT.url, 'https://ko-fi.com/lucidlake');
  const html = supportLink('about', 'x', 'kl');
  assert.match(html, /^<a class="kl" href="https:\/\/ko-fi\.com\/lucidlake" target="_blank" rel="noopener" data-support="about">x<\/a>$/);
  for (const f of ['index.html', 'src/ui/loading-shell.html', 'src/ui/home.js', 'src/ui/homePages.js', 'src/ui/support.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /<script[^>]*ko-fi|ko-fi\.com\/widgets|storage\.ko-fi|kofiwidget|<img[^>]*ko-fi/i, `${f}: no Ko-fi script, widget or pixel`);
  }
  assert.deepEqual(SUPPORT_SOURCES, ['card', 'about', 'help']);
});

test('three fixed places, each a plain link: the card foot, Help › Support, the end of About', async () => {
  const c = await mountHome({ state: 'home' });
  try {
    const card = c.q('.lk-links .lk-foot a[data-support]');
    assert.ok(card, 'the card foot has the link');
    assert.deepEqual(attrs(card), { href: SUPPORT.url, target: '_blank', rel: 'noopener', source: 'card' });
    assert.equal(card.textContent.trim(), 'Support Velia');
    assert.equal(card.querySelector('svg.lk-cup').innerHTML.replace(/\s+/g, ' '), CUP_ICON.replace(/\/>/g, '></path>').replace(/\s+/g, ' '), 'the cup glyph');
    assert.equal(c.q('.lk-foot .lk-supl').textContent, 'A coffee keeps the lake open.', 'the line under it');
    const sup = c.q('.pg[data-page=support]').querySelectorAll('a[data-support]');
    assert.deepEqual(sup.map(attrs), [{ href: SUPPORT.url, target: '_blank', rel: 'noopener', source: 'help' }], 'Help › Support: the one link');
    assert.match(sup[0].textContent, /Support Velia/);
    assert.match(sup[0].className, /\bkl\b/, 'the gold pill');
    assert.equal(c.q('.pg[data-page=support] .supl').textContent, SUPPORT.cardLine, 'plus one line');
    const links = [null, ...c.q('.pg[data-page=about]').querySelectorAll('a[data-support]')];
    assert.deepEqual(links.slice(1).map(attrs), [{ href: SUPPORT.url, target: '_blank', rel: 'noopener', source: 'about' }]);
    assert.equal(links[1].textContent, 'Buy the skipper a coffee');
    assert.match(links[1].className, /\bpbtn\b/, 'an outline button, with the cup');
    assert.ok(links[1].querySelector('svg.ic'));
    assert.equal(links[1].parentNode.previousElementSibling?.textContent ?? links[1].parentNode.parentNode.querySelector('.kofi').textContent, 'The wind is free. The skipper runs on coffee.', 'one personal line, the joke, then the button');
    // nowhere else: no other support link in the card, no pop-up anywhere
    assert.equal(c.root.querySelectorAll('a[data-support]').length, 3);
  } finally { c.home.dispose(); }
});

test('a press counts support_click with its source, and nothing else', async () => {
  const sent = [];
  const c = await mountHome({ state: 'home', metric: (n, p) => sent.push([n, p]) });
  try {
    for (const a of c.root.querySelectorAll('a[data-support]')) c.D.fire(a, 'click', { bubbles: true });
    assert.deepEqual(sent.map((x) => x[1].source).sort(), ['about', 'card', 'help']);
    assert.ok(sent.every((x) => x[0] === 'support_click'));
    assert.equal(supportSource(c.q('.lk-sup svg')), 'card', 'a press on the cup is the link\'s');
    assert.equal(c.home.view, 'home', 'the card stays: the browser opens the page in a new tab');
  } finally { c.home.dispose(); }
});

test('support_click: the schema takes the source only; the server keeps a known source, nothing else', () => {
  assert.deepEqual(EVENTS.support_click, ['source']);
  const out = [];
  const M = createMetrics({ env: { search: '?metrics=1', hostname: 'velia.example' }, send: (u, b) => out.push(JSON.parse(b)), setTimer: () => 0, clearTimer: () => {} });
  assert.equal(M.track('support_click', { source: 'card', id: 'abc', email: 'a@b.co' }), true);
  M.flush();
  assert.deepEqual(out[0].e, [{ n: 'support_click', p: { source: 'card' } }], 'no id, no email: the source only');
  for (const s of SUPPORT_SOURCES) assert.equal(pointOf({ n: 'support_click', p: { source: s } }).detail, s);
  assert.equal(pointOf({ n: 'support_click', p: { source: 'popup' } }).detail, '', 'an unknown source is dropped');
  assert.equal(pointOf({ n: 'support_click', p: { source: 'card' } }).event, 'support_click', 'the server accepts the event');
});

test('the card foot: the version and the newest date under What\'s new; it opens What\'s new, and back is the card', async () => {
  assert.equal(CARD_VERSION_LINE, `Version ${VERSION} · ${prettyDate(NEWS[0].date)}`);
  const c = await mountHome({ state: 'home' });
  try {
    const news = c.q('.lk-foot .lk-news');
    assert.equal(c.q('.lk-foot .lk-ver').textContent, CARD_VERSION_LINE, 'the card says the version and the date (first paint, tools/loading_shell.py)');
    assert.match(news.querySelector('.t').textContent, /^What’s new ›$/);
    news.click();
    assert.equal(c.home.view, 'news', 'What\'s new opens the existing page');
    assert.equal(c.q('.hnav .pg-back').dataset.go, 'home', 'the Help nav beside it leads back to the card');
    assert.equal(c.q('.hnav .hn[aria-current=page]').dataset.nav, 'news', 'its nav row is lit');
    c.D.key('Escape'); assert.equal(c.home.view, 'home', 'Esc goes back to the card');
  } finally { c.home.dispose(); }
});

test('feedback: five quick 1–5 rows, any skipped; the mail body carries the rows answered', () => {
  assert.deepEqual(RATINGS.map((r) => r[1]), ['fun', 'beauty', 'controls', 'performance', 'would recommend']);
  assert.deepEqual(ratingLines({ fun: 5, controls: 2, beauty: 9, performance: 0 }), ['fun: 5 of 5', 'controls: 2 of 5'], 'out of range is dropped');
  const body = feedbackBody({ text: 'Lovely.', ratings: { fun: 4, recommend: 5 } });
  assert.equal(body, 'Lovely.\n\n— quick rating —\nfun: 4 of 5\nwould recommend: 5 of 5\n');
  assert.doesNotMatch(feedbackBody({ text: 'x' }), /quick rating/, 'no rows answered: no section');
  const m = feedbackMailto({ text: 'x', ratings: { fun: 3 } });
  assert.ok(m.startsWith('mailto:contact@lucidlakelabs.com?subject=Velia%20feedback&body='), 'still a mailto');
  assert.deepEqual(techLines({}), ['— technical details —', ...sceneLines({})]);
});

test('feedback page: the rows set and clear; the details show exactly the lines the mail carries, or nothing', async () => {
  const scene = { mode: 'sail', windLevel: 2, hour: 15.5, x: 10, z: -20, headingDeg: 90, browser: 'Chrome 141 · macOS', gpuMs: 9.5, viewport: '1280×720 @1.00' };
  const c = await mountHome({ state: 'home', scene: () => scene });
  try {
    c.home.show('feedback', false);
    const pg = c.q('.pg[data-page=feedback]');
    assert.deepEqual(pg.querySelectorAll('[role=tab]').map((t) => t.textContent), ['Note', 'Rate', 'Details']);
    assert.equal(pg.querySelectorAll('.set[data-set^=rate-]').length, 5);
    for (const r of pg.querySelectorAll('.set[data-set^=rate-]')) assert.deepEqual(r.querySelectorAll('.opt').map((o) => o.textContent), ['1', '2', '3', '4', '5']);
    c.q('#lk-fb-text').value = 'The light.';
    c.q('.opt[data-r="rate:fun:4"]').click(); c.q('.opt[data-r="rate:beauty:5"]').click();
    c.q('.opt[data-r="rate:beauty:5"]').click();   // a second press clears it
    assert.equal(c.q('.opt[data-r="rate:fun:4"]').getAttribute('aria-checked'), 'true');
    assert.equal(c.q('.opt[data-r="rate:beauty:5"]').getAttribute('aria-checked'), 'false');
    const pre = c.q('[data-fbtech]');
    const body = () => decodeURIComponent(c.home.feedbackMailto().split('body=')[1]);
    assert.equal(c.q('input[name=scene]').checked, true, 'technical details: on by default, as before');
    assert.ok(body().endsWith(pre.textContent), 'the details shown are the mail\'s last lines, exactly');
    assert.match(body(), /^The light\.\n\n— quick rating —\nfun: 4 of 5\n\n— technical details —\nmode: sail/);
    const tick = c.q('input[name=scene]'); tick.checked = false; c.D.fire(tick, 'change', { bubbles: true });
    assert.equal(pre.textContent, 'Nothing technical is sent.');
    assert.doesNotMatch(body(), /technical details|mode:|browser:/, 'unticked: none of it is sent');
  } finally { c.home.dispose(); }
});

test('the card\'s lower row is one row: ENTER · LOG · KEYS · SETUP · ABOUT; Contact in the Help nav; the language in the corner and in Settings', async () => {
  const c = await mountHome({ state: 'home' });
  try {
    assert.deepEqual(c.root.querySelectorAll('.lk-links > .lk-link').map((b) => b.dataset.go ?? 'enter'), ['enter', 'logbook', 'keys', 'settings', 'about']);
    assert.equal(c.root.querySelectorAll('.lk-links [data-go=contact], .lk-links .lk-lang').length, 0, 'no Contact, no language in the row');
    assert.equal(c.q('.lk-card > .lk-lang .lk-langname').textContent, 'EN', 'the corner says EN');
    c.q('.lk-links [data-go=about]').click(); c.q('.hnav .hn[data-go=contact]').click();
    assert.equal(c.home.view, 'contact', 'Contact is a row of the Help nav');
    c.q('.pg.on [data-go=feedback]').click(); assert.equal(c.home.view, 'feedback', 'Send feedback under Contact');
    c.D.key('Escape'); assert.equal(c.home.view, 'contact', 'and back is Contact');
    c.home.show('settings', false);
    assert.equal(c.q('.opt[data-r="lang:en"]').getAttribute('aria-checked'), 'true', 'Settings keeps the language');
  } finally { c.home.dispose(); }
});
