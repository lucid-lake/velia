// A tap on Sail or Cruise on the first card enters at once: the card never comes back on the way in (owner, 2026-11-16: "the
// menu card flashes again, then it enters"). The cause: home → out swapped the card's lk-cardin animation for the base
// lk-sheet, which restarted at opacity 0 and rose back to full over the lake (v2/index.html: the out state fades a card that was
// on screen from full, lk-cardout, and keeps a card that was away hidden; v2/ui/menuCard.js data-out-from).
// Each case records the card's visibility on every frame from the tap until the mode is live (the loading shell gone and the
// page's mode the one tapped): the root's opacity × the card's, 0 once the shell is display:none. It fails if any frame is
// more visible than an earlier one after the tap (a rise over 0.02). Cases: desktop 1280 × 720 and a phone 844 × 390
// (touch, Safari's UA), Sail and Cruise after the card is live, and a tap while the world still loads (queued, then entered).
// Regatta goes to its hub (intended); it checks the card stays down there too.
// A phone that is still building its shaders when the card goes live (src/core/features.js buildAllFirst) holds the card, the tapped
// mode lit, until the build is done: those frames may rise; after them the card only fades.
// Run by `npm run test:pages:v2 -- homeEntry` (LAKESHORE_BASE set), or node v2/tests/pages/homeEntry.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
// every frame while __recOn: the card's visibility and the page's state
const RECORDER = () => {
  window.__rec = []; window.__recOn = false;
  const tick = () => {
    if (window.__recOn) {
      const r = document.getElementById('lk-load'), c = r?.querySelector('.lk-card');
      const rs = r && getComputedStyle(r), cs = c && getComputedStyle(c);
      const v = !r || !c || rs.display === 'none' || rs.visibility === 'hidden' || cs.display === 'none' || cs.visibility === 'hidden' ? 0 : +rs.opacity * +cs.opacity;
      window.__rec.push({ t: Math.round(performance.now()), v: +v.toFixed(4), st: r?.dataset.state ?? null, build: r?.dataset.build ?? null, queued: r?.dataset.queued ?? null, mode: window.__velia?.mode?.now?.() ?? null, hub: document.documentElement.classList.contains('v2-rg-hub') });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DESK = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function run(name, ctxOpts, mode, { early = false } = {}) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED); await page.addInitScript(RECORDER);
  await page.goto(`${BASE}/?hour=15&seed=1&attract=0`, { waitUntil: 'load' });
  const sel = `#lk-load .lk-pick[data-mode=${mode}]`;
  if (early) {
    // the card is still loading: the tap queues the mode (home.js createEnter), the hand-off enters it
    await page.waitForFunction(() => window.__velia?.m4?.front && window.__veliaLoading?.state === 'company', null, { timeout: 240000 });
  } else {
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    await page.waitForTimeout(800);   // the card's own 400 ms slide-in is over
  }
  await page.evaluate(() => { window.__recOn = true; });
  // the card's click path (a hidden card during loading takes no pointer); the desktop panel selects the mode and its Set sail
  // starts it (owner, 2026-11-18), the phone card's tap enters it
  await page.evaluate((s) => { document.querySelector(s).click(); const g = document.querySelector('#lk-load .lk-go'); if (document.documentElement.dataset.mapCard === 'panel' && g?.getClientRects().length) g.click(); }, sel);
  const live = mode === 'regatta'
    ? () => document.documentElement.classList.contains('v2-rg-hub') && getComputedStyle(document.getElementById('lk-load')).display === 'none'
    : (m) => window.__veliaLoading?.state === 'gone' && window.__velia?.mode?.now?.() === m;
  const ok = await page.waitForFunction(live, mode, { timeout: 240000 }).then(() => true, () => false);
  await page.waitForTimeout(300);
  const rec = await page.evaluate(() => window.__rec);
  let lo = Infinity, rise = 0, at = null;
  // a phone builds every shader before its modes (owner 2026-11-17, engine/buildGate.js): a tap while loading is remembered and the
  // card may come in and hold, the tapped mode lit, while the build runs (home, data-build=wait); that is the rule, not a flash. Once
  // it lets go (the gate open, the card on its way out) it never rises again, from wherever the last held frame left it
  const holding = (f) => f.st === 'home' && f.build === 'wait';
  const held = rec.filter(holding);
  for (const f of rec) { if (holding(f)) { lo = f.v; continue; } if (f.v < lo) lo = f.v; if (f.v - lo > rise) { rise = f.v - lo; at = f; } }
  if (held.length) check(held.every((f) => f.queued === mode), `${name}: while the card holds for the build, the tapped ${mode} stays lit (${held.length} frames)`);
  const states = [...new Set(rec.map((f) => f.st))].join('>');
  const first = rec[0]?.v ?? null;
  check(ok, `${name}: ${mode} goes live (${states}, last mode ${rec.at(-1)?.mode}, ${rec.length} frames)`);
  check(rec.length > 10 && rise <= 0.02, `${name}: the card never comes back after the tap (first frame ${first}, worst rise ${rise.toFixed(3)}${at ? ` at ${JSON.stringify(at)}` : ''})`);
  check(errors.length === 0, `${name}: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}
try {
  await run('desktop 1280x720', DESK, 'sail');
  await run('desktop 1280x720', DESK, 'cruise');
  await run('phone 844x390', PHONE, 'sail');
  await run('phone 844x390', PHONE, 'cruise');
  await run('desktop, tapped while loading', DESK, 'sail', { early: true });
  await run('phone, tapped while loading', PHONE, 'cruise', { early: true });
  await run('desktop 1280x720', DESK, 'regatta');
} finally {
  await browser.close();
}
console.log(fails ? `${fails} check(s) failed` : 'all pass');
process.exit(fails ? 1 : 0);
