// The fireworks in Cruise (S5, owner 2026-11-08): the Fireworks button, the trip to the viewing spot and the
// anchor, and the share link. Plain JS, no three.js, no DOM: tests/fireworksCruise.test.mjs drives it.
//
// The button (the clock menu's Fireworks row, src/ui/timeMenu.js): on the show's evening (the highlight day, the fireworks on: the default) the clock
// jumps to the evening if it is not already there (jumpHour), the navigator makes for the viewing spot, the crew stops
// the boat with the engine astern and anchors, and the evening (src/fireworks/evening.js invite()) runs its short
// time-lapse to 21:44 once the boat is settled. After the show the crew weighs anchor and Cruise sails on (home under
// the moon). On any other day (or ?fireworks=0) the page has no show built, so the button opens the share link (below).
//
// The viewing spot in Cruise: the boat's keel (1.6 m) cannot cross the mouth's bar (0.5–3 m; src/modes/chill/navigator.js
// § 2), so the sill itself (src/fireworks/stage.js SILL, outside the bar) is out of the navigator's reach. CRUISE_SPOT is
// the reachable anchorage nearest it: inside the mouth, 9.7 m deep (the anchor takes 3–20 m), 30 m of margin past the
// planner's own, 450 m from the sill. Realism round (2026-11-08): it is the viewing spot of every mode (stage.js VIEW), and
// the barges came in to 720 m from it through the mouth (were 1.2 km): both decks in clear view over open water.
//
// The share link, ?show=fireworks (src/main.js stages these flags before the core boots, as the first visit does): Cruise
// on the highlight day with the fireworks on, the boat at anchor on CRUISE_SPOT, the clock at 21:43:00 (60 game s, 15 real
// s, before the show's first riser), the evening already in its show phase (the clock at 4 game s a real s). The clock
// waits while the home card is up: its Enter is the gesture that starts the sound and then the show (world.js).
import { bargesWorld } from '../../../src/fireworks/stage.js';
import { CRUISE_SPOT } from '../../../src/fireworks/share.js';
export { SHOW_PARAM, CRUISE_SPOT, SHARE, SHARE_HEADING, shareHour, isShare, showOn, shareOverrides, shareSearch } from '../../../src/fireworks/share.js';

// the show's middle (the barges' midpoint) and the bearing to it from the anchorage (deg clockwise from north)
export const SHOW_CENTRE = (() => { const B = bargesWorld(); return [B.reduce((a, b) => a + b.x, 0) / B.length, B.reduce((a, b) => a + b.z, 0) / B.length]; })();
export const bearingFrom = (p, q = SHOW_CENTRE) => ((Math.atan2(q[0] - p[0], -(q[1] - p[1])) * 180 / Math.PI) + 360) % 360;
export const TRIP = {
  eveningHour: 20.25,        // the jump lands here (the afternoon hint's hour: golden light, 14 min before sunset)
  jumpBefore: 20.0,          // pressed before this hour of day, or after the show's end (22:10), the clock jumps
  jumpAfter: 22 + 10 / 60,
  approachM: 80,             // the crew starts to stop the boat this far from the spot (the navigator's own arrival is 70 m)
  sternU: 0.3,               // the engine astern until the boat's way is under this (m/s)
  astern: -0.6,              // the lever astern
  dropSog: 0.4,              // the anchor goes down under this speed over the ground (the tackle's limit is 0.514)
  dropRetryS: 2,             // a drop the tackle refused is tried again after this
  motorBelow: 1.4,           // sailing to the spot under this speed over the ground (the evening breeze dies after sunset; the
  motorAfterS: 8,            //   night drainage is 0.6 m/s) for this long, the crew motors on (motor-sailing: the skipper steers)
  motorAhead: 0.55,          // the lever ahead (≈ 2.5 m/s in a calm)
};
// Pressed at this hour of day: the hour the clock jumps to, or null when the evening is already under way
export function jumpHour(hourOfDay) {
  const h = ((hourOfDay % 24) + 24) % 24;
  return h < TRIP.jumpBefore || h >= TRIP.jumpAfter ? TRIP.eveningHour : null;
}

// The trip: one step a frame. In: { phase (the evening's), x, z, u (way through the water, m/s), sog, tackle ('free' |
// 'anchor' | …), anchorPhase, dt }. Out: { state, hold (the pilot lets the helm go; the rudder amidships), furl (the
// sails 0 set … 1 down, or null: the skipper's), throttle (the lever, or null), engine (true on, false off, null as it is),
// drop / weigh (once: the page calls the tackle), dest (the navigator's mark, or null) }.
//   idle → sailing (to the spot) → stopping (sails down, the engine astern) → anchoring → anchored → (the show ends)
//   weighing → idle (Cruise sails on). start({ anchored: true }): the share link's boat, stopped on the spot: the anchor
//   goes down at once (anchoring).
export function createCruiseTrip({ spot = CRUISE_SPOT, T = TRIP } = {}) {
  const S = { state: 'idle', retry: 0, t: 0, startedAt: null, slow: 0, motoring: false };
  const out = () => ({ state: S.state, hold: false, furl: null, throttle: null, engine: null, drop: false, weigh: false, dest: null });
  function start({ anchored = false } = {}) { S.state = anchored ? 'anchoring' : 'sailing'; S.retry = anchored ? T.dropRetryS : 0; S.slow = 0; S.motoring = false; S.startedAt = S.t; return S.state; }
  function cancel() { S.state = 'idle'; }
  function step({ phase = 'before', x = 0, z = 0, u = 0, sog = 0, tackle = 'free', anchorPhase = 'stowed', dt = 0 } = {}) {
    S.t += dt;
    const o = out(), d = Math.hypot(x - spot[0], z - spot[1]);
    if (S.state === 'sailing') {
      o.dest = spot;
      S.slow = sog < T.motorBelow ? S.slow + dt : 0;
      if (S.slow >= T.motorAfterS) S.motoring = true;
      if (S.motoring) { o.engine = true; o.throttle = T.motorAhead; }
      if (phase === 'after') { S.state = 'idle'; o.dest = null; }   // the show came and went on the way (the cap): on with the cruise
      else if (d < T.approachM) S.state = 'stopping';
    }
    if (S.state === 'stopping') {
      o.hold = true; o.furl = 1; o.engine = true;
      o.throttle = u > T.sternU ? T.astern : 0;
      if (sog < T.dropSog && u <= T.sternU) { S.state = 'anchoring'; S.retry = 0; o.drop = true; }
    } else if (S.state === 'anchoring') {
      o.hold = true; o.furl = 1; o.throttle = 0;
      if (tackle === 'anchor') { if (anchorPhase === 'held') { S.state = 'anchored'; o.engine = false; } }
      else if ((S.retry += dt) >= T.dropRetryS) { S.retry = 0; o.throttle = u > T.sternU ? T.astern : 0; if (sog < T.dropSog) o.drop = true; }
    }
    if (S.state === 'anchored') {
      o.hold = true; o.furl = 1; o.throttle = 0; o.engine = false;
      if (phase === 'after') { S.state = 'weighing'; o.weigh = true; }
    } else if (S.state === 'weighing') {
      o.hold = true; o.furl = 1; o.throttle = 0;
      if (tackle === 'free') { S.state = 'idle'; o.furl = 0; o.hold = false; }
    }
    o.state = S.state;
    return o;
  }
  return { start, cancel, step, get state() { return S.state; }, get active() { return S.state !== 'idle'; } };
}

// One tick of the crew's work for the trip (the page's createCruiseHelm crew hook, and the node tests' voyage): the trip's
// step, then the navigator's mark, the sails, the engine and the anchor. → the trip's output (hold: the pilot lets go).
// Does nothing while the trip is idle (Cruise sails as before).
export const TRIP_NAME = 'Fireworks';
export function crewStep({ trip, phase = 'before', phys, ctl, nav = null, tackle = null, dt = 0 }) {
  if (!trip.active) return { hold: false, state: 'idle' };
  const s = phys.state;
  const o = trip.step({ phase, x: s.x, z: s.z, u: s.u ?? s.sog, sog: s.sog, tackle: tackle?.mode ?? 'free', anchorPhase: tackle?.state?.anchor?.phase ?? 'stowed', dt });
  const ours = nav?.dest?.name === TRIP_NAME;
  if (o.dest && nav && !ours) nav.setDestination(o.dest, { name: TRIP_NAME });
  else if (!o.dest && ours) nav.clearDestination();
  if (o.drop && tackle?.mode === 'free') tackle.drop(s);
  if (o.weigh) tackle?.weigh();
  // the anchor breaks out once the rode is short (2 : 1): hauled further at a short stay, the tackle's chain model went
  // unstable while the anchor dragged (a NaN at 1.05 : 1 in the trip's voyage, tests/helpers/fireworks-trip.mjs)
  const an = tackle?.state?.anchor;
  if (o.state === 'weighing' && an?.phase === 'weighing' && an.out <= 2 * (an.depth + 0.9)) an.phase = 'up';
  if (o.state === 'idle') {   // the trip is over: the sails up, the engine off, the scenic (or night) round from here
    ctl.furl = 0; ctl.throttle = null; ctl.engine = false;
    nav?.pickNearest(s.x, s.z);
  } else { ctl.furl = o.furl ?? 0; ctl.throttle = o.throttle; ctl.engine = o.engine; }
  return o;
}
