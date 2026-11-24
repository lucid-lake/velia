// The Tack / Gybe button of the helm station (owner gap list): a small glass pill just above the wheel, shown
// only while a tack or a gybe is possible (touchMap.tackOffer), for a mouse as well as a finger. A press runs TackAssist
// (the same assist as the phone strip's plate); turning the wheel, or a second press, cancels it. It feeds the helm through
// pads.ext, as the strip does. Space presses it too (controls.js, KEY.tack).
//   const tb = createTackButton({ pads, state, rects: () => station.rects, shown: () => bool }); tb.update(dt); tb.dispose();
import { ensureTokens } from '../../ui/tokens.js';
import { tackOffer, TackAssist } from '../../ui/touchMap.js';

const CSS = `
.lk-tackb{all:unset;box-sizing:border-box;position:fixed;z-index:var(--lk-z-hud);display:flex;align-items:center;justify-content:center;gap:.4em;min-width:92px;height:44px;padding:0 14px;
  border-radius:22px;cursor:pointer;font:var(--lk-medium) var(--lk-fs-label)/1 var(--lk-ui);letter-spacing:var(--lk-track);color:var(--lk-lit-ink);
  background:var(--lk-glass-dense);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--lk-lit);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;opacity:0;pointer-events:none;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-tackb.in{opacity:1;pointer-events:auto;transition:opacity var(--lk-in) var(--lk-ease)}
:root[data-lk-play=cruise] .lk-tackb{display:none}   /* v2's Cruise: the autopilot sails; Take the helm brings Sail and the pill back */
.lk-tackb.go{background:var(--lk-lit-fill)}
.lk-tackb:focus-visible{outline:2px solid var(--lk-lit);outline-offset:2px}
.lk-tackb svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
/* the cockpit (cockpit3d.js): the 3D push-button on the cap is the picture (its ring lit while a tack is offered); this is its hit target */
.lk-tackb[data-form=cockpit]{min-width:0;padding:0;border-color:transparent;background:none;-webkit-backdrop-filter:none;backdrop-filter:none;color:transparent;border-radius:50%}
.lk-tackb[data-form=cockpit] svg{opacity:0}
.lk-tackb[data-form=cockpit].go{background:none}
`;
const ICON = { tack: '<path d="M5 18 12 5l7 13"/><path d="M8 14.5h8"/>', gybe: '<path d="M5 6l7 13 7-13"/><path d="M8 9.5h8"/>' };
const WORD = { tack: 'Tack', gybe: 'Gybe' };

// where the pill stands: centred over the wheel, a gap above it, kept inside the window
export function tackButtonPos(wheel, w, h, bw = 96, bh = 44, gap = 6) {
  if (!wheel) return null;
  const x = Math.max(4, Math.min(w - bw - 4, wheel.x + wheel.w / 2 - bw / 2));
  const y = Math.max(4, Math.min(h - bh - 4, wheel.y - bh - gap));
  return { x, y };
}

export function createTackButton({ pads, state = () => null, rects = () => null, shown = () => true, onUse = () => {}, root = document.body } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-tackb-css')) { const st = document.createElement('style'); st.id = 'lk-tackb-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('button'); el.type = 'button'; el.className = 'lk-tackb'; el.setAttribute('aria-label', 'Tack');
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON.tack}</svg><span class="w">Tack</span>`;
  root.appendChild(el);
  const icon = el.querySelector('svg'), word = el.querySelector('.w');
  const assist = new TackAssist();
  let offer = null, shownKind = null, disposed = false, handHeld = false;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  // a press (the pill, or Space: controls.js): start the whole manoeuvre, or a second press cancels it
  const press = () => {
    const s = state(); if (!s) return false;
    if (assist.active) { assist.cancel(); return false; }
    offer = tackOffer({ twa: s.trueWind?.angle ?? 0, speed: s.sog ?? 0 });
    if (offer) { assist.start(offer, s.trueWind?.angle ?? 0); onUse(); return true; }
    return false;
  };
  el.addEventListener('click', (e) => { e.stopPropagation(); press(); });
  // handHeld: the wheel (or the strip) is in someone's hand; it cancels the assist
  function update(dt, { handHeld: held = false } = {}) {
    if (disposed) return;
    handHeld = held;
    const s = state(), ok = !!s && shown();
    const twa = s?.trueWind?.angle ?? 0;
    if (handHeld && assist.active) assist.cancel();
    offer = s ? tackOffer({ twa, speed: s.sog ?? 0 }) : null;
    const want = assist.active ? assist.kind : offer;
    if (want !== shownKind) {
      shownKind = want;
      if (want) { word.textContent = WORD[want]; el.setAttribute('aria-label', WORD[want]); icon.innerHTML = ICON[want]; }
    }
    el.classList.toggle('in', !!want && ok);
    el.classList.toggle('go', assist.active);
    const rs = rects(), tk = rs?.form === 'cockpit' ? rs.tack : null;   // the cockpit: over its 3D button
    if (tk) { el.dataset.form = 'cockpit'; Object.assign(el.style, { left: `${tk.x}px`, top: `${tk.y}px`, width: `${tk.w}px`, height: `${tk.h}px` }); }
    else {
      if (el.dataset.form) { delete el.dataset.form; Object.assign(el.style, { width: '', height: '' }); }
      const pos = tackButtonPos(rs?.wheel, innerWidth, innerHeight);
      if (pos) { el.style.left = `${pos.x}px`; el.style.top = `${pos.y}px`; }
    }
    const a = assist.active ? assist.step(dt, twa) : 0;
    if (assist.active) { pads.ext.steer = a; pads.ext.on = true; }
    else if (!handHeld) { pads.ext.steer = 0; pads.ext.on = false; }
  }
  return {
    el, update, press, assist, get active() { return assist.active; }, get kind() { return shownKind; }, get offer() { return offer; },
    dispose() { disposed = true; pads.ext.steer = 0; pads.ext.on = false; el.remove(); },
  };
}
