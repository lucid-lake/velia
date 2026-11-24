// The water's spectrum on the CPU (v2/sim/spectrum.js): deterministic by seed, the right layout, a plausible sea for a
// lake's wind, more sea in more wind, the wind's direction in the spectrum, and the wind module that feeds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { N, LENGTHS, CUTS, buildH0, spectrumFor, significantHeight, targetHs, gainFor, jonswapParams, omega } from '../sim/spectrum.js';
import { windFor, dayWind, travelRadOf, WIND_LEVELS } from '../sim/wind.js';

const table = (speedMs, travelRad = 0, seed = 1337) => { const s = spectrumFor({ speedMs, travelRad }); return buildH0({ A: s.A, B: s.B, seed }); };

test('layout: 4 cascades × 256² × 4 floats; the second pair is conj(h0(−k)) of the first', () => {
  const h = table(8);
  assert.deepEqual(LENGTHS, [600, 85, 12, 2.1]);
  assert.equal(h.length, LENGTHS.length * N * N * 4);
  // texel (x, y) and texel ((N − x) % N, (N − y) % N) hold each other's conjugate in their zw
  for (const [x, y] of [[100, 90], [130, 128], [3, 250]]) {
    const o = (y * N + x) * 4, ox = (N - x) % N, oy = (N - y) % N, p = (oy * N + ox) * 4;
    assert.ok(Math.abs(h[o + 2] - h[p]) < 1e-6 && Math.abs(h[o + 3] + h[p + 1]) < 1e-6, `conjugate pair at ${x},${y}`);
  }
});

test('deterministic: the same inputs give the same bytes; another seed gives other bytes of the same energy', () => {
  const a = table(8, 0.3, 1), b = table(8, 0.3, 1), c = table(8, 0.3, 2);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  const ha = significantHeight(a), hc = significantHeight(c);
  assert.ok(Math.abs(ha - hc) / ha < 0.1, `Hs by seed: ${ha.toFixed(3)} vs ${hc.toFixed(3)}`);
});

test('a lake wind sea: the raw table rises with the wind; the gain brings it to the fetch-limited Hs', () => {
  const raw = [2, 5, 8, 11].map((v) => significantHeight(table(v)));
  for (let i = 1; i < raw.length; i++) assert.ok(raw[i] > raw[i - 1] * 1.2, `raw Hs rises: ${raw.map((x) => x.toFixed(3)).join(' < ')}`);
  assert.ok(raw[2] > 1 && raw[2] < 4, `the raw table at 8 m/s: ${raw[2].toFixed(3)} m (Ultra-Water's scale, 3.5–4 × the sea)`);
  // SMB over 20 km: 0.144 m at 2 m/s, 0.578 at 8, 0.795 at 11
  assert.ok(Math.abs(targetHs(8) - 0.578) < 0.01 && Math.abs(targetHs(2) - 0.144) < 0.005 && Math.abs(targetHs(11) - 0.795) < 0.01);
  for (const U of [2, 8, 11]) { const h = table(U), g = gainFor(h, U); assert.ok(Math.abs(significantHeight(h) * g - targetHs(U)) < 1e-6, `gain at ${U} m/s`); assert.ok(g > 0.15 && g < 0.4, `gain ${g.toFixed(3)}`); }
  assert.ok(targetHs(0.3) < 0.03, 'a lull: centimetres');
});

test('the cascades split the wavenumbers at the cuts: no energy outside a cascade\'s band', () => {
  const h = table(10);
  for (let c = 0; c < LENGTHS.length; c++) {
    const L = LENGTHS[c], dk = 2 * Math.PI / L, lo = c === 0 ? 1e-4 : CUTS[c - 1], hi = CUTS[c];
    let outside = 0, inside = 0;
    for (let y = 0; y < N; y += 3) for (let x = 0; x < N; x += 3) {
      const k = Math.hypot((x - N / 2) * dk, (y - N / 2) * dk), o = ((c * N + y) * N + x) * 4, e = h[o] * h[o] + h[o + 1] * h[o + 1];
      if (k < lo || k > hi) outside += e; else inside += e;
    }
    assert.equal(outside, 0, `cascade ${c}: energy outside its band`);
    assert.ok(inside > 0, `cascade ${c}: some energy inside`);
  }
});

test('the sea runs downwind (#21, v1\'s fix of 2026-10-30): the energy sits against the travel, since a wave of number k travels toward −k', () => {
  const centroid = (travelRad) => {
    const h = table(9, travelRad); let sx = 0, sz = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = (y * N + x) * 4, e = h[o] * h[o] + h[o + 1] * h[o + 1]; sx += (x - 128) * e; sz += (y - 128) * e; }
    return Math.atan2(sz, sx);
  };
  for (const a of [0, 1.2, -2.5]) { const d = Math.atan2(Math.sin(centroid(a) - a - Math.PI), Math.cos(centroid(a) - a - Math.PI)); assert.ok(Math.abs(d) < 0.2, `travel ${a}: centroid off the upwind side by ${d.toFixed(3)} rad`); }
  // (each h0(k) term evolves as e^{i(k·x + ωt)}: its crests move toward −k, so the energy against the travel is a sea running
  // with it; tools/v2-sea-dir check on the page: v2's drawn surface ran to 214° under a 26° travel before, with it after)
});

test('JONSWAP: more wind or fetch lowers the peak frequency; the dispersion is gravity + capillary', () => {
  assert.ok(jonswapParams(10, 20).peakOmega < jonswapParams(5, 20).peakOmega);
  assert.ok(jonswapParams(8, 100).peakOmega < jonswapParams(8, 20).peakOmega);
  assert.ok(Math.abs(omega(1) - Math.sqrt(9.81 + 7.4e-5)) < 1e-9);
  assert.ok(omega(1000) > Math.sqrt(9.81 * 1000) * 1.5, 'capillary term dominates short waves');
});

test('the wind stub: v1\'s day profile, a level pins the band mean, ?windspeed/?winddir pin the numbers, travel is downwind', () => {
  const dawn = windFor({ hour: 6.5 }), noon = windFor({ hour: 16 });
  assert.ok(dawn.speedMs < 1 && noon.speedMs > 5, `dawn ${dawn.speedMs.toFixed(2)} m/s, afternoon ${noon.speedMs.toFixed(2)} m/s`);
  assert.equal(dayWind(16).regime, 'afternoon up-lake breeze');
  assert.ok(Math.abs(windFor({ hour: 16, level: 4 }).speedMs - WIND_LEVELS[3].meanKn * 0.514444) < 1e-9);
  const pinned = windFor({ hour: 16, speedMs: 11, dirDeg: 200 });
  assert.equal(pinned.speedMs, 11); assert.equal(pinned.dirDeg, 200);
  // a north wind (from 0) blows toward +z (south): the travel angle atan2(z, x) is +90°; a west wind (from 270) toward +x: 0
  assert.ok(Math.abs(travelRadOf(0) - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(travelRadOf(270)) < 1e-9);
  assert.deepEqual(windFor({ hour: 9, seed: 3 }), windFor({ hour: 9, seed: 3 }));
});
