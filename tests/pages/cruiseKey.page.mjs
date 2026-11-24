// The Cruise key in Sail, on the real world (needs the GPU; tests/home.test.mjs has the key table and the H list): the dock
// teaches it (` and "let her sail herself" on its hover label) and the ` key switches the running mode to Cruise through the
// shell (L.switchMode). Run by `npm run test:pages`, or
//   LAKESHORE_BASE=http://127.0.0.1:<port> node tests/pages/cruiseKey.page.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.LAKESHORE_BASE;
const skip = (!BASE && 'no LAKESHORE_BASE (run through npm run test:pages)') || (!existsSync(CHROME) && 'no Chrome');

test('the ` key in Sail: taught by the dock, switches to Cruise', { skip, timeout: 600000 }, async (t) => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } catch {} });   // no welcome, no offers
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/?mode=sail&hour=12&gate=0&attract=0&welcome=0&first=0&metrics=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__lakeshore?.dock && window.__lakeshore?.switchMode && window.__lakeshore?.controls && window.__veliaLoading?.state === 'gone', null, { timeout: 480000 });
    await t.test('the dock has it: ` and its name', async () => {
      const it = await page.evaluate(() => window.__lakeshore.dock.items.find((i) => i.id === 'cruise'));
      assert.deepEqual(it && { key: it.key, name: it.name, stub: !!it.stub }, { key: '`', name: 'let her sail herself', stub: false });
      assert.equal(await page.evaluate(() => document.querySelector('.lk-dock [data-id=cruise]')?.getAttribute('aria-label') ?? null), 'let her sail herself (`)');
    });
    await t.test('` switches Sail to Cruise', async () => {
      assert.equal(await page.evaluate(() => window.__lakeshore.mode), 'sail');
      await page.mouse.move(640, 300);
      await page.keyboard.press('Backquote');
      // the shell sets L.mode mid-switch (behind the veil) and logs the switch only when the veil has gone (shell.js
      // switchOnce): wait for the log entry, not the mode
      await page.waitForFunction(() => window.__lakeshore.modeSwitchLog?.some((s) => s.to === 'cruise'), null, { timeout: 120000 });
      const sw = await page.evaluate(() => ({ mode: window.__lakeshore.mode, log: window.__lakeshore.modeSwitchLog.filter((s) => s.to === 'cruise').map(({ from, to, error }) => ({ from, to, error })) }));
      assert.deepEqual(sw, { mode: 'cruise', log: [{ from: 'sail', to: 'cruise', error: null }] });
    });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
