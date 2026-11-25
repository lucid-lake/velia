// The storm's pure side (M5e): v1's thunderstorm sim (src/sim/weather/stormSim.js: the arc, the strikes, the outflow on
// the one wind field, the rainbow's amount) wrapped for v2's clock, eye and sun; the storm record the frame writes into
// the shared uniform (uniforms.js: storm, rain, cell, front, bow); the cell's shade of the sun at the eye (v1's
// shadowAt, one number a frame: the cell is 2–4 km wide, the gaps ride the drift); the water's wind under the outflow
// (the field's own modifier at the eye: v1's stormWind, no second wind); the bolts' channels (v1's boltPaths, copied
// from src/weather/lightning.js, which is three-bound). v1's URL rows run it: ?weather=storm&stormt=&stormrate=&stormref=
// (src/sim/weather/stormSim.js stormFromParams); ?storms=natural lets one come on a summer afternoon.
//   const S = createStorm({ windField, seed, now, eye, sunDir, exposure, deck });
//   S.update(hour, { steer, cut }) → info (each frame, before the water reads the wind; steer: the one wind's steering flow,
//   v2/sim/weatherWind.js steerFlow: the running cell turns to it)                                           S.weather (the plain state)
//   S.fillFrame(U, eye) (the uniform rows)   S.waterWind(w, out) (the outflow on the base wind)   S.frame (the strikes, the bolt)
//   S.start({ s0, rate, ref, easeS }), S.stop(), S.choose('storm' | 'fair'), S.running, S.strikesFrom(s)
import { createStormSim, NATURAL, naturalPlan, stormFromParams } from '../../src/sim/weather/stormSim.js';
import { hash, CELL, thunderOf, sceneTimeOf, RAINBOW, ARC } from '../../src/sim/weather/stormArc.js';
import { stormWindFrameInto } from '../../src/sim/weather/stormWind.js';
import { WEATHER_SCALARS, WEATHER_VECTORS } from '../../src/sim/weather/state.js';
import { EXPOSURE, groundLight } from './exposure.js';
import { steerFlow } from './weatherWind.js';   // storm round 2: the cell's track rides the one wind's steering flow

export { NATURAL, naturalPlan, stormFromParams, thunderOf, sceneTimeOf, RAINBOW, ARC, WEATHER_SCALARS, WEATHER_VECTORS, CELL };

import { smooth } from '../../src/sim/core/math.js';

// the cell's track (storm round 2, 2026-11-24: "the storm cell moves with the one wind"): the drift is the one wind's steering
// flow (v2/sim/weatherWind.js steerFlow), never a bearing of the storm's own. It is set when the storm starts (or on its first
// frame) and on a time cut; while it runs it turns toward the steering now with this time constant (scene s), so a shift of
// the day's wind swings the track slowly about the reference point (where the cell still passes overhead at the arc's 165 s)
export const STORM_TRACK = Object.freeze({ turnS: 45 });
// ease a unit drift d (in place) toward the unit target by k (0–1) of the angle between them, the short way round
export function turnToward(d, target, k) {
  const a0 = Math.atan2(d[1], d[0]), a1 = Math.atan2(target[1], target[0]);
  const da = ((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI, a = a0 + da * Math.min(1, Math.max(0, k));
  d[0] = Math.cos(a); d[1] = Math.sin(a);
  return d;
}

// --- the cell's shade of the sun at a point (v1's src/weather/uniforms.js shadowAt, in JS for one point a frame):
// the point projected along the sun up to the dark base (1000 m; a low sun as if ≥ 15° up), the cell's mask there
// (the trailing side stretched), the clearing's gaps from a value noise carried with the drift. 1 = no shade ---
const hash2 = (i, j, seed) => { let h = (i * 374761393 + j * 668265263 + seed * 1442695041) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function vnoise(x, z, seed = 1) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j, seed), b = hash2(i + 1, j, seed), c = hash2(i, j + 1, seed), d = hash2(i + 1, j + 1, seed);
  return ((a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv) * 2 - 1;
}
export function cellMask(x, z, W) {
  const rx = x - W.cell[0], rz = z - W.cell[1], DX = W.dir[0], DZ = W.dir[1];   // the drift the cell rides (stormSim writes it)
  const a = rx * DX + rz * DZ, k = Math.min(a, 0) * -0.45;
  const sx = rx + DX * k, sz = rz + DZ * k;
  return (1 - smooth(0.38, 1.0, Math.hypot(sx, sz) / Math.max(W.cell[2], 1))) * W.cover;
}
export function sunShadeAt(x, y, z, W) {
  if (!W.on) return 1;
  const s = W.sun, sy = Math.max(s[1], 0.26), base = 1000;
  const qx = x + s[0] / sy * (base - y), qz = z + s[2] / sy * (base - y);
  const m = cellMask(qx, qz, W);
  const nx = qx + W.drift[0], nz = qz + W.drift[1];
  const n = vnoise(nx / 1400, nz / 1400, 3) * 0.6 + vnoise(nx / 430, nz / 430, 5) * 0.4;
  const hole = smooth(0.05, 0.3, n) * W.gaps;
  return 1 - m * W.shade * (1 - hole) * 0.92;
}

// --- the bolt's channel (src/weather/lightning.js boltPaths, copied: that module imports three): polylines from the
// cloud base to the ground by midpoint displacement, branches from a third of the joints; the strike's own seed ---
export function boltPaths(strike, groundY, { topY = CELL.baseM + 500 } = {}) {
  const r = (k) => hash(strike.seed, k, 9);
  let k = 0;
  const jag = (a, b, depth, rough) => {
    if (depth === 0) return [a];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    m[0] += (r(k++) - 0.5) * len * rough; m[2] += (r(k++) - 0.5) * len * rough; m[1] += (r(k++) - 0.5) * len * rough * 0.3;
    return [...jag(a, m, depth - 1, rough), ...jag(m, b, depth - 1, rough)];
  };
  const top = [strike.x + (r(900) - 0.5) * 600, topY, strike.z + (r(901) - 0.5) * 600];
  const end = [strike.x, groundY, strike.z];
  const main = [...jag(top, end, 6, 0.55), end];
  const paths = [{ pts: main, w: 1 }];
  for (let i = 4; i < main.length - 8; i += 5) {
    if (r(1000 + i) > 0.45) continue;
    const a = main[i], L = (main.length - i) * 0.4 * (Math.hypot(main[1][0] - main[0][0], main[1][1] - main[0][1]) || 30);
    const ang = r(1100 + i) * Math.PI * 2;
    const b = [a[0] + Math.cos(ang) * L * 0.5, a[1] - L * (0.5 + r(1200 + i) * 0.4), a[2] + Math.sin(ang) * L * 0.5];
    paths.push({ pts: [...jag(a, b, 4, 0.6), b], w: 0.45 });
  }
  return paths;
}
// the channel as camera-facing ribbons' vertices (pos xyz, along xyz, side x, taper) and triangle indices, as v1's
// lightning.js build(); at most maxVerts vertices. Returns { verts: Float32Array × 8, index: Uint32Array, nv, ni }
export const BOLT = Object.freeze({ maxVerts: 2400, coreM: 16, glowM: 170, light: 0.9 });
export function boltMesh(strike, groundY, verts = new Float32Array(BOLT.maxVerts * 8), index = new Uint32Array(BOLT.maxVerts * 3)) {
  const paths = boltPaths(strike, groundY);
  let v = 0, t = 0;
  for (const { pts, w } of paths) {
    if (v + pts.length * 2 > BOLT.maxVerts) break;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const taper = w * (1 - 0.6 * i / pts.length);
      for (const sx of [-1, 1]) {
        const o = v * 8;
        verts[o] = pts[i][0]; verts[o + 1] = pts[i][1]; verts[o + 2] = pts[i][2];
        verts[o + 3] = b[0] - a[0]; verts[o + 4] = b[1] - a[1]; verts[o + 5] = b[2] - a[2];
        verts[o + 6] = sx; verts[o + 7] = taper; v++;
      }
      if (i > 0) { const q = v - 4; index[t++] = q; index[t++] = q + 1; index[t++] = q + 2; index[t++] = q + 2; index[t++] = q + 1; index[t++] = q + 3; }
    }
  }
  return { verts, index, nv: v, ni: t };
}

// --- the rain's drop count by the backing's pixels (v1's tiers: phones ran Low) ---
export const RAIN = Object.freeze({ desktop: 16000, phone: 4000, phonePx: 0.6e6, box: [44, 30, 44], fallMs: 9 });
export const rainDropsFor = (pixels) => (pixels < RAIN.phonePx ? RAIN.phone : RAIN.desktop);

// --- the storm on v2's frame ---
// windField: the shared WindField (setStorm, sample); now(): the scene clock (s); eye(): [x, y, z]; sunDir(): { x, y, z }
// unit toward the sun; sunElev(): deg; exposure(): the frame's exposure factor (v2/sim/exposure.js); deck: { base,
// thickness } (m, the clouds' numbers); seed
export function createStorm({ windField, seed = 1, now = () => 0, eye = () => [0, 0, 0], sunDir = () => ({ x: 0, y: 1, z: 0 }), sunElev = () => 60, exposure = () => EXPOSURE.base, deck = { base: 700, thickness: 900 } }) {
  const env = { sun: { direction: { x: 0, y: 1, z: 0 }, exposure: 6, light: 1 } };
  // the steering flow's drift (unit x, z) as last handed in (null before the first frame); the state it was set on, the clocks
  let steerDir = null, steered = null, lastT = null, lastCut = null;
  // with no steering handed in: the field's own day wind's (the same one wind; main.js hands in the frame's windNow)
  const baseSteer = () => (Number.isFinite(windField?.base?.dirDeg) ? steerFlow(windField.base.dirDeg).dir : null);
  const eyeXZ = { x: 0, z: 0 };
  const sim = createStormSim({
    wind: windField, seed, now, lum: 0.1, env,
    eye: () => { const e = eye(); eyeXZ.x = e[0]; eyeXZ.z = e[2]; return eyeXZ; },
    deck: { base: () => deck.base, thickness: () => deck.thickness },
    steer: () => steerDir ?? baseSteer() ?? [0, 0],   // every start (the URL's, the menu's, a natural one) on the steering now ([0, 0]: the first frame's)
  });
  const W = sim.weather;
  const windO = { gain: 1, fromDeg: 0, w: 0 };
  let begun = false, windAt = null;
  return {
    sim, weather: W, info: sim.info, frame: sim.frame,
    get running() { return sim.running; }, get state() { return sim.state; }, get rain() { return sim.rain; },
    get steer() { return steerDir; },
    start: (o) => sim.start(o), stop: () => sim.stop(), choose: (w) => sim.choose(w), strikesFrom: (s, n) => sim.strikesFrom(s, n),
    begin({ natural = NATURAL.on } = {}) { begun = true; return sim.begin({ natural }); },
    // each frame, after the sun is known and before the water reads the wind: v1's env (the sun's direction, the
    // exposure in v1's units so the flash's lift scales as v1's, the daylight level), then the sim's step
    // steer: { dir: [x, z] } (weatherWind.js steerFlow of the day's wind); cut: the clock's cut count (a cut snaps the track)
    update(hour, { steer = null, cut = 0 } = {}) {
      if (!begun) this.begin();
      const sd = steer?.dir ?? baseSteer();
      if (sd) steerDir = [sd[0], sd[1]];
      const st = sim.state, t = now();
      if (st && st.dir && steerDir) {
        const fresh = steered !== st || cut !== lastCut || lastT == null || !(t - lastT >= 0) || t - lastT > 0.25 || (st.dir[0] === 0 && st.dir[1] === 0);
        if (fresh) { st.dir[0] = steerDir[0]; st.dir[1] = steerDir[1]; }   // a new storm, a cut or a jump: on the steering now
        else turnToward(st.dir, steerDir, 1 - Math.exp(-(t - lastT) / STORM_TRACK.turnS));   // in place: the wind field's copy shares the array
        steered = st;
      }
      lastT = t; lastCut = cut;
      const s = sunDir(); env.sun.direction.x = s.x; env.sun.direction.y = s.y; env.sun.direction.z = s.z;
      env.sun.exposure = 6 * exposure() / EXPOSURE.base;
      env.sun.light = Math.min(1, groundLight(sunElev()) / groundLight(8.5));
      const info = sim.update(now(), { hour });
      windAt = sim.running && sim.state ? stormWindFrameInto(sim.state, now()) : null;
      return info;
    },
    // the water's wind under the outflow at the eye: v1's modifier on the base vector (speed m/s, dirDeg from), into
    // out { speedMs, dirDeg, travelRad, gain }; the base unchanged with no storm
    waterWind(base, out) {
      out.speedMs = base.speedMs; out.dirDeg = base.dirDeg; out.travelRad = base.travelRad; out.gain = 1;
      if (!windAt) return out;
      const e = eye(); windAt(e[0], e[2], windO);
      const d = ((((windO.fromDeg - base.dirDeg) % 360) + 540) % 360) - 180;
      out.dirDeg = ((base.dirDeg + d * windO.w) % 360 + 360) % 360;
      out.speedMs = base.speedMs * windO.gain;
      const a = out.dirDeg * Math.PI / 180;
      out.travelRad = Math.atan2(Math.cos(a), -Math.sin(a));   // toward: (−sin, +cos) of the FROM bearing in (x, z), as v2/sim/wind.js
      out.gain = windO.gain;
      return out;
    },
    // the storm's rows of the shared uniform (uniforms.js): storm, rain, cell, front, bow, track
    // hazeMul: the weather look's share of the storm's mist (v2/sim/weatherLook.js haze; 1 keeps it)
    fillFrame(U, e = eye(), hazeMul = 1) {
      const shade = sunShadeAt(e[0], e[1], e[2], W);
      U.set4('storm', W.on, shade, W.dark, W.gold);
      U.set4('rain', W.rain, W.flash, Math.min(1, W.haze * hazeMul), W.bowAmt);
      U.set4('cell', W.cell[0], W.cell[1], W.cell[2], W.cover);
      U.set4('front', W.front[0], W.front[1], W.front[2], W.front[3]);
      U.set4('bow', W.toRain[0], W.toRain[1], W.flashAdd, W.time);
      U.set4('track', W.dir[0], W.dir[1], 0, 0);   // the cell's drift (the steering flow it rides)
      return shade;
    },
  };
}
