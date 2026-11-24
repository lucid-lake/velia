// The slow half of v2/tests/regatta-places-2.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): Glass Boat Chase, Storm Run and Lights on the Lake sailed to the finish (the fast suite keeps their engine tests: the glass boat's start and catch line, the storm at the gun, the show's hour).
// Regatta's place races, phase 2 (4.4, 4.6, 4.7, 4.8; owner go 2026-11-19 with every default): the registry's new
// rows, Glass Boat Chase (the glass boat held at her stop, her wash, the catch), Storm Run (the storm at the gun, the gust band, a rival
// knocked down), Lights on the Lake (the show's hour), the hunts (the corners' rules, the store, the counts), Sail the cup (the series'
// points), the rivals' Tea House shortcut (and the shelf's grounding), the camera's look toward Tessie (bounded, smooth, returns, none
// under Reduce Motion); the new races sailed to the finish on the real BoatPhysics by the scripted sailor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, steadyWind } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { makeTerrain } from '../helpers/ground.mjs';
import { listCups, raceInfo, placeCourse, placeHand, hasFrom, cupAt, CUPS } from '../../sim/racePlaces.js';
import { createRegattaSession, SHORTCUT, AGROUND } from '../../regatta/session.js';
import { FleetRival, skillFor } from '../../regatta/fleet.js';
import { washAt, createChaseWatch, createWashTrail, WASH } from '../../regatta/glassChase.js';
import { stormPlan, rivalKnockDue, STORM_RUN } from '../../regatta/stormRun.js';
import { createTessieLook, LOOK } from '../../regatta/tessieLook.js';
import { createHunts, HUNTS, huntCounts, loadHunts, HUNTS_KEY } from '../../regatta/hunts.js';
import { newPlaceCup, recordPlaceRace, placeCupState, placesOf, PLACE_CUP } from '../../regatta/placeCup.js';
import { createTourBoat } from '../../sim/tourBoat.js';
import { createRegatta } from '../../regatta/index.js';
import { createBoatSim, waterFor } from '../../sim/boat.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const T = makeTerrain({ seed: 1 }), depthAt = (x, z) => -T.heightAt(x, z);

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

test('Glass Boat Chase: sailed to the Boat Camp buoy with Velia Travel leaving at the gun and her wash on; the player catches her', () => {
  const G = createTourBoat({ depthAt, hour: 15, seed: 1 }), WT = createWashTrail();
  let laid = false, caught = null;
  const W = createChaseWatch();
  const { S, ev } = sail('glass-boat-chase', { dir: 200, maxS: 1200, each: (S2, t, phys) => {
    if (!laid) { laid = true; G.chase({ stop: 'fannette', preS: 8 }); S2.wash = (x, z) => washAt(WT.pts, x, z); }   // as the race: her head start, her wash
    G.post({ x: phys.state.x, z: phys.state.z, heading: phys.state.heading, u: phys.state.u }, DT, t); WT.step(G.boat, DT);
    if (W.step({ me: phys.state, glass: G.boat, finish: S2.course.finish.centre, clock: S2.race.clock }) === 'caught') caught = S2.race.clock;
  } });
  const me = S.race.view('me');
  assert.equal(me.status, 'finished', JSON.stringify(me));
  assert.deepEqual(ev.filter((e) => e.type === 'rounded' && e.id === 'me').map((e) => e.mark), ['M1']);
  assert.ok(me.finishedAt > 90 && me.finishedAt < 700, `${me.finishedAt} s`);
  assert.ok(caught != null && caught > 0, `the player caught her (${caught})`);
  assert.ok(Object.values(S.stats.washS).some((s) => s > 0), `someone sailed in her wash: ${JSON.stringify(S.stats.washS)}`);
});

test('Storm Run: the arc at the gun over the course, the gust band let through, a rival\'s knockdown seeded and once; sailed to the mouth', () => {
  const c = placeCourse('storm-run', 200), plan = stormPlan(c);
  assert.equal(plan.s0, 0); assert.equal(plan.rate, STORM_RUN.rate);
  assert.ok(Math.hypot(plan.ref[0] - 1840, plan.ref[1] + 1415) < 20, `the cell over the last leg: ${plan.ref}`);
  assert.ok(STORM_RUN.band.hi > 2, 'the squall\'s gusts are not clipped');
  const ids = ['wren', 'tern', 'kestrel', 'heron', 'plover'];
  assert.ok(ids.every((id) => !rivalKnockDue({ id, windMs: 6, seed: 4 })), 'no knock in ordinary wind');
  const hit = ids.filter((id) => rivalKnockDue({ id, windMs: 12, seed: 4 }));
  assert.ok(hit.length >= 1 && hit.length < ids.length, `some rivals, not all: ${hit}`);
  assert.deepEqual(ids.filter((id) => rivalKnockDue({ id, windMs: 12, seed: 4 })), hit, 'seeded');
  assert.equal(rivalKnockDue({ id: hit[0], windMs: 12, seed: 4, done: true }), false, 'once each');
  const { S, ev } = sail('storm-run', { dir: 200, rivals: 2 });
  assert.equal(S.race.view('me').status, 'finished');
  assert.deepEqual(ev.filter((e) => e.type === 'rounded' && e.id === 'me').map((e) => e.mark), ['M1']);
});

test('Lights on the Lake: sailed out round the barges\' mark and home to the mouth at night\'s wind', () => {
  const { S, ev } = sail('lights-on-the-lake', { dir: 15, speedMs: 5, maxS: 1400, rivals: 2 });
  const me = S.race.view('me');
  assert.equal(me.status, 'finished', JSON.stringify(me));
  assert.deepEqual(ev.filter((e) => e.type === 'rounded' && e.id === 'me').map((e) => e.mark), ['M1']);
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

