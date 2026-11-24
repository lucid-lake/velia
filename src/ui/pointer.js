// The mouse and touch as a first-class hand (owner, 2026-10-29: "people won't remember all the keys").
// Two small pieces, plain JS:
//
//   classifyPress({ dx, dy, ms })   // 'click' | 'drag': under CLICK.px of travel and CLICK.ms of time is a click
//   new Press(x, y, t, button)      // one press: .move(x, y) → true once it is a drag; .end(x, y, t) → 'click' | 'drag'
//   createModality({ coarse })      // the input modality the hints read: 'mouse' | 'keys' | 'pad'; .touch and .hand add the finger
//
// The modality (for the hints, feat/mastery reads it): the 'modality' service (core.services) = { kind, pointer, since, on(fn) },
// and a window event 'lk-modality' ({ detail: { kind, pointer } }) on each change. 'mouse' means the pointer (a mouse,
// a pen or a finger: .pointer says which); 'keys' the keyboard; 'pad' a gamepad. A mouse resting on the desk does not
// The finger (owner, 2026-10-31: iOS still showed key caps): .touch is true while the last pointer was a finger, or, before
// any input, on a device whose main pointer is coarse (coarse(): touchMap.js isCoarse); a key or a pad turns it off. .hand is
// 'touch' | kind: what the hints and the Keys page word their lines by. The pointer kind itself stays 'mouse' for a finger.
// A mouse resting on the desk does not
// steal it from the keys: it takes MODALITY.movePx of travel inside MODALITY.moveS, or a press, or the wheel.
// The dock's and the pads' stand-in key events (e.lkDock, e.lkVirtual) never count as the keys.
export const CLICK = { px: 5, ms: 250 };
const MODALITY = { movePx: 24, moveS: 0.5 };

export function classifyPress({ dx = 0, dy = 0, ms = 0 } = {}) {
  return Math.hypot(dx, dy) < CLICK.px && ms < CLICK.ms ? 'click' : 'drag';
}

export class Press {
  constructor(x, y, t, button = 0) { this.x0 = x; this.y0 = y; this.t0 = t; this.button = button; this.dragging = false; this.x = x; this.y = y; }
  // true once the travel passes CLICK.px (then it stays a drag)
  move(x, y) {
    this.x = x; this.y = y;
    if (!this.dragging && Math.hypot(x - this.x0, y - this.y0) >= CLICK.px) this.dragging = true;
    return this.dragging;
  }
  end(x, y, t) {
    this.move(x, y);
    return this.dragging ? 'drag' : classifyPress({ dx: x - this.x0, dy: y - this.y0, ms: t - this.t0 });
  }
}

export function createModality({ target = globalThis, now = () => performance.now() / 1000, coarse = () => false } = {}) {
  let kind = null, pointer = null, since = 0, travel = 0, travelT = 0;
  const subs = new Set();
  const set = (k, p = pointer) => {
    if (k === kind && p === pointer) return;
    kind = k; pointer = p; since = now();
    for (const f of subs) { try { f(kind, pointer); } catch { /* a subscriber's error is its own */ } }
    try { target.dispatchEvent?.(new CustomEvent('lk-modality', { detail: { kind, pointer } })); } catch { /* no DOM (tests) */ }
  };
  const onKey = (e) => { if (!e.lkVirtual && !e.lkDock) set('keys', null); };
  const onMove = (e) => {
    if (kind === 'mouse') return;
    const t = now();
    if (t - travelT > MODALITY.moveS) travel = 0;
    travelT = t; travel += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
    if (travel >= MODALITY.movePx) set('mouse', e.pointerType || 'mouse');
  };
  const onDown = (e) => set('mouse', e.pointerType || 'mouse');
  const onWheel = () => set('mouse', pointer ?? 'mouse');
  target.addEventListener?.('keydown', onKey);
  target.addEventListener?.('pointermove', onMove);
  target.addEventListener?.('pointerdown', onDown);
  target.addEventListener?.('wheel', onWheel, { passive: true });
  return {
    get kind() { return kind; }, get pointer() { return pointer; }, get since() { return since; },
    get touch() { return kind === 'mouse' ? pointer === 'touch' : kind === null ? !!coarse() : false; },
    get hand() { return this.touch ? 'touch' : kind; },
    set,                                   // the controls report the pad (pads.js has no window event of its own)
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    dispose() {
      target.removeEventListener?.('keydown', onKey); target.removeEventListener?.('pointermove', onMove);
      target.removeEventListener?.('pointerdown', onDown); target.removeEventListener?.('wheel', onWheel);
      subs.clear();
    },
  };
}
