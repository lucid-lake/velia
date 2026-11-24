// The post chain's bloom and the final pass's dither (owner, 2026-11-18; L4 + L5).
//
// Bloom: a soft glow round the bright things (the fireworks' bursts, the lightning bolt, the town and anchor lights, the
// masthead light, the sun's glitter), never a haze over the frame. A chain on its own half-resolution mip texture
// (rgba16float), run as one own pass between the scene and the composite (main.js 'bloom'):
//   down0  the scene's HDR colour (the MSAA resolve) times the frame's exposure, 4 bilinear taps over a 4 × 4 block, each
//          tap clamped, passed through a soft-knee threshold on display brightness (exposed 1.0 is about the tone curve's
//          white; nothing below the knee glows: the sky, the cream cockpit, the water), then Karis-weighted (1 / (1 + max
//          channel): one hot pixel cannot dominate its block, so a single glinting texel does not flash the glow on and off)
//   down   4-tap box halvings, down to `levels` mips (6 at most, the smallest at least 8 px)
//   up     back up, each level a 4-tap tent of the one below added onto it at `scatter` (blend constant): the tight core
//          dominates and the wide levels add only a faint skirt
// The composite adds mip 0, times strength / (1 + scatter + scatter² …), to the exposed colour before the tone curve.
// Three pipelines (group 'post', built after the first frame on a live page); none where the bloom is off (a phone:
// src/core/features.js 'bloom'). Off, the composite samples a 1 × 1 black texture at strength 0: the same pixels as before.
//
// Dither: in the composite, after the tone curve and the grade, before the 8-bit swap chain: a triangular ±1 LSB from two
// interleaved-gradient-noise samples of the pixel's position (Jimenez 2014). A fixed pattern (no time term): every
// capture is the same, and the dusk and night sky, the navy past the shelf and the fog lose their 8-bit bands. All devices.
//
// kar() and ign() and the 4-tap down/up shape are adapted from Abyssal Garden (Maksymilian Dendura, MIT,
// github.com/Noniv/abyssal-garden @ a596354, source/src/shaders.js W_BLIT and S_G; ATTRIBUTION.md). Its notice:
//   MIT License
//   Copyright (c) 2026 Maksymilian Dendura
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
//   rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
//   Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// threshold and knee in exposed HDR (1.0 ≈ the tone curve's white); clamp: a tap's ceiling before the Karis weight;
// strength: the glow's share added at the composite (the calm default; ?bloomk= scales it)
export const BLOOM = Object.freeze({ levels: 6, minPx: 8, threshold: 1.2, knee: 0.6, clamp: 64, scatter: 0.55, strength: 0.45 });
export const DITHER_LSB = 1;   // the dither's amplitude in 8-bit steps (triangular: −1 … +1)

// the mip sizes for a w × h frame: the first at half size (rounded up), each next halved, while the smaller side stays ≥ minPx
export function bloomLevels(w, h, max = BLOOM.levels, minPx = BLOOM.minPx) {
  const out = [];
  let x = Math.max(1, Math.ceil(w / 2)), y = Math.max(1, Math.ceil(h / 2));
  while (out.length < max && (out.length === 0 || Math.min(x, y) >= minPx)) { out.push([x, y]); x = Math.max(1, Math.ceil(x / 2)); y = Math.max(1, Math.ceil(y / 2)); }
  return out;
}
// the composite's factor for mip 0: strength over the up chain's total weight (1 + s + s² + … for n levels)
export function bloomGain(n, scatter = BLOOM.scatter, strength = BLOOM.strength) {
  let sum = 0, w = 1; for (let i = 0; i < n; i++) { sum += w; w *= scatter; }
  return n > 0 ? strength / sum : 0;
}
// the soft knee's weight for a brightness br (the shader's twin: the tests hold it): 0 below threshold − knee, a quadratic
// ramp through the knee, then (br − threshold) / br
export function kneeWeight(br, threshold = BLOOM.threshold, knee = BLOOM.knee) {
  const k = Math.max(knee, 1e-4);
  let rq = Math.min(Math.max(br - threshold + k, 0), 2 * k); rq = (rq * rq) / (4 * k);
  return Math.max(rq, br - threshold) / Math.max(br, 1e-4);
}
// the dither's offset at a pixel (the shader's twin), in 8-bit steps
export const ign = (x, y) => { const f = (v) => v - Math.floor(v); return f(52.9829189 * f(x * 0.06711056 + y * 0.00583715)); };
export const ditherAt = (x, y, lsb = DITHER_LSB) => (ign(x, y) + ign(x + 37, y + 17) - 1) * lsb;

// the post uniform (group 2 binding 3 of the composite; binding 2 of the bloom's own group): a = exposure, threshold, knee,
// clamp; b = the composite's bloom factor (0: none), the dither in 8-bit steps, the Purkinje shift's amount (0: none; render/purkinje.js)
// and its scale to the retinal illuminance
// c (the cinematic intro, ui/cinematicIntro.js): x the lens look (vignette, the warm/teal grade), y its film effects (grain, the edge
// fringe, the anamorphic streak), z the grain's frame seed, w 0; all 0 outside the intro
export const POST_WGSL = `struct Post { a: vec4f, b: vec4f, c: vec4f }`;
// the dither, shared by the composite (render/shaders.js TONEMAP): px the fragment's position, lsb the amplitude in steps
export const DITHER_WGSL = `
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn dither(px: vec2f, lsb: f32) -> f32 { return (ign(px) + ign(px + vec2f(37.0, 17.0)) - 1.0) * (lsb / 255.0); }`;

// The cinematic intro's lens look (owner, 2026-11-18; ui/cinematicIntro.js), in the composite only while the intro plays
// (Post.c.x > 0; a uniform branch, nothing outside it). All of it at its full strength in the bars' hold, eased to 0 with the retract:
//   vignette  the corners darkened by `vignette` (a share), from `vigIn` to `vigOut` frame heights from the centre
//   grade     shadows nudged teal, highlights warm (display space, after the tone curve and the noon LUT), by `shadow` / `high`
//   grain     a triangular per-pixel noise of ± `grain` (display units), strongest in the mid-tones; a hash of the pixel and the
//             frame's seed (a capture's seed is fixed: the same frame each run)
//   fringe    a chromatic aberration at the edges only: red out, blue in by `fringe` × r³ frame heights (about 2.4 px in the
//             corners at 1080 px; under a pixel within 0.55 heights of the centre)
//   streak    an anamorphic smear of the bloom's glow along the horizontal (8 taps of its mip 0), blue-white, at `streak` of the
//             bloom's own share; none where the bloom is off
// Cost: one uniform branch and, in the intro, 2 texture loads, 8 bloom taps and a hash per pixel; nothing on a phone (desktop only)
export const LENS = Object.freeze({ vignette: 0.3, vigIn: 0.38, vigOut: 1.05, shadow: [-0.012, 0.004, 0.016], high: [0.02, 0.008, -0.018], grain: 0.026, fringe: 0.0021, streak: 0.22, streakStep: 0.014 });
const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(4)).join(', ')})`;
export const LENS_WGSL = `
fn lensHash(p: vec2u, seed: u32) -> f32 {
  var x = p.x * 1973u + p.y * 9277u + seed * 26699u;
  x = (x ^ (x >> 16u)) * 0x7feb352du; x = (x ^ (x >> 15u)) * 0x846ca68bu; x = x ^ (x >> 16u);
  return f32(x) * (1.0 / 4294967296.0);
}
// the fringe's offset in px at px (dim the frame's size): along the radius, k × r³ frame heights
fn lensFringe(px: vec2f, dim: vec2f, k: f32) -> vec2f { let d = (px - 0.5 * dim) / dim.y; return d * dot(d, d) * k * dim.y * ${(LENS.fringe).toFixed(5)}; }
// the anamorphic streak: the bloom's glow smeared along x (uv the pixel's, tex the bloom's mip 0)
fn lensStreak(tex: texture_2d<f32>, s: sampler, uv: vec2f) -> vec3f {
  var a = vec3f(0.0);
  for (var i = 1; i <= 4; i++) {
    let o = vec2f(f32(i) * ${LENS.streakStep.toFixed(4)}, 0.0);
    a += (textureSampleLevel(tex, s, uv + o, 0.0).rgb + textureSampleLevel(tex, s, uv - o, 0.0).rgb) * (1.0 - f32(i) * 0.2);
  }
  return a * vec3f(0.55, 0.75, 1.0) * ${LENS.streak.toFixed(3)};
}
// the grade, the vignette and the grain on the encoded picture o (k the look, fx the film effects, seed the frame's)
fn lensLook(o: vec3f, px: vec2f, dim: vec2f, k: f32, fx: f32, seed: f32) -> vec3f {
  let r = length((px - 0.5 * dim) / dim.y);
  let l = dot(o, vec3f(0.2126, 0.7152, 0.0722));
  var c = o + k * mix(${v3(LENS.shadow)}, ${v3(LENS.high)}, smoothstep(0.12, 0.72, l));
  c *= 1.0 - k * ${LENS.vignette.toFixed(3)} * smoothstep(${LENS.vigIn.toFixed(3)}, ${LENS.vigOut.toFixed(3)}, r);
  if (fx > 0.0) {
    let q = vec2u(px); let sd = u32(seed);
    let g = lensHash(q, sd) + lensHash(q + vec2u(7u, 3u), sd) - 1.0;
    c += vec3f(g * ${LENS.grain.toFixed(4)} * fx * (0.45 + 0.55 * (1.0 - abs(2.0 * l - 1.0))));
  }
  return c;
}`;
// the vignette's factor at a pixel (the shader's twin: the tests hold it), k the look's amount
export function lensVignette(x, y, w, h, k = 1) {
  const r = Math.hypot((x - 0.5 * w) / h, (y - 0.5 * h) / h), e = Math.min(1, Math.max(0, (r - LENS.vigIn) / (LENS.vigOut - LENS.vigIn)));
  return 1 - k * LENS.vignette * e * e * (3 - 2 * e);
}
// the fringe's offset in px at a pixel (the shader's twin)
export function lensFringe(x, y, w, h, k = 1) { const dx = (x - 0.5 * w) / h, dy = (y - 0.5 * h) / h, r2 = dx * dx + dy * dy; return [dx * r2 * k * h * LENS.fringe, dy * r2 * k * h * LENS.fringe]; }

export const BLOOM_WGSL = `diagnostic(off, derivative_uniformity);
${POST_WGSL}
@group(0) @binding(0) var tSrc: texture_2d<f32>;
@group(0) @binding(1) var sLin: sampler;
@group(0) @binding(2) var<uniform> PP: Post;
struct VOut { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut; o.pos = vec4f(p[i], 0.0, 1.0); return o;
}
fn kar(c: vec3f) -> vec4f { let w = 1.0 / (1.0 + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
// the soft knee on one tap's exposed colour (before the average: a thin bright streak keeps its share instead of being
// averaged under the threshold with the dark round it)
fn knee(c: vec3f) -> vec3f {
  let br = max(c.r, max(c.g, c.b)); let k = max(PP.a.z, 1e-4);
  var rq = clamp(br - PP.a.y + k, 0.0, 2.0 * k); rq = rq * rq / (4.0 * k);
  return c * (max(rq, br - PP.a.y) / max(br, 1e-4));
}
fn tap0(uv: vec2f) -> vec4f { return kar(knee(min(textureSampleLevel(tSrc, sLin, uv, 0.0).rgb * PP.a.x, vec3f(PP.a.w)))); }
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(tSrc, sLin, uv, 0.0).rgb; }
@fragment fn fsDown0(v: VOut) -> @location(0) vec4f {
  let src = vec2f(textureDimensions(tSrc)); let uv = v.pos.xy * 2.0 / src; let e = 1.0 / src;
  let m = tap0(uv + e * vec2f(-1.0, -1.0)) + tap0(uv + e * vec2f(1.0, -1.0)) + tap0(uv + e * vec2f(-1.0, 1.0)) + tap0(uv + e * vec2f(1.0, 1.0));
  return vec4f(m.rgb / max(m.a, 1e-6), 1.0);
}
@fragment fn fsDown(v: VOut) -> @location(0) vec4f {
  let src = vec2f(textureDimensions(tSrc)); let uv = v.pos.xy * 2.0 / src; let e = 1.0 / src;
  return vec4f((tap(uv + e * vec2f(-1.0, -1.0)) + tap(uv + e * vec2f(1.0, -1.0)) + tap(uv + e * vec2f(-1.0, 1.0)) + tap(uv + e * vec2f(1.0, 1.0))) * 0.25, 1.0);
}
@fragment fn fsUp(v: VOut) -> @location(0) vec4f {
  let src = vec2f(textureDimensions(tSrc)); let uv = v.pos.xy * 0.5 / src; let e = 0.75 / src;
  return vec4f((tap(uv + e * vec2f(-1.0, -1.0)) + tap(uv + e * vec2f(1.0, -1.0)) + tap(uv + e * vec2f(-1.0, 1.0)) + tap(uv + e * vec2f(1.0, 1.0))) * 0.25, 1.0);
}`;

// createPost({ device, reg, on }): the post uniform and, where on, the bloom chain's pipelines (group 'post'), textures and
// bind groups. resize(targets) on each target change; encode(enc, ts) records the chain (false: nothing to do);
// write(queue, { exposure, gain, dither }) once a frame; view: the texture the composite samples (mip 0, or 1 × 1 black)
export function createPost({ device, reg, on = true, levels = BLOOM.levels }) {
  const FORMAT = 'rgba16float';
  const ubuf = device.createBuffer({ label: 'post', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const u = new Float32Array(12);
  const black = device.createTexture({ label: 'bloom-off', size: [1, 1], format: FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING });   // zeroed at creation
  const blackView = black.createView();
  const sampler = device.createSampler({ label: 'bloom', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  let bgl = null, tex = null, views = [], sizes = [], down = [], up = [];
  if (on) {
    bgl = device.createBindGroupLayout({ label: 'bloom', entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const layout = device.createPipelineLayout({ label: 'bloom', bindGroupLayouts: [bgl] });
    const mod = reg.shader('bloom', BLOOM_WGSL);
    const desc = (fs, blend) => ({ label: `bloom-${fs}`, layout, vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: fs, targets: [{ format: FORMAT, ...(blend ? { blend } : {}) }] }, primitive: { topology: 'triangle-list' } });
    const add = { color: { srcFactor: 'constant', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    const prev = reg.group('post');
    try { reg.add('bloom-down0', desc('fsDown0')); reg.add('bloom-down', desc('fsDown')); reg.add('bloom-up', desc('fsUp', add)); } finally { reg.group(prev); }
  }
  const bg = (view) => device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sampler }, { binding: 2, resource: { buffer: ubuf } }] });
  function resize(t) {
    if (!on) return;
    tex?.destroy();
    sizes = bloomLevels(t.w, t.h, levels);
    tex = device.createTexture({ label: 'bloom', size: [sizes[0][0], sizes[0][1]], format: FORMAT, mipLevelCount: sizes.length, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    views = sizes.map((_, i) => tex.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    down = sizes.map((_, i) => bg(i === 0 ? t.resolveView : views[i - 1]));   // down[i] reads the level above it (the scene for 0)
    up = sizes.map((_, i) => (i + 1 < sizes.length ? bg(views[i + 1]) : null));   // up[i] reads the level below it
  }
  const pass = (enc, i, load, ts, first, last) => enc.beginRenderPass({ label: 'bloom', colorAttachments: [{ view: views[i], loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    ...(ts && (first || last) ? { timestampWrites: { querySet: ts.querySet, ...(first ? { beginningOfPassWriteIndex: ts.beginningOfPassWriteIndex } : {}), ...(last ? { endOfPassWriteIndex: ts.endOfPassWriteIndex } : {}) } } : {}) });
  // the chain: n downs then n − 1 ups (the frame's timestamps: the first pass's start, the last pass's end)
  function encode(enc, ts, scatter = BLOOM.scatter) {
    if (!on || !tex || !(u[4] > 0)) return false;
    const n = sizes.length, total = 2 * n - 1; let k = 0;
    for (let i = 0; i < n; i++, k++) {
      const p = pass(enc, i, false, ts, k === 0, k === total - 1);
      p.setPipeline(reg.get(i === 0 ? 'bloom-down0' : 'bloom-down')); p.setBindGroup(0, down[i]); p.draw(3); p.end();
    }
    for (let i = n - 2; i >= 0; i--, k++) {
      const p = pass(enc, i, true, ts, k === 0, k === total - 1);
      p.setPipeline(reg.get('bloom-up')); p.setBindGroup(0, up[i]); p.setBlendConstant([scatter, scatter, scatter, scatter]); p.draw(3); p.end();
    }
    return true;
  }
  return {
    get on() { return on; },
    get levels() { return sizes.length; },
    get sizes() { return sizes.slice(); },
    get passes() { return on && sizes.length ? 2 * sizes.length - 1 : 0; },
    get view() { return on && tex ? views[0] : blackView; },
    buffer: ubuf,
    resize, encode,
    write(queue, { exposure = 1, gain = 0, dither = DITHER_LSB, threshold = BLOOM.threshold, knee = BLOOM.knee, clamp = BLOOM.clamp, lens = 0, lensFx = 0, seed = 0, purkinje = 0, pkScale = 1 } = {}) {
      u[0] = exposure; u[1] = threshold; u[2] = knee; u[3] = clamp; u[4] = on ? gain : 0; u[5] = dither; u[6] = purkinje; u[7] = pkScale;
      u[8] = lens; u[9] = lensFx; u[10] = seed; u[11] = 0;
      queue.writeBuffer(ubuf, 0, u);
    },
  };
}
