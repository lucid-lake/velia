// The thumb zones round a phone's control rings (owner, 2026-11-17, a real iPhone: "In the area of our two control rings, it's too easy
// to mis-trigger the camera movement instead."; v2/ui/flat.js zonePick) under real CDP touches (hasTouch, isMobile, Safari's UA):
// 844 × 390 and 844 × 340 held sideways, and 390 × 844 and 340 × 844 held upright (the landscape page turned; the fingers land at
// __veliaTurn.toScreen). In each:
//   - a press that starts up to 28 px outside each ring's drawn outer edge (and on the strip under the notch) moves that ring, and the
//     canvas never sees the finger (no pointerdown on it, the camera not moved)
//   - a ring drag that slides off the ring, out over the water, keeps the ring until the finger lifts; the camera never moves
//   - a tap 20 px past the sheet ring's top half nudges the sheet in 2°
//   - a drag on the open water still turns the view; a second and third finger pinching the water never stop an active steer drag
//   - the corner quarters and "⋯" still tap (Auto; a tap in the screen's very corner is Auto's; ⋯ opens the drawer)
// --shots <dir>: a still with the zones overlaid (debug) per screen; --clip <dir>: a short clip with touch dots at 844 × 390.
// Run by `npm run test:pages:v2 -- ringGuard`, or node v2/tests/pages/ringGuard.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { arcHelm, arcAngle } from '../../ui/flat.js';

const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const BASE = opt('--base') ?? process.env.LAKESHORE_BASE, SHOTS = opt('--shots'), CLIP = opt('--clip');
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DEG = Math.PI / 180;
// [name, W, H, standalone, safe-area insets (screen frame)]
const MODES = [
  ['sideways 844x390', 844, 390, true, { top: 0, bottom: 21, left: 47, right: 47 }],
  ['sideways 844x340', 844, 340, false, null],
  ['turned 390x844', 390, 844, true, { top: 59, bottom: 34, left: 0, right: 0 }],
  ['turned 340x844', 340, 844, false, null],
];
// the zones and the fingers made visible (the evidence only; never in the game)
const DEBUG_CSS = 'div.lk-flat .zone{background:rgb(255 64 64 / .28)!important;outline:1px dashed rgb(255 120 120 / .9)}';
const DOTS = () => {
  const dots = new Map(), host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  document.body.appendChild(host);
  const put = (e) => { if (e.pointerType !== 'touch') return; let d = dots.get(e.pointerId); if (!d) { d = document.createElement('div'); d.style.cssText = 'position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgb(255 210 80 / .55);border:2px solid #fff;box-shadow:0 0 8px #000'; host.appendChild(d); dots.set(e.pointerId, d); } d.style.left = `${e.clientX}px`; d.style.top = `${e.clientY}px`; };
  const off = (e) => { const d = dots.get(e.pointerId); if (d) { d.remove(); dots.delete(e.pointerId); } };
  addEventListener('pointerdown', put, true); addEventListener('pointermove', put, true);
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, off, true);
};

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open([name, W, H, standalone, insets], record = null) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, ...(record ? { recordVideo: { dir: record, size: { width: W, height: H } } } : {}) });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (insets) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }).catch(() => {});
  if (standalone) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }).catch(() => {});
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&windspeed=7.7&once=0&noload=1&quality=1&kayaks=0&hud=full`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.flat?.on && window.__velia.m4.ui.flat.shown, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  // every press the canvas (the camera) sees
  await page.evaluate(() => { window.__canvasDowns = 0; document.querySelector('canvas')?.addEventListener('pointerdown', () => { window.__canvasDowns++; }); });
  const scr = (pts) => page.evaluate((p) => p.map(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y])), pts);
  // the fingers down now (id → layout point); every CDP event lists them all
  const down = new Map();
  const send = async (type) => { const ids = [...down.keys()], sp = ids.length ? await scr(ids.map((i) => down.get(i))) : []; await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: sp.map(([x, y], k) => ({ x, y, id: ids[k] })) }); };
  const fingerDown = async (id, p) => { down.set(id, p); await send('touchStart'); };
  const fingerMove = async (id, p) => { down.set(id, p); await send('touchMove'); await wait(16); };
  // CDP: a touchEnd lifts every finger; one finger lifts by a touchMove that leaves it out
  const fingerUp = async (id) => { down.delete(id); if (down.size) await send('touchMove'); else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const tap = async (p, holdMs = 70) => { await fingerDown(0, p); await wait(holdMs); await fingerUp(0); await wait(350); };
  const drag = async (pts, holdMs = 0) => { await fingerDown(0, pts[0]); for (const p of pts.slice(1)) await fingerMove(0, p); if (holdMs) await wait(holdMs); return async () => { await fingerUp(0); await wait(300); }; };
  return { ctx, page, cdp, errors, tap, drag, fingerDown, fingerMove, fingerUp, name };
}
const line = (x0, y0, x1, y1, n = 10) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const ptAt = (p, a, r) => [p.x + p.side * r * Math.cos(a * DEG), p.y - r * Math.sin(a * DEG)];
const arc = (p, r, a0, a1, n = 10) => Array.from({ length: n + 1 }, (_, i) => ptAt(p, a0 + (a1 - a0) * i / n, r));

try {
  for (const mode of MODES) {
    const record = CLIP && mode[0] === 'sideways 844x390' ? join(CLIP, 'raw') : null;
    if (record) mkdirSync(record, { recursive: true });
    const t = await open(mode, record);
    const { page, tap, drag, fingerDown, fingerMove, fingerUp, name } = t;
    if (record || SHOTS) await page.evaluate(DOTS);
    const F = () => page.evaluate(() => { const f = window.__velia.m4.ui.flat, B = window.__velia.boat.sim, r = window.__velia.boat.row(); return { helm: f.helm, auto: f.auto, rudder: r.rudder, sheet: B.state.mainSheet / Math.PI * 180, drawer: f.drawer, cam: f.camera, yaw: B.follow.yaw, pitch: B.follow.pitch, dist: B.follow.dist, heading: B.state.heading, downs: window.__canvasDowns }; });
    const L = await page.evaluate(() => window.__velia.m4.ui.flat.layout);
    const turned = await page.evaluate(() => !!window.__veliaTurn?.rotated());
    check(turned === (mode[2] > mode[1]), `${name}: the page is ${mode[2] > mode[1] ? '' : 'not '}turned (layout ${L.w}×${L.h}, zones r ${L.zones.l.r.toFixed(0)} / ${L.zones.r.r.toFixed(0)}, rings to ${L.steer.r1} / ${L.main.r1})`);
    if (SHOTS) {
      await page.addStyleTag({ content: DEBUG_CSS }); await wait(300);
      await page.screenshot({ path: join(SHOTS, `zones-${name.replace(/\W+/g, '-')}.png`) });
      if (!record) await page.evaluate(() => document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('.zone{background:rgb(255 64 64')) s.remove(); }));
    }
    // the hit test: a point 20 px past each ring's edge is the zone's, not the canvas's
    const hit = await page.evaluate(([a, b]) => [a, b].map(([x, y]) => document.elementFromPoint(x, y)?.className ?? null), [ptAt(L.pl, 45, L.steer.r1 + 20), ptAt(L.pr, 45, L.main.r1 + 20)]);
    check(hit.every((c) => /zone/.test(String(c))), `${name}: 20 px past either ring the finger lands on the controls' zone (${hit.join(', ')})`);
    const camStill = (a, b) => b.downs === a.downs && !b.cam.moved && Math.abs(b.pitch - a.pitch) < 1e-4 && Math.abs(b.dist - a.dist) < 1e-3;

    // the steer ring, pressed up to 28 px outside its drawn edge, at three angles: a clockwise sweep turns her to starboard
    const outL = L.zones.l.r - L.steer.r1 - 2, outR = L.zones.r.r - L.main.r1 - 2;   // 2 px inside the zone's edge (CDP rounds a touch to the pixel)
    for (const [a, out] of [[60, Math.min(28, outL)], [35, Math.min(14, outL)], [80, Math.min(28, outL)]]) {
      await page.evaluate(() => window.__velia.boat.sim.setPilot(false));
      const s0 = await F(), pts = arc(L.pl, L.steer.r1 + out, a, a - 22);
      await fingerDown(0, pts[0]); await wait(60); const h0 = (await F()).helm;   // the wheel at the rudder she has
      for (const p of pts.slice(1)) await fingerMove(0, p);
      await wait(900); const s1 = await F(); await fingerUp(0); await wait(300); const s2 = await F();
      const want = h0 == null ? null : arcHelm(h0, a, a - 22), turns = want != null && want > h0 + 0.2;
      check(want != null && Math.abs(s1.helm - want) < 0.05 && (!turns || s1.rudder > s0.rudder + 0.04) && camStill(s0, s2), `${name}: ${out.toFixed(0)} px outside the steer ring at ${a}°, a clockwise sweep steers (helm ${h0?.toFixed(2)} → ${s1.helm?.toFixed(2)}, want ${want?.toFixed(2)}; rudder ${s0.rudder.toFixed(3)} → ${s1.rudder.toFixed(3)}), the camera untouched (canvas presses ${s2.downs - s0.downs}, moved ${s2.cam.moved})`);
      check(s2.helm === null, `${name}: let go: the hand off the helm`);
    }
    // the strip between the screen's edge and the steer ring (the notch side): a press there steers too
    { const s0 = await F(); const y0 = L.pl.y - L.steer.r, up = await drag(line(Math.max(2, L.pl.x - 30), y0, Math.max(2, L.pl.x - 30) + 30, y0 - 50, 10), 900); const s1 = await F(); await up(); const s2 = await F();
      check(s1.helm !== null && camStill(s0, s2), `${name}: a press on the edge strip beside the steer ring takes the ring (helm ${s1.helm?.toFixed(2)}), never the camera`); }
    // the sheet ring, pressed outside its drawn edge: a drag up pulls in, down eases
    for (const [a, out] of [[20, Math.min(28, outR)], [50, Math.min(20, outR)]]) {
      const s0 = await F();
      let up = await drag(arc(L.pr, L.main.r1 + out, a, a + 25), 300); const s1 = await F(); await up();
      up = await drag(arc(L.pr, L.main.r1 + out, a + 25, a - 5), 300); const s2 = await F(); await up(); const s3 = await F();
      check(s1.sheet < s0.sheet - 8 && s2.sheet > s1.sheet + 8 && camStill(s0, s3), `${name}: ${out.toFixed(0)} px outside the sheet ring at ${a}°, up pulls in and down eases (${s0.sheet.toFixed(1)}° → ${s1.sheet.toFixed(1)}° → ${s2.sheet.toFixed(1)}°), the camera untouched (canvas presses ${s3.downs - s0.downs})`);
    }
    // a tap 20 px past the sheet ring's top half nudges in 2°
    { const n0 = await F(); await tap(ptAt(L.pr, L.main.a1 - 12, L.main.r1 + Math.min(20, outR))); const n1 = await F();
      check(Math.abs(n0.sheet - n1.sheet - 2) < 0.6 && camStill(n0, n1), `${name}: a tap just past the sheet ring's top half nudges in 2° (${n0.sheet.toFixed(1)} → ${n1.sheet.toFixed(1)}), no camera`); }
    // a steer drag that slides off the ring, out over the water, keeps the ring until the finger lifts
    {
      await page.evaluate(() => window.__velia.boat.sim.setPilot(false));
      const s0 = await F();
      // the ring takes the wheel at the rudder she has (h0, read at the press), so the helm off the ring is h0 plus the sweep to
      // where the finger is now (arcHelm), not a fixed value: with no hand on it the boat's own assists move the rudder (after the sheet
      // drags she sits at full port: the shoal bear-away, by elimination: no pilot, tack, carry or FREE)
      const path = [...arc(L.pl, L.steer.r, 45, 40, 3), ...line(ptAt(L.pl, 40, L.steer.r)[0], ptAt(L.pl, 40, L.steer.r)[1], L.w * 0.5, L.h * 0.55, 14)];
      await fingerDown(0, path[0]); await wait(60); const h0 = (await F()).helm;
      for (const p of path.slice(1)) await fingerMove(0, p);
      await wait(600); const s1 = await F(); await fingerUp(0); await wait(300); const s2 = await F();
      const end = path[path.length - 1], want = h0 == null ? null : arcHelm(h0, 45, arcAngle(L.pl, end[0], end[1]));
      check(s1.helm !== null && want != null && Math.abs(s1.helm - want) < 0.05 && camStill(s0, s2), `${name}: a steer drag that leaves the ring for the water keeps steering: the helm follows the finger off the ring (${h0?.toFixed(2)} at the press → ${s1.helm?.toFixed(2)}, want ${want?.toFixed(2)}) and the camera stays (canvas presses ${s2.downs - s0.downs}, moved ${s2.cam.moved})`);
      check(s2.helm === null, `${name}: the lift ends it`);
      const m0 = await F();
      const up2 = await drag([...arc(L.pr, L.main.r, 30, 40, 3), ...line(ptAt(L.pr, 40, L.main.r)[0], ptAt(L.pr, 40, L.main.r)[1], L.w * 0.75, L.h * 0.12, 14)], 300); const m1 = await F(); await up2(); const m2 = await F();
      check(m1.sheet < m0.sheet - 5 && camStill(m0, m2), `${name}: a sheet drag that leaves the ring keeps trimming (${m0.sheet.toFixed(1)}° → ${m1.sheet.toFixed(1)}°), no camera`);
    }
    // a second and third finger pinching the water never take an active steer drag
    {
      await page.evaluate(() => window.__velia.boat.sim.setPilot(false));
      await fingerDown(0, ptAt(L.pl, 45, L.steer.r)); await wait(60); const ph0 = (await F()).helm;
      await fingerMove(0, ptAt(L.pl, 43, L.steer.r)); await fingerMove(0, ptAt(L.pl, 40, L.steer.r)); await wait(200);
      const p0 = await F();
      const cx = L.w * 0.55, cy = L.h * 0.4;
      await fingerDown(1, [cx - 40, cy]); await fingerDown(2, [cx + 40, cy]);
      for (let i = 1; i <= 8; i++) { await fingerMove(1, [cx - 40 - i * 8, cy]); await fingerMove(2, [cx + 40 + i * 8, cy]); }
      const p1 = await F();
      for (let i = 1; i <= 8; i++) await fingerMove(0, ptAt(L.pl, 40 - i * 2.5, L.steer.r));
      await wait(300); const p2 = await F();
      await fingerUp(2); await fingerUp(1); await wait(100); const p3 = await F(); await fingerUp(0); await wait(300); const p4 = await F();
      const pw = ph0 == null ? null : arcHelm(ph0, 45, 20);   // the helm the steer finger asks for at 20°, from the rudder at the press
      check(p1.helm !== null && pw != null && Math.abs(p2.helm - pw) < 0.05 && p3.helm !== null, `${name}: a pinch on the water during a steer drag leaves the ring in hand (helm ${ph0?.toFixed(2)} at the press → ${p0.helm?.toFixed(2)} → ${p2.helm?.toFixed(2)}, want ${pw?.toFixed(2)}, still held after the pinch lifts: ${p3.helm !== null})`);
      check(Math.abs(p1.dist - p0.dist) > 1e-3, `${name}: the pinch itself zooms (${p0.dist.toFixed(2)} → ${p1.dist.toFixed(2)})`);
      check(p4.helm === null, `${name}: the steer finger's lift lets go`);
      await page.evaluate(() => window.__velia.m4.ui.flat.recentre()); await wait(1200);
    }
    // the open water: a one-finger drag still turns the view, past a small slop, and never steers
    {
      await page.evaluate(() => window.__velia.boat.sim.setPilot(true));
      const w0 = await F();
      const up = await drag(line(L.w * 0.45, L.h * 0.45, L.w * 0.45 + 160, L.h * 0.45 + 10, 16), 300); const w1 = await F(); await up();
      const dy = Math.abs(Math.atan2(Math.sin(w1.yaw - w0.yaw), Math.cos(w1.yaw - w0.yaw))) / DEG;
      check(dy > 15 && w1.helm === null && w1.downs > w0.downs, `${name}: a drag on the open water turns the view ${dy.toFixed(0)}° (canvas presses ${w1.downs - w0.downs}), not the rudder`);
      // a drag just past the zone (open water) is the camera's too
      const z0 = await F(); const pz = ptAt(L.pl, 45, L.zones.l.r + 12);
      const up2 = await drag(line(pz[0], pz[1], pz[0] + 120, pz[1] - 20, 12), 200); const z1 = await F(); await up2();
      check(z1.downs > z0.downs && z1.helm === null, `${name}: 12 px past the left zone is the water's (canvas presses ${z1.downs - z0.downs})`);
      await page.evaluate(() => window.__velia.m4.ui.flat.recentre()); await wait(1200);
    }
    // the corners and ⋯ still tap
    {
      // Auto is NAV (ui/autopilot.js: pilot.engaged, the flat's own `auto`); B.assists.pilot is steady hands now, which the page sets
      // every frame from the profile (ui/steadyHands.js), so it no longer says whether Auto is on
      await page.evaluate(() => { const P = window.__velia.m4.ui.services.get('pilot'); if (P?.engaged) P.release(); }); await wait(200);
      const a0 = await F(); await tap([L.pl.x + L.q * 0.35, L.pl.y - L.q * 0.35]); const a1 = await F();
      check(!a0.auto && a1.auto && camStill(a0, a1), `${name}: a tap on Auto engages it (${a0.auto} → ${a1.auto})`);
      await tap([2, L.h - 2]); const a2 = await F();
      check(!a2.auto && camStill(a1, a2), `${name}: a tap in the screen's very corner is Auto's (off again: ${a2.auto})`);
      await tap([L.more.x, L.more.y]); const d1 = await F();
      check(d1.drawer && camStill(a2, d1), `${name}: ⋯ opens the drawer`);
      await tap([L.w / 2, L.h - 12]); const d2 = await F();
      check(!d2.drawer, `${name}: a tap outside closes it`);
    }
    check(t.errors.length === 0, `${name}: no page errors${t.errors.length ? `: ${t.errors.slice(0, 2).join(' | ')}` : ''}`);
    const video = record ? page.video() : null;
    await t.ctx.close();
    if (video) { const p = await video.path(); const out = join(CLIP, 'ring-guard-844x390.webm'); renameSync(p, out); console.log(`clip: ${out}`); }
  }
} finally {
  await browser.close();
}
if (CLIP) for (const f of readdirSync(join(CLIP, 'raw'), { withFileTypes: true }).filter((d) => d.isFile())) console.log(`left in raw: ${f.name}`);
console.log(fails ? `${fails} check(s) failed` : 'all checks pass');
process.exit(fails ? 1 : 0);
