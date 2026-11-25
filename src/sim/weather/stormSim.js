// The Tahoe afternoon thunderstorm's sim half (wow/storm; split from src/weather/storm.js for the shared sim,
// Sprint 0): the arc (stormArc.js) run on the scene clock into the plain weather state (state.js), the outflow handed to
// the one wind field (wind.setStorm: stormWind.js through src/sim/wind-modifiers.js), the strikes and their flashes, the
// rainbow's amount, and the info the HUD and the tools read. No scene, no shader, no sound: the engine's half
// (v1: src/weather/storm.js createStorm) copies the state into its uniforms, draws the rain and the bolts, plays the
// thunder for frame.strikes and greys the fog from frame.A.haze.
//
//   const sim = createStormSim({ wind, seed, now, eye, deck, lum, env, sunWorld, onStart, onStop });
//   sim.begin({ natural }) → true the first time                    sim.start({ s0, rate, ref, t0, easeS }) → the arc's state
//   sim.update(t, { hour }) → info; sim.frame: { ran, s, A, k, L, w, strikes, bolt, boltGlow } for the engine's half
//   sim.weather: the plain state                                     sim.stop(), sim.choose('storm' | 'fair')
// eye(): the listener's point { x, z } (the camera); deck: the cloud deck's { base(), thickness() } in m, or null;
// onStart / onStop: the engine's hooks, called at the end of every start and stop (the natural storm's and choose's too).
// A capture is deterministic: the arc, the strikes and the bolts come from the seed and the scene clock, never the wall clock.
import { ARC, arcAt, arcTime, strikesBetween, flashOf, rainbowEnv, rainbowWeight, smooth, hash, dirOf } from './stormArc.js';
import { frontAlong } from './stormWind.js';
import { createWeatherState, STORM_TOP_M, STOP_ZERO } from './state.js';

export const NATURAL = { on: false, hours: [13.5, 17.5], chance: 0.35, afterS: 120 };
const LEAVE_S = 2.5;   // a storm sent away before its rain has arrived fades out over this long (scene s), then stops

// does a natural storm come this visit, and when (scene seconds after the mode's start)? Deterministic by seed
export function naturalPlan(seed, { chance = NATURAL.chance, afterS = NATURAL.afterS } = {}) {
  if (hash(seed, 41, 7) >= chance) return null;
  return { atS: afterS + Math.floor(hash(seed, 42, 7) * 240) };
}

// the URL's storm, if any: { s0, rate, ref }
export function stormFromParams(flags) {
  if (flags.weather !== 'storm') return null;
  const s0 = parseFloat(flags.stormt ?? '0'), rate = parseFloat(flags.stormrate ?? '1');
  const ref = flags.stormref?.split(',').map(Number);
  return { s0: Number.isFinite(s0) ? s0 : 0, rate: Number.isFinite(rate) && rate > 0 ? rate : 1, ref: ref?.length === 2 && ref.every(Number.isFinite) ? ref : null };
}

// steer(): the drift (unit x, z) a storm started with none takes (v2: the one wind's steering flow), or null; v1 passes none
export function createStormSim({ wind, seed: SEED = 1, now = () => 0, eye, deck = null, lum = 0.1, env = {}, sunWorld = null, onStart = () => {}, onStop = () => {}, weather: W = createWeatherState(), steer = () => null }) {
  let state = null, lastS = null, recent = [], plan = null, startedAt = 0;
  let ease = null, leave = null;   // the fade in of a storm started mid-arc (start's easeS), the fade out of one sent away early (choose): { t0, s }
  let natural = false, begun = false;   // begin(): the storm runs from the mode's start (no update before it: the boot's frames)
  const info = { s: null, phase: 'none', rain: 0, dark: 0, gold: 0, flash: 0, rainbow: 0, drops: 0, strikes: 0, thunders: [] };
  const frame = { ran: false, s: 0, A: null, k: 1, L: null, w: null, strikes: [], bolt: null, boltGlow: 0 };

  // once the mode has started: the natural storm's clock starts here. true the first time (the engine joins its sound then)
  function begin({ natural: nat = NATURAL.on } = {}) {
    if (begun) return false;
    begun = true; natural = nat; startedAt = now() ?? 0;
    return true;
  }

  // dir: the drift (unit x, z) the cell rides (v2: the one wind's steering flow; the engine may turn it in place while the storm
  // runs, the field's copy shares the array); none: v1's fixed track (stormArc.js DIR)
  function start({ s0 = 0, rate = 1, ref = null, t0 = now(), easeS = 0, dir = steer() } = {}) {
    const p = eye();
    state = { s0, t0, rate, ref: ref ?? [Math.round(p.x), Math.round(p.z)], seed: SEED };
    if (dir) state.dir = [dir[0], dir[1]];
    wind.setStorm(state);
    lastS = null; recent = [];
    ease = easeS > 0 ? { t0, s: easeS } : null; leave = null;
    onStart(state);
    return state;
  }
  function stop() {
    state = null; ease = null; leave = null; wind.setStorm(null); W.on = 0;
    for (const k of STOP_ZERO) W[k] = 0;
    W.front[0] = 0; W.front[1] = 0; W.front[2] = 0; W.front[3] = 0;
    info.phase = 'none'; info.s = null;
    onStop();
  }
  // 'storm' runs the arc from its start, here; 'fair' sends a running one away: once its rain has come (the storm phase) it clears
  // now (the arc's own clearing: the sun through the gaps, the rainbow); before that (the cell still out west, only the light and
  // the gust line here) it fades out over LEAVE_S and stops, since a jump to the clearing would put the rain overhead at once
  function choose(w) {
    if (w === 'storm') { if (!state) start(); return 'storm'; }
    if (state && !leave) {
      const t = now(); const s = arcTime(state, t);
      if (s < ARC.storm[0]) leave = { t0: t, s: LEAVE_S };
      else if (s < 212) { state.s0 = 212; state.t0 = t; wind.setStorm(state); }
    }
    return 'fair';
  }

  function update(t, { hour = null } = {}) {
    frame.ran = false; frame.strikes = [];
    if (!begun) return info;
    if (!state && natural && hour != null) {
      plan ??= naturalPlan(SEED);
      if (plan && t - startedAt >= plan.atS && hour >= NATURAL.hours[0] && hour <= NATURAL.hours[1]) { start(); plan = { atS: Infinity }; }
    }
    if (!state) return info;
    const s = arcTime(state, t);
    if (s >= ARC.end) { stop(); return info; }
    const P = eye(), L = [P.x, P.z];
    const DIR = dirOf(state);
    const A = arcAt(s, state.ref, L, DIR), c = A.cell;
    // the fades (a storm started mid-arc eases in; one sent away early eases out, then stops): one gain on what is seen
    let k = ease ? smooth(0, ease.s, t - ease.t0) : 1;
    if (leave) { const u = (t - leave.t0) / leave.s; if (u >= 1) { stop(); return info; } k *= 1 - smooth(0, 1, u); }
    if (k < 1) { A.rain *= k; A.dark *= k; A.gold *= k; A.haze *= k; A.front *= k; c.cover *= k; } else ease = null;
    W.on = 1;
    W.cell[0] = c.x; W.cell[1] = c.z; W.cell[2] = c.r; W.cover = c.cover; W.tall = c.tall;
    if (deck) W.slab = c.tall * c.cover * Math.max(0, STORM_TOP_M - deck.base() - deck.thickness());
    W.shade = 1; W.gaps = smooth(195, 238, s);
    W.rain = A.rain; W.dark = A.dark; W.gold = A.gold * (1 - 0.7 * A.rain) * (1 - 0.6 * A.dark); W.haze = A.haze;
    W.time = t;
    W.front[0] = state.ref[0]; W.front[1] = state.ref[1]; W.front[2] = frontAlong(s); W.front[3] = A.front;
    W.shelfDrop = k * 460 * smooth(70, 100, s) * (1 - smooth(150, 190, s));   // the shelf rides the line from its approach to the storm's middle
    W.rainCore = k * smooth(70, 110, s) * (1 - smooth(200, 250, s));   // the curtains hang under the core before the rain reaches the boat
    W.under = W.rainCore > 0.001 ? (deck ? deck.base() : 700) : W.shelfDrop;
    { const d = env.sun?.direction ?? sunWorld; W.sun[0] = d.x; W.sun[1] = d.y; W.sun[2] = d.z; }
    W.drift[0] = -DIR[0] * c.along; W.drift[1] = -DIR[1] * c.along;   // the shade's gaps ride with the cell
    W.dir[0] = DIR[0]; W.dir[1] = DIR[1];   // the drift the engine's shaders read (v2; not in the copied lists)

    // lightning: the new strikes since the last frame (the engine plays their thunder at the distance's delay), their flashes
    const from = lastS == null ? s - 0.4 * state.rate : lastS;   // a capture's first frame sees a flash already under way
    if (s > from) for (const k of strikesBetween(SEED, from, s, state.ref, DIR)) { recent.push(k); info.strikes++; frame.strikes.push(k); }
    lastS = s;
    recent = recent.filter((k) => s - k.s < 0.5 * state.rate);
    let flash = 0, bolt = null, boltGlow = 0;
    for (const k of recent) {
      const f = flashOf(k, s, L, state.rate); flash += f;
      const g = flashOf(k, s, [k.x, k.z], state.rate);
      if (k.bolt && g > boltGlow) { boltGlow = g; bolt = k; }
    }
    W.flash = Math.min(1.2, flash) * (A.on ? 1 : 0) * k;
    // its lift is in scene light: at night the exposure is many stops up (src/sim/timeOfDay.js exposureAt), so the lift is scaled back
    // by the same factor (the base exposure is 0.6 / lum, src/core/world.js) and a night flash lights the scene instead of whiting it out
    W.flashAdd = W.flash * Math.min(1, (0.6 / lum) / Math.max(1e-6, env.sun?.exposure ?? 0.6 / lum));

    const light = env.sun?.light ?? 1;
    const w = wind.sample(L[0], L[1], t);
    // the rainbow: the clearing's window, the sun at the eye (out of the cell's shadow), the rain where the bow stands
    const sunDir = W.sun, toRain = [c.x - L[0], c.z - L[1]];
    const shadeHere = c.cover * (1 - smooth(0.38, 1.0, Math.hypot(L[0] + sunDir[0] / Math.max(sunDir[1], 0.08) * 1000 - c.x, L[1] + sunDir[2] / Math.max(sunDir[1], 0.08) * 1000 - c.z) / c.r));
    const bowAmt = rainbowEnv(s) * rainbowWeight(sunDir, toRain) * (1 - shadeHere * (1 - 0.6 * W.gaps));
    W.bow = bowAmt * lum * light * 0.45; W.bowAmt = bowAmt;
    W.toRain[0] = toRain[0]; W.toRain[1] = toRain[1];

    Object.assign(info, { s: +s.toFixed(2), phase: A.phase, rain: +A.rain.toFixed(3), dark: +A.dark.toFixed(3), gold: +W.gold.toFixed(3), flash: +W.flash.toFixed(3), rainbow: +bowAmt.toFixed(3), wind: +w.speed.toFixed(2), windDir: +w.dirDeg.toFixed(1), bolt: bolt ? bolt.id : null });
    Object.assign(frame, { ran: true, s, A, k, L, w, bolt, boltGlow });
    return info;
  }

  return {
    begin, start, stop, choose, update, info, frame, weather: W,
    get begun() { return begun; },
    get running() { return !!state; }, get leaving() { return !!leave; }, get choice() { return state ? 'storm' : 'fair'; }, get state() { return state; },
    get rain() { return state ? W.rain : 0; },
    // the next strikes from arc second s (captures pick a frame on a flash)
    strikesFrom: (s, n = 5) => (state ? strikesBetween(SEED, s, s + 120, state.ref, dirOf(state)).slice(0, n) : []),
  };
}
