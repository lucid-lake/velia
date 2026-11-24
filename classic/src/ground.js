// The ground's surface look (the terrain material's texture side): six CC0 PBR layers in two array textures, sampled
// with anti-tiling, blended by height, triplanar on cliffs; the forest's canopy raster; the loading.
// Research:. The layer rules (which layer where) live in src/terrain-mesh.js terrainMaterial().
//
//   import { groundTextures, antiTile, top2, canopyTexture } from './ground.js';
//   const G = groundTextures();            // { albedo, pack: DataArrayTexture (zero until loaded), ready: Promise }
//   const t = antiTile(G.albedo, uv, layer, { k, dx, dy });   // vec4, two taps blended on a per-cell random offset
//
// Textures: terrain/ground/albedo.webp (512 × 512 × 6, sRGB) and pack.webp (256 × 256 × 6: R, G the GL normal, B the
// height), one strip each, one fetch each (≈ 0.5 MB in all). They decode off the main thread (createImageBitmap) and
// land in zero-filled array textures the material already references, so the node graph never waits.
import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, float, int, mix, smoothstep, floor, fract, sin, Fn, If, mx_noise_float } from 'three/tsl';
import { GROUND_TEXTURES, GROUND_LAYERS, CANOPY, canopyRaster } from './ground-layout.js';
import { ktx2On } from './ktx2-layout.js';
import { ktx2Supported, loadKtx2, adoptCompressed, loadWithFallback } from './ktx2.js';
import { fetchRetry } from '../../src/sim/fetchRetry.js';
import { takeBytes } from '../../src/prefetch.js';
import { FLAGS } from '../../src/sim/core/flags.js';

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

function arrayTexture(size, layers, { srgb = false } = {}) {
  const t = new THREE.DataArrayTexture(new Uint8Array(size * size * layers * 4), size, size, layers);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// a strip (w × h·n) decoded to RGBA bytes, layer 0 at the top
async function loadStrip(url, w, h, n) {
  // a phone's bake fetched the strips ahead on its idle link (src/prebake.js, perf/slow-loading-2): those very bytes
  const pre = takeBytes(url), ab = pre ? await pre : null;
  let blob;
  if (ab) blob = new Blob([ab]);
  else { const r = await fetchRetry(url); if (!r.ok) throw new Error(`ground: ${url} ${r.status}`); blob = await r.blob(); }
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (bmp.width !== w || bmp.height !== h * n) throw new Error(`ground: ${url} is ${bmp.width}×${bmp.height}, expected ${w}×${h * n}`);
  const cv = new OffscreenCanvas(w, h * n), ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, w, h * n).data;
}

let shared = null;
export function groundTextures({ ktx2 = undefined } = {}) {   // ktx2: the tier's compressed set (the first caller's: the terrain material)
  if (shared) return shared;
  const A = GROUND_TEXTURES.albedo, P = GROUND_TEXTURES.pack;
  const albedo = arrayTexture(A.size, A.layers, { srgb: true }), pack = arrayTexture(P.size, P.layers);
  // the pack's zero state reads as a flat normal (128, 128) and mid height, so an unloaded frame is still sane
  pack.image.data.fill(128);
  // KTX2 first where the tier asks for it (the array stays compressed on the GPU), the WebP strip on any failure
  const fill = async (tex, spec) => {
    const { kind, value } = await loadWithFallback(spec.url, {
      enabled: ktx2On('ground', FLAGS, ktx2) && ktx2Supported(), loadCompressed: loadKtx2, warn: console.warn,
      loadPlain: (u) => loadStrip(u, spec.size, spec.size, spec.layers),
    });
    if (kind === 'ktx2') { adoptCompressed(tex, value); shared.codec = 'ktx2'; return; }
    tex.image.data.set(value);
    tex.needsUpdate = true;
  };
  const ready = isNode ? Promise.resolve() : Promise.all([fill(albedo, A), fill(pack, P)]).then(() => true, (e) => { console.warn(e.message); return false; });
  shared = { albedo, pack, ready, layers: GROUND_LAYERS };
  return shared;
}

// Anti-tiling (Inigo Quilez, "texture repetition", technique 3): the plane is cut into cells by a low-frequency noise;
// each cell samples the tile at its own random offset, and the two neighbouring cells' samples blend across the cell's
// edge, pushed by the samples' difference so the blend hides in the texture's own contrast. Two taps. `k` is the
// cell noise (0 .. 1, shared by every layer at this scale), `dx`/`dy` the uv derivatives taken in uniform control flow
// (explicit gradients keep the mip level right across the offset and inside branches).
export function antiTile(tex, uv, layer, { k, dx, dy }) {
  const l = k.mul(8.0), ia = floor(l), f = fract(l);
  const offa = sin(vec2(3.0, 7.0).mul(ia)), offb = sin(vec2(3.0, 7.0).mul(ia.add(1.0)));
  const ca = texture(tex, uv.add(offa)).depth(layer).grad(dx, dy);
  const cb = texture(tex, uv.add(offb)).depth(layer).grad(dx, dy);
  const d = ca.sub(cb), s = d.x.add(d.y).add(d.z);
  return mix(ca, cb, smoothstep(0.2, 0.8, f.sub(s.mul(0.1))));
}
// the cell noise for antiTile: cells ≈ 3 tiles across, so a tile's repeat is broken every few metres
export const cellNoise = (uv) => mx_noise_float(uv.mul(0.31).add(vec2(11.3, 5.7))).mul(0.5).add(0.5);

// the two heaviest of a weight list, inside a Fn (If needs its stack): { w0, i0, w1, i1 } as float vars
export function top2(w) {
  const w0 = w[0].toVar(), i0 = float(0).toVar();
  for (let k = 1; k < w.length; k++) If(w[k].greaterThan(w0), () => { w0.assign(w[k]); i0.assign(float(k)); });
  const w1 = float(-1).toVar(), i1 = float(1).toVar();
  for (let k = 0; k < w.length; k++) If(w[k].greaterThan(w1).and(i0.notEqual(float(k))), () => { w1.assign(w[k]); i1.assign(float(k)); });
  return { w0, i0: int(i0), w1, i1: int(i1) };
}

// height-based blend (Mishkinis 2013): the higher of the two layers' heights wins at the seam, so sand settles between
// stones instead of fading over them. b: the second layer's share (0 .. 1), h0/h1 the heights (0 .. 1). → the second's blend
export function heightBlend(b, h0, h1, depth = 0.25) {
  const a0 = h0.add(float(1).sub(b)), a1 = h1.add(b);
  const ma = a0.max(a1).sub(depth);
  const b0 = a0.sub(ma).max(0.0), b1 = a1.sub(ma).max(0.0);
  return b1.div(b0.add(b1).max(1e-4));
}

// The canopy texture (src/ground-layout.js canopyRaster): zero-filled at material time, painted from the forest's
// scatter once it exists (world.js), RG8 over the scatter's region. uv(p) maps a world xz to it; inside(p) is 1 on it.
export function canopyTexture() {
  const { x0, x1, z0, z1 } = CANOPY.region, cell = CANOPY.cell;
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell);
  const tex = new THREE.DataTexture(new Uint8Array(w * h * 2), w, h, THREE.RGFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  const uv = (p) => vec2(p.x.sub(x0).div(x1 - x0), p.y.sub(z0).div(z1 - z0));   // p: vec2 (x, z)
  const fill = (scatter, species = scatter?.species) => {
    const c = canopyRaster(scatter, species);
    if (c.w !== w || c.h !== h) throw new Error(`canopy raster ${c.w}×${c.h} ≠ ${w}×${h}`);
    tex.image.data.set(c.data); tex.needsUpdate = true;
    return c;
  };
  return { tex, uv, fill, w, h };
}
