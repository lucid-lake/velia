// Plan's pure facts (phase 1, 2026-11-25): the long passage sailed on the chart. No DOM, no GPU: v2/tests/plan-mode.test.mjs calls each one.
//   PLAN_RATES                 ‖ ×1 ×4 ×16 ×60: the sim seconds one real second runs; the day clock is locked to the sim
//   lockClock(clock, flags)    the day clock at 1 game s per sim s (an honest arrival time); a frozen clock (every capture
//                              and golden) or ?timerate stays as it is
//   createRate({ easeS })      the rate on screen: set(r) eases to r over easeS real seconds (never a cut from ×60), step(dt) → the rate now
//   createAutoSlow()           the clock slows itself to ×1 at a corner ahead, a wind shift over 20°, a gust lane ahead,
//                              Tessie within 300 m, the golden hour and the arrival; each fires once per event (edge-triggered)
//   createFold({ delayS })     the passage panel folds itself to the rail 6 s after the last press, never while the pointer is inside
//   legsOf(from, corners, o)   the passage's legs: course, distance, point of sail, the polar's speed at the leg's wind, the arrival time
//   PLAN_SWITCH                the mode table's hooks (engine/modes.js), as cruise/plan.js's
import { polarKn } from '../../src/sim/boat/groove.js';

export const PLAN_RATES = Object.freeze([0, 1, 4, 16, 60]);
export const PLAN = Object.freeze({
  easeS: 1,            // the rate's ease (the clock eases to ×1 over 1 s)
  foldS: 6,            // the panel folds 6 s after the last press
  helmZoomS: 0.9,      // Take the helm: the chart zooms into the boat (the entrance's own move)
  helmMpp: 1.6,        // how close the zoom ends (the entrance's)
  plateS: 9,           // the plate that names the leg
  shiftDeg: 20,        // a wind shift worth watching
  gustOn: 1.24, gustOff: 1.05, gustAheadM: 300, gustEveryS: 600,   // a gust lane ahead: the wind 300 m ahead along her heading over its base (the top 2 % of an evening's
                       // gusts off the bay: 1.16 was passed 10 % of the time), at most one each 10 game minutes
  tessieM: 300,        // Tessie's water within 300 m
  goldenDeg: 10,       // the golden hour: the sun sinking under +10° (ui.md: the day clock's golden band is −6° to +10°)
  cornerLeadS: 3,      // a corner ahead: within the distance three real seconds sail at this rate, plus cornerM
  cornerM: 60,
  closeHauledDeg: 44,  // the polar's best upwind angle (the navigator's NAV.closeHauledDeg)
  debounceMs: 120,     // a re-route after the last corner laid
});

const has = (v) => v != null && v !== '';
const KN = 1 / 0.514444;
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

// the day clock locked to the sim (one clock): true when it locked
export function lockClock(clock, flags = {}) {
  if (!clock || clock.mode === 'frozen' || has(flags.timerate)) return false;
  clock.setRate(1, clock.t);
  return true;
}
// the sim clock's step cap for a rate (engine/clock.js maxSteps): the page's longest frame (0.25 s, main.js) at the rate, never under the
// page's own cap (a slow frame at ×60 runs its 15 s of sim, not 6)
export const stepCap = (rate, step = 1 / 120, base = 20) => Math.max(base, Math.ceil((Math.max(0, rate) * 0.25) / step));

export const nextRate = (r) => PLAN_RATES[(Math.max(0, PLAN_RATES.indexOf(r)) + 1) % PLAN_RATES.length];
export const rateWord = (r) => (r ? `×${r}` : '‖');

export function createRate({ rate = 1, easeS = PLAN.easeS } = {}) {
  let now = rate, target = rate, from = rate, k = 1;
  return {
    get rate() { return now; }, get target() { return target; },
    // ease: false is a cut (the player's own press on the rate: what they pressed is what runs)
    set(r, { ease = true } = {}) { if (!PLAN_RATES.includes(r)) return false; target = r; if (!ease || easeS <= 0) { now = from = r; k = 1; } else { from = now; k = 0; } return true; },
    step(dt) {
      if (k >= 1) return now;
      k = Math.min(1, k + Math.max(0, dt) / easeS);
      const e = k * k * (3 - 2 * k);
      now = from + (target - from) * e;
      return now;
    },
  };
}

// q: { rate (the target now), t (sim s), x, z, heading (rad), sog (m/s), corner: { i, dist, last } | null, arrived, windDir (deg FROM), gustAhead,
// tessieM (m, or null), sunElev (deg) } → the reason ('corner' | 'arrival' | 'shift' | 'gust' | 'tessie' | 'golden') or null
export function createAutoSlow(o = PLAN) {
  const P = { ...PLAN, ...o };
  let ref = null, cornerSeen = -1, arrivedSeen = false, gustArmed = true, gustT = -Infinity, tessieArmed = true, sunWas = null, goldenSeen = false;
  return {
    // the reference wind and the armed states again (a press on the rate: "from here, tell me what changes")
    rearm(q = {}) { ref = Number.isFinite(q.windDir) ? q.windDir : null; },
    reset() { ref = null; cornerSeen = -1; arrivedSeen = false; gustArmed = true; gustT = -Infinity; tessieArmed = true; sunWas = null; goldenSeen = false; },
    step(q) {
      // the edges are tracked at every rate (so a moment passed at ×1 never fires late at ×16)
      let why = null;
      const c = q.corner;
      if (c && Number.isFinite(c.dist)) {
        const lead = P.cornerM + Math.max(0, q.sog ?? 0) * Math.max(1, q.rate ?? 1) * P.cornerLeadS;
        if (c.dist <= lead && c.i !== cornerSeen) { cornerSeen = c.i; why = c.last ? 'arrival' : 'corner'; }
      }
      if (q.arrived && !arrivedSeen) { arrivedSeen = true; why ??= 'arrival'; }
      if (!q.arrived) arrivedSeen = false;
      if (Number.isFinite(q.windDir)) {
        if (ref == null) ref = q.windDir;
        else if (Math.abs(wrap180(q.windDir - ref)) > P.shiftDeg) { ref = q.windDir; why ??= 'shift'; }
      }
      if (Number.isFinite(q.gustAhead)) {
        if (gustArmed && q.gustAhead >= P.gustOn && !((q.t ?? 0) - gustT < P.gustEveryS)) { gustArmed = false; gustT = q.t ?? 0; why ??= 'gust'; }
        else if (q.gustAhead <= P.gustOff) gustArmed = true;
      }
      if (q.tessieM != null && Number.isFinite(q.tessieM)) {
        if (tessieArmed && q.tessieM <= P.tessieM) { tessieArmed = false; why ??= 'tessie'; }
        else if (q.tessieM > P.tessieM * 1.3) tessieArmed = true;
      } else tessieArmed = true;
      if (Number.isFinite(q.sunElev)) {
        if (sunWas != null && !goldenSeen && sunWas > P.goldenDeg && q.sunElev <= P.goldenDeg) { goldenSeen = true; why ??= 'golden'; }
        if (q.sunElev > P.goldenDeg + 2) goldenSeen = false;
        sunWas = q.sunElev;
      }
      return (q.rate ?? 0) > 1 ? why : null;
    },
  };
}
export const SLOW_WORDS = Object.freeze({ corner: 'A corner ahead', arrival: 'Arriving', shift: 'The wind shifts', gust: 'A gust lane ahead', tessie: "Tessie's water", golden: 'The golden hour' });

// the panel's fold: open → rail 6 s after the last press, never while the pointer is inside it; a passage must exist to fold
export function createFold({ delayS = PLAN.foldS } = {}) {
  let open = true, idle = 0;
  return {
    get open() { return open; },
    press() { idle = 0; },
    set(v) { open = !!v; idle = 0; },
    step(dt, { inside = false, passage = true } = {}) {
      if (!open) return open;
      if (inside || !passage) { idle = 0; return open; }
      idle += Math.max(0, dt);
      if (idle >= delayS) open = false;
      return open;
    },
  };
}

// the point of sail's words , from the true wind angle in degrees
export const pointWord = (twa) => (twa < PLAN.closeHauledDeg ? 'beat' : twa < 80 ? 'close reach' : twa < 110 ? 'reach' : twa < 150 ? 'broad reach' : 'run');
export const bearing = (a, b) => ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360;
export const pathLength = (P) => P.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0), 0);

// from: [x, z]; corners: [[x, z] …]; route(a, b) → the planner's path or null (planChart.js route: off land and shoal with its margin);
// windAt(x, z, hoursAhead) → { speed (m/s), dirDeg (FROM) }; → [{ i, a, c, path, m, nm, course, twa, tws, word, beat, kn, hrs, t0, t1 }]
export function legsOf(from, corners, { route = null, windAt = () => ({ speed: 5, dirDeg: 200 }) } = {}) {
  const legs = [];
  let h = 0, a = from;
  corners.forEach((c, k) => {
    const path = route?.(a, c) ?? [a, c];
    const m = pathLength(path), course = bearing(a, c);
    const w = windAt((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, h), tws = (w.speed ?? 0) * KN;
    const twa = Math.abs(wrap180(course - (w.dirDeg ?? 0)));
    const beat = twa < PLAN.closeHauledDeg;
    const kn = Math.max(1.2, beat ? polarKn(tws, PLAN.closeHauledDeg) * Math.cos((PLAN.closeHauledDeg * Math.PI) / 180) : polarKn(tws, Math.max(twa, 30)));
    const hrs = m / 1852 / kn;
    legs.push({ i: k + 1, a, c, path, m, nm: m / 1852, course, twa, tws, word: pointWord(twa), beat, kn, hrs, t0: h, t1: h + hrs });
    h += hrs; a = c;
  });
  return legs;
}
// "about 18:28": the hour as the clock face reads it
export const hm = (h) => { const m = Math.floor((((h % 24) + 24) % 24) * 60 + 1e-6); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// a call delayed until ms after the last ask (the re-route after a corner laid)
export function debounce(fn, ms = PLAN.debounceMs, { set = setTimeout, clear = clearTimeout } = {}) {
  let id = null;
  const d = (...a) => { if (id != null) clear(id); id = set(() => { id = null; fn(...a); }, ms); };
  d.flush = () => { if (id != null) { clear(id); id = null; fn(); } };
  d.cancel = () => { if (id != null) clear(id); id = null; };
  return d;
}

// the mode switch's hooks (v2/engine/modes.js's row; ui/modeSwitch.js runs them): enter, Plan takes the boat where she is; leave, the
// pilot lets go and Sail's clock comes back
export const PLAN_SWITCH = Object.freeze({
  async enter(_k, { load, ready }) {
    await ready;
    const p = await load();
    await p.enter();
  },
  leave(p) { p.leave(); },
});
