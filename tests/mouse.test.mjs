// The mouse controls: click vs drag, the course from a clicked point, the no-go zone, the glyph's
// drag-to-sheet and rudder mappings, the dock's timing and the ripple's life. Plain JS; the live page is
// tools/probe_mouse.mjs. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPress, Press, CLICK } from '../src/ui/pointer.js';
import { CoursePilot, COURSE, bearingFrom, courseHeading, windFrom, closeHauled, rayToWater, rayHitsBoat, wrap } from '../classic/src/sail/course.js';
import { glyphSheet, glyphRudder, pullToward, CAPTAIN } from '../src/ui/captainView.js';
import { HandSheets, HAND } from '../src/sim/sail/sheets.js';
import { DockFade, DOCK } from '../src/ui/toolDock.js';
import { rippleAt, RIPPLE } from '../classic/src/ui/ripple.js';
import { BoatPhysics, CONTROLS, Helm, steadyWind, KN } from '../src/sim/boat.js';

const DEG = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

test('click vs drag: under 5 px and 250 ms is a click; more travel or a long press is a drag', () => {
  assert.equal(CLICK.px, 5); assert.equal(CLICK.ms, 250);
  assert.equal(classifyPress({ dx: 0, dy: 0, ms: 80 }), 'click');
  assert.equal(classifyPress({ dx: 3, dy: 3, ms: 200 }), 'click');       // 4.2 px
  assert.equal(classifyPress({ dx: 4, dy: 3, ms: 100 }), 'drag');        // 5 px
  assert.equal(classifyPress({ dx: 1, dy: 0, ms: 260 }), 'drag');        // held too long
  // a press that wandered past the threshold and came back is still a drag (the orbit already moved)
  const p = new Press(100, 100, 0);
  assert.equal(p.move(102, 101), false);
  assert.equal(p.move(108, 100), true);
  assert.equal(p.end(100, 100, 120), 'drag');
  const q = new Press(100, 100, 0); q.move(101, 101);
  assert.equal(q.end(101, 102, 150), 'click');
});

test('the bearing from the boat to a clicked point (clockwise from north, north = −z)', () => {
  const b = { x: 10, z: 20 };
  near(bearingFrom(b, { x: 10, z: -80 }), 0, 1e-9, 'north');
  near(bearingFrom(b, { x: 110, z: 20 }), 90 * DEG, 1e-9, 'east');
  near(Math.abs(bearingFrom(b, { x: 10, z: 120 })), 180 * DEG, 1e-9, 'south');
  near(bearingFrom(b, { x: -90, z: 20 }), -90 * DEG, 1e-9, 'west');
  // a click ray from a camera 6 m up, looking down onto the water 100 m ahead
  const hit = rayToWater([0, 6, 0], [0, -0.06, -1]);
  near(hit.z, -100, 1e-6, 'water hit z'); near(hit.x, 0, 1e-9);
  assert.equal(rayToWater([0, 6, 0], [0, 0.1, -1]), null, 'the sky is not a course');
  // the boat itself is not a course: a ray through the mast, and one passing 20 m to the side
  assert.equal(rayHitsBoat([0, 8, 30], [0, -0.1, -1], { x: 0, z: 0 }), true);
  assert.equal(rayHitsBoat([20, 8, 30], [0, -0.1, -1], { x: 0, z: 0 }), false);
});

test('the no-go zone: a bearing outside it is the heading; inside it, close-hauled on the better tack', () => {
  const from = 0, close = 45 * DEG;
  // a beam reach and a run: straight there
  near(courseHeading(90 * DEG, from, { close }).heading, 90 * DEG, 1e-9);
  assert.equal(courseHeading(180 * DEG, from, { close }).nogo, false);
  // the wedge's edge (42°) is outside; 41° is in
  assert.equal(courseHeading((COURSE.nogoDeg + 0.5) * DEG, from, { close }).nogo, false);
  const r = courseHeading(20 * DEG, from, { close });
  assert.equal(r.nogo, true); near(r.heading, 45 * DEG, 1e-9, 'the tack on the bearing’s side');
  const l = courseHeading(-30 * DEG, from, { close });
  near(l.heading, -45 * DEG, 1e-9, 'port side');
  // dead upwind (within 8°): the tack the bow is already on, so a click there never forces a tack
  near(courseHeading(3 * DEG, from, { close, heading: -60 * DEG }).heading, -45 * DEG, 1e-9, 'keeps port');
  near(courseHeading(-3 * DEG, from, { close, heading: 70 * DEG }).heading, 45 * DEG, 1e-9, 'keeps starboard');
  // the close-hauled angle is the polar's best upwind VMG, never inside the wedge
  for (const kn of [4, 8, 12, 18, 24]) { const c = closeHauled(kn * KN) / DEG; assert.ok(c >= COURSE.minCloseDeg && c > CAPTAIN.wedgeDeg && c < 55, `${kn} kn: ${c}°`); }
});

// sail with the click's pilot: wind from the north at `kn`, the boat starting on `h0`
function sailCourse({ h0, bearing, kn = 12, seconds = 40 }) {
  const boat = new BoatPhysics({ heading: h0 * DEG, speed: 2.8 }), helm = new Helm(), c = new CoursePilot();
  const env = { windAt: steadyWind(kn * KN, 0), t: 0 };
  boat.step(1 / 60, { ...CONTROLS }, env);
  near(windFrom(boat.state), 0, 1e-6, 'the wind comes from the north');
  c.set(bearing * DEG, boat.state);
  for (let i = 0; i < seconds * 60; i++) { env.t = boat.t; boat.step(1 / 60, { ...CONTROLS, rudder: helm.toHeading(boat.state, c.update(boat.state), 1 / 60) }, env); }
  return { s: boat.state, c };
}

test('the pilot steers to a clicked bearing and holds it (±3°)', () => {
  for (const [h0, b] of [[90, 140], [90, 60], [-100, -160], [120, 200]]) {
    const { s, c } = sailCourse({ h0, bearing: b });
    assert.equal(c.nogo, false);
    near(wrap(s.heading - b * DEG) / DEG, 0, 3, `${h0}° → ${b}°`);
  }
});

test('a clicked bearing into the wind: close-hauled on the better tack, still sailing', () => {
  const { s, c } = sailCourse({ h0: 90, bearing: 15 });                 // right of the wind: the starboard-side tack
  assert.equal(c.nogo, true); assert.equal(c.tack, 1);
  const twa = Math.abs(s.trueWind.angle) / DEG;
  assert.ok(twa > 42 && twa < 52, `TWA ${twa}`);
  assert.ok(s.sog > 1, `sailing at ${s.sog} m/s`);
  const p = sailCourse({ h0: -90, bearing: 2 });                         // dead upwind from port: stays on port
  assert.equal(p.c.tack, -1); assert.ok(p.s.heading < 0, `heading ${p.s.heading / DEG}`);
});

test('the glyph: the sail line drags the sheet, the rudder line drags the helm', () => {
  // the main pivots at the mast (50, 42): a point straight aft is the sheet hard in (the stop, 12°); abeam is 80°
  near(glyphSheet(50, 70) / DEG, HAND.min / DEG, 1e-9, 'aft');
  near(glyphSheet(50 + 20 * Math.sin(40 * DEG), 42 + 20 * Math.cos(40 * DEG)) / DEG, 40, 1e-6, '40° to starboard');
  near(glyphSheet(50 - 20 * Math.sin(40 * DEG), 42 + 20 * Math.cos(40 * DEG)) / DEG, 40, 1e-6, '40° to port: the same sheet');
  near(glyphSheet(80, 20) / DEG, HAND.max / DEG, 1e-9, 'forward of the mast: all the way out');
  near(glyphSheet(50 + 10 * Math.sin(30 * DEG), 18 + 10 * Math.cos(30 * DEG), 'jib') / DEG, 30, 1e-6, 'the jib pivots at the bow');
  // the rudder: straight down is centred; to starboard steers to starboard; the drawn gain is undone
  near(glyphRudder(50, 93), 0, 1e-9);
  assert.ok(glyphRudder(56, 92) > 0 && glyphRudder(44, 92) < 0);
  near(glyphRudder(80, 84), 1, 1e-9, 'past the stop');
  const drawn = 25 * DEG * Math.pow(0.5, 0.6);                           // the glyph draws a half helm at this angle
  near(glyphRudder(50 + 11 * Math.sin(drawn), 82 + 11 * Math.cos(drawn)), 0.5, 1e-9, 'the line lands under the pointer');
  // the hand on the sheet toward the target: pull in when out, ease when in, still within 0.3°
  assert.equal(pullToward(40 * DEG, 20 * DEG), 1); assert.equal(pullToward(20 * DEG, 40 * DEG), -1);
  near(pullToward(31 * DEG, 30 * DEG), 1 / 3, 1e-9); assert.equal(pullToward(30.1 * DEG, 30 * DEG), 0);
  // the closed loop: the same HandSheets as W/S brings the sheet to the dragged line at the winch's rate
  const s = { mainSheet: 50 * DEG, crewSheet: 30 * DEG, apparentWind: { angle: 60 * DEG }, trueWind: { angle: 90 * DEG }, mainFill: 1, mainStall: 0 };
  const hand = new HandSheets({ sheet: 60 * DEG }), target = glyphSheet(50 + 20 * Math.sin(25 * DEG), 42 + 20 * Math.cos(25 * DEG));
  let t = 0;
  while (Math.abs(hand.sheet - target) > 0.3 * DEG && t < 10) { hand.update(1 / 60, pullToward(hand.sheet, target), s); t += 1 / 60; }
  near(hand.sheet / DEG, 25, 0.35, 'settles on the line');
  assert.ok(t > 1.0 && t < (35 - 3) / 12 + 0.3, `at the winch rate (12°/s, ramping to 2.4 × held: sheets.js trimBoost), slowing over the last 3°: ${t.toFixed(2)} s`);
  const easeT = (() => { let u = 0; while (Math.abs(hand.sheet - 70 * DEG) > 0.3 * DEG && u < 10) { hand.update(1 / 60, pullToward(hand.sheet, 70 * DEG), s); u += 1 / 60; } return u; })();
  assert.ok(easeT < 45 / 25 + 0.6, `eases at 25°/s: ${easeT} s`);
});

test('the dock: in on a move, out after 3 s still, held while hovered, out 0.6 s after the pointer leaves', () => {
  assert.equal(DOCK.idleS, 3);
  const f = new DockFade(), step = (s) => { let v; for (let i = 0; i < Math.round(s * 60); i++) v = f.update(1 / 60); return v; };
  assert.equal(step(1), false, 'hidden at first');
  f.move(); assert.equal(step(0.1), true, 'a move shows it');
  assert.equal(step(2.7), true, 'still shown at 2.8 s');
  assert.equal(step(0.3), false, 'gone after 3 s still');
  f.move(); step(0.5); f.enter(); assert.equal(step(10), true, 'held while the pointer rests on it');
  f.leave(); assert.equal(step(0.5), true); assert.equal(step(0.15), false, 'gone 0.6 s after leaving');
  f.move(); assert.equal(step(0.05), true, 'and back on the next move');
});

test('the ripple: small, quiet, gone in 2 s', () => {
  const a = rippleAt(0.3, 200), b = rippleAt(1.5, 200), c = rippleAt(2.01, 200);
  assert.ok(a.r < b.r && b.r <= 200 * RIPPLE.r1, 'spreads');
  assert.ok(a.alpha > b.alpha && a.alpha <= RIPPLE.alpha, 'fades');
  assert.equal(c.alpha, 0);
  assert.equal(rippleAt(0.2, 200, 0.35).alpha, 0, 'the second ring waits');
  assert.equal(RIPPLE.life, 2);
});
