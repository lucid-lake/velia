// Play as Tessie, the Breach (the Tessie RPG, phase 5, the finisher; behind ?tessierpg=1). Pure: no DOM, no clock, no Math.random.
// Hold the slot (key 5, or a press held on the slot): she dives to BREACH.runNose and runs at the target (the boat in her lock's ±35° cone
// within BREACH.rangeM: the locked one first, else the nearest); on the release (best when the corners turn amber: the arc lands on
// it from there), held on to the spot itself, or after BREACH.runM of run she comes up and launches: the play breach's arc (sim/tessie.js breach(), the roll in the air of the
// free breach, R2) over BREACH.arc (1.6 s), her front 9 m falling across the near rail. A fall within the rank's landing window of the hull
// (sim/tessieHits.js fall()'s footprint) knocks it down; a fall beside it (within BREACH.besideM) is a wave that heels it to
// BREACH.heelDeg (rank 4: a boat already heeled past the Tail Surge's SURGE.overDeg goes over). Never on a kayak: run at one and she
// lands BREACH.kayakOffM off it, a splash only. From HIDDEN the dive is shallow: a boat over water under BREACH.hiddenWaterM cannot be
// reached. Her play clock runs at BREACH.slow.k for BREACH.slow.s (real) about the arc's apex (a dt scale on her own step; never in a
// race, never under ?slowbreach=0).
//   breachTarget(her { x, z, psi }, list, { lockId, hidden, depthAt }) → the target entry or null
//   breachSlowK(lunge, { race, off }) → the dt scale for her step now (1, or BREACH.slow.k about the apex)
//   breachLanding(fall { x, z, psi }, list) → the fall moved so its footprint keeps BREACH.kayakOffM off every kayak ({ ...fall, moved })
//   breachBeside(fall, list, row) → the boat the fall lands beside ({ id, kind, d, side, heelDeg, lean, knock }) or null
//   footDist(fall, b) → m from the fall's footprint (her front 9 m along psi) to the boat's hull
import { HITS, hullDist } from './tessieHits.js';
import { SURGE } from './tessieSurge.js';

const DEG = Math.PI / 180;
export const BREACH = Object.freeze({
  rangeM: 60, coneDeg: 35,        // the target: within 60 m in the lock's ±35° cone of her heading
  runM: 60,                       // m of run, then she launches anyway
  runNose: 6,                     // m: her nose's depth through the run (never deeper than the water allows)
  runV: 12,                       // m/s: her pace on the run
  climbV: 7,                      // m/s: the climb from the run's depth to the launch
  maxRunS: 8,                     // s: the run's longest (a boat she never closes on)
  atK: 0.65,                      // held on, she launches herself at this share of the release's reach (the spot: the end of her run)
  seeM: 25,                       // m: the run-up's dark shape and V: a boat this near sees it (about 2 s at her pace) and bears away; seen
                                  // before the launch, she is told no more of it (she lands where it was: behind it). A release when the
                                  // corners turn amber (about 27 m out) beats it
  hiddenWaterM: 20,               // m: from HIDDEN a boat over water shallower than this cannot be reached (the dive is shallow)
  kayakOffM: 4,                   // m: run at a kayak and she lands this far off its hull (a splash only)
  besideM: 12,                    // m: a fall this near the hull but outside the landing window is a wave beside it
  heelDeg: 35,                    // °: the beside-wave's heel
  roll: 70,                       // °: her roll in the air (the free breach's, R2)
  arc: Object.freeze({ up: 0.75, hang: 0.25, down: 0.6 }),   // s: the arc (1.6 s; the play breach's 1.1 / 0.35 / 0.9 s scaled)
  slow: Object.freeze({ k: 0.5, s: 0.8 }),                   // her play clock 0.5× for 0.8 s (real) about the apex
  activeS: 7,                     // s: the slot amber from the press (the run and the arc), then dim to the rank's cooldown
});
export const ARC_S = BREACH.arc.up + BREACH.arc.hang + BREACH.arc.down;   // 1.6 s
export const ARC_FALL_S = BREACH.arc.up + BREACH.arc.hang + BREACH.arc.down * 0.8;   // her front lands (sim/tessie.js 'fall')
export const APEX_S = BREACH.arc.up + BREACH.arc.hang / 2;
// her ranks: cooldown 60 → 52 → 45 → 40 s (from the press), landing window 3 → 4 → 5 → 6 m; rank 3+ spooks the kayaks within 30 m of the
// splash (20 m below it: sim/tessieHits.js spookM); rank 4's beside-wave knocks down a boat already heeled past SURGE.overDeg
const breachRank = (everyS, windowM, spookM, besideKnock) => Object.freeze({ everyS, windowM, spookM, besideKnock, activeS: BREACH.activeS, cooldownS: everyS - BREACH.activeS });
export const BREACH_RANKS = Object.freeze([null, breachRank(60, 3, HITS.spookM, false), breachRank(52, 4, HITS.spookM, false), breachRank(45, 5, 30, false), breachRank(40, 6, 30, true)]);

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TARGET = new Set(['sail', 'glass', 'halcyon', 'power', 'jetski', 'paddle', 'anchored', 'rival', 'kayak']);   // the lock's (a kayak: she lands off it)

export function breachTarget(her, list = [], { lockId = null, hidden = false, depthAt = null, K = BREACH } = {}) {
  if (!her) return null;
  let best = null, bd = Infinity;
  for (const b of list) {
    if (!TARGET.has(b.kind)) continue;
    const d = Math.hypot(b.x - her.x, b.z - her.z);
    if (!(d <= K.rangeM)) continue;
    if (Math.abs(wrap(Math.atan2(b.x - her.x, -(b.z - her.z)) - her.psi)) > K.coneDeg * DEG && d > (b.L ?? 8) * 0.6) continue;
    if (hidden && depthAt && !(depthAt(b.x, b.z) >= K.hiddenWaterM)) continue;   // from HIDDEN: never over shallow water
    const score = b.id === lockId ? -1 : d;   // the locked boat first
    if (score < bd) { bd = score; best = b; }
  }
  return best;
}

// the dt scale on her step: 0.5× through the window about the apex (her own clock: half of BREACH.slow.s, so 0.8 s real)
export function breachSlowK(L, { race = false, off = false, K = BREACH } = {}) {
  if (race || off || !L || L.kind !== 'skill' || L.phase !== 'breach') return 1;
  const half = K.slow.s * K.slow.k / 2;
  return Math.abs(L.t - APEX_S) <= half ? K.slow.k : 1;
}

export function footDist(f, b, footM = HITS.footM) {
  const fx = Math.sin(f.psi ?? 0), fz = -Math.cos(f.psi ?? 0);
  let d = Infinity;
  for (let k = 0; k <= 6; k++) { const u = (k / 6 - 0.5) * footM; d = Math.min(d, hullDist(f.x + fx * u, f.z + fz * u, b)); }
  return d;
}

export function breachLanding(f, list = [], { K = BREACH } = {}) {
  const out = { ...f, moved: 0 };
  for (let pass = 0; pass < 3; pass++) {
    let worst = null;
    for (const b of list) { if (b.kind !== 'kayak') continue; const d = footDist(out, b); if (d < K.kayakOffM - 1e-6 && (!worst || d < worst.d)) worst = { b, d }; }
    if (!worst) break;
    // out along her side (across her heading), away from the kayak, by what is missing
    const rx = Math.cos(out.psi ?? 0), rz = Math.sin(out.psi ?? 0), s = (out.x - worst.b.x) * rx + (out.z - worst.b.z) * rz >= 0 ? 1 : -1, push = K.kayakOffM - worst.d + 0.05;
    out.x += rx * s * push; out.z += rz * s * push; out.moved += push;
  }
  return out;
}

// +1 when she lies on the boat's port side (her wave heels it to starboard), -1 on its starboard side (as the Tail Surge's)
function awaySide(b, at) { const h = b.heading ?? 0; return (at.x - b.x) * Math.cos(h) + (at.z - b.z) * Math.sin(h) > 0 ? -1 : 1; }

export function breachBeside(f, list = [], row = BREACH_RANKS[1], { K = BREACH } = {}) {
  let best = null;
  for (const b of list) {
    if (!SURGE.heelKinds.includes(b.kind)) continue;
    const d = footDist(f, b);
    if (!(d <= K.besideM) || d <= row.windowM) continue;
    if (!best || d < best.d) best = { b, d };
  }
  if (!best) return null;
  const b = best.b, lean = Number.isFinite(b.heelDeg) ? b.heelDeg : 0;
  const knock = !!row.besideKnock && SURGE.knockKinds.includes(b.kind) && Math.abs(lean) > SURGE.overDeg;
  return { id: b.id, kind: b.kind, d: best.d, lean, heelDeg: K.heelDeg, side: knock ? (lean >= 0 ? 1 : -1) : awaySide(b, f), knock };
}
