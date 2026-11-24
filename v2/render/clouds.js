// The clouds (M5a): v1's Nubis deck (src/clouds.js: a Perlin-Worley shape eroded by a Worley detail, a weather map for
// coverage and type, a height gradient per type, Beer-Lambert + powder toward the sun, a two-lobe Henyey-Greenstein
// phase, two cheap samples up for the sky's occlusion) marched once per direction into a panoramic key from the eye
// (v2/sim/clouds.js: why a key, the mapping, the schedule), a band of rows a frame, cross-faded between the last two
// complete keys. The sky draw, the water's reflection and the terrain each read it with one texture fetch
// (render/sky.js CLOUD_READ, bound in the sky-read group every scene shader already has).
//   createClouds(…) → the textures and the params uniform (made before the sky, whose read group binds them);
//   .attach(sky) declares the three pipelines (the noise and weather bakes, the key march) on the registry at load;
//   .bakeOnce() runs the two noise bakes (one encoder, after buildAll); .update(…) each frame writes the params and takes
//   the schedule's step; .run(pass, c) dispatches this frame's rows in the cloud-key compute pass (after the aerial
//   pass: it reads the frame's light record). Nothing is created after load; ?clouds=0 keeps the resources and skips
//   the march (the readers see T = 1).
import { ATMO_WGSL, TRANS_READ, NIGHT_SKY_WGSL } from './sky.js';
import { NIGHT } from '../sim/night.js';   // look/v2-night-look: the clouds' share of the airglow
import { CLOUD_STRUCT } from './cloud-read.js';
import { KEY, DECK, PARAM_FLOATS, keySizeFor, createKeySchedule, cloudDrift, fillParams, STRETCH, cloudLightMatch } from '../sim/clouds.js';

// WebGPU's constants, with their spec values where there is no GPU (the node tests run createClouds on a fake device)
const TEX = globalThis.GPUTextureUsage ?? { TEXTURE_BINDING: 4, STORAGE_BINDING: 8 };
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// --- the noise (the JS twins: sim/clouds.js hash3, perlin, worley, shapeRaw, detailRaw, weatherRaw) ---
const NOISE_WGSL = `
fn hash3(x: u32, y: u32, z: u32, seed: u32) -> f32 {
  var h = x * 374761393u + y * 668265263u + z * 2147483647u + seed * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}
fn wrapI(i: i32, p: i32) -> u32 { return u32(((i % p) + p) % p); }
fn fadeF(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
fn grad(i: i32, j: i32, k: i32, p: i32, seed: u32, d: vec3f) -> f32 {
  let wi = wrapI(i, p); let wj = wrapI(j, p); let wk = wrapI(k, p);
  let th = hash3(wi, wj, wk, seed) * 6.283185; let ph = hash3(wi, wj, wk, seed + 17u) * 2.0 - 1.0;
  let s = sqrt(max(0.0, 1.0 - ph * ph));
  return cos(th) * s * d.x + sin(th) * s * d.y + ph * d.z;
}
// gradient noise with period p cells, roughly in [-1, 1]
fn perlin(q: vec3f, p: i32, seed: u32) -> f32 {
  let qi = vec3i(floor(q)); let f = q - floor(q);
  let u = fadeF(f.x); let v = fadeF(f.y); let w = fadeF(f.z);
  let x0 = mix(mix(grad(qi.x, qi.y, qi.z, p, seed, f), grad(qi.x + 1, qi.y, qi.z, p, seed, f - vec3f(1.0, 0.0, 0.0)), u),
               mix(grad(qi.x, qi.y + 1, qi.z, p, seed, f - vec3f(0.0, 1.0, 0.0)), grad(qi.x + 1, qi.y + 1, qi.z, p, seed, f - vec3f(1.0, 1.0, 0.0)), u), v);
  let x1 = mix(mix(grad(qi.x, qi.y, qi.z + 1, p, seed, f - vec3f(0.0, 0.0, 1.0)), grad(qi.x + 1, qi.y, qi.z + 1, p, seed, f - vec3f(1.0, 0.0, 1.0)), u),
               mix(grad(qi.x, qi.y + 1, qi.z + 1, p, seed, f - vec3f(0.0, 1.0, 1.0)), grad(qi.x + 1, qi.y + 1, qi.z + 1, p, seed, f - vec3f(1.0, 1.0, 1.0)), u), v);
  return mix(x0, x1, w) * 1.6;
}
// inverted Worley (1 at a feature point, 0 a cell away) with period p cells
fn worley(q: vec3f, p: i32, seed: u32) -> f32 {
  let qi = vec3i(floor(q)); var d2 = 9.0;
  for (var k = -1; k <= 1; k++) { for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) {
    let c = qi + vec3i(i, j, k); let wx = wrapI(c.x, p); let wy = wrapI(c.y, p); let wz = wrapI(c.z, p);
    let o = vec3f(hash3(wx, wy, wz, seed), hash3(wx, wy, wz, seed + 1u), hash3(wx, wy, wz, seed + 2u));
    let dv = vec3f(c) + o - q; d2 = min(d2, dot(dv, dv));
  } } }
  return 1.0 - min(1.0, sqrt(d2));
}
fn remapF(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + ((v - a) / (b - a)) * (d - c); }
fn stretchF(v: f32, lo: f32, hi: f32) -> f32 { return clamp((v - lo) / (hi - lo), 0.0, 1.0); }
// the Nubis base shape: Perlin-Worley billows remapped by a low Worley fBm; the detail: a three-octave Worley fBm
fn shapeRaw(q: vec3f, seed: u32) -> f32 {
  var pn = 0.0; var a = 0.5; var n = 0.0;
  for (var o = 0u; o < 4u; o++) { let p = 4 << o; pn += perlin(q * f32(p), i32(p), seed + o) * a; n += a; a *= 0.5; }
  pn = pn / n * 0.5 + 0.5;
  let w = worley(q * 4.0, 4, seed + 11u) * 0.625 + worley(q * 8.0, 8, seed + 12u) * 0.25 + worley(q * 16.0, 16, seed + 13u) * 0.125;
  return remapF(remapF(pn, 0.0, 1.0, w, 1.0), w - 1.0, 1.0, 0.0, 1.0);
}
fn detailRaw(q: vec3f, seed: u32) -> f32 {
  return worley(q * 4.0, 4, seed + 21u) * 0.625 + worley(q * 8.0, 8, seed + 22u) * 0.25 + worley(q * 16.0, 16, seed + 23u) * 0.125;
}
fn weatherRaw(q: vec2f, seed: u32) -> vec2f {
  var c = 0.0; var t = 0.0; var a = 0.5; var n = 0.0;
  for (var o = 0u; o < 5u; o++) { let p = 4 << o; c += perlin(vec3f(q * f32(p), 0.5), i32(p), seed + 31u + o) * a; t += perlin(vec3f(q * f32(p >> 1u), 3.5), i32(p >> 1u), seed + 41u + o) * a; n += a; a *= 0.5; }
  return vec2f(c / n, t / n);
}`;

const SIDE = KEY.noise, WSIDE = KEY.weather;
export const NOISE_BAKE_WGSL = `${CLOUD_STRUCT}
@group(0) @binding(0) var<uniform> CL: CloudU;
@group(0) @binding(1) var outN: texture_storage_3d<rgba8unorm, write>;
${NOISE_WGSL}
// the 64³ tile, once at load: R the shape, G the detail (each stretched as v1's toBytes did, with fixed bounds)
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (any(g >= vec3u(${SIDE}u))) { return; }
  let q = vec3f(g) / ${SIDE}.0; let seed = u32(CL.f.x);
  let s = stretchF(shapeRaw(q, seed), ${STRETCH.shape[0]}, ${STRETCH.shape[1]});
  let d = stretchF(detailRaw(q, seed), ${STRETCH.detail[0]}, ${STRETCH.detail[1]});
  textureStore(outN, vec3i(g), vec4f(s, d, 0.0, 1.0));
}`;
export const WEATHER_BAKE_WGSL = `${CLOUD_STRUCT}
@group(0) @binding(0) var<uniform> CL: CloudU;
@group(0) @binding(1) var outW: texture_storage_2d<rgba8unorm, write>;
${NOISE_WGSL}
// the 256² weather tile, once at load: R the coverage variation, G the type variation (v1's clouds-noise.js weatherBytes)
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (any(g.xy >= vec2u(${WSIDE}u))) { return; }
  let w = weatherRaw(vec2f(g.xy) / ${WSIDE}.0, u32(CL.f.x));
  textureStore(outW, vec2i(g.xy), vec4f(stretchF(w.x, ${STRETCH.weather[0]}, ${STRETCH.weather[1]}), stretchF(w.y, ${STRETCH.weather[0]}, ${STRETCH.weather[1]}), 0.0, 1.0));
}`;

// --- the key march: one thread a key texel in this frame's row band ---
export const KEY_WGSL = (frameStruct, [W, H]) => `${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${CLOUD_STRUCT}
@group(1) @binding(0) var<uniform> CL: CloudU;
@group(1) @binding(1) var tNoise: texture_3d<f32>;
@group(1) @binding(2) var tWeather: texture_2d<f32>;
@group(1) @binding(3) var sRep: sampler;
@group(1) @binding(4) var tT: texture_2d<f32>;
@group(1) @binding(5) var tV: texture_2d<f32>;
@group(1) @binding(6) var sLin: sampler;
@group(1) @binding(7) var sView: sampler;
struct Light { sky: vec4f, sun: vec4f }
@group(1) @binding(8) var<storage, read> LIGHT: Light;
@group(1) @binding(9) var outKey: texture_storage_2d_array<rgba16float, write>;
@group(1) @binding(10) var outDist: texture_storage_2d_array<r32float, write>;
${TRANS_READ}
${NIGHT_SKY_WGSL}
// the air between the eye and the deck: the day sky, and by night the airglow at the drawn sky's share (NIGHT.cloudHaze: the whole
// glow made the far deck glow blue over the clear sky) and the moon's glow whole, both along d (the horizon's azimuth, feat/v2-night-clouds).
// The town domes at the cloud's own height dT (fix/v2-fireworks-view-clouds: taken at the horizon's 1°, every far cloud of the
// towns' half of the sky, 30° up too, took South Lake Tahoe's and Reno's whole dome and read orange), × NIGHT.cloudDomes: a dim warm
// glow on the low deck over the towns only
fn cloudHazeSky(d: vec3f, dT: vec3f) -> vec3f { return textureSampleLevel(tV, sView, skyViewUV(d, horizonElev(Rg + F.sky.z)), 0.0).rgb * F.sky.x + nightSkyKD(d, ${NIGHT.cloudHaze.toFixed(3)}, 0.0) + nightDomes(dT) * ${NIGHT.cloudDomes.toFixed(3)}; }
// the moon's light on the deck (feat/v2-night-clouds): its share of the night land light (sky.js moonShare: the phase and the height)
const MOON_DECK = vec3f(${NIGHT.landColour.map((x) => x.toFixed(3)).join(', ')}) * ${(NIGHT.landLift * NIGHT.moonSky * NIGHT.cloudMoon).toFixed(5)};
const W = ${W}.0; const H = ${H}.0; const N = ${KEY.steps}; const NL = ${KEY.lightSteps};
const SHAPE_M = ${KEY.shapeM}.0; const DETAIL_M = ${KEY.detailM}.0; const WEATHER_M = ${KEY.weatherM}.0; const MAXD = ${KEY.maxDistance}.0;
fn hashT(x: u32, y: u32) -> f32 { var h = x * 374761393u + y * 668265263u + 7u * 1442695041u; h = (h ^ (h >> 13u)) * 1274126177u; return f32(h ^ (h >> 16u)) / 4294967296.0; }
// the storm cell's weight at p (0 fair; 1 inside the cell's core): the shared weather state's cell
const DIRX = ${Math.sin(70 * Math.PI / 180).toFixed(6)}; const DIRZ = ${(-Math.cos(70 * Math.PI / 180)).toFixed(6)};   // the drift (stormArc.js DIR)
// #18: v1's cellMask (src/weather/uniforms.js), without its cover (the callers weight by CL.d.w): the trailing side (upwind,
// behind the core) stretched, the rain's grey stratiform tail following the towers, and the anvil spreading aloft once the
// tower is up (M5e's port was a plain disc, 0.5 to 1 of the radius: the boat 1.4 radii off stood outside a lit wall)
fn cellAt(p: vec3f) -> f32 {
  let anvil = smoothstep(4500.0, 7200.0, p.y) * smoothstep(0.6, 1.0, CL.h.w) * 0.35;
  let rel = p.xz - CL.d.xy; let a = rel.x * DIRX + rel.y * DIRZ;
  let rel2 = rel + vec2f(DIRX, DIRZ) * (min(a, 0.0) * -0.45);
  return (1.0 - smoothstep(0.38, 1.0, length(rel2) / (CL.d.z * (anvil + 1.0)))) * step(0.001, CL.d.w + CL.e.x);
}
struct Base { d: f32, h: f32, q: vec3f, he: f32 }
// the base density: coverage and type from the weather map, the height gradient, the shape (v1's baseDensity)
fn baseDensity(p: vec3f) -> Base {
  var o: Base;
  let m = cellAt(p);
  let th = CL.b.w + CL.e.x * m;
  let h = clamp((p.y - CL.b.z) / th, 0.0, 1.0);
  let q = p - vec3f(CL.c.x, 0.0, CL.c.y);
  let wthr = textureSampleLevel(tWeather, sRep, q.xz / WEATHER_M, 0.0).rg;
  // M5e: v1's storm hooks in the cell (src/weather/uniforms.js clouds): the type toward towers (the whole slab's height), a flat
  // thunderhead base (a 1.5 % fade), the coverage held under 1 so the shape keeps hard sunlit edges
  let mc = m * step(0.001, CL.d.w) * clamp(CL.d.w, 0.0, 1.0);
  let t = mix(clamp(CL.b.y + (wthr.y - 0.5) * 0.5, 0.0, 1.0), 0.97, mc);
  let hTop = mix(0.3, 1.0, t);
  let grad = smoothstep(0.0, mix(mix(0.35, 0.1, t), 0.015, mc), h) * (1.0 - smoothstep(hTop * 0.55, hTop, h));
  let cov = max(clamp(CL.b.x + (wthr.x - 0.5) * 0.7 + m * CL.d.w, 0.0, 1.0), mc * 0.82);
  let shape = textureSampleLevel(tNoise, sRep, q / SHAPE_M, 0.0).r;
  var d = clamp((shape * grad - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0) * clamp(cov * 1.5, 0.0, 1.0);
  let inside = step(CL.b.z, p.y) * step(p.y, CL.b.z + th);
  o.d = d * inside; o.h = h; o.q = q;
  o.he = max(h, mc);   // #18: v1's height hook: billowy erosion in the cell
  return o;
}
// the erosion: the detail octave, wispy under and billowy above
fn erode(b: Base) -> f32 {
  let det = textureSampleLevel(tNoise, sRep, (b.q + vec3f(0.0, CL.c.z * 2.0, 0.0)) / DETAIL_M, 0.0).g;
  let dm = mix(det, 1.0 - det, clamp(b.he * 4.0, 0.0, 1.0));
  return clamp((b.d - dm * 0.3) / 0.7, 0.0, 1.0);
}
fn hg(c: f32, g: f32) -> f32 { return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5) / (4.0 * PI); }
// one segment of the march: n samples, quadratically spaced from t0 to t1, into the running light, transmittance and
// distance sum
struct Lit { sun: vec3f, top: vec3f, bot: vec3f, ph: f32, step: f32 }
struct Acc { L: vec3f, T: f32, tSum: f32 }
fn marchSeg(ro: vec3f, dir: vec3f, s: vec3f, t0: f32, t1: f32, n: i32, jit: f32, li: Lit, acc: ptr<function, Acc>) {
  let dens = CL.e.z; let th0 = CL.b.w; let seg = t1 - t0;
  for (var i = 0; i < n; i++) {
    let x = (f32(i) + jit) / f32(n);
    let t = t0 + seg * x * x;
    let dt = seg * (x * 2.0 + 1.0 / f32(n)) / f32(n);
    let p = ro + dir * t;
    let b = baseDensity(p);
    if (b.d > 0.0) {
      let m = cellAt(p);   // M5e: v1's storm hooks: dense towers (hard cauliflower edges, dark bases), the sky's light scattered in sideways
      let d = erode(b) * smoothstep(0.0, 20.0, t) * (1.0 + 1.6 * m * CL.d.w);
      if (d > 0.002) {
        var od = 0.0;
        for (var k = 0; k < NL; k++) {
          let sk = (f32(k) + 0.5) * (1.0 + f32(k) * 0.5);
          od += baseDensity(p + s * (li.step * sk)).d * (li.step * (1.0 + f32(k) * 0.5));
        }
        let sigma = d * dens;
        let beer = exp(-od * dens); let beerSoft = exp(-od * dens * 0.12) * 0.25;
        let powder = 1.0 - exp(-sigma * 120.0);
        // #18: v1's sunFloor: inside a thunderhead the light scatters on (0 with no storm: the old value)
        let sunL = li.sun * max(max(beer, beerSoft), CL.d.w * 0.06) * li.ph * mix(0.5, 1.0, powder);
        let odUp = (baseDensity(p + vec3f(0.0, th0 * 0.06, 0.0)).d + baseDensity(p + vec3f(0.0, th0 * 0.18, 0.0)).d) * th0 * 0.125;
        let skyVis = max(exp(-odUp * dens), CL.d.w * 0.3);   // #18: v1's skyFloor (no black voids in a dense cell)
        let amb = max(mix(li.bot, li.top * skyVis, b.h), li.top * 0.8 * m * CL.d.w * F.rain.x);   // #18: M5e's floor in the cell only in the rain (outside it lit the anvil's base near white)
        let Tstep = exp(-sigma * dt);
        let a = (*acc).T * (1.0 - Tstep);
        (*acc).L += (sunL + amb) * a; (*acc).tSum += a * t;
        (*acc).T *= Tstep;
      }
    }
    if ((*acc).T < 0.01) { break; }
  }
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  let y = g.y + u32(CL.c.w);
  if (g.x >= u32(W) || g.y >= u32(CL.f.z) || y >= u32(H)) { return; }
  let layer = i32(CL.e.w);
  let u = (f32(g.x) + 0.5) / W; let v = (f32(y) + 0.5) / H;
  let az = (u - 0.5) * 2.0 * PI; let e = v * v * PI * 0.5;
  let dir = vec3f(cos(e) * cos(az), sin(e), cos(e) * sin(az));
  let ro = F.cam.xyz;
  var acc: Acc; acc.L = vec3f(0.0); acc.T = 1.0; acc.tSum = 0.0; var L = vec3f(0.0); var T = 1.0;
  let th0 = CL.b.w; let base = CL.b.z; let top = base + th0 + CL.e.x;
  let dy = max(dir.y, 1e-5);
  let tBase = (base - ro.y) / dy; let tTop = (top - ro.y) / dy;
  var tNear = max(min(tBase, tTop), 0.0); var tFar = max(tBase, tTop);
  if (ro.y > base && ro.y < top) { tNear = 0.0; }
  tFar = min(tFar, MAXD);
  if (tFar > tNear && dir.y > 1e-5) {
    // the light: the sun's irradiance at the deck's height through the air above it (E / π: the one-octave Beer term
    // loses what multiple scattering carries, v1's sweep), the sky's mean radiance (the frame's record / π) at the top,
    // a third of it below (the ground's bounce), plus the night's floor
    // feat/v2-night-clouds: once the sun is well under the deck's horizon (sine −0.07, about −4°, where its light there is
    // already 0) the deck's light is the moon's, faded in from that switch so nothing steps
    let sunS = normalize(F.sun.xyz);
    let moonLit = sunS.y < -0.07;
    let s = select(sunS, normalize(F.moon.xyz), moonLit);
    let rC = Rg + F.sky.z - F.cam.y * 0.001 + (base + 0.5 * th0) * 0.001;
    var li: Lit;
    // fix(v2) cloud colour: × CL.g, v1's sky light (E, not E / π) and v1's camera (sim/clouds.js cloudLightMatch); 1 at night
    li.sun = F.sky.x * transAt(rC, s.y) * step(0.0, raySphere(vec3f(0.0, rC, 0.0), s, Rg) * -1.0) / PI * CL.g.x;
    if (moonLit) { li.sun = MOON_DECK * moonShare() * transAt(rC, max(s.y, 0.0)) * (1.0 - smoothstep(-0.14, -0.07, sunS.y)) * F.storm.y; }
    let skyL = LIGHT.sky.rgb / PI * CL.g.y;
    let skyC = mix(vec3f(dot(skyL, vec3f(0.2126, 0.7152, 0.0722))), skyL, CL.g.z);
    li.top = (skyC + nightSkyK(vec3f(0.0, 1.0, 0.0), ${NIGHT.cloudAir.toFixed(3)})) * (1.0 - 0.15 * CL.e.y * cellAt(ro + dir * tNear)) * mix(1.0, ${NIGHT.cloudNight.toFixed(3)}, min(F.night.x, 1.0));   // look/v2-night-look: by night the deck takes NIGHT.cloudNight of the sky's light (the night's exposure doubled; grey-blue, not lit white)   // M5e: the cell takes less of the sky's light (v1's deck kept lit edges: 2026-11-13, brighter)
    li.bot = li.top * (0.33 + 0.6 * F.storm.x * F.rain.x);   // M5e: in the rain the deck's undersides take more of the sky's light (v1's storm deck reads lit grey, 2026-11-13: brighter)
    let c = dot(dir, s);
    li.ph = (hg(c, 0.6) * 0.7 + hg(c, -0.25) * 0.3) * 4.0 * PI + 0.1;
    li.step = (th0 + CL.e.x * 0.35) * 0.5 / f32(NL);   // #18: v1's lightThickness: in a thunderhead the sun's ray reaches further (0 slab: the old step)
    let jit = hashT(g.x, y);
    marchSeg(ro, dir, s, tNear, tFar, N, jit, li, &acc);
    L = acc.L; T = acc.T; let tSum = acc.tSum;
    // the air between the eye and the cloud, by its mean distance: the medium at the deck's height, the horizon's sky in
    // this azimuth as the in-scattered colour (the froxels are the screen's; the key is the world's)
    let op = 1.0 - T;
    var tMean = tNear; if (op > 1e-4) { tMean = tSum / op; }
    let ext = medium(Rg + F.sky.z - F.cam.y * 0.001 + (base + 0.5 * th0) * 0.001).ext;
    let Tair = exp(-ext * tMean * 0.001);
    let haze = cloudHazeSky(normalize(vec3f(dir.x, 0.02, dir.z)), dir);
    L = L * Tair + op * haze * (vec3f(1.0) - Tair);
    // far clouds fade into the haze rather than end at MAXD
    let fade = 1.0 - smoothstep(MAXD * 0.5, MAXD, tNear);
    T = mix(1.0, T, fade); L *= fade;
    textureStore(outDist, vec2i(i32(g.x), i32(y)), layer, vec4f(select(1000.0, tMean * 0.001, T < 0.999), 0.0, 0.0, 0.0));
  } else {
    textureStore(outDist, vec2i(i32(g.x), i32(y)), layer, vec4f(1000.0, 0.0, 0.0, 0.0));
  }
  textureStore(outKey, vec2i(i32(g.x), i32(y)), layer, vec4f(L, T));
}`;

// --- the blend (the speed pass): this frame's cross-fade of the last two keys, written once into the key's extra layer
// (BLEND_LAYER), so every reader fetches one layer, not two (the water's mirror reads the key at 5 taps: 10 fetches were
// a quarter of the Sail start's frame at 2560 x 1600). Run after the march, on this frame's params ---
export const BLEND_LAYER = KEY.layers;
export const BLEND_WGSL = `${CLOUD_STRUCT}
@group(0) @binding(0) var<uniform> CL: CloudU;
@group(0) @binding(1) var src: texture_2d_array<f32>;
@group(0) @binding(2) var dst: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let sz = textureDimensions(dst); if (g.x >= sz.x || g.y >= sz.y) { return; }
  let p = vec2i(g.xy);
  textureStore(dst, p, 0, mix(textureLoad(src, p, i32(CL.a.y), 0), textureLoad(src, p, i32(CL.a.x), 0), CL.a.z));
}`;

// --- the blended layer's mip chain (fix(v2) the far water's shimmer, 2026-11-13): the water's mirror reads the key over
// the facets' spread (render/water.js mirrorBlur, water-aa.js cloudTapGrad) at the level whose texel covers its taps'
// spacing, so a tap no longer point-samples cloud edges finer than the spread; re-made each frame after the blend ---
export const keyMips = (rows) => Math.log2(rows) + 1;   // down to one row of elevation (2048 × 512: 10 levels)
export const KEY_MIP_WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
// one level down: the 2 × 2 box mean (premultiplied light and transmittance stay means)
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let sz = textureDimensions(dst); if (g.x >= sz.x || g.y >= sz.y) { return; }
  let p = vec2i(g.xy) * 2;
  textureStore(dst, vec2i(g.xy), (textureLoad(src, p, 0) + textureLoad(src, p + vec2i(1, 0), 0) + textureLoad(src, p + vec2i(0, 1), 0) + textureLoad(src, p + vec2i(1, 1), 0)) * 0.25);
}`;

// --- the GPU side ---
// mode (src/core/features.js phoneClouds; ?phoneclouds=): 'full' the march above (a tablet and a desktop); 'off' (a phone: owner, 2026-11-18)
// no key, no pipeline, 1 x 1 textures: the readers see T = 1 (a clean sky)
export function createClouds({ device, reg, frameBGL, frameBG, U, frameStruct, pixels = 2e6, seed = 1, deck = DECK, on = true, errors = [], mode = 'full' }) {
  const off = mode === 'off';
  const size = off ? [1, 1] : keySizeFor(pixels), [W, H] = size;
  const mips = keyMips(H);   // the far water's shimmer fix: the blended layer's mip chain (KEY_MIP_WGSL)
  const key = device.createTexture({ label: 'cloud-key', size: [W, H, KEY.layers + 1], format: 'rgba16float', mipLevelCount: mips, usage: TEX.STORAGE_BINDING | TEX.TEXTURE_BINDING });
  const dist = device.createTexture({ label: 'cloud-key-dist', size: off ? [1, 1, KEY.layers] : [W, H, KEY.layers], format: 'r32float', usage: TEX.STORAGE_BINDING | TEX.TEXTURE_BINDING });
  const noise = device.createTexture({ label: 'cloud-noise', size: off ? [1, 1, 1] : [SIDE, SIDE, SIDE], dimension: '3d', format: 'rgba8unorm', usage: TEX.STORAGE_BINDING | TEX.TEXTURE_BINDING });
  const weather = device.createTexture({ label: 'cloud-weather', size: off ? [1, 1] : [WSIDE, WSIDE], format: 'rgba8unorm', usage: TEX.STORAGE_BINDING | TEX.TEXTURE_BINDING });
  const keyView = key.createView({ dimension: '2d-array' }), distView = dist.createView({ dimension: '2d-array' });
  const keyStore = key.createView({ dimension: '2d-array', baseMipLevel: 0, mipLevelCount: 1 });   // the march writes level 0
  const sRep = device.createSampler({ label: 'cloud-repeat', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear' });
  const params = new Float32Array(PARAM_FLOATS);
  const paramsBuf = device.createBuffer({ label: 'cloud-params', size: PARAM_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });
  const FR = STAGE.FRAGMENT | STAGE.VERTEX, C = STAGE.COMPUTE;
  // what the sky-read group binds (render/sky.js createSky({ clouds })): the params, the key, its distances
  const bind = {
    layout: [{ binding: 7, visibility: FR, buffer: { type: 'uniform' } }, { binding: 8, visibility: FR, texture: { viewDimension: '2d-array' } }, { binding: 9, visibility: FR, texture: { viewDimension: '2d-array', sampleType: 'unfilterable-float' } }],
    entries: [{ binding: 7, resource: { buffer: paramsBuf } }, { binding: 8, resource: keyView }, { binding: 9, resource: distView }],
  };
  const sched = createKeySchedule({ rows: H });
  const deckNow = { ...DECK, ...deck };
  const state = { on: off ? false : !!on, drift: [0, 0], t: 0, cur: 0, prev: 0, fade: 1, row0: 0, rows: 0, layer: 0, seed, night: 0, weather: null, eyeAt: null, full: 0, bakes: 0 };
  fillParams(params, state);
  device.queue.writeBuffer(paramsBuf, 0, params);

  const bglN = device.createBindGroupLayout({ label: 'cloud-noise', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } }] });
  const bglW = device.createBindGroupLayout({ label: 'cloud-weather', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm' } }] });
  const bgN = device.createBindGroup({ layout: bglN, entries: [{ binding: 0, resource: { buffer: paramsBuf } }, { binding: 1, resource: noise.createView({ dimension: '3d' }) }] });
  const bgW = device.createBindGroup({ layout: bglW, entries: [{ binding: 0, resource: { buffer: paramsBuf } }, { binding: 1, resource: weather.createView() }] });
  if (!off) { const mN = reg.shader('cloud-noise', NOISE_BAKE_WGSL), mW = reg.shader('cloud-weather', WEATHER_BAKE_WGSL);
  reg.add('cloud-noise', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglN] }), compute: { module: mN, entryPoint: 'main' } });
  reg.add('cloud-weather', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglW] }), compute: { module: mW, entryPoint: 'main' } }); }
  // the blend: the march's layers in, the extra layer out (different subresources of the one texture)
  const bglB = device.createBindGroupLayout({ label: 'cloud-blend', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, texture: { viewDimension: '2d-array', sampleType: 'unfilterable-float' } }, { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } }] });
  const bgB = device.createBindGroup({ layout: bglB, entries: [{ binding: 0, resource: { buffer: paramsBuf } }, { binding: 1, resource: key.createView({ dimension: '2d-array', baseArrayLayer: 0, arrayLayerCount: KEY.layers, baseMipLevel: 0, mipLevelCount: 1 }) }, { binding: 2, resource: key.createView({ dimension: '2d-array', baseArrayLayer: BLEND_LAYER, arrayLayerCount: 1, baseMipLevel: 0, mipLevelCount: 1 }) }] });
  if (!off) reg.add('cloud-blend', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglB] }), compute: { module: reg.shader('cloud-blend', BLEND_WGSL), entryPoint: 'main' } });
  // the far water's shimmer fix: the blended layer's chain, level l → l + 1 (views and groups made at load)
  const bglM = device.createBindGroupLayout({ label: 'cloud-key-mip', entries: [{ binding: 0, visibility: C, texture: { sampleType: 'unfilterable-float' } }, { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } }] });
  const lv = (l) => key.createView({ dimension: '2d', baseArrayLayer: BLEND_LAYER, arrayLayerCount: 1, baseMipLevel: l, mipLevelCount: 1 });
  const bgM = Array.from({ length: mips - 1 }, (_, l) => device.createBindGroup({ layout: bglM, entries: [{ binding: 0, resource: lv(l) }, { binding: 1, resource: lv(l + 1) }] }));
  if (!off) reg.add('cloud-key-mip', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglM] }), compute: { module: reg.shader('cloud-key-mip', KEY_MIP_WGSL), entryPoint: 'main' } });
  let bgK = null, baked = false, pending = 0;
  // perf(v2) phone: the key's step every `every`th frame (L2, L3: 2): the march, the blend and the mip chain skip the
  // frames between (the key's cycle takes twice the frames; its cross-fade is linear, so the clouds move as smoothly)
  let every = 1, frameN = 0, idle = false, when = null;
  const stats = { key: size, rows: sched.state.perFrame, cycles: 0, full: 0, bakes: 0, on: state.on, mode,
    // the cloud textures' bytes (key with its mips and layers, distances, the noise, the weather map), for the phone A/B
    texBytes: [key, dist, noise, weather].reduce((a, t) => a + (t.width || 0) * (t.height || 0) * (t.depthOrArrayLayers || 0) * (t === key ? 8 * (4 / 3) : 4), 0) };
  return {
    bind, size, params, paramsBuf, textures: { key, dist, noise, weather }, stats, schedule: sched,
    get on() { return state.on; },
    get deck() { return deckNow; },   // M5e: the deck's numbers now (the weather menu eases its coverage; the storm reads its base and thickness)
    // the key march on the registry (at load): the sky's LUTs, samplers and light record
    attach(sky) {
      if (off) return;   // no march: no key pipeline
      const bglK = device.createBindGroupLayout({ label: 'cloud-key', entries: [
        { binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, texture: { viewDimension: '3d' } }, { binding: 2, visibility: C, texture: {} }, { binding: 3, visibility: C, sampler: {} },
        { binding: 4, visibility: C, texture: {} }, { binding: 5, visibility: C, texture: {} }, { binding: 6, visibility: C, sampler: {} }, { binding: 7, visibility: C, sampler: {} },
        { binding: 8, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 9, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d-array' } },
        { binding: 10, visibility: C, storageTexture: { access: 'write-only', format: 'r32float', viewDimension: '2d-array' } }] });
      bgK = device.createBindGroup({ layout: bglK, entries: [
        { binding: 0, resource: { buffer: paramsBuf } }, { binding: 1, resource: noise.createView({ dimension: '3d' }) }, { binding: 2, resource: weather.createView() }, { binding: 3, resource: sRep },
        { binding: 4, resource: sky.textures.tT.createView() }, { binding: 5, resource: sky.textures.tV.createView() }, { binding: 6, resource: sky.samplers.sLin }, { binding: 7, resource: sky.samplers.sView },
        { binding: 8, resource: { buffer: sky.lightBuf } }, { binding: 9, resource: keyStore }, { binding: 10, resource: distView }] });
      const mK = reg.shader('cloud-key', KEY_WGSL(frameStruct, size));
      reg.add('cloud-key', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bglK] }), compute: { module: mK, entryPoint: 'main' } });
    },
    // once, after buildAll(): the noise and weather tiles (one encoder of their own)
    bakeOnce() {
      if (baked || off) { baked = true; return; }
      const enc = device.createCommandEncoder({ label: 'cloud-bake' });
      const pass = enc.beginComputePass({ label: 'cloud-bake' });
      pass.setPipeline(reg.get('cloud-noise')); pass.setBindGroup(0, bgN); pass.dispatchWorkgroups(SIDE / 4, SIDE / 4, SIDE / 4);
      pass.setPipeline(reg.get('cloud-weather')); pass.setBindGroup(0, bgW); pass.dispatchWorkgroups(WSIDE / 8, WSIDE / 8);
      pass.end();
      device.queue.submit([enc.finish()]);
      baked = true;
    },
    // each frame, before the uniform ring is uploaded: the drift from the shared wind, the schedule's step (the whole
    // key on the first frame and after a camera cut), the params write (one writeBuffer); weather: the shared state
    // cut: the clock's cut mark (main.js: its cuts, + 0.5 while a glide runs): a change re-bakes the whole key at once, so a time
    // pick out of the night (the fireworks' show to Golden hour) never shows the night's black clouds for the key's slow cycle
    // (fix 2026-11-18)
    // drift: the deck's drift (m) from the one wind (v2/sim/weatherWind.js: integrated on the scene clock); without it, the wind's speed × t
    update({ wind, t = 0, eye, night = 0, weather = null, deck: deckIn = null, drift = null, sunElevDeg = 90, cut = 0 }) {
      if (deckIn) Object.assign(deckNow, deckIn);
      if (off) { state.t = t; state.rows = 0; return null; }   // the params stay as made at load: on = 0, the readers see T = 1
      state.weather = weather; state.night = night; state.t = t;
      const d = drift ?? cloudDrift(wind?.speedMs ?? 0, wind?.dirDeg ?? 0, t);
      state.drift[0] = d[0]; state.drift[1] = d[1];
      let all = !state.eyeAt;
      if (eye && state.eyeAt && Math.hypot(eye[0] - state.eyeAt[0], eye[1] - state.eyeAt[1], eye[2] - state.eyeAt[2]) > KEY.cutM) all = true;
      if (state.cut != null && cut !== state.cut) all = true;
      state.cut = cut;
      frameN++;
      idle = !all && every > 1 && (when ? !when() : frameN % every !== 0) && baked;   // perf(v2) phone: a frame between steps: nothing to bake or blend (round 2: when(), the page's phase)
      if (idle) { pending = 0; return null; }
      if (all) state.eyeAt = eye ? [eye[0], eye[1], eye[2]] : [0, 0, 0];
      const st = state.on ? sched.step(all) : null;
      if (st) { state.cur = st.cur; state.prev = st.prev; state.fade = st.fade; state.row0 = st.row0; state.rows = st.rows; state.layer = st.layer; if (all) stats.full++; }
      else { state.rows = 0; }
      pending = state.rows;
      fillParams(params, { ...state, deck: deckNow, weather: state.weather, match: cloudLightMatch(sunElevDeg, state.weather) });
      params[22] = state.rows;
      device.queue.writeBuffer(paramsBuf, 0, params);
      stats.cycles = sched.state.cycles; stats.on = state.on;
      return st;
    },
    // the cloud-key compute pass: this frame's rows (after the aerial pass wrote the light record)
    run(pass, c) {
      if (!state.on || !bgK || idle) return;
      if (pending) {
        pass.setPipeline(reg.get('cloud-key')); pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bgK);
        pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(pending / 8)); c.dispatches++; stats.bakes++;
      }
      pass.setPipeline(reg.get('cloud-blend')); pass.setBindGroup(0, bgB);   // this frame's cross-fade, once, for every reader
      pass.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8)); c.dispatches++;
      pass.setPipeline(reg.get('cloud-key-mip'));   // the far water's shimmer fix: the blended layer's mip chain
      for (let l = 0; l < mips - 1; l++) { pass.setBindGroup(0, bgM[l]); pass.dispatchWorkgroups(Math.ceil(Math.max(W >> (l + 1), 1) / 8), Math.ceil(Math.max(H >> (l + 1), 1) / 8)); c.dispatches++; }
    },
    set(on) { state.on = !!on; },
    setEvery(n, w = null) { every = Math.max(1, n | 0); when = w; },   // perf(v2) phone; round 2: w() says a step frame (the page puts it on the frames the aerial pass skips)
    get every() { return every; },
  };
}
