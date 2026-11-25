// The paddle-wheeler's drawing (v2/sim/paddleWheeler.js, v2/render/paddleWheelerMesh.js): one pipeline, 'paddle-solid' (lit, opaque,
// declared in the boat effects' group; the kayaks' lighting: render/kayaks.js COMMON), one draw a frame: the LOD for her distance
// (near, mid, far; a lite tier never takes near), one instance record. Her wheel turns in the vertex shader (the slots >= SLOT.wheel
// about the axle by her wheel angle); nothing under her own waterline is drawn (the water covers it, as for every boat). The window
// bands are cut into panes by the shader: by day dark glass with the sky in it, at night most panes lit warm from inside (a seeded
// pattern: some cabins dark); the mid LOD's railings are bands the shader cuts into posts and two rails.
//   const PR = createPaddleRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier })
//   PR.update(S, { eye, heightAt, sunElevDeg })   once a frame (S: the sim; null: nothing drawn)
//   PR.draw(pass, c)                              before the water (the boats' order)
import { COMMON } from './kayaks.js';
import { buildPaddleMeshes, VF, SLOT, DRAW_M, lodFor, WINDOW_BANDS, RAIL_DECKS, SHAPE } from './paddleWheelerMesh.js';
import { poseRows } from '../sim/kayak-clip.js';
import { PADDLE } from '../sim/paddleWheeler.js';
import { navLevel } from '../sim/night.js';

const REC = 4;   // vec4 per instance record: three rows of her pose, (night, wheel angle, LOD, 0)
export const WINDOW_LIGHT = Object.freeze({ radiance: 0.14, litShare: 0.78, colour: Object.freeze([1.0, 0.72, 0.42]) });   // the lit panes at full night
const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const NAVY = lin(0x1c2340), CREAM = lin(0xefe6d2), BOOT = lin(0x7a1712), WHEEL = lin(0x9a1d16);
const v3 = (a, k = 1) => `vec3f(${a.map((x) => (x * k).toFixed(4)).join(', ')})`;
const f = (x) => x.toFixed(3);

const PADDLE_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> PI_: array<vec4f>;
const AY = ${f(PADDLE.wheel.y)}; const AZ = ${f(PADDLE.wheel.z)};
struct PV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) ln: vec3f, @location(4) @interpolate(flat) slot: u32 }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) slot: f32, @builtin(instance_index) ii: u32) -> PV {
  let r0 = PI_[ii * ${REC}u]; let r1 = PI_[ii * ${REC}u + 1u]; let r2 = PI_[ii * ${REC}u + 2u]; let p0 = PI_[ii * ${REC}u + 3u];
  var q = p; var m = n;
  if (slot > ${SLOT.wheel - 0.5}) {   // the wheel: turned about its axle (x through AY, AZ); its buckets sweep aft under the water
    let a = -p0.y; let c = cos(a); let s = sin(a);
    let d = q.yz - vec2f(AY, AZ);
    q = vec3f(q.x, AY + d.x * c - d.y * s, AZ + d.x * s + d.y * c);
    m = vec3f(m.x, m.y * c - m.z * s, m.y * s + m.z * c);
  }
  let p4 = vec4f(q, 1.0); let n4 = vec4f(m, 0.0);
  let wp = vec3f(dot(r0, p4), dot(r1, p4), dot(r2, p4)); let wn = vec3f(dot(r0, n4), dot(r1, n4), dot(r2, n4));
  var o: PV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.lp = q; o.ln = m; o.slot = u32(slot + 0.5); return o;
}
fn th3(p: vec3f) -> f32 { var q = fract(p * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn vn3(p: vec3f) -> f32 {
  let i = floor(p); let fr = fract(p); let u = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(mix(th3(i), th3(i + vec3f(1, 0, 0)), u.x), mix(th3(i + vec3f(0, 1, 0)), th3(i + vec3f(1, 1, 0)), u.x), u.y),
             mix(mix(th3(i + vec3f(0, 0, 1)), th3(i + vec3f(1, 0, 1)), u.x), mix(th3(i + vec3f(0, 1, 1)), th3(i + vec3f(1, 1, 1)), u.x), u.y), u.z);
}
// the glass boat's shade (render/tourBoat.js shadeK): the boat's light term for term, a broken specular
fn shadeP(world: vec3f, n: vec3f, alb: vec3f, rough: f32, metal: f32, spK: f32) -> vec3f {
  let V = normalize(F.cam.xyz - world); let s = normalize(F.sun.xyz); let nl = max(dot(n, s), 0.0);
  let eSun = sunPerp(); let eSky0 = ambientAt(n); let eSky = mix(eSky0, vec3f(dot(eSky0, vec3f(0.2126, 0.7152, 0.0722))), KAYAK_SKY_DESAT * boatDay());
  let f0 = mix(vec3f(0.04), alb, metal);
  let diff = alb * (1.0 - metal) / PI * (eSun * nl + eSky);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  return diff + (skyMirror(R) * fres * (1.0 - 0.8 * rough) + ggxSpec(n, V, s, rough, f0) * eSun) * spK;
}
// the coordinate along a wall (its side: along her; its end: across her)
fn along(lp: vec3f, ln: vec3f) -> f32 { return select(lp.x, lp.z, abs(ln.x) > abs(ln.z)); }
fn lit(v: PV) -> vec3f {
  let p0 = PI_[3u];
  let night = p0.x; let lp = v.lp;
  // the derivatives first (uniform flow): a pixel along a wall and up it
  let u = along(lp, v.ln);
  let aaU = max(fwidth(u), 1e-4); let aaY = max(fwidth(lp.y), 1e-4);
  if (lp.y < -0.03) { discard; }
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(v.n); if (dot(n, V) < 0.0) { n = -n; }
  var alb = vec3f(0.78); var rough = 0.4; var metal = 0.0; var emit = vec3f(0.0); var spK = 1.0;
  let lo = vn3(lp * 1.3); let hi = vn3(lp * 19.0);
  switch (v.slot) {
    case ${SLOT.hull}u: {   // white topsides: orange peel, rust-tea streaks under the scuppers, the dark-red boot top, the scum line
      let streak = smoothstep(0.7, 0.92, vn3(vec3f(lp.z * 3.0, lp.y * 0.5, lp.x * 3.0))) * smoothstep(0.3, 1.2, lp.y) * 0.5;
      alb = vec3f(0.79, 0.785, 0.76) * (0.95 + 0.05 * hi) * (1.0 - 0.08 * streak) + vec3f(0.03, 0.02, 0.01) * streak;
      rough = 0.32 + 0.1 * lo; spK = 0.8;
      let boot = 1.0 - smoothstep(0.34 - aaY, 0.34 + aaY, lp.y);
      alb = mix(alb, ${v3(BOOT, 0.9)} * (0.9 + 0.1 * lo), boot);
      alb = mix(alb, vec3f(0.12, 0.11, 0.08), (1.0 - smoothstep(0.0, 0.07, lp.y)) * 0.6);
    }
    case ${SLOT.deck}u: { alb = vec3f(0.36, 0.37, 0.35) * (0.9 + 0.1 * lo); rough = 0.8; spK = 0.4; }   // grey deck paint
    case ${SLOT.cabin}u: {   // the cabins' white panels: faint seams every 1.5 m
      let seam = 1.0 - smoothstep(0.0, aaU * 1.2 + 0.006, abs(fract(u / 1.5 + 0.5) - 0.5) * 1.5);
      alb = vec3f(0.8, 0.795, 0.77) * (0.95 + 0.05 * hi) * (1.0 - 0.12 * seam); rough = 0.35 + 0.1 * lo; spK = 0.85;
    }
    case ${SLOT.window}u: {   // the window bands: panes 1.5 m wide between white mullions; dark glass by day, lit warm at night
      let pw = 1.5; let fr = fract(u / pw); let d = min(fr, 1.0 - fr) * pw;
      let mull = 1.0 - smoothstep(0.06 - aaU, 0.06 + aaU, d);
      // the band's own top and bottom frame (each band's heights: render/paddleWheelerMesh.js WINDOW_BANDS)
      var fy = 9.0;
      ${WINDOW_BANDS.map(([a, b]) => `if (lp.y > ${f(a - 0.05)} && lp.y < ${f(b + 0.05)}) { fy = min(lp.y - ${f(a)}, ${f(b)} - lp.y); }`).join('\n      ')}
      let frame = max(mull, 1.0 - smoothstep(0.07 - aaY, 0.07 + aaY, fy));
      let pane = floor(u / pw); let level = floor(lp.y / 2.6);
      let h = th3(vec3f(pane, level, 7.0)); let h2 = th3(vec3f(pane * 1.7, level, 3.0));
      let on = step(1.0 - ${WINDOW_LIGHT.litShare.toFixed(2)}, h) * step(0.18, th3(vec3f(floor(pane / 4.0), level, 11.0)));   // whole cabins dark now and then
      alb = mix(vec3f(0.012, 0.014, 0.017), vec3f(0.8, 0.795, 0.77), frame); rough = mix(0.04, 0.35, frame); spK = 1.0;
      emit = ${v3(WINDOW_LIGHT.colour)} * ${WINDOW_LIGHT.radiance.toFixed(2)} * night * on * (0.6 + 0.8 * h2) * (1.0 - frame);
    }
    case ${SLOT.rail}u: { alb = vec3f(0.8, 0.8, 0.78) * (0.95 + 0.05 * hi); rough = 0.38; }
    case ${SLOT.railBand}u: {   // the mid LOD's railing: posts every 1.6 m, a top rail and a mid rail, cut out of a band
      var hh = -1.0;
      ${RAIL_DECKS.map((d) => `if (lp.y > ${f(d - 0.02)} && lp.y < ${f(d + SHAPE.railH + 0.04)}) { hh = lp.y - ${f(d)}; }`).join('\n      ')}
      let fr = fract(u / 1.6); let dp = min(fr, 1.0 - fr) * 1.6;
      let wy = max(aaY * 0.75, 0.035); let wp = max(aaU * 0.75, 0.025);
      let keep = hh > ${f(SHAPE.railH)} - wy * 2.0 || abs(hh - ${f(SHAPE.railH / 2)}) < wy || dp < wp;
      if (!keep) { discard; }
      alb = vec3f(0.8, 0.8, 0.78); rough = 0.4;
    }
    case ${SLOT.dark}u: { alb = vec3f(0.03, 0.031, 0.034) * (0.9 + 0.2 * lo); rough = 0.5; }
    case ${SLOT.stack}u: {   // the stacks: white, a dark-red band under the black crown, soot on the top
      alb = vec3f(0.8, 0.79, 0.76) * (0.95 + 0.05 * hi); rough = 0.35;
      let band = smoothstep(${f(SHAPE.stacks.y1 - 0.75)} - aaY, ${f(SHAPE.stacks.y1 - 0.75)} + aaY, lp.y) * (1.0 - smoothstep(${f(SHAPE.stacks.y1 - 0.35)} - aaY, ${f(SHAPE.stacks.y1 - 0.35)} + aaY, lp.y));
      alb = mix(alb, ${v3(BOOT)}, band);
      alb = mix(alb, vec3f(0.1, 0.095, 0.09), smoothstep(${f(SHAPE.stacks.y1 - 0.3)}, ${f(SHAPE.stacks.y1)}, lp.y) * 0.8);
    }
    case ${SLOT.under}u: { alb = vec3f(0.66, 0.66, 0.64) * (0.95 + 0.05 * lo); rough = 0.6; }   // the decks' undersides, the roofs
    case ${SLOT.flag}u: {   // a plain flag: navy, a cream stripe across its middle (no ensign, no marks)
      let fv = (lp.y - ${f(SHAPE.flag.y1 - 0.08 - SHAPE.flag.h)}) / ${f(SHAPE.flag.h)};
      let stripe = 1.0 - smoothstep(0.11 - aaY, 0.11 + aaY, abs(fv - 0.5));
      alb = mix(${v3(NAVY)}, ${v3(CREAM, 0.85)}, stripe); rough = 0.85; spK = 0.3;
    }
    case ${SLOT.lensW}u: { alb = vec3f(0.55); rough = 0.1; emit = vec3f(1.0, 0.95, 0.85) * 6.0 * night; }
    case ${SLOT.lensR}u: { alb = vec3f(0.3, 0.035, 0.03); rough = 0.1; emit = vec3f(1.0, 0.22, 0.16) * 6.0 * night; }
    case ${SLOT.lensG}u: { alb = vec3f(0.035, 0.26, 0.09); rough = 0.1; emit = vec3f(0.2, 1.0, 0.45) * 6.0 * night; }
    case ${SLOT.guard}u: {   // the decks' fascias and the wheel's beams: white, a navy rub strake low on the guards
      alb = vec3f(0.8, 0.795, 0.77) * (0.95 + 0.05 * hi); rough = 0.36;
      let rub = step(${f(SHAPE.guard.y0 - 0.01)}, lp.y) * (1.0 - smoothstep(${f(SHAPE.guard.y0 + 0.13)} - aaY, ${f(SHAPE.guard.y0 + 0.13)} + aaY, lp.y));
      alb = mix(alb, ${v3(NAVY)} * 1.2, rub);
    }
    case ${SLOT.wheel}u: {   // the wheel: dark-red paint, worn, wet low down (just out of the water)
      alb = ${v3(WHEEL, 0.9)} * (0.85 + 0.2 * lo) * (0.92 + 0.08 * hi); rough = mix(0.14, 0.5, smoothstep(0.2, 1.6, lp.y)); spK = 0.9;
    }
    case ${SLOT.wheelDark}u: { alb = vec3f(0.05, 0.05, 0.055); rough = 0.3; metal = 0.6; }
    default: {}
  }
  return shadeP(v.world, n, alb, rough, metal, spK) + emit;
}
@fragment fn fs(v: PV) -> @location(0) vec4f { return finish(lit(v), v.pos.xy, v.world); }`;

export function createPaddleRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', tier = 'full' }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const mesh = buildPaddleMeshes();
  const vb = device.createBuffer({ label: 'paddle-mesh', size: mesh.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, mesh.data);
  const inst = new Float32Array(REC * 4);
  const ibuf = device.createBuffer({ label: 'paddle-instance', size: inst.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'paddle', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ibuf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
  const mod = reg.shader('paddle', PADDLE_WGSL(frameStruct));
  const vbuf = { arrayStride: VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] };
  reg.add('paddle-solid', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mod, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const lite = tier !== 'full', drawM = lite ? DRAW_M.lite : DRAW_M.full;
  const stats = { lod: null, distM: null, calls: 0, triangles: 0, tier };
  const rows = new Float32Array(12);
  let shown = false, lod = null;
  function update(S, { eye, heightAt, sunElevDeg = 90 } = {}) {
    shown = false;
    if (!S) { stats.lod = null; return; }
    const b = S.boat, d = Math.hypot(b.x - eye[0], b.z - eye[2]);
    stats.distM = Math.round(d);
    if (d > drawM) { stats.lod = null; lod = null; return; }
    lod = lodFor(d, lod, { lite });
    // her ride on the drawn water: the mean of four points (her ends and her guards), a 300 t hull's pitch and roll a share of the slope
    const fx = Math.sin(b.heading), fz = -Math.cos(b.heading), L2 = 17, B2 = 4.2;
    const yb = heightAt(b.x + fx * L2, b.z + fz * L2), ys = heightAt(b.x - fx * L2, b.z - fz * L2), yS = heightAt(b.x - fz * B2, b.z + fx * B2), yP = heightAt(b.x + fz * B2, b.z - fx * B2);
    poseRows({ x: b.x, y: (yb + ys + yS + yP) / 4, z: b.z, yaw: -b.heading, pitch: Math.atan2(yb - ys, 2 * L2) * 0.6, roll: Math.atan2(yS - yP, 2 * B2) * 0.45 }, rows);
    inst.set(rows, 0);
    inst[12] = navLevel(sunElevDeg); inst[13] = b.wheel; inst[14] = lod === 'near' ? 0 : lod === 'mid' ? 1 : 2; inst[15] = 0;
    device.queue.writeBuffer(ibuf, 0, inst);
    shown = true; stats.lod = lod; stats.night = +inst[12].toFixed(2); stats.y = +((yb + ys + yS + yP) / 4).toFixed(3);
  }
  function draw(pass, c) {
    if (!shown) { stats.calls = 0; stats.triangles = 0; return; }
    const run = mesh.runs[lod];
    pass.setPipeline(reg.get('paddle-solid')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    pass.draw(run.count, 1, run.first, 0);
    c.calls++; c.triangles += run.count / 3; stats.calls = 1; stats.triangles = run.count / 3;
  }
  return { update, draw, stats, mesh, get pose() { return shown ? rows : null; } };
}
