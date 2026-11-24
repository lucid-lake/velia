// The paddler's key poses (feat/kayak-paddler): the blocking stage. Each pose is
// data in the kayak frame (x starboard, y up, z aft; the bow at −z), measured from the seat anchor (the hips' spot on the
// seat, kayak.anchors.seat), so a later spline or state machine blends numbers, never meshes.
//
//   pose = {
//     c: [x, y, z]     the shaft's middle (m, from the seat anchor)
//     e                the shaft's elevation (°): + the starboard end up (a port stroke), − down (a starboard stroke)
//     yaw              the shaft's plan angle (°): + the starboard end forward (toward the bow)
//     roll             the shaft's roll about itself (°): 0 the starboard power face looks aft, −feather the port one does
//     twist, lean, side  the chest (°): twist + the right shoulder forward, lean + forward, side + toward starboard
//     head: [yaw, pitch]  the head in the kayak frame (°): yaw + toward starboard, pitch + up
//     hip, heelL, heelR    the hip joints' middle and the heels (m, from the seat anchor)
//   }
//   paddleFrame(pose, seat, feather) → { position, quaternion, dir }   the paddle group's transform in the kayak frame
//   mirror(pose, feather) → the same pose on the other side
// The key poses themselves are data in the shared sim (src/sim/props/paddler/keyPoses.js); this module adds the paddle's
// three.js transform.
import * as THREE from 'three/webgpu';
import { KEY_POSES, mirror } from '../../../../src/sim/props/paddler/keyPoses.js';

export { KEY_POSES, mirror };

const D = Math.PI / 180;

// the shaft's direction (toward its starboard end) from the elevation and the plan angle
function shaftDir(e, yaw, out = new THREE.Vector3()) {
  const ce = Math.cos(e * D);
  return out.set(ce * Math.cos(yaw * D), Math.sin(e * D), -ce * Math.sin(yaw * D)).normalize();
}

// the paddle group's transform in the kayak frame: x along the shaft; the starboard power face (+z of the paddle frame) as
// near aft as the shaft allows, then the roll about the shaft
export function paddleFrame(p, seat, out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), dir: new THREE.Vector3() }) {
  const x = shaftDir(p.e, p.yaw, out.dir);
  const aft = new THREE.Vector3(0, 0, 1);
  const z = aft.addScaledVector(x, -aft.dot(x)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  out.quaternion.setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (p.roll ?? 0) * D));
  out.position.set(seat.x + p.c[0], seat.y + p.c[1], seat.z + p.c[2]);
  return out;
}
