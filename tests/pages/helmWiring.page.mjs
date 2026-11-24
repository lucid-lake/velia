// The live wiring of the helm's UI in a real browser (it needs the world, so the GPU): what the fast suite cannot reach without
// building Sail's whole controls (src/sail/controls.js), Cruise and Regatta.
//   Sail: the top bar's events go to the subtitle line; a wind key says its level there; the chart's dock key (N, between the
//         logbook and the binoculars); TRIM is the dock's always-live 'pro' switch, its ring and the Pro trim panel follow the one flag;
//         the trim panel's VHF button switches the captain's radio; the helm view's wheel, winches and sheets send no gloss (only the radio's LCD).
//   Cruise: a status goes to Cruise's one quiet line; its radio never speaks the forecast by itself.
//   Regatta: the race lays its course quietly (no "marks laid" line); with the VHF off the race officer's hails are words only, on they play.
//   All three: B is the binoculars' toggle (pressed and let go they stay up 2 s later; B again lowers them).
// Run by `npm run test:pages` (LAKESHORE_BASE set), or node tests/pages/helmWiring.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// the first-visit card and staging stand aside; kayakCam off: the kayaks' notice shot folds the cockpit mid-test (since 987505d)
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, kayakCam: false };
const words = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, settings = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const requests = []; page.on('request', (r) => requests.push(r.url()));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, { ...SEEN, ...settings });
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  return { page, errors, requests };
}
// B is the binoculars' toggle, the same as the dock's icon (owner, 2026-11-12): pressed and let go they stay up, B again lowers them
async function binoToggle(page, mode) {
  const st = () => page.evaluate(() => ({ latched: window.__lakeshore.captainTools.latched, k: +window.__lakeshore.captainTools.k.toFixed(3) }));
  await page.keyboard.down('KeyB'); await page.waitForTimeout(150); await page.keyboard.up('KeyB'); await page.waitForTimeout(2000);
  const up = await st();
  check(up.latched === true && up.k > 0.95, `${mode}: B pressed and let go, 2 s later the glasses are still up (${JSON.stringify(up)})`);
  await page.keyboard.press('KeyB'); await page.waitForTimeout(1000);
  const down = await st();
  check(down.latched === false && down.k < 0.05, `${mode}: B again lowers them (${JSON.stringify(down)})`);
}
const frames = (page, n = 3) => page.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

try {
  // ---------------- Sail ----------------
  {
    const { page, errors } = await open('mode=sail&hour=12&once=0&noload=1&fv=1&hm=0&chatter=0&hud=full');
    await page.waitForFunction(() => window.__lakeshore?.controls?.ctl && window.__lakeshore?.boat?.phys?.t > 1 && window.__lakeshore?.viewSwitch, null, { timeout: 240000 });
    const hintNow = () => page.evaluate(() => ({ cur: window.__lakeshore.hint.current, text: window.__lakeshore.hint.el.textContent }));

    // the top bar says an event through the subtitle line (controls.js: subtitle → hint.flash), never in the capsule
    await page.evaluate(() => window.__lakeshore.viewSwitch.say('A test of the bar'));
    await frames(page);
    let h = await hintNow();
    check(h.cur === 'flash' && words(h.text) === 'A test of the bar', `the bar's event is a subtitle line (${h.cur}: "${words(h.text)}")`);
    check(!(await page.evaluate(() => window.__lakeshore.viewSwitch.el.textContent)).includes('A test of the bar'), 'the capsule carries no line');

    // a wind key: the new level is an event line
    const was = await page.evaluate(() => window.__lakeshore.controls.level);
    const to = was === 1 ? 2 : 1;
    await page.keyboard.press(`Digit${to}`); await frames(page);
    h = await hintNow();
    check(h.cur === 'flash' && words(h.text) === `Wind level ${to}`, `a wind change says its level (${h.cur}: "${words(h.text)}")`);

    // the chart in the dock: N, between the logbook (20) and the binoculars (30)
    const dock = await page.evaluate(() => { const d = window.__lakeshore.dock, s = d.spec('chart'); return { key: s?.key, code: s?.code, order: s?.order, log: d.spec('logbook')?.order, bino: d.spec('binoculars')?.order,
      dom: [...d.el.querySelectorAll('.it')].map((b) => b.dataset.id) }; });
    check(dock.key === 'N' && dock.code === 'KeyN', `the chart's key is N (${dock.key}, ${dock.code})`);
    check(dock.log < dock.order && dock.order < dock.bino && dock.dom.indexOf('logbook') < dock.dom.indexOf('chart') && dock.dom.indexOf('chart') < dock.dom.indexOf('binoculars'),
      `the chart sits between the logbook and the binoculars (${dock.log} < ${dock.order} < ${dock.bino}; ${dock.dom.join(' ')})`);

    // TRIM: the dock's 'pro' entry, always live; it flips the controls' one flag. On the cockpit (stage 2, a desktop) the PRO recess
    // is the trim's hardware: its cover opens with Pro, its PRO button is the switch (the grid keeps its TRIM ring and trim panel)
    const pro = () => page.evaluate(() => { const L = window.__lakeshore, ck = L.station.cockpit; return { pro: L.controls.pro, live: L.dock.visible('pro'), cockpit: !!ck,
      trim: ck ? L.controls.proRecess.shown : L.controls.trimPanel.shown, panel: L.controls.trimPanel.shown, open: ck ? +ck.parts.pro.k.toFixed(2) : null, lever: ck ? ck.parts.pro.toggle?.on ?? null : null,
      ring: ck ? document.querySelector('.lk-pro .c[data-id=pro]').getAttribute('aria-pressed') === 'true' : (() => { const c = L.panel?.cells.find((x) => x.id === 'pro'); return !c || c.hidden ? null : c.on; })() }; });
    let p = await pro();
    check(p.cockpit, 'a 1280 x 720 desktop runs the 3D cockpit');
    check(p.pro === false && p.live === true && !p.ring && !p.trim && p.open === 0 && !p.lever, `basic at the start, TRIM live, the PRO recess closed (flush cover), PRO's toggle down: ${JSON.stringify(p)}`);
    await page.evaluate(() => window.__lakeshore.dock.run('pro')); await page.waitForTimeout(700);
    p = await pro();
    check(p.pro === true && p.ring === true && p.trim === true && p.open === 1 && p.panel === false && p.lever === true, `TRIM turns Pro on: the cover slides aside, PRO lit, its toggle up, no floating trim panel (${JSON.stringify(p)})`);
    await page.evaluate(() => window.__lakeshore.controls.setPro(false)); await page.waitForTimeout(700);
    p = await pro();
    check(p.pro === false && !p.ring && !p.trim && p.open === 0 && !p.lever, `Settings' setPro(false) is the same switch: the cover closes, the toggle down (${JSON.stringify(p)})`);
    // a click on the closed cover is the PRO toggle
    const cells = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.lk-pro .c')].filter((c) => !c.hidden).map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.id, { x: r.x, y: r.y, w: r.width, h: r.height, tab: c.tabIndex }]; })));
    let cs = await cells();
    // look C3 (owner 2026-11-12): BINOS and VHF are push-buttons by the instruments, for every player, so their targets stand open or closed
    check(Object.keys(cs).sort().join() === 'binoculars,pro,radio' && cs.pro.w >= 44 && cs.pro.h >= 44, `closed: one target over the cover, and BINOS's and VHF's (${JSON.stringify(cs)})`);
    await page.mouse.click(cs.pro.x + cs.pro.w / 2, cs.pro.y + cs.pro.h / 2); await page.waitForTimeout(700);
    p = await pro(); cs = await cells();
    check(p.pro === true && p.open === 1, `a click on the cover opens PRO (${JSON.stringify(p)})`);
    const ids = ['pro', 'binoculars', 'radio', 'traveller', 'jibLead', 'vang', 'backstay'];   // look C3: no LOG (the Menu's Logbook, L)
    check(ids.every((id) => cs[id] && cs[id].w >= 44 && cs[id].h >= 44 && cs[id].tab >= 0), `open: seven targets, each ≥ 44 px and focusable (${ids.map((id) => `${id} ${cs[id] ? `${Math.round(cs[id].w)}x${Math.round(cs[id].h)}` : '-'}`).join(', ')})`);
    const over = ids.some((a, i) => ids.slice(i + 1).some((b) => cs[a] && cs[b] && cs[a].x < cs[b].x + cs[b].w - 1 && cs[b].x < cs[a].x + cs[a].w - 1 && cs[a].y < cs[b].y + cs[b].h - 1 && cs[b].y < cs[a].y + cs[a].h - 1));
    check(!over, 'no two targets overlap');
    // look/pro-sliders: no demo on an automated page; a car answers the pointer (its ribs brighten, an ew-resize cursor) and the focus
    const tr = await page.evaluate(() => window.__lakeshore.controls.proRecess.rects.traveller);
    const glow = () => page.evaluate(() => Object.fromEntries(Object.entries(window.__lakeshore.station.cockpit.parts.pro.sliders).map(([k, s]) => [k, +(s.ridge?.emissiveIntensity ?? -1).toFixed(3)])));
    const jl = cs.jibLead;
    await page.mouse.move(jl.x + jl.w / 2, jl.y + jl.h / 2); await frames(page, 3);
    let gw = await glow(); const cur = await page.evaluate(() => getComputedStyle(document.querySelector('.lk-pro .c[data-id=jibLead]')).cursor);
    check(gw.jibLead > 0 && gw.traveller === 0 && gw.vang === 0 && gw.backstay === 0 && cur === 'ew-resize', `hover on JIB LEAD: its car alone brightens, the cursor ew-resize (${JSON.stringify(gw)}, ${cur})`);
    await page.mouse.move(5, 5); await frames(page, 3); gw = await glow();
    check(Object.values(gw).every((x) => x === 0), `off the panel every car at rest (${JSON.stringify(gw)})`);
    await page.focus('.lk-pro .c[data-id=vang]'); await frames(page, 3); gw = await glow();
    check(gw.vang > 0 && gw.jibLead === 0, `focus on VANG brightens its car (${JSON.stringify(gw)})`);
    await page.evaluate(() => document.activeElement?.blur()); await frames(page, 2);
    check(!(await page.evaluate(() => window.__lakeshore.controls.proRecess.demoing)), 'no demo on an automated page');
    // a press anywhere along the track grabs the car: well outboard of the car, near the track's far end
    const before = await page.evaluate(() => window.__lakeshore.controls.ctl.jibLead ?? 0);
    await page.mouse.click(jl.x + jl.w - 6, jl.y + jl.h / 2); await frames(page, 3);
    const after = await page.evaluate(() => window.__lakeshore.controls.ctl.jibLead);
    check(after > 0.85 && after !== before, `a press near JIB LEAD's end grabs its car there (${before} → ${after})`);
    // the TRAVELLER: a drag along its track; the car follows (the 3D f) and the controls' value moves
    await page.mouse.move(tr.a + 2, tr.y + 14); await page.mouse.down();
    for (let i = 0; i <= 10; i++) { await page.mouse.move(tr.a + 2 + (tr.b - tr.a) * i / 10, tr.y + 14); await frames(page, 1); }
    await page.mouse.up(); await page.waitForTimeout(300);
    let v = await page.evaluate(() => ({ trav: window.__lakeshore.controls.ctl.traveller, car: window.__lakeshore.station.cockpit.parts.pro.sliders.traveller.f }));
    check(v.trav > 0.85 && v.car > 0.9, `a drag along TRAVELLER: the traveller up, the car at the end (${JSON.stringify(v)})`);
    // the BACKSTAY by keyboard: focus, End, an arrow
    await page.focus('.lk-pro .c[data-id=backstay]'); await page.keyboard.press('End'); await frames(page, 2);
    v = await page.evaluate(() => ({ bs: window.__lakeshore.controls.ctl.backstay, aria: document.querySelector('.lk-pro .c[data-id=backstay]').getAttribute('aria-valuenow') }));
    check(v.bs === 1, `BACKSTAY by keys: End sets it on (${JSON.stringify(v)})`);
    await page.keyboard.press('ArrowLeft'); await frames(page, 3);
    v = await page.evaluate(() => ({ bs: window.__lakeshore.controls.ctl.backstay, car: window.__lakeshore.station.cockpit.parts.pro.sliders.backstay.f }));
    check(Math.abs(v.bs - 0.95) < 1e-6 && Math.abs(v.car - 0.95) < 0.01, `an arrow steps it 5 % and the car follows (${JSON.stringify(v)})`);
    // VANG reads the twist from the vang's side
    await page.focus('.lk-pro .c[data-id=vang]'); await page.keyboard.press('End'); await frames(page, 2);
    v = await page.evaluate(() => window.__lakeshore.controls.ctl.twist);
    check(v === -1, `VANG on: the twist closed (${v})`);
    await page.evaluate(() => document.activeElement?.blur());

    // VHF (look C3: a push-button by the wind instrument, its ring amber while on): the captain's radio on and off, saved
    const radio = () => page.evaluate(() => ({ on: window.__lakeshore.captainTools.on, saved: window.__lakeshore.settings?.get?.('vhf'), pressed: document.querySelector('.lk-pro .c[data-id=radio]').getAttribute('aria-pressed'), lit: String(window.__lakeshore.station.cockpit.parts.tools.radio.on).startsWith('true') }));
    let r = await radio();
    check(r.on === true && r.pressed === 'true' && r.lit === true, `the radio is on by default, VHF lit (${JSON.stringify(r)})`);
    await page.click('.lk-pro .c[data-id=radio]'); await frames(page, 4);
    r = await radio();
    check(r.on === false && r.saved === false && r.pressed === 'false' && r.lit === false, `the VHF button turns the radio off (${JSON.stringify(r)})`);
    await page.click('.lk-pro .c[data-id=radio]'); await frames(page, 4);
    r = await radio();
    check(r.on === true && r.saved === true, `and on again (${JSON.stringify(r)})`);
    // BINOS (look C3: a push-button by the chart instrument): a click raises the glasses (the same as B)
    await page.click('.lk-pro .c[data-id=binoculars]'); await page.waitForTimeout(1200);
    v = await page.evaluate(() => ({ latched: window.__lakeshore.captainTools.latched, k: +window.__lakeshore.captainTools.bino.k.toFixed(2) }));
    check(v.latched || v.k > 0.5, `BINOS raises the binoculars (${JSON.stringify(v)})`);
    await page.keyboard.press('KeyB'); await page.waitForTimeout(1500);
    v = await page.evaluate(() => window.__lakeshore.captainTools.latched);
    check(v === false, `B lowers what BINOS raised (latched ${v})`);
    await binoToggle(page, 'Sail');
    // LOG left the cockpit (look C3): the logbook keeps its on-screen path, the Menu's Logbook
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    if (!await page.evaluate(() => !!window.__lakeshore.menu?.isOpen)) { await page.evaluate(() => window.__lakeshore.menu.open()); await page.waitForTimeout(300); }
    await page.click('#lk-load .lk-link[data-go=logbook]'); await page.waitForTimeout(900);
    v = await page.evaluate(() => !!window.__lakeshore.logbook?.logbook?.isOpen);
    check(v, `the Menu's Logbook opens the logbook (${v})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(900);
    if (await page.evaluate(() => !!window.__lakeshore.menu?.isOpen)) { await page.evaluate(() => window.__lakeshore.menu.close()); await page.waitForTimeout(500); }
    await page.evaluate(() => window.__lakeshore.controls.setPro(false)); await page.waitForTimeout(700);

    // the ▲ ▼ steps: only while the pointer is over that winch
    const stp = () => page.evaluate(() => +getComputedStyle(document.querySelector('.lk-helm .stp[data-w=main]')).opacity);
    const mb = await page.evaluate(() => window.__lakeshore.station.rects.main);
    await page.mouse.move(640, 200); await page.waitForTimeout(500);
    const away = await stp();
    await page.mouse.move(mb.x + mb.w / 2, mb.y + mb.h / 2); await page.waitForTimeout(500);
    const onW = await stp();
    await page.mouse.move(640, 200); await page.waitForTimeout(500);
    check(away === 0 && onW === 1 && (await stp()) === 0, `the steps show only under the pointer (away ${away}, over ${onW})`);
    // the flag: hidden while the sail draws, amber while it luffs or stalls
    const leaf = () => page.evaluate(() => { const n = document.querySelector('.lk-helm .leaf[data-w=main]'); return { s: n.dataset.s, op: +getComputedStyle(n).opacity }; });
    await page.evaluate(() => window.__lakeshore.station.forceMarker('draw')); await page.waitForTimeout(500);
    const lDraw = await leaf();
    await page.evaluate(() => window.__lakeshore.station.forceMarker('luff')); await page.waitForTimeout(500);
    const lLuff = await leaf();
    await page.evaluate(() => window.__lakeshore.station.forceMarker(null));
    check(lDraw.op === 0 && lLuff.op === 1, `the sail's flag: hidden drawing, shown luffing (${JSON.stringify([lDraw, lLuff])})`);

    // the wheel's rim and spokes take the drag (fix/wheel-rim-drag; owner, 2026-11-12: "I need to drag inner the wheel not on the wheel
    // itself"): a press on the rim the player sees, at its top, left and right and the two upper diagonals (the hub stands at the
    // screen's foot, so the rim's bottom is below the edge), reaches the wheel's pad, and a drag along the rim from there turns the rudder
    // the way the hand goes; the inner area still does
    {
      const geo = await page.evaluate(() => { const s = window.__lakeshore.station; return { hub: s.screen.wheel, r: s.rects.wheel.w / 2, h: innerHeight }; });
      const rud = () => page.evaluate(() => window.__lakeshore.boat.phys.state.rudderAngle * 180 / Math.PI);
      const at = (a, f) => ({ x: geo.hub.x + Math.cos(a) * geo.r * f, y: Math.min(geo.h - 1, geo.hub.y + Math.sin(a) * geo.r * f) });
      const rows = [];
      // dir: the way the hand goes along the rim (+1 clockwise: starboard); the sides go up the rim (their foot is the screen's edge)
      for (const [name, deg, f, side] of [['top', -90, 1.04, 0], ['left', 180, 1.04, 1], ['right', 0, 1.04, -1], ['upper left', -135, 1.04, 0], ['upper right', -45, 1.04, 0], ['inner', -45, 0.55, 0]]) {
        const a = deg * Math.PI / 180, p = at(a, f);
        const onPad = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.lk-helm .pad.wheel'), [p.x, p.y]);
        const r0 = await rud(), dir = side || (r0 > 0 ? -1 : 1);   // else toward the other side, so the rudder never stalls on its stop
        await page.mouse.move(p.x, p.y); await page.mouse.down();
        for (let i = 1; i <= 8; i++) { const q = at(a + dir * 0.5 * i / 8, f); await page.mouse.move(q.x, q.y); }
        await page.waitForTimeout(700);
        const r1 = await rud(); await page.mouse.up(); await page.waitForTimeout(200);
        rows.push({ name, onPad, d: +(r1 - r0).toFixed(1), ok: onPad && Math.sign(r1 - r0) === dir && Math.abs(r1 - r0) > 2 });
      }
      check(rows.every((r) => r.ok), `a press on the wheel's rim (top, left, right, both upper diagonals) and inside it, then a drag, turns the rudder (${JSON.stringify(rows)}; hub y ${geo.hub.y.toFixed(0)} of ${geo.h}, rim r ${geo.r.toFixed(0)})`);
    }

    // the fold button (look/cockpit-fold, two states only): the whole cockpit sinks out of view, no peek, no pucks; the bottom strip
    // brings it all back
    const fold = () => page.evaluate(() => { const L = window.__lakeshore, vis = (q) => { const n = document.querySelector(q); return !!n && getComputedStyle(n).visibility !== 'hidden' && +getComputedStyle(n).opacity > 0.5; };
      const n = L.calm.view.need, ck = L.station.cockpit, down = ck.sink > 0.95 || (L.calm.mode === 'instruments' && (n.jib || n.main || n.trim) && Math.abs(ck.sink - ck.peek) < 0.01);   // Instruments keeps the safety peek
      return { folded: L.calm.folded, sink: +ck.sink.toFixed(2), down, peek: n.jib || n.main || n.trim, tab: !L.station.foldTab.hidden, up: L.station.foldTab.classList.contains('up'), hdg: vis('button.lk-puck.chart'), awa: vis('button.lk-puck.wind'), wind: vis('.lk-cv'), inst: !!L.station.instruments?.wind.btn, pro: L.controls.proRecess.rects }; });
    const tabBox = () => page.evaluate(() => { const r = window.__lakeshore.station.foldTab.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
    let tb = await tabBox();
    check(tb.w >= 44 && tb.h >= 44, `the fold mark: a ${tb.w} x ${tb.h} target`);
    await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(1300);
    let fo = await fold();
    check(fo.folded && fo.sink === 1 && fo.tab && fo.up && !fo.peek && !fo.hdg && !fo.awa && !fo.wind && fo.pro === null, `a click on the mark on the hub folds it all away: sunk whole, no peek, no pucks, no dial; the handle stays (${JSON.stringify(fo)})`);
    tb = await tabBox();
    check(tb.y + tb.h / 2 >= 720 - 1, `folded, the handle sits at the very bottom edge (${JSON.stringify(tb)})`);
    await page.mouse.click(1000, 712); await page.waitForTimeout(1300);
    fo = await fold();
    check(!fo.folded && fo.sink < 0.02 && !fo.up && !fo.hdg && !fo.awa && !fo.wind && fo.inst, `the bottom strip brings it all back: the instruments in the coaming, no floating dial (${JSON.stringify(fo)})`);
    // the instruments (feat/cockpit-dials): the faces drawn; the pointer on the wind instrument raises its full view, away it sinks
    const ins = () => page.evaluate(() => { const i = window.__lakeshore.station.instruments, n = document.querySelector('.lk-cv'), cs = getComputedStyle(n);
      return { at: i.wind.at, up: i.wind.up, vis: cs.visibility !== 'hidden' && +cs.opacity > 0.5, draws: i.draws, btn: i.wind.btn && i.chart.btn }; });
    await page.mouse.move(640, 200); await page.waitForTimeout(700);
    let iw = await ins();
    check(iw.btn && !iw.up && !iw.vis && iw.draws.wind > 0 && iw.draws.chart > 0 && iw.at.w >= 60, `the instruments: drawn faces, their targets, no raised view (${JSON.stringify(iw)})`);
    await page.mouse.move(iw.at.cx, iw.at.cy, { steps: 5 }); await page.waitForTimeout(800);
    const raised = await ins();
    await page.mouse.move(640, 200, { steps: 5 }); await page.waitForTimeout(1000);
    iw = await ins();
    check(raised.up && raised.vis && !iw.up && !iw.vis, `hovering the wind instrument raises its full view; away, it sinks (${JSON.stringify([raised.up, raised.vis, iw.up, iw.vis])})`);
    // H is the fold button's key: a tap lowers the whole cockpit, a tap raises it (the presets stay Full; Settings has them)
    const seq = [];
    for (let i = 0; i < 2; i++) { await page.keyboard.press('KeyH'); await page.waitForTimeout(900); seq.push(await page.evaluate(() => ({ m: window.__lakeshore.calm.mode, sink: +window.__lakeshore.station.cockpit.sink.toFixed(2) }))); seq.at(-1).down = (await fold()).down; }
    check(seq.map((x) => x.m).join() === 'full,full' && seq[0].down && seq[0].sink === 1 && seq[1].sink < 0.02, `H: ${JSON.stringify(seq)}`);

    // the helm view: the parts glow under the mouse, but only the radio's LCD glosses a term (knot)
    // the sail-plan glyph (captainView.js, a DOM dial at the bottom right) glosses its own hit areas (helm, jib, mainsheet)
    // on pointerenter, on purpose: that is the 2D glyph, not the helm view's 3D parts, so a gloss whose point lies on the
    // glyph is told apart (glyph: true) and left out of the 3D check below
    await page.evaluate(() => { window.__lakeshore.controls.setView('helm'); window.__gl = []; addEventListener('lk-gloss', (e) => { const d = e.detail ?? {}; window.__gl.push({ term: d.term, part: window.__lakeshore.helmPick.hovered?.name ?? window.__lakeshore.helmPick.hovered?.id ?? null, glyph: !!document.elementFromPoint(d.x, d.y)?.closest('.lk-cv') }); }); });
    await page.waitForTimeout(1600);
    const hovered = new Set();
    for (let y = 120; y <= 660; y += 30) for (let x = 40; x <= 1240; x += 40) {
      await page.mouse.move(x, y); await frames(page, 2);
      const hp = await page.evaluate(() => { const q = window.__lakeshore.helmPick.hovered; return q ? (q.name ?? q.id) : null; });
      if (hp) hovered.add(hp);
    }
    const gl = await page.evaluate(() => window.__gl);
    check([...hovered].some((n) => n !== 'radio'), `the sweep found the helm view's parts (${[...hovered].join(', ') || 'none'})`);
    const gl3d = gl.filter((g) => !g.glyph);
    check(gl3d.every((g) => g.part === 'radio' && g.term === 'knot'), `no gloss for the wheel, the winches or the sheets (${JSON.stringify(gl3d.slice(0, 6))}; ${gl.length - gl3d.length} from the 2D glyph)`);

    // let fly (src/sail/letFly.js): a click on the JIB winch throws its sheet off (the physics' jibFree, the tail flown, the
    // winch's leaf amber); it stays free; a second click grinds it back in
    await page.evaluate(() => window.__lakeshore.controls.setView('follow')); await page.waitForTimeout(1600);
    const flyNow = () => page.evaluate(() => { const L = window.__lakeshore; return { free: L.controls.fly.free.jib, ctl: L.controls.ctl.jibFree, flown: +L.station.flown.jib.toFixed(2), sheet: +(L.boat.phys.state.jibSheet * 57.3).toFixed(0), leaf: document.querySelector('.lk-helm .leaf[data-w=jib]')?.dataset.s, stFree: L.station.free.jib }; });
    const jibBox = await page.evaluate(() => window.__lakeshore.station.rects.jib);
    await page.mouse.move(jibBox.x + jibBox.w / 2, jibBox.y + jibBox.h / 2); await page.waitForTimeout(800);   // the Calm HUD brings the dashboard back first
    await page.mouse.click(jibBox.x + jibBox.w / 2, jibBox.y + jibBox.h / 2); await frames(page, 4); await page.waitForTimeout(1200);
    let f = await flyNow();
    check(f.free && f.ctl && f.stFree && f.flown === 1 && f.sheet >= 79, `a click on the JIB winch lets it fly: the clew to the shrouds, the tail flown (${JSON.stringify(f)})`);
    await page.waitForTimeout(9000);
    f = await flyNow();
    check(f.free && f.leaf === 'luff', `still free after 9 s, its leaf flogging amber (${JSON.stringify(f)})`);
    await page.mouse.click(jibBox.x + jibBox.w / 2, jibBox.y + jibBox.h / 2); await frames(page, 4); await page.waitForTimeout(1500);
    f = await flyNow();
    check(!f.free && !f.ctl && f.flown === 0 && f.sheet < 79, `a second click sheets it back in (${JSON.stringify(f)})`);
    check(errors.length === 0, `Sail: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }

  // ---------------- Cruise ----------------
  {
    const { page, errors } = await open('mode=cruise&hour=12&once=0&noload=1');
    await page.waitForFunction(() => window.__lakeshore?.cruiseView && window.__lakeshore?.cruiseLine && window.__lakeshore?.captainTools, null, { timeout: 240000 });
    await page.evaluate(() => window.__lakeshore.cruiseView.say('A test of the bar'));
    await frames(page);
    const line = await page.evaluate(() => [...document.querySelectorAll('.lk-chill')].map((e) => e.textContent));
    check(line.includes('A test of the bar'), `Cruise says a status on its one quiet line (${JSON.stringify(line)})`);
    check(!(await page.evaluate(() => window.__lakeshore.cruiseView.el.textContent)).includes('A test of the bar'), 'not in the capsule');
    // the passenger's radio: no forecast by itself (Sail's starts after 20 s)
    await page.waitForTimeout(26000);
    const t = await page.evaluate(() => ({ fc: window.__lakeshore.captainTools.forecast, ch: window.__lakeshore.captainTools.channel }));
    check(t.fc == null && t.ch === '16', `Cruise's radio stays quiet after 26 s (${JSON.stringify(t)})`);
    await binoToggle(page, 'Cruise');
    check(errors.length === 0, `Cruise: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }

  // ---------------- Regatta ----------------
  {
    // the VHF off; the Sail tools' own forecast, harbour master and chatter off (?fv, ?hm, ?chatter): the race's radio is the only voice
    const { page, errors, requests } = await open('mode=regatta&hour=15&once=0&noload=1&fv=1&hm=0&chatter=0', { vhf: false });
    await page.waitForFunction(() => window.__lakeshore?.regatta && window.__lakeshore?.hint, null, { timeout: 240000 });
    const m = await page.evaluate(() => ({ log: window.__lakeshore.regatta.marks.log.map((l) => l.text), marks: window.__lakeshore.regatta.marks.field.marks.length }));
    check(m.marks > 0 && !m.log.some((l) => /marks laid/.test(l)), `the race lays its course quietly (${m.marks} marks; log ${JSON.stringify(m.log)})`);
    await page.evaluate(() => { window.__flashes = []; const L = window.__lakeshore; const f = () => { if (L.hint.current === 'flash') { const s = L.hint.el.textContent.replace(/\s+/g, ' ').trim(); if (window.__flashes.at(-1) !== s) window.__flashes.push(s); } requestAnimationFrame(f); }; f(); });
    // Start only once the briefing (briefingUi.js) is up. The shell's settings may not be on the page yet; the officer's first
    // call now reads the saved 'vhf' itself (settingsNow, src/ui/settings.js; fix/regatta-watchdog-vhf), and the play watchdog
    // no longer reloads on the briefing card. This wait stays so the check starts from the shell's copy of the setting.
    await page.waitForFunction(() => !!document.querySelector('.lk-bf:not([hidden])') && window.__lakeshore.settings?.get?.('vhf') === false, null, { timeout: 60000 });
    await page.keyboard.press('Enter');   // the briefing's Start (a gesture: the sound may start)
    await page.waitForFunction(() => !document.querySelector('.lk-bf:not([hidden])') && window.__lakeshore.boat?.phys?.t > 0, null, { timeout: 10000 });
    await page.waitForTimeout(500); await page.keyboard.press('ShiftLeft');   // skips the rival's intro
    const officer = () => page.evaluate(() => window.__flashes.filter((s) => /^Race committee:/.test(s)));
    const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await page.waitForTimeout(250); } return null; };
    const first = await until(async () => (await officer())[0], 30000);
    const sprite = () => requests.filter((u) => /\/audio\/vhf\/forecast\.opus/.test(u)).length;
    check(!!first, `the officer's call is said on the subtitle line (${first})`);
    check(sprite() === 0, `with the VHF off the call is words only: no radio played (${sprite()} sprite loads)`);
    await page.evaluate(() => window.__lakeshore.settings.set('vhf', true));
    const n0 = (await officer()).length;
    const next = await until(async () => (await officer()).length > n0, 45000);
    check(!!next && sprite() > 0, `on, the next call plays on the radio (${sprite()} sprite loads; calls ${JSON.stringify(await officer())})`);
    await binoToggle(page, 'Regatta');
    check(errors.length === 0, `Regatta: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
