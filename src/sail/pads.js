// Day Sail's other hands: a gamepad and touch. They feed the same two verbs as the keys, the helm and
// the sheet, as analog values: steer −1 (port) … +1 (starboard), pull −1 (ease) … +1 (pull in). The controls add them
// to the keys' own (controls.js).
//
// Gamepad (the Gamepad API's standard mapping): the left stick's x the helm (dead zone 0.12, a cubic curve); RT pulls
// in, LT eases (the hauling hand; RT read as gas is answered by the luff on release); d-pad up / down the wind level;
// Y the boat from above (a tap; held 0.5 s, the helm view and back, as C); X the helm view too; the right stick looks; Menu held
// the keys list; View the logbook. The captain's tools (2026-10-29): the left stick's click held (≥ 0.25 s), the
// binoculars (the right stick aims them; the pilot holds the course); a tap of it, the VHF's weather channel (as B and
// O; keys.js PADMAP). R3 is the chart's (chartplotter.js).
// Pro mode (controls.js reads state.pro; basic ignores it): d-pad ←/→ the traveller (down / up), LB / RB the twist
// (open / close), A held with d-pad ←/→ the jib lead (forward / aft), B held with d-pad ←/→ the backstay (ease / on).
// Touch: the left half is the helm, a tiller: drag sideways from where the finger landed. The right half is the sheet,
// a rope: drag down toward you to pull in, up to ease, at most the winch's rate; a finger held still holds the sheet.
// Two fingers on the open water: drag looks round, pinch zooms (src/ui/touchLook.js); the wind level is the top bar's. Nothing within 24 px of the bottom edge (the phone's own swipe).
// ?lefty=1 mirrors the halves. On a phone the glass helm strip and the Tack button (src/ui/touchUi.js) add to the same helm
// through pads.ext ({ steer, on }); the canvas gestures stay.
//
// For the quiet hints, both send the keyboard events they stand for (marked e.lkVirtual, so controls.js ignores them
// and the hints see them as used); the gamepad's Menu and View send H and L as the keys do.
//
// Pure mappings (stickCurve, triggerPull, TouchSheet) are exported for tests/controls2.test.mjs.

import { TwoFinger } from '../ui/touchLook.js';
import { toFlags } from '../sim/core/flags.js';

export const PAD = { holdL3: 0.25, dead: 0.12, trigDead: 0.06, holdY: 0.5, look: 2.2, hintOn: 0.3, hintOff: 0.2 };
export const TOUCH = { edgePx: 24, helmFrac: 0.12, ropeFrac: 0.25, tapS: 0.3, tapPx: 14 };

// the left stick → the helm: a dead zone, then a cubic (fine near the middle, full at the stop)
export function stickCurve(x, dead = PAD.dead) {
  const a = Math.abs(x);
  if (!(a > dead)) return 0;
  const u = Math.min(1, (a - dead) / (1 - dead));
  return Math.sign(x) * (0.35 * u + 0.65 * u * u * u);
}
// the triggers → the sheet: RT pulls in, LT eases (each 0..1 with a small dead zone)
export function triggerPull(rt, lt, dead = PAD.trigDead) {
  const f = (v) => (v > dead ? (v - dead) / (1 - dead) : 0);
  return Math.max(-1, Math.min(1, f(rt ?? 0) - f(lt ?? 0)));
}

// The rope under the finger: each move adds its drag (px, + down); each frame hauls what it can at the winch's rate
// (fullPxS px/s is the full rate) and carries the rest, so a quick drag hauls in steadily, as a winch does.
export class TouchSheet {
  constructor(fullPxS = 200) { this.full = fullPxS; this.acc = 0; }
  drag(dy) { this.acc += dy; }
  update(dt) {
    if (!(dt > 0)) return 0;
    const pull = Math.max(-1, Math.min(1, this.acc / (dt * this.full)));
    this.acc -= pull * dt * this.full;
    if (Math.abs(this.acc) < 0.5) this.acc = 0;
    return pull;
  }
  release() { this.acc = 0; }
}

const fire = (type, code, virtual = true) => {
  const e = new KeyboardEvent(type, { code, key: code.replace(/^Key|^Digit/, '') });
  if (virtual) e.lkVirtual = true;
  dispatchEvent(e);
};

// Both inputs. on: { level(n) → set the wind level, levelNow() → the level, glyph() → V, view() → C, look(dx, dy) }.
export function createPads({ canvas, flags, signal, on }) {
  const lefty = toFlags(flags).lefty;
  const state = { steer: 0, pull: 0, active: false, kind: null, bino: false };
  // the hints' virtual keys: a key is down while its axis is past hintOn, up when back under hintOff
  const vdown = new Set();
  const vkey = (code, val) => {
    if (!vdown.has(code) && val > PAD.hintOn) { vdown.add(code); fire('keydown', code); }
    else if (vdown.has(code) && val < PAD.hintOff) { vdown.delete(code); fire('keyup', code); }
  };

  // ---- gamepad ----
  let prev = [], yAt = null, yHeld = false, menuDown = false, bino = false, l3At = null;
  const button = (gp, i) => gp.buttons[i]?.value ?? (gp.buttons[i]?.pressed ? 1 : 0);
  function pollPad(dt) {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected);
    if (!gp) { bino = false; return { steer: 0, pull: 0, on: false }; }
    const b = gp.buttons.map((x) => x.pressed), was = (i) => prev[i] ?? false, edge = (i) => b[i] && !was(i);
    if (edge(12)) on.level?.(Math.min(4, (on.levelNow?.() ?? 3) + 1));
    if (edge(13)) on.level?.(Math.max(1, (on.levelNow?.() ?? 3) - 1));
    if (edge(12) || edge(13)) { const n = on.levelNow?.() ?? 3; fire('keydown', `Digit${n}`); fire('keyup', `Digit${n}`); }
    // Y: a tap the glyph, held the view
    if (edge(3)) { yAt = 0; yHeld = false; }
    if (b[3] && yAt != null) { yAt += dt; if (!yHeld && yAt >= PAD.holdY) { yHeld = true; on.view?.(); } }
    if (!b[3] && was(3) && yAt != null) { if (!yHeld) on.glyph?.(); yAt = null; }
    if (edge(2)) on.view?.();
    if (b[9] && !menuDown) { menuDown = true; fire('keydown', 'KeyH', false); }
    if (!b[9] && menuDown) { menuDown = false; fire('keyup', 'KeyH', false); }
    if (edge(8)) { fire('keydown', 'KeyL', false); fire('keyup', 'KeyL', false); }
    // L3 (the left stick's click; R3 is the chart's): held past PAD.holdL3 the binoculars (up while held), a tap the VHF
    if (edge(10)) l3At = 0;
    if (b[10] && l3At != null) l3At += dt;
    bino = !!b[10] && l3At != null && l3At >= PAD.holdL3;
    if (!b[10] && was(10) && l3At != null) { if (l3At < PAD.holdL3) on.vhf?.(); l3At = null; }
    const lx = stickCurve(gp.axes[2] ?? 0), ly = stickCurve(gp.axes[3] ?? 0);
    if (lx || ly) on.look?.(lx * PAD.look * dt, ly * PAD.look * 0.8 * dt);
    prev = b;
    const steer = stickCurve(gp.axes[0] ?? 0), pull = triggerPull(button(gp, 7), button(gp, 6));
    // pro: the d-pad's ←/→ is the traveller, or with A / B held the jib lead / the backstay; the shoulders the twist
    const lr = (b[15] ? 1 : 0) - (b[14] ? 1 : 0);
    const pro = { trav: b[0] || b[1] ? 0 : lr, lead: b[0] ? lr : 0, backstay: b[1] ? lr : 0, twist: (b[4] ? 1 : 0) - (b[5] ? 1 : 0) };
    return { steer, pull, pro, on: steer !== 0 || pull !== 0 || b.some(Boolean) };
  }

  // ---- touch ----
  const touches = new Map();   // pointerId → { side, x0, y0, x, y, t0, moved }
  const rope = new TouchSheet();
  let helm = 0, multi = null, tNow = 0;
  const two = new TwoFinger();
  if (canvas) {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.clientY > innerHeight - TOUCH.edgePx) return;
      e.preventDefault();
      const left = e.clientX < innerWidth / 2;
      touches.set(e.pointerId, { side: left !== lefty ? 'helm' : 'sheet', x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: tNow, moved: 0 });
      two.down(e.pointerId, e.clientX, e.clientY);
      if (touches.size === 2) multi = { t0: tNow };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* a synthetic or already-gone pointer */ }
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      const f = touches.get(e.pointerId); if (!f) return;
      const g = two.move(e.pointerId, e.clientX, e.clientY);
      if (g) { on.look?.(g.look[0], g.look[1]); if (g.zoom !== 1) on.zoom?.(g.zoom); }
      const dx = e.clientX - f.x, dy = e.clientY - f.y;
      f.moved += Math.abs(dx) + Math.abs(dy); f.x = e.clientX; f.y = e.clientY;
      if (f.side === 'sheet' && touches.size === 1) rope.drag(dy * 200 / (TOUCH.ropeFrac * innerHeight));
    }, { signal });
    const up = (e) => {
      const f = touches.get(e.pointerId); if (!f) return;
      touches.delete(e.pointerId); two.up(e.pointerId);
      if (touches.size === 0) multi = null;
      if (f.side === 'sheet') rope.release();
    };
    canvas.addEventListener('pointerup', up, { signal });
    canvas.addEventListener('pointercancel', up, { signal });
  }
  function pollTouch(dt) {
    if (!touches.size) { helm = 0; return { steer: 0, pull: 0, on: false }; }
    if (multi) return { steer: 0, pull: 0, on: true };   // two fingers: the camera's, not the helm
    let steer = 0;
    for (const f of touches.values()) if (f.side === 'helm') steer = Math.max(-1, Math.min(1, (f.x - f.x0) / (TOUCH.helmFrac * innerWidth)));
    helm = steer;
    return { steer, pull: rope.update(dt), on: true };
  }

  // the on-screen helm strip and the tack button (src/ui/touchUi.js): a third hand on the same helm
  const ext = { steer: 0, on: false };
  function update(dt) {
    tNow += dt;
    const g = pollPad(dt), t = pollTouch(dt);
    state.steer = Math.max(-1, Math.min(1, g.steer + t.steer + ext.steer));
    state.pull = Math.max(-1, Math.min(1, g.pull + t.pull));
    state.bino = bino;
    state.active = g.on || t.on || ext.on; state.kind = t.on || ext.on ? 'touch' : g.on ? 'pad' : null;
    state.pro = g.pro ?? null;   // pro mode's four controls (the gamepad only)
    vkey('KeyD', state.steer); vkey('KeyA', -state.steer); vkey('KeyW', state.pull); vkey('KeyS', -state.pull);
    return state;
  }
  return { update, state, ext, get helm() { return helm; } };
}
