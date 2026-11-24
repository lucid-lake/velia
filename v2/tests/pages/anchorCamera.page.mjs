// The anchor's bow look in real play (owner, 2026-11-18: "I just tested anchor in Sail mode, I did not see the camera move"). On
// the live Sail page at 1280 × 720 in the Boat view, as a player does it: J under way (the crew rounds her up first), the cockpit's
// ANCHOR switch clicked with the mouse under way, and J when she is already stopped with Reduce Motion on (the OS's).
// Each frame the probe reads the anchor's own turn (the views' pose in, v2/sim/seamanship.js camera() out) and the frame's camera
// (window.__velia.camera, after every later stage: the binoculars, Tessie's assist, the menu drift). Checks:
//   the frame's camera turns toward the bow within 7 s (the eye at least 5 m nearer the bow, aimed nearer it than the Boat view
//   is), the view on screen never turning faster than 15°/s while it runs (0.25 s windows), and no later stage pulls the frame's camera off it;
//   it holds while she lies to it (the anchor held, 10 s on), through a click on the water and a key (neither is a look);
//   a drag on the view hands it back (eased out).
// Run by `npm run test:pages:v2 -- anchorCamera` (LAKESHORE_BASE set), or node v2/tests/pages/anchorCamera.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const MAX_DEG_S = 15;

// the probe: per frame (real time) the anchor's own turn (deg), the frame camera's gap to the anchor's pose (deg), the aim's and the
// eye's relation to the bow, against the Boat view's pose
const PROBE = () => {
  const V = window.__velia, sea = V.sea;
  const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
  const unit = (d) => { const l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; };
  const dir = (p) => unit([p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]]);
  const bow = () => { const s = V.boat.sim.phys.state, b = sea.A.bowX; return [s.x + Math.sin(s.heading) * b, 0.2, s.z - Math.cos(s.heading) * b]; };
  window.__cam = [];
  const cam = sea.camera.bind(sea); let last = null;
  sea.camera = (dt, p) => { const o = cam(dt, p); last = { inP: { pos: p.pos.slice(), target: p.target.slice() }, outP: { pos: o.pos.slice(), target: o.target.slice() } }; return o; };
  const tick = () => {
    if (last) {
      const f = V.camera.fwd, e = V.camera.eye, F = [f[0], f[1], f[2]], E = [e[0], e[1], e[2]], b = bow(), bl = sea.bowLook;
      const toBowIn = unit([b[0] - last.inP.pos[0], b[1] - last.inP.pos[1], b[2] - last.inP.pos[2]]), toBow = unit([b[0] - E[0], b[1] - E[1], b[2] - E[2]]);
      window.__cam.push({ t: performance.now() / 1000, F, I: dir(last.inP), bow: !!bl, out: bl?.out ?? null, turn: ang(dir(last.inP), dir(last.outP)), gap: ang(dir(last.outP), F),
        aimIn: ang(dir(last.inP), toBowIn), aim: ang(F, toBow), dIn: Math.hypot(b[0] - last.inP.pos[0], b[2] - last.inP.pos[2]), d: Math.hypot(b[0] - E[0], b[2] - E[2]),
        phase: sea.state.anchor.phase, view: V.m4.views?.view });
      last = null;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function open(browser, { reduce = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: reduce ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); localStorage.removeItem('lakeshore.logbook.v1'); } catch { /* blocked */ } }, SEEN);
  // Sail at its own pace (2 ×, no ?speed): the Sail start, 11 m of water, a 5 m/s breeze
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&noload=1&chatter=0&windspeed=5&winddir=160`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.sea && window.__velia.m4?.ui?.station?.cockpit && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.evaluate(PROBE);
  return { ctx, page, errors };
}
const frames = (page) => page.evaluate(() => window.__cam.splice(0));
const until = (page, fn, ms) => page.waitForFunction(fn, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
// the view's turn rate on screen (deg/s: the frame camera's aim) over 0.25 s windows: frame noise averaged, a jolt kept
function maxRate(log, key = 'F') {
  let max = 0;
  for (let i = 0, j = 0; i < log.length; i++) {
    while (j < log.length && log[j].t - log[i].t < 0.25) j++;
    if (j >= log.length) break;
    const a = log[i][key], b = log[j][key], deg = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
    max = Math.max(max, deg / (log[j].t - log[i].t));
  }
  return max;
}

// one way of dropping it: drop(page) after the probe is on; then the ease, its rate, the hold, and the hand-back
async function anchorCase(browser, name, { reduce = false, under = true, drop }) {
  const { ctx, page, errors } = await open(browser, { reduce });
  if (reduce) check(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), `${name}: Reduce Motion on (the OS's)`);
  if (under) await page.evaluate(() => { window.__velia.boat.sim.phys.state.u = 2.5; });
  await page.waitForTimeout(400);
  await frames(page);
  const t0 = await page.evaluate(() => performance.now() / 1000);
  await drop(page);
  check(await until(page, () => !!window.__velia.sea.bowLook || window.__velia.sea.state.mode === 'anchor', 20000), `${name}: the anchor is on its way (${JSON.stringify(await page.evaluate(() => ({ mode: window.__velia.sea.state.mode, stopping: window.__velia.sea.stopping })))})`);
  if (!under) check(await until(page, () => !!window.__velia.sea.bowLook, 15000), `${name}: the bow look starts as it lets go`);
  await page.waitForTimeout(under ? 7500 : 7000);
  let log = await frames(page);
  const on = log.filter((f) => f.bow), at = log.at(-1) ?? {};
  const firstOn = on[0]?.t ?? null;
  check(on.length > 0 && firstOn - t0 < 8, `${name}: the bow look runs (from ${firstOn == null ? '-' : (firstOn - t0).toFixed(1)} s)`);
  check(at.turn > 20, `${name}: within 7 s of starting the view has turned toward the bow (${(at.turn ?? 0).toFixed(1)}° off the Boat view)`);
  check(at.aim < at.aimIn && at.d < at.dIn - 5, `${name}: aimed nearer the bow (${(at.aim ?? 0).toFixed(1)}° vs the Boat view's ${(at.aimIn ?? 0).toFixed(1)}°), the eye nearer it (${(at.d ?? 0).toFixed(1)} m vs ${(at.dIn ?? 0).toFixed(1)} m)`);
  const r1 = maxRate(log.filter((f) => f.bow));
  check(r1 <= MAX_DEG_S, `${name}: the view on screen never turns faster than ${MAX_DEG_S}°/s while it runs (max ${r1.toFixed(1)}°/s; the Boat view's own ${maxRate(log.filter((f) => f.bow), 'I').toFixed(1)}°/s)`);
  const gap1 = Math.max(0, ...log.map((f) => f.gap));
  check(gap1 < 1, `${name}: no later camera stage pulls the frame off it (max ${gap1.toFixed(2)}°)`);
  // it holds while she lies to it: held, then 10 s more; a click on the water and a key (C is the view: a harmless one is Digit0, N) are no look
  check(await until(page, () => window.__velia.sea.state.anchor.phase === 'held', 60000), `${name}: the anchor holds`);
  await page.mouse.click(640, 260);
  await page.keyboard.press('Digit0');
  await page.waitForTimeout(10000);
  log = log.concat(await frames(page));
  const hold = log.filter((f) => f.t > log.at(-1).t - 10);
  const minTurn = Math.min(...hold.map((f) => f.turn));
  check(hold.every((f) => f.bow && f.out == null) && minTurn > 20, `${name}: it stays at the bow while anchored, through a click on the water and a key (min ${minTurn.toFixed(1)}° over 10 s)`);
  const r2 = maxRate(log.filter((f) => f.bow)), gap2 = Math.max(0, ...log.map((f) => f.gap));
  check(r2 <= MAX_DEG_S && gap2 < 1, `${name}: still never faster than ${MAX_DEG_S}°/s (${r2.toFixed(1)}°/s), nothing over it (${gap2.toFixed(2)}°)`);
  // a drag on the view: the player's look, eased back
  await page.mouse.move(640, 300); await page.mouse.down(); await page.mouse.move(700, 300, { steps: 8 }); await page.mouse.up();
  check(await until(page, () => window.__velia.sea.bowLook?.out != null || !window.__velia.sea.bowLook, 3000), `${name}: a drag on the view hands it back`);
  check(errors.length === 0, `${name}: no page errors (${errors.slice(0, 2).join(' | ')})`);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  await anchorCase(browser, 'J under way', { drop: (page) => page.keyboard.press('KeyJ') });
  await anchorCase(browser, 'the cockpit\'s ANCHOR switch under way', { drop: async (page) => {
    const r = await page.evaluate(() => { const c = document.querySelector('.lk-cp .c[data-id=anchor]'); const b = c?.getBoundingClientRect(); if (!b) return null; const x = b.x + b.width / 2, y = b.y + b.height / 2; return { x, y, canvas: document.elementFromPoint(x, y)?.tagName === 'CANVAS', inView: y > 0 && y < innerHeight }; });
    check(!!r && r.inView && !r.canvas, `the ANCHOR switch is on screen and takes the click (${JSON.stringify(r)})`);
    await page.mouse.move(r.x, r.y); await page.waitForTimeout(200); await page.mouse.click(r.x, r.y);
  } });
  await anchorCase(browser, 'J stopped, Reduce Motion on', { reduce: true, under: false, drop: async (page) => {
    await page.evaluate(() => { const s = window.__velia.boat.sim.phys.state; Object.assign(s, { u: 0, v: 0, yawRate: 0, sog: 0 }); });
    await page.keyboard.press('KeyJ');
  } });
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
