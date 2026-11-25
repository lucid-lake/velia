// The two dials as 2D modules (v2/ui/dials.js, the default; ?dials=cockpit the old dials for one release) on live pages:
//   desktop 1280 × 720 and 1920 × 1080: both modules on screen at the hover size (0.8 × --lk-d), bottom-left (chart) and
//     bottom-right (wind), the cockpit's faces plain; nothing overlaps them: the top bar, the skipper's line, the key legend, the
//     nav column (Pro on: its readings up), the throttle, the fold tabs (the round module against each box)
//   the wind dial: the no-go wedge centred on the apparent wind, its half-angle luffAwaDeg (the boat's leeway); the point of
//     sail's word; the sector ring for a New player only (its 10 arcs), none for "I sail"
//   the show rules: Calm's idle dims them (still drawn, both), Clear hides them, a played thing (the played seam) hides them,
//     Cruise hides them and Sail brings them back; Regatta shows them; the helm view keeps their size
//   a tablet (no cockpit): the wind module clear of the sheet buttons (ui/touch.js)
//   a phone 844 × 390: the compact dials under the top bar's corners, clear of the flat controls; a real tap on the wind dial
//     enlarges it with the point of sail (hidden while compact) and steps "⋯" out; a second tap brings it back
// Run by `npm run test:pages:v2 -- dialModules`, or node v2/tests/pages/dialModules.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { luffAwaDeg, BOAT } from '../../../src/sim/boat.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = (profile) => ({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, profile });
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const Q = 'mode=sail&hour=15&seed=1&noload=1&quality=1&kayaks=0&chatter=0&attract=0&fv=1&hm=0&mute=1';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });

async function open(q, { w = 1280, h = 720, profile = 'new', ctxOpts = {}, ready = 'm4', slow = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...ctxOpts });
  await ctx.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN(profile));
  if (slow) await ctx.route(slow.re, async (r) => { await new Promise((ok) => setTimeout(ok, slow.ms)); await r.continue(); });   // a module that arrives late
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${q}`, { waitUntil: 'load' });
  await page.waitForFunction((r) => window.__velia?.ready && window.__velia.m4?.ui && (r !== 'flat' || window.__velia.m4.ui.flat?.shown), ready, { timeout: 240000 });
  await page.waitForFunction(() => document.querySelector('.lk-chart .small'), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
  return { ctx, page, errors };
}
// the boxes on screen (drawn: a size, visible, opacity > 0); the modules' opacity; the html classes
const boxes = (page) => page.evaluate(() => {
  const sel = { wind: '.lk-cv', chart: '.lk-chart .small', skipper: '.lk-hint .row.in', bar: '.nb .isl', nav: '.lk-nav', keys: '.lk-keys:not(.tp-keys)', thr: '.lk-thr', fold: '.lk-ftab',
    more: '.lk-flat .b.more', sideL: '.lk-flat .side.l', sideR: '.lk-flat .side.r', rc: '.lk-flat .b.rc:not(.off)', sheet: '#hands .sheet', strip: '#hands .helm' };
  const out = {};
  const seen = (e) => { for (let p = e; p && p !== document.documentElement; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; } return true; };
  for (const [k, s] of Object.entries(sel)) [...document.querySelectorAll(s)].forEach((e, i) => {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height || !seen(e)) return;
    out[i ? `${k}${i}` : k] = { x: r.left, y: r.top, w: r.width, h: r.height, op: +getComputedStyle(e).opacity };
  });
  out.cls = document.documentElement.className;
  out.d = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lk-d')) || null;
  return out;
});
const probeD = (page) => page.evaluate(() => { const p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;width:var(--lk-d)'; document.body.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return w; });
// a round module against a box (the module's circle and its 5 px bezel)
const circleHits = (c, b, pad = 5) => { const cx = c.x + c.w / 2, cy = c.y + c.h / 2, r = c.w / 2 + pad; const nx = Math.max(b.x, Math.min(cx, b.x + b.w)), ny = Math.max(b.y, Math.min(cy, b.y + b.h)); return Math.hypot(nx - cx, ny - cy) < r; };
const rectHits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const fmt = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}` : '-');
function noHits(B, others, label) {
  const hits = [];
  for (const m of ['chart', 'wind']) for (const k of Object.keys(B)) if (others.some((o) => k === o || k.startsWith(o) && /\d$/.test(k)) && B[m] && circleHits(B[m], B[k])) hits.push(`${m}×${k} (${fmt(B[k])})`);
  check(!hits.length, `${label}: nothing over the modules (${hits.join('; ') || `chart ${fmt(B.chart)}, wind ${fmt(B.wind)}`})`);
}

try {
  // ---------------- desktop, two sizes ----------------
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    const { ctx, page, errors } = await open(`${Q}&hud=full`, { w, h });
    let B = await boxes(page);
    const D = Math.round((await probeD(page)) * 0.8);
    check(B.chart && B.wind && Math.abs(B.chart.w - D) <= 1 && Math.abs(B.wind.w - D) <= 1, `${w}×${h}: both modules at the hover size ${D} px (chart ${fmt(B.chart)}, wind ${fmt(B.wind)})`);
    check(B.chart.x + B.chart.w / 2 < w / 3 && B.wind.x + B.wind.w / 2 > 2 * w / 3 && B.chart.y + B.chart.h > h - 60 && B.wind.y + B.wind.h > h - 60, `${w}×${h}: chart bottom-left, wind bottom-right`);
    const st = await page.evaluate(() => ({ dials: window.__velia.m4.ui.station?.dials, dm: document.documentElement.classList.contains('lk-dm') }));
    check(st.dials === 'modules' && st.dm, `${w}×${h}: the cockpit's faces plain (station dials ${st.dials})`);
    noHits(B, ['bar', 'skipper', 'keys', 'nav', 'thr', 'fold'], `${w}×${h}`);
    await page.evaluate(() => window.__velia.m4.ui.setPro(true)); await page.waitForTimeout(2000);
    B = await boxes(page);
    check(!!B.nav, `${w}×${h} Pro: the nav column's readings up (${fmt(B.nav)})`);
    noHits(B, ['bar', 'skipper', 'keys', 'nav', 'thr', 'fold'], `${w}×${h} Pro`);
    await page.evaluate(() => window.__velia.m4.ui.setPro(false));
    if (w === 1280) {
      // the wind dial: the wedge about the apparent wind, its half-angle the luff angle
      const wd = await page.evaluate(() => {
        const s = window.__velia.m4.ui.services.get('player').phys.state, d = document.querySelector('.lk-cv .wedge').getAttribute('d');
        const n = d.match(/-?\d+(\.\d+)?/g).map(Number);   // M bx by L x0 y0 A r r 0 0 1 x1 y1 Z
        return { awa: s.apparentWind.angle, leeway: s.leeway ?? 0, n, pos: document.querySelector('.lk-cv .rw.pos')?.textContent, arcs: document.querySelectorAll('.lk-cv .sect path').length };
      });
      const [bx, by, x0, y0] = wd.n, [x1, y1] = wd.n.slice(-2);
      const ang = (x, y) => Math.atan2(x - bx, -(y - by)) * 180 / Math.PI;
      const a0 = ang(x0, y0), a1 = ang(x1, y1), half = ((a1 - a0 + 540) % 360 - 180) / 2, mid = a0 + half;
      const want = Math.round(luffAwaDeg(BOAT, wd.leeway)), awa = wd.awa * 180 / Math.PI;
      check(Math.abs(((mid - awa + 540) % 360) - 180) < 1.5 && Math.abs(half - want) < 1.2, `the wedge centred on the apparent wind (mid ${mid.toFixed(1)}° vs AWA ${awa.toFixed(1)}°), half-angle ${half.toFixed(1)}° = luffAwaDeg ${want}°`);
      check(['In irons', 'Close-hauled', 'Close reach', 'Beam reach', 'Broad reach', 'Running'].includes(wd.pos), `the point of sail under the readings ("${wd.pos}")`);
      check(wd.arcs === 10, `a New player: the sector ring's 10 arcs (${wd.arcs})`);
      await page.evaluate(() => window.__velia.settings().set('profile', 'sail')); await page.waitForTimeout(800);
      const arcs2 = await page.evaluate(() => document.querySelectorAll('.lk-cv .sect path').length);
      check(arcs2 === 0, `"I sail": no sector ring (${arcs2})`);
      // the show rules on this page: Clear, a played thing, Cruise and back
      const cls = () => page.evaluate(() => ({ off: document.documentElement.classList.contains('lk-dm-off'), dim: document.documentElement.classList.contains('lk-dm-dim') }));
      await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('clear')); await page.waitForTimeout(900);
      B = await boxes(page);
      check((await cls()).off && !B.chart && !B.wind, 'Clear: both modules hidden');
      await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('full')); await page.waitForTimeout(900);
      B = await boxes(page);
      check(!(await cls()).off && B.chart && B.wind, 'Full: back');
      await page.evaluate(() => { const S = window.__velia.m4.ui.services; window.__realPlayed = S.get('played'); S.provide('played', { played: true }); }); await page.waitForTimeout(1300);   // past Calm's 600 ms fade (its visibility flips at the end)
      B = await boxes(page);
      { const c = await cls(); check(c.off && !B.chart && !B.wind, `a played thing (Tessie): both modules hidden (${JSON.stringify(c)}, chart ${fmt(B.chart)}, wind ${fmt(B.wind)})`); }
      await page.evaluate(() => window.__velia.m4.ui.services.provide('played', window.__realPlayed)); await page.waitForTimeout(600);
      await page.evaluate(() => window.__velia.mode.go('cruise')); await page.waitForFunction(() => window.__velia.mode.current === 'cruise', null, { timeout: 60000 }); await page.waitForTimeout(1500);
      B = await boxes(page);
      check((await cls()).off && !B.chart && !B.wind, 'Cruise: no dials');
      await page.evaluate(() => window.__velia.mode.go('sail')); await page.waitForFunction(() => window.__velia.mode.current === 'sail', null, { timeout: 60000 }); await page.waitForTimeout(1500);
      B = await boxes(page);
      check(!(await cls()).off && B.chart && B.wind, 'back in Sail: both modules');
      // the helm view keeps their size
      await page.evaluate(() => window.__velia.m4.ui.views.set('helm')); await page.waitForTimeout(1800);
      B = await boxes(page);
      check(B.wind && Math.abs(B.wind.w - D) <= 1, `the helm view keeps the module size (${fmt(B.wind)})`);
    }
    const ve = await page.evaluate(() => window.__velia.errors.slice());
    check(!errors.length && !ve.length, `${w}×${h}: no page errors (${[...errors, ...ve].join(' | ').slice(0, 300) || 'none'})`);
    await ctx.close();
  }

  // ---------------- Calm: dims, never hides ----------------
  {
    const { ctx, page, errors } = await open(`${Q}&hud=calm`);
    await page.waitForFunction(() => document.documentElement.classList.contains('lk-calm-dash'), null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const B = await boxes(page);
    const vis = await page.evaluate(() => ['.lk-chart', '.lk-chart .small', '.lk-cv'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return `${c.visibility}/${(+c.opacity).toFixed(2)}`; }));
    check(B.cls.includes('lk-dm-dim') && B.chart && B.wind && B.chart.op < 0.7 && B.wind.op < 0.7 && B.chart.op > 0.2, `Calm's idle dims both modules and keeps them (chart ${B.chart?.op}, wind ${B.wind?.op}; ${vis.join(' ')})`);
    await page.mouse.move(640, 360); await page.keyboard.down('KeyA'); await page.waitForTimeout(150); await page.keyboard.up('KeyA'); await page.waitForTimeout(1000);
    check(!(await page.evaluate(() => document.documentElement.classList.contains('lk-dm-dim'))), 'a helm key wakes them');
    check(!errors.length, `Calm: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }

  // ---------------- Regatta ----------------
  {
    const { ctx, page, errors } = await open('mode=regatta&quick=1&hour=15&seed=1&noload=1&quality=1&kayaks=0&hud=full&attract=0&fv=1&hm=0&mute=1');
    await page.waitForFunction(() => window.__velia.mode.current === 'regatta', null, { timeout: 60000 }); await page.waitForTimeout(3000);
    const B = await boxes(page);
    check(B.chart && B.wind && !B.cls.includes('lk-dm-off'), `Regatta: both modules (chart ${fmt(B.chart)}, wind ${fmt(B.wind)})`);
    check(!errors.length, `Regatta: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }

  // ---------------- a click opens the page (owner 2026-11-25: "click new chart dial does not really open the chart") ----------------
  // The chart page is the live map under the Menu card: what Menu, Esc and N open (the top bar has no Chart button since 2026-11-18). The
  // click must open it even in the beat before the map's module has loaded (the old pin drew nothing then); Esc closes; the wind dial's click opens the logbook.
  {
    const { ctx, page, errors } = await open(`${Q}&hud=full`);
    const S = () => page.evaluate(() => { const sv = window.__velia.m4.ui.services, m = sv.get('menu'), lc = document.querySelector('.lk-livechart');
      return { menu: !!m?.isOpen, state: m?.state, map: !!lc && !lc.hidden && getComputedStyle(lc).display !== 'none', log: !!sv.get('logbook')?.logbook?.isOpen, pinned: !!window.__velia.m4.ui.chart?.chart?.toggle?.pinned }; });
    const click = async (sel, dx = 0) => { const r = await page.evaluate(([q, f]) => { const b = document.querySelector(q).getBoundingClientRect(); return [b.left + b.width * (0.5 + f), b.top + b.height / 2]; }, [sel, dx]);   // dx: off the centre (the wind dial's centre line is the rudder's drag handle, which a click leaves alone)
      await page.mouse.click(r[0], r[1]); await page.waitForTimeout(1200); };
    // the reference: the page Esc opens
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    const ref = await S();
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    check(ref.menu && ref.map && !(await S()).menu, `the reference chart page (Esc): the map under the Menu card (${JSON.stringify(ref)}); Esc closes it`);
    await click('.lk-chart .small');
    let s1 = await S();
    check(s1.menu && s1.map && s1.state === ref.state && !s1.pinned && !s1.log, `a click on the chart module opens the same chart page (${JSON.stringify(s1)})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    s1 = await S();
    check(!s1.menu && !s1.map, `Escape closes the chart page (${JSON.stringify(s1)})`);
    await click('.lk-cv .dial', -0.25);
    s1 = await S();
    check(s1.log && !s1.menu, `a click on the wind module opens the logbook (${JSON.stringify(s1)})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(1000);
    check(!(await S()).log, 'Escape closes the logbook');
    check(!errors.length, `click-to-open: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }

  // the beat before the map's module has loaded (slow network, a cold start): the click opens the Menu card at once; the old pin drew nothing
  {
    const { ctx, page, errors } = await open(`${Q}&hud=full`, { slow: { re: /chart\/mapScreen\.js/, ms: 9000 } });
    const early = await page.evaluate(() => !window.__velia.m4.ui.services.get('mapScreen'));
    const r = await page.evaluate(() => { const b = document.querySelector('.lk-chart .small').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.mouse.click(r[0], r[1]); await page.waitForTimeout(800);
    const s2 = await page.evaluate(() => ({ menu: !!window.__velia.m4.ui.services.get('menu')?.isOpen, pinned: !!window.__velia.m4.ui.chart?.chart?.toggle?.pinned, map: !!window.__velia.m4.ui.services.get('mapScreen') }));
    check(early && !s2.map && s2.menu && !s2.pinned, `the map module not yet loaded: a click opens the page at once, pins nothing (${JSON.stringify(s2)})`);
    await page.waitForFunction(() => window.__velia.m4.ui.services.get('mapScreen'), null, { timeout: 60000 }); await page.waitForTimeout(800);
    check(await page.evaluate(() => { const lc = document.querySelector('.lk-livechart'); return !!lc && !lc.hidden && getComputedStyle(lc).display !== 'none'; }), 'then the map shows under the card');
    check(!errors.length, `late map: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }

  // ---------------- a tablet (no cockpit: the finger's hands) ----------------
  {
    const { ctx, page, errors } = await open(`${Q}&hud=full`, { w: 1180, h: 820, ctxOpts: { isMobile: true, hasTouch: true, userAgent: IPAD } });
    const B = await boxes(page);
    noHits(B, ['bar', 'skipper', 'sheet', 'strip', 'keys', 'nav'], 'tablet 1180×820');
    check(!!B.chart && !!B.wind, `tablet: both modules (${fmt(B.chart)}, ${fmt(B.wind)}; sheet ${fmt(B.sheet)})`);
    check(!errors.length, `tablet: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }

  // ---------------- a phone sideways ----------------
  {
    const { ctx, page, errors } = await open(`${Q}&hud=full&once=0`, { w: 844, h: 390, ready: 'flat', ctxOpts: { deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE } });
    let B = await boxes(page);
    check(B.chart && B.wind && B.bar && B.chart.y >= B.bar.y + B.bar.h - 1 && B.wind.y >= B.bar.y + B.bar.h - 1 && B.chart.x < 200 && B.wind.x > 600, `phone: the compact dials under the top bar's corners (bar ${fmt(B.bar)}; ${fmt(B.chart)}, ${fmt(B.wind)})`);
    noHits(B, ['bar', 'more', 'sideL', 'sideR', 'rc'], 'phone 844×390 compact');
    const posShown = () => page.evaluate(() => { const e = document.querySelector('.lk-cv .rw.pos'); return !!e && getComputedStyle(e).display !== 'none'; });
    check(!(await posShown()), 'phone compact: no point-of-sail word');
    const tapWind = async () => { const r = await page.evaluate(() => { const b = document.querySelector('.lk-flat .b.dl[data-k=wind]').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); await page.touchscreen.tap(r[0], r[1]); await page.waitForTimeout(700); };
    await tapWind();
    B = await boxes(page);
    const D0 = (await boxes(page)).chart.w;
    check(B.cls.includes('lk-fl-wup') && B.wind.w > D0 * 1.4 && await posShown() && !B.more, `phone: a tap enlarges the wind dial (${fmt(B.wind)}), its point of sail shows, "⋯" steps out`);
    await tapWind();
    B = await boxes(page);
    check(!B.cls.includes('lk-fl-wup') && Math.abs(B.wind.w - D0) < 2 && !!B.more, `phone: a second tap brings it back (${fmt(B.wind)})`);
    check(!errors.length, `phone: no page errors (${errors.join(' | ').slice(0, 200) || 'none'})`);
    await ctx.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
