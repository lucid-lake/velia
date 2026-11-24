// G2 (the world audit, 2026-11-14): v1's shore flags (src/shoreFlags.js, owner 2026-10-29: cheap captain's information
// sources), the read-the-wind-ashore cue. Each flag flies from the LOCAL wind (the one WindField's sample at its pole),
// sampled at 5 Hz a flag (staggered) and eased (τ 0.6 s); it hangs limp under 0.6 m/s and streams out level by 5.5 m/s. The
// sites are v1's (tools/v2-landmarks-bake.mjs: v1's flagSites on v1's layouts → v2/assets/towns/landmarks.json); the cloth's
// maths below is copied line for line from v1's flagShape, flagFlight and flagVertex (three-bound there: v1's module imports
// three, which v2 never does; v2/tests/shore-flags.test.mjs holds them equal), written into held arrays (no allocation a
// frame). Plain JS, no DOM.
//   const F = createShoreFlagsSim({ sites, wind, seed });  F.update(windT, waveT, out) each frame → out (positions, then
//   normals: 3 floats a vertex, (segU + 1) × (segV + 1) vertices a flag)
export const SHORE_FLAGS = Object.freeze({ sampleHz: 5, tauS: 0.6, limpMs: 0.6, fullMs: 5.5, droopMax: 78, segU: 8, segV: 2 });
const DEG = Math.PI / 180;
import { smooth } from '../../src/sim/core/math.js';

// v1's flagShape: the cloth's rest shape at (u, v) ∈ [0, 1]² → [s along the fly, d down the hoist] (m)
export function flagShape(site, u, v, out = [0, 0]) {
  const { L, H, shape } = site;
  if (shape === 'flag') { out[0] = u * L; out[1] = v * H; return out; }
  const tip = shape === 'burgee' ? 0.12 : 0.02, k = 1 - (1 - tip) * u;
  out[0] = u * L; out[1] = (0.5 + (v - 0.5) * k) * H;
  return out;
}

// v1's flagFlight: how a flag flies in a wind sample ({ vx, vz, speed } m/s, vx vz the air's travel): the fly's direction
// [fx, fz] (downwind), its droop below level (rad), the flutter's amplitude (× L) and frequency (Hz)
export function flagFlight(w, L = 2, out = { fx: 0, fz: 0, speed: 0, droop: 0, amp: 0, freq: 0 }) {
  const sp = Math.max(1e-6, w.speed ?? Math.hypot(w.vx, w.vz));
  const lift = smooth(SHORE_FLAGS.limpMs, SHORE_FLAGS.fullMs, sp);
  out.fx = w.vx / sp; out.fz = w.vz / sp; out.speed = sp;
  out.droop = (SHORE_FLAGS.droopMax * (1 - lift) + 4) * DEG;
  out.amp = 0.025 + 0.085 * smooth(0.5, 4, sp) - 0.03 * smooth(9, 16, sp);
  out.freq = Math.min(4, 0.55 * sp / L + 0.15);
  return out;
}

// v1's flagVertex: one vertex of the flown cloth (world): the hoist on the pole, the fly turned downwind and drooped, a wave
// running from the hoist to the fly
const sd = [0, 0];
export function flagVertex(site, fl, u, v, t, phase = 0, out = [0, 0, 0]) {
  const [s, d] = flagShape(site, u, v, sd);
  const c = Math.cos(fl.droop), sn = Math.sin(fl.droop);
  const ex = fl.fx * c, ey = -sn, ez = fl.fz * c;
  const nx = -fl.fz, nz = fl.fx;
  const lam = 0.85 * site.L;
  const w = fl.amp * site.L * Math.pow(u, 1.3) * Math.sin(2 * Math.PI * (s / lam - fl.freq * t) + phase + 0.6 * v);
  const top = site.y + site.h - 0.05;
  out[0] = site.x + ex * s + nx * w; out[1] = top - d + ey * s; out[2] = site.z + ez * s + nz * w;
  return out;
}

// the flags' state and their cloth: v1's createShoreFlags.update without three (its eased flight, the 5 Hz staggered samples,
// the vertices, the smooth normals three's computeVertexNormals makes from the strip's triangles)
export function createShoreFlagsSim({ sites, wind, seed = 1 }) {
  const F = SHORE_FLAGS, nu = F.segU + 1, nv = F.segV + 1, per = nu * nv;
  const state = sites.map((s, k) => ({ fl: null, target: { fx: 0, fz: 0, speed: 0, droop: 0, amp: 0, freq: 0 }, has: false, next: -1, phase: (k * 2.39 + seed * 0.7) % (2 * Math.PI) }));
  // the strip's triangles, as v1's index (a, c, b), (b, c, d) a quad
  const tris = [];
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) { const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1; tris.push(a, c, b, b, c, d); }
  const index = Uint16Array.from(sites.flatMap((_, k) => tris.map((x) => x + k * per)));
  const positions = new Float32Array(sites.length * per * 3), normals = new Float32Array(sites.length * per * 3);
  const P = [0, 0, 0];
  let prevT = null, samples = 0;
  function update(windT, waveT = windT) {
    const dt = prevT == null ? 1e3 : Math.max(0, Math.min(1, windT - prevT)); prevT = windT;
    const k = 1 - Math.exp(-dt / F.tauS);
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i], st = state[i];
      if (!st.has || windT >= st.next || windT < st.next - 2 / F.sampleHz) { flagFlight(wind.sample(s.x, s.z, windT), s.L, st.target); st.has = true; st.next = windT + 1 / F.sampleHz + i * 0.031; samples++; }
      const T = st.target;
      if (!st.fl) st.fl = { ...T };
      else {
        const f = st.fl;
        let fx = f.fx + (T.fx - f.fx) * k, fz = f.fz + (T.fz - f.fz) * k; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        f.fx = fx; f.fz = fz; f.speed += (T.speed - f.speed) * k; f.droop += (T.droop - f.droop) * k; f.amp += (T.amp - f.amp) * k; f.freq += (T.freq - f.freq) * k;
      }
      for (let j = 0; j < nv; j++) for (let u = 0; u < nu; u++) {
        flagVertex(s, st.fl, u / F.segU, j / F.segV, waveT, st.phase, P);
        const o = (i * per + j * nu + u) * 3; positions[o] = P[0]; positions[o + 1] = P[1]; positions[o + 2] = P[2];
      }
    }
    // three's computeVertexNormals: each triangle's (c − b) × (a − b) added to its corners, then normalised
    normals.fill(0);
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
      const cbx = positions[c] - positions[b], cby = positions[c + 1] - positions[b + 1], cbz = positions[c + 2] - positions[b + 2];
      const abx = positions[a] - positions[b], aby = positions[a + 1] - positions[b + 1], abz = positions[a + 2] - positions[b + 2];
      const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx;
      normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz; normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz;
      normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz;
    }
    for (let q = 0; q < normals.length; q += 3) { const l = Math.hypot(normals[q], normals[q + 1], normals[q + 2]) || 1; normals[q] /= l; normals[q + 1] /= l; normals[q + 2] /= l; }
    return positions;
  }
  return { update, sites, positions, normals, index, per, flight: (i) => state[i]?.fl ?? null, get samples() { return samples; } };
}
