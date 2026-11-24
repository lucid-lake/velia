// Sail's wind shifts by the player's experience (owner, 2026-11-17, after Emerald Bay's locals said its wind shifts all
// the time): gentle swings of the wind's direction, scaled to the profile, and now and then a bigger shift that arrives
// with a visible gust line on the water. Plain JS, no three.js. src/sim/wind.js calls it from its marked hooks (dirAt,
// sample, toTexture), so every effect that reads the wind (the water, the sails, the telltales, the vane, the sound, the
// kayakers, the planner) sees the same shift. While it is on it takes the place of the lake's own wander and the readable
// shifts (src/sim/wind-shifts.js); Cruise and Regatta switch it off (setProfile(null)) and keep their own wind.
//
// The model, at a point p and time t: s = t − (a + rag(c)) / V̄ is the time the air at p passed the origin's line (a the
// distance downwind, c across, V̄ the carrying speed, rag a ragged edge of ± RAG.m over RAG.acrossM), so every shift is a
// line across the wind that drifts downwind with the air: seen upwind on the water first, at the boat a minute later.
//   swing(s)  turning points at irregular times (half periods halfS: a swing's full period 30–90 s), each a peak in the profile's
//             band [lo, hi] (now and then a smaller one, or a dip that turns back short and swings out to the same side again),
//             joined by smoothsteps: smooth, never a sine you can predict
//   big(s)    events every few minutes (the gap QUIET_S after the last one), each a turn of the profile's [lo, hi] to one
//             side: rising over RISE_S, held HOLD_S, easing back over FALL_S; the new-sailor profile keeps only some
//   gust(s)   1 + gain at each big shift's front (a band of ≈ 2 GUST.sigmaS × V̄ across the water): the darker line that
//             brings it in, so the shift looks fair
// Pure and deterministic in (seed, profile, t): the knots come from a hash, built outward from s = 0 on first use.
//   new SailShifts({ seed, carryMs, profile })  .deg(x, z, t, baseDeg)  .gustMul(x, z, t, baseDeg)  .legacyW(t)  .setProfile(id, t)
//   .state() / SailShifts.fromState(state)

const DEG = Math.PI / 180;
// the profiles (owner, 2026-11-17): swing peaks (°), big shifts (°) and the share of the big events each one keeps
export const SHIFT_PROFILES = Object.freeze({
  new: Object.freeze({ swing: [2, 3], big: [6, 10], keep: 0.5 }),     // the new sailor: calm, the crew trims through it
  sail: Object.freeze({ swing: [5, 8], big: [15, 20], keep: 1 }),     // the default (an experienced sailor)
  race: Object.freeze({ swing: [8, 10], big: [18, 25], keep: 1 }),    // Pro and "I race": the lake's full shiftiness
});
export const SAIL_SHIFTS = Object.freeze({
  halfS: [15, 45],        // s between swing peaks (a full swing 30–90 s)
  smallP: 0.1,            // the share of smaller swings (0.4–1 × lo)
  sameP: 0.15,            // the share of dips: the turn back stops short, on the same side (0.1–0.35 × lo), and the wind swings out again
  riseS: 25, holdS: [40, 100], fallS: 45, quietS: [90, 240],   // a big shift's shape and the quiet after it (one every ≈ 5 min)
  gust: { gain: 0.22, sigmaS: 12, lead: 0.5 },   // the gust line at a big shift's front: + gain at the front's middle (lead × riseS in)
  rag: { m: 120, acrossM: 420 },                 // the front's ragged edge (m) and its scale across the wind
  blendS: 20,             // s: a profile change eases over this, so the wind never jumps
  minCarryMs: 3,
});

function hash(i, k, seed) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(k | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (u) => u * u * (3 - 2 * u);
const smoother = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));
import { lerp } from './core/math.js';
function n1(s, seed) { const i = Math.floor(s), f = s - i; return 2 * lerp(hash(i, 91, seed), hash(i + 1, 91, seed), fade(f)) - 1; }

// a lazily built sequence of items indexed by k ∈ ℤ, each made from its neighbour toward 0 (so random access is exact)
class Seq {
  constructor(make) { this.make = make; this.pos = []; this.neg = []; }
  get(k) {
    const arr = k >= 0 ? this.pos : this.neg, idx = k >= 0 ? k : -k - 1;
    while (arr.length <= idx) {
      const j = k >= 0 ? arr.length : -arr.length - 1;
      arr.push(this.make(j, j > 0 ? this.get(j - 1) : null, j < 0 ? this.get(j + 1) : null));
    }
    return arr[idx];
  }
}

export class SailShifts {
  constructor({ seed = 1, carryMs = 6, profile = 'sail', t = 0, opts = {} } = {}) {
    this.seed = (seed | 0) + 613;
    this.o = { ...SAIL_SHIFTS, ...opts };
    this.carry = Math.max(this.o.minCarryMs, carryMs);
    this.from = null; this.to = SHIFT_PROFILES[profile] ? profile : null; this.t0 = -Infinity;
    const o = this.o, sd = this.seed;
    // swing knots: { T (s), u (signed unit peak: ±1, or a smaller one), } built outward from k = 0 at s = 0
    // swing knots: { T (s), v (the peak: + a veer, − a back, in units of the band: |v| ≥ 1 maps into [lo, hi], a dip below 1 is ×
    // lo) }; the knots alternate maximum, minimum, so each one is a turning point; a dip (sameP) turns back short of the middle
    const s0 = hash(0, 5, sd) < 0.5 ? -1 : 1;
    this.knots = new Seq((k, prev, next) => {
      const dir = (k & 1 ? -1 : 1) * s0, u = hash(k, 1, sd), dip = u < o.sameP && hash(k - 1, 1, sd) >= o.sameP;   // never two dips in a row
      const v = dip ? -dir * lerp(0.1, 0.35, hash(k, 2, sd))           // a dip: the turn back stops on the same side
        : u >= o.sameP && u < o.sameP + o.smallP ? dir * lerp(0.4, 1, hash(k, 2, sd))          // a smaller swing
          : dir * (1 + hash(k, 3, sd));                                         // a swing in the band
      if (k === 0) return { T: 0, v };
      if (prev) return { T: prev.T + lerp(o.halfS[0], o.halfS[1], hash(k, 6, sd)), v };
      return { T: next.T - lerp(o.halfS[0], o.halfS[1], hash(k + 1, 6, sd)), v };
    });
    // big events: { t0, rise, hold, fall, sign, q (size 0..1 in the band), keepQ (0..1: kept when < the profile's keep) }
    this.events = new Seq((k, prev, next) => {
      const ev = (start) => ({ t0: start, hold: lerp(o.holdS[0], o.holdS[1], hash(k, 11, sd)), sign: hash(k, 12, sd) < 0.5 ? -1 : 1, q: hash(k, 13, sd), keepQ: hash(k, 14, sd) });
      if (k === 0) return ev(lerp(o.quietS[0], o.quietS[1], hash(0, 15, sd)));
      if (prev) { const e = ev(0); e.t0 = prev.t0 + o.riseS + prev.hold + o.fallS + lerp(o.quietS[0], o.quietS[1], hash(k, 15, sd)); return e; }
      const e = ev(0); e.t0 = next.t0 - (o.riseS + e.hold + o.fallS + lerp(o.quietS[0], o.quietS[1], hash(k + 1, 15, sd))); return e;
    });
    this.knotHint = 0; this.evHint = 0;
  }

  // the profile in force (id or null: off); a change eases over blendS from t
  // (now: no easing, the new profile whole at once: the page leaving Sail for Cruise or Regatta hands their own wind over at once)
  setProfile(id, t = 0, { now = false } = {}) {
    const to = SHIFT_PROFILES[id] ? id : null;
    if (to === this.to) return;
    if (now) { this.from = null; this.to = to; this.t0 = -Infinity; return; }
    this.from = this.weight(t) < 0.5 ? this.from : this.to; this.to = to; this.t0 = t;
  }
  get profile() { return this.to; }
  // the share of the lake's own shifts (the wander and the readable shifts) still in the wind at t: 1 with no profile, 0 with
  // one, between while a change to or from "off" eases
  legacyW(t) { const w = this.weight(t); return (this.from == null ? 1 - w : 0) + (this.to == null ? w : 0); }
  weight(t) { return Number.isFinite(this.t0) ? smoother((t - this.t0) / this.o.blendS) : 1; }

  // the largest turn either profile in force can give (the texture's direction bins)
  maxDeg() {
    let m = 0;
    for (const id of [this.from, this.to]) { const P = SHIFT_PROFILES[id]; if (P) m = Math.max(m, P.swing[1] + P.big[1]); }
    return m;
  }

  // s at a point: the time the air there crossed the origin's line, the front ragged across the wind
  sAt(x, z, t, ux, uz) {
    const a = x * ux + z * uz, c = -x * uz + z * ux;
    return t - (a + this.o.rag.m * this.ragAt(c)) / this.carry;
  }
  // the front's ragged offset (in units of rag.m) at c metres across the wind
  ragAt(c) { return n1(c / this.o.rag.acrossM, this.seed + 7); }

  // the knot index k with T_k ≤ s < T_{k+1}
  knotAt(s) {
    let k = this.knotHint;
    while (this.knots.get(k).T > s) k--;
    while (this.knots.get(k + 1).T <= s) k++;
    this.knotHint = k;
    return k;
  }
  swing(s, P) {
    const k = this.knotAt(s), a = this.knots.get(k), b = this.knots.get(k + 1);
    const pk = (n) => { const a = Math.abs(n.v); return Math.sign(n.v) * (a >= 1 ? lerp(P.swing[0], P.swing[1], a - 1) : a * P.swing[0]); };
    return lerp(pk(a), pk(b), fade((s - a.T) / (b.T - a.T)));
  }
  // the event index k with t0_k ≤ s < t0_{k+1}
  eventAt(s) {
    let k = this.evHint;
    while (this.events.get(k).t0 > s) k--;
    while (this.events.get(k + 1).t0 <= s) k++;
    this.evHint = k;
    return k;
  }
  // a big event's turn (°) and its shape 0..1 at s
  shape(e, s) {
    const o = this.o, u = s - e.t0;
    if (u <= 0) return 0;
    if (u < o.riseS) return smoother(u / o.riseS);
    if (u < o.riseS + e.hold) return 1;
    return 1 - smoother((u - o.riseS - e.hold) / o.fallS);
  }
  big(s, P) {
    const e = this.events.get(this.eventAt(s));
    if (e.keepQ >= P.keep) return 0;
    return e.sign * lerp(P.big[0], P.big[1], e.q) * this.shape(e, s);
  }
  gust(s, P) {
    const o = this.o, g = o.gust;
    let f = 0;
    const k = this.eventAt(s);
    for (const j of [k, k + 1]) {   // the next event's front may already be within reach
      const e = this.events.get(j);
      if (e.keepQ >= P.keep) continue;
      const d = (s - (e.t0 + g.lead * o.riseS)) / g.sigmaS;
      f += g.gain * Math.min(1, lerp(P.big[0], P.big[1], e.q) / 18) * Math.exp(-d * d);
    }
    return f;
  }

  // the turn (°, + veered) at s, the profiles blended
  degAtS(s, t) {
    const w = this.weight(t), A = SHIFT_PROFILES[this.from], B = SHIFT_PROFILES[this.to];
    const one = (P) => (P ? this.swing(s, P) + this.big(s, P) : 0);
    return w >= 1 ? one(B) : (1 - w) * one(A) + w * one(B);
  }
  gustAtS(s, t) {
    const w = this.weight(t), A = SHIFT_PROFILES[this.from], B = SHIFT_PROFILES[this.to];
    const one = (P) => (P ? this.gust(s, P) : 0);
    return 1 + (w >= 1 ? one(B) : (1 - w) * one(A) + w * one(B));
  }

  // at a point: base direction baseDeg (the carrying axis)
  deg(x, z, t, baseDeg) {
    const d = baseDeg * DEG;
    return this.degAtS(this.sAt(x, z, t, -Math.sin(d), Math.cos(d)), t);
  }
  gustMul(x, z, t, baseDeg) {
    const d = baseDeg * DEG;
    return this.gustAtS(this.sAt(x, z, t, -Math.sin(d), Math.cos(d)), t);
  }

  // the state the wind's worker needs (plain data) and a copy made from it
  state() { return { seed: this.seed - 613, carry: this.carry, from: this.from, to: this.to, t0: Number.isFinite(this.t0) ? this.t0 : null, opts: this.o }; }
  static fromState(s) {
    const S = new SailShifts({ seed: s.seed, carryMs: s.carry, profile: s.to, opts: s.opts });
    S.from = s.from; S.t0 = s.t0 == null ? -Infinity : s.t0;
    return S;
  }
}
