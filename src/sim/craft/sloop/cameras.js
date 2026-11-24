// The sloop's camera settings (refactor round 2, Phase C step 7): the numbers the follow and helm cameras take from the
// boat they film, not from sloop constants in the camera modules. Read from the profile's `cameras` block
// (src/vessels/<id>.json); a profile without one falls back to its own length (dims.HULL.loa) for the follow camera and to
// the default helmsman's eye (src/boat/helmCamera.js HELM_CAM.eye) for the helm view.
//   cameras(vessel) → { follow: { hull }, helm: { eye } }
//   follow.hull  m: the follow camera's length unit (FollowCamera({ hull }): its distance, pull and surge in hull lengths)
//   helm.eye     [x, y, z] m in the hull frame (x starboard, y up from the waterline, z aft): the helm view's and the
//                binoculars' eye (HelmCamera({ eye }), Binoculars({ eye }))
// Plain JS, no three.js: node reads it (tests/craftCameras.test.mjs).
import { vesselDims } from '../../boat/dims.js';
import { HELM_CAM } from '../../boat/helmCamera.js';

const memo = new WeakMap();
export function cameras(vessel) {
  let c = memo.get(vessel);
  if (c) return c;
  const own = vessel.cameras ?? {};
  c = Object.freeze({
    follow: Object.freeze({ hull: own.follow?.hull ?? vesselDims(vessel).HULL.loa }),
    helm: Object.freeze({ eye: Object.freeze([...(own.helm?.eye ?? HELM_CAM.eye)]) }),
  });
  memo.set(vessel, c);
  return c;
}
