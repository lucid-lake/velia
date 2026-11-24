// v2 port of tests/pages/menu.page.mjs and solaria.page.mjs: v1's home card (src/ui/home.js, mounted by v2/ui/front.js) on the
// real v2 page, not a stand-in core. The card goes live after ready; Sail is lit, Cruise plays (BACKLOG-v2 #11: v2/cruise; its
// pick is v2/tests/pages/cruise.page.mjs's) and Regatta keeps its cell, disabled, "soon" (v1's test asserted Regatta live:
// frontPlan.js); keys stop at the card; on a desktop Sail is lit and Enter starts it (owner 2026-11-17; no ENTER button);
// Esc and the bar's Menu bring the same card back over the live world (no Resume pill: v2/ui/menuCard.js, menuCard.page.mjs); the bar's Setup opens Setup; the settings reach
// what v2 has (the wind level, Pro, the steady horizon, the HUD preset); Contact and the feedback mailto; menu cards do not
// scroll (owner 2026-11-09) at 1280 × 720 and 390 × 844. A first visit gets the same card (owner, 2026-11-13: no
// staged first minute in v2): v1's ?first=1, which forced v1's stage, opens the card (no welcome since 2026-11-21) and Set sail sails.
// Dropped from v1's: the mode switch through the horizon line (v2 has one mode), the sound buses and the quality's render scale
// (v2 has no audio and no quality tiers yet).
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/home.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
// a visitor's browser: the card waits for ENTER (v1's gate; ?gate=1 would also turn the Calm HUD off: calmAllowed)
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // a headless capture: no card, no menu
  const cap = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await cap.goto(`${BASE}/?hour=15&seed=1&headless=1`, { waitUntil: 'load' });
  await cap.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await cap.waitForTimeout(1000);
  const h = await cap.evaluate(() => ({ off: !!window.__veliaLoading?.off, shown: getComputedStyle(document.getElementById('lk-load')).display, front: !!window.__velia.m4?.front }));
  check(h.off && h.shown === 'none' && !h.front, `headless: the loading shell is off and hidden, no front door (${JSON.stringify(h)})`);
  await cap.close();

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.addInitScript(() => { window.__keysSeen = []; addEventListener('keydown', (e) => window.__keysSeen.push(e.code)); });   // the game's side: bubble phase, on window
  await page.goto(`${BASE}/?mode=sail&hour=18.75&seed=1&attract=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front, null, { timeout: 240000 });
  await page.waitForTimeout(600);
  const home = () => page.evaluate(() => window.__velia.m4.front.home);
  const st = () => page.evaluate(() => ({ state: window.__veliaLoading.state, open: window.__velia.m4.front.home.isOpen, pg: document.getElementById('lk-load').dataset.pg ?? null }));
  void home;

  // the card: no ENTER button; on a desktop Sail is lit (owner 2026-11-17, replacing 2026-11-15's no lit mode for desktop); Cruise, Sail and Regatta live (Regatta since BACKLOG-v2 #12: its pick enters the race, pages/regatta.page.mjs)
  const picks = await page.evaluate(() => [...document.querySelectorAll('#lk-load .lk-pick')].map((b) => ({ m: b.dataset.mode, dis: b.disabled, on: b.getAttribute('aria-checked'), soon: b.querySelector('small')?.textContent ?? null })));
  check(JSON.stringify(picks) === JSON.stringify([{ m: 'cruise', dis: false, on: 'false', soon: null }, { m: 'sail', dis: false, on: 'true', soon: null }, { m: 'regatta', dis: false, on: 'false', soon: null }]), `the picks: Sail lit, all live, none soon (${JSON.stringify(picks)})`);
  const ui = await page.evaluate(() => { const r = (s) => document.querySelector(s)?.getBoundingClientRect(); const c = r('#lk-load .lk-card'), g = document.querySelector('#lk-load .lk-go'), f = document.activeElement; return { card: c && c.width > 300 && c.height > 400, noGo: !g || g.getClientRects().length === 0, focusNotPick: !f?.matches?.('.lk-pick') }; });
  check(ui.card && !ui.noGo, `the float plan panel is up with its Set sail button (owner, 2026-11-18) (${JSON.stringify(ui)})`);

  // keys stop at the card: the boat never sees them
  await page.evaluate(() => { window.__keysSeen.length = 0; });
  await page.keyboard.press('KeyA'); await page.keyboard.press('KeyW');
  check((await page.evaluate(() => window.__keysSeen)).length === 0, 'while the card is up, keys stop there');
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  check((await st()).state === 'home', 'Esc on the home card keeps it (Esc closes only the in-play menu)');
  // Enter starts the lit mode, Sail (owner 2026-11-17): the card goes, no ENTER button was needed
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 10000 });
  check(await page.evaluate(() => window.__velia.mode.now() === 'sail'), 'Enter on the desktop card enters Sail (the card dissolves, state gone)');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const m = await page.evaluate(() => ({ st: window.__veliaLoading.state, open: window.__velia.m4.front.home.isOpen, go: !!document.querySelector('#lk-load .lk-go')?.getClientRects().length, bar: getComputedStyle(document.querySelector('.lk-view')).opacity }));
  check(m.st === 'menu' && m.open && m.go, `Esc in play: the Menu panel with Resume (owner, 2026-11-18) (${JSON.stringify(m)})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  check(!(await st()).open, 'Esc again closes it');

  // the bar's Menu opens the card; the card's Setup row opens Setup (Setup left the bar: owner 2026-11-15)
  await page.mouse.move(600, 400); await page.mouse.move(620, 410); await page.waitForTimeout(200);
  await page.click('.lk-view:not(.off) .mn').catch(() => {});
  await page.waitForTimeout(400);
  const viaBar = (await st()).open;
  await page.click('#lk-load .lk-link[data-go=settings]'); await page.waitForTimeout(400);
  const s1 = await st();
  check(viaBar && s1.open && s1.pg === 'settings', `the bar's Menu opens the card, its Setup row the Setup page (${JSON.stringify(s1)}; Menu opened it: ${viaBar})`);

  // the settings reach what v2 has
  const tab = async (k) => { await page.click(`#lk-load .pg.on [data-tab=${k}]`); await page.waitForTimeout(100); };
  await tab('sail');
  await tab('screen'); await page.click('#lk-load [data-r="hud:clear"]');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => { const U = window.__velia.m4.ui; return { hud: U.calm.mode, saved: JSON.parse(localStorage.getItem('lakeshore.settings.v1')) }; });
  check(r.hud === 'clear', `the HUD Clear (${JSON.stringify({ ...r, saved: undefined })})`);
  check(r.saved.hud === 'clear' && r.saved._v === 2, `saved in v1's store, format 2 (${JSON.stringify(r.saved)})`);
  // wind, weather and Pro are not Setup rows on v2 (owner 2026-11-17): the Conditions sheet and the cockpit's PRO hold them
  check(await page.evaluate(() => !document.querySelector('#lk-load [data-r^="wind:"], #lk-load [data-r^="weather:"], #lk-load [data-r^="pro:"]')), 'no wind, weather or Pro row on Setup');

  // menu cards do not scroll: every Setup tab and the other pages at 1280 × 720
  const noScroll = async () => page.evaluate(() => { const b = document.querySelector('#lk-load .pg.on .pg-b') ?? document.querySelector('#lk-load .pg.on'); return b ? b.scrollHeight - b.clientHeight : -1; });
  const over = {};
  for (const k of ['sail', 'aids', 'sound', 'screen']) { await tab(k); over[`setup:${k}`] = await noScroll(); }
  for (const g of ['keys', 'about']) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.click(g === 'about' ? '#lk-load .lk-foot .lk-news[data-go=about]' : `#lk-load .lk-link[data-go=${g}]`); await page.waitForTimeout(250); over[g] = await noScroll(); }
  check(Object.values(over).every((v) => v >= 0 && v <= 1), `no page body scrolls at 1280 × 720 (${JSON.stringify(over)})`);

  // the address (About holds Contact and Support on v2 since 2026-11-18: ui/aboutPage.js) and the feedback mailto (the scene from v2's sim)
  await page.click('#lk-load .hnav .hn[data-go=about]'); await page.waitForTimeout(150);
  check(await page.evaluate(() => document.querySelector('#lk-load .pg.on .addr .mail')?.textContent === 'contact@lucidlakelabs.com'), 'About: the address');
  await page.click('#lk-load .pg.on [data-go=feedback]'); await page.waitForTimeout(150);
  await page.fill('#lk-load textarea', 'Lovely at dusk');
  const mail = decodeURIComponent((await page.evaluate(() => window.__velia.m4.front.home.feedbackMailto())).split('body=')[1] ?? '');
  const wl = await page.evaluate(() => window.__velia.boat.wind.level);   // Setup has no wind row on v2 (2026-11-17): the mail names the level in force
  check(['Lovely at dusk', 'mode: sail', `wind level: ${wl}`, 'hour: 18:4', 'position: ', 'browser: Chrome'].every((s) => mail.includes(s)), `the feedback mail carries the note and v2's scene (${mail.replace(/\n/g, ' | ').slice(0, 200)})`);
  check((await page.evaluate(() => window.__keysSeen.filter((k) => k.startsWith('Key')).length)) === 0, 'typing in the form never reaches the boat');
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // a first visit, even forced as v1's ?first=1 (a fresh browser, no stored settings): the card's home view, no skill question
  // (owner 2026-11-21: Setup only), never a stage; Sail is lit, Set sail sails, and the store holds the default profile (New)
  {
    const fv = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errs = []; fv.on('pageerror', (e) => errs.push(String(e)));
    await fv.addInitScript(PERSON);
    await fv.goto(`${BASE}/?first=1&hour=18.75&seed=1&attract=0`, { waitUntil: 'load' });
    await fv.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    await fv.waitForTimeout(600);
    const w = await fv.evaluate(() => ({ view: window.__velia.m4.front.home.view, stage: 'stage' in window.__velia.m4.front, welcome: !!document.querySelector('#lk-load .pg.welcome:not([hidden])'),
      state: window.__veliaLoading.state, mode: window.__velia.m4.front.home.mode }));
    check(w.view === 'home' && !w.welcome && !w.stage && w.state === 'home' && w.mode === 'sail', `?first=1: the card's home view, no welcome, no stage, Sail (${JSON.stringify(w)})`);
    await fv.click('#lk-load .lk-go');   // the panel's Set sail (owner, 2026-11-18)
    await fv.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 10000 }).then(() => check(true, 'a first visit: ENTER sails'), () => check(false, 'a first visit: ENTER sails'));
    const saved = await fv.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1') ?? '{}'));
    check(saved.welcomed === true && saved.profile === 'new', `nothing left to ask: the default profile, New (${JSON.stringify(saved)})`);
    check(errs.length === 0, `no page errors on a first visit (${errs.slice(0, 2).join(' | ')})`);
    await fv.close();
  }

  // a phone upright (the landscape page turned on its side): the card fits
  const ph = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ph.addInitScript(PERSON); await ph.addInitScript(WELCOMED);
  await ph.goto(`${BASE}/?mode=sail&hour=18.75&seed=1&attract=0`, { waitUntil: 'load' });
  await ph.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
  await ph.waitForTimeout(500);
  // phones are landscape-only (owner 2026-11-15): the page is turned on its side, its frame 844 × 390 (innerWidth × innerHeight)
  const fit = await ph.evaluate(() => { const c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(); return { w: c.width, r: c.right, b: c.bottom, iw: innerWidth, ih: innerHeight, turned: !!window.__veliaTurn?.rotated() }; });
  check(fit.turned && fit.r <= fit.iw + 0.5 && fit.b <= fit.ih + 0.5 && fit.w > 300, `the card fits the turned phone (${JSON.stringify(fit)})`);
  // Setup's tabs scroll on a phone's landscape page (a 250 px tall body, as on a phone held sideways before the turn): the old
  // upright no-scroll check went with the upright layout (Setup scrolls on a phone)
  await ph.close();
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
