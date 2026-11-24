// The map's crosshair, layers, wake and the water's card on the real v2 page (owner go 2026-11-18), 1280 × 720, a mouse,
// then a phone at 844 × 390:
//   cursor    the crosshair is the map's pointer (no grab hand at rest), the hand only while a drag holds it; the eased crosshair
//             settles on the pointer and snaps to a point within 22 px
//   wake      a short sail leaves a wake; Setup › Sail › your wake › forget clears it; reload voyages: only the last 3 are kept and drawn
//             (newest full, then 60 %, 30 %), a 4th reload drops the oldest
//   layers    each toggle from All shows its own kinds alone; All brings every one back
//   water     a click on open water opens its card (Set as target, Add waypoint) and the menu stays open; Set as target sets Sail's
//             mark and NAV sails to it; two waypoints draw the route; on land both refuse in plain words; ?mapux=0: no crosshair or layers
//   phone     the box's Layers button opens the 2 x 3 grid; a toggle works
// Run by `npm run test:pages:v2 -- mapUx`, or node v2/tests/pages/mapUx.page.mjs --base http://127.0.0.1:<port> [--shots <dir>]
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, mapHintSeen: true })); } catch {} };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const Q = '?mode=sail&hour=15&seed=1&attract=0&chartground=webp&cinema=0';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const wait = (page, ms) => page.waitForTimeout(ms);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(opt, q = Q) {
  const ctx = await browser.newContext(opt);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui?.services.get('mapScreen'), null, { timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait', null, { timeout: 240000 });
  // the cold load's hold (ui/loadWords.js, 2026-11-21): the card stays hidden (visibility) under the still, the facts
  // and a phone's advice (at least 5 s) until the card's layout is there; a tap before it lifts lands on nothing
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-lk-hold'), null, { timeout: 60000 });
  await wait(page, 1500);
  return { ctx, page, errors };
}
const lc = (page) => page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); return { ...c.state, ux: c.ux ? { layers: c.ux.layers, snapped: c.ux.snapped, cursor: c.ux.cursor } : null }; });
const cursorCss = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.lk-livechart > canvas')).cursor);
const toClient = (page, x, z) => page.evaluate(([a, b]) => window.__velia.m4.ui.services.get('liveChart').toClient(a, b), [x, z]);
// a spot on the chart in view, in the free area, with depth in [lo, hi] m, nearest dist m from the boat on the first bearing that has one
const spot = (page, { lo = 6, hi = 1e9, dist = 260, from = null, avoid = [], wp = false } = {}) => page.evaluate(([lo, hi, dist, from, avoid, wp]) => {
  const ct = window.__velia.m4.ui.services.get('chartTarget'), c = window.__velia.m4.ui.services.get('liveChart'), b = from ?? window.__velia.boat.state, st = c.state;
  for (const r of [dist, dist * 0.7, dist * 1.4, dist * 0.45, dist * 2]) for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2, x = b.x + Math.sin(a) * r, z = b.z - Math.cos(a) * r, d = ct.depth(x, z), q = c.toClient(x, z);
    if (!(d >= lo && d <= hi)) continue;
    if (q.x < st.insets.left + 60 || q.x > st.w - 90 || q.y < 80 || q.y > st.h - 90) continue;
    if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 120)) continue;
    if (st.pois.some((p) => Math.hypot(p.px - q.x, p.py - q.y) < 40)) continue;
    if (wp && ct.canWaypoint({ x, z }) === false) continue;   // a waypoint the navigator takes (clear of the shore, a way there)
    return { x, z, d };
  }
  return null;
}, [lo, hi, dist, from, avoid, wp]);
const clickAt = async (page, p) => { if ((await lc(page)).card) { await page.keyboard.press('Escape'); await wait(page, 200); } const q = await toClient(page, p.x, p.z); await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.up(); await wait(page, 650); };
const cardState = (page) => lc(page).then((s) => s.card);
const menuOpen = (page) => page.evaluate(() => window.__veliaLoading.state === 'menu' && !document.getElementById('lk-load').hasAttribute('data-off'));
const openMenu = async (page) => {
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => { const l = window.__velia.m4.ui.services.get('liveChart'); return l?.shown && l.state.mode === 'play'; }, null, { timeout: 30000 });
  await wait(page, 900);
};
const closeMenu = async (page) => { await page.evaluate(() => window.__velia.m4.ui.services.get('menu')?.close?.()); await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 15000 }).catch(() => {}); await wait(page, 400); };
const auto = async (page) => { const r = await page.evaluate(() => { const h = window.__velia.m4.ui.services.get('apHud'), k = h.buttons.key.getBoundingClientRect(), G = h.geometry; return { x: k.x + k.width / 2 + G.ri + G.moon / 2, y: k.y + k.height / 2 }; }); await page.mouse.click(r.x, r.y); };

// ---------------- desktop ----------------
{
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } });
  // the entrance: the crosshair is the pointer; the eased crosshair settles on it
  check(await page.evaluate(() => !!document.querySelector('.lk-livechart .lkc-layers') && !!document.querySelector('.lk-livechart .lkc-xh')), 'entrance: the layer toggles and the crosshair are on by default');
  check(await cursorCss(page) === 'crosshair', `cursor: the crosshair at rest, no grab hand (${await cursorCss(page)})`);
  await page.mouse.move(900, 300); await page.mouse.move(940, 340, { steps: 4 }); await wait(page, 120);
  let s = await lc(page);
  const lagging = s.ux.cursor && Math.hypot(s.ux.cursor.x - 940, s.ux.cursor.y - 340) > 0.5;
  await wait(page, 700); s = await lc(page);
  check(s.ux.cursor && Math.hypot(s.ux.cursor.x - 940, s.ux.cursor.y - 340) < 1.5, `crosshair: settles on the pointer (${JSON.stringify(s.ux.cursor)}; trailing it just after the move: ${lagging})`);
  await shot(page, '01-entrance-crosshair-latlong');
  await page.mouse.down(); await page.mouse.move(980, 360, { steps: 5 });
  check(await cursorCss(page) === 'grabbing', `cursor: the hand only while a drag holds the map (${await cursorCss(page)})`);
  await page.mouse.up(); await wait(page, 200);
  check(await cursorCss(page) === 'crosshair', 'cursor: back to the crosshair on release');

  // a short sail: her wake
  await pickMode(page, 'sail');   // the panel: Set sail starts the selected mode (owner, 2026-11-18)
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForFunction(() => (window.__velia.m4.ui.services.get('mapWake')?.count ?? 0) >= 18, null, { timeout: 120000, polling: 500 }).catch(() => {});   // about 220 m sailed
  const wn = await page.evaluate(() => window.__velia.m4.ui.services.get('mapWake').count);
  check(wn >= 4, `wake: a short sail leaves her wake (${wn} points, one each 12 m)`);
  await openMenu(page);
  await page.mouse.move(160, 450); await wait(page, 200);
  await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'), b = window.__velia.boat.state; c.setView({ center: { x: b.x - 70, z: b.z }, mpp: 1.4, animate: false }); });
  await wait(page, 700);
  await shot(page, '02-menu-wake-after-sail');
  await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); c.setView({ mpp: 3.2, animate: false }); c.recentre(); }); await wait(page, 700);

  // the crosshair's reading from the boat, and the magnet
  const w1 = await spot(page, { dist: 320 });
  if (w1) { const q = await toClient(page, w1.x, w1.z); await page.mouse.move(q.x, q.y, { steps: 4 }); await wait(page, 700); }
  s = await lc(page);
  check(!!s.ux.cursor && !s.ux.snapped, 'crosshair: on open water, the bearing and distance from the boat (no snap)');
  await shot(page, '03-crosshair-bearing');
  const poi = s.pois.find((p) => p.px > s.insets.left + 60 && p.px < s.w - 120 && p.py > 80 && p.py < s.h - 90);
  if (poi) { await page.mouse.move(poi.px + 13, poi.py + 9, { steps: 5 }); await wait(page, 700); }
  s = await lc(page);
  const pNow = s.pois.find((p) => p.id === poi?.id);   // the map follows her: the point's place now
  const dSnap = pNow && s.ux.cursor ? Math.hypot(s.ux.cursor.x - pNow.px, s.ux.cursor.y - pNow.py) : null;
  check(poi && s.ux.snapped === poi.id && dSnap != null && dSnap < 4, `crosshair: snaps to ${poi?.id} 16 px away (snapped ${s.ux.snapped}, ${dSnap?.toFixed(1)} px off it)`);
  await shot(page, '04-crosshair-snap');
  await page.mouse.move(160, 450); await wait(page, 200);

  // the layers: each one alone from All, then All
  const LAYER_KINDS = { places: ['birthplace', 'place', 'corner'], anchorages: ['anchorage'], marks: ['buoy', 'channel', 'raceMark', 'barge'], wildlife: ['area'], wake: [] };
  let n = 5;
  for (const [id, kinds] of Object.entries(LAYER_KINDS)) {
    await page.click('.lkc-layers button[data-layer=all]'); await wait(page, 200);
    await page.click(`.lkc-layers button[data-layer=${id}]`); await wait(page, 500);
    s = await lc(page);
    const off = s.pois.filter((p) => !kinds.includes(p.kind)).map((p) => p.kind);
    if (!kinds.includes('birthplace')) { const i = off.indexOf('birthplace'); if (i >= 0) off.splice(i, 1); }   // the chosen pin is lit: it always shows
    check(s.ux.layers.length === 1 && s.ux.layers[0] === id && off.length === 0, `layers: ${id} alone (${s.pois.map((p) => p.kind).join(', ') || 'no points'})`);
    await shot(page, `0${n++}-layer-${id}`);
  }
  await page.click('.lkc-layers button[data-layer=all]'); await wait(page, 400);
  s = await lc(page);
  check(s.ux.layers.length === 5 && s.pois.some((p) => p.kind === 'anchorage') && s.pois.some((p) => p.kind === 'birthplace'), 'layers: All brings every layer back');

  // the water's card: Set as target, then NAV sails there; the menu stays open on a click on the water
  await page.evaluate(() => window.__velia.beacon?.mark?.clear?.());
  const t1 = await spot(page, { dist: 380, lo: 8 });
  await clickAt(page, t1);
  let c = await cardState(page);
  check(c?.name === 'Open water' && c.action === 'Set as target' && (await lc(page)).water?.actions.includes('waypoint'), `water: a click opens its card (${JSON.stringify(c)})`);
  check(await menuOpen(page), 'water: a click on the water no longer closes the menu');
  await shot(page, '10-water-card');
  await page.click('.lk-livechart .lkc-card .go'); await wait(page, 400);
  const mk = await page.evaluate(() => window.__velia.beacon?.mark?.mark ?? null);
  check(mk && Math.hypot(mk.x - t1.x, mk.z - t1.z) < 8, `water: Set as target sets Sail's mark there (${mk ? `${mk.x.toFixed(0)}, ${mk.z.toFixed(0)}` : 'none'} vs ${t1.x.toFixed(0)}, ${t1.z.toFixed(0)})`);
  await page.mouse.move(160, 450); await wait(page, 300);
  await shot(page, '11-target-on-chart');
  await closeMenu(page);
  await auto(page);
  await page.waitForFunction(() => window.__velia.m4.ui.services.get('pilot').mode === 'to', null, { timeout: 20000 }).catch(() => {});
  const a0 = await page.evaluate(() => { const p = window.__velia.m4.ui.services.get('pilot'), s = p.state, b = window.__velia.boat.state; return { mode: p.mode, d: s.target ? Math.hypot(s.target.x - b.x, s.target.z - b.z) : null }; });
  if (a0.mode === 'to') await page.waitForFunction((d0) => { const s = window.__velia.m4.ui.services.get('pilot').state, b = window.__velia.boat.state; return s.target && Math.hypot(s.target.x - b.x, s.target.z - b.z) < d0 - 10; }, a0.d, { timeout: 30000, polling: 500 }).catch(() => {});
  const a1 = await page.evaluate(() => { const s = window.__velia.m4.ui.services.get('pilot').state, b = window.__velia.boat.state; return s.target ? Math.hypot(s.target.x - b.x, s.target.z - b.z) : null; });
  check(a0.mode === 'to' && a1 != null && a1 < a0.d - 10, `NAV: sails to the chart's target (${a0.mode}; ${a0.d?.toFixed(0)} → ${a1?.toFixed(0)} m)`);
  await auto(page); await wait(page, 300);   // NAV off: the helm is the player's again
  await page.evaluate(() => window.__velia.beacon?.mark?.clear?.());

  // two waypoints: the route draws (dashed, numbered), and the card offers Set course and Clear route
  await openMenu(page);
  await page.evaluate(() => window.__velia.m4.ui.services.get('chart').planReady);
  const p1 = await spot(page, { dist: 300, lo: 8, wp: true });
  await clickAt(page, p1);
  await page.locator('.lk-livechart .lkc-card .more button[data-act=waypoint]').click();
  await page.waitForFunction(() => !window.__velia.m4.ui.services.get('liveChart').state.card, null, { timeout: 30000 }).catch(() => {});
  await wait(page, 300);
  const p2 = await spot(page, { dist: 280, lo: 8, from: p1, avoid: [p1], wp: true });
  await clickAt(page, p2);
  c = await lc(page);
  check(c.water?.actions.includes('clearRoute') && c.water.actions.includes('setCourse'), `waypoints: with a route the card adds Set course and Clear route (${c.water?.actions.join(', ')})`);
  await page.locator('.lk-livechart .lkc-card .more button[data-act=waypoint]').click();
  await page.waitForFunction(() => !window.__velia.m4.ui.services.get('liveChart').state.card, null, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => (window.__velia.m4.ui.services.get('chart').course?.route ?? []).length >= 2, null, { timeout: 5000 }).catch(() => {});   // the second waypoint lands a beat after the card closes
  await wait(page, 300);
  const route = await page.evaluate(() => window.__velia.m4.ui.services.get('chart').course?.route ?? []);
  check(route.length === 2 && Math.hypot(route[0].x - p1.x, route[0].z - p1.z) < 60 && Math.hypot(route[1].x - p2.x, route[1].z - p2.z) < 60, `waypoints: two added, the route drawn through them (${route.map((w) => `${w.x.toFixed(0)},${w.z.toFixed(0)}`).join(' → ')})`);
  await page.mouse.move(160, 450); await wait(page, 300);
  await shot(page, '12-route-two-waypoints');

  // land: both refuse in plain words; nothing set
  const land = await spot(page, { lo: -1e9, hi: -3, dist: 260 });
  await clickAt(page, land);
  c = await cardState(page);
  check(c?.name === 'The shore', `land: the card names the shore (${c?.name})`);
  await page.click('.lk-livechart .lkc-card .go'); await wait(page, 300);
  c = await cardState(page);
  const mk2 = await page.evaluate(() => window.__velia.beacon?.mark?.mark ?? null);
  check(c?.say === 'That is dry land. Pick open water.' && !mk2, `land: Set as target refuses (${c?.say})`);
  await page.locator('.lk-livechart .lkc-card .more button[data-act=waypoint]').click(); await wait(page, 600);
  c = await cardState(page);
  const route2 = await page.evaluate(() => window.__velia.m4.ui.services.get('chart').course?.route ?? []);
  check(!!c?.say && route2.length === 2, `land: Add waypoint refuses (${c?.say})`);
  await shot(page, '13-land-refusal');
  await page.keyboard.press('Escape'); await wait(page, 200);
  check(await menuOpen(page) && !(await cardState(page)), 'Esc closes the card first; the menu stays');
  // Clear route
  const w3 = await spot(page, { dist: 340, lo: 8 });
  await clickAt(page, w3);
  await page.locator('.lk-livechart .lkc-card .more button[data-act=clearRoute]').click(); await wait(page, 500);
  check((await page.evaluate(() => window.__velia.m4.ui.services.get('chart').course?.route.length ?? -1)) === 0, 'waypoints: Clear route clears it');

  // Setup › Sail › your wake › forget
  await page.evaluate(() => window.__velia.m4.front.home.show('settings', false)); await wait(page, 400);
  await page.click('#lk-load .pg[data-page=settings] .tab[data-tab=sail]'); await wait(page, 300);
  const row = await page.evaluate(() => { const b = document.querySelector('#lk-load [data-set=wake] button'); const r = b?.getBoundingClientRect(); return b ? { text: b.textContent, vis: r.width > 0 && r.bottom <= innerHeight } : null; });
  check(row?.text === 'forget' && row.vis, `Setup: Sail › your wake › forget is on the page (${JSON.stringify(row)})`);
  await shot(page, '14-setup-forget-wake');
  await page.click('#lk-load [data-set=wake] button'); await wait(page, 200);
  const after = await page.evaluate(() => ({ n: window.__velia.m4.ui.services.get('mapWake').count, text: document.querySelector('#lk-load [data-set=wake] button').textContent, stored: localStorage.getItem('lakeshore.wake.v2') }));
  check(after.n <= 1 && after.text === 'forgotten' && after.stored === '{"v":2,"voyages":[]}', `Setup: forget clears the wake (she sails on: a new wake may start) (${JSON.stringify(after)})`);
  check(errors.length === 0, `desktop: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}
// ---------------- the wake keeps the last 3 voyages (owner, 2026-11-19): reload four times, a voyage each ----------------
{
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } });
  const sail = (n) => page.evaluate((n) => { const w = window.__velia.m4.ui.services.get('mapWake'); for (let i = 0; i <= 30; i++) w.sample(-300 + i * 14, -420 + n * 150 - i * 6); w.save(); }, n);   // a 420 m line, a row apart for each voyage
  const keep = () => page.evaluate(() => { const w = window.__velia.m4.ui.services.get('mapWake'); return { voyages: w.voyages.length, firsts: w.voyages.map((o) => o.segs[0][0][1]), stored: JSON.parse(localStorage.getItem('lakeshore.wake.v2')).voyages.length }; });
  const reload = async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui?.services.get('mapScreen'), null, { timeout: 240000 });
    await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait', null, { timeout: 240000 });
    await wait(page, 1200);
  };
  await page.evaluate(() => localStorage.removeItem('lakeshore.wake.v2'));
  await reload();   // a clean start
  await sail(0); await reload();
  await sail(1); await reload();
  let k = await keep();
  check(k.voyages === 2 && k.stored === 2, `wake: two reloaded voyages are both kept (${JSON.stringify(k)})`);
  await sail(2); await reload();
  k = await keep();
  check(k.voyages === 3 && k.stored === 3, `wake: three voyages are kept (${JSON.stringify(k)})`);
  await reload();   // a reload that never sails adds none
  check((await keep()).voyages === 3, 'wake: a reload with no sailing keeps the same three');
  await sail(3); await reload();   // the 4th voyage drops the oldest
  k = await keep();
  check(k.voyages === 3 && k.stored === 3 && k.firsts.join() === [-270, -120, 30].join(), `wake: the 4th voyage drops the oldest, the newest 3 stay in order (${JSON.stringify(k)})`);
  await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); c.setView({ center: { x: -100, z: -240 }, mpp: 2.6, animate: false }); }); await wait(page, 900);
  await shot(page, '17-wake-last-three-voyages');
  check(errors.length === 0, `wake voyages: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}
// ---------------- ?mapux=0: none of it; the water's card stays (it is the chart's own) ----------------
{
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 720 } }, `${Q}&mapux=0`);
  check(await page.evaluate(() => !document.querySelector('.lk-livechart .lkc-layers') && !document.querySelector('.lk-livechart .lkc-xh') && !window.__velia.m4.ui.services.get('mapWake')), '?mapux=0: no layers, no crosshair, no wake');
  check(errors.length === 0, `?mapux=0: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}
// ---------------- a phone: the box's Layers button ----------------
{
  const { ctx, page, errors } = await open({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  await page.evaluate(() => { const w = window.__velia.m4.ui.services.get('mapWake'); const seg = []; for (let i = 0; i <= 40; i++) seg.push([140 + i * 14, -140 - i * 12]); w.seed([seg]); });
  await wait(page, 1300);
  const b = await page.evaluate(() => { const e = document.querySelector('.lk-livechart .lkc-lyb'); const r = e?.getBoundingClientRect(); return e ? { w: r.width, h: r.height, x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  check(b && b.w >= 44 && b.h >= 44, `phone: one Layers button in the box, 44 px (${JSON.stringify(b)})`);
  await shot(page, '15-phone-wake-layers-button');
  if (b) await page.touchscreen.tap(b.x, b.y);
  await wait(page, 300);
  const grid = await page.evaluate(() => { const g = document.querySelector('.lk-livechart .lkc-layers'); const bs = [...g.querySelectorAll('button')].map((x) => x.getBoundingClientRect()); return { shown: !g.hidden, minH: Math.min(...bs.map((r) => r.height)) }; });
  check(grid.shown && grid.minH >= 44, `phone: the grid opens, every toggle 44 px (${JSON.stringify(grid)})`);
  await shot(page, '16-phone-layers-grid');
  const t = await page.evaluate(() => { const r = document.querySelector('.lkc-layers button[data-layer=anchorages]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(t.x, t.y); await wait(page, 400);
  check((await lc(page)).ux.layers.join() === 'anchorages', 'phone: a toggle works (Anchorages alone)');
  check(errors.length === 0, `phone: no page errors (${errors.slice(0, 3).join(' | ')})`);
  await ctx.close();
}
await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
