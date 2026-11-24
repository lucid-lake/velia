// The Ultra surface on the CPU, pure JS (no three.js): what the boat, the marks and the buoys float on. It reads the same
// bytes the GPU samples (the bridge's read-back: 3 displacement layers of N x N x 4 floats, layer c = (lambda Dx, Dy,
// lambda Dz, turbulence)), bilinear, with the choppy horizontal map inverted by fixed-point iteration, and carries the
// newest read forward in time along the last two reads' trend, so the read-back's lag does not show as a boat floating
// above or below the drawn water. Tested in tests/ultra-surface.test.mjs.
export const N = 256;
export const LENGTHS = [600, 85, 12, 2.1, 85];   // 0..3: the lake sim's cascades; 4: the bay sim's 85 m tile (its 12 m one is not read on the CPU)

// Tile break: the 85, 12 and 2.1 m cascades are sampled through a smooth warp (a few metres, gradient about 0.2), so
// their repeats do not sit on a regular lattice (the 12 m tile showed as a moire at mid distance). Shader: water.js warpOf.
export const WARP = { a1: 2.5, a2: 1.0 };
export function warpAt(x, z) {
  return [WARP.a1 * Math.sin(0.0419 * z + 0.0113 * x + 1.3) + WARP.a2 * Math.sin(0.113 * x - 0.071 * z + 0.7),
    WARP.a1 * Math.sin(0.0377 * x - 0.0097 * z + 0.4) + WARP.a2 * Math.sin(0.097 * z + 0.083 * x + 2.1)];
}

import { smooth } from '../../core/math.js';
// The cascades' weight by water depth (m): the long swell dies in the shallows, the chop lives to the beach
// (Ultra-Water's cascadeDamp, the shore waves aside). Shared by the shader and the CPU surface.
export function cascadeDamp(depth) {
  const swell = smooth(2, 14, depth), chop = smooth(-0.4, 2, depth);
  return [swell, chop, chop];
}

// the typical wavenumber (rad/m) of each displacement cascade's band, for the Smith effect
const SMITH_K = [2 * Math.PI / 40, 2 * Math.PI / 6, 2 * Math.PI / 1, 0, 2 * Math.PI / 4];   // the bay sim's sea is short: 4 m

export function makeCpuSurface({ n = N, lengths = LENGTHS } = {}) {
  const layerLen = n * n * 4;
  const frame = { buf: null, t: 0, prev: null, tPrev: 0 }, dbg = { w: [1, 1, 1] };   // dbg.w: per-cascade gains (diagnostics)
  const wrap = (v) => v - Math.floor(v);
  const tmp = [0, 0, 0];
  function sampleDisp(buf, c, x, z, out) {
    if (c > 0) {   // warpAt, inline (no array per sample)
      const wx = WARP.a1 * Math.sin(0.0419 * z + 0.0113 * x + 1.3) + WARP.a2 * Math.sin(0.113 * x - 0.071 * z + 0.7);
      const wz = WARP.a1 * Math.sin(0.0377 * x - 0.0097 * z + 0.4) + WARP.a2 * Math.sin(0.097 * z + 0.083 * x + 2.1);
      x += wx; z += wz;
    }
    const L = lengths[c], fx = wrap(x / L) * n - 0.5, fz = wrap(z / L) * n - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz), u = fx - i0, v = fz - j0;
    if (buf.layers) {   // a read-back window round the boat (the GPU compute path): the field in a w x w square of texels; outside it, nothing
      const ly = buf.layers[c];
      if (!ly) { out[0] = out[1] = out[2] = 0; return; }
      // the window's texel of each corner, inline (no closures per sample)
      const W = ly.w, d = ly.data, ox = ly.ox, oz = ly.oz;
      const i0w = (((i0 - ox) % n) + n) % n, i1w = (((i0 + 1 - ox) % n) + n) % n, j0w = (((j0 - oz) % n) + n) % n, j1w = (((j0 + 1 - oz) % n) + n) % n;
      const ok00 = i0w < W && j0w < W, ok10 = i1w < W && j0w < W, ok01 = i0w < W && j1w < W, ok11 = i1w < W && j1w < W;
      // the four corners; a corner outside the window takes the nearest inside (the window is far larger than the hull)
      if (!(ok00 || ok11)) { out[0] = out[1] = out[2] = 0; return; }
      const a11 = (j1w * W + i1w) * 4;
      const A = ok00 ? (j0w * W + i0w) * 4 : a11, B = ok10 ? (j0w * W + i1w) * 4 : A, Cc = ok01 ? (j1w * W + i0w) * 4 : A, D = ok11 ? a11 : A;
      for (let k = 0; k < 3; k++) out[k] = (d[A + k] * (1 - u) + d[B + k] * u) * (1 - v) + (d[Cc + k] * (1 - u) + d[D + k] * u) * v;
      return;
    }
    const base = c * layerLen;
    const at = (i, j) => base + (((j % n) + n) % n * n + ((i % n) + n) % n) * 4;
    const a = at(i0, j0), b = at(i0 + 1, j0), cc = at(i0, j0 + 1), d = at(i0 + 1, j0 + 1);
    for (let k = 0; k < 3; k++) out[k] = (buf[a + k] * (1 - u) + buf[b + k] * u) * (1 - v) + (buf[cc + k] * (1 - u) + buf[d + k] * u) * v;
  }
  function displacement(buf, x, z, w, out) {
    out[0] = out[1] = out[2] = 0;
    for (let c = 0; c < 5; c++) {
      if (!(w[c] > 0)) continue;
      sampleDisp(buf, c, x, z, tmp);
      out[0] += tmp[0] * w[c]; out[1] += tmp[1] * w[c]; out[2] += tmp[2] * w[c];
    }
  }
  function heightAtBuf(buf, x, z, w) {
    const d = [0, 0, 0];
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { displacement(buf, px, pz, w, d); px = x - d[0]; pz = z - d[2]; }
    displacement(buf, px, pz, w, d);
    return d[1];
  }
  // push(buf, t): a read-back finished; t is the scene time the sim step was submitted at
  // pushWindow({ layers: { c: { w, ox, oz, data } } }, t): the GPU path's read-back (f32 windows of texels, origin ox, oz in texels)
  function pushWindow(win, t) { push(win, t); }
  function push(buf, t) { frame.prev = frame.buf; frame.tPrev = frame.t; frame.buf = buf; frame.t = t; }
  // heightAt(x, z, t, { filterM, depth, m }): the surface height (m) at world x, z at scene time t. The newest read carried
  // forward along the last two reads' trend (at most 0.1 s: a frozen clock, as in a capture's settle, gives the newest read).
  // filterM (m): waves shorter than a hull do not lift it (the 12 m cascade fades out over 0.5 to 2 m); depth (m): water
  // depth here; m: this point's fetch scale (the 600 m cascade follows m^3, the 85 m one m^1.6, steeper than the fetch law's height: the one sim peaks at the 25 km fetch's long waves, a bay's sea is short, 4 m, and the long waves must not roll the hull; the chop is saturated).
  function weights({ filterM = 0, depth = 99, m = 1, depthM = 0, bay = null, feel = 1 } = {}) {
    const dmp = cascadeDamp(depth), w = [dmp[0], dmp[1], dmp[2], 0, 0];
    // bay: { beta, sB }: the bay sim's share (0 on the lake) and its local size; it takes over the lake sim's 85 and 12 m cascades
    const beta = bay ? bay.beta : 0;
    w[0] *= m * m * m * dbg.w[0]; w[1] *= Math.pow(m, 1.6) * (1 - beta) * dbg.w[1]; w[2] *= (1 + 0.7 * (1 - Math.min(m, 1))) * (1 - beta) * dbg.w[2];
    if (beta > 0) w[4] = beta * bay.sB * dmp[1];
    // the sea-state gain (water.js SEA_FEEL): the waves made to be felt, the same on the GPU and here
    w[0] *= feel; w[1] *= feel; w[2] *= feel; w[4] *= feel;
    // the Smith effect (the pressure a hull of draft depthM feels from a wave of number k is e^(-k d)): one k per cascade, the
    // band's typical wave (40 m, 6 m, 1 m, the bay's 4 m); filterM (m): waves shorter than a hull do not lift it
    if (depthM > 0) for (let c = 0; c < 5; c++) if (c !== 3) w[c] *= Math.exp(-SMITH_K[c] * depthM);
    w[2] *= Math.max(0, 1 - Math.max(0, filterM - 0.5) / 1.5);
    w[4] *= Math.max(0, 1 - Math.max(0, filterM - 0.5) / 6);
    return w;
  }
  function heightAt(x, z, t, o = {}) {
    if (!frame.buf) return 0;
    const w = weights(o);
    const h1 = heightAtBuf(frame.buf, x, z, w);
    const span = frame.t - frame.tPrev;
    if (!frame.prev || !(span > 1e-3) || t == null) return h1;
    const dt = Math.max(-0.1, Math.min(0.1, t - frame.t));
    if (Math.abs(dt) < 1e-4) return h1;
    return h1 + (h1 - heightAtBuf(frame.prev, x, z, w)) / span * dt;
  }
  // velocityAt(x, z, t, opts): the horizontal velocity (m/s) of the water surface at the point, the waves' orbital motion: the
  // time derivative of the choppy displacement (lambda Dx, lambda Dz) at the rest point under (x, z), between the last two reads,
  // with the same weights as heightAt (the hull feels the Smith-reduced, filtered sea). The physics takes it as a current:
  // a boat on a crest is carried forward at a omega, in a trough back.
  function velocityAt(x, z, t, o = {}) {
    if (!frame.buf || !frame.prev) return [0, 0];
    const span = frame.t - frame.tPrev;
    if (!(span > 1e-3)) return [0, 0];
    const w = weights(o), d = [0, 0, 0], e = [0, 0, 0];
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { displacement(frame.buf, px, pz, w, d); px = x - d[0]; pz = z - d[2]; }
    displacement(frame.buf, px, pz, w, d); displacement(frame.prev, px, pz, w, e);
    return [(d[0] - e[0]) / span, (d[2] - e[2]) / span];
  }
  return { frame, dbg, push, pushWindow, velocityAt, heightAt, sampleDisp: (x, z, c) => { const o = [0, 0, 0]; sampleDisp(frame.buf, c, x, z, o); return o; }, layerLen };
}
