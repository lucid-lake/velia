// Pages and menus stay navy and cream at night (owner, 2026-11-19, on the Help sheet's Setup at night: "I'm not a big fan of this
// colour; the default navy and white is enough"): at 22:30 (data-lk-theme=night) the DOM's tokens are the day's, and
// Help › Setup, the Logbook and the Conditions sheet read navy (28 35 64) with cream ink (239 230 210), never the instruments' night
// red; the cockpit's own dials stay red (the 3D rig reads data-lk-theme). Desktop 1280 x 720 and a sideways phone 844 x 390.
// LK_STILLS=<dir> also writes a PNG of each sheet there.
// Run by `npm run test:pages:v2 -- nightPages`, or node v2/tests/pages/nightPages.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const STILLS = process.env.LK_STILLS || null;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const NAVY = [28, 35, 64], CREAM = [239, 230, 210];
const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const near = (a, b, d = 2) => a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= d);
// navy: the blue channel leads and red never does; cream: light, with red at or above blue (never red-dominant: g and b collapse)
const isNavy = (c) => c.length === 3 && c[2] > c[0] + 12 && c[0] < 80;
const isCream = (c) => c.length === 3 && c[0] > 190 && c[1] > 180 && c[2] > 150;

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  for (const [vn, opt] of [['1280x720', { viewport: { width: 1280, height: 720 } }], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(opt);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
    await page.goto(`${BASE}/?mode=sail&hour=22.5&seed=1&attract=0&cinema=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front?.home, null, { timeout: 240000 });
    await page.waitForTimeout(600);
    const shot = async (name) => { if (STILLS) await page.screenshot({ path: `${STILLS}/${name}-${vn}.png` }); };
    const read = (bgSel, inkSel) => page.evaluate(([b, i]) => {
      // bg: the first painted ancestor (the desktop panel paints the sheet, not .lk-pg)
      const bg = document.querySelector(b), ink = document.querySelector(i);
      return { theme: document.documentElement.dataset.lkTheme, tok: getComputedStyle(document.documentElement).getPropertyValue('--lk-brand-navy').trim(),
        cream: getComputedStyle(document.documentElement).getPropertyValue('--lk-cream').trim(),
        bg: (() => { for (let e = bg; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; } return ''; })(),
        ink: ink ? getComputedStyle(ink).color : '' };
    }, [bgSel, inkSel]);
    const verify = (what, o) => {
      check(o.theme === 'night', `${vn}: ${what}: the theme is night (${o.theme})`);
      check(near(o.tok.split(/\s+/).map(Number), NAVY, 0) && near(o.cream.split(/\s+/).map(Number), CREAM, 0), `${vn}: ${what}: the tokens are the day's navy and cream (${o.tok} | ${o.cream})`);
      check(isNavy(rgb(o.bg)), `${vn}: ${what}: the background is navy (${o.bg})`);
      check(isCream(rgb(o.ink)), `${vn}: ${what}: the ink is cream (${o.ink})`);
    };

    // Help › Setup (a phone keeps its links in the ⋯ menu; the home card's own link is clicked directly)
    await page.evaluate(() => document.querySelector('#lk-load .lk-link[data-go=settings]').click());
    await page.waitForFunction(() => document.getElementById('lk-load').dataset.pg === 'settings' && !!document.querySelector('#lk-load .pg[data-page=settings]:not([hidden])'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector('#lk-load .pg[data-page=settings] .tab[data-tab=sail]')?.click()); await page.waitForTimeout(300);
    verify('Help › Setup', await read('#lk-load .pg.on h2', '#lk-load .pg.on h2'));
    const nav = await page.evaluate(() => { const e = document.querySelector('#lk-load .hnav .hn[aria-current=page]') ?? document.querySelector('#lk-load .hnav .hn'); return e ? getComputedStyle(e).color : ''; });
    check(!nav || isCream(rgb(nav)), `${vn}: Help › Setup: the nav is cream (${nav})`);
    const tabInk = await page.evaluate(() => getComputedStyle(document.querySelector('#lk-load .pg.on .tab[aria-selected=true]')).color);
    check(isCream(rgb(tabInk)), `${vn}: Help › Setup: the selected tab is cream (${tabInk})`);
    await shot('setup');

    // into Sail (ENTER on the card), then the Logbook (its button) and the Conditions sheet
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await pickMode(page, 'sail', { tap: !!opt.hasTouch }); await page.waitForTimeout(1500);
    await page.mouse.click(opt.viewport.width / 2, 120);
    await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('logbook'));   // the Logbook button (the key L went)
    await page.waitForFunction(() => document.querySelector('.lk-log')?.dataset.state === 'open', null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    check(await page.evaluate(() => !!window.__velia.m4.ui.services.get('logbook')?.logbook?.isOpen), `${vn}: the Logbook is open`);
    verify('the Logbook', await read('.lk-log .card', '.lk-log .title'));
    await shot('logbook');
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.mouse.move(600, 300); await page.mouse.move(620, 310); await page.waitForTimeout(300);
    const sel = '.lk-view:not(.off) .xt[data-x=cond]';
    if (await page.$(sel)) {
      await (opt.hasTouch ? page.tap(sel) : page.click(sel)); await page.waitForTimeout(500);
      verify('the Conditions sheet', await read('.lk-cond:not([hidden])', '.lk-cond:not([hidden]) h3'));
      await shot('conditions');
    } else check(false, `${vn}: the Conditions pill is on the bar`);
    check(errors.length === 0, `${vn}: no page errors (${errors.slice(0, 3).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
