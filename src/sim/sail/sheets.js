// Day Sail's hand on the sheets: one sheet for both sails. W (or ↑) pulls in,
// S (or ↓) eases; the sheet stays where you leave it, as a sheet on a cleat does. The crew sets the jib to match the
// main (src/boat.js, CONTROLS.sheet) and keeps flatten, reef and wing-on-wing.
// The crew's net (Day Sail only): when the sails have been wrong (luffing, or stalled forward of a beam reach) for
// netAfter seconds with your hands off the sheets, the crew trims them to their own setting at netRate, and lets go
// again the moment you touch a sheet key. A sail that draws is never touched.
// Plain JS, no DOM: tests/controls2.test.mjs.
const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';

export const HAND = {
  rate: 12 * DEG,          // rad/s pulling in with a light sheet: the winch grinds (a full pull, 80° → 12°, takes 5.7 s);
                           // under load it slows (feel.js winchRate: ≈ 6°/s at 2 kN, ≈ 4.7°/s at 2.8 kN)
  easeRate: 25 * DEG,      // rad/s easing: the sheet runs out (80° in 2.7 s)
  min: 12 * DEG, max: 80 * DEG,   // the main's sheeting range (src/boat.js BOAT.main)
  startEase: 15 * DEG,     // the boat starts with the sheets at least this much eased: the sails lift, the first W fills them
  startAoA: 0.5 * DEG,     // and eased until the main's angle of attack (the apparent wind's angle less the sheet's) is down
                           // to this: it lifts under ≈ 2.5°. The real-map start's close reach (TWA 55°, AWA ≈ 36°, the crew
                           // at 18.5°) left 2–3° at 15° eased: the sails half drawing (fill 0.71), no luff, no first hint
  netAfter: 12,            // s wrong, hands off, before the crew's net
  netRate: 8 * DEG,        // rad/s, the crew's trim
  luffFill: 0.5,           // below this the main is luffing
  stall: 0.6,              // above this mainStall the main is stalled
  stallAwa: 80 * DEG,      // the stall counts only forward of here (a run is a flat plate by nature)
  ironsTwa: 40 * DEG,      // inside this no sheet helps: not the net's job
  // a held key or a driven winch speeds up (owner, 2026-10-30: "trim must respond faster"): a tap is still a fine step
  // (the base rate for the first rampS[0]), held it rises to boost × over rampS (pulling) or easeBoost × (easing)
  boost: 2.4, easeBoost: 1.8, rampS: [0.12, 0.5],
};
import { smooth } from '../core/math.js';
// the rate's multiplier after holdS of one direction held
export const trimBoost = (holdS, dir) => 1 + ((dir < 0 ? HAND.easeBoost : HAND.boost) - 1) * smooth(HAND.rampS[0], HAND.rampS[1], holdS);

export class HandSheets {
  // netAfter: s before the crew's net (HAND.netAfter; the skill model lengthens it to 25 s, then Infinity: off)
  constructor({ sheet = null, netAfter = HAND.netAfter } = {}) { this.sheet = sheet; this.idle = 0; this.wrongFor = 0; this.crew = false; this.touched = false; this.netAfter = netAfter; this.holdS = 0; this.holdDir = 0; }

  // A direct hand on the sheet (the helm station's winch: a crank, a drag, a scroll, a step): d rad, + = in. It counts as a
  // sheet key: the crew lets go, the start's ease ends.
  nudge(d) {
    if (this.sheet == null || !d) return this.sheet;
    this.sheet = clamp(this.sheet - d, HAND.min, HAND.max);
    this.idle = 0; this.wrongFor = 0; this.crew = false; this.touched = true; this.start = false;
    return this.sheet;
  }

  // dir: +1 pull in, −1 ease, 0 hands off; dt real seconds; s the boat state (crewSheet, mainFill, mainStall,
  // apparentWind.angle, trueWind.angle); pullRate (rad/s) the winch's rate under the load now (feel.js winchRate;
  // HAND.rate when absent); easeRate (rad/s) the sheet running out (HAND.easeRate when absent: v2's desktop passes its
  // own, v2/sim/boat.js DESK_TRIM). Returns the sheet (rad) for CONTROLS.sheet.
  update(dt, dir, s, { pullRate = HAND.rate, easeRate = HAND.easeRate } = {}) {
    // the first call before the physics has ticked (mainSheet 0): the crew trims that tick; then start eased off theirs
    // the start's ease: off the crew's trim, and at least to the luff (the apparent wind's angle less startAoA)
    const startSheet = () => clamp(Math.max(s.crewSheet + HAND.startEase, Math.abs(s.apparentWind?.angle ?? 0) - HAND.startAoA), HAND.min, HAND.max);
    if (this.sheet == null) {
      if (!(s?.mainSheet > 0)) return null;
      this.sheet = startSheet();
      this.start = true;
    } else if (this.start && !dir && s?.crewSheet != null) {
      // until the first sheet key (or the crew's net) the start keeps the sails lifting as the boat settles: its first
      // ticks' trim was the crew's at the launch speed, and on the real-map start the sheet drew again within seconds
      // (sheet 24° against a crew of 15° by 2 s, 2026-10-29: no luff, no first hint)
      this.sheet = Math.max(this.sheet, startSheet());
    }
    if (dir) {
      const d = Math.sign(dir);
      this.holdS = d === this.holdDir ? this.holdS + dt : 0; this.holdDir = d;
      this.sheet = clamp(this.sheet - dir * (dir > 0 ? pullRate : easeRate) * trimBoost(this.holdS, d) * dt, HAND.min, HAND.max);
      this.idle = 0; this.wrongFor = 0; this.crew = false; this.touched = true; this.start = false;
      return this.sheet;
    }
    this.holdS = 0; this.holdDir = 0;
    this.idle += dt;
    const awa = Math.abs(s?.apparentWind?.angle ?? Math.PI), twa = Math.abs(s?.trueWind?.angle ?? Math.PI);
    const wrong = twa > HAND.ironsTwa && ((s?.mainFill ?? 1) < HAND.luffFill || ((s?.mainStall ?? 0) > HAND.stall && awa < HAND.stallAwa));
    this.wrongFor = wrong ? this.wrongFor + dt : 0;
    if (!this.crew && this.idle > this.netAfter && this.wrongFor > this.netAfter) { this.crew = true; this.start = false; }
    if (this.crew) {
      const to = clamp(s?.crewSheet ?? this.sheet, HAND.min, HAND.max);
      this.sheet += clamp(to - this.sheet, -HAND.netRate * dt, HAND.netRate * dt);
      if (Math.abs(to - this.sheet) < 0.5 * DEG) { this.crew = false; this.wrongFor = 0; }
    }
    return this.sheet;
  }
}

// The wind levels moved to the WindField (src/wind.js: WIND_LEVELS, DEFAULT_WIND_LEVEL, setLevel).
export { WIND_LEVELS, DEFAULT_WIND_LEVEL } from '../wind.js';
