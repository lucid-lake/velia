// v2 port of v1's loading checks (tests/pages/frontDoor.page.mjs, tests/loading.test.mjs's live rules): v1's loading screen
// (src/ui/loading.js) on the real v2 page, with no attract reel (owner, 2026-11-13: "merge front door, no reel"; v2/ui/noReel.js).
//   the stages: v2's boot tells v1's stages in order (gpu, terrain, water, sky, boat), then ready at the first frame; the bar never
//     goes back; the card goes live ≥ 1 s after the first paint, never before ready
//   no reel: no video element, no /reel/ request, no Skip or sound chip, no caption; the mark thins onto the golden still (the one
//     still fetched), then the card stands over the live lake (data-reel-end=live), never the strip; nothing waits on a film clock
//   automation goes straight in (v1's rule: navigator.webdriver, no ?gate=1); a capture has the shell off
//   a first visit (a new visitor: no stored settings; owner 2026-11-13, no staged minute in v2): the same door as a returning
//     visit: the mark, the card over the live lake, no dissolve (data-first), the boat at Sail's own start, no opening camera,
//     no stage; no skill question (owner 2026-11-21: the profile starts as New); the old big card never paints before the
//     panel's layout (v2/ui/loadWords.js hold); a fact under the line; ENTER sails
//   no WebGPU: the launch gate's page (it links the classic Velia, /classic/), the loading card gone, no page error (v1's showed its fail state:
//     v1 falls back to WebGL2, v2 cannot)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/loading.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const RETURNING = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true })); } catch {} };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // a returning visitor on a desktop (where v1 would play its film): the stages, the bar, the mark and the still, the card over the live lake
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const reqs = [];
    page.on('request', (r) => { const u = new URL(r.url()).pathname; if (/\/reel\/|\/brand\/stills\/|\.mp4$/.test(u)) reqs.push(u); });
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    await page.addInitScript(() => { window.__bar = []; const tick = () => { const L = window.__veliaLoading; if (L?.live) window.__bar.push([L.progress, L.state, document.querySelector('#lk-load .lk-company')?.classList.contains('off') ?? null]); if (!L || L.state !== 'home') requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.goto(`${BASE}/?hour=15&seed=1&attract=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home', null, { timeout: 240000 });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(() => { const R = document.getElementById('lk-load'); return { log: window.__veliaLoading.log, bar: window.__bar, ff: window.__velia._stats().firstFrameFromNavMs,
      video: document.querySelectorAll('video').length, chips: !!document.querySelector('.lk-corner, .lk-skip, .lk-sound, .lk-fcap'), reel: R.dataset.reel, end: R.dataset.reelEnd ?? null, strip: R.dataset.strip ?? null,
      card: R.querySelector('.lk-card').getBoundingClientRect().width, still: getComputedStyle(R.querySelector('.lk-bg') ?? R).opacity, reelApi: window.__veliaLoading.reel?.mode }; });
    const names = r.log.map((x) => x[0]);
    check(JSON.stringify(names) === JSON.stringify(['gpu', 'terrain', 'water', 'sky', 'boat', 'ready']), `the stages in order (${names})`);
    const homeAt = r.bar.findIndex((b) => b[1] === 'home'), ready = r.log.at(-1)[2];
    check(r.bar.every((b, i) => i === 0 || b[0] >= r.bar[i - 1][0] - 1e-9), 'the bar never goes back');
    check(homeAt > 0 && r.bar.slice(0, homeAt).every((b) => b[1] === 'company'), 'the card went live after the loading, once');
    check(ready >= 0 && r.ff != null, `ready at the first frame (ready ${ready} ms after the first paint, first frame ${r.ff} ms from navigation)`);
    check(r.bar.some((b) => b[2] === true) && r.bar.findIndex((b) => b[2] === true) <= homeAt, 'the mark thinned before the card (onto the still)');
    check(r.video === 0 && !r.chips && r.reel === 'none' && r.reelApi === 'none', `no reel: no video, no Skip, no sound chip, no caption (${JSON.stringify({ video: r.video, chips: r.chips, reel: r.reel })})`);
    check(reqs.length > 0 && reqs.every((u) => /\/brand\/stills\/reel-golden-\d+\.webp$/.test(u)), `only the golden still is fetched, no film (${JSON.stringify(reqs)})`);
    check(r.end === 'live' && r.strip !== 'on' && r.card > 300, `the card stands over the live lake, no strip (${JSON.stringify({ end: r.end, strip: r.strip, card: r.card, still: r.still })})`);
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // nothing waits on a film clock: the card is live within 1 s + the bar's ease of the first frame (v1's MIN_CARD, no film)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript(PERSON); await page.addInitScript(RETURNING);
    const t0 = Date.now();
    await page.goto(`${BASE}/?hour=15&seed=1&attract=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
    const tReady = Date.now() - t0;
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home', null, { timeout: 240000 });
    const tHome = Date.now() - t0;
    console.log(`  ready ${tReady} ms, card live ${tHome} ms after navigation`);
    check(tHome - tReady < 3000, `the card goes live within 3 s of the first frame (${tHome - tReady} ms)`);
    await page.close();
  }
  // automation goes straight in; a capture has the shell off
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${BASE}/?hour=15&seed=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'gone', null, { timeout: 240000 });
    check(true, 'automation (navigator.webdriver): no card, straight in');
    await page.close();
  }
  // a first visit (a new visitor: no stored settings): the same door as a returning visit; no skill question (owner 2026-11-21): the
  // profile starts as New; the old big card never paints before the panel's layout (loadWords.js hold); a fact under the line; ENTER
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON);
    await page.addInitScript(() => { window.__flash = 0; window.__facts = new Set(); const tick = () => { const R = document.getElementById('lk-load'); if (R) {
      const c = R.querySelector('.lk-card'), cs = c && getComputedStyle(c);
      if (R.dataset.state === 'home' && !document.documentElement.dataset.mapCard && cs && cs.visibility !== 'hidden' && +cs.opacity > 0.05) window.__flash++;
      const f = R.querySelector('.lk-pfact.on'); if (f?.textContent) window.__facts.add(f.textContent); }
      if (R?.dataset.state !== 'gone') requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await page.goto(`${BASE}/?hour=18.75&seed=1&wind=3&attract=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => { const R = document.getElementById('lk-load'), F = window.__velia.m4.front, s = window.__velia.boat.state;
      return { state: window.__veliaLoading.state, first: R.hasAttribute('data-first'), end: R.dataset.reelEnd ?? null, view: F.home.view, stage: 'stage' in F, intro: 'intro' in window.__velia.m4, fv: 'firstVisit' in window.__velia,
        x: s.x, z: s.z, card: R.querySelector('.lk-card').getBoundingClientRect().width }; });
    check(r.state === 'home' && r.end === 'live' && r.card > 300, `a new visitor gets the card over the live lake (${JSON.stringify({ state: r.state, end: r.end, card: r.card })})`);
    const w = await page.evaluate(() => ({ choices: document.querySelectorAll('#lk-load .pg.welcome:not([hidden])').length, profile: JSON.parse(localStorage.getItem('lakeshore.settings.v1') ?? '{}').profile,
      flash: window.__flash, facts: window.__facts.size, hold: document.documentElement.dataset.lkHold ?? null }));
    check(r.view === 'home' && w.choices === 0 && w.profile === 'new', `no skill question: the card's home view, the profile New (${JSON.stringify({ view: r.view, choices: w.choices, profile: w.profile })})`);
    check(w.flash === 0 && w.hold === null, `the old big card never painted before the panel's layout (${w.flash} frames)`);
    check(w.facts >= 1, `a fact under the line while it loaded (${w.facts})`);
    check(!r.first && !r.stage && !r.intro && !r.fv, `no staged minute: no dissolve, no stage, no opening camera, no first-visit decision (${JSON.stringify({ first: r.first, stage: r.stage, intro: r.intro, fv: r.fv })})`);
    check(Math.hypot(r.x - 61, r.z + 406) > 300, `the boat at Sail's own start, not the granite shelf (${r.x.toFixed(0)}, ${r.z.toFixed(0)})`);
    await pickMode(page, 'sail');
    await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 10000 }).then(() => check(true, 'ENTER sails (state gone)'), () => check(false, 'ENTER sails (state gone)'));
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // no WebGPU: v2's plain card, the loading card out of the way
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(PERSON);
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true }));
    await page.goto(`${BASE}/?hour=15&seed=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => !document.getElementById('nogpu')?.hidden, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({ load: !!document.getElementById('lk-load'), link: document.querySelector('#nogpu a')?.href, shown: getComputedStyle(document.getElementById('nogpu')).display }));
    check(!r.load && r.shown !== 'none' && /\/classic\/$/.test(r.link ?? ''), `no WebGPU: the launch gate's page with the classic link, no loading card (${JSON.stringify(r)})`);   //: was the current Velia's URL
    check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
