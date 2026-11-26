// The Tessie RPG, phase 3 (?tessierpg=1): Lure and Sonar by rank. Behaviour on the real sims: the busy lake's sailboats turn curious
// toward her lure (one that saw her does not), the kayakers and the glass boat turn too, the ranks change the range and the times, the
// ping marks every boat in range and none beyond, a free trial is spent only by a real use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { steadyWind } from '../../src/sim/boat.js';
import { createBusyLake } from '../living/busyLake.js';
import { createTourBoat } from '../sim/tourBoat.js';
import { createKayakFleet } from '../sim/kayaks.js';
import { makeTerrain } from './helpers/ground.mjs';
import { birthplaceRows } from '../sim/regions.js';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { BOUNTY } from '../sim/tessieBounty.js';
import { LURE_RANKS, SONAR_RANKS, createSkills, RPG_SKILLS_TABLE } from '../sim/tessieSkills.js';
import { LURE, lureTargets, curiousHeading, lureSplashes } from '../sim/tessieLure.js';
import { SONAR, sonarPing, rimMarks } from '../sim/tessieSonar.js';
import { wrap } from '../../src/sim/core/math.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);
const DEG = Math.PI / 180, DT = 1 / 30, deep = () => 40, WIND_FROM = 225;
const memStore = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const save = (ranks, trials = null, xp = 600) => memStore({ [BOUNTY.key]: JSON.stringify({ _v: BOUNTY.v, xp, ranks: { dash: 1, ...ranks }, ...(trials ? { trials } : {}) }) });
const offTo = (b, p) => Math.abs(wrap(Math.atan2(p.x - b.x, -(p.z - b.z)) - b.heading));

// the busy lake with its boats out (the first tick spawns them), the Halcyon's state far away
function lake() {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: deep, windAt: steadyWind(6, WIND_FROM), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0;
  for (let i = 0; i < 60; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  return { L, S, t };
}
// a point `d` m abeam of a boat, on its leeward side (so the turn toward it is never into the wind)
function abeam(q, d) {
  const from = WIND_FROM * DEG, pts = [1, -1].map((sg) => ({ x: q.x + Math.sin(q.heading + sg * Math.PI / 2) * d, z: q.z - Math.cos(q.heading + sg * Math.PI / 2) * d }));
  return pts.sort((a, b) => Math.abs(wrap(Math.atan2(b.x - q.x, -(b.z - q.z)) - from)) - Math.abs(wrap(Math.atan2(a.x - q.x, -(a.z - q.z)) - from)))[0];
}

// the player as her, on the real busy lake: she rises at `at` (her nose there, heading `heading`), the swap made
function rig({ storage, at, heading = 0, traffic = () => [], tour = () => null, kayaks = () => null, world = lake() } = {}) {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const sim = createTessie({ seed: 1, depthAt: deep });
  const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage, rpg: true, busy: () => world.L, traffic, tour, kayaks, day: () => '2026-07-04' });
  const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 };
  sim.ambush(at.x, at.z, heading, 0.2); sim.hunt(false);
  for (let k = 0; k < 6 / DT; k++) sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
  P.camera(DT, { pos: [at.x, 3, at.z + 20], target: [at.x, 1, at.z], fov: 55 });
  P.swap.step(DT, { on: true, shown: true, distM: 50 });
  const r = P.become('swap');
  assert.ok(r.ok, JSON.stringify(r));
  const step = (secs, each = null) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      const th = P.threat();
      world.L.post(world.S, DT, world.t, { hour: 13, others: th ? [th] : [] }); world.t += DT;
      sim.step(DT, { playing: true, boat: b0, view: { x: at.x, z: at.z + 40, yaw: 0, hHalf: 0.6 } });
      P.step(DT);
      each?.();
    }
  };
  return { P, sim, world, step, her: () => sim.state.nose };
}

test('the rank tables: Lure 120/150/180/210 m, curious 12/15/18/21 s, every 20 s; Sonar 300/360/420/480 m, marks 8/10/12/14 s, every 25 s (rank 4: 15 s)', () => {
  assert.deepEqual(LURE_RANKS.slice(1).map((r) => [r.rangeM, r.curiousS, r.everyS, r.halcyon]), [[120, 12, 20, false], [150, 15, 20, false], [180, 18, 20, false], [210, 21, 20, true]]);
  assert.deepEqual(SONAR_RANKS.slice(1).map((r) => [r.rangeM, r.markS, r.everyS, r.tail]), [[300, 8, 25, false], [360, 10, 25, false], [420, 12, 25, true], [480, 14, 15, true]]);
  for (const r of [...LURE_RANKS.slice(1), ...SONAR_RANKS.slice(1)]) assert.ok(Math.abs(r.activeS + r.cooldownS - r.everyS) < 1e-9, 'the slot ring: amber then dim, from the press to ready = everyS');
  // the slot rings: a press fires once, then nothing until everyS has passed
  const S = createSkills(RPG_SKILLS_TABLE);
  S.rank('sonar', 4);
  assert.equal(S.press('sonar'), true); assert.equal(S.state('sonar').phase, 'active');
  for (let t = 0; t < 14.9; t += 0.1) S.step(0.1);
  assert.equal(S.press('sonar'), false, 'still cooling at 14.9 s');
  S.step(0.2); assert.equal(S.state('sonar').phase, 'ready'); assert.equal(S.press('sonar'), true);
});

test('the pure rules: who a lure reaches, the curious heading out of the no-go cone, the splashes seeded, the ping and the rim', () => {
  const her = { x: 0, z: 0 }, list = [{ id: 'a', kind: 'sail', x: 100, z: 0 }, { id: 'b', kind: 'sail', x: 0, z: 160 }, { id: 'h', kind: 'halcyon', x: 50, z: 0 }, { id: 'k', kind: 'kayak', x: 0, z: -30 }, { id: 's', kind: 'sup', x: 10, z: 0 }, { id: 'w', kind: 'sail', x: -60, z: 0 }];
  assert.deepEqual(lureTargets(her, list, { rangeM: 120, seen: (id) => id === 'w' }).map((t) => t.id), ['k', 'a'], 'in range, not seen, no Halcyon below rank 4, no paddleboard');
  assert.deepEqual(lureTargets(her, list, { rangeM: 180, halcyon: true }).map((t) => t.id), ['k', 'h', 'w', 'a', 'b']);
  const h = curiousHeading({ x: 0, z: 0, heading: 0 }, { x: 0, z: -100 }, 0);   // the ring dead upwind
  assert.ok(Math.abs(Math.abs(wrap(h)) - LURE.noGoDeg * DEG) < 1e-9, 'into the wind: the cone edge (a close reach toward it)');
  assert.ok(Math.abs(curiousHeading({ x: 0, z: 0 }, { x: 100, z: 0 }, 0) - Math.PI / 2) < 1e-9, 'off the wind: straight at it');
  assert.deepEqual(lureSplashes(5, 5), lureSplashes(5, 5), 'the splashes are seeded (no random)');
  assert.ok(lureSplashes(0, 0).every(([x, z]) => Math.hypot(x, z) <= LURE.splashM));
  const ping = sonarPing(her, list, { rangeM: 120 });
  assert.deepEqual(ping.map((m) => m.id), ['k', 'h', 'w', 'a'], 'every boat within range, nearest first; a paddleboard is no boat');
  const rim = rimMarks({ x: 0, z: 0, psi: 0 }, list, (id) => id === 'a' || id === 'k');
  assert.deepEqual(rim.map((m) => [m.id, Math.round(m.a / DEG)]), [['a', 90], ['k', 0]], 'bearings from her heading (east is 90° on her right; ahead is 0)');
});

test('a busy-lake sailboat lured turns toward the ring within 2 s; with no lure the same boat holds on; the lure ends after its time', () => {
  const run = (lure) => {
    const { L, S, t: t0 } = lake(); let t = t0;
    const b = L.liveBoats[0], q = b.phys.state, at = abeam(q, 100);
    const off0 = offTo(q, at);
    if (lure) assert.ok(L.lure(b.id, { ...at, s: 12 }));
    for (let i = 0; i < 2 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
    return { off0, off2: offTo(q, at), b, L, S, t };
  };
  const lured = run(true), ctl = run(false);
  assert.ok(lured.off0 > 60 * DEG, `the ring starts well off her bow (${(lured.off0 / DEG).toFixed(0)}°)`);
  assert.ok(lured.off2 < lured.off0 - 5 * DEG, `turning toward it within 2 s (${(lured.off0 / DEG).toFixed(0)}° → ${(lured.off2 / DEG).toFixed(0)}°)`);
  assert.ok(ctl.off2 > lured.off2 + 5 * DEG, `the same boat unlured holds her course (${(ctl.off2 / DEG).toFixed(0)}° off vs ${(lured.off2 / DEG).toFixed(0)}°)`);
  let { L, S, t } = lured;
  const q = lured.b.phys.state;
  for (let i = 0; i < 4 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  assert.ok(lured.b.curious, 'still curious at 6 s');
  const off6 = offTo(q, lured.b.curious);
  assert.ok(off6 < lured.off0 - 30 * DEG, `the turn carries on: ${(off6 / DEG).toFixed(0)}° off at 6 s`);
  for (let i = 0; i < 7 / DT; i++) { L.post(S, DT, t, { hour: 13 }); t += DT; }
  assert.equal(lured.b.curious, null, 'curious for 12 s, then her own course again');
});

test('as her, a Lure press: a boat in range turns toward her within 2 s; the free trial is spent; a press while it cools spends nothing', () => {
  const world = lake(), b = world.L.liveBoats[0], q = b.phys.state, at = abeam(q, 100);
  const st = save({ lure: 0 });
  const { P, step, her } = rig({ storage: st, at, heading: Math.atan2(q.x - at.x, -(q.z - at.z)), world });
  step(0.2);
  const n = her(); const off0 = offTo(q, n);
  assert.equal(P.bounty.state().trials.lure, 5);
  assert.equal(P.pressSlot('lure'), 'fire');
  assert.ok(P.stats().log.lure.ids.includes(b.id), `lured: ${JSON.stringify(P.stats().log.lure)}`);
  assert.equal(P.bounty.state().trials.lure, 4, 'a real use: one free try spent');
  assert.equal(P.stats().rpg.lure.phase, 'active', 'the slot ring runs (amber)');
  assert.equal(P.pressSlot('lure'), 'idle', 'cooling: nothing happens');
  assert.equal(P.bounty.state().trials.lure, 4, 'and nothing is spent');
  step(2);
  assert.ok(offTo(q, n) < off0 - 5 * DEG, `the boat turned toward her (${(off0 / DEG).toFixed(0)}° → ${(offTo(q, n) / DEG).toFixed(0)}°)`);
  assert.equal(P.stats().rpg.lure.phase, 'cool');
  step(18.2);
  assert.equal(P.stats().rpg.lure.phase, 'ready', '20 s from the press: ready');
});

test('a boat that saw her is not lured (fleeing); a boat out of range is not; the rank sets the range and the curious time', () => {
  const world = lake(), L = world.L, [b1, b2] = L.liveBoats;
  assert.ok(b1 && b2, 'two boats out');
  const q1 = b1.phys.state, at = abeam(q1, 100);
  const { P, step } = rig({ storage: save({ lure: 1 }), at, world });
  // b2 sails close by her at the surface (she is seen within 60 m), then is laid back 170 m off
  const h = () => P.threat();
  L.lay(b2.id, { x: at.x + 40, z: at.z, heading: 0 }); step(0.3);
  assert.ok(h() && h().seeM >= 60, 'she is at the surface, seen within 60 m');
  L.lay(b2.id, { x: at.x + 110, z: at.z, heading: 0 }); step(0.1);
  assert.equal(P.pressSlot('lure'), 'fire');
  const log = P.stats().log.lure;
  assert.equal(log.rangeM, 120); assert.equal(log.curiousS, 12);
  assert.ok(log.ids.includes(b1.id), 'the boat that has not seen her is lured');
  assert.ok(!log.ids.includes(b2.id), 'the boat that saw her 0.4 s ago is not');
  assert.equal(b2.curious, null);
  assert.ok(b1.curious && b1.curious.until > world.t, 'curious now');
  // rank 3: 180 m and 18 s (a boat 170 m off is lured now; one at 170 m was out of rank 1's 120 m)
  const world3 = lake(), c = world3.L.liveBoats[0], qc = c.phys.state, at3 = abeam(qc, 170);
  const r1 = rig({ storage: save({ lure: 1 }), at: at3, world: world3 }); r1.step(0.1);
  r1.P.pressSlot('lure');
  assert.ok(!r1.P.stats().log.lure.ids.includes(c.id), 'rank 1: 170 m is out of its 120 m');
  const world4 = lake(), c4 = world4.L.liveBoats[0], at4 = abeam(c4.phys.state, 170);
  const r3 = rig({ storage: save({ lure: 3 }), at: at4, world: world4 }); r3.step(0.1);
  const t0 = world4.t;
  r3.P.pressSlot('lure');
  const l3 = r3.P.stats().log.lure;
  assert.equal(l3.rangeM, 180); assert.equal(l3.curiousS, 18);
  assert.ok(l3.ids.includes(c4.id), 'rank 3: 170 m is inside its 180 m');
  assert.ok(Math.abs(c4.curious.until - t0 - 18) < 0.1, `curious for 18 s (${(c4.curious.until - t0).toFixed(2)})`);
});

test('the kayakers turn toward a lure and stop near it; a spooked one does not', () => {
  const START = { x: 1200, z: -1050, heading: 251 * DEG };
  const bt = { ...START, u: 0, v: 0, sog: 0, yawRate: 0 };
  const F = createKayakFleet({ terrain: makeTerrain(), seed: 1, start: START, boat: () => ({ ...bt, x: bt.x + 400 }), heightAt: () => 0, hour: () => 9, wind: () => 1.5 });
  const [it, other] = [...F.live.values()], a = it.a;
  const cam = () => ({ x: a.x, z: a.z + 30, fwdX: 0, fwdZ: -1, hHalf: 0.6 });
  for (let i = 0; i < 30; i++) F.step(DT, cam());
  const p = { x: a.x + Math.sin(a.heading + Math.PI / 2) * 60, z: a.z - Math.cos(a.heading + Math.PI / 2) * 60 };   // 60 m on her beam
  if (other) F.spook(other.a.x + 5, other.a.z, 10);
  F.step(DT, cam());
  const off0 = offTo(a, p);
  const ids = F.lure(p.x, p.z, 120, 15);
  assert.ok(ids.includes(it.slot.id), 'lured');
  if (other) assert.ok(!ids.includes(other.slot.id) || Math.hypot(other.a.x - p.x, other.a.z - p.z) > 120, 'the spooked one is not (it has seen trouble)');
  for (let i = 0; i < 2 / DT; i++) F.step(DT, cam());
  assert.ok(offTo(a, p) < off0 - 5 * DEG, `the bow came round toward it within 2 s (${(off0 / DEG).toFixed(0)}° → ${(offTo(a, p) / DEG).toFixed(0)}°)`);
  for (let i = 0; i < 13 / DT; i++) F.step(DT, cam());
  const d = Math.hypot(a.x - p.x, a.z - p.z);
  assert.ok(d < 60 - 8, `paddled toward it (${d.toFixed(1)} m left of 60)`);
});

test('the glass boat underway turns toward a lure within 2 s, then back to her route; her free paddlers paddle over at a stop', () => {
  const T = createTourBoat({ depthAt: () => 20, hour: 13, seed: 1 });
  T.chase({ stop: 'fannette', holdS: 0, preS: 0 });
  let t = 0;
  for (let i = 0; i < 40 / DT; i++) { T.post(null, DT, t); t += DT; }
  const g = T.boat, p = { x: g.x + Math.sin(g.heading + Math.PI / 2) * 100, z: g.z - Math.cos(g.heading + Math.PI / 2) * 100 };
  const off0 = offTo(g, p), h0 = g.heading;
  assert.ok(T.lure(p.x, p.z, 12));
  for (let i = 0; i < 2 / DT; i++) { T.post(null, DT, t); t += DT; }
  assert.ok(offTo(g, p) < off0 - 8 * DEG, `turned toward it (${(off0 / DEG).toFixed(0)}° → ${(offTo(g, p) / DEG).toFixed(0)}°; heading ${(h0 / DEG).toFixed(0)}° → ${(g.heading / DEG).toFixed(0)}°)`);
  for (let i = 0; i < 12 / DT; i++) { T.post(null, DT, t); t += DT; }
  assert.equal(T.curious, null, 'curious 12 s, then her route');
  // at a stop: the boat holds, a free paddler goes for the ring
  const T2 = createTourBoat({ depthAt: () => 20, hour: 13, seed: 1 });
  let t2 = 0, k = null;
  for (let i = 0; i < 900 / 0.1 && !k; i++) { T2.post(null, 0.1, t2); t2 += 0.1; k = T2.boat.mode === 'stop' && T2.boat.stopLeft > 120 ? T2.kayaks.find((q) => q.free && q.crew) : null; }
  assert.ok(k, 'a paddler out at a stop');
  const q = { x: k.x + 50, z: k.z };
  assert.ok(T2.lure(q.x, q.z, 12, 120));
  assert.ok(Math.hypot(k.goal[0] - q.x, k.goal[1] - q.z) < 15, 'its goal is the ring');
});

test('as her, a Sonar ping marks every boat within range and none beyond; the rank sets the range and the mark time; the boats near hear it', () => {
  const her = { x: 2000, z: 2000 };
  const ring = [[40, 0], [150, 90], [270, 180], [330, 270], [400, 45], [450, 135], [530, 225]];
  const boats = ring.map(([d, a], i) => ({ id: `p${i}`, kind: 'power', x: her.x + Math.sin(a * DEG) * d, z: her.z - Math.cos(a * DEG) * d, heading: 0, L: 6.6, B: 2.4 }));
  const traffic = () => [{ targets: () => boats.map((b) => ({ ...b })), hit: () => false }];
  const world = lake();
  const { P, step } = rig({ storage: save({ lure: 1, sonar: 1 }), at: her, traffic, world });
  step(0.1);
  assert.equal(P.pressSlot('sonar'), 'fire');
  const s1 = P.stats();
  const marked = s1.log.sonar.ids.filter((id) => id.startsWith('p')).sort();
  assert.deepEqual(marked, ['p0', 'p1', 'p2'], 'rank 1: within 300 m (40, 150, 270 m), none beyond (330, 400, 450, 530 m)');
  assert.equal(s1.log.sonar.rangeM, 300); assert.equal(s1.log.sonar.markS, 8);
  assert.deepEqual(s1.rpg.marks.filter((id) => id.startsWith('p')).sort(), marked);
  assert.equal(s1.rpg.ping.rangeM, 300);
  assert.ok(s1.log.sonar.heard.includes('p0') && !s1.log.sonar.heard.includes('p1'), 'the boat 40 m off hears it (the seen tick), the one at 150 m does not');
  step(8.2);
  assert.equal(P.stats().rpg.ping, null, 'the marks last 8 s'); assert.deepEqual(P.stats().rpg.marks, []);
  // rank 4: 480 m, 14 s, every 15 s
  const r4 = rig({ storage: save({ lure: 1, sonar: 4 }), at: her, traffic, world: lake() }); r4.step(0.1);
  r4.P.pressSlot('sonar');
  const s4 = r4.P.stats();
  assert.deepEqual(s4.log.sonar.ids.filter((id) => id.startsWith('p')).sort(), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], 'rank 4: within 480 m');
  assert.equal(s4.log.sonar.markS, 14); assert.equal(s4.rpg.ping.tail, true, 'rank 3 and up: a heading tail per ring');
  r4.step(13.8); assert.ok(r4.P.stats().rpg.ping, 'still marked at 13.9 s');
  r4.step(1.3); assert.equal(r4.P.pressSlot('sonar'), 'fire', 'ready again 15 s from the press');
});

test('a free Sonar trial: spent on a real ping only (not while cooling); at 0 the slot is locked and the press does nothing', () => {
  const her = { x: 2000, z: 2000 };
  const st = save({ lure: 1, sonar: 0 }, { lure: 5, sonar: 2, surge: 5, breach: 5 });
  const { P, step } = rig({ storage: st, at: her, world: lake() });
  step(0.1);
  assert.equal(P.pressSlot('sonar'), 'fire'); assert.equal(P.bounty.state().trials.sonar, 1);
  assert.equal(P.pressSlot('sonar'), 'idle'); assert.equal(P.bounty.state().trials.sonar, 1, 'cooling: none spent');
  step(25.1);
  assert.equal(P.pressSlot('sonar'), 'fire'); assert.equal(P.bounty.state().trials.sonar, 0);
  step(25.1);
  assert.equal(P.pressSlot('sonar'), 'idle', 'no trials left: locked'); assert.equal(P.bounty.state().trials.sonar, 0);
  assert.ok(SONAR.hearM === 60);
});

test('rank 4 also lures the Halcyon: her skipper turns toward the ring instead of fleeing, then flees again', () => {
  const world = lake();
  const probe = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample: () => ({ vx: 0, vz: 0 }) }, headless: true });
  const at = { x: probe.state.x + 150, z: probe.state.z };
  const r1 = rig({ storage: save({ lure: 3 }), at, world });
  r1.step(0.1); r1.P.pressSlot('lure');
  assert.ok(!r1.P.stats().log.lure.ids.includes('halcyon'), 'rank 3: the skipper keeps fleeing');
  const r4 = rig({ storage: save({ lure: 4 }), at, world: lake() });
  r4.step(0.1); r4.P.pressSlot('lure');
  assert.ok(r4.P.stats().log.lure.ids.includes('halcyon'), `rank 4: the Halcyon is lured (${JSON.stringify(r4.P.stats().log.lure)})`);
  assert.equal(r4.P.stats().rpg.halcyonLure, true);
  r4.step(21.2);
  assert.equal(r4.P.stats().rpg.halcyonLure, false, 'curious 21 s, then the flee again');
});
