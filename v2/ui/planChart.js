// The planner's chart on v2 over the whole lake (feat(v2): the passage plan; the whole-lake chart, BACKLOG "The planner's chart
// over the whole lake"): two baked levels of v1's terrain (tools/v2-plan-bake.mjs → planChart.bin) and v1's page chart objects
// (the piers, the moorings, the buoys, the harbour: v2/cruise/chartWorld.json, the same rows Cruise charts).
//   bay   v1's navigator chart as it is (src/sim/modes/chill/navigator.js buildChart over its own region, the bay and its mouth,
//         10 m nodes, A* on 20 m): every plan inside the bay is v1's, cell for cell (v2/tests/plan.test.mjs)
//   lake  the whole of Lake Tahoe that the terrain covers at LAKE.cell (40 m) nodes: the shore distance and the depth (clamped and
//         quantised: past the clamps no chart function a plan reads changes), the fixed objects stamped on it (the harbour, 5 km
//         east of the bay, now on the chart), A* on the same 40 m nodes
// The chart one object reads as v1's buildChart's (region, shoreAt, depthAt, objAt, buoyAt, laneAt, marginAt, fixedAt, comfortAt,
// gates, line, objects, buoys): inside the bay's region the bay level's numbers, outside it the lake level's; its region is the
// lake's (checkDestination's "off my chart" only past the lake's box: a point inside it on land is "dry land"). route(a, b): the
// navigator's findPath (it calls chart.route when a chart has one): both ends in the bay, v1's 20 m A* on the bay level; else, or
// when the bay has no way, A* on the lake's 40 m grid (the 5-mph gates kept; two ends in separate water refused at once), its
// open-water runs pulled straight, then the bay part re-planned on the bay level.
// Pure but for the fetch.
//   decodePlanGrid(bytes)            the inflated file → { v, seed, levels: { bay, lake } } (each { x0, z0, cell, nx, nz, shore, depth })
//   gridTerrain(L)                   a level as the two terrain reads buildChart makes at its nodes (shoreDistance, heightAt)
//   planChart(g, chartIn, { extra }) → the whole-lake chart (bay: buildChart(gridTerrain(g.levels.bay), { shoreline, harbour,
//                                    lanes: [], extra }) as v1's Sail chart; lake: the lake level)
//   await loadPlanChart()            fetch + inflate the grid and the chart rows → the chart, once a page (the planner, AUTO and
//                                    Cruise share it; its own small chunk, after the first frame)
import { buildChart, findPath, NAV } from '../../src/sim/modes/chill/navigator.js';
import { LAKE_BOX } from './lakeBox.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { KEEP_RIGHT_M } from '../sim/channelMarks.js';

// the shore field's clamp (tools/v2-plan-bake.mjs: past these no chart function a plan reads changes)
export const SHORE = { lo: -40, hi: 240 };
// the lake level: its box (lakeBox.js: the lake's water and 400 m round it), its node spacing, its
// depth clamp (fixedAt saturates by 6 + 98 / 8 = 18.3 m, comfort by 10 m, the night water's rule reads 10 m) and its steps
// hw: the lake's A* heuristic weight (findPath's G.hw): 1.5 searches a 28 km open-water route in a fraction of the cells for a
// path at most a few per cent longer, then pulled straight (route's smooth)
export const LAKE = Object.freeze({ ...LAKE_BOX, cell: 40, depthHi: 25, shoreQ: 0.1, depthQ: 0.05, hw: 1.5 });
export const PLAN_FILE = new URL('./planChart.bin', import.meta.url).href;

const unplane = (b, off, n, k) => { const o = new Uint8Array(k * n); for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) o[i * k + c] = b[off + c * n + i]; return o.buffer; };

export function decodePlanGrid(bytes) {
  const len = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len)));
  let off = 4 + len;
  const levels = {};
  for (const L of head.levels) {
    const n = L.nx * L.nz;
    if (L.enc === 'f32') {
      levels[L.name] = { ...L, shore: new Float32Array(unplane(bytes, off, n, 4)), depth: new Float32Array(unplane(bytes, off + 4 * n, n, 4)) };
      off += 8 * n;
    } else {   // i16: the value / q, rounded
      const s = new Int16Array(unplane(bytes, off, n, 2)), d = new Int16Array(unplane(bytes, off + 2 * n, n, 2));
      const shore = new Float32Array(n), depth = new Float32Array(n);
      for (let i = 0; i < n; i++) { shore[i] = s[i] * L.shoreQ; depth[i] = d[i] < 0 ? -1 : d[i] * L.depthQ; }
      levels[L.name] = { ...L, shore, depth };
      off += 4 * n;
    }
  }
  if (bytes.length !== off) throw new Error(`planChart: ${bytes.length} bytes, ${off} expected`);
  return { v: head.v, seed: head.seed, shoreLo: head.shoreLo, shoreHi: head.shoreHi, levels };
}

// buildChart reads shoreDistance at every node and heightAt where it is water; both are the node's own baked sample
export function gridTerrain(g) {
  const k = (x, z) => Math.min(g.nz - 1, Math.max(0, Math.round((z - g.z0) / g.cell))) * g.nx + Math.min(g.nx - 1, Math.max(0, Math.round((x - g.x0) / g.cell)));
  return { shoreDistance: (x, z) => -g.shore[k(x, z)], heightAt: (x, z) => -g.depth[k(x, z)] };
}

const LANE_R = 260;   // buildChart's lane field past every lane (Sail charts none)

// the channel lane's depth rule: the keel (NAV.draft 1.6 m) and 1 m under it
export const LANE_DEPTH = NAV.draft + 1;

// marks: the waters' aids (sim/channelMarks.js resolveMarks): the no-wake buoys join the chart's buoys (the navigator's buoy margins,
// as v1's 5-mph line), the lateral buoys stand on the channel's edges, which its lane keeps off: the route down the channel is laid
// keepM to starboard of its line, going that way (COLREG rule 9: inbound the red buoys to starboard, outbound the green); chart.marks
export function planChart(g, chartIn = {}, { extra = [], reach = 160, channel = CHANNEL, marks = [], keepM = KEEP_RIGHT_M } = {}) {
  const noWake = marks.filter((m) => m.type === 'noWake').map((m) => ({ x: m.x, z: m.z }));
  const shoreline = noWake.length ? { ...(chartIn.shoreline ?? {}), hazards: [...(chartIn.shoreline?.hazards ?? []), ...noWake] } : chartIn.shoreline ?? null;
  const bay = buildChart(gridTerrain(g.levels.bay), { shoreline, harbour: chartIn.harbour ?? null, lanes: [], extra, reach });
  const L = g.levels.lake, { x0, z0, cell, nx, nz } = L, N = nx * nz, R = bay.region;
  // the fixed objects and the buoys on the lake's nodes (buildChart's stamp: the distance past each object's own radius)
  const stamp = (list) => {
    const f = new Float32Array(N).fill(reach), r = Math.ceil(reach / cell);
    for (const [px, pz, rad] of list) {
      const ci = Math.round((px - x0) / cell), cj = Math.round((pz - z0) / cell);
      for (let j = Math.max(0, cj - r); j <= Math.min(nz - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
        const d = Math.max(0, Math.hypot(x0 + i * cell - px, z0 + j * cell - pz) - rad), k = j * nx + i;
        if (d < f[k]) f[k] = d;
      }
    }
    return f;
  };
  const obj = stamp(bay.objects), buoy = stamp(bay.buoys);
  const E = chartIn.harbour?.enclosure;   // inside the harbour's basin is all object (buildChart's rule)
  if (E?.length) {   // over the basin's own box only
    const xs = E.map((p) => p[0]), zs = E.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) - x0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) - z0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (insidePoly(E, x0 + i * cell, z0 + j * cell)) obj[j * nx + i] = 0;
  }
  const sample = (f, x, z, outside) => {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return outside;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz)), u = fx - i, v = fz - j, k = j * nx + i;
    return (f[k] * (1 - u) + f[k + 1] * u) * (1 - v) + (f[k + nx] * (1 - u) + f[k + nx + 1] * u) * v;
  };
  const inBay = (x, z) => x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1;
  // the entrance channel's lane (terrain/channel.js: carved 4 m deep through the bar, 36 m floor): on its floor the depth rule is the
  // keel's (LANE_DEPTH: draft + 1 m) in place of the plan's 6 m (the navigator's 6 m with 8 m of margin a metre is open water's rule;
  // the channel is a marked passage), so its tracks keep a margin there and nowhere else on the bar
  const lane = channel ? (x, z) => { const c = channelAt(x, z, channel); return c.d <= channel.coreHalfM ? c : null; } : () => null;
  const depthTerm = (x, z, m) => { const d = chart.depthAt(x, z); return (d - (m.depth > LANE_DEPTH && lane(x, z) ? LANE_DEPTH : m.depth)) * 8; };
  const region = { x0: LAKE.x0, x1: LAKE.x1, z0: LAKE.z0, z1: LAKE.z1, cell };
  const chart = {
    region, nx, nz, bay, lake: L, objects: bay.objects, buoys: bay.buoys, gates: bay.gates, line: bay.line, marks,
    shoreAt: (x, z) => (inBay(x, z) ? bay.shoreAt(x, z) : sample(L.shore, x, z, -100)),
    depthAt: (x, z) => (inBay(x, z) ? bay.depthAt(x, z) : sample(L.depth, x, z, -1)),
    objAt: (x, z) => (inBay(x, z) ? bay.objAt(x, z) : sample(obj, x, z, 0)),
    buoyAt: (x, z) => (inBay(x, z) ? bay.buoyAt(x, z) : sample(buoy, x, z, 0)),
    laneAt: (x, z) => (inBay(x, z) ? bay.laneAt(x, z) : LANE_R),
    // buildChart's own three (the same arithmetic on the combined reads)
    marginAt(x, z, m = NAV.plan) { return Math.min(chart.fixedAt(x, z, m), chart.buoyAt(x, z) - m.buoy); },
    fixedAt(x, z, m = NAV.plan) { return Math.min(chart.shoreAt(x, z) - m.shore, chart.objAt(x, z) - m.obj, depthTerm(x, z, m)); },
    comfortAt(x, z) {
      const P = NAV.plan, Q = NAV.pref;
      return Math.min(1, (chart.shoreAt(x, z) - P.shore) / (Q.shore - P.shore), (chart.objAt(x, z) - P.obj) / (Q.obj - P.obj), (chart.depthAt(x, z) - P.depth) / (Q.depth - P.depth),
        (chart.laneAt(x, z) - NAV.laneM) / (Q.lane - NAV.laneM));
    },
    route: (a, b) => route(a, b),
    stats: { gridMs: 0, routes: 0, lastMs: 0, maxMs: 0 },
  };
  // the lake's A* grid (buildChart's coarseGrid rule: blocked under a 15 m plan margin, the cost rising toward the margin) on the
  // lake's own nodes; inside the bay's region it reads the bay level (its narrows and the bar at 10 m). Made on the first route.
  let grid = null;
  const lakeGrid = () => {
    if (grid) return grid;
    const t0 = now(), cost = new Float32Array(N), P = NAV.plan, Q = NAV.pref;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * cell, z = z0 + j * cell;
      let m, c;
      if (inBay(x, z)) { m = chart.fixedAt(x, z); c = chart.comfortAt(x, z); }
      else {   // the node's own samples (the bilinear read at a node is the node)
        const s = L.shore[k], o = obj[k], d = L.depth[k];
        m = Math.min(s - P.shore, o - P.obj, (d - P.depth) * 8);
        c = Math.min(1, (s - P.shore) / (Q.shore - P.shore), (o - P.obj) / (Q.obj - P.obj), (d - P.depth) / (Q.depth - P.depth), (LANE_R - NAV.laneM) / (Q.lane - NAV.laneM));
      }
      cost[k] = m < 15 ? Infinity : 1 + 3 * (1 - Math.max(0, c)) ** 2;
    }
    // the open water without the channel's lane: which side of the bar a point lies (channelSide)
    const base = label(cost);
    // the channel's lane on the grid: every node within a cell of its line (the 36 m floor is narrower than the 40 m nodes), at the
    // cost of near water; a route through them is then laid on the line itself (onChannel)
    if (channel) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell;
      if (!inBay(x, z)) continue;
      const c = channelAt(x, z, channel);
      if (c.d <= cell * 0.75 && c.along > 0 && c.along < c.length) cost[j * nx + i] = 4;
    }
    // the water's connected pieces (8-neighbour, as A* steps): a route between two pieces is refused at once (an A* from the far
    // shore into a cut-off piece searched the whole lake, 88 ms on a desktop, to say no)
    const { comp, pieces } = label(cost);
    grid = { x0, z0, cell, nx, nz, cost, comp, pieces, hw: LAKE.hw, base };
    chart.stats.gridMs = now() - t0;
    return grid;
  };
  Object.defineProperty(chart, 'grid', { get: lakeGrid, enumerable: true });
  function label(cost) {
    const comp = new Int32Array(N).fill(-1), stack = new Int32Array(N);
    let pieces = 0;
    for (let s0 = 0; s0 < N; s0++) {
      if (comp[s0] >= 0 || cost[s0] === Infinity) continue;
      let top = 0; stack[top++] = s0; comp[s0] = pieces;
      while (top) {
        const k = stack[--top], i = k % nx, j = (k / nx) | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj; if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const kk = jj * nx + ii; if (comp[kk] < 0 && cost[kk] < Infinity) { comp[kk] = pieces; stack[top++] = kk; }
        }
      }
      pieces++;
    }
    return { comp, pieces, cost };
  }
  // which side of the bar a water point lies: 'bay' (the basin the channel's first point is in), 'lake', or null (land, cut off)
  chart.channel = channel;
  chart.channelSide = (p) => {
    if (!channel) return null;
    const G = lakeGrid(), B = { ...G, comp: G.base.comp, cost: G.base.cost }, k = pieceOf(B, p);
    return k < 0 ? null : k === pieceOf(B, channel.pts[0]) ? 'bay' : 'lake';
  };
  const inset = 60;   // m: an end this far inside the bay's region plans on the bay level
  const deep = (p) => p[0] > R.x0 + inset && p[0] < R.x1 - inset && p[1] > R.z0 + inset && p[1] < R.z1 - inset;
  const near = (P, b) => { const e = P?.at(-1); return !!e && Math.hypot(e[0] - b[0], e[1] - b[1]) <= 40; };
  function route(a, b) {
    const t0 = now();
    let P = null;
    if (deep(a) && deep(b)) { P = findPath(bay, a, b); if (P && !reaches(bay, P)) P = null; }   // v1's own plan in the bay
    if (!P && pieceOf(lakeGrid(), a) >= 0 && pieceOf(grid, a) === pieceOf(grid, b)) {
      P = findPath({ grid, line: bay.line, gates: bay.gates }, a, b);
      if (P) P = refine(smooth(onChannel(P)), a, b);
    }
    const ms = now() - t0;
    chart.stats.routes++; chart.stats.lastMs = ms; chart.stats.maxMs = Math.max(chart.stats.maxMs, ms);
    return P;
  }
  // a lake path through the channel's lane nodes: that stretch laid on the channel's own line (its points between the entry and the
  // exit, in the path's direction), so the course runs down the 36 m floor
  function onChannel(P) {
    if (!channel) return P;
    const near = P.map((p) => { const c = channelAt(p[0], p[1], channel); return c.d <= cell * 0.75 + 1 && inBay(p[0], p[1]) ? c : null; });
    const i0 = near.findIndex(Boolean); if (i0 < 0) return P;
    let i1 = i0; for (let i = near.length - 1; i >= 0; i--) if (near[i]) { i1 = i; break; }
    const s0 = near[i0].along, s1 = near[i1].along, L = channel.pts;
    if (Math.abs(s1 - s0) < 1) return P;
    const at = (s) => { let run = 0; for (let i = 1; i < L.length; i++) { const d = Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); if (s <= run + d || i === L.length - 1) { const t = Math.max(0, Math.min(1, (s - run) / d)); return [L[i - 1][0] + (L[i][0] - L[i - 1][0]) * t, L[i - 1][1] + (L[i][1] - L[i - 1][1]) * t]; } run += d; } return L.at(-1); };
    const mid = []; let run = 0; const vs = [0];
    for (let i = 1; i < L.length; i++) { run += Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]); vs.push(run); }
    for (let i = 0; i < L.length; i++) if ((vs[i] - s0) * (vs[i] - s1) < 0) mid.push(L[i]);
    if (s1 < s0) mid.sort((p, q) => channelAt(q[0], q[1], channel).along - channelAt(p[0], p[1], channel).along);
    // each point keepM to starboard of the line, going from s0 to s1 (the line's own direction there, by the way she goes)
    const dir = s1 > s0 ? 1 : -1, total = vs.at(-1);
    const right = (p) => {
      const sa = Math.max(0, Math.min(total - 1, channelAt(p[0], p[1], channel).along)), a = at(sa), b = at(sa + 1);
      const dx = (b[0] - a[0]) * dir, dz = (b[1] - a[1]) * dir, l = Math.hypot(dx, dz) || 1;
      return [p[0] - (dz / l) * keepM, p[1] + (dx / l) * keepM];
    };
    return [...P.slice(0, i0), right(at(s0)), ...mid.map(right), right(at(s1)), ...P.slice(i1 + 1)];
  }
  // the lake's A* steps in eight directions (a long open-water leg came out as two straight runs and an elbow): each run of points
  // outside the bay's region is pulled straight where the line between them keeps the grid's own rule (the plan margin ≥ 15 m,
  // read every 20 m); points inside the bay (its gates, its narrows) stay as planned
  const clear = (p, q) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 20)); for (let k = 1; k < n; k++) if (chart.fixedAt(p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n) < 15) return false; return true; };
  function smooth(P) {
    const out = [P[0]];
    let i = 0;
    while (i < P.length - 1) {
      let j = i + 1;
      if (!inBay(...P[i])) {
        let hi = j; while (hi + 1 < P.length && !inBay(...P[hi + 1])) hi++;   // the run's end
        if (clear(P[i], P[hi])) j = hi;
        else { let lo = j; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (clear(P[i], P[m])) lo = m; else hi = m; } j = lo; }   // the furthest clear point (a binary search)
      }
      out.push(P[j]); i = j;
    }
    return out;
  }
  // a bay path that ends where it should (v1's findPath ends on the nearest open cell: none toward the lake past the bar)
  const reaches = (c, P) => { const s = P[P.length - 2] ?? P[0]; return c.grid.cost[cellOf(c.grid, s)] < Infinity; };
  // the part of a lake path inside the bay's region, from a or to b, re-planned on the bay level (its 20 m grid keeps the narrows
  // v1 sails); kept as the lake's when the bay level has no way
  function refine(P, a, b) {
    if (!deep(a) && !deep(b)) return P;
    let out = P;
    if (deep(a)) {
      const k = P.findIndex((p) => !deep(p));
      if (k > 1) { const q = findPath(bay, a, P[k - 1]); if (q && near(q, P[k - 1])) out = [...q, ...P.slice(k)]; }
    }
    if (deep(b)) {
      let k = -1; for (let i = out.length - 1; i >= 0; i--) if (!deep(out[i])) { k = i; break; }
      if (k >= 0 && k < out.length - 2) { const q = findPath(bay, out[k + 1], b); if (q && near(q, b)) out = [...out.slice(0, k + 1), ...q]; }
    }
    out[0] = [a[0], a[1]]; out[out.length - 1] = [b[0], b[1]];
    return out;
  }
  return chart;
}

const now = () => (globalThis.performance?.now ? performance.now() : Date.now());
// the water piece findPath starts or ends in: its nearestOpen (the point's cell, else the nearest open cell within 40 cells)
function pieceOf(G, p) {
  const ci = Math.min(G.nx - 1, Math.max(0, Math.round((p[0] - G.x0) / G.cell))), cj = Math.min(G.nz - 1, Math.max(0, Math.round((p[1] - G.z0) / G.cell)));
  if (G.cost[cj * G.nx + ci] < Infinity) return G.comp[cj * G.nx + ci];
  for (let r = 1; r < 40; r++) {
    let best = -1, bd = Infinity;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= G.nx || j >= G.nz || (Math.abs(i - ci) !== r && Math.abs(j - cj) !== r)) continue;
      if (G.cost[j * G.nx + i] < Infinity) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = j * G.nx + i; } }
    }
    if (best >= 0) return G.comp[best];
  }
  return -1;
}
const cellOf = (G, p) => Math.min(G.nz - 1, Math.max(0, Math.round((p[1] - G.z0) / G.cell))) * G.nx + Math.min(G.nx - 1, Math.max(0, Math.round((p[0] - G.x0) / G.cell)));

function insidePoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

let loaded = null;
export function loadPlanChart({ file = PLAN_FILE } = {}) {
  if (file === PLAN_FILE && loaded) return loaded;
  const p = (async () => {
    const [{ inflate }, { chartInputs }, rows, bytes, { resolveMarks }, aids, { lonLatToWorld }] = await Promise.all([
      import('../terrain/decode.js'), import('../cruise/chartRows.js'), import('../cruise/chartWorld.json'),
      fetch(file).then((r) => { if (!r.ok) throw new Error(`planChart.bin: ${r.status}`); return r.arrayBuffer(); }),
      import('../sim/channelMarks.js'), import('../sim/channelMarks.json'), import('../../src/sim/geo.js'),
    ]);
    const g = decodePlanGrid(await inflate(new Uint8Array(bytes)));
    const marks = resolveMarks(aids.default ?? aids, { waters: 'tahoe-emerald', channel: CHANNEL, lonLatToWorld });   // channel markers
    return planChart(g, chartInputs(rows.default ?? rows), { marks });
  })();
  if (file === PLAN_FILE) { loaded = p; p.catch(() => { if (loaded === p) loaded = null; }); }
  return p;
}
