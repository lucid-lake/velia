// The night's readers (M5e): the params record and the Milky Way's read, bound as their own group on the sky draw and
// as extra bindings on the water's draw group (render/night.js makes the resources; render/sky.js and render/water.js
// append this text). No render imports here: render/sky.js and render/night.js both import it (as cloud-read.js).
import { NIGHT, MW_LOG_K } from '../sim/night.js';

// the record every night reader and the stars' draw share (render/night.js fills it)
export const NIGHT_STRUCT = `
struct NightU { m0: vec4f, m1: vec4f, m2: vec4f, p: vec4f, q: vec4f }
// m0..m2: the rows of the J2000 → world rotation (v2/sim/moon.js skyMatrix)   p: the band's HDR scale, the stars' scale, the faint stars' sigma (px), the twinkle's time
// q: the stars' count, the lights' count, the lights' radiance, the brightest stars' sigma (px)`;

const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
// the Milky Way along a world direction d (HDR): NASA SVS's map (data/sky/milkyway-4k.webp, v1's desktop map: log-encoded luminance;
// milkyway-tint.png: its colour), sampled in J2000 through the record's rotation, decoded as v1's src/core/milkyway.js
// (the log encoding, the contrast, the blue-violet outer band, the saturation); 0 when the map has not streamed in
export const NIGHT_READ = (g = 2, b0 = 0) => `${NIGHT_STRUCT}
@group(${g}) @binding(${b0}) var<uniform> NU: NightU;
@group(${g}) @binding(${b0 + 1}) var tMW: texture_2d<f32>;
@group(${g}) @binding(${b0 + 2}) var tMWt: texture_2d<f32>;
@group(${g}) @binding(${b0 + 3}) var sMW: sampler;
const MW_LOG1K = ${Math.log2(1 + MW_LOG_K).toFixed(6)}; const MW_K = ${MW_LOG_K}.0; const MW_CONTRAST = ${NIGHT.bandContrast}; const MW_SAT = ${NIGHT.bandSaturation};
const MW_OUTER = ${v3(NIGHT.bandOuter)};
fn toJ2000(d: vec3f) -> vec3f {
  return vec3f(NU.m0.x * d.x + NU.m1.x * d.y + NU.m2.x * d.z, NU.m0.y * d.x + NU.m1.y * d.y + NU.m2.y * d.z, NU.m0.z * d.x + NU.m1.z * d.y + NU.m2.z * d.z);
}
fn milkyWayUV(d: vec3f) -> vec2f {
  let e = toJ2000(d);
  let ra = atan2(e.y, e.x); let dec = asin(clamp(e.z, -1.0, 1.0));
  return vec2f(fract(0.5 - ra / 6.2831853), 0.5 - dec / 3.14159265);
}
fn milkyWay(d: vec3f) -> vec3f {
  if (NU.p.x <= 0.0) { return vec3f(0.0); }
  let uv = milkyWayUV(d);
  let en = textureSampleLevel(tMW, sMW, uv, 0.0).r;
  let x0 = (exp2(en * MW_LOG1K) - 1.0) / MW_K;
  let x = pow(x0, MW_CONTRAST);
  let tint = textureSampleLevel(tMWt, sMW, uv, 0.0).rgb * (255.0 / 127.5);
  let hue = mix(tint * MW_OUTER, tint, smoothstep(0.03, 0.3, x0));
  return mix(vec3f(1.0), hue, MW_SAT) * x * NU.p.x;
}`;
