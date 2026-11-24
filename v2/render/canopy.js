// T3: the far forest's canopy grid on the GPU (v2/forest/canopy.js: the rule and its JS twin). Made by
// render/forest.js beside its instance buffer; run in the forest's one-offs right after the place and the scatter (a grid
// swapped, the towns' mask landed: every time the trees moved), never as a frame's own work: clear → splat (the lidar's
// trees, the region's slots) → resolve (the cover share and the top) → resolve (smoothed, the slope, packed). The terrain
// binds the packed buffer (CANOPY_READ) and draws the canopy past the cards.
// Nothing is created after load: the two buffers, the params and the bind group are made here, the pipelines at load.
import { CANOPY, gridOf } from '../forest/canopy.js';

const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
const COMMON = `
struct CG { x0: f32, z0: f32, texel: f32, nx: u32, nz: u32, first: u32, count: u32, pad: u32 }
@group(0) @binding(0) var<uniform> G: CG;
@group(0) @binding(1) var<storage, read> inst: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> sumC: array<atomic<u32>>;   // the cover's sums, then the packed words
@group(0) @binding(3) var<storage, read_write> sumT: array<atomic<u32>>;   // the tops (h × 16), then each texel's own word`;

export const SPLAT_WGSL = `${COMMON}
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) g: vec3u) {
  let k = g.x + g.y * 65535u * 64u;
  if (k >= G.nx * G.nz) { return; }
  atomicStore(&sumC[k], 0u); atomicStore(&sumT[k], 0u);
}
fn wAt(i: i32, j: i32, x: f32, z: f32, R: f32) -> f32 {
  let c = vec2f(G.x0 + (f32(i) + 0.5) * G.texel, G.z0 + (f32(j) + 0.5) * G.texel);
  return clamp((R - distance(c, vec2f(x, z))) / G.texel + 0.5, 0.0, 1.0);
}
// one crown (forest/canopy.js splatTree): its disc over the texels it touches, a tent weight normalised to the disc's area
@compute @workgroup_size(64) fn splat(@builtin(global_invocation_id) g: vec3u) {
  let q = g.x;
  if (q >= G.count) { return; }
  let rec = inst[G.first + q]; let p = bitcast<u32>(rec.w);
  if (((p >> 23u) & 1u) == 0u || ((p >> 22u) & 1u) == 1u || ((p >> 18u) & 15u) == 5u) { return; }   // invalid, a shrub, a snag (no crown)
  let h = f32(p & 1023u) * 0.1; let r = f32((p >> 10u) & 255u) * 0.1;
  let x = rec.x; let z = rec.y; let t = G.texel; let nx = i32(G.nx); let nz = i32(G.nz);
  let R = min(${f(CANOPY.rMax)}, max(0.5, ${f(CANOPY.crownK)} * r));
  let i0 = max(0, i32(floor((x - R - G.x0) / t))); let i1 = min(nx - 1, i32(floor((x + R - G.x0) / t)));
  let j0 = max(0, i32(floor((z - R - G.z0) / t))); let j1 = min(nz - 1, i32(floor((z + R - G.z0) / t)));
  if (i0 > i1 || j0 > j1) { return; }
  var sum = 0.0;
  for (var j = j0; j <= j1; j++) { for (var i = i0; i <= i1; i++) { sum += wAt(i, j, x, z, R); } }
  let area = 3.14159265 * R * R / (t * t); let hq = u32(round(h * 16.0));
  if (sum <= 1e-6) {
    let i = clamp(i32(floor((x - G.x0) / t)), 0, nx - 1); let j = clamp(i32(floor((z - G.z0) / t)), 0, nz - 1);
    let k = u32(j * nx + i);
    atomicAdd(&sumC[k], u32(round(area * ${f(CANOPY.fix)}))); atomicMax(&sumT[k], hq);
    return;
  }
  for (var j = j0; j <= j1; j++) { for (var i = i0; i <= i1; i++) {
    let w = wAt(i, j, x, z, R);
    if (w <= 0.0) { continue; }
    let k = u32(j * nx + i);
    atomicAdd(&sumC[k], u32(round(w / sum * area * ${f(CANOPY.fix)}))); atomicMax(&sumT[k], hq);
  } }
}
// the first resolve: each texel's cover share (1 − e^(−gain · sum), the sums a 5 × 5 binomial round it: a stand's density,
// not its single crowns) and its own top, packed into the tops' buffer
fn sumAt(i: i32, j: i32) -> f32 {
  let q = clamp(vec2i(i, j), vec2i(0), vec2i(i32(G.nx) - 1, i32(G.nz) - 1));
  return f32(atomicLoad(&sumC[u32(q.y) * G.nx + u32(q.x)]));
}
@compute @workgroup_size(8, 8) fn own(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= G.nx || g.y >= G.nz) { return; }
  let k = g.y * G.nx + g.x;
  let B5 = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
  var s5 = 0.0;
  for (var b = 0; b < 5; b++) { for (var a = 0; a < 5; a++) { s5 += B5[a] * B5[b] * sumAt(i32(g.x) + a - 2, i32(g.y) + b - 2); } }
  let c = 1.0 - exp(-${f(CANOPY.gain)} * s5 / 256.0 / ${f(CANOPY.fix)});
  let t = f32(atomicLoad(&sumT[k])) / 16.0;
  atomicStore(&sumT[k], u32(round(c * 255.0)) | (min(255u, u32(round(t * ${f(CANOPY.topQ)}))) << 8u));
}
fn ownAt(i: i32, j: i32) -> vec2f {
  let q = clamp(vec2i(i, j), vec2i(0), vec2i(i32(G.nx) - 1, i32(G.nz) - 1));
  let w = atomicLoad(&sumT[u32(q.y) * G.nx + u32(q.x)]);
  return vec2f(f32(w & 255u) / 255.0, f32((w >> 8u) & 255u) / ${f(CANOPY.topQ)});
}
// the second: a 3 × 3 smoothing of the cover, the covered texels' mean top, the canopy surface's slope (a Sobel on
// top × cover), packed into the sums' buffer (the terrain's read)
@compute @workgroup_size(8, 8) fn pack(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= G.nx || g.y >= G.nz) { return; }
  let i = i32(g.x); let j = i32(g.y);
  var cs = 0.0; var ws = 0.0; var ts = 0.0; var tw = 0.0; var gx = 0.0; var gz = 0.0;
  for (var b = -1; b <= 1; b++) { for (var a = -1; a <= 1; a++) {
    let o = ownAt(i + a, j + b); let wa = f32(2 - abs(a)); let wb = f32(2 - abs(b)); let k = wa * wb;
    cs += k * o.x; ws += k; ts += k * o.x * o.y; tw += k * o.x;
    gx += f32(a) * wb * o.x * o.y; gz += f32(b) * wa * o.x * o.y;
  } }
  let top = select(0.0, ts / tw, tw > 1e-6);
  let s = 127.5 / ${f(CANOPY.gMax)} / (8.0 * G.texel);
  let g8 = vec2u(clamp(round(vec2f(gx, gz) * s + 127.5), vec2f(0.0), vec2f(255.0)));
  atomicStore(&sumC[g.y * G.nx + g.x], u32(round(cs / ws * 255.0)) | (min(255u, u32(round(top * ${f(CANOPY.topQ)}))) << 8u) | (g8.x << 16u) | (g8.y << 24u));
}`;

// the terrain's read (its own group binds the packed buffer as canopyB; its TerrainU carries the grid: canopy = x0, z0,
// 1 / texel, nx; canopy2 = nz, on, the cards' wmax, the texel)
export const CANOPY_READ = `
fn canopyWord(i: i32, j: i32) -> vec4f {
  let n = vec2i(i32(TU.canopy.w), i32(TU.canopy2.x));
  let q = clamp(vec2i(i, j), vec2i(0), n - 1);
  return unpack4x8unorm(canopyB[q.y * n.x + q.x]);
}
// the canopy at (x, z), bilinear: its cover, its top (m), its surface's slope east and south (m / m)
fn canopyAt(xz: vec2f) -> vec4f {
  let fc = (xz - TU.canopy.xy) * TU.canopy.z - 0.5; let i = floor(fc); let u = fc - i; let ii = vec2i(i);
  let c = mix(mix(canopyWord(ii.x, ii.y), canopyWord(ii.x + 1, ii.y), u.x), mix(canopyWord(ii.x, ii.y + 1), canopyWord(ii.x + 1, ii.y + 1), u.x), u.y);
  return vec4f(c.x, c.y * ${(255 / CANOPY.topQ).toFixed(4)}, (c.zw * 2.0 - 1.0) * ${f(CANOPY.gMax)});
}
// the grid's own weight at (x, z): 1 inside, falling over its soft edge, 0 past it (and 0 before the canopy is attached)
fn canopyIn(xz: vec2f) -> f32 {
  let lo = xz - TU.canopy.xy; let hi = vec2f(TU.canopy.w, TU.canopy2.x) * TU.canopy2.w - lo;
  return smoothstep(0.0, ${f(CANOPY.edgeM)}, min(min(lo.x, lo.y), min(hi.x, hi.y))) * TU.canopy2.y;
}`;

export function createCanopy({ device, reg, inst, ranges, variant = 'full' }) {
  const G = gridOf(variant === 'phone' ? 'phone' : 'desktop'), n = G.nx * G.nz;
  const S = GPUBufferUsage.STORAGE;
  const sumC = device.createBuffer({ label: 'canopy-words', size: n * 4, usage: S | GPUBufferUsage.COPY_SRC });
  const sumT = device.createBuffer({ label: 'canopy-tops', size: n * 4, usage: S });
  // the params: one record a range (256-byte offsets): the lidar's trees, the region's slots
  const params = device.createBuffer({ label: 'canopy-params', size: 256 * ranges.length, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const writeRange = (k, first, count) => {
    const d = new ArrayBuffer(32); new Float32Array(d, 0, 3).set([G.x0, G.z0, G.texel]); new Uint32Array(d, 12, 5).set([G.nx, G.nz, first, count, 0]);
    device.queue.writeBuffer(params, 256 * k, d);
  };
  ranges.forEach((r, k) => writeRange(k, r.first, r.count));
  const C = GPUShaderStage.COMPUTE;
  const bgl = device.createBindGroupLayout({ label: 'canopy', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: C, buffer: { type: 'storage' } }, { binding: 3, visibility: C, buffer: { type: 'storage' } }] });
  const bgs = ranges.map((r, k) => device.createBindGroup({ label: `canopy-${k}`, layout: bgl, entries: [{ binding: 0, resource: { buffer: params, offset: 256 * k, size: 32 } }, { binding: 1, resource: { buffer: inst } }, { binding: 2, resource: { buffer: sumC } }, { binding: 3, resource: { buffer: sumT } }] }));
  const m = reg.shader('canopy', SPLAT_WGSL);
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  for (const e of ['clear', 'splat', 'own', 'pack']) reg.add(`canopy-${e}`, { layout, compute: { module: m, entryPoint: e } });
  const stats = { runs: 0, bytes: 2 * n * 4, grid: [G.nx, G.nz], texel: G.texel };
  return {
    G, stats, buffer: sumC,
    setCount(k, count) { writeRange(k, ranges[k].first, count); ranges[k].count = count; },
    // on the forest's compute pass, after its place and scatter: the whole grid again
    run(pass) {
      pass.setBindGroup(0, bgs[0]);
      pass.setPipeline(reg.get('canopy-clear')); pass.dispatchWorkgroups(Math.min(65535, Math.ceil(n / 64)), Math.ceil(n / 64 / 65535));
      pass.setPipeline(reg.get('canopy-splat'));
      ranges.forEach((r, k) => { if (!r.count) return; pass.setBindGroup(0, bgs[k]); pass.dispatchWorkgroups(Math.ceil(r.count / 64)); });
      pass.setBindGroup(0, bgs[0]);
      pass.setPipeline(reg.get('canopy-own')); pass.dispatchWorkgroups(Math.ceil(G.nx / 8), Math.ceil(G.nz / 8));
      pass.setPipeline(reg.get('canopy-pack')); pass.dispatchWorkgroups(Math.ceil(G.nx / 8), Math.ceil(G.nz / 8));
      stats.runs++;
    },
    // test only (v2/tests/pages/canopy.page.mjs): the packed words, read back (makes a buffer)
    async read() {
      const buf = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder(); enc.copyBufferToBuffer(sumC, 0, buf, 0, n * 4); device.queue.submit([enc.finish()]);
      await buf.mapAsync(GPUMapMode.READ); const out = new Uint32Array(buf.getMappedRange().slice(0)); buf.unmap(); buf.destroy();
      return { nx: G.nx, nz: G.nz, x0: G.x0, z0: G.z0, texel: G.texel, words: out };
    },
  };
}
