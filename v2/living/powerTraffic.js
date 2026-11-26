// The south shore's power traffic (South Lake's birthplace, phase C): two runabouts out of the Tahoe Keys and a jet ski off Ski Run,
// on the busy lake's rules (v2/living/busyLake.js: region rows, device tiers, the avoidance's evadeHeading). Their routes are the
// south-lake region's `traffic` rows of kind 'power' and 'jetski' (src/waters/<id>.json; v2/sim/regions.js trafficOf): closed loops,
// each leg in 4 m of water and 80 m off the shore (v2/tests/busy-lake.test.mjs). Generic boats by code, no names or liveries.
//   runabout  a 6.6 m bowrider: idles out of the Keys' no-wake water at 5 kn (a `slow` leg), opens the throttle, rises over the hump
//             (her bow up about 7° near 11 kn) and planes at the lap's speed (row.kn, 15–25 kn: seeded per lap); she banks into her turns
//             and slows for the sharp ones (a planing hull's turn: about 12°/s at speed).
//   jet ski   a 3.2 m sit-down ski: quick and playful, S-curves either side of her loop (row.weave: amplitude m, wavelength m), 22–30 kn,
//             banking hard; her loop stays off the swimmers' beaches (80 m off the shore, 4 m of water, the weave included).
// Where each is when a page opens comes from the day's clock and the seed (a seeded offset run at her mean speed), so a reload at the
// same ?hour and ?seed finds them in the same places. A first birth in the region (Ski Run) shifts the runabout that comes nearest and
// the jet ski once so each passes in view within a minute (birthS: cheat on when, never on motion). Power gives way: each keeps clear
// of the player, the paddle-wheeler (she has right of way), the sailboats (power gives way to sail) and the kayakers: an evasion turn
// (busyLake.js evadeHeading, no no-go cone for an engine) and a slow-down when a pass would still be close, never into shoal water
// or a pier. The player meets a soft hull (two circles each: v2/sim/channelMarks.js createMarkBodies). They are out in the day only
// (BUSY.day) and stand down in a race. Tessie (v2/sim/tessieHits.js): a runabout may be knocked down (heeled hard, the engine cut, she
// rights and goes on); the jet ski's rider is splashed only (he ducks and slows; nobody goes in the water).
// Pure: no DOM, no GPU, no Math.random, no wall clock (the seed, the hour and the sim clock only).
//   const T = createPowerTraffic({ rows, seed, hour, birth, depthAt, piers, tier, onBump })
//   T.post(S, dt, t, { hour, race, others })   the tick (sea.addPost); others: [{ x, z, heading, u, m }] kept clear of (the paddle-
//                                               wheeler's m is her length, the sailboats', the kayakers')
//   T.boats → [{ id, kind, x, z, heading, v, heel, trim, plane, live, duck, row }]   T.live → the boats out now
//   T.targets() → Tessie's entries;  T.hit(id, rule, side) → bool;  T.emitters(focus) → their wakes (render/vesselWake.js)
import { routeLoop, pointAt } from '../sim/tourBoat.js';
import { createMarkBodies } from '../sim/channelMarks.js';
import { pierDistance } from '../sim/paddleWheeler.js';
import { evadeHeading, BUSY, hash01 } from './busyLake.js';
import { wrap } from '../../src/sim/core/math.js';

const DEG = Math.PI / 180, KN = 0.514444;
const smooth = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

export const POWER = Object.freeze({
  power: Object.freeze({ length: 6.6, beam: 2.5, slowKn: 5, accel: 1.1, decel: 1.4, yawFast: 12, yawSlow: 18, bankDeg: 11, bankK: 0.95, look: 34,
    trimHumpDeg: 7, trimPlaneDeg: 2.6, humpKn: 11, planeKn: 17, hull: Object.freeze([[1.7, 1.25], [-1.7, 1.25]]), circleKg: 900 }),
  jetski: Object.freeze({ length: 3.2, beam: 1.2, slowKn: 5, accel: 2.4, decel: 2.2, yawFast: 34, yawSlow: 45, bankDeg: 20, bankK: 1.4, look: 22,
    trimHumpDeg: 5, trimPlaneDeg: 2, humpKn: 9, planeKn: 14, hull: Object.freeze([[0.7, 0.75], [-0.8, 0.75]]), circleKg: 380 }),
  sharpDeg: 55, sharpAheadM: 70, sharpKn: 12,   // a turn of more than sharpDeg in the next sharpAheadM: down to sharpKn
  avoid: Object.freeze({ everyS: 0.25, aheadS: 20, rangeM: 450, playerM: 60, paddleM: 75, boatM: 40, kayakM: 45, holdS: 4, stepDeg: 10, maxDeg: 80, noGoDeg: -1, slowS: 10 }),
  clear: Object.freeze({ depthM: 3.0, pierM: 30, lookM: [20, 60, 110] }),
  // the first birth: a pass within nearM of the player's reach within withinS (at every speed he may make), at least minM off at the start
  birth: Object.freeze({ withinS: 90, nearM: 450, minM: 250, closeM: 80, speeds: Object.freeze([2, 3.25, 4.5]), stepM: 40, probeS: 5 }),
  // Tessie: a runabout knocked down heels to peakDeg over upS, cut engine, righted over rightS, idles holdS; the jet ski's rider ducks duckS
  knock: Object.freeze({ peakDeg: 38, upS: 0.5, rightS: 3.5, holdS: 6 }), duckS: 2.2,
  tiers: Object.freeze({ full: 3, lite: 2, phone: 1, off: 0 }),   // boats out at once (prio order; the jet ski and the near runabout first)
  trailDt: 0.25, trailKeep: 24,
});

// a row's loop for the timetable: [x, z] or { at, slow } → { at, fast } (tourBoat.js routeLoop's shape: fast = not slow)
export const loopOfRow = (row) => routeLoop((row.route ?? []).map((e) => (Array.isArray(e) ? { at: e, fast: true } : { at: e.at, fast: !e.slow })));
const meanKn = (row) => (row.kn ? (row.kn[0] + row.kn[1]) / 2 : 18);
// the place on her loop at the clock: a seeded offset run at her mean speed since midnight (deterministic per hour and seed)
export const clockS = (row, loop, seed, hour) => (((hash01(seed, strHash(row.id)) * loop.length + hour * 3600 * meanKn(row) * KN * 0.8) % loop.length) + loop.length) % loop.length;
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
// the weave's offset (m, to starboard of her loop) at s along it
const weaveAt = (row, s) => (row.weave ? row.weave[0] * Math.sin(2 * Math.PI * s / row.weave[1]) : 0);
// the point she aims at s along her loop (the weave applied)
export function aimAt(row, loop, s) { const p = pointAt(loop, s), w = weaveAt(row, s); return { x: p.x - p.dz * w, z: p.z + p.dx * w, dx: p.dx, dz: p.dz }; }

// the first birth: s along her loop such that she passes within nearM of the player's reach at every speed within withinS, closing at
// least closeM, at least minM off at the start; the seed picks among those (null: none passes)
export function birthS(row, loop, birth, { seed = 1, K = POWER } = {}) {
  const B = K.birth, h = (birth.headingDeg ?? 0) * DEG, sx = Math.sin(h), sz = -Math.cos(h), u = meanKn(row) * KN * 0.85, ok = [];
  for (let s = 0; s < loop.length; s += B.stepM) {
    const p0 = aimAt(row, loop, s), d0 = Math.hypot(p0.x - birth.x, p0.z - birth.z);
    if (d0 < B.minM) continue;
    let hi = 0;
    for (const w of B.speeds) {
      let dmin = Infinity;
      for (let t = B.probeS; t <= B.withinS; t += B.probeS) { const p = aimAt(row, loop, s + u * t), d = Math.hypot(p.x - birth.x - sx * w * t, p.z - birth.z - sz * w * t); if (d <= d0 - B.closeM) dmin = Math.min(dmin, d); }
      hi = Math.max(hi, dmin);
    }
    if (hi <= B.nearM) ok.push(s);
  }
  return ok.length ? ok[Math.min(ok.length - 1, Math.floor(hash01(seed, strHash(row.id) + 99) * ok.length))] : null;
}

export function createPowerTraffic({ rows = [], seed = 1, hour = 13, birth = null, depthAt = () => 20, piers: piers0 = [], tier = 'full', onBump = null, K = POWER } = {}) {
  const cap = K.tiers[tier] ?? K.tiers.full;
  let piers = piers0;
  const list = rows.filter((r) => r.kind === 'power' || r.kind === 'jetski').slice().sort((a, b) => (a.prio ?? 0) - (b.prio ?? 0) || (a.id < b.id ? -1 : 1));
  const stats = { evades: 0, slows: 0, shore: 0, knocks: 0, splashes: 0, contacts: 0, stepUs: 0, births: 0 };
  const nearPiers = (loop) => piers.filter((p) => loop.seg.some((g) => { const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - g.a[0]) * dx + (p[1] - g.a[1]) * dz) / L2)); return Math.hypot(p[0] - g.a[0] - dx * t, p[1] - g.a[1] - dz * t) < 500; }));
  const boats = list.map((row, i) => {
    const C = K[row.kind], loop = loopOfRow(row);
    let s = clockS(row, loop, seed, hour);
    // a first birth in her region: the jet ski and the runabout whose loop comes nearest pass in view within a minute
    const bs = birth ? birthS(row, loop, birth, { seed, K }) : null;
    if (bs != null) { s = bs; stats.births++; }
    const p = aimAt(row, loop, s), q = aimAt(row, loop, s + 3), seg = loop.seg.find((g) => s >= g.s0 && s <= g.s0 + g.L) ?? loop.seg[0];
    const v0 = (seg.fast ? meanKn(row) : C.slowKn) * KN;
    const b = { id: row.id, kind: row.kind, row, C, loop, i, s, x: p.x, z: p.z, heading: Math.atan2(q.x - p.x, -(q.z - p.z)), v: v0, yawRate: 0, heel: 0, trim: 0, plane: 0,
      lap: 0, lapKn: null, live: i < cap, evade: null, evadeUntil: -1, avoidT: (i * 0.07) % K.avoid.everyS, slowK: 1, knockT: null, knockSide: 0, duckT: null, duck: 0,
      trail: [], trailT: 0, piers: nearPiers(loop), bodies: null, circles: null, born: bs != null };
    b.lapKn = row.kn ? row.kn[0] + (row.kn[1] - row.kn[0]) * hash01(seed, strHash(row.id) + 1) : 18;
    b.circles = C.hull.map(([f, r], k) => ({ id: `${row.id}:${k}`, f, x: b.x, z: b.z, r, mass: C.circleKg }));
    b.bodies = createMarkBodies(b.circles, { onBump, rode: { period: 4, tau: 1.2, maxOff: 0.4 } });
    return b;
  });
  let ticks = 0;
  const clearOf = (b) => (h, _secs, st) => { for (const d of K.clear.lookM) { const x = st.x + Math.sin(h) * d, z = st.z - Math.cos(h) * d; if (depthAt(x, z) < K.clear.depthM || (b.piers.length && pierDistance(b.piers, x, z, 200) < K.clear.pierM)) return false; } return true; };
  const threats = [];
  // the speed she wants at s: the lap's on a fast leg, 5 kn on a slow one (eased down 60 m ahead of it); down for a sharp turn ahead
  function wantV(b) {
    const seg = b.loop.seg.find((g) => b.s >= g.s0 && b.s <= g.s0 + g.L) ?? b.loop.seg[0];
    let v = (seg.fast ? b.lapKn : b.C.slowKn) * KN;
    const ahead = b.loop.seg.find((g) => { const ds = ((g.s0 - b.s) % b.loop.length + b.loop.length) % b.loop.length; return ds > 0 && ds < 80; });
    if (ahead && !ahead.fast) v = Math.min(v, b.C.slowKn * KN + 0.6);
    // a sharp corner ahead: the heading change over the next sharpAheadM
    const p0 = pointAt(b.loop, b.s), p1 = pointAt(b.loop, b.s + K.sharpAheadM);
    if (Math.abs(wrap(Math.atan2(p1.dx, -p1.dz) - Math.atan2(p0.dx, -p0.dz))) > K.sharpDeg * DEG && !b.row.weave) v = Math.min(v, K.sharpKn * KN);
    return v;
  }
  function step(b, dt, S, othersNow, t) {
    const C = b.C, st = b;
    // Tessie's knockdown (a runabout): heeled hard, the engine cut, righted, a few seconds at idle
    if (b.knockT != null) {
      b.knockT += dt; const k = K.knock, u = b.knockT;
      const peak = k.peakDeg * DEG * b.knockSide;
      b.heel = u < k.upS ? peak * smooth(0, k.upS, u) : peak * Math.max(0, 1 - (u - k.upS) / k.rightS) ** 2 * Math.cos(Math.min(1, (u - k.upS) / k.rightS) * Math.PI * 1.5);
      b.v = Math.max(0, b.v - 3 * dt);
      if (u > k.upS + k.rightS + k.holdS) { b.knockT = null; b.heel = 0; }
      b.x += Math.sin(b.heading) * b.v * dt; b.z -= Math.cos(b.heading) * b.v * dt;
      return;
    }
    if (b.duckT != null) { b.duckT += dt; b.duck = Math.sin(Math.min(1, b.duckT / K.duckS) * Math.PI); if (b.duckT > K.duckS) { b.duckT = null; b.duck = 0; } }
    // the avoidance, a few times a second: the player, the paddle-wheeler, the sailboats and the kayakers (others), the other power boats
    b.avoidT -= dt;
    if (b.avoidT <= 0) {
      b.avoidT = K.avoid.everyS; threats.length = 0;
      const A = K.avoid, near = (o) => Math.abs(o.x - b.x) < A.rangeM && Math.abs(o.z - b.z) < A.rangeM;
      if (S && near(S)) threats.push({ x: S.x, z: S.z, heading: S.heading ?? 0, u: Math.max(0, S.u ?? 0), m: A.playerM });
      for (const o of othersNow) if (near(o)) threats.push(o);
      for (const o of boats) if (o !== b && o.live && near(o) && o.i < b.i) threats.push({ x: o.x, z: o.z, heading: o.heading, u: o.v, m: A.boatM, boat: true });   // the later in the list gives way
      const a0 = aimAt(b.row, b.loop, b.s + C.look), want = Math.atan2(a0.x - b.x, -(a0.z - b.z));
      // an engine has no no-go cone; a 'wind' on her port beam makes the search turn to starboard first (the power-driven habit)
      let h = threats.length ? evadeHeading({ x: b.x, z: b.z, heading: b.heading, u: b.v }, want, threats, want - Math.PI / 2, clearOf(b), A) : null;
      if (h != null) { if (b.evade == null) stats.evades++; b.evade = h; b.evadeUntil = t + A.holdS; } else if (t > b.evadeUntil) b.evade = null;
      // still close on the course she steers: slow (an engine can stop), down to a crawl when the pass is under half the margin
      let k = 1;
      for (const o of threats) {
        const hh = b.evade ?? want, vx = Math.sin(o.heading) * o.u - Math.sin(hh) * b.v, vz = -Math.cos(o.heading) * o.u + Math.cos(hh) * b.v, px = o.x - b.x, pz = o.z - b.z, vv = vx * vx + vz * vz;
        const tc = vv < 1e-6 ? 0 : Math.max(0, Math.min(A.slowS, -(px * vx + pz * vz) / vv)), d = Math.hypot(px + vx * tc, pz + vz * tc), dNow = Math.hypot(px, pz);
        if (d < o.m && tc < A.slowS) k = Math.min(k, Math.max(0.08, (d / o.m) * (tc / A.slowS) + 0.15));
        if (dNow < o.m * 0.9) k = Math.min(k, Math.max(0.05, dNow / o.m - 0.4));
      }
      if (k < 1 && b.slowK >= 1) stats.slows++;
      b.slowK = k;
    }
    // the heading she steers: the evasion, else the pursuit point on her loop (the weave in it)
    const aim = aimAt(b.row, b.loop, b.s + C.look);
    const hw = b.evade ?? Math.atan2(aim.x - b.x, -(aim.z - b.z));
    if (!clearOf(b)(b.heading, 0, st)) stats.shore++;   // her bow at shoal water or a pier inside the look (a count: her route keeps her off)
    const vT = wantV(b) * b.slowK;
    b.v += Math.max(-C.decel * dt, Math.min(C.accel * dt * (b.v < C.humpKn * KN ? 0.75 : 1), vT - b.v));   // slower through the hump
    b.v = Math.max(0, b.v);
    // the turn: a planing hull's rate (yawFast at speed, yawSlow slower), eased (no snap)
    const vk = b.v / KN, rateMax = (vk > 12 ? C.yawFast : C.yawSlow + (C.yawFast - C.yawSlow) * vk / 12) * DEG * Math.min(1, 0.3 + b.v / 3);
    const err = wrap(hw - b.heading), rWant = Math.max(-rateMax, Math.min(rateMax, err * 1.6));
    b.yawRate += (rWant - b.yawRate) * (1 - Math.exp(-dt / 0.35));
    b.heading = wrap(b.heading + b.yawRate * dt);
    b.x += Math.sin(b.heading) * b.v * dt; b.z -= Math.cos(b.heading) * b.v * dt;
    // her progress along the loop: the nearest point ahead of her last
    let best = b.s, bd = Infinity;
    for (let ds = -10; ds <= 40; ds += 2) { const p = pointAt(b.loop, b.s + ds), d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; best = b.s + ds; } }
    const L = b.loop.length, ns = ((best % L) + L) % L;
    if (ns < b.s - L / 2) { b.lap++; b.lapKn = b.row.kn ? b.row.kn[0] + (b.row.kn[1] - b.row.kn[0]) * hash01(seed + b.lap, strHash(b.row.id) + 1) : b.lapKn; }
    b.s = ns;
    // the ride: the bank into the turn (+ starboard down: turning to starboard banks her that way), the bow up over the hump, the plane
    const bank = Math.max(-C.bankDeg, Math.min(C.bankDeg, b.yawRate / DEG * b.v * C.bankK * 0.1)) * DEG;
    b.heel += (bank - b.heel) * (1 - Math.exp(-dt / 0.4));
    b.plane = smooth(C.humpKn * 0.75, C.planeKn, vk);
    const hump = smooth(C.slowKn, C.humpKn, vk) * (1 - smooth(C.humpKn, C.planeKn + 3, vk));
    const trimT = (C.trimHumpDeg * hump + C.trimPlaneDeg * b.plane * (1 - hump) + 0.6 * smooth(1, C.slowKn, vk) * (1 - b.plane)) * DEG;
    b.trim += (trimT - b.trim) * (1 - Math.exp(-dt / 0.6));
  }
  function record(b, dt) {
    for (const p of b.trail) p.age += dt;
    b.trailT -= dt;
    if (b.trailT <= 0) {
      b.trailT += K.trailDt;
      const fx = Math.sin(b.heading), fz = -Math.cos(b.heading), vk = b.v / KN;
      // the churn: the prop's (or the pump's) wash by the throttle, heaviest climbing the hump
      const churn = 0.5 * smooth(1, 6, vk) + 0.7 * smooth(b.C.slowKn, b.C.humpKn, vk) * (1 - 0.4 * b.plane);
      b.trail.unshift({ age: 0, x: b.x, z: b.z, fx, fz, v: b.v, churn });
      while (b.trail.length && b.trail[b.trail.length - 1].age > K.trailKeep) b.trail.pop();
    }
  }
  function post(S, dt, t = 0, { hour: hr = 13, race = false, others = [] } = {}) {
    if (!(dt > 0)) return;
    const t0 = globalThis.performance?.now?.() ?? 0;
    ticks++;
    const day = hr >= BUSY.day[0] && hr < BUSY.day[1];
    for (const b of boats) {
      const on = b.i < cap && day && !race;
      if (!on) { b.live = false; continue; }
      b.live = true;
      step(b, dt, S, others, t);
      record(b, dt);
      // the soft hull: the player's hull against her circles
      const fx = Math.sin(b.heading), fz = -Math.cos(b.heading), bs = b.bodies.bodies;
      for (let k = 0; k < b.circles.length; k++) { const nx = b.x + fx * b.circles[k].f, nz = b.z + fz * b.circles[k].f; if (ticks === 1 || !S) { bs[k].x = nx; bs[k].z = nz; bs[k].vx = 0; bs[k].vz = 0; } bs[k].x0 = nx; bs[k].z0 = nz; }
      if (S && Math.abs(S.x - b.x) < 20 && Math.abs(S.z - b.z) < 20) { const c0 = b.bodies.stats.contacts; b.bodies.post(S, dt, t); stats.contacts += b.bodies.stats.contacts - c0; }
    }
    const t1 = globalThis.performance?.now?.() ?? 0;
    stats.stepUs = stats.stepUs * 0.95 + (t1 - t0) * 1000 * 0.05;
  }
  return {
    boats, stats, post, K,
    get live() { return boats.filter((b) => b.live); },
    setPiers(list) { piers = list ?? []; for (const b of boats) b.piers = nearPiers(b.loop); },   // the piers (their file arrives after the start)
    // Tessie's view (v2/sim/tessieHits.js kinds 'power' and 'jetski')
    targets() { const out = []; for (const b of boats) if (b.live) out.push({ id: b.id, kind: b.kind, x: b.x, z: b.z, heading: b.heading, u: b.v, L: b.C.length, B: b.C.beam }); return out; },
    // a hit: 'knock' a runabout (heeled, righted); 'splash' the jet ski's rider (he ducks; never in the water)
    hit(id, rule = 'splash', side = 1) {
      const b = boats.find((o) => o.id === id && o.live); if (!b) return false;
      if (rule === 'knock' && b.kind === 'power') { b.knockT = 0; b.knockSide = side >= 0 ? 1 : -1; b.evade = null; stats.knocks++; return true; }
      if (rule === 'splash') { b.duckT = 0; b.v *= 0.55; stats.splashes++; return true; }
      return false;
    },
    // their wakes (render/vesselWake.js emitters): the live boats within the vessels' map of the focus
    emitters(near = () => true) {
      const out = [];
      for (const b of boats) {
        if (!b.live || !near(b)) continue;
        const pw = b.kind === 'power', L = b.C.length;
        out.push({ trail: b.trail, length: L, kelvinAmp: pw ? 1.5 : 0.7, kelvinAge: pw ? 10 : 6,
          arms: { foam: (pw ? 0.75 : 0.5) * (0.4 + 0.6 * (1 - b.plane * 0.5)), w: pw ? 0.9 : 0.5, life: pw ? 8 : 5, x0: b.C.beam / 2 },
          noses: [[L * 0.42, 0]], noseR: pw ? 0.45 : 0.3, noseFoam: 0.5 + 0.5 * b.plane,
          lines: [{ x: 0, aft: L * 0.5 + 0.3, w: pw ? 1.3 : 0.7, foam: pw ? 1.3 : 1.1, life: pw ? 24 : 14 }] });
      }
      return out;
    },
  };
}
