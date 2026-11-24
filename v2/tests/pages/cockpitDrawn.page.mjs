// The drawn page lands where a finger is, in every hold (owner, 2026-11-16, on an iPhone, Velia launched from the Home Screen and held
// upright: "the cockpit is not fully displayed. When I click SAILS, ANCHOR triggers REEF"). There 100vh is the whole screen but
// innerHeight stops under the status bar, so the turned page's canvas was longer than the frame its controls are laid out in.
// Since (owner, 2026-11-16) a touch phone has no 3D cockpit: its flat controls (v2/ui/flat.js) take its place; a desktop
// keeps the cockpit. Each mode below, with real CDP touches (hasTouch, isMobile, Safari's UA):
//   turned + standalone   390 × 844, 393 × 852, 402 × 874 upright, display-mode standalone, the safe areas of an iPhone upright
//                         (59 px top, 34 px bottom) and innerHeight 59 px short of the screen (the status bar), as iOS reports it
//   turned + Safari       390 × 844 upright
//   sideways + both       844 × 390 (Safari, and standalone)
// checks that
//   - the canvas is the frame: its CSS box is innerWidth × innerHeight
//   - no 3D cockpit is drawn (no cockpit object, no html.lk-cockpit); the flat controls are laid out inside the frame
//   - a tap at the middle of Auto, Tack and "⋯" reaches that control (the pointerdown's target) and fires it (Auto holds the course,
//     ⋯ opens the drawer)
// and on a 1280 × 720 desktop (a mouse) the cockpit is still drawn whole, and a click at the drawn centre of SAILS, ANCHOR and REEF
// reaches that control and runs its dock action; the engine key (no dial beside it) has its cell on it; the pilot pad in the
// rudder readout's spot (the round assist key at the hub's x, AUTO's half-moon on its right) fires from its drawn centres, hit areas the
// drawn shapes (≥ 44 px, no overlap), the wheel's rim still steers and lets AUTO go, the key reads GYBE downwind and lights only while
// the player's manoeuvre runs (dim on a reach), AUTO sails to a target (every target path: autoTarget.page.mjs).
// Run by `npm run test:pages:v2 -- cockpitDrawn`, or node v2/tests/pages/cockpitDrawn.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// [name, W, H, standalone, status bar px (innerHeight short of the screen), safe-area insets]
const MODES = [
  ['turned standalone 390x844', 390, 844, true, 59, { top: 59, bottom: 34, left: 0, right: 0 }],
  ['turned standalone 393x852', 393, 852, true, 59, { top: 59, bottom: 34, left: 0, right: 0 }],
  ['turned standalone 402x874', 402, 874, true, 62, { top: 62, bottom: 34, left: 0, right: 0 }],
  ['turned Safari 390x844', 390, 844, false, 0, null],
  ['sideways Safari 844x390', 844, 390, false, 0, null],
  ['sideways standalone 844x390', 844, 390, true, 0, { top: 0, bottom: 21, left: 47, right: 47 }],
];
// the controls: [name, the rig's anchors (the middle of), the hit element, the dock action it runs]; the lever is aimed at its knob
const CONTROLS = [   // a desktop's cockpit: [name, the rig's anchor, the hit element, the dock action it runs]
  ['REEF', 't:reef', '.lk-cp .c[data-id=reef]', 'reef'],
  ['ANCHOR', 't:anchor', '.lk-cp .c[data-id=anchor]', 'anchor'],
  ['SAILS', 't:sails', '.lk-cp .c[data-id=sails]', 'sails'],
];

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  for (const [name, W, H, standalone, bar, insets] of MODES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    if (insets) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }).catch(() => {});
    if (standalone) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }).catch(() => {});
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    // iOS standalone: innerHeight stops under the status bar, while 100vh stays the whole screen
    if (bar) await page.addInitScript((b) => { for (let p = window; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, 'innerHeight'); if (d?.get) { Object.defineProperty(window, 'innerHeight', { configurable: true, enumerable: true, get: () => d.get.call(window) - b }); break; } } }, bar);
    await page.addInitScript(() => { window.__pd = []; addEventListener('pointerdown', (e) => window.__pd.push(e.target), true); });
    await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&quality=1&kayaks=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.flat?.on && window.__velia.m4.ui.flat.shown, null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    const turnedWant = H > W;
    const d0 = await page.evaluate(() => {
      const c = document.getElementById('c').getBoundingClientRect(), L = window.__velia.m4.ui.flat.layout;
      const boxes = Object.entries(L.shapes).map(([k, s]) => { const R = s.kind === 'quarter' ? s.r : s.kind === 'band' ? s.r1 : 0; const b = s.kind === 'rect' ? s : s.kind === 'circle' ? { x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r } : { x: s.p.side > 0 ? s.p.x : s.p.x - R, y: s.p.y - R, w: R, h: R }; return [k, b]; });
      return { frame: { w: innerWidth, h: innerHeight }, canvas: { x: c.x, y: c.y, w: c.width, h: c.height }, turned: !!window.__veliaTurn?.rotated(), cockpit: !!window.__velia.m4.cockpit || document.documentElement.classList.contains('lk-cockpit'), boxes, L };
    });
    check(d0.turned === turnedWant, `${name}: the page is ${turnedWant ? '' : 'not '}turned (${d0.turned})`);
    check(Math.abs(d0.canvas.x) < 0.5 && Math.abs(d0.canvas.y) < 0.5 && Math.abs(d0.canvas.w - d0.frame.w) < 0.5 && Math.abs(d0.canvas.h - d0.frame.h) < 0.5,
      `${name}: the canvas is the frame (canvas ${JSON.stringify(d0.canvas)}, frame ${d0.frame.w} × ${d0.frame.h})`);
    check(!d0.cockpit, `${name}: no 3D cockpit on a phone`);
    const outside = d0.boxes.filter(([, b]) => !(b.x >= 0 && b.y >= 0 && b.x + b.w <= d0.frame.w + 0.5 && b.y + b.h <= d0.frame.h + 0.5)).map(([k]) => k);
    check(outside.length === 0, `${name}: the flat controls are inside the frame (${outside.join('; ') || 'all in'})`);
    const L = d0.L, q = L.q * 0.35;
    for (const [label, [x, y], sel, fired] of [
      ['Auto', [L.pl.x + q, L.pl.y - q], '.lk-flat > .auto', () => window.__velia.boat.sim.assists.pilot && window.__velia.boat.sim.holding != null],
      ['Tack', [L.pr.x - q, L.pr.y - q], '.lk-flat > .tack', null],
      ['⋯', [L.more.x, L.more.y], '.lk-flat > .more', () => window.__velia.m4.ui.flat.drawer],
    ]) {
      const [sx, sy] = await page.evaluate(([px, py]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(px, py) : [px, py]), [x, y]);
      await page.evaluate(() => { window.__pd = []; window.__velia.boat.sim.setPilot(false); });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
      await wait(70);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(450);
      const r = await page.evaluate((sl) => { const t = window.__pd[0], hit = document.querySelector(sl); return { reached: !!t && !!hit && (t === hit || hit.contains(t)), got: t ? (t.className?.baseVal ?? t.className ?? t.tagName) : 'nothing' }; }, sel);
      const ok = fired ? await page.evaluate(fired) : true;
      check(r.reached && ok, `${name}: a tap on ${label} reaches it${fired ? ' and fires it' : ''} (target ${r.got})`);
    }
    check(errors.length === 0, `${name}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // a desktop keeps the cockpit, drawn whole, and a click at a switch's drawn centre reaches it
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    await page.addInitScript(() => { window.__pd = []; addEventListener('pointerdown', (e) => window.__pd.push(e.target), true); });
    await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&quality=1&kayaks=0&hud=full`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station?.form === 'cockpit' && (window.__velia.m4.rig ?? window.__velia.m4.cockpit?.rig), null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    check(!(await page.evaluate(() => !!window.__velia.m4.ui.flat?.on)), 'desktop 1280x720: the cockpit, no flat controls');
    await page.evaluate(() => { const d = window.__velia.m4.ui.services.get('dock'), run = d.run; window.__runs = []; d.run = (id, ...a) => { window.__runs.push(id); return run.call(d, id, ...a); }; });
    for (const [label, anchor, sel, action] of CONTROLS) {
      const p = await page.evaluate((n) => (window.__velia.m4.rig ?? window.__velia.m4.cockpit.rig).project(n), anchor);
      await page.evaluate(() => { window.__pd = []; window.__runs = []; });
      await page.mouse.click(p.x, p.y); await wait(450);
      const r = await page.evaluate((sl) => { const t = window.__pd[0], hit = document.querySelector(sl); return { reached: !!t && !!hit && (t === hit || hit.contains(t)), runs: [...window.__runs] }; }, sel);
      check(r.reached && r.runs.includes(action), `desktop 1280x720: a click on the drawn ${label} reaches it and runs its action (ran ${r.runs.join(',') || 'nothing'})`);
    }
    // the engine key (owner 2026-11-16: at its recess's outboard end, the gauge inboard): its hit cell on the drawn key, ≥ 44 px
    { const k = await page.evaluate(() => { const rig = window.__velia.m4.rig ?? window.__velia.m4.cockpit.rig, p = rig.project('key'), t = rig.project('tach'), c = document.querySelector('.lk-cp .c[data-id=engine]').getBoundingClientRect();
        return { p, t, c: { x: c.x + c.width / 2, y: c.y + c.height / 2, w: c.width, h: c.height } }; });
      check(!Number.isFinite(k.t.x) && Math.abs(k.c.x - k.p.x) < 1.5 && Math.abs(k.c.y - k.p.y) < 1.5 && k.c.w >= 44 && k.c.h >= 44, `desktop 1280x720: no engine dial (owner 2026-11-17), the key's ${k.c.w} x ${k.c.h} cell on the drawn key (${JSON.stringify(k)})`); }
    // the pilot pad (v2/ui/autopilot.js) in the rudder readout's spot: the round assist key at the hub's x, AUTO's half-moon on its right;
    // hit areas the drawn shapes (≥ 44 px, none overlapping); AUTO's ring lit while on, the wheel gives it back; the key fires and reads
    // GYBE downwind; AUTO with a target sails there from where she is
    const P = () => page.evaluate(() => { const ui = window.__velia.m4.ui, p = ui.services.get('pilot'), h = ui.services.get('apHud'), s = window.__velia.boat.sim.phys.state, el = ui.station.apHud;
      const box = (b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const G = h.geometry, k = h.buttons.key.getBoundingClientRect();
      return { mode: p.mode, hud: h.state, shown: el.classList.contains('in'), rd: !!document.querySelector('.lk-helm .rd:not(.ap).in'), x: s.x, z: s.z, driven: window.__velia.boat.sim.driven,
        key: box(h.buttons.key), autoB: box(h.buttons.auto), c: { x: k.x + k.width / 2, y: k.y + k.height / 2 }, G,
        autoOn: h.state.auto, tackOn: h.state.lit, word: h.state.word, offer: ui.tackBtn?.offer ?? null, active: !!ui.tackBtn?.active }; });
    const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const moonMid = (q) => ({ x: q.c.x + q.G.ri + q.G.moon / 2, y: q.c.y });
    let st = await P();
    const hb = await page.evaluate(() => window.__velia.m4.ui.station.screen.wheel);
    const wantY = Math.min(hb.y, 720 - 4 - st.G.ext.h);
    check(st.shown && !st.rd && Math.abs(st.c.x - hb.x) < 1.5 && Math.abs(st.c.y - wantY) < 1.5 && st.key.w >= 44 && st.autoB.x > st.c.x && st.c.y + st.G.ext.h <= 720,
      `desktop 1280x720: the round key on the hub's centre (lifted only to stay inside the window), AUTO's crescent on its right (${JSON.stringify({ key: st.key, auto: st.autoB, c: st.c, hub: hb })})`);
    // the rim is never under the pad: every point of its visible arc reaches the wheel, not a pad button
    const rimHits = await page.evaluate(([h, R]) => { const hud = window.__velia.m4.ui.services.get('apHud'), bad = [];
      for (let a = 180; a <= 360; a += 3) for (const f of [0.92, 1, 1.06]) { const x = h.x + Math.cos(a * Math.PI / 180) * R * f, y = h.y + Math.sin(a * Math.PI / 180) * R * f; if (y > innerHeight - 1) continue; const e = document.elementFromPoint(x, y); if (e && (e === hud.buttons.key || e === hud.buttons.auto)) bad.push(a); }
      return bad; }, [hb, st.G.R]);
    check(rimHits.length === 0, `desktop 1280x720: no point of the rim under the pad (${rimHits.join(',') || 'none'})`);
    check(!(await page.evaluate(() => !!document.querySelector('.lk-tackb.in'))), 'desktop 1280x720: no TACK pill and no TACK on the coaming');
    // the hit areas: scanned from the key's centre and the half-moon's middle, the drawn shapes; the gap between them nobody's
    const hits = await page.evaluate(([kc, mc, G]) => { const h = window.__velia.m4.ui.services.get('apHud');
      const span = (b, cx, cy) => { const at = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
        let l = cx; while (at(l - 1, cy)) l--; let rr = cx; while (at(rr + 1, cy)) rr++; let t = cy; while (at(cx, t - 1)) t--; let bt = cy; while (at(cx, bt + 1)) bt++;
        return { w: rr - l + 1, h: bt - t + 1, l, r: rr }; };
      const gapAt = document.elementFromPoint(kc.x + G.r + G.gap / 2, kc.y);
      return { key: span(h.buttons.key, kc.x, kc.y), auto: span(h.buttons.auto, mc.x, mc.y), gap: !!gapAt && (gapAt === h.buttons.key || gapAt === h.buttons.auto),
        corner: (() => { const e = document.elementFromPoint(kc.x + G.r * 0.8, kc.y - G.r * 0.8); return !!e && e === h.buttons.key; })() }; }, [st.c, moonMid(st), st.G]);
    check(hits.key.w >= 44 && hits.key.h >= 44 && hits.auto.h >= 44 && !hits.gap && !hits.corner && hits.key.r < hits.auto.l,
      `desktop 1280x720: the key's hit ≥ 44 px across, the crescent's ≥ 44 px tall, the gap and the key's box corner nobody's, no overlap (${JSON.stringify(hits)})`);
    for (const id of ['auto', 'key']) {
      const b = id === 'auto' ? moonMid(st) : st.c;
      await page.evaluate(() => { window.__pd = []; });
      await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.up(); await wait(450);
      const r = await page.evaluate((n) => { const t = window.__pd[0], hit = window.__velia.m4.ui.services.get('apHud').buttons[n]; return !!t && (t === hit || hit.contains(t)); }, id);
      st = await P();
      const fired = id === 'auto' ? st.mode === 'hold' && st.autoOn : (st.active && st.tackOn) || st.offer == null;   // the key: the turn runs, its ring lit while it does
      check(r && fired, `desktop 1280x720: a click at the drawn centre of ${id === 'auto' ? 'AUTO' : 'the key'} reaches it and fires it (${JSON.stringify({ mode: st.mode, autoOn: st.autoOn, offer: st.offer, active: st.active, lit: st.tackOn, word: st.word })})`);
    }
    await wait(4000);
    { if ((await P()).mode === 'off') { const b = moonMid(await P()); await page.mouse.click(b.x, b.y); await wait(300); }
      const y0 = Math.min(hb.y - 62, 700);
      await page.mouse.move(hb.x - 62, y0); await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(hb.x - 62 + 10 * i, y0 - 4 * i);
      await wait(500); const held = await P(); await page.mouse.up(); await wait(800);
      check(held.mode === 'off' && !held.autoOn && held.shown && !held.rd, `desktop 1280x720: the wheel in the hand lets AUTO go, its ring dark; the buttons stay, no rudder readout (${JSON.stringify({ mode: held.mode, autoOn: held.autoOn, shown: held.shown, rd: held.rd })})`); }
    // downwind: TACK reads GYBE, its ring dark while the gybe is only offered; a click lights it while the gybe runs. On a beam reach:
    // dim, and a click does nothing
    { await page.evaluate(() => { const B = window.__velia.boat.sim, s = B.phys.state, from = s.heading + (s.trueWind?.angle ?? 0); B.place({ x: s.x, z: s.z, headingDeg: (from + Math.PI - 0.5) * 180 / Math.PI, speed: 3 }); });
      await page.waitForFunction(() => window.__velia.m4.ui.tackBtn?.offer === 'gybe', null, { timeout: 15000 }).catch(() => {});
      await wait(300); const dn = await P();
      check(dn.word === 'GYBE' && !dn.tackOn, `desktop 1280x720: downwind the key reads ${dn.word}, its ring dark while only offered (offer ${dn.offer})`);
      const b = dn.c; await page.mouse.click(b.x, b.y); await wait(250); const gy = await P();
      check(gy.active && gy.tackOn && gy.word === 'GYBE', `desktop 1280x720: a click on GYBE: the gybe runs, its ring lit (${JSON.stringify({ active: gy.active, on: gy.tackOn })})`);
      await page.waitForFunction(() => !window.__velia.m4.ui.tackBtn?.active, null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => { const B = window.__velia.boat.sim, s = B.phys.state, from = s.heading + (s.trueWind?.angle ?? 0); B.place({ x: s.x, z: s.z, headingDeg: (from + Math.PI / 2) * 180 / Math.PI, speed: 3 }); });
      await page.waitForFunction(() => window.__velia.m4.ui.tackBtn?.offer == null, null, { timeout: 15000 }).catch(() => {});
      await wait(300); const re = await P();
      const dim = await page.evaluate(() => window.__velia.m4.ui.services.get('apHud').buttons.key.classList.contains('dim'));
      await page.mouse.click(re.c.x, re.c.y); await wait(300); const re2 = await P();
      check(dim && !re.tackOn && !re2.active, `desktop 1280x720: a beam reach: the key dim, a click does nothing (dim ${dim}, active ${re2.active})`); }
    // AUTO to a target: a double-tap mark the navigator can route to (its chart is Cruise's: the bay); AUTO sails there (the navigator
    // drives), from where she is; AUTO again lets go
    { await page.evaluate(() => window.__velia.m4.ui.services.get('pilot').load());
      const a = moonMid(await P());
      let before = null, on = null, found = null;
      for (const d of [500, 300, 800]) { for (let k = 0; k < 12 && !found; k++) {
        const ok = await page.evaluate(([dd, kk]) => { const s = window.__velia.boat.sim.phys.state, M = window.__velia.beacon.mark, b = kk * Math.PI / 6;
          return M.place({ x: s.x + Math.sin(b) * dd, z: s.z - Math.cos(b) * dd }) !== 'refused' && !!M.mark; }, [d, k]);
        if (!ok) continue;
        await wait(200); before = await P();
        await page.mouse.click(a.x, a.y); await wait(200); on = await P();
        if (on.mode === 'to') found = { d, k }; else { await page.mouse.click(a.x, a.y); await wait(150); }
      } if (found) break; }
      const moved = on ? Math.hypot(on.x - before.x, on.z - before.z) : NaN;
      check(!!found && on.driven && on.autoOn && moved < 6, `desktop 1280x720: AUTO with a target sails there from where she is (${JSON.stringify(found)}: ${on?.mode}, driven ${on?.driven}, ring ${on?.autoOn}; ${moved.toFixed(1)} m in 0.2 s)`);
      await wait(3000); const later = await P();
      check(later.mode === 'to' && later.driven, `desktop 1280x720: 3 s on, still sailing to it (${later.mode})`);
      await page.mouse.click(a.x, a.y); await wait(300);
      const off = await P();
      check(off.mode === 'off' && !off.driven && !off.autoOn, `desktop 1280x720: AUTO again lets go, the hands are back, its ring dark (${off.mode}, driven ${off.driven})`); }
    check(errors.length === 0, `desktop 1280x720: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
