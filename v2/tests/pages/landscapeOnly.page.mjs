// Phones are landscape-only (owner ruling 2026-11-15; v2/ui/landscape.js): an upright touch phone (390 × 844,
// isMobile, hasTouch) shows the landscape page turned 90° on its side, a sideways phone (844 × 390) shows it as it is.
//   upright    html.lk-rot, the body's transform a quarter turn; the page's frame is 844 × 390 (innerWidth/innerHeight, the canvas's
//              CSS box and its backing store landscape-shaped); the flat controls and the phone-land layout, not the upright ones
//   gestures   each gesture is planned in the layout frame and sent at the finger's screen point (__veliaTurn.toScreen; the same
//              on the sideways phone, where it is the identity), and must land where the finger is in the turned frame:
//                - a drag across open water turns the camera the same way on both phones
//                - a double-tap on the water lights the beacon on the bearing of the water under the finger
//                - on the live map (the menu's map, Phase 2b; a page with its card), the water's card under the finger: Add waypoint sets
//                  the waypoint there
//                - a sweep on the flat steer arc turns the rudder the same way on both phones; one finger on the water never steers
//   first paint the turn and the stylesheet flips are in place before any module runs (ui/landscape.js earlyTurn, inline)
//   ?portrait=1  the upright layouts for one release: no turn, the page's frame 390 × 844
// Run by `npm run test:pages:v2 -- landscapeOnly`, or node v2/tests/pages/landscapeOnly.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { enterFromCard, openMap, closeMap, waterAct } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const PROFILES = [['upright', { ...PHONE, viewport: { width: 390, height: 844 } }], ['sideways', { ...PHONE, viewport: { width: 844, height: 390 } }]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });

async function open(opts, query = '') {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  // the page as parsed, before any module runs (readystatechange 'interactive' fires before the deferred modules): already turned and flipped
  await page.addInitScript(() => document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') window.__parsedTurn = { rot: document.documentElement.classList.contains('lk-rot'), css: document.documentElement.classList.contains('lk-rot-css'), mod: !!window.__veliaTurn }; }));
  await page.goto(`${BASE}/?mode=sail&once=0&seed=1&kayaks=0&attract=0&noload=1&hour=15&chatter=0&quality=1&start=-350,150&heading=20${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.viewSwitch && window.__velia.beacon && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) };
}
// a layout point → the finger's screen point
const screenAt = (page, x, y) => page.evaluate(([x, y]) => window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y], [x, y]);
async function touchPath(o, layoutPts, holdMs = 0) {
  const pts = []; for (const [x, y] of layoutPts) pts.push(await screenAt(o.page, x, y));
  await o.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (const [x, y] of pts.slice(1)) { await o.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await wait(16); }
  if (holdMs) await wait(holdMs);
  return () => o.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// two fingers 60 px apart (layout y), moved together along the layout's x
async function touchPath2(o, x0, x1, y, gap, n = 12) {
  const at = async (x) => { const a = await screenAt(o.page, x, y), b = await screenAt(o.page, x, y + gap); return [{ x: a[0], y: a[1], id: 1 }, { x: b[0], y: b[1], id: 2 }]; };
  await o.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: await at(x0) });
  for (let i = 1; i <= n; i++) { await o.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: await at(x0 + (x1 - x0) * i / n) }); await wait(16); }
  return () => o.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const tapAt = async (o, x, y) => { const [sx, sy] = await screenAt(o.page, x, y); await o.page.touchscreen.tap(sx, sy); };
const yawOf = (st) => Math.atan2(st.look[0] - st.eye[0], -(st.look[2] - st.eye[2]));
const camYaw = async (page) => yawOf(await page.evaluate(() => window.__velia.stats()));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const beacon = (page) => page.evaluate(() => { const s = window.__velia.beacon.state(), b = window.__velia.boat.state; return { ...s, lit: s.phase === 'in' || s.phase === 'on', bx: b.x, bz: b.z }; });

const seen = {};
try {
  for (const [name, opts] of PROFILES) {
    const o = await open(opts);
    const { page } = o;
    const s = await page.evaluate(() => {
      const c = document.getElementById('c'), de = document.documentElement, m = new DOMMatrix(getComputedStyle(document.body).transform);
      return { rot: !!window.__veliaTurn?.rotated(), cls: de.classList.contains('lk-rot'), iw: innerWidth, ih: innerHeight, cw: c.clientWidth, ch: c.clientHeight, bw: c.width, bh: c.height,
        a: +m.a.toFixed(3), b: +m.b.toFixed(3), form: window.__velia.m4.ui.flat?.on ? 'flat' : window.__velia.m4.ui.station?.form, land: de.classList.contains('lk-phone-l'), port: /\bportrait\b/.test(de.dataset.screen ?? '') };
    });
    const upright = name === 'upright';
    check(s.rot === upright && s.cls === upright, `${name}: the page is ${upright ? '' : 'not '}turned (rotated ${s.rot}, html.lk-rot ${s.cls})`);
    const parsed = await page.evaluate(() => window.__parsedTurn);
    check(!!parsed && parsed.rot === upright && parsed.css === upright && !parsed.mod, `${name}: the page is ${upright ? 'turned and its sheets flipped' : 'unturned'} before any module runs (${JSON.stringify(parsed)})`);
    if (upright) check(s.a === 0 && s.b === 1, `${name}: the body's transform is a quarter turn clockwise (matrix a ${s.a}, b ${s.b})`);
    check(s.iw === 844 && s.ih === 390, `${name}: the page's frame is landscape, 844 × 390 (${s.iw} × ${s.ih})`);
    check(s.cw === 844 && s.ch === 390 && s.bw > s.bh, `${name}: the canvas is landscape-sized (CSS ${s.cw} × ${s.ch}, backing ${s.bw} × ${s.bh})`);
    check(s.form === 'flat' && s.land && !s.port, `${name}: the landscape layout, the flat controls (form ${s.form}, lk-phone-l ${s.land}, portrait ${s.port})`);

    // two fingers across open water (layout frame: right to left, high on the frame) turn the camera (one finger is the helm's)
    const y0 = await camYaw(page);
    await (await touchPath2(o, 844 * 0.7, 844 * 0.4, 390 * 0.25, 60))();
    await page.waitForTimeout(500);
    const dYaw = wrap((await camYaw(page)) - y0);
    check(Math.abs(dYaw) > 0.05, `${name}: a two-finger drag across the water turns the camera (${dYaw.toFixed(3)} rad)`);
    seen[`${name}:look`] = Math.sign(dYaw);

    // one finger on the water looks round and never steers (the flat controls steer), on either half
    const steerOf = async (x) => { const up = await touchPath(o, line(x, 390 * 0.3, x + 120, 390 * 0.3, 10), 300); const v = await page.evaluate(() => window.__velia.hands.now.steer); await up(); await page.waitForTimeout(300); return v; };
    const sl = await steerOf(844 * 0.15), sr = await steerOf(844 * 0.62);
    check(Math.abs(sl) < 0.01 && Math.abs(sr) < 0.01, `${name}: one finger on the water never steers, on either half (${sl.toFixed(3)}, ${sr.toFixed(3)})`);

    // a double-tap on the water: the beacon on the bearing of the water under the finger (off the centre line, so a wrong frame
    // would pick another bearing). The rows below the horizon first: the Boat view's frame (8fc209dc, 2026-11-18: the low orbit) put
    // the horizon at about 52 % of the height, so the old rows (32-40 %) are now the shore and the sky; any row that is water still counts
    await page.evaluate(() => window.__velia.beacon.mark?.clear());
    await page.waitForTimeout(600);
    const want = await page.evaluate(() => {
      const M = window.__velia.beacon.mark, b = window.__velia.boat.state;
      for (const fy of [0.56, 0.6, 0.64, 0.68, 0.36, 0.32, 0.4]) for (const fx of [0.3, 0.7, 0.35, 0.65, 0.4, 0.6]) {
        if (document.elementFromPoint(innerWidth * fx, innerHeight * fy) !== document.getElementById('c')) continue;   // the water, not a cockpit pad
        let got = null; const keep = M.set; M.set = (x, z) => { got = { x, z }; return got; };
        try { M.at(innerWidth * fx, innerHeight * fy); } finally { M.set = keep; M.clear(); }
        // well off the boat's own line (20° or more), so the turned frame's mapping is really tested (the check allows 12°)
        const hd = b.heading ?? 0, brg = Math.atan2(got?.x - b.x, -(got?.z - b.z));
        if (got && Math.abs(Math.atan2(Math.sin(brg - hd), Math.cos(brg - hd))) >= 0.35) return { fx, fy, brg };
      }
      return null;
    });
    check(!!want, `${name}: a water spot for the double-tap (${JSON.stringify(want)})`);
    if (want) {
      const [sx, sy] = await screenAt(page, 844 * want.fx, 390 * want.fy);
      await page.touchscreen.tap(sx, sy); await page.waitForTimeout(90); await page.touchscreen.tap(sx, sy);
      await page.waitForTimeout(700);
      const d = await beacon(page), brg = Math.atan2(d.x - d.bx, -(d.z - d.bz)), off = Math.abs(wrap(brg - want.brg)) * 180 / Math.PI;
      check(d.lit && d.kind === 'sail' && off < 12, `${name}: a double-tap lights the beacon on the bearing under the finger (${d.phase}/${d.kind}, ${off.toFixed(1)}° off)`);
      await page.evaluate(() => window.__velia.beacon.mark?.clear());
    }

    // the live map: a page with its card (Sail from the card), the menu's map in the card's box, the water's card under the finger
    {
      const lc = await browser.newContext(opts), lp = await lc.newPage(), lerr = []; lp.on('pageerror', (e) => lerr.push(String(e)));
      await lp.addInitScript((st) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(st)); } catch { /* blocked */ } }, SEEN);
      await lp.goto(`${BASE}/?mode=sail&once=0&seed=1&kayaks=0&attract=0&hour=15&chatter=0&quality=1&chartground=webp`, { waitUntil: 'load' });
      await enterFromCard(lp, 'sail', { place: { x: -350, z: 150, headingDeg: 20 } });
      await openMap(lp);
      const lo = { page: lp };
      const target = await lp.evaluate(() => {
        const T = window.__velia.terrain.field, b = window.__velia.boat.state;
        for (const [x, z] of [[300, -300], ...[300, 220].flatMap((R) => Array.from({ length: 12 }, (_, k) => [b.x + Math.sin(k * Math.PI / 6) * R, b.z - Math.cos(k * Math.PI / 6) * R]))]) if (-T.height(x, z) > 8) return { x, z };
        return null;
      });
      check(!!target, `${name}: a water spot for the map (${target ? `${Math.round(target.x)}, ${Math.round(target.z)}` : 'none'})`);
      if (target) {
        const r = await waterAct(lp, (x, y) => tapAt(lo, x, y), target.x, target.z, 'waypoint');
        const route = await lp.evaluate(() => window.__velia.m4.ui.services.get('chart').course?.route ?? []), w = route[0];
        const wx = w?.x ?? w?.[0], wz = w?.z ?? w?.[1];
        const near = Number.isFinite(wx) && Math.hypot(wx - target.x, wz - target.z) < 30;
        check(r.pressed && near, `${name}: a tap on the live map's water, Add waypoint, sets the waypoint under the finger (route ${route.length}${Number.isFinite(wx) ? ` at ${Math.round(wx)}, ${Math.round(wz)}` : ''}; wanted ${Math.round(target.x)}, ${Math.round(target.z)}${r.say ? `; "${r.say}"` : ''})`);
      }
      await closeMap(lp);
      check(lerr.length === 0, `${name}: the live map, no page errors (${lerr.join(' | ')})`);
      await lc.close();
    }

    // a sweep on the flat steer arc (layout frame: clockwise round the lower-left corner) turns the rudder
    const L = await page.evaluate(() => window.__velia.m4.ui.flat?.layout ?? null);
    check(!!L, `${name}: the flat controls are laid out`);
    if (L) {
      const P = (a) => [L.pl.x + L.steer.r * Math.cos(a * Math.PI / 180), L.pl.y - L.steer.r * Math.sin(a * Math.PI / 180)];
      const r0 = (await page.evaluate(() => window.__velia.boat.row())).rudder;
      const up = await touchPath(o, Array.from({ length: 11 }, (_, i) => P(50 - 2 * i)), 900);
      const r1 = (await page.evaluate(() => window.__velia.boat.row())).rudder; await up();
      check(Math.abs(r1 - r0) > 0.01, `${name}: a sweep on the steer arc turns the rudder (${r0} → ${r1})`);
      seen[`${name}:wheel`] = Math.sign(r1 - r0);
    }
    check(o.errors.length === 0, `${name}: no page errors (${o.errors.join(' | ')})`);
    await o.ctx.close();
  }
  check(seen['upright:look'] === seen['sideways:look'], `the same drag turns the camera the same way on both phones (${seen['upright:look']}, ${seen['sideways:look']})`);
  check(seen['upright:wheel'] === seen['sideways:wheel'], `the same sweep turns the rudder the same way on both phones (${seen['upright:wheel']}, ${seen['sideways:wheel']})`);

  // ?portrait=1: the upright layouts, unturned
  {
    const o = await open(PROFILES[0][1], '&portrait=1');
    const s = await o.page.evaluate(() => ({ rot: document.documentElement.classList.contains('lk-rot'), iw: innerWidth, ih: innerHeight, port: /\bportrait\b/.test(document.documentElement.dataset.screen ?? ''), form: window.__velia.m4.ui.station?.form }));
    check(!s.rot && s.iw === 390 && s.ih === 844 && s.port && s.form !== 'cockpit', `?portrait=1: the upright layouts, no turn (${JSON.stringify(s)})`);
    check(o.errors.length === 0, `?portrait=1: no page errors (${o.errors.join(' | ')})`);
    await o.ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
