// The lake's buildings and the south shore's landmarks (Phase B of the South Lake birthplace; data: v2/towns/buildings.js,
// tools/v2-buildings-pack.mjs): OpenStreetMap's footprints as boxes with gables, the Stateline high-rises, the gondola's
// terminals, pylons, cables and cabins, the boats in the marina's slips. One mesh (a box with a ridge), one pipeline, ONE
// instanced draw a frame: the loaded sets' chunks within their range of the eye (4 km; the landmarks 16 km) and in the
// frustum are kept, their records' indices written to a list (only when the kept set changes), and the draw reads the
// instance through it. A compute pass grounds the kept boxes each frame on the terrain the page draws (the coarse levels, the
// south level once it is in: the terrain's own height function, render/terrain.js TERRAIN_HEIGHT; v2/towns/buildings.js
// groundBox is the CPU's twin). Lit as the piers are (render/towns.js SHORE_LIGHT_WGSL: the sun through the transmittance,
// the terrain's shadow, the sky's diffuse and reflection, the aerial perspective, the clouds in front); no texture: v1's
// earth-tone walls and roofs, the high-rises' facades, a window grid on the big boxes (dark glass by day; lit by a share of
// windows at night, the high-rises brightest). Desktop and tablet only (src/core/features.js buildings).
//
//   const BD = createBuildings({ device, reg, frameBGL, frameStruct, sky, shadow, terrain, hdrTarget, msaa, depthFormat, errors })
//   BD.load(['lake', 'south']) after the first frame (a capture: await BD.prime(sets)); BD.update(eye, viewProj) in fill();
//   BD.run(pass, c) in a compute pass (the grounding); BD.draw(pass, c) in the scene, opaque, after the towns
import { ATMO_WGSL, SKY_READ, AP_READ } from './sky.js';
import { TERRAIN_BIND, TERRAIN_HEIGHT } from './terrain.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { SHORE_LIGHT_WGSL } from './towns.js';
import { frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { inflate } from '../terrain/decode.js';
import { decodeBuildings, instanceArray, pickChunks, SETS, GROUND, KIND, MODE, INST_FLOATS } from '../towns/buildings.js';

export const BUILDING_FILES = Object.freeze(Object.fromEntries(Object.values(SETS).map((s) => [s.id, new URL(`../assets/towns/${s.file}`, import.meta.url)])));
// the look: the window grid (m), the panes' share of a cell, the glass, the night's radiance of a lit window (HDR, × the
// high-rises' gain), when it comes on (the sun's elevation, as sin)
export const LOOK = Object.freeze({ colM: 3.0, floorM: 3.2, pane: [0.16, 0.84, 0.28, 0.82], glass: 0x1d2328, glassTower: 0.8, winRad: 0.02, towerGain: 3.0, nightSin: [0.12, -0.04], rough: 0.85 });

// the unit mesh: a box x, z ∈ [−0.5, 0.5], y ∈ [0, 1] (the walls: part 0; their bow third, x > 0.15: part 3, which a hull
// pinches to a point), its flat top (part 2) and a gable over it, ridge along x (part 1: y 0 at the eaves, 1 at the ridge;
// flat when the roof is 0). Each vertex: x, y, z, part, the normal (a slope's is made in the vertex stage). Faces wound
// counter-clockwise from outside (checked here against the normal)
export function unitMesh() {
  const V = [], I = [];
  const face = (pts, n, part) => {
    const b = V.length / 8;
    for (const p of pts) V.push(p[0], p[1], p[2], part, n[0], n[1], n[2], 0);
    const tri = (a, c, d) => {
      const A = pts[a], C = pts[c], D = pts[d];
      const u = [C[0] - A[0], C[1] - A[1], C[2] - A[2]], w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
      const x = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const s = x[0] * n[0] + x[1] * n[1] + x[2] * n[2];
      if (s >= 0) I.push(b + a, b + c, b + d); else I.push(b + a, b + d, b + c);
    };
    tri(0, 1, 2); if (pts.length === 4) tri(0, 2, 3);
  };
  const X = 0.15;   // the bow third starts here
  for (const s of [-1, 1]) {
    face([[-0.5, 0, s * 0.5], [X, 0, s * 0.5], [X, 1, s * 0.5], [-0.5, 1, s * 0.5]], [0, 0, s], 0);
    face([[X, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 1, s * 0.5], [X, 1, s * 0.5]], [0, 0, s], 3);
    face([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0.5], [s * 0.5, 1, -0.5]], [s, 0, 0], s > 0 ? 3 : 0);
  }
  face([[-0.5, 1, -0.5], [X, 1, -0.5], [X, 1, 0.5], [-0.5, 1, 0.5]], [0, 1, 0], 2);
  face([[X, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [X, 1, 0.5]], [0, 1, 0], 2);
  for (const s of [-1, 1]) {
    face([[-0.5, 0, s * 0.5], [0.5, 0, s * 0.5], [0.5, 1, 0], [-0.5, 1, 0]], [0, 1, s], 1);   // a slope (its normal: the vertex stage's)
    face([[s * 0.5, 0, -0.5], [s * 0.5, 0, 0.5], [s * 0.5, 1, 0]], [s, 0, 0], 1);            // a gable end
  }
  return { V: new Float32Array(V), I: new Uint16Array(I) };
}

const hexLin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const v3 = (a) => `vec3f(${a.map((x) => x.toFixed(5)).join(', ')})`;
const INST_STRUCT = 'struct Inst { a: vec4f, b: vec4f, c: vec4f, d: vec4u }';

// the grounding: one thread a kept box; → G[k] = (base, top) for the box in slot k (groundBox's twin)
export const GROUND_WGSL = `${TERRAIN_BIND(0)}
${TERRAIN_HEIGHT}
${INST_STRUCT}
struct GP { n: u32, p1: u32, p2: u32, p3: u32 }
@group(1) @binding(0) var<storage, read> INST: array<Inst>;
@group(1) @binding(1) var<storage, read> IDX: array<u32>;
@group(1) @binding(2) var<storage, read_write> G: array<vec2f>;
@group(1) @binding(3) var<uniform> GPU_: GP;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x; if (k >= GPU_.n) { return; }
  let q = INST[IDX[k]];
  let mode = (u32(q.c.y) >> 4u) & 3u;
  if (mode == ${MODE.abs}u) { G[k] = vec2f(q.a.y, q.a.y + q.b.z); return; }
  if (mode == ${MODE.foot}u) { G[k] = vec2f(terrainHeight(q.a.x, q.a.z) - ${GROUND.footSink.toFixed(2)}, q.a.y); return; }
  let ca = cos(q.a.w); let sa = sin(q.a.w); let hl = q.b.x * 0.5; let hw = q.b.y * 0.5;
  var y0 = 1e9; var y1 = -1e9; var ym = 0.0;
  for (var c = 0; c < 4; c++) {
    let u = select(-1.0, 1.0, c == 1 || c == 2); let v = select(-1.0, 1.0, c >= 2);
    let y = terrainHeight(q.a.x + u * hl * ca + v * hw * sa, q.a.z - u * hl * sa + v * hw * ca);
    y0 = min(y0, y); y1 = max(y1, y); ym += 0.25 * y;
  }
  let base = max(y0, ym - ${GROUND.sinkMax.toFixed(2)}) - ${GROUND.under.toFixed(2)};
  G[k] = vec2f(base, ym + q.b.z + min(${GROUND.uphill.toFixed(2)}, max(0.0, y1 - ${GROUND.uphillFree.toFixed(2)} - ym)));
}`;

export const BUILDINGS_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
@group(2) @binding(0) var tShadowT: texture_depth_2d;
@group(2) @binding(1) var sShadowT: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(2) var<uniform> SH: Shadow;
${SHADOW_READ('tShadowT', 'sShadowT')}
${INST_STRUCT}
@group(3) @binding(0) var<storage, read> INST: array<Inst>;
@group(3) @binding(1) var<storage, read> IDX: array<u32>;
@group(3) @binding(2) var<storage, read> G: array<vec2f>;
fn srgbToLin(c: vec3f) -> vec3f { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
fn unpackRGB(w: u32) -> vec3f { return srgbToLin(vec3f(f32(w & 255u), f32((w >> 8u) & 255u), f32((w >> 16u) & 255u)) / 255.0); }
struct VI { @location(0) p: vec4f, @location(1) n: vec4f }
struct VO { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) alb: vec3f, @location(3) wl: vec2f, @location(4) @interpolate(flat) info: vec4f }
@vertex fn vs(v: VI, @builtin(instance_index) k: u32) -> VO {
  let q = INST[IDX[k]]; let g = G[k];
  let flags = u32(q.c.y); let kind = flags & 15u; let part = u32(v.p.w + 0.5);
  var lx = v.p.x; var lz = v.p.z; var ly: f32;
  let len = q.b.x; let wid = q.b.y; let roof = q.b.w; let base = g.x; let top = g.y;
  var nl = v.n.xyz;
  if (part == 1u) {
    ly = top + v.p.y * roof;
    if (v.n.y > 0.5) { nl = normalize(vec3f(0.0, 0.5 * wid, v.n.z * max(roof, 1e-3))); }   // a slope: (0, w/2, ±roof)
  } else { ly = mix(base, top, v.p.y); }
  if (kind == ${KIND.hull}u && lx > 0.15) {   // a hull's bow: the sides pinched to the stem
    lz *= 1.0 - (lx - 0.15) / 0.35;
    if (part == 3u && abs(v.n.z) > 0.5) { nl = normalize(vec3f(0.5 * wid, 0.0, v.n.z * 0.35 * len)); }
  }
  ly += q.c.x * lx;   // a cable span's rise (its shear)
  let ca = cos(q.a.w); let sa = sin(q.a.w);
  let px = lx * len; let pz = lz * wid;
  let w = vec3f(q.a.x + px * ca + pz * sa, ly, q.a.z - px * sa + pz * ca);
  let n = vec3f(nl.x * ca + nl.z * sa, nl.y, -nl.x * sa + nl.z * ca);
  var o: VO; o.pos = F.viewProj * vec4f(w, 1.0); o.world = w; o.n = n;
  let roofPart = part == 1u || part == 2u;
  o.alb = unpackRGB(select(q.d.x, q.d.y, roofPart));
  // the wall's own coordinates (m): along the face, over the base; the windows' grid reads them
  o.wl = vec2f(select(lz * wid, lx * len, abs(v.n.z) > 0.5), ly - base);
  let isWall = !roofPart && (kind == ${KIND.low}u || kind == ${KIND.high}u || kind == ${KIND.mid}u);
  o.info = vec4f(select(0.0, 1.0, isWall), f32(kind), q.c.z, f32(IDX[k] % 997u) + f32((flags >> 8u) & 15u) * 1000.0);
  return o;
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;
}
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
${SHORE_LIGHT_WGSL}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  var A = v.alb; var emit = vec3f(0.0);
  if (v.info.x > 0.5) {
    // the window grid: panes in each 3 m × 3.2 m cell, filtered to their mean as the cell shrinks under a few pixels
    let cell = vec2f(${LOOK.colM.toFixed(2)}, ${LOOK.floorM.toFixed(2)});
    let uv = v.wl / cell; let f = fract(uv); let id = floor(uv);
    let fw = max(fwidth(uv), vec2f(1e-4));
    let facade = floor(v.info.w / 1000.0);
    let paneA = ${((LOOK.pane[1] - LOOK.pane[0]) * (LOOK.pane[3] - LOOK.pane[2])).toFixed(4)};
    let share = select(paneA, ${LOOK.glassTower.toFixed(2)}, facade > 1.5 && facade < 2.5);
    let inX = smoothstep(${LOOK.pane[0].toFixed(2)} - fw.x, ${LOOK.pane[0].toFixed(2)} + fw.x, f.x) * (1.0 - smoothstep(${LOOK.pane[1].toFixed(2)} - fw.x, ${LOOK.pane[1].toFixed(2)} + fw.x, f.x));
    let inY = smoothstep(${LOOK.pane[2].toFixed(2)} - fw.y, ${LOOK.pane[2].toFixed(2)} + fw.y, f.y) * (1.0 - smoothstep(${LOOK.pane[3].toFixed(2)} - fw.y, ${LOOK.pane[3].toFixed(2)} + fw.y, f.y));
    let sharp = 1.0 - smoothstep(0.25, 0.6, max(fw.x, fw.y));
    let onWall = step(1.0, v.wl.y);
    let pane = mix(share, max(inX * inY, select(0.0, 0.6, share > 0.5)), sharp) * onWall;
    A = mix(A, ${v3(hexLin(LOOK.glass))}, pane);
    let night = smoothstep(${LOOK.nightSin[0].toFixed(3)}, ${LOOK.nightSin[1].toFixed(3)}, s.y);
    if (night > 0.0) {
      let litShare = v.info.z;
      let lit = mix(litShare, step(hash2(id + vec2f(v.info.w, 0.0)), litShare), sharp);
      let gain = select(1.0, ${LOOK.towerGain.toFixed(2)}, v.info.y > 1.5 && v.info.y < 2.5);
      emit = vec3f(1.0, 0.72, 0.45) * (${LOOK.winRad.toFixed(4)} * gain * night) * lit * pane;
    }
  }
  let nl = max(dot(n, s), 0.0);
  var shadow = 0.0; if (nl > 0.001) { shadow = shadowAt(p, nl); }
  let eSky = LIGHT.sky.rgb + nightLand();
  let eSun = sunAt(p.y, s) * nl * shadow;
  let E = eSun + (skyIrr(n) + eSky * (0.5 + 0.5 * n.y)) * SKY_K;
  let V = normalize(F.cam.xyz - p);
  let col = A * E / PI + shoreSpec(n, V, s, A, ${LOOK.rough.toFixed(2)}, 0.0, eSun) + emit;
  var out = aerial(col, v.pos.xy, p);
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, 1.0);
}`;

export function createBuildings({ device, reg, frameBGL, frameStruct, sky, shadow, terrain, hdrTarget, msaa = 1, depthFormat = 'depth32float', errors = [], fetchImpl = (u) => fetch(u) }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT, CP = GPUShaderStage.COMPUTE, BU = GPUBufferUsage;
  const mesh = unitMesh();
  const vbuf = device.createBuffer({ label: 'buildings-verts', size: mesh.V.byteLength, usage: BU.VERTEX | BU.COPY_DST }); device.queue.writeBuffer(vbuf, 0, mesh.V);
  const ibuf = device.createBuffer({ label: 'buildings-index', size: Math.ceil(mesh.I.byteLength / 4) * 4, usage: BU.INDEX | BU.COPY_DST });
  { const a = new Uint16Array(Math.ceil(mesh.I.length / 2) * 2); a.set(mesh.I); device.queue.writeBuffer(ibuf, 0, a); }
  const shBGL = device.createBindGroupLayout({ label: 'buildings-shadow', entries: [{ binding: 0, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 1, visibility: FR, sampler: { type: 'comparison' } }, { binding: 2, visibility: FR, buffer: { type: 'uniform' } }] });
  const shBG = device.createBindGroup({ label: 'buildings-shadow', layout: shBGL, entries: [{ binding: 0, resource: shadow.view }, { binding: 1, resource: shadow.sampler }, { binding: 2, resource: { buffer: shadow.buffer } }] });
  const dBGL = device.createBindGroupLayout({ label: 'buildings-draw', entries: [0, 1, 2].map((b) => ({ binding: b, visibility: VX, buffer: { type: 'read-only-storage' } })) });
  const gBGL = device.createBindGroupLayout({ label: 'buildings-ground', entries: [{ binding: 0, visibility: CP, buffer: { type: 'read-only-storage' } }, { binding: 1, visibility: CP, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: CP, buffer: { type: 'storage' } }, { binding: 3, visibility: CP, buffer: { type: 'uniform' } }] });
  const mod = reg.shader('buildings', BUILDINGS_WGSL(frameStruct));
  reg.add('buildings', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, shBGL, dBGL] }),
    vertex: { module: mod, entryPoint: 'vs', buffers: [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }] },
    fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  const gMod = reg.shader('buildings-ground', GROUND_WGSL);
  reg.add('buildings-ground', { layout: device.createPipelineLayout({ bindGroupLayouts: [terrain.hbgl, gBGL] }), compute: { module: gMod, entryPoint: 'main' } });
  const gpU = device.createBuffer({ label: 'buildings-ground-u', size: 16, usage: BU.UNIFORM | BU.COPY_DST });
  const gpA = new Uint32Array(4);

  const stats = { sets: [], records: 0, bytes: 0, drawn: 0, chunks: 0, draws: 0, repicks: 0, ready: false, loadMs: null, errors: 0 };
  const loaded = new Map();   // set id → { D, first }
  let all = [], instBuf = null, idxBuf = null, gBuf = null, dBG = null, gBG = null, cap = 0, n = 0;
  const kept = [], prevKept = [], planes = new Float64Array(20);
  let idxArr = new Uint32Array(0), dirty = true, on = true;
  const t0 = performance.now();
  // the loaded sets as one list (lake first, then south): the GPU's records, the chunks with their records' global offsets
  function rebuild() {
    const order = Object.keys(SETS).filter((id) => loaded.has(id));
    let total = 0; for (const id of order) total += loaded.get(id).D.count;
    const inst = new Uint8Array(total * INST_FLOATS * 4);
    all = [];
    let first = 0;
    for (const id of order) {
      const { D } = loaded.get(id);
      inst.set(instanceArray(D, first), first * INST_FLOATS * 4);
      for (const c of D.chunks) all.push({ ...c, first: c.first + first });
      first += D.count;
    }
    cap = Math.max(1, total);
    instBuf?.destroy(); idxBuf?.destroy(); gBuf?.destroy();
    instBuf = device.createBuffer({ label: 'buildings-inst', size: Math.max(64, inst.byteLength), usage: BU.STORAGE | BU.COPY_DST }); device.queue.writeBuffer(instBuf, 0, inst);
    idxBuf = device.createBuffer({ label: 'buildings-idx', size: cap * 4, usage: BU.STORAGE | BU.COPY_DST });
    gBuf = device.createBuffer({ label: 'buildings-ground', size: cap * 8, usage: BU.STORAGE | BU.COPY_SRC });   // COPY_SRC: readGround
    idxArr = new Uint32Array(cap);
    dBG = device.createBindGroup({ label: 'buildings-draw', layout: dBGL, entries: [{ binding: 0, resource: { buffer: instBuf } }, { binding: 1, resource: { buffer: idxBuf } }, { binding: 2, resource: { buffer: gBuf } }] });
    gBG = device.createBindGroup({ label: 'buildings-ground', layout: gBGL, entries: [{ binding: 0, resource: { buffer: instBuf } }, { binding: 1, resource: { buffer: idxBuf } }, { binding: 2, resource: { buffer: gBuf } }, { binding: 3, resource: { buffer: gpU } }] });
    stats.records = total; stats.sets = order; stats.ready = true; dirty = true; n = 0;
  }
  const loads = new Map();
  async function fetchSet(id) {
    const r = await fetchImpl(BUILDING_FILES[id].href); if (!r.ok) throw new Error(`buildings: ${r.status} ${id}`);
    const b = new Uint8Array(await r.arrayBuffer()); stats.bytes += b.length;
    // a host (Vite's dev server among them) may send the .gz with Content-Encoding gzip: the browser inflated it already
    return decodeBuildings(b[0] === 0x1f && b[1] === 0x8b ? await inflate(b) : b);
  }
  function load(ids) {
    return Promise.all(ids.filter((id) => SETS[id]).map((id) => {
      if (!loads.has(id)) loads.set(id, fetchSet(id).then((D) => { loaded.set(id, { D }); rebuild(); stats.loadMs = +(performance.now() - t0).toFixed(1); })
        .catch((e) => { stats.errors++; errors.push(`buildings: ${e?.message ?? e}`); }));
      return loads.get(id);
    }));
  }
  return {
    stats, get loaded() { return [...loaded.keys()]; },
    load, prime: (ids) => load(ids),
    setOn(v) { on = !!v; },
    // the records of a set (the tests, the probes): its decoded file
    set(id) { return loaded.get(id)?.D ?? null; },
    update(eye, viewProj) {
      if (!stats.ready || !on) { stats.drawn = 0; stats.draws = 0; return; }
      frustumPlanes(viewProj, planes);
      pickChunks(all, eye, planes, boxInFrustum, kept);
      let same = !dirty && kept.length === prevKept.length;
      for (let i = 0; same && i < kept.length; i++) same = kept[i] === prevKept[i];
      if (!same) {
        n = 0;
        for (const j of kept) { const c = all[j]; for (let i = 0; i < c.count; i++) idxArr[n++] = c.first + i; }
        if (n) device.queue.writeBuffer(idxBuf, 0, idxArr, 0, n);
        prevKept.length = 0; prevKept.push(...kept); dirty = false; stats.repicks++;
      }
      stats.drawn = n; stats.chunks = kept.length; stats.draws = n ? 1 : 0;
    },
    // the grounding of this frame's kept boxes (a compute pass with the terrain's heights)
    run(pass, c) {
      if (!n || !on || !terrain.heightsBindGroup) return;
      gpA[0] = n; device.queue.writeBuffer(gpU, 0, gpA);
      pass.setPipeline(reg.get('buildings-ground')); pass.setBindGroup(0, terrain.heightsBindGroup); pass.setBindGroup(1, gBG);
      pass.dispatchWorkgroups(Math.ceil(n / 64)); c.dispatches++;
    },
    draw(pass, c) {
      if (!n || !on) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, shBG); pass.setBindGroup(3, dBG);
      pass.setPipeline(reg.get('buildings')); pass.setVertexBuffer(0, vbuf); pass.setIndexBuffer(ibuf, 'uint16');
      pass.drawIndexed(mesh.I.length, n); c.calls++; c.triangles += n * mesh.I.length / 3;
    },
    // the ground the GPU gave the kept boxes (allocates: the page test's, not a frame's): [{ i, base, top }]
    async readGround() {
      if (!n) return [];
      const rb = device.createBuffer({ size: n * 8, usage: BU.MAP_READ | BU.COPY_DST });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(gBuf, 0, rb, 0, n * 8); device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ); const g = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      return Array.from({ length: n }, (_, k) => ({ i: idxArr[k], base: g[2 * k], top: g[2 * k + 1] }));
    },
    // a global record index → its set and decoded record
    rec(i) { for (const id of Object.keys(SETS)) { const L = loaded.get(id); if (!L) continue; if (i < L.D.count) return { set: id, ...L.D.rec(i) }; i -= L.D.count; } return null; },
  };
}
