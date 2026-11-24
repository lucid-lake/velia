// The sky: a physically based atmosphere in WGSL, after Hillaire 2020 ("A Scalable and Production Ready Sky and
// Atmosphere Rendering Technique", EGSR 2020) with Bruneton's transmittance parametrisation (Bruneton & Neyret 2008,
// "Precomputed Atmospheric Scattering"). Written from the papers; no code was ported. Three LUTs:
//   transmittance  256 × 64   rgba16float   baked once at load (the planet never changes): T(r, μ) to the top of the air
//   multi-scatter   32 × 32   rgba16float   baked once at load: Ψ_ms(r, μ_s), the isotropic 2nd-and-higher order term
//   sky-view       256 × 128  rgba16float   re-baked every frame (one compute dispatch, 32 steps a texel, ≈ 0.05 ms):
//                                            the sky's radiance over every direction from the camera's height, for
//                                            this frame's sun; azimuth around, a sqrt-warped elevation that packs the
//                                            texels at the horizon
// Units: km, sun illuminance 1 at the top of the atmosphere; the scene scale multiplies by F.sky.x (SUN.illuminance),
// chosen so a noon zenith is about 1 in HDR (the tonemap's convention). The planet: Rg 6360 km, Rt 6460 km; Rayleigh
// (5.802, 13.558, 33.1)e-3 /km at 8 km scale height; Mie 3.996e-3 scattering + 4.4e-3 absorption at 1.2 km, g 0.8;
// ozone (0.650, 1.881, 0.085)e-3 /km in a tent 25 ± 15 km; ground albedo 0.1 (a lake). The camera stands on the lake,
// 1.897 km above the sea (Tahoe) plus its eye height. Night (M5e): the airglow sky, the light domes and the moon's glow
// (NIGHT_SKY_WGSL, in every sky reader), the Milky Way and the moon's disc in the sky draw, the stars their own draw
// (render/night.js); F.sky.y (the old flat floor) is kept at 0 in the record.
// The pure mappings (transmittanceUV, skyViewV, horizonElev) are mirrored in JS for the tests (sky-lut.test.mjs).
import { wgslStruct } from '../engine/uniforms.js';
import { EXPOSURE } from '../sim/exposure.js';
// #18 r2: v1's valley mist (src/sim/core/params.js FOG_A, FOG_B: per m at the water, scale height m), copied (that module
// pulls v1's flags in); v2/tests/storm.test.mjs holds them equal
// fix(v2) frame look: the clear sky's share of the storm's mist at its full dark (fitted at cam E under the cell)
export const STORM_SKY = 0.6;
// the v1 grade (2026-11-18): the storm deck drawn toward one soft overcast grey under the storm's dark: near the zenith, at the
// horizon, the band (sin of the elevation) between them, the grey's gain over the storm mist; lod: the key's blur (mip level)
// v1's approach (owner, 2026-11-18: "go with the plan, v1's way"): the overcast on the sky above the horizon only; the land, the
// water and everything on it take one veil, v1's height fog (stormFog), and the frame's grade (render/shaders.js stormGrade).
// The round-1/2 ridge cap and rain murk are gone (they washed the near water milky, flattened the ridges, left the boats unveiled)
export const STORM_OVERCAST = Object.freeze({ near: 0.45, far: 0.75, band: 0.3, gain: 1.6, lod: 2.0 });
// the sky and the mountains to v1's (2026-11-18: "darken the sky and the mountains"): under the cell the storm sky is a dark, heavy
// deck: the overcast's grey (the storm mist x zen at the zenith, x hor at the horizon), cover of the way at the cell's core, the
// key's own light (its sunlit white clumps) cut by cloudK there; lighter past the cell's edge (its mask along the view at the deck,
// v1's cellMask) and in the clearing's gold. The ridges: land above the deck's base is inside the cloud (base: DECK.base m over the
// lake, the band m of ragged edge below it, k the most it hides), drawn in the deck's grey at that height
export const STORM_DECK = Object.freeze({ zen: 0.4, hor: 1.0, cover: 0.9, cloudK: 0.85, deckM: 900, eyeK: 0.8, ridge: Object.freeze({ base: DECK.base, band: 260, k: 0.92 }) });
export const STORM_FOG = Object.freeze({ a: 0.00015, b: 20, gain: 22, mistK: 0.35 });
const FOG_A = STORM_FOG.a, FOG_B = STORM_FOG.b;
import { CLOUD_READ, KEY_ANISO } from './cloud-read.js';
import { DECK } from '../sim/clouds.js';
import { NIGHT, LIGHT_DOMES } from '../sim/night.js';
import { NIGHT_READ } from './night-read.js';
import { POLAR_WGSL } from './grade.js';

export const ATMO = Object.freeze({ Rg: 6360, Rt: 6460, rayleigh: [5.802e-3, 13.558e-3, 33.1e-3], rayleighH: 8, mie: 3.996e-3, mieAbs: 4.4e-3, mieH: 1.2, mieG: 0.8,
  ozone: [0.650e-3, 1.881e-3, 0.085e-3], ozoneCentre: 25, ozoneWidth: 15, albedo: 0.1 });
export const LUT = Object.freeze({ trans: [256, 64], ms: [32, 32], view: [256, 128], transSteps: 40, msSteps: 20, msDirs: 8, viewSteps: 32, format: 'rgba16float' });
// the aerial-perspective froxels (M2): 32 × 32 screen tiles × 32 depth slices, the slices quadratic in distance out to
// 64 km (the first at 62 m, the last at the ring's far edge); in-scattered light (scene scale) and the transmittance
export const AP = Object.freeze({ size: 32, slices: 32, maxKm: 64, substeps: 4 });
// fix(v2) terrain shadow: the frame's light record (the aerial pass writes it once a frame; every scene shader reads it):
// the sky's irradiance on level ground (four 45° samples × π), the sun's at the camera, and the sky's irradiance on any
// normal as L1 harmonics per channel (skyIrrN). Readers that need only the first two may declare the short struct.
export const SKY_SH = Object.freeze({ bands: 8, az: 8 });   // 64 samples: one a thread of the aerial pass's 8 × 8 workgroup
export const LIGHT_STRUCT = 'struct Light { sky: vec4f, sun: vec4f, irrR: vec4f, irrG: vec4f, irrB: vec4f }';
export const LIGHT_BYTES = 80;
// the sky's share on the land against v1's (a local match, as render/towns.js LOOK.sky): the terrain's faces, the boulders and
// the forest's cards take (skyIrrN(n) + LIGHT.sky × the tilt) × this, drawn desat of the way to its grey. v1 lights its land
// with both sky terms (the atmosphere light's irradiance and the sky's environment diffuse; its trees a grey-blue hemisphere);
// v2 had the tilted level sky alone, a deep blue a fifth of v1's on green needles, so every face out of the sun read black
// (the owner, 2026-11-14). Fitted at 18:30 from the bay (the NW shore in the ridge's shadow, v1 7,26,29 and 8,25,31): the
// cards × 1.5 (v1's tree hemisphere is brighter than its sky), the ground × 1 (v1's ground keeps its skyline's occlusion)
export const LAND_SKY = Object.freeze({ terrain: 1.1, forest: 0.75, desat: 0.6, nightDeg: [-6, 2] });
// the JS mirror of the aerial pass's projection (skyIrradianceSH) and of skyIrrN, for the tests: rad(d) → [r, g, b]
export function skySH(rad, S = SKY_SH) {
  const dw = 4 * Math.PI / (S.bands * S.az), a = [0, 0, 0], b = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < S.az; j++) {
    const ph = (j + 0.5) * 2 * Math.PI / S.az, cx = Math.cos(ph), cz = Math.sin(ph);
    const hl = Math.hypot(cx, 0.03, cz), hz = rad([cx / hl, 0.03 / hl, cz / hl]);
    for (let i = 0; i < S.bands; i++) {
      const y = 1 - (i + 0.5) * 2 / S.bands, r = Math.sqrt(Math.max(1 - y * y, 0)), d = [cx * r, y, cz * r];
      const L = y > 0.03 ? rad(d) : hz;
      for (let c = 0; c < 3; c++) { a[c] += L[c]; for (let k = 0; k < 3; k++) b[k][c] += L[c] * d[k]; }
    }
  }
  return { a: a.map((v) => v * dw * 0.25), b: b.map((v) => v.map((x) => x * dw * 0.5)) };
}
export const skyIrrN = (sh, n) => [0, 1, 2].map((c) => Math.max(0, sh.a[c] + sh.b[0][c] * n[0] + sh.b[1][c] * n[1] + sh.b[2][c] * n[2]));
// fix(v2) mountains: v1's far look on the land (src/core/farLook.js FAR_LOOK, S3 + S4; src/terrain-mesh.js
// depthTint, src/core/post.js): the aerial haze kept at hazeK on the land with v1's thin valley mist (mistK, mistGain) in its
// place; the ground's depth tint (within tint.near m a little darker and richer, past tint.far toward a deep blue slate);
// the far ground darker by albedoK; the spring snow line (2,500 m, the ground's paint only: the trees keep the day's 3,000)
export const LAND_LOOK = Object.freeze({
  hazeK: 0.15, mistK: 0.35, mistGain: 2,
  tint: { near: [600, 2200], far: [2500, 14000], farK: 0.55, rich: 1.5, value: 0.85 },
  slate: [0.0252, 0.0612, 0.1274],        // the ground's far colour (an albedo; v1 FAR_LOOK.slate 0x2c4664, linear)
  treeFar: [0.0908, 0.1413, 0.1946],      // the trees' far colour (a radiance × the day's light; v1 uFar 0x55697a)
  // T3: the forest's own far tint (the cards and the terrain's canopy: depthTintTree): sooner and stronger than
  // the ground's, toward a lighter blue-green, so a far forested slope melts into the air instead of standing dark
  treeHaze: { far: [1500, 11000], farK: 0.7, colour: [0.105, 0.158, 0.172] },
  albedoK: 0.35, albedoNear: 6000, albedoFar: 18000,
  // (owner, 2026-11-19: "warmer, more saturated far rock"): the far crest's bare ground (never its snow), seen
  // through the air, takes a violet-blue filter (× tint, after the air: the valley mist had greyed any albedo change away), so the
  // rock reads as the wallpaper's (L 39, C 27, h 270; ours was a light grey L 48, C 12, h 249) and stands a little further under
  // the horizon sky; full past far[1] m, by day only (the sun over 0–6°: the twilight and the night keep their look)
  farRock: { tint: [0.6, 0.76, 1.0], far: [4000, 16000], dayDeg: [0, 6] },
  snowLine: 2500, snowNoise: [70, 25], snowSlope: [0.32, 0.5],
  cavitySky: 0.8,      // the sky's share by the bake's cavity (−1 gully … +1 ridge): v1's skyline occlusion on the ground
  rough: 0.9,          // the ground's roughness for its specular (v1's layers 0.8–1, MeshStandardMaterial)
});
export const SUN = Object.freeze({ illuminance: 18, discDeg: 0.2665, discCos: Math.cos(0.2665 * Math.PI / 180), lakeAltKm: 1.897 });

// --- the JS mirrors of the LUT parametrisations (the WGSL below is the same text in WGSL) ---
export function transmittanceUV(r, mu, { Rg, Rt } = ATMO) {
  const H = Math.sqrt(Rt * Rt - Rg * Rg), rho = Math.sqrt(Math.max(r * r - Rg * Rg, 0));
  const d = Math.max(0, -r * mu + Math.sqrt(Math.max(r * r * (mu * mu - 1) + Rt * Rt, 0)));
  const dmin = Rt - r, dmax = rho + H;
  return [(d - dmin) / (dmax - dmin), rho / H];
}
export function uvToRMu(u, v, { Rg, Rt } = ATMO) {
  const H = Math.sqrt(Rt * Rt - Rg * Rg), rho = H * v, r = Math.sqrt(rho * rho + Rg * Rg);
  const dmin = Rt - r, dmax = rho + H, d = dmin + u * (dmax - dmin);
  const mu = d > 0 ? Math.max(-1, Math.min(1, (H * H - rho * rho - d * d) / (2 * r * d))) : 1;
  return [r, mu];
}
export const horizonElev = (r, { Rg } = ATMO) => -Math.acos(Math.min(1, Rg / r));   // the true horizon's elevation (rad, negative)
export function skyViewV(e, eh) {
  if (e > eh) { const s = Math.sqrt((e - eh) / (Math.PI / 2 - eh)); return (1 - s) * 0.5; }
  const s = Math.sqrt((eh - e) / (Math.PI / 2 + eh)); return (1 + s) * 0.5;
}
export function skyViewElev(v, eh) {
  if (v < 0.5) { const s = 1 - 2 * v; return eh + (Math.PI / 2 - eh) * s * s; }
  const s = 2 * v - 1; return eh - (Math.PI / 2 + eh) * s * s;
}
// the night floor from the sun's elevation (deg): 0 by day, 1 below −14° (astronomical dusk is −18°; the LUT still glows to about −10°)
export const nightFloor = (elevDeg) => { const t = Math.min(1, Math.max(0, (-2 - elevDeg) / 12)); return t * t * (3 - 2 * t); };

const [TW, TH] = LUT.trans, [MW, MH] = LUT.ms, [VW, VH] = LUT.view;

// M5e: the night sky's own light, the same text in every shader that reads the sky (SKY_READ, the aerial pass, the
// clouds' key march, the water's mirror bake): v1's starlit night (src/core/milkyway.js): the airglow,
// a thin layer 90 km up seen along the slant path (van Rhijn: 1 at the zenith, 6 at the horizon; its √ as the
// brightness, so the horizon is lighter without a sunset band), deep blue at the zenith and blue-green low down; the
// towns' light domes by the direction's true bearing and height (src/core/milkyway-math.js LIGHT_DOMES); a soft glow
// round the moon on a moonlit night. F.night.x is the airglow's level (0 by day; the moon lifts it), F.night.y the
// domes'. HDR scale: NIGHT.airglow at the zenith. The stars, the Milky Way and the moon's disc are the sky draw's and
// the water mirror's own reads (render/night.js NIGHT_READ), not here: the terrain and the clouds need only the glow
const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
export const NIGHT_SKY_WGSL = `
const AIR_Z = ${v3(NIGHT.airColour)}; const AIR_H = ${v3(NIGHT.airHorizon)}; const DOME_C = ${v3(NIGHT.domeColour)};
const AIRGLOW = ${NIGHT.airglow}; const DOME_K = ${(NIGHT.band * NIGHT.domes).toFixed(4)}; const MOON_HALO = ${NIGHT.moonHalo}; const MOON_SKY = ${NIGHT.moonSky.toFixed(1)};
fn vanRhijn(cosZ: f32) -> f32 { return 1.0 / sqrt(1.0 - 0.9724 * (1.0 - cosZ * cosZ)); }
fn moonShare() -> f32 { return pow(clamp(F.moon.w, 0.0, 1.0), 1.2) * smoothstep(-2.0, 10.0, asin(clamp(F.moon.y, -1.0, 1.0)) * 57.29578); }
// v1's NIGHT_LAND (round 5, 2026-11-07: "land not pure black"): a cool light on the land and the lake's body by night, as an
// irradiance added to the sky's (the terrain, the forest, the boulders, the water's body); 0 by day, × the moon's lift
fn nightLand() -> vec3f { return ${v3(NIGHT.landColour)} * (${NIGHT.landLift} * F.night.x); }
// airK: the airglow's weight. The light the sky casts (the world's sky light, the clouds, the haze) takes all of it; the sky
// as drawn, and as the water mirrors it, takes NIGHT.airSky (nightSkyShown: v1's dark zenith, so the stars and the band read)
fn nightSky(d: vec3f) -> vec3f { return nightSkyK(d, 1.0); }
// fix/v2-night-town-glow: the towns' domes in the drawn sky at NIGHT.domeSky, as the airglow at airSky (both were v1's ratio in the
// light the sky casts; the drawn sky cut only the airglow, so the domes stood 12 × over it and the clear night read orange-brown
// over South Lake Tahoe and Reno up to 30° high): a faint warm glow a few degrees over the towns' bearings
fn nightSkyShown(d: vec3f) -> vec3f { return nightSkyKD(d, ${NIGHT.airSky.toFixed(3)}, ${NIGHT.domeSky.toFixed(3)}); }
fn nightSkyK(d: vec3f, airK: f32) -> vec3f { return nightSkyKD(d, airK, 1.0); }
// the towns' light domes alone (HDR): by the direction's true bearing and height, so they stay low over the towns
fn nightDomes(d: vec3f) -> vec3f {
  // the bearing: atan2(0, 0) is indeterminate in WGSL (straight up, as the clouds' key asks: it gave NaN on Metal), so it is 0 there
  let az = select(atan2(d.x, -d.z) * 57.29578, 0.0, abs(d.x) + abs(d.z) < 1e-6); let alt = max(asin(clamp(d.y, -1.0, 1.0)) * 57.29578, 0.0);
  var dome = 0.0;
${LIGHT_DOMES.map((d) => `  { let da0 = abs(az - ${d.az.toFixed(1)}); let da = min(da0, 360.0 - da0); dome += ${d.a} * exp(-(da / ${d.w.toFixed(1)}) * (da / ${d.w.toFixed(1)})) * exp(-alt / ${d.h.toFixed(1)}); }`).join('\n')}
  return DOME_C * dome * DOME_K * F.night.y * AIRGLOW;
}
// domeK: the domes' weight (the clouds' haze takes NIGHT.cloudDomes of them, at the cloud's own height: render/clouds.js)
fn nightSkyKD(d: vec3f, airK: f32, domeK: f32) -> vec3f {
  let vr = vanRhijn(max(d.y, 0.0));
  let air = mix(AIR_Z, AIR_H, smoothstep(2.5, 5.5, vr)) * sqrt(vr) * (F.night.x * airK);
  // the moon's glow: the airglow's own level without the moon's lift, × the moon's share, a wide and a tight lobe
  let c = max(dot(d, F.moon.xyz), 0.0);
  let halo = AIR_Z * MOON_HALO * moonShare() * F.night.x / (1.0 + MOON_SKY * moonShare()) * (0.1 + pow(c, 24.0) * 2.0 + pow(c, 200.0) * 6.0);
  return (air + halo) * AIRGLOW + nightDomes(d) * domeK;
}`;

export const ATMO_WGSL = `
const PI = 3.14159265359;
const Rg = ${ATMO.Rg.toFixed(1)}; const Rt = ${ATMO.Rt.toFixed(1)};
const RAYLEIGH = vec3f(${ATMO.rayleigh.join(', ')});
const MIE_S = ${ATMO.mie}; const MIE_A = ${ATMO.mieAbs}; const MIE_G = ${ATMO.mieG};
const OZONE = vec3f(${ATMO.ozone.join(', ')});
const ALBEDO = ${ATMO.albedo};
const TW = ${TW}.0; const TH = ${TH}.0; const MW = ${MW}.0; const MH = ${MH}.0; const VW = ${VW}.0; const VH = ${VH}.0;
struct Medium { sR: vec3f, sM: f32, ext: vec3f }
fn medium(r: f32) -> Medium {
  let h = max(r - Rg, 0.0);
  let dR = exp(-h / ${ATMO.rayleighH.toFixed(1)}); let dM = exp(-h / ${ATMO.mieH}); let dO = max(0.0, 1.0 - abs(h - ${ATMO.ozoneCentre.toFixed(1)}) / ${ATMO.ozoneWidth.toFixed(1)});
  var m: Medium; m.sR = RAYLEIGH * dR; m.sM = MIE_S * dM; m.ext = m.sR + vec3f((MIE_S + MIE_A) * dM) + OZONE * dO; return m;
}
// the nearest t >= 0 where the ray meets the sphere of radius R about the origin, or -1
fn raySphere(o: vec3f, d: vec3f, R: f32) -> f32 {
  let b = dot(o, d); let c = dot(o, o) - R * R; let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc); let t0 = -b - s; let t1 = -b + s;
  if (t0 >= 0.0) { return t0; } if (t1 >= 0.0) { return t1; } return -1.0;
}
fn transUV(r: f32, mu: f32) -> vec2f {
  let H = sqrt(Rt * Rt - Rg * Rg); let rho = sqrt(max(r * r - Rg * Rg, 0.0));
  let d = max(0.0, -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + Rt * Rt, 0.0)));
  let dmin = Rt - r; let dmax = rho + H;
  return vec2f((d - dmin) / (dmax - dmin), rho / H);
}
fn uvToRMu(uv: vec2f) -> vec2f {
  let H = sqrt(Rt * Rt - Rg * Rg); let rho = H * uv.y; let r = sqrt(rho * rho + Rg * Rg);
  let dmin = Rt - r; let dmax = rho + H; let d = dmin + uv.x * (dmax - dmin);
  var mu = 1.0; if (d > 0.0) { mu = (H * H - rho * rho - d * d) / (2.0 * r * d); }
  return vec2f(r, clamp(mu, -1.0, 1.0));
}
fn phaseR(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn phaseM(c: f32) -> f32 { let g = MIE_G; let g2 = g * g; return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + c * c) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
fn horizonElev(r: f32) -> f32 { return -acos(min(1.0, Rg / r)); }
fn skyViewV(e: f32, eh: f32) -> f32 {
  if (e > eh) { let s = sqrt((e - eh) / (PI * 0.5 - eh)); return (1.0 - s) * 0.5; }
  let s = sqrt((eh - e) / (PI * 0.5 + eh)); return (1.0 + s) * 0.5;
}
fn skyViewElev(v: f32, eh: f32) -> f32 {
  if (v < 0.5) { let s = 1.0 - 2.0 * v; return eh + (PI * 0.5 - eh) * s * s; }
  let s = 2.0 * v - 1.0; return eh - (PI * 0.5 + eh) * s * s;
}
fn skyViewUV(d: vec3f, eh: f32) -> vec2f {
  let e = asin(clamp(d.y, -1.0, 1.0)); let az = atan2(d.z, d.x);
  return vec2f(az / (2.0 * PI) + 0.5, skyViewV(e, eh));
}`;

// the LUT readers, for any shader that binds (tT, sLin) and, with the view LUT, (tV)
export const TRANS_READ = `
fn transAt(r: f32, mu: f32) -> vec3f {
  var uv = transUV(r, mu);
  uv = (vec2f(0.5) + clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(TW - 1.0, TH - 1.0)) / vec2f(TW, TH);
  return textureSampleLevel(tT, sLin, uv, 0.0).rgb;
}
// the sun's transmittance at p, zero when the planet stands between
fn sunT(p: vec3f, s: vec3f) -> vec3f {
  let r = length(p);
  if (raySphere(p, s, Rg) >= 0.0) { return vec3f(0.0); }
  return transAt(r, dot(p, s) / r);
}`;

export const TRANSMITTANCE_WGSL = `${ATMO_WGSL}
@group(0) @binding(0) var outT: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= ${TW}u || g.y >= ${TH}u) { return; }
  let uv = vec2f(f32(g.x) / (TW - 1.0), f32(g.y) / (TH - 1.0));
  let rm = uvToRMu(uv); let r = rm.x; let mu = rm.y;
  let o = vec3f(0.0, r, 0.0); let d = vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0);
  // to the top of the air: the table's rays never meet the ground (x = 1 is the ray tangent to it, transUV clamps every lower one
  // there and each reader zeroes them with its own planet test). A ground stop here made the tangent column a half path (f32 at
  // the tangent hits the ground or not by rounding): the sun 0.04° over the dip read twice the light, a flash on the boat and the
  // forest as a moving sun set (the day clock, 2026-11-13)
  let tEnd = raySphere(o, d, Rt);
  let ds = max(tEnd, 0.0) / ${LUT.transSteps}.0;
  var od = vec3f(0.0);
  for (var i = 0; i < ${LUT.transSteps}; i++) { let p = o + d * ((f32(i) + 0.5) * ds); od += medium(length(p)).ext * ds; }
  textureStore(outT, vec2i(g.xy), vec4f(exp(-od), 1.0));
}`;

export const MULTISCAT_WGSL = `${ATMO_WGSL}
@group(0) @binding(0) var tT: texture_2d<f32>;
@group(0) @binding(1) var sLin: sampler;
@group(0) @binding(2) var outM: texture_storage_2d<rgba16float, write>;
${TRANS_READ}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= ${MW}u || g.y >= ${MH}u) { return; }
  let u = (f32(g.x) + 0.5) / MW; let v = (f32(g.y) + 0.5) / MH;
  let mus = u * 2.0 - 1.0; let r = clamp(Rg + v * (Rt - Rg), Rg + 0.01, Rt - 0.01);
  let o = vec3f(0.0, r, 0.0); let s = vec3f(sqrt(max(1.0 - mus * mus, 0.0)), mus, 0.0);
  var L2 = vec3f(0.0); var Fm = vec3f(0.0);
  const SQ = ${LUT.msDirs};
  for (var i = 0; i < SQ; i++) { for (var j = 0; j < SQ; j++) {
    let th = PI * (f32(i) + 0.5) / f32(SQ); let ph = 2.0 * PI * (f32(j) + 0.5) / f32(SQ);
    let d = vec3f(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
    let w = sin(th) * (PI / f32(SQ)) * (2.0 * PI / f32(SQ));
    let tTop = raySphere(o, d, Rt); let tG = raySphere(o, d, Rg);
    var tEnd = tTop; if (tG >= 0.0) { tEnd = tG; }
    let ds = max(tEnd, 0.0) / ${LUT.msSteps}.0;
    var T = vec3f(1.0); var l = vec3f(0.0); var f = vec3f(0.0);
    for (var k = 0; k < ${LUT.msSteps}; k++) {
      let p = o + d * ((f32(k) + 0.5) * ds); let m = medium(length(p));
      let sc = m.sR + vec3f(m.sM); let ext = max(m.ext, vec3f(1e-6)); let Ts = exp(-m.ext * ds);
      let S1 = sc * sunT(p, s) / (4.0 * PI);
      l += T * (S1 - S1 * Ts) / ext;
      f += T * (sc - sc * Ts) / ext;
      T *= Ts;
    }
    if (tG >= 0.0) { let pg = o + d * tG; let n = normalize(pg); l += T * ALBEDO / PI * sunT(pg, s) * max(dot(n, s), 0.0); }
    L2 += l * w; Fm += f * w;
  } }
  L2 /= 4.0 * PI; Fm /= 4.0 * PI;
  textureStore(outM, vec2i(g.xy), vec4f(L2 / max(vec3f(1.0) - Fm, vec3f(1e-3)), 1.0));
}`;

const MS_READ = `
fn msAt(r: f32, mus: f32) -> vec3f {
  let uv = vec2f(mus * 0.5 + 0.5, clamp((r - Rg) / (Rt - Rg), 0.0, 1.0));
  return textureSampleLevel(tM, sLin, uv, 0.0).rgb;
}`;

export const SKYVIEW_WGSL = (frameStruct) => `${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
@group(1) @binding(0) var tT: texture_2d<f32>;
@group(1) @binding(1) var tM: texture_2d<f32>;
@group(1) @binding(2) var sLin: sampler;
@group(1) @binding(3) var outV: texture_storage_2d<rgba16float, write>;
${TRANS_READ}${MS_READ}
// M5e: the storm's haze (v1: the fog's density × (1 + 22 × haze), steel grey): extra Mie at the lake, decaying over
// 0.8 km of height, in the marches that have the frame (the sky view and the aerial perspective; the LUT bakes have none)
fn mediumHaze(r: f32) -> Medium { return medium(r); }   // #18 r2: the rain's haze is v1's height fog now (AP_READ stormFog), not extra Mie
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= ${VW}u || g.y >= ${VH}u) { return; }
  let u = (f32(g.x) + 0.5) / VW; let v = (f32(g.y) + 0.5) / VH;
  let rCam = Rg + F.sky.z; let eh = horizonElev(rCam);
  let e = skyViewElev(v, eh); let az = (u - 0.5) * 2.0 * PI;
  let d = vec3f(cos(e) * cos(az), sin(e), cos(e) * sin(az));
  let o = vec3f(0.0, rCam, 0.0); let s = normalize(F.sun.xyz);
  let tTop = raySphere(o, d, Rt); let tG = raySphere(o, d, Rg);
  var tEnd = tTop; if (tG >= 0.0) { tEnd = tG; }
  let ds = max(tEnd, 0.0) / ${LUT.viewSteps}.0;
  let c = dot(d, s); let pR = phaseR(c); let pM = phaseM(c);
  var T = vec3f(1.0); var L = vec3f(0.0);
  for (var k = 0; k < ${LUT.viewSteps}; k++) {
    let p = o + d * ((f32(k) + 0.5) * ds); let rp = length(p); let m = mediumHaze(rp);
    let ext = max(m.ext, vec3f(1e-6)); let Ts = exp(-m.ext * ds);
    let S = (m.sR * pR + vec3f(m.sM * pM)) * sunT(p, s) * F.storm.y + (m.sR + vec3f(m.sM)) * msAt(rp, dot(p, s) / rp);
    L += T * (S - S * Ts) / ext;
    T *= Ts;
  }
  if (tG >= 0.0) { let pg = o + d * tG; let n = normalize(pg); L += T * ALBEDO / PI * sunT(pg, s) * max(dot(n, s), 0.0); }
  textureStore(outV, vec2i(g.xy), vec4f(L, 1.0));
}`;

// The aerial perspective (Hillaire 2020 § 5.4): for each of 32 × 32 view rays through the screen, march the air from
// the eye out through 32 slices and store, per slice, the light scattered toward the eye so far (single scattering of
// the sun with the multi-scattering term, as the sky-view) and the transmittance. Every lit surface (terrain, water)
// then reads both at its screen position and distance: far ridges fade into blue haze the same way the sky is made.
export const AERIAL_WGSL = (frameStruct) => `${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
@group(1) @binding(0) var tT: texture_2d<f32>;
@group(1) @binding(1) var tM: texture_2d<f32>;
@group(1) @binding(2) var sLin: sampler;
@group(1) @binding(3) var outS: texture_storage_3d<rgba16float, write>;
@group(1) @binding(4) var outT: texture_storage_3d<rgba16float, write>;
@group(1) @binding(5) var tV: texture_2d<f32>;
@group(1) @binding(6) var sView: sampler;
${LIGHT_STRUCT}
@group(1) @binding(7) var<storage, read_write> LIGHT: Light;
${TRANS_READ}${MS_READ}
// M5e: the storm's haze (v1: the fog's density × (1 + 22 × haze), steel grey): extra Mie at the lake, decaying over
// 0.8 km of height, in the marches that have the frame (the sky view and the aerial perspective; the LUT bakes have none)
fn mediumHaze(r: f32) -> Medium { return medium(r); }   // #18 r2: the rain's haze is v1's height fog now (AP_READ stormFog), not extra Mie
${NIGHT_SKY_WGSL}
fn skyRad(d: vec3f) -> vec3f { return textureSampleLevel(tV, sView, skyViewUV(d, horizonElev(Rg + F.sky.z)), 0.0).rgb * F.sky.x + nightSkyK(d, ${NIGHT.airLight.toFixed(3)}); }   // look/v2-night-look: the world's sky light takes NIGHT.airLight of the airglow
// fix(v2) terrain shadow: the sky's irradiance on a face of any normal, as v1's environment map gives it (its diffuse:
// the whole sky cube, the bright horizon and the sun's own side included; a ray under the horizon reads the horizon's
// haze, as render/towns.js envAt), projected once a frame onto L1 spherical harmonics: ${SKY_SH.bands} bands of equal solid
// angle × ${SKY_SH.az} azimuths, one sample a thread of the first workgroup (a band under the horizon reads the horizon in
// its azimuth), summed by halves in workgroup memory. E(n) = a + b · n per channel (a = Σ L dω / 4, b = Σ L ω dω / 2: the cosine
// lobe's L1 convolution), so a uniform sky gives π L to every face and nothing to a face turned from a lit upper half.
// The readers (SKY_READ skyIrrN) pay three dot products a pixel.
var<workgroup> shA: array<vec3f, ${SKY_SH.bands * SKY_SH.az}>; var<workgroup> shX: array<vec3f, ${SKY_SH.bands * SKY_SH.az}>;
var<workgroup> shY: array<vec3f, ${SKY_SH.bands * SKY_SH.az}>; var<workgroup> shZ: array<vec3f, ${SKY_SH.bands * SKY_SH.az}>;
fn shDir(k: u32) -> vec3f {
  let i = k % ${SKY_SH.bands}u; let j = k / ${SKY_SH.bands}u;
  let ph = (f32(j) + 0.5) * 2.0 * PI / ${SKY_SH.az}.0; let y = 1.0 - (f32(i) + 0.5) * 2.0 / ${SKY_SH.bands}.0;
  let r = sqrt(max(1.0 - y * y, 0.0));
  return vec3f(cos(ph) * r, y, sin(ph) * r);
}
fn skyIrradianceSH(li: u32) {
  let d = shDir(li);
  var L: vec3f;
  if (d.y > 0.03) { L = skyRad(d); } else { let h = normalize(vec2f(d.x, d.z)); L = skyRad(normalize(vec3f(h.x, 0.03, h.y))); }
  shA[li] = L; shX[li] = L * d.x; shY[li] = L * d.y; shZ[li] = L * d.z;
  // the sums by halves (6 steps for 64)
  for (var h = ${SKY_SH.bands * SKY_SH.az / 2}u; h > 0u; h = h >> 1u) {
    workgroupBarrier();
    if (li < h) { shA[li] += shA[li + h]; shX[li] += shX[li + h]; shY[li] += shY[li + h]; shZ[li] += shZ[li + h]; }
  }
  if (li == 0u) {
    let dw = 4.0 * PI / ${SKY_SH.bands * SKY_SH.az}.0;
    let a = shA[0] * dw * 0.25; let bx = shX[0] * dw * 0.5; let by = shY[0] * dw * 0.5; let bz = shZ[0] * dw * 0.5;
    LIGHT.irrR = vec4f(a.r, bx.r, by.r, bz.r); LIGHT.irrG = vec4f(a.g, bx.g, by.g, bz.g); LIGHT.irrB = vec4f(a.b, bx.b, by.b, bz.b);
  }
}
const APN = ${AP.size}u; const APS = ${AP.slices}u; const APMAX = ${AP.maxKm.toFixed(1)}; const SUB = ${AP.substeps}u;
// M5e: the storm's haze is lit by the sky as a whole (v1's fog colour: a steel grey at 0.62 of the sunlit level), not only by the
// shaded sun: the extra Mie's share of the medium scatters the sky's mean radiance
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u, @builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) li: u32) {
  if (wid.x == 0u && wid.y == 0u) { skyIrradianceSH(li); }   // fix(v2) terrain shadow: the sky's harmonics (the first workgroup)
  if (g.x >= APN || g.y >= APN) { return; }
  if (g.x == 0u && g.y == 0u) {
    // the frame's light on a level surface at the lake, once for every shader (render/sky.js SKY_READ LIGHT): the sky's
    // irradiance (four 45° samples × π) and the sun's (its transmittance at the camera)
    LIGHT.sky = vec4f(PI * 0.25 * (skyRad(vec3f(0.7071, 0.7071, 0.0)) + skyRad(vec3f(-0.7071, 0.7071, 0.0)) + skyRad(vec3f(0.0, 0.7071, 0.7071)) + skyRad(vec3f(0.0, 0.7071, -0.7071))), 1.0);
    let rC = Rg + F.sky.z; let sd = normalize(F.sun.xyz);
    LIGHT.sun = vec4f(F.sky.x * transAt(rC, sd.y) * max(sd.y, 0.0) * step(0.0, raySphere(vec3f(0.0, rC, 0.0), sd, Rg) * -1.0) * F.storm.y, 1.0);   // M5e: the storm cell's shade at the eye
  }
  let uv = (vec2f(g.xy) + 0.5) / f32(APN);
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let a = F.invViewProj * vec4f(ndc, 1.0, 1.0); let b = F.invViewProj * vec4f(ndc, 0.5, 1.0);
  let d = normalize(b.xyz / b.w - a.xyz / a.w);
  let rCam = Rg + F.sky.z; let o = vec3f(0.0, rCam, 0.0); let s = normalize(F.sun.xyz);
  let c = dot(d, s); let pR = phaseR(c); let pM = phaseM(c);
  var T = vec3f(1.0); var L = vec3f(0.0); var t0 = 0.0;
  for (var k = 0u; k < APS; k++) {
    let w = f32(k + 1u) / f32(APS); let t1 = APMAX * w * w;
    let ds = (t1 - t0) / f32(SUB);
    for (var q = 0u; q < SUB; q++) {
      let p = o + d * (t0 + (f32(q) + 0.5) * ds); let rp = length(p); let m = mediumHaze(rp);
      let ext = max(m.ext, vec3f(1e-6)); let Ts = exp(-m.ext * ds);
      let S = (m.sR * pR + vec3f(m.sM * pM)) * sunT(p, s) * F.storm.y + (m.sR + vec3f(m.sM)) * msAt(rp, dot(p, s) / rp);
      L += T * (S - S * Ts) / ext;
      T *= Ts;
    }
    t0 = t1;
    textureStore(outS, vec3i(i32(g.x), i32(g.y), i32(k)), vec4f(L * F.sky.x, 1.0));
    textureStore(outT, vec3i(i32(g.x), i32(g.y), i32(k)), vec4f(T, 1.0));
  }
}`;

// #18 r2 (moved out of AP_READ by the frame look, so the water's mirror marches fog the reflected land as the land: render/terrain.js
// REFLECT_WGSL, render/towns.js SHORE_MIRROR_WGSL; it reads F only)
export const STORM_FOG_WGSL = `
// #18 r2: v1's storm haze (src/core/sky.js valley mist, src/core/farLook.js, src/weather/storm.js, src/daylight.js): an
// exponential height fog, density A·exp(−y / B) integrated along the view ray (Quilez). v1's A is FOG_A × mistK (0.35, the
// far look) × (1 + 22 × haze); its fair share is v2's aerial perspective, so A here is the storm's share, FOG_A × 0.35 × 22
// × haze; B = FOG_B. The colour, no phase: v1's mist by the sun's height × lum × light × mistGain (2), moved 0.85 × haze of
// the way to the storm's steel grey (0.62 of a sunlit white × light × (0.86, 0.92, 1)); lum is a sunlit white at 0.6 on
// screen, so here ÷ the exposure factor. 0 with no storm.
fn stormFog(p: vec3f) -> f32 {
  if (F.storm.x < 0.5 || F.rain.z <= 0.0) { return 0.0; }
  let A = ${FOG_A} * ${STORM_FOG.mistK} * ${STORM_FOG.gain.toFixed(1)} * F.rain.z; let invB = ${(1 / FOG_B).toFixed(6)};
  // the fog is in the air: a point under the water (the lake bed seen through it) is fogged only to where its ray meets the
  // surface. Integrated on down, exp(−y / B) grows under y = 0 and the shallows' bed went a pale sheet round the dark deep
  // water: the "hole" in the storm water (2026-11-18)
  var q = p;
  if (p.y < 0.0 && F.cam.y > 0.0) { q = F.cam.xyz + (p - F.cam.xyz) * (F.cam.y / (F.cam.y - p.y)); }
  let ray = q - F.cam.xyz; let dist = max(length(ray), 1e-3);
  var dy = ray.y / dist; if (abs(dy) < 1e-3) { dy = 1e-3; }
  let integral = A / invB * exp(-invB * F.cam.y) * (1.0 - exp(-invB * dy * dist)) / dy;
  return clamp(1.0 - exp(-integral), 0.0, 1.0);
}
fn stormFogColour() -> vec3f {
  let e = normalize(F.sun.xyz).y;
  let light = min(1.0, (max(e, 0.0) + ${EXPOSURE.floor.toFixed(3)}) / ${(Math.sin(8.5 * Math.PI / 180) + EXPOSURE.floor).toFixed(6)});
  // v1's MIST (night 0x3a4452, dawn 0xd9cfc2, day 0xc8d3dc, linear) by the sun's sine
  var mist = mix(vec3f(0.693, 0.624, 0.540), vec3f(0.578, 0.651, 0.716), clamp((e - 0.08) / 0.3, 0.0, 1.0));
  if (e < 0.08) { mist = mix(vec3f(0.0423, 0.0578, 0.0844), vec3f(0.693, 0.624, 0.540), clamp((e + 0.05) / 0.13, 0.0, 1.0)); }
  let steel = vec3f(0.86, 0.92, 1.0) * 0.62;
  return mix(mist * 2.0, steel, 0.85 * F.rain.z) * (0.6 * light / max(F.params.x, 1e-6));
}
// the overcast's grey (the storm mist x STORM_OVERCAST.gain): the deck above the horizon and the storm foam's white take it
fn stormMurkColour() -> vec3f { return stormFogColour() * ${STORM_OVERCAST.gain.toFixed(2)}; }
// the storm deck's grey seen at elevation sine e (dark overhead, lighter toward the horizon's rain): STORM_DECK
fn stormDeckColour(e: f32) -> vec3f { return stormFogColour() * mix(${STORM_DECK.hor.toFixed(2)}, ${STORM_DECK.zen.toFixed(2)}, smoothstep(0.0, 0.6, e)); }
// how much of the dark deck a view direction d sees: v1's cellMask (F.cell: x, z, radius, cover) where d meets the deck
// (STORM_DECK.deckM m up; the horizon's rays capped at 40 km), x the storm's dark ramp, gone in the clearing's gold; 0 fair
fn stormDeckK(d: vec3f) -> f32 {
  let t = min(max(${STORM_DECK.deckM.toFixed(1)} - F.cam.y, 50.0) / max(d.y, 0.02), 40000.0);
  // the view's own cell, or, under the core (the eye in the cell: the rain overhead), most of the sky dark whatever the view (eyeK)
  return max(stormCellAt(F.cam.xz + d.xz * t), stormCellAt(F.cam.xz) * ${STORM_DECK.eyeK.toFixed(2)});
}
// v1's cellMask at q (F.cell: x, z, radius, cover; the trailing side stretched) x the storm's dark ramp, gone in the gold; 0 fair
fn stormCellAt(q: vec2f) -> f32 {
  if (F.storm.x < 0.5) { return 0.0; }
  let rel = q - F.cell.xy; let a = rel.x * ${Math.sin(70 * Math.PI / 180).toFixed(6)} + rel.y * ${(-Math.cos(70 * Math.PI / 180)).toFixed(6)};
  let rel2 = rel + vec2f(${Math.sin(70 * Math.PI / 180).toFixed(6)}, ${(-Math.cos(70 * Math.PI / 180)).toFixed(6)}) * (min(a, 0.0) * -0.45);
  let m = (1.0 - smoothstep(0.38, 1.0, length(rel2) / max(F.cell.z, 1.0))) * F.cell.w;
  return clamp(m, 0.0, 1.0) * smoothstep(0.25, 0.75, F.storm.z) * (1.0 - F.storm.w);
}
// the cloud on the ridges: land above the deck's base is inside the deck (STORM_DECK.ridge), its edge ragged with the height
// (a slow value of x and z, no texture), as dark as the deck there; under the cell only (stormDeckK along the view), 0 fair
fn stormRidge(p: vec3f) -> f32 {
  if (F.storm.x < 0.5) { return 0.0; }
  let rag = (sin(p.x * 0.0021 + sin(p.z * 0.0017) * 2.0) + sin(p.z * 0.0029 + p.x * 0.0008)) * 70.0;
  let inC = smoothstep(${(STORM_DECK.ridge.base - STORM_DECK.ridge.band).toFixed(1)}, ${STORM_DECK.ridge.base.toFixed(1)}, p.y + rag);
  return inC * stormCellAt(p.xz) * ${STORM_DECK.ridge.k.toFixed(2)};
}
`;

// the aerial perspective's reader: a surface at world point p seen at framebuffer pixel px → its colour through the air
// (needs tS, tTr bound in the sky-read group; the slice coordinate is sqrt(distance / max), as the bake)
export const AP_READ = `
${STORM_FOG_WGSL}
fn aerial(col: vec3f, px: vec2f, p: vec3f) -> vec3f { return mix(aerialAir(col, px, p), stormFogColour(), stormFog(p)); }
fn aerialAir(col: vec3f, px: vec2f, p: vec3f) -> vec3f {
  let dk = length(p - F.cam.xyz) * 0.001;
  let w = sqrt(min(dk, ${AP.maxKm.toFixed(1)}) / ${AP.maxKm.toFixed(1)});
  let uvw = vec3f(px * F.res.zw, max(w - ${(0.5 / AP.slices).toFixed(6)}, ${(0.5 / AP.slices).toFixed(6)}));
  let near = min(w * ${AP.slices}.0, 1.0);   // nearer than the first slice: fade in from no air
  let S = textureSampleLevel(tS, sLin, uvw, 0.0).rgb * near;
  let T = mix(vec3f(1.0), textureSampleLevel(tTr, sLin, uvw, 0.0).rgb, near);
  return col * T + S;
}
// fix(v2) mountains: the land's air as v1's (src/core/post.js: mix(lit, aerial, hazeK); src/core/sky.js: the valley mist, the
// far look's mistK and mistGain): the aerial perspective kept at LAND_LOOK.hazeK, v1's fair mist over it, the storm's on top
fn fairMist(p: vec3f) -> f32 {
  let A = ${FOG_A} * ${STORM_FOG.mistK}; let invB = ${(1 / FOG_B).toFixed(6)};
  let ray = p - F.cam.xyz; let dist = max(length(ray), 1e-3);
  var dy = ray.y / dist; if (abs(dy) < 1e-3) { dy = 1e-3; }
  let integral = A / invB * exp(-invB * F.cam.y) * (1.0 - exp(-invB * dy * dist)) / dy;
  return clamp(1.0 - exp(-integral), 0.0, 1.0);
}
fn fairMistColour() -> vec3f {
  let e = normalize(F.sun.xyz).y;
  let light = min(1.0, (max(e, 0.0) + ${EXPOSURE.floor.toFixed(3)}) / ${(Math.sin(8.5 * Math.PI / 180) + EXPOSURE.floor).toFixed(6)});
  var mist = mix(vec3f(0.693, 0.624, 0.540), vec3f(0.578, 0.651, 0.716), clamp((e - 0.08) / 0.3, 0.0, 1.0));
  if (e < 0.08) { mist = mix(vec3f(0.0423, 0.0578, 0.0844), vec3f(0.693, 0.624, 0.540), clamp((e + 0.05) / 0.13, 0.0, 1.0)); }
  return mist * ${LAND_LOOK.mistGain.toFixed(1)} * (0.6 * light / max(F.params.x, 1e-6));
}
// the day's light for v1's constant far colours (1 by day, v1's daylight f.light: the sky's light under the knee)
fn dayLight() -> f32 { return min(1.0, (max(normalize(F.sun.xyz).y, 0.0) + ${EXPOSURE.floor.toFixed(3)}) / ${(Math.sin(8.5 * Math.PI / 180) + EXPOSURE.floor).toFixed(6)}); }
fn aerialLand(col: vec3f, px: vec2f, p: vec3f) -> vec3f {
  let a = mix(col, aerialAir(col, px, p), ${LAND_LOOK.hazeK.toFixed(3)});
  return mix(mix(mix(a, fairMistColour(), fairMist(p)), stormFogColour(), stormFog(p)), stormDeckColour(normalize(p - F.cam.xyz).y), stormRidge(p));   // the ridges' cloud (STORM_DECK.ridge), the deck's grey at that elevation (it meets the sky behind)
}
// v1's depth tint (src/terrain-mesh.js depthTint): within tint.near a little darker and richer, past tint.far toward far
fn depthTint(col: vec3f, p: vec3f, far: vec3f) -> vec3f {
  let d = length(p - F.cam.xyz);
  let near = 1.0 - smoothstep(${LAND_LOOK.tint.near[0].toFixed(1)}, ${LAND_LOOK.tint.near[1].toFixed(1)}, d);
  let farW = smoothstep(${LAND_LOOK.tint.far[0].toFixed(1)}, ${LAND_LOOK.tint.far[1].toFixed(1)}, d);
  let lum = dot(col, vec3f(0.3, 0.55, 0.15));
  let rich = mix(vec3f(lum), col, ${LAND_LOOK.tint.rich.toFixed(2)}) * ${LAND_LOOK.tint.value.toFixed(2)};
  return mix(mix(col, max(rich, vec3f(0.0)), near), far, farW * ${LAND_LOOK.tint.farK.toFixed(2)});
}
// T3: the forest's depth tint (the cards and the canopy): the near richness as depthTint's, then toward LAND_LOOK.treeHaze
fn depthTintTree(col: vec3f, p: vec3f) -> vec3f {
  let H = LAND_LOOK_TREE_HAZE;
  let d = length(p - F.cam.xyz);
  let near = 1.0 - smoothstep(${LAND_LOOK.tint.near[0].toFixed(1)}, ${LAND_LOOK.tint.near[1].toFixed(1)}, d);
  let farW = smoothstep(${LAND_LOOK.treeHaze.far[0].toFixed(1)}, ${LAND_LOOK.treeHaze.far[1].toFixed(1)}, d);
  let lum = dot(col, vec3f(0.3, 0.55, 0.15));
  let rich = mix(vec3f(lum), col, ${LAND_LOOK.tint.rich.toFixed(2)}) * ${LAND_LOOK.tint.value.toFixed(2)};
  return mix(mix(col, max(rich, vec3f(0.0)), near), H * dayLight(), farW * ${LAND_LOOK.treeHaze.farK.toFixed(2)});
}
const LAND_LOOK_TREE_HAZE = vec3f(${LAND_LOOK.treeHaze.colour.map((x) => x.toFixed(4)).join(', ')});
fn aerialParts(px: vec2f, p: vec3f, Tout: ptr<function, vec3f>) -> vec3f {
  let dk = length(p - F.cam.xyz) * 0.001;
  let w = sqrt(min(dk, ${AP.maxKm.toFixed(1)}) / ${AP.maxKm.toFixed(1)});
  let uvw = vec3f(px * F.res.zw, max(w - ${(0.5 / AP.slices).toFixed(6)}, ${(0.5 / AP.slices).toFixed(6)}));
  let near = min(w * ${AP.slices}.0, 1.0);
  let f = stormFog(p);
  *Tout = mix(vec3f(1.0), textureSampleLevel(tTr, sLin, uvw, 0.0).rgb, near) * (1.0 - f);
  return textureSampleLevel(tS, sLin, uvw, 0.0).rgb * near * (1.0 - f) + stormFogColour() * f;
}`;

// the sky reader for the scene's shaders: binds group 1 = (tT, tV, sLin, sView); the HDR scale and the night floor
// The low sun's horizon haze and glow (owner, 2026-11-20: "Look comparison", item 4): with the sun low (full from
// `deg[1]` to `deg[2]`, gone under `deg[0]` and over `deg[3]`: the golden hour and the dusk; the day and the night untouched) the
// low sky takes a milky pink-lavender band (`band`, its share at the horizon, `bandAnti` more away from the sun: the Belt of Venus;
// `bandH` its height, sine; the sky's own luminance × `lift`) and a soft warm glow toward the sun (`glow` round its bearing, `glowH`
// high; `halo` a wide soft disc round the sun, `haloK` its width). Relative to the sky's own luminance, so it follows the exposure
// and the twilight's fall. In the sky draw (after v1's polariser, under the clouds) and in the far water's sky tint (render/water.js
// WATER_FAR). About 20 ALU a sky pixel.
export const DUSK = Object.freeze({ deg: [-6, -1.5, 6, 12], band: 0.5, bandAnti: 0.3, bandH: 0.2, lift: 1.2,
  pink: [1.0, 0.74, 0.86], warm: [1.0, 0.62, 0.36], glow: 0.55, glowPow: 4, glowH: 0.12, halo: 0.25, haloK: 300 });
// the share of the low sun's look at a sun elevation (degrees): the JS twin of duskW() (the tests hold it)
export function duskShare(elevDeg, D = DUSK) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(D.deg[0], D.deg[1], elevDeg) * (1 - ss(D.deg[2], D.deg[3], elevDeg));
}
const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const DUSK_WGSL = () => {
  const sn = (x) => Math.sin(x * Math.PI / 180).toFixed(5), v = (c, k = 1) => `vec3f(${c.map((x) => (x * k).toFixed(4)).join(', ')})`;
  return `
// the low sun's look (DUSK): 0 by day and by night
fn duskW() -> f32 { let e = normalize(F.sun.xyz).y; return smoothstep(${sn(DUSK.deg[0])}, ${sn(DUSK.deg[1])}, e) * (1.0 - smoothstep(${sn(DUSK.deg[2])}, ${sn(DUSK.deg[3])}, e)); }
// the sky colour c along d with the band and the glow laid on it
fn duskGlow(d: vec3f, c: vec3f) -> vec3f {
  let w = duskW();
  if (w <= 0.0) { return c; }
  let s = normalize(F.sun.xyz);
  let Y = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let h = max(d.y, 0.0);
  let hz = normalize(vec3f(d.x, 0.0, d.z) + vec3f(1e-5, 0.0, 0.0)); let sz = normalize(vec3f(s.x, 0.0, s.z) + vec3f(1e-5, 0.0, 0.0));
  let ca = dot(hz, sz);
  let band = w * exp(-h / ${DUSK.bandH.toFixed(3)}) * (${DUSK.band.toFixed(3)} + ${DUSK.bandAnti.toFixed(3)} * (0.5 - 0.5 * ca));
  var o = mix(c, ${v(DUSK.pink, 1 / lumOf(DUSK.pink))} * (Y * ${DUSK.lift.toFixed(3)}), band);
  let glow = pow(max(ca, 0.0), ${DUSK.glowPow.toFixed(1)}) * exp(-h / ${DUSK.glowH.toFixed(3)}) * ${DUSK.glow.toFixed(3)} + ${DUSK.halo.toFixed(3)} / (1.0 + ${DUSK.haloK.toFixed(1)} * max(1.0 - dot(d, s), 0.0));
  o += ${v(DUSK.warm, 1 / lumOf(DUSK.warm))} * (Y * glow * w);
  return o;
}`;
};
export const SKY_READ = `
@group(1) @binding(0) var tT: texture_2d<f32>;
@group(1) @binding(1) var tV: texture_2d<f32>;
@group(1) @binding(2) var sLin: sampler;
@group(1) @binding(3) var sView: sampler;
@group(1) @binding(4) var tS: texture_3d<f32>;
@group(1) @binding(5) var tTr: texture_3d<f32>;
${LIGHT_STRUCT}
@group(1) @binding(6) var<storage, read> LIGHT: Light;   // the frame's sky and sun irradiance on level ground (the aerial pass)
// fix(v2) terrain shadow: the sky's irradiance on a face of normal n (the aerial pass's L1 harmonics: v1's environment diffuse)
fn skyIrrN(n: vec3f) -> vec3f { let v = vec4f(1.0, n); return max(vec3f(dot(LIGHT.irrR, v), dot(LIGHT.irrG, v), dot(LIGHT.irrB, v)), vec3f(0.0)); }
// the land's sky light (the terrain's faces, the boulders, the forest's cards): v1's two sky terms (the atmosphere light's
// level-ground irradiance by the face's tilt, the environment's diffuse) × k, its blue drawn desat of the way to its own grey
// (v1's land in shade reads a dark grey green under its sky, not v2's deep blue). With the sun under the horizon it returns
// to the tilted level sky alone over ${LAND_SKY.nightDeg[1]}° → ${LAND_SKY.nightDeg[0]}°: the twilight's bright horizon would lift the night's tree
// line out of its silhouette (v1's night is NIGHT_LAND's lift alone)
// fix(v2) mountains: the ground's specular as v1's (three's MeshStandardMaterial on v1's terrain: F0 0.04, roughness ≈ 0.9):
// the sun's broad GGX lobe (eSun: its irradiance on the face, shadowed) and the sky's reflection (the rough lobe ≈ the
// sky's irradiance about the bent reflected ray / π, three's DFGApprox). At a grazing view it greys and lifts a slope
// toward the sky's colour: v1's pale granite faces, where v2's diffuse alone left the photo's olive
fn landDfg(rough: f32, nv: f32) -> vec2f {
  let r = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}
fn landSpec(n: vec3f, V: vec3f, s: vec3f, eSun: vec3f, rough: f32) -> vec3f {
  let nv = clamp(dot(n, V), 1e-4, 1.0);
  let H = normalize(V + s); let nh = clamp(dot(n, H), 0.0, 1.0); let vh = clamp(dot(V, H), 0.0, 1.0); let nl = clamp(dot(n, s), 0.0, 1.0);
  let a2 = rough * rough * rough * rough;
  let dd = nh * nh * (a2 - 1.0) + 1.0; let D = a2 / (PI * dd * dd);
  let Vis = 0.5 / max(nl * sqrt(a2 + (1.0 - a2) * nv * nv) + nv * sqrt(a2 + (1.0 - a2) * nl * nl), 1e-6);
  let Fs = 0.04 + 0.96 * exp2((-5.55473 * vh - 6.98316) * vh);
  let Rd = normalize(mix(reflect(-V, n), n, rough * rough));
  let ab = landDfg(rough, nv);
  return eSun * Fs * (Vis * D) + skyIrrN(Rd) / PI * (0.04 * ab.x + ab.y);
}
fn landSky(n: vec3f, k: f32, desat: f32) -> vec3f {
  let lvl = LIGHT.sky.rgb * (0.5 + 0.5 * n.y);
  let e = (skyIrrN(n) + lvl) * k;
  let day = smoothstep(${Math.sin(LAND_SKY.nightDeg[0] * Math.PI / 180).toFixed(5)}, ${Math.sin(LAND_SKY.nightDeg[1] * Math.PI / 180).toFixed(5)}, normalize(F.sun.xyz).y);
  return mix(lvl, mix(e, vec3f(dot(e, vec3f(0.2126, 0.7152, 0.0722))), desat), day);
}
${TRANS_READ}
${NIGHT_SKY_WGSL}
${DUSK_WGSL()}
// the sky's radiance along d, in the scene's HDR scale (no sun disc)
fn skyRadiance(d: vec3f) -> vec3f {
  let eh = horizonElev(Rg + F.sky.z);
  return textureSampleLevel(tV, sView, skyViewUV(d, eh), 0.0).rgb * F.sky.x + nightSky(d);
}
// the sky as the eye sees it (the sky draw): the night's airglow at NIGHT.airSky (look/v2-night-look), through the air's
// transmittance along d as v1's (its airglow and domes sit in the sky's stars term: feat/v2-sky-v1-grade), so the low sky
// goes from deep blue to v1's dim green-amber over the ridges instead of a lighter blue band
fn skyRadianceShown(d: vec3f) -> vec3f {
  let eh = horizonElev(Rg + F.sky.z);
  return textureSampleLevel(tV, sView, skyViewUV(d, eh), 0.0).rgb * F.sky.x + nightSkyShown(d) * transAt(Rg + F.sky.z, max(d.y, 0.0));
}
// the sky in the water's mirror: the airglow at NIGHT.airMirror (the long exposure's sheen on the waves: at the drawn sky's
// share the night water read as one flat navy and its waves were lost)
fn skyRadianceMirror(d: vec3f) -> vec3f {
  let eh = horizonElev(Rg + F.sky.z);
  return textureSampleLevel(tV, sView, skyViewUV(d, eh), 0.0).rgb * F.sky.x + nightSkyK(d, ${NIGHT.airMirror.toFixed(3)});
}
// the sun's radiance seen from the camera along s (the disc's own brightness × the air's transmittance), HDR scale
fn sunRadiance() -> vec3f {
  let rCam = Rg + F.sky.z; let s = normalize(F.sun.xyz);
  let th = acos(F.sky.w);
  return F.sky.x * transAt(rCam, s.y) / (PI * th * th) * step(0.0, raySphere(vec3f(0.0, rCam, 0.0), s, Rg) * -1.0) * F.storm.y;
}
// the sun's irradiance on a horizontal surface at the camera (the glint's and the foam's light), HDR scale
fn sunIrradiance() -> vec3f {
  let rCam = Rg + F.sky.z; let s = normalize(F.sun.xyz);
  return F.sky.x * transAt(rCam, s.y) * max(s.y, 0.0) * step(0.0, raySphere(vec3f(0.0, rCam, 0.0), s, Rg) * -1.0) * F.storm.y;
}
${CLOUD_READ(1)}`;

// M5e: the moon's disc along d (HDR): a sphere of angular radius MOON_DEG lit by the sun (the phase comes out of the
// geometry: the near side's normal against the sun's direction, an earthshine floor), v1's real ratio to the sun's disc
// (NIGHT.moonDisc), dimmed by the air's transmittance; soft at the limb. 0 off the disc or under the horizon
export const MOON_WGSL = `
const MOON_RAD = ${(0.26 * Math.PI / 180).toFixed(7)}; const MOON_DISC = ${NIGHT.moonDisc};
fn moonDisc(d: vec3f) -> vec3f {
  let m = F.moon.xyz; let c = dot(d, m);
  if (c < cos(MOON_RAD * 1.3) || m.y < -0.03) { return vec3f(0.0); }
  let ang = acos(clamp(c, -1.0, 1.0));
  let r = ang / MOON_RAD;
  let u = (d - m * c) / max(sin(MOON_RAD), 1e-6);
  let n = normalize(u - m * sqrt(max(1.0 - min(r * r, 1.0), 0.0)));
  let lit = max(dot(n, normalize(F.sun.xyz)), 0.0) * 0.98 + 0.02;
  let edge = 1.0 - smoothstep(0.985, 1.02, r);
  let rCam = Rg + F.sky.z;
  return vec3f(MOON_DISC) * lit * edge * transAt(rCam, m.y) * step(0.0, raySphere(vec3f(0.0, rCam, 0.0), m, Rg) * -1.0);
}`;
export const SKY_DRAW_WGSL = (frameStruct, fullscreen) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${fullscreen}
${ATMO_WGSL}
${SKY_READ}
${NIGHT_READ(2, 0)}
${MOON_WGSL}
${POLAR_WGSL}
${STORM_FOG_WGSL}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let d = viewDir(v.ndc);
  var c = skyMatch(skyRadianceShown(d), d.y);   // fix(v2) frame look: v2's sky radiance as v1's (render/grade.js SKY_MATCH), then its polariser below
  let s = normalize(F.sun.xyz); let mu = dot(d, s);
  let rCam = Rg + F.sky.z;
  if (mu > F.sky.w - 4e-6 && raySphere(vec3f(0.0, rCam, 0.0), d, Rg) < 0.0) {
    c += sunRadiance() * smoothstep(F.sky.w - 4e-6, F.sky.w + 1e-6, mu);
  }
  // M5e: the Milky Way beyond the air (its transmittance along d dims the band into the horizon's haze), the moon
  if (F.night.z > 0.0 && d.y > -0.02) { c += milkyWay(d) * transAt(rCam, max(d.y, 0.0)); }
  c += moonDisc(d);
  // fix(v2) frame look: under the horizon the sky draw only shows where the far water lets the floor through and the terrain
  // draws no bed (a node wholly under 60 m: the bay's mouth past the sill from cam E); in a storm that hole is the water
  // where the ray meets it, so it takes the storm's mist there (it showed as a black band across the mouth)
  if (d.y < 0.0 && F.storm.x > 0.5) { let tw = max(F.cam.y, 0.5) / max(-d.y, 1e-4); c = mix(c, stormFogColour(), stormFog(F.cam.xyz + d * min(tw, 60000.0))); }
  // fix(v2) frame look, the storm: v1's cell goes overcast round the eye (its deck at coverage 0.82 turns soft and continuous)
  // where v2's keeps clear gaps; under the storm's dark the clear sky between takes the storm's steel mist (STORM_SKY of it)
  if (F.storm.x > 0.5) { c = mix(c, stormFogColour(), F.storm.z * ${STORM_SKY.toFixed(2)}); }
  c = polarSky(c);   // fix(v2) frame look: v1's sky-only polariser (render/grade.js), on the true sky before the deck, as v1's post
  c = duskGlow(d, c);   // feat/v2-look-ponlai: the low sun's pink-lavender band and warm glow over the horizon (DUSK; 0 by day and by night)
  // fix(v2) frame look: the deck stands above the horizon; under it the key's clamped bottom row (a storm's thick, dark base)
  // was laid over the hole in the water (above): the black band across the bay's mouth from cam E
  var k = cloudAt(d);
  // the v1 grade (2026-11-18): under the storm's dark the deck reads soft (v1's per-pixel deck in its fog), not the key's hard
  // cauliflower clumps: the key's mip chain (STORM_OVERCAST.lod) takes over as the storm darkens, gone in the clearing's gold
  if (F.storm.x > 0.5) { k = mix(k, cloudAtLod(d, ${STORM_OVERCAST.lod.toFixed(1)}), smoothstep(0.3, 0.9, F.storm.z) * (1.0 - F.storm.w)); }
  k = mix(vec4f(0.0, 0.0, 0.0, 1.0), k, smoothstep(-0.004, 0.0, d.y));   // M5a: the deck over the sky and the discs (its light is premultiplied; a its transmittance)
  // #18: a storm's thick deck seals the sun's disc and the low sun's glow (v1's cloudSeal: under 1.5 % of the light through it, none)
  var Ta = k.a; if (F.storm.x > 0.5) { Ta = k.a * mix(1.0, smoothstep(0.015, 0.05, k.a), F.cell.w); }
  var o = c * Ta + k.rgb;
  // the v1 grade (2026-11-18): under the storm's dark v1's deck reads as one soft, lit grey
  // overcast (its per-pixel march, the cell's coverage and its fog on the clouds), where the key kept fair-weather clumps, white
  // over dark gaps. The deck and the sky between are drawn together toward the overcast's grey (STORM_OVERCAST: the storm mist ×
  // its gain), more toward the horizon (the far deck in the rain's haze); from half the dark (the front keeps its clouds), gone in the
  // clearing's gold (the rainbow's sky stays clear); 0 with no storm, so a fair sky is untouched. v1's approach: the sky above the
  // horizon only (under it this draw is the water's floor hole, fogged above as the water is)
  if (F.storm.x > 0.5 && d.y > 0.0) {
    // the sky and the mountains (2026-11-18): under the cell a dark, heavy deck (STORM_DECK), lighter past its edge and in the gold
    let wd = stormDeckK(d);
    o = mix(o - k.rgb * (${STORM_DECK.cloudK.toFixed(2)} * wd), stormDeckColour(d.y), wd * ${STORM_DECK.cover.toFixed(2)});
    let w = smoothstep(0.4, 1.0, F.storm.z) * (1.0 - F.storm.w) * (1.0 - wd) * (${STORM_OVERCAST.near.toFixed(2)} + ${(STORM_OVERCAST.far - STORM_OVERCAST.near).toFixed(2)} * (1.0 - smoothstep(0.0, ${STORM_OVERCAST.band.toFixed(2)}, d.y)));
    o = mix(o, stormMurkColour(), w);
  }
  return vec4f(o, 1.0);
}`;

// --- the GPU side: textures, the three compute pipelines, the sky draw; bind groups made once after buildAll ---
export function createSky({ device, reg, frameBGL, frameBG, U, frameStruct = wgslStruct(), fullscreen, hdrTarget, msaa = 1, depthFormat = 'depth32float', clouds, night }) {   // clouds: render/clouds.js createClouds(): its params and key join the sky-read group (bindings 7–9); night: render/night.js createNight(): its record and the Milky Way's maps are the sky draw's group 2
  const tex = (label, [w, h]) => device.createTexture({ label, size: [w, h], format: LUT.format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const tT = tex('sky-transmittance', LUT.trans), tM = tex('sky-multiscat', LUT.ms), tV = tex('sky-view', LUT.view);
  const vT = tT.createView(), vM = tM.createView(), vV = tV.createView();
  const tex3 = (label) => device.createTexture({ label, size: [AP.size, AP.size, AP.slices], dimension: '3d', format: LUT.format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
  const tS = tex3('sky-aerial-scatter'), tTr = tex3('sky-aerial-trans');
  const vS = tS.createView({ dimension: '3d' }), vTr = tTr.createView({ dimension: '3d' });
  const sLin = device.createSampler({ label: 'lut-clamp', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  // mipmapFilter linear and maxAnisotropy 4: the clouds' key has a mip chain the water's mirror reads by gradient (the far
  // water's shimmer fix, 2026-11-13: render/water-aa.js cloudTapGrad); every other read through this sampler is an
  // explicit level 0 (no anisotropy, no mips), unchanged
  const sView = device.createSampler({ label: 'lut-view', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: KEY_ANISO, addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
  const C = GPUShaderStage.COMPUTE, FR = GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX;
  const stor = { access: 'write-only', format: LUT.format, viewDimension: '2d' };
  const bglT = device.createBindGroupLayout({ label: 'sky-trans', entries: [{ binding: 0, visibility: C, storageTexture: stor }] });
  const bglM = device.createBindGroupLayout({ label: 'sky-ms', entries: [{ binding: 0, visibility: C, texture: {} }, { binding: 1, visibility: C, sampler: {} }, { binding: 2, visibility: C, storageTexture: stor }] });
  const bglV = device.createBindGroupLayout({ label: 'sky-view', entries: [{ binding: 0, visibility: C, texture: {} }, { binding: 1, visibility: C, texture: {} }, { binding: 2, visibility: C, sampler: {} }, { binding: 3, visibility: C, storageTexture: stor }] });
  const stor3 = { access: 'write-only', format: LUT.format, viewDimension: '3d' };
  const bglA = device.createBindGroupLayout({ label: 'sky-aerial', entries: [{ binding: 0, visibility: C, texture: {} }, { binding: 1, visibility: C, texture: {} }, { binding: 2, visibility: C, sampler: {} }, { binding: 3, visibility: C, storageTexture: stor3 }, { binding: 4, visibility: C, storageTexture: stor3 },
    { binding: 5, visibility: C, texture: {} }, { binding: 6, visibility: C, sampler: {} }, { binding: 7, visibility: C, buffer: { type: 'storage' } }] });
  const lightBuf = device.createBuffer({ label: 'sky-light', size: LIGHT_BYTES, usage: GPUBufferUsage.STORAGE });
  // group 1 of the scene's shaders (the sky draw, the terrain, the water): the LUTs and the aerial perspective's two volumes
  const skyBGL = device.createBindGroupLayout({ label: 'sky-read', entries: [{ binding: 0, visibility: FR, texture: {} }, { binding: 1, visibility: FR, texture: {} }, { binding: 2, visibility: FR, sampler: {} }, { binding: 3, visibility: FR, sampler: {} },
    { binding: 4, visibility: FR, texture: { viewDimension: '3d' } }, { binding: 5, visibility: FR, texture: { viewDimension: '3d' } }, { binding: 6, visibility: FR, buffer: { type: 'read-only-storage' } }, ...clouds.bind.layout] });
  const bgT = device.createBindGroup({ layout: bglT, entries: [{ binding: 0, resource: vT }] });
  const bgM = device.createBindGroup({ layout: bglM, entries: [{ binding: 0, resource: vT }, { binding: 1, resource: sLin }, { binding: 2, resource: vM }] });
  const bgV = device.createBindGroup({ layout: bglV, entries: [{ binding: 0, resource: vT }, { binding: 1, resource: vM }, { binding: 2, resource: sLin }, { binding: 3, resource: vV }] });
  const bgA = device.createBindGroup({ layout: bglA, entries: [{ binding: 0, resource: vT }, { binding: 1, resource: vM }, { binding: 2, resource: sLin }, { binding: 3, resource: vS }, { binding: 4, resource: vTr }, { binding: 5, resource: vV }, { binding: 6, resource: sView }, { binding: 7, resource: { buffer: lightBuf } }] });
  const skyBG = device.createBindGroup({ layout: skyBGL, entries: [{ binding: 0, resource: vT }, { binding: 1, resource: vV }, { binding: 2, resource: sLin }, { binding: 3, resource: sView }, { binding: 4, resource: vS }, { binding: 5, resource: vTr }, { binding: 6, resource: { buffer: lightBuf } }, ...clouds.bind.entries] });

  const mT = reg.shader('sky-transmittance', TRANSMITTANCE_WGSL), mM = reg.shader('sky-multiscat', MULTISCAT_WGSL), mV = reg.shader('sky-view', SKYVIEW_WGSL(frameStruct));
  const mS = reg.shader('sky', SKY_DRAW_WGSL(frameStruct, fullscreen));
  const mA = reg.shader('sky-aerial', AERIAL_WGSL(frameStruct));
  reg.add('sky-aerial', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bglA] }), compute: { module: mA, entryPoint: 'main' } });
  reg.add('sky-transmittance', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglT] }), compute: { module: mT, entryPoint: 'main' } });
  reg.add('sky-multiscat', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglM] }), compute: { module: mM, entryPoint: 'main' } });
  reg.add('sky-view', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bglV] }), compute: { module: mV, entryPoint: 'main' } });
  reg.add('sky', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, skyBGL, night.bgl] }), vertex: { module: mS, entryPoint: 'vs' }, fragment: { module: mS, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });

  const wg = ([w, h]) => [Math.ceil(w / 8), Math.ceil(h / 8)];
  let baked = false;
  return {
    skyBGL, skyBG, textures: { tT, tM, tV, tS, tTr }, samplers: { sLin, sView }, lightBuf,   // M5a: the clouds' key march binds the LUTs, the samplers and the light record
    // once, after buildAll(), before the first frame: the two sun-independent LUTs (one encoder of their own)
    bakeOnce() {
      if (baked) return;
      const enc = device.createCommandEncoder({ label: 'sky-bake' });
      const pass = enc.beginComputePass({ label: 'sky-bake' });
      pass.setPipeline(reg.get('sky-transmittance')); pass.setBindGroup(0, bgT); pass.dispatchWorkgroups(...wg(LUT.trans));
      pass.setPipeline(reg.get('sky-multiscat')); pass.setBindGroup(0, bgM); pass.dispatchWorkgroups(...wg(LUT.ms));
      pass.end();
      device.queue.submit([enc.finish()]);
      baked = true;
    },
    // every frame, in the sky-lut compute pass: the sky-view LUT for this frame's sun
    runView(pass, c) {
      pass.setPipeline(reg.get('sky-view')); pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bgV);
      pass.dispatchWorkgroups(...wg(LUT.view)); c.dispatches++;
    },
    // every frame, after the view LUT: the aerial perspective's froxels for this frame's camera and sun
    runAerial(pass, c) {
      pass.setPipeline(reg.get('sky-aerial')); pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bgA);
      pass.dispatchWorkgroups(AP.size / 8, AP.size / 8); c.dispatches++;
    },
    draw(pass, c) {
      pass.setBindGroup(1, skyBG); pass.setBindGroup(2, night.bg);
      pass.setPipeline(reg.get('sky')); pass.draw(3); c.calls++; c.triangles += 1;
    },
  };
}
