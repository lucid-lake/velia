// The left panel on the in-game map hides like a dock (2026-11-25): in the menu over the live lake (desktop and tablet, the panel
// layout), the panel slides out past the left edge 3 s after the pointer left it for the map (only once the pointer has been on the
// map since the menu opened; never while a plate is open), and slides back when the pointer touches the left edge, Tab moves the
// focus into it, or (a finger, no hover) a tap lands on the edge's 16 px. The map takes the whole width while it is out. Behaviour only: its colours stay the panel's own (the glass rollout's).
//   const dock = mountPanelDock({ root, card, chart, touch, active })   dock.hidden, dock.show(), dock.step(dt) (tests), dock.dispose()
//   createDockState({ delayS })   the pure rule: step(dt, { over, map, edge, plate, active }) → hidden
export const DOCK = Object.freeze({ delayS: 3, edgePx: 6, tapPx: 16, slideS: 0.3 });

export function createDockState({ delayS = DOCK.delayS } = {}) {
  let hidden = false, idle = 0;
  return {
    get hidden() { return hidden; },
    show() { hidden = false; idle = 0; },
    step(dt, { over = false, map = true, edge = false, plate = false, active = true } = {}) {
      if (!active || over || !map || plate || edge) { if (edge || !active) hidden = false; idle = 0; return hidden; }
      idle += Math.max(0, dt);
      if (idle >= delayS) hidden = true;
      return hidden;
    },
  };
}

const P = 'html[data-map-card=panel] #lk-load:not([data-pg])';
const CSS = `${P}[data-state=menu] .lk-card{transition:transform ${DOCK.slideS}s cubic-bezier(.2,0,0,1),opacity .4s var(--lk-ease)}
${P}[data-state=menu][data-dock=out] .lk-card{transform:translateX(calc(-100% - 12px))!important;pointer-events:none}`;

export function mountPanelDock({ root, card = () => root?.querySelector('.lk-card'), chart = null, touch = () => false, active = () => true, win = globalThis, doc = globalThis.document } = {}) {
  if (!root) return null;
  if (!doc.getElementById('lk-paneldock-css')) { const st = doc.createElement('style'); st.id = 'lk-paneldock-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const S = createDockState();
  let over = false, edge = false, raf = 0, last = 0, was = false, map = false, kbd = false, open = false;
  const insets = (out) => { const l = out ? 0 : (card()?.offsetWidth ?? 0); root.querySelector('.lk-livechart')?.style.setProperty('--lk-panel-in', `${l}px`); chart?.setInsets?.({ left: l }); };
  const onMove = (e) => {
    const c = card(); over = !!c && c.contains(e.target);
    if (!over && root.querySelector('.lk-livechart')?.contains(e.target)) map = true;   // the pointer on the map: the panel may go
    edge = e.clientX <= DOCK.edgePx;
    kbd = false;
  };
  const onDown = (e) => { if (S.hidden && (touch() || e.pointerType === 'touch') && e.clientX <= DOCK.tapPx) { edge = true; e.stopPropagation(); e.preventDefault(); } };
  const onKey = (e) => { if (e.key === 'Tab') kbd = true; };
  const onFocus = () => { if (kbd && card()?.contains(doc.activeElement)) S.show(); };   // Tab into the panel brings it back (a focus set by the page does not)
  doc.addEventListener('pointermove', onMove, { passive: true, capture: true });   // capture: the map's own handlers stop the bubble
  doc.addEventListener('pointerdown', onDown, { capture: true });
  doc.addEventListener('focusin', onFocus); doc.addEventListener('keydown', onKey, true);
  function step(dt) {
    const on = !!active() && root.dataset.state === 'menu' && !root.hasAttribute('data-off') && !root.dataset.pg;
    if (on && !open) { map = false; over = false; }   // a fresh menu: the panel shows until the pointer goes to the map
    open = on;
    const hidden = S.step(dt, { over, map, edge, plate: !!root.querySelector('.lk-cond:not([hidden])'), active: on });
    edge = false;
    if (hidden !== was) { was = hidden; if (hidden) root.dataset.dock = 'out'; else delete root.dataset.dock; insets(hidden); }
    return hidden;
  }
  function frame(now) { raf = win.requestAnimationFrame(frame); const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now; step(dt); }
  raf = win.requestAnimationFrame?.(frame) ?? 0;
  return {
    get hidden() { return S.hidden; },
    get state() { return { over, map, open, hidden: S.hidden }; },
    show() { S.show(); step(0); },
    step,
    dispose() { win.cancelAnimationFrame?.(raf); doc.removeEventListener('pointermove', onMove, { capture: true }); doc.removeEventListener('pointerdown', onDown, { capture: true }); doc.removeEventListener('focusin', onFocus); doc.removeEventListener('keydown', onKey, true); delete root.dataset.dock; },
  };
}
