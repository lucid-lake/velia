// The human geography round the lake, drawn (data and masks: src/towns-layout.js):
//   buildings   low-poly blocks from OSM footprints: steep gables on the houses, flat or low roofs on the big boxes, the
//               Stateline high-rises as plain slabs (no signs); one instanced mesh fed per frame from 4 km clusters, each
//               in view and not behind the terrain giving its buildings ≥ 0.8 px from the camera (the largest first)
//   windows     on the mid- and high-rises: dark glass by day, a lit grid at night (pre-filtered to its mean when the
//               grid is under ≈ 3 px)
//   lights      town lights at night as camera-facing glows (one draw call): windows, street lights (sodium and
//               LED), the big lots, pier heads; each switches on at its own sun elevation (D2: time runs)
//   ground      the terrain's albedo where people changed it: ski runs and lift lines (dry grass in late October,
//               snow above the snow line), lawns, lots and roads, and the Hwy 89 cut on Emerald Bay's walls
//   lifts, piers: instanced boxes (the lift towers and terminals, the pier decks)
// No names, signs or logos (rule). Everything sits in the scene pass, so the aerial perspective hazes it.
//
//   import { createTowns } from './towns.js';
//   const towns = await createTowns({ terrain, lonLatToWorld });
//   scene.add(towns.group); tmat.colorNode = towns.ground(tmat.colorNode);   // before the water's wet line
//   each frame: towns.update(camera)       (the per-cluster LOD; cheap)
//   towns.group.userData.daylight         (the sun elevation and the exposure compensation, via src/daylight.js)
import * as THREE from 'three/webgpu';
import {
  attribute, color, float, mix, smoothstep, uniform, vec2, vec3, vec4, uv, dot, exp, max, min, floor, fract, step, clamp,
  positionWorld, positionLocal, normalWorld, positionGeometry, cameraPosition, cameraViewMatrix, cameraProjectionMatrix, modelWorldMatrix, screenSize,
  mx_noise_float, texture, varying, Fn, sin, If,
} from 'three/tsl';
import { loadTownsData, buildTownsLayout, makeQueries, BSTRIDE, LSTRIDE, TOWN_RULES } from './towns-layout.js';
import { depthTint } from './terrain-mesh.js';
import { span } from './profile.js';
import { SHORE_REGION } from '../../src/shoreline-layout.js';
import { take } from './prebake.js';

// earth tones (TRPA design standards: dark, matte, earth-toned roofs and walls)
const WALLS = [0x5b4634, 0x6e5a44, 0x4a3b2e, 0x7d6e5a, 0x6b6760, 0x55594d, 0x8a7e6a, 0x3f4538, 0x7a6450];
const ROOFS = [0x2e2a27, 0x3a2f27, 0x2f3a2f, 0x403f3d, 0x4a3426, 0x262b2c, 0x37403a];
const BIG = [0x8b8478, 0x7a776f, 0x9a9182, 0x6d6a62, 0x857a68];          // the low commercial boxes, the mid-rises
const FACADE = [null, 0x46524f, 0x3b3a35, 0x7a604a, 0xb3a994];             // 1 dark teal-grey, 2 bronze glass, 3 brown-tan, 4 pale beige

const hash = (i, s) => {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) ^ Math.imul(s + 0x632be5ab, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

// the unit building: walls x, z ∈ [−½, ½], y ∈ [0, 1]; a gable roof along x whose ridge vertices (attribute ridge = 1)
// rise by the instance's roof height (with no roof, the slopes are the flat top). No normals: flat-shaded.
function buildingGeometry() {
  const P = [], part = [], ridge = [], axis = [], idx = [];
  const vert = (v, pt, ax, r) => { P.push(...v); part.push(pt); ridge.push(r); axis.push(ax); return part.length - 1; };
  const quad = (a, b, c, d, pt, ax, rg = [0, 0, 0, 0]) => {   // 4 vertices, indexed (30 a building, not 42)
    const [i, j, k, l] = [a, b, c, d].map((v, n) => vert(v, pt, ax, rg[n]));
    idx.push(i, j, k, i, k, l);
  };
  const tri = (a, b, c, pt, ax, rg) => { idx.push(...[a, b, c].map((v, n) => vert(v, pt, ax, rg[n]))); };
  const h = 0.5;
  // walls (axis 0: the wall runs along x, 1: along z); counter-clockwise from outside
  quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], 0, 0);      // south (+z)
  quad([h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h], 0, 0);  // north
  quad([h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h], 0, 1);      // east (+x)
  quad([-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h], 0, 1);  // west
  // the roof: two slopes up to the ridge (z = 0), the gable ends as triangles (walls' colour)
  quad([-h, 1, h], [h, 1, h], [h, 1, 0], [-h, 1, 0], 1, 0, [0, 0, 1, 1]);
  quad([h, 1, -h], [-h, 1, -h], [-h, 1, 0], [h, 1, 0], 1, 0, [0, 0, 1, 1]);
  tri([h, 1, h], [h, 1, -h], [h, 1, 0], 2, 1, [0, 0, 1]);
  tri([-h, 1, -h], [-h, 1, h], [-h, 1, 0], 2, 1, [0, 0, 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  // one vertex buffer for the three flags (WebGPU allows 8 buffers; the instances take 4)
  g.setAttribute('bmeta', new THREE.Float32BufferAttribute(part.flatMap((v, i) => [v, ridge[i], axis[i]]), 3));
  g.setIndex(idx);
  return g;
}

function buildingMaterial(uNight, uComp, uPx, uWin) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
  const dims = attribute('iDims', 'vec4');            // len, wall height, wid, roof height (m)
  const info = attribute('iInfo', 'vec4');            // kind, facade, seed, lit share at night
  const meta = attribute('bmeta', 'vec3');                // part (0 wall, 1 roof slope, 2 gable), ridge, wall axis
  // the ridge rises by the roof height; positionNode works in the unit geometry's space (the instance matrix scales
  // it by the wall height after), so in walls: roof / wall (a roof in metres made 3 m roofs 18 m tall, 2026-10-29)
  m.positionNode = positionLocal.add(vec3(0, meta.y.mul(dims.w.div(dims.y)), 0));
  // metres along the wall and up it, from the unit geometry (so the window grid follows the building, any yaw)
  const g = positionGeometry, ax = meta.z;
  const along = varying(mix(g.x.mul(dims.x), g.z.mul(dims.z), ax));
  const up = varying(g.y.mul(dims.y));
  const vPart = varying(meta.x);
  const vInfo = varying(info), vWall = varying(attribute('iWall', 'vec3')), vRoof = varying(attribute('iRoof', 'vec3'));   // one interleaved buffer
  const vTop = varying(dims.y);
  // windows: 3.0 m columns, 3.2 m floors; on the mid-rises, high-rises and big boxes only; none below 1 m or on the roof
  const kind = vInfo.x, facade = vInfo.y;
  const isWin = step(0.5, kind).mul(step(kind, 4.5)).mul(float(1).sub(step(2.5, kind).mul(step(kind, 3.5))));   // kinds 1, 2, 4
  const colW = float(3.0), flH = float(3.2);
  const cu = along.div(colW), cv = up.sub(1.0).div(flH);
  const inCell = smoothstep(0.18, 0.24, fract(cu)).mul(smoothstep(0.82, 0.76, fract(cu)))
    .mul(smoothstep(0.22, 0.3, fract(cv)).mul(smoothstep(0.78, 0.7, fract(cv))));
  const glassShare = mix(float(0.42), float(0.85), step(1.5, facade).mul(step(facade, 2.5)));   // the glass tower: mostly glass
  const onWall = float(1).sub(step(0.5, vPart)).mul(step(1.0, up)).mul(step(up, vTop.sub(0.8))).mul(isWin);
  // pre-filter: the grid fades to its mean when a column is under ≈ 3 px
  const dist = positionWorld.sub(cameraPosition).length();
  const colPx = colW.div(dist.mul(uPx));
  const sharp = smoothstep(1.5, 4.0, colPx);
  const win = mix(glassShare, mix(inCell, float(1), step(1.5, facade).mul(step(facade, 2.5)).mul(0.6)), sharp).mul(onWall);
  const facadeCol = mix(vWall, color(0x1d2328), win);
  const roofCol = vRoof;
  m.colorNode = depthTint(mix(facadeCol, roofCol, step(0.5, vPart).mul(step(vPart, 1.5))));
  m.roughnessNode = mix(float(0.88), float(0.3), win);
  // night: lit windows (warm, some cool), each window its own hash; their mean when small
  const cell = vec2(floor(cu), floor(cv));
  const rnd = fract(sin(dot(cell.add(vInfo.z.mul(97.0)), vec2(12.9898, 78.233))).mul(43758.5453));
  const litCell = step(rnd, vInfo.w);
  const warm = mix(vec3(1.0, 0.66, 0.36), vec3(0.85, 0.9, 1.0), step(0.8, fract(rnd.mul(7.0))));
  const lit = mix(vInfo.w.mul(glassShare).mul(0.8), inCell.mul(litCell), sharp).mul(onWall);
  m.emissiveNode = warm.mul(lit).mul(uNight).mul(uComp).mul(uWin);
  return m;
}

function lightsMesh(L, uElev, uComp, uGlow) {
  const n = L.count, D = L.data;
  const pos = new Float32Array(n * 12), col = new Float32Array(n * 12), size = new Float32Array(n * 4), on = new Float32Array(n * 4), corner = new Float32Array(n * 8);
  const idx = new Uint32Array(n * 6);
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < n; k++) {
    const o = k * LSTRIDE;
    for (let j = 0; j < 4; j++) {
      const v = k * 4 + j;
      pos.set([D[o], D[o + 1], D[o + 2]], v * 3); col.set([D[o + 3], D[o + 4], D[o + 5]], v * 3);
      size[v] = D[o + 6]; on[v] = D[o + 7]; corner.set(CORNERS[j], v * 2);
    }
    idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('lcolor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('lsize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('lon', new THREE.BufferAttribute(on, 1));
  g.setAttribute('lcorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(corner.map((c) => (c + 1) / 2), 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const centre = attribute('position', 'vec3'), c = attribute('lcorner', 'vec2');
  const view = cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(centre, 1)));
  const depth = view.z.negate();
  const px = depth.mul(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));   // metres per pixel at the light
  // on at its own sun elevation (over ≈ 1.5°); a light that is off draws nothing (a zero-size quad)
  const onAt = attribute('lon', 'float');
  const lvl = smoothstep(onAt.add(0.75), onAt.sub(0.75), uElev);
  const sizeM = max(attribute('lsize', 'float'), px.mul(2.2)).mul(step(0.001, lvl));
  m.vertexNode = Fn(() => cameraProjectionMatrix.mul(vec4(view.xy.add(c.mul(sizeM.mul(0.5))), view.z, 1)))();
  const vCol = varying(attribute('lcolor', 'vec3')), vI = varying(lvl.mul(min(float(1), attribute('lsize', 'float').div(px.mul(2.2)).add(0.35))));
  m.colorNode = Fn(() => {
    const q = uv().mul(2).sub(1), r2 = dot(q, q);
    const glow = exp(r2.mul(-6.0)).mul(0.25).add(exp(r2.mul(-40.0)).mul(2.2));
    return vCol.mul(glow.mul(vI).mul(uComp).mul(uGlow));
  })();
  m.opacityNode = float(1);
  const mesh = new THREE.Mesh(g, m); mesh.name = 'town-lights'; mesh.frustumCulled = false; mesh.renderOrder = 3;
  return mesh;
}

function boxInstances(name, list, stride, toMatrix, mat) {
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.count));
  const M = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < list.count; k++) { toMatrix(list.data, k * stride, p, s); q.setFromAxisAngle(up, list.data[k * stride + toMatrix.yawAt]); M.compose(p, q, s); mesh.setMatrixAt(k, M); }
  mesh.count = list.count; mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

export async function createTowns({ terrain, lonLatToWorld, data = null, rules = TOWN_RULES } = {}) {
  const end = span('towns');
  // the masks the load-time bake already made in a worker (src/prebake.js 'towns'), when it did; and the whole layout
  // (buildings, clusters, lights, lifts, piers) built there too (world streaming): the page
  // then neither fetches nor parses the 1.2 MB data, nor lays it out; only the queries are rebuilt on the masks
  const prebuilt = take(`towns:masks:${terrain.seed ?? 1}`), pre = take(`towns:layout:${terrain.seed ?? 1}`);
  let L;
  if (pre && prebuilt) L = { ...pre, rules, mask: prebuilt.mask, fine: prebuilt.fine, foot: prebuilt.foot, ...makeQueries({ mask: prebuilt.mask, fine: prebuilt.fine, foot: prebuilt.foot, rules }) };
  else { data ??= await loadTownsData(); L = buildTownsLayout(data, { heightAt: terrain.heightAt, lonLatToWorld, rules, prebuilt }); }
  const group = new THREE.Group(); group.name = 'towns';
  const uElev = uniform(30), uComp = uniform(1), uNight = uniform(0), uPx = uniform(0.0013);
  const uWin = uniform(0.03), uGlow = uniform(1), uGround = uniform(1);   // uGround: 0 turns the ground hook off (paired cost checks)   // the windows' and the glows' gains (scene units × the exposure compensation)

  // --- buildings: ONE InstancedMesh (one pipeline; a mesh per cluster cost ≈ 68 pipelines and ≈ 0.4 s of load).
  // The source arrays stay in cluster order; each frame the clusters in view and unoccluded copy their LOD prefix
  // (largest first) into the drawn buffers, only when that set changes.
  const base = buildingGeometry(), bmat = buildingMaterial(uNight, uComp, uPx, uWin);
  const B = L.buildings.data, N = L.buildings.count;
  const M4 = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), tc = new THREE.Color();
  const srcMat = new Float32Array(N * 16), srcDims = new Float32Array(N * 4), srcInfo = new Float32Array(N * 4), srcCols = new Float32Array(N * 6);
  // each cluster's instance data is made the first time the cluster is drawn (most of the lake's 21 k buildings are
  // never in view from the bay): the same numbers, later
  const prep = (c) => { if (c.prepped) return; c.prepped = true; for (let k = c.start; k < c.start + c.count; k++) prepOne(k); };
  function prepOne(k) {
    const o = k * BSTRIDE, kind = B[o + 8], facade = B[o + 9], s = Math.floor(B[o + 10] * 1e6);
    P.set(B[o], B[o + 1], B[o + 2]); Q.setFromAxisAngle(UP, B[o + 5]); S.set(B[o + 3], B[o + 6], B[o + 4]);
    M4.compose(P, Q, S).toArray(srcMat, k * 16);
    srcDims.set([B[o + 3], B[o + 6], B[o + 4], B[o + 7]], k * 4);
    const lit = kind === 2 ? 0.55 : kind === 4 ? 0.4 : kind === 1 ? 0.3 : 0;
    srcInfo.set([kind, facade, hash(s, 3) * 100, lit], k * 4);
    const wc = facade ? FACADE[facade] : (kind === 1 || kind === 4 || kind === 2) ? BIG[s % BIG.length] : WALLS[s % WALLS.length];
    tc.setHex(wc).multiplyScalar(0.85 + 0.3 * hash(s, 5)); srcCols.set([tc.r, tc.g, tc.b], k * 6);
    tc.setHex(kind === 1 || kind === 4 || kind === 2 ? 0x45433f : ROOFS[(s >> 3) % ROOFS.length]).multiplyScalar(0.85 + 0.3 * hash(s, 6)); srcCols.set([tc.r, tc.g, tc.b], k * 6 + 3);
  }
  for (const c of L.clusters) {
    let top = 0;
    for (let i = 0; i < c.count; i++) { const o = (c.start + i) * BSTRIDE; top = Math.max(top, B[o + 1] + B[o + 6] + B[o + 7]); }
    c.sphere = new THREE.Sphere(new THREE.Vector3(c.x, (c.y + top) / 2, c.z), c.r + (top - c.y));
  }
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'bmeta']) g.setAttribute(k, base.getAttribute(k));
  g.setIndex(base.index);
  const aDims = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4), aInfo = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(N * 6), 6, 1);
  g.setAttribute('iDims', aDims); g.setAttribute('iInfo', aInfo);
  g.setAttribute('iWall', new THREE.InterleavedBufferAttribute(ib, 3, 0)); g.setAttribute('iRoof', new THREE.InterleavedBufferAttribute(ib, 3, 3));
  const bmesh = new THREE.InstancedMesh(g, bmat, Math.max(1, N));
  // static usage (three's default): compact() marks needsUpdate when the drawn plan changes; a DynamicDrawUsage
  // attribute would be re-uploaded on every render (1.1 MB a frame)
  bmesh.count = 0; bmesh.frustumCulled = false; bmesh.name = 'town-buildings'; bmesh.matrixAutoUpdate = false;
  const clusters = L.clusters;
  group.add(bmesh);
  // copy the drawn set: per cluster, its first n instances
  function compact(plan) {
    let n = 0;
    const IM = bmesh.instanceMatrix.array;
    for (const [c, k] of plan) {
      if (!k) continue;
      prep(c);
      IM.set(srcMat.subarray(c.start * 16, (c.start + k) * 16), n * 16);
      aDims.array.set(srcDims.subarray(c.start * 4, (c.start + k) * 4), n * 4);
      aInfo.array.set(srcInfo.subarray(c.start * 4, (c.start + k) * 4), n * 4);
      ib.array.set(srcCols.subarray(c.start * 6, (c.start + k) * 6), n * 6);
      n += k;
    }
    bmesh.count = n; bmesh.visible = n > 0;
    bmesh.instanceMatrix.needsUpdate = aDims.needsUpdate = aInfo.needsUpdate = ib.needsUpdate = true;
    return n;
  }

  // --- lights: made when the sun first gets low enough for them (by day they are hidden and never drawn) ---
  let lights = null;
  const needLights = () => { if (!lights) { lights = lightsMesh(L.lights, uElev, uComp, uGlow); lights.visible = false; group.add(lights); } return lights; };

  // --- lift towers and terminals, pier decks: one material (instance colours), one pipeline ---
  const propMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.1 });
  const tint = (mesh, hex) => { const c = new THREE.Color(hex); for (let k = 0; k < mesh.count; k++) mesh.setColorAt(k, c); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; return mesh; };
  const tMat = (D, o, p, s) => { p.set(D[o], D[o + 1] - 0.5, D[o + 2]); if (D[o + 4]) s.set(9, 8, 6); else s.set(0.8, 11 + (D[o + 5] === 1 ? 6 : 0), 0.8); };
  tMat.yawAt = 3;
  const towers = tint(boxInstances('lift-towers', L.lifts, 6, tMat, propMat), 0x3b3e40);
  // inside the shoreline module's stretch its pilings and boathouses draw the piers (from the same OSM lines): a
  // breakwater stays ours, a pier there is skipped
  const SR = SHORE_REGION, inShore = (x, z) => x > SR.x0 && x < SR.x1 && z > SR.z0 && z < SR.z1;
  // a breakwater (kind 1) reaches the bed (BACKLOG-v2 #42, v2's tools/v2-towns-pack.mjs rule): its box went from y − 0.6 up 2.1 m,
  // so its foot hung 0.9 m over the water and read as a hovering slab through the clear water; now the foot goes 0.5 m under the
  // lowest ground along its axis (the water line when that is ashore), the crest unchanged
  const dMat = (D, o, p, s) => {
    const base = D[o + 1] - 0.6;
    if (!D[o + 6] && inShore(D[o], D[o + 2])) { p.set(D[o], base, D[o + 2]); s.set(1e-3, 1e-3, 1e-3); return; }
    if (!D[o + 6]) { p.set(D[o], base, D[o + 2]); s.set(D[o + 3], 0.6, D[o + 4]); return; }
    const top = base + 2.1, ca = Math.cos(D[o + 5]), sa = Math.sin(D[o + 5]);
    let g = Infinity;
    for (const u of [-0.5, 0, 0.5]) g = Math.min(g, terrain.heightAt(D[o] + u * D[o + 3] * ca, D[o + 2] - u * D[o + 3] * sa));
    const foot = Math.min(base, Math.min(0, g) - 0.5);
    p.set(D[o], foot, D[o + 2]); s.set(D[o + 3], top - foot, D[o + 4]);
  };
  dMat.yawAt = 5;
  const decks = boxInstances('piers', L.piers, 7, dMat, propMat);
  { const wood = new THREE.Color(0x6b5a48), rock = new THREE.Color(0x77736a);
    for (let k = 0; k < decks.count; k++) decks.setColorAt(k, L.piers.data[k * 7 + 6] ? rock : wood);
    if (decks.instanceColor) decks.instanceColor.needsUpdate = true; }
  group.add(towers, decks);

  // --- the ground: a TSL hook for the terrain's colour ---
  const mk = (r, fmt) => {
    const t = new THREE.DataTexture(r.data, r.w, r.h, fmt, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; t.anisotropy = 4;
    return t;
  };
  const maskTex = mk(L.mask, THREE.RGBAFormat), fineTex = mk(L.fine, THREE.RGFormat);
  // the ground hook: two texture reads per terrain pixel (shared by the colour and the roughness); the colour work only
  // where a mask is set (an If, so the open forest and the lake pay for the reads alone). The paints carry the ground's
  // own grain: `detail` (the ground material's near-texture luminance over its mean) multiplies them,
  // so a run, a lawn or the asphalt is not flat paper next to the textured ground.
  const Mk = L.mask, Fk = L.fine, p0 = positionWorld;
  const mTap = texture(maskTex, vec2(p0.x.sub(Mk.x0).div(Mk.w * Mk.cell), p0.z.sub(Mk.z0).div(Mk.h * Mk.cell)));
  const fu = vec2(p0.x.sub(Fk.x0).div(Fk.w * Fk.cell), p0.z.sub(Fk.z0).div(Fk.h * Fk.cell));
  const inFine = step(0.0, fu.x).mul(step(fu.x, 1.0)).mul(step(0.0, fu.y)).mul(step(fu.y, 1.0));
  const fTap = texture(fineTex, fu).mul(inFine);
  const groundFn = Fn(([base, detail]) => {
    const p = positionWorld, out = vec3(base).toVar(), m = mTap, f = fTap;
    const any = max(max(max(m.x, m.y), max(m.z, m.w)), max(f.x, f.y));
    If(any.mul(uGround).greaterThan(0.004), () => {
      const n1 = mx_noise_float(p.xz.mul(0.012)), n2 = mx_noise_float(p.xz.mul(0.07));
      const grain = mix(float(1), detail, 0.85);
      // ski runs in summer: summer grass and wildflowers on the cut runs, lighter and yellower than
      // the forest floor, so they still read as stripes; the winter's last snow only on the high runs, longer on the
      // shaded (north-facing) ones, by the day's season line (TAHOE.season: early July 3,000 m, mid-June 2,850 m; 300 m
      // lower on north faces)
      const grass = mix(color(0x6d7a45), color(0x8a8b55), n1.mul(0.5).add(0.5)).mul(n2.mul(0.1).add(0.95));
      const flowers = smoothstep(0.55, 0.75, mx_noise_float(p.xz.mul(0.35))).mul(0.35);   // mule's ears and lupine in drifts
      const flowered = mix(grass, mix(color(0xa89a4c), color(0x7d6f8c), step(0.0, n2)), flowers);
      // high up the cut runs are thin soil over decomposed granite, pale grey-beige with sparse green (the reference
      // photos from the summit): from ≈ 600 m above the lake to bare by ≈ 900 m
      const meadow = mix(flowered, mix(color(0xa49b86), color(0x8c8c6c), n1.mul(0.5).add(0.5)), smoothstep(600.0, 900.0, p.y.add(n1.mul(60.0))));
      const north = clamp(normalWorld.z.negate().mul(3.0), 0, 1);
      const line = float(rules.snowLineY).sub(north.mul(rules.snowAspectM ?? 300));
      const snowW = smoothstep(line.sub(60), line.add(120), p.y.add(n1.mul(70.0))).mul(smoothstep(-0.35, 0.15, n2));
      const run = mix(meadow, color(0xdfe3e6), snowW);
      const lawn = mix(color(0x55633a), color(0x6d6a45), smoothstep(-0.2, 0.6, n1));
      // asphalt: aged, a little lighter in the wheel tracks' grain; patched
      const asphalt = mix(color(0x2e2e2c), color(0x45443f), n2.mul(0.5).add(0.5).mul(0.6));
      const o = mix(color(0x4c463c), run, smoothstep(0.05, 0.6, m.y)).toVar();
      const w = max(m.x.mul(0.35), smoothstep(0.05, 0.6, m.y)).toVar();
      o.assign(mix(o, lawn, m.w)); w.assign(max(w, m.w.mul(0.85)));
      o.assign(mix(o, asphalt, m.z)); w.assign(max(w, m.z.mul(0.9)));
      o.assign(mix(o, asphalt, f.x)); w.assign(max(w, f.x));
      out.assign(mix(base, depthTint(o.mul(grain)), clamp(w, 0, 1)));
      // the Hwy 89 cut: bare decomposed granite. Not a paint: the ground's own colour (its texture and the bay walls'
      // value) shifted toward the warm buff of weathered DG and a touch lighter; the scar reads by the missing forest
      // (keepOut) and this shift, not by a pale band
      const dg = out.mul(vec3(1.13, 1.05, 0.9)).mul(mix(float(1.0), float(1.12), smoothstep(-0.3, 0.5, n2)));
      out.assign(mix(out, dg, f.y.mul(float(1).sub(f.x)).mul(0.8)));
    });
    return out;
  });
  const ground = (base, { detail = float(1) } = {}) => groundFn(base, detail);
  // the roughness: asphalt 0.78 (aged and dusty, a faint sheen at grazing light) where the roads and the lots are
  const roughness = (base) => mix(base, float(0.78), clamp(max(mTap.z.mul(0.9), fTap.x), 0, 1).mul(uGround));

  // --- the per-frame LOD: each cluster draws its buildings ≥ 0.8 px from the camera ---
  // Occlusion: a cluster hidden behind the terrain draws nothing. Rays from the camera to its probes (the tops of
  // its largest and of a spread of its buildings) over heightAt; a few clusters re-tested each frame, round robin,
  // and all of them when the camera jumps. Inside Emerald Bay the walls hide every town.
  const heightAt = terrain.heightAt;
  for (const c of clusters) {
    const probes = [], pick = new Set([0, 1, 2, 3, 4, 5]);
    for (let i = 0; i < 8; i++) pick.add(Math.floor((i + 0.5) / 8 * c.count));
    for (const i of pick) if (i < c.count) { const o = (c.start + i) * BSTRIDE; probes.push(B[o], B[o + 1] + B[o + 6] + B[o + 7], B[o + 2]); }
    c.probes = probes; c.seen = true;
  }
  function sees(cam, c) {
    for (let k = 0; k < c.probes.length; k += 3) {
      const tx = c.probes[k], ty = c.probes[k + 1], tz = c.probes[k + 2];
      const dx = tx - cam.x, dy = ty - cam.y, dz = tz - cam.z, d = Math.hypot(dx, dz);
      const step = Math.max(30, d / 160), n = Math.ceil(d / step);
      let clear = true;
      for (let i = 1; i < n; i++) {
        const f = i / n, s2 = d * f;
        if (heightAt(cam.x + dx * f, cam.z + dz * f) > cam.y + dy * f - s2 * (d - s2) / 14.65e6) { clear = false; break; }   // the earth's curve: 2 × 1.15 R (refraction k = 0.13)
      }
      if (clear) return true;
    }
    return false;
  }
  let rr = 0, lastPlan = '';
  const lastCam = new THREE.Vector3(Infinity, 0, 0), frustum = new THREE.Frustum(), PV = new THREE.Matrix4();
  // --- the per-frame LOD: each cluster draws its buildings ≥ 0.8 px from the camera; the distance is quantised
  // (quarter octaves) so a moving camera re-copies the set a few times a second at most
  const MINPX = 0.8;
  function update(camera, viewHeight = 720) {
    const pxAngle = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) / viewHeight;
    uPx.value = pxAngle;
    const cam = camera.position, jump = cam.distanceTo(lastCam) > 400;
    const tests = jump ? clusters.length : Math.min(clusters.length, 3);
    for (let t = 0; t < tests; t++) { const c = clusters[rr++ % clusters.length]; c.seen = sees(cam, c); }
    if (jump || rr % Math.max(1, clusters.length) < tests) lastCam.copy(cam);
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const plan = []; let key = '', hidden = 0;
    for (const c of clusters) {
      if (!c.seen || !frustum.intersectsSphere(c.sphere)) { hidden++; continue; }
      const d0 = Math.max(1, Math.hypot(cam.x - c.x, cam.y - c.y, cam.z - c.z) - c.r);
      const d = Math.pow(2, Math.floor(Math.log2(d0) * 4) / 4);
      const need = MINPX * d * pxAngle;           // metres for MINPX px at the cluster's near edge
      let lo = 0, hi = c.count;                   // sizes are descending: the first index below `need`
      while (lo < hi) { const mid = (lo + hi) >> 1; if (c.sizes[mid] >= need) lo = mid + 1; else hi = mid; }
      if (lo) { plan.push([c, lo]); key += `${c.start}:${lo},`; }
    }
    if (key !== lastPlan) { lastPlan = key; stats.drawn = compact(plan); stats.recopies++; }
    stats.hiddenClusters = hidden;
  }
  group.userData.daylight = (f) => {
    uElev.value = f.elevDeg; uComp.value = f.exposureComp ?? 1;
    uNight.value = 1 - Math.min(1, Math.max(0, (f.elevDeg + 3) / 4));   // the windows: from −3° to +1°
    if (f.elevDeg < 3.5) needLights().visible = true; else if (lights) lights.visible = false;
  };
  const stats = { ...L.stats, drawn: 0, recopies: 0, drawCalls: 6 };
  end();
  return { group, layout: L, ground, roughness, update, stats, keepOut: L.keepOut, coverAt: L.coverAt, treeDensity: L.treeDensity, uniforms: { uElev, uComp, uNight, uWin, uGlow, uGround } };
}
