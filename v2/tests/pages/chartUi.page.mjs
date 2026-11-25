// The UI audit's S2 rows on the real v2 page (the node half: v2/tests/ui-audit-s2.test.mjs):
//   U12  the status line: Y says "Sails coming down…" in the bar's event line at once, then "Sails down"; K says "Reefing…" (the
//        lean skipper, owner 2026-11-17: the status is kept as ui.status but never shown on the skipper's row)
//   U9   N pins the enlarged chart: the top bar and the cockpit fade out and go inert (v1's deck switchShown, station dashHidden)
//   U15  the enlarged chart's course tool: Lay windward-leeward lays v1's practice marks (drawn by the props), Clear course clears
//   U8   Escape over the pinned chart unpins it and the Menu card stays down; the next Escape opens the card
//   U10  the chart hides under the Menu card; at night (22:30) it draws v1's night palette (dark, its night base built)
//   dial the cockpit's chart dial (owner 2026-11-17): a click opens the chart page; a 0.4 s resting hover raises the larger preview, whose
//        click opens the chart page too
//   U14  N in Cruise pins the chart once (it no longer flips twice)
//   lake the whole lake on the chart (the whole-lake chart): from off the bay's mouth the wheel steps out to the lake's zooms (its
//        coarse base built), a tap on the east shore's water is a waypoint (no "off my chart"), Sail's own mark 6 km off is drawn on
//        the chart; in Cruise a chart tap off the south shore (past the old bay chart) is Cruise's mark
//   anchor the anchor seen (2026-11-17): the chart's anchorages are drawn (a small anchor each, 3–20 m on the planner's chart), and a
//        tap on one sets it as AUTO's target (the pilot's target, Sail's mark, the beacon; its reply is chatter the lean skipper drops)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/chartUi.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const Q = 'mode=sail&seed=1&wind=3&noload=1&attract=0&fv=1&once=0&hm=0&chatter=0';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); localStorage.removeItem('lakeshore.course.v1'); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?${q}&livechart=0`, { waitUntil: 'load' });   // the enlarged chart's own tools (Phase 2b: the live chart is the default; ?livechart=0 keeps this chart one release)
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station && window.__velia.m4.ui.chart?.chart && window.__velia.boat?.sim?.t > 1, null, { timeout: 300000 });
  await page.waitForTimeout(800);
  return { page, errors };
}
const until = (page, fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);

try {
  const { page, errors } = await open(`${Q}&hour=13`);
  await page.mouse.click(640, 300); await page.waitForTimeout(300);
  const hintText = () => page.evaluate(() => window.__velia.m4.ui.hint.el?.textContent ?? '');

  // ---- U12: the status line ----
  await page.keyboard.press('KeyY');
  check(await until(page, () => window.__velia.m4.ui.status?.text === 'Sails coming down…', null, 1500), `Y: "Sails coming down…" at once (${JSON.stringify(await page.evaluate(() => window.__velia.m4.ui.status))})`);
  // the lean skipper (owner 2026-11-17): a status is chatter, so the row never shows it, even as the status re-says it each second
  // (watched for 2.5 s, as main's check watched for it to show)
  { let seen = false; for (let i = 0; i < 25 && !seen; i++) { seen = (await hintText()).includes('Sails coming down'); await page.waitForTimeout(100); }
    check(!seen, `the lean skipper: a status is chatter, the row stays quiet ("${(await hintText()).slice(0, 60)}")`); }   // the cockpit's SAILS key shows the crew's progress
  check(await until(page, () => window.__velia.m4.ui.status?.text === 'Sails down', null, 30000), 'the crew done: "Sails down"');
  await page.keyboard.press('KeyY');   // hoist again for the rest
  check(await until(page, () => window.__velia.m4.ui.status?.text === 'Hoisting the sails…', null, 1500), 'Y again: "Hoisting the sails…"');
  const reefBtn = () => page.evaluate(() => document.querySelector('.lk-cp .c[data-id=reef]').click());   // REEF is the switch (K went)
  await reefBtn();
  check(await until(page, () => window.__velia.m4.ui.status?.text === 'Reefing…', null, 1500), 'REEF: "Reefing…"');
  await reefBtn(); await reefBtn(); await reefBtn();   // 1 → 2 → A → 0: back to no reef

  // ---- U9: the big chart takes the screen ----
  const bar = () => page.evaluate(() => { const n = document.querySelector('.lk-view'); return n ? { off: n.classList.contains('off'), aria: n.getAttribute('aria-hidden'), pe: getComputedStyle(n).pointerEvents } : null; });
  check(!(await bar()).off && await page.evaluate(() => window.__velia.m4.ui.station.shown), 'before: the bar and the cockpit are up');
  await page.keyboard.press('KeyN');
  check(await until(page, () => window.__velia.m4.ui.chart.chart.toggle.pinned && window.__velia.m4.ui.chart.chart.toggle.big, null, 2000), 'N: the chart pinned and enlarged');
  await page.waitForTimeout(400);
  const b1 = await bar(), st1 = await page.evaluate(() => window.__velia.m4.ui.station.shown);
  check(b1.off && b1.aria === 'true' && b1.pe === 'none', `the top bar fades out and goes inert (${JSON.stringify(b1)})`);
  check(st1 === false, 'the cockpit steps aside (station.shown false)');

  // ---- U15: the course tool ----
  const tools = () => page.evaluate(() => [...document.querySelectorAll('.lk-chart .big .tools button')].filter((b) => !b.hidden).map((b) => b.textContent));
  const t0 = await tools();
  check(t0.includes('Lay windward-leeward') && t0.includes('Lay triangle'), `the enlarged chart's course tool (${JSON.stringify(t0)})`);
  await page.click('.lk-chart .big .tools button[data-key="windward-leeward"]');
  check(await until(page, () => !!window.__velia.m4.ui.course?.chart.laid, null, 15000), 'Lay windward-leeward: a course laid');
  //: the props come in their own chunk on the first laid course (a late pipeline group, built paced)
  check(await until(page, () => !!window.__velia.regatta.props, null, 15000), 'the laid course brought the props\' chunk');
  const c1 = await page.evaluate(() => ({ marks: window.__velia.m4.ui.course.chart.marks().map((m) => m.type).sort(), props: { ...(window.__velia.regatta.props?.stats ?? {}) }, said: window.__velia.m4.ui.hint.el?.textContent ?? '' }));
  check(c1.marks.join() === 'committee,cylinder,pin,sphere', `v1's four marks (${c1.marks})`);
  // since the race marks moved to the channel buoys' pipeline (render/navAids.js, 2026-11-18): the props draw the committee boat, the buoys' pipeline the three marks
  check(await until(page, () => window.__velia.regatta.props?.stats.active && window.__velia.regatta.props.stats.instances === 1 && window.__velia.regatta.props.stats.draws > 0 && window.__velia.aids?.fx?.race === 3, null, 5000), `the props draw the committee boat, the buoys' pipeline the three marks (${JSON.stringify(await page.evaluate(() => ({ props: window.__velia.regatta.props?.stats, aids: window.__velia.aids?.fx })))})`);
  check(await until(page, () => (localStorage.getItem('lakeshore.course.v1') ?? '').includes('4 marks laid'), null, 3000), 'v1\'s course log: "… 4 marks laid" (the quiet line is a hint note: it waits for a quiet moment, as v1\'s)');
  check((await tools()).includes('Clear course'), 'Clear course shows while a course is laid');
  if (argv.includes('--shots')) await page.screenshot({ path: argv[argv.indexOf('--shots') + 1] + '/v2-chart-course.png' });
  await page.click('.lk-chart .big .tools button[data-key="clear"]');
  check(await until(page, () => !window.__velia.m4.ui.course.chart.laid && !window.__velia.regatta.props.stats.active, null, 3000), 'Clear course: the marks gone, the props off');

  // ---- U8: Escape over the pinned chart ----
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const e1 = await page.evaluate(() => ({ pinned: window.__velia.m4.ui.chart.chart.toggle.pinned, card: document.getElementById('lk-load')?.dataset.state }));
  check(!e1.pinned && e1.card !== 'menu', `Escape: the chart unpins, the Menu card stays down (${JSON.stringify(e1)})`);
  check(await until(page, () => !document.querySelector('.lk-view').classList.contains('off') && window.__velia.m4.ui.station.shown, null, 2000), 'the bar and the cockpit come back');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check(await page.evaluate(() => document.getElementById('lk-load')?.dataset.state) === 'menu', 'the next Escape opens the Menu card');

  // ---- U10: the chart hides under the Menu card ----
  check(await until(page, () => window.__velia.m4.ui.chart.chart.state.hidden && !document.querySelector('.lk-chart .small').classList.contains('in'), null, 2000), 'under the Menu card the chart hides');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check(await until(page, () => !window.__velia.m4.ui.chart.chart.state.hidden && document.querySelector('.lk-chart .small').classList.contains('in'), null, 3000), 'the card closed: the chart is back');

  // ---- the chart dial (owner, 2026-11-17: a click opens the chart page); a 2D module since 2026-11-24 (v2/ui/dials.js): no hover
  //      preview, the module itself takes the click ----
  const dial = () => page.evaluate(() => { const r = document.querySelector('.lk-chart .small').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, pinned: window.__velia.m4.ui.chart.chart.toggle.pinned, shown: window.__velia.m4.ui.station.shown }; });
  await page.mouse.move(640, 300); await page.waitForTimeout(600);
  const d = await dial();
  check(d.w >= 44 && !d.pinned, `the chart module's target, nothing open at rest (${JSON.stringify(d)})`);
  await page.mouse.click(d.x, d.y);
  check(await until(page, () => window.__velia.m4.ui.chart.chart.toggle.pinned && window.__velia.m4.ui.chart.chart.toggle.big && !window.__velia.m4.ui.station.shown, null, 2000), 'a click on the chart module opens the chart page at once');
  await page.keyboard.press('Escape');
  check(await until(page, () => !window.__velia.m4.ui.chart.chart.toggle.pinned && window.__velia.m4.ui.station.shown, null, 2000), 'Escape closes it');
  await page.mouse.move(640, 300); await page.waitForTimeout(500);

  // ---- U14: N in Cruise ----
  await page.evaluate(() => window.__velia.mode.go('cruise'));
  check(await until(page, () => window.__velia.mode.now() === 'cruise' && document.querySelector('.cruisecam'), null, 120000), 'Cruise has the page');
  await page.mouse.click(640, 300); await page.waitForTimeout(400);
  await page.keyboard.press('KeyN'); await page.waitForTimeout(400);
  const cz = await page.evaluate(() => { const t = window.__velia.m4.ui.chart.chart.toggle; return { pinned: t.pinned, big: t.big }; });
  check(cz.pinned && cz.big, `N in Cruise: the chart pinned once (${JSON.stringify(cz)})`);
  check(await page.evaluate(() => [...document.querySelectorAll('.lk-chart .big .tools button')].every((b) => b.hidden || getComputedStyle(b).display === 'none' || !/^(Lay|Clear course)/.test(b.textContent))), 'Cruise\'s chart has no course tool (v1\'s)');
  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // ---- U10: the night chart ----
  const n = await open(`${Q}&hour=22.5&timerate=0`);
  check(await until(n.page, () => window.__velia.m4.ui.chart.chart.state.ready.night, null, 20000), 'at 22:30 the chart builds its night base (v1\'s sun elevation)');
  await n.page.waitForTimeout(1000);
  const mean = await n.page.evaluate(() => { const c = document.querySelector('.lk-chart .small canvas'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; let s = 0, k = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { s += d[i] + d[i + 1] + d[i + 2]; k++; } return k ? s / k / 3 : null; });
  check(mean != null && mean < 30, `the small chart is in night colours (mean level ${mean?.toFixed(1)}; v1 9.4, the old day palette 55)`);
  if (argv.includes('--shots')) await n.page.screenshot({ path: argv[argv.indexOf('--shots') + 1] + '/v2-chart-night.png' });
  check(!n.errors.length, `no page errors at night (${n.errors.slice(0, 3).join(' | ')})`);
  await n.page.close();

  // ---- the whole lake: the lake's zooms, a waypoint on the far shore, Sail's mark on the chart, Cruise's far mark ----
  const w = await open(`${Q}&hour=13&start=1900,-1900&heading=60`);
  const wp = w.page, cp = () => wp.evaluate(() => window.__velia.m4.ui.chart.chart.state);
  await wp.mouse.click(640, 300); await wp.waitForTimeout(300);
  await wp.keyboard.press('KeyN');
  check(await until(wp, () => window.__velia.m4.ui.chart.chart.toggle.pinned, null, 2000), 'lake: N pins the chart');
  await until(wp, () => !!window.__velia.m4.ui.chart.planner, null, 30000);
  const box = await wp.evaluate(() => { const r = document.querySelector('.lk-chart .big canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await wp.mouse.move(box.x, box.y);
  for (let i = 0; i < 4; i++) { await wp.mouse.wheel(0, 120); await wp.waitForTimeout(150); }
  const z1 = await cp();
  check(z1.zooms === 5 && z1.zoom === 4 && z1.rangeM === 19200, `lake: the wheel steps out to the whole lake (zoom ${z1.zoom} of ${z1.zooms}, ${z1.rangeM} m)`);
  check(await until(wp, () => window.__velia.m4.ui.chart.chart.state.ready.lake, null, 30000), 'lake: the lake\'s coarse base is built');
  await wp.waitForTimeout(500);
  await wp.screenshot({ path: argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] + '/v2-chart-lake.png' : 'renders/whole-lake/tmp/chart-lake.png' });
  const east = await wp.evaluate(() => window.__velia.m4.ui.chart.chart.toClient(12600, -12000));
  if (east) await wp.mouse.click(east.x, east.y);
  await wp.waitForTimeout(1200);
  const r1 = await wp.evaluate(() => ({ route: window.__velia.m4.ui.chart.course?.route ?? [], hint: window.__velia.m4.ui.hint.el?.textContent ?? '' }));
  check(r1.route.length === 1 && Math.hypot(r1.route[0].x - 12600, r1.route[0].z + 12000) < 300 && !/off my chart/i.test(r1.hint), `lake: a tap on the east shore's water is a waypoint (${JSON.stringify(r1.route)}; "${r1.hint.slice(0, 60)}")`);
  await wp.evaluate(() => [...document.querySelectorAll('.lk-chart .tools button')].find((b) => b.textContent.trim() === 'Clear')?.click());
  const m = await wp.evaluate(() => { const b = window.__velia.boat.state, M = window.__velia.beacon.mark; for (const a of [2.2, 2.0, 2.4, 1.8]) if (M.place({ x: b.x + Math.sin(a) * 6000, z: b.z - Math.cos(a) * 6000 }) === 'set') return M.mark; return null; });
  check(await until(wp, () => !!window.__velia.m4.ui.chart.chart.state.mark, null, 3000), `lake: Sail's mark 6 km off is drawn on the chart (${JSON.stringify(m)}; ${JSON.stringify((await cp()).mark)})`);
  await wp.evaluate(() => window.__velia.beacon.mark.clear());
  // the anchorages: drawn on the whole-lake chart; a tap on the one by the narrows (Emerald Bay) is AUTO's target
  await wp.waitForTimeout(600);
  const an = (await cp()).anchorages?.big ?? [];
  const depths = await wp.evaluate((list) => { return list.map((a) => -window.__velia.terrain.field.height(a.x, a.z)); }, an);
  check(an.length >= 6 && depths.every((d) => d >= 2.5 && d <= 21), `anchor: ${an.length} anchorages drawn on the lake's chart, the live depth there ${depths.map((d) => d.toFixed(1)).join(', ')} m`);
  await wp.screenshot({ path: argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] + '/v2-chart-anchorages.png' : 'renders/whole-lake/tmp/chart-anchorages.png' });
  const spot = an.find((a) => /narrows/.test(a.name)) ?? an[0];
  const at = spot && await wp.evaluate(([x, z]) => window.__velia.m4.ui.chart.chart.toClient(x, z), [spot.x, spot.z]);
  if (at) await wp.mouse.click(at.x + 3, at.y - 2);
  await wp.waitForTimeout(800);
  const tg = await wp.evaluate(() => ({ mark: window.__velia.beacon.mark.mark, pilot: window.__velia.m4.ui.services.get('pilot')?.state?.target ?? null, route: window.__velia.m4.ui.chart.course?.route ?? [], hint: window.__velia.m4.ui.hint.el?.textContent ?? '' }));
  check(!!spot && tg.mark && Math.hypot(tg.mark.x - spot.x, tg.mark.z - spot.z) < 1 && tg.pilot && Math.hypot(tg.pilot.x - spot.x, tg.pilot.z - spot.z) < 1 && !tg.route.length,   // the target itself, not the tap's reply: the lean skipper drops that chatter (sea.anchorage), the beacon and NAV show it
    `anchor: a tap on ${spot?.name} sets AUTO's target there, not a waypoint (${JSON.stringify(tg)})`);
  await wp.evaluate(() => window.__velia.beacon.mark.clear());
  await wp.keyboard.press('Escape');
  await wp.evaluate(() => window.__velia.mode.go('cruise'));
  check(await until(wp, () => window.__velia.mode.now() === 'cruise' && document.querySelector('.cruisecam'), null, 120000), 'lake: Cruise has the page');
  await wp.mouse.click(640, 300); await wp.waitForTimeout(400);
  await wp.keyboard.press('KeyN'); await wp.waitForTimeout(600);
  const south = await wp.evaluate(() => window.__velia.m4.ui.chart.chart.toClient(9000, 200));
  if (south) await wp.mouse.click(south.x, south.y);
  check(await until(wp, () => !!window.__velia.m4.ui.chart.chart.state.dest, null, 5000), `lake: in Cruise a chart tap off the south shore (past the old chart) is Cruise's mark (${JSON.stringify((await cp()).dest)})`);
  check(!w.errors.length, `lake: no page errors (${w.errors.slice(0, 3).join(' | ')})`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
