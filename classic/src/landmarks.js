// Landmarks on the real Emerald Bay (the terrain's landmarks: the lake profile's points, src/terrain.js; real positions; no names in the scene):
//   ruin       the small stone tea-house ruin (1929, ≈ 4.9 m square) on Fannette Island's summit: four rubble walls,
//              an empty window, a broken gable
//   house      a stone house at the head behind the beach: two storeys of grey granite, a sod roof, timber gables
//   waterfall  the creek's lower fall above the head (its steepest 40 m, terrain.waterfall()): a white ribbon that
//              streams (scene time), laid down the creek's bed from its top to its foot
//   boulders   rounded granite boulders along the shoreline, 0.5–2.5 m, instanced (one draw call)
// All procedural, our own geometry; no images.
//
//   import { createLandmarks } from './landmarks.js';
//   const lm = createLandmarks({ terrain, seed });  scene.add(lm.group);  each frame: lm.update(t)
import * as THREE from 'three/webgpu';
import { color, float, mix, smoothstep, uniform, uv, mx_noise_float, positionWorld, vec2, vec3, fract } from 'three/tsl';

function hash(i, s) {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function stoneMaterial(base = 0x6f6c66, dark = 0x45433f) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  const p = positionWorld;
  const blocks = mx_noise_float(vec3(p.x.mul(2.2), p.y.mul(3.5), p.z.mul(2.2)));     // ≈ 0.4 m stones
  const mortar = smoothstep(0.55, 0.7, fract(p.y.mul(3.2)).add(blocks.mul(0.15)));
  m.colorNode = mix(mix(color(dark), color(base), smoothstep(-0.4, 0.5, blocks)), color(0x8a867d), mortar.mul(0.35));
  return m;
}

// a wall slab from (x0, z0) to (x1, z1), thickness t, from y0 to y1
function wall(x0, z0, x1, z1, t, y0, y1) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  const g = new THREE.BoxGeometry(L, y1 - y0, t);
  g.translate(0, (y1 + y0) / 2, 0);
  g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  return g;
}

function ruin(terrain) {
  const R = terrain.landmarks.ruin;
  // its floor: the lowest ground under its footprint, so no wall floats on the knob's slope
  let y = Infinity; for (const dx of [-2.5, 0, 2.5]) for (const dz of [-2.5, 0, 2.5]) y = Math.min(y, terrain.heightAt(R.x + dx, R.z + dz));
  y -= 0.3;
  const g = new THREE.Group(); g.name = 'ruin';
  const s = (R.sizeM ?? 5.2) / 2, t = 0.45, mat = stoneMaterial();
  for (const w of [wall(-s, -s, s, -s, t, 0, 3.4), wall(s, -s, s, s, t, 0, 2.6), wall(s, s, -s, s, t, 0, 3.0),
    wall(-s, s, -s, -s, t, 0, 1.6)]) g.add(new THREE.Mesh(w, mat));        // the west wall broken down
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x15140f, roughness: 1 });
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, 0.06), dark); win.position.set(0, 1.8, -s - t / 2 - 0.01); g.add(win);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.06), dark); door.position.set(0, 0.9, s + t / 2 + 0.01); g.add(door);
  // a broken gable on the north wall
  const gable = new THREE.BufferGeometry();
  gable.setAttribute('position', new THREE.Float32BufferAttribute([-s, 3.4, -s, s, 3.4, -s, -0.6, 4.6, -s], 3));
  gable.computeVertexNormals();
  g.add(new THREE.Mesh(gable, new THREE.MeshStandardNodeMaterial({ color: 0x6f6c66, roughness: 0.92, side: THREE.DoubleSide })));
  g.position.set(R.x, y, R.z);
  g.rotation.y = 0.35;
  return g;
}

function house(terrain) {
  const H = terrain.landmarks.house, y = terrain.heightAt(H.x, H.z) - 0.4;
  const g = new THREE.Group(); g.name = 'stone-house';
  const L = H.length / 2, W = H.width / 2, eaves = 6.2, ridge = 10.5;
  const stone = stoneMaterial(0x7a766d, 0x4a4741);
  const body = new THREE.Mesh(new THREE.BoxGeometry(H.length, eaves, H.width), stone);
  body.position.y = eaves / 2; g.add(body);
  // a sod roof: green, rough, with the eaves overhanging; dark timber gables and a row of dark windows
  const roof = new THREE.Shape();
  roof.moveTo(-W - 0.8, eaves - 0.2); roof.lineTo(0, ridge); roof.lineTo(W + 0.8, eaves - 0.2); roof.lineTo(-W - 0.8, eaves - 0.2);
  const roofGeo = new THREE.ExtrudeGeometry(roof, { depth: H.length + 1.6, bevelEnabled: false });
  roofGeo.translate(0, 0, -(H.length + 1.6) / 2); roofGeo.rotateY(Math.PI / 2);
  const sod = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  sod.colorNode = mix(color(0x3d4a2a), color(0x5a6436), mx_noise_float(positionWorld.xz.mul(0.8)).mul(0.5).add(0.5));
  g.add(new THREE.Mesh(roofGeo, sod));
  const timber = new THREE.MeshStandardNodeMaterial({ color: 0x3a2a1c, roughness: 0.85 });
  for (const sx of [-1, 1]) {
    const gab = new THREE.BufferGeometry();
    gab.setAttribute('position', new THREE.Float32BufferAttribute([sx * (L + 0.05), eaves, -W, sx * (L + 0.05), eaves, W, sx * (L + 0.05), ridge - 0.4, 0], 3));
    gab.computeVertexNormals();
    g.add(new THREE.Mesh(gab, new THREE.MeshStandardNodeMaterial({ color: 0x3a2a1c, roughness: 0.85, side: THREE.DoubleSide })));
  }
  const glass = new THREE.MeshStandardNodeMaterial({ color: 0x1a1d20, roughness: 0.3 });
  for (let k = -3; k <= 3; k++) for (const sz of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.1), glass);
    win.position.set(k * 3.6, 3.2, sz * (W + 0.03)); g.add(win);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.12), timber);
    lintel.position.set(k * 3.6, 4.0, sz * (W + 0.05)); g.add(lintel);
  }
  // a tower-like stair wing at one end, as the reference house has
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 8.5, 5), stone);
  wing.position.set(L - 1, 4.25, W + 1.5); g.add(wing);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.8, 2.8, 4), sod);
  cap.position.set(L - 1, 9.9, W + 1.5); cap.rotation.y = Math.PI / 4; g.add(cap);
  g.position.set(H.x, y, H.z);
  g.rotation.y = H.yawDeg * Math.PI / 180;
  return g;
}

function waterfall(terrain, uTime) {
  const w = terrain.waterfall();
  const n = 24, width = 7;
  const pos = [], uvs = [], idx = [];
  // from its foot (b) up to its top (a): v runs from the foot to the top; across, the perpendicular of the line
  const [ax, az] = w.a, [bx, bz] = w.b, L = Math.hypot(ax - bx, az - bz), px = -(az - bz) / L, pz = (ax - bx) / L;
  for (let i = 0; i <= n; i++) {
    const f = i / n, x = bx + (ax - bx) * f, z = bz + (az - bz) * f;
    const y = terrain.heightAt(x, z) + 0.6;                       // a hand's breadth over the rock
    for (const sx of [-1, 1]) { const o = sx * width / 2 * (0.7 + 0.3 * f); pos.push(x + px * o, y, z + pz * o); uvs.push(sx < 0 ? 0 : 1, f); }
  }
  for (let i = 0; i < n; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 3, 2 * i, 2 * i + 3, 2 * i + 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.4, side: THREE.DoubleSide, transparent: true, depthWrite: false });
  const t = uv();
  // streaks falling downhill (v runs from the foot to the top): the noise scrolls with the scene time
  const streak = mx_noise_float(vec2(t.x.mul(9), t.y.mul(5).add(uTime.mul(1.8))));
  const edge = smoothstep(0.0, 0.25, t.x).mul(smoothstep(1.0, 0.75, t.x));
  m.colorNode = mix(color(0xb9c3c6), color(0xf2f5f4), streak.mul(0.5).add(0.5));
  m.opacityNode = edge.mul(float(0.55).add(streak.mul(0.35)));
  const mesh = new THREE.Mesh(geo, m); mesh.name = 'waterfall';
  // the plunge foam at the foot
  const foam = new THREE.Mesh(new THREE.CircleGeometry(6, 20), new THREE.MeshStandardNodeMaterial({ color: 0xe6ecec, roughness: 0.6, transparent: true, opacity: 0.6, depthWrite: false }));
  const fx = w.b[0] + (w.b[0] - w.a[0]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * 4, fz = w.b[1] + (w.b[1] - w.a[1]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) * 4;
  foam.rotation.x = -Math.PI / 2; foam.position.set(fx, terrain.heightAt(fx, fz) + 0.3, fz);
  const g = new THREE.Group(); g.name = 'waterfall'; g.add(mesh, foam);
  return { group: g, drop: w.top - w.bottom };
}

function boulders(terrain, seed) {
  // candidates on a 7 m grid over Emerald Bay and its mouth: keep those on the shore band (−1.5 to +5 m from the line)
  const pts = [];
  const x0 = -1300, x1 = 2300, z0 = -2000, z1 = 900, step = 7;
  const cov = {};
  let k = 0;
  for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
    k++;
    const jx = x + (hash(k, seed + 1) - 0.5) * step, jz = z + (hash(k, seed + 2) - 0.5) * step;
    const d = terrain.shoreDistance(jx, jz);
    if (d < -1.5 || d > 5) continue;
    const beach = terrain.coverAt ? terrain.coverAt(jx, jz, cov).beach > 0.3 : false;
    if (beach || hash(k, seed + 3) > 0.55) continue;            // none on the beach; about half the band
    const r = 0.25 + 1.0 * hash(k, seed + 4) ** 2;
    pts.push([jx, terrain.heightAt(jx, jz) - r * 0.35, jz, r, hash(k, seed + 5)]);
  }
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {                            // squash and lump it: a rounded granite boulder
    const v = new THREE.Vector3().fromBufferAttribute(p, i);
    const n = 1 + 0.18 * Math.sin(v.x * 3.1 + v.z * 2.3) + 0.1 * Math.cos(v.y * 4.7);
    p.setXYZ(i, v.x * n * 1.15, v.y * n * 0.7, v.z * n);
  }
  geo.computeVertexNormals();
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  m.colorNode = mix(color(0x5d5a54), color(0x8a867c), mx_noise_float(positionWorld.mul(1.3)).mul(0.5).add(0.5));
  const mesh = new THREE.InstancedMesh(geo, m, pts.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  pts.forEach(([x, y, z, r, a], i) => {
    e.set(0, a * Math.PI * 2, 0);
    M.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e), new THREE.Vector3(r, r, r));
    mesh.setMatrixAt(i, M);
  });
  mesh.name = 'boulders';
  return mesh;
}

export function createLandmarks({ terrain, seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'landmarks';
  const uTime = uniform(0);
  const r = ruin(terrain), h = house(terrain), wf = waterfall(terrain, uTime), b = boulders(terrain, seed);
  group.add(r, h, wf.group, b);
  const stats = { boulders: b.count, waterfallDropM: +wf.drop.toFixed(1) };
  return { group, stats, update: (t) => { uTime.value = t; } };
}
