// The cockpit's fold control (owner, 2026-11-12). Two states only: up, the whole 3D cockpit raised; folded, the whole cockpit lowered
// out of view (no half state, no pucks), one 0.4 s eased slide between them (calmHud.js). look/fold-mark (the round push button "too
// eye-catching: people will look at it every second"): no disc and no ring.
//   up       a small chevron engraved on the wheel's boss cap at its centre, like a maker's mark: the cap's own metal tone, about
//            15 % contrast at rest; it fades with the Calm HUD; under the mouse it brightens (a hand cursor), on a touch it brightens
//            at touch-down. The wheel's drag pad covers the hub, so the mark takes no pointer itself: watch(pad) tells a tap from a
//            drag there. A press on the mark that moves under TAP.px and lets go within TAP.ms folds the cockpit; any drag that starts
//            there steers, exactly as before (a tap turns nothing: the wheel's gesture starts where the wheel is).
//   folded   a thin quiet handle at the very bottom edge (cream, low contrast; brighter under the pointer); the whole bottom strip
//            (48 px, full width) raises the cockpit too.
//   The control is one focusable button (≥ 44 px target, an aria-label): Enter folds and raises; H is its key (calmHud.js). It never
//   rides the cap and never pops: it fades aside in place (the helm view, Clear, a camera shot, a menu).
//   const fb = createFoldButton({ parent, onPress });
//   fb.place({ show, folded, x, yUp, h })   // css px: x the centre; yUp the target's top on the hub; folded: the bottom edge
//   fb.watch(pad)                            // the wheel's pad: hover, touch-down and the tap on the mark
//   fb.el, fb.strip, fb.hit(x, y), fb.dispose()
export const FOLD_BTN = { size: 44, slideS: 0.4, fadeS: 0.3, strip: 48, gap: 0, handleW: 96 };
export const TAP = { px: 6, ms: 300 };

// the rules: helmStyle.js puts them in the helm's own sheet (lk-helm-css), so no new style element joins the head
export const FOLD_CSS = `
.lk-helm button.lk-fold{all:unset;position:absolute;box-sizing:border-box;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;
  -webkit-tap-highlight-color:transparent;width:${FOLD_BTN.size}px;height:${FOLD_BTN.size}px;padding-bottom:6px;transform:translateX(-50%);z-index:2;
  transition:top ${FOLD_BTN.slideS}s ease-in-out,opacity ${FOLD_BTN.fadeS}s linear,visibility 0s}
.lk-helm button.lk-fold.gone{opacity:0;visibility:hidden;pointer-events:none!important;transition:top ${FOLD_BTN.slideS}s ease-in-out,opacity ${FOLD_BTN.fadeS}s linear,visibility 0s linear ${FOLD_BTN.fadeS}s}
/* the mark: a backlit chevron cut through the boss cap, 26 x 16 px (owner, 2026-11-12: "let's make the fold M glowing i.e user can
   notice it"; earlier: 15 % "too hard to be noticed", then "at the bottom, it is OK to be obvious"). Like the instruments' lit faces it
   keeps its own small glow whatever the world's light (lit by the boat's light: only backlit parts do): cream light in the
   cut, a soft steady halo, a dark rim round the cut for its edge; by night the night theme's red, dimmer (--lk-fold-glow). Steady: no
   pulse, no blink, no loop. Brighter under the hand; the first time the cockpit shows in a session one soft reveal (0.6 s up, held
   0.3 s, 0.6 s back) and never again */
.lk-helm button.lk-fold{--lk-fold-glow:1}
:root[data-lk-theme=night] .lk-helm button.lk-fold{--lk-fold-glow:.6}
.lk-helm button.lk-fold svg{display:block;width:26px;height:16px;fill:none;stroke:rgb(var(--lk-cream) / calc(.62 + .3 * var(--lk-fold-glow)));stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;
  overflow:visible;filter:drop-shadow(0 0 2px rgb(var(--lk-cream) / calc(.75 * var(--lk-fold-glow)))) drop-shadow(0 0 6px rgb(var(--lk-cream) / calc(.45 * var(--lk-fold-glow))));
  transition:stroke .6s ease,filter .6s ease}
.lk-helm button.lk-fold svg .lip{stroke:rgb(14 18 28 / .7);stroke-width:4.4;transition:none}   /* the cut's dark rim, under the light */
.lk-helm button.lk-fold:is(.reveal,.hot,:focus-visible) svg{stroke:rgb(var(--lk-cream));filter:drop-shadow(0 0 2px rgb(var(--lk-cream) / .95)) drop-shadow(0 0 9px rgb(var(--lk-cream) / calc(.7 * var(--lk-fold-glow))))}
.lk-helm button.lk-fold:is(.hot,:focus-visible) svg{transition-duration:.15s}
.lk-helm button.lk-fold:focus-visible{outline:2px solid rgb(var(--lk-amber) / .9);outline-offset:-4px;border-radius:8px}
.lk-helm button.lk-fold i{display:none}
/* folded: a thin handle at the foot, the button a target of its own */
.lk-helm button.lk-fold.up{pointer-events:auto;cursor:pointer;width:${FOLD_BTN.handleW}px;padding-bottom:7px}
.lk-helm button.lk-fold.up svg{display:none}
.lk-helm button.lk-fold.up i{display:block;width:64px;height:4px;border-radius:2px;background:rgb(var(--lk-cream) / calc(.62 + .3 * var(--lk-fold-glow)));box-shadow:0 0 0 1px rgb(14 18 28 / .45),0 0 3px rgb(var(--lk-cream) / calc(.7 * var(--lk-fold-glow))),0 0 8px rgb(var(--lk-cream) / calc(.4 * var(--lk-fold-glow)));transition:background-color .15s linear,box-shadow .15s linear}   /* lit to match the mark */
.lk-helm button.lk-fold.up:hover i,.lk-helm button.lk-fold.up:focus-visible i,.lk-helm .lk-foldstrip:hover ~ button.lk-fold.up i{background:rgb(var(--lk-cream));box-shadow:0 0 0 1px rgb(14 18 28 / .45),0 0 4px rgb(var(--lk-cream) / .9),0 0 12px rgb(var(--lk-cream) / calc(.6 * var(--lk-fold-glow)))}
/* the bottom strip: folded, the whole foot of the screen raises the cockpit (no look of its own; its hover lights the handle) */
.lk-helm .lk-foldstrip{position:absolute;left:0;right:0;bottom:0;height:${FOLD_BTN.strip}px;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;z-index:1}
.lk-helm .lk-foldstrip[hidden]{display:none}
/* the Calm HUD: the mark fades with the bar and the dashboard (not while folded: then the handle is the one thing left) */
html:is(.lk-calm-bar,.lk-calm-dash):not(.lk-folded) .lk-helm button.lk-fold{opacity:0;visibility:hidden;transition:opacity var(--lk-calm-fade,600ms) ease,visibility 0s linear var(--lk-calm-fade,600ms)}
@media (prefers-reduced-motion:reduce){.lk-helm button.lk-fold,.lk-helm button.lk-fold.gone,.lk-helm button.lk-fold svg,.lk-helm button.lk-fold i{transition:none}}
`;
const GLYPH = '<svg viewBox="0 0 26 16" aria-hidden="true"><path class="lip" d="M3 3 13 12.5 23 3"/><path d="M3 3 13 12.5 23 3"/></svg><i></i>';
const REVEAL = { key: 'lakeshore.foldmark.v1', delayMs: 500, holdMs: 900 };

// reveal: the first-visit brighten may run (false on captures: the film frames and headless pages stay still); session: where
// "shown this session" is kept
export function createFoldButton({ parent, onPress = () => {}, doc = document, reveal = true, session = globalThis.sessionStorage ?? null } = {}) {
  const strip = doc.createElement('div'); strip.className = 'lk-foldstrip'; strip.hidden = true; strip.setAttribute('aria-hidden', 'true');
  const el = doc.createElement('button'); el.type = 'button'; el.className = 'lk-fold gone';
  // stepped aside: the class 'gone' fades it in place (the helm's sheet makes any [hidden] display: none, a pop); el.hidden reads and
  // writes the same state, so the page tests and tools keep their one question
  Object.defineProperty(el, 'hidden', { configurable: true, get: () => el.classList.contains('gone'), set: (v) => { el.classList.toggle('gone', !!v); } });
  el.innerHTML = GLYPH;
  // quiet: a tap on the mark folds at its pointerup; a touch's own click lands 0-300 ms later on what is under the finger then (the
  // handle and the strip, now live there) and would raise it again at once: that one click is let go
  let quietUntil = 0;
  const press = (e) => { e?.stopPropagation?.(); el.blur(); onPress(); dispatchEvent(new Event('lk-click')); };
  const click = (e) => { if (performance.now() < quietUntil) { e.stopPropagation(); return; } press(e); };
  for (const n of [el, strip]) { n.addEventListener('pointerdown', (e) => e.stopPropagation()); n.addEventListener('click', click); }
  parent.appendChild(strip); parent.appendChild(el);   // the strip first: its hover lights the handle (the ~ rule)
  let last = '', box = null, folded = false, revealed = !reveal;
  try { if (session?.getItem(REVEAL.key)) revealed = true; } catch { /* blocked: once per page */ }
  // the first visit: one soft brighten when the mark first shows, once a session (no loop, no pulse)
  const revealOnce = () => {
    if (revealed) return; revealed = true;
    try { session?.setItem(REVEAL.key, '1'); } catch { /* private mode */ }
    setTimeout(() => { el.classList.add('reveal'); setTimeout(() => el.classList.remove('reveal'), REVEAL.holdMs); }, REVEAL.delayMs);
  };
  function place({ show = false, folded: f = false, x = 0, yUp = 0, h = globalThis.innerHeight ?? 720 } = {}) {
    folded = f;
    if (show && !f) revealOnce();
    const top = f ? h - FOLD_BTN.size - FOLD_BTN.gap : yUp;
    box = show && !f ? { x: x - FOLD_BTN.size / 2, y: top, w: FOLD_BTN.size, h: FOLD_BTN.size } : null;
    const key = `${show}|${f}|${Math.round(x)}|${Math.round(top)}`;
    if (key === last) return false;
    last = key;
    el.hidden = !show;
    strip.hidden = !(show && f);
    el.classList.toggle('up', f);
    if (!box) el.classList.remove('hot');
    el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(top)}px`;
    el.setAttribute('aria-label', f ? 'Raise the cockpit (H)' : 'Lower the cockpit (H)');
    el.setAttribute('aria-expanded', String(!f));
    return true;
  }
  // is a point on the mark's target (up and shown; the Calm fade hides it too)
  const shownNow = () => !!box && getComputedStyle(el).visibility !== 'hidden';
  const hit = (x, y) => shownNow() && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  // the wheel's pad: the hand cursor and the brightening over the mark, and a tap on it (moved < TAP.px, let go within TAP.ms)
  function watch(pad) {
    let cand = null;
    const hot = (on) => { el.classList.toggle('hot', !!on); pad.style.cursor = on && !cand ? 'pointer' : ''; };
    pad.addEventListener('pointermove', (e) => {
      if (cand && e.pointerId === cand.id && Math.hypot(e.clientX - cand.x, e.clientY - cand.y) >= TAP.px) { cand = null; hot(false); return; }
      if (!cand && e.pointerType !== 'touch') hot(hit(e.clientX, e.clientY));
    });
    pad.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button > 0) return;
      cand = hit(e.clientX, e.clientY) ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;   // the input's own time: a long frame between the press and its handling does not make a tap a hold
      el.classList.toggle('hot', !!cand); pad.style.cursor = '';
    });
    const end = (e) => {
      const c = cand; cand = null;
      if (!c || e.pointerId !== c.id) return;
      const tap = e.type === 'pointerup' && e.timeStamp - c.t < TAP.ms && Math.hypot(e.clientX - c.x, e.clientY - c.y) < TAP.px;
      hot(e.pointerType !== 'touch' && hit(e.clientX, e.clientY));
      if (tap && !folded) { quietUntil = performance.now() + 500; press(); }
    };
    for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, end);
    pad.addEventListener('pointerleave', () => { if (!cand) hot(false); });
  }
  return { el, strip, place, hit, watch, get box() { return box; }, get top() { return parseFloat(el.style.top) || 0; }, dispose() { el.remove(); strip.remove(); } };
}
