// The target beacon from the player's own gestures on a live v2 page (owner bug report 2026-11-15: "Sail: setting a target from the
// chart does not place the beacon; Cruise: the chart does not work at all, the player cannot add a target, and the beacon is not
// created in Cruise either"). Desktop (1280 × 720, a mouse) and an upright phone (390 × 844, touch; the landscape page turned on its side since 2026-11-15):
//   Sail     the live map (the menu's map, Phase 2b), the water's card, Add waypoint: the beacon lights on that waypoint at once
//            (before Set course), and Set course keeps it; Add waypoint on the open lake past the bay's bar (the whole-lake chart,
//            through the entrance channel) is a waypoint, the beacon on
//            it; a double-tap on the water near the boat (most of the water in the chase view is within 40 m) lights the beacon
//            at least 140 m out on that bearing, no autopilot
//   Cruise   the live map, the water's card, Set as target: the navigator's mark (the autopilot closes it) and the beacon on it; a
//            tap on the mark, its card's Clear target, clears it; a double-tap on the water lights the beacon
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/beaconTarget.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { enterFromCard, openMap, closeMap, waterAct, live } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const DEVICES = [['desk', { viewport: { width: 1280, height: 720 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];

// the live map's path (Phase 2b): the page with its card, the card's mode, then (Sail) she is put at place
async function openLive(dev, mode, place = null) {
  const page = await browser.newPage(dev[1]);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=${mode}&once=0&seed=1&kayaks=0&attract=0&hour=15&chatter=0&chartground=webp`, { waitUntil: 'load' });
  await enterFromCard(page, mode, { place });
  await page.waitForFunction(() => window.__velia.m4?.ui?.viewSwitch, null, { timeout: 30000 });
  return { page, errors, phone: dev[0] === 'phone' };
}
async function open(dev, mode, query = '') {
  const page = await browser.newPage(dev[1]);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=${mode}&once=0&seed=1&kayaks=0&attract=0&noload=1&hour=15&chatter=0${query}`, { waitUntil: 'load' });
  await page.waitForFunction((m) => window.__velia?.ready && window.__velia.m4?.ui?.viewSwitch && window.__velia.beacon && window.__velia.boat?.sim?.t > 1 && (m !== 'cruise' || window.__velia.cruise?.c?.on), mode, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { page, errors, phone: dev[0] === 'phone' };
}
// the page's points are in its layout frame: an upright phone shows the landscape page turned on its side (phones are landscape-only,
// owner 2026-11-15), so a finger lands at the point's screen spot (__veliaTurn.toScreen; the identity unturned)
const onScreen = (o, x, y) => o.page.evaluate(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y]), [x, y]);
const tap = async (o, x, y) => { if (o.phone) { const [sx, sy] = await onScreen(o, x, y); await o.page.touchscreen.tap(sx, sy); } else await o.page.mouse.click(x, y); };
const dbl = async (o, x, y) => { if (o.phone) { const [sx, sy] = await onScreen(o, x, y); await o.page.touchscreen.tap(sx, sy); await o.page.waitForTimeout(90); await o.page.touchscreen.tap(sx, sy); } else await o.page.mouse.dblclick(x, y); };
const beacon = (page) => page.evaluate(() => { const s = window.__velia.beacon.state(), b = window.__velia.boat.state; return { ...s, lit: s.phase === 'in' || s.phase === 'on', fromBoat: Math.hypot(s.x - b.x, s.z - b.z) }; });
// a screen spot whose water Cruise's navigator takes, lo to hi m off the boat, over every row of the frame (the start view is the
// low Boat camera since 2026-11-15: the lower half is the boat and the water within 20 m; an upright phone sees far water only near
// the horizon): each candidate checked by Cruise's own pickDestination, then let go again
const cruiseSpot = (page, lo, hi) => page.evaluate(([lo, hi]) => {
  const c = window.__velia.cruise.c, nav = c.voyage.nav, b = window.__velia.boat.state, W = innerWidth, H = innerHeight;
  if (nav.dest) return null;
  for (let fy = 0.2; fy <= 0.9; fy += 0.02) for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const s = [W * fx, H * fy], p = c.waterAt(s[0], s[1]); if (!p) continue;
    const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < lo || d > hi) continue;
    const r = c.pickDestination({ x: p.x, z: p.z }); const at = nav.dest?.at; nav.clearDestination(); window.__velia.m4.ui.chart?.chart?.setDestination?.(null);
    if (r === 'set' && at) return { s, x: at[0], z: at[1], d };
  }
  return null;
}, [lo, hi]);
// a world point the navigator takes for the chart's tap, whatever the camera sees: round the boat at 250, 350 then 200 m
const cruisePoint = (page) => page.evaluate(() => {
  const c = window.__velia.cruise.c, nav = c.voyage.nav, b = window.__velia.boat.state;
  if (nav.dest) return null;
  for (const r of [250, 350, 200]) for (let k = 0; k < 16; k++) {
    const a = b.heading + k * Math.PI / 8, x = b.x + Math.sin(a) * r, z = b.z - Math.cos(a) * r;
    const res = c.pickDestination({ x, z }); const at = nav.dest?.at; nav.clearDestination(); window.__velia.m4.ui.chart?.chart?.setDestination?.(null);
    if (res === 'set' && at) return { x: at[0], z: at[1] };
  }
  return null;
});
const tapper = (o) => (x, y) => tap(o, x, y);
const routeN = (page) => page.evaluate(() => window.__velia.m4.ui.services.get('chart').course?.route?.length ?? 0);

try {
  for (const dev of DEVICES.filter((d) => !argv.includes('--only') || d[0] === argv[argv.indexOf('--only') + 1])) {   // --only desk|phone
    const at = dev[0];
    // ---------------- Sail: the live map (in the bay: the planner's chart) ----------------
    {
      const o = await openLive(dev, 'sail', { x: -350, z: 150, headingDeg: 20 });
      await openMap(o.page);
      check(!!(await live(o.page))?.shown, `${at} Sail: the menu opens the live map`);
      const r = await waterAct(o.page, tapper(o), 300, -300, 'waypoint');
      check(r.pressed, `${at} Sail: the water's card at (300, -300) offers Add waypoint (${JSON.stringify(r.card)})`);
      await closeMap(o.page);
      const b1 = await beacon(o.page), n = await routeN(o.page);
      check(n === 1 && b1.lit && Math.hypot(b1.x - 300, b1.z + 300) < 30, `${at} Sail: Add waypoint on the map's water lights the beacon on it before Set course (route ${n}, ${b1.phase}/${b1.kind} at ${Math.round(b1.x)}, ${Math.round(b1.z)})`);
      await openMap(o.page);
      const r2 = await waterAct(o.page, tapper(o), 300, -300, 'setCourse');   // the waypoint's own water: its card offers Set course
      await closeMap(o.page);
      const b2 = await beacon(o.page);
      check(r2.pressed && b2.lit && b2.key === b1.key, `${at} Sail: Set course keeps the same light (${b2.phase}, ${b2.key}; card ${JSON.stringify(r2.water?.actions ?? r2.card)}${r2.say ? `, "${r2.say}"` : ''})`);
      await o.page.waitForTimeout(900);
      check((await beacon(o.page)).lit, `${at} Sail: the map closed, the beacon stays`);
      check(await o.page.evaluate(() => window.__velia.boat.sim.driven !== true), `${at} Sail: no autopilot`);
      check(o.errors.length === 0, `${at} Sail: no page errors (${o.errors.join(' | ')})`);
      await o.page.close();
    }
    // ---------------- Sail: past the bay's bar (no safe way), and the double-tap ----------------
    {
      const o = await openLive(dev, 'sail');
      await openMap(o.page);
      // the open lake past the bay's bar (past z −2000, v1's old chart): deep water on v2's terrain; the planner routes there through
      // the entrance channel. The map centres on it at the whole bay's zoom. The spot keeps the navigator's shore room (85 m): water
      // all round it 110 m out, so the boat's start (the Off Fannette pin since 2026-11-25) never picks a cove by the shore
      const far = await o.page.evaluate(() => {
        const T = window.__velia.terrain.field, b = window.__velia.boat.state;
        const open = (x, z) => -T.height(x, z) > 10 && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => -T.height(x + 110 * Math.cos(k * Math.PI / 4), z + 110 * Math.sin(k * Math.PI / 4)) > 2);
        for (let dz = 1100; dz <= 2600; dz += 100) for (const dx of [0, -200, 200, -400, 400, 600, 800]) {
          const x = b.x + dx, z = b.z - dz; if (z > -2100) continue;
          if (open(x, z)) return { x, z };
        }
        return null;
      });
      check(!!far, `${at} Sail: a spot on the open lake past the bay's bar (${far ? `${Math.round(far.x)}, ${Math.round(far.z)}` : 'none'})`);
      if (far) {
        const r = await waterAct(o.page, tapper(o), far.x, far.z, 'waypoint', { mpp: 6.5 });
        await closeMap(o.page);
        const b = await beacon(o.page), n2 = await routeN(o.page);
        check(r.pressed && b.lit && n2 === 1 && Math.hypot(b.x - far.x, b.z - far.z) < 40, `${at} Sail: Add waypoint past the bay's bar is a waypoint (the entrance channel) and lights the beacon there (route ${n2}, ${b.phase}/${b.kind} at ${Math.round(b.x)}, ${Math.round(b.z)}${r.say ? `; "${r.say}"` : ''})`);
        await openMap(o.page);
        await waterAct(o.page, tapper(o), far.x + 200, far.z + 200, 'clearRoute', { mpp: 6.5 });
        check((await routeN(o.page)) === 0, `${at} Sail: Clear route on the water's card clears it`);
      }
      await closeMap(o.page);
      await o.page.evaluate(() => window.__velia.beacon.mark?.clear());
      await o.page.waitForTimeout(1000);
      // a double-tap on the water just ahead of the boat: within 40 m in the chase view. The page's frame is the landscape layout on a
      // phone too (innerWidth x innerHeight; the fingers land at __veliaTurn.toScreen); the Boat view's horizon sits near 52 % of the
      // height (owner 2026-11-17: the lower camera), so the water ahead is the band just under it, above the rings
      const vp = await o.page.evaluate(() => ({ width: innerWidth, height: innerHeight })), spot = await o.page.evaluate(([w, h, phone]) => {
        const M = window.__velia.beacon.mark, b = window.__velia.boat.state;
        for (const fy of phone ? [0.6, 0.58, 0.64] : [0.55, 0.5, 0.6]) { let got = null; const keep = M.set; M.set = (x, z) => { got = { x, z }; return got; }; try { M.at(w * 0.5, h * fy); } finally { M.set = keep; M.clear(); } if (got) return { fy }; }
        return { fy: phone ? 0.6 : 0.55 };
      }, [vp.width, vp.height, o.phone]);
      await o.page.waitForTimeout(400);
      await dbl(o, vp.width * 0.5, vp.height * spot.fy); await o.page.waitForTimeout(700);
      const d = await beacon(o.page);
      check(d.lit && d.kind === 'sail' && d.fromBoat > 140, `${at} Sail: a double-tap on the water near the boat lights the beacon out on its bearing (${d.phase}/${d.kind}, ${Math.round(d.fromBoat)} m)`);
      check(await o.page.evaluate(() => window.__velia.boat.sim.driven !== true), `${at} Sail: the double-tap mark, no autopilot`);
      check(o.errors.length === 0, `${at} Sail (start): no page errors (${o.errors.join(' | ')})`);
      await o.page.close();
    }
    // ---------------- Cruise: the chart and the double-tap ----------------
    {
      const o = await openLive(dev, 'cruise');
      // a mark the navigator takes (its own checks), as a world point
      const pt = await cruisePoint(o.page);
      check(!!pt, `${at} Cruise: a water spot the navigator takes (${pt ? `${Math.round(pt.x)}, ${Math.round(pt.z)}` : 'none'})`);
      await openMap(o.page);
      check(!!(await live(o.page))?.shown, `${at} Cruise: the menu opens the live map`);
      const r = pt ? await waterAct(o.page, tapper(o), pt.x, pt.z, 'waterTarget') : null;
      const acts = r?.water?.actions ?? [];
      check(acts.join() === 'waterTarget', `${at} Cruise: the water's card offers Set as target only (no route in Cruise) (${acts.join(', ')})`);
      await closeMap(o.page);
      const dest = await o.page.evaluate(() => window.__velia.cruise.c.voyage.nav.dest?.at ?? null), b1 = await beacon(o.page);
      check(!!dest && Math.hypot(dest[0] - pt.x, dest[1] - pt.z) < 40, `${at} Cruise: Set as target on the map's water sets the navigator's mark (${dest ? dest.map(Math.round).join(', ') : 'none'})`);
      check(b1.lit && b1.kind === 'cruise', `${at} Cruise: the beacon on the map's mark (${b1.phase}/${b1.kind})`);
      // the autopilot closes it (Cruise's sim at 1 ×)
      const d0 = dest ? await o.page.evaluate(([x, z]) => { const b = window.__velia.boat.state; return Math.hypot(x - b.x, z - b.z); }, dest) : 0;
      // up to 30 s: she may first turn or bear away round the route's first bend (Cruise's sim at 1 ×, a few m/s)
      if (dest) await o.page.waitForFunction(([x, z, d0]) => { const b = window.__velia.boat.state; return Math.hypot(x - b.x, z - b.z) < d0 - 15; }, [dest[0], dest[1], d0], { timeout: 30000, polling: 500 }).catch(() => {});
      const d1 = dest ? await o.page.evaluate(([x, z]) => { const b = window.__velia.boat.state; return Math.hypot(x - b.x, z - b.z); }, dest) : 0;
      check(!!dest && d1 < d0 - 15 && (await o.page.evaluate(() => window.__velia.boat.sim.driven === true)), `${at} Cruise: the autopilot heads for the map's mark (${Math.round(d0)} → ${Math.round(d1)} m)`);
      // a tap on the mark on the map: its card, Clear target
      if (dest) {
        await openMap(o.page);
        const c = await waterAct(o.page, tapper(o), dest[0], dest[1], 'clearTarget');
        await closeMap(o.page);
        check(c.pressed && !(await o.page.evaluate(() => window.__velia.cruise.c.voyage.nav.dest)), `${at} Cruise: a tap on the mark on the map, Clear target, clears it (${c.card?.name})`);
        await o.page.waitForTimeout(800);
      }
      // a double-tap on the water near the boat (inside the navigator's 70 m arrival: it was reached the moment it was set)
      const sp = await cruiseSpot(o.page, 20, 65), s = sp?.s ?? null;
      check(!!s, `${at} Cruise: a water spot near the boat (${sp ? `${Math.round(sp.d)} m` : 'none'})`);
      await o.page.waitForTimeout(600);
      if (s) await dbl(o, s[0], s[1]);
      await o.page.waitForTimeout(800);
      const b2 = await beacon(o.page), md = await o.page.evaluate(() => { const d = window.__velia.cruise.c.voyage.nav.dest, b = window.__velia.boat.state; return d ? Math.hypot(d.at[0] - b.x, d.at[1] - b.z) : null; });
      check(!!s && b2.lit && b2.kind === 'cruise' && md > 100, `${at} Cruise: a double-tap on the water near the boat sets the mark out on its bearing and lights the beacon (${b2.phase}/${b2.kind}, ${md == null ? `no mark: "${await o.page.evaluate(() => document.querySelector('.lk-chill')?.textContent ?? '')}"` : `${Math.round(md)} m`})`);
      check(o.errors.length === 0, `${at} Cruise: no page errors (${o.errors.join(' | ')})`);
      await o.page.close();
    }
  }
} finally { await browser.close(); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
