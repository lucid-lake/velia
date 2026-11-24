// The water off the paddlers' blades in v2 (fix/v2-kayak-paddlers, K4): v1's splash (src/props/paddler/
// splash.js) on v2's GPU. A burst of droplets where the blade goes in (more and faster with the blade's speed) and a string
// of drips off its tip for 0.7 s after it comes out, ballistic in the world, gone when they fall back through the water.
// Nothing is drawn on the water's surface (the owner, 2026-11-07: no ring at the catch). Deterministic: one seeded
// generator, the fleet's events in its own order.
//   const S = createKayakSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, seed })
//                         (one pipeline, 'kayak-splash', declared with the kayaks' two before the first frame)
//   S.step(dt, fleet)     the fleet's events this step (fleet.splash: { type, key, at, water, s }) and its blades' tips
//                         (fleet.tips: key → [x, y, z]); then the droplets fly
//   S.fill(focalPx)       the droplets up (one writeBuffer);  S.draw(pass, c);  S.stats
// The droplet: a camera-facing disc, opaque (discarded outside its circle, depth written: it is drawn before the water),
// lit as v1's (a pale grey-blue, glossy) through the kayaks' own shading; at least 0.9 px across its radius so a burst
// reads at the pair's distance (v1's 6–14 mm drops are under a pixel at 12 m).
import { mulberry32 } from '../../src/sim/core/rng.js';
import { FAR_WGSL } from '../render/kayaks.js';

export const SPLASH = Object.freeze({ max: 320, g: 9.81, minPx: 0.9, colour: [0.82, 0.86, 0.88] });

// v1's droplets (splash.js), as plain numbers: p (world), v, size (m), life (s), water (the surface they fall back through)
export function createSplashSim({ seed = 1, max = SPLASH.max } = {}) {
  const r = mulberry32((Math.imul(seed | 0, 97) + 31) >>> 0);
  const P = [], drips = [];
  function spawn(x, y, z, vx, vy, vz, size, life, water) { if (P.length >= max) P.shift(); P.push({ x, y, z, vx, vy, vz, size, life, water }); }
  return {
    P, spawn,
    // v1's catch: 4 + 10 · min(1.5, s) droplets up off the water at the blade's point
    catch(at, water, s = 1) {
      const n = Math.round(4 + 10 * Math.min(1.5, s));
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, up = 0.8 + 1.4 * r() * s, ra = r(), rb = r();
        spawn(at[0], water + 0.01, at[2], Math.cos(a) * 0.35 * ra, up, Math.sin(a) * 0.35 * rb - 0.15, 0.006 + 0.008 * r(), 1.2, water);
      }
    },
    // v1's exit: drips off the tip for 0.7 s, one every 0.07 s / s (the tip followed as the blade rises)
    exit(key, water, s = 1) { drips.push({ key, left: 0.7, every: 0.07 / Math.max(0.5, s), acc: 0, water }); },
    update(dt, tipOf) {
      for (const d of drips) {
        d.left -= dt; d.acc += dt;
        const at = tipOf(d.key);
        while (d.acc >= d.every) { d.acc -= d.every; if (at) spawn(at[0], at[1], at[2], (r() - 0.5) * 0.1, -0.2 * r(), (r() - 0.5) * 0.1, 0.004 + 0.004 * r(), 1.5, d.water); else r(); }
      }
      for (let i = drips.length - 1; i >= 0; i--) if (drips[i].left <= 0) drips.splice(i, 1);
      for (const d of P) { d.vy -= SPLASH.g * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.life -= dt; }
      for (let i = P.length - 1; i >= 0; i--) if (P[i].life <= 0 || (P[i].y < P[i].water && P[i].vy < 0)) P.splice(i, 1);
    },
    get count() { return P.length; }, get drips() { return drips.length; },
  };
}

// the droplets' WGSL: the kayak-far module's shading (FAR_WGSL: the frame, the sky, the shadow, shade(), finish()) and
// two entry points of its own. FAR[0] = (focalPx, minPx, 0, 0); FAR[1 + i] = (x, y, z, radius)
const DROP_WGSL = (fs, colour = SPLASH.colour, rough = 0.15, white = 0) => `${FAR_WGSL(fs)}
struct DV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) uv: vec2f, @location(2) right: vec3f, @location(3) up: vec3f }
@vertex fn vsDrop(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DV {
  let h = FAR[0u]; let d = FAR[1u + ii];
  let k = vi % 6u;
  let uv = vec2f(select(-1.0, 1.0, k == 1u || k == 2u || k == 4u), select(-1.0, 1.0, k == 2u || k == 4u || k == 5u));
  let toCam = F.cam.xyz - d.xyz; let dist = max(length(toCam), 0.05);
  let fwd = toCam / dist;
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), fwd)); let up = cross(fwd, right);
  let rad = max(d.w, h.y * dist / max(h.x, 1.0));
  let wp = d.xyz + (right * uv.x + up * uv.y) * rad;
  var o: DV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.uv = uv; o.right = right; o.up = up; return o;
}
@fragment fn fsDrop(v: DV) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  if (r2 > 1.0) { discard; }
  let toCam = normalize(F.cam.xyz - v.world);
  let n = normalize(v.right * v.uv.x + v.up * v.uv.y + toCam * sqrt(1.0 - r2));
  var c = shade(v.world, n, vec3f(${colour.join(', ')}), ${rough.toFixed(2)}, 0.0, 0.0);
  // white (the osprey's): a churned spray scatters every colour, and the whole sky dome's light (its upward irradiance), so in
  // a shaded evening bay it still reads pale against the dark water
  let dome = vec3f(${colour.join(', ')}) * ambientAt(vec3f(0.0, 1.0, 0.0)) / PI * 1.6;
  c = mix(c, max(vec3f(dot(c, vec3f(0.2126, 0.7152, 0.0722))) * 1.15, vec3f(dot(dome, vec3f(0.2126, 0.7152, 0.0722)))), ${white.toFixed(2)});
  return finish(c, v.pos.xy, v.world);
}`;

// label, max, minPx, colour, rough, white: another user's own pipeline and pool (the osprey's strike: living/birds-splash.js)
export function createKayakSplash({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', seed = 1, label = 'kayak-splash', max = SPLASH.max, minPx = SPLASH.minPx, colour = SPLASH.colour, rough = 0.15, white = 0, sim: simIn = null }) {
  const sim = simIn ?? createSplashSim({ seed, max });
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const buf = device.createBuffer({ label, size: (max + 1) * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const data = new Float32Array((max + 1) * 4);
  const bgl = device.createBindGroupLayout({ label, entries: [{ binding: 0, visibility: VX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: buf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
  const m = reg.shader(label, DROP_WGSL(frameStruct, colour, rough, white));
  reg.add(label, { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: m, entryPoint: 'vsDrop' }, fragment: { module: m, entryPoint: 'fsDrop', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  let n = 0;
  const stats = { drops: 0, drips: 0, catches: 0, exits: 0 };
  return {
    sim, stats,
    step(dt, fleet) {
      const tips = fleet?.tips;
      for (const e of fleet?.splash?.splice(0) ?? []) {
        if (e.type === 'catch') { sim.catch(e.at, e.water, e.s); stats.catches++; } else { sim.exit(e.key, e.water, e.s); stats.exits++; }
      }
      sim.update(dt, (key) => tips?.get(key) ?? null);
      stats.drops = sim.count; stats.drips = sim.drips;
    },
    fill(focalPx = 1000) {
      n = Math.min(max, sim.P.length);
      data[0] = focalPx; data[1] = minPx; data[2] = 0; data[3] = 0;
      for (let i = 0; i < n; i++) { const d = sim.P[i], o = (1 + i) * 4; data[o] = d.x; data[o + 1] = d.y; data[o + 2] = d.z; data[o + 3] = d.size; }
      if (n) device.queue.writeBuffer(buf, 0, data, 0, (1 + n) * 4);
    },
    draw(pass, c) {
      if (!n) return;
      pass.setPipeline(reg.get(label)); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.draw(6, n);
      c.calls += 1; c.triangles += 2 * n;
    },
  };
}
