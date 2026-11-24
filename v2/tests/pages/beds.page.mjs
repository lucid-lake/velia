// The sound beds (v2 step 3, hybrid: the code wind, v1's recordings for the rest) in a real Chrome:
//   1. the WAV test: 60 s of the scripted sail (v2/audio/script.js: calm, gusts, a tack, a luff, rain) rendered offline
//      (OfflineAudioContext, the live page's mixer, code wind and v1's files on v1's engines): peak ≤ −1 dBFS, no silence over
//      0.5 s, no click (no sample-to-sample step over 0.25) before the rain; in the rain the steps are v1's rain recording's
//      drops (v1's own sound under the same 60 s: 0.56), held under 0.45; the gated loudness inside −36 … −24 dBFS; the code
//      graph made at build; v1's 15 files and the recorded wave hits (hull_slap, ?wavehit=rec) loaded once (S1a: + the dawn chorus and the loons);
//   2. the live page: after a click the beds run on the page's context; the graph does not grow over 3 s of sailing and the
//      main thread's audio work stays ≤ 0.1 ms a frame (the lower quartile of 15-frame windows: load-proof, #54); the Settings' sound switch fades them out;
//   3. a headless capture never starts them.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/beds.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  // 1. the WAV test
  const page = await browser.newPage();
  await page.route(`${BASE}/__beds.html`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><title>beds</title>' }));
  await page.goto(`${BASE}/__beds.html`);
  const r = await page.evaluate(async () => {
    const [off, scr] = await Promise.all([import('/audio/offline.js'), import('/audio/script.js')]);
    const res = await off.renderBeds({ frames: scr.frames(60, 60), fps: 60 });
    // the meter after the 0.3 s fade-in at the start (the page's fade when the sound begins); the dry part and the rain apart
    const sr = res.sampleRate, cut = (a, b) => res.channels.map((d) => d.subarray(Math.round(a * sr), Math.round(b * sr)));
    return { m: off.meter(cut(0.3, 60), sr), dry: off.meter(cut(0.3, 44), sr), wet: off.meter(cut(44, 60), sr), s: res.stats };
  });
  const { m, dry, wet, s } = r;
  console.log(`  60 s: peak ${m.peakDb.toFixed(2)} dBFS, max step ${dry.maxStep.toFixed(3)} dry / ${wet.maxStep.toFixed(3)} in the rain, RMS ${m.rmsDb.toFixed(1)} dBFS, gated ${m.gatedDb.toFixed(1)} dBFS, longest silence ${m.longestSilenceS.toFixed(2)} s; ${s.nodes} code nodes, ${s.events} one-shots, ${s.files.length} files ${(s.bytes / 1024).toFixed(0)} KB, update ${(s.updateMsMean * 1000).toFixed(1)} µs mean, render ${s.renderMs.toFixed(0)} ms`);
  check(m.peakDb <= -1, `peak ≤ −1 dBFS (${m.peakDb.toFixed(2)})`);
  check(m.longestSilenceS <= 0.5, `no silence over 0.5 s while sailing (${m.longestSilenceS.toFixed(2)} s under −60 dBFS)`);
  check(dry.maxStep <= 0.25, `no clicks: no sample-to-sample step over 0.25 before the rain (${dry.maxStep.toFixed(3)})`);
  check(wet.maxStep <= 0.45, `in the rain, v1's recorded drops under 0.45 (${wet.maxStep.toFixed(3)}; v1's own: 0.56)`);
  check(m.gatedDb >= -36 && m.gatedDb <= -24, `loudness inside −36 … −24 dBFS gated (${m.gatedDb.toFixed(1)})`);
  check(s.nodes === s.nodesAfterBuild && s.events >= 10, `the code graph made at build (${s.nodes}), ${s.events} one-shots`);
  check(s.files.length === 16 && new Set(s.files).size === 16 && s.files.every((f) => f.startsWith('/audio/')), `v1's files by v1's paths, each once (${s.files.length})`);
  check(s.updateMsMean <= 0.1, `the main thread's update ≤ 0.1 ms a frame on average (${(s.updateMsMean * 1000).toFixed(1)} µs)`);
  await page.close();

  // 2. the live page
  const live = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; live.on('pageerror', (e) => errors.push(String(e)));
  await live.addInitScript(PERSON); await live.addInitScript(WELCOMED);
  await live.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0`, { waitUntil: 'load' });
  await live.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
  await pickMode(live, 'sail');   // ENTER: the first gesture makes the page's AudioContext
  await live.waitForFunction(() => { try { return window.__velia.stats().beds?.nodes > 0; } catch { return false; } }, null, { timeout: 30000, polling: 200 }).catch((e) => console.log('  wait:', String(e).split('\n')[0]));
  await live.waitForTimeout(500);
  const a = await live.evaluate(() => window.__velia.stats().beds);
  await live.keyboard.down('KeyW'); await live.waitForTimeout(1500); await live.keyboard.up('KeyW');   // the winch: the clicks
  await live.waitForTimeout(1500);
  const b = await live.evaluate(() => window.__velia.stats().beds);
  check(!!a?.on && b.nodes === a.nodes && a.nodes > 20, `live: the beds run on the page's context, the code graph built once (${a?.nodes} → ${b?.nodes} nodes)`);
  check(b.files === 16 && b.bytes > 500000, `live: v1's recordings loaded after the gesture (${b.files} files, ${(b.bytes / 1024).toFixed(0)} KB)`);
  // #54: judged on the quiet windows, not the whole mean. A loaded Mac read 105–120 µs (68–72 alone): a few frames preempted
  // mid-update (up to 1–5 ms each) carry the extra. The lower quartile of the 15-frame windows' means ignores them; a code
  // that costs 2× reads 2× in every window. (The page's clock ticks in 100 µs, so one frame reads 0, 100 or 200 µs; 15 of
  // them average out.) 2026-11-14 beside a 36-thread burner (load 23–42): 80–87 µs, 5 of 5 pass, the old mean 105–118;
  // ≈ 70 µs of work injected a frame: 127–160 µs, 3 of 3 fail; 150 µs injected: 253–273 µs, 5 of 5 fail
  const w = [...(b.mainMs.windows ?? [])].sort((x, y) => x - y), q1 = w.length ? w[Math.floor((w.length - 1) / 4)] : Infinity;
  const us = (v) => (v * 1000).toFixed(1);
  console.log(`  live audio windows (µs, sorted): ${w.map(us).join(' ')}`);
  check(b.mainMs.frames > 30 && w.length >= 4 && q1 <= 0.1, `live: main-thread audio work ${us(q1)} µs a frame in the quiet windows (lower quartile of ${w.length} × 15 frames; best ${us(w[0] ?? NaN)}, mean ${us(b.mainMs.mean)}, max ${(b.mainMs.max * 1000).toFixed(0)} µs, ${b.mainMs.frames} frames)`);
  check(b.gains && b.gains.wind > 0, `live: the wind bed sounds (wind ${b.gains?.wind?.toFixed(3)}, rush ${b.gains?.rush?.toFixed(3)})`);
  check(errors.length === 0, `live: no page errors (${errors.join(' | ')})`);
  await live.close();

  // 3. a capture is silent
  const cap = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await cap.goto(`${BASE}/?start=1200,-1050&heading=251&hour=15&seed=1&headless=1`, { waitUntil: 'load' });
  await cap.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await cap.mouse.click(400, 300);
  const c = await cap.evaluate(() => ({ beds: window.__velia.stats().beds, input: !!window.__velia.beds?.input() }));
  check(c.beds === null && c.input, `headless: no beds (stats ${JSON.stringify(c.beds)}), the harness can still read their input`);
  await cap.close();
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
