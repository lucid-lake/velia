// Cruise's pilot: the Navigator plans (route, stops, chart margins, traffic, irons) and the AI skipper sails
// (src/ai/skipper.js: tactics, helm, the pro trim). The skipper takes the navigator's subgoal as its waypoint and asks the
// navigator whether a heading is clear; when its own board is not clear, or the planner evades, it follows the planner's
// choice with the same pro handling. Shared by the page (index.js) and the headless voyages (sim.js).
import { AISkipper } from '../../ai/skipper.js';

export class CruisePilot {
  // vessel: the boat it sails (its profile: the skipper's polar; this page's boat when absent)
  constructor({ nav, skill = 1, seed = 1, windAt, vessel }) {
    this.nav = nav; this.state = null; this.cache = new Map(); this.t = 0;
    const clear = (h, _s, st) => {
      const key = Math.round(h * 28.65), hit = this.cache.get(key);   // 2° bins, 0.5 s
      if (hit && this.t - hit.t < 0.5) return hit.ok;
      const ok = this.nav.clearHeading(st, h);
      this.cache.set(key, { ok, t: this.t });
      return ok;
    };
    this.skipper = new AISkipper({ skill, seed, windAt, clear, ...(vessel ? { vessel } : {}) });
  }

  // state: BoatPhysics.state; ctl: the controls object (written); ctx: { t, sunElevDeg, traffic }
  update(dt, state, ctl, ctx) {
    this.t = ctx.t;
    const nav = this.nav, out = nav.update(state, ctx), c = nav.choice;
    const advice = out.mode === 'irons' ? { irons: true, rudder: out.rudder, jibSide: out.jibSide }
      : c ? { heading: c.heading, side: c.side, closeHauled: !!c.closeHauled, chDeg: c.chDeg, mode: c.mode, evade: !!c.evade, round: !!c.round } : null;
    const rep = this.skipper.update(dt, state, ctl, { t: ctx.t, waypoint: nav.subgoal ?? nav.target.at, legKey: nav.target.key, advice });
    this.out = { ...out, ...rep, mode: out.mode };
    return this.out;
  }
}
