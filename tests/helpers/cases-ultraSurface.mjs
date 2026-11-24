// The Ultra surface's test fixtures and the hull RAO check, shared by tests/ultra-surface.test.mjs (the 1 m waves) and the
// slow lane (tests/slow/ultra-surface.slow.mjs: 0.3 and 2 m). One body for both lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCpuSurface, N, LENGTHS } from '../../src/sim/waters/ultra/surface.js';
import { HullFloat } from '../../src/sim/boat/float.js';

const G = 9.81, LAYER = N * N * 4;
// a buffer holding one plane wave in cascade c: Dy = a sin(2 pi m (i + 0.5) / N - phase), Dx = -choppy * a cos(...) (the crest sharpening)
export function planeBuf({ c = 0, m = 6, a = 0.5, phase = 0, chop = 0, zcycles = 0 }) {
  const buf = new Float32Array(LAYER * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const th = 2 * Math.PI * (m * (i + 0.5) + zcycles * (j + 0.5)) / N - phase,   // texel i sits at (i + 0.5) / N, as the GPU samples it
       o = c * LAYER + (j * N + i) * 4;
    buf[o] = -chop * a * Math.cos(th); buf[o + 1] = a * Math.sin(th); buf[o + 3] = 1;
  }
  return buf;
}
export const wave = (m, c = 0) => { const lam = LENGTHS[c] / m, k = 2 * Math.PI / lam; return { lam, k, w: Math.sqrt(G * k) }; };

// the hull on the Ultra surface against the same hull on the analytic wave, waves 0.3 / 1 / 2 m high, periods 4 to 10 s
export const response = (surface, T = 36) => {
  const f = new HullFloat({ surface }), out = [];
  for (let t = 0; t < T; t += 1 / 60) out.push(f.update({ x: 0, z: 0, heading: Math.PI / 2 }, t, 1 / 60));
  const o = out.slice(out.length >> 1), amp = (q) => (Math.max(...o.map((r) => r[q])) - Math.min(...o.map((r) => r[q]))) / 2;
  let step = 0; for (let i = 1; i < o.length; i++) step = Math.max(step, Math.abs(o[i].heave - o[i - 1].heave));
  return { heave: amp('heave'), pitch: amp('pitch'), step };
};
export function raoCase(H) {
  test(`hull RAO on the Ultra surface, ${H} m waves: heave and pitch match the analytic wave, ~1 in swell, rolled off in chop, no jumps`, () => {
    const a = H / 2, rao = [];
    for (const m of [4, 6, 8, 12, 16, 24]) {
      const { k, w } = wave(m);
      const analytic = { heightAt: (x, z, t, { depthM = 0 } = {}) => a * Math.sin(k * x - w * t) * Math.exp(-k * depthM) };
      // an Ultra-like surface: the same wave, delivered as 30 Hz reads with a 2-frame lag, read at the hull's time
      const s = makeCpuSurface(), dt = 1 / 30; let lastRead = -1;
      const ultra = { heightAt: (x, z, t, o = {}) => {
        const n = Math.floor(t / dt) - 2;
        if (n > lastRead) { for (let q = Math.max(lastRead + 1, n - 1); q <= n; q++) s.push(planeBuf({ m, a, phase: w * q * dt }), q * dt); lastRead = n; }
        return s.heightAt(x, z, t, { depth: 99 }) * Math.exp(-k * (o.depthM ?? 0));
      } };
      const A = response(analytic), U = response(ultra);
      assert.ok(Math.abs(U.heave - A.heave) < 0.06 * A.heave + 0.005, `m ${m}: heave ${U.heave.toFixed(3)} vs analytic ${A.heave.toFixed(3)}`);
      assert.ok(Math.abs(U.pitch - A.pitch) < 0.08 * A.pitch + 0.002, `m ${m}: pitch ${U.pitch.toFixed(4)} vs ${A.pitch.toFixed(4)}`);
      assert.ok(U.step < 1.5 * A.step + 0.004, `m ${m}: no jumps (${(U.step * 1000).toFixed(1)} mm per step vs ${(A.step * 1000).toFixed(1)})`);
      rao.push({ lam: wave(m).lam, T: 2 * Math.PI / w, heave: U.heave / a, pitch: U.pitch / (a * k) });
    }
    assert.ok(rao[0].heave > 0.85 && rao[0].heave < 1.15, `a 150 m swell lifts the hull at RAO ${rao[0].heave.toFixed(2)}`);
    assert.ok(rao[0].pitch > 0.8 && rao[0].pitch < 1.2, `and pitches it with the wave slope (${rao[0].pitch.toFixed(2)})`);
    assert.ok(rao.at(-1).heave < rao[0].heave, 'a 25 m chop moves it less than a long swell');
  });
}

