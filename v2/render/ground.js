// The island and shore ground (M5c): v1's ground photo as streamed tiles and v1's detail set, on the GPU.
//   The photo (v2/terrain/photo.js): the set's two levels in one rgba8 array texture with a full mip chain (the bay
//   2816 × 1792 at 2 m on layer 0, the region 1280 × 1920 at 32 m on layer 1; a phone 4 m and 64 m). A tile lands from the
//   worker (v2/terrain/ground-worker.js: fetch + decode), queues, and the frame uploads ≤ 1 MB of tiles (four) with
//   writeTexture into the level's place; each landed tile's mips are re-baked by a compute dispatch over its own
//   256-aligned footprint (an aligned box filter never reads across a tile, so an unlanded neighbour cannot darken it;
//   the few top mips that mix tiles are re-baked as each lands). An unlanded texel is 0: the shader reads alpha as the
//   landed flag (the bay's class alpha is ≥ 64). The tiles stream nearest the eye first after the first frame (never in
//   the first load); a capture primes them all before its first frame.
//   The detail set: v1's two strips (terrain/ground/albedo.webp 512² × 6 sRGB, pack.webp 256² × 6: the normal in R, G,
//   the height in B; ambientCG CC0, ATTRIBUTION.md) decoded by the same worker into one 512² × 12 array texture with
//   mips (the pack drawn at 2×); the terrain's draw turns its grain on only once both strips and their mips are in.
//   The close rock (feat/v2-look-ponlai, owner 2026-11-20; features.js rockDetail, a desktop or a tablet at L0-L1): Poly Haven's
//   Rock Face 03 (CC0, ATTRIBUTION.md) as two more layers of the same array (12 the albedo, 13 the normal xy + height), read
//   hex-tiled by the terrain's draw inside 40 m (render/rockDetail.js); none fetched where it is off (the array keeps 12 layers).
//   Stream events only: no frame waits on a decode; the uploads ride the frame's pump after the terrain's and the forest's.
import { PHOTO_SETS, LAYER, TILE, textureSize, streamOrder, tileUrl, withRegion, BUDGET_BYTES } from '../terrain/photo.js';

export const DETAIL = Object.freeze({ size: 512, layers: 12, files: [{ url: '/terrain/ground/albedo.webp', layer0: 0, scale: 1, count: 6 }, { url: '/terrain/ground/pack.webp', layer0: 6, scale: 2, count: 6 }] });
// the close rock's two layers (render/rockDetail.js ROCK_LAYER): the albedo at 512², the pack (normal x, y, height) at 512²
export const ROCK_FILES = Object.freeze([{ url: '/terrain/ground/rock-albedo.webp', layer0: 12, scale: 1, count: 1 }, { url: '/terrain/ground/rock-pack.webp', layer0: 13, scale: 1, count: 1 }]);
export const detailLayers = (rock) => DETAIL.layers + (rock ? ROCK_FILES.length : 0);
export const UPLOAD_BYTES = 1 << 20;
export { BUDGET_BYTES };

// one mip level of a region of one layer: the 2 × 2 box mean of the level above (clamped at the texture's edge)
export const MIP_REGION_WGSL = `
struct R { x0: u32, y0: u32, w: u32, h: u32, layer: u32, p1: u32, p2: u32, p3: u32 }
@group(0) @binding(0) var<uniform> P: R;
@group(0) @binding(1) var src: texture_2d_array<f32>;
@group(0) @binding(2) var dst: texture_storage_2d_array<rgba8unorm, write>;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= P.w || g.y >= P.h) { return; }
  let d = vec2i(i32(P.x0 + g.x), i32(P.y0 + g.y));
  let ss = vec2i(textureDimensions(src)); let l = i32(P.layer);
  let s0 = d * 2;
  let v = (textureLoad(src, min(s0, ss - 1), l, 0) + textureLoad(src, min(s0 + vec2i(1, 0), ss - 1), l, 0) + textureLoad(src, min(s0 + vec2i(0, 1), ss - 1), l, 0) + textureLoad(src, min(s0 + vec2i(1, 1), ss - 1), l, 0)) * 0.25;
  textureStore(dst, d, l, v);
}`;

// region: a region's photo level (v2/terrain/region.js regionPhotoLevel: the page starts in a region with its own level): layer 0
// holds it in place of the bay's photo, whose tiles are then never fetched
export function createGround({ device, reg, terrain, variant = 'full', photo = true, detail = true, rock = false, errors = [], region = null }) {
  const LAYERS = detailLayers(detail && rock), FILES = detail && rock ? [...DETAIL.files, ...ROCK_FILES] : DETAIL.files;
  const set = withRegion(PHOTO_SETS[variant], region);
  const [PW, PH] = textureSize(set);
  const pmips = Math.floor(Math.log2(Math.max(PW, PH))) + 1;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING;
  const photoTex = device.createTexture({ label: `ground-photo-${variant}`, size: [PW, PH, 2], format: 'rgba8unorm', mipLevelCount: pmips, usage });
  const dmips = Math.log2(DETAIL.size) + 1;
  const detailTex = device.createTexture({ label: 'ground-detail', size: [DETAIL.size, DETAIL.size, LAYERS], format: 'rgba8unorm', mipLevelCount: dmips, usage });
  const view = (t, base, count) => t.createView({ dimension: '2d-array', baseMipLevel: base, mipLevelCount: count });
  // the mip bake: a bind group per (texture, level): the level above as the source, this level as the target; the region
  // record in a dynamic-offset uniform (one slot a level, written before each dispatch: the queue keeps the order)
  const C = GPUShaderStage.COMPUTE;
  const bgl = device.createBindGroupLayout({ label: 'ground-mip', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 32 } }, { binding: 1, visibility: C, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } }, { binding: 2, visibility: C, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '2d-array' } }] });
  const SLOTS = 16;
  const pbuf = device.createBuffer({ label: 'ground-mip-params', size: 256 * SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const mipBG = (t, mips) => Array.from({ length: mips - 1 }, (_, k) => device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: pbuf, size: 32 } }, { binding: 1, resource: view(t, k, 1) }, { binding: 2, resource: view(t, k + 1, 1) }] }));
  const photoBG = mipBG(photoTex, pmips), detailBG = mipBG(detailTex, dmips);
  const mod = reg.shader('ground-mip', MIP_REGION_WGSL);
  reg.add('ground-mip', { layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: mod, entryPoint: 'main' } });
  // the terrain's level records (the shader's extents) and the switches
  for (const name of ['bay', 'region']) { const L = set[name]; terrain.setPhotoLevel(LAYER[name], { x0: L.x0, z0: L.z0, texel: L.texel, w: L.w, h: L.h, tile: TILE, layer: LAYER[name], on: photo ? 1 : 0 }); }
  terrain.setLook({ photo: photo ? 1 : 0, detail: 0 });

  // --- the worker and the queue ---
  const stats = { variant, region: region?.name ?? null, rock: detail && rock, layers: LAYERS, bytes: 0, photoBytes: 0, detailBytes: 0, files: 0, tiles: 0, tilesTotal: 0, decodeMs: 0, uploads: 0, bakes: 0, detailReady: false, done: false, landMsMax: 0, log: [] };
  let worker = null, nextId = 1;
  const pending = new Map();
  const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL('../terrain/ground-worker.js', import.meta.url), { type: 'module', name: 'velia-ground' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data); };
    worker.onerror = (e) => { errors.push(`ground worker: ${e.message}`); };
    return worker;
  };
  const fetchImage = (url, scale = 1) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ensureWorker().postMessage({ id, url, scale }); });
  const queue = [];   // { kind: 'tile' | 'detail', tex, x, y, layer, w, h, data, done }
  let detailLanded = 0;
  function landTile(t, msg) {
    const t0 = performance.now();
    if (msg.w !== t.w || msg.h !== t.h) throw new Error(`photo tile ${t.level} ${t.tx}-${t.ty}: ${msg.w}×${msg.h}, expected ${t.w}×${t.h}`);
    stats.bytes += msg.bytes; stats.photoBytes += msg.bytes; stats.files++; stats.decodeMs += msg.ms;
    queue.push({ kind: 'tile', tex: photoTex, bgs: photoBG, mips: pmips, x: t.px, y: t.py, layer: t.layer, w: t.w, h: t.h, data: msg.data });
    stats.landMsMax = Math.max(stats.landMsMax, performance.now() - t0);
  }
  function landStrip(f, msg) {
    const S = DETAIL.size;
    if (msg.w !== S || msg.h !== S * f.count) throw new Error(`detail strip ${f.url}: ${msg.w}×${msg.h}, expected ${S}×${S * f.count}`);
    stats.bytes += msg.bytes; stats.detailBytes += msg.bytes; stats.files++; stats.decodeMs += msg.ms;
    for (let l = 0; l < f.count; l++) queue.push({ kind: 'detail', tex: detailTex, bgs: detailBG, mips: dmips, x: 0, y: 0, layer: f.layer0 + l, w: S, h: S, data: msg.data.subarray(l * S * S * 4, (l + 1) * S * S * 4) });
  }
  // the mips of a landed region: level by level over its 2^m footprint (aligned: never across a tile at the levels inside one)
  function bakeMips(j) {
    const enc = device.createCommandEncoder({ label: 'ground-mip' });
    const pass = enc.beginComputePass({ label: 'ground-mip' });
    pass.setPipeline(reg.get('ground-mip'));
    const P = new Uint32Array(8);
    for (let m = 1; m < j.mips; m++) {
      const x0 = j.x >> m, y0 = j.y >> m, x1 = Math.ceil((j.x + j.w) / 2 ** m), y1 = Math.ceil((j.y + j.h) / 2 ** m);
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      P[0] = x0; P[1] = y0; P[2] = w; P[3] = h; P[4] = j.layer;
      const slot = (m - 1) % SLOTS;
      device.queue.writeBuffer(pbuf, 256 * slot, P);
      pass.setBindGroup(0, j.bgs[m - 1], [256 * slot]);
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    stats.bakes++;
  }
  // the frame's slice: ≤ budget bytes of landed images into their textures, their mips as each completes
  function pump(budget = UPLOAD_BYTES) {
    let done = 0;
    while (queue.length && done < budget) {
      const j = queue.shift();
      device.queue.writeTexture({ texture: j.tex, origin: [j.x, j.y, j.layer] }, j.data, { bytesPerRow: j.w * 4, rowsPerImage: j.h }, [j.w, j.h, 1]);
      done += j.w * j.h * 4; stats.uploads++;
      bakeMips(j);
      if (j.kind === 'tile') stats.tiles++;
      else if (++detailLanded === LAYERS) { stats.detailReady = true; terrain.setLook({ detail: detail ? 1 : 0 }); }
    }
    return done;
  }
  async function loadDetail() {
    if (!detail) return;
    await Promise.all(FILES.map(async (f) => landStrip(f, await fetchImage(new URL(f.url, document.baseURI).href, f.scale))));
  }
  // the tiles in the stream order (nearest the eye first), `lanes` fetches in flight
  async function loadPhoto(eye, lanes = 6) {
    if (!photo) return;
    const order = streamOrder(set, eye[0], eye[2]);
    stats.tilesTotal = order.length;
    let i = 0;
    const lane = async () => { while (i < order.length) { const t = order[i++]; landTile(t, await fetchImage(new URL(tileUrl(variant, set[t.level], t), document.baseURI).href)); } };
    await Promise.all(Array.from({ length: lanes }, lane));
  }
  let loading = null;
  return {
    stats, set, photoView: view(photoTex, 0, pmips), detailView: view(detailTex, 0, dmips), photoTex, detailTex,
    get queued() { return queue.length; },
    pump,
    // a live page: after the first frame; the frame's pump uploads the slices
    load(eye) { return loading ??= Promise.all([loadDetail(), loadPhoto(eye)]).then(() => { stats.done = true; }); },
    // a capture: everything in, uploaded and baked before the first frame
    async prime(eye) {
      await this.load(eye);
      while (queue.length) pump(Infinity);
      await device.queue.onSubmittedWorkDone();
    },
    stop() { worker?.terminate(); worker = null; },
  };
}
