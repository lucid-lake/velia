// Regatta's place races, phase 2 (4.4, 4.6, 4.7, 4.8; owner go 2026-11-19 with every default): the registry's new
// rows, Glass Boat Chase (the glass boat held at her stop, her wash, the catch), Storm Run (the storm at the gun, the gust band, a rival
// knocked down), Lights on the Lake (the show's hour), the hunts (the corners' rules, the store, the counts), Sail the cup (the series'
// points), the rivals' Tea House shortcut (and the shelf's grounding), the camera's look toward Tessie (bounded, smooth, returns, none
// under Reduce Motion); the new races sailed to the finish on the real BoatPhysics by the scripted sailor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { makeTerrain } from './helpers/ground.mjs';
import { listCups, raceInfo, placeCourse, placeHand, hasFrom, cupAt, CUPS } from '../sim/racePlaces.js';
import { createRegattaSession, SHORTCUT, AGROUND } from '../regatta/session.js';
import { FleetRival, skillFor } from '../regatta/fleet.js';
import { washAt, createChaseWatch, createWashTrail, WASH } from '../regatta/glassChase.js';
import { stormPlan, rivalKnockDue, STORM_RUN } from '../regatta/stormRun.js';
import { createTessieLook, LOOK } from '../regatta/tessieLook.js';
import { createHunts, HUNTS, huntCounts, loadHunts, HUNTS_KEY } from '../regatta/hunts.js';
import { newPlaceCup, recordPlaceRace, placeCupState, placesOf, PLACE_CUP } from '../regatta/placeCup.js';
import { createTourBoat } from '../sim/tourBoat.js';
import { createRegatta } from '../regatta/index.js';
import { createBoatSim, waterFor } from '../sim/boat.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const T = makeTerrain({ seed: 1 }), depthAt = (x, z) => -T.heightAt(x, z);

test('registry: the six races in their cups, each cup with its hunt; phones skip Glass Boat Chase and Storm Run; the hub opens on the boat\'s cup', () => {
  const cups = listCups({ store: mem(), hunts: huntCounts({ falls: '2026-11-20', round: '2026-11-20', ball: '' }) });
  assert.deepEqual(cups.map((c) => [c.id, c.races.map((r) => r.id), c.hunt.id, c.hunt.found, c.hunt.of]), [
    ['emerald-bay', ['tea-house-run', 'tessies-deep', 'glass-boat-chase'], 'chart-the-bay', 3, 8],
    ['the-mouth', ['pass-the-channel', 'storm-run', 'lights-on-the-lake'], 'chart-the-mouth', 0, 8]]);
  const g = raceInfo('glass-boat-chase'), s = raceInfo('storm-run'), l = raceInfo('lights-on-the-lake');
  assert.deepEqual([g.hour, g.rivals, g.hooks], [15, 2, ['glass']]);
  assert.deepEqual([s.hour, s.rivals, s.hooks], [15, 4, ['storm']]);
  assert.deepEqual([l.hour, l.rivals, l.hooks], [21 + 42 / 60, 5, ['show']]);
  assert.ok(l.lengthM > 900 && l.lengthM < 1000, `the finale about 1 km: ${l.lengthM}`);
  // the device: a phone's features (features.js) leave Lights on the Lake on (lit, no show), the chase and the storm off
  const phone = hasFrom((n) => ({ tier: n === 'glassBoat' ? 'off' : 'off', on: false }));
  const desk = hasFrom((n) => ({ tier: n === 'glassBoat' ? 'lite' : 'on', on: n !== 'glassBoat' }));
  const avail = (has) => listCups({ has }).flatMap((c) => c.races.filter((r) => r.available).map((r) => r.id));
  assert.deepEqual(avail(phone), ['tea-house-run', 'pass-the-channel', 'lights-on-the-lake']);
  assert.equal(avail(desk).length, 6, 'a lite glass boat still runs the chase');
  // the hub opens on the cup of the area the boat is in
  assert.equal(cupAt(0, 0), 'emerald-bay'); assert.equal(cupAt(-549, 217), 'emerald-bay'); assert.equal(cupAt(1500, -1150), 'the-mouth'); assert.equal(cupAt(2300, -1400), 'the-mouth');
  // a cup series' fixed fleet
  assert.equal(placeHand('glass-boat-chase', {}, { rivals: PLACE_CUP.rivals }).rivals, 4); assert.equal(placeHand('glass-boat-chase', {}).rivals, 2);
  assert.equal(placeHand('lights-on-the-lake', {}).sky, 'clear', 'the finale under a clear night');
});

// a place race sailed to the finish (as regatta-places.test.mjs's sail): the player under the fleet's own mind, rivals on the same physics;
// each(S, t) runs every tick (the glass boat's post, the hazard)
function sail(id, { dir, speedMs = 6, tier = 'hard', maxS = 900, each = null, rivals = null, seed = 3, helper = false } = {}) {
  const course = placeCourse(id, dir);
  const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 }), ctl = { ...CONTROLS };
  const S = createRegattaSession({ course, me: { phys }, rivals: rivals ?? raceInfo(id).rivals, windAt, depthAt, seed, pace: 2, helper, round: 'club', tier: 'medium', onPlace: (p) => Object.assign(phys, new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed })) });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const env = { t: 0, windAt: S.meWind };
  const auto = new FleetRival({ course, tier, skill: skillFor(tier, 'tern'), seed: 11, windAt: S.meWind, vessel: phys.vessel });
  const ev = [];
  let t = 0;
  for (; t < maxS; t += DT) {
    const v = S.race.view('me');
    if (S.helper) S.helperTick(ctl, t); else auto.update(DT, phys.state, ctl, { t, clock: S.race.clock, view: v, line: course.line });
    env.t = t; phys.step(DT, ctl, env);
    each?.(S, t, phys);
    S.advanceTo(t + DT);
    ev.push(...S.drain());
    if (v.status === 'finished') break;
  }
  return { S, ev, course, phys };
}

test('Glass Boat Chase: she lies at her Fannette stop through the countdown, then leaves on her route; her wash slows a boat in it', () => {
  const G = createTourBoat({ depthAt, hour: 15, seed: 1 });
  G.chase({ stop: 'fannette', holdS: 8 });
  assert.deepEqual([Math.round(G.boat.x), Math.round(G.boat.z), G.boat.v], [-140, 60, 0]);
  for (let t = 0; t < 7.9; t += DT) G.post(null, DT, t);
  assert.ok(Math.hypot(G.boat.x + 140, G.boat.z - 60) < 0.5 && G.boat.v === 0, 'held at her stop until the gun');
  for (let t = 8; t < 70; t += DT) G.post(null, DT, t);
  assert.ok(G.boat.v > 1.5 && G.boat.v < 2.4, `away at the bay's 4 kn: ${G.boat.v.toFixed(2)} m/s`);
  assert.ok(Math.hypot(G.boat.x + 140, G.boat.z - 60) > 60, 'she has left her stop');
  assert.ok(G.kayaks.every((k) => !k.free), 'her kayaks towed');
  assert.ok(G.wake.length > 10, 'her wake laid');
  // the wash: her stern's record (createWashTrail), deep right astern of her, still felt a little half a minute back, nothing well abeam
  const WT = createWashTrail(), G2 = createTourBoat({ depthAt, hour: 15, seed: 1 }); G2.chase({ stop: 'fannette' });
  for (let t = 0; t < 90; t += DT) { G2.post(null, DT, t); WT.step(G2.boat, DT); }
  const fx = Math.sin(G2.boat.heading), fz = -Math.cos(G2.boat.heading), a5 = WT.pts.find((p) => p.age > 5), a30 = WT.pts.find((p) => p.age > 30);
  assert.ok(washAt(WT.pts, a5.x, a5.z) > 0.6, 'in her wash right astern');
  assert.ok(washAt(WT.pts, a30.x, a30.z) > 0.2 && washAt(WT.pts, a30.x, a30.z) < washAt(WT.pts, a5.x, a5.z), 'fading half a minute back');
  assert.equal(washAt(WT.pts, G2.boat.x - fz * 40, G2.boat.z + fx * 40), 0, 'clear 40 m abeam');
  assert.ok(WT.pts.every((p) => p.age <= WASH.keepS), 'kept a minute');
  assert.equal(washAt([], 0, 0), 0);
  // a boat sailing in her wash loses way against the same boat beside it (the session's drag on u)
  const run = (inWash) => {
    const p = new BoatPhysics({ x: 0, z: 0, heading: Math.PI / 2, speed: 3 }), c = { ...CONTROLS }, env = { t: 0, windAt: steadyWind(5, 0) };
    for (let t = 0; t < 30; t += DT) { env.t = t; p.step(DT, c, env); if (inWash) p.state.u *= 1 - WASH.dragK * 1 * DT; }
    return p.state.u;
  };
  assert.ok(run(true) < run(false) - 0.15, `the wash costs way: ${run(true).toFixed(2)} vs ${run(false).toFixed(2)} m/s`);
  // the catch: once nearer the finish than she is (after the gun), once
  const W = createChaseWatch(), fin = [430, -540];
  assert.equal(W.step({ me: { x: -190, z: 100 }, glass: { x: -140, z: 60 }, finish: fin, clock: -2 }), null);
  assert.equal(W.step({ me: { x: -150, z: 70 }, glass: { x: -100, z: 0 }, finish: fin, clock: 10 }), null);
  assert.equal(W.step({ me: { x: 0, z: -200 }, glass: { x: -20, z: -150 }, finish: fin, clock: 60 }), 'caught');
  assert.equal(W.caughtAt, 60); assert.equal(W.step({ me: { x: 10, z: -210 }, glass: { x: 0, z: 0 }, finish: fin, clock: 61 }), null);
});

// ---- the engine in node (regatta-places.test.mjs's engine): the page's hooks called by the race ----
function engine({ dir = 200, flags = {}, storm = null, glass = null, tessie = null, has = null, reduced = false, store = mem() } = {}) {
  const wind = { pattern: null, base: { dirDeg: dir, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', autoplay: '1', autotier: 'hard', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true,
    onSalute: () => true, tessie: () => tessie, glassBoat: () => glass, onStorm: (o) => storm?.(o) ?? false, has, reduced: () => reduced });
  return { R, B, hour: () => hour };
}
const sailTo = (R, f, maxS = 700, each = null) => { for (let s = 0; s < maxS && !f(); s += 2) { R.settle(2); each?.(); } return f(); };

test('engine: Storm Run starts the page\'s storm once at the gun (and stops it on leaving); Lights on the Lake runs at 21:42 with the show let in', async () => {
  const calls = [];
  const { R } = engine({ storm: (o) => { calls.push(o); return true; } });
  await R.enter({ hub: true, deal: true });
  R.racePlace('storm-run');
  assert.ok(R.stormRace); assert.equal(R.showRace, false);
  assert.equal(calls.filter(Boolean).length, 0, 'not before the gun');
  assert.ok(sailTo(R, () => R.state().clock > 2, 60));
  assert.equal(calls.filter(Boolean).length, 1); assert.deepEqual(calls.find(Boolean), stormPlan(R.course));
  assert.equal(R.stats.storm.shown, true);
  R.settle(4); assert.equal(calls.filter(Boolean).length, 1, 'once');
  R.restart(); assert.equal(calls.at(-1), null, 'a restart sends the squall away; it builds again at the gun');
  assert.ok(sailTo(R, () => R.state().clock > 2, 60)); assert.equal(calls.filter(Boolean).length, 2);
  R.quit(); assert.equal(calls.at(-1), null, 'leaving the race stops the storm');
  const L = engine({ dir: 15 });
  await L.R.enter({ hub: true, deal: true });
  L.R.racePlace('lights-on-the-lake');
  assert.ok(Math.abs((L.hour() % 24) - (21 + 42 / 60)) < 1e-6, 'the gun at 21:42: the show (21:44) two minutes in');
  assert.equal(L.R.showRace, true); assert.equal(L.R.session.rivals.length, 5);
});

test('engine: Glass Boat Chase starts the glass boat from her Fannette stop with her head start and turns her wash on; the card names the catch', async () => {
  const G = createTourBoat({ depthAt, hour: 15, seed: 1 });
  const { R, B } = engine({ glass: G });
  await R.enter({ hub: true, deal: true });
  R.racePlace('glass-boat-chase');
  assert.ok(R.glassRace); assert.equal(R.glass, G);
  const d0 = Math.hypot(G.boat.x + 140, G.boat.z - 60);
  assert.ok(G.boat.mode === 'run' && G.boat.v > 0.5 && d0 > 1 && d0 < 60, `she left her Fannette stop just before the countdown: under way (${G.boat.v.toFixed(2)} m/s, ${d0.toFixed(0)} m on)`);
  assert.equal(typeof R.session.wash, 'function');
  let t = 0;
  assert.ok(sailTo(R, () => !!R.stats.result, 900, () => { for (let i = 0; i < 120; i++) { G.post({ x: B.phys.state.x, z: B.phys.state.z, heading: B.phys.state.heading, u: B.phys.state.u }, DT, t); t += DT; } }), JSON.stringify(R.state().me));
  assert.match(R.stats.result.gap ?? '', /Velia Travel/, 'the results card says whether she was caught');
  // a phone: no glass boat, the race is not offered (the hub hides it) and the registry says so
  const P2 = engine({ has: (f) => f !== 'glassBoat' && f !== 'storm' && f !== 'tessie' });
  await P2.R.enter({ hub: true, deal: true });
  assert.deepEqual(P2.R.hand && listCups({ has: (f) => f !== 'glassBoat' && f !== 'storm' && f !== 'tessie' })[0].races.filter((r) => r.available).map((r) => r.id), ['tea-house-run']);
});

