// The kayakers' routes on the lake (feat/kayaks-lake): waypoint paths built from the lake's own data, every
// point in water 2–60 m deep and at least 15 m off the shore (the island counts as shore). Plain JS, no three.js;
// deterministic (the lake's data only, no seed: the page's seed picks among the routes, src/kayaks/plan.js).
//
//   const lib = kayakRoutes(terrain)   // memoised per terrain object
//     lib.routes: [{ id, kind: 'shore' | 'beach' | 'island' | 'cove' | 'crossing', path, rests: [{ s, dur }] }]
//     path: polyline(pts, true): { at(s) → { x, z, heading }, project(x, z, sHint, window) → s, length, pts }
//   okWater(terrain, x, z, margin)     // depth 2–60 m and margin m off the shore
//
// Real Emerald Bay use: shore tours along the walls, the bay-head beach out to Fannette Island and back
// round it, the loop round the island, rests in sheltered coves. The open middle stays the sailors'.
const TAU = Math.PI * 2;
import { clampT as clamp } from '../core/math.js';

export const ROUTE_RULES = Object.freeze({
  minDepth: 2, maxDepth: 60,   // m: the water a kayaker's route keeps to
  margin: 15,                  // m off the shore, every point of a route (the island counts)
  // the shoal west of Fannette is 1.7–2.0 m deep from 24 to 52 m off (the 2022 lidar): kayaks (≈ 10 cm draft) paddle over
  // it, so within islandShoalR m of the island's centre the floor is islandShoalDepth (to confirm)
  islandShoalDepth: 1.5, islandShoalR: 170,
  shore: [25, 55],             // m: a shore tour's distance off
  island: 32,                  // m: the loop round Fannette
  cove: 26,                    // m off the shore where a cove's rest sits
  bayR: 0.55,                  // × the bay's length: routes start within this radius of its centre
  crossAt: [700, 850, 1000, 1150],   // m from the mouth along the bay's axis: the crossings' stations (the sailboat's way in)
  crossOff: 28,                // m off each wall where a crossing turns
});

export function minDepthAt(terrain, x, z) {
  const I = terrain.lake.island, R = ROUTE_RULES;
  return Math.hypot(x - I.x, z - I.z) < R.islandShoalR ? R.islandShoalDepth : R.minDepth;
}
export function okWater(terrain, x, z, margin = ROUTE_RULES.margin) {
  const d = -terrain.heightAt(x, z);
  return d >= minDepthAt(terrain, x, z) && d <= ROUTE_RULES.maxDepth && -terrain.shoreDistance(x, z) >= margin;
}

function chaikin(pts, closed) {
  const out = closed ? [] : [pts[0]];
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]], [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

// an arc-length polyline (closed: s wraps): at(s), and project(x, z) → the s of the nearest point, searched within a
// window round a hint (a follower's own progress) or over the whole path
export function polyline(pts, closed = true) {
  const P = closed ? [...pts, pts[0]] : pts.slice();
  const cum = new Float64Array(P.length);
  for (let i = 1; i < P.length; i++) cum[i] = cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const length = cum[P.length - 1];
  const wrapS = (s) => (closed ? ((s % length) + length) % length : clamp(s, 0, length));
  function seg(s) {
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    return lo;
  }
  function at(s0) {
    const s = wrapS(s0), i = seg(s), a = P[i], b = P[i + 1] ?? P[i];
    const f = (s - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i]);
    return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])) };
  }
  function project(x, z, sHint = null, window = 60) {
    let best = Infinity, bs = 0;
    const check = (i) => {
      const a = P[i], b = P[i + 1]; if (!b) return;
      const vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1e-9;
      const t = clamp(((x - a[0]) * vx + (z - a[1]) * vz) / L2, 0, 1);
      const d = (a[0] + vx * t - x) ** 2 + (a[1] + vz * t - z) ** 2;
      if (d < best) { best = d; bs = cum[i] + t * Math.sqrt(L2); }
    };
    if (sHint == null) for (let i = 0; i < P.length - 1; i++) check(i);
    else {
      // the segments within ± window of the hint (wrapping on a loop)
      const i0 = seg(wrapS(sHint - window)), i1 = seg(wrapS(sHint + window));
      if (i0 <= i1) for (let i = i0; i <= i1; i++) check(i);
      else { for (let i = i0; i < P.length - 1; i++) check(i); for (let i = 0; i <= i1; i++) check(i); }
    }
    return { s: bs, d: Math.sqrt(best) };
  }
  return { at, project, length, pts: P, closed, wrapS };
}

// every 2 m of a path in good water (the routes' own check, the tests')
export function pathInWater(terrain, path, { step = 2, margin = ROUTE_RULES.margin } = {}) {
  let worst = null;
  for (let s = 0; s < path.length; s += step) {
    const p = path.at(s);
    if (!okWater(terrain, p.x, p.z, margin)) { worst = { s, x: p.x, z: p.z, depth: -terrain.heightAt(p.x, p.z), off: -terrain.shoreDistance(p.x, p.z) }; break; }
  }
  return worst;   // null: all in good water
}

// walk along an iso-line of the shore distance (d0 m off) from c, one way (dir ±1), step m a step, up to maxLen m; stops
// where the line leaves good water, turns back on itself or closes (a loop round an island: closes = true once back)
function isoWalk(terrain, c, d0, maxLen, dir, { step = 5, closeAt = null, inside = null } = {}) {
  const sd = (x, z) => -terrain.shoreDistance(x, z);
  const grad = (x, z) => { const e = 2; return [(sd(x + e, z) - sd(x - e, z)) / (2 * e), (sd(x, z + e) - sd(x, z - e)) / (2 * e)]; };
  const pts = [];
  let p = [c[0], c[1]], prevDir = null, closed = false;
  for (let i = 0; i < maxLen / step; i++) {
    let g = grad(p[0], p[1]); const gl = Math.hypot(g[0], g[1]) || 1;
    const err = sd(p[0], p[1]) - d0;
    p = [p[0] - g[0] / gl * err, p[1] - g[1] / gl * err];   // back onto the line (a Newton step along the gradient)
    g = grad(p[0], p[1]); const l2 = Math.hypot(g[0], g[1]) || 1;
    const t = [-dir * g[1] / l2, dir * g[0] / l2];
    if (prevDir && t[0] * prevDir[0] + t[1] * prevDir[1] < 0.5) break;   // a sharp kink (a point, a pier): stop
    prevDir = t;
    p = [p[0] + t[0] * step, p[1] + t[1] * step];
    if (Math.abs(sd(p[0], p[1]) - d0) > 12 || !okWater(terrain, p[0], p[1]) || (inside && !inside(p[0], p[1]))) break;
    pts.push(p);
    if (closeAt && i * step > 120 && Math.hypot(p[0] - closeAt[0], p[1] - closeAt[1]) < step * 1.5) { closed = true; break; }
  }
  return { pts, closed };
}

// a shore tour: out along the line d0 m off, back 12 m further out, the ends rounded: a long flat loop
function shoreLoop(terrain, c, d0, length, inside = null) {
  const a = isoWalk(terrain, c, d0, length / 2, -1, { inside }).pts.reverse(), b = isoWalk(terrain, c, d0, length / 2, 1, { inside }).pts;
  const out = [...a, c, ...b];
  if (out.length < 30) return null;
  // the way back: each point pushed 12 m further off the shore (along the shore distance's gradient)
  const sd = (x, z) => -terrain.shoreDistance(x, z);
  const back = out.map(([x, z]) => {
    const e = 2, gx = (sd(x + e, z) - sd(x - e, z)) / (2 * e), gz = (sd(x, z + e) - sd(x, z - e)) / (2 * e), l = Math.hypot(gx, gz) || 1;
    return [x + gx / l * 12, z + gz / l * 12];
  }).reverse();
  let pts = [...out.filter((_, i) => i % 2 === 0), ...back.filter((_, i) => i % 2 === 0)];
  for (let r = 0; r < 3; r++) pts = chaikin(pts, true);
  return pts;
}

// A* over water cells (cell m, good water with margin), from a to b; thinned and smoothed
function waterRoute(terrain, a, b, { cell = 12, margin = 20, pad = 250 } = {}) {
  const x0 = Math.min(a[0], b[0]) - pad, z0 = Math.min(a[1], b[1]) - pad;
  const nx = Math.ceil((Math.abs(a[0] - b[0]) + 2 * pad) / cell) + 1, nz = Math.ceil((Math.abs(a[1] - b[1]) + 2 * pad) / cell) + 1;
  const N = nx * nz, ok = new Uint8Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) ok[j * nx + i] = okWater(terrain, x0 + i * cell, z0 + j * cell, margin) ? 1 : 0;
  const near = (p) => {   // the nearest good cell to a point
    let best = -1, bd = Infinity;
    for (let k = 0; k < N; k++) if (ok[k]) { const d = (x0 + (k % nx) * cell - p[0]) ** 2 + (z0 + ((k / nx) | 0) * cell - p[1]) ** 2; if (d < bd) { bd = d; best = k; } }
    return best;
  };
  const sk = near(a), gk = near(b);
  if (sk < 0 || gk < 0) return null;
  const g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N), open = [];
  const gi = gk % nx, gj = (gk / nx) | 0;
  const push = (f, k) => { open.push([f, k]); let c = open.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (open[p][0] <= open[c][0]) break; [open[p], open[c]] = [open[c], open[p]]; c = p; } };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r < open.length && open[r][0] < open[m][0]) m = r; if (m === c) break; [open[m], open[c]] = [open[c], open[m]]; c = m; } } return top; };
  g[sk] = 0; push(0, sk);
  while (open.length) {
    const [, k] = pop();
    if (done[k]) continue; done[k] = 1;
    if (k === gk) break;
    const i = k % nx, j = (k / nx) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const kk = jj * nx + ii; if (!ok[kk] || done[kk]) continue;
      const ng = g[k] + Math.hypot(di, dj);
      if (ng < g[kk]) { g[kk] = ng; from[kk] = k; push(ng + Math.hypot(ii - gi, jj - gj), kk); }
    }
  }
  if (from[gk] < 0) return null;
  const cells = [];
  for (let k = gk; k >= 0; k = from[k]) { cells.push([x0 + (k % nx) * cell, z0 + ((k / nx) | 0) * cell]); if (k === sk) break; }
  cells.reverse();
  let pts = cells.filter((_, i) => i % 3 === 0 || i === cells.length - 1);
  for (let r = 0; r < 2; r++) pts = chaikin(pts, false);
  return pts;
}

// the nearest point to p that sits off m off the shore in good water (searched on rings out to R m)
function snapOff(terrain, p, off, R = 160) {
  let best = null, bd = Infinity;
  for (let r = 0; r <= R; r += 6) for (let k = 0; k < Math.max(1, Math.round(r / 3)); k++) {
    const a = k / Math.max(1, Math.round(r / 3)) * TAU, x = p[0] + Math.cos(a) * r, z = p[1] + Math.sin(a) * r;
    if (Math.abs(-terrain.shoreDistance(x, z) - off) > 3 || !okWater(terrain, x, z)) continue;
    const d = r; if (d < bd) { bd = d; best = [x, z]; }
  }
  return best;
}

// how sheltered a spot is: the share of 16 directions in which land lies within 220 m (a cove: most of them)
function shelter(terrain, x, z) {
  let n = 0;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * TAU, fx = Math.sin(a), fz = -Math.cos(a);
    for (let d = 20; d <= 220; d += 20) if (terrain.heightAt(x + fx * d, z + fz * d) >= 0) { n++; break; }
  }
  return n / 16;
}

const CACHE = new WeakMap();
export function kayakRoutes(terrain) {
  let lib = CACHE.get(terrain);
  if (lib) return lib;
  const R = ROUTE_RULES, lake = terrain.lake, bay = lake.bay, rMax = bay.lengthM * R.bayR;
  const routes = [];
  const add = (kind, pts, rests = [], extra = {}) => {
    if (!pts || pts.length < 8) return null;
    const path = polyline(pts, true);
    if (path.length < 150 || pathInWater(terrain, path)) return null;
    const r = { id: `${kind}-${routes.filter((q) => q.kind === kind).length}`, kind, path, rests, ...extra };
    routes.push(r);
    return r;
  };
  // the bay's own water: a flood fill from its centre on a 20 m lattice, walled at the mouth (the line between its two
  // points, 30 m thick), so no route starts or runs out on the open lake
  const G = 20, n = Math.ceil(2 * rMax / G) + 1, gx0 = bay.cx - rMax, gz0 = bay.cz - rMax, reach = new Uint8Array(n * n);
  const [mA, mB] = terrain.places().mouth, mvx = mB.x - mA.x, mvz = mB.z - mA.z, mL2 = mvx * mvx + mvz * mvz;
  const wall = (x, z) => { const t = clamp(((x - mA.x) * mvx + (z - mA.z) * mvz) / mL2, 0, 1); return Math.hypot(mA.x + mvx * t - x, mA.z + mvz * t - z) < 30; };
  const wet = (i, j) => { const x = gx0 + i * G, z = gz0 + j * G; return terrain.heightAt(x, z) < 0 && !wall(x, z); };
  { const st = [[Math.round((bay.cx - gx0) / G), Math.round((bay.cz - gz0) / G)]]; reach[st[0][1] * n + st[0][0]] = 1;
    while (st.length) { const [i, j] = st.pop(); for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n || reach[jj * n + ii] || !wet(ii, jj)) continue; reach[jj * n + ii] = 1; st.push([ii, jj]); } } }
  const inside = (x, z) => { const i = Math.round((x - gx0) / G), j = Math.round((z - gz0) / G); return i >= 0 && j >= 0 && i < n && j < n && reach[j * n + i] === 1; };
  // candidate spots on a 40 m lattice over the bay: good water, 22–60 m off the shore
  const cand = [];
  for (let z = bay.cz - rMax; z <= bay.cz + rMax; z += 40) for (let x = bay.cx - rMax; x <= bay.cx + rMax; x += 40) {
    if (!inside(x, z)) continue;
    const off = -terrain.shoreDistance(x, z);
    if (off < 22 || off > 60 || !okWater(terrain, x, z)) continue;
    if (Math.hypot(x - lake.island.x, z - lake.island.z) < 160) continue;   // the island's own routes
    cand.push([x, z, off]);
  }
  // the island loop: about R.island m off Fannette, closed round it (the first offset whose loop closes in good water)
  const I = lake.island, toBeach = Math.atan2(lake.beach.x - I.x, lake.beach.z - I.z);
  let ring = null;
  for (const off of [R.island, R.island + 8, R.island - 6, R.island + 16]) {
    let ringStart = null;
    for (let d = 20; d < 220 && !ringStart; d += 2) {
      const x = I.x + Math.sin(toBeach + 0.6) * d, z = I.z + Math.cos(toBeach + 0.6) * d;
      if (terrain.heightAt(x, z) < 0 && -terrain.shoreDistance(x, z) >= off) ringStart = [x, z];
    }
    if (!ringStart) continue;
    const w = isoWalk(terrain, ringStart, off, 1600, 1, { closeAt: ringStart, step: 4 });
    if (!w.closed) continue;
    const pts = chaikin(chaikin([ringStart, ...w.pts], true), true);
    if (add('island', pts, [], { off })) { ring = pts; break; }
  }
  // the bay-head beach to Fannette: from a launch spot off the beach, across, once round the island, back
  const launch = snapOff(terrain, [lake.beach.x, lake.beach.z], R.cove);
  if (launch && ring) {
    let k0 = 0, bd = Infinity;
    ring.forEach((p, k) => { const d = Math.hypot(p[0] - launch[0], p[1] - launch[1]); if (d < bd) { bd = d; k0 = k; } });
    const across = waterRoute(terrain, launch, ring[k0]);
    if (across) {
      const loop = [...ring.slice(k0), ...ring.slice(0, k0)];
      add('beach', [...across, ...loop.slice(1), ...across.slice().reverse().slice(1, -1)], [{ s: 0, dur: 90 }], { launch });
    }
  }
  // coves: the most sheltered spots R.cove m off the shore, ≥ 350 m apart; each a short shore tour with a rest there
  const covePts = [];
  for (const [x, z] of cand) {
    const p = snapOff(terrain, [x, z], R.cove, 30); if (!p) continue;
    covePts.push([p[0], p[1], shelter(terrain, p[0], p[1])]);
  }
  covePts.sort((a, b) => b[2] - a[2] || a[0] - b[0] || a[1] - b[1]);
  const coves = [];
  for (const c of covePts) {
    if (c[2] < 0.5 || coves.length >= 4) break;
    if (coves.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 350) || (launch && Math.hypot(launch[0] - c[0], launch[1] - c[1]) < 250)) continue;
    const pts = shoreLoop(terrain, [c[0], c[1]], R.cove, 420, inside);
    if (add('cove', pts, [{ s: 0, dur: 150 }], { cove: [c[0], c[1]] })) coves.push(c);
  }
  // shore tours: from spread spots 25–55 m off the walls (farthest-point picks over the lattice, from the bay-head beach:
  // the lake's routes, not the page's)
  const spots = cand.filter(([, , off]) => off >= R.shore[0] && off <= R.shore[1]);
  const taken = [];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let next = spots.reduce((b, p) => (!b || dist(p, [lake.beach.x, lake.beach.z]) < dist(b, [lake.beach.x, lake.beach.z]) ? p : b), null);
  for (let guard = 0; next && taken.filter((t) => t.length === 2).length < 8 && guard < 40; guard++) {
    const [x, z, off] = next;
    const len = 700 + ((taken.length * 137) % 400);
    if (add('shore', shoreLoop(terrain, [x, z], off, len, inside), [], { anchor: [x, z], off })) taken.push([x, z]);
    else taken.push([x, z, 'skip']);
    let best = null, bd = 0;
    for (const p of spots) { const d = Math.min(...taken.map((q) => dist(p, q))); if (d > bd) { bd = d; best = p; } }
    next = bd >= 250 ? best : null;
  }
  // crossings (step 2): paddlers going over the bay from wall to wall in its lower half, between the boat-in
  // camp's north shore and the south shore below Eagle Point, where the sailboat comes in from the mouth. A long thin
  // loop at a station along the bay's axis (the mouth to the bay-head beach): straight over to 28 m off each wall (or the
  // shallows' edge), 50 m up the bay, straight back. Every point in good water, as every route
  const mid = { x: (mA.x + mB.x) / 2, z: (mA.z + mB.z) / 2 }, ax = lake.beach.x - mid.x, az = lake.beach.z - mid.z, aL = Math.hypot(ax, az);
  const ux = ax / aL, uz = az / aL, px = -uz, pz = ux;   // along the bay, and across it
  const crossings = [];
  for (const st of R.crossAt) {
    // out each way across the bay from the axis at a station, to R.crossOff m off the wall or the shallows' edge
    const end = (st2, sg) => {
      const cx = mid.x + ux * st2, cz = mid.z + uz * st2, ok = [];
      if (!okWater(terrain, cx, cz, 30) || !inside(cx, cz)) return null;
      for (let d = 0; d < 1500; d += 3) { const x = cx + px * sg * d, z = cz + pz * sg * d; if (-terrain.shoreDistance(x, z) < R.crossOff || !okWater(terrain, x, z)) break; ok.push([x, z]); }
      return ok[ok.length - 4] ?? null;   // 9 m short of the edge (the rounded corners stay in good water)
    };
    const A = end(st, -1), B = end(st, 1), A2 = end(st + 50, -1), B2 = end(st + 50, 1);
    if (!A || !B || !A2 || !B2 || Math.hypot(A[0] - B[0], A[1] - B[1]) < 200) continue;
    const line = (p, q) => { const n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 8)); return Array.from({ length: n }, (_, i) => [p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]); };
    let pts = [...line(A, B), ...line(B, B2), ...line(B2, A2), ...line(A2, A)];
    for (let r = 0; r < 2; r++) pts = chaikin(pts, true);
    const r = add('crossing', pts, [], { station: st, ends: [A, B] });
    if (r) crossings.push(r);
  }
  const tours = taken.filter((t) => t.length === 2);
  lib = { routes, launch, coves: coves.map(([x, z]) => [x, z]), tours, inside };
  CACHE.set(terrain, lib);
  return lib;
}
