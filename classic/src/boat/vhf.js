// The VHF set (owner, 2026-10-29): a small fixed-mount marine radio on the pedestal guard, starboard of the
// instrument pod, its face toward the helm. A dark body, a speaker grille, two knobs, and a small LCD: the channel
// ("16" on watch, "WX 1" on the weather channel) and the forecast's words scrolling as they are spoken. That is the
// only text, on the set itself (the instrument pod's rule). The face is one canvas texture, redrawn at
// most 10× a second and only when the LCD changes.
//   const vhf = createVhf(); boat.sockets.hull.add(vhf.group); vhf.update({ channel, text, charAt, rx }, tReal)
import * as THREE from 'three/webgpu';
import { faceGain } from '../../../src/boat/nightLight.js';
import { VHF, lcdView, drawFace } from '../../../src/boat/vhfFace.js';   // the pure half (v2 draws the same face)

const DEG = Math.PI / 180;
export { VHF, lcdView, drawFace };

export function createVhf() {
  const V = VHF;
  const group = new THREE.Group(); group.name = 'vhf';
  const set = new THREE.Group(); set.position.set(...V.at); set.rotation.x = -V.tiltDeg * DEG; group.add(set);   // the face tilts up and aft, toward the helm's eye
  const body = new THREE.Mesh(new THREE.BoxGeometry(V.w, V.h, V.d), new THREE.MeshStandardNodeMaterial({ color: 0x1b1e22, roughness: 0.55 }));
  body.position.z = -V.d / 2; set.add(body);
  // the mounting bracket: a U strap down to the guard
  const strap = new THREE.Mesh(new THREE.BoxGeometry(V.w + 0.012, 0.008, V.d * 0.7), new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 }));
  strap.position.set(0, -V.h / 2 - 0.004, -V.d / 2); set.add(strap);
  // a stub antenna lead out of the back, and the mic's coiled cord would be next; the antenna itself is on the stern rail
  const c = document.createElement('canvas'); [c.width, c.height] = V.px;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(V.w * 0.96, V.h * 0.92), new THREE.MeshBasicNodeMaterial({ map: tex }));
  face.position.z = 0.0006; face.name = 'vhf-face'; set.add(face);
  // the LCD's backlight held at its on-screen level, dim by night (fix/helm-view-cockpit; src/boat/nightLight.js): an unlit face
  // is its value × the exposure, ≈ 360 × the day's under −12°
  group.userData.daylight = (f) => { face.material.color.setScalar(faceGain(f)); };
  let last = '', acc = 1;
  const api = { group, face, set, update, get lcd() { return last; } };
  function update(state = {}, dt = 0) {
    acc += dt; if (acc < 1 / V.hz) return;
    acc = 0;
    const view = lcdView(state);
    const key = `${view.big}|${view.tag}|${view.line}`;
    if (key === last) return;
    last = key;
    drawFace(g, V.px[0], V.px[1], view); tex.needsUpdate = true;
  }
  drawFace(g, V.px[0], V.px[1], lcdView({})); tex.needsUpdate = true;
  return api;
}
