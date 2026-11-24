// "The groove" (owner, 2026-10-29): when the trim and the course are near the best for the conditions, the boat locks
// in. grooveScore(state) is 0–1 from real quantities only, so the reward is the physics' own: at the best angle of
// attack the sails give the most drive, at the best VMG angle the boat makes the most ground, so the boat in the groove
// IS faster; nothing here changes the physics. Plain JS: the physics stamps it on its state (state.grooveScore,
// state.groove, state.grooveHeld: src/boat.js), the sound, the telltales, the instrument pod and the hints read it.
//
// Three factors, multiplied:
//   trim   the main's angle of attack against its best for this apparent wind (src/boat.js's auto-trim table: the
//          angle with the most drive), a Gaussian of σ = GROOVE.aoaSigmaDeg; × the main's fill (a luffing main is out)
//   course on the wind (TWA within ≈ 6–16° of the best-VMG angle) the VMG over the polar's best VMG at this wind; deep
//          downwind the same against the best downwind VMG; on a reach between, the speed over the polar's speed at
//          this angle (a reach to a mark has no VMG to chase). The polar is this boat's own (its profile's polar,
//          src/vessels/<id>.json; tools/groove_polar.mjs writes it). smooth from GROOVE.course[0] to [1] of the ratio.
//   heel   1 inside the band, falling from GROOVE.heel[0] to 0 at [1] (a C28 sails fastest at ≈ 12–20°; past 25° the
//          rail drags and the helm loads up)
// Lock-in (GrooveLock): the score smoothed over 1 s; in at GROOVE.in held for GROOVE.inS, out under GROOVE.out; held
// counts the seconds locked in (the soft musical swell asks for 8 s, src/audio.js).
import { CURRENT_VESSEL } from '../vessels/current.js';
import { clamp } from '../core/math.js';
// polar: { tws (kn), twa (°), kn (rows by tws) }, a boat profile's (this page's boat by default)
const POLAR = CURRENT_VESSEL.polar;

const DEG = Math.PI / 180, KN = 0.514444;
import { smooth } from '../core/math.js';

export const GROOVE = { aoaSigmaDeg: 4, course: [0.86, 0.97], heel: [22, 30], tau: 1, in: 0.75, inS: 1.5, out: 0.55 };

// the polar's speed (kn) at a true wind speed (kn) and angle (°, 0–180), bilinear in the table
function idx(xs, x) {
  const v = clamp(x, xs[0], xs[xs.length - 1]);
  let i = 0;
  while (i < xs.length - 2 && xs[i + 1] < v) i++;
  return [i, (v - xs[i]) / (xs[i + 1] - xs[i])];
}
export function polarKn(twsKn, twaDeg, polar = POLAR) {
  const POLAR_TWS = polar.tws, POLAR_KN = polar.kn;
  const [i, fi] = idx(POLAR_TWS, twsKn), [j, fj] = idx(polar.twa, Math.abs(twaDeg));
  const a = POLAR_KN[i][j] + (POLAR_KN[i][j + 1] - POLAR_KN[i][j]) * fj;
  const b = POLAR_KN[i + 1][j] + (POLAR_KN[i + 1][j + 1] - POLAR_KN[i + 1][j]) * fj;
  // below the table's lightest wind the speed scales with the wind
  const lo = twsKn < POLAR_TWS[0] ? Math.max(0, twsKn) / POLAR_TWS[0] : 1;
  return (a + (b - a) * fi) * lo;
}
// the best VMG (kn, > 0) and its angle (°) at a wind, upwind (TWA 30–90) or downwind (90–180), in 1° steps; cached
// per 0.5 kn of wind, per polar
const bestCaches = new WeakMap();
export function bestVmg(twsKn, upwind, polar = POLAR) {
  const key = `${upwind ? 'u' : 'd'}${Math.round(twsKn * 2)}`;
  let bestCache = bestCaches.get(polar);
  if (!bestCache) bestCaches.set(polar, (bestCache = new Map()));
  let b = bestCache.get(key);
  if (!b) {
    const w = Math.round(twsKn * 2) / 2;
    b = { vmg: 0, twa: upwind ? 45 : 165 };
    for (let a = upwind ? 30 : 90; upwind ? a <= 90 : a <= 180; a++) {
      const v = polarKn(w, a, polar) * Math.cos(a * DEG) * (upwind ? 1 : -1);
      if (v > b.vmg) b = { vmg: v, twa: a };
    }
    bestCache.set(key, b);
  }
  return b;
}

// state: the physics STATE (src/boat.js); polar: the boat's. Returns { score, trim, course, heel, ratio }.
export function grooveScore(s, polar = POLAR) {
  const tws = (s.trueWind?.speed ?? 0) / KN, twa = Math.abs(s.trueWind?.angle ?? 0) / DEG, kn = (s.u ?? 0) / KN;
  if (tws < 2 || kn < 0.5) return { score: 0, trim: 0, course: 0, heel: 0, ratio: 0 };
  // trim: the main's angle of attack against its best (a backed or luffing main is out of the groove)
  const e = ((s.mainAoA ?? 0) - (s.mainAoABest ?? 0)) / DEG;
  const trim = Math.exp(-0.5 * (e / GROOVE.aoaSigmaDeg) ** 2) * smooth(0.5, 0.95, s.mainFill ?? 1);
  // course: VMG on the wind and deep downwind, target speed on a reach
  const up = bestVmg(tws, true, polar), dn = bestVmg(tws, false, polar);
  const wUp = 1 - smooth(up.twa + 6, up.twa + 16, twa), wDn = smooth(dn.twa - 25, dn.twa - 10, twa);
  const rUp = kn * Math.cos(twa * DEG) / Math.max(up.vmg, 0.1);
  const rDn = -kn * Math.cos(twa * DEG) / Math.max(dn.vmg, 0.1);
  const rReach = kn / Math.max(polarKn(tws, twa, polar), 0.1);
  const wReach = Math.max(0, 1 - wUp - wDn);
  const ratio = wUp * rUp + wDn * rDn + wReach * rReach;
  const course = smooth(GROOVE.course[0], GROOVE.course[1], ratio);
  const heel = 1 - smooth(GROOVE.heel[0], GROOVE.heel[1], Math.abs(s.heel ?? 0) / DEG);
  return { score: trim * course * heel, trim, course, heel, ratio };
}

// The lock-in: the score smoothed over GROOVE.tau; in once it stays over GROOVE.in for GROOVE.inS, out under
// GROOVE.out. update(dt, score) → { level 0–1 (the smoothed score while locked in, else 0), locked, held (s) }.
export class GrooveLock {
  constructor() { this.v = 0; this.above = 0; this.locked = false; this.held = 0; }
  update(dt, score) {
    this.v += (score - this.v) * (1 - Math.exp(-dt / GROOVE.tau));
    this.above = this.v >= GROOVE.in ? this.above + dt : 0;
    if (!this.locked && this.above >= GROOVE.inS) this.locked = true;
    else if (this.locked && this.v < GROOVE.out) this.locked = false;
    this.held = this.locked ? this.held + dt : 0;
    return { level: this.locked ? smooth(GROOVE.out, GROOVE.in + 0.1, this.v) : 0, locked: this.locked, held: this.held };
  }
}
