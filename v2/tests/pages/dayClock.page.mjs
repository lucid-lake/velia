// The day clock and the key legend on a live v2 page (v2/engine/clock.js, v2/ui/dayClock.js, v2/ui/sail.js; v1's
// src/ui/timeMenu.js and src/ui/keyLegend.js as they are):
//   the clock    a page with no ?hour starts at v1 Sail's 18:45 and runs (v1's day clock); the top bar's clock reads it; a click
//                opens the time menu, a pick (Night) cuts the clock forward, the sun and the theme follow; the night runs at the
//                day's rate with v1's night-sky line, never "The night passes…"; ?hour sets the start and it runs (v1), ?timerate=0
//                keeps it still
//   the legend   v1's edge pair on the right: on with the cockpit up (?keylegend=1 stands in for the desktop facts), W S ·
//                Space · C, then B · I · J (the lean set); three uses dim a line; off in the helm view and under Setup's key hints off
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/dayClock.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, settings = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, { ...SEEN, ...settings });
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station?.cockpit && window.__velia.m4.ui.viewSwitch && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  return { page, errors };
}
const frames = (page, n = 3) => page.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const clockNow = (page) => page.evaluate(() => { const V = window.__velia, s = V.stats(); return { hour: s.hour, ...s.clock, sun: s.sunElevationDeg, bar: document.querySelector('.lk-view:not(.off) .xt[data-x=cond] .ct')?.textContent ?? '', theme: document.documentElement.dataset.lkTheme ?? null }; });
const legend = (page) => page.evaluate(() => { const el = document.querySelector('.lk-keys:not(.tp-keys)'); if (!el) return null;
  const rows = [...el.querySelectorAll('.kl')].filter((r) => !r.classList.contains('off') && !r.classList.contains('fade'));
  return { on: el.classList.contains('on'), op: +getComputedStyle(el).opacity, rows: rows.map((r) => ({ caps: r.dataset.caps, word: r.querySelector('.w').textContent, learned: r.classList.contains('learned') })) }; });

try {
  // ---------------- the running clock, the bar, the menu ----------------
  {
    const { page, errors } = await open('mode=sail&once=0&noload=1&fv=1&hm=0&chatter=0&hud=full&keylegend=1');
    let c = await clockNow(page);
    check(c.mode === 'day' && c.running && Math.abs(c.hour - 18.75) < 0.05, `no ?hour: v1 Sail's day clock from 18:45 (${JSON.stringify(c)})`);
    check(/18:4\d|18:5\d/.test(c.bar), `the top bar's clock reads it ("${c.bar}")`);
    const h0 = c.hourUnwrapped;
    await page.waitForTimeout(4000);
    c = await clockNow(page);
    const dh = (c.hourUnwrapped - h0) * 3600;
    check(dh > 25 && dh < 120, `the hour runs: ${dh.toFixed(0)} game s in 4 real s (golden hour at about 0.6–0.8 x of 20 game s per real s)`);
    // the bar's Conditions pill opens the sheet; its Time of day holds the four cuts and the strip's fireworks marker; Night cuts forward to 22:30
    await page.mouse.move(600, 400); await page.mouse.move(620, 410);
    await page.click('.lk-view:not(.off) .xt[data-x=cond]'); await frames(page);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lk-cond:not([hidden]) [data-t]')].map((b) => b.textContent.trim()));
    check(rows.join('|') === 'Fireworks 21:44|Dawn|Midday|Golden|Night', `the time row: the strip's fireworks marker, then the four cuts (${rows.join(' | ')})`);
    await page.evaluate(() => document.querySelector('.lk-cond [data-t=night]').click());
    await frames(page, 30);
    c = await clockNow(page);
    check(c.cuts === 1 && c.hour >= 22.5 && c.hour < 22.6 && c.hourUnwrapped > h0, `Night: a forward cut to 22:30 (${c.hour.toFixed(3)}, cuts ${c.cuts})`);
    check(c.sun < -12, `the sun follows (${c.sun}°)`);
    check(/22:3\d/.test(c.bar), `the bar's clock follows ("${c.bar}")`);
    check(c.theme === 'night', `the theme switches to night: the instruments' flag (data-lk-theme=${c.theme})`);
    check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lk-brand-navy').trim()) === '28 35 64', 'the DOM stays navy and cream at night: the day tokens (owner, 2026-11-19; nightPages.page.mjs reads the sheets)');
    check(Math.abs(c.rate - 10) < 0.5, `Sail's night at the day's rate: ${c.rate.toFixed(2)} game s per sim s (the day's 10; no quick night, owner 2026-11-15)`);
    const seen = new Set();
    for (let i = 0; i < 40; i++) { seen.add((await page.evaluate(() => window.__velia.m4.ui.hint.el.textContent)).trim()); await page.waitForTimeout(250); }
    const lines = [...seen].filter(Boolean);
    check(!lines.some((t) => /night passes/i.test(t)), `no "The night passes…" in Sail (${JSON.stringify(lines)})`);
    check(!lines.some((t) => /stars come out/i.test(t)), `no night-sky line on the row: the lean skipper's chatter (owner 2026-11-17; ${JSON.stringify(lines)})`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- ?hour sets the start and the clock runs from it (v1; #36, owner 2026-11-14); ?timerate=0 keeps it still ----------------
  {
    const { page, errors } = await open('mode=sail&hour=13&once=0&noload=1&fv=1&hm=0&chatter=0');
    const read = () => page.evaluate(() => { const c = window.__velia.clock; return { hour: c.hour, hu: c.hourUnwrapped, mode: c.mode, running: c.running, rate: c.rate, cuts: c.cuts }; });
    const a = await read(); await page.waitForTimeout(4000); const b = await read();
    const dh = (b.hu - a.hu) * 3600;
    check(a.mode === 'day' && a.running && a.cuts === 0 && a.hour >= 13 && a.hour < 13.1, `?hour=13: v1's day clock from 13:00 (${a.hour.toFixed(4)}, ${a.mode}, rate ${a.rate})`);
    check(dh > 50 && dh < 120, `__velia.clock runs: ${dh.toFixed(0)} game s in 4 real s (v1: 20 game s per real s by day at 2 x)`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  {
    const { page, errors } = await open('mode=sail&hour=15&timerate=0&once=0&noload=1&fv=1&hm=0&chatter=0');
    const a = await clockNow(page); await page.waitForTimeout(2500); const b = await clockNow(page);
    check(a.mode === 'frozen' && !a.running && a.hour === 15 && b.hour === 15, `?hour=15&timerate=0: the time stands (${a.hour} → ${b.hour}, ${a.mode})`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- the key legend ----------------
  {
    const { page, errors } = await open('mode=sail&hour=15&once=0&noload=1&fv=1&hm=0&chatter=0&hud=full&keylegend=1');
    await frames(page, 30); await page.waitForTimeout(500);
    let L = await legend(page);
    check(!!L && L.on && L.op > 0.9, `the legend is on with the cockpit up (${JSON.stringify(L && { on: L.on, op: L.op })})`);
    check(L && L.rows.length === 6 && L.rows.slice(0, 3).map((r) => r.caps).join(' ') === 'WS Space C' && L.rows.slice(3).every((r) => ['B', 'I', 'J'].includes(r.caps)), `the lean set: W S, Space, C, then B, I, J: ${L?.rows.map((r) => `${r.caps} ${r.word}`).join(' · ')}`);
    for (let i = 0; i < 2; i++) { await page.keyboard.press('KeyC'); await page.waitForTimeout(1300); await page.keyboard.press('KeyC'); await page.waitForTimeout(1300); }   // helm and back, twice: 4 uses
    await page.waitForTimeout(500);
    L = await legend(page);
    check(L.rows.find((r) => r.caps === 'C')?.learned === true && L.rows.find((r) => r.caps === 'WS')?.learned === false, 'three uses of C dim its line, W S stays full');
    await page.evaluate(() => window.__velia.m4.ui.views.set('helm')); await page.waitForTimeout(1500);
    L = await legend(page);
    check(L.on === false, 'off in the helm view');
    await page.evaluate(() => window.__velia.m4.ui.views.set('follow')); await page.waitForTimeout(1500);
    check((await legend(page)).on === true, 'back with the cockpit');
    await page.close();
    // Setup's key hints off: no legend (v1's Settings > Screen > key hints)
    const off = await open('mode=sail&hour=15&once=0&noload=1&fv=1&hm=0&chatter=0&hud=full', { keyHints: false });
    await frames(off.page, 30); await off.page.waitForTimeout(500);
    check((await legend(off.page))?.on === false, 'Setup\'s key hints off: no legend');
    await off.page.close();
    check(errors.length === 0 && off.errors.length === 0, `no page errors (${[...errors, ...off.errors].join(' | ')})`);
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
