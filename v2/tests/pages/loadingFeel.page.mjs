// The voyage bar always moves (fix/v2-loading-feel; owner 2026-11-15, on an iPhone: "the loading bar does not move for the
// first few seconds, it looks frozen"). A first visit on a phone-like page (390 × 844 @2 upright: the page turned on its side, touch, CPU 4× slower, 10 Mbps,
// 40 ms RTT, no cache), the bar read off the composited frames (barMotion.mjs: the browser's screencast, which keeps taking
// frames while the main thread is busy), from the first paint to ready:
//   the bar moves within 300 ms of the first paint
//   it never sits still longer than 500 ms until ready (main 92bc663: still from ≈ 0.9 s to ≈ 3.7 s, the world's build)
//   it never goes back (1 px of anti-aliasing allowed), and it reaches the line's end before it fades
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/loadingFeel.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PHONE, PERSON, RETURNING, CLEAN, throttle, startScreencast, sailedPx, LINE_RECT } from './barMotion.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const FIRST_MS = 300, STILL_MS = 500;

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(RETURNING); await page.addInitScript(CLEAN);
  // when the card leaves 'company' (the bar fades from there)
  await page.addInitScript(() => { window.__out = null; new MutationObserver(() => { const s = document.getElementById('lk-load')?.dataset.state; if (window.__out == null && s && s !== 'company') window.__out = performance.now(); }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] }); });
  const cdp = await ctx.newCDPSession(page);
  await throttle(cdp, { cpu: 4, mbps: 10, rtt: 40 });
  const cast = await startScreencast(cdp);
  await page.goto(`${BASE}/`, { waitUntil: 'commit' });
  const line = await page.waitForFunction(LINE_RECT, null, { timeout: 120000 }).then((h) => h.jsonValue());
  await page.waitForFunction(() => window.__veliaLoading?.log?.some((x) => x[0] === 'ready'), null, { timeout: 300000, polling: 500 });
  await page.waitForTimeout(1200);   // the snap to the end and the card's hand-off
  await cast.stop();
  const r = await page.evaluate(() => { const L = window.__veliaLoading; return { origin: performance.timeOrigin, fp: performance.getEntriesByType('paint').find((p) => p.name === 'first-paint')?.startTime ?? null, ready: L.t0 + L.log.find((x) => x[0] === 'ready')[2], out: window.__out, log: L.log, bar: L.bar?.log ?? null }; });
  const frames = cast.frames.map((f) => ({ t: f.wall * 1000 - r.origin, ...sailedPx(f.data, line, PHONE.viewport.width) })).filter((f) => f.line && f.t >= (r.fp ?? 0) - 1);
  console.log(`  first paint ${r.fp?.toFixed(0)} ms, ready ${r.ready.toFixed(0)} ms (from navigation); ${frames.length} frames; line ${line.len.toFixed(0)} px; stages ${r.log.map((x) => `${x[0]}@${x[2]}`).join(' ')}`);
  check(r.fp != null && frames.length > 10, `the page painted and the screencast saw the line (${frames.length} frames)`);
  const live = frames.filter((f) => f.t <= r.ready);
  const px0 = live[0]?.px ?? 0;
  const moved = live.find((f) => f.px >= px0 + 1);
  check(moved && moved.t - r.fp <= FIRST_MS, `the bar moves within ${FIRST_MS} ms of the first paint (${moved ? `${(moved.t - r.fp).toFixed(0)} ms` : 'never'})`);
  // the still spells: the time between visible changes (half a CSS px: one device pixel at @2), first paint → ready
  let lastPx = px0, lastT = r.fp, worst = 0, worstAt = 0;
  for (const f of [...live, { t: r.ready, px: Infinity }]) {
    if (Math.abs(f.px - lastPx) >= 0.5) { if (f.t - lastT > worst) { worst = f.t - lastT; worstAt = lastT; } lastPx = f.px; lastT = f.t; }
  }
  check(worst <= STILL_MS, `it never sits still more than ${STILL_MS} ms until ready (longest ${worst.toFixed(0)} ms, from ${worstAt.toFixed(0)} ms)`);
  let peak = 0, back = 0, backAt = 0;
  const shown = frames.filter((f) => f.t <= (r.out ?? r.ready + 1200));   // until the card's hand-off fades the bar
  for (const f of shown) { if (peak - f.px > back) { back = peak - f.px; backAt = f.t; } peak = Math.max(peak, f.px); }
  check(back <= 1, `it never goes back (worst step back ${back.toFixed(1)} px at ${backAt.toFixed(0)} ms)`);
  check(peak >= line.len * 0.97, `it reaches the line's end before it fades (${peak.toFixed(0)} of ${line.len.toFixed(0)} px)`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
