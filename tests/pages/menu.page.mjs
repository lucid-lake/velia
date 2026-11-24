// The menu and the mode switch in a real browser, without the world (no GPU, no dev server): the page and src/ are
// served from disk through Playwright's router; the core is a stand-in that records switchMode().
// Run: npm run test:pages, or node tests/pages/menu.page.mjs (skips itself when Chrome is not installed). Kept out of the
// fast `node --test tests/`: it launches a browser (2026-10-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = 'http://lakeshore.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json' };

// the stand-in page: the tokens, an empty body, the shell on a fake core
const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const SHELL_HEAD = INDEX.match(/ {2}<!-- lk-load:head [\s\S]*?<!-- lk-load:head:end -->/)[0];
const SHELL_BODY = INDEX.match(/ {2}<!-- lk-load:body -->[\s\S]*?<!-- lk-load:body:end -->/)[0];
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#203040}</style>${SHELL_HEAD}</head><body>${SHELL_BODY}
<script type="module">
import { installShell } from '/classic/src/shell.js';
import { createServices } from '/src/sim/core/services.js';
const calls = [], keys = [];
window.__keysSeen = keys;
addEventListener('keydown', (e) => keys.push(e.code));   // the game's listeners: bubble phase, on window
const audio = { muted: false, buses: {}, setMuted(m) { this.muted = m; }, setBus(n, on) { this.buses[n] = on; } };
const renderer = { pr: 1, getPixelRatio() { return this.pr; }, setPixelRatio(v) { this.pr = v; }, setSize() {} };
const core = { audio, renderer, sun: { hour: 18.75 }, wind: { level: 3 },
  async switchMode(next, { params }) { const m = await next; calls.push({ mode: params.get('mode'), start: params.get('start'), heading: params.get('heading'), got: m.name }); } };
// player: the boat the player sails (the 'player' service, refactor round 2 Phase C step 2; the shell reads its pose for
// the mode switch and the feedback mail)
const api = { core, stats: () => ({ gpuMsMedian: 7.5 }), player: { phys: { state: { x: 1200, z: -1050, heading: 251 * Math.PI / 180 } } },
  controls: { level: 3, setLevel(n) { this.level = n; }, pilot: true, setPilot(on) { this.pilot = on; }, setCrewTrim() {}, setHints(on) { this.hints = on; }, view: 'follow' },
  logbook: { logbook: { opened: 0, open() { this.opened++; }, isOpen: false } }, chart: { chart: { toggle: { shown: false, pinned: false, pin() { this.pinned = true; } } } } };
// the page's services registry (src/core/services.js): the shell reads the core, boat, stats, controls ... from it and provides its own
// (menu, settings, mode ...); window.__api reads through to it by name
const services = createServices();
for (const [name, value] of Object.entries(api)) services.provide(name, value);
services.provide('setQuality', (q) => renderer.setPixelRatio(q === 'low' ? 0.8 : 1));   // the core's render scale (src/core/index.js)
window.__api = new Proxy({}, { get: (_, name) => services.get(name) }); window.__calls = calls; window.__audio = audio;
window.__shell = installShell({ services, modes: { sail: async () => ({ name: 'sail' }), cruise: async () => ({ name: 'cruise' }) }, current: 'sail' });
</script></body></html>`;

const skip = !existsSync(CHROME) && 'no Chrome';
test('the menu and the mode switch (a real browser, a stand-in core)', { skip, timeout: 60000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); if (o.welcomed == null) { Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } } catch {} });   // the first-visit welcome would stand in the way (src/ui/home.js)
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(`${HOST}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ body: PAGE, contentType: 'text/html' });
      const f = resolve(ROOT, '.' + u.pathname);
      if (!f.startsWith(ROOT) || !existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: readFileSync(f), contentType: TYPES[extname(f)] ?? 'application/octet-stream' });
    });
    await page.goto(`${HOST}/?mode=sail&hour=18.75&noload=1`);
    await page.waitForFunction(() => window.__shell);
    const st = () => page.evaluate(() => ({ open: window.__api.menu.isOpen, mode: window.__api.mode, url: location.search }));

    await t.test('the tokens are on the page, the mark sits top-left', async () => {
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lk-cream').trim()), '239 230 210');
      const r = await page.evaluate(() => { const b = document.querySelector('.lk-menu-mark').getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width }; });
      assert.ok(r.l < 80 && r.t < 80, JSON.stringify(r));
    });
    await t.test('Esc opens it, Esc closes it; the capsule Menu toggle opens it', async () => {
      assert.equal((await st()).open, false);
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      assert.equal((await st()).open, true);
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      assert.equal((await st()).open, false);
      // the floating ≡ mark is display:none now (tokens.css: the top capsule's Menu opens it; the stand-in has no capsule): the same toggle
      await page.waitForTimeout(600);   // the close animation (480 ms) finishes first
      await page.evaluate(() => window.__api.menu.toggle()); await page.waitForTimeout(100);
      assert.equal((await st()).open, true);
    });
    await t.test('while open, keys stop at the menu (typing never steers the boat)', async () => {
      await page.evaluate(() => { window.__keysSeen.length = 0; });
      await page.keyboard.press('KeyW'); await page.keyboard.press('KeyL');
      assert.deepEqual(await page.evaluate(() => window.__keysSeen), []);
    });
    await t.test('Regatta is a live pick (no longer greyed with "soon")', async () => {
      const r = await page.evaluate(() => { const b = document.querySelector('#lk-load .lk-pick[data-mode=regatta]'); return { dis: b.disabled, text: b.textContent, pe: getComputedStyle(b).pointerEvents }; });
      assert.equal(r.dis, false); assert.doesNotMatch(r.text, /soon/); assert.notEqual(r.pe, 'none');
    });
    await t.test('Sail is lit; a switch to Cruise goes through the horizon line, keeps the boat, writes ?mode=cruise', async () => {
      assert.equal(await page.evaluate(() => document.querySelector('#lk-load .lk-pick[data-mode=sail]').getAttribute('aria-checked')), 'true');
      const t0 = Date.now();
      await page.click('#lk-load .lk-pick[data-mode=cruise]');
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.querySelector('.lk-switch').classList.contains('on')), true, 'the veil is up');
      assert.equal((await st()).open, false, 'the menu closed');
      await page.waitForFunction(() => window.__api.modeSwitchLog.length === 1, null, { timeout: 5000 });
      const log = await page.evaluate(() => window.__api.modeSwitchLog[0]);
      assert.ok(log.ms >= 1500 && log.ms <= 2600, `${log.ms} ms`); assert.ok(Date.now() - t0 >= 1500);
      const c = (await page.evaluate(() => window.__calls))[0];
      assert.equal(c.mode, 'cruise'); assert.equal(c.got, 'cruise'); assert.equal(c.start, '1200.0,-1050.0'); assert.ok(Math.abs(parseFloat(c.heading) - 251) < 1e-6);
      const s = await st();
      assert.equal(s.mode, 'cruise'); assert.match(s.url, /mode=cruise/); assert.match(s.url, /hour=18\.75/, 'the other params kept');
      assert.equal(await page.evaluate(() => document.querySelector('.lk-switch').classList.contains('on')), false, 'the veil is down');
    });
    await t.test('and back to Sail', async () => {
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.querySelector('#lk-load .lk-pick[data-mode=cruise]').getAttribute('aria-checked')), 'true');
      await page.click('#lk-load .lk-pick[data-mode=sail]');
      await page.waitForFunction(() => window.__api.modeSwitchLog.length === 2, null, { timeout: 5000 });
      assert.equal((await st()).mode, 'sail'); assert.match((await st()).url, /mode=sail/);
    });
    await t.test('settings reach the sound, the assists, the wind and the quality', async () => {
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      await page.click('#lk-load .lk-link[data-go=settings]'); await page.waitForTimeout(150);
      // Setup's four tabs (src/ui/homePages.js: Sail, Aids, Sound, Screen; owner 2026-11-09): each row on its own tab
      const tab = async (k) => { await page.click(`#lk-load .pg.on [data-tab=${k}]`); await page.waitForTimeout(100); };
      await tab('sound'); await page.click('#lk-load [data-t=music]');
      await tab('aids'); await page.click('#lk-load [data-t=pilot]'); await page.click('#lk-load [data-t=hints]');
      await tab('sail'); await page.click('#lk-load [data-r="wind:1"]');
      await tab('screen'); await page.click('#lk-load [data-r="quality:low"]');   // the Battery card
      const r = await page.evaluate(() => ({ music: window.__audio.buses.music, pilot: window.__api.controls.pilot, hints: window.__api.controls.hints, wind: window.__api.controls.level, pr: window.__api.core.renderer.pr }));
      assert.deepEqual(r, { music: false, pilot: false, hints: false, wind: 1, pr: 0.8 });
      assert.equal(await page.evaluate(() => document.querySelector('#lk-load [data-r="quality:low"]').getAttribute('aria-checked')), 'true');
    });
    // The Logbook and Chart rows left the card (they open from the top capsule and the dock now; tests/pages/helmWiring.page.mjs and logbookClose.page.mjs).
    await t.test('Contact us: the address as text and a mailto; Send feedback builds the prefilled mailto', async () => {
      await page.waitForTimeout(500); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
      await page.click('#lk-load .lk-link[data-go=about]'); await page.waitForTimeout(150);   // Contact is a row of the Help nav (Solaria stage 2)
      await page.click('#lk-load .hnav .hn[data-go=contact]'); await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.querySelector('#lk-load .addr .mail').textContent), 'contact@lucidlakelabs.com');
      assert.equal(await page.evaluate(() => document.querySelector('#lk-load .addr a').getAttribute('href')), 'mailto:contact@lucidlakelabs.com');
      await page.click('#lk-load .pg.on [data-go=feedback]'); await page.waitForTimeout(150);
      await page.fill('#lk-load textarea', 'Lovely at dusk & the jib luffs');
      await page.fill('#lk-load input[type=email]', 'me@example.com');
      const m = await page.evaluate(() => window.__api.menu.feedbackMailto());
      assert.ok(m.startsWith('mailto:contact@lucidlakelabs.com?subject=Velia%20feedback&body='));
      const body = decodeURIComponent(m.split('body=')[1]);
      for (const s of ['Lovely at dusk & the jib luffs', 'reply to: me@example.com', 'mode: sail', 'wind level: 1', 'hour: 18:45', 'position: 1200, -1050 m, heading 251°', 'browser: Chrome', 'gpu frame: 7.50 ms']) assert.ok(body.includes(s), s);
      await page.click('#lk-load .pg.on [data-tab=tech]'); await page.waitForTimeout(100);   // the Details tab (Solaria stage 1): the lines as sent
      assert.ok(body.endsWith(await page.evaluate(() => document.querySelector('#lk-load [data-fbtech]').textContent)), 'the details shown are the mail\'s own lines');
      await page.uncheck('#lk-load input[name=scene]');
      assert.doesNotMatch(decodeURIComponent((await page.evaluate(() => window.__api.menu.feedbackMailto())).split('body=')[1]), /mode:/);
      assert.equal(await page.evaluate(() => window.__api.menu.feedbackEndpoint), null);
      // typing in the form never reaches the game
      assert.equal(await page.evaluate(() => window.__keysSeen.filter((k) => k.startsWith('Key')).length), 0);
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);   // Esc goes back a page at a time: About, then the plan, then Resume
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => document.getElementById('lk-load').dataset.pg ?? null), null);
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      assert.equal((await st()).open, false);
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
