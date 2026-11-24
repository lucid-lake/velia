// Capture-only close shots of the boat (?shot=<name>, headless).
// Each names a target on the boat and a camera offset in the hull frame (x starboard, y up, z aft), so the frame is
// the same whatever the heading and heel. Plain three.js, no state: the page applies it once after the settle.
import * as THREE from 'three/webgpu';
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';

// target: a hull-frame point, or a function (boat) → world point; cam: hull-frame offset from the target (m). Per boat
// (its dims; memoised): SHOTS is this page's boat's
const shotsMemo = new WeakMap();
export function shotsFor(dims = DEFAULT_DIMS) {
  let S = shotsMemo.get(dims);
  if (S) return S;
  const { HULL, RIG } = dims;
  S = {
    masthead: { target: [0, HULL.mastStepY + RIG.mastTop - 0.1, HULL.mastStepZ], cam: [2.1, 0.7, 1.9], fov: 34 },
    vane: { target: [0, HULL.mastStepY + RIG.mastTop + 0.40, HULL.mastStepZ - 0.30], cam: [0.75, 0.16, 0.95], fov: 30 },   // the wind vane, from aft and to starboard
    spreader: { target: [0.55, HULL.mastStepY + RIG.spreaders[0].y, HULL.mastStepZ], cam: [1.7, 0.5, 1.8], fov: 34 },
    boomend: { target: 'boomend', cam: [1.1, 0.6, 1.5], fov: 38 },
    gooseneck: { target: [0, HULL.mastStepY + 0.7, HULL.mastStepZ + 0.4], cam: [1.4, 0.6, 1.6], fov: 40 },
    bow: { target: [0, HULL.bowDeckY + 0.15, HULL.stemZ + 0.15], cam: [1.4, 0.75, -1.6], fov: 40 },
    'cockpit-above': { target: [0, 0.75, 2.2], cam: [0.9, 3.6, 3.4], fov: 48 },
    'cockpit-astern': { target: [0, 1.0, 1.8], cam: [0.55, 1.15, 4.4], fov: 46 },
    transom: { target: [0, 0.78, 4.18], cam: [0.7, 0.2, 2.3], fov: 38 },   // the transom name and the swim step, from aft and to starboard
    winch: { target: [1.33, 1.34, 2.65], cam: [0.45, 0.32, 0.55], fov: 36 },   // the starboard primary winch, macro
    crew: { target: [0.62, 1.3, 3.0], cam: [-1.9, 0.25, 0.4], fov: 32 },   // the helmsman (?crew=1 to show it up close: inspection only)
    'above-behind': { target: [0, 1.0, 0.9], cam: [2.6, 7.4, 7.6], fov: 44 },   // the owner's reference (renders/refs/sloop-above-behind.webp): high over the starboard quarter
    pedestal: { target: [0, 1.15, 2.45], cam: [0.75, 0.55, 1.1], fov: 42 },
    'hatch-down': { target: [0, 0.4, 1.1], cam: [0.25, 1.7, 0.9], fov: 50 },
    companionway: { target: [0, 0.9, 1.35], cam: [0.35, 1.0, 1.7], fov: 50 },
    chainplate: { target: [HULL.chainplateX, HULL.sideDeckY + 0.15, HULL.mastStepZ], cam: [0.9, 0.6, 1.2], fov: 40 },
  };
  shotsMemo.set(dims, S);
  return S;
}
export const SHOTS = shotsFor(DEFAULT_DIMS);

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Returns { pos, target, up, fov, near } (world) for a named shot, or null.
export function shotPose(name, boat) {
  const dims = boat.dims ?? DEFAULT_DIMS, s = shotsFor(dims)[name], { RIG } = dims;
  if (!s) return null;
  boat.updateMatrixWorld(true);
  const pivot = boat.heelPivot;
  let tgt;
  if (s.target === 'boomend') {
    const b = boat.modules.rigging?.getObjectByName?.('boom');
    tgt = b ? b.localToWorld(new THREE.Vector3(0, 0, RIG.boom + 0.05)) : pivot.localToWorld(v3([0, 2.5, 2.6]));
    const local = pivot.worldToLocal(tgt.clone());
    const side = Math.sign(local.x) || 1;   // look from the boom's own side
    const cam = pivot.localToWorld(local.clone().add(v3([s.cam[0] * side, s.cam[1], s.cam[2]])));
    return { pos: cam.toArray(), target: tgt.toArray(), up: [0, 1, 0], fov: s.fov, near: 0.05 };
  }
  tgt = pivot.localToWorld(v3(s.target));
  const cam = pivot.localToWorld(v3(s.target).add(v3(s.cam)));
  return { pos: cam.toArray(), target: tgt.toArray(), up: [0, 1, 0], fov: s.fov, near: 0.05 };
}
