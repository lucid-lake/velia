// Cruise on v2 (BACKLOG-v2 #11;: "Sail on a safe autopilot, music on, a background experience"): v1's
// src/modes/chill/ (index.js, voyage.js, passenger.js, handover.js) on v2's page, its own chunk (main.js imports it when Cruise
// is asked for). v1's three-free parts run as they are: the navigator, the AI skipper, the director, the five cameras (voyage.js
// here), the bar (src/ui/viewSwitch.js with Cruise's slots: Menu | Boat ▾ · Take the helm | Locker ▾ | Music Full Setup |
// Wind Weather | clock), the Locker (src/ui/toolDock.js lockerMenu), the one quiet line (src/modes/chill/quietLine.js), the
// passenger's intent rules (intent.js: steering takes the helm; looking, the cameras, the chart, the glasses never do), the
// gamepad's cameras (padCam.js), your mark by a double-tap on the water (markTap.js, the chart's own checks).
//   const C = createCruise({ B, windField, clock, terrain, kayaks, tBase, manifest, flags, P, m4, canvas, sun, aspect, view, hands })
//   await C.ready                        the lake, the chart, the start; C.enter({ fresh }) Cruise sails (fresh: v1's new start)
//   C.on                                 Cruise has the boat (else Sail's hands do: the hand-over)
//   C.step(simDt, dt) / C.camera(dt)     main.js's frame while C.on: the autopilot's step, then the rig's pose (v2's camera chain)
//   C.takeHelm(o) / C.handBack()         the hand-over and back (v1's handover.js), C.speed() the sim seconds a live second runs
// Live pages mount the passenger's UI once Sail's UI is up (its services: the Calm HUD, the menu, the chart, the logbook, the
// captain's tools); a capture has none (C.settle(): v1's settleCapture).
import { feature } from '../../src/core/features.js';   // the binoculars' one rule (owner 2026-11-15: none for a finger-only device)
import { createCruiseVoyage, NO_TRAFFIC } from './voyage.js';
import { lakeOf, loadTops } from './world.js';
import { cruiseMusic } from './music.js';
import { cruiseSchedule, cruiseSpeed } from './plan.js';
import { crownSolid } from '../../src/forest/crowns.js';
import { quietLine } from '../../src/modes/chill/quietLine.js';
import { createViewSwitch, VIEW_ICONS, barClock } from '../../src/ui/viewSwitch.js';
import { mountTopBar, newBarOn } from '../ui/topBar.js';   // the new top bar, the default (?bar=old: the old one)
import { PLACE } from '../../src/sim/place.js';
import { createToolDock, ICONS, lockerMenu } from '../../src/ui/toolDock.js';
import { CAMERA_WORDS, MOVE_S, easePose } from '../../src/modes/chill/cameras.js';
import { CAMERAS, nextCamera } from './cameras.js';   // v2's order: Boat first, Cinematic last (owner, 2026-11-15)
import { keyClass, padIntent } from '../../src/modes/chill/intent.js';
import { PadCam } from '../../src/modes/chill/padCam.js';
import { DoubleTap, createMarkRings, markScreen } from '../../src/modes/chill/markTap.js';
import { checkDestination } from '../../src/sim/modes/chill/navigator.js';
import { handoverTrim } from '../../src/sim/ai/skipper.js';
import { NOTES } from '../../src/ui/skipper.js';
import { cruiseLine, touchNow } from '../../src/ui/modeLines.js';
import { takePhoto, photoName } from '../../src/ui/photo.js';
import { isCoarse } from '../../src/ui/touchMap.js';
import { createModality } from '../../src/ui/pointer.js';
import { DEFAULT_TIMERATE } from '../../src/sim/timeOfDay.js';
import { sailSchedule } from '../engine/clock.js';   // Sail's day clock: no quick night (owner, 2026-11-15)
import { starsCue, STARS_LINE } from '../ui/dayClock.js';   // v1's night-sky line, once a night
import { LEVEL_BLOW } from '../../src/sim/wind.js';
import { WEATHER } from '../../src/sim/weather/weatherMenu.js';
import { START } from '../sim/boat.js';
import { pushOutOk } from '../ui/sailMark.js';   // a double-tap near the boat: the mark further out on its bearing
import { pickVariant } from '../terrain/levels.js';
import { keeps } from '../../src/ui/phoneQuiet.js';   // a phone's Cruise shows no coaching or scenery lines (owner 2026-11-16)

const DEG = Math.PI / 180;
const HANDOVER = { fadeS: 0.6, easeS: 1.0, easeSameS: 0.35 };   // v1's handover.js
const eased = (f) => f * f * (3 - 2 * f);
const CSS = `html.v2-cruise .lk-hint,html.v2-cruise .lk-view:not(.cruisecam),html.v2-cruise .lk-cv,html.v2-cruise .lk-chart .small,html.v2-cruise #hands .btn{display:none!important}
html:not(.v2-cruise) .lk-view.cruisecam{display:none!important}
@keyframes lk-ho-in{from{opacity:0}to{opacity:1}}
.lk-handover .lk-hint,.lk-handover .lk-cv,.lk-handover .lk-view:not(.cruisecam){animation:lk-ho-in .6s var(--lk-ease) both}
@media (prefers-reduced-motion:reduce){.lk-handover .lk-hint,.lk-handover .lk-cv,.lk-handover .lk-view:not(.cruisecam){animation:none}}`;

// sun(): { elevDeg, x, y, z } (main.js's sunNow); aspect(): the canvas's; view(): main's camera now { pos, target, up, fov };
// hands(): main's hands this frame ({ steer, pull, orbit, zoom }: v2/ui/touch.js and the keys)
export function createCruise({ B, windField, clock, terrain, kayaks = null, tBase, manifest, flags, P, m4 = null, canvas = null, sun = () => ({ elevDeg: 20, x: 0, y: 1, z: 0 }), aspect = () => 16 / 9, view = () => null, hands = () => null, onMode = () => {}, music: pageMusic = null, weather = null, stars = () => null, birth = () => null, played = () => false }) {   // birth(): the player's birthplace pose or null (v2/sim/birthplace.js; main.js)   // stars(): { band, coverage, storm, sun } (main.js: the night's levels) for v1's night-sky line   // weather: the Weather menu's state (ENG-5: Cruise's own Storm landing second)   // music: the page's (v2/audio/music.js; null on a capture)
  const live = !P.headless;
  const errors = [];
  let V = null, on = false, lake = null, ui = null, blend = null, handed = false, begun = false;
  const music = cruiseMusic({ music: pageMusic });   // v1's Cruise playlist on the page's music (music.js)
  const trafficK = { agents: (t) => kayaks?.fleet?.agents?.(t) ?? [] };   // the kayaks as the navigator's traffic once v2's fleet gives them (not yet: none)
  const sunDir = () => { const s = sun(); return { x: s.x, y: s.y, z: s.z }; };
  // ---- the world: the lake, the chart, the navigator, the cameras (the forest's crowns after) ----
  const ready = (async () => {
    // the chart: the planner's whole-lake chart (v2/ui/planChart.js; one load a page, shared with Sail's planner and AUTO), so a
    // chart target or a double-tap on the open lake is sailed to (the bay's numbers are v1's buildChart's on the same terrain)
    const [L, chart] = await Promise.all([lakeOf({ kayaks, terrain, tBase, manifest }), import('../ui/planChart.js').then((m) => m.loadPlanChart())]);
    lake = L;
    const reef0 = B.reefSel;   // building the voyage puts the crew's A on the boat: a Sail that loaded Cruise early (the bar's Cruise button warms it) keeps her own reef until she switches
    V = createCruiseVoyage({ B, lake, wind: windField, seed: P.seed, flags, chart, traffic: trafficK, sun: () => sun().elevDeg, birth });
    // the forest as a solid for the cameras' sight lines (v1: the lidar crowns, rasterised once, ≈ 1 s): a capture waits for it
    const crowns = loadTops(pickVariant(flags)).then((tops) => { const s = crownSolid(lake, tops); V.setSolid(s); return s; }).catch((e) => { errors.push(`crowns: ${e?.message ?? e}`); return null; });
    if (!on && B.reefSel !== reef0) B.setReef?.(reef0, { silent: true });
    if (!live) await crowns;
    return V;
  })();

  // ---- the clock and the game speed: v1's Cruise runs its sim at 1 × and its day clock at base 20 (Sail: 2 × and base 10) ----
  const flatOrRate = () => clock.mode === 'rate' && flags.timerate != null && flags.timerate !== '';
  function cruiseClock() { nightHold(false); if (!flatOrRate()) clock.setSchedule?.(cruiseSchedule(flags), clock.t); }
  // the fireworks are a time event (owner, 2026-11-15): Cruise keeps its own day clock through the show (the show keeps its own
  // real-time clock: sim/fireworks.js liveShowClock); only its camera turns toward the show (living/fireworksPlugin.js cruiseCamera)
  // Sail's night wind holds the chosen level (src/sim/wind.js nightHold); Cruise keeps v1's calm night drainage
  const nightHold = (on) => { if (windField && 'nightHold' in windField) windField.nightHold = on; };
  function sailClock() { nightHold(true); if (flatOrRate()) return; if (clock.mode === 'rate') clock.setRate(DEFAULT_TIMERATE, clock.t); else clock.setSchedule?.(sailSchedule(), clock.t); }

  // ---- the passenger's UI (live; once Sail's UI is up: its services) ----
  let line = null, view0 = null, dock = null, rings = null, dbl = null, off = null, padCam = null, sky = null, lookX = 0, lookY = 0;
  const pageUp = () => !!(ui?.services.get('menu')?.isOpen || ui?.services.get('logbook')?.logbook?.isOpen || ui?.chart?.chart?.toggle?.pinned || m4?.captain?.binoUp);
  const loadingUp = () => { const l = document.getElementById('lk-load'); return !!l && l.isConnected && l.dataset.state !== 'gone' && l.dataset.state !== 'menu' && !document.documentElement.classList.contains('lk-nol'); };
  const ownHand = live ? createModality({ coarse: () => isCoarse() }) : null;
  const fingers = () => touchNow(ownHand, isCoarse, ui?.services);
  // the lean skipper (owner 2026-11-17; v2/ui/leanSkipper.js): Cruise's line asks Sail's rule by kind; a refusal (MUST) shows, the
  // look-round line once ever, statuses and replies never. No lean (a test, a capture): every line as before
  const lean = () => m4?.ui?.services?.get?.('lean') ?? null;
  function sayAs(kind, text, ms = 5000) { const L = lean(); if (!L || L.gate(kind)) line?.show(text, ms); }
  function say(text, ms = 5000) { sayAs('cruise.say', text, ms); }

  // your mark (v1's pickDestination): the chart's own checks; a tap on the mark again lets it go
  function pickDestination(pt) {
    const s = B.state, d = V.nav.dest;
    if (d && Math.hypot(pt.x - d.at[0], pt.z - d.at[1]) < 90) { V.nav.clearDestination(); ui?.chart?.chart?.setDestination?.(null); say('Mark cleared. Back to the scenic round.', 4500); return 'cleared'; }
    const r = checkDestination(V.chart, pt.x, pt.z, { from: [s.x, s.z], snapM: pt.name ? 260 : 0 });
    if (!r.ok) { sayAs('refuse.dest', r.say, 5000); return 'refused'; }
    const name = pt.name ?? 'your mark';
    V.nav.setDestination(r.at, { name });
    ui?.chart?.chart?.setDestination?.({ x: r.at[0], z: r.at[1], name: pt.name ?? null });
    say(pt.name ? `Aye. Making for ${pt.name}.` : 'Aye. Setting a course for your mark.', 5000);
    return 'set';
  }
  // the camera as a three-like object for markScreen (view: lookAt, proj: v2's reversed-depth perspective; only x, y, w are read)
  function camShim() {
    const c = view(); if (!c) return null;
    const f = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]], fl = Math.hypot(...f) || 1; f[0] /= fl; f[1] /= fl; f[2] /= fl;
    const up = c.up ?? [0, 1, 0];
    let r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]; const rl = Math.hypot(...r) || 1; r = r.map((v) => v / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const e = c.pos, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const vm = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
    const t = 1 / Math.tan((c.fov * Math.PI / 180) / 2), a = aspect();
    const pm = [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0];
    return { matrixWorldInverse: { elements: vm }, projectionMatrix: { elements: pm }, pos: e, f, r, u, t, a };
  }
  // the water under a screen point (y = 0), or null for the sky
  function waterAt(x, y) {
    const c = camShim(); if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect(), nx = (x - rect.left) / rect.width * 2 - 1, ny = -((y - rect.top) / rect.height * 2 - 1);
    const d = [0, 1, 2].map((k) => c.f[k] + c.r[k] * nx * c.a / c.t + c.u[k] * ny / c.t);
    if (!(d[1] < -1e-4)) return null;
    const s = -c.pos[1] / d[1];
    return { x: c.pos[0] + d[0] * s, z: c.pos[2] + d[2] * s };
  }
  function markAt(x, y) {
    if (rings.nearIndex(x, y) === 0 && V.nav.dest) return pickDestination({ x: V.nav.dest.at[0], z: V.nav.dest.at[1] });
    const raw = waterAt(x, y); if (!raw) return null;
    ui?.services.get('calm')?.wake?.('bar');
    // near the boat (fix 2026-11-15): the mark nearM out on the tap's bearing, so it is not reached (70 m) the moment it is set (ui/sailMark.js)
    const pt = pushOutOk(B.state, raw, (q) => checkDestination(V.chart, q.x, q.z, { from: [B.state.x, B.state.z] }).ok), d = V.nav.dest;
    if (d && [raw, pt].some((q) => q && Math.hypot(q.x - d.at[0], q.z - d.at[1]) < 90)) return pickDestination({ x: d.at[0], z: d.at[1] });   // on the mark: it goes
    if (!pt) return null;   // on the boat
    return pickDestination(pt);
  }
  // a spot on screen whose water takes a mark (the shots, the page test), over the lower middle of the frame
  function markSpot() {
    const r = canvas.getBoundingClientRect(), s = B.state;
    // the low rows first; then higher ones toward the horizon (the Boat view, Cruise's start since 2026-11-15, sees water past 120 m only there)
    for (const fy of [0.62, 0.7, 0.55, 0.78, 0.5, 0.45, 0.4, 0.35, 0.3]) for (const fx of [0.5, 0.38, 0.62, 0.3, 0.7]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy, pt = waterAt(x, y);
      if (pt && Math.hypot(pt.x - s.x, pt.z - s.z) > 120 && checkDestination(V.chart, pt.x, pt.z, { from: [s.x, s.z] }).ok) return [x, y];
    }
    return null;
  }
  let shooting = false;
  async function photo() {
    if (shooting || !m4?.onAfterFrame) return null; shooting = true;
    try { return await takePhoto({ afterFrame: (fn) => m4.onAfterFrame(fn), canvas, name: photoName(V.nav.target?.name, clock.hour), share: isCoarse() }); } finally { shooting = false; }
  }

  function mountPassenger(u) {
    ui = u;
    u.setMode?.(on ? 'cruise' : 'sail');
    if (!document.getElementById('v2-cruise-css')) { const st = document.createElement('style'); st.id = 'v2-cruise-css'; st.textContent = CSS; document.head.appendChild(st); }
    line = quietLine(); u.services.provide('cruiseLine', line);   // the Calm HUD's one-time line (calmHud.js)
    off = new AbortController(); const signal = off.signal;
    dock = createToolDock({ ready: () => !loadingUp() && on, hidden: () => true });   // the passenger's gear (the Locker's rows; v1's dock shows no row of its own here)
    const tools = () => m4?.captain ?? null, log = () => u.services.get('logbook') ?? null, chart = () => u.chart?.chart ?? null;
    dock.register({ id: 'camera', key: 'C', name: 'next camera', icon: VIEW_ICONS.cinematic, order: 5, action: () => V.rig.set(nextCamera(V.rig.view, 1)) });
    dock.register({ id: 'chart', key: 'N', name: 'chart', icon: ICONS.chart, order: 10, visible: () => !!chart(), action: () => { const t = chart()?.toggle; if (t) { t.shown = true; t.pinned ? t.unpin() : t.pin(); } } });
    dock.register({ id: 'logbook', key: '', name: 'logbook', icon: ICONS.logbook, order: 20, visible: () => !!log(), action: () => { const l = log()?.logbook; if (l) (l.isOpen ? l.close?.() : l.open?.()); } });
    dock.register({ id: 'binoculars', key: 'B', name: 'binoculars', icon: ICONS.binoculars ?? ICONS.pro, order: 40, visible: () => !!tools(), action: () => { const T = tools(); T?.setLatch(!T.latched); } });
    dock.register({ id: 'radio', key: '', name: 'VHF radio', icon: ICONS.radio ?? ICONS.pro, order: 41, visible: () => !!tools(), action: () => tools()?.toggle() });
    // the Locker (owner, 2026-11-11): the chart, the glasses, the radio and the logbook, then Photo
    const markName = () => (V.nav.dest ? `Chart · ${V.nav.dest.name === 'your mark' ? 'your mark' : V.nav.dest.name}` : 'Chart');
    const locker = lockerMenu({ dock, lit: { chart: () => !!V.nav.dest, binoculars: () => !!tools()?.latched, radio: () => !!tools()?.on }, name: { chart: markName },
      extra: [{ id: 'photo', name: 'Photo', icon: ICONS.photo, go: () => photo() }] });
    const newBar = newBarOn();
    const windApi = { level: () => windField.level ?? 3, set: (n) => windField.setLevel?.(n, { t: B.t, at: { x: B.state.x, z: B.state.z }, overS: LEVEL_BLOW.overS * cruiseSpeed(flags) }) };
    view0 = createViewSwitch({
      services: u.services, view: () => V.rig.view, set: (v) => V.rig.set(v), moveS: MOVE_S, once: false, nudge: false, label: 'app',
      subtitle: (text, o) => sayAs(o?.kind ?? 'status', text, Math.round((o?.secs ?? 2.4) * 1000)),   // a status goes to Cruise's one quiet line (the lean skipper: never)
      segments: [], extras: ['wind', 'weather', 'sound', 'fullscreen', 'settings'], clock: barClock({ get sun() { return { hour: clock.hour }; } }),
      views: { cameras: [...CAMERAS.map((id) => [id, VIEW_ICONS[id === 'astern' ? 'boat' : id], CAMERA_WORDS[id]]), ...(newBar ? [...(feature('binoculars').on ? [['glasses', ICONS.binoculars, 'Glasses']] : []), ['photo', ICONS.photo, 'Photo']] : [])],
        get: () => V.rig.view, set: (v) => (v === 'glasses' ? dock.run('binoculars') : v === 'photo' ? photo() : V.rig.set(v)) },   // the new bar: the Locker's Glasses and Photo join the View menu
      primary: { word: 'Take the helm', icon: VIEW_ICONS.take, label: 'Take the helm (A D)', go: () => takeHelm({ button: true }) },
      windPick: windApi, locker, weatherMenu: u.weather ?? null, clockMenu: u.dayClock?.menu ?? null,
      hidden: () => !on || loadingUp() || pageUp(),
      music: () => music.player(), titles: false,
    });
    view0.el.classList.add('cruisecam');
    // the top bar (owner, 2026-11-15): Menu · Full │ Chart │ Boat ▾ (the camera on screen) │ Conditions by default, Take the helm and the Locker parked; ?bar=old the old bar
    if (newBar) mountTopBar(view0, { mode: 'cruise', hour: () => clock.hour, date: () => PLACE.date, windPick: windApi, weather: u.weather ?? null, clockMenu: u.dayClock?.menu ?? null,
      music: () => music.player(), radio: { on: () => (tools()?.channel ?? '16') !== '16', toggle: () => tools()?.listen() },   // the weather channel now, again back to 16 (what O did; O went)
      sound: pageMusic?.core ? { muted: () => !!pageMusic.core.muted, toggle: () => pageMusic.core.toggleMute() } : null,   // the sheet's sound on/off (M went)
      swap: { to: () => 'sail', go: () => takeHelm({}), show: () => true },   // Sail ⇄ Cruise (owner, 2026-11-18): the hand-over, in place
      wind: () => { const b = windField?.base; return b ? { kn: b.speedMs / 0.514444, fromDeg: b.dirDeg } : null; } });   // the bay's wind, the levels' own reference (the debug line's)
    u.services.provide('cruiseView', view0); u.services.provide('cruiseDock', dock);
    // the chart's taps (v2/ui/plan.js in Cruise; fix 2026-11-15, owner: "in Cruise the chart does not work at all"): a tap on the
    // water or a name is the mark (the chart's own checks, the navigator sails to it, the beacon on it); a tap on the mark, or
    // Clear, lets it go. One mark, as the double-tap's
    u.services.provide('cruisePick', (p) => {
      if (!on || !V) return null;
      if (p.op === 'clear' || p.op === 'remove') return V.nav.dest ? pickDestination({ x: V.nav.dest.at[0], z: V.nav.dest.at[1] }) : null;
      if (p.op === 'add' || p.op === 'insert' || p.op === 'move') return pickDestination({ x: p.x, z: p.z, name: p.name ?? null });
      return null;
    });
    // the double-tap mark (a single tap stays the wake, a drag stays the look) and the first gesture (the music)
    dbl = new DoubleTap(); rings = createMarkRings();
    let press = null;
    canvas.addEventListener('pointerdown', (e) => { if (!on) return; begin(); press = { x0: e.clientX, y0: e.clientY, id: e.pointerId, moved: false, button: e.button }; }, { signal });
    canvas.addEventListener('pointermove', (e) => { if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > 6) press.moved = true; }, { signal });
    canvas.addEventListener('pointerup', (e) => {
      if (!on || !press || press.id !== e.pointerId) return;
      const p = press; press = null;
      if (p.moved || played()) { dbl.reset(); return; }   // played(): as Tessie a click bites (living/tessiePlayer.js), never a mark
      if ((p.button ?? 0) === 0 && dbl.tap({ x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() })) markAt(e.clientX, e.clientY);
    }, { signal });
    addEventListener('keydown', (e) => {
      if (e.lkVirtual) return;
      if (!on) return;
      begin();
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
      const k = keyClass(e, true);   // the lean key set: L O M ` G K U do nothing here
      if (k === 'intent') { takeHelm({ key: e }); return; }   // steering hands over directly (the key acts in Sail: main.js's keys hold it)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) u.services.get('calm')?.wake?.('bar');
      if (k !== 'passenger') return;
      if (e.code === 'KeyC' && !e.repeat) V.rig.set(nextCamera(V.rig.view, e.shiftKey ? -1 : 1));
      else if (e.code === 'KeyV' && !e.repeat) {
        if (V.rig.view !== 'above') { V.rig.set('above'); sayAs('cruise.above', cruiseLine(V.rig.above.northUp ? 'aboveNorth' : 'aboveCourse', { touch: fingers() }), 3500); }
        else sayAs('cruise.above', V.rig.above.toggle() ? 'North up' : 'Course up', 2500);
      }
      else if (e.code === 'KeyP' && !e.repeat) photo();
      else if (e.code === 'BracketRight' && !e.repeat) music.next();
      else if (e.code === 'BracketLeft' && !e.repeat) music.toggle();
    }, { signal });
    addEventListener('pointerdown', () => { if (on) begin(); }, { capture: true, signal });
    padCam = new PadCam(); sky = starsCue();
    if (u.chart?.chart && V.nav.dest) u.chart.chart.setDestination({ x: V.nav.dest.at[0], z: V.nav.dest.at[1], name: V.nav.dest.name === 'your mark' ? null : V.nav.dest.name });
  }
  function begin() {
    if (begun) return;
    begun = true;
    line?.hide();
    setTimeout(() => { if (on && keeps('cruise.look')) sayAs('cruise.look', cruiseLine('look', { touch: fingers(), camera: CAMERA_WORDS[V.rig.view] }), 8000); }, 2500);
  }

  // ---- the hand-over (v1's handover.js): Sail's hands on the same boat, clock and camera, with the skipper's trim ----
  // pro: the hand-over keeps the skipper's pro trim with Pro on (v1's handover); a mode switch (the card, Regatta) does not (MODE-4, -5:
  // v1 builds a fresh Sail there, Pro from the setting)
  function takeHelm({ key = null, quiet = false, fade = false, pro = true } = {}) {   // fade: a switch to Sail from the card (the playlist fades; the hand-over lets the piece play out)
    if (!on || !V) return false;
    const wasView = V.rig.view, from = view();
    on = false; handed = true;
    V.detach();
    B.followPose?.('sail');   // the Boat view's own pose again (sim/camTilt.js BOAT_VIEW)
    // the skipper's pro trim stays, the helm on the heading she is on (controllers/sail.js handover: Pro on, the sheet in hand)
    const trim = handoverTrim(V.pilot.skipper);
    B.hand.sheet = trim.sheet ?? B.hand.sheet; B.hand.start = false;
    Object.assign(B.ctl, { traveller: trim.traveller, twist: trim.twist, backstay: trim.backstay, jibLead: trim.jibLead });
    if (pro) ui?.setPro?.(true);
    if (weather) weather.stormS0 = null;   // ENG-5: Sail's landing second again
    V.nav.clearDestination(); ui?.chart?.chart?.setDestination?.(null);
    m4?.captain?.setLatch?.(false);
    sailClock();
    // Sail's view: the helm view from the helm camera, else the follow view; the camera eases from the pose on screen
    const views = ui?.views ?? m4?.views;
    if (views) { const v = wasView === 'helm' ? 'helm' : 'follow'; views.set(v); views.blend.jump(v); }
    blend = from ? { t: 0, dur: wasView === 'astern' || wasView === 'helm' ? HANDOVER.easeSameS : HANDOVER.easeS, from } : null;
    setMode('sail');
    if (!quiet) { sayAs('sea.helm', NOTES.helm.text.replace(/\{(\w+)\}/g, '$1'), 3200); }   // "You have the helm"
    if (fade) music.leave(); else music.finish();
    const H = document.documentElement; H.classList.add('lk-handover'); setTimeout(() => H.classList.remove('lk-handover'), HANDOVER.fadeS * 1000 + 150);
    return true;
  }
  // and back: "let her sail herself" (v1's handBack; the ` key, the card's Cruise)
  function handBack({ quiet = false } = {}) {
    if (on || !V) return false;
    const from = view(), views = ui?.views ?? m4?.views;
    const v = views?.view === 'helm' ? 'helm' : 'astern';
    // the skipper picks up the trim as the player left it
    const o = V.pilot.skipper.out, c = B.ctl;
    Object.assign(o, { sheet: c.sheet ?? B.state.mainSheet, traveller: c.traveller ?? 0, twist: c.twist ?? 0, backstay: c.backstay ?? B.state.backstay ?? 0, jibLead: c.jibLead ?? 0 });
    V.rig.set(v, { instant: true });
    if (from) V.rig.move.begin(from, 0.6);   // the camera on screen eases into the rig's
    blend = null; handed = false;
    attach();
    if (!quiet) sayAs('cruise.handBack', 'She sails herself. Sit back.', 3600);
    const H = document.documentElement; H.classList.add('lk-handover'); setTimeout(() => H.classList.remove('lk-handover'), 800);
    return true;
  }
  function attach() {
    V.nav.pickNearest(B.state.x, B.state.z);
    V.attach(); on = true;
    B.followPose?.('cruise');   // Cruise's astern view keeps v1's follow pose (the Boat view's low, near pose is Sail's: sim/camTilt.js)
    cruiseClock();
    if (weather) weather.stormS0 = WEATHER.cruiseS0;   // ENG-5: v1's Cruise Storm lands with a build-up first (70 s, not Sail's 97)
    setMode('cruise');
    music.enter();   // v1's playlist (it sounds from the first gesture, when the page's context exists)
  }
  function setMode(m) {
    const H = document.documentElement;
    H.classList.toggle('v2-cruise', m === 'cruise');
    H.classList.toggle('lk-m-cruise', m === 'cruise'); H.classList.toggle('lk-m-sail', m !== 'cruise');
    ui?.setMode?.(m);
    onMode(m);
  }

  const C = {
    ready, errors, music,
    get on() { return on; }, get handed() { return handed; }, get voyage() { return V; }, get lake() { return lake; }, get line() { return line; },
    get mode() { return on ? 'cruise' : 'sail'; },
    // Cruise sails: fresh, a new boat (v1's mode switch builds one); at: the pose to start from (MODE-6, owner 2026-11-14: a switch
    // keeps her where she is, v1's start=x,z&heading=, at v1 Cruise's 2.5 m/s), else Cruise's own start (a page opened in Cruise);
    // not fresh: in place (the hand-back)
    async enter({ fresh = true, at = null } = {}) {
      await ready;
      if (on) return C;
      if (fresh) { handed = false; V.place(at ? { x: at.x, z: at.z, headingDeg: at.headingDeg, speed: at.speed ?? 2.5 } : undefined); blend = null; }
      if (fresh) attach(); else handBack();
      return C;
    },
    // Sail from the card (v1: a fresh Sail where she is, MODE-6), the race (race: a quiet, fading leave, MODE-2, -4), or the hand-over
    // in place. A fresh or race leave is not a hand-over: no line, Pro not forced, ` does not hand her back (handed false)
    leave({ fresh = true, race = false } = {}) {
      const plain = fresh || race;
      if (!on) { if (plain) handed = false; return C; }
      takeHelm({ quiet: plain, fade: plain, pro: !plain });
      if (plain) { handed = false; blend = null; }
      if (fresh && !race) { const s = B.state; B.place({ x: s.x, z: s.z, headingDeg: s.heading / DEG, speed: START.speed ?? 0 }); }
      return C;
    },
    takeHelm, handBack,
    start: () => { if (!on && V) attach(); return C; },   // a capture: the autopilot on after the settle (main.js)
    speed: () => (on ? cruiseSpeed(flags) : P.speed),
    view: () => V?.rig.view ?? null,   // the rig's camera now (main.js: Above's chart view does not turn toward the fireworks)
    // main.js's frame while Cruise has the boat: the passenger's look first (the binoculars take it while up), the autopilot's step
    step(simDt, dt) {
      if (!on) return false;
      const h = hands();
      if (h && (h.steer || h.pull)) { takeHelm({}); return false; }   // the phone's steering strip and the keys: intent
      if (live && dt > 0) pollPad(dt);
      if (simDt > 0) B.step(simDt, null, dt);
      return true;
    },
    camera(dt) {
      if (!V) return null;
      if (on) {
        const h = hands(), latched = !!m4?.captain?.latched;
        const look = !latched && h?.orbit ? h.orbit : null, zoom = h?.zoom && h.zoom !== 1 ? h.zoom : 1;
        return V.camera(dt, { look, zoom, aspect: aspect(), sunDir: sunDir() });
      }
      return null;
    },
    // after the hand-over: Sail's pose eased in from the pose that was on screen (v1's cx.blend)
    blendSail(dt, pose) {
      if (!blend) return pose;
      blend.t += dt;
      if (blend.t >= blend.dur) { blend = null; return pose; }
      return easePose(blend.from, pose, eased(blend.t / blend.dur));
    },
    // each live frame (the bar, the dock, the mark's ring, the night's line, the arrivals)
    update(dt) {
      if (!ui || !V) return;
      view0?.update(dt); dock?.update(dt);
      const c = camShim(), rect = canvas?.getBoundingClientRect();
      const d = V.nav.dest;
      rings?.update({ ats: on && d && c && !pageUp() ? [markScreen(c, rect, d.at[0], d.at[1])] : [] });
      if (!on) return;
      // v1's night-sky line, once a night, quietly (Cruise's night still runs 4 x, with no "The night passes…": owner, 2026-11-15)
      const st = flatOrRate() ? null : stars();
      if (st && sky.step(dt, st) && keeps('cruise.stars')) sayAs('cruise.stars', STARS_LINE, 6000);
      if (V.nav.arrived) { say(`We are at ${V.nav.arrived.name === 'your mark' ? 'your mark' : V.nav.arrived.name}. Back to the scenic round.`, 5000); V.nav.arrived = null; ui.chart?.chart?.setDestination?.(null); }
    },
    // a capture (v1's settleCapture): ?chillsettle= s of sailing and directing at 30 Hz from the settled boat, then hold
    settle() {
      const n = Math.round(parseFloat(flags.chillsettle ?? '0') * 30);
      for (let i = 0; i < n; i++) { B.step(1 / 30, null, 1 / 30); V.camera(1 / 30, { aspect: aspect(), sunDir: sunDir() }); }
      if (!n) V.camera(1 / 30, { aspect: aspect(), sunDir: sunDir() });
    },
    mountUi: (u) => { if (live && !ui) try { mountPassenger(u); } catch (e) { errors.push(`cruise ui: ${e?.stack ?? e}`); console.error(e); } },
    markAt: (x, y) => markAt(x, y), markSpot: () => markSpot(), waterAt: (x, y) => waterAt(x, y), photo: () => photo(), pickDestination,
    stats: () => ({ on, handed, mode: C.mode, ready: !!V, ...(V ? V.stats() : {}), line: line?.text ?? '', music: music.stats(), crowns: !!V?.solid, speed: C.speed(), errors: errors.slice(0, 3) }),
  };
  function pollPad(dt) {
    const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    for (const a of padCam?.update(dt, gp ? gp.buttons.map((x) => x.pressed) : []) ?? []) V.rig.set(a === 'helm' ? 'helm' : nextCamera(V.rig.view, a === 'prev' ? -1 : 1));
    if (begun && gp && padIntent(gp)) takeHelm({});
  }
  return C;
}
