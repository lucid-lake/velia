// The Tessie RPG, phase 4 (?tessierpg=1): Tail Surge by rank. Behaviour on the real sims: as her, a press winds up 1.2 s, then the slap's
// ring wave heels the busy lake's sailboats away from her by distance and rank; one boat within the knock radius already heeled past 20°
// goes over (scored as wrecked), never in Light wind; the kayakers within 20 m are splashed and scored; every 30 s at every rank; the
// free trials are spent only by a real use.
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
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { createSkills, RPG_SKILLS_TABLE } from '../sim/tessieSkills.js';
import { SURGE, SURGE_RANKS, surgeHeel, surgeResolve, lightWind } from '../sim/tessieSurge.js';
import { createTourBoat } from '../sim/tourBoat.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);
const DEG = Math.PI / 180, DT = 1 / 30, deep = () => 40, WIND_FROM = 225, KN = 0.514444;
// the three winds: Light 5.5 kn (the Light band's mean), Medium 10 kn (Moderate's), Strong 24 kn (the Strong band's top)
const WINDS = { light: 5.5 * KN, medium: 10 * KN, strong: 24 * KN };
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const save = (ranks, trials = null, xp = 600) => memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp, ranks: { dash: 1, lure: 1, sonar: 1, ...ranks }, ...(trials ? { trials } : {}) }) });

// the busy lake out for 30 s in a steady wind (the boats settle onto their heel), the Halcyon's state far away
function lake(ms = 6) {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: deep, windAt: steadyWind(ms, WIND_FROM), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0;
  for (let i = 0; i < 30 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  return { L, S, t };
}
// the player as her on the real busy lake, far from the Halcyon (as phase 3's rig)
function rig({ storage, at = { x: 2000, z: 2000 }, heading = 0, kayaks = () => null, tour = () => null, world = lake() } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage, rpg: true, busy: () => world.L, kayaks, tour, day: () => '2026-07-04' });
  const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  sim.ambush(at.x, at.z, heading, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  assert.ok(P.become('swap').ok);
  const step = (secs, each = null) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      const th = P.threat();
      world.L.post(world.S, DT, world.t, { hour: 13, others: th ? [th] : [] }); world.t += DT;
      tour()?.post?.(null, DT, world.t);
      sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
      P.step(DT);
      each?.();
    }
  };
  return { P, sim, B, world, step };
}
// a boat moved (its physics kept: its heel, its way) to d m from her middle on bearing a (rad from north)
function place(b, sim, d, a) { const c = sim.state.centre, q = b.phys.state; q.x = c[0] + Math.sin(a) * d; q.z = c[1] - Math.cos(a) * d; }

test('the rank table: ring 40/48/56/64 m, knock radius 12/14/16/18 m, heel 35/38/41/45°, every 30 s at every rank', () => {
  assert.deepEqual(SURGE_RANKS.slice(1).map((r) => [r.ringM, r.knockM, r.heelDeg, r.everyS]), [[40, 12, 35, 30], [48, 14, 38, 30], [56, 16, 41, 30], [64, 18, 45, 30]]);
  assert.equal(SURGE.windupS, 1.2);
  for (let rank = 1; rank <= 4; rank++) {
    const S = createSkills(RPG_SKILLS_TABLE);
    S.rank('surge', rank);
    assert.equal(S.press('surge'), true);
    assert.equal(S.state('surge').phase, 'active', 'amber over the wind-up and the wave');
    for (let t = 0; t < 29.85; t += 0.1) S.step(0.1);
    assert.equal(S.press('surge'), false, `rank ${rank}: still cooling at 29.9 s`);
    S.step(0.2); assert.equal(S.press('surge'), true, `rank ${rank}: ready 30 s from the press`);
  }
});

test('the pure rules: heel by distance, the one-boat knock rule, Light wind, the kayaks within 20 m, the side away from her', () => {
  const r1 = SURGE_RANKS[1], r4 = SURGE_RANKS[4];
  assert.equal(surgeHeel(5, r1), 35); assert.equal(surgeHeel(12, r1), 35, 'the full angle inside the knock radius');
  assert.ok(Math.abs(surgeHeel(40, r1) - 35 * SURGE.edgeK) < 1e-9, 'the ring\'s edge: edgeK of it');
  assert.ok(surgeHeel(26, r1) < 35 && surgeHeel(26, r1) > surgeHeel(40, r1), 'falling with distance');
  assert.equal(surgeHeel(41, r1), 0, 'none outside the ring');
  assert.equal(surgeHeel(60, r4), 45 * (1 - (1 - SURGE.edgeK) * (60 - 18) / (64 - 18)), 'rank 4 reaches 64 m');
  const her = { x: 0, z: 0 }, strong = 11, light = 2.8;
  // two boats heeled past 20° inside the knock radius: the nearer goes over, the other heels; one at 19° heels; one at 25° outside it heels
  const list = [
    { id: 'a', kind: 'sail', x: 10, z: 0, heading: 0, heelDeg: -24, twsMs: strong },
    { id: 'b', kind: 'sail', x: 0, z: 8, heading: 0, heelDeg: 22, twsMs: strong },
    { id: 'c', kind: 'sail', x: -6, z: 0, heading: 0, heelDeg: 19, twsMs: strong },
    { id: 'd', kind: 'sail', x: 0, z: -20, heading: 0, heelDeg: 25, twsMs: strong },
    { id: 'g', kind: 'glass', x: 0, z: 30, heading: 0 },
    { id: 'p', kind: 'power', x: 15, z: 15, heading: 0 },
    { id: 'k1', kind: 'kayak', x: 15, z: 5 }, { id: 'k2', kind: 'kayak', x: 21, z: 0 }, { id: 's', kind: 'sup', x: 3, z: 3 },
  ];
  const p = surgeResolve(her, list, r1);
  assert.equal(p.knock?.id, 'b', 'one boat goes over: the nearest heeled past 20° within 12 m');
  assert.equal(p.knock.side, 1, 'over the way she already leans (starboard down)');
  assert.deepEqual(p.heels.map((h) => h.id), ['c', 'a', 'd', 'g'], 'the rest inside the ring heel, nearest first (the powerboat is no ring-wave hull)');
  assert.deepEqual(p.kayaks, ['k1'], 'the kayak 15.8 m off is splashed; 21 m is out; a paddleboard is no kayak');
  assert.equal(p.heels.find((h) => h.id === 'a').side, 1, 'she lies on its port side (west of a north-facing boat): it heels to starboard, away from her');
  assert.equal(p.heels.find((h) => h.id === 'c').side, -1, 'she lies on its starboard side: it heels to port');
  assert.ok(p.heels.every((h, i, a) => i === 0 || h.atS >= a[i - 1].atS) && Math.abs(p.heels.find((h) => h.id === 'g').atS - 30 / (40 / SURGE.waveS)) < 1e-9, 'the wave reaches each by its distance');
  assert.deepEqual(p.seen.sort(), ['a', 'b', 'c', 'd', 'g', 'p'], 'the slap reveals her to every boat inside the ring');
  // Light wind: the same boats, nothing goes over
  const pl = surgeResolve(her, list.map((b) => ({ ...b, twsMs: b.twsMs != null ? light : undefined })), r1);
  assert.equal(pl.knock, null, 'Light wind: nothing goes over'); assert.equal(pl.light, true);
  assert.equal(pl.heels.length, 5, 'all of them only heel (the four sailboats and the glass boat)');
  assert.ok(lightWind(7 * KN) && !lightWind(8 * KN));
});

// as her in a steady wind: the boats placed round her just before the slap (their heel kept), the peaks read over the wave
function surgeRun(windKey, { rank = 1, ds = [9, 24, 36] } = {}) {
  const world = lake(WINDS[windKey]), L = world.L;
  const st = save({ surge: rank });
  const { P, sim, step } = rig({ storage: st, world });
  step(0.2);
  const xp0 = P.bounty.state().xp;
  assert.equal(P.pressSlot('surge'), 'fire');
  assert.equal(P.stats().rpg.surgeFx.phase, 'windup');
  step(1.0);
  assert.equal(P.stats().rpg.surgeFx.phase, 'windup', 'still winding up at 1.0 s');
  // the boats most heeled (they sail on their own wind), placed at ds round her (60° apart)
  const boats = [...L.liveBoats].sort((a, b) => Math.abs(b.phys.state.heel) - Math.abs(a.phys.state.heel)).slice(0, ds.length);
  boats.forEach((b, i) => place(b, sim, ds[i], (i * 60 + 90) * DEG));
  const heels = new Map(boats.map((b) => [b.id, []]));
  step(4, () => { for (const b of boats) heels.get(b.id).push(b.phys.state.heel / DEG); });
  // each boat's peak heel the way the wave pushes it (+: that way)
  const peak = { get: (id, side) => Math.max(...heels.get(id).map((h) => h * side)) };
  const slap = P.stats().log.surge.slap;
  assert.ok(slap && Math.abs(slap.at - P.stats().log.surge.at - SURGE.windupS) < 0.05, `the slap 1.2 s after the press (${JSON.stringify(P.stats().log.surge)})`);
  return { P, L, boats, peak, slap, xp0, st };
}
const checkHeels = (r, why) => {
  for (const h of r.slap.heels) {
    const b = r.boats.find((o) => o.id === h.id); if (!b) continue;
    const pk = r.peak.get(h.id, h.side), want = h.heelDeg;
    if (h.lean * h.side >= want) continue;   // already leaning that far that way: the wave adds nothing
    assert.ok(Math.abs(pk - want) < 4, `${why}: ${h.id} at ${h.d} m heels away from her (${h.side > 0 ? 'starboard' : 'port'} down) to ${pk.toFixed(1)}° (the wave's ${want.toFixed(1)}°, lean ${h.lean}°)`);
  }
};

test('Light wind (5.5 kn): the boats heel by distance, nothing goes over', () => {
  const r = surgeRun('light');
  assert.equal(r.slap.heels.length, 3, `three boats inside the ring (${JSON.stringify(r.slap.heels)})`);
  assert.equal(r.slap.knock, null);
  assert.deepEqual(r.slap.over, []);
  assert.ok(r.boats.every((b) => !b.knock?.capsized), 'none capsized');
  const [n, m, f] = r.slap.heels;
  assert.ok(n.heelDeg === 35 && m.heelDeg < 35 && f.heelDeg < m.heelDeg, `35° inside 12 m, less farther out (${r.slap.heels.map((h) => h.heelDeg).join(', ')})`);
  checkHeels(r, 'Light');
  assert.equal(r.P.bounty.state().byType.sail.wrecked, 0);
});

test('Medium wind (10 kn): the boats heel by distance; a boat leaning under 20° does not go over', () => {
  const r = surgeRun('medium');
  const leans = r.slap.heels.map((h) => Math.abs(h.lean));
  assert.ok(leans.every((l) => l < SURGE.overDeg), `no boat leans 20° in 10 kn (${leans.join(', ')})`);
  assert.equal(r.slap.knock, null); assert.deepEqual(r.slap.over, []);
  checkHeels(r, 'Medium');
});

test('Strong wind (24 kn): the boat within the knock radius heeled past 20° goes over and is scored; the others only heel', () => {
  const r = surgeRun('strong', { ds: [9, 11, 30] });
  const k = r.slap.knock;
  assert.ok(k && Math.abs(k.lean) > 20 && k.d <= 12, `one boat inside 12 m leaning past 20° (${JSON.stringify(r.slap)})`);
  assert.deepEqual(r.slap.over, [k.id], 'it went over');
  const kb = r.L.liveBoats.find((b) => b.id === k.id);
  assert.ok(kb.knock?.capsized, 'capsized (heel past 60°)');
  const twin = r.slap.heels.find((h) => h.d <= 12 && Math.abs(h.lean) > 20);
  assert.ok(twin, `a second boat inside 12 m also leaning past 20° (${JSON.stringify(r.slap.heels)})`);
  assert.equal(r.boats.filter((b) => b.knock?.capsized).length, 1, 'exactly one boat over (the one-boat rule): the second only heels');
  assert.equal(r.P.bounty.state().byType.sail.wrecked, 1, 'scored as wrecked');
  const got = r.P.bounty.state().xp - r.xp0;
  assert.ok(got >= 3, `XP for a lake sailboat (${got})`);
  checkHeels(r, 'Strong');
});

test('the rank sets the ring: a boat 44 m off heels at rank 2 (48 m), not at rank 1 (40 m); rank 4 heels 45° inside 18 m', () => {
  const r1 = surgeRun('light', { rank: 1, ds: [44] });
  assert.equal(r1.slap.heels.length, 0, `rank 1: 44 m is outside its 40 m (${JSON.stringify(r1.slap.heels)})`);
  const r2 = surgeRun('light', { rank: 2, ds: [44] });
  assert.equal(r2.slap.heels.length, 1, 'rank 2: inside its 48 m');
  checkHeels(r2, 'rank 2');
  const r4 = surgeRun('light', { rank: 4, ds: [16] });
  assert.equal(r4.slap.heels[0].heelDeg, 45);
  checkHeels(r4, 'rank 4');
});

test('the kayakers within 20 m are splashed and counted in the bounty (one splash a slap); one at 26 m is not', () => {
  const her = { x: 2000, z: 2000 }, list = [];
  const fleet = { marks: () => list, spooked: [], spook(x, z, r) { this.spooked.push(r); }, bite: null };
  const world = lake(WINDS.light);
  const { P, sim, step } = rig({ storage: save({ surge: 1 }), at: her, kayaks: () => fleet, world });
  step(0.2);
  const c = () => sim.state.centre;
  assert.equal(P.pressSlot('surge'), 'fire');
  step(1.0);
  list.push({ id: 'k1', x: c()[0] + 14, z: c()[1], heading: 0 }, { id: 'k2', x: c()[0] - 26, z: c()[1], heading: 0 });
  step(0.3);
  const s = P.stats().log.surge.slap;
  assert.deepEqual(s.kayaks, ['k:k1'], `the kayak 14 m off is splashed, 26 m is not (${JSON.stringify(s.kayaks)})`);
  assert.equal(P.bounty.state().byType.kayak.splashed, 1, 'counted');
  assert.ok(s.splashXp >= 1, `its XP (${s.splashXp})`);
  assert.ok(fleet.spooked.includes(SURGE.kayakM), 'and spooked within 20 m');
  // a slap with no kayak near: nothing counted
  list.length = 0;
  step(29);
  assert.equal(P.pressSlot('surge'), 'fire');
  step(1.5);
  assert.equal(P.bounty.state().byType.kayak.splashed, 1, 'no kayak near: no splash');
});

test('the glass boat inside the ring heels by its scripted roll (never over); the slap reveals her', () => {
  const T = createTourBoat({ depthAt: () => 20, hour: 13, seed: 1 });
  T.chase({ stop: 'fannette', holdS: 0, preS: 0 });
  let t = 0; for (let i = 0; i < 40 / DT; i++) { T.post(null, DT, t); t += DT; }
  const g = T.boat, at = { x: g.x + Math.sin(g.heading + Math.PI / 2) * 30, z: g.z - Math.cos(g.heading + Math.PI / 2) * 30 };
  const { P, sim, step } = rig({ storage: save({ surge: 1 }), at, heading: g.heading, tour: () => T, world: lake(WINDS.medium) });
  step(0.2);
  P.pressSlot('surge');
  let pk = 0;
  step(4, () => { pk = Math.max(pk, Math.abs(T.boat.heel ?? 0) / DEG); });
  const h = P.stats().log.surge.slap.heels.find((x) => x.id === 'glass');
  assert.ok(h, `the glass boat inside the ring (${JSON.stringify(P.stats().log.surge.slap)})`);
  assert.ok(Math.abs(pk - h.heelDeg) < 1.5, `she heels to the wave's ${h.heelDeg}° (${pk.toFixed(1)}°)`);
  assert.ok(P.stats().log.surge.slap.seen.includes('glass') && P.stats().log.surge.slap.knock === null, 'seen, never over');
  assert.ok(Math.hypot(sim.state.centre[0] - g.x, sim.state.centre[1] - g.z) < 45);
});

test('a free Tail Surge trial: spent on a real slap only (not while cooling); at 0 the slot is locked and the press does nothing', () => {
  const st = save({ surge: 0 }, { lure: 5, sonar: 5, surge: 2, breach: 5 });
  const { P, step } = rig({ storage: st, world: lake(WINDS.light) });
  step(0.2);
  assert.equal(P.pressSlot('surge'), 'fire'); assert.equal(P.bounty.state().trials.surge, 1);
  assert.equal(P.stats().log.surge.rank, 1, 'a trial fires at rank 1');
  assert.equal(P.pressSlot('surge'), 'idle'); assert.equal(P.bounty.state().trials.surge, 1, 'cooling: none spent');
  step(30.1);
  assert.equal(P.pressSlot('surge'), 'fire'); assert.equal(P.bounty.state().trials.surge, 0);
  step(30.1);
  assert.equal(P.pressSlot('surge'), 'idle', 'no trials left: locked'); assert.equal(P.bounty.state().trials.surge, 0);
});

test('as her, the cooldown is 30 s at every rank (rank 4 too); the slot runs amber over the wind-up and the wave, then cools', () => {
  for (const rank of [1, 4]) {
    const { P, step } = rig({ storage: save({ surge: rank }), world: lake(WINDS.light) });
    step(0.1);
    assert.equal(P.pressSlot('surge'), 'fire');
    step(3.0); assert.equal(P.stats().rpg.surge.phase, 'active', `rank ${rank}: amber at 3.0 s`);
    step(0.4); assert.equal(P.stats().rpg.surge.phase, 'cool');
    assert.equal(P.stats().rpg.surgeFx?.phase, 'wave');
    step(26.3); assert.equal(P.pressSlot('surge'), 'idle', `rank ${rank}: still cooling at 29.8 s`);
    step(0.4); assert.equal(P.pressSlot('surge'), 'fire', `rank ${rank}: ready at 30 s`);
  }
});

test('the Halcyon inside the ring heels away from her too (her skipper fleeing)', () => {
  const probe = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample: () => ({ vx: 0, vz: 0 }) }, headless: true });
  const at = { x: probe.state.x + 22, z: probe.state.z };
  const { P, B, step } = rig({ storage: save({ surge: 1 }), at, world: lake(WINDS.light) });
  step(0.1);
  assert.equal(P.pressSlot('surge'), 'fire');
  const hs = [];
  step(4, () => { B.step(DT, {}); hs.push(B.state.heel / DEG); });   // (the rig steps no Halcyon: here she sails)
  const h = P.stats().log.surge.slap.heels.find((x) => x.id === 'halcyon');
  assert.ok(h, `the Halcyon inside the ring (${JSON.stringify(P.stats().log.surge.slap)})`);
  const pk = Math.max(...hs.map((v) => v * h.side));
  assert.ok(Math.abs(pk - h.heelDeg) < 4, `she heels away from her to ${pk.toFixed(1)}° (the wave's ${h.heelDeg.toFixed(1)}° at ${h.d} m)`);
});
