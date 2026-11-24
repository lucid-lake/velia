// The terrain's LOD (v2/terrain/quadtree.js, CDLOD): real selections from v1's camera poses over the real grids' bounds.
// The quadrants tile the visible ground with no overlap and no hole; the level grows with the distance; neighbours differ
// by at most one level; and the seam invariant holds on every shared edge (the fine side fully morphed, the coarse side
// not at all), so no crack can open. The bounds pyramid and the frustum test are checked on their own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TREE, PATCH, nodeSize, cellOf, rangeOf, createBounds, createSelector, frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { cellBounds } from '../terrain/decode.js';
import { mat4, perspectiveReversed, lookDir, multiply } from '../engine/math.js';
import { cameraPose } from '../engine/camera.js';
import { ground } from './helpers/ground.mjs';   // v2's own grids (v2/terrain/decode.js), one per slot

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const full = JSON.parse(readFileSync(resolve(ROOT, 'terrain', 'tahoe.json'), 'utf8'));
const boundsP = ground('full').then((D) => {
  const B = createBounds();
  for (const L of D.levels) B.merge(cellBounds(L.H, L, full.height, { ox: TREE.origin, oz: TREE.origin, cell: TREE.cell }));
  return B;
});
function viewOf(flags, aspect = 16 / 9) {
  const p = cameraPose(flags), v = mat4(), pr = mat4(), vp = mat4();
  lookDir(v, p.eye, p.fwd); perspectiveReversed(pr, p.fovDeg * Math.PI / 180, aspect, p.near, p.far); multiply(vp, pr, v);
  return { eye: p.eye, vp, planes: frustumPlanes(vp) };
}
const quads = (sel) => Array.from({ length: sel.count }, (_, i) => { const o = i * 4, l = sel.inst[o + 2], s = nodeSize(l) / 2; return { x0: sel.inst[o], z0: sel.inst[o + 1], l, s, cell: sel.inst[o + 3] }; });

test('constants: a quadrant is 32 × 32 cells; a level-l cell is 2 · 2^l m; the root covers the ring (±49.1 km)', () => {
  assert.equal(PATCH, 32); assert.equal(cellOf(0), 2); assert.equal(cellOf(5), 64);
  assert.equal(nodeSize(TREE.levels - 1), TREE.size); assert.ok(-TREE.origin >= 49104 && TREE.origin + TREE.size >= 49104);
  assert.equal(rangeOf(3), TREE.range0 * 8);
  // the morph margin the seam invariant needs (quadtree.js header): morph · R_(l+1) ≥ R_l + √2 · S_l
  for (let l = 0; l < TREE.levels - 1; l++) assert.ok(TREE.morph * rangeOf(l + 1) >= rangeOf(l) + Math.SQRT2 * nodeSize(l) - 1e-9, `level ${l}`);
});

test('frustum: boxes in front pass, behind and beside fail', () => {
  const { planes } = viewOf({ campos: '0,10,0', camlook: '0,10,-100', camfov: '50' });
  assert.ok(boxInFrustum(planes, -10, 0, -200, 10, 20, -150));
  assert.ok(!boxInFrustum(planes, -10, 0, 150, 10, 20, 200), 'behind');
  assert.ok(!boxInFrustum(planes, 5000, 0, -200, 5100, 20, -150), 'far to the side');
});

test('the bounds pyramid: a parent holds its children; past the ring is empty', async () => {
  const B = await boundsP, a = new Float64Array(2), b = new Float64Array(2);
  for (const [l, ix, iz] of [[5, 255, 255], [3, 1020, 1023], [8, 15, 16]]) {
    B.node(l, ix, iz, a);
    for (let k = 0; k < 4; k++) { B.node(l - 1, 2 * ix + (k & 1), 2 * iz + (k >> 1), b); if (b[0] <= b[1]) { assert.ok(a[0] <= b[0] && a[1] >= b[1], `l${l}`); } }
  }
  B.node(0, 0, 0, a); assert.ok(!(a[0] <= a[1]), 'the far corner (−65 km) holds no data');
  B.node(TREE.levels - 1, 0, 0, a); assert.ok(a[0] < -400 && a[1] > 1000, `the root spans the lake bed to the peaks: ${a[0]}…${a[1]}`);
});

for (const cam of ['A', 'B', 'I', 'O', 'L']) {
  test(`selection from cam ${cam}: no overlap, no hole in view, levels by distance, restricted, seams invariant`, async () => {
    const B = await boundsP, sel = createSelector(B), view = viewOf({ cam });
    const n = sel.select(view.eye, view.planes);
    assert.ok(n > 20 && n < TREE.maxInstances && sel.overflow === 0, `${n} quadrants, overflow ${sel.overflow}`);
    const Q = quads(sel);
    // rasterise every quadrant onto a 16 m lattice (offset 8 m: never on a quadrant's edge) within 6 km: no point twice
    const seen = new Map();
    for (const q of Q) {
      if (q.x0 > view.eye[0] + 6000 || q.x0 + q.s < view.eye[0] - 6000 || q.z0 > view.eye[2] + 6000 || q.z0 + q.s < view.eye[2] - 6000) continue;
      for (let z = Math.ceil((q.z0 - 8) / 16) * 16 + 8; z < q.z0 + q.s; z += 16) for (let x = Math.ceil((q.x0 - 8) / 16) * 16 + 8; x < q.x0 + q.s; x += 16) {
        if (Math.abs(x - view.eye[0]) > 6000 || Math.abs(z - view.eye[2]) > 6000) continue;
        const k = `${x},${z}`; assert.ok(!seen.has(k), `(${x}, ${z}) drawn twice`); seen.set(k, q);
      }
    }
    // in view and on land or shallow bed: covered (sampled on rays through the screen centre band)
    const f = cameraPose({ cam }).fwd, yaw = Math.atan2(f[0], -f[2]);
    let covered = 0, asked = 0;
    for (const da of [-0.3, -0.15, 0, 0.15, 0.3]) for (const r of [60, 200, 600, 1500, 4000]) {
      const x = Math.round((view.eye[0] + Math.sin(yaw + da) * r) / 16) * 16 + 8, z = Math.round((view.eye[2] - Math.cos(yaw + da) * r) / 16) * 16 + 8;
      const c = new Float64Array(2); B.node(0, Math.floor((x - TREE.origin) / 128), Math.floor((z - TREE.origin) / 128), c);
      if (!(c[0] <= c[1]) || c[1] < TREE.floorCut) continue;   // no data, or under the opaque deep water
      if (!boxInFrustum(view.planes, x - 1, c[0], z - 1, x + 1, c[1], z + 1)) continue;
      asked++; if (seen.has(`${x},${z}`)) covered++;
    }
    assert.equal(covered, asked, `${covered} of ${asked} points in view covered`);
    // level by distance: a quadrant at level l > 0 is past R_(l−1) (else it would have been refined)
    const d2 = (q) => { const dx = Math.max(q.x0 - view.eye[0], 0, view.eye[0] - q.x0 - q.s), dz = Math.max(q.z0 - view.eye[2], 0, view.eye[2] - q.z0 - q.s); return Math.hypot(dx, dz); };
    for (const q of Q) if (q.l > 0) assert.ok(d2(q) > rangeOf(q.l - 1) - 1e-6, `level ${q.l} quadrant at ${d2(q).toFixed(0)} m`);
    // neighbours: share an edge segment → levels differ by ≤ 1, and every point of the shared segment lies in
    // [R_lo, morph · R_hi] horizontally (the fine side's morph is complete, the coarse side's not begun)
    const near = Q.filter((q) => d2(q) < 30000);
    let pairs = 0;
    for (let i = 0; i < near.length; i++) for (let j = 0; j < near.length; j++) {
      const a = near[i], b = near[j]; if (a.l >= b.l || i === j) continue;
      const tx = Math.max(a.x0, b.x0), ux = Math.min(a.x0 + a.s, b.x0 + b.s), tz = Math.max(a.z0, b.z0), uz = Math.min(a.z0 + a.s, b.z0 + b.s);
      const touchX = (Math.abs(a.x0 + a.s - b.x0) < 1e-6 || Math.abs(b.x0 + b.s - a.x0) < 1e-6) && uz > tz;
      const touchZ = (Math.abs(a.z0 + a.s - b.z0) < 1e-6 || Math.abs(b.z0 + b.s - a.z0) < 1e-6) && ux > tx;
      if (!touchX && !touchZ) continue;
      pairs++;
      assert.ok(b.l - a.l <= 1, `levels ${a.l} and ${b.l} touch`);
      const ends = touchX ? [[tx === ux ? tx : (Math.abs(a.x0 + a.s - b.x0) < 1e-6 ? b.x0 : a.x0), tz], [touchX ? (Math.abs(a.x0 + a.s - b.x0) < 1e-6 ? b.x0 : a.x0) : 0, uz]] : [[tx, Math.abs(a.z0 + a.s - b.z0) < 1e-6 ? b.z0 : a.z0], [ux, Math.abs(a.z0 + a.s - b.z0) < 1e-6 ? b.z0 : a.z0]];
      for (let t = 0; t <= 8; t++) {
        const x = ends[0][0] + (ends[1][0] - ends[0][0]) * t / 8, z = ends[0][1] + (ends[1][1] - ends[0][1]) * t / 8, d = Math.hypot(x - view.eye[0], z - view.eye[2]);
        assert.ok(d >= rangeOf(a.l) - 1e-6, `seam at ${d.toFixed(1)} m: the level-${a.l} side not fully morphed (R ${rangeOf(a.l)})`);
        assert.ok(d <= TREE.morph * rangeOf(b.l) + 1e-6, `seam at ${d.toFixed(1)} m: the level-${b.l} side already morphing`);
      }
    }
    assert.ok(pairs > 10, `${pairs} level seams checked`);
  });
}

test('selection allocates nothing: the same arrays a frame, the same answer for the same view', async () => {
  const B = await boundsP, sel = createSelector(B), view = viewOf({ cam: 'A' });
  const inst = sel.inst; const n1 = sel.select(view.eye, view.planes); const a = inst.slice(0, n1 * 4);
  const n2 = sel.select(view.eye, view.planes);
  assert.equal(sel.inst, inst); assert.equal(n1, n2); assert.deepEqual(inst.slice(0, n2 * 4), a);
});
