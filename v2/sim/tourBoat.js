// The glass boat (owner, 2026-11-18: "To gradually make the busy lake happen, the next thing to add is Tahoe's signature glass boat";
//): "Velia Travel", a clear-view tour pontoon (10.7 m, twin tubes, a white flat roof on posts, windowed
// sides, a glass viewing panel in the deck, twin outboards) on a tour from the open lake into Emerald Bay and back (owner, 2026-11-19:
// the South Lake Tahoe tours' way; TOUR_ROUTE): 11 kn on the open lake, 4 kn in the bay and its channel (its starboard lane); a first
// birth places her to be seen within a minute (birthPhase), a move never does; stopping 4.5 minutes over the
// clear shallows at the head of the bay (Vikingsholm) and off Fannette Island's west shoal. Her deck stays empty (owner, 2026-11-18).
// Five clear kayaks ride with her: underway all five towed astern on painters (the paddlers sit at rest in theirs); at a stop the two
// empty ones lie tied alongside and the three with paddlers (one a tandem pair) cast off and paddle round her on v1's own paddling
// (src/sim/kayaks/agent.js steerTo + stepHull, v2/sim/kayak-stroke.js strokeStep: the blade held, the hull moving up to it), rest and
// drift, and come back to tie on before she leaves. Desktop and tablet only, scaled by the GPU level (src/core/features.js glassBoat).
// A natural schedule (owner, 2026-11-18: "not staged by the birth camera angle — make it natural; it's a busy lake"): where she is on
// her loop when a page opens comes from the clock of day and the seed (tourPhase), so she is somewhere plausible on the bay at any
// moment, often at a stop; from there she moves as a real boat: eased speed, pure-pursuit steering at a pontoon's yaw rate, braking
// into a stop (cheat on where and when, never on motion). She yields to the player (COLREGs rule 8: slows and bends her route away;
// stops if the player is close ahead; creeps past once she has turned clear) and the player can bump her softly (her hull as four light
// circles on short rodes: v2/sim/channelMarks.js createMarkBodies, as v2/sim/anchoredBoats.js). Her route stands clear of the entrance
// channel, every birthplace's start, the Sail start, the moorings, the boats at anchor and the Regatta courses
// (v2/tests/glass-boat.test.mjs); in a race she stands down (nothing stepped or drawn).
// Pure: no DOM, no GPU; deterministic (the clock's hour and the seed place her; the sim clock's dt moves her; seeded paddlers).
//   const T = createTourBoat({ depthAt, onBump, hour, seed, clips })   clips: the paddlers' baked clips once the kayak asset is in
//                                         (null: the hull model's mean force and v1's gait rates, as the fleet's mid tier)
//   T.post(S, dt, t, windFromDeg(x, z))   the boat's tick (sea.addPost): her run or stop, the yield, the kayaks, the bump
//   T.setClips(clips)                     the asset arrived: the paddlers' strokes from now on
//   T.boat { x, z, heading, v, mode, stop, stopLeft, lat, yielding }   T.kayaks [{ x, z, heading, led, crew, a, st, trail }]   T.wake
//   T.trail: her wake's record (render/vesselWake.js emitters): newest first every TRAIL.dt s, { age, x, z, fx, fz, v, churn }; churn: the
//   props' wash (by her speed; a swirl of reverse thrust as she slows into a stop; 0 at rest). T.emitters(): her and her kayaks as emitters
//   T.lights(out, o, { sunElevDeg, eye, heightAt }) → n glow records (her nav lights: all-round white, red, green; 0 by day)
//   T.lure(x, z, s)                      play as Tessie's Lure (the RPG): underway she turns off her route toward (x, z) at the bay's speed
//                                         for s seconds and stops closing LURE.arriveM from it (a stop holds her; her free paddlers within
//                                         `r` paddle over instead) → true when she or a paddler turned
//   T.active = false: a race (Glass Boat Chase keeps her on);  T.chase({ stop, holdS }) her start in that race: at the stop, held, then away
import { createMarkBodies } from './channelMarks.js';
import { CHANNEL } from '../terrain/channel.js';
import { GLOW_FLOATS, NAV_GLOW, navLevel, navSector } from './night.js';
import { steerTo, stepHull, HULL, GAIT } from '../../src/sim/kayaks/agent.js';
import { createStroke, strokeStep, meanForce } from './kayak-stroke.js';
import { pickLook } from '../../src/sim/props/paddler/look.js';
import { CURIOUS as LURE } from './curious.js';   // play as Tessie's Lure (not her code: a phone loads this)

const DEG = Math.PI / 180, KN = 0.514444;
import { wrap as wrapPi } from '../../src/sim/core/math.js';
const GAITS = Object.keys(GAIT);

export const TOUR = Object.freeze({
  name: 'Velia Travel',
  knock: Object.freeze({ peakDeg: 50, upS: 1.0, rightS: 8 }),   // Tessie's knock (rights in 8 s)
  length: 12.2, beam: 3.8,              // m (owner, 2026-11-19: the real 40 ft tour class; was a 35 ft 10.7 × 3.7 m; render/tourBoatMesh.js PONTOON)
  speedKn: 4,                           // the bay's 5 mph rule is 4.3 kn
  fastKn: 11,                           // the open lake (a `fast` segment): a tour pontoon's run between the bays (owner, 2026-11-19)
  slowAheadM: 450,                      // m: she looks this far ahead for the bay's slower water (eases down at decel to it)
  accel: 0.10, decel: 0.07,             // m/s²: a laden pontoon eases up and coasts down (a stop from 4 kn in ≈ 30 m)
  yawRate: 7,                           // °/s at cruise (a turn of ≈ 17 m radius), less when slower
  look: 20,                             // m: the pure-pursuit point ahead along her route
  arriveM: 2.5,                         // m: at a stop once within this of it (and slowed)
  stopS: Object.freeze({ head: 270, fannette: 270 }),   // s at each stop (the owner's brief: 3–5 minutes)
  hull: Object.freeze([[4.45, 1.9], [1.48, 1.9], [-1.48, 1.9], [-4.45, 1.9]]),   // the circles: m forward of her middle, radius m
  circleKg: 3200,                       // each (four: ≈ 12.8 t, a laden 35 ft pontoon: she gives little)
  rode: Object.freeze({ period: 6, tau: 2.4, maxOff: 1.2 }),
  // the yield (COLREGs rule 8): the player inside this box ahead of her (m forward, m either side growing with distance) slows her to
  // a stop at stopM, and her route bends latM (latMax after longS of yielding) to the side away from the player until clear for
  // clearS; once the player is off her bow by creepDeg she creeps on at creep of cruise
  yield: Object.freeze({ aheadM: 70, behindM: 6, sideM: 16, sideGrow: 0.25, stopM: 14, slowM: 55, latM: 14, latMax: 30, longS: 20, latRate: 0.8, clearS: 6, creep: 0.22, creepDeg: 28 }),
  // the clear kayaks (3.4 m × 0.85 m, two seats)
  kayak: Object.freeze({ length: 3.4, beam: 0.85, r: 0.95, dragS: 5, driftMs: 0.22, wander: 0.05, payS: 40,
    roam: Object.freeze([14, 34]),      // m from her middle: the paddlers' wander ring at a stop
    restS: Object.freeze([8, 22]),      // s a paddler rests and drifts between legs
    backS: 80,                          // s before she leaves: the paddlers head back to tie on
    tieM: 3.0 }),                       // m: a paddler this near its painter's end is tied on again
  drawM: 2600,                          // m: drawn within this of the eye
  clear: Object.freeze({ channelM: 120, startStopM: 150, startLegM: 80, courseStopM: 110, courseLegM: 80, mooringM: 60, anchoredM: 40, depthM: 2.0, shoreM: 25 }),
  light: Object.freeze({ size: NAV_GLOW.size * 0.85, radiance: NAV_GLOW.radiance }),
});

// her loop (world m): the head of the bay's turquoise shallows off Vikingsholm, out to Fannette
// Island's west shoal (4–6 m over boulders), then back by the bay's west side, west of the boats at anchor. Two stops; the rest are
// turning points.
// The open lake (owner, 2026-11-19: "real glass-bottom boats depart from Heavenly [South Lake Tahoe] or Kings Beach, so even in open
// water we might see it"): as the South Lake Tahoe tours do, she comes up the west shore from the open lake, enters the bay by the
// entrance channel (keeping to its starboard side, red right returning), stops at the head of the bay and off Fannette, and leaves the
// same way; past our modelled water she turns back (a loop off the mouth, north-east of the open-lake birthplace). `fast` marks a
// segment outside the bay (from that point to the next): she runs at fastKn there; inside the bay, the channel included, the 5 mph rule
// (speedKn). The channel's lanes are the channel line offset to starboard of her way (laneM: the buoys stand 24 m off the line).
export const TOUR_LANE_M = 8;
function channelLane(way = 'out', C = CHANNEL, keep = TOUR_LANE_M) {
  const P = way === 'out' ? C.pts : [...C.pts].reverse(), out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    out.push([P[i][0] + (-dz / L) * keep, P[i][1] + (dx / L) * keep]);   // starboard of her way: (−dz, dx)
  }
  return out;
}
const R_ = (at, o = {}) => Object.freeze({ at: Object.freeze(at.map((v) => Math.round(v * 10) / 10)), ...o });
export const TOUR_ROUTE = Object.freeze([
  R_([-356, 388], { stop: 'head', name: 'the head of the bay' }),
  R_([-350, 250]),
  R_([-285, 105]),
  R_([-140, 60], { stop: 'fannette', name: 'off Fannette Island' }),
  // out: north of the island, south of the Boat Camp's moorings, down the bay to the narrows and out through the channel
  R_([-60, -200]), R_([300, -300]), R_([650, -480]), R_([860, -770]), R_([1000, -840]),
  ...channelLane('out').map((p, i, a) => R_(p, i === a.length - 1 ? { fast: true } : {})),
  // the open lake: north-east off the mouth, a turn past the open-lake birthplace's water, back to the channel's lake end
  R_([1950, -1450], { fast: true }), R_([2250, -1650], { fast: true }), R_([2600, -1600], { fast: true }), R_([2700, -1850], { fast: true }),
  R_([2300, -1950], { fast: true }), R_([1900, -1700], { fast: true }),
  // in: the channel's other side, back up the bay south of the moorings and round the island's north to the head
  ...channelLane('in').map((p) => R_(p)),
  R_([1020, -800]), R_([880, -740]), R_([680, -450]), R_([330, -270]), R_([-40, -180]),
  R_([-170, -60]),
  R_([-300, -20]),
  R_([-360, 205]),
]);

// her wake's record (render/vesselWake.js): a sample every dt s, kept keep s (the wash's 36 s and the V's 24 s), the kayaks' kayakKeep s
// Tessie's knock: over in upS to peakDeg, then righted over rightS (a damped ease back: no capsize, a pontoon)
export function knockHeel(t, side, K = TOUR) {
  const k = K.knock ?? TOUR.knock, peak = k.peakDeg * Math.PI / 180;
  if (t <= 0) return 0;
  if (t < k.upS) { const u = t / k.upS; return side * peak * u * u * (3 - 2 * u); }
  const u = Math.min(1, (t - k.upS) / k.rightS);
  return side * peak * (1 - u) ** 2 * Math.cos(u * Math.PI * 1.5);   // a damped roll back past upright, then still
}
export const TRAIL = Object.freeze({ dt: 0.5, keep: 40, kayakKeep: 10 });

// the loop as a closed polyline: segment starts, lengths, cumulative distance; the stops' distances along it
export function routeLoop(route = TOUR_ROUTE) {
  const pts = route.map((r) => r.at), n = pts.length, seg = [];
  let s = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push({ a, b, s0: s, L, fast: !!route[i].fast }); s += L; }
  const stops = route.map((r, i) => (r.stop ? { id: r.stop, name: r.name, s: seg[i].s0, at: r.at } : null)).filter(Boolean);
  return { seg, length: s, stops };
}
// the point at distance s along the loop (wrapped), and the segment's unit direction
export function pointAt(loop, s) {
  const L = loop.length; s = ((s % L) + L) % L;
  let k = 0; while (k < loop.seg.length - 1 && s > loop.seg[k].s0 + loop.seg[k].L) k++;
  const g = loop.seg[k], t = (s - g.s0) / g.L, dx = (g.b[0] - g.a[0]) / g.L, dz = (g.b[1] - g.a[1]) / g.L;
  return { x: g.a[0] + (g.b[0] - g.a[0]) * t, z: g.a[1] + (g.b[1] - g.a[1]) * t, dx, dz };
}
// the nearest distance along the loop to (x, z), searched within ±win of a guess (the boat's own progress)
function projectOn(loop, x, z, guess, win = 60) {
  let best = guess, bd = Infinity;
  for (let ds = -win; ds <= win; ds += 1) { const p = pointAt(loop, guess + ds), d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = guess + ds; } }
  const L = loop.length; return ((best % L) + L) % L;
}
// the speed she wants at s along the loop (m/s, no yield, no stop): her segment's (the bay's or the open lake's), eased down ahead of
// slower water at decel (she is at the bay's speed when she reaches the channel)
export function segAt(loop, s) { const L = loop.length; s = ((s % L) + L) % L; let k = 0; while (k < loop.seg.length - 1 && s > loop.seg[k].s0 + loop.seg[k].L) k++; return loop.seg[k]; }
export function cruiseAt(loop, s, K = TOUR) {
  const vOf = (g) => (g.fast ? K.fastKn : K.speedKn) * KN;
  let v = vOf(segAt(loop, s));
  for (let ds = 10; ds <= K.slowAheadM; ds += 10) { const w = vOf(segAt(loop, s + ds)); if (w < v) v = Math.min(v, Math.sqrt(w * w + 2 * K.decel * Math.max(0, ds - 30))); }   // at the slow speed 30 m before it
  return v;
}
// a run of d m from sFrom along the loop with the speed law (cruiseAt, accel up, decel into the stop): its time and the distance and
// speed t s into it (sampled every 0.25 s)
function runPlan(loop, sFrom, d, K = TOUR) {
  const dt = 0.25, xs = [0], vs = [0];
  let x = 0, v = 0;
  for (let i = 0; i < 40000 && x < d - 0.25; i++) {
    const want = Math.min(cruiseAt(loop, sFrom + x, K), Math.sqrt(2 * K.decel * Math.max(0, d - x)) + 0.05);
    v += Math.max(-K.decel * dt, Math.min(K.accel * dt, want - v)); v = Math.max(0.05, v);
    x = Math.min(d, x + v * dt); xs.push(x); vs.push(v);
  }
  const T = (xs.length - 1) * dt;
  return { T, at: (t) => { const f = Math.max(0, Math.min(xs.length - 1, t / dt)), i = Math.floor(f), j = Math.min(xs.length - 1, i + 1), u = f - i; return [xs[i] + (xs[j] - xs[i]) * u, vs[i] + (vs[j] - vs[i]) * u]; } };
}
// a run's profile (no yield): ease up at accel, cruise, ease down at decel; its time and the distance made good tIn s into it
function runProfile(d, K) {
  const vc = K.speedKn * KN, ta = vc / K.accel, td = vc / K.decel, da = 0.5 * vc * ta, dd = 0.5 * vc * td;
  if (d >= da + dd) {
    const tc = (d - da - dd) / vc, T = ta + tc + td;
    return { T, at: (t) => (t < ta ? [0.5 * K.accel * t * t, K.accel * t] : t < ta + tc ? [da + vc * (t - ta), vc] : [d - 0.5 * K.decel * (T - t) ** 2, K.decel * (T - t)]) };
  }
  const vp = Math.sqrt(2 * d * K.accel * K.decel / (K.accel + K.decel)), t1 = vp / K.accel, T = t1 + vp / K.decel;
  return { T, at: (t) => (t < t1 ? [0.5 * K.accel * t * t, K.accel * t] : [d - 0.5 * K.decel * (T - t) ** 2, K.decel * (T - t)]) };
}
// the nominal timetable (no yield): run times between the stops at cruise with the ease in and out, the stops' lengths, the period
const TT_CACHE = new Map();   // the timetable per loop and constants (its runs are sampled: made once)
export function tourTimetable(loop = routeLoop(), K = TOUR) {
  const key = `${loop.length.toFixed(3)}|${loop.seg.length}|${K.speedKn}|${K.fastKn}|${K.accel}|${K.decel}|${JSON.stringify(K.stopS)}`, hit = TT_CACHE.get(key);
  if (hit) return hit;
  const vc = K.speedKn * KN, rows = [];
  let period = 0;
  loop.stops.forEach((st, i) => {
    const nx = loop.stops[(i + 1) % loop.stops.length], d = ((nx.s - st.s) % loop.length + loop.length) % loop.length || loop.length;
    const stopS = K.stopS[st.id] ?? 240, plan = runPlan(loop, st.s, d, K), run = plan.T;
    rows.push({ stop: st.id, name: st.name, at: st.at, s: st.s, stopS, toNext: nx.id, runM: d, runS: run, t0: period, plan });
    period += stopS + run;
  });
  const tt = { rows, period, speedMs: vc, fastMs: (K.fastKn ?? K.speedKn) * KN };
  TT_CACHE.set(key, tt);
  return tt;
}
// a seeded hash in [0, 1)
const h01 = (a, b) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
// where she is on her loop at an hour of the day (game hours) for a seed: her timetable run on the clock from a seeded offset
// → { mode: 'stop' | 'run', row (the timetable row: the stop she is at, or the one she left), tIn (s into it), s (along the loop), v }
// (tauS: a pinned second of her timetable in place of the clock's: ?tourt=, the evidence's stills and the tests)
export function tourPhase(hour, seed = 1, loop = routeLoop(), K = TOUR, tauS = null) {
  const tt = tourTimetable(loop, K), t0 = tauS != null && Number.isFinite(tauS) ? tauS : hour * 3600 + h01(seed, 911) * tt.period, tau = ((t0 % tt.period) + tt.period) % tt.period;
  for (const row of tt.rows) {
    if (tau < row.t0 + row.stopS) return { mode: 'stop', row, tIn: tau - row.t0, s: row.s, v: 0, tau };
    if (tau < row.t0 + row.stopS + row.runS) { const tIn = tau - row.t0 - row.stopS, [d, v] = row.plan.at(tIn); return { mode: 'run', row, tIn, s: (row.s + d) % loop.length, v, tau }; }
  }
  const row = tt.rows[0]; return { mode: 'stop', row, tIn: 0, s: row.s, v: 0, tau };
}

// the five kayaks: crew 0 (empty), 1 (one paddler), 2 (a tandem pair); their painters (her frame: m forward, m to starboard):
// towed (two lines astern, each further kayak on the stern of the one before it) and tied (at a stop: the empty ones alongside her
// sides, the crewed ones on short lines astern until they cast off)
// The first birth of a page load (owner, 2026-11-19: "no matter where the boat is first born, the glass boat's loop ... visible within
// a minute ... after that, if the user is reborn at another place, it should be real"): a second of her timetable (tauS) such that from
// the birthplace she is within visM (with a line of sight over water: los(x0, z0, x1, z1), when given) at some moment of the first
// withinS seconds, and no nearer than minM at the start. Chosen by the birthplace's position, never the camera's framing: she is
// underway on her route or at a stop. Among the seconds that qualify the seed picks one; none qualify: the nearest pass. A rebirth
// never calls this (she stays where she is on her loop).
export function placeAt(ph, loop) { if (ph.mode === 'stop') return { x: ph.row.at[0], z: ph.row.at[1] }; const p = pointAt(loop, ph.s); return { x: p.x, z: p.z }; }
export function birthPhase(birth, { seed = 1, loop = routeLoop(), K = TOUR, visM = 1000, minM = 150, withinS = 60, stepS = 10, los = null } = {}) {
  const tt = tourTimetable(loop, K), ok = [], probe = [0, 20, 40, withinS];
  let best = null, bestD = Infinity;
  for (let tau = 0; tau < tt.period; tau += stepS) {
    let d0 = Infinity, dmin = Infinity;
    for (const dt of probe) {
      const p = placeAt(tourPhase(0, seed, loop, K, tau + dt), loop), d = Math.hypot(p.x - birth.x, p.z - birth.z);
      if (dt === 0) d0 = d;
      if (d < dmin && (!los || los(birth.x, birth.z, p.x, p.z))) dmin = d;
    }
    if (d0 < minM) continue;
    if (dmin <= visM) ok.push(tau);
    if (dmin < bestD) { bestD = dmin; best = tau; }
  }
  return ok.length ? ok[Math.min(ok.length - 1, Math.floor(h01(seed, 4242) * ok.length))] : (best ?? 0);
}

export const KAYAKS = Object.freeze([
  Object.freeze({ crew: 0, towed: Object.freeze({ at: [-6.4, -1.13], L: 5 }), tied: Object.freeze({ at: [-1.37, -2.0], L: 2.2 }) }),
  Object.freeze({ crew: 0, towed: Object.freeze({ at: [-6.4, 1.13], L: 5 }), tied: Object.freeze({ at: [-1.37, 2.0], L: 2.2 }) }),
  Object.freeze({ crew: 2, towed: Object.freeze({ chain: 0, L: 3.6 }), tied: Object.freeze({ at: [-6.3, -1.64], L: 5 }), seed: 4101 }),
  Object.freeze({ crew: 1, towed: Object.freeze({ chain: 1, L: 3.6 }), tied: Object.freeze({ at: [-6.3, 1.64], L: 5 }), seed: 4207 }),
  Object.freeze({ crew: 1, towed: Object.freeze({ chain: 2, L: 3.6 }), tied: Object.freeze({ at: [-6.3, 0], L: 6 }), seed: 4319 }),
]);
// the night LEDs inside each clear hull (kits glow the water under the hull; dim, slow, no flashing): linear rgb
const KAYAK_LEDS = Object.freeze([[0.10, 0.85, 0.80], [0.18, 0.40, 1.0], [0.55, 0.30, 1.0], [0.20, 0.75, 1.0], [0.10, 0.85, 0.80]]);

// the yield's read of the player (her frame): { slow 0..1 (1 cruise), side: −1 the player to port, +1 to starboard, off: |bearing|° }
export function yieldTo(boat, S, K = TOUR) {
  if (!S) return { slow: 1, side: 0, off: 180 };
  const Y = K.yield, fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), dx = S.x - boat.x, dz = S.z - boat.z;
  const fwd = dx * fx + dz * fz, side = dx * -fz + dz * fx, d = Math.hypot(dx, dz);   // starboard: (cos h, sin h) = (−fz, fx)
  const off = Math.abs(Math.atan2(side, fwd)) / DEG;
  const inBox = fwd > -Y.behindM && fwd < Y.aheadM && Math.abs(side) < Y.sideM + Math.max(0, fwd) * Y.sideGrow;
  if (!inBox && d > Y.stopM * 1.6) return { slow: 1, side: 0, off, d };
  const slow = Math.max(0, Math.min(1, (Math.min(d, Math.max(fwd, 0) + Math.abs(side) * 0.5) - Y.stopM) / (Y.slowM - Y.stopM)));
  return { slow, side: side >= 0 ? 1 : -1, off, d };
}

// a paddler's agent for v1's hull model (src/sim/kayaks/agent.js): the fields steerTo and stepHull read
const agentOf = (x, z, heading) => ({ x, z, heading, v: 0, r: 0, turning: 0, intent: { throttle: 0, turn: 0 }, w: Object.fromEntries(GAITS.map((g) => [g, g === 'rest' ? 1 : 0])), wm: Object.fromEntries(GAITS.map((g) => [g, g === 'rest' ? 1 : 0])), phase: 0, look: null, roll: 0 });

export function createTourBoat({ route = TOUR_ROUTE, depthAt = () => 10, onBump = null, hour = 13, seed = 1, tauS = null, K = TOUR, kayaks: nK = KAYAKS.length, clips: clips0 = null } = {}) {
  const loop = routeLoop(route), vc = K.speedKn * KN, P = K.kayak;
  let clips = clips0;
  // a fresh page: where her timetable puts her at this hour for this seed (a natural schedule, never aimed at the start's camera)
  const ph = tourPhase(hour, seed, loop, K, tauS), stIdx = loop.stops.findIndex((s) => s.id === ph.row.stop);
  const pAt = pointAt(loop, ph.mode === 'stop' ? ph.s - 1 : ph.s), here = ph.mode === 'stop' ? { x: ph.row.at[0], z: ph.row.at[1] } : pAt;
  const boat = { x: here.x, z: here.z, heading: Math.atan2(pAt.dx, -pAt.dz), v: ph.v, s: ph.s, mode: ph.mode, stop: ph.mode === 'stop' ? ph.row.stop : null,
    stopIdxAt: stIdx, stopIdx: (stIdx + 1) % loop.stops.length, stopTotal: ph.row.stopS, stopLeft: ph.mode === 'stop' ? Math.max(1, ph.row.stopS - ph.tIn) : 0,
    lat: 0, latSide: 0, clearT: 0, yieldT: 0, yielding: false, slow: 1, ox: 0, oz: 0, heel: 0 };   // heel: Tessie's knock (rad, + starboard down)
  let knockS = null;   // { side, t: s since her weight landed }
  const kayaks = KAYAKS.slice(0, nK).map((row, i) => {
    const look = row.crew ? pickLook(row.seed + seed * 31) : null, look2 = row.crew === 2 ? pickLook(row.seed + 77 + seed * 31, { sex: look.sex }) : null;   // the tandem's bow paddler: the stern's stroke, so the same figure
    return { i, row, crew: row.crew, x: boat.x, z: boat.z, vx: 0, vz: 0, heading: boat.heading, led: KAYAK_LEDS[i % KAYAK_LEDS.length], ph: i * 1.7 + 0.4,
      free: false, a: row.crew ? agentOf(boat.x, boat.z, boat.heading) : null, st: null, look, look2, seed: (row.seed ?? 0) + seed * 1009, goal: null, restLeft: 0, leg: 0, events: null };
  });
  // the lines: 0 towed … 1 tied (eased over payS); a stop just begun is still paying them out
  let spread = ph.mode === 'stop' ? Math.min(1, ph.tIn / P.payS) : 0;
  const local = (f, s) => { const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading); return [boat.x + boat.ox + fx * f - fz * s, boat.z + boat.oz + fz * f + fx * s]; };
  const painterOf = (k, m) => {
    const T = k.row.towed, Ti = k.row.tied;
    let ta;
    if (T.chain != null) { const c = kayaks[T.chain], fx = Math.sin(c.heading), fz = -Math.cos(c.heading); ta = [c.x - fx * P.length / 2, c.z - fz * P.length / 2]; } else ta = local(T.at[0], T.at[1]);
    const ts = local(Ti.at[0], Ti.at[1]);
    return { ax: ta[0] + (ts[0] - ta[0]) * m, az: ta[1] + (ts[1] - ta[1]) * m, L: T.L + (Ti.L - T.L) * m };
  };
  // a paddler's next goal: a point on the wander ring round her, in water at least depthM + 0.5, on its own side of her
  function nextGoal(k) {
    for (let tries = 0; tries < 8; tries++) {
      const u = h01(k.seed, k.leg * 13 + tries), v = h01(k.seed + 1, k.leg * 7 + tries);
      const side = k.i % 2 ? 1 : -1, ang = boat.heading + side * (0.4 + 2.3 * u), r = P.roam[0] + (P.roam[1] - P.roam[0]) * v;
      const gx = boat.x + Math.sin(ang) * r, gz = boat.z - Math.cos(ang) * r;
      if (depthAt(gx, gz) >= K.clear.depthM + 0.5) { k.leg++; return [gx, gz]; }
    }
    k.leg++; return [boat.x + Math.sin(boat.heading + Math.PI) * P.roam[0], boat.z - Math.cos(boat.heading + Math.PI) * P.roam[0]];
  }
  const castOffDue = () => boat.mode === 'stop' && spread > 0.95 && boat.stopLeft > P.backS + 30;
  // lay the kayaks out at once (a fresh page: her timetable has run a while): the paddlers out on the ring mid-stop, else on their lines
  function layKayaks(windFromDeg) {
    const dwx = -Math.sin(windFromDeg * DEG), dwz = Math.cos(windFromDeg * DEG), m = spread * spread * (3 - 2 * spread);
    const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
    for (const k of kayaks) {
      if (k.crew && castOffDue()) {
        const g = nextGoal(k), next = nextGoal(k);
        k.x = g[0]; k.z = g[1]; k.goal = next; k.free = true; k.heading = Math.atan2(next[0] - k.x, -(next[1] - k.z));
        Object.assign(k.a, { x: k.x, z: k.z, heading: k.heading, v: 0.9 });
        continue;
      }
      const p = painterOf(k, m), tow = boat.mode === 'run', ux = tow ? -fx : dwx, uz = tow ? -fz : dwz;   // underway: astern; at rest: downwind
      k.x = p.ax + ux * p.L * 0.95; k.z = p.az + uz * p.L * 0.95; k.heading = Math.atan2(p.ax - k.x, -(p.az - k.z));
      if (k.a) Object.assign(k.a, { x: k.x, z: k.z, heading: k.heading, v: tow ? boat.v : 0 });
    }
    separate(null);
  }
  // keep the kayaks apart, off her hull and off the player's (pushed, never a shove on the player)
  const PL_CIRCLES = [[2.7, 1.05], [0, 1.5], [-2.65, 1.25]];
  function separate(S) {
    const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), hl = K.length / 2 + P.r * 0.8, hw = K.beam / 2 + P.r * 0.6;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < kayaks.length; a++) for (let b = a + 1; b < kayaks.length; b++) {
        const A = kayaks[a], B = kayaks[b], dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), m = P.r * 1.6;
        if (d < m && d > 1e-6) { const e = (m - d) / 2; A.x -= dx / d * e; A.z -= dz / d * e; B.x += dx / d * e; B.z += dz / d * e; }
      }
      for (const k of kayaks) {
        const dx = k.x - boat.x - boat.ox, dz = k.z - boat.z - boat.oz, f = dx * fx + dz * fz, s = dx * -fz + dz * fx;
        if (Math.abs(f) < hl && Math.abs(s) < hw) {   // inside her hull: out by the nearest side
          const pf = hl - Math.abs(f), ps = hw - Math.abs(s);
          if (ps < pf) { const ns = Math.sign(s) || 1, s2 = ns * hw; k.x += -fz * (s2 - s); k.z += fx * (s2 - s); } else { const nf = Math.sign(f) || -1, f2 = nf * hl; k.x += fx * (f2 - f); k.z += fz * (f2 - f); }
        }
        if (S) {
          const sx = Math.sin(S.heading), sz = -Math.cos(S.heading);
          for (const [cf, cr] of PL_CIRCLES) { const cx = S.x + sx * cf, cz = S.z + sz * cf, ex = k.x - cx, ez = k.z - cz, d = Math.hypot(ex, ez), m = cr + P.r * 0.7; if (d < m && d > 1e-6) { k.x += ex / d * (m - d); k.z += ez / d * (m - d); k.vx += ex / d * 0.3; k.vz += ez / d * 0.3; } }
        }
        if (k.a) { k.a.x = k.x; k.a.z = k.z; }
      }
    }
  }
  // the hull circles, light bodies on short rodes (the bump)
  const circles = K.hull.map(([f, r], i) => ({ id: `tour:${i}`, f, x: boat.x, z: boat.z, r, mass: K.circleKg }));
  const bodies = createMarkBodies(circles, { onBump, rode: K.rode });
  // her wake's record and her kayaks' (render/vesselWake.js): every TRAIL.dt s, kept TRAIL.keep s (the kayaks' TRAIL.kayakKeep s)
  const trail = []; let trailT = 0, vPrev = boat.v;
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const k of kayaks) { k.trail = []; k.px = k.x; k.pz = k.z; }
  // the wake's points: her stern every 0.8 s while making way (newest first), each { x, z, age, v, dx, dz }
  const wake = [], WAKE_N = 36, WAKE_DT = 0.8;
  let wakeT = 0, active = true, ticks = 0, laid = false, others = null;
  const stats = { yields: 0, stops: 0, castOff: 0, tiedOn: 0 };

  let holdLeft = 0;   // Glass Boat Chase (chase()): held at her stop until the gun, then away on her route
  let curious = null;   // Tessie's Lure: { x, z, left } (s)
  function steer(dt, S) {
    if (holdLeft > 0) { holdLeft -= dt; boat.v = 0; return; }
    if (boat.mode === 'stop') {
      boat.v = Math.max(0, boat.v - K.decel * dt);
      boat.stopLeft -= dt;
      // she leaves once the time is up, every paddler is tied on again (they head back backS before) and the lines are in
      if (boat.stopLeft <= 0 && kayaks.every((k) => !k.free) && spread < 0.02) { boat.mode = 'run'; boat.s = (loop.stops[boat.stopIdxAt].s + 0.5) % loop.length; boat.stop = null; }
      return;
    }
    // the run: the next stop's distance along the loop, the speed she wants (braking into it), the yield
    const nx = loop.stops[boat.stopIdx], dStop = Math.hypot(nx.at[0] - boat.x, nx.at[1] - boat.z);
    let toStop = ((nx.s - boat.s) % loop.length + loop.length) % loop.length;
    if (toStop > loop.length - 40 || dStop < 25) toStop = Math.min(toStop > loop.length - 40 ? dStop : toStop, dStop);   // the stop is a corner: near it, the straight distance
    let y = yieldTo(boat, S, K); const Y = K.yield;
    if (others) for (const o of others) { const yo = yieldTo(boat, o, K); if (yo.slow < y.slow) y = yo; }   // the lake's boats too (setOthers)
    const wasY = boat.yielding;
    boat.yielding = y.slow < 1; boat.slow = y.slow;
    if (boat.yielding && !wasY) stats.yields++;
    if (boat.yielding) { if (!boat.clearT) boat.latSide = -y.side; boat.clearT = Y.clearS; boat.yieldT += dt; } else { boat.clearT = Math.max(0, boat.clearT - dt); if (!boat.clearT) boat.yieldT = 0; }
    // once she has turned the player off her bow (and is not close), she creeps past on the bent route rather than wait for ever
    let slow = y.slow;
    if (boat.yielding && y.off > Y.creepDeg && (y.d ?? 99) > Y.stopM) slow = Math.max(slow, Y.creep);
    const brake = Math.max(dStop > K.arriveM ? 0.3 : 0, Math.sqrt(2 * K.decel * Math.max(0, toStop - K.arriveM * 0.5)));
    // near the stop, slow while her bow is off the spot (she noses in rather than circle it)
    const errStop = dStop < 40 ? Math.abs(wrapPi(Math.atan2(nx.at[0] - boat.x, -(nx.at[1] - boat.z)) - boat.heading)) : 0;
    const vcNow = cruiseAt(loop, boat.s, K);   // the bay's speed, or the open lake's (eased down ahead of the bay)
    const want = Math.min(vcNow * slow, brake * Math.max(0.2, Math.cos(Math.min(errStop, Math.PI / 2))));
    boat.v += Math.max(-K.decel * dt * (slow < 0.3 ? 2.5 : 1), Math.min(K.accel * dt, want - boat.v));
    boat.v = Math.max(0, boat.v);
    // her route bent to the side away from the player while she yields (and clearS after; wider the longer she waits), back after;
    // never into shallows
    const latM = Y.latM + (Y.latMax - Y.latM) * Math.min(1, boat.yieldT / Y.longS);
    const latWant = boat.clearT > 0 ? boat.latSide * latM : 0;
    boat.lat += Math.max(-Y.latRate * dt, Math.min(Y.latRate * dt, latWant - boat.lat));
    const tp = pointAt(loop, boat.s + K.look);
    let tx = tp.x - tp.dz * boat.lat, tz = tp.z + tp.dx * boat.lat;   // starboard of the route: (−dz, dx)
    if (toStop < K.look * 1.2 && Math.abs(boat.lat) < 0.5) { tx = nx.at[0]; tz = nx.at[1]; }   // into the stop: aim at its spot
    if (depthAt(tx, tz) < K.clear.depthM + 0.5) { boat.lat *= 0.9; tx = tp.x; tz = tp.z; }
    // curious (Tessie's Lure): off her route toward the ring at the bay's speed, slowing to a stop LURE.arriveM from it; the yield still slows her
    if (curious) {
      curious.left -= dt;
      const dc = Math.hypot(curious.x - boat.x, curious.z - boat.z), ahead = boat.x + (curious.x - boat.x) * Math.min(1, 30 / Math.max(1, dc)), aheadZ = boat.z + (curious.z - boat.z) * Math.min(1, 30 / Math.max(1, dc));
      if (curious.left <= 0 || depthAt(ahead, aheadZ) < K.clear.depthM + 0.5) curious = null;
      else {
        tx = curious.x; tz = curious.z;
        const vWant = dc > LURE.arriveM ? Math.min(K.speedKn * KN, Math.sqrt(2 * K.decel * Math.max(0, dc - LURE.arriveM))) * slow : 0;
        if (boat.v > vWant) boat.v = Math.max(vWant, boat.v - K.decel * dt * 2);
        if (dc <= LURE.arriveM) { tx = boat.x + Math.sin(boat.heading); tz = boat.z - Math.cos(boat.heading); }   // there: she holds her heading, drifting to a stop
      }
    }
    const wantH = Math.atan2(tx - boat.x, -(tz - boat.z)), rate = K.yawRate * DEG * Math.max(0.25, Math.min(1, boat.v / vc));
    boat.heading = wrapPi(boat.heading + Math.max(-rate * dt, Math.min(rate * dt, wrapPi(wantH - boat.heading))));
    boat.x += Math.sin(boat.heading) * boat.v * dt; boat.z -= Math.cos(boat.heading) * boat.v * dt;
    boat.s = projectOn(loop, boat.x, boat.z, boat.s, 30);
    if (dStop < K.arriveM * 2 && boat.v < 0.4) {
      boat.mode = 'stop'; boat.stop = nx.id; boat.stopTotal = boat.stopLeft = K.stopS[nx.id] ?? 240; boat.stopIdxAt = boat.stopIdx; boat.stopIdx = (boat.stopIdx + 1) % loop.stops.length; stats.stops++;
    }
  }
  // a crewed kayak paddling free: toward its goal on v1's steering and hull model, the stroke on the clips when they are in; at the
  // goal a rest (a drift on the wind); backS before she leaves, back to its painter's end, then tied on
  function paddle(k, dt) {
    const a = k.a;
    const back = boat.mode !== 'stop' || boat.stopLeft < P.backS;
    let gx, gz, throttle = 0.5;
    if (back) {   // home to a spot off its painter's end, out from her hull; from forward of her beam, round her side first
      const Ti = k.row.tied.at, fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), dx = a.x - boat.x, dz = a.z - boat.z;
      const f = dx * fx + dz * fz, sd = dx * -fz + dz * fx;
      [gx, gz] = f > Ti[0] + 2 && Math.abs(sd) < K.beam / 2 + 5 ? local(Ti[0] + 1, (Math.sign(sd) || 1) * (K.beam / 2 + 5)) : local(Ti[0] - (Ti[0] < -3 ? 3.5 : 0), Ti[1] * (Ti[0] < -3 ? 1.6 : 2.2));
    }
    else if (k.restLeft > 0) { k.restLeft -= dt; throttle = 0; gx = a.x + Math.sin(a.heading); gz = a.z - Math.cos(a.heading); if (k.restLeft <= 0) k.goal = nextGoal(k); }
    else { if (!k.goal) k.goal = nextGoal(k); [gx, gz] = k.goal; if (Math.hypot(gx - a.x, gz - a.z) < 4) { k.restLeft = P.restS[0] + (P.restS[1] - P.restS[0]) * h01(k.seed + 5, k.leg); throttle = 0; } }
    steerTo(a, Math.atan2(gx - a.x, -(gz - a.z)), throttle);
    const F0 = meanForce(a.w);
    stepHull(a, dt);
    if (clips) {
      k.st ??= createStroke({ clips, sex: k.look.sex, seed: k.seed, phase: a.phase });
      const o = strokeStep(k.st, a, dt);
      a.v += (o.F - F0) / HULL.M * dt; a.r += o.M / HULL.I * dt;
      a.phase = k.st.ph; k.events = o.events;
    }
    k.x = a.x; k.z = a.z; k.heading = a.heading;
    if (back) { const p = painterOf(k, 1); if (Math.hypot(p.ax - k.x, p.az - k.z) < p.L + P.tieM) { k.free = false; stats.tiedOn++; k.vx = 0; k.vz = 0; } }
  }
  function kayakStep(dt, windFromDeg, t, S) {
    // the lines: out over payS once she has stopped, in again once the time is up and the paddlers are back
    const want = boat.mode === 'stop' && (boat.stopLeft > 0 || kayaks.some((k) => k.free)) ? 1 : 0;
    spread += Math.max(-dt / P.payS, Math.min(dt / P.payS, want - spread));
    const m = spread * spread * (3 - 2 * spread);
    const dwx = -Math.sin(windFromDeg * DEG), dwz = Math.cos(windFromDeg * DEG), k1 = 1 - Math.exp(-dt / P.dragS);
    for (const k of kayaks) {
      // cast off: a paddler's line slips once she has stopped and the lines are out (and there is time to paddle)
      if (k.crew && !k.free && castOffDue()) { k.free = true; k.goal = nextGoal(k); k.restLeft = 0; Object.assign(k.a, { x: k.x, z: k.z, heading: k.heading, v: 0 }); stats.castOff++; }
      if (k.free) { paddle(k, dt); continue; }
      // on its painter: the water's drag toward the wind's drift (an empty hull drifts), a slow wander either side
      const wv = P.wander * Math.sin(t * 0.21 + k.ph), wx = dwx * P.driftMs - dwz * wv, wz = dwz * P.driftMs + dwx * wv;
      k.vx += (wx - k.vx) * k1; k.vz += (wz - k.vz) * k1;
      k.x += k.vx * dt; k.z += k.vz * dt;
      const p = painterOf(k, m), ex = k.x - p.ax, ez = k.z - p.az, d = Math.hypot(ex, ez);
      if (d > p.L && d > 1e-6) {   // the painter taut: back on its circle, the outward speed gone (an inelastic line)
        const ux = ex / d, uz = ez / d, pull = Math.min(1, dt * 6);
        k.x -= ux * (d - p.L) * pull; k.z -= uz * (d - p.L) * pull;
        const vr = k.vx * ux + k.vz * uz; if (vr > 0) { k.vx -= vr * ux; k.vz -= vr * uz; }
      }
      // the bow toward her painter (a towed or a riding hull lies to its line), eased; a paddler sits at rest (the rest gait)
      const hb = Math.atan2(p.ax - k.x, -(p.az - k.z));
      k.heading = wrapPi(k.heading + wrapPi(hb - k.heading) * (1 - Math.exp(-dt / (d > p.L * 0.9 ? 2.5 : 6))));
      if (k.a) {
        Object.assign(k.a, { x: k.x, z: k.z, heading: k.heading, v: Math.hypot(k.vx, k.vz), r: 0, turning: 0 });
        const kk = 1 - Math.exp(-dt / 0.24); let hz = 0;
        for (const g of GAITS) { const tw = g === 'rest' ? 1 : 0; k.a.wm[g] += (tw - k.a.wm[g]) * kk; k.a.w[g] += (k.a.wm[g] - k.a.w[g]) * kk; hz += k.a.w[g] * GAIT[g].hz; }
        k.a.phase = (k.a.phase + hz * dt) % 1; if (k.st) k.st.ph = k.a.phase; k.events = null;
      }
    }
    separate(S);
  }
  function post(S, dt, t = 0, windFromDeg = () => 270) {
    if (knockS && dt > 0) { knockS.t += dt; boat.heel = knockHeel(knockS.t, knockS.side, K); if (knockS.t > (K.knock ?? TOUR.knock).rightS + (K.knock ?? TOUR.knock).upS) { knockS = null; boat.heel = 0; } }
    if (!active) return;
    ticks++;
    const wf = windFromDeg(boat.x, boat.z);
    if (!laid) { laid = true; layKayaks(wf); }
    steer(dt, S);
    // the circles' stations from her place; her drawn place moves with their mean offset (a bump shoves her a little)
    const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), bs = bodies.bodies;
    for (let i = 0; i < circles.length; i++) { const nx = boat.x + fx * circles[i].f, nz = boat.z + fz * circles[i].f; if (ticks === 1 || !S) { bs[i].x = nx; bs[i].z = nz; bs[i].vx = 0; bs[i].vz = 0; } bs[i].x0 = nx; bs[i].z0 = nz; }
    if (S) bodies.post(S, dt, t);
    boat.ox = 0; boat.oz = 0;
    for (let i = 0; i < circles.length; i++) { boat.ox += (bs[i].x - bs[i].x0) / circles.length; boat.oz += (bs[i].z - bs[i].z0) / circles.length; }
    kayakStep(dt, wf, t, S);
    // the wake's points
    for (const w of wake) w.age += dt;
    wakeT += dt;
    if (wakeT >= WAKE_DT) { wakeT = 0; if (boat.v > 0.25) wake.unshift({ x: boat.x - fx * K.length * 0.5, z: boat.z - fz * K.length * 0.5, age: 0, v: boat.v, dx: fx, dz: fz }); }
    while (wake.length > WAKE_N || (wake.length && wake[wake.length - 1].age > WAKE_N * WAKE_DT * 1.4)) wake.pop();
    // the wake's record: her place, heading, speed and the props' churn; the kayaks' places and speeds
    for (const p of trail) p.age += dt;
    for (const k of kayaks) for (const p of k.trail) p.age += dt;
    trailT += dt;
    if (trailT >= TRAIL.dt) {
      const span = trailT; trailT = 0;
      const decel = (vPrev - boat.v) / span; vPrev = boat.v;
      // the wash: by her speed through the water, and as she slows into a stop the outboards' reverse thrust churns a swirl
      const churn = 0.9 * smooth(0.3, 1.6, boat.v) + (decel > 0.015 && boat.v < 1.6 ? 0.55 * smooth(0.05, 0.6, boat.v) : 0);
      trail.unshift({ age: 0, x: boat.x + boat.ox, z: boat.z + boat.oz, fx, fz, v: boat.v, churn });
      while (trail.length && (trail.length > TRAIL.keep / TRAIL.dt + 1)) trail.pop();
      for (const k of kayaks) {
        const v = Math.hypot(k.x - k.px, k.z - k.pz) / span; k.px = k.x; k.pz = k.z;
        const kx = Math.sin(k.heading), kz = -Math.cos(k.heading);
        k.trail.unshift({ age: 0, x: k.x, z: k.z, fx: kx, fz: kz, v, churn: 0.32 * smooth(0.5, 1.6, v) });
        while (k.trail.length > TRAIL.kayakKeep / TRAIL.dt + 1) k.trail.pop();
      }
    }
  }
  // her nav lights (COLREGs rule 23(d): a power-driven vessel under 12 m may show an all-round white light and sidelights): the
  // all-round white on its pole over the roof's after edge, red and green in their housings on the bow rail's corners; by the night's ramp (0 by day)
  const LENS = Object.freeze([{ at: [-4.9, 3.78, 0], c: [1.0, 0.95, 0.85], kind: 'all' }, { at: [4.98, 1.58, -1.85], c: [1.0, 0.22, 0.16], kind: 'red' }, { at: [4.98, 1.58, 1.85], c: [0.2, 1.0, 0.45], kind: 'green' }]);   // (her frame: m forward, m up, m to starboard; render/tourBoatMesh.js: the pole over the roof's after edge, the housings on the bow rail)
  function lights(out, o, { sunElevDeg = 90, eye = [0, 0, 0], heightAt = () => 0 } = {}) {
    const level = navLevel(sunElevDeg);
    if (!active || !(level > 0)) return 0;
    const cap = Math.floor((out.length - o) / GLOW_FLOATS), fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), x0 = boat.x + boat.ox, z0 = boat.z + boat.oz, y0 = heightAt(x0, z0);
    let n = 0;
    for (const L of LENS) {
      if (n >= cap) break;
      const [f, y, s] = L.at, x = x0 + fx * f - fz * s, z = z0 + fz * f + fx * s, w = o + n * GLOW_FLOATS;
      const dx = eye[0] - x, dz = eye[2] - z, brg = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) / DEG;
      out[w] = x; out[w + 1] = y0 + y; out[w + 2] = z; out[w + 3] = -K.light.size;   // a far point light (render/night.js FAR_POINT)
      out[w + 4] = L.c[0]; out[w + 5] = L.c[1]; out[w + 6] = L.c[2];
      out[w + 7] = K.light.radiance * level * (L.kind === 'all' ? 1 : navSector(L.kind, brg));
      n++;
    }
    return n;
  }
  return {
    boat, kayaks, wake, trail, bodies, loop, post, lights, stats, timetable: () => tourTimetable(loop, K), phase0: ph,
    // her and her kayaks as wake emitters (render/vesselWake.js): her twin outboards to starboard of the swim platform, her two tubes'
    // noses; each kayak a small V and a short swirl
    emitters() {
      const tail = K.length * 0.5 - 0.2;
      const out = [{ trail, length: K.length, kelvinAmp: 2.7, arms: { foam: 0.65, w: 0.7, life: 7, x0: 1.45 }, noses: [[K.length * 0.5 - 0.1, -1.15], [K.length * 0.5 - 0.1, 1.15]], noseR: 0.43,   // (the 40 ft class: the V a little stronger, the tubes 1.15 m out)
        lines: [{ x: 0.82, aft: K.length * 0.5 + 0.5, w: 1.75, foam: 1.15, life: 36 }, { x: -1.15, aft: tail, w: 0.8, foam: 0.5, life: 8 }, { x: 1.15, aft: tail, w: 0.8, foam: 0.5, life: 8 }] }];
      for (const k of kayaks) out.push({ trail: k.trail, length: P.length, noses: [[P.length * 0.5 - 0.15, 0]], noseR: 0.12, noseFoam: 0.5, kelvinAmp: 0,
        lines: [{ x: 0, aft: P.length * 0.45, w: 0.5, foam: 1, life: 5 }] });
      return out;
    },
    setClips(c) { clips = c; },
    // Glass Boat Chase (v2/sim/racePlaces.js): she lies at a stop (the Fannette stop), her kayaks towed astern, the
    // lines in, held holdS s (the race's countdown), then leaves on her own route at her own speed law (eased up, 4 kn in the bay):
    // cheat on where and when, never on motion. Her wake starts afresh (glassChase.js reads its points for the wash)
    // preS: she left the stop that long before (her run stepped on now, from rest: her head start at the gun)
    chase({ stop = 'fannette', holdS = 0, preS = 0 } = {}) {
      const i = Math.max(0, loop.stops.findIndex((x) => x.id === stop)), st = loop.stops[i], p = pointAt(loop, st.s + 1);
      Object.assign(boat, { x: st.at[0], z: st.at[1], heading: Math.atan2(p.dx, -p.dz), v: 0, s: (st.s + 0.5) % loop.length, mode: 'run', stop: null, stopIdxAt: i, stopIdx: (i + 1) % loop.stops.length,
        stopLeft: 0, lat: 0, latSide: 0, clearT: 0, yieldT: 0, yielding: false, slow: 1, ox: 0, oz: 0 });
      spread = 0; for (const k of kayaks) { k.free = false; k.goal = null; k.trail.length = 0; }
      wake.length = 0; trail.length = 0; wakeT = 0; trailT = 0; vPrev = 0; laid = false; ticks = 0;
      holdLeft = Math.max(0, holdS); active = true;
      for (let t = 0; t < preS && holdLeft <= 0; t += 0.1) this.post(null, 0.1, t);
      return boat;
    },
    get held() { return holdLeft > 0; },
    // Tessie's weight on her rail: she heels to `side` (+1 starboard) and rights in K.knock.rightS (a scripted hull)
    knock(side = 1) { knockS = { side: side >= 0 ? 1 : -1, t: 0 }; return true; },
    // Tessie's Lure: underway she turns curious toward (x, z) for s seconds; her free paddlers within r paddle over
    lure(x, z, s = 12, r = 120) {
      let n = 0;
      if (active && boat.mode === 'run' && holdLeft <= 0 && !knockS) { curious = { x, z, left: s }; n++; }
      for (const k of kayaks) if (k.free && k.crew && Math.hypot(k.x - x, k.z - z) <= r && boat.stopLeft >= P.backS) { k.goal = [x + (k.x - x) * 0.25, z + (k.z - z) * 0.25]; k.restLeft = 0; n++; }   // a paddle's length short of the ring
      return n > 0;
    },
    get curious() { return curious ? { ...curious } : null; },
    get knocked() { return !!knockS; },
    // the other boats she yields to besides the player (the busy lake's cruising boats, v2/living/busyLake.js: rule 18, a power-driven vessel
    // keeps clear of one under sail): [{ x, z }] read each tick, the nearest in her yield box wins (null: the player alone)
    setOthers(list) { others = list ?? null; },
    get spread() { return spread; },
    get active() { return active; }, set active(v) { active = !!v; },
    get bumps() { return bodies.stats.bumps; },
  };
}
