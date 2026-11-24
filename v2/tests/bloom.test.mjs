// The post chain's pure parts (render/bloom.js): the mip sizes, the composite's gain, the soft knee, the dither's pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOOM, bloomLevels, bloomGain, kneeWeight, ditherAt, BLOOM_WGSL } from '../render/bloom.js';
import { TONEMAP, TONEMAP_MODES } from '../render/shaders.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

test('bloomLevels: half size first, halved each level, at most 6, the smaller side ≥ 8 px', () => {
  assert.deepEqual(bloomLevels(1280, 720), [[640, 360], [320, 180], [160, 90], [80, 45], [40, 23], [20, 12]]);
  assert.equal(bloomLevels(2560, 1600).length, 6);
  const small = bloomLevels(200, 100); assert.ok(small.every(([w, h], i) => i === 0 || Math.min(w, h) >= 8)); assert.ok(small.length < 6);
  assert.deepEqual(bloomLevels(1, 1), [[1, 1]]);
});

test('bloomGain: the strength over the up chain\'s weights (1 + s + s² …); 0 with no levels', () => {
  const s = BLOOM.scatter, sum = [0, 1, 2, 3, 4, 5].reduce((a, i) => a + s ** i, 0);
  assert.ok(Math.abs(bloomGain(6) - BLOOM.strength / sum) < 1e-12);
  assert.equal(bloomGain(0), 0);
  assert.ok(Math.abs(bloomGain(1, s, 0.5) - 0.5) < 1e-12);
});

test('kneeWeight: nothing below threshold − knee, a smooth ramp, then (br − t) / br', () => {
  const { threshold: t, knee: k } = BLOOM;
  assert.equal(kneeWeight(t - k - 0.01), 0);
  assert.ok(kneeWeight(t) > 0 && kneeWeight(t) < 0.5);
  assert.ok(Math.abs(kneeWeight(10 * t) - (10 * t - t) / (10 * t)) < 1e-9);
  let prev = 0; for (let br = 0; br < 5 * t; br += 0.01) { const w = kneeWeight(br) * br; assert.ok(w >= prev - 1e-9, `the glow never falls as the light rises (${br})`); prev = w; }
});

test('the dither: a fixed pattern, triangular in −1 … +1 level, mean ≈ 0', () => {
  assert.equal(ditherAt(17.5, 33.5), ditherAt(17.5, 33.5));
  let s = 0, n = 0, lo = 1, hi = -1;
  for (let y = 0.5; y < 64; y++) for (let x = 0.5; x < 64; x++) { const d = ditherAt(x, y); s += d; n++; lo = Math.min(lo, d); hi = Math.max(hi, d); }
  assert.ok(lo >= -1 && hi <= 1 && hi - lo > 1.5, `range ${lo}…${hi}`);
  assert.ok(Math.abs(s / n) < 0.05, `mean ${s / n}`);
});

test('the WGSL: the bloom and every composite variant pass the Safari lint', () => {
  assert.deepEqual(lintWgsl(BLOOM_WGSL, 'bloom'), []);
  for (const m of TONEMAP_MODES) for (const n of [1, 4]) assert.deepEqual(lintWgsl(TONEMAP(n, m), `tonemap-${m}@${n}`), []);
});
