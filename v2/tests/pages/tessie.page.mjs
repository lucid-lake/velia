// Tessie on the real page (M1; owner, 2026-11-17: desktop only, 0 cost on phones, loaded after the card):
//   desktop (1280 × 720, a returning player, no input): her plug-in exists, her group 'tessie' (7 pipelines: body, mirror, water map, bed shadow, drops, mist, the revenge's gloom) is built after
//     the first frame, the first frame's pipeline count is the same as with ?tessie=0, none built late; her model is fetched
//     only after play starts; the first sighting is placed (?tessie=24: its break at 24 s of play) and in the frame
//   phone (an iPhone on its side, touch): no plug-in, no group, no request for her model, the stats say why
//   ?headless=1 (a golden): she is off unless the URL asks
//   her mark on the chart (owner 2026-11-17): on a desktop the small chart (the cockpit's dial) draws her water's glyph with its ring; the live map (the
//     menu's screen) lists her water as a point whose card sets Sail's mark at her edge (the beacon lights on it); inside her water the ring stops (and stays off after a reload); a phone has no
//     mark and never fetches its code
//   her revenge (TK): a scripted charge sets her off (the gloom drawn, the drone, the beds' dip, the MUST line); a boat that stops
//     is rolled: the end card "Tessie said no." / "Give her room.", the boat still capsized behind it 10 s on (owner, 2026-11-20), Start again
//     rights her; under reduced motion no gloom is drawn
// Run by `npm run test:pages:v2 -- tessie` (LAKESHORE_BASE set), or node v2/tests/pages/tessie.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { openMap, closeMap } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const RETURNING = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true })); } catch {} };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

const SEEN = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); localStorage.removeItem('lakeshore.course.v1'); } catch {} };
const CHART_Q = 'mode=sail&seed=1&wind=3&noload=1&attract=0&fv=1&once=0&hm=0&chatter=0&hour=13&tessie=1';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open(q, opts = {}) {
  const { seen, ...copts } = opts;
  const ctx = await browser.newContext(copts);
  const page = await ctx.newPage();
  const errors = [], glb = [], js = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => { if (/tessie\.glb/.test(r.url())) glb.push(performance.now()); if (/living\/tessie|\/tessie-[\w-]+\.js|render\/tessie|sim\/tessie|tessieMark/.test(r.url())) js.push(r.url()); });
  await page.addInitScript(PERSON); await page.addInitScript(opts.seen ? SEEN : RETURNING);
  await page.goto(`${BASE}/${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
  return { ctx, page, errors, glb, js };
}
const pipes = (page) => page.evaluate(() => { const s = window.__velia.stats(); return { first: s.pipelines.timings?.n ?? null, late: s.pipelines.afterFirstFrame, groups: s.pipelines.groups, tessie: s.tessie }; });
try {
  // desktop: the first frame's pipelines with and without her
  const off = await open('?seed=1&tessie=0', { viewport: { width: 1280, height: 720 } });
  const p0 = await pipes(off.page); await off.ctx.close();
  const d = await open('?seed=1&tessie=24', { viewport: { width: 1280, height: 720 } });
  const p1 = await pipes(d.page);
  check(p1.first === p0.first, `desktop: the first frame builds the same pipelines with her as without (${p1.first} / ${p0.first})`);
  check(p1.groups?.tessie?.n === 7, `desktop: her group holds 7 pipelines (${JSON.stringify(p1.groups?.tessie)})`);
  await d.page.waitForFunction(() => window.__velia.tessie?.sim?.sightings?.length > 0 && window.__velia.tessie.sim.state.phase !== 'rise', null, { timeout: 120000 }).catch(() => {});
  const s = await d.page.evaluate(() => { const T = window.__velia.tessie; const st = T.stats(); const p = window.__velia.stats().pipelines; return { st, late: p.afterFirstFrame, ready: p.groups?.tessie?.ready }; });
  check(s.late === 0 && s.ready === true, `desktop: her group built after the first frame, nothing built late (${s.late})`);
  check(s.st.ms.assetMs != null && s.st.ms.playAt != null && s.st.ms.assetMs >= s.st.ms.playAt, `desktop: her model fetched after play started (${s.st.ms.playAt} → ${s.st.ms.assetMs} ms)`);
  const sg = s.st.sightings[0];
  // her opening row (v2/stage/acts.js: atS 25, jitterS 1.5, seeded) and the page's play clock, which runs ≈ 1 s behind the director's
  // (24 s for a 25 s row); since 2026-11-18 she is the opening's first row (the kayaks' 0 s pair retired), so her seeded jitter is the first draw
  check(!!sg && Math.abs(sg.breakAt - 24) <= 1.5 + 0.6 && sg.inView === true, `desktop: the first sighting breaks at ${sg?.breakAt} s of play, in view (${sg?.R} m, ${sg?.bear}°)`);
  check(d.js.length > 0, `desktop: her code chunk is requested (${d.js.length})`);
  // M2: her splashes and her sound (synthesised: rendered offline here from the voices the page plays)
  check(s.st.fx && Object.keys(s.st.fx.events).length > 0, `desktop: her events feed the splashes (${JSON.stringify(s.st.fx?.events)})`);
  const snd = await d.page.evaluate(async () => {
    const m = await import('/living/tessie-sound.js');
    const r = await m.renderTessieSound({ seconds: 6, events: ['break', 'breath', 'slap', 'dive'].map((type, i) => ({ type, t: i * 1.3, x: 20, z: -30, s: 1, cam: { x: 0, z: 0, yaw: 0 } })) });
    let sum = 0, peak = 0, bad = 0; for (const ch of r.channels) for (const v of ch) { if (!Number.isFinite(v)) bad++; sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    return { rms: Math.sqrt(sum / (r.channels[0].length * 2)), peak, bad, right: r.channels[1].reduce((a, v) => a + v * v, 0) > r.channels[0].reduce((a, v) => a + v * v, 0) };
  });
  check(snd.bad === 0 && snd.rms > 0.005 && snd.peak < 1.0 && snd.right, `desktop: her sound renders (rms ${snd.rms.toFixed(3)}, peak ${snd.peak.toFixed(2)}, from her side: ${snd.right})`);
  //: each of her played voices renders finite, audible and calm (the dash, the ready tick, the wind-up, the knock on wood and fibreglass, the creak, the lock, the plunge, the burst)
  const pv = await d.page.evaluate(async () => {
    const m = await import('/living/tessie-sound.js'), out = {};
    for (const [name, e] of [['dash', {}], ['ready', {}], ['windup', { kind: 'rail' }], ['knockWood', { type: 'knock', boat: 'halcyon' }], ['knockGlass', { type: 'knock', boat: 'sail' }], ['knockBelow', { type: 'knock', boat: 'sail', where: 'bottom' }], ['creak', {}], ['lock', {}], ['riseStart', {}], ['under', {}], ['break', {}]]) {
      const r = await m.renderTessieSound({ seconds: 3.5, events: [{ type: e.type ?? name.replace(/Wood|Glass|Below/, ''), t: 0.05, x: 0, z: 0, s: 1, ...e, cam: { x: 0, z: 0, yaw: 0 } }] });
      let peak = 0, bad = 0; for (const ch of r.channels) for (const v of ch) { if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); }
      out[name] = { peak: +peak.toFixed(3), bad };
    }
    return out;
  });
  check(Object.values(pv).every((v) => v.bad === 0 && v.peak > 0.001 && v.peak < 0.9), `desktop: her played voices render finite, audible, under 0.9 (${JSON.stringify(pv)})`);
  check(d.errors.length === 0, `desktop: no page errors (${d.errors.slice(0, 2).join(' | ')})`);
  await d.ctx.close();
  // her mark on the chart: from 200 m east of her water (the ring), the small chart draws it; on the live map her
  // water is a point whose card sets the mark and lights the beacon; then the boat inside her water: the ring stops
  const c = await open(`?${CHART_Q}&start=700,-160&heading=265`, { viewport: { width: 1280, height: 720 }, seen: true });
  await c.page.waitForFunction(() => window.__velia.m4?.ui?.chart?.chart && window.__velia.beacon && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  const areas = () => c.page.evaluate(() => window.__velia.m4.ui.chart.chart.state.areas);
  const small = await c.page.waitForFunction(() => window.__velia.m4.ui.chart.chart.state.areas.small.some((a) => a.glyph), null, { timeout: 60000 }).then(() => true, () => false);
  const a0 = await areas();
  // the size rule: smaller than Fannette Island (162 m) drawn at the same scale, at each chart's default zoom; floors and caps
  const ISLAND_M = 162;
  const sc = await c.page.evaluate(() => { const st = window.__velia.m4.ui.chart.chart.state, s = document.querySelector('.lk-chart .small canvas').clientWidth;   /* its layout size (the cockpit's dial shows it scaled) */ return { small: 1000 / (s / 2), zoom: st.zoom, rangeM: st.rangeM }; });
  check(small && a0.small[0]?.id === 'tessieWaters' && a0.small[0].ring && a0.small[0].w >= 12 && a0.small[0].w <= 20 && a0.small[0].w < ISLAND_M / sc.small, `chart: the small chart (the dial's map) draws her glyph, ${a0.small[0]?.w?.toFixed(1)} px, under the island's ${(ISLAND_M / sc.small).toFixed(1)} px, with its ring`);
  // the live map (Phase 2b: the menu's screen, opened by Menu, Esc or N) replaced the enlarged chart. It draws her water as
  // an area point (a dashed ring when lifted, no glyph, no skipper's flash: the card carries her line), so what is tested there is
  // that the point exists, its card's Set as target puts Sail's mark at her edge toward the boat, and the beacon lights on it
  await openMap(c.page);
  const pt = await c.page.evaluate(() => (window.__velia.m4.ui.services.get('liveChart').state.pois ?? []).find((p) => p.id === 'ar-tessieWaters') ?? null);
  check(pt?.kind === 'area', `live map: her water is a point on the map (${pt?.id})`);
  await c.page.evaluate(() => { window.__velia.beacon?.mark?.clear?.(); window.__velia.m4.ui.services.get('liveChart').focus('ar-tessieWaters'); });
  await c.page.waitForFunction(() => window.__velia.m4.ui.services.get('liveChart').state.card?.name === "Tessie's water", null, { timeout: 8000 }).catch(() => {});
  const card = await c.page.evaluate(() => ({ st: window.__velia.m4.ui.services.get('liveChart').state.card, text: document.querySelector('.lk-livechart .lkc-card')?.textContent ?? '' }));
  check(card.st?.name === "Tessie's water" && card.st.action === 'Set as target' && card.text.includes('Give her room.'), `live map: her card names her water, offers Set as target and says her line (${JSON.stringify(card.st)})`);
  await c.page.click('.lk-livechart .lkc-card .go');
  const routed = await c.page.waitForFunction(() => !!window.__velia.beacon?.mark?.mark, null, { timeout: 8000 }).then(() => true, () => false);
  await c.page.waitForTimeout(600);
  const tap = await c.page.evaluate(() => { const s = window.__velia.beacon.state(); return { mark: window.__velia.beacon.mark.mark, beacon: { x: s.x, z: s.z, phase: s.phase } }; });
  const wp = tap.mark ?? {}, inW = Math.hypot(wp.x - 300, wp.z + 130);
  check(routed && inW > 150 && inW <= 210, `live map: Set as target puts the mark at her edge toward the boat (${JSON.stringify(tap.mark)}, ${inW.toFixed(0)} m from her centre)`);
  check((tap.beacon.phase === 'in' || tap.beacon.phase === 'on') && Math.hypot(tap.beacon.x - wp.x, tap.beacon.z - wp.z) < 30, `live map: the beacon lights on her water (${JSON.stringify(tap.beacon)})`);
  await closeMap(c.page);
  await c.page.evaluate(() => { const b = window.__velia.boat; b.state.x = 330; b.state.z = -120; if (b.phys?.state) { b.phys.state.x = 330; b.phys.state.z = -120; } });
  const visited = await c.page.waitForFunction(() => window.__velia.m4.ui.chart.chart.state.areas.small.every((a) => !a.ring) && localStorage.getItem('lakeshore.tessieWaters.v1') === '1', null, { timeout: 8000 }).then(() => true, () => false);
  check(visited, `chart: inside her water the ring stops on the small chart, kept on the device (${JSON.stringify((await areas()).small)})`);
  check(c.errors.length === 0, `chart: no page errors (${c.errors.slice(0, 2).join(' | ')})`);
  await c.ctx.close();
  // TK, her revenge: a scripted charge on the live page (she is put up 50 m ahead of the boat, which sails at
  // her): she dives, the drone and the gloom rise (its quad drawn), the MUST line shows, the beds dip; then the boat stops head to
  // wind and she rolls it: the end card "Tessie said no." / "Give her room."; under reduced motion the gloom is never drawn
  for (const reduced of [false, true]) {
    const r = await open(`?${CHART_Q}&stage=off&kayaks=0`, { viewport: { width: 1280, height: 720 }, seen: true, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await r.page.waitForFunction(() => window.__velia.tessie?.render?.ready, null, { timeout: 120000 }).catch(() => {});
    await r.page.evaluate(() => {
      const V = window.__velia, B = V.boat.sim, T = V.tessie, s = B.state, w = V.boat.wind.sample(s.x, s.z, B.t);
      const hm = V.m4.front.home; if (hm.isOpen) hm.close();
      const h = Math.atan2(-w.vx, w.vz) + 95 * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
      B.place({ x: 330, z: -120, headingDeg: h * 180 / Math.PI, speed: 3.5 }); B.holdCourse(h); B.assists.crewTrim = true;
      T.sim.ambush(330 + fx * 90 - Math.cos(h) * 16, -120 + fz * 90 - Math.sin(h) * 16, h + Math.PI / 2); T.sim.hunt(false);
      window.__tk = { lines: [], gloomDrawn: 0, droneMax: 0, dipMin: 1 };
      const tick = () => { const R = T.revenge, k = window.__tk; k.gloomDrawn = Math.max(k.gloomDrawn, T.render.stats.gloom ?? 0); k.droneMax = Math.max(k.droneMax, R.state.drone); k.dipMin = Math.min(k.dipMin, T.dip()); const t = V.m4.ui?.hint?.el?.textContent ?? ''; if (t && !k.lines.includes(t)) k.lines.push(t);
        // the charge: the pilot steers at her middle until she goes (the player charging her), then holds the course
        if (R.state.count === 0 && T.sim.state.visible && T.sim.state.phase !== 'rise') { const c = T.sim.state.centre; B.holdCourse(Math.atan2(c[0] - B.state.x, -(c[1] - B.state.z))); }
        if (R.state.phase === 'chase' && !k.luffed) { k.luffed = true; const ww = V.boat.wind.sample(B.state.x, B.state.z, B.t); B.holdCourse(Math.atan2(-ww.vx, ww.vz)); B.assists.crewTrim = false; } requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const trig = await r.page.waitForFunction(() => window.__velia.tessie.revenge.state.count > 0, null, { timeout: 30000 }).then(() => true, () => false);
    check(trig, `revenge${reduced ? ' (reduced motion)' : ''}: the scripted charge sets her off`);
    const card = reduced ? false : await r.page.waitForFunction(() => { const c = document.getElementById('lk-end'); return c && !c.hidden && c.dataset.cause === 'tessie'; }, null, { timeout: 90000 }).then(() => true, () => false);
    if (reduced) await r.page.waitForFunction(() => window.__velia.tessie.revenge.state.phase === 'chase', null, { timeout: 30000 }).catch(() => {});
    const k = await r.page.evaluate(() => ({ ...window.__tk, card: document.getElementById('lk-end')?.textContent ?? null, result: window.__velia.tessie.revenge.state.result, stage: window.__velia.stats().tessie?.revenge?.phase }));
    if (!reduced) {
      check(k.gloomDrawn > 0.15 && k.droneMax > 0.9 && k.dipMin < 0.6, `revenge: the gloom drawn (${k.gloomDrawn}), the drone (${k.droneMax.toFixed(2)}), the beds dipped (${k.dipMin.toFixed(2)})`);
      check(k.lines.some((t) => /She’s coming back\. Sail!/.test(t)), `revenge: the MUST line shows (${JSON.stringify(k.lines.slice(-3))})`);
      check(card && /Tessie said no\./.test(k.card) && /Give her room\./.test(k.card), `revenge: caught, the end card reads hers ("${(k.card ?? '').slice(0, 80)}"; ${k.result})`);
      // she stays capsized behind the card (owner, 2026-11-20): still on her side 10 s on; Start again rights her and sails on
      await r.page.waitForTimeout(10000);
      const cap = await r.page.evaluate(() => ({ heel: Math.abs(window.__velia.boat.sim.state.heel) * 180 / Math.PI, held: window.__velia.boat.sim.capsized, card: !document.getElementById('lk-end')?.hidden }));
      check(cap.held && cap.heel > 70 && cap.card, `revenge: capsized behind the card, still on her side 10 s on (${cap.heel.toFixed(0)}°, held ${cap.held})`);
      if (process.env.LAKESHORE_SHOT) await r.page.screenshot({ path: process.env.LAKESHORE_SHOT });
      await r.page.click('#lk-end .again');
      await r.page.waitForTimeout(3000);
      const again = await r.page.evaluate(() => ({ heel: Math.abs(window.__velia.boat.sim.state.heel) * 180 / Math.PI, held: window.__velia.boat.sim.capsized, card: !document.getElementById('lk-end')?.hidden }));
      check(!again.held && !again.card && again.heel < 30, `revenge: Start again: the card gone, upright and sailing (${again.heel.toFixed(0)}°)`);
    } else check(k.gloomDrawn === 0 && k.droneMax > 0.5, `revenge (reduced motion): no gloom drawn (${k.gloomDrawn}), the drone still rises (${k.droneMax.toFixed(2)})`);
    check(r.errors.length === 0, `revenge: no page errors (${r.errors.slice(0, 2).join(' | ')})`);
    await r.ctx.close();
  }
  // a phone on its side: nothing of her
  const ph = await open('?seed=1', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE });
  await ph.page.waitForTimeout(8000);
  const pp = await pipes(ph.page);
  check(pp.tessie?.off && !pp.groups?.tessie, `phone: no plug-in, no group (${JSON.stringify(pp.tessie)})`);
  check(ph.glb.length === 0, 'phone: her model is never requested');
  check(ph.js.length === 0, `phone: none of her code is requested (${ph.js.join(' ')})`);
  check(await ph.page.evaluate(() => window.__velia.tessie === null), 'phone: no Tessie on the hook');
  check(await ph.page.evaluate(() => { const st = window.__velia.m4?.ui?.chart?.chart?.state; return !st || (st.areas.small.length === 0 && st.areas.big.length === 0); }), 'phone: no mark on the chart');
  await ph.ctx.close();
  // a golden's capture: off unless asked
  const g = await open('?seed=1&hour=13&headless=1', { viewport: { width: 1280, height: 720 } });
  const pg = await pipes(g.page);
  check(pg.tessie?.off && g.glb.length === 0, `capture: off without ?tessie= (${JSON.stringify(pg.tessie)})`);
  await g.ctx.close();
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
