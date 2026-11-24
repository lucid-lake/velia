// Cruise's gamepad cameras (owner, 2026-10-30; CRUISE_PADMAP in src/sail/keys.js): Y a tap steps to the next camera, held
// 0.5 s picks the helm camera; the d-pad's left / right the previous / next. Pure: feed it the pressed flags each frame.
import { CRUISE_PAD_HOLD_S } from '../../sail/keys.js';

export class PadCam {
  constructor(holdS = CRUISE_PAD_HOLD_S) { this.holdS = holdS; this.prev = []; this.yAt = null; this.yHeld = false; }
  // pressed: boolean per standard button (or [] with no pad). Returns the actions this frame: 'next' | 'prev' | 'helm'.
  update(dt, pressed = []) {
    const out = [], b = (i) => !!pressed[i], was = (i) => !!this.prev[i];
    if (b(3) && !was(3)) { this.yAt = 0; this.yHeld = false; }
    if (b(3) && this.yAt != null) { this.yAt += dt; if (!this.yHeld && this.yAt >= this.holdS) { this.yHeld = true; out.push('helm'); } }
    if (!b(3) && was(3) && this.yAt != null) { if (!this.yHeld) out.push('next'); this.yAt = null; }
    if (b(14) && !was(14)) out.push('prev');
    if (b(15) && !was(15)) out.push('next');
    this.prev = pressed.map(Boolean);
    return out;
  }
}
