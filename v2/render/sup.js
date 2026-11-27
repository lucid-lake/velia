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
import { createFigureRig } from './figureRig.js';
import { pickLook } from '../../src/sim/props/paddler/look.js';
import { IREC, SLOTS } from './kayaks.js';

export const SUP_RENDER = Object.freeze({ max: 6, drawM: 650, figures: 4, figurePx: 26, detailPx: 140 });   // figures: the nearest paddlers drawn as the kayakers' figure while their board is ≥ figurePx long on screen (its small parts over detailPx)
// the paddlers' gear as sRGB (the figure's colours: the kayaks' look, src/sim/props/paddler/look.js)
const PFD_HEX = Object.freeze({ orange: '#E8661C', yellow: '#F0C419', red: '#CC2F2A', blue: '#2B62B3', white: '#E9E6DC' });
const CAP_HEX = Object.freeze({ navy: '#1C2340', white: '#EEEAE0', red: '#B42A26', yellow: '#E3B52A' });
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
struct SV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) @interpolate(flat) part: u32, @location(4) @interpolate(flat) bi: u32, @location(5) @interpolate(flat) kind: u32, @location(6) @interpolate(flat) wy: f32, @location(7) ln: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) part: f32, @builtin(instance_index) ii: u32) -> SV {
  let r0 = SI[ii * 4u]; let r1 = SI[ii * 4u + 1u]; let r2 = SI[ii * 4u + 2u]; let md = SI[ii * 4u + 3u];
  let p4 = vec4f(p, 1.0); let n4 = vec4f(n, 0.0);
  let wp = vec3f(dot(r0, p4), dot(r1, p4), dot(r2, p4)); let wn = vec3f(dot(r0, n4), dot(r1, n4), dot(r2, n4));
  var o: SV; o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = wn; o.lp = p; o.part = u32(part + 0.5); o.bi = u32(md.x + 0.5); o.kind = u32(md.y + 0.5); o.wy = md.z; o.ln = n; return o;
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
    case ${PART.board}u: {   // a glossy epoxy board: the deck's colour over white rails and a pale bottom; the EVA traction pad over the
      // stance (diamond-grooved, a raised kick ridge at its tail), the carry handle's dark recess at the middle, the leash plug at the tail
      let aaX = max(fwidth(lp.x), 1e-4); let aaZ = max(fwidth(lp.z), 1e-4);
      let deck = smoothstep(0.3, 0.7, -normalize(v.ln).y);   // (the loft winds its normals in)
      alb = mix(vec3f(0.86, 0.86, 0.84), bc, deck); rough = 0.2; sheen = 0.0;
      let ln = -normalize(v.ln); let rail = smoothstep(0.55, 0.95, abs(ln.x)); alb = mix(alb, vec3f(0.9, 0.9, 0.88), rail * 0.7);
      let onTop = step(0.6, ln.y);
      let pad = (1.0 - smoothstep(0.24 - aaX, 0.24 + aaX, abs(lp.x))) * smoothstep(-0.62 - aaZ, -0.62 + aaZ, lp.z) * (1.0 - smoothstep(0.78 - aaZ, 0.78 + aaZ, lp.z)) * onTop;
      let g = vec2f(lp.x + lp.z, lp.x - lp.z) / 0.045; let gd = min(abs(fract(g.x) - 0.5), abs(fract(g.y) - 0.5)) * 0.045;
      let groove = 1.0 - smoothstep(0.0025, 0.0025 + aaX * 1.5, gd);
      let kick = 1.0 - smoothstep(0.012, 0.012 + aaZ, abs(lp.z - 0.7));
      let padC = mix(vec3f(0.11, 0.115, 0.12), vec3f(0.05, 0.052, 0.055), max(groove * 0.7, kick));
      alb = mix(alb, padC, pad); rough = mix(rough, 0.92, pad);
      let handle = 1.0 - smoothstep(0.9, 1.0, length(vec2f(lp.x / 0.065, (lp.z + 0.05) / 0.11)));
      alb = mix(alb, vec3f(0.02, 0.02, 0.022), handle * onTop); rough = mix(rough, 0.6, handle * onTop);
      let plug = 1.0 - smoothstep(0.012, 0.012 + aaX, length(vec2f(lp.x, lp.z - ${(BOARD.L / 2 - 0.12).toFixed(3)})));
      alb = mix(alb, vec3f(0.03), plug * onTop);
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

export function createSupRender({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', kayakRender = null }) {
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
  const stats = { drawn: 0, figures: 0, calls: 0, triangles: 0 };
  // the paddlers near enough: the kayakers' own figure (the UBC paddler on the kayaks' skin pipeline, render/kayaks.js share), its bones
  // set from this board's pose (render/figureRig.js); the rest keep the rods below
  const FIG = SUP_RENDER.figures;
  let rig = null, rigClips = null, figPal = null, figIns = null, figInsU = null, figPalBuf = null, figInsBuf = null, figBG = null, figBGL = null;
  const figs = [];   // this frame's: { part, detail }
  const looks = new Map();
  const ensureFigs = (share, clips) => {
    if (!share || !clips) return false;
    if (rig && rigClips === clips && figBG && figBGL === share.skinBGL) return true;
    rig = createFigureRig(kayakRender.json, clips); rigClips = clips;
    figPal = new Float32Array(FIG * SLOTS * 12); figIns = new Float32Array(FIG * IREC * 4); figInsU = new Uint32Array(figIns.buffer);
    figPalBuf = device.createBuffer({ label: 'sup-figure-palette', size: figPal.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    figInsBuf = device.createBuffer({ label: 'sup-figure-instances', size: figIns.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    figBGL = share.skinBGL;
    figBG = device.createBindGroup({ layout: share.skinBGL, entries: [{ binding: 0, resource: { buffer: figPalBuf } }, { binding: 1, resource: { buffer: figInsBuf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
    return true;
  };
  const lookOf = (s) => {
    let lk = looks.get(s.id ?? s.seed); if (lk) return lk;
    lk = pickLook(s.seed ?? 1, { pfd: PFD_HEX[s.pfd] ?? PFD_HEX.orange, hat: 'cap', hatColour: CAP_HEX[s.cap] ?? CAP_HEX.navy });
    looks.set(s.id ?? s.seed, lk); return lk;
  };
  const FT = { hip: [0, 0, 0], up: [0, 1, 0], across: [1, 0, 0], hands: [[0, 0, 0], [0, 0, 0]], elbowPole: [[-0.5, -0.6, 0.7], [0.5, -0.6, 0.7]], feet: [[0, 0, 0], [0, 0, 0]], kneePole: [[0, 0, -1], [0, 0, -1]], headLevel: 0.65, armReach: 1.12, footTurn: 0.14 };
  // the board's pose → the figure's targets: the hips, the spine, the wrists a palm short of the grips, the ankles over the soles
  function figTargets(P, sc) {
    FT.hip = P.hip; FT.up = P.up; FT.across = P.across;
    for (let h = 0; h < 2; h++) {
      const g = P.hand[h], sh = P.shoulder[h], d = sub(g, sh), l = Math.hypot(d[0], d[1], d[2]) || 1, back = 0.075 * sc;
      FT.hands[h] = [g[0] - d[0] / l * back, g[1] - d[1] / l * back, g[2] - d[2] / l * back];
      const sg = h === 0 ? -1 : 1, kn = P.knee[h], hj = P.hipJoint[h];
      FT.feet[h] = [P.ankle[h][0], BOARD.top + 0.085 * sc, P.ankle[h][2]];
      FT.kneePole[h] = [kn[0] - (hj[0] + P.ankle[h][0]) / 2 + sg * 0.02, kn[1] - (hj[1] + P.ankle[h][1]) / 2, kn[2] - (hj[2] + P.ankle[h][2]) / 2 - 0.05];
      FT.elbowPole[h] = [sg * 0.5, -0.6, 0.7];
    }
    return FT;
  }
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

  let nFig = 0;
  function update(boards, { eye, heightAt, focalPx = 1000 } = {}) {
    n = 0; nFig = 0; figs.length = 0; stats.drawn = 0; stats.figures = 0;
    if (!boards) return;
    const share = kayakRender?.share, clips = kayakRender?.clips, figOk = ensureFigs(share, clips);
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
      // the nearest boards (sorted: the first ones) carry the kayakers' figure while big enough on screen
      const bpx = BOARD.L * focalPx / Math.max(1, Math.hypot(b.x - eye[0], b.z - eye[2]));
      if (figOk && bi === nFig && nFig < FIG && bpx >= SUP_RENDER.figurePx) {
        const lk = lookOf(s), sc = rig.scale(lk.sex), base = nFig * SLOTS;
        rig.pose(lk.sex, figTargets(P, sc), figPal, base * 12);
        share.writeInst(nFig, bw, base, -1, share.colours({ colour: 'yellow', look: lk }), null, figIns, figInsU);
        figs.push({ part: lk.sex, detail: bpx > SUP_RENDER.detailPx }); nFig++;
      }
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
    stats.drawn = n; stats.figures = nFig;
    if (n) { device.queue.writeBuffer(ibuf, 0, rec); device.queue.writeBuffer(cbuf, 0, cols); }
    if (nFig) { device.queue.writeBuffer(figPalBuf, 0, figPal, 0, nFig * SLOTS * 12); device.queue.writeBuffer(figInsBuf, 0, figIns, 0, nFig * IREC * 4); }
  }
  function draw(pass, c) {
    if (!n) { stats.calls = 0; stats.triangles = 0; return; }
    pass.setPipeline(reg.get('sup-solid')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg); pass.setVertexBuffer(0, vb);
    let tris = 0, calls = 0;
    const run = (part, base, count) => { const r = mesh.runs[part]; pass.draw(r.count, count, r.first, base); calls++; tris += r.count / 3 * count; };
    run(PART.board, BASE.board, n); run(PART.paddle, BASE.paddle, n);
    // the paddlers past the figures: the torso, the head and the rods (n boards × 8, laid by board: records BASE.rod ..), one draw each
    if (n > nFig) { run(PART.torso, BASE.torso + nFig, n - nFig); run(PART.head, BASE.head + nFig, n - nFig); run(PART.rod, BASE.rod + nFig * ROD_PER, (n - nFig) * ROD_PER); }
    const share = kayakRender?.share;
    if (nFig && share) {   // the figures: the kayaks' skin pipeline with this board's palette and records
      pass.setPipeline(reg.get('kayak-skin')); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, figBG); pass.setVertexBuffer(0, share.vb); pass.setIndexBuffer(share.ib, 'uint16');
      for (let i = 0; i < nFig; i++) { const p = share.parts[figs[i].part], cnt = figs[i].detail ? p.indexCount : p.coreIndexCount ?? p.indexCount; pass.drawIndexed(cnt, 1, p.firstIndex, p.firstVertex, i); calls++; tris += cnt / 3; }
    }
    c.calls += calls; c.triangles += tris; stats.calls = calls; stats.triangles = tris;
  }
  return { update, draw, stats, mesh, get count() { return n; } };
}
export { BODY };
