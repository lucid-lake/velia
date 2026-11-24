// K2 + K3, the knockdown on the real v2 page (owner 2026-11-17), at 1280 × 720 (mouse) and 844 × 390 (touch, a phone):
// a set-up storm gust on the beam (the boat's scripted gust: 43 kn, full sail, the sheets held) in Sail:
//   the warning first: the skipper's line "Overpowered — ease the sails or reef", REEF's lamp amber (desktop: the cockpit's
//   rotary and the dock) or the sheet ring pulsing (phone), at least 1.5 s before the knockdown
//   the Helm view cuts to the Boat view as she passes 45° (desktop)
//   the knockdown: the frame slows; the navy logbook card "Knocked down" with the line, the tip and the log line, alone (owner
//   2026-11-17: no menu card unless asked for)
//   Start again: the card goes, she is back at Sail's start, upright, the time at full speed, the same wind level
//   knocked down again: Esc on the card (desktop) or its Menu (phone) opens the menu card and closes the card; then Esc or the menu
//   card's × closes it and she starts again in Sail (never a stopped boat with no card)
// Run by `npm run test:pages:v2 -- knockdown`, or node v2/tests/pages/knockdown.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const Q = process.env.KD_QUERY ?? '';   // e.g. knockdown=1 before the default turned on

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  for (const [vn, opt] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const touch = !!opt.hasTouch;
    const ctx = await browser.newContext(opt);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
    await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=15&seed=1&attract=0&music=0${Q ? `&${Q}` : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front, null, { timeout: 240000 });
    await page.waitForTimeout(600);
    if (touch) await page.tap('#lk-load .lk-pick[data-mode=sail]'); else await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 8000 });
    check(await page.evaluate(() => !!window.__velia.knockdown?.game), `${vn}: the knockdown is on`);
    // a beam reach at full sail, the sheets held where they are; the Helm view on the desktop
    const start = await page.evaluate((desk) => {
      const V = window.__velia, B = V.boat.sim, s = B.state, w = V.boat.wind.sample(s.x, s.z, B.t);
      const from = Math.atan2(-w.vx, w.vz);   // the wind's from (rad, clockwise from north)
      B.setReef(0); B.assists.crewTrim = false;
      B.holdCourse(from + 85 * Math.PI / 180);
      if (desk) V.m4.views.set('helm');
      return { x: s.x, z: s.z, level: V.boat.wind.level };
    }, !touch);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');   // the sheets in (W), then held
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.__velia.knockdown.gust({ peakKn: 43, riseS: 3, holdS: 12, fallS: 2, inS: 0.5 }));
    // watch it play: the warning, the cut, the knockdown, the slow, the card, the menu
    const seen = await page.evaluate(async (desk) => {
      const V = window.__velia, B = V.boat.sim, G = V.knockdown.game, out = { warnAt: null, kdAt: null, cardAt: null, menuOpen: null, line: false, lamp: false, ring: false, cutHelm: null, maxHeel: 0 };
      const t0 = performance.now();
      while (performance.now() - t0 < 30000) {
        const t = (performance.now() - t0) / 1000, heel = Math.abs(B.pose.heel) * 180 / Math.PI;
        out.maxHeel = Math.max(out.maxHeel, heel);
        if (G.warnOn && out.warnAt == null) out.warnAt = t;
        if (G.warnOn) {
          out.line ||= /Overpowered/.test(document.body.innerText);
          out.lamp ||= !!V.m4.ui.cockpitStates?.().reefWarn;
          out.ring ||= !!document.querySelector('div.lk-flat .side.r.warn');
        }
        if (desk && heel > 47 && out.cutHelm == null) out.cutHelm = V.m4.views.view;
        if (G.state !== 'sailing' && out.kdAt == null) out.kdAt = t;
        const card = document.getElementById('lk-end');
        if (card && !card.hidden && card.dataset.on != null && out.cardAt == null) out.cardAt = t;
        if (out.cardAt != null && t - out.cardAt > 2.5) { out.menuOpen = V.m4.front.home.isOpen; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      return out;
    }, !touch);
    check(seen.warnAt != null && seen.kdAt != null, `${vn}: warned, then knocked down (max heel ${seen.maxHeel.toFixed(0)}°; ${JSON.stringify(seen)})`);
    // the lead on the sim's own clock (the watch's): at least 1.5 s
    const lead = await page.evaluate(() => window.__velia.boat.sim.knockdown.events.find((e) => e.type === 'knockdown')?.leadS ?? null);
    check(lead != null && lead >= 1.5, `${vn}: the warning ${lead?.toFixed(2)} s of sim time before the knockdown`);
    check(seen.line, `${vn}: the skipper's line says Overpowered`);
    if (touch) check(seen.ring, `${vn}: the sheet ring pulses amber during the warning`);
    else { check(seen.lamp, `${vn}: REEF's lamp is lit amber during the warning`); check(seen.cutHelm === 'follow', `${vn}: the Helm view cut to the Boat view past 45° (${seen.cutHelm})`); }
    check(seen.cardAt != null && seen.cardAt - seen.kdAt >= 1.5 && seen.cardAt - seen.kdAt <= 4, `${vn}: the card ${(seen.cardAt - seen.kdAt).toFixed(1)} s after the knockdown`);
    check(seen.menuOpen === false, `${vn}: the card alone, no menu card 2.5 s on`);
    await page.waitForTimeout(700);
    const card = await page.evaluate(() => {
      const el = document.getElementById('lk-end'), r = el.getBoundingClientRect(), m = document.querySelector('#lk-load .lk-card').getBoundingClientRect();
      const ink = getComputedStyle(el.querySelector('h2')).color;
      return { title: el.querySelector('h2').textContent, line: el.querySelector('.ln').textContent, tip: el.querySelector('.tp').textContent, log: el.querySelector('.lg').textContent,
        rect: [r.left, r.top, r.right, r.bottom], menu: [m.left, m.top, m.right, m.bottom], overlap: !(r.left >= m.right || r.right <= m.left || r.top >= m.bottom || r.bottom <= m.top),
        inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, ink, scale: window.__velia.knockdown.game.frame ? null : null };
    });
    check(card.title === 'Knocked down' && /^A \d+ kn gust /.test(card.line) && /full sail/.test(card.line) && card.tip.length > 10 && /nm/.test(card.log) && /top \d/.test(card.log), `${vn}: the card: "${card.title}" / ${card.line} / ${card.tip} / ${card.log}`);
    check(card.inView, `${vn}: the card on screen (${card.rect.map(Math.round)})`);
    // Start again: the same mode at its start, upright, the same weather
    if (touch) await page.tap('#lk-end .again'); else await page.click('#lk-end .again');
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => { const V = window.__velia, s = V.boat.sim.state; return { x: s.x, z: s.z, heel: Math.abs(s.heel) * 180 / Math.PI, state: V.knockdown.game.state, card: !document.getElementById('lk-end').hidden, menu: V.m4.front.home.isOpen, mode: V.mode.now(), level: V.boat.wind.level }; });
    check(after.state === 'sailing' && !after.card && !after.menu && after.mode === 'sail', `${vn}: Start again: the card and the menu gone, sailing (${JSON.stringify(after)})`);
    check(Math.hypot(after.x - start.x, after.z - start.z) < 60 && after.heel < 20 && after.level === start.level, `${vn}: back at Sail's start, upright, the same wind (${Math.round(Math.hypot(after.x - start.x, after.z - start.z))} m from the start, ${after.heel.toFixed(0)}°)`);
    // a second knockdown, then the menu card closed by Esc (desktop) or its × (phone): both cards go, she starts again in Sail
    await page.evaluate(() => { const V = window.__velia, B = V.boat.sim, s = B.state, w = V.boat.wind.sample(s.x, s.z, B.t); B.setReef(0); B.assists.crewTrim = false; B.holdCourse(Math.atan2(-w.vx, w.vz) + 85 * Math.PI / 180); });
    await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__velia.knockdown.gust({ peakKn: 43, riseS: 3, holdS: 12, fallS: 2, inS: 0.5 }));
    const up = await page.waitForFunction(() => document.getElementById('lk-end')?.dataset.on != null && !document.getElementById('lk-end').hidden && window.__velia.knockdown.game.state === 'ended', null, { timeout: 30000 }).then(() => true, () => false);
    check(up, `${vn}: knocked down again, the end card up`);
    await page.waitForTimeout(900);
    if (touch) await page.tap('#lk-end .menu'); else await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    const mid = await page.evaluate(() => ({ menu: window.__velia.m4.front.home.isOpen, card: !document.getElementById('lk-end').hidden && document.getElementById('lk-end').dataset.on != null, state: window.__velia.knockdown.game.state }));
    check(mid.menu && !mid.card && mid.state === 'ended', `${vn}: ${touch ? 'Menu' : 'Esc'} on the card opens the menu card and closes the card (${JSON.stringify(mid)})`);
    if (touch) await page.tap('#lk-load .lk-card .lk-x'); else await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    const shut = await page.evaluate(() => { const V = window.__velia, s = V.boat.sim.state; return { x: s.x, z: s.z, heel: Math.abs(s.heel) * 180 / Math.PI, state: V.knockdown.game.state, card: !document.getElementById('lk-end').hidden, menu: V.m4.front.home.isOpen, mode: V.mode.now() }; });
    check(shut.state === 'sailing' && !shut.card && !shut.menu && shut.mode === 'sail', `${vn}: ${touch ? 'the ×' : 'Esc'} on the menu card closes it; sailing again (${JSON.stringify(shut)})`);
    check(Math.hypot(shut.x - start.x, shut.z - start.z) < 60 && shut.heel < 20, `${vn}: back at Sail's start, upright (${shut.heel.toFixed(0)}°)`);
    check(errors.length === 0, `${vn}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
