// The terrain's CPU height query: the JS twin of the WGSL `terrainHeight` in v2/render/terrain.js, line for line, over
// the same slot state (the grids the GPU holds right now). With every full grid in, it is v1's
// src/sim/terrain-data.js makeSampler().height (v1's terrain.heightAt): the same finest-first walk, the clamped bilinear
// and the BLEND-texel smoothstep into the next coarser level (v2/tests/terrain-sample.test.mjs checks it against v1 at
// thousands of points; the GPU probe in main.js checks the WGSL against this twin in the browser).
//   const T = createHeightField({ offset, step });   T.setSlot(k, grid, codes); T.height(x, z); T.spacing(x, z)
import { SLOTS, BLEND } from './levels.js';

export function createHeightField(H = { offset: -600, step: 0.05 }) {
  const n = SLOTS.length;
  const X0 = new Float64Array(n), Z0 = new Float64Array(n), ST = new Float64Array(n), IS = new Float64Array(n);
  const W = new Int32Array(n), Hh = new Int32Array(n), G = new Array(n).fill(null), VAR = new Array(n).fill(null);
  let last = -1;   // the coarsest slot that holds a grid: it answers everywhere (clamped), as v1's last level

  function bil(g, w, h, fx, fz) {
    if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
    if (fz < 0) fz = 0; else if (fz > h - 1) fz = h - 1;
    let i = fx | 0, j = fz | 0;
    if (i > w - 2) i = w - 2; if (j > h - 2) j = h - 2;
    const u = fx - i, v = fz - j, k = j * w + i;
    const a = g[k], b = g[k + 1], c = g[k + w], d = g[k + w + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  return {
    // put a grid ({ x0, z0, step, w, h, variant }) and its decoded codes into slot k (SLOTS order)
    setSlot(k, grid, codes) {
      X0[k] = grid.x0; Z0[k] = grid.z0; ST[k] = grid.step; IS[k] = 1 / grid.step; W[k] = grid.w; Hh[k] = grid.h; G[k] = codes; VAR[k] = grid.variant ?? null;
      last = -1; for (let s = n - 1; s >= 0; s--) if (G[s]) { last = s; break; }
    },
    slot: (k) => (G[k] ? { x0: X0[k], z0: Z0[k], step: ST[k], w: W[k], h: Hh[k], variant: VAR[k] } : null),
    get ready() { return last >= 0; },
    height(x, z) {
      let acc = 0, left = 1;
      for (let k = 0; k <= last; k++) {
        if (!G[k]) continue;
        const fx = (x - X0[k]) * IS[k], fz = (z - Z0[k]) * IS[k], w = W[k], h = Hh[k];
        const m = Math.min(fx, fz, w - 1 - fx, h - 1 - fz);
        if (m <= 0 && k < last) continue;
        const v = H.offset + H.step * bil(G[k], w, h, fx, fz);
        if (m >= BLEND || k === last) return acc + left * v;
        const t = m / BLEND, s = t * t * (3 - 2 * t);
        acc += left * s * v; left *= 1 - s;
      }
      return acc;
    },
    // the finest held grid's spacing at (x, z) (v1's spacing): the scale slopes and normals are taken at
    spacing(x, z) {
      for (let k = 0; k <= last; k++) {
        if (!G[k]) continue;
        const fx = (x - X0[k]) * IS[k], fz = (z - Z0[k]) * IS[k];
        if (Math.min(fx, fz, W[k] - 1 - fx, Hh[k] - 1 - fz) > 1) return ST[k];
      }
      return last >= 0 ? ST[last] : 1;
    },
  };
}
