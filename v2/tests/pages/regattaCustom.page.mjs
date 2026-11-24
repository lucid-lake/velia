// Regatta's Custom race on a live v2 page (mocks 2 and 3):
//   1280 × 720   the hub's Custom race row opens the sheet over the hub: every dial with its value and its picker (the courses as cards),
//                (step C: the Race type row joins Fleet & aids) inside the frame, no two controls overlapping, targets ≥ 44 px, text ≥ 15 px, no scroll; a pick is stored and the
//                preview follows; Race › starts the Custom race in the box (the course, its shift pattern on the wind, the start); the
//                choice is remembered on the next visit (the hub shows "your custom race"); Deal for me returns to dealt hands
//   844 × 390    a sideways phone: the same sections in one scrolling column, each row opening its picker; the same checks; Race › by touch
//   390 × 844    an upright phone: the page turned, the same sheet in the 844 × 390 frame
// Run by `npm run test:pages:v2 -- regattaCustom`, or node v2/tests/pages/regattaCustom.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const PHONE = { deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, viewport, extra = {}, ctx = null) {
  const c = ctx ?? await browser.newContext({ viewport, ...extra });
  const page = await c.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  if (!ctx) await c.addInitScript((s) => { try { if (!localStorage.getItem('lakeshore.settings.v1')) localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 20, null, { timeout: 240000 });
  await page.waitForTimeout(1200);
  return { page, errors, ctx: c };
}
const st = (page) => page.evaluate(() => {
  const V = window.__velia, r = V.regatta.r, h = r?.hand;
  return { on: !!r?.on, hub: !!r?.hubOpen, hand: h ? { ...h } : null, clock: r?.on ? r.state().clock : null, flying: r?.session?.flying ?? null, pre: r?.session?.prestartS ?? null,
    startRow: document.querySelector('#rgh .cus .r[data-row=start] .vv')?.textContent ?? null, course: r?.course?.id ?? null, marks: r?.course?.markIds ?? null,
    pattern: V.boat.wind.pattern?.id ?? null, setup: r?.setup ? JSON.parse(JSON.stringify(r.setup)) : null, rivals: r?.session?.rivals?.length ?? null,
    sheet: !!document.querySelector('#rgh .cus:not([hidden])'), watch: !!document.querySelector('#rg .watch'), key: document.querySelector('#rgh .hand .k')?.textContent ?? '',
    name: document.querySelector('#rgh .hand .nm')?.innerText ?? '', pv: document.querySelector('#rgh .cus .pvh .k')?.textContent ?? '' };
});
// the sheet's layout: shown pieces inside the frame; no two controls overlapping; the rows clear of the preview; the smallest text;
// the smallest target; no scroll
const layout = (page) => page.evaluate(() => {
  const vis = (e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 ? r : null; };
  const W = innerWidth, H = innerHeight, S = document.querySelector('#rgh .cus');
  // a row scrolled out of the rows' column (a phone scrolls it) is not on screen: left out
  const RR = S.querySelector('.rows').getBoundingClientRect(), clipped = (e, r) => !!e.closest('.rows') && !e.closest('.r.open > .pk') && (r.bottom > RR.bottom + 0.5 || r.top < RR.top - 0.5);
  const ctl = [...S.querySelectorAll('button')].map((e) => [e, vis(e)]).filter(([e, r]) => r && !clipped(e, r));
  const out = ctl.filter(([, r]) => r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5).map(([e, r]) => `${e.className || e.textContent} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
  // overlaps: two controls in the same layer (a picker over the rows is its own layer: the open row's picker and the rest)
  const layer = (e) => (e.closest('.r.open > .pk') ? 'pick' : 'sheet');
  const over = [];
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const [a, ra] = ctl[i], [b, rb] = ctl[j]; if (layer(a) !== layer(b) || a.contains(b) || b.contains(a)) continue;
    const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (ox > 1 && oy > 1) over.push(`${a.textContent.trim().slice(0, 16)} × ${b.textContent.trim().slice(0, 16)}`);
  }
  const rows = vis(S.querySelector('.rows')), pv = vis(S.querySelector('.pv')), apart = !!rows && !!pv && rows.right <= pv.left + 0.5;
  let minPx = 99; for (const e of S.querySelectorAll('*')) { if (e instanceof SVGElement || !vis(e) || [...e.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue; minPx = Math.min(minPx, parseFloat(getComputedStyle(e).fontSize)); }
  const svgText = [...S.querySelectorAll('svg text')].filter((t) => vis(t)).map((t) => +t.getAttribute('font-size') * (t.ownerSVGElement.getBoundingClientRect().width / t.ownerSVGElement.viewBox.baseVal.width));
  const targets = ctl.filter(([e]) => layer(e) === (S.querySelector('.r.open') ? 'pick' : 'sheet')).map(([, r]) => Math.min(r.height, r.width));
  const sheet = S.getBoundingClientRect();
  // contrast: each shown text's ink over the sheet's navy (the ink's alpha composited on it), WCAG ratio; values (.vv, dd, h2) ≥ 7
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const rgba = (str) => { const m = str.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; };
  const bg = rgba(getComputedStyle(S).backgroundColor);
  let minText = 99, minValue = 99;
  for (const e of S.querySelectorAll('*')) {
    if (!vis(e) || [...e.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim()) || e.closest('.go')) continue;
    const c = rgba(getComputedStyle(e).color), a = c[3], ink = [0, 1, 2].map((i) => c[i] * a + bg[i] * (1 - a));
    const L1 = lum(ink), L2 = lum(bg), r = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    minText = Math.min(minText, r); if (e.matches('.vv, dd, h2, .cn, .opts button')) minValue = Math.min(minValue, r);
  }
  return { minText, minValue, bgAlpha: bg[3], W, H, out, over, apart, minPx: Math.min(minPx, ...svgText), minTarget: Math.min(...targets), n: ctl.length, scroll: document.documentElement.scrollHeight > H + 1 || S.scrollHeight > S.clientHeight + 1, sheetIn: sheet.bottom <= H + 0.5 && sheet.right <= W + 0.5 };
});
const pickOn = (page, dial) => page.evaluate((d) => [...document.querySelectorAll(`#rgh .cus [data-dial=${d}] [aria-checked=true]`)].map((b) => b.dataset.v), dial);

try {
  // ---------------- 1280 × 720 ----------------
  {
    const { page, errors, ctx } = await open('mode=regatta&once=0&seed=1&handseed=7', { width: 1280, height: 720 });
    await page.click('#rgh .cusr'); await page.waitForTimeout(600);
    const a = await st(page);
    const dials = await page.evaluate(() => [...document.querySelectorAll('#rgh .cus [data-dial]')].map((e) => e.dataset.dial));
    check(a.sheet && a.hub && ['course', 'length', 'laps', 'wind', 'shifts', 'sky', 'time', 'rivals', 'skill', 'aids', 'start', 'pace'].every((d) => dials.includes(d)), `the Custom sheet: every dial (${dials.join(', ')})`);
    const cards = await page.evaluate(() => [...document.querySelectorAll('#rgh .cus .card')].map((c) => ({ v: c.dataset.v, svg: !!c.querySelector('.art svg, .art img.ci'), on: c.getAttribute('aria-checked') })));
    const sr = await page.evaluate(() => { const r = document.querySelector('#rgh .cus .r[data-row=start]'); return { v: r?.querySelector('.vv')?.textContent, opts: [...(r?.querySelectorAll('[data-dial=start] [data-v]') ?? [])].map((b) => b.textContent) }; });
    check(sr.v === 'Flying start' && sr.opts.join('|') === 'Flying start|Line −0:45|Line −1:30|Line −3:00', `the Start row: Flying start by default, then the classic times (${JSON.stringify(sr)})`);
    check(cards.length === 4 && cards.every((c) => c.svg) && cards.filter((c) => c.on === 'true').length === 1, `the courses as cards with their baked chart (${cards.map((c) => c.v).join(', ')})`);
    for (const d of ['length', 'laps', 'wind', 'shifts', 'sky', 'time', 'rivals', 'skill', 'aids', 'start', 'pace']) { const on = await pickOn(page, d); if (on.length !== 1) check(false, `${d}: one value chosen (${on})`); }
    const L = await layout(page);
    check(!L.out.length && !L.over.length && L.apart && L.sheetIn && !L.scroll && L.minPx >= 16 && L.minTarget >= 43.5, `1280 × 720: ${L.n} controls inside the frame, none overlapping, rows clear of the preview, text ≥ 16 px (${L.minPx.toFixed(1)}), targets ≥ 44 px (${L.minTarget.toFixed(0)}), no scroll (${[...L.out, ...L.over].join('; ') || 'ok'})`);
    check(L.bgAlpha >= 0.95 && L.minText >= 4.5 && L.minValue >= 7, `readable: a solid sheet (navy at ${L.bgAlpha}), text contrast ≥ 4.5:1 (${L.minText.toFixed(1)}), values ≥ 7:1 (${L.minValue.toFixed(1)})`);
    const secs = await page.evaluate(() => [...document.querySelectorAll('#rgh .cus .sec')].map((e) => `${e.querySelector('h3').textContent}:${e.querySelectorAll('.r').length}`));
    const inline = await page.evaluate(() => [...document.querySelectorAll('#rgh .cus .opts button, #rgh .cus .card')].filter((b) => b.getBoundingClientRect().height > 0).length);
    check(secs.length === 3 && /Course:3/.test(secs[0]) && /Conditions:4/.test(secs[1]) && /Fleet & aids:6/.test(secs[2]) && inline === 0, `three sections, one row per dial, no option shown until a row is opened (${secs.join(' | ')}; ${inline} shown)`);
    const scrim = await page.evaluate(() => !!document.querySelector('#rgh .cscr:not([hidden])'));
    check(scrim, 'a dim scrim over the live lake behind the sheet');
    await page.click('#rgh .cus .r[data-row=wind] .val'); await page.waitForTimeout(200);
    const P = await layout(page);
    check(!P.out.length && !P.over.length && P.minPx >= 16 && P.minTarget >= 43.5, `1280 × 720: the wind picker over the rows fits (${[...P.out, ...P.over].join('; ') || 'ok'})`);
    await page.click('#rgh .cus .r.open .pick-x'); await page.waitForTimeout(150);
    // picks: Bay Tour, Oscillating, Club length; the preview and the store follow
    const pick = async (row, sel) => { await page.click(`#rgh .cus .r[data-row=${row}] .val`); await page.waitForTimeout(120); await page.click(sel); await page.click('#rgh .cus .r.open .pick-x'); await page.waitForTimeout(120); };
    await pick('course', '#rgh .cus .card[data-v=bay-tour]'); await pick('shifts', '#rgh .cus [data-dial=shifts] [data-v=oscillating]');
    await pick('length', '#rgh .cus [data-dial=length] [data-v=club]'); await pick('rivals', '#rgh .cus [data-dial=rivals] [data-v="3"]');
    const big = await page.evaluate(() => document.querySelector('#rgh .cus .r[data-row=course] .val').innerText.replace(/\s+/g, ' '));
    check(/Bay Tour 5 legs · about \d+ min/.test(big), `the course as one large card with its facts (${big})`);
    const b = await st(page);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.regatta.setup.v1') ?? 'null')?.custom);
    check(b.setup.custom.course === 'bay-tour' && b.setup.custom.shifts === 'oscillating' && b.setup.custom.length === 'club' && b.setup.custom.rivals === 3 && stored?.course === 'bay-tour' && /Bay Tour/.test(b.pv) && b.hub && !b.setup.useCustom,
      `a pick is stored and the preview follows; the race waits for Race › (${b.pv}, ${JSON.stringify(stored)})`);
    // Race ›
    await page.click('#rgh .cus .race');
    await page.waitForTimeout(1500);
    const c = await st(page);
    check(!c.hub && !c.sheet && c.watch && c.course === 'bay-tour' && c.hand?.custom && c.hand.shifts === 'oscillating' && c.pattern === 'oscillating' && c.rivals === 3 && c.flying && c.hand.prestartS === 0 && c.clock > -c.pre + 0.5 && c.clock < -1,
      `Race ›: the Custom race's flying start (${c.course}, marks ${c.marks?.join('')}, ${c.pattern} on the wind, ${c.rivals} rivals, clock ${c.clock?.toFixed(1)} of −${c.pre})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
    // the next visit: remembered
    const n = await open('mode=regatta&once=0&seed=1&handseed=7', null, {}, ctx);
    const d = await st(n.page);
    check(d.hub && !d.hand?.custom && !!d.hand?.place && d.setup.custom.course === 'bay-tour', `the next visit: the hub opens on a place race and the Custom picks are remembered for its row (${d.hand?.place})`);
    await n.page.click('#rgh .cusr'); await n.page.waitForTimeout(400);
    await n.page.click('#rgh .cus .dfm'); await n.page.waitForTimeout(800);
    const e = await st(n.page);
    check(e.hub && !e.sheet && !e.hand?.custom && !e.setup.useCustom && e.setup.custom.course === 'bay-tour' && !!e.hand?.place, `Deal for me: back to a selected race, the Custom picks kept (${e.hand?.place})`);
    check(!n.errors.length, `no page errors (${n.errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---------------- phones: sideways and upright (turned) ----------------
  for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    const tag = `${vp.width} × ${vp.height}`;
    const { page, errors, ctx } = await open('mode=regatta&once=0&seed=1&handseed=7&touch=1', vp, PHONE);
    await page.tap('#rgh .cusr'); await page.waitForTimeout(500);
    const L = await layout(page);
    check(L.W === 844 && L.H === 390 && !L.out.length && !L.over.length && L.apart && L.sheetIn && !L.scroll && L.minPx >= 15 && L.minTarget >= 43.5, `${tag}: the sheet in one ${L.W} × ${L.H} screen, none overlapping, text ≥ 15 px (${L.minPx.toFixed(1)}), targets ≥ 44 px (${L.minTarget.toFixed(0)}) (${[...L.out, ...L.over].join('; ') || 'ok'})`);
    const vals = await page.evaluate(() => [...document.querySelectorAll('#rgh .cus .r > .val')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.innerText.replace(/\s+/g, ' ')));
    check(vals.length === 13 && vals.every((v) => v.trim().split(' ').length >= 2), `${tag}: each row shows its value (${vals.join(' | ')})`);
    // the course picker: cards over the rows; a pick; Done
    await page.tap('#rgh .cus .r[data-row=course] .val'); await page.waitForTimeout(300);
    const P = await layout(page);
    check(!P.out.length && !P.over.length && P.minPx >= 15 && P.minTarget >= 43.5, `${tag}: the course picker fits, nothing overlapping, targets ≥ 44 px (${P.minTarget.toFixed(0)}) (${[...P.out, ...P.over].join('; ') || 'ok'})`);
    await page.tap('#rgh .cus .card[data-v=twice-round]'); await page.waitForTimeout(200);
    await page.tap('#rgh .cus .r.open .pick-x'); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector('#rgh .cus .r[data-row=shifts]').scrollIntoView({ block: 'center' }));
    await page.tap('#rgh .cus .r[data-row=shifts] .val'); await page.waitForTimeout(200);
    const W = await layout(page);
    check(!W.out.length && !W.over.length && W.minTarget >= 43.5, `${tag}: the wind picker fits (${[...W.out, ...W.over].join('; ') || 'ok'})`);
    await page.tap('#rgh .cus [data-dial=shifts] [data-v=right]'); await page.tap('#rgh .cus .r.open .pick-x'); await page.waitForTimeout(200);
    const a = await st(page);
    check(a.setup.custom.course === 'twice-round' && a.setup.custom.laps === 2 && a.setup.custom.shifts === 'right', `${tag}: picks by touch (Twice Round, its 2 laps, persistent right)`);
    await page.tap('#rgh .cus .race'); await page.waitForTimeout(1500);
    const b = await st(page);
    check(!b.hub && b.watch && b.course === 'twice-round' && b.marks?.join('') === 'WIWI' && b.pattern === 'right', `${tag}: Race › by touch (${b.course} ${b.marks?.join('')}, ${b.pattern})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
