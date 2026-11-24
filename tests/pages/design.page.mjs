// The design system's layout in a real browser, without the world (no GPU, no dev server): the page and src/ are served
// from disk through Playwright's router (as tests/pages/menu.page.mjs); the menu runs on a stand-in core, and the wind
// dial and the chart are mounted alone (a flat stand-in lake)., § 4–5. Checks: the round family (the chart
// the bottom-left circle, the dial the bottom-right one, both --lk-d, no readout plate under either), the menu's icons at
// the stroke token, the mark top-left, the studio's lines and no "Lakeshore" anywhere the player reads.
// Run: npm run test:pages, or node tests/pages/design.page.mjs (skips itself when Chrome is not installed).
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
import { createCaptainView } from '/src/ui/captainView.js';
import { createChartplotter } from '/src/ui/chartplotter.js';
const audio = { muted: false, buses: {}, setMuted(m) { this.muted = m; }, setBus(n, on) { this.buses[n] = on; } };
const renderer = { pr: 1, getPixelRatio() { return this.pr; }, setPixelRatio(v) { this.pr = v; }, setSize() {} };
const core = { audio, renderer, sun: { hour: 18.75 }, wind: { level: 3 }, async switchMode() {} };
const api = { core, stats: () => ({ gpuMsMedian: 7.5 }), boat: { phys: { state: { x: 1200, z: -1050, heading: 0 } } },
  controls: { level: 3, setLevel(n) { this.level = n; }, pilot: true, setPilot() {}, setCrewTrim() {}, setHints() {}, view: 'follow' },
  logbook: { logbook: { opened: 0, open() {}, isOpen: false } }, chart: { chart: { toggle: { shown: false, pinned: false, pin() {} } } } };
// the page's services registry (src/core/services.js): the shell reads the core, boat, stats, controls ... from it and provides its own
// (menu, settings, mode ...); window.__api reads through to it by name
const services = createServices();
for (const [name, value] of Object.entries(api)) services.provide(name, value);
window.__api = new Proxy({}, { get: (_, name) => services.get(name) });
window.__shell = installShell({ services, modes: { sail: async () => ({ name: 'sail' }) }, current: 'sail' });
window.__cv = createCaptainView({ always: true, state: () => null });
window.__cp = createChartplotter({ terrain: { heightAt: () => -20 }, places: {}, boat: () => ({ x: 0, z: 0, heading: 0, sog: 0, cog: 0, trueWind: null }) });
window.__mounted = true;
</script></body></html>`;

const skip = !existsSync(CHROME) && 'no Chrome';
test('the design system in a real browser (a stand-in core, the dial and the chart alone)', { skip, timeout: 60000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); if (o.welcomed == null) { Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } } catch {} });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.route(`${HOST}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ body: PAGE, contentType: 'text/html' });
      const f = resolve(ROOT, '.' + u.pathname);
      if (!f.startsWith(ROOT) || !existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ body: readFileSync(f), contentType: TYPES[extname(f)] ?? 'application/octet-stream' });
    });
    await page.goto(`${HOST}/?mode=sail&hour=18.75&noload=1`);
    await page.waitForFunction(() => window.__mounted && window.__shell, null, { timeout: 30000 });
    // a token in px, as the browser resolves it
    const px = (v) => page.evaluate((v) => { const p = document.createElement('div'); p.style.cssText = `position:absolute;visibility:hidden;width:${v}`; document.body.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return w; }, v);
    const box = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, rd: e.classList.contains('lk-rd') }; }, sel);

    await t.test('the round family: the chart bottom-left, the dial bottom-right, both --lk-d, no readout plates', async () => {
      const d = await px('var(--lk-d)'), mx = await px('var(--lk-mx)'), by = await px('var(--lk-by)');
      assert.ok(d > 100, `--lk-d resolves (${d})`);
      const ch = await box('.lk-chart .small'), cv = await box('.lk-cv');
      assert.ok(ch?.rd && cv?.rd, 'both are round instruments (lk-rd)');
      assert.ok(Math.abs(ch.w - d) < 1 && Math.abs(ch.h - d) < 1, `the chart is --lk-d wide (${ch.w}×${ch.h} vs ${d})`);
      assert.ok(Math.abs(ch.l - mx) < 1 && Math.abs(720 - ch.b - by) < 1, `the chart is the bottom-left circle (${JSON.stringify(ch)})`);
      assert.ok(Math.abs(1280 - cv.r - mx) < 1 && Math.abs(720 - cv.b - by) < 1, `the dial is the bottom-right circle (${JSON.stringify(cv)})`);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.lk-cv .read,.lk-chart .read').length), 0, 'no readout plate under the dial or the chart');
    });

    await t.test('the menu: the icons at the stroke token, the mark top-left', async () => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__api.menu?.isOpen);
      const sw = await page.evaluate(() => [...document.querySelectorAll('#lk-load .ic')].map((e) => getComputedStyle(e).strokeWidth));
      assert.ok(sw.length > 0 && sw.every((v) => v === '1.7px'), `the icons draw at 1.7 px (${[...new Set(sw)]})`);
      const m = await box('.lk-menu-mark');
      assert.ok(m && m.l < 80 && m.t < 80, `the mark sits top-left (${JSON.stringify(m)})`);
    });

    await t.test('the studio is named; nothing the player reads says Lakeshore', async () => {
      const text = await page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('script,style').forEach((e) => e.remove()); return c.textContent + ' ' + [...document.querySelectorAll('[aria-label],[title],[placeholder]')].map((e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder')].join(' ')).join(' ') + ' ' + document.title; });
      assert.ok(text.includes('Velia is made by Zhao Lou at Lucid Lake Studio.'), 'the About page');
      assert.ok(text.includes('Velia, by Lucid Lake Studio.'), 'the credits');
      assert.doesNotMatch(text, /Lakeshore/);
    });
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await browser.close(); }
});
