// The owner's report (2026-11-14) on the real v2 page, by the keys: "When I lower the sail, then turn on the engine at full speed,
// and press W or S, this often makes the boat spin in place for a very long time." Sail, head to wind with the sails coming
// down (she drifts astern: the case that spun), Y the sails down, I the engine, + + + to full ahead, then S held past the
// stop, W held, taps of both, as a player would; then A held. Each frame's heading, yaw rate, rudder, the hands, the pilot's
// hold, the let fly and the engine are logged (window.__motorLog). The checks: no spin (|yaw| over 5°/s for more than 2 s
// with no hand on the helm; the pilot's corrections stay under 1°/s, full lock ahead turns her at ≈ 16°/s), the ease key
// lets nothing fly with the sails down, the pilot keeps her, she makes way ahead, and the yaw follows A within 1 s.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/motorHelm.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const SPIN = { rate: 5, s: 2 };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  // the narrows pose pinned (start=1200,-1050&heading=251: the default start is a birthplace on a reach since 2026-11-18) heads 251°; the wind from 251° at 13 m/s (25 kn) puts her head to wind; open water ahead of the start
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&hm=0&chatter=0&windspeed=13&winddir=251`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.sea && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.evaluate(() => {
    const V = window.__velia, B = V.boat.sim, D = 180 / Math.PI; window.__motorLog = []; window.__mark = '';
    const f = () => { const s = B.state, e = B.phys.engine, h = V.hands?.now ?? {};
      window.__motorLog.push({ t: +B.t.toFixed(3), wall: performance.now() / 1000, mark: window.__mark, hdg: +(((s.heading * D) % 360 + 360) % 360).toFixed(1), yaw: +(s.yawRate * D).toFixed(2), rud: +B.ctl.rudder.toFixed(3), steer: h.steer ?? 0, pull: h.pull ?? 0,
        hold: B.holdHeading == null ? null : +(((B.holdHeading * D) % 360 + 360) % 360).toFixed(1), fly: !!B.fly?.any, eng: e.state, lever: e.lever, u: +(s.u / 0.514444).toFixed(2), furl: +(s.furl ?? 0).toFixed(2), driven: B.driven });
      window.__mark = ''; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const mark = (m) => page.evaluate((m) => { window.__mark = m; }, m);
  const wait = (ms) => page.waitForTimeout(ms);
  const log = () => page.evaluate(() => window.__motorLog);
  // the longest run (wall s) of hands-off |yaw| over SPIN.rate between two marks' times
  const spinOf = (rows) => { let run = 0, longest = 0, peak = 0; for (let i = 1; i < rows.length; i++) { const r = rows[i], dt = r.wall - rows[i - 1].wall, y = Math.abs(r.yaw); peak = Math.max(peak, y); run = y > SPIN.rate && !r.steer ? run + dt : 0; longest = Math.max(longest, run); } return { longest, peak }; };

  // ---- Y: the sails down; she stops head to wind and the backing cloth drifts her astern ----
  await mark('Y'); await page.keyboard.press('KeyY');
  check(await page.waitForFunction(() => window.__velia.boat.sim.state.furl > 0.95, null, { timeout: 60000 }).then(() => true, () => false), 'Y: the crew takes the sails down');
  // ---- I, + + +: the engine, full ahead ----
  await mark('I'); await page.keyboard.press('KeyI'); await wait(1600);
  for (let k = 0; k < 3; k++) { await mark('+'); await page.keyboard.press('Equal'); await wait(150); }
  check((await page.evaluate(() => window.__velia.boat.sim.phys.engine.lever)) === 1, 'the lever at full ahead');
  await page.evaluate(() => { const s = window.__velia.boat.sim.phys.state; s.u = Math.min(s.u, -0.8); });   // the sternway the sails coming down left her, head to wind
  const t0 = (await log()).length;
  // ---- the sheet keys: S held past the stop, W held, taps ----
  await mark('S down'); await page.keyboard.down('KeyS'); await wait(2500); await mark('S up'); await page.keyboard.up('KeyS'); await wait(1500);
  await mark('W down'); await page.keyboard.down('KeyW'); await wait(1500); await mark('W up'); await page.keyboard.up('KeyW');
  for (let k = 0; k < 4; k++) { await mark('W tap'); await page.keyboard.press('KeyW'); await wait(200); await mark('S tap'); await page.keyboard.press('KeyS'); await wait(200); }
  await wait(9000);
  let rows = (await log()).slice(t0);
  const sp = spinOf(rows), last = rows.at(-1);
  check(sp.longest <= SPIN.s, `no spin after the keys (|yaw| over ${SPIN.rate}°/s for ${sp.longest.toFixed(1)} s, peak ${sp.peak.toFixed(1)}°/s)`);
  check(!rows.some((r) => r.fly), 'the sails down: the ease key lets nothing fly');
  check(last.hold != null, `the pilot holds a course (${last.hold}°)`);
  check(last.u > 2.5, `under way ahead (${last.u} kn)`);
  // ---- A held: the yaw follows the helm within 1 s ----
  const a0 = (await log()).length;
  await mark('A down'); await page.keyboard.down('KeyA'); await wait(1300); await mark('A up'); await page.keyboard.up('KeyA'); await wait(4000);
  rows = (await log()).slice(a0);
  const w0 = rows[0].wall, follow = rows.find((r) => r.yaw < -3);
  check(!!follow && follow.wall - w0 <= 1, `A: the yaw follows to port within 1 s (${follow ? (follow.wall - w0).toFixed(2) : '–'} s)`);
  const settle = rows.filter((r) => r.wall - w0 > 3.8);
  check(settle.length > 0 && settle.every((r) => Math.abs(r.yaw) < 3), `let go, the pilot settles her (|yaw| ${Math.max(...settle.map((r) => Math.abs(r.yaw))).toFixed(2)}°/s 2.5 s on)`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  if (fails) { const L = await log(); for (let i = 0; i < L.length; i += 6) console.log(JSON.stringify(L[i])); }
} finally { await browser.close(); }
console.log(fails ? `${fails} check(s) failed` : 'all checks pass');
process.exit(fails ? 1 : 0);
