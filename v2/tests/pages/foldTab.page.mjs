// The cockpit's fold tab on the v2 page (v2/ui/foldTab.js, mounted by v2/ui/station.js; owner 2026-11-16: "a slim tab on the cockpit's
// bottom-left rim, where the folded strip ends up, so the same spot folds and raises it"; it was a chevron on the wheel's boss). Two
// states only: up, the whole cockpit raised; folded, the whole cockpit lowered out of view (sink 1: no peek, no pucks, no raised dial).
//   up      a slim navy tab with a cream chevron on the screen's foot under the coaming's left end (left of the chart instrument);
//           a click folds the cockpit. Focusable: Enter folds; H is its key.
//   folded  the same tab in the same place (its chevron turned up); a click raises the cockpit.
// The slide is about 0.4 s, eased, one way; the tab never vanishes or pops and has no CSS animation of its own.
// Two corners (owner, 2026-11-18): the same tab mirrored under the coaming's right end; either one folds and raises, both show the state.
// A phone: no cockpit, so no fold; the flat controls stay up, H included.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/foldTab.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const seen = (s) => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, s); localStorage.setItem(k, JSON.stringify(o)); } catch {} };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const box = (page) => page.evaluate(() => { const b = window.__velia.m4.ui.station.foldTab, r = b.getBoundingClientRect(), cs = getComputedStyle(b);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, bottom: r.bottom, label: b.getAttribute('aria-label'), tag: b.tagName, tab: b.tabIndex, pe: cs.pointerEvents, up: b.classList.contains('up') }; });
const state = (page) => page.evaluate(() => { const ui = window.__velia.m4.ui, vis = (q) => { const n = document.querySelector(q); return !!n && getComputedStyle(n).visibility !== 'hidden' && +getComputedStyle(n).opacity > 0.05; };
  const ck = ui.station.cockpit;
  return { folded: ui.calm.folded, fold: ui.calm.fold, sink: +ck.sink.toFixed(3), opacity: +ck.opacity.toFixed(3), pucks: vis('button.lk-puck.chart') || vis('button.lk-puck.wind'),
    dials: vis('.lk-cv') || vis('.lk-chart .small'), peek: Object.values(ui.calm.view.need).some(Boolean), strip: !!document.querySelector('.lk-helm .lk-foldstrip:not([hidden])') }; });
const settle = (page, want) => page.waitForFunction((w) => { const ui = window.__velia.m4.ui; return ui.calm.folded === w && Math.abs(ui.station.cockpit.sink - (w ? 1 : 0)) < 1e-6 && (w || ui.station.cockpit.opacity > 0.99); }, want, { timeout: 8000 }).catch(() => {});
const record = (page, S) => page.evaluate((S2) => new Promise((ok) => {
  const ui = window.__velia.m4.ui, btn = ui.station.foldTab, t0 = performance.now(), rows = [];
  const f = () => { const t = (performance.now() - t0) / 1000, cs = getComputedStyle(btn), r = btn.getBoundingClientRect();
    rows.push({ t: +t.toFixed(3), ct: ui.calm.clock.t, sink: ui.station.cockpit.sink, x: r.x, bottom: r.bottom, hidden: btn.hidden, display: cs.display, op: +cs.opacity, anim: btn.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSTransition)).length });
    if (t < S2) requestAnimationFrame(f); else ok(rows); };
  requestAnimationFrame(f);
}), S);
const mono = (rows, k, dir) => rows.every((r, i) => i === 0 || dir * (r[k] - rows[i - 1][k]) >= -0.001);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(seen, SEEN);
  await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&noload=1&hud=full`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.calm && window.__velia.m4.ui.station?.foldTab && !window.__velia.m4.ui.station.foldTab.hidden, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  let b = await box(page);
  const chartL = await page.evaluate(() => (window.__velia.m4.rig ?? window.__velia.m4.cockpit.rig).project('i:chart:l').x);
  check(b.tag === 'BUTTON' && b.w >= 44 && b.h >= 44 && b.tab >= 0 && /cockpit/i.test(b.label ?? '') && b.pe === 'auto', `the fold tab: a ${b.w} x ${b.h} focusable target, "${b.label}"`);
  check(Math.abs(b.bottom - 720) < 0.5 && b.x < chartL && b.x - b.w / 2 >= 0, `up, it stands on the screen's foot under the coaming's left end (centre ${b.x}, foot ${b.bottom}; the chart instrument's left ${chartL.toFixed(0)})`);
  check(!(await page.evaluate(() => !!document.querySelector('.lk-helm button.lk-fold:not(.lk-ftab)'))), 'no chevron on the wheel\'s boss any more');
  const atUp = { x: b.x, y: b.y };
  const [rows] = await Promise.all([record(page, 2.5), (async () => { await page.waitForTimeout(120); await page.mouse.click(atUp.x, atUp.y); })()]); await settle(page, true);
  let st = await state(page);
  const ct0 = rows[0].ct, t05 = (rows.find((r) => r.sink >= 0.05)?.ct ?? ct0 + 9) - ct0, t95 = (rows.find((r) => r.sink >= 0.95)?.ct ?? ct0 + 9) - ct0;
  check(st.folded && st.fold && st.sink === 1 && st.opacity === 0 && !st.peek && !st.pucks && !st.dials && !st.strip, `a click on the tab folds the whole cockpit out of view, no peek, no pucks, no dial (${JSON.stringify(st)})`);
  check(mono(rows, 'sink', 1) && rows.every((r) => r.sink >= 0 && r.sink <= 1), `the fold slides one way, no bounce (sink ${rows.filter((_, i) => i % 6 === 0).map((r) => r.sink.toFixed(2)).join(' ')})`);
  const w05 = rows.find((r) => r.sink >= 0.05)?.t ?? 9, w95 = rows.find((r) => r.sink >= 0.95)?.t ?? 9;
  check(t95 - t05 > 0.15 && t95 - t05 < 0.45, `about 0.4 s, eased (5 % at ${t05.toFixed(2)} s, 95 % at ${t95.toFixed(2)} s of the scene's clock; wall ${w05.toFixed(2)} to ${w95.toFixed(2)} s, ${rows.length} frames)`);
  check(rows.every((r) => !r.hidden && r.display !== 'none' && r.op > 0.99 && r.anim === 0 && Math.abs(r.x - rows[0].x) < 0.5 && Math.abs(r.bottom - 720) < 0.5), `the tab stays put, shown and opaque every frame, no animation (${rows.length} frames)`);
  b = await box(page);
  check(b.up && Math.abs(b.x - atUp.x) < 0.5 && Math.abs(b.y - atUp.y) < 0.5 && /raise/i.test(b.label), `folded: the same tab in the same spot, "${b.label}"`);
  const rows2 = await Promise.all([record(page, 1.0), (async () => { await page.waitForTimeout(60); await page.mouse.click(atUp.x, atUp.y); })()]).then(([r]) => r); await settle(page, false); st = await state(page);
  check(!st.folded && st.sink === 0 && st.opacity >= 0.99 && mono(rows2, 'sink', -1), `the same spot raises the whole cockpit (${JSON.stringify(st)})`);
  // the keyboard: focus and Enter; then H
  await page.focus('.lk-helm button.lk-ftab'); await page.keyboard.press('Enter'); await settle(page, true);
  const kbd = (await state(page)).folded;
  await page.mouse.move(640, 200);
  await page.keyboard.press('KeyH'); await settle(page, false);
  const h1 = await state(page);
  await page.keyboard.press('KeyH'); await settle(page, true);
  const h2 = await state(page);
  check(kbd && !h1.folded && h1.sink === 0 && h2.folded && h2.sink === 1, `Enter on the focused tab folds it; H raises it, H again folds it (${kbd}, ${h1.sink}, ${h2.sink})`);
  await page.keyboard.press('KeyH'); await settle(page, false);
  // the two corners (owner, 2026-11-18: "In both corners, left and right, we should have the same button that can hide the cockpit"):
  // a second tab, the left one's mirror under the coaming's right end (right of the wind instrument); same size, look and state; it
  // folds and raises the same cockpit, by click and by Enter; both turn their chevron with the state
  {
    const both = () => page.evaluate(() => window.__velia.m4.ui.station.foldTabs.map((b) => { const r = b.getBoundingClientRect(), cs = getComputedStyle(b), g = b.querySelector('b').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, bottom: r.bottom, gw: g.width, gh: g.height, bg: getComputedStyle(b.querySelector('b')).backgroundColor, label: b.getAttribute('aria-label'), tab: b.tabIndex, pe: cs.pointerEvents, op: +cs.opacity, up: b.classList.contains('up'), side: b.dataset.side }; }));
    const windR = await page.evaluate(() => (window.__velia.m4.rig ?? window.__velia.m4.cockpit.rig).project('i:wind:r').x);
    let [L, R] = await both();
    check(L && R && L.side === 'l' && R.side === 'r', 'two fold tabs, one in each corner');
    check(R.w === L.w && R.h === L.h && R.gw === L.gw && R.gh === L.gh && R.bg === L.bg && R.label === L.label && R.tab >= 0 && R.pe === 'auto' && R.op > 0.99,
      `the right tab is the left one's twin (${R.w} x ${R.h}, "${R.label}", focusable)`);
    check(Math.abs(R.bottom - 720) < 0.5 && R.x > windR && R.x + R.w / 2 <= 1280 && Math.abs((1280 - R.x) - L.x) <= 1.5,
      `mirrored: right of the wind instrument's rim (${windR.toFixed(0)}), centre ${R.x} vs the left's ${L.x}`);
    await page.mouse.click(R.x, R.y); await settle(page, true);
    let st2 = await state(page); [L, R] = await both();
    check(st2.folded && st2.sink === 1 && L.up && R.up && /raise/i.test(L.label) && /raise/i.test(R.label) && L.op > 0.99 && R.op > 0.99, `a click on the right tab folds the cockpit; both tabs show "raise" (${st2.sink}, ${L.up}, ${R.up})`);
    await page.mouse.click(R.x, R.y); await settle(page, false);
    st2 = await state(page); [L, R] = await both();
    check(!st2.folded && st2.sink === 0 && !L.up && !R.up, `the right tab raises it again; both tabs show "lower" (${st2.sink})`);
    await page.mouse.click(L.x, L.y); await settle(page, true);
    const viaL = (await state(page)).folded;
    await page.mouse.click(R.x, R.y); await settle(page, false);
    const viaR = (await state(page)).folded;
    check(viaL && !viaR, 'folded by the left tab, raised by the right one (one shared state)');
    await page.focus('.lk-helm button.lk-ftab[data-side="r"]'); await page.keyboard.press('Enter'); await settle(page, true);
    const k1 = (await state(page)).folded;
    await page.focus('.lk-helm button.lk-ftab[data-side="r"]'); await page.keyboard.press('Enter'); await settle(page, false);
    const k2 = (await state(page)).folded;
    check(k1 && !k2, 'Enter on the focused right tab folds, Enter again raises');
  }
  const ve = await page.evaluate(() => window.__velia.errors.slice());
  check(!errors.length && !ve.length, `desktop: no page errors (${[...errors, ...ve].join(' | ').slice(0, 300) || 'none'})`);
  await page.close();
  // ---------------- a phone sideways ----------------
  // Since (owner, 2026-11-16) a phone has no 3D cockpit, so nothing folds there: the finger's mark and strip went with it
  // (a tablet has no cockpit either; the desktop case above keeps the fold). The phone keeps the flat controls, never a fold tab.
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    await ctx.addInitScript(seen, SEEN);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&noload=1&hud=full&touch=1&attract=0&mute=1&fv=1&hm=0&chatter=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.boat?.sim?.t > 1 && window.__velia.m4?.ui?.flat?.shown, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const p = await page.evaluate(() => { const f = [...document.querySelectorAll('.lk-fold, .lk-foldstrip')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; }); return { flat: window.__velia.m4.ui.flat.on, station: !!window.__velia.m4.ui.station, fold: f.length }; });
    check(p.flat && !p.station && p.fold === 0, `phone: the flat controls, no cockpit and no fold tab (${JSON.stringify(p)})`);
    await page.keyboard.press('KeyH'); await page.waitForTimeout(600);
    const ve = await page.evaluate(() => window.__velia.errors.slice());
    check(!errors.length && !ve.length && await page.evaluate(() => window.__velia.m4.ui.flat.shown), `phone: H with nothing to fold leaves the flat controls up, no page errors (${[...errors, ...ve].join(' | ').slice(0, 300) || 'none'})`);
    await ctx.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
