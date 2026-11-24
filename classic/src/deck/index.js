// The deck (refactor round 2, Phase C step 8): what any craft's live page
// shares, whatever the player steers. The player's inputs (the held keys, the mouse's press, drag, wheel and click, the
// binoculars' aim), the tool dock, the views (follow and helm, the ≈ 1 s move between them, viewBlend.js) and the camera
// chain that ends in the pose on the camera, the top bar (the view switch, viewSwitch.js) and its keys (C, Shift+C, the
// mode switch). The craft's controller (the sloop's: src/controllers/sail.js) fills the hooks and builds on it; the deck
// imports no sail code.
//
//   const deck = attachDeck(core, player, { helmCam, view, cruiseKey });   // player: src/core/player.js (phys, follow)
//   deck.setHooks({ onPart, onClick, clickBlocked, aiming });   // the controller's answers to a press (see below)
//   deck.mountDock({ hidden })    // the tool dock, built when called (its DOM point is the caller's): rows chart, logbook, helm, cruise, keys
//   deck.mountBar(hooks)          // the top bar, built when called, and the deck's keydown listener after it: C, Shift+C,
//                                 // the Cruise key and every onKey(fn) work only once mountBar() has run (the listener's place
//                                 // among the page's keydown listeners is the old controls.js one; tests/sailDomOrder)
//     hooks: { subtitle(text, o), windPick: { level, set }, quiet(), log, clockMenu: { simT, fireworks, fireworksGo } }
//   deck.onKey(fn)                // fn(e) on every real keydown, inside the deck's one listener (after the mode switch, before C)
//   each frame: deck.begin(dt) (the clock) … deck.update(dt) (the keys list's timeout, the dock) … deck.camera(dt, o) (the
//   follow / helm chain, onto the camera) … deck.end() (the frame's drag and wheel used up)
//   deck.dispose()                // after deck.abort() and the controller's own parts
//
// Hooks: onPart.down(ray) → a part or null (a helm-view press, button 0), onPart.move(press, e), onPart.up(press, kind);
// onClick(x, y) (a click on the water); clickBlocked(kind) → true swallows the press (the glasses up); aiming() → true while
// the mouse aims the binoculars without a drag.
import * as THREE from 'three/webgpu';
import { HelmCamera, applyPose } from '../../../src/sim/boat/helmCamera.js';
import { FOLLOW } from '../../../src/sim/boat/followCamera.js';
import { ViewBlend, blendPose } from '../../../src/boat/viewBlend.js';
import { createViewSwitch, barClock } from '../../../src/ui/viewSwitch.js';
import { timeMenu } from '../../../src/ui/timeMenu.js';
import { Press, createModality } from '../../../src/ui/pointer.js';
import { createToolDock, ICONS } from '../../../src/ui/toolDock.js';
import { createRipple } from '../ui/ripple.js';
import { isCoarse } from '../../../src/ui/touchMap.js';
import { createFullscreen, landscapeLock } from '../../../src/ui/fullscreen.js';
import { createBedMusic } from '../../../src/musicControl.js';
import { camerasFor } from '../../../src/sim/craft/index.js';
import { switchInPlace } from '../modes/inPlace.js';

// the helm view's horizon: the camera cancels this share of the boat's heel and pitch (owner 2026-10-30; Settings: steady horizon)
export const STEADY = 0.4;
export const CAM_RIDE = 0.35, CAM_RIDE_TAU = 0.3;   // the follow camera takes this share of the boat's heave and pitch, smoothed over this many seconds

// shared (Cruise's hand-over, src/modes/chill/index.js): helmCam is the passenger's own, so the helm view's look carries
// over; view: 'helm' | 'follow' starts in that view; cruiseKey: the key code that asks the shell for Cruise
export function attachDeck(core, player, { helmCam: sharedCam = null, view: startView = null, cruiseKey = null, ...hookOpts } = {}) {
  const { flags, renderer, camera, services } = core;
  const phys = player.phys, follow = player.follow;
  const hooks = { onPart: null, onClick: null, clickBlocked: () => false, aiming: () => false, ...hookOpts };
  const off = new AbortController(), signal = off.signal;   // dispose() removes every listener below
  // e.lkVirtual: the gamepad's and touch's stand-ins for the hints (pads.js); the controls read those inputs directly
  const keys = new Set(); addEventListener('keydown', (e) => { if (!e.lkVirtual) keys.add(e.code); }, { signal }); addEventListener('keyup', (e) => { if (!e.lkVirtual) keys.delete(e.code); }, { signal });
  addEventListener('blur', () => keys.clear(), { signal });
  let dragging = false, odx = 0, ody = 0, zoom = 1;
  // ---- the mouse: a press is a click (under 5 px, 250 ms) or a drag; a drag orbits, any button ----
  const canvas = renderer.domElement;
  const modality = createModality({ coarse: () => isCoarse() }); services.provide('modality', modality);
  const ripple = createRipple({ scene: core.scene, THREE });
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const rayAt = (x, y) => { const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); return ray; };
  let press = null, part = null, hoverXY = null;
  const loadingUp = () => { const l = document.getElementById('lk-load'); return !!l && l.isConnected && l.dataset.state !== 'gone' && !document.documentElement.classList.contains('lk-nol'); };   // lk-nol: ?noload / ?headless, the card never shows
  canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });   // right-drag orbits
  canvas.addEventListener('pointerdown', (e) => {
    // a finger: pads.js has it (the tiller, the rope); a one-finger tap sets a course, a second finger cancels the tap
    if (e.pointerType === 'touch') { press = e.isPrimary ? Object.assign(new Press(e.clientX, e.clientY, performance.now(), 0), { touch: true }) : null; return; }
    press = new Press(e.clientX, e.clientY, performance.now(), e.button);
    // the helm view: a press on a part is that part's, not the camera's
    if (view === 'helm' && e.button === 0) {
      part = hooks.onPart?.down(rayAt(e.clientX, e.clientY)) ?? null;
      if (part) press.part = part;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  }, { signal });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') { press?.touch && e.isPrimary && press.move(e.clientX, e.clientY); return; }
    hoverXY = press ? null : [e.clientX, e.clientY];
    if (!press) return;
    const was = press.dragging, drag = press.move(e.clientX, e.clientY);
    if (press.part) { hooks.onPart?.move(press, e); return; }
    if (drag) {
      dragging = true;
      // the first move past the threshold carries the travel so far, so the orbit starts where the hand did
      const mx = was ? e.movementX : e.clientX - press.x0, my = was ? e.movementY : e.clientY - press.y0;
      odx += mx * 0.005; ody += my * 0.004;
    }
  }, { signal });
  const endPress = (e) => {
    if (!press) return;
    const p = press; press = null; dragging = false;
    const kind = p.end(e.clientX, e.clientY, performance.now());
    if (p.part) { hooks.onPart?.up(p, kind); part = null; return; }
    if (hooks.clickBlocked(kind)) return;   // e.g. a click while the glasses are up lowers them, no course
    const wakeTap = p.touch && !!services.get('calm')?.tapWoke?.();   // a tap that only woke the Calm HUD sets no course (ui/calmHud.js)
    if (kind === 'click' && p.button === 0 && e.type === 'pointerup' && !wakeTap) hooks.onClick?.(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', endPress, { signal });
  canvas.addEventListener('pointercancel', endPress, { signal });
  canvas.addEventListener('pointerleave', () => { hoverXY = null; }, { signal });
  canvas.addEventListener('wheel', (e) => { zoom *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false, signal });
  // the binoculars aim with the mouse while held, no drag needed (the controller's aiming(): B down, or the dock's icon latched them)
  addEventListener('mousemove', (e) => { if (!press && hooks.aiming()) { odx += e.movementX * 0.005; ody += e.movementY * 0.004; } }, { signal });

  // the camera: the follow view (never rolls) or the helm view (fixed to the boat: the horizon tilts with the heel).
  // C, the view switch (viewSwitch.js), the dock's wheel and the pad's held Y (or X) switch; ?view=helm starts there. Never
  // a cut: the camera flies between the two live poses over ≈ 1 s (viewBlend.js). The follow camera keeps running
  // underneath, so the way back lands where it would have been.
  const helmCam = sharedCam ?? new HelmCamera(camerasFor(phys.vessel).helm);   // the craft's helm eye (step 7)
  helmCam.steady = STEADY;   // on by default; the Settings row (shell.js) turns it off
  let view = (startView ?? flags.view) === 'helm' ? 'helm' : 'follow';
  const blend = new ViewBlend(view);
  let viewSwitch = null, followPose = null, intro = null;
  const camRide = { h: 0, p: 0 }, camRideK = flags.camride != null ? parseFloat(flags.camride) : CAM_RIDE;
  const setView = (v) => {
    if (v !== 'helm' && v !== 'follow') return view;
    if (v === view) return view;
    if (v === 'helm' && blend.k === 0) helmCam.reset();
    view = v;
    const s = phys.state, d = followPose ? Math.hypot(followPose.pos[0] - s.x, followPose.pos[1], followPose.pos[2] - s.z) : undefined;
    blend.to(v, { distM: d, swingRad: follow.yaw - s.heading });   // the follow camera orbited away from astern: a slower swing
    viewSwitch?.used();
    return view;
  };
  const toggleView = () => setView(view === 'helm' ? 'follow' : 'helm');
  let t = 0, lastUse = -9;   // the deck's clock (real seconds, clamped frames) and the player's last use of a control

  // ---- the tool dock (toolDock.js): what exists on this build registers; the rest are hidden stubs that a feature
  // fills by registering the same id (the 'dock' service's register({ id: 'chart', key: 'N', … })) ----
  let dock = null, hHeld = false, hAt = 0;
  const fireKey = (type, code) => { const e = new KeyboardEvent(type, { code, key: code.replace(/^Key|^Digit/, '') }); e.lkDock = true; dispatchEvent(e); };
  // the mouse's hand on the helm and the sheet, told to the hints as the keys it stands for (marked lkVirtual, as pads.js)
  const vdown = new Set();
  const vkey = (code, on) => {
    if (on === vdown.has(code)) return;
    if (on) vdown.add(code); else vdown.delete(code);
    const e = new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code.replace(/^Key/, '') }); e.lkVirtual = true; dispatchEvent(e);
  };
  const keysList = (on) => { if (on === hHeld) return; hHeld = on; hAt = t; fireKey(on ? 'keydown' : 'keyup', 'KeyH'); };
  function mountDock({ hidden = () => false } = {}) {
    addEventListener('lk-click', () => player.cue('click'), { signal });   // a panel switch or key: a quiet click
    dock = createToolDock({ ready: () => !loadingUp(), hidden }); services.provide('dock', dock);
    dock.register({ id: 'chart', key: 'N', name: 'chart', icon: ICONS.chart, order: 25, code: 'KeyN', visible: () => !!services.get('chart'),
      action: () => { const tg = services.get('chart')?.chart?.toggle; if (!tg) return; if (tg.pinned) { tg.unpin(); if (isCoarse()) tg.shown = false; } else { tg.shown = true; tg.pin(); } } });   // round 4: a captain's tool in the bottom panel (Log, Chart, Glasses, VHF): opens the enlarged chart, again closes it (a tap outside lets go, as with N)
    dock.register({ id: 'logbook', key: 'L', name: 'logbook', icon: ICONS.logbook, order: 20, code: 'KeyL' });
    dock.register({ id: 'helm', key: 'C', name: 'helm view', icon: ICONS.helm, order: 50, code: 'KeyC' });
    if (cruiseKey) dock.register({ id: 'cruise', key: '`', name: 'let her sail herself', icon: '<path d="M5 12a7 7 0 0 1 12-5M19 12a7 7 0 0 1-12 5"/><path d="M17 3.5V7h-3.5M7 20.5V17h3.5"/>', order: 65, code: cruiseKey, visible: () => !!(services.get('switchMode') || services.get('quickSwitch')?.cruise) });
    dock.register({ id: 'keys', key: 'H', name: 'keys', icon: ICONS.keys, order: 70, action: () => keysList(!hHeld) });
    addEventListener('pointerdown', (e) => { if (hHeld && !e.target.closest?.('.lk-dock')) keysList(false); }, { signal });   // the list closes on the next click
    return dock;
  }

  // ---- the top bar (viewSwitch.js): always up, but under a page, the binoculars or the loading card; its first-session
  // glow waits for the hints and the skill model to be quiet ----
  let binoUp = false, bedMusic = null;
  const switchShown = () => !loadingUp() && !services.get('menu')?.isOpen && !services.get('logbook')?.logbook?.isOpen && !services.get('chart')?.chart?.toggle?.big && !binoUp;
  const keyFns = [];
  function mountBar({ subtitle = null, windPick = null, quiet = () => true, log = null, clockMenu = null } = {}) {
    bedMusic = createBedMusic(core.audio, () => services.get('settings'));
    viewSwitch = createViewSwitch({
      services,
      // full screen on an Android phone (feat/cockpit-phone): the bar keeps its Full button there, and entering turns the phone sideways
      fullscreen: createFullscreen(document, undefined, { lock: () => landscapeLock({ phone: document.documentElement.classList.contains('lk-phone') }) }), fullscreenOnPhone: true,
      view: () => view, set: setView, moveS: blend.dur,
      subtitle,   // game events and statuses go to the subtitle line, not a pill under the bar
      windPick,   // the top bar's Wind: a direct picker
      hidden: () => !switchShown(),
      clock: barClock(core),   // the ship's clock at the bar's end
      clockMenu: clockMenu ? timeMenu({ clock: core.clock, simT: clockMenu.simT, hour: () => core.sun?.hour ?? null, fireworks: clockMenu.fireworks, fireworksGo: clockMenu.fireworksGo }) : null,   // the clock opens the time menu (Dawn … Fireworks)
      weatherMenu: core.sky ?? null,   // Weather, after Wind: Clear · Fair · Storm (src/weather/weatherMenu.js; Setup's weather row is the same state)
      music: () => bedMusic,   // the ♪ and ⏭ in the bar: the beds of src/audio.js (Sail, Regatta and School)
      quiet,
      modality: () => modality.hand ?? 'mouse',
      once: flags.once,
      log,   // the top bar's Log
    });
    services.provide('viewSwitch', viewSwitch);
    addEventListener('keydown', (e) => {
      if (e.lkVirtual) return;
      if (cruiseKey && e.code === cruiseKey && !e.repeat && !e.ctrlKey && !e.metaKey) switchInPlace(services, 'cruise');   // let her sail herself (the shell's mode switch, or Cruise's hand back before the shell is in; in Cruise any key takes the helm back)
      for (const f of keyFns) f(e);
      if (e.code === 'KeyC' && !e.repeat) { if (e.shiftKey) follow.chase = !follow.chase; else toggleView(); }   // the helm view, and back
    }, { signal });
    return viewSwitch;
  }

  const deck = {
    keys, signal, canvas, modality, ripple, helmCam, blend, rayAt, loadingUp, fireKey, vkey, keysList,
    get off() { return off; },
    get dock() { return dock; }, get viewSwitch() { return viewSwitch; }, get bedMusic() { return bedMusic; },
    get press() { return press; }, get part() { return part; }, get hoverXY() { return hoverXY; }, get dragging() { return dragging; },
    get t() { return t; }, get lastUse() { return lastUse; }, set lastUse(v) { lastUse = v; }, used() { lastUse = t; }, get sinceUse() { return t - lastUse; },
    get keysHeld() { return hHeld; },
    get view() { return view; }, setView, toggleView,
    get binoUp() { return binoUp; },
    // the controller's binoculars state: hides the bar, and <html>.lk-bino-up (no chart circle over the glasses' view)
    setBino(up) { binoUp = up; if (binoUp !== document.documentElement.classList.contains('lk-bino-up')) document.documentElement.classList.toggle('lk-bino-up', binoUp); },
    setHooks(h) { Object.assign(hooks, h); },
    onKey(fn) { keyFns.push(fn); },
    mountDock, mountBar,
    // setIntro(fn): a camera move over the follow view, fn(dt, followPose, state, { look }) → a pose, or null when done
    setIntro(fn) { intro = typeof fn === 'function' ? fn : null; }, get introOn() { return !!intro; },
    // the pads' and the binoculars' share of the frame's look and zoom
    addLook(dx, dy) { odx += dx; ody += dy; }, addZoom(f) { zoom *= f; },
    look() { return dragging || odx || ody ? [odx, ody] : null; },
    get zoom() { return zoom; },
    begin(dt) { t += dt; },
    update(dt) { if (hHeld && t - hAt > 12) keysList(false); dock?.update(dt); },
    // the camera chain: the follow camera (its lead by device class, the orbit and the zoom in the follow view, zoomMul on
    // top), its ride on the sea, lean(p) (a gust's heel), the intro, the helm camera while it is the view or on the way,
    // the blend, then scene(st) (a scene's own camera, or null: the fireworks' one-tap show) and outer(normal) (the
    // binoculars, the anchoring's rise), onto the camera. look: the frame's drag; viewLook: the look the views take
    camera(dt, { rs, pose, look = null, viewLook = look, zoomMul = 1, lean = (p) => p, scene = null, outer = null }) {
      { const hc = document.documentElement.classList;   // an upright phone: the boat above the control band; a phone sideways with the cockpit: above the coaming
        follow.lead = hc.contains('lk-phone') && /\bportrait\b/.test(document.documentElement.dataset.screen ?? '') ? FOLLOW.leadPortrait : hc.contains('lk-phone-l') && hc.contains('lk-cockpit') ? FOLLOW.leadPhoneCockpit : FOLLOW.lead; }
      const p0 = follow.update(dt, rs, { orbit: view === 'follow' ? viewLook : null, zoom: view === 'follow' ? zoom * zoomMul : 1 });   // the follow camera's zoom is a per-frame factor: the step only
      // the follow camera rides the sea a little (owner 2026-10-30: the waves must be felt): CAM_RIDE of the boat's heave and pitch, smoothed over
      // CAM_RIDE_TAU s; the view lifts and dips with the swell, the horizon never rolls (the helm view has its own steady-horizon setting)
      const kr = 1 - Math.exp(-dt / CAM_RIDE_TAU);
      camRide.h += ((pose.heave ?? 0) - camRide.h) * kr; camRide.p += ((pose.pitch ?? 0) - camRide.p) * kr;
      const lift = camRide.h * camRideK, run = Math.hypot(p0.target[0] - p0.pos[0], p0.target[2] - p0.pos[2]);
      const p = lean(camRideK > 0 ? { ...p0, pos: [p0.pos[0], p0.pos[1] + lift, p0.pos[2]], target: [p0.target[0], p0.target[1] + lift + run * Math.tan(camRide.p * camRideK), p0.target[2]] } : p0);
      followPose = p;
      // the staged first visit's opening move (src/ui/firstStage.js introCam): it ends in this very follow pose, then lets go
      const pv = intro && view === 'follow' && blend.k <= 0 ? intro(dt, p, rs, { look: !!look }) : p;
      if (pv === null) intro = null;
      // the helm camera runs while the helm is the view or the camera is on its way to or from it
      const helmP = view === 'helm' || blend.k > 0 ? helmCam.update(dt, pose, { look: view === 'helm' ? viewLook : null, zoom: view === 'helm' ? zoom : 1 }) : null;
      blend.step(dt);
      const followNormal = blend.k <= 0 || !helmP ? { ...(pv ?? p), near: 0.5 } : blend.k >= 1 ? helmP : blendPose(p, helmP, blend.e, { eye: helmP.pos, heading: pose.heading });
      const normal = scene?.({ interrupt: !!look || zoom !== 1 || view !== 'follow' }) ?? followNormal;
      const final = outer ? outer(normal) : normal;
      applyPose(camera, final);
      camera.updateMatrixWorld();
      return final;
    },
    end() { odx = ody = 0; zoom = 1; },
    abort() { off.abort(); },
    dispose() {
      off.abort();
      dock?.dispose(); modality.dispose(); ripple.dispose(); viewSwitch?.dispose();
      for (const k of ['dock', 'modality']) services.remove(k);
      services.remove('viewSwitch', viewSwitch);
    },
  };
  return deck;
}
