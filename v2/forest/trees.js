// The forest's trees as meshes, built once at load on the CPU and photographed into the cards'
// atlas by render/forest.js (the bake draws them; nothing here touches the GPU). Plain JS, no DOM: the node tests read it.
// A tree is put together, not carved: a stem, some ninety boughs in tiers, and on every bough a sheet of twigs whose
// needles the bake cuts out per pixel (render/forest.js TREE_CUT_WGSL), so every outline ends in a fringe of needles,
// with sky through the gaps between the tiers. Summer at Tahoe: no snow on any bough.
//   fir (white, red) and cedar: flat sprays with hanging curtains of branchlets under each bough (the cedar's sprays
//   are fans turned up on edge); the pines (Jeffrey, lodgepole): bare boughs with tufts of long needles at their tips,
//   the lodgepole's twigs brushy along the outer part; the snag: a bleached stem with broken stubs; the manzanita: a
//   mound of leaf sheets on red stems.
// Ported with changes from Cold Smoke (src/14_trees.js: env(), boughs(), build(); commit eaf635c,
// https://github.com/huiskylabs/cold-smoke): the snow pillows dropped, v1's seven species in its terms, the cards'
// unit frame (height 1), the pine tufts and the shrub ours. Cold Smoke's notice, as its licence asks:
//   MIT License. Copyright (c) 2026 Huisky.
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
//   documentation files (the "Software"), to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
//   permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright
//   notice and this permission notice shall be included in all copies or substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
//   WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// A vertex, FL = 14 floats: pos (unit frame: metres / H, y up, the stem's foot at 0) | normal | kind (1 spray, 2 curtain,
// 3 bark, 4 tuft, 5 leaf), the light the tree keeps from its own crown (ao), open sky overhead, a seed (the bough) |
// a, b, c (sprays and curtains: metres along, metres across or down, 0..1 to the ragged edge; tufts and leaves: metres
// across the sheet in two axes, 0..1 out to the rim; bark: metres round, metres up) | the sheet's pattern scale.

export const FL = 14;
export const KIND = Object.freeze({ spray: 1, curtain: 2, bark: 3, tuft: 4, leaf: 5 });
const PI = Math.PI, TAU = 2 * Math.PI;
import { clampT as clamp } from '../../src/sim/core/math.js';
const sat = (x) => clamp(x, 0, 1);
import { lerp } from '../../src/sim/core/math.js';
import { smooth } from '../../src/sim/core/math.js';
// mulberry32 (Cold Smoke's RNG): a tree is the same tree on every load
export function RNG(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// a bough seen from above: 0 at the stem and at the tip, 1 at its widest (Cold Smoke's env)
export const env = (t) => Math.sqrt(Math.max(0, 5.07 * t * (1 - t) * (1 - 0.45 * t)));

// The species, in Cold Smoke's terms, a layer each (render/forest.js SHAPES keeps the same order): H the model height
// (m: the needle pattern is in metres); K tiers from y0 to y1 (fractions of H); the crown's radius R0 at the foot
// (fraction of H) and its taper pw; boughs a tier m0 → m1; droop d0 → d1 (the tip's drop over the bough's length: a
// negative droop turns the tip up); up: a last upturn at the tip (fraction of L); bare: the chance a bough is missing;
// jit: tier spacing jitter (fraction of the spacing); Lk: the bough length over the crown radius (lo, hi); W: spray width
// over L; foliage: 'fir' (sprays + curtains), 'cedar' (fans on edge), 'pine' (bare boughs, tufts), 'brush' (the
// lodgepole: brushy sprays on the outer part + a tuft), 'snag', 'shrub'; cur: curtain depth scale; txs: the needle
// pattern's scale (1 = Cold Smoke's 0.115 m between branchlets; more is finer); tuft: [radius m lo, hi, count lo, hi].
// T1: the firs' real taper (a wide skirt, a narrow spire: pw 1.15–1.35), fewer and more irregular tiers
// (bough length 0.45–1.2 of the crown radius), the Jeffrey pine's open crown (about 30 % of its boughs missing); and
// two more trees for each of the three main species (layers 7–12, `of` names the species: its colours and its data
// layer): a young spire and an old, irregular crown (the old pine flat-topped). render/forest.js picks one of the three
// per tree from its seed and the lidar's crown width (VARIANTS below).
export const SPECIES = Object.freeze([
  { id: 'pine', H: 22, K: 15, y0: 0.40, y1: 0.95, R0: 0.19, pw: 0.62, m0: 6.0, m1: 4.0, d0: 0.35, d1: -0.10, up: 0.0, bare: 0.30, jit: 0.35, Lk: [0.45, 1.2], W: 0.30, foliage: 'pine', rise: [0.18, 0.32], tuft: [0.42, 0.62, 5, 8], seed: 101 },
  { id: 'lodgepole', H: 16, K: 16, y0: 0.45, y1: 0.97, R0: 0.12, pw: 0.80, m0: 5.0, m1: 3.5, d0: 0.25, d1: 0.05, up: 0.0, bare: 0.12, jit: 0.15, Lk: [0.55, 1.05], W: 0.34, foliage: 'brush', rise: [0.10, 0.22], tuft: [0.16, 0.24, 1, 2], txs: 1.45, seed: 211 },
  { id: 'whitefir', H: 24, K: 19, y0: 0.05, y1: 0.96, R0: 0.20, pw: 1.10, m0: 6.0, m1: 3.5, d0: 0.42, d1: 0.10, up: 0.06, bare: 0.06, jit: 0.22, Lk: [0.45, 1.2], W: 0.32, foliage: 'fir', cur: 0.7, rise: [0.08, 0.20], seed: 307 },
  { id: 'redfir', H: 26, K: 22, y0: 0.07, y1: 0.96, R0: 0.175, pw: 1.15, m0: 6.0, m1: 3.5, d0: 0.55, d1: 0.15, up: 0.08, bare: 0.05, jit: 0.22, Lk: [0.45, 1.2], W: 0.28, foliage: 'fir', cur: 1.0, rise: [0.10, 0.24], seed: 401 },
  { id: 'cedar', H: 20, K: 18, y0: 0.05, y1: 0.96, R0: 0.19, pw: 0.95, m0: 6.0, m1: 4.0, d0: 0.18, d1: -0.05, up: 0.10, bare: 0.05, jit: 0.15, Lk: [0.60, 1.05], W: 0.40, foliage: 'cedar', cur: 0.45, rise: [0.10, 0.24], txs: 1.25, seed: 503 },
  { id: 'snag', H: 14, K: 9, y0: 0.36, y1: 0.84, R0: 0.06, pw: 0.6, m0: 2.2, m1: 1.4, d0: 0.20, d1: 0.08, up: 0.0, bare: 0.30, jit: 0.25, Lk: [0.4, 1.2], W: 0, foliage: 'snag', rise: [0.05, 0.25], top: 0.88, seed: 601 },
  { id: 'shrub', H: 1.2, foliage: 'shrub', seed: 701 },
  // the variants (T1)
  { id: 'pine-young', of: 'pine', H: 15, K: 15, y0: 0.24, y1: 0.97, R0: 0.18, pw: 0.95, m0: 5.0, m1: 3.5, d0: 0.25, d1: -0.05, up: 0.0, bare: 0.14, jit: 0.25, Lk: [0.5, 1.15], W: 0.30, foliage: 'pine', rise: [0.16, 0.30], tuft: [0.34, 0.50, 4, 7], seed: 113 },
  { id: 'pine-old', of: 'pine', H: 30, K: 13, y0: 0.45, y1: 0.93, R0: 0.22, pw: 0.45, m0: 5.5, m1: 4.5, d0: 0.40, d1: 0.05, up: 0.0, bare: 0.26, jit: 0.45, Lk: [0.40, 1.2], W: 0.30, foliage: 'pine', rise: [0.10, 0.26], tuft: [0.50, 0.72, 6, 9], top: 0.955, seed: 131 },
  { id: 'whitefir-young', of: 'whitefir', H: 14, K: 16, y0: 0.03, y1: 0.97, R0: 0.17, pw: 1.35, m0: 5.0, m1: 3.0, d0: 0.30, d1: 0.06, up: 0.08, bare: 0.04, jit: 0.18, Lk: [0.5, 1.15], W: 0.34, foliage: 'fir', cur: 0.55, rise: [0.10, 0.22], seed: 313 },
  { id: 'whitefir-old', of: 'whitefir', H: 36, K: 20, y0: 0.08, y1: 0.95, R0: 0.25, pw: 1.10, m0: 6.0, m1: 3.5, d0: 0.50, d1: 0.12, up: 0.05, bare: 0.12, jit: 0.30, Lk: [0.40, 1.2], W: 0.30, foliage: 'fir', cur: 0.85, rise: [0.06, 0.18], seed: 337 },
  { id: 'redfir-young', of: 'redfir', H: 15, K: 18, y0: 0.04, y1: 0.97, R0: 0.15, pw: 1.35, m0: 5.0, m1: 3.0, d0: 0.40, d1: 0.10, up: 0.10, bare: 0.03, jit: 0.18, Lk: [0.5, 1.15], W: 0.30, foliage: 'fir', cur: 0.8, rise: [0.10, 0.24], seed: 409 },
  { id: 'redfir-old', of: 'redfir', H: 38, K: 22, y0: 0.10, y1: 0.95, R0: 0.225, pw: 1.12, m0: 6.0, m1: 3.5, d0: 0.60, d1: 0.18, up: 0.06, bare: 0.10, jit: 0.30, Lk: [0.40, 1.2], W: 0.28, foliage: 'fir', cur: 1.1, rise: [0.08, 0.20], seed: 433 },
]);
// the species' data layer of every tree (v2/forest/format.js LAYERS: 0–6; a variant its species')
export const SPECIES_LAYER = Object.freeze(SPECIES.map((s, l) => (s.of ? SPECIES.findIndex((x) => x.id === s.of) : l)));
// T1: the per-tree pick among a species' trees (render/forest.js CARD_DRAW_WGSL mirrors pickVariant): the lidar's crown
// width over the height q (1.35 r / h) placed between q0 and q1 gives w in 0..1; a tree's hash u spreads it ± 0.6; then
// thirds: young, the species' own tree, old. Wide crowns lean old, narrow ones young, and every stand mixes all three.
export const VARIANTS = Object.freeze([
  { layer: 0, trees: [7, 0, 8], q0: 0.15, q1: 0.30 },
  { layer: 2, trees: [9, 2, 10], q0: 0.11, q1: 0.30 },
  { layer: 3, trees: [11, 3, 12], q0: 0.12, q1: 0.30 },
]);
export const VARIANT_SPREAD = 1.2;
export const VARIANT_SALT = 0x2545f491;   // the pick's hash: hash01(treeSeed ^ this), apart from the yaw's and the tint's
// the draw's per-tree hash, exact in JS (render/forest.js HASH_WGSL: treeSeed on the quarter-metre lattice; WGSL's round
// is half to even, and the data's positions sit on the half: so is this one's)
const hashU = (x) => { let h = x >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16; return h >>> 0; };
const roundEven = (v) => { const fl = Math.floor(v), d = v - fl; return d > 0.5 ? fl + 1 : d < 0.5 ? fl : (fl % 2 === 0 ? fl : fl + 1); };
export const treeSeed = (x, z) => hashU((Math.imul(roundEven(Math.fround(x) * 4) | 0, 73856093) ^ Math.imul(roundEven(Math.fround(z) * 4) | 0, 19349663)) >>> 0);
export const hash01 = (s) => (hashU(s) >>> 8) / 16777216;
export function pickVariant(layer, q, u) {
  const v = VARIANTS.find((x) => x.layer === layer);
  if (!v) return layer;
  const w = sat((q - v.q0) / (v.q1 - v.q0)), s = w + (u - 0.5) * VARIANT_SPREAD;
  return v.trees[s < 1 / 3 ? 0 : s < 2 / 3 ? 1 : 2];
}

// --- one tree: the boughs, then the mesh -------------------------------------------------------------------------
// shape: render/forest.js SHAPES' row for this layer (its frame half-width R, the trunk radius, the crown base cb)
export function buildTree(layer, shape) {
  const S = SPECIES[layer];
  if (S.foliage === 'shrub') return buildShrub(S, shape);
  const H = S.H, rnd = RNG(S.seed), out = new Mesh();
  const reach = (shape.R - 0.015) * H;   // nothing past the frame's half-width (less the stem's lean)
  const top = (S.top ?? 0.985) * H;
  const crown = (y) => S.R0 * H * Math.pow(Math.max(0.02, 1 - y / (1.015 * H)), S.pw) + 0.014 * H;
  const inCrown = (r, y) => smooth(0.25, 0.9, r / crown(y));
  const openAt = (y) => lerp(0.62, 1.0, sat(y / H));   // the tiers above take sky from the lower ones
  const txs = S.txs ?? 1;
  // the stem leans a little and bends back (Cold Smoke's axis): x(y), z(y) in metres
  const la = rnd() * TAU, lk = 0.012 * H * (0.5 + 0.5 * rnd()), lx = Math.cos(la) * lk, lz = Math.sin(la) * lk;
  const ka = la + 2 + rnd() * 2, kx = Math.cos(ka) * lk * 0.6, kz = Math.sin(ka) * lk * 0.6;
  const axis = (y) => { const q = clamp(y / H, 0, 1), s = Math.sin(q * PI); return [lx * q * q + kx * s * q, lz * q * q + kz * s * q]; };
  // the boughs (Cold Smoke's boughs(), without the snow's choices)
  const B = [];
  let clipped = 0;
  const dy =(S.y1 - S.y0) * H / Math.max(1, S.K - 1);
  for (let k = 0; k < S.K; k++) {
    const u = k / (S.K - 1);
    const y = (S.y0 + (S.y1 - S.y0) * Math.pow(u, 0.92)) * H + (k > 0 && k < S.K - 1 ? (rnd() - 0.5) * 2 * S.jit * dy : 0);
    const R = crown(y) * (0.92 + 0.16 * rnd()), Mn = Math.max(1, Math.round(lerp(S.m0, S.m1, u) + (rnd() - 0.5) * 0.9)), ph = k * 2.4 + rnd() * 0.8;
    for (let j = 0; j < Mn; j++) {
      const r1 = rnd(), r2 = rnd(), r3 = rnd(), r4 = rnd(), r5 = rnd(), r6 = rnd(), r7 = rnd(), r8 = rnd();
      if (r7 < S.bare) continue;
      const a = ph + (j + (r1 - 0.5) * 0.6) * TAU / Mn;
      let L = R * lerp(S.Lk[0], S.Lk[1], r2); if (r8 < 0.08) L *= 1.22; else if (r8 > 0.93) L *= 0.6;
      if (S.foliage === 'snag') L = (0.025 + 0.06 * r2) * H * (1.1 - u * 0.6);
      // T1: the crown's own taper bounds a bough (a long one reaches a third past it), not the card's frame: the frame
      // (render/forest.js SHAPES R) is sized to hold the whole crown, so the safety cut below binds on no bough (the
      // tests count `clipped`; the old frame cut every lower fir bough to one length: a column)
      L = Math.min(L, crown(y) * 1.32);
      if (L > reach / 1.09) { L = reach / 1.09; clipped++; }
      const y0 = y + (r3 - 0.5) * 0.024 * H, rise = lerp(S.rise[0], S.rise[1], r4);
      let droop = lerp(S.d0, S.d1, u) * (0.8 + 0.45 * r5); droop = Math.min(droop, (y0 + 0.028 * H) / L);
      const W = Math.max(0.15, L * (S.W - 0.04 + 0.08 * r6)), cls = L >= 1.5 ? 0 : L >= 0.82 ? 1 : 2;
      B.push({ id: B.length, a, ca: Math.cos(a), sa: Math.sin(a), L, W, y0, rise, k2: (rise + droop) / L, up: S.up, cls, u, cur: 0.5 + 0.5 * rnd(), r: rnd() });
    }
  }
  // the leader: a few short boughs standing round the tip
  if (S.foliage !== 'snag') for (let j = 0; j < 3; j++) {
    const a = rnd() * TAU, L = (0.016 + 0.01 * rnd()) * H, y0 = top - (0.035 - 0.012 * j) * H;
    B.push({ id: B.length, a, ca: Math.cos(a), sa: Math.sin(a), L, W: Math.max(0.15, L * 0.34), y0, rise: 0.25, k2: 0.6 / L, up: 0, cls: 2, u: 1, cur: 0.3, r: rnd() });
  }
  // a point on a bough: metres along it (r) and across (z) → model metres
  const at = (b, r, y, z) => { const ax = axis(b.y0); return [ax[0] + r * b.ca - z * b.sa, y, ax[1] + r * b.sa + z * b.ca]; };
  const spineY = (b, t) => { const r = t * b.L; return b.y0 + b.rise * r - b.k2 * r * r + b.up * b.L * Math.pow(sat((t - 0.55) / 0.45), 2); };
  const spineG = (b, t) => { const r = t * b.L; return b.rise - 2 * b.k2 * r + b.up * 2 * sat((t - 0.55) / 0.45) / 0.45; };
  const put = (p, n, kind, ao, open, id, a, bb, c, sc) => out.put(p[0] / H, p[1] / H, p[2] / H, n[0], n[1], n[2], kind, ao, open, id, a, bb, c, sc);
  const rot = (b, n) => [n[0] * b.ca - n[2] * b.sa, n[1], n[0] * b.sa + n[2] * b.ca];   // a bough-frame vector (x along, z across) → model
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  for (const b of B) {
    const fol = S.foliage;
    // a spray of twigs along the bough (t0..t1 of its length), rolled about the bough's axis by `roll` (a cedar's fans)
    const spray = (t0, t1, Wk, roll = 0, sc = txs) => {
      const n = [7, 5, 3][b.cls], Ws = Wk * b.W, s0 = out.nv, sagK = 0.38 / b.W, cr = Math.cos(roll), sr = Math.sin(roll);
      for (let i = 0; i <= n; i++) {
        const t = t0 + (t1 - t0) * i / n, r = t * b.L, ys = spineY(b, t) - 0.03, g = spineG(b, t);
        const w = Ws * env(Math.min((t - t0) / (t1 - t0) / 1.06 * 1.0 + 0.0, 1)) * (t > 1 ? 0.5 : 1) + 0.07, q = inCrown(r, ys);
        for (let e = -1; e <= 1; e++) {
          const zz = e * w, sag = sagK * zz * zz * (e ? 1.15 : 1);
          // across the bough (z) and down (sag), rolled: z' = z cos − y sin, y' = z sin + y cos
          const zr = zz * cr + sag * sr, yr = zz * sr - sag * cr;
          const nn = norm(rot(b, [-g * cr, cr, 2 * sagK * zz * 1.15 * cr - sr]));
          put(at(b, r, ys + yr, zr), nn, KIND.spray, lerp(0.35, 0.8, q), lerp(0.15, 0.9, q) * openAt(ys), b.id, r, zz, Math.abs(e), sc);
        }
      }
      for (let i = 0; i < n; i++) for (let e = 0; e < 2; e++) { const a = s0 + i * 3 + e, c = a + 3; out.tri(a, a + 1, c); out.tri(a + 1, c + 1, c); }
    };
    // a curtain of branchlets hanging under the spine (what shows where a bough is seen from the side)
    const curtain = (t0, Dk) => {
      const n = [7, 5, 3][b.cls], c0 = out.nv, D = (0.16 + 0.20 * b.cur) * Math.sqrt(b.L) * Dk * (b.cls === 2 ? 0.8 : 1);
      for (let i = 0; i <= n; i++) {
        const t = t0 + (1.02 - t0) * i / n, r = t * b.L, ys = spineY(b, t) - 0.03, d = D * (0.35 + 0.65 * Math.sin(PI * Math.min(1, t * 0.9 + 0.08))), q = inCrown(r, ys);
        for (let e = 0; e < 2; e++) put(at(b, r, ys - e * d, 0), [-b.sa, 0, b.ca], KIND.curtain, lerp(0.3, 0.7, q), lerp(0.1, 0.5, q) * openAt(ys), b.id, r, e * d, e, txs);
      }
      for (let i = 0; i < n; i++) { const a = c0 + i * 2, c = a + 2; out.tri(a, a + 1, c); out.tri(a + 1, c + 1, c); }
      // and one hanging across a big bough (what shows when the bough points at the lens)
      if (b.cls < 2) {
        const t = 0.72, r = t * b.L, ys = spineY(b, t) - 0.03, w = 1.22 * b.W * env(t) * 0.95, Dc = (0.14 + 0.16 * b.cur) * Math.sqrt(b.L) * Dk, q = inCrown(r, ys), c1 = out.nv, sagK = 0.38 / b.W;
        for (let e = -1; e <= 1; e++) for (let k = 0; k < 2; k++) { const zz = e * w; put(at(b, r, ys - sagK * zz * zz - k * Dc * (e ? 0.7 : 1), zz), norm([b.ca, 0.3, b.sa]), KIND.curtain, lerp(0.3, 0.7, q), lerp(0.1, 0.5, q) * openAt(ys), b.id, zz + 7 + b.id, k * Dc, k, txs); }
        for (let e = 0; e < 2; e++) { const a = c1 + e * 2, c = a + 2; out.tri(a, a + 1, c); out.tri(a + 1, c + 1, c); }
      }
    };
    // a bare bough: a bark tube from the stem out to t1 (radius at the stem rb)
    const limb = (t1, rb) => {
      const n = 4, sides = 4, l0 = out.nv;
      for (let i = 0; i <= n; i++) {
        const t = t1 * i / n, r = t * b.L, ys = spineY(b, t), rad = rb * (1 - 0.7 * i / n);
        for (let k = 0; k <= sides; k++) { const an = k * TAU / sides, c = Math.cos(an), s = Math.sin(an); put(at(b, r, ys + c * rad, s * rad), rot(b, [0, c, s]), KIND.bark, 0.55, 0.45 * openAt(ys), b.id, an * rad, r, 0, 1); }
      }
      for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) { const a = l0 + i * (sides + 1) + k, c = a + sides + 1; out.tri(a, c, a + 1); out.tri(a + 1, c, c + 1); }
    };
    // a tuft of long needles: five sheets through one point, turned every way (a fibonacci set of normals, rolled by
    // the tuft's own seed); the normals lean out from the point, so a tuft shades as the little ball of needles it is
    const tuft = (p0, rt, seed) => {
      const p = [p0[0], Math.min(p0[1], top - rt * 1.1), p0[2]];   // (inside the frame's top)
      const tr = RNG(seed), q = inCrown(Math.hypot(p[0] - axis(p[1])[0], p[2] - axis(p[1])[1]), p[1]);
      const NSH = 5, roll = tr() * TAU;
      for (let s = 0; s < NSH; s++) {
        const zz = 1 - (2 * s + 1) / NSH, rr = Math.sqrt(1 - zz * zz), ph = s * 2.39996 + roll;
        const nrm = norm([rr * Math.cos(ph), zz * 0.8 + 0.2 * (tr() - 0.5), rr * Math.sin(ph)]);
        let u = norm([nrm[2], 0, -nrm[0]]); if (Math.hypot(nrm[0], nrm[2]) < 1e-3) u = [1, 0, 0];
        const w = norm([nrm[1] * u[2] - nrm[2] * u[1], nrm[2] * u[0] - nrm[0] * u[2], nrm[0] * u[1] - nrm[1] * u[0]]);
        const v0 = out.nv, rs = rt * (0.8 + 0.35 * tr());
        for (let c = 0; c < 4; c++) {
          const su = c & 1 ? 1 : -1, sv = c & 2 ? 1 : -1;
          const d = [u[0] * su + w[0] * sv, u[1] * su + w[1] * sv, u[2] * su + w[2] * sv];
          put([p[0] + d[0] * rs, p[1] + d[1] * rs, p[2] + d[2] * rs], norm([d[0] + nrm[0] * 0.7, d[1] + nrm[1] * 0.7 + 0.25, d[2] + nrm[2] * 0.7]), KIND.tuft, lerp(0.4, 0.85, q), lerp(0.2, 0.95, q) * openAt(p[1]), b.id * 7 + s + seed % 5, su * rs, sv * rs, rs, 1);
        }
        out.tri(v0, v0 + 1, v0 + 2); out.tri(v0 + 1, v0 + 3, v0 + 2);
      }
    };
    if (fol === 'fir') { spray(0.02, 1.09, 1.22); curtain(0.1, S.cur); }
    else if (fol === 'cedar') { spray(0.04, 1.06, 0.95, 0.85, txs); spray(0.04, 1.06, 0.95, -0.85, txs); curtain(0.2, S.cur); }
    else if (fol === 'brush') { limb(0.45, 0.012 * H * 0.35); spray(0.40, 1.06, 1.0, 0, txs); const nt = Math.round(lerp(S.tuft[2], S.tuft[3], b.r)); for (let k = 0; k < nt; k++) { const t = 1.0 - 0.18 * k, r = t * b.L; tuft(at(b, r, spineY(b, t) + 0.02, 0), lerp(S.tuft[0], S.tuft[1], RNG(b.id * 31 + k)()), b.id * 13 + k); } }
    else if (fol === 'pine') {
      limb(0.92, Math.min(0.006 * H, 0.035 + 0.025 * b.L) * (b.cls === 2 ? 0.6 : 1));
      const nt = b.cls === 2 ? 2 : Math.round(lerp(S.tuft[2], S.tuft[3], b.r));
      const tr = RNG(b.id * 977 + 5);
      for (let k = 0; k < nt; k++) {
        // tufts from 0.55 L to the tip, the side ones on short twigs off the bough
        const t = k === 0 ? 1.0 : lerp(0.40, 0.95, tr()), side = k === 0 ? 0 : (tr() - 0.5) * 0.7 * b.L * (1 - t + 0.3), r = t * b.L;
        const rt = lerp(S.tuft[0], S.tuft[1], tr()) * (b.cls === 2 ? 0.75 : 1) * (k === 0 ? 1.15 : 1);
        tuft(at(b, r, spineY(b, t) + rt * 0.25 + (tr() - 0.3) * 0.15, side), rt, b.id * 17 + k);
      }
    } else if (fol === 'snag') limb(1.0, 0.03 + 0.05 * b.L);
  }
  // the stem: bark, tapering to the leader (Cold Smoke's rings), a flare at the foot
  {
    const rings = 22, sides = 7, t0 = out.nv, r0 = shape.trunk * H * 0.55, cb = shape.cb * H;   // (the frame's trunk radius read thick on the cards: × 0.55)
    for (let i = 0; i < rings; i++) {
      const y = -0.05 * H + (top + 0.05 * H) * i / (rings - 1), ax = axis(y), q = sat(y / H);
      const rad = lerp(r0, S.foliage === 'snag' ? 0.35 * r0 : 0.1 * r0, sat(y / top)) * (y < 0.03 * H ? 1 + 0.5 * (0.03 * H - Math.max(y, -0.02 * H)) / (0.05 * H) : 1);
      const ao = S.foliage === 'snag' ? 0.9 : y < cb ? 0.8 : lerp(0.35, 0.8, q * q), open = S.foliage === 'snag' ? 0.8 : y < cb ? 0.55 : lerp(0.1, 0.7, q * q);
      for (let k = 0; k <= sides; k++) { const a = k * TAU / sides, c = Math.cos(a), s = Math.sin(a); out.put((ax[0] + c * rad) / H, y / H, (ax[1] + s * rad) / H, c * 0.995, 0.0998, s * 0.995, KIND.bark, ao, open, -1, a * rad, y, 0, 1); }
    }
    for (let i = 0; i < rings - 1; i++) for (let k = 0; k < sides; k++) { const a = t0 + i * (sides + 1) + k, c = a + sides + 1; out.tri(a, c, a + 1); out.tri(a + 1, c, c + 1); }
  }
  return out.finish({ layer, id: S.id, boughs: B.length, clipped });
}

// The manzanita: a mound of leaf sheets on red stems arching out from the middle, the low ones long and flat (a skirt on
// the ground), the high ones short (v1's tree-gen 'shrub' in sheets). Unit frame: height 1, radius 1 (SHAPES rho 1).
function buildShrub(S, shape) {
  const H = S.H, rnd = RNG(S.seed), out = new Mesh(), R = (shape.R - 0.08);
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const NS = 15, NL = 110;
  // the stems: bark tubes from near the foot, out and up along the mound
  for (let s = 0; s < NS; s++) {
    const a = s * 2.39996 + rnd() * 0.5, reachS = (0.45 + 0.4 * rnd()) * R, rise = 0.25 + 0.5 * rnd(), l0 = out.nv, n = 4, sides = 4, rad = (0.010 + 0.006 * rnd()) / H;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = Math.cos(a) * reachS * t, z = Math.sin(a) * reachS * t, y = rise * Math.sin(t * PI * 0.6) * (1 - 0.3 * t) + 0.02;
      for (let k = 0; k <= sides; k++) { const an = k * TAU / sides, c = Math.cos(an), sn = Math.sin(an); out.put(x - Math.sin(a) * c * rad, y + sn * rad, z + Math.cos(a) * c * rad, -Math.sin(a) * c, sn, Math.cos(a) * c, KIND.bark, 0.35, 0.2, s, an * rad * H, t * reachS * H, 0, 1); }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) { const q = l0 + i * (sides + 1) + k, c = q + sides + 1; out.tri(q, c, q + 1); out.tri(q + 1, c, c + 1); }
  }
  // the leaf sheets on the mound: an ellipsoid round (0, 0.3, 0), radii (0.92, 0.70, 0.92) of the frame, flattened at
  // the ground; sheets point out and up, the outer ones lit, the inner ones in the mound's shade
  for (let i = 0; i < NL; i++) {
    const a = i * 2.39996 + rnd() * 0.4, ph = Math.acos(1 - 1.05 * (i + 0.5) / NL) * (0.85 + 0.25 * rnd()), deep = 0.66 + 0.46 * rnd() * rnd();   // (a few sheets stand out of the mound: a ragged outline)
    const dir = [Math.cos(a) * Math.sin(ph), Math.cos(ph), Math.sin(a) * Math.sin(ph)];
    const c = [dir[0] * 0.82 * R * deep, Math.max(0.04, 0.26 + dir[1] * 0.60 * deep - 0.04), dir[2] * 0.82 * R * deep];
    const size = (0.17 + 0.10 * rnd()) * (1.2 - 0.5 * dir[1]);
    const n = norm([dir[0] * 0.8, dir[1] + 0.35, dir[2] * 0.8]);
    // two axes in the sheet's plane
    let u = norm([n[2], 0, -n[0]]); if (!isFinite(u[0]) || Math.hypot(u[0], u[2]) < 1e-3) u = [1, 0, 0];
    const w = norm([n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]);
    const tw = (rnd() - 0.5) * 1.2, cu = Math.cos(tw), su = Math.sin(tw);
    const U = [u[0] * cu + w[0] * su, u[1] * cu + w[1] * su, u[2] * cu + w[2] * su], Wv = [w[0] * cu - u[0] * su, w[1] * cu - u[1] * su, w[2] * cu - u[2] * su];
    const ao = 0.35 + 0.6 * smooth(0.55, 1.0, deep) * (0.55 + 0.45 * smooth(0.0, 0.5, c[1])), open = 0.25 + 0.75 * smooth(0.3, 1.0, dir[1] * deep);
    const v0 = out.nv;
    // a 3 × 3 grid, bowed: the middle a little proud, so the sheet is a cupped cluster, not a plate
    for (let j = 0; j <= 2; j++) for (let k = 0; k <= 2; k++) {
      const su2 = k - 1, sv2 = j - 1, bow = (1 - 0.5 * (su2 * su2 + sv2 * sv2)) * size * 0.25;
      const p = [c[0] + (U[0] * su2 + Wv[0] * sv2) * size + n[0] * bow, c[1] + (U[1] * su2 + Wv[1] * sv2) * size + n[1] * bow, Math.max(0, 0) + c[2] + (U[2] * su2 + Wv[2] * sv2) * size + n[2] * bow];
      p[1] = Math.max(p[1], 0.005);
      const nn = norm([n[0] + (U[0] * su2 + Wv[0] * sv2) * 0.45, n[1] + (U[1] * su2 + Wv[1] * sv2) * 0.45, n[2] + (U[2] * su2 + Wv[2] * sv2) * 0.45]);
      out.put(p[0], p[1], p[2], nn[0], nn[1], nn[2], KIND.leaf, ao, open, i, su2 * size * H, sv2 * size * H, Math.hypot(su2, sv2) / Math.SQRT2, 1);
    }
    for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) { const q = v0 + j * 3 + k; out.tri(q, q + 1, q + 3); out.tri(q + 1, q + 4, q + 3); }
  }
  return out.finish({ layer: 6, id: S.id, boughs: NL });
}

// a growing vertex/index list, packed into typed arrays at the end
class Mesh {
  constructor() { this.v = []; this.i = []; this.nv = 0; }
  put(...f) { for (let k = 0; k < FL; k++) this.v.push(f[k]); return this.nv++; }
  tri(a, b, c) { this.i.push(a, b, c); }
  finish(meta) {
    const V = Float32Array.from(this.v), I = Uint32Array.from(this.i);
    // the sheets' normals from their own triangles (area-weighted, on the side the builder gave): true by construction
    const acc = new Float64Array(this.nv * 3), sheet = (k) => k === KIND.spray || k === KIND.curtain;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * FL, b = I[t + 1] * FL, c = I[t + 2] * FL;
      if (!sheet(V[a + 6])) continue;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * V[a + 3] + ny * V[a + 4] + nz * V[a + 5] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const o of [I[t], I[t + 1], I[t + 2]]) { acc[o * 3] += nx; acc[o * 3 + 1] += ny; acc[o * 3 + 2] += nz; }
    }
    for (let k = 0; k < this.nv; k++) {
      const o = k * FL, l = Math.hypot(acc[k * 3], acc[k * 3 + 1], acc[k * 3 + 2]);
      if (sheet(V[o + 6]) && l > 1e-12) { V[o + 3] = acc[k * 3] / l; V[o + 4] = acc[k * 3 + 1] / l; V[o + 5] = acc[k * 3 + 2] / l; }
    }
    let reach = 0, top = -Infinity, bottom = Infinity;
    for (let k = 0; k < this.nv; k++) { const o = k * FL; reach = Math.max(reach, Math.hypot(V[o], V[o + 2])); top = Math.max(top, V[o + 1]); bottom = Math.min(bottom, V[o + 1]); }
    return { ...meta, V, I, nv: this.nv, ni: I.length, reach, top, bottom };
  }
}

// every tree, a layer each (render/forest.js calls it once at load; the node tests read the same meshes)
export function buildAll(shapes) { return shapes.map((sh, l) => buildTree(l, sh)); }
