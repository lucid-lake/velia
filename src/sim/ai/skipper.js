// The AI skipper: one module that sails a boat through exactly the controls a player has.
// It writes only `rudder`, `sheet`, `traveller`, `twist`, `backstay`, `jibLead` and `jibSide` of the controls object
// BoatPhysics.step reads. It reads only what a sailor reads: the boat state, the wind on the water ahead (windAt: the
// dark patches), a `clear(heading, seconds)` question to the chart, the traffic. Plain JS, no DOM, deterministic
// (a seeded RNG; the same seed and the same world give the same track). Cruise uses it at skill 1; Regatta's computer
// boats will use it at 0.2 to 1.
//
//   const sk = new AISkipper({ skill: 1, seed: 7, windAt, clear });
//   sk.update(dt, phys.state, ctl, { t, waypoint: [x, z] });      // every frame; or { route: [[x, z], ...] }
//
// Frames as src/boat.js: x east, z south, heading rad clockwise from north; TWA + = wind from starboard.
import { Helm, KN, boatParams } from '../boat.js';
import { CURRENT_VESSEL } from '../vessels/current.js';
import { ShiftTrend } from '../wind-shifts.js';

const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;
import { clampT as clamp } from '../core/math.js';
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const sgn = (x) => (x < 0 ? -1 : 1);
import { smooth } from '../core/math.js';
import { lerp } from '../core/math.js';

function makeRng(seed) {   // mulberry32
  let a = (seed | 0) + 0x6d2b79f5;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- the polar ------------------------------------------------------------------------------------------------------
// steady boat speed (kn) at a true wind speed (m/s at 10 m) and angle (deg), from the boat's polar (its profile's:
// { tws, twa, kn }; this page's boat by default; a skipper sails its own boat's, AISkipper({ vessel }))
const idx = (arr, v) => { if (v <= arr[0]) return [0, 0]; for (let i = 1; i < arr.length; i++) if (v <= arr[i]) return [i - 1, (v - arr[i - 1]) / (arr[i] - arr[i - 1])]; return [arr.length - 2, 1]; };
export function polarKn(twsMs, twaDeg, polar = CURRENT_VESSEL.polar) {
  const POLAR_TWS = polar.tws, POLAR_TWA = polar.twa, POLAR_KN = polar.kn;
  const [i, fi] = idx(POLAR_TWS, clamp(twsMs / KN, POLAR_TWS[0], POLAR_TWS.at(-1)));
  const [j, fj] = idx(POLAR_TWA, clamp(Math.abs(twaDeg), POLAR_TWA[0], 180));
  const r = (k) => lerp(POLAR_KN[k][j], POLAR_KN[k][j + 1], fj);
  return lerp(r(i), r(i + 1), fi);
}
// the angles with the best VMG: { up: { twa, vmg, kn }, down: { ... } } for a true wind speed (m/s)
const targetCaches = new WeakMap();
export function polarTargets(twsMs, polar = CURRENT_VESSEL.polar) {
  const key = Math.round(twsMs / KN * 4);
  let targetCache = targetCaches.get(polar);
  if (!targetCache) targetCaches.set(polar, (targetCache = new Map()));
  let r = targetCache.get(key);
  if (r) return r;
  const best = (lo, hi, sign) => {
    let b = null;
    for (let a = lo; a <= hi; a += 0.5) { const kn = polarKn(twsMs, a, polar), v = sign * kn * Math.cos(a * DEG); if (!b || v > b.vmg) b = { twa: a, vmg: v, kn }; }
    return b;
  };
  r = { up: best(30, 70, 1), down: best(110, 180, -1) };
  targetCache.set(key, r);
  return r;
}

// ---- skill ----------------------------------------------------------------------------------------------------------
// 1 = a pro, 0 = a beginner; every error scales with (1 − skill)
function skillParams(skill) {
  const e = 1 - clamp(skill, 0, 1);
  return {
    lagS: 1 + 9 * e,            // perception: the wind direction's low-pass
    steerSigma: 7 * DEG * e,   // steering noise
    steerTau: 3,
    trimSigma: 8 * DEG * e,      // slow trim wander
    trimBias: 12 * DEG * e,
    pointing: 14 * DEG * e,       // sails this much freer than the best angle upwind
    headerDeg: 5 + 7 * e,        // tack on a header past this
    boardS: 30 + 25 * e,         // the least time on a board
    overstandDeg: 8 * e,         // tacks this far past the layline
    corridor: 1 + 1.2 * e,       // the corridor's width factor
    rate: 0.5 + 0.7 * (1 - e),   // traveller, twist, backstay: units per second (a grinder's hand, not a key's 0.5)
    heelTarget: (17 + 6 * e) * DEG,
    gustRange: 60 + 140 * (1 - e),
  };
}

// ---- the AI skipper ------------------------------------------------------------------------------------------------
export class AISkipper {
  // windAt(x, z, t) → { vx, vz } (the wind on the water, as env.windAt); clear(headingRad, seconds, state) → bool
  // (is that heading clear of the shore, the depth, the traffic for that long?); arriveM: a route's waypoint radius
  // vessel: the boat it sails (its profile: the polar, the rudder's stop; this page's boat by default)
  constructor({ skill = 1, seed = 1, windAt = null, clear = null, arriveM = 40, vessel = CURRENT_VESSEL } = {}) {
    this.skill = clamp(skill, 0, 1); this.k = skillParams(this.skill);
    this.vessel = vessel; this.polar = vessel.polar;
    this.rng = makeRng(seed); this.windAt = windAt; this.clear = clear; this.arriveM = arriveM;
    this.helm = new Helm({ rudderMaxDeg: boatParams(vessel).rudder.maxDeg });
    this.trend = new ShiftTrend({ shortS: 6 + 12 * (1 - this.skill) });
    this.side = 0;                                 // the board: + wind from starboard
    this.man = null;                               // { type: 'tack' | 'gybe' | 'around', to, t0, rate }
    this.lastManT = -Infinity; this.footT = Infinity; this.manDoneT = -Infinity;
    this.twd = null; this.tws = 0; this.gust = { ratio: 1, inS: Infinity };
    this.steerNoise = 0; this.trimNoise = 0; this.trimBias = (this.rng() < 0.5 ? -1 : 1) * this.k.trimBias;
    this.heelF = 0; this.heelRate = 0; this.lastHeel = null;
    this.out = { sheet: null, traveller: 0, twist: 0, backstay: 0, jibLead: 0 };
    this.sheet = null;
    this.leg = 0; this.legKey = null; this.legFrom = null; this.irons = 0; this.recover = null;
    this.rep = { mode: 'start', manoeuvre: null, targetTwa: 0, gustAhead: 1, trend: null, tacks: 0, gybes: 0 };
    this.tacks = 0; this.gybes = 0;
  }

  gauss() { const u = Math.max(1e-9, this.rng()), v = this.rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

  // ---- perception: the wind it can sense, with a lag, and the gusts it can see ahead ----
  perceive(dt, s, t) {
    const from = wrap(s.heading + s.trueWind.angle), tws = s.trueWind.speed;
    const kk = this.twd === null ? 1 : 1 - Math.exp(-dt / this.k.lagS);
    if (this.twd === null) this.twdV = [Math.sin(from), -Math.cos(from)];
    this.twdV[0] += (Math.sin(from) - this.twdV[0]) * kk; this.twdV[1] += (-Math.cos(from) - this.twdV[1]) * kk;
    this.twd = Math.atan2(this.twdV[0], -this.twdV[1]);
    this.tws += (tws - this.tws) * (this.twd === null ? 1 : 1 - Math.exp(-dt / 2)); if (this.tws === 0) this.tws = tws;
    this.trendNow = this.trend.update(dt, from / DEG, s.trueWind.angle);
    // gusts on the water ahead: samples upwind from 25 m out to the range, on three lines
    let ratio = 1, inS = Infinity;
    if (this.windAt && tws > 1) {
      const ux = Math.sin(from), uz = -Math.cos(from), px = -uz, pz = ux, v = Math.max(tws + s.u, 1);
      for (let d = 25; d <= this.k.gustRange; d += 25) for (const o of [-20, 0, 20]) {
        const w = this.windAt(s.x + ux * d + px * o, s.z + uz * d + pz * o, t), r = Math.hypot(w.vx, w.vz) / tws;
        if (r > ratio) { ratio = r; inS = d / v; }
      }
    }
    this.gust = { ratio, inS };
  }

  // ---- tactics: where to steer ----
  // the course: { heading, mode: 'beat' | 'reach' | 'run', side, A (target TWA, rad) }
  course(dt, s, t, ctx) {
    const k = this.k, tg = polarTargets(this.tws, this.polar), twd = this.twd;
    const wp = ctx.waypoint ?? this.routeWaypoint(s);
    const here = [s.x, s.z];
    if (ctx.legKey !== undefined ? ctx.legKey !== this.legKey : (!this.legFrom || Math.hypot(wp[0] - this.wpPrev[0], wp[1] - this.wpPrev[1]) > 60)) { this.legFrom = here; this.legKey = ctx.legKey; }
    this.wpPrev = wp;
    const brg = Math.atan2(wp[0] - s.x, -(wp[1] - s.z)), dist = Math.hypot(wp[0] - s.x, wp[1] - s.z);
    const upA = (tg.up.twa) * DEG + k.pointing, dnA = tg.down.twa * DEG;
    const rel = Math.abs(wrap(brg - twd));
    const mode = rel < upA ? 'beat' : rel > dnA ? 'run' : 'reach';
    const curSide = this.side || sgn(s.trueWind.angle);
    if (!this.side) this.side = curSide;
    if (mode === 'reach') return { heading: brg, mode, side: sgn(wrap(twd - brg)), A: Math.abs(wrap(twd - brg)), dist };
    const A = mode === 'beat' ? upA : dnA;
    const h = (side) => wrap(twd - side * A);
    const hc = h(this.side), ho = h(-this.side);
    let want = this.side, why = null;
    const okC = !this.clear || this.clear(hc, 20, s), okO = !this.clear || this.clear(ho, 20, s);
    const since = t - this.lastManT, boardS = k.boardS;
    if (!okC && okO && since > 8) { want = -this.side; why = 'hazard'; }
    else if (okC && okO && since > boardS && dist > 90) {
      // the layline: the other board lays the mark (the mark is no longer inside the wedge from here)
      const so = sgn(wrap(hc - ho)), lay = wrap(brg - ho) * so;
      if (lay <= -k.overstandDeg * DEG - (mode === 'beat' ? 1.5 * DEG : 0)) { want = -this.side; why = 'layline'; }
      // the corridor round the rhumb line
      const L = Math.hypot(wp[0] - this.legFrom[0], wp[1] - this.legFrom[1]) || 1;
      const ex = (wp[0] - this.legFrom[0]) / L, ez = (wp[1] - this.legFrom[1]) / L;
      const xt = (s.x - this.legFrom[0]) * -ez + (s.z - this.legFrom[1]) * ex;   // + to the right of the leg's direction
      const corridor = clamp(0.12 * L, 90, 240) * k.corridor;
      const hx = Math.sin(hc) * -ez + -Math.cos(hc) * ex;   // the board's cross-track component
      if (!why && Math.abs(xt) > corridor && sgn(hx) === sgn(xt) && Math.abs(hx) > 0.3) { want = -this.side; why = 'corridor'; }
      // a header: the trend against the long mean, and the other board points closer to the mark
      const tr = this.trendNow;
      if (!why && mode === 'beat' && tr && tr.kind === 'header' && -tr.signed >= k.headerDeg && Math.abs(wrap(brg - ho)) + 4 * DEG < Math.abs(wrap(brg - hc))) { want = -this.side; why = 'header'; }
      // downwind: the other gybe is clearly better towards the mark
      if (!why && mode === 'run') {
        const sc = (hh, a) => polarKn(this.tws, Math.abs(wrap(twd - hh)) / DEG, this.polar) * Math.cos(wrap(brg - hh));
        if (sc(ho, 0) > sc(hc, 0) * (1.03 + 0.1 * (1 - this.skill))) { want = -this.side; why = 'shift'; }
      }
    }
    return { heading: h(want), mode, side: want, A, dist, why, flip: want !== this.side };
  }

  routeWaypoint(s) {
    const r = this.route;
    if (!r?.length) return [s.x, s.z - 1000];
    let p = r[this.leg % r.length];
    p = p.at ?? p;
    if (Math.hypot(p[0] - s.x, p[1] - s.z) < this.arriveM) { this.leg++; p = r[this.leg % r.length]; p = p.at ?? p; }
    return p;
  }

  // Regatta's interfaces, stubbed: the start, mark rounding and covering
  // The start: given the line (src/race/line.js makeLine), the wind it perceives, its own state and the race
  // clock, where to sail. Returns { phase: 'hold' | 'run' | 'dip', waypoint: [x, z], crossAt: [x, z], etaS } or null with no line.
  // Hold station 40-80 m below the line; commit when the time on distance (a speed ramp with time constant `accelS`) says
  // it crosses `buffer` s after the gun (1.5 s at skill 1 to 6 s at 0.2); on starboard tack; dip back when over.
  startPlan({ line, state, clock, t = 0, windFrom, over = false, ocs = false, turnS = 16 } = {}) {
    if (!line) return null;
    const k = this.k, buffer = 1.5 + (6 - 1.5) * (1 - this.skill) / 0.8, f = this.twd ?? windFrom;
    const up = [Math.sin(f), -Math.cos(f)], dirv = line.dir, tws = (this.windAt ? Math.hypot(...Object.values(this.windAt(state.x, state.z, t))) : this.twd !== null && this.tws > 1 ? this.tws : state.trueWind?.speed) || 5, tg = polarTargets(tws);
    const sideOf = (x, z) => (x - line.centre[0]) * up[0] + (z - line.centre[1]) * up[1];
    const bias = (line.committee[0] - line.pin[0]) * up[0] + (line.committee[1] - line.pin[1]) * up[1];
    // the favoured end: the committee end on a tie; aim a quarter of the line in from it
    const a = (bias >= -0.5 ? 0.78 : 0.22);   // 0 at the pin, 1 at the committee boat
    const T = [line.pin[0] + (line.committee[0] - line.pin[0]) * a, line.pin[1] + (line.committee[1] - line.pin[1]) * a];
    if (clock >= 0 && (over || ocs)) this.startCommitted = false;
    if (over || ocs) return { phase: 'dip', waypoint: [T[0] - up[0] * 25, T[1] - up[1] * 25], crossAt: T, etaS: 0 };
    const alpha = (tg.up.twa + this.k.pointing / DEG) * DEG, dirOf = (h) => [Math.sin(h), -Math.cos(h)];
    const rayS = dirOf(wrap(f - alpha)), rayUp = rayS[0] * up[0] + rayS[1] * up[1];   // the starboard-tack close-hauled ray
    const d = -sideOf(state.x, state.z), tgo = buffer - clock;
    // closed loop on the clock: the time the close-hauled approach needs from here (the polar speed, ramped from the speed it
    // has now) against the time left; arriving early, reach along the line to burn it; arriving late, go
    const vp = Math.max(0.5, polarKn(tws, alpha / DEG, this.polar) * KN * (1 - 0.1 * (1 - this.skill))), vv = Math.max(Math.max(0, state.u ?? 0) * 0.8, vp * 0.85) * rayUp;
    const need = (d / vv + (this.startCommitted ? 0 : turnS));
    const hit = [state.x + rayS[0] * d / rayUp, state.z + rayS[1] * d / rayUp];
    const along = (x, z) => ((x - line.pin[0]) * dirv[0] + (z - line.pin[1]) * dirv[1]) / line.len;
    const frac = along(hit[0], hit[1]);
    if (this.startCommitted ? tgo <= need + 8 : (tgo <= need || d > 75)) {
      if (!this.startCommitted) { this.startCommitted = true; this.side = 1; }
      const aim = hit;   // the start counts anywhere along the line and its extension: sail the board, don't chase an end
      return { phase: 'run', waypoint: [aim[0] + up[0] * 400, aim[1] + up[1] * 400], crossAt: aim, etaS: need };
    }
    this.startCommitted = false;
    // hold: sail away down the reverse of the port-tack ray (a broad reach on the starboard gybe: the turn back up is a luff)
    const rayP = dirOf(wrap(f + alpha));
    return { phase: 'hold', waypoint: [T[0] - rayP[0] * 260, T[1] - rayP[1] * 260], crossAt: T, etaS: need };
  }
  setSkill(skill) { this.skill = clamp(skill, 0, 1); this.k = skillParams(this.skill); this.trend.shortS = 6 + 12 * (1 - this.skill); }
  // the mark to round next (src/marks/course.js CourseTracker.target()): { mark, at, rounding, leg, lap, route: [approach, outside, exit] }.
  // The caller hands the route to update() as ctx.route; null with no course (the sailing modes without marks)
  roundMark(tracker = this.course ?? null) { return tracker?.target?.() ?? null; }
  // Covering: when ahead and the player is on the other board, tack to sit between the player and the mark.
  // other: { x, z, side (+ wind from starboard), progressM }, me: { x, z, progressM }, t, markDist. Loose cover at skill >= 0.5,
  // tight (close aboard) at >= 0.8, never inside 3 lengths of a mark or within 40 s of the last cover. Returns { tack: true } or null.
  cover({ other, me, t, markDist = Infinity, beat = true } = {}) {
    if (!other || !me || !beat || this.skill < 0.5 || markDist < 26) return null;
    if (me.progressM <= other.progressM || t - (this.lastCoverT ?? -Infinity) < 40 || this.man) return null;
    if (other.side === this.side || !this.side) return null;
    const d = Math.hypot(other.x - me.x, other.z - me.z);
    if (d > (this.skill >= 0.8 ? 90 : 150) || d < 12) return null;
    this.lastCoverT = t;
    return { tack: true };
  }

  // ---- the tick ----
  // ctx: { t, waypoint: [x, z] | null, route: [[x, z]...] (when no waypoint), legKey, advice: { heading, side, closeHauled, evade, irons, jibSide } }
  // returns the report. Writes ctl.
  update(dt, s, ctl, ctx = {}) {
    const t = ctx.t ?? 0, k = this.k;
    if (ctx.route && ctx.route !== this.route) { this.route = ctx.route; this.leg = 0; }
    if (!(s.trueWind.speed > 0) && this.twd === null) { return this.rep; }
    this.perceive(dt, s, t);
    // noise, from the seeded RNG every tick
    const g1 = this.gauss(), g2 = this.gauss();
    this.steerNoise += (-this.steerNoise / k.steerTau) * dt + k.steerSigma * Math.sqrt(2 * dt / k.steerTau) * g1;
    this.trimNoise += (-this.trimNoise / 20) * dt + k.trimSigma * Math.sqrt(2 * dt / 20) * g2;
    if (this.lastHeel !== null) this.heelRate += ((Math.abs(s.heel) - this.lastHeel) / Math.max(dt, 1e-3) - this.heelRate) * (1 - Math.exp(-dt / 0.5));
    this.lastHeel = Math.abs(s.heel);
    this.heelF += (Math.abs(s.heel) - this.heelF) * (1 - Math.exp(-dt / 0.6));

    // the Navigator-style override: irons, and an evading planner (the skipper follows the planner's heading)
    const adv = ctx.advice ?? null;
    if (adv?.irons) { this.man = null; ctl.rudder = adv.rudder ?? 0; ctl.jibSide = adv.jibSide ?? 0; this.trim(dt, s, ctl); this.rep.mode = 'irons'; return this.rep; }
    ctl.jibSide = 0;
    if (this.irons >= 0 && !adv) this.checkIrons(dt, s, ctl);
    if (this.recover) { this.helmTo(dt, s, ctl, wrap(this.twd - this.recover * 70 * DEG)); ctl.jibSide = this.recover; this.trim(dt, s, ctl); this.rep.mode = 'irons'; return this.rep; }

    let c = this.course(dt, s, t, ctx);
    // the planner's word wins when its way is clear and ours is not, or when it evades
    if (adv && (adv.evade || (this.clear && !this.clear(c.heading, 20, s)))) {
      const a = adv.closeHauled ? wrap(this.twd - adv.side * (adv.chDeg ?? 44) * DEG) : adv.heading;
      c = { heading: a, mode: adv.mode ?? c.mode, side: adv.side ?? sgn(wrap(this.twd - a)), A: Math.abs(wrap(this.twd - a)), flip: adv.side != null && adv.side !== this.side && c.mode !== 'reach', round: !!adv.round, forced: true };
    }
    // a manoeuvre: tack through the wind, gybe through the run
    if (!this.man && c.flip && c.mode !== 'reach') this.startMan(s, t, c);
    else if (!this.man && c.side !== this.side && c.mode === 'reach') this.side = c.side;   // a reach: the board follows the heading
    let target = c.heading;
    if (this.man) target = this.manTarget(dt, s, t, c);
    else if (c.mode !== 'reach' || c.forced) target = wrap(c.heading + this.steerNoise);
    else target = wrap(c.heading + this.steerNoise);
    // after a tack: foot for speed, 4° fading over 8 s
    const sinceMan = t - this.manDoneT;
    if (!this.man && sinceMan < 8 && c.mode === 'beat') target = wrap(target - this.side * 4 * DEG * (1 - sinceMan / 8));
    this.helmTo(dt, s, ctl, target);
    this.trim(dt, s, ctl, c);
    Object.assign(this.rep, { mode: c.mode, manoeuvre: this.man?.type ?? null, targetTwa: c.A, gustAhead: this.gust.ratio, trend: this.trendNow?.kind ?? null, tacks: this.tacks, gybes: this.gybes, side: this.side, heading: c.heading, why: c.why ?? null });
    return this.rep;
  }

  helmTo(dt, s, ctl, target) { ctl.rudder = this.helm.toHeading(s, target, Math.max(dt, 1e-3)); }

  checkIrons(dt, s, ctl) {
    const twa = s.trueWind.angle;
    this.irons = Math.abs(twa) < 32 * DEG && s.u < 0.4 && this.tws > 1.5 ? this.irons + dt : 0;
    if (this.irons > 4) { this.recover = sgn(twa); this.irons = 0; this.recoverT = 0; }
    if (this.recover) { this.recoverT += dt; if ((Math.abs(twa) > 55 * DEG && s.u > 0.6) || this.recoverT > 40) this.recover = null; }
  }

  // ---- manoeuvres ----
  startMan(s, t, c) {
    const tack = c.mode === 'beat' || Math.abs(s.trueWind.angle) < Math.PI / 2;
    const to = c.side;
    // a tack needs way on; without it, wait (up to 20 s), then bear away round instead
    const need = this.tws < 4 * KN ? 1.4 : 2.0;
    this.waitT = (this.waitT ?? 0);
    if (c.round || (tack && s.u < need && c.forced)) this.man = { type: 'around', to, t0: t };   // the planner's word: no waiting for way
    else if (tack && s.u < need) {
      this.waitT += 1 / 60;
      if (this.waitT < 20) return;
      this.man = { type: 'around', to, t0: t };
    } else this.man = { type: tack ? 'tack' : 'gybe', to, t0: t };
    this.waitT = 0;
    this.helm.i = 0;
    this.lastManT = t;
    if (this.man.type === 'gybe') this.gybes++; else this.tacks++;
  }

  // the heading target in a manoeuvre: slewed from the boat's heading at a finite rate, through the wind (tack) or the run (gybe)
  manTarget(dt, s, t, c) {
    const m = this.man, final = wrap(this.twd - m.to * c.A);   // the heading on the board it is going to
    const rate = (m.type === 'gybe' ? 9 : m.type === 'around' ? 10 : 14) * DEG;
    m.h = m.h ?? s.heading;
    let d = wrap(final - m.h);
    if (m.type === 'around') {   // the long way, bearing away first
      const away = -sgn(s.trueWind.angle);
      if (Math.abs(d) > 1e-6 && sgn(d) !== away && Math.abs(wrap(this.twd - m.h)) < 150 * DEG) d = d + away * TAU;
    }
    m.h = wrap(m.h + clamp(d, -rate * dt, rate * dt));
    const twaNow = s.trueWind.angle, done = sgn(twaNow) === m.to && Math.abs(wrap(final - s.heading)) < 8 * DEG && Math.abs(d) < 8 * DEG;
    this.mSheetIn = m.type === 'gybe' && Math.abs(twaNow) > 135 * DEG;
    if (done || t - m.t0 > 25) {
      if (sgn(twaNow) === m.to || t - m.t0 > 25) { this.side = sgn(twaNow) === m.to ? m.to : this.side; this.manDoneT = t; this.man = null; this.mSheetIn = false; this.helm.i = 0; }
    }
    return m.h;
  }

  // ---- trim: the main by the crew's best sheet, depowered by the pro controls ----
  trim(dt, s, ctl, c = null) {
    const k = this.k, o = this.out;
    if (!(s.crewSheet > 0)) return;
    const heelEff0 = Math.max(this.heelF + 0.8 * Math.max(0, this.heelRate), 0);
    // a gust seen ahead: the heel it will bring (∝ V²), counted for the 6 s before it arrives
    const pre = this.gust.ratio > 1.08 && this.gust.inS < 6 ? this.heelF * this.gust.ratio * this.gust.ratio * 0.9 : 0;
    const heel = Math.max(heelEff0, pre) + (this.skill < 1 ? 0 : 0);
    const over = heel - k.heelTarget;
    const trav = -smooth(14 * DEG, 24 * DEG, heel), twist = smooth(16 * DEG, 27 * DEG, heel);
    const back = smooth(16 * DEG, 31 * DEG, heel) * 0.9 + 0.1 * smooth(10 * KN, 20 * KN, this.tws);
    const ease = 24 * DEG * smooth(25 * DEG, 33 * DEG, heel);
    const kn = this.tws / KN;
    const lead = clamp((kn - 10) / 12, -0.4, 0.7);
    const run = k.rate * dt;
    const to = (v, target, r = run) => v + clamp(target - v, -r, r);
    o.traveller = to(o.traveller, trav); o.twist = to(o.twist, twist); o.backstay = to(o.backstay, back); o.jibLead = to(o.jibLead, lead, 0.3 * dt);
    // the sheet: the crew's best, plus the trim error, plus the ease; a gybe sheets in across
    let want = s.crewSheet + this.trimBias + this.trimNoise + ease;
    if (this.mSheetIn) want = Math.min(want, 24 * DEG);
    want = clamp(want, 12 * DEG, 80 * DEG);
    if (this.sheet === null) this.sheet = want;
    const out = want > this.sheet, rate = out ? 25 * DEG : 14 * DEG;
    this.sheet += clamp(want - this.sheet, -rate * dt, rate * dt);
    o.sheet = this.sheet;
    ctl.sheet = o.sheet; ctl.traveller = o.traveller; ctl.twist = o.twist; ctl.backstay = o.backstay; ctl.jibLead = o.jibLead;
    ctl.autoTrim = true;
    this.over = over;
  }
}

// The Sail controls' start from the skipper's trim (Cruise → Sail hand-over): nothing jumps
export function handoverTrim(sk) { return { sheet: sk.out.sheet, traveller: sk.out.traveller, twist: sk.out.twist, backstay: sk.out.backstay, jibLead: sk.out.jibLead }; }
