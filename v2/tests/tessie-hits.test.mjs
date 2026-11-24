// Play as Tessie, phase 1b (§ 4.2): the aim, the hit and the knockdown rules on the lake's real hulls. Behaviour only.
//   the corners: the nearest boat in a 40° cone within 60 m; a kayak or a boat at anchor is never a target; a knocked boat has 45 s grace
//   the fall: her front 9 m within 2.5 m of the hull is a hit, on the side she landed; a kayak is only spooked (never a hit)
//   a busy-lake sailboat knocked: it goes over past 55° on its own physics, rights itself, sails on after 12 s of sheets let fly
//   the glass boat knocked: heels to 50°, upright again within 9 s
//   a kayaker splashed: wary, paddling away (back strokes, then a cruise: never a sprint), never rolled over
//   she never enters the hull she lunges at (the sim's hold), and the system costs under 0.3 ms a frame with 6 boats
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTessieHits, HITS, hullDist } from '../sim/tessieHits.js';
import { createBusyLake } from '../living/busyLake.js';
import { createTourBoat, knockHeel } from '../sim/tourBoat.js';
import { createKayakFleet } from '../sim/kayaks.js';
import { makeTerrain } from './helpers/ground.mjs';
import { steadyWind } from '../../src/sim/boat.js';
import { createTessie, reachAt } from '../sim/tessie.js';
import { createTessiePlay } from '../sim/tessiePlay.js';
import { CLEAR } from '../sim/tessieClear.js';
import { birthplaceRows } from '../sim/regions.js';

const DEG = Math.PI / 180;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)
const boat = (id, kind, x, z, heading = 0) => ({ id, kind, x, z, heading, L: kind === 'glass' ? 12.2 : kind === 'kayak' ? 3.4 : 8.5, B: kind === 'glass' ? 3.8 : kind === 'kayak' ? 0.85 : 3 });

test('the corners: the nearest target in the cone; kayaks and moored boats never; grace after a knockdown', () => {
  const H = createTessieHits(), n = { x: 0, z: 0, psi: 0 };
  const list = [boat('k', 'kayak', 0, -15), boat('m', 'still', 0, -20), boat('s', 'sail', 2, -40, Math.PI / 2), boat('far', 'sail', 0, -80), boat('side', 'sail', 40, -10)];
  const a = H.aim(n, list, 0);
  assert.equal(a?.id, 's'); assert.equal(a.inReach, false);
  assert.ok(Math.abs(a.d - (40 - 1.5)) < 0.6, `its distance from the hull (${a.d})`);
  assert.equal(H.aim(n, [boat('k', 'kayak', 0, -5)], 0), null, 'a kayak: no corners');
  assert.equal(H.aim({ ...n, z: -30 }, list, 0).inReach, true, 'inside 12 m: amber');
  const f = H.fall({ x: 0, z: -40 + 3.6, psi: 0 }, list, 10);
  assert.equal(f.hit?.id, 's');
  assert.ok(H.grace('s', 10 + 44) && !H.grace('s', 10 + 46), '45 s of grace');
  assert.equal(H.aim(n, list, 20)?.id ?? null, null, 'in its grace: no target (the far one is out of range)');
  assert.equal(H.count, 1);
});

test('the fall: within 2.5 m of the hull a hit, on her side; a kayak is only spooked', () => {
  const H = createTessieHits();
  const s = boat('s', 'sail', 0, 0, 0);   // bow to −z: starboard is +x
  assert.equal(H.fall({ x: 6, z: 0, psi: -Math.PI / 2 }, [s], 0).hit?.id, 's', 'her front reaches it from 6 m off its beam');
  const H2 = createTessieHits();
  const r = H2.fall({ x: 3.5, z: 0, psi: 0 }, [s], 0);
  assert.equal(r.hit?.id, 's'); assert.equal(r.side, 1, 'landed on the starboard rail: she heels to starboard');
  assert.equal(createTessieHits().fall({ x: -3.5, z: 0, psi: 0 }, [s], 0).side, -1);
  assert.equal(createTessieHits().fall({ x: 12, z: 0, psi: 0 }, [s], 0).hit, null, 'a miss');
  const k = createTessieHits().fall({ x: 0, z: 0, psi: 0 }, [boat('k', 'kayak', 1, 0)], 0);
  assert.equal(k.hit, null, 'a kayak is never knocked down'); assert.deepEqual(k.spooked, ['k']);
  assert.deepEqual(createTessieHits().splash(0, 0, [boat('k1', 'kayak', 15, 0), boat('k2', 'kayak', 25, 0)]), ['k1']);
  assert.ok(hullDist(0, 0, s) < 0);
});

test('a busy-lake sailboat knocked down stays capsized: on her side and drifting while seen, even after 2 minutes; she rights only out of the eye\'s view after 90 s', () => {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: () => 40, windAt: steadyWind(6, 225), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0; const dt = 1 / 30;
  for (let i = 0; i < 30; i++) { L.post(S, dt, t, { hour: 13 }); t += dt; }
  const b = L.liveBoats[0]; assert.ok(b, 'a boat out');
  const H = createTessieHits();
  assert.ok(L.knock(b.id, { K: H.rollK(b.phys.P, 1), t }));
  // the eye 60 m off, looking at her
  const look = () => { const q = b.phys.state; return { eye: [q.x - 60, 3, q.z], fwd: [1, 0, 0], hour: 13 }; };
  let minAfter = Infinity; const x0 = b.phys.state.x, z0 = b.phys.state.z;
  for (let i = 0; i < 30 * 30; i++) { L.post(S, dt, t, look()); t += dt; if (i > 30 * 3) minAfter = Math.min(minAfter, Math.abs(b.phys.state.heel)); }
  assert.ok(b.knock?.capsized, 'over: capsized');
  assert.ok(minAfter > 75 * DEG, `still on her side 30 s on, in view (least heel after 3 s: ${(minAfter / DEG).toFixed(0)}°)`);
  const drift = Math.hypot(b.phys.state.x - x0, b.phys.state.z - z0);
  assert.ok(drift > 1 && drift < 12, `drifting slowly with the wind (${drift.toFixed(1)} m in 30 s)`);
  for (let i = 0; i < 30 * 90; i++) { L.post(S, dt, t, look()); t += dt; }
  assert.ok(b.knock?.capsized && Math.abs(b.phys.state.heel) > 75 * DEG, '2 minutes on, still capsized while the eye sees her');
  // the eye turns away: she rights out of view and sails on
  L.post(S, dt, t, { eye: look().eye, fwd: [-1, 0, 0], hour: 13 }); t += dt;
  assert.equal(b.knock, null, 'out of view after 90 s: righted');
  for (let i = 0; i < 30 * 20; i++) { L.post(S, dt, t, { eye: look().eye, fwd: [-1, 0, 0], hour: 13 }); t += dt; }
  assert.ok(Math.abs(b.phys.state.heel) < 30 * DEG && b.phys.state.u > 0.5, `sailing on (${b.phys.state.u.toFixed(2)} m/s)`);
  assert.equal(L.stats.righted, 1);
});

test('a capsized boat out of view before 90 s stays down', () => {
  const L = createBusyLake({ seed: 1, birthplaces: BIRTHPLACES, depthAt: () => 40, windAt: steadyWind(6, 225), tier: 'full', starts: [] });
  const S = { x: 460, z: -50, heading: 0, u: 0, v: 0, yawRate: 0 };
  let t = 0; const dt = 1 / 30;
  for (let i = 0; i < 30; i++) { L.post(S, dt, t, { hour: 13 }); t += dt; }
  const b = L.liveBoats[0];
  L.knock(b.id, { K: createTessieHits().rollK(b.phys.P, -1), t });
  for (let i = 0; i < 30 * 60; i++) { L.post(S, dt, t, { eye: [0, 3, 3000], fwd: [0, 0, 1], hour: 13 }); t += dt; }
  assert.ok(b.knock?.capsized, 'a minute on, far away: still capsized (90 s first)');
});

test('the glass boat knocked: over to 50°, upright again within 9 s', () => {
  const T = createTourBoat({ depthAt: () => 20, hour: 13, seed: 1 });
  T.knock(-1);
  let max = 0, t = 0;
  for (let i = 0; i < 60 * 12; i++) { T.post(null, 1 / 60, t); t += 1 / 60; max = Math.max(max, Math.abs(T.boat.heel)); if (t > 9.05) assert.ok(Math.abs(T.boat.heel) < 1 * DEG, `upright at ${t.toFixed(1)} s`); }
  assert.ok(Math.abs(max - 50 * DEG) < 1 * DEG, `${(max / DEG).toFixed(1)}°`);
  assert.equal(knockHeel(0.5, 1) > 0, true); assert.equal(T.knocked, false);
});

test('a kayaker splashed: wary and paddling away (never a sprint), never rolled over', () => {
  const START = { x: 1200, z: -1050, heading: 251 * DEG };
  const bt = { ...START, u: 0, v: 0, sog: 0, yawRate: 0 };
  const F = createKayakFleet({ terrain: makeTerrain(), seed: 1, start: START, boat: () => ({ ...bt, x: bt.x + 400 }), heightAt: () => 0, hour: () => 9, wind: () => 1.5 });
  const it = [...F.live.values()][0], a = it.a;
  const x0 = a.x, z0 = a.z;
  const sx = a.x + 6, sz = a.z;
  F.spook(sx, sz, 20);
  let maxRoll = 0, caps = 0;
  let d7 = null, vMax = 0;
  for (let i = 0; i < 30 * 10; i++) { F.step(1 / 30, { x: a.x, z: a.z + 30, fwdX: 0, fwdZ: -1, hHalf: 0.6 }); maxRoll = Math.max(maxRoll, Math.abs(it.R.phi)); caps += it.R.capsizes ?? 0; if (i === 30 * 7) d7 = Math.hypot(a.x - sx, a.z - sz); if (i > 15) vMax = Math.max(vMax, Math.abs(a.v)); }
  assert.equal(F.spooked >= 1, true);
  assert.ok(it.wary > 0, 'wary');
  assert.ok(maxRoll < 20 * DEG && !caps, `never tipped (roll ${(maxRoll / DEG).toFixed(1)}°)`);
  const gain = Math.hypot(a.x - sx, a.z - sz) - 6;
  // round B (owner, 2026-11-21: natural strokes, never a sprint): back strokes off the splash, then the bow round and a cruise away
  assert.ok(gain > 1.5, `paddled away from the splash (+${gain.toFixed(1)} m)`);
  assert.ok(Math.hypot(a.x - sx, a.z - sz) > d7 + 1, 'still opening the gap at the end');
  assert.ok(vMax < 1.6, `never a sprint (${vMax.toFixed(2)} m/s; the sprint gait is 2.0)`);
  assert.ok(Math.hypot(a.x - x0, a.z - z0) / 10 < 2.5, 'at a paddler\'s pace');
});

test('the lunge at a boat: she never enters its hull; the system under 0.3 ms with 6 boats', () => {
  const sim = createTessie({ seed: 4, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 });
  const b = { x: 0, z: -40, heading: Math.PI / 2, speed: 0, heel: 0, pitch: 0, heave: 0, boomAngle: 0, jibAngle: 0 };
  C.begin({ x: 0, z: 0, heading: 0 });
  let least = Infinity;
  const tg = { id: 'b', kind: 'sail', x: b.x, z: b.z, heading: b.heading, d: 30 };
  for (let i = 0; i < 30 * 14; i++) {
    sim.step(1 / 30, { playing: true, boat: b });
    C.step(1 / 30, { move: [0, 1], lunge: i > 30 * 4 && i < 30 * 4 + 3 }, { target: { ...tg, d: Math.hypot(sim.state.nose.x - b.x, sim.state.nose.z - b.z) } });
    if (Number.isFinite(sim.state.clear)) least = Math.min(least, sim.state.clear);
  }
  assert.ok(least >= CLEAR.margin - 0.02, `her least gap to the hull ${least.toFixed(3)} m`);
  // the cost: the aim, a fall and the hold-off for 6 boats and 3 kayaks, many frames
  const H = createTessieHits(), list = [];
  for (let i = 0; i < 6; i++) list.push(boat(`s${i}`, i === 5 ? 'glass' : 'sail', i * 15, -20 - i * 5, i));
  for (let i = 0; i < 3; i++) list.push(boat(`k${i}`, 'kayak', -10 + i * 4, -8, i));
  const spine = sim.state.spine.slice(), N = 2000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { H.aim({ x: 0, z: 0, psi: 0 }, list, i); H.splash(0, -5, list); H.holdOff(spine, 19, list, (s) => reachAt(s, 19)); if (i % 60 === 0) H.fall({ x: 0, z: -10, psi: 0 }, list, -1e9); }
  const ms = (performance.now() - t0) / N;
  assert.ok(ms < 0.3, `${ms.toFixed(4)} ms a frame`);
});

test('the hold-off: her spine is pushed out of a kayak near the surface, never deep', () => {
  const H = createTessieHits(), spine = new Float32Array(64 * 8);
  for (let i = 0; i < 64; i++) { spine[i * 8] = 0.3; spine[i * 8 + 1] = -0.5; spine[i * 8 + 2] = -i * 0.3; }
  H.holdOff(spine, 19, [boat('k', 'kayak', 0, -5, 0)], () => 0.6);
  for (let i = 0; i < 64; i++) { const dx = spine[i * 8], dz = spine[i * 8 + 2] + 5; assert.ok((dz / (HITS.kayakR[0] + 0.6)) ** 2 + (dx / (HITS.kayakR[1] + 0.6)) ** 2 >= 0.999, `frame ${i}`); }
  const deep = new Float32Array(8); deep[0] = 0; deep[1] = -4; deep[2] = -5;
  H.holdOff(deep, 0, [boat('k', 'kayak', 0, -5, 0)], () => 0.6);
  assert.equal(deep[0], 0, 'deep: under it');
});
