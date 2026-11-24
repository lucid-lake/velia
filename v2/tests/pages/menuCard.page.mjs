// The cards without the classic row and the in-play Menu card without a Resume step (owner, 2026-11-15; v2/ui/menuCard.js),
// on the real v2 page, at 1280 × 800 (mouse, keys) and 390 × 844 (touch; the landscape page turned on its side):
//   no "Play the classic version" row on the home card or the in-play Menu card (About has none either since 2026-11-19: launchGate.page.mjs)
//   the desktop panel (owner, 2026-11-18: "bring back the ENTER / RESUME button"): Set sail under the mode pill, a mode press selects,
//   Enter on a mode or Set sail starts it; in play Resume in the same place, the keyboard on it; the row SETUP KEYS TUTORIAL LOGBOOK
//   the phone card has no ENTER button; desktop: Sail is lit, arrows move the lit mode, Enter starts it; phone: no lit mode, Enter does nothing (owner 2026-11-17, desktop part of 2026-11-15's ruling reversed); the in-play Menu card shows no Resume pill, and a × at its top-right
//   one tap on another mode enters it: the mode changes and the card closes
//   a tap on the current mode, Esc, the × and a tap on the world outside the card each close it with the mode unchanged
//   the keyboard: the card opens on the lit mode; Enter on it closes the card, arrows + Enter on another mode enter it
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/menuCard.page.mjs --base http://127.0.0.1:<port>
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
  for (const [vn, opt] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const touch = !!opt.hasTouch;
    const ctx = await browser.newContext(opt);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front, null, { timeout: 240000 });
    await page.waitForTimeout(800);
    const press = (sel) => (touch ? page.tap(sel) : page.click(sel));
    const look = () => page.evaluate(() => {
      const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
      const root = document.getElementById('lk-load'), x = root.querySelector('.lk-x'), xr = x?.getBoundingClientRect(), cr = root.querySelector('.lk-card').getBoundingClientRect();
      return { state: root.dataset.state, open: window.__velia.m4.front.home.isOpen, mode: window.__velia.mode.now(),
        classic: [...root.querySelectorAll('.lk-sheet a, .lk-sheet button, .lk-links a, .lk-links button')].filter((el) => shown(el) && /classic/i.test(el.textContent)).length,
        go: shown(root.querySelector('.lk-go')), lit: [...root.querySelectorAll('.lk-pick[aria-checked=true]')].map((b) => b.dataset.mode).join(), x: shown(x), xCorner: !!xr && xr.right <= cr.right + 1 && xr.right > cr.right - 80 && xr.top >= cr.top - 1 && xr.top < cr.top + 60 };
    });
    const openMenu = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__velia.m4.front.home.isOpen, null, { timeout: 5000 }); await page.waitForTimeout(500); };
    const closed = () => page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 5000 }).then(() => true, () => false);

    const h = await look();
    check(h.state === 'home' && h.classic === 0 && h.go === !touch && h.lit === (touch ? '' : 'sail') && !h.x, `${vn}: the home card has no classic row, ${touch ? 'no ENTER button, no lit mode' : 'Set sail, Sail selected'}, no × (${JSON.stringify(h)})`);
    if (touch) { await page.tap('#lk-load .lk-pmore'); await page.waitForTimeout(250); }   // the phone card folds the row into its ⋯ menu (v2/ui/phoneCard.js)
    const row = await page.evaluate(() => [...document.querySelectorAll('#lk-load .lk-links > .lk-link:not(.lk-go)')].filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none').map((b) => [b.getBoundingClientRect(), b.innerText.replace(/\s+/g, ' ').trim().toUpperCase()])
      .sort((p, q) => p[0].top - q[0].top || p[0].left - q[0].left).map((p) => p[1]).join(' '));
    check(row === (touch ? 'CHART LOGBOOK CONTROLS SETUP' : 'SETUP KEYS TUTORIAL LOGBOOK'), `${vn}: the row is ${touch ? 'CHART LOGBOOK CONTROLS SETUP' : 'SETUP KEYS TUTORIAL LOGBOOK (owner, 2026-11-18)'}, About is the foot link (${row})`);
    check(await page.evaluate(() => document.querySelector('#lk-load .lk-foot .lk-news')?.dataset.go === 'about' && /About/.test(document.querySelector('#lk-load .lk-foot .lk-news').textContent)), `${vn}: the foot's right link is About`);
    if (touch) {
      await page.tap('#lk-load .lk-pmore'); await page.waitForTimeout(200);   // the ⋯ menu closed again
      await page.keyboard.press('Enter'); await page.keyboard.press('Space'); await page.waitForTimeout(400);
      check((await look()).state === 'home', `${vn}: Enter and Space do not start a mode on a phone`);
      await press('#lk-load .lk-pick[data-mode=sail]');   // the home card: a tap on a mode enters it (home.js createEnter)
      check(await closed(), `${vn}: a tap on Sail on the home card enters it`);
    } else {
      const lit = async () => (await look()).lit;
      check(await page.evaluate(() => document.activeElement?.classList.contains('lk-go')), `${vn}: the keyboard starts on Set sail`);
      await press('#lk-load .lk-pick[data-mode=regatta]');
      check(await lit() === 'regatta' && (await look()).state === 'home', `${vn}: a press on Regatta selects it, still on the card (${await lit()})`);
      await page.focus('#lk-load .lk-pick[data-mode=cruise]'); await page.keyboard.press('Space'); await page.waitForTimeout(100);
      check(await lit() === 'cruise' && (await look()).state === 'home', `${vn}: Space on Cruise selects it (${await lit()})`);
      await page.focus('#lk-load .lk-pick[data-mode=sail]'); await page.keyboard.press('Enter');
      check(await closed() && (await look()).mode === 'sail', `${vn}: Enter on Sail selects and starts it`);
    }
    await page.waitForTimeout(1500);

    await openMenu();
    const m = await look();
    check(m.state === 'menu' && m.open && m.classic === 0 && m.go === !touch && m.x && m.xCorner, `${vn}: the Menu card: no classic row, ${touch ? 'no Resume' : 'Resume'}, a × at its top-right (${JSON.stringify(m)})`);
    if (!touch) { await press('#lk-load .lk-go'); check(await closed() && (await look()).mode === 'sail', `${vn}: Resume closes the card, still Sail`); await openMenu(); }

    // the current mode closes it, mode unchanged
    await press('#lk-load .lk-pick[data-mode=sail]');
    check(await closed() && (await look()).mode === 'sail', `${vn}: a tap on the current mode (Sail) closes the card, still Sail`);
    // Esc
    await openMenu(); await page.keyboard.press('Escape');
    check(await closed() && (await look()).mode === 'sail', `${vn}: Esc closes the card, still Sail`);
    // the ×
    await openMenu(); await press('#lk-load .lk-x');
    check(await closed() && (await look()).mode === 'sail', `${vn}: the × closes the card, still Sail`);
    // a tap on the world outside the card (the phone card fills the screen: nothing is outside it; the ×, Sail and Esc close it)
    if (!touch) {
    await openMenu();
    const out = await page.evaluate(() => { const c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(); return innerWidth - c.right > 80 ? { x: Math.round((c.right + innerWidth) / 2), y: Math.round(innerHeight / 2) } : { x: Math.round(innerWidth / 2), y: Math.max(20, Math.round(c.top / 2)) }; });
    // the point is in the page's layout frame; an upright phone shows it turned on its side (landscape-only phones, 2026-11-15)
    const [ox, oy] = await page.evaluate(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y]), [out.x, out.y]);
    if (touch) await page.touchscreen.tap(ox, oy); else await page.mouse.click(ox, oy);
    // the live map fills what the panel leaves: a press there is the map's (the water's card, the map features' ruling 2026-11-18), the menu stays
    const card = await page.evaluate(() => window.__velia.m4.ui.services.get('liveChart')?.state.card ?? null);
    check(!(await closed()) && (await look()).open && !!card, `${vn}: a press on the map beside the panel (${out.x}, ${out.y}) opens the map's card and keeps the menu (${card?.name ?? card?.kind ?? 'none'})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250); await page.keyboard.press('Escape');
    check(await closed() && (await look()).mode === 'sail', `${vn}: Esc closes the map's card, then the menu, still Sail`);
    }

    // one tap on another mode enters it at once
    await openMenu();
    await press('#lk-load .lk-pick[data-mode=cruise]');
    const c1 = await closed();
    await page.waitForFunction(() => window.__velia.mode.now() === 'cruise', null, { timeout: 15000 }).catch(() => {});
    check(c1 && (await look()).mode === 'cruise', `${vn}: one tap on Cruise enters Cruise and closes the card (${JSON.stringify(await look())})`);
    await page.waitForTimeout(1200);

    if (!touch) {
      // the keyboard: the lit mode first; Enter on it goes back; arrows + Enter on another mode enter it
      await openMenu(); await page.waitForTimeout(200);
      const f = await page.evaluate(() => document.activeElement?.dataset?.mode ?? document.activeElement?.className);
      check(/lk-go/.test(f), `${vn}: the Menu card opens with the keyboard on Resume (${f})`);
      await page.keyboard.press('Enter');
      check(await closed() && (await look()).mode === 'cruise', `${vn}: Enter on Resume closes the card, still Cruise`);
      await openMenu(); await page.waitForTimeout(200);
      await page.focus('#lk-load .lk-pick[data-mode=sail]'); await page.keyboard.press('Enter');
      const c2 = await closed();
      await page.waitForFunction(() => window.__velia.mode.now() === 'sail', null, { timeout: 15000 }).catch(() => {});
      check(c2 && (await look()).mode === 'sail', `${vn}: Enter on Sail enters it and closes the card`);
    }
    check(errors.length === 0, `${vn}: no page errors (${errors.slice(0, 3).join(' | ')})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAIL` : 'all pass');
process.exit(fails ? 1 : 0);
