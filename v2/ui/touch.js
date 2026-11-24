// A phone's hands (M3): a helm strip along the bottom (a finger drags the knob sideways from where it lands: v1's
// touch helm, TOUCH.helmFrac of the width for a full turn; let go and the pilot holds the course) and two sheet buttons
// on the right (IN pulls while held, EASE lets out), plain navy and cream (the brand), nothing within the
// phone's own bottom swipe band. Shown on a coarse pointer or with ?touch=1; the cockpit and its 3D controls are M4.
// Also the pointer on the canvas, v1's deck (src/deck/index.js) and touch look (src/ui/touchLook.js): a press is a click
// until it travels 5 px (v1's Press), then a drag, with any mouse button (the right one too: no context menu); the drag
// looks, the follow camera's orbit in the follow view and the helm camera's look in the helm view (sim/controls.js
// routeLook, in v2/sim/boat.js camera()); the wheel zooms (the follow camera's distance, the helm view's lens); two fingers
// drag to look and pinch to zoom (v1's TwoFinger). One finger is v1's (src/sail/pads.js, BACKLOG-v2 #2): the left half of the
// canvas is the helm, a tiller (drag sideways from where the finger landed, full at TOUCH.helmFrac of the width); the right
// half is the sheet, a rope (drag down to pull in, up to ease: each move's px × 200 / (ropeFrac × the height) into v1's
// TouchSheet, hauled at most at the winch's rate, a finger held still holds the sheet); a second finger turns both off until
// every finger is up (the look's and the pinch's); nothing within edgePx of the bottom edge (the phone's own swipe); ?lefty=1
// mirrors the halves. The station's controls are DOM above the canvas (v2/ui/station.js), so a press on them never reaches it.
//   const hands = createTouch({ canvas, host, show, lefty });  each frame: const { steer, pull, orbit, zoom } = hands.read(dt)
//   orbit: the frame's look [dx, dy] rad, [0, 0] while a drag is held still, null with no drag
import { helmFromDrag, orbitFromDrag, zoomFromWheel } from '../sim/controls.js';
import { Press } from '../../src/ui/pointer.js';
import { TwoFinger } from '../../src/ui/touchLook.js';
import { TOUCH as V1_TOUCH, TouchSheet } from '../../src/sail/pads.js';

export const TOUCH = Object.freeze({ helmFrac: V1_TOUCH.helmFrac, ropeFrac: V1_TOUCH.ropeFrac, edgePx: V1_TOUCH.edgePx });
// one finger's helm (v1 pads.js pollTouch): its offset from where it landed, full at helmFrac of the width
export const tillerFromDrag = (dx, w) => helmFromDrag(dx, TOUCH.helmFrac * w);
// one move of the rope finger (+ down) → v1's TouchSheet drag (its full rate is 200 px/s)
export const ropeDrag = (dy, h) => dy * 200 / (TOUCH.ropeFrac * h);

// oneLook(): a phone's flat controls (v2/ui/flat.js): one finger on the water looks round (the follow camera's orbit)
// instead of the tiller and the rope; it moves only past LOOK_SLOP_PX, so a tap (the double-tap mark) never turns the camera
export const LOOK_SLOP_PX = 6;
export function createTouch({ canvas, host = document.body, show = false, lefty = false, oneLook = () => false } = {}) {
  const state = { steer: 0, pull: 0, orbitX: 0, orbitY: 0, zoom: 1, active: false };
  const fingers = new Map(), rope = new TouchSheet();   // pointerId → { side, x0, x, y } (v1 pads.js touches)
  let multi = false;
  let el = null;
  if (show) {
    el = document.createElement('div'); el.id = 'hands';
    el.innerHTML = `<div class="helm" data-helm><div class="track"><div class="knob"></div></div><span class="lbl">helm</span></div>
<div class="sheet"><button class="btn" data-pull="1" type="button">IN</button><button class="btn" data-pull="-1" type="button">EASE</button><span class="lbl">sheet</span></div>`;
    host.appendChild(el);
    const knob = el.querySelector('.knob'), helm = el.querySelector('[data-helm]');
    // the helm: one finger on the strip, the knob follows the drag from where it landed
    let hid = null, hx0 = 0;
    const full = () => TOUCH.helmFrac * innerWidth;
    helm.addEventListener('pointerdown', (e) => { hid = e.pointerId; hx0 = e.clientX; helm.setPointerCapture?.(e.pointerId); el.classList.add('on'); e.preventDefault(); });
    helm.addEventListener('pointermove', (e) => { if (e.pointerId !== hid) return; state.steer = helmFromDrag(e.clientX - hx0, full()); knob.style.transform = `translateX(${(state.steer * 44).toFixed(1)}px)`; });
    const hup = (e) => { if (e.pointerId !== hid) return; hid = null; state.steer = 0; knob.style.transform = ''; el.classList.remove('on'); };
    helm.addEventListener('pointerup', hup); helm.addEventListener('pointercancel', hup);
    // the sheet buttons: held
    for (const b of el.querySelectorAll('[data-pull]')) {
      const v = parseFloat(b.dataset.pull);
      const down = (e) => { state.pull = v; b.classList.add('held'); e.preventDefault(); };
      const up = () => { if (state.pull === v) state.pull = 0; b.classList.remove('held'); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
  }
  // the camera on the canvas: a mouse drag looks, the wheel zooms; two fingers look and pinch
  let press = null, last = null, dragging = false;
  const two = new TwoFinger();
  if (canvas) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());   // v1: the right button drags too
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        if (e.clientY > innerHeight - TOUCH.edgePx) return;   // the phone's own swipe band
        e.preventDefault();
        const left = e.clientX < innerWidth / 2;
        fingers.set(e.pointerId, { side: oneLook() ? 'look' : left !== lefty ? 'helm' : 'sheet', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false });
        two.down(e.pointerId, e.clientX, e.clientY);
        if (fingers.size >= 2) multi = true;   // two fingers: the camera's, not the helm (v1), until every finger is up
      } else { press = new Press(e.clientX, e.clientY, performance.now(), e.button); press.id = e.pointerId; last = [e.clientX, e.clientY]; }
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* a synthetic or gone pointer */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        const f = fingers.get(e.pointerId); if (!f) return;
        const g = two.move(e.pointerId, e.clientX, e.clientY);
        if (g) { dragging = true; state.orbitX += g.look[0]; state.orbitY += g.look[1]; if (g.zoom !== 1) state.zoom *= g.zoom; }
        const dx = e.clientX - f.x, dy = e.clientY - f.y; f.x = e.clientX; f.y = e.clientY;
        if (f.side === 'look' && fingers.size === 1 && !multi) {
          if (!f.moved && Math.hypot(f.x - f.x0, f.y - f.y0) < LOOK_SLOP_PX) return;
          const [ox, oy] = f.moved ? orbitFromDrag(dx, dy) : orbitFromDrag(f.x - f.x0, f.y - f.y0);
          f.moved = true; dragging = true; state.orbitX += ox; state.orbitY += oy;
          return;
        }
        if (f.side === 'sheet' && fingers.size === 1) rope.drag(ropeDrag(dy, innerHeight));
        return;
      }
      if (!press || e.pointerId !== press.id) return;
      const was = press.dragging;
      if (!press.move(e.clientX, e.clientY)) return;
      dragging = true;
      // the first move past the threshold carries the travel so far, so the look starts where the hand did (v1)
      const [ox, oy] = was ? orbitFromDrag(e.clientX - last[0], e.clientY - last[1]) : orbitFromDrag(e.clientX - press.x0, e.clientY - press.y0);
      state.orbitX += ox; state.orbitY += oy; last = [e.clientX, e.clientY];
    });
    const end = (e) => {
      const f = fingers.get(e.pointerId);
      if (f) { fingers.delete(e.pointerId); two.up(e.pointerId); if (!fingers.size) multi = false; if (f.side === 'sheet') rope.release(); }
      if (press && e.pointerId === press.id) press = null;
      dragging = !!press?.dragging || fingers.size >= 2 || [...fingers.values()].some((q) => q.side === 'look' && q.moved);
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { state.zoom *= zoomFromWheel(e.deltaY); e.preventDefault(); }, { passive: false });
  }
  return {
    el, state, get fingers() { return fingers.size; }, get multi() { return multi; },
    // this frame's hands (dt: the frame's real seconds, the rope's haul); the orbit and zoom are consumed
    read(dt = 0) {
      // one finger: the tiller and the rope (v1 pads.js pollTouch), added to the strip's helm and the sheet buttons
      let tiller = 0, haul = 0;
      if (fingers.size && !multi) {
        for (const f of fingers.values()) if (f.side === 'helm') tiller = tillerFromDrag(f.x - f.x0, innerWidth);
        haul = rope.update(dt);
      } else if (!fingers.size) rope.release();
      const steer = Math.max(-1, Math.min(1, state.steer + tiller)), pull = Math.max(-1, Math.min(1, state.pull + haul));
      const o = { steer, pull, tiller, haul, orbit: dragging || state.orbitX || state.orbitY ? [state.orbitX, state.orbitY] : null, zoom: state.zoom !== 1 ? state.zoom : 0, active: dragging || steer !== 0 || pull !== 0 || fingers.size > 0 };
      state.orbitX = 0; state.orbitY = 0; state.zoom = 1;
      return o;
    },
  };
}

export const TOUCH_CSS = `
#hands { position: fixed; left: 0; right: 0; bottom: 0; height: 150px; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--cream); }
#hands .lbl { position: absolute; left: 0; right: 0; bottom: -18px; text-align: center; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }
#hands .helm { position: absolute; left: 50%; bottom: 44px; width: 220px; height: 44px; margin-left: -110px; pointer-events: auto; touch-action: none; }
#hands .track { position: absolute; inset: 0; border-radius: 22px; background: rgba(28, 35, 64, 0.82); border: 1px solid rgba(239, 230, 210, 0.25); }
#hands .track::before { content: ""; position: absolute; left: 50%; top: 10px; bottom: 10px; width: 1px; background: rgba(239, 230, 210, 0.35); }
#hands .knob { position: absolute; left: 50%; top: 4px; width: 36px; height: 36px; margin-left: -18px; border-radius: 50%; background: rgba(239, 230, 210, 0.92); box-shadow: 0 1px 3px rgba(6, 12, 18, 0.4); transition: transform 0.05s linear; }
#hands.on .knob { background: #efe6d2; }
#hands .sheet { position: absolute; right: 16px; bottom: 44px; width: 64px; height: 110px; display: grid; grid-template-rows: 1fr 1fr; gap: 6px; pointer-events: auto; touch-action: none; }
#hands .btn { border-radius: 10px; border: 1px solid rgba(239, 230, 210, 0.25); background: rgba(28, 35, 64, 0.82); color: var(--cream); font: 600 13px/1 system-ui, sans-serif; letter-spacing: 0.08em; padding: 0; -webkit-tap-highlight-color: transparent; }
#hands .btn.held { background: rgba(239, 230, 210, 0.92); color: #1c2340; }
`;
