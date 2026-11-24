// The KTX2 loader (three.js KTX2Loader, Basis Universal transcoder self-hosted at /basis/, public/basis/): one shared loader
// per page, set up once the renderer exists. On the WebGPU renderer it asks the device which block formats it has (ASTC on
// Apple GPUs, BC7 on desktops, ETC2 on Android) and transcodes to the best one, so the texture stays compressed in GPU memory.
//
//   attachKtx2(renderer);                 // core/index.js, right after renderer.init()
//   const tex = await loadKtx2(url[, alive]);   // a CompressedTexture (or CompressedArrayTexture), mipmaps included; null if unsupported
//   adoptCompressed(target, tex);         // move it into a texture a shader node already references
import { loadWithFallback } from './ktx2-layout.js';
export { loadWithFallback };

let loader = null, attached = null, supportedFormats = null;   // loader: the promise of the one shared loader
const BASE = '/basis/';

export function attachKtx2(renderer) {
  attached = renderer;
  try {
    const f = (n) => { try { return !!renderer.hasFeature(n); } catch { return false; } };
    supportedFormats = { astc: f('texture-compression-astc'), bc: f('texture-compression-bc'), etc2: f('texture-compression-etc2') };
  } catch { supportedFormats = null; }
}
// a block format the device can sample, on the WebGPU backend only (the WebGL2 fallback keeps the plain files)
export const ktx2Supported = () => !!(attached?.isWebGPURenderer && attached.backend?.isWebGPUBackend && supportedFormats && (supportedFormats.astc || supportedFormats.bc || supportedFormats.etc2));

// The promise is cached, not the loader: the ground, the photo ground and the boat ask at the same time, and each call
// that passed an `if (loader)` check before the first import landed made its own loader (three warned "Multiple active
// KTX2 loaders" x3: up to 6 transcoder workers, each with its own copy of the Basis WASM). A failed import is not kept.
function getLoader() {
  return loader ??= import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
    const l = new KTX2Loader().setTranscoderPath(BASE).setWorkerLimit(2);
    l.detectSupport(attached);
    return l;
  }, (e) => { loader = null; throw e; });
}

// alive: called as the file's bytes arrive (loadWithFallback's stall clock, src/ktx2-layout.js)
export async function loadKtx2(url, alive = null) {
  if (!ktx2Supported()) return null;
  return (await getLoader()).loadAsync(url, alive ? () => alive() : undefined);
}

// Move a loaded compressed texture's data into `target` (a texture the node graph already holds). Only valid before the
// target's first upload with data; the target keeps its sampler settings.
export function adoptCompressed(target, src) {
  if (target.version > 0) target.dispose();   // an already uploaded placeholder (the ground's zero-filled array) is rebuilt in the new format
  target.isCompressedTexture = true;
  if (src.isCompressedArrayTexture) {   // the upload and bind paths test the array flags in an order that needs these three exact
    target.isCompressedArrayTexture = true; target.isDataArrayTexture = false; target.isArrayTexture = false;
  }
  target.mipmaps = src.mipmaps;
  target.image = src.image;
  target.format = src.format;
  target.type = src.type;
  target.colorSpace = src.colorSpace;
  target.generateMipmaps = false;
  target.minFilter = src.mipmaps.length > 1 ? target.minFilter : (target.minFilter === 1008 ? 1006 : target.minFilter);
  target.needsUpdate = true;
  return target;
}

// The boat's glTF textures on the tiers that ask (tiers.js ktx2.boat): each texture of `root`'s materials that has a packed
// twin under `base` (named by its glTF image name) is swapped for it before its first upload. A texture without a twin, or
// a failed load, keeps the authored one. Returns how many were swapped.
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap'];
export async function swapGltfTextures(root, { base = '/models/boat/tex/', warn = () => {} } = {}) {
  const jobs = new Map();   // authored texture -> its packed twin (a shared texture is swapped once)
  root.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) for (const slot of SLOTS) {
      const t = m[slot];
      if (t?.name && !jobs.has(t)) jobs.set(t, loadKtx2(`${base}${t.name}.ktx2`).then((n) => n && Object.assign(n, { wrapS: t.wrapS, wrapT: t.wrapT, anisotropy: t.anisotropy, name: t.name }), (e) => { warn(`ktx2: ${base}${t.name}.ktx2: ${e?.message ?? e}`); return null; }));
    }
  });
  const done = new Map(); let n = 0;
  await Promise.all([...jobs].map(async ([t, p]) => { const twin = await p.catch(() => null); if (twin) done.set(t, twin); }));
  root.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) for (const slot of SLOTS) { const twin = done.get(m[slot]); if (twin) { m[slot] = twin; m.needsUpdate = true; n++; } }
  });
  for (const t of done.keys()) t.dispose();
  return n;
}
