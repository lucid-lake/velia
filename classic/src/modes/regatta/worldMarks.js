// The on-the-water pieces (owner, 2026-10-30): Osprey's name tag, the next mark's label and beacon, the dashed guide line to the next
// rounding point, and the start line (faint; amber while the boat is over early). THREE objects; the models are in src/race/newbie.js.
import * as THREE from 'three/webgpu';
import { dashSegments } from '../../../../src/sim/race/newbie.js';

const NAVY = '#1C2340', CREAM = '#EFE6D2';
function textSprite(text, { w = 512, h = 96, size = 46 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(28,35,64,0.88)'; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 22); g.fill();
  g.strokeStyle = 'rgba(239,230,210,0.35)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = CREAM; g.font = `500 ${size}px Jost, "Helvetica Neue", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const s = new THREE.Sprite(m); s.renderOrder = 50; s.frustumCulled = false; s.userData.aspect = w / h;
  return s;
}

export function createWorldMarks({ core, course, rival, sail, marks }) {
  const { scene } = core, group = new THREE.Group(); group.name = 'regatta-guides'; scene.add(group);
  const tag = textSprite('OSPREY · 17', { w: 400, h: 90, size: 48 }); group.add(tag);
  const label = textSprite('Round ↺ — keep it on your left', { w: 760, h: 96, size: 44 }); label.visible = false; group.add(label);
  let labelText = '';
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 28, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xf7c060, transparent: true, opacity: 0.28, depthWrite: false })); beacon.visible = false; group.add(beacon);
  const N = 80, guideGeo = new THREE.BufferGeometry(); guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3)); guideGeo.setDrawRange(0, 0);
  const guide = new THREE.LineSegments(guideGeo, new THREE.LineBasicMaterial({ color: 0xefe6d2, transparent: true, opacity: 0.85, depthWrite: false })); guide.frustumCulled = false; group.add(guide);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(course.line.committee[0], 0.5, course.line.committee[1]), new THREE.Vector3(course.line.pin[0], 0.5, course.line.pin[1])]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xefe6d2, transparent: true, opacity: 0.4, depthWrite: false }), startLine = new THREE.Line(lineGeo, lineMat); startLine.frustumCulled = false; group.add(startLine);
  const markPos = (id) => { const m = marks.field.get(id); return m ? [m.body.p[0], m.body.p[2]] : null; };
  const camPos = new THREE.Vector3();
  return {
    group,
    // s: { guide: { label, at, wp } | null, guideOn, ocs, lineOn, tagOn }
    update(s) {
      const r = rival.phys.state;
      core.camera.getWorldPosition(camPos);
      const d = Math.hypot(camPos.x - r.x, camPos.z - r.z);
      tag.visible = s.tagOn !== false; tag.position.set(r.x, 17, r.z);
      tag.material.opacity = Math.min(1, Math.max(0, 1 - (d - 120) / 260)); tag.scale.set(Math.max(4, d * 0.075) * tag.userData.aspect * 0.5, Math.max(4, d * 0.075) * 0.5, 1);
      const g = s.guide;
      if (g) {
        const at = markPos(g.mark) ?? [g.at.x, g.at.z], dm = Math.hypot(camPos.x - at[0], camPos.z - at[1]), k = Math.max(5, dm * 0.05);
        label.visible = true; label.position.set(at[0], 8 + k * 0.4, at[1]); label.scale.set(k * label.userData.aspect * 0.8, k * 0.8, 1);
        if (labelText !== g.label) { labelText = g.label; const c = label.material.map.image.getContext('2d'), W = label.material.map.image.width, H = label.material.map.image.height; c.clearRect(0, 0, W, H); c.fillStyle = 'rgba(28,35,64,0.88)'; c.beginPath(); c.roundRect(4, 4, W - 8, H - 8, 22); c.fill(); c.strokeStyle = 'rgba(239,230,210,0.35)'; c.lineWidth = 3; c.stroke(); c.fillStyle = CREAM; c.font = '500 44px Jost, "Helvetica Neue", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(g.label.replace('⟲', '↺').replace('⟳', '↻'), W / 2, H / 2 + 2); label.material.map.needsUpdate = true; }
        beacon.visible = true; beacon.position.set(at[0], 14, at[1]);
        if (s.guideOn) {
          const segs = dashSegments([sail.phys.state.x, sail.phys.state.z], g.wp, 3, 3).slice(0, N), a = guideGeo.attributes.position.array;
          segs.forEach((q, i) => { a.set([q[0], 0.4, q[1], q[2], 0.4, q[3]], i * 6); });
          guideGeo.attributes.position.needsUpdate = true; guideGeo.setDrawRange(0, segs.length * 2); guide.visible = true;
        } else guide.visible = false;
      } else { label.visible = false; beacon.visible = false; guide.visible = false; }
      startLine.visible = !!s.lineOn;
      lineMat.color.set(s.ocs ? 0xf7c060 : 0xefe6d2); lineMat.opacity = s.ocs ? 0.95 : 0.4;
    },
    dispose() { scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }); },
  };
}
