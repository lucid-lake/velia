// 10a (trimmed, owner 2026-11-13: "trim towns and add the pier"): v1's piers, breakwaters, boathouses, light tower and
// harbour, and the ground's paint (Hwy 89's asphalt and cut on Emerald Bay's walls, the ski runs) packed for v2.
//   node tools/v2-towns-pack.mjs [--check]
// The placement is v1's own, on v1's terrain (src/sim/terrain.js makeTerrain: the same heights v2 draws):
//   src/towns-layout.js buildTownsLayout  → the deck segments (piers, area piers, breakwaters) and the masks (L.fine, L.mask)
//   src/shoreline-layout.js layoutShoreline (realPiers: the layout's osmPiers) → the bay's piers on pilings, the boathouses,
//                                                                                the disused light tower
//   src/harbour.js createHarbour          → the marina's merged static mesh and its breakwater's rocks (three in node)
// v1's page draws the towns' decks outside the shoreline module's region and the shoreline's piers inside it (src/towns.js
// dMat); so does this pack. v1's meshes and colours (src/shoreline.js, src/towns.js) become v2's instanced meshes.
// Output: v2/assets/towns/shore.vsh.gz and mask.vtm.gz (v2/towns/format.js), and the phone's set derived from them (
// § Round 2: shore-phone.vsh.gz, the bay's instances only; mask-phone.vtm.gz, Hwy 89's window without the ski runs).
// --check (and v2/tests/towns.test.mjs) compares the decoded content, not the gzip bytes (zlib builds differ: Node 24's own
// against a system zlib 1.2.12): the masks byte for byte; the shore's counts, indices, normals, colours and tints exactly,
// its float32 planes (the instances' matrices, each mesh's box and the positions) within 4e-6 of each number. V8's Math
// functions differ in the last bit between platforms, which flips a matrix entry by a few float32 steps (a Linux x64 pack
// against a Mac's); a moved pier moves it by metres.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeMask, encodeShore, decodeShore, filterShore, filterMask, RASTER, MESH, CHUNK, matByte, SHORE_SETS, inArea } from '../v2/towns/format.js';
import { inflate, unpredict, metres } from '../v2/terrain/decode.js';
import { nearDiff } from './near.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'v2/assets/towns');

// the south level's heights (terrain/south: metres over the lake, 0 = the surface), bilinear as the sampler's: the 4 m level
// (a desktop) and the 8 m level (a phone); a south pier's feet reach the lower of the two beds, its deck clears the higher
async function southHeights() {
  const load = async (name) => {
    const dir = resolve(ROOT, 'terrain/south'), M = JSON.parse(readFileSync(resolve(dir, name), 'utf8')), L = M.levels[0];
    const q = unpredict(await inflate(readFileSync(resolve(dir, L.height))), L.w, L.h), m = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) m[i] = metres(q[i], M.height);
    return (x, z) => {
      const fx = Math.min(Math.max((x - L.x0) / L.step, 0), L.w - 1), fz = Math.min(Math.max((z - L.z0) / L.step, 0), L.h - 1);
      const i = Math.min(Math.floor(fx), L.w - 2), j = Math.min(Math.floor(fz), L.h - 2), u = fx - i, v = fz - j, k = j * L.w + i;
      return (m[k] * (1 - u) + m[k + 1] * u) * (1 - v) + (m[k + L.w] * (1 - u) + m[k + L.w + 1] * u) * v;
    };
  };
  const a = await load('south.json'), b = await load('south-phone.json');
  return { bed: (x, z) => Math.min(a(x, z), b(x, z)), top: (x, z) => Math.max(a(x, z), b(x, z)), a, b };
}
// the south shore's piers (the shoreline's pier look: a 0.3 m deck at 1.4 m over the lake on pilings every 3 m both sides, from
// the bed to the deck; here the deck rises with the ground where the pier meets the beach)
export const SOUTH_PIER = Object.freeze({ deckY: 1.4, deck: 0.3, pile: 3, bedBelow: 0.4, clearOver: 0.4, clear: 0.1, inland: 8 });

// linear (three's working colour) → sRGB bytes
const toS = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));
const hexS = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// a three geometry → { pos, nrm, col (sRGB bytes | null), idx }
function meshOf(THREE, g, { colourHex = null } = {}) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
  const pos = Float32Array.from(p.array.slice(0, p.count * 3)), nrm = Float32Array.from(n.array.slice(0, n.count * 3));
  let col = null;
  if (c) { col = new Uint8Array(p.count * 3); for (let i = 0; i < p.count; i++) for (let k = 0; k < 3; k++) col[3 * i + k] = toS(c.getComponent(i, k)); }
  else if (colourHex != null) { const s = hexS(colourHex); col = new Uint8Array(p.count * 3); for (let i = 0; i < p.count; i++) col.set(s, 3 * i); }
  // #41b: a geometry's own roughness per vertex (the tower's parts: v1's materials differ part by part), as the alpha byte
  const r = g.getAttribute('rough');
  const alpha = r ? Uint8Array.from({ length: p.count }, (_, i) => Math.round(255 * r.getX(i))) : null;
  return { pos, nrm, col, alpha, idx: g.index ? Uint32Array.from(g.index.array) : null };
}
const mat12 = (M) => { const e = M.elements; return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10], e[12], e[13], e[14]]; };

export async function packTowns() {
  const THREE = await import('three/webgpu');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const { makeTerrain } = await import('../src/sim/terrain.js');
  const { makeGeo } = await import('../src/sim/geo.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const { loadTownsData, buildTownsLayout } = await import('../classic/src/towns-layout.js');
  const { layoutShoreline, SHORE_REGION } = await import('../src/shoreline-layout.js');
  const { createHarbour } = await import('../classic/src/harbour.js');
  const terrain = makeTerrain({ seed: 1 });
  const TD = await loadTownsData(), geo = makeGeo(CURRENT_WATERS);
  const L = buildTownsLayout(TD, { heightAt: terrain.heightAt, lonLatToWorld: geo.lonLatToWorld });
  const SH = layoutShoreline(terrain, { seed: 1, realPiers: L.osmPiers });
  const harbour = createHarbour({ terrain, seed: 1 });
  harbour.group.updateMatrixWorld(true);

  // --- the meshes (v1's shapes) ---
  const box = new THREE.BoxGeometry(1, 1, 1);
  const pile = new THREE.CylinderGeometry(0.14, 0.16, 1, 6);
  const roof = (() => {   // src/shoreline.js roofGeometry: a gable prism, ridge along z, base at y = 0
    const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }); g.translate(0, 0, -0.5); return g;
  })();
  const T = SH.tower;
  const tower = (() => {   // src/shoreline.js's light tower, merged with its colours
    // each part with v1's colour and roughness (src/shoreline.js mat(c, rough))
    const part = (g, hex, rough, y, ry = 0) => { if (ry) g.rotateY(ry); g.translate(0, y, 0); const n = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex), k = n.attributes.position.count, a = new Float32Array(k * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.setAttribute('rough', new THREE.BufferAttribute(new Float32Array(k).fill(rough), 1)); n.deleteAttribute('uv'); return n; };
    return mergeGeometries([
      part(new THREE.BoxGeometry(2.2, 1.2, 2.2), 0x8d8a83, 1, -0.4),
      part(new THREE.CylinderGeometry(0.55, 0.8, T.heightM, 4), 0xb9b5ab, 0.95, T.heightM / 2, Math.PI / 4),
      part(new THREE.BoxGeometry(1.7, 0.12, 1.7), 0x3a3f42, 0.8, T.heightM),
      part(new THREE.CylinderGeometry(0.42, 0.42, 0.9, 8), 0x3a3f42, 0.6, T.heightM + 0.5),
      part(new THREE.ConeGeometry(0.55, 0.5, 8), 0x3a3f42, 0.7, T.heightM + 1.2),
    ]);
  })();
  const hStatic = harbour.group.getObjectByName('harbour-static'), hRocks = harbour.group.getObjectByName('harbour-rocks');
  const meshes = [];
  meshes[MESH.box] = meshOf(THREE, box); meshes[MESH.pile] = meshOf(THREE, pile); meshes[MESH.roof] = meshOf(THREE, roof);
  meshes[MESH.tower] = meshOf(THREE, tower); meshes[MESH.harbour] = meshOf(THREE, hStatic.geometry); meshes[MESH.rock] = meshOf(THREE, hRocks.geometry);
  const insts = meshes.map(() => []);

  const EU = new THREE.Euler(), M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  // #41b: each instance carries v1's material (its roughness and metalness: the flags byte, format.js matByte); 0 (the
  // tower) reads the mesh's own per-vertex roughness
  const put = (mesh, x, y, z, yaw, sx, sy, sz, hex, mat = 0) => { Q.setFromAxisAngle(UP, yaw); M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)); insts[mesh].push({ m: mat12(M), tint: hexS(hex), flags: mat }); };
  // v1's materials (src/shoreline.js COL and mat(c, rough); src/towns.js propMat for its decks and breakwaters;
  // src/harbour.js staticMat, rockMat)
  const MAT = { deck: matByte(0.9), piling: matByte(0.85), wall: matByte(0.85), roof: matByte(0.7), trim: matByte(0.85), townDeck: matByte(0.75, 0.1), harbour: matByte(0.85), rock: matByte(0.9) };

  // the towns' decks (src/towns.js dMat: the box's base at y − 0.6, 0.6 m tall, a breakwater 2.1 m); inside the shoreline's
  // region its piers draw those (a breakwater there stays the towns'). v2 grounds a breakwater: its toe goes down to the bed
  // (v1's floats 0.9 m over the water; seen through Tahoe's clear water from the boat it read as a hovering slab)
  const SR = SHORE_REGION, inShore = (x, z) => x > SR.x0 && x < SR.x1 && z > SR.z0 && z < SR.z1;
  const D = L.piers.data;
  let decks = 0, breakwaters = 0, inland = 0, southSkipped = 0;
  const SOUTH = SHORE_SETS.south;
  for (let k = 0; k < L.piers.count; k++) {
    const o = k * 7, x = D[o], y = D[o + 1], z = D[o + 2], len = D[o + 3], wid = D[o + 4], yaw = D[o + 5], kind = D[o + 6];
    if (!kind && inShore(x, z)) continue;
    if (inArea(SOUTH.area, x, z)) { southSkipped++; continue; }   // the south pack holds it (below)
    // a segment wholly over ground more than 8 m above the lake is an inland boardwalk OSM tags as a pier (v1 floats a deck
    // 1.2 m over the hillside there): left out
    { const ca = Math.cos(yaw), sa = Math.sin(yaw); let low = Infinity;
      for (const u of [-0.5, 0, 0.5]) for (const v of [-0.5, 0.5]) low = Math.min(low, terrain.heightAt(x + u * len * ca + v * wid * sa, z - u * len * sa + v * wid * ca));
      if (low > 8) { inland++; continue; } }
    let base = y - 0.6;
    const top = base + 0.6 + kind * 1.5;
    if (kind) {
      const ca = Math.cos(yaw), sa = Math.sin(yaw);
      let g = Infinity;
      for (const u of [-0.5, 0, 0.5]) g = Math.min(g, terrain.heightAt(x + u * len * ca, z - u * len * sa));
      base = Math.min(base, Math.min(0, g) - 0.5); breakwaters++;
    } else decks++;
    put(MESH.box, x, (base + top) / 2, z, yaw, len, top - base, wid, kind ? 0x77736a : 0x6b5a48, MAT.townDeck);
  }
  // the shoreline's piers (src/shoreline.js): a 0.3 m deck on pilings every 3 m both sides, from the bed to the deck;
  // boathouses over the outer end
  let piles = 0, bhs = 0;
  for (const q of SH.piers) {
    const yaw = Math.atan2(q.dirX, q.dirZ), cx = q.x + q.dirX * q.length / 2, cz = q.z + q.dirZ * q.length / 2;
    put(MESH.box, cx, q.deckY, cz, yaw, q.width, 0.3, q.length, 0x6b5a48, MAT.deck);
    for (let a = 1.5; a < q.length; a += 3) for (const side of [-1, 1]) {
      const x = q.x + q.dirX * a + q.dirZ * side * (q.width / 2 - 0.15), z = q.z + q.dirZ * a - q.dirX * side * (q.width / 2 - 0.15);
      const b = Math.min(0, terrain.heightAt(x, z)) - 0.5, t = q.deckY - 0.15;
      put(MESH.pile, x, (b + t) / 2, z, 0, 1, t - b, 1, 0x3d342c, MAT.piling); piles++;
    }
    if (!q.boathouse) continue;
    const w = 7, d = 11, h = 4.2, a = q.length - d / 2 - 0.5, x = q.x + q.dirX * a, z = q.z + q.dirZ * a, y0 = q.deckY - 0.15;
    put(MESH.box, x, y0 + h / 2, z, yaw, w, h, d, 0x5a4636, MAT.wall);
    put(MESH.roof, x, y0 + h, z, yaw, w + 1, 2.4, d + 1, 0x2f3d33, MAT.roof);
    put(MESH.box, x + q.dirX * (d / 2 + 0.02), y0 + 1.6, z + q.dirZ * (d / 2 + 0.02), yaw, 5, 3.2, 0.05, 0xd8d2c4, MAT.trim);
    bhs++;
  }

  // --- the south shore's piers: every OSM pier segment (and breakwater) whose middle is in the south area, on the south level's
  // own ground: the same segments v1's layout makes (src/towns-layout.js: ≥ 0.5 m, a non-area one's length + half its width) ---
  const { fromUTM } = await import('../src/sim/geo/utm.js');
  const SG = await southHeights();
  const sIn = [[], []];   // MESH.box, MESH.pile
  const sPut = (mesh, x, y, z, yaw, pitch, sx, sy, sz, hex, mat) => {
    Q.setFromEuler(EU.set(0, yaw, pitch, 'YXZ')); M.compose(P.set(x, y, z), Q, S.set(sx, sy, sz)); sIn[mesh].push({ m: mat12(M), tint: hexS(hex), flags: mat });
  };
  const SP = SOUTH_PIER, south = { segments: 0, inland: 0, decks: 0, breakwaters: 0, piles: 0, lenM: 0, ways: 0 };
  const [E0, N0] = TD.origin;
  TD.piers.forEach((p) => {
    const pts = []; for (let k = 0; k < p.p.length; k += 2) { const g = fromUTM(p.p[k] + E0, p.p[k + 1] + N0); pts.push(geo.lonLatToWorld(g.lon, g.lat)); }
    let any = false;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], Lg = Math.hypot(bx - ax, bz - az);
      if (Lg < 0.5) continue;
      if (!inArea(SOUTH.area, (ax + bx) / 2, (az + bz) / 2)) continue;
      south.segments++; any = true;
      const dx = (bx - ax) / Lg, dz = (bz - az) / Lg, yaw = Math.atan2(-(bz - az), bx - ax), wid = p.w;
      // the ground along the segment (the higher of the two south levels, every 2 m)
      const n = Math.max(2, Math.ceil(Lg / 2)); let low = Infinity, bedMin = Infinity;
      for (let i = 0; i <= n; i++) { const t = i / n, x = ax + dx * Lg * t, z = az + dz * Lg * t; low = Math.min(low, SG.top(x, z)); bedMin = Math.min(bedMin, SG.bed(x, z)); }
      if (low > SP.inland) { south.inland++; continue; }   // an inland boardwalk OSM tags as a pier: left out, as the shared pack's
      south.lenM += Lg;
      if (p.k) {   // a breakwater: v1's slab (2.1 m over its base), its toe to the bed
        const gm = SG.top((ax + bx) / 2, (az + bz) / 2), y = Math.max(1.5, gm + 1.5), top = y + 1.5, base = Math.min(0, bedMin) - 0.5;
        sPut(MESH.box, (ax + bx) / 2, (base + top) / 2, (az + bz) / 2, yaw, 0, Lg + (p.a ? 0 : wid * 0.5), top - base, wid, 0x77736a, MAT.townDeck); south.breakwaters++;
        continue;
      }
      // the deck's ends: 1.4 m over the lake, or 0.4 m over the beach (the higher ground of the two levels under the end)
      const yEnd = (x, z) => Math.max(SP.deckY, SG.top(x, z) + SP.clearOver);
      let ya = yEnd(ax, az), yb = yEnd(bx, bz);
      { // a bump between the ends lifts the whole deck: its underside stays over the ground along the segment
        let lift = 0;
        for (let i = 0; i <= n; i++) { const t = i / n; lift = Math.max(lift, SG.top(ax + dx * Lg * t, az + dz * Lg * t) + SP.deck / 2 + SP.clear - (ya + (yb - ya) * t)); }
        ya += lift; yb += lift; }
      const pitch = Math.atan2(yb - ya, Lg), ext = Lg + (p.a ? 0 : wid * 0.5);
      sPut(MESH.box, (ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2, yaw, pitch, ext / Math.cos(pitch), SP.deck, wid, 0x6b5a48, MAT.deck); south.decks++;
      for (let a = SP.pile / 2; a < Lg; a += SP.pile) for (const side of [-1, 1]) {
        const x = ax + dx * a + dz * side * (wid / 2 - 0.15), z = az + dz * a - dx * side * (wid / 2 - 0.15);
        const t = ya + (yb - ya) * a / Lg - SP.deck / 2, b = SG.bed(x, z) - SP.bedBelow;
        if (t - b < 0.3) continue;   // the deck sits on the ground there: no piling
        sPut(MESH.pile, x, (b + t) / 2, z, 0, 0, 1, t - b, 1, 0x3d342c, MAT.piling); south.piles++;
      }
    }
    if (any) south.ways++;
  });
  if (south.segments !== southSkipped) throw new Error(`south piers: ${south.segments} segments here, ${southSkipped} left out of the shared pack`);
  { const key = (it) => Math.floor(it.m[11] / CHUNK) * 100000 + Math.floor(it.m[9] / CHUNK);
    for (const l of sIn) { l.forEach((it, i) => { it.i = i; }); l.sort((a, b) => key(a) - key(b) || a.i - b.i); } }
  const southShore = encodeShore([meshes[MESH.box], meshes[MESH.pile]], sIn);
  put(MESH.tower, T.x, T.y, T.z, T.facing, 1, 1, 1, 0xffffff);
  // the harbour: its static mesh where v1 puts it, its rocks as v1's instances with their granite tints
  insts[MESH.harbour].push({ m: mat12(hStatic.matrixWorld), tint: [255, 255, 255], flags: MAT.harbour });
  const IM = new THREE.Matrix4(), IC = new THREE.Color();
  for (let i = 0; i < hRocks.count; i++) {
    hRocks.getMatrixAt(i, IM); IM.premultiply(hRocks.matrixWorld);
    hRocks.getColorAt(i, IC);
    insts[MESH.rock].push({ m: mat12(IM), tint: [toS(IC.r), toS(IC.g), toS(IC.b)], flags: MAT.rock });
  }
  // each mesh's instances sorted by their 1 km chunk (stable): the loader culls by chunk
  const key = (it) => Math.floor(it.m[11] / CHUNK) * 100000 + Math.floor(it.m[9] / CHUNK);
  for (const l of insts) { l.forEach((it, i) => { it.i = i; }); l.sort((a, b) => key(a) - key(b) || a.i - b.i); }
  const shore = encodeShore(meshes, insts);

  // --- the ground's paint: v1's fine window (asphalt, cut) and the coarse mask's ski channel, each cropped ---
  const crop = (R, chans, kind) => {
    let i0 = R.w, j0 = R.h, i1 = -1, j1 = -1;
    for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) for (const c of chans) if (R.data[(j * R.w + i) * R.channels + c]) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
    i0 = Math.max(0, i0 - 2); j0 = Math.max(0, j0 - 2); i1 = Math.min(R.w - 1, i1 + 2); j1 = Math.min(R.h - 1, j1 + 2);
    const w = i1 - i0 + 1, h = j1 - j0 + 1, ch = chans.length, data = new Uint8Array(w * h * ch);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) chans.forEach((c, q) => { data[(j * w + i) * ch + q] = R.data[((j + j0) * R.w + i + i0) * R.channels + c]; });
    return { kind, x0: R.x0 + i0 * R.cell, z0: R.z0 + j0 * R.cell, cell: R.cell, w, h, ch, data };
  };
  const mask = encodeMask([crop(L.fine, [0, 1], RASTER.FINE), crop(L.mask, [1], RASTER.SKI)]);
  const files = { 'shore.vsh.gz': gzipSync(shore, { level: 9 }), 'mask.vtm.gz': gzipSync(mask, { level: 9 }),
    'shore-phone.vsh.gz': gzipSync(filterShore(shore), { level: 9 }), [SOUTH.file]: gzipSync(southShore, { level: 9 }), 'mask-phone.vtm.gz': gzipSync(filterMask(mask, [RASTER.FINE]), { level: 9 }) };
  const counts = { south, southBytes: southShore.length, decks, breakwaters, inland, piers: SH.piers.length, piles, boathouses: bhs, rocks: hRocks.count, harbourTris: meshes[MESH.harbour].pos.length / 9, instances: insts.reduce((s, l) => s + l.length, 0) };
  return { files, raw: { shore: shore.length, mask: mask.length }, counts, layout: L, shoreline: SH };
}

// a fresh file against the committed one, both gunzipped: null when the same content, else the first mismatch
export function townsDiff(name, fresh, committed) {
  if (!name.startsWith('shore')) return Buffer.compare(Buffer.from(fresh), Buffer.from(committed)) === 0 ? null : 'the bytes differ';
  const A = decodeShore(fresh), B = decodeShore(committed);
  const ints = (S) => ({ instances: S.instances, tints: S.tints, meshes: S.meshes.map((m) => ({ verts: m.verts, nrm: m.nrm, col: m.col, idx: m.idx, first: m.first, count: m.count, flags: m.flags })) });
  const f32 = (S) => ({ mats: S.mats, meshes: S.meshes.map((m) => ({ lo: m.lo, hi: m.hi, pos: m.pos })) });
  return nearDiff(ints(A), ints(B), { rel: 0 }) ?? nearDiff(f32(A), f32(B), { rel: 4e-6 });
}

async function main() {
  const check = process.argv.includes('--check');
  const p = await packTowns();
  mkdirSync(OUT, { recursive: true });
  let bad = 0;
  for (const [name, bytes] of Object.entries(p.files)) {
    const f = resolve(OUT, name);
    if (check) {
      const d = existsSync(f) ? townsDiff(name, gunzipSync(bytes), gunzipSync(readFileSync(f))) : 'missing';
      console.log(`${name}: ${bytes.length} B ${d ? `DIFFERS (${d})` : 'matches'}`); if (d) bad++;
    } else { writeFileSync(f, bytes); console.log(`${f}: ${bytes.length} B`); }
  }
  console.log(`raw shore ${p.raw.shore} B, mask ${p.raw.mask} B;`, JSON.stringify(p.counts));
  if (bad) process.exit(1);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
