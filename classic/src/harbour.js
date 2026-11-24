// Lakeshore harbour and yacht club (L3): the meshes for src/harbour-layout.js's plan.
//
//   import { createHarbour } from './harbour.js';
//   const harbour = createHarbour({ terrain, seed });   // the slips stay empty (the low-poly boats were deleted)
//   scene.add(harbour.group); harbour.update(t);              // each frame, t in s (scene time)
//
// Six draw calls: one merged static mesh with vertex colours (docks, fingers, piles, the pier, the crib, the mound's
// core, the ramp, the club, the boathouse, the kiosk), the mound's granite rocks (instanced), and the boats as four
// instanced meshes (sailboat hulls, sailboat decks and rigs, runabout hulls, runabout decks). Low-poly: the boats are
// lofted from 9 stations; a hull is 100-odd triangles. Boats heave, roll and pitch a little on a per-boat phase.
// Colours are albedo, muted (no loud colour), and step back with distance through depthTint like the ground.
// Generic on purpose: no names, no signs, no text anywhere.
import * as THREE from 'three/webgpu';
import { attribute, color } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { harbourLayout, rng } from '../../src/harbour-layout.js';
import { depthTint } from './terrain-mesh.js';

// albedo
const C = {
  deck: 0x7a7266, float: 0x26282a, pier: 0x665a4b, pile: 0x3b3128, steel: 0x3e3530, cap: 0x6b6458,
  core: 0x5c5a54, concrete: 0x8a8780, stone: 0x6d6a62, timber: 0x5a3f2c, timberLight: 0x6a4a34, roof: 0x3a3d3a,
  glass: 0x1d2630, door: 0x221c17, kiosk: 0x9a958a, pump: 0x5a2e2a,
  white: 0xc9c8c0, teak: 0x6e5a42, mast: 0x9a9c9e, cover: 0x1f2a3a, seat: 0x9c9078, motor: 0x1c1d1f,
};
const GRANITE = [0x5f5d58, 0x55534e, 0x6a6760, 0x4c4a46];   // weathered granite, a step under the lit shore band

const yawOf = ([dx, dz]) => Math.atan2(-dz, dx);   // local +x onto the world direction (dx, dz)

// --- geometry helpers: every part non-indexed, position + normal + colour only, so they merge -----------------
function finish(geo, hex) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.computeVertexNormals();                          // flat: non-indexed faces
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
// a box from x0..x1, y0..y1, z0..z1 in a local frame
function box(x0, x1, y0, y1, z0, z1, hex) {
  return finish(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), hex);
}
// a gable roof along local x: length l, width w, ridge height h, eaves at y = 0
function gable(l, w, h, hex) {
  const g = new THREE.CylinderGeometry(1, 1, l, 3, 1);        // a triangular prism along y, a vertex at +z
  g.rotateZ(Math.PI / 2);                                     // along x
  g.rotateX(-Math.PI / 2);                                    // the vertex up
  g.translate(0, 0.5, 0); g.scale(1, h / 1.5, w / Math.sqrt(3));   // eaves at y 0, ridge at h, ± w / 2
  return finish(g, hex);
}
// a box along the world segment a→b (x, z), width w, from y0 to y1, longer by `ext` at both ends
function beam(a, b, w, y0, y1, hex, ext = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
  const g = box(-l / 2 - ext, l / 2 + ext, y0, y1, -w / 2, w / 2, hex);
  g.rotateY(yawOf([dx / l, dz / l])); g.translate((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
  return g;
}
// a trapezoid prism along a→b: the rubble mound's core (crest width, base width, crest and base heights)
function mound(a, b, crestW, baseW, crestY, baseY, hex, ext) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
  const shape = new THREE.Shape([new THREE.Vector2(-baseW / 2, baseY), new THREE.Vector2(baseW / 2, baseY),
    new THREE.Vector2(crestW / 2, crestY), new THREE.Vector2(-crestW / 2, crestY)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: l + 2 * ext, bevelEnabled: false });   // the shape in x–y, extruded along +z
  g.translate(0, 0, -l / 2 - ext); g.rotateY(Math.PI / 2);                                    // the extrusion onto local +x
  g.rotateY(yawOf([dx / l, dz / l])); g.translate((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
  return finish(g, hex);
}
const place = (g, yaw, x, y, z) => g.rotateY(yaw).translate(x, y, z);

// --- buildings, in a local frame: x along b.dir (width w), z across (depth d; +z offshore for the club) ----------
function building(b) {
  const parts = [], { w, d } = b;
  if (b.kind === 'club' || b.kind === 'clubWing') {
    const wallTop = 1.2 + (b.kind === 'club' ? 3.4 : 2.8);
    parts.push(box(-w / 2 - 0.3, w / 2 + 0.3, -6, 1.2, -d / 2 - 0.3, d / 2 + 0.3, C.stone));         // the stone plinth takes the slope
    parts.push(box(-w / 2, w / 2, 1.2, wallTop, -d / 2, d / 2, C.timber));
    for (const s of [-1, 1]) parts.push(box(-w / 2 + 1.2, w / 2 - 1.2, 2.2, wallTop - 0.5, s * d / 2 - 0.06, s * d / 2 + 0.06, C.glass));
    parts.push(gable(w + 1.6, d + 1.8, b.kind === 'club' ? 2.8 : 2.4, C.roof).translate(0, wallTop, 0));
    if (b.kind === 'club') {
      parts.push(box(-w / 2 + 2.2, -w / 2 + 3.8, 1.2, wallTop + 3.4, -1.0, 0.6, C.stone));            // the chimney
      parts.push(box(-w / 2 + 2, w / 2 - 2, 0.9, 1.15, d / 2, d / 2 + 5, C.teak));                    // the deck toward the water
      for (const x of [-w / 2 + 2.2, 0, w / 2 - 2.2]) parts.push(box(x - 0.15, x + 0.15, -4, 0.9, d / 2 + 4.6, d / 2 + 4.9, C.pile));
      parts.push(finish(new THREE.CylinderGeometry(0.06, 0.09, 11, 6).translate(w / 2 - 2.5, 1.15 + 5.5, d / 2 + 4.2), C.mast));   // a bare flagpole
    }
  } else if (b.kind === 'boathouse') {
    parts.push(box(-w / 2, w / 2, 0, 4.2, -d / 2, d / 2, C.timberLight));
    parts.push(box(-w / 2 + 2, w / 2 - 2, 0, 3.8, d / 2 - 0.05, d / 2 + 0.08, C.door));                // the wide door on the basin side
    parts.push(gable(w + 1.0, d + 1.2, 2.3, C.roof).translate(0, 4.2, 0));
  } else if (b.kind === 'kiosk') {
    parts.push(box(-w / 2, w / 2, 0, b.h - 0.25, -d / 2, d / 2, C.kiosk));
    parts.push(box(-w / 2 - 0.6, w / 2 + 0.6, b.h - 0.25, b.h, -d / 2 - 0.6, d / 2 + 0.6, C.roof));
    parts.push(box(-w / 2 + 0.5, w / 2 - 0.5, 0.9, 1.9, d / 2 - 0.04, d / 2 + 0.04, C.glass));
    for (const x of [-w / 2 - 3, w / 2 + 3]) parts.push(box(x - 0.25, x + 0.25, 0, 1.4, -0.2, 0.2, C.pump));
  }
  const yaw = yawOf(b.dir);
  return parts.map((g) => place(g, yaw, b.x, b.y, b.z));
}

export function createHarbour({ terrain, seed = 1, site } = {}) {
  const L = { ...harbourLayout({ terrain, seed, site }), boats: [] };   // the layout still places boats (its seeded draws lay the slips)
  const group = new THREE.Group();
  group.name = 'harbour';
  const R = rng(seed * 104729 + 3);

  // --- static: docks, piles, pier, crib, mound core, ramp, buildings -----------------------------------------
  const parts = [];
  for (const d of L.docks) {
    if (d.kind === 'pier') {
      parts.push(beam(d.a, d.b, d.width, d.deckY - 0.35, d.deckY, C.pier));
      for (const s of [-1, 1]) {   // the rails, each side, at 1.0 m
        const dx = d.b[0] - d.a[0], dz = d.b[1] - d.a[1], l = Math.hypot(dx, dz), ox = (-dz / l) * s * (d.width / 2 - 0.05), oz = (dx / l) * s * (d.width / 2 - 0.05);
        parts.push(beam([d.a[0] + ox, d.a[1] + oz], [d.b[0] + ox, d.b[1] + oz], 0.08, d.deckY + 0.95, d.deckY + 1.03, C.pier));
      }
    } else {
      parts.push(beam(d.a, d.b, d.width, d.deckY - 0.15, d.deckY, C.deck, 0.0));
      parts.push(beam(d.a, d.b, d.width - 0.2, d.deckY - 0.55, d.deckY - 0.15, C.float, -0.1));   // the black floats under it
    }
  }
  for (const [x, z, top] of L.piles) parts.push(finish(new THREE.CylinderGeometry(0.17, 0.2, top + 4, 6).translate(x, (top - 4) / 2, z), C.pile));
  const rockPaths = [];
  for (const bw of L.breakwaters) {
    for (let i = 1; i < bw.path.length; i++) {
      const a = bw.path[i - 1], b = bw.path[i];
      if (bw.kind === 'crib') {
        parts.push(beam(a, b, bw.crestWidth, bw.baseY, bw.crestY - 0.2, C.steel, bw.crestWidth / 2));
        parts.push(beam(a, b, bw.crestWidth + 0.3, bw.crestY - 0.2, bw.crestY, C.cap, bw.crestWidth / 2 + 0.15));
      } else {
        parts.push(mound(a, b, bw.crestWidth, bw.baseWidth, bw.crestY - 0.6, bw.baseY, C.core, bw.crestWidth / 2));
        rockPaths.push({ a, b, bw, last: i === bw.path.length - 1 });
      }
    }
  }
  {
    const { a, b, width, yA, yB } = L.ramp;
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const g = box(-l / 2, l / 2, -0.4, 0, -width / 2, width / 2, C.concrete);
    g.rotateZ(-Math.atan2(yA - yB, l)); g.rotateY(yawOf([dx / l, dz / l])); g.translate((a[0] + b[0]) / 2, (yA + yB) / 2, (a[1] + b[1]) / 2);
    parts.push(g);
  }
  for (const b of L.buildings) parts.push(...building(b));
  const staticGeo = mergeGeometries(parts);
  const staticMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  staticMat.colorNode = depthTint(attribute('color', 'vec3'));
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.name = 'harbour-static';
  group.add(staticMesh);

  // --- the mound's armour: granite boulders over its crest and slopes, down to 3 m under water ----------------
  const spots = [];
  for (const { a, b, bw, last } of rockPaths) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l, px = -uz, pz = ux;
    const half = bw.baseWidth / 2, ch = bw.crestWidth / 2;
    const yAt = (c) => Math.abs(c) <= ch ? bw.crestY : bw.crestY - ((Math.abs(c) - ch) / (half - ch)) * (bw.crestY - bw.baseY);
    for (let s = -ch; s <= l + (last ? half * 0.6 : ch); s += 1.4) {
      for (let c = -half + 0.7; c <= half - 0.7; c += 1.5) {
        const jc = c + (R() - 0.5) * 0.9, js = s + (R() - 0.5) * 0.9;
        let y = yAt(jc);
        if (s > l) { const r = Math.hypot(s - l, jc); if (r > half - 0.7) continue; y = yAt(r); }   // a round head at the end
        if (y < -3) continue;
        spots.push([a[0] + ux * js + px * jc, y - 0.3, a[1] + uz * js + pz * jc]);
      }
    }
  }
  const rockGeo = finish(new THREE.DodecahedronGeometry(1, 0), 0xffffff);
  const rockMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  rockMat.colorNode = depthTint(color(0xffffff));
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, spots.length);
  rocks.name = 'harbour-rocks';
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    spots.forEach(([x, y, z], i) => {
      const r = 0.55 + 0.5 * R();
      e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e); s.set(r * (0.9 + 0.3 * R()), r * (0.6 + 0.2 * R()), r * (0.8 + 0.3 * R()));
      rocks.setMatrixAt(i, m.compose(p.set(x, y, z), q, s));
      rocks.setColorAt(i, c.setHex(GRANITE[Math.floor(R() * GRANITE.length)]));
    });
  }
  group.add(rocks);

  const tris = (g, n = 1) => (g.attributes.position.count / 3) * n;
  const stats = {
    slips: L.slips.length,
    rocks: spots.length, piles: L.piles.length, entranceM: +L.entrance.width.toFixed(1), drawCalls: group.children.length,
    triangles: Math.round(tris(staticGeo) + tris(rockGeo, spots.length)),
  };
  return { group, layout: L, stats };
}
