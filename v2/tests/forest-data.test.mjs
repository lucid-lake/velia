// The forest's data (M5b): the shipped files are the pack tool's output byte for byte (v1's own lidar placement, packed
// by tools/v2-forest-pack.mjs); they decode to v1's crowns within the 0.25 m lattice and the height quantum; every crown
// stands on land by v1's heightAt (≥ 1 m above the lake: the guard, "trees never stand in the lake"); the phone set's
// coarser heights drop only a sliver (the GPU place pass drops those); the bytes stay inside the budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { decodeForest, encodeForest, unpackBits, BOX, LAYERS, QUANT, TILE } from '../forest/format.js';
import { packForest } from '../../tools/v2-forest-pack.mjs';
import { ground } from './helpers/ground.mjs';   // v2's own height field (v2/terrain/sample.js), every grid in
import { LIDAR_MIN_Y } from '../render/forest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = (f) => readFileSync(resolve(ROOT, 'v2/forest/data', f));
const decoded = (f) => decodeForest(gunzipSync(file(f)));
const packedP = packForest();

test('the shipped files are the pack tool\'s output, byte for byte (deterministic, from v1\'s placement)', async () => {
  const p = await packedP;
  assert.ok(Buffer.compare(p.files['trees.vft'], file('trees.vft')) === 0, 'trees.vft: re-run node tools/v2-forest-pack.mjs');
  assert.ok(Buffer.compare(p.files['shrubs.vft'], file('shrubs.vft')) === 0, 'shrubs.vft: re-run node tools/v2-forest-pack.mjs');
});

test('the files decode to v1\'s crowns: the same count, each within the lattice and the height quantum, in the box', async () => {
  const p = await packedP;
  for (const [f, recs, hq] of [['trees.vft', p.trees, 0.25], ['shrubs.vft', p.shrubs, 0.1]]) {
    const d = decoded(f), fl = new Float32Array(d.inst.buffer);
    assert.equal(d.n, recs.length, f);
    assert.equal(d.start[d.tw * d.th], d.n);
    // match each decoded record to its source by tile and nearest position (the encoder sorts within a tile)
    const byTile = new Map();
    for (const r of recs) { const k = Math.floor((r.z - BOX.z0) / TILE) * d.tw + Math.floor((r.x - BOX.x0) / TILE); (byTile.get(k) ?? byTile.set(k, []).get(k)).push(r); }
    let worstXZ = 0, worstH = 0;
    for (let k = 0; k < d.tw * d.th; k++) {
      const src = byTile.get(k) ?? [];
      assert.equal(d.start[k + 1] - d.start[k], src.length, `${f} tile ${k}`);
      // the heights as a set per tile (two crowns a lattice step apart may swap places in the nearest match)
      const hs = src.map((r) => r.h).sort((a, b) => a - b), hd = [];
      for (let q = d.start[k]; q < d.start[k + 1]; q++) hd.push(unpackBits(d.inst[4 * q + 3]).h);
      hd.sort((a, b) => a - b);
      hs.forEach((h, i) => { worstH = Math.max(worstH, Math.abs(h - hd[i])); });
      for (let q = d.start[k]; q < d.start[k + 1]; q++) {
        const x = fl[4 * q], z = fl[4 * q + 1], b = unpackBits(d.inst[4 * q + 3]);
        assert.ok(x >= BOX.x0 && x < BOX.x1 && z >= BOX.z0 && z < BOX.z1, `${f}: ${x}, ${z} outside the box`);
        let best = null, bd = Infinity;
        for (const r of src) { const dd = Math.hypot(r.x - x, r.z - z); if (dd < bd) { bd = dd; best = r; } }
        worstXZ = Math.max(worstXZ, bd);
        if (f === 'trees.vft' && bd < QUANT * 0.75) { assert.equal(b.layer, best.layer); assert.ok(Math.abs(b.r - best.r) <= 0.051, `radius ${b.r} vs ${best.r}`); }
        if (f === 'shrubs.vft') assert.equal(b.layer, LAYERS.shrub);
        assert.equal(b.valid, 1); assert.equal(b.shrub, f === 'shrubs.vft' ? 1 : 0);
      }
    }
    // the lattice's half diagonal (two crowns on one lattice point: the second moves one step, still ≤ 0.43 m)
    assert.ok(worstXZ <= QUANT * Math.SQRT1_2 + QUANT + 1e-3, `${f}: worst position error ${worstXZ.toFixed(3)} m`);
    assert.ok(worstH <= hq / 2 + 0.051, `${f}: worst height error ${worstH.toFixed(3)} m`);
  }
});

test('the guard: every packed crown stands on land by v1\'s heightAt (≥ 1 m above the lake); the phone heights drop < 0.5 %', async () => {
  const S = await ground('full'), P = await ground('phone');
  for (const f of ['trees.vft', 'shrubs.vft']) {
    const d = decoded(f), fl = new Float32Array(d.inst.buffer);
    let low = 0, phoneLow = 0, minY = Infinity;
    for (let q = 0; q < d.n; q++) {
      const y = S.height(fl[4 * q], fl[4 * q + 1]); minY = Math.min(minY, y);
      // the lattice moved a crown ≤ 0.43 m: v1's rule was ≥ 1 m at the source position; allow the shore's slope over that
      if (y < LIDAR_MIN_Y - 0.6) low++;
      if (P.height(fl[4 * q], fl[4 * q + 1]) < LIDAR_MIN_Y) phoneLow++;
    }
    assert.equal(low, 0, `${f}: ${low} crowns in the lake (min ${minY.toFixed(2)} m)`);
    assert.ok(phoneLow / d.n < 0.005, `${f}: ${phoneLow} of ${d.n} under the phone set's shore`);
  }
});

test('bytes: trees ≤ 0.4 MB, shrubs ≤ 1.1 MB, both ≤ 6 MB (v1: 5.65 MB at 8 B a crown)', () => {
  const t = file('trees.vft').length, s = file('shrubs.vft').length;
  assert.ok(t <= 400e3, `trees ${t}`); assert.ok(s <= 1.1e6, `shrubs ${s}`); assert.ok(t + s <= 6e6);
  const d = decoded('trees.vft');
  assert.ok(t / d.n < 3.5, `${(t / d.n).toFixed(2)} B a tree`);
});

test('the format round-trips a synthetic set (edges of the box, two crowns on one lattice point, every layer)', () => {
  const recs = [{ x: BOX.x0, z: BOX.z0, h: 3.5, r: 0.6, layer: 0 }, { x: BOX.x1 - 0.01, z: BOX.z1 - 0.01, h: 59, r: 9.9, layer: 5 }, { x: 10.1, z: -5.1, h: 20, r: 3, layer: 2 }, { x: 10.12, z: -5.09, h: 21, r: 3.1, layer: 3 }];
  for (let l = 0; l < 6; l++) recs.push({ x: 100 + 7 * l, z: 200 - 3 * l, h: 10 + l, r: 2, layer: l });
  const d = decodeForest(encodeForest(recs, { kind: 0 })), fl = new Float32Array(d.inst.buffer);
  assert.equal(d.n, recs.length);
  for (const r of recs) {
    let best = Infinity, bq = -1;
    for (let q = 0; q < d.n; q++) { const dd = Math.hypot(fl[4 * q] - r.x, fl[4 * q + 1] - r.z); if (dd < best) { best = dd; bq = q; } }
    assert.ok(best < 0.45, `${r.x}, ${r.z}: ${best}`);
    void bq;
  }
  const hs = recs.map((r) => r.h).sort((a, b) => a - b), hd = Array.from({ length: d.n }, (_, q) => unpackBits(d.inst[4 * q + 3]).h).sort((a, b) => a - b);
  hs.forEach((h, i) => assert.ok(Math.abs(h - hd[i]) <= 0.13, `height ${h} vs ${hd[i]}`));
  assert.throws(() => decodeForest(new Uint8Array(40)), /magic/);
});
