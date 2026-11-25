// The two dials (v2/ui/dials.js, the default; ?dials=cockpit the old dials for one release) as the Chart and the Coach (owner,
// 2026-11-25; v2/ui/dialsV2.js) on live pages:
//   desktop 1280 x 720 and 1920 x 1080: both modules at 1.0 x --lk-d, bottom-left (the Chart) and bottom-right (the Coach), the
//     cockpit's faces plain; nothing overlaps them: the top bar, the skipper's line, the key legend, the Pro instruments and the
//     performance panels, the throttle, the fold tabs; no left-edge column
//   the Coach: the no-go wedge centred on the apparent wind, its half-angle luffAwaDeg; the point of sail and the tack; SPEED and
//     WIND, "feels N" on the arrow; no sector ring; a word only on the physics' conditions (a drawing boat: none; an eased jib:
//     "pull in" on the jib, and the skipper's same tip held); PRO adds AWA by the arrow, TWA by the point of sail, VMG at the foot;
//     PRO off takes them away; Regatta shows VMG with PRO off
//   the Chart: the nearest place (the set mark first, else the nearest birthplace or anchorage past 200 m) as its foot row and
//     line; the shore arcs within 240 m in a narrow bay; PRO adds COG under HDG and the bearing on the row
//   the show rules: Calm's idle dims them (still drawn, both), Clear hides them, a played thing (the played seam) hides them,
//     Cruise hides them and Sail brings them back; Regatta shows them; the helm view keeps their size
//   a tablet (no cockpit): the Coach clear of the sheet buttons (ui/touch.js)
//   a phone 844 x 390: the compact dials under the top bar's corners, clear of the flat controls, the Coach's words and rows hidden;
//     a real tap enlarges it with the words and the point of sail, and steps "⋯" out; a second tap brings it back
// Run by `npm run test:pages:v2 -- dialModules`, or node v2/tests/pages/dialModules.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { luffAwaDeg, BOAT } from '../../../src/sim/boat.js';
import { nearestPoi } from '../../ui/dialsV2.js';

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
  const sel = { wind: '.lk-cv', chart: '.lk-chart .small', skipper: '.lk-hint .row.in', bar: '.nb .isl', nav: '.lk-nav', pro: '.lk-proi', perf: '.lk-perf', keys: '.lk-keys:not(.tp-keys)', thr: '.lk-thr', fold: '.lk-ftab',
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
    const { ctx, page, errors } = await open(`${Q}&hud=full&prohud=1&perfhud=1&winddir=180&windspeed=7&heading=232`, { w, h });
    let B = await boxes(page);
    const D = Math.round(await probeD(page));
    check(B.chart && B.wind && Math.abs(B.chart.w - D) <= 1 && Math.abs(B.wind.w - D) <= 1, `${w}×${h}: both modules at 1.0 × --lk-d, ${D} px (chart ${fmt(B.chart)}, wind ${fmt(B.wind)})`);
    check(!B.nav && !!B.pro && !!B.perf, `${w}×${h}: no left-edge column; the Pro (?prohud=1) and perf (?perfhud=1) panels up (${fmt(B.pro)}, ${fmt(B.perf)})`);
    check(B.chart.x + B.chart.w / 2 < w / 3 && B.wind.x + B.wind.w / 2 > 2 * w / 3 && B.chart.y + B.chart.h > h - 60 && B.wind.y + B.wind.h > h - 60, `${w}×${h}: chart bottom-left, wind bottom-right`);
    const st = await page.evaluate(() => ({ dials: window.__velia.m4.ui.station?.dials, dm: document.documentElement.classList.contains('lk-dm') }));
    check(st.dials === 'modules' && st.dm, `${w}×${h}: the cockpit's faces plain (station dials ${st.dials})`);
    noHits(B, ['bar', 'skipper', 'keys', 'pro', 'perf', 'thr', 'fold'], `${w}×${h}`);
    // the dials' text: PRO off is the default design; PRO on adds the extras; off takes them away
    const txt = () => page.evaluate(() => ({ aw: document.querySelector('.lk-cv .cg .aw')?.textContent ?? '', tw: document.querySelector('.lk-cv .rw.c1 .tw')?.textContent ?? '', c3: document.querySelector('.lk-cv .rw.c3')?.textContent ?? '',
      cog: (() => { const r = document.querySelector('.lk-chart .small .cogr'); return !!r && !r.hidden && getComputedStyle(r).display !== 'none' ? r.textContent : ''; })(), poi: document.querySelector('.lk-chart .small .poi')?.textContent ?? '' }));
    const t0 = await txt();
    check(!t0.aw && !t0.tw && !/VMG/.test(t0.c3) && !t0.cog && !/°/.test(t0.poi), `${w}×${h} PRO off: no AWA, TWA, VMG, COG or bearing on the dials (${JSON.stringify(t0)})`);
    await page.evaluate(() => window.__velia.m4.ui.setPro(true)); await page.waitForTimeout(2000);
    const t1 = await txt();
    check(/^\d+°$/.test(t1.aw) && /^\d+°$/.test(t1.tw) && /VMG\d+\.\d/.test(t1.c3) && /^COG\d{3}°$/.test(t1.cog) && /\d{3}°$/.test(t1.poi), `${w}×${h} PRO on: AWA by the arrow, TWA by the point of sail, VMG at the foot, COG under HDG, the bearing on the row (${JSON.stringify(t1)})`);
    B = await boxes(page);
    noHits(B, ['bar', 'skipper', 'keys', 'pro', 'perf', 'thr', 'fold'], `${w}×${h} PRO`);
    await page.evaluate(() => window.__velia.m4.ui.setPro(false)); await page.waitForTimeout(1200);
    const t2 = await txt();
    check(!t2.aw && !t2.tw && !/VMG/.test(t2.c3) && !t2.cog, `${w}×${h} PRO off again: the extras gone (${JSON.stringify(t2)})`);
    if (w === 1280) {
      // the wind dial: the wedge about the apparent wind, its half-angle the luff angle
      const wd = await page.evaluate(() => {
        const s = window.__velia.m4.ui.services.get('player').phys.state, d = document.querySelector('.lk-cv .wedge').getAttribute('d');
        const n = d.match(/-?\d+(\.\d+)?/g).map(Number);   // M bx by L x0 y0 A r r 0 0 1 x1 y1 Z
        return { awa: s.apparentWind.angle, leeway: s.leeway ?? 0, n, pos: document.querySelector('.lk-cv .rw.c1 b')?.textContent, tack: document.querySelector('.lk-cv .rw.c1 em')?.textContent ?? '',
          c2: document.querySelector('.lk-cv .rw.c2')?.textContent, c3: document.querySelector('.lk-cv .rw.c3')?.textContent, fw: document.querySelector('.lk-cv .cg .fw')?.textContent, arcs: document.querySelectorAll('.lk-cv .sect path').length,
          ww: document.querySelector('.lk-cv .cg .ww')?.textContent, lw: document.querySelector('.lk-cv .cg .lw')?.textContent };
      });
      const [bx, by, x0, y0] = wd.n, [x1, y1] = wd.n.slice(-2);
      const ang = (x, y) => Math.atan2(x - bx, -(y - by)) * 180 / Math.PI;
      const a0 = ang(x0, y0), a1 = ang(x1, y1), half = ((a1 - a0 + 540) % 360 - 180) / 2, mid = a0 + half;
      const want = Math.round(luffAwaDeg(BOAT, wd.leeway)), awa = wd.awa * 180 / Math.PI;
      check(Math.abs(((mid - awa + 540) % 360) - 180) < 1.5 && Math.abs(half - want) < 1.2, `the wedge centred on the apparent wind (mid ${mid.toFixed(1)}° vs AWA ${awa.toFixed(1)}°), half-angle ${half.toFixed(1)}° = luffAwaDeg ${want}°`);
      check(['In irons', 'Close-hauled', 'Close reach', 'Beam reach', 'Broad reach', 'Running'].includes(wd.pos) && /^(port|stbd) tack$/.test(wd.tack), `the point of sail and the tack ("${wd.pos}", "${wd.tack}")`);
      check(/^SPEED\d+\.\dkn$/.test(wd.c2) && /^WIND\d+kn$/.test(wd.c3) && /^feels \d+$/.test(wd.fw) && wd.ww === 'windward' && wd.lw === 'leeward', `SPEED, WIND, "feels N", windward and leeward (${wd.c2} | ${wd.c3} | ${wd.fw})`);
      check(wd.arcs === 0, `no sector ring for anyone (${wd.arcs})`);
      // a word only on the physics' conditions: trim both sheets to drawing, then ease the jib past its luff
      const words = () => page.evaluate(() => { const s = window.__velia.m4.ui.services.get('player').phys.state, q = (c) => document.querySelector(`.lk-cv .cg ${c}`)?.textContent ?? '';
        return { jibFill: +(s.jibFill ?? 1).toFixed(2), mainFill: +(s.mainFill ?? 1).toFixed(2), mainStall: +(s.mainStall ?? 0).toFixed(2), jibStall: +(s.jibStall ?? 0).toFixed(2), jib: q('.tg.jib'), main: q('.tg.main'), sc: q('.sc'), ng: q('.ng'),
          jibAmber: document.querySelector('.lk-cv .sail.jib').classList.contains('warn'), says: window.__velia.m4.ui.captain.coachSays, line: document.querySelector('.lk-hint .row.in')?.textContent ?? '' }; });
      await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
      await page.keyboard.down('KeyS'); await page.waitForTimeout(400); await page.keyboard.up('KeyS');
      await page.evaluate(() => { let n = 0; const id = setInterval(() => { window.__velia.boat.sim.station({ jib: -0.04 }); if (++n > 60) clearInterval(id); }, 50); });
      await page.waitForTimeout(3600);
      const w1 = await words();
      const jibLuff = w1.jibFill < 0.5, mainLuff = w1.mainFill < 0.5;
      check(jibLuff && w1.jib === 'pull in' && w1.jibAmber, `an eased jib luffing (fill ${w1.jibFill}): amber, "pull in" on the jib (${JSON.stringify(w1)})`);
      check((mainLuff ? w1.main === 'pull in' : w1.mainStall > 0.6 ? w1.main === 'ease out' : w1.main === '') && !w1.ng, `the main's word matches its physics (fill ${w1.mainFill}, stall ${w1.mainStall}: "${w1.main}"); no "no-go" out of irons`);
      check(w1.says && !/pull the sails in|shaking/i.test(w1.line), `the Coach speaks, the skipper's same tip waits ("${w1.line}")`);
      // the Chart: the nearest place and the shore arcs (the default start lies in a narrow bay)
      const cp = () => page.evaluate(() => { const st = window.__velia.m4.ui.chart.chart.stats(), s = window.__velia.m4.ui.services.get('player').phys.state;
        const bp = (window.__velia.m4.ui.services.get('birthplace')?.list?.() ?? []).map((r) => ({ kind: 'birthplace', name: r.name, x: r.x, z: r.z }));
        const an = (window.__velia.boat.sim.sea?.anchorages ?? []).map((r) => ({ kind: 'anchorage', name: '', x: r.x, z: r.z }));
        return { poi: st.poi, arcs: st.shoreArcs, boat: { x: s.x, z: s.z }, list: [...bp, ...an], row: document.querySelector('.lk-chart .small .poi')?.textContent ?? '' }; });
      const c1 = await cp(), want1 = nearestPoi(c1.boat, c1.list);
      check(!!c1.poi && c1.poi.kind === want1?.kind && Math.abs(c1.poi.dM - want1.dM) < 40 && c1.row.length > 4, `the nearest place: ${c1.poi?.kind} at ${c1.poi?.dM} m (want ${want1?.kind} at ${Math.round(want1?.dM)} m); the row "${c1.row}"`);
      check(Array.isArray(c1.arcs) && c1.arcs.length > 0 && c1.arcs.every((a) => a.m > 0 && a.m <= 240), `the shore arcs in the bay: ${c1.arcs?.length} bearings within 240 m (${JSON.stringify(c1.arcs?.slice(0, 4))})`);
      await page.evaluate(() => { const s = window.__velia.m4.ui.services.get('player').phys.state; window.__velia.beacon.mark?.set?.(s.x + 900, s.z); });
      await page.waitForTimeout(1500);
      const c2 = await cp();
      check(c2.poi?.kind === 'mark' && Math.abs(c2.poi.dM - 900) < 80 && Math.abs(((c2.poi.brg - 90 + 540) % 360) - 180) < 8, `a set mark wins: ${JSON.stringify(c2.poi)} (900 m east)`);
      await page.evaluate(() => window.__velia.beacon.mark?.clear?.()); await page.waitForTimeout(800);
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
    const rv = await page.evaluate(() => ({ pro: window.__velia.m4.ui.pro, c3: document.querySelector('.lk-cv .rw.c3')?.textContent ?? '' }));
    check(!rv.pro && /VMG\d+\.\d/.test(rv.c3), `Regatta: VMG on the Coach's foot with PRO off (${JSON.stringify(rv)})`);
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
    check(s1.log && !s1.menu, `a click on the Coach opens the logbook (${JSON.stringify(s1)})`);
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
    const posShown = () => page.evaluate(() => { const e = document.querySelector('.lk-cv .rw.c1'), g = document.querySelector('.lk-cv .cg'); return !!e && getComputedStyle(e).display !== 'none' && !!g && getComputedStyle(g).display !== 'none'; });
    check(!(await posShown()), 'phone compact: no words and no point of sail (the boat, the sails\' colours and SPEED)');
    const tapWind = async () => { const r = await page.evaluate(() => { const b = document.querySelector('.lk-flat .b.dl[data-k=wind]').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); await page.touchscreen.tap(r[0], r[1]); await page.waitForTimeout(700); };
    await tapWind();
    B = await boxes(page);
    const D0 = (await boxes(page)).chart.w;
    check(B.cls.includes('lk-fl-wup') && B.wind.w > D0 * 1.4 && await posShown() && !B.more, `phone: a tap enlarges the wind dial (${fmt(B.wind)}), its words and point of sail show, "⋯" steps out`);
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
