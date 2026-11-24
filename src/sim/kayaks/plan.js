// Who is out on the water, and when (feat/kayaks-lake). Plain JS, no three.js. Deterministic: the seed,
// the hour, the wind and the storm give the same fleet; no Math.random, no wall clock.
//
//   kayakCount({ hour, windMs, storm, seed })      → how many kayaks are out (0–6)
//   planFleet({ seed, terrain, start })             → the day's slots: [{ id, route, s0, colour, sex, pfd, personality,
//                                                     seed, restLeft, meet }] in order; the first kayakCount() of them are out
//                                                     start ({ x, z, heading (rad) }: the sailboat at the scene's start)
//                                                     times the first two on the crossings to meet it (step 2, below)
//   fleetAt({ seed, terrain, hour, windMs, storm }) → planFleet's slots that are out at that hour
//
// The habits (real Emerald Bay use): busiest in the calm morning (07:00–11:00), fewer as the afternoon wind rises, none
// at night or in a storm. Each slot keeps its route and looks all day: a higher count adds slots, a lower one retires the
// last ones, so the fleet changes one kayak at a time as the day goes on.
import { kayakRoutes } from './routes.js';

// a seeded unit number (no state): the page's seed, a slot, a field
export function hash01(seed, a = 0, b = 0) {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(a + 1, 0xc2b2ae35) ^ Math.imul(b + 7, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export const KAYAK_DAY = Object.freeze({
  first: 6.5,        // h: the first launch (after the glassy dawn)
  peak: [7.5, 11],   // h: the busy calm morning
  last: 20.5,        // h: all ashore by sunset (20:29 on the map's day)
  calmMs: 3,         // m/s: below this the wind does not thin the fleet
  maxMs: 8,          // m/s: at and above this nobody is out (whitecaps; a lake wind advisory)
  peakCount: [3, 6], // the morning's count, by seed
  max: 6,
});
import { smooth } from '../core/math.js';

// the share of the morning's peak that is out at an hour (0–1)
function dayShare(hour) {
  const h = ((hour % 24) + 24) % 24, D = KAYAK_DAY;
  if (h < D.first || h >= D.last) return 0;
  if (h < D.peak[0]) return 0.34 + 0.66 * smooth(D.first, D.peak[0], h);
  if (h <= D.peak[1]) return 1;
  if (h < 14) return 1 - 0.5 * smooth(D.peak[1], 14, h);          // the late morning thins as the breeze comes up
  if (h < 18) return 0.5;
  return 0.5 - 0.33 * smooth(18, D.last, h);                        // the evening: a few last ones
}
function windShare(windMs) {
  const D = KAYAK_DAY;
  return 1 - smooth(D.calmMs, D.maxMs, windMs ?? 0);
}
export function kayakCount({ hour, windMs = 0, storm = false, seed = 1 } = {}) {
  if (storm) return 0;
  const D = KAYAK_DAY, peak = D.peakCount[0] + Math.floor(hash01(seed, 101) * (D.peakCount[1] - D.peakCount[0] + 1));
  const f = dayShare(hour) * windShare(windMs);
  if (f <= 0.04) return 0;
  return Math.min(D.max, Math.max(1, Math.round(peak * f)));
}

// the kinds a slot may take, weighted (most keep to the shore; one in five crosses from the beach to the island)
const KINDS = [['shore', 0.40], ['beach', 0.20], ['island', 0.15], ['cove', 0.25]];
// The meeting (step 2; owner 2026-11-08: "the kayak is one of our hero features; I expect we should be able to see them
// closely, clearly from the boat"): with the sailboat's start known, the first two slots (the ones out whenever anyone
// is) paddle the crossings its way in passes over, timed so that a normal sail from the start (on the start's heading, or
// bearing away for Fannette: the line between the two is the one aimed at) comes up to them in the first minutes, each
// on a course that would cross close ahead of the bow: the kayaker has to see the boat and choose. The rest keep the
// day's habits.
export const MEET = Object.freeze({
  boatMs: 3.3,          // m/s: the sailboat's speed on a normal sail from the start (2.75 at the start, 3.1–3.6 on the reach)
  kayakMs: 1.28,        // m/s: a kayak's speed along a straight crossing (cruise 1.31)
  window: [60, 200],    // s: the meetings fall in this window of the sail (d ≈ 200–660 m: a minute or more, time for the kayak to keep pace)
  lead: [-9, -6],       // s: the kayak reaches the line this long before the boat would (by seed; −: after it, so it passes the stern close)
  slots: 2,
  firstLine: 0.15,      // the first meeting's line: this share of the way from the start's heading to the island's
});
// where a route crosses the ray from (x, z) on heading h: [{ s, d }] (s along the route, d along the ray), d > 0
export function routeCrossings(route, x, z, h) {
  const out = [], sx = Math.sin(h), sz = -Math.cos(h); let prev = null;
  for (let s = 0; s <= route.path.length; s += 2) {
    const p = route.path.at(s), rx = p.x - x, rz = p.z - z, along = rx * sx + rz * sz, across = rx * -sz + rz * sx;
    if (prev && Math.sign(across) !== Math.sign(prev.across) && along > 0) out.push({ s: s - 1, d: (along + prev.along) / 2 });
    prev = { along, across };
  }
  return out;
}
// the heading from the start to Fannette (the start's own heading if the island is not within 60° of it)
function islandHeading(start, terrain) {
  const I = terrain.lake?.island; if (!I) return start.heading;
  const toI = Math.atan2(I.x - start.x, -(I.z - start.z)), d = Math.atan2(Math.sin(toI - start.heading), Math.cos(toI - start.heading));
  return Math.abs(d) < Math.PI / 3 ? toI : start.heading;
}
// the line a normal sail from the start follows: halfway between the start's heading and the heading to the island
function meetHeading(start, terrain) {
  const I = terrain.lake?.island; if (!I) return start.heading;
  const toI = Math.atan2(I.x - start.x, -(I.z - start.z)), d = Math.atan2(Math.sin(toI - start.heading), Math.cos(toI - start.heading));
  return Math.abs(d) < Math.PI / 3 ? start.heading + d / 2 : start.heading;
}
const COLOURS = ['yellow', 'red', 'orange'];
const PFDS = ['red', 'orange', 'yellow', 'blue'];
const PERSONALITIES = Object.freeze(['experienced', 'casual', 'distracted']);

export function planFleet({ seed = 1, terrain, start = null }) {
  const lib = kayakRoutes(terrain), slots = [];
  // the meetings: the crossings the start's way in passes over in the window, one per slot (the nearer first)
  const meets = [];
  if (start) {
    const h = meetHeading(start, terrain);
    const cands = lib.routes.filter((r) => r.kind === 'crossing').map((r) => ({ r, xs: routeCrossings(r, start.x, start.z, h).filter((c) => c.d / MEET.boatMs >= MEET.window[0] && c.d / MEET.boatMs <= MEET.window[1]) })).filter((c) => c.xs.length);
    cands.sort((p, q) => p.xs[0].d - q.xs[0].d);
    // the nearest crossing first (out whenever anyone is: a sail at the evening's default meets one), then the next; by
    // seed, which leg (the over or the back) and the lead
    // the first on the start's own heading (a sail that holds it), the second on the line for Fannette (a sail that bears
    // away for the island): each sail comes close to one of them
    const toI = islandHeading(start, terrain), dI = Math.atan2(Math.sin(toI - start.heading), Math.cos(toI - start.heading));
    const lines = [start.heading + MEET.firstLine * dI, toI];
    for (const [k, c] of cands.slice(0, MEET.slots).entries()) {
      const xs = routeCrossings(c.r, start.x, start.z, lines[k] ?? h).filter((q) => q.d / MEET.boatMs >= MEET.window[0] && q.d / MEET.boatMs <= MEET.window[1] * 1.2);
      const pool = xs.length ? xs : c.xs, x = pool[Math.floor(hash01(seed, 202, k) * pool.length) % pool.length];
      const lead = MEET.lead[0] + (MEET.lead[1] - MEET.lead[0]) * hash01(seed, 203, k);
      const tKayak = x.d / MEET.boatMs - lead, L = c.r.path.length;
      meets.push({ route: c.r, s0: (((x.s - tKayak * MEET.kayakMs) % L) + L) % L, at: x, t: x.d / MEET.boatMs });
    }
  }
  const byKind = (k) => lib.routes.filter((r) => r.kind === k);
  for (let i = 0; i < KAYAK_DAY.max; i++) {
    const u = (f) => hash01(seed, i, f);
    // the kind, then a route of that kind (an empty kind falls back to the shore)
    const meet = meets[i] ?? null;
    let pick = u(1), kind = KINDS[KINDS.length - 1][0];
    for (const [k, w] of KINDS) { if (pick < w) { kind = k; break; } pick -= w; }
    if (!lib.routes.length) break;
    // a route nobody else has, while there are any: of the kind, else a shore tour, else any
    const free = (rs) => rs.filter((r) => !slots.some((s) => s.route === r));
    const from = [free(byKind(kind)), free(byKind('shore')), free(lib.routes), lib.routes].find((rs) => rs.length);
    const route = meet ? meet.route : from[Math.floor(u(2) * from.length) % from.length];
    // where along it: apart from anyone on the same route (≥ 80 m)
    let s0 = meet ? meet.s0 : u(3) * route.path.length;
    for (let k = 0; k < 8 && !meet && slots.some((s) => s.route === route && Math.abs(s.s0 - s0) < 80); k++) s0 = (s0 + route.path.length / 3) % route.path.length;
    // resting now? a slot whose route rests may start mid-rest; a few drift wherever they are
    const rest = route.rests[0];
    const restLeft = meet ? 0 : rest && u(4) < 0.35 ? (s0 = rest.s, rest.dur * (0.2 + 0.8 * u(5))) : u(6) < 0.15 ? 20 + 60 * u(7) : 0;
    slots.push({
      id: `kayak-${i}`, slot: i, route, kind: route.kind, s0, restLeft,
      colour: COLOURS[Math.floor(u(8) * COLOURS.length) % COLOURS.length],
      sex: u(9) < 0.5 ? 'male' : 'female',
      pfd: PFDS[Math.floor(u(10) * PFDS.length) % PFDS.length],
      personality: PERSONALITIES[Math.floor(u(11) * 3) % 3],
      seed: 1 + Math.floor(u(12) * 9973),   // the paddler's own seed (its look's other picks, its idles)
      wear: 0.2 + 0.4 * u(13),
      meet: meet ? { s: meet.at.s, d: meet.at.d, t: meet.t } : null,
    });
  }
  return slots;
}

export function fleetAt({ seed = 1, terrain, hour, windMs = 0, storm = false, start = null }) {
  const n = kayakCount({ hour, windMs, storm, seed });
  return planFleet({ seed, terrain, start }).slice(0, n);
}
