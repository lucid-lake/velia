// Tessie, the living hazard of her race (Tessie's Deep; owner go 2026-11-19; owner 2026-11-19, after the first
// build read as a splash: "I imagine in this game Tessie will keep attacking boats"). She hunts the fleet through the whole race: an
// attack every DEEP.everyS (20–35 s, seeded), each one telegraphed, then a strong visible moment, then she goes down again. "Cheat on
// where and when, never on motion": the target, the spot and the moment are chosen; she swims there as an animal and breaches with her
// own clips (v2/sim/tessie.js riseUnder, breach, arc). Pure, on the race clock (v2/tests/regatta-places.test.mjs).
//   rest   until the next attack is due and her last one has gone (ready: her sim idle)
//   warn   DEEP.warnS real s (× the race's pace on its clock): she picks a TARGET among the racing boats in or near her water
//          (pickTarget: the leader and whoever is closest to her favoured, seeded), and comes up under a spot ahead of its bow (where
//          it would be at the strike if it held its course; inside her water). The warning: the drone, her dark shape and wake under
//          the water as she swims shallow to the spot, the coach's line ("Tessie is coming for you: tack or bear away"), the water
//          breaking as she rises; never a ring on the water (owner 2026-11-20: "let Tessie happen naturally"). A tack or a bear-away takes the boat out of it: the spot never follows the boat
//   strike DEEP.strikeS: she breaches at the spot (her neck and head out, a big splash and wave), then holds her neck up; her ring is
//          live: a boat inside DEEP.innerM is rolled (the race knockdown: knocks.js, 12 s, a second one ends the race), a boat between
//          innerM and outerM draws her turn toward it. Rivals steer round her outer ring all the while (avoidAdvice; a slow one late)
//   dive   she goes down; the next attack is drawn
//   const D = createTessieDeep({ area, depthAt, pace, seed });
//   D.step(t, { boats: [{ id, x, z, heading, u, progress, status, held }], ready })
//     → events: { type: 'warn', n, target, at } | { type: 'strike', n, at } | { type: 'catch', n, id, at, d } | { type: 'turn', id, x, z }
//       | { type: 'dive', n, next }
//   D.centre(c) her body's centre from her sim (null: the chosen spot): the ring follows her;  D.ring;  D.state
//   pickTarget(boats, from, rand) → the boat she goes for;  strikeSpot(b, area, leadS, depthAt) → [x, z] | null
//   avoidAdvice(s, c, rOut, { skill, windFrom }) → null | { heading, side }: a rival's course round her outer ring
export const DEEP = Object.freeze({ everyS: [20, 35], restS: 4, waitS: 6, firstS: 10, warnS: 5, strikeS: 6, innerM: 28, outerM: 60, reachM: 80, insetM: 25, minDepthM: 10, retryS: 2, marginM: 12, irons: 42, leaderW: 1.5, nearW: 2 });
const DEG = Math.PI / 180;
import { wrap } from '../../src/sim/core/math.js';

// a small seeded stream (mulberry32): the same race, the same attacks
function stream(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// the boat she goes for: among the racing boats (not one being righted), in her water or within reachM of it; the leader and whoever is
// nearest her (from: where she last was, or her water's middle) weigh more; a seeded draw among them
export function pickTarget(boats, area, from, rand = Math.random, D = DEEP) {
  const ok = boats.filter((b) => b.status === 'racing' && !b.held && Math.hypot(b.x - area.x, b.z - area.z) <= area.r + D.reachM);
  if (!ok.length) return null;
  const lead = ok.reduce((a, b) => ((b.progress ?? 0) > (a.progress ?? 0) ? b : a), ok[0]);
  const w = ok.map((b) => 1 + (b === lead ? D.leaderW : 0) + D.nearW * Math.max(0, 1 - Math.hypot(b.x - from[0], b.z - from[1]) / 400));
  let x = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ok.length; i++) { x -= w[i]; if (x < 0) return ok[i]; }
  return ok[ok.length - 1];
}

// the spot: 30 m past where the boat would be after leadS at her speed on her heading (60–120 m ahead), pulled inside her water (insetM) if it falls outside;
// deep enough for her to rise
export function strikeSpot(b, area, leadS, depthAt = () => 30, D = DEEP) {
  const v = Math.max(1.5, b.u ?? 2.5), m = Math.min(120, Math.max(60, v * leadS + 30));   // past where she will be at the strike: holding on sails into the ring, a turn clears it
  let x = b.x + Math.sin(b.heading) * m, z = b.z - Math.cos(b.heading) * m;
  const dx = x - area.x, dz = z - area.z, d = Math.hypot(dx, dz), R = area.r - D.insetM;
  if (d > R) { x = area.x + dx / d * R; z = area.z + dz / d * R; }
  return depthAt(x, z) >= D.minDepthM ? [x, z] : null;
}

export function createTessieDeep({ area, depthAt = () => 30, pace = 2, seed = 1, D = DEEP } = {}) {
  const rand = stream(seed * 2654435761 + 97);
  const k = pace, warnS = D.warnS * k, strikeS = D.strikeS * k;
  const nextGap = () => (D.everyS[0] + rand() * (D.everyS[1] - D.everyS[0])) * k;
  const st = { phase: 'rest', n: 0, at: null, target: null, t0: null, nextAt: D.firstS * k, caught: new Set(), centre: null, turnTo: null, last: [area.x, area.z], log: [] };
  const out = [];
  return {
    state: st, warnS, strikeS,
    centre(c) { st.centre = c ? [c[0], c[1]] : null; },
    get ring() { return st.phase === 'warn' || st.phase === 'strike' ? { at: st.centre && st.phase === 'strike' ? st.centre : st.at, r: D.innerM, rOut: D.outerM, live: st.phase === 'strike', target: st.target } : null; },
    step(t, { boats = [], ready = true } = {}) {
      out.length = 0;
      if (st.phase === 'rest') {
        if (t < st.nextAt || (!ready && t < st.nextAt + D.waitS * k)) return out;   // her last one gone (or waited long enough: she turns back from where she is)
        const b = pickTarget(boats, area, st.last, rand, D);
        const at = b ? strikeSpot(b, area, D.warnS * k, depthAt, D) : null;
        if (!b || !at) { st.nextAt = t + D.retryS * k; return out; }
        st.phase = 'warn'; st.n++; st.at = at; st.target = b.id; st.t0 = t; st.caught.clear(); st.turnTo = null; st.centre = null;
        st.log.push({ n: st.n, target: b.id, t: +t.toFixed(1) });
        out.push({ type: 'warn', n: st.n, target: b.id, at });
        return out;
      }
      if (st.phase === 'warn' && t - st.t0 >= warnS) { st.phase = 'strike'; out.push({ type: 'strike', n: st.n, at: st.at }); }
      if (st.phase === 'strike') {
        const c = st.centre ?? st.at;
        let near = null, nd = Infinity;
        for (const b of boats) {
          if (b.status !== 'racing' || st.caught.has(b.id)) continue;
          const d = Math.hypot(b.x - c[0], b.z - c[1]);
          if (d < D.innerM) { st.caught.add(b.id); out.push({ type: 'catch', n: st.n, id: b.id, at: [c[0], c[1]], d }); continue; }
          if (d < D.outerM && d < nd) { nd = d; near = b; }
        }
        const to = near?.id ?? null;
        if (to !== st.turnTo) { st.turnTo = to; if (to) out.push({ type: 'turn', id: to, x: near.x, z: near.z }); }
        if (t - st.t0 >= warnS + strikeS) {
          st.last = [c[0], c[1]]; st.phase = 'rest'; st.nextAt = Math.max(st.t0 + nextGap(), t + D.restS * k); st.at = null; st.target = null;   // start to start, and a little rest to go deep
          out.push({ type: 'dive', n: st.n, next: +st.nextAt.toFixed(1) });
        }
      }
      return out;
    },
    reset() { st.phase = 'rest'; st.n = 0; st.at = null; st.target = null; st.t0 = null; st.nextAt = D.firstS * k; st.caught.clear(); st.centre = null; st.turnTo = null; st.last = [area.x, area.z]; st.log.length = 0; },
  };
}

// a rival's course round her ring: when her course passes within the outer ring + margin and she is within the rival's look (a skilled
// rival looks further: 60 m + 140 m × skill), the tangent heading on the side nearer her own, never into irons (the other side then)
export function avoidAdvice(s, c, rOut = DEEP.outerM, { skill = 0.6, windFrom = null, D = DEEP } = {}) {
  if (!s || !c) return null;
  const dx = c[0] - s.x, dz = c[1] - s.z, d = Math.hypot(dx, dz), R = rOut + D.marginM;
  if (d > 60 + 140 * Math.max(0, Math.min(1, skill)) || d < 1) return null;
  const toC = Math.atan2(dx, -dz), off = wrap(toC - s.heading);
  if (Math.abs(off) > Math.PI / 2) return null;   // behind her beam: sail on
  if (d > R && Math.abs(Math.sin(off) * d) > R) return null;   // her course clears the ring
  const a = d > R ? Math.asin(Math.min(1, R / d)) : Math.PI / 2;
  const pass = [toC - a, toC + a];   // left of her (to port), right of her
  pass.sort((p, q) => Math.abs(wrap(p - s.heading)) - Math.abs(wrap(q - s.heading)));
  const ok = (h) => windFrom == null || Math.abs(wrap(windFrom - h)) > D.irons * DEG;
  const h = ok(pass[0]) ? pass[0] : ok(pass[1]) ? pass[1] : null;
  if (h == null) return null;
  return { heading: h, side: windFrom == null ? 1 : (wrap(windFrom - h) > 0 ? 1 : -1) };
}
