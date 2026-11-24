// The phone pass: touch sanity on phones held upright and sideways, under Playwright's phone emulation (touch events,
// isMobile, the device's DPR and user agent): the owner's reference iPhone 16 Pro (402 × 874 CSS at DPR 3, Safari's UA),
// Playwright's iPhone 13 and Pixel 7, each both ways.
//   - the viewport meta (width=device-width, initial-scale=1, maximum-scale=1), the canvas's touch-action none, no
//     horizontal or vertical overflow; a one-finger swipe and a two-finger pinch on the canvas leave the page unscrolled
//     and unzoomed (scrollX/Y 0, visualViewport.scale 1)
//   - upright: the landscape page turned on its side (phones are landscape-only, owner 2026-11-15), so the same controls as sideways
//   - both holds: the flat controls (v2/ui/flat.js; no cockpit): drags on the sheet ring trim the main, a sweep on the steer
//     ring turns the rudder, Auto, Tack and ⋯ ≥ 44 px
// What only a real phone can confirm: Safari's own WebGPU and WGSL compiler, its pinch and edge-swipe gestures (Chrome's
// emulation sends touch events but has no Safari gesture engine), the toolbars' resize, the safe areas and the GPU's speed.
// Run by `npm run test:pages:v2`, or node v2/tests/pages/phoneTouch.page.mjs --base http://127.0.0.1:<port>
import { chromium, devices } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };

// the owner's reference phone (coordinator, 2026-11-13): iPhone 16 Pro, A18 Pro, 2622 × 1206 at DPR 3, Safari
export const IPHONE_16_PRO = Object.freeze({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, defaultBrowserType: 'webkit',
});
const turn = (d) => ({ ...d, viewport: { width: d.viewport.height, height: d.viewport.width } });
const PROFILES = [
  ['iPhone 16 Pro upright', IPHONE_16_PRO], ['iPhone 16 Pro sideways', turn(IPHONE_16_PRO)],
  ['iPhone 13 upright', devices['iPhone 13']], ['iPhone 13 sideways', devices['iPhone 13 landscape']],
  ['Pixel 7 upright', devices['Pixel 7']], ['Pixel 7 sideways', devices['Pixel 7 landscape']],
];

// CDP touches: one finger along a path, or two fingers pinching
async function touchPath(cdp, pts, holdMs = 0) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (const [x, y] of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await new Promise((r) => setTimeout(r, 16)); }
  if (holdMs) await new Promise((r) => setTimeout(r, holdMs));
  return () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(cdp, cx, cy) {
  const at = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(30) });
  for (let d = 30; d <= 120; d += 10) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(d) }); await new Promise((r) => setTimeout(r, 16)); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// layout points (the page's frame, turned on an upright phone) → the fingers' screen points
const asScreen = (page, pts) => page.evaluate((p) => p.map(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y])), pts);
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  for (const [name, dev] of PROFILES) {
    const { defaultBrowserType, ...opts } = dev; void defaultBrowserType;
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    await page.goto(`${BASE}/?mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&quality=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.boat && window.__velia.m4?.ui?.flat?.shown, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    const W = opts.viewport.width, H = opts.viewport.height;

    const base = await page.evaluate(() => {
      const c = document.getElementById('c'), cs = getComputedStyle(c), de = document.documentElement;
      return { meta: document.querySelector('meta[name=viewport]')?.content ?? '', ta: cs.touchAction, sw: de.scrollWidth, sh: de.scrollHeight, iw: innerWidth, ih: innerHeight,
        cockpit: de.classList.contains('lk-cockpit'), flat: !!window.__velia.m4.ui.flat?.on, hands: (() => { const h = document.getElementById('hands'); return !!h && getComputedStyle(h).display !== 'none'; })() };
    });
    check(/width=device-width/.test(base.meta) && /initial-scale=1/.test(base.meta) && /maximum-scale=1/.test(base.meta) && base.ta === 'none', `${name}: viewport meta and canvas touch-action none (${base.ta})`);
    check(base.sw <= base.iw && base.sh <= base.ih, `${name}: no overflow (${base.sw}×${base.sh} in ${base.iw}×${base.ih})`);

    // a swipe and a pinch on open water: the page never scrolls or zooms
    const end = await touchPath(cdp, line(W * 0.5, H * 0.35, W * 0.5, H * 0.1)); await end();
    await touchPath(cdp, line(W * 0.2, H * 0.3, W * 0.8, H * 0.3)).then((f) => f());
    await pinch(cdp, W * 0.5, H * 0.3);
    await page.waitForTimeout(200);
    const sc = await page.evaluate(() => ({ x: scrollX, y: scrollY, s: visualViewport?.scale ?? 1, bx: document.scrollingElement.scrollTop }));
    check(sc.x === 0 && sc.y === 0 && sc.bx === 0 && sc.s === 1, `${name}: a swipe and a pinch leave the page unscrolled and unzoomed (${JSON.stringify(sc)})`);

    const row = () => page.evaluate(() => window.__velia.boat.row());
    // phones are landscape-only (owner 2026-11-15): an upright phone shows the landscape page turned on its side; since
    // (owner 2026-11-16) both holds have the flat controls (v2/ui/flat.js), no cockpit; their layout is in the turned frame, the
    // fingers land at their screen points (__veliaTurn.toScreen)
    const upright = H > W, turned = await page.evaluate(() => !!window.__veliaTurn?.rotated());
    check(turned === upright, `${name}: the page is ${upright ? '' : 'not '}turned (${turned})`);
    check(base.flat && !base.cockpit && !base.hands, `${name}: the flat controls, no cockpit, no helm strip (${JSON.stringify({ flat: base.flat, cockpit: base.cockpit, hands: base.hands })})`);
    if (base.flat) {
      const L = await page.evaluate(() => window.__velia.m4.ui.flat.layout);
      const P = (p, a, r) => [p.x + p.side * r * Math.cos(a * Math.PI / 180), p.y - r * Math.sin(a * Math.PI / 180)];
      const big = await page.evaluate(() => [...window.__velia.m4.ui.flat.el.querySelectorAll('.qd:not([hidden]):not(.gone),.more')].map((n) => { const c = n.getBoundingClientRect(); return c.width >= 44 && c.height >= 44; }));
      check(big.length === 3 && big.every(Boolean), `${name}: Auto, Tack and ⋯ are ≥ 44 px`);
      // the sheet ring: a drag up pulls the main in, a drag down eases it (crew trim off: sheetDeg is the hand's)
      const ring = (a0, a1) => Array.from({ length: 11 }, (_, i) => P(L.pr, a0 + (a1 - a0) * i / 10, L.main.r));
      const s0 = (await row()).sheetDeg; let u = await touchPath(cdp, await asScreen(page, ring(55, 15)), 300); await u(); await page.waitForTimeout(300);
      const s1 = (await row()).sheetDeg; u = await touchPath(cdp, await asScreen(page, ring(15, 60)), 300); await u(); await page.waitForTimeout(300);
      const s2 = (await row()).sheetDeg;
      check(s1 != null && s2 != null && s2 < s1 - 5 && s1 >= s0 - 0.5, `${name}: a drag down the sheet ring eases the main, up pulls it in (${s0}° → ${s1}° → ${s2}°)`);
      const r0 = await row();
      const up = await touchPath(cdp, await asScreen(page, Array.from({ length: 11 }, (_, i) => P(L.pl, 50 - 2 * i, L.steer.r))), 900);
      const r1 = await row();
      // Safari's bars move mid-drag (the frame changes under the held finger): the ring in the hand is not rebuilt and the rudder holds (refactor round 3, A2 bug 10)
      await page.evaluate(() => { const n = window.__velia.m4.ui.flat.el.querySelector('.ring.steer'); n.__held = true; });
      await page.setViewportSize({ width: W, height: H - 12 }); await page.waitForTimeout(300);
      const kept = await page.evaluate(() => !!window.__velia.m4.ui.flat.el.querySelector('.ring.steer')?.__held);
      const r2 = await row(); await up();
      check(kept, `${name}: a layout change mid-drag keeps the held steer ring`);
      check(r2.rudder > r0.rudder + 0.03, `${name}: the rudder holds through it (${r1.rudder} → ${r2.rudder})`);
      await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(300);
      check(r1.rudder - r0.rudder > 0.05, `${name}: a sweep on the steer arc turns the rudder (${r0.rudder} → ${r1.rudder})`);
    }
    const st = await page.evaluate(() => window.__velia.stats());
    check(errors.length === 0 && st.pipelines.afterFirstFrame === 0, `${name}: no page error, 0 pipelines after the first frame (${errors.join('; ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
