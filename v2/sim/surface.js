// The water surface on the CPU, for the boat (M3) and anything that must sit on the water: the same bytes the GPU
// draws, read back as a window of each displacement cascade (64 × 64 texels round the grid's centre for the 600 and
// 85 m tiles: 150 m and 21 m squares; the whole 256² tile for the 12 m cascade, whose tile-break warp of ± 3.5 m is
// wider than any window), bilinear, with the choppy horizontal map inverted by fixed-point iteration (v1's
// src/waters/ultra/surface.js shape, ours). Pure: no GPU here; the test feeds synthetic windows.
//   const S = createSurface();  S.adopt(view, meta)  (the readback ring's callback)  S.heightAt(x, z, { t }) → m
//   S.displacementAt(x, z, out)  → out = [λDx, Dy, λDz] at the undisplaced point (x, z)
//   S.velocityAt(x, z, opts, out) → [vx, vz] the waves' orbital velocity (v1's)
// #21 (2026-11-14): v1's recipe for the hull, kept with the last two reads as v1's: the newest read carried forward along
// their trend (heightAt's t), the orbital velocity between them, and the drawn surface's per-point gains (setGains: v1's
// shallow-water calming and #25's sea across the lake, render/water.js seaField's CPU twin).
// Layout: cascade c's window starts at OFFSETS[c] texels, WINS[c] texels a side, texel (wx, wz) at (wz·W + wx)·4
// floats: (λDx, Dy, λDz, turbulence); the window's texel origin on axis u is ox = floor(centre_u / L · N) − W / 2
// (0 for a whole tile), wrapped mod N on use: the same formula the WGSL uses, so both sides agree on the texels.
export const N = 256, LENGTHS = Object.freeze([600, 85, 12]);
export const WINS = Object.freeze([64, 64, 256]);
export const OFFSETS = Object.freeze([0, 64 * 64, 2 * 64 * 64]);   // texels
// the whole 600 and 85 m tiles at half resolution (fix/v2-rival-float, 2026-11-18): every other texel of each axis (a point sample:
// the 600 m tile carries waves over 14.2 m, the 85 m tile 2.1-14.2 m, spectrum.js CUTS, so 128 texels a side keep 3 or more a wave),
// after the 12 m tile. The 21 m window of the 85 m tile covers the player's hull only: a rival a few lengths off read none of the
// sea she sails in (the rivals' float, regatta/rivalFloat.js, reads these: heightAt's { coarse: true })
export const COARSE_N = 128, COARSE_C = 2;
export const COARSE_OFFSETS = Object.freeze([OFFSETS[2] + 256 * 256, OFFSETS[2] + 256 * 256 + COARSE_N * COARSE_N]);   // texels
export const WINDOW_TEXELS = OFFSETS[2] + 256 * 256 + COARSE_C * COARSE_N * COARSE_N;
export const WINDOW_FLOATS = WINDOW_TEXELS * 4;                     // 425 984 floats, 1.70 MB a readback (1.18 MB before the whole tiles)
export const WIN = WINS[0];
export const WARP = Object.freeze({ a1: 2.5, a2: 1.0 });
// the Smith effect's wavenumber per tile (v1's SMITH_K: the lake's 40, 6, 1 m bands; the bay sim's 4 m sea), rad/m
export const SMITH_K = Object.freeze([2 * Math.PI / 40, 2 * Math.PI / 6, 2 * Math.PI / 1]), SMITH_K_BAY = 2 * Math.PI / 4;   // the tile break of cascades 1 and 2 (v1's warpAt): a few metres, gradient ≈ 0.2

export const windowOrigin = (centre, L, n = N, win = WIN) => (win >= n ? 0 : Math.floor(centre / L * n) - win / 2);
export function warpAt(x, z) {
  return [WARP.a1 * Math.sin(0.0419 * z + 0.0113 * x + 1.3) + WARP.a2 * Math.sin(0.113 * x - 0.071 * z + 0.7),
    WARP.a1 * Math.sin(0.0377 * x - 0.0097 * z + 0.4) + WARP.a2 * Math.sin(0.097 * z + 0.083 * x + 2.1)];
}

// v1's shallow-water calming (src/sim/waters/ultra/surface.js cascadeDamp, the shader's ultraDamp): the long swell (the 600 m
// tile) dies between 14 and 2 m of water, the chop (the 85, 12 and 2.1 m tiles) between 2 and −0.4 m. depth: water depth, m
import { smooth } from '../../src/sim/core/math.js';
export const DAMP = Object.freeze({ swell: Object.freeze([2, 14]), chop: Object.freeze([-0.4, 2]) });
export function cascadeDamp(depth, out = [0, 0, 0]) {
  const swell = smooth(DAMP.swell[0], DAMP.swell[1], depth), chop = smooth(DAMP.chop[0], DAMP.chop[1], depth);
  out[0] = swell; out[1] = chop; out[2] = chop;
  return out;
}
// the readback carried forward (v1's surface.js heightAt): the newest read moved along the last two reads' trend to the time
// asked, at most this far (s); a frozen clock (a capture's settle: both reads at one time) gives the newest read
export const CARRY_MAX_S = 0.1;
// the hull's share of the 12 m tile (weightsFor): 0, as v1's read-back (it never carries the 12 m tiles to the CPU)
export const HULL_TILE12 = 0;

export function createSurface({ lengths = LENGTHS, n = N, wins = WINS, offsets = OFFSETS, coarseOffsets = COARSE_OFFSETS } = {}) {
  const C = lengths.length;
  // the last two reads (v1 keeps two: the carry-forward and the orbital velocity), each with its window's origin and its
  // time; allocated once, the newer swapped in on adopt
  const fields = [new Float32Array(WINDOW_FLOATS), new Float32Array(WINDOW_FLOATS)];
  const origins = [new Int32Array(C * 2), new Int32Array(C * 2)];   // ox, oz per cascade (texels, unwrapped)
  const times = [0, 0];
  let cur = 0, adopted = 0;
  const tmp = [0, 0, 0];
  const wrap = (v) => v - Math.floor(v);
  // meta: { cx, cz, t } or a Float64Array [cx, cz, t] (the ring's per-slot record)
  function adopt(view, meta) {
    cur ^= 1;
    const field = fields[cur], origin = origins[cur];
    field.set(view.subarray(0, field.length));
    const cx = meta?.cx ?? meta?.[0] ?? 0, cz = meta?.cz ?? meta?.[1] ?? 0;
    times[cur] = meta?.t ?? meta?.[2] ?? 0;
    for (let c = 0; c < C; c++) { origin[c * 2] = windowOrigin(cx, lengths[c], n, wins[c]); origin[c * 2 + 1] = windowOrigin(cz, lengths[c], n, wins[c]); }
    adopted++;
  }
  // the displacement of cascade c at the undisplaced (x, z) in read k (the newest by default); zero outside the window. coarse: the
  // whole tile at half resolution (cascades 0 and 1: every point on the lake, the same everywhere, no window edge)
  function sampleDisp(c, x, z, out, k = cur, coarse = false) {
    if (c > 0) {
      const wx = WARP.a1 * Math.sin(0.0419 * z + 0.0113 * x + 1.3) + WARP.a2 * Math.sin(0.113 * x - 0.071 * z + 0.7);
      const wz = WARP.a1 * Math.sin(0.0377 * x - 0.0097 * z + 0.4) + WARP.a2 * Math.sin(0.097 * z + 0.083 * x + 2.1);
      x += wx; z += wz;
    }
    const field = fields[k], origin = origins[k];
    if (coarse && c < COARSE_C && coarseOffsets) {
      // coarse texel j holds tile texel 2j (centred at (2j + 0.5) / n of the tile): bilinear over the wrapped half-resolution tile
      const L = lengths[c], m = n >> 1, fx = (x / L - Math.floor(x / L)) * m - 0.25, fz = (z / L - Math.floor(z / L)) * m - 0.25;
      const i0 = Math.floor(fx), j0 = Math.floor(fz), u = fx - i0, v = fz - j0;
      const a = ((i0 % m) + m) % m, b = (a + 1) % m, p = ((j0 % m) + m) % m, q = (p + 1) % m, base = coarseOffsets[c] * 4;
      const A = base + (p * m + a) * 4, B = base + (p * m + b) * 4, Cc = base + (q * m + a) * 4, D = base + (q * m + b) * 4;
      for (let r = 0; r < 3; r++) out[r] = (field[A + r] * (1 - u) + field[B + r] * u) * (1 - v) + (field[Cc + r] * (1 - u) + field[D + r] * u) * v;
      return true;
    }
    const L = lengths[c], win = wins[c], fx = wrap(x / L) * n - 0.5, fz = wrap(z / L) * n - 0.5;
    const i0 = Math.floor(fx), j0 = Math.floor(fz), u = fx - i0, v = fz - j0;
    const ox = origin[c * 2], oz = origin[c * 2 + 1];
    const i0w = (((i0 - ox) % n) + n) % n, i1w = (((i0 + 1 - ox) % n) + n) % n, j0w = (((j0 - oz) % n) + n) % n, j1w = (((j0 + 1 - oz) % n) + n) % n;
    const ok00 = i0w < win && j0w < win, ok10 = i1w < win && j0w < win, ok01 = i0w < win && j1w < win, ok11 = i1w < win && j1w < win;
    if (!(ok00 || ok11)) { out[0] = out[1] = out[2] = 0; return false; }
    const base = offsets[c] * 4, a11 = base + (j1w * win + i1w) * 4;
    const A = ok00 ? base + (j0w * win + i0w) * 4 : a11, B = ok10 ? base + (j0w * win + i1w) * 4 : A, Cc = ok01 ? base + (j1w * win + i0w) * 4 : A, D = ok11 ? a11 : A;
    for (let q = 0; q < 3; q++) out[q] = (field[A + q] * (1 - u) + field[B + q] * u) * (1 - v) + (field[Cc + q] * (1 - u) + field[D + q] * u) * v;
    return true;
  }
  const ONE = new Float64Array(C).fill(1), wNow = new Float64Array(C), wPt = new Float64Array(C);
  function displacementAt(x, z, out, w = ONE, k = cur, coarse = false) {
    out[0] = out[1] = out[2] = 0;
    for (let c = 0; c < C; c++) { if (!(w[c] > 0)) continue; sampleDisp(c, x, z, tmp, k, coarse); out[0] += tmp[0] * w[c]; out[1] += tmp[1] * w[c]; out[2] += tmp[2] * w[c]; }
    return out;
  }
  // the hull's view of the sea (v1's src/sim/waters/ultra/surface.js weights, the float's opts): depthM, the Smith effect (a wave
  // of number k pushes a hull of that draft by e^(−k d): one k per tile, the band's typical wave: the lake's 40, 6 and 1 m, the
  // bay sim's 4 m); filterM, waves shorter than a hull do not lift it (the lake's 12 m tile fades over 0.5 to 2 m, the bay's
  // 85 m tile over 0.5 to 6.5 m; v1 never reads the bay's 12 m tile on the CPU). v2's tiles carry both sims (spectrum.js
  // composeSea), so each tile's weight is the rms of the two rules by the bay's energy share there (setBayShares).
  const bayShare = new Float64Array(C);
  function setBayShares(a) { for (let c = 0; c < C; c++) bayShare[c] = a?.[c] ?? 0; }
  // #21 (2026-11-14): v1's GPU read-back carries the 600 m tile and the two 85 m tiles only (src/waters/ultra/gpuBridge.js
  // pushWindow: layers 0, 1 and 4), so v1's hull never feels the 12 m tiles, the lake's or the bay's; v2's hull read them at
  // the Smith weight (the lake's 12 m tile × 0.14 at the canoe body's depth), and their slopes across the beam rolled her
  // 1.5 × v1's at level 4. HULL_TILE12 0: the hull's view drops the 12 m tile as v1's (the drawn surface keeps it)
  function weightsFor({ depthM = 0, filterM = 0 } = {}, out = wNow) {
    for (let c = 0; c < C; c++) {
      let wl = depthM > 0 ? Math.exp(-SMITH_K[c] * depthM) : 1, wb = c >= 2 ? 0 : depthM > 0 ? Math.exp(-SMITH_K_BAY * depthM) : 1;
      if (c === 2) wl *= HULL_TILE12 * Math.max(0, 1 - Math.max(0, filterM - 0.5) / 1.5);
      wb *= Math.max(0, 1 - Math.max(0, filterM - 0.5) / 6);
      const s = bayShare[c];
      out[c] = s > 0 ? Math.sqrt((1 - s) * wl * wl + s * wb * wb) : wl;
    }
    return out;
  }
  // the drawn surface's per-point gains (#21, #25: render/water.js seaField's CPU twin, v1's shallow-water calming and the sea's
  // size across the lake against the boat's own sea): gains(x, z, out) fills out[c] for each displacement cascade; none: every
  // gain 1 (the bare tiles, as the node tests feed them)
  let gains = null;
  function setGains(fn) { gains = typeof fn === 'function' ? fn : null; }
  const d = [0, 0, 0], e = [0, 0, 0];
  function weightsAt(x, z, o) {
    const hull = !!o && typeof o === 'object' && (o.depthM > 0 || o.filterM > 0);
    if (!gains) return hull ? weightsFor(o) : ONE;
    gains(x, z, wPt);
    if (hull) { weightsFor(o); for (let c = 0; c < C; c++) wPt[c] *= wNow[c]; }
    return wPt;
  }
  function heightIn(k, x, z, w, coarse = false) {
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { displacementAt(px, pz, d, w, k, coarse); px = x - d[0]; pz = z - d[2]; }
    displacementAt(px, pz, d, w, k, coarse);
    return d[1];
  }
  // the height of the drawn surface over the world point (x, z): the choppy map moves the water sideways, so find the
  // undisplaced point p with p + D_xz(p) = (x, z) by fixed-point iteration (3 rounds), then read Dy there. o: the hull's
  // filters ({ depthM, filterM }; none: the drawn surface) and t, the wave clock's time: the newest read carried forward
  // along the last two reads' trend to t (v1's, at most CARRY_MAX_S; no t: the newest read as it is). o.coarse: the 600 and 85 m
  // tiles from their whole half-resolution copies (any point on the lake; the rivals' hulls) instead of the window round the player
  function heightAt(x, z, o = null) {
    const w = weightsAt(x, z, o), co = !!(o && typeof o === 'object' && o.coarse);
    const h1 = heightIn(cur, x, z, w, co);
    const t = o && typeof o === 'object' ? o.t : null;
    if (t == null || adopted < 2) return h1;
    const span = times[cur] - times[cur ^ 1];
    if (!(span > 1e-3)) return h1;
    const dt = Math.max(-CARRY_MAX_S, Math.min(CARRY_MAX_S, t - times[cur]));
    if (Math.abs(dt) < 1e-4) return h1;
    return h1 + (h1 - heightIn(cur ^ 1, x, z, w, co)) / span * dt;
  }
  // the water's horizontal orbital velocity (m/s) at (x, z), v1's velocityAt: the time derivative of the choppy displacement
  // (λDx, λDz) at the rest point under (x, z) between the last two reads, with heightAt's weights (the hull feels the
  // Smith-reduced, filtered, calmed sea). The physics takes it as a current (src/sim/boat.js env.currentAt): on a crest the
  // boat is carried forward, in a trough back. out: [vx, vz]
  function velocityAt(x, z, o = null, out = [0, 0]) {
    out[0] = out[1] = 0;
    if (adopted < 2) return out;
    const span = times[cur] - times[cur ^ 1];
    if (!(span > 1e-3)) return out;
    const w = weightsAt(x, z, o);
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { displacementAt(px, pz, d, w, cur); px = x - d[0]; pz = z - d[2]; }
    displacementAt(px, pz, d, w, cur); displacementAt(px, pz, e, w, cur ^ 1);
    out[0] = (d[0] - e[0]) / span; out[1] = (d[2] - e[2]) / span;
    return out;
  }
  return { get field() { return fields[cur]; }, get origin() { return origins[cur]; }, lengths, wins, offsets, n, adopt, sampleDisp, displacementAt, heightAt, velocityAt, weightsFor, setBayShares, setGains,
    get t() { return times[cur]; }, get tPrev() { return times[cur ^ 1]; }, get adopted() { return adopted; } };
}
