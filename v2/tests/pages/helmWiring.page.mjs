// v2 port of tests/pages/helmWiring.page.mjs: the live wiring of the helm's UI on the v2 page (v2/ui/sail.js, v2/ui/station.js,
// v2/render/cockpit/rig.js), Sail only.
//   Sail: the top bar's tips go to the subtitle line, its chatter and a wind key's level never (the lean skipper); TRIM is the dock's always-live 'pro' switch,
//         the PRO recess (its cover, its toggle, its ring) follows the one flag; the sliders answer the pointer, a press, a drag and the
//         keys; the winches' steps and flags; the wheel's rim takes the drag; the fold mark and the bottom strip; the instruments;
//         H; the helm view sends no gloss for the wheel, the winches or the sheets; let fly on the JIB winch.
// Map: __lakeshore.controls.{pro, setPro, proRecess, trimPanel} → __velia.m4.ui.{pro, setPro, proRecess, trimPanel};
//      controls.ctl → __velia.boat.sim.ctl; controls.level → __velia.boat.wind.level; dock → m4.ui.services.get('dock');
//      station / calm / hint / viewSwitch → m4.ui.*; controls.setView(v) → m4.ui.views.set(v); boat.phys → __velia.boat.sim.phys;
//      station.cockpit.parts.pro.{k, toggle.on, sliders[id].{f, ridge.emissiveIntensity}} → the rig's own state (rig.proK, the toggle
//      LED's material, the car's offset along its travel, the ridge material's emissive).
// Dropped with v1's modes: Cruise (its quiet line, its radio) and Regatta (the race's course, the officer's hails): v2 has Sail only.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/helmWiring.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
// a check that v1 passes and v2's UI does not (a v2 difference, reported to v2/ui's owner): the same check, its reason on a fail
const v2bug = (ok, what, why) => check(ok, ok ? what : `${what}  [v2 differs from v1: ${why}]`);
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const words = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, settings = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, { ...SEEN, ...settings });
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  return { page, errors };
}
const frames = (page, n = 3) => page.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

try {
  // ---------------- Sail ----------------
  {
    const { page, errors } = await open('mode=sail&hour=12&once=0&noload=1&fv=1&hm=0&chatter=0&hud=full');
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.station?.cockpit && window.__velia.boat?.sim?.t > 1 && window.__velia.m4.ui.viewSwitch, null, { timeout: 240000 });
    const hintNow = () => page.evaluate(() => ({ cur: window.__velia.m4.ui.hint.current, text: window.__velia.m4.ui.hint.el.textContent }));

    // the top bar's events go through the lean skipper (v2/ui/leanSkipper.js, owner 2026-11-17): a status or chatter line (CHAT) never
    // takes the row; its first-time tip (the helm-view nudge, TIP) shows on the subtitle line (subtitle → hint.flash); never in the capsule
    await page.evaluate(() => window.__velia.m4.ui.viewSwitch.say('A test of the bar'));
    await frames(page);
    let h = await hintNow();
    check(h.cur !== 'flash' && !words(h.text).includes('A test of the bar'), `the bar's chatter never takes the subtitle line (${h.cur}: "${words(h.text)}")`);
    const TIP = 'Tap Helm for the helm view';
    await page.evaluate((t) => window.__velia.m4.ui.viewSwitch.say(t), TIP);
    await frames(page);
    h = await hintNow();
    check(h.cur === 'flash' && words(h.text) === TIP, `the bar's tip is a subtitle line (${h.cur}: "${words(h.text)}")`);
    check(!(await page.evaluate(() => window.__velia.m4.ui.viewSwitch.el.textContent)).match(/A test of the bar|Tap Helm for the helm view/), 'the capsule carries no line');

    // a number key: the wind keys left the keyboard in the lean keys round (the Conditions pill sets the wind), so the level stays and no "Wind level" status shows
    const was = await page.evaluate(() => window.__velia.boat.wind.level);
    const to = was === 1 ? 2 : 1;
    await page.keyboard.press(`Digit${to}`); await frames(page);
    h = await hintNow();
    const lvl = await page.evaluate(() => window.__velia.boat.wind.level);
    check(lvl === was && !/Wind level/.test(words(h.text)), `a number key leaves the wind alone, no status line (${was} → ${lvl}; ${h.cur}: "${words(h.text)}")`);

    // dropped: the chart's dock key (N, between the logbook and the binoculars): v2 has no chart page and its dock registers no 'chart'

    // TRIM: the dock's 'pro' entry, always live; it flips the one flag. On the cockpit the PRO recess is the trim's hardware: its cover
    // opens with Pro, its PRO toggle is the switch
    const pro = () => page.evaluate(() => { const V = window.__velia, ui = V.m4.ui, ck = ui.station.cockpit, rig = V.m4.cockpit.rig, R = rig.json.roles, dock = ui.services.get('dock');
      const ledMesh = R.pro?.toggle ? rig.json.meshes.findIndex((m) => m.node === R.pro.toggle.led) : -1;
      return { pro: ui.pro, live: dock.visible('pro'), cockpit: !!ck, trim: ck ? ui.proRecess.shown : ui.trimPanel.shown, panel: ui.trimPanel.shown, open: ck ? +rig.proK.toFixed(2) : null,
        lever: ledMesh >= 0 ? rig.matOf[ledMesh] === R.amberOn : null, ring: document.querySelector('.lk-pro .c[data-id=pro]').getAttribute('aria-pressed') === 'true' }; });
    let p = await pro();
    check(p.cockpit, 'a 1280 x 720 desktop runs the 3D cockpit');
    check(p.pro === false && p.live === true && !p.ring && !p.trim && p.open === 0 && !p.lever, `basic at the start, TRIM live, the PRO recess closed (flush cover), PRO's toggle down: ${JSON.stringify(p)}`);
    await page.evaluate(() => window.__velia.m4.ui.services.get('dock').run('pro')); await page.waitForTimeout(700);
    p = await pro();
    check(p.pro === true && p.ring === true && p.trim === true && p.open === 1 && p.panel === false && p.lever === true, `TRIM turns Pro on: the cover slides aside, PRO lit, its toggle up, no floating trim panel (${JSON.stringify(p)})`);
    await page.evaluate(() => window.__velia.m4.ui.setPro(false)); await page.waitForTimeout(700);
    p = await pro();
    check(p.pro === false && !p.ring && !p.trim && p.open === 0 && !p.lever, `setPro(false) is the same switch: the cover closes, the toggle down (${JSON.stringify(p)})`);
    // a click on the closed cover is the PRO toggle
    const cells = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.lk-pro .c')].filter((c) => !c.hidden).map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.id, { x: r.x, y: r.y, w: r.width, h: r.height, tab: c.tabIndex }]; })));
    let cs = await cells();
    // look C3: BINOS and VHF are push-buttons by the instruments, for every player, so their targets stand open or closed
    check(Object.keys(cs).sort().join() === 'binoculars,pro,radio' && cs.pro.w >= 44 && cs.pro.h >= 44, `closed: one target over the cover, and BINOS's and VHF's (${JSON.stringify(cs)})`);
    await page.mouse.click(cs.pro.x + cs.pro.w / 2, cs.pro.y + cs.pro.h / 2); await page.waitForTimeout(700);
    p = await pro(); cs = await cells();
    check(p.pro === true && p.open === 1, `a click on the cover opens PRO (${JSON.stringify(p)})`);
    const ids = ['pro', 'binoculars', 'radio', 'traveller', 'jibLead', 'vang', 'backstay'];
    check(ids.every((id) => cs[id] && cs[id].w >= 44 && cs[id].h >= 44 && cs[id].tab >= 0), `open: seven targets, each ≥ 44 px and focusable (${ids.map((id) => `${id} ${cs[id] ? `${Math.round(cs[id].w)}x${Math.round(cs[id].h)}` : '-'}`).join(', ')})`);
    const over = ids.some((a, i) => ids.slice(i + 1).some((b) => cs[a] && cs[b] && cs[a].x < cs[b].x + cs[b].w - 1 && cs[b].x < cs[a].x + cs[a].w - 1 && cs[a].y < cs[b].y + cs[b].h - 1 && cs[b].y < cs[a].y + cs[a].h - 1));
    check(!over, 'no two targets overlap');
    // no demo on an automated page; a car answers the pointer (its ribs brighten, an ew-resize cursor) and the focus
    const tr = await page.evaluate(() => window.__velia.m4.ui.proRecess.rects.traveller);
    const glow = () => page.evaluate(() => { const rig = window.__velia.m4.cockpit.rig; return Object.fromEntries(Object.entries(rig.json.roles.pro.sliders).map(([k, s]) => [k, +(rig.matState[s.ridgeMat]?.emissive ?? -1).toFixed(3)])); });
    const carF = (id) => page.evaluate((k) => { const rig = window.__velia.m4.cockpit.rig, S = rig.json.roles.pro.sliders[k]; return (rig.nodes[S.car].p[0] - rig.json.nodes[S.car].p[0]) / S.travel + 0.5; }, id);
    const jl = cs.jibLead;
    await page.mouse.move(jl.x + jl.w / 2, jl.y + jl.h / 2); await frames(page, 3);
    let gw = await glow(); const cur = await page.evaluate(() => getComputedStyle(document.querySelector('.lk-pro .c[data-id=jibLead]')).cursor);
    check(gw.jibLead > 0 && gw.traveller === 0 && gw.vang === 0 && gw.backstay === 0 && cur === 'ew-resize', `hover on JIB LEAD: its car alone brightens, the cursor ew-resize (${JSON.stringify(gw)}, ${cur})`);
    await page.mouse.move(5, 5); await frames(page, 3); gw = await glow();
    check(Object.values(gw).every((x) => x === 0), `off the panel every car at rest (${JSON.stringify(gw)})`);
    await page.focus('.lk-pro .c[data-id=vang]'); await frames(page, 3); gw = await glow();
    check(gw.vang > 0 && gw.jibLead === 0, `focus on VANG brightens its car (${JSON.stringify(gw)})`);
    await page.evaluate(() => document.activeElement?.blur()); await frames(page, 2);
    check(!(await page.evaluate(() => window.__velia.m4.ui.proRecess.demoing)), 'no demo on an automated page');
    // a press anywhere along the track grabs the car: well outboard of the car, near the track's far end
    const before = await page.evaluate(() => window.__velia.boat.sim.ctl.jibLead ?? 0);
    await page.mouse.click(jl.x + jl.w - 6, jl.y + jl.h / 2); await frames(page, 3);
    const after = await page.evaluate(() => window.__velia.boat.sim.ctl.jibLead);
    check(after > 0.85 && after !== before, `a press near JIB LEAD's end grabs its car there (${before} → ${after})`);
    // the TRAVELLER: a drag along its track; the car follows and the value moves
    await page.mouse.move(tr.a + 2, tr.y + 14); await page.mouse.down();
    for (let i = 0; i <= 10; i++) { await page.mouse.move(tr.a + 2 + (tr.b - tr.a) * i / 10, tr.y + 14); await frames(page, 1); }
    await page.mouse.up(); await page.waitForTimeout(300);
    let v = { trav: await page.evaluate(() => window.__velia.boat.sim.ctl.traveller), car: await carF('traveller') };
    check(v.trav > 0.85 && v.car > 0.9, `a drag along TRAVELLER: the traveller up, the car at the end (${JSON.stringify(v)})`);
    // the BACKSTAY by keyboard: focus, End, an arrow
    await page.focus('.lk-pro .c[data-id=backstay]'); await page.keyboard.press('End'); await frames(page, 2);
    v = await page.evaluate(() => ({ bs: window.__velia.boat.sim.ctl.backstay, aria: document.querySelector('.lk-pro .c[data-id=backstay]').getAttribute('aria-valuenow') }));
    check(v.bs === 1, `BACKSTAY by keys: End sets it on (${JSON.stringify(v)})`);
    await page.keyboard.press('ArrowLeft'); await frames(page, 3);
    v = { bs: await page.evaluate(() => window.__velia.boat.sim.ctl.backstay), car: await carF('backstay') };
    check(Math.abs(v.bs - 0.9) < 1e-6 && Math.abs(v.car - 0.9) < 0.01, `an arrow steps it 10 % (v2's doubled Pro step) and the car follows (${JSON.stringify(v)})`);
    // VANG reads the twist from the vang's side
    await page.focus('.lk-pro .c[data-id=vang]'); await page.keyboard.press('End'); await frames(page, 2);
    v = await page.evaluate(() => window.__velia.boat.sim.ctl.twist);
    check(v === -1, `VANG on: the twist closed (${v})`);
    await page.evaluate(() => document.activeElement?.blur());

    // dropped: VHF (the captain's radio on and off, saved), BINOS and B (the binoculars raised and lowered, latched): v2 has no
    // captain's tools yet (sail.js's binoculars action says "later"); their two push-buttons' targets are checked above
    // dropped: the Menu's Logbook: v2 has no menu and no logbook
    await page.evaluate(() => window.__velia.m4.ui.setPro(false)); await page.waitForTimeout(700);

    // the ▲ ▼ steps: only while the pointer is over that winch
    const stp = () => page.evaluate(() => +getComputedStyle(document.querySelector('.lk-helm .stp[data-w=main]')).opacity);
    const mb = await page.evaluate(() => window.__velia.m4.ui.station.rects.main);
    await page.mouse.move(640, 200); await page.waitForTimeout(500);
    const away = await stp();
    await page.mouse.move(mb.x + mb.w / 2, mb.y + mb.h / 2); await page.waitForTimeout(500);
    const onW = await stp();
    await page.mouse.move(640, 200); await page.waitForTimeout(500);
    check(away === 0 && onW === 1 && (await stp()) === 0, `the steps show only under the pointer (away ${away}, over ${onW})`);
    // no sail flag by the winches (owner, 2026-11-16: the telltales on the sails show a luff or a stall); the station still knows the state
    const flag = await page.evaluate(() => ({ leaves: document.querySelectorAll('.lk-helm .leaf').length, sails: window.__velia.m4.ui.station.sails }));
    check(flag.leaves === 0 && ['draw', 'luff', 'stall', 'off'].includes(flag.sails.main), `no sail flag by the winches; the station's sail state stays (${JSON.stringify(flag)})`);

    // the wheel's rim and spokes take the drag: a press on the rim at its top, left and right and the two upper diagonals reaches the
    // wheel's pad, and a drag along the rim from there turns the rudder the way the hand goes; the inner area still does
    {
      const geo = await page.evaluate(() => { const s = window.__velia.m4.ui.station; return { hub: s.screen.wheel, r: s.rects.wheel.w / 2, h: innerHeight }; });
      const rud = () => page.evaluate(() => window.__velia.boat.sim.phys.state.rudderAngle * 180 / Math.PI);
      const at = (a, f) => ({ x: geo.hub.x + Math.cos(a) * geo.r * f, y: Math.min(geo.h - 1, geo.hub.y + Math.sin(a) * geo.r * f) });
      const rows = [];
      for (const [name, deg, f, side] of [['top', -90, 1.04, 0], ['left', 180, 1.04, 1], ['right', 0, 1.04, -1], ['upper left', -135, 1.04, 0], ['upper right', -45, 1.04, 0], ['inner', -120, 0.75, 0]]) {   // inner: inside the rim, up and left of the hub; the pilot pad under the hub takes its own clicks (2026-11-16)
        const a = deg * Math.PI / 180, q0 = at(a, f);
        const onPad = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.lk-helm .pad.wheel'), [q0.x, q0.y]);
        const r0 = await rud(), dir = side || (r0 > 0 ? -1 : 1);
        await page.mouse.move(q0.x, q0.y); await page.mouse.down();
        for (let i = 1; i <= 8; i++) { const q = at(a + dir * 0.5 * i / 8, f); await page.mouse.move(q.x, q.y); }
        await page.waitForTimeout(700);
        const r1 = await rud(); await page.mouse.up(); await page.waitForTimeout(200);
        rows.push({ name, onPad, d: +(r1 - r0).toFixed(1), ok: onPad && Math.sign(r1 - r0) === dir && Math.abs(r1 - r0) > 2 });
      }
      check(rows.every((r) => r.ok), `a press on the wheel's rim (top, left, right, both upper diagonals) and inside it, then a drag, turns the rudder (${JSON.stringify(rows)}; hub y ${geo.hub.y.toFixed(0)} of ${geo.h}, rim r ${geo.r.toFixed(0)})`);
    }

    // the fold button (two states only): the whole cockpit sinks out of view, no peek, no pucks; the bottom strip brings it all back
    const fold = () => page.evaluate(() => { const ui = window.__velia.m4.ui, vis = (q) => { const n = document.querySelector(q); return !!n && getComputedStyle(n).visibility !== 'hidden' && +getComputedStyle(n).opacity > 0.5; };
      const n = ui.calm.view.need, ck = ui.station.cockpit, down = ck.sink > 0.95 || (ui.calm.mode === 'instruments' && (n.jib || n.main || n.trim) && Math.abs(ck.sink - ck.peek) < 0.01);
      return { folded: ui.calm.folded, sink: +ck.sink.toFixed(2), down, peek: n.jib || n.main || n.trim, tab: !ui.station.foldTab.hidden, up: ui.station.foldTab.classList.contains('up'), hdg: vis('button.lk-puck.chart'), awa: vis('button.lk-puck.wind'), wind: vis('.lk-cv'), inst: !!ui.station.instruments?.wind.btn, pro: ui.proRecess.rects }; });
    const tabBox = () => page.evaluate(() => { const r = window.__velia.m4.ui.station.foldTab.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
    let tb = await tabBox();
    check(tb.w >= 44 && tb.h >= 44, `the fold mark: a ${tb.w} x ${tb.h} target`);
    await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(1300);
    let fo = await fold();
    check(fo.folded && fo.sink === 1 && fo.tab && fo.up && !fo.peek && !fo.hdg && !fo.awa && !fo.wind && fo.pro === null, `a click on the fold tab folds it all away: sunk whole, no peek, no pucks, no dial; the handle stays (${JSON.stringify(fo)})`);
    tb = await tabBox();
    check(tb.y + tb.h / 2 >= 720 - 1, `folded, the tab sits at the very bottom edge (${JSON.stringify(tb)})`);
    tb = await tabBox(); await page.mouse.click(tb.x, tb.y); await page.waitForTimeout(1300);   // the same tab raises it (v2/ui/foldTab.js)
    fo = await fold();
    check(!fo.folded && fo.sink < 0.02 && !fo.up && !fo.hdg && !fo.awa && !fo.wind && fo.inst, `the tab brings it all back: the instruments in the coaming, no floating dial (${JSON.stringify(fo)})`);
    // the instruments: the faces drawn; the pointer on the wind instrument raises its full view, away it sinks
    const ins = () => page.evaluate(() => { const i = window.__velia.m4.ui.station.instruments, n = document.querySelector('.lk-cv'), cs2 = getComputedStyle(n);
      return { at: i.wind.at, up: i.wind.up, vis: cs2.visibility !== 'hidden' && +cs2.opacity > 0.5, draws: i.draws, btn: i.wind.btn && i.chart.btn }; });
    await page.mouse.move(640, 200); await page.waitForTimeout(700);
    let iw = await ins();
    check(iw.btn && !iw.up && !iw.vis && iw.draws.wind > 0 && iw.draws.chart > 0 && iw.at.w >= 60, `the instruments: drawn faces, their targets, no raised view (${JSON.stringify(iw)})`);
    await page.mouse.move(iw.at.cx, iw.at.cy, { steps: 5 }); await page.waitForTimeout(800);
    const raised = await ins();
    await page.mouse.move(640, 200, { steps: 5 }); await page.waitForTimeout(1000);
    iw = await ins();
    check(raised.up && raised.vis && !iw.up && !iw.vis, `hovering the wind instrument raises its full view; away, it sinks (${JSON.stringify([raised.up, raised.vis, iw.up, iw.vis])})`);
    // H is the fold button's key: a tap lowers the whole cockpit, a tap raises it (the presets stay Full)
    const seq = [];
    for (let i = 0; i < 2; i++) { await page.keyboard.press('KeyH'); await page.waitForTimeout(900); seq.push(await page.evaluate(() => ({ m: window.__velia.m4.ui.calm.mode, sink: +window.__velia.m4.ui.station.cockpit.sink.toFixed(2) }))); seq.at(-1).down = (await fold()).down; }
    check(seq.map((x) => x.m).join() === 'full,full' && seq[0].down && seq[0].sink === 1 && seq[1].sink < 0.02, `H: ${JSON.stringify(seq)}`);

    // the helm view: no gloss for the wheel, the winches or the sheets. The sail-plan glyph (captainView.js, a DOM dial at the bottom
    // right) glosses its own hit areas on purpose: a gloss whose point lies on the glyph is told apart (glyph: true) and left out.
    // dropped: "the sweep found the helm view's parts" (v1's helmPick, the 3D parts glowing under the mouse): v2 has no 3D picking in
    // the helm view, and no radio LCD (v1's one allowed gloss, 'knot'), so any 3D gloss here fails
    await page.evaluate(() => { window.__velia.m4.ui.views.set('helm'); window.__gl = []; addEventListener('lk-gloss', (e) => { const d = e.detail ?? {}; window.__gl.push({ term: d.term, part: null, glyph: !!document.elementFromPoint(d.x, d.y)?.closest('.lk-cv') }); }); });
    await page.waitForTimeout(1600);
    for (let y = 120; y <= 660; y += 30) for (let x = 40; x <= 1240; x += 40) { await page.mouse.move(x, y); await frames(page, 2); }
    const gl = await page.evaluate(() => window.__gl);
    const gl3d = gl.filter((g) => !g.glyph);
    check(gl3d.every((g) => g.part === 'radio' && g.term === 'knot'), `no gloss for the wheel, the winches or the sheets (${JSON.stringify(gl3d.slice(0, 6))}; ${gl.length - gl3d.length} from the 2D glyph)`);

    // let fly (src/sail/letFly.js): a click on the JIB winch throws its sheet off (the physics' jibFree, the tail flown, the jib
    // luffing); it stays free; a second click grinds it back in. v1's controls.fly.free.jib → the sim's ctl.jibFree
    await page.evaluate(() => window.__velia.m4.ui.views.set('follow')); await page.waitForTimeout(1600);
    const flyNow = () => page.evaluate(() => { const V = window.__velia, st = V.m4.ui.station; return { ctl: !!V.boat.sim.ctl.jibFree, flown: +st.flown.jib.toFixed(2), sheet: +(V.boat.sim.phys.state.jibSheet * 57.3).toFixed(0), sail: st.sails.jib, stFree: st.free.jib }; });
    const jibBox = await page.evaluate(() => window.__velia.m4.ui.station.rects.jib);
    const WHY = 'a click on the JIB winch must reach the boat (station.takeFly → B.station fly) and the station must show it free (free: () => B.free)';
    await page.mouse.move(jibBox.x + jibBox.w / 2, jibBox.y + jibBox.h / 2); await page.waitForTimeout(800);   // the Calm HUD brings the dashboard back first
    await page.mouse.click(jibBox.x + jibBox.w / 2, jibBox.y + jibBox.h / 2); await frames(page, 4); await page.waitForTimeout(1200);
    let f = await flyNow();
    v2bug(f.ctl && f.stFree && f.flown === 1 && f.sheet >= 79, `a click on the JIB winch lets it fly: the clew to the shrouds, the tail flown (${JSON.stringify(f)})`, WHY);
    // it stays free. Its sail is not checked for a luff: the start is a broad reach (true wind about 126°), and with the apparent wind
    // aft of about 80° a jib eased to 80° still fills, as a real one does (a probe: luff at the throw, draw from about 6 s; sometimes
    // draw at once, by how she sat after the Pro checks above)
    await page.waitForTimeout(9000);
    f = await flyNow();
    v2bug(f.ctl && f.stFree && f.flown === 1 && f.sheet >= 79, `still free after 9 s, the sheet at the stop (${JSON.stringify(f)})`, WHY);
    await page.mouse.click(jibBox.x + jibBox.w / 2, jibBox.y + jibBox.h / 2); await frames(page, 4); await page.waitForTimeout(1500);
    f = await flyNow();
    check(!f.ctl && f.flown === 0 && f.sheet < 79, `a second click sheets it back in (${JSON.stringify(f)})`);
    const ve = await page.evaluate(() => window.__velia.errors.slice());
    check(errors.length === 0 && ve.length === 0, `Sail: no page errors (${[...errors, ...ve].slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // dropped: Cruise (a status on its one quiet line, its radio quiet, B) and Regatta (the course laid quietly, the officer's hails with
  // the VHF off and on, B): v2 has Sail only
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
