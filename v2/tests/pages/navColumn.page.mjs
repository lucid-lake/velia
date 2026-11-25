// The left edge on a live v2 page since 2026-11-25: the nav column is gone; the Pro instruments panel (v2/ui/proHud.js), the
// performance panel's twin at the top-left, replaced it:
//   - no .lk-nav and no navColumn on Sail's UI, with the cockpit's PRO on; the passage service stays (the beacon reads it)
//   - off by default; Setup › Screen › Pro instruments (reads off); on shows it top-left (16 px in, at the bar's top), six lines
//     (COG, TWA, VMG, AWA, HEEL, RUD), clear of the top bar's Menu, the skipper's line, the Chart and the performance panel, at
//     1280 x 720 and 1920 x 1080
//   - the PRO switch no longer decides it (off and on: the panel stays as Setup has it)
//   - the perf panel's rule: folded (H), Clear, played (Tessie's seam), Cruise take it; the helm view keeps it
//   - its ×: hides it, the row reads off, and that survives a reload; ?prohud=1 shows it whatever Setup holds, ?prohud=0 never
//   - a tablet: never
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/navColumn.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const Q = 'mode=sail&hour=15&seed=1&noload=1&hud=full&cinema=0&pro=1&once=0&fv=1&hm=0&chatter=0&perfhud=1';
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const ready = (page) => page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station?.shown && window.__velia.m4.ui.cockpitUp, null, { timeout: 240000 });
const open = async (url, { viewport = { width: 1280, height: 720 }, keep = null } = {}) => {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch {} }, SEEN);
  if (keep) await ctx.addInitScript(keep);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${url}`, { waitUntil: 'load' });
  return { ctx, page, errors };
};
const shown = (page) => page.evaluate(() => { const e = document.querySelector('.lk-proi'); if (!e) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && +cs.opacity > 0.05; });
const boxes = (page) => page.evaluate(() => {
  const r = (q) => { const e = [...document.querySelectorAll(q)].find((n) => { const cs = getComputedStyle(n); return n.getClientRects().length && cs.visibility !== 'hidden' && +cs.opacity > 0.05; }); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  return { pro: r('.lk-proi'), bar: r('.nb .isl'), menu: r('.nb .isl button'), skipper: r('.lk-hint .row.in'), chart: r('.lk-chart .small'), perf: r('.lk-perf'), vw: innerWidth };
});
const hit = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
const fmt = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : 'none');
const layout = async (page, label) => {
  await page.evaluate(() => window.__velia.m4.ui.viewSwitch.say('Tap Helm for the helm view')); await page.waitForTimeout(1000);
  const B = await boxes(page);
  check(!!B.pro && Math.abs(B.pro.x - 16) <= 1 && Math.abs(B.pro.y - 14) <= 1 && B.pro.h < 200, `${label}: the panel top-left, 16 px in, at the bar's top (${fmt(B.pro)})`);
  for (const k of ['bar', 'menu', 'skipper', 'chart', 'perf']) check(!hit(B.pro, B[k]), `${label}: clear of the ${k} (${fmt(B.pro)} vs ${fmt(B[k])})`);
  check(!!B.perf && B.bar.x - B.pro.r >= 24, `${label}: ${Math.round(B.bar.x - B.pro.r)} px left of the top bar (the perf panel at ${fmt(B.perf)})`);
};
try {
  {
    const { ctx, page, errors } = await open(Q);
    await ready(page); await page.waitForTimeout(2500);
    const g = await page.evaluate(() => ({ nav: !!document.querySelector('.lk-nav'), ui: 'navColumn' in window.__velia.m4.ui, svc: !!window.__velia.m4.ui.services.get('navColumn'), passage: !!window.__velia.m4.ui.services.get('passage'), pro: window.__velia.m4.ui.pro }));
    check(!g.nav && !g.ui && !g.svc && g.passage && g.pro, `the nav column is gone (PRO on), the passage service stays (${JSON.stringify(g)})`);
    const row = () => page.evaluate(() => { const r = document.querySelector('#tp-set-screen [data-set="prohud"]'); return r ? { k: r.querySelector('.k').textContent, on: r.querySelector('[data-pi=on]').getAttribute('aria-checked'), off: r.querySelector('[data-pi=off]').getAttribute('aria-checked') } : null; });
    const r0 = await row();
    check(!(await shown(page)), 'a fresh profile: the Pro panel is off by default');
    check(r0?.k === 'Pro instruments' && r0.off === 'true', `Setup › Screen has the row, reading off (${JSON.stringify(r0)})`);
    await page.evaluate(() => document.querySelector('#tp-set-screen [data-pi=on]').click()); await page.waitForTimeout(900);
    check(await shown(page), 'Setup on: the panel shows');
    const st = await page.evaluate(() => window.__velia.m4.ui.proHud.state);
    check(st.lines?.map((l) => l[0]).join() === 'COG,TWA,VMG,AWA,HEEL,RUD' && /^\d{3}°$/.test(st.lines[0][1]) && /kn$/.test(st.lines[2][1]), `six lines: ${JSON.stringify(st.lines)}`);
    await layout(page, '1280x720');
    // the PRO switch no longer decides it
    await page.evaluate(() => window.__velia.m4.ui.setPro(false)); await page.waitForTimeout(800);
    check(await shown(page), 'PRO off: the panel stays (Setup decides)');
    await page.evaluate(() => window.__velia.m4.ui.setPro(true));
    // the perf panel's rule
    await page.mouse.move(640, 300); await page.keyboard.press('KeyH'); await page.waitForTimeout(1200);
    check(!(await shown(page)), 'folded (H): gone');
    await page.keyboard.press('KeyH'); await page.waitForTimeout(1200);
    check(await shown(page), 'raised: back');
    await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('clear')); await page.waitForTimeout(1000);
    check(!(await shown(page)), 'Clear: gone');
    await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('full')); await page.waitForTimeout(1000);
    await page.evaluate(() => window.__velia.m4.ui.views.set('helm')); await page.waitForTimeout(1500);
    check(await shown(page), 'the helm view keeps it');
    await page.evaluate(() => window.__velia.m4.ui.views.set('follow')); await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__probeThing = { active: true }; window.__velia.played.add('probe', window.__probeThing); }); await page.waitForTimeout(1000);
    check(!(await shown(page)), 'played (Tessie\'s seam): gone');
    await page.evaluate(() => { window.__probeThing.active = false; }); await page.waitForTimeout(1200);
    await page.evaluate(() => window.__velia.mode.go('cruise')); await page.waitForFunction(() => window.__velia.mode.now() === 'cruise', null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    check(!(await shown(page)), 'Cruise: gone');
    await page.evaluate(() => window.__velia.mode.go('sail')); await page.waitForFunction(() => window.__velia.mode.now() === 'sail' && window.__velia.m4.ui.cockpitUp, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    check(await shown(page), 'back in Sail: the panel again');
    // the ×
    const X = await page.evaluate(() => { const x = document.querySelector('.lk-proi button.x'), b = x.getBoundingClientRect(); const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { w: b.width, h: b.height, label: x.getAttribute('aria-label'), top: at === x || x.contains(at), cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; });
    check(X.w >= 24 && X.h >= 24 && X.label === 'Close Pro instruments' && X.top, `the ×: ${X.w}x${X.h}, "${X.label}", on top`);
    await page.mouse.click(X.cx, X.cy); await page.waitForTimeout(800);
    const r1 = await row();
    check(!(await shown(page)) && r1.off === 'true', `the × hides it; the row reads off (${JSON.stringify(r1)})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ') || 'none'})`);
    await page.reload({ waitUntil: 'load' }); await ready(page); await page.waitForTimeout(2000);
    check(!(await shown(page)) && (await row()).off === 'true', 'after a reload: still off');
    await page.goto(`${BASE}/?${Q}&prohud=1`, { waitUntil: 'load' }); await ready(page); await page.waitForTimeout(2000);
    check(await shown(page), '?prohud=1: shown whatever Setup holds');
    await page.goto(`${BASE}/?${Q}&prohud=0`, { waitUntil: 'load' }); await ready(page); await page.waitForTimeout(1500);
    check(!(await shown(page)) && !(await page.evaluate(() => !!document.querySelector('.lk-proi'))), '?prohud=0: never');
    await ctx.close();
  }
  {
    const { ctx, page, errors } = await open(Q, { viewport: { width: 1920, height: 1080 }, keep: () => { try { localStorage.setItem('lakeshore.v2.prohud', JSON.stringify({ on: true })); } catch {} } });
    await ready(page); await page.waitForTimeout(2500);
    await layout(page, '1920x1080');
    check(errors.length === 0, `1920x1080: no page errors (${errors.slice(0, 2).join(' | ') || 'none'})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(`${Q}&prohud=1&profile=form:tablet`);
    await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 }); await page.waitForTimeout(1500);
    check(await page.evaluate(() => !document.querySelector('.lk-proi') && !document.querySelector('.lk-nav')), 'a tablet (even with ?prohud=1): no panel, no column');
    await ctx.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
