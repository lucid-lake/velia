// The shared WGSL pieces and the tonemap/composite pass. Every shader starts with the shared Frame struct
// (v2/engine/uniforms.js) at group 0 and `diagnostic(off, derivative_uniformity)` (Cold Smoke's habit).
// HDR radiance is in a scale where a noon zenith sky is about 1 and the tonemap's exposure factor is 1 at the URL's
// exposure=6. The sky lives in render/sky.js, the water in render/water.js (M1); M0's analytic sky and plane are gone.
import { wgslStruct } from '../engine/uniforms.js';
import { AGX_WGSL } from './grade.js';
import { POST_WGSL, DITHER_WGSL, LENS_WGSL } from './bloom.js';
import { PURKINJE_WGSL } from './purkinje.js';   // feat/v2-look-ponlai: the night's Purkinje shift

export const HEAD = `diagnostic(off, derivative_uniformity);
${wgslStruct()}
@group(0) @binding(0) var<uniform> F: Frame;
`;

// a fullscreen triangle at the far plane (M2: reversed z, so the far plane is z = 0, and the depth buffer is cleared to
// 0); the view ray is unprojected through invViewProj from the near plane (z = 1) to a farther point (z = 0.5)
export const FULLSCREEN = `
struct VOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut; o.pos = vec4f(p[i], 0.0, 1.0); o.ndc = p[i]; return o;
}
fn viewDir(ndc: vec2f) -> vec3f {
  let a = F.invViewProj * vec4f(ndc, 1.0, 1.0);
  let b = F.invViewProj * vec4f(ndc, 0.5, 1.0);
  return normalize(b.xyz / b.w - a.xyz / a.w);
}`;

// M5e: the clearing's rainbow (v1's src/weather/rainbow.js): the primary bow 40.7–42.4° from the antisolar point, a
// faint secondary at 50.2–53.5° with its colours reversed, a little light inside the primary, Alexander's dark band
// between; only toward the departing rain and above the horizon. light: 0–1 a channel before the strength
export const RAINBOW_WGSL = `
fn bowBand(a: f32, b: f32, x: f32) -> f32 { return smoothstep(a - 0.9, a + 0.4, x) * (1.0 - smoothstep(b - 0.4, b + 0.9, x)); }
fn bowHue(x: f32, a: f32, b: f32) -> f32 { return clamp((x - a) / (b - a), 0.0, 1.0); }
fn bowSpectrum(h: f32) -> vec3f {
  return mix(vec3f(smoothstep(0.35, 0.85, h) + smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.12, 0.3, h)) * 0.35,
    smoothstep(0.1, 0.45, h) * (1.0 - smoothstep(0.62, 0.95, h)), (1.0 - smoothstep(0.2, 0.55, h)) * 0.9), vec3f(0.55), 0.3);
}
struct Bow { light: vec3f, alex: f32 }
fn rainbowLight(dir: vec3f, sunDir: vec3f, toRain: vec2f) -> Bow {
  let th = acos(clamp(dot(dir, -sunDir), -1.0, 1.0)) * 57.29578;   // degrees from the antisolar point
  let p = bowSpectrum(bowHue(th, 40.7, 42.4)) * bowBand(40.7, 42.4, th);
  let s2 = bowSpectrum(1.0 - bowHue(th, 50.2, 53.5)) * bowBand(50.2, 53.5, th) * 0.33;
  let inside = (1.0 - smoothstep(36.0, 41.0, th)) * smoothstep(18.0, 32.0, th) * 0.1;
  let toward = smoothstep(0.15, 0.75, dot(dir.xz / max(length(dir.xz), 1e-4), toRain / max(length(toRain), 1e-4)));
  let above = smoothstep(-0.005, 0.03, dir.y) * (1.0 - smoothstep(0.55, 0.85, dir.y));
  let w = toward * above;
  var o: Bow; o.light = (p + s2 + vec3f(inside)) * w; o.alex = smoothstep(42.4, 43.6, th) * (1.0 - smoothstep(49.0, 50.4, th)) * w; return o;
}`;

// tonemap + sRGB encode to the swap chain; exposure factor = F.params.x. The post chain (2026-11-18, render/bloom.js): the
// bloom's mip 0 added to the exposed colour before the tone curve, the dither after the grade (group 2 bindings 2 and 3). fix(v2) frame look: v1's AgX then v1's noon LUT (group 2, render/grade.js) by default, M2's ACES fit (Narkowicz 2015) under ?look=v2 (F.look). M5e: under a storm
// (F.storm.x) the scene is graded first, in HDR before the exposure (v1's post grade): the rainbow on what lies past
// ≈ 900 m (the scene's depth, loaded once a pixel), the storm's steel (flattened, cooler, darker), a vignette that
// closes in, the clearing's warm lift, the lightning's flash (the whole scene lit blue-white; its lift in scene light,
// scaled back at night by the exposure: F.bow.z). The depth is the scene's own target (multisampled with the scene)
export const BOW_K = 0.4;        // the bow's HDR strength per unit amount in full sun (v1: 0.45 × the hand-set sunlit level)
// feat/v2-sky-v1-grade (owner 2026-11-18: "use v1's rainbow as reference"): v1's bow stood about 1.8 × v2's over the same sky at the
// same arc second (renders/sky-v1-grade: red +55 / 255 over the deck at 262 s, v2 +38), so the bow's strength is BOW_K × BOW_V1;
// and the bow in the water (v1 had none; a real one shows on calm water under the bow): the far open water (past BOW_WATER.near m,
// the hit point on the lake's plane) takes the bow along its mirrored ray at BOW_WATER.k (the water's reflectance at a grazing look, gone by a
// look BOW_WATER.fresnel[1] (sine) down: the Fresnel term, so the near water under the boat keeps none)
export const BOW_V1 = 1.8;
export const BOW_WATER = Object.freeze({ k: 0.3, near: [40, 90], plane: 1.5, fresnel: [0.02, 0.2] });
export const FLASH_ADD = 0.27;   // the flash's lift in HDR per unit flashAdd (v1: 0.03 of its scene unit, 0.3 of a sunlit white)
// perf(v2) phone round 2: three variants, the pass picks one a frame from the same storm rows it writes (main.js):
//   'plain' (no storm: the clear days, the night) the tonemap alone, no depth bound, no grade code in the module;
//   'storm' (a storm, no bow) the grade without the rainbow's terms (with F.rain.w = 0 each was a multiply by 1 or an add
//           of 0: the same pixels) and no depth bound;
//   'bow'   (a storm while the bow shows) the full grade, the scene's depth read for the bow's distance (round 1's shader).
// The owner's iPhone read 5.1 ms for this pass at 0.62 Mpx: the Mac reads 0.017 ms for the same pass at that size, so the
// shader was never the cost (frame.js now books each pass's own share; see v2/notes/phone.md, the speed pass round 2)
export const TONEMAP_MODES = Object.freeze(['plain', 'storm', 'bow']);
export const TONEMAP = (msaa = 4, mode = 'bow') => `${HEAD}${FULLSCREEN}
@group(1) @binding(0) var hdr: texture_2d<f32>;
@group(2) @binding(0) var tLut: texture_3d<f32>;   // fix(v2) frame look: v1's noon grade (render/grade.js), 17³, sRGB in and out
@group(2) @binding(1) var sLut: sampler;
${POST_WGSL}
@group(2) @binding(2) var tBloom: texture_2d<f32>;   // the post chain (render/bloom.js): the bloom's mip 0 (a 1 × 1 black texture where it is off)
@group(2) @binding(3) var<uniform> PO: Post;          // b.x the bloom's factor (0: none), b.y the dither in 8-bit steps (0: none), b.z the Purkinje amount (0: none), b.w its scale
${AGX_WGSL}
${DITHER_WGSL}
${LENS_WGSL}
${PURKINJE_WGSL}
${mode === 'bow' ? `@group(1) @binding(1) var tDepth: ${msaa > 1 ? 'texture_depth_multisampled_2d' : 'texture_depth_2d'};
${RAINBOW_WGSL}` : ''}
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
${mode === 'plain' ? '' : `fn stormGrade(c0: vec3f, px: vec2i, ndc: vec2f) -> vec3f {
  var c = c0;
${mode === 'bow' ? `  // the depth is read only for the bow (its distance mask and direction): with no bow (F.rain.w = 0) every bow term is 0
  // and the scene pass did not store the depth (the speed pass: main.js depthStore), so it is not read at all
  var z = 0.0; if (F.rain.w > 0.0) { z = textureLoad(tDepth, px, 0); }   // reversed: 0 at the far plane (the sky)
  var far = 1.0; var dir = viewDir(ndc); var wet = 0.0;
  if (z > 0.0) {
    let w = F.invViewProj * vec4f(ndc, z, 1.0); let p = w.xyz / w.w; let dv = p - F.cam.xyz; let dl = length(dv);
    far = smoothstep(700.0, 1100.0, dl); dir = normalize(dv);
    // the far open water: a hit on the lake's plane, below the eye, past the near band (the boat and the near shore keep none)
    wet = smoothstep(${BOW_WATER.near[0].toFixed(1)}, ${BOW_WATER.near[1].toFixed(1)}, dl) * (1.0 - step(${BOW_WATER.plane.toFixed(2)}, abs(p.y))) * step(dir.y, 0.0);
  }
  let bowK = F.rain.w * ${(BOW_K * BOW_V1).toFixed(3)} * clamp(F.sun.y / 0.15, 0.0, 1.0);
  let bow = rainbowLight(dir, normalize(F.sun.xyz), F.bow.xy);
  c *= 1.0 - bow.alex * F.rain.w * 0.18 * far;
  c += bow.light * bowK * far;
  if (wet > 0.0) {   // the bow in the water: the mirrored ray's bow (its arc under the horizon, the colours in the same order)
    let wb = rainbowLight(vec3f(dir.x, -dir.y, dir.z), normalize(F.sun.xyz), F.bow.xy);
    wet *= 1.0 - smoothstep(${BOW_WATER.fresnel[0].toFixed(3)}, ${BOW_WATER.fresnel[1].toFixed(3)}, -dir.y);   // the water's reflectance: most at a grazing look, little looking down
    c *= 1.0 - wb.alex * F.rain.w * 0.18 * ${BOW_WATER.k.toFixed(2)} * wet;
    c += wb.light * bowK * ${BOW_WATER.k.toFixed(2)} * wet;
  }
` : ''}  let l = dot(c, LUMA);
  let steel = mix(c, vec3f(l) * vec3f(0.84, 0.94, 1.08), F.storm.z * 0.7) * (1.0 - F.storm.z * 0.5);
  let uvc = ndc * 0.5; let vig = 1.0 - dot(uvc, uvc) * F.storm.z * 1.2;
  let warm = mix(steel, steel * vec3f(1.2, 1.02, 0.74), F.storm.w * 0.85);
  let sat = mix(vec3f(dot(warm, LUMA)), warm, F.storm.w * 0.18 + 1.0);
  return sat * vig * (vec3f(0.85, 0.92, 1.12) * (F.rain.y * 3.0) + 1.0) + vec3f(0.6, 0.68, 0.9) * (F.bow.z * ${FLASH_ADD});
}`}
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn srgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let px = vec2i(v.pos.xy);
  var c = textureLoad(hdr, px, 0).rgb;
  let dim = vec2f(textureDimensions(hdr));
  if (PO.c.y > 0.0) {   // the cinematic intro's fringe (render/bloom.js LENS): red out, blue in, at the edges only
    let off = vec2i(round(lensFringe(v.pos.xy, dim, PO.c.y))); let hi = vec2i(dim) - vec2i(1);
    c.r = textureLoad(hdr, clamp(px + off, vec2i(0), hi), 0).r; c.b = textureLoad(hdr, clamp(px - off, vec2i(0), hi), 0).b;
  }
  ${mode === 'plain' ? '' : mode === 'storm' ? 'c = stormGrade(c, px, v.ndc);' : 'if (F.storm.x > 0.5) { c = stormGrade(c, px, v.ndc); }'}
  // fix(v2) frame look: v1's camera (F.look.x > 0: AgX, then v1's LUT at F.look.y on the encoded picture) or M2's ACES (?look=v2)
  // the post chain: the bloom (exposed HDR, thresholded and blurred) added before the tone curve, so a glow rolls off as the light does
  // feat/v2-look-ponlai: the night's Purkinje shift on the exposed colour, before the bloom's glow (render/purkinje.js; 0 by day)
  var e = c * F.params.x;
  if (PO.b.z > 0.0) { e = purkinje(e, PO.b.w, PO.b.z); }
  var x = e + textureSampleLevel(tBloom, sLut, v.pos.xy / dim, 0.0).rgb * PO.b.x;
  if (PO.c.y > 0.0 && PO.b.x > 0.0) { x += lensStreak(tBloom, sLut, v.pos.xy / dim) * PO.b.x * PO.c.y; }   // the intro's anamorphic streak on the glow
  var o: vec3f;
  if (F.look.x > 0.0) { o = srgb(agx(x)); } else { o = srgb(aces(x)); }
  if (F.look.y > 0.0) { o = mix(o, textureSampleLevel(tLut, sLut, clamp(o, vec3f(0.0), vec3f(1.0)) * (16.0 / 17.0) + 0.5 / 17.0, 0.0).rgb, F.look.y); }
  if (PO.c.x > 0.0) { o = lensLook(o, v.pos.xy, dim, PO.c.x, PO.c.y, PO.c.z); }   // the cinematic intro's lens look (ui/cinematicIntro.js): 0 outside it
  o += vec3f(dither(v.pos.xy, PO.b.y));   // the 8-bit swap chain's bands broken by a fixed ±1 LSB triangular pattern (render/bloom.js)
  return vec4f(o, 1.0);
}`;
// which variant a frame draws, from the storm rows the frame writes (sim/storm.js fillFrame: storm.x = on, rain.w = bowAmt)
export const tonemapMode = (on, bowAmt) => (!(on > 0.5) ? 'plain' : bowAmt > 0 ? 'bow' : 'storm');
