// The clouds' readers (M5a): the params record and the key's reads, appended to the sky-read group's WGSL
// (render/sky.js SKY_READ, bindings 7–9) so the sky draw, the water and the terrain composite the deck with one fetch.
// Its one import is the key's numbers (sim/clouds.js, pure): render/sky.js and render/clouds.js both import this file.
import { KEY } from '../sim/clouds.js';
const KEY_LAYERS = KEY.layers;   // the blended layer's index (render/clouds.js BLEND_LAYER)
export const KEY_ANISO = 4;   // the far water's shimmer fix: the view sampler's anisotropy (render/sky.js sView), for cloudAtUEGrad
// the params record every reader and the bake share (sim/clouds.js fillParams writes it)
export const CLOUD_STRUCT = `
struct CloudU { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f, f: vec4f, g: vec4f, h: vec4f }
// a: cur layer, prev layer, fade prev→cur, on   b: coverage, type, base (m), thickness (m)   c: drift x, z (m), time, row0
// d: the storm cell x, z, radius (m), its cover   e: the cell's slab (m), its shade, density (/m), the layer being baked
// f: seed, the night floor, rows this dispatch, 0   g: the light as v1's camera shows it: sun gain, sky gain, sky chroma, 0
// (sim/clouds.js cloudLightMatch)   h: 0, 0, 0, #18 the towers' growth (0–1)`;

// the readers, appended to the sky-read group (render/sky.js SKY_READ binds 7, 8, 9 after the LUTs and the light record)
export const CLOUD_READ = (g = 1) => `${CLOUD_STRUCT}
@group(${g}) @binding(7) var<uniform> CL: CloudU;
@group(${g}) @binding(8) var tKey: texture_2d_array<f32>;
@group(${g}) @binding(9) var tKeyD: texture_2d_array<f32>;
// the key's direction mapping: u the azimuth, v = sqrt(elevation / 90°): the texels packed at the horizon
fn cloudUV(d: vec3f) -> vec2f { let e = asin(clamp(d.y, -1.0, 1.0)); return vec2f(atan2(d.z, d.x) / (2.0 * PI) + 0.5, sqrt(max(e, 0.0) / (PI * 0.5))); }
// the cloud along d from the eye: rgb its light (premultiplied, HDR scale), a its transmittance; the two keys cross-faded
// (the speed pass: the cross-fade is made once a frame into the key's layer ${KEY_LAYERS}, render/clouds.js BLEND_WGSL)
fn cloudAt(d: vec3f) -> vec4f {
  if (CL.a.w < 0.5 || d.y <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return textureSampleLevel(tKey, sView, cloudUV(d), ${KEY_LAYERS}, 0.0);
}
// the same, blurred: the blended layer's mip chain at level lod (the storm's soft overcast, render/sky.js STORM_OVERCAST)
fn cloudAtLod(d: vec3f, lod: f32) -> vec4f {
  if (CL.a.w < 0.5 || d.y <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return textureSampleLevel(tKey, sView, cloudUV(d), ${KEY_LAYERS}, lod);
}
// the same at azimuth u (0–1, cloudUV's) and elevation e (rad): no direction's trig (the water mirror's taps share u)
fn cloudAtUE(u: f32, e: f32) -> vec4f {
  if (CL.a.w < 0.5 || e <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return textureSampleLevel(tKey, sView, vec2f(u, sqrt(e / (PI * 0.5))), ${KEY_LAYERS}, 0.0);
}
// the same filtered over a footprint of the key (fix(v2) the far water's shimmer: the blended layer's mip chain,
// render/clouds.js KEY_MIP_WGSL): g.x the azimuth's span, g.y the elevation's (key uv units); the view sampler's
// anisotropy (KEY_ANISO : 1, render/sky.js) keeps the azimuth sharper than the elevation (water-aa.js cloudTapGrad)
fn cloudAtUEGrad(u: f32, e: f32, g: vec2f) -> vec4f {
  if (CL.a.w < 0.5 || e <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  return textureSampleGrad(tKey, sView, vec2f(u, sqrt(e / (PI * 0.5))), ${KEY_LAYERS}, vec2f(g.x, 0.0), vec2f(0.0, g.y));
}
// the cloud's mean distance along d, km (1000 where there is none): a surface farther than it stands behind the cloud
fn cloudDistKm(d: vec3f) -> f32 {
  if (CL.a.w < 0.5 || d.y <= 0.0) { return 1000.0; }
  let sz = vec2i(textureDimensions(tKeyD)); let uv = cloudUV(d);
  return textureLoad(tKeyD, clamp(vec2i(uv * vec2f(sz)), vec2i(0), sz - 1), i32(CL.a.x), 0).r;
}
// the sky along d with its clouds over it (the sky draw, the water's mirror)
fn skyWithClouds(d: vec3f) -> vec3f { let k = cloudAt(d); return skyRadiance(d) * k.a + k.rgb; }`;

