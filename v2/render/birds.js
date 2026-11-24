// The birds on the GPU (v2): v1's bodies (src/birds/build.js, plain JS: the lofted body, the feathered wings, the tail's
// fan, the legs, the osprey's trout) posed in the vertex shader from v1's per-bird numbers (the wingbeat's shoulder
// angle, the hand's dihedral and sweep, the fold, the primaries' splay and curl, the tail's spread and pitch, the legs,
// the fish, the head's turn): v1's mesh.js deform ported from TSL to WGSL, rigid bones blended at the shoulder and the
// wrist. One indexed instanced draw per species and level of detail (8 at most), the near and far meshes dithered into
// each other by v1's per-bird fade; v1's snag on Emerald Point (one draw) and the low birds' soft shadows on the water
// (shadows.js: one blended instanced draw after the water). Lit as the rest of v2's world: the M1 sun through the
// transmittance LUT, the frame's sky light, the terrain's sun shadow, the aerial perspective and the clouds; v1's
// translucent vanes (a back-lit feather glows through, the pale ones most). The records come from v2/sim/birds.js.
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { build, STRIDE, OFF, KIND } from '../../src/birds/build.js';
import { SPECIES } from '../../src/birds/species.js';
import { NAMES, ISTRIDE, SSTRIDE, SHADOW_MAX, BIRD_TIERS as BIRD_TIERS_REF, snagMesh as snagMeshRef, createBirdSim as createBirdSimRef } from '../sim/birds.js';
import { listenerCamera as listenerCam } from '../engine/birdAudio.js';
import { createBirdSplash } from '../living/birds-splash.js';

// the vertex buffer of one species at one level of detail: v1's interleaved floats as they are
const ATTRS = ['position', 'normal', 'colTop', 'colBot', 'bw', 'fx', 'fb', 'fc', 'shp', 'ao'];
const SIZES = { position: 3, normal: 3, colTop: 3, colBot: 3, bw: 3, fx: 4, fb: 4, fc: 4, shp: 4, ao: 1 };
export function birdGeometry(name, lod) {
  const g = build(name, { lod });
  return {
    data: g.data, index: g.index, indexCount: g.index.length, triangles: g.info.triangles, info: g.info, stride: STRIDE * 4,
    attributes: ATTRS.map((k, i) => ({ shaderLocation: i, offset: OFF[k] * 4, format: SIZES[k] === 1 ? 'float32' : `float32x${SIZES[k]}` })),
  };
}
// the per-species numbers the deform needs (mesh.js birdMaterial): the shoulder, the wrist, the neck pivot, the fold's
// lift, the tail's root; 4 vec4 a species
export function speciesConsts() {
  const out = new Float32Array(NAMES.length * 16);
  NAMES.forEach((n, i) => {
    const sp = SPECIES[n], info = build(n, { lod: 0 }).info, o = i * 16;
    const foldOut = Math.max(...sp.body.map((s) => s[1])) - info.shoulder[0] + 0.006;
    out.set([...info.shoulder, 0, ...info.wrist, 0, 0, sp.body.at(-3)[3], info.neckZ, foldOut, 0, sp.body[0][3], sp.body[0][0] + 0.03, 0], o);
  });
  return out;
}

const COMMON = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
${SHADOW_STRUCT}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;   // × the storm cell's shade (1 fair): the land under the deck, as the water and the boat (v1's sunShade)
}
fn throughAir(col: vec3f, px: vec2f, p: vec3f) -> vec3f {
  var out = aerial(col, px, p);
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return out;
}`;

export const BIRD_DRAW_WGSL = (fs, far) => `${COMMON(fs)}
@group(2) @binding(0) var<storage, read> REC: array<vec4f>;   // 6 vec4 a bird: pos+scale, quat, poseA, poseB, poseC, poseD
@group(2) @binding(1) var<storage, read> SPC: array<vec4f>;   // 4 vec4 a species: shoulder, wrist, neck + foldOut, tail root
@group(2) @binding(2) var tShadowB: texture_depth_2d;
@group(2) @binding(3) var sShadowB: sampler_comparison;
@group(2) @binding(4) var<uniform> SH: Shadow;
${SHADOW_READ('tShadowB', 'sShadowB')}
struct VIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) colTop: vec3f, @location(3) colBot: vec3f, @location(4) bw: vec3f,
  @location(5) fx: vec4f, @location(6) fb: vec4f, @location(7) fc: vec4f, @location(8) shp: vec4f, @location(9) ao: f32 }
struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) colTop: vec3f, @location(3) colBot: vec3f,
  @location(4) fx: vec4f, @location(5) shp: vec4f, @location(6) fade: f32, @location(7) ao: f32 }
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, v.z * c - v.x * s); }
fn rotZ(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
fn rotX(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { let t = 2.0 * cross(q.xyz, v); return v + t * q.w + cross(q.xyz, t); }
@vertex fn vs(a: VIn, @builtin(instance_index) ii: u32) -> VOut {
  let b = ii * 6u;
  let iPos = REC[b]; let iQuat = REC[b + 1u]; let pA = REC[b + 2u]; let pB = REC[b + 3u]; let pC = REC[b + 4u]; let pD = REC[b + 5u];
  let sb = u32(pD.z + 0.5) * 4u;
  let S = SPC[sb].xyz; let Wr = SPC[sb + 1u].xyz; let neck = SPC[sb + 2u].xyz; let foldOut = SPC[sb + 2u].w; let tailRoot = SPC[sb + 3u].xyz;
  let side = a.fx.w; let kind = a.fx.z; let M = vec3f(side, 1.0, 1.0);
  // the body's own parts in the true frame: the tail's fan and pitch, the legs, the fish, the head
  var pb = a.p; var nb = a.n;
  if (abs(kind - ${KIND.tail}.0) < 0.5) {
    let ang = a.fb.w * pB.z * 0.42; let tp = -pD.y;
    pb = rotX(rotY(pb - tailRoot, ang), tp) + tailRoot; nb = rotX(rotY(nb, ang), tp);
  }
  if (a.fc.y > 0.5) {
    let hip = a.fb.xyz; let legs = pC.x;
    let an = (1.0 - legs) * select(1.1, 1.65, legs < 1.0);
    let k = mix(0.3, 1.0, clamp(legs, 0.0, 1.0));
    pb = rotX((pb - hip) * k, an) + hip; nb = rotX(nb, an);
  }
  if (a.fc.z > 0.5) { pb = a.fb.xyz + (pb - a.fb.xyz) * pC.y; }
  let hw = a.fc.w;
  if (hw > 0.001) {
    let r = rotY(rotX(pb - neck, pD.x), pC.z) + neck;
    pb = mix(pb, r, hw); nb = mix(nb, rotY(rotX(nb, pD.x), pC.z), hw);
  }
  // the wing, in the right wing's frame (the left mirrored in and out)
  var pr = a.p * M; var nr = a.n * M;
  let fold = pB.x;
  if (abs(kind - ${KIND.primary}.0) < 0.5) {
    let base = a.fb.xyz * M; let an = (pB.y - 0.6) * a.fb.w * -0.55;
    pr = rotY(pr - base, an) + base; nr = rotY(nr, an);
  }
  pr.y += a.fc.x * pB.w;
  let k = mix(1.0, 0.3, fold);
  let wx = S.x + (Wr.x - S.x) * k;
  let wh = a.bw.z;
  pr.x = mix(S.x + (pr.x - S.x) * k, pr.x + (wx - Wr.x), wh);
  pr.z = S.z + (pr.z - S.z) * mix(1.0, 0.5, fold);
  let Wp = vec3f(wx, Wr.y, Wr.z);
  let handSweep = pA.w + fold * 0.55; let handDih = pA.y * (1.0 - fold);
  let armSweep = pA.z + fold * 1.25; let flap = mix(pA.x, 1.15, fold);
  let H = rotZ(rotY(pr - Wp, handSweep), handDih) + Wp;
  let nH = rotZ(rotY(nr, handSweep), handDih);
  let lift = vec3f(fold * foldOut, fold * 0.035, 0.0);
  let pw = ((rotZ(rotY(pr - S, armSweep), flap) + S) * a.bw.y + (rotZ(rotY(H - S, armSweep), flap) + S) * a.bw.z + lift * (a.bw.y + a.bw.z)) * M;
  let nw = (rotZ(rotY(nr, armSweep), flap) * a.bw.y + rotZ(rotY(nH, armSweep), flap) * a.bw.z) * M;
  let pos = pb * a.bw.x + pw;
  let nrm = normalize(nb * a.bw.x + nw);
  let wp = qrot(iQuat, pos * iPos.w) + iPos.xyz;
  var o: VOut;
  o.pos = F.viewProj * vec4f(wp, 1.0); o.world = wp; o.n = qrot(iQuat, nrm);
  o.colTop = a.colTop; o.colBot = a.colBot; o.fx = a.fx; o.shp = a.shp; o.fade = pC.w; o.ao = a.ao;
  return o;
}
@fragment fn fs(v: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let u = v.fx.x; let fv = v.fx.y; let kind = v.fx.z;
  let feather = kind > 0.5 && kind < 3.5;
  // the feather's outline (the rounded tip, the emarginated outer primaries' slots), cut per pixel
  let tipR = sqrt(clamp(1.0 - pow(max((fv - 0.72) / 0.28, 0.0), 2.0), 0.0, 1.0));
  let em = v.shp.x;
  let outer = select(mix(1.0, 1.0 - em * 0.3, smoothstep(0.5, 0.64, fv)), mix(1.0, 1.0 - em * 0.62, smoothstep(0.38, 0.55, fv)), u > 0.0);
  let halfW = tipR * outer * select(1.0, 1.0 - smoothstep(0.9, 1.0, fv) * 0.25 * step(abs(u), 0.15), abs(kind - ${KIND.secondary}.0) < 0.5);
  if (feather && abs(u) > halfW) { discard; }
  // the per-bird fade: an interleaved-gradient dither (the near and far meshes are complements)
  let ign = fract(52.9829189 * fract(v.pos.x * 0.06711056 + v.pos.y * 0.00583715));
  ${far ? 'if (ign < 1.0 - v.fade) { discard; }' : 'if (ign >= v.fade) { discard; }'}
  var col = select(v.colBot, v.colTop, front);
  if (feather) {
    let bars = smoothstep(0.25, 0.75, abs(fract(fv * v.shp.y) - 0.5) * 2.0) * v.shp.z * select(1.0, 0.3, front) * step(0.5, v.shp.y);
    col *= 1.0 - bars * 0.55;
    let rachis = (1.0 - smoothstep(0.02, 0.07, abs(u))) * smoothstep(0.0, 0.1, fv);
    col = mix(col, col * 1.5 + 0.02, rachis * 0.45);
    col *= mix(1.0, 0.82, smoothstep(0.55, 1.0, abs(u) / max(halfW, 0.05)));
    col *= 0.95 + sin(fv * 150.0 + abs(u) * 30.0) * 0.05;
  }
  if (abs(kind - ${KIND.body}.0) < 0.5) {
    let g = vec2f(u * 64.0, fv * 36.0); let row = fract(g.y * 0.5) > 0.5;
    let cell = fract(vec2f(g.x + select(0.0, 0.5, row), g.y));
    let edge = smoothstep(0.6, 1.0, cell.y) * 0.5 + smoothstep(0.35, 0.5, abs(cell.x - 0.5)) * 0.2;
    let id = fract(sin(floor(g.x) * 12.9898 + floor(g.y) * 78.233) * 43758.5);
    col *= (1.0 - edge * 0.22) * (0.93 + id * 0.14);
  }
  if (abs(kind - ${KIND.covert}.0) < 0.5) {
    let g = vec2f(fv * 46.0, u * 9.0); let row = fract(g.y) > 0.5;
    let cell = fract(vec2f(g.x + select(0.0, 0.5, row), g.y));
    let fringe = smoothstep(0.7, 0.98, cell.y) * (1.0 - smoothstep(0.2, 0.5, abs(cell.x - 0.5)));
    col = mix(col, col * 1.45 + 0.015, fringe * 0.5);
    col *= 0.92 + fract(sin(cell.x + floor(g.x) * 12.9898 + floor(g.y) * 78.233) * 43758.5) * 0.16;
  }
  if (abs(kind - ${KIND.eye}.0) < 0.5) { col = select(select(col, vec3f(0.02), u > 0.86), vec3f(0.004), u < 0.45); }
  col *= v.ao;
  // the light: v1's translucent vanes (the shading normal bent toward the sun by the light through a back-lit vane)
  let p = v.world; let s = normalize(F.sun.xyz); let V = normalize(F.cam.xyz - p);
  var n = normalize(v.n);
  let facing = n * sign(dot(n, V) + 1e-6);
  let behind = max(-dot(facing, s), 0.0);
  let pale = dot(select(v.colTop, v.colBot, front), vec3f(0.3, 0.55, 0.15));
  let kt = select(select(0.0, 0.25, abs(kind - ${KIND.covert}.0) < 0.5), mix(0.35, 1.3, smoothstep(0.05, 0.6, pale)), feather);
  n = normalize(facing + s * behind * kt);
  let nl = max(dot(n, s), 0.0);
  let sh = shadowAt(p, nl);
  let sun = sunAt(p.y, s);
  // the sky above, and the light the lake and the shore send back up under the wings (v1's environment light lit the
  // undersides: a pale gull's belly read pale against the cloud): the level ground's sun and sky × an albedo of 0.2
  let E = sun * nl * sh + LIGHT.sky.rgb * (0.5 + 0.5 * n.y) + (LIGHT.sun.rgb + LIGHT.sky.rgb) * 0.2 * (0.5 - 0.5 * n.y);
  // feathers are matte: a weak, broad specular (v1: a plastic's 4 % made a dark eagle's wings read white)
  let isEye = abs(kind - ${KIND.eye}.0) < 0.5; let isFish = abs(kind - ${KIND.fish}.0) < 0.5; let isBill = abs(kind - ${KIND.bill}.0) < 0.5;
  let rough = select(select(select(0.82, 0.55, abs(kind - ${KIND.foot}.0) < 0.5), 0.22, isFish), select(0.38, 0.05, isEye), isEye || isBill);
  let specI = select(select(0.18, 0.6, isBill), 1.0, isEye || isFish);
  let hh = normalize(s + V); let a2 = max(rough * rough, 0.002); let a4 = a2 * a2;
  let nh = max(dot(n, hh), 0.0); let dd = nh * nh * (a4 - 1.0) + 1.0;
  let spec = sun * nl * sh * specI * 0.04 * a4 / (PI * dd * dd) * 0.25;
  let lit = col * E / PI + spec;
  return vec4f(throughAir(lit, v.pos.xy, p), 1.0);
}`;

// v1's snag (snag.js): the weathered silver wood, its grain, the dark checks
export const SNAG_DRAW_WGSL = (fs) => `${COMMON(fs)}
@group(2) @binding(2) var tShadowB: texture_depth_2d;
@group(2) @binding(3) var sShadowB: sampler_comparison;
@group(2) @binding(4) var<uniform> SH: Shadow;
${SHADOW_READ('tShadowB', 'sShadowB')}
struct SOut { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) c: vec3f }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f) -> SOut {
  var o: SOut; o.pos = F.viewProj * vec4f(p, 1.0); o.world = p; o.n = n; o.c = c; return o;
}
@fragment fn fs(v: SOut) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  let A = v.c * mix(0.86, 1.08, sin(p.y * 23.0 + p.x * 41.0) * 0.5 + 0.5);
  let nl = max(dot(n, s), 0.0);
  let E = sunAt(p.y, s) * nl * shadowAt(p, nl) + LIGHT.sky.rgb * (0.5 + 0.5 * n.y);
  return vec4f(throughAir(A * E / PI, v.pos.xy, p), 1.0);
}`;

// the low birds' soft shadows on the water (shadows.js): a cross of the wings' bar and the body, faded with height
export const SHADOW_DRAW_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
@group(1) @binding(0) var<storage, read> SR: array<vec4f>;   // 3 vec4 a shadow: centre + opacity, span axis + half + stretch, body axis + half + edge
struct QOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) ii: u32 }
const QP = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(1.0, -1.0), vec2f(-1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> QOut {
  let q = QP[vi]; let A = SR[ii * 3u]; let B = SR[ii * 3u + 1u]; let C = SR[ii * 3u + 2u];
  let w = A.xyz + vec3f(B.x, 0.0, B.y) * B.z * q.x + vec3f(C.x, 0.0, C.y) * C.z * q.y;
  var o: QOut; o.pos = F.viewProj * vec4f(w, 1.0); o.uv = q; o.ii = ii; return o;
}
@fragment fn fs(v: QOut) -> @location(0) vec4f {
  let A = SR[v.ii * 3u]; let B = SR[v.ii * 3u + 1u]; let C = SR[v.ii * 3u + 2u]; let q = v.uv;
  let wingBar = (1.0 - smoothstep(0.6, 1.0, abs(q.x))) * (1.0 - smoothstep(0.0, B.w, abs(q.y + 0.1)));
  let body = (1.0 - smoothstep(0.08, C.w, abs(q.x))) * (1.0 - smoothstep(0.7, 1.0, abs(q.y)));
  let a = max(wingBar, body) * A.w;
  return vec4f(0.0, 0.0, 0.0, a);   // premultiplied black: the water under it × (1 − a)
}`;

export function createBirdsRender({ device, reg, frameBGL, frameStruct, sky, shadow, sim, hdrTarget, msaa = 1, depthFormat = 'depth32float' }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  // the geometry: 4 species × 2 levels, uploaded once at boot (≈ 0.75 MB of floats)
  const geo = {};
  let geoBytes = 0;
  for (const n of NAMES) for (const lod of [0, 1]) {
    const g = birdGeometry(n, lod);
    const vb = device.createBuffer({ label: `bird-${n}-${lod}-v`, size: g.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vb, 0, g.data);
    const ib = device.createBuffer({ label: `bird-${n}-${lod}-i`, size: g.index.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ib, 0, g.index);
    geo[`${n}${lod}`] = { vb, ib, count: g.indexCount, triangles: g.triangles, layout: { arrayStride: g.stride, attributes: g.attributes } };
    geoBytes += g.data.byteLength + g.index.byteLength;
  }
  // the records: one storage buffer, a slot range per species and level (firstInstance picks it)
  const slots = {}; let total = 0;
  for (const lod of [0, 1]) for (const n of NAMES) { slots[`${n}${lod}`] = total; total += sim.counts[n]; }
  const recData = new Float32Array(total * ISTRIDE);
  const recBuf = device.createBuffer({ label: 'bird-records', size: recData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const spc = speciesConsts();
  const spcBuf = device.createBuffer({ label: 'bird-species', size: spc.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(spcBuf, 0, spc);
  const shBuf = device.createBuffer({ label: 'bird-shadows', size: SHADOW_MAX * SSTRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  // the snag
  const S = sim.snag;
  const vbuf = (a, label) => { const b = device.createBuffer({ label, size: a.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, a); return b; };
  const snagPos = vbuf(S.pos, 'snag-pos'), snagNrm = vbuf(S.nrm, 'snag-nrm'), snagCol = vbuf(S.col, 'snag-col');
  let snagOn = false;
  const snagIdx = device.createBuffer({ label: 'snag-idx', size: S.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(snagIdx, 0, S.idx);

  const sb = (b, v) => ({ binding: b, visibility: v, buffer: { type: 'read-only-storage' } });
  const drawBGL = device.createBindGroupLayout({ label: 'birds-draw', entries: [sb(0, VX), sb(1, VX), { binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }] });
  const drawBG = device.createBindGroup({ layout: drawBGL, entries: [{ binding: 0, resource: { buffer: recBuf } }, { binding: 1, resource: { buffer: spcBuf } }, { binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
  const snagBGL = device.createBindGroupLayout({ label: 'birds-snag', entries: [{ binding: 2, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 3, visibility: FR, sampler: { type: 'comparison' } }, { binding: 4, visibility: FR, buffer: { type: 'uniform' } }] });
  const snagBG = device.createBindGroup({ layout: snagBGL, entries: [{ binding: 2, resource: shadow.view }, { binding: 3, resource: shadow.sampler }, { binding: 4, resource: { buffer: shadow.buffer } }] });
  const qBGL = device.createBindGroupLayout({ label: 'birds-shadow', entries: [sb(0, VX | FR)] });
  const qBG = device.createBindGroup({ layout: qBGL, entries: [{ binding: 0, resource: { buffer: shBuf } }] });
  const pl = (...g) => device.createPipelineLayout({ bindGroupLayouts: g });
  const layout0 = geo.osprey0.layout;   // every species shares the interleaved layout
  const depth = { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' };
  for (const far of [false, true]) {
    const m = reg.shader(`birds-${far ? 'far' : 'near'}`, BIRD_DRAW_WGSL(frameStruct, far));
    reg.add(`birds-${far ? 'far' : 'near'}`, { layout: pl(frameBGL, sky.skyBGL, drawBGL), vertex: { module: m, entryPoint: 'vs', buffers: [layout0] }, fragment: { module: m, entryPoint: 'fs', targets: [hdrTarget] },
      primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: depth, multisample: { count: msaa } });
  }
  const f3 = (loc) => ({ arrayStride: 12, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x3' }] });
  const mS = reg.shader('birds-snag', SNAG_DRAW_WGSL(frameStruct));
  reg.add('birds-snag', { layout: pl(frameBGL, sky.skyBGL, snagBGL), vertex: { module: mS, entryPoint: 'vs', buffers: [f3(0), f3(1), f3(2)] }, fragment: { module: mS, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: depth, multisample: { count: msaa } });
  const mQ = reg.shader('birds-shadow', SHADOW_DRAW_WGSL(frameStruct));
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
  reg.add('birds-shadow', { layout: pl(frameBGL, qBGL), vertex: { module: mQ, entryPoint: 'vs' }, fragment: { module: mQ, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });

  const stats = { draws: 0, birds: 0, triangles: 0, geoBytes, records: total, snagTriangles: S.triangles };
  const runs = [];   // this frame's draws: [key, first, n]
  let shadows = 0;
  return {
    stats,
    // the flock is made (its snag on the real ground): the snag's positions rewritten in place (the same topology)
    setSim(s) {
      if (s.snag.idx.length !== S.idx.length) throw new Error('snag topology');
      sim = s; device.queue.writeBuffer(snagPos, 0, s.snag.pos); snagOn = !s.tier?.only;   // the phone tier: no snag
    },
    // after the sim's update: the records into the one buffer (one writeBuffer), the shadows (one more when any)
    upload() {
      runs.length = 0; let hi = 0;
      for (const [lod, set] of [[0, sim.draw.near], [1, sim.draw.far]]) for (const n of NAMES) {
        const r = set[n]; if (!r.n) continue;
        const k = `${n}${lod}`, first = slots[k];
        recData.set(r.data.subarray(0, r.n * ISTRIDE), first * ISTRIDE);
        for (let i = 0; i < r.n; i++) recData[(first + i) * ISTRIDE + 22] = NAMES.indexOf(n);   // the species' constants
        runs.push([k, first, r.n, lod]); hi = Math.max(hi, (first + r.n) * ISTRIDE);
      }
      if (hi) device.queue.writeBuffer(recBuf, 0, recData, 0, hi);
      shadows = sim.draw.shadows.n;
      if (shadows) device.queue.writeBuffer(shBuf, 0, sim.draw.shadows.data, 0, shadows * SSTRIDE);
    },
    // opaque, in the scene pass with the frame group bound: the snag and the birds
    draw(pass, c) {
      pass.setBindGroup(1, sky.skyBG);
      pass.setBindGroup(2, snagBG);
      if (snagOn) {
        pass.setPipeline(reg.get('birds-snag')); pass.setVertexBuffer(0, snagPos); pass.setVertexBuffer(1, snagNrm); pass.setVertexBuffer(2, snagCol); pass.setIndexBuffer(snagIdx, 'uint32');
        pass.drawIndexed(S.idx.length); c.calls++; c.triangles += S.triangles;
      }
      if (!runs.length) { stats.draws = 1; stats.birds = 0; return; }
      pass.setBindGroup(2, drawBG);
      let lodNow = -1, nb = 0, tri = 0;
      for (const [k, first, n, lod] of runs) {
        if (lod !== lodNow) { pass.setPipeline(reg.get(lod ? 'birds-far' : 'birds-near')); lodNow = lod; }
        const g = geo[k];
        pass.setVertexBuffer(0, g.vb); pass.setIndexBuffer(g.ib, 'uint32');
        pass.drawIndexed(g.count, n, 0, 0, first); c.calls++; c.triangles += g.triangles * n; nb += n; tri += g.triangles * n;
      }
      stats.draws = runs.length + 1; stats.birds = nb; stats.triangles = tri;
    },
    // blended over the water (after it, before the sky): the low birds' shadows
    drawAfterWater(pass, c) {
      if (!shadows) return;
      pass.setBindGroup(1, qBG); pass.setPipeline(reg.get('birds-shadow')); pass.draw(6, shadows); c.calls++; c.triangles += 2 * shadows;
    },
  };
}

// The plug-in (v2/main.js's birds block): the GPU side declared at boot (its pipelines with the rest), the flock made once
// the terrain's heights are whole (v1 places the thermals, the snag and the raft on the full terrain), then each frame
// the sim on the scene clock, the records up, the calls into v1's bird sound (src/birds/sound.js) on a live page.
//   const birds = createBirds({ device, reg, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, tier });
//   birds.make({ terrain, waterAt, wind, boat, seed, start }); per frame birds.frame(t, eye, fwd, up, sun, shelter, beat, focalPx)
//   shelter 0–1: the storm's (v1's stormSystem: min(1, rain × 1.5)); the airborne birds leave for the shore in the rain
//   beat: the osprey's dive director's context (sim/birds.js DIVE; null: v1's hunt); focalPx: the splash's droplets
//   splash: the osprey's strike on the water (living/birds-splash.js: the droplets, the rings and the foam in the wake's
//   creature map); dive: the registry's ospreyDive (desktop only: off, no splash is made and nothing is paid); birds.runWater(pass, c)
//   in the water-sim pass
export function createBirds({ tier = 'high', sound = null, wake = null, dive = true, seed = 1, ...gpu }) {
  const T = BIRD_TIERS_REF[tier] ?? BIRD_TIERS_REF.high;
  const counts = { osprey: 3, eagle: 3, gull: T.gulls, goose: T.geese };
  // the snag's topology is the terrain's alone in its height: a flat stand-in sizes its buffers at boot
  const proto = { counts, snag: snagMeshRef({ terrain: { heightAt: () => 0 }, at: [0, 0] }), draw: null };
  const R = createBirdsRender({ ...gpu, sim: proto });
  const splash = dive ? createBirdSplash({ ...gpu, wake, seed }) : null;
  let sim = null, lastT = null;
  const listener = listenerCam();
  return {
    render: R, stats: R.stats, splash,
    get sim() { return sim; },
    make(o) { sim = createBirdSimRef({ tier, ...o }); R.setSim(sim); return sim; },
    frame(t, eye, fwd, up, sun, shelter = 0, beat = null, focalPx = 1000) {
      if (!sim) return;
      sim.setShelter(shelter);   // v1's world.js birds system: birds.setShelter(env.shelter) before the update
      sim.setDaylight(sun.elevDeg, [sun.x, sun.y, sun.z]);
      sim.update(t, eye, beat);
      R.upload();
      const dt = lastT == null ? 0 : Math.min(0.25, Math.max(0, t - lastT)); lastT = t;
      if (splash) { splash.step(dt, sim.events); splash.fill(focalPx); }
      if (sound && sim.events.length) sound.update(sim.events, listener.set(eye, fwd, up), t);
    },
    draw(pass, c) { if (sim) { R.draw(pass, c); splash?.draw(pass, c); } },
    runWater(pass, c) { if (sim) splash?.runWater(pass, c); },
    drawAfterWater(pass, c) { if (sim) R.drawAfterWater(pass, c); },
  };
}
