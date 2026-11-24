// The wake (src/boat/wake.js) and the visible wind (src/wind-cues.js) read true to the physics.
//   node --test tests/wake.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G, KELVIN_DEG, TRAIL_N, TRAIL_DT, transverseWavelength, kelvinDirections, impulseK, impulsePhase, wakeHeightCPU,
} from '../src/boat/wake.js';
import { whitecapCoverage, STREAK_ONSET, WHITECAP_ONSET, SPUME_ONSET } from '../src/wind-cues.js';

const near = (a, b, rel) => Math.abs(a - b) <= rel * Math.abs(b);
const KN = 0.5144;

test('the transverse wavelength is 2πU²/g: 2.6 m at 4 kn, 6.1 m at 6 kn, 8.3 m at 7 kn', () => {
  assert.ok(near(transverseWavelength(4 * KN), 2.71, 0.02));
  assert.ok(near(transverseWavelength(6 * KN), 6.10, 0.02));
  assert.ok(near(transverseWavelength(7 * KN), 8.31, 0.02));
  assert.equal(transverseWavelength(3), 2 * Math.PI * 9 / G);
});

test('the Kelvin wedge: two wave directions inside 19.47°, one at the cusp (tan θ = 1/√2), none outside', () => {
  assert.ok(near(KELVIN_DEG, Math.asin(1 / 3) * 180 / Math.PI, 1e-3));
  const inside = kelvinDirections(10 * Math.PI / 180);
  assert.ok(inside.transverse < inside.divergent);
  assert.ok(inside.transverse > 0 && inside.divergent < Math.PI / 2);
  // dead astern: a pure transverse wave (θ = 0) and a divergent wave at 90°
  assert.deepEqual(kelvinDirections(0), { transverse: 0, divergent: Math.PI / 2 });
  // at the cusp the two meet at tan θ = 1/√2 (35.26°)
  const cusp = kelvinDirections(KELVIN_DEG * Math.PI / 180 - 1e-4);
  assert.ok(near(cusp.transverse, Math.atan(1 / Math.SQRT2), 0.03));
  assert.ok(near(cusp.divergent, Math.atan(1 / Math.SQRT2), 0.03));
  assert.equal(kelvinDirections(20 * Math.PI / 180), null);
});

test('the point impulse: local wavenumber gτ²/4r² and phase gτ²/4r; at the transverse stationary point k = g/U²', () => {
  assert.ok(near(impulseK(10, 4), G * 16 / 400, 1e-9));
  assert.ok(near(impulsePhase(10, 4), G * 16 / 40, 1e-9));
  // energy at distance a behind the boat was emitted 2a/U ago from a point a behind the field point (group speed U/2)
  for (const U of [2, 3, 3.6]) {
    const a = 20, tau = 2 * a / U;
    assert.ok(near(impulseK(a, tau), G / (U * U), 1e-9), `k = g/U² at ${U} m/s`);
  }
});

test('the impulse sum along a straight track makes the Kelvin pattern: crests dead astern λ = 2πU²/g apart', () => {
  for (const U of [2, 3]) {
    const zs = [], hs = [];
    for (let z = 2; z < U * TRAIL_N * TRAIL_DT * 0.5; z += 0.05) { zs.push(z); hs.push(wakeHeightCPU(0, z, { U })); }
    const peaks = [];
    for (let i = 1; i < hs.length - 1; i++) if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > 0.2 * Math.max(...hs)) peaks.push(zs[i]);
    assert.ok(peaks.length >= 4, `at least 4 crests behind the stern at ${U} m/s (got ${peaks.length})`);
    const gaps = peaks.slice(1, 5).map((p, i) => p - peaks[i]);
    for (const g of gaps) assert.ok(near(g, transverseWavelength(U), 0.08), `crest spacing ${g.toFixed(2)} ≈ λ ${transverseWavelength(U).toFixed(2)} at ${U} m/s`);
  }
});

test('the impulse sum: the wave envelope peaks near the 19.47° arm and dies outside the wedge', () => {
  const U = 3, a = 20, env = (c) => { let m = 0; for (let dz = -3; dz <= 3; dz += 0.1) m = Math.max(m, Math.abs(wakeHeightCPU(c, a + dz, { U }))); return m; };
  const arm = a * Math.tan(KELVIN_DEG * Math.PI / 180);   // 7.07 m
  const onArm = Math.max(env(arm - 1), env(arm), env(arm + 1)), centre = env(0), outside = env(arm + 5);
  assert.ok(onArm > centre, `the arm (${onArm.toFixed(4)}) is higher than the centreline (${centre.toFixed(4)})`);
  assert.ok(outside < 0.35 * onArm, `outside the wedge (${outside.toFixed(4)}) under 35 % of the arm`);
});

test('the wake scales with speed and vanishes at rest', () => {
  const amp = (U) => Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(wakeHeightCPU(0, 3 + i * 0.1, { U }))));
  assert.ok(amp(3) > amp(2) && amp(2) > amp(1), 'more wake with speed');
  assert.equal(wakeHeightCPU(0, 5, { U: 0.3, amp: 0 }), 0);
});

test('whitecap coverage (Monahan 1980): about 1 % at 10 m/s, 4 % at 15 m/s; the cue thresholds are ordered', () => {
  assert.ok(near(whitecapCoverage(10), 0.0099, 0.05));
  assert.ok(near(whitecapCoverage(15), 0.0394, 0.05));
  assert.equal(whitecapCoverage(0), 0);
  assert.ok(STREAK_ONSET[0] < STREAK_ONSET[1] && WHITECAP_ONSET[0] < WHITECAP_ONSET[1] && SPUME_ONSET[0] < SPUME_ONSET[1]);
  // lanes before caps before spume, as a sailor sees them (≈ 6 kn, ≈ 12 kn, ≈ 23 kn)
  assert.ok(STREAK_ONSET[0] < WHITECAP_ONSET[0] && WHITECAP_ONSET[1] < SPUME_ONSET[0]);
  assert.ok(near(WHITECAP_ONSET[0] / KN, 11.7, 0.05) && near(SPUME_ONSET[0] / KN, 23.3, 0.05));
});
