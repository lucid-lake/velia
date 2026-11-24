// Let fly (feat/let-fly): throw a sheet off its winch so the sail flogs and spills all its wind. A sailor's
// way to stop a keelboat: the jib let fly with the main in, she rounds up into the wind and stops; both let fly, she lies
// across the wind and drifts. The physics already does it while a sheet stays out (src/boat.js: the main's sheet at its
// stop, the jib's clew free with c.jibFree); this is the hand's side: which sheet is free, how it comes back, and the
// skipper's first word on it. Plain JS, no DOM (tests/letFly.test.mjs); src/sail/controls.js does the plumbing.
//
//   const fly = new LetFly({ storage, once });
//   fly.toggle('jib', before)     // a click on the JIB winch (a long press on touch): free → in (the winch grinds it back), in → free
//   fly.letGo('main', before)     // throw the sheet off; before: the sheet as set (Pro's grind goes back there)
//   fly.sheetIn('main')           // a hand pulls it in from free (W, the winch, R for the jib): the normal trim takes over
//   fly.squallTick(dt, easing, atStop, before)   // the ease held with the main at its stop for LET_FLY.squallS: both fly
//   fly.drawing('jib', fill)      // after a sheet-in, the sail drawing again: the crew may trim it once more (true once)
//   fly.says(level)               // the skipper's line for the case just begun, the first time each case happens (NOTES id)
//
// The plumbing, each frame (controls.js; tests/letFly.test.mjs drives the same two calls with a HandSheets and the physics):
//   const io = { ctl, hand, handOn, pro, state, pullRate, jr: { lower, upper } (the jib's own trim range), toggles: { main, jib } }
//   fly.before(dt, io, { pull, mainNow, mainHold, jibDir, jibNow, jibHold })  → { flew }: before the sheets' own paths
//   fly.after(dt, io, { pull, mainNow, jibDir, jibNow })                      : after hand.update() set ctl.sheet
//
// It stays free: nothing here brings a sheet back on a timer. The crew's net (sheets.js) and its jib match wait until the
// player has the sail drawing again; Pro keeps the player's own settings.
import { HAND } from './sheets.js';
import { jibHandRange, BOAT } from '../boat.js';
const DEG = Math.PI / 180;
const toward = (v, to, r) => v + Math.max(-r, Math.min(r, to - v));

export const LET_FLY = {
  squallS: 1,            // the squall reflex: the ease held this long with the main eased to its stop frees both sheets
  stopRad: 0.5 * DEG,    // a sheet within this of its end is "at the stop"
  pressS: 0.5,           // a long press on a touch screen (a tap is a trim nudge there, never a let fly)
  clickS: 0.4,           // a click: released inside this…
  clickPx: 6,            // …and moved less than this
  drawFill: 0.5,         // a sail draws again (sheets.js HAND.luffFill, helmInput.js sailState)
  grindDoneRad: 0.5 * DEG,
  store: 'lakeshore.letfly.v1',
};
// the skipper's line for each case (src/ui/skipper.js NOTES ids), by the words' level (words.js: 'plain' | 'sailor')
export const FLY_NOTES = { jib: { sailor: 'letFlyJib', plain: 'letFlyJibPlain' }, both: { sailor: 'letFlyBoth', plain: 'letFlyBoth' } };
// the jib's own trim range off the crew's match (rad, + = out): past the lead and the rail (boat.js JIB_HAND), inside ±90°
// (the jib may be trimmed in hard even when the main is eased right out); a hand on it always moves the clew
export function jibTrimRange(state, P = BOAT) {
  const JT = 90 * DEG, jm = state?.jibMatch, [jlo, jhi] = jibHandRange(P), lo = jm != null ? jlo - jm : -JT, hi = jm != null ? jhi - jm : JT;
  const lower = Math.max(-JT, lo), upper = Math.max(lower, Math.min(JT, hi));
  return { lower, upper };
}
// the case the sheets make: both free, the jib alone, or none worth a word (the main alone bears her away: no line)
export const flyCase = (free) => (free.main && free.jib ? 'both' : free.jib ? 'jib' : null);

export class LetFly {
  constructor({ storage = null, once = true } = {}) {
    this.free = { main: false, jib: false };
    this.grind = { main: false, jib: false };   // a click on a free winch: the winch grinds the sheet back in
    this.back = { main: false, jib: false };    // sheeted in from free, the sail not drawing yet: the crew keeps its hands off
    this.prior = { main: null, jib: null };     // the sheets as set when they flew (Pro grinds back there)
    this.squall = 0;
    this.lastCase = null;
    this.mainOut = null;    // the crew-on-the-sheets path: the main's sheet while the let fly drives it (rad), else null
    this.jibCrew = false;   // the crew taking the jib back to its match (basic, once it draws again)
    this.storage = once ? storage : null;
    this.said = {};
    try { this.said = JSON.parse(this.storage?.getItem(LET_FLY.store) ?? '{}') ?? {}; } catch { this.said = {}; }
  }
  get any() { return this.free.main || this.free.jib; }
  letGo(side, before = null) {
    if (this.free[side]) return false;
    this.free[side] = true; this.grind[side] = false; this.back[side] = false; this.prior[side] = before;
    return true;
  }
  sheetIn(side, { grind = false } = {}) {
    if (!this.free[side]) return false;
    this.free[side] = false; this.back[side] = true; this.grind[side] = grind;
    if (!this.any) this.squall = 0;
    return true;
  }
  // a click: free → in (ground back by the winch), in → free. Returns 'fly' | 'in'.
  toggle(side, before = null) {
    if (this.free[side]) { this.sheetIn(side, { grind: true }); return 'in'; }
    this.letGo(side, before); return 'fly';
  }
  // the squall reflex: easing (the ease key, the pad's ease, a drag up) with the main at its stop (or already free)
  // before: { main, jib } the sheets as set now
  squallTick(dt, easing, atStop, before = {}) {
    if (!(easing && atStop) || (this.free.main && this.free.jib)) { this.squall = 0; return false; }
    this.squall += dt;
    if (this.squall < LET_FLY.squallS) return false;
    this.letGo('main', before.main ?? null); this.letGo('jib', before.jib ?? null); this.squall = 0;
    return true;
  }
  // a hand on the sheet ends the winch's grind
  handOn(side) { this.grind[side] = false; }
  // after a sheet-in: true once, the first frame the sail draws again
  drawing(side, fill) {
    if (!this.back[side] || this.free[side] || !(fill >= LET_FLY.drawFill)) return false;
    this.back[side] = false; this.grind[side] = false;
    return true;
  }
  // ---- the plumbing (see the header) ----
  // the main as the player set it (null: the crew's), the jib's own trim
  static mainSet({ ctl, hand, handOn }) { return ctl.autoTrim !== false ? (handOn ? hand.sheet : null) : ctl.main; }
  static jibSet({ ctl }) { return ctl.autoTrim !== false ? ctl.jibTrim ?? 0 : ctl.jib; }
  before(dt, io, { pull = 0, mainNow = 0, mainHold = 0, jibDir = 0, jibNow = 0, jibHold = 0 } = {}) {
    const { ctl, hand, handOn, pro, jr, toggles = {} } = io, auto = ctl.autoTrim !== false;
    const was = { ...this.free }, mainSet = LetFly.mainSet(io), jibSet = LetFly.jibSet(io);
    // the main at its stop: the hand's sheet run out (raw: the main's control at 1); with the crew on the sheets the ease key
    // has nothing else to do, so it counts as at the stop
    const mainAtStop = auto ? (handOn ? hand.sheet != null && hand.sheet >= HAND.max - LET_FLY.stopRad : true) : ctl.main >= 1 - 1e-3;
    const jibAtStop = auto ? (ctl.jibTrim ?? 0) >= jr.upper - LET_FLY.stopRad : ctl.jib >= 1 - 1e-3;
    for (const side of ['main', 'jib']) if (toggles[side]) this.toggle(side, side === 'main' ? mainSet : jibSet);
    // Pro: the winch dragged (or stepped) on out past its stop clicks into free
    if (pro && !this.free.main && mainAtStop && (mainNow < 0 || mainHold < 0)) this.letGo('main', mainSet);
    if (pro && !this.free.jib && jibAtStop && (jibNow < 0 || jibHold < 0)) this.letGo('jib', jibSet);
    // the sails down (the crew's furl, under engine or at anchor): nothing to spill, so the ease held at the stop is not a squall
    // (it threw both sheets, which let the helm go amidships and the pilot off until A/D: fix/v2-motor-spin, 2026-11-14)
    const furled = (io.state?.furl ?? 0) >= 0.5;
    this.squallTick(dt, pull < -0.5 && !furled, mainAtStop || this.free.main, { main: mainSet, jib: jibSet });
    // a hand pulling a free sheet in takes it back from the stop; any hand on a sheet ends the winch's grind
    if (this.free.main && (pull > 0 || mainNow > 0)) this.sheetIn('main');
    if (this.free.jib && (jibDir > 0 || jibNow > 0)) this.sheetIn('jib');
    if (pull || mainNow) this.handOn('main');
    if (jibDir || jibNow) { this.handOn('jib'); this.jibCrew = false; }
    const flew = (this.free.main && !was.main) || (this.free.jib && !was.jib);
    if (flew) { hand.start = false; hand.crew = false; }
    if (this.free.main && !was.main) this.mainOut = HAND.max;
    if (this.free.jib && !was.jib) this.jibCrew = false;
    if (was.jib && !this.free.jib) { if (auto) ctl.jibTrim = jr.upper; else ctl.jib = 1; }   // in from the stop, at the winch's rate
    return { flew };
  }
  after(dt, io, { pull = 0, mainNow = 0, jibDir = 0, jibNow = 0 } = {}) {
    const { ctl, hand, handOn, pro, state: s, pullRate = HAND.rate, jr } = io, auto = ctl.autoTrim !== false;
    const grindRate = pullRate * HAND.boost * dt;
    // the main
    if (this.free.main) {
      this.mainOut = HAND.max;
      if (auto) { ctl.sheet = HAND.max; if (handOn) { hand.sheet = HAND.max; hand.idle = 0; hand.crew = false; } }
      else ctl.main = 1;
    } else if (auto && handOn) {
      this.mainOut = null;
      if (this.grind.main && hand.sheet != null) {
        // the winch grinds it back: to the crew's trim, or in Pro to the player's own setting
        const b = this.prior.main, to = pro && b != null && b < HAND.max - 2 * DEG ? b : s.crewSheet;
        hand.sheet = toward(hand.sheet, to, grindRate); hand.idle = 0; ctl.sheet = hand.sheet;
        if (Math.abs(to - hand.sheet) < LET_FLY.grindDoneRad) this.grind.main = false;
      } else if (!pro && this.free.jib && !(pull || mainNow) && hand.sheet != null && s.crewSheet != null) {
        // the jib let fly with the main in: the crew keeps the main trimmed as she rounds up (the round-up's engine)
        hand.sheet = toward(hand.sheet, s.crewSheet, HAND.netRate * dt); hand.idle = 0; hand.crew = false; ctl.sheet = hand.sheet;
      }
      if (this.back.main) { hand.idle = 0; hand.crew = false; }   // the crew's net waits until the main draws again
    } else if (auto) {
      // the crew on the sheets: it winches the main back in from the stop, then trims it as before
      if (this.mainOut != null && s.crewSheet != null) {
        this.mainOut = toward(this.mainOut, s.crewSheet, grindRate); ctl.sheet = this.mainOut;
        if (Math.abs(s.crewSheet - this.mainOut) < LET_FLY.grindDoneRad) { this.mainOut = null; ctl.sheet = null; }
      }
    } else if (this.grind.main && this.prior.main != null) {
      ctl.main = toward(ctl.main, this.prior.main, grindRate / (HAND.max - HAND.min));
      if (Math.abs(ctl.main - this.prior.main) < 1e-3) this.grind.main = false;
    }
    this.drawing('main', s.mainFill);
    // the jib
    ctl.jibFree = this.free.jib;
    if (!this.free.jib && this.grind.jib) {
      if (auto) {
        const b = this.prior.jib, to = Math.max(jr.lower, Math.min(jr.upper, pro && b != null ? b : 0));
        ctl.jibTrim = toward(ctl.jibTrim ?? 0, to, HAND.rate * HAND.boost * dt);
        if (Math.abs(to - ctl.jibTrim) < LET_FLY.grindDoneRad) this.grind.jib = false;
      } else if (this.prior.jib != null) {
        ctl.jib = toward(ctl.jib, this.prior.jib, 0.4 * HAND.boost * dt);
        if (Math.abs(ctl.jib - this.prior.jib) < 1e-3) this.grind.jib = false;
      }
    }
    if (this.drawing('jib', s.jibFill) && !pro && auto) this.jibCrew = true;   // drawing again: the crew takes the jib back to its match
    if (this.jibCrew && !(jibDir || jibNow)) {
      ctl.jibTrim = toward(ctl.jibTrim ?? 0, 0, HAND.netRate * dt);
      if (Math.abs(ctl.jibTrim) < LET_FLY.grindDoneRad) { ctl.jibTrim = 0; this.jibCrew = false; }
    }
  }
  // the case just begun this frame, the first time ever (per browser with once), as a NOTES id for the level; else null
  says(level = 'plain') {
    const c = flyCase(this.free);
    const begun = c && c !== this.lastCase;
    this.lastCase = c;
    if (!begun || this.said[c]) return null;
    this.said[c] = true;
    try { this.storage?.setItem(LET_FLY.store, JSON.stringify(this.said)); } catch { /* private mode: this page only */ }
    return FLY_NOTES[c][level === 'sailor' ? 'sailor' : 'plain'];
  }
}

// One winch pad's press, for the let fly's click and long press (helmStation.js). press(t, x, y, touch); move(x, y);
// tick(t) → true once when a touch press has been held still for LET_FLY.pressS; release(t) → true when it was a click
// (a mouse or pen: short and still; a touch tap never lets fly, but a tap on a FREE winch sheets it in: free() tells).
export class FlyPress {
  constructor() { this.down = null; }
  press(t, x, y, touch = false) { this.down = { t, x, y, touch, moved: 0, fired: false }; }
  move(x, y) { const d = this.down; if (d) d.moved = Math.max(d.moved, Math.hypot(x - d.x, y - d.y)); }
  tick(t) {
    const d = this.down;
    if (!d || d.fired || !d.touch || d.moved > LET_FLY.clickPx * 2 || t - d.t < LET_FLY.pressS) return false;
    d.fired = true; return true;
  }
  // free: the winch's sheet is free now (a touch tap on it sheets it in)
  release(t, free = false) {
    const d = this.down; this.down = null;
    if (!d || d.fired) return false;
    const still = d.moved <= LET_FLY.clickPx && t - d.t <= LET_FLY.clickS;
    return still && (!d.touch || free);
  }
}
