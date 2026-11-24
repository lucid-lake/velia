// v1's spume on v2's water (v2/render/spume.js): the onset at 12 m/s (none under it, v1's 0.6 by 17), the lanes along the
// wind within a few degrees at any heading, steady from frame to frame (no flicker), v1's breaking measure and its
// threshold taken from the readback window at Monahan's cover. The WGSL's parity with these functions runs on the GPU in
// v2/tests/pages/spume.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPUME, perlin2, laneAt, laneVis, spumeOf, breakingOf, SPUME_WGSL } from '../render/spume.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

const DEG = Math.PI / 180;

test('v1\'s numbers: the onset 12–17 m/s, the lanes 2.2 × 30 m, the gain 0.6, the crest ramp 0.3–0.8', () => {
  assert.deepEqual([...SPUME.onset], [12, 17]);
  assert.deepEqual([SPUME.acrossM, SPUME.alongM, SPUME.gain, SPUME.drift], [2.2, 30, 0.6, 0.03]);
  assert.deepEqual([...SPUME.crest], [0.3, 0.8]);
  assert.deepEqual([...SPUME.anchor], [700, -600], 'v1\'s bay centre');
});

test('the threshold: no spume at or under 12 m/s, whatever the fold and the lane; v1\'s full 0.6 from 17 m/s', () => {
  for (const U of [0, 5, 9, 11, 11.5, 11.99, 12]) for (const b of [0.5, 1]) assert.equal(spumeOf(U, b, 1), 0, `U ${U}, breaking ${b}`);
  assert.ok(spumeOf(12.5, 1, 1) > 0 && spumeOf(12.5, 1, 1) < 0.05, 'a trace just past the onset');
  assert.ok(Math.abs(spumeOf(17, 1, 1) - 0.6) < 1e-12 && Math.abs(spumeOf(25, 1, 1) - 0.6) < 1e-12);
  assert.equal(spumeOf(20, 0.3, 1), 0, 'off the fold (breaking under 0.3)');
  assert.equal(spumeOf(20, 1, -0.5), 0, 'between the lanes (a slick)');
  assert.ok(spumeOf(20, 0.55, 0.5) > 0 && spumeOf(20, 0.55, 0.5) < spumeOf(20, 0.8, 0.5));
});

// the lanes' long axis: the structure tensor of the pattern's gradient over nine 56 m patches spread across 1 km (one
// patch alone leans with v1's meander, ± 6 m over 70 m); sampled at 0.35 m, under half the finer octave's 1.1 m (a
// coarser grid aliases it and leans the axis toward the grid). The gradient's weak direction is the lanes' direction
function laneAxis(travelRad, U = 15, t = 1234.5) {
  const n = 161, h = 0.35;
  let sxx = 0, szz = 0, sxz = 0;
  const f = new Float64Array(n * n);
  for (let p = 0; p < 9; p++) {
    const x0 = 1800 + (p % 3) * 450 - 28, z0 = -1900 + Math.floor(p / 3) * 450 - 28;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f[j * n + i] = laneAt(x0 + i * h, z0 + j * h, U, travelRad, t);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      const gx = (f[j * n + i + 1] - f[j * n + i - 1]) / (2 * h), gz = (f[(j + 1) * n + i] - f[(j - 1) * n + i]) / (2 * h);
      sxx += gx * gx; szz += gz * gz; sxz += gx * gz;
    }
  }
  // the gradient's dominant direction, then the axis across it
  const across = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ratio = (sxx + szz + Math.hypot(sxx - szz, 2 * sxz)) / Math.max(1e-12, sxx + szz - Math.hypot(sxx - szz, 2 * sxz));
  return { axis: across + Math.PI / 2, ratio };
}
const axisErrDeg = (a, b) => { let d = ((a - b) % Math.PI + Math.PI) % Math.PI; if (d > Math.PI / 2) d = Math.PI - d; return d / DEG; };

test('the streaks run with the wind: the lanes\' long axis within 4° of the wind at any heading, and stretched', () => {
  for (const deg of [0, 37, 90, 145, 200, 290]) {
    const { axis, ratio } = laneAxis(deg * DEG);
    const err = axisErrDeg(axis, deg * DEG);
    assert.ok(err < 4, `wind travelling ${deg}°: the lanes lie at ${(axis / DEG).toFixed(1)}° (off by ${err.toFixed(2)}°)`);
    assert.ok(ratio > 30, `long and thin, not blobs: the gradient's anisotropy ${ratio.toFixed(1)} : 1`);
  }
});

test('steady: a frame (1/60 s) moves a lane by a hair, never a flicker', () => {
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const x = 2200 + (k % 20) * 7.3, z = -1500 + Math.floor(k / 20) * 5.1;
    worst = Math.max(worst, Math.abs(laneAt(x, z, 17, 0.6, 500 + 1 / 60) - laneAt(x, z, 17, 0.6, 500)));
  }
  assert.ok(worst < 0.01, `the largest change in a frame ${worst.toFixed(4)}`);
  // and the same clock gives the same lanes (no hidden state)
  assert.equal(laneAt(2310.5, -1404.2, 17, 0.6, 777), laneAt(2310.5, -1404.2, 17, 0.6, 777));
});

test('MaterialX Perlin: 0 on the lattice, within ±1, deterministic, smooth', () => {
  for (const [x, y] of [[0, 0], [3, -7], [-120, 44]]) assert.ok(Math.abs(perlin2(x, y)) < 1e-12);
  let lo = 0, hi = 0;
  for (let i = 0; i < 20000; i++) { const v = perlin2(i * 0.137 - 900, i * 0.0731 + 400); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo > -1 && hi < 1 && hi - lo > 1, `range ${lo.toFixed(3)} … ${hi.toFixed(3)}`);
  assert.equal(perlin2(12.3, -4.56), perlin2(12.3, -4.56));
  assert.ok(Math.abs(perlin2(5.5, 5.5) - perlin2(5.5 + 1e-4, 5.5)) < 1e-3);
});

test('the lanes fade where they would alias (v1\'s laneVisibility) and past v1\'s look-map square', () => {
  assert.equal(laneVis(0.2, 0.5, 0, 0), 1);
  assert.equal(laneVis(0.9, 0.5, 0, 0), 0, 'a 0.9 m footprint');
  assert.equal(laneVis(0.2, 0.02, 0, 0), 0, 'a grazing view');
  assert.equal(laneVis(0.2, 0.5, 128 * 0.97, 0), 0, 'past the square\'s rim');
  assert.ok(laneVis(0.6, 0.5, 0, 0) > 0 && laneVis(0.6, 0.5, 0, 0) < 1);
});

test('v1\'s breaking measure: a 0.06 band under the threshold, gated by the caps\' 4–8 m/s', () => {
  assert.equal(breakingOf(0.5, 0.5, 15), 0);
  assert.equal(breakingOf(0.44, 0.5, 15), 1);
  assert.ok(Math.abs(breakingOf(0.47, 0.5, 15) - 0.5) < 1e-9);
  assert.equal(breakingOf(0.3, 0.5, 3), 0);
});

test('the WGSL passes the Safari lint (no reversed smoothstep edges)', () => {
  assert.deepEqual(lintWgsl(`struct Frame { viewProj: mat4x4f, cam: vec4f, res: vec4f, wind: vec4f, spume: vec4f }\n@group(0) @binding(0) var<uniform> F: Frame;\n${SPUME_WGSL}`, 'spume'), []);
});
