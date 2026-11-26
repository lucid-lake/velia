// The paddleboarders' drawing (v2/sim/sup.js, v2/sim/supPose.js, v2/render/supMesh.js): one pipeline, 'sup-solid' (lit, opaque, declared with
// the kayaks' two: the kayaks' lighting, render/kayaks.js COMMON), five instanced draws a frame (the board, the torsos, the heads, the limb
// rods, the paddles), at most MAX boards. Each part's instance is one 3 × 4 world matrix (the CPU hangs the figure's joints on the board's
// pose on the drawn water), so a kneel or a stroke is only new matrices. Boards beyond DRAW_M are not drawn.
//   const R = createSupRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat })
//   R.update(boards, { eye, heightAt })   once a frame (boards: the fleet's, sim/sup.js; null: nothing drawn)
//   R.draw(pass, c)                       before the water (the boats' order);  R.stats
import { COMMON } from './kayaks.js';
import { buildSupMeshes, VF, PART } from './supMesh.js';
import { BOARD, BODY } from '../sim/supPose.js';
import { poseRows } from '../sim/kayak-clip.js';

export const SUP_RENDER = Object.freeze({ max: 6, drawM: 650 });
const MAX = SUP_RENDER.max, ROD_PER = 8;
// records (4 vec4 each: three rows of the world matrix, then (board, rod kind, water y, 0)) by part, in this order
const BASE = Object.freeze({ board: 0, torso: MAX, head: 2 * MAX, paddle: 3 * MAX, rod: 4 * MAX });
const RECORDS = 4 * MAX + ROD_PER * MAX;
const lin = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
export const COLOURS = Object.freeze({
  board: Object.freeze({ white: lin(0xe9e6dc), yellow: lin(0xe3b52a), red: lin(0xc2382b), blue: lin(0x2d6fa8), orange: lin(0xe2731f) }),
  pfd: Object.freeze({ orange: lin(0xe8661c), yellow: lin(0xf0c419), red: lin(0xcc2f2a), blue: lin(0x2b62b3), white: lin(0xe9e6dc) }),
  cap: Object.freeze({ navy: lin(0x1c2340), white: lin(0xeeeae0), red: lin(0xb42a26), yellow: lin(0xe3b52a) }),
});
const pick = (tab, k, d) => tab[k] ?? tab[d];

const SUP_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> SI: array<vec4f>;
@group(2) @binding(1) var<storage, read> SC: array<vec4f>;   // per board: board colour, PFD colour, cap colour (w: the skin's index)
struct SV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) @interpolate(flat) part: u32, @location(4) @interpolate(flat) bi: u32, @location(5) @interpolate(flat) kind: u32, @location(6) @interpolate(flat) wy: f32 }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) part: f32, @builtin(instance_index) ii: u32) -> SV {
  let r0 = SI[ii * 4u]; let r1 = SI[ii * 4u + 1u]; let r2 = SI[ii * 4u + 2u]; let md = SI[ii * 4u + 3u];
  let p4 = vec4f(p, 1.0); let n4 = vec4f(n, 0.0);
  let wp = vec3f(dot(r0, p4), dot(r1, p4), dot(r2, p4)); let wn = vec3f(dot(r0, n4), dot(r1, n4), dot(r2, n4));
  var o: SV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.lp = p; o.part = u32(part + 0.5); o.bi = u32(md.x + 0.5); o.kind = u32(md.y + 0.5); o.wy = md.z; return o;
}
fn skinOf(bi: u32) -> vec3f { let w = SC[bi * 3u + 2u].w; return mix(vec3f(0.62, 0.43, 0.33), vec3f(0.44, 0.29, 0.21), fract(w * 0.37)) * (0.9 + 0.2 * fract(w * 0.73)); }
@fragment fn fs(v: SV) -> @location(0) vec4f {
  let bc = SC[v.bi * 3u].xyz; let pc = SC[v.bi * 3u + 1u].xyz; let cc = SC[v.bi * 3u + 2u].xyz;
  // the board and the paddle's blade end at the water (the water is drawn clear after: nothing under the surface here)
  if ((v.part == ${PART.board}u || v.part == ${PART.paddle}u) && v.world.y < v.wy - 0.015) { discard; }
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(v.n); if (dot(n, V) < 0.0) { n = -n; }
  var alb = vec3f(0.7); var rough = 0.5; var sheen = 0.0;
  let lp = v.lp;
  switch (v.part) {
    case ${PART.board}u: {   // the deck's colour, a darker traction pad over the stance, a pale rail line, a centre stringer line
      alb = bc; rough = 0.42;
      let pad = (1.0 - smoothstep(0.2, 0.26, abs(lp.x))) * smoothstep(-0.7, -0.55, lp.z) * (1.0 - smoothstep(0.75, 0.9, lp.z));
      alb = mix(alb, vec3f(0.07, 0.075, 0.08), pad * 0.85 * step(0.04, lp.y));
      let rail = smoothstep(0.30, 0.345, abs(lp.x)); alb = mix(alb, vec3f(0.9, 0.9, 0.88), rail * 0.5);
    }
    case ${PART.torso}u: {   // the PFD over a white shirt: the vest from the hips' hem up, dark shoulder straps, a pale reflective stripe
      alb = vec3f(0.78, 0.78, 0.76); rough = 0.75; sheen = 1.0;
      let vest = smoothstep(0.06, 0.1, lp.y) * (1.0 - smoothstep(0.5, 0.54, lp.y));
      alb = mix(alb, pc, vest);
      alb = mix(alb, vec3f(0.85, 0.85, 0.8), (1.0 - smoothstep(0.0, 0.012, abs(lp.y - 0.33))) * 0.6 * vest);
      alb = mix(alb, skinOf(v.bi) * 0.9, smoothstep(0.52, 0.55, lp.y));
    }
    case ${PART.head}u: {   // skin; the cap over the upper half and its visor, hair under it at the back
      alb = skinOf(v.bi); rough = 0.65; sheen = 0.4;
      if (lp.y > 0.012 || (lp.z < -0.07 && lp.y > -0.005)) { alb = cc; sheen = 0.7; }
      else if (lp.z > 0.06 && lp.y > -0.06) { alb = vec3f(0.1, 0.08, 0.07); }
    }
    case ${PART.rod}u: {   // 0 upper arm (skin), 1 forearm (skin), 2 thigh (navy shorts), 3 shin (skin)
      alb = skinOf(v.bi); rough = 0.65; sheen = 0.3;
      if (v.kind == 2u) { alb = vec3f(0.07, 0.1, 0.2); rough = 0.8; sheen = 0.6; }
    }
    case ${PART.paddle}u: {   // a dark carbon shaft, a T-grip, the blade in the board's colour
      alb = vec3f(0.035, 0.037, 0.04); rough = 0.35;
      if (lp.z > 1.57) { alb = mix(bc, vec3f(0.04), 0.35); rough = 0.4; }
    }
    default: {}
  }
  let c = shade(v.world, n, alb, rough, 0.0, sheen);
  return finish(c, v.pos.xy, v.world);
}`;

export function createSupRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float' }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const mesh = buildSupMeshes();
  const vb = device.createBuffer({ label: 'sup-mesh', size: mesh.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vb, 0, mesh.data);
  const rec = new Float32Array(RECORDS * 16), cols = new Float32Array(MAX * 12);
  const ibuf = device.createBuffer({ label: 'sup-instance', size: rec.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const cbuf = device.createBuffer({ label: 'sup-colours', size: cols.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'sup', entries: [{ binding: 0, visibility: VX | FR, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: FR, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ibuf } }, { binding: 1, resource: { buffer: cbuf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
  const mod = reg.shader('sup', SUP_WGSL(frameStruct));
  const vbuf = { arrayStride: VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }] };
  reg.add('sup-solid', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mod, entryPoint: 'vs', buffers: [vbuf] }, fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const stats = { drawn: 0, calls: 0, triangles: 0 };
  const bw = new Float32Array(12), tmp = new Float32Array(12);
  let n = 0;

  // world rows = the board's rows × a board-frame frame (columns X, Y, Z, origin O): rows(out, off)
  function put(o, X, Y, Z, O, bi, kind, wy) {
    for (let i = 0; i < 3; i++) {
      const a = bw[i * 4], b = bw[i * 4 + 1], c = bw[i * 4 + 2], d = bw[i * 4 + 3], r = o + i * 4;
      rec[r] = a * X[0] + b * X[1] + c * X[2]; rec[r + 1] = a * Y[0] + b * Y[1] + c * Y[2]; rec[r + 2] = a * Z[0] + b * Z[1] + c * Z[2]; rec[r + 3] = a * O[0] + b * O[1] + c * O[2] + d;
    }
    rec[o + 12] = bi; rec[o + 13] = kind; rec[o + 14] = wy; rec[o + 15] = 0;
  }
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  // a rod from P to Q of radius r: Z = Q − P, X and Y perpendicular, scaled by r
  function rod(slot, bi, kind, P, Q, r, wy) {
    const Z = sub(Q, P), z = unit(Z), ref = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], X0 = unit(cross(ref, z)), Y0 = cross(z, X0);
    put((BASE.rod + slot) * 16, [X0[0] * r, X0[1] * r, X0[2] * r], [Y0[0] * r, Y0[1] * r, Y0[2] * r], Z, P, bi, kind, wy);
  }

  function update(boards, { eye, heightAt } = {}) {
    n = 0; stats.drawn = 0;
    if (!boards) return;
    const cs = [];
    for (const b of boards) { if (!b.out) continue; const d = Math.hypot(b.x - eye[0], b.z - eye[2]); if (d <= SUP_RENDER.drawM) cs.push([d, b]); }
    cs.sort((a, b) => a[0] - b[0]);
    for (const [, b] of cs.slice(0, MAX)) {
      const bi = n++, s = b.slot, P = b.pose;
      // the board on the drawn water: the mean of five points (the ends and the rails), pitch and roll the surface's slope, a wobble's share
      const fx = Math.sin(b.heading), fz = -Math.cos(b.heading), L2 = BOARD.L / 2, B2 = BOARD.B / 2;
      const yb = heightAt(b.x + fx * L2, b.z + fz * L2), ys = heightAt(b.x - fx * L2, b.z - fz * L2), yS = heightAt(b.x - fz * B2, b.z + fx * B2), yP = heightAt(b.x + fz * B2, b.z - fx * B2), yc = heightAt(b.x, b.z);
      const y = (yb + ys + yS + yP + yc) / 5 + 0.0;
      poseRows({ x: b.x, y, z: b.z, yaw: -b.heading, pitch: Math.atan2(yb - ys, 2 * L2) * 0.9, roll: Math.atan2(yS - yP, 2 * B2) * 0.8 - b.roll * 0.3 }, bw);
      const wy = y - 0.02;
      // the colours
      const bcol = pick(COLOURS.board, s.board, 'white'), pcol = pick(COLOURS.pfd, s.pfd, 'orange'), ccol = pick(COLOURS.cap, s.cap, 'navy'), sk = s.skin ?? [0.6, 0.4, 0.3];
      cols.set([bcol[0], bcol[1], bcol[2], 0, pcol[0], pcol[1], pcol[2], 0, ccol[0], ccol[1], ccol[2], (sk[0] * 7 + sk[1] * 13 + (s.seed ?? 1) * 0.011) % 11], bi * 12);
      const I = [1, 0, 0], J = [0, 1, 0], K = [0, 0, 1], O0 = [0, 0, 0];
      put((BASE.board + bi) * 16, I, J, K, O0, bi, 0, wy);
      // torso and head: the spine's frame (across, up, and their cross)
      const X = unit(P.across), Y = unit(P.up), Z = cross(X, Y);
      put((BASE.torso + bi) * 16, X, Y, Z, P.hip, bi, 0, wy);
      put((BASE.head + bi) * 16, X, Y, Z, P.head, bi, 0, wy);
      // the paddle: Z along the shaft (the grip to the tip), X across the blade
      const ax = unit(P.axis), px0 = [1 - ax[0] * ax[0], -ax[0] * ax[1], -ax[0] * ax[2]], px = unit(px0), py = cross(ax, px);
      put((BASE.paddle + bi) * 16, px, py, ax, P.top, bi, 0, wy);
      // the limbs: arms from the shoulders, legs from the hip joints
      for (let h = 0; h < 2; h++) {
        const o = bi * ROD_PER;
        rod(o + h, bi, 0, P.shoulder[h], P.elbow[h], 0.048, wy);
        rod(o + 2 + h, bi, 1, P.elbow[h], P.hand[h], 0.04, wy);
        rod(o + 4 + h, bi, 2, P.hipJoint[h], P.knee[h], 0.075, wy);
        rod(o + 6 + h, bi, 3, P.knee[h], P.ankle[h], 0.05, wy);
      }
    }
    stats.drawn = n;
    if (n) { device.queue.writeBuffer(ibuf, 0, rec); device.queue.writeBuffer(cbuf, 0, cols); }
  }
  function draw(pass, c) {
    if (!n) { stats.calls = 0; stats.triangles = 0; return; }
    pass.setPipeline(reg.get('sup-solid')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    let tris = 0, calls = 0;
    const run = (part, base, count) => { const r = mesh.runs[part]; pass.draw(r.count, count, r.first, base); calls++; tris += r.count / 3 * count; };
    run(PART.board, BASE.board, n); run(PART.torso, BASE.torso, n); run(PART.head, BASE.head, n); run(PART.paddle, BASE.paddle, n);
    // the rods: n boards × 8, laid by board (records BASE.rod ..): one draw
    run(PART.rod, BASE.rod, n * ROD_PER);
    c.calls += calls; c.triangles += tris; stats.calls = calls; stats.triangles = tris;
  }
  return { update, draw, stats, mesh, get count() { return n; } };
}
export { BODY };
