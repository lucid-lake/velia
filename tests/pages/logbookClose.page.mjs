// The logbook closes like the card pages do (owner, 2026-10-31): a mouse press or a tap on the empty space outside it, and
// Esc; a press inside does not. The real createLogbook on a bare page (no GPU, no server); src/ served from disk.
// Skips itself when Chrome is not installed. Run: node tests/pages/logbookClose.page.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = 'http://lakeshore.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.json': 'application/json' };
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#203040}#world{position:fixed;inset:0}</style></head><body><div id="world"></div>
<script type="module">
import { createLogbook } from '/src/ui/logbook.js';
window.__log = createLogbook({ storage: null, once: false });
window.__world = []; for (const t of ['pointerdown', 'mousedown', 'click', 'touchstart']) document.getElementById('world').addEventListener(t, () => window.__world.push(t));
</script></body></html>`;
const skip = !existsSync(CHROME) && 'no Chrome';

test('logbook: closes on an outside press (mouse and touch) and on Esc; not on a press inside', { skip, timeout: 60000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const [name, opts] of [['mouse 1280x720', { viewport: { width: 1280, height: 720 } }], ['touch 390x844', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]]) {
      const ctx = await browser.newContext(opts); const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.route(`${HOST}/**`, (route) => {
        const u = new URL(route.request().url());
        if (u.pathname === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' });
        const f = resolve(ROOT, '.' + u.pathname);
        if (!f.startsWith(ROOT) || !existsSync(f)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: readFileSync(f), contentType: TYPES[extname(f)] ?? 'application/octet-stream' });
      });
      await page.goto(`${HOST}/`); await page.waitForFunction(() => window.__log);
      const state = () => page.evaluate(() => window.__log.state);
      const open = async () => { await page.evaluate(() => window.__log.open({ now: true })); await page.waitForTimeout(150); assert.equal(await state(), 'open'); await page.evaluate(() => { window.__world.length = 0; }); };
      const outside = (isTouch) => (isTouch ? page.touchscreen.tap(opts.viewport.width - 8, 8) : page.mouse.click(opts.viewport.width - 8, 8));
      const tch = !!opts.hasTouch;
      await t.test(name + ': a press outside closes it, and the water never sees it', async () => {
        await open(); await outside(tch); await page.waitForTimeout(100);
        assert.ok(['closing', 'closed'].includes(await state()), await state());
        assert.deepEqual(await page.evaluate(() => window.__world), [], 'the press that closed it is eaten');
        await page.waitForTimeout(600); await outside(tch); await page.waitForTimeout(100);
        assert.ok((await page.evaluate(() => window.__world)).includes('pointerdown'), 'closed: the next press reaches the world');
      });
      await t.test(name + ': a press inside the card keeps it open', async () => {
        await open();
        const b = await page.evaluate(() => { const r = document.querySelector('.lk-log .card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        if (tch) await page.touchscreen.tap(b.x, b.y); else await page.mouse.click(b.x, b.y);
        await page.waitForTimeout(100); assert.equal(await state(), 'open');
        await page.evaluate(() => window.__log.close()); await page.waitForTimeout(600);
      });
      await t.test(name + ': Esc closes it', async () => {
        await open(); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
        assert.ok(['closing', 'closed'].includes(await state()), await state());
        await page.waitForTimeout(600);
      });
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); }
});
