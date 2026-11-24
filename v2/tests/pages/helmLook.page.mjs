// The helm view's look on the live v2 page (owner, 2026-11-13: "in helm view, unlike v1, I can no longer use mouse to update
// view"): v1's deck (src/deck/index.js) on v2's hands (v2/ui/touch.js → v2/sim/boat.js camera() → v2/ui/views.js → v1's helm
// camera, src/sim/boat/helmCamera.js).
//   helm view  a mouse drag on the canvas looks round (0.005 rad/px, right = starboard), the follow camera stays where it was; the
//              right button drags too; let go: 3 s, then the look eases back to the bow; the wheel zooms the lens (30–70°)
//   follow     a drag orbits the follow camera and leaves the helm camera alone; a drag that starts on the cockpit's wheel steers
//              the boat and never orbits (the cockpit's own hit layer: DOM above the canvas)
//   a press under 5 px is a click, not a look
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/helmLook.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
const frames = (page, n = 3) => page.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const cam = (page) => page.evaluate(() => { const V = window.__velia, h = V.m4.views.helmCam; return { view: V.m4.views.view, k: V.m4.views.k, yawT: h.yawT, pitchT: h.pitchT, yaw: h.yaw, zoom: h.zoom, followYaw: V.boat.sim.follow.yaw, heading: V.boat.sim.state.heading, chase: V.boat.sim.follow.chase }; });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// a mouse drag in small steps (each a pointermove), then hold for holdMs before letting go (or not)
// the follow camera's inputs: how many frames it was given an orbit (its own update, wrapped once)
const orbits = (page) => page.evaluate(() => { const f = window.__velia.boat.sim.follow; if (!f.__wrapped) { const u = f.update.bind(f); f.update = (dt, p, o) => { if (o?.orbit) f.__orbits = (f.__orbits ?? 0) + 1; return u(dt, p, o); }; f.__wrapped = true; } return f.__orbits ?? 0; });
async function drag(page, x0, y0, dx, dy, { button = 'left', steps = 10, release = true } = {}) {
  await page.mouse.move(x0, y0); await page.mouse.down({ button });
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps); await frames(page, 1); }
  if (release) { await frames(page, 2); await page.mouse.up({ button }); }
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=12&once=0&noload=1&fv=1&hm=0&chatter=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station?.cockpit && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });

  // ---- the follow view: a drag orbits the follow camera, the helm camera is untouched ----
  let a = await cam(page);
  await drag(page, 640, 260, 120, 0);
  let b = await cam(page);
  check(Math.abs(wrap(b.followYaw - a.followYaw)) > 0.3 && b.yawT === 0, `follow: a 120 px drag orbits the follow camera (${wrap(b.followYaw - a.followYaw).toFixed(3)} rad), the helm camera's look stays 0 (${b.yawT})`);
  // a drag that starts on the cockpit's wheel steers, never orbits
  const wheel = await page.evaluate(() => { const r = document.querySelector('.lk-helm .pad.wheel').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.3, w: r.width }; });
  let o0 = await orbits(page);
  await drag(page, wheel.x - wheel.w * 0.3, wheel.y, wheel.w * 0.5, 0, { release: false });
  const steer = await page.evaluate(() => window.__velia.m4.ui.station.steer);
  await page.mouse.up();
  let o1 = await orbits(page);
  check(steer != null && o1 === o0, `follow: a drag on the cockpit's wheel steers (steer ${steer?.toFixed?.(2)}) and never reaches the camera (${o1 - o0} orbit frames)`);

  // ---- the helm view ----
  await page.evaluate(() => window.__velia.m4.ui.views.set('helm'));
  await page.waitForFunction(() => window.__velia.m4.views.k >= 1, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  a = await cam(page);
  check(a.view === 'helm' && a.yawT === 0, `the helm view, looking at the bow (${a.yawT})`);
  // a click (under 5 px) is not a look
  await page.mouse.move(640, 300); await page.mouse.down(); await page.mouse.move(643, 301); await frames(page, 2); await page.mouse.up(); await frames(page, 2);
  check((await cam(page)).yawT === 0, 'a press under 5 px is a click: no look');
  // a drag right 160 px and up 50: 0.8 rad to starboard, 0.2 up; the follow camera does not orbit
  o0 = await orbits(page);
  await drag(page, 600, 300, 160, -50, { release: false });
  await page.waitForTimeout(400);
  b = await cam(page); o1 = await orbits(page);
  check(Math.abs(b.yawT - 0.8) < 0.03 && Math.abs(b.pitchT - 0.2) < 0.03, `helm: the drag looks right and up (yaw ${b.yawT.toFixed(3)}, pitch ${b.pitchT.toFixed(3)} rad; v1: 0.005 and 0.004 rad/px)`);
  check(Math.abs(b.yaw - b.yawT) < 0.05, `the view follows the hand (eased over 0.12 s: ${b.yaw.toFixed(3)})`);
  check(o1 === o0, `helm: the follow camera is given no orbit under the drag (${o1 - o0} frames)`);
  // held still for 3.5 s: the look stays (a hand on the mouse)
  await page.waitForTimeout(3500);
  check(Math.abs((await cam(page)).yawT - 0.8) < 0.03, 'held still: the look stays while the button is down');
  await page.mouse.up();
  await page.waitForTimeout(2000);
  check(Math.abs((await cam(page)).yawT - 0.8) < 0.03, 'let go: the look holds for 3 s');
  await page.waitForFunction(() => Math.abs(window.__velia.m4.views.helmCam.yawT) < 0.05, null, { timeout: 15000 }).then(() => check(true, 'then it eases back to the bow'), () => check(false, 'then it eases back to the bow'));
  // the limits: 120° to port
  await drag(page, 1000, 300, -900, 0, { steps: 15 });
  check(Math.abs((await cam(page)).yawT + 120 * Math.PI / 180) < 0.01, `the look stops at 120° to port (${((await cam(page)).yawT * 180 / Math.PI).toFixed(1)}°)`);
  // the right button drags too
  const y0 = (await cam(page)).yawT;
  await drag(page, 400, 300, 100, 0, { button: 'right' });
  check(Math.abs((await cam(page)).yawT - y0 - 0.5) < 0.03, `the right button drags too (${((await cam(page)).yawT - y0).toFixed(3)} rad)`);
  // the wheel zooms the lens: v1's exp(deltaY × 0.001), clamped to 30–70°
  const z0 = (await cam(page)).zoom;
  await page.mouse.move(640, 300); await page.mouse.wheel(0, -200); await frames(page, 3);
  const z1 = (await cam(page)).zoom;
  check(Math.abs(z1 / z0 - Math.exp(-0.2)) < 0.02, `the wheel narrows the lens (zoom ${z0.toFixed(3)} → ${z1.toFixed(3)})`);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -400);
  await frames(page, 3);
  check(Math.abs((await cam(page)).zoom - 30 / 55) < 1e-3, `down to v1's 30° (${(await cam(page)).zoom.toFixed(3)})`);
  // back to the follow view: the drag orbits again
  await page.evaluate(() => window.__velia.m4.ui.views.set('follow'));
  await page.waitForFunction(() => window.__velia.m4.views.k <= 0, null, { timeout: 10000 });
  a = await cam(page);
  await drag(page, 640, 260, -100, 0);
  b = await cam(page);
  check(Math.abs(wrap(b.followYaw - a.followYaw) + 0.5) < 0.1, `follow again: the drag orbits (${wrap(b.followYaw - a.followYaw).toFixed(3)} rad)`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
  await page.close();
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
