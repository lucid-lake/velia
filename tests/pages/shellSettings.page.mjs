// The shell's half of the home card in a real browser, without the world (no GPU, no dev server): src/ is served from
// disk through Playwright's router and the core is a stand-in, as in tests/pages/menu.page.mjs. What src/shell.js does
// with the card's choices: the display setting turns the theme, another lake or boat reloads the page with it in the
// URL, the loading card's language pick is saved, and the old menu page is gone (tests/home.test.mjs, loading.test.mjs).
// Run: npm run test:pages, or node tests/pages/shellSettings.page.mjs (skips itself when Chrome is not installed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = 'http://lakeshore.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json' };

const INDEX = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
const SHELL_HEAD = INDEX.match(/ {2}<!-- lk-load:head [\s\S]*?<!-- lk-load:head:end -->/)[0];
const SHELL_BODY = INDEX.match(/ {2}<!-- lk-load:body -->[\s\S]*?<!-- lk-load:body:end -->/)[0];
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#203040}</style>${SHELL_HEAD}</head><body>${SHELL_BODY}
<script type="module">
import { installShell } from '/classic/src/shell.js';
import { createServices } from '/src/sim/core/services.js';
const audio = { muted: false, buses: {}, setMuted(m) { this.muted = m; }, setBus(n, on) { this.buses[n] = on; } };
const renderer = { pr: 1, getPixelRatio() { return this.pr; }, setPixelRatio(v) { this.pr = v; }, setSize() {} };
const core = { audio, renderer, sun: { hour: 12, elevationDeg: 40 }, wind: { level: 3 }, async switchMode() {} };
const api = { core, stats: () => ({ gpuMsMedian: 7.5 }) };
// the page's services registry (src/core/services.js): the shell reads the core, boat, stats, controls ... from it and provides its own
// (menu, settings, mode ...); window.__api reads through to it by name
const services = createServices();
for (const [name, value] of Object.entries(api)) services.provide(name, value);
window.__api = new Proxy({}, { get: (_, name) => services.get(name) });
window.__shell = installShell({ services, modes: { sail: async () => ({ name: 'sail' }), cruise: async () => ({ name: 'cruise' }) }, current: 'sail' });
</script></body></html>`;

const skip = !existsSync(CHROME) && 'no Chrome';
test('the shell and the home card (a real browser, a stand-in core)', { skip, timeout: 60000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); if (o.welcomed == null) { Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } } catch {} });   // no first-visit welcome
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(`${HOST}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ body: PAGE, contentType: 'text/html' });
      const f = resolve(ROOT, '.' + u.pathname);
      if (!f.startsWith(ROOT) || !existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: readFileSync(f), contentType: TYPES[extname(f)] ?? 'application/octet-stream' });
    });
    await page.goto(`${HOST}/?mode=sail&hour=12&noload=1`);
    await page.waitForFunction(() => window.__shell);

    await t.test('the old menu page is gone: the only menu piece the shell puts up is the home card\'s mark', async () => {
      const r = await page.evaluate(() => [...document.querySelectorAll('[class*="lk-menu"], [id*="lk-menu"]')].map((e) => `${e.tagName.toLowerCase()}.${e.className}`));
      assert.deepEqual(r, ['button.lk-menu-mark lk-rd sm']);
    });
    await t.test('Settings → display turns the instruments\' theme (src/ui/theme.js on <html>)', async () => {
      const pick = (v) => page.evaluate((r) => { document.querySelector(`#lk-load .opt[data-r="display:${r}"]`).click(); return document.documentElement.dataset.lkTheme; }, v);
      assert.equal(await pick('night'), 'night');
      assert.equal(await pick('day'), 'day');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1')).display), 'day', 'saved');
      const big = await page.evaluate(() => { document.querySelector('#lk-load .opt[data-t=largeText]').click(); return document.documentElement.dataset.lkText; });
      assert.equal(big, 'large', 'larger text, the same kind of switch');
    });
    await t.test('the loading card\'s language pick is saved as settings.lang', async () => {
      const keys = await page.evaluate(() => { const seen = []; const off = window.__shell.settings.on((k, v) => seen.push(`${k}=${v}`)); dispatchEvent(new CustomEvent('lakeshore:lang', { detail: { lang: 'en' } })); off(); return seen; });
      assert.deepEqual(keys, ['lang=en']);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1')).lang), 'en');
    });
    await t.test('another lake or boat reloads the page with it in the URL (one of each is ready today: a stand-in tile)', async () => {
      for (const k of ['waters', 'vessel']) {
        const nav = page.waitForURL((u) => new URL(u).searchParams.get(k) === 'kawartha', { timeout: 10000 });
        await page.evaluate((key) => {
          const t = document.querySelector(`#lk-load .tile[data-${key}]`), other = document.createElement('button');
          other.className = 'tile'; other.type = 'button'; other.dataset[key] = 'kawartha'; t.parentNode.appendChild(other); other.click();
        }, k);
        await nav;
        const u = new URL(page.url());
        assert.equal(u.searchParams.get(k), 'kawartha'); assert.equal(u.searchParams.get('mode'), 'sail', 'the rest of the URL stays');
        await page.waitForFunction(() => window.__shell);
      }
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
