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
// The Tessie RPG, phase 6b (?tessierpg=1 with a bounty save; v2/sim/tessieBounty.js readRanks): the staged Tessie carries the
// player's own Tessie's ranks (actsOf(ranks)): her attacks take turns over [...the unlocked acts, today's strike], each act aimed at
// the player (when the player is racing near her water; else today's strike on a pick), each warned for the same DEEP.warnS and
// escapable by a steer, because the spot is fixed at the warning and never follows the boat:
//   dash    (Dash rank 2+) she rises DEACT.dashFromM off the spot, ahead and to one side of the bow, and runs across the bow to the
//           spot at the surface (her V), then today's strike there (her ring's catch: the race's own knockdown rule)
//   surge   (Tail Surge unlocked) she surfaces off the bow, DEACT.surgeBearDeg to one side, at 0.65 × her rank's ring; at the strike
//           her tail slaps and a ring wave runs out to the ring (SURGE_RANKS, SURGE.waveS): each racing boat it reaches heels away
//           from her (surgeHeel, capped at DEACT.heelMaxDeg: far under the 55° knockdown), never knocked down
//   breach  (Breach unlocked) she breaches DEACT.besideM beside the boat's course (never on it): a heel wave to DEACT.waveM, the
//           same cap, never a knock
//   an act waits up to 2 × waitS for her last sighting to end (a fresh rise near its spot); a wave runs out from the warned spot
//   no ranks (acts null or empty): today's race exactly (the same draws, the same events)
//   events added with acts: warn { …, act, from?, heading?, ringM? };  strike { …, act };  heel { n, id, heelDeg, side, d } (side + starboard down)
export const DEEP = Object.freeze({ everyS: [20, 35], restS: 4, waitS: 6, firstS: 10, warnS: 5, strikeS: 6, innerM: 28, outerM: 60, reachM: 80, insetM: 25, minDepthM: 10, retryS: 2, marginM: 12, irons: 42, leaderW: 1.5, nearW: 2 });
const DEG = Math.PI / 180;
import { wrap } from '../../src/sim/core/math.js';
import { SURGE, SURGE_RANKS, surgeHeel, awaySide } from '../sim/tessieSurge.js';

// phase 6b: the acts her ranks give her in the race (see the head)
export const DEACT = Object.freeze({
  dashRank: 2,          // the Dash's rank from which she dashes at the boat
  dashFromM: 60,        // m: her run to the spot (at the surface: her V)
  dashOffDeg: 70,       // ° off the boat's heading where her run starts (ahead and to one side: she crosses the bow)
  surgeK: 0.65,         // her surge spot: this share of her rank's ring off the boat's place at the strike
  surgeMinM: 24,        // m: never nearer than this
  surgeBearDeg: 35,     // ° off the bow, to one side
  besideM: 24,          // m: her breach beside the boat's course
  aheadM: 10,           // m: and this far ahead of its place at the strike
  waveM: 40,            // m: the breach's heel wave
  breachHeelDeg: 22,    // the breach wave's heel inside DEACT.breachNearM
  breachNearM: 12,
  heelMaxDeg: 22,       // the heel a race wave gives at most (the knockdown watch: 55° held 0.5 s)
  waveRiseS: 2.0,       // real s: the breach wave's run to waveM (the surge's: SURGE.waveS)
  actS: 3.5,            // real s after the strike before she dives (a surge, a breach: the wave and its fade)
});
// her acts from the player's ranks (null: none)
export function actsOf(ranks) {
  if (!ranks) return null;
  const out = [];
  if ((ranks.dash ?? 0) >= DEACT.dashRank) out.push({ kind: 'dash' });
  if ((ranks.surge ?? 0) >= 1) out.push({ kind: 'surge', row: SURGE_RANKS[Math.min(4, ranks.surge)] });
  if ((ranks.breach ?? 0) >= 1) out.push({ kind: 'breach' });
  return out.length ? out : null;
}

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

// a spot inside her water (pulled in by insetM) and deep enough for her, or null
function inWater(x, z, area, depthAt, D) {
  const dx = x - area.x, dz = z - area.z, d = Math.hypot(dx, dz), R = area.r - D.insetM;
  if (d > R) { x = area.x + dx / d * R; z = area.z + dz / d * R; }
  return depthAt(x, z) >= D.minDepthM ? [x, z] : null;
}
// phase 6b: an act's plan on the boat b (where it will be after leadS on its heading), side ±1 (+1: to its starboard), or null
export function actPlan(kind, b, area, leadS, side, { depthAt = () => 30, row = null, D = DEEP, A = DEACT } = {}) {
  const v = Math.max(1.5, b.u ?? 2.5), h = b.heading, fx = Math.sin(h), fz = -Math.cos(h), sx = Math.cos(h), sz = Math.sin(h);
  const px = b.x + fx * v * leadS, pz = b.z + fz * v * leadS;
  if (kind === 'dash') {
    const at = strikeSpot(b, area, leadS, depthAt, D); if (!at) return null;
    for (const s of [side, -side]) {
      const a = h + s * A.dashOffDeg * DEG, fx0 = at[0] + Math.sin(a) * A.dashFromM, fz0 = at[1] - Math.cos(a) * A.dashFromM;
      if (depthAt(fx0, fz0) >= D.minDepthM) return { kind, at, from: [fx0, fz0], heading: wrap(a + Math.PI), side: s };
    }
    return null;
  }
  if (kind === 'surge') {
    if (!row) return null;
    const m = Math.max(A.surgeMinM, A.surgeK * row.ringM);
    for (const s of [side, -side]) {
      const a = h + s * A.surgeBearDeg * DEG, at = inWater(px + Math.sin(a) * m, pz - Math.cos(a) * m, area, depthAt, D);
      if (at) return { kind, at, ringM: row.ringM, row, side: s };
    }
    return null;
  }
  if (kind === 'breach') {
    for (const s of [side, -side]) {
      const at = inWater(px + fx * A.aheadM + sx * s * A.besideM, pz + fz * A.aheadM + sz * s * A.besideM, area, depthAt, D);
      if (at) return { kind, at, ringM: A.waveM, row: { ringM: A.waveM, knockM: A.breachNearM, heelDeg: A.breachHeelDeg }, side: s };
    }
    return null;
  }
  return null;
}

export function createTessieDeep({ area, depthAt = () => 30, pace = 2, seed = 1, D = DEEP, acts = null } = {}) {
  const rand = stream(seed * 2654435761 + 97);
  const rand2 = stream(seed * 40503 + 7919);   // phase 6b: the acts' sides (her base draws untouched)
  const order = acts?.length ? [...acts, { kind: 'strike' }] : null;
  const k = pace, warnS = D.warnS * k, strikeS = D.strikeS * k;
  const nextGap = () => (D.everyS[0] + rand() * (D.everyS[1] - D.everyS[0])) * k;
  const st = { phase: 'rest', n: 0, at: null, target: null, t0: null, nextAt: D.firstS * k, caught: new Set(), centre: null, turnTo: null, last: [area.x, area.z], log: [], act: null, plan: null, turn: 0, heeled: new Set(), wave: null };
  const out = [];
  const isAct = () => st.act === 'surge' || st.act === 'breach';   // a wave act: no catch ring, a heel wave
  // phase 6b: the act due (aimed at the player) → the warning's event, or null (today's strike then)
  function tryAct(t, boats) {
    const a = order[st.turn % order.length];
    if (a.kind === 'strike') return null;
    const me = boats.find((b) => b.id === 'me' && b.status === 'racing' && !b.held && Math.hypot(b.x - area.x, b.z - area.z) <= area.r + D.reachM);
    if (!me) return null;
    const p = actPlan(a.kind, me, area, D.warnS * k, rand2() < 0.5 ? 1 : -1, { depthAt, row: a.row, D });
    if (!p) return null;
    st.turn++;
    st.phase = 'warn'; st.n++; st.at = p.at; st.target = 'me'; st.t0 = t; st.caught.clear(); st.turnTo = null; st.centre = null; st.act = a.kind; st.plan = p; st.heeled.clear(); st.wave = null;
    st.log.push({ n: st.n, target: 'me', t: +t.toFixed(1), act: a.kind });
    const e = { type: 'warn', n: st.n, target: 'me', at: p.at, act: a.kind };
    if (p.from) { e.from = p.from; e.heading = p.heading; }
    if (p.ringM) e.ringM = p.ringM;
    return e;
  }
  return {
    state: st, warnS, strikeS,
    centre(c) { st.centre = c ? [c[0], c[1]] : null; },
    get ring() {
      if (st.phase !== 'warn' && st.phase !== 'strike') return null;
      if (isAct()) return { at: st.wave?.at ?? st.at, r: 0, rOut: st.plan.ringM, live: false, target: st.target, act: st.act };   // the rivals keep off her wave; nothing is caught
      return { at: st.centre && st.phase === 'strike' ? st.centre : st.at, r: D.innerM, rOut: D.outerM, live: st.phase === 'strike', target: st.target, ...(st.act ? { act: st.act } : {}) };
    },
    step(t, { boats = [], ready = true } = {}) {
      out.length = 0;
      if (st.phase === 'rest') {
        if (t < st.nextAt || (!ready && t < st.nextAt + D.waitS * k)) return out;   // her last one gone (or waited long enough: she turns back from where she is)
        // an act waits a little longer for her last sighting to end (a fresh rise near its spot), then goes anyway
        if (order && !ready && order[st.turn % order.length].kind !== 'strike' && t < st.nextAt + 2 * D.waitS * k) return out;
        if (order) { const e = tryAct(t, boats); if (e) { out.push(e); return out; } }
        const b = pickTarget(boats, area, st.last, rand, D);
        const at = b ? strikeSpot(b, area, D.warnS * k, depthAt, D) : null;
        if (!b || !at) { st.nextAt = t + D.retryS * k; return out; }
        st.phase = 'warn'; st.n++; st.at = at; st.target = b.id; st.t0 = t; st.caught.clear(); st.turnTo = null; st.centre = null;
        st.log.push({ n: st.n, target: b.id, t: +t.toFixed(1) });
        if (order) { st.act = 'strike'; st.plan = null; if (order[st.turn % order.length].kind === 'strike') st.turn++; out.push({ type: 'warn', n: st.n, target: b.id, at, act: 'strike' }); return out; }
        out.push({ type: 'warn', n: st.n, target: b.id, at });
        return out;
      }
      if (st.phase === 'warn' && t - st.t0 >= warnS) {
        st.phase = 'strike';
        if (isAct()) st.wave = { at: [st.at[0], st.at[1]], t };   // the wave runs out from the warned spot (where she swam to): the warning's geometry holds
        out.push(st.act ? { type: 'strike', n: st.n, at: st.wave?.at ?? st.at, act: st.act } : { type: 'strike', n: st.n, at: st.at });
      }
      if (st.phase === 'strike' && isAct()) {
        // the wave's front (race clock: the real seconds × the pace); each racing boat it reaches heels away from her once
        const c = st.wave.at, R = st.plan.ringM, runS = (st.act === 'surge' ? SURGE.waveS : DEACT.waveRiseS) * k, front = R * Math.min(1, (t - st.wave.t) / runS);
        for (const b of boats) {
          if (b.status !== 'racing' || b.held || st.heeled.has(b.id)) continue;
          const d = Math.hypot(b.x - c[0], b.z - c[1]);
          if (d > front || d > R) continue;
          st.heeled.add(b.id);
          const heelDeg = Math.min(DEACT.heelMaxDeg, surgeHeel(d, st.plan.row));
          out.push({ type: 'heel', n: st.n, id: b.id, heelDeg, side: awaySide(b, { x: c[0], z: c[1] }), d });
        }
        if (t - st.t0 >= warnS + DEACT.actS * k) {
          st.last = [c[0], c[1]]; st.phase = 'rest'; st.nextAt = Math.max(st.t0 + nextGap(), t + D.restS * k); st.at = null; st.target = null; st.wave = null;
          out.push({ type: 'dive', n: st.n, next: +st.nextAt.toFixed(1) });
        }
        return out;
      }
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
    reset() { st.phase = 'rest'; st.n = 0; st.at = null; st.target = null; st.t0 = null; st.nextAt = D.firstS * k; st.caught.clear(); st.centre = null; st.turnTo = null; st.last = [area.x, area.z]; st.log.length = 0; st.act = null; st.plan = null; st.turn = 0; st.heeled.clear(); st.wave = null; },
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
