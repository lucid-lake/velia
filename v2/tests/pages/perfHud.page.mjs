// The performance stats panel on the live v2 page (v2/ui/perfHud.js, wired in v2/main.js) and the cockpit-up rule it shares with the Pro
// nav column and the key legend (v2/ui/cockpitUp.js, v2/ui/sail.js):
//   - a desktop in Sail with the cockpit up: the glass plate top-right, six lines, clear of the top bar, the skipper's line, the wind
//     module, the key legend and the nav column at 1280 x 720 and 1920 x 1080; its text 2-4 times a second; its own cost
//   - folded (H), Clear, Tessie played (the played seam), Cruise: the panel, the nav column (Pro on) and the key legend go; raised, they
//     come back; the helm view keeps the panel and the column (the legend's own rule takes it there)
//   - Setup › Screen › performance stats: off hides it and survives a reload; ?perfhud=1 shows it whatever Setup holds
//   - an automated browser, a capture (?headless=1) and a tablet: no panel
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/perfHud.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const seen = (s) => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, s); localStorage.setItem(k, JSON.stringify(o)); } catch {} };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });   // a person's browser: the panel's default path
const Q = 'mode=sail&hour=15&seed=1&noload=1&hud=full&cinema=0&pro=1&once=0&fv=1&hm=0&chatter=0';

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const ready = (page) => page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station?.shown && window.__velia.m4.ui.cockpitUp, null, { timeout: 240000 });
const vis = (page) => page.evaluate(() => {
  const on = (q) => [...document.querySelectorAll(q)].some((e) => { const cs = getComputedStyle(e); return e.getClientRects().length && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; });
  return { perf: on('.lk-perf'), nav: on('.lk-nav.on'), keys: on('.lk-keys.on'), up: window.__velia.m4.ui.cockpitUp };
});
const boxes = (page) => page.evaluate(() => {
  const r = (q) => { const e = [...document.querySelectorAll(q)].find((n) => { const cs = getComputedStyle(n); return n.getClientRects().length && cs.visibility !== 'hidden' && +cs.opacity > 0.05; }); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const keys = [...document.querySelectorAll('.lk-keys.on .r:not(.off), .lk-keys.on > *:not(.off)')].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 0);
  const kb = keys.length ? { x: Math.min(...keys.map((b) => b.x)), y: Math.min(...keys.map((b) => b.y)), r: Math.max(...keys.map((b) => b.right)), b: Math.max(...keys.map((b) => b.bottom)) } : null;
  return { perf: r('.lk-perf'), bar: r('.nb .isl'), skipper: r('.lk-hint .row.in'), wind: r('.lk-cv'), nav: r('.lk-nav.on'), keys: kb ? { ...kb, w: kb.r - kb.x, h: kb.b - kb.y } : null, vw: innerWidth, vh: innerHeight };
});
const hit = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
const fmt = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : 'none');
const open = async (url, { person = true, viewport = { width: 1280, height: 720 }, keep = null } = {}) => {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(seen, SEEN); if (person) await ctx.addInitScript(PERSON);
  if (keep) await ctx.addInitScript(keep.fn, keep.arg);
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${url}`, { waitUntil: 'load' });
  return { ctx, page, errors };
};
const layout = async (page, label) => {
  // a skipper line up while the panel shows (the bar's first-time tip goes to the subtitle line: helmWiring.page.mjs)
  await page.evaluate(() => window.__velia.m4.ui.viewSwitch.say('Tap Helm for the helm view'));
  await page.waitForTimeout(1000);
  const B = await boxes(page);
  check(!!B.perf && Math.abs(B.perf.r - (B.vw - 16)) <= 1 && Math.abs(B.perf.y - 14) <= 1 && B.perf.h < 200, `${label}: the panel top-right, 16 px in, at the bar's top (${fmt(B.perf)})`);
  for (const k of ['bar', 'skipper', 'wind', 'keys', 'nav']) check(!hit(B.perf, B[k]), `${label}: clear of the ${k} (${fmt(B.perf)} vs ${fmt(B[k])})`);
  check(!!B.skipper, `${label}: the skipper's line was up for the check (${fmt(B.skipper)})`);
  // the line is centred and at most half the width (the design rule): it never reaches past 75 % of the width, where the panel starts beyond
  check(B.perf.x > B.vw * 0.75 && B.perf.x - B.bar.r >= 24, `${label}: the panel starts right of the widest skipper line (${Math.round(B.perf.x)} > ${B.vw * 0.75}) and ${Math.round(B.perf.x - B.bar.r)} px right of the bar`);
};
try {
  // ---------------- 1280 x 720: shown, its lines, the layout, the rate, the cost ----------------
  {
    const { ctx, page, errors } = await open(Q);
    await ready(page); await page.waitForTimeout(2500);
    let v = await vis(page);
    check(v.perf && v.nav && v.keys && v.up, `Sail, the cockpit up, Pro on: the panel, the nav column and the key legend show (${JSON.stringify(v)})`);
    const st = await page.evaluate(() => window.__velia.perfHud.state);
    check(st.lines?.length === 6 && st.lines.map((l) => l[0]).join() === 'FPS,Worst,Quality,Draws,Memory,GPU', `six lines: ${JSON.stringify(st.lines)}`);
    check(/^\d+ fps · \d+\.\d ms$/.test(st.lines[0][1]) && /^L\d · \d\.\d\d×$/.test(st.lines[2][1]) && /^\d+ · .+ tri · \d+ pl$/.test(st.lines[3][1]) && /^\d+ MB$/.test(st.lines[4][1]) && st.lines[5][1].length > 2,
      'the readings: fps and ms, the level and scale, draws · triangles · pipelines, MB, the adapter');
    const look = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.lk-perf')); return { fs: parseFloat(cs.fontSize), num: cs.fontVariantNumeric, pe: cs.pointerEvents, bg: cs.backgroundColor }; });
    check(look.fs >= 15 && /tabular-nums/.test(look.num) && look.pe === 'none', `the plate's type: ${look.fs} px, tabular, no pointer (${JSON.stringify(look)})`);
    const a = await page.evaluate(() => window.__velia.perfHud.state); await page.waitForTimeout(3000); const b = await page.evaluate(() => window.__velia.perfHud.state);
    const hz = (b.paints - a.paints) / 3, fps = (b.ticks - a.ticks) / 3;
    check(hz >= 2 && hz <= 4 && fps > hz * 3, `the text at ${hz.toFixed(1)} Hz, the frames at ${fps.toFixed(0)} a second (not every frame)`);
    console.log(`INFO  the panel's cost: ${b.msPerTick.toFixed(4)} ms a frame (meter + rule + paint share), ${b.msPerPaint.toFixed(3)} ms a paint`);
    check(b.msPerTick < 0.1, `its own cost under 0.1 ms a frame (${b.msPerTick.toFixed(4)})`);
    await layout(page, '1280x720');
    // the fold: the panel, the column and the legend go together; raised, they come back
    await page.mouse.move(640, 300); await page.keyboard.press('KeyH'); await page.waitForTimeout(1200);
    v = await vis(page); check(!v.perf && !v.nav && !v.keys && !v.up, `folded (H): the panel, the nav column and the key legend go (${JSON.stringify(v)})`);
    await page.keyboard.press('KeyH'); await page.waitForTimeout(1200);
    v = await vis(page); check(v.perf && v.nav && v.keys, `raised: they come back (${JSON.stringify(v)})`);
    // the fold tab too
    await page.evaluate(() => window.__velia.m4.ui.station.foldTab.click()); await page.waitForTimeout(1200);
    v = await vis(page); check(!v.perf && !v.nav && !v.keys, `the fold tab: all three go (${JSON.stringify(v)})`);
    await page.evaluate(() => window.__velia.m4.ui.station.foldTab.click()); await page.waitForTimeout(1200);
    // Clear
    await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('clear')); await page.waitForTimeout(1000);
    v = await vis(page); check(!v.perf && !v.nav && !v.keys, `Clear: all three go (${JSON.stringify(v)})`);
    await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('full')); await page.waitForTimeout(1000);
    v = await vis(page); check(v.perf && v.nav && v.keys, `Full again: back (${JSON.stringify(v)})`);
    // the helm view: the boat's own cockpit on screen, nothing hidden by the player: the panel and the column stay, the legend goes (its rule)
    await page.evaluate(() => window.__velia.m4.ui.views.set('helm')); await page.waitForTimeout(1500);
    v = await vis(page); check(v.perf && v.nav && !v.keys, `the helm view: the panel and the column stay, the key legend goes (${JSON.stringify(v)})`);
    await page.evaluate(() => window.__velia.m4.ui.views.set('follow')); await page.waitForTimeout(1500);
    // something played in the boat's place (the played seam: Tessie's path)
    await page.evaluate(() => { window.__probeThing = { active: true }; window.__velia.played.add('probe', window.__probeThing); }); await page.waitForTimeout(1000);
    v = await vis(page); check(!v.perf && !v.nav && !v.keys, `played (Tessie's seam): all three go (${JSON.stringify(v)})`);
    await page.evaluate(() => { window.__probeThing.active = false; }); await page.waitForTimeout(1200);
    v = await vis(page); check(v.perf && v.nav, `back on the boat: the panel and the column return (${JSON.stringify(v)})`);
    // Cruise: no cockpit to sail with, no panel
    await page.evaluate(() => window.__velia.mode.go('cruise')); await page.waitForFunction(() => window.__velia.mode.now() === 'cruise', null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2000);
    v = await vis(page); check(!v.perf, `Cruise: no panel (${JSON.stringify(v)})`);
    // Setup › Screen › performance stats: off hides it while the cockpit is up, and survives a reload
    await page.evaluate(() => window.__velia.mode.go('sail')); await page.waitForFunction(() => window.__velia.mode.now() === 'sail' && window.__velia.m4.ui.cockpitUp, null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const row = await page.evaluate(() => { const r = document.querySelector('#tp-set-screen [data-set="perfhud"]'); return r ? { k: r.querySelector('.k').textContent, on: r.querySelector('[data-ph=on]').getAttribute('aria-checked') } : null; });
    check(row?.k === 'performance stats' && row.on === 'true', `Setup › Screen has the row, on by default (${JSON.stringify(row)})`);
    await page.evaluate(() => document.querySelector('#tp-set-screen [data-ph=off]').click()); await page.waitForTimeout(800);
    v = await vis(page); check(!v.perf && v.up, `Setup off: hidden with the cockpit up (${JSON.stringify(v)})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ') || 'none'})`);
    await page.reload({ waitUntil: 'load' }); await ready(page); await page.waitForTimeout(2000);
    v = await vis(page);
    const row2 = await page.evaluate(() => document.querySelector('#tp-set-screen [data-ph=off]')?.getAttribute('aria-checked'));
    check(!v.perf && row2 === 'true', `after a reload: still off (${JSON.stringify(v)}, the row's off ${row2})`);
    await page.goto(`${BASE}/?${Q}&perfhud=1`, { waitUntil: 'load' }); await ready(page); await page.waitForTimeout(2000);
    v = await vis(page); check(v.perf, `?perfhud=1: shown whatever Setup holds (${JSON.stringify(v)})`);
    await page.goto(`${BASE}/?${Q}&perfhud=0`, { waitUntil: 'load' }); await ready(page); await page.waitForTimeout(1500);
    check(!(await vis(page)).perf, '?perfhud=0: never');
    await page.evaluate(() => document.querySelector('#tp-set-screen [data-ph=on]')?.click());
    await ctx.close();
  }
  // ---------------- 1920 x 1080: the layout ----------------
  {
    const { ctx, page, errors } = await open(Q, { viewport: { width: 1920, height: 1080 } });
    await ready(page); await page.waitForTimeout(2500);
    await layout(page, '1920x1080');
    check(errors.length === 0, `1920x1080: no page errors (${errors.slice(0, 2).join(' | ') || 'none'})`);
    await ctx.close();
  }
  // ---------------- off: an automated browser, a capture, a tablet ----------------
  {
    const { ctx, page } = await open(Q, { person: false });
    await ready(page); await page.waitForTimeout(1000);
    check(await page.evaluate(() => window.__velia.perfHud === null && !document.querySelector('.lk-perf') && !document.querySelector('[data-set="perfhud"]')), 'an automated browser (the page tests, the goldens\' live frames): no panel, no row');
    await page.goto(`${BASE}/?hour=15&cam=A&seed=1&headless=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
    check(await page.evaluate(() => (window.__velia.perfHud ?? null) === null && !document.querySelector('.lk-perf')), 'a capture (?headless=1): no panel');
    await ctx.close();
  }
  {
    const { ctx, page } = await open(`${Q}&perfhud=1&profile=form:tablet`);
    await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 }); await page.waitForTimeout(1500);
    check(await page.evaluate(() => window.__velia.perfHud === null && !document.querySelector('.lk-perf')), 'a tablet (even with ?perfhud=1): no panel');
    await ctx.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
