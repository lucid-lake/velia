// A single helmsman, seated aft by the wheel, in muted foul-weather colours: a cap, a jacket, dark trousers and boots.
// The screen rules forbid humans up close, so the figure exists only at a distance: hidden while the camera is within
// FAR_M of the boat (the helm view, the close orbits and shots) and shown beyond it, with a hysteresis so it never
// flickers at the line. ?crew=1 forces it on and ?crew=0 off (captures and tests).
// The figure is a hull-frame group (metres, +y up, the bow toward −z), four merged meshes (one per colour).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CREW = { farM: 25, band: 1.5, hips: [0.66, 0.95, 3.12] };   // hull-frame hips (the starboard stern seat's front edge)

const COLOURS = { jacket: 0x4D5A56, trousers: 0x363D4A, cap: 0x1F2A3E, skin: 0xB48A6E, boot: 0x1E1F22, hair: 0x4A3B30 };

function capsule(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(len, 1e-4), 4, seg);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  const m = A.clone().add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}
function ellipsoid(c, r, sx = 1, sy = 1, sz = 1, wSeg = 12, hSeg = 8) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg);
  g.scale(sx, sy, sz); g.translate(...c);
  return g;
}

// The figure's parts in its own frame: origin at the hips, the body facing −z (forward), +y up.
function parts() {
  const P = { jacket: [], trousers: [], cap: [], skin: [], boot: [], hair: [] };
  const lean = 0.12;                                              // the torso leans a little forward (rad)
  const up = (h) => [0, h * Math.cos(lean), -h * Math.sin(lean)];  // a point h up the spine
  const sh = up(0.52), neck = up(0.60), head = up(0.72);
  // pelvis and seat
  P.trousers.push(ellipsoid([0, 0.04, 0], 0.15, 1.15, 0.7, 0.95));
  // thighs forward (seated), shins down to the boots
  for (const s of [-1, 1]) {
    const hip = [s * 0.095, 0.03, 0], knee = [s * 0.11, 0.05, -0.42], foot = [s * 0.12, -0.38, -0.47];
    P.trousers.push(capsule(hip, knee, 0.072), capsule(knee, foot, 0.058));
    P.boot.push(ellipsoid([foot[0], foot[1] - 0.045, foot[2] - 0.04], 0.06, 0.9, 0.62, 1.7));
  }
  // torso: a jacket, broader at the shoulders, with a collar
  P.jacket.push(capsule([0, 0.08, 0], up(0.40), 0.150));
  P.jacket.push(ellipsoid(sh, 0.17, 1.35, 0.55, 0.85));           // shoulders
  P.jacket.push(ellipsoid(up(0.585), 0.07, 1.4, 0.7, 1.2));        // the collar
  // head, neck, cap with a peak
  P.skin.push(capsule(up(0.56), up(0.64), 0.04));
  P.skin.push(ellipsoid([head[0], head[1], head[2]], 0.093, 0.92, 1.08, 1.0));
  P.hair.push(ellipsoid([head[0], head[1] + 0.01, head[2] + 0.03], 0.088, 0.95, 0.95, 0.9));
  P.cap.push(ellipsoid([head[0], head[1] + 0.045, head[2] - 0.004], 0.1, 1.0, 0.62, 1.04));      // the crown
  const peak = new THREE.CylinderGeometry(0.085, 0.085, 0.008, 14, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
  peak.rotateX(0); peak.rotateY(Math.PI); peak.scale(1, 1, 1.15); peak.translate(head[0], head[1] + 0.052, head[2] - 0.075);
  P.cap.push(peak);
  // arms: the left (to starboard of the helm, nearer the wheel) reaches forward and across to the rim; the right rests on the thigh
  const wheelHand = [-0.34, 0.36, -0.55];                          // relative to the hips: toward the wheel's rim, forward and left
  const shL = [-0.20, sh[1] - 0.01, sh[2]], shR = [0.20, sh[1] - 0.01, sh[2]];
  const elL = [-0.30, sh[1] - 0.16, sh[2] - 0.20], elR = [0.27, sh[1] - 0.22, sh[2] - 0.10];
  P.jacket.push(capsule(shL, elL, 0.052), capsule(elL, [wheelHand[0] + 0.02, wheelHand[1] - 0.02, wheelHand[2] + 0.06], 0.045));
  P.jacket.push(capsule(shR, elR, 0.052), capsule(elR, [0.15, 0.15, -0.30], 0.045));
  P.skin.push(ellipsoid(wheelHand, 0.04, 1.0, 0.8, 1.2), ellipsoid([0.15, 0.13, -0.34], 0.04, 1.0, 0.8, 1.2));
  return P;
}

export function createCrew() {
  const group = new THREE.Group(); group.name = 'crew';
  const P = parts();
  for (const [k, list] of Object.entries(P)) {
    if (!list.length) continue;
    const geos = list.map((g) => { const n = g.index ? g.toNonIndexed() : g; return n; });
    const geo = mergeGeometries(geos.map((g) => { g.deleteAttribute('uv'); return g; }), false);
    const mat = new THREE.MeshStandardNodeMaterial({ color: COLOURS[k], roughness: k === 'skin' ? 0.62 : k === 'boot' ? 0.5 : 0.82, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat); mesh.name = `crew-${k}`; mesh.frustumCulled = true;
    group.add(mesh);
  }
  group.position.set(...CREW.hips);
  group.visible = false;
  return group;
}

// Shows the figure beyond CREW.farM of the camera (hysteresis), hides it inside; `force` (?crew=) overrides.
export function crewLod(boat, group, force = null) {
  const p = new THREE.Vector3();
  let shown = false;
  return {
    update(cameraPos) {
      let want;
      if (force != null) want = force;
      else {
        boat.getWorldPosition(p);
        const d = p.distanceTo(cameraPos);
        want = shown ? d > CREW.farM - CREW.band : d > CREW.farM + CREW.band;
      }
      if (want !== shown) { shown = want; group.visible = shown; }
      return shown;
    },
  };
}
