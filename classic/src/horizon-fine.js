// The bay's fine horizon: per 8 m texel the skyline's elevation in 16 azimuths and the sky left
// open (tools/ground/build_horizon.py, from the game's own DEM). Two uses:
//   lit(root, sunAz, sunEl)  the sun's direct light under the terrain's skyline (0 shadow .. 1 sun), the bay's walls
//                            shading the water at dusk; replaces the 40 m, 8-direction map (src/forest/horizon.js)
//                            inside the bay box, which stays the fallback outside it
//   sky(root)                the sky visibility 0..1 (a flat site under the open sky is 1), for the ground's ambient
// One array texture (R8, 17 layers), one fetch of 1.6 MB gzip. Until it lands `w` is 0: the coarse map and a sky of 1.
import * as THREE from 'three/webgpu';
import { texture, vec2, float, int, floor, fract, mix, smoothstep, min, step, uniform } from 'three/tsl';
import { NAIP_DIR, HORIZON_FINE as HF, NAIP_LOOK } from '../../src/naip-layout.js';
import { afterCard } from '../../src/ui/deferLoad.js';
import { touchDevice } from '../../src/ui/device.js';
import { fetchRetry } from '../../src/sim/fetchRetry.js';

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';

async function inflate(bytes) {
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

let shared = null;
export function fineHorizon() {
  if (shared) return shared;
  // a phone (fix/ios-start-2): no fine skyline at all (8.4 MB here and 8.4 MB on the GPU, 2.6 MB to fetch); the 40 m map
  // (src/forest/horizon.js) still shades the bay outside and inside the box
  const phone = !isNode && typeof document !== 'undefined' && touchDevice();
  const small = phone;
  const W = small ? 1 : HF.w, Hh = small ? 1 : HF.h;
  const n = W * Hh;
  const data = new Uint8Array(n * HF.planes);
  data.fill(255, n * HF.dirs);                       // the sky plane: open until the file lands
  const tex = new THREE.DataArrayTexture(data, W, Hh, HF.planes);
  tex.format = THREE.RedFormat; tex.type = THREE.UnsignedByteType;
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.unpackAlignment = 1; tex.needsUpdate = true;
  const on = uniform(0);
  // a phone fetches nothing (above); a desktop fetches it at once (2.6 MB; the coarse skyline stands in until then: src/ui/deferLoad.js)
  const ready = (isNode || small) ? Promise.resolve(false) : afterCard().then(() => fetchRetry(NAIP_DIR + HF.file)).then(async (r) => {
    if (!r.ok) throw new Error(`horizon: ${r.status}`);
    const raw = await inflate(new Uint8Array(await r.arrayBuffer()));
    if (raw.length !== data.length) throw new Error(`horizon: ${raw.length} bytes, expected ${data.length}`);
    data.set(raw); tex.needsUpdate = true; on.value = 1; return true;
  }).catch((e) => { console.warn(e.message); return false; });

  const sizeX = HF.w * HF.texel, sizeZ = HF.h * HF.texel;
  const uvOf = (root) => vec2(root.x.sub(HF.x0).div(sizeX), root.z.sub(HF.z0).div(sizeZ));
  // 1 inside the box, fading to 0 over fadeM at its edge; times the load flag
  const weight = (root) => {
    const d = min(min(root.x.sub(HF.x0), float(HF.x0 + sizeX).sub(root.x)), min(root.z.sub(HF.z0), float(HF.z0 + sizeZ).sub(root.z)));
    return smoothstep(0.0, HF.fadeM, d).mul(on);
  };
  const layer = (uv, k) => texture(tex, uv).depth(int(k)).r;
  const lit = (root, sunAz, sunEl) => {
    const uv = uvOf(root), bin = sunAz.div(360 / HF.dirs), k0 = floor(bin), f = fract(bin), k1 = k0.add(1).mod(HF.dirs);
    const hz = mix(layer(uv, k0), layer(uv, k1), f).mul(90);             // the skyline's elevation, degrees
    return smoothstep(hz.sub(1.5), hz.add(1.5), sunEl);
  };
  // the bake's sky visibility, to the power NAIP_LOOK.skyPow (the sky is brighter toward the horizon than the cosine weight says)
  const sky = (root) => mix(float(1), layer(uvOf(root), HF.dirs).pow(NAIP_LOOK.skyPow), weight(root));
  return { lit, sky, weight, ready, tex, on };
}
