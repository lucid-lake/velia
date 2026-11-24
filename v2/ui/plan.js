// The passage plan on v2's enlarged chart (feat(v2): the passage plan;: it lives in the chart, no
// mode to enter). v1's three-free modules as they are, wired as v1's src/sail/chart.js attachChart wires them for Sail:
//   src/sail/passagePlan.js   the 'course' service (ensureCourse: the route, Set course, the legs, arrival) and the planner
//                             (createPlanner: each tap checked by the navigator's own rules, the route layer, the sheet, the
//                             skipper's lines, the first-time line under 'lakeshore.passage.v1', the legs advanced on arrival)
//   src/sail/passageSheet.js  the plan sheet beside the enlarged chart
//   src/ui/passage.js         the nav column's passage block (WP 1 · 3, DTW, BTW, TTG, XTE), fed by the course
// The planner's chart is v1's navigator chart built from the baked grid (planChart.js, loaded after the first frame); until it is
// in, a tap waits for it (kept, then played in order). Cruise: the course steps aside (suspended: the column shows Cruise's mark),
// the route leaves the chart and each tap goes to Cruise's mark (cruisePick: v2/cruise/index.js pickDestination; fix 2026-11-15,
// owner: "in Cruise the chart does not work at all": the tap did nothing). Sail: the planner's chart is the whole lake (planChart.js;
// it was v1's navigator region, the bay and its mouth, until the whole-lake chart), so a tap anywhere on the lake is checked and
// routed by the navigator. A new waypoint it cannot take for want of a way (past the lake's box: "off"; no safe way, e.g. the open
// lake from inside the bay's bar: "route") goes to Sail's own mark instead (offChart(p, reason): ui/sailMark.js place, whose own
// checks answer for it; drawn on the chart), so a tap on far water still lights the beacon (fix 2026-11-15) as before; land, the
// shallows and a crowded shore keep the planner's own line.
//   const plan = mountPlan({ services, cp, flags, clock, chartP, isTouch, say, cruisePick, offChart });
//   chartplotter onPick: plan.pick(p); each frame before cp.update: plan.update(dt); plan.setMode('sail' | 'cruise')
import { ensureCourse, createPlanner, courseLine } from '../../src/sail/passagePlan.js';
import { parseRoute } from '../../src/sail/chart.js';
import { checkDestination, DEST_SAY } from '../../src/sim/modes/chill/navigator.js';
// the lean skipper's kinds for the planner's lines (v2/ui/leanSkipper.js): a tap refused with the reason (the navigator's DEST_SAY) is
// MUST, the first open's how-to a tip, the course's set, advance, arrive and cleared lines statuses
const REFUSED = new Set(Object.values(DEST_SAY));
const FIRST = new Set([courseLine('first', { touch: false }), courseLine('first', { touch: true })]);
export const planKind = (text) => (REFUSED.has(text) ? 'refuse.plan' : FIRST.has(text) ? 'tip.plan' : 'plan.status');

export function mountPlan({ services, cp, flags = {}, clock = null, chartP, isTouch = () => false, say = null, cruisePick = null, offChart = null }) {
  const course = ensureCourse(services);
  const routeFlag = parseRoute(flags.route);   // ?route=x,z;x,z: a route drawn at the start (captures, probes; v1's row)
  if (routeFlag.length) course.setRoute(routeFlag);
  const core = { services, flags, clock: clock?.hourAt ? { hourAt: (t) => clock.hourAt(t) } : null, get time() { return clock?.t ?? 0; } };
  let planner = null, chart = null, mode = 'sail', failed = null;
  const queue = [];
  const sayFn = say ?? ((text) => services.get('hint')?.flash?.(text, { secs: 5, kind: planKind(text) }));   // reply: the plan answers the player's own taps (a phone keeps it)   // Sail: the skipper's line under the top bar (v1's)
  const ready = Promise.resolve(chartP).then((c) => {
    chart = c;
    planner = createPlanner({ core, cp, course, mode: 'sail', navChart: () => chart, isTouch, say: sayFn });
    if (mode !== 'sail') away();
    for (const p of queue.splice(0)) sailPick(p);
    return planner;
  }).catch((e) => { failed = e; console.error(e); return null; });
  function away() { course.suspend(); cp.setRoute([], {}); planner?.sheet.update(false); }
  // Sail's tap: the planner, or Sail's mark when the navigator has no way there (a new waypoint only: a drag or a removal stays).
  // The check is the planner's own (from the waypoint before it, or the boat)
  const past = (p) => { const R = chart?.region; return !!R && (p.x < R.x0 || p.x > R.x1 || p.z < R.z0 || p.z > R.z1); };
  function noWay(p) {
    if (past(p)) return 'off';
    if (!chart?.marginAt) return null;
    const r = course.route, i = p.index ?? r.length, prev = i > 0 ? r[i - 1] : services.get('player')?.phys?.state ?? null;
    const c = checkDestination(chart, p.x, p.z, { from: prev ? [prev.x, prev.z] : null, snapM: p.name ? 260 : 0 });
    return !c.ok && (c.reason === 'route' || c.reason === 'off') ? c.reason : null;
  }
  function sailPick(p) {
    if (offChart && (p.op === 'add' || p.op === 'insert')) { const why = noWay(p); if (why) return offChart(p, why); }
    return planner ? planner.pick(p) : null;
  }
  return {
    course, ready,
    get planner() { return planner; }, get chart() { return chart; }, get failed() { return failed; },
    pick(p) { if (mode !== 'sail') return cruisePick?.(p) ?? null; if (chart) return sailPick(p); queue.push(p); return null; },
    // the live chart's Add waypoint (owner, 2026-11-18): the navigator's own check from the last waypoint (or the boat), before the pick;
    // null until the chart is in. → { ok, reason, say, at }
    check(x, z) {
      if (!chart) return null;
      const r = course.route, prev = r.length ? r[r.length - 1] : services.get('player')?.phys?.state ?? null;
      return checkDestination(chart, x, z, { from: prev ? [prev.x, prev.z] : null });
    },
    update(dt) { if (mode === 'sail') planner?.update(dt); },
    setMode(m) {
      const next = m === 'cruise' ? 'cruise' : 'sail';
      if (next === mode) return;
      mode = next;
      if (mode === 'cruise') away(); else { course.resume(); planner?.recompute(); }
    },
    dispose() { planner?.dispose(); },
  };
}
