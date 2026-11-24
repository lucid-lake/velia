// The wet exhaust on v2's engine (#14): v1's clots (src/boat/exhaustSim.js, stepped by v2/sim/seamanship.js) drawn as v1's
// src/boat/exhaust.js draws them: camera-facing soft discs (a sprite of `size` m, its alpha 1 − smoothstep(0.2, 0.5, r) × the
// clot's alpha), v1's colour 0xe9ede9 lit by the frame's sky and sun (v1 scales its unlit colour by the daylight; v2's light
// is the same record the spray reads). Blended after the sky like the spray (no depth written). One pipeline at load; the
// clots go up only while any are in the air, and nothing is drawn when none are.
//   const ex = createExhaustFx({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa, depthFormat });
//   each frame: ex.upload(sim) (the seamanship's exhaust); the scene pass, after the spray: ex.draw(pass, c)
import { ATMO_WGSL, SKY_READ } from './sky.js';

const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const EXHAUST_LOOK = Object.freeze({ colour: 0xe9ede9, disc: [0.2, 0.5] });

export const EXHAUST_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
@group(2) @binding(0) var<storage, read> D: array<vec4f>;   // per clot: (pos, size m), (alpha, 0, 0, 0)
@group(2) @binding(1) var<uniform> EU: vec4f;               // the colour (linear)
struct EV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) alpha: f32 }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EV {
  var o: EV;
  let a = D[2u * ii]; let b = D[2u * ii + 1u];
  if (a.w <= 0.0 || b.x <= 0.0) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); return o; }   // not in the air: clipped
  let toP = a.xyz - F.cam.xyz; let vd = toP / max(length(toP), 0.05);
  let ax = normalize(cross(vd, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0)); let ay = normalize(cross(ax, vd));
  var cs = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let k = cs[vi];
  o.pos = F.viewProj * vec4f(a.xyz + (ax * k.x + ay * k.y) * (0.5 * a.w), 1.0);
  o.uv = k; o.alpha = b.x;
  return o;
}
@fragment fn fs(v: EV) -> @location(0) vec4f {
  let r = 0.5 * length(v.uv);
  let al = (1.0 - smoothstep(${EXHAUST_LOOK.disc[0]}, ${EXHAUST_LOOK.disc[1]}, r)) * v.alpha;
  let col = EU.rgb * (LIGHT.sky.rgb + LIGHT.sun.rgb) / PI;
  return vec4f(col * al, al);
}`;

export function createExhaustFx({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa = 1, depthFormat = 'depth32float', count = 220 }) {
  const data = new Float32Array(count * 8);
  const dbuf = device.createBuffer({ label: 'exhaust-clots', size: data.byteLength, usage: BUF.STORAGE | BUF.COPY_DST });
  const c = EXHAUST_LOOK.colour, col = new Float32Array([(c >> 16) & 255, (c >> 8) & 255, c & 255].map((v) => srgbToLinear(v / 255)).concat([1]));
  const ubuf = device.createBuffer({ label: 'exhaust-look', size: 16, usage: BUF.UNIFORM | BUF.COPY_DST });
  device.queue.writeBuffer(ubuf, 0, col);
  const VF = STAGE.VERTEX | STAGE.FRAGMENT;
  const bgl = device.createBindGroupLayout({ label: 'exhaust', entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: VF, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: dbuf } }, { binding: 1, resource: { buffer: ubuf } }] });
  const m = reg.shader('exhaust', EXHAUST_WGSL(frameStruct));
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('exhaust', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  const stats = { alive: 0, uploads: 0 };
  return {
    stats,
    // the clots this frame (src/boat/exhaustSim.js's arrays), uploaded only while any are in the air (and once more as the last goes)
    upload(sim) {
      if (!sim) { stats.alive = 0; return; }
      let alive = 0;
      const n = Math.min(count, sim.count);
      for (let i = 0; i < n; i++) {
        const o = i * 8, al = sim.alpha[i];
        data[o] = sim.pos[3 * i]; data[o + 1] = sim.pos[3 * i + 1]; data[o + 2] = sim.pos[3 * i + 2]; data[o + 3] = sim.size[i];
        data[o + 4] = al; if (al > 0) alive++;
      }
      if (alive || stats.alive) { device.queue.writeBuffer(dbuf, 0, data); stats.uploads++; }
      stats.alive = alive;
    },
    draw(pass, c) {
      if (!stats.alive) return;
      pass.setPipeline(reg.get('exhaust'));
      pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.draw(6, count); c.calls++; c.triangles += 2 * stats.alive;
    },
  };
}
