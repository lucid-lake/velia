// Play as Tessie, phase 2b (§ 3.8): the light under the water. In the deferred 'under' group (only where
// src/core/features.js tessieUnder is on), drawn only while the eye is under (UNDER_STATE.on): every frame above the water is the frame
// it always was.
//   the shafts   (full tier only: L0-L1) the sun's light scattered toward the eye along each view ray, broken by the waves' real focus:
//                a half-resolution ray march (24 steps at L0, 12 at L1) to the scene's depth, capped at SHAFT.maxM and at the surface;
//                at each step the light reaching that point down the refracted sun (Tahoe's K), the waves' caustic where that ray
//                entered the water (render/caustics.js layer 0: the 12 m cascade's three slices, so the shafts move with the waves),
//                the terrain's sun shadow and the boat's shadow map at the entry (the cliffs' and the hull's shadow columns), the image
//                fading to the eye by the water's σ, a forward phase (0.2 + 2 μ³). The start of each ray is jittered per pixel by
//                interleaved gradient noise fixed in time (no flicker: the same jitter every frame), then a depth-aware 3 × 3 blur and a
//                depth-aware 4-tap upsample add it onto the frame's colour. Abyssal Garden's W_RAYS, W_RBLUR and W_POST's upsample (MIT
//                © 2026 Maksymilian Dendura, render/LICENSE-abyssal-garden.txt), driven by our caustics and shadow maps instead of its
//                trig pattern and rock shadows. Strength by the sun's height (none at night, fading at dusk), less in chop, almost none
//                in a storm; it eases in over the eye's first 0.8 m under the surface.
//   the specks   silt and pollen drifting in a SPECK.boxM box that wraps round the eye (fract): small (6–26 mm), soft, lit by the light
//                left at their depth, faded when smaller than SPECK.minPx (their light kept: no sub-pixel shimmer), at the box's edge,
//                near the lens and into the water's own light with distance; no twinkle. 6000 at the full tier, 2000 at the lite.
//                Abyssal Garden's vsSnow / fsSnow pattern (MIT), positions from a hash of the instance (no buffer, deterministic).
//   the bubbles  rising, wobbling, rimmed sprites with two highlights (Abyssal Garden's vsBub / fsBub, MIT), premultiplied: from
//                Tessie when she runs, turns sharply, dives fast or breaches, and from the motoring boats' propellers near the eye. A
//                pool of BUBBLES.max on the CPU (seeded, stepped on the sim's clock: deterministic), one storage buffer.
import { ATMO_WGSL, SKY_READ } from './sky.js';
import { WATER_WGSL } from './terrain.js';
import { UNDER_WGSL } from './underMedium.js';
import { FULLSCREEN } from './shaders.js';
import { CAUSTICS } from './caustics.js';
import { SHADOW_STRUCT } from './shadow-read.js';

export const SHAFT = Object.freeze({ steps: Object.freeze([24, 12]), maxM: 40, scatter: Object.freeze([0.018, 0.026, 0.03]), base: 0.015, pat: Object.freeze([0.95, 1.7]), lod: 2.5,
  sunIn: Object.freeze([0.03, 0.45]), chop: Object.freeze([5, 14, 0.55]), storm: 0.9, eyeIn: Object.freeze([0.05, 0.8]), gain: 1.5 });
export const SPECK = Object.freeze({ full: 6000, lite: 2000, boxM: 30, minPx: 1.6, size: Object.freeze([0.008, 0.03]), drift: Object.freeze([0.05, 0.012, 0.03]), wander: 0.25, albedo: 0.55, gain: 2.0, stretch: Object.freeze([0.15, 3.5]) });   // stretch (the felt speed): each speck drawn 1 + min(3.5 − 1, v · 0.15) × its disc along its motion past the eye, its light spread over the streak
// the streak's length factor for the specks' speed past the eye (m/s): 1 at rest, 2.65 at 11 m/s, 3.5 from about 17 m/s
export const speckStretch = (v) => 1 + Math.min(SPECK.stretch[1] - 1, Math.max(0, v) * SPECK.stretch[0]);
export const BUBBLES = Object.freeze({ max: 1200, life: Object.freeze([3, 7]), rise: Object.freeze([0.16, 2.2]), run: 160, turn: 60, dive: 60, breach: 260, fall: 320, prop: 14, propM: 80, turnDeg: 25, diveV: 3.0 });

// the strength of the shafts for a sun (y of its unit vector), the wind (m/s), the storm (0–1) and the eye's depth (m): the CPU's rule, tested
import { smooth } from '../../src/sim/core/math.js';
export function shaftStrength({ sunY = 0, wind = 0, storm = 0, eyeDepth = 0 } = {}, S = SHAFT) {
  if (!(sunY > 0)) return 0;
  return S.gain * smooth(S.sunIn[0], S.sunIn[1], sunY) * (1 - S.chop[2] * smooth(S.chop[0], S.chop[1], wind)) * (1 - S.storm * Math.min(1, Math.max(0, storm))) * smooth(S.eyeIn[0], S.eyeIn[1], eyeDepth);
}

const f3 = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
const [CL0] = CAUSTICS.layers;
// the bits of the shafts every pass shares: the medium (UNDER_WGSL needs the frame, the sky's light and the water's constants)
const MEDIUM = `${ATMO_WGSL}
${SKY_READ}
${WATER_WGSL}
${UNDER_WGSL}`;

const SHAFT_WGSL = (frameStruct, ms) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${FULLSCREEN}
${MEDIUM}
${SHADOW_STRUCT}
struct BoatSh { vp: mat4x4f, dir: vec4f, nav: array<vec4f, 4> }
struct ShaftU { a: vec4f, b: vec4f }   // a: steps, max m, strength, 0; b: the pattern's smoothstep lo, hi, the base, the caustic's lod
@group(2) @binding(0) var tDepth: ${ms ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
@group(2) @binding(1) var tCau: texture_2d_array<f32>;
@group(2) @binding(2) var sRep: sampler;
@group(2) @binding(3) var tTSh: texture_depth_2d;
@group(2) @binding(4) var sTSh: sampler_comparison;
@group(2) @binding(5) var<uniform> SH: Shadow;
@group(2) @binding(6) var tBSh: texture_depth_2d;
@group(2) @binding(7) var sBSh: sampler_comparison;
@group(2) @binding(8) var<uniform> BS: BoatSh;
@group(2) @binding(9) var<uniform> U: ShaftU;
const CT_L0 = ${CL0.tile.toFixed(4)}; const CT_A = vec3f(${CL0.slices.map((s) => s.depth.toFixed(2)).join(', ')});
const SH_B = ${f3(SHAFT.scatter)};
fn sliceMixS(c: vec3f, dep: f32) -> f32 {
  let a = clamp((dep - CT_A.x) / (CT_A.y - CT_A.x), 0.0, 1.0); let b = clamp((dep - CT_A.y) / (CT_A.z - CT_A.y), 0.0, 1.0);
  return select(mix(c.g, c.b, b), mix(c.r, c.g, a), dep < CT_A.y);
}
// the hull's shadow (the boat's own map, one tap; 1 outside its box or with the sun down)
fn boatShadow(p: vec3f) -> f32 {
  if (BS.dir.w < 0.5) { return 1.0; }
  let lp = BS.vp * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z < 0.0 || lp.z > 1.0) { return 1.0; }
  return textureSampleCompareLevel(tBSh, sBSh, uv, lp.z - 0.002);
}
fn terrShadow(p: vec3f) -> f32 {
  if (SH.p.x < 0.5) { return 1.0; }
  let lp = SH.vp * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z < 0.0 || lp.z > 1.0) { return 1.0; }
  return textureSampleCompareLevel(tTSh, sTSh, uv, lp.z - SH.p.y * 2.0);
}
// interleaved gradient noise (Jimenez 2014): the ray's start, fixed in time (the same every frame: nothing flickers)
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let px = vec2i(v.pos.xy) * 2;
  let dims = vec2i(textureDimensions(tDepth));
  let pc = min(px, dims - 1);
  let dz = textureLoad(tDepth, pc, 0);
  let ndc = vec2f((f32(pc.x) + 0.5) * F.res.z * 2.0 - 1.0, 1.0 - (f32(pc.y) + 0.5) * F.res.w * 2.0);
  let rd = viewDir(ndc);
  var tS = 1e4;
  if (dz > 0.0) { let h = F.invViewProj * vec4f(ndc, dz, 1.0); tS = distance(h.xyz / h.w, F.cam.xyz); }
  var tm = min(tS, U.a.y);
  if (rd.y > 1e-4) { tm = min(tm, max((F.under.y - F.cam.y) / rd.y, 0.0)); }
  let n = i32(U.a.x);
  let dt = tm / f32(n);
  let j = ign(v.pos.xy);
  let su = umSunU();
  let d0 = umEyeD();
  let sig = umSigma(0.5 * (d0 + max(-(F.cam.y + rd.y * tm), 0.0)));
  var acc = vec3f(0.0);
  for (var k = 0; k < n; k++) {
    let t = (f32(k) + j) * dt;
    let p = F.cam.xyz + rd * t;
    let dp = max(-p.y, 0.0);
    let e = p.xz + su.xz / su.y * dp;                 // where the sun's ray to p entered the water
    let c = textureSampleLevel(tCau, sRep, e / CT_L0, 0, U.b.w).rgb;
    let pat = smoothstep(U.b.x, U.b.y, sliceMixS(c, dp));
    let ent = vec3f(e.x, 0.0, e.y);
    let vis = terrShadow(ent) * boatShadow(ent);
    acc += exp(-sig * t - WK * dp / su.y) * vis * (U.b.z + pat);
  }
  let mu = max(dot(rd, su), 0.0);
  let ph = 0.2 + 2.0 * mu * mu * mu;
  let L = LIGHT.sun.rgb * acc * dt * SH_B * ph * U.a.z * umKeep();
  return vec4f(min(L, vec3f(64.0)), min(tS, 1e4));
}`;

// the depth-aware 3 × 3 blur of the half-resolution shafts (hides the jitter's grain; a = the scene's distance)
const SHAFT_BLUR_WGSL = `
struct VOut { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut { var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); var o: VOut; o.pos = vec4f(p[i], 0.0, 1.0); return o; }
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let p = vec2i(v.pos.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.0); var ws = 0.0;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y), vec2i(0), mx), 0);
    let w = 1.0 / (0.03 + abs(r.a - c.a) / max(c.a, 1e-3));
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}`;

// the depth-aware upsample onto the frame's colour (added: blend one, one; the alpha kept)
const SHAFT_UP_WGSL = (frameStruct, ms) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${FULLSCREEN}
@group(1) @binding(0) var tR: texture_2d<f32>;
@group(1) @binding(1) var tDepth: ${ms ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let px = vec2i(v.pos.xy);
  let dz = textureLoad(tDepth, px, 0);
  var tf = 1e4;
  if (dz > 0.0) { let h = F.invViewProj * vec4f(v.ndc, dz, 1.0); tf = min(distance(h.xyz / h.w, F.cam.xyz), 1e4); }
  let hp = v.pos.xy * 0.5 - 0.5; let b = floor(hp); let fr = hp - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.0); var ws = 0.0;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1.0 - fr.x, fr.x, f32(o.x)) * mix(1.0 - fr.y, fr.y, f32(o.y));
    let w = (bw + 0.02) / (0.02 + abs(r.a - tf) / tf);
    acc += r.rgb * w; ws += w;
  }
  return vec4f(acc / ws, 0.0);
}`;

// the specks and the bubbles: drawn in the scene pass (depth-tested, no depth written) while the eye is under
const SPRITE_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${MEDIUM}
struct SpriteU { right: vec4f, up: vec4f, k: vec4f }   // right.xyz, the focal (px); up.xyz, 0; k: the specks' strength, then the specks' motion past the eye (xyz, m/s: minus the eye's)
@group(2) @binding(0) var<uniform> SU: SpriteU;
@group(2) @binding(1) var<storage, read> BUB: array<vec4f>;   // 2 a bubble: (x, y, z, radius), (seed, alpha, age, 0)
const SP_BOX = ${SPECK.boxM.toFixed(1)}; const SP_MINPX = ${SPECK.minPx.toFixed(2)}; const SP_S0 = ${SPECK.size[0].toFixed(4)}; const SP_S1 = ${SPECK.size[1].toFixed(4)};
const BUB_MINPX = 1.5;
const SP_STR0 = ${SPECK.stretch[0].toFixed(3)}; const SP_STR1 = ${SPECK.stretch[1].toFixed(3)};
const SP_DRIFT = ${f3(SPECK.drift)}; const SP_WANDER = ${SPECK.wander.toFixed(3)}; const SP_ALB = ${SPECK.albedo.toFixed(3)};
struct SO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f, @location(2) wp: vec3f }
fn corner(vi: u32) -> vec2f { var q = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)); return q[vi]; }
fn hash1(n: u32) -> f32 { var x = n * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x; return f32(x) / 4294967296.0; }
@vertex fn vsSpeck(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO {
  var o: SO; let q = corner(vi); let t = F.cam.w;
  let h = vec3f(hash1(ii * 4u), hash1(ii * 4u + 1u), hash1(ii * 4u + 2u)); let w = hash1(ii * 4u + 3u);
  var p = h * SP_BOX + SP_DRIFT * t + SP_WANDER * vec3f(sin(t * 0.21 + h.x * 60.0), sin(t * 0.17 + h.y * 50.0), cos(t * 0.19 + h.z * 70.0));
  p = F.cam.xyz + (fract((p - F.cam.xyz) / SP_BOX + 0.5) - 0.5) * SP_BOX;
  let d = max(distance(p, F.cam.xyz), 1e-3);
  let sz = SP_S0 + (SP_S1 - SP_S0) * w * w * w;
  let rMin = SP_MINPX * d / SU.right.w;              // the radius one SP_MINPX disc needs at d (m)
  let r = max(sz, rMin);
  var keep = (sz / r) * (sz / r);                     // a speck smaller than the disc: its light spread over it (kept, never shimmering)
  // the felt speed: stretched along its motion past the eye (its screen-plane part), up to SP_STR1 × the disc, its light spread over the
  // streak (never brighter); a particle's own shape, not frame blur. At rest the disc as before
  var ax = SU.right.xyz; var ay = SU.up.xyz; var len = 1.0;
  let vr = SU.k.yzw; let vs = length(vr);
  if (vs > 0.05) {
    let toE = (F.cam.xyz - p) / d; let vd = vr / vs; let vp = vd - toE * dot(vd, toE); let lp = length(vp);
    if (lp > 1e-3) { ay = vp / lp; ax = cross(ay, toE); len = 1.0 + (min(SP_STR1 - 1.0, vs * SP_STR0)) * lp; keep = keep / len; }
  }
  let wpos = p + (ax * q.x + ay * q.y * len) * r;
  o.pos = F.viewProj * vec4f(wpos, 1.0); o.uv = q; o.wp = p;
  let fade = (1.0 - smoothstep(SP_BOX * 0.34, SP_BOX * 0.5, d)) * smoothstep(0.35, 1.2, d) * (1.0 - smoothstep(-0.9, -0.25, p.y - F.under.y));   // (Safari: never a reversed smoothstep)
  o.pr = vec4f(fade * keep * SU.k.x, d, w, 0.0);
  return o;
}
@fragment fn fsSpeck(v: SO) -> @location(0) vec4f {
  let r = length(v.uv);
  let m = 1.0 - smoothstep(0.15, 1.0, r);
  let dp = max(-v.wp.y, 0.0);
  let c = umEd(dp) * SP_ALB / PI * mix(vec3f(1.0), vec3f(0.85, 1.0, 0.92), v.pr.z) * umKeep();
  let dir = (v.wp - F.cam.xyz) / v.pr.y;
  let T = exp(-umSigma(0.5 * (umEyeD() + dp)) * v.pr.y);
  return vec4f(max(c * T * m * m * v.pr.x, vec3f(0.0)), 0.0);
}
@vertex fn vsBub(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SO {
  var o: SO; let q = corner(vi); let t = F.cam.w;
  let a = BUB[ii * 2u]; let b = BUB[ii * 2u + 1u];
  var p = a.xyz;
  let wob = 0.02 + a.w * 2.0;
  p.x += sin(t * 7.0 + b.x * 50.0 + b.z * 3.0) * wob;
  p.z += cos(t * 6.1 + b.x * 33.0 + b.z * 2.6) * wob;
  let sz = a.w * smoothstep(0.0, 0.15, b.z);
  let d = max(distance(p, F.cam.xyz), 0.1);
  let r = max(sz, BUB_MINPX * d / SU.right.w);        // never under BUB_MINPX: a smaller bubble's light spread over the disc (no sparkle)
  let wpos = p + (SU.right.xyz * q.x + SU.up.xyz * q.y) * r;
  o.pos = F.viewProj * vec4f(wpos, 1.0); o.uv = q; o.wp = p;
  o.pr = vec4f(b.x, (sz / r) * (sz / r), b.y, 0.0);
  return o;
}
@fragment fn fsBub(v: SO) -> @location(0) vec4f {
  let r = length(v.uv);
  let aa = max(fwidth(r) * 1.5, 0.02);
  let disc = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  let rim = smoothstep(0.55, 0.98, r);
  let hl = (1.0 - smoothstep(0.0, 0.34, length(v.uv - vec2f(-0.36, 0.42)))) + 0.5 * (1.0 - smoothstep(0.0, 0.2, length(v.uv - vec2f(0.4, -0.42))));
  let dp = max(-v.wp.y, 0.0);
  let hi = umLinf(vec3f(0.0, 1.0, 0.0), dp) * 1.5;
  let lo = umLinf(vec3f(0.0, -1.0, 0.0), dp);
  let E = umEd(dp) / PI * umKeep();
  var c = mix(lo, hi, smoothstep(-0.5, 0.8, v.uv.y + rim * 0.4)) * (0.7 + 2.6 * rim) + E * hl * 2.0;   // a silver rim (the light of the window caught round it), two highlights
  var al = disc * clamp(0.12 + rim * rim * 0.95 + hl, 0.0, 1.0) * v.pr.z * sqrt(v.pr.y);   // a bubble smaller than the disc: fainter (its light spread)
  let vv = v.wp - F.cam.xyz; let d = max(length(vv), 1e-3);
  let T = exp(-umSigma(0.5 * (umEyeD() + dp)) * d) * smoothstep(0.25, 0.8, d);
  c = c * T + umLinf(vv / d, umEyeD()) * (1.0 - T);
  al *= mix(0.35, 1.0, T.g);
  return vec4f(min(max(c * al, vec3f(0.0)), vec3f(20.0)), al);
}`;

// the bubbles' pool: seeded, stepped on the sim's clock (deterministic); emit(n, at(i, rnd) → [x, y, z, radius]) adds n
export function createBubblePool({ max = BUBBLES.max, seed = 7 } = {}) {
  const a = new Float32Array(max * 8);   // x, y, z, r, seed, alpha, age, life
  let n = 0, s = seed >>> 0, emitted = 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const self = {
    get count() { return n; }, get emitted() { return emitted; }, data: a, rnd,
    emit(k, at) {
      for (let i = 0; i < k; i++) {
        let j = n; if (n < max) n++; else { j = Math.floor(rnd() * max); }   // full: replace one at random (never a growing pool)
        const p = at(i, rnd); const o = j * 8;
        a[o] = p[0]; a[o + 1] = p[1]; a[o + 2] = p[2]; a[o + 3] = p[3];
        a[o + 4] = rnd(); a[o + 5] = 0.7 + 0.3 * rnd(); a[o + 6] = 0; a[o + 7] = BUBBLES.life[0] + (BUBBLES.life[1] - BUBBLES.life[0]) * rnd();
        emitted++;
      }
    },
    // dt s: each rises at its size's speed (a 1 cm bubble about 0.2 m/s), ages, and goes at the surface (surfY(x, z)) or its life's end
    step(dt, surfY = () => 0) {
      if (!(dt > 0)) return;
      for (let j = 0; j < n;) {
        const o = j * 8;
        a[o + 1] += (BUBBLES.rise[0] + BUBBLES.rise[1] * a[o + 3]) * dt;
        a[o + 6] += dt;
        if (a[o + 6] > a[o + 7] || a[o + 1] > surfY(a[o], a[o + 2]) - 0.03) { n--; if (j !== n) a.copyWithin(o, n * 8, n * 8 + 8); continue; }
        j++;
      }
    },
    // the GPU's layout: 2 vec4 a bubble (x, y, z, r), (seed, alpha × its fade at the end of its life, age, 0)
    pack(out) {
      for (let j = 0; j < n; j++) {
        const o = j * 8, q = j * 8, left = a[o + 7] - a[o + 6];
        out[q] = a[o]; out[q + 1] = a[o + 1]; out[q + 2] = a[o + 2]; out[q + 3] = a[o + 3];
        out[q + 4] = a[o + 4]; out[q + 5] = a[o + 5] * Math.min(1, left / 0.6); out[q + 6] = a[o + 6]; out[q + 7] = 0;
      }
      return n;
    },
    clear() { n = 0; },
  };
  return self;
}

// Tessie's bubbles this step from her state (the controller's and the sim's): her run, a sharp turn, a fast dive, the breach and its fall;
// the motoring boats' propellers near the eye. src: { dt, spine, N, girth(i) (m), speed, sprint, climb (m/s, + deeper), yawRate (rad/s), nose (m),
// breachStart, fall: { x, z } | null, props: [{ x, z, heading }] , eye }. Rates in BUBBLES (a second); fractional counts carried.
export function createBubbleEmitter(pool, K = BUBBLES) {
  const carry = { run: 0, turn: 0, dive: 0, prop: 0 };
  const take = (k, rate, dt) => { carry[k] += rate * dt; const n = Math.floor(carry[k]); carry[k] -= n; return n; };
  const at = (sp, N, i) => [sp[i * 8], sp[i * 8 + 1], sp[i * 8 + 2]];
  return {
    step({ dt = 0, spine = null, N = 0, girth = () => 1, speed = 0, sprint = false, climb = 0, yawRate = 0, nose = 0, breachStart = false, fall = null, props = [], eye = null } = {}) {
      if (!(dt > 0)) return;
      if (spine && N > 8) {
        const under = nose > 1.0;
        // a point on her skin (girth(i) m round spine frame i, a random way round it), spread a little along her
        const body = (rnd, lo, hi, spread, minR, maxR) => {
          const i = Math.min(N - 1, Math.floor(N * (lo + (hi - lo) * rnd()))); const p = at(spine, N, i);
          const q = at(spine, N, Math.min(N - 1, i + 1)), tx = q[0] - p[0], ty = q[1] - p[1], tz = q[2] - p[2], tl = Math.hypot(tx, ty, tz) || 1, al = (rnd() - 0.5) * spread / tl;   // along her (the spine's tangent)
          const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), g = girth(i) + 0.1 + 0.3 * rnd();
          let ox = Math.cos(a) * s, oy = u, oz = Math.sin(a) * s; const k = (ox * tx + oy * ty + oz * tz) / tl;   // a way round her: off the tangent
          ox -= k * tx / tl; oy -= k * ty / tl; oz -= k * tz / tl; const ol = Math.hypot(ox, oy, oz) || 1;
          return [p[0] + ox / ol * g + tx * al, Math.min(p[1] + oy / ol * g + ty * al, -0.15), p[2] + oz / ol * g + tz * al, minR + (maxR - minR) * rnd() ** 2];
        };
        if (under && sprint) { const n = take('run', K.run * Math.min(1, speed / 10), dt); if (n) pool.emit(n, (i, r) => body(r, 0.08, 0.5, 2.2, 0.012, 0.07)); }
        if (under && speed > 4 && Math.abs(yawRate) > K.turnDeg * Math.PI / 180) { const n = take('turn', K.turn, dt); if (n) pool.emit(n, (i, r) => body(r, 0.1, 0.5, 2.0, 0.01, 0.06)); }
        if (climb > K.diveV) { const n = take('dive', K.dive, dt); if (n) pool.emit(n, (i, r) => body(r, 0.0, 0.3, 1.4, 0.01, 0.05)); }
        if (breachStart) pool.emit(K.breach, (i, r) => body(r, 0.0, 0.5, 2.8, 0.01, 0.08));
      }
      if (fall) pool.emit(K.fall, (i, r) => { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 5; return [fall.x + Math.cos(a) * d, -0.2 - r() * 2.2, fall.z + Math.sin(a) * d, 0.01 + 0.07 * r() ** 2]; });
      if (props.length && eye) {
        const near = props.filter((b) => Math.hypot(b.x - eye[0], b.z - eye[2]) < K.propM);
        const n = take('prop', K.prop * near.length, dt);
        if (n && near.length) pool.emit(n, (i, r) => { const b = near[i % near.length], back = b.back ?? 4; const x = b.x - Math.sin(b.heading) * back, z = b.z + Math.cos(b.heading) * back; return [x + (r() - 0.5) * 0.5, -0.4 - r() * 0.5, z + (r() - 0.5) * 0.5, 0.003 + 0.012 * r() ** 2]; });
      }
    },
  };
}

export function createUnderLight({ device, reg, frameBGL, sky, frameStruct, hdrTarget, msaa = 1, depthFormat = 'depth32float', hdrFormat = 'rgba16float', tier = 'full', caustics = null, tshadow = null, boatShadow = null }) {
  const prev = reg.group?.('under');
  const full = tier === 'full';
  const FR = GPUShaderStage.FRAGMENT, VX = GPUShaderStage.VERTEX;
  // --- the sprites (the specks, the bubbles) in the scene pass ---
  const spriteU = device.createBuffer({ label: 'under-sprite-u', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bubBuf = device.createBuffer({ label: 'under-bubbles', size: BUBBLES.max * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const spBGL = device.createBindGroupLayout({ label: 'under-sprite', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'uniform' } }, { binding: 1, visibility: VX, buffer: { type: 'read-only-storage' } }] });
  const spBG = device.createBindGroup({ layout: spBGL, entries: [{ binding: 0, resource: { buffer: spriteU } }, { binding: 1, resource: { buffer: bubBuf } }] });
  const spLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, spBGL] });
  const sm = reg.shader('under-sprites', SPRITE_WGSL(frameStruct));
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
  const prem = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
  const dsNoWrite = { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' };
  reg.add('under-speck', { layout: spLayout, vertex: { module: sm, entryPoint: 'vsSpeck' }, fragment: { module: sm, entryPoint: 'fsSpeck', targets: [{ ...hdrTarget, blend: add }] }, primitive: { topology: 'triangle-list' }, depthStencil: dsNoWrite, multisample: { count: msaa } });
  reg.add('under-bubble', { layout: spLayout, vertex: { module: sm, entryPoint: 'vsBub' }, fragment: { module: sm, entryPoint: 'fsBub', targets: [{ ...hdrTarget, blend: prem }] }, primitive: { topology: 'triangle-list' }, depthStencil: dsNoWrite, multisample: { count: msaa } });
  // --- the shafts (full tier) ---
  let shaft = null;
  if (full && caustics && tshadow && boatShadow) {
    const rayBGL = (ms) => device.createBindGroupLayout({ label: `under-shaft${ms ? '-ms' : ''}`, entries: [
      { binding: 0, visibility: FR, texture: { sampleType: 'depth', multisampled: ms } },
      { binding: 1, visibility: FR, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 2, visibility: FR, sampler: { type: 'filtering' } },
      { binding: 3, visibility: FR, texture: { sampleType: 'depth' } },
      { binding: 4, visibility: FR, sampler: { type: 'comparison' } },
      { binding: 5, visibility: FR, buffer: { type: 'uniform' } },
      { binding: 6, visibility: FR, texture: { sampleType: 'depth' } },
      { binding: 7, visibility: FR, sampler: { type: 'comparison' } },
      { binding: 8, visibility: FR, buffer: { type: 'uniform' } },
      { binding: 9, visibility: FR, buffer: { type: 'uniform' } }] });
    const upBGL = (ms) => device.createBindGroupLayout({ label: `under-shaft-up${ms ? '-ms' : ''}`, entries: [
      { binding: 0, visibility: FR, texture: { sampleType: 'unfilterable-float' } }, { binding: 1, visibility: FR, texture: { sampleType: 'depth', multisampled: ms } }] });
    const blurBGL = device.createBindGroupLayout({ label: 'under-shaft-blur', entries: [{ binding: 0, visibility: FR, texture: { sampleType: 'unfilterable-float' } }] });
    const L = { ray: [rayBGL(false), rayBGL(true)], up: [upBGL(false), upBGL(true)] };
    const half = { format: 'rgba16float' };
    reg.add('under-shaft', (c) => { const ms = c > 1, m = reg.shader(`under-shaft${ms ? '-ms' : ''}`, SHAFT_WGSL(frameStruct, ms));
      return { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, L.ray[ms ? 1 : 0]] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [half] }, primitive: { topology: 'triangle-list' } }; });
    const bm = reg.shader('under-shaft-blur', SHAFT_BLUR_WGSL);
    reg.add('under-shaft-blur', { layout: device.createPipelineLayout({ bindGroupLayouts: [blurBGL] }), vertex: { module: bm, entryPoint: 'vs' }, fragment: { module: bm, entryPoint: 'fs', targets: [half] }, primitive: { topology: 'triangle-list' }, fixedSamples: true });
    reg.add('under-shaft-up', (c) => { const ms = c > 1, m = reg.shader(`under-shaft-up${ms ? '-ms' : ''}`, SHAFT_UP_WGSL(frameStruct, ms));
      return { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, L.up[ms ? 1 : 0]] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: hdrFormat, blend: add }] }, primitive: { topology: 'triangle-list' } }; });
    const shaftU = device.createBuffer({ label: 'under-shaft-u', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const sRep = device.createSampler({ label: 'under-shaft-rep', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
    shaft = { L, blurBGL, shaftU, sRep, T: { w: 0, h: 0, a: null, b: null, av: null, bv: null, blurBG: null }, bg: { key: null, ray: null, up: null } };
  }
  if (prev != null) reg.group(prev);

  const uData = new Float32Array(8), spData = new Float32Array(12), bubData = new Float32Array(BUBBLES.max * 8);
  const stats = { shafts: 0, specks: 0, bubbles: 0, strength: 0, steps: 0 };
  let strength = 0, steps = SHAFT.steps[0], speckN = full ? SPECK.full : SPECK.lite, bubN = 0;
  function ensure(w, h) {
    const T = shaft.T, hw = Math.max(1, Math.ceil(w / 2)), hh = Math.max(1, Math.ceil(h / 2));
    if (T.w === hw && T.h === hh && T.a) return;
    T.a?.destroy(); T.b?.destroy();
    T.w = hw; T.h = hh;
    const mk = (l) => device.createTexture({ label: l, size: [hw, hh], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    T.a = mk('under-shaft-a'); T.b = mk('under-shaft-b'); T.av = T.a.createView(); T.bv = T.b.createView();
    T.blurBG = device.createBindGroup({ layout: shaft.blurBGL, entries: [{ binding: 0, resource: T.av }] });
    shaft.bg.key = null;
  }
  const self = {
    stats,
    get shafts() { return !!shaft; },
    // per frame (main.js fill), before the passes: the shafts' strength and steps, the sprites' camera and the bubbles
    update({ on = false, strength: s = 0, level = 0, right, up, focalPx, bubbles = null, eyeVel = null } = {}) {   // eyeVel: the eye's velocity (m/s, world): the specks stream past it
      strength = on && shaft ? s : 0; steps = SHAFT.steps[level <= 0 ? 0 : 1];
      if (!on) { bubN = 0; return; }
      spData[0] = right[0]; spData[1] = right[1]; spData[2] = right[2]; spData[3] = focalPx;
      spData[4] = up[0]; spData[5] = up[1]; spData[6] = up[2]; spData[7] = 0;
      spData[8] = SPECK.gain; spData[9] = -(eyeVel?.[0] ?? 0); spData[10] = -(eyeVel?.[1] ?? 0); spData[11] = -(eyeVel?.[2] ?? 0);
      device.queue.writeBuffer(spriteU, 0, spData);
      bubN = bubbles ? bubbles.pack(bubData) : 0;
      if (bubN) device.queue.writeBuffer(bubBuf, 0, bubData, 0, bubN * 8);
      if (strength > 0) {
        uData[0] = steps; uData[1] = SHAFT.maxM; uData[2] = strength; uData[3] = 0;
        uData[4] = SHAFT.pat[0]; uData[5] = SHAFT.pat[1]; uData[6] = SHAFT.base; uData[7] = SHAFT.lod;
        device.queue.writeBuffer(shaft.shaftU, 0, uData);
      }
      stats.strength = +strength.toFixed(3); stats.steps = strength > 0 ? steps : 0;
    },
    // in the scene pass while the eye is under (and in the split's water side): the specks (additive), then the bubbles (premultiplied)
    drawSprites(pass, c) {
      if (!reg.has?.('under-speck')) return false;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, spBG);
      pass.setPipeline(reg.get('under-speck')); pass.draw(6, speckN); c.calls++; c.triangles += 2 * speckN; stats.specks++;
      if (bubN && reg.has?.('under-bubble')) { pass.setPipeline(reg.get('under-bubble')); pass.draw(6, bubN); c.calls++; c.triangles += 2 * bubN; stats.bubbles = bubN; }
      return true;
    },
    // the scene's depth must be kept this frame (the shafts read it)
    wantsDepth: () => strength > 0 && !!shaft && !!reg.has?.('under-shaft'),
    // the shafts' passes after the scene: the march (half res), the blur, the upsample onto the frame's resolved colour
    encode(enc, { targets, msaa: n, ts, frameBG }) {
      if (!(strength > 0) || !shaft || !reg.has?.('under-shaft') || !reg.has?.('under-shaft-up') || !reg.has?.('under-shaft-blur')) return false;
      ensure(targets.w, targets.h);
      const T = shaft.T, ms = n > 1 ? 1 : 0, cv = caustics.view, key = `${ms}|${targets.w}x${targets.h}`;
      if (shaft.bg.key !== key || shaft.bg.cv !== cv || shaft.bg.dv !== targets.depthView) {
        shaft.bg.ray = device.createBindGroup({ layout: shaft.L.ray[ms], entries: [
          { binding: 0, resource: targets.depthView }, { binding: 1, resource: cv }, { binding: 2, resource: shaft.sRep },
          { binding: 3, resource: tshadow.view }, { binding: 4, resource: tshadow.sampler }, { binding: 5, resource: { buffer: tshadow.buffer } },
          { binding: 6, resource: boatShadow.view }, { binding: 7, resource: boatShadow.sampler }, { binding: 8, resource: { buffer: boatShadow.buffer } },
          { binding: 9, resource: { buffer: shaft.shaftU } }] });
        shaft.bg.up = device.createBindGroup({ layout: shaft.L.up[ms], entries: [{ binding: 0, resource: T.bv }, { binding: 1, resource: targets.depthView }] });
        shaft.bg.key = key; shaft.bg.cv = cv; shaft.bg.dv = targets.depthView;
      }
      const d1 = { label: 'under-shaft', colorAttachments: [{ view: T.av, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] };
      if (ts) d1.timestampWrites = { querySet: ts.querySet, beginningOfPassWriteIndex: ts.beginningOfPassWriteIndex };
      const p1 = enc.beginRenderPass(d1);
      p1.setBindGroup(0, frameBG.bg, [frameBG.offset]); p1.setBindGroup(1, sky.skyBG); p1.setBindGroup(2, shaft.bg.ray); p1.setPipeline(reg.get('under-shaft')); p1.draw(3); p1.end();
      const p2 = enc.beginRenderPass({ label: 'under-shaft-blur', colorAttachments: [{ view: T.bv, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
      p2.setBindGroup(0, T.blurBG); p2.setPipeline(reg.get('under-shaft-blur')); p2.draw(3); p2.end();
      const d3 = { label: 'under-shaft-up', colorAttachments: [{ view: targets.resolveView, loadOp: 'load', storeOp: 'store' }] };
      if (ts) d3.timestampWrites = { querySet: ts.querySet, endOfPassWriteIndex: ts.endOfPassWriteIndex };
      const p3 = enc.beginRenderPass(d3);
      p3.setBindGroup(0, frameBG.bg, [frameBG.offset]); p3.setBindGroup(1, shaft.bg.up); p3.setPipeline(reg.get('under-shaft-up')); p3.draw(3); p3.end();
      stats.shafts++;
      return true;
    },
  };
  return self;
}
