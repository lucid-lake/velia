// Touch input mapping, pure (tests/touch.test.mjs). The touch controls (src/ui/touchUi.js) are glass plates; the numbers
// and rules they follow live here so a test can pin them without a browser.
//
//   helmFromStrip(dx, widthPx)      the helm strip: a drag from where the finger landed, −1 (port) … +1 (starboard)
//   tackOffer({ twa, speed })       'tack' | 'gybe' | null: which manoeuvre the button offers now (twa in rad, + to starboard)
//   new TackAssist()                the manoeuvre itself: .start(kind, twa), .step(dt, twa) → the helm (−1…+1), .active
//   isCoarse(win)                   a finger is the only pointer (src/core/profile.js input 'touch'; or ?touch=1)
import { profileFor } from '../core/profile.js';
export const TOUCHUI = {
  throwFrac: 0.3,        // the strip's full helm is this share of its width of finger travel (a thumb's arc)
  dead: 0.04,            // a settled thumb is amidships
  minTargetPx: 44,       // Apple's floor for a tap target
  tackBelowDeg: 75,      // the Tack button shows while the true wind is within this of the bow ...
  gybeAboveDeg: 135,     // ... and the Gybe button beyond this (running)
  minSpeedMs: 0.6,       // a boat that is not moving cannot tack
  tackHelm: 0.9, gybeDoneDeg: 150, tackTimeoutS: 22, gybeTimeoutS: 16, easeS: 0.5,
  tackDoneDeg: 44,       // the new tack's TWA where the assist eases out (was 38: the pilot then held a pinch at ≈ 39°, 1–3 kn): ≈ 90° of turn, close-hauled to close-hauled, the sails across and drawing
};

import { clampT as clamp } from '../sim/core/math.js';
const DEG = Math.PI / 180;

export function helmFromStrip(dx, widthPx) {
  const f = clamp(dx / Math.max(1, widthPx * TOUCHUI.throwFrac), -1, 1);
  if (Math.abs(f) < TOUCHUI.dead) return 0;
  return Math.sign(f) * (0.25 * Math.abs(f) + 0.75 * f * f);   // fine near the middle, full at the stop
}

export function tackOffer({ twa = 0, speed = 0 } = {}) {
  if (!(speed >= TOUCHUI.minSpeedMs)) return null;
  const a = Math.abs(twa) / DEG;
  if (a < TOUCHUI.tackBelowDeg) return 'tack';
  if (a > TOUCHUI.gybeAboveDeg) return 'gybe';
  return null;
}

// Tack: turn toward the wind until it comes over the other bow. Gybe: turn away until the stern is through. The helm
// sign follows the true wind's side (+ = wind from starboard): upwind the bow turns toward it, downwind away from it.
export class TackAssist {
  constructor() { this.kind = null; this.side = 0; this.t = 0; this.done = 0; }
  get active() { return this.kind != null; }
  start(kind, twa) {
    if (kind !== 'tack' && kind !== 'gybe') return false;
    this.kind = kind; this.side = Math.sign(twa) || 1; this.t = 0; this.done = 0; return true;
  }
  cancel() { this.kind = null; this.done = 0; }
  step(dt, twa) {
    if (!this.kind) return 0;
    this.t += dt;
    const across = Math.sign(twa) === -this.side && Math.abs(twa) / DEG >= (this.kind === 'tack' ? TOUCHUI.tackDoneDeg : 0);
    const through = this.kind === 'tack' ? across : (Math.sign(twa) === -this.side && Math.abs(twa) / DEG <= TOUCHUI.gybeDoneDeg);
    const timeout = this.t > (this.kind === 'tack' ? TOUCHUI.tackTimeoutS : TOUCHUI.gybeTimeoutS);
    if (through || timeout) {
      this.done += dt;                                   // ease the helm out so the boat settles on the new tack
      if (this.done >= TOUCHUI.easeS) { this.cancel(); return 0; }
    }
    const dir = this.kind === 'tack' ? this.side : -this.side;
    return dir * TOUCHUI.tackHelm * (1 - clamp(this.done / TOUCHUI.easeS, 0, 1));
  }
}

// a finger is the only pointer: the device profile's input axis (src/core/profile.js; ?touch=1|0 and ?profile=input: force it)
export function isCoarse(win = globalThis) {
  try { return profileFor(win).input === 'touch'; } catch { return false; }
}

