// The fireworks show off the boot path (perf/v2-phone-load, owner OK 2026-11-15; v2/sim/lazyShow.js). On the highlight
// day (?fireworks=1, v1's rule) on a desktop page (since 2026-11-17 a phone never loads the show: src/core/features.js
// `fireworks`, owner "No fireworks, Milky Way, rainbow [on phones]"; the lazy script still keeps ≈ 2 s off a tablet's boot):
//   phone:  the plug-in is off at 21:48 (its chunk never fetched), and the page is ready without it
//   midday: the page is ready, and seconds later, with the show's script never made
//   20:10, the evening near: the script is made in an idle slice after ready, before the show's window
//   21:48, in the show: the script is made before the first frame, and the show plays (shells spawned, stars alive)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/showLazy.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PHONE } from './barMotion.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const DESKTOP = { viewport: { width: 1280, height: 720 } };
async function open(hour, device = DESKTOP) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const chunks = []; page.on('request', (r) => { if (/fireworksPlugin/.test(r.url())) chunks.push(r.url()); });
  // the show's state at the loading card's ready (the first frame), read inside the page as it happens
  await page.addInitScript(() => { let cur = null; window.__atReady = null; Object.defineProperty(window, '__veliaLoading', { configurable: true, get: () => cur, set: (v) => { cur = v; const r = v?.ready; if (v) v.ready = function () { const f = window.__velia?.fireworks; window.__atReady ??= { built: f?.showBuilt ?? null, on: !!f }; return r?.call(this); }; } }); });
  await page.goto(`${BASE}/?mode=sail&hour=${hour}&seed=1&attract=0&fireworks=1&music=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready === true && window.__atReady != null, null, { timeout: 180000, polling: 200 });
  const fw = () => page.evaluate(() => { const f = window.__velia.fireworks; const s = f?.stats(); return { built: f?.showBuilt ?? null, showT: s?.showT ?? null, spawned: s?.spawned ?? 0, peak: s?.peak ?? 0 }; });
  return { ctx, page, errors, chunks, fw, atReady: await page.evaluate(() => window.__atReady) };
}
try {
  {
    const { ctx, errors, chunks, atReady } = await open(21.8, PHONE);
    check(!atReady.on && chunks.length === 0, `phone, 21:48: the plug-in is off and its chunk never fetched (${JSON.stringify({ atReady, chunks: chunks.length })})`);
    check(errors.length === 0, `phone: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, errors, fw, atReady } = await open(13);
    check(atReady.on && atReady.built === false, `midday: the plug-in is on and ready came before the show's script (${JSON.stringify(atReady)})`);
    await page.waitForTimeout(4000);
    const s = await fw();
    check(s.built === false && s.showT == null, `midday: 4 s after ready the script is still not made, no show clock (${JSON.stringify(s)})`);
    check(errors.length === 0, `midday: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, errors, fw, atReady } = await open(20.17);
    const made = await page.waitForFunction(() => window.__velia.fireworks?.showBuilt === true, null, { timeout: 30000, polling: 200 }).then(() => true, () => false);
    const s = await fw();
    check(atReady.built === false && made, `20:10: not made by ready, made in an idle slice after it (${JSON.stringify({ atReady, ...s })})`);
    check(errors.length === 0, `20:10: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, errors, fw, atReady } = await open(21.8);
    check(atReady.built === true, `21:48: the script is made by the first frame (${JSON.stringify(atReady)})`);
    await page.waitForTimeout(3000);
    const s = await fw();
    check(s.showT != null && s.spawned > 0 && s.peak > 0, `21:48: the show plays (${JSON.stringify(s)})`);
    check(errors.length === 0, `21:48: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
