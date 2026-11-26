// South Lake's small power craft drawn (v2/living/powerTraffic.js, v2/render/smallCraftMesh.js): one pipeline, 'craft-solid' (lit, opaque,
// in the boat effects' group; the paddle-wheeler's shade: render/paddleWheeler.js), one instanced draw per kind and LOD in use (at most
// four a frame: the runabouts near and far, the jet ski near and far). An instance: her pose on the drawn water (the mean under her
// ends and sides, the sim's bow-up trim over the hump and her bank into turns, a planing hull lifted a little), her hull colour and
// stripe, the rider's duck (Tessie's splash). Nothing under her waterline is drawn (the water covers it).
//   const SC = createSmallCraftRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier })
//   SC.update(boats, { eye, heightAt })   once a frame (boats: the sim's live boats; [] draws nothing)
//   SC.draw(pass, c)                      before the water (the boats' order)
import { COMMON } from './kayaks.js';
import { buildCraftMeshes, VF, SLOT, DRAW_M, lodFor, HULLS, KINDS, JET } from './smallCraftMesh.js';
import { poseRows } from '../sim/kayak-clip.js';

const REC = 6;      // vec4 per instance: three rows of her pose, (hull rgb, duck), (stripe rgb, kind 0 runabout / 1 jet ski), (the rider's lean, its pivot y, z, 0)
const MAX = 8;      // instances (the region's traffic is 3)
const f = (x) => x.toFixed(3);
const lin = (hex) => { const v = parseInt(String(hex).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c0) => { const c = c0 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); };

const CRAFT_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> CI: array<vec4f>;
struct CV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) @interpolate(flat) slot: u32, @location(4) @interpolate(flat) ii: u32 }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) slot: f32, @builtin(instance_index) ii: u32) -> CV {
  let r0 = CI[ii * ${REC}u]; let r1 = CI[ii * ${REC}u + 1u]; let r2 = CI[ii * ${REC}u + 2u]; let p0 = CI[ii * ${REC}u + 3u];
  var q = p; var m = n;
  if (slot > ${SLOT.rider - 0.5}) {
    let p2 = CI[ii * ${REC}u + 5u];   // the rider leans into the curve about the seat (the hull's roll is in her pose), and ducks (a splash)
    let c = cos(-p2.x); let s = sin(-p2.x); let d = q.xy - vec2f(0.0, p2.y);
    q = vec3f(d.x * c - d.y * s, p2.y + d.x * s + d.y * c, q.z); m = vec3f(m.x * c - m.y * s, m.x * s + m.y * c, m.z);
    q = q + vec3f(0.0, -0.22, -0.08) * p0.w * smoothstep(0.0, 0.9, q.y - p2.y + 0.6);
  }
  let p4 = vec4f(q, 1.0); let n4 = vec4f(m, 0.0);
  let wp = vec3f(dot(r0, p4), dot(r1, p4), dot(r2, p4)); let wn = vec3f(dot(r0, n4), dot(r1, n4), dot(r2, n4));
  var o: CV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.lp = q; o.slot = u32(slot + 0.5); o.ii = ii; return o;
}
fn ch3(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn shadeC(world: vec3f, n: vec3f, alb: vec3f, rough: f32, metal: f32, spK: f32) -> vec3f {
  let V = normalize(F.cam.xyz - world); let s = normalize(F.sun.xyz); let nl = max(dot(n, s), 0.0);
  let eSun = sunPerp(); let eSky0 = ambientAt(n); let eSky = mix(eSky0, vec3f(dot(eSky0, vec3f(0.2126, 0.7152, 0.0722))), KAYAK_SKY_DESAT * boatDay());
  let f0 = mix(vec3f(0.04), alb, metal);
  let diff = alb * (1.0 - metal) / PI * (eSun * nl + eSky);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  return diff + (skyMirror(R) * fres * (1.0 - 0.8 * rough) + ggxSpec(n, V, s, rough, f0) * eSun) * spK;
}
fn litC(v: CV) -> vec3f {
  let p0 = CI[v.ii * ${REC}u + 3u]; let p1 = CI[v.ii * ${REC}u + 4u];
  let lp = v.lp; let aaY = max(fwidth(lp.y), 1e-4);
  if (lp.y < -0.04) { discard; }
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(v.n); if (dot(n, V) < 0.0) { n = -n; }
  var alb = vec3f(0.78); var rough = 0.4; var metal = 0.0; var spK = 1.0;
  let jet = p1.w > 0.5;
  switch (v.slot) {
    case ${SLOT.hull}u: {   // gelcoat in the row's colour, one stripe along the topsides, a dark boot line at the water; the jet ski two-tone:
      // the second colour below her sponson ledge (its line follows the hull's sheer), a thin pale pinstripe on the ledge
      let s0 = ${f(HULLS.power.stripe[0])}; let s1 = ${f(HULLS.power.stripe[1])};
      var band = smoothstep(s0 - aaY, s0 + aaY, lp.y) * (1.0 - smoothstep(s1 - aaY, s1 + aaY, lp.y));
      if (jet) {
        let u = clamp((lp.z + ${f(JET.L / 2)}) / ${f(JET.L)}, 0.0, 1.0); let w = select(1.0, pow(sin(u / 0.45 * 1.5708), 0.62), u < 0.45);
        let yk = -0.18 + select(0.03 * (u - 0.42), 0.55 * (1.0 - u / 0.42) * (1.0 - u / 0.42), u < 0.42);
        let ysp = yk + (0.15 + ${f(JET.sponsonY)}) * w + 0.13;   // the colour line a hand above the ledge: dark topsides, the deck and hood bright
        band = 1.0 - smoothstep(ysp - aaY, ysp + aaY, lp.y);
        let pin = 1.0 - smoothstep(0.012 - aaY, 0.012 + aaY, abs(lp.y - ysp - 0.03));
        alb = mix(mix(p0.rgb, p1.rgb, band), vec3f(0.85), pin * 0.8);
      } else { alb = mix(p0.rgb, p1.rgb, band); }
      rough = 0.22; spK = 1.0;
      alb = mix(alb, vec3f(0.06, 0.06, 0.07), (1.0 - smoothstep(0.04 - aaY, 0.04 + aaY, lp.y)) * 0.7);
    }
    case ${SLOT.deck}u: { alb = select(vec3f(0.74, 0.73, 0.7), vec3f(0.42, 0.43, 0.44), jet); rough = 0.75; spK = 0.5; }   // non-skid deck (the jet ski's rear deck grey)
    case ${SLOT.hood}u: { alb = p0.rgb; rough = 0.18; spK = 1.1; }   // the hood and the pedestal: glossy, the row's colour
    case ${SLOT.mat}u: { alb = vec3f(0.035, 0.037, 0.04) * (0.85 + 0.3 * ch3(floor(lp * 40.0))); rough = 0.9; spK = 0.2; }   // the footwells' mat
    case ${SLOT.helmet}u: { alb = vec3f(0.86, 0.86, 0.84); rough = 0.2; spK = 1.0; }
    case ${SLOT.glove}u: { alb = vec3f(0.05, 0.05, 0.06); rough = 0.7; spK = 0.3; }
    case ${SLOT.glass}u: { alb = vec3f(0.02, 0.025, 0.03); rough = 0.05; spK = 1.2; }
    case ${SLOT.seat}u: { alb = vec3f(0.82, 0.78, 0.68); rough = 0.55; spK = 0.6; }   // cream vinyl
    case ${SLOT.seatDark}u: { alb = vec3f(0.03, 0.03, 0.035); rough = 0.5; spK = 0.6; }
    case ${SLOT.dark}u: { alb = vec3f(0.035, 0.036, 0.04); rough = 0.35; spK = 0.9; }
    case ${SLOT.metal}u: { alb = vec3f(0.75, 0.76, 0.78); rough = 0.2; metal = 0.9; }
    case ${SLOT.rider}u: { alb = vec3f(0.08, 0.13, 0.24) * (0.9 + 0.2 * ch3(floor(lp * 30.0))); rough = 0.85; spK = 0.3; }   // a navy shirt
    case ${SLOT.skin}u: { alb = vec3f(0.55, 0.38, 0.28); rough = 0.6; spK = 0.4; }
    case ${SLOT.vest}u: { alb = vec3f(0.9, 0.28, 0.05); rough = 0.7; spK = 0.4; }   // a buoyancy aid's orange
    case ${SLOT.hair}u: { alb = vec3f(0.07, 0.05, 0.04); rough = 0.8; spK = 0.3; }
    case ${SLOT.trunks}u: { alb = vec3f(0.12, 0.12, 0.13); rough = 0.85; spK = 0.3; }
    default: {}
  }
  return shadeC(v.world, n, alb, rough, metal, spK);
}
@fragment fn fs(v: CV) -> @location(0) vec4f { return finish(litC(v), v.pos.xy, v.world); }`;

export function createSmallCraftRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', tier = 'full' }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const mesh = buildCraftMeshes();
  const vb = device.createBuffer({ label: 'craft-mesh', size: mesh.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, mesh.data);
  const inst = new Float32Array(REC * 4 * MAX);
  const ibuf = device.createBuffer({ label: 'craft-instance', size: inst.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'craft', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ibuf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
  const mod = reg.shader('craft', CRAFT_WGSL(frameStruct));
  const vbuf = { arrayStride: VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] };
  reg.add('craft-solid', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mod, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const drawM = tier === 'full' ? DRAW_M.full : DRAW_M.lite;
  const stats = { shown: 0, calls: 0, triangles: 0, groups: {}, tier };
  const lods = new Map(), colours = new Map(), rows = new Float32Array(12);
  const groups = [];   // [{ run, first, count }] this frame
  function update(boats, { eye, heightAt } = {}) {
    groups.length = 0; stats.groups = {};
    if (!boats?.length) { stats.shown = 0; return; }
    const buckets = new Map();
    for (const b of boats) {
      const d = Math.hypot(b.x - eye[0], b.z - eye[2]);
      if (d > drawM[b.kind]) { lods.delete(b.id); continue; }
      const lod = lodFor(b.kind, d, lods.get(b.id) ?? null); lods.set(b.id, lod);
      const key = `${b.kind}-${lod}`; if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(b);
    }
    let n = 0;
    for (const k of KINDS) for (const lod of ['near', 'far']) {
      const key = `${k}-${lod}`, list = buckets.get(key); if (!list) continue;
      const first = n;
      for (const b of list) {
        if (n >= MAX) break;
        const H = HULLS[b.kind], fx = Math.sin(b.heading), fz = -Math.cos(b.heading), L2 = H.L * 0.4, B2 = H.B * 0.4;
        const yb = heightAt(b.x + fx * L2, b.z + fz * L2), ys = heightAt(b.x - fx * L2, b.z - fz * L2), yS = heightAt(b.x - fz * B2, b.z + fx * B2), yP = heightAt(b.x + fz * B2, b.z - fx * B2);
        // a light hull follows the water more than the paddle-wheeler; planing she skims (a share of the slope, lifted out a little)
        const ride = 1 - 0.5 * (b.plane ?? 0);
        poseRows({ x: b.x, y: (yb + ys + yS + yP) / 4 + 0.1 * (b.plane ?? 0), z: b.z, yaw: -b.heading, pitch: Math.atan2(yb - ys, 2 * L2) * 0.8 * ride + (b.trim ?? 0), roll: Math.atan2(yS - yP, 2 * B2) * 0.7 * ride - (b.heel ?? 0) }, rows);
        const o = n * REC * 4; inst.set(rows, o);
        let c = colours.get(b.id); if (!c) colours.set(b.id, c = { hull: lin(b.row?.hull ?? '#f3f1ea'), stripe: lin(b.row?.stripe ?? '#1d3557') });
        inst[o + 12] = c.hull[0]; inst[o + 13] = c.hull[1]; inst[o + 14] = c.hull[2]; inst[o + 15] = b.duck ?? 0;
        inst[o + 16] = c.stripe[0]; inst[o + 17] = c.stripe[1]; inst[o + 18] = c.stripe[2]; inst[o + 19] = b.kind === 'jetski' ? 1 : 0;
        inst[o + 20] = b.kind === 'jetski' ? (b.lean ?? 0) : 0; inst[o + 21] = b.kind === 'jetski' ? JET.seatTop : 1; inst[o + 22] = JET.seatZ; inst[o + 23] = 0;
        n++;
      }
      if (n > first) { groups.push({ run: mesh.runs[key], first, count: n - first }); stats.groups[key] = n - first; }
    }
    if (n) device.queue.writeBuffer(ibuf, 0, inst, 0, n * REC * 4);
    stats.shown = n;
  }
  function draw(pass, c) {
    stats.calls = 0; stats.triangles = 0;
    if (!groups.length) return;
    pass.setPipeline(reg.get('craft-solid')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    for (const g of groups) { pass.draw(g.run.count, g.count, g.run.first, g.first); c.calls++; c.triangles += g.run.count / 3 * g.count; stats.calls++; stats.triangles += g.run.count / 3 * g.count; }
  }
  return { update, draw, stats, mesh };
}
