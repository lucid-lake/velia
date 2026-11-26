// The card on the live map (Phase 2b; v2/ui/chart/mapScreen.js, liveChart.js), on the real v2 page:
//   1280 × 720, mouse   the entrance: the live chart fills the window behind the slim left panel (VELIA, the voyage line, the mode pill,
//                       CHART LOG KEYS SETUP, one foot row); the first visit is one tap (Sail) and she starts at Tessie's water; a pin
//                       tapped is the pick (the voyage line follows) and Sail then starts there; the zoom-in runs (about 0.9 s) and the page
//                       ends in play; reduced motion is a cut
//   in play             Esc opens the same screen centred on the boat, the panel never covers her, the ground is glass over the live lake;
//                       a pin's one action, Sail from here, moves her and closes the menu; Esc closes the map's card first
//   keyboard            the map is a tab stop: Tab walks the pins, Enter opens one's card
//   ?livechart=0        today's card with its mini chart (one release)
//   844 × 390, 667 × 375, touch   the phone card (layout A) keeps its thumb column; the chart sits in the left box; the first visit is one
//                       tap; in play the map is opaque with the lake paused; a pin then Sail from here moves her
// Run by `npm run test:pages:v2 -- mapCard` (LAKESHORE_BASE set), or node v2/tests/pages/mapCard.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;   // [--shots <dir>]: the race pin's card, one still
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DESK = { viewport: { width: 1280, height: 720 } };
const phone = (width, height) => ({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });

async function open(opt, query = '?mode=sail&hour=15&seed=1&attract=0&chartground=webp', { live = true } = {}) {
  const ctx = await browser.newContext(opt);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction((l) => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front?.birthplaceCard && (!l || window.__velia.m4.ui.services.get('mapScreen')), live, { timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait', null, { timeout: 240000 });
  // the cold load's hold (ui/loadWords.js, 2026-11-21): the card stays hidden (visibility) under the still, the facts
  // and a phone's advice (at least 5 s) until the card's layout is there; a tap before it lifts lands on nothing
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-lk-hold'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}
const boat = (page) => page.evaluate(() => { const s = window.__velia.boat.state; return { x: s.x, z: s.z }; });
const voyage = (page) => page.evaluate(() => document.querySelector('#lk-load .lk-sum').innerText.replace(/\s+/g, ' ').replace(/^Lake and boat: /, '').trim());
const chartState = (page) => page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); return { ...c.state, shown: c.shown }; });
const pinAt = (page, id) => page.evaluate((id) => { const r = window.__velia.m4.ui.services.get('birthplace').list().find((q) => q.id === id); return window.__velia.m4.ui.services.get('liveChart').toClient(r.x, r.z); }, id);
const rect = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);
const near = (b, [x, z], m = 90) => Math.hypot(b.x - x, b.z - z) < m;
const PLACE = { tessie: [460, -50], fannette: [210, 50], vikingsholm: [-220, 220] };
// the panel (desktop, tablet): a mode press selects it and Set sail starts it (owner, 2026-11-18: "bring back the ENTER / RESUME button");
// the phone card: a tap on the mode enters it
const goShown = (page) => page.evaluate(() => !!document.querySelector('#lk-load .lk-go')?.getClientRects().length);
const sailClick = (page, tap = false) => pickMode(page, 'sail', { tap });
// the panel's float plan: the ledger's rows (waters, vessel, start, the ship's clock, the weather and wind)
const ledger = (page) => page.evaluate(() => [...document.querySelectorAll('#lk-load .lk-ledger > .lr')].filter((b) => b.getClientRects().length).map((b) => (b.querySelector('.v') ?? b.querySelector('[data-vb][aria-checked=true]')).textContent.trim()));   // the vessel row: the chosen button

// ---------------- 1280 × 720 ----------------
{
  const { ctx, page, errors } = await open(DESK);
  const s = await chartState(page), panel = await rect(page, '#lk-load .lk-card');
  check(s.shown && s.mode === 'entrance' && s.w === 1280 && s.h === 720, `desk: the live chart fills the window behind the card (${s.w}×${s.h}, ${s.mode}, shown ${s.shown})`);
  check(panel && panel.l === 0 && panel.t === 0 && panel.h === 720 && panel.w >= 300 && panel.w <= 360, `desk: the card is the slim left panel, full height (${panel?.w}×${panel?.h})`);
  check(s.insets.left === Math.round(panel.w) || Math.abs(s.insets.left - panel.w) < 2, `desk: the chart keeps the panel's width clear (inset ${s.insets.left})`);
  const parts = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    return { word: vis('#lk-load .lk-word'), hero: vis('#lk-load .lk-hero'), free: !!document.querySelector('#lk-load .lk-free'), sum: vis('#lk-load .lk-ledger'), picks: vis('#lk-load .lk-picks') || vis('#lk-load .lk-row.plan'),
      links: [...document.querySelectorAll('#lk-load .lk-links > .lk-link:not(.lk-go)')].filter((b) => b.getClientRects().length).map((b) => [b.getBoundingClientRect(), b.innerText.trim()]).sort((p, q) => p[0].top - q[0].top || p[0].left - q[0].left).map((p) => p[1]),
      oneRow: (() => { const r = [...document.querySelectorAll('#lk-load .lk-links > .lk-link:not(.lk-go)')].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect()); return r.length > 0 && r.every((x) => Math.abs(x.top - r[0].top) < 2 && x.height <= 44); })(), go: document.querySelector('#lk-load .lk-go')?.getClientRects().length ? document.querySelector('#lk-load .lk-go').innerText.trim() : null, sup: vis('#lk-load .lk-sup'), gh: vis('#lk-load .lk-foot .lk-gh'), about: vis('#lk-load .lk-news'),
      ver: document.querySelector('#lk-load .lk-ver')?.dataset.short ?? null, mini: vis('#lk-load .lk-bp') };
  });
  check(parts.word && parts.hero && !parts.free && parts.sum && parts.picks && parts.sup && parts.gh && parts.about && !parts.mini, `desk: VELIA, the slogan (no "Free · no sign-up", 2026-11-24), the float plan, the mode pill and the foot are there; the card's mini chart is not (${JSON.stringify(parts)})`);
  check(parts.links.join(' ').toLowerCase() === 'setup keys tutorial logbook' && parts.oneRow, `desk: SETUP KEYS TUTORIAL LOGBOOK in one row, no CHART (the screen is the chart; owner 2026-11-18) (${parts.links.join(' ')})`);
  check(/^set sail$/i.test(parts.go ?? ''), `desk: Set sail is the panel's one primary action (${parts.go})`);
  const foot = await page.evaluate(() => { const f = document.querySelector('#lk-load .lk-foot'), c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(); return [...f.children].filter((e) => e.getClientRects().length).every((e) => e.getBoundingClientRect().right <= c.right + 1); });
  check(foot, 'desk: the foot is one row inside the panel');
  const lg = await ledger(page);
  check(lg.length === 4 && lg[0] === 'Emerald Bay' && lg[1] === 'Halcyon' && lg[2] === "Tessie's water" && /^4 Jul · 15:0\d · (Clear|Fair|Storm)( · (\d+ kn )?[NESW]{1,2})?$/.test(lg[3]), `desk: the float plan's rows (owner, 2026-11-20): waters (a label), boat, start, one conditions row: the clock, the weather and wind (${lg.join(' | ')})`);
  const wl = await page.evaluate(() => { const r = document.querySelector('#lk-load .lk-ledger [data-lr=waters]'); return { tag: r?.tagName, ch: !!r?.querySelector('.ch'), popup: r?.getAttribute('aria-haspopup') }; });
  check(wl.tag === 'DIV' && !wl.ch && !wl.popup, `desk: the waters row is a plain label while there is one lake: no chevron, no press (${JSON.stringify(wl)})`);
  const pins = s.pois.filter((p) => p.kind === 'birthplace');   // every birthplace of the region table: the bay's five and Off Ski Run, on the paper
  check(pins.length === 6 && pins.every((p) => p.px >= panel.w && p.px <= 1280 && p.py >= 0 && p.py <= 720), `desk: all six pins (the bay's five and Off Ski Run) are on the map in what the panel leaves (${pins.map((p) => `${p.id}@${p.px | 0},${p.py | 0}`).join(' ')})`);
  check(s.sheets.includes('lake') && s.labels.some((l) => l.id === 'n-bp-ski-run' && l.shown), `desk: the first view is on the drawn paper (the lake's sheet under the bay's), Off Ski Run named on it (${s.sheets.join(', ')})`);

  // the day's lake fact (2026-11-24, moved from the loading screen): one quiet line on the free map, clear of the + and −
  // column and the map credit; ?hour: the first fact; a tap the next
  const fx = await page.evaluate(() => {
    const q = (s) => { const e = document.querySelector(s); const b = e?.getBoundingClientRect(); return b && b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
    const f = document.querySelector('.lk-livechart .lkc-fact');
    return { text: f?.textContent ?? null, shown: !!f && !f.hidden && f.getClientRects().length > 0, font: f ? getComputedStyle(f).fontFamily.split(',')[0].replace(/"/g, '') + ' ' + getComputedStyle(f).fontStyle : null,
      f: q('.lk-livechart .lkc-fact'), ctl: q('.lkc-ctl'), osm: q('#lk-load .lk-osm'), panel: q('#lk-load .lk-card') };
  });
  const hit = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  check(fx.shown && fx.text === 'Lake Tahoe is 501 m deep at its deepest point.' && fx.font === 'Jost italic', `desk: the chart's lake fact, the first on a deterministic page, in the chart's italic (${JSON.stringify({ text: fx.text, font: fx.font })})`);
  check(fx.f && fx.f.l >= fx.panel.r && fx.f.r <= 1280 && fx.f.b <= 720 && !hit(fx.f, fx.ctl) && !hit(fx.f, fx.osm) && fx.f.b <= 720 - 8, `desk: the fact sits in the free map's lower left, touching nothing (${JSON.stringify(fx.f)})`);
  await page.click('.lk-livechart .lkc-fact'); await page.waitForTimeout(200);
  const fx2 = await page.evaluate(() => ({ text: document.querySelector('.lk-livechart .lkc-fact').textContent, sel: window.__velia.m4.ui.services.get('liveChart').state.selected ?? null }));
  check(fx2.text === 'Fannette Island is the only island in Lake Tahoe.' && !fx2.sel, `desk: a tap shows the next fact and selects nothing on the map (${JSON.stringify(fx2)})`);

  // the owner's help for a map you may not know moves: the + / − pair, the crosshair cursor, the one-time hint
  check(await page.evaluate(() => document.querySelector('.lkc-hint').textContent === 'Scroll to zoom · drag to move'), 'help: the hint reads "Scroll to zoom · drag to move" on a desktop');
  check(await page.evaluate(() => window.__velia.m4.front.home && !!document.querySelector('.lkc-ctl .lkc-zb[aria-label="Zoom in"]') && !!document.querySelector('.lkc-ctl .lkc-zb[aria-label="Zoom out"]')), 'help: the + and − buttons stand over the recentre chip');
  const m0 = (await chartState(page)).view.mpp;
  await page.click('.lkc-zb[aria-label="Zoom in"]'); await page.waitForTimeout(500);
  const m1 = (await chartState(page)).view.mpp;
  await page.click('.lkc-zb[aria-label="Zoom out"]'); await page.waitForTimeout(500);
  const m2 = (await chartState(page)).view.mpp;
  check(m1 < m0 * 0.8 && m2 > m1 * 1.3, `help: + zooms in and − zooms out (${m0.toFixed(2)} → ${m1.toFixed(2)} → ${m2.toFixed(2)})`);
  await page.focus('.lkc-zb[aria-label="Zoom in"]');
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Zoom in'), 'help: the buttons take the keyboard focus');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.lk-livechart canvas')).cursor === 'crosshair'), 'help: the crosshair over the map at rest (owner 2026-11-18: the hand only while dragging; mapUx.page.mjs checks the drag)');
  await page.mouse.move(900, 500); await page.mouse.down(); await page.mouse.move(850, 480, { steps: 4 });
  check(await page.evaluate(() => document.querySelector('.lk-livechart').hasAttribute('data-drag') && getComputedStyle(document.querySelector('.lk-livechart canvas')).cursor === 'grabbing'), 'help: grabbing while dragging');
  await page.mouse.up();
  await page.evaluate(() => { document.querySelector('.lkc-hint').textContent = 'seen once'; });
  await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); c.show(false); c.show(true); });
  check(await page.evaluate(() => document.querySelector('.lkc-hint').textContent === 'seen once' && !document.querySelector('.lkc-hint').hasAttribute('data-on')), 'help: the hint shows once, never again after the first open');
  await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); const b = window.__velia.m4.ui.services.get('birthplace'); c.setView({ center: { x: 700, z: -500 }, mpp: 3.5, animate: false }); });

  // a pin tapped is the pick; Sail then starts there
  const at = await pinAt(page, 'fannette');
  await page.mouse.move(at.x, at.y); await page.waitForTimeout(350);
  await page.mouse.click(at.x, at.y); await page.waitForTimeout(500);
  const sel = await chartState(page);
  check(sel.selected === 'bp-fannette' && sel.card?.action === 'Sail from here', `desk: a pin opens its card with one action (${sel.selected}, ${sel.card?.action})`);
  check(await page.evaluate(() => window.__velia.birthplaces.chosen === 'fannette' && window.__velia.birthplaces.current === 'fannette'), 'desk: tapping the pin is the pick');
  check((await ledger(page))[2] === 'Off Fannette', `desk: the float plan's start row follows (${(await ledger(page))[2]})`);
  check(near(await boat(page), PLACE.fannette), `desk: she is at Off Fannette before Sail (${JSON.stringify(await boat(page))})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check((await chartState(page)).card === null && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'home'), 'desk: Esc closes the pin card first; the card stays');

  // Sail: the zoom into the pin, the lake, play
  await page.evaluate(() => {
    window.__zoom = [];
    const root = document.getElementById('lk-load'), c = window.__velia.m4.ui.services.get('liveChart'), t0 = performance.now();
    const f = () => { window.__zoom.push([Math.round(performance.now() - t0), root.dataset.state, +c.state.view.mpp.toFixed(3)]); if (window.__zoom.length < 70) setTimeout(f, 40); };
    f();
  });
  await sailClick(page);
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const z = await page.evaluate(() => window.__zoom), out = z.filter((r) => r[1] === 'out');
  const first = out[0]?.[2], last = out.at(-1)?.[2];
  check(out.length >= 8 && first > last * 1.2 && last <= 1.7, `zoom: on the mode press the map zooms into the pin as the shell fades (${first} → ${last} m/px over ${out.length} samples)`);
  const t = out.find((r) => r[2] <= 1.62)?.[0] ?? 9999, t0 = out[0]?.[0] ?? 0;
  check(t - t0 <= 1100, `zoom: it settles within about a second of the press (${t - t0} ms)`);
  check(near(await boat(page), PLACE.fannette, 120), `play: Sail starts at the picked pin (${JSON.stringify(await boat(page))})`);
  const f0 = await page.evaluate(() => window.__velia.frames); await page.waitForTimeout(1200);
  check(await page.evaluate((f) => window.__velia.frames > f + 10 && !document.documentElement.hasAttribute('data-lake-paused'), f0), 'play: the lake draws on (a desktop never pauses it)');
  check(!(await chartState(page)).shown, 'play: the chart stops when the shell is gone (no frame loop)');

  // Esc: the same screen, the boat clear of the panel
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  const m = await chartState(page), mp = await rect(page, '#lk-load .lk-card'), b = await boat(page);
  const bpx = await page.evaluate(({ x, z }) => window.__velia.m4.ui.services.get('liveChart').toClient(x, z), b);
  check(m.shown && m.mode === 'play' && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'menu'), `menu: Esc opens the same screen over the lake (mode ${m.mode})`);
  check(bpx.x > mp.r + 40 && bpx.x < 1280 - 40 && bpx.y > 40 && bpx.y < 680, `menu: the boat is on the map, clear of the panel (boat at ${bpx.x | 0}, ${bpx.y | 0}; the panel ends at ${mp.r | 0})`);
  check(Math.abs(bpx.x - (mp.r + (1280 - mp.r) / 2)) < 60, `menu: centred in what the panel leaves (${bpx.x | 0} vs ${(mp.r + (1280 - mp.r) / 2) | 0})`);
  check(await page.evaluate(() => document.querySelector('.lk-livechart').hasAttribute('data-glass') && getComputedStyle(document.querySelector('.lk-livechart')).backdropFilter.includes('blur')), 'menu: the water is glass over the live lake (90 %, blurred)');
  const f1 = await page.evaluate(() => window.__velia.frames); await page.waitForTimeout(800);
  check(await page.evaluate((f) => window.__velia.frames > f + 5, f1), 'menu: the lake keeps rendering under the glass on a desktop');

  // a pin in play: Sail from here
  const vk = await pinAt(page, 'vikingsholm');
  await page.mouse.move(vk.x, vk.y); await page.waitForTimeout(300); await page.mouse.click(vk.x, vk.y); await page.waitForTimeout(400);
  check(await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'menu') && (await chartState(page)).card?.action === 'Sail from here', 'menu: a click on a pin opens its card, Sail from here; the menu stays open');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check((await chartState(page)).card === null && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'menu'), 'menu: Esc closes the map\'s card first, the menu stays');
  await page.mouse.click(vk.x, vk.y); await page.waitForTimeout(400);
  await page.click('.lk-livechart .lkc-card .go');
  await page.waitForFunction(() => window.__velia.birthplaces.current === 'vikingsholm', null, { timeout: 15000 });
  await page.waitForTimeout(1800);
  check(near(await boat(page), PLACE.vikingsholm, 140), `menu: Sail from here moves her to Vikingsholm (${JSON.stringify(await boat(page))})`);
  check(await page.evaluate(() => ['gone'].includes(document.getElementById('lk-load').dataset.state) || document.getElementById('lk-load').hasAttribute('data-off')), 'menu: the menu closes so the move is seen');
  check(errors.length === 0, `desk: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- the first visit: one tap ----------------
{
  const { ctx, page, errors } = await open(DESK);
  await sailClick(page);   // one tap
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  check(near(await boat(page), PLACE.tessie, 120), `first visit: one tap (Sail) and she is at Tessie's water (${JSON.stringify(await boat(page))})`);
  check(errors.length === 0, `first visit: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- the panel's go button and float plan (owner, 2026-11-18) ----------------
{
  const { ctx, page, errors } = await open(DESK);
  await page.click('#lk-load .lk-pick[data-mode=cruise]'); await page.waitForTimeout(300);
  const sel = await page.evaluate(() => ({ st: document.getElementById('lk-load').dataset.state, lit: document.querySelector('#lk-load .lk-pick[aria-checked=true]')?.dataset.mode }));
  check(sel.st === 'home' && sel.lit === 'cruise', `go: a mode press on the panel selects it and stays on the entrance (${JSON.stringify(sel)})`);
  await page.click('#lk-load .lk-pick[data-mode=sail]'); await page.waitForTimeout(200);
  // the conditions plate: the one conditions row (owner, 2026-11-20) opens it beside the panel (Time of day, Weather, Wind); Esc closes it first
  await page.click('#lk-load .lk-ledger [data-lr=cond]'); await page.waitForTimeout(400);
  const pl = await page.evaluate(() => { const p = document.querySelector('#lk-load .lk-cond'), c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(), b = p?.getBoundingClientRect();
    return { shown: !!p && !p.hidden, left: b ? b.left - c.right : null, groups: [...(p?.querySelectorAll('.seg') ?? [])].map((g) => g.getAttribute('aria-label')), times: [...(p?.querySelectorAll('[data-pc^="time:"]') ?? [])].map((t) => t.textContent),
      expanded: document.querySelector('#lk-load [data-lr=cond]').getAttribute('aria-expanded') }; });
  check(pl.shown && pl.left >= 0 && pl.left < 30 && pl.groups.join() === 'Time of day,Weather,Wind' && pl.times.join() === 'Dawn,Midday,Golden,Night' && pl.expanded === 'true', `plate: the conditions row opens the quick picks beside the panel (${JSON.stringify(pl)})`);
  const h0 = await page.evaluate(() => window.__velia.m4.ui.services.get('conditions').hour());
  await page.click('#lk-load .lk-cond [data-pc="time:night"]'); await page.waitForTimeout(1500);
  const h1 = await page.evaluate(() => window.__velia.m4.ui.services.get('conditions').hour());
  check(((h1 % 24) + 24) % 24 > 22 && ((h1 % 24) + 24) % 24 < 23, `plate: Night sets the clock before she sails (${h0.toFixed(2)} → ${h1.toFixed(2)})`);
  check(/22:3\d( ·|$)/.test((await ledger(page))[3]), `plate: the conditions row reads the new time (${(await ledger(page))[3]})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector('#lk-load .lk-cond').hidden && document.getElementById('lk-load').dataset.state === 'home'), 'plate: Esc closes the plate first; the panel stays');
  // phase 0: every row opens the same side plate; one at a time; captions on the groups
  const plate = () => page.evaluate(() => { const p = document.querySelector('#lk-load .lk-cond'), c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(), b = p?.getBoundingClientRect();
    return { shown: !!p && !p.hidden, kind: p?.dataset.kind ?? null, left: b ? b.left - c.right : null, caps: [...(p?.querySelectorAll('.cap') ?? [])].map((x) => x.textContent), cells: [...(p?.querySelectorAll('[data-pc]') ?? [])].map((x) => `${(x.querySelector('.nm') ?? x).textContent.trim()}${x.disabled ? '(off)' : ''}${x.getAttribute('aria-checked') === 'true' ? '*' : ''}`),
      open: [...document.querySelectorAll('#lk-load .lk-ledger .lr[aria-expanded=true]')].map((x) => x.dataset.lr) }; });
  await page.click('#lk-load .lk-ledger [data-lr=cond]'); await page.waitForTimeout(300);
  const pc = await plate();
  check(pc.kind === 'cond' && pc.caps.join() === 'Time of day,Weather,Wind', `plates: the conditions plate wears its captions (${pc.caps.join()})`);
  await page.click('#lk-load .lk-ledger [data-lr=waters]'); await page.waitForTimeout(300);
  const pw = await plate();
  check(pw.kind === 'cond' && pw.open.join() === 'cond', `plates: the waters label opens no plate (owner, 2026-11-20: one lake) (${JSON.stringify(pw)})`);
  await page.click('#lk-load .lk-ledger [data-vb=halcyon]'); await page.waitForTimeout(300);   //: the vessel row is two buttons (no plate)
  const vb = await page.evaluate(() => [...document.querySelectorAll('#lk-load .lk-ledger [data-lr=vessel] [data-vb]')].map((b) => `${b.textContent.trim()}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`));
  check(!(await plate()).shown && vb.join() === 'Halcyon*,Tessie', `the vessel row: Halcyon | Tessie, Halcyon chosen; a press closes the open plate and opens none (${vb.join('|')})`);
  await page.click('#lk-load .lk-ledger [data-lr=cond]'); await page.waitForTimeout(300);
  await page.mouse.click(900, 400); await page.waitForTimeout(250);
  check(!(await plate()).shown && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'home'), 'plates: a click outside closes the plate');
  // the start row: a pick selects its pin like a click (the entrance picks it); no start
  await page.click('#lk-load .lk-ledger [data-lr=place]'); await page.waitForTimeout(300);
  const ps = await plate();
  check(ps.kind === 'start' && ps.cells.length === 6 && ps.cells.includes('Off Ski Run') && ps.cells.includes("Tessie's water*") && !ps.cells.includes('Surprise me'), `plates: the Start plate lists the birthplaces, no Surprise me (${ps.cells.join('|')})`);
  await page.click('#lk-load .lk-cond [data-pc="start:fannette"]'); await page.waitForTimeout(900);
  const afterPick = await page.evaluate(() => ({ sel: window.__velia.m4.ui.services.get('liveChart').state.selected, chosen: window.__velia.m4.ui.services.get('birthplace').chosen, st: document.getElementById('lk-load').dataset.state }));
  check(afterPick.sel === 'bp-fannette' && afterPick.chosen === 'fannette' && afterPick.st === 'home' && !(await plate()).shown, `plates: a Start pick selects and lights its pin, closes the plate and does not start (${JSON.stringify(afterPick)})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click('#lk-load .lk-ledger [data-lr=place]'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(!(await plate()).shown && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'home'), 'plates: Esc closes the Start plate first');
  // Set sail: the first visit's one press; the mode is remembered
  await page.click('#lk-load .lk-go');
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1')).lastMode === 'sail'), 'go: Set sail enters the selected mode and remembers it (settings lastMode)');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  const rs = await page.evaluate(() => ({ st: document.getElementById('lk-load').dataset.state, go: document.querySelector('#lk-load .lk-go')?.innerText.trim(), focus: document.activeElement?.classList.contains('lk-go') }));
  check(rs.st === 'menu' && /^resume$/i.test(rs.go) && rs.focus, `menu: Resume stands where Set sail was and takes the focus (${JSON.stringify(rs)})`);
  await page.click('#lk-load .lk-go'); await page.waitForTimeout(800);
  check(await page.evaluate(() => !window.__velia.m4.front.home.isOpen), 'menu: Resume goes back to the lake');
  // the cockpit's chart dial opens the same screen (owner, 2026-11-18)
  const dial = await page.evaluate(() => { const b = document.querySelector('.lk-inst[data-k=chart]'); if (!b) return false; b.click(); return true; });
  await page.waitForTimeout(1200);
  check(dial && await page.evaluate(() => window.__velia.m4.front.home.isOpen && window.__velia.m4.ui.services.get('liveChart').state.mode === 'play' && !window.__velia.m4.ui.services.get('chart')?.chart?.toggle?.pinned), 'dial: a click on the chart dial opens the live map with the panel (the menu), not the old enlarged chart');
  check(errors.length === 0, `go: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- Sail from here enters (owner, 2026-11-19): a click selects, the card's button, Enter and a double click start ----------------
for (const how of ['button', 'dblclick', 'keyboard']) {
  const { ctx, page, errors } = await open(DESK);
  const state = () => page.evaluate(() => ({ st: document.getElementById('lk-load').dataset.state, mode: window.__velia?.mode?.now?.() ?? null }));
  await page.click('#lk-load .lk-pick[data-mode=cruise]'); await page.waitForTimeout(300);   // selects cruise, does not start
  await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); c.setView({ center: { x: 700, z: -500 }, mpp: 3.5, animate: false }); });
  const at = await pinAt(page, 'fannette');
  if (how === 'dblclick') { await page.mouse.dblclick(at.x, at.y); }
  else {
    await page.mouse.move(at.x, at.y); await page.waitForTimeout(300); await page.mouse.click(at.x, at.y); await page.waitForTimeout(500);
    const one = await state();
    check(one.st === 'home' && (await chartState(page)).card?.action === 'Sail from here' && await page.evaluate(() => window.__velia.birthplaces.chosen === 'fannette'), `enter/${how}: a single click selects the pin and opens its card, nothing starts (${JSON.stringify(one)})`);
    check((await ledger(page))[2] === 'Off Fannette', `enter/${how}: the start row follows (${(await ledger(page))[2]})`);
    if (how === 'button') await page.click('.lk-livechart .lkc-card .go');
    else { await page.waitForFunction(() => document.activeElement?.classList.contains('go') && !!document.activeElement.closest('.lkc-card'), null, { timeout: 4000 }); await page.keyboard.press('Enter'); }
  }
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  const end = await state();
  check(end.mode === 'cruise' && near(await boat(page), PLACE.fannette, 120), `enter/${how}: it starts at Off Fannette in the selected mode (${JSON.stringify(end)}, ${JSON.stringify(await boat(page))})`);
  check(errors.length === 0, `enter/${how}: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}
// in play: a double click on a pin is Sail from here (the move, the menu closes)
{
  const { ctx, page, errors } = await open(DESK);
  await sailClick(page);
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  const vk = await pinAt(page, 'vikingsholm');
  await page.mouse.dblclick(vk.x, vk.y);
  await page.waitForFunction(() => window.__velia.birthplaces.current === 'vikingsholm', null, { timeout: 15000 });
  await page.waitForTimeout(1800);
  check(near(await boat(page), PLACE.vikingsholm, 140), `menu: a double click on a pin moves her there (${JSON.stringify(await boat(page))})`);
  check(await page.evaluate(() => ['gone'].includes(document.getElementById('lk-load').dataset.state) || document.getElementById('lk-load').hasAttribute('data-off')), 'menu: and the menu closes');
  check(errors.length === 0, `menu dblclick: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- the keyboard ----------------
{
  const { ctx, page, errors } = await open(DESK);
  await page.evaluate(() => document.querySelector('#lk-load .lk-pick[data-mode=sail]').focus());
  check(await page.evaluate(() => document.activeElement?.dataset?.mode === 'sail'), 'keys: the mode cells take the focus');
  await page.focus('.lk-livechart');
  check(await page.evaluate(() => document.activeElement?.classList.contains('lkc')), 'keys: the map is a tab stop');
  await page.keyboard.press('Tab'); await page.waitForTimeout(250);
  const walked = (await chartState(page)).focus;
  check(!!walked, `keys: Tab on the map walks its points (${walked})`);
  await page.keyboard.press('Tab'); await page.waitForTimeout(150);
  check((await chartState(page)).focus !== walked, 'keys: the next Tab goes to the next point');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  check((await chartState(page)).card != null, 'keys: Enter on a point opens its card');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check((await chartState(page)).card === null && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'home'), 'keys: Esc closes the card first');
  const v0 = (await chartState(page)).view;
  await page.focus('.lk-livechart'); await page.keyboard.press('Equal'); await page.waitForTimeout(500);
  check((await chartState(page)).view.mpp < v0.mpp * 0.8, 'keys: + zooms the map from the keyboard');
  check(errors.length === 0, `keys: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- reduced motion: a cut ----------------
{
  const { ctx, page } = await open({ ...DESK, reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.__zoom = [];
    const root = document.getElementById('lk-load'), c = window.__velia.m4.ui.services.get('liveChart');
    const f = () => { window.__zoom.push([root.dataset.state, +c.state.view.mpp.toFixed(3)]); if (window.__zoom.length < 30) setTimeout(f, 30); };
    f();
  });
  await sailClick(page);
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  const out = (await page.evaluate(() => window.__zoom)).filter((r) => r[0] === 'out');
  check(out.length > 0 && out.every((r) => r[1] <= 1.7), `reduced motion: the zoom is a cut (${out.slice(0, 3).map((r) => r[1]).join(', ')})`);
  await ctx.close();
}

// ---------------- ?livechart=0: today's card ----------------
{
  const { ctx, page, errors } = await open(DESK, '?mode=sail&hour=15&seed=1&attract=0&livechart=0', { live: false });
  const r = await page.evaluate(() => ({ host: !!document.querySelector('.lk-livechart'), mini: !!document.querySelector('#lk-load .lk-bp .lk-bp-plate'), attr: document.documentElement.dataset.mapCard ?? null, w: document.querySelector('#lk-load .lk-card').getBoundingClientRect().width }));
  check(!r.host && r.mini && r.attr === null && r.w > 400, `?livechart=0: today's card with its mini chart, no live chart (${JSON.stringify(r)})`);
  check(errors.length === 0, `?livechart=0: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- the panel's grouping at three sizes (owner, 2026-11-18); every pin named ----------------
const stack = (page) => page.evaluate(() => {
  const r = (q) => { const e = document.querySelector(q); const b = e?.getBoundingClientRect(); return b && b.width ? { t: b.top, b: b.bottom } : null; };
  const links = [...document.querySelectorAll('#lk-load .lk-links > .lk-link')].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect());
  return { by: r('#lk-load .lk-hero'), sum: r('#lk-load .lk-ledger'), plan: r('#lk-load .lk-row.plan'), linkT: Math.min(...links.map((l) => l.top)), linkB: Math.max(...links.map((l) => l.bottom)), foot: r('#lk-load .lk-foot'), h: innerHeight };
});
const grouped = (g) => g.by.b <= g.sum.t && g.sum.b <= g.plan.t && g.plan.b <= g.linkT && g.linkB <= g.foot.t && g.foot.b <= g.h && g.foot.b > g.h - 70 && g.sum.t - g.by.b < 70 && g.linkT - g.plan.b < 60;
for (const [w, h] of [[1280, 720], [1920, 1080], [1280, 650]]) {
  const { ctx, page, errors } = await open({ viewport: { width: w, height: h } });
  const g = await stack(page), st = await chartState(page);
  check(grouped(g), `${w}×${h}: the header, the float plan, the pill, Set sail and SETUP KEYS TUTORIAL LOGBOOK are one block under it, nothing overlaps, the foot is at the bottom (${JSON.stringify(g)})`);
  const row1 = await page.evaluate(() => { const r = [...document.querySelectorAll('#lk-load .lk-links > .lk-link:not(.lk-go)')].filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect()), c = document.querySelector('#lk-load .lk-card').getBoundingClientRect();
    return { n: r.length, one: r.every((x) => Math.abs(x.top - r[0].top) < 2 && x.height <= 44), inside: r.every((x) => x.left >= c.left && x.right <= c.right) }; });
  check(row1.n === 4 && row1.one && row1.inside, `${w}×${h}: the four extras fit one row inside the panel, no wrap (${JSON.stringify(row1)})`);
  // the all-birthplaces view (owner, 2026-11-24): every pin drawn and pickable; a crowded bay pin may lose its label but is named on hover
  // and once zoomed to the bay; the region names and Off Ski Run stay labelled at the default view
  const ALL = ['tessie', 'fannette', 'vikingsholm', 'narrows', 'lake', 'ski-run'];
  const lab = (s2, id) => s2.labels.find((l) => l.id === id);
  check(ALL.every((id) => st.pois.some((p) => p.id === `bp-${id}` && p.px >= 0 && p.px <= w && p.py >= 0 && p.py <= h)), `${w}×${h}: all six pins drawn in the view (${st.pois.filter((p) => p.kind === 'birthplace').map((p) => p.id).join(', ')})`);
  check(['n-bp-ski-run', 'n-tahoe', 'n-south-lake'].every((id) => lab(st, id)?.shown && lab(st, id).alpha > 0.5), `${w}×${h}: Off Ski Run, Lake Tahoe and South Lake Tahoe labelled at the default view (${['n-bp-ski-run', 'n-tahoe', 'n-south-lake'].map((id) => `${id}:${lab(st, id)?.shown}`).join(' ')})`);
  const hovers = [];
  for (const id of ALL.map((q) => `bp-${q}`)) {
    const at = await page.evaluate((id) => { const c = window.__velia.m4.ui.services.get('liveChart'); const p = c.state.pois.find((q) => q.id === id); if (!p) return null; const r = c.el.getBoundingClientRect(); return { x: r.left + p.px, y: r.top + p.py }; }, id);
    if (!at) { hovers.push(`${id}:none`); continue; }
    await page.mouse.move(at.x, at.y); await page.waitForTimeout(450);
    const s2 = await chartState(page), nid = `n-${id}`;
    hovers.push(`${id}:${s2.hover === id && (lab(s2, nid)?.alpha ?? 0) > 0.5 ? 'ok' : `hover=${s2.hover} a=${lab(s2, nid)?.alpha}`}`);
  }
  await page.mouse.move(w - 5, h - 5); await page.waitForTimeout(300);
  check(hovers.every((x) => x.endsWith(':ok')), `${w}×${h}: every pin is pickable and named on hover (Fannette Island, a place, is drawn and named from the bay's zoom) (${hovers.join(' ')})`);
  await page.evaluate(() => window.__velia.m4.ui.services.get('liveChart').setView({ center: { x: 250, z: -350 }, mpp: 3.2, animate: false })); await page.waitForTimeout(900);
  const sz = await chartState(page), bayNames = ['n-bp-tessie', 'n-bp-fannette', 'n-bp-vikingsholm', 'n-bp-narrows', 'n-fannette'];
  check(bayNames.every((id) => lab(sz, id)?.shown && lab(sz, id).alpha > 0.5), `${w}×${h}: zoomed to the bay (3.2 m/px) the bay's pins and Fannette Island are labelled (${bayNames.map((id) => `${id}:${lab(sz, id)?.shown}`).join(' ')})`);
  if (h === 650) {
    await sailClick(page); await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 }); await page.waitForTimeout(3000);
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    const gm = await stack(page);
    check(grouped(gm), `${w}×${h}: the in-game menu is the same (${JSON.stringify(gm)})`);
    check(await page.evaluate(() => document.querySelector('.lkc-fact')?.hidden === true), `${w}×${h}: no lake fact in the in-game menu (the entrance only)`);
  }
  check(errors.length === 0, `${w}×${h}: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- phones: layout A with the chart in the left box ----------------
for (const [w, h] of [[844, 390], [667, 375]]) {
  const { ctx, page, errors } = await open(phone(w, h));
  const s = await chartState(page), box = await rect(page, '.lk-livechart'), sail = await rect(page, '#lk-load .lk-pick[data-mode=sail]');
  check(await page.evaluate(() => document.documentElement.dataset.mapCard === 'box' && document.documentElement.dataset.fPhoneCard === 'on'), `${w}×${h}: the phone card (layout A) with the chart in its box`);
  check(s.shown && s.mode === 'entrance' && !!box && box.w >= 200 && box.l >= 8 && box.r <= sail.l && box.t >= 60 && box.b <= h, `${w}×${h}: the map sits in the left box clear of the thumb column (${JSON.stringify(box)}; Sail starts at ${sail?.l | 0})`);
  check(sail.h >= 44 && sail.h <= 56 && sail.w >= 120 && sail.w <= 180, `${w}×${h}: Sail is a compact pill sized to its word (owner 2026-11-19: "too big"; ${sail.w | 0}×${sail.h | 0})`);
  // one chart on the card (owner 2026-11-19: "two layers of chart"): no N3 engraving, light or neatlines behind the live map
  check(await page.evaluate(() => { const c = document.querySelector('#lk-load .lk-card'), vis = (e) => !!e && getComputedStyle(e).display !== 'none';
    return !vis(c.querySelector(':scope > .lk-art-n')) && !vis(c.querySelector(':scope > .lk-art')) && getComputedStyle(c, '::before').display === 'none' && getComputedStyle(c, '::after').display === 'none'; }), `${w}×${h}: one chart on the card (no engraved art or neatlines behind the map)`);
  const zr = await rect(page, '.lkc-zb[aria-label="Zoom in"]');
  check(zr && zr.w >= 44 && zr.h >= 44, `${w}×${h}: the + and − buttons are thumb size (${zr?.w | 0}×${zr?.h | 0})`);
  check(await page.evaluate(() => document.querySelector('.lkc-hint').textContent === 'Pinch to zoom · drag to move'), `${w}×${h}: the hint says "Pinch to zoom · drag to move"`);
  check(!(await rect(page, '.lk-livechart .lkc-surprise')), `${w}×${h}: no Surprise me button on the map`);
  // the day's lake fact: the chart's caption under the box, one line, on the card, clear of the thumb column
  const pf = await page.evaluate(() => { const f = document.querySelector('#lk-load .lk-card > .lkc-fact'), c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(), b = f?.getBoundingClientRect();
    return f && { l: b.left, t: b.top, r: b.right, b: b.bottom, shown: !f.hidden && f.getClientRects().length > 0, one: f.scrollWidth <= f.clientWidth + 1, text: f.textContent, cb: c.bottom }; });
  check(pf && pf.shown && pf.one && pf.t >= box.b && pf.b <= pf.cb && Math.abs(pf.l - box.l) <= 2 && pf.r <= sail.l, `${w}×${h}: the lake fact is the map's caption, under it on one line (${JSON.stringify(pf)})`);
  const pins = s.pois.filter((p) => p.kind === 'birthplace');   // every birthplace, Off Ski Run clear of the box's right column (layers, + and −)
  check(pins.length === 6 && pins.every((p) => p.px >= 0 && p.px <= box.w - 56 && p.py >= 0 && p.py <= box.h), `${w}×${h}: all six pins are in the box, clear of its buttons (${pins.map((p) => `${p.id}@${p.px | 0},${p.py | 0}`).join(' ')})`);
  // a pin then Sail (two taps); the first visit's one tap is checked on desktop and below
  const at = await pinAt(page, 'narrows');
  await page.touchscreen.tap(at.x, at.y); await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__velia.birthplaces.chosen === 'narrows') && /narrows/i.test(await voyage(page)), `${w}×${h}: a tap on a pin picks it (${await voyage(page)})`);
  await sailClick(page, true);
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  check(near(await boat(page), [800, -910], 120), `${w}×${h}: Sail (the second tap) starts at The narrows (${JSON.stringify(await boat(page))})`);
  // in play: the menu map is opaque, the lake sleeps; a pin, then Sail from here
  await page.evaluate(() => window.__velia.m4.front.home.open()); await page.waitForTimeout(1200);
  const m = await chartState(page);
  check(m.shown && m.mode === 'play' && await page.evaluate(() => !document.querySelector('.lk-livechart').hasAttribute('data-glass') && document.documentElement.hasAttribute('data-lake-paused')), `${w}×${h}: in play the menu map is opaque and the lake is paused`);
  const f0 = await page.evaluate(() => window.__velia.frames); await page.waitForTimeout(700);
  check(await page.evaluate((f) => window.__velia.frames <= f + 1, f0), `${w}×${h}: no lake frames are drawn while the menu is up`);
  await page.evaluate(() => { const r = window.__velia.m4.ui.services.get('birthplace').list().find((q) => q.id === 'tessie'); window.__velia.m4.ui.services.get('liveChart').setView({ center: { x: r.x, z: r.z }, mpp: 3.5, animate: false }); });
  await page.waitForTimeout(300);
  const tp = await pinAt(page, 'tessie');
  await page.touchscreen.tap(tp.x, tp.y); await page.waitForTimeout(500);
  const card = await rect(page, '.lk-livechart .lkc-card .go');
  check(!!card && card.h >= 44 && (await chartState(page)).card?.action === 'Sail from here', `${w}×${h}: a tap on a pin shows its card; Sail from here is 44 px or more (${card?.h | 0})`);
  await page.touchscreen.tap(card.l + card.w / 2, card.t + card.h / 2);
  await page.waitForFunction(() => window.__velia.birthplaces.current === 'tessie', null, { timeout: 15000 });
  await page.waitForTimeout(2000);
  check(near(await boat(page), PLACE.tessie, 140), `${w}×${h}: Sail from here moves her to Tessie's water (${JSON.stringify(await boat(page))})`);
  check(await page.evaluate(() => !document.documentElement.hasAttribute('data-lake-paused')), `${w}×${h}: the lake wakes when the menu closes`);
  check(errors.length === 0, `${w}×${h}: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- the race pins (owner 2026-11-19: only in Regatta): the Races layer, a pin's card, Race here ----------------
{
  const { ctx, page, errors } = await open(DESK, '?mode=sail&hour=15&seed=1&attract=0&chartground=webp&tessie=1');
  await sailClick(page);
  await page.waitForFunction(() => window.__velia?.birthplaces?.current, null, { timeout: 60000 });
  await page.waitForTimeout(3500);
  const menu = () => page.evaluate(() => window.__velia.m4.ui.services.get('menu').open());
  const pinsNow = () => page.evaluate(() => ({ pins: window.__velia.m4.ui.services.get('liveChart').state.pois.filter((p) => p.kind === 'racePin').map((p) => p.id).sort(),
    bar: [...document.querySelectorAll('.lkc-layers button')].map((b) => b.dataset.layer).join() }));
  await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
  let s = await pinsNow();
  check(s.pins.length === 0 && s.bar === 'all,places,anchorages,marks,wildlife,wake', `pins: in Sail there are no race pins and no Races layer (${s.pins.length} pins; bar ${s.bar})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  // into Regatta (no hub), then the menu: the pins and the layer
  await page.evaluate(() => window.__velia.mode.go('regatta', { hub: false, deal: false }));
  await page.waitForFunction(() => window.__velia.regatta?.r?.on, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await menu(); await page.waitForTimeout(1500);
  s = await pinsNow();
  check(['rp-pass-the-channel', 'rp-tea-house-run', 'rp-tessies-deep'].every((id) => s.pins.includes(id)) && s.pins.every((id) => id.startsWith('rp-')) && s.bar === 'all,places,races,anchorages,marks,wildlife,wake', `pins: in Regatta each place race has its pin and the bar a Races layer (${s.pins}; ${s.bar})`);
  await page.click('.lkc-layers button[data-layer=places]'); await page.waitForTimeout(400);
  check((await pinsNow()).pins.length === 0, 'pins: a layer shown alone hides the race pins');
  await page.click('.lkc-layers button[data-layer=all]'); await page.waitForTimeout(400);
  const q = await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'), p = c.state.pois.find((x) => x.id === 'rp-tea-house-run'), r = document.querySelector('.lk-livechart canvas').getBoundingClientRect(); return { x: r.left + p.px, y: r.top + p.py }; });
  await page.mouse.move(q.x, q.y); await page.waitForTimeout(300); await page.mouse.click(q.x, q.y); await page.waitForTimeout(500);
  const card = await page.evaluate(() => ({ s: window.__velia.m4.ui.services.get('liveChart').state.card, line: document.querySelector('.lkc-card .w')?.textContent ?? '' }));
  check(card.s?.name === 'Tea House Run' && card.s.action === 'Race here' && /\d\.\d\d km · about \d min/.test(card.line), `pins: a click on a pin opens its card: name, length, minutes, Race here (${JSON.stringify(card)})`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/race-pin-card.png` });
  await page.click('.lk-livechart .lkc-card .go');
  await page.waitForFunction(() => window.__velia.regatta?.r?.placeRace?.id === 'tea-house-run', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  const race = await page.evaluate(() => { const R = window.__velia.regatta.r; return { on: R.on, hub: !!R.hubOpen, rivals: R.session?.rivals?.length ?? null, menu: document.getElementById('lk-load').dataset.state, mode: window.__velia._stats().mode }; });
  check(race.on && !race.hub && race.rivals === 4 && race.mode === 'regatta' && race.menu !== 'menu', `pins: Race here starts Tea House Run in Regatta, no hub, the menu closed (${JSON.stringify(race)})`);
  check(errors.length === 0, `pins: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nmapCard: all pass');
process.exit(fails ? 1 : 0);
