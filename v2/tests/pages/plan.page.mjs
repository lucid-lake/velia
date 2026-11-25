// Plan (v2/plan; phase 1) on the real v2 page, 1280 × 720, a mouse:
//   ?mode=plan        the entrance as Sail's; Set sail lands in Plan: the chart page with the boat under way, the card is Plan's bar
//                     (the passage panel open with no passage), the day clock locked to the sim (1 game s per sim s), the wind dial
//                     at the top right, the map's boat drawn at her trim
//   a passage         three clicks on the water lay three corners (the planner's legs, their times); a click on the land is refused
//   the clock         ×16 runs the sim at 16 × real time; the clock slows itself to ×1 at the first corner (the panel says why)
//   the rail          the panel folds itself to the 64 px rail 6 s after the last press
//   the handover      Take the helm: the chart zooms into her (0.9 s), the menu closes, the pilot lets go with no jump of heading,
//                     place or clock, the plate names the leg; N brings the chart back with the pilot on the passage, from where she is
// Run by `node tools/test_pages.mjs --app v2 plan.page` (LAKESHORE_BASE set), or node v2/tests/pages/plan.page.mjs --base http://127.0.0.1:<port>
//   [--shots <dir>]: the three stills (the rail folded with a passage under way, the panel open, the handover)
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `node tools/test_pages.mjs --app v2 plan.page`, or pass --base'); process.exit(2); }
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, mapHintSeen: true })); } catch {} };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
// the open lake off the bay's mouth, 17:30: room for a passage
await page.goto(`${BASE}/?mode=plan&hour=17.5&seed=1&attract=0&chartground=webp&start=2300,-1400&heading=60`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui?.services?.get('mapScreen'), null, { timeout: 240000 });
await page.waitForFunction(() => document.getElementById('lk-load').dataset.build !== 'wait' && !document.documentElement.hasAttribute('data-lk-hold'), null, { timeout: 240000 });
await page.waitForTimeout(1500);
await pickMode(page, 'sail');
const st = () => page.evaluate(() => window.__velia.plan.stats());
const boat = () => page.evaluate(() => { const s = window.__velia.boat.state; return { x: s.x, z: s.z, h: (s.heading * 180) / Math.PI }; });
const toClient = (x, z) => page.evaluate(([x, z]) => window.__velia.m4.ui.services.get('liveChart').toClient(x, z), [x, z]);
try {
  await page.waitForFunction(() => { const p = window.__velia.plan?.stats?.(); return p?.on && p.ui && window.__velia.m4.ui.services.get('menu')?.isOpen && document.getElementById('lk-load').dataset.plan; }, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  let s = await st();
  check(s.on && s.helm === 'pilot' && s.clockRate === 1, `Plan: on, the pilot's, the day clock locked to the sim (${JSON.stringify({ helm: s.helm, rate: s.clockRate })})`);
  const bar = await page.evaluate(() => ({ plan: document.getElementById('lk-load').dataset.plan, panel: !!document.querySelector('.lkp-panel')?.getClientRects().length, h2: document.querySelector('.lkp-panel h2')?.textContent,
    wind: document.querySelector('.lkp-wind .k')?.textContent ?? '', boat: !!document.querySelector('.lkp-boat .lk-cv'), card: document.querySelector('#lk-load .lk-card').getBoundingClientRect().width }));
  check(bar.plan === 'open' && bar.panel && /passage/i.test(bar.h2 ?? ''), `the passage panel is open with no passage ("${bar.h2}", ${Math.round(bar.card)} px)`);
  check(/^\d+ KN · \d{3}°$/.test(bar.wind) && bar.boat, `the wind dial "${bar.wind}" and the map's boat`);
  // a click on the land: refused, no corner
  const land = await toClient(0, -1500);
  await page.mouse.click(land.x, land.y); await page.waitForTimeout(700);
  check((await st()).corners === 0, 'a click on the land lays no corner');
  // three corners on the water
  for (const [x, z] of [[2750, -1650], [3300, -1300], [3800, -1750]]) { const q = await toClient(x, z); await page.mouse.click(q.x, q.y); await page.waitForTimeout(500); }
  await page.waitForTimeout(400);
  s = await st();
  const legs = await page.evaluate(() => [...document.querySelectorAll('.lkp-legs .lg')].map((e) => e.innerText.replace(/\s+/g, ' ')));
  check(s.corners === 3 && s.legs === 3 && legs.length === 3, `three corners, three legs (${legs.join(' | ')})`);
  check(legs.every((l) => /\d{3}°T · \d+\.\d nm/.test(l) && /\d\d:\d\d/.test(l)), 'each leg: course, distance, the arrival time');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p1-plan-passage-open-1280x720.png` });
  // ×16 runs the sim at 16 × real time
  await page.click('.lkp-rates [data-rate="16"]');
  const a = await page.evaluate(() => ({ t: window.__velia.clock.t, h: window.__velia.clock.hourUnwrapped, now: performance.now(), slows: window.__velia.plan.stats().slows }));
  await page.waitForTimeout(2000);
  const b = await page.evaluate(() => ({ t: window.__velia.clock.t, h: window.__velia.clock.hourUnwrapped, now: performance.now(), slows: window.__velia.plan.stats().slows }));
  const ratio = (b.t - a.t) / ((b.now - a.now) / 1000);
  if (b.slows > a.slows) console.log(`  (×16 measured through an auto-slow: ${ratio.toFixed(1)} sim s a real second, not gated)`);
  else check(ratio > 10 && ratio <= 16.5, `×16: ${ratio.toFixed(1)} sim s a real second`);
  check(Math.abs((b.h - a.h) * 3600 - (b.t - a.t)) < 0.5, 'one clock: the day moved as far as the sim');
  // the auto-slow at the first corner (a gust lane or a shift on the way slows it too: ×16 again until the corner's)
  for (let k = 0; k < 6; k++) {
    await page.waitForFunction((n) => window.__velia.plan.stats().slows > n, k ? (await st()).slows : 0, { timeout: 120000 });
    s = await st();
    if (s.slow.why === 'corner' || s.leg > 0) break;
    console.log(`  (slowed for ${s.slow.why}: ×16 again)`); await page.click('.lkp-rates [data-rate="16"]');
  }
  const bt = await boat();
  check(s.slow.why === 'corner' && Math.hypot(bt.x - 2750, bt.z + 1650) < 400, `the clock slowed itself: ${s.slow.why} (${Math.round(Math.hypot(bt.x - 2750, bt.z + 1650))} m from corner 1)`);
  await page.waitForTimeout(1300);
  check((await st()).rate === 1, 'eased to ×1');
  // the rail folds itself 6 s after the last press (the pointer away from the panel)
  await page.click('.lkp-rates [data-rate="1"]'); await page.mouse.move(900, 400);   // ×1: nothing to slow, so nothing reopens it
  await page.waitForTimeout(6800);
  const fold = await page.evaluate(() => ({ plan: document.getElementById('lk-load').dataset.plan, w: document.querySelector('#lk-load .lk-card').getBoundingClientRect().width, rail: !!document.querySelector('.lkp-rail')?.getClientRects().length }));
  check(fold.plan === 'rail' && fold.rail && fold.w <= 66, `folded to the rail (${Math.round(fold.w)} px)`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p1-plan-rail-folded-1280x720.png` });
  // Take the helm (the rail's ring): the zoom, then Sail's hands with no jump
  const pre = await page.evaluate(() => ({ t: window.__velia.clock.t }));
  await page.click('.lkp-rail .helm');
  await page.waitForFunction(() => window.__velia.plan.stats().helm === 'player', null, { timeout: 5000 });
  const at = await page.evaluate(() => { const s = window.__velia.boat.state; return { h: (s.heading * 180) / Math.PI, x: s.x, z: s.z, t: window.__velia.clock.t, hour: window.__velia.clock.hourUnwrapped, menu: window.__velia.m4.ui.services.get('menu').isOpen }; });
  check(at.t >= pre.t && at.t - pre.t < 30, `the clock ran on through the zoom, never reset (${(at.t - pre.t).toFixed(1)} s)`);
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => { const s = window.__velia.boat.state; return { h: (s.heading * 180) / Math.PI, x: s.x, z: s.z, plate: document.querySelector('.lkp-plate[data-on]')?.innerText ?? '', menu: window.__velia.m4.ui.services.get('menu').isOpen, attached: window.__velia.plan.stats().attached }; });
  const dh = Math.abs(((after.h - at.h + 540) % 360) - 180);
  check(!after.menu && !after.attached, 'the chart has gone; Sail\'s hands have her');
  check(dh < 8 && Math.hypot(after.x - at.x, after.z - at.z) < 15, `no jump: ${dh.toFixed(1)}° and ${Math.hypot(after.x - at.x, after.z - at.z).toFixed(1)} m in 0.7 s`);
  check(/Leg \d of 3/.test(after.plate), `the plate names the leg ("${after.plate.replace(/\s+/g, ' ')}")`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/p1-plan-take-the-helm-1280x720.png` });
  // and back: N brings the chart back, the pilot on the passage from where she is
  const pre2 = await boat();
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => window.__velia.plan.stats().helm === 'pilot' && window.__velia.m4.ui.services.get('menu').isOpen, null, { timeout: 5000 });
  const back = await boat(), s2 = await st();
  check(s2.attached && s2.corners === 3 && Math.hypot(back.x - pre2.x, back.z - pre2.z) < 15, `N: the chart again, the pilot has her from where she is (leg ${s2.leg + 1})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'plan: all pass');
process.exit(fails ? 1 : 0);
