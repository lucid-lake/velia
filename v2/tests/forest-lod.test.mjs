// The forest's LOD and culling (M5b, v2/forest/lod.js): the cull's keep rule (all near, the share (thin / d)² past thin
// with widening capped, nothing past far, shrubs to their range) and the terrain's floor ↔ canopy weight that follows it;
// the per-frame tile pick from v1's camera poses over the real data and the real terrain bounds: no tile twice, every
// pick in range and in the frustum, the buffer offsets right, shrubs only near, and complete (every crown in view and
// in range has its tile picked); its CPU cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bestOf } from '../../tests/helpers/bestOf.mjs';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { FOREST, REGION, SOURCE, keepAt, coverNear, createTilePicker, inBox } from '../forest/lod.js';
import { decodeForest } from '../forest/format.js';
import { CAP } from '../render/forest.js';
import { TREE, createBounds, frustumPlanes, boxInFrustum } from '../terrain/quadtree.js';
import { cellBounds } from '../terrain/decode.js';
import { mat4, perspectiveReversed, lookDir, multiply } from '../engine/math.js';
import { cameraPose } from '../engine/camera.js';
import { ground } from './helpers/ground.mjs';   // v2's own grids (v2/terrain/decode.js), one per slot

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = (f) => decodeForest(gunzipSync(readFileSync(resolve(ROOT, 'v2/forest/data', f))));
const T = data('trees.vft'), S = data('shrubs.vft');
const full = JSON.parse(readFileSync(resolve(ROOT, 'terrain', 'tahoe.json'), 'utf8'));
const boundsP = ground('full').then((D) => { const B = createBounds(); for (const L of D.levels) B.merge(cellBounds(L.H, L, full.height, { ox: TREE.origin, oz: TREE.origin, cell: TREE.cell })); return B; });
function viewOf(flags, aspect = 16 / 9) {
  const p = cameraPose(flags), v = mat4(), pr = mat4(), vp = mat4();
  lookDir(v, p.eye, p.fwd); perspectiveReversed(pr, p.fovDeg * Math.PI / 180, aspect, p.near, p.far); multiply(vp, pr, v);
  return { eye: p.eye, planes: frustumPlanes(vp) };
}
const groundOf = (B) => (x0, z0, x1, z1, out) => {
  let lo = Infinity, hi = -Infinity; const a = B.pyramid[0], n = TREE.cells;
  for (let j = Math.floor((z0 - TREE.origin) / TREE.cell); j <= Math.floor((z1 - 1e-3 - TREE.origin) / TREE.cell); j++)
    for (let i = Math.floor((x0 - TREE.origin) / TREE.cell); i <= Math.floor((x1 - 1e-3 - TREE.origin) / TREE.cell); i++) { const k = 2 * (j * n + i); lo = Math.min(lo, a[k]); hi = Math.max(hi, a[k + 1]); }
  out[0] = lo; out[1] = hi; return out;
};
const OFF = { shrubs: CAP.trees, region: CAP.trees + CAP.shrubs };
const CAMS = [{ cam: 'A' }, { cam: 'B' }, { cam: 'I' }, { cam: 'O' }, { cam: 'M' }, { campos: '1185,4,-1035', camlook: '900,40,-1150' }];

test('the keep rule: all inside thin, (thin / d)² past it, widening ≤ wmax, a fade to nothing at far; shrubs to their range', () => {
  for (const L of [FOREST.desktop, FOREST.phone]) {
    assert.equal(keepAt(10, 0.999, L), 1); assert.equal(keepAt(L.thin * 0.99, 0.999, L), 1);
    assert.equal(keepAt(L.far, 0, L), 0); assert.equal(keepAt(L.far + 1, 0, L), 0);
    for (const d of [L.thin * 1.5, L.thin * 2, (L.fade + L.far) / 2]) {
      let kept = 0, wmax = 0; const n = 20000;
      for (let i = 0; i < n; i++) { const w = keepAt(d, (i + 0.5) / n, L); if (w) { kept++; wmax = Math.max(wmax, w); } }
      let expect = Math.min(1, (L.thin / d) ** 2); if (d > L.fade) expect *= 1 - (d - L.fade) / (L.far - L.fade);
      assert.ok(Math.abs(kept / n - expect) < 0.002, `d ${d}: kept ${kept / n} vs ${expect}`);
      assert.ok(wmax >= 1 && wmax <= L.wmax + 1e-9);
    }
    // the floor ↔ canopy weight: 1 near, falling, 0 at far, continuous
    assert.equal(coverNear(0, L), 1); assert.equal(coverNear(L.far, L), 0);
    let prev = 1; for (let d = 0; d < L.far; d += 25) { const c = coverNear(d, L); assert.ok(c <= prev + 1e-12 && Math.abs(c - prev) < 0.03, `${d}: ${c} after ${prev}`); prev = c; }
  }
  const L = FOREST.desktop;
  assert.equal(keepAt(100, 0.5, L, true), 1); assert.equal(keepAt(L.shrubFar, 0, L, true), 0); assert.equal(keepAt(10, 0.9, FOREST.phone, true), 0, 'no shrubs on a phone');
});

test('the tile pick from v1\'s cameras: no tile twice, in range and in the frustum, the offsets right, shrubs only near', async () => {
  const B = await boundsP, L = FOREST.desktop, ground = groundOf(B);
  const P = createTilePicker({ L, ground, boxInFrustum, offsets: OFF });
  P.src.trees = T; P.src.shrubs = S; P.src.region = true;
  for (const flags of CAMS) {
    const { eye, planes } = viewOf(flags);
    const n = P.pick(eye, planes), seen = new Set();
    assert.ok(n > 0 && P.overflow === 0, `${JSON.stringify(flags)}: ${n} tiles`);
    const per = REGION.n * REGION.n;
    for (let i = 0; i < n; i++) {
      const first = P.out[4 * i], cnt = P.out[4 * i + 1], src = P.out[4 * i + 2];
      const key = `${src}:${first}`; assert.ok(!seen.has(key), `tile ${key} twice`); seen.add(key);
      let x0, z0, size;
      if (src === SOURCE.region) {
        const t = (first - OFF.region) / per; assert.ok(Number.isInteger(t) && cnt === per);
        x0 = REGION.x0 + (t % REGION.tw) * REGION.tile; z0 = REGION.z0 + Math.floor(t / REGION.tw) * REGION.tile; size = REGION.tile;
        assert.ok(!inBox(x0 + 1, z0 + 1), 'a region tile inside the lidar box');
      } else {
        const D = src === SOURCE.trees ? T : S, base = src === SOURCE.trees ? 0 : OFF.shrubs;
        let k = D.start.indexOf(first - base); while (k >= 0 && k < D.tw * D.th && D.start[k + 1] === D.start[k]) k++;   // empty tiles share the next one's start
        assert.ok(k >= 0 && D.start[k] === first - base && D.start[k + 1] - D.start[k] === cnt, 'a lidar tile\'s range');
        x0 = D.x0 + (k % D.tw) * D.tile; z0 = D.z0 + Math.floor(k / D.tw) * D.tile; size = D.tile;
      }
      const dx = Math.max(x0 - eye[0], 0, eye[0] - x0 - size), dz = Math.max(z0 - eye[2], 0, eye[2] - z0 - size), d = Math.hypot(dx, dz);
      assert.ok(d <= (src === SOURCE.shrubs ? L.shrubFar : L.far), `${src} tile at ${d.toFixed(0)} m`);
      const g = ground(x0, z0, x0 + size, z0 + size, [0, 0]);
      assert.ok(boxInFrustum(planes, x0, g[0] - 1, z0, x0 + size, g[1] + 60, z0 + size), 'a tile outside the frustum');
    }
  }
});

test('the tile pick is complete: every crown in range and in view has its tile picked (brute force, cams A, B, I and the Sail start)', async () => {
  const B = await boundsP, L = FOREST.desktop, ground = groundOf(B);
  const P = createTilePicker({ L, ground, boxInFrustum, offsets: OFF });
  P.src.trees = T; P.src.shrubs = S;
  const fl = new Float32Array(T.inst.buffer);
  for (const flags of [CAMS[0], CAMS[1], CAMS[2], CAMS[5]]) {
    const { eye, planes } = viewOf(flags);
    const n = P.pick(eye, planes), picked = new Set();
    for (let i = 0; i < n; i++) if (P.out[4 * i + 2] === SOURCE.trees) picked.add(P.out[4 * i]);
    let inView = 0, missed = 0;
    for (let k = 0; k < T.tw * T.th; k++) for (let q = T.start[k]; q < T.start[k + 1]; q++) {
      const x = fl[4 * q], z = fl[4 * q + 1];
      if (Math.hypot(x - eye[0], z - eye[2]) > L.far - 100) continue;
      const g = ground(x, z, x + 0.01, z + 0.01, [0, 0]);
      if (!boxInFrustum(planes, x, g[0], z, x + 0.01, g[1] + 20, z + 0.01)) continue;
      inView++; if (!picked.has(T.start[k])) missed++;
    }
    assert.ok(inView > 1000, `${JSON.stringify(flags)}: ${inView} crowns in view`);
    assert.equal(missed, 0, `${JSON.stringify(flags)}: ${missed} of ${inView} crowns in view in an unpicked tile`);
  }
});

test('the pick\'s CPU cost: ≤ 0.5 ms a frame on the desktop set (the stats show ≈ 4.6 k box tests)', async () => {
  const B = await boundsP, L = FOREST.desktop;
  const P = createTilePicker({ L, ground: groundOf(B), boxInFrustum, offsets: OFF });
  P.src.trees = T; P.src.shrubs = S; P.src.region = true;
  const { eye, planes } = viewOf(CAMS[5]);
  for (let i = 0; i < 50; i++) P.pick(eye, planes);   // warm
  // the fastest of 40 short batches (8 picks, ≈ 2 ms): the pick's own cost, not other processes' (a loaded machine made
  // one 200-pick run read 2.9 ms; the best of 9 batches of 40 still read 0.547 ms at load 43 on 18 cores: v2 #29)
  const ms = bestOf(() => P.pick(eye, planes), { batches: 40, per: 8 });
  assert.ok(ms < 0.5, `${ms.toFixed(3)} ms a pick (${P.tested} boxes)`);
});
