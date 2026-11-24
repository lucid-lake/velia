// The passage plan on a live v2 page (v2/ui/plan.js, sail.js; v1's src/sail/passagePlan.js as it is), the player's way since Phase 2b
// (the in-game menu is the live map; the old enlarged chart, its first-time line, its sheet and tools row are gone):
//   the map      Menu opens the live map; a tap on the water opens its card (helper liveMap.mjs)
//   the taps     three Add waypoint presses: three waypoints, three legs, leg 1 bends round the island; the card then offers Set course
//                and Clear route; Add waypoint on dry land is refused with the navigator's words
//   Set course   the card's word: "Course set"; the nav column's passage block MARK WP 1 · 3, DTW, BTW, TTG, XTE (with Pro off) once
//                the map closes
//   arrival      the boat placed by waypoint 1: WP 2 · 3; Clear route empties the block
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/passagePlan.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { openMap, closeMap, waterAct, live } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const Q = 'mode=sail&hour=15&wind=2&noload=1&fv=1&hm=0&chatter=0&hud=full&start=-350,150&heading=20';
const WPS = [[300, -300], [900, -800], [600, -400]];
const OPEN = [450, -150];   // open water clear of the waypoints: a tap here opens the water's card
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const col = (page) => page.evaluate(() => {
  const el = document.querySelector('.lk-nav'); if (!el) return null;
  const rows = [...el.children].filter((r) => !r.classList.contains('fade') && !r.classList.contains('off')).sort((a, b) => +a.style.order - +b.style.order);
  const text = (r) => (r.dataset.id === 'mark' ? r.textContent.trim() : `${r.querySelector('.v')?.textContent ?? ''}${r.querySelector('.u')?.textContent ?? ''}`);
  return { on: el.classList.contains('on'), ids: rows.map((r) => r.dataset.id).filter((id) => !id.startsWith('gap')), rows: Object.fromEntries(rows.filter((r) => !r.dataset.id.startsWith('gap')).map((r) => [r.dataset.id, text(r)])) };
});
const hintText = (page) => page.evaluate(() => window.__said?.at(-1) ?? '');

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); localStorage.removeItem('lakeshore.passage.v1'); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?${Q}`, { waitUntil: 'load' });
  //: the planner loads on the chart's first opening; planReady asks for it (as a film does)
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.chart, null, { timeout: 240000 });
  check(await page.evaluate(() => window.__velia.m4.ui.chart.planLoaded === false), 'the planner not loaded before the chart opens');
  await page.evaluate(() => { void window.__velia.m4.ui.chart.planReady; });
  await page.waitForFunction(() => window.__velia.m4.ui.chart.planner && window.__velia.m4.ui.station?.cockpit && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.evaluate(() => window.__velia.boat.sim.place({ x: -350, z: 150, headingDeg: 20, speed: 0.5 }));
  await page.waitForTimeout(800);
  check((await col(page)).on === false, 'no plan, Pro off: the left edge is empty');
  // the live map (Menu); the skipper's lines spied (the kayaks' line may follow at once)
  await page.evaluate(() => { const h = window.__velia.m4.ui.hint, f = h.flash.bind(h); window.__said = []; h.flash = (t, o) => { window.__said.push(t); return f(t, o); }; });
  await openMap(page);
  const tap = (x, y) => page.mouse.click(x, y);
  // three waypoints from the water's card
  const acts = [];
  for (const [x, z] of WPS) acts.push(await waterAct(page, tap, x, z, 'waypoint'));
  await page.waitForTimeout(1200);
  check(acts.every((a) => a.pressed && !a.say), `three Add waypoint presses, none refused (${acts.map((a) => a.say || 'ok').join(' | ')})`);
  const R = await page.evaluate(() => { const c = window.__velia.m4.ui.chart; return { n: c.course?.route.length ?? 0, legs: c.planner?.plan?.legs?.length ?? 0, bend: !!c.planner?.plan?.legs?.[0]?.path }; });
  check(R.n === 3 && R.legs === 3, `three waypoints: ${R.n} waypoints, ${R.legs} legs`);
  check(R.bend, 'leg 1 bends round the island (the navigator\'s A*)');
  // the card on open water now offers the route's words
  const card = await waterAct(page, tap, ...OPEN, 'none');
  const words = await page.evaluate(() => [...document.querySelectorAll('.lk-livechart .lkc-card [data-act]')].filter((b) => !b.hidden).map((b) => b.dataset.act));
  check(words.includes('setCourse') && words.includes('clearRoute'), `with a route the water's card offers Set course and Clear route (${words.join(' · ')}; ${card.card?.name ?? ''})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // dry land: refused, the route unchanged
  const land = await waterAct(page, tap, -900, 300, 'waypoint');
  check((await page.evaluate(() => window.__velia.m4.ui.chart.course.route.length)) === 3 && /dry land/.test(land.say), `dry land refused: "${land.say}"`);
  if ((await live(page))?.card) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
  // Set course (the column steps aside under the map; it shows once the map closes)
  const set = await waterAct(page, tap, ...OPEN, 'setCourse');
  await page.waitForTimeout(600);
  check(set.pressed && /^Course set\./.test(await hintText(page)), `the skipper: "${await hintText(page)}"`);
  check((await col(page)).on === false, 'under the live map the column steps aside');
  await closeMap(page); await page.waitForTimeout(1200);
  const C = await col(page);
  check(C.on && /WP 1 · 3$/.test(C.rows.mark) && ['dtw', 'btw', 'ttg', 'xte'].every((k) => C.ids.includes(k)) && /^\d{3}°$/.test(C.rows.btw), `the map closed, the course stays: ${C.ids.map((k) => `${k.toUpperCase()} ${C.rows[k]}`).join(' · ')}`);
  // arrival: the boat by waypoint 1 (the planner's own point)
  await page.evaluate(() => { const w = window.__velia.m4.ui.chart.course.route[0]; window.__velia.boat.sim.place({ x: w.x - 20, z: w.z, headingDeg: 40, speed: 1 }); });
  await page.waitForTimeout(1800);
  const A = await col(page);
  check(/WP 2 · 3$/.test(A.rows.mark ?? ''), `arrival: MARK ${A.rows.mark} ("${await hintText(page)}")`);
  // Clear route (the water's card): the passage block goes
  await openMap(page);
  const clr = await waterAct(page, tap, ...OPEN, 'clearRoute');
  await closeMap(page); await page.waitForTimeout(1600);
  check(clr.pressed && (await col(page)).on === false && (await page.evaluate(() => window.__velia.m4.ui.chart.course.route.length)) === 0, 'Clear route: no route, the left edge empty again');
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  await page.close();
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
