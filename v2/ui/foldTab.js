// The cockpit's fold tab (owner, 2026-11-16: "move the fold control to a slim tab on the cockpit's bottom-left rim, where the folded
// strip ends up, so the same spot folds and raises it"; it was a chevron on the wheel's boss, src/stations/sloop/foldButton.js).
// One slim navy tab with a cream chevron, standing on the screen's foot under the coaming's left end: up, the chevron points down
// (fold); folded, the cockpit gone below the foot, the same tab stays where it was and its chevron points up (raise). Same place, one
// target (≥ 44 px), one focusable button: Enter folds and raises; H stays its key (calmHud.js). It never pops: it fades aside in place
// (the helm view, Clear, a camera shot) as the old mark did, and with the Calm HUD while the cockpit is up.
// Two tabs, one in each corner (owner, 2026-11-18: "In both corners, left and right, we should have the same button that can hide the
// cockpit"): the same tab mirrored under the coaming's right end (right of the wind instrument's rim); both fold and raise the same
// cockpit and both show its state. side: 'l' (the default) or 'r'.
//   const ft = createFoldTab({ parent, onPress, side })
//   ft.place({ show, folded, x, h })   // css px: x the tab's centre, h the viewport's height (its foot)
//   ft.el (button.lk-fold: .up while folded; el.hidden reads the fade), ft.box, ft.dispose()
// foldTabX: the tab's centre, the coaming's left end as the camera sees it (left of the chart instrument's rim), held off the edge;
// side 'r' its mirror, right of the wind instrument's rim (windRight)
export const FOLD_TAB = Object.freeze({ w: 64, h: 44, tabH: 22, tabW: 52, slideS: 0.4, fadeS: 0.3, edge: 16 });
export const foldTabX = ({ chartLeft = null, windRight = null, w = 1280, side = 'l' } = {}) => {
  if (side === 'r') {
    const want = Number.isFinite(windRight) ? windRight + 0.75 * FOLD_TAB.w : 0.92 * w;
    return Math.round(Math.min(w - FOLD_TAB.edge - FOLD_TAB.w / 2, Math.max(w / 2 + FOLD_TAB.w, want)));
  }
  const want = Number.isFinite(chartLeft) ? chartLeft - 0.75 * FOLD_TAB.w : 0.08 * w;
  return Math.round(Math.max(FOLD_TAB.edge + FOLD_TAB.w / 2, Math.min(w / 2 - FOLD_TAB.w, want)));
};

const FOLD_TAB_CSS = `
.lk-helm button.lk-fold.lk-ftab{all:unset;position:absolute;box-sizing:border-box;bottom:0;width:${FOLD_TAB.w}px;height:${FOLD_TAB.h}px;transform:translateX(-50%);z-index:3;
  display:flex;align-items:flex-end;justify-content:center;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation;
  transition:opacity ${FOLD_TAB.fadeS}s linear,visibility 0s}
.lk-helm button.lk-fold.lk-ftab.gone{opacity:0;visibility:hidden;pointer-events:none!important;transition:opacity ${FOLD_TAB.fadeS}s linear,visibility 0s linear ${FOLD_TAB.fadeS}s}
.lk-helm button.lk-fold.lk-ftab b{display:flex;align-items:center;justify-content:center;width:${FOLD_TAB.tabW}px;height:${FOLD_TAB.tabH}px;border-radius:9px 9px 0 0;
  background:rgb(var(--lk-brand-navy) / .88);box-shadow:0 0 0 1px rgb(var(--lk-cream) / .22),0 -1px 6px rgb(0 0 0 / .3);transition:background-color .15s linear,box-shadow .15s linear}
.lk-helm button.lk-fold.lk-ftab svg{display:block;width:18px;height:10px;fill:none;stroke:rgb(var(--lk-cream) / .9);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform ${FOLD_TAB.slideS}s ease-in-out}
.lk-helm button.lk-fold.lk-ftab.up svg{transform:rotate(180deg)}
.lk-helm button.lk-fold.lk-ftab:is(:hover,:focus-visible) b{background:rgb(var(--lk-brand-navy) / .97);box-shadow:0 0 0 1px rgb(var(--lk-cream) / .5),0 -1px 8px rgb(0 0 0 / .35)}
.lk-helm button.lk-fold.lk-ftab:focus-visible{outline:none}
.lk-helm button.lk-fold.lk-ftab:focus-visible b{outline:2px solid rgb(var(--lk-amber) / .9);outline-offset:1px}
html:is(.lk-calm-bar,.lk-calm-dash):not(.lk-folded) .lk-helm button.lk-fold.lk-ftab{opacity:0;visibility:hidden;transition:opacity var(--lk-calm-fade,600ms) ease,visibility 0s linear var(--lk-calm-fade,600ms)}
@media (prefers-reduced-motion:reduce){.lk-helm button.lk-fold.lk-ftab,.lk-helm button.lk-fold.lk-ftab svg{transition:none}}
`;
const GLYPH = '<b><svg viewBox="0 0 18 10" aria-hidden="true"><path d="M2 2 9 8 16 2"/></svg></b>';

export function createFoldTab({ parent, onPress = () => {}, side = 'l', doc = document } = {}) {
  if (!doc.getElementById('lk-ftab-css')) { const st = doc.createElement('style'); st.id = 'lk-ftab-css'; st.textContent = FOLD_TAB_CSS; doc.head.appendChild(st); }
  const el = doc.createElement('button'); el.type = 'button'; el.className = 'lk-fold lk-ftab gone'; el.dataset.side = side === 'r' ? 'r' : 'l';
  Object.defineProperty(el, 'hidden', { configurable: true, get: () => el.classList.contains('gone'), set: (v) => { el.classList.toggle('gone', !!v); } });
  el.innerHTML = GLYPH;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => { e.stopPropagation(); el.blur(); onPress(); dispatchEvent(new Event('lk-click')); });
  parent.appendChild(el);
  let last = '', box = null;
  function place({ show = false, folded = false, x = 0, h = globalThis.innerHeight ?? 720 } = {}) {
    box = show ? { x: x - FOLD_TAB.w / 2, y: h - FOLD_TAB.h, w: FOLD_TAB.w, h: FOLD_TAB.h } : null;
    const key = `${show}|${folded}|${Math.round(x)}`;
    if (key === last) return false;
    last = key;
    el.hidden = !show;
    el.classList.toggle('up', folded);
    el.style.left = `${Math.round(x)}px`;
    el.setAttribute('aria-label', folded ? 'Raise the cockpit (H)' : 'Lower the cockpit (H)');
    el.setAttribute('aria-expanded', String(!folded));
    return true;
  }
  return { el, place, get box() { return box; }, dispose() { el.remove(); } };
}
