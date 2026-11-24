// The persistent whitecap foam (waterDetail, fix 2; owner go 2026-11-19): two world-space foam maps centred on the camera,
// addressed toroidally, so a cap's foam stays where the wave broke, fades over seconds, drifts downwind and ages into streaks.
// Ported from web-ocean by Maksymilian Dendura (MIT; LICENSE beside this file; ATTRIBUTION.md): its FOAM_UPDATE pass (the
// toroidal clipmap levels, the semi-Lagrangian drift, the decay, the injection, growth and freshness) and the shading's
// read (the two levels blended by the Chebyshev distance, the aged foam broken into wind-aligned streaks, fresh foam dense).
// Ours: storage buffers, not textures (the water's fragment stage is at the 16 sampled textures' limit), read bilinear by hand;
// the injection is v2's own whitecap density (the 600 and 85 m tiles' folds and the 12 m tile's fold cells under J0,
// render/water-surface.js), so the foam's share for the wind stays the one the owner approved; the map only gives it a memory.
//   createFoamMap({ device, reg, frameBGL, frameStruct, dispView, sampler, surfBuf, headWgsl }) → { layoutEntries(b), entries(b, parity),
//     readWgsl(b), run(pass, c, frameBG, offset, cam, t), reset(), parity }
export const FOAM_MAP = Object.freeze({
  res: 512,                // texels a side, each level
  size: [128, 1024],       // m a side: level 0 (0.25 m texels) and level 1 (2 m texels)
  fade: [0.30, 0.45],      // each level fades out between these shares of its size (Chebyshev distance from its centre)
  decay: 0.22,             // 1/s: web-ocean's
  growth: 1.0,             // a held fold keeps adding (web-ocean's)
  freshDecay: 1.6,         // 1/s: the freshness (a dense core while young)
  drift: 0.03,             // m/s per m/s of wind: the foam's drift downwind (web-ocean's)
  cap: 1.6,                // the foam's ceiling (web-ocean's)
  streak: [0.035, 0.11],   // the streaks' scale per m: along and across the wind (web-ocean's)
  binDeg: 10,              // the streaks lie on fixed directions this far apart, the two nearest the wind cross-faded (as render/spume.js's lanes)
  binFade: [0.35, 0.65],   // the cross-fade's span inside a bin (one tap outside it)
  film: 0.35,              // the aged foam's translucent film (web-ocean's soft margin), at most this cover
  gain: 3.0,               // the remembered foam's weight on the caps' density (v2's cover erodes thin foam to nothing under about 0.3)
});
const R = FOAM_MAP.res;
const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));

// the update: one thread a texel of each level; prev (last frame's) → dst. headWgsl: the frame struct with F at group 0, PI,
// SURF_WGSL + SURF_FNS_WGSL (foldCells reads tDisp and sRep by name) and warpOf
const UPDATE_WGSL = (headWgsl) => `${headWgsl}
struct FoamU { lv: array<vec4i, 2>, p: vec4f, d: vec4f }   // lv: each level's centre texel (x, z) and last frame's; p: dt, decay, growth, fresh decay; d: drift x, z (m/s), cap
@group(1) @binding(0) var tDisp: texture_2d_array<f32>;
@group(1) @binding(1) var sRep: sampler;
@group(1) @binding(2) var<uniform> SU: Surf;
@group(1) @binding(3) var<uniform> FU: FoamU;
@group(1) @binding(4) var<storage, read> prevB: array<u32>;
@group(1) @binding(5) var<storage, read_write> dstB: array<u32>;
const RES = ${R}; const SIZE0 = ${f(FOAM_MAP.size[0])}; const SIZE1 = ${f(FOAM_MAP.size[1])};
fn wrapI(i: i32) -> i32 { return ((i % RES) + RES) % RES; }
fn prevAt(l: u32, g: vec2i) -> vec2f { return unpack2x16float(prevB[l * u32(RES * RES) + u32(wrapI(g.y) * RES + wrapI(g.x))]); }
@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(RES) || id.y >= u32(RES)) { return; }
  let l = id.z; let sn = FU.lv[l]; let ts = select(SIZE0, SIZE1, l == 1u) / f32(RES);
  let lo = sn.xy - vec2i(RES / 2);
  let g = vec2i(lo.x + wrapI(i32(id.x) - lo.x), lo.y + wrapI(i32(id.y) - lo.y));   // the world texel this slot holds now
  let p = (vec2f(g) + 0.5) * ts;
  // v2's whitecap density here (render/water.js fs: the long tiles' folds; the 12 m tile's fold cells), over the texel's footprint
  let w = warpOf(p.x, p.y);
  var jacL = 1.0;
  for (var c = 0u; c < 2u; c++) {
    let L = F.water[c]; var xz = p; if (c > 0u) { xz += w; }
    jacL = min(jacL, textureSampleLevel(tDisp, sRep, xz / L, i32(c), log2(max(ts * 256.0 / L, 1.0))).w);
  }
  let fc = foldCells(p + w, F.water[2], 2, vec2f(ts, 0.0), vec2f(0.0, ts), 1.0, F.cam.w);
  let inject = max(clamp((SU.share.w - jacL) / SU_FSPAN, 0.0, 1.0), clamp((SU.share.w - fc.x) / SU_FSPAN, 0.0, 1.0) * fc.y);
  // last frame's foam, carried downwind (semi-Lagrangian: read where this texel's water was a frame ago)
  let plo = sn.zw - vec2i(RES / 2);
  var prev = vec2f(0.0);
  let q = (p - FU.d.xy * FU.p.x) / ts - 0.5;
  let qi = vec2i(floor(q));
  if (all(qi >= plo) && all(qi + vec2i(1) < plo + vec2i(RES))) {
    let t = q - floor(q);
    prev = mix(mix(prevAt(l, qi), prevAt(l, qi + vec2i(1, 0)), t.x), mix(prevAt(l, qi + vec2i(0, 1)), prevAt(l, qi + vec2i(1, 1)), t.x), t.y);
  }
  let dt = FU.p.x;
  var fo = max(prev.x * exp(-dt * FU.p.y), inject);
  fo = min(fo + inject * dt * FU.p.z, FU.d.z);
  let fresh = max(prev.y * exp(-dt * FU.p.w), inject);
  dstB[l * u32(RES * RES) + id.y * u32(RES) + id.x] = pack2x16float(vec2f(fo, fresh));
}`;

// the draw's read (group 2): fmAt(xz) → (foam 0..cap, freshness 0..1), 0 outside both levels' windows
export const FOAM_MAP_READ_WGSL = (b) => `
struct FoamR { lv: array<vec4i, 2>, p: vec4f, d: vec4f }
@group(2) @binding(${b}) var<storage, read> fmB: array<u32>;
@group(2) @binding(${b + 1}) var<uniform> FMU: FoamR;
const FM_RES = ${R}; const FM_S0 = ${f(FOAM_MAP.size[0])}; const FM_S1 = ${f(FOAM_MAP.size[1])};
const FM_F0 = ${f(FOAM_MAP.fade[0])}; const FM_F1 = ${f(FOAM_MAP.fade[1])};
const FM_GAIN = ${f(FOAM_MAP.gain)}; const FM_FILM = ${f(FOAM_MAP.film)};
const FM_STREAK = vec2f(${f(FOAM_MAP.streak[0])}, ${f(FOAM_MAP.streak[1])});
const FM_BIN = ${(FOAM_MAP.binDeg * Math.PI / 180).toFixed(8)};   // the streaks' fixed directions, this far apart (render/water.js)
const FM_FADE = vec2f(${f(FOAM_MAP.binFade[0])}, ${f(FOAM_MAP.binFade[1])});   // the cross-fade's span inside a bin
fn fmWrap(i: i32) -> i32 { return ((i % FM_RES) + FM_RES) % FM_RES; }
fn fmTexel(l: u32, g: vec2i) -> vec2f { return unpack2x16float(fmB[l * u32(FM_RES * FM_RES) + u32(fmWrap(g.y) * FM_RES + fmWrap(g.x))]); }
fn fmLevel(l: u32, xz: vec2f, ts: f32) -> vec2f {
  let q = xz / ts - 0.5; let i = vec2i(floor(q)); let t = q - floor(q);
  return mix(mix(fmTexel(l, i), fmTexel(l, i + vec2i(1, 0)), t.x), mix(fmTexel(l, i + vec2i(0, 1)), fmTexel(l, i + vec2i(1, 1)), t.x), t.y);
}
fn fmAt(xz: vec2f) -> vec2f {
  let t0 = FM_S0 / f32(FM_RES); let t1 = FM_S1 / f32(FM_RES);
  let c0 = (vec2f(FMU.lv[0].xy) + 0.5) * t0; let c1 = (vec2f(FMU.lv[1].xy) + 0.5) * t1;
  let d0 = abs(xz - c0); let d1 = abs(xz - c1);
  let w0 = 1.0 - smoothstep(FM_F0 * FM_S0, FM_F1 * FM_S0, max(d0.x, d0.y));
  let w1 = 1.0 - smoothstep(FM_F0 * FM_S1, FM_F1 * FM_S1, max(d1.x, d1.y));
  if (w1 <= 0.0) { return vec2f(0.0); }
  let a1 = fmLevel(1u, xz, t1);
  let a0 = select(a1, fmLevel(0u, xz, t0), w0 > 0.0);
  return mix(a1, a0, w0) * w1;
}`;

export function createFoamMap({ device, reg, frameBGL, dispView, sampler, surfBuf, headWgsl }) {
  const CP = GPUShaderStage.COMPUTE, FR = GPUShaderStage.FRAGMENT;
  const bytes = 2 * R * R * 4;
  const bufs = [0, 1].map((i) => device.createBuffer({ label: `water-foam-map-${i}`, size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
  const ubo = device.createBuffer({ label: 'water-foam-map-u', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'water-foam-map', entries: [
    { binding: 0, visibility: CP, texture: { viewDimension: '2d-array' } }, { binding: 1, visibility: CP, sampler: {} },
    { binding: 2, visibility: CP, buffer: { type: 'uniform' } }, { binding: 3, visibility: CP, buffer: { type: 'uniform' } },
    { binding: 4, visibility: CP, buffer: { type: 'read-only-storage' } }, { binding: 5, visibility: CP, buffer: { type: 'storage' } }] });
  const bgs = [0, 1].map((i) => device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: dispView }, { binding: 1, resource: sampler },
    { binding: 2, resource: { buffer: surfBuf } }, { binding: 3, resource: { buffer: ubo } }, { binding: 4, resource: { buffer: bufs[i] } }, { binding: 5, resource: { buffer: bufs[1 - i] } }] }));
  reg.add('water-foam-map', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bgl] }), compute: { module: reg.shader('water-foam-map', UPDATE_WGSL(headWgsl)), entryPoint: 'main' } });
  const u = new ArrayBuffer(64), ui = new Int32Array(u), uf = new Float32Array(u);
  const snap = [null, null];
  let parity = 0, lastT = null, fresh = true;   // parity: the buffer the draw reads (the last one written)
  return {
    get parity() { return parity; },
    layoutEntries: (b) => [{ binding: b, visibility: FR, buffer: { type: 'read-only-storage' } }, { binding: b + 1, visibility: FR, buffer: { type: 'uniform' } }],
    entries: (b, p) => [{ binding: b, resource: { buffer: bufs[p] } }, { binding: b + 1, resource: { buffer: ubo } }],
    // cam: the eye (x, z, m); t: the waves' clock (s); windMs, travelRad: the frame's wind (the drift)
    run(pass, c, frameBG, offset, cam, t, windMs, travelRad) {
      let dt = lastT == null ? 0 : t - lastT; if (!(dt >= 0 && dt <= 0.1)) dt = 0;   // a jump in the clock (a time change) carries no foam over a big step
      lastT = t;
      for (let l = 0; l < 2; l++) {
        const ts = FOAM_MAP.size[l] / R, cx = Math.floor(cam.x / ts), cz = Math.floor(cam.z / ts);
        const prev = fresh || !snap[l] ? [cx + 100000, cz + 100000] : snap[l];   // the first frame (or a reset): nothing carried over
        ui[l * 4] = cx; ui[l * 4 + 1] = cz; ui[l * 4 + 2] = prev[0]; ui[l * 4 + 3] = prev[1];
        snap[l] = [cx, cz];
      }
      fresh = false;
      const d = FOAM_MAP.drift * windMs;
      uf[8] = dt; uf[9] = FOAM_MAP.decay; uf[10] = FOAM_MAP.growth; uf[11] = FOAM_MAP.freshDecay;
      uf[12] = Math.cos(travelRad) * d; uf[13] = Math.sin(travelRad) * d; uf[14] = FOAM_MAP.cap; uf[15] = 0;
      device.queue.writeBuffer(ubo, 0, u);
      pass.setPipeline(reg.get('water-foam-map')); pass.setBindGroup(0, frameBG, [offset]); pass.setBindGroup(1, bgs[parity]);
      pass.dispatchWorkgroups(R / 8, R / 8, 2); c.dispatches++;
      parity = 1 - parity;
    },
    // back to empty (a capture's settle, a teleport): the next run carries nothing over
    reset() { fresh = true; lastT = null; },
  };
}
