// The chart's routing (2026-11-25) on the real v2 page, 1280 × 720, a mouse:
//   the hint       the map's own one-time line, in play, once: "Click the water to sail there · scroll to zoom"
//   one tap        Sail on the card starts sailing at once (no other mode, no extra step); no rail, panel or plate of Plan's exists
//   Sail here      in play, Esc opens the live map; a click on open water opens the map's own card with "Sail here" first (Set as target
//                  after it); a press sets the target and NAV takes her there with the map still open: the boat closes on it under it
//   double-click   a double-click on the map's water is Sail here's shortcut (the target moves there, NAV stays on)
//   the boat       the map draws the Coach's boat (the cockpit's drawing) at her trim in place of the sloop glyph
//   the dock       the left panel slides out 3 s after the pointer went to the map; the pointer at the left edge brings it back
//   the line       with a target and NAV on, a line from the boat to the target in the route's dashed ink, through the planner's bends (never over
//                  land); absent with no target or NAV off; clears when the target clears
//   the boat       a click on the map's boat closes the map and she sails on from where she is (NAV kept); a click near but not on her still
//                  opens the water's card
//   Esc            closes the map: she sails on with NAV, the steering keys take over as NAV does today
// Run by `node tools/test_pages.mjs --app v2 sailHere` (LAKESHORE_BASE set), or node v2/tests/pages/sailHere.page.mjs --base http://127.0.0.1:<port>
//   [--shots <dir>]: the three stills (the card with Sail here; the boat sailing to the target with the map open; the panel hidden)
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `node tools/test_pages.mjs --app v2 sailHere`, or pass --base'); process.exit(2); }
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, mapHintSeen: true })); } catch {} };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
// ?mode=plan is no mode: the page opens as Sail's (the open lake off the bay's mouth, 17:30)
await page.goto(`${BASE}/?mode=plan&hour=17.5&seed=1&attract=0&chartground=webp&start=2300,-1400&heading=60`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui?.services?.get('mapScreen'), null, { timeout: 240000 });
await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait' && !document.documentElement.hasAttribute('data-lk-hold'), null, { timeout: 240000 });
await page.waitForTimeout(1500);
const S = (n) => `window.__velia.m4.ui.services.get('${n}')`;
const pilot = () => page.evaluate(() => { const p = window.__velia.m4.ui.services.get('pilot'), s = p.state, b = window.__velia.boat.state; return { mode: p.mode, target: s.target ? { x: s.target.x, z: s.target.z } : null, d: s.target ? Math.hypot(s.target.x - b.x, s.target.z - b.z) : null }; });
const toClient = (x, z) => page.evaluate(([x, z]) => window.__velia.m4.ui.services.get('liveChart').toClient(x, z), [x, z]);
const none = () => page.evaluate(() => ['.lkp-rail', '.lkp-panel', '.lkp-plate', '.lkp-strip', '.lkp-wind', '.lkp-map'].filter((q) => document.querySelector(q)));
try {
  // one tap: Sail sails
  await pickMode(page, 'sail');
  await page.waitForFunction(() => document.getElementById('lk-load')?.dataset.state === 'gone' || !document.getElementById('lk-load')?.isConnected, null, { timeout: 20000 });
  const m0 = await page.evaluate(() => ({ mode: window.__velia.mode.current, menu: window.__velia.m4.ui.services.get('menu').isOpen }));
  check(m0.mode === 'sail' && !m0.menu, `one tap: Sail sails at once (${JSON.stringify(m0)})`);
  check((await none()).length === 0, `no rail, panel, plate or other Plan element (${(await none()).join(', ')})`);
  // the map: Esc opens it; a click on open water opens its own card with Sail here first
  await page.keyboard.press('Escape');
  await page.waitForFunction((s) => eval(s).isOpen, `${S('menu')}`, { timeout: 8000 });
  await page.waitForTimeout(900);
  const hintT = await page.evaluate(() => document.querySelector('.lk-livechart .lkc-hint[data-on]')?.textContent ?? '');
  check(hintT === 'Click the water to sail there · scroll to zoom', `the map's one-time hint teaches it in play ("${hintT}")`);
  const T = [2900, -2000], q = await toClient(...T);
  await page.mouse.click(q.x, q.y); await page.waitForTimeout(700);
  const card = await page.evaluate(() => ({ st: window.__velia.m4.ui.services.get('liveChart').state.card, more: [...document.querySelectorAll('.lk-livechart .lkc-card .more button')].map((b) => b.textContent) }));
  check(card.st?.name === 'Open water' && card.st.action === 'Sail here' && card.more.includes('Set as target'), `water: the map's card offers Sail here first (${card.st?.action}; ${card.more.join(', ')})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p1-chart-sail-here-card-1280x720.png` });
  await page.click('.lk-livechart .lkc-card .go');
  await page.waitForFunction(() => window.__velia.m4.ui.services.get('pilot').mode === 'to', null, { timeout: 20000 }).catch(() => {});
  const a0 = await pilot();
  check(a0.mode === 'to' && a0.target && Math.hypot(a0.target.x - T[0], a0.target.z - T[1]) < 10, `Sail here: NAV sails to the target (${a0.mode}, ${a0.d?.toFixed(0)} m)`);
  check(await page.evaluate(() => window.__velia.m4.ui.services.get('menu').isOpen), 'with the map still open');
  await page.mouse.move(900, 300);
  await page.waitForFunction((d0) => { const p = window.__velia.m4.ui.services.get('pilot'), s = p.state, b = window.__velia.boat.state; return s.target && Math.hypot(s.target.x - b.x, s.target.z - b.z) < d0 - 15; }, a0.d, { timeout: 40000, polling: 500 }).catch(() => {});
  const a1 = await pilot();
  check(a1.mode === 'to' && a1.d < a0.d - 15, `she closes on it under the open map (${a0.d?.toFixed(0)} → ${a1.d?.toFixed(0)} m)`);
  const boat = await page.evaluate(() => { const b = document.querySelector('.lk-livechart .lkp-cb'); return b ? { vis: getComputedStyle(b).visibility, w: b.getBoundingClientRect().width, hull: !!b.querySelector('.hull'), rows: b.querySelector('.rw.c1')?.textContent ?? '' } : null; });
  check(boat && boat.vis !== 'hidden' && boat.hull && /reach|beat|run|close|broad|irons/i.test(boat.rows), `the map draws the Coach's boat (${JSON.stringify(boat)})`);
  // the dock: out 3 s after the pointer went to the map; back at the left edge
  await page.mouse.move(800, 400); await page.mouse.move(820, 420);
  await page.waitForTimeout(3800);
  const out = await page.evaluate(() => ({ dock: document.getElementById('lk-load').dataset.dock ?? null, r: document.querySelector('#lk-load .lk-card').getBoundingClientRect().right, inset: window.__velia.m4.ui.services.get('liveChart').state.insets.left }));
  check(out.dock === 'out' && out.r <= 0 && out.inset === 0, `the panel slid out like a dock (right ${Math.round(out.r)} px, the map's inset ${out.inset})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p1-chart-sailing-panel-hidden-1280x720.png` });
  await page.mouse.move(2, 360); await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({ dock: document.getElementById('lk-load').dataset.dock ?? null, l: document.querySelector('#lk-load .lk-card').getBoundingClientRect().left }));
  check(!back.dock && Math.abs(back.l) < 2, `the left edge brings it back (${JSON.stringify(back)})`);
  await page.mouse.move(700, 400);
  // the double-click: Sail here's shortcut
  const T2 = [3300, -1300], q2 = await toClient(...T2);
  await page.mouse.dblclick(q2.x, q2.y); await page.waitForTimeout(900);
  const a2 = await pilot();
  check(a2.mode === 'to' && a2.target && Math.hypot(a2.target.x - T2[0], a2.target.z - T2[1]) < 10, `double-click: the target moves there, NAV on (${a2.mode})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p1-chart-boat-sailing-to-target-1280x720.png` });
  // the line: from the boat to the target through the planner's legs, never over land
  const line = () => page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'), ct = window.__velia.m4.ui.services.get('chartTarget'), L = c.stats().navLine;
    let land = 0, n = 0; for (let i = 1; i < L.length; i++) { const a = L[i - 1], b = L[i], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 15)); for (let j = 0; j <= k; j++) { n++; if (!(ct.depth(a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k) > 0)) land++; } }
    const bt = window.__velia.boat.state; return { pts: L.length, land, samples: n, from: L[0] ? Math.hypot(L[0][0] - bt.x, L[0][1] - bt.z) : null, to: L.length ? L[L.length - 1] : null }; });
  await page.waitForTimeout(1200);
  const l1 = await line();
  check(l1.pts >= 2 && l1.from < 40 && l1.to && Math.hypot(l1.to[0] - T2[0], l1.to[1] - T2[1]) < 270 && l1.land === 0, `a target and NAV on: the route line from the boat to the target, ${l1.pts} points, ${l1.samples} samples, ${l1.land} on land (${JSON.stringify(l1.to)})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p2-chart-route-line-1280x720.png` });
  // it follows her: the first point stays at her place
  await page.waitForTimeout(2500);
  const l2 = await line();
  check(l2.pts >= 2 && l2.from < 40, `the line updates as she sails (starts ${l2.from?.toFixed(0)} m from her)`);
  // NAV off: no line
  await page.evaluate(() => window.__velia.m4.ui.services.get('pilot').auto?.()); await page.waitForTimeout(900);
  const l3 = await line();
  check(l3.pts === 0, `NAV off: no line (${l3.pts})`);
  await page.evaluate(() => window.__velia.m4.ui.services.get('pilot').auto?.()); await page.waitForTimeout(900);
  check((await line()).pts >= 2, 'NAV on again: the line is back');
  // clear the target: the line clears
  await page.evaluate(() => window.__velia.m4.ui.services.get('chartTarget').clearTarget()); await page.waitForTimeout(900);
  check((await line()).pts === 0, 'the target cleared: no line');
  await page.evaluate(() => { const p = window.__velia.m4.ui.services.get('pilot'); if (p.mode !== 'off') p.auto(); }); await page.waitForTimeout(400);
  await page.evaluate((T) => window.__velia.m4.ui.services.get('chartTarget').sailHere({ x: T[0], z: T[1] }), T2); await page.waitForTimeout(900);
  // a click near but not on the boat opens the water's card; a click on the boat resumes
  const bq = await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'), b = window.__velia.boat.state, q = c.toClient(b.x, b.z); return { x: q.x, y: q.y }; });
  await page.mouse.click(bq.x + 70, bq.y); await page.waitForTimeout(700);
  const near = await page.evaluate(() => ({ card: window.__velia.m4.ui.services.get('liveChart').state.card?.name ?? null, menu: window.__velia.m4.ui.services.get('menu').isOpen }));
  check(near.menu && near.card === 'Open water', `a click near the boat (70 px) opens the water card (${JSON.stringify(near)})`);
  await page.mouse.click(bq.x + 70, bq.y); await page.waitForTimeout(500);   // closes the card
  const bq2 = await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'), b = window.__velia.boat.state, q = c.toClient(b.x, b.z); return { x: q.x, y: q.y }; });
  await page.mouse.move(bq2.x, bq2.y); await page.waitForTimeout(150);
  const cur = await page.evaluate(() => document.querySelector('.lk-livechart canvas').style.cursor);
  check(cur === 'pointer', `the boat has a pointer cursor (${cur})`);
  const t0 = await page.evaluate(() => window.__velia.boat.state.t ?? performance.now());
  await page.mouse.click(bq2.x, bq2.y); await page.waitForTimeout(900);
  const r1 = await page.evaluate(() => ({ menu: window.__velia.m4.ui.services.get('menu').isOpen, mode: window.__velia.m4.ui.services.get('pilot').mode, card: window.__velia.m4.ui.services.get('liveChart').state.card?.name ?? null }));
  check(!r1.menu && r1.mode === 'to', `a click on the boat closes the map, NAV kept (${JSON.stringify(r1)})`);
  const p0 = await page.evaluate(() => ({ x: window.__velia.boat.state.x, z: window.__velia.boat.state.z }));
  await page.waitForTimeout(2000);
  const p1 = await page.evaluate(() => ({ x: window.__velia.boat.state.x, z: window.__velia.boat.state.z }));
  check(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1, `play continues from where she is (${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m in 2 s)`);
  void t0;
  await page.keyboard.press('Escape'); await page.waitForFunction((s) => eval(s).isOpen, `${S('menu')}`, { timeout: 8000 }); await page.waitForTimeout(600);
  // Esc: back to the lake, NAV still on
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  const e1 = await page.evaluate(() => ({ menu: window.__velia.m4.ui.services.get('menu').isOpen, mode: window.__velia.m4.ui.services.get('pilot').mode }));
  check(!e1.menu && e1.mode === 'to', `Esc: back on the lake at once, NAV still taking her there (${JSON.stringify(e1)})`);
  check((await none()).length === 0, 'still no Plan element');
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'sailHere: all pass');
process.exit(fails ? 1 : 0);
