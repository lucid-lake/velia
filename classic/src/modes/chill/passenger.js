// Cruise's passenger layer (refactor round 2, Phase C step 11: the second of start's three parts; src/modes/chill/index.js
// composes them): the music (from the first gesture), the one quiet line, the passenger's bar, dock and Locker, the look and
// zoom (drag, wheel, pinch, the glasses' mouse), the keys and the pad (intent takes the helm: cx.takeHelm, handover.js), the
// mark by a double-tap, the chart, logbook and glasses once the Day Sail chunk is in, the time / weather / wind calls and
// the photo. Live pages only. Moved from start in the same order (DOM, services and listeners are made at the same points).
//   const P = createPassenger(core, v, cx);   // v: createVoyage's (voyage.js); cx: the state the three parts share
//   → { sched, makeMusic, ownHand, off, down, helmPick, canvas, mods, mountPassenger, mountTools, unmountTools, fireworksGo,
//       look(dt), evening(), frame(dt, dtRaw) }
import { createMusic } from '../../../../src/modes/chill/music.js';
import { visitSeed } from '../../../../src/visitSeed.js';
import { LANE, quietLine } from '../../../../src/modes/chill/quietLine.js';   // the one quiet line (its own three-free module: Velia v2 mounts it too)
export { LANE };
import * as THREE from 'three/webgpu';
import { createViewSwitch, VIEW_ICONS, barClock } from '../../../../src/ui/viewSwitch.js';
import { timeMenu, hourJump } from '../../../../src/ui/timeMenu.js';
import { createToolDock, ICONS, lockerMenu } from '../../../../src/ui/toolDock.js';
import { takePhoto, photoName } from '../../../../src/ui/photo.js';
import { checkDestination } from '../../../../src/sim/modes/chill/navigator.js';
import { CAMERAS, CAMERA_WORDS, nextCamera, MOVE_S } from '../../../../src/modes/chill/cameras.js';
import { keyClass, padIntent, partIntent, INTENT } from '../../../../src/modes/chill/intent.js';
import { PadCam } from '../../../../src/modes/chill/padCam.js';
import { isCoarse } from '../../../../src/ui/touchMap.js';
import { createModality } from '../../../../src/ui/pointer.js';
import { cruiseLine, touchNow } from '../../../../src/ui/modeLines.js';
import { TRIP_NAME } from '../../fireworks/cruise.js';
import { SHOW_LENGTH } from '../../../../src/fireworks/show.js';
import { WEATHER } from '../../../../src/sim/weather/weatherMenu.js';
import { LEVEL_BLOW } from '../../../../src/sim/wind.js';
import { DoubleTap, createMarkRings, markScreen } from '../../../../src/modes/chill/markTap.js';
import { createHelmPick } from '../../stations/sloop/helmPick.js';
import { handoverCss } from './handover.js';

export function createPassenger(core, { chart, sail, boat, phys, nav, rig, starry, input, fwNow, trip, share, startTrip, chillApi, speed }, cx) {
  const { flags, renderer, camera, wind, audio, services } = core;
  // --- live: the passenger layer -----------------------------------------------------------------------------------
  // The music waits for the first gesture. Then the passenger looks, zooms, switches cameras, opens the chart and the
  // logbook, raises the binoculars and works the music plate; none of it takes the helm (intent.js). The boat-operating
  // inputs do: Sail's controls attach in place (takeHelm); the ` key hands the boat back (handBack).
  const sched = audio.scheduler; if (sched) sched.next = Infinity;   // the core's silence-first beds stay out of Cruise
  const makeMusic = () => (!flags.music ? null : createMusic({ audio, seed: visitSeed(flags), settings: () => services.get('settings') }));
  cx.music = share ? null : makeMusic();   // the share link: the show's own sound first; the playlist comes after the show (update)
  cx.line = quietLine(); services.provide('cruiseLine', cx.line);   // the Calm HUD's one-time line (ui/calmHud.js)
  // the passenger's hand (src/ui/pointer.js): Sail's modality while its controls run, Cruise's own before; a finger never sees a key (lines.js)
  const ownHand = createModality({ coarse: () => isCoarse() });
  const fingers = () => touchNow(ownHand, isCoarse, services);
  const off = new AbortController();
  let daysailMods = null;   // the Day Sail chunk (controls, logbook, chart, the captain's tools), fetched once: mods()
  const daysail = () => Promise.all([import('../../sail/controls.js'), import('../../../../src/sail/logbook.js'), import('../../../../src/sail/chart.js'), import('../../sail/captainTools.js')]);
  const mods = () => (daysailMods ??= daysail());
  const helmPick = createHelmPick({ boat, THREE });   // the helm view's parts: shared with Sail's controls at the hand-over
  const canvas = renderer.domElement;
  // the music plate and the camera chooser, the dock, the chart, the logbook and the glasses; built again after a hand-back
  const loadingUp = () => { const l = document.getElementById('lk-load'); return !!l && l.isConnected && l.dataset.state !== 'gone' && !document.documentElement.classList.contains('lk-nol'); };
  const pageUp = () => !!(services.get('menu')?.isOpen || services.get('logbook')?.logbook?.isOpen || cx.chartApi?.state?.big || cx.tools?.bino?.k > 0.02 || cx.tools?.latched);

  // ---- the time of day, the weather and the wind (the bar's clock, Weather and Wind drive the same state) ----
  // the time: the clock jumps ahead to the picked hour (core.clock.setHour, the "wait for dawn" cut: the sky, the probe and
  // the clouds' history follow); Cruise's day clock keeps running from there
  cx.timeApi = {
    get: () => core.sun?.hour ?? core.clock.hourOfDay(cx.simT),
    set: (h) => { core.clock.setHour(hourJump(core.clock.hourAt(cx.simT), h), cx.simT); },
  };
  // the weather: fair, cloudy (the cloud deck's coverage eases up to CRUISE_WEATHER.cloudy), or the afternoon storm
  // (src/weather/storm.js, Settings → Weather's own: choose('fair') lets a running one clear)
  // The state is the world's (core.sky, src/weather/weatherMenu.js: the one Sail's top bar and Setup drive, so a sky chosen there
  // holds here; it eases the deck every frame).
  // The top bar has the same Weather button as Sail's (owner, 2026-11-10), and Cruise's storm lands earlier in its arc
  // (WEATHER.cruiseS0): a build-up to watch, not a front seconds after the pick. The landing goes back when Cruise ends.
  if (core.sky) core.sky.stormS0 = WEATHER.cruiseS0;
  cx.weatherApi = {
    get() { const w = core.sky?.current?.() ?? 'fair'; return w === 'clear' ? 'fair' : w; },
    set(w) { core.sky?.pick?.(w === 'storm' || w === 'cloudy' ? w : 'fair'); },
  };
  // the wind: the bar's Wind, Sail's four levels (the same call as Sail's keys 1–4: a front blows in from upwind, src/wind.js)
  cx.windApi = wind?.setLevel ? {
    level: () => wind.level ?? 3,
    set: (n) => wind.setLevel(n, { t: cx.simT, at: { x: phys.state.x, z: phys.state.z }, overS: LEVEL_BLOW.overS * speed }),
  } : null;
  // the photo: the UI fades, the next frame is saved (a PNG, or the share sheet on a finger), the UI comes back
  let shooting = false;
  cx.photo = async () => {
    if (shooting) return null; shooting = true;
    try { return await takePhoto({ afterFrame: core.afterFrame, canvas: renderer.domElement, name: photoName(nav.target?.name, cx.timeApi.get()), share: isCoarse() }); }
    finally { shooting = false; }
  };

  function mountPassenger() {
    const p = { off: new AbortController() };
    const signal = p.off.signal;
    mods();
    handoverCss();
    p.dock = createToolDock({ ready: () => !loadingUp() && !cx.leaving && !cx.handed, hidden: () => false });
    // the Locker (owner, 2026-11-11): the dock's chart, binoculars, radio and logbook, then Photo
    const openChart = () => { const t = cx.chartApi?.cp?.toggle; if (t) { t.shown = true; t.pinned ? t.unpin() : t.pin(); } };   // the big chart, where a destination is picked
    // the Chart row's lit name: the mark, or the route's legs to go ("Chart · 3 legs to the stone house")
    const markName = () => {
      const c = course(), r = c?.route ?? [], left = r.length - Math.max(0, c?.leg ?? 0);
      if (left >= 2) return `Chart · ${left} legs to ${r.at(-1).name ?? 'your mark'}`;
      return nav.dest && nav.dest.name !== TRIP_NAME ? `Chart · ${nav.dest.name === 'your mark' || /^waypoint \d/.test(nav.dest.name) ? 'your mark' : nav.dest.name}` : 'Chart';
    };
    const locker = lockerMenu({ dock: p.dock,
      lit: { chart: () => (!!nav.dest && nav.dest.name !== TRIP_NAME) || (course()?.route.length ?? 0) > 0, binoculars: () => !!cx.tools?.latched, radio: () => !!cx.tools?.on },
      name: { chart: markName }, go: { chart: openChart },
      extra: [{ id: 'photo', name: 'Photo', icon: ICONS.photo, go: () => cx.photo() }] });
    p.view = createViewSwitch({
      services,
      view: () => rig.view, set: (v) => rig.set(v), moveS: MOVE_S, once: false, nudge: false, label: 'app',
        subtitle: (text, o) => cx.line.show(text, Math.round((o?.secs ?? 2.4) * 1000)),   // a status goes to Cruise's one quiet line, not a pill under the bar
      // the one bar (owner, 2026-11-11, 37c § 4): Menu | Cinematic ▾ · Take the helm | Music Full Setup | Wind Weather | clock
      segments: [], extras: ['wind', 'weather', 'sound', 'fullscreen', 'settings'], clock: barClock(core),   // the ship's clock at the bar's end
      views: { cameras: CAMERAS.map((id) => [id, VIEW_ICONS[id === 'astern' ? 'boat' : id], CAMERA_WORDS[id]]), get: () => rig.view, set: (v) => rig.set(v) },
      primary: { word: 'Take the helm', icon: VIEW_ICONS.take, label: 'Take the helm (A D)', go: () => cx.takeHelm({ button: true }) },
      windPick: cx.windApi,   // Wind: Sail's four levels (the same call as Sail's keys 1–4)
      locker,
      weatherMenu: core.sky ?? null,   // Weather: Clear · Fair · Storm, the same button and state as Sail's bar
      clockMenu: timeMenu({ clock: core.clock, simT: () => cx.simT, hour: () => core.sun?.hour ?? null, fireworks: fwNow, fireworksGo: () => fireworksGo() }),   // its menu: the four hours and Fireworks (the trip to the viewing spot)
      hidden: () => cx.leaving || cx.handed || loadingUp() || pageUp(),
      music: () => cx.music,   // the Sound dropdown: pause / play, next, volume (the old music plate)
      titles: false,   // no browser tooltips on Cruise's controls (they floated over the sky): the words, a hover or a long-press (nameTag.js) say it
    });
    p.dock.register({ id: 'camera', key: 'C', name: 'next camera', icon: VIEW_ICONS.cinematic, order: 5, action: () => rig.set(nextCamera(rig.view, 1, { night: starry() })) });
    p.dock.register({ id: 'chart', key: 'N', name: 'chart', icon: ICONS.chart, order: 10, code: 'KeyN', visible: () => !!cx.chartApi,
      // a finger has no N hold and the small chart has no room: the tool pins the enlarged chart (a tap outside lets it go), where the destination is picked
      ...(isCoarse() ? { action: () => { const t = cx.chartApi?.cp?.toggle; if (t) { t.shown = true; t.pinned ? t.unpin() : t.pin(); } } } : {}) });
    p.dock.register({ id: 'logbook', key: 'L', name: 'logbook', icon: ICONS.logbook, order: 20, code: 'KeyL', visible: () => !!cx.logbook });
    p.view.el.classList.add('cruisecam');
    services.provide('cruiseView', p.view); services.provide('cruiseDock', p.dock);
    // the look and the zoom: a drag (either button, a finger), the wheel, a pinch. A drag on the wheel or a winch in the helm view is intent.
    const rayc = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const rayAt = (x, y) => { const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1); rayc.setFromCamera(ndc, camera); return rayc; };
    const touches = new Map();
    let press = null, hoverXY = null, pinch = 0;
    // your mark by a double-tap or double-click on the water (owner, 2026-11-11; markTap.js): the ring on the mark, a double-tap on it clears it.
    // The passage plan (owner decision 2): a further double-tap elsewhere appends a waypoint (a route); a double-tap on a
    // ring removes that waypoint. One mark behaves exactly as before.
    const dbl = new DoubleTap(), rings = createMarkRings();
    const waterAt = (x, y) => { const r = rayAt(x, y).ray; if (!(r.direction.y < -1e-4)) return null; const t = -r.origin.y / r.direction.y; return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t }; };
    const markAt = (x, y) => {
      const c = course(), pl = cx.chartApi?.planner;
      if (!c || !pl) {   // before the chart's chunk is in (its first 600 ms): the one mark, as before
        if (rings.nearIndex(x, y) === 0 && nav.dest) { pickDestination({ x: nav.dest.at[0], z: nav.dest.at[1] }); return 'cleared'; }
        const pt = waterAt(x, y); if (!pt) return null;
        const had = nav.dest; pickDestination(pt);
        services.get('calm')?.wake?.('bar');
        return nav.dest && nav.dest !== had ? 'set' : had && !nav.dest ? 'cleared' : 'refused';
      }
      const from = Math.max(0, c.leg), r = c.route;
      let i = rings.nearIndex(x, y);
      const pt = i < 0 ? waterAt(x, y) : null;
      if (i < 0 && !pt) return null;   // the sky
      if (i < 0) for (let k = from; k < r.length; k++) if (Math.hypot(pt.x - r[k].x, pt.z - r[k].z) < 90) { i = k - from; break; }   // a tap on a mark again lets it go
      if (i >= 0) { pl.pick({ op: 'remove', index: from + i }); return 'cleared'; }
      const n = r.length;
      pl.pick({ op: 'add', append: true, index: n, x: pt.x, z: pt.z, name: null });
      services.get('calm')?.wake?.('bar');   // the rings and the line show (they fade with the bar)
      return c.route.length > n ? 'set' : 'refused';
    };
    // a spot on screen whose water takes a mark (tools: the shots), searched over the lower middle of the frame
    const markSpot = () => {
      const r = canvas.getBoundingClientRect(), s = phys.state;
      for (const fy of [0.62, 0.7, 0.55, 0.78, 0.5]) for (const fx of [0.5, 0.38, 0.62, 0.3, 0.7]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy, pt = waterAt(x, y);
        if (pt && Math.hypot(pt.x - s.x, pt.z - s.z) > 120 && checkDestination(chart, pt.x, pt.z, { from: [s.x, s.z] }).ok) return [x, y];
      }
      return null;
    };
    Object.assign(chillApi, { markAt, markSpot });
    p.ring = () => {
      const c = course(), d = nav.dest, rect = canvas.getBoundingClientRect();
      const pts = c?.route.length ? c.route.slice(Math.max(0, c.leg)) : d && d.name !== TRIP_NAME ? [{ x: d.at[0], z: d.at[1] }] : [];
      rings.update({ ats: pageUp() ? [] : pts.map((q) => markScreen(camera, rect, q.x, q.z)) });
    };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    canvas.addEventListener('pointerdown', (e) => {
      if (!cx.begun) { begin(); }
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); press = null; }
        else press = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
        return;
      }
      press = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, button: e.button, id: e.pointerId };
      if (rig.view === 'helm' && e.button === 0 && !rig.move.moving) {
        const part = helmPick.pick(rayAt(e.clientX, e.clientY));
        if (partIntent(part)) { press = null; cx.takeHelm({ press: e }); return; }   // the wheel or a winch: the player's hands
        if (part) press.part = part;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (!touches.has(e.pointerId)) return;
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch > 0 && d > 0) input.zoom *= pinch / d; pinch = d; return; }
      } else hoverXY = press ? null : [e.clientX, e.clientY];
      if (!press || press.id !== e.pointerId) return;
      const was = press.moved;
      if (!was && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) <= INTENT.dragPx) return;
      press.moved = true;
      const mx = was ? e.clientX - press.x : e.clientX - press.x0, my = was ? e.clientY - press.y : e.clientY - press.y0;   // the first move carries the travel so far
      press.x = e.clientX; press.y = e.clientY;
      if (!press.part) { lookX += mx * 0.005; lookY += my * 0.004; }
    }, { signal });
    const end = (e) => {
      touches.delete(e.pointerId); if (touches.size < 2) pinch = 0;
      if (press && press.id === e.pointerId) {
        if (!press.moved && press.part?.kind === 'click') press.part.action?.();   // the VHF set in the helm view: the weather channel
        else if (!press.moved && !press.part && (press.button ?? 0) === 0 && touches.size === 0 && dbl.tap({ x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() })) markAt(e.clientX, e.clientY);
        else if (press.moved) dbl.reset();
        press = null;
      }
    };
    canvas.addEventListener('pointerup', end, { signal }); canvas.addEventListener('pointercancel', end, { signal });
    canvas.addEventListener('pointerleave', () => { hoverXY = null; }, { signal });
    canvas.addEventListener('wheel', (e) => { input.zoom *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false, signal });
    // the glasses aim with the mouse while latched (B or the Locker's Glasses; captainTools.js), no drag needed
    addEventListener('mousemove', (e) => { if (!press && cx.tools?.latched) { lookX += e.movementX * 0.005; lookY += e.movementY * 0.004; } }, { signal });
    // keys
    addEventListener('keydown', (e) => {
      if (e.lkVirtual) return;
      if (!cx.begun) begin();
      if (cx.handed || cx.leaving) return;
      const k = keyClass(e);
      if (k === 'intent') { cx.takeHelm({ key: e }); return; }   // steering (A D, the arrows) hands over directly
      if (!e.ctrlKey && !e.metaKey && !e.altKey) services.get('calm')?.wake?.('bar');   // a key wakes the bar (Calm wakes the dashboard only on Sail's helm keys)
      if (k !== 'passenger') return;
      if (e.code === 'KeyC' && !e.repeat) rig.set(nextCamera(rig.view, e.shiftKey ? -1 : 1, { night: starry() }));
      else if (e.code === 'KeyV' && !e.repeat) {   // the Above camera; pressed there, north-up ↔ course-up
        if (rig.view !== 'above') { rig.set('above'); cx.line.show(cruiseLine(rig.above.northUp ? 'aboveNorth' : 'aboveCourse', { touch: fingers() }), 3500); }
        else cx.line.show(rig.above.toggle() ? 'North up' : 'Course up', 2500);
      }
      else if (e.code === 'KeyO' && !e.repeat) cx.tools?.listen();
      else if (e.code === 'BracketRight' && !e.repeat) cx.music?.next();
      else if (e.code === 'BracketLeft' && !e.repeat) cx.music?.toggle();
    }, { signal });
    p.hover = (dt) => {   // the helm view's parts glow under a still mouse, as in Sail
      if (rig.view === 'helm' && hoverXY && !press) { const hp = helmPick.pick(rayAt(hoverXY[0], hoverXY[1])); helmPick.hover(hp); canvas.style.cursor = hp ? (hp.kind === 'drag' ? 'grab' : 'pointer') : ''; }
      else if (!press) { helmPick.hover(null); if (rig.view !== 'helm' && canvas.style.cursor) canvas.style.cursor = ''; }
      helmPick.update(dt, phys.state, core.sun?.exposure ?? 1);
    };
    p.dispose = () => { p.off.abort(); p.view.dispose(); p.dock.dispose(); rings.dispose(); delete chillApi.markAt; delete chillApi.markSpot; helmPick.hover(null); canvas.style.cursor = ''; for (const k of ['cruiseView', 'cruiseDock']) services.remove(k); };
    return p;
  }
  let lookX = 0, lookY = 0;   // drag travel since the last frame (rad)
  const down = new Set();     // the keys held now, so a key let go before the hand-over completes is not replayed
  addEventListener('keydown', (e) => { if (!e.lkVirtual) down.add(e.code); }, { signal: off.signal });
  addEventListener('keyup', (e) => down.delete(e.code), { signal: off.signal });
  addEventListener('blur', () => down.clear(), { signal: off.signal });

  // the chart (with a destination to pick), the logbook and the glasses, attached once the Day Sail chunk is in
  let pickedLine = 0;
  // the passage plan's course (src/sail/passagePlan.js; provided by the chart's chunk): Cruise's route, always in force
  const course = () => services.get('course') ?? null;
  // after each edit on the chart or the lake: the navigator sails what is left of the route; one quiet line
  function syncNav(p) {
    const c = course(); if (!c) return;
    const r = c.route;
    if (!r.length) { nav.clearDestination(); if (p.op === 'remove') cx.line.show('Mark cleared. Back to the scenic round.', 4500); return; }
    if (!c.active) c.set(phys.state);
    const left = r.slice(Math.max(0, c.leg));
    nav.setRoute(left.map((q) => ({ at: [q.x, q.z], name: q.name })));
    const pl = cx.chartApi?.planner, mins = pl?.plan?.minutes ?? null;
    if (p.op !== 'set' && pl?.courseLine) cx.line.show(pl.courseLine('cruise', { n: left.length, name: left.at(-1).name, minutes: mins }), 5000);
  }
  function pickDestination(pt) {
    const s = phys.state, d = nav.dest;
    if (d && Math.hypot(pt.x - d.at[0], pt.z - d.at[1]) < 90) {   // a tap on the mark again lets it go
      nav.clearDestination(); cx.chartApi?.setDestination(null); cx.line.show('Mark cleared. Back to the scenic round.', 4500); return;
    }
    const r = checkDestination(chart, pt.x, pt.z, { from: [s.x, s.z], snapM: pt.name ? 260 : 0 });
    if (!r.ok) { cx.line.show(r.say, 5000); return; }
    const name = pt.name ?? 'your mark';
    nav.setDestination(r.at, { name });
    cx.chartApi?.setDestination({ x: r.at[0], z: r.at[1], name: pt.name });
    cx.line.show(pt.name ? `Aye. Making for ${pt.name}.` : 'Aye. Setting a course for your mark.', 5000);
  }
  async function mountTools(track = null) {
    const [, { attachLogbook }, { attachChart }, { createCaptainTools }] = await mods();
    if (cx.handed || cx.leaving || !cx.passenger) return;
    const here = Object.create(core, { T0: { value: cx.simT } });
    cx.tools = createCaptainTools(core, { boat, phys, dock: cx.passenger.dock, helmPick, icons: ICONS, auto: false });   // Cruise: the music is on, no spoken forecast
    cx.logbook = attachLogbook(here, sail, null, { track });
    cx.chartApi = attachChart(here, sail, null, cx.logbook, { plan: { mode: 'cruise', navChart: () => chart, say: (t) => cx.line.show(t, 5000), onEdit: syncNav } });
    if (cx.chartApi.cp?.toggle) cx.chartApi.cp.toggle.shown = false;   // no chart dial in Cruise: the Locker's Chart opens the big chart (N too)
    // a route kept from Sail (the hand-back) or a mark set before the chunk came in: the navigator sails it
    const c = course();
    if (c?.route.length) { if (!c.active) c.set(phys.state); nav.setRoute(c.route.slice(Math.max(0, c.leg)).map((q) => ({ at: [q.x, q.z], name: q.name }))); }
    else if (c && nav.dest && nav.dest.name !== TRIP_NAME) { c.setRoute([{ x: nav.dest.at[0], z: nav.dest.at[1], name: nav.dest.name === 'your mark' ? null : nav.dest.name }]); c.set(phys.state); }
  }
  function unmountTools() {
    const track = cx.logbook?.track ? cx.logbook.track.slice() : null;
    cx.chartApi?.dispose(); cx.logbook?.dispose(); cx.tools?.dispose();
    cx.chartApi = cx.logbook = cx.tools = null;
    return track;
  }

  // the clock menu's Fireworks row: the trip, or the share link on a page with no show; one quiet line, no pop-up
  function fireworksGo({ auto = false } = {}) {
    const r = startTrip({ auto });
    if (r === 'trip') cx.line.show(auto ? 'Fireworks tonight. Making for the mouth.' : 'Aye. Making for the mouth for the fireworks.', 5000);
    else if (r === 'busy') cx.line.show(trip.state === 'sailing' ? 'Making for the mouth for the fireworks.' : 'At anchor for the fireworks.', 3500);
    return r;
  }
  let autoAsked = false, musicBack = false;
  cx.passenger = mountPassenger();
  setTimeout(() => { if (!cx.handed) mountTools(); }, 600);   // the chunk is fetched now, so the chart and the logbook are there before the first click
  // no "click to begin" prompt (owner, 2026-10-30): the first gesture of any kind (a key, a tap anywhere, the top bar's buttons too: capture phase, before a
  // button stops the event) starts the music; the audio context itself unlocks on the same gesture (world.js startOnFirstGesture)
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, (e) => { if (!e.lkVirtual) begin(); }, { capture: true, once: true });

  function begin() {
    if (cx.begun) return;
    cx.begun = true;
    audio.start(); cx.music?.start();
    cx.line.hide();
    setTimeout(() => { if (!cx.handed && !cx.leaving) cx.line.show(cruiseLine('look', { touch: fingers(), camera: CAMERA_WORDS[rig.view] }), 8000); }, 2500);   // the camera button's own word
  }
  // a gamepad stick or trigger is intent (the pad has no event of its own)
  const padCam = new PadCam();
  function pollPad(dt) {
    if (cx.handed || cx.leaving) return;
    const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    // Y and the d-pad's left / right are the cameras (CRUISE_PADMAP); the buttons are the passenger's, never the helm
    for (const a of padCam.update(dt, gp ? gp.buttons.map((x) => x.pressed) : [])) rig.set(a === 'helm' ? 'helm' : nextCamera(rig.view, a === 'prev' ? -1 : 1));
    if (!cx.begun) return;
    for (const g of navigator.getGamepads?.() ?? []) if (g?.connected && padIntent(g)) { cx.takeHelm({ pad: true }); return; }
  }

  // a switch in from another mode (the menu, src/shell.js): the sound already runs from that gesture, so the music
  // begins now; there is no click to wait for
  if (core.switched) begin();

  // ---- the passenger's parts of Cruise's frame (index.js update calls them in its order) ----
  // before the boat sails: the pad (cameras, intent) and the drag's look
  function look(dt) {
    pollPad(dt);
    input.look = lookX || lookY ? [lookX, lookY] : null; lookX = lookY = 0;
  }
  // after the kayaks: the show's evening
  function evening() {
    // the show's evening: on its own at 20:15 the navigator makes for the spot; after the show the
    // playlist comes back (the show's score had the music bus)
    const fw = fwNow();
    if (fw && !cx.handed) {
      const h = core.clock.hourOfDay(cx.simT);
      if (!autoAsked && !trip.active && fw.phase === 'before' && h >= 20.25 && h < 21.5) { autoAsked = true; fireworksGo({ auto: true }); }
      const over = fw.phase === 'after' || fw.showTime > SHOW_LENGTH + 20;
      if (!over) musicBack = false;
      else if (!musicBack && cx.begun && flags.music && (!cx.music || (cx.music.stats().stopped && audio.musicHolder === 'beds'))) { musicBack = true; cx.music = makeMusic(); cx.music?.start(); }
    }
  }
  // after the boat sails: the bar, the dock, the mark's ring, the glasses, the logbook, the chart and their lines
  function frame(dt, dtRaw) {
    cx.passenger.view.update(dt); cx.passenger.dock.update(dt); cx.passenger.ring(); cx.passenger.hover(dt);
    cx.tools?.update(dt); cx.logbook?.update(); cx.chartApi?.update(dtRaw);
    const c = course();
    if (nav.legReached) { nav.legReached = null; if (c?.active) c.arrive(phys.state, Infinity); }   // the navigator reached a waypoint: the course's next leg
    if (nav.dest?.name === TRIP_NAME && c?.route.length) c.clear();   // the fireworks trip takes the boat: the route goes
    if (nav.arrived?.name === TRIP_NAME) nav.arrived = null;   // the trip's mark: the crew anchors there (no "back to the round")
    if (nav.arrived) { cx.line.show(`We are at ${nav.arrived.name === 'your mark' ? 'your mark' : nav.arrived.name}. Back to the scenic round.`, 5000); nav.arrived = null; c?.clear(); }
    const big = !!cx.chartApi?.state?.big;
    if (big && !pickedLine && !nav.dest && !c?.route.length) { pickedLine = 1; cx.line.show('tap the water, or a name, to sail there', 5500); }
    if (!big) pickedLine = 0;
  }

  return { sched, makeMusic, ownHand, off, down, helmPick, canvas, mods, mountPassenger, mountTools, unmountTools, fireworksGo, look, evening, frame };
}
