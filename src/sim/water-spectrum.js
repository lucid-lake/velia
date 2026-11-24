// The lake's wave model, CPU side: no three.js. src/water.js builds its shader from these numbers, and the tests
// check them. Units: metres, seconds, m/s. World frame: x east, z south. Wind direction is where it blows FROM,
// compass degrees (0 = north, 90 = east), the way a sailor says it.
//
// The surface is a sum of 64 directional waves: 16 wavelengths of 0.5–20 m (the vertex shader moves the mesh) and
// 16 of 2–50 cm (ripples), each wavelength as TWO waves, one either side of downwind, with half the energy each
// (one direction per wavelength made a visible lattice at 12 m/s). The fragment shader takes the slope of all 64.
// Band energy follows a JONSWAP shape (Hasselmann et al. 1973: the Pierson–Moskowitz f⁻⁵ form times the peak
// enhancement γ^r, γ = 3.3, σ = 0.07 below the peak and 0.09 above) whose peak and height come from
// wind speed AND fetch (the distance to the upwind shore), using the fetch-limited JONSWAP growth laws, capped at
// the fully developed sea:
//   peak frequency  g·fp/U = 3.5·(g·F/U²)^−0.33        (never below the fully developed 0.877·g/(2π·U))
//   wave height     g·Hs/U² = 0.0016·(g·F/U²)^0.5      (never above the fully developed 0.21·U²/g)
// So a short fetch (near the upwind shore) gives low, short chop; a long fetch gives longer, higher waves.
// Ripples (the cat's paws) scale with the LOCAL wind from the wind field: under ~1 m/s the surface goes glassy.

export const G = 9.81;
const TENSION = 7.3e-5;   // surface tension / density of water, m³/s²: capillary ripples run faster than gravity waves

const GEOMETRY_BANDS = 16, RIPPLE_BANDS = 16;   // wavelengths; each is two waves
const LAMBDA_GEO = [0.5, 20], LAMBDA_RIP = [0.02, 0.5];

// deterministic, seedable: a small integer hash to [0, 1)
function hash01(i, seed) {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// log-spaced wavelengths, each jittered by up to ±30 % of a step so no two bands are harmonics (no visible tiling)
function logSpaced(n, [a, b], seed, i0) {
  const step = Math.log(b / a) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const j = i === 0 || i === n - 1 ? 0 : (hash01(i0 + i + 211, seed) - 0.5) * 0.6;
    return a * Math.exp((i + j) * step);
  });
}

// angular frequency of a deep-water wave of wavenumber k, with surface tension (matters under ~5 cm)
export function omega(k) { return Math.sqrt(G * k + TENSION * k * k * k); }

// The 64 waves: wavelength, wavenumber, angular frequency, a direction offset from downwind, a phase, and the
// slice of log-frequency it stands for. Long waves run close to the wind (±20°), short ripples spread wider (±70°),
// as in real wind seas; the two waves of a wavelength sit on opposite sides of downwind, each at a hashed angle.
export function bands(seed = 1) {
  const make = (lambdas, kind, i0) => lambdas.flatMap((lambda, i) => {
    const k = 2 * Math.PI / lambda, w = omega(k);
    const t = (Math.log(lambda) - Math.log(0.02)) / (Math.log(20) - Math.log(0.02));   // 0 = shortest, 1 = longest
    const spreadRad = (70 - 50 * t) * Math.PI / 180;
    return [0, 1].map((side) => ({
      kind, lambda, k, omega: w, f: w / (2 * Math.PI),
      offsetRad: (side ? -1 : 1) * (0.15 + 0.85 * hash01(i0 + 2 * i + side, seed)) * spreadRad,
      phase: hash01(i0 + 2 * i + side + 101, seed) * 2 * Math.PI,
      dlnf: 0,   // filled below
    }));
  });
  const all = [...make(logSpaced(GEOMETRY_BANDS, LAMBDA_GEO, seed, 0), 'geometry', 0),
               ...make(logSpaced(RIPPLE_BANDS, LAMBDA_RIP, seed, 50), 'ripple', 50)];
  // each wavelength stands for a slice of frequency, half the log gap to its neighbours (the two sets abut at
  // 0.5 m); its two waves share the slice
  const lnf = [...new Set(all.map((b) => Math.log(b.f)))].sort((a, b) => a - b);
  const slice = new Map(lnf.map((x, j) => {
    const lo = j > 0 ? lnf[j - 1] : x - (lnf[1] - x), hi = j < lnf.length - 1 ? lnf[j + 1] : x + (x - lnf[j - 1]);
    return [x, (hi - lo) / 2];
  }));
  for (const b of all) b.dlnf = slice.get(Math.log(b.f)) / 2;
  return all;
}

export function peakFrequency(U, F) {
  U = Math.max(U, 0.1); F = Math.max(F, 1);
  const fetchLimited = 3.5 * (G / U) * Math.pow(G * F / (U * U), -0.33);
  const developed = 0.877 * G / (2 * Math.PI * U);
  return Math.max(fetchLimited, developed);
}

export function significantHeight(U, F) {
  U = Math.max(U, 0.1); F = Math.max(F, 1);
  return Math.min(0.0016 * U * Math.sqrt(F / G), 0.21 * U * U / G);
}

// JONSWAP weight of one band at peak fp: S(f)·Δf with S ∝ f⁻⁵·exp(−1.25·(fp/f)⁴)·γ^r, Δf = f·Δln f, and
// r = exp(−(f/fp − 1)² / (2σ²)). γ = 3.3 puts ≈ 3× the PM energy at the peak band, so the dominant wavelength forms
// crests the eye can follow instead of 32 equal wavelets. Hs is still set by the growth law (amplitudes normalise).
export const JONSWAP_GAMMA = 3.3, JONSWAP_SIGMA = [0.07, 0.09];
export function peakEnhancement(f, fp) {
  const x = f / fp - 1, sigma = x < 0 ? JONSWAP_SIGMA[0] : JONSWAP_SIGMA[1];
  return Math.pow(JONSWAP_GAMMA, Math.exp(-x * x / (2 * sigma * sigma)));
}
// The peak is narrower (σ·fp) than a band's slice (f ratio 1.13), so a band point-sampling γ^r would catch the peak
// or miss it as the wind moves fp between bands (the slope then wandered ±12 % with U). Each band takes the mean of
// γ^r at three points across its slice (2·dlnf wide: the slice is shared by the band's two waves).
export function peakEnhancementBand(b, fp) {
  let g = 0;
  for (const q of [-1, 0, 1]) g += peakEnhancement(b.f * Math.exp(q * b.dlnf * 2 / 3), fp);
  return g / 3;
}
export function bandWeight(b, fp) {
  return Math.pow(b.f, -4) * Math.exp(-1.25 * Math.pow(fp / b.f, 4)) * b.dlnf * peakEnhancementBand(b, fp);
}
// The shader reads the band-averaged enhancement from a table (one texture fetch per band instead of six exp):
// rows = the geometry bands in order, columns = ln fp from fpMin to fpMax (linear in the column), row-major.
// Outside the range the factor is 1 to within 1e-3 (every band then sits far from the peak), so the lookup clamps.
// The table's linear interpolation over a 1.7 % step in fp is within 2 % of the exact factor.
export const GAMMA_LUT = { size: 256, fpMin: 0.05, fpMax: 4 };
export function peakEnhancementLUT(B, { size, fpMin, fpMax } = GAMMA_LUT) {
  const geo = B.filter((b) => b.kind === 'geometry'), out = new Float32Array(size * geo.length);
  geo.forEach((b, row) => {
    for (let i = 0; i < size; i++) out[row * size + i] = peakEnhancementBand(b, fpMin * Math.pow(fpMax / fpMin, i / (size - 1)));
  });
  return out;
}

// Gerstner steepness: Σ k·a·Q over the geometry bands is held at STEEP_MAX (loops never close at 1; past ≈ 0.8 the
// crests turn to spikes). The same cap in the vertex shader and makeSurface.
export const STEEP_MAX = 0.6;

// Whitecaps: a crest breaks where the Gerstner displacement folds, i.e. where the Jacobian of
// the rest→world map drops under J0 (the quantile of this spectrum's J at Monahan's coverage for the LOCAL wind:
// J0 = 0.677 + 0.1228·log10 U, from the J quantiles at 2 km fetch; the J distribution barely depends on the wind,
// since the steepness cap normalises it); the foam it leaves persists WHITECAP.persistS behind the crest.
// Only with wind to break them: none under onset[0] m/s of LOCAL wind, full from onset[1] (Beaufort 3–4: "crests
// begin to break" at 7–10 kn, "fairly frequent white horses" at 11–16 kn; NWS Beaufort table). Coverage follows
// Monahan & O'Muircheartaigh 1980, W = 3.84e-6·U10^3.41 (≈ 0.4 % at 15 kn, 1.1 % at 20 kn), used as the calibration
// target for the Jacobian threshold (tests/water.test.mjs), not as a formula in the shader.
// persistS: the foam a crest left behind, as a second Jacobian persistS earlier. 0.7 s reads well but costs ≈ 2 ms
// (three more sums through the 16-band loop push the fragment over a register cliff; bench 2026-10-29), so it ships
// off (0); the shared look-map pass is where persistence belongs, as a feedback blur.
export const WHITECAP = { j0: [0.677, 0.1228], width: 0.06, persistS: 0, onset: [4.0, 8.0] };   // J0 = j0[0] + j0[1]·log10(U)
export function whitecapCoverage(U10) { return 3.84e-6 * Math.pow(Math.max(U10, 0), 3.41); }

// Tail gain: the f⁻⁵ tail cut at 2 cm over-reads the short-wave slope. A gain on the tail brings the mean-square
// slope of the whole surface to Cox & Munk's clean-sea fit (σ² = 0.003 + 0.00512·U) over 2 km of fetch. With the
// JONSWAP shape (2026-10-29; the PM fit was 0.292 + 0.1486·ln U) the gain that fits (64 waves) is 0.76 at 3 m/s,
// 0.86 at 6, 0.82 at 9 and 0.95 at 12: g = 0.6704 + 0.0934·ln U fits 3–12 m/s within 7.2 % (the test holds the slope
// within 10 %). It ramps in from 2× to 4× the peak frequency, so it never shrinks the peak and the wave height
// stays the growth law's. Below RIPPLE_ONSET the ripples fade out (glassy water).
export const TAIL_GAIN = [0.6704, 0.0934];   // g = a + b·ln U
export function tailGain(f, fp, U) {
  const g = TAIL_GAIN[0] + TAIL_GAIN[1] * Math.log(Math.max(U, 0.1));
  return 1 + (g - 1) * Math.min(1, Math.max(0, (f / fp - 2) / 2));
}
export const RIPPLE_ONSET = [0.8, 3.0];   // m/s: no ripples below the first, full above the second

// How fast a band answers a gust: ripples and short chop (≤ 30 cm) follow the local wind within seconds; waves of
// 3 m and longer are the sea the whole fetch built, and ignore a passing gust. Log-linear in between.
const GUST_RESPONSE = [0.3, 3.0];   // m
export function gustResponse(lambda) {
  const t = (Math.log(lambda) - Math.log(GUST_RESPONSE[1])) / (Math.log(GUST_RESPONSE[0]) - Math.log(GUST_RESPONSE[1]));
  return Math.min(1, Math.max(0, t));
}

export function rippleFactor(localU, meanU) {
  const s = Math.min(1, Math.max(0, (localU - RIPPLE_ONSET[0]) / (RIPPLE_ONSET[1] - RIPPLE_ONSET[0])));
  const smooth = s * s * (3 - 2 * s);
  return smooth * Math.pow(Math.max(localU, 0) / Math.max(meanU, 0.1), 1.5);
}

// Gust legibility (D1): how strongly a point reads as a gust patch, 0..1, from the local wind over the wind around it
// (aroundU: water.js box-averages the speed over ≈ 800 m; the wind field's own numbers, so a patch you see is a patch
// that gives you more speed than the water around it). The edge: a soft but definite step from
// +3 % to +18 % over the mean (the gust field is smooth over ≈ 40 m; the step turns that into a line ≈ 15–25 m wide),
// then a slower rise to full at +60 %, so a harder gust reads darker. Needs real ripples: none below 0.6 m/s (the
// capillary onset), full from 1.4 m/s, so a dusk cat's paw (≈ 1.5 m/s on 0.8 m/s glass) still shows.
// The water shader mirrors this (water.js gustW); the shading it drives: GUST_LOOK.
export const GUST_EDGE = [1.03, 1.18], GUST_FULL = 1.6, GUST_ONSET = [0.6, 1.4];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function gustVisual(localU, aroundU) {
  const r = localU / Math.max(aroundU, 0.3);
  const step = sstep(GUST_EDGE[0], GUST_EDGE[1], r), more = Math.min(1, Math.max(0, (r - GUST_EDGE[1]) / (GUST_FULL - GUST_EDGE[1])));
  return (0.7 * step + 0.3 * more) * sstep(GUST_ONSET[0], GUST_ONSET[1], localU);
}
// what a full gust patch does to the water: fine ripples' mean-square slope (Cox–Munk's capillary part at ≈ 4 m/s),
// a smaller Fresnel weight (less sky in the mirror), a darker, bluer body
export const GUST_LOOK = { slope2: 0.04, fres: 0.8, body: [0.42, 0.55, 0.8] };

// Amplitude of every band (m) at mean wind U, fetch F and local wind localU (the gust; defaults to U).
export function amplitudes(U, F, localU = U, seed = 1, B = bands(seed)) {
  const fp = peakFrequency(U, F), hs = significantHeight(U, F);
  const w = B.map((b) => bandWeight(b, fp));
  const sum = w.reduce((a, x) => a + x, 0);
  const scale = (hs / 4) * Math.sqrt(2 / sum);   // Σ a²/2 = (Hs/4)²
  const rf = rippleFactor(localU, U);
  return B.map((b, i) => {
    const gust = 1 + (rf - 1) * gustResponse(b.lambda);   // mix(1, rf, response)
    return scale * Math.sqrt(w[i]) * gust * tailGain(b.f, fp, U);
  });
}

// Mean-square slope of the surface (both axes), Σ (a·k)²/2: what roughness and glints are built from.
export function slopeVariance(U, F, localU = U, seed = 1) {
  const B = bands(seed), a = amplitudes(U, F, localU, seed, B);
  return B.reduce((s, b, i) => s + (a[i] * b.k) ** 2 / 2, 0);
}

export function coxMunk(U) { return 0.003 + 0.00512 * U; }

// downwind unit vector (x, z) for a FROM direction in compass degrees
export function downwind(dirDeg) {
  const r = dirDeg * Math.PI / 180;
  return [-Math.sin(r), Math.cos(r)];
}

// Fetch: the distance (m) from (x, z) back upwind to an elliptical shore {cx, cz, rx, rz}; 0 outside the lake.
// The same maths runs per vertex in the shader. T4's real shoreline replaces the ellipse later.
export function fetchEllipse(x, z, dirDeg, shore) {
  const [dx, dz] = downwind(dirDeg);
  const qx = (x - shore.cx) / shore.rx, qz = (z - shore.cz) / shore.rz;
  const ux = -dx / shore.rx, uz = -dz / shore.rz;   // upwind, in the unit-circle frame
  const a = ux * ux + uz * uz, b = 2 * (qx * ux + qz * uz), c = qx * qx + qz * qz - 1;
  if (c > 0) return 0;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

// --- Shore maps: the water reads the real shoreline (T4's shoreDistance, negative on the lake) through two textures.
// Layout as the wind texture: row-major, rows from north (−z) to south, texel centres, centred on (cx, cz).

// signed distance to the shore (m), clamped to ±clampM: discard (> 0), foam and the wet line read it
// rows: [j0, j1) of the map only (default all), as a (j1 − j0) × size array (src/prebake.js bakes bands in workers)
export function shoreDistanceMap(shoreDistance, { size, extent, cx = 0, cz = 0, clampM = 60, rows = null }) {
  const [ja, jb] = rows ?? [0, size];
  const out = new Float32Array((jb - ja) * size), cell = extent / size;
  for (let j = ja; j < jb; j++) {
    const z = cz - extent / 2 + (j + 0.5) * cell;
    for (let i = 0; i < size; i++) {
      const d = shoreDistance(cx - extent / 2 + (i + 0.5) * cell, z);
      out[(j - ja) * size + i] = Math.max(-clampM, Math.min(clampM, d));
    }
  }
  return out;
}

// fetch (m) for one wind direction: from each lake texel, sphere-trace back upwind until the shore (|d| < 1 m);
// 0 on land, capped at maxM. shoreDistance only has to be a distance bound, not exact, for the trace to be safe.
export function fetchTrace(shoreDistance, x, z, dirDeg, maxM = 20000) {
  if (shoreDistance(x, z) >= 0) return 0;
  const [dx, dz] = downwind(dirDeg);
  let s = 0;
  for (let n = 0; n < 400 && s < maxM; n++) {
    const d = shoreDistance(x - dx * s, z - dz * s);
    if (d > -1) return s;
    s += Math.max(-d, 1);
  }
  return Math.min(s, maxM);
}

export function fetchMap(shoreDistance, dirDeg, { size, extent, cx = 0, cz = 0, maxM = 20000 }) {
  const out = new Float32Array(size * size), cell = extent / size;
  for (let j = 0; j < size; j++) {
    const z = cz - extent / 2 + (j + 0.5) * cell;
    for (let i = 0; i < size; i++) out[j * size + i] = fetchTrace(shoreDistance, cx - extent / 2 + (i + 0.5) * cell, z, dirDeg, maxM);
  }
  return out;
}

// an elliptical shore as a distance bound (exact on the axes), for demos and tests without T4's terrain
export function ellipseShore({ cx, cz, rx, rz }) {
  const r = Math.min(rx, rz);
  return (x, z) => (Math.hypot((x - cx) / rx, (z - cz) / rz) - 1) * r;
}

// --- The surface on the CPU (M10: the boat floats on it). The same 32 geometry waves the vertex shader draws, with
// the same per-point spectrum (fetch → peak, height; tail gain) and the same Gerstner steepness, so the hull rides
// what the camera sees. heightAt(x, z, t) inverts the horizontal Gerstner shift (a few fixed-point steps), since a
// world point shows the wave whose rest position was displaced onto it.
//   const surf = makeSurface({ seed, dirDeg, U, fetchAt })   fetchAt(x, z) → m (e.g. from fetchMap / fetchTrace)
//   surf.heightAt(x, z, t, { filterM, depthM })   filterM: a low-pass (m): each wave scaled by λ² / (λ² + filterM²);
//                                          depthM: the Smith effect, each wave scaled by e^(−k·depthM) (the pressure a
//                                          hull of that draft feels; src/boat/float.js)
//   surf.jacobianAt(x, z, t)              the Jacobian of the rest→world Gerstner map at the rest point under (x, z):
//                                          1 on flat water, smaller at a crest, < WHITECAP.jacobian where it breaks
export function makeSurface({ seed = 1, dirDeg = 315, U = 6, fetchAt = () => 2000 } = {}) {
  const B = bands(seed);
  const geo = B.filter((b) => b.kind === 'geometry');
  const [dx, dz] = downwind(dirDeg), base = Math.atan2(dz, dx);
  const dirs = geo.map((b) => [Math.cos(base + b.offsetRad), Math.sin(base + b.offsetRad)]);

  // per-point amplitudes, exactly as the vertex shader: all 64 weights normalise, geometry bands get the tail gain
  function amps(F) {
    const fp = peakFrequency(U, F), hs = significantHeight(U, F);
    let sum = 0;
    for (const b of B) sum += bandWeight(b, fp);
    const scale = (hs / 4) * Math.sqrt(2 / sum);
    return geo.map((b) => scale * Math.sqrt(bandWeight(b, fp)) * tailGain(b.f, fp, U));
  }

  function displaced(px, pz, t, a, filterM, depthM) {
    let ka = 0;
    for (let i = 0; i < geo.length; i++) ka += a[i] * geo[i].k;
    const steep = Math.min(STEEP_MAX / Math.max(ka, 1e-4), 1);
    let x = 0, z = 0, h = 0;
    for (let i = 0; i < geo.length; i++) {
      const b = geo[i], [ux, uz] = dirs[i];
      let r = filterM ? (b.lambda * b.lambda) / (b.lambda * b.lambda + filterM * filterM) : 1;
      if (depthM) r *= Math.exp(-b.k * depthM);
      const th = b.k * (ux * px + uz * pz) - b.omega * t + b.phase;
      const c = Math.cos(th);
      x += steep * a[i] * ux * c * r; z += steep * a[i] * uz * c * r; h += a[i] * Math.sin(th) * r;
    }
    return [x, z, h];
  }

  // the rest point whose displaced image is the world point (x, z): a few fixed-point steps
  function restOf(x, z, t, a, filterM, depthM, iterations) {
    let px = x, pz = z, h = 0;
    for (let n = 0; n < iterations; n++) {
      const [ox, oz, oh] = displaced(px, pz, t, a, filterM, depthM);
      px = x - ox; pz = z - oz; h = oh;
    }
    return [px, pz, h];
  }

  function heightAt(x, z, t, { filterM = 0, depthM = 0, iterations = 4 } = {}) {
    return restOf(x, z, t, amps(Math.max(fetchAt(x, z), 1)), filterM, depthM, iterations)[2];
  }

  // J = (1 + ∂X/∂x)(1 + ∂Z/∂z) − (∂X/∂z)(∂Z/∂x) of the Gerstner map at the rest point (px, pz); the shader computes
  // the same sum per pixel (water.js whitecaps)
  function jacobianRest(px, pz, t, a) {
    let ka = 0;
    for (let i = 0; i < geo.length; i++) ka += a[i] * geo[i].k;
    const steep = Math.min(STEEP_MAX / Math.max(ka, 1e-4), 1);
    let xx = 0, zz = 0, xz = 0;
    for (let i = 0; i < geo.length; i++) {
      const b = geo[i], [ux, uz] = dirs[i];
      const s = steep * a[i] * b.k * Math.sin(b.k * (ux * px + uz * pz) - b.omega * t + b.phase);
      xx -= s * ux * ux; zz -= s * uz * uz; xz -= s * ux * uz;
    }
    return (1 + xx) * (1 + zz) - xz * xz;
  }
  function jacobianAt(x, z, t, { iterations = 4 } = {}) {
    const a = amps(Math.max(fetchAt(x, z), 1));
    const [px, pz] = restOf(x, z, t, a, 0, 0, iterations);
    return jacobianRest(px, pz, t, a);
  }

  return { heightAt, jacobianAt, jacobianRest, amps, bands: geo, dirs };
}

// --- Water optics (L1: Lake Tahoe's clarity). Diffuse attenuation per colour channel (1/m), absorption plus a small
// scattering part. Green is set by the Poole–Atkins relation Kd ≈ 1.7 / Secchi depth with Tahoe's 2024 mean Secchi of
// 19 m (UC Davis TERC, 62.3 ft); red is pure water's absorption near 600 nm (≈0.30/m, Pope & Fry 1997, plus a little);
// blue is the clearest (≈0.02/m in pure water near 450 nm; 0.03 with Tahoe's fine particles). Scattering b sends a
// fraction back up: the deep-water colour is E·b/(K) per channel, which is what makes deep water blue.
export const SECCHI_M = 19;
export const WATER_K = [0.33, 1.7 / SECCHI_M, 0.032];   // r, g, b: 1/m
export const WATER_B = [0.0006, 0.0015, 0.004];        // backscatter part, 1/m (blue scatters most): deep water
// then reflects ≈6 % in blue, under 1 % in green and red, the dark cobalt of a clear, deep lake

// depth below the water level (m, ≥ 0; 0 on land), clamped to maxM, on the shore map's grid
// rows: as shoreDistanceMap
export function depthMap(heightAt, { size, extent, cx = 0, cz = 0, maxM = 60, rows = null }) {
  const [ja, jb] = rows ?? [0, size];
  const out = new Float32Array((jb - ja) * size), cell = extent / size;
  for (let j = ja; j < jb; j++) {
    const z = cz - extent / 2 + (j + 0.5) * cell;
    for (let i = 0; i < size; i++) out[(j - ja) * size + i] = Math.min(maxM, Math.max(0, -heightAt(cx - extent / 2 + (i + 0.5) * cell, z)));
  }
  return out;
}

// the light seen through water of depth d (m) over a bottom of albedo A, for a vertical view, per channel, given the
// light entering E: E·(A·T + R∞·(1 − T)) with T = exp(−2K·d) (down and back up) and R∞ = b / (2K)
export function waterColumn(d, A, E = [1, 1, 1]) {
  return [0, 1, 2].map((c) => {
    const T = Math.exp(-2 * WATER_K[c] * d), Rinf = WATER_B[c] / (2 * WATER_K[c]);
    return E[c] * (A[c] * T + Rinf * (1 - T));
  });
}
