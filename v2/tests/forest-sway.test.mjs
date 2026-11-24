// The trees' sway (v2/forest/sway.js; owner 2026-11-15: "v1 tree move with wind, V2 does not have this at all"): v1's main
// bending read from the one wind texture (sim/windTex.js) at each tree's root. Still air leaves a tree still; the sway
// grows with the wind; neighbours swing out of step; a gust patch rolls downwind through the stands; the same clock gives
// the same sway. The draw's WGSL compiles in the card shader (render/forest.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SWAY, swayAt, treePhase, treeSeed } from '../forest/sway.js';
import { createWindTex, WIND_TEX, WIND_EXTENT } from '../sim/windTex.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { CARD_DRAW_WGSL, CULL_WGSL, CARD_VERTS } from '../render/forest.js';
import { wgslStruct } from '../engine/uniforms.js';
import { lintWgsl } from '../engine/wgsl-lint.js';

const tip = (w, t, phase = 1, height = 30) => Math.hypot(...swayAt(w, 0, t, phase, 1, height));
const peak = (w, phase = 1, height = 30) => { let m = 0; for (let t = 0; t < 30; t += 0.05) m = Math.max(m, tip(w, t, phase, height)); return m; };

test('still air: no sway at all (any height, any time, any tree); gain 0 stills every tree', () => {
  for (const t of [0, 1.7, 123.4]) for (const h of [0, 0.3, 1]) for (const ph of [0, 2, 6]) assert.deepEqual(swayAt(0, 0, t, ph, h, 35), [0, 0]);
  assert.deepEqual(swayAt(9, 3, 5, 1, 1, 30, 0), [0, 0]);
  // the foot never moves: the bend is from the base
  for (const w of [3, 10, 18]) assert.deepEqual(swayAt(w, 0, 2.3, 1, 0, 30).map(Math.abs), [0, 0]);
});

test('the sway grows with the wind: calm nearly still, v1\'s 1.5 % lean at 10 m/s, the tip moves most', () => {
  const speeds = [1, 2, 4, 6, 8, 10, 13, 16];
  const peaks = speeds.map((w) => peak(w));
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] > peaks[i - 1], `${speeds[i]} m/s sways more than ${speeds[i - 1]}`);
  assert.ok(peaks[1] < 0.1, `a 30 m pine in 2 m/s: ${peaks[1].toFixed(3)} m at the tip`);
  // the mean lean at 10 m/s is v1's 1.5 % of the height, along the wind (the oscillation's mean is 0)
  let sx = 0, sz = 0, n = 0; for (let t = 0; t < 600; t += 0.01) { const [x, z] = swayAt(10, 0, t, 1, 1, 30); sx += x; sz += z; n++; }
  assert.ok(Math.abs(sx / n - 0.015 * 30) < 0.01, `mean lean ${(sx / n).toFixed(3)} m`); assert.equal(sz, 0);
  // v1's profile (h01²): half-way up moves a quarter of the tip (the card samples it at its rows)
  const mid = Math.hypot(...swayAt(10, 0, 3, 1, 0.5, 30)), top = Math.hypot(...swayAt(10, 0, 3, 1, 1, 30));
  assert.ok(Math.abs(mid / top - 0.25) < 1e-9);
  // the leaning is along the local wind's own direction
  const [x, z] = swayAt(0, 8, 0.2, 1, 1, 30); assert.equal(x, 0); assert.ok(z !== 0);
  // a conifer's sway: 0.25–0.40 Hz
  assert.ok(SWAY.w0 / (2 * Math.PI) > 0.24 && (SWAY.w0 + 2 * Math.PI * SWAY.wPhase) / (2 * Math.PI) < 0.41);
});

test('neighbouring trees swing out of step: each its own phase, spread round the circle', () => {
  const ph = []; for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ph.push(treePhase(1000 + i * 3.25, -500 + j * 2.75));
  assert.equal(new Set(ph.map((p) => p.toFixed(4))).size, ph.length, 'no two trees share a phase');
  // the phases cover the circle (a resultant length near 0)
  const cx = ph.reduce((s, p) => s + Math.cos(p), 0) / ph.length, cz = ph.reduce((s, p) => s + Math.sin(p), 0) / ph.length;
  assert.ok(Math.hypot(cx, cz) < 0.2);
  // two trees 3 m apart, the same wind: not in step
  const a = treePhase(1000, -500), b = treePhase(1003.25, -500);
  let diff = 0; for (let t = 0; t < 20; t += 0.1) diff = Math.max(diff, Math.abs(tip(10, t, a) - tip(10, t, b)));
  assert.ok(diff > 0.1, `the tips part by ${diff.toFixed(2)} m`);
  assert.equal(treeSeed(1000, -500), treeSeed(1000, -500));
});

// the texture's local wind at a point (render/windWater.js wtSample, the bilinear read; the edge fade not reached here)
const fromHalf = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + m / 1024); };
function windAt(W, x, z) {
  const N = WIND_TEX, fx = Math.min(Math.max(((x - W.centre[0]) / WIND_EXTENT + 0.5) * N - 0.5, 0), N - 1), fz = Math.min(Math.max(((z - W.centre[1]) / WIND_EXTENT + 0.5) * N - 0.5, 0), N - 1);
  const i0 = Math.min(Math.floor(fx), N - 2), j0 = Math.min(Math.floor(fz), N - 2), tx = fx - i0, tz = fz - j0;
  const at = (i, j, c) => fromHalf(W.packed[4 * (j * N + i) + c]);
  const bl = (c) => (at(i0, j0, c) * (1 - tx) + at(i0 + 1, j0, c) * tx) * (1 - tz) + (at(i0, j0 + 1, c) * (1 - tx) + at(i0 + 1, j0 + 1, c) * tx) * tz;
  return [bl(0), bl(1)];
}

test('a gust rolls through the forest: the trees\' lean along a downwind line moves downwind with the gust patch', () => {
  const field = new WindField({ seed: 3, bay: CURRENT_WATERS.windBay, base: { dirDeg: 270, speedMs: 8 }, gust: { strength: 0.5, scaleM: 200, periodS: 400 } });
  field.setTerrain(() => -10);
  const W = createWindTex({ field });
  const ex = 0, ez = 0;
  W.update(100, ex, ez);
  const [mx, mz] = windAt(W, ex, ez); const m = Math.hypot(mx, mz), dx = mx / m, dz = mz / m;   // downwind
  const line = (W) => { const out = []; for (let s = -900; s <= 900; s += 8) { const [wx, wz] = windAt(W, ex + dx * s, ez + dz * s); out.push((wx * wx + wz * wz) * SWAY.lean * 30); } return out; };   // the tip's mean lean (m) of a 30 m tree
  const a = line(W);
  const dt = 20;
  const W2 = createWindTex({ field }); W2.update(100 + dt, ex, ez);
  const b = line(W2);
  // the lean varies along the line (gusts and lulls), and the pattern a moment later is the same pattern shifted downwind
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.max(...a) - Math.min(...a) > 0.1 * mean, 'gusts and lulls along the line');
  let best = 0, bestC = -Infinity;
  for (let lag = -40; lag <= 40; lag++) {
    let c = 0, n = 0; for (let k = 0; k < a.length; k++) { const j = k + lag; if (j < 0 || j >= b.length) continue; c += (a[k] - mean) * (b[j] - mean); n++; }
    if (c / n > bestC) { bestC = c / n; best = lag; }
  }
  const shiftM = best * 8;
  // (168 m in 20 s on this seed, the air's 162 m: the gusts ride the wind)
  assert.ok(shiftM > 0.5 * m * dt && shiftM < 1.5 * m * dt, `the pattern moved ${shiftM} m downwind in ${dt} s (the air ${(m * dt).toFixed(0)} m)`);
});

test('the same clock gives the same sway (a capture is deterministic): pure in (wind, time, tree)', () => {
  const run = () => { const out = []; for (let k = 0; k < 200; k++) { const t = 50 + k / 60; out.push(...swayAt(7.3, -2.1, t, treePhase(k * 3, 7), 0.9, 28)); } return out; };
  assert.deepEqual(run(), run());
  // smooth in time: a frame (1/60 s) moves the tip a few mm at most in a fresh breeze
  let jump = 0; for (let t = 0; t < 60; t += 1 / 60) { const a = swayAt(10, 0, t, 2, 1, 35), b = swayAt(10, 0, t + 1 / 60, 2, 1, 35); jump = Math.max(jump, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  assert.ok(jump < 0.02, `${jump.toFixed(4)} m a frame`);
});

test('the card shader carries the sway: a strip of rows, the wind read, valid WGSL', () => {
  assert.equal(CARD_VERTS, 2 * SWAY.rows);
  assert.ok(SWAY.rows >= 2);
  for (const n of [1, 4]) assert.deepEqual(lintWgsl(CARD_DRAW_WGSL(wgslStruct(), n, 128, 256)), []);
  assert.deepEqual(lintWgsl(CULL_WGSL), []);
});
