// The film clock is deterministic (?filmui=1: the live-UI goldens v2-hud-full, v2-hud-calm, v2-home). The hook
// (window.__velia.filmFrame) must appear only once the page is fully in: the first frame drawn and its water readback adopted (the
// boat's float reads it on film frame 0), no readback in flight, the ground photo primed, the front door's chunk wired. Then two
// runs of the same film, one of them under a 4 × CPU throttle, give the same boat state to the last bit at frame N.
// The bug this guards (fixed 2026-11-13): the hook went up before the first frame's readback landed, so film frame 0's float read
// either the flat start or the drawn surface, by a race with the GPU map; the boat ended ≈ 5 cm apart after 400 frames and the
// hud frames' glints drifted 0.3–4 % run to run, by run order and machine load.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/filmClock.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const URL_Q = 'hour=15&wind=2&hud=full&filmui=1&once=0&seed=1';   // v2-hud-full's URL (v2/golden/frames.json)
const EPOCH = Date.parse('2026-06-15T18:45:00-07:00');            // tools/goldens.mjs FILM_EPOCH
const N = 60;                                                     // film frames (2 s of play, 4 s of sim at the 2 × game speed)

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function film(throttle) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message ?? e).split('\n')[0]));
  try {
    if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
    await page.clock.install({ time: EPOCH });
    await page.goto(`${BASE}/?${URL_Q}`, { waitUntil: 'load', timeout: 240000 });
    // the snapshot in the same task the hook is first seen in
    const at = await (await page.waitForFunction(() => {
      const V = window.__velia; if (!V?.filmFrame) return null;
      const s = V._stats();
      return { adopted: s.readback.adopted, inFlight: V.water.ring.inFlight, groundDone: !!s.ground.done, groundQueued: V.ground.queued, front: !document.getElementById('lk-load') || !!V.m4.front, ui: !!V.m4.ui };
    }, null, { timeout: 480000, polling: 'raf' })).jsonValue();
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(EPOCH + Math.ceil((now - EPOCH + 1000) / 60000) * 60000);
    for (let i = 0; i < N; i++) { await page.clock.runFor(1000 / 30); await page.evaluate(() => window.__velia.filmFrame(1 / 30)); }
    const end = await page.evaluate(() => { const V = window.__velia, s = V.boat.state, p = V.boat.sim.pose; return { t: V.boat.sim.t, x: s.x, z: s.z, heading: s.heading, heel: s.heel, u: s.u, heave: p.heave ?? 0, pitch: p.pitch ?? 0, reads: V.water.ring.reads, skipped: V.water.ring.skipped }; });
    return { at, end, errors };
  } finally { await page.close(); }
}
try {
  const a = await film(1);
  check(a.at.adopted >= 1 && a.at.inFlight === 0, `the hook appears with the first frame's readback adopted, none in flight (${JSON.stringify(a.at)})`);
  check(a.at.groundDone && a.at.groundQueued === 0, 'the ground photo primed before the hook');
  check(a.at.front && a.at.ui, "Sail's UI and the front door's chunk wired before the hook");
  const b = await film(4);
  check(b.at.adopted >= 1 && b.at.inFlight === 0, `under a 4 × CPU throttle too (${JSON.stringify(b.at)})`);
  const same = JSON.stringify(a.end) === JSON.stringify(b.end);
  check(same, `two film runs (one throttled 4 ×) give the same boat state at frame ${N}, to the bit (${JSON.stringify(a.end)}${same ? '' : ` vs ${JSON.stringify(b.end)}`})`);
  check(a.end.skipped === 0 && b.end.skipped === 0, 'no readback skipped on the film clock');
  check(!a.errors.length && !b.errors.length, `no page errors (${[...a.errors, ...b.errors].join(' | ').slice(0, 300) || 'none'})`);
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
