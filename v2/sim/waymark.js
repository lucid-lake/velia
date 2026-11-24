// The target beacon's rules (owner ask 2026-11-15): one light on the water over the mark in force
// (Sail's active waypoint, Cruise's mark, Regatta's next mark), so the player sees where they are going. Pure: no DOM, no GPU.
// The picture is render/waymark.js; this decides what it shows.
//   const S = createBeacon({ arriveM });   S.update(target | null, boat | null, dt) → the snapshot (below), S.state()
//   targetOf({ race, cruise, sail, passage, pin }) → the one target { x, z, key, kind } | null (Regatta, then Cruise, then the passage)
// The rules (the tests: v2/tests/beacon.test.mjs):
//   the arrival radius (owner, 2026-11-15): 50 m in Sail and Regatta; Cruise keeps its navigator's 70 m (a target carries its arriveM);
//   one beacon at a time: a new target replaces the old one (it fades in over fadeInS);
//   arrival: the boat within arriveM of the beacon → the arrival flourish (arriveS: the beam lifts away, a ring runs out on the
//   water), then nothing until a NEW target (the same target stays dark);
//   a target that goes away (the source cleared it) close to the boat (within swapM) is an arrival too (Cruise's own mark radius
//   is 70 m and its navigator clears the mark itself); far away it is a plain fade (clearS);
//   Regatta (owner, 2026-11-16: "the beacon's arrival effect misleads the player into thinking the leg is done, when actually they
//   still need to round the mark"): no arrival radius (a race target carries arriveM 0) and no ring on the water (ring: false: the
//   mark's zone ring and the rounding gate are the race's only rings); the beam stays lit on the next mark until the race's own
//   rounding moves the target on one leg (seq + 1: the session's rounding detection), and only then the arrival plays at the
//   rounded mark (the lift and fade, "done"), then the next mark fades in; the finish plays it on the crossing (the race's view
//   finished: the target comes once more with arrived: true). Any other change of a race target (a restart, the fly-over's stops,
//   leaving the race, a DNF) is a plain swap or fade, never an arrival.
export const BEACON = Object.freeze({
  arriveM: 50,      // m: the arrival radius in Sail (owner, 2026-11-15; Sail's waypoints advance at 40 m, inside it); Regatta has none (2026-11-16)
  cruiseArriveM: 70, // m: Cruise's own (its navigator clears the mark at 70 m: src/sim/modes/chill/navigator.js destArriveM)
  fadeInS: 0.8,     // s: a new beacon's fade in
  arriveS: 1.6,     // s: the arrival flourish (the beam lifts in its first 0.9 s, the ring runs out over all of it)
  liftS: 0.9,
  clearS: 0.5,      // s: a target cleared far away fades this fast
  swapM: 90,        // m: a target that goes or swaps within this of the boat is an arrival
  nearM: 260,       // m: the beam softens from here in to the arrival radius...
  nearFloor: 0.4,   // ...down to this share (near, it must not dominate)
});

const keyOf = (t) => t.key ?? `${t.kind ?? 't'}|${Math.round(t.x)}|${Math.round(t.z)}`;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
import { smooth } from '../../src/sim/core/math.js';

export function createBeacon({ arriveM = BEACON.arriveM, swapM = BEACON.swapM, fadeInS = BEACON.fadeInS, arriveS = BEACON.arriveS, clearS = BEACON.clearS } = {}) {
  // phase: 'off' (nothing), 'in' (fading in), 'on', 'arrive' (the flourish), 'clear' (fading out), 'done' (arrived: dark until a new key)
  let phase = 'off', t = 0, cur = null, pending = null, doneKey = null, lastDist = Infinity, alpha0 = 0;
  const snap = { visible: false, phase: 'off', x: 0, z: 0, key: null, kind: null, alpha: 0, near: 1, dist: Infinity, arriveT: -1, lift: 0, arrivals: 0, ring: true };
  let arrivals = 0;
  const dist = (b, p) => (b && p ? Math.hypot(b.x - p.x, b.z - p.z) : Infinity);
  function start(tg, key) { cur = { x: tg.x, z: tg.z, key, kind: tg.kind ?? null, arriveM: tg.arriveM ?? arriveM, ring: tg.ring !== false, seq: Number.isFinite(tg.seq) ? tg.seq : null }; phase = 'in'; t = 0; pending = null; doneKey = null; }
  // a race target moved on by the rounding: the next leg of the same race (Regatta's only swap arrival)
  const rounds = (tg) => cur?.kind === 'race' && tg?.kind === 'race' && cur.seq != null && tg.seq === cur.seq + 1;
  function arrive() { phase = 'arrive'; t = 0; arrivals++; }

  function update(target, boat, dt = 0) {
    t += Math.max(0, dt);
    const key = target ? keyOf(target) : null;
    if (cur && phase !== 'done' && phase !== 'off') lastDist = dist(boat, cur);
    // the source's target moved or went
    const live = phase === 'in' || phase === 'on', race = cur?.kind === 'race';
    if (key !== (cur?.key ?? null) && !(phase === 'done' && key === doneKey)) {
      if (!key || target.arrived) {   // gone (or an arrived target this beacon was not showing: nothing to light)
        if (live) { if (!race && lastDist < swapM) arrive(); else { phase = 'clear'; t = 0; alpha0 = snap.alpha; } }
        else if (phase === 'done') { phase = 'off'; cur = null; doneKey = null; }
      } else if (live && (race ? rounds(target) : lastDist < swapM)) { arrive(); pending = { ...target, key }; }
      else if (phase === 'arrive') pending = { ...target, key };
      else start(target, key);
    } else if (cur && key === cur.key && target) {
      if (target.arrived) { if (live) arrive(); }   // Regatta's finish: the line crossed, the arrival plays now
      else { cur.x = target.x; cur.z = target.z; }   // a mark drifting on its rode
    }
    if (phase === 'arrive' && pending && pending.key !== key) pending = key && !target.arrived ? { ...target, key } : null;
    // the arrival radius
    const d = cur ? dist(boat, cur) : Infinity;
    const rM = cur?.arriveM ?? arriveM;
    if ((phase === 'in' || phase === 'on') && rM > 0 && d < rM) arrive();
    if (phase === 'in' && t >= fadeInS) phase = 'on';
    if (phase === 'arrive' && t >= arriveS) {
      if (pending) { const p = pending; start(p, p.key); }
      else { phase = 'done'; doneKey = cur?.key ?? null; }
    }
    if (phase === 'clear' && t >= clearS) { phase = 'off'; cur = null; }
    // the snapshot
    let a = 0, lift = 0, arriveT = -1;
    if (phase === 'in') a = smooth(0, fadeInS, t);
    else if (phase === 'on') a = 1;
    else if (phase === 'arrive') { arriveT = t; lift = smooth(0, BEACON.liftS, t); a = 1 - lift; }
    else if (phase === 'clear') a = alpha0 * (1 - clamp01(t / clearS));
    const near = BEACON.nearFloor + (1 - BEACON.nearFloor) * smooth(Math.max(rM, 1), BEACON.nearM, d);
    snap.visible = phase === 'in' || phase === 'on' || phase === 'arrive' || phase === 'clear';
    snap.phase = phase; snap.key = cur?.key ?? null; snap.kind = cur?.kind ?? null;
    snap.x = cur?.x ?? 0; snap.z = cur?.z ?? 0; snap.alpha = a; snap.near = near; snap.dist = d; snap.arriveT = arriveT; snap.lift = lift; snap.arrivals = arrivals; snap.ring = cur?.ring ?? true;
    return snap;
  }
  return { update, get snapshot() { return snap; }, state: () => ({ ...snap, pending: pending?.key ?? null, doneKey }), arriveM };
}

// the one target in force. race: Regatta's view of the player ({ status, leg, seq?, target: { at: { x, z }, mark } }) while a race is on
// (seq: the leg's number, the race's own leg when absent; the fly-over's stops carry none);
// cruise: Cruise's navigator destination ({ at: [x, z], name }) while Cruise sails; sail: Sail's double-tap mark ({ x, z }: no
// autopilot, the player sails to it); passage: the 'passage' service's target (Sail:
// the active waypoint of a set course, the chart's waypoint or mark); pin: a target set by hand (the captures, the harness)
export function targetOf({ race = null, cruise = null, sail = null, passage = null, pin = null } = {}) {
  if (pin) return { x: pin.x, z: pin.z, key: pin.key ?? `pin|${Math.round(pin.x)}|${Math.round(pin.z)}`, kind: 'pin' };
  if (race) {
    const m = race.target;
    if (!m?.at || race.status === 'dnf') return null;
    const seq = Number.isFinite(race.seq) ? race.seq : Number.isFinite(race.leg) ? race.leg : null;
    // the next mark only: no arrival radius, no ring (the mark's zone ring is the race's); it goes on the rounding (seq + 1), the
    // finish on the crossing (finished: arrived)
    const tg = { x: m.at.x, z: m.at.z, key: `race|${m.mark ?? ''}|${race.leg ?? ''}`, kind: 'race', arriveM: 0, ring: false, seq };
    if (race.status === 'finished') tg.arrived = true;
    return tg;
  }
  if (cruise?.at) return { x: cruise.at[0], z: cruise.at[1], key: `cruise|${Math.round(cruise.at[0])}|${Math.round(cruise.at[1])}`, kind: 'cruise', arriveM: BEACON.cruiseArriveM };
  if (sail && Number.isFinite(sail.x)) return { x: sail.x, z: sail.z, key: `sail|${Math.round(sail.x)}|${Math.round(sail.z)}`, kind: 'sail' };   // Sail's double-tap mark (ui/sailMark.js): the latest thing the player asked for
  if (passage && Number.isFinite(passage.x)) return { x: passage.x, z: passage.z, key: `${passage.kind ?? 'route'}|${Math.round(passage.x)}|${Math.round(passage.z)}`, kind: passage.kind ?? 'route' };
  return null;
}

// Sail's chart target before Set course (fix 2026-11-15, owner: "setting a target from the chart does not place the beacon"): a tap
// on the chart drafts a route and the passage service (the beacon's chart source) holds a target only once Set course makes the
// course active, so the light waited for a button the player never saw. The draft's first waypoint lights it now; Set course keeps
// the same key (route|x|z), so the beam does not fade again. course: the 'course' service (src/sail/passagePlan.js createCourse)
export function draftTarget(course) {
  if (!course || course.active) return null;
  const w = course.route?.[0];
  return w && Number.isFinite(w.x) ? { x: w.x, z: w.z, name: w.name ?? null, kind: 'route' } : null;
}

// the later of two target sources (Sail's double-tap mark and the chart's): the one whose spot changed last wins; when it goes,
// the other shows. const pick = createLatest();  pick(a, b) → a | b | null, each frame
export function createLatest() {
  let ka = null, kb = null, pref = null;
  const key = (t) => (t && Number.isFinite(t.x) ? `${Math.round(t.x)}|${Math.round(t.z)}` : null);
  return (a, b) => {
    const na = key(a), nb = key(b);
    if (na !== ka) { ka = na; if (na) pref = 'a'; }
    if (nb !== kb) { kb = nb; if (nb) pref = 'b'; }
    return pref === 'b' ? (nb ? b : na ? a : null) : (na ? a : nb ? b : null);
  };
}
