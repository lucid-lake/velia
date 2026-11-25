// The ocean's initial spectrum h0(k) on the CPU, for the FFT water (v2/render/water.js). The maths is Ultra-Water's
// OceanSim.js INIT pass (Tessendorf's h0 from a JONSWAP spectrum with a cos-2s directional spread, the capillary-gravity
// dispersion, pcg2d Gaussian draws), ported from v1's own CPU port (src/waters/ultra/gpu.js buildH0), MIT:
//   Ultra-Water, copyright (c) 2026 Humpalumps, MIT License (src/waters/ultra/LICENSE; ATTRIBUTION.md). The permission
//   notice applies to this file's spectrum maths.
// Pure: the same inputs give the same bytes on every machine (no Math.random). Layout, per cascade c, texel (x, y):
//   out[((c·N + y)·N + x)·4 + 0..3] = (h0(k).re, h0(k).im, conj(h0(−k)).re, conj(h0(−k)).im), k = ((x, y) − N/2)·2π/L
//   buildH0({ lengths, cuts, A, B, seed }) → Float32Array(C·N·N·4)
//   spectrumFor({ speedMs, travelRad, fetchKm }) → { A, B, key }   the JONSWAP rows of a lake's wind sea (no swell)
export const N = 256;
const NN = N * N, G = 9.81, ST = 7.4e-5, PI = Math.PI;   // ST: surface tension / density, m³/s²: ω² = g k + ST k³

function pcg2d(x, y) {
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
  return [x, y];
}
function gauss(ix, iy, c, seed) {
  const [hx, hy] = pcg2d((ix + c * 7919 + seed) >>> 0, (iy + c * 104729 + seed) >>> 0);
  const u1 = (hx + 1) / 4294967296, u2 = hy / 4294967296, r = Math.sqrt(-2 * Math.log(u1));
  return [r * Math.cos(2 * PI * u2), r * Math.sin(2 * PI * u2)];
}
export const omega = (k) => Math.sqrt(G * k + ST * k * k * k);
// a: [scale, angle rad, spreadBlend, swell]; b: [alpha, peakOmega, gamma, shortWavesFade]
export function jonswap(w, a, b) {
  const wp = b[1], sigma = w <= wp ? 0.07 : 0.09, r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp)), iw = 1 / w, q = wp * iw;
  return a[0] * b[0] * G * G * iw ** 5 * Math.exp(-1.25 * q ** 4) * Math.pow(b[2], r);
}
function normalisation(s) {
  const s2 = s * s, s3 = s2 * s, s4 = s3 * s;
  if (s < 5) return -0.000564 * s4 + 0.00776 * s3 - 0.044 * s2 + 0.192 * s + 0.163;
  return -4.80e-08 * s4 + 1.07e-05 * s3 - 9.53e-04 * s2 + 5.90e-02 * s + 3.93e-01;
}
export function directional(theta, w, a, b) {
  const x = w / b[1];
  let s = x > 1 ? 9.77 * Math.pow(x, -2.5) : 6.97 * Math.pow(x, 5);
  s += 16 * Math.tanh(Math.min(x, 20)) * a[3] * a[3];
  const t = theta - a[1], cosine2s = normalisation(s) * Math.pow(Math.abs(Math.cos(0.5 * t)), 2 * s);
  const m = 2 / PI * Math.cos(t) * Math.cos(t);
  return m + (cosine2s - m) * a[2];
}
export function jonswapParams(windSpeed, fetchKm) {
  const fetch = fetchKm * 1000;
  return { alpha: 0.076 * Math.pow((G * fetch) / (windSpeed * windSpeed), -0.22), peakOmega: 22 * Math.pow((windSpeed * fetch) / (G * G), -0.33) };
}

// the cascades: v1's four tiles (600 / 85 / 12 m carry the displacement the CPU reads; 2.1 m is the gravity-capillary
// detail layer, its slopes the near water's ripple; 12 / 2.1 is not an integer so the tiles do not align); cascade c
// owns the wavenumbers [cut[c−1], cut[c]); each cut sits at 6 fundamentals of the next tile
export const LENGTHS = Object.freeze([600, 85, 12, 2.1]);
export const CUTS = Object.freeze([(2 * PI / 85) * 6, (2 * PI / 12) * 6, (2 * PI / 2.1) * 6, 1e4]);
export const CPU_CASCADES = 3;   // the cascades the readback window carries (v2/sim/surface.js)
// the short waves' fades exp(−fade² k²) (m): v1's Ultra water (src/waters/ultra/gpuBridge.js: shortWavesFade 0.012 on the
// 600 / 85 / 12 m tiles, capillaryFade 0.015 on the 2.1 m tile). #56 M1 (owner 2026-11-14: v1's short-wave fades, "a little
// more shimmer"): v2 runs v1's; M5c's harder pair (0.025 / 0.05, picked for flicker) stays as `m5c`, the A/B (?m1=0).
// 0.004 on the last tile is the bare capillary spectrum, whose mean square slope is 3 × Cox–Munk's (brushed metal)
export const FADES = Object.freeze({ v1: Object.freeze({ short: 0.012, capillary: 0.015 }), m5c: Object.freeze({ short: 0.025, capillary: 0.05 }) });
export const CAPILLARY_FADE = FADES.v1.capillary;

// kMin, kMax (rad/m): a band to keep on top of the cascades' own (v1's bay sim: its 85 m tile's fundamental to its 12 m tile's cut)
export function buildH0({ lengths = LENGTHS, cuts = CUTS, A, B, seed = 1337, lastFade = CAPILLARY_FADE, kMin = 0, kMax = Infinity }) {
  const C = lengths.length, out = new Float32Array(C * NN * 4);
  const h0 = (ix, iy, c) => {
    const L = lengths[c], dk = 2 * PI / L, kx = (ix - N / 2) * dk, kz = (iy - N / 2) * dk, kl = Math.hypot(kx, kz);
    const lo = c === 0 ? 1e-4 : cuts[c - 1], hi = cuts[c];
    if (kl < lo || kl > hi || kl < kMin || kl > kMax) return [0, 0];
    const w = omega(kl), dwdk = (G + 3 * ST * kl * kl) / (2 * w), theta = Math.atan2(kz, kx);
    let S = 0;
    for (let i = 0; i < A.length; i++) {
      if (A[i][0] <= 0) continue;
      const fade = c === C - 1 && lastFade != null ? lastFade : B[i][3];
      S += jonswap(w, A[i], B[i]) * directional(theta, w, A[i], B[i]) * Math.exp(-fade * fade * kl * kl);
    }
    const amp = Math.sqrt(2 * S * dwdk / kl * dk * dk), g = gauss(ix, iy, c, seed);
    return [g[0] * amp, g[1] * amp];
  };
  for (let c = 0; c < C; c++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    const a = h0(ix, iy, c), b = h0((N - ix) % N, (N - iy) % N, c), o = ((c * N + iy) * N + ix) * 4;
    out[o] = a[0]; out[o + 1] = a[1]; out[o + 2] = b[0]; out[o + 3] = -b[1];
  }
  return out;
}

// a lake's wind sea (v1's GPU bridge: Ultra-Water's defaults with no swell, shortWavesFade 0.012: FADES): speed ≥ 1 m/s so
// the spectrum stays defined at a glassy dawn (the gain then sets the size); fetch 1–200 km
export const SEA = Object.freeze({ fetchKm: 20, spreadBlend: 0.85, windSwell: 0.25, gamma: 3.3, shortWavesFade: FADES.v1.short, choppiness: 0.85, foamRecovery: 0.7 });
export function spectrumFor({ speedMs = 6, travelRad = 0, fetchKm = SEA.fetchKm, shortFade = SEA.shortWavesFade } = {}) {
  const sp = Math.max(1, speedMs), fk = Math.min(200, Math.max(1, fetchKm));
  const w = jonswapParams(sp, fk);
  // #21 (2026-11-14): in this evolve (water.js EVOLVE_WGSL: h0(k) e^{iωt}, the inverse FFT's e^{+ik·x}) a wave of number k
  // travels toward −k, so the spectrum is aimed against the travel, as v1's bridge does since 2026-10-30 ("the Ultra sea ran
  // upwind", src/waters/ultra/gpuBridge.js: dirDeg + 180). Aimed along it, v2's sea ran into the wind: the hull met it from
  // the wrong side and the waves' orbital push (the surface's velocityAt) carried her upwind on the crests
  const A = [[1, travelRad + Math.PI, SEA.spreadBlend, SEA.windSwell]];
  const B = [[w.alpha, w.peakOmega, SEA.gamma, shortFade]];
  return { A, B, key: `${sp.toFixed(2)}|${travelRad.toFixed(3)}|${fk.toFixed(1)}` };
}

// the significant wave height the table carries: the height field is the unnormalised inverse FFT of
// h̃(k) = h0(k) e^{iωt} + conj(h0(−k)) e^{−iωt}, so its variance is Σ_k |h̃(k)|² = Σ_k (|h0(k)|² + |h0(−k)|²) over
// independent phases: the sum of the squares of all four stored components; Hs = 4 σ
export function significantHeight(h0, lengths = LENGTHS, cascades = lengths.length) {
  let v = 0;
  for (let c = 0; c < cascades; c++) for (let i = 0; i < NN; i++) { const o = (c * NN + i) * 4; v += h0[o] * h0[o] + h0[o + 1] * h0[o + 1] + h0[o + 2] * h0[o + 2] + h0[o + 3] * h0[o + 3]; }
  return 4 * Math.sqrt(v);
}

// significantHeight(h0, LENGTHS, CPU_CASCADES) and each displacement tile's Σ h0² (element by element, render/water.js's MTF
// scale) in one pass, each sum in its own order as the two loops it replaced, so both are bit for bit theirs. tiles: out
// (CPU_CASCADES numbers). Refactor round 3, B2: the night sea re-composed every frame read the table twice
export function seaStats(h0, tiles) {
  let v = 0;
  for (let c = 0; c < CPU_CASCADES; c++) v = tileSq(h0, c * NN * 4, (c + 1) * NN * 4, v, tiles, c);
  return 4 * Math.sqrt(v);
}
// one tile's run of seaStats: v carried on from the tiles before (returned), the tile's own Σ into tiles[c]. A flat loop in its
// own function: the nested loop deoptimised on every exit from its OSR'd inner loop and ran boxed (garbage per element)
function tileSq(h0, o0, o1, v, tiles, c) {
  let t = 0;
  for (let o = o0; o < o1; o += 4) {
    const a = h0[o], b = h0[o + 1], d = h0[o + 2], f = h0[o + 3];
    v += a * a + b * b + d * d + f * f;
    t += a * a; t += b * b; t += d * d; t += f * f;
  }
  tiles[c] = t;
  return v;
}

// The sea's size: Ultra-Water's table is not calibrated in height (its raw Hs is 3.5–4 × a fetch-limited sea's), so, as
// v1's bridge did with its Hs feedback, the whole spectrum is scaled by one GPU gain toward the fetch-limited
// significant height of the SMB (Sverdrup–Munk–Bretschneider) relation, Hs = 0.0016 · U²/g · sqrt(g F / U²): a 20 km
// fetch gives 0.14 m at 2 m/s, 0.58 m at 8 m/s, 0.80 m at 11 m/s. The gain multiplies the amplitudes (h, so Dy and the
// slopes alike); the wind's own speed is what the table's shape (peak, spread) already carries.
export const targetHs = (speedMs, fetchKm = SEA.fetchKm) => { const U = Math.max(0.3, speedMs), F = Math.min(200, Math.max(1, fetchKm)) * 1000; return 0.0016 * U * U / G * Math.sqrt(G * F / (U * U)); };
export const gainFor = (h0, speedMs, fetchKm = SEA.fetchKm) => targetHs(speedMs, fetchKm) / Math.max(significantHeight(h0), 1e-6);

// ---- v1's sea (owner, 2026-11-13: "the tide is not big enough as v1"; v1 is the reference for the waves' size and motion) ----
// v1's Ultra water (src/water.js update() and mulOf, src/waters/ultra/gpuBridge.js, src/sim/waters/ultra/surface.js weights)
// runs two FFT sims on the boat's wind U (the WindField's base.speedMs at the boat):
//   the lake sim: a 25 km fetch's JONSWAP on the 600 / 85 / 12 / 2.1 m tiles, scaled (a GPU gain) to HS_GAIN 1.3 × the
//     fetch law's Hs at 25 km;
//   the bay sim: a 6 km fetch's JONSWAP on 85 and 12 m tiles (its seed + 11), scaled to 1.3 × the law's Hs at 6 km;
// and every point mixes them by its own fetch F (the distance upwind to the shore): m = the law's Hs at F (with the open
// lake's swell through the mouth on a rough day) over the law's at 25 km; beta = 1 − smoothstep(0.35, 0.8, m), the bay's
// share; SEA_FEEL (owner 2026-10-30: "people need to feel it") × 2.5 in the bay, × 1.3 on the lake; the lake's 600 m tile
// × m³, its 85 m × m^1.6 (1 − beta), its 12 m × (1 + 0.7 (1 − min(m, 1))) (1 − beta), the bay's tiles × beta sB with
// sB = 0.9 min(1.4, the law's Hs at F / the law's at 6 km); the 2.1 m tile (slopes only) × 1.
// v2 runs one FFT: its h0 table is the same sum (two independent Gaussian fields add linearly, so the sum of the two tables,
// each with its own draws, is the two sims' sum in distribution), weighted at the boat's point and drawn over the whole lake;
// the bay sim's band lands in v2's tiles by wavenumber (its 85 m tile's fundamental and up). Not ported: the per-pixel mix
// (v2's sea is the boat's sea everywhere; v1's open lake beyond the mouth builds bigger in the distance), the depth damping
// (v1's long tile dies under 14 m, its chop under 2 m), BAY_SLOPE (v1 draws the bay's slopes × 2: a shading term).
export const V1_SEA = Object.freeze({ lakeFetchKm: 25, bayFetchKm: 6, hsGain: 1.3, feelLake: 1.3, feelBay: 2.5, bayGain: 0.9, baySeed: 11,
  mouth: Object.freeze({ bx: 409, bz: -1839, ax: 0.643, az: -0.766, swell: 0.7, decayM: 450 }), fetchMaxM: 20000 });
// v1's hsAt (water.js): the fetch law's Hs, capped at the fully developed sea; U in m/s, F in m
export const hsLaw = (U, F) => { const u = Math.max(U, 0.1); return Math.min(Math.sqrt(Math.max(F, 1) / G) * u * 0.0016, u * u * 0.21 / G); };
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the point's weights (v1's mulOf + bayCpu): U the boat's wind (m/s), fetchM the point's fetch (m), x, z the point (the mouth's swell)
export function seaWeights({ U, fetchM, x = 0, z = 0 }) {
  const S = V1_SEA, M = S.mouth;
  const hsRef = hsLaw(U, S.lakeFetchKm * 1000), hsBay = hsLaw(U, S.bayFetchKm * 1000), loc = hsLaw(U, fetchM);
  const swellHs = hsRef * M.swell * Math.min(1, Math.max(0, (Math.max(U, 0.1) - 9) / 6));   // none under 9 m/s, full from 15
  const t = (x - M.bx) * M.ax + (z - M.bz) * M.az, sw = swellHs * (t < 0 ? Math.exp(-Math.hypot(x - M.bx, z - M.bz) / M.decayM) : 1);
  const m = Math.min(1.5, Math.sqrt(loc * loc + sw * sw) / Math.max(hsRef, 1e-3));
  const beta = 1 - smooth01(0.35, 0.8, m), feel = S.feelLake + (S.feelBay - S.feelLake) * beta;
  const sB = Math.min(1.4, loc / Math.max(hsBay, 1e-3)) * S.bayGain;
  return { m, beta, feel, sB, lake: [m * m * m * feel, Math.pow(m, 1.6) * (1 - beta) * feel, (1 + 0.7 * (1 - Math.min(m, 1))) * (1 - beta) * feel, 1],
    bay: beta * sB * feel, hsLake: hsRef * S.hsGain, hsBay: hsBay * S.hsGain };
}
// The sea state (2026-11-24, the owner: "make the wave bigger like that competitor repo, at least in open water; in the bay
// it should be also bigger; in their game we can feel the boat up and down clearly"). v1's sea (the row `v1`) is a lake's
// physical fetch-limited sea: at 7 m/s Hs 0.73 m, Tp 3.3 s on the open lake, 0.41 m and 2.1 s in Emerald Bay, where the
// competitor's default sea (web-ocean-3d: 11 m/s, a 40 m peak) is Hs 1.5 m, Tp 5.1 s. The row `big` (the default, ?sea=)
// keeps v1's weights by place (the fetch map, the bay's share, the shallows' calm) and changes only the two sims' tables:
//   lakeShapeKm, bayShapeKm: the fetch the spectrum's SHAPE takes (its peak: Tp ∝ F^0.33), v1's 25 and 6 km
//   lakeHs, bayHs: × each sim's Hs target (v1's 1.3 × the fetch law at 25 and 6 km)
//   swell: a long-crested swell on the lake's table, along the wind: its Hs (m) = clamp(a + b U, lo, hi), its peak's wavelength
//     peakM, JONSWAP gamma, the spread's `swell` term (1: long crests). It rides the lake sim's place weights: the open lake gets
//     all of it, a bay's lee little (the 600 m tile × m³), the shallows none (v1's swell damping under 14 m)
//   baySwell: the same on the bay's table, shorter (it must fit the bay sim's band, 85 m and under) and lower: the waves a
//     boat 7 m on the waterline rides over instead of bridging, so the bay's sea is felt, not only seen
// Numbers per place and wind: water.md § The sea state; `v2/tests/sea-state.test.mjs` holds their bounds.
export const SEA_STATES = Object.freeze({
  v1: Object.freeze({ id: 'v1', lakeShapeKm: 25, bayShapeKm: 6, lakeHs: 1, bayHs: 1, swell: null, baySwell: null }),
  big: Object.freeze({ id: 'big', lakeShapeKm: 60, bayShapeKm: 20, lakeHs: 1.4, bayHs: 1.6,
    swell: Object.freeze({ a: 0.18, b: 0.055, lo: 0.25, hi: 0.9, peakM: 40, gamma: 3.3, long: 1 }),
    baySwell: Object.freeze({ a: 0.1, b: 0.03, lo: 0.15, hi: 0.45, peakM: 30, gamma: 3.3, long: 1 }) }),
});
export const SEA_DEFAULT = 'big';
export const seaState = (id) => SEA_STATES[id] ?? SEA_STATES[SEA_DEFAULT];
export const swellHs = (U, sw) => (sw ? Math.min(sw.hi, Math.max(sw.lo, sw.a + sw.b * Math.max(U, 0))) : 0);
// a JONSWAP row's variance over ω (the 1-D integral; the directional spread integrates alike for rows of one spread blend)
function rowVar(a, b) { let v = 0; const dw = 0.004; for (let w = 0.1; w < 30; w += dw) v += jonswap(w, a, b) * dw; return v; }
// a sim's spectrum rows for a sea state: v1's wind sea at the shape fetch shapeKm, and the swell sw scaled so the two rows'
// variances stand as their Hs² (wind sea: hsW, swell: swellHs); → { A, B, hs } (hs: the rows' combined target)
export function seaRows({ speedMs, travelRad = 0, shortFade = SEA.shortWavesFade, shapeKm, sw = null, hsW }) {
  const wind = spectrumFor({ speedMs, travelRad, fetchKm: shapeKm, shortFade });
  const hsS = swellHs(speedMs, sw);
  if (!sw || hsS <= 0) return { A: wind.A, B: wind.B, hs: hsW };
  const bS = [1, Math.sqrt(G * 2 * PI / sw.peakM), sw.gamma, shortFade], aS = [1, travelRad + PI, SEA.spreadBlend, sw.long];
  aS[0] = (hsS / hsW) ** 2 * rowVar(wind.A[0], wind.B[0]) / rowVar(aS, bS);
  return { A: [...wind.A, aS], B: [...wind.B, bS], hs: Math.hypot(hsW, hsS) };
}
// the two sims' tables for a wind (the slow part: two buildH0, ≈ 40 ms; rebuilt only when the wind's key moves), each with
// its gain to its Hs target over its displacement tiles (v1: the lake's 600 / 85 / 12 m, the bay's 85 / 12 m)
// fades: FADES.v1 (the default since #56 M1) or FADES.m5c (the A/B); sea: a SEA_STATES id (the pure default is v1's: the page
// passes ?sea=, `big` unless set)
// the tables' key: the wind's speed (0.1) and travel (0.01 rad), and the state unless v1's (render/water.js setWind matches it)
export const seaKey = (sp, travelRad, id = 'v1') => `${sp.toFixed(1)}|${travelRad.toFixed(2)}${id === 'v1' ? '' : `|${id}`}`;
export function seaTables({ speedMs, travelRad = 0, seed = 1337, fades = FADES.v1, sea = 'v1' }) {
  const S = V1_SEA, sp = Math.max(1, speedMs), lastFade = fades.capillary, st = SEA_STATES[sea] ?? SEA_STATES.v1;
  const lake = seaRows({ speedMs: sp, travelRad, shortFade: fades.short, shapeKm: st.lakeShapeKm, sw: st.swell, hsW: hsLaw(speedMs, S.lakeFetchKm * 1000) * S.hsGain * st.lakeHs });
  const bay = seaRows({ speedMs: sp, travelRad, shortFade: fades.short, shapeKm: st.bayShapeKm, sw: st.baySwell, hsW: hsLaw(speedMs, S.bayFetchKm * 1000) * S.hsGain * st.bayHs });
  const hL = buildH0({ A: lake.A, B: lake.B, seed, lastFade });
  const hB = buildH0({ A: bay.A, B: bay.B, seed: seed + S.baySeed, lastFade, kMin: 2 * PI / LENGTHS[1], kMax: CUTS[2] });
  const gL = lake.hs / Math.max(significantHeight(hL, LENGTHS, CPU_CASCADES), 1e-9);
  const gB = bay.hs / Math.max(significantHeight(hB, LENGTHS, CPU_CASCADES), 1e-9);
  return { hL, hB, gL, gB, sea: st.id, key: seaKey(sp, travelRad, st.id) };
}
// the table the FFT runs: per tile c, lake[c] gL hL + bay gB hB (the bay's band only on the displacement tiles), into out
export function composeSea(T, w, out = new Float32Array(T.hL.length)) {
  const C = LENGTHS.length;
  for (let c = 0; c < C; c++) mixTile(out, T.hL, T.hB, w.lake[c] * T.gL, c < CPU_CASCADES ? w.bay * T.gB : 0, c * NN * 4, (c + 1) * NN * 4);
  return out;
}
// one tile of composeSea (a flat loop in its own function, as tileSq: refactor-3 B2)
function mixTile(out, hL, hB, a, b, o0, o1) { for (let o = o0; o < o1; o++) out[o] = a * hL[o] + b * hB[o]; }
// each displacement tile's raw energy in the two tables (Σ of the four stored components squared, element by element),
// cached per table set: { L: [3], B: [3] } (seaField.js setRef and bayShares read it)
const energyCache = new WeakMap();
export function tileEnergies(T) {
  let e = energyCache.get(T);
  if (e) return e;
  const NN4 = T.hL.length / LENGTHS.length;   // one tile's floats
  e = { L: [0, 0, 0], B: [0, 0, 0] };
  for (let c = 0; c < CPU_CASCADES; c++) {
    let l = 0, b = 0;
    for (let i = c * NN4, end = i + NN4; i < end; i++) { l += T.hL[i] * T.hL[i]; b += T.hB[i] * T.hB[i]; }
    e.L[c] = l; e.B[c] = b;
  }
  energyCache.set(T, e);
  return e;
}
// each displacement tile's share of the bay sim's energy in the composed table (the float's per-tile filters: surface.js);
// out: 3 numbers (a new array when absent). The tables' energies are the cached tileEnergies (the same sums in the same order)
export function bayShares(T, w, out = [0, 0, 0]) {
  const E = T.hL.length === LENGTHS.length * NN * 4 ? tileEnergies(T) : null;
  for (let c = 0; c < CPU_CASCADES; c++) {
    let eL = 0, eB = 0;
    if (E) { eL = E.L[c]; eB = E.B[c]; } else for (let i = c * NN * 4, e = i + NN * 4; i < e; i++) { eL += T.hL[i] * T.hL[i]; eB += T.hB[i] * T.hB[i]; }
    const l = eL * (w.lake[c] * T.gL) ** 2, b = eB * (w.bay * T.gB) ** 2;
    out[c] = l + b > 0 ? b / (l + b) : 0;
  }
  return out;
}
// the fetch at a point (m): the distance upwind to the first land (v1's fetchTrace over its shore-distance map; here v2's own
// heights, height ≥ 0 is land, in stepM steps), capped at v1's 20 km; 0 on land. downwind: the wind's travel unit (x, z)
export function fetchAt(heightAt, x, z, downwind, { stepM = 8, maxM = V1_SEA.fetchMaxM } = {}) {
  if (heightAt(x, z) >= 0) return 0;
  const [dx, dz] = downwind;
  for (let s = stepM; s < maxM; s += stepM) {
    if (heightAt(x - dx * s, z - dz * s) < 0) continue;
    let a = s - stepM, b = s;   // the shore between the last water step and this land step: bisected to 1 cm (continuous in the point)
    while (b - a > 0.01) { const m = (a + b) / 2; if (heightAt(x - dx * m, z - dz * m) >= 0) b = m; else a = m; }
    return (a + b) / 2;
  }
  return maxM;
}
