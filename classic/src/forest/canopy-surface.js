// The canopy surface: the lidar's canopy-height model as a raster the terrain draws far off, so the
// slopes read as one continuous carpet of crowns with the real skyline, not scattered trees on ground.
// tools/ground/build_lidar.py writes terrain/forest/canopy-bay-<k>m.webp over the bay box, RGBA8 lossless:
//   R the share of the texel's 1 m cells at least 2 m high (cover), G the tallest crown's height / 64 m, B the crown relief,
//   0.5 + (CHM - its 6 m blur) / 16 m (sunlit tops above 0.5, the gaps between crowns below), A the low vegetation (brush) share x 1.4.
// The terrain material (src/terrain-mesh.js) lifts the ground by the canopy top × cover from CANOPY.liftNear to liftFar,
// shades its colour with the relief and leans its normal on the height's gradient: crown clumps that the sun rakes.
// Textures decode off the main thread and land in a texture the material already references (weight 0 until then).
import * as THREE from 'three/webgpu';
import { texture, vec2, vec3, float, smoothstep, uniform, step } from 'three/tsl';
import { fetchRetry } from '../../../src/sim/fetchRetry.js';
import { FLAGS } from '../../../src/sim/core/flags.js';
import { slowLink, afterReady } from '../../../src/ui/deferLoad.js';

export const CANOPY_SURFACE = {
  dir: '/terrain/forest/', box: { x0: -2304, z0: -1792, x1: 3328, z1: 1792 }, topM: 64, reliefM: 16,
  cell: 2,                      // texel metres: High's; a tier passes its own (2, 4, 8; 16 on a phone on Low) to canopySurface
  liftNear: 260, liftFar: 650,  // the lift ramps in over these distances (m): full trees stand on the ground inside
  liftK: 1.0,                   // the lift is this share of the crown top: crowns of the impostors emerge above it
};
const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
const COARSE_CELL = 16;   // the phone's raster (src/quality/apply.js): the coarse first on a slow link
export const canopyFile = (cell = CANOPY_SURFACE.cell) => `canopy-bay-${cell}m.webp`;
export const canopySize = (cell = CANOPY_SURFACE.cell) => [Math.floor((CANOPY_SURFACE.box.x1 - CANOPY_SURFACE.box.x0) / cell), Math.floor((CANOPY_SURFACE.box.z1 - CANOPY_SURFACE.box.z0) / cell)];

let shared = null;
// cell: the tier's texel (m); the first caller makes it (the terrain material, with the world's tier)
export function canopySurface({ cell = CANOPY_SURFACE.cell } = {}) {
  if (shared) return shared;
  const C = { ...CANOPY_SURFACE, cell }, b = C.box, [w, h] = canopySize(cell);
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.NoColorSpace; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.flipY = false;
  const on = uniform(0);
  let ready = Promise.resolve(false), refined = ready;
  if (!isNode) {
    const load = (k) => fetchRetry(C.dir + canopyFile(k)).then((r) => { if (!r.ok) throw new Error(`canopy: ${r.status}`); return r.blob(); })
      .then((bl) => createImageBitmap(bl, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
    const put = (bmp) => { if (tex.version > 0) tex.dispose(); tex.image = bmp; tex.needsUpdate = true; on.value = 1; return true; };   // a new size is a new GPU texture
    // the coarse first (perf/slow-loading): a live page on a slow link draws the phone's 16 m raster (0.16 MB) until
    // the first live frame, then fetches the tier's (High's 2 m is 6.6 MB) and swaps it in; captures and fast links: the tier's at once
    if ((FLAGS.headless == null || FLAGS.slow === '1') && cell < COARSE_CELL && slowLink()) {
      ready = load(COARSE_CELL).then((bmp) => (on.value === 1 ? true : put(bmp)), (e) => { console.warn(e.message); return false; });
      refined = afterReady().then(() => load(cell)).then(put, (e) => { console.warn(e.message); return false; });
    } else refined = ready = load(cell).then(put, (e) => { console.warn(e.message); return false; });
  }
  const uvOf = (p) => vec2(p.x.sub(b.x0).div(b.x1 - b.x0), p.y.sub(b.z0).div(b.z1 - b.z0));
  const inside = (uv) => step(0.0, uv.x).mul(step(uv.x, 1.0)).mul(step(0.0, uv.y)).mul(step(uv.y, 1.0));
  // fragment: { cover, top (m), rel (m, signed), gx, gz (the top's slope, m/m), w (0..1: inside the box, loaded) }
  function sample(p) {
    const uv = uvOf(p), s = texture(tex, uv), e = float(C.cell * 1.5);
    const sx = texture(tex, uvOf(p.add(vec2(e, 0)))).g.sub(texture(tex, uvOf(p.sub(vec2(e, 0)))).g);
    const sz = texture(tex, uvOf(p.add(vec2(0, e)))).g.sub(texture(tex, uvOf(p.sub(vec2(0, e)))).g);
    const k = C.topM / (2 * C.cell * 1.5);
    return { low: s.a, cover: s.r, top: s.g.mul(C.topM), rel: s.b.sub(0.5).mul(C.reliefM), gx: sx.mul(k), gz: sz.mul(k), w: inside(uv).mul(on) };
  }
  // vertex: the lift in metres at world (x, z), explicit level (the LOD's spacing grows with the distance)
  function lift(p, dist, groundY) {
    // the height and cover from a mip that follows the vertex spacing: a crown-fine sample made stalagmites at 200-400 m (the 120 m shot), the crowns' relief is in the shading and the normal; the water's-edge fade below keeps a lone lifted vertex from making a spike (the start's shore)
    const uv = uvOf(p), lv0 = dist.div(60.0).max(2.0).log2().clamp(1.5, 6.0), far = smoothstep(1600.0, 3000.0, dist), lvT = lv0.mul(far.oneMinus()).add(far), sT = texture(tex, uv).level(lvT), sC = texture(tex, uv).level(lvT);   // past 3 km the crowns' own tops (a fine mip): the skyline follows the real crowns
    const ramp = smoothstep(float(C.liftNear), float(C.liftFar), dist);
    return sT.g.mul(C.topM * C.liftK).mul(smoothstep(0.3, 0.7, sC.r)).mul(ramp).mul(smoothstep(2.0, 18.0, groundY)).mul(inside(uv)).mul(on);   // no lift at the water's edge: a crown wall there stretched the beach's colour up it
  }
  shared = { tex, on, ready, refined, sample, lift, w, h };
  return shared;
}
