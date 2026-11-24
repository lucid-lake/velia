// A pair launches from shore when none has been seen for 3 min (BACKLOG-v2 kayak lanes, round B; owner, 2026-11-21: "start round B").
// The regions' kayakers live on their lanes all day (busyLake.js residentKayaks); some courses still go minutes without one. When no
// kayaker has been within LAUNCH.seenM of the player for LAUNCH.unseenS of play, a pair pushes off from a real launch spot on the
// chart (a beach, a dock, a campground shore: LAUNCH_SPOTS) and paddles a straight line that crosses the player's course LAUNCH.crossM
// ahead of her, on past it, and back home to its spot (a closed loop, so v1's agent paddles it as any lane). It appears 150–500 m ahead
// and out of the camera's view: at the spot itself when its pace gets it across in time, else on its line from the spot (it set off
// earlier: a kayak is 2–4 × slower than the boat). Cheat on where and when, never on motion: the spot and the moment are chosen; the paddling is
// v1's own at its cruise pace (src/sim/kayaks/agent.js). Pure: no DOM, no GPU, no Math.random, no wall clock.
//   const L = createLauncher({ regions, spots, isWater, polyline, seed })
//   L.tick(dt, { player, cam, marks, allow }) → slots (a pair) to spawn now, or null
//     player { x, z, heading?, sog? } (the sailboat, or Tessie when she is played; heading and speed from its own track when absent)
//     cam    { x, z, fwdX, fwdZ, hHalf } (the fleet's camera)
//     marks  [{ x, z, launched?, region? }] every kayaker out (the fleet's marks())
//     allow  false while the busy lake stands down (a race, the show, night, a storm) or play has not started: the clock holds
//   L.due()   the 3 min run out at once (the evidence's)
//   planLaunch({ player, cam, spots, isWater }) → { spot, cross, lane, gap, d, inView } or null (the geometry alone, for tests)
// The fleet (v2/sim/kayaks.js) spawns the slots, keeps them out of v1's retire rule, and lets them leave only once home (a lap done),
// out of the camera's view and at least LAUNCH.popM from it (the busy lake's popM).
import { hash01 } from './busyLake.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { launchSpotsOf } from '../sim/regions.js';

export const LAUNCH = Object.freeze({
  unseenS: 180,          // s of play with no kayaker within seenM of the player
  seenM: 150,            // m
  aheadM: Object.freeze([150, 500]),   // m: where the pair appears, from the player (the spot, or its line: below)
  spotMaxM: 1800,        // m: the spot's distance from the player at most (past aheadM the pair set off earlier: placed on its line)
  headCost: 60,          // the cost of a head start (always behind a push-off from the spot itself)
  crossM: Object.freeze([80, 200]),    // m: the pair crosses the course this far ahead of the player at that moment. A kayak is 2–4 ×
                                       // slower than the boat: from a spot out of the view it often cannot get ahead of her in time; then it
                                       // pushed off earlier (cheat on where and when, never on motion): it appears on its line from the spot,
                                       // out of the view, where its own pace brings it across the course gap m ahead of her
  crossStepM: 10, crossMaxM: 900,      // the crossing points searched along the course line
  beyondM: Object.freeze([120, 80, 40]),   // m: on past the course (the first that stays on water)
  vk: 1.25,              // m/s: the pair's pace (v1's cruise, src/sim/kayaks/mind.js SPEED.cruise 1.31, less its turns)
  minBoatMs: 0.2,        // m/s: the player's speed for the timing, at least
  aimM: 110,             // m: the gap aimed at (inside the meeting's 150 m when she reaches the pair's line)
  viewPad: 0.15,         // rad beyond the camera's half-angle: a spot inside counts as in view
  clearM: 300,           // m: a start in the view's cone is allowed only this far from the camera (v1's fleet: 250 m, "out of its reach";
                         // at the boat's 3 m/s no start outside the cone can cross ahead of her: a kayak is too slow)
  inViewCost: 400,       // the cost of a start in the view's cone (always behind one outside it), and per m nearer than aheadM's far end
  inViewNearCost: 0.2,
  meetMaxS: 240, meetCost: 0.6,   // s: the pair across her course within this; the cost per s (the sooner the better)
  maxPerRegion: 2,       // launched pairs alive per region
  popM: 900,             // m from the camera before a launched pair, home again, may leave (busyLake.js BUSY.popM)
  retryS: 2,             // s between tries once due
  sampleM: 8,            // m between the water checks along a leg
  apartM: 6,             // m: the second kayaker behind (busyLake.js KAYAK_LIFE.apartM)
});

// the launch spots: real put-ins on the chart, each a water point 6–15 m off the shore (checked in v2/tests/kayak-launch.test.mjs),
// by region: each region row's launchSpots in the lake profile's region table (v2/sim/regions.js; refactor round 3 C5)
export const LAUNCH_SPOTS = launchSpotsOf(CURRENT_WATERS);
const COLOURS = Object.freeze([['yellow', 'red', 'red', 'blue'], ['orange', 'yellow', 'yellow', 'orange'], ['red', 'blue', 'orange', 'red']]);

import { wrap } from '../../src/sim/core/math.js';
// a leg on water: every sampleM along it
function legOnWater(isWater, a, b, step) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  for (let i = 0; i <= n; i++) { const u = i / n; if (!isWater(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)) return false; }
  return true;
}
// the camera's view: the spot inside its cone (a pad wider) and nearer than clearM
export function inView(cam, x, z, K = LAUNCH) {
  const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
  const off = Math.abs(Math.atan2(dx * cam.fwdZ - dz * cam.fwdX, dx * cam.fwdX + dz * cam.fwdZ));
  return { cone: off < cam.hHalf + K.viewPad, d };
}

export function planLaunch({ player, cam, spots, isWater, K = LAUNCH }) {
  const fx = Math.sin(player.heading), fz = -Math.cos(player.heading), vb = Math.max(K.minBoatMs, player.sog ?? 0);
  const mid = K.aimM, cands = [];
  for (const spot of spots) {
    const [px, pz] = spot.at, dp = Math.hypot(px - player.x, pz - player.z);
    if (dp > K.spotMaxM) continue;
    for (let a = K.crossM[0]; a <= K.crossMaxM; a += K.crossStepM) {
      const cx = player.x + fx * a, cz = player.z + fz * a, dk = Math.hypot(cx - px, cz - pz);
      if (dk < 20) continue;
      // from the spot: the pair crosses gap m ahead of her; too far for that, it set off earlier (cheat on when): it is placed on its
      // line ds m short of the crossing, gap = mid
      const gap0 = a - vb * dk / K.vk;
      let ds = dk, gap = gap0;
      if (gap0 < K.crossM[0]) { ds = (a - mid) * K.vk / vb; gap = mid; if (ds <= 0) continue; }
      else if (gap0 > K.crossM[1]) continue;
      const ux = (cx - px) / dk, uz = (cz - pz) / dk, sx = cx - ux * ds, sz = cz - uz * ds, d = Math.hypot(sx - player.x, sz - player.z);
      if (d < K.aheadM[0] || d > K.aheadM[1]) continue;
      if ((sx - player.x) * fx + (sz - player.z) * fz <= 0) continue;   // ahead of her course
      const v = inView(cam, sx, sz, K);
      if (v.cone && v.d < K.clearM) continue;   // never pops up in the view
      const head = ds < dk - 1, tMeet = ds / K.vk;
      if (tMeet > K.meetMaxS) continue;
      cands.push({ spot, cross: [cx, cz], start: [sx, sz], gap, d, dk, ds, head, inView: v.cone, cost: Math.abs(gap - mid) + tMeet * K.meetCost + (head ? K.headCost + (dk - ds) * 0.05 : 0) + (v.cone ? K.inViewCost + (K.aheadM[1] - d) * K.inViewNearCost : 0) });
    }
  }
  cands.sort((p, q) => p.cost - q.cost);
  for (const c of cands) {
    const P = c.spot.at, X = c.cross;
    if (!isWater(X[0], X[1]) || !legOnWater(isWater, P, X, K.sampleM)) continue;
    const ux = (X[0] - P[0]) / c.dk, uz = (X[1] - P[1]) / c.dk;
    for (const b of K.beyondM) {
      const Y = [X[0] + ux * b, X[1] + uz * b];
      if (!legOnWater(isWater, X, Y, K.sampleM)) continue;
      // home: straight back if it stays on water, else the way it came
      const lane = legOnWater(isWater, Y, P, K.sampleM) ? [P.slice(), X, Y] : [P.slice(), X, Y, [X[0] + (Y[0] - X[0]) * 0.1, X[1] + (Y[1] - X[1]) * 0.1]];
      return { spot: c.spot, cross: X, start: c.start, lane, s0: +(c.dk - c.ds).toFixed(1), past: +(c.dk + b).toFixed(1), gap: +c.gap.toFixed(1), d: +c.d.toFixed(1), dk: +c.dk.toFixed(1), head: c.head, inView: c.inView };
    }
  }
  return null;
}

// the pair's slots (the fleet's slot rows, as busyLake.js residentKayaks makes them): the lead at its start (the spot, or its line), the
// second apartM behind; route.past: the arc length past the course (beyond it the pair may leave once far and out of the view)
function launchSlots(plan, { seed = 1, n = 1, region, polyline, K = LAUNCH }) {
  const path = polyline(plan.lane, true), L = path.length, id = `launch-${region}-${n}`, col = COLOURS[(n + (seed | 0)) % COLOURS.length];
  return [0, 1].map((j) => {
    const sid = j ? `${id}-2` : id, h = 7919 * n + 31 * j + 17;
    return { id: sid, slot: 900 + 2 * n + j, region, resident: true, launched: true, spot: plan.spot.id, route: { path, rests: [], kind: 'shore', id, past: plan.past }, kind: 'shore',
      s0: (((plan.s0 - j * K.apartM) % L) + L) % L, restLeft: 0, colour: col[2 * j], pfd: col[2 * j + 1], sex: hash01(seed, h + 3) < 0.5 ? 'male' : 'female', group: id,
      personality: j ? 'casual' : 'experienced', seed: 1 + Math.floor(hash01(seed, h + 5) * 9973), wear: 0.2 + 0.4 * hash01(seed, h + 7), meet: null };
  });
}

export function createLauncher({ regions = [], spots = LAUNCH_SPOTS, isWater, polyline, seed = 1, K = LAUNCH } = {}) {
  let unseen = 0, retry = 0, n = 0, prev = null;
  const track = { heading: 0, sog: 0 };
  const log = [];
  const regionAt = (x, z) => { let best = null, bd = Infinity; for (const r of regions) { const d = Math.hypot(x - r.centre[0], z - r.centre[1]); if (d <= r.radiusM && d < bd) { bd = d; best = r.id; } } return best; };
  return {
    K, log, regionAt,
    get unseen() { return unseen; }, get count() { return n; },
    due() { unseen = Math.max(unseen, K.unseenS); retry = 0; },   // the clock run out at once (the evidence harness's; the rule's other checks still hold)
    tick(dt, { player, cam, marks = [], allow = true } = {}) {
      if (!player || !Number.isFinite(player.x) || !(dt > 0)) return null;
      // the player's way from its own track (eased ≈ 1 s) when it has none of its own (Tessie)
      if (prev) { const vx = (player.x - prev.x) / dt, vz = (player.z - prev.z) / dt, k = 1 - Math.exp(-dt); if (Math.hypot(vx, vz) < 40) { const s = Math.hypot(vx, vz); track.sog += (s - track.sog) * k; if (s > 0.3) track.heading += wrap(Math.atan2(vx, -vz) - track.heading) * k; } }
      prev = { x: player.x, z: player.z };
      const pose = { x: player.x, z: player.z, heading: Number.isFinite(player.heading) ? player.heading : track.heading, sog: Number.isFinite(player.sog) ? player.sog : track.sog };
      if (marks.some((m) => Math.hypot(m.x - pose.x, m.z - pose.z) <= K.seenM)) { unseen = 0; return null; }
      if (!allow) return null;
      unseen += dt;
      if (unseen < K.unseenS) return null;
      retry -= dt; if (retry > 0) return null;
      retry = K.retryS;
      // the spots of her region and its neighbours (the channel joins the bay and the open lake), of the regions under their cap
      const here = regionAt(pose.x, pose.z); if (!here) return null;
      const rows = [here, ...(regions.find((r) => r.id === here)?.neighbours ?? [])].filter((id) => spots[id] && regions.some((r) => r.id === id));
      const open = rows.filter((id) => new Set(marks.filter((m) => m.launched && m.region === id).map((m) => m.group)).size < K.maxPerRegion);
      const plan = open.length ? planLaunch({ player: pose, cam, spots: open.flatMap((id) => spots[id].map((sp) => ({ ...sp, region: id }))), isWater, K }) : null;
      if (!plan) return null;
      const region = plan.spot.region;
      n++; unseen = 0;
      log.push({ n, region, spot: plan.spot.id, gap: plan.gap, d: plan.d, head: plan.head, inView: plan.inView });
      return launchSlots(plan, { seed, n, region, polyline, K });
    },
  };
}
