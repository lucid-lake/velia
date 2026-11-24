// T3: the far forest as a canopy layer on the terrain, after Bruneton & Neyret 2012 (far trees as a terrain
// shader layer: the paper's idea only, no code). Plain JS, no DOM: render/canopy.js (the GPU's splat, the same arithmetic)
// and the node tests share it.
//
// At load and at every grid swap the GPU splats every tree the forest holds (the lidar's real crowns in the bay box, the
// rules' trees round it: the same records the cards draw) into a world grid over the rules' region: each crown's disc
// (CROWN_K × its radius, the cards' own width) spread over the texels it touches (a tent weight, normalised to the disc's
// area), summed (cover), and its height kept as the texel's top (max). Then two resolve passes: the summed cover turned
// into the share of the ground a viewer sees covered (1 − e^(−gain · sum): from a boat the crowns hide the gaps between
// them, as the cards' widening does), then a 3 × 3 smoothing and the canopy surface's slope (the top × the cover, a Sobel):
//   the texel's word (u32): cover (8 bits) | top (8 bits, 0.25 m) | the canopy's slope east, south (8 bits each, ± GMAX)
// The terrain reads it (render/terrain.js CANOPY_READ): past the cards (the share 1 − coverNear, the cards' own curve) it
// draws the canopy: the needles' colour lit on the canopy's own normal (the sun rakes its clumps), the trees' far tint
// and the air on top, and it lifts the far ground by the canopy's height so a skyline keeps its forest.
// Deterministic: integer atomics (adds and maxes) in any order give the same sums.
import { REGION } from './lod.js';

// the grid: the rules' region (lod.js REGION: 10,496 × 12,032 m), 8 m texels on the desktop (1,312 × 1,504: 7.9 MB a buffer),
// 16 m on a phone (656 × 752: 2 MB); two u32 buffers (the sums, then the packed words)
const EXT = { x0: REGION.x0, z0: REGION.z0, w: REGION.tw * REGION.tile, h: REGION.th * REGION.tile };
export const CANOPY = Object.freeze({
  desktop: Object.freeze({ ...EXT, texel: 8 }),
  phone: Object.freeze({ ...EXT, texel: 16 }),
  crownK: 1.35,        // the cards' CROWN_K (render/forest.js): a lidar crown's radius as the cards draw it
  rMax: 12,            // m: no crown splats wider (the lidar's widest crowns are segmentation merges)
  gain: 1.0,           // the summed crown area → the share of the ground the crowns cover from above (1 − e^(−gain · sum));
                       // the terrain adds the view's slant (look.view: a far slope seen from a boat shows the crowns' sides)
  fix: 4096,           // the sums' fixed point (a texel's crown area over its own area × this, an integer add)
  topQ: 4,             // the top's quantum: 0.25 m (8 bits: 63.75 m, the lidar's tallest 59 m)
  gMax: 2.0,           // the slope's range (m per m) in its 8 bits
  edgeM: 300,          // the grid's soft edge (the terrain blends to its fallback blanket over this)
  lift: 0.7,           // the far ground rises by the canopy's top × its cover × this (the crowns' mean surface, not their tips)
  fallback: 0.8,       // past the grid: the cover's forest share × this as the blanket's cover
  fallbackTop: 16,     // m: and its top
  // the canopy's look (render/terrain.js): the needles' mean albedo (the cards' pine and firs, render/forest.js SHAPES; matched
  // to the cards' mean colour on screen at the far pose, so warmer than the bare needle albedo),
  // the sun wrapped and kept at sunK (a crown's own shade inside the canopy), the sky at skyK (the cards' 0.28 + 0.72 ao)
  // view: the cover seen at a slant α to the ground is 1 − (1 − c)^(k (1 + side cot α)), the exponent capped
  look: Object.freeze({ albedo: [0.040, 0.061, 0.038], wrap: 0.3, sunK: 0.62, skyK: 0.62, view: Object.freeze({ k: 1.6, side: 1.0, max: 8 }) }),
});
export const gridOf = (variant) => {
  const g = variant === 'phone' ? CANOPY.phone : CANOPY.desktop;
  return { ...g, nx: Math.round(g.w / g.texel), nz: Math.round(g.h / g.texel) };
};

// the splat of one crown (x, z, height h, radius r: the record's) into the sums: cover (Uint32Array, fixed point) and top
// (Uint32Array, h × 16); the JS twin of render/canopy.js SPLAT_WGSL, line for line
export function splatTree(G, cover, top, x, z, h, r) {
  const t = G.texel, R = Math.min(CANOPY.rMax, Math.max(0.5, CANOPY.crownK * r));
  const i0 = Math.max(0, Math.floor((x - R - G.x0) / t)), i1 = Math.min(G.nx - 1, Math.floor((x + R - G.x0) / t));
  const j0 = Math.max(0, Math.floor((z - R - G.z0) / t)), j1 = Math.min(G.nz - 1, Math.floor((z + R - G.z0) / t));
  if (i0 > i1 || j0 > j1) return;
  const wAt = (i, j) => { const cx = G.x0 + (i + 0.5) * t, cz = G.z0 + (j + 0.5) * t; return Math.min(1, Math.max(0, (R - Math.hypot(cx - x, cz - z)) / t + 0.5)); };
  let sum = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) sum += wAt(i, j);
  const area = Math.PI * R * R / (t * t), hq = Math.round(h * 16);
  if (sum <= 1e-6) {   // a small crown between the texels' centres: all of it in its own texel
    const i = Math.min(G.nx - 1, Math.max(0, Math.floor((x - G.x0) / t))), j = Math.min(G.nz - 1, Math.max(0, Math.floor((z - G.z0) / t)));
    cover[j * G.nx + i] += Math.round(area * CANOPY.fix); top[j * G.nx + i] = Math.max(top[j * G.nx + i], hq);
    return;
  }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const w = wAt(i, j); if (w <= 0) continue;
    const k = j * G.nx + i;
    cover[k] += Math.round(w / sum * area * CANOPY.fix); top[k] = Math.max(top[k], hq);
  }
}
// a texel's own cover share and top (the first resolve)
export const coverOf = (sum) => 1 - Math.exp(-CANOPY.gain * sum / CANOPY.fix);
const topOf = (q) => q / 16;

// the two resolves (the twin of render/canopy.js RESOLVE_WGSL): sums → the packed words (Uint32Array nx × nz)
export function resolve(G, cover, top) {
  const n = G.nx * G.nz, own = new Uint32Array(n), out = new Uint32Array(n);
  const B5 = [1, 4, 6, 4, 1], sAt = (i, j) => cover[Math.min(G.nz - 1, Math.max(0, j)) * G.nx + Math.min(G.nx - 1, Math.max(0, i))];
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
    let s5 = 0; for (let b = 0; b < 5; b++) for (let a = 0; a < 5; a++) s5 += B5[a] * B5[b] * sAt(i + a - 2, j + b - 2);
    const k = j * G.nx + i;
    own[k] = (Math.round(coverOf(s5 / 256) * 255) | (Math.min(255, Math.round(topOf(top[k]) * CANOPY.topQ)) << 8)) >>> 0;
  }
  const at = (i, j) => own[Math.min(G.nz - 1, Math.max(0, j)) * G.nx + Math.min(G.nx - 1, Math.max(0, i))];
  const c = (w) => (w & 255) / 255, t = (w) => ((w >>> 8) & 255) / CANOPY.topQ, hc = (w) => c(w) * t(w);
  const W = [1, 2, 1];
  for (let j = 0; j < G.nz; j++) for (let i = 0; i < G.nx; i++) {
    let cs = 0, ws = 0, ts = 0, tw = 0, gx = 0, gz = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const w = at(i + a, j + b), k = W[a + 1] * W[b + 1];
      cs += k * c(w); ws += k; ts += k * c(w) * t(w); tw += k * c(w);
      gx += a * W[b + 1] * hc(w); gz += b * W[a + 1] * hc(w);
    }
    const g8 = (g) => Math.min(255, Math.max(0, Math.round((g / (8 * G.texel)) / CANOPY.gMax * 127.5 + 127.5)));
    out[j * G.nx + i] = (Math.round(cs / ws * 255) | (Math.min(255, Math.round((tw > 1e-6 ? ts / tw : 0) * CANOPY.topQ)) << 8) | (g8(gx) << 16) | (g8(gz) << 24)) >>> 0;
  }
  return out;
}
export const unpackWord = (w) => ({ cover: (w & 255) / 255, top: ((w >>> 8) & 255) / CANOPY.topQ, gx: (((w >>> 16) & 255) / 255 * 2 - 1) * CANOPY.gMax, gz: (((w >>> 24) & 255) / 255 * 2 - 1) * CANOPY.gMax });

// the cards' share of the ground at distance d is lod.js coverNear; the canopy takes the rest, so the forest's cover holds
// through the hand-off: coverNear(d) + canopyShare(d) = 1 (a test sweeps it; the terrain's WGSL is the same curve)
export const canopyShare = (d, L, coverNear) => 1 - coverNear(d, L);
