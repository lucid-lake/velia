// The paddle-wheeler (South Lake's birthplace, phase C): a generic, unnamed 46 m stern-wheel excursion boat, one model for every
// paddle-wheeler on the lake. Two ways to run her:
//   routed (play): her route is the south-lake region's `traffic` row of kind 'paddle' (src/waters/<id>.json): Ski Run's pier, out
//     along the south shore to off Emerald Bay's mouth and back, 8 kn in open water, 4 kn on the slow legs, a 90 s stop off the pier
//     head. Where she is comes from the day's clock and the seed (the glass boat's timetable maths: v2/sim/tourBoat.js tourPhase), so
//     a reload at the same ?hour and ?seed finds her in the same place. A first birth in her own region (Ski Run) shifts her timetable
//     once so the player meets her within 2 minutes (paddleBirthTau: cheat on when, never on motion); from there she moves as a real
//     300 t boat: eased speed, a slow turn, braking into the stop. She has right of way over the lake's traffic (it yields to her) but
//     keeps clear of the player: she slows, backs her wheel and bends her course away (the glass boat's yield, scaled to her size),
//     never into shoal water or a pier. The player meets a solid hull (seven heavy circles: v2/sim/channelMarks.js createMarkBodies).
//   review: ?paddle=x,z,heading[,kn] runs her straight along a heading at a set speed (the model's review row).
// Pure: no GPU (the tests drive it).
//   const S = createPaddleWheeler({ x, z, headingDeg, kn, depthAt })                       review: straight along a heading
//   const S = createPaddleWheeler({ route, hour, seed, tauS, birth, depthAt, piers, onBump })   routed (route: paddleRoute(row))
//   S.post(dt, player)               the boat's tick: routed, her run or stop, the yield to the player (his physics state), the bump
//   S.boat                           { x, z, heading (rad, 0 north, + clockwise), v (m/s), wheel (rad), wheelRate (rad/s), stopped,
//                                      mode ('run' | 'stop' | 'straight'), yielding, splashT }
//   S.trail                          her wake's record (render/vesselWake.js): newest first every TRAIL_DT s
//   S.emitters()                     her as a wake emitter (render/vesselWake.js): the wheel's wash, the V, the stem's foam
//   S.lights(out, o, { sunElevDeg, eye, heightAt })   her nav lights as glow records (0 by day)
//   S.targets() / S.hit(id, rule)     Tessie's view of her (kind 'paddle': splashed only, never knocked down: v2/sim/tessieHits.js)
// Frames: x east, z south (world); her own frame x starboard, y up from the waterline, z aft (the bow at −z), as every boat's.
import { GLOW_FLOATS, NAV_GLOW, navLevel, navSector } from './night.js';
import { routeLoop, pointAt, cruiseAt, tourPhase, tourTimetable, placeAt, yieldTo } from './tourBoat.js';
import { createMarkBodies } from './channelMarks.js';
import { wrap as wrapPi } from '../../src/sim/core/math.js';

const KN = 0.514444, DEG = Math.PI / 180;
// her numbers (the lake's real stern-wheelers: 40-50 m, about 9-10 m on the guards, a 1.5 m draft, 8-10 kn cruising; the wheel
// 6-7 m across turning 12-20 rpm)
export const PADDLE = Object.freeze({
  name: null,                                 // unnamed (no real boat's name or livery is drawn)
  length: 46, beam: 10.0, hullBeam: 9.2, draft: 1.5,
  bowZ: -21.5, transomZ: 17.5,                // the hull's stem and transom (her frame, m)
  wheel: Object.freeze({ z: 21.3, y: 2.35, r: 3.2, halfW: 3.5, buckets: 16, slip: 0.22 }),   // the axle (m aft, m up), the radius, half the width, the slip
  decks: Object.freeze([1.85, 4.45, 7.05]),   // the main, the second and the sun deck (m over the water)
  cruiseKn: 8,
  accelS: 45,                                 // s: the speed's time constant (a 300 t hull on one wheel)
  shoalM: 3.2, lookM: 80,                     // she eases to a stop where the water ahead (lookM) is shallower than shoalM
});
export const TRAIL_DT = 0.5;                  // s between wake samples (render/vesselWake.js VESSEL.dt)
const TRAIL_KEEP = 40;                        // s of trail kept (the wash's life)

// the review row: "x,z,heading[,kn]" (m, m, degrees true, knots: the cruise's 8 by default) → a pose, or null (absent, 0, junk)
export function parsePaddle(v) {
  if (v == null || v === false || v === '0' || v === 'off') return null;
  const a = String(v).split(',').map((s) => parseFloat(s));
  if (a.length < 2 || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) return null;
  const headingDeg = Number.isFinite(a[2]) ? a[2] : 0, kn = Number.isFinite(a[3]) ? Math.max(0, Math.min(14, a[3])) : PADDLE.cruiseKn;
  return { x: a[0], z: a[1], headingDeg, kn };
}

// the wheel's turn rate for a speed: the buckets move aft through the water faster than she moves ahead by the slip
export const wheelRate = (v, W = PADDLE.wheel) => v / (W.r * (1 - W.slip));

// her run (routed): the timetable's speeds (open water and the slow legs), her stop off Ski Run's pier, her turn, her yield to the player
export const PADDLE_RUN = Object.freeze({
  speedKn: 4, fastKn: 8,                      // the slow legs (the pier's approach, the turn off Emerald Bay), open water
  accel: 0.055, decel: 0.05, hardDecel: 3,    // m/s²: a 300 t hull on one wheel (8 kn in ≈ 75 s); × hardDecel with the wheel backed (a yield)
  slowAheadM: 600,                            // m: she eases down ahead of a slow leg (cruiseAt)
  stopS: Object.freeze({ pier: 90 }),         // s off the pier head (time compressed: the real boarding is half an hour)
  yawRate: 2.6,                               // °/s at the slow legs' speed and up (a turn of ≈ 45 m radius at 4 kn, ≈ 90 m at 8 kn)
  look: 60, arriveM: 6,                       // m: the pure-pursuit point ahead; at the stop within this
  // the yield (the glass boat's, v2/sim/tourBoat.js yieldTo, scaled to a 46 m hull: the box from her middle)
  yield: Object.freeze({ aheadM: 230, behindM: 30, sideM: 34, sideGrow: 0.22, stopM: 58, slowM: 210, latM: 45, latMax: 110, longS: 25, latRate: 1.6, clearS: 8, creep: 0.25, creepDeg: 40 }),
  clear: Object.freeze({ depthM: 3.2, pierM: 35 }),   // her target point never in water under depthM + 0.5 or within pierM of a pier
  hull: Object.freeze([-19.5, -13, -6.5, 0, 6.5, 13, 19.5]), hullR: 5.2, circleKg: 45000,   // the solid hull: m forward of her middle, radius, kg each
  rode: Object.freeze({ period: 9, tau: 3, maxOff: 0.25 }),
  // the first birth in her region: the player meets her within withinS (the nearest pass within nearM of his reach at every speed he
  // may make), she starts at least minM off, ahead of his bow within aheadDeg preferred
  birth: Object.freeze({ withinS: 120, nearM: 400, minM: 300, closeM: 100, aheadDeg: 75, viewDeg: 35, viewS: 20, viewM: 1200, speeds: Object.freeze([2, 3.25, 4.5]), stepS: 10, probeS: 10 }),
});

// her route from the region row's traffic entry: [x, z] or { at: [x, z], stop, slow } → the timetable's rows ({ at, stop, fast })
export function paddleRoute(row) {
  return Object.freeze((row?.route ?? []).map((e) => { const at = Array.isArray(e) ? e : e.at; return Object.freeze({ at: Object.freeze([at[0], at[1]]), ...(e.stop ? { stop: e.stop, name: e.name ?? e.stop } : {}), fast: !e.slow }); }));
}

// a seeded pick in [0, 1)
const h01 = (a, b) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
// the first birth (a south start): a second of her timetable such that the player, sailing his start's heading at any of the birth's
// speeds, passes within nearM of her within withinS, closing at least closeM from where she started (she comes to meet him, not
// away), and she is at least minM off at the start (never on top of him). Preferred: in the start's view in its first viewS (within
// viewDeg of the birthplace's look bearing, within viewM: the birthplace row's own line, not the camera's), then ahead of his bow. The seed picks among those that pass; none: the nearest pass.
export function paddleBirthTau(birth, { seed = 1, loop, K = PADDLE_RUN } = {}) {
  const tt = tourTimetable(loop, K), B = K.birth, h = (birth.headingDeg ?? 0) * DEG, sx = Math.sin(h), sz = -Math.cos(h);
  const viewH = birth.look ? Math.atan2(birth.look[0] - birth.x, -(birth.look[1] - birth.z)) : h;   // the birthplace's look (the start's view line)
  const ok = [];
  let best = 0, bestD = Infinity;
  for (let tau = 0; tau < tt.period; tau += B.stepS) {
    const p0 = placeAt(tourPhase(0, seed, loop, K, tau), loop);
    if (Math.hypot(p0.x - birth.x, p0.z - birth.z) < B.minM) continue;
    let hi = 0, fore = true, view = false;
    for (let t = 0; t <= B.viewS && !view; t += B.probeS) { const p = t ? placeAt(tourPhase(0, seed, loop, K, tau + t), loop) : p0, d = Math.hypot(p.x - birth.x, p.z - birth.z); view = d <= B.viewM && Math.abs(wrapPi(Math.atan2(p.x - birth.x, -(p.z - birth.z)) - viewH)) <= B.viewDeg * DEG; }
    for (const u of B.speeds) {
      let dmin = Infinity, f = false;
      const d0 = Math.hypot(p0.x - birth.x, p0.z - birth.z);
      for (let t = B.probeS; t <= B.withinS; t += B.probeS) {
        const p = placeAt(tourPhase(0, seed, loop, K, tau + t), loop), bx = birth.x + sx * u * t, bz = birth.z + sz * u * t, d = Math.hypot(p.x - bx, p.z - bz);
        if (d <= d0 - B.closeM) dmin = Math.min(dmin, d);
        if (d <= B.nearM && Math.abs(wrapPi(Math.atan2(p.x - bx, -(p.z - bz)) - h)) <= B.aheadDeg * DEG) f = true;
      }
      hi = Math.max(hi, dmin); fore &&= f;
    }
    if (hi <= B.nearM) ok.push({ tau, fore, view });
    if (hi < bestD) { bestD = hi; best = tau; }
  }
  const pool = [(o) => o.view, (o) => o.fore, () => true].map((f) => ok.filter(f)).find((q) => q.length) ?? [];
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(h01(seed, 5151) * pool.length))].tau : best;
}

// the distance from a point to a pier segment [x0, z0, x1, z1, …]
const segDist = (px, pz, a) => { const dx = a[2] - a[0], dz = a[3] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)); return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
export const pierDistance = (piers, x, z, reach = 400) => { let d = Infinity; for (const p of piers) { if (Math.abs(p[0] - x) > reach || Math.abs(p[1] - z) > reach) continue; d = Math.min(d, segDist(x, z, p)); } return d; };

export function createPaddleWheeler({ x = 0, z = 0, headingDeg = 0, kn = PADDLE.cruiseKn, depthAt = null, settled = true, route = null, hour = 13, seed = 1, tauS = null, birth = null, piers = [], onBump = null, K = PADDLE_RUN } = {}) {
  const target = kn * KN;
  // settled: she is already at her speed (a review pose and a capture see her under way at once; a real start eases up)
  const boat = { x, z, heading: headingDeg * DEG, v: settled ? target : 0, wheel: 0, wheelRate: 0, stopped: false, target, mode: 'straight', yielding: false, splashT: -1e9 };
  const trail = [];
  let trailT = 0, t = 0;
  const stats = { shoal: false, steps: 0, yields: 0, stops: 0, splashes: 0, tau: null };
  // routed: her loop, her timetable's place at this hour for this seed (or the first birth's shifted second)
  const loop = route?.length > 1 ? routeLoop(route) : null;
  let bodies = null, circles = null, holdLeft = 0;
  const pierNear = (list) => (loop ? list.filter((p) => loop.seg.some((g) => segDist(p[0], p[1], [g.a[0], g.a[1], g.b[0], g.b[1]]) < 600)) : []);
  let nearPiers = pierNear(piers);
  if (loop) {
    const tau = birth ? paddleBirthTau(birth, { seed, loop, K }) : tauS;
    stats.tau = tau;
    const ph = tourPhase(hour, seed, loop, K, tau), stIdx = loop.stops.findIndex((q) => q.id === ph.row.stop);
    const pAt = pointAt(loop, ph.mode === 'stop' ? ph.s - 1 : ph.s), here = ph.mode === 'stop' ? { x: ph.row.at[0], z: ph.row.at[1] } : pAt;
    Object.assign(boat, { x: here.x, z: here.z, heading: Math.atan2(pAt.dx, -pAt.dz), v: ph.v, s: ph.s, mode: ph.mode, stop: ph.mode === 'stop' ? ph.row.stop : null,
      stopIdxAt: stIdx, stopIdx: (stIdx + 1) % loop.stops.length, stopLeft: ph.mode === 'stop' ? Math.max(1, ph.row.stopS - ph.tIn) : 0, lat: 0, latSide: 0, clearT: 0, yieldT: 0, slow: 1 });
    circles = K.hull.map((f, i) => ({ id: `paddle:${i}`, f, x: boat.x, z: boat.z, r: K.hullR, mass: K.circleKg }));
    bodies = createMarkBodies(circles, { onBump, rode: K.rode });
  }
  const clearAt = (px, pz) => (!depthAt || depthAt(px, pz) >= K.clear.depthM + 0.5) && (!nearPiers.length || pierDistance(nearPiers, px, pz) >= K.clear.pierM);
  // the nearest distance along the loop to (x, z), searched within ±win of her own progress
  const project = (px, pz, guess, win = 40) => { let best = guess, bd = Infinity; for (let ds = -win; ds <= win; ds += 2) { const p = pointAt(loop, guess + ds), d = Math.hypot(p.x - px, p.z - pz); if (d < bd) { bd = d; best = guess + ds; } } const L = loop.length; return ((best % L) + L) % L; };
  const vc = K.speedKn * KN;
  // the routed run (the glass boat's steer: v2/sim/tourBoat.js, without her kayaks)
  function steer(dt, S) {
    if (holdLeft > 0) { holdLeft -= dt; }
    if (boat.mode === 'stop') {
      boat.v = Math.max(0, boat.v - K.decel * dt);
      boat.stopLeft -= dt;
      if (boat.stopLeft <= 0) { boat.mode = 'run'; boat.s = (loop.stops[boat.stopIdxAt].s + 0.5) % loop.length; boat.stop = null; }
      return;
    }
    const nx = loop.stops[boat.stopIdx], dStop = Math.hypot(nx.at[0] - boat.x, nx.at[1] - boat.z);
    let toStop = ((nx.s - boat.s) % loop.length + loop.length) % loop.length;
    if (toStop > loop.length - 60 || dStop < 40) toStop = Math.min(toStop > loop.length - 60 ? dStop : toStop, dStop);
    const y = yieldTo(boat, S, K), Y = K.yield, wasY = boat.yielding;
    boat.yielding = y.slow < 1; boat.slow = y.slow;
    if (boat.yielding && !wasY) stats.yields++;
    if (boat.yielding) { if (!boat.clearT) boat.latSide = -y.side; boat.clearT = Y.clearS; boat.yieldT += dt; } else { boat.clearT = Math.max(0, boat.clearT - dt); if (!boat.clearT) boat.yieldT = 0; }
    let slow = y.slow;
    if (boat.yielding && y.off > Y.creepDeg && (y.d ?? 999) > Y.stopM) slow = Math.max(slow, Y.creep);
    const brake = Math.max(dStop > K.arriveM ? 0.3 : 0, Math.sqrt(2 * K.decel * Math.max(0, toStop - K.arriveM * 0.5)));
    const errStop = dStop < 60 ? Math.abs(wrapPi(Math.atan2(nx.at[0] - boat.x, -(nx.at[1] - boat.z)) - boat.heading)) : 0;
    const want = Math.min(cruiseAt(loop, boat.s, K) * slow, brake * Math.max(0.2, Math.cos(Math.min(errStop, Math.PI / 2))));
    boat.v += Math.max(-K.decel * dt * (slow < 0.5 ? K.hardDecel : 1), Math.min(K.accel * dt, want - boat.v));
    boat.v = Math.max(0, boat.v);
    // her course bent away from the player while she yields (wider the longer she waits), back after; never into shoal water or a pier
    const latM = Y.latM + (Y.latMax - Y.latM) * Math.min(1, boat.yieldT / Y.longS);
    const latWant = boat.clearT > 0 ? boat.latSide * latM : 0;
    boat.lat += Math.max(-Y.latRate * dt, Math.min(Y.latRate * dt, latWant - boat.lat));
    const tp = pointAt(loop, boat.s + K.look);
    let tx = tp.x - tp.dz * boat.lat, tz = tp.z + tp.dx * boat.lat;
    if (toStop < K.look * 1.2 && Math.abs(boat.lat) < 0.5) { tx = nx.at[0]; tz = nx.at[1]; }
    if (Math.abs(boat.lat) > 0.5 && !clearAt(tx, tz)) { boat.lat *= 0.9; tx = tp.x; tz = tp.z; }
    const wantH = Math.atan2(tx - boat.x, -(tz - boat.z)), rate = K.yawRate * DEG * Math.max(0.25, Math.min(1, boat.v / vc));
    boat.heading = wrapPi(boat.heading + Math.max(-rate * dt, Math.min(rate * dt, wrapPi(wantH - boat.heading))));
    boat.x += Math.sin(boat.heading) * boat.v * dt; boat.z -= Math.cos(boat.heading) * boat.v * dt;
    boat.s = project(boat.x, boat.z, boat.s);
    if (dStop < K.arriveM * 2 && boat.v < 0.4) {
      boat.mode = 'stop'; boat.stop = nx.id; boat.stopLeft = K.stopS[nx.id] ?? 90; boat.stopIdxAt = boat.stopIdx; boat.stopIdx = (boat.stopIdx + 1) % loop.stops.length; stats.stops++;
    }
  }
  function post(dt, S = null) {
    if (!(dt > 0)) return;
    t += dt; stats.steps++;
    if (loop) {
      steer(dt, S);
      // the solid hull: the circles at their stations; the player's hull against them (a heavy body: she gives almost nothing)
      const hx = Math.sin(boat.heading), hz = -Math.cos(boat.heading), bs = bodies.bodies;
      for (let i = 0; i < circles.length; i++) { const nx = boat.x + hx * circles[i].f, nz = boat.z + hz * circles[i].f; if (stats.steps === 1 || !S) { bs[i].x = nx; bs[i].z = nz; bs[i].vx = 0; bs[i].vz = 0; } bs[i].x0 = nx; bs[i].z0 = nz; }
      if (S) bodies.post(S, dt, t);
    } else {
      const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
      // shoal water ahead: the target falls to 0 (she stops short, as a skipper would)
      let want = boat.target;
      if (depthAt) {
        let shoal = false;
        for (let d = 10; d <= PADDLE.lookM; d += 10) if (!(depthAt(boat.x + fx * (PADDLE.length / 2 + d), boat.z + fz * (PADDLE.length / 2 + d)) > PADDLE.shoalM)) { shoal = true; break; }
        stats.shoal = shoal;
        if (shoal) want = 0;
      }
      boat.v += (want - boat.v) * (1 - Math.exp(-dt / PADDLE.accelS * (want < boat.v ? 3 : 1)));   // a stop (the wheel backed) is quicker than a start
      if (boat.v < 0.02 && want === 0) boat.v = 0;
      boat.x += fx * boat.v * dt; boat.z += fz * boat.v * dt;
    }
    boat.stopped = boat.v === 0;
    boat.wheelRate = wheelRate(boat.v);
    boat.wheel = (boat.wheel + boat.wheelRate * dt) % (Math.PI * 2);
    // the trail (her wake's record): every TRAIL_DT s, aged by dt
    const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
    for (const p of trail) p.age += dt;
    trailT -= dt;
    if (trailT <= 0) {
      trailT += TRAIL_DT;
      trail.unshift({ age: 0, x: boat.x, z: boat.z, fx, fz, v: boat.v, churn: Math.min(1.2, boat.v / (PADDLE.cruiseKn * KN)) });
      while (trail.length && trail[trail.length - 1].age > TRAIL_KEEP) trail.pop();
    }
  }
  // her nav lights (COLREGs rule 23: a power-driven vessel over 20 m: the masthead light forward, the sidelights, the stern light):
  // the masthead on the pilothouse's mast, red and green on the pilothouse's wings, the stern light over the wheel's beam
  const LENS = Object.freeze([
    { at: [8.1, 13.0, 0], c: [1.0, 0.95, 0.85], kind: 'steaming' },
    { at: [7.0, 8.3, -2.75], c: [1.0, 0.22, 0.16], kind: 'red' },
    { at: [7.0, 8.3, 2.75], c: [0.2, 1.0, 0.45], kind: 'green' },
    { at: [-PADDLE.wheel.z + 0.2, PADDLE.wheel.y + PADDLE.wheel.r + 0.9, 0], c: [1.0, 0.95, 0.85], kind: 'stern' },
  ]);   // (her frame: m forward, m up, m to starboard)
  function lights(out, o, { sunElevDeg = 90, eye = [0, 0, 0], heightAt = () => 0 } = {}) {
    const level = navLevel(sunElevDeg);
    if (!(level > 0)) return 0;
    const cap = Math.floor((out.length - o) / GLOW_FLOATS), fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading), y0 = heightAt(boat.x, boat.z);
    let n = 0;
    for (const L of LENS) {
      if (n >= cap) break;
      const [f, y, s] = L.at, lx = boat.x + fx * f - fz * s, lz = boat.z + fz * f + fx * s, w = o + n * GLOW_FLOATS;
      const dx = eye[0] - lx, dz = eye[2] - lz, brg = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) / DEG;
      out[w] = lx; out[w + 1] = y0 + y; out[w + 2] = lz; out[w + 3] = -NAV_GLOW.size;   // a far point light (render/night.js)
      out[w + 4] = L.c[0]; out[w + 5] = L.c[1]; out[w + 6] = L.c[2];
      out[w + 7] = NAV_GLOW.radiance * level * navSector(L.kind, brg);
      n++;
    }
    return n;
  }
  return {
    boat, trail, post, lights, stats, lenses: LENS, loop, bodies,
    get t() { return t; },
    get routed() { return !!loop; },
    setPiers(list) { nearPiers = pierNear(list ?? []); },   // the piers (their file arrives after the start)
    timetable: () => (loop ? tourTimetable(loop, K) : null),
    // Tessie's view (v2/sim/tessieHits.js kind 'paddle'): a 46 m hull is never knocked down; a hit splashes her (the spray at the jaw,
    // the passengers' shout is the RPG's later); the hit is counted
    targets(id = 'paddle') { return [{ id, kind: 'paddle', x: boat.x, z: boat.z, heading: boat.heading, u: boat.v, L: PADDLE.length - 4, B: PADDLE.beam }]; },
    hit(id, rule = 'splash') { if (rule !== 'splash') return false; boat.splashT = t; stats.splashes++; return true; },
    // her as a wake emitter (render/vesselWake.js): the wheel's wash (7 m wide, white for seconds, the longest-lived), a stronger V
    // than the glass boat's (a 46 m displacement hull), the V's arms breaking white off her guards, the stem's foam
    emitters() {
      const W = PADDLE.wheel;
      return [{ trail, length: PADDLE.length * 0.85, kelvinAmp: 3.6, kelvinAge: 14, arms: { foam: 0.55, w: 1.2, life: 9, x0: PADDLE.beam / 2 },
        noses: [[-PADDLE.bowZ - 0.4, 0]], noseR: 0.9, noseFoam: 0.8,
        lines: [{ x: 0, aft: W.z + W.r * 0.4, w: W.halfW * 2, foam: 1.25, life: 40 }, { x: -PADDLE.hullBeam / 2 + 0.3, aft: PADDLE.transomZ - 1, w: 1.2, foam: 0.35, life: 10 }, { x: PADDLE.hullBeam / 2 - 0.3, aft: PADDLE.transomZ - 1, w: 1.2, foam: 0.35, life: 10 }] }];
    },
  };
}
