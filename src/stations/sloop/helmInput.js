// The helm station's input maths (owner, 2026-10-30), pure (tests/helmStation.test.mjs).
// Screen coordinates throughout: x right, y DOWN (css px), so an angle that grows is a CLOCKWISE turn on screen.
//
// The wheel: a drag turns it by the pointer's angle about the hub, relative to where it was grabbed (no jump); clockwise
// on screen = to starboard (as a real wheel). Wheel angle = 4 × rudder (src/boat/Boat.js), stops at ±25° of rudder.
// The winches (both alike): four ways to work one, all the same sign: IN = the sheet shorter.
//   crank:  press on the handle's grip and go round; clockwise = in (a real winch winds in clockwise), counter = ease.
//   drag:   press anywhere else and drag; DOWN = in, UP = ease (the phone's rule), in proportion to the distance.
//   scroll: a mouse wheel or a trackpad's two-finger scroll over it, no click; scrolling DOWN = in. The sign is the page's
//           own (deltaY > 0 is what scrolls a page down), so it follows the OS's natural-scrolling setting as every page does.
//   steps:  the ▼ (in) and ▲ (ease) buttons on hover: a click is one STEP; held, it repeats after HOLD_MS like the W/S key.
// Every gesture returns a sheet change in RADIANS, + = in.
const DEG = Math.PI / 180;
export const HELM_IN = {
  wheelPerRudder: 4,          // the wheel turns 4× the rudder (Boat.js)
  rudderMax: 25 * DEG,        // BOAT.rudder.maxDeg
  crankTurnSheet: 15 * DEG,   // one full turn of the handle = 15° of sheet (the main's whole range, 12–80°, is ≈ 4.5 turns)
  dragPxPerDeg: 4,            // a straight drag: 4 px per degree of sheet (100 px = 25°)
  scrollPxPerDeg: 40,         // a scroll: 40 px of normalised delta per degree (a mouse notch, 100 px, = 2.5°)
  scrollMaxDeg: 4,            // one wheel event never moves more than this (a trackpad's inertia burst stays gentle)
  lineToPx: 16,               // deltaMode 1 (lines: Firefox's mouse wheel) → px
  pageToPx: 400,              // deltaMode 2 (pages) → px
  step: 2 * DEG,              // a click on ▼ or ▲
  holdMs: 350,                // held that long, a step button repeats like the key (the winch's own rate)
  gripR: 0.42,                // the crank's grip sits at this share of the winch's radius from its axis…
  gripHit: 0.2,               // …and a press within this share of the diameter of it takes the handle
  crankAfterDeg: 150,         // a drag that has swept this far round the axis is a crank from then on
  drumPerSheet: 12,           // the drawn drum turns 12× the sheet's angle (a turn per 30° of sheet)
};

// a signed angle wrapped to (−π, π]
export const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
// the angle of p about c on screen (y down): grows clockwise
const screenAngle = (c, p) => Math.atan2(p.y - c.y, p.x - c.x);
// the clockwise turn from a to b about c, in radians (wrapped)
export const turnCW = (c, a, b) => wrap(screenAngle(c, b) - screenAngle(c, a));

// a wheel event's delta (deltaY, deltaMode, plus deltaX for a sideways trackpad scroll) in px, sign kept
export function wheelPx({ deltaY = 0, deltaX = 0, deltaMode = 0 } = {}, { horizontal = false } = {}) {
  const k = deltaMode === 1 ? HELM_IN.lineToPx : deltaMode === 2 ? HELM_IN.pageToPx : 1;
  const d = horizontal && Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  return d * k;
}
// a scroll over a winch → the sheet change (rad, + = in): scrolling down pulls in, capped per event
export function scrollSheet(ev) {
  const deg = wheelPx(ev) / HELM_IN.scrollPxPerDeg;
  return Math.max(-HELM_IN.scrollMaxDeg, Math.min(HELM_IN.scrollMaxDeg, deg)) * DEG;
}
// a straight drag from y0 to y1 (css px) → the sheet change (rad): down = in
export const dragSheet = (y0, y1) => (y1 - y0) / HELM_IN.dragPxPerDeg * DEG;
// a crank's clockwise turn (rad) → the sheet change (rad): clockwise = in
export const crankSheet = (turn) => turn / (2 * Math.PI) * HELM_IN.crankTurnSheet;
// where the handle's grip is drawn now (css px) for a winch at c of radius r, the drum turned by drum (rad, clockwise)
const gripAt = (c, r, drum) => ({ x: c.x + Math.cos(drum - Math.PI / 2) * r * HELM_IN.gripR * 2, y: c.y + Math.sin(drum - Math.PI / 2) * r * HELM_IN.gripR * 2 });

// One winch's gesture, from press to release. press(p, { centre, radius, drum }) → 'crank' | 'drag'; move(p) → the sheet
// change since the last move (rad, + = in); the mode can turn from drag to crank once the pointer has gone round far enough.
export class WinchGesture {
  // grip: where the handle's grip is drawn (css px; the station projects it from the 3D handle), else gripAt()
  press(p, { centre, radius, drum = 0, grip = null }) {
    this.c = centre; this.r = radius; this.last = p; this.swept = 0; this.total = 0;
    const g = grip ?? gripAt(centre, radius, drum);
    this.mode = Math.hypot(p.x - g.x, p.y - g.y) <= radius * HELM_IN.gripHit * 2 ? 'crank' : 'drag';
    return this.mode;
  }
  move(p) {
    if (!this.last) return 0;
    const far = Math.hypot(p.x - this.c.x, p.y - this.c.y) > this.r * 0.25 && Math.hypot(this.last.x - this.c.x, this.last.y - this.c.y) > this.r * 0.25;
    const turn = far ? turnCW(this.c, this.last, p) : 0;
    this.swept += turn;
    if (this.mode === 'drag' && Math.abs(this.swept) >= HELM_IN.crankAfterDeg * DEG) this.mode = 'crank';
    const d = this.mode === 'crank' ? crankSheet(turn) : dragSheet(this.last.y, p.y);
    this.last = p; this.total += d;
    return d;
  }
  release() { const t = this.total; this.last = null; return t; }
}

// The wheel's drag: grabbed at angle a0 with the wheel at w0 (rad, clockwise on screen = starboard); the pointer now at p.
// Returns the rudder command −1..1 (ctl.rudder's units: ±BOAT.rudder.maxDeg).
export class WheelGesture {
  press(p, { centre, wheel = 0 }) { this.c = centre; this.prev = p; this.w = wheel; return this; }
  move(p) {
    if (!this.prev) return null;
    this.w += turnCW(this.c, this.prev, p); this.prev = p;
    const lim = HELM_IN.rudderMax * HELM_IN.wheelPerRudder;
    this.w = Math.max(-lim, Math.min(lim, this.w));
    return this.command;
  }
  get command() { return this.w / (HELM_IN.rudderMax * HELM_IN.wheelPerRudder); }
  release() { this.prev = null; }
}
// A phone's drag-anywhere steer (feat/cockpit-phone): the cockpit's wheel stands at the screen's centre, out of the left thumb's
// reach, so the thumb slides sideways anywhere in its own zone and the wheel turns as if the thumb were on the top of its rim:
// dx / r rad of wheel (r: the wheel's radius on screen, px), from the wheel's angle at the press. A slide right turns it clockwise
// (starboard). Held, it stays where the thumb leaves it, as the wheel does.
export class SteerSlide {
  press(x, { r, wheel = 0 }) { this.x0 = x; this.r = Math.max(20, r); this.w0 = wheel; this.w = wheel; return this; }
  move(x) {
    if (this.x0 == null) return null;
    const lim = HELM_IN.rudderMax * HELM_IN.wheelPerRudder;
    this.w = Math.max(-lim, Math.min(lim, this.w0 + (x - this.x0) / this.r));
    return this.command;
  }
  get command() { return this.w / (HELM_IN.rudderMax * HELM_IN.wheelPerRudder); }
  get held() { return this.x0 != null; }
  release() { this.x0 = null; }
}
// the wheel's drawn angle (rad, clockwise on screen) for a rudder angle (rad, + = starboard)
export const wheelAngle = (rudderRad) => rudderRad * HELM_IN.wheelPerRudder;
// a scroll over the wheel: down or right turns it clockwise (starboard); returns the wheel's turn (rad)
export const wheelScroll = (ev) => Math.max(-12, Math.min(12, wheelPx(ev, { horizontal: true }) / 10)) * DEG;

// The step buttons: a click is one step; held past holdMs it becomes a held key (dir) until released.
export class StepHold {
  constructor() { this.dir = 0; this.at = null; this.held = 0; }
  down(dir, now) { this.dir = dir; this.at = now; this.held = 0; return dir * HELM_IN.step; }   // the click's step, at once
  // the held direction now (+1 in, −1 ease, 0): what the W/S path gets while held
  tick(now) { if (!this.dir) return 0; return now - this.at >= HELM_IN.holdMs ? this.dir : 0; }
  up() { this.dir = 0; this.at = null; }
}

// The sail's state for its marker: 'off' (sails down or head to wind), 'luff' (shaking: too eased), 'stall' (over-trimmed:
// the flow torn off the lee side), 'draw' (trimmed right). The same reads as the crew's net (sheets.js HAND) and the dial.
// free: the sheet let fly (src/sail/letFly.js): a flogging sail reads 'luff' even head to wind.
export function sailState({ fill = 1, stall = 0, awa = Math.PI, twa = Math.PI, furl = 0, free = false } = {}) {
  if (furl >= 0.5) return 'off';
  if (free && fill < 0.5) return 'luff';
  if (Math.abs(twa) < 40 * DEG) return 'off';
  if (fill < 0.5) return 'luff';
  if (stall > 0.6 && Math.abs(awa) < 80 * DEG) return 'stall';
  return 'draw';
}
// the drawn drum's angle (rad, clockwise seen from above) for a sheet angle (rad): in = clockwise
export const drumAngle = (sheetRad, per = HELM_IN.drumPerSheet) => -sheetRad * per;
// the jib's sheet travels only ≈ 11° of clew angle (lead 21° … the rail 32°, boat.js): its drum turns twice as fast so a trim reads
export const JIB_DRUM_PER_SHEET = 24;
