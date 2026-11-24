// A beginner's tack carries through (fix/tack-wind, 2026-11-04). Plain JS, no DOM: tests/tackCarry.test.mjs.
//
// The stall it fixes: a player holds or taps A (or D) to tack. The bow comes up, the sails luff and the boat slows. A
// tap let go inside the no-go zone left the pilot holding the heading it was let go on, head to wind: the boat stopped
// dead in irons (≈ 0.6 kn on an outside test). A held key got through only slowly: the rudder's grip falls with the
// square of the speed, and with the sheet left eased the new tack's sails fill late.
// A real boat carries her way through the eye of the wind, and a helmsman who has started a tack finishes it. So:
//   1. Commit. The bow turns toward the wind with the helm in hand (the key, the stick, the wheel, the Tack button) and
//      goes deeper than CARRY.commitDeg off the wind (or across it), with at least CARRY.minKn of way when it came into
//      the no-go zone. From then the turn is the helmsman's, kept: let go and the helm stays over at CARRY.helm until
//      the new tack's sails can draw (CARRY.doneDeg on the other side), then eases out and the pilot holds that course.
//      Steering the other way cancels it (an aborted tack is a choice).
//   2. The crew backs the jib. Past head to wind with the turn slowing (under CARRY.backKn of way, or the bow turning
//      slower than CARRY.backYawDeg per second), the crew holds the jib to windward until CARRY.backOutDeg: the wind on
//      its back pushes the bow round. The old way of getting a slow tack through (and out of irons: Cruise's navigator
//      does the same, src/modes/chill/navigator.js).
//   3. The quiet hint. While the bow is in the no-go zone and still turning toward the new tack, keep (±1) says which
//      way: the hint line's "keep turning" (controlsHint.js). A boat stopped head to wind is in irons: that line says how
//      to get out.
// Physics is untouched: the boat model (src/boat.js) is the same for everyone. A slow boat (under CARRY.minKn of way at
// the turn) gets no carry and can still stall head to wind, as a real one does; under CARRY.ironsKn it is in irons, and
// the irons line says how out (bear away; the crew backs the jib). Pro turns the carry off (enabled false): the helm and
// the jib are the player's.
//   const c = new TackCarry(); const o = c.update(dt, { steer, twa, sog, yawRate, enabled });
//   o.helm: null (the player's or the pilot's helm) or −1…+1 (the carry's); o.jibSide: 0 or ±1 (CONTROLS.jibSide);
//   o.keep: 0 or ±1 (the direction to keep turning, + = starboard); o.done: true on the frame it hands back
const DEG = Math.PI / 180;
const KN = 0.514444;
import { clampT as clamp } from '../core/math.js';

export const CARRY = {
  minKn: 3,          // kn of way at the turn's start that carries a boat through the wind (a real boat's carry)
  goKn: 2.8,           // kn: and still this much at the commit (taps that let the boat bleed its way off get no carry)
  ironsKn: 1.5,      // kn: under this, head to wind, the boat is in irons (the irons line)
  enterDeg: 42,      // |TWA| under this: the bow is in the no-go zone
  commitDeg: 32,     // |TWA| under this with the helm toward the wind (or the bow across it): the tack is committed
  holdDeg: 40,       // the pilot never holds a heading closer than this to the wind (a let-go bow inside it bears away to it)
  doneDeg: 42,       // the new tack's close-hauled angle: the sails draw, the carry eases out
  helm: 0.85,        // the helm the carry keeps over (−1…+1 of the rudder's 25°)
  easeS: 0.6,        // s to ease the helm out at the end
  timeoutS: 25,      // s (real): a tack that never makes it gives the helm back
  stopKn: 0.5, stopS: 3,   // or sooner: stopped (under stopKn, the bow not turning) for stopS before head to wind: in irons
  backKn: 2.2, backYawDeg: 4, backOutDeg: 30,   // the crew backs the jib past head to wind when the turn slows, until this
  keepYawDeg: 0.5,   // °/s: the bow still turning toward the new tack (the keep-turning line)
  wayS: 3,           // s: the way remembered from before the bow came into the no-go zone
};

export class TackCarry {
  constructor(P = CARRY) { this.P = P; this.side = 0; this.committed = false; this.t = 0; this.ease = 0; this.way = 0; this.wayAt = 0; this.inNogo = false; this.out = { helm: null, jibSide: 0, keep: 0, done: false, committed: false }; }
  get active() { return this.committed; }
  cancel() { this.committed = false; this.side = 0; this.ease = 0; this.t = 0; }

  // dt real s; steer the player's helm (−1…+1, any hand; the Tack button's assist counts); twa rad (+ = from starboard);
  // sog m/s; yawRate rad/s (+ = to starboard); enabled false: no carry, no backing (Pro), the keep line still reads
  update(dt, { steer = 0, twa = 0, sog = 0, yawRate = 0, enabled = true } = {}) {
    const P = this.P, a = Math.abs(twa), kn = sog / KN, ws = Math.sign(twa) || 1;
    const out = { helm: null, jibSide: 0, keep: 0, done: false, committed: false };
    // the way before the turn: the best speed of the last wayS seconds outside the no-go zone, frozen inside it
    if (a >= P.enterDeg * DEG) {
      this.inNogo = false;
      this.wayAt += dt;
      if (kn >= this.way || this.wayAt > P.wayS) { this.way = kn; this.wayAt = 0; }
      if (!this.committed) this.side = ws;
    } else if (!this.inNogo) { this.inNogo = true; if (!this.side) this.side = ws; }
    const st = Math.abs(steer) > 0.05 ? Math.sign(steer) : 0;
    const side = this.side || ws;
    const across = ws === -side;                         // the bow is through the eye of the wind
    // a tack turns the bow toward the wind's side: wind from port (side −1) is a turn to port (steer −1)
    const deep = a < P.commitDeg * DEG || across;
    if (!this.committed && enabled && st === side && deep && this.way >= P.minKn && kn >= P.goKn) {
      this.committed = true; this.t = 0; this.ease = 0; this.stopT = 0;
    }
    if (this.committed) {
      this.t += dt;
      if (st === -side || !enabled) { this.cancel(); this.out = out; return out; }   // the helm put back the other way: an aborted tack
      const made = across && a >= P.doneDeg * DEG;
      this.stopT = !across && kn < P.stopKn && Math.abs(yawRate) < P.keepYawDeg * DEG ? (this.stopT ?? 0) + dt : 0;
      if (made || this.t > P.timeoutS || this.stopT > P.stopS || (a >= P.enterDeg * DEG && !across)) this.ease += dt;   // made it, gave up, or fell back off the old side
      if (this.ease >= P.easeS) { this.cancel(); out.done = true; this.side = ws; this.out = out; return out; }
      out.committed = true;
      if (!st) out.helm = side * P.helm * (1 - clamp(this.ease / P.easeS, 0, 1));
      // the crew backs the jib past head to wind when the turn slows: the clew to windward (the new tack's wind side)
      if (across && a < P.backOutDeg * DEG && (kn < P.backKn || Math.abs(yawRate) < P.backYawDeg * DEG)) out.jibSide = ws;
    }
    // in irons (no carry): the helm put over to bear away, the crew backs the jib to the other side (its wind pushes the
    // bow the helm's way; Cruise's navigator does the same); hands off, the jib draws again
    else if (enabled && st && inIrons(twa, sog, P)) out.jibSide = -st;
    // the keep-turning line: the bow in the no-go zone, turning toward the new tack (the carry's, or a held helm)
    if (a < P.enterDeg * DEG && !(across && a >= P.doneDeg * DEG) && Math.sign(yawRate) === side && Math.abs(yawRate) > P.keepYawDeg * DEG && (this.committed || st === side)) out.keep = side;
    this.out = out;
    return out;
  }
}

// The pilot's course when the helm is let go on heading (rad) at twa: never closer to the wind than CARRY.holdDeg, so
// a bow let go head to wind bears away onto the side the wind is on instead of being held there, in irons.
// tws: the true wind's speed (m/s); none yet (the physics has not ticked) leaves the heading as it is.
export function pilotHeading(heading, twa, tws = 1, P = CARRY) {
  if (!(tws > 0) || Math.abs(twa) >= P.holdDeg * DEG) return heading;
  const from = heading + twa, ws = Math.sign(twa) || 1;
  const h = from - ws * P.holdDeg * DEG;
  return h - 2 * Math.PI * Math.round(h / (2 * Math.PI));
}

// in irons: head to wind (inside the no-go zone) and under CARRY.ironsKn
export const inIrons = (twa, sog, P = CARRY) => Math.abs(twa) < P.commitDeg * DEG && sog / KN < P.ironsKn;
