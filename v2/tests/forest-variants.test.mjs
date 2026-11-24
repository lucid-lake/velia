// T1: three trees for each of the three main species, picked per tree (forest/trees.js pickVariant, mirrored
// by render/forest.js CARD_DRAW_WGSL treeOf), and the lidar's own crown widths drawn (the card's width clamp relaxed to
// SXZ_MAX). Read on the real data file (v2/forest/data/trees.vft), with the draw's own hash (treeSeed, exact in JS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodeForest, unpackBits, LAYERS } from '../forest/format.js';
import { SPECIES, SPECIES_LAYER, VARIANTS, VARIANT_SALT, pickVariant, treeSeed, hash01 } from '../forest/trees.js';
import { SHAPES, CROWN_K, SXZ_MAX } from '../render/forest.js';

const F = decodeForest(new Uint8Array(gunzipSync(readFileSync(new URL('../forest/data/trees.vft', import.meta.url)))));
const f32 = new Float32Array(F.inst.buffer);
const trees = [];
for (let i = 0; i < F.n; i++) { const b = unpackBits(F.inst[4 * i + 3]); trees.push({ x: f32[4 * i], z: f32[4 * i + 1], ...b }); }
const pick = (t) => pickVariant(t.layer, CROWN_K * t.r / Math.max(t.h, 0.1), hash01((treeSeed(t.x, t.z) ^ VARIANT_SALT) >>> 0));
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

test('the variants: a species\' trees share its data layer and its colours; the pick only ever gives one of its own', () => {
  for (const v of VARIANTS) {
    for (const l of v.trees) { assert.equal(SPECIES_LAYER[l], v.layer); assert.deepEqual(SHAPES[l].needle, SHAPES[v.layer].needle); }
    for (let k = 0; k < 2000; k++) assert.ok(v.trees.includes(pickVariant(v.layer, (k % 50) / 100, (k * 0.618) % 1)));
  }
  for (const l of [LAYERS.lodgepole, LAYERS.cedar, LAYERS.snag, LAYERS.shrub]) assert.equal(pickVariant(l, 0.3, 0.5), l);
});

test('deterministic per tree: the same position gives the same tree on every load; neighbours differ', () => {
  const a = trees.slice(0, 5000).map(pick), b = trees.slice(0, 5000).map(pick);
  assert.deepEqual(a, b);
  // the hash is the draw's: the quarter-metre lattice, rounded half to even (the data's positions sit on the half)
  assert.equal(treeSeed(1.125, -3.375), treeSeed(1.125, -3.375));
  assert.notEqual(treeSeed(1.125, -3.375), treeSeed(1.375, -3.375));
  assert.equal(treeSeed(0.125, 0), treeSeed(0, 0), 'x·4 = 0.5 rounds to 0 (half to even), as WGSL round() does');
  assert.equal(treeSeed(0.375, 0), treeSeed(0.5, 0), 'x·4 = 1.5 rounds to 2');
});

test('every stand mixes all three trees of a species; wide lidar crowns lean old, narrow ones young', () => {
  for (const v of VARIANTS) {
    const mine = trees.filter((t) => t.layer === v.layer && t.valid);
    const n = [0, 0, 0]; for (const t of mine) n[v.trees.indexOf(pick(t))]++;
    for (const k of [0, 1, 2]) assert.ok(n[k] / mine.length > 0.12, `${SPECIES[v.layer].id}: tree ${k} is ${(100 * n[k] / mine.length).toFixed(1)} % (${n.join('/')})`);
    const wide = mine.filter((t) => CROWN_K * t.r / t.h >= v.q1), narrow = mine.filter((t) => CROWN_K * t.r / t.h <= v.q0);
    const old = (s) => s.filter((t) => pick(t) === v.trees[2]).length / Math.max(1, s.length);
    assert.ok(old(wide) > 0.6 && old(narrow) < 0.05, `${SPECIES[v.layer].id}: old among wide ${old(wide).toFixed(2)}, among narrow ${old(narrow).toFixed(2)}`);
  }
});

test('the lidar\'s crown widths show: the drawn crown (rho × the card\'s scale) follows 1.35 r within the new limit', () => {
  // (the lodgepole is left out: its slender tree meets the 2.2 clamp for most lidar crowns, wider than before but held)
  for (const id of ['pine', 'whitefir', 'redfir', 'cedar']) {
    const L = LAYERS[id], mine = trees.filter((t) => t.layer === L && t.valid && t.h >= 3);
    const want = [], got = [], old = []; let clamped = 0;
    for (const t of mine) {
      const S = SHAPES[pick(t)], raw = CROWN_K * t.r / S.rho, s = Math.min(SXZ_MAX * t.h, Math.max(0.45 * t.h, raw));
      if (s !== raw) clamped++;
      want.push(CROWN_K * t.r / t.h); got.push(S.rho * s / t.h);
      old.push(SHAPES[L].rho * Math.min(1.6 * t.h, Math.max(0.45 * t.h, CROWN_K * t.r / SHAPES[L].rho)) / t.h);   // one tree, the 1.6 clamp
    }
    [want, got, old].forEach((a) => a.sort((x, y) => x - y));
    assert.ok(clamped / mine.length < 0.05, `${id}: ${(100 * clamped / mine.length).toFixed(1)} % of crowns clamped`);
    for (const p of [0.1, 0.5, 0.9]) assert.ok(Math.abs(q(got, p) - q(want, p)) < 0.01, `${id}: crown/h at p${p * 100} ${q(got, p).toFixed(3)} vs the lidar's ${q(want, p).toFixed(3)}`);
    if (id !== 'cedar') assert.ok(q(got, 0.9) - q(got, 0.5) >= q(old, 0.9) - q(old, 0.5) - 1e-6, `${id}: the width spread is no narrower than with one tree and the 1.6 clamp`);
  }
});
