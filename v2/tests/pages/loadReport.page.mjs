// The load report on the real page (owner, 2026-11-16: "Build a way to find where the blocker is, so I can send it to you"):
//   ?loadreport=1 shows the card once the home card is live, on a desktop (1280 × 720) and a phone on its side (844 × 390,
//     touch): the stages in order, the first frame, a likely blocker, the text within 3,000 characters with no host or query;
//     Copy puts that text on the clipboard
//   without the flag: no card and no recorder; a long press on About's version opens this load's report (no link on About since 2026-11-19); Setup › Screen has no row
//     (its page must not scroll at 1280 × 720: home.page.mjs)
// Stills and the copied text go to renders/load-report/ (desktop.png, phone.png, sample-text.txt, sample.json).
// Run by `npm run test:pages:v2 -- loadReport` (LAKESHORE_BASE set), or node v2/tests/pages/loadReport.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const OUT = 'renders/load-report';
mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const RETURNING = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true })); } catch {} };
const URL_Q = '?hour=15&seed=1&attract=0';

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  for (const [name, opts] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]]) {
    const ctx = await browser.newContext(opts);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    await page.goto(`${BASE}/${URL_Q}&loadreport=1`, { waitUntil: 'load' });
    await page.waitForSelector('#lk-lr .lr-card', { timeout: 240000 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => { const { report, text } = window.__veliaLoadReport; const card = document.querySelector('#lk-lr .lr-card').getBoundingClientRect();
      return { report, text, card: [card.width, card.height], state: window.__veliaLoading?.state, rows: document.querySelectorAll('#lk-lr .lr-wf .b').length, docW: document.documentElement.scrollWidth, vw: innerWidth }; });
    const names = r.report.stages.map((s) => s.name);
    const crit = r.report.stages.filter((s) => s.crit).map((s) => s.name);
    check(['html', 'index', 'gate', 'main', 'device', 'world', 'pipelines', 'sky', 'terrain.wait', 'boat', 'card'].every((n) => crit.includes(n)), `${name}: every stage on the path is marked (${crit})`);
    check(crit.every((n, i) => i === 0 || r.report.stages.find((s) => s.name === n).start >= r.report.stages.find((s) => s.name === crit[i - 1]).start), `${name}: the path's stages in time order`);
    check(r.report.stages.every((s) => s.dur >= 0 && !s.open), `${name}: every stage closed, no negative time`);
    check(r.report.totals.done && r.report.totals.firstFrame > 0 && r.report.totals.card >= r.report.totals.firstFrame, `${name}: first frame ${r.report.totals.firstFrame} ms, card live ${r.report.totals.card} ms`);
    check(['home', 'menu'].includes(r.state), `${name}: the card shows after the home card went live (${r.state})`);
    check(r.report.blocker.text.length > 10 && /\d s/.test(r.report.blocker.text), `${name}: a likely blocker: ${r.report.blocker.text}`);
    check(r.report.main.source === 'longtask' && r.report.resources.length > 20, `${name}: long tasks recorded (${r.report.main.count}), ${r.report.resources.length} files`);
    check(r.report.device.gpu != null && r.report.device.quality != null, `${name}: the GPU and the quality level (${JSON.stringify(r.report.device.quality)})`);
    check(r.text.length <= 3000 && !/https?:\/\//.test(r.text) && !/127\.0\.0\.1/.test(JSON.stringify(r.report)), `${name}: the text ${r.text.length} chars, no host`);
    check(r.rows === r.report.stages.length && r.docW <= r.vw, `${name}: a bar per stage (${r.rows}), no sideways scroll (${r.docW} / ${r.vw})`);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await page.click('#lk-lr [data-lr=copy]');
    await page.waitForTimeout(300);
    const said = await page.textContent('#lk-lr [data-lr=said]');
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
    check(said === 'Copied' && clip === r.text, `${name}: Copy put the report's text on the clipboard (${said}; ${clip.length} chars)`);
    if (name === 'phone') { writeFileSync(`${OUT}/sample-text.txt`, clip); writeFileSync(`${OUT}/sample.json`, JSON.stringify(r.report, null, 1)); }
    // the card's taps stay on the card; Close takes it away
    await page.click('#lk-lr [data-lr=close]');
    check(await page.evaluate(() => !document.getElementById('lk-lr')), `${name}: Close takes the card away`);
    check(errors.length === 0, `${name}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // without the flag: no card, no recorder; About's link opens this load's report (the marks, no long tasks)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    await page.goto(`${BASE}/${URL_Q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    check(await page.evaluate(() => !document.getElementById('lk-lr') && !window.__veliaLoadReport), 'no flag: no card');
    const link = await page.evaluate(() => ({ about: !!document.querySelector('#lk-load .pg[data-page=about] [data-lr-link]'), row: !!document.querySelector('#tp-set-screen [data-set=loadReport]') }));
    check(!link.about && !link.row, `About has no Loading report link (owner 2026-11-19), Setup › Screen no row (${JSON.stringify(link)})`);
    await page.click('#lk-load .lk-foot .lk-news[data-go=about]'); await page.waitForTimeout(300);
    { const bx = await page.locator('#lk-load .pg[data-page=about] .stamp-b').boundingBox(); await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up(); }   // the long press on About's version still opens it
    await page.waitForSelector('#lk-lr .lr-card', { timeout: 20000 });
    const r = await page.evaluate(() => window.__veliaLoadReport.report);
    check(r.main.source === 'none' && r.totals.done && r.stages.some((s) => s.name === 'pipelines'), `the row's report: this load's stages, no recorder (${r.blocker.text})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} check(s) failed` : 'all load report checks pass');
process.exit(fails ? 1 : 0);
