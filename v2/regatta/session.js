// The race on v2 (BACKLOG-v2 #12, R1/R2): v1's race (src/sim/race/: the rules, the rivals' minds, the dirty air, the officer's
// events) over the player's boat and up to 5 computer boats (owner 2026-11-14: 6 boats at most), with the start helper. Pure:
// no DOM, no GPU; node runs it on the real BoatPhysics (v2/tests/regatta.test.mjs), the page on v2's boat (v2/regatta/index.js).
//   const S = createRegattaSession({ course, me: { phys }, rivals: 1, windAt, depthAt, seed, prestartS: 45 });
//   S.helperTick(ctl, t)     the start helper's hands on the player's controls for one tick (a pro AISkipper's startPlan: an
//                            untouched boat makes a clean start); a no-op once it is off
//   S.advanceTo(t)           the computer boats and the rules, tick by tick, up to the player's sim time t
//   S.takeHelm()             any steer input: the helper is off ("You have the helm"); S.helperOn() turns it back on until the gun
//   S.restart()              R: everyone back in the box at −0:45 (the caller places the player's boat: onPlace)
//   S.drain()                the race's events since the last call ({ type, …, clock }, rules.js's and the helper's own)
//   S.rivals[i] = { id, name, sail, phys, brain }, S.race (v1's Race), S.boats (ids, names)
// The flying start (owner, 2026-11-16: no long wait in the box before the gun): flying: true lays every boat already sailing at speed
// toward the line on her own lane, set back so that sailing on, the crew trimming, reaches the line FLY.runS real seconds in; the clock
// runs FLY.runS + FLY.holdS (× the pace: game seconds), so a short ease of 2–3 s times it to the gun. gunWaits (Beginner, Club): the
// gun fires the moment the first boat reaches the line before 0:00, so nobody can be over early; without it (Pro) early is OCS.
//   createRegattaSession({ …, flying: true, pace: 2, gunWaits: true })   S.flying, S.prestartS (the countdown, game seconds)
// Step C (owner 2026-11-17), event: 'fleet' | 'match' | 'trial' | 'pursuit' (events.js): a match race's rival covers (fleet.js
// coverCall: ahead upwind, she tacks onto the player's tack and stays between her and the next mark); a pursuit starts each boat at
// her own time (S.slots: game seconds after the gun, the slowest boat first, events.js pursuitSlots), laid back on her lane so that
// sailing on reaches the line at her time; a boat over her own line more than PURSUIT.earlyS early owes a penalty turn (Club, Pro).
//   createRegattaSession({ …, event: 'pursuit', meSkill })   S.event, S.slots, S.skills
// The rounding (owner 2026-11-17): round: the level ('beginner' | 'club': rounding.js's rounding line for every boat; 'pro' or null:
// the real rule, v1's CourseTracker).   createRegattaSession({ …, round: 'club' })   S.round
// A place race (course.place set, v2/sim/racePlaces.js): the course is pinned, so its start line may face any point of
// sail; every boat is laid already sailing on her lane (the line's square, or close-hauled when that is in irons: placeLane), each
// lane held by a skipper until the gun (createLaneHold), and the gun waits for the first bow at every level (no one over early). The
// knockdown (knocks.js): S.knock(id, cause) → { kind: 'hold' | 'dnf' } on the race clock; a held rival lets her sheets fly for 12 s,
// a second knock retires her (race.retire); the player's hold is the page's (index.js drives her controls). S.hazard = { at, rOut } |
// null: Tessie's ring (tessieDeep.js); the rivals steer round it (avoidAdvice, by skill).
// S.wave(id, heel) a race wave under a rival (the Tessie RPG's surge and breach): rolled to heel (rad) and let go (v2/sim/waveRoll.js).
// Phase 2: S.wash = (x, z) → 0..1 (Glass Boat Chase: her wash, glassChase.js) takes way off any boat in it each tick; a
// course with a shortcut (Tea House Run) sends a seeded share of the rivals inside the shelf (SHORTCUT) and grounds a keel under
// AGROUND.draftM (held AGROUND.holdS, then on to the mark); S.aground(id)
import { CONTROLS, DT, KN, Helm, boatParams } from '../../src/sim/boat.js';
import { craftOf } from '../../src/sim/craft/index.js';
import { side as lineSide } from '../../src/sim/race/line.js';
import { polarTargets, polarKn, AISkipper } from '../../src/sim/ai/skipper.js';
import { createRace, atFault } from '../../src/sim/race/rules.js';
import { makeClear, TIERS } from '../../src/sim/race/rival.js';
import { hullContact, hullGap } from '../../src/sim/race/contact.js';
import { FleetRival, skillFor, startLate, FLEET_TIER, FLEET_SKILL } from './fleet.js';
import { PURSUIT, pursuitSlots, courseTimeS } from './events.js';
import { shadowed } from '../../src/sim/race/dirtyAir.js';
import { RACE, fleetSize } from './plan.js';
import { createStartHelper, startLay, HELP } from './helper.js';
import { tackAngle } from './geometry.js';
import { trackerFor } from './rounding.js';
import { placeTrackerFor } from './placeTracker.js';   // a place race's gates and marks
import { createKnocks, holdControls } from './knocks.js';   // a place race's knockdown: 12 s held, a second one DNF
import { avoidAdvice } from './tessieDeep.js';   // the rivals steer round Tessie's ring (S.hazard)
import { BOAT_LENGTH_M } from '../../src/sim/race/course.js';
import { WASH } from './glassChase.js';
import { waveRollStep } from '../sim/waveRoll.js';   // a race wave (the Tessie RPG's surge and breach) rolls a rival as the player's boat   // Glass Boat Chase: her wash slows a boat sitting in it (S.wash)

// Tea House Run's shortcut: some rivals cut inside the island's boulder shallows on the first leg (share by
// the rivals' tier, seeded per boat), and a keel on the shelf grounds: under draftM of water she stops dead (the sheets let fly, her way
// gone) for holdS, then sails on; again only after againS
export const SHORTCUT = Object.freeze({ share: Object.freeze({ easy: 0.25, medium: 0.4, hard: 0.5, pro: 0.6 }), viaM: 22 });
export const AGROUND = Object.freeze({ draftM: 1.75, holdS: 7, againS: 12, stopRate: 2.5 });
const h01 = (a, b) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13; return (h >>> 0) / 4294967296; };

const DEG = Math.PI / 180;
// the computer boats, in the order a fleet fills: Osprey (v1's rival, id 'wren': the officer's calls name it) first
export const FLEET = Object.freeze([
  // R4: each rival's place on the line (a: 0 the pin, 1 the committee boat; the player's lane is at 0.62), its box's depth (× the
  // player's), its hull's colour (sRGB: the topsides; the tag's chip) and its sail number
  { id: 'wren', name: 'Osprey', sail: 17, a: 0.40, back: 1.0, hull: '#1f2c4a' },
  { id: 'tern', name: 'Tern', sail: 4, a: 0.80, back: 1.32, hull: '#8a2a24' },
  { id: 'kestrel', name: 'Kestrel', sail: 9, a: 0.24, back: 1.05, hull: '#2f5a3c' },
  { id: 'heron', name: 'Heron', sail: 21, a: 0.92, back: 0.95, hull: '#3d6f9e' },
  { id: 'plover', name: 'Plover', sail: 12, a: 0.08, back: 1.2, hull: '#b9842c' },
]);
export const PLAYER = Object.freeze({ id: 'me', a: 0.6, back: 60 });
export const HELPER = Object.freeze({ afterStartS: 4 });
// v1's loose cover (tack onto the nearest boat when ahead): off in a fleet (its tacks onto the pack were the first beat's pile-ups)
const COVER = false;
// R4: the entry's close reach (degrees freer than close-hauled), its speed (× the polar's there) and a floor (m/s: steerage way)
export const ENTRY = Object.freeze({ offDeg: 4, speedK: 0.6, minMs: 1.8 });
export const TOUCH = Object.freeze({ gapS: 10, turnS: 120, glueN: 25, slipS: 8 });
const GLUE_LEAK = Math.exp(-DT / 8);   // R4: a pair in contact owes once in 10 s; a 360's time
export const BOX = Object.freeze({ share: 0.4, minM: 36 });
// the flying start, in real seconds (the session's pace turns them into game seconds): the run to the line sailing on, then the spare
// the player eases away (owner: "a few seconds, 2–3 is enough"); offDeg: the lane a close reach this much freer than close-hauled
// (a fixed heading still sails through a small header); probes: the placement checked by sailing it ahead (the valley's wind)
export const FLY = Object.freeze({ runS: 6, holdS: 2.5, offDeg: 6, probes: 3, minBackM: 9 });
// sail a boat on from a pose, holding its heading (the AUTO button: the helm on a fixed heading, the crew trimming), until her bow is
// over the line or maxS: the seconds it took (null when she never got there)
export function sailToLine(line, pose, windAt, { t0 = 0, maxS = 60, vessel } = {}) {
  const phys = craftOf(vessel).createPhysics({ x: pose.x, z: pose.z, heading: pose.heading, speed: pose.speed, ...(vessel ? { vessel } : {}) });
  const ctl = { ...CONTROLS }, env = { t: t0, windAt }, helm = new Helm({ rudderMaxDeg: boatParams(vessel).rudder.maxDeg });
  for (let i = 0, n = Math.round(maxS / DT); i < n; i++) {
    const s = phys.state;
    if (lineSide(line, s.x, s.z) > 0) return i * DT;
    ctl.rudder = helm.toHeading(s, pose.heading, DT); env.t = t0 + i * DT; phys.step(DT, ctl, env);
  }
  return null;
}   // R3: the box's depth below the line, by the wind (above)   // the helper hands the helm back this long after a clean start

// a place race's lane: the line's square toward the course, or the nearer close-hauled heading when that square is in irons (rad)
export function placeLane(line, windFromRad, alphaRad) {
  const h0 = Math.atan2(line.up[0], -line.up[1]), d = Math.atan2(Math.sin(windFromRad - h0), Math.cos(windFromRad - h0));
  if (Math.abs(d) >= alphaRad) return h0;
  return d >= 0 ? windFromRad - alphaRad : windFromRad + alphaRad;
}
// a lane held to the gun (a place race's start): the skipper on a fixed heading, the crew trimming (the helper's tick's shape)
export function createLaneHold({ heading, windAt, vessel, seed = 1 }) {
  const sk = new AISkipper({ skill: 1, seed, windAt, ...(vessel ? { vessel } : {}) });
  const adv = { evade: true, heading, side: 1, mode: 'reach' }, out = { phase: 'run', burnS: 0, needS: 0 };
  return {
    sk, get state() { return out; },
    tick(dt, s, ctl, { t = 0 } = {}) {
      const twd = s.heading + (s.trueWind?.angle ?? 0); adv.side = Math.sin(twd - heading) >= 0 ? 1 : -1;
      sk.update(dt, s, ctl, { t, waypoint: [s.x + Math.sin(heading) * 400, s.z - Math.cos(heading) * 400], legKey: 'start', advice: adv });
      return out;
    },
    reset() { sk.man = null; sk.helm.i = 0; },
  };
}

export function createRegattaSession({ course, me, rivals = RACE.rivals, windAt, depthAt = null, seed = 1, prestartS = RACE.prestartS, tier = 'medium', forgiving = true, helper = true, onPlace = null, t0 = 0, flying = false, pace = 1, gunWaits = false, event = 'fleet', meSkill = null, round = null } = {}) {
  const pursuit = event === 'pursuit', match = event === 'match', place = !!course.place;
  if (pursuit || place) flying = true;
  if (place) gunWaits = true;   // a pursuit's gate: every boat comes in sailing, each at her own time
  const pk = Math.max(0.25, Number(pace) || 1), runS = FLY.runS * pk;
  if (flying) prestartS = (FLY.runS + FLY.holdS) * pk;
  const waits = !!flying && !!gunWaits;
  const windFrom = course.designWindFrom * DEG, line = course.line;
  const n = fleetSize(rivals) - 1;
  const clear = depthAt ? makeClear(depthAt, 4) : null;
  const S = { t: t0, race: null, events: [], helper: !!helper, helperUntil: null, restarts: 0 };
  const tierOk = TIERS[tier] != null ? tier : 'medium';
  // the player's box and the gold ghost: the close-hauled lay at the wind the line has now (the helper sails it)
  const w0 = windAt(line.centre[0], line.centre[1], t0), tws0 = Math.hypot(w0.vx, w0.vz), alpha0 = tackAngle(tws0, me.phys.vessel?.polar);
  // R4 (the owner, 2026-11-14: "the boat has to sail in irons to get to the start point"): the box and its lane are laid on the wind
  // the line has NOW (the valley turns it 15–25° off the course's design wind, and a lane on the design wind pointed her within 25° of
  // the real one), and every boat enters on a close reach ENTRY.offDeg freer than close-hauled, at ENTRY.speedK of the polar's speed
  // there, sheets trimmed: sailing at once, never head to wind
  const fromL = tws0 > 0.3 ? Math.atan2(-w0.vx, w0.vz) : windFrom;
  const entry = (p) => { const h = fromL - alpha0 - ENTRY.offDeg * DEG; return { x: p.x, z: p.z, heading: h, speed: Math.max(ENTRY.minMs, ENTRY.speedK * polarKn(Math.max(1, tws0), (alpha0 / DEG) + ENTRY.offDeg, me.phys.vessel?.polar) * KN) }; };
  // R3: the box no further below the line than she can sail in the pre-start with time to spare (BOX.share of it at the polar's
  // close-hauled speed along her lane): at 60 m a light-air box (9 kn) made the helper 10–14 s late
  const pol = polarTargets(Math.max(1, tws0), me.phys.vessel?.polar), vUp = polarKn(Math.max(1, tws0), pol.up.twa, me.phys.vessel?.polar) * KN;
  const ray0 = startLay(line, fromL, HELP.a, PLAYER.back, alpha0).rayUp, back = Math.max(BOX.minM, Math.min(PLAYER.back, BOX.share * vUp * Math.max(0.2, ray0) * prestartS));
  // the flying lanes: a close reach FLY.offDeg freer than close-hauled at the polar's speed there, set back so that sailing on (her
  // heading held, the crew trimming) reaches the line runS game seconds in; the guess from the polar is checked by sailing it ahead in
  // the wind the lake has (sailToLine) and the set-back scaled until the run takes runS
  const alphaF = alpha0 + FLY.offDeg * DEG, hF = fromL - alphaF, vessel = me.phys.vessel;
  const vF = Math.max(ENTRY.minMs, polarKn(Math.max(1, tws0), alphaF / DEG, vessel?.polar) * KN);
  // extraS (a pursuit): her own start this many game seconds after the gun, so the run is that much longer
  const hP = place ? placeLane(line, fromL, alphaF) : null;
  const laneLay = (a, back) => {   // startLay's shape on the place race's lane
    const g = [line.pin[0] + (line.committee[0] - line.pin[0]) * a, line.pin[1] + (line.committee[1] - line.pin[1]) * a], ray = [Math.sin(hP), -Math.cos(hP)];
    const rayUp = ray[0] * line.up[0] + ray[1] * line.up[1], k = back / Math.max(0.2, rayUp);
    return { ghost: g, box: { x: g[0] - ray[0] * k, z: g[1] - ray[1] * k, heading: hP }, rayUp };
  };
  const vP = place ? Math.max(ENTRY.minMs, polarKn(Math.max(1, tws0), Math.abs(Math.atan2(Math.sin(fromL - hP), Math.cos(fromL - hP))) / DEG, me.phys.vessel?.polar) * KN) : 0;
  const flyLay = (a, extraS = 0) => {
    const runT = runS + extraS;
    if (place) {   // the same probe on the place lane (sailToLine holds her heading, the crew trimming)
      let bk = Math.max(FLY.minBackM, vP * laneLay(a, 1).rayUp * runT);
      for (let k = 0; k < FLY.probes; k++) {
        const L = laneLay(a, bk), T = sailToLine(line, { ...L.box, speed: vP }, windAt, { t0, maxS: runT * 3, vessel });
        if (!(T > 0)) break;
        const nb = Math.max(FLY.minBackM, bk * runT / T), done = Math.abs(nb - bk) < 0.25; bk = nb;
        if (done) break;
      }
      const L = laneLay(a, bk);
      return { ...L, back: bk, pose: { x: L.box.x, z: L.box.z, heading: hP, speed: vP } };
    }
    let bk = Math.max(FLY.minBackM, vF * startLay(line, fromL, a, 1, alphaF).rayUp * runT);
    for (let k = 0; k < FLY.probes + (extraS > 0 ? 2 : 0); k++) {
      const L = startLay(line, fromL, a, bk, alphaF), T = sailToLine(line, { ...L.box, speed: vF }, windAt, { t0, maxS: runT * 3, vessel });
      if (!(T > 0)) break;
      const nb = Math.max(FLY.minBackM, bk * runT / T), done = Math.abs(nb - bk) < 0.25; bk = nb;
      if (done) break;
    }
    const L = startLay(line, fromL, a, bk, alphaF);
    return { ...L, back: bk, pose: { x: L.box.x, z: L.box.z, heading: hF, speed: vF } };
  };
  // step C: a pursuit's rivals spread their skill round the tier (PURSUIT.spread × the fleet's own step: the chase has a real order);
  // the start times from the course's time at skill 1 (the polar at the line's wind), the slowest boat first
  const skills = Object.fromEntries(FLEET.slice(0, n).map((f) => [f.id, pursuit ? Math.max(PURSUIT.minSkill, Math.min(1, (FLEET_TIER[tierOk] ?? FLEET_TIER.medium) + (FLEET_SKILL[f.id] ?? 0) * PURSUIT.spread)) : skillFor(tierOk, f.id)]));
  const T1 = pursuit ? courseTimeS(course, fromL, tws0, vessel?.polar) : 0;
  const slots = pursuit ? pursuitSlots([{ id: 'me', skill: meSkill ?? FLEET_TIER[tierOk] ?? FLEET_TIER.medium }, ...FLEET.slice(0, n).map((f) => ({ id: f.id, skill: skills[f.id] }))], T1) : null;
  const slotOf = (id) => (slots ? slots[id] ?? 0 : 0);
  // R4: the rivals, each in its own box on its own lane (its place on the line, the player's depth × its own), v1's Rival at its skill
  const list = FLEET.slice(0, n).map((f, i) => {
    const lay = flying ? flyLay(f.a, slotOf(f.id)) : startLay(line, fromL, f.a, Math.max(BOX.minM * 0.85, back * f.back), alpha0), p = flying ? lay.pose : entry(lay.box);
    const phys = craftOf(undefined).createPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed });   // the rivals: sloops
    return { ...f, pose0: p, ghost: lay.ghost, phys, ctl: { ...CONTROLS }, brain: null, start: null, windAt: null, i, skill: skills[f.id], traffic: [] };
  });
  const states = (skip) => { const o = []; if (skip !== 'me') o.push(me.phys.state); for (const r of list) if (r.id !== skip) o.push(r.phys.state); return o; };
  for (const r of list) {
    r.windAt = shadowed(windAt, () => states(r.id));
    r.brain = new FleetRival({ course, tier: tierOk, skill: r.skill, seed: seed * 7 + r.i + 1, windAt: r.windAt, clear, vessel: r.phys.vessel });
    r.brain.traffic = r.traffic;
    r.brain.cover = match;   // a match race: the rival covers the player (fleet.js coverCall)
    r.start = place ? createLaneHold({ heading: hP, windAt: r.windAt, vessel: r.phys.vessel, seed: seed * 13 + r.i }) : createStartHelper({ line, windFrom, windAt: r.windAt, vessel: r.phys.vessel, seed: seed * 13 + r.i, ghost: r.ghost, lateS: startLate(r.skill), guard: true, flying: !!flying, aimS: (startLate(r.skill)[0] + startLate(r.skill)[1]) / 2 });
    r.env = { t: 0, windAt: r.windAt };
    // Tea House Run: this rival cuts inside the shelf on the first leg (or not), seeded per boat
    if (place && course.shortcut && h01(seed * 31 + 7, r.i + 1) < (SHORTCUT.share[tierOk] ?? 0.4)) r.brain.shortcut = { mark: course.shortcut.leg, via: [...course.shortcut.via], done: false };
  }
  const aground = new Map();   // a rival on the shelf: { until, next } (sim seconds)
  const meWind = shadowed(windAt, () => states('me'));
  const lay = flying ? flyLay(HELP.a, slotOf('me')) : startLay(line, fromL, HELP.a, back, alpha0);
  const helperBrain = place ? createLaneHold({ heading: hP, windAt: meWind, vessel: me.phys.vessel, seed: seed * 7 }) : createStartHelper({ line, windFrom, windAt: meWind, vessel: me.phys.vessel, seed: seed * 7, ghost: lay.ghost, flying: !!flying, coast: true });   // the lane aims at the crossing point; coast: never over early (helper.js COAST)
  const boats = [{ id: 'me', kind: 'player', name: me.name ?? 'You' }, ...list.map((r) => ({ id: r.id, kind: 'ai', name: r.name, sail: r.sail, hull: r.hull }))];
  // R4: a meeting is judged on a real touch (meetM 0: v1's 8 m centre distance gave a turn to every overlapped pair in a fleet start);
  // a 360 has 120 s to close (a keelboat's turn here takes 55–90 s)
  // the rounding (owner 2026-11-17, rounding.js): round 'beginner' | 'club' counts a crossing of the mark's rounding line, the same rule
  // for every boat (the fleet's too); 'pro' or none keeps the real rule
  const tracker = place ? placeTrackerFor(round, course) : trackerFor(round, course);
  const knocks = createKnocks();
  S.hazard = null; S.wash = null;
  const newRace = () => createRace({ course, boats, prestartS, forgiving, meetM: 0, turnS: TOUCH.turnS, tracker });
  S.race = newRace();
  const me0 = flying ? lay.pose : entry(lay.box);
  // the gold ghost: where the helper's boat is at 0:00, one length below the line on her lane (she crosses 0.5–1.5 s after the gun)
  const ghost = (() => { const h = lay.box.heading, d = [Math.sin(h), -Math.cos(h)], k = BOAT_LENGTH_M / Math.max(0.2, lay.rayUp); return [lay.ghost[0] - d[0] * k, lay.ghost[1] - d[1] * k]; })(), ghost0 = ghost.slice();
  const poses = {};
  const poseOf = (s, o = {}) => { o.x = s.x; o.z = s.z; o.heading = s.heading; o.u = s.u; return o; };
  const all = [me, ...list];   // the hulls that touch (src/race/contact.js: v1's hull against hull)
  const stats = { contacts: 0, keepClear: 0, pairs: {}, washS: {} };
  const lastTouch = {}, glue = [], slipUntil = [], touched = [];
  const near = { x: 0, z: 0, progressM: 0, side: 1 };   // the cover's `other`, reused

  const resetBrain = (b) => { b.sk.startCommitted = false; b.sk.man = null; b.sk.side = 1; b.sk.helm.i = 0; b.mark = null; b.j = 0; b.delta = 0; b.phase = 'prestart'; b.keepClear = null; b.sk.setSkill(b.base); };
  function restart() {
    for (const r of list) { const p = r.pose0; Object.assign(r.phys, craftOf(r.phys.vessel).createPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed, vessel: r.phys.vessel })); Object.assign(r.ctl, CONTROLS); resetBrain(r.brain); r.start.reset(); }
    helperBrain.reset();
    onPlace?.(me0);
    ghost[0] = ghost0[0]; ghost[1] = ghost0[1];
    knocks.reset(); S.hazard = null; for (const r of list) { r.brain.hazardAdv = null; r.wave = null; if (r.brain.shortcut) r.brain.shortcut.done = false; } aground.clear();
    S.race = newRace(); S.events.length = 0; S.helper = !!helper; S.helperUntil = null; S.restarts++; for (const k in lastTouch) delete lastTouch[k];
    return S.race;
  }

  // the helper: the pro skipper's start on the player's controls until a few seconds after a clean start
  function helperTick(ctl, t = S.t) {
    if (!S.helper) return false;
    const v = S.race.view('me');
    helperBrain.tick(DT, me.phys.state, ctl, { t, clock: S.race.clock - slotOf('me'), ocs: v.status === 'ocs' || v.ocs });   // a pursuit: her own time is her gun
    return true;
  }
  function takeHelm() { if (!S.helper) return false; S.helper = false; S.events.push({ type: 'helperOff', why: 'hands', clock: S.race.clock }); return true; }
  function helperOn() { if (S.helper || S.race.clock >= 0) return false; S.helper = true; helperBrain.reset(); S.events.push({ type: 'helperOn', clock: S.race.clock }); return true; }

  // the wind from where the line is NOW (the valley turns it 15–25° off the design wind): the right of way and the rules read it
  const lineWindFrom = (t) => { const w = windAt(line.centre[0], line.centre[1], t); return Math.hypot(w.vx, w.vz) > 0.3 ? Math.atan2(-w.vx, w.vz) : windFrom; };
  function tick() {
    S.t += DT;
    const wl = lineWindFrom(S.t);
    const r = S.race;
    for (const b of list) {
      const s = b.phys.state, v = r.view(b.id);
      // the boats round her (the right of way), and the nearest as v1's `other` (its cover)
      b.traffic.length = 0; let nd = Infinity, nb = null;
      for (const o of all) { if (o === b) continue; const q = o.phys.state; b.traffic.push(q); const d = Math.hypot(q.x - s.x, q.z - s.z); if (d < nd) { nd = d; nb = o; } }
      if (b.brain.lookOut(s, r.clock < 0, s.trueWind ? s.heading + s.trueWind.angle : undefined)) stats.keepClear++;   // the wind she has (the tack she is on), not the course's design wind
      if (match) { const mv = r.view('me'), cv = b.coverOpp ??= {}; cv.s = me.phys.state; cv.progressM = mv.progressM ?? 0; cv.status = mv.status; b.brain.coverOpp = cv; }
      const ag = aground.get(b.id), onShelf = !!ag && S.t < ag.until;
      if (knocks.holding(b.id, r.clock) || v.status === 'dnf' || onShelf) holdControls(b.ctl);   // a knocked-down rival: sheets flying while she rights (12 s), or out; aground on the shelf
      else if (v.status === 'prestart' || v.status === 'ocs' || v.status === 'behind') b.start.tick(DT, s, b.ctl, { t: S.t, clock: r.clock - slotOf(b.id), ocs: v.status === 'ocs' || !!v.ocs });
      else {
        const q = nb.phys.state; near.x = q.x; near.z = q.z; near.progressM = r.view(nb === me ? 'me' : nb.id)?.progressM ?? 0; near.side = Math.sign(q.trueWind?.angle || 1);
        b.brain.hazardAdv = S.hazard && v.status === 'racing' ? avoidAdvice(s, S.hazard.at, S.hazard.rOut, { skill: b.skill, windFrom: s.trueWind ? s.heading + s.trueWind.angle : null }) : null;
        if (b.ctl.jibFree) b.ctl.jibFree = false;
        b.brain.update(DT, s, b.ctl, { t: S.t, clock: r.clock, view: v, line, other: COVER ? near : null });
      }
      if (b.wave && !waveRollStep(b.wave, S.t - b.wave.t0, b.phys, DT)) b.wave = null;   // a race wave's roll (S.wave), as the page's boat
      b.env.t = S.t; b.phys.step(DT, b.ctl, b.env);
      // the shortcut's shelf (a place race with a shortcut): a keel on it stops her dead for a few seconds
      if (course.shortcut && depthAt && v.status === 'racing') {
        if (onShelf) s.u *= Math.exp(-AGROUND.stopRate * DT);
        else if ((!ag || S.t >= ag.next) && depthAt(s.x, s.z) < AGROUND.draftM) {
          aground.set(b.id, { until: S.t + AGROUND.holdS, next: S.t + AGROUND.holdS + AGROUND.againS });
          if (b.brain.shortcut) b.brain.shortcut.done = true;   // off the shelf to the mark the safe way
          S.events.push({ type: 'aground', id: b.id, clock: r.clock }); stats.aground = (stats.aground ?? 0) + 1;
        }
      }
    }
    // Glass Boat Chase: her wash (S.wash(x, z) → 0..1, glassChase.js washAt) takes way off any boat sitting in it, the player's too
    if (S.wash) for (const b of all) {
      const q = b.phys.state, k = S.wash(q.x, q.z);
      if (k > 0) { q.u *= Math.max(0, 1 - WASH.dragK * k * DT); const id = b === me ? 'me' : b.id; stats.washS[id] = (stats.washS[id] ?? 0) + DT; }
    }
    // hull against hull (v1's contact: an impulse and the overlap closed; no boat sails through another)
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const A = all[i].phys.state, Bs = all[j].phys.state;
      // a pair touching again and again (TOUCH.glueN touches in about 8 s: two rivals pressed together, both steering away the same way) is let slip apart for
      // TOUCH.slipS: in a fleet such pairs sailed glued for minutes (measured); the touch is still judged once
      const pk = i * 8 + j;
      if (slipUntil[pk] > S.t) continue;
      let touchNow = false;
      if (Math.abs(A.x - Bs.x) < 10 && Math.abs(A.z - Bs.z) < 10 && hullContact(A, Bs)) {
        glue[pk] = (glue[pk] ?? 0) + 1; if (i > 0 && glue[pk] > TOUCH.glueN) { slipUntil[pk] = S.t + TOUCH.slipS; glue[pk] = 0; }
        stats.contacts++; { const k = `${all[i] === me ? 'me' : all[i].id}-${all[j].id}`; stats.pairs[k] = (stats.pairs[k] ?? 0) + 1; }
        // a touch after the gun: the boat at fault (port gives way to starboard, windward to leeward) owes a turn (Club, Pro: rules.js
        // touch; Beginner forgives), once in TOUCH.gapS for a pair that stays in contact
        touchNow = true;
      } else glue[pk] = (glue[pk] ?? 0) * GLUE_LEAK;   // a pressed pair's contacts come and go tick by tick: counted with an 8 s memory
      if (touchNow && !touched[pk]) {
        if (r.clock >= 0) { const f = atFault(A, Bs, wl), who = f.fault === 0 ? all[i] : all[j], id = who === me ? 'me' : who.id; if (r.clock - (lastTouch[id] ?? -1e9) > TOUCH.gapS) { lastTouch[id] = r.clock; const e = r.touch(id, 'boat'); if (e) S.events.push({ ...e, rule: f.rule, clock: r.clock }); } }
      }
      touched[pk] = touchNow;
    }
    // the flying start's gun (gunWaits): a bow that reaches the line before 0:00 brings the gun to this tick (the race stepped to 0:00
    // on the last tick's poses, every boat still below the line), so she crosses at the gun and nobody is over early
    if (waits && r.clock < 0) {
      let lead = null;
      for (const b of all) { const q = b.phys.state; if (lineSide(line, q.x, q.z) > 0) { lead = b; break; } }
      if (lead) {
        const early = -r.clock;
        for (const e of r.step(early, poses, { windFrom: wl })) if (e.type !== 'tick') S.events.push({ ...e, clock: r.clock });
        S.events.push({ type: 'gunEarly', id: lead === me ? 'me' : lead.id, earlyS: early, clock: r.clock });
      }
    }
    const sm = me.phys.state;
    poses.me = poseOf(sm, poses.me);
    for (const b of list) poses[b.id] = poseOf(b.phys.state, poses[b.id]);
    const ev = r.step(DT, poses, { windFrom: wl });
    for (const e of ev) {
      S.events.push({ ...e, clock: r.clock });
      // a pursuit: over her own line before her time (more than PURSUIT.earlyS) owes a penalty turn (Club, Pro: rules.js touch; Beginner forgives)
      if (slots && e.type === 'started' && e.delayS < slotOf(e.id) - PURSUIT.earlyS) {
        S.events.push({ type: 'earlyStart', id: e.id, byS: +(slotOf(e.id) - e.delayS).toFixed(1), clock: r.clock });
        const pe = r.touch(e.id, 'boat'); if (pe) S.events.push({ ...pe, rule: 'early start', clock: r.clock });
      }
    }
    // the helper's hand-back after a clean start
    if (S.helper) {
      const v = r.view('me');
      if (v.status === 'racing' && S.helperUntil == null) S.helperUntil = r.clock + HELPER.afterStartS;
      if (S.helperUntil != null && r.clock >= S.helperUntil) { S.helper = false; S.events.push({ type: 'helperOff', why: 'started', clock: r.clock }); }
    }
  }
  // the fleet and the rules up to the player's sim time (whole ticks; the remainder waits for the next frame)
  // a place race's knockdown (knocks.js) on the race clock: held 12 s (a rival's sheets fly; the player's hold is the page's), a second
  // one retires her (DNF); events 'knocked' and 'retired' join the race's
  function knock(id, cause = 'knockdown') {
    const r = S.race, k = knocks.knock(id, r.clock, cause);
    if (!k) return null;
    S.events.push({ type: 'knocked', id, cause, kind: k.kind, n: k.n, until: k.until ?? null, clock: r.clock });
    if (k.kind === 'dnf') { const e = r.retire(id, cause); if (e) S.events.push({ ...e, clock: r.clock }); }
    return k;
  }
  // a race wave under a rival (Tessie's Deep, the RPG's surge and breach: placeEvents.js): its hull carried to heel (rad, + starboard
  // down; the director caps it at 22°, far under a knockdown) and let go (v2/sim/waveRoll.js); false for an unknown id
  function wave(id, heel) {
    const b = list.find((r) => r.id === id);
    if (!b || !Number.isFinite(heel)) return false;
    b.wave = { heel, t0: S.t, h0: null };
    return true;
  }
  function advanceTo(t) { let k = 0; while (S.t + DT <= t + 1e-9 && k < 600) { tick(); k++; } if (k === 600) S.t = t; return k; }
  function drain() { if (!S.events.length) return NONE; const out = S.events.slice(); S.events.length = 0; return out; }

  return {
    course, line, windFrom, me0, ghost, boats, round, rivals: list, meWind, helperBrain, stats, flying: !!flying, gunWaits: waits, prestartS, event, slots, skills, T1,
    get race() { return S.race; }, get t() { return S.t; }, set t(v) { S.t = v; },
    get helper() { return S.helper; }, get restarts() { return S.restarts; },
    helperTick, takeHelm, helperOn, advanceTo, tick, drain, restart, knock, knocks, place, wave,
    get hazard() { return S.hazard; }, set hazard(v) { S.hazard = v; },
    get wash() { return S.wash; }, set wash(v) { S.wash = v; },   // Glass Boat Chase: (x, z) → her wash there (glassChase.js washAt), null off
    aground: (id) => { const g = aground.get(id); return !!g && S.t < g.until; },
    state() { const r = S.race; return { clock: r.clock, phase: r.phase, done: r.done, order: r.order(), me: r.view('me'), helper: S.helper }; },
  };
}
const NONE = Object.freeze([]);
