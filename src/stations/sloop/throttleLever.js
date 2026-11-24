// The throttle lever (owner, 2026-10-30; redrawn 2026-10-31): a sailboat's single-lever engine
// control, its own column beside the control panel at the helm group's full height (the iPhone: beside the wheel, under the
// left thumb). A brushed-stainless escutcheon with a dark slot and a chunky black ball knob (inline SVG and CSS, as the
// mock-up drew it); only AHEAD, a bold N and ASTERN engraved, six tick marks for the notches; ONE lit word beside the knob at
// its height (SLOW AHEAD … FULL ASTERN in binnacle amber while the engine runs, no word when it is stopped: the lever at N says it).
// No ENGINE button: the engine starts when the lever leaves N (autoStart) and stops by state, never by a timer (autoStop:
// the sails drawing at N, or the anchor holding or the boat made fast at N). The keyboard's I stays a plain start / stop.
// It is a detent lever: it stays where it is put. A drag moves it and the release snaps it to the nearest notch; a scroll,
// or + − move it a notch (no ▲ ▼ steps: owner 2026-10-31, the lever explains itself) (held + −: a notch every 0.3 s), 0 is N. It always draws the engine's own
// lever (src/boat/engine.js: −1 astern … +1 ahead), whatever moved it. W / S never touch it: they trim (owner, 2026-10-30).
//
//   const col = createThrottleColumn({ lever: () => eng.lever, engineState: () => eng.state, step(dir), set(v) });
//   col.place(rect, { word, knob, eng }); col.update(dt); col.hide(bool)
// Pure parts (NOTCHES, notchIndex, stepNotch, autoStart, autoStop, litWord, slotY, leverAtSlot): tests/throttle.test.mjs.
import { wheelPx } from './helmInput.js';

// a finger's lever (createThrottleColumn): the drag's dy (css px, + down) from where it landed, the notch it started on
// (NOTCHES' index) → the notch's lever value, or null while still inside the slop (moved: the slop already crossed once)
export const FINGER_LEVER = { slopPx: 6, notchPx: 18 };
export function fingerNotch(i0, dy, moved = false) {
  if (!moved && Math.abs(dy) < FINGER_LEVER.slopPx) return null;
  const i = Math.max(0, Math.min(NOTCHES.length - 1, i0 + Math.round(dy / FINGER_LEVER.notchPx)));
  return NOTCHES[i].v;
}
// the notches, ahead to astern: v is the lever (engine.js; |v| < ENGINE.detent is neutral)
// lit: the one word beside the knob while the engine runs
export const NOTCHES = [
  { id: 'full-ahead', label: 'FULL AHEAD', lit: 'FULL AHEAD', v: 1 },
  { id: 'half', label: 'HALF', lit: 'HALF AHEAD', v: 0.6 },
  { id: 'slow', label: 'SLOW', lit: 'SLOW AHEAD', v: 0.3 },
  { id: 'stop', label: 'STOP', lit: 'NEUTRAL', v: 0 },
  { id: 'slow-astern', label: 'SLOW ASTERN', lit: 'SLOW ASTERN', v: -0.35 },
  { id: 'full-astern', label: 'FULL ASTERN', lit: 'FULL ASTERN', v: -1 },
];
// the sprite: FRAMES frames for v = −1 … +1; the knob's centre at THETA·v from the slot's centre, R from the pivot
// (blender/dash_throttle.py: the slot's centre at the cell's centre, the knob 50 mm out, ±40°, a 64 mm cell)
// as rendered (blender/dash_throttle.py, measured at 1x): the knob's centre at y0 of the cell's height at STOP and ±amp at full
export const LEVER = { frames: 21, maxDeg: 40, y0: 57 / 128, amp: 45 / 128, dragPx: 26, scrollPx: 90, tol: 0.04 };

export function notchIndex(lever) {
  let best = 0;
  for (let i = 1; i < NOTCHES.length; i++) if (Math.abs(NOTCHES[i].v - lever) < Math.abs(NOTCHES[best].v - lever)) best = i;
  return best;
}
// one notch on from the lever: dir +1 ahead, −1 astern; from between two notches, the next one that way
export function stepNotch(lever, dir) {
  if (!dir) return lever;
  if (dir > 0) { for (let i = NOTCHES.length - 1; i >= 0; i--) if (NOTCHES[i].v > lever + LEVER.tol) return NOTCHES[i].v; return NOTCHES[0].v; }
  for (let i = 0; i < NOTCHES.length; i++) if (NOTCHES[i].v < lever - LEVER.tol) return NOTCHES[i].v;
  return NOTCHES[NOTCHES.length - 1].v;
}
// pushing the lever out of N with the engine off starts it (the starter, then the catch)
export const autoStart = ({ from = 0, to = 0, engineOn = false, detent = 0.08 } = {}) => !engineOn && Math.abs(to) >= detent && Math.abs(from) < detent;
// the sprite's frame for a lever value
export const frameOf = (v) => Math.max(0, Math.min(LEVER.frames - 1, Math.round((Math.max(-1, Math.min(1, v)) + 1) / 2 * (LEVER.frames - 1))));
// the knob's height in the cell (0 top … 1 bottom) for a lever value; the scale's marks sit level with it
const S40 = Math.sin(LEVER.maxDeg * Math.PI / 180);
export const knobY = (v) => LEVER.y0 - LEVER.amp * Math.sin(Math.max(-1, Math.min(1, v)) * LEVER.maxDeg * Math.PI / 180) / S40;
// a drag's lever value from the knob's height (the inverse of knobY), clamped
export const leverAtY = (y) => { const s = Math.max(-1, Math.min(1, (LEVER.y0 - y) / LEVER.amp * S40)); return Math.max(-1, Math.min(1, Math.asin(s) / (LEVER.maxDeg * Math.PI / 180))); };

// The stop rule, by state and never by a timer: with the lever at N for settleS, the engine stops when the sails
// draw ('sails': "the sails have her") or when the anchor holds or the boat is made fast ('held'). With the sails down or
// luffing it idles at N for as long as the skipper likes (hoisting, dropping, waiting off a mooring). In gear it never stops.
export const AUTO_STOP = { settleS: 3, fill: 0.6, furl: 0.2 };
export function sailsDrawing(s = {}, A = AUTO_STOP) {
  return (s.furl ?? 1) < A.furl && Math.max(s.mainFill ?? 0, s.jibFill ?? 0) >= A.fill;
}
export function autoStop({ engineOn = false, lever = 0, atNeutralS = 0, drawing = false, held = false, detent = 0.08 } = {}, A = AUTO_STOP) {
  if (!engineOn || Math.abs(lever) >= detent || atNeutralS < A.settleS) return null;
  if (held) return 'held';
  if (drawing) return 'sails';
  return null;
}
// the one lit word: the notch while the engine runs (or cranks); nothing when it is stopped (owner, 2026-11-05: the lever at N says it; aria-valuetext still names the engine)
export function litWord(lever, state) {
  if (state !== 'running' && state !== 'cranking') return { text: '', on: false };
  return { text: NOTCHES[notchIndex(lever)].lit, on: true };
}
// the slot (the escutcheon's 64 × 128 drawing): the knob's centre from FULL AHEAD (top) to FULL ASTERN (bottom), the notches
// where the old lever's knob stood (knobY) so the detents keep their spacing
export const SLOT = { top: 20, bottom: 110, x: 40, w: 64, h: 128 };
const K1 = knobY(1), KM = knobY(-1);
export const slotY = (v) => SLOT.top + (knobY(v) - K1) / (KM - K1) * (SLOT.bottom - SLOT.top);
export const leverAtSlot = (y) => leverAtY(K1 + (Math.max(SLOT.top, Math.min(SLOT.bottom, y)) - SLOT.top) / (SLOT.bottom - SLOT.top) * (KM - K1));

const ESC = `<svg class="esc" viewBox="0 0 64 128" preserveAspectRatio="none" aria-hidden="true">
<defs>
<linearGradient id="lkthr-st" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6E757C"/><stop offset=".18" stop-color="#B9C0C6"/><stop offset=".5" stop-color="#8F979E"/><stop offset=".82" stop-color="#C3C9CE"/><stop offset="1" stop-color="#5F666C"/></linearGradient>
<linearGradient id="lkthr-sl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0A0C10"/><stop offset=".5" stop-color="#1C2026"/><stop offset="1" stop-color="#05070A"/></linearGradient>
<filter id="lkthr-sh" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.6"/></filter>
</defs>
<rect x="6" y="3" width="52" height="122" rx="5" fill="#000" opacity=".35" filter="url(#lkthr-sh)" transform="translate(1.5,2.5)"/>
<rect x="6" y="3" width="52" height="122" rx="5" fill="url(#lkthr-st)" stroke="#2A2F35" stroke-width=".8"/>
<rect x="7.2" y="4.2" width="49.6" height="119.6" rx="4.2" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".6"/>
<circle cx="12" cy="9" r="1.6" fill="#4A5056" stroke="#D5DADF" stroke-width=".5"/><circle cx="52" cy="119" r="1.6" fill="#4A5056" stroke="#D5DADF" stroke-width=".5"/>
<rect x="36.5" y="17" width="7" height="96" rx="3.5" fill="url(#lkthr-sl)" stroke="#000" stroke-opacity=".6" stroke-width=".8"/>
${NOTCHES.map((n) => { const y = slotY(n.v).toFixed(1), long = n.id === 'stop'; return `<line x1="${long ? 22 : 27}" y1="${y}" x2="34" y2="${y}" stroke="#F2F4FA" stroke-opacity="${long ? 0.95 : 0.7}" stroke-width="${long ? 1.6 : 1}"/>`; }).join('')}
<text class="e" x="32" y="13.2" text-anchor="middle">AHEAD</text>
<text class="e" x="32" y="123" text-anchor="middle">ASTERN</text>
<text class="e n" x="14" y="${(slotY(0) + 4.2).toFixed(1)}" text-anchor="middle">N</text>
</svg>`;
const THROTTLE_CSS = `
.lk-thr{position:fixed;z-index:var(--lk-z-dock);box-sizing:border-box;touch-action:none;user-select:none;-webkit-user-select:none;opacity:1;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-thr.off{opacity:0;pointer-events:none;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-thr.off *{pointer-events:none!important}
.lk-thr .lv{position:absolute;inset:0;cursor:ns-resize;outline:none;-webkit-tap-highlight-color:transparent}
.lk-thr .lv:focus-visible{box-shadow:0 0 0 var(--lk-line) rgb(var(--lk-amber) / .9);border-radius:6px}
.lk-thr .esc{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.lk-thr .esc .e{font:600 var(--eng,11px) var(--lk-ui);letter-spacing:.5px;fill:#F2F4FA;fill-opacity:.92;paint-order:stroke;stroke:rgb(20 24 32 / .55);stroke-width:.6px}
.lk-thr .esc .e.n{font-weight:700;font-size:calc(var(--eng,11px) * 1.25);fill-opacity:.96}
/* the knob: a black ball on the slot's centre line, its shadow under it; it follows the lever */
.lk-thr .kb{position:absolute;left:${(SLOT.x / SLOT.w * 100).toFixed(2)}%;top:var(--ky,50%);width:var(--kd,22px);height:var(--kd,22px);border-radius:50%;transform:translate(-50%,-50%);pointer-events:none;
  background:radial-gradient(circle at 36% 30%,#8A8E94 0,#2A2D33 35%,#07080B 100%);box-shadow:0 0 0 .6px rgb(0 0 0 / .7),2px 3px 4px rgb(0 0 0 / .45);transition:top .12s var(--lk-ease)}
.lk-thr .kb::after{content:'';position:absolute;left:22%;top:12%;width:34%;height:20%;border-radius:50%;background:rgb(255 255 255 / .28)}
.lk-thr.drag .kb{transition:none}
/* the one lit word beside the knob, at its height: amber while the engine runs, dim cream when it is off */
.lk-thr .lit{position:absolute;left:calc(100% + var(--wgap,6px));top:var(--ky,50%);transform:translateY(-50%);white-space:nowrap;pointer-events:none;
  font:700 var(--wfs,15px)/1.2 var(--lk-ui);letter-spacing:.08em;color:rgb(var(--lk-amber));transition:top .12s var(--lk-ease);
  text-shadow:0 0 3px rgb(10 14 28 / .95),0 0 8px rgb(10 14 28 / .75),0 1px 1px rgb(0 0 0 / .9)}
.lk-thr .lit.off{color:rgb(var(--lk-cream) / .62);font-weight:600}
.lk-thr.drag .lit{transition:none}
/* an upright iPhone (feat/portrait): the lit word stands above the lever inside its own column, centred, at most two lines; it
   never moves over the boat or the wheel */
.lk-thr[data-lit=top] .lit{left:50%;top:auto;bottom:calc(100% + 3px);transform:translateX(-50%);width:var(--litw,58px);white-space:normal;text-align:center;
  line-height:1.08;letter-spacing:.03em;transition:none}
:root[data-lk-theme=night] .lk-thr .lit:not(.off){color:rgb(255 150 130)}
:root[data-lk-theme=night] .lk-thr .esc .e{fill:rgb(255 170 150)}
@media (prefers-reduced-motion:reduce){.lk-thr .kb,.lk-thr .lit{transition:none}}
/* the cockpit (cockpit3d.js): the 3D lever is the picture; this is its hit layer (a drag up = ahead), the lit word stays beside it */
.lk-thr[data-form=cockpit] .esc,.lk-thr[data-form=cockpit] .kb{opacity:0}
.lk-thr[data-form=cockpit] .lit{top:50%}
.lk-thr[data-form=cockpit] .lv:focus-visible{box-shadow:0 0 0 2px rgb(var(--lk-amber) / .9)}
`;

export function createThrottleColumn({ lever = () => 0, engineState = () => 'off', step = () => {}, set = () => {}, onUse = () => {}, root = document.body } = {}) {
  if (!document.getElementById('lk-thr-css')) { const st = document.createElement('style'); st.id = 'lk-thr-css'; st.textContent = THROTTLE_CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = 'lk-thr'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'engine control');
  el.innerHTML = `<div class="lv" role="slider" tabindex="0" aria-label="Throttle" aria-valuemin="-100" aria-valuemax="100">${ESC}<i class="kb"></i></div>`
    + '<b class="lit" aria-hidden="true"></b>';
  root.appendChild(el);
  const lv = el.querySelector('.lv'), lit = el.querySelector('.lit');
  const stop = (e) => e.stopPropagation();
  for (const n of el.querySelectorAll('.lv')) { n.addEventListener('pointerdown', stop); n.addEventListener('click', stop); }
  const go = (dir) => { if (dir) { step(dir); onUse(); } };
  // a drag: the knob follows the pointer (the lever moves with it); the release snaps it to the nearest notch
  // A finger (owner, 2026-11-15: "it is impossible to use the lever"): the drag is relative to where it landed, not the strip's
  // absolute height (the 3D knob stands near the strip's top at N, so the first move threw it to FULL AHEAD); up is ahead, a notch
  // per FINGER_LEVER.notchPx past FINGER_LEVER.slopPx, each notch a detent; a tap with no drag leaves the lever and the engine alone
  let pid = null, dragV = 0, rel = null;
  const vAt = (e) => { const r = lv.getBoundingClientRect(); return leverAtSlot((e.clientY - r.top) / r.height * SLOT.h); };
  lv.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0) return;
    pid = e.pointerId; try { lv.setPointerCapture(pid); } catch { /* synthetic */ }
    dragV = lever(); rel = e.pointerType === 'touch' ? { y0: e.clientY, i0: notchIndex(dragV), moved: false } : null;
    el.classList.add('drag'); e.preventDefault(); onUse();
  });
  lv.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pid) return;
    e.preventDefault();
    if (!rel) { dragV = vAt(e); set(dragV, { drag: true }); return; }
    const v = fingerNotch(rel.i0, e.clientY - rel.y0, rel.moved);
    if (v == null) return;
    rel.moved = true;
    if (v !== dragV) { dragV = v; set(dragV, { drag: true }); }
  });
  const up = (e) => {
    if (e.pointerId !== pid) return; pid = null; el.classList.remove('drag');
    const r = rel; rel = null;
    if (r && !r.moved) return;
    set(NOTCHES[notchIndex(dragV)].v, { snap: true });
  };
  for (const ev of ['pointerup', 'pointercancel']) lv.addEventListener(ev, up);
  lv.addEventListener('lostpointercapture', (e) => { if (pid != null) up(e); });
  // a scroll (a trackpad's two fingers, a mouse wheel): up = ahead, a notch per scrollPx of the normalised delta
  let acc = 0;
  el.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); acc -= wheelPx(e); while (Math.abs(acc) >= LEVER.scrollPx) { go(Math.sign(acc)); acc -= Math.sign(acc) * LEVER.scrollPx; } }, { passive: false });
  lv.addEventListener('keydown', (e) => { if (e.code === 'ArrowUp' || e.code === 'ArrowDown') { go(e.code === 'ArrowUp' ? 1 : -1); e.preventDefault(); e.stopPropagation(); } });

  // the layout (helmStation.js helmLayout): the column's rect, the lit word's size, the knob's diameter, the engraved words' size
  let rect = null;
  function place(r, { word = 15, knob = 22, eng = 11, steps = true, litAt = 'side', form = null } = {}) {
    if (!r) return; rect = r;
    if (form) el.dataset.form = form; else delete el.dataset.form;
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    el.style.setProperty('--wfs', `${word.toFixed(1)}px`); el.style.setProperty('--kd', `${knob.toFixed(1)}px`); el.style.setProperty('--wgap', `${Math.max(4, word * 0.4).toFixed(1)}px`);
    el.style.setProperty('--eng', `${(eng * SLOT.w / r.w).toFixed(2)}px`);   // in the drawing's units (it stretches to the rect)
    el.dataset.steps = steps ? 'on' : 'off';
    el.dataset.lit = litAt; el.style.setProperty('--litw', `${r.w}px`);
  }
  const hide = (off) => el.classList.toggle('off', !!off);

  let lastV = null, lastT = null;
  function update() {
    const raw = lever(), st = engineState(), v = pid != null ? dragV : raw;
    if (v !== lastV) { el.style.setProperty('--ky', `${(slotY(v) / SLOT.h * 100).toFixed(2)}%`); lastV = v; }
    const w = litWord(raw, st), key = `${w.text}|${w.on}`;
    if (key !== lastT) { lit.textContent = w.text; lit.classList.toggle('off', !w.on); lastT = key; }
    const i = notchIndex(raw);
    lv.setAttribute('aria-valuenow', String(Math.round(raw * 100))); lv.setAttribute('aria-valuetext', `${NOTCHES[i].lit.toLowerCase()}, engine ${st}`);
  }
  return { el, place, update, hide, get rect() { return rect; }, get frame() { return frameOf(lever()); }, get notch() { return NOTCHES[notchIndex(lever())].id; }, get word() { return lit.textContent; }, get dragging() { return pid != null; }, dispose() { el.remove(); } };
}
