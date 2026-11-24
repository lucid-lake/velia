// The hull frame any craft shares, v1's: the shared sim's frame (src/sim/craft/hull.js: the physics, the float and the
// wake's step, the follow camera, the air, the bottom, the posts and the env) with this engine's drawn parts: the bow
// spray (src/boat/spray.js, sunlit droplets) and the air's billboards (src/airMesh.js). Same call, same result as before.
//   const hull = createHull(core, { craft, vessel, start, dims })   (the rest: src/sim/craft/hull.js)
import { createHull as createHullFrame } from '../../../src/sim/craft/hull.js';
import { createSpray } from '../boat/spray.js';
import { createAirMesh } from '../airMesh.js';

export function createHull(core, opts) {
  const view = {
    spray: (o) => {
      const spray = createSpray(o);
      spray.uniforms.uColor.value.set(0xf2f0ea).multiplyScalar(core.lum * 3.9);   // ×3 (e4, round 5): sunlit droplets, not grey dots
      return spray;
    },
    airMesh: createAirMesh,
  };
  return createHullFrame(core, { ...opts, view: { ...view, ...opts?.view } });
}
