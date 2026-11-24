// G1, G2 (the world audit, 2026-11-14): v1's landmarks and shore flags on v2's frame.
//   The landmarks (v1's src/landmarks.js): the tea-house ruin on Fannette's summit, the stone house with the sod roof at the
//     bay's head, the waterfall's white ribbon streaming down the creek's bed and its plunge foam; v1's own geometry, baked
//     (tools/v2-landmarks-bake.mjs → v2/assets/towns/landmarks.json), v1's materials in the shader: stoneMaterial (the stones'
//     MaterialX noise and the mortar's lines), the sod's noise, the waterfall's streaks scrolled by the scene's time
//     (uTime × 1.8) and its edge fade. The boulders are v2's already (render/rocks.js).
//   The shore flags (v1's src/shoreFlags.js): five poles and their cloth, flown from the local wind (v2/sim/shoreFlags.js),
//     the cloth written on the CPU each frame (5 flags × 27 vertices).
// Lit as the shore is (render/towns.js SHORE_LIGHT_WGSL: v1's MeshStandardMaterial on v2's sky: the sun through the
// transmittance, the terrain's shadow, the sky's diffuse and reflection, the night's land light, the aerial perspective, the
// clouds in front). Two pipelines declared at load: the opaque set (the ruin, the house, the poles, the cloth: one draw for
// the landmarks, one for the poles, one for the cloth) and the blended waterfall (one draw, after the sky). Data after the
// first frame (a capture: before it); nothing is allocated a frame.
//   const LM = createLandmarks({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, errors })
//   LM.load() after the first frame; await LM.prime() in a capture; LM.update({ wind, windT, waveT }) in fill();
//   LM.addParts(parts, { hide: 'ruin' }) a desktop's tea house (render/teaHouse.js), drawn with the landmarks, v1's ruin hidden;
//   LM.draw(pass, c, { flags }) after the towns; LM.drawBlend(pass, c) after the sky
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { SHORE_LIGHT_WGSL } from './towns.js';
import { MX_NOISE_WGSL } from './wake.js';
import { createShoreFlagsSim, SHORE_FLAGS } from '../sim/shoreFlags.js';

export const LANDMARKS_FILE = new URL('../assets/towns/landmarks.json', import.meta.url);
const FLOATS = 16, STRIDE = FLOATS * 4;   // pos 3, normal 3, a (rgb, kind), b (rgb, roughness), uv 2
const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

// MaterialX's 3-D Perlin noise (mx_perlin_noise_float: lookup3 on three ints, the 12-edge gradients, the quintic fade, the
// 0.982 scale), which v1's TSL mx_noise_float(vec3) is: about −1..1 (the 2-D one is wake.js's MX_NOISE_WGSL)
export const MX_NOISE3_WGSL = `
fn mxHash3(x: i32, y: i32, z: i32) -> u32 {
  var a = 0xdeadbeefu + (3u << 2u) + 13u; var b = a; var c = a;
  a += bitcast<u32>(x); b += bitcast<u32>(y); c += bitcast<u32>(z);
  c ^= b; c -= mxRot(b, 14u); a ^= c; a -= mxRot(c, 11u); b ^= a; b -= mxRot(a, 25u);
  c ^= b; c -= mxRot(b, 16u); a ^= c; a -= mxRot(c, 4u); b ^= a; b -= mxRot(a, 14u); c ^= b; c -= mxRot(b, 24u);
  return c;
}
fn mxGrad3(h0: u32, x: f32, y: f32, z: f32) -> f32 {
  let h = h0 & 15u; let u = select(y, x, h < 8u); let v = select(select(z, x, h == 12u || h == 14u), y, h < 4u);
  return select(u, -u, (h & 1u) != 0u) + select(v, -v, (h & 2u) != 0u);
}
fn mxNoise3(p: vec3f) -> f32 {
  let fl = floor(p); let X = i32(fl.x); let Y = i32(fl.y); let Z = i32(fl.z); let f = p - fl;
  let u = mxFade(f.x); let v = mxFade(f.y); let w = mxFade(f.z);
  let a = mix(mix(mxGrad3(mxHash3(X, Y, Z), f.x, f.y, f.z), mxGrad3(mxHash3(X + 1, Y, Z), f.x - 1.0, f.y, f.z), u),
              mix(mxGrad3(mxHash3(X, Y + 1, Z), f.x, f.y - 1.0, f.z), mxGrad3(mxHash3(X + 1, Y + 1, Z), f.x - 1.0, f.y - 1.0, f.z), u), v);
  let b = mix(mix(mxGrad3(mxHash3(X, Y, Z + 1), f.x, f.y, f.z - 1.0), mxGrad3(mxHash3(X + 1, Y, Z + 1), f.x - 1.0, f.y, f.z - 1.0), u),
              mix(mxGrad3(mxHash3(X, Y + 1, Z + 1), f.x, f.y - 1.0, f.z - 1.0), mxGrad3(mxHash3(X + 1, Y + 1, Z + 1), f.x - 1.0, f.y - 1.0, f.z - 1.0), u), v);
  return 0.982 * mix(a, b, w);
}`;

const MORTAR = lin(0x8a867d);
export const TEA_NIGHT = 0.15;   // the tea house's night trim (the fragment's tea kinds, below)
export const TEA_SKY = Object.freeze({ neutral: 0.85, tint: [1.0, 1.0, 0.98] });   // the tea house's sky light toward neutral (litTea, below)
export const LANDMARKS_WGSL = (fs, blend) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
@group(2) @binding(0) var tShadowT: texture_depth_2d;
@group(2) @binding(1) var sShadowT: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(2) var<uniform> SH: Shadow;
@group(2) @binding(3) var<uniform> LMU: vec4f;   // x: the scene's time (s, v1's uTime)
${SHADOW_READ('tShadowT', 'sShadowT')}
${MX_NOISE_WGSL}
${MX_NOISE3_WGSL}
const TEA_NIGHT = ${TEA_NIGHT.toFixed(3)}; const TEA_SKY_NEUTRAL = ${TEA_SKY.neutral.toFixed(3)}; const TEA_SKY_TINT = vec3f(${TEA_SKY.tint.map((x) => x.toFixed(3)).join(', ')});
struct VI { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) uv: vec2f }
struct VO { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) uv: vec2f }
@vertex fn vs(v: VI) -> VO {
  var o: VO; o.pos = F.viewProj * vec4f(v.p, 1.0); o.world = v.p; o.n = v.n; o.a = v.a; o.b = v.b; o.uv = v.uv; return o;
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;   // × the storm cell's shade (1 fair): the land under the deck, as the water and the boat (v1's sunShade)
}
${SHORE_LIGHT_WGSL}
// v1's MeshStandardMaterial under v2's light (render/towns.js's shore, above the water), then the air and the clouds in front
fn lit(p: vec3f, nIn: vec3f, A: vec3f, rough: f32, px: vec2f) -> vec3f {
  let s = normalize(F.sun.xyz); let V = normalize(F.cam.xyz - p);
  let n = nIn;
  let nl = max(dot(n, s), 0.0);
  var shadow = 0.0; if (nl > 0.001) { shadow = shadowAt(p, nl); }
  let eSky = LIGHT.sky.rgb + nightLand();
  let eSun = sunAt(p.y, s) * nl * shadow;
  let E = eSun + (skyIrr(n) + eSky * (0.5 + 0.5 * n.y)) * SKY_K;
  var out = aerial(A * E / PI + shoreSpec(n, V, s, A, rough, 0.0, eSun), px, p);
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return out;
}
// the tea house's light (its kinds 5, 6): lit()'s, with the sky's share and its reflection turned toward neutral. In shade this
// light is the sky's alone, about 2.5 × bluer than red, and the pale granite turned blue; the photos show it a neutral grey in
// shade as in sun (a camera's white balance; the eye's too), so TEA_SKY_NEUTRAL of the sky's colour goes to its luminance, a
// touch warm; the sun's share, the air in front and the clouds stay as lit()'s
fn litTea(p: vec3f, n: vec3f, A: vec3f, rough: f32, px: vec2f) -> vec3f {
  let s = normalize(F.sun.xyz); let V = normalize(F.cam.xyz - p);
  let nl = max(dot(n, s), 0.0);
  var shadow = 0.0; if (nl > 0.001) { shadow = shadowAt(p, nl); }
  let eSky = LIGHT.sky.rgb + nightLand();
  let eSun = sunAt(p.y, s) * nl * shadow;
  let sky = (skyIrr(n) + eSky * (0.5 + 0.5 * n.y)) * SKY_K;
  let neutral = vec3f(dot(sky, vec3f(0.2126, 0.7152, 0.0722))) * TEA_SKY_TINT;
  let spec = shoreSpec(n, V, s, A, rough, 0.0, eSun);
  let specN = mix(spec, vec3f(dot(spec, vec3f(0.2126, 0.7152, 0.0722))), TEA_SKY_NEUTRAL);
  var out = aerial(A * (eSun + mix(sky, neutral, TEA_SKY_NEUTRAL)) / PI + specN, px, p);
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return out;
}
@fragment fn fs(v: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let p = v.world; let kind0 = u32(round(v.a.w));
  // the tea house's own kinds (render/teaHouse.js, a desktop's): 5 its stone (kind 1's), 6 its plain parts (kind 0's), trimmed by night
  let tea = kind0 >= 5u; let kind = select(kind0, 6u - kind0, tea);
  var n = normalize(v.n); if (!ff) { n = -n; }   // v1's DoubleSide: the back face's normal turned to the viewer
  var A = v.a.rgb; var alpha = 1.0;
  if (kind == 1u) {          // v1's stoneMaterial: ≈ 0.4 m stones, the mortar's courses
    let blocks = mxNoise3(vec3f(p.x * 2.2, p.y * 3.5, p.z * 2.2));
    let mortar = select(smoothstep(0.55, 0.7, fract(p.y * 3.2) + blocks * 0.15), 0.0, tea);   // the tea house's stones are each a stone: no painted courses across them
    A = mix(mix(v.b.rgb, v.a.rgb, smoothstep(-0.4, 0.5, blocks)), vec3f(${MORTAR.map((x) => x.toFixed(6)).join(', ')}), mortar * 0.35);
  } else if (kind == 2u) {   // the sod roof
    A = mix(v.b.rgb, v.a.rgb, mxNoise(p.xz * 0.8) * 0.5 + 0.5);
  } else if (kind == 3u) {   // the waterfall: streaks falling downhill (v runs from the foot to the top), scrolled by the scene's time
    let streak = mxNoise(vec2f(v.uv.x * 9.0, v.uv.y * 5.0 + LMU.x * 1.8));
    let edge = smoothstep(0.0, 0.25, v.uv.x) * (1.0 - smoothstep(0.75, 1.0, v.uv.x));   // Safari: no reversed edges
    A = mix(v.b.rgb, v.a.rgb, streak * 0.5 + 0.5);
    alpha = edge * (0.55 + 0.35 * streak);
  } else if (kind == 4u) {   // the plunge foam
    alpha = 0.6;
  }
  var col: vec3f; if (tea) { col = litTea(p, n, A, v.b.w, v.pos.xy); } else { col = lit(p, n, A, v.b.w, v.pos.xy); }
  // the tea house by night: this shore light lifts a pale wall about ten times the terrain's own night (its sky term and the land
  // lift), so the pale granite glowed over the dark island; trimmed back to the day's ratio to the rock round it, under a sun
  // −7° to +1° (an ascending smoothstep: Safari)
  if (tea) { col *= mix(1.0, TEA_NIGHT, 1.0 - smoothstep(-0.12, 0.02, normalize(F.sun.xyz).y)); }
  ${blend ? 'let a = clamp(alpha, 0.0, 1.0); return vec4f(col * a, a);' : 'return vec4f(col, 1.0);'}
}`;

export function createLandmarks({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', errors = [], seed = 1 }) {
  const FR = GPUShaderStage.FRAGMENT, VX = GPUShaderStage.VERTEX;
  const bgl = device.createBindGroupLayout({ label: 'landmarks', entries: [{ binding: 0, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 1, visibility: FR, sampler: { type: 'comparison' } },
    { binding: 2, visibility: FR, buffer: { type: 'uniform' } }, { binding: 3, visibility: FR | VX, buffer: { type: 'uniform' } }] });
  const uni = new Float32Array(4), uBuf = device.createBuffer({ label: 'landmarks-u', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bg = device.createBindGroup({ label: 'landmarks', layout: bgl, entries: [{ binding: 0, resource: shadow.view }, { binding: 1, resource: shadow.sampler }, { binding: 2, resource: { buffer: shadow.buffer } }, { binding: 3, resource: { buffer: uBuf } }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] });
  const buffers = [{ arrayStride: STRIDE, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'float32x4' }, { shaderLocation: 3, offset: 40, format: 'float32x4' }, { shaderLocation: 4, offset: 56, format: 'float32x2' }] }];
  const mO = reg.shader('landmarks', LANDMARKS_WGSL(frameStruct, false)), mB = reg.shader('landmarks-blend', LANDMARKS_WGSL(frameStruct, true));
  reg.add('landmarks', { layout, vertex: { module: mO, entryPoint: 'vs', buffers }, fragment: { module: mO, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const over = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('landmarks-blend', { layout, vertex: { module: mB, entryPoint: 'vs', buffers }, fragment: { module: mB, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: over }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });

  const stats = { ready: false, bytes: 0, verts: 0, triangles: 0, flags: 0, samples: 0, loadMs: null, drawn: 0, parts: null };
  let vbuf = null, ibuf = null, clothV = null, clothData = null, flags = null, flagSites = null, R = null, loadP = null, wind = null;
  const t0 = performance.now();
  // parts → one interleaved vertex array and its indices (each part's colours to linear, its kind and roughness per vertex),
  // in the order of the named groups: { V, I, nv, ranges: { name: { first, count } } }
  function pack(groups, Index = Uint16Array) {
    let nv = 0, ni = 0;
    for (const g of Object.values(groups)) for (const p of g) { nv += p.pos.length / 3; ni += p.idx.length; }
    const V = new Float32Array(nv * FLOATS), I = new Index(Math.ceil(ni / 2) * 2), ranges = {};
    let v = 0, i = 0;
    for (const [name, g] of Object.entries(groups)) {
      const first = i;
      for (const p of g) {
        const a = lin(p.a), b = lin(p.b ?? p.a), base = v;
        for (let k = 0; k < p.pos.length / 3; k++, v++) {
          const o = v * FLOATS;
          V[o] = p.pos[3 * k]; V[o + 1] = p.pos[3 * k + 1]; V[o + 2] = p.pos[3 * k + 2];
          V[o + 3] = p.nrm[3 * k]; V[o + 4] = p.nrm[3 * k + 1]; V[o + 5] = p.nrm[3 * k + 2];
          V[o + 6] = a[0]; V[o + 7] = a[1]; V[o + 8] = a[2]; V[o + 9] = p.kind;
          V[o + 10] = b[0]; V[o + 11] = b[1]; V[o + 12] = b[2]; V[o + 13] = p.rough;
          V[o + 14] = p.uv ? p.uv[2 * k] : 0; V[o + 15] = p.uv ? p.uv[2 * k + 1] : 0;
        }
        for (const x of p.idx) I[i++] = base + x;
      }
      ranges[name] = { first, count: i - first };
    }
    return { V, I, nv, ni, ranges };
  }
  // the parts into one interleaved array: [v1's ruin][the other opaque landmarks][poles][blended waterfall], then the cloth's own
  // (dynamic) buffer. The ruin is its own range: a desktop's tea house (addParts, below) takes its place
  function land(J) {
    const solid = J.parts.filter((p) => p.kind < 3);
    const { V, I, nv, ni, ranges } = pack({ ruin: solid.filter((p) => p.who === 'ruin'), solid: solid.filter((p) => p.who !== 'ruin'), poles: J.poles, blend: J.parts.filter((p) => p.kind >= 3) });
    R = ranges;
    if (nv > 65535) throw new Error(`landmarks: ${nv} vertices`);
    vbuf = device.createBuffer({ label: 'landmarks-verts', size: V.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(vbuf, 0, V);
    ibuf = device.createBuffer({ label: 'landmarks-index', size: I.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(ibuf, 0, I);
    // the flags: their sites, the sim, the cloth's buffer (each flag's colour fixed; position and normal written a frame)
    flagSites = J.flags.sites;
    flags = createShoreFlagsSim({ sites: flagSites, wind: { sample: (x, z, t) => wind.sample(x, z, t) }, seed });
    clothData = new Float32Array(flags.positions.length / 3 * FLOATS);
    flagSites.forEach((s, k) => { const c = lin(s.col); for (let j = 0; j < flags.per; j++) { const o = (k * flags.per + j) * FLOATS; clothData[o + 6] = c[0]; clothData[o + 7] = c[1]; clothData[o + 8] = c[2]; clothData[o + 9] = 0; clothData[o + 10] = c[0]; clothData[o + 11] = c[1]; clothData[o + 12] = c[2]; clothData[o + 13] = 0.9; } });
    clothV = device.createBuffer({ label: 'landmarks-cloth', size: clothData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const ci = new Uint16Array(Math.ceil(flags.index.length / 2) * 2); ci.set(flags.index);
    R.cloth = { count: flags.index.length, ibuf: device.createBuffer({ label: 'landmarks-cloth-index', size: ci.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }) };
    device.queue.writeBuffer(R.cloth.ibuf, 0, ci);
    Object.assign(stats, { ready: true, verts: nv, triangles: ni / 3, flags: flagSites.length, parts: Object.fromEntries(Object.entries(R).map(([k, r]) => [k, r.count / 3])), loadMs: +(performance.now() - t0).toFixed(1) });
  }
  function load() {
    return (loadP ??= (async () => {
      const r = await fetch(LANDMARKS_FILE.href); if (!r.ok) throw new Error(`landmarks: ${r.status}`);
      const text = await r.text(); stats.bytes = text.length;
      land(JSON.parse(text));
    })().catch((e) => { errors.push(`landmarks: ${e?.message ?? e}`); }));
  }
  // a desktop's tea house (render/teaHouse.js, owner 2026-11-18): its parts into their own buffers, drawn by the same opaque
  // pipeline after the landmarks (no new pipeline); hide names the baked group it replaces (v1's ruin on the same summit)
  let extra = null, ruinHidden = false;
  function addParts(parts, { hide = null } = {}) {
    const { V, I, nv, ni, ranges } = pack({ extra: parts }, Uint32Array);
    const v = device.createBuffer({ label: 'landmarks-extra-verts', size: V.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(v, 0, V);
    const ib = device.createBuffer({ label: 'landmarks-extra-index', size: I.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(ib, 0, I);
    extra?.vbuf.destroy(); extra?.ibuf.destroy();
    extra = { vbuf: v, ibuf: ib, count: ranges.extra.count };
    if (hide === 'ruin') ruinHidden = true;
    stats.extra = { verts: nv, triangles: ni / 3, bytes: V.byteLength + I.byteLength, hides: hide };
    return stats.extra;
  }
  let flagsDue = false, shown = true;
  return {
    stats, load, prime: () => load(), addParts,
    get ruinHidden() { return ruinHidden; },
    hideRuin(v = true) { ruinHidden = !!v; },   // the owner's ruling (src/core/features.js oldRuin): v1's ruin off where no tea house replaces it
    get shown() { return shown; }, set shown(v) { shown = !!v; },   // the in-page A/B (tools/v2-ab-world.mjs): every draw off and on
    get flags() { return flags; }, get sites() { return flagSites; },
    // each frame (fill): the scene's time for the waterfall; the flags from the wind at windT (the wind's clock), their wave on
    // waveT (the scene's); off (a race: the towns' piers are cut, and the flags with them) the cloth stays as it was
    update({ wind: w, windT, waveT, flagsOn = true }) {
      uni[0] = waveT; device.queue.writeBuffer(uBuf, 0, uni);
      flagsDue = !!(flags && flagsOn && w);
      if (!flagsDue) return;
      wind = w;
      flags.update(windT, waveT);
      const P = flags.positions, N = flags.normals;
      for (let q = 0, n = P.length / 3; q < n; q++) { const o = q * FLOATS; clothData[o] = P[3 * q]; clothData[o + 1] = P[3 * q + 1]; clothData[o + 2] = P[3 * q + 2]; clothData[o + 3] = N[3 * q]; clothData[o + 4] = N[3 * q + 1]; clothData[o + 5] = N[3 * q + 2]; }
      device.queue.writeBuffer(clothV, 0, clothData);
      stats.samples = flags.samples;
    },
    // after the towns (opaque): the ruin and the house, the poles and the cloth (flags: not in a race)
    draw(pass, c, { flags: fOn = true } = {}) {
      if (!R || !shown) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setPipeline(reg.get('landmarks')); pass.setVertexBuffer(0, vbuf); pass.setIndexBuffer(ibuf, 'uint16');
      const s0 = ruinHidden ? R.solid : R.ruin, n0 = ruinHidden ? R.solid.count : R.ruin.count + R.solid.count;   // [ruin][solid]: one draw
      pass.drawIndexed(n0, 1, s0.first); c.calls++; c.triangles += n0 / 3;
      if (fOn && flagsDue) {
        pass.drawIndexed(R.poles.count, 1, R.poles.first); c.calls++; c.triangles += R.poles.count / 3;
        pass.setVertexBuffer(0, clothV); pass.setIndexBuffer(R.cloth.ibuf, 'uint16');
        pass.drawIndexed(R.cloth.count); c.calls++; c.triangles += R.cloth.count / 3;
      }
      if (extra) {   // the tea house (a desktop's): the same pipeline and bind groups, its own buffers
        pass.setVertexBuffer(0, extra.vbuf); pass.setIndexBuffer(extra.ibuf, 'uint32');
        pass.drawIndexed(extra.count); c.calls++; c.triangles += extra.count / 3;
      }
    },
    // after the sky (blended, no depth written): the waterfall's ribbon and its foam
    drawBlend(pass, c) {
      if (!R || !shown || !R.blend.count) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setPipeline(reg.get('landmarks-blend')); pass.setVertexBuffer(0, vbuf); pass.setIndexBuffer(ibuf, 'uint16');
      pass.drawIndexed(R.blend.count, 1, R.blend.first); c.calls++; c.triangles += R.blend.count / 3;
    },
  };
}
export { SHORE_FLAGS };
