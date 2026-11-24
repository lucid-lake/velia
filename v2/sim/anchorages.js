// The chart's anchorages (owner, 2026-11-17: "I have never seen the anchor work once": most of Emerald Bay is deeper than the
// anchor's 20 m). A few good spots over the whole lake, found on the planner's depth grid (v2/ui/planChart.js: v1's terrain at
// 10 m in the bay, 40 m on the lake) and baked by tools/v2-anchorage-bake.mjs into v2/sim/anchorages.json:
//   depth    5–15 m at the spot (well inside the anchor's 3–20 m) and 3–20 m everywhere 35 m round it (she swings on the rode)
//   room     at least 50 m from the shore, 40 m from any pier, ball or the harbour's basin
//   shelter  land within 2 km on at least 6 of 16 bearings (a cove, a bay's head, behind a point); the most sheltered first
//   reach    on the lake's own water (flooded from the Sail start over the lake grid; a pond on the chart never counts)
//   spacing  1500 m apart at least, one a name, ANCHORAGE.max of them: a few marks, not a rash of icons
// Each one is named for the nearest place (v1's bay names and the lake's coves; "the west shore" past them) with "Shallows" under
// 10 m, else "Anchorage". The skipper names the nearest when the water is too deep (v2/sim/seamanship.js); the chart draws them
// (src/ui/chartplotter.js anchorages) and a tap on one sets it as AUTO's target (v2/ui/sail.js). Pure.
//   findAnchorages(chart, { start, places }) → [{ x, z, depth, shelter, name }]
//   nearestAnchorage(list, x, z) → { spot, d } | null;  spotLine(spot, boat) → 'Shallows by Fannette, 200 m ahead'
export const ANCHORAGE = Object.freeze({
  step: 40, depth: [5, 15], ring: { r: 35, depth: [3, 20] }, shoreM: 50, objM: 40,
  shelter: { rays: 16, reach: 2000, step: 100, min: 6 }, sepM: 1500, max: 14, nameM: 2500, shallowM: 10,
});

// the places a spot may be named for (x, z: world m; the bay's from v1's profile, the lake's from their public lat, lon by the
// bake): the nearest within ANCHORAGE.nameM wins
export const BAY_PLACES = Object.freeze([
  { name: 'Fannette', at: [0, 0], by: 'by' }, { name: 'Vikingsholm', at: [-549, 217], by: 'off' },
  { name: 'the falls', at: [-896, 173], by: 'under' }, { name: 'the narrows', at: [1000, -930], by: 'by' },
]);

const SIDES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function findAnchorages(chart, { start = [1200, -1050], places = BAY_PLACES, centre = [4800, -15000], K = ANCHORAGE } = {}) {
  const R = chart.region, D = (x, z) => chart.depthAt(x, z), S = (x, z) => chart.shoreAt(x, z);
  const nx = Math.floor((R.x1 - R.x0) / K.step) + 1, nz = Math.floor((R.z1 - R.z0) / K.step) + 1;
  // the lake's own water: a flood over the grid from the start (4-neighbour, any water deeper than 0.5 m)
  const wet = new Uint8Array(nx * nz);
  const i0 = Math.round((start[0] - R.x0) / K.step), j0 = Math.round((start[1] - R.z0) / K.step);
  const stack = [j0 * nx + i0];
  wet[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const q = b * nx + a;
      if (wet[q] || !(D(R.x0 + a * K.step, R.z0 + b * K.step) > 0.5)) continue;
      wet[q] = 1; stack.push(q);
    }
  }
  const cands = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!wet[j * nx + i]) continue;
    const x = R.x0 + i * K.step, z = R.z0 + j * K.step, d = D(x, z);
    if (!(d >= K.depth[0] && d <= K.depth[1])) continue;
    if (S(x, z) < K.shoreM || (chart.objAt && chart.objAt(x, z) < K.objM) || (chart.buoyAt && chart.buoyAt(x, z) < K.objM)) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) { const a = k * Math.PI / 4, q = D(x + Math.cos(a) * K.ring.r, z + Math.sin(a) * K.ring.r); if (!(q >= K.ring.depth[0] && q <= K.ring.depth[1])) ok = false; }
    if (!ok) continue;
    let shelter = 0;
    for (let k = 0; k < K.shelter.rays; k++) {
      const a = k * 2 * Math.PI / K.shelter.rays, c = Math.cos(a), s = Math.sin(a);
      for (let r = K.shelter.step; r <= K.shelter.reach; r += K.shelter.step) if (S(x + c * r, z + s * r) < 0) { shelter++; break; }
    }
    if (shelter >= K.shelter.min) cands.push({ x, z, depth: d, shelter });
  }
  // the most sheltered first; then the depth nearest 10 m, then the most room
  cands.sort((a, b) => b.shelter - a.shelter || Math.abs(a.depth - 10) - Math.abs(b.depth - 10) || S(b.x, b.z) - S(a.x, a.z) || a.z - b.z || a.x - b.x);
  const out = [], names = new Set();
  for (const c of cands) {
    if (!out.every((p) => Math.hypot(p.x - c.x, p.z - c.z) >= K.sepM)) continue;
    const name = nameOf(c, places, centre, K);
    if (names.has(name)) continue;   // one spot a name: the more sheltered one
    names.add(name); out.push({ x: c.x, z: c.z, depth: +c.depth.toFixed(1), shelter: c.shelter, name });
    if (out.length >= K.max) break;
  }
  return out;
}

function nameOf(c, places, centre, K) {
  let best = null, bd = K.nameM;
  for (const p of places) { const d = Math.hypot(p.at[0] - c.x, p.at[1] - c.z); if (d < bd) { bd = d; best = p; } }
  const kind = c.depth < K.shallowM ? 'Shallows' : 'Anchorage';
  if (best) return `${kind} ${best.by ?? 'by'} ${best.name}`;
  const a = Math.atan2(c.x - centre[0], -(c.z - centre[1]));   // the bearing from the lake's middle (clockwise from north)
  return `${kind} on the ${SIDES[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]} shore`;
}

export function nearestAnchorage(list, x, z) {
  let best = null, bd = Infinity;
  for (const s of list ?? []) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  return best ? { spot: best, d: bd } : null;
}

// the distance a skipper says: tens of metres under a kilometre, tenths of a kilometre past it
export const sayDistance = (d) => (d < 950 ? `${Math.max(10, Math.round(d / 10) * 10)} m` : `${(d / 1000).toFixed(1)} km`);
// the bearing from the bow (heading clockwise from north; x east, z south)
export function relBearing(boat, x, z) {
  const b = Math.atan2(x - boat.x, -(z - boat.z)), a = ((b - (boat.heading ?? 0)) * 180 / Math.PI % 360 + 540) % 360 - 180, m = Math.abs(a), side = a > 0 ? 'starboard' : 'port';
  return m < 22.5 ? 'ahead' : m < 67.5 ? `off the ${side} bow` : m < 112.5 ? `to ${side}` : m < 157.5 ? `off the ${side} quarter` : 'astern';
}
export const spotLine = (spot, boat) => `${spot.name}, ${sayDistance(Math.hypot(spot.x - boat.x, spot.z - boat.z))} ${relBearing(boat, spot.x, spot.z)}`;

// The quiet cue (owner, 2026-11-18: "during the game the player doesn't know where to anchor"): while the boat is
// inside a charted anchorage (within CUE.inM of its spot; she leaves at CUE.outM, so the edge never flickers), or a free mooring ball
// is near her bow (within CUE.ballInM, out at ballOutM: the skipper's ballNear distance), the cockpit's ANCHOR lamp glows faintly
// amber and the chart's glyph lifts (v2/ui/sail.js; src/ui/chartplotter.js). No popup, no new line. Pure.
//   anchorageCue(list, x, z, was) → the spot she is inside (was: last frame's, for the hysteresis) | null
//   ballCue(d, was) → true while a free ball is near (d: the bow's distance to the nearest free ball, m)
export const CUE = Object.freeze({ inM: 120, outM: 150, ballInM: 40, ballOutM: 60 });
export function anchorageCue(list, x, z, was = null, K = CUE) {
  if (was && Math.hypot(was.x - x, was.z - z) < K.outM && (list ?? []).includes(was)) return was;
  const n = nearestAnchorage(list, x, z);
  return n && n.d < K.inM ? n.spot : null;
}
export const ballCue = (d, was = false, K = CUE) => (d == null ? false : d < (was ? K.ballOutM : K.ballInM));
