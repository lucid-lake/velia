// The sun's caustics on the lake bed (Ultra-Water milestone 2, BACKLOG-v2 #56).
// Ported from Ultra-Water's src/water/Caustics.js (Humpalumps/Ultra-Water@ce9248f, MIT, "Copyright (c) 2026 Humpalumps";
// the notice: src/waters/ultra/LICENSE), which takes the method from Evan Wallace's WebGL Water: area-ratio splatting.
//   A grid over one tile of a slope cascade is refracted through the drawn slopes onto planes at three depths; every landed
//   triangle adds (its undisturbed area / its landed area) to that depth's channel, 4× multisampled so the fold slivers
//   (far thinner than a texel) add by coverage. The result tiles with the cascade, is the light at that depth relative to
//   flat water (mean 1 by construction: the mesh is watertight, the tile's energy is its area) and multiplies the sun's
//   share of the bed's light. The flat-water landing offset is taken off, so the pattern is registered to the surface
//   point the sun's ray entered by: the bed looks it up at (entry + the cascades' warp) / the tile (CAUSTIC_WGSL).
//   Ultra splats its 12 m cascade alone (an ocean's 2–14 m waves are steep enough to focus a crisp net in a few metres).
//   The lake's are not: at wind 2–3 its 12 m waves focus 10–40 m down, so on our 1–6 m shelf they draw broad soft bands.
//   The crisp net a Tahoe shallow shows is the ripples' (0.3–2 m: the 2.1 m cascade), so v2 splats both: layer 0 the 12 m
//   cascade (Ultra's 1.5 / 4 / 10 m planes: the broad bands, the deep light), layer 1 the 2.1 m cascade (0.6 / 1.5 / 4 m:
//   the fine net, faded out by 9 m, where the sun's disc and the passing focus have blurred it), and the bed multiplies
//   the two (the light through both lenses; the two patterns are independent, so the product keeps the mean 1).
//   What differs from Ultra: WebGPU (render passes with additive blending, a resolve, a compute mip chain); the slices
//   in one 2-layer rgba16float array (one of the terrain fragment's 16 textures, two taps a bed pixel); the deep slices
//   blurred by the sun's disc through the mip level, not by a coarser target; nothing drawn while the sun is down (the bed
//   reads no caustic then); the phone path (the water's lite row) splats layer 0 alone into a 256² array at the sim's half
//   rate (its 2.1 m cascade holds no ripples there: render/water.js FLAT3_WGSL), layer 1 left at flat light.
// Per frame (the sun up): two render passes (6 draws, ≈ 0.2 M triangles at 512²), one compute pass (the mip chains).
// Every pipeline and texture is made at load; nothing is allocated in the frame.
import { LENGTHS, N } from '../sim/spectrum.js';

export const CAUSTICS = Object.freeze({
  eta: 1 / 1.333,           // air → water (N_WATER)
  maxRatio: 16,             // Ultra's firefly clamp: energy above it is dropped
  res: 512, phoneRes: 256,  // the array's texels a tile side
  // per layer: the water's slope cascade, its tile (m); per slice: its depth (m), the grid's cells a tile, the margin of
  // cells past each edge (covers the largest landing offset, |slope| 0.25 with the sun 20° up: wrap-around instead of 3 × 3
  // tiles; Ultra's 6 / 7 / 8 were for its own demo); deeper slices are focused
  // by longer waves, so they take coarser slope mips
  layers: Object.freeze([
    Object.freeze({ cascade: 2, tile: LENGTHS[2], slices: Object.freeze([
      Object.freeze({ depth: 1.5, cells: 128, margin: 7 }), Object.freeze({ depth: 4, cells: 64, margin: 9 }), Object.freeze({ depth: 10, cells: 32, margin: 10 })]) }),
    Object.freeze({ cascade: 3, tile: LENGTHS[3], slices: Object.freeze([
      Object.freeze({ depth: 0.6, cells: 128, margin: 13 }), Object.freeze({ depth: 1.5, cells: 128, margin: 30 }), Object.freeze({ depth: 4, cells: 32, margin: 20 })]) }),
  ]),
});

// The bed's caustic (render/bed.js), as plain numbers: the strength it is drawn at, by depth and the sun's height, and the
// sun disc's blur. gain: how far the splatted light departs from its mean (1 = Ultra's physical contrast).
export const CAUSTIC_LOOK = Object.freeze({
  gain: 1.0,
  depthIn: [0.0, 1.5],     // m: none at the waterline (Ultra's mix(1, v, depth / 1.5)), full by 1.5 m
  depthOut: [10.0, 22.0],  // m: eased out past the deepest slice (the light they move is under the image's scatter there)
  fineOut: [4.0, 9.0],     // m: the ripples' net (layer 1) eased out past its deepest slice
  sunIn: [0.02, 0.4],      // the sun's height (sin elevation): none below 1°, soft at golden hour, full from 24°
  disc: 0.0068,            // the sun disc's blur a metre of depth (its 0.53° under water: 0.4°), m
});
import { smooth } from '../../src/sim/core/math.js';
// the strength the bed draws the caustic at (0: flat light): the JS twin of the shader's causticStrength
export function causticStrength(depthM, sunY, L = CAUSTIC_LOOK) {
  if (!(sunY > 0)) return 0;
  return smooth(L.depthIn[0], L.depthIn[1], depthM) * (1 - smooth(L.depthOut[0], L.depthOut[1], depthM)) * smooth(L.sunIn[0], L.sunIn[1], sunY) * L.gain;
}
// the ripples' share at a depth (the JS twin of the shader's fine weight)
export const fineWeight = (depthM, L = CAUSTIC_LOOK) => 1 - smooth(L.fineOut[0], L.fineOut[1], depthM);
// a layer's slice blend at a depth: [w0, w1, w2] (the JS twin of sliceMix)
export function sliceWeights(depthM, S = CAUSTICS.layers[0].slices) {
  const [d0, d1, d2] = S.map((s) => s.depth);
  if (depthM <= d0) return [1, 0, 0];
  if (depthM < d1) { const t = (depthM - d0) / (d1 - d0); return [1 - t, t, 0]; }
  const t = Math.min(1, (depthM - d1) / (d2 - d1)); return [0, 1 - t, t];
}
// the mip level the sun disc's blur asks for at a depth (texels of res over the tile)
export const discLod = (depthM, tile, res = CAUSTICS.res, L = CAUSTIC_LOOK) => Math.max(0, Math.log2(Math.max(depthM * L.disc * res / tile, 1)));

// the splat's landing offset (tile units) for a surface slope (sx, sz), the sun toward (x, y, z), a plane depth / tile
// down: the JS twin of the vertex shader's d (refracted through the slope's normal, less flat water's landing)
function refract(I, Nn, eta) {
  const d = I[0] * Nn[0] + I[1] * Nn[1] + I[2] * Nn[2], k = 1 - eta * eta * (1 - d * d);
  if (k < 0) return [0, 0, 0];
  const m = eta * d + Math.sqrt(k);
  return [eta * I[0] - m * Nn[0], eta * I[1] - m * Nn[1], eta * I[2] - m * Nn[2]];
}
export function landing(sx, sz, sun, depthOverTile, eta = CAUSTICS.eta) {
  const sl = Math.hypot(sun[0], sun[1], sun[2]), I = [-sun[0] / sl, -sun[1] / sl, -sun[2] / sl];
  const nl = Math.hypot(sx, 1, sz), r = refract(I, [-sx / nl, 1 / nl, -sz / nl], eta), rf = refract(I, [0, 1, 0], eta);
  return [(r[0] / Math.max(-r[1], 0.05) - rf[0] / Math.max(-rf[1], 0.05)) * depthOverTile, (r[2] / Math.max(-r[1], 0.05) - rf[2] / Math.max(-rf[1], 0.05)) * depthOverTile];
}

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const [L0, L1] = CAUSTICS.layers;

// the bed's lookup (render/bed.js; needs tCaustic, sSlope, warpOf, M: terrain.js's M5c record): the sun's relative light at bed point p, dep m down,
// sunU the refracted sun (toward it, in the water), fp the pixel's blur (m)
export const CAUSTIC_WGSL = `
const CT_L0 = ${f(L0.tile)}; const CT_L1 = ${f(L1.tile)};
const CT_A = vec3f(${L0.slices.map((s) => f(s.depth)).join(', ')}); const CT_B = vec3f(${L1.slices.map((s) => f(s.depth)).join(', ')});
const CT_GAIN = ${f(CAUSTIC_LOOK.gain)}; const CT_DISC = ${CAUSTIC_LOOK.disc};
const CT_IN0 = ${f(CAUSTIC_LOOK.depthIn[0])}; const CT_IN1 = ${f(CAUSTIC_LOOK.depthIn[1])}; const CT_OUT0 = ${f(CAUSTIC_LOOK.depthOut[0])}; const CT_OUT1 = ${f(CAUSTIC_LOOK.depthOut[1])};
const CT_FINE0 = ${f(CAUSTIC_LOOK.fineOut[0])}; const CT_FINE1 = ${f(CAUSTIC_LOOK.fineOut[1])};
const CT_SUN0 = ${CAUSTIC_LOOK.sunIn[0]}; const CT_SUN1 = ${CAUSTIC_LOOK.sunIn[1]};
fn causticStrength(dep: f32, sunY: f32) -> f32 {
  return smoothstep(CT_IN0, CT_IN1, dep) * (1.0 - smoothstep(CT_OUT0, CT_OUT1, dep)) * smoothstep(CT_SUN0, CT_SUN1, sunY) * CT_GAIN;
}
// one layer's light at a depth: its three slices blended (Ultra's waveCaustic mix), past the deepest kept
fn sliceMix(c: vec3f, dep: f32, d: vec3f) -> f32 {
  let a = clamp((dep - d.x) / (d.y - d.x), 0.0, 1.0); let b = clamp((dep - d.y) / (d.z - d.y), 0.0, 1.0);
  return select(mix(c.g, c.b, b), mix(c.r, c.g, a), dep < d.y);
}
// the splatted light (mean 1) where the sun's ray through the flat surface reaches bed point p: the entry point is p moved
// back up the refracted sun, the cascades' warp as the surface reads it (render/water.js); each layer at the pixel's blur
// or the sun disc's at that depth, whichever is wider
fn waveCaustic(p: vec2f, dep: f32, sunU: vec3f, fp: f32) -> f32 {
  let entry = p + sunU.xz / max(sunU.y, 0.1) * dep;
  let q = entry + warpOf(entry.x, entry.y);
  let res = f32(textureDimensions(tCaustic).x);
  let blur = max(fp, dep * CT_DISC);
  let c0 = textureSampleLevel(tCaustic, sSlope, q / CT_L0, 0, max(log2(blur * res / CT_L0), 0.0)).rgb;
  var v = sliceMix(c0, dep, CT_A);
  let wf = (1.0 - smoothstep(CT_FINE0, CT_FINE1, dep)) * step(0.5, M.bed2.x);   // the phone path (bed2.x 0: L2, L3) reads layer 0 alone (its ripples' layer is flat)
  if (wf > 0.0) {
    let c1 = textureSampleLevel(tCaustic, sSlope, q / CT_L1, 1, max(log2(blur * res / CT_L1), 0.0)).rgb;
    v *= mix(1.0, sliceMix(c1, dep, CT_B), wf);
  }
  return v;
}`;

// --- the splat (Ultra's VERT / FRAG in WGSL) ---
const ETA = CAUSTICS.eta.toFixed(9);
export const SPLAT_WGSL = `
struct SliceU { sun: vec4f, a: vec4f, mask: vec4f }   // sun: toward the sun (xyz); a: depth / tile, cells, lod, margin (tile units); mask: the channel (xyz), the cascade (w)
@group(0) @binding(0) var tS: texture_2d_array<f32>;
@group(0) @binding(1) var sS: sampler;
@group(0) @binding(2) var<uniform> S: SliceU;
@group(0) @binding(3) var<uniform> R: vec4f;   // the target's texels a side
struct VO { @builtin(position) pos: vec4f, @location(0) old: vec2f }
// a cubic B-spline from 4 bilinear taps (GPU Gems 2 ch. 20): the landed intensity goes with the slope's derivative, which
// bilinear makes piecewise constant (every slope texel would land as its own bead along the lines)
fn slopeBSpline(uv: vec2f, lod: f32, c: i32) -> vec2f {
  let size = vec2f(textureDimensions(tS, i32(lod)));
  let st = uv * size - 0.5; let i = floor(st); let fr = st - i;
  let f2 = fr * fr; let f3 = f2 * fr;
  let w0 = (1.0 - 3.0 * fr + 3.0 * f2 - f3) / 6.0; let w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  let w2 = (1.0 + 3.0 * fr + 3.0 * f2 - 3.0 * f3) / 6.0; let w3 = f3 / 6.0;
  let g0 = w0 + w1; let g1 = w2 + w3;
  let h0 = (i - 0.5 + w1 / g0) / size; let h1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * textureSampleLevel(tS, sS, h0, c, lod).xy + g1.x * textureSampleLevel(tS, sS, vec2f(h1.x, h0.y), c, lod).xy)
       + g1.y * (g0.x * textureSampleLevel(tS, sS, vec2f(h0.x, h1.y), c, lod).xy + g1.x * textureSampleLevel(tS, sS, h1, c, lod).xy);
}
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VO {
  // the grid: span × span cells (cells + 2 margins), two triangles a cell, no vertex buffer
  let cells = S.a.y; let m = round(S.a.w * cells) + 1.0; let span = u32(cells + 2.0 * m + 0.5);
  let q = vi / 6u; let k = vi % 6u;
  let corner = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(0u, 1u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 1u))[k];
  let g = vec2f(vec2u(q % span, q / span) + corner) - m;   // cell corner, in cells from the tile's corner
  let t = (g + 0.5) / cells;                                // tile uv at a texel centre of the slope's mip (outside 0..1 in the margins: the neighbours' light)
  let s = slopeBSpline(t, S.a.z, i32(S.mask.w));
  let sun = normalize(S.sun.xyz);
  let r = refract(-sun, normalize(vec3f(-s.x, 1.0, -s.y)), ${ETA});
  let rf = refract(-sun, vec3f(0.0, 1.0, 0.0), ${ETA});
  var d = (r.xz / max(-r.y, 0.05) - rf.xz / max(-rf.y, 0.05)) * S.a.x;
  d = clamp(d, vec2f(-S.a.w), vec2f(S.a.w));   // past the margin (steep facets at a low sun): clamped
  let land = t + d;
  var o: VO;
  o.pos = vec4f(land.x * 2.0 - 1.0, 1.0 - land.y * 2.0, 0.0, 1.0);   // texture v runs down (clip y up)
  o.old = t * R.x;
  return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  // raster space is the landed space at a texel a pixel: the landed area is 1, the ratio the undisturbed area per pixel
  let a = dpdx(v.old); let b = dpdy(v.old);
  return vec4f(S.mask.rgb * min(abs(a.x * b.y - a.y * b.x), ${f(CAUSTICS.maxRatio)}), 0.0);
}`;

// one level down: the 2 × 2 box mean of every layer (the light's mean stays the mean)
export const CMIP_WGSL = `
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let sz = textureDimensions(dst); if (g.x >= sz.x || g.y >= sz.y) { return; }
  let p = vec2i(g.xy) * 2; let l = i32(g.z);
  textureStore(dst, vec2i(g.xy), l, (textureLoad(src, p, l, 0) + textureLoad(src, p + vec2i(1, 0), l, 0) + textureLoad(src, p + vec2i(0, 1), l, 0) + textureLoad(src, p + vec2i(1, 1), l, 0)) * 0.25);
}`;

// the slice's grid: cells + 2 margins a side (the shader's span)
export const spanOf = (s) => s.cells + 2 * s.margin;
export const sliceLod = (s) => Math.max(0, Math.log2(N / s.cells));

// --- the GPU side ---
// slope: the water's slope texture (2d-array, mips); onView(view): called with the array view the bed reads (at load and
// when the phone path's size changes)
export function createCaustics({ device, reg, slope, onView }) {
  const FMT = 'rgba16float', NL = CAUSTICS.layers.length;
  const sizes = [CAUSTICS.res, CAUSTICS.phoneRes];
  const mkSet = (res) => {
    const levels = Math.log2(res) + 1;
    const msaaTex = device.createTexture({ label: `caustics-msaa-${res}`, size: [res, res], format: FMT, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const tex = device.createTexture({ label: `caustics-${res}`, size: [res, res, NL], format: FMT, mipLevelCount: levels, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
    const lv = (l) => tex.createView({ dimension: '2d-array', baseMipLevel: l, mipLevelCount: 1 });
    const resolve = (k) => tex.createView({ dimension: '2d', baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: k, arrayLayerCount: 1 });
    return { res, levels, msaaView: msaaTex.createView(), resolves: Array.from({ length: NL }, (_, k) => resolve(k)), view: tex.createView({ dimension: '2d-array' }), lv, tex };
  };
  const sets = sizes.map(mkSet);
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE;
  const bglS = device.createBindGroupLayout({ label: 'caustics-splat', entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, texture: { sampleType: 'float', viewDimension: '2d-array' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, sampler: {} },
    { binding: 2, visibility: VF, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 48 } },
    { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
  const bglM = device.createBindGroupLayout({ label: 'caustics-mip', entries: [{ binding: 0, visibility: C, texture: { sampleType: 'float', viewDimension: '2d-array' } }, { binding: 1, visibility: C, storageTexture: { access: 'write-only', format: FMT, viewDimension: '2d-array' } }] });
  // the slices' records at 256 B each (sun, depth / tile, cells, lod, margin, the channel, the cascade), layer by layer
  const slices = CAUSTICS.layers.flatMap((L, k) => L.slices.map((s, i) => ({ ...s, layer: k, channel: i, cascade: L.cascade, tile: L.tile })));
  const nS = slices.length;
  const sliceData = new Float32Array(64 * nS);
  const sliceBuf = device.createBuffer({ label: 'caustics-slices', size: 256 * nS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const resBuf = device.createBuffer({ label: 'caustics-res', size: 256 * sizes.length, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  { const r = new Float32Array(64 * sizes.length); sizes.forEach((s, i) => { r[64 * i] = s; }); device.queue.writeBuffer(resBuf, 0, r); }
  slices.forEach((s, i) => {
    const o = 64 * i;
    sliceData[o + 4] = s.depth / s.tile; sliceData[o + 5] = s.cells; sliceData[o + 6] = sliceLod(s); sliceData[o + 7] = (s.margin - 1) / s.cells;
    sliceData[o + 8 + s.channel] = 1; sliceData[o + 11] = s.cascade;
  });
  const sRep = device.createSampler({ label: 'caustics-slope', addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });
  const bgS = device.createBindGroup({ label: 'caustics-splat', layout: bglS, entries: [
    { binding: 0, resource: slope.createView({ dimension: '2d-array' }) }, { binding: 1, resource: sRep },
    { binding: 2, resource: { buffer: sliceBuf, size: 48 } }, { binding: 3, resource: { buffer: resBuf, size: 16 } }] });
  const bgM = sets.map((st) => Array.from({ length: st.levels - 1 }, (_, l) => device.createBindGroup({ label: `caustics-mip-${st.res}-${l}`, layout: bglM, entries: [{ binding: 0, resource: st.lv(l) }, { binding: 1, resource: st.lv(l + 1) }] })));
  const mS = reg.shader('caustics-splat', SPLAT_WGSL);
  reg.add('caustics-splat', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglS] }), vertex: { module: mS, entryPoint: 'vs' },
    fragment: { module: mS, entryPoint: 'fs', targets: [{ format: FMT, blend: { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } } }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, multisample: { count: 4 }, fixedSamples: true });   // folds past the focus land flipped: both faces; its own 4× target, not the scene's count
  const mM = reg.shader('caustics-mip', CMIP_WGSL);
  reg.add('caustics-mip', { layout: device.createPipelineLayout({ bindGroupLayouts: [bglM] }), compute: { module: mM, entryPoint: 'main' } });

  let active = 0;   // which set the bed reads (0: 512², 1: the phone path's 256²)
  let on = true, every = 1, phase = 0, frames = 0, drawn = 0, fine = true;
  const state = { up: false, valid: [false, false], fine: [false, false] };
  onView?.(sets[active].view);
  // per set, per layer: the pass (the splat into the multisampled target, resolved into the layer's mip 0); a layer left
  // flat (the phone path's ripples) is one cleared pass to 1 (flat water's light), drawn once
  const passDesc = sets.map((st) => st.resolves.map((rv) => ({ label: 'caustics', colorAttachments: [{ view: st.msaaView, resolveTarget: rv, loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })));
  const flatDesc = sets.map((st) => st.resolves.map((rv) => ({ label: 'caustics-flat', colorAttachments: [{ view: st.msaaView, resolveTarget: rv, loadOp: 'clear', storeOp: 'discard', clearValue: { r: 1, g: 1, b: 1, a: 0 } }] })));
  const mipDesc = { label: 'caustics-mip' };
  return {
    sets, slices, get active() { return active; }, get drawn() { return drawn; },
    get view() { return sets[active].view; },
    // the phone path (the water's lite row): the 256² set at the sim's rate, its ripples' layer flat (fine false: the
    // 2.1 m cascade holds none there); the bed's view follows (a bind group at the switch, not a frame)
    setLook({ phone, every: e, phase: ph, on: o, fine: fi } = {}) {
      if (o != null) on = !!o;
      if (e != null) every = Math.max(1, e | 0);
      if (ph != null) phase = ph | 0;
      if (fi != null && !!fi !== fine) { fine = !!fi; state.valid = [false, false]; }
      if (phone != null) { const k = phone ? 1 : 0; if (k !== active) { active = k; state.valid[k] = false; onView?.(sets[k].view); } }
    },
    // the frame's own passes (frame.js 'custom'): the splat and its mip chain, only with the sun up (the bed reads none then)
    encode(enc, sun, ts, frame = frames) {
      frames++;
      const up = on && sun[1] > 0.0;
      state.up = up;
      if (!up) return false;
      if (state.valid[active] && every > 1 && frame >= 4 && frame % every !== phase) return false;
      for (let i = 0; i < nS; i++) { const o = 64 * i; sliceData[o] = sun[0]; sliceData[o + 1] = sun[1]; sliceData[o + 2] = sun[2]; }
      device.queue.writeBuffer(sliceBuf, 0, sliceData);
      const st = sets[active];
      let first = true;
      for (let k = 0; k < NL; k++) {
        const flat = k > 0 && !fine;
        if (flat && state.valid[active] && state.fine[active] === false) continue;   // the flat layer stands
        const d = (flat ? flatDesc : passDesc)[active][k];
        if (ts && first) d.timestampWrites = { querySet: ts.querySet, beginningOfPassWriteIndex: ts.beginningOfPassWriteIndex }; else delete d.timestampWrites;
        first = false;
        const pass = enc.beginRenderPass(d);
        if (!flat) {
          pass.setPipeline(reg.get('caustics-splat'));
          slices.forEach((s, i) => { if (s.layer !== k) return; pass.setBindGroup(0, bgS, [256 * i, 256 * active]); const sp = spanOf(s); pass.draw(sp * sp * 6); });
        }
        pass.end();
      }
      if (ts) mipDesc.timestampWrites = { querySet: ts.querySet, ...(first ? { beginningOfPassWriteIndex: ts.beginningOfPassWriteIndex } : {}), endOfPassWriteIndex: ts.endOfPassWriteIndex }; else delete mipDesc.timestampWrites;
      const cp = enc.beginComputePass(mipDesc);
      cp.setPipeline(reg.get('caustics-mip'));
      for (let l = 0; l < st.levels - 1; l++) { const n = st.res >> (l + 1), gg = Math.ceil(n / 8); cp.setBindGroup(0, bgM[active][l]); cp.dispatchWorkgroups(gg, gg, NL); }
      cp.end();
      state.valid[active] = true; state.fine[active] = fine; drawn++;
      return true;
    },
    state,
  };
}
