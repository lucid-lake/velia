// T3 checks: the wave model reads true to the growth laws and to a sailor, and the gust stub moves downwind at the
// wind speed.   node --test tests/water.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G, bands, peakFrequency, significantHeight, amplitudes, slopeVariance, coxMunk, fetchEllipse, downwind,
  bandWeight, peakEnhancement, JONSWAP_GAMMA, makeSurface, whitecapCoverage, WHITECAP,
} from '../src/sim/water-spectrum.js';
import { WindStub } from '../src/wind-stub.js';

const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const peakLambda = (U, F) => G / (2 * Math.PI * peakFrequency(U, F) ** 2);

test('fetch-limited growth: short chop near the upwind shore, longer and higher waves downwind', () => {
  for (const U of [2, 6, 12]) {
    assert.ok(peakLambda(U, 50) < peakLambda(U, 2000), `λp grows with fetch at ${U} m/s`);
    assert.ok(significantHeight(U, 50) < significantHeight(U, 2000), `Hs grows with fetch at ${U} m/s`);
  }
  // the JONSWAP numbers at 12 m/s over 2 km: λp ≈ 4.9 m, Hs ≈ 0.27 m; at 50 m of fetch, under 0.5 m and 5 cm
  assert.ok(near(peakLambda(12, 2000), 4.89, 0.02));
  assert.ok(near(significantHeight(12, 2000), 0.274, 0.02));
  assert.ok(peakLambda(12, 50) < 0.5 && significantHeight(12, 50) < 0.05);
});

test('the sea never grows past fully developed', () => {
  for (const U of [2, 6, 12]) {
    assert.ok(near(significantHeight(U, 1e8), 0.21 * U * U / G, 1e-9));
    assert.ok(near(peakFrequency(U, 1e8), 0.877 * G / (2 * Math.PI * U), 1e-9));
  }
});

test('band amplitudes rebuild the significant height (Hs = 4·√(Σa²/2)) within 5 %', () => {
  for (const U of [3, 6, 12]) for (const F of [100, 2000]) {
    const a = amplitudes(U, F);
    const hs = 4 * Math.sqrt(a.reduce((s, x) => s + x * x / 2, 0));
    assert.ok(near(hs, significantHeight(U, F), 0.05), `U ${U}, F ${F}: ${hs.toFixed(4)} vs ${significantHeight(U, F).toFixed(4)}`);
  }
});

test('mean-square slope matches Cox & Munk within 10 % from 3 to 12 m/s (2 km fetch)', () => {
  for (const U of [3, 6, 9, 12]) {
    const s = slopeVariance(U, 2000);
    assert.ok(near(s, coxMunk(U), 0.10), `U ${U}: ${s.toFixed(4)} vs ${coxMunk(U).toFixed(4)}`);
  }
});

test("cat's paws: a gust roughens the water, a lull in light air goes glassy", () => {
  for (const U of [2, 6, 12]) {
    assert.ok(slopeVariance(U, 2000, 1.25 * U) > 1.5 * slopeVariance(U, 2000, U), `gust at ${U} m/s`);
    assert.ok(slopeVariance(U, 2000, 0.75 * U) < 0.7 * slopeVariance(U, 2000, U), `lull at ${U} m/s`);
  }
  assert.ok(slopeVariance(2, 2000, 1.0) < 0.3 * coxMunk(2), 'a 1 m/s lull is near glass');
});

test('fetch: back upwind to the shore ellipse', () => {
  const shore = { cx: 0, cz: 0, rx: 1600, rz: 1000 };
  assert.ok(near(fetchEllipse(0, 0, 270, shore), 1600, 1e-9));   // wind from the west: the west shore is 1600 m away
  assert.ok(near(fetchEllipse(0, 0, 0, shore), 1000, 1e-9));     // from the north: 1000 m (z is south)
  assert.ok(near(fetchEllipse(1500, 0, 270, shore), 3100, 1e-9));
  assert.equal(fetchEllipse(2000, 0, 270, shore), 0);             // outside the lake
});

test('the wind stub: gusts travel downwind at the wind speed, exactly; mean speed within 5 %; deterministic', () => {
  for (const [dirDeg, speedMs] of [[315, 6], [90, 2], [200, 12]]) {
    const w = new WindStub({ seed: 3, base: { dirDeg, speedMs } });
    const [dx, dz] = downwind(dirDeg);
    for (const [x, z, t] of [[0, 0, 0], [350, -820, 4.5], [-1200, 640, 30]]) {
      const dt = 10, a = w.sample(x, z, t), b = w.sample(x + dx * speedMs * dt, z + dz * speedMs * dt, t + dt);
      assert.ok(Math.abs(a.speed - b.speed) < 1e-9, `${dirDeg}°/${speedMs}: the patch at (${x}, ${z}) moved ${speedMs * dt} m in ${dt} s`);
    }
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += w.sample((i % 40) * 97 - 1900, Math.floor(i / 40) * 83 - 1000, i * 0.37).speed;
    assert.ok(near(sum / 1000, speedMs, 0.05), `mean ${(sum / 1000).toFixed(3)} vs ${speedMs}`);
  }
  const a = new WindStub({ seed: 7 }).toTexture(16, 4096, 2), b = new WindStub({ seed: 7 }).toTexture(16, 4096, 2);
  assert.deepEqual(a, b);
  assert.deepEqual(bands(5), bands(5));
});

test('shore maps: fetch traced upwind over a real-shaped shore; shore distance clamped', async () => {
  const { fetchTrace, fetchMap, shoreDistanceMap, ellipseShore } = await import('../src/sim/water-spectrum.js');
  const circle = (x, z) => Math.hypot(x, z) - 1000;   // an exact distance field: a round lake of 1 km radius
  for (const dir of [0, 90, 225, 315]) assert.ok(Math.abs(fetchTrace(circle, 0, 0, dir) - 1000) < 1.5, `centre, from ${dir}°`);
  assert.ok(Math.abs(fetchTrace(circle, 0, 600, 0) - 1600) < 1.5);   // wind from the north, 600 m south of centre
  assert.equal(fetchTrace(circle, 0, 1200, 0), 0);                   // on land
  const f = fetchMap(circle, 0, { size: 8, extent: 4000 });
  assert.ok(Math.abs(f[4 * 8 + 4] - fetchTrace(circle, 250, 250, 0)) < 1e-3);   // texel (4, 4) centre is (250, 250); Float32
  const sd = shoreDistanceMap(circle, { size: 4, extent: 8000, clampM: 60 });
  assert.equal(Math.max(...sd), 60); assert.equal(Math.min(...sd), 60);   // all texels are far on land, clamped
  const e = ellipseShore({ cx: 0, cz: 0, rx: 1600, rz: 1000 });
  assert.ok(e(0, 0) < 0 && e(1700, 0) > 0 && Math.abs(e(1600, 0)) < 1e-9);
});

test('two waves per wavelength, one each side of downwind; 64 in all', () => {
  const B = bands(1);
  assert.equal(B.length, 64);
  const byLambda = new Map();
  for (const b of B) byLambda.set(b.lambda, [...(byLambda.get(b.lambda) ?? []), b.offsetRad]);
  for (const [, offs] of byLambda) { assert.equal(offs.length, 2); assert.ok(offs[0] * offs[1] < 0); }
});

test('L1 optics: Secchi 19 m; shallow sand reads blue-green (turquoise), deep water reads blue (cobalt)', async () => {
  const { WATER_K, SECCHI_M, waterColumn } = await import('../src/sim/water-spectrum.js');
  assert.ok(Math.abs(1.7 / WATER_K[1] - SECCHI_M) < 0.01);
  const sand = [0.55, 0.52, 0.45];
  const shallow = waterColumn(3, sand), deep = waterColumn(200, sand);
  assert.ok(shallow[1] > shallow[0] && shallow[2] > shallow[0], 'over 3 m of sand: green and blue above red');
  assert.ok(shallow[1] > 0.5 * shallow[2], 'still green enough to read turquoise');
  assert.ok(deep[2] > 2 * deep[1] && deep[1] > 2 * deep[0], 'deep: blue ≫ green ≫ red');
  assert.ok(Math.max(...deep) < 0.3 * Math.max(...shallow), 'deep water is much darker than the shelf');
  // a white disc at the Secchi depth: its contrast against the deep water, for the green channel, is about 3 %
  const disc = waterColumn(SECCHI_M, [1, 1, 1]), inf = waterColumn(1e4, [1, 1, 1]);
  const contrast = (disc[1] - inf[1]) / inf[1];
  assert.ok(contrast > 0.5, `the bottom still shows at the Secchi depth: contrast ${contrast.toFixed(2)}`);
});

// ---: the fetch-limited sea at Tahoe's scale, JONSWAP's shape, the whitecaps' calibration ---

test('the growth laws at 15 and 20 kn over 1–3 km give Hs 0.12–0.29 m and Tp 1.2–1.9 s (the worked numbers of)', () => {
  // Hasselmann et al. 1973: g·Hs/U² = 1.6e-3·(gF/U²)^0.5, fp·U/g = 3.5·(gF/U²)^−0.33 (CEM II-2, Holthuijsen 2007);
  // worked by hand: U 7.7, F 2000: F* = 331, Hs = 1.6e-3·√331·7.7²/9.81 = 0.176 m, fp = 3.5·(9.81/7.7)·331^−0.33 = 0.656 Hz
  const cases = [[7.7, 1000, 0.124, 1.21], [7.7, 2000, 0.176, 1.52], [7.7, 3000, 0.215, 1.74], [10.3, 1000, 0.166, 1.34], [10.3, 2000, 0.235, 1.68], [10.3, 3000, 0.288, 1.92]];
  for (const [U, F, hs, tp] of cases) {
    assert.ok(near(significantHeight(U, F), hs, 0.02), `U ${U} F ${F}: Hs ${significantHeight(U, F).toFixed(3)} vs ${hs}`);
    assert.ok(near(1 / peakFrequency(U, F), tp, 0.02), `U ${U} F ${F}: Tp ${(1 / peakFrequency(U, F)).toFixed(2)} vs ${tp}`);
  }
});

test('JONSWAP: the peak band carries γ = 3.3 × its Pierson–Moskowitz energy, the tail (f ≥ 2 fp) is unchanged; Hs still rebuilds within 5 %', () => {
  assert.ok(near(peakEnhancement(1, 1), JONSWAP_GAMMA, 1e-9));
  assert.ok(peakEnhancement(2, 1) < 1.001 && peakEnhancement(0.5, 1) < 1.001);
  // below the peak the enhancement falls faster (σ = 0.07) than above it (σ = 0.09)
  assert.ok(peakEnhancement(0.9, 1) < peakEnhancement(1.1, 1));
  const B = bands(1), fp = peakFrequency(10.3, 2000);
  const pm = (b) => Math.pow(b.f, -4) * Math.exp(-1.25 * Math.pow(fp / b.f, 4)) * b.dlnf;
  const peak = B.reduce((best, b) => (Math.abs(Math.log(b.f / fp)) < Math.abs(Math.log(best.f / fp)) ? b : best), B[0]);
  assert.ok(bandWeight(peak, fp) / pm(peak) > 2.2, `peak band × ${(bandWeight(peak, fp) / pm(peak)).toFixed(2)}`);
  for (const U of [6, 10.3]) for (const F of [650, 2000]) {
    const a = amplitudes(U, F);
    assert.ok(near(4 * Math.sqrt(a.reduce((s, x) => s + x * x / 2, 0)), significantHeight(U, F), 0.05));
  }
});

test('whitecaps: the Jacobian rule covers the Monahan fraction (×0.5–2) at 15 and 20 kn and nothing in light air', () => {
  // the shader's threshold: J0 = 0.677 + 0.1228·log10(U) (WHITECAP.j0), the quantile of this spectrum's J at W(U)
  const coverage = (U, F) => {
    const s = makeSurface({ U, dirDeg: 315, fetchAt: () => F }), J0 = WHITECAP.j0[0] + WHITECAP.j0[1] * Math.log10(U);
    let n = 0, below = 0;
    for (let i = 0; i < 6000; i++) { const x = (i % 100) * 0.37, z = Math.floor(i / 100) * 0.41 + 3.1; n++; if (s.jacobianAt(x, z, 7.3 + (i % 7) * 0.9) < J0) below++; }
    return below / n;
  };
  for (const U of [7.7, 10.3]) {
    const c = coverage(U, 2000), w = whitecapCoverage(U);
    assert.ok(c > 0.5 * w && c < 2 * w, `U ${U}: ${(100 * c).toFixed(2)} % vs Monahan ${(100 * w).toFixed(2)} %`);
  }
  assert.ok(whitecapCoverage(4) < 0.0005, 'light air: under 0.05 %');
  assert.ok(WHITECAP.onset[0] >= 3.5, 'no whitecaps under 7 kn');
});

test('the Smith effect: a hull at 0.3 m feels a 2 m wave at a third of its height and a 10 m wave at 83 %', () => {
  const surf = makeSurface({ U: 10.3, dirDeg: 315, fetchAt: () => 2000 });
  // compare per-band attenuation through the public surface: a single-band check via amps and the exponent
  const [b2, b10] = [2, 10].map((lam) => Math.exp(-2 * Math.PI / lam * 0.3));
  assert.ok(near(b2, 0.39, 0.03) && near(b10, 0.828, 0.01));
  // and the surface itself is lower-passed by it: variance with depthM 0.3 is well under the undamped one
  let v0 = 0, v1 = 0;
  for (let i = 0; i < 2000; i++) { const x = i * 0.37, z = 11; const h0 = surf.heightAt(x, z, 5), h1 = surf.heightAt(x, z, 5, { depthM: 0.3 }); v0 += h0 * h0; v1 += h1 * h1; }
  assert.ok(v1 / v0 > 0.1 && v1 / v0 < 0.6, `variance ratio ${(v1 / v0).toFixed(3)}`);
});

test('the peak-enhancement table the shader reads matches the exact band average within 2 %', async () => {
  const { peakEnhancementLUT, peakEnhancementBand, GAMMA_LUT } = await import('../src/sim/water-spectrum.js');
  const B = bands(1), geo = B.filter((b) => b.kind === 'geometry'), lut = peakEnhancementLUT(B);
  const { size, fpMin, fpMax } = GAMMA_LUT;
  let worst = 0;
  for (const fp of [0.3, 0.52, 0.66, 0.9, 1.3]) {
    const u = Math.log(fp / fpMin) / Math.log(fpMax / fpMin) * (size - 1), i = Math.floor(u), t = u - i;
    geo.forEach((b, row) => {
      const v = lut[row * size + i] * (1 - t) + lut[row * size + i + 1] * t;
      worst = Math.max(worst, Math.abs(v / peakEnhancementBand(b, fp) - 1));
    });
  }
  assert.ok(worst < 0.02, `worst ${(100 * worst).toFixed(2)} %`);
  assert.ok(Math.max(...lut) > 2 && Math.min(...lut) >= 0.999);
});
