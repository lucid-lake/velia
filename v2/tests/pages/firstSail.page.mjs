// The first sail's lines, with no island goal (BACKLOG-v2 #4: v2/ui/firstSail.js on v1's src/ui/firstSailGuide.js) and today's track
// on the small chart (#44: sail.js's chartplotter reads the logbook's line), on the real v2 page:
//   a fresh Sail start (the store as the welcome's "New to it" leaves it): nothing before ENTER; 1.5 s into the quiet sail the hint
//   row says v1's line, "Drag the wheel to steer — the crew handles the sails.", under the top bar; introShown is saved; no goal
//   chip ("Sail to Fannette Island" is gone on v2, owner ruling 2026-11-16) at any point; the line clears on v1's rule (a
//   note with no key: gone after the hint row's 7 s); then ≈ 60 s of game time sailed: the logbook's line has a point every 1.5 s,
//   each on the boat's own path, and the chart draws it: the big chart's track strokes pass through exactly those points
//   (toClient), and the small chart strokes the same line
//   hints off in Setup (the home card's Setup › Aids › hints row, before ENTER): no hint line shows (the row hidden, v1's setHints);
//   the line is still counted as said (introShown), and no goal chip shows
//   a phone (844 × 390, touch, Safari's UA: the flat controls, html.lk-flat) on its first open: the intro line, no goal chip
//   a ?filmui=1 film never builds it (the goldens' hud frames hold)
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/firstSail.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';
import { openMap } from './liveMap.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
// the store as v1's welcome leaves it after "New to it" (src/ui/profile.js applyProfile('new')), the pro offer already made
const NEW = () => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, profile: 'new', crewTrim: true, pilot: true, shoalAssist: true, autoReef: true, hints: true, words: 'both', proMode: false, introShown: false, goalDone: false, proOffered: true, cruiseOffered: false })); localStorage.setItem('lakeshore.calm.v1', '{"told":true}'); sessionStorage.setItem('seeded', '1'); } } catch {} };   // (the Calm HUD's one-time line already told: it would cut the note at its first fade)
const LINE = 'Drag the wheel to steer — the crew handles the sails.';
const URL_ = `${BASE}/?mode=sail&hour=15&seed=1&attract=0&cinema=0`;   // (the cinematic intro holds the first line for its 5.8 s; cinematicIntro.page.mjs tests that)
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1') ?? '{}'));
const state = (page) => page.evaluate(() => {
  const h = window.__velia.m4.ui.hint, r = h.el.getBoundingClientRect(), row = h.el.querySelector('.row'), g = document.querySelector('.lk-guide .goal');
  return { cur: h.current, txt: h.el.textContent, disp: getComputedStyle(h.el).display, top: r.top, bottom: r.bottom, rowIn: !!row?.classList.contains('in'),
    goal: g && !g.hidden ? { tx: g.querySelector('.tx').textContent, dist: g.querySelector('.dist').textContent, rot: g.querySelector('.arrow').style.transform, on: g.classList.contains('on'), top: g.getBoundingClientRect().top } : null,
    simT: window.__velia.boat.sim.t, wallT: performance.now() / 1000, h: innerHeight };
});

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  // ---- a fresh Sail start ----
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(NEW);
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.firstSail && window.__velia.m4.front && window.__velia.m4.logbook, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  const pre = await state(page);
  check(pre.cur !== 'note' && !pre.goal && (await stored(page)).introShown === false, `on the card: no line, no goal (${pre.cur})`);
  await pickMode(page, 'sail');
  let s = null, lineAt = null;
  for (let i = 0; i < 120 && !lineAt; i++) { await page.waitForTimeout(100); s = await state(page); if (s.cur === 'note' && s.txt.includes(LINE)) lineAt = s.wallT; }
  check(!!lineAt, `the first line in the hint row: "${s?.txt}"`);
  await page.waitForTimeout(900);
  s = await state(page);
  check(s.cur === 'note' && s.rowIn && s.disp !== 'none' && s.top > 30 && s.bottom < s.h * 0.4, `shown under the top bar (${Math.round(s.top)}–${Math.round(s.bottom)} px of ${s.h})`);
  check((await stored(page)).introShown === true, 'introShown saved: once per welcome');
  await page.waitForTimeout(300);
  s = await state(page);
  check(!s.goal && !/Fannette/.test(await page.evaluate(() => document.querySelector('.lk-guide')?.textContent ?? '')), `no goal chip under the line (${JSON.stringify(s.goal)})`);
  await page.screenshot({ path: process.env.FIRSTSAIL_SHOT ?? '/dev/null' }).catch(() => {});
  // the line clears on v1's rule: a note with no key, gone after the hint row's 7 s
  let goneAt = null;
  for (let i = 0; i < 140 && !goneAt; i++) { await page.waitForTimeout(100); s = await state(page); if (s.cur !== 'note') goneAt = s.wallT; }
  check(goneAt && goneAt - lineAt > 6.3 && goneAt - lineAt < 9.5, `the line clears after its 7 s (${goneAt ? (goneAt - lineAt).toFixed(1) : '—'} s)`);
  check(!s.goal, 'no goal chip after the line either');

  // ---- ≈ 60 s of game time: the track ----
  const path = [];
  const t0 = (await state(page)).simT;
  for (let i = 0; i < 400; i++) {
    const p = await page.evaluate(() => { const st = window.__velia.boat.sim.state; return { x: st.x, z: st.z, t: window.__velia.boat.sim.t }; });
    path.push(p);
    if (p.t - t0 >= 62) break;
    await page.waitForTimeout(200);
  }
  const tr = await page.evaluate(() => window.__velia.m4.logbook.track.map((p) => ({ x: p.x, z: p.z, v: p.v, t: p.t })));
  const sailed = path.at(-1).t - t0;
  check(sailed >= 60 && tr.length >= Math.floor(sailed / 1.5), `${tr.length} points after ${sailed.toFixed(1)} s of game time (one every 1.5 s, v1's)`);
  const dSeg = (p, a, b) => { const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz, u = L ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / L)) : 0; return Math.hypot(p.x - a.x - u * vx, p.z - a.z - u * vz); };
  const off = tr.filter((p) => p.t >= path[0].t && p.t <= path.at(-1).t).map((p) => { let m = Infinity; for (let i = 1; i < path.length; i++) m = Math.min(m, dSeg(p, path[i - 1], path[i])); return m; });
  const run = Math.hypot(path.at(-1).x - path[0].x, path.at(-1).z - path[0].z);
  check(off.length >= 30 && Math.max(...off) < 2, `each point is on the boat's own path (${off.length} points, worst ${Math.max(...off).toFixed(2)} m off; the boat ran ${run.toFixed(0)} m)`);

  // the chart draws it: record the strokes of the chart's canvases (the track's own widths: 1.1 small, 1.3 big; the route layer's 1.3 strokes only come with a route)
  await page.evaluate(() => {
    const P = CanvasRenderingContext2D.prototype, rec = window.__rec = [];
    const mt = P.moveTo, lt = P.lineTo, bp = P.beginPath, sk = P.stroke;
    P.beginPath = function () { this.__pts = []; return bp.call(this); };
    P.moveTo = function (x, y) { (this.__pts ??= []).push([x, y, 0]); return mt.call(this, x, y); };
    P.lineTo = function (x, y) { (this.__pts ??= []).push([x, y, 1]); return lt.call(this, x, y); };
    P.stroke = function (...a) { const w = Math.abs(this.lineWidth - 1.1) < 1e-4 ? 1.1 : Math.abs(this.lineWidth - 1.2) < 1e-4 ? 1.2 : Math.abs(this.lineWidth - 1.3) < 1e-4 ? 1.3 : 0;   // (the context keeps float32 widths)
      if (window.__recOn && w) rec.push({ cv: this.canvas, w, style: String(this.strokeStyle), pts: (this.__pts ?? []).slice() }); return sk.apply(this, a); };
  });
  await page.evaluate(() => { window.__recOn = true; window.__velia.m4.ui.chart.chart.toggle.shown = true; });
  await page.waitForTimeout(1200);
  const small = await page.evaluate(() => { const c = window.__velia.m4.ui.chart.chart, cv = c.el.querySelector('.small canvas'); const r = window.__rec.filter((q) => q.cv === cv && q.w === 1.1 && /0\.(36|62)\)/.test(q.style)); window.__rec.length = 0; return { strokes: r.length, segs: r.reduce((n, q) => n + q.pts.filter((p) => p[2]).length, 0) }; });
  check(small.strokes >= 1 && small.segs >= 10, `the small chart strokes today's line (${small.strokes} strokes, ${small.segs} segments)`);
  // the live map (the in-game menu; Phase 2b replaced the enlarged chart): her track is drawn as 4 fading strokes of 1.2 px, one vertex per point
  await page.evaluate(() => { window.__recOn = false; });
  await openMap(page);
  await page.evaluate(() => { window.__rec.length = 0; window.__recOn = true; });
  await page.waitForTimeout(1500);
  const big = await page.evaluate(() => {
    const c = window.__velia.m4.ui.services.get('liveChart'), cv = document.querySelector('.lk-livechart canvas'), r = cv.getBoundingClientRect();
    // the track's four inks fade 0.305, 0.43, 0.555, 0.68 (liveChart.js); other 1.2 px strokes (the boat's mark) draw after them
    const ladder = (q) => { const a = +/,\s*([\d.]+)\)$/.exec(q.style)?.[1]; return [0.305, 0.43, 0.555, 0.68].some((v) => Math.abs(a - v) < 0.008); };
    const strokes = window.__rec.filter((q) => q.cv === cv && q.w === 1.2 && ladder(q));
    const last = strokes.slice(-4);   // the newest redraw: its four parts
    const pts = last.flatMap((q) => q.pts.map(([x, y]) => [r.left + x, r.top + y]));
    const tr = window.__velia.m4.logbook.track.slice(-400);   // the map keeps the last 20 min
    let worst = 0, n = 0;
    for (const p of tr) { const q = c.toClient(p.x, p.z); if (!q) continue; n++; let m = Infinity; for (const [x, y] of pts) m = Math.min(m, Math.hypot(x - q.x, y - q.y)); worst = Math.max(worst, m); }
    window.__recOn = false;
    return { strokes: strokes.length, styles: [...new Set(last.map((q) => q.style))], verts: pts.length, n, worst, track: tr.length };
  });
  check(big.verts >= big.track && big.n >= 30 && big.worst < 0.75, `the live map's track strokes pass through every point (${big.n} points, worst ${big.worst.toFixed(2)} px; ${big.verts} vertices, styles ${big.styles.join(' ')})`);
  await page.screenshot({ path: process.env.TRACK_SHOT ?? '/dev/null' }).catch(() => {});
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // ---- hints off in Setup ----
  const off2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors2 = []; off2.on('pageerror', (e) => errors2.push(String(e)));
  await off2.addInitScript(PERSON); await off2.addInitScript(NEW);
  await off2.goto(URL_, { waitUntil: 'load' });
  await off2.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.firstSail && window.__velia.m4.front?.ui, null, { timeout: 240000 });
  await off2.evaluate(() => window.__velia.m4.front.home.show('settings', false));
  await off2.waitForTimeout(400);
  await off2.click('#lk-load .pg[data-page=settings] .tab[data-tab=aids]'); await off2.waitForTimeout(150);
  await off2.click('#lk-load .pg[data-page=settings] [data-t="hints"]'); await off2.waitForTimeout(150);
  check((await stored(off2)).hints === false && await off2.evaluate(() => window.__velia.m4.ui.hint.el.style.display === 'none'), 'Setup › Aids › hints: off (the row hidden)');
  await off2.evaluate(() => window.__velia.m4.front.home.show('home', false)); await off2.waitForTimeout(300);
  await pickMode(off2, 'sail');
  let seen = false, goalSeen = false, o = null;
  for (let i = 0; i < 100; i++) {
    await off2.waitForTimeout(100);
    o = await off2.evaluate(() => { const el = window.__velia.m4.ui.hint.el, r = el.getBoundingClientRect(); return { disp: getComputedStyle(el).display, w: r.width, h: r.height, intro: JSON.parse(localStorage.getItem('lakeshore.settings.v1')).introShown, goal: !!document.querySelector('.lk-guide .goal.on') }; });
    if (o.disp !== 'none' || o.w > 0) seen = true;
    if (o.goal) goalSeen = true;
    if (o.intro && i > 70) break;
  }
  check(!seen, `hints off: no hint line on screen (${JSON.stringify(o)})`);
  check(o.intro && !goalSeen, 'the line is counted as said, and no goal chip shows');
  await off2.screenshot({ path: process.env.HINTSOFF_SHOT ?? '/dev/null' }).catch(() => {});
  check(errors2.length === 0, `no page errors (${errors2.slice(0, 3).join(' | ')})`);
  await off2.close();

  // ---- a phone's first open: the intro line, no goal chip ----
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  const pctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  const ph = await pctx.newPage();
  const errors3 = []; ph.on('pageerror', (e) => errors3.push(String(e)));
  await ph.addInitScript(PERSON); await ph.addInitScript(NEW);
  await ph.goto(URL_, { waitUntil: 'load' });
  await ph.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.firstSail && window.__velia.m4.front, null, { timeout: 240000 });
  await ph.waitForTimeout(1500);
  await ph.tap('#lk-load .lk-pick[data-mode=sail]');
  let pNote = false, pGoal = false, p = null;
  for (let i = 0; i < 120; i++) {
    await ph.waitForTimeout(100);
    p = await ph.evaluate(() => { const h = window.__velia.m4.ui.hint, g = document.querySelector('.lk-guide .goal'); return { flat: document.documentElement.classList.contains('lk-flat'), cur: h.current, txt: h.el.textContent, goal: !!g && !g.hidden, guide: document.querySelector('.lk-guide')?.textContent ?? '' }; });
    if (p.cur === 'note' && /steer/i.test(p.txt)) pNote = true;
    if (p.goal || /Fannette/.test(p.guide)) pGoal = true;
    if (pNote && i > 60) break;
  }
  check(p.flat, 'a phone: the flat controls (html.lk-flat)');
  check(pNote, `a phone: the first sail's intro line shows ("${p.txt}")`);
  check(!pGoal, 'a phone: no goal chip on the first open');
  check(errors3.length === 0, `no page errors (${errors3.slice(0, 3).join(' | ')})`);
  await pctx.close();

  // ---- a ?filmui=1 film never builds it ----
  const film = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await film.addInitScript(NEW);
  await film.goto(`${BASE}/?start=1200,-1050&heading=251&hour=15&seed=1&filmui=1`, { waitUntil: 'load' });
  await film.waitForFunction(() => window.__velia?.m4?.ui, null, { timeout: 240000 });
  await film.waitForTimeout(1500);
  check(await film.evaluate(() => !window.__velia.m4.firstSail && !document.querySelector('.lk-guide')), 'a ?filmui=1 film: no first-sail layer');
  await film.close();
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
