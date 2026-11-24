// The mode switch on a live v2 page: Sail → Cruise (by the button) → Regatta →
// Sail, and after each switch the engine (the same object everywhere), the clock's rate, the game speed, Pro, the keys and the
// pilot. The top bar's Cruise ⇄ Sail button (owner, 2026-11-18; the ` key went 2026-11-20): in place, the same boat (position, heading, speed, clock, no
// veil), the button reads where it goes and is not shown in a race. In Sail the keys reach the boat (R the jib sheet in Pro only, the Pro trim keys; G and H + 6 do nothing) and the lessons (key steering,
// the sheet); Pro saved and a settings write turning it on and off live.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/modeSwitch.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });

// the state after a switch
const S = (page) => page.evaluate(() => {
  const V = window.__velia, B = V.boat.sim, ui = V.m4.ui, c = V.cruise.c, r = V.regatta.r, s = B.state;
  let stored = null; try { stored = JSON.parse(localStorage.getItem('lakeshore.settings.v1') ?? '{}').proMode ?? null; } catch { /* none */ }
  return { mode: V.mode.now(), speed: V.mode.speed(), rate: V.clock.rate, pro: ui.pro, boatPro: B.pro, engineSame: V.sea.engine === B.phys.engine,
    stormS0: V.weatherMenu?.stormS0 ?? null, cruiseOn: !!c?.on, handed: !!c?.handed, raceOn: !!r?.on, driven: B.driven, pilot: B.assists.pilot, x: s.x, z: s.z, t: B.t,
    line: c?.line?.text ?? '', jibTrim: B.ctl.jibTrim ?? 0, jibSide: B.ctl.jibSide, traveller: B.ctl.traveller, stored,
    counts: ui.skills.counts };
});
const barBtn = (page) => page.locator('.lk-view:not(.off) .xt[data-x=mode]').filter({ visible: true });
// one in-page switch: the boat before and right after (position, heading, speed, the clock, the sail's sheet), every frame's heading
// for 2 s after (a snap shows as a big step), and the dark veil's highest opacity throughout
const SWITCH = async (page, how) => {
  await page.evaluate(() => { window.__vm = 0; const f = () => { for (const e of document.body.children) if (/#05080b|rgb\(5, 8, 11\)/.test(e.style.cssText)) window.__vm = Math.max(window.__vm, +getComputedStyle(e).opacity || 0); window.__vr = requestAnimationFrame(f); }; f(); });
  const r = await page.evaluate(async (how) => {
    const V = window.__velia, B = V.boat.sim, snap = () => { const s = B.state; return { x: s.x, z: s.z, h: s.heading, sog: s.sog, t: B.t, hour: V.clock.hour, sheet: s.mainSheet ?? B.ctl.sheet ?? null, mode: V.mode.now() }; };
    const a = snap();
    document.querySelector('.lk-view:not(.off) .xt[data-x=mode]').click();
    const want = a.mode === 'sail' ? 'cruise' : 'sail', t0 = performance.now();
    while (V.mode.now() !== want && performance.now() - t0 < 20000) await new Promise((ok) => requestAnimationFrame(ok));
    const b = snap(), hs = [b.h];
    for (let i = 0; i < 120; i++) { await new Promise((ok) => requestAnimationFrame(ok)); hs.push(B.state.heading); }
    let step = 0; for (let i = 1; i < hs.length; i++) { let d = Math.abs(hs[i] - hs[i - 1]); if (d > Math.PI) d = 2 * Math.PI - d; step = Math.max(step, d * 180 / Math.PI); }
    return { a, b, step, c: snap() };
  }, how);
  r.veil = await page.evaluate(() => { cancelAnimationFrame(window.__vr); return window.__vm; });
  return r;
};
const same = (r, what) => {
  const { a, b } = r, dt = b.t - a.t, d = Math.hypot(b.x - a.x, b.z - a.z);
  let dh = Math.abs(b.h - a.h); if (dh > Math.PI) dh = 2 * Math.PI - dh;
  check(d <= Math.max(a.sog, 3) * Math.max(dt, 0) + 1.5, `${what}: the same position (moved ${d.toFixed(2)} m in ${dt.toFixed(2)} sim s at ${a.sog.toFixed(1)} m/s)`);
  check(dh * 180 / Math.PI < 5, `${what}: the same heading (${(dh * 180 / Math.PI).toFixed(2)}° off)`);
  check(Math.abs(b.sog - a.sog) < 0.8, `${what}: the same speed (${a.sog.toFixed(2)} → ${b.sog.toFixed(2)} m/s)`);
  check(dt >= 0 && dt < 3 && b.hour >= a.hour - 1e-6 && b.hour - a.hour < 0.05, `${what}: the clock runs on (+${dt.toFixed(2)} s, ${a.hour.toFixed(4)} → ${b.hour.toFixed(4)} h)`);
  check(r.step < 2.5, `${what}: no snap of the heading in the next 2 s (largest frame step ${r.step.toFixed(2)}°)`);
  check(r.veil === 0, `${what}: no veil (the dark layer's top opacity ${r.veil})`);
};
const hold = async (page, key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=sail&hour=13&seed=1&once=0&kayaks=0&attract=0&noload=1&menu=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui && window.__velia.m4?.front && window.__velia.frames > 30, null, { timeout: 240000 });
  await page.evaluate(() => { const h = window.__velia.m4.front?.home; if (h?.state && h.state !== 'gone') h.close?.(); document.activeElement?.blur?.(); });
  await page.mouse.click(640, 300).catch(() => {});
  await page.waitForTimeout(800);

  // ---------------- Sail ----------------
  const a = await S(page);
  check(a.mode === 'sail' && a.speed === 2 && a.rate > 1 && !a.pro && !a.boatPro && a.engineSame, `Sail: 2 ×, the day clock (rate ${a.rate.toFixed(1)}), Pro off (${JSON.stringify({ mode: a.mode, speed: a.speed, pro: a.pro })})`);
  await hold(page, 'd', 1500); await hold(page, 'w', 900);
  const a1 = await S(page);
  check(a1.counts.steeredEver && a1.counts.sheetFirstAt != null, `DRV-9, U13: the lessons see key steering and the sheet (${JSON.stringify({ steered: a1.counts.steeredEver, sheet: a1.counts.sheetFirstAt })})`);
  await hold(page, 'r', 1200);
  const a2 = await S(page);
  check(Math.abs(a2.jibTrim - a1.jibTrim) < 0.02, `: R does nothing in basic, the jib's winch is its way (${a1.jibTrim.toFixed(2)} → ${a2.jibTrim.toFixed(2)})`);
  await page.keyboard.press('g'); await page.waitForTimeout(100);
  const a3 = await S(page);
  check(a3.jibSide === 0 || a3.jibSide == null, `: G does not wing the jib out (${a3.jibSide})`);
  // Pro by the player's own switch: on the boat and saved; the trim keys move the traveller
  await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('pro'));
  await page.waitForTimeout(100);
  const p0 = await S(page); await hold(page, 'q', 1000); const p1 = await S(page);
  await hold(page, 'r', 1200); const pr1 = await S(page);
  check(pr1.jibTrim < p1.jibTrim - 0.1, `DRV-2, U1: R pulls the jib sheet in, in Pro (${p1.jibTrim.toFixed(2)} → ${pr1.jibTrim.toFixed(2)})`);
  check(p0.pro && p0.boatPro && p0.stored === true, `CAP-2, U6, DRV-3: the PRO switch reaches the boat and is saved (${JSON.stringify({ pro: p0.pro, boat: p0.boatPro, stored: p0.stored })})`);
  check(p1.traveller < (p0.traveller ?? 0) - 0.2, `DRV-1, U2: Q moves the traveller in Pro (${p0.traveller} → ${p1.traveller?.toFixed(2)})`);
  await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('pro'));
  const p2 = await S(page);
  check(!p2.pro && p2.traveller == null && p2.stored === false, `DRV-4, U5: Pro off hands the trim back to the crew (traveller ${p2.traveller}), saved off`);
  await page.evaluate(() => window.__velia.settings().set('proMode', true));
  await page.waitForTimeout(100);
  const p3 = await S(page);
  check(p3.pro, `CAP-3, U7: a settings write of proMode = true turns Pro on live (${p3.pro})`);
  await page.evaluate(() => window.__velia.settings().set('proMode', false));
  // H held + 6: steady hands (B.assists.pilot; ui/steadyHands.js). Pro keeps it off and the page sets it again from the profile on
  // its next frame, so read the baseline once Pro off has reached the boat (read at once, it was Pro's stale off)
  await page.waitForTimeout(300);
  const h0 = await S(page);
  await page.keyboard.down('h'); await page.waitForTimeout(300); await page.keyboard.press('6'); await page.waitForTimeout(100); await page.keyboard.up('h');
  const h1 = await S(page);
  check(h1.pilot === h0.pilot, `: H + 6 does nothing (steady hands is Setup › Aids: ${h0.pilot} → ${h1.pilot})`);
  if (h1.pilot !== h0.pilot) { await page.keyboard.down('h'); await page.waitForTimeout(300); await page.keyboard.press('6'); await page.waitForTimeout(100); await page.keyboard.up('h'); }

  // ---------------- Cruise, where she is (the button; the ` key went) ----------------
  const before = await S(page);
  await page.keyboard.press('Backquote'); await page.waitForTimeout(800);
  check((await S(page)).mode === 'sail', ': the ` key does nothing: still Sail');
  await page.evaluate(() => document.querySelector('.lk-view:not(.off) .xt[data-x=mode]').click());
  await page.waitForFunction(() => window.__velia.cruise.c?.on, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(500);
  const b = await S(page);
  check(b.mode === 'cruise' && b.cruiseOn && b.driven, `DRV-10, U4: the button in a fresh Sail lets her sail herself (${JSON.stringify({ mode: b.mode, on: b.cruiseOn })})`);
  check(Math.hypot(b.x - before.x, b.z - before.z) < 30, `MODE-6: Cruise starts where she was (moved ${Math.hypot(b.x - before.x, b.z - before.z).toFixed(1)} m)`);
  check(b.speed === 1, `Cruise: 1 × (${b.speed})`);
  check(b.engineSame, `the one engine after the switch (the seamanship's is the boat's: ${b.engineSame})`);
  check(a.stormS0 === 97 && b.stormS0 === 70, `ENG-5: Cruise's Storm lands at arc second 70, Sail's at 97 (${a.stormS0} → ${b.stormS0})`);

  // ---------------- Regatta ----------------
  await page.evaluate(() => window.__velia.mode.go('regatta'));
  await page.waitForFunction(() => window.__velia.regatta.r?.on, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(300);
  const c0 = await S(page); const w0 = Date.now(); await page.waitForTimeout(3000); const c1 = await S(page); const wall = (Date.now() - w0) / 1000;
  check(c0.mode === 'regatta' && c0.raceOn && !c0.cruiseOn && !c0.handed, `Regatta: the race on, Cruise off and not handed (MODE-2) (${JSON.stringify({ mode: c0.mode, race: c0.raceOn, cruise: c0.cruiseOn, handed: c0.handed })})`);
  // MODE-1, R4 (the owner's pacing note, 2026-11-14): the race runs at its level's pace (Beginner and Club 2 ×, Pro 1.5 ×; v1's 1 × before)
  const pace = await page.evaluate(() => window.__velia.regatta.r.speed());
  check([2, 1.5].includes(pace) && Math.abs((c1.t - c0.t) / wall / pace - 1) < 0.25, `MODE-1: the race at its level's pace, ${pace} × (${((c1.t - c0.t) / wall).toFixed(2)} sim s per s)`);
  check(c0.rate === 1, `MODE-3: the day clock at real time (rate ${c0.rate})`);
  check(c0.stormS0 === 97, `ENG-5: the race takes Sail's Storm second again (${c0.stormS0})`);
  check(!c0.pro && !/You have the helm/.test(c0.line), `MODE-4: no hand-over line, Pro not forced (${JSON.stringify({ pro: c0.pro, line: c0.line })})`);

  // ---------------- Sail ----------------
  const pos = await S(page);
  await page.evaluate(() => window.__velia.mode.go('sail'));
  await page.waitForTimeout(500);
  const d = await S(page);
  check(d.mode === 'sail' && !d.raceOn && !d.cruiseOn && !d.driven, `Sail again: no race, no autopilot (${JSON.stringify({ mode: d.mode, race: d.raceOn, cruise: d.cruiseOn, driven: d.driven })})`);
  check(d.speed === 2 && d.rate > 1 && !d.pro, `Sail: 2 ×, Sail's day clock (rate ${d.rate.toFixed(1)}), Pro from the setting (${d.pro})`);
  check(d.engineSame, `the one engine after every switch (${d.engineSame})`);
  check(Math.hypot(d.x - pos.x, d.z - pos.z) < 30, `the boat stays where the race left her (${Math.hypot(d.x - pos.x, d.z - pos.z).toFixed(1)} m)`);
  await page.keyboard.down('d'); await page.waitForTimeout(700);
  const rud = await page.evaluate(() => Math.abs(window.__velia.boat.sim.ctl.rudder)); await page.keyboard.up('d');
  check(rud > 0.05, `the keys still reach the boat after the switches (D: rudder ${rud.toFixed(2)})`);
  const d1 = await S(page);
  check(d1.pilot === a.pilot, `steady hands as set (${d1.pilot})`);
  // ---------------- the top bar's Cruise ⇄ Sail button, and the ` key (owner, 2026-11-18) ----------------
  await page.evaluate(() => window.__velia.cruise.load()); await page.evaluate(() => window.__velia.cruise.c.ready);
  await page.evaluate(() => { const t = window.__velia.m4.ui.chart?.chart?.toggle; if (t?.pinned) t.unpin(); });
  await page.mouse.move(600, 400); await page.mouse.move(620, 410); await page.waitForTimeout(500);
  await hold(page, 'd', 500); await page.waitForTimeout(1500);
  const wake = async (p) => { await p.mouse.move(600, 400); await p.mouse.move(620, 410); await p.waitForTimeout(400); };   // the bar rests while the player is quiet
  const txt = async (p) => { await wake(p); return (await barBtn(p).first().innerText()).trim(); };
  check((await txt(page)) === 'Cruise' && await barBtn(page).count() === 1, `Sail: the button reads Cruise (${await barBtn(page).count()} visible)`);
  check(await page.locator('.lk-view:not(.off) .xt[data-x=chart]').filter({ visible: true }).count() === 0, 'Sail: no Chart button on the bar');
  const sw1 = await SWITCH(page, 'click'); same(sw1, 'Sail → Cruise by the button');
  await page.waitForTimeout(600);
  check(sw1.b.mode === 'cruise' && (await S(page)).cruiseOn && (await S(page)).driven, 'Cruise: the autopilot has the boat');
  check((await txt(page)) === 'Sail' && await barBtn(page).count() === 1, `Cruise: the button reads Sail (${await txt(page)})`);
  await page.waitForTimeout(1500);
  const sw2 = await SWITCH(page, 'click'); same(sw2, 'Cruise → Sail by the button');
  await page.waitForTimeout(600);
  const e1 = await S(page);
  check(e1.mode === 'sail' && !e1.cruiseOn && !e1.driven && e1.handed, `Sail again: the player has the helm (${JSON.stringify({ mode: e1.mode, cruise: e1.cruiseOn, driven: e1.driven })})`);
  check((await txt(page)) === 'Cruise', `Sail again: the button reads Cruise (${await txt(page)})`);
  await page.keyboard.press('Backquote'); await page.waitForTimeout(800);
  check((await S(page)).mode === 'sail', 'the ` key does nothing in Sail');
  await page.evaluate(() => window.__velia.mode.go('regatta'));
  await page.waitForFunction(() => window.__velia.regatta.r?.on, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await wake(page);
  check(await barBtn(page).count() === 0, 'Regatta: the mode button is not on the bar');
  check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
  await page.close();
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
