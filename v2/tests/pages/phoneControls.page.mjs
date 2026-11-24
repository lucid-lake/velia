// BACKLOG-v2 #2 and #52: a phone's controls as v1's, under Playwright's touch emulation (touch events, isMobile, the DPR, the UA).
//   - upright with ?portrait=1 (phones are landscape-only since 2026-11-15; the flag keeps the upright layouts for one release)
//     (iPhone 16 Pro 402 × 874 at DPR 3, iPhone 13 390 × 844):'s one-thumb controls (owner, 2026-11-15;
//     v2/ui/thumb.js): the old cluster (slots, rockers, PANEL/CHART, lever, pill) hidden, ⋯ / Auto / the action button ≥ 44 px,
//     clear of the top bar and the instruments; a sideways drag in the steer zone steers, a vertical one hands over the trim and
//     pulls the main; Tack upwind tacks, Gybe downwind gybes; the drawer opens, closes (tap outside, swipe down) and each item
//     reaches its function; Motor shows the throttle rail, which drives the lever (N a detent)
//   - one finger on the water (v1's src/sail/pads.js): the left half a tiller (0.06 of the width from where it landed = half
//     helm, steer 0.5, and the rudder angle turns by v1's amount: v1 measured +0.220 rad in 1.5 s, this checks 0.18–0.26), the right
//     half a rope (a 0.1-height drag down pulls the main in); a second finger is the camera's (steer 0 while two are down)
//   - sideways: a phone has the flat controls since (tests/pages/phoneButtons.page.mjs), no cockpit
//   - a 1280 × 800 desktop: the cockpit, no slots, no strip, no one-thumb controls
// Run by `npm run test:pages:v2`, or node v2/tests/pages/phoneControls.page.mjs --base http://127.0.0.1:<port>
import { chromium, devices } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
// the owner's reference phone (as phoneTouch.page.mjs; importing that file would run it)
const IPHONE_16_PRO = Object.freeze({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, defaultBrowserType: 'webkit',
});
const V1_TILLER = { steer: 0.5, rudder: [0.18, 0.26] };   // v1's state.rudderAngle: −0.008 → +0.212 rad after 1.5 s at half helm
const PROFILES = [['iPhone 16 Pro upright', IPHONE_16_PRO], ['390x844 upright', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }], ['desktop 1280x800', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }]];
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  for (const [name, dev] of PROFILES) {
    const { defaultBrowserType, ...opts } = dev; void defaultBrowserType;
    const touch = !!opts.hasTouch, W = opts.viewport.width, H = opts.viewport.height, size = `${W}x${H}`;
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    // the Calm HUD's one-time line: stale on the one-thumb controls (they never fade), so it must never show there (owner 2026-11-15)
    await page.addInitScript(() => { window.__staleHint = false; new MutationObserver((ms) => { for (const m of ms) if (m.target.textContent?.includes('Tap to show the helm')) window.__staleHint = true; }).observe(document, { subtree: true, childList: true, characterData: true }); });
    // phones are landscape-only (owner 2026-11-15): an upright phone turns the landscape page on its side (landscapeOnly.page.mjs);
    // the one-thumb controls are behind ?portrait=1 for one release, and this file checks them there until they go
    await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&quality=1${touch && H > W ? '&portrait=1' : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.boat && window.__velia.m4?.ui?.station, null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    const cdp = await ctx.newCDPSession(page);
    const touchPath = async (pts, holdMs = 0) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const [x, y] of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await page.waitForTimeout(16); }
      if (holdMs) await page.waitForTimeout(holdMs);
      return () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const row = () => page.evaluate(() => window.__velia.boat.row());
    const st = await page.evaluate(() => {
      const s = window.__velia.m4.ui.station, b = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const c = e.getBoundingClientRect(); return c.width < 1 ? null : { x: c.x, y: c.y, w: c.width, h: c.height }; };
      return { form: s.form, slots: s.slots, drawn: window.__velia.m4.cockpit?.slots ?? null, hands: b('#hands .helm'), thumb: b('.lk-thumb .act') || b('.lk-thumb .more'), cockpit: document.documentElement.classList.contains('lk-cockpit') };
    });
    if (!touch) {
      check(st.form === 'cockpit' && !st.slots && !st.drawn && !st.hands && !st.thumb, `${name}: the cockpit, no slots, no strip, no one-thumb controls (${JSON.stringify(st)})`);
    } else if (H > W) {
      // (owner, 2026-11-15): the one-thumb controls; the old portrait cluster is gone on an upright phone
      check(st.form === 'thumb' && !st.cockpit && !st.hands && !st.slots && !st.drawn, `${name}: the thumb form, no cockpit, no slots, no M3 helm strip (${st.form})`);
      const vis = (q) => page.evaluate((q2) => { const e = document.querySelector(q2); if (!e) return null; const cs = getComputedStyle(e), c = e.getBoundingClientRect(); return e.hidden || e.closest('[hidden]') || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || c.width < 1 ? null : { x: c.x, y: c.y, w: c.width, h: c.height }; }, q);
      const old = { helm: await vis('.lk-helm'), wheel: await vis('.lk-helm .pad.wheel'), cp: await vis('.lk-cp'), thr: await vis('.lk-thr'), pill: await vis('.lk-tackb') };
      check(Object.values(old).every((v) => !v), `${name}: the old cluster (wheel, winches, rockers, PANEL/CHART, lever, pill) hidden (${JSON.stringify(old)})`);
      const L = await page.evaluate(() => {
        const box = (e) => { const c = e.getBoundingClientRect(); return { x: c.x, y: c.y, w: c.width, h: c.height }; };
        const one = (q) => { const e = document.querySelector(q); if (!e) return null; const r = box(e), at = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2); return { ...r, hit: !!at && (at === e || e.contains(at)) }; };
        const bar = [...document.querySelectorAll('.lk-view .isl')].map(box).filter((r) => r.w > 0);
        const inst = [...document.querySelectorAll('.lk-cv, .lk-chart .small')].map(box).filter((r) => r.w > 0);
        return { more: one('.lk-thumb .more'), chip: one('.lk-thumb .chip'), act: one('.lk-thumb .act'), zone: one('.lk-thumb .zone'), arc: one('.lk-thumb .arc'), bar, inst };
      });
      const btns = [L.more, L.chip, L.act];
      check(btns.every((b) => b && b.hit && b.w >= 44 && b.h >= 44) && L.zone && L.arc, `${name}: ⋯, Auto and the action button show, hit-testable, ≥ 44 px; the zone and the rudder arc (${JSON.stringify({ more: L.more, chip: L.chip, act: L.act })})`);
      check(L.zone && L.zone.y >= H * 0.6 && L.zone.y + L.zone.h <= H - 20, `${name}: the steer zone is the lower third, clear of the bottom swipe (${JSON.stringify(L.zone)})`);
      const clash = btns.filter(Boolean).filter((r) => [...L.bar, ...L.inst].some((o) => hit(r, o)));
      check(L.bar.length > 0 && L.inst.length > 0 && !clash.length, `${name}: nothing over the top bar or the instruments (${clash.length} clashes)`);
      const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];
      const outside = async () => { const r = await vis('.lk-thumb .sheet'); if (!r) return; (await touchPath([[W / 2, r.y - 80]], 60))(); await page.waitForTimeout(250); };
      const tap = async (q) => { const r = await vis(q); if (!r) return false; const [x, y] = center(r); (await touchPath([[x, y]], 60))(); await page.waitForTimeout(250); return true; };
      const T = () => page.evaluate(() => { const t = window.__velia.m4.ui.thumb, s = window.__velia.boat.state; return { auto: t.auto, action: t.action, drawer: t.drawer, chip: document.querySelector('.lk-thumb .chip .w')?.textContent, twa: +(s.trueWind.angle * 180 / Math.PI).toFixed(1), steer: window.__velia.hands.now.steer, rudder: +s.rudderAngle.toFixed(3) }; });
      // a sideways drag in the zone: the helm, as today's touch steering (0.06 of the width = half helm), the rudder turns
      const zy = L.zone.y + L.zone.h * 0.55, r0 = await T();
      const relZ = await touchPath(line(W * 0.4, zy, W * 0.4 + 0.06 * W, zy, 10), 1500);
      const z1 = await T(); await relZ();
      check(Math.abs(z1.steer - 0.5) < 0.03 && Math.abs(z1.rudder - 0.5 * 25 * Math.PI / 180) < 0.04, `${name}: a sideways drag in the zone steers: half helm, the rudder near half (steer ${z1.steer.toFixed(3)}, rudder ${r0.rudder} → ${z1.rudder} rad)`);
      await page.waitForTimeout(1500);
      // a vertical drag in the zone: the trim becomes the player's (Auto → Manual) and the rope pulls the main in
      check((await T()).auto && (await T()).chip === 'Auto', `${name}: the trim starts on Auto (the crew trims)`);
      const relV = await touchPath(line(W * 0.5, L.zone.y + 10, W * 0.5, L.zone.y + 10 + 0.1 * H, 12), 300); await relV();
      await page.waitForTimeout(600);
      const sA = (await row()).sheetDeg, tv = await T();
      check(!tv.auto && tv.chip === 'Manual' && sA != null, `${name}: a vertical drag in the zone hands the trim over (auto ${tv.auto}, chip ${tv.chip}, sheet ${sA}°)`);
      const relV2 = await touchPath(line(W * 0.5, L.zone.y + 10, W * 0.5, L.zone.y + 10 + 0.1 * H, 12), 600); await relV2();
      const sB = (await row()).sheetDeg;
      check(sA != null && sB != null && sB < sA - 0.5, `${name}: a drag down in the zone pulls the main in (${sA}° → ${sB}°)`);
      await tap('.lk-thumb .chip'); check((await T()).auto, `${name}: a tap on the chip gives the trim back to the crew`);
      await tap('.lk-thumb .chip'); check(!(await T()).auto, `${name}: and a second tap takes it again`);
      // Tack upwind: the action button reads Tack, a tap brings the bow through the wind
      const u0 = await T();
      const tackWord = await page.evaluate(() => document.querySelector('.lk-thumb .act .w')?.textContent);
      check(u0.action === 'tack' && tackWord === 'Tack', `${name}: upwind the action button is Tack (${u0.action}, twa ${u0.twa}°)`);
      await tap('.lk-thumb .act');
      await page.waitForFunction((s0) => Math.sign(window.__velia.boat.state.trueWind.angle) !== s0, Math.sign(u0.twa), { timeout: 20000 }).catch(() => {});
      const u1 = await T();
      check(Math.sign(u1.twa) !== Math.sign(u0.twa), `${name}: a tap on Tack tacks: the wind crosses the bow (${u0.twa}° → ${u1.twa}°)`);
      await page.waitForTimeout(3000);
      // Gybe downwind: the boat placed on a run (the true wind 150° off), the button reads Gybe, a tap brings the stern through
      await page.evaluate(() => {
        const B = window.__velia.boat.sim, s = B.state, from = s.heading + s.trueWind.angle, sg = Math.sign(s.trueWind.angle) || 1;
        B.place({ x: s.x, z: s.z, headingDeg: (from - sg * 150 * Math.PI / 180) * 180 / Math.PI, speed: 3 }); B.setPilot?.(true);
      });
      await page.waitForTimeout(2000);
      const d0 = await T(), gybeWord = await page.evaluate(() => document.querySelector('.lk-thumb .act .w')?.textContent);
      check(d0.action === 'gybe' && gybeWord === 'Gybe', `${name}: downwind the action button is Gybe (${d0.action}, twa ${d0.twa}°)`);
      await tap('.lk-thumb .act');
      await page.waitForFunction((s0) => Math.sign(window.__velia.boat.state.trueWind.angle) !== s0, Math.sign(d0.twa), { timeout: 25000 }).catch(() => {});
      const d1 = await T();
      check(Math.abs(d0.twa) > 135 && Math.sign(d1.twa) !== Math.sign(d0.twa), `${name}: a tap on Gybe gybes: the wind crosses the stern (${d0.twa}° → ${d1.twa}°)`);
      await page.waitForTimeout(2500);
      // the drawer: ⋯ opens it; each item reaches its function (the dock's action, or the page's own); a tap outside closes it
      await page.evaluate(() => { const d = window.__velia.m4.ui.services.get('dock'), run = d.run.bind(d); window.__ran = []; d.run = (id) => { window.__ran.push(id); return run(id); }; });
      await tap('.lk-thumb .more');
      const sheet = await vis('.lk-thumb .sheet');
      check((await T()).drawer && sheet && sheet.y > H * 0.3, `${name}: ⋯ opens the drawer from the bottom (${JSON.stringify(sheet)})`);
      const cells = await page.evaluate(() => [...document.querySelectorAll('.lk-thumb .sheet .dc, .lk-thumb .sheet .pair button')].map((b) => { const c = b.getBoundingClientRect(); return { w: c.width, h: c.height }; }));
      check(cells.length === 15 && cells.every((c) => c.w >= 44 && c.h >= 44), `${name}: 15 drawer targets (no Binoculars on a phone), each ≥ 44 px (${cells.length})`);
      // owner 2026-11-15: every drawer word whole (Trim reads Manual, not a cut word): each label's text inside its own box, no ellipsis
      const cut = await page.evaluate(() => [...document.querySelectorAll('.lk-thumb .sheet .lbl, .lk-thumb .sheet .pair button, .lk-thumb .sheet .dc span')].filter((e) => {
        const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(), b = (e.closest('button,.seg') ?? e).getBoundingClientRect();
        return e.scrollWidth > e.clientWidth + 0.5 || t.left < b.left - 0.5 || t.right > b.right + 0.5 || getComputedStyle(e).textOverflow === 'ellipsis';
      }).map((e) => e.textContent));
      const words = await page.evaluate(() => [...document.querySelectorAll('.lk-thumb .sheet [data-seg=trim] .pair button')].map((b) => b.textContent));
      check(!cut.length && words.join('|') === 'Auto|Manual', `${name}: every drawer label fits, Trim is Auto | Manual (cut ${JSON.stringify(cut)}, trim ${words.join('|')})`);
      await outside();
      check(!(await T()).drawer && !(await vis('.lk-thumb .sheet')), `${name}: a tap outside closes the drawer`);
      // a swipe down closes it too
      await tap('.lk-thumb .more');
      const sh = await vis('.lk-thumb .sheet');
      (await touchPath(line(W / 2, sh.y + 6, W / 2, sh.y + 120, 8)))(); await page.waitForTimeout(300);
      check(!(await T()).drawer, `${name}: a swipe down closes the drawer`);
      const furl0 = await page.evaluate(() => window.__velia.boat.sim.sea?.furlWant ?? null);
      check(!(await page.evaluate(() => window.__staleHint)), `${name}: no "Tap to show the helm" line (the one-thumb controls never fade)`);
      const inDrawer = async (q) => { if (!(await T()).drawer) await tap('.lk-thumb .more'); return tap(`.lk-thumb .sheet ${q}`); };
      await inDrawer('.seg[data-seg=sails] button[data-v="1"]');
      const furl1 = await page.evaluate(() => window.__velia.boat.sim.sea?.furlWant ?? null);
      check(furl0 === 0 && furl1 === 1, `${name}: Sails Down lowers the sails (furl want ${furl0} → ${furl1})`);
      const sailsUp = await page.evaluate(() => document.querySelector('.lk-thumb .act .w')?.textContent);
      await inDrawer('.seg[data-seg=sails] button[data-v="0"]');
      check(sailsUp === 'Sails up' && (await page.evaluate(() => window.__velia.boat.sim.sea?.furlWant)) === 0, `${name}: with the sails down the action button is Sails up (${sailsUp}); Sails Up raises them`);
      await inDrawer('.seg[data-seg=anchor] button[data-v="1"]');
      const tools = () => page.evaluate(() => { const T2 = window.__velia.m4.ui.services.get('captainTools'); return { on: !!T2?.on, latched: !!T2?.latched }; });
      const radio0 = (await tools()).on;
      await inDrawer('.dc[data-id=radio]');
      const radioOn = (await tools()).on !== radio0;   // the VHF is on by default: the tap turns it off (and back)
      await inDrawer('.dc[data-id=radio]');
      await inDrawer('.dc[data-id=reef]');
      const reefed = await page.evaluate(() => window.__velia.boat.sim.reefSel === 0 ? 0 : 1);   // Sail starts on 0: the cell steps it to A
      const noBino = await page.evaluate(() => !document.querySelector('.lk-thumb .dc[data-id=binoculars]'));   // owner 2026-11-15: no binoculars on a phone
      const ran = await page.evaluate(() => window.__ran);
      check(['sails', 'anchor', 'radio', 'reef'].every((id) => ran.includes(id)), `${name}: Sails, Anchor, VHF and Reef run their actions (${ran.join(', ')})`);
      check(radioOn && reefed > 0 && noBino, `${name}: VHF switches the radio, Reef steps the selector, the drawer has no Binoculars (${JSON.stringify({ radioOn, reefed, noBino })})`);
      await page.waitForTimeout(1500);
      await inDrawer('.dc[data-id=chart]');
      // Phase 2b: the old enlarged chart is gone; Chart opens the live map (the in-game menu), as N and the chart dial do
      await page.waitForTimeout(800);
      const mp = await page.evaluate(() => { const s = window.__velia.m4.ui.services, c = s.get('liveChart'); return { menu: !!s.get('menu')?.isOpen, map: !!c?.shown && c.state.mode === 'play' }; });
      check(mp.menu && mp.map, `${name}: Chart opens the live map (${JSON.stringify(mp)})`);
      await page.evaluate(() => window.__velia.m4.ui.services.get('menu')?.close?.()); await page.waitForTimeout(1200);
      await inDrawer('.dc[data-id=view]');
      check(await page.evaluate(() => window.__velia.m4.ui.views.view === 'helm'), `${name}: View switches to the helm view`);
      await page.evaluate(() => window.__velia.m4.ui.views.set('follow')); await page.waitForTimeout(1500);
      await inDrawer('.dc[data-id=log]');
      check(await page.evaluate(() => !!window.__velia.m4.ui.services.get('logbook')?.logbook?.isOpen), `${name}: Log opens the logbook`);
      await page.evaluate(() => window.__velia.m4.ui.services.get('logbook')?.logbook?.close?.()); await page.waitForTimeout(800);
      await inDrawer('.dc[data-id=menu]');
      check(await page.evaluate(() => !!window.__velia.m4.ui.services.get('menu')?.isOpen), `${name}: Menu opens the Menu card`);
      await page.evaluate(() => window.__velia.m4.ui.services.get('menu')?.close?.()); await page.waitForTimeout(1200);
      // motor: Drive Motor starts the engine; the throttle rail takes the action button's place and drives the lever
      await inDrawer('.seg[data-seg=drive] button[data-v="1"]'); await outside();
      await page.waitForTimeout(600);
      const rail = await vis('.lk-thumb .rail'), actM = await vis('.lk-thumb .act'), engOn = await page.evaluate(() => !!window.__velia.boat.sim.phys.engine.on);
      check(engOn && rail && rail.w >= 44 && !actM, `${name}: Motor shows the throttle rail in the action button's place (engine ${engOn}, rail ${JSON.stringify(rail)}, action ${JSON.stringify(actM)})`);
      if (rail) {
        const relR = await touchPath(line(rail.x + rail.w / 2, rail.y + rail.h / 2, rail.x + rail.w / 2, rail.y + 34, 8), 200);
        const lv = await page.evaluate(() => window.__velia.boat.sim.phys.engine.lever); await relR(); await page.waitForTimeout(300);
        const lv2 = await page.evaluate(() => window.__velia.boat.sim.phys.engine.lever);
        check(lv > 0.8 && Math.abs(lv2 - 1) < 1e-6, `${name}: a drag up the rail goes ahead, the release snaps to a notch (${lv.toFixed(2)} → ${lv2})`);
        await tap('.lk-thumb .rail .ar.dn'); await tap('.lk-thumb .rail .ar.dn');
        const lv3 = await page.evaluate(() => window.__velia.boat.sim.phys.engine.lever);
        check(lv3 < lv2 && lv3 >= 0, `${name}: ▼ steps the lever back a notch at a time (${lv2} → ${lv3})`);
        const relN = await touchPath(line(rail.x + rail.w / 2, rail.y + rail.h - 34, rail.x + rail.w / 2, rail.y + rail.h / 2 + 2, 6), 100); await relN(); await page.waitForTimeout(300);
        const lvN = await page.evaluate(() => window.__velia.boat.sim.phys.engine.lever);
        check(lvN === 0, `${name}: N is a detent (a drag from astern to just past the middle stops at ${lvN})`);
      }
      await tap('.lk-thumb .drive button[data-v="0"]'); await page.waitForTimeout(500);
      check(!(await page.evaluate(() => window.__velia.boat.sim.phys.engine.on)) && !(await vis('.lk-thumb .rail')), `${name}: Sail stops the engine and hides the rail`);
      await page.waitForTimeout(1500);
    }
    if (touch) {
      // one finger on the left half: the tiller (v1: steer = dx / (0.12 × the width), held)
      const ang = () => page.evaluate(() => +window.__velia.boat.state.rudderAngle.toFixed(3));   // rad (row().rudder is the helm's −1…1)
      const a0 = await ang();
      const rel = await touchPath(line(W * 0.25, H * 0.35, W * 0.25 + 0.06 * W, H * 0.35), 1500);
      const hd = await page.evaluate(() => window.__velia.hands.now), a1 = await ang(); await rel();
      const dr = a1 - a0;
      check(Math.abs(hd.steer - V1_TILLER.steer) < 0.03, `${name}: a one-finger drag of 0.06 × the width on the left half is half helm (steer ${hd.steer.toFixed(3)})`);
      check(dr >= V1_TILLER.rudder[0] && dr <= V1_TILLER.rudder[1], `${name}: it turns the rudder by v1's amount (${a0} → ${a1} rad: +${dr.toFixed(3)}; v1 +0.220)`);
      await page.waitForTimeout(1200);
      // one finger on the right half: the rope, pulled down 0.1 of the height
      const s0 = (await row()).sheetDeg;
      const rel2 = await touchPath(line(W * 0.75, H * 0.3, W * 0.75, H * 0.4, 12), 600);
      const pull = await page.evaluate(() => window.__velia.hands.now.pull), s1 = (await row()).sheetDeg; await rel2();
      check(s0 != null && s1 != null && s1 < s0 - 0.5, `${name}: a drag down on the right half pulls the main in (${s0}° → ${s1}°, pull ${pull.toFixed(2)} at the end)`);
      // two fingers: the camera's (no helm, no sheet)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: W * 0.3, y: H * 0.3, id: 1 }, { x: W * 0.7, y: H * 0.3, id: 2 }] });
      for (let d = 0; d < 6; d++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: W * 0.3 + d * 8, y: H * 0.3, id: 1 }, { x: W * 0.7 + d * 8, y: H * 0.3, id: 2 }] }); await page.waitForTimeout(16); }
      const two = await page.evaluate(() => ({ ...window.__velia.hands.now, multi: window.__velia.hands.multi }));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      check(two.multi && Math.abs(two.steer) < 1e-6 && Math.abs(two.pull) < 1e-6, `${name}: two fingers are the camera's (steer ${two.steer}, pull ${two.pull})`);
    }
    const stats = await page.evaluate(() => window.__velia.stats());
    check(errors.length === 0 && stats.pipelines.afterFirstFrame === 0, `${name}: no page error, 0 pipelines after the first frame (${errors.join('; ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
