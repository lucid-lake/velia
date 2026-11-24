// The slow half of v2/tests/regatta-places.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): Pass the Channel sailed in node to the finish (the fast suite keeps the engine's run of it to the finish, the salute once); Tea House Run sailed to the finish (the fast suite keeps its course and shelf tests and Tessie's Deep sailed to the finish).
// Regatta's place races (owner go 2026-11-19): the registry the hub reads, the pinned courses (their water),
// the gates' order and side, the race knockdown (12 s, a second one DNF), the salute's trigger and script, Tessie's race director,
// and both races sailed to the finish on the real BoatPhysics by a scripted sailor (the fleet's own mind at the helm).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { makeTerrain } from '../helpers/ground.mjs';
import { createRace } from '../../../src/sim/race/rules.js';
import { CUPS, PLACE_RACES, listCups, raceInfo, isPlace, placeCourse, placeHand, recordPlace, loadPlaces, PLACES_KEY } from '../../sim/racePlaces.js';
import { gateDir, gateCross, placeTrackerFor } from '../../regatta/placeTracker.js';
import { createKnocks, KNOCK } from '../../regatta/knocks.js';
import { saluteDue, saluteShow, SALUTE } from '../../regatta/salute.js';
import { createTessieDeep, pickTarget, strikeSpot, avoidAdvice, DEEP } from '../../regatta/tessieDeep.js';
import { createRegattaSession, placeLane } from '../../regatta/session.js';
import { FleetRival, skillFor } from '../../regatta/fleet.js';
import { areaOf } from '../../stage/areas.js';
import { gameShow } from '../../sim/fireworks.js';
import { dealHand, DEFAULT_SETUP, COURSES, customHand } from '../../regatta/setup.js';
import { dealEvent } from '../../regatta/events.js';
import { rng } from '../../regatta/setup.js';
import { steadyWind } from '../../../src/sim/boat.js';
import { createRegatta } from '../../regatta/index.js';
import { createBoatSim, waterFor } from '../../sim/boat.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

// a place race sailed to the finish: the player's boat under the fleet's own mind (the scripted sailor), the rivals on the same physics
function sail(id, { dir, speedMs = 6, tier = 'hard', maxS = 900, hazard = null, helper = true } = {}) {
  const course = placeCourse(id, dir);
  const wf = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 }), ctl = { ...CONTROLS };
  const S = createRegattaSession({ course, me: { phys }, rivals: 3, windAt, seed: 3, pace: 2, helper, round: 'club', onPlace: (p) => Object.assign(phys, new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed })) });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const env = { t: 0, windAt: S.meWind };
  const auto = new FleetRival({ course, tier, skill: skillFor(tier, 'tern'), seed: 11, windAt: S.meWind, vessel: phys.vessel });
  const ev = [];
  let t = 0;
  for (; t < maxS; t += DT) {
    const v = S.race.view('me');
    if (S.helper) S.helperTick(ctl, t); else auto.update(DT, phys.state, ctl, { t, clock: S.race.clock, view: v, line: course.line });
    env.t = t; phys.step(DT, ctl, env);
    if (hazard) S.hazard = hazard(S, t);
    S.advanceTo(t + DT);
    ev.push(...S.drain());
    if (v.status === 'finished') break;
  }
  return { S, ev, course };
}

test('Pass the Channel: a scripted sailor threads the three gates and finishes; the rivals finish on the same physics', () => {
  const { S, ev } = sail('pass-the-channel', { dir: 195 });
  const me = S.race.view('me');
  assert.equal(me.status, 'finished', JSON.stringify(me));
  assert.deepEqual(ev.filter((e) => e.type === 'rounded' && e.id === 'me').map((e) => e.mark), ['G1', 'G2', 'G3']);
  assert.ok(!ev.some((e) => e.type === 'ocs'), 'nobody over early (the gun waits)');
  assert.ok(saluteDue(ev, { hooks: ['salute'] }), 'the salute is due at her finish');
  assert.ok(me.finishedAt > 60 && me.finishedAt < 400, `${me.finishedAt} s`);
  const others = S.rivals.map((r) => S.race.view(r.id));
  assert.ok(others.some((v) => (v.leg ?? 0) >= 2 || v.status === 'finished'), 'the fleet threads the gates too');
});

// ---- the engine in node (index.js createRegatta, as regatta-custom.test.mjs's raceInNode): R.racePlace, the salute's call, Tessie's
// rise and ring, the player's 12 s hold and the DNF ----
function engine({ dir = 200, salute = () => true, tessie = null, flags = {} } = {}) {
  const wind = { pattern: null, base: { dirDeg: dir, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, dir)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const calls = { salute: 0 };
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', autoplay: '1', autotier: 'hard', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store: mem(), persist: true,
    onSalute: () => { calls.salute++; return salute(); }, tessie: () => tessie });
  return { R, B, calls, hour: () => hour };
}
const sailTo = (R, f, maxS = 700) => { for (let s = 0; s < maxS && !f(); s += 2) R.settle(2); return f(); };


test('Tea House Run: the scripted sailor rounds both marks in order and finishes; the rivals race on the same physics', () => {
  const { S, ev } = sail('tea-house-run', { dir: 200, maxS: 1200, helper: false });
  const me = S.race.view('me');
  assert.equal(me.status, 'finished', JSON.stringify(me));
  assert.deepEqual(ev.filter((e) => e.type === 'rounded' && e.id === 'me').map((e) => e.mark), ['M1', 'M2']);
  assert.ok(me.finishedAt > 60 && me.finishedAt < 500, `${me.finishedAt} s`);
});
