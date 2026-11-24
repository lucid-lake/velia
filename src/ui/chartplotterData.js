// The chartplotter's data and geometry (owner, 2026-10-29: "show a small map nicely … sometimes the map is very
// advanced, with extra info that helps sailing"). Plain JS, no DOM, no three.js: node tests read it;
// src/ui/chartplotter.js draws it.
//
//   makeView({ cx, cz, mPerPx, rot, ox, oy })   // world (x east, z south, m) ↔ chart px; rot: the bearing drawn up
//   buildGrid(heightAt, bounds, step)            // the terrain sampled on a north-up grid (sliceable: fillRows)
//   contourSegments(grid, depth)                 // marching squares: the depth contour as world segments
//   paintBase(px, W, H, grid, palette, opts)     // the shaded depths, the land and the sill's hatch into RGBA
//   laylineRays(wp, windFrom, twa, len)          // the two laylines through a waypoint
//   laylinePlan(boat, wp, windFrom, twsKn)       // upwind or down, the tacking angle from the polar, the rays
//   vmgTo(boat, wp)                              // velocity made good toward a point, m/s
//   ChartToggle                                  // N: a tap shows / hides, a hold enlarges while held
//   legPlan(from, to, env)                       // the passage plan's one leg: bearing, distance, point of sail, tacks, time
//   routePlan(boat, wps, env)                    // every leg from the boat, the totals, the ETA on the ship's clock, ≤ 3 notes
//   barbGrid(rect, view, windAt, t, o)           // the wind barbs' points on the enlarged chart, from the wind's 60 s mean
//
// Headings and bearings are radians clockwise from north (−z), as src/boat/contract.js.
import { TOKENS } from './tokens.js';
import { CURRENT_WATERS } from '../sim/waters/current.js';
import { DEFAULT_DIMS } from '../sim/boat/dims.js';
import { bestVmg, polarKn } from '../sim/boat/groove.js';
import { etaHour } from './passage.js';

import { clampT as clamp } from '../sim/core/math.js';
import { smooth } from '../sim/core/math.js';
import { wrap } from '../sim/core/math.js';
const KN = 0.514444;

export const PLOT = {
  // the base's frame: Emerald Bay from past its head to the harbour, with a margin for the enlarged chart's 2.4 km
  // half-height anywhere the boat can be (the bay; the sill keeps the keel in)
  bounds: CURRENT_WATERS.charts.plotter,   // the lake profile's (charts.plotter): x −3400…7000, z −4400…2800 at Tahoe
  gridM: 8,                     // m, the terrain grid (heightAt costs ≈ 17 ns: 1.2 M samples ≈ 20 ms, built in slices)
  baseM: 5,                     // m per base pixel (3 M px; the small chart draws ≈ 4.5 m per device pixel at 2×)
  contours: [5, 10, 30, 60],    // m of depth (the shore, 0 m, drawn on top)
  draft: Math.round(DEFAULT_DIMS.HULL.draft * 10) / 10,   // 1.6 m, the fin keel (this page's boat: src/boat/dims.js HULL.draft, to 0.1 m)
  hazardM: 2.6,                 // m: water shallower than the keel + 1 m is hatched near the mouth
  sillR: 1e9,                   // m about the mouth's middle where the hatch applies: everywhere now (feat/grounding: the shallows, water under the keel + 1 m, are hatched wherever they are; was 560, the sill only)
  smallR: 1000,                 // m from the small chart's centre to its rim
  bigR: [1200, 2400, 4800],     // m, the enlarged chart's half-height at each zoom (the wheel steps it); 2400 first
  bigZoom: 1,
  boatAt: 0.54,                // the small chart: the boat 54 % down (the readings sit in the top and bottom of the round glass), so a little more water ahead than astern
  hz: 10,                       // the dynamic layer's redraws per second
  holdS: 0.3,                   // s: N held this long enlarges, shorter is a tap
};

// ---- the world ↔ chart transform ----
// The chart px of a world point: the view's centre (cx, cz) at (ox, oy), mPerPx metres per px, the bearing `rot`
// drawn straight up (0 north-up; the heading for head-up). sx = dx cos r + dz sin r, sy = −dx sin r + dz cos r.
export function makeView({ cx = 0, cz = 0, mPerPx = 1, rot = 0, ox = 0, oy = 0 } = {}) {
  const c = Math.cos(rot), s = Math.sin(rot), k = 1 / mPerPx;
  return {
    cx, cz, mPerPx, rot, ox, oy,
    toPx(x, z, out = [0, 0]) { const dx = x - cx, dz = z - cz; out[0] = ox + (dx * c + dz * s) * k; out[1] = oy + (-dx * s + dz * c) * k; return out; },
    toWorld(px, py, out = [0, 0]) { const sx = (px - ox) * mPerPx, sy = (py - oy) * mPerPx; out[0] = cx + sx * c - sy * s; out[1] = cz + sx * s + sy * c; return out; },
    // a bearing (rad) as a screen angle for canvas: the unit vector (sin, −cos) in chart px
    dirPx(bearing) { const b = bearing - rot; return [Math.sin(b), -Math.cos(b)]; },
  };
}

// ---- the terrain grid ----
// heights (m above the lake; negative the bed) at the texel centres x0 + i·step, z0 + j·step, rows from north
export function buildGrid(heightAt, bounds = PLOT.bounds, step = PLOT.gridM, { fill = true } = {}) {
  const w = Math.floor((bounds.x1 - bounds.x0) / step) + 1, h = Math.floor((bounds.z1 - bounds.z0) / step) + 1;
  const g = { w, h, x0: bounds.x0, z0: bounds.z0, step, H: new Float32Array(w * h), rows: 0, heightAt };
  if (fill) fillRows(g, 0, h);
  return g;
}
export function fillRows(g, r0, r1) {
  const { w, x0, z0, step, H, heightAt } = g;
  for (let j = r0; j < Math.min(r1, g.h); j++) { const z = z0 + j * step; for (let i = 0; i < w; i++) H[j * w + i] = heightAt(x0 + i * step, z); }
  g.rows = Math.max(g.rows, Math.min(r1, g.h));
  return g;
}
// the grid's height at a world point, bilinear (outside: +1, land)
export function gridHeight(g, x, z) {
  const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  if (!(fx >= 0 && fz >= 0 && fx <= g.w - 1 && fz <= g.h - 1)) return 1;
  const i = Math.min(g.w - 2, Math.floor(fx)), j = Math.min(g.h - 2, Math.floor(fz)), u = fx - i, v = fz - j, H = g.H, k = j * g.w + i;
  return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + g.w] * (1 - u) + H[k + g.w + 1] * u) * v;
}

// ---- contours: marching squares on the depth (−height) at `depth` m ----
// Returns a Float32Array of segments [xA, zA, xB, zB, …] in world metres. Rows r0..r1 only (slices); a saddle is
// split by the cell's mean.
export function contourSegments(g, depth, r0 = 0, r1 = g.h - 1) {
  const { w, H, x0, z0, step } = g, out = [];
  const lv = -depth;   // in heights
  for (let j = r0; j < Math.min(r1, g.h - 1); j++) {
    for (let i = 0; i < w - 1; i++) {
      const k = j * w + i;
      const a = H[k], b = H[k + 1], c = H[k + w + 1], d = H[k + w];   // corners: NW, NE, SE, SW
      // bit set where the corner is below the level (water deeper than `depth`)
      const m = (a < lv ? 8 : 0) | (b < lv ? 4 : 0) | (c < lv ? 2 : 0) | (d < lv ? 1 : 0);
      if (m === 0 || m === 15) continue;
      const X = x0 + i * step, Z = z0 + j * step;
      const t = (p, q) => (lv - p) / (q - p);
      // the edge crossings: N (a→b), E (b→c), S (d→c), W (a→d)
      const N = () => [X + t(a, b) * step, Z], E = () => [X + step, Z + t(b, c) * step];
      const S = () => [X + t(d, c) * step, Z + step], Wd = () => [X, Z + t(a, d) * step];
      const seg = (p, q) => out.push(p[0], p[1], q[0], q[1]);
      switch (m) {
        case 1: case 14: seg(Wd(), S()); break;
        case 2: case 13: seg(S(), E()); break;
        case 3: case 12: seg(Wd(), E()); break;
        case 4: case 11: seg(N(), E()); break;
        case 6: case 9: seg(N(), S()); break;
        case 7: case 8: seg(Wd(), N()); break;
        case 5: case 10: {   // a saddle: the mean decides which corners join
          const mid = (a + b + c + d) / 4 < lv;
          if ((m === 5) === mid) { seg(Wd(), N()); seg(S(), E()); } else { seg(Wd(), S()); seg(N(), E()); }
          break;
        }
      }
    }
  }
  return new Float32Array(out);
}

// ---- the palettes: IHO S-52 in manner (v2): depth in blues from the pale shallow band to the dark deep,
// land a warm buff, the ink the sail cream; at night the same chart in the instruments' red ----
export const PALETTES = {
  day: {
    ink: TOKENS.cream, bg: TOKENS.navy, land: [64, 58, 44], shade: 14,   // the cream and the navy are the tokens (src/ui/tokens.css)
    // water by depth band: 0–2, 2–5, 5–10, 10–30, 30–60, 60+ m (the shallow band pale, the deep dark)
    water: [[86, 124, 156], [62, 98, 132], [43, 75, 108], [30, 55, 84], [21, 42, 66], [14, 31, 50]],
    hatch: 0.5, contour: 0.26, shore: 0.72,
  },
  night: {
    ink: TOKENS.night.cream, bg: TOKENS.night.navy, land: [26, 17, 15], shade: 6,
    water: [[52, 28, 28], [40, 21, 22], [30, 16, 18], [22, 12, 14], [15, 9, 11], [10, 6, 8]],
    hatch: 0.42, contour: 0.2, shore: 0.55,
  },
};
// the chart's text: the ink's alpha for each kind, always on a chip of the chart's ground at CHART_CHIP (tools/probe_contrast.mjs
// checks the lightest band under the weakest of them)
export const CHART_TEXT_ALPHA = { label: 0.92, scale: 0.9, north: 0.94, depth: 0.94 };
export const CHART_CHIP = 0.7;
export const NM = 1852;   // m
const BANDS = [2, 5, 10, 30, 60];
export function band(depth) { let i = 0; while (i < BANDS.length && depth >= BANDS[i]) i++; return i; }
// the night palette's weight from the sun's elevation (°): 0 by day, 1 from 5° under the horizon
export const nightOf = (elevDeg) => smooth(3, -5, elevDeg);

// The base image: W × H RGBA at PLOT.baseM per px over the grid's bounds, rows y0..y1 (slices). Land: warm, with a
// soft hillshade from the north-west; water: the depth band's colour; the sill (water under hazardM within sillR of
// `sill`) hatched at 45° in the ink. oy: the first row's index in the whole image (a slice painted into a strip).
export function paintBase(px, W, H, g, pal, { mPerPx = PLOT.baseM, sill = null, hazardM = PLOT.hazardM, sillR = PLOT.sillR, y0 = 0, y1 = H, oy = 0 } = {}) {
  const [lr, lg, lb] = pal.land, ink = pal.ink, ha = pal.hatch;
  for (let y = y0; y < Math.min(y1, H); y++) {
    const z = g.z0 + (y + oy + 0.5) * mPerPx;
    for (let x = 0; x < W; x++) {
      const wx = g.x0 + (x + 0.5) * mPerPx, h = gridHeight(g, wx, z), o = (y * W + x) * 4;
      let r, gg, b;
      if (h >= 0) {
        // the light from the north-west, 45° up: the slope's facing against it
        const e = g.step, dx = (gridHeight(g, wx + e, z) - gridHeight(g, wx - e, z)) / (2 * e), dz = (gridHeight(g, wx, z + e) - gridHeight(g, wx, z - e)) / (2 * e);
        const lit = clamp((dx + dz) * -0.7071 * 1.6, -1, 1);
        r = lr + lit * pal.shade; gg = lg + lit * pal.shade; b = lb + lit * pal.shade * 0.85;
      } else {
        const c = pal.water[band(-h)]; r = c[0]; gg = c[1]; b = c[2];
        if (sill && -h < hazardM && Math.hypot(wx - sill[0], z - sill[1]) < sillR && ((x + y + oy) % 5) < 1) {
          r += (ink[0] - r) * ha; gg += (ink[1] - gg) * ha; b += (ink[2] - b) * ha;
        }
      }
      px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  return px;
}

// ---- laylines and VMG ----
// The two laylines through a waypoint: the lines a boat close-hauled (or at its best downwind angle) on each tack
// fetches it along. A boat on the starboard tack sails windFrom − twa, so it lies back from the mark along the bearing
// windFrom + π − twa; the port tack's along windFrom + π + twa. Returns [[x0, z0, x1, z1] starboard, [..] port].
export function laylineRays(wp, windFrom, twa, len) {
  const ray = (b) => [wp.x, wp.z, wp.x + Math.sin(b) * len, wp.z - Math.cos(b) * len];
  return [ray(windFrom + Math.PI - twa), ray(windFrom + Math.PI + twa)];
}
// upwind if the waypoint lies within 90° of the wind's eye from the boat; the tacking angle is the polar's best VMG
// angle at this true wind (src/boat/groove.js bestVmg: ≈ 42–46° up, ≈ 150–170° down)
export function laylinePlan(boat, wp, windFrom, twsKn, len = 6000) {
  const brg = Math.atan2(wp.x - boat.x, -(wp.z - boat.z));
  const upwind = Math.abs(wrap(brg - windFrom)) < Math.PI / 2;
  const best = bestVmg(Math.max(2, twsKn), upwind);
  const twa = best.twa * Math.PI / 180;
  return { upwind, twaDeg: best.twa, bearing: brg, dist: Math.hypot(wp.x - boat.x, wp.z - boat.z), rays: laylineRays(wp, windFrom, twa, len) };
}
// velocity made good toward a point (m/s): the speed over ground along the bearing to it
export function vmgTo(boat, wp) {
  const brg = Math.atan2(wp.x - boat.x, -(wp.z - boat.z));
  return (boat.sog ?? 0) * Math.cos(wrap((boat.cog ?? boat.heading ?? 0) - brg));
}
export const toKn = (ms) => ms / KN;

// the pro line at the chart's foot (the numbers a racing plotter shows): VMG to the waypoint (with a plan), the depth under
// the keel, the lift / header trend, and on the big chart the tack or gybe angle. vmgKn: null without a plan; trend:
// 'lift' | 'header' | undefined; plan: laylinePlan()'s { upwind, twaDeg } or null
export function proLine({ vmgKn = null, underM, trend, plan = null, big = false }) {
  const parts = [];
  if (plan) parts.push(`VMG ${vmgKn.toFixed(1)} kn`);
  parts.push(`${underM.toFixed(1)} m under keel`);
  if (trend) parts.push(trend === 'lift' ? 'lift ▲' : 'header ▼');
  if (plan && big) parts.push(`${plan.upwind ? 'tack' : 'gybe'} at ${plan.twaDeg}°`);
  return parts.join('  ·  ');
}

// ---- N: tap and hold ----
// down(t) / up(t) with t in s (repeats ignored); update(t) → { shown, big }. A tap (released under holdS) opens the big
// chart (pins it) and the next tap closes it; a hold enlarges it while held, and on release it goes back to what it was.
// pin() keeps it enlarged (a click or a tap on the small chart) until unpin(), a tap of N, or Escape. The small chart is
// the dashboard's circle and is always up: N never hides it (a tester pressed N and the map left the dial).
export class ChartToggle {
  constructor(holdS = PLOT.holdS) { this.holdS = holdS; this.shown = false; this.pinned = false; this.downAt = null; this.held = false; }
  down(t) { if (this.downAt == null) { this.downAt = t; this.held = false; } }
  up(t) {
    if (this.downAt == null) return;
    const tap = t - this.downAt < this.holdS && !this.held;
    this.downAt = null; this.held = false;
    if (!tap) return;
    this.pinned = !this.pinned;
  }
  update(t) { if (this.downAt != null && t - this.downAt >= this.holdS) this.held = true; return this.state; }
  pin() { this.pinned = true; }
  unpin() { this.pinned = false; }
  get big() { return this.held || this.pinned; }
  get state() { return { shown: this.shown, big: this.big }; }
}

// ---- the passage plan (owner go 2026-11-12) ----
// One leg's numbers from our polar and the wind at the boat: the bearing and distance, the true wind angle, the point of
// sail, a beat's tacks or a run's gybes, the leg's time. The route bends round shallows by the navigator's own A* (env.path:
// src/modes/chill/navigator.js findPath, passed in so this file stays free of the navigator). No current, no waves, no
// forecast: the lake has none of the first and our weather is a menu, so the plan reads the wind now and says so.
export const PLAN = {
  tackS: 25,          // s a tack costs (a tack carried through, src/sail/tackCarry.js, loses ≈ 20–25 s of way; the plan rounds up)
  gybeS: 15,          // s a gybe costs
  arriveM: 40,        // m: a waypoint this close is reached (the leg advances)
  shoalM: 6,          // m: a bend round water shallower than this is "round the shallows" (the navigator's plan depth, NAV.plan.depth)
  bendM: 40,          // m: an A* path further than this from the straight line is drawn as a bend, and the sheet says why
  closeDeg: 60, broadDeg: 120,   // the reaches split at these true wind angles
  downMaxDeg: 170,    // ° the deepest a run sails (the polar's best VMG down is 180° in a breeze: a plan does not sail by the lee)
  boardMaxM: NM,      // m: a board's length in open water (the clear width across the leg, at most this)
  boardMinM: 250,     // m: never a shorter board than this (a narrow gap is short-tacked, not counted in tens)
  minKn: 0.3,         // kn: under this the leg's time is unknown ("—")
  refreshS: 1,        // s: the sheet's numbers refresh at most this often
  barbMeanS: 60, barbSamples: 7,   // the barbs read the wind's 60 s mean (7 samples), so they do not flicker with gusts
  notesMax: 3,
};
const POINT_WORDS = { beat: 'beat', close: 'close reach', beam: 'beam reach', broad: 'broad reach', run: 'run' };
const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIRS4 = ['north', 'east', 'south', 'west'];
const RAD = Math.PI / 180;
const xz = (p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : p);
const brgOf = (dx, dz) => Math.atan2(dx, -dz);
const deg360 = (r) => ((r / RAD) % 360 + 360) % 360;
// the distance from p to the segment a–b (all [x, z])
function segDist(p, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz;
  const t = L2 > 0 ? clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t);
}

// from, to: { x, z } (or [x, z]); env: { windFrom (rad, where the wind comes from), twsKn, polar (the boat's; default the
// vessel's), path(a, b) → [[x, z] …] | null (A*), boardM (a fixed clear width across the leg: tests) | widthAt(x, z, brg) → m,
// depthAt(x, z) → m (the bend's note), gates: [[x, z] | { at } …] (the 5-mph line's gaps) }
// → { ok, brg (°T), nm (straight), distNm (sailed course: the bend's length), twa (°, signed), point, words, twaSail, speedKn,
//     sailedNm, tacks, gybes, minutes (null: no wind), path (the bend's polyline | null), bend { dir, depth } | null, gate }
export function legPlan(from, to, { windFrom = 0, twsKn = 0, polar, path = null, boardM = null, widthAt = null, depthAt = null, gates = null } = {}) {
  const a = xz(from), b = xz(to), dx = b.x - a.x, dz = b.z - a.z, straightM = Math.hypot(dx, dz), brgRad = brgOf(dx, dz);
  const base = { brg: deg360(brgRad), nm: straightM / NM };
  let distM = straightM, bendPath = null, bend = null, gate = false;
  if (path) {
    const P = path([a.x, a.z], [b.x, b.z]), end = P?.at(-1);
    if (!P || !end || Math.hypot(end[0] - b.x, end[1] - b.z) > PLAN.arriveM) return { ...base, distNm: base.nm, ok: false, note: 'No safe way', point: null, minutes: null, tacks: 0, gybes: 0, path: null, bend: null, gate: false };
    let far = 0, farP = null, len = 0;
    for (let i = 0; i < P.length; i++) {
      if (i) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const d = segDist(P[i], [a.x, a.z], [b.x, b.z]); if (d > far) { far = d; farP = P[i]; }
    }
    if (far > PLAN.bendM) {
      distM = len; bendPath = P;
      // which way the bend goes (the far point's side of the line, as a compass word) and what it goes round: the least
      // depth along the straight line (≤ 0: the shore)
      const t = clamp(((farP[0] - a.x) * dx + (farP[1] - a.z) * dz) / Math.max(1, straightM * straightM), 0, 1);
      const ox = farP[0] - (a.x + dx * t), oz = farP[1] - (a.z + dz * t);
      let least = Infinity;
      if (depthAt) for (let s = 0; s <= straightM; s += 20) least = Math.min(least, depthAt(a.x + dx * s / straightM, a.z + dz * s / straightM));
      bend = { dir: DIRS4[Math.round(deg360(brgOf(ox, oz)) / 90) % 4], depth: Number.isFinite(least) ? least : null };
    }
    if (gates?.length) gate = gates.some((g) => { const q = Array.isArray(g) ? g : g.at; return P.some((p, i) => i > 0 && segDist(q, P[i - 1], p) < 15); });
  }
  const twaRad = wrap(brgRad - windFrom), A = Math.abs(twaRad) / RAD;
  const tws = Math.max(0, twsKn);
  const up = bestVmg(Math.max(2, tws), true, polar).twa, dn = Math.min(bestVmg(Math.max(2, tws), false, polar).twa, PLAN.downMaxDeg);
  const point = A < up ? 'beat' : A > dn ? 'run' : A < PLAN.closeDeg ? 'close' : A <= PLAN.broadDeg ? 'beam' : 'broad';
  let sailedM = distM, speedKn, twaSail = A, tacks = 0, gybes = 0;
  if (point === 'beat' || point === 'run') {
    twaSail = point === 'beat' ? up : dn;
    sailedM = distM / Math.cos(Math.abs(twaSail - A) * RAD);
    speedKn = polarKn(tws, twaSail, polar);
    // the boards: the clear water across the leg at its middle is a board's length; a beat (or a run) needs two at least
    const W = boardM ?? (widthAt ? widthAt(a.x + dx / 2, a.z + dz / 2, brgRad) : PLAN.boardMaxM);
    const board = clamp(W, PLAN.boardMinM, PLAN.boardMaxM), boards = Math.max(2, Math.ceil(sailedM / board));
    if (point === 'beat') tacks = boards - 1; else gybes = boards - 1;
  } else speedKn = polarKn(tws, A, polar);
  const minutes = speedKn >= PLAN.minKn ? (sailedM / NM) / speedKn * 60 + (tacks * PLAN.tackS + gybes * PLAN.gybeS) / 60 : null;
  return { ...base, ok: true, twa: twaRad / RAD, point, words: POINT_WORDS[point], twaSail, speedKn, distNm: distM / NM, sailedNm: sailedM / NM, tacks, gybes, minutes,
    path: bendPath, bend, gate };
}

// the clear water across a leg at (x, z): from the point both ways at right angles to the bearing until the margin
// (marginAt < 0: the shore, the shallows, the moorings, with the navigator's plan margins) or PLAN.boardMaxM a side
export function clearWidth(marginAt, x, z, brgRad, step = 20) {
  const px = Math.cos(brgRad), pz = Math.sin(brgRad);   // the bearing turned 90°: (sin(b + 90°), −cos(b + 90°))
  let w = 0;
  for (const s of [1, -1]) { let d = step; while (d <= PLAN.boardMaxM && marginAt(x + px * d * s, z + pz * d * s) >= 0) d += step; w += d - step; }
  return w;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// the wind at the boat in plain words: "Wind S 10 kn at the boat."
export const windLine = (windFrom, twsKn) => `Wind ${COMPASS8[Math.round(deg360(windFrom) / 45) % 8]} ${Math.round(twsKn)} kn at the boat.`;

// boat: { x, z }; wps: [{ x, z, name? } …]; env: legPlan's, plus the ship's clock { hourAt, t } or { hour, rate } (etaHour)
// → { ok, legs, nm, minutes (null when a leg has no time), eta (h | null), about (a beat or a run in it), notes: [≤ 3 strings] }
export function routePlan(boat, wps, env = {}) {
  const legs = [];
  let prev = boat, nm = 0, minutes = 0;
  for (const w of wps) {
    const L = legPlan(prev, w, env);
    L.name = w.name ?? null; legs.push(L);
    nm += L.distNm; minutes = minutes == null || L.minutes == null ? null : minutes + L.minutes;
    prev = w;
  }
  const ok = legs.every((L) => L.ok);
  const eta = ok && minutes != null && legs.length ? etaHour(minutes, env) : null;
  const notes = [], each = (f) => legs.forEach((L, i) => { const s = f(L, `Leg ${i + 1}`); if (s) notes.push(s); });
  each((L, n) => (!L.ok ? `${n}: no safe way there.` : null));
  each((L, n) => {
    if (L.point !== 'beat' || L.minutes == null) return null;
    const extra = Math.round(L.minutes - (L.distNm / L.speedKn) * 60);
    return `${n} is a beat: ${plural(L.tacks, 'tack', 'tacks')} on the laylines${extra > 0 ? `, +${extra} min` : ''}.`;
  });
  // the bend's reason: shallows (under PLAN.shoalM on the straight line), else the shore's room the navigator keeps
  each((L, n) => (L.bend ? `${n} bends ${L.bend.dir} ${L.bend.depth != null && L.bend.depth > 0 && L.bend.depth < PLAN.shoalM ? `round ${L.bend.depth.toFixed(1)} m shallows` : 'to keep off the shore'}.` : null));
  each((L, n) => (L.point === 'run' ? `${n} is dead downwind: ${plural(L.gybes, 'gybe', 'gybes')}.` : null));
  each((L, n) => (L.gate ? `${n} crosses the 5-mph line at the gap.` : null));
  return { ok, legs, nm, minutes, eta, about: legs.some((L) => L.point === 'beat' || L.point === 'run'), notes: notes.slice(0, PLAN.notesMax) };
}

// A route edit from the enlarged chart (chartplotter.js onPick in plan mode): { op: 'add' | 'insert', index, x, z, name },
// { op: 'move', index, x, z }, { op: 'remove', index }, { op: 'clear' } → the new route (a copy), or null for anything else
// ('set': Set course is not an edit). A moved waypoint loses its place name (it is no longer there).
export function editRoute(route, p) {
  const r = (route ?? []).map((q) => ({ x: q.x, z: q.z, name: q.name ?? null }));
  const i = Math.max(0, Math.min(r.length, p?.index ?? r.length));
  switch (p?.op) {
    case 'add': case 'insert': r.splice(i, 0, { x: p.x, z: p.z, name: p.name ?? null }); return r;
    case 'move': if (i < r.length) r[i] = { x: p.x, z: p.z, name: null }; return r;
    case 'remove': if (i < r.length) r.splice(i, 1); return r;
    case 'clear': return [];
    default: return null;
  }
}

// The wind barbs (only while a route exists, owner decision 5): a cols × rows grid inside the chart's
// rect { x0, y0, x1, y1 } (chart px), over the water only (isWater(x, z)), each from the wind's mean over the last
// meanS (windAt(x, z, t) → { vx, vz } m/s, toward). → [{ x, z, px, py, kn, fromRad }]
export function barbGrid(rect, view, windAt, t, { cols = 3, rows = 3, isWater = null, meanS = PLAN.barbMeanS, samples = PLAN.barbSamples } = {}) {
  const out = [], W = [0, 0];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = rect.x0 + (rect.x1 - rect.x0) * (i + 0.5) / cols, py = rect.y0 + (rect.y1 - rect.y0) * (j + 0.5) / rows;
    view.toWorld(px, py, W);
    const x = W[0], z = W[1];
    if (isWater && !isWater(x, z)) continue;
    let vx = 0, vz = 0;
    for (let k = 0; k < samples; k++) { const w = windAt(x, z, t - meanS * k / Math.max(1, samples - 1)); vx += w.vx; vz += w.vz; }
    vx /= samples; vz /= samples;
    out.push({ x, z, px, py, kn: Math.hypot(vx, vz) / KN, fromRad: Math.atan2(-vx, vz) });
  }
  return out;
}
