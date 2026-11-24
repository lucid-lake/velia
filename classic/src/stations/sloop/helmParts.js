// The helm station's 3D parts from the boat's own models (refactor round 2, Phase D: moved unchanged from helmStation.js):
// the winches cut from cockpit.glb, the sheet's rope on the drum, the handle, a material by name.
import * as THREE from 'three/webgpu';
import { uv, fract, step, mix, color, float } from 'three/tsl';

// ---- the boat's own parts, for the station ----------------------------------------------------------------------------
// The winch at (x, z) cut from the cockpit's near-LOD meshes: every triangle inside its cylinder, its own materials; the axis at
// the origin, the base at y = 0.
export function cutWinch(cockpit, spec) {
  cockpit.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(cockpit.matrixWorld).invert();
  const out = new THREE.Group(); out.name = 'winch';
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  cockpit.traverse((o) => {
    if (!o.isMesh || !/^near_/.test(o.name)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), nm = new THREE.Matrix3().getNormalMatrix(m);
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, uvA = g.attributes.uv, idx = g.index;
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m); P[3 * i] = v.x; P[3 * i + 1] = v.y; P[3 * i + 2] = v.z; }
    const ins = (i) => Math.hypot(P[3 * i] - spec.x, P[3 * i + 2] - spec.z) < spec.r && P[3 * i + 1] > spec.y0 - 0.01 && P[3 * i + 1] < spec.y1;
    const tri = idx ? idx.count / 3 : pos.count / 3, at = (k) => (idx ? idx.getX(k) : k);
    const keep = [];
    for (let t = 0; t < tri; t++) { const a = at(3 * t), b = at(3 * t + 1), c = at(3 * t + 2); if (ins(a) && ins(b) && ins(c)) keep.push(a, b, c); }
    if (!keep.length) return;
    const map = new Map(), vp = [], vn = [], vu = [], ix = [];
    for (const k of keep) {
      let j = map.get(k);
      if (j == null) {
        j = map.size; map.set(k, j);
        vp.push(P[3 * k] - spec.x, P[3 * k + 1] - spec.y0, P[3 * k + 2] - spec.z);
        if (nor) { n.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); vn.push(n.x, n.y, n.z); }
        if (uvA) vu.push(uvA.getX(k), uvA.getY(k));
      }
      ix.push(j);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vp, 3));
    if (vn.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(vn, 3)); else geo.computeVertexNormals();
    if (vu.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(vu, 2));
    geo.setIndex(ix);
    const mesh = new THREE.Mesh(geo, o.material); mesh.name = `winch:${o.name}`;
    out.add(mesh);
  });
  return out;
}

// the sheet: a cream braid with a navy tracer; its fleck runs along the tail as the sheet moves (run: metres of sheet)
export function ropeMaterial(run) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0 });
  const t = uv();
  const fleck = step(0.86, fract(t.x.mul(run.len).add(t.y.mul(1)).add(run.u)));
  const braid = step(0.5, fract(t.x.mul(run.len).mul(2).sub(t.y.mul(2))));
  m.colorNode = mix(mix(color(0xe8e2d2), color(0xd8d1bf), braid.mul(float(0.6))), color(0x2b345d), fleck);
  return m;
}
const tube = (pts, r, seg = 64) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 8, false);

// the drum's turns (a helix of `turns` round the waist) and the tail, off the top toward the trimmer, then down out of sight
export function sheetParts(spec, mat) {
  const [r, ya, yb] = spec.drum, turns = 3.2, rr = 0.0055;
  const hel = [];
  for (let i = 0; i <= 96; i++) { const f = i / 96, a = f * turns * 2 * Math.PI; hel.push(new THREE.Vector3(Math.cos(a) * (r + rr), ya + (yb - ya) * f, Math.sin(a) * (r + rr))); }
  const top = spec.y1 - spec.y0 - 0.03;
  const tail = [new THREE.Vector3(spec.r * 0.7, top, 0.0), new THREE.Vector3(spec.r * 1.25, top - 0.004, 0.05), new THREE.Vector3(spec.r * 1.6, top - 0.03, 0.14), new THREE.Vector3(spec.r * 1.8, top - 0.16, 0.28)];
  return { turns: new THREE.Mesh(tube(hel, rr, 160), mat), tail: new THREE.Mesh(tube(tail, rr, 40), mat) };
}

// the winch handle in its socket: a polished arm to a black grip, turning with the drum
export function handle(spec, steel, black) {
  const g = new THREE.Group(); g.name = 'handle';
  const top = spec.y1 - spec.y0;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, spec.handle, 6, 16), steel); arm.rotation.z = Math.PI / 2; arm.position.set(spec.handle / 2, top + 0.014, 0);
  const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.03, 20), steel); sock.position.set(0, top + 0.004, 0);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.016, 0.085, 20), black); grip.position.set(spec.handle - 0.004, top + 0.06, 0);
  g.add(arm, sock, grip);
  g.userData.grip = new THREE.Vector3(spec.handle - 0.004, top + 0.06, 0);
  return g;
}
export const findMat = (root, re) => { let m = null; root.traverse((o) => { if (!m && o.isMesh && re.test(o.material?.name ?? '')) m = o.material; }); return m; };
