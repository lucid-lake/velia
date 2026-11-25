// The boat's meshes (M3): the hull ported from v1's Blender shape keeps the Catalina 28's numbers (LOA, beam, the sheer,
// the waterline), is finite and consistently wound; the sail grids filled from v1's rig.js keep v1's sail areas; the
// lines and wires fill one ribbon buffer; the spars are v1's own arrays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { bestOf } from '../../tests/helpers/bestOf.mjs';
import { hullShape, hullParams } from '../render/boat/hullShape.js';
import { buildHull, buildRigParts, sailGrid, fillSail, mainPoint, jibPoint, sailParams, SAIL_GRIDS, lineSet, ribbonArrays, fillRibbons, wireLines } from '../render/boat/mesh.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import { area, stubState, LUFF_Z } from '../../src/boat/rig.js';

const { HULL } = DEFAULT_DIMS;

test('the hull shape: the script\'s lines in the game\'s numbers (LOA, beam, the sheer at the freeboard, the canoe body\'s depth)', () => {
  const S = hullShape(), P = hullParams();
  assert.ok(Math.abs((P.yStem - P.yTransom) - HULL.loa) < 1e-9, 'the stations span the LOA');
  assert.ok(Math.abs(S.halfBeamSheer(P.yMaxBeam) * 2 - HULL.beam) < 1e-9, 'the beam at its widest station');
  assert.ok(Math.abs(S.sheer(P.ySheerMin) - (HULL.freeboard - 0.02)) < 1e-9, 'the sheer\'s low point');
  assert.ok(S.sheer(P.yStem) > S.sheer(P.ySheerMin) && S.sheer(P.yTransom) > S.sheer(P.ySheerMin), 'the sheer rises to both ends');
  assert.ok(Math.abs(S.keel(0) + P.depth) < 0.04, 'the canoe body is P.depth deep amidships');
  assert.ok(Math.abs(S.keel(-HULL.lwl / 2)) < 1e-6, 'the run reaches the waterline at −LWL/2 (the waterline length)');
  assert.ok(S.keel(P.yStem) > 0.9, 'the stem head stands above the water');
  for (const y of S.stations()) {
    const sec = S.section(y, 18);
    assert.equal(sec.length, 18);
    for (let i = 1; i < sec.length; i++) assert.ok(sec[i][1] >= sec[i - 1][1] - 1e-9, `section ${y.toFixed(2)}: rows go up`);
    assert.ok(Math.abs(sec[sec.length - 1][1] - S.sheer(y)) < 1e-9, 'the last row is the sheer');
    if (S.sheer(y) - S.keel(y) > 1e-3) assert.ok(Math.abs(sec[sec.length - 1][0] - S.halfBeamSheer(y)) < 1e-9, 'the last row is at the sheer\'s half beam');   // (the stem head is a point)
    assert.ok(sec[0][0] <= 0.005, 'the first row is on the centreline');
  }
  // the deck: the cockpit sole and the trunk top in the frame's numbers
  assert.ok(Math.abs(S.deck(-2.0, 0.2) - P.sole) < 1e-9, 'the well\'s floor is the sole');
  assert.ok(S.deck(0.5, 0.0) > S.sheer(0.5) + P.trunkH - 1e-9, 'the trunk top stands trunkH over the sheer');
  assert.ok(S.deck(3.5, 0.0) < S.sheer(3.5) + 0.2, 'the foredeck is the cambered sheer');
});

test('buildHull: finite arrays, the bounding box of the Catalina 28, the deck at mastStepY under the mast, consistent winding', () => {
  const h = buildHull();
  assert.ok(h.triangles > 5000 && h.triangles < 40000, `${h.triangles} triangles`);
  assert.equal(h.position.length, h.normal.length); assert.equal(h.color.length, h.position.length); assert.equal(h.mr.length / 2, h.position.length / 3);
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, maxX = 0;
  for (let i = 0; i < h.position.length; i += 3) {
    const x = h.position[i], y = h.position[i + 1], z = h.position[i + 2];
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), 'finite');
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxX = Math.max(maxX, Math.abs(x));
  }
  assert.ok(Math.abs(minY + HULL.draft) < 1e-6, `the keel's tip at the draft: ${minY.toFixed(3)}`);
  assert.ok(Math.abs(maxX - HULL.beam / 2) < 0.01, `the half beam: ${maxX.toFixed(3)}`);
  assert.ok(maxZ - minZ > HULL.loa - 0.05 && maxZ - minZ < HULL.loa + 0.6, `the length over all with the raked transom: ${(maxZ - minZ).toFixed(3)}`);
  assert.ok(Math.abs(maxY - HULL.mastStepY) < 0.03, `the trunk top at the mast step: ${maxY.toFixed(3)} vs ${HULL.mastStepY}`);
  // winding: the hull's faces (the first part) point outward: a face's normal agrees with its vertex normals and with the
  // direction from the centreline (above the keel's underside)
  let agree = 0, n = 0;
  for (let t = 0; t < h.parts.hull + h.parts.deck; t++) {
    const a = h.index[3 * t], b = h.index[3 * t + 1], c = h.index[3 * t + 2];
    const P = (k) => [h.position[3 * k], h.position[3 * k + 1], h.position[3 * k + 2]];
    const pa = P(a), pb = P(b), pc = P(c);
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const fn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const vn = [h.normal[3 * a], h.normal[3 * a + 1], h.normal[3 * a + 2]];
    const d = fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2];
    if (Math.hypot(...fn) < 1e-9) continue;
    n++; if (d > 0) agree++;
  }
  assert.ok(agree / n > 0.97, `${agree}/${n} hull and deck faces wound with their normals`);
});

test('the spars are v1\'s arrays; the sail grids keep v1\'s areas (the published 15.5 and 18.4 m² within the geometry\'s 10 %)', () => {
  const r = buildRigParts();
  assert.ok(r.mast.triangles > 1000 && r.boom.triangles > 500 && r.wires.length >= 10, 'the mast, the boom, the wires');
  const st = stubState({ awaDeg: 45, awsMs: 6 }), sp = sailParams(st);
  for (const [name, [nu, nv], fn, s] of [['main', SAIL_GRIDS.main, mainPoint, sp.main], ['jib', SAIL_GRIDS.jib, jibPoint, sp.jib]]) {
    const g = sailGrid(nu, nv);
    const hoist = fillSail(g, fn, s);
    assert.ok(hoist > 8 && hoist < 11.5, `${name} hoist ${hoist.toFixed(2)} m`);
    // the grid's area against v1's integral of the same surface
    let A = 0;
    for (let t = 0; t < g.index.length; t += 3) {
      const P = (k) => [g.position[3 * k], g.position[3 * k + 1], g.position[3 * k + 2]];
      const a = P(g.index[t]), b = P(g.index[t + 1]), c = P(g.index[t + 2]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      A += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    }
    const ref = area(fn, s);
    assert.ok(Math.abs(A - ref) / ref < 0.02, `${name}: the grid's area ${A.toFixed(2)} vs rig.js ${ref.toFixed(2)}`);
    const published = name === 'main' ? DEFAULT_DIMS.SAIL_AREA.main : DEFAULT_DIMS.SAIL_AREA.jib;
    assert.ok(Math.abs(A - published) / published < 0.2, `${name}: ${A.toFixed(1)} m² vs the published ${published.toFixed(1)} (v1's geometry: the roach and the draft add to the triangle)`);
    for (let i = 0; i < g.normal.length; i += 3) assert.ok(Math.abs(Math.hypot(g.normal[i], g.normal[i + 1], g.normal[i + 2]) - 1) < 1e-3, 'unit normals');
  }
});

test('the line set and the wires fill one ribbon buffer; the sheets move with the trim', () => {
  const r = buildRigParts();
  const a = lineSet(stubState({ awaDeg: 45 })), b = lineSet(stubState({ awaDeg: 120, main: 0.9, jib: 0.9 }));
  assert.ok(a.length >= 10, `${a.length} lines`);
  assert.deepEqual(a.map((l) => l.name), b.map((l) => l.name), 'the same lines at any trim');
  const main = (set) => set.find((l) => l.name === 'mainsheet-0').points[0];
  assert.ok(Math.hypot(...main(a).map((v, i) => v - main(b)[i])) > 0.5, 'the main sheet\'s block follows the boom out');
  const R = ribbonArrays(1536);
  const n = fillRibbons(R, [...a, ...wireLines(r.wires)]);
  assert.ok(n > 0 && n === R.indices && R.points * 2 <= 1536 * 2, 'indices and points within the buffer');
  for (let i = 0; i < R.points * 6; i++) assert.ok(Number.isFinite(R.position[i]) && Number.isFinite(R.other[i]), 'finite ribbon');
  // the cost: the fastest of 15 batches of 10 frames after 10 warm ones (one cold 50-frame batch read over 2 ms at load
  // ≈ 44 with the code unchanged; the rest of this test is pure and order-free: v2 #29)
  const ms = bestOf((k) => { lineSet(stubState({ awaDeg: 45 + (k % 50) })); fillRibbons(R, [...a, ...wireLines(r.wires)]); }, { batches: 15, per: 10, warm: 10 });
  budget(ms, 2, 'a frame\'s lines');
});

// #43: v2's lazy jacks (its own line set) meet the main only at the mast (src/boat/rig.js insideMain): no crossing more
// than 0.08 m from the luff groove, both tacks, close-hauled to a run (they ran into the cloth 0.12–0.2 m aft before)
test('the lazy jacks meet the main only at the mast', () => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const hit = (p, q, a, b, c) => {
    const e1 = sub(b, a), e2 = sub(c, a), d = sub(q, p), h = cross(d, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-12) return false;
    const s = sub(p, a), u = dot(s, h) / det; if (u < 0 || u > 1) return false;
    const k = cross(s, e1), v = dot(d, k) / det; if (v < 0 || u + v > 1) return false;
    const t = dot(e2, k) / det; return t >= 0 && t <= 1;
  };
  const DEG = Math.PI / 180, NU = 48, NV = 64, bad = [];
  for (const sg of [1, -1]) for (const b of [4, 20, 40, 60, 72]) {
    const st = { boomAngle: sg * b * DEG, jibAngle: sg * 10 * DEG }, s = sailParams(st).main;
    const P = []; for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) P.push(mainPoint(i / NU, j / NV, s, null, [0, 0, 0]));
    for (const l of lineSet(st, 0).filter((x) => /lazyjack/.test(x.name))) for (let k = 1; k < l.points.length; k++) {
      const p = l.points[k - 1], q = l.points[k];
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const a = P[j * (NU + 1) + i], bb = P[j * (NU + 1) + i + 1], c = P[(j + 1) * (NU + 1) + i], d = P[(j + 1) * (NU + 1) + i + 1];
        for (const T of [[a, bb, d], [a, d, c]]) if (hit(p, q, ...T)) {
          const aft = Math.hypot((T[0][0] + T[1][0] + T[2][0]) / 3, (T[0][2] + T[1][2] + T[2][2]) / 3 - LUFF_Z);
          if (aft > 0.08) bad.push(`${l.name} ${aft.toFixed(2)} m aft (boom ${sg * b}°)`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
