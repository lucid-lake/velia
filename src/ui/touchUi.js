// Touch, in the glass family (owner ask 2026-10-30). No virtual joystick: a slim helm strip
// like a tiller's travel at the bottom, a Tack / Gybe plate that appears only when the manoeuvre makes sense, and the
// rest of the existing pieces made finger-sized and kept out of the boat's way. Only on a coarse pointer (a phone, a
// tablet; ?touch=1 forces it, ?touch=0 forbids it): a desktop sees none of it.
//
//   const tui = createTouchUi({ pads, state: () => phys.state, hidden: () => bool, onUse: () => lastUse = t });
//   tui.update(dt); tui.dispose();
// The strip: drag sideways from where the thumb lands (relative, like the tiller gesture on the canvas); the thumb mark
// follows the helm and springs back amidships on release. It adds to the same helm as the keys and the stick through
// pads.ext. The Tack plate (or Gybe, running) sits at the strip's right end and fades in near the wind; a tap starts
// TackAssist (touchMap.js), any hand on the strip or the canvas's helm half cancels it.
// Layout: `html[data-input=touch]` re-seats the corner pieces (hints, dial, dock, switch, chart opener, menu mark) on the safe
// areas and above the strip; portrait and landscape rules below. The numbers: --lk-ts-h (strip), --lk-ts-top (its top).
import { ensureTokens } from './tokens.js';
import { profile } from '../core/profile.js';
import { TOUCHUI, helmFromStrip, tackOffer, TackAssist, isCoarse } from './touchMap.js';

const CSS = `
:root{--lk-sat:env(safe-area-inset-top,0px);--lk-sar:env(safe-area-inset-right,0px);--lk-sab:env(safe-area-inset-bottom,0px);--lk-sal:env(safe-area-inset-left,0px)}
:root[data-input=touch]{
  --lk-row-h:max(46px,calc(var(--lk-u) * 46));
  --lk-mx:max(14px,var(--lk-sal),var(--lk-sar));
  --lk-my:max(14px,var(--lk-sat));
  --lk-icon:25px;
  overscroll-behavior:none}
:root[data-input=touch][data-screen~=compact]{--lk-d:calc(clamp(108px,27.5vw,136px) * var(--lk-dm))}   /* a phone's thumb-sized circles; an iPad keeps the desktop's */
:root.lk-strip{--lk-row-h:max(48px,calc(var(--lk-u) * 46));--lk-ts-h:50px;--lk-ts-b:calc(max(10px,var(--lk-sab)) + var(--lk-row-h) + 6px);--lk-ts-top:calc(var(--lk-ts-b) + var(--lk-ts-h) + 8px)}
:root[data-input=touch] body{overscroll-behavior:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.lk-ts{position:fixed;left:var(--lk-mx);right:var(--lk-mx);bottom:var(--lk-ts-b);height:var(--lk-ts-h);z-index:var(--lk-z-hud);display:none;gap:10px;align-items:stretch;
  font:var(--lk-medium) var(--lk-fs-label)/1 var(--lk-ui);color:var(--lk-ink);letter-spacing:var(--lk-track);-webkit-font-smoothing:antialiased;
  opacity:1;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-strip .lk-ts{display:flex}
.lk-ts.off{opacity:0;pointer-events:none;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-ts .strip{position:relative;flex:1 1 auto;min-width:0;height:100%;border-radius:calc(var(--lk-ts-h) / 2);touch-action:none;
  background:var(--lk-glass);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--lk-glass-edge);box-shadow:var(--lk-glass-shadow)}
.lk-ts .rail{position:absolute;left:30px;right:30px;top:50%;height:0;border-top:var(--lk-line) solid var(--lk-hair)}
.lk-ts .mid{position:absolute;left:50%;top:14px;bottom:14px;width:0;border-left:var(--lk-line) solid var(--lk-hair)}
.lk-ts .nl{position:absolute;top:50%;width:9px;height:9px;margin-top:-4.5px;border-radius:50%;opacity:.9}
.lk-ts .nl.p{left:16px;background:rgb(var(--lk-port))}
.lk-ts .nl.s{right:16px;background:rgb(var(--lk-stbd))}
.lk-ts .thumb{position:absolute;left:50%;top:5px;bottom:5px;width:46px;margin-left:-23px;border-radius:calc((var(--lk-ts-h) - 10px) / 2);box-sizing:border-box;
  border:var(--lk-line) solid var(--lk-lit);background:var(--lk-lit-fill);transform:translateX(var(--tx,0px));will-change:transform}
.lk-ts .thumb::before,.lk-ts .thumb::after{content:'';position:absolute;top:50%;width:6px;height:6px;margin-top:-3px;border:2px solid var(--lk-lit-ink);border-bottom:0;border-right:0;opacity:.9}
.lk-ts .thumb::before{left:9px;transform:rotate(-45deg)}
.lk-ts .thumb::after{right:9px;transform:rotate(135deg)}
.lk-ts .strip.rest .thumb{transition:transform .22s var(--lk-ease)}
.lk-ts .tack{all:unset;box-sizing:border-box;flex:0 0 96px;display:flex;align-items:center;justify-content:center;gap:.4em;border-radius:calc(var(--lk-ts-h) / 2);cursor:pointer;
  background:var(--lk-glass-dense);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--lk-lit);color:var(--lk-lit-ink);
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;opacity:0;pointer-events:none;transform:translateY(var(--lk-rise));
  transition:opacity var(--lk-out) var(--lk-ease-out),transform var(--lk-out) var(--lk-ease-out)}
.lk-ts .tack.in{opacity:1;pointer-events:auto;transform:none;transition:opacity var(--lk-in) var(--lk-ease),transform var(--lk-in) var(--lk-ease)}
.lk-ts .tack.go{background:var(--lk-lit-fill)}
.lk-ts .tack svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
/* the home card: every row, pick and link is a 44 px target */
[data-input=touch] #lk-load .lk-row{min-height:46px;align-items:center}
[data-input=touch] #lk-load .lk-pick{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 .7em}
[data-input=touch] #lk-load .lk-link,[data-input=touch] #lk-load .lk-links a,[data-input=touch] #lk-load .lk-links button{display:inline-flex;align-items:center;min-height:44px}
/* the corner pieces, re-seated for a thumb: above the strip, on the safe areas, 44 px targets */
.lk-strip .lk-hint{transform:none;top:calc(calc(var(--lk-sat,0px) + var(--lk-edge-gap)) + 52px + 10px);bottom:auto;left:calc(var(--lk-mx) + 8px);right:calc(var(--lk-mx) + 8px);max-width:none;justify-content:center;-webkit-touch-callout:none}   /* portrait: under the capsule and the notch, two lines at most */
.lk-strip .lk-cv{top:auto;bottom:var(--lk-ts-top);right:var(--lk-mx)}   /* the dial keeps to the thumb's corner above the strip; the chart is a button (its opener) here */
.lk-strip .lk-cv .hit{stroke-width:44px}
[data-input=touch] .lk-dock{bottom:max(10px,var(--lk-sab))}
.lk-strip .lk-chart .small{bottom:var(--lk-ts-top)}   /* portrait: the circles stand above the helm strip, one at each corner (a phone shows one) */
[data-input=touch] .lk-dock .tip{display:none}
/* a thumb-sized circle (108-136 px) keeps its numbers and drops the small labels and the chart's DPT, as a phone does */
[data-screen~=compact] .lk-chart .rw i,[data-screen~=compact] .lk-cv .rw i{display:none}
[data-screen~=compact] .lk-chart .small .inr.b{bottom:15%}[data-screen~=compact] .lk-chart .small .inr.t{top:10%}[data-screen~=compact] .lk-chart .small .inr.b .rw.s{display:none}
[data-input=touch] .lk-menu-mark{left:max(10px,var(--lk-sal));top:max(10px,var(--lk-sat))}
[data-input=touch] .lk-view .tip{display:none}
[data-input=touch] .lk-chart .opener{top:var(--lk-my);right:var(--lk-mx)}
/* landscape: the hint row stays left of the boat (the boat is at the middle) */
@media (orientation:landscape){
  :root.lk-strip{--lk-row-h:max(46px,calc(var(--lk-u) * 46));--lk-ts-h:44px;--lk-ts-b:calc(max(6px,var(--lk-sab) - 12px) + var(--lk-row-h) + 2px)}
  [data-input=touch] .lk-dock{bottom:max(6px,calc(var(--lk-sab) - 12px))}
  .lk-strip .lk-cv,.lk-strip .lk-chart .small{bottom:max(6px,calc(var(--lk-sab) - 12px))}   /* landscape: the circles at the bottom corners, the row between them, the strip above it */
  .lk-strip .lk-hint{top:max(10px,var(--lk-sat));left:var(--lk-mx);right:auto;max-width:calc(50vw - 185px - var(--lk-mx));justify-content:flex-start}   /* landscape: the boat is at the middle under the capsule, so the line keeps to the top-left */
  .lk-ts{left:calc(50% - min(220px,26vw));right:auto;width:min(440px,52vw)}
}
:where(:root[data-screen~=narrow]) .lk-strip .lk-chart .small{left:auto;right:var(--lk-mx)}
@media (prefers-reduced-motion:reduce){.lk-ts .tack{transform:none}.lk-ts .strip.rest .thumb{transition:none}}
`;

const TACK_ICON = '<path d="M5 18 12 5l7 13"/><path d="M8 14.5h8"/>';
const GYBE_ICON = '<path d="M5 6l7 13 7-13"/><path d="M8 9.5h8"/>';

// The touch tokens and rules for any mode (main.js calls it at once): the safe areas, the finger-sized shared pieces.
// Sail's helm strip adds `lk-strip` (and the rules that need it) on top.
export function touchInit(win = globalThis) {
  if (!isCoarse(win)) return false;
  ensureTokens();
  profile.refresh();   // data-input="touch" on <html> (src/core/profile.js): the rules below read it (lk-touch is retired, 2026-11-17)
  if (!document.getElementById('lk-touch-css')) { const st = document.createElement('style'); st.id = 'lk-touch-css'; st.textContent = CSS; document.head.appendChild(st); }
  return true;
}

export function createTouchUi({ strip: stripOn = true, pads, state = () => null, hidden = () => false, onUse = () => {}, pinDial = () => {}, root = document.body, win = globalThis } = {}) {
  const coarse = isCoarse(win);
  if (!coarse) return { active: false, update() {}, dispose() {}, el: null };
  if (!stripOn) { touchInit(win); return { active: false, update() {}, dispose() {}, el: null, get helm() { return 0; } }; }   // the helm station's wheel is the phone's helm (helmStation.js)
  touchInit(win); document.documentElement.classList.add('lk-strip');
  const el = document.createElement('div'); el.className = 'lk-ts'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'helm');
  el.innerHTML = '<div class="strip rest" role="slider" aria-label="helm" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0"><i class="rail"></i><i class="mid"></i><i class="nl p"></i><i class="nl s"></i><span class="thumb"></span></div>'
    + `<button type="button" class="tack" aria-label="Tack"><svg viewBox="0 0 24 24" aria-hidden="true">${TACK_ICON}</svg><span class="w">Tack</span></button>`;
  root.appendChild(el);
  const strip = el.querySelector('.strip'), thumb = el.querySelector('.thumb'), btn = el.querySelector('.tack'), word = btn.querySelector('.w'), icon = btn.querySelector('svg');
  const H = document.documentElement;
  const assist = new TackAssist();
  let id = null, x0 = 0, helm = 0, offer = null, disposed = false;

  const setThumb = (v) => {
    const half = Math.max(0, strip.clientWidth / 2 - 23 - 6);
    thumb.style.setProperty('--tx', `${(v * half).toFixed(1)}px`);
    strip.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  strip.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0) return;
    id = e.pointerId; x0 = e.clientX; helm = 0; assist.cancel(); onUse();
    strip.classList.remove('rest');
    try { strip.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer */ }
    e.preventDefault(); e.stopPropagation();
  });
  strip.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    helm = helmFromStrip(e.clientX - x0, strip.clientWidth); setThumb(helm); e.preventDefault();
  });
  const up = (e) => { if (e.pointerId !== id) return; id = null; helm = 0; strip.classList.add('rest'); setThumb(0); };
  strip.addEventListener('pointerup', up); strip.addEventListener('pointercancel', up); strip.addEventListener('lostpointercapture', up);
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  // a press (the plate, or Space with no helm station: controls.js): start the manoeuvre, or a second press cancels it
  const press = () => {
    const s = state(); if (!s) return false;
    if (assist.active) { assist.cancel(); return false; }
    offer = tackOffer({ twa: s.trueWind?.angle ?? 0, speed: s.sog ?? 0 });
    if (!offer) return false;
    assist.start(offer, s.trueWind?.angle ?? 0); onUse(); return true;
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); press(); });

  let shownOffer = null;
  let pinned = false;
  function update(dt) {
    if (disposed) return;
    if (!pinned) { pinned = true; pinDial(); }   // no hover to wake it: the wind dial (the sheet's hand) stays up on a phone
    const s = state();
    const off = hidden();
    el.classList.toggle('off', off);
    const twa = s?.trueWind?.angle ?? 0;
    offer = s ? tackOffer({ twa, speed: s.sog ?? 0 }) : null;
    const want = assist.active ? (assist.kind) : offer;
    if (want !== shownOffer) {
      shownOffer = want;
      btn.classList.toggle('in', !!want && !off);
      if (want) { word.textContent = want === 'tack' ? 'Tack' : 'Gybe'; btn.setAttribute('aria-label', word.textContent); icon.innerHTML = want === 'tack' ? TACK_ICON : GYBE_ICON; }
    }
    btn.classList.toggle('go', assist.active);
    const a = assist.active ? assist.step(dt, twa) : 0;
    if (!assist.active && !off) btn.classList.toggle('in', !!offer); else if (off) btn.classList.remove('in');
    if (id != null) { pads.ext.steer = helm; pads.ext.on = true; }
    else if (assist.active) { pads.ext.steer = a; pads.ext.on = true; setThumb(a); strip.classList.add('rest'); }
    else { pads.ext.steer = 0; pads.ext.on = false; }
  }
  return {
    active: true, el, update, press, assist,
    get helm() { return pads.ext.steer; },
    dispose() { disposed = true; pads.ext.steer = 0; pads.ext.on = false; el.remove(); H.classList.remove('lk-strip'); },
  };
}
