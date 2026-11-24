// The wind-driven lake (T3, T3b). A camera-centred radial grid displaced by 32 Gerstner waves (16 wavelengths of
// 0.5–20 m, two directions each) whose heights and lengths come from wind speed and fetch, plus 32 ripple waves
// (2–50 cm) in the fragment shader that follow the LOCAL wind from the wind field texture: gusts roughen and darken
// the water and move downwind with the gust. Physics and constants: src/water-spectrum.js.
// Shading: Fresnel (Schlick, F0 = 0.02), a two-colour sky reflection with Smith masking and a rough-Fresnel average
// (rough patches hide part of the mirror at grazing angles: that is why cat's paws read dark), a Beckmann sun glint.
// Slope energy too fine for the mesh or the pixel goes into roughness, so far water turns into a glitter path.
// The shoreline is real (T3b): a signed shore-distance texture discards the water on land and draws shore foam
// within 3 m; fetch comes from a texture traced upwind over the shoreline, rebuilt when the wind direction turns.
// Reflections of the ridge (T3b): the water writes its normal, Fresnel weight and sky colour to two MRT targets;
// reflections(scenePass) traces the mirrored ray against the depth buffer and swaps the sky for what it hits.
//
//   const water = createWater({ wind, terrain, seed, sky, sun });   scene.add(water.mesh);
//   scenePass.setMRT(water.passMRT());                                // before the first render
//   const lit = water.reflections(scenePass);                         // use in place of the pass's 'output'
//   await water.captureProbe(renderer, scene, camera)                 (T3c: once the scene is built, before frame 1)
//   each frame: water.update(t, camera)                               (t in s; deterministic)
//   D2, time of day: water.setSun(dir, { light, sunIntensity }) per frame; const pu = water.probeUpdater(renderer,
//                    scene): pu.start() when the sun has moved (src/timeOfDay.js), pu.step() every frame
//   optional, after the clouds: out = water.cloudReflections(scenePass, cl(aerial, depth))   (T3c: clouds in the
//                                                                     reflection; ≈ 2.3 ms, see the function)
//   terrain material: colour × mix(1, 0.5, water.wetness(positionWorld))    (the wet line, 0–3 m inland)
// wind: T1's WindField (or src/wind-stub.js). terrain: anything with shoreDistance(x, z) (negative on the lake);
// without one, shore: {cx, cz, rx, rz} gives an elliptical lake.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, uniform, texture, varying, positionGeometry, cameraPosition, mrt, output,
  vec2, vec3, vec4, float, color, sin, cos, exp, log, sqrt, pow, max, min, clamp, mix, smoothstep, normalize, dot,
  length, length as vlen, reflect, refract, pmremTexture, mx_fractal_noise_float, mx_worley_noise_float,
  mx_noise_vec3, select, int, fract,
} from 'three/tsl';
import { getSplitScalarIlluminance } from '@takram/three-atmosphere/webgpu';
import { createWindLook, laneVisibility } from './wind-cues.js';
import { createLookMap } from './water-look.js';
import { waterFeatures } from '../../src/sim/waters/features.js';   // the feature modules' slots (the gust look, the rain, the birds' marks, the clear bed)
import {
  G, bands, TAIL_GAIN, RIPPLE_ONSET, gustResponse, downwind, shoreDistanceMap, fetchMap, ellipseShore, makeSurface,
  WATER_K, WATER_B, depthMap, GUST_EDGE, GUST_FULL, GUST_ONSET, GUST_LOOK, STEEP_MAX, WHITECAP, GAMMA_LUT, peakEnhancementLUT,
} from '../../src/sim/water-spectrum.js';
import { span } from './profile.js';
import { WIND_TEX, WIND_EXTENT, windState, fillWindTexture } from '../../src/sim/wind-texture.js';
import { take } from './prebake.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { LENGTHS as ULEN, N as UN, WARP } from '../../src/sim/waters/ultra/surface.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { radialGrid, halfTexture } from './water-grid.js';
import { windFiller, attachWindStream } from './water-stream.js';
import { ssrReflections, cloudReflections } from './water-reflect.js';
import { createProbeCapture } from './water-probe.js';

// WIND_TEX: 256 px, 16 m a texel over WIND_EXTENT (4,096 m, centred on the camera, snapped): src/wind-texture.js
const SHORE_TEX = 1024, FETCH_TEX = 128, MAP_EXTENT = 4096;   // 4 m and 32 m texels over the bay
// the open lake beyond the bay: coarse outer maps, 80 m and 320 m texels over 40.96 km round the lake's centre (all of
// Lake Tahoe: 35 × 19 km), blended into the inner maps
// across the inner map's outer 7 % (no seam at the border)
const OUTER_TEX = 512, OUTER_FETCH_TEX = 128, OUTER_EXTENT = 40960;
const BLEND = [0.86, 0.98];   // inner weight falls from 1 to 0 over this fraction of the inner half-extent
// M6, the twilight water: at low sun the deep water read black (L* 0.4 at 05:18 from cam M, on Ultra and
// classic alike), the sky L* 33. Causes, measured: the rough-Fresnel average kept about 0.19 of the mirror; the probe was
// captured inside the bay, so its low sky was the bay's walls; the cloud deck (a post pass) was in no reflection; AgX's toe
// drew what was left as black. The fix, by the sun's height (highDeg -> lowDeg): a calmer mirror (roughK, mask), the
// deck's mean in the mirror (cloudGain x cloudShare x coverage), and a probe that follows the camera (followM).
export const TWILIGHT_MIRROR = Object.freeze({ highDeg: 6, lowDeg: -1, roughK: 0.1, mask: 0.95, cloudGain: 6, cloudShare: 1, followM: 1500 });
// S5, the water's colour. Before: the deep water at noon from cam M L* 17-25, C* 15 (grey navy), the 2-6 m
// shelf a blue C* 18-23 at hue 225-257 (no turquoise). The body's light (what the bed and the backscatter send up) is tinted
// by bed depth: shelf (green-heavy: the pale granite sand through 2-6 m of clear water reads turquoise) eased into deep
// (blue-green heavy: cobalt) over shelfM..deepM. The bed's own albedo stays (sand L* 81, src/waters/clarity-optics.js BED).
// A look tint on the optics, not new optics: the reflection is untouched.
// The deep tint (owner, 2026-11-13: "make the deep water color close to v2 version"): past deepM the body is v2's navy, not
// the old cobalt (0.5, 2.6, 3.2). v2 lights its body with the physical sun and sky, so its deep water darkens toward
// sunset far more than v1's (v1's body light follows the hand-set horizon tint under a rising exposure); one tint cannot
// match both, so the deep tint is read from `deepSun` by the sun's elevation (deg; see deepTintAt). Each knot is fitted
// against v2's own captures at the same poses, near band within dE00 about 3 (2026-11-13, v1 deep water).
// The large red is a look number: the deep body's red is about 1/70 of its blue before the tint, and AgX draws a little
// red in a deep blue as near black (v2's navy leans violet); past about 40 at 18 deg the far water went purple.
// The shelf (0–shelfM) and the reflection, foam and wake are untouched.
const DEEP_SUN = Object.freeze([
  [-11, [0.5, 0.6, 3.4]],    // night (21:36, the starlit long exposure)
  [2, [0.2, 0.08, 0.05]],    // dusk (20:12): v2's body is near black; what shows is the mirror
  [12, [24, 1.4, 0.28]],     // golden hour (19:15)
  [18, [28, 1.5, 0.6]],      // the follow camera at 18:45
  [74, [22, 0.85, 1.1]],     // noon (13:00)
].map(([e, c]) => Object.freeze([e, Object.freeze(c)])));
export const WATER_LOOK = Object.freeze({ shelf: [0.62, 1.85, 1.12], deep: DEEP_SUN[DEEP_SUN.length - 1][1], deepSun: DEEP_SUN, shelfM: 6, deepM: 16 });

// the deep tint at a sun elevation (deg): WATER_LOOK.deepSun, geometric between knots (each channel eases by the same
// ratio per degree, so the hue holds between knots: a linear blend of the red-heavy 18° knot into the near-black dusk
// one went purple at golden hour), held past the ends
export function deepTintAt(elevDeg, look = WATER_LOOK) {
  const k = look?.deepSun;
  if (!k?.length) return look?.deep ?? [1, 1, 1];
  if (!(elevDeg > k[0][0])) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (elevDeg === k[i][0]) return k[i][1];
    if (elevDeg < k[i][0]) {
      const [e0, a] = k[i - 1], [e1, b] = k[i], t = (elevDeg - e0) / (e1 - e0);
      return [0, 1, 2].map((c) => a[c] * (b[c] / a[c]) ** t);
    }
  }
  return k[k.length - 1][1];
}

// the twilight mirror's weight at a sun elevation (deg): 0 over highDeg, 1 under lowDeg, smooth between
export function twilightWeight(elevDeg, m = TWILIGHT_MIRROR) {
  if (!m) return 0;
  const k = Math.min(1, Math.max(0, (m.highDeg - elevDeg) / (m.highDeg - m.lowDeg)));
  return k * k * (3 - 2 * k);
}
const NIGHT_F0 = 0.15;   // the starlit night's Fresnel floor over water's 0.02 (round 3: the near water reads with a sheen)
const FOAM_M = 3;   // shore foam band, m
const SHORE_SLOPE = 0.5;   // the shore train's slope as drawn, over its real slope (fix/bed-zebra: the full slope drew hard bands)
// the pixel footprint (m; 115–310 m off looking straight down at 720 p, nearer at a grazing view) past which the shore train and the lace are drawn as before
// fix/bed-zebra (the far shores, the overlook: the approved look); the fix applies near the camera, where the bands read
const SHORE_NEAR = [0.15, 0.4];

export function createWater({
  wind, terrain = null, shore = { cx: (terrain?.waters ?? CURRENT_WATERS).terrain.bayCentre[0], cz: (terrain?.waters ?? CURRENT_WATERS).terrain.bayCentre[1], rx: 1600, rz: 1500 },
  mapCentre = (terrain?.waters ?? CURRENT_WATERS).terrain.bayCentre, outerCentre = (terrain?.waters ?? CURRENT_WATERS).terrain.lakeCentre, seed = 1,
  sky = { horizon: 0xe6d6c6, zenith: 0x6f8296 }, deep = 0x0e1a20,   // deep: unused since L1 (the optics make it)
  sun = { dir: [0.4, 0.14, -0.9], color: [1.0, 0.82, 0.62], intensity: 6.0 }, hazeM = 9000, debug = null,
  atmosphere = null,   // T3c: an AtmosphereContext; the glint then takes the sun's transmitted light from the sky model
  sunScale = 1,        // a scale on that light (scene units: main.js works at 0.6 / exposure)
  tier: wt = {},       // the quality tier's water knobs (src/quality/tiers.js TIERS.*.water): { rippleWavelengths, probeSize, lookSize }; {} = High
  probe: probe0 = { position: [0, 40, 200], size: 256, proxyM: 1e6 },   // T3c: the reflection probe (null: the 2-colour sky);
  // 40 m up, cam A's height: lower, the valley mist (dense near the water) fogs the ridges paler than the camera sees.
  // proxyM: the parallax proxy sphere's radius; 1e6 (no parallax, a direction lookup) is what the T3c captures were
  // judged on; 4000 (the ridges' distance) is the alternative, untested in the full scene
  bed = { sand: [0.62, 0.58, 0.48], granite: [0.42, 0.41, 0.40] },   // L1: lake-bed albedos (pale granite sand, boulders)
  bodyGain = 1.0,      // L1: a scale on the light entering the water (a look knob; 1 = physical)
  wake = null,         // M10: src/boat/wake.js createWake(): the boat's foam trail and Kelvin waves on the water
  whitecaps = true,    // the Jacobian whitecaps (off: ?nocaps=1, the budget check)
  wakeCalm = 0.8,      // how much the wake's trail damps the wind ripples (the slick a boat leaves): 0 none, 1 glassy
  streakGain = 1,      // a scale on the wind lanes' darkening and roughness (tuning)
  ultraMask = 15,      // ?umask=: bitmask of the slope cascades drawn (debug)
  live = 1,            // ?live=: short-wave liveliness, a gain on the 12 m and 2.1 m cascades' slopes (1 physical)
  seaFeel = null,      // [bay, lake]: the sea-state gain (SEA_FEEL)
  ultra = null,        // ?water=ultra: src/waters/ultra/bridge.js, Ultra-Water's FFT cascades in place of the Gerstner bands
  // the feature modules (src/waters/features.js), folded into the shader's slots in this order: the gust look
  // (src/gustFx-water.js gustWater), the storm's rain (the weather bus's water()), the birds' marks (src/birds/water.js
  // birdMarks), the clear lake bed (src/waters/clarity.js clarityWater). None: the plain water
  features = [],
  colour = WATER_LOOK,  // S5: the body's tint by depth (null: the body as before, ?wcolour=old)
  mirror = TWILIGHT_MIRROR,   // M6: the twilight mirror and the probe that follows the camera (null: the old mirror, ?wmirror=0)
  windLook = createWindLook({ gain: streakGain, breakingIn: true }),   // the visible wind (src/wind-cues.js; null drops it): the lanes are drawn in the look map, the whitecaps per pixel from A's Jacobian breaking measure (15-shared.md)
} = {}) {
  const probe = probe0 && wt.probeSize ? { ...probe0, size: wt.probeSize } : probe0;
  const fs = waterFeatures(features);
  const B = bands(seed);
  const geoCount = B.filter((b) => b.kind === 'geometry').length;
  const meanWind = () => wind.base?.speedMs ?? wind.sample(0, 0, 0).speed;
  const meanDir = () => wind.base?.dirDeg ?? wind.sample(0, 0, 0).dirDeg;
  const shoreDistance = terrain?.shoreDistance ?? ellipseShore(shore);
  const [mcx, mcz] = mapCentre, [ocx, ocz] = outerCentre;
  const mapOpts = { extent: MAP_EXTENT, cx: mcx, cz: mcz };

  // --- uniforms ---------------------------------------------------------------------
  const uTime = uniform(0);
  const uU = uniform(meanWind());
  const uCam = uniform(new THREE.Vector2());
  const uWindCentre = uniform(new THREE.Vector2());
  const uWindMean = uniform(new THREE.Vector2(0, 1));   // the mean wind vector (m/s, downwind): the field past the wind texture's edge
  const uPix = uniform(2 * Math.tan(25 * Math.PI / 180) / 720);   // radians per pixel; update() sets it from the camera
  const uSun = uniform(new THREE.Vector3(...sun.dir).normalize());
  const uSunCol = uniform(new THREE.Color(...sun.color).multiplyScalar(sun.intensity));
  const uHorizon = uniform(new THREE.Color(sky.horizon)), uZenith = uniform(new THREE.Color(sky.zenith));
  // M6: the twilight mirror's weight (0 by day, 1 with the sun under mirror.lowDeg; the daylight hook) and the cloud deck's coverage
  const uTwi = uniform(0), uCloudCov = uniform(0);
  let deckCover = null;   // the deck's coverage uniform ({ value }), set by setCloudDeck once the clouds exist
  const uF0 = uniform(0.02);   // the mirror's Fresnel floor: water's 0.02, lifted on the starlit night (the daylight hook)
  const uDeep = uniform(new THREE.Vector3(...deepTintAt(90, colour)));   // the deep body's tint by the sun (the daylight hook)
  const dirs = B.map(() => uniform(new THREE.Vector2(1, 0)));
  function setDirection(dirDeg) {
    const [dx, dz] = downwind(dirDeg), base = Math.atan2(dz, dx);
    B.forEach((b, i) => dirs[i].value.set(Math.cos(base + b.offsetRad), Math.sin(base + b.offsetRad)));
  }

  // The reflection probe (T3c): the scene seen from mid-lake, once at load (captureProbe), without the water. It is
  // what the water reflects wherever the screen-space trace has nothing: misses, the screen edges, rough water. So
  // the fallback carries the real sky and the ridges' silhouette, not a plain sky colour.
  // PMREMGenerator.fromScene renders the six faces straight into the prefiltered (PMREM) layout; a CubeCamera target
  // can't be used here, as the PMREM node never treats a render target's cube as ready (it binds a placeholder).
  const uProbe = uniform(new THREE.Vector3(...(probe?.position ?? [0, 25, 200])));
  let probeNode = null;   // the probe lookup below; captureProbe sets its texture
  const probeSunNodes = [];   // other lookups of the same probe

  const windData = new Uint16Array(WIND_TEX * WIND_TEX * 2);
  const windTex = new THREE.DataTexture(windData, WIND_TEX, WIND_TEX, THREE.RGFormat, THREE.HalfFloatType);
  windTex.magFilter = windTex.minFilter = THREE.LinearFilter;
  windTex.wrapS = windTex.wrapT = THREE.ClampToEdgeWrapping;
  windTex.needsUpdate = true;
  // D1: the wind around each point (the speed box-averaged over ≈ 800 m, same grid): a patch reads as a gust against
  // the wind around it, as a sailor reads it, so a puff landing in a lull still shows as a darker patch
  const windMean = halfTexture(WIND_TEX);
  const own = { wind: windData, mean: new Uint16Array(WIND_TEX * WIND_TEX), speed: new Float32Array(WIND_TEX * WIND_TEX), meanF: new Float32Array(WIND_TEX * WIND_TEX) };
  // the worker that fills the wind texture (pages only; node tests and ?windworker=0 fill it here)
  const filler = typeof Worker !== 'undefined' && typeof location !== 'undefined' && FLAGS.windworker ? windFiller(wind.seed) : null;
  let lastT = null, hasTexture = false, applied = null;

  // shore distance once (≈ 0.2 s for T4's terrain); fetch per wind direction (≈ 15 ms), rebuilt past a 2° turn
  const endMaps = span('water:shore+depth maps');
  const shoreMap = halfTexture(SHORE_TEX), fetchTex = halfTexture(FETCH_TEX);
  // the load-time bake (src/prebake.js) has these four maps when the terrain is a makeTerrain({ seed }) one
  const baked = (kind, size, o) => (terrain?.seed != null && shoreDistance === terrain.shoreDistance
    ? take(`${kind}:${terrain.seed}:${size}:${o.extent}:${o.cx}:${o.cz}`) : undefined);
  shoreMap.set(baked('shore', SHORE_TEX, mapOpts) ?? shoreDistanceMap(shoreDistance, { size: SHORE_TEX, ...mapOpts }));
  // L1: depth below the water level on the same grid, from the terrain (or a 1:8 beach slope off the shore distance)
  const depthTex = halfTexture(SHORE_TEX);
  const heightFn = terrain?.heightAt ?? ((x, z) => Math.max(shoreDistance(x, z), -480) / 8);
  depthTex.set(baked('depth', SHORE_TEX, mapOpts) ?? depthMap(heightFn, { size: SHORE_TEX, ...mapOpts }));
  const outerOpts = { extent: OUTER_EXTENT, cx: ocx, cz: ocz };
  const shoreOuter = halfTexture(OUTER_TEX), depthOuter = halfTexture(OUTER_TEX), fetchOuter = halfTexture(OUTER_FETCH_TEX);
  shoreOuter.set(baked('shore', OUTER_TEX, outerOpts) ?? shoreDistanceMap(shoreDistance, { size: OUTER_TEX, ...outerOpts }));
  depthOuter.set(baked('depth', OUTER_TEX, outerOpts) ?? depthMap(heightFn, { size: OUTER_TEX, ...outerOpts }));
  endMaps();
  let fetchDir = null, fetchData = null, fetchOuterData = null, surface = null, surfaceKey = '';
  function setFetch(dirDeg) {
    if (fetchDir !== null && Math.abs(((dirDeg - fetchDir + 540) % 360) - 180) < 2) return;
    fetchData = fetchMap(shoreDistance, dirDeg, { size: FETCH_TEX, ...mapOpts });
    fetchTex.set(fetchData);
    fetchOuterData = fetchMap(shoreDistance, dirDeg, { size: OUTER_FETCH_TEX, ...outerOpts, maxM: 40000 });   // Tahoe: up to ≈ 35 km
    fetchOuter.set(fetchOuterData);
    fetchDir = dirDeg;
    surface = null;   // the CPU surface follows (rebuilt on next use)
  }
  // the fetch texture's values on the CPU, bilinear (as the vertex shader's linear sample)
  // bilinear on a map's data, as the shader's linear sample
  function bilinear(data, n, extent, x, z, cx = mcx, cz = mcz) {
    const fx = ((x - cx) / extent + 0.5) * n - 0.5, fz = ((z - cz) / extent + 0.5) * n - 0.5;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
    const at = (a, b) => data[b * n + a];
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  }
  const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const innerWeightAt = (x, z) => 1 - smooth01(BLEND[0], BLEND[1], 2 * Math.max(Math.abs(x - mcx), Math.abs(z - mcz)) / MAP_EXTENT);
  function fetchAt(x, z) {
    const w = innerWeightAt(x, z), outer = bilinear(fetchOuterData, OUTER_FETCH_TEX, OUTER_EXTENT, x, z, ocx, ocz);
    return w <= 0 ? outer : w * bilinear(fetchData, FETCH_TEX, MAP_EXTENT, x, z) + (1 - w) * outer;
  }
  // M10: the surface on the CPU, the same 32 geometry waves the vertex shader draws (water-spectrum.js makeSurface),
  // for the physics and the boat's float: "if you see a wave, you can sail with the wave"
  function getSurface() {
    const U = meanWind(), dir = meanDir(), key = `${U}:${dir}:${fetchDir}`;
    if (!surface || key !== surfaceKey) { surface = makeSurface({ seed, dirDeg: dir, U, fetchAt }); surfaceKey = key; }
    return surface;
  }
  // waveAt(x, z, t) → { y, nx, nz }: the height (m) and the unit normal's horizontal parts, by central differences
  // over 0.5 m; filterM (m) low-passes waves shorter than a hull (see makeSurface)
  const depthAt = (x, z) => Math.max(0, -heightFn(x, z));
  const hsCpu = (x, z) => {
    const U = Math.max(meanWind(), 0.1), hs = Math.min(Math.sqrt(Math.max(fetchAt(x, z), 1) / G) * U * 0.0016, U * U * 0.21 / G);
    const t = (x - MOUTH.bx) * MOUTH.ax + (z - MOUTH.bz) * MOUTH.az, sw = uSwellHs.value * (t < 0 ? Math.exp(-Math.hypot(x - MOUTH.bx, z - MOUTH.bz) / MOUTH.decayM) : 1);
    return Math.sqrt(hs * hs + sw * sw);   // the shader's effHs
  };
  const ultraSurface = ultra ? { heightAt: (x, z, t, o = {}) => { const b = hasB ? bayCpu(x, z) : null; return ultra.heightAt(x, z, t, { filterM: o.filterM ?? 0, depthM: o.depthM ?? 0, depth: depthAt(x, z), m: Math.min(1.5, hsCpu(x, z) / Math.max(uHsRef.value, 1e-3)), bay: b, feel: b ? b.feel : FEEL.lake }); } } : null;
  // the shader's beta and sB (mulOf), on the CPU
  const sm01 = (a, b, v) => { const q = Math.min(1, Math.max(0, (v - a) / (b - a))); return q * q * (3 - 2 * q); };
  const bayCpu = (x, z) => {
    const U = Math.max(meanWind(), 0.1), loc = Math.min(Math.sqrt(Math.max(fetchAt(x, z), 1) / G) * U * 0.0016, U * U * 0.21 / G);
    const m = Math.min(1.5, hsCpu(x, z) / Math.max(uHsRef.value, 1e-3));
    return { feel: FEEL.lake + (FEEL.bay - FEEL.lake) * (1 - sm01(0.35, 0.8, m)), beta: 1 - sm01(0.35, 0.8, m), sB: Math.min(1.4, loc / Math.max(uHsLawB.value, 1e-3)) * BAY_GAIN };
  };
  function waveAt(x, z, t, { filterM = 0 } = {}) {
    const s = ultra ? ultraSurface : getSurface(), d = 0.5, o = { filterM };
    const y = s.heightAt(x, z, t, o);
    const gx = (s.heightAt(x + d, z, t, o) - s.heightAt(x - d, z, t, o)) / (2 * d);
    const gz = (s.heightAt(x, z + d, t, o) - s.heightAt(x, z - d, t, o)) / (2 * d);
    const inv = 1 / Math.sqrt(1 + gx * gx + gz * gz);
    return { y, nx: -gx * inv, nz: -gz * inv };
  }
  setDirection(meanDir());
  setFetch(meanDir());
  const mapUV = (xz) => xz.sub(vec2(mcx, mcz)).div(MAP_EXTENT).add(0.5);
  const outerUV = (xz) => xz.sub(vec2(ocx, ocz)).div(OUTER_EXTENT).add(0.5);
  // the inner map where it covers, the outer map beyond, blended over the inner map's rim (same maths as innerWeightAt)
  const innerW = (xz) => {
    const q = xz.sub(vec2(mcx, mcz)).abs().mul(2 / MAP_EXTENT);
    return float(1).sub(smoothstep(BLEND[0], BLEND[1], max(q.x, q.y)));
  };
  const blendMap = (inner, outer, xz, lod0 = false) => {
    const a = texture(inner, mapUV(xz)), b = texture(outer, outerUV(xz));
    return mix((lod0 ? b.level(0) : b).r, (lod0 ? a.level(0) : a).r, innerW(xz));
  };

  // --- vertex: fetch → spectrum → Gerstner displacement ------------------------------
  const geoLambda = Math.max(...B.filter((b) => b.kind === 'geometry').map((b) => b.lambda));
  const spacing0 = Math.pow(30000 / 0.25, 1 / 359) - 1;   // radialGrid's default near spacing
  const { geo, spacing } = radialGrid(undefined, undefined, undefined, undefined, { flatM: 1.1 * geoLambda / (3 * spacing0) });
  const local = positionGeometry.xz;
  const p = local.add(uCam);

  const U = max(uU, 0.1);
  // one band's JONSWAP weight (water-spectrum.js bandWeight, mirrored): w = f⁻⁴·Δln f · exp(−1.25·(fp/f)⁴) · γ^r, the
  // constant part baked per band, γ^r averaged over the band's slice (peakEnhancementBand) and read from a table
  // over ln fp (peakEnhancementLUT: one fetch per band in place of six exp). The peak enhancement is evaluated for the
  // geometry bands only: the ripple bands (λ ≤ 0.5 m) sit at f ≥ 1.4·fp for any wind over 3 m/s, where γ^r = 1.
  const gammaTex = new THREE.DataTexture(new Uint16Array(GAMMA_LUT.size * geoCount), GAMMA_LUT.size, geoCount, THREE.RedFormat, THREE.HalfFloatType);
  { const f = peakEnhancementLUT(B); for (let k = 0; k < f.length; k++) gammaTex.image.data[k] = THREE.DataUtils.toHalfFloat(f[k]); }
  gammaTex.magFilter = gammaTex.minFilter = THREE.LinearFilter;
  gammaTex.wrapS = gammaTex.wrapT = THREE.ClampToEdgeWrapping;
  gammaTex.needsUpdate = true;
  const bandWeightNode = (b, fpNode, fp4Node, row) => {
    let w = exp(fp4Node.mul(-1.25 * Math.pow(b.f, -4))).mul(Math.pow(b.f, -4) * b.dlnf);
    if (b.kind === 'geometry') {
      const u = log(fpNode.div(GAMMA_LUT.fpMin)).mul(1 / Math.log(GAMMA_LUT.fpMax / GAMMA_LUT.fpMin));
      w = w.mul(texture(gammaTex, vec2(u, (row + 0.5) / geoCount)).level(0).r);
    }
    return w;
  };
  // the spectrum at a rest point: peak frequency, Hs and the amplitude scale from the fetch there. Run in the vertex
  // stage for the displacement and again per pixel for the shading (the far rings are too coarse to interpolate it)
  const spectrum = (xz) => {
    const fetch = max(blendMap(fetchTex.tex, fetchOuter.tex, xz, true), 1);
    const fpFetch = float(3.5 * G).div(U).mul(pow(fetch.mul(G).div(U.mul(U)), -0.33));
    const fp = max(fpFetch, float(0.877 * G / (2 * Math.PI)).div(U));
    const hs = min(sqrt(fetch.div(G)).mul(U).mul(0.0016), U.mul(U).mul(0.21 / G));
    const fp4 = fp.mul(fp).mul(fp).mul(fp);
    const weight = (b) => bandWeightNode(b, fp, fp4, B.indexOf(b));   // geometry bands come first in B
    let wsum = float(0);
    for (const b of B) wsum = wsum.add(weight(b));
    return { fp, hs, fp4, weight, ampScale: hs.div(4).mul(sqrt(float(2).div(wsum))) };
  };
  const { fp, fp4, weight, ampScale } = spectrum(p);
  // tail gain (tailGain in water-spectrum.js): g = a + b·ln U on bands above 2× the peak, full from 4×
  const gTail = log(U).mul(TAIL_GAIN[1]).add(TAIL_GAIN[0]);
  const tail = (b, fpNode) => float(1).add(gTail.sub(1).mul(clamp(float(b.f).div(fpNode).sub(2).div(2), 0, 1)));

  const gridStep = max(length(local).mul(spacing), 0.02);
  const geoBands = B.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'geometry');
  const amps = geoBands.map(({ b }) => ampScale.mul(sqrt(weight(b))).mul(tail(b, fp)));
  const fades = geoBands.map(({ b }) => clamp(float(b.lambda).div(gridStep).sub(3).div(3), 0, 1));   // no aliasing
  let ka = float(0);
  geoBands.forEach(({ b }, n) => { ka = ka.add(amps[n].mul(fades[n]).mul(b.k)); });
  const steep = min(float(STEEP_MAX).div(max(ka, 1e-4)), 1);   // Gerstner loops never close: Σ k·a·Q ≤ STEEP_MAX

  // the mesh carries only the displacement; the normal is per pixel (below), so waves finer than the grid still show
  let dx = float(0), dz = float(0), h = float(0);
  if (!ultra) geoBands.forEach(({ b, i }, n) => {
    const a = amps[n].mul(fades[n]), d = dirs[i];
    const th = dot(d, p).mul(b.k).sub(uTime.mul(b.omega)).add(b.phase);
    const c = cos(th);
    dx = dx.add(steep.mul(a).mul(d.x).mul(c));
    dz = dz.add(steep.mul(a).mul(d.y).mul(c));
    h = h.add(a.mul(sin(th)));
  });

  // Ultra-Water's cascades (600 / 85 / 12 m tiles) in place of the Gerstner sum; the long swell dies in the shallows
  const ultraDamp = (d) => { const chop = smoothstep(-0.4, 2, d); return [smoothstep(2, 14, d), chop, chop]; };
  const dispN = ultra ? texture(ultra.disp) : null, slopeN = ultra ? texture(ultra.slope) : null;
  const uJac0 = uniform(0.5);
  const lodOf = (c) => max(log(gridStep.mul(UN / ULEN[c])).div(Math.LN2).add(1), 0);
  const uHsRef = uniform(0.3), uLive = uniform(live), uSwellHs = uniform(0);   // uSwellHs: the open lake's swell at the mouth (m), only on rough days
  // per-point fetch: one sim at the open lake's wave height; each point scales it by its own fetch-limited Hs (the bay's
  // lee stays calm, the mouth and the open lake build). The long cascades follow the ratio; the chop (12 m and finer) is saturated at any fetch, so it stays
  // hasB: the bay's sim (gpuBridge.js): a short-fetch sea for the 85 and 12 m tiles; beta (0 on the lake, 1 in the bay) is its share and
  // sB its size against its own spectrum's Hs; the lake sim's 85 and 12 m cascades give way by (1 - beta)
  const BAY_SLOPE = 2.0;   // visual: the bay sim's slopes against its height (shading only)
  // SEA_FEEL (owner 2026-10-30: "the wave effect is not big enough, people need to feel it"): a gain on the wave heights on top of the fetch
  // law, artistic licence kept in one place: x2 in the bay (level 4: 0.5 m instead of 0.25), x1.3 on the open lake (2 m). The boat floats on the
  // same surface (the CPU weights take it too), so the felt motion is real physics on a bigger sea. ?seafeel=bay,lake tunes it (1,1 = the fetch law).
  const FEEL = { bay: seaFeel?.[0] ?? 2.5, lake: seaFeel?.[1] ?? 1.3 };
  const BAY_GAIN = 0.9;   // the bay sim's size against the fetch law: the hull's roll and pitch in the bay are tuned to this
  const hasB = !!(ultra && ultra.bayLayer), uHsLawB = uniform(0.1);
  const LB = [ULEN[1], ULEN[2]];
  const mulOf = (hsN, hsLoc = hsN) => {
    const m = clamp(hsN.div(uHsRef), 0, 1.5), chop = float(1).add(float(1).sub(min(m, 1)).mul(0.7));   // the bay's short sea: the 12 m cascade stands in for it, a little taller
    const beta = hasB ? float(1).sub(smoothstep(0.35, 0.8, m)) : float(0), sB = clamp(hsLoc.div(uHsLawB), 0, 1.4).mul(BAY_GAIN), keep = float(1).sub(beta);
    const feel = mix(float(FEEL.lake), float(FEEL.bay), beta);
    const out = [m.mul(m).mul(m).mul(feel), pow(m, 1.6).mul(keep).mul(feel), chop.mul(keep).mul(feel), float(1)];
    out.bay = beta.mul(sB).mul(feel);
    return out; };
  // the tile break (bridge.js warpAt): cascades 1 to 3 are read through a smooth warp
  const warpOf = (q) => vec2(
    sin(q.y.mul(0.0419).add(q.x.mul(0.0113)).add(1.3)).mul(WARP.a1).add(sin(q.x.mul(0.113).sub(q.y.mul(0.071)).add(0.7)).mul(WARP.a2)),
    sin(q.x.mul(0.0377).sub(q.y.mul(0.0097)).add(0.4)).mul(WARP.a1).add(sin(q.y.mul(0.097).add(q.x.mul(0.083)).add(2.1)).mul(WARP.a2)));
  const wq = (c, q) => (c > 0 ? q.add(warpOf(q)) : q);
  // swell entering the mouth: waves made on the open lake come in through the narrows and die off inside the bay
  // (exp(-distance / 700 m) behind the mouth line a -> b); outside the mouth they are the open lake's. They add
  // to the local wind sea in energy: Hs = sqrt(Hs_local^2 + Hs_swell^2)
  const HS_GAIN = 1.3;   // owner 2026-10-30: 1 to 2 m on the open lake at level 4 and advisory days (the fetch law gives 0.9 to 1.6 m)
  const MOUTH = { bx: 409, bz: -1839, ax: 0.643, az: -0.766, swell: 0.7, decayM: 450 };
  const effHs = (hsN, xz) => {
    const t = xz.x.sub(MOUTH.bx).mul(MOUTH.ax).add(xz.y.sub(MOUTH.bz).mul(MOUTH.az));
    const r = length(xz.sub(vec2(MOUTH.bx, MOUTH.bz)));   // inside the mouth line the swell spreads from the narrows: it dies with the distance to them
    const sw = uSwellHs.mul(exp(r.mul(-1 / MOUTH.decayM).mul(t.lessThan(0).select(1, 0))));
    return sqrt(hsN.mul(hsN).add(sw.mul(sw)));
  };
  // shore waves (Ultra's breakers, simplified): a train running shoreward at sqrt(g d), phase w (tau + t) with the travel
  // time tau = 2 s / sqrt(g d) on a plane beach; Green's law, broken at 0.42 d; foam where it breaks
  const shoreWave = (d, sh, fpN, hsN) => {
    const dc = max(d, 0.15), om = fpN.mul(2 * Math.PI);
    const ph = om.mul(sh.mul(2).div(sqrt(dc.mul(G))).add(uTime));
    const Au = hsN.mul(0.5).mul(min(pow(float(20).div(dc), 0.25), 2));
    const reach = float(1).sub(smoothstep(5, 16, d)).mul(smoothstep(0, 0.25, d));
    return { ph, Au, dc, reach, A: min(Au, dc.mul(0.42)).mul(reach), k: om.div(sqrt(dc.mul(G))) };
  };
  const swV = ultra ? (() => { const sp = spectrum(p); return shoreWave(blendMap(depthTex.tex, depthOuter.tex, p, true), blendMap(shoreMap.tex, shoreOuter.tex, p, true).negate(), sp.fp, sp.hs); })() : null;
  if (ultra) {
    const dd = ultraDamp(blendMap(depthTex.tex, depthOuter.tex, p, true)), mv = mulOf(effHs(spectrum(p).hs, p), spectrum(p).hs);
    let ux = float(0), uy = float(0), uz = float(0);
    for (let c = 0; c < 3; c++) {
      const s = dispN.sample(wq(c, p).div(ULEN[c])).depth(int(c)).level(lodOf(c)), w = dd[c].mul(mv[c]);
      ux = ux.add(s.x.mul(w)); uy = uy.add(s.y.mul(w)); uz = uz.add(s.z.mul(w));
    }
    if (hasB) for (let cb = 0; cb < 2; cb++) {   // the bay's sim, the 85 and 12 m tiles
      const s = dispN.sample(wq(1, p).div(LB[cb])).depth(int(4 + cb)).level(max(log(gridStep.mul(UN / LB[cb])).div(Math.LN2).add(1), 0)), w = dd[1].mul(mv.bay);
      ux = ux.add(s.x.mul(w)); uy = uy.add(s.y.mul(w)); uz = uz.add(s.z.mul(w));
    }
    dx = ux; h = uy.add(swV.A.mul(sin(swV.ph))); dz = uz;
  }
  const vWorld = varying(vec3(p.x.add(dx), h, p.y.add(dz)));
  const vRest = varying(p);   // wave phases run on the rest position
  const vSteep = varying(steep);   // the vertex's Gerstner steepness, for the whitecaps' Jacobian
  const { ampScale: vAmp, fp4: vFp4, fp: vFp, hs: vHs } = spectrum(vRest);   // per pixel

  // the sun's light at the water: the sky model's transmitted (direct) illuminance at the camera's foot when there is
  // an atmosphere (so the glint goes warm at golden hour, as the sun itself does); else the uniform
  let sunLight = uSunCol;
  if (atmosphere) {
    const A = atmosphere;
    let pE = A.matrixWorldToECEF.mul(vec4(cameraPosition.x, 1, cameraPosition.z, 1)).xyz;
    if (A.correctAltitude) pE = pE.add(A.altitudeCorrectionECEF);
    sunLight = getSplitScalarIlluminance(pE.mul(A.parametersNode.worldToUnit), A.sunDirectionECEF).get('direct').mul(sunScale);
  }

  // --- fragment: local wind → ripples → normal, roughness → Fresnel, sky, glint, foam ----
  const shoreD = blendMap(shoreMap.tex, shoreOuter.tex, vWorld.xz);   // m to the shore, negative on the lake
  const toCam = cameraPosition.sub(vWorld), dist = length(toCam), v = normalize(toCam);
  const footprint = dist.mul(uPix).div(sqrt(max(v.y, 0.02)));
  // the wind texture covers ±2 km round the camera; past its edge it is clamped, and the edge texels smeared into
  // straight lines kilometres long (the bay mouth's streaks from the overlook, 2026-10-29: the gust look and the
  // lanes both read the smeared texels). The field fades to its mean over the texture's outer 15 % instead.
  const windEdge = (xz) => { const q = xz.sub(uWindCentre).abs().mul(2 / WIND_EXTENT); return float(1).sub(smoothstep(0.82, 0.97, max(q.x, q.y))); };
  const windUV = (xz) => xz.sub(uWindCentre).div(WIND_EXTENT).add(0.5);
  const windAt = (xz, lod0 = false) => { const s = texture(windTex, windUV(xz)); return mix(uWindMean, (lod0 ? s.level(0) : s).xy, windEdge(xz)); };
  const wEdge = windEdge(vWorld.xz);
  const wv = windAt(vWorld.xz);
  const localU = length(wv);
  const rip = smoothstep(RIPPLE_ONSET[0], RIPPLE_ONSET[1], localU).mul(pow(localU.div(U), 1.5));   // rippleFactor
  // D1: how much this point reads as a gust patch (water-spectrum.js gustVisual, mirrored): darker, bluer, rougher
  const aroundU = max(mix(localU, texture(windMean.tex, windUV(vWorld.xz)).r, wEdge), 0.3);   // no gust look past the edge
  const gRatio = localU.div(aroundU);
  const gustWb = smoothstep(GUST_EDGE[0], GUST_EDGE[1], gRatio).mul(0.7)
    .add(clamp(gRatio.sub(GUST_EDGE[1]).div(GUST_FULL - GUST_EDGE[1]), 0, 1).mul(0.3))
    .mul(smoothstep(GUST_ONSET[0], GUST_ONSET[1], localU));
  // the features' shared nodes (src/waters/features.js c), filled in as the shader reaches each slot
  const fx = { rest: vRest, world: vWorld, time: uTime, footprint, gRatio, wv, localU, aroundU, windAt };
  const gustW0 = fs.run('slope', 'weight', gustWb, fx);   // the gust look's weight (the gust module: its own outline)
  // the visible wind (src/wind-cues.js, the windLook hook): lanes along the LOCAL wind from ≈ 6 kn darken like a
  // gust and roughen the Fresnel average; whitecaps and spume join the foam after the loop (windLook.foam)
  // lanesAt: the wind lanes at p along the local wind (wind-cues.js streakAt), relative to the bay's centre
  const lanesAt = (pR) => (windLook ? windLook.streakAt(pR, windAt(pR, true), uTime, vec2(mcx, mcz)) : float(0));
  // The look map (src/water-look.js): the wind lanes, drawn once a frame round the camera and read here once. They
  // fade where they would alias (the pixel's footprint, grazing angles); the map's mips average them into texture.
  const lookMap = windLook ? createLookMap({ lanesAt: (p) => lanesAt(p), ...(wt.lookSize ? { size: wt.lookSize } : {}) }) : null;
  const L = lookMap ? lookMap.at(vRest) : { streak: float(0), inside: float(0) };
  const laneVis = laneVisibility(footprint, v.y);
  const look = windLook ? windLook.lanes({ streak: L.streak.mul(laneVis) }) : null;
  const streak = look ? look.streak : float(0);
  const gustW = look ? clamp(gustW0.add(look.dark), 0, 1) : gustW0;
  const laneRip = look ? look.ripple : float(1);   // the lanes' ripple contrast
  fx.gustW = gustW;

  // slope of every wave the pixel can resolve; what it can't (λ under 4 footprints) goes into roughness
  // the short waves' crests wander (a smooth warp of their coordinates, ≈ 0.3 m over ≈ 7–11 m): crossed straight
  // crests made a regular diamond lattice near the camera, which the glint lit as a square mosaic
  const warp = vec2(sin(vRest.y.mul(0.57).add(vRest.x.mul(0.21)).add(uTime.mul(0.13))), sin(vRest.x.mul(0.83).sub(vRest.y.mul(0.29)).sub(uTime.mul(0.11))))
    .mul(0.3).add(vec2(sin(vRest.y.mul(1.9).add(vRest.x.mul(1.3))), sin(vRest.x.mul(2.3).sub(vRest.y.mul(1.1)))).mul(0.08));
  const restW = vRest.add(warp);
  // M10: the wake maps, read first: the trail is a SLICK (the hull's turbulence damps the wind ripples, so the track
  // reads as a calm lane in the glint, lighter or darker than the rippled water around it, as a real one does)
  const kv = wake ? wake.kelvinAt(vRest) : null, mp = wake ? wake.mapAt(vRest) : null;
  const calm = wake ? float(1).sub(wake.slickAt(vRest, mp.rough, uTime).mul(wakeCalm)) : float(1);   // ragged edges
  let sx = float(0), sz = float(0), lost = float(0), lostG = float(0);
  // The long waves modulate the short ones (the hydrodynamic modulation transfer function: Keller & Wright 1975,
  // Alpers & Hasselmann 1978): the orbital motion strains the ripples, so they pile up, steeper
  // and rougher, on the crests and the forward faces, and the troughs go smoother. That is what makes a chop read
  // as rows from a distance: bands of glitter and bands of mirror, not the long waves' own slope (≈ 0.1 against a
  // ripple rms slope of 0.2). Modulation m = 1 + MTF·η/Hs on the ripple bands' amplitude, η the long waves' height
  // here (the geometry bands, resolved or not), clamped so a trough never goes glassy on its own.
  const MTF = 2.2;
  const amp0 = B.map((b, i) => vAmp.mul(sqrt(bandWeightNode(b, vFp, vFp4, i))).mul(tail(b, vFp)));   // the spectrum's amplitude per band (CPU: amps)
  // each geometry band's phase at the rest point, its sine and cosine once (shared by the height here, the normal of
  // the unwarped bands and the whitecaps' Jacobian: the three sums cost 48 sines before this, 24 now)
  const geoTrig = [];
  let eta = float(0);
  const uDamp = ultra ? ultraDamp(blendMap(depthTex.tex, depthOuter.tex, vRest)) : null;
  const mF = ultra ? mulOf(effHs(vHs, vRest), vHs) : null;
  // the tile break's warp, once for the pixel (every cascade above the 600 m one shares it)
  const warpR = ultra ? warpOf(vRest) : null, wr = (c) => (c > 0 ? vRest.add(warpR) : vRest);
  // a branch for the costly patterns: computed only where its gate is open
  const gated = (cond, build) => Fn(() => { const v = float(0).toVar(); If(cond, () => { v.assign(build()); }); return v; })();
  const dispAt = (c) => dispN.sample(wr(c).div(ULEN[c])).depth(int(c));
  let jacU = float(1), swF = null;
  if (ultra) {
    // the long waves' height, and the Jacobian of the choppy map from the sim's turbulence (J < 1 where a crest folds)
    jacU = float(-2);
    for (let c = 0; c < 3; c++) {
      const t = dispAt(c), w = uDamp[c].mul(mF[c]);
      eta = eta.add(t.y.mul(w));
      jacU = jacU.add(mix(float(1), t.w, uDamp[c]));   // folds are as frequent at any fetch (the threshold is the wind's)
    }
    if (hasB) for (let cb = 0; cb < 2; cb++) eta = eta.add(dispN.sample(wr(1).div(LB[cb])).depth(int(4 + cb)).y.mul(uDamp[1]).mul(mF.bay));
  }
  // whitecaps: the Jacobian of the Gerstner map at the rest point, summed over the geometry bands as water-spectrum.js
  // jacobianRest does, in this same loop (a separate Fn/If block re-evaluated the amplitudes and cost 3.6 ms; here the
  // sums share everything). From the spectrum's amplitude, not the gust-raised one: the threshold's calibration (and
  // the vertex's steepness) are on the spectrum; the gust enters through the threshold's local wind. Faded with the
  // footprint: far water keeps J = 1.
  let jxx = float(0), jzz = float(0), jxz = float(0);
  B.forEach((b, i) => {
    if (b.kind !== 'geometry' || ultra) return;
    const d = dirs[i], th = dot(d, vRest).mul(b.k).sub(uTime.mul(b.omega)).add(b.phase);
    const sn = sin(th), cs = cos(th);
    geoTrig[i] = { sn, cs };
    eta = eta.add(amp0[i].mul(sn));
    if (!whitecaps) return;
    const fade = clamp(float(b.lambda).div(footprint).sub(2).div(2), 0, 1);
    const sJ = vSteep.mul(amp0[i].mul(b.k)).mul(fade), s1 = sJ.mul(sn);
    const dxx = d.x.mul(d.x), dyy = d.y.mul(d.y), dxy = d.x.mul(d.y);
    jxx = jxx.sub(s1.mul(dxx)); jzz = jzz.sub(s1.mul(dyy)); jxz = jxz.sub(s1.mul(dxy));
  });
  const jac = ultra ? jacU : float(1).add(jxx).mul(float(1).add(jzz)).sub(jxz.mul(jxz));
  const modulate = clamp(eta.div(max(vHs, 0.03)).mul(MTF).add(1), 0.35, 2.2);
  // quality tiers (src/quality/tiers.js): fewer ripple wavelengths. A dropped wavelength costs no sine; its slope energy
  // joins the nearest kept wavelength on the same side (a · sqrt(group energy / own energy)), so the glitter keeps its
  // total roughness. High keeps all 16.
  const ripIdx = B.map((b, i) => (b.kind === 'ripple' ? i : -1)).filter((i) => i >= 0);
  const nRip = ripIdx.length / 2, keepN = Math.max(1, Math.min(nRip, wt.rippleWavelengths ?? nRip));
  const keepW = new Set(Array.from({ length: keepN }, (_, j) => (keepN === 1 ? 0 : Math.round(j * (nRip - 1) / (keepN - 1)))));
  const ripGroup = new Map();   // kept band index → every band index it carries
  if (keepN < nRip) {
    const keptArr = [...keepW];
    for (let w = 0; w < nRip; w++) for (let side = 0; side < 2; side++) {
      const near = keptArr.reduce((m, q) => (Math.abs(q - w) < Math.abs(m - w) ? q : m), keptArr[0]);
      const kept = ripIdx[2 * near + side], own = ripIdx[2 * w + side];
      if (!ripGroup.has(kept)) ripGroup.set(kept, []);
      ripGroup.get(kept).push(own);
    }
  }
  if (ultra) {
    // the cascades' slopes (mips carry the unresolved slope: the second moments give the variance); the gust, the wake's
    // calm and the lanes act on the short cascades as they did on the short bands, the long waves pile ripples on crests
    const resp = [0, gustResponse(5), gustResponse(0.9), gustResponse(0.2)];
    for (let c = 0; c < 4; c++) {
      if (!((ultraMask >> c) & 1)) continue;   // ?umask= (debug): which slope cascades to use
      const t = (c >= 2 ? slopeN.sample(wr(c).div(ULEN[c])).bias(float(-0.6)) : slopeN.sample(wr(c).div(ULEN[c]))).depth(int(c));   // the fine cascades a little sharper than the box-filtered mip
      let g = uDamp[Math.min(c, 2)].mul(mF[c]);
      if (c === 1) g = g.mul(mix(float(1), uLive, 0.5)); else if (c >= 2) g = g.mul(uLive);
      if (resp[c] > 0) g = g.mul(mix(float(1), rip, resp[c])).mul(mix(float(1), calm.mul(laneRip), resp[c]));
      if (c >= 2) g = g.mul(modulate);
      sx = sx.add(t.x.mul(g)); sz = sz.add(t.y.mul(g));
      lost = lost.add(max(t.z.sub(t.x.mul(t.x)), 0).add(max(t.w.sub(t.y.mul(t.y)), 0)).mul(g).mul(g));
    }
    if (hasB) for (let cb = 0; cb < 2; cb++) {   // the bay's sim: the 85 m tile acts as the lake's 85 m cascade, the 12 m tile as its 12 m one
      if (!((ultraMask >> (cb + 1)) & 1)) continue;
      const t = slopeN.sample(wr(1).div(LB[cb])).depth(int(4 + cb));
      // the bay sea's slopes are drawn steeper than the geometry (x 2, the beauty pass): the boat's physics keeps the real height
      let g = uDamp[1].mul(mF.bay).mul(BAY_SLOPE);
      if (cb === 0) g = g.mul(mix(float(1), uLive, 0.5)).mul(mix(float(1), rip, resp[1])).mul(mix(float(1), calm.mul(laneRip), resp[1]));
      else g = g.mul(uLive).mul(mix(float(1), rip, resp[2])).mul(mix(float(1), calm.mul(laneRip), resp[2])).mul(modulate);
      sx = sx.add(t.x.mul(g)); sz = sz.add(t.y.mul(g));
      lost = lost.add(max(t.z.sub(t.x.mul(t.x)), 0).add(max(t.w.sub(t.y.mul(t.y)), 0)).mul(g).mul(g));
    }
    // the shore train's slope: d(eta)/dx = A cos(ph) w / sqrt(g d) along the shore's gradient (d tau / d s = 1 / sqrt(g d))
    const sh0 = (q) => blendMap(shoreMap.tex, shoreOuter.tex, q).negate();
    const gs = vec2(sh0(vRest.add(vec2(3, 0))).sub(sh0(vRest.sub(vec2(3, 0)))), sh0(vRest.add(vec2(0, 3))).sub(sh0(vRest.sub(vec2(0, 3))))).div(6);
    swF = shoreWave(blendMap(depthTex.tex, depthOuter.tex, vRest), sh0(vRest), vFp, vHs);
    // fix/bed-zebra (owner 2026-11-06): one sine of the full slope (≈ 0.3 a metre deep) on crests that followed the
    // shore line exactly drew hard, regular light and dark bands over the shallow sand by the beaches ("zebra"). Real
    // shoaling waves come in groups and their crests bend and break up: one Perlin octave (11 m, drifting) bends the
    // crests (±1 rad), sets a group envelope (25–100 %) and the phase of a weaker second train at 1.7× the wavenumber;
    // the slope is drawn at half, and each train fades before the pixel's footprint can alias it. Only where the train
    // reaches (the noise is skipped elsewhere).
    const swNear = float(1).sub(smoothstep(SHORE_NEAR[0], SHORE_NEAR[1], footprint));
    const swMod = Fn(() => { const v = vec3(0).toVar(); If(swF.reach.greaterThan(0.001).and(swNear.greaterThan(0)), () => { v.assign(mx_noise_vec3(vec3(vRest.mul(0.09), uTime.mul(0.04)))); }); return v; })();
    const swPh = swF.ph.add(swMod.x.mul(2)), swEnv = smoothstep(-0.35, 0.45, swMod.y).mul(0.75).add(0.25);
    const swAA = (k) => clamp(float(2 * Math.PI).div(k).div(footprint).sub(2).div(2), 0, 1);
    const cfNew = swF.A.mul(swF.k).mul(swEnv).mul(SHORE_SLOPE)
      .mul(cos(swPh).mul(swAA(swF.k)).add(cos(swPh.mul(1.7).add(swMod.z.mul(4))).mul(0.6).mul(swAA(swF.k.mul(1.7)))));
    // past SHORE_NEAR the earlier train, exactly (the far shores, the overlook: the approved goldens)
    const cf = mix(swF.A.mul(cos(swF.ph)).mul(swF.k), cfNew, swNear);
    sx = sx.add(cf.mul(gs.x)); sz = sz.add(cf.mul(gs.y));
  }
  B.forEach((b, i) => {
    if (ultra) return;
    if (b.kind === 'ripple' && keepN < nRip && !ripGroup.has(i)) return;   // dropped: carried by a neighbour
    const a0 = amp0[i];
    const resp = gustResponse(b.lambda);   // short bands follow the local gust; long ones don't
    let a = resp > 0 ? a0.mul(mix(float(1), rip, resp)).mul(mix(float(1), calm.mul(laneRip), resp)) : a0;   // the trail calms the short bands; the lanes roughen them
    if (b.kind === 'ripple') a = a.mul(modulate);   // the long waves pile the ripples on their crests
    if (ripGroup.has(i) && ripGroup.get(i).length > 1) {
      let e = float(0); for (const j of ripGroup.get(i)) { const q = amp0[j].mul(B[j].k); e = e.add(q.mul(q)); }
      const own = amp0[i].mul(b.k);
      a = a.mul(sqrt(e.div(max(own.mul(own), 1e-12))));
    }
    const fade = clamp(float(b.lambda).div(footprint).sub(2).div(2), 0, 1);
    const d = dirs[i];
    // short waves: warped; the long geometry bands reuse the cosine above
    const cs = b.lambda < 2 ? cos(dot(d, restW).mul(b.k).sub(uTime.mul(b.omega)).add(b.phase)) : geoTrig[i].cs;
    const g = a.mul(b.k).mul(cs).mul(fade);
    sx = sx.add(g.mul(d.x)); sz = sz.add(g.mul(d.y));
    const ak = a.mul(b.k);
    lost = lost.add(ak.mul(ak).mul(0.5).mul(float(1).sub(fade)));
  });
  // the breaking threshold follows the local wind so the coverage tracks Monahan & O'Muircheartaigh (W ∝ U^3.41;
  // water-spectrum.js WHITECAP): J0 = 0.677 + 0.123·log10(U), the Jacobian quantile at W(U) of this spectrum
  const jac0 = log(max(localU, 1)).mul(WHITECAP.j0[1] / Math.LN10).add(WHITECAP.j0[0]);
  const breaking = whitecaps
    ? smoothstep(ultra ? uJac0 : jac0, (ultra ? uJac0 : jac0).sub(WHITECAP.width), jac).mul(smoothstep(WHITECAP.onset[0], WHITECAP.onset[1], localU))
    : float(0);
  // D1: the gust's fine ripples (8–13 cm, crossed, along the local wind): a finer, busier normal near the boat; past
  // 4 footprints their slope (lostG) goes into the rough-Fresnel average only: less mirror, so far off the patch reads
  // darker. Not into the sky lookup or the glint: there it lifted the patch toward the brighter upper sky at dusk
  // (a pale patch where the mirror shows dark ridges), the opposite of the dark line a sailor reads
  {
    const gs = sqrt(gustW.mul(float(GUST_LOOK.slope2).mul(fs.run('slope', 'fine', null, fx) ?? float(1)))).mul(calm).mul(laneRip).mul(modulate), wd = wv.div(max(localU, 0.1));
    // Ultra: the FFT's 2.1 m cascade carries the fine ripples (and the gust scales it above); the two fixed cosines below made
    // the regular stipple at mid distance (?umask=0 still showed it)
    // Ultra: the same two crossed cosines, read through the tile break's warp (their regular lattice at mid distance came from straight crests)
    for (const [lam, ang, ph, w] of [[0.13, 0.35, 0.0, 0.6], [0.083, -0.5, 1.7, 0.4]]) {
      const k = 2 * Math.PI / lam, c = Math.cos(ang), sn = Math.sin(ang);
      const d = vec2(wd.x.mul(c).sub(wd.y.mul(sn)), wd.x.mul(sn).add(wd.y.mul(c)));
      const fadeG = clamp(float(lam).div(footprint).sub(2).div(2), 0, 1);
      const amp = gs.mul(Math.sqrt(2 * w));                                // slope amplitude: Σ amp²/2 = slope2
      const g = amp.mul(cos(dot(d, ultra ? restW.add(warpR.mul(2.2)) : restW).mul(k).sub(uTime.mul(Math.sqrt(9.81 * k + 0.074 / 1000 * k * k * k))).add(ph))).mul(fadeG);
      sx = sx.add(g.mul(d.x)); sz = sz.add(g.mul(d.y));
      lostG = lostG.add(amp.mul(amp).mul(0.5).mul(float(1).sub(fadeG)));
    }
  }
  // M10: the boat's wake. The Kelvin crests bend the normal; the trail's disturbed water is rougher (a darker band)
  let wakeFoam = float(0), armFoam = float(0), wakeRough = float(0), wakeDebug = null, slopeDebug = null;
  if (wake) {
    wakeDebug = vec3(mp.foam, mp.rough.mul(0.3), kv.debug);   // debug=wake
    slopeDebug = vec3(vlen(kv.slope).mul(3), vlen(vec2(sx, sz)).mul(3), 0);   // debug=slope: r = the wake's slope, g = the waves'
    sx = sx.add(kv.slope.x); sz = sz.add(kv.slope.y);
    wakeFoam = mp.foam; armFoam = kv.foam; wakeRough = mp.rough;   // kv.foam: the bow wave's white roll
  }
  // the features' slope: the storm's rain rings and hiss, the birds' marks (summed in order, then added)
  const extra = fs.run('slope', 'add', null, fx);
  if (extra) { sx = sx.add(extra.sx); sz = sz.add(extra.sz); lost = lost.add(extra.rough); }
  const n = normalize(vec3(sx.negate(), 1, sz.negate()));
  // mean-square slope the pixel averages over (floor: no hard-edged glints); wind lanes and breaking crests are rougher
  const sigma2 = (look ? lost.add(0.0008).add(look.rough) : lost.add(0.0008)).add(breaking.mul(0.01));

  // sky seen in the mirror; a rough patch tilts its facets, so it sees higher, darker sky
  const r = reflect(v.negate(), n);
  const ry = clamp(max(r.y, 0).add(sqrt(sigma2).mul(0.8)), 0, 1);
  let skyRefl = mix(uHorizon, uZenith, pow(ry, 0.45));
  if (probe) {
    // the probe, parallax-corrected: intersect the reflected ray with a proxy sphere (the ridges, ~4 km out) around
    // the probe and look up the direction to that point; blurred by the unresolved slope (Beckmann σ → roughness)
    const rUp = normalize(vec3(r.x, max(r.y, 0.01), r.z));
    const o = vWorld.sub(uProbe), b = dot(o, rUp), c = dot(o, o).sub(probe.proxyM * probe.proxyM);
    const hitP = o.add(rUp.mul(b.negate().add(sqrt(max(b.mul(b).sub(c), 0)))));
    // roughness: the slope blur of a grazing reflection is vertical (a stretch), not round; the PMREM blur is round,
    // so at the Beckmann-matched level (√σ) it smears the ridges' silhouette away. 0.45 × that matches the trace's
    // own sharpness, so the screen edges blend into neighbours that look alike.
    const rough = clamp(sqrt(sqrt(sigma2)).mul(0.45), 0, 1);
    probeNode = pmremTexture(new THREE.Texture(), normalize(hitP), rough);
    skyRefl = probeNode.rgb;
  }
  // the features' mirror: a gust patch sees the open sky above; under the storm the mirror greys and darkens
  if (probe && mirror) {
    // M6: the cloud deck in the mirror. The deck is a post pass, so neither the probe nor the screen-space trace holds it,
    // and at twilight it is most of the sky's light (the lit deck over a dark clear sky). Its mean is mirrored: the probe's
    // whole upper sky (the most blurred level, toward the zenith) × mirror.cloudGain, by the deck's coverage, above the
    // horizon only, at low sun only (by day the screen-space trace and the body carry the water)
    const upAvg = pmremTexture(new THREE.Texture(), vec3(0, 1, 0), float(1));
    probeSunNodes.push(upAvg);
    const w = uCloudCov.mul(mirror.cloudShare).mul(smoothstep(0.02, 0.12, ry)).mul(uTwi);
    skyRefl = mix(skyRefl, upAvg.rgb.mul(mirror.cloudGain), w);
  }
  Object.assign(fx, { r, probe, probeLookup: (node) => probeSunNodes.push(node), horizon: uHorizon, zenith: uZenith });
  skyRefl = fs.run('sky', 'mirror', skyRefl, fx);
  const nv = max(dot(n, v), 0);
  // Smith masking for Beckmann slopes (σ per axis = √(σ²/2)); erf by Abramowitz–Stegun 7.1.26
  const am = max(nv, 0.001).div(sqrt(max(float(1).sub(nv.mul(nv)), 1e-6)).mul(sqrt(sigma2)));
  const tt = float(1).div(am.mul(0.3275911).add(1));
  const erf = float(1).sub(tt.mul(tt.mul(tt.mul(tt.mul(tt.mul(1.061405429).sub(1.453152027)).add(1.421413741)).sub(0.284496736)).add(0.254829592)).mul(exp(am.mul(am).negate())));
  const lambda = erf.sub(1).mul(0.5).add(exp(am.mul(am).negate()).div(am.mul(2 * Math.sqrt(Math.PI))));
  // floored at 0.45: at the most grazing angles (cam B's far water) G1 alone would remove the mirror, but the
  // light it masks still leaves the surface, off the next wave; real far water still mirrors the ridge, blurred
  // M6: at low sun the floor rises toward a calm mirror (the morning's and evening's light air), mirror.mask at full twilight
  const mask = max(float(1).div(lambda.add(1)), mirror ? mix(float(0.45), float(mirror.mask), uTwi) : float(0.45));
  // Fresnel averaged over the facets the pixel can't resolve: they face the viewer more than the mean surface,
  // so a rough patch reflects less at grazing angles and shows more of the dark water body
  // F0: 0.02 (water) by day; the starlit night lifts it (uF0, the daylight hook below), a long exposure's sheen
  const schlick = (nvR) => float(1).sub(nvR).pow(5).mul(float(1).sub(uF0)).add(uF0).mul(mask);
  // the unresolved slope's share in the rough-Fresnel average: 0.9 by day; M6 lowers it at twilight (the calm water's
  // grazing mirror; with 0.9 the dawn water kept a fifth of the sky and AgX's toe drew it black)
  const roughK = mirror ? mix(float(0.9), float(mirror.roughK), uTwi) : float(0.9);
  const fres0 = schlick(clamp(nv.add(sqrt(sigma2).mul(roughK)), 0, 1));   // the water without the gust's look
  // D1: a gust patch mirrors less: its fine ripples' rough-Fresnel average, and the light its tilted facets send down
  // into the water, where it is lost
  const fres = schlick(clamp(nv.add(sqrt(sigma2.add(lostG)).mul(roughK)), 0, 1)).mul(float(1).sub(gustW.mul(fs.run('sky', 'fres', GUST_LOOK.fres, fx))));

  // sun glint: Beckmann highlight over the same slope distribution
  // the glint's slope variance: never under half the clean-sea Cox–Munk value for the local wind (≥ 1.5 m/s). In
  // light air the mesh and ripple bands carry little slope, and the path shrank to a hard white bar; a real glitter
  // path stays broad from the sub-pixel ripples. Wider also means a lower peak, so the sun's colour survives AgX.
  const sigmaG = max(sigma2, max(localU, 1.5).mul(0.00512).add(0.003).mul(0.5));
  const hv = normalize(v.add(uSun));
  const nh = max(dot(n, hv), 0.001), nh2 = nh.mul(nh);
  const tan2 = float(1).sub(nh2).div(nh2);
  const D = exp(tan2.negate().div(sigmaG)).div(sigmaG.mul(Math.PI).mul(nh2).mul(nh2));
  const fh = float(1).sub(max(dot(hv, v), 0)).pow(5).mul(0.98).add(0.02);
  let glintRaw = sunLight.mul(min(D.mul(fh).mul(0.25).div(max(nv, 0.1)), 40)).mul(smoothstep(-0.02, 0.05, uSun.y));
  glintRaw = fs.run('glint', 'sun', glintRaw, fx);   // the features' sun: the storm cell's shadow and its gaps
  // keep the glint's hue: its core ran far past AgX's shoulder, where every colour turns white. Rolled off at 4× the
  // luminance of the sky around the sun (the probe there, blurred; it has no sun disc), hue kept, the path reads as
  // the sun's colour, warm at golden hour, and stays bright where it crosses a dark ridge's reflection
  const LUMA = vec3(0.2126, 0.7152, 0.0722);
  const sunSky = probe ? pmremTexture(new THREE.Texture(), uSun, float(0.6)) : null;
  if (sunSky) probeSunNodes.push(sunSky);
  const glintL = max(dot(glintRaw, LUMA), 1e-6), capL = dot(sunSky ? sunSky.rgb : uHorizon, LUMA).mul(4).add(1e-4);
  // a soft roll-off, not a hard cap (that flattened the glitter into an even column): L' = 2·cap·L / (L + cap),
  // equal to the cap at L = cap and never above 2× it, so the sparkle's light and dark stay apart
  let glint = glintRaw.mul(capL.mul(2).div(glintL.add(capL)));
  glint = fs.run('glint', 'after', glint, fx);   // the features' glitter: a gust patch's rough facets scatter it (a dim band in the path)
  if (ultra) {
    // Ultra's twinkle, simplified: the lobe is lit by a finite number of facets per pixel-sized cell, each cell drawing its own
    // share (mean 1, so the energy is kept), two draws crossfading in time
    const cell = max(footprint.mul(5), 0.05), id = vRest.div(cell).floor();
    const hash = (q, s) => fract(sin(dot(q.add(s), vec2(127.1, 311.7))).mul(43758.5453));
    const ph = uTime.mul(2.2), n0 = ph.floor(), fr = fract(ph);
    const draw = (n) => hash(id, vec2(n.mul(7.13), n.mul(3.77)));
    const tw = mix(draw(n0), draw(n0.add(1)), smoothstep(0, 1, fr));
    glint = glint.mul(mix(float(1), mix(float(0.85), float(1.15), tw), smoothstep(0.1, 1.2, sqrt(max(sigmaG, 1e-5)).mul(8))));
  }

  // shore foam within 3 m, as strong as the local sea (Hs 12 cm and up = full, a trace in calm air): a bright rim
  // at the waterline, a swash line that runs up and down the band with the peak wave (its phase drifts along the
  // shore), and lacy foam between, from two cheap crossed wave patterns
  const s = shoreD.negate();
  const band = float(1).sub(smoothstep(0, FOAM_M, s));
  const swashAt = sin(uTime.mul(vFp).mul(2 * Math.PI).add(vRest.x.add(vRest.y).mul(0.05))).mul(0.5).add(0.5).mul(FOAM_M * 0.6);
  const swash = float(1).sub(smoothstep(0, 0.5, s.sub(swashAt).abs()));
  // fix/bed-zebra: the two crossed sines alone drew a regular checker along the waterline; a drifting warp (one Perlin
  // octave, 1.7 m, ±0.8 m, inside the band only) breaks it into irregular lace, drawn fainter (0.55 → 0.35)
  const laceNear = float(1).sub(smoothstep(SHORE_NEAR[0], SHORE_NEAR[1], footprint));   // past it, the earlier lace exactly
  const laceW = Fn(() => { const v = vec3(0).toVar(); If(s.lessThan(FOAM_M).and(laceNear.greaterThan(0)), () => { v.assign(mx_noise_vec3(vec3(vRest.mul(0.6), uTime.mul(0.08).add(5.3)))); }); return v; })();
  const lq = vRest.add(laceW.xy.mul(1.6));
  const laceN = sin(lq.x.mul(4.1).add(lq.y.mul(2.3)).add(uTime.mul(0.9))).mul(sin(lq.x.mul(1.9).sub(lq.y.mul(3.7)).sub(uTime.mul(0.6))));
  const laceNew = smoothstep(0.05, 0.55, laceN.add(sin(lq.x.mul(0.7).sub(lq.y.mul(0.5))).mul(0.3)).add(laceW.z.mul(0.5))).mul(0.35);
  const laceOld = smoothstep(-0.05, 0.45, sin(vRest.x.mul(4.1).add(vRest.y.mul(2.3)).add(uTime.mul(0.9))).mul(sin(vRest.x.mul(1.9).sub(vRest.y.mul(3.7)).sub(uTime.mul(0.6))))
    .add(sin(vRest.x.mul(0.7).sub(vRest.y.mul(0.5))).mul(0.3))).mul(0.55);
  const lace = mix(laceOld, laceNew, laceNear);
  const rim = float(1).sub(smoothstep(0, 0.4, s));
  const shoreFoam = clamp(band.mul(max(rim, max(swash.mul(0.9), lace))).mul(clamp(vHs.div(0.12), 0.15, 1)), 0, 1);
  // the wake's foam strip as the eye sees it (wake.js foamVisible): solid white at the transom, lanes along the track
  // by 20 m, specks by 40 m; the water's own small slopes gather it a little. The bow wave's roll is crisp (0.85)
  const churn = smoothstep(0.01, 0.12, vlen(vec2(sx, sz)));
  const wakeVis = wake ? max(min(wake.foamVisible(vRest, wakeFoam, uTime, churn), 0.95), min(armFoam, 0.85)) : float(0);
  // whitecaps: where the crest folds (A's Jacobian `breaking`, as frequent as Monahan's law says); B's hook shapes it
  // (wind-cues.js whitecapAt: crest-aligned cells, wave groups, a lace falloff, translucent)
  const swell = clamp(eta.div(max(vHs, 0.03)), 0, 1);
  const caps = windLook ? windLook.foam({ rest: vRest, wv, localU, crest: breaking, time: uTime, streak, swell })
    : min(breaking.mul(smoothstep(-0.15, 0.5, sin(vRest.x.mul(2.4).add(vRest.y.mul(0.7)).add(uTime.mul(0.5))).mul(sin(vRest.y.mul(5.0).sub(vRest.x.mul(1.1)).sub(uTime.mul(0.3)))))), 0.55);
  // breakers: the crest's foam where the train reaches 0.42 d, in a cauliflower pattern, a lace behind it
  let breakFoam = float(0);
  if (ultra) {
    const ratio = swF.Au.div(swF.dc.mul(0.42)), cr = sin(swF.ph).mul(0.5).add(0.5);
    const lace = smoothstep(0.5, 1, sin(swF.ph.sub(1.2)).mul(0.5).add(0.5)).mul(0.5);
    const base = smoothstep(0.55, 1, ratio).mul(swF.reach).mul(max(pow(cr, 3), lace)).mul(1.3);
    breakFoam = gated(base.greaterThan(0.003), () => {
      const pat = mx_worley_noise_float(vec3(vRest.mul(1.3), uTime.mul(0.25))).mul(-1).add(1).mul(0.6).add(mx_fractal_noise_float(vec3(vRest.mul(0.6), uTime.mul(0.1)), 3).mul(0.5).add(0.4));
      return clamp(base.mul(smoothstep(0.25, 0.7, pat).mul(0.6).add(0.4)), 0, 0.95);
    });
  }
  // billow foam (Ultra): the whitecaps' coverage carries a cauliflower pattern, dense in the Jacobian's trough and thinning to lace
  // as the turbulence recovers (the sim's own foam age)
  let capsU = caps;
  if (ultra) {
    capsU = gated(caps.greaterThan(0.003), () => {
      const bil = mx_worley_noise_float(vec3(vRest.mul(2.1), uTime.mul(0.3))).mul(-1).add(1).mul(0.55).add(mx_fractal_noise_float(vec3(vRest.mul(0.9), uTime.mul(0.15)), 3).mul(0.45).add(0.35));
      return caps.mul(mix(float(0.5), float(1.15), smoothstep(0.2, 0.75, bil))).mul(mix(float(0.7), float(1), smoothstep(0.6, 0.1, jacU)));
    });
  }
  const foam0 = max(max(shoreFoam, breakFoam), max(wakeVis, capsU));
  const foam = fs.run('foam', 'add', foam0, fx);   // the features' foam: the birds' marks
  // foam is bright diffuse white: albedo ≈ 0.9 under the same light the water body gets (the sky tint, which D2
  // scales by the light level, plus the sky model's transmitted sun), so it reads sun-lit cream by day and dims at
  // dusk with the exposure; the old sky-tint mix read as grey paper (integrator, 2026-10-29)
  // shaded a little by the surface's normal against the sun, so a foam patch is not a flat cut-out
  const foamShade = max(dot(n, uSun), 0).mul(0.25).add(0.8);
  const foamCol = uHorizon.mul(1.05).add(sunLight.mul(max(uSun.y, 0)).mul(0.7)).mul(foamShade);

  // L1: the water body, seen down through clear water. The view refracts at the surface (n = 1.333), reaches the bed
  // at the refracted point (depth re-read there), and comes back absorbed per channel; the light going down travels
  // the sun's refracted path. Over sand in a few metres it reads turquoise; past ~12 m the bed fades into the
  // backscatter's dark cobalt (water-spectrum.js WATER_K / WATER_B: Secchi 19 m).
  const tr = refract(v.negate(), n, 1 / 1.333);
  const d0 = blendMap(depthTex.tex, depthOuter.tex, vWorld.xz);
  const tDown = max(tr.y.negate(), 0.05);
  const bedXZ0 = vWorld.xz.add(tr.xz.mul(d0.div(tDown)));
  const dBed = blendMap(depthTex.tex, depthOuter.tex, bedXZ0);                     // one fixed-point step on the bed's depth
  const bedXZ = vWorld.xz.add(tr.xz.mul(dBed.div(tDown)));
  const sunDownY = sqrt(max(float(1).sub(float(1).sub(uSun.y.mul(uSun.y)).div(1.333 * 1.333)), 0.01));   // refracted sun
  const path = dBed.div(tDown).add(dBed.div(sunDownY));
  const K = vec3(...WATER_K), Bk = vec3(...WATER_B);
  const T = exp(K.mul(path).negate());
  const Rinf = Bk.div(K.mul(2));
  // the bed: pale sand with granite boulders (Worley cells) and a slow tonal drift; ripple caustics in the shallows
  const cell = mx_worley_noise_float(vec3(bedXZ.mul(0.55), 0));
  const boulder = smoothstep(0.25, 0.12, cell).mul(smoothstep(0.35, 0.65, mx_fractal_noise_float(vec3(bedXZ.mul(0.03), 1.7), 3)));
  const drift = mx_fractal_noise_float(vec3(bedXZ.mul(0.12), 4.1), 3).mul(0.12).add(1);
  const albedo = mix(vec3(...bed.sand), vec3(...bed.granite), boulder).mul(drift);
  const caustic = smoothstep(0.55, 0.95, sin(bedXZ.x.mul(2.3).add(sx.mul(30)).add(uTime.mul(1.1))).mul(sin(bedXZ.y.mul(2.1).add(sz.mul(30)).sub(uTime.mul(0.9)))).add(0.5))
    .mul(float(1).sub(smoothstep(1, 6, dBed))).mul(0.5).add(1);
  // caustics, analytic: the refracted rays land at x + 0.25 D grad h, so the light's density is 1 / det(I + 0.25 D H) with H
  // the Hessian of the fine cascades (finite differences of their slope maps); bright where the map folds
  let causticU = float(1);
  if (ultra) {
    // only in clear shallows near the camera with the sun up: 4 x 2 slope taps, nothing in deep or far water
    const open = dBed.lessThan(8).and(dist.lessThan(30)).and(uSun.y.greaterThan(0.02));
    const dens = gated(open, () => {
      const e = 0.035, off = [vec2(e, 0), vec2(0, e)], warpB = warpOf(bedXZ);   // one warp for the bed point: the taps are 3.5 cm apart
      const sl = (q) => { let a = vec2(0); for (const c of [2, 3]) { const t = slopeN.sample(q.add(warpB).div(ULEN[c])).depth(int(c)).level(float(0)); a = a.add(vec2(t.x, t.y).mul(uDamp[2])); } return a.mul(uLive); };
      const a1 = sl(bedXZ.add(off[0])), a2 = sl(bedXZ.sub(off[0])), b1 = sl(bedXZ.add(off[1])), b2 = sl(bedXZ.sub(off[1]));
      const kd = dBed.mul(0.25 / (2 * e)), hxx = a1.x.sub(a2.x).mul(kd), hzz = b1.y.sub(b2.y).mul(kd), hxz = b1.x.sub(b2.x).add(a1.y).sub(a2.y).mul(kd.mul(0.5));
      const det = float(1).add(hxx).mul(float(1).add(hzz)).sub(hxz.mul(hxz));
      return clamp(float(0.8).div(max(det.abs(), 0.2)), 0.35, 4).sub(1);
    });
    causticU = float(1).add(dens.mul(0.9).mul(float(1).sub(smoothstep(1.5, 8, dBed))).mul(smoothstep(0, 0.4, dBed)).mul(smoothstep(0.02, 0.25, uSun.y)).mul(float(1).sub(smoothstep(6, 30, dist))));
  }
  const E = uHorizon.mul(0.9).add(sunLight.mul(max(uSun.y, 0)).mul(0.08)).mul(bodyGain);   // light entering the water
  const bodyL1 = E.mul(albedo.mul(ultra ? causticU : caustic).mul(T).add(Rinf.mul(float(1).sub(T))));
  // the features' body: near the camera, the clear bed (granite, caustics, the boat's shadow); far off, L1 as it was
  Object.assign(fx, { view: v, dBed, tDown, sun: uSun, E, sx, sz, sigma2, K, Bk });
  // S5: the water's colour by depth: a turquoise shelf over the pale sand, v2's navy deep body (WATER_LOOK; the
  // deep tint follows the sun, deepTintAt)
  const bodyTint = colour ? mix(vec3(...colour.shelf), uDeep, smoothstep(float(colour.shelfM), float(colour.deepM), dBed)) : vec3(1);
  const bodyCol = fs.run('body', 'colour', bodyL1, fx).mul(bodyTint).mul(mix(vec3(1), vec3(...GUST_LOOK.body), gustW));
  // the body keeps its no-gust weight (1 − fres0): the mirror light a gust removes is absorbed, not added to the body,
  // so a patch is darker in every light (with 1 − fres the over-lit dusk body showed through as a pale blue patch)
  const body = bodyCol.mul(float(1).sub(fres0));
  // crest translucency (Sea of Thieves' peak mask; Crest's SSS): sunlight through the top of a wave reaches the eye
  // after a short path, so crests glow the water's transmitted green-blue, most when seen against the sun. Height
  // against the local Hs (the crest's thinness), the sun's strength, exp(−K·1.5 m) for the colour.
  const crest = smoothstep(-0.1, 1.0, eta.div(max(vHs, 0.03)));
  const forward = pow(max(dot(v, uSun).negate(), 0), 2);   // looking toward the sun through the crest
  const sssCol = vec3(Math.exp(-WATER_K[0] * 1.5), Math.exp(-WATER_K[1] * 1.5), Math.exp(-WATER_K[2] * 1.5));
  // Ultra's crest glow: thin, folding crests (the Jacobian under 1) glow more against the sun
  const thin = ultra ? float(1).add(smoothstep(0.95, 0.45, jacU).mul(2.2)) : float(1);
  const sss = sunLight.mul(sssCol).mul(crest).mul(thin).mul(forward.mul(0.7).add(0.3)).mul(max(uSun.y, 0)).mul(0.012 * bodyGain).mul(float(1).sub(fres0));
  const lit = mix(body.add(sss).add(skyRefl.mul(fres)).add(glint), foamCol, foam);   // foam < 1 is the translucent lace
  const debugOut = debug === 'wake' && wakeDebug ? wakeDebug
    : debug === 'foam' ? vec3(breaking, caps, jac.sub(0.6).mul(2))   // r = breaking, g = whitecap coverage, b = (J − 0.6) × 2
    : debug === 'look' ? vec3(0, L.streak.mul(0.5).add(0.5).mul(L.inside), L.inside.mul(0.3))   // the look map: g = lanes, b = inside
    : debug === 'windedge' ? vec3(wEdge, localU.div(12), 0)   // r = the wind texture's weight (0 = the mean past its edge)
    : debug === 'mtf' ? vec3(modulate.mul(0.4), crest.mul(0.5), 0)      // r = ripple modulation × 0.4, g = crest mask × 0.5
    : debug === 'sigma' ? vec3(sqrt(sigma2).mul(4), mask, fres)        // r = 4 × rms slope, g = mask, b = Fresnel
    : debug === 'depth' ? vec3(dBed.div(20), d0.div(60), T.y)   // r = bed depth / 20 m, g = depth / 60 m, b = green transmission
    : debug === 'wind' ? vec3(localU.div(12), rip.div(3), gustW)                   // r = local wind / 12 m/s, b = gust look
    : debug === 'slope' && slopeDebug ? slopeDebug
    : debug === 'streak' ? vec3(max(streak, 0), caps, laneVis.mul(0.3))             // r = wind lane (as drawn), g = whitecap, b = the lanes' visibility
    : debug === 'gust' ? vec3(gustW.mul(0.02), clamp(gRatio.sub(0.6), 0, 1).mul(0.02), 0)   // r = gust look, g = local / mean − 0.6 (×0.02: under AgX)
      : debug === 'fetch' ? vec3(texture(fetchTex.tex, mapUV(vRest)).r.div(3000), shoreD.negate().div(60), 0)   // r = fetch / 3 km
        : null;

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.positionNode = vec3(positionGeometry.x.add(dx), h, positionGeometry.z.add(dz));
  mat.colorNode = Fn(() => {
    If(shoreD.greaterThan(0), () => { Discard(); });   // land (its mesh covers the shoreline from above)
    return debugOut ?? lit;
  })();
  // for reflections(): normal x, z; the reflection weight; a water flag; the sky the water reflected; its roughness
  mat.mrtNode = mrt({
    // churned wake water scatters the mirror: the trace's reflection of the hull broke into tan blocks there
    // only the foam itself hides the mirror: the slick behind it reflects MORE (calmer water), which is how a real
    // wake track reads (integrator, 2026-10-29); the old term killed the reflection over the whole trail
    water: vec4(n.x, n.z, fres.mul(float(1).sub(foam)).mul(float(1).sub(smoothstep(0.3, 0.9, wakeFoam))), 1),
    waterSky: vec4(skyRefl, fs.run('sky', 'trace', sqrt(sigma2), fx)),   // the features' trace: a gust patch's ripples break the traced mirror too
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  // the reflection probe's captures (src/water-probe.js): the load's, the warm-ups, the re-captures as the sun moves
  const { prepare, captureProbe: captureAt, warmProbe, probeUpdater: makeUpdater } = createProbeCapture({ probe, mesh, atmosphere, position: uProbe,
    setTexture: (t) => { probeNode.value = t; for (const n of probeSunNodes) n.value = t; } });
  // M6: the probe follows the camera (lake-ready: open water anywhere sees open sky low down, not the bay's walls). The load's
  // capture stands over the camera; on a live page a re-capture starts once the camera is mirror.followM from it (the
  // updater's own frame-spread capture, which moves the probe when the new one goes live). ?wmirror=0: the fixed probe.
  let probeJob = null;
  const captureProbe = (renderer, scene, camera = null, o = {}) => captureAt(renderer, scene, camera, mirror && probe && camera ? { ...o, at: [camera.position.x, camera.position.z] } : o);
  const probeUpdater = (...a) => (probeJob = makeUpdater(...a));
  const followProbe = (camera) => {
    if (!mirror || !probeJob || probeJob.busy || !camera || typeof location === 'undefined' || FLAGS.headless != null) return;
    if (Math.hypot(camera.position.x - uProbe.value.x, camera.position.z - uProbe.value.z) > mirror.followM) probeJob.start([camera.position.x, camera.position.z]);
  };

  function update(t, camera) {
    uTime.value = t;
    fs.update(t, { sun: uSun.value });   // the features' frame (the clear bed: the boat's shadow)
    uU.value = meanWind();
    if (ultra) {
      const hsAt = (F) => Math.min(Math.sqrt(F / G) * uU.value * 0.0016, uU.value * uU.value * 0.21 / G);
      uHsRef.value = hsAt(25000);
      uHsLawB.value = hsAt((ultra.FB ?? 1) * 1000);   // the bay sim's own spectrum's Hs: a point's size against it is sB
      uSwellHs.value = uHsRef.value * MOUTH.swell * Math.min(1, Math.max(0, (uU.value - 9) / 6));   // none under 9 m/s, full from 15 m/s (a rough day)   // the sim runs at the open lake's wave height; each point scales it (mulOf)
      ultra.update(t, { speed: uU.value, dirDeg: (() => { const [wx, wz] = downwind(meanDir()); return Math.atan2(wz, wx) * 180 / Math.PI; })(), fetchKm: 25, focus: [camera.position.x, camera.position.z], hs: uHsRef.value * HS_GAIN, hsB: hsAt((ultra.FB ?? 1) * 1000) * HS_GAIN, cover: Math.max(1e-4, 3.84e-6 * Math.pow(Math.max(uU.value, 0), 3.41)) });
      uJac0.value = ultra.stats.jac0;
    }
    setDirection(meanDir());
    { const [dx, dz] = downwind(meanDir()); uWindMean.value.set(dx * uU.value, dz * uU.value); }
    setFetch(meanDir());
    uCam.value.set(camera.position.x, camera.position.z);
    mesh.position.set(camera.position.x, 0, camera.position.z);
    const hPx = camera.userData.heightPx ?? 720;
    uPix.value = 2 * Math.tan(camera.fov * Math.PI / 360) / hPx;
    // the wind texture follows the camera, snapped to 512 m (T1's lee cache is keyed by the centre)
    const wcx = Math.round(camera.position.x / 512) * 512, wcz = Math.round(camera.position.z / 512) * 512;
    // the texture is filled by a worker (src/wind-texture.js): its result for this very frame (the
    // same bits) when it has one; while time moves, its latest (a frame or two old, its own centre); else in place
    const state = filler ? windState(wind, t) : null, key = filler ? `${JSON.stringify(state)}|${wcx}|${wcz}` : null;
    const r = filler?.latest, moving = t !== lastT; lastT = t;
    if (r && (r.key === key || (moving && hasTexture && api.windLag))) {
      if (r !== applied) { windData.set(r.wind); windMean.data.set(r.mean); windTex.needsUpdate = windMean.tex.needsUpdate = true; uWindCentre.value.set(r.cx, r.cz); applied = r; }
    } else {
      uWindCentre.value.set(wcx, wcz);
      fillWindTexture(wind, t, wcx, wcz, own);
      windMean.data.set(own.mean); windTex.needsUpdate = windMean.tex.needsUpdate = true; applied = null;
    }
    hasTexture = true;
    if (filler && !filler.busy && filler.latest?.key !== key) filler.request(key, state, wcx, wcz);
  }

  // the MRT the scene pass needs: other materials write zeros (no reflection)
  const passMRT = () => mrt({ output, water: vec4(0), waterSky: vec4(0) });

  // the ridges in the water and the clouds in it (src/water-reflect.js)
  const reflections = (scenePass, o = {}) => ssrReflections(scenePass, { ...o, hazeM, debug });

  // the wet line for the terrain material: wet sand from the waterline to 2 m inland, a crisp edge by 3 m (where
  // the swash last reached); 0 on the lake
  const wetness = (posWorld) => {
    const d = blendMap(shoreMap.tex, shoreOuter.tex, posWorld.xz);
    return smoothstep(-0.5, 0, d).mul(float(1).sub(smoothstep(2, 3, d)));
  };

  // D2 (time of day, src/daylight.js): THE one per-frame entry. dir: unit vector toward the sun (world); light: the
  // level of the hand-set tints (1 by day, as built; lower at dusk, src/timeOfDay.js lightAt); sunIntensity: the
  // uniform sun's strength (24 × lum × max(0, sin elevation); only the no-atmosphere path and skyNode() use it).
  // The tints scale from the values the water was built with. The glint's light already follows the sky model.
  const tintBase = { horizon: uHorizon.value.clone(), zenith: uZenith.value.clone(), sun: new THREE.Color(...sun.color) };
  function setSun(dir, { light = null, sunIntensity = null } = {}) {
    if (dir) uSun.value.set(dir.x, dir.y, dir.z).normalize();
    if (light != null) {
      uHorizon.value.copy(tintBase.horizon).multiplyScalar(light);
      uZenith.value.copy(tintBase.zenith).multiplyScalar(light);
    }
    if (sunIntensity != null) uSunCol.value.copy(tintBase.sun).multiplyScalar(sunIntensity);
  }
  mesh.userData.daylight = (f) => {
    setSun(f.sunDir ?? f.sun, { light: f.light, sunIntensity: f.waterSunIntensity });
    // the starlit night: the near water mirrors the night sky as in a long exposure; 0.02 by day
    const e = f.elevDeg ?? 90, k = Math.min(1, Math.max(0, (-6 - e) / 8));
    uF0.value = 0.02 + (f.starlit ? NIGHT_F0 * k * k * (3 - 2 * k) : 0);
    // M6: the twilight mirror, 0 with the sun over mirror.highDeg, 1 under mirror.lowDeg (smooth)
    uTwi.value = twilightWeight(e, mirror);
    uDeep.value.set(...deepTintAt(e, colour));
    uCloudCov.value = deckCover?.value ?? 0;
  };

  mesh.userData.daylightProbe = probeUpdater;   // src/daylight.js collect() finds the probe here

  // the sky the water reflects, for a matching background: sky(dirNode) → colour node
  const skyNode = (dir) => {
    const y = clamp(dir.y, 0, 1);
    const base = mix(uHorizon, uZenith, pow(y, 0.45));
    const glow = uSunCol.mul(pow(max(dot(dir, uSun), 0), 300).mul(0.6).add(pow(max(dot(dir, uSun), 0), 8).mul(0.04)));
    return base.add(glow);
  };

  // World streaming: the wind texture's terrain cache built in the stream's workers (src/water-stream.js)
  const attachStream = (stream, run) => attachWindStream(wind, stream, run);

  // the frame's look map pass (src/water-look.js) after the wind texture is filled; renderer: optional (node tests)
  function updateAll(t, camera, renderer = null) {
    update(t, camera);
    followProbe(camera);
    if (renderer && lookMap) lookMap.update(renderer, t, camera, uU.value, downwind(meanDir()));
  }

  // windLag: a moving clock may use the worker's latest texture (live pages; tools/probe_stream.mjs); captures
  // (?headless) take only the exact frame's, so a capture never differs
  const api = {
    windLag: !(typeof location !== 'undefined' && FLAGS.headless != null),
    attachStream,
    look: lookMap,   // the look map (src/water-look.js): its targets for the probes (tools/probe_look.mjs)
    // M6: the cloud deck's coverage uniform (src/core/world.js, once the clouds exist): the twilight mirror holds the deck's mean
    setCloudDeck: (cov) => { deckCover = cov ?? null; },
    mesh, update: updateAll, passMRT, reflections, cloudReflections, prepare, captureProbe, warmProbe, wetness, skyNode, waveAt, fetchAt, setSun, probeUpdater,
    shoreDistanceNode: (posWorld) => blendMap(shoreMap.tex, shoreOuter.tex, posWorld.xz),   // m to the shore, negative on the lake (the ground's beaches)
    get surface() { return ultra ? ultraSurface : getSurface(); },
    // the waves' orbital velocity at a point (m/s, { vx, vz }): the physics takes it as a current (the boat is carried round the orbit); classic: none
    orbitAt: (x, z, t, o = {}) => { if (!ultra) return { vx: 0, vz: 0 }; const v = ultra.velocityAt(x, z, t, { filterM: o.filterM ?? 0, depthM: o.depthM ?? 0, depth: depthAt(x, z), m: Math.min(1.5, hsCpu(x, z) / Math.max(uHsRef.value, 1e-3)), bay: hasB ? bayCpu(x, z) : null, feel: hasB ? bayCpu(x, z).feel : FEEL.lake }); return { vx: v[0], vz: v[1] }; },
    ultra, features: fs,
    get clarity() { return fs.get('clarity')?.api ?? null; },   // the clear bed's (src/waters/clarity.js): track(() => pose)
    uniforms: { uTime, uU, uSun, uSunCol, uHorizon, uZenith }, windTexture: windTex, shoreTexture: shoreMap.tex,
  };
  return api;
}
