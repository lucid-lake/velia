// The fleet's minds (BACKLOG-v2 #12 R4, § 10.4): v1's computer skipper (src/sim/race/rival.js Rival: an AISkipper
// at the level's tier, its route through the marks, its loose cover), extended for a fleet of up to 5 rivals. Pure: no DOM, no GPU.
//   - The pack stays close by SKILL, never by speed (owner brief, R4): each rival has its own fixed skill, a small step round the
//     level's tier (FLEET_SKILL), and v1's rubber band is off: no rival's skill (or speed, polar or wind) ever moves with its place
//     (FleetRival.band is a no-op), so no rival sharpens when behind and nothing catches up on the last leg.
//   - The start: v1's startPlan is over early from the box at −0:45 (it commits on v1's 60 s sequence; measured for R1), so each
//     rival sails v2's timed run (helper.js) on its own skipper, at its own place on the line, late by its skill (START_LATE).
//   - The right of way (rules.js atFault): port gives way to starboard; on one tack the windward boat keeps clear.
//     A rival that must keep clear and would pass within a length and a half in the next 8 s ducks under the other's stern (port and
//     starboard) or heads up (windward); a stand-on rival holds its course until a touch is 2.5 s away, then avoids it too (rule 14).
//   - The cover (v1's `other`): the nearest boat, not only the player.
//   const r = new FleetRival({ course, skill, seed, windAt, clear, vessel });  r.traffic = [states…];  r.update(…) as v1's Rival
//   giveWay(me, others, windFrom) → null | { heading, other, rule, tCpa, dCpa, standOn }
//   - The cover (step C, a match race; owner 2026-11-17: "stay between the opponent and the next mark upwind; tack to cover"): ahead
//     on a beat, the rival tacks onto the player's tack a moment after she tacks (quicker with skill) and holds it, so she sits between
//     the player and the mark; never inside COVER.markM of the mark, never past her layline (there she sails for the mark).
//   coverCall({ me, opp, mark, twd, alpha, aheadM, skill, t, st }) → null | { side, why: 'tack' | 'hold' }   r.cover = true turns it on
import { Rival } from '../../src/sim/race/rival.js';
import { polarTargets } from '../../src/sim/ai/skipper.js';
import { atFault } from '../../src/sim/race/rules.js';
import { hullGap } from '../../src/sim/race/contact.js';

const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
// each rival's skill: the level's tier (v1's TIERS: easy 0.2, medium 0.5, hard 0.8) plus its own fixed step (a spread of 0.12 in all:
// one a touch sharper than the tier, one level, the rest a touch slower), so the pack stays together by skill
export const FLEET_SKILL = Object.freeze({ wren: 0.03, tern: 0.0, kestrel: -0.03, heron: 0.05, plover: -0.05 });
// the fleet's tier per level: v1's TIERS order (easy < medium < hard) lifted for a fleet (v1's easy 0.2 sails 11° free with an 8 s lag in
// its sense of the wind: five of them spread 90–290 s over a 6-minute race and fouled each other); a beginner's rivals still sail
// clearly worse than Club's, Club's than Pro's
export const FLEET_TIER = Object.freeze({ easy: 0.45, medium: 0.62, hard: 0.82, pro: 0.95 });
export const skillFor = (tier, id) => Math.max(0, Math.min(1, (FLEET_TIER[tier] ?? FLEET_TIER.medium) + (FLEET_SKILL[id] ?? 0)));
// the start's timing by skill: v2's timed run aims to cross this many seconds after the gun (skill 1: 1.5–2.5 s, a second more than v2's helper's: the rivals' boxes sit in each other's dirty air;
// skill 0.45: 3.2–4.7 s), never early
export const startLate = (skill) => { const e = 1 - Math.max(0, Math.min(1, skill)); return [1.5 + 3 * e, 2.5 + 4 * e]; };
// the right of way: a length and a half at the closest point, 8 s ahead; the stand-on boat's last moment (rule 14)
const SLOW_SHEET = 80 * DEG, SPIN_LEAD = 14 * DEG;
// stalled head to wind: under 0.9 m/s within 38° of it
const inIrons = (s) => (s.u ?? 0) < 0.9 && Math.abs(s.trueWind?.angle ?? Math.PI) < 38 * DEG;
// out of irons (the race fixes, 2026-11-18; filmed: rivals sat head to wind near mark 1 for 10-23 s at 0.0-0.3 m/s). The main cause:
// a reach onto the other board steered through the wind with no tack (crossCheck makes it a manoeuvre). The backstop: a racing rival
// dying head to wind (under STALL.ms within STALL.deg of it for STALL.s, not in a tack that still has way on) bears away at once while
// her rudder still bites (backingOff; the skipper waited for 4 s under 0.4 m/s inside 32 degrees, then turned with no way on); the windward boat's
// slowing (eased sheets) stops at SLOW_FLOOR_MS (she kept easing to a standstill beside the leeward boat)
export const STALL = Object.freeze({ ms: 1.2, deg: 30, s: 1, manMs: 0.6, easeDeg: 35, outDeg: 50, flipDeg: 6, maxS: 30 });
export const SLOW_FLOOR_MS = 1.2;
export const WM = Object.freeze({ rangeM: 90, upDeg: 60, layDeg: 45, besideM: 9, pastM: 6, layM: 35 });
export const ROW = Object.freeze({ cpaM: 16, aheadS: 12, rangeM: 60, standOnS: 3, standOnM: 9, nearGapM: 3, duckAsternM: 16, headUpDeg: 18, closeDeg: 42, maxTurnDeg: 60, spinClearM: 26, clearS: 8 });

// the closest point of approach of two boats at their present velocities: { t, d } (t clamped to [0, ahead])
export function cpa(a, b, ahead = ROW.aheadS) {
  const va = [Math.sin(a.heading) * (a.u ?? 0), -Math.cos(a.heading) * (a.u ?? 0)], vb = [Math.sin(b.heading) * (b.u ?? 0), -Math.cos(b.heading) * (b.u ?? 0)];
  const px = b.x - a.x, pz = b.z - a.z, vx = vb[0] - va[0], vz = vb[1] - va[1], vv = vx * vx + vz * vz;
  const t = vv < 1e-6 ? 0 : Math.max(0, Math.min(ahead, -(px * vx + pz * vz) / vv));
  return { t, d: Math.hypot(px + vx * t, pz + vz * t) };
}

// the boat `me` must keep clear of, if any, and the heading that does it (pure). others: [{ x, z, heading, u, id? }]
// prestart: before the gun only port and starboard counts (rules.js judges no meeting before the gun; two boats on one tack in the box
// are on parallel lanes)
export function giveWay(me, others, windFrom, R = ROW, prestart = false) {
  let best = null;
  for (const o of others) {
    if (o === me || Math.abs(o.x - me.x) > R.rangeM || Math.abs(o.z - me.z) > R.rangeM) continue;
    const c = cpa(me, o, R.aheadS), now = Math.hypot(o.x - me.x, o.z - me.z);
    // closing on her (the closest point ahead nearer than now by a metre), or her hull within 3 m of ours (the outlines: src/race/
    // contact.js): two boats sailing side by side on parallel courses keep their lanes
    const touching = now < 12 && hullGap(me, o) < R.nearGapM;
    if (!touching && (c.d > R.cpaM || !(c.t > 0 && c.d < now - 1))) continue;
    if (touching) { c.t = 0; c.d = Math.min(c.d, now); }
    const f = atFault(me, o, windFrom), mine = f.fault === 0;
    if (prestart && f.rule !== 'port and starboard') continue;
    const standOn = !mine;
    if (standOn && !(c.t < R.standOnS && c.d < R.standOnM)) continue;   // the stand-on boat holds her course until the last moment
    if (best && c.t >= best.tCpa) continue;
    best = { other: o, rule: f.rule, tCpa: c.t, dCpa: c.d, standOn, heading: 0 };
  }
  if (!best) return null;
  const o = best.other, side = wrap(windFrom - me.heading) > 0 ? 1 : -1;   // + starboard tack (the wind over the starboard side)
  let h;
  if (best.rule === 'port and starboard' && !best.standOn) {
    // duck: steer for a point a length and a half under her stern
    const ax = o.x - Math.sin(o.heading) * R.duckAsternM, az = o.z + Math.cos(o.heading) * R.duckAsternM;
    h = Math.atan2(ax - me.x, -(az - me.z));
  } else if (!best.standOn) {   // windward: head up, away from the leeward boat; already close-hauled, ease the sheets and drop back
    h = me.heading + side * R.headUpDeg * DEG;
    best.slow = Math.abs(wrap(windFrom - me.heading)) < (R.closeDeg + 4) * DEG;
  }
  else {   // the stand-on boat's last moment: turn away from the other's side
    const rel = wrap(Math.atan2(o.x - me.x, -(o.z - me.z)) - me.heading);
    h = me.heading - Math.sign(rel || 1) * 30 * DEG;
  }
  // no more than the turn a helm makes in a few seconds, and never into the wind's no-go (keep her board)
  const d = wrap(h - me.heading), m = R.maxTurnDeg * DEG;
  h = me.heading + Math.max(-m, Math.min(m, d));
  const twa = wrap(windFrom - h);
  if (Math.sign(twa) !== side || Math.abs(twa) < R.closeDeg * DEG) h = windFrom - side * R.closeDeg * DEG;
  best.heading = wrap(h);
  best.side = side;
  return best;
}

// the cover (a match race): the reaction after the player's tack (skill 1 → reactS[0] s, skill 0 → reactS[1] s), the range, the mark's
// keep-off, the lead it needs, the shortest time between her own tacks, the overstand it allows, the beat's cone (the mark within upDeg of
// the wind)
export const COVER = Object.freeze({ rangeM: 170, markM: 55, aheadM: 3, reactS: [1.5, 6], minTackS: 12, overDeg: 10, upDeg: 70 });
const sideOf = (twd, h) => (wrap(twd - h) >= 0 ? 1 : -1);   // + starboard tack (the wind over the starboard side)
export function coverCall({ me, opp, mark, twd, alpha, aheadM, skill = 0.6, t = 0, st = {} }) {
  const my = sideOf(twd, me.heading), op = sideOf(twd, opp.heading);
  if (st.op !== op) { st.op = op; st.opT = t; }
  if (st.my !== my) { st.my = my; st.myT = t; }
  if (!(aheadM > COVER.aheadM) || !mark) return null;
  if (Math.hypot(opp.x - me.x, opp.z - me.z) > COVER.rangeM || Math.hypot(mark[0] - me.x, mark[1] - me.z) < COVER.markM) return null;
  const rel = wrap(Math.atan2(mark[0] - me.x, -(mark[1] - me.z)) - twd);
  if (Math.abs(rel) > COVER.upDeg * DEG) return null;   // not a beat
  const fetch = (sd) => sd * rel <= -alpha + 2 * DEG;   // on this tack she lays the mark
  if (fetch(my)) return null;                          // on her layline: sail for the mark
  if (my === op) return fetch(-my) ? null : { side: my, why: 'hold' };   // covering: hold the player's tack until the layline
  const react = COVER.reactS[1] + (COVER.reactS[0] - COVER.reactS[1]) * Math.max(0, Math.min(1, skill));
  if (t - (st.opT ?? -1e9) < react || t - (st.myT ?? -1e9) < COVER.minTackS) return null;
  if (op * rel < -alpha - COVER.overDeg * DEG) return null;   // the player's tack would carry her past the layline: no cover
  return { side: op, why: 'tack' };
}

// v1's Rival with the fleet's rules: no rubber band, the right of way on its skipper's helm, the nearest boat as `other`
export class FleetRival extends Rival {
  constructor({ skill, tier = 'medium', ...o } = {}) {
    super({ tier, ...o });
    if (skill != null) { this.base = skill; this.sk.setSkill(skill); }
    this.traffic = [];      // the other boats' states this tick (the caller's array, refilled in place)
    this.keepClear = null;  // the give-way this tick (giveWay's), for the picture and the tests
    this.shortcut = null;   // Tea House Run: { mark, via, done } when this rival cuts inside the shelf (session.js SHORTCUT)
    this.hazardAdv = null;  // a place race's hazard to steer round (Tessie's ring: tessieDeep.js avoidAdvice), set by the session each tick
    this.windFrom = this.course.designWindFrom * DEG;
    this.clearAdv = { evade: true, heading: 0, side: 1, mode: 'reach' };
    this.wm = false; this.wmRoute = [[0, 0], [0, 0], null]; this.wmTarget = {}; this.wmView = {}; this.wmCtx = {};
    // the skipper's helm with the right of way over its advice (a penalty turn still wins): one wrapper, one context object reused
    const sk = this.sk, base = sk.update.bind(sk), ctx2 = {}, adv = { evade: true, heading: 0, side: 1 };
    this.cover = false; this.coverOpp = null; this.coverAdv = null; this.coverSt = {}; this.coverTacks = 0; this.coverWhy = null;
    this.covA = { evade: true, closeHauled: true, side: 1, chDeg: 44, mode: 'beat' };
    sk.update = (dt, s, ctl, ctx = {}) => {
      const g = this.keepClear ?? this.hazardAdv, cv = this.coverAdv;   // the right of way first, then Tessie's ring (a place race: session.js S.hazard), then a match race's cover
      // stalled head to wind (or the skipper already getting out of it): no advice, so the skipper's own irons recovery runs (an advice
      // switches it off; boats in a tangle sat in irons for minutes)
      if ((!g && !cv) || ctx.legKey === 'turn' || inIrons(s) || sk.recover) return base(dt, s, ctl, ctx);
      for (const k in ctx2) delete ctx2[k];
      Object.assign(ctx2, ctx);
      if (g) { adv.heading = g.heading; adv.side = g.side; ctx2.advice = adv; } else ctx2.advice = cv;
      return base(dt, s, ctl, ctx2);
    };
  }
  band() { /* the fleet's pack is kept by skill alone: no rubber band (owner brief, R4) */ }
  update(dt, s, ctl, o = {}) {
    // a turn owed (a touch, Club and Pro): the skipper's helm leads the heading round, bearing away first, the trim its own (v1's turn
    // advice stalls head to wind on this keelboat: measured, a 360 never closed)
    if (o.view?.owes && o.view.status === 'racing') {
      // first clear of the fleet (rule 22: a boat taking a penalty keeps clear): sail away from the nearest boat, then turn
      let nd = Infinity, nb = null;
      for (const q of this.traffic) { const d = Math.hypot(q.x - s.x, q.z - s.z); if (d < nd) { nd = d; nb = q; } }
      this.clearT = (this.clearT ?? 0) + dt;   // at most 8 s of clearing off (two boats owing turns side by side sailed away together for minutes)
      if (!this.spinDir && nb && nd < ROW.spinClearM && this.clearT < ROW.clearS) return this.clearOff(dt, s, ctl, o, nb);
      return this.spin(dt, s, ctl, o.t ?? 0);
    }
    this.spinDir = 0; this.clearT = 0;
    this.unstall(dt, s, o);
    // Tea House Run's shortcut (session.js SHORTCUT): this rival cuts inside the island's shelf on the first leg, straight for its via
    // point with the skipper's shoal check off (the keel may ground there: session.js AGROUND), then v1's route to the mark
    const sc = this.shortcut;
    if (sc && !sc.done && !this.backOff && !this.keepClear && o.view?.status === 'racing' && o.view.target?.mark === sc.mark) {
      if (Math.hypot(sc.via[0] - s.x, sc.via[1] - s.z) < 22) sc.done = true;
      else {
        const clr = this.sk.clear; this.sk.clear = null; this.phase = 'shortcut';
        this.rep = this.sk.update(dt, s, ctl, { t: o.t ?? 0, waypoint: sc.via, legKey: 'shortcut' });
        this.sk.clear = clr; this.crossCheck(s, o.t ?? 0);
        this.shortcutS = (this.shortcutS ?? 0) + dt;
        return this.rep;
      }
    }
    this.coverNow(s, o);
    const rep = super.update(dt, s, ctl, this.windwardMark(s, o));
    if (this.keepClear?.slow && (s.u ?? 0) > SLOW_FLOOR_MS) ctl.sheet = SLOW_SHEET;
    this.crossCheck(s, o.t ?? 0);
    if (this.backOff) this.backingOff(dt, s, ctl);
    return rep;
  }
  // dying head to wind while racing: the crew's way out at once (backingOff)
  unstall(dt, s, o) {
    const twa = s.trueWind?.angle ?? Math.PI, u = s.u ?? 0;
    const stalled = o.view?.status === 'racing' && u < STALL.ms && Math.abs(twa) < STALL.deg * DEG && !(this.sk.man && u > STALL.manMs);   // a tack under way with way on is left to finish
    this.stallT = stalled ? (this.stallT ?? 0) + dt : 0;
    if (this.stallT > STALL.s && !this.backOff) { this.backOff = { side: Math.sign(twa) || 1, t: 0 }; this.sk.man = null; this.stallT = 0; this.unstalls = (this.unstalls ?? 0) + 1; }
  }
  // a reach onto the other board (the skipper's course for a mark on the other side of the wind, in reach mode) is steered the short
  // way round, through the wind at the helm's rate, no tack: in light air she died head to wind (the race fixes, 2026-11-18, the main cause of the
  // stalls). It becomes a manoeuvre: a tack with way on, else round the long way (the skipper's 'around'); from the next tick
  crossCheck(s, t) {
    const sk = this.sk;
    if (sk.man || this.backOff || sk.recover || sk.twd == null || sk.rep?.mode !== 'reach' || sk.rep.heading == null) return;
    const now = wrap(sk.twd - s.heading), want = wrap(sk.twd - sk.rep.heading);
    if (Math.sign(now) === Math.sign(want) || Math.abs(now) + Math.abs(want) >= Math.PI) return;   // the helm's short way round is a gybe: the skipper's own
    sk.startMan(s, t, { side: Math.sign(want), mode: 'beat', forced: true, A: Math.abs(want), flip: true });
    this.crossTacks = (this.crossTacks ?? 0) + 1;
  }
  // the crew's way out of irons (a sailor's: the jib backed to the side the bow must go, the main let right out so it cannot push her
  // back into the wind, the rudder hard over, reversed while she makes sternway), until she sails STALL.outDeg off the wind (the main let out only inside easeDeg)
  backingOff(dt, s, ctl) {
    const b = this.backOff, twa = s.trueWind?.angle ?? Math.PI, u = s.u ?? 0;
    b.t += dt;
    if (Math.abs(twa) > STALL.flipDeg * DEG && Math.sign(twa) !== b.side) b.side = Math.sign(twa);   // fallen through the wind: off on that tack (a jib backed the old way held her in irons)
    if (Math.abs(twa) > STALL.outDeg * DEG || b.t > STALL.maxS) { this.backOff = null; this.sk.helm.i = 0; return; }
    ctl.jibSide = b.side;
    if (Math.abs(twa) < STALL.easeDeg * DEG) { ctl.sheet = SLOW_SHEET; ctl.sheetBias = 0; }   // past it the crew trims (she gathers way)
    ctl.rudder = -b.side * (u >= 0 ? 1 : -1);
    this.sk.rep.mode = 'irons';
  }
  clearOff(dt, s, ctl, o, nb) {
    const tw = this.sk.twd ?? this.windFrom, side = wrap(tw - s.heading) > 0 ? 1 : -1;
    let h = Math.atan2(s.x - nb.x, -(s.z - nb.z));   // away from her
    const twa = wrap(tw - h); if (Math.sign(twa) !== side || Math.abs(twa) < ROW.closeDeg * DEG) h = tw - side * (ROW.closeDeg + 8) * DEG;
    this.clearAdv.heading = h; this.clearAdv.side = side;
    this.phase = 'clear';
    if (inIrons(s) || this.sk.recover) return this.sk.update(dt, s, ctl, { t: o.t ?? 0, waypoint: [s.x + Math.sin(h) * 200, s.z - Math.cos(h) * 200], legKey: 'clear' });
    return this.sk.update(dt, s, ctl, { t: o.t ?? 0, waypoint: [s.x + Math.sin(h) * 200, s.z - Math.cos(h) * 200], legKey: 'turn', advice: this.clearAdv });
  }
  // the windward mark (R4): v1's route sends a boat to a point straight upwind of the mark, and close-hauled she sailed over the mark
  // and missed the rounding on 4 boats of 5 (58–355 s in its zone, measured). Within 90 m of an upwind mark the route is a sailor's:
  // the lay (starboard for a port rounding): a point on it 35 m below the mark, then a point a length beside the mark and a length past
  // it, then v1's exit
  windwardMark(s, o) {
    const v = o.view, tg = v?.target;
    if (!tg?.at || v.status !== 'racing' || !tg.route) { this.wm = false; return o; }
    const twd = this.sk.twd ?? this.windFrom, dx = tg.at.x - s.x, dz = tg.at.z - s.z, d = Math.hypot(dx, dz);
    const up = d < WM.rangeM && Math.abs(wrap(Math.atan2(dx, -dz) - twd)) < WM.upDeg * DEG;
    if (this.wm && this.wmMark !== tg.mark) { this.wm = false; this.j = 0; }   // a new mark: v1's route again until it is upwind
    if (!up && !(this.wm && d < WM.rangeM + 20)) { if (this.wm) { this.wm = false; this.j = 0; } return o; }
    if (!this.wm) { this.wm = true; this.wmMark = tg.mark; this.j = 0; }
    const side = tg.rounding === 'starboard' ? -1 : 1, h = twd - side * WM.layDeg * DEG, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h) * side, rz = Math.sin(h) * side;
    // first a point on the lay WM.layM below the mark (she fetches the layline), then the point beside and past the mark, then v1's exit
    const L = this.wmRoute[0], P = this.wmRoute[1];
    L[0] = tg.at.x + rx * WM.besideM - fx * WM.layM; L[1] = tg.at.z + rz * WM.besideM - fz * WM.layM;
    P[0] = tg.at.x + rx * WM.besideM + fx * WM.pastM; P[1] = tg.at.z + rz * WM.besideM + fz * WM.pastM;
    this.wmRoute[2] = tg.route[2];
    const t2 = this.wmTarget; t2.mark = tg.mark; t2.at = tg.at; t2.rounding = tg.rounding; t2.leg = tg.leg; t2.route = this.wmRoute;
    const v2 = this.wmView; Object.assign(v2, v); v2.target = t2;
    const o2 = this.wmCtx; Object.assign(o2, o); o2.view = v2;
    return o2;
  }
  spin(dt, s, ctl, t) {
    const sk = this.sk;
    if (inIrons(s) || sk.recover) { this.phase = 'turn'; return sk.update(dt, s, ctl, { t, waypoint: [s.x + Math.sin(s.heading + this.spinDir) * 200, s.z - Math.cos(s.heading + this.spinDir) * 200], legKey: 'irons' }); }
    if (!this.spinDir) this.spinDir = wrap((sk.twd ?? this.windFrom) - s.heading) > 0 ? -1 : 1;
    sk.perceive(dt, s, t); sk.helmTo(dt, s, ctl, s.heading + this.spinDir * SPIN_LEAD); sk.trim(dt, s, ctl);
    sk.rep.mode = 'turn';
    this.phase = 'turn';
    return sk.rep;
  }
  // a match race's cover for this tick (coverCall), as the skipper's advice: close-hauled on the player's tack
  coverNow(s, o) {
    const v = o.view, op = this.coverOpp, tg = v?.target;
    if (!this.cover || !op?.s || v?.status !== 'racing' || op.status !== 'racing' || !tg?.at) { this.coverAdv = null; this.coverWhy = null; return; }
    const tws = s.trueWind?.speed ?? 5, up = polarTargets(Math.max(1, tws), this.sk.polar).up.twa, twd = this.sk.twd ?? this.windFrom;
    const c = coverCall({ me: s, opp: op.s, mark: [tg.at.x, tg.at.z], twd, alpha: up * DEG, aheadM: (v.progressM ?? 0) - (op.progressM ?? 0), skill: this.base, t: o.t ?? 0, st: this.coverSt });
    if (c?.why === 'tack' && this.coverWhy !== 'tack') this.coverTacks++;
    this.coverWhy = c?.why ?? null;
    // never into shoal water: the cover's heading checked as the skipper checks its own (20 s ahead)
    if (c && this.sk.clear && !this.sk.clear(twd - c.side * up * DEG, 20, s)) { this.coverAdv = null; this.coverWhy = 'shoal'; return; }
    if (!c) { this.coverAdv = null; return; }
    this.covA.side = c.side; this.covA.chDeg = up; this.coverAdv = this.covA;
  }
  // before the skipper's tick: the right of way over the boats round it (windFrom: the wind here, rad)
  lookOut(s, prestart = false, windFrom = this.windFrom) { this.keepClear = giveWay(s, this.traffic, windFrom, ROW, prestart); return this.keepClear; }
}
