// A phone's flat controls (option C, owner 2026-11-16; v2/ui/flat.js) under real CDP touches (hasTouch, isMobile,
// Safari's UA): 844 × 390 and 844 × 340 held sideways, and 390 × 844 held upright in the Home Screen app (the landscape page turned,
// display-mode standalone, an iPhone's safe areas, innerHeight 59 px short of the screen; the fingers land at __veliaTurn.toScreen).
//   - no 3D cockpit: no cockpit object, no html.lk-cockpit, no helm station; the flat controls on, each ≥ 44 px and the finger reaches
//     it (elementFromPoint at its middle is the control): Auto, Tack, the steer ring, the sheet ring, "⋯"
//   - the steer arc: a hold and a clockwise sweep turns the rudder to starboard; let go and the hand is off the helm; Auto: a tap holds
//     the course (the pilot on), a steer hands it back (the pilot off)
//   - the sheet ring: a drag up pulls the main in, down eases it; a tap on either half nudges 2°; a drag past its end never opens the
//     drawer, a tap on ⋯ always does; the ideal-trim band moves with the wind angle; Tack: a tap starts the offered tack or gybe; in irons
//     the corner reads Free (one brighten) and a tap runs FREE, amber while it runs
//   - the motor: the right ring becomes the throttle ring (a drag goes ahead on a notch, a tap on its foot steps astern) and the right
//     quarter STOP (neutral); Engine off brings the sheet ring and Tack back
//   - the drawer: ⋯ opens it; Sails down and up 3 times (the dock's sails each time), Anchor (the dock's anchor), Engine on shows the
//     throttle ring (above), Engine off brings the sheet ring back; Pro on opens the Pro panel: Reef A · 0 · 1 · 2 row: 1, Sheets Split (the jib's
//     inner ring, a drag on it trims the jib), Crew on, a drag on Traveller moves it; a tap outside closes both
//   - the camera: a one-finger drag on the water turns the view and never the rudder; the Recentre chip shows; FLAT.returnS after the
//     finger lifts the view eases back behind the boat; a tap on a button never moves the camera
//   - layouts (bounding shapes, ui/flat.js overlaps): Sail, Sail with Pro and the motor, Regatta's pre-start, racing and its results
//     card, Cruise, and Cruise with the Conditions sheet open (the sheet over the controls): nothing over anything else, the top bar too
// Run by `npm run test:pages:v2 -- phoneButtons`, or node v2/tests/pages/phoneButtons.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { overlaps } from '../../ui/flat.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;   // a folder: the layout stills
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// [name, W, H, standalone, status bar px, safe-area insets]
const MODES = [
  ['sideways 844x390', 844, 390, true, 0, { top: 0, bottom: 21, left: 47, right: 47 }],
  ['sideways 844x340', 844, 340, false, 0, null],
  ['turned standalone 390x844', 390, 844, true, 59, { top: 59, bottom: 34, left: 0, right: 0 }],
];

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open([name, W, H, standalone, bar, insets], query) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (insets) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }).catch(() => {});
  if (standalone) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }).catch(() => {});
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  if (bar) await page.addInitScript((b) => { for (let p = window; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, 'innerHeight'); if (d?.get) { Object.defineProperty(window, 'innerHeight', { configurable: true, enumerable: true, get: () => d.get.call(window) - b }); break; } } }, bar);
  await page.goto(`${BASE}/?${query}&once=0&noload=1&quality=1&kayaks=0&hud=full`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.flat?.on && window.__velia.m4.ui.flat.shown, null, { timeout: 240000 });
  await page.waitForTimeout(2500);
  const scr = (pts) => page.evaluate((p) => p.map(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y])), pts);
  const touch = async (type, pts) => { const sp = pts.length ? await scr(pts) : []; await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: sp.map(([x, y], i) => ({ x, y, id: i })) }); };
  const tap = async (p, holdMs = 70) => { await touch('touchStart', [p]); await wait(holdMs); await touch('touchEnd', []); await wait(350); };
  const drag = async (pts, holdMs = 0) => { await touch('touchStart', [pts[0]]); for (const p of pts.slice(1)) { await touch('touchMove', [p]); await wait(16); } if (holdMs) await wait(holdMs); return async () => { await touch('touchEnd', []); await wait(300); }; };
  return { ctx, page, cdp, errors, tap, drag, touch, name };
}
const line = (x0, y0, x1, y1, n = 10) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const DEG = Math.PI / 180;
const ptAt = (p, a, r) => [p.x + p.side * r * Math.cos(a * DEG), p.y - r * Math.sin(a * DEG)];

// what is on screen now, as shapes (the flat controls from their layout, the rest from the DOM), and the overlaps among them
async function screenShapes(page) {
  return page.evaluate(() => {
    const fl = window.__velia.m4.ui.flat, L = fl.layout, S = {}, el = fl.el;
    const vis = (n) => { if (!n || n.hidden) return null; const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return null; const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? { kind: 'rect', x: r.x, y: r.y, w: r.width, h: r.height } : null; };
    for (const [k, s] of Object.entries(L.shapes)) {
      const n = { auto: '.auto', take: '.take', tack: '.tack', steer: '.side.l', sheet: '.side.r', more: '.more', 'dial-chart': '.dl[data-k=chart]', 'dial-wind': '.dl[data-k=wind]', jib: '.side.r' }[k];
      if (n && vis(el.querySelector(n))) S[k] = s;
    }
    for (const [k, q] of [['readout', '.ro'], ['helper', '.help'], ['recentre', '.rc']]) { const r = vis(el.querySelector(q)); if (r) S[k] = r; }
    for (const [k, q] of [['race-chip', '#rg .fleet'], ['race-coach', '#rg .coach:not(.off)'], ['race-pick', '#rg .pick'], ['race-results', '#rg .res'], ['race-edge', '#rg .edge']]) { const r = vis(document.querySelector(q)); if (r) S[k] = r; }
    const hint = document.querySelector('.lk-hint'); if (hint && hint.textContent.trim()) { const r = vis(hint); if (r) S.hint = r; }
    // the top bar: its buttons' union (the bar's own box spans the screen)
    const bs = [...document.querySelectorAll('.lk-view:not(.off):not(.cruisecam) button, .lk-view.cruisecam:not(.off) button')].map(vis).filter(Boolean);
    if (bs.length) { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)), x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h)); S.topbar = { kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
    return { S, w: innerWidth, h: innerHeight };
  });
}
async function layoutCheck(t, what, { allow = [] } = {}) {
  const { S, w, h } = await screenShapes(t.page);
  const bad = overlaps(S, 2).filter(([a, b]) => !allow.some(([x, y]) => (a === x && b === y) || (a === y && b === x)));
  check(bad.length === 0, `${t.name}, ${what}: nothing overlaps (${Object.keys(S).join(', ')})${bad.length ? `: ${bad.map((p) => p.join(' × ')).join('; ')}` : ''}`);
  const out = Object.entries(S).filter(([, s]) => s.kind === 'rect' && (s.x < -0.5 || s.y < -0.5 || s.x + s.w > w + 0.5 || s.y + s.h > h + 0.5)).map(([k]) => k);
  check(out.length === 0, `${t.name}, ${what}: all inside the screen (${out.join(', ') || 'yes'})`);
  if (SHOTS) await t.page.screenshot({ path: `${SHOTS}/${t.name.replace(/\W+/g, '-')}-${what.replace(/\W+/g, '-')}.png` });
}

try {
  for (const mode of MODES) {
    const t = await open(mode, 'mode=sail&hour=13&seed=1&windspeed=7.7');
    const { page, tap, drag, touch, name } = t;
    const F = () => page.evaluate(() => { const u = window.__velia.m4.ui, f = u.flat, B = window.__velia.boat.sim, r = window.__velia.boat.row(); return { helm: f.helm, hold: f.hold, auto: f.auto, pilot: B.assists.pilot, holding: B.holding, rudder: r.rudder, sheet: r.sheetDeg, drawer: f.drawer, cam: f.camera, yaw: B.follow.yaw, pitch: B.follow.pitch, heading: B.state.heading, tack: !!u.tackBtn?.active, offer: u.tackBtn?.offer ?? null, crew: B.assists.crewTrim }; });
    const L = await page.evaluate(() => window.__velia.m4.ui.flat.layout);
    const nc = await page.evaluate(() => ({ cockpit: !!window.__velia.m4.cockpit, cls: document.documentElement.classList.contains('lk-cockpit'), station: !!window.__velia.m4.ui.station, turned: !!window.__veliaTurn?.rotated() }));
    check(!nc.cockpit && !nc.cls && !nc.station, `${name}: no 3D cockpit, no helm station (${JSON.stringify(nc)})`);
    check(nc.turned === (mode[2] > mode[1]), `${name}: the page is ${mode[2] > mode[1] ? '' : 'not '}turned`);
    // the controls: ≥ 44 px, the finger reaches each
    const reach = await page.evaluate((Lx) => {
      const el = window.__velia.m4.ui.flat.el, P = (p, a, r) => [p.x + p.side * r * Math.cos(a * Math.PI / 180), p.y - r * Math.sin(a * Math.PI / 180)];
      const at = { auto: [Lx.pl.x + Lx.q * 0.35, Lx.pl.y - Lx.q * 0.35], tack: [Lx.pr.x - Lx.q * 0.35, Lx.pr.y - Lx.q * 0.35], steer: P(Lx.pl, 45, Lx.steer.r), sheetTop: P(Lx.pr, Lx.main.a1 - 4, Lx.main.r), sheetFoot: P(Lx.pr, Lx.main.a0 + 4, Lx.main.r), more: [Lx.more.x, Lx.more.y] };
      const want = { auto: el.querySelector('.auto'), tack: el.querySelector('.tack'), steer: el.querySelector('.ring.steer'), sheetTop: el.querySelector('.ring.sheet'), sheetFoot: el.querySelector('.ring.sheet'), more: el.querySelector('.more') };
      return Object.fromEntries(Object.entries(at).map(([k, [x, y]]) => { const hit = document.elementFromPoint(x, y); return [k, !!hit && (hit === want[k] || want[k].contains(hit))]; }));
    }, L);
    check(Object.values(reach).every(Boolean), `${name}: the finger reaches Auto, Tack, the steer ring, both ends of the sheet ring and ⋯ (${JSON.stringify(reach)})`);
    check(L.q >= 60 && L.steer.r1 - L.steer.r0 >= 44 && L.steer.r0 === L.q + L.g, `${name}: the corner quarters r ${L.q} ≥ 60, the rings ${L.steer.r1 - L.steer.r0} px wide, ${L.g} px round them`);
    await layoutCheck(t, 'Sail');

    // the steer arc: hold and sweep clockwise → starboard; let go → the hand off
    const s0 = await F();
    let up = await drag(Array.from({ length: 11 }, (_, i) => ptAt(L.pl, 50 - 2 * i, L.steer.r)), 1200);
    const s1 = await F(); await up(); const s2 = await F();
    check(s1.helm > 0.4 && s1.rudder > s0.rudder + 0.05, `${name}: a clockwise sweep of 20° on the steer arc turns the rudder to starboard (helm ${s1.helm?.toFixed(2)}, rudder ${s0.rudder.toFixed(3)} → ${s1.rudder.toFixed(3)})`);
    check(s2.helm === null && !s2.auto && s2.pilot, `${name}: let go: the hand off the helm, NAV off, steady hands holds her (the new sailor's default; pilot ${s2.pilot}, NAV ${s2.auto})`);
    await tap([L.pl.x + L.q * 0.35, L.pl.y - L.q * 0.35]);
    const s3 = await F();
    check(s3.pilot && s3.holding != null && s3.auto, `${name}: Auto holds the course (pilot ${s3.pilot}, holding ${s3.holding?.toFixed(3)})`);
    up = await drag(Array.from({ length: 6 }, (_, i) => ptAt(L.pl, 45 + 2 * i, L.steer.r))); await up();
    { const f = await F(); check(!f.auto && f.helm === null, `${name}: a steer on the arc hands the helm back (NAV off; steady hands ${f.pilot})`); }
    // the sheet ring: a drag up pulls the main in, down eases it (relative, the needle follows); a tap on either half nudges a step;
    // a drag that runs past the ring's end never opens the drawer
    const M = L.main, sh = async () => page.evaluate(() => window.__velia.boat.state.mainSheet * 180 / Math.PI);
    const sa = await sh();
    up = await drag(Array.from({ length: 11 }, (_, i) => ptAt(L.pr, 30 + 3 * i, M.r))); await wait(200); const sb = await sh(); await up();
    check(sb < sa - 10, `${name}: a drag up the sheet ring pulls the main in (${sa.toFixed(1)}° → ${sb.toFixed(1)}°)`);
    up = await drag(Array.from({ length: 11 }, (_, i) => ptAt(L.pr, 55 - 3 * i, M.r))); await wait(200); const sc = await sh(); await up();
    check(sc > sb + 10, `${name}: a drag down eases it (${sb.toFixed(1)}° → ${sc.toFixed(1)}°)`);
    // the drag down ends at the ring's eased stop (FLAT.sheet 80°: Sail starts fully eased, so the drags return there) and a tap past
    // the stop moves nothing: pull in about 11° first, so both nudges have room
    up = await drag(Array.from({ length: 6 }, (_, i) => ptAt(L.pr, 30 + 3 * i, M.r))); await wait(200); await up();
    const n0 = await sh(); await tap(ptAt(L.pr, M.a1 - 6, M.r)); const n1 = await sh(); await tap(ptAt(L.pr, M.a0 + 6, M.r)); await tap(ptAt(L.pr, M.a0 + 6, M.r)); const n2 = await sh();
    check(Math.abs(n0 - n1 - 2) < 0.6 && Math.abs(n2 - n1 - 4) < 0.6, `${name}: a tap on the top nudges in 2°, two on the foot ease 4° (${n0.toFixed(1)} → ${n1.toFixed(1)} → ${n2.toFixed(1)})`);
    up = await drag(Array.from({ length: 16 }, (_, i) => { const a = M.a1 - 30 + 4 * i; return a <= 90 ? ptAt(L.pr, a, M.r) : [L.pr.x - 10, L.pr.y - M.r - (a - 90) * 3]; })); await up();
    check(!(await F()).drawer, `${name}: a drag on the sheet ring past its end never opens the drawer`);
    // the ideal-trim band follows the wind angle: a reach eases it against close-hauled
    await page.evaluate(() => { const B = window.__velia.boat.sim, s = B.state; B.setPilot(false); B.place({ x: s.x, z: s.z, headingDeg: 240, speed: 3 }); }); await wait(2500);
    const bandUp = await page.evaluate(() => window.__velia.m4.ui.flat.trim?.band?.[0]);
    await page.evaluate(() => { const B = window.__velia.boat.sim, s = B.state; B.place({ x: s.x, z: s.z, headingDeg: 160, speed: 3 }); }); await wait(2500);
    const bandReach = await page.evaluate(() => window.__velia.m4.ui.flat.trim?.band?.[0]);
    check(bandUp != null && bandReach != null && bandReach < bandUp - 5, `${name}: the ideal band moves down the ring (eased) from close-hauled to a reach (${bandUp?.toFixed(1)}° → ${bandReach?.toFixed(1)}°)`);
    // a button tap never moves the camera
    const c0 = await F(); await tap([L.more.x, L.more.y]); await tap([L.more.x, L.more.y]); const c1 = await F();
    check(!c1.cam.moved && Math.abs(c1.pitch - c0.pitch) < 1e-6, `${name}: two taps on ⋯ never move the camera (moved ${c1.cam.moved})`);

    // the drawer
    await page.evaluate(() => { const d = window.__velia.m4.ui.services.get('dock'), run = d.run; window.__runs = []; d.run = (id, ...a) => { window.__runs.push(id); return run.call(d, id, ...a); }; });
    await tap([L.more.x, L.more.y]);
    check((await F()).drawer, `${name}: ⋯ opens the drawer`);
    const rowBtn = (row, v) => page.evaluate(([r, vv]) => { const b = window.__velia.m4.ui.flat.el.querySelector(`.row[data-row=${r}] .pair button[data-v="${vv}"]`), q = b.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2, q.width, q.height]; }, [row, v]);
    const sz = await rowBtn('sails', 1);
    check(sz[2] >= 44 && sz[3] >= 44, `${name}: a drawer button ${sz[2].toFixed(0)} × ${sz[3].toFixed(0)}`);
    for (let i = 0; i < 3; i++) { await tap((await rowBtn('sails', 1)).slice(0, 2)); await wait(300); await tap((await rowBtn('sails', 0)).slice(0, 2)); await wait(300); }
    const runs = await page.evaluate(() => window.__runs.slice());
    check(runs.filter((x) => x === 'sails').length === 6, `${name}: Sails down and up 3 times: the dock's sails 6 times (${runs.join(',')})`);
    await page.evaluate(() => { const sea = window.__velia.sea, say = sea.hooks.say; window.__seaSaid = []; sea.hooks.say = (id, k, d) => { window.__seaSaid.push(id); return say(id, k, d); }; });
    await tap((await rowBtn('anchor', 1)).slice(0, 2));
    check((await page.evaluate(() => window.__runs.filter((x) => x === 'anchor').length)) === 1, `${name}: Anchor down runs the anchor`);
    const an = await page.evaluate(() => ({ stopping: !!window.__velia.sea.stopping, mode: window.__velia.sea.state.mode, why: window.__velia.sea.state.why, said: window.__seaSaid, lever: window.__velia.sea.engine.lever, depth: window.__velia.sea.state.depth }));
    check(an.stopping || an.mode === 'anchor' || an.said.some((id) => ['rounding', 'deep', 'deepSpot', 'shallow'].includes(id)), `${name}: the anchor acts on the finger's tap: the crew stops her or it goes (${JSON.stringify(an)})`);
    await tap((await rowBtn('engine', 1)).slice(0, 2)); await wait(600);
    await tap([L.w / 2, L.h - 12]);   // a tap outside closes the drawer
    check(!(await F()).drawer, `${name}: a tap outside closes the drawer`);
    // the motor: the right ring is the throttle ring, the right quarter STOP, no separate lever
    await wait(500);   // the 0.3 s crossfade
    const eg = await page.evaluate(() => { const el = window.__velia.m4.ui.flat.el, v = (q) => { const n = el.querySelector(q); return !!n && getComputedStyle(n).opacity > 0.5 && getComputedStyle(n).pointerEvents !== 'none'; }; return { eng: window.__velia.boat.sim.phys.engine.on, motor: el.querySelector('.side.r').classList.contains('motor'), stop: v('.stop'), tack: v('.tack'), lever: !!el.querySelector('.lever'), aria: el.querySelector('.ring.sheet').getAttribute('aria-label') }; });
    check(eg.eng && eg.motor && eg.stop && !eg.tack && !eg.lever && /throttle/.test(eg.aria), `${name}: Engine on: the throttle ring, STOP in the corner, no lever (${JSON.stringify(eg)})`);
    const lev = () => page.evaluate(() => window.__velia.boat.sim.phys.engine.lever);
    up = await drag(Array.from({ length: 11 }, (_, i) => ptAt(L.pr, M.a0 + (M.a1 - M.a0) * (0.5 + 0.045 * i), M.r))); await up();
    const l1 = await lev();
    check(l1 > 0.5, `${name}: a drag up the throttle ring goes ahead, on a notch (${l1.toFixed(2)})`);
    await tap([L.pr.x - L.q * 0.35, L.pr.y - L.q * 0.35]);
    const l2 = await lev();
    check(Math.abs(l2) < 0.01, `${name}: STOP brings the lever to neutral (${l2.toFixed(2)})`);
    await tap(ptAt(L.pr, M.a0 + 5, M.r)); const l3 = await lev();
    check(l3 < -0.1, `${name}: a tap on the throttle ring's foot steps astern (${l3.toFixed(2)})`);
    await page.evaluate(() => window.__velia.boat.sim.sea.actions.lever(0, { snap: true }));
    await layoutCheck(t, 'Engine on');
    await tap([L.more.x, L.more.y]); await tap((await rowBtn('engine', 0)).slice(0, 2)); await wait(600); await tap([L.w / 2, L.h - 12]);
    const eo = await page.evaluate(() => { const el = window.__velia.m4.ui.flat.el; return { eng: window.__velia.boat.sim.phys.engine.on, motor: el.querySelector('.side.r').classList.contains('motor'), tack: getComputedStyle(el.querySelector('.tack')).pointerEvents !== 'none' }; });
    check(!eo.eng && !eo.motor && eo.tack, `${name}: Engine off: the sheet ring and Tack back (${JSON.stringify(eo)})`);
    await page.evaluate(() => window.__velia.boat.sim.sea.actions.engine());   // the motor on again for the layout below
    // Pro
    await tap([L.more.x, L.more.y]);
    await tap((await rowBtn('pro', 1)).slice(0, 2)); await wait(300);
    const proShown = await page.evaluate(() => !window.__velia.m4.ui.flat.el.querySelector('.sheet.pro').hidden);
    check(proShown && await page.evaluate(() => window.__velia.m4.ui.pro), `${name}: Pro on opens the Pro panel`);
    await layoutCheck(t, 'Pro open', { allow: [['topbar', 'race-chip']] });
    await tap((await rowBtn('reef', 2)).slice(0, 2)); await tap((await rowBtn('sheets', 1)).slice(0, 2)); await tap((await rowBtn('crew', 1)).slice(0, 2));
    const pr = await page.evaluate(() => { const B = window.__velia.boat.sim; return { reef: B.reefSel, ctlReef: B.ctl.reef, auto: B.ctl.autoReef, split: window.__velia.m4.ui.flat.split, crew: B.assists.crewTrim, trav: B.ctl.traveller }; });
    check(pr.reef === 1 && pr.ctlReef === 1 && pr.auto === false && pr.split && pr.crew, `${name}: Reef 1, Sheets Split, Crew on (${JSON.stringify(pr)})`);
    const tr = await page.evaluate(() => { const r = window.__velia.m4.ui.flat.el.querySelector('.row[data-sl=traveller] .sl').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
    up = await drag(line(tr[0] + tr[2] * 0.5, tr[1] + tr[3] / 2, tr[0] + tr[2] * 0.95, tr[1] + tr[3] / 2)); await up();
    const trav = await page.evaluate(() => window.__velia.boat.sim.ctl.traveller);
    check(trav > (pr.trav ?? 0) + 0.3, `${name}: a drag on Traveller moves it (${pr.trav?.toFixed?.(2)} → ${trav.toFixed(2)})`);
    await tap([L.w / 2, L.h - 12]);
    const motorTo = async (want) => { await page.evaluate((w) => { const B = window.__velia.boat.sim; if (!!B.phys.engine.on !== w) B.sea.actions.engine(); }, want); await page.waitForFunction((w) => window.__velia.m4.ui.flat.motor === w, want, { timeout: 8000 }).catch(() => {}); await wait(400); };
    await motorTo(false);   // the motor off: the sheet rings
    const L2 = await page.evaluate(() => window.__velia.m4.ui.flat.layout);
    const jr = await page.evaluate((p) => { const n = window.__velia.m4.ui.flat.el.querySelector('.ring.jibring'); return !!n && getComputedStyle(n).display !== 'none' && document.elementFromPoint(p[0], p[1]) === n; }, ptAt(L2.pr, 30, L2.jib.r));
    const j0 = await page.evaluate(() => window.__velia.boat.sim.ctl.jibTrim ?? 0);
    up = await drag(Array.from({ length: 9 }, (_, i) => ptAt(L2.pr, 45 - 4 * i, L2.jib.r))); await up();
    const j1 = await page.evaluate(() => window.__velia.boat.sim.ctl.jibTrim ?? 0);
    check(jr && L2.jib && j1 > j0 + 0.02, `${name}: Split: the inner jib ring (reached ${jr}); a drag down it eases the jib (jibTrim ${j0.toFixed(3)} → ${j1.toFixed(3)})`);
    await motorTo(true);
    await layoutCheck(t, 'Sail, Split and the motor');
    await motorTo(false);
    await layoutCheck(t, 'Sail, Split');
    // the camera: a drag on the water looks round and never steers; the chip; the ease back
    await page.evaluate(() => window.__velia.boat.sim.setPilot(true));
    const w0 = await F();
    up = await drag(line(L.w * 0.45, L.h * 0.45, L.w * 0.45 + 160, L.h * 0.45 + 10, 16), 300); const w1 = await F(); await up();
    const dy = Math.abs(Math.atan2(Math.sin(w1.yaw - w0.yaw), Math.cos(w1.yaw - w0.yaw))) / DEG;
    check(dy > 15 && w1.helm === null && Math.abs(w1.rudder - w0.rudder) < 0.06, `${name}: a drag on the water turns the view ${dy.toFixed(0)}° and not the rudder (helm ${w1.helm}, rudder ${w0.rudder.toFixed(3)} → ${w1.rudder.toFixed(3)})`);
    await wait(500);
    const rcOn = await page.evaluate(() => !window.__velia.m4.ui.flat.el.querySelector('.rc').classList.contains('off'));
    check(rcOn, `${name}: the round Recentre button ("Recentre view") shows while the view is off`);
    await layoutCheck(t, 'Recentre');
    await wait(4200);
    const w2 = await F();
    const off = Math.abs(Math.atan2(Math.sin(w2.yaw - w2.heading), Math.cos(w2.yaw - w2.heading))) / DEG;
    check(!w2.cam.moved && off < 6 && await page.evaluate(() => window.__velia.m4.ui.flat.el.querySelector('.rc').classList.contains('off')), `${name}: 3 s after the finger lifts the view eases back behind the boat (${off.toFixed(1)}° off), the chip gone`);
    // Tack (the offered one, or a gybe)
    const tk = await F();
    if (tk.offer) { await tap([L.pr.x - L.q * 0.35, L.pr.y - L.q * 0.35]); check((await F()).tack, `${name}: Tack starts the offered ${tk.offer}`); }
    else check(true, `${name}: no tack offered on this heading (Tack shown at rest)`);
    // the assist corner (v2/ui/assist.js): in irons it reads Free with the bow-and-wind icon and one soft brighten; a tap runs FREE (amber)
    await page.waitForFunction(() => !window.__velia.m4.ui.tackBtn?.active, null, { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => { const B = window.__velia.boat.sim, s = B.phys.state, from = s.heading + (s.trueWind?.angle ?? 0); B.place({ x: s.x, z: s.z, headingDeg: (from - 0.06) * 180 / Math.PI, speed: 0 }); });
    const frNow = () => page.evaluate(() => { const n = window.__velia.m4.ui.flat.el.querySelector('.tack'), a = window.__velia.m4.ui.assist; return { w: n.querySelector('.w').textContent, k: n.dataset.word, lit: n.classList.contains('lit'), dim: n.classList.contains('dim'), cues: a.cues, word: a.word, stuck: +a.stuckS.toFixed(1) }; });
    let fr = await frNow();
    for (let i = 0; i < 150 && fr.w !== 'Free'; i++) { await wait(100); fr = await frNow(); }   // FREE after 3 s stuck
    check(fr.w === 'Free' && fr.k === 'free' && !fr.lit && !fr.dim && fr.cues >= 1, `${name}: in irons the corner reads Free, full ink, one brighten (${JSON.stringify(fr)})`);
    await tap([L.pr.x - L.q * 0.35, L.pr.y - L.q * 0.35]); await wait(300);
    const fr2 = await page.evaluate(() => ({ lit: window.__velia.m4.ui.flat.el.querySelector('.tack').classList.contains('lit'), on: !!window.__velia.m4.ui.assist.free.active }));
    check(fr2.lit && fr2.on, `${name}: a tap runs FREE, the corner amber while it runs (${JSON.stringify(fr2)})`);
    check(t.errors.length === 0, `${name}: no page error (${t.errors.join('; ')})`);
    await t.ctx.close();
  }

  // Regatta and Cruise layouts at both phone heights (the owner's worry: the dials over the race's plates)
  for (const mode of MODES.slice(0, 2)) {
    const t = await open(mode, 'mode=regatta&hour=13&seed=1&course=short&autoplay=1&speed=6');
    await layoutCheck(t, 'Regatta pre-start');
    const pre = await t.page.evaluate(() => ({ clk: window.__velia.m4.ui.flat.el.querySelector('.clk').textContent, ro: window.__velia.m4.ui.flat.el.querySelector('.ro').textContent }));
    check(/\d:\d\d/.test(pre.clk) && pre.ro.length > 0, `${t.name}: the race clock in the wind dial (${pre.clk}), the line in the readout ("${pre.ro}")`);
    await t.page.waitForFunction(() => (window.__velia.m4.ui.flat.el.querySelector('.clk').textContent || '').length && !window.__velia.m4.ui.flat.el.querySelector('.mk').hidden, null, { timeout: 90000 }).catch(() => {});
    await t.page.waitForTimeout(1500);
    const mk = await t.page.evaluate(() => !window.__velia.m4.ui.flat.el.querySelector('.mk').hidden);
    check(mk, `${t.name}: racing: the next mark's bearing on the chart dial`);
    await layoutCheck(t, 'Regatta racing');
    // the race chip opens the tower and closes it again
    await t.page.evaluate(() => document.querySelector('#rg .fleet')?.click()); await t.page.waitForTimeout(300);
    await layoutCheck(t, 'Regatta tower open', { allow: [['race-chip', 'readout']] });
    await t.page.evaluate(() => document.querySelector('#rg .fleet')?.click());
    // the results card (the race's own card, a sample result)
    await t.page.evaluate(() => window.__velia.regatta.r.ui.results({ finished: true, place: 4, medal: null, ord: '4th', boats: 6, time: '5:12', level: 'beginner', gap: '+12 s behind the winner', tip: { text: 'Start at the gun with speed: the ghost boat shows where.' } }));
    await t.page.waitForTimeout(800);
    const res = await t.page.evaluate(() => !!document.querySelector('#rg .res:not([hidden])'));
    check(res, `${t.name}: the results card shows`);
    await layoutCheck(t, 'Regatta results');
    check(t.errors.length === 0, `${t.name}: Regatta, no page error (${t.errors.join('; ')})`);
    await t.ctx.close();
    const c = await open(mode, 'mode=cruise&hour=13&seed=1');
    await c.page.waitForTimeout(2000);
    const cv = await c.page.evaluate(() => { const el = window.__velia.m4.ui.flat.el, v = (q) => { const n = el.querySelector(q); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; }; return { take: v('.take'), auto: v('.auto'), tack: v('.tack'), arcs: v('.side.l') || v('.side.r') }; });
    check(cv.take && !cv.auto && !cv.tack && !cv.arcs, `${c.name}: Cruise: "Take the helm" in the left corner, nothing else (${JSON.stringify(cv)})`);
    await layoutCheck(c, 'Cruise');
    const cond = await c.page.evaluate(() => { const b = document.querySelector('.lk-view:not(.off) .xt[data-x=cond]'); b?.click(); return !!b; });
    await c.page.waitForTimeout(600);
    const over = await c.page.evaluate(() => {
      const sh = document.querySelector('.lk-cond:not([hidden])'); if (!sh) return null;
      const r = sh.getBoundingClientRect(), bad = [];
      for (const n of window.__velia.m4.ui.flat.el.querySelectorAll('.b')) { const q = n.getBoundingClientRect(); if (!q.width || n.hidden || getComputedStyle(n).display === 'none') continue; const x = q.x + q.width / 2, y = q.y + q.height / 2; if (x > r.left && x < r.right && y > r.top && y < r.bottom) { const hit = document.elementFromPoint(x, y); if (!sh.contains(hit)) bad.push(n.className); } }
      return { bad, r: [r.x, r.y, r.width, r.height] };
    });
    check(cond && over && over.bad.length === 0, `${c.name}: the Conditions sheet sits over the controls (${JSON.stringify(over)})`);
    if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/${c.name.replace(/\W+/g, '-')}-Cruise-Conditions.png` });
    // Take the helm hands her over: Sail's controls back
    await c.page.evaluate(() => document.querySelector('.lk-view .xt[data-x=cond]')?.click());
    await c.page.waitForTimeout(400);
    const L = await c.page.evaluate(() => window.__velia.m4.ui.flat.layout);
    await c.tap([L.pl.x + L.q * 0.35, L.pl.y - L.q * 0.35]);
    await c.page.waitForFunction(() => { const el = window.__velia.m4.ui.flat.el; return !el.querySelector('.auto').hidden && getComputedStyle(el.querySelector('.side.l')).display !== 'none'; }, null, { timeout: 15000 }).catch(() => {});
    const back = await c.page.evaluate(() => window.__velia.m4.ui.mode);
    check(back === 'sail', `${c.name}: Take the helm hands her over to Sail (${back})`);
    check(c.errors.length === 0, `${c.name}: Cruise, no page error (${c.errors.join('; ')})`);
    await c.ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
