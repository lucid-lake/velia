// AUTO's passage to a target in Sail (the pilot head, ui/autopilot.js; owner, 2026-11-16: "with a chart/double-tap target set it sails
// there, routing and tacking as needed"): Cruise's own autopilot without Cruise's mode. v1's three-free navigator (chart margins,
// A* round the land, the beat and its tacks, irons) plans and v1's AI skipper at skill 1 sails (helm and trim: CruisePilot, as
// cruise/voyage.js runs it), through the boat's autopilot hook B.drive(fn) (Sail's hands stand down while it drives, as in Cruise).
// Sail's UI, cockpit and camera stay. At the mark (the navigator's own arrival) it lets go and AUTO holds the heading she has.
// Pure (no DOM, no GPU): node drives it on v1's own lake (v2/tests/autopilot.test.mjs) and on the whole-lake chart (v2/tests/lakeChart.test.mjs).
// The chart: a page's whole-lake chart (chart: v2/ui/planChart.js loadPlanChart, the planner's own, so a target anywhere on the lake
// can be sailed to), else v1's buildChart on lake + chartIn (the bay only).
//   const A = createAutoNav({ B, chart } | { B, lake, chartIn }, sun })
//   A.engage({ x, z, name }) → { ok, say }   the target checked as Cruise checks a mark (checkDestination); ok: B drives to it
//   A.release()                               B's hands again, the skipper's trim kept (handoverTrim), the helm on her heading
//   A.on, A.dest ({ at, name }), A.distance() m, A.arrived (once, then null), A.tacks, A.gybes, A.motoring
//   A.turning ('tack' | 'gybe' | null: a manoeuvre under way, the key's amber), A.beating (close-hauled toward the mark), A.replans
// The skipper is v1's at skill 1 with Sail's rhythm (sim/beat.js BeatSkipper, owner 2026-11-17: "I didn't see AUTO zigzag"): a board
// of 60 to 110 s inside the cone, a tack at the layline, broad reaches and gybes for a mark deep downwind, a re-plan on a big shift.
// Under engine (owner, 2026-11-16: "AUTO steers to the target too"): no beat and no tacks: the helm steers along the navigator's own
// path round the land (findPath, re-planned every MOTOR.pathS) toward the point MOTOR.lookM ahead on it; the throttle stays the
// player's (ctl.throttle null: the engine's own lever, which the lever, the ring and the keys move); the sails as the hands left them;
// at the mark (NAV.destArriveM) it lets go and AUTO holds. The engine stopped on the way: back to the sailing navigator.
import { buildChart, Navigator, checkDestination, snapToClear, findPath, NAV } from '../../src/sim/modes/chill/navigator.js';
import { Helm } from '../../src/sim/boat.js';
import { BeatSkipper } from './beat.js';
import { handoverTrim } from '../../src/sim/ai/skipper.js';
import { createChannelHelm } from './channelHelm.js';

// Cruise's pilot (src/sim/modes/chill/pilot.js CruisePilot) with Sail's skipper: the navigator plans (paths, margins, irons), the
// skipper sails (tactics, helm, trim) and asks the navigator whether a heading is clear
export class SailPilot {
  constructor({ nav, skill = 1, seed = 1, windAt, vessel }) {
    this.nav = nav; this.cache = new Map(); this.t = 0;
    const clear = (h, _s, st) => {
      const key = Math.round(h * 28.65), hit = this.cache.get(key);   // 2° bins, 0.5 s
      if (hit && this.t - hit.t < 0.5) return hit.ok;
      const ok = this.nav.clearHeading(st, h);
      this.cache.set(key, { ok, t: this.t });
      return ok;
    };
    this.skipper = new BeatSkipper({ skill, seed, windAt, clear, ...(vessel ? { vessel } : {}) });
  }
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

export const MOTOR = Object.freeze({ pathS: 2, lookM: 60 });
// the point lookM along a path from its first point (the path's own first leg starts at the boat)
export function pathAhead(path, lookM = MOTOR.lookM) {
  let left = lookM;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d >= left) { const k = left / d; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
    left -= d;
  }
  return path[path.length - 1];
}
export function createAutoNav({ B, lake = null, chart: chartOpt = null, chartIn = {}, sun = () => 20, seed = 1 }) {
  const chart = chartOpt ?? buildChart(lake, { shoreline: chartIn.shoreline ?? null, harbour: chartIn.harbour ?? null, lanes: [] });
  let nav = null, pilot = null, on = false, arrived = null, dest = null;
  let motoring = false, path = null, pathT = -Infinity, lineP = null, lineT = -Infinity, tNow = 0;
  const helm = new Helm({ rudderMaxDeg: B?.phys?.P?.rudder?.maxDeg });
  const lane = createChannelHelm({ chart });   // the bay's entrance channel: down its line (sim/channelHelm.js)
  const laneSteer = (s, dt) => { const h = lane.heading(s, dest.at); if (h == null) return false; B.ctl.rudder = helm.toHeading(s, h, Math.max(dt, 1e-3)); B.ctl.jibSide = 0; return true; };
  const motorTick = (t, dt) => {
    const s = B.phys.state, at = dest.at;
    B.ctl.throttle = null; B.ctl.jibSide = 0;   // the throttle the player's (the engine's own lever); no backed jib
    if (Math.hypot(at[0] - s.x, at[1] - s.z) < NAV.destArriveM) { arrived = { name: dest.name, t }; A.release(); return; }
    if (!path || t - pathT > MOTOR.pathS) { path = findPath(chart, [s.x, s.z], at) ?? [[s.x, s.z], at]; pathT = t; }
    if (laneSteer(s, dt)) return;
    const p = pathAhead([[s.x, s.z], ...path.slice(1)]);
    B.ctl.rudder = helm.toHeading(s, Math.atan2(p[0] - s.x, -(p[1] - s.z)), Math.max(dt, 1e-3));
  };
  const tick = (t, dt) => {
    tNow = t;
    const eng = !!B.phys.engine?.on;
    if (eng !== motoring) { motoring = eng; path = null; if (!eng) nav.setDestination(dest.at, { name: dest.name ?? 'your mark' }); }
    if (motoring) { motorTick(t, dt); return; }
    pilot.update(dt, B.phys.state, B.ctl, { t, sunElevDeg: sun(), traffic: null });
    const was = lane.active;
    if (!laneSteer(B.phys.state, dt) && was) nav.path = null;   // in the channel: down its line; the navigator re-plans as she leaves it
    if (nav.arrived) { arrived = { ...nav.arrived }; A.release(); }
  };
  const A = {
    chart,
    get on() { return on; }, get inChannel() { return lane.active; }, get motoring() { return on && motoring; }, get dest() { return dest; }, get tacks() { return pilot?.skipper.tacks ?? 0; }, get gybes() { return pilot?.skipper.gybes ?? 0; }, get replans() { return pilot?.skipper.replans ?? 0; },
    // the routed line from her to the mark for the chart: the planner's own path round land and shoal (the navigator's, else the motor's, else
    // one planned here every 2 s), from her place on through its bends to the mark; null when off or when there is no way round
    get line() {
      if (!on || !dest) return null;
      const s = B.phys.state, at = dest.at;
      let p = motoring ? path : nav?.path;
      if (!p || p.length < 2) {
        if (!lineP || tNow - lineT > 2) { lineP = findPath(chart, [s.x, s.z], at); lineT = tNow; }
        p = lineP;
      }
      if (!p || p.length < 2) return null;
      let k = 1, best = Infinity;   // the segment she is nearest: her place, the segment's far end, then the rest
      for (let i = 1; i < p.length; i++) {
        const a = p[i - 1], b = p[i], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((s.x - a[0]) * dx + (s.z - a[1]) * dz) / L)), d = Math.hypot(a[0] + dx * u - s.x, a[1] + dz * u - s.z);
        if (d < best) { best = d; k = i; }
      }
      const out = [[s.x, s.z], ...p.slice(k).map((q) => [q[0], q[1]])];
      const e = out[out.length - 1];
      if (Math.hypot(e[0] - at[0], e[1] - at[1]) > 1) out.push([at[0], at[1]]);
      return out;
    },
    get skipper() { return pilot?.skipper ?? null; },
    get turning() { return on && !motoring ? pilot?.skipper.turning ?? null : null; }, get beating() { return on && !motoring && pilot?.skipper.rep.mode === 'beat'; },
    get arrived() { const a = arrived; arrived = null; return a; },
    distance() { const s = B.phys.state; return dest ? Math.hypot(dest.at[0] - s.x, dest.at[1] - s.z) : null; },
    engage(tg) {
      const s = B.phys.state;
      // from: her place, or the nearest clear water when she lies inside the navigator's shore margin (Sail goes closer in than Cruise)
      const from = chart.marginAt(s.x, s.z) < 0 ? snapToClear(chart, [s.x, s.z], 300) : [s.x, s.z];
      const r = checkDestination(chart, tg.x, tg.z, { from, snapM: 260 });   // a mark inside the navigator's shore margin: the nearest clear water within 260 m (Sail's marks may sit closer in than Cruise's)
      if (!r.ok) return { ok: false, say: r.say };
      nav = new Navigator({ chart, seed });
      nav.setDestination(r.at, { name: tg.name ?? 'your mark' });
      pilot = new SailPilot({ nav, skill: 1, seed, windAt: (x, z, t) => B.env(t).windAt(x, z, t), vessel: B.phys.vessel });
      dest = { at: [r.at[0], r.at[1]], name: tg.name ?? null };
      motoring = !!B.phys.engine?.on; path = null; B.drive(tick, { sea: true }); on = true; arrived = null;
      return { ok: true };
    },
    release() {
      if (!on) return false;
      on = false;
      const trim = motoring ? {} : handoverTrim(pilot.skipper);
      B.drive(null);   // the boat's hook: the hands again, the helm's held heading her own (sim/boat.js)
      B.hand.sheet = trim.sheet ?? B.hand.sheet; B.hand.start = false;
      if (!motoring) Object.assign(B.ctl, { traveller: trim.traveller, twist: trim.twist, backstay: trim.backstay, jibLead: trim.jibLead });
      motoring = false;
      dest = null;
      return true;
    },
  };
  return A;
}
