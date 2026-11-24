// The rival: one AISkipper at the tier's skill, with the start, the route through the marks, a loose cover
// and the rubber band on its HANDS only. Pure: no DOM; the Boat it is drawn with lives in src/modes/regatta/. 
//   const r = new Rival({ course, tier: 'medium', seed, windAt, clear });
//   r.update(dt, boatState, controls, { t, clock, view, rivalOf: { x, z, heading, progressM }, line })   // each tick; writes `controls`
import { AISkipper } from '../ai/skipper.js';
import { roundingGeometry } from '../marks/course.js';
import { side } from './line.js';
import { BOAT_LENGTH_M } from './course.js';

export const TIERS = { easy: 0.2, medium: 0.5, hard: 0.8, pro: 1.0 };
export const BAND = { down: 0.15, up: 0.10, lengths: 20, tauS: 60 };
import { clampT as clamp } from '../core/math.js';

// is a heading clear of shoal water for `seconds` (the Navigator's chart question, standalone): depth >= minDepth every 15 m;
// blockedAt(x, z): a solid in the way (the July 4th show's barges and boats: src/fireworks/solids.js blocked), as shoal water
export function makeClear(depthAt, minDepth = 4, blockedAt = null) {
  return (heading, seconds, s) => {
    const sp = Math.max(2, Math.hypot(s.u ?? 2, s.v ?? 0)), L = sp * seconds;
    for (let d = 0; d <= L; d += 15) {
      const x = s.x + Math.sin(heading) * d, z = s.z - Math.cos(heading) * d;
      if (!(depthAt(x, z) >= minDepth) || (blockedAt && d > 0 && blockedAt(x, z))) return false;
    }
    return true;
  };
}

export class Rival {
  // vessel: the boat it sails (its profile: its polar and rudder; AISkipper's default, this page's boat, when absent)
  constructor({ course, tier = 'medium', seed = 1, windAt, clear = null, marks = null, vessel } = {}) {
    this.course = course; this.tier = tier; this.base = TIERS[tier] ?? TIERS.medium;
    this.sk = new AISkipper({ skill: this.base, seed, windAt, clear, arriveM: 12, ...(vessel ? { vessel } : {}) });
    this.windAt = windAt; this.marks = marks ?? (() => Object.fromEntries(course.marks.map((m) => [m.id, { x: m.at[0], z: m.at[1] }])));
    this.delta = 0; this.mark = null; this.j = 0; this.rep = null; this.phase = 'prestart';
    this.sk.side = 1;   // starboard tack at the start
  }
  get skill() { return this.sk.skill; }
  // the rubber band: the rival's skill moves inside [tier - 0.15, tier + 0.10] with the gap, eased over 60 s. gapLengths > 0: the
  // rival is ahead of the player. Ahead by more than 20 lengths: sloppier (the player gets back into it); behind by more: sharper.
  band(dt, gapLengths) {
    const f = clamp(gapLengths / BAND.lengths, -1, 1), target = f >= 0 ? -BAND.down * f : -BAND.up * f;
    this.delta += (target - this.delta) * (1 - Math.exp(-dt / BAND.tauS));
    this.delta = clamp(this.delta, -BAND.down, BAND.up);
    const s = clamp(this.base + this.delta, 0, 1);
    if (Math.abs(s - this.sk.skill) > 0.004) this.sk.setSkill(s);
  }
  update(dt, s, ctl, { t = 0, clock = 0, view = null, other = null, line = null } = {}) {
    const my = view?.progressM ?? 0;
    if (other) this.band(dt, (my - other.progressM) / BOAT_LENGTH_M);
    const windFrom = this.course.designWindFrom * Math.PI / 180;
    // before the start: the plan
    if (!view || view.status === 'prestart' || view.status === 'ocs' || view.status === 'behind') {
      const plan = this.sk.startPlan({ line, state: s, clock, t, windFrom, over: !!view?.ocs || (line ? side(line, s.x, s.z) > 0 : false), ocs: view?.status === 'ocs' });
      if (plan.phase !== this.phase) this.sk.helm.i = 0;   // a new job: no wound-up helm from the last one
      this.phase = plan?.phase ?? 'hold';
      this.rep = this.sk.update(dt, s, ctl, { t, waypoint: plan.waypoint, legKey: `start-${plan.phase}` });
      return this.rep;
    }
    // racing: the route through the marks' roundings, then the finish
    const P = this.marks(), tg = view.target;
    let wp, key, advice;
    if (view.status === 'finished') { wp = [s.x + Math.sin(s.heading) * 200, s.z - Math.cos(s.heading) * 200]; key = 'done'; }
    else if (tg) {
      if (tg.mark !== this.mark) { this.mark = tg.mark; this.j = 0; }
      while (this.j < tg.route.length - 1 && Math.hypot(tg.route[this.j][0] - s.x, tg.route[this.j][1] - s.z) < 14) this.j++;
      // reached the exit and still not rounded (the wrong side, or a held rounding): go round again
      if (this.j === tg.route.length - 1 && Math.hypot(tg.route[this.j][0] - s.x, tg.route[this.j][1] - s.z) < 18) { this.exitT = (this.exitT ?? 0) + dt; if (this.exitT > 3) { this.j = 0; this.exitT = 0; } } else this.exitT = 0;
      wp = tg.route[this.j]; key = `${tg.mark}`;
      // a cover: tack to sit between the player and the mark
      const c = other && this.sk.cover({ other, me: { x: s.x, z: s.z, progressM: my }, t, markDist: Math.hypot(tg.at.x - s.x, tg.at.z - s.z), beat: this.sk.rep.mode === 'beat' });
      if (c) advice = { evade: true, closeHauled: true, side: -this.sk.side, chDeg: 44 };
    } else if (this.course.finish) {   // a place race's own finish line (v2/regatta/places.js), crossed the way of its up
      const F = this.course.finish;
      wp = [F.centre[0] + F.up[0] * 60, F.centre[1] + F.up[1] * 60]; key = 'finish';
    } else {   // all marks rounded: the finish line, crossed toward the pre-start side
      const L = line, down = [-L.up[0], -L.up[1]];
      wp = [L.centre[0] + down[0] * 60, L.centre[1] + down[1] * 60]; key = 'finish';
    }
    // a turn owed (a touch, a rule): circle at once, away from the marks' work, until the rules say it is done
    if (view.owes) { advice = { evade: true, heading: s.heading + 0.9, side: Math.sign(s.trueWind?.angle || 1), mode: 'reach' }; key = 'turn'; }
    this.phase = key;
    this.rep = this.sk.update(dt, s, ctl, { t, waypoint: wp, legKey: key, ...(advice ? { advice } : {}) });
    return this.rep;
  }
}
