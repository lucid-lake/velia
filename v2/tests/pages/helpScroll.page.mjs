// Help › What's new and Credits as one scrolling page each (owner 2026-11-15: no numbered pages; src/ui/homePages.js,
// src/ui/helpScroll.js), on the real v2 page at 1280 × 720 (mouse, wheel, keys) and 844 × 390 (a sideways phone: touch):
//   no page-number pills; What's new has a date per release, the newest open, the older folded; a tap opens and folds one
//   only the right panel scrolls: the Help nav, the title and Esc keep their place; a wheel, PageDown/End or a touch swipe moves it
//   a fade at the bottom edge while more is below (data-more), none at the end
// Run by `npm run test:pages:v2 -- helpScroll`, or node v2/tests/pages/helpScroll.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  for (const [vn, opt] of [['1280x720', { viewport: { width: 1280, height: 720 } }], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const touch = !!opt.hasTouch;
    const ctx = await browser.newContext(opt);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&cinema=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front?.home, null, { timeout: 240000 });
    await page.waitForTimeout(600);
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const look = () => page.evaluate(() => {
      const root = document.getElementById('lk-load'), pg = root.querySelector('.pg.on'), body = pg?.querySelector(':scope > .pg-b');
      const r = (el) => { const b = el?.getBoundingClientRect(); return b ? [Math.round(b.left), Math.round(b.top)] : null; };
      return { pg: root.dataset.pg, tabs: pg?.querySelectorAll('[role=tab]').length ?? -1, scr: !!pg?.classList.contains('scr'),
        top: body?.scrollTop ?? -1, max: body ? body.scrollHeight - body.clientHeight : -1, more: !!body?.hasAttribute('data-more'),
        nav: r(root.querySelector('.hnav .hn[aria-current=page]')), title: r(pg?.querySelector('h2')), esc: r(pg?.querySelector('.pg-esc')),
        open: [...(pg?.querySelectorAll('details.rel') ?? [])].map((d) => d.open), heads: [...(pg?.querySelectorAll('.cgrp > .ch3') ?? [])].map((h) => h.textContent) };
    });
    const mid = () => page.evaluate(() => { const b = document.querySelector('#lk-load .pg.on > .pg-b').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
    // one scroll gesture over the panel: a wheel on a desk, a finger swipe (with its fling) on a phone
    const swipe = async (dy) => {
      const p = await mid();
      if (touch) await cdp.send('Input.synthesizeScrollGesture', { x: p.x, y: p.y, yDistance: -dy, gestureSourceType: 'touch', speed: 1200 });
      else { await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, dy); }
      await page.waitForTimeout(700);
    };
    const press = (sel) => (touch ? page.tap(sel) : page.click(sel));

    // ---- What's new, from the card foot's About, then the Help nav (owner 2026-11-17: the foot link is About) ----
    // a phone's card (feature phoneCard, 2026-11-18) keeps its links and foot in the ⋯ menu: open it first
    if (await page.evaluate(() => document.documentElement.dataset.fPhoneCard === 'on')) { await press('#lk-load .lk-pmore'); await page.waitForTimeout(400); }
    await press('#lk-load .lk-foot .lk-news');
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.getElementById('lk-load').dataset.pg === 'about'), `${vn}: the foot's link opens About`);
    await press('#lk-load .hnav .hn[data-nav=news]');
    await page.waitForTimeout(700);
    let a = await look();
    check(a.pg === 'news' && a.scr && a.tabs === 0, `${vn}: What's new opens as one page, no page-number pills (${a.pg}, tabs ${a.tabs})`);
    check(a.open.length >= 2 && a.open[0] && a.open.slice(1).every((o) => !o), `${vn}: the newest release open, the ${a.open.length - 1} older folded`);
    check(a.max > 0 === a.more, `${vn}: the bottom fade shows exactly when more is below (max ${a.max}, fade ${a.more})`);
    // a tap on an older date opens it; again folds it
    await press('#lk-load .pg.on details.rel:nth-of-type(2) > summary');
    await page.waitForTimeout(300);
    const b1 = await look();
    await press('#lk-load .pg.on details.rel:nth-of-type(2) > summary');
    await page.waitForTimeout(300);
    const b2 = await look();
    check(b1.open[1] === true && b1.max > a.max && b1.more, `${vn}: a tap on an older date opens it (the page grows ${a.max} → ${b1.max} px, the fade on)`);
    check(b2.open[1] === false, `${vn}: a second tap folds it`);
    // open them all, then scroll: only the panel moves
    await page.evaluate(() => { for (const d of document.querySelectorAll('#lk-load .pg.on details.rel')) d.open = true; });
    await page.waitForTimeout(300);
    a = await look();
    await swipe(300);
    let s = await look();
    check(s.top > 40 && JSON.stringify([s.nav, s.title, s.esc]) === JSON.stringify([a.nav, a.title, a.esc]), `${vn}: a ${touch ? 'swipe' : 'wheel'} scrolls the panel (${s.top} px); the nav, the title and Esc stay put`);
    const settle = async () => { let last = -1; for (let i = 0; i < 40; i++) { await page.waitForTimeout(150); const t = (await look()).top; if (t === last) break; last = t; } };   // a long page's smooth scroll takes longer than a fixed wait (the full What's new is 3490 px)
    if (!touch) {
      await page.focus('#lk-load .pg.on details.rel > summary');
      const t0 = (await look()).top;
      await page.keyboard.press('PageDown'); await page.waitForTimeout(600);
      const t1 = (await look()).top;
      await page.keyboard.press('End'); await settle();
      s = await look();
      check(t1 > t0 && s.top >= s.max - 2, `${vn}: PageDown leafs (${t0} → ${t1} px) and End reaches the end (${s.top} of ${s.max})`);
      await page.keyboard.press('Home'); await settle();
      check((await look()).top === 0, `${vn}: Home goes back to the top`);
      await page.evaluate(() => document.querySelector('#lk-load .pg.on > .pg-b').scrollTo({ top: 1e5, behavior: 'instant' }));
    } else {
      for (let i = 0; i < 12 && !((s = await look()).top >= s.max - 2); i++) await swipe(600);
    }
    await page.waitForTimeout(300);
    s = await look();
    check(s.top >= s.max - 2 && !s.more, `${vn}: at the end the fade is gone (${s.top} of ${s.max})`);

    // ---- Credits, from the nav ----
    await press('#lk-load .hnav .hn[data-nav=credits]');
    await page.waitForTimeout(600);
    a = await look();
    check(a.pg === 'credits' && a.scr && a.tabs === 0 && a.heads.length >= 5, `${vn}: Credits is one page grouped by topic, no pills (${a.heads.join(' · ')})`);
    check(a.top === 0 && a.max > 0 && a.more, `${vn}: Credits opens at the top with the fade on (${a.max} px below)`);
    await swipe(400);
    s = await look();
    check(s.top > 40 && JSON.stringify([s.nav, s.title]) === JSON.stringify([a.nav, a.title]), `${vn}: Credits scrolls (${s.top} px) under the fixed nav and title`);
    check(errors.length === 0, `${vn}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `\n${fails} FAIL` : '\nall PASS');
process.exit(fails ? 1 : 0);
