// The towns for v2 (10a, trimmed by the owner 2026-11-13: "trim towns and add the pier"): what Sail sees from Emerald
// Bay and its mouth. Data: v2/assets/towns/ (tools/v2-towns-pack.mjs from v1's own layouts; v2/towns/format.js).
//   The shore: v1's piers on pilings and the boathouses over their ends (src/shoreline.js), the disused light tower, the
//     harbour's static mesh and its breakwater's rocks (src/harbour.js), and round the lake the towns' pier decks and
//     breakwaters (src/towns.js): six meshes, instanced (a 3 × 4 affine and an sRGB tint each), one pipeline, a few draws
//     a frame (each mesh's instances sit in 1 km chunks; a chunk in the frustum and the mesh's range draws, neighbours
//     merged). Lit as the boulders are (the sun through the transmittance LUT, the terrain's shadow, the sky, the night's
//     land light, the aerial perspective, the clouds in front); under the waterline seen through the water column with
//     the bed's numbers, so the pilings and the breakwaters' toes go down into Tahoe's clear water as v1's do.
//   The ground's marks (the ski runs, Hwy 89's asphalt and its cut): one storage buffer the terrain's paint and the
//     forest's keep-out read (v2/towns/wgsl.js); bound when whole (render/terrain.js attach, render/forest.js setTowns).
//   Streamed after the first frame (a capture: before it); the mask uploads ≤ 1 MB a frame, never beside a terrain slice.
//   #41b: v1's material (MeshStandardMaterial: its roughness per instance, the sun's lobe, the sky's diffuse and reflection)
//   #41c: the shore in the water's mirror: its own analytic map (MIRROR), one dispatch in the aerial pass, read by the water
// Buildings wait for Sail to reach the open lake (the night lights already show the towns).
//
//   const T = createTowns({ device, reg, graph, frameBGL, frameStruct, sky, shadow, hdrTarget, msaa, depthFormat, terrain, forest, phone, far, errors })
//   far false (a phone): TOWN_FILES_BAY, no ski runs and no far towns' decks (165 KB less on the wire, 3.8 MB less mask on the GPU)
//   T.load() after the first frame; await T.prime() in a capture; T.update(eye, viewProj) in fill(); T.draw(pass, c);
//   T.runMirror(pass, c) in the aerial pass (createShoreMirrorTarget's buffer: made before the water, passed as mirror)
import { ATMO_WGSL, SKY_READ, AP_READ, TRANS_READ, NIGHT_SKY_WGSL, STORM_FOG_WGSL } from './sky.js';
import { WATER_WGSL, TERRAIN_BIND, TERRAIN_HEIGHT } from './terrain.js';
import { MIRROR_HAZE_M } from './water-aa.js';
import { SHADOW_STRUCT, SHADOW_READ } from './shadow-read.js';
import { frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { decodeShore, MESH, CHUNK } from '../towns/format.js';
import { inflate } from '../terrain/decode.js';

export const TOWN_FILES = Object.freeze({ shore: new URL('../assets/towns/shore.vsh.gz', import.meta.url), mask: new URL('../assets/towns/mask.vtm.gz', import.meta.url) });
// the phone's set (far: false; the registry's farTowns row): the bay's instances, Hwy 89 without the ski runs
export const TOWN_FILES_BAY = Object.freeze({ shore: new URL('../assets/towns/shore-phone.vsh.gz', import.meta.url), mask: new URL('../assets/towns/mask-phone.vtm.gz', import.meta.url) });
// how far each mesh draws (m): the desktop set, the phone set
export const RANGE = Object.freeze({
  desktop: { [MESH.box]: 16000, [MESH.pile]: 1500, [MESH.roof]: 9000, [MESH.tower]: 9000, [MESH.harbour]: 25000, [MESH.rock]: 5000 },
  phone: { [MESH.box]: 9000, [MESH.pile]: 700, [MESH.roof]: 5000, [MESH.tower]: 5000, [MESH.harbour]: 12000, [MESH.rock]: 2000 },
});
export const UPLOAD_BYTES = 1 << 20;
// the shore's light against v1's look (#41b, a local match, as the rocks' TONES and the sail's CLOTH_AMB). v1 lights its
// shore with three's MeshStandardMaterial under the atmosphere's light (the sun, the sky's irradiance) and the sky's
// environment map (its diffuse and its reflection). v2 does the same terms on its own sky LUT, scaled to v1's: measured
// on v1 by switching terms (the walls and roofs black, their reflection alone reads 1,9,26 and 153,146,142 at the pier
// pose, 13:00; v2's GGX on the LUT gives 3,4,7 and 109,105,101), fitted at that pose (walls v1 35,43,52, roof
// 170,169,163) and a second (the boathouse from the north-west at 1.5 m, its wall v1 87,73,72): the sky's diffuse × 1.5,
// its reflection × 2, the sun's lobe × 2. Replaces 2026-11-13's lift (the sky × 1.6 and a warm bounce of 0.18, which
// read the walls brown where v1's are a sky-lit blue grey). Toward dusk v2's camera exposes up to 2× v1's (engine/
// exposure.js vs v1's flat exposure above the sun's 8.5°), so a sky-lit wall reads lighter than v1's there
export const LOOK = Object.freeze({ sky: 1.5, env: 2.0, sheen: 2.0 });
const STRIDE_V = 20, STRIDE_I = 52;

// v1's shore material (#41b), shared by the draw and the water's mirror of the shore (#41c): needs skyRadiance(d) and PI
export const SHORE_LIGHT_WGSL = `const SKY_K = ${LOOK.sky.toFixed(3)}; const ENV_K = ${LOOK.env.toFixed(3)}; const SHEEN_K = ${LOOK.sheen.toFixed(3)};
// three's DFGApprox (the split sum's scale and bias), its GGX (D_GGX, V_GGX_SmithCorrelated, Schlick), roughness ≥ 0.0525
fn dfgApprox(rough: f32, nv: f32) -> vec2f {
  let r = rough * vec4f(-1.0, -0.0275, -0.572, 0.022) + vec4f(1.0, 0.0425, 1.04, -0.04);
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}
// the sky as v1's environment map sees it along d; a ray under the horizon reads the horizon's haze (v1's sky cube there
// is the air between the camera and the ground: bright near the horizon at the lake's altitude)
fn envAt(d: vec3f) -> vec3f { let u = normalize(d); return skyRadiance(normalize(vec3f(u.x, max(u.y, 0.03), u.z))); }
// the sky's radiance over a rough lobe round the reflected ray (v1's prefiltered sky cube): five taps on a cone that
// opens with the roughness
fn skyLobe(Rd: vec3f, rough: f32) -> vec3f {
  let a = normalize(select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(Rd.y) > 0.9));
  let t1 = normalize(cross(Rd, a)); let t2 = cross(Rd, t1);
  let k = rough * rough * 0.9;
  return 0.4 * envAt(Rd) + 0.15 * (envAt(Rd + t1 * k) + envAt(Rd - t1 * k) + envAt(Rd + t2 * k) + envAt(Rd - t2 * k));
}
// the sky's irradiance on a face (v1's image-based diffuse, its sky cube): π × a cosine-weighted mean of five taps, the
// normal and a ring 45° off it
fn skyIrr(n: vec3f) -> vec3f {
  let a = normalize(select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9));
  let t1 = normalize(cross(n, a)); let t2 = cross(n, t1);
  return PI * 0.2 * (envAt(n) + envAt(n + t1) + envAt(n - t1) + envAt(n + t2) + envAt(n - t2));
}
fn shoreSpec(n: vec3f, V: vec3f, s: vec3f, A: vec3f, roughIn: f32, metal: f32, eSun: vec3f) -> vec3f {
  let rough = clamp(roughIn, 0.0525, 1.0);
  let F0 = mix(vec3f(0.04), A, metal);
  let nv = clamp(dot(n, V), 1e-4, 1.0);
  // the sun (eSun: its irradiance on the face, shadowed)
  let H = normalize(V + s); let nh = clamp(dot(n, H), 0.0, 1.0); let vh = clamp(dot(V, H), 0.0, 1.0); let nl = clamp(dot(n, s), 0.0, 1.0);
  let a2 = pow(rough, 4.0);
  let dd = nh * nh * (a2 - 1.0) + 1.0; let D = a2 / (PI * dd * dd);
  let Vis = 0.5 / max(nl * sqrt(a2 + (1.0 - a2) * nv * nv) + nv * sqrt(a2 + (1.0 - a2) * nl * nl), 1e-6);
  let Fs = F0 + (1.0 - F0) * exp2((-5.55473 * vh - 6.98316) * vh);
  // the sky: the reflected ray bent toward the normal by the roughness (three's getIBLRadiance)
  let Rd = normalize(mix(reflect(-V, n), n, rough * rough));
  let ab = dfgApprox(rough, nv);
  return eSun * SHEEN_K * Fs * (Vis * D) + skyLobe(Rd, rough) * ENV_K * (F0 * ab.x + ab.y);
}
`;

export const SHORE_DRAW_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${AP_READ}
@group(2) @binding(0) var tShadowT: texture_depth_2d;
@group(2) @binding(1) var sShadowT: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(2) var<uniform> SH: Shadow;
${WATER_WGSL}
${SHADOW_READ('tShadowT', 'sShadowT')}
fn srgbToLin(c: vec3f) -> vec3f { return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878); }
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) c: vec4f, @location(3) a: vec4f, @location(4) b: vec4f, @location(5) d: vec4f, @location(6) tint: vec4f }
struct VO { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) n: vec3f, @location(2) alb: vec3f, @location(3) mat: vec2f }
// #41b: v1's material (format.js matByte): the instance's byte, or (0) the vertex's roughness; → (roughness, metalness)
fn matOf(inst: f32, vert: f32) -> vec2f {
  let b = u32(round(inst * 255.0));
  if (b == 0u) { return vec2f(vert, 0.0); }
  return vec2f(f32(b & 127u) / 100.0, select(0.0, 0.1, b >= 128u));
}
@vertex fn vs(v: VI) -> VO {
  let X = v.a.xyz; let Y = vec3f(v.a.w, v.b.x, v.b.y); let Z = vec3f(v.b.z, v.b.w, v.d.x); let O = v.d.yzw;
  let w = O + X * v.p.x + Y * v.p.y + Z * v.p.z;
  // the normal through the cofactor matrix (the inverse transpose up to a positive scale): right under any scale
  let n = cross(Y, Z) * v.n.x + cross(Z, X) * v.n.y + cross(X, Y) * v.n.z;
  var o: VO; o.pos = F.viewProj * vec4f(w, 1.0); o.world = w; o.n = n; o.alb = srgbToLin(v.c.rgb) * srgbToLin(v.tint.rgb); o.mat = matOf(v.tint.a, v.c.a); return o;
}
fn sunAt(h: f32, s: vec3f) -> vec3f {
  let r = Rg + F.sky.z + h * 0.001 - F.cam.y * 0.001;
  return F.sky.x * transAt(r, s.y) * step(0.0, raySphere(vec3f(0.0, r, 0.0), s, Rg) * -1.0) * F.storm.y;   // × the storm cell's shade (1 fair): the land under the deck, as the water and the boat (v1's sunShade)
}
${SHORE_LIGHT_WGSL}
@fragment fn fs(v: VO) -> @location(0) vec4f {
  let p = v.world; let n = normalize(v.n); let s = normalize(F.sun.xyz);
  let A = v.alb;
  let nl = max(dot(n, s), 0.0);
  var shadow = 0.0; if (nl > 0.001) { shadow = shadowAt(p, nl); }
  let eSky = LIGHT.sky.rgb + nightLand();
  var col: vec3f;
  if (p.y < 0.0) {
    // under the surface: the water column over the face, as the bed's and the boulders' (no seam at the waterline)
    let dep = -p.y;
    let V = normalize(F.cam.xyz - p);
    let sinT = sqrt(max(1.0 - V.y * V.y, 0.0)) / NW; let cosT = sqrt(max(1.0 - sinT * sinT, 0.0));
    let sinS = sqrt(max(1.0 - s.y * s.y, 0.0)) / NW; let cosS = sqrt(max(1.0 - sinS * sinS, 0.0));
    let T = exp(-WK * (dep / max(cosT, 0.05) + dep / max(cosS, 0.1)));
    let E = 0.98 * (LIGHT.sun.rgb * shadow + eSky);
    let lit = A * (0.35 + 0.65 * (0.75 * nl + 0.25 * (0.5 + 0.5 * n.y)));
    col = WUP * E / PI * (lit * T + RINF * (1.0 - T));
  } else {
    // #41b: v1's light (LOOK): the sun; the sky's image-based diffuse (v1's environment map) and the atmosphere light's
    // sky irradiance on the face ((1 + n·up) / 2 of the level ground's, as v1's AtmosphereLight); no bounce (v1 has
    // none: the warm bounce of 2026-11-13 read the walls brown where v1's are a sky-lit blue grey). Then v1's
    // MeshStandardMaterial's reflection: the sun's GGX lobe and the sky through the split sum, F0 0.04 (metalness 0.1 on
    // the towns' decks), with v1's roughness per instance (the pack's material byte)
    let eSun = sunAt(p.y, s) * nl * shadow;
    let E = eSun + (skyIrr(n) + eSky * (0.5 + 0.5 * n.y)) * SKY_K;
    let V = normalize(F.cam.xyz - p);
    col = A * (1.0 - v.mat.y) * E / PI + shoreSpec(n, V, s, A, v.mat.x, v.mat.y, eSun);
  }
  var out = aerial(col, v.pos.xy, p);
  let toP = p - F.cam.xyz; let dist = length(toP);
  if (dist * 0.001 > cloudDistKm(toP / max(dist, 1e-3))) { let k = cloudAt(toP / max(dist, 1e-3)); out = out * k.a + k.rgb; }
  return vec4f(out, 1.0);
}`;

// #41: the shore into the terrain's sun shadow map (render/shadow.js casters): depth only, from the light's box. The
// decks, the boathouses' walls and roofs, the light tower and the harbour cast; the pilings (0.25 m) and the
// breakwater's rocks (≈ 1 m: they would shadow themselves in a 2.4 m texel, as the boulders) do not
export const SHORE_SHADOW_WGSL = (fs) => `${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${SHADOW_STRUCT}
@group(1) @binding(0) var<uniform> SH: Shadow;
@vertex fn vs(@location(0) p: vec3f, @location(3) a: vec4f, @location(4) b: vec4f, @location(5) d: vec4f) -> @builtin(position) vec4f {
  let X = a.xyz; let Y = vec3f(a.w, b.x, b.y); let Z = vec3f(b.z, b.w, d.x); let O = d.yzw;
  return SH.vp * vec4f(O + X * p.x + Y * p.y + Z * p.z, 1.0);
}`;
export const SHADOW_MESHES = Object.freeze([MESH.box, MESH.roof, MESH.tower, MESH.harbour]);

// the decoded shore → the GPU's arrays (pure: the tests read them): one interleaved vertex array (pos f32 × 3, normal
// snorm8 × 4, colour unorm8 × 4), one u16 index array, the instances (12 f32 + 4 u8), the meshes' ranges and their chunks
export function shoreArrays(S) {
  let nv = 0, ni = 0; for (const m of S.meshes) { nv += m.verts; ni += m.idx ? m.idx.length : 0; }
  const V = new ArrayBuffer(nv * STRIDE_V), Vf = new Float32Array(V), Vb = new Uint8Array(V);
  const I = new Uint16Array(Math.ceil(ni / 2) * 2);
  const ranges = [];
  let v0 = 0, i0 = 0;
  for (const m of S.meshes) {
    for (let k = 0; k < m.verts; k++) {
      const o = (v0 + k) * STRIDE_V;
      Vf[o / 4] = m.pos[3 * k]; Vf[o / 4 + 1] = m.pos[3 * k + 1]; Vf[o / 4 + 2] = m.pos[3 * k + 2];
      for (let c = 0; c < 4; c++) { Vb[o + 12 + c] = m.nrm[4 * k + c] & 255; Vb[o + 16 + c] = m.col[4 * k + c]; }
    }
    if (m.idx) I.set(m.idx, i0);
    // the box of the mesh's vertices: its reach from an instance's origin, scaled by the instance's axes
    const reach = Math.max(...m.lo.map(Math.abs), ...m.hi.map(Math.abs)) * Math.sqrt(3);
    ranges.push({ baseVertex: v0, verts: m.verts, firstIndex: i0, indices: m.idx ? m.idx.length : 0, first: m.first, count: m.count, reach });
    v0 += m.verts; i0 += m.idx ? m.idx.length : 0;
  }
  const inst = new ArrayBuffer(S.instances * STRIDE_I), If = new Float32Array(inst), Ib = new Uint8Array(inst);
  for (let i = 0; i < S.instances; i++) {
    for (let c = 0; c < 12; c++) If[i * 13 + c] = S.mats[i * 12 + c];
    for (let c = 0; c < 4; c++) Ib[i * STRIDE_I + 48 + c] = S.tints[i * 4 + c];   // the tint and the material byte (#41b)
  }
  // the chunks: each mesh's runs of instances in one 1 km cell (the pack sorted them), with their box
  const chunks = ranges.map((r) => {
    const out = [];
    for (let i = r.first; i < r.first + r.count; i++) {
      const m = S.mats.subarray(i * 12, i * 12 + 12), ox = m[9], oy = m[10], oz = m[11];
      const s = r.reach * Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[3], m[4], m[5]), Math.hypot(m[6], m[7], m[8]));
      const key = Math.floor(oz / CHUNK) * 100000 + Math.floor(ox / CHUNK);
      let c = out[out.length - 1];
      if (!c || c.key !== key) { c = { key, first: i, count: 0, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] }; out.push(c); }
      c.count++;
      const b = c.box; b[0] = Math.min(b[0], ox - s); b[1] = Math.min(b[1], oy - s); b[2] = Math.min(b[2], oz - s); b[3] = Math.max(b[3], ox + s); b[4] = Math.max(b[4], oy + s); b[5] = Math.max(b[5], oz + s);
    }
    return out;
  });
  return { V: new Uint8Array(V), I, inst: new Uint8Array(inst), ranges, chunks };
}

// the draws for a camera (pure): per mesh the chunks in its range and the frustum, consecutive ones merged → [mesh, first, count]
export function pickDraws(arr, eye, planes, range, out = []) {
  out.length = 0;
  arr.chunks.forEach((list, mesh) => {
    const R = range[mesh] ?? 0;
    let run = null;
    for (const c of list) {
      const b = c.box;
      const dx = Math.max(b[0] - eye[0], 0, eye[0] - b[3]), dz = Math.max(b[2] - eye[2], 0, eye[2] - b[5]);
      const ok = Math.hypot(dx, dz) < R && (!planes || boxInFrustum(planes, b[0], b[1], b[2], b[3], b[4], b[5]));
      if (ok && run && run[1] + run[2] === c.first) run[2] += c.count;
      else if (ok) { run = [mesh, c.first, c.count]; out.push(run); }
      else run = null;
    }
  });
  return out;
}

// ---- #41c: the shore in the water's mirror ----
// The land's mirror (render/terrain.js REFLECT: 256 azimuths × 16 bins) is too coarse for a 1.4 m deck. The shore gets a
// mirror of its own, made the same way (a flat mirror shows the scene from the camera's mirror point under the surface,
// so one map in azimuth × elevation from that point is exact for calm water at every distance; the waves only blur it
// through the lifted ray) but finer, and analytic: the shore as boxes and gables (v1's decks, walls, doors, roofs,
// pilings, the light tower, the harbour's parts), and per texel 4 rays cast against the boxes the column can see. Each
// box covers its texel by its share of the texel's azimuth (an edge fades as the camera moves, never flips a texel) and
// by its share of 4 elevations: the reflection is soft and steady. Lit as the draw (SHORE_LIGHT_WGSL), hazed as the
// land's mirror. The map is a storage buffer (the water's fragment stage already binds the 16 sampled textures WebGPU
// allows); its column heads say how high each column's content goes, so the water reads it only there.
//   MIRROR.az × bins, sqrt-packed toward the horizon up to maxDeg; maxProxies nearest the camera, re-picked every
//   repackM of travel; cand: the boxes one column keeps; sub: the elevation rays a texel
export const MIRROR = Object.freeze({ az: 1024, bins: 128, maxDeg: 60, maxProxies: 256, repackM: 20, cand: 32, sub: 4, range: 2500, pileRange: 300, spread: 0.35, damp: 0.12 });
export const MIRROR_HEAD = 1 + MIRROR.az;   // u32 words: [0] the proxies' count (0: the water skips the read), [1 + x] column x's top bin + 1
export const MIRROR_WORDS = MIRROR_HEAD + MIRROR.az * MIRROR.bins * 2;   // then two words a texel (rgba16f, premultiplied), row-major by bin
const PROXY_F = 16;   // floats a proxy: centre xyz, kind (0 box, 1 gable: base at y), half extents xyz (a gable: its full height in y), reach,
                      // linear albedo rgb, roughness, the local x axis (x, z), metalness, the range it shows to
const lin = (b) => { const c = b / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

// every shore piece as a mirror proxy (pure: the tests read it): the instances of the box, pile and roof meshes, the
// tower as its shaft and its lantern, and the harbour's static mesh split into its parts (its boxes merged by v1; each
// part's box along its own walls, its mean colour)
export function mirrorProxies(S) {
  const out = [];
  const push = (cx, cy, cz, kind, hx, hy, hz, rgb, rough, ax, az, metal, range) => out.push(cx, cy, cz, kind, hx, hy, hz, Math.hypot(hx, hz), rgb[0], rgb[1], rgb[2], rough, ax, az, metal, range);
  const tintOf = (i) => [lin(S.tints[i * 4]), lin(S.tints[i * 4 + 1]), lin(S.tints[i * 4 + 2])];
  const matOfB = (b) => (b ? { rough: (b & 127) / 100, metal: b & 128 ? 0.1 : 0 } : { rough: 0.9, metal: 0 });
  const each = (mesh, fn) => { const m = S.meshes[mesh]; for (let i = m.first; i < m.first + m.count; i++) fn(i, S.mats.subarray(i * 12, i * 12 + 12)); };
  const axis = (M) => { const l = Math.hypot(M[0], M[2]) || 1; return [M[0] / l, M[2] / l]; };
  const len = (M, o) => Math.hypot(M[o], M[o + 1], M[o + 2]);
  each(MESH.box, (i, M) => { const [ax, az] = axis(M), { rough, metal } = matOfB(S.tints[i * 4 + 3]); push(M[9], M[10], M[11], 0, len(M, 0) / 2, len(M, 3) / 2, len(M, 6) / 2, tintOf(i), rough, ax, az, metal, MIRROR.range); });
  each(MESH.roof, (i, M) => { const [ax, az] = axis(M), { rough, metal } = matOfB(S.tints[i * 4 + 3]); push(M[9], M[10], M[11], 1, len(M, 0) / 2, len(M, 3), len(M, 6) / 2, tintOf(i), rough, ax, az, metal, MIRROR.range); });
  each(MESH.pile, (i, M) => { const { rough } = matOfB(S.tints[i * 4 + 3]); push(M[9], M[10], M[11], 0, 0.15, len(M, 3) / 2, 0.15, tintOf(i), rough, 1, 0, 0, MIRROR.pileRange); });
  // the tower (render/towns.js's pack: the plinth, a 0.55–0.8 m shaft to heightM, the lantern and its cap 1.45 m over it)
  const T = S.meshes[MESH.tower];
  each(MESH.tower, (i, M) => {
    const top = T.hi[1], hm = top - 1.45, [ax, az] = axis(M);
    push(M[9], M[10] + hm / 2, M[11], 0, 0.62, hm / 2, 0.62, [lin(0xb9), lin(0xb5), lin(0xab)], 0.95, ax, az, 0, MIRROR.range);
    push(M[9], M[10] + hm + 0.72, M[11], 0, 0.5, 0.72, 0.5, [lin(0x3a), lin(0x3f), lin(0x42)], 0.7, ax, az, 0, MIRROR.range);
  });
  each(MESH.harbour, (i, M) => { for (const p of harbourParts(S.meshes[MESH.harbour], M)) push(...p.c, 0, ...p.h, p.rgb, matOfB(S.tints[i * 4 + 3]).rough, p.ax, p.az, 0, p.small ? MIRROR.pileRange : MIRROR.range); });
  return new Float32Array(out);
}

// the harbour's merged mesh → its parts (triangles that share a corner), each as a box along its own walls (the
// dominant direction of its upright faces), its area-weighted colour; parts under 0.12 m across (the rails, the
// flagpole) are left out, the piles (under 0.5 m) marked small
export function harbourParts(m, M) {
  const nT = (m.idx ? m.idx.length : m.verts) / 3, vi = (t, k) => (m.idx ? m.idx[3 * t + k] : 3 * t + k);
  const P = (v) => [M[9] + M[0] * m.pos[3 * v] + M[3] * m.pos[3 * v + 1] + M[6] * m.pos[3 * v + 2], M[10] + M[1] * m.pos[3 * v] + M[4] * m.pos[3 * v + 1] + M[7] * m.pos[3 * v + 2], M[11] + M[2] * m.pos[3 * v] + M[5] * m.pos[3 * v + 1] + M[8] * m.pos[3 * v + 2]];
  const parent = new Int32Array(nT).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const seen = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const p = P(vi(t, k)), key = `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)},${Math.round(p[2] * 50)}`;
    const o = seen.get(key); if (o == null) seen.set(key, t); else { const a = find(o), b = find(t); if (a !== b) parent[a] = b; }
  }
  const groups = new Map();
  for (let t = 0; t < nT; t++) { const r = find(t); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(t); }
  const parts = [];
  for (const tris of groups.values()) {
    // the walls' direction: the upright faces' normals folded onto a quarter turn (a box's four walls agree), area-weighted
    let sx = 0, sz = 0, A = 0; const rgb = [0, 0, 0];
    for (const t of tris) {
      const a = P(vi(t, 0)), b = P(vi(t, 1)), c = P(vi(t, 2));
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], area = Math.hypot(...n) / 2;
      if (!area) continue;
      A += area;
      for (let k = 0; k < 3; k++) { const v = vi(t, k); for (let ch = 0; ch < 3; ch++) rgb[ch] += lin(m.col[4 * v + ch]) * area / 3; }
      const h = Math.hypot(n[0], n[2]);
      if (h > 0.9 * Math.hypot(...n)) { const q = 4 * Math.atan2(n[2], n[0]); sx += Math.cos(q) * area; sz += Math.sin(q) * area; }
    }
    if (!A) continue;
    const th = Math.atan2(sz, sx) / 4, ax = Math.cos(th), az = Math.sin(th);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const p = P(vi(t, k)), q = [p[0] * ax + p[2] * az, p[1], -p[0] * az + p[2] * ax];
      for (let ch = 0; ch < 3; ch++) { lo[ch] = Math.min(lo[ch], q[ch]); hi[ch] = Math.max(hi[ch], q[ch]); }
    }
    const h = [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2];
    if (Math.min(h[0], h[2]) < 0.06) continue;
    const u = (lo[0] + hi[0]) / 2, v = (lo[2] + hi[2]) / 2;
    parts.push({ c: [u * ax - v * az, (lo[1] + hi[1]) / 2, u * az + v * ax], h, rgb: rgb.map((x) => x / A), ax, az, small: Math.max(h[0], h[2]) < 0.25 });
  }
  return parts;
}

// the nearest proxies to the eye (pure, no allocation: keys and out are the caller's): each within its own range (from
// its edge); writes the GPU's record (u32 count, 3 pads, then PROXY_F floats each) into out (outU: its u32 view); returns
// the count
export function pickMirror(all, eye, keys, out, outU, max = MIRROR.maxProxies) {
  const n = all.length / PROXY_F;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const o = i * PROXY_F, d = Math.max(0, Math.hypot(all[o] - eye[0], all[o + 2] - eye[2]) - all[o + 7]);
    if (d < all[o + 15]) keys[k++] = Math.floor(d * 4) * 1048576 + i;   // 0.25 m steps, the index under it (≤ 1 M proxies)
  }
  const sel = keys.subarray(0, k); sel.sort();
  const m = Math.min(k, max);
  for (let j = 0; j < m; j++) { const i = sel[j] % 1048576; out.set(all.subarray(i * PROXY_F, (i + 1) * PROXY_F), 4 + j * PROXY_F); }
  outU[0] = m;
  return m;
}

// the mirror's compute pass: one workgroup a column (an azimuth), one thread a bin
export const SHORE_MIRROR_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${TERRAIN_BIND(1)}
${TERRAIN_HEIGHT}
@group(2) @binding(0) var tT: texture_2d<f32>;
@group(2) @binding(1) var tV: texture_2d<f32>;
@group(2) @binding(2) var sLin: sampler;
@group(2) @binding(3) var sView: sampler;
@group(2) @binding(4) var tShadowT: texture_depth_2d;
@group(2) @binding(5) var sShadowT: sampler_comparison;
${SHADOW_STRUCT}
@group(2) @binding(6) var<uniform> SH: Shadow;
${STORM_FOG_WGSL}
struct Proxy { c: vec4f, h: vec4f, a: vec4f, m: vec4f }
struct Proxies { n: u32, p1: u32, p2: u32, p3: u32, p: array<Proxy, ${MIRROR.maxProxies}> }
@group(2) @binding(7) var<storage, read> PX: Proxies;
@group(2) @binding(8) var<storage, read_write> OUT: array<u32>;
${TRANS_READ}
${NIGHT_SKY_WGSL}
fn skyRadiance(d: vec3f) -> vec3f {
  let eh = horizonElev(Rg + F.sky.z);
  return textureSampleLevel(tV, sView, skyViewUV(d, eh), 0.0).rgb * F.sky.x + nightSky(d);
}
${SHORE_LIGHT_WGSL}
const AZ = ${MIRROR.az}u; const NB = ${MIRROR.bins}u; const NC = ${MIRROR.cand}u; const SUB = ${MIRROR.sub}u; const HEAD = ${MIRROR_HEAD}u;
const EMAX = ${(MIRROR.maxDeg * Math.PI / 180).toFixed(6)}; const TWO_PI = ${(2 * Math.PI).toFixed(7)};
var<workgroup> cIdx: array<u32, ${MIRROR.cand}>;
var<workgroup> cAz: array<f32, ${MIRROR.cand}>;
var<workgroup> cCov: array<f32, ${MIRROR.cand}>;
var<workgroup> nCand: atomic<u32>;
var<workgroup> topBin: atomic<u32>;
var<workgroup> eSkyW: vec3f;
fn wrapPi(a: f32) -> f32 { return a - TWO_PI * floor((a + PI) / TWO_PI); }
// the terrain's sun shadow at p (one tap, the level read: a compute stage has no derivatives)
fn shadowC(p: vec3f, nl: f32) -> f32 {
  if (SH.p.x < 0.5) { return 1.0; }
  let lp = SH.vp * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || lp.z < 0.0 || lp.z > 1.0) { return 1.0; }
  let bias = SH.p.y * (1.0 + 3.0 * sqrt(max(1.0 - nl * nl, 0.0)) / max(nl, 0.25));
  return textureSampleCompareLevel(tShadowT, sShadowT, uv, lp.z - bias);
}
struct Hit { t0: f32, t1: f32, n: vec3f }
// a ray (o, d) against a proxy: the box's slabs in its own frame and, for a gable, its two slopes; the entry face's normal
fn hitProxy(q: Proxy, o: vec3f, d: vec3f) -> Hit {
  let ux = q.m.xy; let uz = vec2f(-ux.y, ux.x);
  let r = o - q.c.xyz;
  let lo = vec3f(dot(r.xz, ux), r.y, dot(r.xz, uz));
  let ld = vec3f(dot(d.xz, ux), d.y, dot(d.xz, uz));
  let gable = q.c.w > 0.5;
  let bLo = vec3f(-q.h.x, select(-q.h.y, 0.0, gable), -q.h.z);
  let bHi = vec3f(q.h.x, q.h.y, q.h.z);
  let inv = 1.0 / select(ld, vec3f(1e-12), abs(ld) < vec3f(1e-12));
  let ta = (bLo - lo) * inv; let tb = (bHi - lo) * inv;
  let tn = min(ta, tb); let tf = max(ta, tb);
  var t0 = max(max(tn.x, tn.y), tn.z); var t1 = min(min(tf.x, tf.y), tf.z);
  var nl = vec3f(0.0, 0.0, -sign(ld.z));
  if (t0 == tn.x) { nl = vec3f(-sign(ld.x), 0.0, 0.0); } else if (t0 == tn.y) { nl = vec3f(0.0, -sign(ld.y), 0.0); }
  if (gable) {   // y ≤ H (1 − |x| / hx): the planes (±H / hx, 1, 0) · p ≤ H
    let k = q.h.y / q.h.x;
    for (var side = 0; side < 2; side++) {
      let pn = vec3f(select(-k, k, side == 1), 1.0, 0.0);
      let den = dot(pn, ld); let num = q.h.y - dot(pn, lo);
      if (abs(den) < 1e-9) { if (num < 0.0) { t0 = 1e30; } continue; }
      let t = num / den;
      if (den > 0.0) { t1 = min(t1, t); } else if (t > t0) { t0 = t; nl = normalize(pn); }
    }
  }
  return Hit(t0, t1, vec3f(nl.x * ux.x + nl.z * uz.x, nl.y, nl.x * ux.y + nl.z * uz.y));
}
// the light a proxy's face sends back along −d to the water (the draw's material and light), hazed as the land's mirror
fn shadeHit(q: Proxy, p: vec3f, n: vec3f, d: vec3f, t: f32) -> vec3f {
  let s = normalize(F.sun.xyz);
  let rS = Rg + F.sky.z + p.y * 0.001 - F.cam.y * 0.001;
  let nl = max(dot(n, s), 0.0);
  var sh = 0.0; if (nl > 0.001) { sh = shadowC(p, nl); }
  let eSun = F.sky.x * transAt(rS, s.y) * step(0.0, raySphere(vec3f(0.0, rS, 0.0), s, Rg) * -1.0) * nl * sh;
  let E = eSun + (skyIrr(n) + (eSkyW + nightLand()) * (0.5 + 0.5 * n.y)) * SKY_K;
  var col = q.a.rgb * (1.0 - q.m.z) * E / PI + shoreSpec(n, -d, s, q.a.rgb, q.a.w, q.m.z, eSun);
  let rC = Rg + F.sky.z;
  let haze = skyRadiance(normalize(vec3f(d.x, 0.02, d.z)));
  let Tair = exp(-medium(rC).ext * t * 0.001);
  // fix(v2) frame look: the storm's mist on the mirrored shore as on the shore itself (render/sky.js stormFog)
  return mix(mix(col * Tair + haze * (1.0 - Tair), haze, 1.0 - exp(-t / ${MIRROR_HAZE_M.toFixed(1)})), stormFogColour(), stormFog(p));
}
@compute @workgroup_size(${MIRROR.bins}) fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  if (li == 0u) {
    atomicStore(&nCand, 0u); atomicStore(&topBin, 0u);
    // the level ground's sky irradiance (the aerial pass's LIGHT.sky: four 45° samples × π)
    eSkyW = PI * 0.25 * (skyRadiance(vec3f(0.7071, 0.7071, 0.0)) + skyRadiance(vec3f(-0.7071, 0.7071, 0.0)) + skyRadiance(vec3f(0.0, 0.7071, 0.7071)) + skyRadiance(vec3f(0.0, 0.7071, -0.7071)));
  }
  workgroupBarrier();
  let dAz = TWO_PI / f32(AZ);
  let az0 = (f32(wg.x) + 0.5) * dAz - PI;   // the water's u = atan2(R.z, R.x) / 2π + 0.5
  let eye = max(F.cam.y, 0.5);
  let C = vec3f(F.cam.x, -eye, F.cam.z);    // the mirror point
  let n = min(PX.n, ${MIRROR.maxProxies}u);
  // the column's boxes: each one's share of the column's azimuth and the azimuth inside it its rays take (a box thinner
  // than the column is still hit, at its share), unless the terrain stands over the line from the water to its top
  for (var i = li; i < n; i += NB) {
    let q = PX.p[i];
    let ux = q.m.xy; let uz = vec2f(-ux.y, ux.x);
    let rel = q.c.xz - C.xz;
    var cov = 0.0; var aRep = az0;
    if (abs(dot(rel, ux)) <= q.h.x && abs(dot(rel, uz)) <= q.h.z) { cov = 1.0; }
    else {
      let ac = atan2(rel.y, rel.x);
      var dmin = 1e9; var dmax = -1e9;
      for (var k = 0; k < 4; k++) {
        let sx = select(-1.0, 1.0, (k & 1) == 1); let sz = select(-1.0, 1.0, k >= 2);
        let pc = rel + ux * (sx * q.h.x) + uz * (sz * q.h.z);
        let dd = wrapPi(atan2(pc.y, pc.x) - ac); dmin = min(dmin, dd); dmax = max(dmax, dd);
      }
      let o = wrapPi(az0 - ac);
      let lo = max(dmin, o - 0.5 * dAz); let hi = min(dmax, o + 0.5 * dAz);
      if (hi > lo) { cov = (hi - lo) / dAz; aRep = ac + clamp(o, dmin, dmax); }
    }
    if (cov <= 0.0) { continue; }
    let dir = vec2f(cos(aRep), sin(aRep));
    let tc = length(rel); let top = q.c.y + q.h.y + eye;
    let ts = eye * tc / max(top, 1e-3); let te = tc - max(q.h.x, q.h.z);
    var hidden = false;
    if (te > ts) {
      for (var k = 1; k < 4; k++) {
        let t = mix(ts, te, f32(k) * 0.25);
        let xz = C.xz + dir * t;
        if (terrainHeight(xz.x, xz.y) > -eye + top * t / tc + 0.5) { hidden = true; }
      }
    }
    if (hidden) { continue; }
    let slot = atomicAdd(&nCand, 1u);
    if (slot < NC) { cIdx[slot] = i; cAz[slot] = aRep; cCov[slot] = min(cov, 1.0); }
  }
  workgroupBarrier();
  let nc = min(atomicLoad(&nCand), NC);
  if (nc > 0u) {
    // this bin's span of elevation (the read's packing: texel b at e = EMAX (b / (NB − 1))²), SUB rays across it; each
    // ray's nearest 3 hits composited front to back by their boxes' azimuth shares
    let b = li;
    let e0 = EMAX * pow(max(f32(b) - 0.5, 0.0) / f32(NB - 1u), 2.0);
    let e1 = EMAX * pow((f32(b) + 0.5) / f32(NB - 1u), 2.0);
    var acc = vec4f(0.0);
    for (var j = 0u; j < SUB; j++) {
      let e = mix(e0, e1, (f32(j) + 0.5) / f32(SUB));
      let ce = cos(e); let se = sin(e);
      let ts = eye / max(se, 1e-5);   // where the ray leaves the water: only what stands over it shows
      var ht = array<f32, 3>(1e30, 1e30, 1e30); var hk = array<u32, 3>(0u, 0u, 0u); var hn = array<vec3f, 3>(vec3f(0.0), vec3f(0.0), vec3f(0.0));
      for (var k = 0u; k < nc; k++) {
        let a = cAz[k];
        let h = hitProxy(PX.p[cIdx[k]], C, vec3f(ce * cos(a), se, ce * sin(a)));
        let t = max(h.t0, ts);
        if (h.t1 <= t || t > 1e29) { continue; }
        if (t < ht[2]) {
          if (t < ht[1]) {
            ht[2] = ht[1]; hk[2] = hk[1]; hn[2] = hn[1];
            if (t < ht[0]) { ht[1] = ht[0]; hk[1] = hk[0]; hn[1] = hn[0]; ht[0] = t; hk[0] = k; hn[0] = h.n; }
            else { ht[1] = t; hk[1] = k; hn[1] = h.n; }
          } else { ht[2] = t; hk[2] = k; hn[2] = h.n; }
        }
      }
      var c = vec3f(0.0); var al = 0.0;
      for (var m = 0; m < 3; m++) {
        if (ht[m] > 1e29 || al > 0.995) { break; }
        let k = hk[m]; let a = cAz[k];
        let d = vec3f(ce * cos(a), se, ce * sin(a));
        let w = (1.0 - al) * cCov[k];
        c += w * shadeHit(PX.p[cIdx[k]], C + d * ht[m], hn[m], d, ht[m]);
        al += w;
      }
      acc += vec4f(c, al);
    }
    acc /= f32(SUB);
    let o = HEAD + (b * AZ + wg.x) * 2u;
    OUT[o] = pack2x16float(acc.rg); OUT[o + 1u] = pack2x16float(acc.ba);
    if (acc.a > 0.002) { atomicMax(&topBin, b + 1u); }
  }
  workgroupBarrier();
  if (li == 0u) { OUT[1u + wg.x] = atomicLoad(&topBin); if (wg.x == 0u) { OUT[0] = n; } }
}`;

// the water's read of the shore's mirror (render/water.js mirrorBlur): rgba (premultiplied) at azimuth u (0–1) and
// elevation e (rad), bilinear by hand; a texel over its column's head reads 0: a pixel whose two columns hold no shore
// costs three words (the count, the two heads)
export const MIRROR_READ_WGSL = (group, binding) => `
@group(${group}) @binding(${binding}) var<storage, read> SHM: array<u32>;
const SHM_AZ = ${MIRROR.az}; const SHM_NB = ${MIRROR.bins}u; const SHM_HEAD = ${MIRROR_HEAD}u; const SHM_EMAX = ${(MIRROR.maxDeg * Math.PI / 180).toFixed(6)};
fn shoreTexel(x: u32, b: u32, top: u32) -> vec4f {
  if (b >= top) { return vec4f(0.0); }
  let o = SHM_HEAD + (b * u32(SHM_AZ) + x) * 2u;
  return vec4f(unpack2x16float(SHM[o]), unpack2x16float(SHM[o + 1u]));
}
// the two columns round azimuth u (0–1) and their heads, once a pixel: every tap of the pixel shares them
struct ShoreCols { x0: u32, x1: u32, wx: f32, t0: u32, t1: u32 }
fn shoreCols(u: f32) -> ShoreCols {
  let fx = u * f32(SHM_AZ) - 0.5; let x0f = floor(fx);
  let x0 = u32((i32(x0f) + SHM_AZ) % SHM_AZ); let x1 = (x0 + 1u) % u32(SHM_AZ);
  return ShoreCols(x0, x1, fx - x0f, SHM[1u + x0], SHM[1u + x1]);
}
fn shoreAt(c: ShoreCols, e: f32) -> vec4f {
  if (e >= SHM_EMAX) { return vec4f(0.0); }
  let fb = sqrt(max(e, 0.0) / SHM_EMAX) * f32(SHM_NB - 1u);
  let b0 = u32(floor(fb)); let wb = fb - floor(fb);
  if (b0 >= max(c.t0, c.t1)) { return vec4f(0.0); }
  let b1 = min(b0 + 1u, SHM_NB - 1u);
  return mix(mix(shoreTexel(c.x0, b0, c.t0), shoreTexel(c.x1, b0, c.t1), c.wx), mix(shoreTexel(c.x0, b1, c.t0), shoreTexel(c.x1, b1, c.t1), c.wx), wb);
}`;

const ZERO4 = new Uint32Array(1);
// the mirror's buffer (made before the water, which binds it; the towns fill it): MIRROR_WORDS u32
export function createShoreMirrorTarget(device) {
  const buffer = device.createBuffer({ label: 'towns-mirror', size: MIRROR_WORDS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });   // COPY_SRC: readMirror
  return { buffer };
}

export function createTowns({ device, reg, graph, frameBGL, frameBG = null, U = null, frameStruct, sky, shadow, hdrTarget, msaa = 1, depthFormat = 'depth32float', terrain, forest = null, mirror = null, phone = false, far = true, errors = [] }) {
  const VX = GPUShaderStage.VERTEX, FR = GPUShaderStage.FRAGMENT;
  const drawBGL = device.createBindGroupLayout({ label: 'towns-shore', entries: [{ binding: 0, visibility: FR, texture: { sampleType: 'depth' } }, { binding: 1, visibility: FR, sampler: { type: 'comparison' } }, { binding: 2, visibility: FR, buffer: { type: 'uniform' } }] });
  const drawBG = device.createBindGroup({ layout: drawBGL, entries: [{ binding: 0, resource: shadow.view }, { binding: 1, resource: shadow.sampler }, { binding: 2, resource: { buffer: shadow.buffer } }] });
  const mod = reg.shader('towns-shore', SHORE_DRAW_WGSL(frameStruct));
  reg.add('towns-shore', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, drawBGL] }),
    vertex: { module: mod, entryPoint: 'vs', buffers: [
      { arrayStride: STRIDE_V, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }, { shaderLocation: 2, offset: 16, format: 'unorm8x4' }] },
      { arrayStride: STRIDE_I, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }, { shaderLocation: 4, offset: 16, format: 'float32x4' }, { shaderLocation: 5, offset: 32, format: 'float32x4' }, { shaderLocation: 6, offset: 48, format: 'unorm8x4' }] }] },
    fragment: { module: mod, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' }, depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });

  // #41: the shadow caster's pipeline (the light's view; the frame group stays bound in the shadow's pass)
  const shBGL = device.createBindGroupLayout({ label: 'towns-shadow', entries: [{ binding: 0, visibility: VX, buffer: { type: 'uniform' } }] });
  const shBG = device.createBindGroup({ label: 'towns-shadow', layout: shBGL, entries: [{ binding: 0, resource: { buffer: shadow.buffer } }] });
  const mSh = reg.shader('towns-shadow', SHORE_SHADOW_WGSL(frameStruct));
  reg.add('towns-shadow', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, shBGL] }),
    vertex: { module: mSh, entryPoint: 'vs', buffers: [
      { arrayStride: STRIDE_V, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: STRIDE_I, stepMode: 'instance', attributes: [{ shaderLocation: 3, offset: 0, format: 'float32x4' }, { shaderLocation: 4, offset: 16, format: 'float32x4' }, { shaderLocation: 5, offset: 32, format: 'float32x4' }] }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' } });
  const shDraws = [], shPlanes = new Float64Array(20);
  // #41c: the shore's mirror (SHORE_MIRROR_WGSL): its pipeline at load, its proxies' buffer, its group; the map is
  // mirror.buffer (createShoreMirrorTarget, bound by the water). Re-picked when the eye moves MIRROR.repackM: one
  // writeBuffer of the picked proxies, from arrays made once (no allocation a frame)
  const C = GPUShaderStage.COMPUTE;
  let mirrorOn = !!(mirror && frameBG && U), mAll = null, mKeys = null, mCount = 0, mHeadZero = true;
  const mOut = new Float32Array(4 + 16 * MIRROR.maxProxies), mOutU = new Uint32Array(mOut.buffer), mAt = [NaN, 0, NaN];
  const mOfs = [0];
  let mBG = null, mPX = null;
  const mStats = { proxies: 0, picked: 0, repacks: 0 };
  if (mirror && frameBG && U) {
    mPX = device.createBuffer({ label: 'towns-mirror-proxies', size: mOut.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const mBGL = device.createBindGroupLayout({ label: 'towns-mirror', entries: [
      { binding: 0, visibility: C, texture: {} }, { binding: 1, visibility: C, texture: {} }, { binding: 2, visibility: C, sampler: {} }, { binding: 3, visibility: C, sampler: {} },
      { binding: 4, visibility: C, texture: { sampleType: 'depth' } }, { binding: 5, visibility: C, sampler: { type: 'comparison' } }, { binding: 6, visibility: C, buffer: { type: 'uniform' } },
      { binding: 7, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 8, visibility: C, buffer: { type: 'storage' } }] });
    const sLin = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const sView = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    mBG = device.createBindGroup({ label: 'towns-mirror', layout: mBGL, entries: [{ binding: 0, resource: sky.textures.tT.createView() }, { binding: 1, resource: sky.textures.tV.createView() }, { binding: 2, resource: sLin }, { binding: 3, resource: sView },
      { binding: 4, resource: shadow.view }, { binding: 5, resource: shadow.sampler }, { binding: 6, resource: { buffer: shadow.buffer } }, { binding: 7, resource: { buffer: mPX } }, { binding: 8, resource: { buffer: mirror.buffer } }] });
    const mMod = reg.shader('towns-mirror', SHORE_MIRROR_WGSL(frameStruct));
    reg.add('towns-mirror', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, terrain.hbgl, mBGL] }), compute: { module: mMod, entryPoint: 'main' } });
  }
  let casting = true;   // the in-page A/B (main.js hook.setTownsShadow)
  const shRange = Object.fromEntries(SHADOW_MESHES.map((m) => [m, 1e9]));   // the light's box culls (render/shadow.js: ±2.5 km)
  const range = phone ? RANGE.phone : RANGE.desktop;
  const stats = { shadowDraws: 0, bytes: 0, shoreBytes: 0, maskBytes: 0, maskGpuBytes: 0, instances: 0, verts: 0, draws: 0, drawn: 0, triangles: 0, ready: false, maskReady: false, loadMs: null, log: [] };
  let arr = null, vbuf = null, ibuf = null, instBuf = null, maskBuf = null, maskBytes = null, maskOff = 0;
  const draws = [], planes = new Float64Array(20);
  let loadP = null;
  const t0 = performance.now();
  async function fetchBytes(url) { const r = await fetch(url); if (!r.ok) throw new Error(`towns: ${r.status} ${url}`); const b = new Uint8Array(await r.arrayBuffer()); stats.bytes += b.length; return b; }
  function landShore(raw) {
    const S = decodeShore(raw);
    arr = shoreArrays(S);
    const mk = (a, usage, label) => {
      const size = Math.max(16, Math.ceil(a.byteLength / 4) * 4), src = new Uint8Array(size);
      src.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      const b = device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, src); return b;
    };
    if (mBG) { mAll = mirrorProxies(S); mKeys = new Float64Array(mAll.length / 16); mStats.proxies = mKeys.length; mAt[0] = NaN; }   // #41c
    vbuf = mk(arr.V, GPUBufferUsage.VERTEX, 'towns-verts'); ibuf = mk(arr.I, GPUBufferUsage.INDEX, 'towns-index'); instBuf = mk(arr.inst, GPUBufferUsage.VERTEX, 'towns-instances');
    stats.instances = S.instances; stats.verts = arr.V.byteLength / STRIDE_V; stats.ready = true;
  }
  function landMask(raw) {
    maskBytes = raw; maskOff = 0;
    maskBuf = device.createBuffer({ label: 'towns-mask', size: Math.ceil(raw.byteLength / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    stats.maskGpuBytes = maskBuf.size;
  }
  const noMarks = device.createBuffer({ label: 'towns-mask-none', size: 16, usage: GPUBufferUsage.STORAGE });
  let marksOn = true;
  function bindMask() { stats.maskReady = true; maskBytes = null; setMarks(marksOn); }
  // the ground's marks on or off in place (the A/B): the terrain's paint and the forest's keep-out
  function setMarks(on) { marksOn = on; if (!stats.maskReady) return; const b = on ? maskBuf : noMarks; terrain.attach({ towns: b }); forest?.setTowns(b); }
  // ≤ budget bytes of the mask a call; bound when whole
  function pump(budget = UPLOAD_BYTES) {
    if (!maskBytes) return 0;
    const n = Math.min(budget, maskBytes.byteLength - maskOff);
    const n4 = maskOff + n >= maskBytes.byteLength ? Math.ceil(n / 4) * 4 : n & ~3;
    const src = new Uint8Array(n4); src.set(maskBytes.subarray(maskOff, maskOff + n4));
    device.queue.writeBuffer(maskBuf, maskOff, src);
    maskOff += n4;
    if (maskOff >= maskBytes.byteLength) bindMask();
    return n4;
  }
  // live: a slice a frame on the frame's encoder's way out, never beside a terrain slice
  graph?.onBeforeSubmit(() => { if (maskBytes && !terrain.queued) pump(); });
  function load() {
    return (loadP ??= (async () => {
      const FILES = far ? TOWN_FILES : TOWN_FILES_BAY;
      const [s, m] = await Promise.all([fetchBytes(FILES.shore.href), fetchBytes(FILES.mask.href)]);
      stats.shoreBytes = s.length; stats.maskBytes = m.length;
      // a host (Vite's dev server among them) may send the .gz with Content-Encoding gzip: the browser inflated it already
      const gz = (b) => (b[0] === 0x1f && b[1] === 0x8b ? inflate(b) : b);
      const [sr, mr] = await Promise.all([gz(s), gz(m)]);
      landShore(sr); landMask(mr);
      stats.loadMs = +(performance.now() - t0).toFixed(1);
    })().catch((e) => { errors.push(`towns: ${e?.message ?? e}`); }));
  }
  return {
    stats, range, get arrays() { return arr; },
    get queued() { return !!maskBytes; },
    load, pump, setMarks, setShadow(on) { casting = !!on; },
    // #41c: the shore's mirror, in the aerial pass after the land's (main.js); off (the A/B, or nothing near) the map's
    // count word reads 0 and the water skips it
    mirrorStats: mStats,
    // the map read back (the page test, the probes): { count, tops: per column, at(x, b): rgba } (allocates: not a frame's)
    async readMirror() {
      if (!mirror) return null;
      const rb = device.createBuffer({ size: MIRROR_WORDS * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(mirror.buffer, 0, rb, 0, MIRROR_WORDS * 4); device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const w = new Uint32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
      const h = (u) => { const e = (u >> 10) & 31, m = u & 1023, sg = u & 32768 ? -1 : 1; return e === 0 ? sg * m * 2 ** -24 : e === 31 ? NaN : sg * (1 + m / 1024) * 2 ** (e - 15); };
      const at = (x, b) => { const o = MIRROR_HEAD + (b * MIRROR.az + x) * 2; return b >= w[1 + x] ? [0, 0, 0, 0] : [h(w[o] & 65535), h(w[o] >>> 16), h(w[o + 1] & 65535), h(w[o + 1] >>> 16)]; };
      return { count: w[0], tops: w.slice(1, 1 + MIRROR.az), at };
    },
    setMirror(on) { mirrorOn = !!on && !!mBG; },
    runMirror(pass, c) {
      const live = mirrorOn && mCount > 0 && arr;
      if (!live) { if (!mHeadZero && mBG) { device.queue.writeBuffer(mirror.buffer, 0, ZERO4); mHeadZero = true; } return; }
      mOfs[0] = U.byteOffset;   // the frame's slot (a held array: nothing allocated a frame)
      pass.setPipeline(reg.get('towns-mirror')); pass.setBindGroup(0, frameBG, mOfs); pass.setBindGroup(1, terrain.heightsBindGroup); pass.setBindGroup(2, mBG);
      pass.dispatchWorkgroups(MIRROR.az); c.dispatches++;
      mHeadZero = false;
    },
    // a capture: everything in before the first frame
    async prime() { await load(); while (maskBytes) pump(Infinity); },
    get maskBuffer() { return maskBuf; },
    update(eye, viewProj) {
      if (!arr) { stats.draws = 0; return; }
      // #41c: the mirror's proxies, re-picked after MIRROR.repackM of travel
      if (mAll && !(Math.hypot(eye[0] - mAt[0], eye[2] - mAt[2]) < MIRROR.repackM)) {
        mAt[0] = eye[0]; mAt[2] = eye[2];
        mCount = pickMirror(mAll, eye, mKeys, mOut, mOutU);
        device.queue.writeBuffer(mPX, 0, mOut.buffer, 0, 16 + 64 * mCount);
        mStats.picked = mCount; mStats.repacks++;
      }
      frustumPlanes(viewProj, planes);
      pickDraws(arr, eye, planes, range, draws);
      let n = 0, tri = 0;
      for (const [mesh, , count] of draws) { const r = arr.ranges[mesh]; n += count; tri += count * (r.indices || r.verts) / 3; }
      stats.draws = draws.length; stats.drawn = n; stats.triangles = Math.round(tri);
    },
    // #41: into the terrain shadow map when it re-draws (render/shadow.js addCaster): the chunks in the light's box
    shadowCaster: { draw(pass, c) {
      if (!arr || !casting) { stats.shadowDraws = 0; return; }
      frustumPlanes(shadow.matrix.vp, shPlanes);
      pickDraws(arr, shadow.matrix.centre, shPlanes, shRange, shDraws);
      stats.shadowDraws = shDraws.length;
      if (!shDraws.length) return;
      pass.setBindGroup(1, shBG);
      pass.setPipeline(reg.get('towns-shadow')); pass.setVertexBuffer(0, vbuf); pass.setVertexBuffer(1, instBuf); pass.setIndexBuffer(ibuf, 'uint16');
      for (const [mesh, first, count] of shDraws) {
        const r = arr.ranges[mesh];
        if (r.indices) pass.drawIndexed(r.indices, count, r.firstIndex, r.baseVertex, first);
        else pass.draw(r.verts, count, r.baseVertex, first);
        c.calls++;
      }
    } },
    draw(pass, c) {
      if (!arr || !draws.length) return;
      pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, drawBG);
      pass.setPipeline(reg.get('towns-shore')); pass.setVertexBuffer(0, vbuf); pass.setVertexBuffer(1, instBuf); pass.setIndexBuffer(ibuf, 'uint16');
      for (const [mesh, first, count] of draws) {
        const r = arr.ranges[mesh];
        if (r.indices) pass.drawIndexed(r.indices, count, r.firstIndex, r.baseVertex, first);
        else pass.draw(r.verts, count, r.baseVertex, first);
        c.calls++;
      }
      c.triangles += stats.triangles;
    },
  };
}
