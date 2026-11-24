// Regatta's place races on a live v2 page (owner go 2026-11-19), the player sailed by ?autoplay (the fleet's own
// mind at &autotier, the scripted sailor):
//   1280 × 720   Pass the Channel (?course=pass-the-channel): the race at 20:40, three rivals, the three channel gates rounded in order,
//                the finish, then the barges' salute (the fireworks plug-in's salute clock runs in the race, its stars live)
//   1280 × 720   Tea House Run (?course=tea-house-run): from Vikingsholm round Fannette (two marks) to the finish under the steps, four rivals, 15:00
//   844 × 390    an iPhone on its side: the same race, no fireworks plug-in, the salute not shown (the horn only)
//   1280 × 720   Tessie's Deep (&tessie=1): she rises on the player's course with the warning (the race's director, her sim visible
//                ahead of the bow in her water; no ring on the water, owner 2026-11-20); the race sails on to the finish
//   1280 × 720, 844 × 390   Leave race (owner, 2026-11-20): the watch's Leave asks "Leave race?" (Esc is No), the Menu card's Leave race row
//                (Esc is No, the card stays); Yes leaves for free Sail where she is, the race's HUD and fleet gone; a phone (no watch on its
//                flat controls) by the Menu card's row
//   Phase 2 (owner go 2026-11-19): Tessie's Deep's camera look toward her strike (the race camera turns, bounded, then back);
//   1280 × 720 Glass Boat Chase (Velia Travel just off her Fannette stop with her head start, under way at the gun, drawn in the race; the
//   finish names the catch); Storm Run (the page's storm builds from the gun); Lights on the Lake (21:42, the show let into the race at
//   21:44); 844 × 390 Lights on the Lake on a phone: the lit race, no fireworks plug-in
// Run by `npm run test:pages:v2 -- regattaPlaces`, or node v2/tests/pages/regattaPlaces.page.mjs --base http://127.0.0.1:<port>
// [--shots <dir>]: the stills (a gate threaded mid-race, Tessie surfacing, the salute at the finish, Leave race? on the watch)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function open(query, ctxOpts = { viewport: { width: 1280, height: 720 } }) {
  const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=regatta&once=0&seed=1&handseed=7&autoplay=1&autotier=hard${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 20, null, { timeout: 300000 });
  return { ctx, page, errors };
}
const st = (page) => page.evaluate(() => {
  const V = window.__velia, r = V.regatta.r, s = r.state();
  return { place: r.placeRace?.id ?? null, status: s.me?.status, clock: s.clock, rivals: r.session?.rivals?.length ?? null, rounds: r.stats.rounds.map((x) => x.mark), salute: r.salute, result: r.stats.result,
    fw: V.fireworks ? V.fireworks.stats().salute : null, fwOn: !!V.fireworks, deep: r.stats.deep, knocks: r.stats.knocks, hold: r.held, course: r.course?.place ?? null };
});
// sail on (the page's own sim in chunks, a frame between) until a test is true, or maxS of game time
const sailUntil = (page, fn, maxS = 700, chunk = 2) => page.evaluate(async ([src, maxS, chunk]) => {
  const r = window.__velia.regatta.r, f = new Function('r', `return (${src})(r)`);
  for (let s = 0; s < maxS && !f(r); s += chunk) { r.settle(chunk); await new Promise((ok) => requestAnimationFrame(() => ok())); }
  return f(r);
}, [fn.toString(), maxS, chunk]);

try {
  // ---- Pass the Channel, desktop: the gates, the finish, the salute ----
  const d = await open('&course=pass-the-channel');
  let s = await st(d.page);
  check(s.place === 'pass-the-channel' && s.course === 'pass-the-channel' && s.rivals === 3, `desktop: Pass the Channel in the box, 3 rivals (${s.place}, ${s.rivals})`);
  const hour = await d.page.evaluate(() => window.__velia.clock?.hour ?? null);
  check(hour == null || Math.abs((hour % 24) - (20 + 40 / 60)) < 0.2, `desktop: the race's hour is 20:40 (${hour})`);
  // mid-race: near gate 2, the gate's line on the water between its buoys
  const nearGate = await sailUntil(d.page, (r) => { const g = r.course.byId.G2, b = window.__velia.boat.state; return r.session.race.view('me').leg === 1 && Math.hypot(b.x - g.at[0], b.z - g.at[1]) < 70; }, 600, 0.5);
  check(nearGate, 'desktop: mid-race, the boat closes on gate 2 after gate 1');
  await d.page.waitForTimeout(600);
  await shot(d.page, 'pass-the-channel-gate');
  await sailUntil(d.page, (r) => r.state().me?.status === 'finished', 1000);
  s = await st(d.page);
  check(s.status === 'finished', `desktop: the scripted sailor finishes (${s.status} at ${s.clock?.toFixed?.(1)} s)`);
  check(JSON.stringify(s.rounds) === JSON.stringify(['G1', 'G2', 'G3']), `desktop: the three gates in order (${s.rounds})`);
  check(!!s.salute && s.salute.shown === true, `desktop: the salute fired at the finish (${JSON.stringify(s.salute)})`);
  check(s.fw?.on === true, `desktop: the fireworks plug-in plays the salute in the race (${JSON.stringify(s.fw)})`);
  await d.page.waitForTimeout(8500);   // real seconds: the first shells have burst
  const fw2 = await d.page.evaluate(() => window.__velia.fireworks.stats());
  check(fw2.salute.on && (fw2.live ?? fw2.stars ?? 1) > 0, `desktop: the salute's stars are up (t ${fw2.salute.t} s, live ${fw2.live ?? '?'})`);
  await shot(d.page, 'pass-the-channel-salute');
  check(d.errors.length === 0, `desktop: no page errors (${d.errors.slice(0, 2).join(' | ')})`);
  await d.ctx.close();

  // ---- Leave race (owner, 2026-11-20): the watch's Leave asks first (Esc is No), Yes leaves for free Sail where she is; the Menu card's
  // Leave race row (Esc is No, the card stays), Yes leaves and closes the card ----
  for (const [vn, opt] of [['desktop', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA }]]) {
    const ctx = await browser.newContext(opt), page = await ctx.newPage(), errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript((s2) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s2)); } catch { /* blocked */ } Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }); }, SEEN);
    await page.goto(`${BASE}/?mode=regatta&once=0&seed=1&handseed=7&attract=0&flyover=0&course=pass-the-channel`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 20 && window.__veliaLoading?.state !== 'company', null, { timeout: 300000 });
    if (await page.evaluate(() => document.getElementById('lk-load')?.dataset.state === 'home')) {   // the first card: into the race
      await page.evaluate(() => { const g = document.querySelector('#lk-load .lk-links .lk-go'); if (g && g.getClientRects().length) g.click(); else document.querySelector('#lk-load .lk-pick[data-mode=regatta]')?.click(); });
      await page.waitForFunction(() => document.getElementById('lk-load')?.dataset.state === 'gone', null, { timeout: 20000 }).catch(() => {});
    }
    await page.waitForTimeout(1500);
    const look = () => page.evaluate(() => { const r = window.__velia.regatta.r, q = document.querySelector('#rg .lq'), b = window.__velia.boat.state, L = document.getElementById('lk-load');
      return { on: r.on, mode: window.__velia.mode.now(), live: r.inProgress, ask: !!q && !q.hidden, card: L?.dataset.state, race: L?.hasAttribute('data-race'), row: !!document.querySelector('#lk-load .lk-leave .lk-leave-b')?.getClientRects().length,
        rowAsk: !!document.querySelector('#lk-load .lk-leave .lk-leave-q:not([hidden])'), x: b.x, z: b.z, rivals: window.__velia.boat.render?.rivals ?? null, lines: !!r.on }; });
    let k = await look();
    check(k.on && k.mode === 'regatta' && k.live, `${vn} leave: in the race, in progress (${JSON.stringify(k)})`);
    // the watch's Leave (desktop; a phone's flat controls hide the watch: its way is the Menu card): the question, Esc is No
    if (vn === 'desktop') {
      await page.click('#rg .watch .lvr'); await page.waitForTimeout(300);
      k = await look();
      check(k.ask && k.on, `${vn} leave: the watch's Leave asks "Leave race?" (${JSON.stringify(k)})`);
      await shot(page, 'leave-race-ask');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      k = await look();
      check(!k.ask && k.on && k.card !== 'menu', `${vn} leave: Esc answers No: the race goes on, no Menu card (${JSON.stringify(k)})`);
      // the Menu card's row: Esc opens the card, Leave race asks, Esc is No (the card stays), then Yes leaves and the card closes
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('lk-load')?.dataset.state === 'menu', null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
      k = await look();
      check(k.card === 'menu' && k.race && k.row, `${vn} leave: the Menu card shows Leave race in a race (${JSON.stringify(k)})`);
      await page.click('#lk-load .lk-leave .lk-leave-b'); await page.waitForTimeout(300);
      k = await look();
      check(k.rowAsk, `${vn} leave: the row asks "Leave race?" (${JSON.stringify(k)})`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      k = await look();
      check(!k.rowAsk && k.card === 'menu' && k.on, `${vn} leave: Esc answers No and the card stays (${JSON.stringify(k)})`);
      await page.click('#lk-load .lk-leave .lk-leave-b'); await page.waitForTimeout(200);
      const at = await look();
      await page.click('#lk-load .lk-leave .lk-leave-q .y'); await page.waitForTimeout(800);
      k = await look();
      check(!k.on && k.mode === 'sail' && k.card !== 'menu' && Math.hypot(k.x - at.x, k.z - at.z) < 25, `${vn} leave: Yes leaves for Sail where she is, the card closed (${JSON.stringify(k)}, ${Math.hypot(k.x - at.x, k.z - at.z).toFixed(1)} m on)`);
    } else {   // the phone: the top bar's Menu opens the card; Leave race asks, Yes leaves
      await page.evaluate(() => window.__velia.m4.front.home.open());
      await page.waitForFunction(() => document.getElementById('lk-load')?.dataset.state === 'menu', null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
      k = await look();
      check(k.card === 'menu' && k.race && k.row, `${vn} leave: the Menu card shows Leave race in a race (${JSON.stringify(k)})`);
      await shot(page, 'leave-race-phone-menu');
      await page.tap('#lk-load .lk-leave .lk-leave-b'); await page.waitForTimeout(300);
      k = await look();
      check(k.rowAsk, `${vn} leave: the row asks "Leave race?" (${JSON.stringify(k)})`);
      const at = await look();
      await page.tap('#lk-load .lk-leave .lk-leave-q .y'); await page.waitForTimeout(800);
      k = await look();
      check(!k.on && k.mode === 'sail' && k.card !== 'menu' && Math.hypot(k.x - at.x, k.z - at.z) < 25, `${vn} leave: Yes leaves for Sail where she is (${JSON.stringify(k)})`);
    }
    const left = await page.evaluate(() => ({ rg: !!document.getElementById('rg'), rivals: window.__velia.regatta.r.session }));
    check(!left.rg && left.rivals == null, `${vn} leave: the race's HUD and fleet are gone (${JSON.stringify(left)})`);
    check(errs.length === 0, `${vn} leave: no page errors (${errs.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }

  // ---- Tea House Run, desktop: round Fannette (M1 north, M2 east) and finish under the steps ----
  const h = await open('&course=tea-house-run');
  s = await st(h.page);
  check(s.place === 'tea-house-run' && s.course === 'tea-house-run' && s.rivals === 4, `tea house: Tea House Run in the box, 4 rivals (${s.place}, ${s.rivals})`);
  const hh = await h.page.evaluate(() => window.__velia.clock?.hour ?? null);
  check(hh == null || Math.abs((hh % 24) - 15) < 0.2, `tea house: the race's hour is 15:00 (${hh})`);
  const nearM1 = await sailUntil(h.page, (r) => { const m = r.course.byId.M1, b = window.__velia.boat.state; return r.session.race.view('me').leg === 0 && Math.hypot(b.x - m.at[0], b.z - m.at[1]) < 90; }, 600, 0.5);
  check(nearM1, 'tea house: mid-race, the boat closes on the north mark off Fannette');
  await h.page.waitForTimeout(600);
  await shot(h.page, 'tea-house-run-mid');
  await sailUntil(h.page, (r) => r.state().me?.status === 'finished', 1200);
  s = await st(h.page);
  check(s.status === 'finished', `tea house: the scripted sailor finishes (${s.status} at ${s.clock?.toFixed?.(1)} s)`);
  check(JSON.stringify(s.rounds) === JSON.stringify(['M1', 'M2']), `tea house: both marks in order (${s.rounds})`);
  check(h.errors.length === 0, `tea house: no page errors (${h.errors.slice(0, 2).join(' | ')})`);
  await h.ctx.close();

  // ---- Pass the Channel, a phone on its side: no fireworks, no salute ----
  const p = await open('&course=pass-the-channel', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  s = await st(p.page);
  check(!s.fwOn && s.place === 'pass-the-channel', `phone: the race runs with no fireworks plug-in (${s.fwOn}, ${s.place})`);
  await sailUntil(p.page, (r) => r.state().me?.status === 'finished', 1000);
  s = await st(p.page);
  check(s.status === 'finished' && !!s.salute && s.salute.shown === false, `phone: the finish, no salute shown (${s.status}, ${JSON.stringify(s.salute)})`);
  check(p.errors.length === 0, `phone: no page errors (${p.errors.slice(0, 2).join(' | ')})`);
  await p.ctx.close();

  // ---- Tessie's Deep, desktop: she hunts the fleet, attack after attack, each warned, then her breach ----
  const t = await open('&course=tessies-deep&tessie=1');
  s = await st(t.page);
  check(s.place === 'tessies-deep', `tessie: Tessie's Deep in the box (${s.place})`);
  const hasT = await t.page.evaluate(() => !!window.__velia.tessie);
  check(hasT, 'tessie: her plug-in exists on the desktop');
  // each attack: sail on to its warning; for one aimed at the player, real time from there (her swim runs on the living clock)
  let breach = null;
  for (let k = 0; k < 6 && !breach; k++) {
    const warned = await sailUntil(t.page, (r) => r.deep.state.phase === 'warn' && r.deep.state.n > (window.__lkSeen ?? 0), 200, 0.5);
    if (!warned) break;
    await t.page.evaluate(() => { window.__lkSeen = window.__velia.regatta.r.deep.state.n; });
    s = await st(t.page);
    if (s.deep?.target !== 'me') continue;
    const line = await t.page.evaluate(() => { const r = window.__velia.regatta.r; return [r.coach?.line?.text ?? '', JSON.stringify(r.stats.coach ?? [])].join(' | ').slice(0, 4000); });
    check(/Tessie is coming for you/.test(line), `tessie: the warning names the player (${line.slice(0, 120)})`);
    breach = await t.page.evaluate(async () => {
      const V = window.__velia, T = V.tessie, r = V.regatta.r, at = r.deep.state.at;
      let seenBreach = false, look = 0;
      for (let i = 0; i < 240; i++) { await new Promise((ok) => setTimeout(ok, 50)); if (T.sim.state.phase === 'breach') { seenBreach = true; break; } }
      for (let i = 0; i < 18; i++) { await new Promise((ok) => setTimeout(ok, 50)); look = Math.max(look, Math.abs(r.stats.look?.yawDeg ?? 0)); }   // the breach's top: her front 9 m clear of the water; the camera's look toward her
      const c = T.sim.state.centre, b = V.boat.state;
      for (let i = 0; i < 60; i++) { await new Promise((ok) => setTimeout(ok, 50)); look = Math.max(look, Math.abs(r.stats.look?.yawDeg ?? 0)); }
      return { seenBreach, phase: T.sim.state.phase, clips: T.sim.state.clips, at, toPlan: c ? Math.hypot(c[0] - at[0], c[1] - at[1]) : null, toBoat: c ? Math.hypot(c[0] - b.x, c[1] - b.z) : null, ring: r.deep.ring, look };
    });
    await shot(t.page, 'tessies-deep-breach');
  }
  check(!!breach?.seenBreach, `tessie: an attack on the player breaches, neck and head out (${JSON.stringify(breach)})`);
  check(breach && breach.toPlan != null && breach.toPlan < 40, `tessie: at the spot the race chose (${breach?.toPlan?.toFixed?.(0)} m off it, ${breach?.toBoat?.toFixed?.(0)} m from the boat)`);
  check(breach && breach.look > 3 && breach.look <= 38.5, `tessie: the race camera turns toward her strike, bounded (${breach?.look?.toFixed?.(1)}°)`);
  await sailUntil(t.page, (r) => r.state().me?.status === 'finished' || r.state().me?.status === 'dnf', 1000);
  s = await st(t.page);
  const n = await t.page.evaluate(() => window.__velia.regatta.r.deep.state.n);
  check(n >= 3, `tessie: she kept attacking through the race (${n} attacks)`);
  check(s.status === 'finished' || (s.status === 'dnf' && s.knocks.length === 2), `tessie: the race ends (${s.status}, knocks ${JSON.stringify(s.knocks)})`);
  check(t.errors.length === 0, `tessie: no page errors (${t.errors.slice(0, 2).join(' | ')})`);
  await t.ctx.close();

  // ---- Glass Boat Chase, desktop (phase 2): Velia Travel just off her stop with her head start, under way at the gun, in the race ----
  const g = await open('&course=glass-boat-chase');
  s = await st(g.page);
  const g0 = await g.page.evaluate(() => { const r = window.__velia.regatta.r, T = window.__velia.tour?.sim; return { glass: r.glassRace, held: !!T?.held, active: !!T?.active, x: T?.boat.x, z: T?.boat.z, wash: typeof r.session?.wash }; });
  check(s.place === 'glass-boat-chase' && s.rivals === 2 && g0.glass && g0.active && g0.wash === 'function', `glass: Glass Boat Chase in the box, 2 rivals, the glass boat on and her wash (${JSON.stringify(g0)})`);
  check(Math.hypot(g0.x + 140, g0.z - 60) < 60 && !g0.held, `glass: she has just left her Fannette stop, her head start (${g0.x?.toFixed?.(0)}, ${g0.z?.toFixed?.(0)})`);
  await sailUntil(g.page, (r) => r.state().clock > 20, 120, 0.5);
  await g.page.waitForTimeout(1500);   // her post runs on the page's frames: a few real seconds
  const g1 = await g.page.evaluate(() => { const T = window.__velia.tour.sim; return { held: T.held, v: T.boat.v, x: T.boat.x, z: T.boat.z }; });
  check(!g1.held && g1.v > 1, `glass: under way on her route after the gun (${JSON.stringify(g1)})`);
  // mid-race: the player close to her (the still), then on to the finish
  const close = await g.page.evaluate(async () => {
    const V = window.__velia, r = V.regatta.r, T = V.tour.sim;
    for (let i = 0; i < 1600; i++) { const b = V.boat.state; if (Math.hypot(b.x - T.boat.x, b.z - T.boat.z) < 220 && r.state().clock > 30) return true; r.settle(0.25); await new Promise((ok) => setTimeout(ok, 20)); }
    return false;
  });
  check(close, 'glass: mid-race, the player in the chase, within 220 m of Velia Travel');
  await g.page.waitForTimeout(900);
  await shot(g.page, 'glass-boat-chase-mid');
  await sailUntil(g.page, (r) => r.state().me?.status === 'finished', 1200);
  await sailUntil(g.page, (r) => !!r.stats.result, 60);
  s = await st(g.page);
  check(s.status === 'finished' && /Velia Travel/.test(s.result?.gap ?? ''), `glass: the finish at the Boat Camp buoy, the card names the catch (${s.status}, ${s.result?.gap})`);
  check(g.errors.length === 0, `glass: no page errors (${g.errors.slice(0, 2).join(' | ')})`);
  await g.ctx.close();

  // ---- Storm Run, desktop (phase 2): the page's storm builds from the gun ----
  const sr = await open('&course=storm-run');
  s = await st(sr.page);
  check(s.place === 'storm-run' && s.rivals === 4, `storm: Storm Run in the box, 4 rivals (${s.place}, ${s.rivals})`);
  const w0 = await sr.page.evaluate(() => window.__velia.storm.weather.on ?? 0);
  await sailUntil(sr.page, (r) => r.state().clock > 3, 120, 0.5);
  await sr.page.waitForTimeout(1200);
  const w1 = await sr.page.evaluate(() => ({ storm: window.__velia.regatta.r.stats.storm, running: !!window.__velia.storm.running }));
  check(w0 < 0.05 && w1.storm?.shown === true && w1.running, `storm: the storm starts at the gun (before ${w0}, ${JSON.stringify(w1)})`);
  await sailUntil(sr.page, (r) => ['finished', 'dnf'].includes(r.state().me?.status), 1200);
  s = await st(sr.page);
  check(['finished', 'dnf'].includes(s.status), `storm: the race ends at the mouth (${s.status}, knocks ${JSON.stringify(s.knocks)})`);
  check(sr.errors.length === 0, `storm: no page errors (${sr.errors.slice(0, 2).join(' | ')})`);
  await sr.ctx.close();

  // ---- Lights on the Lake, desktop (phase 2): 21:42, the show let into the race from 21:44 ----
  const ll = await open('&course=lights-on-the-lake');
  s = await st(ll.page);
  const lh = await ll.page.evaluate(() => ({ hour: window.__velia.clock?.hour ?? null, show: window.__velia.regatta.r.showRace }));
  check(s.place === 'lights-on-the-lake' && s.rivals === 5 && lh.show && Math.abs((lh.hour % 24) - (21 + 42 / 60)) < 0.05, `lights: the finale at 21:42, 5 rivals, the show let in (${JSON.stringify(lh)})`);
  await sailUntil(ll.page, (r) => r.state().clock > 30, 200, 0.5);
  // the day clock to just past 21:44 (two game minutes on at the race's pace would be a minute of real time): the show begins
  await ll.page.evaluate(() => { const c = window.__velia.clock; c.setHour(Math.floor(c.hourUnwrappedAt(c.t) / 24) * 24 + 21 + 44.05 / 60, c.t); });
  const lit = await ll.page.evaluate(async () => {
    const V = window.__velia;
    for (let i = 0; i < 200; i++) { await new Promise((ok) => setTimeout(ok, 100)); const f = V.fireworks.stats(); if (f.showT != null && f.showT > 12) return { showT: f.showT, live: f.live ?? null }; }
    return { showT: V.fireworks.stats().showT, live: null };
  });
  check(lit.showT != null && lit.showT > 12, `lights: the show runs in the race (show t ${lit.showT})`);
  await ll.page.waitForTimeout(1200);
  await shot(ll.page, 'lights-on-the-lake-show');
  check(ll.errors.length === 0, `lights: no page errors (${ll.errors.slice(0, 2).join(' | ')})`);
  await ll.ctx.close();

  // ---- Lights on the Lake, a phone: the lit race without the show ----
  const lp = await open('&course=lights-on-the-lake', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  s = await st(lp.page);
  check(s.place === 'lights-on-the-lake' && !s.fwOn, `lights phone: the race runs with no fireworks plug-in (${s.place}, ${s.fwOn})`);
  await sailUntil(lp.page, (r) => r.state().clock > 20, 200, 0.5);
  check(lp.errors.length === 0, `lights phone: no page errors (${lp.errors.slice(0, 2).join(' | ')})`);
  await lp.ctx.close();
} catch (e) {
  check(false, `threw: ${e?.stack ?? e}`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
