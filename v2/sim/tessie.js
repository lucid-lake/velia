// Tessie, the lake's legend (owner, 2026-11-17): the director and the body, pure (no GPU, no three,
// no Math.random, no wall clock: the page's seed and the living clock only). The sim is the truth for where she is: the
// drawing (render/tessie.js), the water's creature map, the skipper's line, the stats and the tests all read it.
//
// When: the stage director (v2/stage/director.js) owns every sighting's time: the opening's
// about 25 s into play, then the random pool's; it calls cue() and the sim places her at its next step. Never during a race
// (a race sends her down). When one is cued it places her
// in the camera's view: 25–40° off the bow, 50–90 m off for the first one (60–200 m later), in water at least 8 m deep (10–38 m
// preferred: the clear water then shows her dark shape before she surfaces), 40 m off the shore, 35 m or more off the boat's
// track for the next 40 s, her whole length inside the view. "Cheat on where and when, never on motion": only her spot and
// her time are chosen; she swims like an animal.
//
// The body (§ 3.2, M1): her nose swims a gentle arc at TESSIE.U (1.8 m/s, a turn of under 2°/s); the spine's 64 frames
// follow the nose's path (follow the leader), so the body bends only where the nose went. Vertically: the whole body rises
// from 4.5 m down; two or three humps travel back along her at 1.2 × her speed (the thrust of a vertical undulation: in the
// water they drift back slowly); the neck rises in a length-keeping arc (about 3 m) and turns her head toward the boat; the
// tail flicks; she dives nose first (each point dives when the nose's dive reaches it). A boat closing inside 28 m makes her
// dive at once (she never comes within 15 m of the hull).
//
// Her water (owner, 2026-11-17: "Tessie is like a boss in a certain area"): with an area ({ x, z, r }: the
// stage's 'tessieWaters' row, v2/stage/areas.js) she keeps to it. While the boat is inside it or within T.areaNearM of its edge,
// each sighting is placed inside it (her body's centre at least T.areaInsetM inside the edge, still in the camera's view; after
// T.areaFreeAfter refused tries the view rule gives way: she rises in her water anyway). The opening sighting is placed in her
// water only when a spot there fits at once. How often she comes (more often near her water) is the stage's: the tessie act's
// nearby row (v2/stage/acts.js).
//
//   const t = createTessie({ seed, depthAt, L, area })    depthAt(x, z): the water's depth (m, > 0 over water)
//   t.step(dt, { playing, boat: { x, z, heading, speed }, view: { x, z, yaw, hHalf }, race })
//        heading: rad, forward = (sin h, −cos h) (the boat's convention); view.yaw the same
//   t.cue() / t.cancel() / t.cued                    the stage director's: a sighting due now (placed at the next step that
//                                                    finds a spot; retried every T.retryS), or no longer
//   t.now(offset)                                    ?tessie=now: a sighting now, `offset` s into its timeline
//   t.state     { phase, visible, t, spine (Float32Array N × 8: x y z 0, up x y z 0), wetAge, centre, radius, water, clear }
//
// M3 (owner, 2026-11-18): the boat is solid to her. The step's boat may carry its drawn pose (heave, heel, pitch, boomAngle,
// jibAngle: B.pose); each frame her spine is held outside the boat's proxy (v2/sim/tessieClear.js: the hull, the keel, the
// rudder, the mast, the boom and the sails, posed with the heel) by her radius (the flippers' reach where they are) and
// CLEAR.margin, the push spread along her so her body bends round the hull. st.clear is the least gap this frame (m; Infinity
// when the boat is far). Her nose also swims a 3-D path: depth(dy) sends it dy m under her swimming depth (an animal's 1.2 m/s
// up or down at most) and the body follows it there, so a dive under the keel is a path every point of her takes. A nose about
// to meet the hull ducks under it (the reflex) unless she means to touch (contact(true): the revenge's strike).
//   t.stats()   the schedule, the sightings (spot, distance, bearing, depth), the line
import { createBoatClear, CLEAR } from './tessieClear.js';   // M3: the boat is solid to her (owner, 2026-11-18)

export const TESSIE = Object.freeze({
  retryS: 5,            // no spot fits: try again this much later (the sighting stays cued)
  U: 3.0,               // m/s, her swimming speed (a big swimmer's cruise, 6 kn: she keeps with a sailing boat)
  holdS: [6, 12],       // s after the break she must still be in the view (the boat sails on)
  turnDeg: [1.0, 1.8],  // °/s, her gentle turn (seeded; away from the boat's track)
  L: 19.0,              // m along the spine (the asset's own length replaces it)
  N: 64,                // spine frames
  firstR: [50, 55, 60, 70, 80, 90], laterR: [90, 70, 120, 150, 200],   // m off the boat
  bear: [30, 35, 25, 40],         // ° off the bow
  // ° her course off the boat's heading, + toward her side: she swims with the boat, a little in toward its line (the track
  // rule keeps her 35 m off it) so the camera behind the boat sees her side, not her tail
  course: [-25, -20, -12, 0, 10],
  depthMin: 8, depthPath: 6, depthGood: [10, 38], shoreM: 40, trackM: 30, trackS: 40, viewK: 0.9,
  nearM: 22,            // m: a boat this close (or 9 s from her at its closing speed) makes her sink and dive at once
  nearS: 9, sinkM: 4, sinkS: 2.5,
  lead: 4,              // s from the sighting's start (the rise) to the break
  // the timeline (s from the start): the rise, the humps, the neck, the tail flick, the dive
  rise: [0, 4.5], humps: [2.5, 5.5], neckUp: [5.0, 8.5], neckDown: [17.5, 20.5], flick: [13, 18], dive: 20, diveS: 5,
  base: [-4.5, -0.75], humpA: 0.7, lambda: 5.5, waveK: 1.2, neckS: 4.6, neckRise: 1.5, flickM: 2.2, diveM: 6,
  turnMax: 25,          // °/s, her sharpest turn at speed (an animal's; the chase API steers within it)
  speedMax: 19.5,       // m/s, her top speed (about 38 kn: play as Tessie's 19 m/s dash under the water and a margin)
  bankS: Object.freeze([0.5, 3.0, 14.0]),   // m along her: the bank (play as Tessie) grows in from the snout to s 3 m, full to 14 m, then eases to 40 % at the tail's tip
  line: 'Hold on — that rock just moved.',
  // the rare line (owner, 2026-11-17: one rare skipper line with light humour): once a session, a later sighting, 1 in 2
  rareLine: 'Wave if you like. She has been ignoring sailors for ten thousand years.',
  // her water (an area): near it the sightings are inside it (how often: the stage's tessie act, its nearby row)
  areaNearM: 300,       // m from the area's edge: the boat this close counts as near
  areaInsetM: 25,       // m: her body's centre at least this far inside the edge
  areaStepM: 30,        // m between the candidate spots inside the area
  areaFreeAfter: 6,     // refused tries near her water before the view rule gives way (6 × retryS = 30 s)
  // M3: her nose's depth channel and the reflex under the hull
  dyRate: 1.2,          // m/s: her fastest climb or descent
  dyTau: 0.6,           // s: the ease toward the depth she wants
  duckDy: -3.4,         // m under her swimming depth: the reflex's dive under a hull in her way (the keel's 1.6 m and her girth)
  duckLookS: 1.6,       // s ahead her nose looks for the hull
  duckM: 1.2,           // m: a hull this near her nose's way makes her duck
  // play as Tessie, 2c: a dive in place: the body behind the neck follows the nose's depth over about a second when she is slow
  followS: 0.6, followM: Object.freeze([1.5, 5.0]), followV: Object.freeze([1.5, 5.0]),   // s (the ease), m along her (from the neck back), m/s (fully at a drift, none from her walk up)
});
// M3: her body's reach round each spine frame for the boat's hold: her radius, the scutes, and the flippers where they are
// (blender/tessie_concept.py DESIGNS.B flippers: 1.25 m at 5.0 m along her, 0.95 m at 10.2 m)
const bump = (a, b, w, s) => smoothStep(a - w, a, s) * (1 - smoothStep(b, b + w, s));
function smoothStep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
export const reachAt = (s, L) => radiusAt(s, L) + 0.15 + 1.0 * bump(4.4, 6.4, 0.4, s) + 0.75 * bump(9.6, 11.2, 0.4, s);
const DEG = Math.PI / 180;
import { clamp01 } from '../../src/sim/core/math.js';
import { clampT as clamp } from '../../src/sim/core/math.js';
const smooth = (a, b, x) => { if (!Number.isFinite(a)) return x >= a ? 1 : 0; const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };   // an edge at ±∞ (a clip never played) is a step
// a seeded hash in [0, 1) (no Math.random: the same seed gives the same sightings)
export function hash01(seed, k) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// the B body's radius and its height factor along the spine (blender/tessie_concept.py DESIGNS.B profile and wh; d < 0 from
// the tail's tip): the water map's contacts and the "above the water" test read it
const PROFILE = [[0, 0], [0.03, 0.15], [0.12, 0.3], [0.3, 0.43], [0.55, 0.5], [0.8, 0.47], [1.15, 0.36], [1.6, 0.31], [2.6, 0.4],
  [4.0, 0.6], [6.0, 0.8], [9.5, 0.82], [-6.0, 0.6], [-2.6, 0.33], [-0.7, 0.13], [-0.0, 0.0]];
const HF = [[0, 0.84], [0.9, 0.9], [2.0, 1.0], [6.0, 0.92], [-3, 0.95]];
// (table, L) → its rows sorted by d (the tail's rows counted from L), as two flat number lists read by index: no key string
// and no row arrays per call (refactor round 3, B1: this ran thousands of times a frame while she is played)
const ROWS = new Map([[PROFILE, new Map()], [HF, new Map()]]);
const LAST = new Map([[PROFILE, { L: undefined, d: null, v: null }], [HF, { L: undefined, d: null, v: null }]]);
function rowsOf(tab, L) {
  const last = LAST.get(tab);
  if (last.L === L) return last;
  const byL = ROWS.get(tab);
  let r = byL.get(L);
  if (!r) {
    const rows = tab.map((x) => [x[0] < 0 || Object.is(x[0], -0) ? L + x[0] : x[0], x[1]]).sort((a, b) => a[0] - b[0]);
    r = { d: Float64Array.from(rows, (x) => x[0]), v: Float64Array.from(rows, (x) => x[1]) };
    if (byL.size > 8) byL.clear();
    byL.set(L, r);
  }
  last.L = L; last.d = r.d; last.v = r.v;
  return last;
}
function table(tab, d, L) {
  const r = rowsOf(tab, L), ds = r.d, vs = r.v, n = ds.length;
  if (d <= ds[0]) return vs[0];
  for (let i = 0; i + 1 < n; i++) { const b = ds[i + 1]; if (d <= b) { const a = ds[i], va = vs[i]; const t = smooth(0, 1, (d - a) / Math.max(1e-9, b - a)); return va + (vs[i + 1] - va) * t; } }
  return vs[n - 1];
}
export const radiusAt = (d, L) => table(PROFILE, d, L);
export const heightAt = (d, L) => table(PROFILE, d, L) * table(HF, d, L) + (d > 2.3 && d < L - 1.4 ? 0.15 : 0);   // the scutes on the back

// ---- M2: the rig (a spine chain of N frames) and its clips ----
// A clip is a layer of channels over the sighting's clock, blended by its weight: the body's depth, the humps, the neck's
// arc (and the look), the tail, the dive (each point when the nose's dive reaches it), the breach. CLIPS names the five the
// owner asked for (swim, surface, arc, dive, breach) plus the flick; play(name, at) queues one; a sighting is a script of them.
//   swim     the loop: 2–3 humps travel back along her at 1.2 × her speed (always on while she is up)
//   surface  the rise from 4.5 m down to the swimming depth, the humps growing in
//   arc      the neck rises in a length-keeping arc (about 2.5 m), turns toward the boat (look), lowers
//   flick    the tail lifts and slaps down
//   dive     nose first: each point dives when the nose's dive reaches it
//   breach   the front 8 m clear the water in a steep arc, hang, fall back with a big splash
//   bite     (play as Tessie, step 6; it replaced the 0.6 s snap that stretched her neck 30 %) four beats on
//            her rig, length-keeping: the wind-up (the neck draws back into an S, the trunk coils into a C, a roll away), the strike (the S
//            unfolds onto the aim, the jaw gapes, the whole body lunges), the follow-through (a hit: the jaw grips, the head shakes, she
//            rolls into it; a miss: one shake), the recovery. Three kinds (BITE2): the snap, the rail bite, the dash bite. sim.bite(kind)
//            starts one, sim.biteAim(x, y, z) aims it, sim.biteHit(hit) tells it the verdict
export const CLIPS = Object.freeze({
  swim: { dur: Infinity }, surface: { dur: 6.5 }, arc: { dur: 18.5 }, flick: { dur: 5 }, dive: { dur: 12 }, breach: { dur: 4.2 }, bite: { dur: 1.7 },
});
export const BREACH = Object.freeze({ up: 1.6, hang: 0.6, down: 1.2, len: 9, rise: 1.45, lift: 1.3 });
// play as Tessie's breaches (R1 and R2): up 1.1, hang 0.35, down 0.9 s (her sightings keep BREACH's 1.6 / 0.6 / 1.2)
export const BREACH_PLAY = Object.freeze({ up: 1.1, hang: 0.35, down: 0.9 });
//: the bite's beats (s), the head's reach past its place (m, the whole body's lunge), the jaw's gape (°; held at grip on a
// hit), the head's shake (°, at shakeHz), the roll into the bite (°) and away in the wind-up, the coil and the neck's draw (0…1)
export const BITE2 = Object.freeze({
  snap: Object.freeze({ windup: 0.15, strike: 0.18, follow: 0, recover: 0.35, reach: 0.8, gape: 10, grip: 0, shake: 0, roll: 0, rollAway: 4, coil: 0.5, draw: 0.5, lunge: 0, knock: 1 }),
  rail: Object.freeze({ windup: 0.30, strike: 0.22, follow: 0.70, recover: 0.45, reach: 1.3, gape: 15, grip: 8, shake: 25, roll: 25, rollAway: 8, coil: 1, draw: 1, lunge: 3, knock: 1 }),
  dash: Object.freeze({ windup: 0, strike: 0.25, follow: 0.70, recover: 0.45, reach: 1.8, gape: 15, grip: 8, shake: 25, roll: 40, rollAway: 0, coil: 0, draw: 0, lunge: 0, knock: 1.15 }),
});
const BITE_SHAPE = Object.freeze({ shakeHz: 3, shakeTau: 0.35, gapeAt: 0.68, steer: Object.freeze([1, 0.3, 0.5]), steerFullK: 0.4, blendS: 0.08, drawUp: 40, drawDown: 110, coilDeg: 12, tailDeg: 27, aimYaw: 0.6, aimPitch: 1.4 });
export const biteDur = (k) => { const b = BITE2[k] ?? BITE2.snap; return b.windup + b.strike + b.follow + b.recover; };
export const biteContact = (k) => { const b = BITE2[k] ?? BITE2.snap; return b.windup + b.strike; };
// the bite's beats at t s from the press (pure; the controller's steering and the body's pose read the same numbers): phase, the wind-up's
// pose weight, the strike's unfold onto the aim, the body's reach (0…1 of B.reach), the jaw's gape (rad), the head's shake (rad), the roll
// (rad, + into the bite), the coil (−1…1), the steering share (never under 0.3)
export function biteBeats(kind, t, hit = null) {
  const B = BITE2[kind] ?? BITE2.snap, X = BITE_SHAPE;
  const t1 = B.windup, t2 = t1 + B.strike, t3 = t2 + B.follow, t4 = t3 + B.recover;
  const sm = (a, b, x) => (b <= a ? (x >= a ? 1 : 0) : smoothStep(a, b, x));
  const phase = t < t1 ? 'windup' : t < t2 ? 'strike' : t < t3 ? 'follow' : t < t4 ? 'recover' : 'done';
  const wind = sm(0, t1, t) * (1 - sm(t1, t2, t));
  const unfold = sm(t1, t2, t) * (1 - sm(t3, t4, t));
  const held = hit ? 0.75 : 0.25;   // a hit holds the head on the rail through the follow-through; a miss lets it come back
  const reach = sm(t1, t2, t) * (t < t2 ? 1 : 1 - (1 - held) * sm(t2, t3 > t2 ? t3 : t2 + 0.2, t)) * (1 - sm(t3 > t2 ? t3 : t2, t4, t));
  const g0 = B.gape * DEG, gHit = (hit ? B.grip : 0) * DEG;
  let gape = t < t1 ? 0 : t < t2 ? g0 * sm(t1, t1 + B.strike * X.gapeAt, t) : t < t3 ? g0 + (gHit - g0) * sm(t2, t2 + 0.15, t) : gHit * (1 - sm(t3, t4, t));
  if (t >= t4) gape = 0;
  const tau = t - t2, shakeA = B.shake * DEG;
  const shake = t >= t2 && t < t3 + 0.001 && shakeA ? (hit ? shakeA * Math.sin(2 * Math.PI * X.shakeHz * tau) * Math.exp(-tau / X.shakeTau) * (1 - sm(t3 - 0.1, t3, t))
    : tau < 1 / X.shakeHz ? 0.6 * shakeA * Math.sin(2 * Math.PI * X.shakeHz * tau) : 0) : 0;
  const rollInto = (hit ? 1 : 0.4) * B.roll * DEG * sm(t2, t2 + Math.min(0.35, B.follow || 0.2), t) * (1 - sm(t3, t4, t));
  const roll = rollInto - B.rollAway * DEG * wind;
  const coil = B.coil * (wind - 0.5 * sm(t1, t2, t) * (1 - sm(t2, t3 > t2 ? t3 : t2 + 0.3, t)));
  // steering: 100 % in the wind-up, 30 % in the strike, 50 % in the follow-through, back to 100 % early in the recovery;
  // each beat blended over its first blendS
  const S = X.steer, bl = X.blendS;
  let steer = S[0];
  if (t >= t1) steer = S[0] + (S[1] - S[0]) * sm(t1, t1 + bl, t);
  if (t >= t2) steer = S[1] + (S[2] - S[1]) * sm(t2, t2 + bl, t);
  if (B.follow <= 0 && t >= t2) steer = S[1] + (1 - S[1]) * sm(t2, t2 + B.recover * X.steerFullK, t);
  else if (t >= t3) steer = S[2] + (1 - S[2]) * sm(t3, t3 + B.recover * X.steerFullK, t);
  if (t >= t4) steer = 1;
  return { phase, wind: wind * B.draw, coil, unfold, reach, gape: Math.max(0, gape), shake, roll, steer, contactAt: t2, dur: t4 };
}
// her swim's gaits: the hump wave (m, λ m), the side sway behind 7 m (m, λ m), the flipper's paddle (°, Hz); blended over
// 0.6 s by her pace and depth; the waves' phases advance with the distance she swims (never sliding)
export const GAIT = Object.freeze({
  drift: Object.freeze({ hump: 0.15, lam: 5.5, sway: 0.08, swayLam: 8, paddle: 6, hz: 0.35 }),
  surface: Object.freeze({ hump: 0.45, lam: 5.5, sway: 0.30, swayLam: 8, paddle: 18, hz: 0.8 }),
  under: Object.freeze({ hump: 0.30, lam: 6.5, sway: 0.40, swayLam: 8.5, paddle: 22, hz: 1.0 }),
  dash: Object.freeze({ hump: 0.55, lam: 7.5, sway: 0.55, swayLam: 9, paddle: 30, hz: 1.6 }),
  blendS: 0.6, humpK: 0.85, swayK: 0.9, swayFrom: 7, cruiseV: 5, diveTail: 1.0, diveTailM: 4,
});

export function createTessie({ seed = 1, depthAt = () => 30, L = TESSIE.L, T = TESSIE, area = null } = {}) {
  const N = T.N, ds = () => L / (N - 1);
  const spine = new Float32Array(N * 8);
  const broke = new Uint8Array(N), above = new Uint8Array(N), lastRing = new Float32Array(N).fill(-1e9), prevY = new Float32Array(N);
  const st = { phase: 'idle', visible: false, t: 0, spine, wetAge: 0, centre: [0, 0], radius: L, water: { kelvin: [], rings: [], contacts: [] }, events: [], rising: [], clips: [], clear: Infinity, held: 0 };
  // M3: the boat's solid shape (posed each step from the boat's drawn pose) and the least gap seen per sighting
  const clear = createBoatClear();
  let boatPosed = false;
  const reach = (s) => reachAt(s, L);
  let playT = 0, cued = false, count = 0, attempt = 0, retryAt = 0, cueOpt = {};
  let nearNow = false;   // her water: the boat near it now
  const nearArea = (b) => !!area && !!b && Math.hypot(b.x - area.x, b.z - area.z) - area.r <= T.areaNearM;
  const inAreaPt = (x, z, inset = 0) => !!area && Math.hypot(x - area.x, z - area.z) <= area.r - inset;
  let S = null;   // the sighting: its clock, its script (clips), the nose and its path history
  const sightings = [], rings = [];
  let line = { said: false, at: null }, rare = { said: false, at: null };
  let boatNow = null;

  // ---- the placement's prediction: an arc from the body's centre at the break (arc 0), heading psi0, curvature kappa (1/m)
  // ahead of it, straight behind it (the director checks a candidate's whole swim against it before she starts)
  function pathAt(c, a, out) {
    const s0 = Math.sin(c.psi0), c0 = Math.cos(c.psi0);
    if (a <= 0 || Math.abs(c.kappa) < 1e-6) { out[0] = c.x0 + s0 * a; out[1] = c.z0 - c0 * a; out[2] = c.psi0 + (a > 0 ? c.kappa * a : 0); return out; }
    const psi = c.psi0 + c.kappa * a;
    out[0] = c.x0 + (c0 - Math.cos(psi)) / c.kappa; out[1] = c.z0 + (s0 - Math.sin(psi)) / c.kappa; out[2] = psi; return out;
  }
  const noseArc = (t) => T.U * (t - T.lead) + L / 2;   // the scripted nose's arc position at sighting time t

  // ---- the nose and its path (the motion: the leader; the spine follows its history). The API a chase can drive:
  // swimTo(x, z, speed) steers her nose to a point at a speed (turn and acceleration limited, as an animal), riseUnder(x, z)
  // brings her up under a point (deep until 4 m from it, then the surface and the breach there). The scripted sighting is the
  // same nose on its arc (the placement's prediction).
  const HSTEP = 0.25, HCAP = Math.ceil((60 + 40) / HSTEP);
  const hx = new Float64Array(HCAP), hz = new Float64Array(HCAP), ht = new Float64Array(HCAP), hy = new Float64Array(HCAP);   // hy: the nose's depth offset there (M3)
  function histReset(x, z, psi, tNow, speed) {
    S.hHead = 0; S.hLen = HCAP; S.hAcc = 0;
    const sx = Math.sin(psi), sz = -Math.cos(psi);
    for (let k = 0; k < HCAP; k++) { const i = (HCAP - k) % HCAP; hx[i] = x - sx * k * HSTEP; hz[i] = z - sz * k * HSTEP; ht[i] = tNow - k * HSTEP / Math.max(0.5, speed); hy[i] = 0; }
    S.hHead = 0; hx[0] = x; hz[0] = z; ht[0] = tNow; hy[0] = 0;
  }
  function histPush(x, z, tNow, dy) { S.hHead = (S.hHead + 1) % HCAP; hx[S.hHead] = x; hz[S.hHead] = z; ht[S.hHead] = tNow; hy[S.hHead] = dy; }
  // the path b m back from the nose → [x, z, the sighting time the nose passed there, the nose's depth offset there]
  function histAt(b, out) {
    const n = S.nose;
    if (b <= S.hAcc) { const k = S.hAcc > 1e-9 ? b / S.hAcc : 0; out[0] = n.x + (hx[S.hHead] - n.x) * k; out[1] = n.z + (hz[S.hHead] - n.z) * k; out[2] = S.t + (ht[S.hHead] - S.t) * k; out[3] = n.dy + (hy[S.hHead] - n.dy) * k; return out; }
    const f = (b - S.hAcc) / HSTEP, i = Math.min(HCAP - 2, Math.floor(f)), u = f - i;
    const a0 = (S.hHead - i + HCAP * 4) % HCAP, a1 = (a0 - 1 + HCAP) % HCAP;
    out[0] = hx[a0] + (hx[a1] - hx[a0]) * u; out[1] = hz[a0] + (hz[a1] - hz[a0]) * u; out[2] = ht[a0] + (ht[a1] - ht[a0]) * u; out[3] = hy[a0] + (hy[a1] - hy[a0]) * u; return out;
  }
  function advanceNose(dt) {
    const n = S.nose;
    // the speed toward what she wants (an animal's acceleration), the heading toward the target or along the script's arc
    const acc = n.acc ?? 0.9;   // play as Tessie's sprint eases up faster (swimTo's acc)
    n.speed += Math.max(-acc * dt, Math.min(acc * dt, n.want - n.speed));
    if (n.target) {
      const want = Math.atan2(n.target.x - n.x, -(n.target.z - n.z));
      let d = want - n.psi; d = Math.atan2(Math.sin(d), Math.cos(d));
      const maxTurn = (n.turnMax ?? T.turnMax) * DEG * Math.min(1, 0.4 + n.speed / 3) * dt;   // play as Tessie: sharper under the water (swimTo's turn)
      n.psi += Math.max(-maxTurn, Math.min(maxTurn, d));
    } else if (n.arc > 0) n.psi += n.kappa * n.speed * dt;
    // M3: the depth she wants (her own, or the reflex's under a hull in her way), eased, at an animal's rate
    const want = Math.min(n.dyWant, S.duck > 0 ? T.duckDy : 0);
    const ddy = (want - n.dy) * Math.min(1, dt / T.dyTau);
    const rate = n.dyRate ?? T.dyRate;   // play as Tessie's climb rate (1.6 m/s at a run)
    n.dy += Math.max(-rate * dt, Math.min(rate * dt, ddy));
    const step = n.speed * dt;
    n.x += Math.sin(n.psi) * step; n.z -= Math.cos(n.psi) * step; n.arc += step;
    S.hAcc += step;
    while (S.hAcc >= HSTEP) {
      // the history point HSTEP behind the newest one, on the segment back to it
      const k = (S.hAcc - HSTEP) / Math.max(1e-9, S.hAcc);
      const px = n.x + (hx[S.hHead] - n.x) * k, pz = n.z + (hz[S.hHead] - n.z) * k, pt = S.t + (ht[S.hHead] - S.t) * k, py = n.dy + (hy[S.hHead] - n.dy) * k;
      histPush(px, pz, pt, py); S.hAcc -= HSTEP;
    }
  }

  // ---- the clips ----
  const clipAt = (name) => { for (let i = S.clips.length - 1; i >= 0; i--) if (S.clips[i].name === name) return S.clips[i]; return null; };
  function play(name, at = S?.t ?? 0, o = {}) { if (!S) return false; S.clips.push({ name, at, ...o }); if (name === 'dive') S.dive = Math.min(S.dive, at); return true; }
  const local = (name, t) => { const c = clipAt(name); return c ? t - c.at : -1e9; };
  const baseY = (t) => { const k = local('surface', t); return k < -1e8 ? T.base[0] : T.base[0] + (T.base[1] - T.base[0]) * smooth(T.rise[0], T.rise[1], k); };
  const diveY = (tau) => -T.diveM * smooth(S.dive, S.dive + T.diveS, tau);
  const humpEnv = (s) => smooth(T.neckS - 0.2, T.neckS + 1.6, s) * (1 - 0.6 * smooth(L - 4.5, L - 1.0, s));
  function yAt(s, t, tau, dy = 0) {
    const ks = local('surface', t);
    // driven (play as Tessie): the gait's hump, its phase advanced by the distance she swims (S.phH at 0.85 × her pace)
    const G = S.driven ? S.gait : null;
    const amp = (G ? G.hump : T.humpA) * (ks < -1e8 ? 0 : smooth(T.humps[0], T.humps[1], ks)) * (1 - smooth(S.dive, S.dive + 4, tau)) * (1 - breachK(t) * 0.7);
    const hump = G ? amp * humpEnv(s) * Math.cos(2 * Math.PI * (s - (S.phH - S.phV * (S.t - t))) / G.lam + S.phase)
      : amp * humpEnv(s) * Math.cos(2 * Math.PI * (s - T.waveK * T.U * t) / T.lambda + S.phase);
    const diveTail = G && S.diveK > 0 && s > L - GAIT.diveTailM ? GAIT.diveTail * S.diveK * ((s - (L - GAIT.diveTailM)) / GAIT.diveTailM) ** 2 : 0;
    const kf = local('flick', t), fl = kf < -1e8 ? 0 : Math.sin(Math.PI * clamp01(kf / CLIPS.flick.dur)) ** 2 * (S.dive > clipAt('flick').at + CLIPS.flick.dur ? 1 : 0);
    const tail = s > L - 3.2 ? T.flickM * fl * ((s - (L - 3.2)) / 3.2) ** 2 : 0;
    const sink = S.sinkAt == null ? 0 : -T.sinkM * smooth(S.sinkAt, S.sinkAt + T.sinkS, t);   // shy: the whole body sinks at once
    const lift = breachK(t) * BREACH.lift * (1 - smooth(BREACH.len, BREACH.len + 4, s));   // the breach: the body under her front rises with it
    return baseY(t) + diveY(tau) + hump + tail + sink + lift + dy + diveTail;   // dy: the nose's depth offset where it passed (M3)
  }
  const neckLift = (t) => Math.max(S.neckK ?? 0, clipNeck(t));   // the clip's arc, or the driven neck (play as Tessie: up while she swims at the surface)
  const clipNeck = (t) => { const k = local('arc', t); if (k < -1e8) return 0; return smooth(T.neckUp[0] - T.neckUp[0], T.neckUp[1] - T.neckUp[0], k) * (1 - smooth(Math.min(T.neckDown[0] - T.neckUp[0], S.dive - 2.5 - clipAt('arc').at), Math.min(T.neckDown[1] - T.neckUp[0], S.dive + 1 - clipAt('arc').at), k)); };
  const breachT = () => clipAt('breach')?.B ?? BREACH;   // a breach's own timing (play as Tessie's: BREACH_PLAY)
  function breachK(t) { const k = local('breach', t); if (k < -1e8) return 0; const B = breachT(); return smooth(0, B.up, k) * (1 - smooth(B.up + B.hang, B.up + B.hang + B.down, k)); }
  // the breach's fall share (0 until the hang ends, 1 at the splash): the lean toward the boat and the roll in the air grow over it
  function breachFall(t) { const k = local('breach', t); if (k < -1e8) return 0; const B = breachT(), end = B.up + B.hang + B.down; return smooth(B.up * 0.5, B.up + B.hang + B.down * 0.8, k) * (1 - smooth(end, end + 0.6, k)); }

  const P = new Float64Array(N * 3), F3 = new Float64Array(N * 3), tmp = [0, 0, 0, 0], tmp2 = [0, 0, 0, 0];
  // the bank's share at s m along her (0 unless driven and banking)
  // driven: + the bite's roll (into it) and the free breach's roll in the air (R2), spread the same way
  const bankRoll = (s) => { if (!S.driven) return 0; const r = (S.bank || 0) + (S.rollX || 0); return r ? r * smooth(T.bankS[0], T.bankS[1], s) * (1 - 0.6 * smooth(T.bankS[2], L, s)) : 0; };
  // a length-keeping re-pose of a run of the spine ("no stretching"): from the pivot frame outward (dir −1 toward the
  // snout, +1 toward the tail) each step keeps its direction from the pose given, turned by dyaw(i) and dpitch(i) (rad, absolute per
  // step), and is rebuilt d long from the pivot; so any bend, coil, sway or shake never lengthens her
  const SEG = new Float64Array(N * 3);
  function rebuild(P, pivot, dir, d, dyaw, dpitch) {
    const end = dir < 0 ? 0 : N - 1;
    for (let i = pivot; i !== end; i += dir) { const j = i + dir; SEG[j * 3] = P[j * 3] - P[i * 3]; SEG[j * 3 + 1] = P[j * 3 + 1] - P[i * 3 + 1]; SEG[j * 3 + 2] = P[j * 3 + 2] - P[i * 3 + 2]; }
    for (let i = pivot; i !== end; i += dir) {
      const j = i + dir, sx = SEG[j * 3], sy = SEG[j * 3 + 1], sz = SEG[j * 3 + 2];
      const h = Math.hypot(sx, sz), psi = Math.atan2(sx, -sz) + (dyaw ? dyaw(j) : 0);
      const e = Math.max(-1.45, Math.min(1.45, Math.atan2(sy, h) + (dpitch ? dpitch(j) : 0)));
      P[j * 3] = P[i * 3] + Math.cos(e) * Math.sin(psi) * d; P[j * 3 + 1] = P[i * 3 + 1] + Math.sin(e) * d; P[j * 3 + 2] = P[i * 3 + 2] - Math.cos(e) * Math.cos(psi) * d;
    }
  }
  function body(t) {
    const d = ds();
    // the vertical first (each point by the time the nose passed it), then the path: each step of the spine is d long, its
    // horizontal part what the step's rise leaves (the humps draw the body in; the spine keeps its length)
    let a = 0;
    for (let i = 0; i < N; i++) {
      const s = i * d;
      histAt(Math.max(0, a), tmp2);
      // play as Tessie, a dive in place (2c; owner, 2026-11-20): at a drift the path barely moves, so the depth the nose took would reach
      // her body only tens of seconds later (the camera hugged the surface); the body behind her neck follows the nose's depth itself,
      // eased (T.followS), as fully as she is slow (at her cruise the path carries it as before)
      const dyB = S.driven && S.bodyDy != null ? tmp2[3] + (S.bodyDy - tmp2[3]) * smooth(T.followM[0], T.followM[1], s) * (1 - smooth(T.followV[0], T.followV[1], S.nose.speed)) : tmp2[3];
      const y = yAt(s, t, tmp2[2], dyB);
      if (i > 0) { const dy = y - P[(i - 1) * 3 + 1]; a += Math.sqrt(Math.max(d * d * 0.04, d * d - dy * dy)); }
      histAt(a, tmp);
      P[i * 3] = tmp[0]; P[i * 3 + 1] = y; P[i * 3 + 2] = tmp[1];
    }
    F3.set(P);
    // the neck (arc) and the breach: from the base forward, each step d long, the heading and pitch blended from the path's own
    // to a rising arc on the path's heading turned toward the boat (S.look): the neck keeps its length at every stage
    const hn = neckLift(t), br = breachK(t);
    const w = Math.max(hn, br);
    if (w > 1e-3) {
      const sn = T.neckS + (BREACH.len - T.neckS) * br, rise = T.neckRise + (BREACH.rise - T.neckRise) * br;
      const ib = Math.max(2, Math.round(sn / d));
      const bx = F3[ib * 3] - F3[(ib + 1) * 3], bz = F3[ib * 3 + 2] - F3[(ib + 1) * 3 + 2];
      const psiA = Math.atan2(bx, -bz) + S.look * hn * (1 - br) + (S.leanX || 0) * breachFall(t);   // play as Tessie's rising strike: the fall leans toward the boat
      let x = P[ib * 3], y = P[ib * 3 + 1], z = P[ib * 3 + 2];
      for (let i = ib - 1; i >= 0; i--) {
        const fx = F3[i * 3] - F3[(i + 1) * 3], fy = F3[i * 3 + 1] - F3[(i + 1) * 3 + 1], fz = F3[i * 3 + 2] - F3[(i + 1) * 3 + 2];
        const psiF = Math.atan2(fx, -fz), eF = Math.atan2(fy, Math.hypot(fx, fz));
        const u = (ib - i - 0.5) / ib;
        const eA = rise * Math.sin(Math.PI * Math.pow(u, 0.85)) - 0.15 * u * u + br * 0.35 * (1 - u);
        const e = eF + (eA - eF) * w;
        let dpsi = psiA - psiF; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
        const psi = psiF + dpsi * w;
        x += Math.cos(e) * Math.sin(psi) * d; y += Math.sin(e) * d; z -= Math.cos(e) * Math.cos(psi) * d;
        P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      }
    }
    // play as Tessie (§ 5.6): the side sway behind 7 m, the bite's beats and the trunk's coil, all length-keeping
    // (rebuild from her neck's base: the neck forward, the trunk and tail back), then the bite's lunge (the whole body, rigid)
    S.biteNow = null; S.rollX = 0; st.gape = 0;
    if (S.driven) {
      const ib = Math.max(2, Math.round(T.neckS / d)), G = S.gait;
      const bc = clipAt('bite'), kb = bc ? t - bc.at : -1;
      const bt = bc && kb >= 0 && kb < biteDur(bc.kind) ? biteBeats(bc.kind, kb, bc.hit) : null;
      S.biteNow = bt ? { kind: bc.kind, t: kb, ...bt } : null;
      // the neck: the wind-up's S (its base pitched up, its top bent over, the head cocked down), the strike's unfold onto the aim, the shake
      if (bt) {
        const X = BITE_SHAPE, hx0 = P[0], hz0 = P[2];
        let aPsi = null, aE = 0;
        if (bc.aim) { const ax = bc.aim[0] - P[ib * 3], ay = bc.aim[1] - P[ib * 3 + 1], az = bc.aim[2] - P[ib * 3 + 2]; aPsi = Math.atan2(ax, -az); aE = Math.atan2(ay, Math.hypot(ax, az)); }
        const uOf = (j) => (ib - j - 0.5) / ib;   // 0 at the neck's base, 1 at the snout
        const segPsi = (j) => Math.atan2(P[j * 3] - P[(j + 1) * 3], -(P[j * 3 + 2] - P[(j + 1) * 3 + 2]));
        const segE = (j) => Math.atan2(P[j * 3 + 1] - P[(j + 1) * 3 + 1], Math.hypot(P[j * 3] - P[(j + 1) * 3], P[j * 3 + 2] - P[(j + 1) * 3 + 2]));
        const unf = bt.unfold, yaw0 = new Float64Array(ib), e0 = new Float64Array(ib);
        for (let j = 0; j < ib; j++) { yaw0[j] = segPsi(j); e0[j] = segE(j); }
        rebuild(P, ib, -1, d,
          (j) => { if (j >= ib) return 0; const u = uOf(j); let dy = bt.shake * (bc.meetAt != null && bc.hit ? 0.35 : 1) * smooth(0.35, 1, u); if (aPsi != null) { let w = aPsi - yaw0[j]; w = Math.atan2(Math.sin(w), Math.cos(w)); dy += clamp(w, -BITE_SHAPE.aimYaw, BITE_SHAPE.aimYaw) * unf * (0.35 + 0.65 * u); } return dy; },
          (j) => { if (j >= ib) return 0; const u = uOf(j); const draw = (X.drawUp - X.drawDown * smooth(0.3, 1, u)) * DEG * bt.wind; const toward = aPsi != null ? clamp(aE - e0[j], -BITE_SHAPE.aimPitch, BITE_SHAPE.aimPitch) * unf * (0.35 + 0.65 * u) : -0.25 * unf * u; return draw + toward; });
        S.biteHead = [P[0] - hx0, P[2] - hz0];
      }
      // the trunk and the tail: the sway (a wave travelling back, growing to the tail), the coil's C and the tail's swing the other way
      const coilW = bt ? bt.coil * (bc.side || 1) : 0, sw = G.sway, swL = G.swayLam;
      if (sw > 1e-4 || Math.abs(coilW) > 1e-4) {
        const X = BITE_SHAPE, s0 = GAIT.swayFrom;
        rebuild(P, ib, 1, d, (j) => {
          const s = j * d; let a = 0;
          if (s > s0 && sw > 1e-4) { const q = (s - s0) / (L - s0), k = 2 * Math.PI / swL; a += Math.atan(sw * (2 * q / (L - s0) * Math.sin(k * (s - S.phS)) + q * q * k * Math.cos(k * (s - S.phS)))); }
          if (coilW) a += coilW * (X.coilDeg * smooth(5, 14, s) - X.tailDeg * smooth(14, L, s)) * DEG;
          return a;
        }, null);
      }
      // the lunge: the whole body forward along her head's way by the bite's reach (rigid: no stretch), lifted a little at the surface
      if (bt && bt.reach > 1e-4) {
        // the arched neck unfolding is the reach at the surface; a straight neck (under the water) lunges the body
        const B2 = BITE2[bc.kind], r = B2.reach * bt.reach * (1 - 0.8 * Math.min(1, neckLift(t)));
        let lx = P[0] - P[ib * 3], lz = P[2] - P[ib * 3 + 2];
        if (bc.aim) { const ax = bc.aim[0] - P[0], az = bc.aim[2] - P[2], al = Math.hypot(ax, az); if (al > 0.3) { const hl0 = Math.hypot(lx, lz) || 1, c = (ax * lx + az * lz) / (al * hl0); if (c > Math.cos(35 * DEG)) { lx = ax; lz = az; } } }   // toward the rail when it lies within 35° of her head
        const ll = Math.hypot(lx, lz) || 1;
        for (let i = 0; i < N; i++) { P[i * 3] += lx / ll * r; P[i * 3 + 2] += lz / ll * r; }
      }
      // her jaw meets the boat (the owner's son, 2026-11-21: "we're attacking the water at the side of the sailboat"): once her head is within
      // the bite's meet radius of the contact point (the hit radius:'s 3.0 m locked, 2.0 m otherwise, and the point's depth in
      // the hull) the strike carries her whole body (rigid: no stretch) the rest of the way, and on a hit holds her head there through the
      // follow-through; the boat's hold below then sets the head flush on its skin (no gap, never through it)
      S.meetNow = false;
      if (bt && bc.aim && bc.meet > 0 && bt.phase !== 'windup' && bc.hit !== false) {
        const gx = bc.aim[0] - P[0], gz = bc.aim[2] - P[2], gap = Math.hypot(gx, gz);
        if (bc.meetAt == null && bt.phase === 'strike' && gap <= bc.meet) { bc.meetAt = kb; bc.meetS = Math.max(0.15, gap / 10); }   // at most about 10 m/s faster than her swim
        if (bc.meetAt != null) {
          let w = smooth(bc.meetAt, bc.meetAt + bc.meetS, kb) * bt.unfold;
          // let go no faster than about 10 m/s of her body catching up with her swim (she swam on while her jaw held the rail)
          if (bc.wPrev != null && w < bc.wPrev) w = Math.max(w, bc.wPrev - Math.max(0, kb - bc.kbPrev) * 10 / Math.max(0.5, gap));
          bc.wPrev = w; bc.kbPrev = kb;
          for (let i = 0; i < N; i++) { P[i * 3] += gx * w; P[i * 3 + 2] += gz * w; }
          S.meetNow = w > 0.05;
        }
      }
      if (bt && !bc.splashed && kb >= bt.contactAt) { bc.splashed = true; st.bites = (st.bites ?? 0) + 1; if (P[1] > -1.5) ev('slap', P[0], 0, P[2], S.meetNow ? 1.4 : 1.1); }   // at the hull when her jaw meets it
      st.gape = bt ? bt.gape : 0;
      S.rollX = (bt ? bt.roll * (bc.side || 1) : 0) + (S.breachRoll || 0) * breachFall(t);
    }
    // M3: the boat is solid: every point held outside its proxy by her reach and the margin (the push spread along her)
    // while her jaw meets the hull, her head is held flush on its skin (its own radius and 3 cm), not a hand's breadth off it
    st.held = boatPosed ? clear.hold(P, N, d, S.meetNow ? (s) => (s < 3 ? radiusAt(s, L) + 0.03 - CLEAR.margin : reach(s)) : reach, CLEAR.margin) : 0;
    // the frames: position, then the up vector (perpendicular to the spine, in its vertical plane)
    let lx = 0, lz = 1;
    for (let i = 0; i < N; i++) {
      const a0 = Math.max(0, i - 1), b0 = Math.min(N - 1, i + 1);
      let tx = P[b0 * 3] - P[a0 * 3], ty = P[b0 * 3 + 1] - P[a0 * 3 + 1], tz = P[b0 * 3 + 2] - P[a0 * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const qx = -tz, qz = tx, ql = Math.hypot(qx, qz);
      if (ql > 0.05) { lx = qx / ql; lz = qz / ql; }
      let ux = -lz * ty, uy = lz * tx - lx * tz, uz = lx * ty;
      const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      // play as Tessie, the bank: roll up about the tangent (t points to the tail, so t × up is her left; + rolls her
      // back toward her right), spread along her by T.bankS; the renderer bends the skin on these frames, so the roll draws as it is
      const roll = bankRoll(i * d);
      if (roll) {
        const c = Math.cos(roll), sn = Math.sin(roll), qx = ty * uz - tz * uy, qy = tz * ux - tx * uz, qz = tx * uy - ty * ux;
        ux = ux * c - qx * sn; uy = uy * c - qy * sn; uz = uz * c - qz * sn;
      }
      const o = i * 8;
      spine[o] = P[i * 3]; spine[o + 1] = P[i * 3 + 1]; spine[o + 2] = P[i * 3 + 2]; spine[o + 3] = i * d;
      spine[o + 4] = ux; spine[o + 5] = uy; spine[o + 6] = uz; spine[o + 7] = 0;
    }
  }

  // ---- the water's sources (render/tessie.js: the wake's impulse maths) and the events (splashes, drips, the sound) ----
  const ev = (type, x, y, z, s = 1, extra = null) => st.events.push(extra ? { type, x, y, z, s, ...extra } : { type, x, y, z, s });
  function water(t, dt) {
    const d = ds(), W = st.water;
    W.kelvin.length = 0; W.contacts.length = 0; st.rising.length = 0;
    for (let i = 0; i < N; i++) {
      const s = i * d, o = i * 8, y = spine[o + 1], top = y + heightAt(s, L), bot = y - radiusAt(s, L), r = radiusAt(s, L);
      const vy = dt > 0 ? (y - prevY[i]) / dt : 0; prevY[i] = y;
      const up = top > 0.02 ? 1 : 0;
      if (up !== above[i] && r > 0.12 && t - lastRing[i] > 1.5) {
        rings.push({ x: spine[o], z: spine[o + 2], t0: playT, amp: up ? 0.9 : 0.7 });
        // a splash where a part first breaks the surface, and where she goes under in the dive (the humps' roll in between:
        // each body point bobs through the surface as the wave runs along her, but the water sees the humps drift slowly: rings only)
        if ((up && !broke[i]) || (!up && t > S.dive)) { if (up) for (let j = Math.max(0, i - 6); j < Math.min(N, i + 7); j++) broke[j] = 1; ev(up ? 'break' : 'under', spine[o], 0, spine[o + 2], Math.min(1.5, r * (0.6 + Math.abs(vy))), { r }); }   // the humps' slow roll: rings, no splash
        for (let j = Math.max(0, i - 8); j < Math.min(N, i + 9); j++) lastRing[j] = t;
      } else if (up && bot < 0 && t - lastRing[i] > 2.0 && r > 0.3) {
        rings.push({ x: spine[o], z: spine[o + 2], t0: playT, amp: 0.3 });
        for (let j = Math.max(0, i - 6); j < Math.min(N, i + 7); j++) lastRing[j] = t;
      }
      above[i] = up;
      // her back rising out of the water (the sheets that run off it) and every part above the water (its drips)
      if (up && i % 2 === 0 && r > 0.15) st.rising.push([spine[o], top, spine[o + 2], vy, r, Math.max(0, Math.min(top, top - Math.max(bot, 0)))]);
      if (i % 2 === 0 && W.contacts.length < 24) {
        const rr = r * 1.05;
        if (top > -0.05 && bot < 0.05 && rr > 0.1) {
          const w = Math.sqrt(Math.max(0, rr * rr - Math.min(rr, Math.abs(y)) ** 2)) + 0.15;
          W.contacts.push([spine[o], spine[o + 2], w, 0.95]);
        }
      }
    }
    while (rings.length && (playT - rings[0].t0 > 9 || rings.length > 16)) rings.shift();
    W.rings = rings.map((r) => [r.x, r.z, playT - r.t0, r.amp]);
    // the V: impulses along the path of her neck's base while she is at the surface (the boat's wake, a point source)
    const ib = Math.round(T.neckS / d);
    let back = 0; for (let i = 1; i <= ib; i++) back += d;
    for (let k = 0; k < 24; k++) {
      const tau = (k + 1) / 3, tb = t - tau;
      if (tb < 0) break;
      histAt(back + S.nose.speed * tau, tmp);
      const yb = yAt(T.neckS, tb, tmp[2], tmp[3]) + heightAt(T.neckS, L);
      const pierce = smooth(-0.3, 0.3, yb);
      if (pierce <= 0) continue;
      W.kelvin.push([tmp[0], tmp[1], tau, 0.55 * pierce * Math.min(1.4, S.nose.speed / T.U)]);
    }
  }
  // the clip moments the splashes and the sound hang on (once each)
  function moments(t, tPrev) {
    const cross = (at) => tPrev < at && t >= at;
    const o = 0;
    // the head clears the water: her breath
    if (!S.breathed && spine[o + 1] + 0.4 > 0.25) { S.breathed = true; ev('breath', spine[o], spine[o + 1] + 0.3, spine[o + 2], 1); }
    const fc = clipAt('flick');
    if (fc && S.dive > fc.at + CLIPS.flick.dur) {
      const tail = (N - 1) * 8;
      if (cross(fc.at + CLIPS.flick.dur * 0.45)) ev('flick', spine[tail], spine[tail + 1], spine[tail + 2], 1);
      if (cross(fc.at + CLIPS.flick.dur * 0.92)) ev('slap', spine[tail], 0, spine[tail + 2], 1.3);
    }
    if (cross(S.dive)) ev('dive', spine[o], 0, spine[o + 2], 1);
    const bc = clipAt('breach');
    if (bc) {
      if (cross(bc.at + 0.2)) ev('breach', spine[o], 0, spine[o + 2], 1.6);
      const BB = bc.B ?? BREACH; if (cross(bc.at + BB.up + BB.hang + BB.down * 0.8)) { const k = Math.round(BREACH.len / ds() * 0.5) * 8; ev('fall', spine[k], 0, spine[k + 2], 2.2); }
    }
  }

  // ---- the director ----
  function inView(view, x, z, k = T.viewK) {
    const dx = x - view.x, dz = z - view.z, dist = Math.hypot(dx, dz);
    if (dist < 15) return false;
    const fx = Math.sin(view.yaw), fz = -Math.cos(view.yaw);
    const ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);   // + to starboard (right of the view)
    return Math.abs(ang) < view.hHalf * k;
  }
  const segDist = (px, pz, ax, az, bx, bz) => { const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez; const u = l2 > 0 ? clamp01(((px - ax) * ex + (pz - az) * ez) / l2) : 0; return Math.hypot(px - ax - ex * u, pz - az - ez * u); };
  const why = { depth: 0, shore: 0, path: 0, track: 0, view: 0, hold: 0 };   // the refusals (the stats: why a spot did not fit)
  function tryPlace(c, boat, view, relax, free = false) {
    const R = relax ? 0.75 : 1;
    if (depthAt(c.x0, c.z0) < T.depthMin * R) { why.depth++; return null; }
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (depthAt(c.x0 + Math.cos(a) * T.shoreM * R, c.z0 + Math.sin(a) * T.shoreM * R) < 1) { why.shore++; return null; } }
    const aEnd = noseArc(T.dive + T.diveS + 2);
    for (let a = -L - 8; a <= aEnd; a += 5) { pathAt(c, a, tmp); if (depthAt(tmp[0], tmp[1]) < T.depthPath * R) { why.path++; return null; } }
    const bfx = Math.sin(boat.heading), bfz = -Math.cos(boat.heading), v = Math.max(0, boat.speed ?? 0);
    const ex = boat.x + bfx * v * T.trackS, ez = boat.z + bfz * v * T.trackS;
    for (let a = -L; a <= aEnd; a += 3) { pathAt(c, a, tmp); if (segDist(tmp[0], tmp[1], boat.x, boat.z, ex, ez) < T.trackM * R) { why.track++; return null; } }
    for (let a = -L / 2; a <= L / 2 + 0.01; a += L / 4) { pathAt(c, a, tmp); if (!inView(view, tmp[0], tmp[1], relax ? 0.92 : T.viewK)) { why.view++; return null; } }
    for (const tk of free ? [] : relax ? [6] : T.holdS) {
      pathAt(c, T.U * tk, tmp);
      const vk = { ...view, x: view.x + bfx * v * tk, z: view.z + bfz * v * tk };
      if (!inView(vk, tmp[0], tmp[1], 0.95)) { why.hold++; return null; }
    }
    const dep = depthAt(c.x0, c.z0);
    const ry = Math.atan2(c.x0 - view.x, -(c.z0 - view.z));
    const side = Math.abs(Math.sin(c.psi0 - ry));
    // and how big she is on screen (owner: the hero big and close): nearer spots score up to 2.5 more
    const near = 4 * clamp01(1 - (Math.hypot(c.x0 - view.x, c.z0 - view.z) - 70) / 60);
    return { score: (dep >= T.depthGood[0] && dep <= T.depthGood[1] ? 1 : 0) + 3 * side + near, depth: dep, sideOn: side };
  }
  // near her water: candidate spots on a grid inside the area (her centre T.areaInsetM inside the edge), each with the courses
  // of the ring's (relative to the boat's heading, toward the side she lies on), scored as the ring's; free: the view and hold
  // rules waived (after T.areaFreeAfter refused tries: she rises in her water anyway)
  function placeInArea(boat, view, { free = false } = {}) {
    const v = Math.max(0, boat.speed ?? 0), bfx = Math.sin(boat.heading), bfz = -Math.cos(boat.heading);
    const bx = boat.x + bfx * v * T.lead, bz = boat.z + bfz * v * T.lead;
    const B = { x: bx, z: bz, heading: boat.heading, speed: v };
    const Vw = free ? { x: view.x, z: view.z, yaw: view.yaw, hHalf: Math.PI } : { x: view.x + bfx * v * T.lead, z: view.z + bfz * v * T.lead, yaw: view.yaw, hHalf: view.hHalf };
    const relax = attempt >= 3, step = T.areaStepM, R = area.r - T.areaInsetM;
    let best = null;
    for (let gx = -R; gx <= R + 1e-6; gx += step) for (let gz = -R; gz <= R + 1e-6; gz += step) {
      if (Math.hypot(gx, gz) > R) continue;
      const x0 = area.x + gx, z0 = area.z + gz;
      const side = (x0 - bx) * -bfz + (z0 - bz) * bfx >= 0 ? 1 : -1;   // + to starboard of the boat
      const dist = Math.hypot(x0 - bx, z0 - bz);
      const turn = (T.turnDeg[0] + (T.turnDeg[1] - T.turnDeg[0]) * hash01(seed, 100 + count)) * DEG / T.U;
      for (const co of T.course) {
        const c = { x0, z0, psi0: boat.heading + side * co * DEG, kappa: side * turn, phase: hash01(seed, 200 + count) * Math.PI * 2, side, R: Math.round(dist), bear: Math.round(Math.abs(Math.atan2((x0 - bx) * -bfz + (z0 - bz) * bfx, (x0 - bx) * bfx + (z0 - bz) * bfz)) / DEG), inArea: true };
        const r = tryPlace(c, B, Vw, relax || free, free);
        if (r && (!best || r.score > best.r.score)) best = { c, r };
      }
    }
    return best;
  }
  function place(boat, view, nearR = false) {
    const v = Math.max(0, boat.speed ?? 0), bfx = Math.sin(boat.heading), bfz = -Math.cos(boat.heading);
    const bx = boat.x + bfx * v * T.lead, bz = boat.z + bfz * v * T.lead;
    const B = { x: bx, z: bz, heading: boat.heading, speed: v };
    const Vw = { x: view.x + bfx * v * T.lead, z: view.z + bfz * v * T.lead, yaw: view.yaw, hHalf: view.hHalf };
    const relax = attempt >= 3;
    const Rs = count === 0 || nearR ? (relax ? [...T.firstR, 40, 100, 110] : T.firstR) : T.laterR;   // a rare moment (M3) is staged as near as the first
    const bears = relax ? [...T.bear, 20, 15, 45] : T.bear;
    let best = null;
    for (const side of [-1, 1]) {
      for (const R of Rs) for (const b of bears) for (const co of T.course) {
        const a = boat.heading + side * b * DEG;
        const x0 = bx + Math.sin(a) * R, z0 = bz - Math.cos(a) * R;
        const turn = (T.turnDeg[0] + (T.turnDeg[1] - T.turnDeg[0]) * hash01(seed, 100 + count)) * DEG / T.U;
        const c = { x0, z0, psi0: boat.heading + side * co * DEG, kappa: side * turn, phase: hash01(seed, 200 + count) * Math.PI * 2, side, R, bear: b };
        const r = tryPlace(c, B, Vw, relax);
        if (r && (!best || r.score > best.r.score)) best = { c, r };
      }
      if (best && side === -1 && best.r.sideOn > 0.55) break;   // port first (the key hints stand on the right)
    }
    return best;
  }

  // a sighting: the scripted one (surface → swim + arc → flick → dive) on the placement's arc; or bare (the chase's API)
  // kind (M3, the stage's rare moments): 'sighting' (the scripted one), 'breach' (the sunset breach: the front 9 m clear the
  // water just after the break, then the neck), 'neck' (the lightning neck: the neck up across the flash due flashIn s from the
  // start, then the dive soon after it)
  function start(c, { offset = 0, script = true, kind = 'sighting', flashIn = null } = {}) {
    S = { ...c, t: 0, dive: script ? T.dive : Infinity, look: 0, clips: [], sinkAt: null, breathed: false, duck: 0, contact: false, calm: false, kind, gait: { ...GAIT.drift }, phH: 0, phV: 0, phS: 0, padPh: 0, diveK: 0, dashK: 0, lookWant: null, rollX: 0, breachRoll: 0, leanX: 0 };
    const a0 = noseArc(0);
    const p0 = pathAt(c, a0, [0, 0, 0]);
    S.nose = { x: p0[0], z: p0[1], psi: c.psi0, speed: T.U, want: T.U, kappa: c.kappa, arc: a0, target: null, dy: 0, dyWant: 0 };
    histReset(p0[0], p0[1], c.psi0, 0, T.U);
    above.fill(0); broke.fill(0); lastRing.fill(-1e9); rings.length = 0;
    if (script && kind === 'breach') { play('swim', 0); play('surface', 0); play('breach', T.lead + 0.6); play('arc', T.lead + 6); play('flick', T.flick[0] + 2); play('dive', T.dive + 2); S.dive = T.dive + 2; }
    else if (script && kind === 'neck') {
      // the arc's neck is full 3.5 s after its start and holds 9 s: up 3 s before the flash, down after it, the dive 3 s after
      const fl = Math.max(T.lead + 4, flashIn ?? 12), arcAt = Math.max(T.lead, fl - 4);
      play('swim', 0); play('surface', 0); play('arc', arcAt); S.dive = fl + 3.5; play('dive', S.dive);
    } else if (script) { play('swim', 0); play('surface', 0); play('arc', T.neckUp[0]); play('flick', T.flick[0]); play('dive', T.dive); }
    st.phase = 'rise'; st.visible = true;
    sightings.push({ kind, n: count + 1, at: +playT.toFixed(2), minClearM: Infinity, breakAt: +(playT - offset + T.lead).toFixed(2), x: +c.x0.toFixed(1), z: +c.z0.toFixed(1), side: c.side, R: c.R, bear: c.bear, depth: c.depth == null ? null : +c.depth.toFixed(1), sideOn: c.sideOn == null ? null : +c.sideOn.toFixed(2), attempts: attempt + 1, minBoatM: Infinity, minHullM: Infinity, shy: false, inView: null, rare: false, inArea: area ? inAreaPt(c.x0, c.z0) : null, near: area ? nearNow : null });
    count++; attempt = 0; cued = false;
    // fast-forward a capture's offset (the nose swims, the clips run; no events)
    if (offset > 0) { const h = 1 / 30; for (let k = 0; k < offset / h; k++) { S.t += h; advanceNose(h); } body(S.t); for (let i = 0; i < N; i++) prevY[i] = spine[i * 8 + 1]; water(S.t, 0); st.events.length = 0; }
  }
  function end() {
    st.phase = 'idle'; st.visible = false; S = null; st.clear = Infinity; st.held = 0; st.paddle = null; st.gape = 0;
  }

  const self = {
    T, CLIPS, get L() { return L; }, set L(v) { L = v; },
    state: st, sightings,
    get cued() { return cued; }, area, get nearArea() { return nearNow; }, get playT() { return playT; }, get line() { return line; }, get rare() { return rare; },
    // ?tessie=now: a sighting at once (offset s into its timeline: a capture shows the humps and the neck up)
    now(offset = 11, ctx = null) {
      const b = ctx?.boat ?? boatNow; if (!b) { cued = true; return false; }
      const p = ctx?.view ? place(b, ctx.view) : null;
      if (p) { start({ ...p.c, depth: p.r.depth, sideOn: p.r.sideOn }, { offset }); return true; }
      const a = b.heading - 32 * DEG;
      start({ x0: b.x + Math.sin(a) * 70, z0: b.z - Math.cos(a) * 70, psi0: b.heading - 10 * DEG, kappa: 0, phase: 0, side: -1, R: 70, bear: 32, depth: null }, { offset });
      return true;
    },
    // the stage director's cue: a sighting due now (placed at the next step with a spot); cancel(): no longer (not one under way)
    // M3: cue({ kind: 'breach' | 'neck', flashAt }) stages a rare moment (flashAt: the play time of the lightning's flash)
    cue(o = {}) { if (S) return false; cued = true; retryAt = playT; cueOpt = { ...o }; return true; },
    cancel() { cued = false; attempt = 0; cueOpt = {}; },
    get kind() { return S?.kind ?? null; },
    // ---- M3: the 3-D path, the touch and the calm ----
    // depth(dy): her nose goes dy m under her swimming depth (≤ 0; her body follows its path down), at an animal's rate
    // rate: m/s, her fastest change while it holds (play as Tessie's climb; absent: TESSIE.dyRate)
    depth(dy = 0, rate = null) { if (!S) return false; S.nose.dyWant = Math.min(0, dy); S.nose.dyRate = rate > 0 ? rate : null; return true; },
    get dy() { return S ? S.nose.dy : 0; },
    // contact(true): she means to touch the hull (the strike): no reflex under it; the hold still keeps her skin outside
    contact(on = true) { if (!S) return false; S.contact = !!on; if (on) S.duck = 0; return true; },
    // behave(true): a behaviour drives her near the boat (alongside, under): a boat close by does not make her shy
    behave(on = true) { if (!S) return false; S.calm = !!on; return true; },
    get calm() { return !!S?.calm; },
    // her least gap to the boat over the sighting (m; the revenge's strike reads this frame's: st.clear)
    get clearMin() { const r = sightings[sightings.length - 1]; return r ? r.minClearM : Infinity; },
    // ---- the motion API (for a chase or a behaviour later; TK) ----
    // the revenge's hold (v2/sim/tessieRevenge.js): while on, a boat close by does not make her shy (she is the one coming)
    hunt(on = true) { if (!S) return false; S.chase = !!on; return true; },
    get hunting() { return !!S?.chase; },
    // play as Tessie (v2/sim/tessiePlay.js): drive(true) hands her to the player's controller: no scripted dive or
    // shy sink (a sighting under way is taken over where it is), no riseUnder, never shy of a boat; drive(false) gives her back to herself
    drive(on = true) {
      if (!S) return false;
      if (on) { S.sinkAt = null; S.dive = Infinity; S.rise = null; S.chase = true; S.calm = true; S.driven = true; }
      else { S.driven = false; S.chase = false; S.calm = false; S.contact = false; S.bank = 0; }
      return true;
    },
    get driven() { return !!S?.driven; },
    // play as Tessie: her neck up (at the surface) or down (a dive, the lunge's run), eased in the step
    neck(on = true) { if (!S) return false; S.neckWant = typeof on === 'number' ? Math.max(0, Math.min(1, on)) : on ? 1 : 0; return true; },
    // play as Tessie,: a bite (kind 'snap' | 'rail' | 'dash', BITE2) starts now; aim: [x, y, z] the point her head strikes
    // at (null: straight on, a little down); side: +1 the target lies to her right (the coil and the roll's sign); biteAim moves the aim
    // (the boat sails on), biteHit(hit) gives the verdict at contact (the follow-through's grip and shake, or one shake)
    bite(kind = 'snap', { aim = null, side = 1, meet = 0 } = {}) { if (!S || !BITE2[kind]) return false; return play('bite', S.t, { kind, aim: aim ? [...aim] : null, side: side >= 0 ? 1 : -1, hit: null, meet }); },   // meet: m from the contact point within which the strike carries her jaw onto it
    biteAim(x, y, z) { const c = S && clipAt('bite'); if (!c) return false; c.aim = x == null ? null : [x, y, z]; return true; },
    biteHit(hit) { const c = S && clipAt('bite'); if (!c) return false; c.hit = !!hit; return true; },
    // the coil held (the controller's: a rail bite pressed before the rail is in reach holds its wind-up pose): the clip's clock waits dt
    biteHold(dt) { const c = S && clipAt('bite'); if (!c || !(dt > 0)) return false; c.at += dt; return true; },
    get biteState() { return S?.biteNow ?? null; },
    // play as Tessie's breach: BREACH_PLAY's timing; roll (rad) in the air (R2: she lands on her side), lean (rad) of
    // the fall toward the boat (R1); B: the arc's own timing { up, hang, down } (the RPG's Breach: a 1.6 s arc), else BREACH_PLAY's
    breach({ roll = 0, lean = 0, B = null } = {}) { if (!S) return false; S.breachRoll = roll; S.leanX = lean; return play('breach', S.t, { B: B ?? BREACH_PLAY }); },
    // play as Tessie's gaits: dash (the burst runs), dive (0…1: the tail lifts as she goes down), look (rad: her head
    // leads toward it, null: toward the boat as her sightings do)
    gait({ dash = false, dive = 0, look = null } = {}) { if (!S) return false; S.gaitDash = !!dash; S.gaitDive = Math.max(0, Math.min(1, dive)); S.lookWant = Number.isFinite(look) ? look : null; return true; },
    // play as Tessie: her body banks into a turn: the up vectors rolled about the spine by `rad` (+ toward her right),
    // spread over s 3–14 m (the neck and the tail's tip roll less); only while driven, so her sightings look as before
    bank(rad = 0) { if (!S) return false; S.bank = Number.isFinite(rad) ? rad : 0; return true; },
    // a chase's start (TK): a new bare sighting, her nose at (x, z) heading `heading`, 4.5 m down and rising (the surface clip:
    // the humps grow in as she comes), hunting; then swimTo steers her
    ambush(x, z, heading, speed = T.U) {
      const a0 = noseArc(0);
      start({ x0: x - Math.sin(heading) * a0, z0: z + Math.cos(heading) * a0, psi0: heading, kappa: 0, phase: hash01(seed, 300 + count) * Math.PI * 2, side: 0, R: boatNow ? Math.round(Math.hypot(x - boatNow.x, z - boatNow.z)) : 0, bear: 0, depth: null }, { script: false });
      play('swim', 0); play('surface', 0);
      S.nose.speed = speed; S.chase = true;
      return true;
    },
    // a sound moment at her nose or her tail now (the strike's deep breath; the give-up's slap)
    // 2c: rings on the surface at a point (the strike from below's warning): real rings in her water map, as her own surfacing's
    ring(x, z, amp = 0.7) { if (!S) return false; rings.push({ x, z, t0: playT, amp }); return true; },
    emit(type, at = 'nose', s = 1) { if (!S) return false; const o = at === 'tail' ? (N - 1) * 8 : 0; ev(type, spine[o], type === 'breath' ? Math.max(0.3, spine[o + 1] + 0.3) : 0, spine[o + 2], s); return true; },
    play(name, at) { return !!CLIPS[name] && play(name, at); },
    // steer her nose to (x, z) at `speed` m/s (null: back to her own course)
    swimTo(x, z, speed = T.U, acc = null, turn = null, max = null) { if (!S) return false; S.nose.target = x == null ? null : { x, z }; S.nose.want = Math.max(0, Math.min(max ?? T.speedMax, speed)); S.nose.acc = acc ?? undefined; S.nose.turnMax = turn ?? undefined; S.dive = Infinity; return true; },   // max: a caller's own top (the RPG's Dash ranks past 19.5 m/s)
    // bring her up under (x, z): she starts (or stays) 4.5 m down, swims to it at `speed`, and within `near` m surfaces and breaches there
    riseUnder(x, z, { speed = 3.5, near = 4, from = 40, heading = null, breach = true } = {}) {
      if (!S) {
        // her nose `from` m short of the point on `heading` (default: from where the point lies off her course 0)
        const psi = heading ?? 0, nx = x - Math.sin(psi) * from, nz = z + Math.cos(psi) * from, a0 = noseArc(0);
        start({ x0: nx - Math.sin(psi) * a0, z0: nz + Math.cos(psi) * a0, psi0: psi, kappa: 0, phase: 0, side: 0, R: from, bear: 0, depth: null }, { script: false });
        play('swim', 0);
      }
      S.rise = { x, z, near, breach, done: false };
      return self.swimTo(x, z, speed);
    },
    step(dt, ctx = {}) {
      const { playing = true, boat = null, view = null, race = false } = ctx;
      boatNow = boat;
      if (boat) nearNow = nearArea(boat);
      // M3: the boat as drawn (its heave, heel, pitch, boom and jib when the page gives them)
      boatPosed = !!boat;
      if (boat) clear.pose(boat);
      st.events.length = 0;
      if (!playing || !(dt > 0)) return st;
      playT += dt;
      if (race && S && S.dive > S.t + 0.5) play('dive', S.t + 0.5);
      if (!S) {
        if (!cued || !boat || !view || race) return st;
        if (playT < retryAt) return st;
        // near her water: a spot inside it (the opening only when one fits at once; later ones keep trying, then waive the
        // view); elsewhere, or the opening with no spot in her water, the ring round the boat as before
        let p = null;
        const moment = cueOpt.kind === 'breach' || cueOpt.kind === 'neck';
        if (area && nearNow) p = placeInArea(boat, view, { free: count > 0 && attempt >= T.areaFreeAfter });
        if (!p && (!area || !nearNow || count === 0 || moment)) p = place(boat, view, moment);
        if (!p) { attempt++; retryAt = playT + T.retryS; return st; }
        start({ ...p.c, depth: p.r.depth, sideOn: p.r.sideOn }, { kind: cueOpt.kind ?? 'sighting', flashIn: cueOpt.flashAt != null ? cueOpt.flashAt - playT : null });
        cueOpt = {};
        // the rare line (once a session, on a later sighting, 1 in 2 by seed): light, never on the first
        if (count >= 2 && !rare.said && hash01(seed, 500 + count) < 0.5) S.rareLine = true;
      }
      const tPrev = S.t;
      S.t += dt;
      const t = S.t;
      // M3, the reflex: her nose about to meet the hull (where it will be in duckLookS at its way, at the depth she swims now)
      // ducks under it, and stays down while the hull is near her way
      if (boat && !S.contact && clear.near(S.nose.x, S.nose.z, 4)) {
        const n = S.nose, k = Math.max(2, n.speed) * T.duckLookS, ny = baseY(t) + n.dyWant;   // the depth she would swim at
        let near = Infinity;
        for (let j = 0; j <= 4; j++) { const u = k * j / 4; near = Math.min(near, clear.sdf(n.x + Math.sin(n.psi) * u, ny, n.z - Math.cos(n.psi) * u) - 0.8); }
        S.duck = near < T.duckM ? 1.5 : Math.max(0, S.duck - dt);
      } else if (S.duck > 0) S.duck = Math.max(0, S.duck - dt);
      advanceNose(dt);
      if (S.driven) S.bodyDy = S.bodyDy == null ? S.nose.dy : S.bodyDy + (S.nose.dy - S.bodyDy) * (1 - Math.exp(-dt / T.followS));   // 2c: the body's depth, eased after the nose's
      else S.bodyDy = null;
      // play as Tessie: her neck eases up (or down) at an animal's pace, about 2.5 s
      if (S.driven || S.neckK) S.neckK = Math.max(0, Math.min(1, (S.neckK ?? 0) + Math.max(-dt / (S.driven ? 0.5 : 2.5), Math.min(dt / (S.driven ? 1.2 : 2.5), (S.driven ? +S.neckWant || 0 : 0) - (S.neckK ?? 0)))));   // play as Tessie: the neck goes down in 0.5 s for a dive (owner, 2026-11-20: "not heavy")
      // riseUnder: near the point, the surface (and the breach) there
      if (S.rise && !S.rise.done && Math.hypot(S.nose.x - S.rise.x, S.nose.z - S.rise.z) < S.rise.near) {
        S.rise.done = true; if (!clipAt('surface')) play('surface', t - 3.0); if (S.rise.breach) play('breach', t);   // already up (a chase): she stays up
        S.nose.target = null; S.nose.want = T.U;
        play('dive', t + (S.rise.breach ? BREACH.up + BREACH.hang + BREACH.down + 4 : 8));
      }
      if (boat) {
        const d = ds();
        let minD = Infinity, minUp = Infinity;
        for (let i = 0; i < N; i += 2) {
          const dd = Math.hypot(spine[i * 8] - boat.x, spine[i * 8 + 2] - boat.z);
          minD = Math.min(minD, dd);
          if (spine[i * 8 + 1] + heightAt(i * d, L) > -2.5) minUp = Math.min(minUp, dd);
        }
        const rec = sightings[sightings.length - 1];
        if (t > 0.1) { rec.minBoatM = Math.min(rec.minBoatM, minD); rec.minHullM = Math.min(rec.minHullM, minUp); }
        const bx = boat.x - (S.lastBoat?.x ?? boat.x), bz = boat.z - (S.lastBoat?.z ?? boat.z);
        const closing = dt > 0 ? -((st.centre[0] - boat.x) * bx + (st.centre[1] - boat.z) * bz) / Math.max(1e-6, Math.hypot(st.centre[0] - boat.x, st.centre[1] - boat.z)) / dt : 0;
        S.lastBoat = { x: boat.x, z: boat.z };
        const soon = closing > 0.5 && minD / closing < T.nearS && minD < T.nearM * 2;
        if (!S.rise && !S.chase && !S.calm && (minD < T.nearM || soon) && S.sinkAt == null && t > 0.5) { S.sinkAt = t; if (S.dive > t + 0.5) play('dive', t + 0.5); rec.shy = true; }
        const ib = Math.round(T.neckS / d); histAt(ib * d, tmp); const hb = Math.max(1, ib - 1); histAt(hb * d, tmp2);
        const want = Math.atan2(boat.x - tmp[0], -(boat.z - tmp[1])) - Math.atan2(tmp2[0] - tmp[0], -(tmp2[1] - tmp[1]));
        const w = Math.max(-35 * DEG, Math.min(35 * DEG, Math.atan2(Math.sin(want), Math.cos(want))));
        S.look += (w - S.look) * Math.min(1, dt * 0.6);
      }
      // play as Tessie: her gait eased toward her pace and depth, the waves' phases by the distance swum, the flippers
      if (S.driven) {
        const v = S.nose.speed, kE = 1 - Math.exp(-dt * 3 / GAIT.blendS), nz = Math.max(0, -spine[1]);
        if (S.lookWant != null) S.look += (S.lookWant - S.look) * Math.min(1, dt * 4);
        S.dashK += ((S.gaitDash ? 1 : 0) - S.dashK) * kE; S.diveK += ((S.gaitDive || 0) - S.diveK) * kE;
        const u = smooth(1.2, 3.0, nz), kc = smooth(0.5, GAIT.cruiseV, v), G = S.gait;
        for (const k of ['hump', 'lam', 'sway', 'swayLam', 'paddle', 'hz']) {
          const cruise = GAIT.surface[k] + (GAIT.under[k] - GAIT.surface[k]) * u, swim = GAIT.drift[k] + (cruise - GAIT.drift[k]) * kc;
          G[k] += (swim + (GAIT.dash[k] - swim) * S.dashK - G[k]) * kE;
        }
        S.phV = GAIT.humpK * v; S.phH += S.phV * dt; S.phS += GAIT.swayK * v * dt; S.padPh = (S.padPh + 2 * Math.PI * G.hz * dt) % (2 * Math.PI);
        st.paddle = { phase: S.padPh, amp: G.paddle * DEG };
      } else st.paddle = null;
      body(t);
      // M3: her least gap to the boat this frame (what the hold left; the tests and the strike read it)
      st.clear = boat ? clear.clearOf(spine, L, reach) : Infinity;
      { const rec = sightings[sightings.length - 1]; if (rec && st.clear < rec.minClearM) rec.minClearM = st.clear; }
      water(t, dt);
      moments(t, tPrev);
      st.nose = { x: S.nose.x, z: S.nose.z, psi: S.nose.psi, speed: S.nose.speed };   // the leader (the motion API's)
      st.played = !!S.driven;
      st.t = t; st.wetAge = S.driven ? Math.min(1.5, Math.max(0, t - T.lead)) : Math.max(0, t - T.lead);   // driven: her humps wash through the surface all the time, so she stays wet
      st.phase = breachK(t) > 0 ? 'breach' : t < T.lead ? 'rise' : t < T.neckUp[1] ? 'surface' : t < S.dive ? 'swim' : 'dive';
      st.clips = S.clips.filter((c) => t >= c.at && t < c.at + CLIPS[c.name].dur).map((c) => c.name);
      let cx = 0, cz = 0; for (let i = 0; i < N; i++) { cx += spine[i * 8]; cz += spine[i * 8 + 2]; }
      st.centre[0] = cx / N; st.centre[1] = cz / N;
      const rec = sightings[sightings.length - 1];
      if (rec.inView == null && t >= T.lead && view) rec.inView = inView(view, st.centre[0], st.centre[1], 1);
      const seen = view && inView(view, st.centre[0], st.centre[1], 1);
      if (!line.said && t >= T.lead + 0.5 && seen) { line.said = true; line.at = +playT.toFixed(1); line.pending = T.line; }
      else if (S.rareLine && !rare.said && t >= T.neckUp[1] + 1 && seen) { rare.said = true; rare.at = +playT.toFixed(1); line.pending = T.rareLine; rec.rare = true; }
      // gone: every point 5.5 m down after the dive (a bare sighting: after its clips, when deep)
      if (!S.driven && (t > S.dive + 2 || (!clipAt('surface') && t > 5))) {   // driven (play as Tessie): she stays
        let deep = true; for (let i = 0; i < N; i++) if (spine[i * 8 + 1] + heightAt(i * ds(), L) > -5.5) { deep = false; break; }
        if (deep && !(S.rise && !S.rise.done)) end();
      }
      return st;
    },
    stats() {
      return { phase: st.phase, visible: st.visible, t: +st.t.toFixed(2), playT: +playT.toFixed(2), cued, near: area ? nearNow : null, count, attempt, refused: { ...why }, clips: st.clips.slice(),
        clear: Number.isFinite(st.clear) ? +st.clear.toFixed(2) : null, held: +st.held.toFixed(2),
        sightings: sightings.map((s) => ({ ...s, minClearM: Number.isFinite(s.minClearM) ? +s.minClearM.toFixed(2) : null, minBoatM: Number.isFinite(s.minBoatM) ? +s.minBoatM.toFixed(1) : null, minHullM: Number.isFinite(s.minHullM) ? +s.minHullM.toFixed(1) : null })), line: { said: line.said, at: line.at }, rare: { said: rare.said, at: rare.at } };
    },
  };
  return self;
}
