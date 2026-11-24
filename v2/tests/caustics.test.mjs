// Ultra M2: the sun's caustics on the bed (v2/render/caustics.js, Ultra-Water's area-ratio splat of the 12 m and 2.1 m
// cascades). The bed's strength is zero at night at every depth, softer at a low sun, eased in from the waterline and
// out with depth; the slice blends sum to 1; the sun disc blurs deeper light more; the splat's landing offsets stay
// inside each slice's margin for the lake's slopes; and the method conserves the light: a refracted wave train's
// landed area ratios average to flat water's (the mean the bed multiplies by is 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAUSTICS, CAUSTIC_LOOK, causticStrength, fineWeight, sliceWeights, discLod, landing, spanOf, CAUSTIC_WGSL, SPLAT_WGSL, CMIP_WGSL } from '../render/caustics.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

const sunAt = (elevDeg, azDeg = 200) => { const e = elevDeg * Math.PI / 180, a = azDeg * Math.PI / 180; return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)]; };

test('caustics are zero at night: no strength at any depth with the sun at or below the horizon', () => {
  for (const sunY of [0, -0.01, -0.3, -1]) for (const d of [0.2, 1, 2, 4, 8, 15, 30]) assert.equal(causticStrength(d, sunY), 0, `sun ${sunY}, ${d} m`);
  assert.equal(causticStrength(3, 0.01), 0, 'none below 1° (the sun\'s 0.02)');
});

test('softer at dusk: the strength rises with the sun\'s height to full by 24°', () => {
  const at = (deg) => causticStrength(3, Math.sin(deg * Math.PI / 180));
  assert.ok(at(3) < at(6) && at(6) < at(12) && at(12) < at(20), 'monotone in the sun\'s height');
  assert.ok(at(6) < 0.25 * at(60), `golden hour (6°) under a quarter of noon: ${at(6).toFixed(3)}`);
  assert.equal(at(30), at(70), 'full from 24°');
});

test('the depth fade: none at the waterline, full from 1.5 m to 10 m, gone by 22 m; the ripples\' net gone by 9 m', () => {
  const noon = Math.sin(68 * Math.PI / 180);
  assert.equal(causticStrength(0, noon), 0);
  let prev = 0;
  for (let d = 0; d <= 1.5; d += 0.1) { const k = causticStrength(d, noon); assert.ok(k >= prev - 1e-12, `rising at ${d.toFixed(1)} m`); prev = k; }
  for (const d of [1.5, 3, 6, 10]) assert.equal(causticStrength(d, noon), CAUSTIC_LOOK.gain, `full at ${d} m`);
  prev = 1;
  for (let d = 10; d <= 22; d += 0.5) { const k = causticStrength(d, noon); assert.ok(k <= prev + 1e-12, `falling at ${d} m`); prev = k; }
  assert.equal(causticStrength(22, noon), 0); assert.equal(causticStrength(40, noon), 0);
  assert.equal(fineWeight(2), 1); assert.equal(fineWeight(9), 0); assert.ok(fineWeight(6) > 0 && fineWeight(6) < 1);
});

test('the slices: each layer\'s blend sums to 1 and walks its planes in order; deeper light is blurrier (the sun\'s disc)', () => {
  for (const L of CAUSTICS.layers) {
    const ds = L.slices.map((s) => s.depth);
    assert.ok(ds[0] < ds[1] && ds[1] < ds[2]);
    for (let d = 0; d <= 30; d += 0.25) { const w = sliceWeights(d, L.slices); assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-12); assert.ok(w.every((x) => x >= 0)); }
    assert.deepEqual(sliceWeights(ds[0], L.slices), [1, 0, 0]); assert.deepEqual(sliceWeights(ds[1], L.slices), [0, 1, 0]); assert.deepEqual(sliceWeights(ds[2] + 5, L.slices), [0, 0, 1]);
  }
  const t = CAUSTICS.layers[0].tile;
  assert.ok(discLod(10, t) > discLod(4, t) && discLod(4, t) >= discLod(1.5, t));
  assert.ok(discLod(4, CAUSTICS.layers[1].tile) > discLod(4, t), 'the ripples\' finer tile blurs sooner');
});

test('the splat\'s landing offsets stay inside each slice\'s margin (the lake\'s slopes, the sun from 20° up); flat water lands at 0', () => {
  for (const L of CAUSTICS.layers) for (const s of L.slices) {
    const a = s.depth / L.tile, m = (s.margin - 1) / s.cells;
    assert.deepEqual(landing(0, 0, sunAt(40), a).map((x) => Math.abs(+x.toFixed(12))), [0, 0]);
    // the lake's steepest resolved facets on either tile: |slope| 0.25 (the splat's slope mips are smoothed)
    const smax = 0.25;
    let worst = 0;
    for (const el of [20, 40, 70]) for (let k = 0; k < 16; k++) { const th = k * Math.PI / 8; const d = landing(smax * Math.cos(th), smax * Math.sin(th), sunAt(el), a); worst = Math.max(worst, Math.abs(d[0]), Math.abs(d[1])); }
    assert.ok(worst <= m, `cascade ${L.cascade}, ${s.depth} m: offset ${worst.toFixed(4)} within the margin ${m.toFixed(4)} (tile units)`);
    assert.equal(spanOf(s), s.cells + 2 * s.margin);
  }
});

test('the method conserves the light: a wave train\'s landed area ratios average to 1 over its tile', () => {
  // a 1-D cut of the splat: cells of a sinusoidal slope refracted onto a plane; each cell's light is its width over its
  // landed width, laid where it lands (the shader's |det| in 1-D), binned; the bins' mean is flat water's (1)
  const n = 512, bins = new Float64Array(128), sun = sunAt(60, 0);
  const slope = (u) => 0.12 * Math.sin(2 * Math.PI * u * 3) + 0.05 * Math.sin(2 * Math.PI * u * 7 + 1);
  const a = 4 / CAUSTICS.layers[0].tile;
  const x = (i) => { const u = i / n; return u + landing(slope(u), 0, sun, a)[0]; };
  for (let i = 0; i < n; i++) {
    const x0 = x(i), x1 = x(i + 1), lo = Math.min(x0, x1), hi = Math.max(x0, x1), w = Math.max(hi - lo, 1e-9);
    const ratio = Math.min((1 / n) / w, CAUSTICS.maxRatio);
    // spread the cell's light over the bins it lands on (wrapping: the tile repeats)
    const b0 = Math.floor(lo * bins.length), b1 = Math.floor(hi * bins.length);
    for (let b = b0; b <= b1; b++) { const s = Math.max(lo, b / bins.length), e = Math.min(hi, (b + 1) / bins.length); if (e > s) bins[((b % bins.length) + bins.length) % bins.length] += ratio * (e - s) * bins.length; }
  }
  const mean = bins.reduce((p, c) => p + c, 0) / bins.length;
  assert.ok(Math.abs(mean - 1) < 0.01, `the landed light's mean ${mean.toFixed(4)}`);
  const max = Math.max(...bins), min = Math.min(...bins);
  assert.ok(max > 1.2 && min < 0.85, `it gathers light into lines (max ${max.toFixed(2)}, min ${min.toFixed(2)})`);
});

test('the WGSL: no Safari-unsafe smoothstep, the bed\'s lookup and the splat\'s entry points', () => {
  for (const [name, code] of [['CAUSTIC_WGSL', CAUSTIC_WGSL], ['SPLAT_WGSL', SPLAT_WGSL], ['CMIP_WGSL', CMIP_WGSL]]) assert.deepEqual(lintWgsl(code, name), [], name);
  assert.ok(/fn waveCaustic\(/.test(CAUSTIC_WGSL) && /fn causticStrength\(/.test(CAUSTIC_WGSL));
  assert.ok(/@vertex fn vs/.test(SPLAT_WGSL) && /@fragment fn fs/.test(SPLAT_WGSL));
});
