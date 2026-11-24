// The paddler's figure (feat/kayak-paddler). Two sources, one rig:
//   'ubc' (the default since 2026-11-07): Quaternius' CC0 Universal Base Characters, a man and a woman (models/paddler/
//         ubc-{male,female}.glb from tools/paddler-build-ubc.py; ATTRIBUTION.md): natural stylised proportions, real hands,
//         a calm face, a short haircut and brows. Dressed in the material: a short-sleeve top and shorts painted on the
//         body by region, the clothed skin smoothed (Taubin) so no superhero muscle shows through, neoprene booties;
//   'man' (the first round's): Quaternius' CC0 "Man" (models/paddler/paddler.glb), one Loop subdivision step, no eyes.
// Both get our own PFD fitted to the torso (skinned to the same bones, so it twists with the chest), a cap on the head
// bone, seeded colours (look.js).
//
//   buildFigure(gltf, look, materials) → { root, scene, bones, meshes, pfd, hat, heightM, M, profile }
//     root: a Group in the kayak frame's orientation (faces −z, metres); the GLB's scene inside it, scaled
//     bones: by name (UpperArmL, LowerArmL, MiddleHandL, …; GLTFLoader drops the dots of Blender's names)
//
// Model space (the GLB at rest): y up, the figure faces +z, 4.82 units tall. Every fit here is measured from the mesh.
import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loopSubdivide } from './subdivide.js';

const FIGURE_HEIGHT_M = 1.76;

// every vertex of a skinned mesh at rest, in model space, with its dominant bone's name
function restVertices(mesh) {
  const p = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const out = [], v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld);
    let best = 0, bi = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > best) { best = w; bi = si.getComponent(i, k); } }
    out.push({ p: v.clone(), bone: mesh.skeleton.bones[bi]?.name, i });
  }
  return out;
}

// The PFD: a vest over the torso, fitted from the shirt's own vertices. Rings from the hem (just above the navel) to the
// collar; a full ring up to the armpits, then a front and a back panel narrowing to the shoulders, joined over each shoulder
// by a strap. Radii: the body's own (the max over an angular window), smoothed, plus the foam's thickness (thicker on the
// chest and back panels). Skinned to the nearest shirt vertex's bones. Attribute 'pfd' = (angle 0..1 from the front, height 0..1).
// (a generator, perf/enter-freeze: each yield a place a host may stop between tasks; runSteps runs it at once)
const runSteps = (it) => { for (;;) { const r = it.next(); if (r.done) return r.value; } };
const buildPfd = (shirt, torsoVerts, M) => runSteps(buildPfdSteps(shirt, torsoVerts, M));
function* buildPfdSteps(shirt, torsoVerts, M) {
  const yHem = M.hemY, yPit = M.armpitY, yTop = M.collarY;
  const NA = 48, NY = 16;
  const slices = [];
  for (let j = 0; j <= NY; j++) {
    const y = yHem + (yTop - yHem) * (j / NY);
    const band = torsoVerts.filter((t) => Math.abs(t.p.y - y) < 0.22 * M.u);
    let cx = 0, cz = 0; for (const t of band) { cx += t.p.x; cz += t.p.z; } cx /= band.length || 1; cz /= band.length || 1;
    cx = 0;   // symmetric
    const r = new Array(NA).fill(0);
    for (let a = 0; a < NA; a++) {
      const th = (a / NA) * Math.PI * 2, dx = Math.sin(th), dz = Math.cos(th);   // th 0: the front (+z)
      for (const t of band) {
        const ox = t.p.x - cx, oz = t.p.z - cz, along = ox * dx + oz * dz, across = Math.abs(-ox * dz + oz * dx);
        if (along > 0 && across < 0.12 * M.u + 0.25 * along) r[a] = Math.max(r[a], along);
      }
    }
    slices.push({ y, cx, cz, r });
    if (j % 6 === 5) yield 'pfd-rings';
  }
  // a stiff foam shell is smooth: each ring's radii low-passed (harmonics 0–3), lifted until no body point is outside it,
  // then smoothed between rings (each ring keeps its own lift as a floor)
  const raw = slices.map((s) => s.r.slice());
  const H = M.harmonics ?? 3;   // the UBC vest follows the torso closer (5)
  for (const s of slices) {
    const r = s.r, cs = [], sn = [];
    for (let h = 0; h <= H; h++) {
      let c = 0, d = 0; for (let a = 0; a < NA; a++) { const t = (a / NA) * Math.PI * 2 * h; c += r[a] * Math.cos(t); d += r[a] * Math.sin(t); }
      cs.push((h === 0 ? 1 : 2) * c / NA); sn.push((h === 0 ? 0 : 2) * d / NA);
    }
    const lp = r.map((_, a) => { let v = 0; for (let h = 0; h <= H; h++) { const t = (a / NA) * Math.PI * 2 * h; v += cs[h] * Math.cos(t) + sn[h] * Math.sin(t); } return v; });
    let lift = 0; for (let a = 0; a < NA; a++) lift = Math.max(lift, r[a] - lp[a]);
    for (let a = 0; a < NA; a++) r[a] = lp[a] + lift;
  }
  const lifted = slices.map((s) => s.r.slice());
  for (let pass = 0; pass < 3; pass++) {
    const R = slices.map((s) => s.r.slice());
    for (let j = 0; j <= NY; j++) for (let a = 0; a < NA; a++) {
      const lo = R[Math.max(0, j - 1)][a], hi = R[Math.min(NY, j + 1)][a];
      slices[j].r[a] = Math.max(lifted[j][a], raw[j][a], (lo + 2 * R[j][a] + hi) / 4);
    }
  }
  // the shell: three patches, so every edge is a clean curve (no staircase): the front's two halves (a zip between them,
  // opening to a V at the collar) and the back. Under the armpits the front and back meet at the sides (a full ring);
  // above, both narrow toward the collar (the armholes). Foam is thicker on the chest and back panels than at the sides.
  const rAt = (j, th) => {
    const f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * NA, a0 = Math.floor(f) % NA, a1 = (a0 + 1) % NA, w = f - Math.floor(f);
    return slices[j].r[a0] * (1 - w) + slices[j].r[a1] * w;
  };
  const hF0 = (M.sideGap ? Math.PI / 2 - M.sideGap / 2 : 0.47 * Math.PI);
  const widths = (j) => {
    const yv = (slices[j].y - yPit) / (yTop - yPit), t = Math.sqrt(Math.min(1, Math.max(0, yv)));
    return {
      hF: THREE.MathUtils.lerp(hF0, (M.armholeF ?? 0.27) * Math.PI, t), hB: THREE.MathUtils.lerp(M.sideGap ? hF0 : Math.PI - hF0, (M.armholeB ?? 0.31) * Math.PI, t),
      zip: yv > 0.45 ? 0.07 * Math.PI * ((yv - 0.45) / 0.55) ** 1.5 + 0.004 : 0.004,
    };
  };
  const pos = [], uv = [], idx = [];
  const patch = (from, to, cols) => {   // from/to: (j) → angle
    const start = pos.length / 3;
    for (let j = 0; j <= NY; j++) {
      const s = slices[j], v = j / NY, t0 = from(j), t1 = to(j);
      for (let k = 0; k <= cols; k++) {
        const th = t0 + (t1 - t0) * (k / cols);
        const thick = M.foam * (0.6 + 0.55 * Math.abs(Math.cos(th))) + (v < 0.12 ? M.foam * 0.25 * (1 - v / 0.12) : 0);
        const rr = rAt(j, th) + thick;
        pos.push(s.cx + Math.sin(th) * rr, s.y, s.cz + Math.cos(th) * rr);
        uv.push(((th / (Math.PI * 2)) % 1 + 1) % 1, v);
      }
    }
    const W = cols + 1;
    for (let j = 0; j < NY; j++) for (let k = 0; k < cols; k++) { const i0 = start + j * W + k, i1 = i0 + 1, i2 = i0 + W, i3 = i2 + 1; idx.push(i0, i1, i2, i1, i3, i2); }
  };
  patch((j) => widths(j).zip, (j) => widths(j).hF, 12);                                   // front, starboard half (+x)
  patch((j) => -widths(j).hF, (j) => -widths(j).zip, 12);                                 // front, port half
  patch((j) => Math.PI - widths(j).hB, (j) => Math.PI + widths(j).hB, 24);                // back
  // shoulder straps: a padded band from each front half's top over the shoulder to the back panel's top
  const strap = [];
  const top = widths(NY);
  for (const side of [-1, 1]) {
    const thF = side * (top.zip + (top.hF - top.zip) * 0.55), thB = Math.PI - side * top.hB * 0.6;
    const f = new THREE.Vector3(Math.sin(thF) * (rAt(NY, thF) + M.foam * 0.8), yTop - 0.02 * M.u, Math.cos(thF) * (rAt(NY, thF) + M.foam * 0.8));
    const b = new THREE.Vector3(Math.sin(thB) * (rAt(NY, thB) + M.foam * 0.8), yTop - 0.02 * M.u, Math.cos(thB) * (rAt(NY, thB) + M.foam * 0.8));
    const yS = M.shoulderTopY + M.foam * 0.35, xS = side * M.strapX;
    strap.push(new THREE.CatmullRomCurve3([f, new THREE.Vector3(xS, (yS + yTop) / 2 + 0.06 * M.u, f.z * 0.55 + b.z * 0.45 + (f.z - b.z) * 0.3), new THREE.Vector3(xS, yS, (f.z + b.z) / 2), new THREE.Vector3(xS, (yS + yTop) / 2 + 0.06 * M.u, b.z * 0.55 + f.z * 0.45 - (f.z - b.z) * 0.3), b]));
  }
  const base = new THREE.BufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  base.setAttribute('pfd', new THREE.Float32BufferAttribute(uv, 2));
  base.setIndex(idx);
  base.computeVertexNormals();   // smooth over the grid (a per-face normal reads as quilting blocks under the sun-side colour)
  // the side adjustment straps across the gaps (webbing: attribute x = 2, the material draws it dark), two a side
  if (M.sideGap) {
    for (const side of [-1, 1]) for (const fy of [0.18, 0.55]) {
      const j = Math.round(NY * fy), y = slices[j].y, a0 = side * (hF0 - 0.06), a1 = side * (Math.PI - hF0 + 0.06);
      const pts = [];
      for (let q = 0; q <= 6; q++) { const th = a0 + (a1 - a0) * (q / 6), rr = rAt(j, th) + M.foam * 0.55; pts.push(new THREE.Vector3(Math.sin(th) * rr, y, Math.cos(th) * rr)); }
      strap.push({ curve: new THREE.CatmullRomCurve3(pts), r: M.foam * 0.18, webbing: true });
    }
  }
  const parts = [base.toNonIndexed()];
  for (const c0 of strap) {
    const c = c0.curve ?? c0, web = !!c0.webbing;
    const g = new THREE.TubeGeometry(c, 20, c0.r ?? M.foam * 0.30, 8, false);   // a shoulder strap (≈ 1.1 cm round), a side strap (webbing)
    if (web) g.scale(1, 2.2, 1).translate(0, -c.getPoint(0.5).y * 1.2, 0);   // flat webbing ≈ 2.5 cm tall
    const p = g.attributes.position;
    g.deleteAttribute('uv');
    const n = p.count, a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[2 * i] = web ? 2 : 0.3; a[2 * i + 1] = 0.98; }
    g.setAttribute('pfd', new THREE.BufferAttribute(a, 2));
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  // merge (position + pfd), normals from the shape
  let count = 0; for (const g of parts) count += g.attributes.position.count;
  const P = new Float32Array(count * 3), NN = new Float32Array(count * 3), A = new Float32Array(count * 2);
  let o = 0; for (const g of parts) { P.set(g.attributes.position.array, o * 3); NN.set(g.attributes.normal.array, o * 3); A.set(g.attributes.pfd.array, o * 2); o += g.attributes.position.count; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('pfd', new THREE.BufferAttribute(A, 2)); geo.setAttribute('normal', new THREE.BufferAttribute(NN, 3));
  // skin it: each vertex takes the nearest torso vertex's four bones and weights (the shirt deforms the same way)
  const si = new Uint16Array(count * 4), sw = new Float32Array(count * 4), q = new THREE.Vector3();
  const sI = shirt.geometry.attributes.skinIndex, sW = shirt.geometry.attributes.skinWeight;
  yield 'pfd-shell';
  const per = Math.ceil(count / 8);
  for (let i = 0; i < count; i++) {
    if (i && i % per === 0) yield 'pfd-skin';
    q.set(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    let best = Infinity, bi = 0; for (const t of torsoVerts) { const d = t.p.distanceToSquared(q); if (d < best) { best = d; bi = t.i; } }
    for (let k = 0; k < 4; k++) { si[4 * i + k] = sI.getComponent(bi, k); sw[4 * i + k] = sW.getComponent(bi, k); }
  }
  // into the shirt's bind space
  const inv = shirt.matrixWorld.clone().invert();
  geo.applyMatrix4(inv);
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

// the hat in model space: a six-panel cap (a dome and a curved brim to the front) or a soft sun hat (a dome and a round,
// drooping brim), sized to the head's own vertices
function buildHat(kind, H) {
  const g = [];
  const r = H.r * 1.08;
  if (kind === 'sunhat') {
    const crown = new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52); crown.scale(1, 0.74, 1.05);   // a soft, flattish crown
    g.push(crown);
    const brim = new THREE.RingGeometry(r * 0.98, r * 1.95, 40, 3); brim.rotateX(-Math.PI / 2);
    const p = brim.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z); p.setY(i, -0.22 * (d - r) * (d - r) / r - 0.02 * r); }
    brim.translate(0, -r * 0.02, 0); brim.computeVertexNormals(); g.push(brim);
  } else if (H.rx) {
    // a baseball cap (owner, 2026-11-07: the old one read as a beret): a structured six-panel crown fitted to the skull (its
    // width from the head, a tall front, a lower back), sitting at the brow; a stiff curved brim forward, 7 cm long at the
    // middle, its sides bent down; a button on top
    const rc = H.rx * 1.14, depth = (H.rz ?? rc * 1.12) * 1.12, tall = (H.top - H.browY) * 1.06 + 0.012;   // over the skull (the hair is pulled in under it: buildUbc)
    const crown = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const cp = crown.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const front = Math.max(0, z);                                          // the structured front panels stand taller
      cp.setXYZ(i, x * rc, y * tall * (0.9 + 0.1 * front), z * depth);   // a taller front
    }
    crown.computeVertexNormals(); g.push(crown);
    const NU = 16, NV = 5, bp = [], bi = [];
    for (let iu = 0; iu <= NU; iu++) for (let iv = 0; iv <= NV; iv++) {
      const u = iu / NU * 2 - 1, v = iv / NV, phi = u * 0.40 * Math.PI;
      const ix = Math.sin(phi) * rc, iz = Math.cos(phi) * depth;              // the inner edge on the crown's rim
      const len = (0.075 / (H.unit || 1)) * Math.sqrt(Math.max(0, 1 - 0.7 * u * u));   // 7.5 cm at the middle, shorter at the sides
      const x = ix * (1 + 0.22 * v), z = iz + v * len, y = -0.22 * rc * u * u * (0.2 + v) - 0.05 * rc * v;   // the curve: sides well down, a slight pitch
      bp.push(x, y, z);
    }
    for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) { const a = iu * (NV + 1) + iv, b = a + 1, c = a + NV + 1, d = c + 1; bi.push(a, c, b, b, c, d); }
    const bill = new THREE.BufferGeometry(); bill.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bill.setIndex(bi); bill.computeVertexNormals();
    g.push(bill);
    // the brim's thickness: a rounded edge along its front (≈ 8 mm), so it reads from straight ahead too
    const edge = []; for (let iu = 0; iu <= NU; iu++) { const k = (iu * (NV + 1) + NV) * 3; edge.push(new THREE.Vector3(bp[k], bp[k + 1] - 0.003, bp[k + 2])); }
    g.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 32, 0.004 / (H.unit || 1), 6, false));
    const button = new THREE.SphereGeometry(rc * 0.07, 8, 6); button.translate(0, tall * 0.98, 0); g.push(button);
    let count = 0; const parts = g.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (k !== 'position' && k !== 'normal') y.deleteAttribute(k); count += y.attributes.position.count; return y; });
    const P = new Float32Array(count * 3), N = new Float32Array(count * 3); let o = 0;
    for (const y of parts) { P.set(y.attributes.position.array, o * 3); N.set(y.attributes.normal.array, o * 3); o += y.attributes.position.count; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.rotateX(-0.06);
    geo.translate(H.cx, H.browY, H.cz);   // the crown's rim at the brow
    return geo;
  } else {
    const crown = new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5); crown.scale(1, 0.85, 1.08);
    g.push(crown);
    // the brim: a curved bill out the front (+z), its sides bent down a little
    const bill = new THREE.CircleGeometry(r * 0.95, 24, -Math.PI * 0.42, Math.PI * 0.84);
    bill.rotateX(-Math.PI / 2); bill.rotateY(-Math.PI / 2);   // the arc's middle (+x) turned to the front (+z)
    const p = bill.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setZ(i, z * 0.75 + r * 0.55); p.setY(i, -0.35 * x * x / r - 0.08 * Math.max(0, z)); }
    bill.translate(0, -r * 0.02, r * 0.35); bill.computeVertexNormals(); g.push(bill);
    const button = new THREE.SphereGeometry(r * 0.08, 8, 6); button.translate(0, r * 0.85, 0); g.push(button);
  }
  let count = 0; const parts = g.map((x) => { const y = x.index ? x.toNonIndexed() : x; for (const k of Object.keys(y.attributes)) if (k !== 'position' && k !== 'normal') y.deleteAttribute(k); count += y.attributes.position.count; return y; });
  const P = new Float32Array(count * 3), N = new Float32Array(count * 3); let o = 0;
  for (const y of parts) { P.set(y.attributes.position.array, o * 3); N.set(y.attributes.normal.array, o * 3); o += y.attributes.position.count; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));   // the shapes' own smooth normals
  // tilt back a touch, sit on the crown
  geo.rotateX(-0.12);
  geo.translate(H.cx, H.top - r * 0.62, H.cz);
  return geo;
}

// The figure sources: the canonical rig names mapped to each skeleton, where a hand holds the shaft, the finger chains that
// close round it, and the heels' lift (an ankle bone over the sole)
export const PROFILES = Object.freeze({
  man: { boneMap: {}, grip: ['MiddleHand', 'Fingers', 0.25], fingers: [[['Fingers'], 1.4]], thumb: [['Thumb1'], 0.8], heelLift: 0 },
  ubc: {
    boneMap: { Hips: 'pelvis', Abdomen: 'spine_01', Torso: 'spine_03', Neck: 'neck_01', Head: 'Head', ShoulderL: 'clavicle_l', ShoulderR: 'clavicle_r',
      UpperArmL: 'upperarm_l', UpperArmR: 'upperarm_r', LowerArmL: 'lowerarm_l', LowerArmR: 'lowerarm_r', PalmL: 'hand_l', PalmR: 'hand_r',
      MiddleHandL: 'middle_01_l', MiddleHandR: 'middle_01_r', FingersL: 'middle_02_l', FingersR: 'middle_02_r', Thumb1L: 'thumb_01_l', Thumb1R: 'thumb_01_r',
      UpperLegL: 'thigh_l', UpperLegR: 'thigh_r', LowerLegL: 'calf_l', LowerLegR: 'calf_r', FootL: 'foot_l', FootR: 'foot_r' },
    grip: ['Palm', 'MiddleHand', 0.72],
    fingers: [['index', 0.62], ['middle', 0.62], ['ring', 0.62], ['pinky', 0.62]].map(([f, a]) => [[`${f}_01`, `${f}_02`, `${f}_03`], a]),
    thumb: [['thumb_01', 'thumb_02'], 0.45],
    heelLift: 0.065,
    heelForward: -0.20,   // a 0.89 m leg (hip to ankle) against the first figure's 0.77: the feet on a forward foot step
  },
});
const FIGURE_HEIGHTS = Object.freeze({ male: 1.78, female: 1.66 });

// position-welded neighbours of an indexed geometry (a seam's split vertices move together)
function weldedNeighbours(g) {
  const p = g.attributes.position, key = new Map(), id = new Int32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    if (!key.has(k)) key.set(k, key.size); id[i] = key.get(k);
  }
  const n = key.size, nb = Array.from({ length: n }, () => new Set()), ix = g.index.array;
  for (let t = 0; t < ix.length; t += 3) for (let j = 0; j < 3; j++) { const a = id[ix[t + j]], b = id[ix[t + (j + 1) % 3]]; nb[a].add(b); nb[b].add(a); }
  return { id, n, nb: nb.map((x) => [...x]) };
}

// The clothes on the UBC body, painted: per vertex 'garment' = (top, shorts, shoes) weights from the rest pose (the bones
// and the T-pose's positions): a short-sleeve top over the chest, the back and the upper arms to a third of their length,
// shorts to mid-thigh, booties on the feet. Under the top and the shorts the skin is smoothed (Taubin λ/μ, 8 passes: the
// sculpted abs and pecs melt into a cloth surface) and lifted 3 mm (the cloth's thickness).
function* dressBodySteps(mesh, verts, wp, u) {
  const g = mesh.geometry, n = g.attributes.position.count;
  const sh = wp('UpperArmL'), el = wp('LowerArmL'), th = wp('UpperLegL'), kn = wp('LowerLegL'), waist = wp('Abdomen').y - 0.02, ankle = wp('FootL').y;
  const armLen = sh.distanceTo(el), legLen = th.distanceTo(kn);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const gar = new Float32Array(n * 3);
  for (const v of verts) {
    const b = v.bone ?? '', x = Math.abs(v.p.x), y = v.p.y;
    let top = 0, shorts = 0, shoes = 0;
    if (/^spine_0[123]$|^clavicle/.test(b)) top = 1;
    if (b === 'pelvis') { top = ss(waist - 0.01, waist + 0.01, y); shorts = 1 - top; }
    if (/^upperarm/.test(b)) top = 1 - ss(armLen * 0.30, armLen * 0.38, x - Math.abs(sh.x));   // a short sleeve
    if (/^thigh/.test(b)) shorts = ss(th.y - legLen * 0.62, th.y - legLen * 0.52, y);           // to mid-thigh
    if (/^foot|^ball/.test(b)) shoes = 1;   // (under the shoe mesh)
    if (/^calf/.test(b)) shoes = 1 - ss(ankle + 0.02, ankle + 0.05, y);   // booties to the ankle
    gar[3 * v.i] = top; gar[3 * v.i + 1] = shorts; gar[3 * v.i + 2] = shoes;
  }
  g.setAttribute('garment', new THREE.BufferAttribute(gar, 3));
  // smooth the clothed skin in model space (the rest positions), then back to the mesh's bind space
  const W = weldedNeighbours(g), P = new Float32Array(W.n * 3), wgt = new Float32Array(W.n);
  yield 'dress-weld';
  const pos = g.attributes.position;
  for (const v of verts) { const k = W.id[v.i]; P[3 * k] = v.p.x; P[3 * k + 1] = v.p.y; P[3 * k + 2] = v.p.z; wgt[k] = Math.max(wgt[k], gar[3 * v.i], gar[3 * v.i + 1] * 0.8, gar[3 * v.i + 2] * 0.35); }   // the booties soften the toes a little
  const step = (lam) => {
    const Q = P.slice();
    for (let k = 0; k < W.n; k++) {
      if (wgt[k] <= 0) continue;
      const nb = W.nb[k]; let ax = 0, ay = 0, az = 0; for (const j of nb) { ax += Q[3 * j]; ay += Q[3 * j + 1]; az += Q[3 * j + 2]; }
      const m = nb.length || 1, f = lam * wgt[k];
      P[3 * k] += f * (ax / m - Q[3 * k]); P[3 * k + 1] += f * (ay / m - Q[3 * k + 1]); P[3 * k + 2] += f * (az / m - Q[3 * k + 2]);
    }
  };
  for (let it = 0; it < 8; it++) { step(0.55); step(-0.58); if (it === 3) yield 'dress-smooth'; }
  yield 'dress-smooth';
  const inv = mesh.matrixWorld.clone().invert(), q = new THREE.Vector3(), nrm = g.attributes.normal, nq = new THREE.Vector3();
  for (const v of verts) {
    const k = W.id[v.i];
    nq.fromBufferAttribute(nrm, v.i).transformDirection(mesh.matrixWorld);
    q.set(P[3 * k], P[3 * k + 1], P[3 * k + 2]).addScaledVector(nq, 0.003 * wgt[k]).applyMatrix4(inv);
    pos.setXYZ(v.i, q.x, q.y, q.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return gar;
}


// Water shoes (owner, 2026-11-07: "real water shoes, mesh, not painted"): per foot a low neoprene shoe, a rounded box
// sized from the foot's own rest vertices (+6 mm all round, a 1.2 cm sole), on the foot bone; the foot inside is pulled in a
// little so no toe pokes through. Attribute 'shoe' = 1 on the sole band (a lighter rubber), 0 on the upper.
function buildShoe(verts, bone, side) {
  const pts = verts.filter((t) => new RegExp(`^(foot|ball)_${side}`).test(t.bone ?? ''));
  const b = new THREE.Box3(); for (const t of pts) b.expandByPoint(t.p);
  const pad = 0.006, sole = 0.012;
  const min = b.min.clone().subScalar(pad), max = b.max.clone().addScalar(pad);
  max.y = Math.min(max.y, b.min.y + 0.06);   // low cut: under the ankle bone
  min.y -= sole * 0.5;
  const size = max.clone().sub(min), c = min.clone().add(max).multiplyScalar(0.5);
  const g = new THREE.BoxGeometry(size.x, size.y, size.z, 8, 4, 14);
  const p = g.attributes.position, tag = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = (z / size.z) + 0.5, v = (y / size.y) + 0.5;            // u: heel → toe, v: sole → top
    // a rounded toe and heel (the plan's corners cut on a superellipse), a lower top toward the toe, a softer upper
    const hw = size.x / 2 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * u - 1), 2.4)), 0.4) * (0.62 + 0.38 * Math.sqrt(1 - v)) * (u > 0.7 ? 1 - 0.25 * (u - 0.7) / 0.3 : 1);   // a round toe and heel, tapering over the top, a narrower toe
    x = Math.sign(x) * Math.min(Math.abs(x), hw);
    const topAt = size.y * (0.35 + 0.65 * Math.min(1, (1 - u) * 1.3)) * (1 - 0.45 * Math.pow(2 * Math.abs(x) / size.x, 2));   // a domed upper, low at the toe
    if (y > -size.y / 2 + topAt) y = -size.y / 2 + topAt;
    p.setXYZ(i, x, y, z);
    tag[i] = v < (sole / size.y) + 0.02 ? 1 : 0;
  }
  g.translate(c.x, c.y, c.z);
  g.setAttribute('shoe', new THREE.BufferAttribute(tag, 1));
  g.computeVertexNormals();
  g.applyMatrix4(bone.matrixWorld.clone().invert());
  return g;
}

// The rig's controls by canonical name (Quaternius "Man"'s own names). Another figure plugs in with a map from these to
// its bone names (e.g. a UE-style skeleton: UpperArmL → upperarm_l, MiddleHandL → middle_01_l, FingersL → middle_02_l …);
// the motion and the rig never see a figure's own names.
const RIG_BONES = Object.freeze(['Hips', 'Abdomen', 'Torso', 'Neck', 'Head', 'ShoulderL', 'ShoulderR', 'UpperArmL', 'UpperArmR',
  'LowerArmL', 'LowerArmR', 'PalmL', 'PalmR', 'MiddleHandL', 'MiddleHandR', 'FingersL', 'FingersR', 'Thumb1L', 'Thumb1R',
  'UpperLegL', 'UpperLegR', 'LowerLegL', 'LowerLegR', 'FootL', 'FootR']);

export function buildFigure(gltf, look, mats, opts = {}) {
  const scene = cloneSkinned(gltf.scene);
  scene.updateMatrixWorld(true);
  const bones = {}, meshes = {};
  scene.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isSkinnedMesh) { const m = [].concat(o.material)[0]; meshes[m.name] = o; o.frustumCulled = false; }
  });
  const profileName = opts.profile ?? (bones.pelvis ? 'ubc' : 'man');
  const profile = PROFILES[profileName];
  const boneMap = { ...profile.boneMap, ...(opts.boneMap ?? {}) };
  for (const name of RIG_BONES) if (boneMap[name]) bones[name] = bones[boneMap[name]];
  const missing = RIG_BONES.filter((n) => !bones[n]);
  if (missing.length) throw new Error(`paddler figure: no bone for ${missing.join(', ')} (pass a boneMap)`);
  if (profileName === 'ubc') return buildUbc(scene, bones, meshes, look, mats, profile);
  // smooth: the export is faceted (flat facets read as a cheap mannequin through binoculars); one Loop subdivision step
  // rounds the body (subdivide.js; a fresh geometry per figure, the loaded GLB untouched)
  for (const m of Object.values(meshes)) {
    if (m.material.name === 'Eyes') continue;
    m.geometry = loopSubdivide(m.geometry);
  }
  const shirt = meshes.Shirt;
  const verts = { shirt: restVertices(shirt), skin: restVertices(meshes.Skin), hair: restVertices(meshes.Hair) };
  const box = new THREE.Box3(); for (const m of Object.values(meshes)) box.expandByObject(m);
  const units = box.max.y - box.min.y;
  const wp = (n) => bones[n].getWorldPosition(new THREE.Vector3());
  // measures (model units), all from the mesh and the bones
  const torso = verts.shirt.filter((t) => !/Arm|Palm|Hand|Finger|Thumb/.test(t.bone ?? '') && Math.abs(t.p.x) < Math.abs(wp('UpperArmL').x) * 0.92);
  const head = [...verts.skin, ...verts.hair].filter((t) => t.bone === 'Head' || t.bone === 'Neck' && t.p.y > wp('Head').y);
  const hb = new THREE.Box3(); for (const t of head) hb.expandByPoint(t.p);
  const M = {
    units, scale: FIGURE_HEIGHT_M / units, u: 1,
    hemY: wp('Abdomen').y + 0.10,
    armpitY: wp('UpperArmL').y - 0.42,
    collarY: wp('Neck').y - 0.12,
    strapX: Math.abs(wp('UpperArmL').x) * 0.62,
    foam: 0.12,   // ≈ 4.4 cm of foam at 1.76 m
  };
  // the shoulder's top surface where the strap lies: the highest shirt point near the strap's line
  M.shoulderTopY = Math.max(...verts.shirt.filter((t) => Math.abs(Math.abs(t.p.x) - M.strapX) < 0.10).map((t) => t.p.y));
  const H = { cx: (hb.min.x + hb.max.x) / 2, cz: (hb.min.z + hb.max.z) / 2 - 0.02, top: hb.max.y, r: Math.max(hb.max.x - hb.min.x, hb.max.z - hb.min.z) / 2 };
  // materials
  const assign = { Shirt: mats.top, Skin: mats.skin, Pants: mats.shorts, Socks: mats.shoes, Hair: mats.hair };
  for (const [name, m] of Object.entries(meshes)) {
    if (name === 'Eyes') { m.visible = false; continue; }   // no face detail
    if (assign[name]) m.material = assign[name];
    m.castShadow = true; m.receiveShadow = true;
  }
  // the PFD, skinned to the shirt's bones
  const pfdGeo = buildPfd(shirt, torso, M);
  // under the vest the shirt is pulled in (a game's usual hidden-body trick): a twisting chest or a protracted shoulder
  // never pokes through the foam
  {
    const p = shirt.geometry.attributes.position, inv = shirt.matrixWorld.clone().invert(), q = new THREE.Vector3();
    for (const t of verts.shirt) {
      if (/Arm|Palm|Hand|Finger|Thumb/.test(t.bone ?? '') || t.p.y < M.hemY + 0.05 || t.p.y > M.collarY - 0.02) continue;
      const pull = t.p.y < M.armpitY ? 0.80 : 0.86;
      q.set(t.p.x * pull, t.p.y, t.p.z * pull + (1 - pull) * 0.08).applyMatrix4(inv);
      p.setXYZ(t.i, q.x, q.y, q.z);
    }
    p.needsUpdate = true;
  }
  const pfd = new THREE.SkinnedMesh(pfdGeo, mats.pfd);
  pfd.name = 'paddler_pfd'; pfd.frustumCulled = false; pfd.castShadow = true; pfd.receiveShadow = true;
  shirt.parent.add(pfd);
  pfd.position.copy(shirt.position); pfd.quaternion.copy(shirt.quaternion); pfd.scale.copy(shirt.scale);
  pfd.bind(shirt.skeleton, shirt.bindMatrix);
  // the hat on the head bone
  const hatGeo = buildHat(look.hat, H);
  const headInv = bones.Head.matrixWorld.clone().invert();
  hatGeo.applyMatrix4(headInv);
  const hat = new THREE.Mesh(hatGeo, mats.hat); hat.name = 'paddler_hat'; hat.castShadow = true; hat.receiveShadow = true;
  bones.Head.add(hat);
  // the root: metres, facing −z (the kayak's bow)
  const root = new THREE.Group(); root.name = 'paddler_figure';
  const holder = new THREE.Group(); holder.name = 'paddler_model';
  holder.scale.setScalar(M.scale); holder.rotation.y = Math.PI;
  holder.add(scene); root.add(holder);
  return { root, holder, scene, bones, meshes, pfd, hat, M, heightM: FIGURE_HEIGHT_M, profile, profileName: 'man' };
}

// the UBC figure: the body dressed in the material, the brows and the hair recoloured, the eyes kept (a calm stylised
// face), the PFD over the top, the cap on the head bone.
// The shapes that do not depend on the look (the dressed body, the hair under the cap, the PFD, the water shoes, the fit
// numbers) are built once per loaded figure and shared by every paddler of it (feat/kayaks-default-on: a lake paddler's
// build was 55-95 ms in Chrome, most of it this; the lake's fleet builds several). Shared geometry is flagged
// userData.shared, so a paddler's dispose() leaves it alone. The look's own parts (the hat, the materials) stay per paddler.
// perf/enter-freeze: the same work as steps (a generator; each yield a place to stop), so a host with spare time spreads
// it over several tasks (prepareFigureSteps below: the phone's 0.4–0.65 s task, one per figure, became one per step);
// ubcShapes runs every step at once (a build that meets an unprepared figure: the shapes it makes are the same)
const UBC_SHAPES = new WeakMap();   // the loaded body geometry -> { bodyGeo, hairGeo, pfdGeo, shoeGeos, M, H, heightM }
function ubcShapes(body, meshes, bones, look) {
  const it = ubcShapesSteps(body, meshes, bones, look);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
function* ubcShapesSteps(body, meshes, bones, look) {
  const key = body.geometry;   // the loaded GLB's (cloneSkinned shares it between clones)
  const hit = UBC_SHAPES.get(key);
  if (hit && hit.sex === look.sex) return hit;
  body.geometry = body.geometry.clone();   // dress our own copy
  const wp = (n) => bones[n].getWorldPosition(new THREE.Vector3());
  const verts = { body: restVertices(body), hair: meshes.Hair ? restVertices(meshes.Hair) : [] };
  yield 'rest';
  const box = new THREE.Box3(); box.expandByObject(body);
  const units = box.max.y - box.min.y, u = units / 4.82;
  const heightM = FIGURE_HEIGHTS[look.sex] ?? 1.74;
  yield* dressBodySteps(body, verts.body, wp, u);
  yield 'dress';
  verts.body = restVertices(body);
  yield 'rest2';
  const torso = verts.body.filter((t) => /^spine_0[123]$|^clavicle|^pelvis$/.test(t.bone ?? '') && t.p.y > wp('Abdomen').y - 0.02);
  const head = [...verts.body.filter((t) => t.bone === 'Head'), ...verts.hair];
  const hb = new THREE.Box3(); for (const t of head) hb.expandByPoint(t.p);
  const M = {
    units, u, scale: heightM / units,
    hemY: wp('Abdomen').y + 0.075,   // a short vest: it ends at the lower ribs (a seated paddler twists and bends)
    armpitY: wp('UpperArmL').y - 0.42 * u,
    collarY: wp('Neck').y - 0.10 * u,
    strapX: Math.abs(wp('UpperArmL').x) * 0.62,
    foam: 0.085 * u,   // slim soft foam: ≈ 3.7 cm on the chest and back, ≈ 2 cm at the sides
    harmonics: 5, sideGap: 0.16 * Math.PI, armholeF: 0.23, armholeB: 0.27,
  };
  M.shoulderTopY = Math.max(...torso.filter((t) => Math.abs(Math.abs(t.p.x) - M.strapX) < 0.10 * u).map((t) => t.p.y));
  const H = { cx: (hb.min.x + hb.max.x) / 2, cz: (hb.min.z + hb.max.z) / 2 - 0.02 * u, top: hb.max.y, r: Math.max(hb.max.x - hb.min.x, hb.max.z - hb.min.z) / 2 };
  {   // the skull above the ears (the widest head vertices high up), the brow 0.6 of the way from the head bone to the top
    const headY = wp('Head').y, browY = headY + (hb.max.y - headY) * 0.52;
    const skull = head.filter((t) => t.p.y > browY + 0.01);
    H.rx = skull.length ? Math.max(...skull.map((t) => Math.abs(t.p.x - H.cx))) : H.r * 0.8;
    H.browY = browY; H.unit = 1;   // the UBC model is in metres
    H.cz = (Math.min(...skull.map((t) => t.p.z)) + Math.max(...skull.map((t) => t.p.z))) / 2;
    H.rz = skull.length ? Math.max(...skull.map((t) => Math.abs(t.p.z - H.cz))) : H.rx * 1.12;
  }
  const pfdGeo = yield* buildPfdSteps(body, torso, M);
  yield 'pfd';
  // the hair under the cap: above the brow it is pulled in toward the skull (no strand pokes through the crown)
  let hairGeo = null;
  if (meshes.Hair && H.rx) {
    const hg = hairGeo = meshes.Hair.geometry.clone(), hp = hg.attributes.position, inv = meshes.Hair.matrixWorld.clone().invert(), q = new THREE.Vector3();
    const cy = wp('Head').y;
    for (const t of verts.hair) {
      if (t.p.y < H.browY - 0.01) continue;
      const k = 0.82;
      q.set(H.cx + (t.p.x - H.cx) * k, cy + (t.p.y - cy) * k, H.cz + (t.p.z - H.cz) * k).applyMatrix4(inv);
      hp.setXYZ(t.i, q.x, q.y, q.z);
    }
    hp.needsUpdate = true; hg.computeVertexNormals();
  }
  yield 'hair';
  // the water shoes, and the feet pulled in under them
  const shoeGeos = [['l', 'FootL'], ['r', 'FootR']].map(([sd, bn]) => buildShoe(verts.body, bones[bn], sd));
  {
    const p = body.geometry.attributes.position, inv = body.matrixWorld.clone().invert(), q = new THREE.Vector3();
    for (const sd of ['l', 'r']) {
      const pts = verts.body.filter((t) => new RegExp(`^(foot|ball)_${sd}`).test(t.bone ?? ''));
      const cx = pts.reduce((a, t) => a + t.p.x, 0) / (pts.length || 1), minY = Math.min(...pts.map((t) => t.p.y));
      for (const t of pts) { q.set(cx + (t.p.x - cx) * 0.88, minY + 0.004 + (t.p.y - minY) * 0.9, t.p.z).applyMatrix4(inv); p.setXYZ(t.i, q.x, q.y, q.z); }
    }
    p.needsUpdate = true;
  }
  const out = { sex: look.sex, bodyGeo: body.geometry, hairGeo, pfdGeo, shoeGeos, M, H, heightM };
  for (const g of [out.bodyGeo, hairGeo, pfdGeo, ...shoeGeos]) if (g) g.userData.shared = true;
  UBC_SHAPES.set(key, out);
  return out;
}
// the shared shapes built ahead (a host with spare time: the lake's fleet, once the figures load, one figure per task), so
// the first paddler of each figure builds in a few ms; a no-op for a figure already prepared or not a UBC one
export function prepareFigure(gltf, sex) {
  const it = prepareFigureSteps(gltf, sex);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
// the same as steps (perf/enter-freeze): for (const step of prepareFigureSteps(gltf, sex)) await a task; → true when made
export function* prepareFigureSteps(gltf, sex) {
  const scene = cloneSkinned(gltf.scene); scene.updateMatrixWorld(true);
  const bones = {}, meshes = {};
  scene.traverse((o) => { if (o.isBone) bones[o.name] = o; if (o.isSkinnedMesh) meshes[[].concat(o.material)[0].name] = o; });
  if (!bones.pelvis || !meshes.Body) return false;
  for (const name of RIG_BONES) { const b = PROFILES.ubc.boneMap[name]; if (b) bones[name] = bones[b]; }
  yield 'clone';
  yield* ubcShapesSteps(meshes.Body, meshes, bones, { sex });
  return true;
}
function buildUbc(scene, bones, meshes, look, mats, profile) {
  const body = meshes.Body;
  // the skin's colour map: kept as the face's detail (the material tints it to the seeded tone)
  const skinMap = body.material.map ?? null, eyeMap = meshes.Eyes?.material.map ?? null;
  const { bodyGeo, hairGeo, pfdGeo, shoeGeos, M, H, heightM } = ubcShapes(body, meshes, bones, look);
  body.geometry = bodyGeo;
  if (meshes.Hair && hairGeo) meshes.Hair.geometry = hairGeo;
  body.material = mats.makeBody(skinMap);
  if (meshes.Eyes) meshes.Eyes.material = mats.makeEyes(eyeMap);
  if (meshes.Brows) meshes.Brows.material = mats.brows;
  if (meshes.Hair) meshes.Hair.material = mats.hair;
  for (const m of Object.values(meshes)) { m.castShadow = true; m.receiveShadow = true; }
  const pfd = new THREE.SkinnedMesh(pfdGeo, mats.pfd);
  pfd.name = 'paddler_pfd'; pfd.frustumCulled = false; pfd.castShadow = true; pfd.receiveShadow = true;
  body.parent.add(pfd);
  pfd.position.copy(body.position); pfd.quaternion.copy(body.quaternion); pfd.scale.copy(body.scale);
  pfd.bind(body.skeleton, body.bindMatrix);
  const hatGeo = buildHat(look.hat, H);
  hatGeo.applyMatrix4(bones.Head.matrixWorld.clone().invert());
  const hat = new THREE.Mesh(hatGeo, mats.hat); hat.name = 'paddler_hat'; hat.castShadow = true; hat.receiveShadow = true;
  bones.Head.add(hat);
  const shoes = [];
  for (const [i, [sd, bn]] of [['l', 'FootL'], ['r', 'FootR']].entries()) {
    const sh = new THREE.Mesh(shoeGeos[i], mats.waterShoe); sh.name = `paddler_shoe_${sd}`; sh.castShadow = true; sh.receiveShadow = true;
    bones[bn].add(sh); shoes.push(sh);
  }
  const root = new THREE.Group(); root.name = 'paddler_figure';
  const holder = new THREE.Group(); holder.name = 'paddler_model';
  holder.scale.setScalar(M.scale); holder.rotation.y = Math.PI;
  holder.add(scene); root.add(holder);
  return { root, holder, scene, bones, meshes, pfd, hat, shoes, M, heightM, profile, profileName: 'ubc' };
}
