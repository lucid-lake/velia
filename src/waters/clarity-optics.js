// Tahoe's clear water, the plain-JS half (no three.js): the optics the clarity shader (src/waters/clarity.js) uses, the
// boat's shadow outline projected onto the water plane each frame, and the numbers the notes quote. Node tests:
// tests/clarity.test.mjs.
//
// Clarity source: UC Davis Tahoe Environmental Research Center, "Tahoe: State of the Lake Report 2026" (2025 data):
// the annual mean Secchi depth was 69.2 ft (21.1 m) in 2025, 62.3 ft (19.0 m) in 2024; 97.4 ft (29.7 m) in 1967–71.
// https://tahoe.ucdavis.edu/stateofthelake ; reported 2026-06-09, read 2026-11-05. The water's attenuation stays at
// water-spectrum.js WATER_K (Secchi 19 m): the 2025 gain is not significant (TERC) and the summer is the least clear
// season, which is when Velia is set (the highlight day 2026-07-04; the normal day 2026-06-15). The deep-water colour
// is unchanged.
import { WATER_K, WATER_B } from '../sim/water-spectrum.js';
import { clamp } from '../sim/core/math.js';

export const N_WATER = 1.333;
// the sun's direct share of the light on a level bed, clear sky, sun well up (diffuse sky ≈ 1/4 at midday)
export const DIRECT_SHARE = 0.75;
export const SECCHI_2025_M = 21.1, SECCHI_2024_M = 19.0, SECCHI_1968_M = 29.7;

// the lake bed's look (linear albedo): pale decomposed-granite sand, rounded granite boulders, a brown-green film
// (periphyton) on the rocks' tops in the shallows
export const BED = {
  sand: [0.62, 0.58, 0.49],
  mean: [0.62, 0.58, 0.48],   // the bed past its detail (the L1 sand): the far shallows keep their approved colour
  // Tahoe's boulders: pale weathered granite tops, grey-brown granite, and about one in five lichen-dark
  granite: [0.86, 0.81, 0.70], graniteDark: [0.50, 0.47, 0.42], lichen: [0.12, 0.12, 0.10], film: [0.40, 0.37, 0.24],
  // boulders: a jittered grid, one candidate a cell. cell (m), radius range (m), height / radius (rounded, half buried),
  // the share of cells with one where the bed is full of them, the depths they thin out over (round 2: bigger, more,
  // through 1–8 m: the famous look is the boulders, the first thing a player sees looking down)
  boulders: { cell: 6.5, rMin: 0.9, rMax: 2.6, flat: 0.78, density: 0.8, even: true, depthFull: 7, depthNone: 13 },
  cobbles: { cell: 1.7, rMin: 0.12, rMax: 0.45, flat: 0.55, depthFull: 1.5, depthNone: 6 },
  // wave ripples on the sand (fix/bed-zebra, owner 2026-11-06: one 0.6 m sine at a fixed angle, tilting the sunlit slope
  // ±0.22, read as a "zebra" by the beaches). Real lake ripples: small (two sets, 0.12 and 0.18 m crests), low contrast,
  // bent and branching (a domain warp of `warp` m at `warpScale` per m swings the crests ±40° and squeezes the spacing),
  // in patches, only in the wave-washed shallows (full to depthFull, gone by depthNone).
  // tilt: the slope a ripple gives the sunlit sand; albedo: the troughs' darker grains (both ± about their mean)
  ripples: { lambda: [0.12, 0.18], turn: 0.62, warp: 0.32, warpScale: 0.9, depthFull: 1.0, depthNone: 3.0, tilt: 0.04, albedo: 0.012 },
};

// How much of a ripple of wavelength `lambda` (m) a pixel shows when its footprint on the bed is `footprint` (m: the
// larger of the bed point's screen derivatives, plus a rough surface's blur): all of it under 0.2 λ, none past 0.45 λ
// (Nyquist is 0.5 λ), so it fades to its mean before it can alias into stripes or moiré at a distance or a grazing view.
export function rippleAA(footprint, lambda) {
  const t = clamp((footprint - 0.2 * lambda) / (0.25 * lambda), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
// the ripples' strength with depth (m): full in the wave-washed shallows, none past depthNone (smoothstep, as the shader)
export function rippleDepth(d, R = BED.ripples) {
  const t = clamp((d - R.depthFull) / (R.depthNone - R.depthFull), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}
// the brightest-to-darkest step the ripples can put on sunlit sand, as a fraction of its mean (the sun low and square to
// the crests: the worst case), before the depth and anti-alias fades. The two sets blend (one leads in each place), so
// their amplitudes never add.
export function rippleContrast({ sunElevDeg = 15, R = BED.ripples } = {}) {
  const u = sunUnder([Math.cos(sunElevDeg * Math.PI / 180), Math.sin(sunElevDeg * Math.PI / 180), 0]);
  const dirSwing = (R.tilt * u[0]) / u[1];   // the Lambert term's swing about level, over the level value
  return 2 * (DIRECT_SHARE * dirSwing + R.albedo);
}

// the boat's shadow casters (m, boat frame: f forward of the hull's centre, s to starboard, h above the water). A
// Catalina 28: LOA 8.5 m, beam 2.9 m, the mast ≈ 3.3 m aft of the stem, a 3.6 m boom, an 11.5 m hoist; sailcloth lets
// some light through (the shadow of a sail is 0.55 as dark as the hull's)
export const HULL = { halfL: 4.15, halfB: 1.42, aftC: -0.15, freeboard: 0.85 };
export const RIG = { mastF: 0.95, mastTopH: 11.5, boomH: 1.8, boomL: 3.6, tackF: 4.05, tackH: 1.0, jibHeadH: 10.6, jibFootL: 3.9, clewH: 1.25 };
export const SAIL_SHADE = 0.55;


// the refracted sun's direction under water: [x, y (down, > 0), z], from the world sun (unit, y up)
export function sunUnder(sun) {
  const hx = sun[0] / N_WATER, hz = sun[2] / N_WATER;
  return [hx, Math.sqrt(Math.max(1 - hx * hx - hz * hz, 1e-4)), hz];
}
// the view ray's cosine under water (from the vertical), for a ray at elevation `elevDeg` above the horizon in air
export function viewUnderCos(elevDeg) {
  const sinI = Math.cos(elevDeg * Math.PI / 180) / N_WATER;
  return Math.sqrt(1 - sinI * sinI);
}

// the light path through water to a bed `d` m down and back to the eye (m): down along the sun, up along the view
export const pathLength = (d, viewCos, sunCos) => d / Math.max(viewCos, 0.05) + d / Math.max(sunCos, 0.1);
export const transmission = (path, K = WATER_K) => K.map((k) => Math.exp(-k * path));

// what the eye sees from under the surface: E·(A·T + R∞·(1 − T)), per channel (the shader's water body)
export function bodyRadiance(d, A, { viewCos = 1, sunCos = 1, E = [1, 1, 1], K = WATER_K, B = WATER_B } = {}) {
  const T = transmission(pathLength(d, viewCos, sunCos), K);
  return [0, 1, 2].map((c) => E[c] * (A[c] * T[c] + B[c] / (2 * K[c]) * (1 - T[c])));
}

// The bed's image (its detail: rocks, caustics, the boat's shadow) dims with the path up to the eye as exp(−b·d / cos),
// b the scattering that blurs it away (the mean light still comes through as T). Set so a boulder's 2 % step reads to
// ≈ 20 m from the chase camera's 30° and ≈ 25 m straight down: about Tahoe's 2025 Secchi depth (21.1 m), the depth a
// white disk is lost at (tests/clarity.test.mjs).
export const IMAGE_SCATTER = 0.1;   // 1/m

// the caustic net's mean: the share of a jitter-1 Worley net within w (cell units) of a cell edge, L = 1.13 w + 0.01
// (a Monte Carlo fit; tests/clarity.test.mjs checks it); two nets combined as (l1 + l2) / 2 + 1.5 l1 l2
export const CAUSTIC_LINE = [1.13, 0.01];
export const causticLineMean = (w) => CAUSTIC_LINE[0] * w + CAUSTIC_LINE[1];
export const causticMean = (w) => { const L = causticLineMean(w); return L + 1.5 * L * L; };

const LUMA = [0.2126, 0.7152, 0.0722];
const lum = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
// the bed's contrast at depth d: a dark patch of the bed's fine detail (DETAIL_DARK: grey granite) against the sand, as
// a fraction of the water's brightness there, dimmed by the scattering on the way up (IMAGE_SCATTER). o.big: a boulder
// (1–5 m across) dims at half that rate in the shader (clarity.js fadeBig), o.target its albedo
const DETAIL_DARK = [0.38, 0.35, 0.30];
export function bedContrast(d, o = {}) {
  const a = bodyRadiance(d, BED.sand, o), b = bodyRadiance(d, o.target ?? DETAIL_DARK, o);
  return (lum(a) - lum(b)) / lum(a) * Math.exp(-IMAGE_SCATTER * (o.big ? 0.5 : 1) * d / Math.max(o.viewCos ?? 1, 0.05));
}
// the deepest bed (m) whose boulders still stand out by `threshold` of the water's brightness (a 2 % step is about
// what an eye picks out on a calm, sunlit day; the Secchi disk is a white target, so it reads deeper)
export function visibleDepth({ viewElevDeg = 30, sunElevDeg = 70, threshold = 0.02, big = false, target } = {}) {
  const o = { big, target, viewCos: viewUnderCos(viewElevDeg), sunCos: sunUnder([Math.cos(sunElevDeg * Math.PI / 180), Math.sin(sunElevDeg * Math.PI / 180), 0])[1] };
  let lo = 0, hi = 200;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (bedContrast(m, o) > threshold) lo = m; else hi = m; }
  return lo;
}
// the hue the shallows turn as the bed drops away: the sand seen at depth d, normalised (no exposure)
export function shallowHue(d, o = {}) {
  const c = bodyRadiance(d, BED.sand, o), m = Math.max(...c);
  return c.map((x) => x / m);
}

// a boulder layer's radius stays inside its cell, so the shader reads one cell per layer (no neighbours)
export function boulderFits(layer) {
  return layer.rMax * 2 <= layer.cell * 0.8 && layer.rMin > 0 && layer.flat > 0 && layer.flat <= 1;
}

// The boat's shadow on the water plane, projected along the sun from the hull's sheer and the sails. The shader then
// follows the refracted sun up from each bed point to the surface and tests that point against these shapes.
//   pose: { x, z, heading (rad, clockwise from north: forward = (sin h, −cos h)), boomAngle, jibAngle (rad, + to starboard), heel }
//   sun: the world sun, unit, y up
// returns { hull: { c: [x, z], f: [fx, fz], halfL, halfB }, main: [[x, z] ×3], jib: [[x, z] ×3], on }
export function boatShadow(pose, sun, { hull = HULL, rig = RIG } = {}) {
  const on = sun[1] > 0.03;
  const kx = on ? sun[0] / sun[1] : 0, kz = on ? sun[2] / sun[1] : 0;   // a point h up lands h·k back along the sun
  const h = pose.heading ?? 0, fwd = [Math.sin(h), -Math.cos(h)], stb = [Math.cos(h), Math.sin(h)];
  // heel leans the rig: a + heel puts the starboard rail down (boat.js), so the masthead goes to starboard
  const heel = clamp(pose.heel ?? 0, -0.8, 0.8);
  const at = (f, s, y) => {
    const sl = s + y * Math.sin(heel), yy = y * Math.cos(heel);
    return [pose.x + fwd[0] * f + stb[0] * sl - kx * yy, pose.z + fwd[1] * f + stb[1] * sl - kz * yy];
  };
  const b = pose.boomAngle ?? 0, j = pose.jibAngle ?? 0;
  const main = [at(rig.mastF, 0, rig.boomH), at(rig.mastF, 0, rig.mastTopH),
    at(rig.mastF - rig.boomL * Math.cos(b), rig.boomL * Math.sin(b), rig.boomH)];
  const jib = [at(rig.tackF, 0, rig.tackH), at(rig.mastF + 0.15, 0, rig.jibHeadH),
    at(rig.tackF - rig.jibFootL * Math.cos(j), rig.jibFootL * Math.sin(j), rig.clewH)];
  const c = at(hull.aftC, 0, hull.freeboard);
  return { on, hull: { c, f: fwd, halfL: hull.halfL, halfB: hull.halfB }, main, jib };
}

// point-in-shape tests mirroring the shader (for tests): the hull's ellipse with a finer bow, a triangle
export function inHull(p, hull) {
  const dx = p[0] - hull.c[0], dz = p[1] - hull.c[1];
  const f = dx * hull.f[0] + dz * hull.f[1], s = dx * -hull.f[1] + dz * hull.f[0];
  const fn = f / hull.halfL, taper = 1 - 0.45 * Math.max(fn, 0) * Math.max(fn, 0);
  return fn * fn + (s / (hull.halfB * taper)) ** 2 < 1;
}
export function inTriangle(p, [a, b, c]) {
  const e = (u, v) => (v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]);
  const s0 = e(a, b), s1 = e(b, c), s2 = e(c, a);
  return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
}
// the surface point the refracted sun reaches going up from a bed point d m down (where the shader tests the shadow)
export function surfaceAbove(bed, d, sun) {
  const u = sunUnder(sun);
  return [bed[0] + u[0] / u[1] * d, bed[1] + u[2] / u[1] * d];
}
