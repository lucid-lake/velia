// The racing marks, modelled (feat/marks): inflatable PVC marks in racing orange and yellow, a committee boat stand-in and
// a pin buoy. three.js geometry built in code (no files): every mark is a welded-seam inflatable, so the surface is a
// parametric shell whose panels puff out a little between the seams and sink into a groove at them; the seam lines are
// darkened in the vertex colours. Each has a lifting handle (a webbing arch on a reinforcing patch) on top and a
// stainless D-ring on a patch at the bottom for the anchor line. Three levels of detail (a THREE.LOD): near ≈ 24 k
// triangles for a sphere, mid ≈ 2 k, far ≈ 200.
//
//   const g = buildMark('sphere' | 'cylinder' | 'tetra' | 'pin' | 'committee', { colour: 'orange' | 'yellow' | 'white' });
//   g.update(wind) // optional: the pin's flag
// The geometry's origin is the body's geometric centre (src/marks/body.js MARK_TYPES), y up, in metres.
import * as THREE from 'three/webgpu';
import { MARK_TYPES } from '../../../src/sim/marks/body.js';

// the real marks' pigments: fluorescent (luminous) orange, RAL 2005 ≈ #FF5F15, and fluorescent lemon yellow ≈ #F2E600
export const COLOURS = { orange: 0xff4a00, yellow: 0xf4f000, lime: 0xc8f000, white: 0xf0eee6, navy: 0x1b2a46, black: 0x15161a };
const TAU = Math.PI * 2;
const mats = new Map();
// PVC: a satin sheen with a clearcoat (the weld lines and the wet shine); the far levels drop the clearcoat
function pvc(colour, near) {
  const key = `${colour}:${near ? 1 : 0}`;
  if (!mats.has(key)) {
    const hex = COLOURS[colour] ?? colour;
    // the albedo is low on purpose: the scene's exposure and the AgX curve wash a bright saturated colour to pastel (measured:
    // 0.85 gave #F7B191 for orange); 0.34 / 0.5 read as fluorescent orange and lemon yellow on screen. The emissive is the fluorescence, by daylight (setDaylight)
    const yel = colour === 'yellow' || colour === 'lime';
    const base = new THREE.Color(0xffffff).multiplyScalar(yel ? 0.55 : 0.3), em = new THREE.Color(EMISSIVE[colour] ?? hex);
    const m = new THREE.MeshPhysicalNodeMaterial({ name: `pvc-${colour}`, color: base, vertexColors: true, roughness: near ? 0.62 : 0.7, metalness: 0, specularIntensity: 0.05, emissive: em, emissiveIntensity: 0 });   // matte-to-satin PVC: little specular, so the pigment is not washed by the sky
    m.userData.yel = yel; mats.set(key, m); fluo.add(m);
  }
  return mats.get(key);
}
const fluo = new Set();
// the fluorescent emission's hue: more saturated than the pigment, since the tone curve desaturates what is bright
const EMISSIVE = { orange: 0xff2000, yellow: 0xf8f000, lime: 0xb0f000 };
const EM_GAIN = { orange: 0.08, yellow: 0.1, lime: 0.1 };
// the fluorescence: a small extra light from the pigment in daylight only (sun elevation in degrees): none at dusk
export function setDaylight(elevDeg) {
  const d = smoothstep(4, 28, elevDeg);
  for (const m of fluo) m.emissiveIntensity = d * (m.userData.yel ? EM_GAIN.yellow : EM_GAIN.orange);
}
const flat = (name, hex, rough = 0.7, metal = 0) => { if (!mats.has(name)) mats.set(name, new THREE.MeshStandardNodeMaterial({ name, color: hex, roughness: rough, metalness: metal })); return mats.get(name); };
const steel = () => flat('ring-steel', 0xc9ccd0, 0.28, 1.0);
const webbing = () => flat('webbing', 0x16171b, 0.88);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- a parametric shell: fn(u, v) → [x, y, z, seam, tone]; u wraps (0..1), v runs 0..1 pole to pole ----
// seam 0..1: how deep in a weld; tone: a colour multiplier (1 = the base). Normals come from the mesh.
function shell(nu, nv, fn, colour) {
  const pos = [], col = [], idx = [], c = new THREE.Color(typeof colour === 'string' ? COLOURS[colour] : colour);
  for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) {
    const [x, y, z, seam, tone = 1] = fn(i / nu, j / nv);
    pos.push(x, y, z);
    const k = (1 - 0.3 * seam) * Math.min(tone, 1);   // the seam tape: darker, a hair duller
    const w = tone > 1 ? 0.9 : 0, white = 0.85;   // a retro-reflective white band
    col.push((c.r + (white - c.r) * w) * k, (c.g + (white - c.g) * w) * k, (c.b + (white - c.b) * w) * k);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * nu + i, b = j * nu + ((i + 1) % nu), d = (j + 1) * nu + i, e = (j + 1) * nu + ((i + 1) % nu);
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// the seam profile at distance d (m) from a weld: 1 in the weld, 0 beyond ~3 cm
const weld = (d, w = 0.0075) => Math.exp(-((d / w) ** 2));

// ---- the shapes ----
function sphereFn(R, gores = 10) {
  return (u, v) => {
    const th = v * Math.PI, ph = u * TAU, st = Math.sin(th), ct = Math.cos(th);
    // distance to the nearest gore seam along the surface; the polar cap panel seam at 20° from each pole
    const gAng = TAU / gores, dPh = Math.abs(((ph + gAng / 2) % gAng) - gAng / 2), dGore = dPh * R * st;
    const dCap = Math.min(Math.abs(th - 0.35), Math.abs(th - (Math.PI - 0.35))) * R;
    const sGore = th > 0.35 && th < Math.PI - 0.35 ? weld(dGore) : 0, sCap = weld(dCap);
    const seam = Math.max(sGore, sCap), puff = 1 + 0.006 * (1 - seam);   // the panels puff out between the welds
    const r = R * puff * (1 - 0.011 * seam);
    return [r * st * Math.cos(ph), r * ct, r * st * Math.sin(ph), seam];
  };
}
// a meridian for the rounded cylinder: bottom centre → wall → top centre; returns [radius, y, arc position]
function cylMeridian(r, H, rs = 0.13) {
  const pts = [], n = 22;
  for (let i = 0; i <= n; i++) pts.push([r * (i / n) * (1 - rs / r) * 1.0, -H / 2]);                       // the flat bottom
  for (let i = 1; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push([r - rs + rs * Math.sin(a), -H / 2 + rs - rs * Math.cos(a)]); }   // the shoulder
  const m = 40; for (let i = 1; i < m; i++) pts.push([r, -H / 2 + rs + (H - 2 * rs) * i / m]);              // the wall
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI / 2; pts.push([r - rs + rs * Math.cos(a), H / 2 - rs + rs * Math.sin(a)]); }
  for (let i = 1; i <= n; i++) pts.push([(r - rs) * (1 - i / n), H / 2]);                                    // the flat top
  return pts;
}
function cylinderGeometry(r, H, colour, nu, { gores = 6, band = true } = {}) {
  const M = cylMeridian(r, H), nv = M.length - 1;
  return shell(nu, nv, (u, v) => {
    const [rr, y] = M[Math.round(v * nv)], ph = u * TAU, gAng = TAU / gores;
    const dPh = Math.abs(((ph + gAng / 2) % gAng) - gAng / 2), onWall = Math.abs(y) < H / 2 - 0.14;
    const sGore = onWall ? weld(dPh * r) : 0, sRing = Math.max(weld(y + H / 2 - 0.14), weld(y - H / 2 + 0.14));
    const seam = Math.max(sGore, sRing);
    const k = 1 + 0.005 * (1 - seam) - 0.012 * seam;
    // a retro-reflective tape band round the middle: paler, shinier
    const tone = band && Math.abs(y - 0.12) < 0.07 ? 2 : 1;
    return [rr * k * Math.cos(ph), y, rr * k * Math.sin(ph), seam, tone];
  }, colour);
}
// the rounded tetrahedron: a soft intersection of four half-spaces seen from the centroid, a puff on each face, welds on the edges
function tetraGeometry(H, colour, detail) {
  const a = H * Math.sqrt(1.5), rin = a / (2 * Math.sqrt(6)), N = [[0, -1, 0]];
  for (let j = 0; j < 3; j++) { const ph = Math.PI / 2 + 2 * Math.PI * j / 3 + Math.PI / 3, s = Math.sqrt(8) / 3; N.push([s * Math.cos(ph), 1 / 3, s * Math.sin(ph)]); }
  const P = 9, dir = new THREE.Vector3();
  const ico = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const src = ico.getAttribute('position'), pos = [], col = [], c = new THREE.Color(COLOURS[colour] ?? colour);
  // the radius along a direction, with the runner-up face for the welds
  const radius = (d) => {
    let s = 0, t1 = Infinity, t2 = Infinity;
    for (const n of N) { const dn = n[0] * d.x + n[1] * d.y + n[2] * d.z; if (dn > 1e-3) { const t = rin / dn; s += Math.pow(t, -P); if (t < t1) { t2 = t1; t1 = t; } else if (t < t2) t2 = t; } }
    return { t: Math.pow(s, -1 / P), seam: t2 < Infinity ? Math.exp(-((((t2 - t1) / t1) / 0.045) ** 2)) : 0 };
  };
  let apex = 0;
  for (let i = 0; i < src.count; i++) { dir.fromBufferAttribute(src, i).normalize(); const { t } = radius(dir); apex = Math.max(apex, dir.y * t); }
  const sc = (3 * H / 4) / apex;   // the rounded tip is shorter than the sharp one: scale to the stated height
  for (let i = 0; i < src.count; i++) {
    dir.fromBufferAttribute(src, i).normalize();
    const { t, seam } = radius(dir); let faceBest = 0; for (const n of N) faceBest = Math.max(faceBest, n[0] * dir.x + n[1] * dir.y + n[2] * dir.z);
    const r = t * sc * (1 + 0.035 * Math.pow(faceBest, 6) - 0.02 * seam);
    pos.push(dir.x * r, dir.y * r, dir.z * r);
    const k = 1 - 0.3 * seam; col.push(c.r * k, c.g * k, c.b * k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // weld the duplicated corners so the normals are smooth
  return mergeSmooth(g);
}
function mergeSmooth(g) {
  const pos = g.getAttribute('position'), col = g.getAttribute('color'), map = new Map(), P = [], C = [], idx = [];
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    let k = map.get(key); if (k === undefined) { k = P.length / 3; map.set(key, k); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); C.push(col.getX(i), col.getY(i), col.getZ(i)); }
    idx.push(k);
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); o.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); o.setIndex(idx); o.computeVertexNormals();
  return o;
}

// the fittings: the lifting handle (a webbing arch on a patch) and the anchor D-ring (stainless on a patch)
function handle(at, up = [0, 1, 0], big = 1) {
  const g = new THREE.Group(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...up));
  const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * big, 0.12 * big, 0.012, 20), webbing());
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.085 * big, 0.016 * big, 8, 22, Math.PI), webbing()); arch.position.y = 0.006; arch.rotation.x = 0;
  g.add(patch, arch); g.position.set(...at); g.quaternion.copy(q); return g;
}
function ring(at, down = [0, -1, 0], big = 1) {
  const g = new THREE.Group(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...down));
  const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * big, 0.12 * big, 0.012, 20), webbing()); patch.position.y = 0.006;
  const d = new THREE.Mesh(new THREE.TorusGeometry(0.05 * big, 0.011 * big, 8, 20), steel()); d.position.y = -0.045 * big; d.rotation.y = Math.PI / 2;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * big, 0.012 * big, 0.1 * big, 8), steel()); bar.rotation.z = Math.PI / 2; bar.position.y = -0.003;
  g.add(patch, d, bar);
  const black = flat('chain', 0x111214, 0.5, 0.6);   // a short black chain to the anchor line
  for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.TorusGeometry(0.024 * big, 0.0065 * big, 6, 12), black); l.position.y = -(0.1 + i * 0.038) * big; l.rotation.y = i % 2 ? 0 : Math.PI / 2; l.scale.y = 1.35; g.add(l); }
  g.position.set(...at); g.quaternion.copy(q); return g;
}

// a flag that streams from a staff: a pivot (turned downwind by scene.js) carrying the cloth; the cloth extends along the pivot's +x
function flagOn(at, w, h) {
  const pivot = new THREE.Group(); pivot.name = 'flagPivot'; pivot.position.set(...at);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 8, 2), new THREE.MeshStandardNodeMaterial({ color: 0xff5a00, roughness: 0.8, side: THREE.DoubleSide }));
  cloth.position.x = w / 2 + 0.02; pivot.add(cloth); pivot.userData.cloth = cloth; return pivot;
}

// the committee boat: a workboat hull, a cabin and a flag mast; no people
function committeeGroup(lod) {
  const T = MARK_TYPES.committee, g = new THREE.Group();
  const half = (x) => 1.25 * (x < 1.6 ? 1 : Math.sqrt(Math.max(0, 1 - ((x - 1.6) / 1.9) ** 2)));
  const ns = lod === 0 ? 24 : 10, pos = [], col = [], idx = [];
  const white = new THREE.Color(COLOURS.white), navy = new THREE.Color(COLOURS.navy), grey = new THREE.Color(0x8d9298);
  const sec = (x) => { const hw = Math.max(0.02, half(x)); return [[-hw, 0.55], [-hw * 0.97, 0.05], [-hw * 0.9, -0.2], [-hw * 0.5, -0.62], [0, -0.85], [hw * 0.5, -0.62], [hw * 0.9, -0.2], [hw * 0.97, 0.05], [hw, 0.55]]; };
  const np = 9;
  for (let i = 0; i <= ns; i++) {
    const x = -3.5 + 7 * i / ns, s = sec(x);
    // the bow stem rises: the sheer lifts a little toward the bow
    s.forEach(([z, y], k) => { pos.push(x, y + (k === 0 || k === np - 1 ? 0.06 * smoothstep(1, 3.5, x) : 0), z); const c = y > 0.1 ? white : y > -0.25 ? navy : grey; col.push(c.r, c.g, c.b); });
  }
  for (let i = 0; i < ns; i++) for (let k = 0; k < np - 1; k++) { const a = i * np + k, b = a + 1, d = a + np, e = d + 1; idx.push(a, d, b, b, d, e); }
  // the deck (a strip) and the transom
  const deck0 = pos.length / 3;
  for (let i = 0; i <= ns; i++) { const x = -3.5 + 7 * i / ns, hw = half(x); pos.push(x, 0.55, -hw, x, 0.55, hw); col.push(grey.r, grey.g, grey.b, grey.r, grey.g, grey.b); }
  for (let i = 0; i < ns; i++) { const a = deck0 + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); hull.setIndex(idx); hull.computeVertexNormals();
  g.add(new THREE.Mesh(hull, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.38, metalness: 0, side: THREE.DoubleSide })));
  const m = (hex, r = 0.5) => flat(`cb-${hex}`, hex, r);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.1, 1.7), m(0xefede6, 0.4)); cabin.position.set(-0.7, 1.1, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 1.9), m(0xd9d7cf, 0.5)); roof.position.set(-0.7, 1.69, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 1.5), m(0x1a2229, 0.1)); glass.position.set(0.47, 1.25, 0);
  const side = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.34, 0.04), m(0x1a2229, 0.1));
  const sL = side.clone(); sL.position.set(-0.7, 1.3, 0.86); const sR = side.clone(); sR.position.set(-0.7, 1.3, -0.86);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 3.4, 8), m(0xb9bdc2, 0.3)); mast.position.set(-1.0, 3.4, 0);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.012, 6, 16, Math.PI), steel()); rail.rotation.set(Math.PI / 2, 0, Math.PI / 2); rail.position.set(2.2, 0.85, 0);
  g.add(cabin, roof, glass, sL, sR, mast, flagOn([-1.0, 4.9, 0], 0.9, 0.6));
  if (lod === 0) g.add(rail);
  return g;
}

// ---- build a whole mark ----
const LODS = { sphere: [[96, 64], [28, 20], [12, 8]], cylinder: [[96], [28], [10]], tetra: [[5], [3], [1]] };
export function buildMark(type, { colour = 'orange' } = {}) {
  const T = MARK_TYPES[type], lod = new THREE.LOD(), levels = LODS[type] ?? LODS.sphere;
  const distances = [0, 38, 170];
  const make = (li) => {
    const g = new THREE.Group(), near = li === 0;
    const body = (geo) => { const m = new THREE.Mesh(geo, pvc(colour, near)); m.castShadow = false; g.add(m); };
    if (type === 'sphere') { body(shell(levels[li][0], levels[li][1], sphereFn(T.R), colour)); if (li < 2) { g.add(handle([0, T.R - 0.005, 0])); g.add(ring([0, -T.R + 0.005, 0])); } }
    else if (type === 'cylinder' || type === 'pin') {
      body(cylinderGeometry(T.r, T.H, colour, levels[li][0], { gores: 6, band: type === 'cylinder' }));
      if (li < 2) { g.add(handle([0, T.H / 2, 0], [0, 1, 0], type === 'pin' ? 0.8 : 1)); g.add(ring([0, -T.H / 2, 0], [0, -1, 0], type === 'pin' ? 0.8 : 1)); }
      if (type === 'pin') {   // the staff and its flag
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 2.3, 8), flat('pin-pole', 0xe8e6de, 0.4)); pole.position.set(0, T.H / 2 + 1.15, 0);
        g.add(pole, flagOn([0, T.H / 2 + 2.05, 0], 0.75, 0.5));
      }
    } else if (type === 'tetra') {
      body(tetraGeometry(T.H, colour, levels[li][0]));
      if (li < 2) { g.add(handle([0, 3 * T.H / 4 - 0.03, 0])); g.add(ring([0, -T.H / 4 + 0.01, 0])); }
    } else if (type === 'committee') return committeeGroup(li);
    return g;
  };
  for (let li = 0; li < 3; li++) lod.addLevel(make(li), distances[li]);
  lod.name = `mark-${type}`;
  const n = lod.levels[0].object; let tris = 0; n.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.getAttribute('position').count) / 3; });
  lod.userData.triangles = tris;
  return lod;
}

// set a mark's group from a pose (position of the geometric centre, rotation matrix row-major 9)
const _m = new THREE.Matrix4();
export function applyPose(obj, centre, R) {
  _m.set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  obj.position.set(centre[0], centre[1], centre[2]); obj.quaternion.setFromRotationMatrix(_m);
}
