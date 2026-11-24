// A kayaker's mind (feat/kayaks-lake step 2): it looks round now and then, sees the sailboat, predicts
// the closest point of approach from the boat's velocity, knows a sailboat cannot stop, and chooses: hold its course,
// pass astern, turn toward the shore, or stop and wait. Plain JS, no three.js; deterministic (the slot's seed and the
// scene's own clock: no Math.random, no wall clock).
//
//   const m = createMind(slot)                        // its personality's timings
//   const intent = think(a, m, dt, world)             // { throttle, turn } for the paddler or the hull model
//     world: { boat: { x, z, vx, vz } | null, others: [agents], terrain }
//     a.look: the head's turn (deg, + to starboard) the paddler should look by, or null (looking ahead)
//     m.action: 'route' | 'hold' | 'astern' | 'shore' | 'wait'; m.cpa: the last prediction { t, d, ahead }
//   cpa(kayak, boat)                                  // the closest point of approach: { t (s), d (m), ahead (m) }
//   choose(a, m, world)                               // the four options scored; the best one ({ action, heading, throttle })
//
// The player's side: the kayaks are slow (1.3–2 m/s against the boat's 3–4), so a good kayaker turns
// early and wide, a distracted one late and quick. Each decision holds until the boat has passed (or a later look finds
// a clearly better one, never sooner than 4 s), so the kayak reads as a person with a plan, not a twitch: a head turn at
// the look, a pause, a new heading, and after the boat has gone by, back to its route.
import { steer, steerTo } from './agent.js';
import { hash01, routeCrossings } from './plan.js';
import { okWater } from './routes.js';

const DEG = Math.PI / 180;
import { wrap } from '../core/math.js';
import { clampT as clamp } from '../core/math.js';

// the three personalities (stored in step 1 as experienced | casual | distracted; the owner's words cautious, steady,
// distracted): how often they look round, when they act (the predicted miss and its time), the gap they want, the pause
// before they act, the pace they act at. The gaps are a real paddler's 15–30 m from a passing yacht (plan § 3 said 40 m;
// the owner's hero ask, 2026-11-08, wants them close and clear from the boat: 40 m from the follow camera's 32 m back
// leaves a kayak 25 px long)
export const PERSONA = Object.freeze({
  experienced: { word: 'cautious', scan: [2, 3], actM: 22, actT: 45, want: 16, pause: [0, 0.4], pace: 0.5, look: 2.4, bias: { astern: 0, shore: 0.25, wait: 0.35 } },
  casual: { word: 'steady', scan: [3, 5], actM: 5.5, actT: 18, want: 7, pause: [1, 2], pace: 0.5, look: 2.0, bias: { astern: 0.1, shore: 0.4, wait: 0 } },
  distracted: { word: 'distracted', scan: [4, 8], actM: 5, actT: 14, want: 11, pause: [0, 0.3], pace: 1, look: 1.4, bias: { astern: 0, shore: 0.3, wait: 0.1 } },
});
export const MIND = Object.freeze({
  range: 200,       // m: the sailboat counts only this near
  lookRange: 150,   // m: a look round turns the head to a boat this near
  busyAdd: [2, 8],  // s: resting or drifting adds this to the next look (facing away, a photo)
  minHold: 4,       // s: a decision holds at least this long
  switchK: 0.7,     // a later look switches only to an option this much cheaper
  horizon: 50,      // s: how far ahead an option is played out
  aheadM: 35,       // m: a predicted pass ahead of the bow closer than this is acted on by everyone
  apart: 8,         // m: the kayaks keep at least this far from each other (a soft push from 16 m)
  pairApart: 3,     // m: two of a pair (one group) only this far (a push from 6 m): they paddle together
  shoreKeep: 14,    // m: a push off the shore inside this (the routes keep 15 m; an avoiding kayak may stray)
  shoreStop: 22,    // m off the shore: a kayak turning toward the shore stops here
});
export const CLOSE = Object.freeze({ r: 15, s: 3.5, path: 8 });   // m, s, m: a close call, its reaction, the boat's path's half-width
export const SPEED = Object.freeze({ rest: 0, cruise: 1.31, sprint: 2.01, back: -1.11 });   // m/s, the gaits (agent.js GAIT)

export function createMind(slot) {
  // (a slot may carry its own wants over its personality's: the first pair's nearer close call, src/kayaks/first.js)
  const P = slot.mind ? { ...(PERSONA[slot.personality] ?? PERSONA.casual), ...slot.mind } : PERSONA[slot.personality] ?? PERSONA.casual;
  const seed = slot.seed ?? 1;
  return { P, seed, n: 0, t: 0, next: P.scan[0] + (P.scan[1] - P.scan[0]) * hash01(seed, 900), action: 'route', plan: null, since: 0, pause: 0, lookT: 0, look: null, cpa: null, seen: null, shore: null, shoreAt: -1e9, closeT: 0, closeMode: null, closed: false, braceT: 0, deaf: false, events: [] };
}

// the closest point of approach of a kayak and a boat on straight lines at their velocities: t (s from now, ≥ 0), d (m),
// ahead: where the kayak is then along the boat's course (m, + ahead of the boat's centre: crossing its bow)
export function cpa(k, b) {
  const rx = k.x - b.x, rz = k.z - b.z, vx = k.vx - b.vx, vz = k.vz - b.vz, v2 = vx * vx + vz * vz;
  const t = v2 > 1e-6 ? Math.max(0, -(rx * vx + rz * vz) / v2) : 0;
  const px = rx + vx * t, pz = rz + vz * t, bs = Math.hypot(b.vx, b.vz) || 1;
  return { t, d: Math.hypot(px, pz), ahead: (px * b.vx + pz * b.vz) / bs };
}

const kayakVel = (a, v = a.v, h = a.heading) => ({ x: a.x, z: a.z, vx: Math.sin(h) * v, vz: -Math.cos(h) * v });
// the heading toward the nearest shore (down the shore distance's slope)
function shoreHeading(terrain, x, z) {
  const off = (px, pz) => -terrain.shoreDistance(px, pz), e = 3;
  const gx = (off(x + e, z) - off(x - e, z)) / (2 * e), gz = (off(x, z + e) - off(x, z - e)) / (2 * e);
  return Math.atan2(-gx, gz);   // ahead is (sin h, −cos h): toward −∇off
}

// one option played out: the kayak turns toward its heading (≈ 10°/s under way, 9°/s on the spot) and eases to its speed
// (τ 2.5 s); the boat keeps its velocity (a sailboat cannot stop). Its cost: the gap short of the wanted one, any time
// spent in the boat's path ahead of its bow, any water a kayak should not be in, and the effort (the persona's bias)
function playOut(a, b, opt, P, terrain, want) {
  const dt = 0.5, n = Math.round(MIND.horizon / dt), bs = Math.hypot(b.vx, b.vz) || 1, ux = b.vx / bs, uz = b.vz / bs;
  let x = a.x, z = a.z, h = a.heading, v = a.v, gap = Infinity, inPath = 0, bad = 0, stopAt = null;
  for (let i = 1; i <= n; i++) {
    const t = i * dt;
    let wantV = opt.speed;
    if (opt.action === 'shore' && (stopAt != null || -terrain.shoreDistance(x, z) < MIND.shoreStop)) { wantV = 0; stopAt ??= t; }
    if (opt.heading != null && wantV > 0) {
      const e = wrap(opt.heading - h), rate = (Math.abs(e) > 70 * DEG ? 9 : 10) * DEG * dt;
      h += clamp(e, -rate, rate);
      if (Math.abs(e) > 70 * DEG) wantV = Math.min(wantV, 0.6);
    }
    v += (wantV - v) * (1 - Math.exp(-dt / 2.5));
    x += Math.sin(h) * v * dt; z -= Math.cos(h) * v * dt;
    const bx = b.x + b.vx * t, bz = b.z + b.vz * t, rx = x - bx, rz = z - bz;
    const d = Math.hypot(rx, rz); if (d < gap) gap = d;
    // in the boat's path: from its stern (≈ 6 m back) to 50 m ahead of its bow, within 7 m of its course line (its beam is
    // 3.6 m: a kayak 7 m off the line is ≈ 5 m clear of the hull)
    const along = rx * ux + rz * uz, across = Math.abs(rx * uz - rz * ux);
    if (along > -6 && along < 50 && across < 7) inPath += dt;
    if (i % 4 === 0 && !okWater(terrain, x, z, 10)) bad++;
  }
  const short = Math.max(0, want - gap) / want;
  // (and a gap far wider than wanted is a detour nobody makes: a confident paddler passes at about its gap, owner 2026-11-08)
  const wide = Math.min(1, Math.max(0, gap / want - 1.0) * 0.5);
  const cost = 10 * short * short + 1.2 * inPath + 20 * bad + (P.bias[opt.action] ?? 0) + opt.effort + wide;
  return { ...opt, cost, gap, inPath };
}

// the four options at this look, scored; the cheapest
export function choose(a, m, world) {
  const { boat: b, terrain } = world, P = m.P, want = P.want;
  const pace = P.pace === 1 ? SPEED.sprint : SPEED.cruise, routeH = routeHeading(a);
  const opts = [{ action: 'hold', heading: routeH, speed: a.restLeft > 0 ? 0 : SPEED.cruise, throttle: a.restLeft > 0 ? 0 : 0.5, effort: 0 }];
  // pass astern: a turn away from the boat's bow, to cross behind its stern (tried every 15° up to 120° each way; only a
  // turn that ends up behind the boat counts as astern, the rest are holds in disguise and score as such)
  for (let k = 1; k <= 8; k++) for (const s of [-1, 1]) {
    const h = wrap(routeH + s * k * 15 * DEG);
    opts.push({ action: 'astern', heading: h, speed: pace, throttle: P.pace, effort: 0.25 * k / 8 });
  }
  opts.push({ action: 'shore', heading: shoreHeading(terrain, a.x, a.z), speed: pace, throttle: P.pace, effort: 0.3 });
  opts.push({ action: 'wait', heading: null, speed: 0, throttle: 0, effort: 0.2 });
  const scored = opts.map((o) => playOut(a, b, o, P, terrain, want));
  // an 'astern' that does not pass behind the boat (the boat's centre is past the kayak's crossing before the kayak gets
  // there) is just another heading: it keeps its cost, but is labelled for what it does
  for (const o of scored) if (o.action === 'astern' && o.inPath > 0) o.cost += 0.5;
  scored.sort((p, q) => p.cost - q.cost);
  return scored[0];
}
function routeHeading(a) { const t = a.path.at(a.s + 12); return Math.atan2(t.x - a.x, -(t.z - a.z)); }

// one step of the mind: a look when it is due (the boat seen, the prediction, a choice), then the steering for the
// action in force, pushed off the other kayaks and the shore
export function think(a, m, dt, world) {
  m.t += dt; m.since += dt;
  const P = m.P, b = world.boat;
  const range = b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity;
  const bSpeed = b ? Math.hypot(b.vx, b.vz) : 0;
  // ---- a look round (every 2–8 s by personality; resting or drifting looks less often) ----
  if (m.t >= m.next) {
    m.n++;
    const u = hash01(m.seed, 901, m.n), busy = a.restLeft > 0 ? MIND.busyAdd[0] + (MIND.busyAdd[1] - MIND.busyAdd[0]) * hash01(m.seed, 902, m.n) : 0;
    m.next = m.t + P.scan[0] + (P.scan[1] - P.scan[0]) * u + busy;
    if (b && range < MIND.range) {
      m.seen = { x: b.x, z: b.z, vx: b.vx, vz: b.vz };
      // the prediction against where this kayak means to go (its route's heading at cruise, or the action in force)
      const plannedV = m.action === 'wait' || (m.action === 'route' && a.restLeft > 0) ? 0 : SPEED.cruise;
      const plannedH = m.plan?.heading ?? routeHeading(a);
      m.cpa = cpa(kayakVel(a, plannedV, plannedH), b);
      if (range < MIND.lookRange) m.lookT = P.look;   // the head turns to the boat
      // (a crossing ahead of the bow counts from further off, whoever paddles: never across a sailboat's bow, MIND.aheadM)
      const ahead = m.cpa.ahead > 0 && m.cpa.t < Math.max(P.actT, 40) && m.cpa.d < MIND.aheadM;
      const threat = !m.deaf && bSpeed > 0.6 && ((m.cpa.t < P.actT && m.cpa.d < P.actM) || ahead || (range < P.want && m.cpa.t > 0));
      if (m.action === 'route' || m.action === 'hold') {
        if (threat) {
          const c = choose(a, m, world);
          if (c.action === 'hold') { m.action = 'hold'; m.plan = null; }
          else { m.pause = m.action === 'route' || m.action === 'hold' ? P.pause[0] + (P.pause[1] - P.pause[0]) * hash01(m.seed, 903, m.n) : 0; m.action = c.action; m.plan = c; m.since = 0; }
        } else if (m.action === 'hold') m.action = 'route';
      } else if (m.since >= MIND.minHold) {
        // the boat has gone by (the range opening, past the gap wanted or far off): back to the route
        const opening = (a.x - b.x) * (b.vx - kayakVel(a).vx) + (a.z - b.z) * (b.vz - kayakVel(a).vz) < 0;
        if ((opening && range > P.want) || !threat && opening) { m.action = 'route'; m.plan = null; }
        else {
          // a later look: a clearly better option replaces the one in force (a new heading counts, past 10°); back to the
          // route's heading only while the one in force has gone bad (the boat changed course): else it holds till the boat
          // has gone by
          const c = choose(a, m, world), cur = m.plan ? playOut(a, b, m.plan, P, world.terrain, P.want) : null;
          const differs = !cur || c.action !== m.action || (c.heading != null && cur.heading != null && Math.abs(wrap(c.heading - cur.heading)) > 10 * DEG);
          const curBad = !cur || cur.gap < 0.75 * P.want || cur.inPath > 0;
          // (or gone needlessly wide: the boat will pass well clear on the route's own heading, so back to it, a confident
          // paddler passing at about its gap rather than paddling away from the boat)
          const curWide = cur && cur.gap > 1.8 * P.want && c.action === 'hold' && c.gap >= 0.8 * P.want && c.inPath === 0;
          if (differs && (!cur || c.cost < MIND.switchK * cur.cost || curWide) && (c.action !== 'hold' || curBad || curWide)) { m.action = c.action; m.plan = c.action === 'hold' ? null : c; m.since = 0; }
        }
      }
    } else if (m.action !== 'route' && m.since >= MIND.minHold) { m.action = 'route'; m.plan = null; }
  }
  // ---- the head: toward the boat while a look lasts, and through an action while the boat is near ----
  m.lookT -= dt;
  const watching = b && (m.lookT > 0 || (m.action !== 'route' && m.action !== 'hold' && range < MIND.lookRange));
  a.look = watching ? clamp(wrap(Math.atan2(b.x - a.x, -(b.z - a.z)) - a.heading) / DEG, -100, 100) : null;
  // ---- a close call (step 3): the boat inside CLOSE.r m and closing: a sprint away, or (in its path ahead of
  // it, where a sprint would cross its bow) a back-off, for CLOSE.s s; once per kayak it tells the fleet (the skipper's
  // "Too close"). A bump (the fleet sets braceT): a brace, back strokes, the paddler steadying the kayak ----
  if (b && !m.deaf && range < (P.closeR ?? CLOSE.r) && !m.closed) {   // (P.closeR: the first pair, laid near the boat, start at a nearer miss)
    const rx = a.x - b.x, rz = a.z - b.z, closing = rx * (b.vx - kayakVel(a).vx) + rz * (b.vz - kayakVel(a).vz) > 0;
    if (closing) {
      const bs = Math.hypot(b.vx, b.vz) || 1, along = (rx * b.vx + rz * b.vz) / bs, across = Math.abs(rx * b.vz - rz * b.vx) / bs;
      m.closed = true; m.closeT = CLOSE.s; m.closeMode = along > 0 && across < CLOSE.path ? 'back' : 'sprint';
      m.closeAway = Math.atan2(rx, -rz);   // straight away from the boat
      m.events.push({ type: 'close', d: range });
    }
  }
  if (m.braceT > 0 || m.closeT > 0) {
    let intent;
    if (m.braceT > 0) { m.braceT -= dt; intent = a.intent = { throttle: -0.6, turn: 0 }; }
    else {
      m.closeT -= dt;
      intent = m.closeMode === 'back' ? (a.intent = { throttle: -0.6, turn: 0 }) : steerTo(a, m.closeAway, 1);
    }
    if (m.closeT <= 0 && m.braceT <= 0) { m.action = 'route'; m.plan = null; }
    return intent;
  }
  // ---- the steering ----
  let intent;
  if (m.pause > 0) { m.pause -= dt; intent = { throttle: 0, turn: 0 }; a.intent = intent; }   // the paddle stops: a beat to decide
  else if (m.action === 'wait') { intent = { throttle: a.v > 0.2 ? -0.6 : 0, turn: 0 }; a.intent = intent; }   // a back stroke or two to stop (a kayak glides a long way), then still
  else if (m.action === 'astern' || m.action === 'shore') {
    const atShore = m.action === 'shore' && -world.terrain.shoreDistance(a.x, a.z) < MIND.shoreStop;
    intent = atShore ? (a.intent = { throttle: 0, turn: 0 }) : steerTo(a, push(a, m.plan.heading, world, dt, m), m.plan.throttle);
  } else {
    intent = steer(a, dt, { heading: (h) => push(a, h, world, dt, m), throttle: meetPace(a, m, world.boat, range) });
  }
  return intent;
}

// The meeting's pace (owner 2026-11-08, round 2b: the kayaks passed 17–24 m off in play, the boat's speed and course being
// the player's): a kayak the plan sent to meet the boat (slot.meet) keeps time with the boat while it is still far off
// (over MEET_PACE.far m, before it has had to act): once a second it finds where the boat's present course crosses its
// route ahead, and paddles on, rests a moment or sprints so it reaches that point just after the boat has passed it. Out of
// the player's sight (a kayak 130 m off is a fleck), so the meeting holds whatever the boat does; then the mind as ever.
const MEET_PACE = Object.freeze({ far: 50, slack: 1.5, early: 4, trim: 2, ahead: 450, every: 1, kayakMs: 1.28 });
export function meetPace(a, m, b, range, M = MEET_PACE) {
  if (!a.slot.meet || m.meetDone || !b || a.restLeft > 0) return 0.5;
  if (range < M.far || m.action !== 'route') { m.meetDone = true; return 0.5; }
  const bs = Math.hypot(b.vx, b.vz);
  if (bs < 1) return 0.5;
  // its own pace as it really goes (the approved paddler's strokes and sweeps make 0.9–2 m/s)
  const kv = Math.min(2.0, Math.max(0.9, a.v));
  if (!m.paceAt || m.t - m.paceAt >= M.every) {
    m.paceAt = m.t;
    const L = a.path.length, xs = routeCrossings(a.slot.route, b.x, b.z, Math.atan2(b.vx, -b.vz))
      .map((c) => ({ ...c, ds: ((c.s - a.s) % L + L) % L })).filter((c) => c.ds < M.ahead && c.d / bs < 200).sort((p, q) => p.ds - q.ds);
    const c = xs[0];
    if (!c) m.pace = 0.5;
    else {
      // its moment: just after the boat has gone by, so that holding on it passes the stern at about its gap (crossing the
      // boat's line Δ m astern of it passes Δ·sin θ off, θ the angle of their relative motion): no swerve, a clean close pass
      const lag = (m.P.want - MEET_PACE.trim) / (bs * Math.sin(Math.atan2(kv, bs)));
      const late = c.ds / kv - (c.d / bs + lag);   // s: + the kayak would get there after its moment
      m.pace = late > M.slack ? 1 : late < -M.early ? 0 : 0.5;
    }
  }
  return m.pace ?? 0.5;
}

// the soft pushes: off the other kayaks (≥ MIND.apart, from twice that) and off the shore (inside MIND.shoreKeep)
function push(a, heading, world, dt, m) {
  let fx = Math.sin(heading), fz = -Math.cos(heading), n = 0;
  for (const o of world.others ?? []) {
    if (o === a) continue;
    // (a pair paddles together: two of one group keep only MIND.pairApart apart, src/kayaks/first.js)
    const pair = a.slot?.group != null && a.slot.group === o.slot?.group, ap = pair ? MIND.pairApart : MIND.apart;
    const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), R = 2 * ap;
    if (d >= R || d < 1e-6) continue;
    const k = 4 * ((R - d) / (R - ap * 0.5)) ** 2; fx += dx / d * k; fz += dz / d * k; n++;
  }
  // the shore: its distance read twice a second (a terrain query), the push along the slope away from it
  if (m.t - m.shoreAt > 0.5) { m.shoreAt = m.t; const off = -world.terrain.shoreDistance(a.x, a.z); m.shore = off < MIND.shoreKeep ? { off, h: shoreHeading(world.terrain, a.x, a.z) } : null; }
  if (m.shore) { const k = 2 * (1 - m.shore.off / MIND.shoreKeep); fx -= Math.sin(m.shore.h) * k; fz += Math.cos(m.shore.h) * k; n++; }
  return n ? Math.atan2(fx, -fz) : heading;
}
