// The launch gate on the real v2 page:
//   no WebGPU (navigator.gpu missing): the gate page with the classic link (/classic/), the loading card gone, the engine
//     (main.js) never fetched, no terrain, model or audio request, no page error
//   no adapter (requestAdapter → null): the same page, its small print says why
//   the sea-sickness watermark: on the loading screen of every load (desktop and phone upright), small, low contrast, no box, clear
//     of the bar and the brand; gone with the loading screen; no plate on the card; never on a capture
//   Reduce Motion (the OS's): the views hold the calm values; no Calm row on Setup; an old stored value is ignored
//   About: the line with the link to the classic Velia; no classic row on the home card or the in-play Menu card (owner 2026-11-15)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/launchGate.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const RETURNING = () => { try { if (!localStorage.getItem('lakeshore.settings.v1')) localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true })); } catch {} };
const toHome = (page) => page.waitForFunction(() => window.__veliaLoading?.state === 'home' && !!window.__velia?.m4?.front, null, { timeout: 240000 });

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // 1. no WebGPU at all
  for (const [name, init] of [
    ['no navigator.gpu', () => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })],
    ['a null adapter', () => { if (globalThis.GPU) GPU.prototype.requestAdapter = async () => null; }],
  ]) {
    for (const vp of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport: vp });
      const errors = [], reqs = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('request', (r) => reqs.push(new URL(r.url()).pathname));
      await page.addInitScript(PERSON); await page.addInitScript(init);
      await page.goto(`${BASE}/?hour=15&seed=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => !document.getElementById('nogpu')?.hidden, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const g = document.getElementById('nogpu'), a = g.querySelector('[data-classic]'), b = g.querySelector('.gate')?.getBoundingClientRect();
        return { kind: g.dataset.kind, head: g.querySelector('[data-head]')?.textContent, link: a?.getAttribute('href'), text: a?.textContent, why: g.querySelector('[data-why]')?.textContent,
          works: [...g.querySelectorAll('.gate-works li')].map((li) => li.textContent), load: !!document.getElementById('lk-load'), bg: getComputedStyle(g).backgroundColor,
          fits: b && b.left >= 0 && b.right <= innerWidth + 0.5, font: getComputedStyle(g.querySelector('.gate-word')).fontFamily, gate: window.__veliaGate?.kind, title: document.title };
      });
      const tag = `${name}, ${vp.width} px`;
      check(r.kind === 'nogpu' && r.link === '/classic/' && /classic version/i.test(r.text ?? '') && !r.load, `${tag}: the gate page with the classic link, the loading card gone (${r.head} → ${r.link})`);
      check(r.works.length >= 4 && r.works.some((w) => /Safari 26/.test(w)) && r.works.some((w) => /Chrome/.test(w)), `${tag}: the browsers that work (${r.works.join(' | ')})`);
      check(r.fits && /Jost/.test(r.font) && r.bg !== 'rgb(0, 0, 0)', `${tag}: inside the screen, the front door's type, never black (${r.font.split(',')[0]})`);
      check(name !== 'a null adapter' || (/null/.test(r.why) && r.gate === 'no-adapter'), `${tag}: the small print says why (${r.why}; ${r.gate})`);
      const engine = reqs.filter((u) => /\/main\.js|\/assets\/main-/.test(u)), heavy = reqs.filter((u) => /^\/(terrain|models|audio|photo|data)\//.test(u));
      check(engine.length === 0 && heavy.length === 0, `${tag}: no engine and no asset fetched (${engine.concat(heavy).slice(0, 3).join(', ') || 'none'}; ${reqs.length} requests)`);
      check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(' | ')})`);
      if (vp.width === 1280 && name === 'no navigator.gpu') {   // the visitor chooses the classic page: a plain link, no redirect on its own
        await page.waitForTimeout(1500);
        check(new URL(page.url()).pathname === '/', `${tag}: no automatic redirect (${page.url()})`);
      }
      await page.close();
    }
  }

  // 2. the sea-sickness watermark (owner 2026-11-14): on the loading screen of every load, quiet, no box, clear of the bar and the
  //    brand, at desktop and phone upright; gone when the card goes live; no plate on the card. The terrain is held 5 s so the
  //    loading screen stays up long enough to read it
  for (const [vn, vp, mobile] of [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    for (const visit of ['first load', 'second load']) {
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
      await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
      await page.route(/\/terrain\/.*\.lsh/, async (r) => { await new Promise((ok) => setTimeout(ok, 5000)); await r.continue(); });
      await page.goto(`${BASE}/?hour=15&seed=1&attract=0`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const w = await page.evaluate(() => {
        const e = document.getElementById('lk-sea'), cs = getComputedStyle(e), r = e.getBoundingClientRect(), R = (s) => document.querySelector(s)?.getBoundingClientRect();
        const bar = R('#lk-load .lk-prog'), brand = R('#lk-load .lk-brand'), over = (a, b) => !!a && !!b && a.width > 0 && b.width > 0 && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const ink = cs.color.match(/[\d.]+/g).map(Number);
        return { state: document.getElementById('lk-load').dataset.state, text: e.textContent, shown: cs.visibility !== 'hidden' && +cs.opacity > 0.9, size: parseFloat(cs.fontSize),
          alpha: ink[3] ?? 1, box: cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.borderTopStyle === 'none', inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          clearBar: !over(r, bar), clearBrand: !over(r, brand) };
      });
      const tag = `${vn}, ${visit}`;
      check(w.state === 'company' && w.shown && /real boat/.test(w.text) && !/Setup|Calm/.test(w.text), `${tag}: the watermark on the loading screen (${w.text})`);
      check(w.size <= 13.5 && w.alpha < 0.8 && w.box && w.inside && w.clearBar && w.clearBrand, `${tag}: small (${w.size} px), low contrast (alpha ${w.alpha}), no box, inside the screen, clear of the bar and the brand (${JSON.stringify(w)})`);
      await toHome(page); await page.waitForTimeout(1500);
      const h = await page.evaluate(() => ({ sea: getComputedStyle(document.getElementById('lk-sea')).visibility, plate: !!document.querySelector('#lk-load .lk-motion') }));
      check(h.sea === 'hidden' && !h.plate, `${tag}: gone when the card goes live; no plate on the card (${JSON.stringify(h)})`);
      if (visit === 'second load') {
        // a phone starts a mode once every pipeline is built (v2/ui/front.js canEnter: buildGate.ready; a tap before is remembered):
        // the terrain held 5 s above keeps the gate shut a few seconds past the card, so wait for the remembered tap to enter
        await pickMode(page, 'sail');
        const went = await page.waitForFunction(() => window.__veliaLoading.state !== 'home', null, { timeout: mobile ? 30000 : 1000 }).then(() => true, () => false);
        check(went, `${tag}: ENTER sails (nothing to dismiss${mobile ? '; the tap remembered until the build is ready' : ''})`);
      }
      check(errors.length === 0, `${tag}: no page errors (${errors.slice(0, 2).join(' | ')})`);
      await page.close();
    }
    await ctx.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${BASE}/?hour=15&seed=1&headless=1`, { waitUntil: 'domcontentloaded' });
    check(await page.evaluate(() => getComputedStyle(document.getElementById('lk-sea')).visibility === 'hidden'), 'a capture (?headless): no watermark');
    await page.close();
  }

  // 4. Reduce Motion (the OS's): the full calm values in the views, no Calm row on Setup, nothing stored; no reduce: the auto-steady's calm end
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    await page.goto(`${BASE}/?hour=15&seed=1&attract=0`, { waitUntil: 'load' });
    await toHome(page); await page.waitForTimeout(1500);
    const a = await page.evaluate(() => ({ steady: window.__velia.m4.views.helmCam.steady, tau: window.__velia.m4.views.helmCam.cfg.tau, stored: localStorage.getItem('velia.calmcam.v1') }));
    check(a.steady === 0.85 && a.tau === 0.5 && a.stored === null, `reduce motion: the calm values, nothing stored (${JSON.stringify(a)})`);
    await page.click('#lk-load .lk-link[data-go="settings"]'); await page.waitForTimeout(400);
    await page.click('#lk-load #tab-set-sail'); await page.waitForTimeout(300);
    const row = await page.evaluate(() => ({ rows: document.querySelectorAll('#lk-load [data-set=calmCamera], #lk-load [data-calm]').length, text: /calm camera/i.test(document.getElementById('lk-load').textContent) }));
    check(row.rows === 0 && !row.text, `Setup has no calm camera row (${JSON.stringify(row)})`);
    await page.close();
    const p2 = await ctx.newPage(); await p2.addInitScript(PERSON);
    await p2.emulateMedia({ reducedMotion: 'no-preference' });
    await p2.addInitScript(() => { try { localStorage.setItem('velia.calmcam.v1', 'on'); } catch { /* none */ } });   // an old stored choice is ignored
    await p2.goto(`${BASE}/?hour=15&seed=1&attract=0&calm=1`, { waitUntil: 'load' }); await toHome(p2); await p2.waitForTimeout(1000);
    const c = await p2.evaluate(() => ({ steady: window.__velia.m4.views.helmCam.steady, tau: window.__velia.m4.views.helmCam.cfg.tau }));
    check(c.steady >= 0.4 && c.steady < 0.85 && c.tau < 0.5, `no reduce motion: the auto-steady's own range, not the calm values; an old stored value and ?calm=1 ignored (${JSON.stringify(c)})`);
    // About has no classic link and no loading report link (owner 2026-11-19)
    await p2.click('#lk-load .lk-foot .lk-news[data-go="about"]'); await p2.waitForTimeout(400);
    const ab = await p2.evaluate(() => ({ classic: document.querySelectorAll('#lk-load .pg[data-page=about] a[data-classic], #lk-load .pg[data-page=about] .lk-classic').length, report: document.querySelectorAll('#lk-load .pg[data-page=about] [data-lr-link]').length, ver: !!document.querySelector('#lk-load .pg[data-page=about] .stamp-b') }));
    check(ab.classic === 0 && ab.report === 0 && ab.ver, `About: no classic link, no loading report link, the version line stays (${JSON.stringify(ab)})`);
    await ctx.close();
  }

  // 4b. ?webgpu=0: the page on a WebGPU browser (the live check after a deploy)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(PERSON);
    await page.goto(`${BASE}/?webgpu=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('nogpu')?.hidden, null, { timeout: 60000 });
    const r = await page.evaluate(() => ({ kind: document.getElementById('nogpu').dataset.kind, link: document.querySelector('#nogpu [data-classic]').getAttribute('href') }));
    check(r.kind === 'nogpu' && r.link === '/classic/', `?webgpu=0: the WebGPU page on a WebGPU browser (${JSON.stringify(r)})`);
    await page.close();
  }

  // 4c. no classic row on the cards (owner 2026-11-15: drop the classic row unless needed; supersedes 2026-11-14): neither the
  //     home card nor the in-play Menu card shows "Play the classic version"; About has none since 2026-11-19 (4)
  for (const [vn, vp, mobile] of [['desktop', { width: 1280, height: 720 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    await page.goto(`${BASE}/?hour=15&seed=1&attract=0`, { waitUntil: 'load' });
    await toHome(page); await page.waitForTimeout(1000);
    const rows = () => page.evaluate(() => ({ state: document.getElementById('lk-load').dataset.state,
      n: [...document.querySelectorAll('#lk-load .lk-card a, #lk-load .lk-card button')].filter((el) => !el.closest('.lk-pg') && el.getClientRects().length > 0 && /classic/i.test(el.textContent)).length,
      a: document.querySelectorAll('#lk-load a.lk-classic').length }));
    const h = await rows();
    check(h.state === 'home' && h.n === 0 && h.a === 0, `${vn}: no classic row on the home card (${JSON.stringify(h)})`);
    await pickMode(page, 'sail'); await page.waitForTimeout(2000);
    await page.evaluate(() => window.__velia.m4.ui?.services.get('menu')?.open?.()); await page.waitForTimeout(1200);
    const m = await rows();
    check(m.state === 'menu' && m.n === 0 && m.a === 0, `${vn}: none on the in-play Menu card (${JSON.stringify(m)})`);
    await ctx.close();
  }

  // 5. the play counts (v1's src/metrics.js on v2, ?metrics=1 on this local host): session_start with v1's labels, set_sail on
  //    ENTER; the gate's load_fail. The endpoint is stubbed here (the Pages Function answers 204 on the site)
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const sent = [];
    await ctx.route('**/api/e', async (r) => { try { sent.push(...JSON.parse(r.request().postData() ?? '{}').e); } catch {} await r.fulfill({ status: 204 }); });
    const page = await ctx.newPage();
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    await page.goto(`${BASE}/?hour=15&seed=1&attract=0&metrics=1`, { waitUntil: 'load' });
    await toHome(page); await page.waitForTimeout(500);
    await pickMode(page, 'sail'); await page.waitForTimeout(800);
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));   // flushes the queue (v1's session_end path)
    await page.waitForTimeout(800);
    const ss = sent.find((e) => e.n === 'session_start'), go = sent.find((e) => e.n === 'set_sail');
    check(ss && ss.p.backend === 'webgpu' && ss.p.mode === 'sail' && ['high', 'balanced', 'low'].includes(ss.p.tier) && ss.p.device === 'desktop' && ss.p.first_visit === false,
      `session_start with v1's labels (${JSON.stringify(ss?.p)})`);
    check(!!go && go.p.mode === 'sail', `set_sail on ENTER (${JSON.stringify(go?.p)}); sent: ${[...new Set(sent.map((e) => e.n))].join(', ')}`);
    await page.close();
    const g = await ctx.newPage(); await g.addInitScript(PERSON);
    await g.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }));
    sent.length = 0;
    await g.goto(`${BASE}/?hour=15&seed=1&metrics=1`, { waitUntil: 'load' });
    await g.waitForFunction(() => !document.getElementById('nogpu').hidden, null, { timeout: 60000 }); await g.waitForTimeout(6000);   // the 5 s batch
    const lf = sent.find((e) => e.n === 'load_fail');
    check(lf && lf.p.stage === 'gpu:no-api' && lf.p.why === 'error' && lf.p.device === 'desktop', `the gate counts as v1's load_fail (${JSON.stringify(lf?.p)})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
