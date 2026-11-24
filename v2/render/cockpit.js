// The cockpit on v2's GPU (M4): v1's cream 3D cockpit (src/stations/sloop/cockpit3d.js), its geometry baked from v1's own page
// (tools/v2-cockpit-bake.mjs → v2/assets/cockpit/*.ckb.gz, read by cockpit/asset.js), moved by cockpit/rig.js, and shaded with
// v1's cockpit materials (cockpitMaterials.js) ported to WGSL: the satin gelcoat with its own occlusion from the shell's 'sh'
// attribute (the lip, the foot, the recesses' corners), the teak cap and the caulked sole with its baked AO map, brushed
// stainless and the knurled drums, the powder-coated recesses, the smoked glass with its salt haze, the braided sheets; the
// engraved words, the compass card and the blob shadows from the baked atlas; the two dial faces live (dialFaces.js canvases,
// uploaded only when redrawn). Lit as v1's look/cockpit-light: the world's own sun and sky only (the root turns with the
// heading, so the sun side shades), no lamp of its own; the backlit parts in screen terms (÷ the exposure).
// How it is drawn (no extra pass, no extra target): in the scene pass, FIRST, with its own camera (v1's full-frame lens, the
// cockpitView solve) and its depth squeezed into the reversed-depth band [0.99, 1] (nearer than anything the world draws
// past 0.505 m), so the terrain, the water and the sky behind it fail the depth test and are never shaded; its glass, dome,
// words and soft shadows go last in the same pass (blended). Four pipelines, declared with the rest before the first frame.
//   const ck = createCockpit({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa, depthFormat, errors })
//   ck.ready (the asset in), ck.rig, ck.fill({ w, h, sun, heading, exposure }), ck.drawOpaque(pass, c), ck.drawBlend(pass, c)
import { feature } from '../../src/core/features.js';
import { BOAT_HEAD, SHADOW_U_FLOATS, MODEL_BYTES } from './boat.js';
import { parseCockpit } from './cockpit/asset.js';
import { createCockpitRig } from './cockpit/rig.js';

const STRIDE = 256;
export const CK_DEPTH = Object.freeze({ band: 0.01 });   // the cockpit's share of the reversed depth range, at its near end
// kinds (cockpitMaterials.js by name; the glTF and plain materials as they are)
export const CK_KIND = Object.freeze({ plain: 0, basic: 1, gel: 2, teakCap: 3, teakSole: 4, steel: 5, powder: 6, glass: 7, rope: 8, faceChart: 9, faceWind: 10, winch: 11 });
const kindOf = (m) => {
  const n = m.name ?? '';
  if (m.mapImage === 'liveFace') return null;   // set by role below
  if (n === 'ck_gelcoat') return CK_KIND.gel;
  if (n === 'ck_teak_cap') return CK_KIND.teakCap;
  if (n === 'ck_teak_sole') return CK_KIND.teakSole;
  if (n === 'ck_winch') return CK_KIND.winch;
  if (/^ck_stainless/.test(n)) return CK_KIND.steel;
  if (n === 'ck_powder') return CK_KIND.powder;
  if (n === 'ck_glass') return CK_KIND.glass;
  if (n === 'ck_rope') return CK_KIND.rope;
  if (m.type === 'basic') return CK_KIND.basic;
  return CK_KIND.plain;
};
// a material's look numbers where the TSL node owns them (cockpitMaterials.js CKMAT, stainless's ranges)
const LOOK = {
  [CK_KIND.gel]: { color: [0.97 * 0.70, 0.925 * 0.70, 0.84 * 0.70], rough: 0.40, metal: 0, coat: 0.28, coatRough: 0.26 },
  [CK_KIND.steel]: { color: [0.80, 0.80, 0.79], rough: 0.36, metal: 1 },
  [CK_KIND.winch]: { color: [0.80, 0.80, 0.79], rough: 0.31, metal: 1 },
  [CK_KIND.powder]: { color: [0.026, 0.028, 0.031], rough: 0.78, metal: 0 },
  [CK_KIND.glass]: { color: [0.012, 0.016, 0.022], rough: 0.08, metal: 0, opacity: 0.07 },
  [CK_KIND.rope]: { color: [0.80, 0.77, 0.69], rough: 0.9, metal: 0 },
};
const MAT_VEC4 = 8;   // base, mr, em, map, emap, kind, ex, pad

const CK_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${BOAT_HEAD(frameStruct)}
struct CK { vp: mat4x4f, cam: vec4f, misc: vec4f, sole: vec4f }   // cam: the camera (cockpit frame), heading; misc: exposure factor, night, 0, 0; sole: the AO box
struct Mat { base: vec4f, mr: vec4f, em: vec4f, map: vec4f, emap: vec4f, kind: vec4f, ex: vec4f, pad: vec4f }
@group(3) @binding(0) var<uniform> CKU: CK;
@group(3) @binding(1) var<storage, read> MATS: array<Mat>;
@group(3) @binding(2) var tAtlas: texture_2d<f32>;
@group(3) @binding(3) var sAtlas: sampler;
@group(3) @binding(4) var tFaceC: texture_2d<f32>;
@group(3) @binding(5) var tFaceW: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f, @location(0) cp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) sh: vec3f, @location(4) lp: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec4f, @location(2) uv: vec2f, @location(3) sh: vec3f) -> V {
  let w = M.m * vec4f(p, 1.0);
  var c = CKU.vp * w;
  c.z = c.w * ${(1 - CK_DEPTH.band).toFixed(4)} + c.z * ${CK_DEPTH.band.toFixed(4)};   // the cockpit's band at the near end of the reversed depth
  var o: V; o.pos = c; o.cp = w.xyz; o.n = (M.m * vec4f(n.xyz, 0.0)).xyz; o.uv = uv; o.sh = sh; o.lp = p;
  return o;
}
fn hashu(x: u32) -> u32 { let v = x * 747796405u + 2891336453u; let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (w >> 22u) ^ w; }
fn gradAt(c: vec3i) -> vec3f {
  let h = hashu((bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u) ^ (bitcast<u32>(c.z) * 83492791u));
  return normalize(vec3f(f32(h & 1023u), f32((h >> 10u) & 1023u), f32((h >> 20u) & 1023u)) / 511.5 - 1.0 + 1e-4);
}
fn noise3(p: vec3f) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p); let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = dot(gradAt(i), f); let n100 = dot(gradAt(i + vec3i(1, 0, 0)), f - vec3f(1.0, 0.0, 0.0));
  let n010 = dot(gradAt(i + vec3i(0, 1, 0)), f - vec3f(0.0, 1.0, 0.0)); let n110 = dot(gradAt(i + vec3i(1, 1, 0)), f - vec3f(1.0, 1.0, 0.0));
  let n001 = dot(gradAt(i + vec3i(0, 0, 1)), f - vec3f(0.0, 0.0, 1.0)); let n101 = dot(gradAt(i + vec3i(1, 0, 1)), f - vec3f(1.0, 0.0, 1.0));
  let n011 = dot(gradAt(i + vec3i(0, 1, 1)), f - vec3f(0.0, 1.0, 1.0)); let n111 = dot(gradAt(i + vec3i(1, 1, 1)), f - vec3f(1.0, 1.0, 1.0));
  return 1.6 * mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
fn srgbToLinear(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
// an atlas rect's sample (rect: u0 v0 u1 v1; flip: canvas textures' v runs up)
fn atlasUv(r: vec4f, uv: vec2f, flip: f32) -> vec2f { let v = select(uv.y, 1.0 - uv.y, flip > 0.5); return vec2f(mix(r.x, r.z, fract(uv.x - 1e-6 * 0.0)), mix(r.y, r.w, clamp(v, 0.0, 1.0))); }
// the cockpit frame → the world's orientation (v1: root.rotation.y = −heading)
fn toWorld(v: vec3f) -> vec3f { let c = cos(-CKU.cam.w); let s = sin(-CKU.cam.w); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
struct S { alb: vec3f, rough: f32, metal: f32, coat: f32, coatRough: f32, ao: f32, alpha: f32, emit: vec3f, unlit: bool }
@fragment fn fs(v: V, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mt = MATS[u32(M.p.x + 0.5)];
  let kind = i32(mt.kind.x + 0.5);
  var s: S; s.alb = mt.base.rgb; s.rough = mt.mr.y; s.metal = mt.mr.x; s.coat = mt.mr.z; s.coatRough = mt.mr.w; s.ao = 1.0; s.alpha = mt.base.a; s.emit = mt.em.rgb; s.unlit = false;
  var nl = normalize(v.n) * select(-1.0, 1.0, ff);
  let p = v.lp;
  // the shell's own occlusion (cockpitMaterials.js shellAo): u out from the face, y up it, the head
  let su = v.sh.x; let sy = v.sh.y; let top = v.sh.z;
  let onFace = (1.0 - smoothstep(0.0005, 0.004, su)); let inside = smoothstep(0.003, 0.012, su);
  let lip = onFace * smoothstep(top - 0.10, top - 0.002, sy); let foot = (1.0 - smoothstep(0.0, 0.14, sy)) * onFace;
  let edge = max(min(sy - 0.04, top - sy), 0.0);
  let corner = inside * ((1.0 - smoothstep(0.0, 0.05, edge)) * 0.6 + clamp(su / 0.04, 0.0, 1.0) * 0.35);
  let shellAo = clamp(1.0 - lip * 0.42 - foot * 0.38 - corner * 0.55, 0.25, 1.0);
  if (mt.map.x >= 0.0) {
    let t = textureSample(tAtlas, sAtlas, atlasUv(mt.map, v.uv, mt.kind.y));
    s.alb *= srgbToLinear(t.rgb) * mt.kind.w; s.alpha *= t.a;
  }
  if (mt.emap.x >= 0.0) { s.emit *= srgbToLinear(textureSample(tAtlas, sAtlas, atlasUv(mt.emap, v.uv, mt.kind.z)).rgb); }
  if (kind == ${CK_KIND.basic}) { s.unlit = true; }
  else if (kind == ${CK_KIND.faceChart} || kind == ${CK_KIND.faceWind}) {
    let fuv = vec2f(v.uv.x, 1.0 - v.uv.y);
    var t = textureSample(tFaceC, sAtlas, fuv);
    if (kind == ${CK_KIND.faceWind}) { t = textureSample(tFaceW, sAtlas, fuv); }
    s.alb = srgbToLinear(t.rgb) * mt.kind.w; s.unlit = true; s.alpha = 1.0;
  }
  else if (kind == ${CK_KIND.gel}) {
    let drift = noise3(p * vec3f(0.55, 0.9, 0.42) + 3.1); let drift2 = noise3(p * vec3f(1.7, 2.2, 1.3) + 9.7);
    let wear = smoothstep(0.25, 0.9, noise3(p * 0.9) * 0.5 + 0.5);
    let hands = onFace * smoothstep(0.26, 0.32, sy) * smoothstep(0.25, 0.45, abs(p.x)) * (1.0 - smoothstep(1.1, 1.45, abs(p.x))) * (noise3(p * vec3f(3.0, 6.0, 3.0)) * 0.3 + 0.75);
    var b = s.alb * (1.0 + drift * 0.05) * mix(vec3f(1.0), vec3f(0.985, 0.975, 0.95), wear);
    b = mix(b, b * vec3f(0.93, 0.92, 0.89) + 0.01, smoothstep(-0.2, 0.7, drift2) * 0.35);
    b = mix(b, b * vec3f(0.80, 0.81, 0.80), (1.0 - shellAo) * 0.55);
    b = mix(b, b * vec3f(0.95, 0.945, 0.93), hands * 0.6);
    s.alb = min(b, vec3f(0.72)) * mix(1.0, shellAo, 0.45); s.ao = shellAo;
    s.rough = 0.40 + wear * 0.08 + hands * 0.16; s.coat = 0.28 * (1.0 - hands * 0.6 - wear * 0.25);
  }
  else if (kind == ${CK_KIND.teakCap} || kind == ${CK_KIND.teakSole}) {
    // the boat's teak a few more summers on: silver-tan, the grain along the plank, the sole's planks fore and aft with caulked seams
    var across: f32; var along: f32;
    if (kind == ${CK_KIND.teakSole}) { across = p.x / 0.11 + 0.5; along = p.z; } else { across = v.uv.y * 0.5 + 0.25; along = v.uv.x * 6.0; }
    let plank = floor(across); let fx = fract(across);
    let rnd = fract(sin(plank * 12.9898) * 43758.5453);
    let grain = noise3(vec3f(fx * 4.0 + plank * 7.0, along * 0.6, plank)) * 0.5 + 0.5;
    let late = smoothstep(0.55, 0.85, fract(grain * 9.0 + fx * 2.0));
    var c = mix(vec3f(0.36, 0.27, 0.18), vec3f(0.50, 0.42, 0.33), 0.40) * (0.86 + rnd * 0.16) * (0.9 + 0.1 * grain) * (1.0 - late * 0.12);
    if (kind == ${CK_KIND.teakSole}) {
      let seam = (1.0 - smoothstep(0.02, 0.035, min(fx, 1.0 - fx)));
      c = mix(c, vec3f(0.02, 0.02, 0.02), seam);
      let suv = vec2f((p.x - CKU.sole.x) / (CKU.sole.y - CKU.sole.x), (p.z - CKU.sole.z) / (CKU.sole.w - CKU.sole.z));
      let ao = textureSample(tAtlas, sAtlas, vec2f(mix(mt.ex.y, mt.ex.w, clamp(suv.x, 0.0, 1.0)), mix(mt.ex.z, mt.pad.x, clamp(suv.y, 0.0, 1.0)))).r;
      s.ao = ao; c *= ao;
    } else { let capAo = mix(0.55, 1.0, smoothstep(0.35, 0.39, sy)); s.ao = capAo; c *= capAo; }
    s.alb = c; s.rough = 0.82; s.metal = 0.0; s.coat = 0.0;
  }
  else if (kind == ${CK_KIND.steel} || kind == ${CK_KIND.winch}) {
    let brush = noise3(p * vec3f(900.0, 6.0, 900.0)) * 0.5 + 0.5;
    let ws = smoothstep(0.74, 0.82, noise3(p * 55.0 + 3.3) * 0.5 + 0.5) * smoothstep(0.0, 0.6, noise3(p * 5.0 + 1.7));
    s.alb = mix(s.alb * (0.95 + brush * 0.08), vec3f(0.66, 0.66, 0.64), ws * 0.4);
    s.rough = s.rough + brush * 0.05 + ws * 0.2;
  }
  else if (kind == ${CK_KIND.powder}) {
    let peel = noise3(p * 260.0) * 0.5 + 0.5;
    s.alb = s.alb * (0.9 + peel * 0.2) * mix(1.0, shellAo, 0.5); s.rough = 0.74 + peel * 0.1; s.ao = shellAo;
  }
  else if (kind == ${CK_KIND.rope}) {
    let along = v.uv.x * 40.0;
    let fleck = smoothstep(0.86, 0.88, fract(along + v.uv.y + mt.ex.x));
    let s1 = fract(along * 9.0 + v.uv.y * 2.0 + mt.ex.x * 9.0); let s2 = fract(along * 9.0 - v.uv.y * 2.0 + mt.ex.x * 9.0);
    let strand = smoothstep(0.0, 0.5, min(s1, 1.0 - s1)) * smoothstep(0.0, 0.5, min(s2, 1.0 - s2));
    let grime = noise3(vec3f(along * 0.7, v.uv.y * 3.0, 0.5)) * 0.5 + 0.5;
    s.alb = mix(mix(vec3f(0.80, 0.77, 0.69), vec3f(0.70, 0.67, 0.60), grime * 0.6), vec3f(0.03, 0.04, 0.11), fleck) * (0.76 + strand * 0.24);
    s.rough = 0.86 + strand * 0.08;
  }
  else if (kind == ${CK_KIND.glass}) {
    let r = length(v.uv - 0.5) * 2.0;
    let salt = smoothstep(0.62, 1.0, r) * (noise3(vec3f(v.uv * 14.0, 2.0)) * 0.35 + 0.75);
    let haze = 1.0 - 0.85 * CKU.misc.y;
    s.alb = mix(vec3f(0.012, 0.016, 0.022), vec3f(0.62, 0.63, 0.62), salt * 0.5); s.alpha = 0.07 + salt * 0.13 * haze; s.rough = 0.08 + salt * 0.4;
  }
  let ex = 1.0 / max(CKU.misc.x, 1e-4);
  if (s.unlit) {
    let a = clamp(s.alpha, 0.0, 1.0);
    return vec4f(s.alb * a, a);
  }
  // the world's light in the world's orientation
  let nW = normalize(toWorld(nl));
  let V0 = normalize(CKU.cam.xyz - v.cp); let Vw = normalize(toWorld(V0));
  let sd = normalize(F.sun.xyz);
  let ndl = max(dot(nW, sd), 0.0);
  let eSun = sunPerp();
  let eSky = ambientAt(nW) * s.ao;
  let rough = clamp(s.rough, 0.04, 1.0); let metal = clamp(s.metal, 0.0, 1.0);
  let f0 = mix(vec3f(0.04), s.alb, metal);
  var R = reflect(-Vw, nW); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(nW, Vw), 0.0), 5.0);
  var col = s.alb * (1.0 - metal) / PI * (eSun * ndl + eSky) + skyMirror(R) * fres * (1.0 - 0.7 * rough) * mix(1.0, s.ao, 0.5) + ggxSpec(nW, Vw, sd, rough, f0) * eSun;
  if (s.coat > 0.0) {
    let fc = 0.04 + 0.96 * pow(1.0 - max(dot(nW, Vw), 0.0), 5.0);
    let coatL = skyMirror(R) * fc * (1.0 - 0.7 * s.coatRough) * s.ao + ggxSpec(nW, Vw, sd, max(s.coatRough, 0.04), vec3f(0.04)) * eSun;
    col = col * (1.0 - s.coat * fc) + coatL * s.coat;
  }
  col += s.emit * ex;   // a backlight or the lit amber: screen terms (÷ the exposure)
  var a = clamp(s.alpha, 0.0, 1.0);
  if (kind == ${CK_KIND.glass}) { a = clamp(a + (fres.x - 0.04) * (1.0 - a), 0.0, 1.0); }
  return vec4f(col * a, a);
}`;

// BACKLOG-v2 #46: which bake a page loads. v1 rebuilds the coaming for a screen wider than 16:9 (cockpitView's hw = 3.3 × the
// aspect / (16:9)), so its ends always leave the frame; v2 draws a baked shell, so a desktop wider than WIDE_AT takes the wide bake
// (tools/v2-cockpit-bake.mjs, 1920 × 720: hw 4.95). Its ends leave the frame up to 8:3 (a 32:9 screen still sees them) and the
// instruments in them stay whole on screen from about 2:1 (at 1.9:1 the dials touch the edges). Picked at load (a window dragged across the line keeps its bake).
export const WIDE_AT = 2.05;
export const cockpitBake = ({ phone = false, w = 16, h = 9 } = {}) => (phone ? 'phone' : w / Math.max(1, h) > WIDE_AT ? 'wide' : 'desktop');
export function createCockpit({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa, depthFormat, errors = [], phone = null, defer = false }) {   // defer: the asset's fetch waits for load() (perf/v2-phone-load: main.js asks after the terrain's first stage)
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, FR = GPUShaderStage.FRAGMENT;
  const mbgl = device.createBindGroupLayout({ label: 'ck-model', entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: MODEL_BYTES } },
    { binding: 1, visibility: FR, texture: { sampleType: 'depth' } },
    { binding: 2, visibility: FR, sampler: { type: 'comparison' } },
    { binding: 3, visibility: VF, buffer: { type: 'uniform' } }] });
  const cbgl = device.createBindGroupLayout({ label: 'ck', entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
    { binding: 1, visibility: FR, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: FR, texture: {} }, { binding: 3, visibility: FR, sampler: {} },
    { binding: 4, visibility: FR, texture: {} }, { binding: 5, visibility: FR, texture: {} }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, mbgl, cbgl] });
  const mod = reg.shader('cockpit', CK_WGSL(frameStruct));
  const BUFS = [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }, { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'snorm8x4' }] },
    { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }, { arrayStride: 12, attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x3' }] }];
  const prim = { topology: 'triangle-list', cullMode: 'none' };
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const P = (name, { write, blended, bias = false }) => reg.add(name, { layout, vertex: { module: mod, entryPoint: 'vs', buffers: BUFS }, fragment: { module: mod, entryPoint: 'fs', targets: [blended ? { ...hdrTarget, blend } : hdrTarget] },
    primitive: prim, depthStencil: { format: depthFormat, depthWriteEnabled: write, depthCompare: 'greater', ...(bias ? { depthBias: 2, depthBiasSlopeScale: 1.5 } : {}) }, multisample: { count: msaa } });
  P('ck-opaque', { write: true, blended: false });
  P('ck-blend', { write: false, blended: true });
  P('ck-blend-dw', { write: true, blended: true });
  P('ck-blend-po', { write: false, blended: true, bias: true });

  const isPhone = phone ?? feature('cockpitModel').tier === 'phone';   // src/core/features.js: a phone-sized frame of a phone or tablet
  const bake = cockpitBake({ phone: isPhone, w: globalThis.innerWidth ?? 16, h: globalThis.innerHeight ?? 9 });
  const url = bake === 'phone' ? new URL('../assets/cockpit/phone.ckb.gz', import.meta.url) : bake === 'wide' ? new URL('../assets/cockpit/wide.ckb.gz', import.meta.url) : new URL('../assets/cockpit/desktop.ckb.gz', import.meta.url);   // three literals: a build emits each
  let gpu = null, rig = null, faces = null, faceDirty = { chart: true, wind: true }, opacity = 1, shown = true, maxDraws = 0;
  const stats = { draws: 0, tris: 0, bytes: 0, loadMs: null, uploads: 0, bake };
  let t0 = performance.now(), kick = null;
  const go = defer ? new Promise((r) => { kick = r; }) : null;
  const ready = (async () => {
    if (go) { await go; t0 = performance.now(); }
    const r = await fetch(url); if (!r.ok) throw new Error(`cockpit asset ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer()); stats.bytes = bytes.byteLength;
    const a = await parseCockpit(bytes);
    const bmp = await createImageBitmap(new Blob([a.atlasPng], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    build(a, bmp);
    stats.loadMs = performance.now() - t0;
    return rig;
  })().catch((e) => { errors.push(`cockpit: ${e?.message ?? e}`); return null; });

  let json = null, opaqueList = [], blendList = [];
  function build(a, bmp) {
    json = a.json;
    rig = createCockpitRig(json, { coverFrames: a.coverFrames });
    const U = GPUBufferUsage;
    const vb = device.createBuffer({ label: 'ck-vertices', size: a.vertices.byteLength, usage: U.VERTEX | U.COPY_DST }); device.queue.writeBuffer(vb, 0, a.vertices);
    const ib = device.createBuffer({ label: 'ck-indices', size: a.indices.byteLength, usage: U.INDEX | U.COPY_DST }); device.queue.writeBuffer(ib, 0, a.indices);
    const nM = json.meshes.length;
    const mbuf = device.createBuffer({ label: 'ck-models', size: STRIDE * nM, usage: U.UNIFORM | U.COPY_DST });
    const sbuf = device.createBuffer({ label: 'ck-shadow-none', size: SHADOW_U_FLOATS * 4, usage: U.UNIFORM | U.COPY_DST });
    const cbuf = device.createBuffer({ label: 'ck-uniform', size: 112, usage: U.UNIFORM | U.COPY_DST });
    const matBuf = device.createBuffer({ label: 'ck-mats', size: 16 * MAT_VEC4 * json.materials.length, usage: U.STORAGE | U.COPY_DST });
    const atlas = device.createTexture({ label: 'ck-atlas', size: [bmp.width, bmp.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    device.queue.copyExternalImageToTexture({ source: bmp, flipY: false }, { texture: atlas, premultipliedAlpha: false }, [bmp.width, bmp.height]);
    bmp.close?.();
    const fpx = 384;
    const mkFace = (n) => device.createTexture({ label: `ck-face-${n}`, size: [fpx, fpx], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const faceTex = { chart: mkFace('chart'), wind: mkFace('wind') };
    const samp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: 1 });
    const dummyDepth = device.createTexture({ label: 'ck-depth-none', size: [1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
    const sCmp = device.createSampler({ compare: 'less' });
    const mbg = device.createBindGroup({ layout: mbgl, entries: [{ binding: 0, resource: { buffer: mbuf, size: STRIDE } }, { binding: 1, resource: dummyDepth.createView() }, { binding: 2, resource: sCmp }, { binding: 3, resource: { buffer: sbuf } }] });
    const cbg = device.createBindGroup({ layout: cbgl, entries: [{ binding: 0, resource: { buffer: cbuf } }, { binding: 1, resource: { buffer: matBuf } }, { binding: 2, resource: atlas.createView() }, { binding: 3, resource: samp },
      { binding: 4, resource: faceTex.chart.createView() }, { binding: 5, resource: faceTex.wind.createView() }] });
    const off = Object.fromEntries(json.layout.streams.map((s) => [s.name, s]));
    // an upright phone's slots (the wheel, the jib's and the main's winch): each its own camera uniform and bind group
    const slotGpu = ['wheel', 'jib', 'main'].map((key) => { const buf = device.createBuffer({ label: `ck-slot-${key}`, size: 112, usage: U.UNIFORM | U.COPY_DST });
      return { key, buf, bg: device.createBindGroup({ layout: cbgl, entries: [{ binding: 0, resource: { buffer: buf } }, { binding: 1, resource: { buffer: matBuf } }, { binding: 2, resource: atlas.createView() }, { binding: 3, resource: samp },
        { binding: 4, resource: faceTex.chart.createView() }, { binding: 5, resource: faceTex.wind.createView() }] }), u: new Float32Array(28), vp: null }; });
    // each node's item ancestor (the slots draw only their item's meshes)
    const under = (root) => { const m = new Uint8Array(json.nodes.length); for (let i = 0; i < m.length; i++) { for (let k = i; k >= 0; k = json.nodes[k].parent) if (k === root) { m[i] = 1; break; } } return m; };
    gpu = { slotGpu, under, vb, ib, mbuf, cbuf, matBuf, mbg, cbg, faceTex, off, models: new Float32Array(STRIDE / 4 * nM), mats: new Float32Array(4 * MAT_VEC4 * json.materials.length), cu: new Float32Array(28) };
    // the face materials and the kinds
    const R = json.roles;
    gpu.kind = json.materials.map((m) => kindOf(m));
    gpu.kind[R.inst.chart.faceMat] = CK_KIND.faceChart; gpu.kind[R.inst.wind.faceMat] = CK_KIND.faceWind;
    // the draw lists: opaque first; the blended by renderOrder, then far to near from the camera (three's order)
    const camZ = 8, nodeZ = (i) => json.nodes[i].p[2];
    json.meshes.forEach((m, i) => { const mt = json.materials[m.mat]; (mt.transparent ? blendList : opaqueList).push(i); });
    blendList.sort((x, y) => (json.meshes[x].renderOrder - json.meshes[y].renderOrder) || (nodeZ(json.meshes[x].node) - nodeZ(json.meshes[y].node)) || (x - y));
    void camZ;
    maxDraws = nM;
    writeMats(); writeModels();
  }
  function writeMats() {
    const M = gpu.mats, S = rig.matState;
    json.materials.forEach((m, i) => {
      const o = i * 4 * MAT_VEC4, k = gpu.kind[i], L = LOOK[k] ?? {}, st = S[i];
      const col = k === CK_KIND.plain || k === CK_KIND.basic ? m.color ?? [1, 1, 1] : L.color ?? m.color ?? [1, 1, 1];
      M[o] = col[0]; M[o + 1] = col[1]; M[o + 2] = col[2]; M[o + 3] = L.opacity ?? m.opacity ?? 1;
      M[o + 4] = L.metal ?? m.metalness ?? 0; M[o + 5] = L.rough ?? m.roughness ?? 0.5; M[o + 6] = L.coat ?? m.clearcoat ?? 0; M[o + 7] = L.coatRough ?? m.clearcoatRoughness ?? 0.2;
      const ec = st.emissiveColor ?? [0, 0, 0], ei = st.emissive ?? 0;
      M[o + 8] = ec[0] * ei; M[o + 9] = ec[1] * ei; M[o + 10] = ec[2] * ei; M[o + 11] = 0;
      const mr = st.map, er = st.emissiveMap;
      M.set(mr ?? [-1, -1, -1, -1], o + 12); M.set(er ?? [-1, -1, -1, -1], o + 16);
      M[o + 20] = k; M[o + 21] = m.mapFlipY === false ? 0 : 1; M[o + 22] = m.emissiveMapFlipY === false ? 0 : 1; M[o + 23] = st.colorScale ?? 1;
      M[o + 24] = st.run ?? 0;
      if (json.soleAo && i === json.soleAo.mat) { const r = json.soleAo.rect; M[o + 25] = r[0]; M[o + 26] = r[1]; M[o + 27] = r[2]; M[o + 28] = r[3]; }
    });
    device.queue.writeBuffer(gpu.matBuf, 0, M);
    rig.dirty.mats = false;
  }
  function writeModels() {
    rig.compose();
    const F = gpu.models, W = rig.world, f = STRIDE / 4;
    json.meshes.forEach((m, i) => { F.set(W.subarray(16 * m.node, 16 * m.node + 16), i * f); F.set(W.subarray(16 * m.node, 16 * m.node + 16), i * f + 16); F[i * f + 32] = rig.matOf[i]; });
    device.queue.writeBuffer(gpu.mbuf, 0, F);
    rig.dirty.nodes = false; stats.uploads++;
  }
  function writeCover() {
    const CV = json.cover;
    CV.meshNodes.forEach((node, k) => {
      const mi = json.meshes.findIndex((m) => m.node === node); if (mi < 0) return;
      device.queue.writeBuffer(gpu.vb, gpu.off.position.offset + 12 * json.meshes[mi].vfirst, rig.coverPos[k]);
    });
    rig.dirty.cover = false;
  }
  const ck = {
    ready, stats, get rig() { return rig; },
    load() { kick?.(); return ready; },   // a deferred asset: its fetch starts now (once; no-op otherwise)
    show(v) { shown = !!v; }, setOpacity(v) { opacity = v; }, setMaxPx() {},
    setFaces(c) { faces = c; },
    faceDrawn(side) { faceDirty[side] = true; },
    // the frame's uniforms and whatever the rig changed (one writeBuffer each, only on a change)
    fill({ w, h, sun, heading = 0, exposure = 1 }) {
      if (!rig || !rig.view) return;
      const matsMoved = rig.dirty.mats;   // a switched material (a toggle's lamp) is the mesh's index in the models buffer: writeMats clears the flag
      if (matsMoved) writeMats();
      if (rig.dirty.nodes || matsMoved) writeModels();
      if (rig.dirty.cover) writeCover();
      if (faces) for (const side of ['chart', 'wind']) if (faceDirty[side]) {
        faceDirty[side] = false;
        try { device.queue.copyExternalImageToTexture({ source: faces[side], flipY: false }, { texture: gpu.faceTex[side], premultipliedAlpha: false }, [384, 384]); } catch (e) { errors.push(`cockpit face: ${e?.message ?? e}`); }
      }
      const C = gpu.cu;
      C.set(rig.vp, 0); C[16] = rig.camPos[0]; C[17] = rig.camPos[1]; C[18] = rig.camPos[2]; C[19] = rig.headingNow;
      C[20] = exposure; C[21] = 0; C[22] = 0; C[23] = 0;
      const b = json.soleAo?.box ?? [-4, 4, -2, 2]; C[24] = b[0]; C[25] = b[1]; C[26] = b[2]; C[27] = b[3];
      device.queue.writeBuffer(gpu.cbuf, 0, C);
      slotFrame = { w, h, sx: w / Math.max(1, globalThis.innerWidth ?? w), heading, exposure };
      fillSlots();
      void sun;
    },
    get on() { return !!rig?.view && shown && opacity > 0.004; },
    // an upright phone's slots (v1's grid form): list = [{ key, root, vp, camPos, yaw, rect (css px) }] or null; drawn while set,
    // whatever the cockpit's own show (the station hides the cockpit in that form)
    setSlots(list) { slots = list && list.length ? list : null; },
    get slots() { return slots ? slots.map((S) => ({ key: S.key, rect: { ...S.rect } })) : null; },
    drawOpaque(pass, c) { if (ck.on) draw(pass, c, opaqueList, false); if (slots && gpu) drawSlots(pass, c, false); },
    drawBlend(pass, c) { if (ck.on) draw(pass, c, blendList, true); if (slots && gpu) drawSlots(pass, c, true); },
  };
  let slots = null, slotFrame = { w: 1, h: 1, sx: 1, heading: 0, exposure: 1 };
  // the slots' uniforms (fill: after the frame's own): v1's slot camera, the light turned by the heading and the item's own turn
  function fillSlots() {
    if (!slots || !gpu) return;
    const b = json.soleAo?.box ?? [-4, 4, -2, 2];
    for (const S of slots) {
      const G = gpu.slotGpu.find((g) => g.key === S.key); if (!G) continue;
      const C = G.u;
      C.set(S.vp, 0); C[16] = S.camPos[0]; C[17] = S.camPos[1]; C[18] = S.camPos[2]; C[19] = slotFrame.heading + S.yaw;
      C[20] = slotFrame.exposure; C[21] = 0; C[22] = 0; C[23] = 0; C[24] = b[0]; C[25] = b[1]; C[26] = b[2]; C[27] = b[3];
      device.queue.writeBuffer(G.buf, 0, C);
      G.mask ??= gpu.under(S.root);
    }
  }
  function drawSlots(pass, c, blended) {
    const { w, h, sx } = slotFrame;
    for (const S of slots) {
      const G = gpu.slotGpu.find((g) => g.key === S.key); if (!G?.mask) continue;
      const x0 = Math.max(0, Math.floor(S.rect.x * sx)), y0 = Math.max(0, Math.floor(S.rect.y * sx));
      const x1 = Math.min(w, Math.ceil((S.rect.x + S.rect.w) * sx)), y1 = Math.min(h, Math.ceil((S.rect.y + S.rect.h) * sx));
      if (x1 - x0 < 1 || y1 - y0 < 1) continue;
      // the viewport is the slot's whole rect (the projection's aspect), clipped by the scissor where it leaves the target
      const vx = S.rect.x * sx, vy = S.rect.y * sx, vw = S.rect.w * sx, vh = S.rect.h * sx;
      if (vx < 0 || vy < 0 || vx + vw > w || vy + vh > h) continue;   // WebGPU wants the viewport inside the target
      pass.setViewport(vx, vy, vw, vh, 0, 1); pass.setScissorRect(x0, y0, x1 - x0, y1 - y0);
      draw(pass, c, blended ? blendList : opaqueList, blended, G);
    }
    pass.setViewport(0, 0, w, h, 0, 1); pass.setScissorRect(0, 0, w, h);
  }
  function draw(pass, c, list, blended, slot = null) {
    pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(3, slot ? slot.bg : gpu.cbg);
    const o = gpu.off;
    pass.setVertexBuffer(0, gpu.vb, o.position.offset); pass.setVertexBuffer(1, gpu.vb, o.normal.offset);
    pass.setVertexBuffer(2, gpu.vb, o.uv.offset); pass.setVertexBuffer(3, gpu.vb, o.sh.offset);
    pass.setIndexBuffer(gpu.ib, 'uint32');
    let cur = null;
    if (!blended) { pass.setPipeline(reg.get('ck-opaque')); cur = 'ck-opaque'; }
    for (const i of list) {
      const m = json.meshes[i];
      if (!rig.visible[m.node] || (slot && !slot.mask[m.node])) continue;
      if (blended) {
        const mt = json.materials[rig.matOf[i]];
        const name = mt.polygonOffset ? 'ck-blend-po' : mt.depthWrite ? 'ck-blend-dw' : 'ck-blend';
        if (name !== cur) { pass.setPipeline(reg.get(name)); cur = name; }
      }
      pass.setBindGroup(2, gpu.mbg, [i * STRIDE]);
      pass.drawIndexed(m.count, 1, m.first, 0);
      c.calls++; c.triangles += m.count / 3;
    }
    void maxDraws;
  }
  return ck;
}
