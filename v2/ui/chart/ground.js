// The live chart's ground (Phase 2a): Emerald Bay drawn in the engraved N3 manner from the game's own
// terrain heights (the lidar land and the multibeam bed, the carved entrance channel in it). Plain JS: no DOM, no GPU, no Math.random,
// no wall clock; the bake tool (tools/v2-chart-bake.mjs), the node tests and the chart component (v2/ui/chart/liveChart.js) run it.
//   relief    a hillshade lit from the north-west, 45° up (the slopes exaggerated 1.6×), softer above the tree line
//   granite   warm grey where the slope is steep (over about 30°) or above the tree line (the island, the north wall, the points)
//   forest    deep green-grey with an engraver's stipple elsewhere on the land
//   sand      pale sand on the low, flat land at the water's edge (the bay's head beach, the coves)
//   water     depth as soft tone from the pale shoal to the navy of the deep; thin cream contours at 3, 10 and 30 m; the carved
//             entrance channel one tone lighter than its banks; the shore a cream hairline; faint land contours every 100 m
// The ground is baked once per palette into an RGBA raster over GROUND.box at a fixed metres-per-pixel: the phones ship it as a WebP
// (GROUND.shipW wide, about 90 kB a palette; tools/v2-chart-bake.mjs); a desktop bakes it live at GROUND.liveMpp in ≤ 4 ms slices.
//   groundSize(mpp)                                 → { w, h, mpp } over GROUND.box
//   groundSteps({ heightAt, mpp, palette, out })    a generator: paints out (RGBA, w·h·4) a few rows a step (the live bake's slices)
//   bakeGround({ heightAt, mpp, palette })          → { w, h, mpp, data }: the same, at once (the tool, the tests)
//   soundings(heightAt)                             → [[x, z, depth m], …]: the chart's depth numerals (the closest zoom only)
//   GROUND_PALETTES.day | .night
import { channelAt, CHANNEL } from '../../terrain/channel.js';

export const GROUND = Object.freeze({
  // the ground's frame in world metres (x east, z south; Fannette Island's summit 0, 0): the bay, its walls, the mouth and the open
  // lake past it, so the widest zoom (the whole bay) never shows past the paper's edge
  box: Object.freeze({ x0: -2400, z0: -3000, x1: 4000, z1: 1400 }),
  shipW: 1024,          // px: the phones' WebP (1024 × 704, 6.25 m a pixel)
  liveMpp: 3.2,         // m a pixel: a desktop's live bake (2000 × 1375)
  contours: Object.freeze([3, 10, 30]),   // m of depth: the thin cream contours
  landContourM: 100,    // m: the faint land contours
  treelineM: 1000,      // m over the lake (the waters file's treeline 2,900 m less the 1,898 m surface)
  relief: 1.6,          // the hillshade's slope exaggeration
  sounding: Object.freeze({ step: 200, minDepth: 4 }),
});

// The sheets past the bay (the chart from Emerald Bay to South Lake): the same engraving over the lake-wide grids and South Lake's own
// detail level (terrain/south), baked by tools/v2-chart-bake.mjs into WebPs (v2/assets/chart/<id>-<palette>.webp; sheetData.js). The
// chart draws them under the bay's ground, which stays as it is where it was:
//   lake    the overview: the bay to South Lake and the mountains round them, so the entrance's view of every birthplace (the bay's
//           five and Off Ski Run, chartModel.js frameBirthplaces) lies on paper at every landscape size; shipped with the bay's
//   south   South Lake at the bay's own scale (6.25 m a pixel): fetched only when the view comes to it close up or the start is
//           there (chartModel.js sheetWanted), the region-load rule
//   rubicon Rubicon Point and the D.L. Bliss shore (terrain/rubicon) at the same scale, by the same rule
export const SHEETS = Object.freeze({
  lake: Object.freeze({ id: 'lake', box: Object.freeze({ x0: -9600, z0: -9600, x1: 16000, z1: 8000 }), mpp: 16, lazy: false }),
  south: Object.freeze({ id: 'south', box: Object.freeze({ x0: 4000, z0: -1600, x1: 14600, z1: 3200 }), mpp: 6.25, lazy: true, loadMpp: 12 }),
  rubicon: Object.freeze({ id: 'rubicon', box: Object.freeze({ x0: -1600, z0: -6600, x1: 2400, z1: -3000 }), mpp: 6.25, lazy: true, loadMpp: 12 }),
});
// the paper: the widest box any sheet covers (the view's clamp, the zoom-out's limit, where a pin counts as past the chart: edge.js)
export const PAPER = SHEETS.lake.box;

import { clampT as clamp } from '../../../src/sim/core/math.js';
import { smooth } from '../../../src/sim/core/math.js';
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// The two palettes. Day: the navy paper's water and's land colours; night: the same chart dim and warm, its ink the
// instruments' night red (TOKENS.night.cream), as the plotter's night palette
export const GROUND_PALETTES = Object.freeze({
  day: Object.freeze({
    // depth stops (m, colour): the shoal pale, the deep the brand's navy
    water: [[0, [96, 124, 146]], [3, [72, 100, 128]], [8, [54, 80, 110]], [16, [40, 60, 90]], [40, [31, 47, 76]], [90, [26, 37, 64]]],
    channelLift: 16,
    granite: [112, 106, 96], forest: [58, 70, 56], sand: [150, 134, 104], alpine: [124, 119, 110],
    stipple: 0.74, relief: 0.62, reliefAdd: 22,
    ink: [239, 230, 210], shore: 0.86, contour: 0.22, landContour: 0.085,
  }),
  // night (owner, 2026-11-18: readable on a phone at arm's length): a moonlit chart, cooler and darker than the day, the relief, the
  // shore and the depth bands still clear; its ink a cool moonlight cream
  night: Object.freeze({
    water: [[0, [74, 92, 114]], [3, [58, 75, 98]], [8, [46, 61, 84]], [16, [36, 49, 71]], [40, [28, 39, 59]], [90, [22, 31, 50]]],
    channelLift: 12,
    granite: [84, 86, 92], forest: [46, 55, 56], sand: [106, 103, 96], alpine: [94, 96, 102],
    stipple: 0.78, relief: 0.6, reliefAdd: 16,
    ink: [214, 222, 236], shore: 0.82, contour: 0.24, landContour: 0.08,
  }),
});

export function groundSize(mpp, box = GROUND.box) {
  return { w: Math.round((box.x1 - box.x0) / mpp), h: Math.round((box.z1 - box.z0) / mpp), mpp };
}

// a stable hash of a pixel in [0, 1): the stipple (no Math.random)
function hash01(i, j) {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((j | 0) + 0x165667b1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function waterTone(stops, d) {
  if (d <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    const [d1, c1] = stops[k];
    if (d < d1) { const [d0, c0] = stops[k - 1]; return mix(c0, c1, smooth(0, 1, (d - d0) / (d1 - d0))); }
  }
  return stops[stops.length - 1][1];
}
// the channel's box (its line ± its half-width and sides), so channelAt runs only near it
const CH = (() => {
  const r = CHANNEL.coreHalfM + CHANNEL.sideM, xs = CHANNEL.pts.map((p) => p[0]), zs = CHANNEL.pts.map((p) => p[1]);
  return { x0: Math.min(...xs) - r, x1: Math.max(...xs) + r, z0: Math.min(...zs) - r, z1: Math.max(...zs) + r, r };
})();
// an ink line's coverage at a pixel: the field's distance to the level in pixels from its value f (m) and its gradient g (m per m)
const lineA = (f, g, mpp, halfW) => (g > 1e-5 ? clamp(1 - Math.abs(f) / (g * mpp) / halfW, 0, 1) : 0);

// paint rows [y0, y1) of the w × h raster `out` (RGBA). H0, H1, H2: the heights of rows y − 1, y and y + 1, each w + 2 long (a
// pixel's neighbours at either end)
function paintRow(out, w, y, H0, H1, H2, mpp, pal, box, G) {
  const z = box.z0 + (y + 0.5) * mpp, ink = pal.ink, inv2 = 1 / (2 * mpp);
  const L = [-0.5, 0.70710678, -0.5];   // toward the light: north-west, 45° up
  for (let x = 0; x < w; x++) {
    const h = H1[x + 1], hx = (H1[x + 2] - H1[x]) * inv2, hz = (H2[x + 1] - H0[x + 1]) * inv2, g = Math.hypot(hx, hz);
    const wx = box.x0 + (x + 0.5) * mpp;
    let c;
    if (h < 0) {
      const d = -h;
      c = waterTone(pal.water, d);
      if (wx > CH.x0 && wx < CH.x1 && z > CH.z0 && z < CH.z1) {
        const cd = channelAt(wx, z).d, k = 1 - smooth(CHANNEL.coreHalfM, CH.r, cd);
        if (k > 0) c = [c[0] + pal.channelLift * k, c[1] + pal.channelLift * k, c[2] + pal.channelLift * k * 1.1];
      }
      let a = 0;
      for (const cd of G.contours) a = Math.max(a, lineA(d - cd, g, mpp, 0.6) * pal.contour);
      if (a > 0) c = mix(c, ink, a);
    } else {
      const ex = hx * G.relief, ez = hz * G.relief, n = 1 / Math.hypot(ex, 1, ez);
      const lit = (-ex * L[0] + L[1] - ez * L[2]) * n - L[1];   // − the flat ground's own
      const gr = Math.max(smooth(0.5, 0.9, g), smooth(G.treelineM - 80, G.treelineM + 80, h));
      const sand = (1 - smooth(1.5, 4.5, h)) * (1 - smooth(0.1, 0.28, g));
      c = mix(pal.forest, h > G.treelineM ? pal.alpine : pal.granite, gr);
      const fw = (1 - gr) * (1 - sand);
      if (fw > 0.2 && hash01(x, y) < 0.2) { const s = 1 - (1 - pal.stipple) * fw; c = [c[0] * s, c[1] * s, c[2] * s]; }
      c = mix(c, pal.sand, sand);
      const rk = pal.relief * (h > G.treelineM ? 0.7 : 1) * (lit < 0 ? 0.72 : 1);   // the shadowed side kept readable
      c = [c[0] * (1 + lit * rk) + lit * pal.reliefAdd, c[1] * (1 + lit * rk) + lit * pal.reliefAdd, c[2] * (1 + lit * rk) + lit * pal.reliefAdd * 0.9];
      const m = ((h % G.landContourM) + G.landContourM) % G.landContourM, f = Math.min(m, G.landContourM - m);
      const a = lineA(f, g, mpp, 0.55) * pal.landContour;
      if (a > 0) c = mix(c, ink, a);
    }
    const sa = lineA(h, Math.max(g, 0.05), mpp, 0.9) * pal.shore;   // the shore's hairline over both sides
    if (sa > 0) c = mix(c, ink, sa);
    const o = (y * w + x) * 4;
    out[o] = clamp(Math.round(c[0]), 0, 255); out[o + 1] = clamp(Math.round(c[1]), 0, 255); out[o + 2] = clamp(Math.round(c[2]), 0, 255); out[o + 3] = 255;
  }
}

// The bake in steps (the live bake's slices): rowsPerStep rows a step; heightAt(x, z) is the terrain's height (m over the lake, the bed
// negative). out: a Uint8ClampedArray (or Uint8Array) of w·h·4
export function* groundSteps({ heightAt, mpp = GROUND.liveMpp, palette = 'day', out, box = GROUND.box, rowsPerStep = 6, G = GROUND } = {}) {
  const { w, h } = groundSize(mpp, box), pal = typeof palette === 'string' ? GROUND_PALETTES[palette] : palette;
  if (!out || out.length < w * h * 4) throw new Error(`ground: an out of ${w * h * 4} bytes is needed`);
  const row = (y) => {   // the heights of row y (clamped to the raster's own rows at the edges), w + 2 wide
    const r = new Float32Array(w + 2), z = box.z0 + (clamp(y, -1, h) + 0.5) * mpp;
    for (let i = 0; i < w + 2; i++) r[i] = heightAt(box.x0 + (i - 0.5) * mpp, z);
    return r;
  };
  let H0 = row(-1), H1 = row(0), H2 = row(1);
  for (let y = 0; y < h; y++) {
    paintRow(out, w, y, H0, H1, H2, mpp, pal, box, G);
    H0 = H1; H1 = H2; H2 = y + 2 <= h ? row(y + 2) : H2;
    if ((y + 1) % rowsPerStep === 0) yield y + 1;
  }
  return h;
}
export function bakeGround({ heightAt, mpp = GROUND.liveMpp, palette = 'day', box = GROUND.box } = {}) {
  const { w, h } = groundSize(mpp, box), data = new Uint8ClampedArray(w * h * 4);
  const it = groundSteps({ heightAt, mpp, palette, out: data, box, rowsPerStep: 1e9 });
  while (!it.next().done) { /* run it out */ }
  return { w, h, mpp, data };
}

// the soundings: a depth numeral every GROUND.sounding.step m on a grid over the box (offset half a step), where the water is at least
// minDepth deep and clear of the shore (every neighbour a quarter step away is water); whole metres
export function soundings(heightAt, { box = GROUND.box, step = GROUND.sounding.step, minDepth = GROUND.sounding.minDepth } = {}) {
  const out = [], q = step / 4;
  for (let z = box.z0 + step / 2; z < box.z1; z += step) {
    for (let x = box.x0 + step / 2; x < box.x1; x += step) {
      const d = -heightAt(x, z);
      if (!(d >= minDepth)) continue;
      if ([[q, 0], [-q, 0], [0, q], [0, -q]].some(([dx, dz]) => heightAt(x + dx, z + dz) >= 0)) continue;
      out.push([x, z, Math.round(d)]);
    }
  }
  return out;
}
