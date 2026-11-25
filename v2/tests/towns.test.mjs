// 10a: the towns' data (v2/towns/format.js, tools/v2-towns-pack.mjs, v2/render/towns.js's pure parts).
//   the pack      the shipped files are the tool's output (v1's layouts, deterministic); the formats round-trip
//   placement     on v1's heights (= v2's: terrain/sample.js holds the twin to them): every pier deck stands over the lake
//                 or its shore, above the water; every piling reaches from the bed to its deck; each breakwater's toe on
//                 the bed; the boathouses over a deck's end; the harbour where v1 builds it
//   the night     v1's pier-head lights (v2/assets/night/lights.bin, the same layout) stand on the shipped decks
//   the marks     Hwy 89 is marked in the fine window and the ski runs in the coarse one; the keep-out twin keeps a crown
//                 off them (the GPU side: v2/tests/pages/towns.page.mjs reads the forest's buffer back)
//   the culling   the chunks cover every instance once; a camera in the bay picks the bay's piers, a far camera fewer
//   #41b material v1's roughness and metalness per instance (the pack's material byte), the tower's per vertex
//   #41c mirror   every pier piece a proxy; the nearest picked from the pier pose take the boathouse; a ray from the
//                 mirror point at the wall's elevation meets the wall's box, one over the roof's apex meets nothing
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { decodeShore, mergeShore, encodeShore, decodeMask, encodeMask, sampleRaster, maskAt, keepOut, keepOutR, MESH, RASTER, KEEP, matByte, matOf, BAY, inBay, filterShore, filterMask } from '../towns/format.js';
import { SHORE_REGION } from '../../src/shoreline-layout.js';
import { shoreArrays, pickDraws, RANGE, SHADOW_MESHES, mirrorProxies, pickMirror, harbourParts, MIRROR } from '../render/towns.js';
import { decodeLights } from '../sim/night.js';
import { packTowns, townsDiff } from '../../tools/v2-towns-pack.mjs';
import { makeTerrain } from './helpers/ground.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = (f) => gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/towns', f)));
const S = decodeShore(file('shore.vsh.gz')), M = decodeMask(file('mask.vtm.gz'));
// the south shore's piers are their own file (a south start's: tests/south-piers.test.mjs); S is the shared shore, ALL what a south start draws
const ALL = mergeShore(S, [decodeShore(file('shore-south.vsh.gz'))]);
const terrain = makeTerrain({ seed: 1 }), H = (x, z) => terrain.heightAt(x, z);
const packedP = packTowns();
const inst = (i) => { const m = S.mats.subarray(i * 12, i * 12 + 12); return { X: [m[0], m[1], m[2]], Y: [m[3], m[4], m[5]], Z: [m[6], m[7], m[8]], O: [m[9], m[10], m[11]] }; };
const len = (v) => Math.hypot(...v);
const range = (mesh) => { const m = S.meshes[mesh]; return Array.from({ length: m.count }, (_, k) => m.first + k); };

test('the shipped files are the pack tool\'s output (v1\'s layouts, deterministic)', async () => {
  const p = await packedP;
  for (const f of ['shore.vsh.gz', 'shore-south.vsh.gz', 'mask.vtm.gz']) {
    const d = townsDiff(f, gunzipSync(p.files[f]), file(f));   // the decoded content (tools/v2-towns-pack.mjs townsDiff)
    assert.equal(d, null, `${f}: ${d}: re-run node tools/v2-towns-pack.mjs`);
  }
  assert.ok(p.counts.piers >= 30 && p.counts.boathouses >= 8 && p.counts.breakwaters > 100 && p.counts.decks > 2000, JSON.stringify(p.counts));
  // the bytes on the wire (after the first frame) and the GPU's
  const wire = readFileSync(resolve(ROOT, 'v2/assets/towns/shore.vsh.gz')).length + readFileSync(resolve(ROOT, 'v2/assets/towns/mask.vtm.gz')).length;
  assert.ok(wire < 450e3, `${wire} B on the wire`);
  assert.ok(M.size < 12e6, `${M.size} B of mask on the GPU`);
});

test('the formats round-trip: the mask byte for byte at level 0 and its pyramid\'s means; the shore within its quantum', () => {
  const r = { kind: RASTER.FINE, x0: -10, z0: 20, cell: 2.5, w: 37, h: 21, ch: 2, data: new Uint8Array(37 * 21 * 2).map((_, i) => (i * 37) % 256) };
  const D = decodeMask(encodeMask([r]));
  assert.equal(D.rasters.length, 1); assert.equal(D.rasters[0].levels > 1, true);
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) for (let c = 0; c < 2; c++) {
    const v = sampleRaster(D, 0, r.x0 + (i + 0.5) * r.cell, r.z0 + (j + 0.5) * r.cell, c);
    assert.ok(Math.abs(v * 255 - r.data[(j * r.w + i) * 2 + c]) < 1e-6);
  }
  assert.equal(sampleRaster(D, 0, -1000, 0, 0), 0);   // 0 outside (v1's sampler)
  const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 5, -3]), nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const m = [1, 0, 0, 0, 2, 0, 0, 0, 3, 100.5, -2, 7], E = decodeShore(encodeShore([{ pos, nrm, col: null, idx: new Uint32Array([0, 1, 2]) }], [[{ m, tint: [10, 20, 30] }]]));
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(E.meshes[0].pos[i] - pos[i]) < 2e-4 * 13);
  assert.deepEqual(Array.from(E.mats), m); assert.deepEqual(Array.from(E.tints.subarray(0, 3)), [10, 20, 30]);
  assert.deepEqual(Array.from(E.meshes[0].idx), [0, 1, 2]);
});

test('placement on the terrain: decks over the water or the shore and above it, pilings from the bed to the deck, breakwaters on the bed, boathouses on a deck\'s end', () => {
  let decks = 0, inland = 0;
  for (const i of range(MESH.box)) {
    const { X, Y, Z, O } = inst(i), top = O[1] + len(Y) / 2, bottom = O[1] - len(Y) / 2;
    if (len(Y) > 3.5) continue;   // a boathouse's walls (4.2 m), checked below
    if (Math.min(len(X), len(Z)) < 0.2) continue;   // a boathouse's door (5 × 3.2 × 0.05 m)
    decks++;
    assert.ok(top > 0.3 && top < Math.max(0, H(O[0], O[2])) + 3.5, `instance ${i}: its top at ${top.toFixed(2)} m over ground at ${H(O[0], O[2]).toFixed(2)} (v1: 1.2 m over the water or the ground)`);
    // a breakwater's toe reaches the bed (v2 grounds it: v1's floated)
    if (len(Y) > 1) { const g = Math.min(0, H(O[0], O[2])); assert.ok(bottom <= g + 0.05 || bottom <= -0.4, `breakwater ${i}: toe ${bottom.toFixed(2)} over the bed ${g.toFixed(2)}`); }
    // somewhere along it the lake or its shore (≤ 8 m up)
    let low = Infinity; for (const u of [-0.5, 0, 0.5]) low = Math.min(low, H(O[0] + X[0] * u, O[2] + X[2] * u), H(O[0] + Z[0] * u, O[2] + Z[2] * u));
    if (low >= 8) inland++;
  }
  assert.ok(decks > 2500, `${decks} decks (the south area's are in shore-south.vsh)`);
  // OSM tags a few boardwalks inland as piers (v1 floats a deck 1.2 m over the hillside): the pack leaves them out
  assert.ok(inland / decks < 0.02, `${inland} of ${decks} decks stand more than 8 m up`);
  for (const i of range(MESH.pile)) {
    const { Y, O } = inst(i), bottom = O[1] - len(Y) / 2, top = O[1] + len(Y) / 2;
    assert.ok(bottom <= Math.min(0, H(O[0], O[2])) - 0.4, `piling ${i}: its foot ${bottom.toFixed(2)} over the bed`);
    assert.ok(top > 1 && top < 1.5, `piling ${i}: its head at ${top.toFixed(2)} (v1's deck at 1.4 m)`);
  }
  const deckTops = range(MESH.box).map(inst).filter((d) => Math.abs(len(d.Y) - 0.3) < 1e-3);
  for (const i of range(MESH.roof)) {
    const { O } = inst(i);
    assert.ok(deckTops.some((d) => Math.hypot(d.O[0] - O[0], d.O[2] - O[2]) < len(d.Z) / 2 + 1), `roof ${i}: over no deck`);
  }
  // the harbour where v1 builds it: on the south shore ≈ 5 km east of the mouth
  const h = inst(range(MESH.harbour)[0]).O, rocks = range(MESH.rock).map((i) => inst(i).O);
  assert.ok(rocks.length > 1000);
  for (const r of rocks) assert.ok(Math.hypot(r[0] - 5165, r[2] - 1697) < 600, `a harbour rock ${r[0].toFixed(0)}, ${r[2].toFixed(0)}`);
  assert.ok(Math.abs(h[1]) < 1e-6 && Math.abs(h[0]) < 1e-6, 'the harbour mesh in world coordinates');
});

test('the night lines up: v1\'s pier-head lights stand on the shipped decks', () => {
  const L = decodeLights(new Uint8Array(readFileSync(resolve(ROOT, 'v2/assets/night/lights.bin'))));
  const decks = Array.from({ length: ALL.meshes[MESH.box].count }, (_, k) => { const i = ALL.meshes[MESH.box].first + k, m = ALL.mats.subarray(i * 12, i * 12 + 12); return { X: [m[0], m[1], m[2]], Y: [m[3], m[4], m[5]], Z: [m[6], m[7], m[8]], O: [m[9], m[10], m[11]] }; })
    .filter((d) => len(d.Y) < 3.5 && Math.min(len(d.X), len(d.Z)) > 0.2);   // a south start's decks: the shared file's and the south file's
  let heads = 0, on = 0;
  for (let k = 0; k < L.count; k++) {
    const x = L.data[k * 8], y = L.data[k * 8 + 1], z = L.data[k * 8 + 2], size = L.data[k * 8 + 6];
    if (Math.abs(y - 3.25) > 0.01 || Math.abs(size - 1.4) > 0.01) continue;   // v1's pier heads: 3.2 m up, 1.4 m
    heads++;
    const hit = decks.some((d) => {
      const dx = x - d.O[0], dz = z - d.O[2];
      const u = (dx * d.X[0] + dz * d.X[2]) / len(d.X), w = (dx * d.Z[0] + dz * d.Z[2]) / len(d.Z);
      return Math.abs(u) <= len(d.X) / 2 + 2 && Math.abs(w) <= len(d.Z) / 2 + 2;
    });
    if (hit) on++;
  }
  assert.ok(heads > 50, `${heads} pier-head lights`);
  assert.ok(on / heads > 0.97, `${on} of ${heads} pier-head lights on a deck`);
});

test('the marks: Hwy 89 in the fine window, the ski runs in the coarse one; the keep-out twin clears them', () => {
  const fine = M.rasters.find((r) => r.kind === RASTER.FINE), ski = M.rasters.find((r) => r.kind === RASTER.SKI);
  assert.ok(fine && ski && fine.cell === 2.5 && ski.cell === 25);
  // Hwy 89 on the bay's south wall (the farshore golden's line) and on its north wall
  let road = 0; for (let x = -1000; x <= 1200; x += 10) for (let z = 150; z <= 450; z += 2.5) if (maskAt(M, x, z).road > 0.5) { road++; break; }
  assert.ok(road > 30, `Hwy 89 found on ${road} of 221 columns of the south wall`);
  // Heavenly's runs, east across the lake (the bay mouth's view)
  let runs = 0; for (let x = 15500; x < 19000; x += 25) for (let z = 0; z < 4000; z += 25) if (maskAt(M, x, z).ski > KEEP.ski) runs++;
  assert.ok(runs > 1000, `${runs} run cells at Heavenly`);
  // the twin: on the asphalt or the cut, out; a crown whose edge reaches the road, out; far from both, in
  let probe = null; for (let x = -1000; x <= 1200 && !probe; x += 5) for (let z = 150; z <= 450; z += 1) if (maskAt(M, x, z).road > 0.9) { probe = [x, z]; break; }
  assert.ok(probe && keepOut(M, ...probe));
  assert.ok(keepOutR(M, probe[0], probe[1] + 6, 6) || keepOut(M, probe[0], probe[1] + 6), 'a 6 m crown 6 m off the road reaches it');
  assert.ok(!keepOut(M, 0, 0) && !keepOutR(M, -300, 900, 4), 'the island and the far woods stay');
});

test('the culling: the chunks hold every instance once; the bay\'s camera picks its piers, a far one none of the pilings', () => {
  const A = shoreArrays(S);
  A.chunks.forEach((list, mesh) => { let n = 0; for (const c of list) n += c.count; assert.equal(n, S.meshes[mesh].count); });
  const near = pickDraws(A, [2200, 2, 450], null, RANGE.desktop), far = pickDraws(A, [-30000, 2, -30000], null, RANGE.desktop);
  const count = (d, mesh) => d.filter((x) => x[0] === mesh).reduce((s, x) => s + x[2], 0);
  assert.ok(count(near, MESH.pile) > 200 && count(near, MESH.roof) >= 4, JSON.stringify(near.slice(0, 6)));
  assert.equal(count(far, MESH.pile), 0);
  assert.ok(near.length < 64, `${near.length} draws`);
});

// #41: the shore casts into the terrain's sun shadow map: the decks, the boathouses' roofs, the tower and the harbour; not
// the pilings or the breakwater's rocks (they would shadow themselves in the map's 2.4 m texel); the light's box picks
// the bay's boathouse with the caster's range table
test('the shore shadow caster: its meshes; the light box picks the bay without pilings', () => {
  assert.ok(SHADOW_MESHES.includes(MESH.box) && SHADOW_MESHES.includes(MESH.roof) && SHADOW_MESHES.includes(MESH.harbour));
  assert.ok(!SHADOW_MESHES.includes(MESH.pile) && !SHADOW_MESHES.includes(MESH.rock));
  const S = decodeShore(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/towns/shore.vsh.gz')))));
  const arr = shoreArrays(S), range = Object.fromEntries(SHADOW_MESHES.map((m) => [m, 1e9]));
  const draws = pickDraws(arr, [360, 0, -600], null, range);
  assert.ok(draws.length > 0 && draws.every(([m]) => SHADOW_MESHES.includes(m)), 'only the casting meshes');
  assert.ok(draws.some(([m]) => m === MESH.roof), 'the boathouses cast');
});

test('#41b: v1\'s materials ride the instances (roughness, metalness) and the tower\'s vertices', () => {
  const rough = (i) => matOf(S.tints[i * 4 + 3]);
  for (const i of range(MESH.roof)) assert.deepEqual(rough(i), { rough: 0.7, metal: 0 }, `roof ${i}`);
  for (const i of range(MESH.pile)) assert.deepEqual(rough(i), { rough: 0.85, metal: 0 }, `piling ${i}`);
  const boxes = range(MESH.box).map((i) => ({ i, ...inst(i), m: rough(i) }));
  const walls = boxes.filter((b) => Math.abs(len(b.Y) - 4.2) < 1e-3), decks = boxes.filter((b) => Math.abs(len(b.Y) - 0.3) < 1e-3);
  assert.equal(walls.length, S.meshes[MESH.roof].count);
  for (const w of walls) assert.deepEqual(w.m, { rough: 0.85, metal: 0 });
  for (const d of decks) assert.deepEqual(d.m, { rough: 0.9, metal: 0 });
  assert.ok(boxes.filter((b) => b.m.metal === 0.1 && b.m.rough === 0.75).length > 2500, 'the towns\' decks and breakwaters: v1\'s propMat (0.75, metalness 0.1)');
  assert.deepEqual(matOf(matByte(0.62, 0.1)), { rough: 0.62, metal: 0.1 });
  const t = S.meshes[MESH.tower], a = new Set(); for (let v = 0; v < t.verts; v++) a.add(t.col[4 * v + 3]);
  assert.deepEqual([...a].sort((x, y) => x - y), [0.6, 0.7, 0.8, 0.95, 1].map((r) => Math.round(255 * Math.fround(r))), 'the tower\'s five parts at v1\'s roughness');
  assert.equal(S.tints[S.meshes[MESH.tower].first * 4 + 3], 0, 'the tower instance defers to its vertices');
});

test('#41c: the mirror\'s proxies: every pier piece, the harbour\'s parts; the pier pose picks the boathouse; a ray hits its wall', () => {
  const all = mirrorProxies(S), n = all.length / 16;
  const parts = harbourParts(S.meshes[MESH.harbour], S.mats.subarray(S.meshes[MESH.harbour].first * 12));
  assert.equal(n, S.meshes[MESH.box].count + S.meshes[MESH.roof].count + S.meshes[MESH.pile].count + 2 + parts.length);
  assert.ok(parts.length > 100, `${parts.length} harbour parts`);
  for (const p of parts) assert.ok(Math.hypot(p.c[0] - 5180, p.c[2] - 1650) < 400 && p.h.every((h) => h > 0), 'a harbour part where v1 builds the harbour');
  const keys = new Float64Array(n), out = new Float32Array(4 + 16 * MIRROR.maxProxies), outU = new Uint32Array(out.buffer);
  const eye = [398, 3, -622], m = pickMirror(all, eye, keys, out, outU);
  assert.ok(m > 20 && m <= MIRROR.maxProxies && outU[0] === m, `${m} picked`);
  const P = (j) => out.subarray(4 + j * 16, 4 + (j + 1) * 16);
  const picked = Array.from({ length: m }, (_, j) => P(j));
  // the picked are the nearest: sorted by the distance from their edge
  const edge = (q) => Math.max(0, Math.hypot(q[0] - eye[0], q[2] - eye[2]) - q[7]);
  for (let j = 1; j < m; j++) assert.ok(edge(picked[j]) >= edge(picked[j - 1]) - 0.25);
  const wall = picked.find((q) => q[3] === 0 && Math.abs(q[5] - 2.1) < 1e-3 && Math.hypot(q[0] - 371.5, q[2] + 589.4) < 1);
  const roof = picked.find((q) => q[3] === 1 && Math.hypot(q[0] - 371.5, q[2] + 589.4) < 1);
  assert.ok(wall && roof, 'the boathouse\'s wall and roof picked');
  // the GPU's test (render/towns.js hitProxy) in JS: slabs in the proxy's frame, a gable's two slopes
  const hit = (q, o, d) => {
    const ux = [q[12], q[13]], uz = [-q[13], q[12]], r = [o[0] - q[0], o[1] - q[1], o[2] - q[2]];
    const lo = [r[0] * ux[0] + r[2] * ux[1], r[1], r[0] * uz[0] + r[2] * uz[1]], ld = [d[0] * ux[0] + d[2] * ux[1], d[1], d[0] * uz[0] + d[2] * uz[1]];
    const bLo = [-q[4], q[3] ? 0 : -q[5], -q[6]], bHi = [q[4], q[5], q[6]];
    let t0 = -Infinity, t1 = Infinity;
    for (let k = 0; k < 3; k++) { const a = (bLo[k] - lo[k]) / ld[k], b = (bHi[k] - lo[k]) / ld[k]; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
    if (q[3]) for (const sd of [-1, 1]) { const pn = [sd * q[5] / q[4], 1, 0], den = pn[0] * ld[0] + ld[1], num = q[5] - (pn[0] * lo[0] + lo[1]); if (den > 0) t1 = Math.min(t1, num / den); else t0 = Math.max(t0, num / den); }
    return t1 > t0 && t0 > 0 ? t0 : null;
  };
  const C = [eye[0], -eye[1], eye[2]], dx = 371.5 - eye[0], dz = -589.4 - eye[2], D = Math.hypot(dx, dz);
  const ray = (eDeg) => { const e = eDeg * Math.PI / 180; return [Math.cos(e) * dx / D, Math.sin(e), Math.cos(e) * dz / D]; };
  const eWall = Math.atan2(3 + 3.4, D - 3.5) * 180 / Math.PI;   // the wall's middle (1.25–5.45 m) on its near face
  const tw = hit(wall, C, ray(eWall));
  assert.ok(tw && C[1] + ray(eWall)[1] * tw > 1.2 && C[1] + ray(eWall)[1] * tw < 5.5, `a ray at ${eWall.toFixed(1)}° meets the wall (t ${tw?.toFixed(1)})`);
  const eOver = Math.atan2(3 + 8.2, D - 6) * 180 / Math.PI;
  assert.equal(picked.some((q) => hit(q, C, ray(eOver)) != null && hit(q, C, ray(eOver)) < 80), false, `a ray over the apex (${eOver.toFixed(1)}°) meets nothing near`);
  // a second pick from the same eye writes the same record
  const again = new Float32Array(out.length); pickMirror(all, eye, keys, again, new Uint32Array(again.buffer));
  assert.deepEqual(Array.from(again.subarray(0, 4 + 16 * m)), Array.from(out.subarray(0, 4 + 16 * m)));
});

//, 2026-11-17: "drop ski runs and the far towns' detail" on a phone): the phone's set
test('the phone\'s set: the pack\'s output, the bay\'s instances only (every one of them), Hwy 89 kept and no ski runs', async () => {
  const p = await packedP;
  for (const f of ['shore-phone.vsh.gz', 'mask-phone.vtm.gz']) { const d = townsDiff(f, gunzipSync(p.files[f]), file(f)); assert.equal(d, null, `${f}: ${d}: re-run node tools/v2-towns-pack.mjs`); }
  assert.deepEqual({ ...BAY }, { ...SHORE_REGION }, 'the bay is v1\'s shoreline region');
  const SP = decodeShore(file('shore-phone.vsh.gz')), MP = decodeMask(file('mask-phone.vtm.gz'));
  let inFull = 0;
  for (let i = 0; i < S.instances; i++) if (inBay(S.mats[i * 12 + 9], S.mats[i * 12 + 11])) inFull++;
  assert.equal(SP.instances, inFull, 'every bay instance kept');
  for (let i = 0; i < SP.instances; i++) assert.ok(inBay(SP.mats[i * 12 + 9], SP.mats[i * 12 + 11]), `instance ${i} in the bay`);
  for (const m of [MESH.pile, MESH.roof, MESH.tower, MESH.harbour, MESH.rock]) assert.equal(SP.meshes[m].count, S.meshes[m].count, `mesh ${m}: the bay's piers, boathouses, tower and harbour whole`);
  assert.ok(SP.meshes[MESH.box].count < S.meshes[MESH.box].count / 20, 'the far towns\' decks gone');
  assert.deepEqual(MP.rasters.map((r) => r.kind), [RASTER.FINE], 'Hwy 89\'s window, no ski raster');
  const hwy = M.rasters.findIndex((r) => r.kind === RASTER.FINE), ski = M.rasters.findIndex((r) => r.kind === RASTER.SKI);
  let road = 0, skiAt = null;
  const R = M.rasters[ski];
  for (let j = 0; j < R.h && !skiAt; j += 7) for (let i = 0; i < R.w && !skiAt; i += 7) { const x = R.x0 + (i + 0.5) * R.cell, z = R.z0 + (j + 0.5) * R.cell; if (sampleRaster(M, ski, x, z, 0) > 0.8) skiAt = [x, z]; }
  assert.ok(skiAt, 'a ski run in the full mask');
  assert.equal(maskAt(MP, ...skiAt).ski, 0, 'no ski run on a phone');
  const F = M.rasters[hwy];
  for (let j = 0; j < F.h; j += 9) for (let i = 0; i < F.w; i += 9) { const x = F.x0 + (i + 0.5) * F.cell, z = F.z0 + (j + 0.5) * F.cell; const a = maskAt(M, x, z).road; if (a > 0.5) { road++; assert.equal(maskAt(MP, x, z).road, a, 'Hwy 89 the same'); } }
  assert.ok(road > 20, `${road} road samples`);
  // the filters are exact: keep-all gives the file back byte for byte
  assert.equal(Buffer.compare(filterShore(file('shore.vsh.gz'), () => true), file('shore.vsh.gz')), 0);
  assert.equal(Buffer.compare(filterMask(file('mask.vtm.gz'), [RASTER.FINE, RASTER.SKI]), file('mask.vtm.gz')), 0);
});
