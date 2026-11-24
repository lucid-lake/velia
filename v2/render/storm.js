// The storm's GPU side (M5e): the rain (v1's src/weather/rain.js: thin grey streaks in a box round the camera, every
// drop placed in the vertex stage from a hash, falling and drifting with the wind at the camera, in depth layers; the
// drawn count follows the rain) and the lightning bolts (v1's src/weather/lightning.js: the strike's channel as
// camera-facing ribbons, a white-violet core and a wide soft glow, additive; its brightness the strike's flash). The
// rest of the storm rides the shared uniform's storm rows and the shaders that read them: the clouds' key (the cell),
// the water (the rings, the matte hiss, the outflow's band, the grey lid, the shaded glint), the aerial perspective
// (the haze), the sun's light (the cell's shade) and the composite (the grade, the flash, the rainbow). Both pipelines
// are declared at load; the bolt's vertices are rewritten on a new strike (one writeBuffer), the rain never.
//   const storm = createStormDraw({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa, depthFormat, pixels });
//   storm.update({ rain, vx, vz, dark, strike, flash, groundY })   each frame   storm.draw(pass, c, sky)   after the sky
import { RAIN, rainDropsFor, BOLT, boltMesh } from '../sim/storm.js';
import { ATMO_WGSL, SKY_READ } from './sky.js';
import { EXPOSURE } from '../sim/exposure.js';

const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128, VERTEX: 32, INDEX: 16 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// v1's hash (src/sim/weather/stormArc.js hash(seed, k, salt)), in u32: the same drop places as v1's rain
const HASH_WGSL = `
fn hashS(seed: u32, k: u32, salt: u32) -> f32 {
  var h = seed * 374761393u + k * 668265263u + salt * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}`;

export const RAIN_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
struct RainU { t: f32, vx: f32, vz: f32, amount: f32, dark: f32, cvx: f32, cvy: f32, cvz: f32 }   // cv: the camera's own velocity (m/s)
@group(2) @binding(0) var<uniform> R: RainU;
${HASH_WGSL}
struct RV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) a: f32, @location(2) col: vec3f }
const BOX = vec3f(${RAIN.box.map((x) => x.toFixed(1)).join(', ')}); const FALL_MS = ${RAIN.fallMs.toFixed(1)};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> RV {
  var corners = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let c = corners[vi];
  let d = vec4f(hashS(7u, ii, 1u), hashS(7u, ii, 2u), hashS(7u, ii, 3u), hashS(7u, ii, 4u));
  let cam = F.cam.xyz;
  // the drop's place: hashed, falling, drifting with the wind; wrapped into the box round the camera
  let fall = vec3f(R.vx, -FALL_MS, R.vz);
  let p0 = d.xyz * BOX + fall * (R.t + d.w * 3.0);
  let rel = (fract((p0 - cam) / BOX) - 0.5) * BOX;
  let p = cam + rel;
  // a motion-blurred streak along the drop's motion past the camera (≈ 0.6 m; ported from web-ocean-3d's src/sky/Weather.ts, MIT:
  // the drops stay in the world and the camera moves through them, so a following wind stands the streaks up and a head wind or
  // a fast boat lays them back), the near ones longer, wider and fainter, the far ones fine
  let dist = length(rel);
  let rv = fall - vec3f(R.cvx, R.cvy, R.cvz); let axis = rv / max(length(rv), 1e-3); let toCam = normalize(cam - p);
  let side = normalize(cross(axis, toCam));
  let near = 1.0 - smoothstep(2.0, 7.0, dist);
  let len = mix(0.45, 1.0, near) * (d.w * 0.4 + 0.8);
  let wid = max(dist * 0.0009, 0.0035) + near * 0.008;   // #18 r2: v1's (src/weather/rain.js)
  let pos = p + axis * ((c.y - 0.5) * len) + side * (c.x * wid);
  var o: RV; o.pos = F.viewProj * vec4f(pos, 1.0); o.uv = c;
  // none inside 1 m (no drop in the lens), gone by the box's edge (no wrap pop); the soft ends and cross-section are the fragment's (from the corner)
  o.a = smoothstep(1.0, 2.5, dist) * (1.0 - smoothstep(14.0, 21.0, dist)) * mix(0.24, 0.09, near) * mix(0.6, 1.0, d.x) * (R.amount * 0.5 + 0.5);   // #18 r2: v1's
  // grey: the drops show the overcast sky behind them, never brighter. #18 r2: v1's colour exactly (src/weather/rain.js,
  // storm.js): the tint × 1.6 × v1's hand-set light (its sunlit white, 0.6 / exposure, × the daylight × (1 − 0.4 × dark)), so
  // the same level reaches the tonemap
  let light = min(1.0, (max(normalize(F.sun.xyz).y, 0.0) + ${EXPOSURE.floor.toFixed(3)}) / ${(Math.sin(8.5 * Math.PI / 180) + EXPOSURE.floor).toFixed(6)});
  o.col = vec3f(0.62, 0.66, 0.72) * 1.6 * (0.6 * light / max(F.params.x, 1e-6)) * (1.0 - 0.4 * R.dark);
  return o;
}
@fragment fn fs(v: RV) -> @location(0) vec4f {
  let across = 1.0 - abs(v.uv.x); let along = clamp(1.0 - abs(v.uv.y - 0.5) * 2.0, 0.0, 1.0);
  let a = v.a * across * sqrt(along);
  return vec4f(v.col * a, a);
}`;

export const BOLT_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
struct BoltU { glow: f32, light: f32, core: f32, width: f32 }
@group(1) @binding(0) var<uniform> B: BoltU;
struct BV { @builtin(position) pos: vec4f, @location(0) x: f32, @location(1) taper: f32 }
@vertex fn vs(@location(0) p: vec3f, @location(1) along: vec3f, @location(2) side: vec2f) -> BV {
  let across = normalize(cross(normalize(along), normalize(F.cam.xyz - p)));
  var o: BV; o.pos = F.viewProj * vec4f(p + across * (side.x * side.y * B.width), 1.0); o.x = side.x; o.taper = side.y; return o;
}
@fragment fn fs(v: BV) -> @location(0) vec4f {
  let x = abs(v.x);
  var prof = pow(1.0 - x, 2.2); var col = vec3f(0.55, 0.6, 1.0); var k = 2.2;
  if (B.core > 0.5) { prof = 1.0 - smoothstep(0.35, 1.0, x); col = mix(vec3f(1.0, 0.98, 1.0), vec3f(0.85, 0.82, 1.0), x); k = 60.0; }
  // the core at ≈ 60 × a sunlit wall's luminance (the tonemap rolls it to white), the glow at ≈ 2 ×
  return vec4f(col * prof * B.glow * B.light * k * (v.taper * 0.6 + 0.4), 1.0);
}`;

// bolts false (a phone: the registry's lightningBolts row): no bolt mesh, buffers or pipeline; the rain draws as
// ever and the flash (the sky's and the scene's light, the composite's) and the thunder are the storm's, not this draw's
export function createStormDraw({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa = 1, depthFormat = 'depth32float', pixels = 2e6, bolts = true }) {
  const maxDrops = rainDropsFor(pixels);
  const rainU = new Float32Array(8), rainBuf = device.createBuffer({ label: 'storm-rain', size: 32, usage: BUF.UNIFORM | BUF.COPY_DST });
  const bglRain = device.createBindGroupLayout({ label: 'storm-rain', entries: [{ binding: 0, visibility: STAGE.VERTEX, buffer: { type: 'uniform' } }] });
  const bgRain = device.createBindGroup({ layout: bglRain, entries: [{ binding: 0, resource: { buffer: rainBuf } }] });
  const vbuf = bolts ? device.createBuffer({ label: 'storm-bolt-verts', size: BOLT.maxVerts * 32, usage: BUF.VERTEX | BUF.COPY_DST }) : null;
  const ibuf = bolts ? device.createBuffer({ label: 'storm-bolt-index', size: BOLT.maxVerts * 12, usage: BUF.INDEX | BUF.COPY_DST }) : null;
  const boltU = [new Float32Array([0, BOLT.light, 0, BOLT.glowM]), new Float32Array([0, BOLT.light, 1, BOLT.coreM])];
  const boltBufs = bolts ? boltU.map((u, i) => { const b = device.createBuffer({ label: `storm-bolt-${i}`, size: 16, usage: BUF.UNIFORM | BUF.COPY_DST }); device.queue.writeBuffer(b, 0, u); return b; }) : [];
  const bglBolt = bolts ? device.createBindGroupLayout({ label: 'storm-bolt', entries: [{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'uniform' } }] }) : null;
  const bgBolt = boltBufs.map((b) => device.createBindGroup({ layout: bglBolt, entries: [{ binding: 0, resource: { buffer: b } }] }));
  const mesh = bolts ? { verts: new Float32Array(BOLT.maxVerts * 8), index: new Uint32Array(BOLT.maxVerts * 3), nv: 0, ni: 0 } : { nv: 0, ni: 0 };
  const normal = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  const mR = reg.shader('storm-rain', RAIN_WGSL(frameStruct));
  reg.add('storm-rain', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bglRain] }), vertex: { module: mR, entryPoint: 'vs' }, fragment: { module: mR, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: normal }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  const mB = bolts ? reg.shader('storm-bolt', BOLT_WGSL(frameStruct)) : null;
  if (bolts) reg.add('storm-bolt', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bglBolt] }), vertex: { module: mB, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x2' }] }] },
    fragment: { module: mB, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: add }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  const state = { drops: 0, maxDrops, vx: 0, vz: 0, bolt: null, boltGlow: 0, builds: 0, bolts: !!bolts };
  return {
    stats: state,
    // rain 0–1 at the camera, the wind there (m/s), the scene time; strike: the bolt to show (or null) with its flash
    // 0–1.5 and the ground's height under it
    // vx, vz: the rain's drift (v2/sim/weatherWind.js rain: the wind at the eye, a gust leaning it more); cv*: the camera's velocity
    update({ rain = 0, vx = 0, vz = 0, cvx = 0, cvy = 0, cvz = 0, t = 0, dark = 0, strike = null, flash = 0, groundY = 0 }) {
      state.drops = Math.round(maxDrops * Math.min(1, Math.max(0, rain)));
      state.vx = vx; state.vz = vz;
      if (state.drops > 0) { rainU[0] = t; rainU[1] = vx; rainU[2] = vz; rainU[3] = rain; rainU[4] = dark; rainU[5] = cvx; rainU[6] = cvy; rainU[7] = cvz; device.queue.writeBuffer(rainBuf, 0, rainU); }
      const show = bolts && !!strike && flash > 0.002 && strike.bolt;
      if (show && strike.id !== state.bolt) {
        const m = boltMesh(strike, groundY, mesh.verts, mesh.index); mesh.nv = m.nv; mesh.ni = m.ni;
        device.queue.writeBuffer(vbuf, 0, mesh.verts, 0, mesh.nv * 8); device.queue.writeBuffer(ibuf, 0, mesh.index, 0, mesh.ni);
        state.bolt = strike.id; state.builds++;
      }
      state.boltGlow = show ? Math.min(1.5, flash) : 0;
      if (show) for (let i = 0; i < 2; i++) { boltU[i][0] = state.boltGlow; device.queue.writeBuffer(boltBufs[i], 0, boltU[i]); }
    },
    // after the sky (the rain shows the sky behind it; the bolt's glow adds over everything in front of the ridges)
    draw(pass, c, skyR) {
      if (state.drops > 0) {
        pass.setBindGroup(1, skyR.skyBG); pass.setBindGroup(2, bgRain);
        pass.setPipeline(reg.get('storm-rain')); pass.draw(6, state.drops); c.calls++; c.triangles += state.drops * 2;
      }
      if (state.boltGlow > 0 && mesh.ni > 0) {
        pass.setPipeline(reg.get('storm-bolt')); pass.setVertexBuffer(0, vbuf); pass.setIndexBuffer(ibuf, 'uint32');
        for (let i = 0; i < 2; i++) { pass.setBindGroup(1, bgBolt[i]); pass.drawIndexed(mesh.ni); c.calls++; c.triangles += mesh.ni / 3; }
      }
    },
  };
}
