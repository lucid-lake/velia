// The skipper's instruments on v2's GPU (M4): v1's compass card under the binnacle's dome and the wind-and-speed pod on
// the pedestal guard's rail (src/boat/instruments.js createInstruments), in the HULL frame at v1's INSTRUMENTS spots,
// riding the boat's pose in three of render/boat.js's Model slots (the card turned by the heading, the pod tilted 25°,
// the lubber line fixed to the hull). The faces are v1's 2D canvases (render/boat/instruments.js), one texture of two
// layers (256² each, full mips made by canvas downscales), uploaded with copyExternalImageToTexture only when a face was
// redrawn (the card once; the pod at most 10 Hz, only when the needle or the numeral moves).
// Lit as v1's materials: the card MeshStandard (roughness 0.85, metal 0: the boat's sun, sky, shadow map and sky mirror,
// as the solids) with its red night emissive; the pod's face MeshBasic (unlit: the texture × v1's faceGain, held at its
// on-screen level as v2's exposure rises toward dusk); the bezel and the lubber line on the boat's own solid pipeline.
// #35: v1's VHF set on the pedestal guard (src/boat/vhf.js createVhf: the dark body, the steel strap, the 320 × 184 face whose
// LCD shows the channel, RX and the spoken words scrolling), a fourth slot: the face on the same pipeline (its own 320 × 184
// texture and bind group, v1's canvas size, redrawn only when the LCD's view changes, at most 10 Hz: ui/captain.js's gate),
// the body and the strap on the boat's solid pipeline in one draw. Lit as v1's: the face MeshBasic × faceGain, the body
// MeshStandard (roughness 0.55), the strap metal 0.9, roughness 0.35.
// One pipeline ('boat-instrument'), declared with the boat's at load.
//   const inst = createBoatInstruments({ device, reg, frameBGL, skyBGL, boatBGL, head, hdrTarget, msaa, depthFormat });
//   each frame: const r = inst.update(pose, { t, sunElevDeg })  → r.cardAngle; inst.P / inst.Q the slots' p and q
//   in the scene: inst.draw(pass, c, { bg, stride, slots: { hull, card, pod, vhf } })
//   the VHF's LCD: update(pose, { vhf: captain.lcd }) → redrawn when vhf.n moves (captain.js); headless: v1's idle face ('16')
import { INSTRUMENTS, drawCard, drawDisplay, instrumentLogic } from './boat/instruments.js';
import { VHF, lcdView, drawFace } from '../../src/boat/vhfFace.js';
import { hexLinear } from './boat/models.js';
import { exposureFactor } from '../sim/exposure.js';
import { SUN } from './sky.js';

// v1's scene unit (a MeshBasic face of value 1; a sunlit white ≈ 3.5 of it: boatModels.js CABIN_LIGHT) in v2's HDR scale:
// an 18 % grey card under the noon sun is 0.92 there (sim/exposure.js), a sunlit white 5.1, so one v1 unit ≈ 1.46 at
// F.sky.x = SUN.illuminance; as a share of F.sky.x so it follows the scale
export const FACE_ONSCREEN = 3.0;   // tuning: v1 AgX vs v2 ACES on the same face (the pedestal shot, renders/m4)
// #35: the VHF's face over the pod's unit: v1's AgX lifts its pale LCD and grey face more than v2's ACES does at the pod's
// unit; matched on the LCD's glass in the set's close-up at 13:00 (renders/v2-vhf-set close-v1 / close-v2)
export const VHF_FACE_K = 2.2;
export const FACE_UNIT = FACE_ONSCREEN * (0.92 / 0.18) / 3.5 / SUN.illuminance;
const LAYERS = 2, TEX = INSTRUMENTS.texSize.card, MIPS = Math.log2(TEX) + 1;

// v2's exposureComp (v1: base exposure / the frame's): the factor at a high sun over this frame's (≤ 1 toward dusk)
export const exposureComp = (sunElevDeg) => exposureFactor(6, 90) / exposureFactor(6, sunElevDeg);

export const INSTRUMENT_WGSL = (head) => `diagnostic(off, derivative_uniformity);
${head}
@group(3) @binding(0) var tInst: texture_2d_array<f32>;
@group(3) @binding(1) var sInst: sampler;
const FACE_UNIT = ${FACE_UNIT.toFixed(6)}; const EMI = vec3f(${INSTRUMENTS.cardEmissive.join(', ')}); const ROUGH = ${INSTRUMENTS.cardRoughness};
struct V { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f) -> V {
  let w = M.m * vec4f(p, 1.0);
  var o: V; o.pos = F.viewProj * w; o.world = w.xyz; o.n = (M.n * vec4f(n, 0.0)).xyz; o.uv = uv; return o;
}
// M.p: (the face's gain, the card's emissive intensity, 0, 0: p.z stays 0, the solid pipeline's dissolve, for the bezel
// in the same slot)  M.q: (kind: 0 the card, 1 the pod's face; the layer; 0, 0: the solid's waterline rule off)
@fragment fn fs(v: V) -> @location(0) vec4f {
  let tex = textureSample(tInst, sInst, v.uv, i32(M.q.y + 0.5)).rgb;
  let unit = FACE_UNIT * F.sky.x;
  var Tair = vec3f(1.0);
  let inS = aerialParts(v.pos.xy, v.world, &Tair);
  if (M.q.x > 0.5) { return vec4f(tex * M.p.x * unit * Tair + inS, 1.0); }   // v1's MeshBasic face: the texture × the gain
  // v1's MeshStandard card: roughness 0.85, metal 0, the map as its colour; the red night light as its emissive
  let V = normalize(F.cam.xyz - v.world);
  let n = normalize(v.n);
  let s = normalize(F.sun.xyz);
  let nl = max(dot(n, s), 0.0);
  let eSun = sunPerp() * shadowAt(v.world, nl);
  let f0 = vec3f(0.04);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  var col = tex / PI * (eSun * nl + ambientAt(n)) + skyMirror(R) * fres * (1.0 - 0.7 * ROUGH) + ggxSpec(n, V, s, ROUGH, f0) * eSun;
  col += EMI * tex * M.p.y * unit;
  return vec4f(col * Tair + inS, 1.0);
}`;

// --- the meshes (pure): the textured faces (position, normal, uv) and the solids (position, normal, colour, metal/rough) ---
// the card: a disc of radius r in its local xy plane, normal +z, canvas north (the texture's top row) on local +y (as
// three's CircleGeometry with a flipY canvas texture); the face: a w × h quad at z = faceZ, the canvas's top on +y
export function faceMesh(I = INSTRUMENTS, seg = 48, V = VHF) {
  const pos = [], nrm = [], uv = [], idx = [];
  const v = (x, y, z, u, w) => { pos.push(x, y, z); nrm.push(0, 0, 1); uv.push(u, w); return pos.length / 3 - 1; };
  const r = I.card.r, c0 = v(0, 0, 0, 0.5, 0.5);
  for (let i = 0; i <= seg; i++) { const a = (i / seg) * 2 * Math.PI, x = Math.cos(a) * r, y = Math.sin(a) * r; v(x, y, 0, 0.5 + x / (2 * r), 0.5 - y / (2 * r)); }
  for (let i = 0; i < seg; i++) idx.push(c0, c0 + 1 + i, c0 + 2 + i);   // counter-clockwise seen from +z
  const card = { first: 0, count: idx.length };
  const { w, h, faceZ } = I.display;
  const q = [v(-w / 2, -h / 2, faceZ, 0, 1), v(w / 2, -h / 2, faceZ, 1, 1), v(w / 2, h / 2, faceZ, 1, 0), v(-w / 2, h / 2, faceZ, 0, 0)];
  const f0 = idx.length; idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  // #35: the VHF's face (v1: a PlaneGeometry w × 0.96 by h × 0.92 at z 0.6 mm in front of the body, in the set's frame)
  const vw = V.w * 0.96, vh = V.h * 0.92, vz = 0.0006;
  const r4 = [v(-vw / 2, -vh / 2, vz, 0, 1), v(vw / 2, -vh / 2, vz, 1, 1), v(vw / 2, vh / 2, vz, 1, 0), v(-vw / 2, vh / 2, vz, 0, 0)];
  const f1 = idx.length; idx.push(r4[0], r4[1], r4[2], r4[0], r4[2], r4[3]);
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), uv: new Float32Array(uv), index: new Uint16Array(idx), ranges: { card, face: { first: f0, count: 6 }, vhf: { first: f1, count: 6 } } };
}

// an axis-aligned box (size [x, y, z], centre c), outward counter-clockwise faces, into the solid arrays
function pushBox(A, size, c, col, rough, metal = 0) {
  const [hx, hy, hz] = size.map((s) => s / 2);
  const faces = [   // normal, then 4 corners counter-clockwise seen from outside
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  const first = A.idx.length;
  for (const [n, q] of faces) {
    const b = A.pos.length / 3;
    for (const [sx, sy, sz] of q) { A.pos.push(c[0] + sx * hx, c[1] + sy * hy, c[2] + sz * hz); A.nrm.push(...n); A.col.push(...col); A.mr.push(metal, rough); }
    A.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { first, count: A.idx.length - first };
}
// the bezel (the pod's frame: v1's box w + 16 mm × h + 16 mm × 22 mm round the pod's origin) and the lubber line (the
// HULL frame: on the card's aft edge, 2 mm above it)
export function solidMesh(I = INSTRUMENTS, V = VHF) {
  const A = { pos: [], nrm: [], col: [], mr: [], idx: [] };
  const d = I.display, c = I.card, L = I.lubber;
  const bezel = pushBox(A, [d.w + d.bezel, d.h + d.bezel, d.depth], [0, 0, 0], hexLinear(I.bezelColor), I.bezelRoughness);
  const lubber = pushBox(A, L.size, [c.at[0], c.at[1] + L.dy, c.at[2] + c.r * L.rK], hexLinear(I.lubberColor), I.lubberRoughness);
  // #35: the VHF set's body (v1: a w × h × d box behind the face, 0x1b1e22, roughness 0.55) and its strap (w + 12 mm × 8 mm ×
  // 0.7 d under it, 0x9aa0a6, metal 0.9, roughness 0.35), in the set's frame (vhfLocal), one range: one draw
  const vhfBody = pushBox(A, [V.w, V.h, V.d], [0, 0, -V.d / 2], hexLinear(VHF_LOOK.body), VHF_LOOK.bodyRough);
  const vhfStrap = pushBox(A, [V.w + 0.012, 0.008, V.d * 0.7], [0, -V.h / 2 - 0.004, -V.d / 2], hexLinear(VHF_LOOK.strap), VHF_LOOK.strapRough, VHF_LOOK.strapMetal);
  return { position: new Float32Array(A.pos), normal: new Float32Array(A.nrm), color: new Float32Array(A.col), mr: new Float32Array(A.mr), index: new Uint16Array(A.idx), ranges: { bezel, lubber, vhfBody, vhfStrap },
    vhf: { first: vhfBody.first, count: vhfStrap.first + vhfStrap.count - vhfBody.first } };   // the set's two boxes, one draw
}

// v1's VHF materials (src/boat/vhf.js createVhf: the body's MeshStandard, the strap's)
export const VHF_LOOK = Object.freeze({ body: 0x1b1e22, bodyRough: 0.55, strap: 0x9aa0a6, strapRough: 0.35, strapMetal: 0.9 });
// the set's frame in the HULL frame: v1's set.position = VHF.at, rotation.x = −tiltDeg (the face up and aft, toward the helm)
export function vhfLocal(out, V = VHF) {
  const t = -V.tiltDeg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);   // written in place: no array a frame
  out.fill(0); out[0] = 1; out[5] = c; out[6] = s; out[9] = -s; out[10] = c; out[12] = V.at[0]; out[13] = V.at[1]; out[14] = V.at[2]; out[15] = 1;
  return out;
}

// a 2D canvas (the page's, so the document's fonts reach it)
const makeCanvas = (w, h) => {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
};

// --- the GPU side ---
export function createBoatInstruments({ device, reg, frameBGL, skyBGL, boatBGL, head, hdrTarget, msaa = 1, depthFormat = 'depth32float' }) {
  const CD = GPUBufferUsage.COPY_DST;
  const buf = (label, arr, usage) => { const size = Math.max(16, Math.ceil(arr.byteLength / 4) * 4); const b = device.createBuffer({ label, size, usage: usage | CD });
    if (arr.byteLength % 4) { const pad = new arr.constructor(size / arr.BYTES_PER_ELEMENT); pad.set(arr); device.queue.writeBuffer(b, 0, pad); } else device.queue.writeBuffer(b, 0, arr); return b; };
  const fm = faceMesh(), sm = solidMesh();
  const face = { pos: buf('inst-face-pos', fm.position, GPUBufferUsage.VERTEX), nrm: buf('inst-face-nrm', fm.normal, GPUBufferUsage.VERTEX), uv: buf('inst-face-uv', fm.uv, GPUBufferUsage.VERTEX), idx: buf('inst-face-idx', fm.index, GPUBufferUsage.INDEX) };
  const solid = { pos: buf('inst-solid-pos', sm.position, GPUBufferUsage.VERTEX), nrm: buf('inst-solid-nrm', sm.normal, GPUBufferUsage.VERTEX), col: buf('inst-solid-col', sm.color, GPUBufferUsage.VERTEX), mr: buf('inst-solid-mr', sm.mr, GPUBufferUsage.VERTEX), idx: buf('inst-solid-idx', sm.index, GPUBufferUsage.INDEX) };

  // the faces' texture: layer 0 the card, layer 1 the pod (its 2:1 canvas stretched onto the square layer: the quad's
  // uv takes it back), sRGB, full mips
  const tex = device.createTexture({ label: 'boat-instruments', size: [TEX, TEX, LAYERS], mipLevelCount: MIPS, format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  const sampler = device.createSampler({ label: 'boat-instruments', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 4 });
  const bgl = device.createBindGroupLayout({ label: 'boat-instruments', entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
  const bg = device.createBindGroup({ label: 'boat-instruments', layout: bgl, entries: [{ binding: 0, resource: tex.createView({ dimension: '2d-array' }) }, { binding: 1, resource: sampler }] });
  // #35: the VHF's face, its own texture at v1's canvas size (320 × 184, full mips), a one-layer array on the same layout
  const [VW, VH] = VHF.px, VMIPS = Math.floor(Math.log2(Math.max(VW, VH))) + 1;
  const vtex = device.createTexture({ label: 'boat-vhf', size: [VW, VH, 1], mipLevelCount: VMIPS, format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
  const vbg = device.createBindGroup({ label: 'boat-vhf', layout: bgl, entries: [{ binding: 0, resource: vtex.createView({ dimension: '2d-array' }) }, { binding: 1, resource: sampler }] });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, skyBGL, boatBGL, bgl] });
  const f3 = (loc) => ({ arrayStride: 12, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x3' }] });
  const mod = reg.shader('boat-instrument', INSTRUMENT_WGSL(head));
  reg.add('boat-instrument', { layout, vertex: { module: mod, entryPoint: 'vs', buffers: [f3(0), f3(1), { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] }] },
    fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] }, primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });

  // the canvases: a layer each, plus one chain of mip canvases shared by both uploads
  const layerC = [makeCanvas(TEX, TEX), makeCanvas(TEX, TEX)];
  const mips = []; for (let l = 1, s = TEX >> 1; s >= 1; l++, s >>= 1) mips.push(makeCanvas(s, s));
  let uploads = 0, redraws = 0, uploadMs = 0;
  const upload = (layer) => {
    const t0 = performance.now();
    device.queue.copyExternalImageToTexture({ source: layerC[layer] }, { texture: tex, mipLevel: 0, origin: [0, 0, layer] }, [TEX, TEX]);
    let src = layerC[layer];
    mips.forEach((c, i) => {
      const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); src = c;
      device.queue.copyExternalImageToTexture({ source: c }, { texture: tex, mipLevel: i + 1, origin: [0, 0, layer] }, [c.width, c.height]);
    });
    uploads++; uploadMs = performance.now() - t0;
  };
  drawCard(layerC[0].getContext('2d'), TEX); upload(0);
  const [DW, DH] = INSTRUMENTS.texSize.display;
  const drawPod = (values, palette) => { const g = layerC[1].getContext('2d'); g.setTransform(TEX / DW, 0, 0, TEX / DH, 0, 0); drawDisplay(g, DW, DH, values, palette); g.setTransform(1, 0, 0, 1, 0, 0); redraws++; upload(1); };
  drawPod({}, undefined);
  // #35: the VHF's face: v1's drawFace on a 320 × 184 canvas, its mip chain by canvas downscales; redrawn only when the
  // captain's LCD view moves (vhfN), never in a frame where it did not
  const vC = makeCanvas(VW, VH), vMips = [];
  for (let l = 1; l < VMIPS; l++) vMips.push(makeCanvas(Math.max(1, VW >> l), Math.max(1, VH >> l)));
  let vhfN = -1, vhfDraws = 0, vhfView = lcdView({}), vhfShown = true;   // vhfShown: the A/B's switch (tools/v2-ab-vhf.mjs)
  const drawVhf = (view) => {
    const t0 = performance.now();
    drawFace(vC.getContext('2d'), VW, VH, view); vhfView = view; vhfDraws++;
    device.queue.copyExternalImageToTexture({ source: vC }, { texture: vtex, mipLevel: 0 }, [VW, VH]);
    let src = vC;
    vMips.forEach((c, i) => {
      const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.clearRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); src = c;
      device.queue.copyExternalImageToTexture({ source: c }, { texture: vtex, mipLevel: i + 1 }, [c.width, c.height]);
    });
    uploads++; uploadMs = performance.now() - t0;
  };
  drawVhf(vhfView);

  const logic = instrumentLogic();
  const P = { card: [1, 0, 0, 0], pod: [1, 0, 0, 0], hull: [0, 0, 0, 0], vhf: [1, 0, 0, 0] };   // the slots' p and q (render/boat.js writes them)
  const Q = { card: [0, 0, 0, 0], pod: [1, 1, 0, 0], hull: [0, 0, 0, 0], vhf: [1, 0, 0, 0] };   // vhf: kind 1 (the unlit face), layer 0 of its own texture
  return {
    logic, P, Q, faceMesh: fm, solidMesh: sm,
    get vhfShown() { return vhfShown; }, set vhfShown(v) { vhfShown = !!v; },
    get stats() { return { uploads, redraws, uploadMs: +uploadMs.toFixed(2), night: logic.night, kn: logic.kn == null ? null : +logic.kn.toFixed(2), vhf: { draws: vhfDraws, big: vhfView.big, tag: vhfView.tag, line: vhfView.line } }; },
    // pose: the drawn state (it carries the physics' heading, sog, groove, apparentWind, trueWind); t the scene time (s)
    // vhf: the captain's LCD ({ view, n }: ui/captain.js) or null (a capture: the idle face stays)
    update(pose, { t = 0, sunElevDeg = 90, vhf = null } = {}) {
      logic.light({ elevDeg: sunElevDeg, exposureComp: exposureComp(sunElevDeg) });
      const r = logic.update(pose, t);
      if (r.redraw) drawPod(r.values, r.palette);
      P.pod[0] = P.card[0] = logic.gain; P.vhf[0] = logic.gain * VHF_FACE_K; P.pod[1] = P.card[1] = logic.cardEmissive;   // v1: the VHF's face × faceGain, as the pod's
      if (vhf && vhf.n !== vhfN) { vhfN = vhf.n; drawVhf(vhf.view); }
      return r;
    },
    // in the scene pass, with the boat's group 2 (bg, a Model slot each); group 0 bound by the caller, group 1 the sky's
    draw(pass, c, { bg: boatBG, stride, slots }) {
      pass.setPipeline(reg.get('boat-instrument'));
      pass.setBindGroup(3, bg);
      pass.setVertexBuffer(0, face.pos); pass.setVertexBuffer(1, face.nrm); pass.setVertexBuffer(2, face.uv); pass.setIndexBuffer(face.idx, 'uint16');
      pass.setBindGroup(2, boatBG, [slots.card * stride]); pass.drawIndexed(fm.ranges.card.count, 1, fm.ranges.card.first);
      pass.setBindGroup(2, boatBG, [slots.pod * stride]); pass.drawIndexed(fm.ranges.face.count, 1, fm.ranges.face.first);
      if (vhfShown) { pass.setBindGroup(3, vbg); pass.setBindGroup(2, boatBG, [slots.vhf * stride]); pass.drawIndexed(fm.ranges.vhf.count, 1, fm.ranges.vhf.first); }
      pass.setPipeline(reg.get('boat-solid'));
      pass.setVertexBuffer(0, solid.pos); pass.setVertexBuffer(1, solid.nrm); pass.setVertexBuffer(2, solid.col); pass.setVertexBuffer(3, solid.mr); pass.setIndexBuffer(solid.idx, 'uint16');
      pass.setBindGroup(2, boatBG, [slots.pod * stride]); pass.drawIndexed(sm.ranges.bezel.count, 1, sm.ranges.bezel.first);
      pass.setBindGroup(2, boatBG, [slots.hull * stride]); pass.drawIndexed(sm.ranges.lubber.count, 1, sm.ranges.lubber.first);
      if (vhfShown) { pass.setBindGroup(2, boatBG, [slots.vhf * stride]); pass.drawIndexed(sm.vhf.count, 1, sm.vhf.first); }
      const tris = (fm.index.length + sm.index.length - (vhfShown ? 0 : fm.ranges.vhf.count + sm.vhf.count)) / 3;
      c.calls += vhfShown ? 6 : 4; c.triangles += tris;
      return tris;
    },
  };
}
