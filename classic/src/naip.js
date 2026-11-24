// The photo ground: USDA NAIP 2022, de-lit and graded to the ground's albedo targets
// (tools/ground/build_naip.py), as the base colour of every terrain LOD and the far map. Two levels: the bay (1 m) and the
// region (16 m: the whole lake and its rim), each at the quality tier's resolution (src/naip-layout.js); finer levels take over inside
// the coarser ones. The class index in the photos' alpha (forest, brush, bare) steers the CC0 detail layers in place of the NLCD cover. Textures decode off the
// main thread and land in textures the material already references; until a level lands its weight is 0 and the
// procedural ground shows (a frame is always sane). Headless node: nothing loads.
//
//   const N = naipNodes();                  // shared; N.ready resolves when the tier's files are in
//   const s = N.sample(p);                  // p: vec2 world (x, z) → { rgb (linear albedo), w (0..1 coverage), mask: vec3 (R forest, G brush, B bare), mw }
import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, float, min, smoothstep, mix, uniform } from 'three/tsl';
import { NAIP_DIR, NAIP_EXTENT, NAIP, NAIP_ALPHA, NAIP_PHONE, naipFile } from '../../src/naip-layout.js';
import { ktx2On } from './ktx2-layout.js';
import { ktx2Supported, loadKtx2, adoptCompressed, loadWithFallback } from './ktx2.js';
import { fetchRetry } from '../../src/sim/fetchRetry.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { slowLink, afterReady } from '../../src/ui/deferLoad.js';

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

async function bitmap(url) {
  const r = await fetchRetry(url);
  if (!r.ok) throw new Error(`naip: ${url} ${r.status}`);
  return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function photoTexture(srgb) {
  const t = new THREE.Texture();
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 8; t.flipY = false;
  return t;
}

// The coarse first (perf/slow-loading): a live page on a slow link whose tier wants finer photos than the phone
// set first loads the phone set (bay 8 m + region 128 m, 0.3 MB of WebP) and the tier's own files only after the first live
// frame, so the 25 MB of High's photos never share the link with what the start needs. Once they land the ground is the
// tier's, texel for texel (the same files, the same sampling: the full look). Captures and fast links load the tier's
// files at once, as before.
export function coarseFirst({ pick, live = !isNode && (FLAGS.headless == null || FLAGS.slow === '1'), slow = () => slowLink() } = {}) {   // ?slow=1 on a capture: the coarse-then-fine path, at once (afterReady), for the goldens check
  return !!live && (pick.bay < NAIP_PHONE.bay || pick.region < NAIP_PHONE.region) && slow();
}

let shared = null;
// pick: the tier's level per photo (naip-layout.js naipPick); ktx2: the tier's compressed set. The first caller makes it
// (the terrain material, with the world's tier).
export function naipNodes({ pick = NAIP.pick, ktx2 = undefined } = {}) {
  if (shared) return shared;
  const levels = {};
  const loads = [];
  const coarse = !isNode && coarseFirst({ pick });
  for (const name of ['bay', 'region']) {
    const [file, w, h] = naipFile(name, pick);
    const L = { name, file, w, h, tex: photoTexture(true), on: uniform(0), ext: NAIP_EXTENT[name], bytes: w * h * 4 * 4 / 3 };
    levels[name] = L;
    // KTX2 first where the tier asks for it (a quarter of the GPU memory), the plain WebP on any failure
    const full = () => loadWithFallback(NAIP_DIR + file, { enabled: ktx2On('naip', FLAGS, ktx2) && ktx2Supported(), loadCompressed: loadKtx2, loadPlain: bitmap, warn: console.warn })
      .then(({ kind, value }) => {
        if (L.tex.version > 0 && kind !== 'ktx2') L.tex.dispose();   // the coarse level was drawn: a new size is a new GPU texture (adoptCompressed does its own)
        if (kind === 'ktx2') { adoptCompressed(L.tex, value); L.bytes = w * h * 4 / 3; L.codec = 'ktx2'; }   // 8 bits per texel, mips included
        else { L.tex.image = value; L.tex.needsUpdate = true; L.codec = 'plain'; }
        L.on.value = 1; L.coarse = false;
      });
    if (isNode) continue;
    if (coarse) {
      // the phone set's file at once (ready resolves on it), the tier's after the first live frame
      loads.push(bitmap(NAIP_DIR + naipFile(name, NAIP_PHONE)[0]).then((bmp) => { if (L.on.value === 1) return; L.tex.image = bmp; L.tex.needsUpdate = true; L.on.value = 1; L.coarse = true; }, () => {}));
      L.refined = afterReady().then(full).catch((e) => console.warn(e?.message ?? e));
    } else loads.push(full());
  }
  const ready = isNode ? Promise.resolve(false) : Promise.all(loads).then(() => true, (e) => { console.warn(e.message); return false; });

  // coverage of a level at p: 1 well inside, fading to 0 over its fade width at the edge (the coarser level takes over)
  const uvOf = (L, p) => vec2(p.x.sub(L.ext.x0).div(L.ext.x1 - L.ext.x0), p.y.sub(L.ext.z0).div(L.ext.z1 - L.ext.z0));
  const coverOf = (L, p, fadeM) => {
    const e = L.ext, d = min(min(p.x.sub(e.x0), float(e.x1).sub(p.x)), min(p.y.sub(e.z0), float(e.z1).sub(p.y)));
    return smoothstep(0.0, fadeM, d).mul(L.on);
  };
  function sample(p) {
    const { bay, region } = levels;
    const cRegion = coverOf(region, p, NAIP.fadeM.region), cBay = coverOf(bay, p, NAIP.fadeM.bay);
    const tRegion = texture(region.tex, uvOf(region, p)), tBay = texture(bay.tex, uvOf(bay, p));
    const rgb = mix(tRegion.rgb, tBay.rgb, cBay);                               // the region first, the bay laid over it
    const w = float(1).sub(float(1).sub(cRegion).mul(float(1).sub(cBay)));
    // alpha is a class index (forest 1, brush 0.5, bare 0), the NLCD cover's replacement: weights from it, as naipClass() in plain JS
    const s = mix(tRegion.a, tBay.a, cBay).sub(NAIP_ALPHA.base / 255).div(NAIP_ALPHA.span / 255).clamp(0, 1);
    const forest = smoothstep(0.62, 0.88, s), bare = float(1).sub(smoothstep(0.12, 0.38, s));
    const mk = vec3(forest, float(1).sub(forest).sub(bare).max(0.0), bare);   // R forest, G brush, B bare
    return { rgb, w, mask: mk, mw: w, cBay };
  }
  const info = () => ({ coarseFirst: coarse, levels: Object.fromEntries(Object.entries(levels).map(([k, L]) => [k, { file: L.file, w: L.w, h: L.h, mb: +(L.bytes / 1048576).toFixed(1), loaded: L.on.value === 1, coarse: !!L.coarse, codec: L.codec ?? 'plain' }])) });
  // refined: every level at the tier's own file (at once unless coarse first)
  const refined = coarse ? Promise.all(Object.values(levels).map((L) => L.refined)).then(() => true) : ready;
  shared = { sample, ready, refined, levels, info };
  return shared;
}
