// The ground tackle seen close, on a desktop and a tablet (owner, 2026-11-18: "The anchor line is too thin to be noticed, and too
// simple, missing details. Do we have an anchor? ... These details are desktop only"; src/core/features.js anchorDetail). A phone
// keeps hardware.glb's anchor and the one dark line. What it draws, with ONE pipeline ('anchor-gear', instanced, the boat's own
// bind groups and lighting):
//   the anchor     a Delta-style plough (render/anchorGearMesh.js), galvanised with a little wear: on the roller, sliding over it and
//                  tipping down, hanging on its chain as it falls (seen through the clear water), on the bottom rolled on its side
//                  until it sets, then righted and dug in; up again the same way, dripping (the splash's drips)
//   the chain      10 mm short links along the catenary (v2/sim/anchorGear.js rodeShape: exact length, the roller and the shackle its
//                  ends), over the roller and aft along the deck to the gypsy; they run with the chain out (the rattle's own
//                  speed), jump a little on the roller while it runs, wet near the water; links only within GEAR.nearM of the eye,
//                  past it the boat's thick line (pose.rode handed the far part only)
//   the windlass   a manual vertical windlass on the foredeck where the chain goes below
// Under the water the gear is shaded through the water column as the lake bed is (Tahoe's attenuation down to it and back up to the
// surface; the water's blend then adds its reflection), so the anchor on the bottom reads softened by its depth.
//   const G = createAnchorGear({ device, reg, frameBGL, frameStruct, sky, boat, hdrTarget, msaa, depthFormat, dims })
//   each frame, after the sim and before boat.update:  G.update(B.pose, sea, { eye, t })   (pose.anchorShown = false; pose.rode: far part)
//   in the scene after boat.draw:                       G.draw(pass, c)
import { mat4, multiply } from '../engine/math.js';
import { BOAT_HEAD } from './boat.js';
import { GEAR, rodeShape, rodePath, gearPose, layLinks } from '../sim/anchorGear.js';
import { linkMesh, anchorMesh, windlassMesh } from './anchorGearMesh.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';

const GEAR_LOOK = Object.freeze({
  galv: [0.56, 0.57, 0.585], galvRough: 0.42, galvMetal: 0.75, black: [0.03, 0.03, 0.032], alloy: [0.62, 0.63, 0.65], alloyRough: 0.3,
  wetRough: 0.12, wetDark: 0.82,
  farLine: [0.085, 0.088, 0.092],   // linear: the chain's far line (render/boat.js rode), a galvanised grey in shade
});
// the hull-frame points the gear hangs on (the hero hull's hardware.json: the roller's axle 0.12 m to starboard; the windlass forward
// of the locker lid on the chain's line)
function gearPoints(HULL = DEFAULT_DIMS.HULL) {
  const R = HULL.anchorRoller ?? [0.12, 1.133, -4.492], pin = HULL.anchorPin ?? [0.12, 1.143, -3.962], x = R[0];
  return {
    pin, roller: [x, R[1] + 0.038, R[2] - 0.012],                       // the chain's line over the front roller's top
    deck: [[x, R[1] + 0.038, R[2] - 0.012], [x, R[1] + 0.006, R[2] + 0.34], [x, pin[1] - 0.03, pin[2] + 0.04]],   // over the aft roller, along the cheeks to the stowed chain
    windlass: [x, 1.044, -3.62],
  };
}

const GEAR_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${BOAT_HEAD(fs)}
const GALV = vec3f(${GEAR_LOOK.galv.join(', ')}); const BLACK = vec3f(${GEAR_LOOK.black.join(', ')}); const ALLOY = vec3f(${GEAR_LOOK.alloy.join(', ')});
struct GV { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f, @location(3) @interpolate(flat) tag: f32, @location(4) wet: f32, @location(5) @interpolate(flat) seed: f32 }
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) tag: f32, @location(3) i0: vec4f, @location(4) i1: vec4f, @location(5) i2: vec4f, @builtin(instance_index) ii: u32) -> GV {
  let X = i1.xyz; let Y = i2.xyz; let Z = cross(X, Y);
  let w = i0.xyz + (X * p.x + Y * p.y + Z * p.z) * i0.w;
  var o: GV; o.pos = F.viewProj * vec4f(w, 1.0); o.world = w; o.n = X * n.x + Y * n.y + Z * n.z; o.lp = p; o.tag = tag; o.wet = i1.w; o.seed = f32(ii);
  return o;
}
fn h3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453); }
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3f(1.0, 0.0, 0.0)), u.x), mix(h3(i + vec3f(0.0, 1.0, 0.0)), h3(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y),
             mix(mix(h3(i + vec3f(0.0, 0.0, 1.0)), h3(i + vec3f(1.0, 0.0, 1.0)), u.x), mix(h3(i + vec3f(0.0, 1.0, 1.0)), h3(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y), u.z);
}
@fragment fn fs(v: GV, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let V = normalize(F.cam.xyz - v.world);
  var n = normalize(v.n); if (!ff) { n = -n; }
  let s = normalize(F.sun.xyz);
  // the material: hot-dip galvanised (a spangle of crystals, duller worn patches, a rust bloom in the odd pit), black nylon, alloy
  var alb = GALV; var rough = ${GEAR_LOOK.galvRough}; var metal = 1.0;
  if (v.tag > 1.5) { alb = ALLOY; rough = ${GEAR_LOOK.alloyRough}; }
  else if (v.tag > 0.5) { alb = BLACK; rough = 0.55; metal = 0.0; }
  else {
    let sp = vnoise(v.lp * 160.0 + v.seed * 7.31) * 0.6 + vnoise(v.lp * 47.0 + 1.7) * 0.4;   // the spangle: a soft mottle of crystals
    let wear = smoothstep(0.55, 0.8, vnoise(v.lp * 14.0 + v.seed));  // dull grey wear
    let pit = smoothstep(0.88, 0.96, vnoise(v.lp * 55.0 + 3.1 + v.seed * 1.7));
    alb = alb * (0.94 + 0.1 * sp) * (1.0 - 0.16 * wear);
    alb = mix(alb, vec3f(0.36, 0.22, 0.13), pit * 0.5);
    rough = rough + 0.15 * wear - 0.08 * sp + 0.25 * pit;
    metal = ${GEAR_LOOK.galvMetal} - 0.4 * pit - 0.25 * wear;   // hot-dip zinc weathers to a dull matte grey: part mirror, part diffuse
  }
  // wet near the water and under it: a film of water (smoother, a little darker)
  let under = 1.0 - smoothstep(-0.02, 0.02, v.world.y);
  // above the water a wet film (smoother, a little darker); under it the zinc's dull grey (a wet sheen would mirror the dark
  // water and lose the anchor against the bed)
  let wet = v.wet * (1.0 - under);
  rough = mix(rough, ${GEAR_LOOK.wetRough}, wet); alb = alb * mix(1.0, ${GEAR_LOOK.wetDark}, wet);
  metal = mix(metal, metal * 0.5, under); rough = mix(rough, max(rough, 0.55), under);
  rough = clamp(rough, 0.06, 1.0);
  let nl = max(dot(n, s), 0.0);
  let eSun = sunPerp() * shadowAt(v.world, nl);
  let eSky = ambientAt(n);
  let f0 = mix(vec3f(0.04), alb, metal);
  let diff = alb * (1.0 - metal) / PI * (eSun * nl + eSky);
  var R = reflect(-V, n); R = normalize(vec3f(R.x, max(R.y, 0.02), R.z));
  let fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  let E = LIGHT.sun.rgb + LIGHT.sky.rgb;
  let column = WUP * E / PI * RINF;
  // in the air the sky's mirror; under the water the water's own light all round (no sky down there)
  let envAir = skyMirror(R) * (1.0 - 0.7 * rough);
  let envWater = column * PI * 0.5;
  let env = mix(envAir, envWater, under) * fres;
  let spec = ggxSpec(n, V, s, rough, f0) * eSun;
  var col = diff + env + spec;
  // the water column (the bed's optics): the light down to the point and the view up out of it
  let d = max(-v.world.y, 0.0);
  let path = d / max(V.y, 0.15);
  let Tl = exp(-WK * d); let Tv = exp(-WK * path);
  let uw = col * Tl * Tv + column * (vec3f(1.0) - Tv);
  col = mix(col, uw, under);
  var Tair = vec3f(1.0);
  let inS = aerialParts(v.pos.xy, v.world, &Tair);
  return vec4f(col * Tair + inS, 1.0);
}`;

export function createAnchorGear({ device, reg, frameStruct, boat, hdrTarget, msaa = 1, depthFormat = 'depth32float', dims = DEFAULT_DIMS, frameBGL, sky }) {
  const VB = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, IB = GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
  const upload = (label, arr, usage) => { const bytes = Math.max(16, Math.ceil(arr.byteLength / 4) * 4); const b = device.createBuffer({ label, size: bytes, usage }); const pad = arr.byteLength % 4 ? (() => { const p = new arr.constructor(bytes / arr.BYTES_PER_ELEMENT); p.set(arr); return p; })() : arr; device.queue.writeBuffer(b, 0, pad); return b; };
  const meshes = { link: linkMesh(), anchor: anchorMesh(), windlass: windlassMesh() };
  const G = {};
  for (const [k, m] of Object.entries(meshes)) G[k] = { pos: upload(`gear-${k}-pos`, m.position, VB), nrm: upload(`gear-${k}-nrm`, m.normal, VB), tag: upload(`gear-${k}-tag`, m.tag, VB), idx: upload(`gear-${k}-idx`, m.index, IB), fmt: m.index instanceof Uint32Array ? 'uint32' : 'uint16', count: m.index.length, tris: m.triangles };
  const MAXI = GEAR.maxLinks + 2, STRIDE_I = 48;
  const inst = new Float32Array(MAXI * 12);
  const ibuf = device.createBuffer({ label: 'gear-inst', size: inst.byteLength, usage: VB });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, boat.bgl] });
  const m = reg.shader('anchor-gear', GEAR_WGSL(frameStruct));
  const f3 = (loc) => ({ arrayStride: 12, attributes: [{ shaderLocation: loc, offset: 0, format: 'float32x3' }] });
  reg.add('anchor-gear', { layout,
    vertex: { module: m, entryPoint: 'vs', buffers: [f3(0), f3(1), { arrayStride: 4, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32' }] },
      { arrayStride: STRIDE_I, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }, { shaderLocation: 4, offset: 16, format: 'float32x4' }, { shaderLocation: 5, offset: 32, format: 'float32x4' }] }] },
    fragment: { module: m, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });

  const GP = gearPoints(dims.HULL);
  const T = { a: mat4(), b: mat4(), c: mat4(), d: mat4() }, Mroot = mat4();
  const wp = (M, p, o = [0, 0, 0]) => { o[0] = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12]; o[1] = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13]; o[2] = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14]; return o; };
  const wd = (M, d, o = [0, 0, 0]) => { o[0] = M[0] * d[0] + M[4] * d[1] + M[8] * d[2]; o[1] = M[1] * d[0] + M[5] * d[1] + M[9] * d[2]; o[2] = M[2] * d[0] + M[6] * d[1] + M[10] * d[2]; return o; };
  const roller = [0, 0, 0], deckW = GP.deck.map(() => [0, 0, 0]), farPts = Array.from({ length: 24 }, () => [0, 0, 0]), farOut = [];
  const gp = {}, q = [0, 0, 0];
  const stats = { links: 0, triangles: 0, where: 'roller', kind: 'none', far: 0, ms: 0 };
  let nLinks = 0, shown = false, drawOn = true;   // drawOn: the in-page A/B of its GPU cost (tools: window.__velia.anchorGear.drawOn = false)
  // an instance from an origin and two axes (unit, orthogonal)
  const put = (i, p, X, Y, wet = 0) => { const o = i * 12; inst[o] = p[0]; inst[o + 1] = p[1]; inst[o + 2] = p[2]; inst[o + 3] = 1; inst[o + 4] = X[0]; inst[o + 5] = X[1]; inst[o + 6] = X[2]; inst[o + 7] = wet; inst[o + 8] = Y[0]; inst[o + 9] = Y[1]; inst[o + 10] = Y[2]; inst[o + 11] = 0; };
  // Rodrigues: v rotated by angle a about unit axis k
  const rot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]; return [v[0] * c + (k[1] * v[2] - k[2] * v[1]) * s + k[0] * d * (1 - c), v[1] * c + (k[2] * v[0] - k[0] * v[2]) * s + k[1] * d * (1 - c), v[2] * c + (k[0] * v[1] - k[1] * v[0]) * s + k[2] * d * (1 - c)]; };

  function update(pose, sea, { eye = [0, 0, 0], t = 0 } = {}) {
    const c0 = globalThis.performance?.now?.() ?? 0;
    // Boat.update's root (render/boat.js): position · Ry(−heading) · Rx(pitch) · Rz(−heel)
    translate(T.a, pose.x, pose.heave ?? 0, pose.z); rotY(T.b, -pose.heading); multiply(T.c, T.a, T.b);
    rotX(T.a, pose.pitch ?? 0); multiply(T.d, T.c, T.a); rotZ(T.b, -(pose.heel ?? 0)); multiply(Mroot, T.d, T.b);
    wp(Mroot, GP.roller, roller);
    GP.deck.forEach((p, i) => wp(Mroot, p, deckW[i]));
    const tk = sea?.tackle, an = tk?.state?.anchor, anchored = tk?.mode === 'anchor' && an && an.phase !== 'stowed';
    const phase = anchored ? an.phase : 'stowed', out = anchored ? an.out : 0;
    const bottomY = -Math.max(0.5, an?.depth ?? 10);
    gearPose({ phase, out, roller, bottomY, anchorXZ: [an?.x ?? 0, an?.z ?? 0], heading: pose.heading, set: an ? Math.min(1, Math.max(an.set ?? 0, an.phase === 'held' && !an.dragging ? 1 : 0)) : 0, t }, gp);
    // the anchor's instance (slot MAXI − 2): its basis from where it is
    const AI = MAXI - 2, WI = MAXI - 1;
    if (gp.where === 'roller' || gp.where === 'slide') {
      // in the hull frame: from the stowed pin forward to the roller, pitching about the hull's x until the shank hangs down
      const k = gp.slide, th = -k * Math.PI / 2;
      const hp = [GP.pin[0], GP.pin[1] + (GP.roller[1] - GP.pin[1]) * k, GP.pin[2] + (GP.roller[2] - 0.03 - GP.pin[2]) * k];
      const Xh = [1, 0, 0], Yh = [0, Math.cos(th), Math.sin(th)];
      put(AI, wp(Mroot, hp), wd(Mroot, Xh), wd(Mroot, Yh));
    } else {
      const f = [Math.sin(gp.yaw), 0, -Math.cos(gp.yaw)], r = [Math.cos(gp.yaw), 0, Math.sin(gp.yaw)];
      let X = r, Y = [0, 1, 0];
      if (gp.where === 'hang') { X = rot(X, f, gp.swing); Y = rot(rot(Y, r, -Math.PI / 2 + gp.swing * 0.5), f, gp.swing); }
      else {   // on the bottom: nosed down a little, rolled about the shank until it sets, dug in by bury
        Y = rot(Y, r, -gp.down * 0.6); const axis = rot([-f[0], 0, -f[2]], r, -gp.down * 0.6);
        X = rot(X, axis, gp.roll); Y = rot(Y, axis, gp.roll);
      }
      put(AI, [gp.shackle[0], gp.shackle[1] - gp.bury, gp.shackle[2]], X, Y);
    }
    put(WI, wp(Mroot, GP.windlass), wd(Mroot, [1, 0, 0]), wd(Mroot, [0, 1, 0]));
    // the chain: its shape from the roller to the shackle, the links near the eye, the line past them
    nLinks = 0; pose.rode = null; farOut.length = 0;
    if (anchored && gp.where !== 'roller') {
      const sh = gp.where === 'bottom' ? [gp.shackle[0], gp.shackle[1] - gp.bury * 0.5, gp.shackle[2]] : gp.shackle;
      const dx = sh[0] - roller[0], dz = sh[2] - roller[2], X = Math.hypot(dx, dz), ux = X > 1e-6 ? dx / X : 0, uz = X > 1e-6 ? dz / X : 0;
      const hang = gp.where !== 'bottom';
      const L = hang ? Math.max(0.001, roller[1] - sh[1]) : out;
      const S = rodeShape({ h: Math.max(0.01, roller[1] - sh[1]), X: hang ? 0 : X, L });
      stats.kind = S.kind;
      const path = rodePath(S, roller, ux, uz, sh[1]);
      nLinks = layLinks({ L, path, deck: deckW, eye, out, chainMs: sea.chainMs ?? 0, t }, inst);
      // the far part as the boat's line: from where the links stop to the shackle
      let cut = 0;   // past the last sample near the eye (none near: the whole chain as the line)
      for (let i = 0; i <= 40; i++) { const s = L * i / 40; path(s, q); if (Math.hypot(q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]) <= GEAR.nearM - 0.2) cut = Math.min(L, s + L / 40); }
      if (L - cut > 0.2) {
        const s0 = Math.max(0, cut - 0.1);
        for (let i = 0; i < farPts.length; i++) path(s0 + (L - s0) * i / (farPts.length - 1), farPts[i]);
        for (const p of farPts) farOut.push(p);
        pose.rode = farOut;
      }
      stats.far = farOut.length;
    } else stats.kind = 'none';
    pose.anchorShown = false;   // the glb's anchor never: this one is drawn
    pose.rodeColor = GEAR_LOOK.farLine;   // the far part's line in the zinc's grey, not v1's near-black
    shown = true;
    stats.links = nLinks; stats.where = gp.where;
    stats.triangles = nLinks * G.link.tris + G.anchor.tris + G.windlass.tris;
    device.queue.writeBuffer(ibuf, 0, inst, 0, nLinks * 12);
    device.queue.writeBuffer(ibuf, AI * STRIDE_I, inst, AI * 12, 24);
    stats.ms = (globalThis.performance?.now?.() ?? 0) - c0;
  }
  function draw(pass, c) {
    if (!shown || !drawOn) return;
    const pipe = reg.get('anchor-gear');   // the caller gates on its group ('boatfx') being ready
    pass.setPipeline(pipe);
    pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, boat.bg, [0]);
    const one = (g, first, count) => { if (!count) return; pass.setVertexBuffer(0, g.pos); pass.setVertexBuffer(1, g.nrm); pass.setVertexBuffer(2, g.tag); pass.setVertexBuffer(3, ibuf, first * STRIDE_I); pass.setIndexBuffer(g.idx, g.fmt); pass.drawIndexed(g.count, count); c.calls++; c.triangles += g.tris * count; };
    one(G.link, 0, nLinks); one(G.anchor, MAXI - 2, 1); one(G.windlass, MAXI - 1, 1);
  }
  return { update, draw, stats, get drawOn() { return drawOn; }, set drawOn(v) { drawOn = !!v; }, meshes: { link: meshes.link.triangles, anchor: meshes.anchor.triangles, windlass: meshes.windlass.triangles } };
}

// the boat's own matrix helpers (render/boat.js keeps them local): column-major, as engine/math.js
function translate(o, x, y, z) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; o[12] = x; o[13] = y; o[14] = z; return o; }
function rotY(o, a) { const c = Math.cos(a), s = Math.sin(a); o.fill(0); o[0] = c; o[2] = -s; o[5] = 1; o[8] = s; o[10] = c; o[15] = 1; return o; }
function rotX(o, a) { const c = Math.cos(a), s = Math.sin(a); o.fill(0); o[0] = 1; o[5] = c; o[6] = s; o[9] = -s; o[10] = c; o[15] = 1; return o; }
function rotZ(o, a) { const c = Math.cos(a), s = Math.sin(a); o.fill(0); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; o[10] = 1; o[15] = 1; return o; }
