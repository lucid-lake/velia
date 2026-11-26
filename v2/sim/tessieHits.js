// Play as Tessie: the aim, the hit and the knockdown rules (§ 4.1, § 4.2 and § 7 phase 1b; owner, 2026-11-20:
// "playful, never violent": sailboats and the glass boat go over and right themselves; a breach or a splash only spooks a kayaker;
// round B, owner 2026-11-21: "tessie can attack kayak": a kayak marked bite: true (the lake's kayakers, v2/sim/kayaks.js) is a target
// like a sailboat, its hit limits its own size (HITS.lock.kayak*): her jaw on its hull, not the water beside it; the bite rolls it over
// and the paddler swims, rights it and paddles off). Pure: no DOM, no GPU, no Math.random, no wall clock (the caller's clock t). Its cost is a few dozen distance tests a frame.
//   const H = createTessieHits()
//   H.aim(nose { x, z, psi }, list, t) → the boat in the corners: the nearest target within aimM in a 40° cone ahead, not in its grace
//                                        ({ id, kind, x, z, heading, d, inReach } or null); kept (hysteresis) while it
//                                        stays within keep.m and ±keep.deg, and keep.s after it leaves (the corners never flicker as she turns)
//   H.lock(nose, list, t, { nose: m under, way, tablet, dt }) → the lock-on (owner, 2026-11-20: "aim assist"): a target
//                                        within lock.surfaceM (10 m) at the surface, lock.underM (13 m, the 3-D distance to its underbody, the
//                                        hull at most lock.aboveM over her nose) under the water (a tablet + lock.tabletM), in ±lock.coneDeg of
//                                        her heading; its blend k eases in over lock.blendS (smoothstep); it breaks past lock.breakSurfaceM /
//                                        breakUnderM, ±lock.breakDeg, or the player's way lock.steerOutDeg off it for lock.steerOutS (then that
//                                        boat is not locked again for lock.relockS). { id (null once broken: k eases out on the last place), k,
//                                        x, z, heading, u, L, B, d, off, ix, iz (the intercept: the hull led by its way over lock.leadS), under }
//   H.contact(head { x, y, z, locked, targetId }, list, t) → a bite's hit test: her head within lock.touchM of a hull
//                                        (lock.hitM on the locked one) → { hit, side, spooked, d }; a hit starts its grace (as fall does)
//   H.fall(fall { x, z, psi }, list, t) → { hit: the target her front 9 m landed on (within hitM of its hull) or null, side (+1: on its
//                                        starboard rail, the heel she gives), spooked: [kayak ids within spookM] }; a hit starts its grace
//   H.splash(x, z, list) → the kayak ids a breach or a surfacing within spookM of them spooks
//   H.grace(id, t) → bool (45 s after a knockdown a boat is no target);  H.count → the knockdowns so far (her Logbook's number, phase 2)
//   H.holdOff(spine, L, list) → pushes her spine's frames out of the kayaks and the glass boat (horizontally, only where she is near the
//                                surface): she never passes through them (the Halcyon and the lake's sailboats have the sim's own hold)
//   H.rollK(P, side) → the roll moment (N·m) her weight on the rail gives a BoatPhysics boat (B.shove's maths: rollK × mass × g × GM)
// list: [{ id, kind: 'sail' | 'glass' | 'halcyon' | 'kayak' | 'sup' | 'still' | 'power' | 'jetski' | 'paddle', x, z, heading, L, B, u (m/s ahead), bite (a kayak: a target) }]
// ('sup': a stand-up paddleboard, South Lake's: splashed and spooked like a kayak, never a target and never knocked: its paddler wobbles and kneels, v2/sim/sup.js;
// the spooked lists name it by id, so the coming bounty can count each kind)
// ('still': at anchor or moored: never a target; a kayak without bite: the glass boat's, or one capsized already)
// What a hit does to each kind (HIT_RULE, hitRule(kind); the caller applies it): 'knock' a knockdown (the sailboats, the glass boat,
// the Halcyon, the South Lake runabouts: heeled hard, righted), 'splash' a splash only (the jet ski: her rider ducks, never in the
// water, the owner's rule; the paddle-wheeler: a 46 m, 300 t hull is never knocked down), 'capsize' a kayak's (over, a swim, righted)
export const HITS = Object.freeze({
  aimM: 60, coneDeg: 20,     // the corners: a boat within 60 m in a 40° cone ahead
  reachM: 12,                // the lunge's reach (the corners turn amber inside it)
  footM: 9,                  // her front 9 m is the fall's footprint
  hitM: 2.5,                 // m from the hull: her weight lands on its rail
  graceS: 45,                // s a knocked boat is no target (it rights and sails off)
  spookM: 20,                // m: a breach, a fall or a surfacing this near a kayak splashes and spooks it
  rollK: 1.3,                // × the boat's displacement × GM (the revenge's tail sweep, REVENGE.rollK)
  holdS: 12,                 // s the knocked sailboat's crew lets the sheets fly and the helm go (Regatta's holdControls)
  kayakR: Object.freeze([2.4, 1.1]), supR: Object.freeze([2.1, 0.8]), glassR: Object.freeze([6.6, 2.4]),   // m: her clearance ellipses' half-axes (the hull plus her margin)
  powerR: Object.freeze([4.0, 1.9]), jetskiR: Object.freeze([2.2, 1.2]), paddleR: Object.freeze([24.5, 6.0]),   // the South Lake traffic's
  underY: Object.freeze({ kayak: -1.2, sup: -1.0, glass: -1.6, power: -1.0, jetski: -0.6, paddle: -1.9 }),   // m: frames deeper than this pass under them
  //, 2026-11-20, the numbers approved): the corners' hysteresis and the lock-on
  keep: Object.freeze({ m: 70, deg: 30, s: 0.5 }),
  lock: Object.freeze({ surfaceM: 10, underM: 13, aboveM: 15, tabletM: 2, touchM: 2.0, hitM: 3.0, footM: 3.5, coneDeg: 35, breakDeg: 50, breakSurfaceM: 16, breakUnderM: 19,
    steerOutDeg: 60, steerOutS: 0.3, blendS: 0.35, assist: Object.freeze([0.45, 0.55]), assistMax: 20, relockS: 1.0, leadS: 0.4, blend: Object.freeze([1.2, 3.0]), keelY: -0.6, headUnderM: 2.5,
    kayakTouchM: 0.9, kayakHitM: 1.3, kayakRiseM: 1.5 }),   // m from a kayak's hull (3.4 × 0.85 m): unlocked, locked, the rising strike from under it
});
const DEG = Math.PI / 180;
import { wrap } from '../../src/sim/core/math.js';
// what a breach, a fall or a surfacing near it only splashes and spooks (never a hit): the kayaks and the stand-up paddleboards
export const SPOOKABLE = Object.freeze(['kayak', 'sup']);
const spookable = (b) => b.kind === 'kayak' || b.kind === 'sup';
export const HIT_RULE = Object.freeze({ sail: 'knock', glass: 'knock', halcyon: 'knock', power: 'knock', jetski: 'splash', paddle: 'splash', kayak: 'capsize' });
export const hitRule = (kind) => HIT_RULE[kind] ?? null;
const isTarget = (k) => k === 'sail' || k === 'glass' || k === 'halcyon' || k === 'power' || k === 'jetski' || k === 'paddle';
// a boat she may lock on and bite: the sailboats, the glass boat, the Halcyon, and the lake's kayaks (bite: true)
const targetable = (b) => isTarget(b.kind) || (b.kind === 'kayak' && !!b.bite);
// the distance from a point to a boat's hull as an oriented box (L × B about its middle)
export function hullDist(px, pz, b) {
  const fx = Math.sin(b.heading ?? 0), fz = -Math.cos(b.heading ?? 0), dx = px - b.x, dz = pz - b.z;
  const along = Math.abs(dx * fx + dz * fz) - (b.L ?? 8.5) / 2, across = Math.abs(dx * -fz + dz * fx) - (b.B ?? 3) / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across)) + Math.min(0, Math.max(along, across));
}

const smooth01 = (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); };
// the share of the water's numbers at this nose depth (tessiePlay.js mediumU's blend: 1.2 m to 3.0 m)
const underU = (nose, K) => smooth01((nose - K.lock.blend[0]) / (K.lock.blend[1] - K.lock.blend[0]));

export function createTessieHits({ K = HITS } = {}) {
  const grace = new Map();
  let count = 0;
  const inGrace = (id, t) => (grace.get(id) ?? -Infinity) > t;
  // the corners' kept boat (hysteresis: its clock is the caller's t) and the lock's state
  let keptId = null, keptSeen = -Infinity;
  const LK = { id: null, k: 0, raw: 0, x: 0, z: 0, heading: 0, u: 0, L: 8.5, B: 3, d: Infinity, off: 0, ix: 0, iz: 0, under: false, since: -Infinity, steerOut: 0, kind: null };
  const relock = new Map();
  let lockT = null;
  const offOf = (n, b) => Math.abs(wrap(Math.atan2(b.x - n.x, -(b.z - n.z)) - n.psi));
  const entry = (b, dh) => ({ id: b.id, kind: b.kind, x: b.x, z: b.z, heading: b.heading ?? 0, u: b.u ?? 0, L: b.L ?? 8.5, B: b.B ?? 3, d: dh, inReach: dh <= K.reachM });
  const self = {
    K, get count() { return count; },
    grace: inGrace,
    aim(n, list, t = 0) {
      if (!n) return null;
      let best = null, kept = null, keptAny = null;
      for (const b of list) {
        if (!targetable(b) || inGrace(b.id, t)) continue;
        const d = Math.hypot(b.x - n.x, b.z - n.z), o = offOf(n, b), near = d <= (b.L ?? 8) * 0.6;
        const dh = Math.max(0, hullDist(n.x, n.z, b));
        if (b.id === keptId) { keptAny = entry(b, dh); if (d <= K.keep.m && (o <= K.keep.deg * DEG || near)) kept = keptAny; }
        if (d > K.aimM || (o > K.coneDeg * DEG && !near)) continue;
        if (!best || dh < best.d) best = entry(b, dh);
      }
      // hysteresis: the corners' boat stays while it is within keep.m and ±keep.deg, and keep.s after it leaves them
      if (kept) { keptSeen = t; return kept; }
      if (keptAny && t - keptSeen <= K.keep.s) return keptAny;
      keptId = best?.id ?? null; keptSeen = best ? t : -Infinity;
      return best;
    },
    // the lock-on: one call a step (its clock is t; dt overrides the step)
    lock(n, list, t = 0, { nose = 0, way = null, tablet = false, dt = null } = {}) {
      if (!n) { LK.id = null; LK.k = 0; LK.raw = 0; return null; }
      const step = dt ?? (lockT == null ? 0 : Math.max(0, Math.min(0.1, t - lockT)));
      lockT = t;
      const L = K.lock, u = underU(nose, K), tab = tablet ? L.tabletM : 0;
      const R = L.surfaceM + (L.underM - L.surfaceM) * u + tab, Rb = L.breakSurfaceM + (L.breakUnderM - L.breakSurfaceM) * u + tab;
      // the distance to a hull: at the surface across the water; under it the 3-D distance to its underbody (never one far over her nose)
      const dist = (b) => { const dh = Math.max(0, hullDist(n.x, n.z, b)); const dy = Math.max(0, nose + L.keelY); if (dy > L.aboveM) return Infinity; return u <= 0 ? dh : Math.hypot(dh, dy * u); };
      const set = (b, d) => { LK.x = b.x; LK.z = b.z; LK.heading = b.heading ?? 0; LK.u = b.u ?? 0; LK.L = b.L ?? 8.5; LK.B = b.B ?? 3; LK.d = d; LK.off = offOf(n, b); LK.kind = b.kind;
        LK.ix = b.x + Math.sin(LK.heading) * LK.u * L.leadS; LK.iz = b.z - Math.cos(LK.heading) * LK.u * L.leadS; LK.under = u > 0.5; };
      if (LK.id != null) {
        const b = list.find((o) => o.id === LK.id);
        let broke = !b || !targetable(b) || inGrace(b.id, t);
        if (!broke) {
          const d = dist(b); set(b, d);
          const bear = Math.atan2(b.x - n.x, -(b.z - n.z));
          LK.steerOut = way != null && Math.abs(wrap(way - bear)) > L.steerOutDeg * DEG ? LK.steerOut + step : 0;
          broke = d > Rb || (LK.off > L.breakDeg * DEG && d > (b.L ?? 8) * 0.6) || LK.steerOut >= L.steerOutS - 1e-9;
        }
        if (broke) { relock.set(LK.id, t + L.relockS); LK.id = null; LK.steerOut = 0; }
      }
      if (LK.id == null) {
        let best = null, bd = Infinity;
        for (const b of list) {
          if (!targetable(b) || inGrace(b.id, t) || (relock.get(b.id) ?? -Infinity) > t) continue;
          const d = dist(b); if (!(d <= R)) continue;
          if (offOf(n, b) > L.coneDeg * DEG && d > (b.L ?? 8) * 0.6) continue;
          if (d < bd) { bd = d; best = b; }
        }
        if (best) { if (LK.raw > 0 && LK.lastId !== best.id) LK.raw = 0; LK.id = best.id; LK.lastId = best.id; LK.since = t; LK.steerOut = 0; set(best, bd); }
      }
      // the blend: in over blendS, smoothstepped; out as fast once broken (on the last place)
      LK.raw = Math.min(1, Math.max(0, LK.raw + (LK.id != null ? 1 : -1) * step / L.blendS));
      LK.k = smooth01(LK.raw);
      return LK.k > 0 || LK.id != null ? LK : null;
    },
    get locked() { return LK.id; },
    contact(h, list, t = 0) {
      const L = K.lock, spooked = [];
      let hit = null, best = Infinity;
      for (const b of list) {
        if (b.kind === 'sup') { if (Math.hypot(b.x - h.x, b.z - h.z) <= K.spookM * 0.5) spooked.push(b.id); continue; }
        if (b.kind === 'kayak' && (!b.bite || inGrace(b.id, t))) { if (Math.hypot(b.x - h.x, b.z - h.z) <= K.spookM * 0.5) spooked.push(b.id); continue; }
        if (b.kind === 'kayak' && Math.hypot(b.x - h.x, b.z - h.z) <= K.spookM * 0.5) spooked.push(b.id);
        if (!targetable(b) || inGrace(b.id, t)) continue;
        if ((h.y ?? 0) < -L.headUnderM) continue;   // her head deep under the hull: no bite on its rail
        const locked = h.locked && h.targetId === b.id, ky = b.kind === 'kayak';
        const d = hullDist(h.x, h.z, b), lim = ky ? (locked ? (h.kind === 'rising' ? L.kayakRiseM : L.kayakHitM) : L.kayakTouchM) : locked ? (h.kind === 'rising' ? L.footM : L.hitM) : L.touchM;   // the rising strike from under it: 3.5 m (its footprint)
        if (d <= lim && d < best) { best = d; hit = b; }
      }
      if (!hit) return { hit: null, side: 0, spooked };
      if (hit.kind === 'kayak') { const i = spooked.indexOf(hit.id); if (i >= 0) spooked.splice(i, 1); }
      const rx = Math.cos(hit.heading ?? 0), rz = Math.sin(hit.heading ?? 0);
      const side = (h.x - hit.x) * rx + (h.z - hit.z) * rz >= 0 ? 1 : -1;
      grace.set(hit.id, t + K.graceS); count++;
      return { hit, side, spooked, d: +Math.max(0, best).toFixed(2) };
    },
    fall(f, list, t = 0, { hitM = K.hitM } = {}) {
      const fx = Math.sin(f.psi), fz = -Math.cos(f.psi);
      let hit = null, best = Infinity;
      const spooked = [];
      for (const b of list) {
        if (spookable(b)) { if (Math.hypot(b.x - f.x, b.z - f.z) <= K.spookM) spooked.push(b.id); continue; }
        if (!isTarget(b.kind) || inGrace(b.id, t)) continue;
        // the footprint: her front 9 m about the fall's middle, sampled along her heading
        let d = Infinity;
        for (let k = 0; k <= 6; k++) { const u = (k / 6 - 0.5) * K.footM; d = Math.min(d, hullDist(f.x + fx * u, f.z + fz * u, b)); }
        if (d <= hitM && d < best) { best = d; hit = b; }
      }
      if (!hit) return { hit: null, side: 0, spooked };
      const rx = Math.cos(hit.heading ?? 0), rz = Math.sin(hit.heading ?? 0);
      const side = (f.x - hit.x) * rx + (f.z - hit.z) * rz >= 0 ? 1 : -1;
      grace.set(hit.id, t + K.graceS); count++;
      return { hit, side, spooked, d: +best.toFixed(2) };
    },
    splash(x, z, list) { const out = []; for (const b of list) if (spookable(b) && Math.hypot(b.x - x, b.z - z) <= K.spookM) out.push(b.id); return out; },
    holdOff(spine, L, list, reach = () => 1) {
      const N = spine.length / 8, ds = L / (N - 1);
      let most = 0;
      for (const b of list) {
        const R = b.kind === 'kayak' ? K.kayakR : b.kind === 'sup' ? K.supR : b.kind === 'glass' ? K.glassR : b.kind === 'power' ? K.powerR : b.kind === 'jetski' ? K.jetskiR : b.kind === 'paddle' ? K.paddleR : null; if (!R) continue;
        const under = K.underY[b.kind], fx = Math.sin(b.heading ?? 0), fz = -Math.cos(b.heading ?? 0);
        for (let i = 0; i < N; i++) {
          const o = i * 8, r = reach(i * ds);
          if (spine[o + 1] + r < under) continue;   // deep enough: she passes under
          const dx = spine[o] - b.x, dz = spine[o + 2] - b.z, a = dx * fx + dz * fz, c = dx * -fz + dz * fx;
          const A = R[0] + r, C = R[1] + r, e = (a / A) ** 2 + (c / C) ** 2;
          if (e >= 1) continue;
          const k = 1 / Math.sqrt(Math.max(1e-6, e)) - 1, ox = (a * fx - c * fz) * k, oz = (a * fz + c * fx) * k;   // out along the ray from the middle
          spine[o] += ox; spine[o + 2] += oz; most = Math.max(most, Math.hypot(ox, oz));
        }
      }
      return most;
    },
    rollK(P, side) { return side * K.rollK * P.mass * 9.81 * P.gm; },
    reset() { grace.clear(); count = 0; keptId = null; keptSeen = -Infinity; LK.id = null; LK.k = 0; LK.raw = 0; relock.clear(); lockT = null; },
  };
  return self;
}
