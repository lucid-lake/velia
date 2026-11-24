// The weather's look in the composite (render/shaders.js TONEMAP; the numbers: v2/sim/weatherLook.js). One small uniform at
// group 2 binding 4 (WLook, 8 × vec4, written once a frame) and two pieces of WGSL:
//   GRADE_WGSL  weatherGrade(e, ndc): the row's grade on the exposed linear colour, before the tone curve: the ASC CDL (slope,
//               offset, power about mid grey), the saturation, the split-tone, the rim toward the sun, the turned-over grad,
//               the cos^4 vignette. Every variant reads it; a uniform branch skips it when the look is the identity (Fair), so
//               the default frame's pixels do not move.
//   LENS_RAIN_WGSL lensRain(px, dim): rain on the lens, in the storm variants only (no storm, no rain): a field of drops hashed
//               on screen-space lattices, each a small lens that shows the frame from a displaced place, the big ones running
//               down the glass with a trail, the way down turned by the air across the lens. One extra texel read a pixel, no
//               blur; off at amount 0 (a uniform branch).
// The lens is ported from web-ocean-3d's src/post/LensRain.ts (MIT, Copyright (c) 2026 Pranshul Chandhok and the Web Ocean 3D
// contributors; the notice in v2/render/LICENSE-web-ocean-3d.txt, ATTRIBUTION.md): its lattice of drops (one per cell, no
// neighbour search), Marshall-Palmer sizes, Furmidge's run-off radius, the stick-slip travel, the trails, the cap's normal and
// the refraction through it (Snell at 1/1.333, the image plane a few radii behind the drop), the clumping and the downhill
// bias, the glint. Ours: WGSL in our composite on the HDR texture by textureLoad, two lattices plus a third, no glass gather
// (the defocus between drops: the most expensive part of theirs, and what their own critic found took the swell out of the sea).
import { WLOOK_FLOATS } from '../sim/weatherLook.js';

const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64 };

export const WLOOK_WGSL = `struct WLook { g0: vec4f, g1: vec4f, g2: vec4f, g3: vec4f, g4: vec4f, g5: vec4f, l0: vec4f, l1: vec4f }
@group(2) @binding(4) var<uniform> WL: WLook;`;

// needs viewDir (FULLSCREEN) and F (HEAD)
export const GRADE_WGSL = `
const WLUMA = vec3f(0.2126, 0.7152, 0.0722);
fn weatherGrade(e0: vec3f, ndc: vec2f) -> vec3f {
  let pv = WL.g3.w;
  var e = pv * pow(max(e0 * WL.g0.xyz, vec3f(0.0)), WL.g2.xyz) + WL.g1.xyz;   // the CDL: slope (the tint over mid grey), power (the contrast), offset
  let l = dot(e, WLUMA);
  e = max(mix(vec3f(l), e, WL.g0.w), vec3f(0.0));                             // the saturation
  let l2 = dot(e, WLUMA);
  let ws = 1.0 - smoothstep(0.0, pv * 2.0, l2); let wh = smoothstep(pv, pv * 8.0, l2); let wr = smoothstep(pv * 3.0, pv * 14.0, l2);
  let dir = viewDir(ndc);
  // the rim: the brightest parts (the lit edges, the gaps, the glint) warmed and lifted toward the sun, more where it breaks through
  let toward = 0.45 + 0.55 * smoothstep(0.3, 1.0, dot(dir, normalize(F.sun.xyz)));
  let rimK = WL.g4.w * wr * toward * (0.35 + 0.65 * WL.g5.y);
  e *= (vec3f(1.0) + (WL.g3.xyz - 1.0) * ws) * (vec3f(1.0) + (WL.g4.xyz - 1.0) * wh) * (vec3f(1.0) + rimK * vec3f(1.0, 0.9, 0.74));
  // the grad: a heavy sky overhead and dark water under a bright band at the horizon, where the light comes in under the deck
  let up = smoothstep(-0.004, 0.012, dir.y); let high = smoothstep(0.05, 0.45, dir.y); let band = smoothstep(-0.01, 0.02, dir.y) * (1.0 - smoothstep(0.03, 0.12, dir.y));   // the band on the sky side only: the far water keeps the water's grade
  let g = mix(1.0 - 0.25 * WL.g5.x, 1.0 - 0.6 * WL.g5.x * high, up) * (1.0 + 0.3 * WL.g5.x * band);
  let q = vec2f(ndc.x * WL.g5.z, ndc.y) * WL.g5.w; let t2 = dot(q, q); let c4 = 1.0 / ((1.0 + t2) * (1.0 + t2));   // cos^4 of the field angle
  return e * g * mix(1.0, c4, WL.g1.w);
}`;

export const LENS = Object.freeze({ roll: 0.014, cap: 0.9, depth: 6.5, eta: 1 / 1.333, glint: 0.55, glintPow: 26, glintHdr: 0.35, rimDark: 0.3 });
const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
export const LENS_RAIN_WGSL = `
// one PCG hash a cell (O'Neill's output permutation), its four values by LCG steps from it
fn lrPcg(v: u32) -> u32 { let st = v * 747796405u + 2891336453u; let w = ((st >> ((st >> 28u) + 4u)) ^ st) * 277803737u; return (w >> 22u) ^ w; }
fn lrHash(c: vec2f, seed: u32) -> vec4f {
  let i = vec2i(floor(c));
  let a = lrPcg(((bitcast<u32>(i.x) * 73856093u) ^ (bitcast<u32>(i.y) * 19349663u)) ^ (seed * 83492791u));
  let b = a * 1664525u + 1013904223u; let c2 = b * 1664525u + 1013904223u; let d = c2 * 1664525u + 1013904223u;
  return vec4f(vec4u(a, b, c2, d) >> vec4u(8u)) * (1.0 / 16777216.0);
}
fn lrNoise(p: vec2f) -> f32 {   // a smooth clumping field 0–1 (two crossed waves: cheaper than a value noise, and it only has to clump)
  return 0.5 + 0.25 * sin(p.x * 2.3 + sin(p.y * 1.7) * 1.3) + 0.25 * sin(p.y * 2.9 - p.x * 0.8 + 1.7);
}
// one lattice: q in screen heights in the gravity frame (y downhill); returns (normal x, y in that frame, cover, the image depth)
fn lrLayer(q: vec2f, grid: vec2f, size: vec2f, tune: vec4f, seed: u32, density: f32, pxH: f32) -> vec4f {
  let cs = 1.0 / grid; let g = q * grid; let cell = floor(g); let local = fract(g);
  let h = lrHash(cell, seed);
  let act = clamp((density * tune.x - h.z) * 6.0, 0.0, 1.0);                       // the population, not the opacity: the rain's rate
  if (act <= 0.0) { return vec4f(0.0); }                                            // an empty cell (most of them in light rain): nothing more to do
  let h2 = lrHash(cell + vec2f(19.0, 7.0), seed + 1u);
  let spread = clamp(-log(1.0 - h.w * 0.985) / 3.0, 0.0, 1.0);                    // Marshall-Palmer: most drops small
  let rBase = max(mix(size.x, size.y, spread), 1.6 * pxH);
  let margin = min(vec2f(rBase) / cs + vec2f(0.04), vec2f(0.42));
  let rolls = smoothstep(${f(LENS.roll)}, ${f(LENS.roll * 1.35)}, rBase);           // Furmidge: above the radius a drop runs
  let life = fract(WL.l1.x * tune.y * mix(0.55, 1.45, h2.y) + h2.x);
  let travel = life - mix(0.5, 0.97, h2.z) * sin(life * 25.1327412) / 25.1327412;   // stick-slip: four pinning events a traverse
  let spanY = 1.0 - margin.y * 2.0;
  let cx = mix(margin.x, 1.0 - margin.x, h.x);
  let cy = mix(mix(margin.y, 1.0 - margin.y, h.y), margin.y + travel * spanY, rolls);
  let env = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.7 + rolls * 0.2, 1.0, life));
  let radius = rBase * env * act;
  let delta = (local - vec2f(cx, cy)) * cs; let dist = length(delta); let dn = dist / max(radius, 1e-5);
  let cover = 1.0 - smoothstep(0.78, 1.0, dn);
  let capN = delta / max(dist, 1e-5) * (min(dn, 1.0) * ${f(LENS.cap)});           // a spherical cap: flat at the apex, steep at the rim
  if (rolls * tune.z <= 0.0) { return vec4f(capN, cover, radius * smoothstep(0.0, 0.08, cover)); }   // a bead: no trail
  // the trail: a chain of pinned beads behind a runner, narrowing upward, wandering
  let px = local * cs; let behind = cy * cs.y - px.y; let span = max(travel * spanY * cs.y, 1e-5);
  let along = clamp(behind / span, 0.0, 1.0);
  let wob = (sin(px.y / (rBase * 8.0) * 6.2831853 + h2.w * 53.0) * 0.5) * rBase * 0.9;
  let bead = 0.7 + 0.6 * (0.5 + 0.5 * sin(px.y / (rBase * 2.0) * 6.2831853 + h2.w * 91.0));
  let halfW = radius * mix(0.7, 0.22, along) * bead;
  let lateral = px.x - cx * cs.x - wob; let tn = abs(lateral) / max(halfW, 1e-5);
  let trail = (1.0 - smoothstep(0.55, 1.0, tn)) * smoothstep(0.0, radius * 0.3, behind) * (1.0 - smoothstep(span * 0.5, span, behind)) * env * rolls * tune.z;
  let trailN = vec2f(sign(lateral) * min(tn, 1.0) * ${f(LENS.cap * 0.75)}, 0.0);
  let pick = select(0.0, 1.0, trail > cover);                                     // the nearer surface wins (a bead over its trail)
  let wet = max(cover, trail);
  return vec4f(mix(capN, trailN, pick), wet, mix(radius, halfW, pick) * smoothstep(0.0, 0.08, wet));
}
// the lens at a fragment: (the image's offset in pixels, the drop's cover, its light: + the glint, − the dark rim)
fn lensRain(fragPx: vec2f, dim: vec2f) -> vec4f {
  let aspect = dim.x / dim.y; let p = fragPx / dim.y;                               // one unit = one screen height; y down
  let down = WL.l0.yz; let tangent = vec2f(-down.y, down.x);
  let q = vec2f(dot(p, tangent), dot(p, down));
  let clump = lrNoise(p * 1.7 + vec2f(WL.l1.x * 0.013, -WL.l1.x * 0.009));
  let bias = 1.0 + dot(p - vec2f(aspect * 0.5, 0.5), down) * 0.25;                 // run-off collects downhill
  let density = clamp(WL.l0.x * mix(0.45, 1.55, clump) * bias, 0.0, 1.2);
  let pxH = 1.0 / dim.y;
  var fl = lrLayer(q, vec2f(7.0, 2.6), vec2f(0.014, 0.036), vec4f(0.72, 0.14, 0.5, 0.0), 11u, density, pxH);     // runners
  let b = lrLayer(q, vec2f(19.0, 19.0), vec2f(0.004, 0.013), vec4f(0.95, 0.03, 0.0, 0.0), 37u, density, pxH);    // beads
  fl = select(fl, b, b.z > fl.z);
  if (WL.l1.y > 2.5) {   // the middle grade: a third lattice where the budget allows (fillLookRecord: lensLayers)
    let m = lrLayer(q, vec2f(11.0, 7.0), vec2f(0.007, 0.026), vec4f(0.8, 0.09, 0.35, 0.0), 91u, density, pxH);
    fl = select(fl, m, m.z > fl.z);
  }
  let cover = clamp(fl.z, 0.0, 1.0);
  let n = tangent * fl.x + down * fl.y;
  let s2 = min(dot(n, n), 0.999); let nz = sqrt(1.0 - s2); let eta = ${f(LENS.eta)};
  let k = sqrt(max(1.0 - s2 * eta * eta, 0.0)); let bend = nz * eta - k; let fw = max((k - nz * eta) * nz + eta, 0.2);
  let off = n * (bend / fw) * fl.w * ${f(LENS.depth)};                              // Snell through the cap; the image plane a few radii back
  let n3 = vec3f(n, nz);
  let glint = pow(max(dot(n3, normalize(vec3f(-0.34, -0.58, 0.74))), 0.0), ${f(LENS.glintPow)}) * ${f(LENS.glint)} * cover;
  let rim = smoothstep(0.55, 0.9, sqrt(s2) / ${f(LENS.cap)}) * cover * ${f(LENS.rimDark)};
  return vec4f(off * dim.y, cover, glint - rim);
}`;

export function createWeatherLookBuffer(device) {
  const data = new Float32Array(WLOOK_FLOATS);
  data[2] = data[1] = data[0] = 1 / 0.18; data[3] = 1; data[8] = data[9] = data[10] = 1; data[12] = data[13] = data[14] = 1; data[15] = 0.18;
  data[16] = data[17] = data[18] = 1; data[21] = 1; data[22] = 16 / 9; data[23] = 0.5; data[26] = 1;
  const buffer = device.createBuffer({ label: 'weather-look', size: WLOOK_FLOATS * 4, usage: BUF.UNIFORM | BUF.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  return { data, buffer, write(queue) { queue.writeBuffer(buffer, 0, data); } };
}
