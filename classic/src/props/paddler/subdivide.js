// One step of Loop subdivision for a skinned triangle mesh (feat/kayak-paddler): the
// stock figure is 1 852 triangles, faceted at binocular range; one step rounds it (×4 triangles) the way a modeller's
// smooth would. Topology from the positions alone (a vertex split only for its skin weights is welded), so the body
// smooths across those seams; open edges (where one material's mesh meets another's) follow the boundary rule, which
// depends only on the boundary itself, so the two meshes' shared edge stays closed. Skin weights blend with the same
// masks (the four strongest bones kept, renormalised).
import * as THREE from 'three/webgpu';

function weld(geo) {
  const p = geo.attributes.position, map = new Map(), remap = new Int32Array(p.count), keep = [];
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    if (!map.has(k)) { map.set(k, keep.length); keep.push(i); }
    remap[i] = map.get(k);
  }
  const src = geo.index ? geo.index.array : [...Array(p.count).keys()];
  const tris = [];
  for (let t = 0; t < src.length; t += 3) {
    const a = remap[src[t]], b = remap[src[t + 1]], c = remap[src[t + 2]];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { keep, tris };
}

// blend skin data: list of [weight, indexVec4, weightVec4]
function blendSkin(parts) {
  const acc = new Map();
  for (const [w, si, sw] of parts) for (let k = 0; k < 4; k++) if (sw[k] > 0) acc.set(si[k], (acc.get(si[k]) ?? 0) + w * sw[k]);
  const top = [...acc.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
  const sum = top.reduce((s, e) => s + e[1], 0) || 1;
  const si = [0, 0, 0, 0], sw = [0, 0, 0, 0];
  top.forEach(([i, v], k) => { si[k] = i; sw[k] = v / sum; });
  return [si, sw];
}

export function loopSubdivide(geo) {
  const { keep, tris } = weld(geo);
  const P = geo.attributes.position, SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
  const n = keep.length;
  const pos = keep.map((i) => new THREE.Vector3().fromBufferAttribute(P, i));
  const skin = keep.map((i) => [[SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)], [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)]]);
  // edges: key → { a, b, opp: [c…], id }
  const edges = new Map(), ek = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const nbr = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) {
    for (let j = 0; j < 3; j++) {
      const a = tris[t + j], b = tris[t + (j + 1) % 3], c = tris[t + (j + 2) % 3];
      const k = ek(a, b);
      if (!edges.has(k)) edges.set(k, { a: Math.min(a, b), b: Math.max(a, b), opp: [] });
      edges.get(k).opp.push(c);
      nbr[a].add(b); nbr[b].add(a);
    }
  }
  const boundaryNbr = Array.from({ length: n }, () => []);
  for (const e of edges.values()) if (e.opp.length !== 2) { boundaryNbr[e.a].push(e.b); boundaryNbr[e.b].push(e.a); }
  // new positions of the old vertices
  const outPos = [], outSkin = [];
  for (let i = 0; i < n; i++) {
    const bn = boundaryNbr[i];
    if (bn.length >= 2) {   // boundary (or non-manifold): the curve rule
      const v = pos[i].clone().multiplyScalar(0.75).addScaledVector(pos[bn[0]], 0.125).addScaledVector(pos[bn[1]], 0.125);
      outPos.push(v); outSkin.push(blendSkin([[0.75, ...skin[i]], [0.125, ...skin[bn[0]]], [0.125, ...skin[bn[1]]]]));
    } else {
      const N = [...nbr[i]], k = N.length;
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      const v = pos[i].clone().multiplyScalar(1 - k * beta);
      const parts = [[1 - k * beta, ...skin[i]]];
      for (const j of N) { v.addScaledVector(pos[j], beta); parts.push([beta, ...skin[j]]); }
      outPos.push(v); outSkin.push(blendSkin(parts));
    }
  }
  // edge points
  for (const e of edges.values()) {
    e.id = outPos.length;
    if (e.opp.length === 2) {
      const v = pos[e.a].clone().add(pos[e.b]).multiplyScalar(0.375).addScaledVector(pos[e.opp[0]], 0.125).addScaledVector(pos[e.opp[1]], 0.125);
      outPos.push(v); outSkin.push(blendSkin([[0.375, ...skin[e.a]], [0.375, ...skin[e.b]], [0.125, ...skin[e.opp[0]]], [0.125, ...skin[e.opp[1]]]]));
    } else {
      outPos.push(pos[e.a].clone().add(pos[e.b]).multiplyScalar(0.5)); outSkin.push(blendSkin([[0.5, ...skin[e.a]], [0.5, ...skin[e.b]]]));
    }
  }
  const idx = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ab = edges.get(ek(a, b)).id, bc = edges.get(ek(b, c)).id, ca = edges.get(ek(c, a)).id;
    idx.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const g = new THREE.BufferGeometry();
  const pa = new Float32Array(outPos.length * 3), sia = new Uint16Array(outPos.length * 4), swa = new Float32Array(outPos.length * 4);
  outPos.forEach((v, i) => { pa[3 * i] = v.x; pa[3 * i + 1] = v.y; pa[3 * i + 2] = v.z; });
  outSkin.forEach(([si, sw], i) => { sia.set(si, 4 * i); swa.set(sw, 4 * i); });
  g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sia, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(swa, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
