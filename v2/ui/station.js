// The helm station on v2 (M4): v1's src/stations/sloop/helmStation.js in its cockpit form, without three.js. The 3D cockpit
// is v1's own geometry (baked from v1's page: tools/v2-cockpit-bake.mjs) drawn by v2/render/cockpit.js; its parts move by
// v2/render/cockpit/rig.js (v1's cockpit3d.js set(), the wheel and the winches as helmStation turns them) and every hit
// target is projected from the rig's anchors through the cockpit's own camera (v1's cockpitView, now pure in
// src/stations/sloop/cockpitView.js). Everything else is v1's three-free code as it is: the gestures (helmInput.js), the let fly
// (letFly.js), the layout (helmLayout.js), the CSS (helmStyle.js), the fold mark (foldButton.js), the PRO recess's layout
// (proRecess.js) and the dial faces (dialFaces.js). The DOM is helmStation's (the same classes, ids and aria), so v1's
// page tests read it the same way.
//   const st = createStation({ rig, state, furl, hidden, helmView, onUse, cue, coarse, once, panelRect, jibOn, fade, free, cockpit, calm, pro, exposure });
//   st.update(dt)  st.steer  st.take(side)  st.takeFly(side)  st.hold(side)  st.trim(side, dir)  st.rects  st.cockpit  st.instruments
// The grid form (BACKLOG-v2 #2, #46): an upright phone draws the wheel and the winches each in its own small 3D slot, v1's
// portrait layout (helmLayout.js portraitLayout) and v1's slot cameras (helmStation.js wheelCam and each winch's cam, SLOT_CAMS
// below), from the same baked items (render/cockpit.js setSlots). What v1's helmStation has that this has not: a tablet's
// grid (a tablet keeps no station: M3's helm strip, v2/ui/touch.js) and the old DOM row (?panel=dom).
import { ensureTokens } from '../../src/ui/tokens.js';
import { HELM_IN, WinchGesture, WheelGesture, StepHold, sailState, drumAngle, wheelAngle, scrollSheet, wheelScroll, JIB_DRUM_PER_SHEET } from '../../src/stations/sloop/helmInput.js';
import { FlyPress } from '../../src/sim/sail/letFly.js';
import { COCKPIT, COCKPIT_PHONE } from '../../src/stations/sloop/cockpitView.js';
import { proLayout } from '../../src/stations/sloop/proRecess.js';
import { createDialFaces, FaceClock, FACES, windKey, windRead, chartKey } from '../../src/stations/sloop/dialFaces.js';
import { helmLayout, cockpitKind } from '../../src/stations/sloop/helmLayout.js';
import { CSS } from '../../src/stations/sloop/helmStyle.js';   // v1's helm CSS (its .leaf rules match nothing here: v2 draws no sail flag, owner 2026-11-16: the telltales on the sails do that job)
import { createFoldTab, foldTabX, FOLD_TAB } from './foldTab.js';   // the fold tabs at the coaming's two ends (owner 2026-11-16 left; 2026-11-18 both corners; was foldButton.js's mark on the hub)
import { CALM, Glide } from '../../src/ui/calmHud.js';
import { reducedNow } from '../sim/steadyCamera.js';   // Reduce Motion: the OS's setting

const DEG = Math.PI / 180;
// helmStation.js's numbers (copied: that module imports three)
export const WHEEL_PAD = { slot: 0.88, cockpit: 1.15 };
export const WINCHES = {
  main: { x: 0.55, z: 1.22, r: 0.09, y0: 1.33, y1: 1.535, drum: [0.047, 0.065, 0.105], handle: 0.12 },
  jib: { x: 1.33, z: 2.65, r: 0.118, y0: 1.18, y1: 1.41, drum: [0.054, 0.085, 0.125], handle: 0.14 },
};
const HINT_KEY = 'lakeshore.helm.v1';
// v1's slot cameras (helmStation.js, copied: that module imports three), in each item's own frame: the wheel nearly face-on, tilted
// back 12° at 2.5 m (22° lens); each winch from aft and above, the handle's whole sweep in the frame (30° lens, the drum's top at
// 0.8 of its height in the frame's centre)
const winchCam = (spec) => {
  const reach = Math.max(spec.handle, spec.r) * 1.3, dist = reach / Math.tan(15 * DEG), top = spec.y1 - spec.y0;
  return { eye: [0.05 * dist, top * 0.8 + dist * Math.sin(64 * DEG), dist * Math.cos(64 * DEG)], target: [0, top * 0.8, 0], fovDeg: 30, near: 0.02, far: 10 };
};
export const SLOT_CAMS = Object.freeze({
  wheel: { eye: [0, Math.sin(12 * DEG) * 2.5, Math.cos(12 * DEG) * 2.5], target: [0, 0, 0], fovDeg: 22, near: 0.1, far: 20 },
  jib: winchCam(WINCHES.jib), main: winchCam(WINCHES.main),
});
// the form for a device kind: the cockpit (a desktop, a phone sideways), the one-thumb controls on an upright phone (
// owner 2026-11-15: v2/ui/thumb.js; the station itself draws nothing then), the grid with ?thumb=0 (v1's portrait slots), else none
export const stationForm = (kind, { cockpit = true, rig = true, thumb = true } = {}) => (!rig || !cockpit ? 'none' : cockpitKind(kind) ? 'cockpit' : kind === 'phone-port' ? (thumb ? 'thumb' : 'grid') : 'none');
const drawnForm = (f) => f === 'cockpit' || f === 'grid';   // the forms the station draws (the thumb's controls are their own)
// BACKLOG-v2 #30: a finger's ▲ ▼ steps stay up. helmStyle.js shows the cockpit's steps only while the pointer is over that winch
// ("a desktop; touch layouts keep theirs"), but its rule caught the touch row too: the 44 px steps sat at opacity 0 with no
// pointer events, so a tap on "pull in" fell through to the canvas (and on the jib's side onto the thumb's steering zone) and the
// sheet only drifted with the hand's start ease (56.3° → 58.5° on the phone check). On a touch layout they are always there.
export const TOUCH_STEPS_CSS = '\n:root[data-input=touch].lk-cockpit .lk-helm .grp[data-w] .stp.row[data-w]{opacity:1;pointer-events:auto}\n';
// The cockpit is shown whole or gone whole (owner, 2026-11-14: "completely show or completely disappear"; a deliberate change from
// v1, whose Calm HUD left it half dropped: a winch peek sank it to the cap with the wheel faded, a phone kept a faint wheel at 0.35).
// Target 1 while the Calm HUD's dashboard is up and the cockpit not folded (Full: always), else 0; one eased 0.4 s glide (the fold's
// pace) drives both the slide and the fade, so nothing rests between. The peeks' DOM pieces (a winch's readout and steps, the
// throttle column) go with it: html.lk-calm-dash is on whenever the dashboard is down or the cockpit folded.
export const cockpitTarget = (view) => (!view ? 1 : view.dash && !view.fold ? 1 : 0);
export const COCKPIT_WHOLE_CSS = '\nhtml.lk-cockpit.lk-calm-dash :is(.lk-helm>:is(.grp,.ro),.lk-thr){opacity:0!important;visibility:hidden!important;pointer-events:none!important;'
  + 'transition:opacity var(--lk-calm-fade) ease,visibility 0s linear var(--lk-calm-fade)!important}\n';

// A finger's drag on the wheel, a winch or the steering zone starts only past SLOP_PX from where it landed: a tap aimed at a
// switch beside them never turns the wheel or trims a sheet (a held still finger on a winch still lets fly: letFly.js)
export const SLOP_PX = 10;
// The raised wind preview takes a click (it opens the logbook, as the dial does): v1's .lk-cv lets only its sail-line and rudder
// handles take the pointer; its face does too while it is raised over the cockpit's wind dial
export const INST_PAGE_CSS = '\n:root.lk-cockpit.lk-dials-in.lk-raise-wind .lk-cv .dial{pointer-events:auto;cursor:pointer}\n';
// The pointer rests this long on a dial before its larger preview rises (owner, 2026-11-17: a click opens the page, a resting hover previews)
export const INST_DWELL = 0.4;
// The hit layer's rects from the rig (helmStation.js cockpitFrame's maths, pure: the node tests hold it to v1's own rects at
// 1280 × 720): the wheel's pad (the rim's projected centre line), each winch's group, the switches' cells, the key, the
// lever's column, TACK and MOOR while it can be used. css px. (A touch phone has no cockpit since: ui/flat.js.)
export function cockpitRects(rig, { w, h, moor = null }) {
  const RR = (cx, cy, w2, h2) => ({ x: Math.round(cx - w2 / 2), y: Math.round(cy - h2 / 2), w: Math.round(w2), h: Math.round(h2) });
  const sc = h / 1080, v = rig.view, P = (n) => rig.project(n);
  const hub = P('hub'), top = P('wheelTop'), wr = Math.max(40, hub.y - top.y);
  const out = { wheel: RR(hub.x, hub.y, 2 * wr, 2 * wr), scr: { wheel: hub }, cells: {} };
  const pxm = v.f / (COCKPIT.camZ + 1.65);
  for (const side of ['jib', 'main']) {
    const spec = WINCHES[side], top3 = spec.y1 - spec.y0, c = rig.projectPart(`winch.${side}.item`, [0, top3, 0]);
    const half = Math.max(22, (spec.handle + 0.03) * 1.25 * COCKPIT.winchScale * pxm);
    out[side] = RR(c.x, c.y + half * 0.15, 2 * half, 2 * half);
    out.scr[side] = { c, grip: rig.projectPart(`winch.${side}.spin`, rig.grip(side)), r: half };
  }
  const cells = out.cells, cw = Math.max(44, 0.3 * pxm), ch = Math.max(44, 72 * sc);
  for (const [id] of COCKPIT.toggles) { const a = P(`t:${id}`); cells[id] = RR(a.x, a.y, cw, ch); }
  if (moor) { const a = P('moor'), d = Math.max(48, 56 * sc); cells.lines = RR(a.x, a.y, d, d); }
  { const a = P('key'); cells.engine = RR(a.x, a.y, Math.max(44, 52 * sc), Math.max(44, 52 * sc)); }
  { const a = P('lever'), k = P('knob'), tt = k.y - 30 * sc, b = a.y + 30 * sc, hh = Math.max(60, b - tt), ww = Math.max(44, 56 * sc); out.thr = RR(a.x, (tt + b) / 2, ww, hh); }
  return out;
}

export function createStation({ rig, state, furl = () => 0, hidden = () => false, helmView = () => false, onUse = () => {}, cue = () => {},
  coarse = false, once = true, storage = globalThis.localStorage ?? null, root = document.body, panelRect = null, jibOn = () => true,
  fade = () => null, free = () => null, cockpit: ckIn = null, calm = () => null, pro = null, exposure = () => 1, flags = {}, thumb: thumbOn = true,
  open = null } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-helm-css')) { const st = document.createElement('style'); st.id = 'lk-helm-css'; st.textContent = CSS + TOUCH_STEPS_CSS + COCKPIT_WHOLE_CSS + INST_PAGE_CSS; document.head.appendChild(st); }
  const H = document.documentElement;
  const winch = { jib: { spec: WINCHES.jib, fly: 0 }, main: { spec: WINCHES.main, fly: 0 } };

  // ---- DOM (helmStation's) ----
  const el = document.createElement('div'); el.className = 'lk-helm'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'helm station');
  el.innerHTML = '<div class="pad wheel" role="slider" tabindex="0" aria-label="Helm" aria-valuemin="-25" aria-valuemax="25" aria-valuenow="0"></div><div class="rd" aria-hidden="true"><span></span><em></em></div>'
    + ['jib', 'main'].map((s) => `<div class="grp" data-w="${s}"><div class="pad winch" data-w="${s}" role="slider" tabindex="0" aria-label="${s === 'main' ? 'Mainsheet winch' : 'Jib sheet winch'}" aria-valuemin="0" aria-valuemax="90"></div>`
      + `<div class="stp" data-w="${s}"><button type="button" data-d="-1" aria-label="ease the ${s}">▲</button><button type="button" data-d="1" aria-label="pull the ${s} in">▼</button></div></div>`
      + `<div class="tape" data-w="${s}">${s.toUpperCase()}</div><div class="ro" data-w="${s}" aria-live="polite"></div>`).join('');
  root.appendChild(el);
  const $ = (q) => el.querySelector(q);
  const wheelPad = $('.pad.wheel'), rd = $('.rd'), rdT = rd.querySelector('span'), rdE = rd.querySelector('em');
  // the cockpit: the rudder readout's place and look carry the pilot's two buttons (owner 2026-11-16; ui/autopilot.js fills it)
  const apHud = document.createElement('div'); apHud.className = 'rd ap'; apHud.setAttribute('role', 'group'); apHud.setAttribute('aria-label', 'autopilot'); el.appendChild(apHud);
  const pads = { jib: $('.pad.winch[data-w=jib]'), main: $('.pad.winch[data-w=main]') };
  const grps = { jib: $('.grp[data-w=jib]'), main: $('.grp[data-w=main]') };
  const stps = { jib: $('.stp[data-w=jib]'), main: $('.stp[data-w=main]') };
  const tapes = { jib: $('.tape[data-w=jib]'), main: $('.tape[data-w=main]') };
  const ros = { jib: $('.ro[data-w=jib]'), main: $('.ro[data-w=main]') };
  const stop = (e) => e.stopPropagation();
  for (const n of el.querySelectorAll('.pad,.stp button')) { n.addEventListener('pointerdown', stop); n.addEventListener('click', stop); }

  const seen = (() => { try { return once ? JSON.parse(storage?.getItem(HINT_KEY) ?? '{}') ?? {} : {}; } catch { return {}; } })();
  const mark = (k2) => { if (seen[k2]) return; seen[k2] = true; try { if (once) storage?.setItem(HINT_KEY, JSON.stringify(seen)); } catch { /* private mode */ } };

  // ---- input state (helmStation's, unchanged) ----
  const pend = { main: 0, jib: 0 }, taken = { main: 0, jib: 0 };
  const flyPress = { main: new FlyPress(), jib: new FlyPress() }, flyPend = { main: false, jib: false };
  const steps = { main: new StepHold(), jib: new StepHold() };
  let steer = null, wheelHeldAt = -9, t = 0;
  const wg = new WheelGesture(), gest = { main: new WinchGesture(), jib: new WinchGesture() };
  const scr = { wheel: null, jib: null, main: null };
  const used = (k2) => { mark(k2); onUse(); };

  // a finger's press is armed, not taken: the drag claims it past SLOP_PX (a mouse or a pen takes it at once, as before)
  const arm = (e) => (e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null);
  const past = (a, e) => Math.hypot(e.clientX - a.x, e.clientY - a.y) >= SLOP_PX;
  let wheelPid = null, wheelArm = null;
  const wheelTake = (p) => {
    const c = scr.wheel; if (!c) return false;
    wg.press(p, { centre: c, wheel: wheelAngle(state()?.rudderAngle ?? 0) });
    steer = wg.command; wheelPad.classList.add('held'); used('wheel'); return true;
  };
  wheelPad.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0) return;
    if (!scr.wheel) return;
    wheelPid = e.pointerId; try { wheelPad.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    wheelArm = arm(e); if (!wheelArm) wheelTake({ x: e.clientX, y: e.clientY });
    e.preventDefault();
  });
  wheelPad.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wheelPid) return;
    e.preventDefault();
    if (wheelArm) { if (!past(wheelArm, e) || !wheelTake(wheelArm)) return; wheelArm = null; }
    steer = wg.move({ x: e.clientX, y: e.clientY }); wheelHeldAt = t;
  });
  const wheelUp = (e) => { if (e.pointerId !== wheelPid) return; wheelPid = null; const was = !wheelArm; wheelArm = null; wg.release(); if (!was) return; steer = null; wheelHeldAt = t; wheelPad.classList.remove('held'); };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) wheelPad.addEventListener(ev, wheelUp);
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
  for (const side of ['jib', 'main']) {
    const pad = pads[side]; let pid = null, armed = null;
    const take = (p) => {
      const c = scr[side]; if (!c) return false;
      gest[side].press(p, { centre: c.c, radius: c.r, grip: c.grip });
      pad.classList.add('held'); used('winch'); return true;
    };
    pad.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button > 0) return;
      if (!scr[side]) return;
      pid = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      flyPress[side].press(t, e.clientX, e.clientY, e.pointerType === 'touch');   // a held still finger lets fly (no slop: it never moves)
      armed = arm(e); if (!armed) take({ x: e.clientX, y: e.clientY });
      e.preventDefault();
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault(); flyPress[side].move(e.clientX, e.clientY);
      if (armed) { if (!past(armed, e) || !take(armed)) return; armed = null; }
      pend[side] += gest[side].move({ x: e.clientX, y: e.clientY });
    });
    const up = (e) => {
      if (e.pointerId !== pid) return; pid = null; armed = null; gest[side].release(); pad.classList.remove('held');
      if (e.type === 'pointerup' && flyPress[side].release(t, !!free()?.[side])) flyPend[side] = true; else flyPress[side].down = null;
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, up);
    for (const n of [grps[side], pad, stps[side]]) n.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); pend[side] += scrollSheet(e); used('winch'); }, { passive: false });
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
        b.classList.add('on'); used('winch'); e.preventDefault(); e.stopPropagation();   // #52: as v1's 38ce01ed (e127e00a's comment had swallowed these)
      });
      const off = () => { steps[side].up(); b.classList.remove('on'); };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
    }
    pad.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') { flyPend[side] = true; used('winch'); e.preventDefault(); e.stopPropagation(); return; }
      if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp') return;
      pend[side] += (e.code === 'ArrowDown' ? 1 : -1) * HELM_IN.step; used('winch'); e.preventDefault(); e.stopPropagation();
    });
  }

  // ---- the layout ----
  let lay = null, shown = false, op = { wheel: 1, jib: 1, main: 1 };
  let mounted = null, ckOp = 1;
  const ckGlide = new Glide(1);   // the cockpit's one 0..1: shown whole (1) or gone whole (0), eased between (cockpitTarget)
  const cockpitOn = !!rig && flags.panel !== 'dom';
  const css = (n, r) => { n.style.left = `${r.x}px`; n.style.top = `${r.y}px`; n.style.width = `${r.w}px`; n.style.height = `${r.h}px`; };
  let measured = null;   // the CSS sizes the layout reads (on resize only: no layout read in a frame)
  function measure() {
    const cs = getComputedStyle(H);
    const px = (v, d0) => { const p = document.createElement('div'); p.style.cssText = `position:absolute;visibility:hidden;width:${v}`; document.body.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return w || d0; };
    measured = { d: px(cs.getPropertyValue('--lk-d').trim() || '220px', 220), by: px(cs.getPropertyValue('--lk-by').trim() || '14px', 14), mx: px(cs.getPropertyValue('--lk-mx').trim() || '40px', 40),
      rowH: px(cs.getPropertyValue('--lk-row-h').trim() || '46px', 46), inset: { l: px('var(--lk-sal,0px)', 0), r: px('var(--lk-sar,0px)', 0), b: px('var(--lk-sab,0px)', 0) }, top: px('var(--lk-cap-top,66px)', 66) };
    cvEl = document.querySelector('.lk-cv'); dialW = cvEl?.offsetWidth || 220;
  }
  function relayout() {
    measure();
    const m = measured;
    lay = helmLayout({ w: innerWidth, h: innerHeight, d: m.d, by: m.by, mx: m.mx, coarse, inset: m.inset, jib: !!jibOn(), rowH: m.rowH, top: m.top, trimAt: 'top' });
    el.style.setProperty('--lk-hu', `${lay.u.toFixed(3)}px`);
    const form = stationForm(lay.kind, { cockpit: cockpitOn, rig: !!rig, thumb: thumbOn });
    if (form !== mounted) { mounted = form; H.classList.toggle('lk-cockpit', form === 'cockpit'); H.classList.toggle('lk-slots', form === 'grid'); }
    el.hidden = !drawnForm(form);
    if (form !== 'grid') rig?.setSlots?.(null);
    if (form !== 'cockpit') { H.classList.remove('lk-dials-in', 'lk-raise-chart', 'lk-raise-wind'); for (const b of Object.values(instBtn)) b.hidden = true; for (const fb of foldBtns) fb.place({ show: false }); pro?.place(null); rig?.show?.(false); }
    if (form === 'grid') { gridLayout(); return; }
    if (form !== 'cockpit') return;
    rig.show?.(true);
    cockpitLayout();
  }
  function placeDom() {
    const grid = mounted === 'grid', pk = grid ? WHEEL_PAD.slot : WHEEL_PAD.cockpit, wr = lay.wheel;
    css(wheelPad, { x: wr.x + wr.w * (1 - pk) / 2, y: wr.y + wr.h * (1 - pk) / 2, w: wr.w * pk, h: wr.h * pk });
    for (const side of ['jib', 'main']) {
      const r = lay[side];
      for (const n of [grps[side], tapes[side], ros[side]]) n.hidden = !r;
      if (!r) continue;
      css(pads[side], { x: 0, y: 0, w: r.w + 8, h: r.h + 8 });
      css(grps[side], { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
      const finger = H.dataset.input === 'touch';
      stps[side].classList.toggle('row', finger);
      if (finger) {
        const bw = 44, gap = 8, rowW = 2 * bw + gap, x = side === 'jib' ? r.x - 6 - rowW : r.x + r.w + 6;
        stps[side].style.left = `${x - (r.x - 4)}px`; stps[side].style.top = `${r.y + r.h / 2 - bw - (r.y - 4)}px`;
      } else {
        const sw = Math.max(28, 28 * lay.u), out = side === 'jib' ? r.x + 2 * lay.u : r.x + r.w - sw - 2 * lay.u;
        stps[side].style.left = `${out - (r.x - 4)}px`; stps[side].style.top = `${r.y + r.h / 2 - sw - 11 * lay.u - (r.y - 4)}px`;
      }
      stps[side].hidden = !lay.steps;
      tapes[side].style.left = `${r.x + r.w / 2}px`; tapes[side].style.top = `${r.y + r.h + 1}px`;
      ros[side].style.left = `${r.x + r.w / 2}px`; ros[side].style.top = `${r.y + 2 * lay.u}px`;
    }
    rd.style.left = `${wr.x + wr.w / 2}px`; rd.style.top = `${grid ? wr.y + wr.h * 0.66 : wr.y + wr.h * 0.3}px`;
    const hubAt = (!grid && scr.wheel) || { x: wr.x + wr.w / 2, y: wr.y + wr.h / 2 };
    apHud.style.left = `${Math.round(hubAt.x)}px`; apHud.style.top = `${Math.round(hubAt.y)}px`; apHud.dataset.rim = String(wr.w / 2);   // the pilot pad: its key on the hub's centre (whole px: crisp edges), sized to the rim (ui/autopilot.js)
  }

  const RR = (cx, cy, w2, h2) => ({ x: Math.round(cx - w2 / 2), y: Math.round(cy - h2 / 2), w: Math.round(w2), h: Math.round(h2) });
  let ckKey = '', moorNow = null, windGrow = false;
  const dialsMode = flags.dials === 'top' ? 'top' : 'in';
  // The dials open their pages (owner, 2026-11-17): a click (a tap) on the chart dial opens the chart page (the enlarged chart, left),
  // on the wind dial the logbook (its mirror on the right); only a pointer that rests on a dial INST_DWELL s raises its larger
  // preview, and a click on a raised preview opens the same page. open: { chart(), log() } (sail.js); without it a click pins the
  // preview as before. The keyboard's focus (focus-visible) raises the preview at once; Enter is the click.
  const instBtn = {}, inst = { chart: { hov: false, hovAt: -9, pin: false, until: -9, up: false, at: null, glow: 1 }, wind: { hov: false, hovAt: -9, pin: false, until: -9, up: false, at: null, glow: 1 } };
  const PAGE = { chart: 'chart', wind: 'log' };
  const openPage = (side) => { const fn = open?.[PAGE[side]]; if (!fn) return false; const I2 = inst[side]; I2.hov = false; I2.pin = false; I2.until = -9; I2.hovAt = -9; fn(); return true; };
  for (const [side, name] of [['chart', 'chart instrument: open the chart'], ['wind', 'wind instrument: open the logbook']]) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'lk-inst'; b.dataset.k = side; b.hidden = true; b.setAttribute('aria-label', name); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') { inst[side].hov = true; inst[side].hovAt = t; } });
    b.addEventListener('pointerleave', () => { inst[side].hov = false; });
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) { inst[side].hov = true; inst[side].hovAt = t - INST_DWELL; } }); b.addEventListener('blur', () => { inst[side].hov = false; });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!openPage(side)) { inst[side].pin = !inst[side].pin; if (!inst[side].pin) { inst[side].hov = false; inst[side].until = -9; } }
      dispatchEvent(new Event('lk-click'));
    });
    el.appendChild(b); instBtn[side] = b;
  }
  // a click on the raised wind preview (v1's .lk-cv) opens the logbook too, unless it grabbed a sail line or the rudder there (the
  // dial's own drag: captainView.js .hit); the raised chart preview's click is chartplotter.js's own (it pins the enlarged chart)
  let cvDrag = false;
  const cvDown = (e) => { cvDrag = !!e.target?.closest?.('.lk-cv .hit'); };
  const cvClick = (e) => { if (e.target?.closest?.('.lk-cv') && !cvDrag && inst.wind.up && mounted === 'cockpit' && dialsMode === 'in') openPage('wind'); };
  addEventListener('pointerdown', cvDown, { capture: true, passive: true }); addEventListener('click', cvClick);
  // one tab in each corner, mirrored (owner 2026-11-18): the same press, the same state
  const foldBtns = ['l', 'r'].map((side) => createFoldTab({ parent: el, side, onPress: () => calm()?.tab?.() })), foldTab = foldBtns[0].el, foldTabs = foldBtns.map((b) => b.el);
  let ptr = null;
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') ptr = [e.clientX, e.clientY]; }, { passive: true });
  const phoneNow = () => lay?.kind === 'phone-land';
  function cockpitLayout() {
    const { view, rect } = rig.layout({ w: innerWidth, h: innerHeight, phone: phoneNow() });
    rig.setMaxPx?.(phoneNow() ? COCKPIT_PHONE.maxPx : 4096);
    ckKey = '';
    const u = lay.u, trw = 200 * u, th2 = 96 * u;
    Object.assign(lay, { form: 'cockpit', steps: true, cockpit: { rect, wheelTop: Math.round(view.wheelTop), subBottom: Math.round(view.subBottom), capY: Math.round(view.capY) },
      trim: { x: Math.round(innerWidth - trw - 40), y: Math.round(rect.y - th2 - 6), w: Math.round(trw), h: Math.round(th2) } });
    delete lay.group;
    foldAt = null; instGeo = '';
    H.classList.toggle('lk-dials-in', dialsMode === 'in');
    cockpitFrame(true);
    instFrame(true);
  }
  // the grid form (an upright phone): v1's portrait rects as they are (helmLayout), the slots' cameras from them; the hit layer
  // and the panel's places once per layout (the rects never move with the boat)
  function gridLayout() {
    rig.layout({ w: innerWidth, h: innerHeight, phone: false });   // the renderer's frame uniforms want a view; the cockpit itself stays hidden
    ckKey = '';
    placeDom(); panelRect?.(lay);
    gridFrame(true);
  }
  let slotKey = '';
  function gridFrame(force = false) {
    const key = JSON.stringify([lay.wheel, lay.jib, lay.main]);
    if (force || key !== slotKey) {
      slotKey = key;
      for (const k of ['wheel', 'jib', 'main']) if (lay[k]) rig.slotCam(k, SLOT_CAMS[k], lay[k]);
    }
    // the screen points the gestures need (helmStation update(): the item's origin, the drum's top, the grip; r half the rect)
    scr.wheel = rig.projectSlot('wheel', 'wheel.item', [0, 0, 0]);
    for (const side of ['jib', 'main']) {
      if (!lay[side]) { scr[side] = null; continue; }
      const top3 = WINCHES[side].y1 - WINCHES[side].y0;
      scr[side] = { c: rig.projectSlot(side, `winch.${side}.item`, [0, top3, 0]), grip: rig.projectSlot(side, `winch.${side}.spin`, rig.grip(side)), r: lay[side].w / 2 };
    }
  }
  function gridUpdate(hv) {
    gridFrame();
    const on = (k) => shown && op[k] > 0.004 && !!lay?.[k];
    const list = [];
    if (on('wheel') && !hv) list.push(rig.slotCam('wheel', SLOT_CAMS.wheel, lay.wheel));
    for (const side of ['jib', 'main']) if (on(side)) list.push(rig.slotCam(side, SLOT_CAMS[side], lay[side]));
    rig.setSlots?.(list);
  }
  // the hit layer from the rig's anchors, each frame (pure maths: the rig's matrices; styles written only on a change)
  function cockpitFrame(force = false) {
    const P = (n) => rig.project(n);
    const R = cockpitRects(rig, { w: innerWidth, h: innerHeight, moor: moorNow });
    lay.wheel = R.wheel; lay.jib = R.jib; lay.main = R.main; lay.thr = R.thr; lay.tack = R.tack;
    scr.wheel = R.scr.wheel; scr.jib = R.scr.jib; scr.main = R.scr.main;
    const cells = R.cells;
    lay.cells = cells; lay.panel = { ...rig.rect };
    lay.pro = proRects(P);
    { const cm = calm(), folded = !!cm && (!!cm.fold || cm.mode === 'instruments'), at = foldRest(),
        hide = !shown || !cm || cm.mode === 'clear' || helmView() || (!!cm.clock?.shot && !folded);
      lay.fold = hide ? null : { x: at.l, y: innerHeight - FOLD_TAB.h, up: folded };   // one spot per corner, up or folded
      lay.folds = hide ? null : [at.l, at.r].map((x) => ({ x, y: innerHeight - FOLD_TAB.h, up: folded }));
      foldBtns[0].place({ show: !hide, folded, x: at.l, h: innerHeight }); foldBtns[1].place({ show: !hide, folded, x: at.r, h: innerHeight }); }
    const key = JSON.stringify([lay.wheel, lay.jib, lay.main, lay.thr, lay.tack, cells, lay.pro]);
    if (force || key !== ckKey) { ckKey = key; placeDom(); panelRect?.(lay); pro?.place(lay.pro); }
  }
  let foldAt = null;
  function foldRest() {
    if (foldAt) return foldAt;
    // the coaming's two ends, at rest: left of the chart instrument, right of the wind instrument (mirrors)
    const chartLeft = rig.has?.('i:chart:l') ? rig.projectRest('i:chart:l').x : null, windRight = rig.has?.('i:wind:r') ? rig.projectRest('i:wind:r').x : null;
    return (foldAt = { l: foldTabX({ chartLeft, w: innerWidth }), r: foldTabX({ windRight, w: innerWidth, side: 'r' }) });
  }
  function proRects(P) {
    if (!pro || !rig.parts.pro || !shown || sinkNow > 0.05 || ckOp < 0.5) return null;
    const pts = {}; for (const k of rig.anchorNames) if (k.startsWith('p:') || k === 'binos' || k === 'vhf') pts[k] = P(k);
    const box = (r, m = 0) => r && { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
    const face = (side) => { if (!rig.has(`i:${side}:l`)) return null; const [l, r, tp, b] = ['l', 'r', 't', 'b'].map((e) => P(`i:${side}:${e}`)); return { x: Math.min(l.x, r.x), y: Math.min(tp.y, b.y), w: Math.abs(r.x - l.x), h: Math.abs(b.y - tp.y) }; };
    return proLayout(pts, { H: innerHeight, avoid: [lay.thr, ...Object.values(lay.cells ?? {}), lay.tack, box(lay.jib, 4), box(lay.main, 4), face('chart'), face('wind')].filter(Boolean) });
  }

  let nightK = 0, sinkNow = 0, dialsAt = -9, growUntil = -9, windUntil = -9, chartSmall = null, faceForce = true;
  const instStats = { ms: 0, frames: 0 };
  const clocks = { wind: new FaceClock(), chart: new FaceClock({ beat: FACES.beatS }) };
  let ariaAt = -9, instKey = '', instGeo = '', cvEl = null, dialW = 220;
  const dialBox = { chart: null, wind: null };
  const faces = rig ? createDialFaces() : null;
  rig?.setFaces?.(faces?.canvas);
  relayout();
  addEventListener('resize', relayout);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null; ro?.observe(document.documentElement);

  const trimDir = { main: 0, jib: 0 }, trimAt = { main: -9, jib: -9 }, lastSt = { main: null, jib: null };
  let chimes = 0;
  const CHIMES = 3, DRUM_CLICK = 30 * DEG;
  const lastDrum = { main: null, jib: null }, clickAcc = { main: 0, jib: 0 };
  const sails = { main: 'off', jib: 'off' };
  const reducedMotion = reducedNow;
  const flyTo = (v, to, dt) => (reducedMotion() ? to : v < to ? Math.min(to, v + dt / 0.35) : Math.max(to, v - dt / 0.6));
  function update(dt) {
    t += dt;
    const s = state();
    shown = !!s && !hidden() && drawnForm(mounted);
    // the cockpit's draw follows the station (v1's hud slot: no rect while hidden, so nothing renders): under the Menu card, the
    // logbook, the keys list (sail.js dashHidden), the 3D cockpit is not drawn
    if (mounted === 'cockpit') rig.show?.(shown);
    el.classList.toggle('off', !shown);
    el.classList.toggle('cockpit', mounted === 'cockpit');
    if (mounted === 'grid' && !shown) rig.setSlots?.(null);
    const f = fade();
    op = { wheel: f?.wheel ?? 1, jib: f?.jib ?? 1, main: f?.main ?? 1 };
    const hv = helmView();
    wheelPad.classList.toggle('gone', hv); rd.classList.toggle('gone', hv);
    if (steer != null && scrollSteerUntil > 0 && t > scrollSteerUntil && wheelPid == null) { steer = null; scrollSteerUntil = -9; }
    if (!s || !drawnForm(mounted)) return;
    const wa = wheelAngle(s.rudderAngle ?? 0);
    rig.wheel(wa);
    wheelPad.setAttribute('aria-valuenow', String(Math.round((s.rudderAngle ?? 0) / DEG)));
    const ra = Math.round((s.rudderAngle ?? 0) / DEG);
    const showRd = wheelPid != null || t - wheelHeldAt < 1.2;
    rd.classList.toggle('in', showRd && !hv && mounted !== 'cockpit');   // the cockpit: AUTO and TACK in its place (apHud), shown while the cockpit is up
    apHud.classList.toggle('in', mounted === 'cockpit' && shown && !hv && sinkNow < 0.05 && ckOp > 0.5);
    if (showRd) { rdT.textContent = `${Math.abs(ra)}°`; rdE.textContent = ra === 0 ? '' : ra < 0 ? 'P' : 'S'; rdE.className = ra < 0 ? 'p' : 's'; }
    const sheets = { main: s.mainSheet ?? 0, jib: s.jibSheet ?? 0 }, F = free() ?? {};
    for (const side of ['jib', 'main']) {
      if (flyPress[side].tick(t)) { flyPend[side] = true; try { navigator.vibrate?.(15); } catch { /* no haptics */ } }
      const W = winch[side], da = drumAngle(sheets[side], side === 'jib' ? JIB_DRUM_PER_SHEET : HELM_IN.drumPerSheet);
      const fk = W.fly = flyTo(W.fly, F[side] ? 1 : 0, dt);
      rig.winch(side, { drum: da, fly: fk, run: sheets[side] * 6 });
      if (lastDrum[side] != null) {
        const dd = da - lastDrum[side];
        if (dd > 0) { clickAcc[side] += dd; while (clickAcc[side] >= DRUM_CLICK) { clickAcc[side] -= DRUM_CLICK; if (side === 'jib') cue('click'); } } else clickAcc[side] = 0;
      }
      lastDrum[side] = da;
      const st = sailState({ fill: side === 'main' ? s.mainFill : s.jibFill, stall: side === 'main' ? s.mainStall : s.jibStall, awa: s.apparentWind?.angle, twa: s.trueWind?.angle, furl: furl(), free: !!F[side] });
      if (trimDir[side]) trimAt[side] = t;
      const roOn = t - trimAt[side] < 1;
      if (roOn) { const d = trimDir[side] || Math.sign(ros[side].dataset.d || 0); if (trimDir[side]) ros[side].dataset.d = String(trimDir[side]); ros[side].innerHTML = `<b>${side.toUpperCase()}</b> ${(+ros[side].dataset.d || d) > 0 ? 'in' : 'out'} · ${Math.round(sheets[side] / DEG)}°`; }
      ros[side].classList.toggle('in', roOn && shown);
      if (st === 'draw' && lastSt[side] && lastSt[side] !== 'draw' && lastSt[side] !== 'off' && t - trimAt[side] < 2 && chimes < CHIMES) { chimes++; cue('chime'); }
      lastSt[side] = st;
      sails[side] = lay?.[side] ? st : 'off';
      pads[side].setAttribute('aria-valuenow', String(Math.round(sheets[side] / DEG)));
      pads[side].setAttribute('aria-valuetext', `${Math.round(sheets[side] / DEG)} degrees, ${{ draw: 'drawing', luff: 'luffing', stall: 'stalled', off: 'sails down' }[st]}${F[side] ? ', let fly' : ''}`);
    }
    if (mounted === 'cockpit') cockpitUpdate(dt, s, hv); else gridUpdate(hv);
  }
  function cockpitUpdate(dt, s, hv) {
    const t0 = performance.now();
    // whole or gone (cockpitTarget): no winch peek, no faint wheel; the slide and the fade from the one glide
    const k = ckGlide.step(cockpitTarget(calm()?.view), dt, CALM.foldMs / 1000, reducedMotion());
    ckOp = k;
    rig.setOpacity?.(Math.min(1, k * 1.5));
    const sink = 1 - k;
    const nightTo = H.dataset.lkTheme === 'night' ? 1 : 0;
    nightK = nightTo > nightK ? Math.min(nightTo, nightK + dt / 1.5) : Math.max(nightTo, nightK - dt / 1.5);
    let st = {};
    try { st = ckIn?.() ?? {}; } catch { st = {}; }
    if ((st.moor ?? null) !== moorNow) { moorNow = st.moor ?? null; ckKey = ''; }
    instFaces(dt, s);
    const instMs = performance.now() - t0;
    rig.heading(s.heading ?? 0);
    rig.set({ ...st, helm: hv && !calm()?.folded, night: nightK, exposure: exposure(), sink, hideWinch: { jib: k < 0.5, main: k < 0.5 },
      inst: { show: dialsMode === 'in', glow: { chart: inst.chart.glow, wind: inst.wind.glow } }, visible: shown && ckOp > 0.004 }, dt);
    sinkNow = sink;
    cockpitFrame();
    const t1 = performance.now();
    instFrame();
    instStats.ms += instMs + performance.now() - t1; instStats.frames++;
    if (t - dialsAt > 0.5) { dialsAt = t; instFrame(true); }
  }

  // ---- the instruments (helmStation's) ----
  let chartEls = null;
  const chartRead = () => {
    const sm = chartSmall ??= document.querySelector('.lk-chart .small');
    if (!sm) return null;
    chartEls ??= { hdg: sm.querySelector('.hdg'), sog: sm.querySelector('.sog'), dep: sm.querySelector('.dep'), rw: sm.querySelector('.rw.s'), src: sm.querySelector('canvas') };
    const E = chartEls, al = E.rw?.dataset.alarm;
    return { hdg: E.hdg?.textContent ?? '', sog: E.sog?.textContent ?? '', dpt: E.dep?.textContent ?? '', alarm: al ? +al : 0, src: E.src };
  };
  let svgEl = null;
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
    if (!shown || ckOp < 0.004) return false;
    const night = nightK >= 0.5, force = faceForce; faceForce = false;
    let drew = false;
    const wr = windRead(s);
    if (clocks.wind.tick(dt, windKey(s, { night, grow: grow.wind, t }), { busy: trimming, force })) {
      svgEl ??= document.querySelector('.lk-cv svg');
      faces.drawWind(svgEl, wr, { night, grow: grow.wind }); rig.faceDrawn('wind'); drew = true;
    }
    if (clocks.chart.tick(dt, chartKey(cr, { night, grow: grow.chart }), { force })) {
      faces.drawChart(cr?.src ?? null, cr, { night, grow: grow.chart }); rig.faceDrawn('chart'); drew = true;
    }
    if (t - ariaAt > 1) {
      ariaAt = t;
      instBtn.wind.setAttribute('aria-label', `wind instrument: apparent wind ${wr.awa} degrees${wr.side ? (wr.side === 'P' ? ' port' : ' starboard') : ''}, ${wr.aws} knots${open ? '; opens the logbook' : ''}`);
      if (cr) instBtn.chart.setAttribute('aria-label', `chart instrument: heading ${cr.hdg} degrees, ${cr.sog} knots, depth ${cr.dpt} metres${cr.alarm ? ', shallow' : ''}${open ? '; opens the chart' : ''}`);
    }
    return drew;
  }
  // the raised views' boxes (helmStation's instFrame). v1 read the dial's width (offsetWidth) here whenever the sink moved; v2
  // reads it on resize only (measure()), and the pointer-over-dial test uses the box this function placed (no layout read)
  function instFrame(force = false) {
    if (dialsMode !== 'in' || !rig.parts.inst) return;
    const folded = !!calm()?.folded, live = shown && sinkNow < 0.05 && ckOp > 0.5;
    const r = rig.rect, geo = `${r.x},${r.y},${r.w},${r.h},${sinkNow.toFixed(4)}`;
    if (force || geo !== instGeo || !inst.chart.at) {
      instGeo = geo;
      const rest = !live;
      const P = (n) => (rest ? rig.projectRest(n) : rig.project(n));
      for (const side of ['chart', 'wind']) {
        const I2 = inst[side];
        if (!rig.has(`i:${side}`) || !(live || !I2.at)) continue;
        const c = P(`i:${side}`), tp = P(`i:${side}:t`), bt = P(`i:${side}:b`), l = P(`i:${side}:l`), rr = P(`i:${side}:r`);
        I2.at = { cx: c.x, cy: c.y, top: Math.min(tp.y, bt.y), w: Math.abs(rr.x - l.x), h: Math.abs(bt.y - tp.y) };
      }
    }
    const d = dialW, D = Math.round(0.8 * d);
    const vars = [];
    for (const side of ['chart', 'wind']) {
      const I2 = inst[side];
      const at = I2.at; if (!at) continue;
      const b = instBtn[side], bw = Math.max(44, at.w), bh = Math.max(44, at.h);
      b.hidden = !live;
      if (live) Object.assign(b.style, { left: `${Math.round(at.cx - bw / 2)}px`, top: `${Math.round(at.cy - bh / 2)}px`, width: `${Math.round(bw)}px`, height: `${Math.round(bh)}px` });
      if (!live) { I2.hov = false; I2.pin = false; }
      const box = side === 'wind' ? d : D, cyR = Math.max(70 + D / 2, at.top - 8 - D / 2), dy = at.cy - cyR, s0 = Math.max(0.05, Math.max(at.w, at.h) / box);
      const k = side === 'wind' ? 'w' : 'c';
      vars.push([`--lk-i${k}-x`, `${Math.round(at.cx - box / 2)}px`], [`--lk-i${k}-y`, `${Math.round(cyR - box / 2)}px`], [`--lk-i${k}-dy`, `${Math.round(dy)}px`], [`--lk-i${k}-s0`, s0.toFixed(3)]);
      if (side === 'chart') vars.push(['--lk-ic-d', `${D}px`]); else vars.push(['--lk-iw-s1', (D / d).toFixed(4)]);
      dialBox[side] = { left: at.cx - box / 2, top: cyR - box / 2, right: at.cx + box / 2, bottom: cyR + box / 2 };
      const dr = I2.up && ptr ? dialBox[side] : null;
      const overDial = !!dr && ptr[0] >= dr.left && ptr[0] <= dr.right && ptr[1] >= dr.top && ptr[1] <= dr.bottom;
      const drag = side === 'wind' && (pads.jib.classList.contains('held') || pads.main.classList.contains('held'));
      if (live && ((I2.hov && t - I2.hovAt >= INST_DWELL) || I2.pin || overDial || drag)) I2.until = t + 0.3;   // the pointer's rest (INST_DWELL) raises it; once up, being over it keeps it
      const up = (folded && calm()?.view?.dials?.[side] === 'open') || t < I2.until;
      if (up !== I2.up) { I2.up = up; H.classList.toggle(`lk-raise-${side}`, up); b.setAttribute('aria-expanded', String(up)); }
    }
    const key = vars.map((v) => v[1]).join();
    if (force || key !== instKey) { instKey = key; for (const [n, v] of vars) H.style.setProperty(n, v); }
  }

  return {
    el, update, relayout,
    get steer() { return steer; },
    take(side) { const d = pend[side]; pend[side] = 0; taken[side] += d; return d; },
    takeFly(side) { const f = flyPend[side]; flyPend[side] = false; return f; },
    get free() { const F = free() ?? {}; return { main: !!F.main, jib: !!F.jib }; },
    get flown() { return { main: winch.main.fly, jib: winch.jib.fly }; },
    get taken() { return { ...taken }; },
    get gesture() { return { main: { mode: gest.main.mode, total: gest.main.total }, jib: { mode: gest.jib.mode, total: gest.jib.total } }; },
    hold(side) { return steps[side].tick(t * 1000); },
    get rects() { return lay; }, get shown() { return shown; }, get helmView() { return !!helmView(); }, get screen() { return scr; }, get sails() { return { ...sails }; }, get opacity() { return { ...op }; },
    get drawn() { return rig.drawn; },
    get seen() { return { ...seen }; },
    trim(side, dir) { trimDir[side] = Math.sign(dir || 0); },
    get readout() { return { main: ros.main.classList.contains('in') ? ros.main.textContent : '', jib: ros.jib.classList.contains('in') ? ros.jib.textContent : '' }; },
    get trimming() { return t - Math.max(trimAt.main, trimAt.jib) < 1.5; },
    get cockpit() { return mounted === 'cockpit' ? { rect: rig.rect, view: rig.view, sink: sinkNow, peek: rig.peekSink(), opacity: ckOp, dirty: rig.dirty, count: rig.count, parts: rig.parts } : null; },
    redraw() { rig.redraw?.(); },
    growChart(s = 4) { growUntil = t + s; },
    get instruments() { return mounted === 'cockpit' && dialsMode === 'in' ? { chart: { ...inst.chart, btn: !instBtn.chart.hidden }, wind: { ...inst.wind, btn: !instBtn.wind.hidden }, draws: faces ? { ...faces.stats } : null,
      msPerFrame: instStats.frames ? +(instStats.ms / instStats.frames).toFixed(4) : 0, frames: instStats.frames } : null; },
    raise(side, on = true) { if (inst[side]) { inst[side].pin = !!on; if (!on) inst[side].until = -9; } },
    get dials() { return mounted === 'cockpit' ? dialsMode : null; },
    get cockpitAble() { return cockpitOn; },
    get form() { return mounted; },   // 'cockpit' | 'grid' | 'thumb' | 'none'
    get slots() { return mounted === 'grid' ? { wheel: lay?.wheel ?? null, jib: lay?.jib ?? null, main: lay?.main ?? null } : null; },
    get windGrown() { return windGrow; }, get foldTab() { return foldTab; }, get foldTabs() { return foldTabs; }, get apHud() { return apHud; },
    dispose() { rig?.setSlots?.(null); H.classList.remove('lk-slots', 'lk-cockpit', 'lk-dials-in', 'lk-raise-chart', 'lk-raise-wind'); pro?.place(null); removeEventListener('resize', relayout); removeEventListener('pointerdown', cvDown, { capture: true }); removeEventListener('click', cvClick); ro?.disconnect(); el.remove(); },
  };
}
