// The passage plan (owner go 2026-11-12 with every § 9 default): the enlarged chart is the planner, with no
// mode to enter. A tap on the water adds a waypoint, a tap on a name sails there; Set course starts the guidance.
//
//   createCourse({ services })   the 'course' service, mode-independent (it outlives the chart and a mode change):
//     route [{ x, z, name }], active (bool), leg, from ([x, z] the leg's start), edit(op) → the new route | null,
//     set(boat) (Set course: the route copied, leg 0, from the boat), clear(), arrive(boat) → { kind: 'advance' | 'arrive' } | null
//     (within PLAN.arriveM of the active waypoint: the next leg starts from it; the last clears the route), suspend() / resume()
//     (Regatta's chart has no plan: the passage block goes back to the race's mark), onChange(fn) → off.
//     While a course is active it feeds the 'passage' service (src/ui/passage.js): the nav column's passage block and the leg.
//   createPlanner({ core, cp, course, mode, navChart, say, live })   the chart's side: validates each tap with the navigator's
//     own checks (dry land, shallows, no safe way: checkDestination's words), keeps the chart's route layer and the plan
//     sheet in step (routePlan at most once a second, and on every edit), says the skipper's lines, and in Sail advances the
//     legs on arrival. mode 'sail' (guidance only: the player steers; owner decision 3) or 'cruise' (src/modes/chill: the
//     navigator sails it; live: no Set course, every edit is in force).
//   ensureCourse(services)        the one course service (provided on first use)
//   courseLine(kind, …)           the skipper's lines, pure (tests)
import { routePlan, clearWidth, windLine, editRoute, PLAN } from '../ui/chartplotterData.js';
import { buildChart, findPath, checkDestination } from '../sim/modes/chill/navigator.js';
import { createPassageSheet } from './passageSheet.js';

const DEG = 180 / Math.PI;
const KN = 0.514444;
const pad3 = (d) => String(Math.round(d) % 360).padStart(3, '0');
const nm1 = (nm) => (nm < 10 ? nm.toFixed(1) : String(Math.round(nm)));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// the passage block's MARK: "WP 1 · 3", or the place's name on the last leg
export const markName = (i, n, name) => (name && i === n - 1 ? name : `WP ${i + 1} · ${n}`);
const wpWord = (i, name) => (name ? cap(name) : `Waypoint ${i + 1}`);

export function courseLine(kind, { i = 0, name = null, leg = null, n = 0, minutes = null, touch = false } = {}) {
  const how = leg?.point === 'beat' ? ' A beat: tack on the laylines.' : leg?.point === 'run' ? ' A run: gybe down it.' : '';
  switch (kind) {
    case 'first': return touch ? 'Tap the water to add a waypoint. Tap a name to sail there.' : 'Click the water to add a waypoint. Click a name to sail there.';
    case 'set': return `Course set. ${wpWord(i, name)} bears ${pad3(leg.brg)}°, ${nm1(leg.distNm ?? leg.nm)} nm.${how}`;
    case 'advance': return `${wpWord(i, name)} astern. Next bears ${pad3(leg.brg)}°, ${nm1(leg.distNm ?? leg.nm)} nm.${how}`;
    case 'arrive': return name ? `Arrived: ${name}. Course done.` : 'Arrived at the last waypoint. Course done.';
    case 'cleared': return 'Course cleared.';
    case 'cruise': return n <= 1 ? (name ? `Aye. Making for ${name}.` : 'Aye. Setting a course for your mark.')
      : `Aye. ${cap(NUM[n] ?? String(n))} legs to ${name ?? 'your mark'}${minutes != null ? `, about ${Math.max(1, Math.round(minutes))} minute${Math.max(1, Math.round(minutes)) === 1 ? '' : 's'}` : ''}.`;
    default: return '';
  }
}

export function createCourse({ services = null } = {}) {
  let route = [], active = null, suspended = false;
  const fns = new Set();
  const passage = () => services?.get?.('passage') ?? null;
  const copy = (r) => r.map((p) => ({ x: p.x, z: p.z, name: p.name ?? null }));
  function push() {
    const p = passage(); if (!p) return;
    if (!active || suspended) { if (p.target?.kind === 'route') p.clear(); return; }
    const n = active.route.length, w = active.route[active.leg];
    p.set({ x: w.x, z: w.z, name: markName(active.leg, n, w.name), kind: 'route' }, active.from);
  }
  const emit = (kind) => { push(); for (const f of fns) f(kind); };
  const api = {
    get route() { return copy(route); },
    get active() { return !!active; },
    get leg() { return active ? active.leg : -1; },
    get from() { return active?.from ?? null; },
    edit(op) {
      const r = editRoute(route, op); if (!r) return null;
      route = r;
      if (active) {
        if (!route.length) active = null;
        else { if (op.op === 'remove' && op.index < active.leg) active.leg--; else if ((op.op === 'add' || op.op === 'insert') && op.index < active.leg) active.leg++; active.leg = Math.min(active.leg, route.length - 1); active.route = copy(route); }
      }
      emit('edit');
      return copy(route);
    },
    setRoute(pts, { activeLeg = null, from = null } = {}) {
      route = copy(pts ?? []);
      active = route.length && activeLeg != null ? { route: copy(route), leg: Math.min(activeLeg, route.length - 1), from } : active && route.length ? { ...active, route: copy(route), leg: Math.min(active.leg, route.length - 1) } : null;
      emit('edit');
    },
    set(boat) {
      if (!route.length) return false;
      active = { route: copy(route), leg: 0, from: boat ? [boat.x, boat.z] : null };
      emit('set');
      return true;
    },
    clear() { const had = route.length > 0 || !!active; route = []; active = null; emit('clear'); return had; },
    // the boat within PLAN.arriveM of the active waypoint: the next leg, from that waypoint; the last clears the course
    arrive(boat, arriveM = PLAN.arriveM) {
      if (!active || !boat) return null;
      const w = active.route[active.leg];
      if (Math.hypot(boat.x - w.x, boat.z - w.z) >= arriveM) return null;
      const i = active.leg;
      if (i + 1 < active.route.length) { active.leg++; active.from = [w.x, w.z]; emit('advance'); return { kind: 'advance', i, wp: w, next: active.route[active.leg] }; }
      route = []; active = null; emit('arrive');
      return { kind: 'arrive', i, wp: w };
    },
    suspend() { suspended = true; push(); },
    resume() { suspended = false; push(); },
    onChange(f) { fns.add(f); return () => fns.delete(f); },
  };
  return api;
}

// the one course: provided on first use, kept for the page (a mode change and Cruise's hand-over keep it)
export function ensureCourse(services) {
  let c = services.get('course');
  if (!c) { c = createCourse({ services }); services.provide('course', c); }
  return c;
}

// navChart: () => the navigator's chart (buildChart; Sail builds one lazily from the core's layouts); say(text): the skipper's
// line (Sail: the hint's status line; Cruise: its one quiet line)
export function createPlanner({ core, cp, course, mode = 'sail', navChart = null, say = () => {}, live = mode === 'cruise', isTouch = () => false, onEdit = null } = {}) {
  const { services, flags } = core;
  const boat = () => services.get('player')?.phys?.state ?? null;
  let nc = null;
  const chart = () => (nc ??= navChart ? navChart() : buildChart(core.terrain, { shoreline: core.shoreline?.layout ?? null, harbour: core.harbour?.layout ?? null, lanes: [] }));
  const sheet = createPassageSheet({ anchor: () => cp.el.querySelector('.big') });
  // the wind at the boat, its 60 s mean (the plan does not jump with a gust)
  let wv = null, windAge = 0;
  const wind = () => {
    if (!wv) return { windFrom: 0, twsKn: 0 };
    return { windFrom: Math.atan2(wv[0], -wv[1]), twsKn: Math.hypot(wv[0], wv[1]) / KN };
  };
  const env = () => {
    const c = chart(), w = wind();
    return { ...w, path: (a, b) => findPath(c, a, b), depthAt: c.depthAt, widthAt: (x, z, b) => clearWidth(c.marginAt, x, z, b), gates: c.gates,
      hourAt: core.clock?.hourAt ? (t) => core.clock.hourAt(t) : null, t: core.time ?? 0 };
  };
  let plan = null, since = Infinity, firstSaid = false, lastWind = null;
  const from = () => (course.active ? course.leg : 0);
  function recompute() {
    since = 0;
    const s = boat(), r = course.route;
    if (!s || !r.length) { plan = null; cp.setRoute(r, { active: course.active ? course.leg : -1, live }); return; }
    plan = routePlan({ x: s.x, z: s.z }, r.slice(from()), env());
    cp.setRoute(r, { active: course.active ? course.leg : -1, plan, live });
    const w = wind();
    sheet.render(plan, { active: 0, wind: w.twsKn > 0.5 ? windLine(w.windFrom, w.twsKn) : '' });
    lastWind = w;
  }
  const off = course.onChange(() => recompute());
  // a tap's edit, checked as the navigator checks a destination (from the waypoint before it, or the boat)
  function pick(p) {
    const s = boat();
    if (p.op === 'set') {
      if (!course.set(s)) return;
      const L = plan?.legs?.[0], w = course.route[0];
      if (mode === 'sail' && L) say(courseLine('set', { i: 0, name: w.name, leg: L }));
      return;
    }
    if (p.op === 'clear') { if (course.clear()) say(mode === 'cruise' ? 'Mark cleared. Back to the scenic round.' : courseLine('cleared')); onEdit?.(p); return; }
    if (p.op === 'add' || p.op === 'insert' || p.op === 'move') {
      const r = course.route, i = p.op === 'move' ? p.index : p.index ?? r.length, prev = i > 0 ? r[i - 1] : s;
      const c = checkDestination(chart(), p.x, p.z, { from: prev ? [prev.x, prev.z] : null, snapM: p.name ? 260 : 0 });
      if (!c.ok) { say(c.say); recompute(); return; }
      p = { ...p, x: c.at[0], z: c.at[1] };
    }
    course.edit(p);
    onEdit?.(p);
  }
  let wasBig = false;
  function update(dt) {
    const s = boat();
    if (s?.trueWind && s.trueWind.speed > 0) {   // the true wind's FROM vector at the boat, a 60 s mean (shorter while the mean is young)
      const from = s.heading + s.trueWind.angle, vx = Math.sin(from) * s.trueWind.speed, vz = -Math.cos(from) * s.trueWind.speed;
      windAge += dt;
      const k = wv ? 1 - Math.exp(-dt / Math.min(PLAN.barbMeanS, Math.max(0.5, windAge))) : 1;
      wv = wv ? [wv[0] + (vx - wv[0]) * k, wv[1] + (vz - wv[1]) * k] : [vx, vz];
    }
    const big = !!cp.el.querySelector('.big')?.classList.contains('in');
    if (mode === 'sail' && course.active && s) {
      const ev = course.arrive(s);
      if (ev?.kind === 'advance') { const L = plan?.legs?.[0]; if (L) say(courseLine('advance', { i: ev.i, name: ev.wp.name, leg: L })); }
      else if (ev?.kind === 'arrive') say(courseLine('arrive', { name: ev.wp.name }));
    }
    // the first time the enlarged chart opens (per browser; every time with ?once=0): how to plan, in the skipper's line
    if (big && !wasBig && mode === 'sail' && !course.route.length && !firstSaid) {
      firstSaid = true;
      let seen = false;
      try { seen = flags.once !== false && flags.once !== '0' && globalThis.localStorage?.getItem('lakeshore.passage.v1') === '1'; } catch { seen = false; }
      if (!seen) { say(courseLine('first', { touch: isTouch() })); try { globalThis.localStorage?.setItem('lakeshore.passage.v1', '1'); } catch { /* private window */ } }
    }
    wasBig = big;
    since += dt;
    const w = wind(), moved = lastWind && (Math.abs(w.twsKn - lastWind.twsKn) >= 1 || Math.abs(Math.atan2(Math.sin(w.windFrom - lastWind.windFrom), Math.cos(w.windFrom - lastWind.windFrom))) * DEG >= 10);
    if (course.route.length && (moved || since >= (big ? PLAN.refreshS : 5))) recompute();
    sheet.update(big && course.route.length > 0);
  }
  course.resume();
  recompute();
  return { pick, update, recompute, courseLine, get plan() { return plan; }, sheet, dispose() { off(); sheet.dispose(); course.suspend(); } };
}
