// The helm station (owner, 2026-10-30): so a first-time player steers and trims without a key.
//   - THE WHEEL: the boat's own wheel (wheel.glb, the same node and materials as on the pedestal), a live 3D object on the
//     bottom row left of centre beside the chart circle. It always draws the real rudder (×4, Boat.js); a drag turns it
//     (relative to where it was grabbed, pointer capture), a scroll turns it; the keys and the pad turn it as they steer.
//     Hidden in the helm view: the real wheel is there.
//   - TWO WINCHES, MAIN and JIB, under the boat: the boat's own winches cut from cockpit.glb (the cabin-top winch of the
//     main sheet, the starboard primary of the jib sheet), each with its sheet's turns on the drum, its tail, a handle in
//     its socket, a sail-leaf marker (green: drawing; amber: luffing; amber and flat: stalled) and a label tape. Crank,
//     drag, scroll or the ▼ ▲ steps (helmInput.js); every drum draws the real sheet, whatever moved it.
//   - LET FLY (feat/let-fly): a click on a winch throws its sheet off (a long press on touch; a touch tap
//     never does); the tail flies off the drum, the handle is stowed, the leaf flutters amber while the sail flogs. A click
//     on a free winch grinds the sheet back in. free() names the sheets that fly; takeFly(side) is the click, once.
//   - The control panel (controlPanel.js) is its own module; this one lays it out with the rest (helmLayout).
// The 3D objects render through core.hud (hud3d.js): lit by the scene's sun and sky, at the scene's exposure.
// THE COCKPIT (owner, 2026-11-06; cockpit3d.js; stage 1: a desktop): the wheel and the winches go into one 3D cockpit across the
// bottom (the coaming, its recessed panels, the lever and TACK on its cap) in one slot, rendered on change; the station's DOM
// (and the panel's, the lever's, Tack's) stays as the invisible hit and accessibility layer over the 3D parts, ≥ 44 px. The
// dials go to the top corners and the subtitle to the lower third. ?panel=dom keeps the old row; phones and tablets keep theirs.
//
//   const st = createHelmStation(core, { boat, state: () => phys.state, furl: () => ctl.furl, hidden: () => bool,
//                                        helmView: () => bool, onUse, cue, fade: () => ({ wheel, jib, main }) | null });
//   st.update(dt);           // each frame, after the boat moved
//   st.steer                 // the wheel's command −1..1 while held (else null)
//   st.take('main'|'jib')    // the sheet change asked since the last call (rad, + = in), then 0
//   st.hold('main'|'jib')    // the held step button's direction now (+1 in, −1 ease, 0)
//   st.takeFly('main'|'jib') // a click (or a touch's long press) on that winch since the last call: let fly / sheet in
//   st.rects, st.boatBox()   // the layout (css px) and the boat's on-screen box (tests, probes)
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { ensureTokens } from '../../../../src/ui/tokens.js';
import { HELM_IN, WinchGesture, WheelGesture, SteerSlide, StepHold, sailState, drumAngle, wheelAngle, scrollSheet, wheelScroll, JIB_DRUM_PER_SHEET } from '../../../../src/stations/sloop/helmInput.js';
import { FLAGS } from '../../../../src/sim/core/flags.js';
import { FlyPress } from '../../../../src/sim/sail/letFly.js';
import { createCockpit3d, COCKPIT, COCKPIT_PHONE } from './cockpit3d.js';
import { proLayout } from '../../../../src/stations/sloop/proRecess.js';
import { createDialFaces, FaceClock, FACES, windKey, windRead, chartKey } from '../../../../src/stations/sloop/dialFaces.js';
import { helmLayout, GRID_W, gridUnit, gridBottom, portraitLayout, cockpitKind, spreadCells, overlaps } from '../../../../src/stations/sloop/helmLayout.js';
import { cutWinch, ropeMaterial, sheetParts, handle, findMat } from './helmParts.js';
import { LEAF, CSS } from '../../../../src/stations/sloop/helmStyle.js';
import { createFoldButton, FOLD_BTN } from '../../../../src/stations/sloop/foldButton.js';
export { helmLayout, GRID_W, gridUnit, gridBottom, portraitLayout, cockpitKind, spreadCells, overlaps };   // the layout's importers (tests, probes) read it here

const DEG = Math.PI / 180;
// the wheel's drag pad, as a share of its rect's width: the slot (the wheel alone in its frame) and the cockpit (the rect is the rim's
// projected centre line, so the pad reaches past the rim's outer edge)
export const WHEEL_PAD = { slot: 0.88, cockpit: 1.15 };
// the winches as built in cockpit.glb (HULL frame, measured from its lod_near meshes: renders/helm3d notes): axis (x, z), the
// cut radius, the vertical span; the drum's waist where the sheet's turns lie; the handle's reach
const WINCHES = {
  main: { x: 0.55, z: 1.22, r: 0.09, y0: 1.33, y1: 1.535, drum: [0.047, 0.065, 0.105], handle: 0.12 },   // the cabin-top winch to starboard (lines.js: the main sheet's)
  jib: { x: 1.33, z: 2.65, r: 0.118, y0: 1.18, y1: 1.41, drum: [0.054, 0.085, 0.125], handle: 0.14 },   // the starboard primary (the jib sheet's)
};

const HINT_KEY = 'lakeshore.helm.v1';

export function createHelmStation(core, { boat, state, furl = () => 0, hidden = () => false, helmView = () => false, onUse = () => {}, cue = () => {},
  coarse = false, once = true, storage = globalThis.localStorage ?? null, root = document.body, panelRect = null, quietHints = () => false, jibOn = () => true,
  fade = () => null, free = () => null, cockpit: ckIn = null, calm = () => null, pro = null } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-helm-css')) { const st = document.createElement('style'); st.id = 'lk-helm-css'; st.textContent = CSS; document.head.appendChild(st); }
  const hud = core.hud;
  const H = document.documentElement;

  // ---- 3D: the wheel (the boat's own wheel.glb node, cloned: the same geometry and materials) ----
  const wheelSrc = boat.modules.wheel;
  const wheelItem = new THREE.Group(); wheelItem.name = 'hud:wheel';
  const wheelSpin = new THREE.Group(); wheelItem.add(wheelSpin);
  const wheel = wheelSrc.clone(true); wheelSpin.add(wheel);   // its own transform kept: the module's origin is on the axle (assemble.js)
  wheelItem.position.set(0, 0, 0);
  const wheelCam = new THREE.PerspectiveCamera(22, 1, 0.1, 20); // the helmsman's view (owner, 2026-10-30): nearly face-on, the wheel tilted back 12° as on its pedestal, the hub centred
  { const tilt = 12 * DEG, dist = 2.5; wheelCam.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist); wheelCam.lookAt(0, 0, 0); } wheelItem.add(wheelCam);
  // ---- 3D: the two winches, cut from cockpit.glb, with their sheets and handles ----
  const cockpit = boat.modules.cockpit;
  const steel = findMat(cockpit, /near_chrome|stainless/) ?? new THREE.MeshStandardNodeMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.2 });
  const black = findMat(cockpit, /near_black|rubber/) ?? new THREE.MeshStandardNodeMaterial({ color: 0x111111, roughness: 0.7 });
  const winch = {};
  let k = 0;
  for (const side of ['jib', 'main']) {
    const spec = WINCHES[side];
    const item = new THREE.Group(); item.name = `hud:winch-${side}`; item.position.set(30 + 30 * k++, 0, 0);
    const spin = new THREE.Group(); item.add(spin);
    const body = cutWinch(cockpit, spec); spin.add(body);
    const run = { u: uniform(0), len: 40 };
    const rope = ropeMaterial(run), parts = sheetParts(spec, rope);
    spin.add(parts.turns); item.add(parts.tail);
    const hd = handle(spec, steel, black); spin.add(hd);
    // the trimmer's eye: aft and above, the winch and its handle's sweep filling the frame
    const reach = Math.max(spec.handle, spec.r) * 1.3,   // the handle's whole sweep inside the frame (its grip is a hit target)
      dist = reach / Math.tan(15 * DEG);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.02, 10);
    const top = spec.y1 - spec.y0;
    cam.position.set(0.05 * dist, top * 0.8 + dist * Math.sin(64 * DEG), dist * Math.cos(64 * DEG)); cam.lookAt(0, top * 0.8, 0); item.add(cam);   // the drum's top (the handle's socket) at the frame's centre: the grip's circle stays inside
    winch[side] = { spec, item, spin, body, run, hd, cam, tris: body.children.length, tail: parts.tail, turns: parts.turns, fly: 0 };
  }

  // the objects face the way the boat does, so the sun falls on them as on the boat (Boat.js: rotation.y = −heading)
  const face = (o) => { const s = state(); o.rotation.y = -(s?.heading ?? 0); };
  // the cockpit (built on a desktop with ?panel=3d, the default; ck: { toggles(), tools(), engine(), tack() } the controls' states)
  const cockpitOn = !!ckIn && !!hud && FLAGS.panel !== 'dom';
  let ck = null, faces = null;
  const NIGHT_LAMP = new THREE.Color(1, 0.9, 0.78);

  // ---- DOM ----
  const el = document.createElement('div'); el.className = 'lk-helm'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'helm station');
  el.innerHTML = '<div class="pad steer" aria-hidden="true" hidden></div><div class="pad wheel" role="slider" tabindex="0" aria-label="Helm" aria-valuemin="-25" aria-valuemax="25" aria-valuenow="0"></div><div class="rd" aria-hidden="true"><span></span><em></em></div>'
    + ['jib', 'main'].map((s) => `<div class="grp" data-w="${s}"><div class="pad winch" data-w="${s}" role="slider" tabindex="0" aria-label="${s === 'main' ? 'Mainsheet winch' : 'Jib sheet winch'}" aria-valuemin="0" aria-valuemax="90"></div>`
      + `<div class="stp" data-w="${s}"><button type="button" data-d="-1" aria-label="ease the ${s}">▲</button><button type="button" data-d="1" aria-label="pull the ${s} in">▼</button></div></div>`
      + `<div class="leaf" data-w="${s}" data-s="off">${LEAF}</div><div class="tape" data-w="${s}">${s.toUpperCase()}</div><div class="ro" data-w="${s}" aria-live="polite"></div>`).join('')
  root.appendChild(el);
  const $ = (q) => el.querySelector(q);
  const steerPad = $('.pad.steer'), wheelPad = $('.pad.wheel'), rd = $('.rd'), rdT = rd.querySelector('span'), rdE = rd.querySelector('em');
  const pads = { jib: $('.pad.winch[data-w=jib]'), main: $('.pad.winch[data-w=main]') };
  const grps = { jib: $('.grp[data-w=jib]'), main: $('.grp[data-w=main]') };
  const stps = { jib: $('.stp[data-w=jib]'), main: $('.stp[data-w=main]') };
  const leaves = { jib: $('.leaf[data-w=jib]'), main: $('.leaf[data-w=main]') };
  const tapes = { jib: $('.tape[data-w=jib]'), main: $('.tape[data-w=main]') };
  const ros = { jib: $('.ro[data-w=jib]'), main: $('.ro[data-w=main]') };
  const stop = (e) => e.stopPropagation();
  for (const n of el.querySelectorAll('.pad,.stp button')) { n.addEventListener('pointerdown', stop); n.addEventListener('click', stop); }

  // first use: the ghosts go for good (once per browser; ?once=0 every page)
  const seen = (() => { try { return once ? JSON.parse(storage?.getItem(HINT_KEY) ?? '{}') ?? {} : {}; } catch { return {}; } })();
  const mark = (k2) => { if (seen[k2]) return; seen[k2] = true; try { if (once) storage?.setItem(HINT_KEY, JSON.stringify(seen)); } catch { /* private mode */ } };

  // ---- input state ----
  const pend = { main: 0, jib: 0 }, taken = { main: 0, jib: 0 };
  const flyPress = { main: new FlyPress(), jib: new FlyPress() }, flyPend = { main: false, jib: false };   // let fly: the click or the long press
  const steps = { main: new StepHold(), jib: new StepHold() };
  let steer = null, wheelHeldAt = -9, t = 0, forced = null;
  const wg = new WheelGesture(), gest = { main: new WinchGesture(), jib: new WinchGesture() };
  const scr = { wheel: null, jib: null, main: null };   // the projected centres and grips, css px (set each frame)
  const used = (k2) => { mark(k2); onUse(); };

  // the wheel: a drag about the hub; a scroll; keys ← → Home while focused
  let wheelPid = null;
  wheelPad.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0) return;
    const c = scr.wheel; if (!c) return;
    wheelPid = e.pointerId; try { wheelPad.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    wg.press({ x: e.clientX, y: e.clientY }, { centre: c, wheel: wheelAngle(state()?.rudderAngle ?? 0) });
    steer = wg.command; wheelPad.classList.add('held'); used('wheel'); e.preventDefault();
  });
  wheelPad.addEventListener('pointermove', (e) => { if (e.pointerId !== wheelPid) return; steer = wg.move({ x: e.clientX, y: e.clientY }); wheelHeldAt = t; e.preventDefault(); });
  const wheelUp = (e) => { if (e.pointerId !== wheelPid) return; wheelPid = null; wg.release(); steer = null; wheelHeldAt = t; wheelPad.classList.remove('held'); };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) wheelPad.addEventListener(ev, wheelUp);
  // a phone's drag-anywhere steer (feat/cockpit-phone): the left thumb's zone turns the wheel by a sideways slide (SteerSlide); the
  // controls inside the zone (JIB, TACK, PRO, the chart) stand over it and keep their own touches
  const slide = new SteerSlide();
  let steerPid = null;
  steerPad.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0) return;
    const r = lay?.wheel; if (!r) return;
    steerPid = e.pointerId; try { steerPad.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    slide.press(e.clientX, { r: r.w / 2, wheel: wheelAngle(state()?.rudderAngle ?? 0) });
    steer = slide.command; wheelPad.classList.add('held'); used('wheel'); e.preventDefault();
  });
  steerPad.addEventListener('pointermove', (e) => { if (e.pointerId !== steerPid) return; steer = slide.move(e.clientX); wheelHeldAt = t; e.preventDefault(); });
  const steerUp = (e) => { if (e.pointerId !== steerPid) return; steerPid = null; slide.release(); steer = null; wheelHeldAt = t; wheelPad.classList.remove('held'); };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) steerPad.addEventListener(ev, steerUp);
  steerPad.addEventListener('pointerdown', stop); steerPad.addEventListener('click', stop);
  let scrollSteerUntil = -9;
  wheelPad.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    const w0 = steer != null ? steer : (state()?.rudderAngle ?? 0) / HELM_IN.rudderMax;
    steer = Math.max(-1, Math.min(1, w0 + wheelScroll(e) / (HELM_IN.rudderMax * HELM_IN.wheelPerRudder)));
    scrollSteerUntil = t + 0.35; wheelHeldAt = t; used('wheel');
  }, { passive: false });
  wheelPad.addEventListener('keydown', (e) => {
    const r = (state()?.rudderAngle ?? 0) / HELM_IN.rudderMax;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { steer = Math.max(-1, Math.min(1, r + (e.code === 'ArrowRight' ? 1 : -1) / 25)); scrollSteerUntil = t + 0.4; }
    else if (e.code === 'Home') { steer = 0; scrollSteerUntil = t + 0.8; }
    else return;
    e.preventDefault(); e.stopPropagation(); wheelHeldAt = t; used('wheel');
  });

  // the winches: crank or drag; scroll; the steps; ↑ ↓ while focused
  for (const side of ['jib', 'main']) {
    const pad = pads[side]; let pid = null;
    pad.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button > 0) return;
      const c = scr[side]; if (!c) return;
      pid = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      gest[side].press({ x: e.clientX, y: e.clientY }, { centre: c.c, radius: c.r, grip: c.grip });
      flyPress[side].press(t, e.clientX, e.clientY, e.pointerType === 'touch');
      pad.classList.add('held'); used('winch'); e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId !== pid) return; pend[side] += gest[side].move({ x: e.clientX, y: e.clientY }); flyPress[side].move(e.clientX, e.clientY); e.preventDefault(); });
    const up = (e) => {
      if (e.pointerId !== pid) return; pid = null; gest[side].release(); pad.classList.remove('held');
      if (e.type === 'pointerup' && flyPress[side].release(t, !!free()?.[side])) flyPend[side] = true; else flyPress[side].down = null;   // a click: let fly, or in from free
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, up);
    grps[side].addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); pend[side] += scrollSheet(e); used('winch'); }, { passive: false });
    pad.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); pend[side] += scrollSheet(e); used('winch'); }, { passive: false });
    stps[side].addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); pend[side] += scrollSheet(e); used('winch'); }, { passive: false });
    pad.addEventListener('pointerenter', () => grps[side].classList.add('hov'));
    grps[side].addEventListener('pointerleave', () => grps[side].classList.remove('hov'));
    stps[side].addEventListener('pointerenter', () => grps[side].classList.add('hov'));
    stps[side].addEventListener('pointerleave', () => grps[side].classList.remove('hov'));
    for (const b of stps[side].querySelectorAll('button')) {
      const d = +b.dataset.d;
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button > 0) return;
        try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        pend[side] += steps[side].down(d, t * 1000);   // the station's scene clock (update's dt), not the wall clock
        b.classList.add('on'); used('winch'); e.preventDefault(); e.stopPropagation();   // #50: e127e00a's comment had swallowed these
      });
      const off = () => { steps[side].up(); b.classList.remove('on'); };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
    }
    pad.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') { flyPend[side] = true; used('winch'); e.preventDefault(); e.stopPropagation(); return; }   // the click's keyboard twin
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      pend[side] += (e.code === 'ArrowDown' ? 1 : -1) * HELM_IN.step; used('winch'); e.preventDefault(); e.stopPropagation();
    });
  }

  // ---- hud slots: the rectangles follow the layout; null hides ----
  // fade(): the Calm HUD's opacity per object ({ wheel, jib, main }, 0..1; ui/calmHud.js), or null (all at 1). At 0 a slot is
  // hidden (no render), as hidden() hides them all; between, the slot's own opacity (hud3d.js setOpacity)
  let lay = null, shown = false, op = { wheel: 1, jib: 1, main: 1 };
  const on = (k) => op[k] > 0.004;
  const rectOf = (r, k) => (shown && r && on(k) ? r : null);
  let wheelSlot = null, jibSlot = null, mainSlot = null, ckSlot = null, mounted = null, ckOp = 1, ckDirty = true, ckSig = '';
  // the slots for the form: 'grid' (three, the wheel and the winches each in its own) or 'cockpit' (one); a resize can switch
  function mountSlots(form) {
    if (!hud || form === mounted) return;
    for (const sl of [wheelSlot, jibSlot, mainSlot, ckSlot]) sl?.dispose();
    wheelSlot = jibSlot = mainSlot = ckSlot = null; mounted = form;
    H.classList.toggle('lk-cockpit', form === 'cockpit');
    if (form !== 'cockpit') ck?.detach();   // the boat's wheel and winches back in their own materials
    if (form !== 'cockpit') { H.classList.remove('lk-dials-in', 'lk-raise-chart', 'lk-raise-wind'); for (const b of Object.values(instBtn)) b.hidden = true; foldBtn.place({ show: false }); pro?.place(null); }
    if (form === 'cockpit') {
      if (!ck) { faces = createDialFaces(); ck = createCockpit3d({ boat, wheel: wheelItem, winches: { jib: winch.jib, main: winch.main }, faces: faces.canvas, labels: FLAGS.cockpitlabels === 'a' ? 'a' : 'b', worldLight: FLAGS.cockpitlight !== false }); }
      ck.attach();
      for (const side of ['jib', 'main']) { winch[side].item.position.set(0, 0, 0); winch[side].item.rotation.set(0, 0, 0); }
      wheelItem.rotation.set(0, 0, 0);
      ck.layout({ w: innerWidth, h: innerHeight, phone: lay.kind === 'phone-land' });
      ckSlot = hud.slot({ object: ck.root, camera: ck.camera, fixedCamera: true, maxPx: 4096, dirty: () => ckDirty,
        rect: () => (shown && ckOp > 0.004 ? ck.rect : null), area: () => (shown ? ck.rect : null),
        update: () => {
          ck.root.rotation.y = -(state()?.heading ?? 0); ck.heading(state()?.heading ?? 0); ck.root.updateMatrixWorld(true);
          // stage 1b, night: the deck lamp's red stays off the gelcoat (a dim warm neutral); the red-amber is the words', the tach's and the tell-tales' own
          if (nightK > 0) { hud.fill.color.lerp(NIGHT_LAMP, nightK); hud.fill.intensity *= 1 - 0.7 * nightK; }
          ck.light(hud.fill, hud.level);   // the cockpit's light (cockpitMaterials.js): the lamp's directional share into a diffuse deck bounce
        } });
      ckSlot.setOpacity(ckOp);
      return;
    }
    let k2 = 0;
    for (const side of ['jib', 'main']) { winch[side].item.position.set(30 + 30 * k2++, 0, 0); winch[side].item.scale.setScalar(1); winch[side].item.visible = true; }
    wheelSlot = hud.slot({ object: wheelItem, camera: wheelCam, rect: () => (shown && on('wheel') && !helmView() ? lay?.wheel : null), area: () => (shown && !helmView() ? lay?.wheel : null), update: () => face(wheelItem) });
    jibSlot = hud.slot({ object: winch.jib.item, camera: winch.jib.cam, rect: () => rectOf(lay?.jib, 'jib'), area: () => (shown ? lay?.jib : null), update: () => face(winch.jib.item) });
    mainSlot = hud.slot({ object: winch.main.item, camera: winch.main.cam, rect: () => rectOf(lay?.main, 'main'), area: () => (shown ? lay?.main : null), update: () => face(winch.main.item) });
  }

  // project a hud object's point to css px inside its rect
  const v3 = new THREE.Vector3();
  const project = (cam, obj, p, rect) => {
    let top = obj; while (top.parent && top.parent !== hud?.scene) top = top.parent;   // the item, so its own turn (face()) is in the matrices
    top.updateMatrixWorld(true);
    v3.copy(p).applyMatrix4(obj.matrixWorld).project(cam);
    return { x: rect.x + (v3.x + 1) / 2 * rect.w, y: rect.y + (1 - v3.y) / 2 * rect.h };
  };
  const css = (n, r) => { n.style.left = `${r.x}px`; n.style.top = `${r.y}px`; n.style.width = `${r.w}px`; n.style.height = `${r.h}px`; };
  function relayout() {
    const cs = getComputedStyle(H);
    const px = (v, d0) => { const p = document.createElement('div'); p.style.cssText = `position:absolute;visibility:hidden;width:${v}`; document.body.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return w || d0; };
    const d = px(cs.getPropertyValue('--lk-d').trim() || '220px', 220), by = px(cs.getPropertyValue('--lk-by').trim() || '14px', 14), mx = px(cs.getPropertyValue('--lk-mx').trim() || '40px', 40);
    const rowH = px(cs.getPropertyValue('--lk-row-h').trim() || '46px', 46);
    const inset = { l: px('var(--lk-sal,0px)', 0), r: px('var(--lk-sar,0px)', 0), b: px('var(--lk-sab,0px)', 0) };
    jibWas = !!jibOn();
    const top = px('var(--lk-cap-top,66px)', 66);   // the bar's foot and its gap: the portrait circles stand there
    lay = helmLayout({ w: innerWidth, h: innerHeight, d, by, mx, coarse, inset, jib: jibWas, rowH, top, trimAt: FLAGS.trimpanel === 'right' ? 'right' : 'top' });
    el.style.setProperty('--lk-hu', `${lay.u.toFixed(3)}px`);
    mountSlots(cockpitOn && cockpitKind(lay.kind) ? 'cockpit' : 'grid');
    if (mounted === 'cockpit') { cockpitLayout(); return; }
    placeDom();
    // the circles follow the layout (tokens.css: a phone's wind dial above the winches; an upright iPad's circles above the group's ends)
    const HS = H.style, G = lay.group;
    if (lay.dial) { HS.setProperty('--lk-dial-r', `${innerWidth - lay.dial.x - lay.dial.w}px`); HS.setProperty('--lk-dial-b', `${innerHeight - lay.dial.y - lay.dial.h}px`); HS.setProperty('--lk-dial-t', `${lay.dial.y}px`); }
    if (lay.chart) { HS.setProperty('--lk-chart-l', `${lay.chart.x}px`); HS.setProperty('--lk-chart-t', `${lay.chart.y}px`); HS.setProperty('--lk-pd', `${lay.chart.w}px`); HS.setProperty('--lk-circ-b', `${lay.chart.y + lay.chart.h}px`); }
    else for (const v of ['--lk-chart-l', '--lk-chart-t', '--lk-pd', '--lk-circ-b', '--lk-dial-t']) HS.removeProperty(v);
    if (G) { HS.setProperty('--lk-grp-l', `${G.x}px`); HS.setProperty('--lk-grp-r', `${innerWidth - G.x - G.w}px`); HS.setProperty('--lk-grp-b', `${innerHeight - G.y + 10}px`); }
    panelRect?.(lay);
  }
  // the station's own DOM over the layout's rects: the wheel's pad, each winch's pad, steps, leaf, tape and readout
  function placeDom() {
    // the wheel's pad: the rim's circle (88 % of the slot's rect). In the cockpit the rect is the rim's centre line as projected
    // (hub to the rim's top, foreshortened by the wheel's tilt), so the pad reaches 1.15 x: past the rim's outer edge on every side,
    // the spokes and the inner area inside it (fix/wheel-rim-drag; owner, 2026-11-12: "I need to drag inner the wheel not on the
    // wheel itself": the 0.88 pad stopped about 20 px inside the rim the player sees)
    const pk = lay.form === 'cockpit' ? WHEEL_PAD.cockpit : WHEEL_PAD.slot, wr = lay.wheel;
    const wp = { x: wr.x + wr.w * (1 - pk) / 2, y: wr.y + wr.h * (1 - pk) / 2, w: wr.w * pk, h: wr.h * pk };
    css(wheelPad, wp);
    steerPad.hidden = !lay.steerZone; if (lay.steerZone) css(steerPad, lay.steerZone);
    for (const side of ['jib', 'main']) {
      const r = lay[side];
      for (const n of [grps[side], tapes[side], ros[side], leaves[side]]) n.hidden = !r;   // phone portrait: no JIB while the crew keeps it
      if (!r) continue;
      css(pads[side], { x: 0, y: 0, w: r.w + 8, h: r.h + 8 });   // inside its group's box
      css(grps[side], { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
      const finger = document.documentElement.dataset.input === 'touch';
      stps[side].classList.toggle('row', finger);
      if (finger) {
        // a finger: the 44 px steps side by side, outboard of the winch, their foot at its middle (a column of two 44 px buttons hung
        // down onto the PRO recess and the toggles: "B▼OS", 2026-11-10; PRO's open targets start just under the winch's middle)
        const bw = 44, gap = 8, rowW = 2 * bw + gap, x = side === 'jib' ? r.x - 6 - rowW : r.x + r.w + 6;
        stps[side].style.left = `${x - (r.x - 4)}px`; stps[side].style.top = `${r.y + r.h / 2 - bw - (r.y - 4)}px`;
      } else {
        const sw = Math.max(28, 28 * lay.u), out = side === 'jib' ? r.x + 2 * lay.u : r.x + r.w - sw - 2 * lay.u;   // on hover, inside the slot at its outer edge
        stps[side].style.left = `${out - (r.x - 4)}px`; stps[side].style.top = `${r.y + r.h / 2 - sw - 11 * lay.u - (r.y - 4)}px`;   // inside its group's box
      }
      stps[side].hidden = !lay.steps;
      tapes[side].style.left = `${r.x + r.w / 2}px`; tapes[side].style.top = `${r.y + r.h + 1}px`;
      ros[side].style.left = `${r.x + r.w / 2}px`; ros[side].style.top = `${r.y + 2 * lay.u}px`;
      if (lay.form === 'cockpit') { leaves[side].style.left = `${side === 'jib' ? r.x + r.w * 0.18 : r.x + r.w * 0.82}px`; leaves[side].style.top = `${r.y + r.h * 0.3}px`; }   // beside the winch, outboard
      else { leaves[side].style.left = `${side === 'jib' ? r.x + 9 * lay.u : r.x + r.w - 9 * lay.u}px`; leaves[side].style.top = `${r.y + 13 * lay.u}px`; }   // the slot's outer top corner
    }
    rd.style.left = `${wr.x + wr.w / 2}px`; rd.style.top = `${lay.form === 'cockpit' ? wr.y + wr.h * 0.3 : wr.y + wr.h * 0.66}px`;
  }

  // ---- the cockpit's layout: the camera and the slot for the viewport (on resize), the hit layer from its 3D parts (each frame) ----
  const RR = (cx, cy, w2, h2) => ({ x: Math.round(cx - w2 / 2), y: Math.round(cy - h2 / 2), w: Math.round(w2), h: Math.round(h2) });
  let ckKey = '', dialAt = -9, moorNow = null, windGrow = false;
  // the dials (owner, 2026-11-06; feat/cockpit-dials): 'in' (default) set into the coaming's ends as 3D instruments, the DOM dials
  // their raised full views; or 'top' (layout B, the DOM dials in the top corners); ?dials=
  let dialsMode = FLAGS.dials === 'top' ? 'top' : 'in';
  // the instruments' hit and accessibility layer: a round button over each face; hover, focus or a tap raises its full view
  const instBtn = {}, inst = { chart: { hov: false, pin: false, until: -9, up: false, at: null, glow: 1 }, wind: { hov: false, pin: false, until: -9, up: false, at: null, glow: 1 } };
  for (const [side, name] of [['chart', 'chart instrument'], ['wind', 'wind instrument']]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lk-inst'; b.dataset.k = side; b.hidden = true; b.setAttribute('aria-label', name); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') inst[side].hov = true; });
    b.addEventListener('pointerleave', () => { inst[side].hov = false; });
    b.addEventListener('focus', () => { inst[side].hov = true; }); b.addEventListener('blur', () => { inst[side].hov = false; });
    b.addEventListener('click', (e) => { e.stopPropagation(); inst[side].pin = !inst[side].pin; if (!inst[side].pin) { inst[side].hov = false; inst[side].until = -9; } dispatchEvent(new Event('lk-click')); });
    el.appendChild(b); instBtn[side] = b;
  }
  // the fold button (foldButton.js; owner 2026-11-12): the Calm HUD owns the fold (calmHud.js tab()); two places: up on the guard, folded at the foot
  const foldBtn = createFoldButton({ parent: el, onPress: () => calm()?.tab?.(), reveal: !(FLAGS.filmui || FLAGS.film || FLAGS.headless != null) }), foldTab = foldBtn.el;
  foldBtn.watch(wheelPad);   // the mark sits on the wheel's hub: a tap there folds, a drag from there steers
  // the pointer (the wind dial grows under it: the dial itself takes no pointer)
  let ptr = null;
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') ptr = [e.clientX, e.clientY]; }, { passive: true });
  function cockpitLayout() {
    const { view, rect } = ck.layout({ w: innerWidth, h: innerHeight, phone: lay.kind === 'phone-land' });
    ckSlot?.setMaxPx?.(lay.kind === 'phone-land' ? COCKPIT_PHONE.maxPx : 4096);   // a phone: a capped render target
    ckDirty = true; ckKey = '';
    const u = lay.u, trw = 200 * u, th2 = 96 * u;
    Object.assign(lay, { form: 'cockpit', steps: true, cockpit: { rect, wheelTop: Math.round(view.wheelTop), subBottom: Math.round(view.subBottom), capY: Math.round(view.capY) },
      trim: { x: Math.round(innerWidth - trw - 40), y: Math.round(rect.y - th2 - 6), w: Math.round(trw), h: Math.round(th2) } });
    delete lay.group;
    for (const v of ['--lk-grp-l', '--lk-grp-r', '--lk-grp-b']) H.style.removeProperty(v);
    dialAt = -9; placeDials();
    cockpitFrame(true);
  }
  // the dials: in the coaming (the raised views' boxes follow the instruments each frame: instFrame), or in the top corners, clear
  // of the bar (a narrow window: under it)
  function placeDials() {
    const isIn = dialsMode === 'in';
    H.classList.toggle('lk-dials-in', isIn);
    if (isIn) { instFrame(true); return; }
    for (const side of ['chart', 'wind']) { instBtn[side].hidden = true; H.classList.remove(`lk-raise-${side}`); inst[side].up = false; }
    const isl = [...document.querySelectorAll('.lk-view>.isl')].map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0), bar = isl.length ? { left: Math.min(...isl.map((r) => r.left)), bottom: Math.max(...isl.map((r) => r.bottom)), width: 1 } : null, sm = document.querySelector('.lk-chart .small');
    const dsz = (sm?.offsetWidth || 220) * 0.9, dx = 26;
    const clash = bar && bar.width > 0 && dx + dsz + 8 > bar.left;
    H.style.setProperty('--lk-ck-dy', `${clash ? Math.round(bar.bottom + 8) : 12}px`);
  }
  const V0 = new THREE.Vector3(), V1 = new THREE.Vector3();
  function cockpitFrame(force = false) {
    const r = ck.rect, sc = innerHeight / 1080, A = ck.anchors, v = ck.view;
    // one matrix update for the whole cockpit, then each anchor from its own world matrix (project() per anchor walked the whole
    // object every time: ≈ 1.4 ms a frame on a 4x-throttled phone, feat/cockpit-phone)
    ck.root.updateMatrixWorld(true);
    const P = (o) => { V0.setFromMatrixPosition(o.matrixWorld).project(ck.camera); return { x: r.x + (V0.x + 1) / 2 * r.w, y: r.y + (1 - V0.y) / 2 * r.h }; };
    const Pl = (o, p) => { V0.copy(p).applyMatrix4(o.matrixWorld).project(ck.camera); return { x: r.x + (V0.x + 1) / 2 * r.w, y: r.y + (1 - V0.y) / 2 * r.h }; };
    const hub = P(A.hub), top = P(A.wheelTop), wr = Math.max(40, hub.y - top.y);
    lay.wheel = RR(hub.x, hub.y, 2 * wr, 2 * wr);
    const pxm = v.f / (COCKPIT.camZ + 1.65);   // px per metre on the cap
    for (const side of ['jib', 'main']) {
      const W = winch[side], top3 = W.spec.y1 - W.spec.y0, c = Pl(W.item, V1.set(0, top3, 0));
      const half = Math.max(22, (W.spec.handle + 0.03) * 1.25 * COCKPIT.winchScale * pxm);
      lay[side] = RR(c.x, c.y + half * 0.15, 2 * half, 2 * half);
      scr[side] = { c, grip: Pl(W.spin, W.hd.userData.grip), r: half };
    }
    scr.wheel = hub;
    const cells = {}, cw = Math.max(44, 0.3 * pxm), ch = Math.max(44, 72 * sc);
    for (const [id] of COCKPIT.toggles) { const a = P(A[`t:${id}`]); cells[id] = RR(a.x, a.y, cw, ch); }
    if (moorNow) { const a = P(A.moor), d = Math.max(48, 56 * sc); cells.lines = RR(a.x, a.y, d, d); }   // MOOR (or DAWN) on the cap, only while it can be used
    { const a = P(A.key); cells.engine = RR(a.x, a.y, Math.max(44, 52 * sc), Math.max(44, 52 * sc)); }
    // the lever: from over its knob to the foot of its box (fix/cockpit-lever: the stem is ≈ 2x longer, the knob stood over the old 120 px)
    { const a = P(A.lever), k = P(A.knob), t = k.y - 30 * sc, b = a.y + 30 * sc, hh = Math.max(60, b - t), ww = Math.max(44, 56 * sc); lay.thr = RR(a.x, (t + b) / 2, ww, hh); }
    { const a = P(A.tack), d = Math.max(48, 60 * sc); lay.tack = RR(a.x, a.y, d, d); }
    const phone = lay.kind === 'phone-land';
    if (phone) {
      // a phone: the small parts' cells spread to a finger's pitch; the left thumb's zone: from the screen's left (past the safe area)
      // to the wheel's rim, from 45 % of the height to the foot (the water above the cockpit's port side too)
      const sp = spreadCells({ ...cells, thr: lay.thr, tack: lay.tack });
      lay.thr = sp.thr; lay.tack = sp.tack; delete sp.thr; delete sp.tack; Object.assign(cells, sp);
      const zx = Math.max(0, (lay.inset?.l ?? 0)), zy = Math.round(innerHeight * 0.45);
      lay.steerZone = { x: zx, y: zy, w: Math.max(44, Math.round(lay.wheel.x + lay.wheel.w * 0.1) - zx), h: innerHeight - zy };
    } else delete lay.steerZone;
    lay.cells = cells; lay.panel = { ...r };
    lay.pro = proRects(P, A);
    // the fold control: up, the mark on the wheel's boss cap (its place at rest: it never rides the cap); folded (the tab's
    // fold or Instruments), at the screen's foot. It steps aside, in place, for the helm view, Clear, a camera shot and a hidden station
    { const cm = calm(), folded = !!cm && (!!cm.fold || cm.mode === 'instruments'), at = foldRest(),
        hide = !shown || !cm || cm.mode === 'clear' || helmView() || (!!cm.clock?.shot && !folded);
      lay.fold = hide ? null : { x: at.x, y: folded ? innerHeight - FOLD_BTN.size - FOLD_BTN.gap : at.y, up: folded };
      foldBtn.place({ show: !hide, folded, x: at.x, yUp: at.y, h: innerHeight }); }
    const key = JSON.stringify([lay.wheel, lay.jib, lay.main, lay.thr, lay.tack, cells, lay.pro, lay.steerZone]);
    if (force || key !== ckKey) { ckKey = key; placeDom(); panelRect?.(lay); pro?.place(lay.pro); }
  }
  // the fold mark's up place: the wheel's hub at rest (the cockpit raised), from the cockpit's own projection, once per layout
  let foldAt = null, foldGeo = '';
  function foldRest() {
    const r = ck.rect, phone = lay.kind === 'phone-land', geo = `${r.x},${r.y},${r.w},${r.h},${phone}`;
    if (foldAt && geo === foldGeo) return foldAt;
    const C0 = ck.content, py = C0.position.y, rx = C0.rotation.x;
    C0.position.y = 0; C0.rotation.x = 0; ck.root.updateMatrixWorld(true);
    V0.setFromMatrixPosition(ck.anchors.hub.matrixWorld).project(ck.camera);
    const x = r.x + (V0.x + 1) / 2 * r.w, y = r.y + (1 - V0.y) / 2 * r.h;
    C0.position.y = py; C0.rotation.x = rx; ck.root.updateMatrixWorld(true);
    foldGeo = geo;
    // the hub stands at the screen's foot (99.6 %, a phone 98.5 %): the target's foot on the hub's centre, or on the screen's edge, so
    // the mark sits on the boss cap's visible top
    return (foldAt = { x: Math.round(x), y: Math.round(Math.min(y, innerHeight) - FOLD_BTN.size) });
  }
  // the PRO recess's hit rects and the two tool buttons' (css px; ≥ 44 each; proRecess.js proLayout): null while the cockpit is
  // down, faded or hidden. The tools' cells keep clear of every other control: the lever, the switches, TACK, the winches' groups,
  // the instruments' faces and a phone's steering zone's middle
  function proRects(P, A) {
    if (!pro || !ck.parts?.pro || !shown || sinkNow > 0.05 || ckOp < 0.5) return null;
    const pts = {}; for (const k of Object.keys(A)) if (k.startsWith('p:') || k === 'binos' || k === 'vhf') pts[k] = P(A[k]);
    const box = (r, m = 0) => r && { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
    const face = (side) => { if (!A[`i:${side}:l`]) return null; const [l, r, t, b] = ['l', 'r', 't', 'b'].map((e) => P(A[`i:${side}:${e}`])); return { x: Math.min(l.x, r.x), y: Math.min(t.y, b.y), w: Math.abs(r.x - l.x), h: Math.abs(b.y - t.y) }; };
    const sz = lay.steerZone, mid = sz && { x: sz.x + sz.w / 2 - 1, y: sz.y + sz.h / 2 - 1, w: 2, h: 2 };
    return proLayout(pts, { H: innerHeight, avoid: [lay.thr, ...Object.values(lay.cells ?? {}), lay.tack, box(lay.jib, 4), box(lay.main, 4), face('chart'), face('wind'), mid].filter(Boolean) });
  }
  // the cockpit's and the instruments' state (before the first relayout: it places the instruments)
  let nightK = 0, sinkNow = 0, lastDraw = -9, dialsAt = -9, growUntil = -9, windUntil = -9, chartSmall = null, faceForce = true;
  const instStats = { ms: 0, frames: 0 };
  const clocks = { wind: new FaceClock(), chart: new FaceClock({ beat: FACES.beatS }) };
  let ariaAt = -9;
  let instKey = '', instGeo = '', cvEl = null, dialW = 220;
  let jibWas = true;
  relayout();
  addEventListener('resize', relayout);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null; ro?.observe(document.documentElement);


  // the player's hand on a sheet now (controls.js: the keys, the pad, the winch): the readout and the chime read it
  const trimDir = { main: 0, jib: 0 }, trimAt = { main: -9, jib: -9 }, lastSt = { main: null, jib: null };
  let chimes = 0;
  const CHIMES = 3;   // the soft chime when a sail starts drawing under the player's hand, the first few times a session
  const DRUM_CLICK = 30 * DEG;   // a pawl's click every 30° of drawn drum, pulling in
  const lastDrum = { main: null, jib: null }, clickAcc = { main: 0, jib: 0 };
  const sails = { main: 'off', jib: 'off' };
  // the let fly's motion: out fast (0.35 s, the sheet runs), back slower (0.6 s, the crew re-leads it); none with reduced motion
  const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const flyTo = (v, to, dt) => (reducedMotion() ? to : v < to ? Math.min(to, v + dt / 0.35) : Math.max(to, v - dt / 0.6));
  function update(dt) {
    t += dt;
    const s = state();
    shown = !!s && !hidden();
    el.classList.toggle('off', !shown);
    el.classList.toggle('cockpit', mounted === 'cockpit');
    const f = fade();
    op = { wheel: f?.wheel ?? 1, jib: f?.jib ?? 1, main: f?.main ?? 1 };
    wheelSlot?.setOpacity(op.wheel); jibSlot?.setOpacity(op.jib); mainSlot?.setOpacity(op.main);
    const hv = helmView();
    wheelPad.classList.toggle('gone', hv); rd.classList.toggle('gone', hv);
    if (steer != null && scrollSteerUntil > 0 && t > scrollSteerUntil && wheelPid == null && steerPid == null) { steer = null; scrollSteerUntil = -9; }
    if (!s) return;
    // the wheel: the real rudder
    const wa = wheelAngle(s.rudderAngle ?? 0);
    wheelSpin.rotation.z = -wa;                    // seen from aft, clockwise = starboard
    wheelPad.setAttribute('aria-valuenow', String(Math.round((s.rudderAngle ?? 0) / DEG)));
    const ra = Math.round((s.rudderAngle ?? 0) / DEG);
    const showRd = wheelPid != null || steerPid != null || t - wheelHeldAt < 1.2;
    rd.classList.toggle('in', showRd && !hv);
    if (showRd) { rdT.textContent = `${Math.abs(ra)}°`; rdE.textContent = ra === 0 ? '' : ra < 0 ? 'P' : 'S'; rdE.className = ra < 0 ? 'p' : 's'; }
    // the winches: the drum is the sheet
    const sheets = { main: s.mainSheet ?? 0, jib: s.jibSheet ?? 0 }, F = free() ?? {};
    for (const side of ['jib', 'main']) {
      if (flyPress[side].tick(t)) { flyPend[side] = true; try { navigator.vibrate?.(15); } catch { /* no haptics */ } }   // a touch's long press
      const W = winch[side], da = drumAngle(sheets[side], side === 'jib' ? JIB_DRUM_PER_SHEET : HELM_IN.drumPerSheet);
      // let fly: the tail whips off the drum and the turns go with it, the handle comes out of its socket (stowed); back in reverse
      const fk = W.fly = flyTo(W.fly, F[side] ? 1 : 0, dt);
      W.tail.rotation.y = -2.4 * fk; W.tail.position.y = 0.05 * fk; W.tail.visible = fk < 0.97; W.turns.visible = fk < 0.5;
      W.hd.position.y = 0.08 * fk; W.hd.visible = fk < 0.6;
      W.spin.rotation.y = -da;                       // clockwise seen from above = in
      W.run.u.value = sheets[side] * 6;              // the tail's fleck runs with the sheet
      if (lastDrum[side] != null) {
        const dd = da - lastDrum[side];
        if (dd > 0) { clickAcc[side] += dd; while (clickAcc[side] >= DRUM_CLICK) { clickAcc[side] -= DRUM_CLICK; if (side === 'jib') cue('click'); } } else clickAcc[side] = 0;
      }
      lastDrum[side] = da;
      const st = sailState({ fill: side === 'main' ? s.mainFill : s.jibFill, stall: side === 'main' ? s.mainStall : s.jibStall, awa: s.apparentWind?.angle, twa: s.trueWind?.angle, furl: furl(), free: !!F[side] });
      // the readout: "MAIN in · 24°" while the hand is on it, 1 s after
      if (trimDir[side]) trimAt[side] = t;
      const roOn = t - trimAt[side] < 1;
      if (roOn) { const d = trimDir[side] || Math.sign(ros[side].dataset.d || 0); if (trimDir[side]) ros[side].dataset.d = String(trimDir[side]); ros[side].innerHTML = `<b>${side.toUpperCase()}</b> ${(+ros[side].dataset.d || d) > 0 ? 'in' : 'out'} · ${Math.round(sheets[side] / DEG)}°`; }
      ros[side].classList.toggle('in', roOn && shown);
      // the marker turns green under the player's hand: a soft chime, the first few times
      if (st === 'draw' && lastSt[side] && lastSt[side] !== 'draw' && lastSt[side] !== 'off' && t - trimAt[side] < 2 && chimes < CHIMES) { chimes++; cue('chime'); }
      lastSt[side] = st;
      const shownSt = forced ?? st;   // forced: a probe's still of one state
      if (leaves[side].dataset.s !== shownSt) leaves[side].dataset.s = shownSt;
      sails[side] = lay?.[side] ? st : 'off';   // the Calm HUD calls the winches back while one shakes
      pads[side].setAttribute('aria-valuenow', String(Math.round(sheets[side] / DEG)));
      pads[side].setAttribute('aria-valuetext', `${Math.round(sheets[side] / DEG)} degrees, ${{ draw: 'drawing', luff: 'luffing', stall: 'stalled', off: 'sails down' }[st]}${F[side] ? ', let fly' : ''}`);
      // the screen points the gestures need
      const r = lay?.[side];
      if (r && shown && mounted !== 'cockpit') {
        face(W.item);
        const c = project(W.cam, W.item, new THREE.Vector3(0, W.spec.y1 - W.spec.y0, 0), r);
        const g = project(W.cam, W.spin, W.hd.userData.grip, r);
        scr[side] = { c, grip: g, r: r.w / 2 };
      }
    }
    if (lay?.wheel && shown && mounted !== 'cockpit') { face(wheelItem); scr.wheel = project(wheelCam, wheelItem, new THREE.Vector3(0, 0, 0), lay.wheel); }
    if (mounted === 'cockpit') cockpitUpdate(dt, s, hv);
  }
  // the cockpit each frame: the Calm HUD's sink and peek, the night, the controls' states; the picture redrawn only on a change
  const q = (v, step) => Math.round(v / step);
  function cockpitUpdate(dt, s, hv) {
    const t0 = performance.now();
    const full = op.wheel, need = Math.max(op.jib, op.main);
    ckOp = Math.max(full, need);
    ckSlot?.setOpacity(Math.min(1, ckOp * 1.5));   // the sink carries most of the leaving; the fade finishes it
    const sink = (1 - full) * (1 - need * (1 - ck.peekSink()));
    const nightTo = H.dataset.lkTheme === 'night' ? 1 : 0;
    nightK = nightTo > nightK ? Math.min(nightTo, nightK + dt / 1.5) : Math.max(nightTo, nightK - dt / 1.5);
    let st = {};
    try { st = ckIn?.() ?? {}; } catch { st = {}; }
    if ((st.moor ?? null) !== moorNow) { moorNow = st.moor ?? null; ckKey = ''; }
    const drewFace = instFaces(dt, s);
    const instMs = performance.now() - t0;
    // the helm view (fix/helm-view-cockpit): the Calm HUD folds the whole cockpit away (calmHud.js), so the pedestal sinks with it
    // rather than vanishing at the switch; without the fold (no Calm HUD) the drawn wheel still steps aside for the real one
    const moved = ck.set({ ...st, helm: hv && !calm()?.folded, night: nightK, exposure: core.sun?.exposure ?? 1, sink, hideWinch: { jib: full < 0.5 && op.jib < 0.5, main: full < 0.5 && op.main < 0.5 },
      inst: { show: dialsMode === 'in', glow: { chart: inst.chart.glow, wind: inst.wind.glow } } }, dt);
    sinkNow = sink;
    const W = winch;
    const sig = [q(wheelSpin.rotation.z, 0.008), q(W.jib.spin.rotation.y, 0.02), q(W.main.spin.rotation.y, 0.02), q(W.jib.fly, 0.02), q(W.main.fly, 0.02), q(s.heading ?? 0, 0.017),
      W.jib.tail.visible, W.main.tail.visible, W.jib.hd.visible, W.main.hd.visible].join();
    if (moved || drewFace || sig !== ckSig || t - lastDraw > 1) { ckDirty = true; ckSig = sig; lastDraw = t; } else ckDirty = false;
    cockpitFrame();   // (hidden too: the fold tab and the PRO layer step out)
    const t1 = performance.now();
    instFrame();
    instStats.ms += instMs + performance.now() - t1; instStats.frames++;
    if (t - dialsAt > 0.5) { dialsAt = t; placeDials(); }
  }

  // ---- the instruments (feat/cockpit-dials) ----
  // the faces: the dials drawn to the instruments' canvases when a reading changes (≈ 4 Hz steady, ≤ 10 Hz while trimming); the
  // backlight brightens and the key numbers grow while it matters: the wind's while the hand is on a sheet or a sail luffs or
  // stalls, the chart's on the sounder's alarm. Returns true when a face was redrawn (the cockpit's slot draws again)
  let chartEls = null;   // the chart dial's readouts, found once
  const chartRead = () => {
    const sm = chartSmall ??= document.querySelector('.lk-chart .small');
    if (!sm) return null;
    chartEls ??= { hdg: sm.querySelector('.hdg'), sog: sm.querySelector('.sog'), dep: sm.querySelector('.dep'), rw: sm.querySelector('.rw.s'), src: sm.querySelector('canvas') };
    const E = chartEls, al = E.rw?.dataset.alarm;
    return { hdg: E.hdg?.textContent ?? '', sog: E.sog?.textContent ?? '', dpt: E.dep?.textContent ?? '', alarm: al ? +al : 0, src: E.src };
  };
  function instFaces(dt, s) {
    if (dialsMode !== 'in' || !faces) return false;
    const trimming = t - Math.max(trimAt.main, trimAt.jib) < 0.25 || pads.jib.classList.contains('held') || pads.main.classList.contains('held');
    const shaking = ['luff', 'stall'].includes(sails.jib) || ['luff', 'stall'].includes(sails.main);
    if (trimming || shaking) windUntil = t + 2;
    const cr = chartRead();
    if (cr?.alarm) growUntil = Math.max(growUntil, t + 2);
    const grow = { wind: t < windUntil, chart: t < growUntil };
    windGrow = grow.wind;
    for (const side of ['wind', 'chart']) { const to = grow[side] ? FACES.glow : 1, I2 = inst[side]; I2.glow = reducedMotion() ? to : I2.glow < to ? Math.min(to, I2.glow + dt * (FACES.glow - 1) / FACES.glowS) : Math.max(to, I2.glow - dt * (FACES.glow - 1) / FACES.glowS); }
    if (!shown || ckOp < 0.004) return false;   // nothing to see: the faces wait (a forced draw on the way back)
    const night = nightK >= 0.5, force = faceForce; faceForce = false;
    let drew = false;
    const wr = windRead(s);
    if (clocks.wind.tick(dt, windKey(s, { night, grow: grow.wind, t }), { busy: trimming, force })) {
      faces.drawWind(document.querySelector('.lk-cv svg'), wr, { night, grow: grow.wind }); ck.faceDrawn('wind'); drew = true;
    }
    if (clocks.chart.tick(dt, chartKey(cr, { night, grow: grow.chart }), { force })) {
      faces.drawChart(cr?.src ?? null, cr, { night, grow: grow.chart }); ck.faceDrawn('chart'); drew = true;
    }
    if (t - ariaAt > 1) {   // the accessibility layer reads the instruments (1 Hz)
      ariaAt = t;
      instBtn.wind.setAttribute('aria-label', `wind instrument: apparent wind ${wr.awa} degrees${wr.side ? (wr.side === 'P' ? ' port' : ' starboard') : ''}, ${wr.aws} knots`);
      if (cr) instBtn.chart.setAttribute('aria-label', `chart instrument: heading ${cr.hdg} degrees, ${cr.sog} knots, depth ${cr.dpt} metres${cr.alarm ? ', shallow' : ''}`);
    }
    return drew;
  }
  // the instruments' places: each face's box from the cockpit's projection (kept from the last unfolded frame while the cockpit is
  // away), its hit button, and its raised view's box: the full DOM dial, its foot on the instrument's head; raised on hover, focus,
  // a tap (pinned), the wind's while a winch is dragged, and both while folded (the Calm HUD shows them only when 'open')
  function instFrame(force = false) {
    if (dialsMode !== 'in' || !ck?.parts?.inst) return;
    const A = ck.anchors, r = ck.rect;
    const folded = !!calm()?.folded, live = shown && sinkNow < 0.05 && ckOp > 0.5;
    // the faces' screen boxes move only with the layout and the sink (the camera turns with the root): projected then, with one
    // matrix update (project() per anchor walks the whole cockpit), and the dial's size read then (offsetWidth forces a layout)
    const geo = `${r.x},${r.y},${r.w},${r.h},${sinkNow.toFixed(4)}`;
    if (force || geo !== instGeo || !inst.chart.at) {
      instGeo = geo;
      // first measured while the cockpit is away (a page opened in the helm view): the faces' boxes where they stand at rest
      const C0 = ck.content, rest = !live && C0 && (C0.position.y !== 0 || C0.rotation.x !== 0), py = C0?.position.y, rx = C0?.rotation.x;
      if (rest) { C0.position.y = 0; C0.rotation.x = 0; }
      ck.root.updateMatrixWorld(true);
      const P = (o) => { v3.setFromMatrixPosition(o.matrixWorld).project(ck.camera); return { x: r.x + (v3.x + 1) / 2 * r.w, y: r.y + (1 - v3.y) / 2 * r.h }; };
      cvEl ??= document.querySelector('.lk-cv'); dialW = cvEl?.offsetWidth || 220;
      for (const side of ['chart', 'wind']) {
        const I2 = inst[side];
        if (!A[`i:${side}`] || !(live || !I2.at)) continue;
        const c = P(A[`i:${side}`]), tp = P(A[`i:${side}:t`]), bt = P(A[`i:${side}:b`]), l = P(A[`i:${side}:l`]), rr = P(A[`i:${side}:r`]);
        I2.at = { cx: c.x, cy: c.y, top: Math.min(tp.y, bt.y), w: Math.abs(rr.x - l.x), h: Math.abs(bt.y - tp.y) };
      }
      if (rest) { C0.position.y = py; C0.rotation.x = rx; ck.root.updateMatrixWorld(true); }
    }
    const cv = cvEl, d = dialW, D = Math.round(0.8 * d);
    const vars = [];
    for (const side of ['chart', 'wind']) {
      const I2 = inst[side];
      const at = I2.at; if (!at) continue;
      // the hit button over the face (≥ 44 px)
      const b = instBtn[side], bw = Math.max(44, at.w), bh = Math.max(44, at.h);
      b.hidden = !live;
      if (live) Object.assign(b.style, { left: `${Math.round(at.cx - bw / 2)}px`, top: `${Math.round(at.cy - bh / 2)}px`, width: `${Math.round(bw)}px`, height: `${Math.round(bh)}px` });
      if (!live) { I2.hov = false; I2.pin = false; }
      // raised: the box centred over the head, its foot 8 px over the bezel; hidden: shrunk onto the face
      const box = side === 'wind' ? d : D, cyR = Math.max(70 + D / 2, at.top - 8 - D / 2), dy = at.cy - cyR, s0 = Math.max(0.05, Math.max(at.w, at.h) / box);
      const k = side === 'wind' ? 'w' : 'c';
      vars.push([`--lk-i${k}-x`, `${Math.round(at.cx - box / 2)}px`], [`--lk-i${k}-y`, `${Math.round(cyR - box / 2)}px`], [`--lk-i${k}-dy`, `${Math.round(dy)}px`], [`--lk-i${k}-s0`, s0.toFixed(3)]);
      if (side === 'chart') vars.push(['--lk-ic-d', `${D}px`]); else vars.push(['--lk-iw-s1', (D / d).toFixed(4)]);
      // over the raised view itself (the pointer moved up into it) keeps it up
      const dial = side === 'wind' ? cv : chartSmall, dr = I2.up && ptr && dial ? dial.getBoundingClientRect() : null;
      const overDial = !!dr && ptr[0] >= dr.left && ptr[0] <= dr.right && ptr[1] >= dr.top && ptr[1] <= dr.bottom;
      const drag = side === 'wind' && (pads.jib.classList.contains('held') || pads.main.classList.contains('held'));
      if (live && (I2.hov || I2.pin || overDial || drag)) I2.until = t + 0.3;
      // the helm view's fold raises a dial only when it is open (Instruments, the sounder's alarm): a puck's dial rising for a
      // moment flashed over the water as the camera left (fix/helm-view-cockpit)
      // (the fold, look/cockpit-fold: the same rule; the chart's full view rose and faded over the water at each fold)
      const up = (folded && calm()?.view?.dials?.[side] === 'open') || t < I2.until;
      if (up !== I2.up) { I2.up = up; H.classList.toggle(`lk-raise-${side}`, up); b.setAttribute('aria-expanded', String(up)); }
    }
    const key = vars.map((v) => v[1]).join();
    if (force || key !== instKey) { instKey = key; for (const [n, v] of vars) H.style.setProperty(n, v); }
  }

  // the boat's box on screen (css px): its hull and rig (sails, mast, wires) in the boat's own frame, projected by the scene's camera
  const boatLocals = new Map();
  const measureBoat = (parts) => {
    const p0 = boat.position.clone(), r0 = boat.rotation.clone();
    boat.position.set(0, 0, 0); boat.rotation.set(0, 0, 0); boat.updateMatrixWorld(true);
    const b = new THREE.Box3(), tmp = new THREE.Box3();
    for (const n of parts) { const m = boat.modules[n]; if (m) { tmp.setFromObject(m, false); if (!tmp.isEmpty() && Number.isFinite(tmp.min.x)) b.union(tmp); } }
    boat.position.copy(p0); boat.rotation.copy(r0); boat.updateMatrixWorld(true);
    return b.isEmpty() ? new THREE.Box3(new THREE.Vector3(-1.5, -0.3, -4.5), new THREE.Vector3(1.5, 13, 4.5)) : b;
  };
  // parts: the boat's modules to box (the hull alone is the probes' "central area": tools/touch_ux_check.mjs)
  function boatBox(cam = core.camera, parts = ['hull', 'rigging', 'main', 'jib']) {
    const key = parts.join();
    if (!boatLocals.has(key)) boatLocals.set(key, measureBoat(parts));
    const boatLocal = boatLocals.get(key);
    boat.updateMatrixWorld(true); cam.updateMatrixWorld(true);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      v3.set(i & 1 ? boatLocal.max.x : boatLocal.min.x, i & 2 ? boatLocal.max.y : boatLocal.min.y, i & 4 ? boatLocal.max.z : boatLocal.min.z).applyMatrix4(boat.matrixWorld).project(cam);
      const x = (v3.x + 1) / 2 * innerWidth, y = (1 - v3.y) / 2 * innerHeight;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  return {
    el, update, relayout, boatBox,
    get steer() { return steer; },
    take(side) { const d = pend[side]; pend[side] = 0; taken[side] += d; return d; },
    takeFly(side) { const f = flyPend[side]; flyPend[side] = false; return f; },
    get free() { const F = free() ?? {}; return { main: !!F.main, jib: !!F.jib }; },   // the sheets let fly (the Calm HUD keeps their winches up)
    get flown() { return { main: winch.main.fly, jib: winch.jib.fly }; },   // the drawn let fly, 0 on the drum … 1 flown (tests, probes)
    get taken() { return { ...taken }; },
    get gesture() { return { main: { mode: gest.main.mode, total: gest.main.total }, jib: { mode: gest.jib.mode, total: gest.jib.total } }; },   // the sheet asked for since load (rad, + = in): the probe's count
    hold(side) { return steps[side].tick(t * 1000); },   // the scene clock: a film or a golden steps it with its frames
    get rects() { return lay; }, get shown() { return shown; }, get helmView() { return !!helmView(); }, get screen() { return scr; }, get sails() { return { ...sails }; }, get opacity() { return { ...op }; },
    get drawn() { return { wheel: -wheelSpin.rotation.z, main: -winch.main.spin.rotation.y, jib: -winch.jib.spin.rotation.y }; },
    get winchTris() { return { main: winch.main.body.children.map((m) => m.geometry.index.count / 3), jib: winch.jib.body.children.map((m) => m.geometry.index.count / 3) }; },
    get seen() { return { ...seen }; },
    forceMarker(st) { forced = st ?? null; },
    trim(side, dir) { trimDir[side] = Math.sign(dir || 0); },   // controls.js, each frame: the player's hand on this sheet (+1 in, −1 out, 0)
    get readout() { return { main: ros.main.classList.contains('in') ? ros.main.textContent : '', jib: ros.jib.classList.contains('in') ? ros.jib.textContent : '' }; },
    get trimming() { return t - Math.max(trimAt.main, trimAt.jib) < 1.5; },   // the probe's marker stills (tools/probe_helm3d.mjs)
    get cockpit() { return mounted === 'cockpit' ? { rect: ck.rect, view: ck.view, root: ck.root, camera: ck.camera, sink: sinkNow, peek: ck.peekSink(), opacity: ckOp, dirty: ckDirty, count: ck.count(), parts: ck.parts } : null; },
    redraw() { ckDirty = true; },
    growChart(s = 4) { growUntil = t + s; },   // the probes' grow (the chart instrument's backlight and big DPT, as on the sounder's alarm)
    // the instruments (probes, tests): their boxes, raised, glow, the faces' draws and the average cost a frame (ms, CPU)
    get instruments() { return mounted === 'cockpit' && dialsMode === 'in' ? { chart: { ...inst.chart, btn: !instBtn.chart.hidden }, wind: { ...inst.wind, btn: !instBtn.wind.hidden }, draws: faces ? { ...faces.stats } : null,
      msPerFrame: instStats.frames ? +(instStats.ms / instStats.frames).toFixed(4) : 0, frames: instStats.frames } : null; },
    resetInstStats() { instStats.ms = 0; instStats.frames = 0; if (faces) { faces.stats.wind = 0; faces.stats.chart = 0; faces.stats.ms = 0; } },
    raise(side, on = true) { if (inst[side]) { inst[side].pin = !!on; if (!on) inst[side].until = -9; } },
    setDials(v) { dialsMode = v === 'top' ? 'top' : 'in'; faceForce = true; if (mounted === 'cockpit') placeDials(); return dialsMode; },
    get dials() { return mounted === 'cockpit' ? dialsMode : null; },
    get cockpitAble() { return cockpitOn; },   // the 3D cockpit can show (a desktop, a phone sideways): the upright phone's turn line asks
    get windGrown() { return windGrow; }, get foldTab() { return foldTab; },
    dispose() { for (const v of ['--lk-dial-r', '--lk-dial-b', '--lk-dial-t', '--lk-chart-l', '--lk-chart-t', '--lk-pd', '--lk-circ-b', '--lk-grp-l', '--lk-grp-r', '--lk-grp-b', '--lk-ck-dy']) H.style.removeProperty(v); H.classList.remove('lk-cockpit', 'lk-dials-in', 'lk-raise-chart', 'lk-raise-wind'); pro?.place(null); removeEventListener('resize', relayout); ro?.disconnect(); wheelSlot?.dispose(); jibSlot?.dispose(); mainSlot?.dispose(); ckSlot?.dispose(); ck?.dispose(); el.remove(); },
  };
}
