// The birthplaces' UI on the real v2 page (Phase 1b, on the live map since Phase 2b; v2/ui/chart/mapScreen.js, liveChart.js, phoneCard.js):
//   1280 × 720, mouse   the live map behind the panel: five pins (the bay's three, Open lake and South Lake's Off Ski Run, all on the paper) and no Surprise me, the first visit's Off Fannette lit with Tessie's small mark, the voyage line "Emerald
//                       Bay · Halcyon 28 ft · Off Fannette"; hover lifts the name; a click picks Off Fannette (the voyage line updates, she is
//                       there at once) and opens its card, Sail enters and she starts at that birthplace
//   in play             Esc: the same screen: the pins, a click opens the small card, "Sail from here" moves her under the veil, the menu
//                       closes, the logbook has "Moved to Vikingsholm"; Esc closes the card first
//   a race              the menu in a race: Sail from here shows the refusal in plain words and does not move her
//   844 × 390, touch    the phone card (layout A) with the map in its left box: every target and Sail 44 px or more, the ⋯ menu holds the
//                       links, the first visit is one tap (Sail), a pin then Sail is two; in play a pin shows its card, then "Sail from here"
// Run by `npm run test:pages:v2 -- birthplaceUi` (LAKESHORE_BASE set), or node v2/tests/pages/birthplaceUi.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const DESK = { viewport: { width: 1280, height: 720 } };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });

async function open(opt, query = '?mode=sail&hour=15&seed=1&attract=0&chartground=webp') {
  const ctx = await browser.newContext(opt);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front?.birthplaceCard && window.__velia.m4.ui.services.get('mapScreen'), null, { timeout: 240000 });
  await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait', null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}
const boat = (page) => page.evaluate(() => { const s = window.__velia.boat.state; return { x: s.x, z: s.z }; });
// the desktop panel (owner, 2026-11-18): a mode press selects, Set sail enters; the start is the float plan's third row
const enter = (page, mode) => pickMode(page, mode);
const startRow = (page) => page.evaluate(() => document.querySelector('#lk-load .lk-ledger [data-lr=place] .v')?.textContent.trim() ?? null);
const voyage = (page) => page.evaluate(() => document.querySelector('#lk-load .lk-sum').innerText.replace(/\s+/g, ' ').replace(/^Lake and boat: /, '').trim());
const ROW = { fannette: [210, 50], vikingsholm: [-220, 220] };
const near = (b, [x, z], m = 60) => Math.hypot(b.x - x, b.z - z) < m;
const chartState = (page) => page.evaluate(() => { const c = window.__velia.m4.ui.services.get('liveChart'); return { ...c.state, shown: c.shown }; });
const pinAt = (page, id) => page.evaluate((id) => { const r = window.__velia.m4.ui.services.get('birthplace').list().find((q) => q.id === id); return window.__velia.m4.ui.services.get('liveChart').toClient(r.x, r.z); }, id);
const showPin = (page, id, mpp = 3.5) => page.evaluate(({ id, mpp }) => { const r = window.__velia.m4.ui.services.get('birthplace').list().find((q) => q.id === id); window.__velia.m4.ui.services.get('liveChart').setView({ center: { x: r.x, z: r.z }, mpp, animate: false }); }, { id, mpp });

// ---------------- 1280 × 720 ----------------
{
  const { ctx, page, errors } = await open(DESK);
  const s0 = await chartState(page);
  const pins = s0.pois.filter((p) => p.kind === 'birthplace');   // every birthplace in the first view
  const sur = await page.evaluate(() => document.querySelectorAll('.lk-livechart .lkc-surprise, .lk-bp [data-id=random]').length + ([...document.querySelectorAll('#lk-load button')].filter((b) => /surprise/i.test(b.textContent + b.getAttribute('aria-label'))).length));
  check(pins.length === 5 && sur === 0, `desk: five pins on the map and no Surprise me (${pins.map((p) => p.id).join(', ')}; ${sur})`);
  check(await page.evaluate(() => window.__velia.birthplaces.current === 'fannette'), `desk: the first visit's Off Fannette is the lit pin`);
  check(await startRow(page) === 'Off Fannette', `desk: the float plan's start row (${await startRow(page)})`);
  check(pins.filter((p) => p.mark).map((p) => `${p.id}:${p.mark}`).join() === 'bp-fannette:Tessie', `desk: Tessie's small mark rides on the Off Fannette pin alone (${pins.filter((p) => p.mark).map((p) => p.id + ':' + p.mark)})`);
  const at = await pinAt(page, 'fannette');
  await page.mouse.move(at.x, at.y); await page.waitForTimeout(450);
  const hs = await chartState(page), nm = hs.labels.find((l) => l.id === 'n-bp-fannette');
  check(hs.hover === 'bp-fannette' && nm?.alpha > 0.9, `desk: hover rings the pin and lifts its name (${hs.hover}, ${nm?.alpha})`);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(500);
  const sel = await chartState(page);
  check(sel.selected === 'bp-fannette' && sel.card?.name === 'Off Fannette' && sel.card?.action === 'Sail from here', `desk: a click picks Off Fannette and opens its card (${JSON.stringify(sel.card)})`);
  check(await startRow(page) === 'Off Fannette', `desk: the float plan's start row follows (${await startRow(page)})`);
  check(await page.evaluate(() => window.__velia.birthplaces.chosen === 'fannette' && window.__velia.birthplaces.current === 'fannette'), 'desk: chosen and current are Off Fannette (picked on the first card: no veil)');
  check(near(await boat(page), ROW.fannette), `desk: she is at Off Fannette before Sail (${JSON.stringify(await boat(page))})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await enter(page, 'sail');
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  check(near(await boat(page), ROW.fannette, 90), `desk: Sail starts at Off Fannette (${JSON.stringify(await boat(page))})`);

  // in play: Esc opens the same screen; the pin; Sail from here
  await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
  check((await chartState(page)).shown && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'menu'), 'menu: Esc opens the map with the panel');
  await showPin(page, 'vikingsholm', 3); await page.waitForTimeout(300);
  const vk = await pinAt(page, 'vikingsholm');
  check(!!vk && vk.x > 340 && vk.x < 1280, `menu: the pins are on the map (Vikingsholm at ${vk?.x | 0}, ${vk?.y | 0})`);
  await page.mouse.move(vk.x, vk.y); await page.waitForTimeout(300);
  await page.mouse.click(vk.x, vk.y); await page.waitForTimeout(400);
  const card = (await chartState(page)).card;
  check(card?.name === 'Vikingsholm' && card.action === 'Sail from here', `menu: a click opens the pin's card with one action (${JSON.stringify(card)})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check((await chartState(page)).card === null && await page.evaluate(() => document.getElementById('lk-load').dataset.state === 'menu'), 'menu: Esc closes the card first, the menu stays');
  await page.mouse.click(vk.x, vk.y); await page.waitForTimeout(300);
  await page.click('.lk-livechart .lkc-card .go');
  await page.waitForFunction(() => window.__velia.birthplaces.current === 'vikingsholm', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  check(near(await boat(page), ROW.vikingsholm, 120), `menu: Sail from here moves her to Vikingsholm (${JSON.stringify(await boat(page))})`);
  await page.waitForFunction(() => document.getElementById('lk-load').dataset.state === 'gone', null, { timeout: 5000 });
  check(true, 'menu: the menu closes so the move is seen');
  const lines = await page.evaluate(() => window.__velia.m4.ui.services.get('logbook').logbook.lines);
  check(lines.includes('Moved to Vikingsholm'), `logbook: the line "Moved to Vikingsholm" (${JSON.stringify(lines)})`);
  await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('logbook')); await page.waitForTimeout(700);   // the Logbook button (the key L went)
  await page.evaluate(() => { window.__velia.m4.ui.services.get('logbook').logbook.page = 'log'; });
  const shown = await page.evaluate(() => { const n = document.querySelector('.lk-log .legend .note'); return n && !n.hidden ? n.textContent : null; });
  check(/Moved to Vikingsholm/.test(shown ?? ''), `logbook: the chart page's key shows it (${shown})`);
  check(errors.length === 0, `desk: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- a race refuses ----------------
{
  const { ctx, page, errors } = await open(DESK, '?mode=regatta&once=0&seed=1&handseed=7&autoplay=1&autotier=medium&chartground=webp');
  await page.waitForFunction(() => window.__velia.regatta?.r?.on, null, { timeout: 120000 });
  await enter(page, 'regatta');   // into the race, then its Menu card
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__velia.m4.front.home.open(); });
  await page.waitForFunction(() => document.getElementById('lk-load').dataset.state === 'menu', null, { timeout: 10000 });
  await page.waitForTimeout(800);
  const before = await boat(page);
  await showPin(page, 'narrows');
  await page.waitForTimeout(300);
  const at = await pinAt(page, 'narrows');
  await page.mouse.click(at.x, at.y); await page.waitForTimeout(400);
  await page.click('.lk-livechart .lkc-card .go');
  await page.waitForTimeout(600);
  const say = (await chartState(page)).card?.say ?? '';
  check(/Not during a race/.test(say), `race: Sail from here shows the reason in plain words (${say})`);
  const after = await boat(page);
  check(Math.hypot(after.x - before.x, after.z - before.z) < 80, 'race: she did not move');
  check(errors.length === 0, `race: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

// ---------------- 844 × 390, touch ----------------
{
  const { ctx, page, errors } = await open(PHONE);
  const m = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.id ?? b.dataset.mode ?? b.className, Math.round(r.width), Math.round(r.height), r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight]; });
    return { sur: [...document.querySelectorAll('#lk-load button')].filter((b) => /surprise/i.test(b.textContent + b.getAttribute('aria-label'))).length, modes: q('#lk-load .lk-pick'), more: q('#lk-load .lk-pmore'), phone: document.documentElement.dataset.fPhoneCard };
  });
  const s0 = await chartState(page);
  check(m.phone === 'on', 'phone: the phone card is on (feature phoneCard)');
  check(s0.pois.filter((p) => p.kind === 'birthplace').length === 5 && m.sur === 0, `phone: five pins on the map and no Surprise me (${m.sur})`);
  check(m.modes.every(([, w, h, ins]) => w >= 44 && h >= 44 && ins) && m.modes.find((r) => r[0] === 'sail')[2] >= 44 && m.modes.every(([, , h]) => h <= 56), `phone: the modes are compact pills (44 to 56 px; owner 2026-11-19: too big), Sail the tallest (${JSON.stringify(m.modes)})`);
  const links = await page.evaluate(() => getComputedStyle(document.querySelector('#lk-load .lk-links')).display);
  check(links === 'none', 'phone: Chart, Log, Controls, Setup, About and Support are folded away');
  await page.tap('#lk-load .lk-pmore'); await page.waitForTimeout(300);
  const menu = await page.evaluate(() => [...document.querySelectorAll('#lk-load .lk-links .lk-link, #lk-load .lk-links .lk-sup, #lk-load .lk-links .lk-news')].filter((b) => b.getClientRects().length).map((b) => [b.innerText.replace(/\s+/g, ' ').trim(), Math.round(b.getBoundingClientRect().height)]));
  check(menu.length >= 6 && menu.every(([, h]) => h >= 44), `phone: the ⋯ menu lists the links, each 44 px or more (${JSON.stringify(menu)})`);
  await page.tap('#lk-load .lk-pmore'); await page.waitForTimeout(200);
  // a tap on a pin picks it (the first card); a tap on Sail is the second tap
  const nt = await pinAt(page, 'narrows');
  await page.touchscreen.tap(nt.x, nt.y); await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__velia.birthplaces.chosen === 'narrows') && /narrows/i.test(await voyage(page)), `phone: one tap on a pin picks it, the voyage line follows (${await voyage(page)})`);
  const card0 = (await chartState(page)).card;
  check(card0?.name === 'The narrows' && /channel buoys/.test(await page.evaluate(() => document.querySelector('.lk-livechart .lkc-card .w').textContent)), `phone: the tap shows the name and its line, no hover needed (${JSON.stringify(card0)})`);
  await page.tap('#lk-load .lk-pick[data-mode=sail]');
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  check(Math.hypot((await boat(page)).x - 800, (await boat(page)).z + 910) < 90, `phone: Sail (the second tap) starts at The narrows (${JSON.stringify(await boat(page))})`);
  // in play: a pin shows its card, then "Sail from here" moves her
  await page.evaluate(() => window.__velia.m4.front.home.open()); await page.waitForTimeout(900);
  await showPin(page, 'fannette', 4);
  await page.waitForTimeout(300);
  const tt = await pinAt(page, 'fannette');
  await page.touchscreen.tap(tt.x, tt.y); await page.waitForTimeout(400);
  const go = await page.evaluate(() => { const b = document.querySelector('.lk-livechart .lkc-card .go'); const r = b?.getBoundingClientRect(); return b && r.width ? { l: r.left, t: r.top, w: r.width, h: r.height } : null; });
  check(await page.evaluate(() => window.__velia.birthplaces.current === 'narrows') && !!go && go.h >= 44, `phone: in play the first tap shows the place and offers "Sail from here" (44 px: ${go?.h})`);
  await page.touchscreen.tap(go.l + go.w / 2, go.t + go.h / 2);
  await page.waitForFunction(() => window.__velia.birthplaces.current === 'fannette', null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  check(Math.hypot((await boat(page)).x - 210, (await boat(page)).z - 50) < 120, `phone: "Sail from here" moves her Off Fannette (${JSON.stringify(await boat(page))})`);
  check(errors.length === 0, `phone: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nbirthplaceUi: all pass');
process.exit(fails ? 1 : 0);
