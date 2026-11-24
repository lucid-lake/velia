// The bar's music control in a real browser (src/ui/viewSwitch.js: Music, its menu's Next song). Part 1, no GPU and no dev server (the page
// and src/ served from disk through Playwright's router, as tests/pages/menu.page.mjs): the bar on a stand-in player.
// ♪ and ⏭ in a "music" group; ⏭ turns the music on first, plays the next song and sends the music_next event with the
// mode; the title opens inside the music segment (no floating caption) and eases with no transition under reduced
// motion; the Music menu's first row is Next song; with no player there is no menu. Part 2 (only with a dev server,
// LAKESHORE_BASE or --base: it needs the GPU): Sail and Cruise hand the bar their player.
// The scheduler, the engine and the titles are checked fast in tests/musicNext.test.mjs.
// Run: npm run test:pages, or node tests/pages/musicNext.page.mjs [--base http://127.0.0.1:<port>]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = 'http://lakeshore.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json' };
const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;

const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const TOKENS = INDEX.match(/<style id="lk-tokens">[\s\S]*?<\/style>/)[0];
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#203040}</style>${TOKENS}</head><body>
<script type="module">
import { createViewSwitch } from '/src/ui/viewSwitch.js';
import { startMetrics } from '/src/metrics.js';
import { createServices } from '/src/sim/core/services.js';
window.__beacons = [];
navigator.sendBeacon = (url, body) => { (body.text ? body.text() : Promise.resolve(String(body))).then((t) => window.__beacons.push({ url, t })); return true; };
startMetrics();
const services = createServices(); services.provide('mode', 'sail');   // the shell's mode, as the page's registry holds it
const player = { off: true, paused: false, title: null, songId: 0, nexts: 0, ons: 0, turnOn() { this.off = false; this.ons++; }, next() { this.nexts++; this.songId++; this.title = 'Lake at first light'; }, toggle() {}, setVolume() {} };
let view = 'follow';
const mk = (music) => createViewSwitch({ view: () => view, set: (v) => { view = v; }, music, nudge: false, once: false, storage: null, services });
const withPlayer = mk(() => player), bare = mk(null);
bare.el.style.top = '120px';
let last = performance.now();
const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; withPlayer.update(dt); bare.update(dt); requestAnimationFrame(loop); };
requestAnimationFrame(loop);
Object.assign(window, { __player: player, __vs: withPlayer, __bare: bare, __mounted: true });
</script></body></html>`;

const skip = !existsSync(CHROME) && 'no Chrome';
test('the bar\'s music control (a real browser, a stand-in player)', { skip, timeout: 60000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); });   // the metrics stay off under automation otherwise
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(`${HOST}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ body: PAGE, contentType: 'text/html' });
      const f = resolve(ROOT, '.' + u.pathname);
      if (!f.startsWith(ROOT) || !existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: readFileSync(f), contentType: TYPES[extname(f)] ?? 'application/octet-stream' });
    });
    await page.goto(`${HOST}/?mode=sail&metrics=1`);
    await page.waitForFunction(() => window.__mounted);

    await t.test('Music sits alone in a "music" group (owner, 2026-11-11: ⏭ folded into its menu); no player: no menu', async () => {
      const r = await page.evaluate(() => { const g = window.__vs.el.querySelector('[role=group][aria-label=music]'); return { g: !!g, labels: g ? [...g.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) : [], bareMenu: !!window.__bare.el.querySelector('.lk-sndpick') }; });
      assert.ok(r.g, 'the music group');
      assert.deepEqual(r.labels, ['music']);
      assert.equal(r.bareMenu, false, 'with no player there is no Music menu');
    });

    await t.test('the Music menu\'s first row, Next song, turns the music on, plays the next song and sends music_next with the mode', async () => {
      await page.click('.lk-view >> nth=0 >> [data-x=sound]');
      await page.click('.lk-view >> nth=0 >> .lk-sndpick .nx');
      await page.mouse.click(20, 700);   // a press outside closes the menu (an open menu holds the song's title back)
      const p = await page.evaluate(() => ({ ons: window.__player.ons, nexts: window.__player.nexts, off: window.__player.off }));
      assert.deepEqual(p, { ons: 1, nexts: 1, off: false });
      await page.evaluate(() => dispatchEvent(new Event('pagehide')));   // the metrics flush
      await page.waitForFunction(() => window.__beacons.length > 0, null, { timeout: 5000 });
      const ev = (await page.evaluate(() => window.__beacons)).flatMap((b) => JSON.parse(b.t).e);
      assert.deepEqual(ev.filter((e) => e.n === 'music_next'), [{ n: 'music_next', p: { mode: 'sail' } }]);
    });

    await t.test('the title opens inside the music segment, at its own width; no floating caption', async () => {
      await page.waitForFunction(() => window.__vs.el.querySelector('.mus').classList.contains('song'), null, { timeout: 3000 });
      await page.waitForTimeout(900);   // the segment has eased open (the title shows 4 s)
      const r = await page.evaluate(() => { const ttl = window.__vs.el.querySelector('.mus .ttl'); return { text: ttl.textContent, inSeg: ttl.parentElement.classList.contains('mus'), max: getComputedStyle(ttl).maxWidth, tw: ttl.style.getPropertyValue('--tw'), caps: document.querySelectorAll('.lk-mcap').length, dur: getComputedStyle(ttl).transitionDuration }; });
      assert.equal(r.text, 'Lake at first light'); assert.ok(r.inSeg);
      assert.ok(r.tw && r.max === r.tw, `max-width is --tw (${r.max} vs ${r.tw})`);
      assert.equal(r.caps, 0, 'no floating caption');
      assert.ok(r.dur.split(',').some((d) => parseFloat(d) > 0), `it eases (${r.dur})`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const d2 = await page.evaluate(() => getComputedStyle(window.__vs.el.querySelector('.mus .ttl')).transitionDuration);
      assert.ok(d2.split(',').every((d) => parseFloat(d) === 0), `reduced motion: no transition (${d2})`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await t.test('the Music menu holds Next song as its first row, then pause, the sound and the volume', async () => {
      const r = await page.evaluate(() => { const p = window.__vs.el.querySelector('.lk-sndpick'); return p ? { first: p.querySelector('button')?.textContent.trim(), labels: [...p.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) } : null; });
      assert.ok(r, 'the menu is there');
      assert.equal(r.first, 'Next song'); assert.deepEqual(r.labels, ['next song (])', 'pause music', 'sound on or off (M)']);
    });
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await browser.close(); }
});

test('Sail and Cruise hand the bar their player (the real modes; needs the GPU)', { skip: skip || (!BASE && 'no dev server (LAKESHORE_BASE)'), timeout: 600000 }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } catch {} });
    for (const mode of ['sail', 'cruise']) {
      await page.goto(`${BASE}/?mode=${mode}&hour=15&seed=1&noload=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.querySelector('.lk-view .mus'), null, { timeout: 240000 });
      // the bar has a player: Music opens its menu, Next song its first row (owner, 2026-11-11: no ⏭ on the bar)
      const r = await page.evaluate(() => { const v = [...document.querySelectorAll('.lk-view')].find((e) => e.querySelector('.mus')); const b = v.querySelector('.mus [data-x=sound]'); return { pop: b.getAttribute('aria-haspopup'), first: v.querySelector('.lk-sndpick button')?.textContent.trim() ?? null, bare: !!v.querySelector('.mus [data-x=next]') }; });
      assert.equal(r.pop, 'true', `${mode}: Music opens a menu`); assert.equal(r.first, 'Next song', `${mode}: Next song first`); assert.equal(r.bare, false, `${mode}: no ⏭ on the bar`);
    }
  } finally { await browser.close(); }
});
