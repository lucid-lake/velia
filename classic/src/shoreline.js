// The shore's boat things (L4), drawn: piers on pilings, boathouses and a disused light tower. The placement is
// src/shoreline-layout.js (plain JS). The mooring balls, the boats on them and the buoys were deleted (owner, 2026-11-05;
//).
//
//   import { createShoreline } from './shoreline.js';
//   const shore = createShoreline({ terrain, seed: 1 });   // or { layout } to reuse one
//   scene.add(shore.group);
//
// Every repeated part is one InstancedMesh, so the draw calls stay ≈ 16 whatever the counts. No textures; the colours
// are muted (weathered timber, dark green roofs). No names or signs.
import * as THREE from 'three/webgpu';
import { layoutShoreline } from '../../src/shoreline-layout.js';

const COL = {
  deck: 0x6b5a48, piling: 0x3d342c, wall: 0x5a4636, roof: 0x2f3d33, trim: 0xd8d2c4,
  tower: 0xb9b5ab, lantern: 0x3a3f42,
};
const mat = (c, rough = 0.85) => new THREE.MeshStandardNodeMaterial({ color: c, roughness: rough, metalness: 0 });

// a gable roof prism: ridge along z, width 1, height 1, length 1, centred, base at y = 0
function roofGeometry() {
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

function instanced(geo, material, count, name) {
  const m = new THREE.InstancedMesh(geo, material, Math.max(1, count));
  m.count = count;
  m.name = name;
  m.frustumCulled = false;   // the instances spread over km; one bound would be wrong, culling buys little here
  return m;
}

export function createShoreline({ terrain, seed = 1, layout = null } = {}) {
  const L = layout ?? layoutShoreline(terrain, { seed });
  const group = new THREE.Group();
  group.name = 'shoreline';
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const put = (mesh, i, x, y, z, yaw, sx, sy, sz) => { Q.setFromAxisAngle(UP, yaw); mesh.setMatrixAt(i, M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz))); };

  // --- piers: a deck on pilings every 3 m (both sides), from the bottom to the deck --------------------------
  const decks = instanced(new THREE.BoxGeometry(1, 1, 1), mat(COL.deck, 0.9), L.piers.length, 'pier-decks');
  const pileList = [];
  L.piers.forEach((q, i) => {
    const yaw = Math.atan2(q.dirX, q.dirZ), cx = q.x + q.dirX * q.length / 2, cz = q.z + q.dirZ * q.length / 2;
    put(decks, i, cx, q.deckY, cz, yaw, q.width, 0.3, q.length);
    for (let a = 1.5; a < q.length; a += 3) for (const side of [-1, 1]) {
      const x = q.x + q.dirX * a + q.dirZ * side * (q.width / 2 - 0.15), z = q.z + q.dirZ * a - q.dirX * side * (q.width / 2 - 0.15);
      const bottom = Math.min(0, terrain.heightAt(x, z)) - 0.5;
      pileList.push([x, z, bottom, q.deckY - 0.15]);
    }
  });
  const piles = instanced(new THREE.CylinderGeometry(0.14, 0.16, 1, 6), mat(COL.piling), pileList.length, 'pier-pilings');
  pileList.forEach(([x, z, b, t], i) => put(piles, i, x, (b + t) / 2, z, 0, 1, t - b, 1));

  // --- boathouses over the pier's outer end: timber walls, a dark green gable roof, a pale door trim -----------
  const bhs = L.piers.filter((q) => q.boathouse);
  const walls = instanced(new THREE.BoxGeometry(1, 1, 1), mat(COL.wall), bhs.length, 'boathouse-walls');
  const roofs = instanced(roofGeometry(), mat(COL.roof, 0.7), bhs.length, 'boathouse-roofs');
  const doors = instanced(new THREE.BoxGeometry(1, 1, 1), mat(COL.trim), bhs.length, 'boathouse-doors');
  bhs.forEach((q, i) => {
    const yaw = Math.atan2(q.dirX, q.dirZ), w = 7, d = 11, h = 4.2, a = q.length - d / 2 - 0.5;
    const x = q.x + q.dirX * a, z = q.z + q.dirZ * a, y0 = q.deckY - 0.15;
    put(walls, i, x, y0 + h / 2, z, yaw, w, h, d);
    put(roofs, i, x, y0 + h, z, yaw, w + 1, 2.4, d + 1);
    put(doors, i, x + q.dirX * (d / 2 + 0.02), y0 + 1.6, z + q.dirZ * (d / 2 + 0.02), yaw, 5, 3.2, 0.05);   // the lake-side door
  });

  // --- the light tower: a small square concrete tower, a dark lantern with no light (disused) -----------------
  const T = L.tower;
  const tower = new THREE.Group();
  tower.name = 'light-tower';
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, T.heightM, 4), mat(COL.tower, 0.95));
  shaft.position.y = T.heightM / 2;
  shaft.rotation.y = Math.PI / 4;
  const gallery = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.7), mat(COL.lantern, 0.8));
  gallery.position.y = T.heightM;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 8), mat(COL.lantern, 0.6));
  lantern.position.y = T.heightM + 0.5;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 8), mat(COL.lantern, 0.7));
  cap.position.y = T.heightM + 1.2;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.2), mat(0x8d8a83, 1));
  plinth.position.y = -0.4;   // sunk into the rock so a slope never shows a gap
  tower.add(plinth, shaft, gallery, lantern, cap);
  tower.position.set(T.x, T.y, T.z);
  tower.rotation.y = T.facing;

  group.add(...[decks, piles, walls, roofs, doors].filter((m) => m.count > 0), tower);
  for (const m of [decks, piles, walls, roofs, doors]) m.instanceMatrix.needsUpdate = true;

  const stats = {
    piers: L.piers.length, boathouses: bhs.length, pilings: pileList.length, tower: [T.x, T.y, T.z].map((v) => +v.toFixed(1)),
  };
  return { group, layout: L, stats };
}
