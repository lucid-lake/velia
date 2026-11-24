// One kayaker on the lake (feat/kayaks-lake): where it is, the intent it gives its paddler, and the hull it
// drives. Plain JS, no three.js. The hull is one model at every level of detail: m·dv/dt = F − k·v·|v| − c·v, the yaw
// I·dr/dt = M − D·r (round 9). Near the camera the approved paddler's strokes drive it (its own
// surge: the fleet hands over advance and dyaw); further out the same equation runs on each gait's mean force, fitted to
// the paddler's measured speeds, so a kayak keeps its speed and its turns when it changes level.
//
//   const a = createAgent({ slot, terrain })    // at its route's s0, heading along it, under way (or resting)
//   const intent = steer(a, dt)                  // { throttle, turn } for the paddler (or the hull model), from the route
//   steerTo(a, heading, throttle)                // toward a world heading (the mind's choices: src/kayaks/mind.js)
//   stepHull(a, dt, intent)                      // mid / far: the hull model moves it
//   applyDrive(a, out.boat)                      // full: the paddler's own step moves it (advance, dyaw, v, r)
//   coast(a, dt)                                 // full, a frame without a paddler step: on at the last speed and turn
//
// Steering keeps to the approved controller's clean intents (in-between throttles blend gaits the planted blade does not
// follow: 0.3 crawls at 0.1 m/s, 0.75 at 0.6): cruise 0.5, sprint 1, back −0.6, rest 0; turns are forward sweeps (turn
// ±0.7 with a cruise: ≈ 10°/s at 1 m/s) or, past 70° off, a sweep on the spot (≈ 9°/s).
import { targetWeights } from '../props/paddler/motion.js';
import KAYAK from '../../craft/kayak/vessel.json' with { type: 'json' };

const DEG = Math.PI / 180;
import { wrap } from '../core/math.js';

export const HULL = Object.freeze({ ...KAYAK.physics });   // kg, N·s²/m², N·s/m, kg·m², N·m·s (K3 round 9): M 108, K 7.5, C 6, I 120, D 140, from the kayak's profile (src/craft/kayak/vessel.json)
// each gait's mean forward force (N) and turning moment (N·m, + to starboard), fitted to the full paddler at 60 Hz in node
// (20 s per intent from rest, the second half averaged, 2026-11-08): cruise 1.31 m/s, sprint 2.01, back −1.11, a sweep on the spot 0.86 m/s at
// 8.7°/s; a cruise with turn 0.7 0.97 m/s at 9.7°/s
export const GAIT = Object.freeze({
  rest: { F: 0, M: 0, hz: 0.25 }, cruise: { F: 20.7, M: 0, hz: 0.5 }, sprint: { F: 42.4, M: 0, hz: 1.0 },
  back: { F: -15.9, M: 0, hz: 0.42 }, sweepR: { F: 10.7, M: -26, hz: 0.36 }, sweepL: { F: 10.7, M: 26, hz: 0.36 },
});
export const STEER = Object.freeze({
  look: 12,          // m ahead along the route: the point the kayaker paddles toward
  startDeg: 8,       // off by more than this: start a sweep
  stopDeg: 3,        // back within this: paddle straight again
  spinDeg: 70,       // off by more than this: turn on the spot
  turn: 0.7,         // the sweep's intent with a cruise
});
const GAITS = Object.keys(GAIT);

export function createAgent({ slot, x, z, heading } = {}) {
  const path = slot.route.path, p = path.at(slot.s0);
  const resting = slot.restLeft > 0;
  const a = {
    id: slot.id, slot, path,
    x: x ?? p.x, z: z ?? p.z, heading: heading ?? p.heading,
    v: resting ? 0.2 : 1.3, r: 0,
    s: slot.s0, lap: 0, restLeft: slot.restLeft, rested: new Set(),
    turning: 0, intent: { throttle: resting ? 0 : 0.5, turn: 0 },
    w: Object.fromEntries(GAITS.map((g) => [g, 0])), wm: null, phase: (slot.seed % 100) / 100,
    tier: null, offRoute: 0,
  };
  const tw = targetWeights(a.intent);
  for (const g of GAITS) a.w[g] = tw[g] ?? 0;
  a.wm = { ...a.w };
  // the rests already passed at the start (so a kayak placed past its rest does not stop there at once)
  for (const r of slot.route.rests) if (r.s < slot.s0 - 1 || resting) a.rested.add(r);
  return a;
}

// progress along the route and the rests; the intent toward the point `look` m ahead. opts.heading(h) may bend the
// wanted heading (the mind's pushes off the other kayaks and the shore, src/kayaks/mind.js); opts.throttle the pace (the
// meeting's own, mind.js meetPace)
export function steer(a, dt, opts = {}) {
  const L = a.path.length;
  // the window round the last progress widens while the kayak is off its route (an avoiding kayak comes back to it)
  const pr = a.path.project(a.x, a.z, a.s, a.offRoute > 20 ? 160 : 40);
  // the loop wraps: a jump of more than half the length is a lap
  if (pr.s < a.s - L / 2) { a.lap++; a.rested.clear(); }
  a.s = pr.s; a.offRoute = pr.d;
  if (a.restLeft > 0) {
    a.restLeft -= dt;
    a.intent = { throttle: 0, turn: 0 };
    return a.intent;
  }
  for (const r of a.slot.route.rests) {
    if (a.rested.has(r)) continue;
    const ahead = ((r.s - a.s) % L + L) % L;
    if (ahead < 3) { a.rested.add(r); a.restLeft = r.dur; a.intent = { throttle: 0, turn: 0 }; return a.intent; }
  }
  // off the route by more than the look-ahead: aim back at it further along (a kayak rejoining after it gave way)
  const t = a.path.at(a.s + STEER.look + (a.offRoute > 10 ? Math.min(30, a.offRoute) : 0));
  let want = Math.atan2(t.x - a.x, -(t.z - a.z));
  if (opts.heading) want = opts.heading(want);
  return steerTo(a, want, opts.throttle ?? 0.5);
}

// the intent toward a world heading (rad, ahead is (sin h, −cos h)) at a throttle: forward sweeps past STEER.startDeg off
// (back on line under stopDeg), a sweep on the spot past spinDeg; a stopped paddler (throttle 0) only drifts
export function steerTo(a, want, throttle = 0.5) {
  const e = wrap(want - a.heading), ae = Math.abs(e) / DEG;
  if (!a.turning && ae > STEER.startDeg) a.turning = Math.sign(e);
  else if (a.turning && (ae < STEER.stopDeg || Math.sign(e) !== a.turning)) a.turning = ae > STEER.startDeg ? Math.sign(e) : 0;
  if (throttle <= 0) { a.turning = 0; a.intent = { throttle, turn: 0 }; return a.intent; }
  a.intent = ae > STEER.spinDeg ? { throttle: 0, turn: Math.sign(e) }
    : a.turning ? { throttle: 0.5, turn: STEER.turn * a.turning }
      : { throttle, turn: 0 };
  return a.intent;
}

// the gait weights eased toward the intent's (two stages at 0.24 s, the paddler's own: motion.js), the stroke's phase
function ease(a, dt) {
  const tw = targetWeights(a.intent), k = 1 - Math.exp(-dt / 0.24);
  let hz = 0;
  for (const g of GAITS) { a.wm[g] += ((tw[g] ?? 0) - a.wm[g]) * k; a.w[g] += (a.wm[g] - a.w[g]) * k; hz += a.w[g] * GAIT[g].hz; }
  a.phase = (a.phase + hz * dt) % 1;
}

// mid / far: the hull model (a midpoint step for the surge, as the paddler's)
export function stepHull(a, dt, intent = a.intent) {
  a.intent = intent;
  ease(a, dt);
  let F = 0, M = 0;
  for (const g of GAITS) { F += a.w[g] * GAIT[g].F; M += a.w[g] * GAIT[g].M; }
  const H = HULL, acc = (v) => (F - H.K * v * Math.abs(v) - H.C * v) / H.M;
  a.v += acc(a.v + 0.5 * dt * acc(a.v)) * dt;
  a.r += (M - H.D * a.r) / H.I * dt;
  move(a, a.v * dt, a.r * dt);
}

// full: the paddler's step (its out.boat) moves the kayak; the weights follow so a hand-back to the hull model is smooth.
// Between two paddler steps (the fleet steps a far-ish paddler at 20–30 Hz) the kayak coasts at the last speed and turn;
// the next step's advance and yaw then make up only the difference, so the path is the paddler's own
export function applyDrive(a, boat, phase = null) {
  ease(a, 0);
  a.v = boat.v; a.r = boat.r;
  if (phase != null) a.phase = phase;
  move(a, boat.advance - (a.coastAdv ?? 0), boat.dyaw - (a.coastYaw ?? 0));
  a.coastAdv = 0; a.coastYaw = 0;
}
export function coast(a, dt) {
  const adv = a.v * dt, yaw = a.r * dt;
  a.coastAdv = (a.coastAdv ?? 0) + adv; a.coastYaw = (a.coastYaw ?? 0) + yaw;
  move(a, adv, yaw);
}

function move(a, advance, dyaw) {
  a.heading = wrap(a.heading + dyaw);
  a.x += Math.sin(a.heading) * advance; a.z -= Math.cos(a.heading) * advance;   // ahead is (sin h, −cos h)
}
