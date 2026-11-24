// The shallow-water assist (feat/grounding, 2026-10-30): in assisted play the helmsman bears
// away on his own when the boat would hit the shore or the bottom within a few seconds. Plain JS, no three.js and no DOM:
// the controls (src/sail/controls.js) feed it the boat's state every frame and steer to the heading it returns;
// tests/ground.test.mjs runs it on the real physics and the real terrain.
//
//   const as = new ShoalAssist({ depthAt: (x, z) => −terrain.heightAt(x, z) });
//   const out = as.update(state, dt, { enabled, steering, windFrom });     // windFrom: rad, the wind's FROM direction
//   out.engaged → steer to out.heading (rad); out.event: 'engage' | 'release' | null (R. says out.say once)
//
// How. Four times a second the boat's track is projected 8 s ahead at its speed over ground (ground.js predict(): the keel,
// the rudder, the bow and the sides against the same depth the chart and the navigator read, 0.5 m to spare). If it hits
// within `engageS` the assist engages: it tries headings 10° apart on either side of the bow, each as a turn at the boat's
// own rate, and takes the smallest turn whose track stays clear for twice the horizon (`chooseFar`), not into the wind's no-go zone,
// preferring the side that ends in deeper water. It holds that heading while the track from the boat's own bow is not
// clear; once the bow's track has been clear for `clearS` s and the boat is on the heading it lets go (the pilot then
// holds the heading it has). The player's steering always wins: while A/D, the wheel or the stick is moved the assist
// stands down, and it waits `graceS` after they let go.
const DEG = Math.PI / 180;
import { wrap } from '../core/math.js';

export const ASSIST = {
  warnS: 8,              // s: a warning when the track hits within this (assist or not)
  engageS: 7,            // s: engage when the track hits within this many seconds ...
  engageM: 78, engageMPerMs: -9, engageMin: 40,   // ... or this many metres less this many per m/s of speed (never under engageMin), whichever is more: a slow boat turns slowly and is given more room (3 kn 64 m, 6 kn 50 m, 8 kn 41 m)
  tickS: 0.2,            // s between looks
  minSog: 0.8,           // m/s: slower than this (a drift, the anchor, the dock) predicts nothing
  turnPerMs: 0.064,      // rad/s of turn per m/s of speed, to a cap: the boat's turn under full helm is 0.075 per m/s (6.6°/s at 3 kn, 13.6° at 6, 17° at 8), 15 % held back for the helm's lag
  turnMax: 0.26,         // rad/s
  stepDeg: 10, maxDeg: 170,
  margin: 1.5,           // m of water under the keel to spare when it engages (the sounder's alarm is at 3 m)
  // what a chosen heading tries to keep, best first (the first tier with a clear heading within maxDeg wins): m of water under
  // the keel, and m kept off the bottom's edge abeam and ahead (a skipper stays well off rocks)
  tiers: [{ margin: 3, standoff: 40 }, { margin: 2, standoff: 25 }, { margin: 1, standoff: 12 }, { margin: 0.5, standoff: 0 }],
  noGoDeg: 38,           // headings closer than this to the wind are costly (the boat stalls)
  clearS: 2.0,           // s the bow's track must be clear to let go
  graceS: 1.5,           // s after the player lets go of the helm
  addDeg: 8,             // extra turn past the first clear heading (a margin off the shoal)
  chooseFar: 2,          // a candidate heading's track must stay clear this many times the look's horizon: a turn clear for one horizon
                         // can lead into a dead end (a shelf, a pocket upwind) where the boat runs out of water before it re-aims
                         // (slow lane, 2026-11-18: the beach at -158,-316 grounded at 6 and 8 kn after the 2026-11-13 bed join)
};

export class ShoalAssist {
  constructor({ depthAt, predict, A = ASSIST } = {}) {
    this.depthAt = depthAt; this.predict = predict; this.A = A;
    this.engaged = false; this.target = 0; this.t = 0; this.acc = 0; this.clearFor = 0; this.graceUntil = 0;
    this.tHit = null; this.warn = null; this.mat = 'sand'; this.reason = null; this.trapped = false; this.engagedAt = -99; this.last = null;
  }
  reset() { this.engaged = false; this.acc = 0; this.clearFor = 0; this.tHit = null; this.reason = null; }

  engageDist(v) { return Math.max(this.A.engageMin, this.A.engageM + this.A.engageMPerMs * v); }
  // the look: the first hit along the boat's own track
  look(s, o = {}, far = 1) {
    const A = this.A, v = Math.max(0.3, Math.hypot(s.u ?? 0, s.v ?? 0));
    const horizonS = Math.min(45, far * Math.max(8, Math.max(A.engageS, this.engageDist(v) / v) + 2));
    return this.predict(this.depthAt, s, { horizonS, margin: A.margin, rate: Math.min(A.turnMax, A.turnPerMs * v), ...o });
  }

  // choose the heading: the smallest turn that is clear, scored with the wind and the water it ends in
  choose(s, windFrom) {
    const A = this.A;
    let far = { tHit: -1, delta: 0 };
    for (const tier of A.tiers) {
      const best = { cost: Infinity, delta: 0 };
      for (let k = 1; k <= A.maxDeg / A.stepDeg; k++) for (const sign of [1, -1]) {
        const delta = sign * k * A.stepDeg * DEG, tgt = wrap(s.heading + delta);
        const r = this.look(s, { turnTo: tgt, ...tier }, A.chooseFar);
        const th = r.tHit == null ? 99 : r.tHit;
        if (tier === A.tiers.at(-1) && th > far.tHit) far = { tHit: th, delta };
        if (r.tHit != null) continue;
        const twa = Math.abs(wrap(windFrom - tgt)) / DEG;
        const cost = k * A.stepDeg + (twa < A.noGoDeg ? 120 : 0) - Math.min(8, r.minClear) * 0.5;   // deeper water ends the track: a small credit
        if (cost < best.cost) { best.cost = cost; best.delta = delta; }
      }
      if (best.cost < Infinity) return { delta: best.delta + Math.sign(best.delta) * A.addDeg * DEG, trapped: false, tier };
    }
    return { delta: far.delta, trapped: true, tier: null };
  }

  update(s, dt, { enabled = true, steering = false, windFrom = 0 } = {}) {
    const A = this.A, out = { engaged: this.engaged, heading: this.target, event: null, reason: this.reason, tHit: this.tHit, trapped: this.trapped };
    this.t += dt;
    const can = enabled && !steering;
    if (!can && this.engaged) { this.engaged = false; out.engaged = false; out.event = 'release'; }
    if (steering) this.graceUntil = this.t + A.graceS;
    this.acc += dt;
    if (this.acc < A.tickS) { out.warn = this.warn; return out; }
    this.acc = 0;
    const sog = Math.hypot(s.u ?? 0, s.v ?? 0);
    if (sog < A.minSog || (s.u ?? 0) < 0.3) {
      if (this.engaged && sog < 0.3) { this.engaged = false; out.event = 'release'; out.engaged = false; }
      this.tHit = null; out.tHit = null; this.warn = null; out.warn = null; return out;
    }
    const here = this.look(s);   // the track as the boat is going
    this.tHit = here.tHit; out.tHit = here.tHit;
    // the warning (assist on or off, Pro too): the track hits within warnS: what and how soon
    this.warn = here.tHit != null && here.tHit <= Math.max(A.warnS, this.engageDist(sog) / sog)
      ? { reason: here.mat === 'rock' ? 'rocks' : here.depth != null && here.depth < 0.3 ? 'shore' : 'shoal', tHit: here.tHit } : null;
    out.warn = this.warn;
    if (!can) return out;
    if (!this.engaged) {
      if (this.t < this.graceUntil) return out;
      if (here.tHit != null && here.tHit <= Math.max(A.engageS, this.engageDist(sog) / sog)) {
        const pick = this.choose(s, windFrom);
        this.engaged = true; this.target = wrap(s.heading + pick.delta); this.trapped = pick.trapped; this.clearFor = 0; this.engagedAt = this.t;
        const hitPt = here; this.mat = hitPt.mat; this.reason = hitPt.mat === 'rock' ? 'rocks' : hitPt.depth != null && hitPt.depth < 0.3 ? 'shore' : 'shoal';
        out.engaged = true; out.heading = this.target; out.event = 'engage'; out.reason = this.reason; out.trapped = this.trapped;
      }
      return out;
    }
    // engaged: re-aim if the heading we are on would now hit; let go once the bow's track has been clear on the heading
    const onHeading = Math.abs(wrap(this.target - s.heading)) < 12 * DEG;
    const ahead = this.look(s, { turnTo: this.target, margin: 0.5 });
    if (ahead.tHit != null && ahead.tHit < 5) {
      const pick = this.choose(s, windFrom);
      this.target = wrap(s.heading + pick.delta); this.trapped = pick.trapped; this.clearFor = 0;
      out.heading = this.target; out.trapped = this.trapped;
    }
    this.clearFor = here.tHit == null ? this.clearFor + A.tickS : 0;
    if (onHeading && this.clearFor >= A.clearS) { this.engaged = false; out.engaged = false; out.event = 'release'; out.heading = s.heading; }
    else out.heading = this.target;
    return out;
  }
}
