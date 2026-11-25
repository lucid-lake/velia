// The clouds' pure side (M5a): the deck's numbers, the key's direction mapping, the amortised bake schedule, the
// drift from the shared wind, the params record the shaders read, and the JS twins of the WGSL noise and density
// maths (v2/render/clouds.js holds the WGSL; the tests hold the twins to the same formulas).
//
// The picture: v1's deck (src/clouds.js, a Nubis march per screen pixel, 5.2 ms at 720p) is marched here once per
// direction into a world-anchored panorama from the eye, the "key" (Cold Smoke's idea): azimuth
// across, a sqrt-warped elevation down (the texels packed at the horizon, where cumulus sides are seen from a boat),
// rgb the cloud's light toward the eye (premultiplied), a its transmittance, and a second texture its mean distance.
// A new key is baked a band of rows a frame over a cycle (1 s at 60 Hz), and the picture cross-fades between the last
// two complete keys, so neither the sun nor the weather nor the wind's drift ever costs a whole march in one frame.
// The boat moves 2–3 m/s under clouds 700 m up: the parallax between two keys is a fraction of a texel.
import { createWeatherState } from '../../src/sim/weather/state.js';
import { exposureAt } from '../../src/sim/timeOfDay.js';
import { exposureFactor, lookBase, currentLook, TWILIGHT, twilightShare } from './exposure.js';

// v1's CLOUD_DECK (src/sim/core/params.js) but the coverage: the default sky (Fair, the page's own deck) is clearer (owner,
// 2026-11-19,: v1's 0.6 left the noon zenith a pale L 76, C 9 under the deck; the grade delivers a deep blue
// only between the clouds): DEFAULT_COVER keeps clouds for life with the blue between; Clear (0.12) and Cloudy (0.85) keep theirs
export const DEFAULT_COVER = 0.28;
export const DECK = Object.freeze({ coverage: DEFAULT_COVER, type: 0.35, base: 700, thickness: 900, density: 0.04 });
export const KEY = Object.freeze({
  desktop: [2048, 512], phone: [1024, 256],   // azimuth × elevation texels; phone under PHONE_PX backing pixels
  phonePx: 0.6e6, layers: 3, cycleFrames: 60,   // a full key per second at 60 Hz (the live loop; captures step the same)
  steps: 64, lightSteps: 3, maxDistance: 30000,  // the march: samples along the ray, toward the sun, the far fade's end (m)
  shapeM: 5000, detailM: 700, weatherM: 24000,   // the noise tiles (v1's)
  noise: 64, weather: 256, driftMul: 1.5,        // the 3D noise's side, the weather map's side, the drift's share of the wind (v1's 1.5)
  cutM: 100,                                     // an eye jump past this re-bakes the whole key at once (a camera cut)
});

export const keySizeFor = (pixels) => (pixels < KEY.phonePx ? KEY.phone : KEY.desktop);

// --- the key's directions: u the azimuth (atan2(z, x)), v = sqrt(e / 90°), e the elevation; row 0 is the horizon ---
export function dirToKeyUV(d) {
  const e = Math.asin(Math.max(-1, Math.min(1, d[1])));
  return [Math.atan2(d[2], d[0]) / (2 * Math.PI) + 0.5, Math.sqrt(Math.max(0, e) / (Math.PI / 2))];
}
export function keyUVToDir(u, v) {
  const az = (u - 0.5) * 2 * Math.PI, e = v * v * (Math.PI / 2);
  return [Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az)];
}

// --- the schedule: three layers; `next` is baked `perFrame` rows a step; when whole it becomes `cur`, the old `cur`
// becomes `prev`, and the read fades from prev to cur over the following cycle (fade = the next bake's progress) ---
export function createKeySchedule({ rows, cycleFrames = KEY.cycleFrames, layers = KEY.layers } = {}) {
  if (!(rows > 0) || layers < 3) throw new Error('key schedule: rows > 0 and 3 layers');
  const perFrame = Math.ceil(rows / cycleFrames);
  const s = { cur: 0, prev: 0, next: 1, row: 0, fade: 1, cycles: 0, perFrame, rows };
  const out = { layer: 1, row0: 0, rows: 0, swapped: false, cur: 0, prev: 0, fade: 1 };
  const swap = () => { s.prev = s.cur; s.cur = s.next; s.next = [0, 1, 2].find((k) => k !== s.cur && k !== s.prev); s.row = 0; s.cycles++; };
  return {
    get state() { return s; },
    // one frame's bake: { layer, row0, rows } to march; all: the whole key now (the first frame, a cut), swapped at once
    step(all = false) {
      out.layer = s.next; out.swapped = false;
      if (all) { out.row0 = 0; out.rows = rows; swap(); s.prev = s.cur; out.swapped = true; }
      else {
        out.row0 = s.row; out.rows = Math.min(perFrame, rows - s.row); s.row += out.rows;
        if (s.row >= rows) { swap(); out.swapped = true; }
      }
      out.cur = s.cur; out.prev = s.prev; out.fade = s.row / rows;   // after a swap the read starts at the old key and fades in
      s.fade = out.fade;
      return out;
    },
  };
}

// --- the drift: the deck rides the shared wind (toward: from a compass `from`, (−sin, +cos) in (x east, z south)), at
// driftMul × its speed (v1's world.js), by the scene clock; metres ---
export function cloudDrift(speedMs, fromDeg, t, mul = KEY.driftMul) {
  const a = fromDeg * Math.PI / 180;
  return [-Math.sin(a) * speedMs * mul * t, Math.cos(a) * speedMs * mul * t];
}

// --- the cloud light as v1's camera shows it (fix(v2) cloud colour, 2026-11-14; the owner: "Our cloud color … do not
// match V1": v2's clouds read grey with dark undersides against v1's white tops and light grey undersides). Two causes,
// measured by switching terms off in both apps (tools/v2-cloud-colour.mjs, v2/notes/sky.md § The clouds' colour):
//   the sky light: v1 lights the deck with the sky's irradiance E (takram's indirect scalar illuminance, 2π E, over 2π),
//     the port read it as a mean radiance and took E / π: π too little sky light on every cloud;
//   the camera: v1 exposes the clouds with a fixed base by day and lets its sky-only polariser curve (src/core/grade.js
//     SKY: × 0.53) and AgX's soft shoulder keep them bright; v2's one exposure puts a grey card at 0.24 into ACES (the
//     navy water with no grade), which leaves the clouds ≈ 3 × darker in the mids and 1.4 × at the sunlit tops.
// So the deck's light carries v1's camera: the sun × `sun`, the sky × `sky` (π for E, × 3.2 for the exposure), the sky
// light's chroma × `chroma` (AgX and v1's LUT desaturate a lit blue; ACES keeps it), each scaled by the ratio of v1's
// exposure to v2's at the sun's height (v2 adapts toward dusk, v1 holds its base above 8.5°; never above noon's) and
// faded out below the sun's `dayDeg` (the night keeps its own look, owner 2026-11-13). #18 r2: it holds in a storm too
// (it faded out under a storm's dark or cover; v1's camera is the same in the rain: cam L under the anvil read 109, 120, 142
// against v1's 109, 125, 142 under the ACES camera, tools/v2-storm.mjs). Fitted at noon (cam E, cam A, the follow camera) against v1's samples. ---
// fix(v2) frame look: with v1's camera on the frame (AgX, v1's LUT, v1's day exposure: sim/exposure.js, render/grade.js) the
// match is re-fitted against v1's samples (tools/v2-cloud-colour.mjs, noon cam E, cam A, the follow camera, 09:00, 18:45):
// AgX's and the LUT's shoulder takes a white further in than ACES did, so the sun × 1.85 and the sky × 7.7 at the day
// exposure 0.34, the sky light's chroma × 1.05; the exposure ratio r is 1 all day now (both follow v1's schedule). ?look=v2
// keeps the ACES camera and its match (LIGHT_MATCH_V2, the numbers above)
export const LIGHT_MATCH_V2 = Object.freeze({ sun: 1.4, sky: 10, chroma: 0.5, dayDeg: [-2, 10] });
export const LIGHT_MATCH = Object.freeze({ sun: 1.85, sky: 7.7, chroma: 1.05, dayDeg: [-2, 10] });
// the water's mirror takes the deck's light as before the camera change, not the screen's extra gain for AgX's shoulder
// (render/water.js mirrorBlur): with the full gain the reflected clouds lifted the near sea out of its navy
export const MIRROR_DECK = LIGHT_MATCH_V2.sun / LIGHT_MATCH.sun;
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// → [sun gain, sky gain, sky chroma] for the march (1, 1, 1 at night); weather: kept for the callers (unused since #18 r2)
//: through the twilight the deck's sky light is lifted with the drawn sky (render/grade.js TWILIGHT.cloudSky),
// never below the day's match where that is higher; the night (under the twilight's -11 deg) keeps its own look
export function cloudLightMatch(sunElevDeg, weather = null, M = currentLook() === 'v2' ? LIGHT_MATCH_V2 : LIGHT_MATCH) {
  const r = Math.min(1, (exposureAt(sunElevDeg) / 6) / (exposureFactor(6, sunElevDeg) / lookBase()));
  const w = smooth01(M.dayDeg[0], M.dayDeg[1], sunElevDeg);   // #18 r2: in a storm too (it faded out under the storm's dark or cover)
  const tw = currentLook() === 'v2' ? 0 : twilightShare(sunElevDeg);
  return [1 + w * (M.sun * r - 1), Math.max(1 + w * (M.sky * r - 1), 1 + tw * (TWILIGHT.cloudSky - 1)), 1 + w * (M.chroma - 1)];
}

// --- the params record (8 × vec4, 128 B), the uniform every reader and the bake share ---
export const PARAM_FLOATS = 32;
export function fillParams(out, { cur = 0, prev = 0, fade = 1, on = 1, deck = DECK, drift = [0, 0], t = 0, row0 = 0, layer = 0, weather = null, seed = 1, night = 0, match = [1, 1, 1] }) {
  const w = weather ?? NO_WEATHER;
  out[0] = cur; out[1] = prev; out[2] = fade; out[3] = on;
  out[4] = deck.coverage; out[5] = deck.type; out[6] = deck.base; out[7] = deck.thickness;
  out[8] = drift[0]; out[9] = drift[1]; out[10] = t; out[11] = row0;
  out[12] = w.cell[0]; out[13] = w.cell[1]; out[14] = Math.max(w.cell[2], 1); out[15] = w.on ? w.cover : 0;
  out[16] = w.on ? w.slab : 0; out[17] = w.on ? w.shade : 0; out[18] = deck.density; out[19] = layer;
  out[20] = seed; out[21] = night; out[22] = 0; out[23] = 0;
  out[24] = match[0]; out[25] = match[1]; out[26] = match[2]; out[27] = 0;
  // #18: the towers' growth (v1's cellMask spreads the anvil with it); storm round 2: the cell's drift (unit x, z: the one wind's
  // steering flow, v2/sim/storm.js); 30 spare
  out[28] = w.on && w.dir ? w.dir[0] : 0; out[29] = w.on && w.dir ? w.dir[1] : 0; out[30] = 0; out[31] = w.on ? w.tall : 0;
  return out;
}
const NO_WEATHER = createWeatherState();
export { createWeatherState };

// --- the JS twins of the WGSL noise (render/clouds.js NOISE_WGSL): a u32 hash, tileable Perlin and inverted Worley
// with an integer period, the Nubis shape and the Worley-fBm detail, the weather map's fBm; and the density algebra ---
const u32 = (x) => x >>> 0;
export function hash3(x, y, z, seed) {
  let h = u32(Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1442695041));
  h = u32(Math.imul(h ^ (h >>> 13), 1274126177));
  return u32(h ^ (h >>> 16)) / 4294967296;
}
const wrap = (i, p) => ((i % p) + p) % p;
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
import { lerp } from '../../src/sim/core/math.js';
// gradient noise with period p cells, roughly in [−1, 1]
export function perlin(x, y, z, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const g = (i, j, k, dx, dy, dz) => {
    const wi = wrap(i, p), wj = wrap(j, p), wk = wrap(k, p);
    const th = hash3(wi, wj, wk, seed) * 6.283185, ph = hash3(wi, wj, wk, seed + 17) * 2 - 1;
    const s = Math.sqrt(Math.max(0, 1 - ph * ph));
    return Math.cos(th) * s * dx + Math.sin(th) * s * dy + ph * dz;
  };
  const u = fade(fx), v = fade(fy), w = fade(fz);
  return lerp(
    lerp(lerp(g(xi, yi, zi, fx, fy, fz), g(xi + 1, yi, zi, fx - 1, fy, fz), u), lerp(g(xi, yi + 1, zi, fx, fy - 1, fz), g(xi + 1, yi + 1, zi, fx - 1, fy - 1, fz), u), v),
    lerp(lerp(g(xi, yi, zi + 1, fx, fy, fz - 1), g(xi + 1, yi, zi + 1, fx - 1, fy, fz - 1), u), lerp(g(xi, yi + 1, zi + 1, fx, fy - 1, fz - 1), g(xi + 1, yi + 1, zi + 1, fx - 1, fy - 1, fz - 1), u), v), w) * 1.6;
}
// inverted Worley (1 at a feature point, 0 a cell away) with period p cells
export function worley(x, y, z, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let d2 = 9;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j, cz = zi + k, wx = wrap(cx, p), wy = wrap(cy, p), wz = wrap(cz, p);
    const dx = cx + hash3(wx, wy, wz, seed) - x, dy = cy + hash3(wx, wy, wz, seed + 1) - y, dz = cz + hash3(wx, wy, wz, seed + 2) - z;
    d2 = Math.min(d2, dx * dx + dy * dy + dz * dz);
  }
  return 1 - Math.min(1, Math.sqrt(d2));
}
const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
// the shape (Perlin-Worley billows remapped by a low Worley fBm: the Nubis base) and the detail (a Worley fBm), on the
// unit cube, before the stretch; v1's clouds-noise.js formulas
export function shapeRaw(x, y, z, seed) {
  let pn = 0, a = 0.5, n = 0;
  for (let o = 0; o < 4; o++) { const p = 4 << o; pn += perlin(x * p, y * p, z * p, p, seed + o) * a; n += a; a *= 0.5; }
  pn = pn / n * 0.5 + 0.5;
  const w = worley(x * 4, y * 4, z * 4, 4, seed + 11) * 0.625 + worley(x * 8, y * 8, z * 8, 8, seed + 12) * 0.25 + worley(x * 16, y * 16, z * 16, 16, seed + 13) * 0.125;
  return remap(remap(pn, 0, 1, w, 1), w - 1, 1, 0, 1);
}
export function detailRaw(x, y, z, seed) {
  return worley(x * 4, y * 4, z * 4, 4, seed + 21) * 0.625 + worley(x * 8, y * 8, z * 8, 8, seed + 22) * 0.25 + worley(x * 16, y * 16, z * 16, 16, seed + 23) * 0.125;
}
export function weatherRaw(x, y, seed) {
  let c = 0, t = 0, a = 0.5, n = 0;
  for (let o = 0; o < 5; o++) { const p = 4 << o; c += perlin(x * p, y * p, 0.5, p, seed + 31 + o) * a; t += perlin(x * (p >> 1), y * (p >> 1), 3.5, p >> 1, seed + 41 + o) * a; n += a; a *= 0.5; }
  return [c / n, t / n];
}
// v1 stretched each volume's 1st..99th percentile to 0..1 (toBytes). The GPU bake has no percentiles, so the stretch
// is these fixed bounds (measured on seed 1's 32³ sample; the test holds them within 0.06 of the sample's percentiles)
export const STRETCH = Object.freeze({ shape: [0.73, 0.92], detail: [0.20, 0.75], weather: [-0.40, 0.37] });
export const stretch = (v, [lo, hi]) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

const sat = (x) => Math.min(1, Math.max(0, x));
import { smooth } from '../../src/sim/core/math.js';
// the density algebra at one sample (the WGSL's `baseDensity` + `erode`), from the noise values already fetched:
// shape, detail in 0..1 (stretched), the weather map's coverage and type variations in 0..1, h the height fraction in
// the slab, the deck's coverage and type; cell: the storm cell's weight here (0 fair). Returns the eroded density 0..1.
export function cloudDensity({ shape, detail, wR, wG, h, coverage, type, cell = 0, cellCover = 0 }) {
  if (h <= 0 || h >= 1) return 0;
  // M5e: in the storm cell (v1's hooks): the type toward towers, a flat base, the coverage held under 1
  const mc = cell * (cellCover > 0.001 ? 1 : 0) * sat(cellCover);
  const t = lerp(sat(type + (wG - 0.5) * 0.5), 0.97, mc);
  const hTop = lerp(0.3, 1.0, t);
  const grad = smooth(0, lerp(lerp(0.35, 0.1, t), 0.015, mc), h) * (1 - smooth(hTop * 0.55, hTop, h));
  const cov = Math.max(sat(coverage + (wR - 0.5) * 0.7 + cell * cellCover), mc * 0.82);
  const d = sat((shape * grad - (1 - cov)) / Math.max(cov, 0.05)) * sat(cov * 1.5);
  if (d <= 0) return 0;
  const dm = lerp(detail, 1 - detail, sat(h * 4));   // wispy under, billowy above
  return sat((d - dm * 0.3) / 0.7);
}
// the two-lobe Henyey-Greenstein phase of v1's march (× 4π, + 0.1 floor)
export const hg = (c, g) => (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5) / (4 * Math.PI);
export const phase = (c) => (hg(c, 0.6) * 0.7 + hg(c, -0.25) * 0.3) * 4 * Math.PI + 0.1;
