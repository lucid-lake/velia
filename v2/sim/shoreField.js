// #56 M3, the shore (2026-11-14): the shore field's bake, its file format and the JS twins of the breakers and the swash the
// shaders draw (render/shore.js). Pure: the bake tool (tools/v2-shore-bake.mjs), the loader and the node tests call it.
//
// The bake is Ultra-Water's travel-time field (src/water/shoreMap.js bakeShoreMap / bakeTravel), ported to v2's grids:
//   Ultra-Water, https://github.com/Humpalumps/Ultra-Water @ ce9248f, copyright (c) 2026 Humpalumps, MIT License
//   (src/waters/ultra/LICENSE; ATTRIBUTION.md). The permission notice applies to the ported exact distance transform, the
//   fast-sweeping eikonal solver, the front direction, curvature and ray-tube terms below, and to the wave model the shaders
//   and the twins here share (shoreWaves, swash: phase ω(τ + t), Green's law, the 0.42 d limit, peeling, the plunging lean).
// What differs from Ultra, on purpose (a lake's wind waves, not ocean swell):
//   - the grid: rectangular, 2 m texels over the bay's 2 m terrain box (Ultra: one 512² square of ≈ 3.5 m), the heights from
//     v1's sampler (= v2's terrainHeight); kept only in 32 m tiles that hold the shore's band (the file is a few hundred kB);
//   - two travel times: τ for a front whose speed is √(g min(d, D)) with D = 0.35 m and D = 2.5 m. A lake's waves are short
//     (Tp 1.2–3 s, 2–14 m long), so they feel the bed only in the last metres; the shader mixes the two by the wave's own
//     period so the offshore wavelength is the deep-water one (Ultra's one D = 14 m is an ocean swell's);
//   - Green's law from the depth where the wave first feels the bed (0.06 L0), at run time (it depends on the period); the
//     bake keeps the ray-tube factor (refraction's convergence) alone;
//   - the breaker by the bed slope (the surf similarity, Battjes 1974): spilling on a flat beach, plunging on a moderate
//     one, surging (no break) on rock; the run-up by Stockdon et al. 2006 (Coastal Eng. 53, eq. 19) from the beach slope;
//   - the amplitude from v1's sea at the point (the fetch map's Hs × the shore's exposure to the wind), so a calm day laps
//     and a windy day breaks on the exposed beaches only.
//
// File (v2/assets/shore/shore.vsf.gz, gzip of):
//   u32 magic 'VSF1', u32 version, f32 x0, f32 z0 (the grid's corner, m), f32 texel (m), u32 tile (texels), u32 tilesX,
//   u32 tilesZ, u32 nTiles, u32 0, f32 dLo, f32 dHi (the two D), f32 tauStep (s), f32 tauOff (s), 2 × u32 spare (64 B)
//   index    u16 × tilesX·tilesZ: the tile's slot + 1 (0: no shore there)
//   planes   per kept tile 256 texels, row-major, each 2-D predicted in its tile (left + up − up-left): τ(dLo) u16, τ(dHi)
//            u16, each as a lo-byte then a hi-byte plane; then u8 planes: the front's direction (angle × 256 / 2π), the ray-tube factor
//            ((rt − 0.3) / 2.2 · 63), the bed slope (β / 0.5 · 63), the fade (0–255: the front's coherence × a clean coast), the
//            spray's emitter mask (0 | 1; the loader jitters one emitter in each marked texel: emitters())
// The GPU buffer (gpuWords): params (64 words, written per frame), the header's numbers (16), the index (u16 pairs), the
// tiles' texels (2 words each: τ(dLo) | τ(dHi) << 16; angle | rt << 8 | β << 16 | fade << 24), the emitters.

export const SHORE_BAKE = Object.freeze({
  x0: -2304, z0: -1792, w: 2816, h: 1792, texel: 2,   // the bay's 2 m box (terrain/tahoe.json "bay": −2303 … 3327, −1791 … 1791)
  tile: 16,                                            // 32 m tiles
  dLo: 0.35, dHi: 2.5,                                 // m: the fronts' depth caps (Ultra: DMIN 0.3, DMAX 14)
  dMin: 0.05,                                          // m: the speed's floor at the waterline
  band: Object.freeze([-3.6, 1.25]),                    // m of ground height: a tile is kept where any texel lies in it
  tauStep: 0.016, tauOff: 64,                          // s: τ stored as u16 (τ + tauOff) / tauStep: −64 … 984 s (0.05 rad at ω 3.3)
  islet: 64,                                           // texels (256 m²): land blobs smaller than this seed no fronts (Ultra)
  rayL: 50, rayStep: 3, rayBand: 300, kappaMax: 1 / 25,   // Ultra's ray tube (m, texels, m, 1/m)
  sweeps: 16,                                          // fast-sweeping rounds at most (each 4 orders; stops when settled)
  emit: Object.freeze({ depth: [0.12, 1.1], beta: 0.22, fade: 0.5, every: 1 }),   // spray emitters: one a texel in the surf zone
});
export const MAGIC = 0x31465356;   // 'VSF1'
export const HEAD_WORDS = 16, PARAM_WORDS = 160;
export const TILE_TEXELS = SHORE_BAKE.tile * SHORE_BAKE.tile;
export const Q6 = 63;   // the ray tube and the bed slope: 6 bits (their noise is all the gzip saw at 8)
const G = 9.81, INF = 1e20;

// --- the run-time model (the WGSL in render/shore.js is the same, line for line) ---
export const SHORE = Object.freeze({
  dIn: 3.5,            // m: the shore trains fade in shoreward of this depth (the FFT's chop dies under 2 m: v1's damping)
  landMax: 1.2,        // m of ground over the lake: the swash and the wet sand stop here
  ampK: 0.5,           // the main train's amplitude per m of Hs: the significant wave (H = Hs; the sets' group noise takes it to 0.55–1 of that)
  second: 0.45,        // the second train's amplitude share (Ultra's), period × 1/1.28 (its wavelength × 0.61)
  gamma: 0.42,         // the breaking limit: a ≤ 0.42 d (Ultra; McCowan's H/d = 0.78 is a = 0.39 d)
  breakLo: 0.85,       // breaking starts where the free amplitude reaches this share of the limit (peeling's early sections)
  breakAmp: Object.freeze([0.05, 0.1]),      // m of amplitude: no whitewater under the first, full by the second (a 10 cm wave collapses glassy)
  whiteWind: Object.freeze([3.2, 5.2]),     // m/s: the shore's whitewater fades in over this wind (owner: a calm day laps, more lapping than surf)
  lee: 0.12,           // the train on a shore facing away from the wind (its exposure's floor: a lake's lee shore laps)
  group: Object.freeze([0.55, 0.45]),        // the sets: base + share of a slow noise
  steep: 1.0,          // Ultra's steepness (its uShoreWave.w)
  runup: Object.freeze([0.02, 0.6]),         // m: the swash's height range (0.75 of Stockdon's R2: a typical swash, not the 2 % one)
  dryS: 5,             // s: the wet sand dries (Ultra)
  wetDark: 0.42,       // the wet sand's darkening (dry albedo × 0.58: Twomey et al. 1986 sand, a film of water)
  spray: Object.freeze({ windLo: 8.5, windHi: 12, amp: 0.09, range: 160, maxTiles: 32, perEmitter: 4, maxInstances: 12288 }),
  range: 1400,         // m: no shore tile nearer than this in view: the field is off (its cost is a uniform branch)
  phone: Object.freeze({ second: false, lean: false, spray: false, lace: false }),
});
// the peak period of v1's fetch-limited sea (JONSWAP: fp = 3.5 g/U (gF/U²)^−0.33), s
export function peakPeriod(U, fetchM) {
  const u = Math.max(U, 0.5), x = G * Math.max(fetchM, 100) / (u * u);
  return Math.min(8, Math.max(0.9, u / (3.5 * G) * Math.pow(x, 0.33)));
}
// the mix of the two travel times for a wave of angular frequency w: its deep-water slowness w / g between 1 / c(dLo) and 1 / c(dHi)
export function tauMix(w, dLo = SHORE_BAKE.dLo, dHi = SHORE_BAKE.dHi) {
  const s1 = 1 / Math.sqrt(G * dLo), s2 = 1 / Math.sqrt(G * dHi);
  return Math.min(1, Math.max(0, (w / G - s1) / (s2 - s1)));
}

const sat = (x) => Math.min(Math.max(x, 0), 1);
import { smooth } from '../../src/sim/core/math.js'; export { smooth };
const fract = (x) => x - Math.floor(x);
// Ultra's hash12 and value noise (the WGSL's twins)
export function hash12(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
export function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export const noisePhase = (x, z) => vnoise(x * 0.011, z * 0.011) * 7 + vnoise(x * 0.031 + 7, z * 0.031 + 7) * 2.2;
export const groupAt = (x, z, t) => SHORE.group[0] + SHORE.group[1] * vnoise(x * 0.012 + t * 0.061, z * 0.012 - t * 0.047);

// the per-frame params from the wind at the boat: U (m/s), its travel (rad), the fetch (m) at the sea's point
// The period: the bay's fetch (6 km) and the wind rounded to 0.5 m/s (the FFT's own table key): the phase ω(τ + t) is ω × τ over
// τ of tens to hundreds of seconds, so a period following each gust or the boat's fetch would sweep the crests along the coast
// every frame (and made the film goldens differ run to run); it changes only when the FFT's tables do
export const periodKey = (U) => Math.max(1, Math.round(Math.max(1, U) * 2) / 2);
export function shoreParams({ U, travelRad }) {
  const T = peakPeriod(periodKey(U), 6000), w0 = 2 * Math.PI / T, w1 = w0 * 1.28;
  travelRad = Math.round(travelRad * 50) / 50;   // the exposure's wind on 0.02 rad steps (a step moves an amplitude by ≈ 1 %)
  return { T, w0, w1, f0: tauMix(w0), f1: tauMix(w1), dirX: Math.cos(travelRad), dirZ: Math.sin(travelRad),
    spray: smooth(SHORE.spray.windLo, SHORE.spray.windHi, U), white: smooth(SHORE.whiteWind[0], SHORE.whiteWind[1], U) };
}

// the shore trains at a point (Ultra's shoreWaves on the lake's numbers). tex: the field there ({ tau0, tau1, dx, dz, rt,
// beta, fade }); d the bed's depth (m, > 0 water); hs the sea's Hs here before the depth's calm (m); p the frame's params
export function shoreWaves(x, z, d, hs, t, tex, p, { lite = false } = {}) {
  const o = { y: 0, dx: 0, dz: 0, sx: 0, sz: 0, foam: 0, breaking: 0, lip: 0, residual: 0, a0: 0, aFree: 0, k0: 0, w0: 0, ph0: 0, xi: 0, dirX: 0, dirZ: 0 };
  if (!tex || tex.fade <= 0 || d > SHORE.dIn) return o;
  const dirX = tex.dx, dirZ = tex.dz; o.dirX = dirX; o.dirZ = dirZ;
  const expo = SHORE.lee + (1 - SHORE.lee) * smooth(-0.2, 0.7, dirX * p.dirX + dirZ * p.dirZ);
  const env = (1 - smooth(SHORE.dIn * 0.45, SHORE.dIn, d)) * smooth(-0.05, 0.08, d) * smooth(0.1, 0.45, tex.fade);   // the fade gates (a shock, an unclean coast); it never thins a clean front
  if (env <= 0) return o;
  const group = groupAt(x, z, t), np = noisePhase(x, z);
  let pinch = 0.85;
  for (let i = 0; i < (lite ? 1 : 2); i++) {
    const w = i === 0 ? p.w0 : p.w1, f = i === 0 ? p.f0 : p.f1;
    const tau = tex.tau0 + (tex.tau1 - tex.tau0) * f;
    const dCap = G / (w * w);                       // the depth whose shallow-water speed is the deep-water speed
    const cel = Math.sqrt(G * Math.min(Math.max(d, SHORE_BAKE.dMin), dCap));
    const k = w / cel;
    const L0 = 2 * Math.PI * G / (w * w);
    const green = Math.min(1.6, Math.max(1, Math.pow(Math.max(d, 0.05) / (0.06 * L0), -0.25)));
    const aFree = SHORE.ampK * hs * (i === 0 ? 1 : SHORE.second) * env * expo * group * tex.rt * green;
    const amax = SHORE.gamma * Math.max(d, 0) * (i === 0 ? 1 : 0.5);
    const a = Math.min(aFree, amax);
    const ph = w * (tau + t) + np * (i === 0 ? 1 : 1.37) + i * 2.1;
    const c = 0.5 + 0.5 * Math.cos(ph), s = Math.sin(ph);
    const P = 1.6, cp = Math.pow(c, P - 1);
    const gam = aFree / Math.max(SHORE.gamma * Math.max(d, 0.01), 1e-4);   // the free wave over its limit here
    const cycle = Math.floor((ph + Math.PI) / (2 * Math.PI));
    const early = vnoise(x * 0.06 + cycle * 7.3, z * 0.06 + cycle * 3.1 + i * 31);
    const breaking = smooth(SHORE.breakLo + 0.1 * early, 1 + 0.25 * early, gam) * smooth(SHORE.breakAmp[0], SHORE.breakAmp[1], a) * p.white;
    const xi = Math.min(tex.beta, 0.5) / Math.sqrt(Math.max(2 * a, 1e-3) / L0);   // the surf similarity (H = 2a)
    const plunge = smooth(0.35, 0.6, xi) * (1 - smooth(2.5, 3.5, xi));
    const surge = smooth(2.5, 4, xi);
    let pitch = i === 0 && !lite ? 2 * SHORE.steep * a * smooth(1.0, 1.25, gam) * (1 - smooth(1.6, 2.4, gam)) * plunge : 0;
    pitch = Math.min(pitch, 0.35 / (1.08 * k));
    pinch -= 1.08 * pitch * k;
    const qak = Math.min(pinch, SHORE.steep * a * k * 8); pinch -= qak;
    const c5 = c * c * c * c * c;
    o.y += a * (2 * cp * c - 0.78);
    const push = (qak / k) * s + pitch * c5 * c;
    o.dx += dirX * push; o.dz += dirZ * push;
    const sl = a * k * P * cp * s / Math.max(1 - qak * Math.cos(ph) + 3 * pitch * k * c5 * s, 0.2);
    o.sx += dirX * sl; o.sz += dirZ * sl;
    const psi = ((ph + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    o.foam += breaking * (1 - 0.8 * surge) * smooth(-0.45, 0, psi) * Math.exp(-Math.max(psi, 0) * 0.8);
    if (i === 0) {
      o.a0 = a; o.aFree = aFree; o.k0 = k; o.w0 = w; o.ph0 = ph; o.breaking = breaking * (1 - surge); o.xi = xi;
      o.lip = o.breaking * c5 * (1 - smooth(-0.2, 0.6, psi)) * plunge;
      o.residual = smooth(1.0, 1.8, gam) * smooth(SHORE.breakAmp[0], SHORE.breakAmp[1], a) * p.white * (0.3 + 0.45 * Math.exp(-(((ph % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 0.4)) * (1 - surge);
    }
  }
  return o;
}

// the swash on the sand (Ultra's swash): g the ground's height over the lake (m, > 0 land), hs, t, tex, p as above.
// Returns { th: the film's thickness (m), edge: the bore's foam line 0–1, wet: 0–1, R: the run-up (m) }
export function swash(x, z, g, hs, t, tex, p) {
  const o = { th: 0, edge: 0, wet: 0, R: 0 };
  if (!tex || tex.fade <= 0 || g < -0.3 || g > SHORE.landMax) return o;
  const expo = SHORE.lee + (1 - SHORE.lee) * smooth(-0.2, 0.7, tex.dx * p.dirX + tex.dz * p.dirZ);
  const H0 = 2 * SHORE.ampK * hs * expo * groupAt(x, z, t);
  const L0 = 2 * Math.PI * G / (p.w0 * p.w0), b = Math.min(Math.max(tex.beta, 0.02), 0.3);
  const HL = Math.sqrt(Math.max(H0 * L0, 0));
  const R = Math.min(SHORE.runup[1], 0.75 * (0.35 * b * HL + 0.5 * Math.sqrt(H0 * L0 * (0.563 * b * b + 0.004)))) * smooth(0.1, 0.45, tex.fade);
  o.R = R;
  if (R < SHORE.runup[0]) return o;
  if (g > R) { o.wet = 0.5 * (1 - smooth(R, 1.5 * R, g)); return o; }
  const s = fract((p.w0 * t + noisePhase(x, z)) / (2 * Math.PI));
  const eta = R * (s < 0.3 ? Math.sin(s / 0.3 * Math.PI / 2) : Math.cos((s - 0.3) / 0.7 * Math.PI / 2));
  const th = eta - g;
  o.th = Math.max(th, 0);
  o.edge = s < 0.35 ? smooth(-0.01, 0, th) * (1 - smooth(0, 0.04, th)) : 0;
  const sPass = 0.3 + 0.7 * Math.acos(Math.min(Math.max(g / R, 0), 1)) / (Math.PI / 2);
  const dry = (s > sPass ? s - sPass : s + 1 - sPass) * 2 * Math.PI / p.w0;
  o.wet = th > 0 ? 1 : Math.exp(-dry / SHORE.dryS);
  return o;
}

// --- the bake (Ultra's shoreMap.js, rectangular) ---
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
// squared distance (texels) from every texel to the nearest texel where mask is set (Felzenszwalb & Huttenlocher 2012)
export function edt2d(mask, w, h) {
  const out = new Float64Array(w * h); for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 0 : INF;
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = out[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) out[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = out[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) out[y * w + x] = d[x]; }
  return out;
}
const clampi = (x, hi) => (x < 0 ? 0 : x > hi ? hi : x);
export function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length), dst = new Float32Array(src.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) { const o = y * w; let s = 0; for (let i = -r; i <= r; i++) s += src[o + clampi(i, w - 1)]; for (let x = 0; x < w; x++) { tmp[o + x] = s / n; s += src[o + clampi(x + r + 1, w - 1)] - src[o + clampi(x - r, w - 1)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) s += tmp[clampi(i, h - 1) * w + x]; for (let y = 0; y < h; y++) { dst[y * w + x] = s / n; s += tmp[clampi(y + r + 1, h - 1) * w + x] - tmp[clampi(y - r, h - 1) * w + x]; } }
  return dst;
}
// the sea with small islets flooded (Ultra's wetMask: seeding them would ring them with bullseye crests)
function wetMask(sea, w, h, islet) {
  const n = w * h, wet = sea.slice(), seen = new Uint8Array(n), stack = new Int32Array(n), comp = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (sea[s] || seen[s]) continue;
    let top = 0, cnt = 0; stack[top++] = s; seen[s] = 1;
    while (top > 0) {
      const k = stack[--top], i = k % w; comp[cnt++] = k;
      if (i > 0 && !sea[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack[top++] = k - 1; }
      if (i < w - 1 && !sea[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack[top++] = k + 1; }
      if (k >= w && !sea[k - w] && !seen[k - w]) { seen[k - w] = 1; stack[top++] = k - w; }
      if (k < n - w && !sea[k + w] && !seen[k + w]) { seen[k + w] = 1; stack[top++] = k + w; }
    }
    if (cnt < islet) for (let q = 0; q < cnt; q++) wet[comp[q]] = 1;
  }
  return wet;
}
// fast sweeping (Zhao 2005; Ultra's locking variant): |∇τ| = 1 / c, seeded at the bilinear waterline with sub-texel distance
function travel(height, wet, w, h, texel, dCap, dMin, rounds) {
  const n = w * h, W = w + 2, slow = new Float64Array(n);
  for (let k = 0; k < n; k++) slow[k] = texel / Math.sqrt(G * Math.min(dCap, Math.max(dMin, -height[k])));
  const T = new Float64Array(W * (h + 2)).fill(Infinity), open = new Uint8Array(W * (h + 2)).fill(2);
  for (let j = 0; j < h; j++) open.fill(1, (j + 1) * W + 1, (j + 1) * W + 1 + w);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, ww = wet[k], hh = height[k];
    let dx = Infinity, dy = Infinity;
    if (i > 0 && wet[k - 1] !== ww) dx = hh / (hh - height[k - 1]);
    if (i < w - 1 && wet[k + 1] !== ww) dx = Math.min(dx, hh / (hh - height[k + 1]));
    if (j > 0 && wet[k - w] !== ww) dy = hh / (hh - height[k - w]);
    if (j < h - 1 && wet[k + w] !== ww) dy = Math.min(dy, hh / (hh - height[k + w]));
    if (dx === Infinity && dy === Infinity) continue;
    if (!Number.isFinite(dx) && dx !== Infinity) dx = 0.5; if (!Number.isFinite(dy) && dy !== Infinity) dy = 0.5;
    const dd = dx === Infinity ? dy : dy === Infinity ? dx : dx * dy / (Math.sqrt(dx * dx + dy * dy) || 1);
    const p = k + 2 * j + W + 1; T[p] = Math.min(Math.abs(dd), 1) * slow[k]; open[p] = 2;
  }
  const pass = (di, dj) => {
    let changed = 0;
    for (let jj = 0, j = dj > 0 ? 0 : h - 1; jj < h; jj++, j += dj) for (let ii = 0, i = di > 0 ? 0 : w - 1; ii < w; ii++, i += di) {
      const k = j * w + i, p = k + 2 * j + W + 1;
      if (open[p] !== 1) continue;
      open[p] = 0;
      const l = T[p - 1], r = T[p + 1], u = T[p - W], v = T[p + W];
      const a = l < r ? l : r, b = u < v ? u : v, f = slow[k], d = a > b ? a - b : b - a;
      const t = d >= f ? (a < b ? a : b) + f : 0.5 * (a + b + Math.sqrt(2 * f * f - d * d));
      if (t < T[p] - 1e-4) {
        T[p] = t; changed++;
        if (open[p - 1] === 0) open[p - 1] = 1; if (open[p + 1] === 0) open[p + 1] = 1;
        if (open[p - W] === 0) open[p - W] = 1; if (open[p + W] === 0) open[p + W] = 1;
      }
    }
    return changed;
  };
  for (let it = 0; it < rounds; it++) if (pass(1, 1) + pass(-1, 1) + pass(1, -1) + pass(-1, -1) === 0) break;
  const tau = new Float32Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + i, t = T[k + 2 * j + W + 1]; tau[k] = t === Infinity ? 0 : wet[k] ? t : -t; }
  return tau;
}

// bakeShore({ heightAt, box }) → the decoded field (decodeShore's shape) plus the full-grid planes for the tests
export function bakeShore({ heightAt, box = SHORE_BAKE, log = () => {} }) {
  const B = { ...SHORE_BAKE, ...box };
  const { w, h, texel, tile } = B, n = w * h;
  const height = new Float32Array(n), sea = new Uint8Array(n), land = new Uint8Array(n);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, v = heightAt(B.x0 + (i + 0.5) * texel, B.z0 + (j + 0.5) * texel);
    height[k] = v; sea[k] = v <= 0 ? 1 : 0; land[k] = v > 0 ? 1 : 0;
  }
  log('heights');
  const toLand = edt2d(land, w, h), toSea = edt2d(sea, w, h);
  let sdf = new Float32Array(n);
  for (let k = 0; k < n; k++) sdf[k] = sea[k] ? (Math.sqrt(toLand[k]) - 0.5) * texel : -(Math.sqrt(toSea[k]) - 0.5) * texel;
  sdf = boxBlur(boxBlur(sdf, w, h, 2), w, h, 2);
  log('distance');
  const wet = wetMask(sea, w, h, B.islet);
  const tauLo = boxBlur(boxBlur(travel(height, wet, w, h, texel, B.dLo, B.dMin, B.sweeps), w, h, 2), w, h, 2);
  log('travel lo');
  const tauHi = boxBlur(boxBlur(travel(height, wet, w, h, texel, B.dHi, B.dMin, B.sweeps), w, h, 2), w, h, 2);
  log('travel hi');
  // the front's direction, coherence and curvature from τ(dHi) (Ultra's frontDir, curvature)
  const dirX = new Float32Array(n), dirZ = new Float32Array(n), coh = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    const jm = j > 0 ? -w : 0, jp = j < h - 1 ? w : 0;
    for (let i = 0; i < w; i++) {
      const k = j * w + i, im = i > 0 ? -1 : 0, ip = i < w - 1 ? 1 : 0;
      const gx = tauHi[k + ip] - tauHi[k + im], gz = tauHi[k + jp] - tauHi[k + jm], g = Math.sqrt(gx * gx + gz * gz);
      if (g > 1e-9) { dirX[k] = -gx / g; dirZ[k] = -gz / g; }
      const c = Math.sqrt(G * Math.min(B.dHi, Math.max(B.dMin, -height[k])));
      const q = sat((g / ((ip - im) * texel || texel) * c - 0.7) / 0.25);
      coh[k] = q * q * (3 - 2 * q);
    }
  }
  const kap = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    const jm = j > 0 ? -w : 0, jp = j < h - 1 ? w : 0;
    for (let i = 0; i < w; i++) {
      const k = j * w + i, im = i > 0 ? -1 : 0, ip = i < w - 1 ? 1 : 0;
      const kp = -(dirX[k + ip] - dirX[k + im] + dirZ[k + jp] - dirZ[k + jm]) / (2 * texel);
      kap[k] = Math.min(B.kappaMax, Math.max(-B.kappaMax, kp)) * coh[k];
    }
  }
  const kappa = boxBlur(boxBlur(kap, w, h, 2), w, h, 2);
  const fadeC = boxBlur(boxBlur(coh, w, h, 2), w, h, 2);
  log('fronts');
  // the band's tiles first: the ray tube and the slope only where they are kept
  const tx = Math.ceil(w / tile), tz = Math.ceil(h / tile);
  const index = new Uint16Array(tx * tz); let nT = 0;
  for (let J = 0; J < tz; J++) for (let I = 0; I < tx; I++) {
    let keep = false;
    for (let j = J * tile; j < Math.min(h, (J + 1) * tile) && !keep; j++) for (let i = I * tile; i < Math.min(w, (I + 1) * tile); i++) {
      const v = height[j * w + i]; if (v >= B.band[0] && v <= B.band[1]) { keep = true; break; }
    }
    if (keep) index[J * tx + I] = ++nT;
  }
  if (nT >= 65535) throw new Error(`shore bake: ${nT} tiles (u16 index)`);
  const NT = nT * TILE_TEXELS;
  const tau0 = new Uint16Array(NT), tau1 = new Uint16Array(NT), angle = new Uint8Array(NT), rt = new Uint8Array(NT), beta = new Uint8Array(NT), fade = new Uint8Array(NT), mask = new Uint8Array(NT);
  const hs = boxBlur(boxBlur(height, w, h, 1), w, h, 1);   // the bed's slope over ≈ 6 m (a beach's, not a boulder's)
  const q16 = (t) => Math.min(65535, Math.max(0, Math.round((t + B.tauOff) / B.tauStep)));
  // the ray tube along the ray, offshore (Ultra's rayTube: G = ∫ κ e^(−s/L) ds, amplitude ∝ exp(G/2)), bilinear in the grid
  const ds = B.rayStep * texel, steps = Math.ceil(2.5 * B.rayL / ds), wts = new Float32Array(steps);
  for (let s = 0; s < steps; s++) wts[s] = Math.exp(-s * ds / B.rayL) * ds;
  const bil = (A, x, y) => { const ii = Math.min(w - 2, Math.max(0, x | 0)), jj = Math.min(h - 2, Math.max(0, y | 0)), m = jj * w + ii, fx = x - ii, fy = y - jj; return (A[m] * (1 - fx) + A[m + 1] * fx) * (1 - fy) + (A[m + w] * (1 - fx) + A[m + w + 1] * fx) * fy; };
  for (let J = 0; J < tz; J++) for (let I = 0; I < tx; I++) {
    const slot = index[J * tx + I]; if (!slot) continue;
    const base = (slot - 1) * TILE_TEXELS;
    for (let jj = 0; jj < tile; jj++) for (let ii = 0; ii < tile; ii++) {
      const i = Math.min(w - 1, I * tile + ii), j = Math.min(h - 1, J * tile + jj), k = j * w + i, o = base + jj * tile + ii;
      tau0[o] = q16(tauLo[k]); tau1[o] = q16(tauHi[k]);
      angle[o] = Math.round(((Math.atan2(dirZ[k], dirX[k]) / (2 * Math.PI)) % 1 + 1) % 1 * 256) & 255;
      let g = 0;
      if (sdf[k] > -3 * texel && sdf[k] < B.rayBand) {
        let x = i, y = j;
        for (let s = 0; s < steps; s++) {
          g += wts[s] * bil(kappa, x, y);
          const dxx = bil(dirX, x, y), dzz = bil(dirZ, x, y);
          x -= B.rayStep * dxx; y -= B.rayStep * dzz;
          if (x < 0 || y < 0 || x > w - 1 || y > h - 1) break;
        }
        g *= sat((B.rayBand - sdf[k]) / 80);
      }
      const r = Math.min(2.5, Math.max(0.3, Math.exp(0.5 * g)));
      rt[o] = Math.round((r - 0.3) / 2.2 * Q6);
      // the bed's slope: central differences over ±1 texel (the clean coast: Ultra's |∇sdf| ≥ 0.35–0.8 on medial axes)
      const hx = (hs[j * w + Math.min(w - 1, i + 1)] - hs[j * w + Math.max(0, i - 1)]) / (2 * texel);
      const hz = (hs[Math.min(h - 1, j + 1) * w + i] - hs[Math.max(0, j - 1) * w + i]) / (2 * texel);
      const bt = Math.min(0.5, Math.hypot(hx, hz));
      beta[o] = Math.round(bt / 0.5 * Q6);
      const sx = (sdf[j * w + Math.min(w - 1, i + 1)] - sdf[j * w + Math.max(0, i - 1)]) / (2 * texel);
      const sz = (sdf[Math.min(h - 1, j + 1) * w + i] - sdf[Math.max(0, j - 1) * w + i]) / (2 * texel);
      const clean = smooth(0.35, 0.8, Math.hypot(sx, sz));
      fade[o] = Math.round(sat(fadeC[k] * clean) * 255);
      // the spray's emitters: a texel in the surf zone of a gentle, clean beach (the loader jitters one in it: emitters())
      const dep = -height[k];
      mask[o] = I * tile + ii < w && J * tile + jj < h && dep >= B.emit.depth[0] && dep <= B.emit.depth[1] && bt <= B.emit.beta && fade[o] >= B.emit.fade * 255 ? 1 : 0;
    }
  }
  log('tiles');
  const S = { head: { x0: B.x0, z0: B.z0, texel, tile, tilesX: tx, tilesZ: tz, nTiles: nT, nEmit: 0, dLo: B.dLo, dHi: B.dHi, tauStep: B.tauStep, tauOff: B.tauOff },
    index, tau0, tau1, angle, rt, beta, fade, mask, grid: { height, sdf, tauLo, tauHi, w, h } };
  return emitters(S);
}
// the spray's emitters from the mask: one a marked texel, jittered in it by a hash of its place (deterministic); per tile its
// first emitter and count. Each emitter is x, z in its tile (u16 of 32 m each)
export function emitters(S) {
  const H = S.head, T = H.tile, list = [], emitT = new Uint32Array(H.nTiles), emitN = new Uint16Array(H.nTiles);
  for (let J = 0; J < H.tilesZ; J++) for (let I = 0; I < H.tilesX; I++) {
    const slot = S.index[J * H.tilesX + I]; if (!slot) continue;
    const base = (slot - 1) * TILE_TEXELS; emitT[slot - 1] = list.length;
    for (let jj = 0; jj < T; jj++) for (let ii = 0; ii < T; ii++) {
      if (!S.mask[base + jj * T + ii]) continue;
      const i = I * T + ii, j = J * T + jj;
      const ex = (ii + hash12(i * 1.7, j * 2.3)) / T, ez = (jj + hash12(i * 3.1 + 5, j * 0.7)) / T;
      list.push((Math.min(65535, Math.round(ex * 65535)) | (Math.min(65535, Math.round(ez * 65535)) << 16)) >>> 0);
    }
    emitN[slot - 1] = list.length - emitT[slot - 1];
  }
  S.emitT = emitT; S.emitN = emitN; S.emit = Uint32Array.from(list); S.head.nEmit = list.length;
  return S;
}

// --- the file ---
// the 2-D predictor inside each tile (the terrain grids' left + up − up-left, mod mask + 1); unpredict is its inverse, in place
function predict(v, nTiles, T, mask) {
  const out = new v.constructor(v.length);
  for (let t = 0; t < nTiles; t++) for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const k = t * T * T + j * T + i, l = i > 0 ? v[k - 1] : 0, u = j > 0 ? v[k - T] : 0, ul = i > 0 && j > 0 ? v[k - T - 1] : 0;
    const pr = i > 0 && j > 0 ? l + u - ul : i > 0 ? l : u;
    out[k] = (v[k] - pr) & mask;
  }
  return out;
}
function unpredict(v, nTiles, T, mask) {
  for (let t = 0; t < nTiles; t++) for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
    const k = t * T * T + j * T + i, l = i > 0 ? v[k - 1] : 0, u = j > 0 ? v[k - T] : 0, ul = i > 0 && j > 0 ? v[k - T - 1] : 0;
    const pr = i > 0 && j > 0 ? l + u - ul : i > 0 ? l : u;
    v[k] = (v[k] + pr) & mask;
  }
  return v;
}
export function encodeShore(S) {
  const H = S.head, NT = H.nTiles * TILE_TEXELS, T = H.tile;
  const bytes = 64 + H.tilesX * H.tilesZ * 2 + NT * 9;
  const out = new Uint8Array(Math.ceil(bytes / 4) * 4), dv = new DataView(out.buffer);
  const u32 = [MAGIC, 1], f32 = [H.x0, H.z0, H.texel];
  let o = 0;
  for (const v of u32) { dv.setUint32(o, v, true); o += 4; }
  for (const v of f32) { dv.setFloat32(o, v, true); o += 4; }
  for (const v of [H.tile, H.tilesX, H.tilesZ, H.nTiles, 0]) { dv.setUint32(o, v, true); o += 4; }
  for (const v of [H.dLo, H.dHi, H.tauStep, H.tauOff]) { dv.setFloat32(o, v, true); o += 4; }
  o = 64;
  for (let i = 0; i < S.index.length; i++) { dv.setUint16(o, S.index[i], true); o += 2; }
  // every plane 2-D predicted inside its tile (left + up − up-left, mod 2^bits: the fields are smooth), τ as a lo then a hi plane
  for (const tau of [S.tau0, S.tau1]) {
    const d = predict(tau, H.nTiles, T, 65535);
    for (let i = 0; i < NT; i++) out[o + i] = d[i] & 255; o += NT;
    for (let i = 0; i < NT; i++) out[o + i] = d[i] >> 8; o += NT;
  }
  for (const p of [S.angle, S.rt, S.beta, S.fade]) { out.set(predict(p, H.nTiles, T, 255), o); o += NT; }
  out.set(predict(S.mask, H.nTiles, T, 255), o); o += NT;
  return out;
}
export function decodeShore(raw) {
  const b = raw instanceof Uint8Array ? raw : new Uint8Array(raw), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('shore: not a VSF1 file');
  const head = { x0: dv.getFloat32(8, true), z0: dv.getFloat32(12, true), texel: dv.getFloat32(16, true), tile: dv.getUint32(20, true), tilesX: dv.getUint32(24, true), tilesZ: dv.getUint32(28, true),
    nTiles: dv.getUint32(32, true), nEmit: dv.getUint32(36, true), dLo: dv.getFloat32(40, true), dHi: dv.getFloat32(44, true), tauStep: dv.getFloat32(48, true), tauOff: dv.getFloat32(52, true) };
  const NT = head.nTiles * TILE_TEXELS, T = head.tile;
  let o = 64;
  const index = new Uint16Array(head.tilesX * head.tilesZ);
  for (let i = 0; i < index.length; i++) { index[i] = dv.getUint16(o, true); o += 2; }
  const taus = [];
  for (let q = 0; q < 2; q++) {
    const t = new Uint16Array(NT);
    for (let i = 0; i < NT; i++) t[i] = b[o + i] | (b[o + NT + i] << 8);
    o += 2 * NT;
    taus.push(unpredict(t, head.nTiles, T, 65535));
  }
  const plane = () => { const p = unpredict(b.slice(o, o + NT), head.nTiles, T, 255); o += NT; return p; };
  const angle = plane(), rt = plane(), beta = plane(), fade = plane();
  const mask = plane();
  return emitters({ head, index, tau0: taus[0], tau1: taus[1], angle, rt, beta, fade, mask });
}

// the GPU buffer's words (u32): [params PARAM_WORDS][head HEAD_WORDS][index ⌈cells/2⌉][texels 2 × NT][tile emit 2 × nTiles][emit nEmit]
export function gpuLayout(head) {
  const cells = head.tilesX * head.tilesZ, NT = head.nTiles * TILE_TEXELS;
  const index = PARAM_WORDS + HEAD_WORDS, data = index + Math.ceil(cells / 2), tileEmit = data + 2 * NT, emit = tileEmit + 2 * head.nTiles;
  return { index, data, tileEmit, emit, words: emit + head.nEmit };
}
export function gpuWords(S) {
  const H = S.head, L = gpuLayout(H), out = new Uint32Array(L.words), f = new Float32Array(out.buffer);
  const h0 = PARAM_WORDS;
  f[h0] = H.x0; f[h0 + 1] = H.z0; f[h0 + 2] = 1 / H.texel; f[h0 + 3] = H.texel;
  out[h0 + 4] = H.tilesX; out[h0 + 5] = H.tilesZ; out[h0 + 6] = L.index; out[h0 + 7] = L.data;
  f[h0 + 8] = H.tauStep; f[h0 + 9] = H.tauOff; out[h0 + 10] = L.tileEmit; out[h0 + 11] = L.emit; out[h0 + 12] = H.nTiles;
  for (let i = 0; i < S.index.length; i++) out[L.index + (i >> 1)] |= S.index[i] << ((i & 1) * 16);
  const NT = H.nTiles * TILE_TEXELS;
  for (let i = 0; i < NT; i++) {
    out[L.data + 2 * i] = S.tau0[i] | (S.tau1[i] << 16);
    out[L.data + 2 * i + 1] = S.angle[i] | (S.rt[i] << 8) | (S.beta[i] << 16) | ((S.fade[i] << 24) >>> 0);
  }
  for (let i = 0; i < H.nTiles; i++) { out[L.tileEmit + 2 * i] = S.emitT[i]; out[L.tileEmit + 2 * i + 1] = S.emitN[i]; }
  out.set(S.emit, L.emit);
  return out;
}

// the field at a point, bilinear over the kept texels (the WGSL shoreTex's twin): null outside the kept tiles
export function sampleShore(S, x, z) {
  const H = S.head, T = H.tile;
  const gx = (x - H.x0) / H.texel - 0.5, gz = (z - H.z0) / H.texel - 0.5;
  const i0 = Math.floor(gx), j0 = Math.floor(gz), fx = gx - i0, fz = gz - j0;
  let wsum = 0, t0 = 0, t1 = 0, dx = 0, dz = 0, rt = 0, beta = 0, fade = 0;
  for (let c = 0; c < 4; c++) {
    const i = i0 + (c & 1), j = j0 + (c >> 1);
    const wgt = ((c & 1) ? fx : 1 - fx) * ((c >> 1) ? fz : 1 - fz);
    if (i < 0 || j < 0 || i >= H.tilesX * T || j >= H.tilesZ * T || wgt <= 0) continue;
    const slot = S.index[(j >> 4) * H.tilesX + (i >> 4)]; if (!slot) continue;
    const o = (slot - 1) * TILE_TEXELS + (j & 15) * T + (i & 15);
    const a = S.angle[o] / 256 * 2 * Math.PI;
    t0 += wgt * (S.tau0[o] * H.tauStep - H.tauOff); t1 += wgt * (S.tau1[o] * H.tauStep - H.tauOff);
    dx += wgt * Math.cos(a); dz += wgt * Math.sin(a);
    rt += wgt * (0.3 + S.rt[o] / Q6 * 2.2); beta += wgt * S.beta[o] / Q6 * 0.5; fade += wgt * S.fade[o] / 255;
    wsum += wgt;
  }
  if (wsum < 1e-3) return null;
  const dl = Math.hypot(dx, dz) || 1;
  return { tau0: t0 / wsum, tau1: t1 / wsum, dx: dx / dl, dz: dz / dl, rt: rt / wsum, beta: beta / wsum, fade: fade / wsum * Math.min(1, wsum * 1.0001) };
}
