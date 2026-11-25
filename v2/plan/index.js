// Plan (phase 1, 2026-11-25): the long passage, sailed on the chart. Its own chunk (main.js loads it for ?mode=plan or the mode
// switch). The chart page is the screen with the boat under way: the player lays corners on the water, the pilot (Cruise's
// navigator and AI skipper, src/sim/modes/chill/) sails them over the whole-lake chart (ui/planChart.js: A* off land and shoal with
// the plan margin), the day clock is locked to the sim and runs at the rate the player sets (‖ ×1 ×4 ×16 ×60), slowing itself to ×1
// at the moments worth watching. Take the helm zooms into the boat and hands her over where she is; the chart (N, the Chart dial, the
// menu) hands her back to the pilot. One sim: only the picture and the rate change.
//   const p = createPlan({ B, windField, clock, flags, chart: () => Promise<planChart>, sun, tessie, onMode, setStepCap })
//   await p.enter() / p.leave()       the mode switch (plan.js PLAN_SWITCH)
//   p.on, p.helm ('pilot' | 'player'), p.speed()   the sim seconds a real second runs (main.js's clock.advance)
//   p.step(simDt, dt) → true while the pilot has the boat (main.js steps nothing else); false at the helm (Sail's hands)
//   p.update(dt)                      each live frame (real seconds): the rate's ease, the auto-slow, the handover's timer, the UI
//   p.addCorner(x, z) → { ok, say? }, p.removeCorner(i), p.clear(), p.setRate(r), p.takeHelm(), p.toChart()
//   p.mountUi(u)                      the rail, the passage panel and the map's layer (plan/ui.js, plan/mapLayer.js) on Sail's UI
//   p.stats()                         the page tests' and tools' read
import { Navigator, scenicRoute, checkDestination, NAV } from '../../src/sim/modes/chill/navigator.js';
import { CruisePilot } from '../../src/sim/modes/chill/pilot.js';
import { handoverTrim } from '../../src/sim/ai/skipper.js';
import { Helm } from '../../src/sim/boat.js';
import { createChannelHelm } from '../sim/channelHelm.js';
import { sailSchedule } from '../engine/clock.js';
import { DEFAULT_TIMERATE } from '../../src/sim/timeOfDay.js';
import { PLAN, lockClock, stepCap, createRate, createAutoSlow, createFold, legsOf, debounce, SLOW_WORDS, hm } from './plan.js';

const DEG = Math.PI / 180;
// Sail's day clock again on leaving (ui/modeSwitch.js sailClock's rule; not imported: the mode table reaches this chunk)
function sailClock(clock, flags = {}) {
  if (!clock || clock.mode === 'frozen' || (flags.timerate != null && flags.timerate !== '')) return false;
  if (clock.mode === 'rate') clock.setRate(DEFAULT_TIMERATE, clock.t); else clock.setSchedule?.(sailSchedule(), clock.t);
  return true;
}

export function createPlan({ B, windField, clock, flags = {}, P = {}, chart: chartLoad, sun = () => 20, tessie = () => null, onMode = () => {},
  setStepCap = () => {}, live = !P.headless, seed = P.seed ?? 1 } = {}) {
  let on = false, helm = 'pilot', attached = false, nav = null, pilot = null, lane = null, laneHelm = null, chart = null;
  let corners = [], legs = [], legBase = 0, arrivedAll = false, handing = null, ui = null, wantChart = false, lastSlow = null, slows = 0, menuWas = false, closing = false;
  const rate = createRate({ rate: 1 }), auto = createAutoSlow(), fold = createFold();
  const errors = [];
  const ready = (async () => {
    chart = await chartLoad();
    nav = new Navigator({ chart, route: scenicRoute(chart, { seed }), seed });
    pilot = new CruisePilot({ nav, skill: 1, seed, windAt: (x, z, t) => B.env(t).windAt(x, z, t), vessel: B.phys.vessel });
    lane = chart.channel ? createChannelHelm({ chart }) : null; laneHelm = new Helm({ rudderMaxDeg: B?.phys?.P?.rudder?.maxDeg });
    return chart;
  })();
  ready.catch((e) => errors.push(`plan chart: ${e?.message ?? e}`));

  // one tick of the pilot (Cruise's voyage.js tick): the navigator plans, the skipper trims and steers; down the bay's channel on its line
  const tick = (t, dt) => {
    pilot.update(dt, B.phys.state, B.ctl, { t, sunElevDeg: sun(), traffic: null });
    const was = !!lane?.active, h = lane?.heading(B.phys.state, nav.target?.at ?? null);
    if (h != null) { B.ctl.rudder = laneHelm.toHeading(B.phys.state, h, Math.max(dt, 1e-3)); B.ctl.jibSide = 0; }
    else if (was) nav.path = null;
  };
  const legNow = () => (arrivedAll ? corners.length : legBase + (nav?.routePts ? nav.routeI : 0));
  function attach() {
    if (attached || !nav || !corners.length || arrivedAll) return false;
    B.sea?.reset?.();
    B.ctl.furl = 0; B.ctl.throttle = null;
    const eng = B.phys.engine; eng?.stop?.(); eng?.setLever?.(0);
    const o = pilot.skipper.out, c = B.ctl;   // the skipper picks the trim up as it is (Cruise's hand-back)
    Object.assign(o, { sheet: c.sheet ?? B.state.mainSheet, traveller: c.traveller ?? 0, twist: c.twist ?? 0, backstay: c.backstay ?? B.state.backstay ?? 0, jibLead: c.jibLead ?? 0 });
    nav.path = null; nav.nextDecide = -Infinity;
    B.drive(tick); attached = true; return true;
  }
  function detach() {
    if (!attached) return false;
    B.drive(null); attached = false;
    const trim = handoverTrim(pilot.skipper);   // Sail's hands take the skipper's trim, the helm on the heading she is on
    B.hand.sheet = trim.sheet ?? B.hand.sheet; B.hand.start = false;
    Object.assign(B.ctl, { traveller: trim.traveller, twist: trim.twist, backstay: trim.backstay, jibLead: trim.jibLead });
    return true;
  }
  // the navigator's route: the corners not yet reached (a corner laid while sailing keeps her progress)
  function routeNav() {
    if (!nav) return;
    const from = Math.min(legNow(), corners.length);
    const rest = corners.slice(from);
    legBase = from;
    if (!rest.length) { nav.clearDestination(); return; }
    arrivedAll = false; nav.arrived = null;
    nav.setRoute(rest.map((c, k) => ({ at: c, name: `corner ${from + k + 1}` })));
    if (rest.length === 1) { nav.routePts = [{ at: rest[0], name: `corner ${from + 1}` }]; nav.routeI = 0; nav.routeLeg(); }   // one corner: still a route (its 40 m arrival, the same leg count)
    if (on && helm === 'pilot') attach();
  }
  const windAt = (x, z, dh) => { const t = clock.t + dh * 3600 / Math.max(1e-6, clock.rate || 1); const w = windField.sample(x, z, t); return { speed: w.speed, dirDeg: w.dirDeg }; };
  const relegs = () => { const b = B.state; legs = chart ? legsOf([b.x, b.z], corners.slice(legNow()), { route: (a, c) => chart.route(a, c), windAt }) : []; legs.forEach((L) => { L.i += legNow(); }); ui?.paint?.(); };
  const relegsSoon = live ? debounce(relegs, PLAN.debounceMs) : Object.assign(relegs, { flush: relegs, cancel() {} });

  function addCorner(x, z) {
    if (!chart) return { ok: false, say: 'The chart is still loading. Try again in a moment.' };
    const prev = corners.length > legNow() ? corners.at(-1) : [B.state.x, B.state.z];
    const r = checkDestination(chart, x, z, { from: prev });
    if (!r.ok) return { ok: false, say: r.say ?? 'No safe way there.' };
    corners.push([r.at[0], r.at[1]]);
    routeNav(); relegsSoon(); fold.press();
    return { ok: true, at: r.at, i: corners.length };
  }
  function removeCorner(i) {
    if (i < legNow() || i >= corners.length) return false;
    corners.splice(i, 1); routeNav(); relegsSoon(); return true;
  }
  function clear() { corners = []; legs = []; legBase = 0; arrivedAll = false; detach(); nav?.clearDestination(); ui?.paint?.(); }

  // the rate: a press is what runs (a cut), the auto-slow and the handover ease (never a cut from ×60)
  function setRate(r, { ease = false } = {}) {
    if (!rate.set(r, { ease })) return false;
    setStepCap(stepCap(Math.max(rate.rate, rate.target), clock.dt));
    auto.rearm({ windDir: windNow()?.dirDeg });
    fold.press(); ui?.paint?.();
    return true;
  }
  const windNow = () => { const s = B.state; try { return windField.sample(s.x, s.z, clock.t); } catch { return null; } };

  // the handover: Take the helm zooms the chart into the boat (0.9 s) while the rate eases to ×1; then Sail's hands where she is
  function takeHelm({ now = false } = {}) {
    if (!on || helm === 'player' || handing) return false;
    rate.set(1, { ease: true });
    ui?.zoomToBoat?.(PLAN.helmZoomS, PLAN.helmMpp);
    handing = { t: 0, dur: now || !ui ? 0 : PLAN.helmZoomS };
    if (handing.dur === 0) finishHelm();
    return true;
  }
  function finishHelm() {
    handing = null;
    detach(); helm = 'player';
    const L = legs.find((l) => l.i === legNow() + 1) ?? null;
    closing = true; ui?.closeChart?.(); closing = false;
    ui?.plate?.(L ? `Leg ${L.i} of ${corners.length} · ${String(Math.round(L.course)).padStart(3, '0')}°T · ${L.nm.toFixed(1)} nm to corner ${L.i}` : 'You have the helm', PLAN.plateS);
  }
  // and back: the chart (N, the Chart dial, the menu) gives her to the pilot from where she is; the rate stays as it is
  function toChart() {
    if (!on) return false;
    if (helm === 'player') { helm = 'pilot'; attach(); relegsSoon(); }
    fold.set(false); ui?.paint?.();
    return true;
  }

  function autoSlow() {
    const s = B.state, c = corners[legNow()], w = windNow();
    let gustAhead = null;
    if (windField.baseAt) { const ax = s.x + Math.sin(s.heading) * PLAN.gustAheadM, az = s.z - Math.cos(s.heading) * PLAN.gustAheadM; try { gustAhead = windField.sample(ax, az, clock.t).speed / Math.max(0.1, windField.baseAt(ax, az, clock.t)); } catch { gustAhead = null; } }   // the gust factor ahead: the wind there over its base
    const tz = tessie();
    const why = auto.step({ rate: rate.target, t: clock.t, sog: s.sog ?? Math.hypot(s.u ?? 0, s.v ?? 0), corner: c && attached ? { i: legNow(), dist: Math.hypot(c[0] - s.x, c[1] - s.z), last: legNow() === corners.length - 1 } : null,
      arrived: arrivedAll, windDir: w?.dirDeg, gustAhead, tessieM: tz ? Math.hypot(tz.x - s.x, tz.z - s.z) : null, sunElev: sun() });
    if (!why) return null;
    rate.set(1, { ease: true }); lastSlow = { why, word: SLOW_WORDS[why], hour: clock.hour }; slows++;
    fold.set(true); ui?.paint?.();
    return why;
  }

  const menuOpen = () => !!ui?.menuOpen?.();
  const p = {
    ready, errors,
    get on() { return on; }, get helm() { return helm; }, get attached() { return attached; }, get nav() { return nav; }, get chart() { return chart; },
    get corners() { return corners.map((c) => [...c]); }, get legs() { return legs; }, get leg() { return legNow(); }, get fold() { return fold; }, get rate() { return rate; },
    get lastSlow() { return lastSlow; }, get handing() { return !!handing; },
    async enter() {
      await ready;
      if (on) return p;
      on = true; helm = 'pilot'; arrivedAll = false;
      lockClock(clock, flags);
      rate.set(1, { ease: false }); auto.reset(); auto.rearm({ windDir: windNow()?.dirDeg });
      fold.set(true);
      if (corners.length) routeNav();
      wantChart = true;
      onMode('plan');
      ui?.show?.(true);
      return p;
    },
    leave() {
      if (!on) return p;
      on = false; handing = null; wantChart = false;
      detach(); helm = 'pilot';
      rate.set(1, { ease: false }); setStepCap(stepCap(0));
      sailClock(clock, flags);
      ui?.show?.(false);
      return p;
    },
    speed: () => (on ? rate.rate : P.speed ?? 1),
    step(simDt, dt) {
      if (!on || helm !== 'pilot') return false;
      if (simDt > 0) B.step(simDt, null, dt);
      return true;
    },
    // the clock's state after the frame (the pilot's arrival, the next corner)
    update(dt) {
      if (!on) return;
      rate.step(dt);
      setStepCap(stepCap(Math.max(rate.rate, rate.target), clock.dt));
      if (nav && attached && nav.arrived && !nav.routePts) { arrivedAll = true; nav.arrived = null; detach(); B.ctl.rudder = 0; legs = []; ui?.paint?.(); }
      autoSlow();
      if (handing) { handing.t += dt; if (handing.t >= handing.dur) finishHelm(); }
      // the menu is the chart page: opened at the helm it hands her back; closed while the pilot sails (Esc, ×, Resume) is the helm
      const mo = menuOpen();
      if (ui && wantChart && ui.canOpen?.()) { wantChart = false; ui.openChart?.(); }
      else if (ui && mo !== menuWas) {
        if (mo && helm === 'player') toChart();
        else if (!mo && helm === 'pilot' && !closing && !handing && !wantChart) { handing = { t: 0, dur: 0 }; rate.set(1, { ease: true }); finishHelm(); }
      }
      menuWas = menuOpen();
      fold.step(dt, { inside: !!ui?.inside?.(), passage: corners.length > legNow() });
      ui?.update?.(dt);
    },
    addCorner, removeCorner, clear, setRate, takeHelm, toChart,
    open: () => { fold.set(true); ui?.paint?.(); }, foldNow: () => { fold.set(false); ui?.paint?.(); },
    // what the rail and the panel say (plan/ui.js reads it; the tests too)
    summary() {
      const s = B.state, w = windNow(), total = legs.reduce((a, L) => a + L.hrs, 0), nm = legs.reduce((a, L) => a + L.nm, 0);
      return { corners: corners.length, leg: legNow(), legs, nm, hours: total, arrive: legs.length ? clock.hour + total : null, arriveWord: legs.length ? hm(clock.hour + total) : '—',
        windKn: w ? w.speed / 0.514444 : 0, windDir: w ? w.dirDeg : 0, hour: clock.hour, rate: rate.target, helm, arrived: arrivedAll, sog: (s.sog ?? 0) / 0.514444, lastSlow };
    },
    boatState: () => B.state,
    relegs: () => relegsSoon.flush?.() ?? relegs(),
    mountUi(u) {
      if (!live || ui) return;
      Promise.all([import('./ui.js'), import('./mapLayer.js')]).then(([{ mountPlanUi }, { mountPlanMap }]) => {
        ui = mountPlanUi({ plan: p, services: u.services, map: (o) => mountPlanMap({ ...o, plan: p, B, windField, clock }) });
        if (on) ui.show(true);
      }).catch((e) => { errors.push(`plan ui: ${e?.stack ?? e}`); console.error(e); });
    },
    stats: () => ({ on, helm, attached, rate: +rate.rate.toFixed(3), target: rate.target, corners: corners.length, leg: legNow(), legs: legs.length, arrived: arrivedAll,
      slow: lastSlow, slows, fold: fold.open ? 'open' : 'rail', clockRate: clock.rate, hour: clock.hour, t: clock.t, handing: !!handing, ui: !!ui, errors: errors.slice(0, 3),
      dest: nav?.dest ? { at: nav.dest.at, routeI: nav.dest.routeI ?? null } : null, heading: B.state.heading / DEG }),
  };
  return p;
}
