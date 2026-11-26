// The fireworks in an open world (owner, 2026-11-15: "fireworks on means fireworks on, the boat is independent … like a true
// open world game"; Cruise: "we might just have a camera to look at that fireworks angle"), on live v2 pages:
//   Sail in the show   the boat starts at the show's own deep-water spot facing it (the show off: the general start), the follow camera as with the show
//                      off (no tilt, no wider lens), the helm in the player's hands (a key turns the rudder); the show plays
//                      at its own site; across 21:44 the day clock keeps its rate, no line is said, the wind stays sailable
//   Cruise in the show (the default camera: the Boat view since 2026-11-15) the autopilot's route is the one it sails with the show off; the camera eases toward the bursts (never
//                      at once), a drag (the player's look) lets it go; after the finale it eases back; the show plays at
//                      its own pace (about a show s a real s), not on Cruise's quick day clock
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/fireworksOpen.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const SHOW0 = 21 + 44 / 60;   // show time 0 (4 game s a show s)
const hourAt = (t) => SHOW0 + t * 4 / 3600;
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  // the boat's pose at the loading card's ready (the first frame)
  await page.addInitScript(() => { let cur = null; window.__atReady = null; Object.defineProperty(window, '__veliaLoading', { configurable: true, get: () => cur, set: (v) => { cur = v; const r = v?.ready; if (v) v.ready = function () { const V = window.__velia, s = V?.boat?.state; window.__atReady ??= s ? { x: s.x, z: s.z, h: s.heading, fw: !!V.fireworks } : {}; return r?.call(this); }; } }); });
  await page.goto(`${BASE}/?${query}&seed=1&attract=0&music=0&fwsound=0&once=0&kayaks=0`, { waitUntil: 'load' });
  return { page, errors };
}
const S = (page) => page.evaluate(() => {
  const V = window.__velia, st = V._stats(), f = V.boat.sim.follow;
  return { mode: st.mode, cam: st.cam, x: V.boat.state.x, z: V.boat.state.z, rudder: V.boat.sim.ctl?.rudder ?? null, lookBias: f?.lookBias ?? 0, fovBias: f?.fovBias ?? 0,
    view: V.m4?.views?.view ?? null, fw: st.fireworks, c: st.cruise, fwd: [...V.camera.fwd], eye: [...V.camera.eye], hour: V.clock.hour };
});
const bearing = (fwd) => ((Math.atan2(fwd[0], -fwd[2]) * 180 / Math.PI) + 360) % 360;
const SHOW_C = [1134.84, -850.37];
const bearingTo = (eye) => ((Math.atan2(SHOW_C[0] - eye[0], -(SHOW_C[1] - eye[1])) * 180 / Math.PI) + 360) % 360;
const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const drag = async (page) => { await page.mouse.move(640, 400); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(640 + i * 25, 400, { steps: 2 }); await page.mouse.up(); };

try {
  // ---------------- Sail in the show: nothing moves the boat or the camera ----------------
  {
    const on = await open(`mode=sail&hour=${hourAt(60).toFixed(5)}&fireworks=1`);
    const offP = await open(`mode=sail&hour=${hourAt(60).toFixed(5)}&fireworks=0`);
    for (const p of [on, offP]) await p.page.waitForFunction(() => window.__velia?.ready === true && window.__atReady != null && window.__velia.m4?.ui, null, { timeout: 240000, polling: 200 });
    const a = await on.page.evaluate(() => window.__atReady), b = await offP.page.evaluate(() => window.__atReady);
    // the show's evening start faces the barges past the mouth (owner, 2026-11-18); 18° to starboard of the show since
    // fix/v2-fireworks-view-clouds, so the show stands beside the mast in the Boat view, not behind it (the evening's wind from 195°
    // keeps her 116° off it, clear of the 50° irons guard). Round 2 (coordinator 2026-11-18: deep water, safety stays): the show's own
    // start moved off the general start's 1–3 m shelf, where the shoal assist bore her away from the show within 10 s, to
    // SHOW_START (825, −825; 16.6 m or more for 500 m ahead): the show off keeps the general start (1200, −1050)
    const dh = Math.abs(Math.atan2(Math.sin(a.h - b.h), Math.cos(a.h - b.h)));
    // since the birthplaces (2026-11-18) the show off starts at the first visit's birthplace, Off Fannette (210, 50)
    check(a.fw && !b.fw && Math.abs(a.x - 825) < 0.01 && Math.abs(a.z + 825) < 0.01 && Math.abs(b.x - 210) < 0.01 && Math.abs(b.z - 50) < 0.01, `Sail: in the show she starts at the show's deep-water spot, the show off at the first visit's birthplace (${JSON.stringify({ on: a, off: b })})`);
    check(Math.abs(a.h * 180 / Math.PI - 77.4) < 3 && dh > 0.1, `Sail: in the show she starts 18° off the barges past the mouth, the show beside the mast (heading ${(a.h * 180 / Math.PI).toFixed(1)}°)`);
    await on.page.waitForTimeout(3000);
    const s = await S(on.page), t = await S(offP.page);
    check(s.fw?.showT != null && s.fw.showT > 55 && s.fw.spawned > 0 && s.fw.peak > 0, `Sail: the show plays at its site (${JSON.stringify({ showT: s.fw?.showT, spawned: s.fw?.spawned, peak: s.fw?.peak })})`);
    check(s.cam === t.cam && s.cam === 'follow' && s.view === t.view && s.lookBias === 0 && s.fovBias === 0, `Sail: the camera as with the show off (${JSON.stringify({ on: [s.cam, s.view, s.lookBias, s.fovBias], off: [t.cam, t.view] })})`);
    check(s.mode === 'sail' && s.fw.showFrame === 0, `Sail: no show framing (${s.fw.showFrame})`);
    const r0 = (await S(on.page)).rudder;
    await on.page.keyboard.down('ArrowLeft'); await on.page.waitForTimeout(700); const r1 = (await S(on.page)).rudder; await on.page.keyboard.up('ArrowLeft');
    check(r1 != null && Math.abs(r1 - r0) > 0.05, `Sail: the helm is the player's in the show (rudder ${r0?.toFixed(3)} → ${r1?.toFixed(3)})`);
    check(on.errors.length === 0 && offP.errors.length === 0, `Sail: no page errors (${[...on.errors, ...offP.errors].slice(0, 2).join(' | ')})`);
    await on.page.close(); await offP.page.close();
  }
  // ---------------- Sail across 21:44: a time event (owner, 2026-11-15): the day clock's own rate, no lines, a sailable wind ----------------
  {
    const { page, errors } = await open('mode=sail&hour=21.7&fireworks=1&wind=3');
    await page.waitForFunction(() => window.__velia?.ready === true && window.__velia.m4?.ui && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000, polling: 200 });
    const rows = [], lines = new Set();
    for (let i = 0; i < 40; i++) {
      rows.push(await page.evaluate(() => { const V = window.__velia, st = V._stats(); return { hour: V.clock.hour, rate: V.clock.rate, cuts: V.clock.cuts, showT: st.fireworks?.showT ?? null, tws: V.boat.state.trueWind?.speed ?? null, base: V.stats().wind?.speedMs ?? null, hs: V.stats().wind?.hsM ?? null, cam: st.cam }; }));
      lines.add((await page.evaluate(() => window.__velia.m4.ui.hint.el.textContent)).trim());
      await page.waitForTimeout(250);
    }
    const crossed = rows.some((r) => r.showT != null && r.showT > 0) && rows[0].hour < SHOW0 + 0.01;
    check(crossed, `Sail: the show starts on the day clock (${rows.filter((_, i) => i % 8 === 0).map((r) => `${r.hour.toFixed(3)}:${r.showT?.toFixed(1)}`).join(' ')})`);
    check(rows.every((r) => r.rate > 5 && r.rate < 10.5 && r.cuts === 0), `Sail: the clock keeps its own rate, no lapse, no hold (${Math.min(...rows.map((r) => r.rate)).toFixed(2)}–${Math.max(...rows.map((r) => r.rate)).toFixed(2)} game s per sim s)`);
    const L = [...lines].filter(Boolean);
    check(!L.some((t) => /night passes|anchor at the mouth|fireworks off|see it best/i.test(t)), `Sail: no show lines, no "The night passes…" (${JSON.stringify(L)})`);
    // the bay's base holds level 3's band (13 kn and up) and the sea keeps its waves (the start spot itself is in the walls' lee
    // at any hour: about 3 m/s at the boat at 20:00 too)
    check(rows.every((r) => r.base != null && r.base >= 13 * 0.5144 && r.hs > 0.2), `Sail: a sailable wind through the show (level 3: the bay's base ${Math.min(...rows.map((r) => r.base)).toFixed(2)} m/s, Hs ${Math.min(...rows.map((r) => r.hs)).toFixed(2)} m at least; ${Math.min(...rows.map((r) => r.tws)).toFixed(2)} m/s at the boat in the lee)`);
    check(rows.every((r) => r.cam === 'follow'), 'Sail: the follow camera throughout');
    check(errors.length === 0, `Sail across: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- Cruise in the show: the route unchanged, the camera eased toward the show; a drag wins ----------------
  {
    const q = `mode=cruise&hour=${hourAt(30).toFixed(5)}`;
    const on = await open(`${q}&fireworks=1`), offP = await open(`${q}&fireworks=0`);
    for (const p of [on, offP]) await p.page.waitForFunction(() => window.__velia?.cruise?.c?.on && window.__velia.m4?.ui, null, { timeout: 240000, polling: 200 });
    check((await on.page.evaluate(() => window.__velia.cruise.stats().view)) === 'astern', 'Cruise: the show from the default camera, the Boat view (owner, 2026-11-15)');
    const ws = [], w0 = await on.page.evaluate(() => [window.__velia._stats().fireworks.showT, performance.now() / 1000]);
    for (let i = 0; i < 16; i++) { const s = await S(on.page); ws.push(s.fw.showFrame); await on.page.waitForTimeout(250); }
    const a = await S(on.page), b = await S(offP.page);
    const w1 = await on.page.evaluate(() => [window.__velia._stats().fireworks.showT, performance.now() / 1000]), pace = (w1[0] - w0[0]) / (w1[1] - w0[1]);
    check(pace > 0.6 && pace < 1.6, `Cruise: the show at its own pace, about a show s a real s (${pace.toFixed(2)}; Cruise's day clock alone ran it about 20 ×)`);
    const jumps = ws.slice(1).map((w, i) => w - ws[i]);
    check(ws[0] < 0.9 && ws.at(-1) > 0.99 && Math.max(...jumps) < 0.5, `Cruise: the camera eases toward the show, never at once (${ws.map((w) => w.toFixed(2)).join(' ')})`);
    check(off(bearing(a.fwd), bearingTo(a.eye)) < 20 && a.fwd[1] > 0.05, `Cruise: framed on the show (camera ${bearing(a.fwd).toFixed(0)}°, show ${bearingTo(a.eye).toFixed(0)}°, up ${a.fwd[1].toFixed(2)})`);
    check(a.c.on && a.c.helm === 'cruise' && a.c.target === b.c.target, `Cruise: the autopilot's route is the one it sails with the show off (target ${a.c.target} vs ${b.c.target})`);
    await drag(on.page); await on.page.waitForTimeout(1500);
    const d = await S(on.page);
    check(d.fw.showYield === true && d.fw.showFrame < 0.05 && d.c.helm === 'cruise', `Cruise: a drag (the player's look) wins (weight ${d.fw.showFrame}, yield ${d.fw.showYield}, helm ${d.c.helm})`);
    check(on.errors.length === 0 && offP.errors.length === 0, `Cruise: no page errors (${[...on.errors, ...offP.errors].slice(0, 2).join(' | ')})`);
    await on.page.close(); await offP.page.close();
  }
  // ---------------- Cruise after the finale: the camera eases back ----------------
  {
    // the page opens in the show; once Cruise sails and the camera is framed, the clock is cut to near the finale (the
    // loading's length must not decide where in the show the page is)
    const { page, errors } = await open(`mode=cruise&hour=${hourAt(30).toFixed(5)}&fireworks=1`);
    await page.waitForFunction(() => window.__velia?.cruise?.c?.on && window.__velia.m4?.ui, null, { timeout: 240000, polling: 200 });
    const up = await page.waitForFunction(() => window.__velia._stats().fireworks?.showFrame > 0.99, null, { timeout: 15000, polling: 100 }).then(() => true, () => false);
    await page.evaluate((h) => window.__velia.clock.setHour(h), hourAt(298));
    const ws = [];
    for (let i = 0; i < 60; i++) { const s = await S(page); ws.push([s.fw.showT, s.fw.showFrame]); if (s.fw.showFrame === 0 && (s.fw.showT == null || s.fw.showT > 300)) break; await page.waitForTimeout(200); }
    const last = ws.at(-1), steps = ws.slice(1).map((w, i) => Math.abs(w[1] - ws[i][1]));
    check(up && last[1] === 0 && Math.max(...steps) < 0.5 && ws.filter(([, w]) => w > 0 && w < 1).length >= 3, `Cruise: after the finale the camera eases back (${ws.filter((_, i) => i % 2 === 0).map(([t, w]) => `${t?.toFixed(1)}:${w.toFixed(2)}`).join(' ')})`);
    check(errors.length === 0, `Cruise after: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
