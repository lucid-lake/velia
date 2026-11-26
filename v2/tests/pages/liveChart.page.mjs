// The live chart on the real v2 page (on by default since Phase 2b) (Phase 2a; v2/ui/chart/liveChart.js), 1280 × 720, mouse:
//   open      N opens the menu, the same screen (Phase 2b): the full-window chart behind the panel in place of the enlarged one; the ground
//             drawn (the shipped WebP under ?chartground=webp); the view follows the boat, centred in what the panel leaves
//   zoom      the wheel zooms about the pointer (the world point under it stays), + zooms in, 1 is the whole bay
//   pan       a drag pans and un-follows the boat; the ⌖ chip shows; a click on it follows again
//   hover     the pointer over a pin rings it and lifts its name
//   select    a click opens the small card with one action, "Sail from here"; Esc closes the card first, the chart stays
//   sail      "Sail from here" moves her to Vikingsholm under the veil and the chart closes
//   cost      the dynamic layer's p95 under 1.5 ms a frame; one touch read a draw (a work count)
// Run by `npm run test:pages:v2 -- liveChart` (LAKESHORE_BASE set), or node v2/tests/pages/liveChart.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&chartground=webp`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front?.birthplaceCard, null, { timeout: 240000 });
await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait', null, { timeout: 240000 });
await page.waitForTimeout(600);
await pickMode(page, 'sail');   // the panel: Set sail starts the selected mode (owner, 2026-11-18)
await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 60000 });
await page.waitForTimeout(1000);

const lc = (f) => page.evaluate(f);
const st = () => lc(() => window.__velia.m4.ui.services.get('liveChart')?.state ?? null);
await page.keyboard.press('KeyN');   // N opens the menu: the same screen (Phase 2b); the chart takes the keys once it is focused
await page.waitForFunction(() => { const l = window.__velia.m4.ui.services.get('liveChart'); return l?.shown && l.state.ground !== 'none' && l.state.mode === 'play'; }, null, { timeout: 30000 });
await page.focus('.lk-livechart');
await page.waitForTimeout(400);
let s = await st();
check(s && s.w === 1280 && s.h === 720 && s.ground === 'webp', `open: the full-window chart, its ground drawn (${s?.w}×${s?.h}, ${s?.ground})`);
check(await lc(() => getComputedStyle(document.querySelector('.lk-chart .big')).display === 'none'), 'open: the old enlarged chart is not shown');
const b0 = await lc(() => { const b = window.__velia.boat.state; return { x: b.x, z: b.z }; });
check(s.following && Math.hypot(s.view.cx + (s.insets.left / 2) * s.view.mpp - b0.x, s.view.cz - b0.z) < 30, `open: the view follows the boat, centred in what the panel leaves (${s.view.cx.toFixed(0)}, ${s.view.cz.toFixed(0)} vs ${b0.x.toFixed(0)}, ${b0.z.toFixed(0)}; inset ${s.insets.left})`);

// zoom: the wheel about the pointer
const before = await lc(() => { const l = window.__velia.m4.ui.services.get('liveChart'), v = l.state.view; return { mpp: v.mpp, wx: v.cx + (900 - 640) * v.mpp, wz: v.cz + (250 - 360) * v.mpp }; });
await page.mouse.move(900, 250);
await page.mouse.wheel(0, -300); await page.waitForTimeout(500);
s = await st();
const under = { x: s.view.cx + (900 - 640) * s.view.mpp, z: s.view.cz + (250 - 360) * s.view.mpp };
check(s.view.mpp < before.mpp * 0.6 && Math.hypot(under.x - before.wx, under.z - before.wz) < 3 * s.view.mpp, `zoom: the wheel zooms in about the pointer (${before.mpp.toFixed(2)} → ${s.view.mpp.toFixed(2)} m/px; the point under it moved ${Math.hypot(under.x - before.wx, under.z - before.wz).toFixed(1)} m)`);
check(!s.following, 'zoom: a zoom about the pointer leaves the boat');
await page.focus('.lk-livechart'); await page.keyboard.press('Digit1'); await page.waitForTimeout(450);
s = await st();
check(Math.abs(s.view.mpp - s.zoom.max) < 0.01 || Math.abs(s.view.mpp - 6.5) < 0.01, `zoom: 1 is the whole bay (${s.view.mpp.toFixed(2)} m/px)`);
await page.keyboard.press('Equal'); await page.waitForTimeout(450);
const s2 = await st();
check(s2.view.mpp < s.view.mpp * 0.75, `zoom: + zooms in (${s.view.mpp.toFixed(2)} → ${s2.view.mpp.toFixed(2)})`);
const bayNames = s.labels.filter((l) => l.shown).map((l) => l.id);
check(['n-bay', 'n-fannette', 'n-tahoe'].every((n) => bayNames.includes(n)) && !bayNames.includes('n-beach'), `names: the whole bay shows the class A names and no class C (${bayNames.join(', ')})`);

// pan: a drag, the chip, back to the boat
await page.keyboard.press('Home'); await page.waitForTimeout(500);
const p0 = (await st()).view;
await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(600, 380, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
s = await st();
check(!s.following && Math.abs(s.view.cx - (p0.cx + 100 * p0.mpp)) < 2 * p0.mpp, `pan: the drag moves the map with the hand (${(s.view.cx - p0.cx).toFixed(0)} m east)`);
check(await lc(() => !document.querySelector('.lk-livechart .lkc-rc').hidden), 'pan: the ⌖ chip shows while off the boat');
await page.click('.lk-livechart .lkc-rc'); await page.waitForTimeout(600);
s = await st();
check(s.following && await lc(() => document.querySelector('.lk-livechart .lkc-rc').hidden), 'pan: the chip follows the boat again and goes');

// hover and select a pin: Vikingsholm
await lc(() => window.__velia.m4.ui.services.get('liveChart').setView({ center: { x: -200, z: 120 }, mpp: 3, animate: false }));
await page.waitForTimeout(300);
const at = await lc(() => window.__velia.m4.ui.services.get('liveChart').toClient(-220, 220));
await page.mouse.move(at.x + 3, at.y - 2); await page.waitForTimeout(450);
s = await st();
const name = s.labels.find((l) => l.id === 'n-bp-vikingsholm');
check(s.hover === 'bp-vikingsholm' && name?.alpha > 0.9, `hover: the pin rings and its name is up (${s.hover}, name ${name?.alpha})`);
await page.mouse.click(at.x + 3, at.y - 2); await page.waitForTimeout(350);
s = await st();
check(s.card?.name === 'Vikingsholm' && s.card.action === 'Sail from here', `select: the small card with one action (${JSON.stringify(s.card)})`);
await page.keyboard.press('Escape'); await page.waitForTimeout(250);
s = await st();
check(!s.card && await lc(() => window.__velia.m4.ui.services.get('liveChart').shown), 'select: Esc closes the card first; the chart stays');
await page.mouse.click(at.x + 3, at.y - 2); await page.waitForTimeout(300);
const stats = await lc(() => window.__velia.m4.ui.services.get('liveChart').stats());
await page.click('.lk-livechart .lkc-card .go');
await page.waitForFunction(() => window.__velia.birthplaces.current === 'vikingsholm', null, { timeout: 15000 });
await page.waitForTimeout(1500);
const b1 = await lc(() => { const b = window.__velia.boat.state; return { x: b.x, z: b.z }; });
check(Math.hypot(b1.x + 220, b1.z - 220) < 120, `sail: Sail from here moves her to Vikingsholm (${b1.x.toFixed(0)}, ${b1.z.toFixed(0)})`);
check(await lc(() => !window.__velia.m4.ui.services.get('liveChart').shown && !window.__velia.m4.ui.services.get('chart').chart.toggle.pinned), 'sail: the chart closes so the move is seen');
check(stats.touchReadsMax <= 1 && stats.touchReads < stats.draws, `cost: one touch read a draw at most, fewer reads than draws (${stats.touchReads} reads in ${stats.draws} draws; most ${stats.touchReadsMax})`);   // a work count: gated always
check(stats.draws > 10 && stats.drawMsP95 < 1.5, `cost: ${stats.draws} draws, p95 ${stats.drawMsP95} ms, max ${stats.drawMsMax} ms (budget 1.5 ms)`);
check(!errors.length, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
