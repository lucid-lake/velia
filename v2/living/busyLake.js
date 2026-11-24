// The busy lake (owner, 2026-11-18: "No staged kayaks at the opening. We should stage a few different boats near the birthplace, but
// not staged by the birth camera angle — make it natural; it's a busy lake"; BACKLOG "(P2) A busy bay"). Sailboats cruising the
// lake by a per-seed schedule, never aimed at the camera: each boat has her own route (a lane she sails round, or out through the
// entrance channel and back) and the seed sets where on it she is when the page opens; she sails it with v1's computer skipper on
// v1's boat physics (the Regatta rivals' brain and hull: beating, reaching, tacking, gybing to the real wind), at cruising skill.
//
// Region by region (owner, 2026-11-18: "when we add a new birthplace, we build the other boats and facilities around it; we don't
// waste resources on areas with no birthplace"): the traffic is data, a REGIONS row per birthplace region (the waters' birthplaces'
// `region`), each owning its boats and routes. A region with no birthplace is never spawned; a region is live only while the player
// is in it or in a neighbour of it. Adding a region is a data step: a row in the lake profile's region table (v2/sim/regions.js: centre, radius, neighbours, boats)
// with its birthplaces; v2/tests/busy-lake.test.mjs checks every row's routes on the chart.
//
// Right of way: a boat keeps clear of the player always (a courteous skipper: she bears away or holds off well before the rules
// would make her), of the boats at anchor, and of the other traffic by the rules (port gives way to starboard, windward to leeward;
// the stand-on boat acts only at the last moment, rule 17); she leaves the channel's buoys to the rules too: inside the entrance
// channel she steers down its starboard side (sim/channelHelm.js, keepRight) and, when the channel's line lies too close to the wind
// to sail, she furls and motors through as a skipper does in a 36 m lane. Hull against hull with the player: v1's contact (an
// impulse with both masses; no boat sails through another), so she is softly bumpable.
// They stand down in a race (Regatta has its own fleet), during the fireworks evening and at night (they sail the day: DAY hours);
// a boat leaves or joins only out of the eye's way (BUSY.popM).
// Pure: no DOM, no GPU, no Math.random, no wall clock (the seed and the sim clock only).
//   const L = createBusyLake({ seed, birthplaces, depthAt, windAt, tier, starts })
//   L.post(S, dt, t, { eye, hour, race, show, anchored, others })   the boat's tick (sea.addPost): brains, physics, avoidance, contact;
//                                         others: other vessels always kept clear, [{ x, z, heading, u, m }] (the glass boat, her kayaks)
//   L.boats → [{ id, region, phys, ctl, tint, bare, live }]   (live: spawned and stepped)
//   L.active (false: a race or the show; nothing stepped or drawn)    L.stats
//   L.knock(id, { K, t, holdS }) Tessie's weight on her rail (play as Tessie): a roll moment K (N·m, signed as the heel) over
//                                0.4 s up, 1.2 s held, 0.8 s down on her physics (the large-angle righting arm on), the crew letting the sheets fly.
//                                Past CAPSIZE.overDeg she stays capsized (owner, 2026-11-20: "they stay capsized"): on her side, sails flat on the
//                                water, drifting slowly downwind (the float bobs her); she rights and sails on only after CAPSIZE.minS and out of the
//                                eye's view (ctx.fwd: the camera's forward; outside CAPSIZE.viewDeg of it, or CAPSIZE.farM away): never upright on
//                                screen. A knock that never lays her over is over after holdS (she rights and sails on)
//   others may carry seeM: a threat she keeps clear of only while it is within seeM (Tessie seen)
//   activeRegions(regions, live, x, z) → Set of region ids     spawnOf(boat, seed, ctx) → { x, z, heading, leg, speed, side }
import { CONTROLS, DT, KN } from '../../src/sim/boat.js';
import { craftOf } from '../../src/sim/craft/index.js';
import { AISkipper, polarKn, polarTargets } from '../../src/sim/ai/skipper.js';
import { atFault } from '../../src/sim/race/rules.js';
import { hullContact } from '../../src/sim/race/contact.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { createChannelHelm, CHANNEL_HELM } from '../sim/channelHelm.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { busyRegionsOf } from '../sim/regions.js';   // the region table (refactor round 3 C5)
import { clearLook, CLEAR } from '../sim/clearLook.js';   // the clear look (moved to sim/, refactor round 3 C6: Tessie's flee reads it too)

const DEG = Math.PI / 180, TAU = 2 * Math.PI;
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const fromOf = (w) => Math.atan2(-w.vx, w.vz);   // the wind's FROM (compass rad) from its velocity (src/sim/boat.js steadyWind)

export const BUSY = Object.freeze({
  skill: 0.7,            // the skipper's skill: a tidy cruising sailor (Regatta's Club tier is 0.62)
  spawnClearM: 250,      // m: no boat starts within this of a birthplace, the Sail start or the player's own start
  spawnGapM: 180, spawnGapMinM: 70,   // m: nor this near another boat's start (a crowded lane: the second figure)
  spawnAnchoredM: 120,   // m: nor this near a boat at anchor
  channelClearM: 60,     // m: nor in the entrance channel (she joins it on her way, keeping to its starboard side)
  spawnStepM: 20,        // m: the step along her route past a refused place
  jumpM: 300,            // m: the player's boat moving this far in one tick is a jump (a birthplace move)
  popM: 900,             // m: a boat joins (a region going live, the morning) or leaves (a region left, the evening) only this far from the eye
  day: Object.freeze([9, 19.5]),   // the hours the traffic is out (local clock); after it they are home, so no running lights are needed
  ...CLEAR,              // minDepthM 2.6, clearDepthM 4.5: the clear look's water (sim/clearLook.js)
  clearK: 1.8,           // the clear look: 1.8 × the skipper's 20 s (36 s ahead)
  channelEndM: 120, channelInM: 160,   // a waypoint this near a channel end is that end; a channel leg's helm catches her this far off the line
  windS: 0.25, windM: 6,   // a boat's wind sample is kept this long (s of sim time) or this far (m)
  arriveM: 60,          // m: a waypoint's radius
  avoid: Object.freeze({ everyS: 0.25, aheadS: 25, rangeM: 320, playerM: 60, anchoredM: 30, trafficM: 40, holdS: 5, stepDeg: 10, maxDeg: 70, noGoDeg: 50, standOnS: 4, standOnM: 12, calmS: 6, tackClearM: 150, boatClearM: 90, tourM: 45, kayakM: 25 }),   // tourM, kayakM: the glass boat and her kayaks (ctx.others)
  motorThrottle: 0.65, motorNoGoDeg: 50,   // the channel: furl and motor when its line is within this of the wind
});

// the boats' topsides (white hulls, a few coloured, as a marina's mix) and the device tiers: max boats live at once, nearest regions first
const BUSY_TINTS = Object.freeze(['#f4f2ec', '#f1efe8', '#1d3557', '#f3f1ea', '#2f5d50', '#efece4']);
export { clearLook };
export const BUSY_TIERS = Object.freeze({ full: Object.freeze({ max: 6 }), lite: Object.freeze({ max: 3 }), phone: Object.freeze({ max: 1 }), off: Object.freeze({ max: 0 }) });

// the regions: the lake profile's region table (src/waters/<id>.json `regions`, v2/sim/regions.js; refactor round 3 C5), one row
// per region, each owning its traffic. A boat: id, route (waypoints [x, z], sailed in order and round again; a channel run lists the
// channel's two ends on her way out and back), tint (the topsides: BUSY_TINTS' mix), prio (lower: kept first when a tier caps),
// sail: her main's print (render/sailArt.js packArt's spec: cloth, inkA the mark and number, inkB the rose at roseAlpha; number ''
// none) or null (the plain cream main). Cruising boats are calmer than Regatta's fleet: a faint rose, the Velia mark alone or plain
// cloth, club numbers on two; their hulls mostly white with a navy and a green (Regatta alone forces white). Its kayakers (owner,
// 2026-11-19: the region owns them; they live here all day, wherever the player is; 2026-11-21: lanes the sailboats' way, mostly
// pairs): a lane each, a closed loop; colour: the hull's (v1's kayak colours), pfd: the buoyancy aid's; mate: a second kayaker on
// the same lane, KAYAK_LIFE.apartM behind (a pair). keepOut: discs [x, z, r] (Fannette Island and its fringe) no heading enters.
export const REGIONS = busyRegionsOf(CURRENT_WATERS);

// a seeded hash in [0, 1) (birthplace.js's)
export function hash01(seed, k) {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const strHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// the regions with a birthplace (live: the set of region ids the waters' birthplaces name)
export const regionsWithBirthplaces = (regions, birthplaces) => { const live = new Set((birthplaces ?? []).map((b) => b.region).filter(Boolean)); return regions.filter((r) => live.has(r.id)); };
// the live regions at (x, z): the one she is in (the nearest centre within its radius) and its neighbours, of those with a birthplace
export function activeRegions(regions, x, z) {
  let best = null, bd = Infinity;
  for (const r of regions) { const d = Math.hypot(x - r.centre[0], z - r.centre[1]); if (d <= r.radiusM && d < bd) { bd = d; best = r; } }
  const out = new Set();
  if (!best) return out;
  out.add(best.id);
  for (const n of best.neighbours ?? []) if (regions.some((r) => r.id === n)) out.add(n);
  return out;
}

// a route's legs as one cyclic polyline: the point at arc length s and the leg it lies on
function routeAt(route, s) {
  const n = route.length; let L = 0;
  for (let i = 0; i < n; i++) { const a = route[i], b = route[(i + 1) % n]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  s = ((s % L) + L) % L;
  for (let i = 0; i < n; i++) {
    const a = route[i], b = route[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i === n - 1) { const f = l > 0 ? Math.min(1, s / l) : 0; return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, next: (i + 1) % n, L }; }
    s -= l;
  }
  return { x: route[0][0], z: route[0][1], next: 1, L };
}

// where a boat is when the page opens (pure, deterministic in the seed): a seeded point on her route, moved on along it past any
// place too near a start, another boat's start, a boat at anchor or the channel; her heading the course to her next waypoint (a beat:
// close-hauled on a seeded tack), her speed the polar's there. ctx: { windAt(x, z, t), starts: [[x, z]], taken: [[x, z]], anchored:
// [[x, z]], depthAt, K }
export function spawnOf(boat, seed, { windAt = null, starts = [], taken = [], anchored = [], depthAt = null, keepOut = [], K = BUSY } = {}) {
  const r0 = routeAt(boat.route, 0), L = r0.L, s0 = hash01(seed, strHash(boat.id)) * L;
  let gap = K.spawnGapM;
  const ok = (p) => starts.every((q) => Math.hypot(q[0] - p.x, q[1] - p.z) >= K.spawnClearM) && taken.every((q) => Math.hypot(q[0] - p.x, q[1] - p.z) >= gap)
    && anchored.every((q) => Math.hypot(q[0] - p.x, q[1] - p.z) >= K.spawnAnchoredM) && keepOut.every(([cx, cz, r]) => Math.hypot(cx - p.x, cz - p.z) >= r) && channelAt(p.x, p.z, CHANNEL).d >= K.channelClearM && (!depthAt || depthAt(p.x, p.z) >= K.minDepthM + 1.4);
  const walk = () => { let p = routeAt(boat.route, s0), tries = 0; while (!ok(p) && tries * K.spawnStepM < L) { tries++; p = routeAt(boat.route, s0 + tries * K.spawnStepM); } return ok(p) ? p : null; };
  let p = walk();
  if (!p) { gap = K.spawnGapMinM; p = walk(); }   // a crowded lane: closer to another boat (never nearer than spawnGapMinM)
  if (!p) return null;
  const wp = boat.route[p.next], brg = Math.atan2(wp[0] - p.x, -(wp[1] - p.z));
  const w = windAt ? windAt(p.x, p.z, 0) : { vx: 0, vz: 5 }, tws = Math.hypot(w.vx, w.vz), from = fromOf(w);
  const tg = polarTargets(Math.max(1, tws)), up = (tg.up.twa + 4) * DEG, dn = tg.down.twa * DEG;
  const rel = wrap(brg - from), side0 = hash01(seed, strHash(boat.id) + 7) < 0.5 ? 1 : -1;
  let heading = brg, side = rel < 0 ? 1 : -1;   // + starboard tack (the wind over the starboard side: she heads left of the wind)
  if (Math.abs(rel) < up) { side = side0; heading = wrap(from - side * up); }
  else if (Math.abs(rel) > dn) { side = side0; heading = wrap(from + Math.PI + side * (Math.PI - dn)); }
  const twa = Math.abs(wrap(heading - from)) / DEG, speed = tws > 0.5 ? 0.85 * polarKn(tws, twa) * KN : 0.5;
  return { x: p.x, z: p.z, heading, leg: p.next, speed, side };
}

// the closest point of approach (regatta/fleet.js cpa's maths) of me on heading h at speed u against o's present velocity
function cpaOn(me, h, u, o, ahead) {
  const vx = Math.sin(o.heading) * (o.u ?? 0) - Math.sin(h) * u, vz = -Math.cos(o.heading) * (o.u ?? 0) + Math.cos(h) * u;
  const px = o.x - me.x, pz = o.z - me.z, vv = vx * vx + vz * vz;
  const t = vv < 1e-6 ? 0 : Math.max(0, Math.min(ahead, -(px * vx + pz * vz) / vv));
  return { t, d: Math.hypot(px + vx * t, pz + vz * t) };
}

// the heading that keeps her clear of the threats (pure): the course she wants, turned by up to maxDeg in stepDeg steps (bearing away
// first on a tie), never into the no-go cone, never at shoal water (clear); null when the course she wants is already clear.
// threats: [{ x, z, heading, u, m }] (m: the miss distance she keeps from that one)
export function evadeHeading(me, want, threats, windFrom, clear = null, A = BUSY.avoid) {
  const u = Math.max(1.2, me.u ?? 0);
  const miss = (h) => { let worst = Infinity; for (const o of threats) { const c = cpaOn(me, h, u, o, A.aheadS); worst = Math.min(worst, c.d - o.m); } return worst; };
  if (miss(want) >= 0) return null;
  // turning this way bears away from the wind; meeting another boat end-on, both turn to starboard (rule 14's habit: two boats that
  // each bear away can turn toward each other)
  const end = threats.find((o) => o.boat && Math.abs(wrap(o.heading - want)) > 150 * DEG);
  const endSide = end ? (wrap(Math.atan2(end.x - me.x, -(end.z - me.z)) - want) > 0 ? -1 : 1) : 0;   // end-on: turn away from the side she already lies on (each boat sees the other on the same hand: both turn the same way round)
  const awaySign = endSide || (wrap(want - windFrom) > 0 ? 1 : -1);
  let best = null, bestScore = -Infinity;
  for (let k = 1; k * A.stepDeg <= A.maxDeg; k++) for (const sgn of endSide ? [endSide, endSide] : [awaySign, -awaySign]) {
    const h = wrap(want + sgn * k * A.stepDeg * DEG);
    if (Math.abs(wrap(h - windFrom)) < A.noGoDeg * DEG) continue;
    if (clear && !clear(h, 20, me)) continue;
    const m = miss(h), score = Math.min(m, 0) * 10 - k * A.stepDeg * 0.05 + (sgn === awaySign ? 0.2 : 0);
    if (m >= 0) return h;   // the smallest clear turn, bearing away first
    if (score > bestScore) { bestScore = score; best = h; }
  }
  return best;
}

// Tessie's knock's roll moment over time (the revenge's B.shove profile)
const KNOCK_ROLL = Object.freeze({ riseS: 0.4, holdS: 1.2, fallS: 0.8 });
// a capsized boat (owner, 2026-11-20): over past overDeg she lies at lieDeg (± bobDeg), drifting at drift × the wind; she rights after minS out of view
export const CAPSIZE = Object.freeze({ overDeg: 60, lieDeg: 86, bobDeg: 2.5, drift: 0.03, minS: 90, viewDeg: 60, farM: 400 });

// play as Tessie's jolt where her jaw meets a boat (the owner's son, 2026-11-21: "attacking the water at the side of the
// sailboat, not really the boat"): px, pz the shove (m, away from her, over pushS s), and the drawn float's kick (heave m, roll and pitch
// rad) ringing down at hz over tau s; a rising strike lifts the hull (heave +) as her back meets its bottom
export const BUMP = Object.freeze({ px: 0, pz: 0, pushS: 0.4, heave: 0, roll: 0, pitch: 0, hz: 1.4, tau: 0.45, lastS: 2.5 });
// the float's kick now (m, rad, rad), or null when none
export function bumpAt(b, t) {
  const p = b?.bump; if (!p) return null;
  const u = t - p.t0; if (u < 0) return null;
  if (u > p.lastS) { b.bump = null; return null; }
  const k = Math.exp(-u / p.tau) * Math.cos(2 * Math.PI * p.hz * u) * Math.min(1, u / 0.06);
  return { heave: p.heave * Math.exp(-u / (p.tau * 2)) * Math.min(1, u / 0.12), roll: p.roll * k, pitch: p.pitch * k };
}

export function createBusyLake({ seed = 1, birthplaces = [], regions = REGIONS, depthAt = () => 20, windAt = null, tier = 'full', starts = [], anchored = [], onBump = null, vessel, K = BUSY } = {}) {
  const live = regionsWithBirthplaces(regions, birthplaces);
  const cap = (BUSY_TIERS[tier] ?? BUSY_TIERS.full).max;
  const keepOut = live.flatMap((r) => r.keepOut ?? []);
  const clearBase = clearLook(depthAt, K, keepOut);
  const startPts = [...birthplaces.map((b) => [b.x, b.z]), ...starts];
  const anchoredPts = anchored.map((a) => [a.x, a.z]);
  const [cb, cl] = [CHANNEL.pts[0], CHANNEL.pts.at(-1)];
  const nearEnd = (p) => (Math.hypot(p[0] - cl[0], p[1] - cl[1]) < K.channelEndM ? 'lake' : Math.hypot(p[0] - cb[0], p[1] - cb[1]) < K.channelEndM ? 'bay' : null);
  // the channel helm (sim/channelHelm.js) with a wider catch: on a channel leg (one end of the channel to the other) she lines up for it
  // from as far as K.channelInM off its line instead of beating across the bar
  const chK = { ...CHANNEL_HELM, inM: K.channelInM };
  const chHelmWide = createChannelHelm({ chart: { channel: CHANNEL, channelSide: (dest) => nearEnd(dest) }, K: chK });
  let now = 0;
  const boats = [];
  for (const r of live) for (const row of r.boats) boats.push({ id: row.id, region: r.id, row, prio: row.prio ?? 0, tint: row.tint ?? BUSY_TINTS[0], phys: null, ctl: null, sk: null, env: null, live: false, knock: null, bare: 0, motoring: false, evade: null, evadeUntil: -1, avoidT: 0, cache: new Map(), spawn: null, want: false });
  boats.sort((a, b) => a.prio - b.prio || (a.id < b.id ? -1 : 1));
  const stats = { live: 0, spawned: 0, despawned: 0, evades: 0, shore: 0, tacks: 0, held: 0, irons: 0, contacts: 0, motoring: 0, stepUs: 0 };
  const shoreTurn = (b, s, windFrom) => { const away = wrap(s.heading - windFrom) > 0 ? 1 : -1; for (let k = 1; k <= 17; k++) for (const sg of [away, -away]) { const h = wrap(s.heading + sg * k * 10 * DEG); if (Math.abs(wrap(h - windFrom)) >= K.avoid.noGoDeg * DEG && b.clear(h, 20, s)) return h; } return null; };   // never into the no-go cone
  let active = true, opened = false, last = { x: NaN, z: NaN }, lastP = { x: NaN, z: NaN }, wantT = -Infinity;

  // the boats that should be out now: in a live region, by the tier's cap (the player's own region first, then its neighbours)
  function wanted(x, z) {
    const ids = activeRegions(live, x, z), first = [...ids][0] ?? null;   // the region she is in is the Set's first
    // her own region by priority; a neighbour's boats by how near their route comes to her (the lane over the region's edge first)
    const reach = (b) => { let m = Infinity; for (const p of b.row.route) m = Math.min(m, Math.hypot(p[0] - x, p[1] - z)); return m; };
    const key = (b) => (b.live ? -1e9 : 0) + (b.region === first ? b.prio : 1e6 + reach(b));   // a boat out stays out (no swaps while she sails)
    const list = boats.filter((b) => ids.has(b.region)).sort((a, b) => key(a) - key(b));
    const set = new Set(list.slice(0, cap).map((b) => b.id));
    for (const b of boats) b.want = set.has(b.id);
  }
  function spawn(b, t) {
    const taken = boats.filter((o) => o.live).map((o) => [o.phys.state.x, o.phys.state.z]);
    const sp = spawnOf(b.row, seed, { windAt, starts: startPts, taken, anchored: anchoredPts, depthAt, keepOut, K });
    if (!sp) return false;
    b.spawn = sp;
    b.phys = craftOf(vessel).createPhysics({ x: sp.x, z: sp.z, heading: sp.heading, speed: sp.speed, ...(vessel ? { vessel } : {}) });
    b.ctl = { ...CONTROLS };
    // her wind, sampled at most every windS of sim time or windM of way (the field moves slowly; a sample is the costly part of her tick)
    const wc = { t: -Infinity, x: 0, z: 0, vx: 0, vz: 5 };
    b.wind = (x, z, tt) => { if (windAt && (tt - wc.t >= K.windS || tt < wc.t || Math.abs(x - wc.x) + Math.abs(z - wc.z) > K.windM)) { const w = windAt(x, z, tt); wc.vx = w.vx; wc.vz = w.vz; wc.t = tt; wc.x = x; wc.z = z; } return wc; };
    b.env = { t, windAt: b.wind };
    const clear = (h, secs, st) => { const key = Math.round(h * 28.65), hit = b.cache.get(key); if (hit && now - hit.t < 0.5) return hit.ok; const ok = clearBase(h, secs * K.clearK, st); b.cache.set(key, { ok, t: now }); return ok; };   // a longer look than the skipper's 20 s (no ground under the traffic's hulls)
    b.clear = clear;
    b.sk = new AISkipper({ skill: K.skill, seed: (seed * 131 + strHash(b.id)) >>> 0, windAt: null, clear, arriveM: K.arriveM, ...(vessel ? { vessel } : {}) });
    b.sk.route = b.row.route.map((at) => ({ at })); b.sk.leg = sp.leg;   // { at }: the skipper reads p.at ?? p (a bare array's .at is a method) b.sk.side = sp.side;
    b.live = true; b.evade = null; b.motoring = false; stats.spawned++;
    return true;
  }
  const despawn = (b) => { b.live = false; b.phys = null; b.sk = null; b.motoring = false; stats.despawned++; };

  // the threats a boat keeps clear of: the player (always), the boats at anchor (always), the other traffic when the rules say she gives way
  const threats = [];
  function avoid(b, s, t, player, anchoredNow, windFrom, othersNow = []) {
    const A = K.avoid; threats.length = 0;
    const near = (o) => Math.abs(o.x - s.x) < A.rangeM && Math.abs(o.z - s.z) < A.rangeM;
    if (player && near(player)) threats.push({ x: player.x, z: player.z, heading: player.heading ?? 0, u: Math.max(0, player.u ?? 0), m: A.playerM });
    for (const a of anchoredNow) if (near(a)) threats.push({ x: a.x, z: a.z, heading: 0, u: 0, m: A.anchoredM });
    for (const o of othersNow) if (near(o) && !(o.seeM != null && Math.hypot(o.x - s.x, o.z - s.z) > o.seeM)) threats.push(o);   // seeM: only once she sees it (Tessie)   // the glass boat and her kayaks (main.js): always kept clear, each at its own m
    for (const o of boats) {
      if (o === b || !o.live) continue;
      const q = o.phys.state; if (!near(q)) continue;
      const f = atFault(s, q, windFrom), mine = f.fault === 0;
      if (!mine) { const c = cpaOn(s, s.heading, Math.max(0, s.u), q, A.standOnS); if (!(c.d < A.standOnM && c.t > 0)) continue; }   // stand-on: the last moment only
      threats.push({ x: q.x, z: q.z, heading: q.heading, u: Math.max(0, q.u), m: A.trafficM, boat: true });
    }
    if (!threats.length) return null;
    const close = player && Math.hypot(player.x - s.x, player.z - s.z) < A.tackClearM;
    const w0 = b.sk.rep?.heading, want = close || !Number.isFinite(w0) || Math.abs(wrap(w0 - s.heading)) > 60 * DEG ? s.heading : w0;   // the player close, or her skipper's course far round (the other board): from the course she is on (an evasion is never a tack)
    return evadeHeading(s, Number.isFinite(want) ? want : s.heading, threats, windFrom, b.clear, A);
  }

  // the boat's tick: S the player's physics state (her contact and the avoidance read it)
  function post(S, dt, t = 0, { eye = null, fwd = null, hour = 12, race = false, show = false, anchored: anchoredNow = [], others: othersNow = [] } = {}) {
    if (race || show) { if (active) { for (const b of boats) if (b.live) despawn(b); } active = false; stats.live = 0; return; }
    active = true;
    const ex = eye ? eye[0] : S?.x ?? 0, ez = eye ? eye[2] : S?.z ?? 0;
    const day = hour >= K.day[0] && hour < K.day[1];
    const px = Number.isFinite(S?.x) ? S.x : ex, pz = Number.isFinite(S?.z) ? S.z : ez;   // the regions and the cap from the player's boat; the eye only for joining and leaving out of sight
    if (t - wantT >= 1 || Math.hypot(px - last.x, pz - last.z) > 200 || !Number.isFinite(last.x)) { wantT = t; last.x = px; last.z = pz; wanted(px, pz); }
    // a jump of the player's boat (a birthplace move under the veil, Start again): no boat lies on her new spot
    if (Number.isFinite(lastP.x) && Math.hypot(px - lastP.x, pz - lastP.z) > K.jumpM) for (const b of boats) if (b.live && Math.hypot(b.phys.state.x - px, b.phys.state.z - pz) < K.spawnClearM) despawn(b);
    lastP.x = px; lastP.z = pz;
    const first = !opened && stats.spawned === 0 && stats.despawned === 0;   // the page's very first tick only: a morning or a race end joins out of the eye's way
    opened = true;
    for (const b of boats) {
      const should = b.want && day;
      if (should && !b.live) {
        if (first) spawn(b, t);   // the page opens with the lake already busy (spawnOf keeps them off the starts)
        else if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) {   // a join mid-session: twice a second, out of the eye's way
          const taken = boats.filter((o) => o.live).map((o) => [o.phys.state.x, o.phys.state.z]);
          const sp = spawnOf(b.row, seed, { windAt, starts: startPts, taken, anchored: anchoredPts, depthAt, keepOut, K });
          if (sp && Math.hypot(sp.x - ex, sp.z - ez) >= K.popM) spawn(b, t);
        }
      } else if (!should && b.live && Math.hypot(b.phys.state.x - ex, b.phys.state.z - ez) >= K.popM) despawn(b);
    }
    now = t;
    const t0 = globalThis.performance?.now?.() ?? 0;
    let nLive = 0, nMotor = 0;
    for (const b of boats) {
      if (!b.live) continue;
      nLive++;
      // capsized (Tessie's knock): on her side, drifting; she rights only after CAPSIZE.minS and out of the eye's view
      if (b.knock?.capsized) {
        const kn = b.knock, s = b.phys.state, w = b.wind(s.x, s.z, t), C = CAPSIZE;
        s.heel = kn.side * (C.lieDeg + C.bobDeg * Math.sin(t * 0.7 + kn.side)) * DEG; b.phys.p = 0;
        s.x += w.vx * C.drift * dt; s.z += w.vz * C.drift * dt; s.u = 0; s.v = 0; s.yawRate = 0; s.sog = Math.hypot(w.vx, w.vz) * C.drift;
        const ex2 = eye ? eye[0] : ex, ez2 = eye ? eye[2] : ez, dx = s.x - ex2, dz = s.z - ez2, d = Math.hypot(dx, dz);
        const seen = d < C.farM && (!fwd || ((dx * fwd[0] + dz * fwd[2]) / Math.max(1e-6, d * Math.hypot(fwd[0], fwd[2]))) > Math.cos(C.viewDeg * DEG));
        kn.seen = seen;
        if (t - kn.t1 >= C.minS && !seen) {
          b.phys = craftOf(vessel).createPhysics({ x: s.x, z: s.z, heading: s.heading, speed: 1.0, ...(vessel ? { vessel } : {}) }); b.ctl = { ...CONTROLS }; b.knock = null; b.evade = null; b.holdH = null;
          stats.righted = (stats.righted ?? 0) + 1;
        }
        continue;
      }
      const s = b.phys.state, ctl = b.ctl;
      const w = b.wind(s.x, s.z, t), windFrom = fromOf(w);
      // the channel: down its starboard side; furled and motoring when its line is too near the wind to sail
      const n = b.row.route.length, wp = b.row.route[b.sk.leg % n], wp0 = b.row.route[(b.sk.leg + n - 1) % n];
      const e1 = nearEnd(wp), e0 = nearEnd(wp0), chLeg = e1 && e0 && e1 !== e0;
      const chH = chLeg ? chHelmWide.heading(s, wp) : null;
      const motor = chH != null && Math.abs(wrap(chH - windFrom)) < K.motorNoGoDeg * DEG;
      // the avoidance, a few times a second, held a while once it acts
      b.avoidT -= dt;
      if (b.avoidT <= 0) {
        b.avoidT = K.avoid.everyS;
        let h = chH != null ? null : avoid(b, s, t, S, anchoredNow, windFrom, othersNow);
        // the shore guard: her own heading runs into shoal water inside the look: the nearest clear heading, bearing away first
        if (h == null && chH == null && !b.clear(s.heading, 20, s)) { h = shoreTurn(b, s, windFrom); if (h != null) stats.shore++; }
        if (h != null) { if (b.evade == null) stats.evades++; b.evade = h; b.evadeUntil = t + K.avoid.holdS; if (b.sk.man) { b.sk.man = null; b.sk.helm.i = 0; } }   // a threat ends a manoeuvre under way: the evasion steers
        else if (t > b.evadeUntil) b.evade = null;
      }
      // the player close and closing: she holds her course (a predictable boat; no tack or gybe across her) unless an evasion steers
      const closingTo = (o, r) => { const dx = o.x - s.x, dz = o.z - s.z; if (dx * dx + dz * dz > r * r) return false; return dx * ((o.u ?? 0) * Math.sin(o.heading ?? 0) - s.u * Math.sin(s.heading)) + dz * (-(o.u ?? 0) * Math.cos(o.heading ?? 0) + s.u * Math.cos(s.heading)) < 0; };
      let closing = !!S && closingTo(S, K.avoid.tackClearM), boatNear = false;
      for (const o of boats) if (o !== b && o.live && closingTo(o.phys.state, K.avoid.boatClearM)) { boatNear = true; break; }
      if (!boatNear) for (const o of othersNow) if (closingTo(o, K.avoid.boatClearM)) { boatNear = true; break; }
      if (closing && b.holdH == null) b.holdH = s.heading; else if (!closing) b.holdH = null;
      if (closing && b.sk.man && b.evade == null && b.sk.man.type !== 'around') { b.sk.man = null; b.sk.helm.i = 0; }   // no tack or gybe across the player's bow
      let advice = chH != null ? { evade: true, heading: chH, mode: 'reach' } : b.evade != null ? { evade: true, heading: b.evade, mode: 'reach' } : b.holdH != null ? { evade: true, heading: b.holdH, mode: 'reach' } : null;
      // in irons (stalled head to wind, an evasion or a shore turn left her there): v1's skipper's own way out (the jib backed, the helm
      // over, she falls off onto a board), which its irons watch runs only without advice; the advice waits until she sails again
      const twaAbs = Math.abs(s.trueWind?.angle ?? Math.PI);
      b.ironsT = !b.motoring && (s.u ?? 0) < 0.6 && twaAbs < 45 * DEG ? (b.ironsT ?? 0) + dt : 0;
      if (b.ironsT > 3 && !b.sk.recover) { b.sk.recover = (s.trueWind?.angle ?? 1) < 0 ? -1 : 1; b.sk.recoverT = 0; b.sk.man = null; b.evade = null; b.holdH = null; stats.irons++; }
      if (b.sk.recover) { b.sk.recoverT += dt; if ((twaAbs > 55 * DEG && s.u > 0.6) || b.sk.recoverT > 40) b.sk.recover = null; else if (chH == null) advice = null; }
      // a reach onto the other board through the wind (a sharp turn at a waypoint, an evasion over): v1's skipper steers a reach
      // straight there, the short way through the wind with no tack, and stalls head to wind; here it becomes a tack (its manoeuvre,
      // or round the long way with no way on)
      if (!advice && !b.sk.man && t > b.evadeUntil + K.avoid.calmS && Number.isFinite(b.sk.rep?.heading) && !closing && !boatNear) {   // never across the player or just after an evasion
        const h = b.sk.rep.heading, toWind = wrap(windFrom - s.heading), d = wrap(h - s.heading);
        const sideNow = toWind > 0 ? 1 : -1, sideWant = wrap(windFrom - h) > 0 ? 1 : -1;
        if (sideNow !== sideWant && Math.sign(d) === Math.sign(toWind) && Math.abs(toWind) < Math.abs(d)) { b.sk.side = sideNow; b.sk.startMan(s, t, { mode: 'beat', side: sideWant, forced: true }); if (b.sk.man) stats.tacks++; }
      }
      b.sk.update(dt, s, ctl, { t, advice });
      // a tack or gybe her skipper starts with another boat closing within boatClearM waits (unless her own course runs into shoal water)
      if (boatNear && b.sk.man && b.sk.man.t0 === t && b.sk.man.type !== 'around' && b.clear(s.heading, 20, s)) { b.sk.man = null; b.sk.helm.i = 0; b.sk.lastManT = t - 1e3; stats.held++; }
      if (chH != null && motor) {
        if (!b.motoring) { b.phys.engine.start(); b.motoring = true; }
        ctl.throttle = K.motorThrottle; ctl.furl = 1;
        ctl.rudder = b.sk.helm.toHeading(s, chH, Math.max(dt, 1e-3));
      } else if (b.motoring) {
        ctl.furl = 0; ctl.throttle = 0;
        if ((s.furl ?? 0) < 0.05) { b.phys.engine.stop(); b.motoring = false; ctl.throttle = null; }
      }
      if (b.motoring) nMotor++;
      // Tessie's knock: her weight on the rail rolls her; the crew lets fly while she rights
      const kn = b.knock;
      if (kn) {
        const u = t - kn.t0;
        if (u < kn.holdS) { ctl.rudder = 0; ctl.sheet = 85 * DEG; ctl.sheetBias = 0; ctl.jibFree = true; b.sk.man = null; }
        const r = KNOCK_ROLL, k = u <= 0 ? 0 : u < r.riseS ? u / r.riseS : u < r.riseS + r.holdS ? 1 : u < r.riseS + r.holdS + r.fallS ? 1 - (u - r.riseS - r.holdS) / r.fallS : 0;
        if (k > 0) b.phys.p += kn.K * k / b.phys.P.ixx * dt;
        // the jolt (play as Tessie's bite, the owner's son 2026-11-21): the hull shoved away from her over BUMP.pushS, eased out
        const bp = b.bump; if (bp) { const ub = t - bp.t0; if (ub >= 0 && ub < bp.pushS) { const f = 2 * (1 - ub / bp.pushS) / bp.pushS; s.x += bp.px * f * dt; s.z += bp.pz * f * dt; } }
        kn.maxHeel = Math.max(kn.maxHeel, Math.abs(s.heel ?? 0));
        if (Math.abs(s.heel ?? 0) > CAPSIZE.overDeg * DEG) { kn.capsized = true; kn.side = Math.sign(s.heel); kn.t1 = t; stats.capsized = (stats.capsized ?? 0) + 1; }   // over: she stays over
        else if (u >= kn.holdS) { b.knock = null; ctl.jibFree = false; ctl.sheet = null; }
      }
      b.env.t = t; b.phys.step(dt, ctl, b.env);
      b.bare = (b.phys.furlPos ?? 0) > 0.5 ? 1 : 0;
    }
    // hull against hull: the player and each boat, and the boats with each other (v1's contact: an impulse, the overlap closed)
    for (let i = 0; i < boats.length; i++) {
      const a = boats[i]; if (!a.live) continue;
      const A = a.phys.state;
      if (S && Math.abs(S.x - A.x) < 12 && Math.abs(S.z - A.z) < 12) { const c = hullContact(S, A); if (c) { stats.contacts++; stats.playerContacts = (stats.playerContacts ?? 0) + 1; onBump?.({ id: a.id, speed: Math.hypot((S.u ?? 0) - (A.u ?? 0), (S.v ?? 0) - (A.v ?? 0)) }); } }
      for (let j = i + 1; j < boats.length; j++) { const b = boats[j]; if (!b.live) continue; const Bs = b.phys.state; if (Math.abs(Bs.x - A.x) < 12 && Math.abs(Bs.z - A.z) < 12 && hullContact(A, Bs)) stats.contacts++; }
    }
    const t1 = globalThis.performance?.now?.() ?? 0;
    stats.stepUs = stats.stepUs * 0.95 + (t1 - t0) * 1000 * 0.05;
    stats.live = nLive; stats.motoring = nMotor;
  }
  return {
    boats, regions: live, stats, post, spawn, despawn,
    knock(id, { K = 0, t = now, holdS = 12, bump = null } = {}) {
      const b = boats.find((o) => o.id === id && o.live); if (!b) return false;
      if (bump) b.bump = { ...BUMP, ...bump, t0: t };   // her jaw on its rail (or her back under its bottom): the jolt at that point
      b.phys.P.knockdown = true;   // the large-angle righting arm: she goes far over and comes back up (src/sim/boat.js rightingArm)
      b.knock = { K, t0: t, holdS, maxHeel: 0 }; b.evade = null; b.holdH = null; stats.knocks = (stats.knocks ?? 0) + 1;
      return true;
    },
    // cheat on where (the reach): a live boat laid at a pose (play as Tessie's first boat ahead of her)
    lay(id, { x, z, heading, speed = 2.5 } = {}) {
      const b = boats.find((o) => o.id === id && o.live); if (!b) return false;
      b.phys = craftOf(vessel).createPhysics({ x, z, heading, speed, ...(vessel ? { vessel } : {}) }); b.ctl = { ...CONTROLS }; b.evade = null; b.holdH = null; b.knock = null;
      return true;
    },
    get active() { return active; }, set active(v) { active = !!v; },
    get liveBoats() { return boats.filter((b) => b.live); },
  };
}


// The regions' kayakers (owner, 2026-11-19: "1–3 kayaks around each birthplace ... after that, if the user is reborn at another place,
// it should be real: ... kayaks can't teleport with our sailboat"): every region with a birthplace owns its kayakers, and they live there
// all day: each paddles her lane (a closed loop) from a place along it set by the day's clock and the seed, so a reload is a new
// morning's place and a move finds them where they have been all along. Rows for v1's kayak fleet (v2/sim/kayaks.js residents: v1's
// paddler, hull model and mind; out 08:00-20:00, home in a storm): { id, route: { path, rests: [], kind: 'shore' }, s0, colour, … }.
// Lanes the sailboats' way (owner, 2026-11-21: "As a sail boat or Tessie, I still want to see the kayak, and make them part of the busy
// lake organically ... how did we stage so many sail boats on the lake? we can do the similar thing for kayak as well"): long loops
// through the water players sail, most of them a pair (a row's `mate`: a second kayaker apartM behind on the same lane, one group, so
// v1's mind keeps them paddling together: src/sim/kayaks/mind.js pairApart).
// The first birth (as the glass boat's, sim/tourBoat.js birthPhase): birth { x, z, headingDeg, speed, region, hour } (Sail's first
// birth pose; null: a URL pose, a race, Cruise) moves one lane of the birth's region along itself, a pair first, so its kayakers pass
// KAYAK_BIRTH.nearM from the boat's reach within withinS s, at every speed she may make (ahead of her bow, within aheadDeg, preferred), starting at least minStartM off (out of the frame's close reach, never
// placed by the camera: by the pose alone). The shift is fixed at that birth: a later hour (the fleet made later) finds them paddled
// on from there, and a rebirth never calls it.
//   residentKayaks(regions, birthplaces, { seed, hour, polyline, birth }) → slots   polyline: src/sim/kayaks/routes.js's (passed in:
//   this file stays free of v1's kayak code)
export const KAYAK_LIFE = Object.freeze({ speedMs: 1.25, hours: Object.freeze([8, 20]), apartM: 6, personalities: Object.freeze(['experienced', 'casual', 'experienced']) });
export const KAYAK_BIRTH = Object.freeze({ withinS: 60, nearM: Object.freeze([40, 120]), aheadDeg: 50, minStartM: 80, stepM: 5, probeS: 5, speeds: Object.freeze([2, 3.25, 4.5]) });   // speeds: m/s, the boat's first minute on her reach (she gathers way: 2.75 at the birth, up to ≈ 4.5)
// the clock's place on a lane: a seeded offset walked at her pace since the morning
const clockS = (seed, id, L, hour) => (((hash01(seed, strHash(id)) * L + Math.max(0, hour - KAYAK_LIFE.hours[0]) * 3600 * KAYAK_LIFE.speedMs) % L) + L) % L;
// the first birth's lane and place on it: { id, s } at the birth's hour, or null (no lane in the birth's region)
export function birthLane(rows, birth, { seed = 1, polyline, K = KAYAK_BIRTH, life = KAYAK_LIFE } = {}) {
  if (!birth || !rows.length) return null;
  const h = (birth.headingDeg ?? 0) * DEG, sx = Math.sin(h), sz = -Math.cos(h);
  const ok = [], fall = [];
  for (const k of rows) {
    const path = polyline(k.lane, true), L = path.length, crew = k.mate ? [0, -life.apartM] : [0];
    for (let s = 0; s < L; s += K.stepM) {
      // the nearest pass at each of the boat's speeds: the worst (lo: the nearest of them, hi: the farthest) must sit in the band
      let d0 = Infinity, lo = Infinity, hi = 0, foreAll = true;
      for (const u of K.speeds) {
        let dmin = Infinity, fore = false;
        for (let t = 0; t <= K.withinS; t += K.probeS) {
          const bx = birth.x + sx * u * t, bz = birth.z + sz * u * t;
          for (const off of crew) {
            const p = path.at(s + off + life.speedMs * t), d = Math.hypot(p.x - bx, p.z - bz);
            if (t === 0) d0 = Math.min(d0, d);
            dmin = Math.min(dmin, d);
            // ahead of her (within aheadDeg of her bow) while in the band: where a skipper looks, the follow view's half
            if (d <= K.nearM[1] && Math.abs(wrap(Math.atan2(p.x - bx, -(p.z - bz)) - h)) <= K.aheadDeg * DEG) fore = true;
          }
        }
        lo = Math.min(lo, dmin); hi = Math.max(hi, dmin); foreAll &&= fore;
      }
      if (d0 < K.minStartM) continue;
      const row = { id: k.id, s, pair: !!k.mate, fore: foreAll, dmin: hi, lo };
      if (lo >= K.nearM[0] && hi <= K.nearM[1]) ok.push(row); else fall.push(row);
    }
  }
  // a pair ahead of her bow first, then a pair, then one ahead, then any in the band
  const pool = [(r) => r.pair && r.fore, (r) => r.pair, (r) => r.fore, () => true].map((f) => ok.filter(f)).find((p) => p.length) ?? [];
  if (pool.length) return pool[Math.min(pool.length - 1, Math.floor(hash01(seed, 4243) * pool.length))];
  // none passes in the band: the nearest pass outside its near edge
  let best = null; for (const r of fall) if (!best || Math.abs(r.dmin - K.nearM[0]) < Math.abs(best.dmin - K.nearM[0])) best = r;
  return best;
}
export function residentKayaks(regions, birthplaces, { seed = 1, hour = 12, polyline, birth = null } = {}) {
  const out = [];
  const live = regionsWithBirthplaces(regions, birthplaces);
  const born = birth ? birthLane(live.find((r) => r.id === birth.region)?.kayaks ?? [], birth, { seed, polyline }) : null;
  live.forEach((r) => (r.kayaks ?? []).forEach((k, i) => {
    const path = polyline(k.lane, true), L = path.length, h = strHash(k.id);
    // the first birth's lane: its place then, paddled on since; the others: the day's clock
    const lead = born?.id === k.id ? born.s + Math.max(0, hour - (birth.hour ?? hour)) * 3600 * KAYAK_LIFE.speedMs : clockS(seed, k.id, L, hour) + (k.apart ?? 0) * L;
    const crew = k.mate ? [{ ...k, mate: null }, { ...k, ...k.mate, id: `${k.id}-2`, mate: null, back: KAYAK_LIFE.apartM }] : [k];
    crew.forEach((c, j) => {
      const hc = strHash(c.id);
      out.push({
        id: c.id, slot: 100 + out.length, region: r.id, resident: true, route: { path, rests: [], kind: 'shore', id: k.id }, kind: 'shore', s0: (((lead - (c.back ?? 0)) % L) + L) % L, restLeft: 0,
        colour: c.colour ?? 'yellow', sex: hash01(seed, hc + 3) < 0.5 ? 'male' : 'female', pfd: c.pfd ?? 'red', ...(k.mate ? { group: k.id } : {}),
        personality: KAYAK_LIFE.personalities[(i + j) % KAYAK_LIFE.personalities.length], seed: 1 + Math.floor(hash01(seed, hc + 5) * 9973), wear: 0.2 + 0.4 * hash01(seed, hc + 7), meet: null,
      });
    });
  }));
  return out;
}
