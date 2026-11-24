// Cruise on a live v2 page (BACKLOG-v2 #11: v2/cruise; v1's src/modes/chill/ and tests/pages/cruiseHelm.page.mjs):
//   ?mode=cruise    she sails herself: the autopilot ticks, the boat moves at Cruise's 1 ×, the clock runs at Cruise's pace;
//                   one bar (the new bar, the default since 2026-11-15: Menu · Full │ Chart │ Boat ▾ │ Conditions), Sail's bar,
//                   cockpit, hints and key legend away; C steps the cameras; the old Locker's Glasses and Photo in the View menu,
//                   its VHF in the Conditions sheet; a double-tap on the water
//                   sets your mark (the navigator makes for it, the quiet line says so), a double-tap on its ring clears it
//   the hand-over   a steering key (A) takes the helm (no Take the helm button on the new bar): Sail's bar and cockpit, the boat in
//                   the player's hands at Sail's 2 ×; ` hands her back
//   the card        from a Sail page, the card's Cruise pick (Menu, then Cruise) enters Cruise (the first visit's welcome and its
//                   "Just enjoy the view" are gone: owner, 2026-11-21, no skill question); v1's idle attract (?attractS=4: untouched, Cruise plays behind the
//                   card's slide; a key brings the card and Sail back)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/cruise.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, { settings = SEEN, person = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  if (person) await page.addInitScript(PERSON);
  if (settings) await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, settings);
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  return { page, errors };
}
const S = (page) => page.evaluate(() => {
  const V = window.__velia, vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const cv = document.querySelector('.lk-view.cruisecam'), sv = document.querySelector('.lk-view:not(.cruisecam)');
  const s = V.boat.state;
  return { mode: V._stats().mode, c: V.cruise.stats(), t: V.boat.sim.t, wall: performance.now() / 1000, x: s.x, z: s.z, hour: V.clock.hour, rate: V.clock.rate,
    cruiseBar: vis(cv), sailBar: vis(sv), slots: cv ? [...cv.querySelectorAll('button')].filter(vis).map((b) => b.dataset.x ?? b.className.split(' ')[0]) : [],
    words: cv ? [...cv.querySelectorAll('button .w')].filter(vis).map((w) => w.textContent) : [],
    station: !!V.m4.ui?.station?.shown, legend: vis(document.querySelector('.lk-keys, .lk-legend, .lk-edgepair .r')),
    line: document.querySelector('.lk-chill.in')?.textContent ?? '', theme: document.documentElement.classList.contains('v2-cruise'),
    music: V.music ? { mode: V.music.mode, playlist: !!V.music.playlist, holder: V.music.stats().holder, started: V.music.stats().started, player: V.music.player === V.music.playlist } : null };
});
const wake = async (page) => { await page.mouse.move(600, 400); await page.mouse.move(620, 410); await page.waitForTimeout(400); };

try {
  // ---------------- ?mode=cruise: she sails herself; the one bar; the cameras; the View menu and the sheet; the mark ----------------
  {
    const { page, errors } = await open('mode=cruise&once=0&seed=1&kayaks=0');
    await page.waitForFunction(() => window.__velia?.cruise?.c?.on && window.__velia.m4?.ui && window.__velia.cruise.c.line, null, { timeout: 240000 });
    await page.waitForTimeout(1500); await wake(page);
    const a = await S(page); await page.waitForTimeout(3000); const b = await S(page);
    const simPerReal = (b.t - a.t) / (b.wall - a.wall), moved = Math.hypot(b.x - a.x, b.z - a.z);
    check(a.mode === 'cruise' && a.c.on && a.c.helm === 'cruise' && b.c.ticks > a.c.ticks + 120, `the autopilot sails her (ticks ${a.c.ticks} → ${b.c.ticks}, target ${b.c.target})`);
    check(moved > 2 && simPerReal > 0.7 && simPerReal < 1.3, `Cruise's 1 × (the sim ran ${simPerReal.toFixed(2)} s a real s; she moved ${moved.toFixed(1)} m in 3 s)`);
    check(Math.abs(a.hour - 17.9) < 0.2 && b.hour > a.hour, `v1 Cruise's hour, running (${a.hour.toFixed(3)} → ${b.hour.toFixed(3)}, ${b.rate.toFixed(1)} game s per sim s)`);
    check(a.cruiseBar && !a.sailBar && a.theme, `one bar: Cruise's, Sail's away (${JSON.stringify({ cruise: a.cruiseBar, sail: a.sailBar })})`);
    check(a.words[0] === 'Menu' && a.words.includes('Sail') && a.slots.indexOf('mode') >= 0 && a.slots.indexOf('mode') < a.slots.indexOf('views') && a.slots.indexOf('views') < a.slots.indexOf('cond')
      && !a.words.includes('Take the helm') && !a.slots.includes('take') && !a.slots.includes('locker'), `the slots: Menu … Sail (the mode button) · the view · Conditions, no Take the helm or Locker (${a.slots.join(' · ')})`);
    check(!a.station, 'no cockpit station in Cruise (v1: Sail\'s station comes with the hand-over)');
    check(a.music?.mode === 'cruise' && a.music.playlist && a.music.player, `music: Cruise's playlist from the start, the bar's Music drives it (${JSON.stringify(a.music)})`);
    // Cruise opens in the Boat view, the bar's view button says so (owner, 2026-11-15: Cinematic last)
    const vw = await page.evaluate(() => document.querySelector('.lk-view.cruisecam [data-x=views]')?.textContent.trim() ?? '');
    check(a.c.view === 'astern' && /^Boat/.test(vw), `Cruise opens in the Boat view, the bar reads "${vw}" (view ${a.c.view})`);
    // C steps the cameras
    await page.keyboard.press('KeyC'); await page.waitForTimeout(300);
    const c1 = (await S(page)).c.view; await page.keyboard.press('KeyC'); await page.waitForTimeout(300);
    const c2 = (await S(page)).c.view;
    check(c1 === 'above' && c2 === 'helm', `C steps the cameras (astern → ${c1} → ${c2})`);
    check((await S(page)).mode === 'cruise', 'C is the passenger\'s: she still sails herself');
    await page.keyboard.press('Shift+KeyC'); await page.keyboard.press('Shift+KeyC'); await page.keyboard.press('Shift+KeyC'); await page.waitForTimeout(1300);
    check((await S(page)).c.view === 'cinematic', 'Shift+C steps back (helm → above → astern → cinematic, the end of the list)');
    await page.keyboard.press('KeyC'); await page.waitForTimeout(1300);
    check((await S(page)).c.view === 'astern', 'C from Cinematic: round to Boat');
    // the old Locker's rows: Glasses and Photo in the View menu, VHF in the Conditions sheet (Chart is on the bar, Logbook on the Menu card)
    await wake(page);
    await page.click('.lk-view.cruisecam [data-x=views]'); await page.waitForTimeout(250);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lk-timepick')].filter((m) => !m.hidden).flatMap((m) => [...m.querySelectorAll('button')].map((b) => b.textContent.trim())));
    check(rows.includes('Glasses') && rows.includes('Photo'), `the View menu holds Glasses and Photo: ${JSON.stringify(rows)}`);
    check(JSON.stringify(rows.slice(0, 5)) === JSON.stringify(['Boat', 'Above', 'Helm', 'Island', 'Cinematic']), `the View menu: Boat first, Cinematic last of the cameras (${JSON.stringify(rows.slice(0, 5))})`);
    await page.click('.lk-view.cruisecam [data-x=views]'); await page.waitForTimeout(200);
    await page.click('.lk-view.cruisecam [data-x=cond]'); await page.waitForTimeout(250);
    check(await page.evaluate(() => !!document.querySelector('.lk-cond:not([hidden]) .vhf')), 'the Conditions sheet holds the VHF');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await page.evaluate(() => window.__velia.m4.front?.home?.isOpen)) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
    // your mark: a double-click on the water
    const spot = await page.evaluate(() => window.__velia.cruise.c.markSpot());
    check(!!spot, `a spot on the water that takes a mark (${JSON.stringify(spot)})`);
    if (spot) {
      await page.mouse.click(spot[0], spot[1]); await page.waitForTimeout(80); await page.mouse.click(spot[0], spot[1]); await page.waitForTimeout(400);
      const m = await S(page);
      check(m.c.dest === 'your mark' && !/your mark/.test(m.line), `the double-click sets your mark, and the line stays quiet (the lean skipper, owner 2026-11-17: a confirmation is chatter; dest ${m.c.dest}; "${m.line}")`);
      const lit = await page.evaluate(() => { const r = document.querySelector('.lk-mark:not([hidden])'); return r ? r.getBoundingClientRect() : null; });
      check(!!lit, 'the amber ring on the mark');
      if (lit) {
        const cx = lit.x + lit.width / 2, cy = lit.y + lit.height / 2;
        await page.mouse.click(cx, cy); await page.waitForTimeout(80); await page.mouse.click(cx, cy); await page.waitForTimeout(400);
        const k = await S(page);
        check(k.c.dest === null && !/cleared/.test(k.line), `a double-click on the ring clears it, quietly ("${k.line}")`);
      }
    }
    // the hand-over: a steering key takes the helm (the new bar has no Take the helm button), then ` back
    await wake(page);
    await page.keyboard.down('KeyA'); await page.waitForTimeout(120); await page.keyboard.up('KeyA'); await page.waitForTimeout(1500);
    const h = await S(page); await page.waitForTimeout(2000); const h2 = await S(page);
    const sail = (h2.t - h.t) / (h2.wall - h.wall);
    check(h.mode === 'sail' && !h.c.on && h.c.helm === 'player' && h.sailBar && !h.cruiseBar, `A takes the helm: Sail's bar, the player's hands (${JSON.stringify({ mode: h.mode, line: h.line })})`);
    check(!/You have the helm/.test(h.line), `no "You have the helm" line: the lean skipper's chatter ("${h.line}")`);
    check(sail > 1.6 && sail < 2.4, `Sail's 2 × after the hand-over (${sail.toFixed(2)})`);
    check(h.music?.mode === 'sail' && !h.music.player, `music: the hand-over gives the bus back to Sail's beds (${JSON.stringify(h.music)})`);
    check(await page.evaluate(() => !!window.__velia.m4.ui.station?.cockpit), 'Sail\'s cockpit station is up');
    await page.keyboard.press('Backquote'); await page.waitForTimeout(800);
    check((await S(page)).mode === 'sail', ': the ` key does nothing now: still Sail');
    await page.evaluate(() => document.querySelector('.lk-view:not(.off) .xt[data-x=mode]').click()); await page.waitForTimeout(1500);
    const back = await S(page);
    check(back.mode === 'cruise' && back.c.on && back.cruiseBar && !back.sailBar, `the top bar's Cruise button hands her back: she sails herself (${back.c.view}; "${back.line}")`);
    check(back.music?.mode === 'cruise' && back.music.playlist && back.music.started, `music: the playlist again, the sound running since the first gesture (${JSON.stringify(back.music)})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
  }
  // ---------------- the card: from Sail, the Menu card's Cruise pick enters Cruise ----------------
  {
    const { page, errors } = await open('mode=sail&once=0&seed=1&kayaks=0&attract=0&start=1200,-1050&heading=251', { person: true });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front && window.__velia.m4.ui, null, { timeout: 240000 });
    await page.waitForFunction(() => window.__velia._stats().terrain.streamed, null, { timeout: 240000 });
    await pickMode(page, 'cruise');
    await page.waitForFunction(() => window.__velia.cruise?.c?.on, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ mode: window.__velia._stats().mode, card: window.__veliaLoading.state, plan: window.__velia.m4.front.home.mode, on: !!window.__velia.cruise.c?.on }));
    check(r.on && r.mode === 'cruise' && r.plan === 'cruise', `the card's Cruise enters Cruise (${JSON.stringify(r)})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
  }
  // ---------------- Sail left her at anchor, then the card's Cruise: she sails from Cruise's start at v1's pace within 30 s ----------------
  // (BACKLOG-v2 #58: place() called a seamanship reset that did not exist; the old tackle flung her km off and held her there)
  {
    const { page, errors } = await open('mode=sail&once=0&seed=1&kayaks=0&attract=0&start=1200,-1050&heading=251', { person: true });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front && window.__velia.m4.ui, null, { timeout: 240000 });
    await page.waitForFunction(() => window.__velia._stats().terrain.streamed, null, { timeout: 240000 });
    // the boat stopped in Sail, the sails down, the anchor let go until it holds
    await page.evaluate(() => { const B = window.__velia.boat.sim, s = B.state; B.place({ x: s.x, z: s.z, headingDeg: s.heading * 180 / Math.PI, speed: 0 }); window.__velia.sea.actions.sails(); });
    const dropped = await page.evaluate(async () => {
      const sea = window.__velia.sea; let r = null;
      for (let k = 0; k < 40 && r !== 'drop'; k++) { await new Promise((ok) => setTimeout(ok, 500)); r = sea.actions.anchor(); }
      return r;
    });
    await page.waitForFunction(() => window.__velia.sea.held, null, { timeout: 60000 }).catch(() => {});
    const held = await page.evaluate(() => ({ held: window.__velia.sea.held, phase: window.__velia.sea.state.anchor.phase }));
    check(dropped === 'drop' && held.held, `Sail: she lies to her anchor (${dropped}, ${JSON.stringify(held)})`);
    await pickMode(page, 'cruise');
    await page.waitForFunction(() => window.__velia.cruise?.c?.on, null, { timeout: 60000 }).catch(() => {});
    const KN = 0.514444, p0 = await page.evaluate(() => { const s = window.__velia.boat.state; return { x: s.x, z: s.z, mode: window.__velia.sea.state.mode }; });
    let reach = null, maxKn = 0, sumKn = 0, n = 0;
    for (let s = 1; s <= 30; s++) {
      await page.waitForTimeout(1000);
      const kn = await page.evaluate((k) => window.__velia.boat.state.sog / k, KN);
      maxKn = Math.max(maxKn, kn); if (reach == null && kn > 2) reach = s; if (s > 5) { sumKn += kn; n++; }
    }
    const p1 = await page.evaluate(() => { const s = window.__velia.boat.state; return { x: s.x, z: s.z }; }), d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    check(p0.mode === 'free', `Cruise's fresh boat: the anchor aboard (${p0.mode})`);
    check(reach != null && sumKn / n > 3 && sumKn / n < 6, `she sails at v1's Cruise pace (v1 3.4-5 kn): over 2 kn at ${reach} s, mean ${(sumKn / n).toFixed(2)} kn, max ${maxKn.toFixed(2)} kn`);
    check(d > 30 && d < 200, `she made way from Cruise's start (${d.toFixed(1)} m in 30 s)`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
  }
  // ---------------- the idle attract (v1's: untouched on the card, the card slides aside and Cruise plays; a key brings it back) ----------------
  {
    const { page, errors } = await open('mode=sail&once=0&seed=1&kayaks=0&attract=1&attractS=4', { person: true });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front && window.__velia._stats().terrain.streamed, null, { timeout: 240000 });
    await page.waitForFunction(() => window.__veliaLoading.state === 'attract' && window.__velia.cruise?.c?.on, null, { timeout: 60000 }).catch(() => {});
    const a = await page.evaluate(() => ({ card: window.__veliaLoading.state, mode: window.__velia._stats().mode, plan: window.__velia.m4.front.home.mode, view: window.__velia.cruise?.stats().view }));
    check(a.card === 'attract' && a.mode === 'cruise' && a.plan === 'sail', `untouched: the card slides aside and Cruise plays, the plan stays Sail (${JSON.stringify(a)})`);
    check(a.view === 'astern', `the attract plays Cruise in the Boat view (owner, 2026-11-15: Cinematic last) (${a.view})`);
    await page.keyboard.press('KeyX');
    await page.waitForFunction(() => window.__veliaLoading.state === 'home' && window.__velia._stats().mode === 'sail', null, { timeout: 20000 }).catch(() => {});
    const b = await page.evaluate(() => ({ card: window.__veliaLoading.state, mode: window.__velia._stats().mode }));
    check(b.card === 'home' && b.mode === 'sail', `a key brings the card and Sail back (${JSON.stringify(b)})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
