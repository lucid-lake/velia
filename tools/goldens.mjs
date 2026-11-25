// The golden frame set: fully pinned frames (golden/frames.json) captured against a private Vite and diffed against golden/<name>.png.
//   npm run goldens                       # capture all, diff each, write the contact sheet of failures, exit 1 on any failure
//   npm run goldens -- --only glare,dusk  # a subset
//   npm run goldens -- --bless <name|all> # write new references (the owner must have OK'd the look first)
//   npm run goldens -- --twice            # determinism check: capture every frame twice, compare the two (no golden involved)
//   npm run goldens -- --reverse          # the frames in the opposite order (with or without --twice: run order must not matter)
// Output under renders/goldens/: <name>.png (now), <name>.diff.png, failures-sheet.png (before | now | diff per failed frame),
// references-sheet.png (all references, after a bless). The sheet's strip colours: grey = before, green = now, red = diff.
// Three kinds of frame:
//   headless (the default pin): the scene only, renderOnce() × 30 on a frozen scene clock;
//   pending: true: a new frame with no reference yet (the owner has not seen it): captured and listed as pend, never a failure;
//   a reference makes it an ordinary frame (drop the field at the bless)
//   recipe: a headless frame set up in the page first (RECIPES below: the birds placed by the director's cues);
//   live UI: `film` (a ?filmui=1 page: the HUD, the shell, the staged first visit) runs on Playwright's fake clock, paused
//     and stepped in lockstep with filmFrame(dt), so the UI's own timers and rAF see the same time every run; `person`
//     hides navigator.webdriver (the page then acts as for a visitor: the staged first visit plays); `waitState` (the home
//     card) waits for the loading shell's state. Every live frame freezes the page's CSS animations (finished, or held at
//     0 when endless) before the screenshot: the inking-in and the still's drift were the home frame's flake.
import { chromium } from 'playwright-core';
import { createServer as netServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
// --app v2: the Velia v2 page: v2/golden/frames.json and v2/golden/<name>.png on v2's own Vite
// (v2/vite.config.js), output under renders/goldens-v2/, the hook window.__velia. v1 runs exactly as before.
const APP = opt('app') === 'v2' ? 'v2' : 'v1';
const V2 = APP === 'v2';
const GOLD = V2 ? 'v2/golden' : 'golden';
const HOOK = V2 ? '__velia' : '__lakeshore';
const CFG = JSON.parse(readFileSync(resolve(ROOT, GOLD, 'frames.json'), 'utf8'));
const [W, H] = CFG.viewport;
const OUT = resolve(ROOT, V2 ? 'renders/goldens-v2' : 'renders/goldens');
mkdirSync(OUT, { recursive: true });
const bless = opt('bless'), twice = opt('twice') === true;
const only = (opt('only') || '').split(',').filter(Boolean);
let frames = CFG.frames;
if (bless && bless !== true && bless !== 'all') frames = frames.filter((f) => bless.split(',').includes(f.name));
else if (only.length) frames = frames.filter((f) => only.includes(f.name));
if (bless === true) { console.error('--bless needs a frame name or "all"'); process.exit(2); }
// --reverse: the frames in the opposite order (a determinism check: no frame may depend on the frames shot before it)
if (opt('reverse') === true) frames = frames.slice().reverse();
if (!frames.length) { console.error('no such frame'); process.exit(2); }

const freePort = () => new Promise((ok, no) => { const s = netServer(); s.once('error', no); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(CHROME)) { console.error(`Chrome not found at ${CHROME}; set LAKESHORE_CHROME`); process.exit(2); }

const { createServer } = await import('vite');
const port = await freePort();
const server = await createServer({ root: V2 ? resolve(ROOT, 'v2') : ROOT, configFile: resolve(ROOT, V2 ? 'v2/vite.config.js' : 'vite.config.js'), cacheDir: resolve(ROOT, V2 ? 'renders/.vite-goldens-v2' : 'renders/.vite-goldens'),
  clearScreen: false, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
await server.listen();
const BASE = `http://127.0.0.1:${port}`;
let browser = null;
const stop = async () => { try { await browser?.close(); } catch {} try { await server.close(); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stop(); process.exit(130); });

const pinOf = (f) => f.pin ?? CFG.pin;   // a frame about the live UI may override the pin (the home card needs the loading shell)
// --extra "k=v&…": appended to every frame's URL (a check, never a bless: perf/slow-loading runs --extra slow=1, the slow
// link's coarse-then-fine ground, which must end on the same pixels)
const EXTRA = opt('extra');
if (EXTRA && bless) { console.error('--extra is a check only, never with --bless'); process.exit(2); }
const urlOf = (f) => `${BASE}/?${f.query}${pinOf(f) ? '&' + pinOf(f) : ''}${typeof EXTRA === 'string' ? '&' + EXTRA : ''}`;
const publicUrl = (f) => `http://127.0.0.1:${V2 ? 5174 : 5173}/?${f.query}${pinOf(f) ? '&' + pinOf(f) : ''}`;

// a headless frame set up in the page before its renders (frames.json "recipe"); plain data and maths on the scene clock
const RECIPES = {
  // the birds (src/birds/, ?birds=1&film=1): the bald eagle, the osprey and the gulls' flock placed by the director's cues
  // 80–160 m off the bow (the birds keep 40 m from any camera), the camera on deck with a long lens on them, the sky
  // behind; 12 film steps on the scene clock so the wings are mid-beat (the shape of tools/birds_director.js)
  birds: async () => {
    const L = window.__lakeshore, B = L.core.birds, s = L.boat.phys.state;
    const fx = Math.sin(s.heading), fz = -Math.cos(s.heading), sx = -fz, sz = fx;
    const at = (fwd, side, y) => [s.x + fx * fwd + sx * side, y, s.z + fz * fwd + sz * side];
    const eye = at(5, -3, 2.4), yaw = Math.atan2(fx, fz);   // on the foredeck to port, the sails behind the lens
    B.cue('place', { who: 'eagle', pos: at(84, -34, 24), yaw: yaw + 1.3 });
    B.cue('place', { who: 'hunter', pos: at(100, -24, 30), yaw: yaw - 1.1 });
    const g = at(150, -50, 0); B.cue('flock', { x: g[0], z: g[2], y: 40 });
    for (let k = 0; k < 12; k++) {
      L.film.step(1 / 30); B.update(L.core.time, L.camera);
      const e = B.find('eagle').pos, h = B.find('hunter').pos;   // the lens on the two raptors (a long lens, as the birds film)
      L.film.pose({ pos: eye, target: [(e[0] + h[0]) / 2, (e[1] + h[1]) / 2 + 2, (e[2] + h[2]) / 2], fov: 11 }); await L.renderOnce();
    }
  },
  // v2's birds (v2/sim/birds.js, ?birds=1 with ?campos pinning the camera): v1's recipe above, the same cues and lens, on
  // v2's hook (__velia.birds.frame: a film step on the scene clock, then the camera aimed at the two raptors)
  'birds-v2': async () => {
    const V = window.__velia, B = V.birds.sim, s = V.boat.state;
    const fx = Math.sin(s.heading), fz = -Math.cos(s.heading), sx = -fz, sz = fx;
    const at = (fwd, side, y) => [s.x + fx * fwd + sx * side, y, s.z + fz * fwd + sz * side];
    const eye = at(5, -3, 2.4), yaw = Math.atan2(fx, fz);
    B.cue('place', { who: 'eagle', pos: at(84, -34, 24), yaw: yaw + 1.3 });
    B.cue('place', { who: 'hunter', pos: at(100, -24, 30), yaw: yaw - 1.1 });
    const g = at(150, -50, 0); B.cue('flock', { x: g[0], z: g[2], y: 40 });
    for (let k = 0; k < 12; k++) {
      await V.birds.frame(1 / 30, (sim) => { const e = sim.find('eagle').pos, h = sim.find('hunter').pos; return { pos: eye, target: [(e[0] + h[0]) / 2, (e[1] + h[1]) / 2 + 2, (e[2] + h[2]) / 2], fov: 11 }; });
    }
  },
};

const FILM_EPOCH = Date.parse('2026-06-15T18:45:00-07:00');   // the fake clock's start (the page's Date; the scene's hour is pinned anyway)
async function shoot(f, tag) {
  const [fw, fh] = f.viewport ?? [W, H];   // a frame's own viewport (v2 M3: the phone frame at 390 × 844); the set's otherwise
  const page = await browser.newPage({ viewport: { width: fw, height: fh }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().split('\n')[0]); });
  try {
    if (f.person) await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    if (f.film) await page.clock.install({ time: FILM_EPOCH });
    await page.goto(urlOf(f), { waitUntil: 'load', timeout: 120000 });
    if (f.film) {   // a live UI frame on the film clock: the fake clock paused, then stepped with each filmFrame(dt)
      await page.waitForFunction((h) => window[h]?.filmFrame, HOOK, { timeout: 240000 });
      // the shell (src/shell.js: the Calm HUD, the home logic, the staged first visit's clock) is a dynamic import after
      // ready: wait for it on the load's clock, so the first film frame never runs without it (it times itself by rAF)
      if (!V2) await page.waitForFunction(() => window.__lakeshore.menu, null, { timeout: 60000 });   // v2 (M4): the UI is in when filmFrame is
      const now = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(FILM_EPOCH + Math.ceil((now - FILM_EPOCH + 1000) / 60000) * 60000);
      const dt = f.film.dt ?? 1 / 30;
      for (let i = 0; i < f.film.frames; i++) {
        await page.clock.runFor(1000 * dt);
        // a frame that throws in the page (the Web Audio overlap stopped a whole run at hud-calm, 2026-11-10) is a page
        // error of this frame: noted, and the film goes on
        try { await page.evaluate(([d, h]) => window[h].filmFrame(d), [dt, HOOK]); } catch (e) { errors.push(`film frame ${i}: ${String(e.message ?? e).split('\n')[0]}`); }
      }
    } else if (f.waitState) {   // the home card: wait for the loading shell's state (the freeze below finishes its inking-in)
      await page.waitForFunction((st) => window.__veliaLoading?.live && window.__veliaLoading.state === st, f.waitState, { timeout: 240000 });
      await page.waitForFunction(() => { const i = document.querySelector('#lk-load .lk-still'); return !i || (i.complete && i.naturalWidth > 0); }, null, { timeout: 60000 });   // the still (a lazy image elsewhere never loads)
    } else {
      await page.waitForFunction((h) => window[h]?.renderOnce, HOOK, { timeout: 120000 });
      if (f.recipe) await page.evaluate(RECIPES[f.recipe]);
      // one display frame before each render: three's node frame (its FRAME-type updates, such as the temporal clouds'
      // history and jitter step, src/clouds.js) advances on the page's own rAF, so back-to-back renders shared a frame
      // id and the clouds stepped 22-26 times in 30 renders by the wall clock (the storm's two-state deck, 2026-11-06)
      await page.evaluate(async ([n, h]) => { for (let i = 0; i < n; i++) { await new Promise((r) => requestAnimationFrame(() => r())); await window[h].renderOnce(); } }, [30, HOOK]);
    }
    if (f.film || f.waitState) {   // freeze the CSS: every animation and transition at its end (an endless one at 0)
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].filter((i) => i.complete && i.naturalWidth > 0).map((i) => i.decode().catch(() => {})));
        for (const a of document.getAnimations()) { try { a.finish(); } catch { a.pause(); a.currentTime = 0; } }
      });
      if (f.film) { await page.clock.runFor(100); await page.evaluate((h) => window[h].filmFrame(0), HOOK); }   // the frozen styles painted, the scene unchanged
      else await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    const p = resolve(OUT, `${f.name}${tag}.png`);
    await page.screenshot({ path: p, type: 'png' });
    return { path: p, errors };
  } finally { await page.close(); }
}

const read = (p) => PNG.sync.read(readFileSync(p));
function compare(a, b, diffPath) {
  if (a.width !== b.width || a.height !== b.height) return { pct: 100, n: -1, diff: null };
  const d = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
  if (diffPath) writeFileSync(diffPath, PNG.sync.write(d));
  return { pct: (100 * n) / (a.width * a.height), n, diff: d };
}
function half(img) {   // 2x2 box average
  const w = img.width >> 1, h = img.height >> 1, o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    const i = (y * 2 * img.width + x * 2) * 4 + c, s = img.width * 4;
    o.data[(y * w + x) * 4 + c] = (img.data[i] + img.data[i + 4] + img.data[i + s] + img.data[i + s + 4]) >> 2;
  }
  return o;
}
function sheet(rows, cols, cells, strips = null) {   // cells: PNG[] row-major; a cell of its own size (a phone frame) sits in the largest's box
  const cw = Math.max(...cells.map((c) => c.width)), ch = Math.max(...cells.map((c) => c.height)), g = 6, top = strips ? 8 : 0;
  const o = new PNG({ width: cols * cw + (cols - 1) * g, height: rows * (ch + top) + (rows - 1) * g });
  o.data.fill(24); for (let i = 3; i < o.data.length; i += 4) o.data[i] = 255;
  cells.forEach((c, k) => {
    const r = Math.floor(k / cols), cc = k % cols, ox = cc * (cw + g), oy = r * (ch + top + g);
    if (strips) { const col = strips[cc]; for (let y = 0; y < top; y++) for (let x = 0; x < cw; x++) { const j = ((oy + y) * o.width + ox + x) * 4; o.data[j] = col[0]; o.data[j + 1] = col[1]; o.data[j + 2] = col[2]; o.data[j + 3] = 255; } }
    PNG.bitblt(c, o, 0, 0, Math.min(c.width, cw), Math.min(c.height, ch), ox, oy + top);
  });
  return o;
}

const t0 = Date.now();
let failed = 0;
try {
  await fetch(`${BASE}/`).catch(() => {});   // warm the dep optimiser
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
  console.log(`goldens: private Vite at ${BASE}, ${frames.length} frame(s)${bless ? ', BLESS' : twice ? ', determinism (two captures each)' : ''}`);
  const fails = [], errs = [];
  for (const f of frames) {
    const t1 = Date.now();
    // a frame that cannot be shot (a timeout, a page that threw out of the runner) fails alone; the run goes on
    const shot = async (tag) => { try { return await shoot(f, tag); } catch (e) { return { path: null, errors: [`not shot: ${String(e.message ?? e).split('\n')[0]}`] }; } };
    const a = await shot(twice ? '.run1' : '');
    if (a.errors.length) { errs.push([f.name, a.errors]); console.log(`  WARN ${f.name}: ${a.errors.length} page error(s): ${a.errors.slice(0, 2).join(' | ')}`); }
    if (!a.path) { failed++; console.log(`  FAIL ${f.name}: not shot  [${((Date.now() - t1) / 1000).toFixed(0)} s]`); continue; }
    if (twice) {
      const b = await shot('.run2');
      if (b.errors.length) errs.push([`${f.name} (run 2)`, b.errors]);
      if (!b.path) { failed++; console.log(`  FAIL ${f.name}: run 2 not shot`); continue; }
      const r = compare(read(a.path), read(b.path), resolve(OUT, `${f.name}.twice.diff.png`));
      const ok = r.pct <= 0.1; if (!ok) failed++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${f.name}: run1 vs run2 ${r.n} px (${r.pct.toFixed(4)} %)  [${((Date.now() - t1) / 1000).toFixed(0)} s]`);
      continue;
    }
    const gp = resolve(ROOT, GOLD, `${f.name}.png`);
    if (bless) {
      writeFileSync(gp, readFileSync(a.path));
      writeFileSync(resolve(ROOT, GOLD, `${f.name}.json`), JSON.stringify({ name: f.name, url: publicUrl(f), size: f.viewport ?? [W, H], tolerance: f.tolerance, about: f.about }, null, 2) + '\n');
      console.log(`  blessed ${f.name}  [${((Date.now() - t1) / 1000).toFixed(0)} s]`);
      continue;
    }
    // a new frame waiting on the owner's eyes (frames.json "pending": true): captured for review, not a failure until blessed
    if (!existsSync(gp) && f.pending) { console.log(`  pend ${f.name}: no reference yet, the capture is ${a.path} (bless after the owner OK, then drop "pending")`); continue; }
    if (!existsSync(gp)) { console.log(`  FAIL ${f.name}: no reference (run --bless ${f.name} after the owner OK)`); failed++; continue; }
    const g = read(gp), n = read(a.path);
    const r = compare(g, n, resolve(OUT, `${f.name}.diff.png`));
    const tol = f.tolerance ?? 0.1, ok = r.pct <= tol && !a.errors.length;
    if (!ok) { failed++; fails.push({ f, g, n, d: r.diff }); }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${f.name}: ${r.n} px differ (${r.pct.toFixed(3)} %), tolerance ${tol} %${a.errors.length ? `, ${a.errors.length} page error(s)` : ''}  [${((Date.now() - t1) / 1000).toFixed(0)} s]`);
  }
  if (bless) {
    const refs = CFG.frames.filter((f) => existsSync(resolve(ROOT, GOLD, `${f.name}.png`))).map((f) => half(read(resolve(ROOT, GOLD, `${f.name}.png`))));
    const p = resolve(OUT, 'references-sheet.png');
    writeFileSync(p, PNG.sync.write(sheet(Math.ceil(refs.length / 2), 2, refs)));   // order = frames.json, two columns
    console.log(`references sheet: ${p}\nREMINDER: bless only a look the owner has OK'd (before/now images sent, the owner said yes). Note why and commit golden/.`);
  } else if (fails.length) {
    const cells = fails.flatMap(({ g, n, d }) => [half(g), half(n), half(d)]);
    const p = resolve(OUT, 'failures-sheet.png');
    writeFileSync(p, PNG.sync.write(sheet(fails.length, 3, cells, [[150, 150, 150], [60, 190, 90], [220, 60, 60]])));
    console.log(`\ncontact sheet of ${fails.length} failure(s) (rows: ${fails.map((x) => x.f.name).join(', ')}; before | now | diff): ${p}`);
    console.log('A failing frame: send the owner the before/now images; merge only on their OK; then --bless it.');
  }
  if (errs.length) {   // every frame's page errors, after the run (a frame with any fails: green means no error either)
    console.log(`\npage errors in ${errs.length} frame(s):`);
    for (const [name, list] of errs) for (const e of [...new Set(list)].slice(0, 5)) console.log(`  ${name}: ${e}`);
  }
  console.log(`\ngoldens: ${failed ? `${failed} FAILED` : 'all pass'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} finally { await stop(); }
process.exit(failed ? 1 : 0);
