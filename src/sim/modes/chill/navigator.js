// Chill's skipper: a scenic loop round the bay, sailed safely by the real boat. Plain JS, no three.js, no DOM, no
// clock: the same inputs give the same rudder, so node tests sail it on the real physics (tests/navigator.test.mjs).
//
//   import { buildChart, scenicRoute, Navigator } from './navigator.js';
//   const chart = buildChart(terrain, { shoreline: shoreline.layout, harbour: harbour.layout });
//   const nav = new Navigator({ chart, route: scenicRoute(chart, { seed }), seed });
//   const out = nav.update(phys.state, { t, sunElevDeg, traffic });   // every frame (it decides once per sim second)
//   ctl.rudder = out.rudder; ctl.jibSide = out.jibSide;
//
// Frames (src/boat.js): x east, z south, metres; heading rad clockwise from north (−z); a true wind angle is
// rad from the bow, + = wind from starboard; the wind's FROM direction = heading + trueWind.angle.
//
// 1. The chart (buildChart): a 10 m grid over Emerald Bay (the real USGS terrain, src/terrain.js), its sill and mouth:
//    the distance to the shore (terrain.shoreDistance), the water depth (−terrain.heightAt, the bathymetry), the
//    distance to the nearest fixed object (the shore's piers and mooring balls, the field off the bay head, and any
//    harbour's breakwaters, docks and basin: the harbour is 5 km east on the south shore, off the grid) and to the
//    nearest buoy (hazard and 5-mph buoys; the 5-mph line stands across the mouth). Off the grid is land.
// 2. The route (scenicRoute): a loop round the real bay (2.2 km of water from the head to the sill): Fannette Island
//    (east or south side), the head off Vikingsholm, the waterfall's corner, the north shore under the Hwy 89 vista,
//    the narrows inside the mouth (looking out to the open lake), the east shore under Eagle Point, Mount Tallac over
//    the south wall; each snapped to the clearest water within 200 m. The loop stays inside the bay: the sill across
//    the mouth is 0.5–3 m deep (its deepest crossing 0.55 m) and the keel draws 1.6 m, so there is no way out to the
//    open lake. The loop runs one way (down the north side with the breeze, back up the
//    south-east basin); the seed picks the start, the island's side and a ± 50 m jitter. In a fresh breeze (over 6 m/s)
//    a stop over 700 m dead upwind is left out (and the narrows over 7 m/s); the first leg weighs upwind stops 2.5×.
//    From sunset (the sun under +3°) to sunrise a small loop in open water near the boat instead, as far off the
//    shore as the bay allows (≥ 300 m, else ≥ 250, else ≥ 200: the bay is ≈ 900 m wide) and ≥ 250 m off the
//    paddlewheeler's lane: it gets there on the last of the evening breeze, then ghosts round it in the night drainage
//    (0.6 m/s) until dawn.
// 3. The path: A* on a 20 m grid, the cost rising near hazards, re-planned every 15 s; the subgoal is the furthest
//    path point the boat can see along clear water.
// 4. The heading, once per sim second, as a skipper: every 5° (and both close-hauled headings, and the bearing) is
//    sailed forward 50 s (at least 140 m) at the polar's speed, turning at the boat's rate, against the chart and the
//    traffic's own future positions. A heading whose track breaks a plan margin is out; among the rest the best VMG
//    to the subgoal wins, less a cost to tack or gybe, to leave the path's corridor or to pass close to anything.
//    Upwind that is a beat (close-hauled on the lifted tack, tacking at the corridor's edge or before the shore);
//    deep downwind a broad reach at ≈ 150–160° with gybes. If no heading clears, the one that stays clear longest.
// 5. Steering: Helm.toTWA close-hauled (it holds the angle through shifts), Helm.toHeading otherwise.
// 6. In irons (|TWA| < 32°, under 0.35 m/s, 4 s): bear away with the jib backed to windward, until the wind is 55°
//    off the bow and the boat moves again.
// Strong wind: the crew's auto-reef (CONTROLS.autoReef, on). The navigator only steers (and backs the jib).

import { Helm } from '../../boat.js';
import { CURRENT_WATERS } from '../../waters/current.js';
import { clamp } from '../../core/math.js';

const DEG = Math.PI / 180;
import { wrap } from '../../core/math.js';
const sgn = (x) => (x < 0 ? -1 : 1);

export const NAV = {
  // the rules (the test asserts these); the plan margins are what the navigator keeps
  // buoys: the 5-mph line across the mouth stands 60 m apart, so a boat passes 30 m off the two either side of its gap
  hard: { shore: 60, depth: 3, obj: 40, buoy: 12, traffic: 50 },
  plan: { shore: 85, depth: 6, obj: 62, buoy: 19, traffic: 85 },
  pref: { shore: 170, depth: 10, obj: 110, lane: 220 },
  laneM: 40,                  // the paddlewheeler's lane: the boat crosses it, never lingers in it (soft, 40 → 220 m)
  draft: 1.6,                 // m, the keel
  ballSwingM: 16,             // a moored boat lies up to ≈ 16 m from its ball: moorings count from that circle
  closeHauledDeg: 44, maxTwaDeg: 162,
  decideS: 1, pathS: 15, lookS: 50, lookMinM: 140, stepS: 1, trafficStepS: 3,
  arriveM: 110, destArriveM: 70, tackMinS: 20, corridorM: 200,
  routeArriveM: 40,           // m: a passage plan's waypoint (the chart's PLAN.arriveM); one mark alone keeps destArriveM
  repickNearM: 250,           // the first leg is redone with the first wind reading unless its stop is this near (pickNearest skips stops this near)
  irons: { twaDeg: 32, u: 0.35, s: 4 }, recoverOut: { twaDeg: 55, u: 0.6 }, recoverMaxS: 40,
  tackU: [1.4, 2.0],          // m/s of way a tack needs (≤ 4 m/s of wind, more): slower and it stalls head to wind
  windTau: [12, 5],           // s: the wind's mean for planning, for the helm
  // the night water from sunset (the sun under +3°): the evening breeze dies within ≈ 1.5 game hours, and a boat
  // caught by the calm in the north of the bay drifts in the paddlewheeler's turning water for hours
  nightBelowDeg: 3, dayAboveDeg: 4,
  lightShoreM: 60,            // the extra shore room in a calm (decide(): light air)
  lightObjM: 40,              // and round the moorings (the real bay's south-shore balls lie in the morning drift's lee)
};

// The boat's polar (m/s), from src/boat.js steadyState (auto-trim, the helm on the angle; 120 s runs, 2026-10-29).
const POLAR_TWS = [1, 2, 3, 4, 6, 8, 10, 13];
const POLAR_TWA = [35, 40, 45, 50, 60, 75, 90, 110, 130, 150, 165, 180];
const POLAR = [
  [0.38, 0.5, 0.59, 0.66, 0.78, 0.86, 0.82, 0.62, 0.53, 0.41, 0.37, 0.38],
  [0.76, 1.05, 1.28, 1.45, 1.72, 1.93, 1.91, 1.39, 1.15, 0.81, 0.72, 0.73],
  [1.15, 1.59, 1.91, 2.12, 2.39, 2.54, 2.53, 2.05, 1.76, 1.23, 1.08, 1.1],
  [1.53, 2.08, 2.38, 2.56, 2.78, 2.89, 2.87, 2.5, 2.23, 1.64, 1.44, 1.48],
  [2.22, 2.69, 2.86, 2.98, 3.14, 3.3, 3.21, 3.05, 2.77, 2.32, 2.1, 2.15],
  [2.57, 2.86, 3.01, 3.12, 3.28, 3.42, 3.43, 3.39, 3, 2.74, 2.55, 2.6],
  [2.77, 2.96, 3.1, 3.21, 3.36, 3.56, 3.51, 3.66, 3.26, 3.08, 2.93, 2.98],
  [2.88, 3.07, 3.21, 3.31, 3.49, 3.63, 3.63, 3.8, 3.41, 3.28, 3.18, 3.23],
];
const lerpIdx = (arr, v) => {
  if (v <= arr[0]) return [0, 0];
  for (let i = 1; i < arr.length; i++) if (v <= arr[i]) return [i - 1, (v - arr[i - 1]) / (arr[i] - arr[i - 1])];
  return [arr.length - 2, 1];
};
// steady speed (m/s) at a true wind angle (rad, either sign) and speed (m/s); inside 35° it falls away
export function polarSpeed(twa, tws) {
  const a = Math.abs(twa) / DEG;
  const [j, fj] = lerpIdx(POLAR_TWA, Math.max(35, a));
  const s = clamp(tws, 0, 13);
  const row = (i) => POLAR[i][j] + (POLAR[i][j + 1] - POLAR[i][j]) * fj;
  let v;
  if (s < 1) v = row(0) * s;
  else { const [i, fi] = lerpIdx(POLAR_TWS, s); v = row(i) + (row(i + 1) - row(i)) * fi; }
  return a < 35 ? v * Math.max(0, (a - 20) / 15) : v;
}

// ---- 1. the chart ------------------------------------------------------------------------------------------------
const CHART_REGION = { x0: -1300, x1: 1700, z0: -2000, z1: 1800, cell: 10 };

// extra: more fixed objects as [x, z, r] (the July 4th show's barges and tugs, src/fireworks/stage.js: the wow round moved
// them into the bay, 250 m off Cruise's anchorage)
export function buildChart(terrain, { shoreline = null, harbour = null, lanes = [], region = CHART_REGION, reach = 160, extra = [] } = {}) {
  const { x0, x1, z0, z1, cell } = region;
  const nx = Math.round((x1 - x0) / cell) + 1, nz = Math.round((z1 - z0) / cell) + 1, N = nx * nz;
  const shore = new Float32Array(N), depth = new Float32Array(N), obj = new Float32Array(N).fill(reach), buoy = new Float32Array(N).fill(reach);
  const LANE_R = 260, lane = new Float32Array(N).fill(LANE_R);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, k = j * nx + i;
    const d = terrain.shoreDistance(x, z);
    shore[k] = -d;                                   // + in the water
    depth[k] = d < 0 ? -terrain.heightAt(x, z) : -1;
  }
  // the fixed objects, as points (segments sampled every 4 m); r: the object's own radius
  const objects = [], buoys = [];
  const seg = (a, b, list, r = 0) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 4));
    for (let s = 0; s <= n; s++) list.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n, r]);
  };
  if (shoreline) {
    for (const p of shoreline.piers ?? []) seg([p.x, p.z], [p.x + p.dirX * p.length, p.z + p.dirZ * p.length], objects, (p.width ?? 2.4) / 2);
    for (const b of [...(shoreline.balls ?? []), ...(shoreline.field ?? [])]) objects.push([b.x, b.z, NAV.ballSwingM]);
    for (const b of [...(shoreline.hazards ?? []), ...(shoreline.speedLine ?? [])]) buoys.push([b.x, b.z, 0.3]);
  }
  if (harbour) {
    for (const bw of harbour.breakwaters ?? []) for (let i = 1; i < bw.path.length; i++) seg(bw.path[i - 1], bw.path[i], objects, (bw.baseWidth ?? 10) / 2);
    for (const d of harbour.docks ?? []) seg(d.a, d.b, objects, (d.width ?? 2) / 2);
    const E = harbour.enclosure ?? [];
    for (let i = 0; i < E.length; i++) seg(E[i], E[(i + 1) % E.length], objects);
    for (const b of harbour.boats ?? []) if (b.x != null) objects.push([b.x, b.z, 6]);
  }
  for (const o of extra) objects.push(o);
  const stamp = (list, field) => {
    const R = Math.ceil(reach / cell);
    for (const [px, pz, r] of list) {
      const ci = Math.round((px - x0) / cell), cj = Math.round((pz - z0) / cell);
      for (let j = Math.max(0, cj - R); j <= Math.min(nz - 1, cj + R); j++) for (let i = Math.max(0, ci - R); i <= Math.min(nx - 1, ci + R); i++) {
        const d = Math.max(0, Math.hypot(x0 + i * cell - px, z0 + j * cell - pz) - r), k = j * nx + i;
        if (d < field[k]) field[k] = d;
      }
    }
  };
  stamp(objects, obj); stamp(buoys, buoy);
  // the traffic lanes (the paddlewheeler's loop): every 10 m, stamped out to LANE_R
  {
    const pts = [];
    for (const L of lanes) for (let i = 1; i < L.length; i++) seg(L[i - 1], L[i], pts);
    const R = Math.ceil(LANE_R / cell);
    for (const [px, pz] of pts.filter((_, i) => i % 3 === 0)) {
      const ci = Math.round((px - x0) / cell), cj = Math.round((pz - z0) / cell);
      for (let j = Math.max(0, cj - R); j <= Math.min(nz - 1, cj + R); j++) for (let i = Math.max(0, ci - R); i <= Math.min(nx - 1, ci + R); i++) {
        const d = Math.hypot(x0 + i * cell - px, z0 + j * cell - pz), k = j * nx + i;
        if (d < lane[k]) lane[k] = d;
      }
    }
  }
  // inside the harbour's basin is all object
  const E = harbour?.enclosure;
  if (E?.length) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (insidePoly(E, x0 + i * cell, z0 + j * cell)) obj[j * nx + i] = 0;

  const sample = (f, x, z, outside) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return outside;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), u = fx - i, v = fz - j, k = j * nx + i;
    return (f[k] * (1 - u) + f[k + 1] * u) * (1 - v) + (f[k + nx] * (1 - u) + f[k + nx + 1] * u) * v;
  };
  // the gates through the 5-mph line: the middle of each gap between neighbouring buoys, and the line's normal
  const line = (shoreline?.speedLine ?? []).map((b) => [b.x, b.z]);
  const gates = [];
  if (line.length >= 2) {
    const ux = line.at(-1)[0] - line[0][0], uz = line.at(-1)[1] - line[0][1], L = Math.hypot(ux, uz);
    line.sort((a, b) => (a[0] - line[0][0]) * ux + (a[1] - line[0][1]) * uz - ((b[0] - line[0][0]) * ux + (b[1] - line[0][1]) * uz));
    for (let i = 1; i < line.length; i++) gates.push({ at: [(line[i - 1][0] + line[i][0]) / 2, (line[i - 1][1] + line[i][1]) / 2], n: [-uz / L, ux / L] });
  }
  const chart = {
    region, nx, nz, objects, buoys, gates, line,
    shoreAt: (x, z) => sample(shore, x, z, -100),
    depthAt: (x, z) => sample(depth, x, z, -1),
    objAt: (x, z) => sample(obj, x, z, 0),
    buoyAt: (x, z) => sample(buoy, x, z, 0),
    laneAt: (x, z) => sample(lane, x, z, LANE_R),
    // the plan margin left at a point, m (≥ 0: plan-safe); depth counts 8 m of margin per m of water
    marginAt(x, z, m = NAV.plan) {
      return Math.min(chart.fixedAt(x, z, m), chart.buoyAt(x, z) - m.buoy);
    },
    // the same without the buoys (the path's grid: a buoy line is passed through its gaps, chart.gates)
    fixedAt(x, z, m = NAV.plan) {
      return Math.min(chart.shoreAt(x, z) - m.shore, chart.objAt(x, z) - m.obj, (chart.depthAt(x, z) - m.depth) * 8);
    },
    // how much clearer than the plan margins, toward the preferred ones (0 at the margin, 1 at the preference)
    comfortAt(x, z) {
      const P = NAV.plan, Q = NAV.pref;
      return Math.min(1, (chart.shoreAt(x, z) - P.shore) / (Q.shore - P.shore), (chart.objAt(x, z) - P.obj) / (Q.obj - P.obj), (chart.depthAt(x, z) - P.depth) / (Q.depth - P.depth),
        (chart.laneAt(x, z) - NAV.laneM) / (Q.lane - NAV.laneM));
    },
  };
  chart.grid = coarseGrid(chart);
  return chart;
}

function insidePoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// the A* grid: 20 m cells, blocked under a 15 m plan margin, the cost rising toward the margin
function coarseGrid(chart, cell = 20) {
  const { x0, x1, z0, z1 } = chart.region;
  const nx = Math.floor((x1 - x0) / cell) + 1, nz = Math.floor((z1 - z0) / cell) + 1;
  const cost = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, z = z0 + j * cell, m = chart.fixedAt(x, z);
    const c = chart.comfortAt(x, z);
    cost[j * nx + i] = m < 15 ? Infinity : 1 + 3 * (1 - Math.max(0, c)) ** 2;
  }
  return { x0, z0, cell, nx, nz, cost };
}

// A* from a to b (world points) on the coarse grid; returns a polyline of world points (a, …, b) or null. A chart with its own
// route(a, b) plans there (v2's whole-lake chart, v2/ui/planChart.js: the bay's grid and the lake's)
export function findPath(chart, a, b) {
  if (chart.route) return chart.route(a, b);
  const G = chart.grid, { x0, z0, cell, nx, nz, cost } = G;
  const idx = (p) => [clamp(Math.round((p[0] - x0) / cell), 0, nx - 1), clamp(Math.round((p[1] - z0) / cell), 0, nz - 1)];
  const nearestOpen = (p) => {   // the closest passable cell (the boat may sit inside a margin)
    const [ci, cj] = idx(p);
    if (cost[cj * nx + ci] < Infinity) return cj * nx + ci;
    for (let r = 1; r < 40; r++) {
      let best = -1, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (i < 0 || j < 0 || i >= nx || j >= nz || (Math.abs(i - ci) !== r && Math.abs(j - cj) !== r)) continue;
        if (cost[j * nx + i] < Infinity) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = j * nx + i; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const s = nearestOpen(a), g = nearestOpen(b);
  if (s < 0 || g < 0) return null;
  const gi = g % nx, gj = (g / nx) | 0;
  const hw = G.hw ?? 1;   // the heuristic's weight: 1 (v1's, the best path); a grid may ask more (v2's lake grid: fewer cells searched)
  const h = (k) => hw * Math.hypot((k % nx) - gi, ((k / nx) | 0) - gj);
  const gs = new Float32Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
  const heap = new MinHeap();
  gs[s] = 0; heap.push(s, h(s));
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.size) {
    const k = heap.pop();
    if (k === g) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % nx, j = (k / nx) | 0;
    for (const [di, dj, w] of D) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const kk = jj * nx + ii, c = cost[kk];
      if (c === Infinity || closed[kk]) continue;
      const ng = gs[k] + w * (c + cost[k]) / 2;
      if (ng < gs[kk]) { gs[kk] = ng; from[kk] = k; heap.push(kk, ng + h(kk)); }
    }
  }
  if (from[g] < 0 && g !== s) return null;
  const pts = [];
  for (let k = g; k >= 0; k = k === s ? -1 : from[k]) pts.push([x0 + (k % nx) * cell, z0 + ((k / nx) | 0) * cell]);
  pts.reverse();
  pts[0] = [a[0], a[1]];
  pts[pts.length - 1] = [b[0], b[1]];
  return throughGate(chart, pts);
}

// where a path crosses the 5-mph line, it goes through the nearest gap: 40 m before it, the gap, 40 m after
function throughGate(chart, pts) {
  const L = chart.line;
  if (!L || L.length < 2) return pts;
  const a = L[0], b = L.at(-1);
  const side = (p) => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const along = (p) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    if (side(p) === side(q) || side(p) === 0) continue;
    const f = along(p) + (along(q) - along(p)) * 0.5;
    if (f < -0.1 || f > 1.1) continue;   // past the line's ends: open water
    let g = chart.gates[0], gd = Infinity;
    for (const G of chart.gates) { const d = Math.hypot(G.at[0] - (p[0] + q[0]) / 2, G.at[1] - (p[1] + q[1]) / 2); if (d < gd) { gd = d; g = G; } }
    const s = side(p) * Math.sign(g.n[0] * (b[1] - a[1]) * 0 + 1);
    const nn = (k) => [g.at[0] + g.n[0] * k, g.at[1] + g.n[1] * k];
    const before = side(nn(40)) === side(p) ? nn(40) : nn(-40), after = side(nn(40)) === side(p) ? nn(-40) : nn(40);
    void s;
    return [...pts.slice(0, i), before, g.at, after, ...throughGate(chart, [after, ...pts.slice(i)]).slice(1)];
  }
  return pts;
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; let i = K.length; K.push(k); P.push(p);
    while (i > 0) { const q = (i - 1) >> 1; if (P[q] <= p) break; K[i] = K[q]; P[i] = P[q]; i = q; }
    K[i] = k; P[i] = p;
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], k = K.pop(), p = P.pop();
    if (K.length) {
      let i = 0; const n = K.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= p) break;
        K[i] = K[c]; P[i] = P[c]; i = c;
      }
      K[i] = k; P[i] = p;
    }
    return top;
  }
}

// ---- 2. the route ------------------------------------------------------------------------------------------------
// The scenic stops in the real Emerald Bay (src/terrain.js: Fannette Island's summit is the origin, x east, z south),
// each with what the camera looks at there: [x, y, z] (y above the lake). Positions are targets; scenicRoute snaps
// each to the clearest water near it. The loop runs round the bay: the island, Tallac over the south wall, the east
// shore, the narrows, the north shore, the waterfall's corner, the head (and back to the island).
// The stops, their order and the night water are the lake profile's (stops, loop, night): this page's lake. At Tahoe:
// islandE looks at the tea house on the summit; islandS sits south-east in the open basin (the south passage between the
// island and the shore is too narrow to beat up); bayHead (the stone house from its south-east water) and falls (Eagle
// Falls, 60 m up the creek, from the channel west of the island) snap within 40 m, since the head's clearest water is
// one spot between them; north looks down the bay; narrows out to the open lake; east at Eagle Point's wooded wall;
// tallac at the 3,000 m peak over the south wall.
export const STOPS = CURRENT_WATERS.stops;
// one way round (2026-10-29): the afternoon breeze blows up the bay from the head (≈ 210°), so the loop runs down the
// north side with it (the head, the falls, the north shore, the narrows) and beats back up the wide open water of the
// south-east basin (the east shore, Tallac, the island) to the head; the other way round began with a 1 km beat from
// the north shore to the falls through the paddlewheeler's lane, the island's gusty lee and the head's narrow water
const LOOP = CURRENT_WATERS.loop;
// the night water's fallback (no spot met the rules): the open water south-east of the island, off the lane
export const NIGHT = CURRENT_WATERS.night;

export function hash01(seed, i) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((i | 0) + 0x632be5ab, 0x85ebca6b)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// the clearest water within `radius` of p: the point with the most comfort (ties: the nearest)
export function snapToClear(chart, p, radius = 200) {
  let best = p, bs = -Infinity;
  for (let dz = -radius; dz <= radius; dz += 10) for (let dx = -radius; dx <= radius; dx += 10) {
    const r = Math.hypot(dx, dz); if (r > radius) continue;
    const x = p[0] + dx, z = p[1] + dz;
    if (chart.marginAt(x, z) < 20) continue;
    const s = Math.min(1, chart.comfortAt(x, z)) - r / (radius * 4);
    if (s > bs) { bs = s; best = [x, z]; }
  }
  return best;
}

// Can the boat be sent to (x, z)? The passenger's pick on the chart. The same margins the planner keeps (NAV.plan), so a
// point that passes is one the navigator will sail to: { ok: true, at } or { ok: false, reason, say } with a polite line
// for the hint row. A point near a named place may be snapped to the clearest water within `snapM` (the waterfall is on
// land: the water in front of it is the mark).
export const DEST_SAY = {
  off: 'That is off my chart.',
  land: 'That is dry land, skipper. Pick some water.',
  shallow: 'Too shallow there for her keel. Somewhere deeper?',
  shore: 'Too close to the shore for me. A little further out?',
  objects: 'Too many boats and moorings there. Somewhere clearer?',
  route: 'I cannot find a safe way there.',
};
export function checkDestination(chart, x, z, { from = null, snapM = 0 } = {}) {
  const R = chart.region;
  if (x < R.x0 || x > R.x1 || z < R.z0 || z > R.z1) return { ok: false, reason: 'off', say: DEST_SAY.off };
  let at = [x, z];
  if (snapM > 0 && chart.marginAt(x, z) < 0) at = snapToClear(chart, at, snapM);
  const m = chart.marginAt(at[0], at[1]);
  if (m < 0) {
    const reason = chart.shoreAt(x, z) < 0 ? 'land' : chart.depthAt(at[0], at[1]) < NAV.plan.depth ? 'shallow' : chart.shoreAt(at[0], at[1]) < NAV.plan.shore ? 'shore' : chart.objAt(at[0], at[1]) < NAV.plan.obj ? 'objects' : 'shore';
    return { ok: false, reason, say: DEST_SAY[reason] };
  }
  if (from) {
    const P = findPath(chart, from, at);
    const end = P?.at(-1);
    if (!P || !end || Math.hypot(end[0] - at[0], end[1] - at[1]) > 40) return { ok: false, reason: 'route', say: DEST_SAY.route };
  }
  return { ok: true, at };
}

// A route of picks (the passage plan): each point checked as a destination from the one before it (the first from `from`).
// → { ok: true, at: [[x, z] …] } or { ok: false, index, reason, say } (the first that fails, with checkDestination's line)
export function checkRoute(chart, pts, { from = null, names = [] } = {}) {
  const at = [];
  let prev = from;
  for (let i = 0; i < pts.length; i++) {
    const r = checkDestination(chart, pts[i][0], pts[i][1], { from: prev, snapM: names[i] ? 260 : 0 });
    if (!r.ok) return { ...r, index: i };
    at.push(r.at); prev = r.at;
  }
  return { ok: true, at };
}

export function scenicRoute(chart, { seed = 1, waters = CURRENT_WATERS } = {}) {
  const r = (i) => hash01(seed, i), STOPS = waters.stops;
  const order = waters.loop.slice();
  const start = Math.floor(r(1) * order.length);
  let loop = [...order.slice(start), ...order.slice(0, start)];
  return loop.map((key, i) => {
    const S = key === 'island' ? (r(3) < 0.5 ? STOPS.islandS : STOPS.islandE) : STOPS[key];
    const J = 100 * (S.snapM ?? 200) / 200;   // ± 50 m, less where the stop is pinned (the head's two, ± 10 m)
    const j = [(r(10 + i) - 0.5) * J, (r(20 + i) - 0.5) * J];
    return { key, name: S.name, look: S.look, at: snapToClear(chart, [S.at[0] + j[0], S.at[1] + j[1]], S.snapM ?? 200) };
  });
}

// The night water: the nearest spot to the boat ≥ 300 m off the shore (≥ 250, then ≥ 200 if the bay has none: it is
// ≈ 900 m wide) and ≥ 250 m off the paddlewheeler's lane (NIGHT.centre if none), and a 120 m loop round it, which the
// boat ghosts in the night drainage until dawn.
// The loop's four points must themselves lie in plan-safe water (a 20 m margin) before any snapping: in the real
// bay's tighter water a snap could pull all four onto one spot, and a loop of one spot is "reached" every tick.
export function nightRoute(chart, { seed = 1, waters = CURRENT_WATERS, near = waters.night.centre } = {}) {
  const NIGHT = waters.night;
  const R = 120, a0 = hash01(seed, 40) * Math.PI * 2;
  const loop = (c) => [0, 1, 2, 3].map((k) => { const a = a0 + k * Math.PI / 2; return [c[0] + Math.sin(a) * R, c[1] - Math.cos(a) * R]; });
  let c = NIGHT.centre;
  for (const shoreM of [300, 250, 200]) {
    let bd = Infinity, found = null;
    for (let z = -1200; z <= 700; z += 50) for (let x = -700; x <= 1500; x += 50) {
      if (chart.shoreAt(x, z) < shoreM || chart.laneAt(x, z) < 250 || chart.objAt(x, z) < 150 || chart.depthAt(x, z) < 10) continue;
      const d = Math.hypot(x - near[0], z - near[1]);
      if (d >= bd || loop([x, z]).some((p) => chart.marginAt(...p) < 20)) continue;
      bd = d; found = [x, z];
    }
    if (found) { c = found; break; }
  }
  return loop(c).map((p, k) => ({ key: `night${k}`, name: 'the night water', look: [0, 25, 0], at: snapToClear(chart, p, 30) }));
}

// The start: open water (≥ 170 m off the shore and objects) near a seeded point in the bay round the island, ≥ 150 m
// from every moving boat over the first 90 s, on a beam reach (TWA 90°, on the tack that points into more water).
// windFrom: rad, the wind's FROM direction at the start.
export function chooseStart(chart, { seed = 1, traffic = null, t0 = 0, windFrom = 200 * DEG } = {}) {
  const pref = [300 + (hash01(seed, 50) - 0.5) * 700, (hash01(seed, 51) - 0.5) * 900];
  const spots = [];
  for (let z = -1200; z <= 700; z += 50) for (let x = -700; x <= 1500; x += 50) {
    if (chart.comfortAt(x, z) < 1 || chart.marginAt(x, z) < 80) continue;
    spots.push([Math.hypot(x - pref[0], z - pref[1]), x, z]);
  }
  spots.sort((a, b) => a[0] - b[0]);
  const fut = traffic ? [0, 15, 30, 45, 60, 75, 90].map((k) => traffic.agents(t0 + k).filter((a) => a.kind !== 'moored')) : [];
  for (const [, x, z] of spots) {
    if (fut.some((A) => A.some((a) => Math.hypot(a.x - x, a.z - z) < 150))) continue;
    // the reach that looks into more water over 300 m
    let best = null;
    for (const side of [-1, 1]) {
      const h = wrap(windFrom - side * 90 * DEG);
      let room = 0; for (let d = 20; d <= 300; d += 20) { if (chart.marginAt(x + Math.sin(h) * d, z - Math.cos(h) * d) < 0) break; room = d; }
      if (!best || room > best.room) best = { room, h };
    }
    return { x, z, headingDeg: ((best.h / DEG) + 360) % 360, speed: 2.5 };
  }
  return { x: pref[0], z: pref[1], headingDeg: ((windFrom / DEG) + 270) % 360, speed: 2.5 };
}

// ---- 3–6. the skipper ------------------------------------------------------------------------------------------
export class Navigator {
  constructor({ chart, route, night = null, seed = 1, startIndex = null } = {}) {
    this.chart = chart; this.seed = seed;
    this.day = route ?? scenicRoute(chart, { seed });
    this.night = night;               // built at dusk, near the boat
    this.isNight = false;
    this.route = this.day;
    this.leg = startIndex ?? 0;
    this.helm = new Helm();
    this.path = null; this.pathT = -Infinity;
    this.nextDecide = -Infinity;
    this.choice = null;                 // { heading, closeHauled, twa }
    this.lastTackT = -Infinity;
    this.irons = 0; this.recover = null;
    this.windVec = null; this.windFast = null;
    this.reached = []; this.tacks = 0; this.gybes = 0; this.evasions = 0;
    this.out = { rudder: 0, jibSide: 0, mode: 'start' };
    this.speedK = 1;                  // the boat's speed over the polar's, learned as it sails (light air: ≈ 0.4)
    this.lastT = null;
  }

  get target() { return this.dest ?? this.route[this.leg % this.route.length]; }

  // A chosen destination (the passenger's pick on the chart, src/modes/chill/destination.js): the next leg, before the
  // scenic route resumes. `at` was checked by checkDestination; the route is re-planned from here.
  setDestination(at, { name = 'your mark' } = {}) {
    this.routePts = null;
    this.dest = { key: 'dest', at: [at[0], at[1]], look: [0, 25, 0], name, arriveM: NAV.destArriveM };
    this.path = null; this.nextDecide = -Infinity;
    return this.dest;
  }
  clearDestination() { this.routePts = null; if (!this.dest) return false; this.dest = null; this.path = null; this.nextDecide = -Infinity; return true; }
  // A route (the passage plan; each point checked by checkRoute): the waypoints become the destination in turn,
  // each reached within NAV.routeArriveM (legReached says which), A* re-planned per leg as for a destination; after the last the
  // scenic round resumes (arrived, as a destination). One point is a destination, exactly as before.
  // pts: [{ at: [x, z], name }]
  setRoute(pts) {
    if (!pts?.length) { this.clearDestination(); return null; }
    if (pts.length === 1) return this.setDestination(pts[0].at, { name: pts[0].name ?? 'your mark' });
    this.routePts = pts.map((p) => ({ at: [p.at[0], p.at[1]], name: p.name ?? null }));
    this.routeI = 0;
    return this.routeLeg();
  }
  routeLeg() {
    const p = this.routePts[this.routeI], last = this.routeI === this.routePts.length - 1;
    this.dest = { key: 'dest', at: [p.at[0], p.at[1]], look: [0, 25, 0], name: p.name ?? (last ? 'your mark' : `waypoint ${this.routeI + 1}`), arriveM: NAV.routeArriveM, routeI: this.routeI };
    this.path = null; this.nextDecide = -Infinity;
    return this.dest;
  }

  // the first leg: the stop the boat can reach soonest from here (on load, and after a hand-back). With the wind's
  // FROM direction a stop upwind counts up to 2.5× its distance: on the real bay the head lies dead upwind of the
  // basin east of the island, through a passage too narrow and gusty to beat up (a voyage spent 30 min on that leg).
  // Without it (on load, before the first wind reading) the pick is redone on the first update.
  pickNearest(x, z, windFrom = null) {
    let best = 0, bd = Infinity;
    this.route.forEach((s, i) => {
      const d = Math.hypot(s.at[0] - x, s.at[1] - z);
      if (d <= 250) return;
      const up = windFrom == null ? 0 : Math.max(0, Math.cos(wrap(Math.atan2(s.at[0] - x, -(s.at[1] - z)) - windFrom)));
      if (d * (1 + 1.5 * up) < bd) { bd = d * (1 + 1.5 * up); best = i; }
    });
    this.leg = best; this.path = null;
    this.repick = windFrom == null ? [x, z] : null;
  }

  // state: BoatPhysics.state; ctx: { t (sim s), sunElevDeg, traffic: { agents(t) } | null }
  update(state, { t, sunElevDeg = 20, traffic = null } = {}) {
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT); this.lastT = t;
    // the wind, from the boat's own true wind: a 30 s mean for planning, an 8 s mean for the helm
    const from = wrap(state.heading + state.trueWind.angle), tws = state.trueWind.speed;
    const wx = Math.sin(from) * tws, wz = -Math.cos(from) * tws;
    const ema = (v, tau) => { if (!v) return [wx, wz]; const k = 1 - Math.exp(-dt / tau); return [v[0] + (wx - v[0]) * k, v[1] + (wz - v[1]) * k]; };
    this.windVec = ema(this.windVec, NAV.windTau[0]); this.windFast = ema(this.windFast, NAV.windTau[1]);
    const windFrom = Math.atan2(this.windVec[0], -this.windVec[1]), windSpeed = Math.hypot(...this.windVec);
    const helmFrom = Math.atan2(this.windFast[0], -this.windFast[1]);
    { const p = polarSpeed(state.trueWind.angle, tws); if (p > 0.1 && Math.abs(state.trueWind.angle) > 40 * DEG) this.speedK += (clamp(state.u / p, 0.2, 1.3) - this.speedK) * (1 - Math.exp(-dt / 30)); }

    // the first leg again, now that the wind is known (pickNearest on load had none)
    // (once the boat's wind has a reading: the physics reports none before its first step). A start in a lull (the
    // island's lee) gives no reading for half a minute while the boat carries its way 50–100 m: the pick is redone
    // still, unless the stop is already near (a voyage, seed 3 on the advisory day: a start in the lee, the first
    // leg kept dead upwind, 18 min beating in the island's gusts for one stop)
    if (this.repick && windSpeed > 0.5) {
      const T = this.target, far = Math.hypot(T.at[0] - state.x, T.at[1] - state.z) > NAV.repickNearM;
      if (far && !this.reached.length) this.pickNearest(state.x, state.z, windFrom);
      this.repick = null;
    }
    // day or night
    const night = this.isNight ? sunElevDeg < NAV.dayAboveDeg : sunElevDeg < NAV.nightBelowDeg;
    if (night !== this.isNight) {
      this.isNight = night;
      if (night) this.night = nightRoute(this.chart, { seed: this.seed, near: [state.x, state.z] });
      this.route = night ? this.night : this.day; this.pickNearest(state.x, state.z, windFrom);
    }

    // the leg: arrived (or passed abeam, close) → the next stop
    const T = this.target, dx = T.at[0] - state.x, dz = T.at[1] - state.z, dist = Math.hypot(dx, dz);
    if (T === this.dest && dist < T.arriveM && this.routePts && this.routeI < this.routePts.length - 1) {   // a route's waypoint: the next leg
      this.reached.push({ key: 'route', t, name: T.name, i: this.routeI }); this.legReached = { i: this.routeI, name: T.name, t };
      this.routeI++; this.routeLeg();
    } else if (T === this.dest && dist < T.arriveM) {   // the chosen mark: there; the scenic route resumes from the nearest stop
      if (this.routePts) { this.legReached = { i: this.routeI, name: T.name, t }; this.routePts = null; }
      this.reached.push({ key: T.key, t, name: T.name }); this.arrived = { name: T.name, t }; this.dest = null; this.path = null;
      this.pickNearest(state.x, state.z, windFrom);
    } else if (!this.dest && dist < NAV.arriveM) {
      this.reached.push({ key: T.key, t }); this.leg = (this.leg + 1) % this.route.length; this.path = null;
      // in a strong breeze (over 7 m/s, 14 kn) the skipper leaves out the narrows: the bay's downwind end, where the
      // channel speeds the breeze up (30 kn in gusts at level 3 at 16:00) and the boat must turn and beat 2 km back
      if (this.target.key === 'narrows' && windSpeed > 7) this.leg = (this.leg + 1) % this.route.length;
      // and in a fresh breeze (over 6 m/s, 12 kn) a stop that is a long beat away (over 700 m, within ≈ 37° of the wind) is
      // left for a lighter day: the bay's head lies dead upwind of the north shore, 1 km of reefed, gusty beating
      // (16:00 at level 3 on the 18:45 reference, and the advisory day: one leg filled the whole 30 min)
      if (!this.isNight && windSpeed > 6) {
        for (let k = 0; k < this.route.length - 1; k++) {
          const S = this.target, d = Math.hypot(S.at[0] - state.x, S.at[1] - state.z);
          const up = Math.cos(wrap(Math.atan2(S.at[0] - state.x, -(S.at[1] - state.z)) - windFrom));
          const next = this.route[(this.leg + 1) % this.route.length];
          if (d > 700 && up > 0.8 && next.key !== T.key) this.leg = (this.leg + 1) % this.route.length; else break;
        }
      }
    }

    // irons: detect, then recover by bearing away with the jib backed
    const twa = state.trueWind.angle;
    if (!this.recover) {
      const slow = Math.max(0.12, Math.min(NAV.irons.u, 0.4 * polarSpeed(60 * DEG, windSpeed)));
      this.irons = Math.abs(twa) < NAV.irons.twaDeg * DEG && state.u < slow ? this.irons + dt : 0;
      if (this.irons > NAV.irons.s) { this.recover = { t0: t, side: twa >= 0 ? 1 : -1 }; this.irons = 0; }
    }
    if (this.recover) {
      const R = this.recover, go = Math.min(NAV.recoverOut.u, 0.5 * polarSpeed(60 * DEG, windSpeed));
      // the give-up clock runs at a quarter pace in a calm: a boat becalmed head to wind keeps the jib backed, so the
      // breeze that fills in pushes the bow off at once (a 60-min session, seed 2: a recovery that timed out in the
      // noon calm restarted just as the breeze arrived, 30 s in irons). In a calm, the bow off is out: no way to wait for.
      const calm = windSpeed < 1.5;
      R.age = (R.age ?? 0) + dt * (calm ? 0.25 : 1);
      if (calm) R.side = twa >= 0 ? 1 : -1;   // the jib backed on the side the air comes from now, as the breeze fills
      const done = (Math.abs(twa) > NAV.recoverOut.twaDeg * DEG && (state.u > go || calm)) || R.age > NAV.recoverMaxS;
      if (done) { this.recover = null; this.nextDecide = -Infinity; this.choice = null; }   // out of irons: no tack is under way
      else {
        // the jib backed to windward pushes the bow off; the rudder amidships (going astern it would fight it): out
        // of irons in 13–33 s at 4–12 m/s (renders/chill: the recovery sweep)
        // with way still on, the helm bears away as well
        // (in a calm with any way at all: there is no breeze to round the boat up, and a boat lying head to the light
        // air when the breeze fills takes 35–70 s to fall off at 2.5–4 m/s)
        const rudder = state.u > (calm ? 0.02 : 0.15) ? this.helm.toHeading(state, wrap(helmFrom - R.side * 70 * DEG), Math.max(dt, 1e-3)) : 0;
        this.out = { rudder, jibSide: R.side, mode: 'irons', windFrom, windSpeed };
        return this.out;
      }
    }

    // the path and the decision, once per sim second
    if (!this.path || t - this.pathT > NAV.pathS) { this.path = findPath(this.chart, [state.x, state.z], this.target.at) ?? [[state.x, state.z], this.target.at]; this.pathT = t; }
    if (t >= this.nextDecide) { this.decide(state, t, windFrom, windSpeed, traffic); this.nextDecide = t + NAV.decideS; }

    const c = this.choice;
    // a gybe round: while the short way to the heading still crosses the wind, bear away 60° at a time
    const roundAt = c.round && crossesWind(state.heading, c.heading, helmFrom) ? wrap(state.heading + c.round * 60 * DEG) : null;
    const rudder = roundAt !== null ? this.helm.toHeading(state, roundAt, Math.max(dt, 1e-3))
      : c.closeHauled
      ? this.helm.toTWA(state, c.side * c.chDeg * DEG, helmFrom, Math.max(dt, 1e-3))
      : this.helm.toHeading(state, c.heading, Math.max(dt, 1e-3));
    this.out = { rudder, jibSide: 0, mode: c.mode, heading: c.heading, windFrom, windSpeed, subgoal: this.subgoal, evade: c.evade };
    return this.out;
  }

  // the subgoal: the furthest point along the path (≤ 900 m) seen along water with a 10 m plan margin
  findSubgoal(state) {
    const P = this.path, here = [state.x, state.z];
    let best = P[Math.min(1, P.length - 1)], run = 0;
    for (let i = 1; i < P.length; i++) {
      run += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (run > 900) break;
      if (this.clearLine(here, P[i])) best = P[i];
    }
    return best;
  }
  clearLine(a, b) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 10);
    for (let k = 1; k <= n; k++) {
      const f = k / n, x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
      if (this.chart.fixedAt(x, z) < 10 || this.chart.buoyAt(x, z) < NAV.plan.buoy + 3) return false;
    }
    return true;
  }

  decide(state, t, windFrom, tws, traffic) {
    // in a strong breeze the boat keeps more room: a gust can round it up 30° or more before the helm answers; in
    // light air too (under 2 m/s, up to +60 m in a calm): ghosting at 0.1–0.3 m/s it cannot tack, and a gybe round
    // takes minutes, while the air still sets it down on a lee shore (a 60-min session from 17:00, seed 3: the late
    // morning drift and the noon lull carried it from 90 m to 24 m off the west shore by the light tower)
    const k = clamp(tws - 8, 0, 6), light = clamp((2 - tws) / 1.5, 0, 1);
    this.plan = { ...NAV.plan, shore: NAV.plan.shore + 4 * k + NAV.lightShoreM * light, obj: NAV.plan.obj + 3 * k + NAV.lightObjM * light };
    const sub = this.subgoal = this.findSubgoal(state);
    const bearing = Math.atan2(sub[0] - state.x, -(sub[1] - state.z));
    // the traffic's own future, every 3 s over the look-ahead (moving agents only)
    // the look-ahead: 50 s, or long enough to cover 140 m; in a calm (under 1.5 m/s) 300 s, so a boat drifting down on
    // this one is seen minutes ahead, while there is still time to ghost out of its way
    const calm = tws < 1.5;
    const look = calm ? 300 : Math.min(150, Math.max(NAV.lookS, NAV.lookMinM / Math.max(0.5, polarSpeed(60 * DEG, tws))));
    const step = calm ? 3 : NAV.stepS, tstep = calm ? 6 : NAV.trafficStepS;
    const fut = [];
    if (traffic) for (let k = 0; k * tstep <= look + tstep; k++) fut.push(traffic.agents(t + k * tstep).filter((a) => a.kind !== 'moored'));
    this.lookStep = step; this.lookTStep = tstep;
    this.fut = fut; this.lookS = look; this.windFromNow = windFrom; this.twsNow = tws;   // for clearHeading
    // the side the boat is committed to: the last choice's (mid-tack the boat's own TWA still shows the old side, and
    // judging by it would make finishing the tack look like a second tack)
    // Without way for a tack the boat is on the side it is really on, unless it is head to wind finishing one (a turn
    // that never got through the wind left it on the old side: the gybe round below is then its way across).
    const curTwa = wrap(windFrom - state.heading);
    const slow = state.u < (tws <= 4 ? NAV.tackU[0] : NAV.tackU[1]);
    // slow, and not head to wind in the middle of a tack (one started in the last 25 s); a wind that swings onto the bow
    // in a calm (the morning drift from the north giving way to the noon lull from the south) is no tack to finish
    const settled = slow && !(Math.abs(curTwa) < 35 * DEG && t - this.lastTackT < 25);
    const curSide = settled ? sgn(curTwa) : this.choice?.side ?? sgn(curTwa);
    const cands = [];
    for (let h = 0; h < 360; h += 5) cands.push({ heading: wrap(h * DEG) });
    // close-hauled: 44° in a breeze, freer in light air (a sailor foots for speed under 3 m/s: 55° at 1 m/s)
    const chDeg = NAV.closeHauledDeg + 11 * clamp((3 - tws) / 2, 0, 1);
    for (const side of [-1, 1]) cands.push({ heading: wrap(windFrom - side * chDeg * DEG), closeHauled: true, side, chDeg });
    cands.push({ heading: bearing });
    // a turn through the wind needs way on: slower, and the boat would stall head to wind; then only headings on
    // this side (it bears away and gybes round instead, as a sailor does in light air)
    const nowFrom = wrap(state.heading + state.trueWind.angle);
    const canTack = state.u >= (tws <= 4 ? NAV.tackU[0] : NAV.tackU[1]);
    let best = null, fallback = null;
    const vRef = Math.max(0.3, polarSpeed(75 * DEG, tws));
    for (const c of cands) {
      const twa = wrap(windFrom - c.heading), a = Math.abs(twa);
      if (!c.closeHauled && (a < chDeg * DEG - 1e-6 || a > NAV.maxTwaDeg * DEG)) continue;
      c.side = c.side ?? sgn(twa); c.twa = twa;
      // (a tack under way is finished: the filter only stops a new one being started). Without way for a tack, a
      // heading on the other tack is still open the long way round: bear away, gybe, come up (c.round)
      c.round = !canTack && c.side !== curSide && crossesWind(state.heading, c.heading, nowFrom) ? -sgn(curTwa) : 0;
      if (c.round && !settled) continue;   // mid-tack, head to wind: finish it, never turn back the long way
      const tr = this.track(state, c.heading, windFrom, tws, look, fut, c.round);
      c.tViol = tr.tViol; c.comfort = tr.comfort; c.end = tr.end; c.worst = tr.worst;
      const v = polarSpeed(twa, tws);
      let score = v * Math.cos(wrap(c.heading - bearing)) / vRef;
      const manoeuvre = c.side !== curSide;
      // a tack or gybe costs way, more in light air (under 2 m/s it can leave the boat in irons)
      // (a gybe round never stalls: it costs only the way lost)
      if (manoeuvre) score -= c.round ? 0.2 : 0.2 + 0.4 * clamp((2.5 - tws) / 1.5, 0, 1) + (t - this.lastTackT < NAV.tackMinS * (tws < 2 ? 3 : 1) ? 0.6 : 0);
      score -= 0.004 * Math.abs(wrap(c.heading - state.heading)) / DEG * (manoeuvre ? 0 : 1);
      if (this.choice && Math.abs(wrap(c.heading - this.choice.heading)) < 3 * DEG) score += 0.04;
      score -= 0.5 * Math.max(0, 1 - c.comfort);
      const xt = distToPath(this.path, tr.mid);
      if (xt > NAV.corridorM) score -= 0.6 * (xt - NAV.corridorM) / NAV.corridorM;
      c.score = score;
      if (c.tViol >= look) { if (!best || score > best.score) best = c; }
      // no clear heading: the one that stays clear longest, then the one that keeps the most room
      const key = Math.min(c.tViol, look) + c.worst / 10;
      if (!fallback || key > fallback.key || (key === fallback.key && score > fallback.score)) { fallback = c; c.key = key; }
    }
    const pick = best ?? fallback;
    if (!pick) { this.choice = { heading: state.heading, mode: 'hold', side: curSide }; return; }
    pick.evade = !best;
    if (pick.evade) this.evasions++;
    const prev = this.choice;
    if (prev && prev.side !== pick.side) {
      if (Math.abs(pick.twa) < 90 * DEG) this.tacks++; else this.gybes++;
      this.lastTackT = t;
    }
    pick.mode = pick.evade ? 'evade' : pick.closeHauled ? 'beat' : Math.abs(pick.twa) > 140 * DEG ? 'run' : 'reach';
    this.choice = pick;
  }

  // sail a heading forward: { tViol (s to the first plan-margin breach, Infinity if none), comfort (min), worst (the
  // least room left, m), mid, end }. A boat already inside a margin (pushed by a gust, or a boat sailing at it) breaks
  // it only by going deeper: tracks that open the room again stay clear.
  // turn: 0 the shorter way, ±1 that way round (+1 clockwise: a gybe round)
  track(state, heading, windFrom, tws, look, fut, turn = 0) {
    // two boats on the same turn: one at the polar's speed or faster (the far reach, for the shore), one at the
    // speed this boat has been making (the near reach, for escaping a boat in light air); both must stay clear
    const kF = Math.max(1, this.speedK), kS = Math.min(1, this.speedK);
    let h = state.heading, vF = Math.max(0.3, state.sog), vS = vF;
    const B = [[state.x, state.z], [state.x, state.z]];
    const dt = this.lookStep ?? NAV.stepS, P = NAV.plan.traffic, TS = this.lookTStep ?? NAV.trafficStepS;
    // inside a margin already, a track may not go any deeper (no tolerance: a tolerance ratchets the boat inward a
    // little every second); near a boat, it may not close
    const PL = this.plan ?? NAV.plan;
    const m0 = this.chart.marginAt(state.x, state.z, PL), mFloor = Math.min(0, m0);
    const d0 = fut.length ? fut[0].map((a) => Math.hypot(a.x - state.x, a.z - state.z)) : [];
    const lw = clamp(Math.abs(state.leeway ?? 0), 0, 8 * DEG);   // leeway: the track slides to leeward of the heading
    let comfort = Infinity, mid = null, worst = Infinity;
    const out = (s) => ({ tViol: s, comfort: -1, worst, mid: mid ?? B[0].slice(), end: B[0].slice() });
    for (let s = dt; s <= look + 1e-6; s += dt) {
      let d = wrap(heading - h);
      if (turn && d * turn < 0 && Math.abs(d) > 1e-6) d += turn * 2 * Math.PI;
      const rate = Math.min(10, 1 + 4 * vS) * DEG;   // the boat turns faster with way on
      h = wrap(h + clamp(d, -rate * dt, rate * dt));
      const twa = Math.abs(wrap(windFrom - h));
      // head to wind it loses ≈ 0.1 m/s every second (renders/chill: the tack sweep)
      if (twa < 35 * DEG) { vF = Math.max(0.15, vF - 0.1 * dt); vS = Math.max(0.1, vS - 0.1 * dt); }
      else { const p = polarSpeed(twa, tws), e = 1 - Math.exp(-dt / 8); vF += (p * kF - vF) * e; vS += (p * kS - vS) * e; }
      const cog = twa < 100 * DEG ? h - sgn(wrap(windFrom - h)) * lw : h;
      B[0][0] += Math.sin(cog) * vF * dt; B[0][1] -= Math.cos(cog) * vF * dt;
      B[1][0] += Math.sin(cog) * vS * dt; B[1][1] -= Math.cos(cog) * vS * dt;
      for (const [x, z] of B) {
        const m = this.chart.marginAt(x, z, PL);
        worst = Math.min(worst, m);
        if (m < mFloor) return out(s - dt);
      }
      if (s <= 60) comfort = Math.min(comfort, this.chart.comfortAt(B[0][0], B[0][1]));
      if (fut.length) {
        const f = s / TS, k = Math.floor(f), w = f - k;
        const A0 = fut[Math.min(k, fut.length - 1)], A1 = fut[Math.min(k + 1, fut.length - 1)];
        for (let i = 0; i < A0.length; i++) {
          const a = A0[i], b = A1[i] ?? a, ax = a.x + (b.x - a.x) * w, az = a.z + (b.z - a.z) * w;
          const Pa = a.margin ?? P;   // an agent's own margin (the kayaks: 15 m, src/kayaks/fleet.js agents)
          for (const [x, z] of B) {
            const dd = Math.hypot(ax - x, az - z);
            worst = Math.min(worst, dd - Pa);
            if (dd < Math.min(Pa, d0[i] ?? Pa)) return out(s - dt);
          }
        }
      }
      if (!mid && s >= 30) mid = B[0].slice();
    }
    return { tViol: Infinity, comfort: Math.max(-1, comfort), worst, mid: mid ?? B[0].slice(), end: B[0].slice() };
  }

  // is a heading clear for the look-ahead of the last decision (the plan margins, the traffic's future)? For the AI skipper
  // (src/modes/chill/pilot.js): its own tacks and courses ask before they commit. False before the first decision.
  clearHeading(state, heading) {
    if (this.fut === undefined || !this.plan) return true;
    return this.track(state, heading, this.windFromNow, this.twsNow, this.lookS, this.fut).tViol >= this.lookS;
  }

  stats() {
    return { leg: this.leg, target: this.target.key, night: this.isNight, reached: this.reached.length, tacks: this.tacks, gybes: this.gybes, evasions: this.evasions, mode: this.out.mode };
  }
}

// does turning the shortest way from heading a to b pass through the eye of the wind (a tack)?
function crossesWind(a, b, from) {
  const d = wrap(b - a), n = Math.max(1, Math.ceil(Math.abs(d) / (2 * DEG)));
  let prev = wrap(from - a);
  for (let k = 1; k <= n; k++) {
    const twa = wrap(from - (a + d * k / n));
    if (Math.sign(twa) !== Math.sign(prev) && Math.abs(twa) < Math.PI / 2) return true;
    prev = twa;
  }
  return false;
}

function distToPath(P, p) {
  let best = Infinity;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1;
    const u = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2, 0, 1);
    best = Math.min(best, Math.hypot(a[0] + vx * u - p[0], a[1] + vz * u - p[1]));
  }
  return best;
}
