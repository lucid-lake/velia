// The Tessie RPG, phase 5 (?tessierpg=1): Breach by rank. Behaviour on the real sims: as her, the slot held picks the boat in her lock's
// cone within 60 m and starts the run at 6 m; the release (or the boat close enough) launches the 1.6 s arc; her fall within the rank's
// landing window knocks the boat down (scored, skill 'breach'); beside it a wave heels it to 35° (rank 4: one heeled past 12° goes
// over); never on a kayak (4 m off, a splash only); her play clock 0.5x for 0.8 s about the apex (never in a race, never under
// ?slowbreach=0); the run-up seen, the crew bears away; from HIDDEN never a boat over water under 20 m; cooldowns 60/52/45/40 s; the free
// trials spent only by a real use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createBusyLake } from '../living/busyLake.js';
import { birthplaceRows } from '../sim/regions.js';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay } from '../sim/tessiePlay.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { createSkills, RPG_SKILLS_TABLE } from '../sim/tessieSkills.js';
import { BREACH, BREACH_RANKS, ARC_S, ARC_FALL_S, APEX_S, breachTarget, breachSlowK, breachLanding, breachBeside, footDist } from '../sim/tessieBreach.js';
import { SURGE } from '../sim/tessieSurge.js';
import { parseV2Flags } from '../engine/flags.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);
const DEG = Math.PI / 180, DT = 1 / 30, WIND_FROM = 225;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const save = (ranks, trials = null, xp = 1045) => memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp, ranks: { dash: 1, lure: 1, sonar: 1, surge: 1, ...ranks }, ...(trials ? { trials } : {}) }) });

function lake(ms = 6) {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: () => 40, windAt: steadyWind(ms, WIND_FROM), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0;
  for (let i = 0; i < 30 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  return { L, S, t };
}
// the player as her on the real busy lake, far from the Halcyon (phase 4's rig); her body's step takes the player's dt scale
// (plugin.playK) as living/tessie.js does; blind: the boats are not told of her (they never bear away)
function rig({ storage, at = { x: 2000, z: 2000 }, heading = 0, kayaks = () => null, world = lake(), depth = () => 40, blind = false, slowBreach = () => true } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const depthAt = (x, z) => depth(x, z);
  const sim = createTessie({ seed: 1, depthAt });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1, playK: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt, headless: true, veil: () => {}, storage, rpg: true, busy: () => world.L, kayaks, slowBreach, day: () => '2026-07-04' });
  const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  sim.ambush(at.x, at.z, heading, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  assert.ok(P.become('swap').ok);
  const step = (secs, each = null) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      const th = blind ? null : P.threat();
      world.L.post(world.S, DT, world.t, { hour: 13, others: th ? [th] : [] }); world.t += DT;
      sim.step(DT * (plugin.playK ?? 1), { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
      P.step(DT);
      if (each?.() === true) return true;
    }
    return false;
  };
  return { P, sim, B, world, step, plugin };
}
// a boat moved (its physics kept) to d m from her nose on her heading turned by a (rad)
function place(b, sim, d, a = 0) { const n = sim.state.nose, q = b.phys.state; q.x = n.x + Math.sin(n.psi + a) * d; q.z = n.z - Math.cos(n.psi + a) * d; }
const entryOf = (b) => { const q = b.phys.state; return { id: b.id, kind: 'sail', x: q.x, z: q.z, heading: q.heading, L: 8.5, B: 3 }; };
const fallOf = (P) => P.stats().log.breach?.fall ?? null;

test('the rank table: cooldown 60/52/45/40 s from the press, landing window 3/4/5/6 m, 30 m spook from rank 3, the beside knock at rank 4', () => {
  assert.deepEqual(BREACH_RANKS.slice(1).map((r) => [r.everyS, r.windowM, r.spookM, r.besideKnock]), [[60, 3, 20, false], [52, 4, 20, false], [45, 5, 30, false], [40, 6, 30, true]]);
  assert.equal(ARC_S, 1.6, 'a 1.6 s arc');
  assert.ok(Math.abs(BREACH.slow.k - 0.5) < 1e-9 && Math.abs(BREACH.slow.s - 0.8) < 1e-9);
  for (let rank = 1; rank <= 4; rank++) {
    const S = createSkills(RPG_SKILLS_TABLE), every = BREACH_RANKS[rank].everyS;
    S.rank('breach', rank);
    assert.equal(S.press('breach'), true);
    assert.equal(S.state('breach').phase, 'active', 'amber over the run and the arc');
    for (let t = 0; t < every - 0.15; t += 0.1) S.step(0.1);
    assert.equal(S.press('breach'), false, `rank ${rank}: still cooling just before ${every} s`);
    S.step(0.2); assert.equal(S.press('breach'), true, `rank ${rank}: ready ${every} s from the press`);
  }
  assert.equal(parseV2Flags('?slowbreach=0').slowbreach, false, 'the flag row: ?slowbreach=0 turns the slow clock off');
  assert.equal(parseV2Flags('').slowbreach, true);
});

test('the pure rules: the target in the cone, the lock first, HIDDEN over shallow water, the slow clock, 4 m off a kayak, the beside wave', () => {
  const her = { x: 0, z: 0, psi: 0 };   // facing north (−z)
  const list = [
    { id: 'a', kind: 'sail', x: 0, z: -50, heading: 0 },
    { id: 'b', kind: 'sail', x: 20, z: -30, heading: 0 },   // 33.7° off: in the cone
    { id: 'c', kind: 'sail', x: 30, z: -20, heading: 0 },   // 56° off: out
    { id: 'd', kind: 'sail', x: 0, z: -70, heading: 0 },    // 70 m: out
    { id: 's', kind: 'sup', x: 1, z: -10, heading: 0 },
  ];
  assert.equal(breachTarget(her, list)?.id, 'b', 'the nearest in the ±35° cone within 60 m (never a paddleboard)');
  assert.equal(breachTarget(her, list, { lockId: 'a' })?.id, 'a', 'the locked one first');
  assert.equal(breachTarget(her, list, { lockId: 'c' })?.id, 'b', 'a lock outside the cone does not count');
  assert.equal(breachTarget(her, [{ id: 'k', kind: 'kayak', x: 0, z: -30 }])?.id, 'k', 'she may run at a kayak (and lands off it)');
  const shallow = (x, z) => (z < -40 ? 12 : 40);
  assert.equal(breachTarget(her, list, { lockId: 'a', hidden: true, depthAt: shallow })?.id, 'b', 'from HIDDEN: never a boat over water under 20 m');
  assert.equal(breachTarget(her, list, { lockId: 'a', hidden: false, depthAt: shallow })?.id, 'a', 'not hidden: the shallow one is fair');
  assert.equal(breachTarget(her, [list[0]], { hidden: true, depthAt: () => 19.9 }), null);
  // the slow clock: 0.5 only within ±0.2 s of her clock about the apex (0.8 s real), never in a race, never under ?slowbreach=0
  const L = (t, o = {}) => ({ kind: 'skill', phase: 'breach', t, ...o });
  assert.equal(breachSlowK(L(APEX_S)), 0.5); assert.equal(breachSlowK(L(APEX_S + 0.19)), 0.5); assert.equal(breachSlowK(L(APEX_S - 0.25)), 1);
  assert.equal(breachSlowK(L(APEX_S), { race: true }), 1, 'never in a race'); assert.equal(breachSlowK(L(APEX_S), { off: true }), 1, '?slowbreach=0');
  assert.equal(breachSlowK(L(APEX_S, { kind: 'free' })), 1, 'the free breach keeps her clock'); assert.equal(breachSlowK(L(APEX_S, { phase: 'run' })), 1);
  // 4 m off a kayak: a fall on it moves aside until its footprint keeps 4 m off the hull
  const kay = { id: 'k', kind: 'kayak', x: 0, z: -5, heading: Math.PI / 2, L: 3.4, B: 0.85 };
  const f = breachLanding({ x: 0, z: -3, psi: 0 }, [kay]);
  assert.ok(f.moved > 0 && footDist(f, kay) >= BREACH.kayakOffM - 1e-6, `moved ${f.moved.toFixed(2)} m, ${footDist(f, kay).toFixed(2)} m off`);
  assert.equal(breachLanding({ x: 30, z: 0, psi: 0 }, [kay]).moved, 0, 'clear already: untouched');
  // beside: a boat whose hull is outside the window but within BREACH.besideM heels to 35° away from her; rank 4 knocks one past 12°
  const boat = (heelDeg) => ({ id: 'z', kind: 'sail', x: 10, z: -4.5, heading: 0, L: 8.5, B: 3, heelDeg });
  const fall = { x: 0, z: 0, psi: 0 };   // her footprint along x = 0: the hull 8.5 m off
  const b1 = breachBeside(fall, [boat(5)], BREACH_RANKS[1]);
  assert.ok(b1 && b1.heelDeg === 35 && !b1.knock && b1.side === 1, `heels away from her (she lies to its port side): ${JSON.stringify(b1)}`);
  assert.equal(breachBeside(fall, [boat(15)], BREACH_RANKS[3]).knock, false, 'rank 3: a leaning boat only heels');
  const b4 = breachBeside(fall, [boat(-15)], BREACH_RANKS[4]);
  assert.ok(b4.knock && b4.side === -1, 'rank 4: past 12° it goes over, the way it leans');
  assert.equal(breachBeside(fall, [boat(SURGE.overDeg - 1)], BREACH_RANKS[4]).knock, false, 'under 12°: a heel only');
  assert.equal(breachBeside(fall, [{ ...boat(0), x: 20 }], BREACH_RANKS[1]), null, 'farther than BREACH.besideM: nothing');
  assert.equal(breachBeside({ x: 7, z: 0, psi: 0 }, [boat(0)], BREACH_RANKS[4]), null, 'inside the window it is a hit, not a beside');
});

test('the controller: from 60 m she runs at 6 m, climbs and lands across a moving boat within 3 m (the tightest window), whatever its way', () => {
  for (const [hd, u, a] of [[Math.PI / 2, 3, 0], [0, 3.5, 0], [Math.PI, 4, 0], [Math.PI / 2, 4.5, 20], [-Math.PI / 4, 3, -25]]) {
    const depthAt = () => 40, sim = createTessie({ seed: 3, depthAt }), C = createTessiePlay({ sim, depthAt });
    C.begin({ x: 0, z: 0, heading: 0 });
    for (let i = 0; i < 60; i++) { sim.step(DT, { playing: true }); C.step(DT, {}); }
    const n = sim.state.nose;
    const boat = { id: 'b', kind: 'sail', x: n.x + Math.sin(n.psi + a * DEG) * 60, z: n.z - Math.cos(n.psi + a * DEG) * 60, heading: hd, u, L: 8.5, B: 3 };
    assert.equal(C.skillBreach(boat), true);
    let fall = null, deepest = 0, launch = null, slowS = 0;
    for (let i = 0; i < 15 / DT && !fall; i++) {
      boat.x += Math.sin(hd) * u * DT; boat.z -= Math.cos(hd) * u * DT;
      const k = breachSlowK(C.state.lunge); if (k < 1) slowS += DT;
      sim.step(DT * k, { playing: true }); C.step(DT * k, {}, { track: boat });
      if (C.state.lunge?.phase === 'run') deepest = Math.max(deepest, C.state.nose);
      for (const e of C.events) { if (e.type === 'fall') fall = e; if (e.type === 'launch') launch = e; }
    }
    assert.ok(deepest > 5.5 && deepest < 6.5, `the run at about 6 m (${deepest.toFixed(2)})`);
    assert.ok(launch && fall && fall.skill, 'launched and fell');
    assert.ok(footDist(fall, boat) <= BREACH_RANKS[1].windowM, `heading ${(hd / DEG).toFixed(0)}°, ${u} m/s, ${a}° off: ${footDist(fall, boat).toFixed(2)} m from the hull`);
    assert.ok(Math.abs(slowS - BREACH.slow.s) <= 2 * DT + 1e-9, `0.5x for 0.8 s real (${slowS.toFixed(3)} s)`);
  }
});

test('as her: at each rank a boat 60 m ahead is knocked down by the fall within the window, scored as a breach, the eye pulled back', () => {
  for (let rank = 1; rank <= 4; rank++) {
    const world = lake();
    const st = save({ breach: rank });
    const { P, sim, step, plugin } = rig({ storage: st, world, blind: true });
    step(0.3);
    const boat = [...world.L.liveBoats][0]; place(boat, sim, 60);
    const wrecked0 = P.bounty.state().byType.sail.wrecked, xp0 = P.bounty.state().xp;
    assert.equal(P.pressSlot('breach'), 'fire');
    assert.equal(P.stats().log.breach.target, boat.id);
    let slowFrames = 0, pulled = false;
    step(12, () => { if (plugin.playK < 1) slowFrames++; if (P.stats().log.breach.launch && P.stats().rpg.breachFx) pulled ||= true; return !!fallOf(P); });
    const f = fallOf(P);
    assert.ok(f, `rank ${rank}: she fell`);
    assert.equal(f.hit, boat.id, `rank ${rank}: on its rail (${JSON.stringify(f)})`);
    assert.ok(f.d <= BREACH_RANKS[rank].windowM, `within the ${BREACH_RANKS[rank].windowM} m window`);
    assert.ok(boat.knock, 'knocked down (the busy lake\'s knock)');
    assert.equal(P.bounty.state().byType.sail.wrecked, wrecked0 + 1, 'scored as wrecked');
    assert.ok(P.bounty.state().xp > xp0);
    assert.ok(Math.abs(slowFrames * DT - BREACH.slow.s) <= 2 * DT + 1e-9, `rank ${rank}: her clock 0.5x for 0.8 s (${(slowFrames * DT).toFixed(3)} s)`);
    assert.ok(pulled && P.stats().log.breach.launch.why, 'launched (the eye eases back and up from the launch)');
    step(2);
    assert.equal(plugin.playK, 1, 'her clock back to 1x');
  }
});

test('no slow clock under ?slowbreach=0; the release launches at once; the slot cools for the rank\'s time', () => {
  const world = lake();
  const { P, sim, step, plugin } = rig({ storage: save({ breach: 2 }), world, blind: true, slowBreach: () => false });
  step(0.3);
  const boat = [...world.L.liveBoats][0]; place(boat, sim, 55);
  assert.equal(P.pressSlot('breach'), 'fire');
  let since = 0; const tick = () => { since += DT; };
  step(0.5, tick);
  assert.equal(P.releaseSlot('breach'), true, 'the slot let go');
  let slow = 0;
  step(6, () => { tick(); if (plugin.playK < 1 || P.stats().rpg.slowK < 1) slow++; return !!fallOf(P); });
  assert.equal(slow, 0, 'never slowed');
  assert.equal(P.stats().log.breach.launch.why, 'release');
  assert.equal(fallOf(P).hit, null, 'released 50 m short: no hit');
  assert.equal(P.pressSlot('breach'), 'idle', 'cooling');
  step(51.8 - since, tick);
  assert.notEqual(P.stats().rpg.breach.phase, 'ready', `still cooling at ${since.toFixed(2)} s`);
  step(0.4, tick);
  assert.equal(P.stats().rpg.breach.phase, 'ready', 'ready 52 s from the press at rank 2');
});

test('beside the boat: the wave heels it to 35° away from her; rank 4 knocks one already heeled past 12°, rank 3 does not', () => {
  for (const [rank, lean] of [[1, 0], [3, 15], [4, 15]]) {
    const world = lake();
    const { P, sim, step } = rig({ storage: save({ breach: rank }), world, blind: true });
    step(0.3);
    const boat = [...world.L.liveBoats][0]; place(boat, sim, 60);
    assert.equal(P.pressSlot('breach'), 'fire');
    // just before her front lands the boat slides 10 m along its beam, away from her: the fall lands beside it
    let moved = false, peak = 0, side = 0;
    step(12, () => {
      const L = P.ctl.state.lunge;
      if (!moved && L?.kind === 'skill' && L.phase === 'breach' && L.t >= ARC_FALL_S - 1.5 * DT) {
        moved = true; const q = boat.phys.state, n = sim.state.nose, rx = Math.cos(q.heading), rz = Math.sin(q.heading), s = (q.x - n.x) * rx + (q.z - n.z) * rz >= 0 ? 1 : -1;
        q.x += rx * s * 10; q.z += rz * s * 10;
        if (lean) q.heel = lean * DEG * (q.heel >= 0 ? 1 : -1);
      }
      return !!fallOf(P);
    });
    const f = fallOf(P);
    assert.ok(f && !f.hit && f.beside?.id === boat.id, `rank ${rank}: beside it (${JSON.stringify(f)})`);
    if (rank === 4) { assert.ok(f.beside.knock && boat.knock, 'rank 4: over'); continue; }
    assert.ok(!f.beside.knock && !boat.knock, `rank ${rank}: no knock, a wave`);
    side = f.beside.side;
    step(2.5, () => { peak = Math.max(peak, boat.phys.state.heel * side / DEG); });
    assert.ok(peak >= 35 * 0.85, `rank ${rank}: heeled toward 35° (peak ${peak.toFixed(1)}°)`);
  }
});

test('never on a kayak: run at one and she lands 4 m off its hull, a splash only (scored), the kayaker spooked', () => {
  const marks = [{ id: 'p1', x: 0, z: 0, heading: Math.PI / 2 }];
  let bites = 0, spooks = [];
  const fleet = { marks: () => marks, bite: () => { bites++; return true; }, spook: (x, z, r) => { spooks.push(r); return 1; }, lure: () => [] };
  const world = lake();
  for (const L of world.L.liveBoats) { L.phys.state.x += 5000; }   // the sailboats far away
  const { P, sim, step } = rig({ storage: save({ breach: 3 }), world, kayaks: () => fleet, blind: true });
  step(0.3);
  const n = sim.state.nose; marks[0].x = n.x + Math.sin(n.psi) * 45; marks[0].z = n.z - Math.cos(n.psi) * 45;
  const splashed0 = P.bounty.state().byType.kayak.splashed;
  assert.equal(P.pressSlot('breach'), 'fire');
  assert.equal(P.stats().log.breach.kind, 'kayak');
  step(12, () => !!fallOf(P));
  const f = fallOf(P), kay = { kind: 'kayak', x: marks[0].x, z: marks[0].z, heading: marks[0].heading, L: 3.4, B: 0.85 };
  assert.ok(f && f.hit === null && !f.ok, 'no hit on a kayak');
  const land = P.stats().log.lastFall;
  assert.ok(Math.hypot(land.x - kay.x, land.z - kay.z) <= 20, 'yet near it (the splash reaches it)');
  assert.ok(footDist({ x: f.x, z: f.z, psi: sim.state.nose.psi }, kay) >= BREACH.kayakOffM - 0.6, `4 m off its hull (${footDist({ x: f.x, z: f.z, psi: sim.state.nose.psi }, kay).toFixed(2)} m)`);
  assert.equal(bites, 0, 'never tipped');
  assert.equal(P.bounty.state().byType.kayak.splashed, splashed0 + 1, 'a splash scored');
  assert.ok(spooks.includes(30), 'rank 3: spooked within 30 m of the splash');
});

test('the run-up is seen: a crew within 25 m sees the V and bears away; held on, she runs at where it was (it gets away as far as it sails); let go when the corners turn amber (or up to a reaction later), she lands on it', () => {
  for (const [release, lateS] of [[false, 0], [true, 0], [true, 0.6]]) {
    const world = lake();
    const { P, sim, step } = rig({ storage: save({ breach: 1 }), world });
    P.pin({ nose: 7 }); step(4); P.pin(null);
    const boat = [...world.L.liveBoats][0]; place(boat, sim, 45); boat.phys.state.heading = sim.state.nose.psi + 30 * DEG + Math.PI / 2;   // crossing her bow
    const wrecked0 = P.bounty.state().byType.sail.wrecked;
    assert.equal(P.pressSlot('breach'), 'fire');
    let see = 0, evaded = false, amber = false, amberT = null, tNow = 0; const aims = [];
    step(14, () => {
      const L = P.ctl.state.lunge, th = P.threat();
      if (P.stats().log.breach.seen != null && L?.target) aims.push([L.target.x, L.target.z]);
      if (L?.phase === 'run' && P.ctl.state.nose > 3) see = Math.max(see, th?.seeM ?? 0);
      if (boat.evade != null) evaded = true;
      tNow += DT;
      if (P.stats().rpg.breachFx?.near && L?.phase === 'run') { amber = true; amberT ??= tNow; }
      if (release && amberT != null && tNow - amberT >= lateS - 1e-9 && L?.phase === 'run') P.releaseSlot('breach');   // a person's reaction: up to 0.6 s after amber
      return !!fallOf(P);
    });
    const b = P.stats().log.breach, f = b.fall, q = boat.phys.state;
    assert.ok(amber, 'the corners turned amber on the run (a release now lands on it)');
    if (!release) {
      assert.equal(see, BREACH.seeM, 'the run at 6 m shows at 25 m (15 m otherwise)');
      assert.ok(evaded, 'its crew saw the V and bore away');
      assert.equal(b.launch.why, 'at', 'held on: she launched at the spot');
      if (b.seen != null) {   // the crew reacted (BREACH.reactS after the sighting) before her launch: she runs at where it was
        assert.ok(aims.length > 10 && aims.every((p) => Math.hypot(p[0] - b.seenAt.x, p[1] - b.seenAt.z) < 0.08), 'from the reaction on she runs at where it was (told no more of it)');
        assert.ok(Math.hypot(f.x - b.seenAt.x, f.z - b.seenAt.z) < Math.hypot(f.x - q.x, f.z - q.z), `she landed nearer where it was than where it got to (${JSON.stringify(f)})`);
      } else assert.equal(f.hit, boat.id, `seen under ${BREACH.reactS} s before her launch: the crew had no time, she lands on it (${JSON.stringify(f)})`);
      assert.equal(P.stats().tipsWant.includes('tip.tessie.breach.seen'), b.seen != null && !f.ok, `a miss on a crew that saw it coming says why once (seen ${b.seen}, ok ${f.ok})`);
    } else {
      assert.ok(!P.stats().tipsWant.includes('tip.tessie.breach.seen'), 'a hit says nothing');
      assert.equal(b.launch.why, 'release');
      assert.equal(f.hit, boat.id, `let go ${lateS} s after the amber: on its rail (${JSON.stringify(f)})`);
      assert.equal(P.bounty.state().byType.sail.wrecked, wrecked0 + 1);
    }
  }
});

test('from the surface, held on at a boat crossing 45 m ahead: its crew sees her at 60 m, bears away, she lands behind it, and the line says why once', () => {
  const world = lake(); const { P, sim, step } = rig({ storage: save({ breach: 1 }), world });
  step(1);
  const boat = [...world.L.liveBoats][0]; place(boat, sim, 45); boat.phys.state.heading = sim.state.nose.psi + 90 * DEG;
  assert.equal(P.pressSlot('breach'), 'fire');
  step(14, () => !!fallOf(P));
  const b = P.stats().log.breach;
  assert.ok(b.seen != null && b.fall && !b.fall.ok, `seen, a miss (${JSON.stringify(b)})`);
  assert.ok(P.stats().tipsWant.includes('tip.tessie.breach.seen'), '"They saw you coming. Start the Breach deeper." asked of the skipper\'s line');
});

test('from HIDDEN a boat over water under 20 m cannot be reached (nothing spent); over deep water it can', () => {
  let shallowAt = null;
  const depth = (x, z) => (shallowAt && Math.hypot(x - shallowAt.x, z - shallowAt.z) < 25 ? 15 : 40);
  const world = lake();
  const { P, sim, step } = rig({ storage: save({ breach: 0 }, { lure: 5, sonar: 5, surge: 5, breach: 5 }), world, depth, blind: true });
  P.pin({ nose: 12 }); step(6); P.pin(null);
  assert.ok(P.ctl.state.hidden, `HIDDEN (${P.ctl.state.nose.toFixed(1)} m)`);
  const boat = [...world.L.liveBoats][0]; place(boat, sim, 50);
  for (const b of world.L.liveBoats) if (b !== boat) b.phys.state.x += 5000;
  shallowAt = { x: boat.phys.state.x, z: boat.phys.state.z };
  assert.equal(P.pressSlot('breach'), 'idle', 'no boat she can reach');
  assert.equal(P.bounty.state().trials.breach, 5, 'no free trial spent');
  assert.ok(P.stats().log.breach.none && P.stats().log.breach.hidden);
  shallowAt = null;
  assert.equal(P.pressSlot('breach'), 'fire', 'over deep water: the run');
  assert.equal(P.bounty.state().trials.breach, 4, 'a free trial spent by the real use (as rank 1)');
  assert.equal(P.stats().log.breach.rank, 1);
});

test('the crew reacts BREACH.reactS after it sees the run: seen that long before her launch, she is told no more of it', () => {
  assert.ok(BREACH.reactS >= 0.6 && BREACH.reactS <= 1.2, `a person's reaction window after amber (${BREACH.reactS} s)`);
  const world = lake();
  const { P, sim, step } = rig({ storage: save({ breach: 1 }), world });
  P.pin({ nose: 7 }); step(4); P.pin(null);
  const boat = [...world.L.liveBoats][0]; place(boat, sim, 58); boat.phys.state.heading = sim.state.nose.psi;   // sailing away ahead: a long run
  assert.equal(P.pressSlot('breach'), 'fire');
  step(14, () => !!fallOf(P));
  const b = P.stats().log.breach;
  if (b.seen != null) assert.ok(b.launch == null || b.launch.at - b.seen >= -1e-6, `told no more of it from the reaction on (${JSON.stringify(b)})`);
  assert.ok(b.seen == null || b.seenAt, 'a reaction keeps where it was');
});
