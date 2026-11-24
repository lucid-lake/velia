// The plain sky (fix/sky-load): what the page draws when the atmosphere's LUTs failed to build or timed out
// (src/core/skyGuard.js). A three-stop gradient for the background, a sun and a sky light in place of the sky model's
// AtmosphereLight; src/core/index.js also takes the aerial perspective and the clouds out of the post chain, since
// both read the LUTs (empty LUTs draw them black). The colours follow the sun's height like the valley mist.
// Never used while the LUTs build: a capable machine's High look is unchanged. ?sky=fallback forces it (captures).
import * as THREE from 'three/webgpu';
import { normalWorldGeometry, normalize, smoothstep, mix, uniform, max, pow } from 'three/tsl';
import { AtmosphereLight } from '@takram/three-atmosphere/webgpu';
import { clamp } from '../../../src/sim/core/params.js';

// elev: sin(sun elevation); lum: scene luminance per display unit (0.6 / exposure, as the mist uses)
function skyColours(elev, lum) {
  const t = clamp((elev + 0.05) / 0.35, 0, 1);   // night 0 → day 1
  const zenith = new THREE.Color(0x0b1424).lerp(new THREE.Color(0x3f6fae), t);
  const horizon = new THREE.Color(0x3a4452).lerp(elev < 0.15 ? new THREE.Color(0xe7c6a0) : new THREE.Color(0xbfd2e2), t);
  const ground = new THREE.Color(0x2a3036).lerp(new THREE.Color(0x6d7780), t);
  const k = lum * 1.6;
  return { zenith: zenith.multiplyScalar(k), horizon: horizon.multiplyScalar(k), ground: ground.multiplyScalar(k), t };
}

export function applySkyFallback({ scene, sunWorld, elev, lum }) {
  const c = skyColours(elev, lum);
  const uZen = uniform(c.zenith), uHor = uniform(c.horizon), uGnd = uniform(c.ground);
  const dir = normalize(normalWorldGeometry);   // the background sphere's own direction (three's Background.js samples a cube by it)
  const up = max(dir.y, 0);
  const sky = mix(uHor, uZen, pow(smoothstep(0, 1, up), 0.6));
  scene.backgroundNode = mix(uGnd, sky, smoothstep(-0.04, 0.02, dir.y));
  scene.environmentNode = null;
  // the sky model's light reads the transmittance LUT: hide it, light the world with a plain sun and sky
  const old = [];
  scene.traverse((o) => { if (o instanceof AtmosphereLight) old.push(o); });
  for (const o of old) o.visible = false;
  const sun = new THREE.DirectionalLight(0xfff1dc, 40 * lum * Math.max(0.05, c.t));
  sun.position.copy(sunWorld).multiplyScalar(1000);
  sun.name = 'sky-fallback-sun';
  const hemi = new THREE.HemisphereLight(c.zenith.clone().multiplyScalar(1.4), c.ground.clone(), 3);
  hemi.name = 'sky-fallback-hemi';
  scene.add(sun, sun.target, hemi);
  return { colours: c, lights: [sun, hemi], hidden: old };
}
