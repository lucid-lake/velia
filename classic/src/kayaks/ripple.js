// A kayak's bow ripple (feat/kayaks-lake step 2b): a small V of broken water off the bow, cheap and
// deterministic. Two thin strips from the stem out and aft at 38° each side (a slow hull's diverging bow waves open wider
// than the 19° Kelvin envelope, and a narrower V hid along the hull: owner 2026-11-08, "a V spreading from the bow"), bright at the stem and
// fading along each arm (in wavelets) and across it (a soft ridge) (vertex colours, added onto the water: no texture, no depth write). It grows with
// the kayak's speed (nothing at rest, full at a cruise's 1.3 m/s, longer at a sprint) and swells a little with each pull
// (the stroke's phase: two pulls a cycle). One mesh per full kayak (at most three), a child of the kayak's group at the
// waterline, so it rides the hull's heave, pitch and roll.
//
//   const r = createBowRipple({ length: 3.4, waterY })   // r.mesh: add to the kayak's group
//   r.update({ v, phase, light, camera })                 // light 0–1: the day's (dark at night: no glowing foam); camera: its position
//   r.dispose()
import * as THREE from 'three/webgpu';

const DEG = Math.PI / 180, _w = new THREE.Vector3();
export const RIPPLE = Object.freeze({ half: 38 * Math.PI / 180, arm: 1.8, width: [0.05, 0.24], seg: 16, bright: 0.9, stemIn: 0.12, lift: 0.004 });

let SHARED = null;
function rippleGeometry(R = RIPPLE) {
  if (SHARED) return SHARED;
  const pos = [], col = [], idx = [];
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= R.seg; i++) {
      const u = i / R.seg, along = u * R.arm, w = R.width[0] + (R.width[1] - R.width[0]) * u;
      // the arm's centre line: out at the half angle, aft (+z); three points across it: soft inner edge, the crest, a
      // softer outer edge, so the arm is a soft ridge, not a hard strip; broken into wavelets along it
      const cx = side * Math.sin(R.half) * along, cz = Math.cos(R.half) * along;
      const nx = side * Math.cos(R.half), nz = -Math.sin(R.half);
      const fade = (1 - u) ** 1.3 * Math.min(1, u * 5 + 0.3) * (0.55 + 0.45 * Math.cos(u * Math.PI * 6) ** 2);
      for (const [e, k] of [[-0.5, 0], [0.1, 1], [0.5, 0.25]]) {
        pos.push(cx + nx * w * e, 0, cz + nz * w * e);
        col.push(fade * k, fade * k, fade * k);
      }
    }
    for (let i = 0; i < R.seg; i++) {
      const a = base + 3 * i, b = a + 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  SHARED = g;
  return g;
}

export function createBowRipple({ length = 3.4, waterY = 0, R = RIPPLE } = {}) {
  const mat = new THREE.MeshBasicNodeMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  mat.color.setScalar(0);
  const mesh = new THREE.Mesh(rippleGeometry(R), mat);
  mesh.name = 'kayak-bow-ripple'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  mesh.position.set(0, waterY + R.lift, -length / 2 + R.stemIn);
  return {
    mesh,
    update({ v = 0, phase = 0, light = 1, camera = null } = {}) {
      const s = Math.max(0, Math.min(1.6, v / 1.3));
      const pulse = 1 + 0.18 * Math.sin(phase * Math.PI * 4);   // two pulls a cycle
      mesh.visible = s > 0.04 && light > 0.02;
      mesh.scale.set(0.8 + 0.25 * s, 1, (0.45 + 0.55 * s) * pulse);
      // seen low and near across the water a flat V reads as floating bars (real ones hide in the chop): it fades in with the
      // view's height over it (8–18° down from afar, the follow camera; 24–34° from under 14 m, a camera on the water)
      let view = 1;
      if (camera) { mesh.getWorldPosition(_w); const hd = Math.hypot(camera.x - _w.x, camera.z - _w.z), el = Math.atan2(camera.y - _w.y, hd), lo = (hd < 14 ? 24 : 8) * DEG; view = Math.min(1, Math.max(0, (el - lo) / (10 * DEG))); view = view * view * (3 - 2 * view); }
      mat.color.setScalar(R.bright * Math.min(1, s) * light * view * (0.85 + 0.15 * pulse));
    },
    dispose() { mat.dispose(); },
  };
}
