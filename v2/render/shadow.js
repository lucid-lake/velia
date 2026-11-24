// The terrain's sun shadow (M5c): one orthographic depth map from the sun over the bay round the camera, drawn each
// frame by the terrain's own CDLOD patches (a second selection against the light's box, so a ridge outside the view
// still casts into it) and the shore boulders; read by the terrain (the north walls and the island's lee at a low sun),
// the forest cards, the boulders and the bed (the island's shadow on the shelf). The box: SHADOW.half m round a point
// SHADOW.ahead m before the eye, snapped to texels in the light's frame (no crawl), SHADOW.depth m deep along the sun.
// A 4-tap PCF read with a slope-scaled bias (the map's texel is 2.4 m at 2048²: terrain-scale shadows, soft). Cleared
// and left empty once the sun is 2° under the horizon (SHADOW_OFF_Y): everything lit by the sky alone.
//   const S = createTerrainShadow({ device, reg, frameBGL, frameBG, U, frameStruct, terrain });
//   S.update(eye, fwd, sun)    per frame: the light's matrix (one writeBuffer of 80 B), the light-box selection
//   S.encode(enc, c, ts)       the frame's pass: the depth map
//   S.bgl / S.view / S.sampler / S.buffer   for the readers (SHADOW_STRUCT + SHADOW_READ)
import { frustumPlanes, createSelector, TREE, PATCH } from '../terrain/quadtree.js';
import { multiply } from '../engine/math.js';
import { TERRAIN_BIND, TERRAIN_HEIGHT } from './terrain.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';

export const SHADOW = Object.freeze({ size: 2048, half: 2500, ahead: 700, depth: 7000, biasM: 3.0 });
export const SHADOW_OFF_Y = Math.sin(-2 * Math.PI / 180);   // the sun's height (y of its unit vector) under which the map is cleared and left empty

export { SHADOW_STRUCT, SHADOW_READ };

// the terrain's patches from the light: the CDLOD vertex (the camera's morph, so the geometry is the drawn one)
export const SHADOW_TERRAIN_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${TERRAIN_BIND(1)}
${TERRAIN_HEIGHT}
${SHADOW_STRUCT}
@group(2) @binding(0) var<uniform> SH: Shadow;
@group(2) @binding(1) var<storage, read> inst: array<vec4f>;
const ROOT = ${TREE.origin.toFixed(1)}; const M1 = ${PATCH + 1}u; const RANGE0 = ${TREE.range0.toFixed(1)}; const MORPH = ${TREE.morph};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let I = inst[ii];
  let g = vec2f(f32(vi % M1), f32(vi / M1));
  let cell = I.w;
  var xz = I.xy + g * cell;
  let d = distance(F.cam.xz, xz);
  let range = RANGE0 * exp2(I.z);
  let k = clamp((d - MORPH * range) / ((1.0 - MORPH) * range), 0.0, 1.0);
  let gi = g + (I.xy - vec2f(ROOT)) / cell;
  xz -= fract(gi * 0.5) * 2.0 * cell * k;
  return SH.vp * vec4f(xz.x, terrainHeight(xz.x, xz.y), xz.y, 1.0);
}`;

const identity = (m) => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; };
const ortho = (m, half, near, far) => { identity(m); m[0] = 1 / half; m[5] = 1 / half; m[10] = -1 / (far - near); m[14] = -near / (far - near); return m; };
function lightView(out, e, d) {
  const up = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  let rx = d[1] * up[2] - d[2] * up[1], ry = d[2] * up[0] - d[0] * up[2], rz = d[0] * up[1] - d[1] * up[0];
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * d[2] - rz * d[1], uy = rz * d[0] - rx * d[2], uz = rx * d[1] - ry * d[0];
  out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * e[0] + ry * e[1] + rz * e[2]);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * e[0] + uy * e[1] + uz * e[2]);
  out[2] = -d[0]; out[6] = -d[1]; out[10] = -d[2]; out[14] = d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return [rx, ry, rz, ux, uy, uz];
}
// the light box's centre and matrix (pure): the point `ahead` m before the eye along fwd (horizontal), snapped to texels
// in the light's right/up frame so the map's texels stay put as the camera moves; returns { vp, on, centre }
export function shadowMatrix(eye, fwd, sun, S = SHADOW, out = { vp: new Float32Array(16), view: new Float32Array(16), proj: new Float32Array(16), centre: [0, 0, 0], on: false }) {
  const sl = Math.hypot(sun[0], sun[1], sun[2]) || 1, sd = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
  // on until the sun is under every slope's horizon (−2°: the dip from the bay's highest ground, ≈ 1.1 km over the lake, is 1.8°),
  // so no surface sees the sun unshadowed: it was off under +0.57°, and a moving sun lit every ridge and wall at once for its last
  // 2° (a pop at 20:21 on July 4th, the day clock 2026-11-13)
  out.on = sd[1] > SHADOW_OFF_Y;
  const fl = Math.hypot(fwd[0], fwd[2]) || 1;
  const c = [eye[0] + fwd[0] / fl * S.ahead, 0, eye[2] + fwd[2] / fl * S.ahead];
  const e = [c[0] + sd[0] * S.depth / 2, c[1] + sd[1] * S.depth / 2, c[2] + sd[2] * S.depth / 2];
  const dir = [-sd[0], -sd[1], -sd[2]];
  const [rx, ry, rz, ux, uy, uz] = lightView(out.view, e, dir);
  // snap the eye to whole texels along right and up
  const texel = 2 * S.half / S.size;
  const pr = rx * e[0] + ry * e[1] + rz * e[2], pu = ux * e[0] + uy * e[1] + uz * e[2];
  const dr = Math.round(pr / texel) * texel - pr, du = Math.round(pu / texel) * texel - pu;
  e[0] += rx * dr + ux * du; e[1] += ry * dr + uy * du; e[2] += rz * dr + uz * du;
  lightView(out.view, e, dir);
  ortho(out.proj, S.half, 0, S.depth);
  multiply(out.vp, out.proj, out.view);
  out.centre[0] = c[0]; out.centre[1] = c[1]; out.centre[2] = c[2];
  return out;
}

// every: a live page re-draws the map every `every` frames (the sun moves 0.25° a minute, the box 2.5 km wide: a
// 4-frame lag is 0.3 m of boat); it also re-draws when the sun turned 0.1° or the box's centre moved 400 m, and on the
// first frame; a capture's frozen clock and fixed camera draw it once (1 draws it every frame: the budget's measure)
export function createTerrainShadow({ device, reg, frameBGL, frameBG, U, frameStruct, terrain, S = SHADOW, every = 4 }) {
  const tex = device.createTexture({ label: 'terrain-shadow-map', size: [S.size, S.size], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  const view = tex.createView();
  const sampler = device.createSampler({ label: 'terrain-shadow-cmp', compare: 'less', magFilter: 'linear', minFilter: 'linear' });
  const data = new Float32Array(20);
  const buffer = device.createBuffer({ label: 'terrain-shadow-u', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const instBuf = device.createBuffer({ label: 'terrain-shadow-instances', size: TREE.maxInstances * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT, C = GPUShaderStage.COMPUTE;
  const bgl = device.createBindGroupLayout({ label: 'terrain-shadow', entries: [{ binding: 0, visibility: VX | FR | C, buffer: { type: 'uniform' } }, { binding: 1, visibility: VX, buffer: { type: 'read-only-storage' } }] });
  const bg = device.createBindGroup({ label: 'terrain-shadow', layout: bgl, entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: instBuf } }] });
  const mod = reg.shader('terrain-shadow', SHADOW_TERRAIN_WGSL(frameStruct));
  reg.add('terrain-shadow', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, terrain.hbgl, bgl] }), vertex: { module: mod, entryPoint: 'vs' },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' } });
  const selector = createSelector(terrain.bounds);
  const planes = new Float64Array(20);
  const M = { vp: new Float32Array(16), view: new Float32Array(16), proj: new Float32Array(16), centre: [0, 0, 0], on: false };
  let count = 0, draw = false, frame = 0, drawn = 0, swapsSeen = -1;
  const last = { sun: [0, 0, 0], centre: [1e9, 0, 1e9], on: null };
  const casters = [];   // { draw(pass, c) }: others may join the pass
  const written = { vp: new Float32Array(16), p: new Float32Array(4) };
  return {
    S, view, sampler, buffer, bgl, bg, selector, stats: { instances: 0, on: false, draws: 0, frames: 0 },
    addCaster(d) { casters.push(d); },
    get every() { return every; },
    setEvery(n) { if (Number.isInteger(n) && n >= 0) every = n; },   // the phone pass: a quality level's cadence, live
    get matrix() { return M; },
    // per frame: the light's matrix and the patches inside its box (the camera's LOD: the drawn geometry), and whether
    // this frame re-draws the map; the record the readers use is written only when the map is (the two agree)
    update(eye, fwd, sun) {
      shadowMatrix(eye, fwd, sun, S, M);
      frame++;
      const sunDot = M.on ? sun[0] * last.sun[0] + sun[1] * last.sun[1] + sun[2] * last.sun[2] : 1;
      const moved = Math.hypot(M.centre[0] - last.centre[0], M.centre[2] - last.centre[2]);
      draw = drawn === 0 || last.on !== M.on || (M.on && (sunDot < Math.cos(0.1 * Math.PI / 180) || moved > 400 || terrain.stats.swaps !== swapsSeen || (every > 0 && frame % every === 0)));
      count = 0;
      if (draw) {
        data.set(M.vp, 0); data[16] = M.on ? 1 : 0; data[17] = S.biasM / S.depth; data[18] = 1 / S.size; data[19] = 2 * S.half / S.size;
        device.queue.writeBuffer(buffer, 0, data);
        if (M.on) {
          frustumPlanes(M.vp, planes);
          count = selector.select(eye, planes);
          if (count) device.queue.writeBuffer(instBuf, 0, selector.inst.buffer, 0, count * 16);
        }
        last.sun[0] = sun[0]; last.sun[1] = sun[1]; last.sun[2] = sun[2]; last.centre[0] = M.centre[0]; last.centre[2] = M.centre[2]; last.on = M.on; swapsSeen = terrain.stats.swaps;
      }
      this.stats.instances = count; this.stats.on = M.on; this.stats.frames = frame;
    },
    // the frame's pass (before the scene): the depth from the sun, when due; else the map and its record stand
    encode(enc, c, timestampWrites = undefined, terrainIndex, indexCount) {
      // the map stands: no pass (perf(v2) phone: was an empty render pass on the map, which a tile GPU (Apple) loads into
      // tile memory and stores back even with no draw: 2048² depth32float, 16 MB in and 16 MB out, 11 of every 12 frames
      // at L2); false tells the frame graph its timestamps were not written (0 ms)
      if (!draw) return false;
      drawn++; this.stats.draws = drawn;
      const pass = enc.beginRenderPass({ label: 'terrain-shadow', colorAttachments: [], depthStencilAttachment: { view, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, timestampWrites });
      if (M.on && count) {
        pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, terrain.heightsBindGroup); pass.setBindGroup(2, bg);
        pass.setPipeline(reg.get('terrain-shadow')); pass.setIndexBuffer(terrainIndex, 'uint16'); pass.drawIndexed(indexCount, count); c.calls++; c.triangles += count * PATCH * PATCH * 2;
        for (const d of casters) d.draw(pass, c);
      }
      pass.end();
    },
  };
}
