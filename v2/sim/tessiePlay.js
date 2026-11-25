// Play as Tessie, the controller (§ 4.2 and § 7 phase 1a; the owner's final scheme, 2026-11-20;
// step 1: speed by medium and the dash). Pure: no DOM, no GPU, no Math.random, no wall clock. It maps the player's hands onto her own
// motion API (v2/sim/tessie.js: ambush, drive, swimTo, depth, play, contact, emit, bank), so she moves as she moves today: her nose eases
// to the speed it is given, turns at most the medium's cap, climbs and dives at the rate given; her body follows its path.
//   const C = createTessiePlay({ sim, depthAt })    depthAt(x, z) → m of water (> 0 over water)
//   C.begin({ x, z, heading } | null) / C.end()
//   C.step(dt, hands, { target })        hands: { move: [x right, y away] (−1…1, about the camera), camYaw (rad), look (the player's look:
//                                       the camera's pitch minus its neutral, rad, + down; phase 1's pitch is read when look is absent),
//                                       rise (E or ▲ held), sink (Q or ▼ held), lookSteers (false on a tablet), sprint (Shift held: its
//                                       press is the dash), dash (a dash press this step: the tablet's DASH slot, a pose), bite
//                                       (Space held, or a click's pulse) }; target: the corners' boat ({ id, x, z, heading, u, d, inReach } or null)
//   C.result(hit)                       the page's verdict on the last 'fall' (v2/sim/tessieHits.js): 'Got them!' or the sulk
//   C.skills                            her skills (v2/sim/tessieSkills.js): C.skills.state('dash') → { phase, k (the ring), level }
//   C.state  { on, speed, want, dash (the burst runs), sprint (the same: the bubbles read it), noseWant, nose (m under the surface), word,
//            lunge, rest, surge, shore, way, climb (m/s of nose depth, + deeper), limit ('floor' | 'surface' | null), lim (her deepest here),
//            u (0 the surface's numbers … 1 the water's), cruise (m/s here), omega (rad/s: her wanted turn, ramped), bank (rad, + to her right) }
//   C.events this step's: 'fall' { x, z, psi } (her front 9 m lands), 'surfaced', 'lunge', 'breach', 'surge', 'dash', 'verdict' ({ hit })
// Speed by medium (owner, 2026-11-20: "much faster under the water, the dash faster still"): every row blends from
// its surface value to its under-water value by smoothstep over her nose's depth from 1.2 m to 3.0 m (PLAY.blend), so the change is felt
// as she goes down, never as a step. W held: 6 m/s at the surface (effortful), 11 m/s under the water (smooth, agile); let go, a drift
// (0.5 m/s). Every lake sailboat sails 3–4.5 m/s, so W alone catches one: slowly at the surface, easily under it.
// Turns (§ 2.1): from a drift 15 / 35°/s, at cruise 30 / 50°/s, on the dash 14 / 24°/s (surface / under); the wanted turn rate ramps at
// 90 / 160°/s² (she rolls into and out of a curve, never a bang-bang heading) and banks her body into the turn (at most 12° at the surface,
// 30° under the water: sim.bank).
// The dash (§ 2.3; owner: "like Link's in Zelda"): a press of Shift (edge-triggered; held does nothing more) gives 19 m/s under the water,
// 12 m/s at the surface (blended by depth), ramped at 30 / 20 m/s², for 1.8 s from the press; then back to her cruise at 8 m/s², and 4.5 s
// of cooldown from the burst's end; a press in the cooldown's last 0.3 s fires the moment it is ready. With no way held she dashes straight
// ahead. The 15 s stamina run is gone.
// Swim (owner: "like how you move a robot"): W A S D (the arrows, the stick) give the way she swims about the camera (W away from it, S
// toward it); held, she turns into it at her rate (she curves round, never spins or crabs). The camera's yaw is read when the keys change
// (and moved with the player's own drag), so S turns her about as the camera swings round behind her.
// Up and down (§ 3.5; owner, 2026-11-20, every default approved): the look sets a climb rate, not a depth. Her swim
// pitch is the player's own look (hands.look: the camera's pitch minus its neutral, + down); within ±PLAY.holdDeg she holds her depth;
// past it the rate grows (smoothstep) to its cap at PLAY.fullDeg: PLAY.rate swimming, PLAY.rateRun on the dash, and the look steers only
// while she swims (W A S D held), never at a drift. E rises and Q sinks (hands.rise, hands.sink, held) at the cap at any speed
// (PLAY.rateDrift from a drift); keys win over the look. At the surface (nose under PLAY.surfaceNose) a look down under PLAY.diveGuard
// keeps her up (phase 1's guard). Her deepest is 20 m, never deeper than the water less 2 m, no dive in water under 6 m; the rate eases to
// 0 over the last PLAY.easeM before any limit (the floor, 20 m, the surface: the surface's catch), so she never bumps. On a tablet the look
// never steers (hands.lookSteers false: the ▲/▼ buttons are E and Q).
// Breach: at the surface, the dash with the look PLAY.breachDeg up, or the dash with E; from depth, a dash climbing at
// least PLAY.breachClimb m/s as her nose passes PLAY.breachAtM (the catch skipped): up, hang, the fall (the page judges it).
// The strike (step 5; it replaced the run, the breach onto the boat and the 6 s sulk: press to the hit test
// was 4.2 s, 8–10 s with no steering after a miss, a 24 m/s² brake): one state machine, swim → windup → strike → follow → recover → swim
// (the bites: sim/tessie.js BITE2) and rise → breach → recover (the breaches), each beat blended in over 0.08 s; no beat sets her speed or
// her target in one frame. Space (or a left click) picks the bite by what she is doing:
//   the dash bite (B3)   during the dash or within PLAY.dashBiteS after it: no wind-up, the strike at 0.25 s, the knockdown × 1.15
//   the rising strike (R1) locked from PLAY.strikeFrom m or deeper: the warning's rings 1.5 s, the rise at 6 m/s onto a spot off its beam,
//                        the breach (up 1.1, hang 0.35, down 0.9 s: 2.35 s), her fall the hit (a footprint of 3.5 m while locked)
//   the rail bite (B2)   locked at the surface (or a boat in the corners within PLAY.reachM): wind-up 0.30, strike 0.22, the contact test
//                        0.52 s after the press (her head within 3.0 m of the locked hull, 2.0 m otherwise), follow-through 0.70,
//                        recovery 0.45 (1.67 s in all); her body lunges +3 m/s for 0.4 s
//   the snap (B1)        nothing near: wind-up 0.15, strike 0.18, recovery 0.35 (0.68 s); no surge, no attack on empty water
// Steering never stops (§ 6.2): 100 % in the wind-up, 30 % in the strike, 50 % in the follow-through, back to 100 % early in the recovery;
// the rise 60 %, the breach 30 %; the climb scaled the same. Her pace is never braked harder than PLAY.strikeStop (6 m/s²). A press is
// held PLAY.bufS (0.25 s): pressed just before a boat enters the lock, or in the cooldown's last 0.25 s, it fires then. The cooldown: 0.8 s
// after a miss, 2.5 s after a hit (from the contact); a dash press in the recovery cuts it short; nothing cancels a strike once begun.
// The lock (ctx.lock from sim/tessieHits.js lock()): her wanted heading eases toward the locked boat's intercept with
// weight 0.45 (0.55 under the water) × its blend, adding at most 20°/s to her own turn (a hard turn by the player always wins).
import { BREACH_PLAY, biteBeats, biteDur, BITE2 } from './tessie.js';
import { createSkills, SKILLS } from './tessieSkills.js';
import { HITS, hullDist } from './tessieHits.js';

const ROW = (o) => Object.freeze(o);
export const PLAY = Object.freeze({
  drift: 0.5,                    // m/s: let go, she treads water
  //: the surface's numbers and the water's, blended by her nose's depth over `blend` (m). m/s, m/s², °/s, °/s², °
  surface: ROW({ cruise: 6.0, acc: 3.0, stopAcc: 4.0, turnSlow: 15, turnFast: 30, turnDash: 14, turnMax: 32, slew: 90, bank: 12, dash: 12.0, dashAcc: 20 }),
  under: ROW({ cruise: 11.0, acc: 7.0, stopAcc: 9.0, turnSlow: 35, turnFast: 50, turnDash: 24, turnMax: 55, slew: 160, bank: 30, dash: 19.0, dashAcc: 30 }),
  blend: Object.freeze([1.2, 3.0]),
  dashEase: 8.0,                 // m/s²: after the burst, back to her cruise (19 → 11 in 1.0 s)
  top: 19.0,                     // m/s: her fastest (the dash under the water): the rush sound's top
  bankK: 0.5, bankTau: 0.3, g: 9.81,   // the bank: roll = bankK · atan(v ω / g), at most the medium's, eased over bankTau s
  stopK: 0.9,                    // the turn's ramp down: at most stopK × the rate that stops on the wanted heading (no overshoot)
  lookM: 40,                     // m: the point her nose swims at, ahead on the heading she wants
  swimY: 0.75,                   // m: her nose's depth at the surface swim (TESSIE.base[1])
  diveNose: 6, deepNose: 20, noDiveM: 6, roomM: 2,   // m: her deepest 20 (Q1; phase 1: 8); water under noDiveM: no dive; her deepest is the water less roomM
  diveGuard: 15, fullDeg: 35, holdDeg: 8,   // °: at the surface a look down under the guard keeps her up; the look's climb rate is full at fullDeg; within ±holdDeg she holds
  rate: 4.5, rateRun: 6.75, rateDrift: 2.25,   // m/s: the climb rate's cap swimming, on the dash, and the keys' from a drift
  climbS: 0.07,                  // s: the climb's ease-in (about 0.2 s to its rate, and as quick to stop)
  strikeRise: 6.0, runMax: 3.5, reachDeep: 15, strikeFrom: 3,   // the rising strike from depth: m/s up, s at most before the breach, m of reach under the water, m of nose that makes it one
  easeM: 2.25,                   // m: the rate eases to 0 over this much before any limit (the floor, her deepest, the surface's catch)
  surfaceNose: 1.2,              // m: her nose shallower than this is at the surface (the dive guard holds there)
  breachDeg: 8, breachRest: 6,   // °: the dash looking this far up at the surface breaches; s between breaches
  breachClimb: 3.0, breachAtM: 1.5,   // the dash climbing at least 3.0 m/s from depth breaches as her nose passes 1.5 m
  hiddenM: 8,                    // m: deeper than this the boats never see her (the dial says HIDDEN)
  shoreM: 3, shoreLook: Object.freeze([10, 22, 40]),   // m of water her nose turns away from, looked for this far ahead
  warn: Object.freeze({ s: 1.5, every: 0.3, amp: 0.7, seeM: 45 }),   // the strike from below: s of rings over her before the breach, s between rings, their size, m within which a boat sees them
  //: the strike's state machine
  strikeStop: 6,                 // m/s²: her pace is never braked harder through a bite or a breach
  bufS: 0.25,                    // s a Space press is held (a lock arriving, the cooldown ending)
  coolHit: 2.5, coolMiss: 0.8,   // s from the contact (or the fall) to the next bite
  dashBiteS: 0.4,                // s after the dash a bite is still the dash bite
  lungeV: 3, lungeS: 0.4,        // the rail bite's lunge: + m/s over s from the strike
  steerRise: 0.6, steerBreach: 0.3, recoverS: 0.45,   // the breach family's steering shares, its recovery (s)
  holdLockM: 16,                 // m: a press with a boat this near in the corners (not yet locked) waits its buffer for the lock
  reachHitM: 2.4, holdMaxS: 2.0,   // the rail bite holds its coil until her nose will be this near the hull as the strike lands (m; her unfolding neck brings the head to it), at most this long (s)
  strikeOffM: 0.6, reachM: 12,   // m off the hull's middle line the rising strike comes up (under its bilge on her side: her head and back meet its bottom); a boat in the corners this near is the rail bite's even unlocked
  riseHitS: 0.3,                 // s into the rising strike's breach: her head and back meet the hull's bottom (the contact: the boat lifted and rolled)
  freeRoll: 70, leanDeg: 20,     // °: the free breach's roll in the air (every other one: R2), the rising strike's fall toward the boat
  surfacedM: 1.0,                // m: the nose this near the surface counts as surfaced (her breath; it swims 0.75 m down there)
  lead: 0.6,                     // s: the depth target leads her nose by the sim's own ease (TESSIE.dyTau), so she moves at the rate asked
});
// her teaching lines (the UI audit, owner 2026-11-21: they go through Sail's skipper line, living/tessiePlayer.js tip(); no status lines:
// "Got them!" and "Next time…" are gone). Plain text; [K] marks a key cap (the player draws it as the hint line's .cap; a tablet's
// lines name no key). Whole short sentences.
export const LINES = Object.freeze({
  tip: 'Drag to look. [W][A][S][D] to swim, [⇧] or [1] to dash, [SPC] or click to bite.', tipTouch: 'Use the stick to swim and drag to look. Tap DASH to dash and Bite to bite.',
  fast: 'Faster below the surface. Hold [Q] to dive.', fastTouch: 'Faster below the surface. Hold ▼ to dive.',
  dash: '[⇧] or [1] gives a burst of speed.', dashTouch: 'Tap DASH for a burst of speed.', look: 'Look up to see the boats.' });
const DEG = Math.PI / 180;
import { clampT as clamp } from '../../src/sim/core/math.js';
import { wrap } from '../../src/sim/core/math.js';
export const BREACH_S = BREACH_PLAY.up + BREACH_PLAY.hang + BREACH_PLAY.down;   // 2.35 s
export const FALL_S = BREACH_PLAY.up + BREACH_PLAY.hang + BREACH_PLAY.down * 0.8;
const sm01 = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
//: the steering share of the breach family at L (rise 60 %, breach 30 %, recovery back to 100 %)
const lungeSteer = (L, K) => (!L ? 1 : L.phase === 'rise' ? K.steerRise : L.phase === 'breach' ? K.steerBreach + (K.steerRise - K.steerBreach) * (1 - sm01(L.t / 0.08)) * (L.fromRise ? 1 : 0) : K.steerBreach + (1 - K.steerBreach) * sm01(L.t / K.recoverS));
// where her jaw meets the boat (the owner's son, 2026-11-21: "we're attacking the water at the side of the sailboat, not really the boat"),
// chosen by her approach: from astern the transom; else the gunwale on her side (the rail bite clamps it; the dash bite takes the topsides
// lower). The point lies CONTACT.inM inside the hull's skin: the sim's hold then sets her head flush on the real hull (its proxy: the
// waterline and the gunwale), so there is no gap and no clipping. → [x, y, z, where ('stern' | 'rail' | 'side'), side (+1 her on its starboard)]
export const CONTACT = Object.freeze({ inM: 0.35, railY: 0.75, sideY: 0.35, sternY: 0.55, sternM: 0.8, endM: 0.6 });
// a kayak's (round B: 3.4 × 0.85 m, its deck ≈ 0.3 m over the water): her jaw on its gunwale (no sim hold sets her flush on a kayak, so
// the point is on its skin, inM 0), the dash bite on its side at the waterline, from astern its stern deck
const CONTACT_KAYAK = Object.freeze({ inM: 0, railY: 0.3, sideY: 0.12, sternY: 0.25, sternM: 0.5, endM: 0.45 });
export function contactPoint(b, hx, hz, kind = 'rail', K = CONTACT, where = null) {   // where: kept once chosen (the jaw never jumps from the rail to the transom)
  if (K === CONTACT && b.kind === 'kayak') K = CONTACT_KAYAK;
  const fx = Math.sin(b.heading ?? 0), fz = -Math.cos(b.heading ?? 0), dx = hx - b.x, dz = hz - b.z, L = b.L ?? 8.5, B = b.B ?? 3;
  const a = dx * fx + dz * fz, c = dx * -fz + dz * fx, side = c >= 0 ? 1 : -1;
  if (where === 'stern' || (!where && a < -L / 2 + K.sternM && Math.abs(c) < B * 0.8)) { const at = -L / 2 + K.inM; return [b.x + fx * at, K.sternY, b.z + fz * at, 'stern', side]; }
  const along = clamp(a, -L / 2 + K.endM, L / 2 - K.endM), out = B / 2 - K.inM;
  return [b.x + fx * along - fz * side * out, kind === 'dash' ? K.sideY : K.railY, b.z + fz * along + fx * side * out, kind === 'dash' ? 'side' : 'rail', side];
}

//: the share of the water's numbers at this nose depth (0 at the surface, 1 under the water), smoothstep over K.blend
export function mediumU(nose, K = PLAY) {
  const u = clamp((nose - K.blend[0]) / (K.blend[1] - K.blend[0]), 0, 1);
  return u * u * (3 - 2 * u);
}
// every row of the speed model at this depth: the surface's value blended into the water's
export function mediumK(nose, K = PLAY) {
  const u = mediumU(nose, K), out = { u };
  for (const k of Object.keys(K.surface)) out[k] = K.surface[k] + (K.under[k] - K.surface[k]) * u;
  return out;
}
// her turn rate (rad/s) at speed v for the blended row M: from a drift up to her cruise, then down to the dash's wider turn
export function turnRate(M, v, K = PLAY) {
  const a = clamp((v - K.drift) / Math.max(0.1, M.cruise - K.drift), 0, 1), b = clamp((v - M.cruise) / Math.max(0.1, M.dash - M.cruise), 0, 1);
  return (M.turnSlow + (M.turnFast - M.turnSlow) * a + (M.turnDash - M.turnFast) * b) * DEG;
}
// the bank (rad, + to her right) for her speed (m/s) and turn rate (rad/s, + to the right), at most maxDeg
export const bankFor = (v, omega, maxDeg, K = PLAY) => clamp(K.bankK * Math.atan(v * omega / K.g), -maxDeg * DEG, maxDeg * DEG);
// the turn's ramp (no bang-bang heading): the wanted turn rate moves toward the rate the way asks for at `slew` rad/s²,
// never past the rate that stops on the wanted heading (so she rolls out of the curve onto it); err (rad) the heading still to turn
export function rampTurn(omega, err, rate, slew, dt, K = PLAY) {
  const stop = K.stopK * Math.sqrt(2 * slew * Math.abs(err));
  const want = Math.sign(err) * Math.min(rate, stop, Math.abs(err) / Math.max(dt, 1e-6));
  return omega + clamp(want - omega, -slew * dt, slew * dt);
}

// the deepest her nose may go here (m under the surface) for the depth she wants
export function noseLimit(water, want, K = PLAY) {
  if (!(water >= K.noDiveM)) return 0;
  const goal = typeof want === 'number' ? Math.max(0, want) : want === 'deep' ? K.deepNose : want === 'dive' ? K.diveNose : 0;
  return Math.min(goal, K.deepNose, Math.max(0, water - K.roomM));
}
// the look's climb rate: look (rad, the camera's look minus its neutral, + down) → m/s of nose depth (+ deeper), at
// the cap given; within ±holdDeg nothing, then smoothstep to the cap at fullDeg
export function lookRate(look, cap, K = PLAY) {
  const a = Math.abs(look) / DEG;
  if (!(a > K.holdDeg)) return 0;
  const u = clamp((a - K.holdDeg) / (K.fullDeg - K.holdDeg), 0, 1);
  return Math.sign(look) * cap * u * u * (3 - 2 * u);
}
// the climb rate she is asked for (m/s of nose depth, + deeper, before the limits' ease): keys win (E up, Q down) at the cap (from a
// drift, rateDrift); else the look while she swims (never at a drift; never where the look does not steer: a tablet); at the surface a
// look down under the dive guard keeps her up. run: the dash runs (its climb cap)
export function climbRate({ look = 0, swimming = false, run = false, rise = false, sink = false, lookSteers = true, nose = 0, diveTo = 0 } = {}, K = PLAY) {
  const cap = !swimming ? K.rateDrift : run ? K.rateRun : K.rate;
  if (rise !== sink) return sink ? cap : -cap;
  if (diveTo > 0 && nose < diveTo - 0.1) return Math.max(cap, K.rate);   // the tablet's tap on ▼ at the surface: a dive to diveTo
  if (!swimming || !lookSteers) return 0;
  if (nose < K.surfaceNose && look > 0 && look / DEG < K.diveGuard) return 0;
  return lookRate(look, cap, K);
}
// the rate after the limits' ease: over the last easeM before the deepest (lim) or the surface swim (top) it ramps to 0, never past either
export function easeRate(v, nose, lim, top = PLAY.swimY, K = PLAY) {
  if (v > 0) { const room = lim - nose; return room <= 0 ? 0 : v * Math.max(clamp(room / K.easeM, 0, 1), Math.min(1, 0.08 / Math.abs(v))); }
  if (v < 0) { const room = nose - top; return room <= 0 ? 0 : v * Math.max(clamp(room / K.easeM, 0, 1), Math.min(1, 0.08 / Math.abs(v))); }
  return 0;
}
// phase 1's depth target by the look (kept for the old tests' maths; the controller no longer uses it): under the guard nothing, then
// deeper the steeper, toward 8 m by 45°
export function lookDepth(pitch, K = PLAY) {
  const p = pitch / DEG;
  if (p > K.diveGuard) return 1 + (8 - 1) * clamp((p - K.diveGuard) / (45 - K.diveGuard), 0, 1);
  return null;
}
export const depthWord = (nose) => (nose < 1.0 ? 'SURFACE' : nose < 2.0 ? 'AWASH' : nose < 12 ? 'DIVE' : 'DEEP');   //: SURFACE, AWASH, DIVE 2–12 m, DEEP 12–20 m (her nose swims 0.75 m down at the surface)

export function createTessiePlay({ sim, depthAt = () => 30, K = PLAY, skills = null } = {}) {
  const st = { on: false, speed: 0, want: K.drift, setting: K.drift, dash: false, sprint: false, noseWant: 0, nose: 0, word: 'SURFACE', lunge: null, bite: null, rest: 0, surge: 0, breachRest: 0, shore: false, psiWant: 0, lunges: 0, bites: 0, breaches: 0, way: null, climb: 0, climbWas: 0, climbV: 0, hidden: false, limit: null, lim: 0, u: 0, cruise: K.surface.cruise, omega: 0, bank: 0, yawRate: 0, steer: 1, phase: 'swim', lockId: null, lockK: 0, assist: 0, buf: 0, strike: null };
  const S = skills ?? createSkills(SKILLS);
  const HL = HITS.lock;
  let deepWas = false;   // her nose was deeper than breachAtM on this climb (a dash climb from depth breaches as it passes)
  let easing = false;    // the burst has ended and she is still above her cruise: back to it at dashEase
  let sinceDash = Infinity;   // s since the dash's burst ended (the dash bite's window)
  const events = [];
  let lungeWas = false, shiftWas = false, wasUnder = false, moveKey = null, refYaw = 0, psiWas = null;
  const ev = (type, o = {}) => events.push({ type, ...o });
  const nose = () => sim.state.nose ?? null;
  // the deepest water along a heading's look (min of the samples), for the shore turn
  const lookMin = (x, z, psi) => { let m = Infinity; for (const d of K.shoreLook) m = Math.min(m, depthAt(x + Math.sin(psi) * d, z - Math.cos(psi) * d)); return m; };
  // the shore turn: the nearest heading whose look keeps shoreM of water (the player's turn first, else the deeper side)
  function shoreTurn(x, z, psi, turn) {
    if (lookMin(x, z, psi) >= K.shoreM) return null;
    const pref = turn ? Math.sign(turn) : lookMin(x, z, psi + 0.6) >= lookMin(x, z, psi - 0.6) ? 1 : -1;
    for (let k = 1; k <= 12; k++) for (const sg of [pref, -pref]) { const h = psi + sg * k * 15 * DEG; if (lookMin(x, z, h) >= K.shoreM) return wrap(h); }
    return wrap(psi + Math.PI);
  }
  // her head: the spine's first frame (the contact test's point)
  const head = () => { const s = sim.state.spine; return { x: s[0], y: s[1], z: s[2] }; };
  const boatOf = (o) => (o ? { id: o.id, kind: o.kind, x: o.x, z: o.z, heading: o.heading ?? 0, u: o.u ?? 0, L: o.L ?? 8.5, B: o.B ?? 3 } : null);
  // a strike's boat as it is now: the lock's or the corners' read of it, else carried on along its way (it sails on out of sight)
  const refresh = (b, locked, target, dt) => {
    const now = locked && locked.id === b.id ? locked : target && target.id === b.id ? target : null;
    if (now) return boatOf(now);
    const h = b.heading ?? 0; return { ...b, x: b.x + Math.sin(h) * (b.u ?? 0) * dt, z: b.z - Math.cos(h) * (b.u ?? 0) * dt };
  };
  const sideOf = (n, b) => (b ? ((b.x - n.x) * Math.cos(n.psi) + (b.z - n.z) * Math.sin(n.psi) >= 0 ? 1 : -1) : 1);   // + the boat lies to her right
  // a bite of `kind` now: its target (the locked boat, or the corners' one near enough), its aim on that rail
  function startBite(kind, n, tgt, locked) {
    const h = head(), cp = tgt ? contactPoint(tgt, h.x, h.z, kind) : null, aim = cp ? cp.slice(0, 3) : null;
    st.bite = { kind, t: 0, target: tgt, locked: !!locked, hit: null, judged: false, contacted: false, side: sideOf(n, tgt), slapped: false };
    sim.bite(kind, { aim, side: st.bite.side, meet: tgt ? (locked ? HL.hitM : HL.touchM) + CONTACT.inM : 0 });
    st.bites++; st.bitesShown = st.bites;
    ev('bite', { x: n.x, z: n.z, nose: st.nose, kind, locked: !!locked, target: tgt?.id ?? null });
  }
  // the rising strike from below (R1) on the locked boat
  function startRise(n, tgt) {
    st.lunge = { phase: 'rise', kind: 'rising', t: 0, target: tgt, locked: true, judged: false, hit: false, fell: false, deep: true, ringT: -1, free: false };
    st.lunges++; st.noseWant = 0; sim.contact(true);   // contact: no reflex duck under the hull she rises at
    ev('lunge', { target: tgt.id });
  }
  function startBreach(n, free, from) {
    const L = st.lunge;
    st.breaches++;
    const roll = free && st.breaches % 2 === 0 ? hashSide(st.breaches) * K.freeRoll * DEG : 0;   // R2: every other free breach lands on her side
    const lean = !free && L?.target ? clamp(wrap(Math.atan2(L.target.x - n.x, -(L.target.z - n.z)) - n.psi), -K.leanDeg * DEG, K.leanDeg * DEG) : 0;   // R1: the fall leans toward the boat (at most leanDeg)
    if (L) L.lean = lean;
    if (free) st.lunge = { phase: 'breach', kind: 'free', t: 0, target: null, judged: false, hit: false, fell: false, free: true, roll };
    else Object.assign(L, { phase: 'breach', t: 0, fell: false, fromRise: true });
    sim.contact(true); sim.breach({ roll, lean });
    st.breachRest = K.breachRest; st.noseWant = 0; deepWas = false;
    ev('breach', { x: n.x, z: n.z, from });
  }
  const self = {
    K, state: st, events, skills: S,
    get on() { return st.on; },
    begin(at = null) {
      if (!sim.state.visible || !sim.state.nose) {
        const a = at ?? { x: 0, z: 0, heading: 0 };
        sim.ambush(a.x, a.z, a.heading ?? 0, K.drift);
      }
      sim.drive(true); sim.hunt(true); sim.contact(false); sim.depth(0); sim.bank?.(0);
      const n = nose();
      Object.assign(st, { on: true, speed: n?.speed ?? K.drift, setting: clamp(n?.speed ?? K.drift, K.drift, K.surface.cruise), dash: false, sprint: false, noseWant: 0, lunge: null, bite: null, rest: 0, surge: 0, breachRest: 0, shore: false, psiWant: n?.psi ?? at?.heading ?? 0, way: null, climb: 0, climbWas: 0, climbV: 0, hidden: false, limit: null, omega: 0, bank: 0, yawRate: 0, steer: 1, phase: 'swim', lockId: null, lockK: 0, assist: 0, buf: 0, strike: null });
      lungeWas = false; shiftWas = false; wasUnder = false; moveKey = null; deepWas = false; easing = false; psiWas = null; sinceDash = Infinity; S.reset();
      if (n) sim.swimTo(n.x + Math.sin(st.psiWant) * K.lookM, n.z - Math.cos(st.psiWant) * K.lookM, st.setting);
      return true;
    },
    end() {
      if (!st.on) return false;
      st.on = false; st.lunge = null; st.bite = null; st.dash = st.sprint = false;
      if (sim.state.visible) { sim.drive(false); sim.contact(false); sim.depth(0); sim.bank?.(0); sim.swimTo(null); sim.play('dive', sim.state.t + 4); }
      return true;
    },
    // the page's verdict on the last 'contact' (a bite) or 'fall' (a breach): a hit says so (and the follow-through grips); a miss says
    // "Next time…" (one shake) unless nothing was aimed at; the cooldown runs from now (2.5 s after a hit, 0.8 s after a miss)
    result(hit) {
      const B = st.bite && st.bite.contacted && !st.bite.judged ? st.bite : null;
      const L = !B && st.lunge && (st.lunge.fell || st.lunge.contacted) && !st.lunge.judged ? st.lunge : null;
      const R = B ?? L; if (!R) return;
      if (L && !L.fell && !hit) return;   // the rising strike's touch under the hull missed: her fall may still land
      R.judged = true; R.hit = !!hit;
      if (B) sim.biteHit(!!hit);
      st.rest = Math.max(st.rest, hit ? K.coolHit : K.coolMiss);
      if ((L && L.free && !hit) || (B && !B.target && !hit)) return;   // a breach for its own sake or a snap at nothing: no verdict
      ev('verdict', { hit: !!hit });   // no line (the UI audit's decision B): the knock itself says it
    },
    step(dt, hands = {}, { target = null, lock = null } = {}) {
      events.length = 0;
      if (!st.on || !(dt > 0)) return st;
      const n = nose(); if (!n) return st;
      const { move = [0, 0], camYaw = n.psi, pitch = 0, bite = false, lunge = false, sprint = false, dash: dashPress = false, drag = 0, rise = false, sink = false, lookSteers = true, diveTo = 0 } = hands;   // drag: the player's own yaw turn this step (rad)
      const look = hands.look ?? pitch;   // the player's look about the camera's neutral (+ down)
      // the speed model here: the surface's numbers blended into the water's by her nose's depth
      const M = mediumK(st.nose, K);
      st.u = M.u; st.cruise = M.cruise;
      // the lock: its blend, and the boat while it holds
      const lk = lock && lock.k > 0 ? lock : null, locked = lk && lk.id != null ? lk : null;
      st.lockId = locked?.id ?? null; st.lockK = lk?.k ?? 0;
      // locked, or striking at a boat, she means to touch it: no reflex duck under its hull (she would come up under the rail at 3 m and the
      // press would read as the strike from below); the sim's hold still keeps her skin outside
      sim.contact(!!locked || !!st.bite?.target || !!st.lunge);
      // her turn as it happened (the nose's own heading since the last step): the bank reads it
      st.yawRate = psiWas == null ? 0 : wrap(n.psi - psiWas) / dt; psiWas = n.psi;
      // the way she should swim: the hands' direction about the camera's yaw, the yaw read when the hands change (held while they are
      // held, so the camera swinging in behind her never moves it) and turned by the player's own drag
      const mx = clamp(move[0] ?? 0, -1, 1), my = clamp(move[1] ?? 0, -1, 1), moving = Math.hypot(mx, my) > 0.2;
      const key = moving ? Math.round(Math.atan2(mx, my) / (Math.PI / 8)) : null;
      if (key !== moveKey) { moveKey = key; refYaw = camYaw; } else if (drag) refYaw = wrap(refYaw + drag);
      const way = moving ? wrap(refYaw + Math.atan2(mx, my)) : null;
      st.way = way;
      st.setting = moving ? M.cruise : K.drift;
      // the strike's state now (the bite's beats, the breach family's): the steering share (never under 0.3) and the phase
      let B = st.bite, L = st.lunge;
      const beats = B ? biteBeats(B.kind, B.t, B.hit) : null;
      const strikeBusy = (beats && beats.phase !== 'recover') || (L && L.phase !== 'recover');   // nothing cancels a strike once begun
      // the dash: Shift's press (edge-triggered) or the slot's tap; held does nothing more; never inside a strike (a
      // press in the recovery cuts it short)
      const shiftEdge = !!sprint && !shiftWas; shiftWas = !!sprint;
      const before = S.state('dash').count;
      if ((shiftEdge || dashPress) && !strikeBusy) { if (S.press('dash')) { if (B && beats?.phase === 'recover') B.cut = true; if (L && L.phase === 'recover') L.cut = true; } }
      S.step(dt);
      if (S.state('dash').count > before) ev('dash', { x: n.x, z: n.z, nose: st.nose });
      const wasDash = st.dash;
      st.dash = st.sprint = S.active('dash') && !(L && L.phase !== 'recover');
      if (wasDash && !st.dash) sinceDash = 0; else if (!st.dash) sinceDash += dt;
      if (st.dash) easing = true; else if (n.speed <= M.cruise + 0.1) easing = false;
      const cut = (B && B.cut) || (L && L.cut);
      st.steer = cut ? 1 : Math.min(beats ? beats.steer : 1, lungeSteer(L, K));
      st.phase = L ? L.phase : beats ? beats.phase : 'swim';
      st.want = st.dash ? M.dash : st.setting;
      // the rail bite's lunge: + lungeV for lungeS from the strike
      if (B && B.kind === 'rail') { const t1 = BITE2.rail.windup; B.v0 ??= Math.max(n.speed, st.setting); if (B.t >= t1 && B.t < t1 + K.lungeS) st.want = Math.max(st.want, B.v0 + K.lungeV); }
      if (B && B.hit && beats?.phase === 'follow' && B.target) st.want = Math.min(st.want, Math.max(K.drift, B.target.u ?? 0) + 1);   // her jaw on its rail: she hangs on (her pace down to the boat's, at the strike's own brake)
      // up and down: the climb rate asked for (keys win; the look while she swims), eased over the last metres before
      // her deepest here and the surface (the catch); a dash climbing from depth skips the catch and breaches (below); scaled by the steering
      const waterHere = depthAt(n.x, n.z);
      st.lim = noseLimit(waterHere, 'deep', K);
      const raw = climbRate({ look, swimming: moving || st.dash, run: st.dash, rise: !!rise, sink: !!sink, lookSteers, nose: st.nose, diveTo }, K);
      const runUp = st.dash && raw <= -K.breachClimb;
      if (st.nose > K.breachAtM + 0.05) deepWas = true; else if (raw >= 0) deepWas = false;
      const ch = Math.max(0, K.swimY - (sim.dy ?? 0));   // her depth channel (the sim's own: the nose's tip bobs with her neck at the surface, so the control reads this)
      let v = L ? 0 : runUp && deepWas ? raw : easeRate(raw, ch, st.lim, K.swimY, K) * st.steer;
      if (v > 0 && st.nose >= st.lim) v = 0;
      st.climbV += (v - st.climbV) * (1 - Math.exp(-dt / K.climbS));   // a quick ease in and out (about 0.2 s), never a long ramp
      if (Math.abs(st.climbV) < 0.02 && v === 0) st.climbV = 0;
      v = v > 0 && st.nose >= st.lim ? 0 : st.climbV;
      st.climb = v;
      st.hidden = st.nose > K.hiddenM;
      st.limit = L ? null : raw > 0 && Math.max(st.nose, ch) >= st.lim - 0.1 ? 'floor' : raw < 0 && ch <= K.swimY + 0.1 ? 'surface' : null;   // at the limit itself (earlier, the camera's level would stop a climb by look short of it)
      // the free breach (R2): at the surface the dash looking up, or the dash with E; from depth a dash climb passing 1.5 m
      st.breachRest = Math.max(0, st.breachRest - dt);
      const atTop = st.nose < K.surfacedM + 0.5;
      const breachNow = (atTop && st.dash && (look / DEG < -K.breachDeg || (!!rise && !sink))) || (runUp && deepWas && st.nose <= K.breachAtM);
      if (breachNow && !L && !(beats && beats.phase !== 'recover') && st.breachRest <= 0) { if (B) st.bite = B = null; startBreach(n, true, st.nose); L = st.lunge; }
      // the heading she wants: the hands' turn at her rate × the steering share, the rate itself ramped, never wound
      // past her nose by more than 25°
      const rate = turnRate(M, n.speed, K) * st.steer, slew = M.slew * DEG;
      st.omega = rampTurn(st.omega, way != null ? wrap(way - st.psiWant) : 0, way != null ? rate : 0, slew, dt, K);
      st.psiWant = wrap(st.psiWant + st.omega * dt);
      // the lock's assist (§ 6.4): toward the intercept with weight 0.45 / 0.55 × its blend, at most 20°/s on top of her own turn; only on a
      // way she swims (or through a strike): nothing moves her toward a boat she has not chosen to swim at
      st.assist = 0;
      if (lk && (way != null || B || L)) {
        const bear = Math.atan2(lk.ix - n.x, -(lk.iz - n.z)), wgt = HL.assist[0] + (HL.assist[1] - HL.assist[0]) * M.u;
        st.assist = clamp(lk.k * wgt * wrap(bear - st.psiWant) * 4, -HL.assistMax * DEG, HL.assistMax * DEG);
        st.psiWant = wrap(st.psiWant + st.assist * dt);
      }
      const off = wrap(st.psiWant - n.psi); if (Math.abs(off) > 25 * DEG) { st.psiWant = wrap(n.psi + Math.sign(off) * 25 * DEG); if (Math.sign(st.omega) === Math.sign(off)) st.omega = clamp(st.omega, -rate, rate); }
      if (way == null && !lk) st.psiWant = wrap(n.psi + wrap(st.psiWant - n.psi) * Math.max(0, 1 - dt * 0.5));   // let go: she settles on the way she faces
      // the bite (Space or a left click): a press is held bufS; it fires when nothing is striking and the cooldown is over
      const biteNow = !!(bite || lunge), pressEdge = biteNow && !lungeWas; lungeWas = biteNow;
      if (pressEdge) st.buf = K.bufS;
      st.rest = Math.max(0, st.rest - dt);
      if (st.buf > 0 && !strikeBusy && !(L && L.phase !== 'recover') && st.rest <= 0) {
        const dashing = st.dash || sinceDash <= K.dashBiteS;
        const nearTg = target && target.d <= K.reachM ? target : null;
        const waitLock = !locked && !dashing && target && target.d <= K.holdLockM && st.buf - dt > 1e-6;   // a boat about to be locked: wait for it
        if (locked && !dashing && locked.under && st.nose > K.strikeFrom) { st.bite = B = null; startRise(n, boatOf(locked)); L = st.lunge; st.buf = 0; }
        else if (!waitLock) {
          const tgt = locked ? boatOf(locked) : nearTg && !(st.nose > K.strikeFrom) ? boatOf(nearTg) : dashing && target && target.d <= K.reachM ? boatOf(target) : null;
          startBite(dashing ? 'dash' : tgt ? 'rail' : 'snap', n, tgt, !!locked); B = st.bite; st.buf = 0;
        }
      }
      st.buf = Math.max(0, st.buf - dt);
      let goX = n.x + Math.sin(st.psiWant) * K.lookM, goZ = n.z - Math.cos(st.psiWant) * K.lookM, goV = st.want;
      // the bite's clock, its aim (the boat sails on), its contact test, its end
      if (B) {
        // the coil held ('s buffer, carried through the wind-up: a rail bite pressed before the rail is in reach holds the
        // wind-up's S, steering fully, until her nose will be within reachHitM of the hull when the strike lands, at most holdMaxS; then the
        // strike): a press anywhere inside the lock lands; pressed in reach, the contact is 0.52 s after the press as designed
        const t1 = BITE2[B.kind].windup, nh = B.target ? hullDist(n.x, n.z, B.target) : 0, closing = B.nhWas == null ? 0 : Math.max(0, (B.nhWas - nh) / dt);
        B.nhWas = nh;
        const inReach = nh - closing * BITE2.rail.strike <= K.reachHitM;
        if (B.kind === 'rail' && B.target && !B.released && B.t + dt > t1 && !inReach && (B.held ?? 0) < K.holdMaxS) { const w = B.t + dt - (t1 - 1e-6); B.held = (B.held ?? 0) + w; sim.biteHold(w); B.t = t1 - 1e-6; }
        else { if (B.t >= t1) B.released = true; B.t += dt; }
        if (B.target) {
          B.target = refresh(B.target, locked, target, dt);
          const h = head(), a = contactPoint(B.target, h.x, h.z, B.kind, CONTACT, B.where ?? null);
          sim.biteAim(a[0], a[1], a[2]); B.where = a[3]; B.aim = a;
        }
        const bb = biteBeats(B.kind, B.t, B.hit);
        if (!B.contacted && B.t >= bb.contactAt) {
          B.contacted = true;
          const h = head();
          ev('contact', { x: h.x, y: h.y, z: h.z, psi: n.psi, kind: B.kind, locked: B.locked, targetId: B.target?.id ?? null, knock: BITE2[B.kind].knock, where: B.where ?? null, at: B.aim ? B.aim.slice(0, 3) : null });
        }
        if (B.contacted && !B.judged && bb.phase === 'recover') self.result(false);   // never judged by the page: a miss
        if (bb.phase === 'recover' && B.hit === false && !B.slapped && B.target) { B.slapped = true; sim.emit('slap', 'tail', 0.8); }   // the sulk is now a tail slap in the recovery
        if (B.t >= biteDur(B.kind)) st.bite = B = null;
      }
      // the breach family: the rise onto a spot off the boat's beam, the breach, the recovery
      if (L) {
        L.t += dt;
        if (L.target && (L.phase === 'rise' || L.phase === 'breach')) L.target = refresh(L.target, locked, target, dt);   // the boat as it is now (the lock, else the corners, else carried on its way)
        // the strike spot: where the boat will be at her fall, just off its beam; the side ahead of her, chosen once (never a turn-about onto
        // a spot behind her: a boat coming at her, she slows and lets it come). Her pace: onto the spot by the fall (never braked harder than
        // strikeStop); once the spot is under her, the boat's own way (she rises where it will be)
        let sx = null, sz = null;
        const tLeft = L.phase === 'rise' ? Math.max(0, K.warn.s - L.t, (st.nose - K.breachAtM) / K.strikeRise) + FALL_S : L.phase === 'breach' ? Math.max(0, FALL_S - L.t) : 0;
        if (L.target) {
          const tg = L.target, rx = Math.cos(tg.heading ?? 0), rz = Math.sin(tg.heading ?? 0), u = tg.u ?? 0;
          const at = (sd) => [tg.x + rx * sd * K.strikeOffM + Math.sin(tg.heading ?? 0) * u * tLeft, tg.z + rz * sd * K.strikeOffM - Math.cos(tg.heading ?? 0) * u * tLeft];
          const aheadOf = (p) => (p[0] - n.x) * Math.sin(n.psi) - (p[1] - n.z) * Math.cos(n.psi);
          L.side ??= aheadOf(at(1)) >= aheadOf(at(-1)) ? 1 : -1;
          [sx, sz] = at(L.side);
        }
        // her heading: the spot, with the player's way still felt at the steering share (never ignored)
        const toward = (x, z) => { const b = Math.atan2(x - n.x, -(z - n.z)); const h = way != null ? wrap(b + st.steer * 0.5 * wrap(way - b)) : b; goX = n.x + Math.sin(h) * K.lookM; goZ = n.z - Math.cos(h) * K.lookM; };
        const pace = () => {
          const dx = sx - n.x, dz = sz - n.z, ahead = dx * Math.sin(n.psi) - dz * Math.cos(n.psi);
          if (ahead < 2.5) { toward(L.target.x, L.target.z); goV = Math.max(2, L.target.u ?? 0); }   // the spot under her (or behind): hold here at the boat's way, facing it
          else { toward(sx, sz); goV = clamp(Math.hypot(dx, dz) / Math.max(0.4, tLeft), 2, K.top); }
        };
        if (L.phase === 'rise') {
          // the strike from below's fair warning (2c; owner, 2026-11-20): for its first WARN.s the surface over her rings and the boats near
          // them see her coming (living/tessiePlayer.js threat()); the breach waits for it
          if (L.t < K.warn.s && L.t - L.ringT >= K.warn.every) { L.ringT = L.t; sim.ring?.(n.x, n.z, K.warn.amp); ev('warn', { x: n.x, z: n.z, left: K.warn.s - L.t }); }
          if (sx != null) pace();
          if ((L.t >= K.warn.s && st.nose < K.breachAtM + 0.1) || L.t >= K.runMax + K.warn.s) { startBreach(n, false, st.nose); }
        } else if (L.phase === 'breach') {
          if (sx != null && !L.fell) pace();
          else goV = Math.max(2, st.setting, st.dash ? M.dash : 0);
          // the rising strike's contact: her head and back meet the hull's bottom as she comes up under it (the page lifts and rolls it)
          if (!L.free && !L.contacted && L.t >= K.riseHitS && L.target) { L.contacted = true; const h = head(); ev('contact', { x: h.x, y: 0, z: h.z, psi: n.psi, kind: 'rising', locked: !!L.locked, targetId: L.target.id, knock: 1, where: 'bottom', at: [h.x, -0.4, h.z] }); }
          if (!L.fell && L.t >= FALL_S) {
            L.fell = true;
            // her front 9 m falls along her heading turned by the lean (about the breach's base 9 m back): the footprint's middle 6.3 m from it
            const fp = n.psi + (L.lean ?? 0), bx = n.x - Math.sin(n.psi) * 9, bz = n.z + Math.cos(n.psi) * 9, fx = bx + Math.sin(fp) * 6.3, fz = bz - Math.cos(fp) * 6.3;
            ev('fall', { x: fx, z: fz, psi: fp, nx: n.x, nz: n.z, locked: !!L.locked, targetId: L.target?.id ?? null });
          }
          if (L.t >= BREACH_S) { sim.contact(false); if (!L.judged) self.result(false); L.phase = 'recover'; L.t = 0; }
        } else if (L.phase === 'recover' && (L.t >= K.recoverS || L.cut)) { st.lunge = L = null; st.noseWant = 0; }
      }
      // the shore: her nose turns away from 3 m of water (never beaches)
      {
        const want = Math.atan2(goX - n.x, -(goZ - n.z));
        const h = shoreTurn(n.x, n.z, want, way != null ? wrap(way - n.psi) : 0);   // toward the way she is asked, when it helps
        st.shore = h != null;
        if (h != null) { goX = n.x + Math.sin(h) * K.lookM; goZ = n.z - Math.cos(h) * K.lookM; goV = Math.min(goV, M.cruise * 0.6); st.psiWant = h; }
      }
      // her pace: up at the medium's rate (the dash's own ramp above her cruise), down at its stop rate (after the burst at dashEase); never
      // braked harder than strikeStop through a strike (the 24 m/s² brake is gone)
      goV = Math.min(goV, K.top);
      let acc = goV > n.speed + 0.05 ? (goV > M.cruise + 0.1 ? M.dashAcc : M.acc) : goV < n.speed - 0.05 ? (easing && n.speed > M.cruise + 0.1 ? K.dashEase : M.stopAcc) : M.acc;
      if ((B || L) && goV < n.speed) acc = Math.min(acc, K.strikeStop);
      sim.swimTo(goX, goZ, goV, acc, M.turnMax);
      // the bank into her turn: her pace and her turn as it happened, at most the medium's (25° on the dash), eased
      const bankWant = L && L.phase !== 'recover' ? 0 : bankFor(n.speed, st.yawRate, st.dash ? Math.min(M.bank, 25) : M.bank, K);
      st.bank += (bankWant - st.bank) * (1 - Math.exp(-dt / K.bankTau));
      sim.bank?.(st.bank);
      // her depth: a rising strike up fast from depth (paced to the warning's end); a breach at the surface; else the climb rate: the target
      // leads her nose by the sim's own ease (TESSIE dyTau) at the rate, so she moves at it and stops where the rate ends (a 0.2 s glide)
      const water = depthAt(n.x, n.z);
      if (L && L.phase !== 'recover') {
        sim.depth(0, L.phase === 'rise' ? clamp((st.nose - K.breachAtM) / Math.max(0.25, K.warn.s - L.t), 1.5, K.strikeRise) : null);
        st.noseWant = 0;
      } else {
        const limHere = noseLimit(water, 'deep', K);
        if (v !== 0) st.noseWant = clamp(Math.max(ch, K.swimY) + v * K.lead, 0, Math.max(0, limHere));   // the target leads her depth channel
        else if (st.climbWas) st.noseWant = clamp(Math.max(ch, K.swimY) + st.climbWas * 0.2, 0, Math.max(0, limHere));
        st.noseWant = Math.min(st.noseWant, Math.max(0, limHere));
        sim.depth(st.noseWant > K.swimY ? -(st.noseWant - K.swimY) : 0, Math.max(K.rate, Math.abs(v)));
      }
      st.climbWas = v;
      // her neck and gait: up in its arc at the surface (lower on the dash), straight forward and low under the water (its
      // depth reads her head: an arc down there would read as a climb), level on the dash; her head leads her turn (0.6 × the heading still to turn, at most 25°), or turns to
      // the locked boat; the tail lifts as she dives
      const neckK = L && L.phase !== 'recover' ? 0 : st.noseWant < 0.9 && ch < K.swimY + 0.25 ? (st.dash ? 0.35 : 1) : 0;   // up once her body is at the surface (after the catch)
      sim.neck?.(neckK);
      let lead = clamp(0.6 * wrap(st.psiWant - n.psi), -25 * DEG, 25 * DEG);
      if (lk) lead += (clamp(wrap(Math.atan2(lk.x - n.x, -(lk.z - n.z)) - n.psi), -35 * DEG, 35 * DEG) - lead) * lk.k;
      sim.gait?.({ dash: st.dash, dive: clamp((v - 1.2) / 2, 0, 1), look: lead });
      // what she is now: the nose's depth (the spine's first frame), her word, her breath on each surfacing
      const ny = sim.state.spine[1];
      st.nose = Math.max(0, -ny);
      st.word = depthWord(st.nose);
      st.speed = n.speed;
      // the camera's read of the strike (ui/tessieCam.js: one spring, a strike weight shaping its goal): on, the boat, the rise
      const sb = B?.target ?? L?.target ?? null;
      st.strike = (B && biteBeats(B.kind, B.t, B.hit).phase !== 'recover') || (L && L.phase !== 'recover') ? { phase: st.phase, x: sb?.x ?? null, z: sb?.z ?? null, rise: !!(L && L.phase === 'rise'), breach: !!(L && L.phase === 'breach') } : null;
      if (st.nose > 1.5) wasUnder = true;
      else if (wasUnder && st.nose < K.surfacedM) { wasUnder = false; sim.emit('breath', 'nose', 1); ev('surfaced', { x: n.x, z: n.z }); }
      return st;
    },
  };
  return self;
}
// which way the free breach rolls (seeded by the breach count, no Math.random)
const hashSide = (k) => ((Math.imul(k + 7, 0x9e3779b1) >>> 0) & 1 ? 1 : -1);
