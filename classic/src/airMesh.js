// The drawing of src/air.js: two meshes, two draw calls. The motes (pollen, fluff, crest wisps) are camera-facing soft
// squares, the lines thin camera-facing ribbons that taper at both ends; both are rebuilt on the CPU each frame from
// the sim's arrays (a few hundred quads), depth-tested, no depth write, unlit (the colour carries the daylight level).
//   const air = createAirMesh({ lum });  scene.add(air.group);   // userData.daylight is hooked (core.daylight.collect)
//   each frame, after the camera is placed: air.draw(sim, camera)
import * as THREE from 'three/webgpu';
import { attribute, uniform, vec3, float, uv, smoothstep, mix, length as vlen, abs } from 'three/tsl';

function batch(nQuads) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(nQuads * 12), tex = new Float32Array(nQuads * 8), alpha = new Float32Array(nQuads * 4), tint = new Float32Array(nQuads * 4);
  const idx = new Uint32Array(nQuads * 6);
  for (let q = 0; q < nQuads; q++) {
    const v = q * 4; idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    tex.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
  }
  const pa = new THREE.BufferAttribute(pos, 3), aa = new THREE.BufferAttribute(alpha, 1), ta = new THREE.BufferAttribute(tint, 1);
  for (const a of [pa, aa, ta]) a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('uv', new THREE.BufferAttribute(tex, 2)); g.setAttribute('aAlpha', aa); g.setAttribute('aTint', ta);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // never culled
  return { g, pos, alpha, tint, pa, aa, ta };
}

export function createAirMesh({ lum = 0.15 } = {}) {
  const group = new THREE.Group(); group.name = 'air';
  const K = lum * 3.9;   // the spray's scale: sunlit pale things at the scene's luminance
  const light = uniform(1);
  const pollen = uniform(new THREE.Color(0xe8c25a).multiplyScalar(K)), white = uniform(new THREE.Color(0xf4f2ec).multiplyScalar(K));
  const lineCol = uniform(new THREE.Color(0xdfe8f2).multiplyScalar(K));
  const mk = () => { const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }); m.fog = false; return m; };

  // motes
  const mm = mk(), nm = 0;
  const tint = attribute('aTint', 'float'), aA = attribute('aAlpha', 'float');
  mm.colorNode = mix(pollen, white, tint).mul(light);
  mm.opacityNode = float(1).sub(smoothstep(0.04, 0.5, vlen(uv().sub(0.5)))).mul(aA);
  let motes = null, lines = null;
  const lm = mk();
  lm.colorNode = lineCol.mul(light);
  const ux = uv().x, uy = uv().y;
  lm.opacityNode = smoothstep(0.0, 0.55, ux).mul(float(1).sub(smoothstep(0.82, 1.0, ux))).mul(float(1).sub(abs(uy.mul(2).sub(1)))).mul(aA);

  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  let mB = null, lB = null, mesh1 = null, mesh2 = null;
  function ensure(sim) {
    if (mB) return;
    mB = batch(sim.motes.n); lB = batch(sim.lines.n);
    mesh1 = new THREE.Mesh(mB.g, mm); mesh2 = new THREE.Mesh(lB.g, lm);
    for (const m of [mesh1, mesh2]) { m.frustumCulled = false; m.name = m === mesh1 ? 'air-motes' : 'air-lines'; }
    mesh1.renderOrder = 6; mesh2.renderOrder = 6;
    mesh1.visible = false;   // no motes at all (owner, 2026-10-30: the pollen, the fluff and the crest wisps read as floating squares)
    group.add(mesh1, mesh2);
  }

  function draw(sim, camera) {
    ensure(sim);
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    right.set(e[0], e[1], e[2]); up.set(e[4], e[5], e[6]); fwd.set(-e[8], -e[9], -e[10]);
    const cx = e[12], cy = e[13], cz = e[14];
    const M = sim.motes, P = mB.pos;
    for (let i = 0; i < (mesh1.visible ? M.n : 0); i++) {
      const s = M.alpha[i] > 0.002 ? M.size[i] * 1.0 : 0, o = i * 12;
      const x = M.x[i], y = M.y[i], z = M.z[i];
      const rx = right.x * s, ry = right.y * s, rz = right.z * s, ux_ = up.x * s, uy_ = up.y * s, uz_ = up.z * s;
      P[o] = x - rx - ux_; P[o + 1] = y - ry - uy_; P[o + 2] = z - rz - uz_;
      P[o + 3] = x + rx - ux_; P[o + 4] = y + ry - uy_; P[o + 5] = z + rz - uz_;
      P[o + 6] = x + rx + ux_; P[o + 7] = y + ry + uy_; P[o + 8] = z + rz + uz_;
      P[o + 9] = x - rx + ux_; P[o + 10] = y - ry + uy_; P[o + 11] = z - rz + uz_;
      // pollen is not drawn (owner, 2026-10-30: "remove the pollen motes completely"); the fluff (tint 1) and wisps stay
      const t = M.tint[i], a = t < 0.5 ? 0 : M.alpha[i], v = i * 4;
      for (let k = 0; k < 4; k++) { mB.alpha[v + k] = a; mB.tint[v + k] = t; }
    }
    mB.pa.needsUpdate = mB.aa.needsUpdate = mB.ta.needsUpdate = true;
    const S = sim.lines, Q = lB.pos;
    for (let j = 0; j < S.n; j++) {
      const o = j * 12, v = j * 4, a = S.alpha[j];
      if (a <= 0.002) { for (let k = 0; k < 12; k++) Q[o + k] = 0; for (let k = 0; k < 4; k++) lB.alpha[v + k] = 0; continue; }
      const dx = S.bx[j] - S.ax[j], dy = S.by[j] - S.ay[j], dz = S.bz[j] - S.az[j];
      const mx = (S.ax[j] + S.bx[j]) * 0.5 - cx, my = (S.ay[j] + S.by[j]) * 0.5 - cy, mz = (S.az[j] + S.bz[j]) * 0.5 - cz;
      // side = dir × toCam, normalised; the ribbon is ≈ 1.2 px wide
      let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;
      const sl = Math.hypot(sx, sy, sz) || 1, dist = Math.hypot(mx, my, mz), hw = 0.5 * 2.3 * 0.0013 * dist / sl;
      sx *= hw; sy *= hw; sz *= hw;
      Q[o] = S.ax[j] - sx; Q[o + 1] = S.ay[j] - sy; Q[o + 2] = S.az[j] - sz;
      Q[o + 3] = S.bx[j] - sx; Q[o + 4] = S.by[j] - sy; Q[o + 5] = S.bz[j] - sz;
      Q[o + 6] = S.bx[j] + sx; Q[o + 7] = S.by[j] + sy; Q[o + 8] = S.bz[j] + sz;
      Q[o + 9] = S.ax[j] + sx; Q[o + 10] = S.ay[j] + sy; Q[o + 11] = S.az[j] + sz;
      for (let k = 0; k < 4; k++) lB.alpha[v + k] = a;
    }
    lB.pa.needsUpdate = lB.aa.needsUpdate = true;
  }

  // D2: the colour × the daylight level (1 by day); the sun's share dims it at dusk
  // the sky's own light, not the starlit night's floor (round 3: under the floor the lines read as white dashes on the
  // night water; they are sunlit motes and wind ribbons, nothing to see in the dark)
  group.userData.daylight = (f) => { const l = f.lightRaw ?? f.light; light.value = l * (0.45 + 0.55 * (f.sunShare ?? 1)); group.userData.light = l; };
  // prepare(sim): the meshes made now (empty: alpha 0), not on the first draw, so the load's shader warm-up builds them
  // (fix/first-visit-hitches: the wind lines built 2 pipelines in play, in the water probe's first re-capture)
  return { group, draw, prepare: (sim) => ensure(sim), uniforms: { light, pollen, white, lineCol }, get mesh() { return [mesh1, mesh2]; } };
}
