// The loading line keeps moving while the main thread is stuck (feat/v2-loading-bar-compositor; owner 2026-11-18: "a loading bar
// that keeps moving even while the phone is busy building shaders"). The page's main thread is held in a busy loop for 2 s (as a
// phone's pipeline compile holds it), and the line is read off the browser's screencast, which takes the composited frames while
// the main thread is busy (barMotion.mjs). Two lines:
//   the boot screen's voyage bar (ui/loadBar.js), on a desktop 1280 × 720 and a phone 844 × 390: blocked from its first creep,
//     the sailed length keeps rising through the block (a change in every 400 ms window), never goes back
//   the phone's build card line (ui/buildCard.js + ui/lineGlide.js), 844 × 390 with an iPhone's UA and a slow compiler
//     (?pipedelay=280): blocked right after a step, the fill keeps rising through the block (sub-pixel: each column's colour share
//     between the track and the fill), never back, never past the next step; the line's animation is transform-only
//   the control: the same block with the glide cancelled (the plain --p line) reads as still, so the reading can fail
// Run by `npm run test:pages:v2 -- loadingCompositor`, or node v2/tests/pages/loadingCompositor.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { PERSON, RETURNING, CLEAN, startScreencast, sailedPx, LINE_RECT } from './barMotion.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const BLOCK_MS = 2000, WINDOW_MS = 400;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const DESKTOP = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA };

// hold the main thread: two frames first, so the newest animation is on the compositor (an animation not started before the
// thread gets busy stays stuck: Abyssal Garden's say()), then a busy loop; returns the block's [start, end] (performance.now)
const block = (page, ms = BLOCK_MS) => page.evaluate(async (ms) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const g = window.__velia?.stats?.()?.pipelines?.gate ?? null;   // the build gate's numbers as the block starts (nothing changes in it)
  const a = performance.now(); let x = 0;
  while (performance.now() - a < ms) x += Math.sqrt(x + 1);
  return [a, performance.now(), g && { built: g.built, total: g.total, ready: g.ready, assets: Object.values(g.assets ?? {}).filter(Boolean).length }];
}, ms);

// the readings inside the block: a change in every window, never back (tol), the total rise
function judge(name, samples, [a, b], { tol, minRise, minStep = 1e-3 }) {
  const inb = samples.filter((s) => s.t >= a && s.t <= b);
  check(inb.length >= 10, `${name}: the screencast kept taking frames through the ${Math.round(b - a)} ms block (${inb.length} frames)`);
  if (inb.length < 2) return;
  // against every frame at least 100 ms older (the screencast's timestamps jitter by a frame: two neighbours can swap)
  let back = 0; for (let i = 1; i < inb.length; i++) for (let h = 0; h < i; h++) if (inb[h].t <= inb[i].t - 100) back = Math.max(back, inb[h].v - inb[i].v);
  check(back <= tol, `${name}: never back during the block (largest step back vs 100 ms before ${back.toFixed(3)}, ${tol} allowed)`);
  const rise = inb.at(-1).v - inb[0].v;
  check(rise >= minRise, `${name}: it rose through the block (${inb[0].v.toFixed(2)} → ${inb.at(-1).v.toFixed(2)}, ${rise.toFixed(2)} ≥ ${minRise})`);
  const wins = [];
  for (let t = a; t + WINDOW_MS <= b + 1; t += WINDOW_MS) {
    const w = inb.filter((s) => s.t >= t && s.t <= t + WINDOW_MS);
    wins.push(w.length >= 2 ? w.at(-1).v - w[0].v : NaN);
  }
  check(wins.every((d) => d > minStep), `${name}: it moved in every ${WINDOW_MS} ms of the block (${wins.map((d) => d.toFixed(3)).join(', ')})`);
  return { rise, wins };
}

// the boot screen's voyage bar: blocked from its first creep
async function boot(label, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(RETURNING); await page.addInitScript(CLEAN);
  const cdp = await ctx.newCDPSession(page);
  const W = opts.viewport.width * (opts.deviceScaleFactor ?? 1), H = opts.viewport.height * (opts.deviceScaleFactor ?? 1);
  const cast = await startScreencast(cdp, { width: W, height: H });
  await page.goto(`${BASE}/?hour=13&seed=1&attract=0`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__veliaLoading?.bar?.log?.length > 0 && document.getElementById('lk-load')?.dataset.state === 'company', null, { timeout: 60000, polling: 20 });
  const line = await page.evaluate(LINE_RECT);
  const anims = await page.evaluate(() => [document.querySelector('#lk-load .lk-sailed'), document.querySelector('#lk-load .lk-psloop')].map((el) => el.getAnimations().filter((a) => a.playState === 'running').map((a) => Object.keys(a.effect.getKeyframes()[0]).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))));
  const span = await block(page);
  await cast.stop();
  const origin = await page.evaluate(() => performance.timeOrigin);
  const samples = cast.frames.map((f) => ({ t: f.wall * 1000 - origin, ...sailedPx(f.data, line, opts.viewport.width) })).filter((s) => s.line).map((s) => ({ t: s.t, v: s.px }));
  check(anims.every((list) => list.length > 0 && list.every((keys) => keys.length === 1 && keys[0] === 'transform')), `${label}: the line and the sloop move by transform-only animations (${JSON.stringify(anims)})`);
  judge(`${label} boot bar`, samples, span, { tol: 1.01, minRise: 8, minStep: 0.4 });
  check(!errors.length, `${label}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
  await ctx.close();
}

// the fill's length on one frame (screen px, sub-pixel): the card sits turned a little (-0.6°), so each column of the line's box
// takes its most fill-like pixel, scored as its colour's share between the track's colour and the fill's (sampled before the
// block: the brightest pixel of the box's first and last columns)
function fillLen(png, r, cssW, ref) {
  const img = PNG.sync.read(Buffer.from(png, 'base64'));
  const k = img.width / cssW;
  const x0 = Math.round(r.x * k) + 1, x1 = Math.round((r.x + r.w) * k) - 2, y0 = Math.floor(r.y * k) - 1, y1 = Math.ceil((r.y + r.h) * k) + 1;
  const px = (x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const brightest = (x) => { let b = null; for (let y = y0; y <= y1; y++) { const c = px(x, y); if (!b || lum(c) > lum(b)) b = c; } return b; };
  if (!ref) return { fill: brightest(x0), track: brightest(x1) };
  const d = ref.fill.map((c, i) => c - ref.track[i]), dd = d.reduce((s, c) => s + c * c, 0) || 1;
  let sum = 0;
  for (let x = x0; x <= x1; x++) {
    let best = 0;
    for (let y = y0; y <= y1; y++) { const c = px(x, y); const t = c.reduce((s, ci, i) => s + (ci - ref.track[i]) * d[i], 0) / dd; best = Math.max(best, Math.min(1, t)); }
    sum += best;
  }
  return sum / k;
}

async function buildCard() {
  const label = 'phone 844x390 build card';
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/?hour=13&seed=1&attract=0&pipedelay=280`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && document.querySelector('#lk-load .lk-bld-ln') && document.getElementById('lk-load').dataset.build === 'wait' && !document.documentElement.dataset.lkHold, null, { timeout: 240000 });
  await page.waitForTimeout(1500);   // the card in; a few steps so the glide has a pace
  const r = await page.evaluate(() => { const b = document.querySelector('#lk-load .lk-bld-ln').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, rot: document.documentElement.classList.contains('lk-rot') }; });
  check(!r.rot && r.w > 100, `${label}: the line is on screen, unturned (${r.w.toFixed(0)} px long)`);
  const keys = await page.evaluate(() => document.querySelector('#lk-load .lk-bld-ln > i').getAnimations().filter((a) => a.playState !== 'idle').map((a) => Object.keys(a.effect.getKeyframes()[0]).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))));
  check(keys.length === 1 && keys[0].length === 1 && keys[0][0] === 'transform', `${label}: the fill moves by one transform-only animation (${JSON.stringify(keys)})`);
  const cdp = await ctx.newCDPSession(page);
  const run = async (control) => {
    // the control: the glide's animate() made a no-op and its animation cancelled, so the fill is the plain --p line (its CSS
    // transition, the line before this branch)
    if (control) await page.evaluate(() => { const i = document.querySelector('#lk-load .lk-bld-ln > i'); for (const a of i.getAnimations()) a.cancel(); i.animate = () => ({ cancel() {} }); });
    // a ticker: the screencast sends a frame only when the screen changes, so a still card sends none and the control reads nothing
    // (NaN). Until 2026-11-19 the mini chart's bobbing sloop kept frames coming; the phone card now shows the live map's empty frame
    // while it builds ('s card). A 4 px dot in the top-left corner, far from the line, moves by a
    // compositor transform through the block, in both runs.
    await page.evaluate(() => { if (document.getElementById('t-tick')) return; const d = document.createElement('div'); d.id = 't-tick';
      d.style.cssText = 'position:fixed;left:2px;top:2px;width:4px;height:4px;background:#888;z-index:99999;pointer-events:none';
      document.body.appendChild(d); d.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(8px)' }], { duration: 300, iterations: Infinity, direction: 'alternate' }); });
    const cast = await startScreencast(cdp, { width: PHONE.viewport.width * 2, height: PHONE.viewport.height * 2 });
    await page.waitForTimeout(300);
    const span = await block(page), st = span[2];
    await page.waitForTimeout(200);
    await cast.stop();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const pre = cast.frames.filter((f) => f.wall * 1000 - origin < span[0]).at(-1) ?? cast.frames[0];
    const ref = fillLen(pre.data, r, PHONE.viewport.width);
    const samples = cast.frames.map((f) => ({ t: f.wall * 1000 - origin, v: fillLen(f.data, r, PHONE.viewport.width, ref) }));
    return { span, samples, st, ref };
  };
  const live = await run(false);
  check(live.st && !live.st.ready, `${label}: still building when blocked (${live.st?.built}/${live.st?.total})`);
  const lenPx = r.w, stepPx = live.st ? lenPx / (live.st.total + 3) : 0;
  const j = judge(`${label} line`, live.samples, live.span, { tol: 0.05, minRise: 0.3, minStep: 0.02 });
  const inb = live.samples.filter((s) => s.t >= live.span[0] && s.t <= live.span[1]);
  const nextPx = live.st ? (lenPx * (live.st.built + live.st.assets + 1)) / (live.st.total + 3) : 0;   // the next step's end of the fill
  check(inb.length > 1 && Math.max(...inb.map((x) => x.v)) <= nextPx + 1, `${label}: never past the next step in the block (at most ${Math.max(...inb.map((x) => x.v)).toFixed(2)} px; the next step ends at ${nextPx.toFixed(2)} px; rose ${j ? j.rise.toFixed(2) : '?'} px, one step is ${stepPx.toFixed(2)})`);
  const still = await run(true);
  const sIn = still.samples.filter((s) => s.t >= still.span[0] + 700 && s.t <= still.span[1]);   // after the CSS transition's 0.6 s
  const sRise = sIn.length > 1 ? Math.max(...sIn.map((s) => s.v)) - Math.min(...sIn.map((s) => s.v)) : NaN;
  check(sIn.length >= 10 && sRise < 0.05, `${label}: the control (glide cancelled, the plain --p line) reads as still from 0.7 s into the block (${sRise.toFixed(3)} px), so the reading can fail`);
  check(!errors.length, `${label}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  await boot('desktop 1280x720', DESKTOP);
  await boot('phone 844x390', PHONE);
  await buildCard();
} finally { await browser.close(); }
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed');
process.exit(fails ? 1 : 0);
