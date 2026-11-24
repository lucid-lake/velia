// Where the shore's boat things stand (L4): private piers and boathouses, mooring balls, a mooring field off the bay
// head's beach, white hazard buoys off rocky points, a 5-mph buoy line across the bay mouth and a small disused light
// tower on the headland. Plain JS, no three.js (node tests read it). Reference: (Tahoe's west shore).
//
//   import { layoutShoreline } from './shoreline-layout.js';
//   const L = layoutShoreline(terrain, { seed: 1 });
//   // → { shore, piers, balls, field, hazards, speedLine, tower, places }
//
// Everything is placed from the shoreline (terrain.shoreDistance = 0, traced by marching squares) and the ground
// (terrain.heightAt); the named places (the bay head, the bay mouth, the headland) come from defaultPlaces(terrain)
// or the `places` option, so a reshaped basin (L2) only needs new places. Deterministic for a seed: no Math.random().
// World frame: x east, y up, z south, metres; the water at y = 0.
//
// Rules (SHORE_RULES; Tahoe numbers where it has them):
//   piers      every 100–200 m along the developed shore (gentle ground, some 400 m stretches left wild, not a reserved
//              place), straight, 30–60 m
//              long, out along the shore normal, ending in ≥ 1.2 m of water; a boathouse at ≈ 40 % of them
//   balls      ≈ 2 white balls (0.6 m) per pier, 50–170 m out (inside 180 m of the shore), 22 m apart or more
//   field      ≈ 20 balls in two rows parallel to the bay head's beach (22 in two rows at the real boat camp), 60 and
//              95 m out, 28 m apart along the row; a boat on ≈ 60 % of them
//   hazards    a white buoy 25–45 m off each rocky place, ≥ 250 m apart: a point (water on ≥ 60 % of an 80 m ring, the
//              ground 120 m inland ≥ 15 m up) or a steep bank (≥ 50 m up, a straight or jutting shore)
//   speedLine  white 5-mph buoys every ≈ 60 m across the bay mouth, none within 30 m of either shore
//   tower      on the headland's most prominent point (the most water on a 150 m ring: its tip), 10 m inland on the rock


export const SHORE_RULES = {
  grid: 8,                       // m, the marching-squares cell
  resample: 5,                   // m between shoreline points
  pier: { spacing: [100, 200], length: [30, 60], minDepth: 1.2, boathouse: 0.4, deckY: 1.4, width: 2.4 },
  developed: { inlandM: 120, maxRise: 40, share: 0.75, minBuilt: 0.15 },   // gentle: the ground 120 m inland under 40 m (≈ 18°); built ground behind
  tower: { inland: 10, heightM: 3.7 },   // ≈ 12 ft, the real Rubicon Point light
  reserve: { bayHeadM: 260, mouthM: 120, headlandM: 260, riverM: 200, channelM: 80 },   // channelM: past the mouth channel's half width
};

function hash(a, b, s) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
import { lerp } from './sim/core/math.js';
const COV = {};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---- the shoreline: marching squares on shoreDistance, chained, the longest loop kept, resampled -----------------
// the stretch of shore this module dresses (the bay and the south shore to the harbour); src/towns.js leaves its piers
// to this module inside it

export const SHORE_REGION = { x0: -1300, x1: 6000, z0: -2400, z1: 2400 };
function traceShore(terrain, { region = SHORE_REGION, grid = SHORE_RULES.grid, step = SHORE_RULES.resample } = {}) {
  const { x0, x1, z0, z1 } = region, nx = Math.ceil((x1 - x0) / grid) + 1, nz = Math.ceil((z1 - z0) / grid) + 1;
  const d = new Float64Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) d[j * nx + i] = terrain.shoreDistance(x0 + i * grid, z0 + j * grid);
  // each cell's crossing points on its edges, keyed by edge so neighbouring cells share them
  const edgeKey = (i, j, h) => `${i},${j},${h}`;   // h: 1 = the horizontal edge from (i, j), 0 = the vertical one
  const pt = (i, j, h) => {
    const a = d[j * nx + i], b = h ? d[j * nx + i + 1] : d[(j + 1) * nx + i], t = a / (a - b);
    return h ? { x: x0 + (i + t) * grid, z: z0 + j * grid } : { x: x0 + i * grid, z: z0 + (j + t) * grid };
  };
  const adj = new Map(), pos = new Map();
  const link = (a, b) => { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); (adj.get(b) ?? adj.set(b, []).get(b)).push(a); };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const s = [d[j * nx + i], d[j * nx + i + 1], d[(j + 1) * nx + i + 1], d[(j + 1) * nx + i]].map((v) => v < 0);
    const edges = [[i, j, 1, s[0] !== s[1]], [i + 1, j, 0, s[1] !== s[2]], [i, j + 1, 1, s[3] !== s[2]], [i, j, 0, s[0] !== s[3]]]
      .filter((e) => e[3]).map(([a, b, h]) => { const k = edgeKey(a, b, h); if (!pos.has(k)) pos.set(k, pt(a, b, h)); return k; });
    if (edges.length === 2) link(edges[0], edges[1]);
    else if (edges.length === 4) { link(edges[0], edges[1]); link(edges[2], edges[3]); }   // a saddle: either pairing is fine at 8 m
  }
  // chain into loops; keep the longest (the lake's own shore, not a puddle)
  const seen = new Set();
  let best = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const chain = [start];
    seen.add(start);
    let prev = null, cur = start;
    for (;;) {
      const next = (adj.get(cur) ?? []).find((k) => k !== prev && !seen.has(k));
      if (!next) break;
      chain.push(next); seen.add(next); prev = cur; cur = next;
    }
    if (chain.length > best.length) best = chain;
  }
  const raw = best.map((k) => pos.get(k));
  // a closed loop wraps round; an open one (L2: the shore leaves the region through the bay's mouth) does not, or the
  // last segment would run straight across the water between the chain's two ends
  const closed = dist(raw[0], raw[raw.length - 1]) < 2 * grid;
  // resample at `step` m of arc length; the normal points to the water (−∇ shoreDistance)
  const out = [];
  let acc = 0;
  for (let i = 0; i < (closed ? raw.length : raw.length - 1); i++) {
    const a = raw[i], b = raw[(i + 1) % raw.length], seg = dist(a, b);
    while (acc <= seg && seg > 0) {
      const t = acc / seg, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
      const e = 1;
      const gx = terrain.shoreDistance(x + e, z) - terrain.shoreDistance(x - e, z), gz = terrain.shoreDistance(x, z + e) - terrain.shoreDistance(x, z - e);
      const g = Math.hypot(gx, gz) || 1;
      out.push({ x, z, nx: -gx / g, nz: -gz / g, s: out.length * step });
      acc += step;
    }
    acc -= seg;
  }
  return out;
}

// ---- the named places -----------------------------------------------------------------------------------------
// From the current basin (the terrain's lake, src/terrain.js): the bay head's beach, the bay mouth's two shores, the headland, the
// river mouth. After a reshape (L2), pass `places` instead.
function defaultPlaces(terrain, shore) {
  const L = terrain.lake, cx = terrain.centreX;
  const nearest = (q, filter = () => true) => shore.filter(filter).reduce((b, p) => (!b || dist(p, q) < dist(b, q) ? p : b), null);
  // L2's basin names its own places (src/terrain.js places()): snap each to the traced shoreline
  if (terrain.places) {
    const P = terrain.places();
    return { bayHead: nearest(P.bayHead), mouth: P.mouth.map((q) => nearest(q)), headland: nearest(P.headland), river: nearest(P.river) };
  }
  const by = L.bay.z, bxC = cx(by) + L.halfWidth * 0.95 + L.bay.depth - L.bay.halfWidth;
  const bayHead = nearest({ x: bxC + L.bay.halfWidth, z: by });
  const mouth = [by - L.bay.halfLength - 40, by + L.bay.halfLength + 40].map((pz) => nearest({ x: cx(pz) + L.halfWidth * 0.97 - 120, z: pz }));
  const hz = L.headland.z, root = cx(hz) - 980;
  const headland = nearest({ x: root + L.headland.reach, z: hz - 40 });
  const river = nearest({ x: cx(L.zNorth), z: L.zNorth });
  return { bayHead, mouth, headland, river };
}

// share of a ring of 16 points (radius r) that is water: ≈ 0.5 on a straight shore, more on a point, less in a cove
function waterShare(terrain, x, z, r) {
  let n = 0;
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; if (terrain.shoreDistance(x + r * Math.cos(a), z + r * Math.sin(a)) < 0) n++; }
  return n / 16;
}

// realPiers (art/towns): the OpenStreetMap piers in the world frame, [{ x, z, dirX, dirZ, length }] (src/towns-layout.js
// osmPiers); given, they replace the procedural walk (the balls still follow them)
export function layoutShoreline(terrain, { seed = 1, rules = SHORE_RULES, places = null, shore = null, realPiers = null } = {}) {
  const R = rules;
  shore = shore ?? traceShore(terrain, { grid: R.grid, step: R.resample });
  places = places ?? defaultPlaces(terrain, shore);
  const isWater = (x, z, depth = 0) => terrain.shoreDistance(x, z) < 0 && terrain.heightAt(x, z) <= -depth;
  // L2's basin also keeps piers off its keep-out ground (the beach, the stone house, the creek) and out of the whole
  // mouth channel (terrain.mouth: its axis a → b), where the real bay has no private piers
  const ch = terrain.mouth, chHalf = (terrain.lake?.mouth?.halfWidth ?? 0) + R.reserve.channelM;
  const inChannel = (p) => {
    if (!ch) return false;
    const [ax, az] = ch.a, [bx, bz] = ch.b, vx = bx - ax, vz = bz - az;
    const u = Math.max(0, Math.min(1, ((p.x - ax) * vx + (p.z - az) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(p.x - ax - u * vx, p.z - az - u * vz) < chHalf;
  };
  const keptOut = (p) => terrain.keepOut && [0, 10].some((k) => terrain.keepOut(p.x - p.nx * k, p.z - p.nz * k));
  const reserved = (p) => dist(p, places.bayHead) < R.reserve.bayHeadM || places.mouth.some((m) => dist(p, m) < R.reserve.mouthM)
    || dist(p, places.headland) < R.reserve.headlandM || dist(p, places.river) < R.reserve.riverM || inChannel(p) || keptOut(p);

  // classify each shoreline point
  for (const p of shore) {
    p.rise = terrain.heightAt(p.x - p.nx * R.developed.inlandM, p.z - p.nz * R.developed.inlandM);
    const stretch = hash(Math.floor(p.s / 400), 0, seed * 13 + 5) < R.developed.share;   // 400 m stretches, some left wild
    // the real basin (src/terrain.js coverAt): piers only where there is built ground behind the shore (NLCD: houses,
    // roads, lots); Emerald Bay is a state park, its shore wild but for the boat camp's buoys
    const built = terrain.coverAt ? Math.max(...[40, 120].map((k) => { const c = terrain.coverAt(p.x - p.nx * k, p.z - p.nz * k, COV); return c.urban + c.open; })) : 1;
    p.developed = stretch && p.rise < R.developed.maxRise && !reserved(p) && built >= R.developed.minBuilt;
  }

  // piers: walk the shore; the next candidate 100–200 m on; skip it if the ground or the water is wrong
  const piers = [];
  let nextS = R.pier.spacing[0] * hash(1, 2, seed);
  if (realPiers) {
    const B = SHORE_REGION;
    realPiers.filter((q) => q.x > B.x0 && q.x < B.x1 && q.z > B.z0 && q.z < B.z1).forEach((q, k) => piers.push({
      x: q.x, z: q.z, dirX: q.dirX, dirZ: q.dirZ, length: q.length, s: k, boathouse: q.boathouse ?? hash(k, 4, seed) < R.pier.boathouse,
      width: q.width ?? R.pier.width, deckY: R.pier.deckY, osm: true }));
  }
  for (const p of realPiers ? [] : shore) {
    if (p.s < nextS || !p.developed) continue;
    const k = piers.length, len = lerp(R.pier.length[0], R.pier.length[1], hash(k, 3, seed));
    const ex = p.x + p.nx * len, ez = p.z + p.nz * len;
    // the whole pier over water past its first 4 m, the end deep enough
    let ok = isWater(ex, ez, R.pier.minDepth);
    for (let t = 4; ok && t < len; t += 4) ok = terrain.shoreDistance(p.x + p.nx * t, p.z + p.nz * t) < 0;
    if (!ok) { nextS = p.s + R.resample * 2; continue; }
    const boathouse = hash(k, 4, seed) < R.pier.boathouse;
    piers.push({ x: p.x, z: p.z, dirX: p.nx, dirZ: p.nz, length: len, s: p.s, boathouse, width: R.pier.width, deckY: R.pier.deckY });
    nextS = p.s + lerp(R.pier.spacing[0], R.pier.spacing[1], hash(k, 5, seed));
  }

  // the light tower: the headland's most prominent point (the most water on a 150 m ring, then on a 60 m one), on the
  // rock just inland
  const tip = shore.filter((p) => dist(p, places.headland) < R.reserve.headlandM)
    .map((p) => ({ p, w: waterShare(terrain, p.x, p.z, 150) + waterShare(terrain, p.x, p.z, 60) / 16 })).sort((a, b) => b.w - a.w || a.p.s - b.p.s)[0]?.p ?? places.headland;
  const tx2 = tip.x - tip.nx * R.tower.inland, tz2 = tip.z - tip.nz * R.tower.inland;
  const tower = { x: tx2, z: tz2, y: terrain.heightAt(tx2, tz2), heightM: R.tower.heightM, facing: Math.atan2(tip.nx, tip.nz) };

  for (const q of piers) q.endDepth = -terrain.heightAt(q.x + q.dirX * q.length, q.z + q.dirZ * q.length);
  // no floats (the owner's rule, 2026-11-05: what is not good enough does not ship): no mooring balls, no boats
  // on them, no hazard or 5-mph buoys. The empty lists keep their readers (the chart, the tackle, the Cruise navigator,
  // the logbook) as they were.
  return { shore, piers, balls: [], field: [], hazards: [], speedLine: [], tower, places, rules: R };
}
