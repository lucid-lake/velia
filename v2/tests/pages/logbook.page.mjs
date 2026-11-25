// LOG on the real v2 page (fix(v2): LOG, owner 2026-11-13: "click Log button nothing happen"): v1's logbook (src/sail/logbook.js
// through v2/ui/logbook.js) as Sail's 'logbook' service. LOG on the home card is lit (no "in Sail"); a click closes the card and
// opens the logbook card over the live lake; Esc closes it and the Menu card stays down; LOG on the in-play Menu card opens it;
// L toggles it; the cockpit's wind dial opens it; N opens the live map over it and L the logbook back, one page at a time (owner 2026-11-17); the bar and the cockpit (its 3D draw too) step aside under it and under the Menu card; a short sail records today's line and v1's save key; the frame's
// picture grab runs in the render's task (no page errors). The node half: v2/tests/logbook.test.mjs, logbook-card.test.mjs.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/logbook.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const toggleLog = (page) => page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('logbook'));   // the key L went: the dock's Logbook row, as the Menu card's
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); sessionStorage.setItem('seeded', '1'); } } catch {} };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&cinema=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.logbook && window.__velia.m4.front, null, { timeout: 240000 });
  await page.waitForTimeout(400);
  const btn = await page.evaluate(() => { const b = document.querySelector('#lk-load .lk-link[data-go=logbook]'); return { text: b.textContent, dis: b.getAttribute('aria-disabled'), title: b.title, italic: b.style.fontStyle }; });
  check(btn.dis === 'false' && btn.title === '' && btn.italic === '', `LOG on the card is lit, no "in Sail" (${JSON.stringify(btn)})`);
  check(await page.evaluate(() => !!window.__velia.m4.ui.services.get('logbook')), 'the logbook is Sail\'s \'logbook\' service');

  // LOG from the home card: the card goes, the logbook card opens over the live lake
  await page.click('#lk-load .lk-link[data-go=logbook]');
  await page.waitForFunction(() => document.querySelector('.lk-log')?.dataset.state === 'open', null, { timeout: 8000 }).catch(() => {});
  const o = await page.evaluate(() => { const c = document.querySelector('.lk-log .card'), r = c?.getBoundingClientRect(); return { state: document.querySelector('.lk-log')?.dataset.state, load: window.__veliaLoading.state, w: r?.width, h: r?.height, op: c && getComputedStyle(c).opacity, title: document.querySelector('.lk-log .title')?.textContent, bar: getComputedStyle(document.querySelector('.lk-view')).opacity }; });
  check(o.state === 'open' && ['out', 'gone'].includes(o.load) && o.w > 300 && o.h > 250, `a click on LOG: the card gone, the logbook open (${JSON.stringify(o)})`);
  check(/Logbook/.test(o.title ?? '') && /seamanship/.test(o.title ?? '') && /sailor/.test(o.title ?? ''), `its three pages: Logbook · seamanship · sailor's words (${o.title})`);
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.lk-view')).opacity) < 0.05, 'the top bar steps aside under it (v1)');
  check(await page.evaluate(() => window.__velia.m4.cockpit?.on === false), 'the 3D cockpit is not drawn under it (v1: the station hidden)');
  await page.screenshot({ path: process.env.LOGBOOK_SHOT ?? '/dev/null' }).catch(() => {});

  // Esc closes it; the Menu card stays down (the logbook takes Esc first)
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  const e = await page.evaluate(() => ({ state: document.querySelector('.lk-log').dataset.state, menu: window.__velia.m4.front.home.isOpen }));
  check(e.state === 'closed' && !e.menu, `Esc closes the logbook, the Menu stays down (${JSON.stringify(e)})`);
  check(await page.evaluate(() => window.__velia.m4.cockpit?.on === true), 'closed: the cockpit is drawn again');

  // the Logbook opens from the dock's button (L went)
  await toggleLog(page); await page.waitForTimeout(700);
  const l1 = await page.evaluate(() => document.querySelector('.lk-log').dataset.state);
  await toggleLog(page); await page.waitForTimeout(700);
  const l2 = await page.evaluate(() => document.querySelector('.lk-log').dataset.state);
  check(l1 === 'open' && l2 === 'closed', `the Logbook button (the dock's) opens and closes it (${l1}, ${l2})`);
  await page.keyboard.press('KeyL'); await page.waitForTimeout(500);
  check((await page.evaluate(() => document.querySelector('.lk-log').dataset.state)) === 'closed', 'L is no key any more');

  // the wind dial opens the logbook; N over it opens the live map (Phase 2b,: the in-game menu is the live map; the old
  // enlarged chart page and its mirror box are gone, so the mirror check went with it); one page at a time (owner 2026-11-17)
  const card = () => page.evaluate(() => { const r = document.querySelector('.lk-log .card').getBoundingClientRect(); return { state: document.querySelector('.lk-log').dataset.state, x: r.x, y: r.y, w: r.width, h: r.height }; });
  const map = () => page.evaluate(() => { const s = window.__velia.m4.ui.services, c = s.get('liveChart'); return { menu: !!s.get('menu')?.isOpen, map: !!c?.shown && c.state.mode === 'play', big: !!window.__velia.m4.ui.chart?.chart?.toggle?.pinned }; });
  await page.mouse.move(640, 300); await page.waitForTimeout(400);
  // the wind module (v2/ui/dials.js, 2026-11-24): a click on its face, below the boat (its sail lines and rudder drag instead)
  const wd = await page.evaluate(() => { const r = document.querySelector('.lk-cv .dial').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.88, w: r.width }; });
  await page.mouse.click(wd.x, wd.y); await page.waitForTimeout(900);
  const c1 = await card();
  check(wd.w >= 44 && c1.state === 'open', `a click on the Coach opens the logbook (${JSON.stringify(c1)})`);
  await page.keyboard.press('KeyN'); await page.waitForTimeout(1200);
  const b1 = await map(), c2 = await card();
  check(b1.menu && b1.map && !b1.big && c2.state === 'closed', `N over it: the live map opens, the logbook closes (${JSON.stringify(b1)}, ${c2.state})`);
  await page.keyboard.press('KeyL'); await page.waitForTimeout(1200);   // L is no key now; the map held the keys before
  const b2 = await map(), c3 = await card();
  // the map is the Menu card, which holds the game's keys (src/ui/home.js): L opens nothing under it; LOG on its panel does (below)
  check(b2.menu && c3.state === 'closed', `L over the live map: no logbook under it, one page at a time (${JSON.stringify(b2)}, ${c3.state})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);

  // LOG on the in-play Menu card (Esc): the Menu closes, the logbook opens
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__velia.m4.front.home.isOpen), 'Esc in play: the Menu card');
  check(await page.evaluate(() => window.__velia.m4.cockpit?.on === false), 'the 3D cockpit is not drawn under the Menu card either');
  await page.click('#lk-load .lk-link[data-go=logbook]');
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => ({ state: document.querySelector('.lk-log').dataset.state, menu: window.__velia.m4.front.home.isOpen }));
  check(m.state === 'open' && !m.menu, `LOG on the Menu card: the Menu closes, the logbook opens (${JSON.stringify(m)})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);

  // a short sail: today's line grows (1.5 s of sim time a point); the chart page's foot says today's distance
  await page.waitForTimeout(6000);
  const s = await page.evaluate(() => { const L = window.__velia.m4.logbook; return { n: L.track.length, t: window.__velia.boat.sim.t }; });
  check(s.n >= 3, `today's line: ${s.n} points after ${s.t.toFixed(1)} s of sim time`);
  await toggleLog(page); await page.waitForTimeout(400);
  await page.evaluate(() => { window.__velia.m4.logbook.logbook.page = 'log'; for (let i = 0; i < 3 && document.querySelector('.lk-log').dataset.view !== 'chart'; i++) document.querySelector('.lk-log [data-step="1"]').click(); });
  await page.waitForTimeout(600);
  const foot = await page.evaluate(() => ({ view: document.querySelector('.lk-log').dataset.view, foot: document.querySelector('.lk-log .foot')?.textContent }));
  check(foot.view === 'chart' && /^today/.test(foot.foot ?? ''), `the chart page: today's line and its distance (${JSON.stringify(foot)})`);
  await toggleLog(page); await page.waitForTimeout(600);
  // pagehide keeps the line in v1's key (the faint "last sail" next visit)
  await page.evaluate(() => dispatchEvent(new Event('pagehide')));
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.logbook.v1') ?? 'null'));
  check(save?.v === 1 && Array.isArray(save.lastTrack) && save.lastTrack.length >= 3, `v1's save, 'lakeshore.logbook.v1', with the last sail (${save ? `${save.lastTrack?.length} points, entries ${Object.keys(save.entries)}` : 'none'})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // a headless capture never builds it (v1's rule: captures and goldens hold)
  const cap = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await cap.goto(`${BASE}/?hour=15&seed=1&headless=1`, { waitUntil: 'load' });
  await cap.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await cap.waitForTimeout(500);
  check(await cap.evaluate(() => !window.__velia.m4?.logbook && !document.querySelector('.lk-log')), 'headless: no logbook');
  await cap.close();
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
