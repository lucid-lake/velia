// Sail's chartplotter: src/ui/chartplotter.js wired to the boat, the world's own layouts, the
// logbook's track and the traffic. Live pages only (?headless never builds it, so captures and goldens hold).
//   - the boat: the physics' state (position, heading, speed and course over ground, the true wind at the boat);
//   - the track: the logbook's line (the same points), plus the boat now;
//   - the targets: the AI sloops and the paddlewheeler on the scene clock (core.time), as AIS targets;
//   - hidden while the logbook or the menu is open (both are cards over its corner);
//   - pro: ?pro=1, or the controls' pro flag (feat/pro-sailing: controls.pro), or setPro() from the skill model
//     (feat/mastery's "pro controls unlocked"); the trend from the instruments (feat/pro-sailing: instruments.trend).
// ?chart=1 opens it at the start (captures, probes); ?chart=big pins it enlarged.
import { createChartplotter } from '../ui/chartplotter.js';
import { buildChart } from '../ui/logbookChart.js';
import { ensureCourse, createPlanner } from './passagePlan.js';

// ?route=x,z;x,z (world metres) → [{ x, z }]; anything that does not parse is left out
export const parseRoute = (s) => (typeof s === 'string' ? s.split(';').map((p) => p.split(',').map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite)).map(([x, z]) => ({ x, z })) : []);

// opts.onPick({ x, z, name }): Cruise's destination pick on the enlarged chart (chartplotter.js); api.setDestination draws the mark
// opts.marks: the racing marks (src/marks/scene.js); its course tool goes on the enlarged chart
// opts.plan: the passage plan on the enlarged chart (src/sail/passagePlan.js): true for Sail's (guidance only),
// or { mode: 'cruise', navChart, say, onEdit } for Cruise's (its navigator sails the route); none in Regatta (the course tool
// owns the chart there, and a course set elsewhere is suspended)
export function attachChart(core, { phys }, controls, logbook, { onPick = null, marks = null, plan = false } = {}) {
  const { flags, terrain, shoreline, harbour, traffic, services } = core;
  const planOpt = plan === true ? {} : plan || null;
  let planner = null;
  const H = harbour.layout.entrance.centre;
  const places = buildChart(terrain, { shoreline: shoreline.layout, harbour: { x: H[0], z: H[1] } }).places;
  const nowPt = { x: 0, z: 0, v: 0 };
  let proSet = null;   // setPro() from outside (the skill model); null: follow ?pro and the controls
  const isPro = () => proSet ?? (controls?.pro === true || flags.pro === '1');
  const cp = createChartplotter({
    terrain, shoreline: shoreline.layout, harbour: harbour.layout, places,
    boat: () => phys.state,
    track: () => {
      const tr = logbook?.track ?? services.get('logbook')?.track ?? [];
      const s = phys.state; nowPt.x = s.x; nowPt.z = s.z; nowPt.v = s.sog;
      return tr.length ? [...tr, nowPt] : tr;
    },
    targets: () => {
      if (!traffic) return [];
      const t = core.time, out = [];
      if (traffic.paddlewheeler) try { out.push(traffic.paddlewheeler.poseAt(t)); } catch { /* no route */ }   // none unless ?props=1
      for (const b of traffic.sailboats ?? []) { try { out.push(b.poseAt(t)); } catch { /* skip */ } }
      return out;
    },
    // the kayakers (src/kayaks/fleet.js marks): small paddle marks, the small chart's range and the cockpit's chart dial too
    kayaks: () => services.get('kayaks')?.marks?.() ?? [],
    sunElevDeg: () => core.sun?.elevationDeg ?? 20,
    trend: () => services.get('boat')?.instruments?.trend ?? null,
    hidden: () => !!services.get('logbook')?.logbook?.isOpen || !!services.get('menu')?.isOpen,   // the menu and the logbook are cards over this corner (2026-10-30)
    pro: isPro(), onPick: planOpt ? (p) => planner?.pick(p) : onPick, plan: !!planOpt,
    course: marks?.chart ?? null,   // the racing marks' course tool (src/marks/scene.js)
    // the passage plan: the wind field for the barbs (its 60 s mean, chartplotterData.js barbGrid)
    windAt: core.wind?.sample ? (x, z, t) => core.wind.sample(x, z, t) : null, time: () => core.time ?? 0,
  });
  const open = flags.chart;
  if (open === '1' || open === 'small') cp.toggle.shown = true;
  if (open === 'big') { cp.toggle.shown = true; cp.toggle.pin(); }
  // ?route=x,z;x,z: a route drawn at the start (captures, probes)
  const routeFlag = parseRoute(flags.route);
  if (planOpt) {
    const course = ensureCourse(services);
    if (routeFlag.length) course.setRoute(routeFlag);
    const touch = () => document.documentElement.dataset.input === 'touch';
    planner = createPlanner({ core, cp, course, mode: planOpt.mode ?? 'sail', navChart: planOpt.navChart ?? null, isTouch: touch, onEdit: planOpt.onEdit ?? null,
      say: planOpt.say ?? ((text) => services.get('hint')?.flash?.(text, { secs: 5 })) });   // Sail: the skipper's line under the top bar
  } else {
    services.get('course')?.suspend?.();
    if (routeFlag.length) cp.setRoute(routeFlag);
  }
  let lastPro = isPro();
  const api = {
    update(dt) {
      const p = isPro(); if (p !== lastPro) { lastPro = p; cp.setPro(p); }
      planner?.update(dt);
      cp.update(dt);
    },
    setPro(on) { proSet = on == null ? null : !!on; },
    setDestination: (d) => cp.setDestination(d), get state() { return cp.state; }, cp, get planner() { return planner; },
    dispose() { planner?.dispose(); cp.dispose(); services.remove('chart', pub); },
  };
  const pub = { chart: cp, toClient: (x, z) => cp.toClient(x, z), setPro: api.setPro, get state() { return cp.state; }, get plan() { return cp.plan; }, stats: () => cp.stats(), get planner() { return planner; } };
  services.provide('chart', pub);   // tools/probe_chart.mjs
  return api;
}
