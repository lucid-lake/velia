// The Tahoe afternoon thunderstorm (wow/storm): the event arc as plain numbers. Plain JS, no three.js, no DOM, no
// Math.random(), no wall clock: node tests drive it (tests/storm.test.mjs), the page (src/weather/storm.js), the wind
// field's worker (src/weather/stormWind.js) and the film's audio (tools/storm_film.mjs) all read the same numbers.
//
// Real basis: Tahoe's July–August afternoon cells build over the Sierra crest west of the lake, high-based; their
// outflow reaches the water first as a gust line (NWS Reno warns of 60 mph and more), then the rain and the
// lightning; the cell drifts east and the sun comes back behind it. Often local: one end of the lake stormy, the
// other sunny. The arc is a game's compression of it (≈ 5 min, not an hour):
//   build  0–90 s    towers over the western ridge grow into an anvil, the light flattens, far thunder
//   front  90–120 s  the outflow line crosses the bay: a dark, rough band of water, the wind veers and jumps
//   storm  120–210 s heavy gusts, rain, lightning on the ridges, haze closing in
//   clear  210–270 s the cell moves east, sun through gaps, the grade warms to gold, a rainbow when the sun allows
//   after  270–300 s the last of it fades; past END the lake is as it was
// s is the arc's own clock (seconds into the arc); arcTime() maps the scene clock to it (?stormrate= compresses it
// for films). World frame as src/wind.js: x east, z south, metres.

export const ARC = { build: [0, 90], front: [90, 120], storm: [120, 210], clear: [210, 270], end: 300 };
export const PHASES = ['build', 'front', 'storm', 'clear'];
export const SOUND_MS = 343;   // the speed of sound (m/s, 20 °C, sea level; ≈ 340 at the lake's 1,898 m in summer)

const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';
import { smooth } from '../core/math.js'; export { smooth };

// The cell drifts toward ENE (bearing 70°, as Tahoe's afternoon cells drift with the southwest flow aloft); the
// outflow blows from where it comes from (WSW, 250°).
export const CELL = { bearingDeg: 70, fromDeg: 250, baseM: 1900, topM: 9000 };
export const DIR = [Math.sin(CELL.bearingDeg * DEG), -Math.cos(CELL.bearingDeg * DEG)];   // the drift, unit (x, z): v1's fixed track
// a running storm's drift: its state's own (v2: the steering flow of the one wind, v2/sim/weatherWind.js steerFlow), else v1's DIR
export const dirOf = (state) => state?.dir ?? DIR;
// the bearing the outflow blows FROM for a drift (where the cell comes from): v1's DIR gives CELL.fromDeg (250)
export const fromDegOf = (dir) => (dir === DIR ? CELL.fromDeg : ((Math.atan2(dir[0], -dir[1]) / DEG + 180) % 360 + 360) % 360);
// the cell's centre along DIR from the reference point (m) at arc seconds: over the western ridge while it builds,
// overhead at 165 s, gone east by the end (≈ 45 m/s: clouds racing read as wind)
const PATH = [[0, -13000], [90, -6500], [120, -3200], [165, 0], [210, 2400], [270, 7000], [300, 9500], [400, 16000]];
// the outflow front: along DIR, crossing the reference point at FRONT.atS, at FRONT.speedMs (an outflow boundary runs
// 10–25 m/s)
export const FRONT = { atS: 105, speedMs: 22, widthM: 70 };

export function phaseAt(s) {
  if (!(s >= 0)) return 'before';
  for (const p of PHASES) if (s < ARC[p][1]) return p;
  return s < ARC.end ? 'after' : 'done';
}

function interp(table, s) {
  if (s <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) if (s <= table[i][0]) {
    const [s0, v0] = table[i - 1], [s1, v1] = table[i];
    return v0 + (v1 - v0) * (s - s0) / (s1 - s0);
  }
  return table.at(-1)[1];
}

// the cell at arc seconds s round the reference point ref = [x, z]: its centre, radius (m), coverage 0–1 and height
// growth 0–1 (the towers into an anvil)
// dir: the drift (unit x, z; a running storm's state.dir, the steering flow it rides); v1 passes none and keeps DIR
export function cellAt(s, ref = [0, 0], dir = DIR) {
  const a = interp(PATH, s);
  return {
    x: ref[0] + dir[0] * a, z: ref[1] + dir[1] * a, along: a,
    r: 2000 + 2300 * smooth(40, 140, s),   // a narrow tower while it builds, a wide storm once it arrives
    // the cell exists from the start, far out beyond the ridge: it arrives by moving in (never fading in where it stands)
    cover: smooth(-30, 10, s) * (1 - smooth(235, 295, s)),
    tall: smooth(10, 100, s) * (1 - 0.5 * smooth(240, 300, s)),
  };
}

// the envelopes at a listener (x, z) at arc seconds s: rain 0–1, dark (the storm grade) 0–1, gold (the clearing's
// warm grade) 0–1, haze (the fog's extra) 0–1, front (the outflow's strength) 0–1
export function arcAt(s, ref = [0, 0], listener = ref, dir = DIR) {
  const c = cellAt(s, ref, dir);
  const d = Math.hypot(listener[0] - c.x, listener[1] - c.z);
  const rainCore = smooth(100, 130, s) * (1 - smooth(200, 245, s));
  const rain = rainCore * (1 - smooth(0.45 * c.r, 0.95 * c.r, d));
  // the light flattens as the cell nears (its anvil takes the sky's light before its core arrives), fully under it
  const dark = c.cover * Math.max(1 - smooth(0.6 * c.r, 1.7 * c.r, d), 0.55 * (1 - smooth(1.7 * c.r, 3.2 * c.r, d)));
  const gold = smooth(205, 240, s) * (1 - smooth(285, 330, s));
  return {
    s, phase: phaseAt(s), cell: c, dist: d, rain, dark, gold,
    haze: clamp(0.85 * rain + 0.25 * dark, 0, 1),
    front: smooth(50, 90, s) * (1 - smooth(220, 260, s)),
    on: s >= 0 && s < ARC.end,
  };
}

// the arc's clock from the scene clock: the arc started at scene time t0 at arc second s0, running rate× (films
// compress it; play is 1×)
export const arcTime = (state, t) => state.s0 + (t - state.t0) * (state.rate ?? 1);
export const sceneTimeOf = (state, s) => state.t0 + (s - state.s0) / (state.rate ?? 1);

// --- Lightning --------------------------------------------------------------------------------------------------
// A deterministic strike list from the seed: per 0.5 s bin a hashed draw against the phase's rate (strikes per second);
// a strike's place is in the cell's trailing half (behind its core, toward the ridges it came over, where a sailor
// watching it pass sees them), inside 0.8 of its radius. A third are in-cloud (a flash, no bolt). Four ground strikes on
// the western ridges are scripted (HERO: arc second, metres back along the drift from the reference, metres to the
// side) so every storm has its moments in view of a boat at the reference.
export const HERO = [[128, 2300, 900], [150, 2700, -500], [176, 2500, 300], [196, 3000, -900]];
const STRIKE_RATE = [[0, 0], [35, 0], [36, 1 / 14], [90, 1 / 14], [91, 1 / 7], [120, 1 / 7], [121, 1 / 4.5], [210, 1 / 4.5], [211, 1 / 16], [245, 1 / 16], [246, 0]];
const BIN = 0.5;
export function hash(seed, k, salt = 0) {
  let h = (seed * 374761393 + k * 668265263 + salt * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
export function strikesBetween(seed, s0, s1, ref = [0, 0], dir = DIR) {
  const out = [];
  for (let k = Math.max(0, Math.floor(s0 / BIN)); k * BIN < s1; k++) {
    const s = k * BIN + hash(seed, k, 1) * BIN;
    if (s < s0 || s >= s1) continue;
    const hero = HERO.find(([hs]) => k === Math.floor(hs / BIN));
    if (!hero && hash(seed, k, 2) >= interp(STRIKE_RATE, s) * BIN) continue;
    const c = cellAt(s, ref, dir);
    let x, z, bolt;
    if (hero) { const [, back, side] = hero; x = ref[0] - dir[0] * back + dir[1] * side; z = ref[1] - dir[1] * back - dir[0] * side; bolt = true; }
    else {
      const back = hash(seed, k, 3) * 0.75 * c.r, side = (hash(seed, k, 4) - 0.5) * 1.2 * c.r;   // the trailing half
      x = c.x - dir[0] * back + dir[1] * side; z = c.z - dir[1] * back - dir[0] * side; bolt = hash(seed, k, 5) > 0.33;
    }
    out.push({ s, x, z, bolt, id: k, seed: Math.floor(hash(seed, k, 6) * 1e6) });
  }
  return out;
}

// the scene flash (0–1.5) at arc second s from these strikes, seen from the listener: a return stroke and two
// restrikes over ≈ 0.25 s (each a 45 ms decay), dimmer with distance; in-cloud flashes half as bright
const PULSES = [[0, 1], [0.07, 0.7], [0.16, 0.5]];
export function flashOf(strike, s, listener, rate = 1) {
  const dt = (s - strike.s) / rate;   // real seconds since the strike (a film's compressed arc keeps the flash's own speed)
  if (dt < 0 || dt > 0.4) return 0;
  let f = 0;
  for (const [o, w] of PULSES) if (dt >= o) f += w * Math.exp(-(dt - o) / 0.045);
  const d = Math.hypot(listener[0] - strike.x, listener[1] - strike.z);
  return f * (strike.bolt ? 1 : 0.5) / (1 + (d / 7000) ** 2);
}

// thunder: the first sound from the nearest part of the channel (the ground point, or the cloud base for an in-cloud
// flash), the roll until the farthest (its top); in seconds after the strike
export const thunderDelayS = (distM) => Math.max(0, distM) / SOUND_MS;
export function thunderOf(strike, listener, { baseM = CELL.baseM, topM = 4500 } = {}) {
  const h = Math.hypot(listener[0] - strike.x, listener[1] - strike.z);
  const near = strike.bolt ? Math.hypot(h, 30) : Math.hypot(h, baseM), far = Math.hypot(h, topM);
  return { delayS: thunderDelayS(near), rollS: thunderDelayS(far) - thunderDelayS(near) + 1.2, distM: near,
    level: 0.3 + 0.7 / (1 + (near / 3000) ** 1.4) };   // far thunder still carries: it is the sound of the storm
}

// --- The rainbow ------------------------------------------------------------------------------------------------
// The primary bow is a circle of 42° (red; violet 40.7°) round the antisolar point, which lies as far below the horizon
// as the sun is above it: its top stands 42° − sun elevation above the horizon, so the bow shows only with the sun
// under 42° and behind the viewer, and only where rain lies that way (the departing cell). The secondary at 51°, fainter.
export const RAINBOW = { primaryDeg: 42, innerDeg: 40.7, secondaryDeg: 51, secondaryOuterDeg: 53.5 };
export const rainbowTopDeg = (sunElevDeg, radiusDeg = RAINBOW.primaryDeg) => radiusDeg - sunElevDeg;
export const rainbowPossible = (sunElevDeg) => sunElevDeg > -0.5 && sunElevDeg < RAINBOW.primaryDeg;
// how well the rain (toward toRain, a horizontal (x, z) vector) sits under the bow, given the sun's direction (x, y, z,
// unit, world): 1 when the rain is straight antisolar, 0 when it is 75° or more away from it (the bow is ±42° wide)
export function rainbowWeight(sunDir, toRain) {
  const elev = Math.asin(clamp(sunDir.y ?? sunDir[1], -1, 1)) / DEG;
  if (!rainbowPossible(elev)) return 0;
  const ax = -(sunDir.x ?? sunDir[0]), az = -(sunDir.z ?? sunDir[2]), an = Math.hypot(ax, az), rn = Math.hypot(toRain[0], toRain[1]);
  if (an < 1e-6 || rn < 1e-6) return 0;
  const cos = (ax * toRain[0] + az * toRain[1]) / (an * rn);
  return smooth(Math.cos(75 * DEG), Math.cos(25 * DEG), cos) * (1 - smooth(34, 42, elev));
}
// the clearing's window for the bow (arc seconds)
export const rainbowEnv = (s) => smooth(215, 235, s) * (1 - smooth(266, 292, s));
