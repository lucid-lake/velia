// The cinematic intro (v2/ui/cinematicIntro.js; owner 2026-11-18, desktop only) on the real v2 page:
//   the first Sail entry from the home card (?cinema=1: the page tests run in an automated browser, where it is off by default):
//   at 1 s of the intro the 2.39:1 bars are on screen, the top bar, the hint row and the edge pair hidden, the cockpit sunk, the
//   lens look on, and the whole boat (the truck, the bow, the stern, the beam and the wake's first 3 m) inside the band; 7 s
//   after the tap the bars are gone, the top bar shown, the cockpit up, the lens off; a mode switch to Cruise and back to Sail
//   never plays it again
//   a key skips it: the end state 0.4 s later
//   reduced motion: no bars, no lens; the HUD fades in at once
//   the first Cruise entry plays it (the boat in the band from Cruise's own camera)
//   off: an automated browser with no ?cinema, ?cinema=0, ?headless=1, and a phone-sized touch page (?cinema=1 too)
// Run by `npm run test:pages:v2 -- cinematicIntro` (LAKESHORE_BASE set), or node v2/tests/pages/cinematicIntro.page.mjs --base http://127.0.0.1:<port>
// INTRO_SHOTS=<dir> also writes the t = 1 s and end stills.
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const SHOTS = process.env.INTRO_SHOTS ?? null;
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const SEEN = () => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, profile: 'sail', crewTrim: true, pilot: true, shoalAssist: true, autoReef: true, hints: true, words: 'both', proMode: false, introShown: true, goalDone: false, proOffered: true, cruiseOffered: true })); localStorage.setItem('lakeshore.calm.v1', '{"told":true}'); sessionStorage.setItem('seeded', '1'); } } catch {} };
const Q = 'hour=15&seed=1&attract=0';

const look = (page) => page.evaluate(() => {
  const V = window.__velia, vis = (el) => { if (!el) return null; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.5; };
  const bars = [...document.querySelectorAll('.lk-ibar')].map((b) => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, shown: getComputedStyle(b).display !== 'none' }; });
  const ck = V.m4?.ui?.station?.cockpit ?? null;
  return { st: V.intro.state, lens: V.intro.lens, probe: V.introProbe(), bars, bar: vis(document.querySelector('.lk-view')), hint: vis(document.querySelector('.lk-hint')), edge: vis(document.querySelector('.lk-edgepair')),
    sink: ck ? ck.sink : null, w: innerWidth, h: innerHeight, mode: V.mode?.current ?? null };
});
const until = async (page, fn, arg, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return true; if (Date.now() - t0 > ms) return false; await page.waitForTimeout(50); } };
const open = async (browser, url, { person = true, reduced = false, view = { width: 1280, height: 720 }, touch = false } = {}) => {
  const ctx = await browser.newContext({ viewport: view, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  if (person) await page.addInitScript(PERSON);
  await page.addInitScript(SEEN);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front && window.__velia.intro, null, { timeout: 240000 });
  await page.waitForTimeout(800);
  return { page, ctx, errors };
};
const enter = async (page, mode) => { await pickMode(page, mode); return Date.now(); };
const inBand = (p) => p && p.y.every((y) => y <= p.band + 1e-3);

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  // ---- the first Sail entry ----
  {
    const { page, ctx, errors } = await open(browser, `${BASE}/?mode=sail&${Q}&cinema=1`);
    const before = await look(page);
    check(before.st.phase === 'idle' && before.bars.length === 0, `on the card: waiting (${before.st.phase})`);
    const t0 = await enter(page, 'sail');
    check(await until(page, () => window.__velia.intro.state.t >= 1), 'the intro runs');
    const a = await look(page);
    const want = Math.max(0, Math.min(0.22 * a.h, (a.h - a.w / 2.39) / 2));
    check(a.st.phase === 'playing' && a.st.mode === 'sail', `playing in Sail at ${a.st.t} s`);
    check(a.bars.length === 2 && a.bars.every((b) => b.shown && Math.abs(b.h - want) < 2) && Math.abs(a.bars[0].top) < 1 && Math.abs(a.bars[1].bottom - a.h) < 1, `the bars in place, 2.39:1 (${a.bars.map((b) => `${b.top.toFixed(0)}–${b.bottom.toFixed(0)}`).join(', ')}; want ${want.toFixed(0)} px each)`);
    check(a.bar === false && a.hint !== true && a.edge !== true, `the HUD held: top bar ${a.bar}, hint ${a.hint}, edge pair ${a.edge}`);
    check(a.sink == null || a.sink > 0.95, `the cockpit folded down (sink ${a.sink?.toFixed(2)})`);
    check(a.lens.amount > 0.99 && a.lens.fx > 0.99, `the lens look on (${a.lens.amount})`);
    check(inBand(a.probe), `the whole boat inside the band: |ndc y| ${a.probe.y.join(', ')} ≤ ${a.probe.band.toFixed(3)} (fov ${a.probe.fov.toFixed(1)}°)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/intro-sail-1s.png` });
    await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - t0)));
    const b = await look(page);
    check(b.st.phase === 'done' && b.bars.length === 0, `7 s after the tap: done, the bars gone (${b.st.phase}, t ${b.st.t})`);
    check(b.bar === true, 'the top bar shown');
    check(b.sink == null || b.sink < 0.05, `the cockpit up (sink ${b.sink?.toFixed(2)})`);
    check(b.lens.amount === 0, 'the lens look off');
    check(b.probe.fov < a.probe.fov + 1e-6, `the lens back to the view's own (${a.probe.fov.toFixed(1)}° → ${b.probe.fov.toFixed(1)}°)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/intro-sail-end.png` });
    // a mode switch never plays it again
    await page.evaluate(() => window.__velia.mode.go('cruise'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__velia.mode.go('sail'));
    await page.waitForTimeout(1000);
    const c = await look(page);
    check(c.st.phase === 'done' && c.bars.length === 0 && c.lens.amount === 0, `Cruise and back to Sail: no second intro (${c.st.phase}, ${c.mode})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // ---- the 2D dial modules, the key legend and the Pro column stay off for the whole intro, and come back in Sail ----
  {
    const { page, ctx } = await open(browser, `${BASE}/?mode=sail&${Q}&cinema=1`);
    const drawn = () => page.evaluate(() => {
      const sel = { wind: '.lk-cv', chart: '.lk-chart .small', keys: '.lk-keys:not(.tp-keys)', pro: '.lk-pro' };
      const out = { on: document.documentElement.classList.contains('lk-intro-on'), phase: window.__velia.intro.state.phase, t: window.__velia.intro.state.t, hud: JSON.stringify(window.__velia.intro.state.hud) };
      for (const [k, q] of Object.entries(sel)) {
        out[k] = [...document.querySelectorAll(q)].some((e) => {
          const r = e.getBoundingClientRect(); if (!r.width || !r.height || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
          let a = 1; for (let p = e; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none') return false; a *= +c.opacity; }
          return getComputedStyle(e).visibility !== 'hidden' && a > 0.02;
        });
      }
      return out;
    });
    await enter(page, 'sail');
    const seen = new Map(), beats = new Set(); let n = 0;
    for (let t0 = Date.now(); Date.now() - t0 < 9000;) {
      const d = await drawn();
      if (d.phase === 'playing') { n++; beats.add(d.hud); for (const k of ['wind', 'chart', 'keys', 'pro']) if (d[k]) seen.set(k, (seen.get(k) ?? 0) + 1); }
      else if (d.phase === 'done') break;
      await page.waitForTimeout(40);
    }
    check(n > 20 && beats.size > 1, `sampled the intro through its beats (${n} samples, ${beats.size} HUD states)`);
    check(!seen.has('wind') && !seen.has('chart'), `no dial module drawn at any beat (wind ${seen.get('wind') ?? 0}, chart ${seen.get('chart') ?? 0} of ${n} samples)`);
    check(!seen.has('keys') && !seen.has('pro'), `no key legend or Pro column drawn at any beat (keys ${seen.get('keys') ?? 0}, pro ${seen.get('pro') ?? 0})`);
    await until(page, () => window.__velia.intro.state.phase === 'done', null, 15000);
    await page.waitForTimeout(1500);
    const e = await drawn();
    check(e.phase === 'done' && !e.on && e.wind && e.chart, `after the handover in Sail: the intro class off, both modules drawn (wind ${e.wind}, chart ${e.chart})`);
    await ctx.close();
  }
  // ---- a key skips it ----
  {
    const { page, ctx } = await open(browser, `${BASE}/?mode=sail&${Q}&cinema=1`);
    await enter(page, 'sail');
    await until(page, () => window.__velia.intro.state.t >= 1.2);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(700);
    const s = await look(page);
    check(s.st.phase === 'done' && s.st.skipped && s.bars.length === 0 && s.bar === true, `a key skips: done ${s.st.phase}, skipped ${s.st.skipped}, top bar ${s.bar}`);
    await ctx.close();
  }
  // ---- reduced motion ----
  {
    const { page, ctx } = await open(browser, `${BASE}/?mode=sail&${Q}&cinema=1`, { reduced: true });
    await enter(page, 'sail');
    let barsSeen = false, lensSeen = false;
    for (let i = 0; i < 10; i++) { const r = await look(page); if (r.bars.length) barsSeen = true; if (r.lens.amount > 0) lensSeen = true; await page.waitForTimeout(60); }
    await page.waitForTimeout(800);
    const r = await look(page);
    check(!barsSeen && !lensSeen && r.st.reduced === true && r.st.phase === 'done' && r.bar === true, `reduced motion: no bars (${barsSeen}), no lens (${lensSeen}), the HUD in (${r.st.phase}, top bar ${r.bar})`);
    await ctx.close();
  }
  // ---- the first Cruise entry ----
  {
    const { page, ctx } = await open(browser, `${BASE}/?mode=sail&${Q}&cinema=1`);
    await enter(page, 'cruise');
    check(await until(page, () => window.__velia.intro.state.t >= 1.5), 'the intro runs in Cruise');
    const a = await look(page);
    check(a.st.mode === 'cruise' && a.bars.length === 2 && a.bar === false, `Cruise: the bars, the top bar held (${a.st.mode})`);
    check(inBand(a.probe), `Cruise: the whole boat inside the band: ${a.probe.y.join(', ')} ≤ ${a.probe.band.toFixed(3)}`);
    await ctx.close();
  }
  // ---- off ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await ctx.newPage();   // navigator.webdriver true (no PERSON)
    await page.goto(`${BASE}/?mode=sail&${Q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.intro, null, { timeout: 240000 });
    check(await page.evaluate(() => window.__velia.intro.state.phase === 'off' && !document.querySelector('.lk-ibar')), 'an automated browser with no ?cinema: off');
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser, `${BASE}/?mode=sail&${Q}&cinema=0`);
    await enter(page, 'sail'); await page.waitForTimeout(1200);
    const r = await look(page);
    check(r.st.phase === 'off' && r.bars.length === 0, `?cinema=0: off (${r.st.phase})`);
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const page = await ctx.newPage();
    await page.goto(`${BASE}/?${Q}&headless=1&cinema=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
    check(await page.evaluate(() => window.__velia.intro.enabled === false), 'a capture (?headless=1): off');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
    const page = await ctx.newPage(); await page.addInitScript(PERSON);
    await page.goto(`${BASE}/?${Q}&cinema=1&headless=1&profile=form:phone,input:touch,screen:compact`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
    check(await page.evaluate(() => window.__velia.intro.enabled === false && document.documentElement.dataset.fCinematicIntro !== 'on'), 'a phone: off, even with ?cinema=1');
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
