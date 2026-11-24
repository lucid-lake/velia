// AUTO to a target, every way a Sail player sets one (owner bug 2026-11-16: "it did not auto sail to the target, it just held the rudder
// and trim"; the target was a double-click on the water). Desktop 1280 × 720, a mouse. Each path: AUTO sails there (the navigator drives
// her, the target nearer), whichever came first, the target or AUTO:
//   double-click   a double-click on the water (Sail's mark, ui/sailMark.js), then AUTO a moment later; and AUTO first, then the mark
//   chart          the live map (the menu's map, Phase 2b): the water's card, Add waypoint (the draft's first waypoint), then AUTO; AUTO first,
//                  then Add waypoint and Set course; and the card's Set as target, then AUTO
//   live           AUTO sailing to one target, a new double-click: she re-targets to it
//   out of the bay  from Sail's start, a mark 6 km off on the open lake: AUTO sails for it and down the entrance channel through
//                 the bar (terrain/channel.js)
//   far           from the open lake (?start= off the bay's mouth), a mark 6 km off across the lake: AUTO sails there
//   engine         under engine AUTO motors there (no beat), the lever the player's
//   phone          844 × 390: the left corner's Auto is the same AUTO: a mark before or after the press, under sail and under engine,
//                  and a far mark (6 km across the lake, from off the bay's mouth)
// Run by `npm run test:pages:v2 -- autoTarget`, or node v2/tests/pages/autoTarget.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { enterFromCard, openMap, closeMap, waterAct } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const wait = (page, ms) => page.waitForTimeout(ms);

async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&once=0&seed=1&kayaks=0&attract=0&noload=1&hour=13&chatter=0&hud=full${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.services?.get('apHud') && window.__velia.beacon && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { page, errors };
}
const P = (page) => page.evaluate(() => { const ui = window.__velia.m4.ui, p = ui.services.get('pilot'), s = p.state, b = window.__velia.boat.state;
  const d = s.target ? Math.hypot(s.target.x - b.x, s.target.z - b.z) : null;
  return { mode: s.mode, key: s.target?.key ?? null, toKey: s.toKey, d, driven: window.__velia.boat.sim.driven, said: s.said, ring: ui.services.get('apHud').state.auto,
    hint: [...document.querySelectorAll('[class*=hint]')].map((e) => e.textContent.trim()).join(' | ') }; });
const auto = async (page) => { const r = await page.evaluate(() => { const h = window.__velia.m4.ui.services.get('apHud'), k = h.buttons.key.getBoundingClientRect(), G = h.geometry; return { x: k.x + k.width / 2 + G.ri + G.moon / 2, y: k.y + k.height / 2 }; }); await page.mouse.click(r.x, r.y); };   // the half-moon's middle
// a double-click on the water: the first screen row Sail's mark takes (its own checks), 140 m or more out
async function dblWater(page) {
  const fy = await page.evaluate(() => { const M = window.__velia.beacon.mark, W = innerWidth, H = innerHeight;
    for (const y of [0.55, 0.5, 0.6, 0.45, 0.62]) for (const x of [0.5, 0.42, 0.58]) { let got = null; const keep = M.set; M.set = (a, b) => { got = { a, b }; return got; }; try { M.at(W * x, H * y); } finally { M.set = keep; } if (got) return [x, y]; }
    return [0.5, 0.55]; });
  await page.mouse.move(640, 300); await wait(page, 200);
  await page.mouse.dblclick(1280 * fy[0], 720 * fy[1]); await wait(page, 600);
  return page.evaluate(() => window.__velia.beacon.mark?.mark ?? null);
}
// the live map's path (Phase 2b): the page with its card, Sail from the card, then she is put at (x, z) on heading h; the menu's map,
// the water's card (v2/tests/pages/liveMap.mjs)
async function openLive(place) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=sail&once=0&seed=1&kayaks=0&attract=0&hour=13&chatter=0&hud=full&chartground=webp`, { waitUntil: 'load' });
  await enterFromCard(page, 'sail', { place });
  await page.waitForFunction(() => !!window.__velia.m4.ui.services.get('apHud'), null, { timeout: 30000 });
  return { page, errors };
}
const mouseTap = (page) => (x, y) => page.mouse.click(x, y);
const IN_BAY = { x: -350, z: 150, headingDeg: 20 };
// she sails to it: AUTO's TO, the navigator driving, the target nearer by 10 m within 25 s
async function sails(page, what) {
  await page.waitForFunction(() => window.__velia.m4.ui.services.get('pilot').mode === 'to', null, { timeout: 15000 }).catch(() => {});
  await wait(page, 200);   // the buttons redraw on the next frame
  const a = await P(page);
  if (a.mode === 'to') await page.waitForFunction((d0) => { const s = window.__velia.m4.ui.services.get('pilot').state, b = window.__velia.boat.state; return s.target && Math.hypot(s.target.x - b.x, s.target.z - b.z) < d0 - 10; }, a.d, { timeout: 25000, polling: 500 }).catch(() => {});
  const b = await P(page);
  check(a.mode === 'to' && a.driven && a.ring && b.d < a.d - 10, `${what}: AUTO sails to it (${a.mode}, driven ${a.driven}, ring ${a.ring}; ${Math.round(a.d ?? -1)} → ${Math.round(b.d ?? -1)} m)`);
  return b;
}

try {
  // ---- a double-click, then AUTO a moment later (the owner's path) ----
  { const o = await open();
    const m = await dblWater(o.page);
    check(!!m, `double-click: a mark on the water (${m ? `${Math.round(m.x)}, ${Math.round(m.z)}` : 'none'})`);
    await wait(o.page, 300); await auto(o.page);
    await sails(o.page, 'double-click, then AUTO');
    // live: a new double-click while she sails to the first
    const k0 = (await P(o.page)).toKey;
    await o.page.evaluate(() => window.__velia.beacon.mark.clear()); await wait(o.page, 300);
    const m2 = await dblWater(o.page);
    await o.page.waitForFunction((k) => { const s = window.__velia.m4.ui.services.get('pilot').state; return s.mode === 'to' && s.toKey && s.toKey !== k; }, k0, { timeout: 10000 }).catch(() => {});
    const r = await P(o.page);
    check(!!m2 && r.mode === 'to' && r.toKey !== k0 && r.toKey === r.key, `a new mark while she sails: AUTO re-targets to it (${k0} → ${r.toKey})`);
    check(o.errors.length === 0, `double-click: no page errors (${o.errors.join(' | ')})`);
    await o.page.close(); }
  // ---- AUTO first, then a double-click ----
  { const o = await open();
    await auto(o.page); await wait(o.page, 400);
    check((await P(o.page)).mode === 'hold', 'AUTO with no target holds her heading');
    await dblWater(o.page);
    await sails(o.page, 'AUTO first, then a double-click');
    await o.page.close(); }
  // ---- the live map (in the bay): the water's card, Add waypoint (the draft's waypoint), then AUTO ----
  { const o = await openLive(IN_BAY);
    await openMap(o.page);
    const r = await waterAct(o.page, mouseTap(o.page), 300, -300, 'waypoint');
    const n = await o.page.evaluate(() => window.__velia.m4.ui.services.get('chart').course?.route?.length ?? 0);
    check(r.pressed && !r.say && n === 1, `chart: the waypoint (300, -300) from the water's card (route ${n}${r.say ? `; "${r.say}"` : ''})`);
    await closeMap(o.page);
    await auto(o.page);
    await sails(o.page, 'chart, a waypoint from the water\'s card, then AUTO');
    check(o.errors.length === 0, `chart: no page errors (${o.errors.join(' | ')})`);
    await o.page.close(); }
  // ---- AUTO first (holding), then the live map: Add waypoint and Set course ----
  { const o = await openLive(IN_BAY);
    await auto(o.page); await wait(o.page, 400);
    await openMap(o.page);
    await waterAct(o.page, mouseTap(o.page), 300, -300, 'waypoint');
    const r = await waterAct(o.page, mouseTap(o.page), 300, -300, 'setCourse');   // the waypoint's own water: its card offers Set course
    const active = await o.page.evaluate(() => !!window.__velia.m4.ui.services.get('chart').course?.active);
    check(r.pressed && active, `chart: Set course from the water's card (active ${active}${r.say ? `; "${r.say}"` : ''})`);
    await closeMap(o.page);
    await sails(o.page, 'AUTO holding, then Set course on the live map');
    await o.page.close(); }
  // ---- the live map: the water's card, Set as target (Sail's mark), then AUTO ----
  { const o = await openLive(IN_BAY);
    await openMap(o.page);
    const r = await waterAct(o.page, mouseTap(o.page), 300, -300, 'waterTarget');
    const m = await o.page.evaluate(() => window.__velia.beacon.mark?.mark ?? null);
    check(r.pressed && m && Math.hypot(m.x - 300, m.z + 300) < 15, `chart: Set as target puts Sail's mark there (${m ? `${Math.round(m.x)}, ${Math.round(m.z)}` : 'none'})`);
    await closeMap(o.page);
    await auto(o.page);
    await sails(o.page, 'chart, Set as target, then AUTO');
    await o.page.close(); }
  // ---- from Sail's start (inside the bay): a mark 6 km off on the open lake, then AUTO: she makes for the entrance channel ----
  { const o = await open();
    const far = await o.page.evaluate(() => { const b = window.__velia.boat.state, M = window.__velia.beacon.mark;
      for (const d of [6000, 5000, 7000]) for (let k = 0; k < 8; k++) { const a = 0.6 + k * 0.15; if (M.place({ x: b.x + Math.sin(a) * d, z: b.z - Math.cos(a) * d }) !== 'refused' && M.mark) return { ...M.mark, d }; }
      return null; });
    check(!!far, `out of the bay: a mark on the open lake (${far ? `${far.d} m off, ${Math.round(far.x)}, ${Math.round(far.z)}` : 'none'})`);
    await wait(o.page, 400); await auto(o.page);
    // (the mark lies across the bar: she first turns away from it, for the channel's inner end, so "nearer" waits for the channel)
    await o.page.waitForFunction(() => window.__velia.m4.ui.services.get('pilot').mode === 'to', null, { timeout: 15000 }).catch(() => {});
    const b = await P(o.page);
    check(b.mode === 'to' && b.driven && b.ring, `out of the bay: AUTO sails for it (${b.mode}, driven ${b.driven}, ring ${b.ring}; ${Math.round(b.d ?? -1)} m)`);
    check(!b.said.some((t) => /off my chart|safe way/i.test(t)), `out of the bay: no refusal (${JSON.stringify(b.said)})`);
    const inCh = await o.page.waitForFunction(() => window.__velia.m4.ui.services.get('pilot').nav?.inChannel, null, { timeout: 150000, polling: 500 }).then(() => true, () => false);
    const s = await o.page.evaluate(() => ({ x: window.__velia.boat.state.x, z: window.__velia.boat.state.z, under: window.__velia.boat.sim.ground?.state?.under ?? null }));
    check(inCh && !(s.under < 0), `out of the bay: AUTO takes her down the entrance channel (at ${Math.round(s.x)}, ${Math.round(s.z)}; ${s.under?.toFixed?.(2)} m under the keel)`);
    check(o.errors.length === 0, `out of the bay: no page errors (${o.errors.join(' | ')})`);
    await o.page.close(); }
  // ---- from the open lake: a mark 6 km off across the lake, then AUTO: she sails there (the whole-lake chart) ----
  { const o = await open('&start=1900,-1900&heading=60');
    const far = await o.page.evaluate(() => { const b = window.__velia.boat.state, M = window.__velia.beacon.mark;
      for (const d of [6000, 5000, 7000]) for (let k = 0; k < 12; k++) { const a = 1.9 + k * 0.15; if (M.place({ x: b.x + Math.sin(a) * d, z: b.z - Math.cos(a) * d }) !== 'refused' && M.mark) return { ...M.mark, d }; }
      return null; });
    check(!!far, `far: a mark ${far ? `${far.d} m off (${Math.round(far.x)}, ${Math.round(far.z)})` : 'none'}`);
    await wait(o.page, 300); await auto(o.page);
    const b = await sails(o.page, 'far, a mark across the lake, then AUTO');
    check(!b.said.some((t) => /off my chart|safe way/i.test(t)), `far: no refusal (${JSON.stringify(b.said)})`);
    check(o.errors.length === 0, `far: no page errors (${o.errors.join(' | ')})`);
    await o.page.close(); }
  // ---- under engine (desktop): a double-click, AUTO: she motors there (no beat), the lever the player's ----
  { const o = await open();
    await o.page.evaluate(() => { const sea = window.__velia.boat.sim.sea; sea.actions.engine(); sea.actions.lever(0.6); });
    await wait(o.page, 2500);
    await dblWater(o.page); await wait(o.page, 300); await auto(o.page);
    await sails(o.page, 'engine on, a double-click, then AUTO');
    const e = await o.page.evaluate(() => { const ui = window.__velia.m4.ui, n = ui.services.get('pilot').nav; window.__velia.boat.sim.sea.actions.lever(0.3); return { motoring: !!n?.motoring, on: window.__velia.boat.sim.phys.engine.on }; });
    await wait(o.page, 800);
    const lv = await o.page.evaluate(() => window.__velia.boat.sim.phys.engine.lever);
    check(e.motoring && e.on && Math.abs(lv - 0.3) < 0.05, `engine on: AUTO motors to it (motoring ${e.motoring}), the lever stays the player's (${lv.toFixed(2)})`);
    check(o.errors.length === 0, `engine: no page errors (${o.errors.join(' | ')})`);
    await o.page.close(); }
  // ---- a phone: the left corner's Auto is the same AUTO (owner, 2026-11-16): a mark before the press and after it, sails and engine ----
  for (const [what, engine, markFirst, far] of [['phone, sails, mark then Auto', false, true], ['phone, sails, Auto then mark', false, false], ['phone, engine, mark then Auto', true, true], ['phone, sails, a far mark (6 km) then Auto', false, true, true]]) {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s2) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s2)); } catch { /* blocked */ } }, SEEN);
    await page.goto(`${BASE}/?mode=sail&once=0&seed=1&kayaks=0&attract=0&noload=1&hour=13&chatter=0${far ? '&start=1900,-1900&heading=60' : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.flat?.shown && window.__velia.beacon && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
    await wait(page, 1500);
    if (engine) { await page.evaluate(() => { const sea = window.__velia.boat.sim.sea; sea.actions.engine(); sea.actions.lever(0.6); }); await wait(page, 2500); }
    const mark = () => page.evaluate((fr) => { const s = window.__velia.boat.sim.phys.state, M = window.__velia.beacon.mark;
      for (const d of fr ? [6000, 5000, 7000] : [500, 350, 700]) for (let k = 0; k < 12; k++) { const b = s.heading + k * Math.PI / 6; if (M.place({ x: s.x + Math.sin(b) * d, z: s.z - Math.cos(b) * d }) !== 'refused' && M.mark) return true; }
      return false; }, !!far);
    const tapAuto = async () => { const L = await page.evaluate(() => window.__velia.m4.ui.flat.layout); const [sx, sy] = await page.evaluate(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y]), [L.pl.x + L.q * 0.35, L.pl.y - L.q * 0.35]); await page.touchscreen.tap(sx, sy); await wait(page, 400); };
    if (markFirst) { check(await mark(), `${what}: a mark on the water`); await wait(page, 300); await tapAuto(); }
    else { await tapAuto(); check((await page.evaluate(() => window.__velia.m4.ui.services.get('pilot').mode)) === 'hold', `${what}: Auto with no target holds`); check(await mark(), `${what}: a mark on the water`); }
    await page.waitForFunction(() => window.__velia.m4.ui.services.get('pilot').mode === 'to', null, { timeout: 15000 }).catch(() => {});
    const a = await page.evaluate(() => { const p = window.__velia.m4.ui.services.get('pilot'), s = p.state, b = window.__velia.boat.state; return { mode: p.mode, lit: window.__velia.m4.ui.flat.auto, d: s.target ? Math.hypot(s.target.x - b.x, s.target.z - b.z) : null, motoring: !!p.nav?.motoring }; });
    if (a.mode === 'to') await page.waitForFunction((d0) => { const s = window.__velia.m4.ui.services.get('pilot').state, b = window.__velia.boat.state; return s.target && Math.hypot(s.target.x - b.x, s.target.z - b.z) < d0 - 10; }, a.d, { timeout: 30000, polling: 500 }).catch(() => {});
    const d1 = await page.evaluate(() => { const s = window.__velia.m4.ui.services.get('pilot').state, b = window.__velia.boat.state; return s.target ? Math.hypot(s.target.x - b.x, s.target.z - b.z) : null; });
    check(a.mode === 'to' && a.lit && d1 < a.d - 10 && a.motoring === engine, `${what}: Auto sails there (${a.mode}, lit ${a.lit}, motoring ${a.motoring}; ${Math.round(a.d ?? -1)} → ${Math.round(d1 ?? -1)} m)`);
    check(errors.length === 0, `${what}: no page errors (${errors.join(' | ')})`);
    await ctx.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
