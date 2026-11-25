// The boat physics (S1): a ≈30 ft cruising sloop (main + jib, fin keel, spade rudder) at 60 Hz. Plain JS.
// The contract with the assembly, camera and controls is src/boat/contract.js: new BoatPhysics({ x, z, heading }),
// step(dt, controls, env), state (STATE). The model is's spec v1, tuned to the Farr First 36.7 VPP polar
// scaled by 0.90 (√ of the waterline ratio) to a 30 ft hull; tests/boat.test.mjs holds its thirteen tests.
//
// Frames. World: x east, z south, metres, seconds (src/wind.js). heading: radians clockwise from north (−z).
// Body: x forward, y starboard; yawRate > 0 turns to starboard; heel > 0 puts the starboard rail down.
// Sail angles: + to starboard (the side the boom sits on). Wind angles: rad from the bow, + = wind from starboard.
//
// Per tick (semi-implicit Euler):
//   1. water-relative velocity = ground velocity − current
//   2. apparent wind per sail: the true wind at the sail's height (the wind over the water × (h / 10 m)^0.14) − the boat's motion at the sail
//      (surge, sway, yaw and roll rates), its cross component × cos(heel) (the heeled sail sees the projection)
//   3. each sail sits where the wind puts it inside the sheet's range (the main free about the centreline, the jib
//      about its lead on the leeward or the backed side) and swings there at a finite rate (tacks, gybes)
//   4. a sail on its leeward side: attached flow to the stall (CL = CLmax·sin(½π·α/15°)), then a flat plate;
//      luffing below ≈3° (no lift, flogging drag). A sail pressed on its windward side (backed): a flat plate only,
//      so it can't drive forward of the beam. Slot: the main's CL ×1.1 when the jib draws, the jib's drag −10 %.
//   5. keel and rudder as foils (CL = 2πα / (1 + 2 / AR) to the stall; reversed and weaker astern: foilCoefRev), the
//      rudder in the keel's downwash while the keel's flow is attached
//   6. hull: friction (ITTC 1957) + waves (rising from Fn 0.30, a wall past 0.45) + a small linear term, × heel
//   7. heel: the sails' heeling moment against Δ·GM·sin φ·(1 − φ / 120°), 0.4 critical damping
//   8. yaw: foils and sails about the centre, plus weather helm that grows with heel (the drive's lever to leeward
//      and the heeled hull), so a gust rounds the boat up
//   9. the engine (src/boat/engine.js, feat/engine-anchor): the prop's thrust at the prop, its walk (a sideways kick
//      at the stern, to port astern) and its slipstream over the rudder (steerage at low speed under power); the
//      crew's furl (controls.furl 0..1: the sails down at anchor or on a mooring) takes the sails' area away and
//      adds the furled cloth's windage; env.ext(state, dt) adds outside forces (the anchor rode, a mooring pennant,
//      the dock's lines and its fenders: src/boat/tackle.js), env.post(state, dt) may correct the pose after the step
//      (the dock: never through a pier)
// Auto-trim (the beginner's default): each sheet sets its sail to the angle of attack with the most drive for the
// apparent wind (a table), smoothed over 0.5 s; past ≈16° of heel the sails flatten, and a heavy helm (> 14° of
// rudder) or a hard heel (> 24°) eases the main, both trimmed to the heel 0.6 s ahead (heel + roll rate), so they damp
// the roll instead of pumping it. Then the reef (autoReef, on by default): one step when the heel stays past 21° with
// the sails flat (the second past 24°) or passes 28°, a second 12 s later if needed, each going in over 4 s; out again
// one step at a time once the heel one step lighter would stay under 15° for 90 s. A boat that starts in 20 kt or more
// starts reefed (26 kt: twice). The heavy-air numbers are BOAT's (the thrill build, 2026-10-29).

import { vesselDims } from './boat/dims.js';
import { CURRENT_VESSEL } from './vessels/current.js';
import { surfCue, railCue, RoundUp, slamLevel } from './boat/thrill.js';
import { grooveScore, GrooveLock } from './boat/groove.js';
import { Engine, propForces } from './boat/engine.js';
import { peekDiag } from './diagRegistry.js';
import { GENNAKER, createGennaker, stepGennaker, gkCoef, gkStall, gkChord } from './sail/gennaker.js';

const DEG = Math.PI / 180;
const RHO_AIR = 1.225, RHO_W = 1025, G = 9.81, NU_W = 1.19e-6;
export const KN = 0.514444;            // m/s per knot
export const DT = 1 / 60;

// The boat: a Catalina 28 Mk II (src/boat/dims.js). Sourced: LWL, displacement, the sail areas. Heights (z, m above
// the water) follow the rig: the main's centre of effort a third up its luff from the gooseneck, the jib's a third up
// from the tack. Fore-aft positions (x, m forward of the centre of the waterline) are effective values, tuned for a
// mild weather helm close-hauled. Everything else is tuned to the polar (tests/boat.test.mjs). The numbers are the boat
// profile's (src/vessels/<id>.json: its dims and its physics block); boatParams(vessel) builds them, BOAT is this page's.
// The jib's sheeting range. Its clew can't go past the genoa track's car on the side deck (≈0.1 m inside the rail at
// the clew's station, ≈ RIG.jibLP aft of the tack): atan(1.475 / 3.27) = 24.3°. The car's tightest setting is ≈13°.
// The physics adds the same allowance as the main for the upper sail's twist (JIB_TWIST): the sail's mean chord sits
// ≈8° further out than the clew, so the sheet's effective range is 21–32°. state.jibAngle reports the clew.
const jibClewMaxDeg = ({ HULL, RIG }) => Math.atan((HULL.beam / 2 - 0.1) / RIG.jibLP) / DEG;   // 24.3
const JIB_CAR_MIN_DEG = 13, JIB_TWIST_DEG = 8;
// The player's own jib sheet (the JIB winch, R / F; owner 2026-10-30: "does the jib work physically?"): the crew sheets the
// jib between its lead and the rail; a hand on the sheet can go past both, as aboard: hauled in hard past the lead (the
// clew pulled down and in, the leech closed: OVER-TRIMMED, the jib stalls, heels and slows the boat) and eased past the
// rail (the clew lifts and the sail twists off: it LUFFS). The crew's own trim never leaves [lead, rail], so with no
// hand on it (jibTrim 0) nothing changes.
export const JIB_HAND = { overDeg: 18, pastRailDeg: 16 };
export const jibHandRange = (P = BOAT) => [P.jib.lead - JIB_HAND.overDeg * DEG, (P.jib.maxDeg + JIB_HAND.pastRailDeg) * DEG];
// The main the same way: the boom sheets in to ≈4° (the traveller centred), the sail's mean chord ≈8° further out
// (its twist), so the force model's range starts at 12°. state.boomAngle reports the boom (4–72°).
export const MAIN_BOOM_MIN_DEG = 4, MAIN_TWIST_DEG = 8;
// the physics' numbers for a boat profile (memoised on it): its dims, its physics block (angles in degrees there)
const paramsMemo = new WeakMap();
export function boatParams(vessel = CURRENT_VESSEL) {
  let P = paramsMemo.get(vessel);
  if (!P) paramsMemo.set(vessel, (P = buildParams(vessel)));
  return P;
}
function buildParams(vessel) {
  const D = vesselDims(vessel), { HULL, RIG, SAIL_AREA } = D, X = vessel.physics;
  const MAST_X = -HULL.mastStepZ, JIB_CLEW_MAX_DEG = jibClewMaxDeg(D);
  const MAIN_Z = HULL.mastStepY + RIG.gooseneck + RIG.mainLuff / 3;            // 5.65
  const JIB_Z = HULL.mastStepY + RIG.tack[1] + (RIG.head[1] - RIG.tack[1]) / 3; // 4.87
  return {
    loa: HULL.loa, lwl: HULL.lwl, mass: HULL.displacementKg,
    // sails: area m², effective aspect ratio, CE height and x, CLmax (spec 1.4 / 1.6, raised to the polar's light-air
    // speed), the sheets' tightest angle (the upper sail's twist makes it wider than the boom or the clew alone)
    main: { area: SAIL_AREA.main, ar: X.main.ar, z: MAIN_Z, x: MAST_X - X.main.xAftOfMast, clMax: X.main.clMax, lead: X.main.lead, minDeg: MAIN_BOOM_MIN_DEG + MAIN_TWIST_DEG, maxDeg: X.main.maxDeg, swingDeg: X.main.swingDeg, tau: X.main.tau },
    jib: { area: SAIL_AREA.jib, ar: X.jib.ar, z: JIB_Z, x: X.jib.x, clMax: X.jib.clMax, lead: (JIB_CAR_MIN_DEG + JIB_TWIST_DEG) * DEG, maxDeg: JIB_CLEW_MAX_DEG + JIB_TWIST_DEG, swingDeg: X.jib.swingDeg, tau: X.jib.tau },
    keel: { area: X.keel.area, ar: X.keel.ar, x: X.keel.x, z: X.keel.z, stall: X.keel.stallDeg * DEG },        // ar: the hull as an end plate
    // vent: the heel where the rudder starts to lose its grip to ventilation, and where the 70 % loss is whole [est; was
    // 25–55°, 2026-10-29 thrill: a C28 rounds up past ≈ 30°]
    rudder: { area: X.rudder.area, ar: X.rudder.ar, x: -HULL.rudderZ, z: X.rudder.z, stall: X.rudder.stallDeg * DEG, maxDeg: X.rudder.maxDeg, rateDeg: X.rudder.rateDeg, downwash: X.rudder.downwash, vent: [X.rudder.ventDeg[0] * DEG, X.rudder.ventDeg[1] * DEG] },
    // hull: friction (wetted m², form factor; lin N per m/s); wave resistance / displacement = waveC·(Fn / 0.3)^waveN;
    // × (1 + heelRes·heel°²); latArea: the canoe body's sideways drag; windCdA, windZ: hull and rig windage; yawHeel:
    // N·m per (m/s)² per unit sin(heel), the heeled hull's weather helm
    hull: { ...X.hull },
    gm: X.gm, vanish: X.vanishDeg * DEG, rollDamp: X.rollDamp,
    surfRelief: X.surfRelief,                         // the share of the wave-making resistance a boat on a face sheds (hullResistance relief)
    surfFK: X.surfFK,                                 // the waves' surge: 1 = the long-wave Froude–Krylov force, −Δ·g·slope (6b)
    m11: X.m11, m22: X.m22, izz: X.izz, ixx: X.ixx,   // added mass in surge and sway; kg·m²
    yawDampLin: X.yawDampLin, yawDampQuad: X.yawDampQuad,
    reefArea: X.reefArea, reefZ: X.reefZ,
    // auto-reef (autoTrim): a reef goes in when the heel stays past reefIn (the second: reefIn2; averaged over 6 s) with
    // the sails already flat, or at once past reefNow; it comes out when the heel one step lighter would stay under reefOut for reefCalm seconds (a lull between gusts is not enough).
    // A reef takes reefS seconds to go in or out (the area and the centre of effort move with it); reefHold between steps.
    // The heavy-air crew (thrill, owner 2026-10-29: "heel, surge, spray, risk"): a keen crew lets a C28 heel into the
    // low 20s and lays the rail near the water (≈ 25–28°) in a level-4 gust before they ease; the first reef past 21°
    // held (6 s), the second only past 24° held or 28° at once. Was 18° / 21° at once / out under 13°, start reefed from
    // 15 / 20 kn, flatten from 14°, ease from 20°: level 4 never passed 22.6° (renders/thrill/heavy-*.log).
    reefIn: X.reefInDeg * DEG, reefIn2: X.reefIn2Deg * DEG, reefNow: X.reefNowDeg * DEG, reefOut: X.reefOutDeg * DEG, reefS: X.reefS, reefHold: X.reefHold, reefCalm: X.reefCalm,
    reefStartKt: X.reefStartKt,                       // a boat starting in this much true wind (10 m) starts with 1 or 2 reefs
    // the crew's depowering (autoTrim), by the heel 0.6 s ahead: flatten from crewFlat[0] (full at [1]); ease the main
    // up to 30° from crewEase[0] (full at [1])
    crewFlat: [X.crewFlatDeg[0] * DEG, X.crewFlatDeg[1] * DEG], crewEase: [X.crewEaseDeg[0] * DEG, X.crewEaseDeg[1] * DEG],
    // the furled sails (controls.furl): the crew takes them down or sets them in furlS seconds; the bundle on the boom,
    // the rolled jib and the boat's sheer at anchor or on a mooring add furlCdA m² to the hull and rig's windCdA (5.5 m²
    // in all, bow-on: ≈ a 28 ft sloop's bare-pole windage with its sheering, the anchor-load tables' range) [est]
    furlS: X.furlS, furlCdA: X.furlCdA,
  };
}
// this page's boat (src/vessels/current.js): its physics numbers and the jib's clew limit
export const BOAT = boatParams(CURRENT_VESSEL);
export const JIB_CLEW_MAX_DEG = jibClewMaxDeg(vesselDims(CURRENT_VESSEL));   // 24.3

import { clampT as clamp } from './core/math.js';
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
import { smooth } from './core/math.js';
const sgn = (x) => (x < 0 ? -1 : 1);

const SAIL_STALL = 15 * DEG, SAIL_E = 0.8, LUFF0 = 1 * DEG, LUFF1 = 4 * DEG, FLOG_CD = 0.2;
const BY_THE_LEE = 10 * DEG;
// The closest apparent wind the sails draw at (degrees off the bow, against the boat's heading): the tighter-sheeted sail's chord at
// its lead (the jib's car, its twist allowed) plus the angle of attack where it fills (LUFF1), plus the leeway she makes (the flow
// meets the sails that much wider than the heading's AWA). 25° + leeway (≈ 1–3°): the wind dial's no-go wedge as a module.
export const luffAwaDeg = (P = BOAT, leeway = 0) => (Math.max(P.jib.lead, P.main.minDeg * DEG) + LUFF1) / DEG + Math.abs(leeway) / DEG;

// a sail on its leeward side at angle of attack a ≥ 0: [CL ≥ 0, CD]
function sailCoef(a, clMax, ar) {
  const cl = clMax * Math.sin(Math.min(a, SAIL_STALL) / SAIL_STALL * Math.PI / 2);
  const cd = 0.03 + cl * cl / (Math.PI * SAIL_E * ar);
  if (a <= SAIL_STALL) {
    const fill = smooth(LUFF0, LUFF1, a);
    return [cl * fill, cd * fill + FLOG_CD * (1 - fill)];
  }
  const w = smooth(SAIL_STALL, SAIL_STALL + 20 * DEG, a);
  const s = Math.sin(a);
  return [cl + (Math.sin(2 * a) - cl) * w, cd + (0.03 + 1.3 * s * s - cd) * w];
}

// a foil (keel, rudder) at signed angle of attack a in (−π, π]: [CL (odd), CD]
// Flow from astern (|a| > 90°: sternway) meets the section trailing edge first: the lift-curve slope × REV.slope, the
// stall REV.stallDeg earlier, then the same flat plate (Molland & Turnock, "Marine Rudders and Control Surfaces", 2007,
// p. 99, via Liu & Hekkenberg, "Sixty years of research on ship rudders", Ships and Offshore Structures 2017: astern the
// slope is 75–85 % of ahead, the stall 5–10° earlier, CLmax 45–75 %). Here 0.8 and 6°: the rudder's (16°) gives CLmax
// 0.55 against 1.10 ahead (50 %), the keel's (13°) 0.36 against 0.82 (44 %). δ = a − π is the angle from the reversed
// chord; its CL has a's sign convention (the force against the foil's sideways motion), as the flat plate's 0.9·sin 2a.
// Its profile drag at zero lift is twice ahead's (NACA TN 3361, Critzos, Heyson & Boswinkle 1955: the NACA 0012 at 180°
// has about twice the drag it has at 0°).
const REV = { slope: 0.8, stallDeg: 6, cd0: 0.016 };
function foilCoef(a, ar, stall) {
  if (Math.abs(a) > Math.PI / 2) return foilCoefRev(a, ar, stall);
  return foilCoefAhead(a, ar, stall);
}
function foilCoefRev(a, ar, stall) {
  const d = wrap(a - Math.PI), st = Math.max(stall - REV.stallDeg * DEG, 2 * DEG);
  const slope = REV.slope * 2 * Math.PI / (1 + 2 / ar);
  const lin = slope * clamp(d, -st, st);
  const cdl = REV.cd0 + lin * lin / (Math.PI * 0.9 * ar);
  const m = Math.abs(d);
  if (m <= st) return [lin, cdl];
  const w = smooth(st, st + 15 * DEG, m), s = Math.sin(a);
  return [lin + (0.9 * Math.sin(2 * a) - lin) * w, cdl + (0.02 + 1.2 * s * s - cdl) * w];
}
function foilCoefAhead(a, ar, stall) {
  const slope = 2 * Math.PI / (1 + 2 / ar);
  const lin = slope * clamp(a, -stall, stall);
  const cdl = 0.008 + lin * lin / (Math.PI * 0.9 * ar);
  const m = Math.abs(a);
  if (m <= stall) return [lin, cdl];
  const w = smooth(stall, stall + 15 * DEG, m), s = Math.sin(a);
  return [lin + (0.9 * Math.sin(2 * a) - lin) * w, cdl + (0.02 + 1.2 * s * s - cdl) * w];
}

const ASTERN_FN = 1.4;
// The windage's centre of effort along the hull (m forward of the centre) for the air's flow (wf: its forward component in
// the body frame, va its speed). Abeam it sits windX forward (the mast 0.74 m forward, the rolled jib on the forestay,
// the high bow: a sloop's bare-pole windage centre lies forward of the keel's pivot, so the bow blows off); it moves
// toward the end the wind comes from by windSpan × LOA × cos(the wind's angle off the bow), as a body's centre of
// pressure moves toward its windward end (Isherwood, "Wind resistance of merchant ships", RINA 1972: the yaw moment
// turns a hull toward beam-on from either end). So a stopped boat falls off toward beam-on, the wind a little abaft
// the beam where windX + windSpan·LOA·cos β = 0 (≈ 106° here), as a boat left to herself lies [est: windX 0.6 m,
// windSpan 0.25] (fix/sim-astern-rudder, 2026-11-14).
function windX(P, wf, va) {
  if (va < 1e-6) return 0;
  return (P.hull.windX ?? 0) + (P.hull.windSpan ?? 0) * P.loa * (-wf / va);
}

// ITTC 1957 friction + a wave term in the Froude number + a low-speed linear term; N, against the motion
function hullResistance(u, heel, P, relief = 0) {
  const au = Math.abs(u);
  if (au < 1e-9) return 0;
  const re = Math.max(au * P.lwl / NU_W, 1e5);
  const cf = 0.075 / (Math.log10(re) - 2) ** 2;
  const rf = 0.5 * RHO_W * P.hull.wetted * cf * (1 + P.hull.form) * au * au;
  // astern the hull meets the water with its broad, flat run and transom instead of its fine entrance: its wave-making
  // comes in as on a shorter, blunter hull, the wave term at ASTERN_FN × the Froude number [est; no published astern
  // resistance found for a cruising sloop]. It puts full astern at ≈ 4.2 kn, 0.7 of full ahead's 6.0 (fix/sim-astern-rudder;
  // tests/engine.test.mjs). The bound: a fixed prop's astern bollard pull is 0.6–0.66 of ahead's (Yachting Monthly's prop
  // test, May 2009: 173 against 264 kg for the standard fixed three-blade), so with the same hull resistance both ways a
  // u² law gives at most √0.6 ≈ 0.77 of ahead's speed (4.6 kn); without this term the near-flat astern thrust law ran
  // her to 5.3 kn, past that bound.
  const fn = au / Math.sqrt(G * P.lwl) * (u < 0 ? ASTERN_FN : 1);
  // relief 0..1: the hull sliding down a wave's face (6b) is carried by the slope: its own wave-making wall rises less steeply
  // (the semi-displacement hull of a boat that surfs past hull speed), friction and the linear term are unchanged
  const rw = P.mass * G * (P.hull.waveC * (fn / 0.3) ** P.hull.waveN + (fn > 0.45 ? 4 * (fn - 0.45) ** 2 : 0)) * (1 - P.surfRelief * relief);
  const hd = heel / DEG;
  return sgn(u) * (rf + rw + P.hull.lin * au) * (1 + P.hull.heelRes * hd * hd);
}

// the auto-trim table: for each apparent wind angle (1° steps, 0–180°), the angle of attack with the most drive
function trimTable(clMax, ar) {
  const t = new Float32Array(181);
  for (let d = 0; d <= 180; d++) {
    const A = d * DEG;
    let best = -Infinity, at = SAIL_STALL;
    for (let a = 2 * DEG; a <= 90.01 * DEG; a += 0.5 * DEG) {
      const [cl, cd] = sailCoef(a, clMax, ar);
      const drive = cl * Math.sin(A) - cd * Math.cos(A);
      if (drive > best) { best = drive; at = a; }
    }
    t[d] = at;
  }
  return t;
}
const tableAt = (t, A) => { const d = clamp(Math.abs(A) / DEG, 0, 180), i = Math.min(179, Math.floor(d)), f = d - i; return t[i] + (t[i + 1] - t[i]) * f; };

// sheet (rad, null = the crew's): Day Sail's hand on the sheets: the main's sheet angle is the player's,
// the crew matches the jib to it, and flatten, reef and wing-on-wing stay the crew's (autoTrim on).
// Pro mode's sail controls (PRO below; null = the crew's, as in basic mode): traveller −1 (car down to leeward) … +1 (up
// to windward), twist −1 (the vang on, a closed leech) … +1 (eased, an open leech), backstay 0 … 1 (on: flatter sails),
// jibLead −1 (the car forward) … +1 (aft).
export const CONTROLS = { rudder: 0, main: 0.3, jib: 0.3, autoTrim: true, autoReef: true, flatten: 0, reef: 0, jibSide: 0, sheetBias: 0, autoWing: true, sheet: null,
  traveller: null, twist: null, backstay: null, jibLead: null,
  throttle: null, furl: 0, jibTrim: 0, jibFree: false, jibBack: 0, mainBack: 0, pivot: 0 };   // the engine's lever −1..1 (null: the engine's own, src/boat/engine.js); the sails' furl 0..1; jibTrim: the jib sheet off the crew's match (rad, + = eased; the helm station's JIB winch, R/F); jibBack, mainBack: the crew backing the jib and the main by hand to get her out of irons (rad; 0: none)

// Basic mode's sheets (W/S): the player's hand on both sheets over auto-trim. W eases, S trims; the offset (rad, + = out)
// rides on the crew's trim while a key is down and for 8 s after, then goes back to the crew over 4 s.
export const SHEET_HAND = { rate: 25 * DEG, max: 60 * DEG, hold: 8, blend: 4 };
export class SheetHand {
  constructor() { this.bias = 0; this.idle = 0; this.held = 0; }
  // dir: +1 ease (W), −1 trim (S), 0 hands off; dt in real seconds; returns the offset for CONTROLS.sheetBias
  update(dt, dir) {
    const H = SHEET_HAND;
    if (dir) { this.bias = clamp(this.bias + dir * H.rate * dt, -H.max, H.max); this.idle = 0; this.held = this.bias; }
    else {
      this.idle += dt;
      this.bias = this.held * clamp((H.hold + H.blend - this.idle) / H.blend, 0, 1);
    }
    return this.bias;
  }
}

// ---- pro: the traveller, the twist, the backstay and the jib lead (feat/pro-sailing) ----------------
// Honest, simple models; the directions follow the trim guides (North Sails, "Mainsail Trim" and "Jib Trim" (North U
// Trim, 2nd ed., 2006); Whidden & Levitt, "The Art and Science of Sails" (1990) ch. 8–9; Gladstone, "Performance
// Racing Trim" (North U, 2009); UK Sailmakers' "Trim Guide"):
// - traveller: moves the boom's sheeting angle without changing the leech tension (the sheet still holds the twist):
//   down to leeward opens the boom at the same sheet (less angle of attack, less heel: "drop the traveller in a puff"),
//   up to windward brings it toward the centreline (more power and pointing in light air). Up to 5° up (the boom to the
//   centreline) and 12° down (the car to the track's end); the traveller only works with the sheet near close-hauled
//   (it fades out as the sheet eases from 20° to 40°: off the wind the sheet pulls the boom out, not down).
// - twist: the leech's opening (the vang and the sheet's downward pull). The main is two bands, the lower 60 % and the
//   upper 40 % of the area, each with its own angle of attack; more twist opens the upper band 0.85 × and the lower
//   0.25 × of up to 6°: the head luffs first, the top's drive goes, and the heeling moment falls faster than the drive
//   (the top band's lever is the longest). Less twist powers the top and stalls it first.
// - backstay: flattens the main (the mast bends) and tightens the forestay (less sag: a flatter jib entry): the sails'
//   power (CLmax) × (1 − 0.5 × backstay), the same depower as the crew's flattening; the bend opens the main's leech
//   (+ 2° of twist). Flat sails lose drive in light air and win in a breeze, when the heel costs more than the power.
// - jib lead: the car aft opens the jib's leech (up to 5° of twist, the top 0.9 ×) and flattens its foot (the lower
//   band's CLmax − 12 %); forward closes the leech and deepens the foot. The telltales read it: "top telltales break
//   first, move the lead forward; bottom first, move it aft".
// The defaults (null) are the crew's: the traveller under the boom, the twist and the lead at their marks, the
// backstay as the crew's flattening; with every control at its neutral value the forces are the basic model's exactly.
export const PRO = {
  travUpDeg: 5, travDownDeg: 12, travFade: [20, 40],
  twistDeg: 6, bendTwistDeg: 2,
  main: { area: [0.6, 0.4], span: 0.62, open: [0.25, 0.85] },   // span: the bands' CE heights apart, × the sail's CE height
  jib: { area: [0.6, 0.4], span: 0.55, open: [0.1, 0.9] },
  jibLeadDeg: 5, jibFootCl: 0.12,
  rate: 0.5,                                                      // the keys' rate, units per second (controls.js)
};
// ---- end pro ----

// ---- knockdown (K1; ?knockdown=1, P.knockdown): the large-angle model, off by default ----
// Below KNOCKDOWN.keepDeg the righting arm is the basic model's exactly (GM·sin φ·(1 − φ / vanish)). Past it a GZ curve for a
// 28 ft keelboat: a Hermite from the basic curve's value and slope at keepDeg to its most at peakDeg (peak × GM), then down
// to at90 × GM at 90° (still righting). The rig in the water from rigTouch[0] (the boom end and the sails' foot) to
// rigTouch[1] (the spreaders): it damps the roll (rigRoll N·m per (rad/s)²) and drags the boat (rigCdA m², water) and the
// sails lose their air (sailWet of their area). The rudder's grip, already 70 % gone to ventilation by 40°, goes the rest
// of the way over rudderLoss: the round-up stalls. In storm gusts (true wind lateKt[0] … [1]) the crew trimming for a new
// sailor reacts a little late: its ease reads less of the heel ahead (lateLead of the lead dropped), follows slower (+ lateTau s)
// and eases less (× 1 − lateEase). Reef A reads the gusts: one reef from reefKt[0] of true wind, two from reefKt[1]. A gust's downdraft (downdraft × the wind) presses the heeled sails past keepDeg while the main is sheeted in
// (eased from sheetSpill[0]° to [1]° it spills; a luffing main spills fillGate of it). Reef A's reef goes in over reefS s. [est: a C28-sized GZ (max ≈ 60–70°, AVS ≈ 120°); tuned with
// tools/v2-beginner-reef-sim.mjs to the plan's rates]
export const KNOCKDOWN = Object.freeze({ keepDeg: 35, midDeg: 50, mid: 0.42, midSlope: 0.05, peakDeg: 62, peak: 0.43, at90: 0.28, slope90: -0.5, rudderLoss: [45, 55], rigTouch: [50, 80], rigRoll: 6e5, rigCdA: 4, sailWet: 0.5, downdraft: 0.6, sheetSpill: [50, 65], fillGate: 0.8, reefS: 2, lateKt: [26, 32], lateTau: 2, lateLead: 1, lateEase: 0.9, reefKt: [24, 30] });
const basicArm = (a, V) => Math.sin(a) * Math.max(0, 1 - a / V);   // |φ|, the vanishing angle (rad); × GM
const hermite = (t, p0, m0, p1, m1, h) => { const t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * h * m1; };
// the righting arm (m, signed as φ): the basic model, or with knockdown on the large-angle curve past keepDeg
export function rightingArm(phi, P, knockdown = !!P.knockdown) {
  const a = Math.abs(phi), K = P.kd ?? KNOCKDOWN, k0 = K.keepDeg * DEG;
  if (!knockdown || a <= k0) return P.gm * Math.sin(phi) * Math.max(0, 1 - a / P.vanish);
  const V = P.vanish, p0 = basicArm(k0, V), m0 = Math.cos(k0) * (1 - k0 / V) - Math.sin(k0) / V;
  const km = K.midDeg * DEG, k1 = K.peakDeg * DEG, k2 = Math.PI / 2;
  const g = a <= km ? hermite((a - k0) / (km - k0), p0, m0, K.mid, K.midSlope, km - k0)
    : a <= k1 ? hermite((a - km) / (k1 - km), K.mid, K.midSlope, K.peak, 0, k1 - km)
    : hermite(Math.min(1, (a - k1) / (k2 - k1)), K.peak, 0, K.at90, K.slope90, k2 - k1);
  return sgn(phi) * P.gm * g;
}
// ---- end knockdown ----

export class BoatPhysics {
  // x, z m; heading rad; speed m/s (surge at the start); params overrides BOAT
  // vessel: the boat's profile (src/vessels/<id>.json; this page's boat by default): its numbers under params
  constructor({ x = 0, z = 0, heading = 0, speed = 0, params = {}, vessel = CURRENT_VESSEL } = {}) {
    this.vessel = vessel;
    this.P = { ...boatParams(vessel), ...params };
    this.t = 0;
    this.acc = 0;
    this.trim = { main: trimTable(this.P.main.clMax * 1.1, this.P.main.ar), jib: trimTable(this.P.jib.clMax, this.P.jib.ar) };
    this.auto = { main: 30 * DEG, jib: 30 * DEG, flatten: 0 };
    this.jibSide = -1;
    this.mainB = 0;                     // the main's mean chord angle (the boom's + the twist), rad
    this.jibB = 0;                      // the jib's mean chord angle (the clew's + the twist), rad
    this.reefPos = 0; this.reefAuto = 0; this.reefWait = 0; this.reefCalm = 0; this.heelAvg = 0; this.firstTick = true;
    this.p = 0;                        // roll rate, rad/s
    this.cues = { surf: new surfCue(), round: new RoundUp(), groove: new GrooveLock() };   // the thrill cues (src/boat/thrill.js, groove.js)
    this.engine = new Engine(params.engine ?? vessel.engine);   // the auxiliary (src/boat/engine.js): start(), stop(), the lever via controls.throttle
    this.furlPos = 0;
    this.state = {
      x, z, heading, u: speed, v: 0, yawRate: 0, heel: 0, pitch: 0, heave: 0,
      rudderAngle: 0, boomAngle: 0, jibAngle: 0, mainFill: 0, jibFill: 0, mainDraft: 1, jibDraft: 1,
      jibBacked: false, reef: 0, apparentWind: { speed: 0, angle: 0 }, trueWind: { speed: 0, angle: 0 },
      // pro: the controls in use and each sail's two bands (low, top): fill and angle of attack
      traveller: 0, twist: 0, backstay: 0, jibLead: 0, mainTwistX: 0, jibTwistX: 0,
      mainLowFill: 0, mainTopFill: 0, jibLowFill: 0, jibTopFill: 0, mainLowAoA: 0, mainTopAoA: 0, jibLowAoA: 0, jibTopAoA: 0,
      sog: speed, cog: heading,
      // beyond the contract: leeway, the sails' angles of attack and forces, the sheet angles in use
      reefing: 0, leeway: 0, mainAoA: 0, jibAoA: 0, mainSheet: 0, jibSheet: 0, flatten: 0, drive: 0, side: 0, heelMoment: 0,
      crewSheet: 30 * DEG, mainStall: 0, jibStall: 0,
      // the thrill cues (0..1): surfing, the lee rail awash, a round-up, a slam; the groove (score, lock-in, seconds held)
      waveSurge: 0, hullRes: 0, slamVel: 0, mainAoABest: 0, surf: 0, rail: 0, roundUp: 0, slam: 0, grooveScore: 0, groove: 0, grooveHeld: 0,
      // the engine: rpm, gear (−1 astern, 0 neutral, 1 ahead), lever, the prop's thrust (N, + ahead) and walk (N, +
      // starboard), the slipstream at the rudder (m/s); the sails' furl (0 set … 1 down)
      engineOn: false, engineState: 'off', engineRpm: 0, engineGear: 0, throttle: 0, thrust: 0, propWalk: 0, propWash: 0, furl: 0,
      ext: null,   // the last outside force (env.ext): { X, Y, N, ... }
    };
  }

  // advance dt seconds in whole 1/60 s ticks (the remainder carries to the next call): deterministic for any frame rate
  // A tick that makes a non-number (a NaN wave height, a zero-length vector) would freeze or hide the boat for good: the
  // state goes back to the last good one, the tick is counted, and the first one says so (fix/ios-start; ?diag=1 shows
  // the count). A finite run is untouched, so every result is the same as before.
  step(dt, controls = CONTROLS, env) {
    this.acc += dt;
    while (this.acc >= DT - 1e-9) {
      const good = this._good ??= {};
      copyFinite(this.state, good);
      this.tick(controls, env); this.acc -= DT;
      if (!stateFinite(this.state)) {
        restoreState(this.state, good);
        this.nanTrips = (this.nanTrips ?? 0) + 1;
        const D = peekDiag(); if (D) { D.nanTrips++; if (this.nanTrips === 1) D.error('boat NaN', 'a physics tick made a non-number; the last good state was kept'); }
        if (this.nanTrips === 1) console.warn('boat: a physics tick made a non-number; the last good state is kept (counted in ?diag=1)');
      }
    }
    return this.state;
  }

  // the reef this tick: the player's (c.reef), or with autoTrim (and autoReef, on by default) the deeper of that and
  // the automatic one
  reefTarget(c, dt, wind = null) {
    const P = this.P, heel = Math.abs(this.state.heel);
    this.heelAvg += (heel - this.heelAvg) * (1 - Math.exp(-dt / 6));
    this.reefWait = Math.max(0, this.reefWait - dt);
    const manual = clamp(c.reef | 0, 0, 2);
    if (c.autoTrim === false || c.autoReef === false) { this.reefAuto = 0; return manual; }
    if (P.knockdown && wind == null) {   // knockdown: reef A reads the gusts as a skipper does (KNOCKDOWN.reefKt)
      const KDr = P.kd ?? KNOCKDOWN, kt = this.state.trueWind.speed / 0.514444, floor = kt >= KDr.reefKt[1] ? 2 : kt >= KDr.reefKt[0] ? 1 : 0;
      if (floor > this.reefAuto) { this.reefAuto = floor; this.reefWait = P.reefHold; this.reefCalm = 0; }
    }
    if (this.firstTick && wind != null) {
      // a boat that sets out already in a blow sets out reefed and flat (no full-sail knockdown in the first gust)
      const kt = wind / 0.514444;
      this.reefAuto = kt >= P.reefStartKt[1] ? 2 : kt >= P.reefStartKt[0] ? 1 : 0;
      this.reefPos = this.reefAuto;
      this.auto.flatten = smooth(10, 16, kt);
    }
    const reefIn = this.reefAuto >= 1 ? P.reefIn2 ?? P.reefIn : P.reefIn;   // the second reef waits for more heel
    if (this.reefWait === 0 && this.reefAuto < 2 && ((this.heelAvg > reefIn && this.auto.flatten > 0.3) || heel > P.reefNow)) {
      this.reefAuto++; this.reefWait = P.reefHold; this.reefCalm = 0;
    } else if (this.reefWait === 0 && this.reefAuto > 0) {
      // the heel one step lighter: heeling moment ∝ area × centre of effort height
      const r = this.reefAuto, lighter = this.heelAvg * (P.reefArea[r - 1] * P.reefZ[r - 1]) / (P.reefArea[r] * P.reefZ[r]);
      this.reefCalm = lighter < P.reefOut ? this.reefCalm + dt : 0;
      if (this.reefCalm > P.reefCalm) { this.reefAuto--; this.reefWait = P.reefHold; this.reefCalm = 0; }
    }
    return Math.max(manual, this.reefAuto);
  }

  tick(c, env) {
    const s = this.state, P = this.P, dt = DT, t = env.t ?? this.t;
    // the reef: the player's, or with autoTrim the deeper of the player's and the automatic one; it goes in over reefS
    const wind0 = this.firstTick ? (() => { const w0 = env.windAt(s.x, s.z, t); return Math.hypot(w0.vx, w0.vz); })() : null;
    const reef = this.reefTarget(c, dt, wind0);
    this.firstTick = false;
    const KDs = P.kd ?? KNOCKDOWN, reefS = P.knockdown && s.trueWind.speed >= KDs.reefKt[0] * 0.514444 ? KDs.reefS : P.reefS;   // knockdown: the crew reefs faster in a blow (from reefKt[0] of true wind; under it the reef goes in as before, bit for bit)
    this.reefPos += clamp(reef - this.reefPos, -dt / reefS, dt / reefS);
    const ri = Math.min(1, Math.floor(this.reefPos)), rfr = this.reefPos - ri;
    const reefArea = P.reefArea[ri] + (P.reefArea[ri + 1] - P.reefArea[ri]) * rfr, reefZ = P.reefZ[ri] + (P.reefZ[ri + 1] - P.reefZ[ri]) * rfr;
    const sinH = Math.sin(s.heading), cosH = Math.cos(s.heading);
    const phi = s.heel, cphi = Math.cos(phi), sphi = Math.sin(phi);
    // the crew's furl and the engine (9)
    this.furlPos += clamp(clamp(c.furl ?? 0, 0, 1) - this.furlPos, -dt / P.furlS, dt / P.furlS);
    const sailUp = 1 - this.furlPos;
    const eng = this.engine; eng.step(dt, c.throttle ?? eng.lever);
    const prop = propForces(eng, s.u);

    // 1. the water's motion and the boat's motion over the ground
    const cur = env.currentAt ? env.currentAt(s.x, s.z, t) : null;
    const cx = cur ? cur.vx : 0, cz = cur ? cur.vz : 0;
    const gx = s.u * sinH + s.v * cosH + cx, gz = -s.u * cosH + s.v * sinH + cz;
    const w = env.windAt(s.x, s.z, t);

    // the rudder follows the helm at a finite rate
    const rudCmd = clamp(c.rudder ?? 0, -1, 1) * P.rudder.maxDeg * DEG;
    s.rudderAngle += clamp(rudCmd - s.rudderAngle, -P.rudder.rateDeg * DEG * dt, P.rudder.rateDeg * DEG * dt);

    // 2–4. the sails
    // knockdown: past keepDeg a gust's downdraft (downdraft × the wind's speed, down) presses on the heeled sails: the air
    // the sails meet is the wind's projection (× cos φ) plus its fall (× sin φ). Off below keepDeg (the basic model there).
    const KDn = P.kd ?? KNOCKDOWN;
    // only a main sheeted in holds it (last tick's sheet): eased from sheetSpill[0]° to [1]° it twists off and spills
    const sheetIn = 1 - smooth(KDn.sheetSpill[0] * DEG, KDn.sheetSpill[1] * DEG, s.mainSheet || 0);
    const gustDown = P.knockdown ? KDn.downdraft * smooth(KDn.keepDeg * DEG, (KDn.keepDeg + 10) * DEG, Math.abs(phi)) * sheetIn * (1 - KDn.fillGate * (1 - clamp(s.mainFill, 0, 1))) : 0;   // a luffing main (fillGate of it) spills too
    let X = 0, Y = 0, N = 0, K = 0;
    const sail = (S, area) => {
      const h = S.z * reefZ;
      const k = Math.pow(Math.max(h * cphi, 1) / 10, 0.14);
      const ax = cx + (w.vx - cx) * k - gx, az = cz + (w.vz - cz) * k - gz;   // air past the boat (the gradient is over the water)
      const wf = ax * sinH - az * cosH;                                 // body forward
      let ws = ax * cosH + az * sinH - s.yawRate * S.x;                 // body starboard (yaw swings the sail sideways)
      ws = ws * cphi - this.p * h;                                       // in the sail's plane; roll rate moves the sail
      if (gustDown) ws += gustDown * Math.hypot(w.vx, w.vz) * sphi;     // knockdown: a gust's downdraft on the heeled sail (past keepDeg only)
      const va2 = wf * wf + ws * ws, va = Math.sqrt(va2);
      const A = Math.atan2(-ws, -wf);                                   // + = from starboard
      return { h, wf, ws, va, va2, A, area, S };
    };
    const KD_ = P.kd ?? KNOCKDOWN;   // knockdown's numbers (P.kd: a tuning run's own)
    // knockdown: the rig in the water (0 dry … 1 to the spreaders); the sails' wet share loses its air
    const rigWet = P.knockdown ? smooth(KD_.rigTouch[0] * DEG, KD_.rigTouch[1] * DEG, Math.abs(phi)) : 0;
    const dry = 1 - KD_.sailWet * rigWet;
    const mA = sail(P.main, P.main.area * reefArea * sailUp * dry);
    // the gennaker (src/sim/sail/gennaker.js): made the first time it is asked for, so a boat that never flies it
    // keeps every byte; while it is up the jib is rolled away (its area × 1 − the hoist)
    const GK = this.gk ?? (c.gennaker ? (this.gk = createGennaker()) : null);
    const jibRolled = GK ? clamp(GK.roll ?? 0, 0, 1) : 0;   // round 2: the sock goes up with the jib still drawing, then the jib rolls away (its area by the furler)
    const jA = sail(P.jib, P.jib.area * reefArea * sailUp * dry * (1 - jibRolled));

    // sheets: auto-trim or the player's (0 = in, 1 = out)
    // the heel ahead: the heel plus 0.6 s of the roll rate. Trimming to the heel alone lags the roll and pumps it
    // (a 3 s oscillation between 17° and 27° on the advisory day); the lead damps it, as a crew eases as the boat starts to go
    const want = Math.abs(phi + 0.6 * this.p);
    // knockdown: the crew (no hand on the sheet) a little late in storm gusts (KNOCKDOWN.lateKt); 0 otherwise
    const KDl = P.kd ?? KNOCKDOWN, late = P.knockdown && c.sheet == null ? smooth(KDl.lateKt[0] * 0.514444, KDl.lateKt[1] * 0.514444, s.trueWind.speed) : 0;
    const wantEase = late ? Math.abs(phi + 0.6 * (1 - KDl.lateLead * late) * this.p) : want;
    const flatTarget = c.autoTrim !== false ? smooth(P.crewFlat[0], P.crewFlat[1], want) : clamp(c.flatten ?? 0, 0, 1);
    const kTrim = 1 - Math.exp(-dt / 0.5), kFlat = 1 - Math.exp(-dt / 0.8);
    let mainSheet, jibSheet, gkHand = 0;   // gkHand: W/S's in/out on the gennaker's sheet (rad off the crew's best; + = eased)
    if (c.autoTrim !== false) {
      // a heavy helm or a hard heel: ease the main (up to 30°) to unload the rudder, as a crew does in a puff
      const ease = 30 * DEG * (1 - KDl.lateEase * late) * Math.max(smooth(14 * DEG, 24 * DEG, Math.abs(s.rudderAngle)), smooth(P.crewEase[0], P.crewEase[1], wantEase));
      const m0 = clamp(Math.abs(mA.A) - tableAt(this.trim.main, mA.A), P.main.minDeg * DEG, P.main.maxDeg * DEG);   // the main's best sheet
      const m = clamp(m0 + ease, P.main.minDeg * DEG, P.main.maxDeg * DEG);
      const j = clamp(Math.abs(jA.A) - tableAt(this.trim.jib, jA.A), P.jib.lead, P.jib.maxDeg * DEG);
      this.auto.main += (m - this.auto.main) * (late ? 1 - Math.exp(-dt / (0.5 + KDl.lateTau * late)) : kTrim);
      this.auto.main0 = (this.auto.main0 ?? m0) + (m0 - (this.auto.main0 ?? m0)) * kTrim;
      this.auto.jib += (j - this.auto.jib) * kTrim;
      this.auto.flatten += (flatTarget - this.auto.flatten) * kFlat;
      if (c.sheet != null) {
        // the player's own sheet (Day Sail): the main sits where they left it; the crew sets the jib the same
        // way off its best (a jib trimmed to the main), so one hand works both sails
        mainSheet = clamp(c.sheet, P.main.minDeg * DEG, P.main.maxDeg * DEG);
        s.jibMatch = clamp(this.auto.jib + (mainSheet - this.auto.main0), P.jib.lead, P.jib.maxDeg * DEG);   // the crew's match to the main, inside its own range
        jibSheet = c.jibTrim ? clamp(s.jibMatch + c.jibTrim, ...jibHandRange(P)) : s.jibMatch;   // jibTrim: the jib's own winch (rad, + = out), past the crew's stops
        // W/S trim both flying sails (owner, 2026-11-21): the gennaker's own sheet off its best as the hand's W/S moved it (c.gkHand,
        // v2/sim/boat.js; its own line: the main can sit on the shrouds on a run while the gennaker still eases); held where it was left
        gkHand = c.gkHand ?? 0;
      } else {
        // the player's hand on the sheets (the 2026-10-29 basic mode W/S) rides on the crew's trim
        const b = c.sheetBias ?? 0;
        mainSheet = clamp(this.auto.main + b, P.main.minDeg * DEG, P.main.maxDeg * DEG);
        gkHand = b;
        s.jibMatch = clamp(this.auto.jib + b, P.jib.lead, P.jib.maxDeg * DEG);
        jibSheet = c.jibTrim ? clamp(s.jibMatch + c.jibTrim, ...jibHandRange(P)) : s.jibMatch;
      }
    } else {
      mainSheet = (P.main.minDeg + clamp(c.main ?? 0.3, 0, 1) * (P.main.maxDeg - P.main.minDeg)) * DEG;
      jibSheet = P.jib.lead + clamp(c.jib ?? 0.3, 0, 1) * (P.jib.maxDeg * DEG - P.jib.lead);
      this.auto.flatten = flatTarget;
    }
    // let fly (c.jibFree, feat/let-fly): the jib sheet thrown off its winch. No sheet holds the clew: it streams downwind
    // and flogs, out to the shrouds, the boom's own stop (P.main.maxDeg). The main's let fly needs nothing here: its
    // sheet run out is the sheet at P.main.maxDeg.
    if (c.jibFree) jibSheet = P.main.maxDeg * DEG;
    // ---- pro: the player's backstay replaces the crew's flattening; the traveller moves the boom's limit ----
    const proBackstay = c.backstay != null ? clamp(c.backstay, 0, 1) : null;
    const flatten = proBackstay ?? this.auto.flatten, power = 1 - 0.5 * flatten;
    const trav = clamp(c.traveller ?? 0, -1, 1);
    const travOff = trav === 0 ? 0 : -trav * (trav > 0 ? PRO.travUpDeg : PRO.travDownDeg) * DEG * (1 - smooth(PRO.travFade[0] * DEG, PRO.travFade[1] * DEG, mainSheet));
    const mainLimit = travOff === 0 ? mainSheet : clamp(mainSheet + travOff, (P.main.minDeg - PRO.travUpDeg * Math.max(0, trav)) * DEG, P.main.maxDeg * DEG);
    const twistX = (PRO.twistDeg * clamp(c.twist ?? 0, -1, 1) + PRO.bendTwistDeg * (proBackstay ?? 0)) * DEG;   // the main's extra twist, rad
    const jl = clamp(c.jibLead ?? 0, -1, 1), jibTwistX = PRO.jibLeadDeg * jl * DEG;
    // ---- end pro ----

    // where each sail sits: the free (weathervane) angle −A, inside the sheet's range; the main gybes 10° by the lee
    const boomSide = this.mainB === 0 ? -sgn(mA.A) : sgn(this.mainB);
    let mFree = wrap(-mA.A);
    if (Math.abs(mA.A) > Math.PI - BY_THE_LEE && sgn(mFree) !== boomSide) mFree = boomSide * Math.PI;
    let mTarget = clamp(mFree, -mainLimit, mainLimit);   // pro: the traveller's limit (mainSheet in basic)
    // pushed out by hand (c.mainBack, rad, signed: + to starboard; the FREE manoeuvre's crew holding the boom out to back the main,
    // the old way out of irons with the backed jib): the boom held there whatever the wind; 0 or absent: as before
    if (c.mainBack) mTarget = clamp(c.mainBack, -P.main.maxDeg * DEG, P.main.maxDeg * DEG);
    // the jib: auto keeps the clew on the leeward side (same by-the-lee rule); jibSide ±1 holds it (backing the jib)
    // auto wing-on-wing (autoTrim and autoWing): deeper than 160° off the true wind for 8 s, the crew holds the jib out
    // opposite the boom (and swaps it with the boom on a gybe); up past 150° it goes back to leeward
    const twa = Math.abs(s.trueWind.angle);
    if (c.autoTrim !== false && c.autoWing !== false && !c.jibSide) {
      this.wingT = twa > 160 * DEG ? (this.wingT ?? 0) + dt : 0;
      if (twa < 150 * DEG) this.wing = 0;
      else if (this.wing || this.wingT > 8) this.wing = -sgn(this.mainB || 1);
    } else { this.wing = 0; this.wingT = 0; }
    const hold = c.jibSide || this.wing || 0;
    if (hold) this.jibSide = sgn(hold);
    else if (sgn(jA.A) === this.jibSide && Math.abs(jA.A) < Math.PI - BY_THE_LEE) this.jibSide = -sgn(jA.A);
    const lo = Math.min(2 * P.jib.lead - jibSheet, jibSheet), hi = jibSheet;   // the clew's range about its lead, on its side (hauled past the lead: pinned at the sheet)
    let jFree = wrap(-jA.A);
    if (sgn(jFree) !== this.jibSide && Math.abs(jA.A) > Math.PI - BY_THE_LEE) jFree = this.jibSide * Math.PI;
    let jTarget = this.jibSide > 0 ? clamp(jFree, lo, hi) : clamp(jFree, -hi, -lo);
    // held to windward with the wind abaft the beam (wing-on-wing), the wind presses the clew out to the sheet's limit
    if (this.jibSide === sgn(jA.A) && Math.abs(jA.A) > Math.PI / 2) jTarget = this.jibSide * hi;
    // backed on purpose (c.jibBack, rad: the FREE manoeuvre's crew holding the clew out to windward to get her out of irons):
    // the clew held at least that far out on the windward side while the wind is forward of the beam; 0 or absent: as before
    if (c.jibBack > 0 && c.jibSide && this.jibSide === sgn(jA.A) && Math.abs(jA.A) <= Math.PI / 2) jTarget = this.jibSide * Math.max(Math.abs(jTarget), c.jibBack);
    const swing = (b, target, S) => b + clamp((target - b) * (1 - Math.exp(-dt / S.tau)), -S.swingDeg * DEG * dt, S.swingDeg * DEG * dt);
    this.mainB = clamp(swing(this.mainB, mTarget, P.main), -P.main.maxDeg * DEG, P.main.maxDeg * DEG);
    s.boomAngle = sgn(this.mainB) * Math.max(0, Math.abs(this.mainB) - MAIN_TWIST_DEG * DEG);   // the boom
    const jMaxB = Math.max(P.jib.maxDeg * DEG, jibSheet);   // a hand easing the sheet past the rail lets the clew go (JIB_HAND)
    this.jibB = clamp(swing(this.jibB, jTarget, P.jib), -jMaxB, jMaxB);
    s.jibAngle = sgn(this.jibB) * Math.max(0, Math.abs(this.jibB) - JIB_TWIST_DEG * DEG);   // the clew

    // the force on one sail at boom angle b; returns its fill (0 luffing … 1 drawing) and, with apply, adds to X, Y, N, K
    // downwind the main blankets a jib on its own side: the jib loses its wind and collapses from AWA ≈130° to 160°.
    // Held to the other side (wing-on-wing, jibSide), it stands clear.
    const shade = sgn(this.jibB) === sgn(this.mainB) ? smooth(130 * DEG, 160 * DEG, Math.abs(mA.A)) : 0;
    const blanket = 1 - 0.85 * shade;
    const force = (a, b, clMax, ar, cdScale, qScale, apply) => {
      if (a.va < 1e-6) return { fill: 0, aoa: 0, backed: false };
      const as = wrap(a.A + b);                                       // signed angle of attack (chord-forward is −b)
      const side = Math.abs(b) < 1e-6 ? -sgn(a.A) : sgn(b);
      const backed = side === sgn(a.A) && Math.abs(as) > LUFF0;
      let cl, cd, fill;
      if (backed) {
        // a flat plate's normal force (Cn = 1.3 sin α) plus skin friction: no lift beyond the normal force, so a
        // clew held to windward can only push the boat back and sideways
        const sn = Math.sin(as);
        cl = 1.3 * sn * Math.cos(as); cd = 0.02 + 1.3 * sn * sn; fill = 1;
      } else {
        const aa = -side * as;                                         // ≥ 0 when the wind is on the right face
        if (aa <= 0) { cl = 0; cd = FLOG_CD; fill = 0; }
        else { [cl, cd] = sailCoef(aa, clMax, ar); cl *= -side; fill = smooth(LUFF0, LUFF1, aa); }
      }
      cd *= cdScale;
      const q = 0.5 * RHO_AIR * a.va2 * a.area * qScale;
      const ef = a.wf / a.va, es = a.ws / a.va;                       // the flow's direction (toward)
      const Ff = q * (cl * -es + cd * ef), Fs = q * (cl * ef + cd * es);
      const Fy = Fs * cphi;
      if (apply) {
        X += Ff; Y += Fy;
        N += a.S.x * Fy - a.h * sphi * Ff;                             // the drive acts to leeward of the centreline when heeled
        K += Fs * a.h;
      }
      return { fill: backed ? 1 : fill, aoa: backed ? as : -side * as, backed };
    };
    // ---- pro: a sail as two bands (low, top), each its own chord angle and CLmax; one band when neutral (the basic
    // model exactly). B: PRO.main / PRO.jib; open: rad of extra twist; lowCl: × the low band's CLmax ----
    const banded = (a, b, clMax, ar, cdScale, qScale, apply, B, open, lowCl = 1) => {
      if (open === 0 && lowCl === 1) { const f = force(a, b, clMax, ar, cdScale, qScale, apply); return { ...f, low: f, top: f }; }
      const side = Math.abs(b) < 1e-6 ? -sgn(a.A) : sgn(b), [w0, w1] = B.area;
      const lowA = { ...a, area: a.area * w0, h: a.h * (1 - w1 * B.span) }, topA = { ...a, area: a.area * w1, h: a.h * (1 + w0 * B.span) };
      const low = force(lowA, b + side * B.open[0] * open, clMax * lowCl, ar, cdScale, qScale, apply);
      const top = force(topA, b + side * B.open[1] * open, clMax, ar, cdScale, qScale, apply);
      return { fill: w0 * low.fill + w1 * top.fill, aoa: w0 * low.aoa + w1 * top.aoa, backed: low.backed || top.backed, low, top };
    };
    const jibLowCl = 1 - PRO.jibFootCl * jl;
    // the jib first (with the slot's 10 % less drag when it draws), then the main (its CL × 1.1 in the slot)
    const j0 = banded(jA, this.jibB, P.jib.clMax * power, P.jib.ar, 1, blanket, false, PRO.jib, jibTwistX, jibLowCl);
    const slot = !j0.backed && j0.fill > 0.5;
    const jf = banded(jA, this.jibB, P.jib.clMax * power, P.jib.ar, slot ? 0.9 : 1, blanket, true, PRO.jib, jibTwistX, jibLowCl);
    const mf = banded(mA, this.mainB, P.main.clMax * power * (slot ? 1.1 : 1), P.main.ar, 1, 1, true, PRO.main, twistX);
    // ---- end pro ----
    // the gennaker's forces: its own apparent wind at its centre of effort, the coefficients of the sail
    // trimmed to its best (gkCoef) × its fill, the trim's stall; collapsed, its flogging drag. Its sheet: the crew's best, the
    // jib's own winch (c.jibTrim: the jib is rolled away while it flies; c.gkTrim, Pro's R/F on its own sheet, when set) and W/S's offset when the crew trims, plus the crew's
    // ease in a hard heel (autoTrim with the crew on the sheets, c.sheet null: New skill's crew trim). W/S (both sails) move it too: with the crew on the
    // sheets by sheetBias, with a hand on them (c.sheet) by the hand's own W/S on its sheet (c.gkHand). A player with a hand on the
    // sheets eases it themselves: held in a strong gust, it broaches her.
    let gkOut = null;
    if (GK) {
      const gA = sail({ z: GENNAKER.ceZ / reefZ, x: GENNAKER.ceX }, GENNAKER.areaM2 * dry);
      const spill = c.autoTrim !== false && c.sheet == null && c.gkTrim == null ? GENNAKER.crewSpill * smooth(P.crewEase[0], P.crewEase[1], wantEase) * (1 - KDl.lateEase * late) : 0;
      const err = (c.gkTrim ?? c.jibTrim ?? 0) + gkHand + spill;
      stepGennaker(GK, { want: !!c.gennaker && this.furlPos < 0.5, dt, t, awa: gA.A, va: gA.va, err });
      const share = GK.sock * Math.pow(GK.fill, 1.5);   // round 2: no drive until the sock lifts (fill is 0 in the sock)
      let Ff = 0, Fs = 0;
      if (gA.va > 1e-6 && GK.sock > 0) {
        let [cl, cd] = gkCoef(gA.A);
        const st = gkStall(err);
        cl *= 1 - GENNAKER.stallCl * st; cd *= 1 + GENNAKER.stallCd * st;
        const q = 0.5 * RHO_AIR * gA.va2 * gA.area * GK.sock, ef = gA.wf / gA.va, es = gA.ws / gA.va;
        const cls = cl * sgn(gA.A) * Math.pow(GK.fill, 1.5), cds = cd * Math.pow(GK.fill, 1.5) + GENNAKER.flogCd * (1 - GK.fill) * (GK.lift >= 0.999 ? 1 : 0.2);
        Ff = q * (cls * -es + cds * ef); Fs = q * (cls * ef + cds * es);
        const Fy = Fs * cphi;
        X += Ff; Y += Fy; N += gA.S.x * Fy - gA.h * sphi * Ff; K += Fs * gA.h;
      }
      gkOut = { deploy: GK.deploy, sock: GK.sock, roll: GK.roll, lift: GK.lift, phase: GK.phase, fill: GK.fill, target: GK.target, side: GK.sx, angle: GK.sx * gkChord(gA.A, err), err, awa: gA.A, aws: gA.va, drive: Ff, heelM: Fs * gA.h, share,
        bangs: GK.bangs, bang: GK.bang, gybing: GK.gybing, up: GK.want, jibFurl: jibRolled };
    }
    const sailX = X, sailY = Y, sailK = K;

    // 5. keel and rudder (lateral velocity in the heeled plane: sway, yaw and roll)
    const foil = (F, vlat, rot, uIn = s.u) => {
      // rot: the foil's chord turned from the centreline (+ = leading edge to starboard); uIn: the flow along the hull
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const vx = uIn * cr + vlat * sr, vy = -uIn * sr + vlat * cr;     // the foil's velocity in its own frame
      const v2 = vx * vx + vy * vy;
      if (v2 < 1e-10) return { bx: 0, by: 0, a: 0 };
      const a = Math.atan2(vy, vx), V = Math.sqrt(v2);
      const [cl, cd] = foilCoef(a, F.ar, F.stall);
      const q = 0.5 * RHO_W * v2 * F.area;
      const ex = vx / V, ey = vy / V;
      const fx = q * (cl * ey - cd * ex), fy = q * (-cl * ex - cd * ey); // lift ⊥ the flow, against the slip
      const bx = fx * cr - fy * sr, by = fx * sr + fy * cr;            // back to the body frame
      return { bx, by, a };
    };
    const vk = s.v * cphi + s.yawRate * P.keel.x * cphi + this.p * P.keel.z;
    const kf = foil(P.keel, vk, 0);
    const vr = s.v * cphi + s.yawRate * P.rudder.x * cphi + this.p * P.rudder.z;
    let vent = 1 - 0.7 * smooth(P.rudder.vent[0], P.rudder.vent[1], Math.abs(phi));  // a heeled rudder ventilates
    if (P.knockdown) {
      vent *= 1 - smooth(KD_.rudderLoss[0] * DEG, KD_.rudderLoss[1] * DEG, Math.abs(phi));   // knockdown: the rest of its grip goes
    }
    // the keel's downwash at the rudder: downwash × the keel's angle of attack while the keel's flow is attached; past its
    // stall the keel's lift (and so its downwash) fades out over 15° as foilCoef's blend does, and with the flow abeam or
    // from astern (|a| toward 90° … 180°: a boat stopped, sliding sideways or making sternway, the rudder then upstream of
    // the keel) there is none. Taken raw, the keel's ±180° in sternway made a phantom 63° of rudder whose side flipped with
    // the slightest sway: in the prop's slipstream it spun her at ≈ 17°/s under full ahead from a little sternway
    // (fix/v2-motor-spin, 2026-11-14), and in the free stream it circled her at ≈ 7°/s at full astern, the helm amidships,
    // and turned her the same way whichever way the helm was put (fix/sim-astern-rudder, 2026-11-14).
    const kA = clamp(kf.a, -P.keel.stall, P.keel.stall) * (1 - smooth(P.keel.stall, P.keel.stall + 15 * DEG, Math.abs(kf.a)));
    const rf0 = foil(P.rudder, vr, -s.rudderAngle + P.rudder.downwash * kA);
    // 9. the prop's slipstream over washFrac of the rudder (ahead only): steerage under power at low speed
    let rf = rf0;
    if (prop.wash > s.u + 0.05) {
      const rw = foil(P.rudder, vr, -s.rudderAngle + P.rudder.downwash * kA, prop.wash), k = eng.P.washFrac;
      rf = { bx: rf0.bx * (1 - k) + rw.bx * k, by: rf0.by * (1 - k) + rw.by * k, a: rf0.a };
    }
    X += kf.bx; Y += kf.by * cphi; N += P.keel.x * kf.by * cphi; K += kf.by * P.keel.z;
    X += rf.bx * vent; Y += rf.by * cphi * vent; N += P.rudder.x * rf.by * cphi * vent; K += rf.by * P.rudder.z * vent;

    // 6. hull, windage, the hull's sideways drag
    const seaNow = env.sea ? env.sea() : null;
    const faceSlope = seaNow ? -(seaNow.slopeX ?? 0) : 0;   // + = the surface falls toward the bow: the wave pushes forward (6b)
    X -= hullResistance(s.u, phi, P, clamp((faceSlope - 0.03) / 0.07, 0, 1));
    Y -= 0.5 * RHO_W * P.hull.latArea * s.v * Math.abs(s.v);
    {
      const ax = w.vx - gx, az = w.vz - gz;
      const wf = ax * sinH - az * cosH, ws = ax * cosH + az * sinH, va = Math.hypot(wf, ws);
      const q = 0.5 * RHO_AIR * P.hull.windCdA * va;
      X += q * wf; Y += q * ws; K += q * ws * P.hull.windZ;
      // its yaw moment only as the sails come down: with sails set, their effective fore-aft positions (BOAT's x, tuned
      // to a mild weather helm close-hauled) already carry the bare hull and rig's share of the balance
      N += q * ws * windX(P, wf, va) * this.furlPos;
    }
    // 6b. the waves' surge (surfing): the Froude–Krylov force of the waves along the hull, −Δ·g·slope, the slope the
    // float's waterplane reads (src/boat/float.js slopeX; env.sea, one frame old in the page). It is the classic
    // surf-riding surge model (Grim 1951; Spyrou 1996; Umeda 1999): (m + m11)·u' = T(u) − R(u) − f·sin(k·ξ). A boat
    // near the wave's speed along its track stays on the forward face, where the slope drives it down the wave above
    // hull speed; slower, the wave passes under it and the push averages out; on a beat the waves pass in a second.
    // 9. the prop: thrust along the shaft, the walk at the prop (yaw about the centre), the furled cloth's windage
    X += prop.thrust; Y += prop.walk; N += eng.P.propX * prop.walk; K += prop.walk * eng.P.propZ;
    if (this.furlPos > 0) {
      const ax = w.vx - gx, az = w.vz - gz, wf = ax * sinH - az * cosH, ws = ax * cosH + az * sinH, va = Math.hypot(wf, ws);
      const q = 0.5 * RHO_AIR * P.furlCdA * this.furlPos * va;
      X += q * wf; Y += q * ws; K += q * ws * 2.5; N += q * ws * windX(P, wf, va);
    }
    // outside forces (the anchor rode, a mooring pennant, the dock: src/boat/tackle.js), body frame
    const ext = env.ext ? env.ext(s, dt, t, this) : null;
    if (ext) { X += ext.X ?? 0; Y += ext.Y ?? 0; N += ext.N ?? 0; K += ext.K ?? 0; }   // K: a roll moment (the keel on the bottom: src/boat/ground.js)
    s.ext = ext;
    if (c.pivot) N += c.pivot;   // a game aid's turning moment (N·m, + = to starboard): v2's FREE manoeuvre while it backs the sails (v2/ui/assist.js); 0 or absent: none
    const sea = env.sea ? env.sea() : null;
    const waveX = sea ? -P.mass * G * (sea.slopeX ?? 0) * P.surfFK : 0;
    X += waveX;
    // 8. weather helm from the heeled hull; yaw damping
    N -= P.hull.yawHeel * sphi * s.u * Math.abs(s.u);
    N -= (P.yawDampLin + P.yawDampQuad * Math.abs(s.yawRate)) * s.yawRate;

    // 7. heel: righting arm and damping
    const disp = P.mass * G;
    const arm = rightingArm(phi, P);
    const cRoll = 2 * P.rollDamp * Math.sqrt(disp * P.gm * P.ixx);
    K -= disp * arm + cRoll * this.p;
    if (rigWet > 0) {   // knockdown: the rig in the water damps the roll and drags the boat
      K -= KD_.rigRoll * rigWet * this.p * Math.abs(this.p);
      X -= 0.5 * RHO_W * KD_.rigCdA * rigWet * s.u * Math.abs(s.u);
    }
    if (P.knockdown) s.rigWet = rigWet;

    // integrate (semi-implicit Euler): velocities, then positions with the new velocities
    const m11 = P.mass * P.m11, m22 = P.mass * P.m22;
    const u0 = s.u, v0 = s.v, r0 = s.yawRate;
    s.u += (X + m22 * v0 * r0) / m11 * dt;
    s.v += (Y - m11 * u0 * r0) / m22 * dt;
    s.yawRate += N / P.izz * dt;
    this.p += K / P.ixx * dt;
    s.heel = clamp(s.heel + this.p * dt, -Math.PI / 2, Math.PI / 2);
    s.heading = wrap(s.heading + s.yawRate * dt);
    const sh = Math.sin(s.heading), ch = Math.cos(s.heading);
    const nx = s.u * sh + s.v * ch + cx, nz = -s.u * ch + s.v * sh + cz;
    s.x += nx * dt; s.z += nz * dt;
    this.t = t + dt;
    if (env.post) env.post(s, dt, t, this);   // the dock: the hull is kept out of a pier (src/boat/tackle.js); the bottom (src/boat/ground.js) takes `this` for the roll rate and the masses

    // waves: heave and pitch follow the surface at the centre (the floating itself is S3's)
    if (env.waveAt) { const wv = env.waveAt(s.x, s.z, t); s.heave = wv.y; s.pitch = -(wv.nx * sh - wv.nz * ch); }

    // outputs
    const tws = Math.hypot(w.vx, w.vz);
    s.trueWind = { speed: tws, angle: wrap(Math.atan2(-w.vx, w.vz) - s.heading) };
    { const ax = w.vx - nx, az = w.vz - nz; s.apparentWind = { speed: Math.hypot(ax, az), angle: wrap(Math.atan2(-ax, az) - s.heading) }; }
    s.sog = Math.hypot(nx, nz); s.cog = Math.atan2(nx, -nz);
    s.leeway = Math.abs(s.u) > 0.05 ? Math.atan2(s.v, s.u) : 0;
    s.mainFill = mf.fill; s.jibFill = jf.fill * (1 - shade); s.mainAoA = mf.aoa; s.jibAoA = jf.aoa;
    if (gkOut) { s.gk = gkOut; if (jibRolled > 0) s.jibFill += (1 - s.jibFill) * jibRolled; }   // the rolled jib neither luffs nor stalls
    s.jibBacked = jf.backed && Math.abs(jA.A) < 100 * DEG;       // abaft the beam a windward jib is wing-on-wing, not backed
    s.mainDraft = s.jibDraft = power;
    s.flatten = flatten; s.reef = reef; s.reefing = this.reefPos; s.mainSheet = mainSheet; s.jibSheet = jibSheet;
    s.drive = sailX; s.side = sailY; s.heelMoment = sailK;
    // for the hand on the sheets: the sheet the crew would set now, and how far past the stall each sail is
    // (0 attached … 1 fully stalled, 15–25° of attack; a backed sail is not a stall)
    s.crewSheet = this.auto.main0 ?? this.auto.main;
    // the waves' surge (N, + forward) and the hull's resistance at this speed, for the surf cue and the tests
    s.waveSurge = waveX; s.hullRes = hullResistance(s.u, phi, P);
    s.slamVel = sea?.bowRelVel ?? 0;
    // the main's best angle of attack it can reach for this apparent wind (the auto-trim table's most drive, with the
    // sheet inside its range: downwind the boom on the shrouds caps it), for the groove
    s.mainAoABest = Math.abs(mA.A) - clamp(Math.abs(mA.A) - tableAt(this.trim.main, mA.A), P.main.minDeg * DEG, P.main.maxDeg * DEG);
    s.mainStall = mf.backed ? 0 : smooth(SAIL_STALL, SAIL_STALL + 10 * DEG, mf.aoa);
    s.jibStall = jf.backed ? 0 : smooth(SAIL_STALL, SAIL_STALL + 10 * DEG, jf.aoa) * (1 - shade) * (1 - jibRolled);
    // the thrill cues and the groove, from the state just made (src/boat/thrill.js, src/boat/groove.js)
    s.surf = this.cues.surf.update(dt, s);
    s.rail = railCue(s);
    s.roundUp = this.cues.round.update(dt, s).level;
    s.slam = slamLevel(s.slamVel, s.u);
    s.grooveScore = grooveScore(s, this.vessel.polar).score;
    const gl = this.cues.groove.update(dt, s.grooveScore);
    s.groove = gl.level; s.grooveHeld = gl.held;
    // ---- pro: the controls in use and the bands (the cloth's twist and luff by height, the telltales, the sound) ----
    s.traveller = trav; s.twist = clamp(c.twist ?? 0, -1, 1); s.backstay = flatten; s.jibLead = jl;
    s.mainTwistX = twistX / DEG; s.jibTwistX = jibTwistX / DEG;   // degrees of twist past the neutral (MAIN_TWIST_DEG, JIB_TWIST_DEG)
    s.mainLowFill = mf.low.fill; s.mainTopFill = mf.top.fill; s.mainLowAoA = mf.low.aoa; s.mainTopAoA = mf.top.aoa;
    s.jibLowFill = jf.low.fill * (1 - shade); s.jibTopFill = jf.top.fill * (1 - shade); s.jibLowAoA = jf.low.aoa; s.jibTopAoA = jf.top.aoa;
    // ---- end pro ----
    s.engineOn = eng.on; s.engineState = eng.state; s.engineRpm = eng.rpm; s.engineGear = eng.gear ?? 0; s.throttle = eng.lever;
    s.thrust = prop.thrust; s.propWalk = prop.walk; s.propWash = prop.wash; s.furl = this.furlPos;
    // furled sails neither luff nor stall: the cues (the hints, the telltales, the sound) read them as quiet
    if (this.furlPos > 0) {
      const f = this.furlPos, q = (x) => x + (1 - x) * f;
      s.mainFill = q(s.mainFill); s.jibFill = q(s.jibFill); s.mainStall *= 1 - f; s.jibStall *= 1 - f;
      s.mainLowFill = q(s.mainLowFill); s.mainTopFill = q(s.mainTopFill); s.jibLowFill = q(s.jibLowFill); s.jibTopFill = q(s.jibTopFill);
    }
    return s;
  }
}

// a steady wind from a compass direction (FROM, degrees), m/s: { windAt } for env
export function steadyWind(speedMs, fromDeg = 0) {
  const vx = -Math.sin(fromDeg * DEG) * speedMs, vz = Math.cos(fromDeg * DEG) * speedMs;
  return (x, z, t) => ({ vx, vz });
}

// The helm's sense: +1 ahead; making sternway with no thrust ahead (the prop astern or stopped) the water reaches the
// rudder from astern and the helm works the other way (the stern goes where the blade's trailing edge points), so a helmsman,
// or the pilot, reverses the wheel: −1 from 0.5 m/s of sternway, blended from 0.1 m/s. Thrust ahead keeps +1: the
// slipstream reaches the rudder from ahead even while she still has sternway (fix/sim-astern-rudder).
export function helmSense(s) {
  if ((s.thrust ?? 0) > 0) return 1;
  return 1 - 2 * smooth(0.1, 0.5, -(s.u ?? 0));
}

// A helmsman for tests, the polar and an autopilot: PID on the heading, or on a true wind angle (held against the
// mean wind direction given). On a wind angle it foots (bears away up to 8°) while the boat is slower than its recent
// speed, as a sailor builds speed after a tack. Returns the rudder command, −1..1.
export class Helm {
  // rudderMaxDeg: the boat's rudder stop (its params.rudder.maxDeg; this page's boat by default)
  constructor({ kp = 1.6, ki = 0.25, kd = 3.0, limit = 1, foot = 8, rudderMaxDeg = BOAT.rudder.maxDeg } = {}) {
    this.kp = kp; this.ki = ki; this.kd = kd; this.limit = limit; this.foot = foot * DEG; this.i = 0; this.uRef = null; this.rudderMaxDeg = rudderMaxDeg;
  }
  // target heading (rad); s the boat state
  toHeading(s, target, dt = DT) {
    const e = wrap(target - s.heading) / DEG;                        // degrees
    this.i = clamp(this.i + e * dt, -40, 40);
    const deg = this.kp * e + this.ki * this.i - this.kd * s.yawRate / DEG;
    return clamp(helmSense(s) * deg / this.rudderMaxDeg, -this.limit, this.limit);
  }
  // hold a true wind angle (rad, + = wind from starboard) for a wind FROM windFromRad
  toTWA(s, twa, windFromRad, dt = DT) {
    if (this.uRef === null) this.uRef = s.u;
    this.uRef = Math.max(s.u, this.uRef + (s.u - this.uRef) * (dt / 20));   // up at once, down over ≈20 s
    const slow = this.uRef > 0.5 ? clamp((0.9 * this.uRef - s.u) / (0.4 * this.uRef), 0, 1) : 0;
    return this.toHeading(s, wrap(windFromRad - twa - sgn(twa) * this.foot * slow), dt);
  }
}

// Sail at a fixed true wind angle until steady; mean of the last `avg` seconds. For the polar and the tests.
export function steadyState({ twsKn, twaDeg, seconds = 150, avg = 30, controls = {}, params, speedKn } = {}) {
  const windAt = steadyWind(twsKn * KN, 0);
  const twa = twaDeg * DEG;
  const boat = new BoatPhysics({ heading: wrap(-twa), speed: (speedKn ?? Math.min(5, twsKn * 0.5)) * KN, params });
  const helm = new Helm();
  const env = { windAt, t: 0 };
  const sum = { u: 0, heel: 0, leeway: 0, rudder: 0, awa: 0, aws: 0, vmg: 0 };
  const n = Math.round(seconds / DT), nAvg = Math.round(avg / DT);
  for (let i = 0; i < n; i++) {
    env.t = i * DT;
    const ctl = { ...CONTROLS, ...controls, rudder: helm.toTWA(boat.state, twa, 0) };
    const st = boat.step(DT, ctl, env);
    if (i >= n - nAvg) {
      sum.u += st.u; sum.heel += st.heel; sum.leeway += st.leeway; sum.rudder += st.rudderAngle;
      sum.awa += st.apparentWind.angle; sum.aws += st.apparentWind.speed;
    }
  }
  const k = 1 / nAvg, u = sum.u * k;
  return {
    twsKn, twaDeg, kn: u / KN, heelDeg: Math.abs(sum.heel * k) / DEG, leewayDeg: Math.abs(sum.leeway * k) / DEG,
    rudderDeg: sum.rudder * k / DEG, awaDeg: Math.abs(sum.awa * k) / DEG, awsKn: sum.aws * k / KN,
    vmgKn: u * Math.cos(twa) / KN, state: boat.state,
  };
}

// the boat's pose and motion: the numbers that must stay finite (fix/ios-start)
const CORE_KEYS = ['x', 'z', 'heading', 'u', 'v', 'yawRate', 'heel', 'pitch', 'heave', 'sog', 'cog'];
export function stateFinite(s) { for (const k of CORE_KEYS) if (k in s && !Number.isFinite(s[k])) return false; return true; }
// a shallow copy of the numbers, one level into nested objects (the winds); flags and strings ride along
function copyFinite(s, out) {
  for (const k in s) { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { const o = out[k] && typeof out[k] === 'object' ? out[k] : (out[k] = {}); for (const j in v) o[j] = v[j]; } else out[k] = v; }
  return out;
}
function restoreState(s, good) {
  for (const k in good) { const v = good[k]; if (v && typeof v === 'object' && !Array.isArray(v) && s[k] && typeof s[k] === 'object') Object.assign(s[k], v); else s[k] = v; }
}
