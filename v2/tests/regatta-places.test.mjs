// Regatta's place races (owner go 2026-11-19): the registry the hub reads, the pinned courses (their water),
// the gates' order and side, the race knockdown (12 s, a second one DNF), the salute's trigger and script, Tessie's race director,
// and both races sailed to the finish on the real BoatPhysics by a scripted sailor (the fleet's own mind at the helm).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { makeTerrain } from './helpers/ground.mjs';
import { createRace } from '../../src/sim/race/rules.js';
import { CUPS, PLACE_RACES, listCups, raceInfo, isPlace, placeCourse, placeHand, recordPlace, loadPlaces, PLACES_KEY } from '../sim/racePlaces.js';
import { gateDir, gateCross, placeTrackerFor } from '../regatta/placeTracker.js';
import { createKnocks, KNOCK } from '../regatta/knocks.js';
import { saluteDue, saluteShow, SALUTE } from '../regatta/salute.js';
import { createTessieDeep, pickTarget, strikeSpot, avoidAdvice, DEEP } from '../regatta/tessieDeep.js';
import { createRegattaSession, placeLane } from '../regatta/session.js';
import { FleetRival, skillFor } from '../regatta/fleet.js';
import { areaOf } from '../stage/areas.js';
import { gameShow } from '../sim/fireworks.js';
import { dealHand, DEFAULT_SETUP, COURSES, customHand } from '../regatta/setup.js';
import { dealEvent } from '../regatta/events.js';
import { rng } from '../regatta/setup.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createRegatta } from '../regatta/index.js';
import { createBoatSim, waterFor } from '../sim/boat.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('registry: two cups, each race listed with its id, name, cup, length, minutes, hour and best', () => {
  assert.deepEqual(CUPS.map((c) => c.id), ['emerald-bay', 'the-mouth']);
  const store = mem();
  let cups = listCups({ store });
  const all = cups.flatMap((c) => c.races);
  assert.deepEqual(all.map((r) => r.id).sort(), ['glass-boat-chase', 'lights-on-the-lake', 'pass-the-channel', 'storm-run', 'tea-house-run', 'tessies-deep']);
  for (const r of all) {
    assert.equal(typeof r.name, 'string'); assert.ok(CUPS.some((c) => c.id === r.cup && c.races.includes(r.id)));
    //: 0.6–0.8 km, 3–4 min by its own estimate; the chase (her stop to the buoy, 0.9 km) and the finale (about 1 km: the show
    // needs the time) the longer two
    const long = r.id === 'lights-on-the-lake' || r.id === 'glass-boat-chase';
    assert.ok(r.lengthM > 500 && r.lengthM < (long ? 1000 : 900), `${r.id} ${r.lengthM} m`);
    assert.ok(r.mins >= 3 && r.mins <= (long ? 7 : 5), `${r.id} ${r.mins} min`);
    assert.equal(r.best, null); assert.equal(r.available, true);
  }
  assert.equal(raceInfo('pass-the-channel').hour, 20 + 40 / 60);
  // a finish: the best time and medal kept; a slower run keeps the time, a better medal is kept
  assert.equal(recordPlace(store, 'pass-the-channel', { timeS: 200, medal: 'silver', at: '2026-11-19' }).isNew, true);
  assert.equal(recordPlace(store, 'pass-the-channel', { timeS: 210, medal: 'gold' }).isNew, false);
  cups = listCups({ store });
  assert.deepEqual(cups[1].races[0].best, { timeS: 200, medal: 'gold', at: '2026-11-19' });
  // a broken store never breaks the hub
  const bad = mem(); bad.setItem(PLACES_KEY, '{nope'); assert.deepEqual(loadPlaces(bad), {});
  // a phone has no Tessie: Tessie's Deep is unavailable there (the hub hides it); Pass the Channel stays
  const phone = listCups({ has: (f) => f !== 'tessie' }).flatMap((c) => c.races);
  assert.equal(phone.find((r) => r.id === 'tessies-deep').available, false);
  assert.equal(phone.find((r) => r.id === 'pass-the-channel').available, true);
  assert.ok(isPlace('tessies-deep') && !isPlace('island-sprint'));
});

test('pinned courses: no turn to the wind, a finish line of their own, water on every leg', () => {
  const T = makeTerrain({ seed: 1 }), depth = (x, z) => -T.heightAt(x, z);
  for (const r of PLACE_RACES) {
    const a = placeCourse(r.id, 15), b = placeCourse(r.id, 200);
    assert.deepEqual(a.marks.map((m) => m.at), b.marks.map((m) => m.at), `${r.id}: the marks never move with the wind`);
    assert.deepEqual(a.line.committee, b.line.committee);
    assert.ok(a.finish, `${r.id} has its own finish line`);
    // every leg (the start line's middle → marks and gates → the finish line's middle) has at least 3.5 m of water (the keel's 1.6 m)
    for (const leg of a.legs) for (let k = 0; k <= 30; k++) {
      const x = leg.from[0] + (leg.to[0] - leg.from[0]) * k / 30, z = leg.from[1] + (leg.to[1] - leg.from[1]) * k / 30;
      assert.ok(depth(x, z) >= 3.5, `${r.id} leg ${leg.index} at ${x.toFixed(0)},${z.toFixed(0)}: ${depth(x, z).toFixed(1)} m`);
    }
    // the start line's course side faces the first mark; the finish line is crossed the way of the last leg
    const m1 = a.legs[0].to, c = a.line.centre;
    assert.ok((m1[0] - c[0]) * a.line.up[0] + (m1[1] - c[1]) * a.line.up[1] > 0);
    const last = a.legs.at(-1), dx = last.to[0] - last.from[0], dz = last.to[1] - last.from[1];
    assert.ok((dx * a.finish.up[0] + dz * a.finish.up[1]) / Math.hypot(dx, dz) > 0.9, `${r.id}: the finish square to the last leg`);
  }
  const h = placeHand('pass-the-channel', DEFAULT_SETUP);
  assert.equal(h.place, 'pass-the-channel'); assert.equal(h.hour, 20 + 40 / 60); assert.equal(h.rivals, 3); assert.equal(h.prestartS, 0);
});

test('gates: red to port going out; between the buoys the right way counts, beside it is missed, the wrong way is wrong', () => {
  const g = { green: [1428, -1032], red: [1396, -1068] }, d = gateDir(g), c = [1412, -1050];
  // outbound from the bay is north-east: d points east (x+) and north (z−); the red buoy on the port hand of that way
  assert.ok(d[0] > 0 && d[1] < 0);
  const port = [d[1], -d[0]], red = [g.red[0] - c[0], g.red[1] - c[1]];
  assert.ok(red[0] * port[0] + red[1] * port[1] > 0, 'red lies to port going through');
  const at = (k, a = 0) => [c[0] + d[0] * k - d[1] * a, c[1] + d[1] * k + d[0] * a];   // a: across the gate
  assert.deepEqual({ ...gateCross(g, at(-2), at(2)), f: 0 }, { through: true, right: true, f: 0 });
  assert.equal(gateCross(g, at(2), at(-2)).right, false);
  assert.equal(gateCross(g, at(-2, 60), at(2, 60)).through, false);   // 60 m beside the middle: beside the gate
  assert.equal(gateCross(g, at(-2, 400), at(2, 400)), null);          // far off: not this gate at all
  // the level's slack past a buoy (placeTracker.js GATE_RULE.slack): 6 m past the red buoy is through for a Beginner (12 m), not for Pro
  assert.equal(gateCross(g, at(-2, 30), at(2, 30), { slackM: 12 }).through, true);
  assert.equal(gateCross(g, at(-2, 30), at(2, 30), { slackM: 1.5 }).through, false);
  // the order: a tracker on Pass the Channel's three gates; skipping gate 1 means going back through it
  const course = placeCourse('pass-the-channel', 200);
  const P = Object.fromEntries(course.marks.map((m) => [m.id, { x: m.at[0], z: m.at[1] }]));
  P.committee = { x: course.line.committee[0], z: course.line.committee[1] }; P.pin = { x: course.line.pin[0], z: course.line.pin[1] };
  const tr = placeTrackerFor('club', course)({ kind: 'regatta', rounding: 'port', laps: 1, sequence: course.markIds, line: { a: 'committee', b: 'pin' }, origin: { x: 0, z: 0 } }, { positions: () => P });
  const through = (id, back = false, off = 0) => { const m = course.byId[id], dd = gateDir(m), s = back ? -1 : 1, ax = [-dd[1], dd[0]]; const p0 = [m.at[0] - dd[0] * 3 * s + ax[0] * off, m.at[1] - dd[1] * 3 * s + ax[1] * off], p1 = [m.at[0] + dd[0] * 3 * s + ax[0] * off, m.at[1] + dd[1] * 3 * s + ax[1] * off]; tr.update({ x: p0[0], z: p0[1] }, 0); return tr.update({ x: p1[0], z: p1[1] }, 1); };
  assert.equal(tr.target().gate, true); assert.equal(tr.target().mark, 'G1');
  assert.deepEqual(through('G2').map((e) => e.type), [], 'gate 2 before gate 1 does not count');
  assert.equal(tr.k, 0);
  assert.deepEqual(through('G1', false, 50).map((e) => e.type), ['gateMissed'], 'beside gate 1: missed');
  assert.deepEqual(through('G1', true).map((e) => e.type), ['gateWrong'], 'through gate 1 the wrong way');
  assert.deepEqual(through('G1').map((e) => e.type), ['rounded']);
  assert.deepEqual(through('G2').map((e) => e.type), ['rounded']);
  assert.deepEqual(through('G3').map((e) => e.type), ['rounded', 'finished']);
  // the route the fleet steers: before, through and after the gate's middle
  assert.equal(tr.done, true);
});

test('race rules: the finish is the place race\'s own line; retire() is a DNF that ranks last', () => {
  const course = placeCourse('tessies-deep', 200);
  const race = createRace({ course, boats: [{ id: 'me', kind: 'player' }, { id: 'b', kind: 'ai' }], prestartS: 1, tracker: placeTrackerFor('club', course) });
  const L = course.line, F = course.finish, m = course.byId.M1.at;
  const go = (id, pts) => { for (const p of pts) race.step(0.5, { [id]: { x: p[0], z: p[1], heading: 0, u: 3 } }); };
  go('me', [[L.centre[0] - L.up[0] * 5, L.centre[1] - L.up[1] * 5], [L.centre[0] - L.up[0] * 5, L.centre[1] - L.up[1] * 5], [L.centre[0] - L.up[0] * 4, L.centre[1] - L.up[1] * 4], [L.centre[0] + L.up[0] * 5, L.centre[1] + L.up[1] * 5]]);
  assert.equal(race.view('me').status, 'racing');
  // round M1 to starboard (the right turn onto the second leg), then cross the start line back: no finish; then the finish line
  go('me', [[m[0] - 30, m[1] + 30], [m[0] - 3, m[1] + 3], [m[0] + 30, m[1] + 30], [L.centre[0] + L.up[0] * 5, L.centre[1] + L.up[1] * 5], [L.centre[0] - L.up[0] * 5, L.centre[1] - L.up[1] * 5]]);
  assert.equal(race.view('me').leg, 1, 'M1 counted'); assert.notEqual(race.view('me').status, 'finished', 'the start line is not the finish');
  go('me', [[F.centre[0] - F.up[0] * 5, F.centre[1] - F.up[1] * 5], [F.centre[0] + F.up[0] * 5, F.centre[1] + F.up[1] * 5]]);
  assert.equal(race.view('me').status, 'finished');
  assert.deepEqual(race.retire('b', 'knockdown'), { type: 'retired', id: 'b', why: 'knockdown' });
  assert.equal(race.view('b').status, 'dnf'); assert.deepEqual(race.order(), ['me', 'b']); assert.equal(race.done || race.step(0.5, {}).some((e) => e.type === 'over'), true);
});

test('knockdown in a race: 12 s held, the same roll is one knock, a second knock is a DNF', () => {
  const K = createKnocks();
  assert.equal(KNOCK.holdS, 12);
  assert.deepEqual(K.knock('me', 30, 'tessie'), { kind: 'hold', until: 42, n: 1 });
  assert.equal(K.knock('me', 31), null, 'her roll fires the watch again: the same knock');
  assert.equal(K.holding('me', 41.9), true); assert.equal(K.holding('me', 42), false); assert.equal(K.left('me', 36), 6);
  assert.deepEqual(K.knock('me', 80, 'knockdown'), { kind: 'dnf', n: 2 });
  assert.equal(K.out('me'), true); assert.equal(K.knock('me', 90), null);
  assert.equal(K.holding('wren', 0), false);
});

test('salute: due on the player\'s finish in a salute race only, once; its script is the show\'s own shells inside 15 s', () => {
  const fin = [{ type: 'finished', id: 'me', clock: 200 }];
  assert.equal(saluteDue(fin, { hooks: ['salute'] }), true);
  assert.equal(saluteDue(fin, { hooks: ['salute'], fired: true }), false);
  assert.equal(saluteDue(fin, { hooks: ['tessie'] }), false);
  assert.equal(saluteDue([{ type: 'finished', id: 'wren' }], { hooks: ['salute'] }), false, 'a rival home first: no salute');
  const s = saluteShow(gameShow(1));
  assert.equal(s.length, SALUTE.lengthS);
  assert.ok(s.events.length >= 5 && s.events.length <= 8, `${s.events.length} shells`);
  assert.ok(new Set(s.events.map((e) => e.type)).size >= 3, 'a varied salute');
  for (const e of s.events) { assert.ok(e.t >= 0 && e.burst < SALUTE.lengthS - 1); assert.ok(e.height > 0); }
});

test('Tessie\'s race director: she hunts the fleet all race, each attack warned, a spot ahead of the target, the ring catches, a dodge escapes', () => {
  const area = areaOf('tessieWaters'), pace = 2, D = createTessieDeep({ area, pace, seed: 5 });
  const boat = (id, x, z, hd, o = {}) => ({ id, x, z, heading: hd * Math.PI / 180, u: 3, progress: 0, status: 'racing', held: false, ...o });
  const fleet = () => [boat('me', 200, -120, 42, { progress: 150 }), boat('wren', 180, -60, 42, { progress: 90 }), boat('far', 900, 600, 0)];
  assert.deepEqual(D.step(5, { boats: fleet() }), [], 'not in the first seconds');
  const attacks = [], gaps = [];
  let caught = 0, lastDive = null;
  for (let t = 0; t < 400; t += 0.25) {
    for (const e of D.step(t, { boats: fleet(), ready: true })) {
      if (e.type === 'warn') {
        if (attacks.length) gaps.push(t - D.state.log.at(-2).t);
        attacks.push(e);
        assert.notEqual(e.target, 'far', 'never a boat far from her water');
        assert.ok(Math.hypot(e.at[0] - area.x, e.at[1] - area.z) <= area.r - DEEP.insetM + 1e-6, 'the spot is in her water');
        const tb = fleet().find((b) => b.id === e.target), ahead = (e.at[0] - tb.x) * Math.sin(tb.heading) - (e.at[1] - tb.z) * Math.cos(tb.heading);
        assert.ok(ahead > 0, 'ahead of the target\'s bow');
        assert.equal(D.ring.live, false, 'the warning: the ring shown, not live');
      }
      if (e.type === 'strike') assert.ok(Math.abs(t - D.state.t0 - DEEP.warnS * pace) < 0.3, `the strike comes after the warning (${t})`);
      if (e.type === 'dive') lastDive = t;
      if (e.type === 'catch') caught++;
    }
  }
  assert.ok(attacks.length >= 8, `she keeps attacking: ${attacks.length} in 400 s of race`);
  for (const g of gaps) assert.ok(g >= DEEP.everyS[0] * pace - 0.3 && g <= DEEP.everyS[1] * pace + DEEP.retryS * pace + 0.3, `start to start ${g} s of race clock (20–35 s real at 2 ×)`);
  assert.ok(new Set(attacks.map((a) => a.target)).size === 2, 'she goes for the player and the rival');
  assert.ok(attacks.filter((a) => a.target === 'me').length > attacks.length / 3, 'the leader (and nearest) more often');
  assert.ok(caught <= attacks.length * 2, 'a boat is caught at most once an attack');
  // the catch: a boat that holds its course into the live ring is rolled once an attack; a boat that bore away is not
  const E = createTessieDeep({ area, pace, seed: 1 }), b0 = boat('me', 200, -120, 42);
  const w = E.step(DEEP.firstS * pace, { boats: [b0] })[0]; assert.equal(w.type, 'warn');
  const at = w.at;
  assert.deepEqual(E.step(DEEP.firstS * pace + 1, { boats: [{ ...b0, x: at[0], z: at[1] }] }).filter((e) => e.type === 'catch'), [], 'no catch during the warning');
  const tS = DEEP.firstS * pace + DEEP.warnS * pace;
  const hit = E.step(tS, { boats: [{ ...b0, x: at[0] + 10, z: at[1] }, boat('dodge', at[0] + 70, at[1], 132)] });
  assert.deepEqual(hit.filter((e) => e.type === 'catch').map((e) => e.id), ['me']);
  assert.deepEqual(E.step(tS + 1, { boats: [{ ...b0, x: at[0], z: at[1] }] }).filter((e) => e.type === 'catch'), [], 'caught once an attack');
  // a held boat (being righted) is never the target
  const H = createTessieDeep({ area, pace, seed: 1 });
  assert.equal(H.step(DEEP.firstS * pace, { boats: [boat('me', 200, -120, 42, { held: true })] }).length, 0);
  // a rival steers round her outer ring, never into irons; a boat sailing clear of it gets no advice
  const c = at;
  const adv = avoidAdvice({ x: c[0] - 120, z: c[1], heading: Math.PI / 2 }, c, 60, { skill: 0.8, windFrom: 0 });
  assert.ok(adv, 'heading at her: steer round'); assert.ok(Math.abs(Math.atan2(Math.sin(adv.heading), Math.cos(adv.heading))) > 42 * Math.PI / 180);
  assert.equal(avoidAdvice({ x: c[0] - 120, z: c[1] + 200, heading: Math.PI / 2 }, c, 60, { skill: 0.8 }), null);
  assert.equal(avoidAdvice({ x: c[0] - 120, z: c[1], heading: Math.PI / 2 }, c, 60, { skill: 0 }), null, 'a slow rival sees her late');
  assert.ok(pickTarget([], area, [0, 0]) === null && strikeSpot(b0, area, 10) != null);
});

test('hub retirements: dealt hands never deal Harbour Dash, Twice Round, Bay Tour or a match race; Custom keeps them', () => {
  for (const aids of ['beginner', 'club', 'pro']) for (let s = 1; s < 60; s++) {
    const h = dealHand(s * 7919, { ...DEFAULT_SETUP, aids });
    assert.ok(!['harbour-dash', 'twice-round', 'bay-tour'].includes(h.course), `${aids} ${s}: ${h.course}`);
    assert.notEqual(h.event, 'match');
    assert.notEqual(dealEvent(rng(s), aids), 'match');
  }
  assert.ok(['harbour-dash', 'twice-round', 'bay-tour'].every((id) => COURSES.some((c) => c.id === id)), 'Custom keeps the courses');
  assert.equal(customHand({ ...DEFAULT_SETUP, custom: { ...DEFAULT_SETUP.custom, course: 'harbour-dash', event: 'match' } }).course, 'harbour-dash');
});

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

test('cups: two cups in order, each with its races; an unavailable race is flagged for the hub to hide; every race has a pin spot', () => {
  const cups = listCups({ store: mem() });
  assert.deepEqual(cups.map((c) => [c.id, c.name, c.races.map((r) => r.id)]), [['emerald-bay', 'Emerald Bay', ['tea-house-run', 'tessies-deep', 'glass-boat-chase']], ['the-mouth', 'The Mouth', ['pass-the-channel', 'storm-run', 'lights-on-the-lake']]]);
  // a phone (no Tessie, no glass boat, no storm): Tea House Run, Pass the Channel and Lights on the Lake (lit, no show)
  const phone = listCups({ has: (f) => !['tessie', 'glassBoat', 'storm'].includes(f) });
  assert.deepEqual(phone[0].races.filter((r) => r.available).map((r) => r.id), ['tea-house-run']);
  assert.deepEqual(phone[1].races.filter((r) => r.available).map((r) => r.id), ['pass-the-channel', 'lights-on-the-lake']);
  for (const r of cups.flatMap((c) => c.races)) {
    const c = placeCourse(r.id, 200);
    assert.deepEqual(r.at, [Math.round(c.line.centre[0]), Math.round(c.line.centre[1])], `${r.id}: the pin is the start line's middle`);
  }
  // the retired four are not races of any cup (Custom keeps their courses)
  const ids = cups.flatMap((c) => c.races.map((r) => r.id));
  assert.ok(['harbour-dash', 'twice-round', 'bay-tour', 'match-race'].every((id) => !ids.includes(id)));
});

test('Tea House Run: Vikingsholm start, round Fannette (north, then east), finish under the steps; the boulder-shallows shortcut is shorter and shallow', () => {
  const r = raceInfo('tea-house-run');
  assert.equal(r.cup, 'emerald-bay'); assert.equal(r.hour, 15); assert.equal(r.rivals, 4); assert.equal(r.available, true);
  assert.ok(r.lengthM > 650 && r.lengthM < 780, `${r.lengthM} m (about 0.71 km)`);
  assert.ok(r.mins >= 3 && r.mins <= 5, `${r.mins} min`);
  const c = placeCourse('tea-house-run', 200);
  assert.equal(c.legs.length, 3);
  assert.deepEqual(c.marks.map((m) => [m.id, ...m.at]), [['M1', -60, -110], ['M2', 130, -20]]);
  assert.deepEqual(c.line.pin, [-260, 180]); assert.deepEqual(c.line.committee, [-200, 240]);
  assert.ok(Math.hypot(c.finish.centre[0] - 55, c.finish.centre[1] - 110) < 0.5, 'the finish line is under the steps');
  // the shortcut: inside the shelf (shallow, a keel could ground on a stone), saving metres over the line that swings out to deep water
  const row = PLACE_RACES.find((x) => x.id === 'tea-house-run'), sc = row.shortcut, T = makeTerrain({ seed: 1 }), depth = (x, z) => -T.heightAt(x, z);
  const sc0 = c.line.centre, m1 = row.legs[0].at, d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const viaLen = (v) => d(sc0, v) + d(v, m1), safe = viaLen(sc.safeVia), cut = viaLen(sc.via);
  assert.ok(cut < safe - 60, `the shortcut saves ${(safe - cut).toFixed(0)} m`);
  assert.ok(depth(...sc.via) > 1.6 && depth(...sc.via) < 6, `the shortcut's shelf: ${depth(...sc.via).toFixed(1)} m of water`);
  assert.ok(depth(...sc.safeVia) > 8, 'the safe line is deep water');
  assert.equal(sc.risk, 'grounding');
});

test('Tessie\'s Deep: the dog-leg sailed to the finish; a rival held 12 s by a knock, a second knock retires her', () => {
  let knocked = false;
  const { S, ev } = sail('tessies-deep', { dir: 200, hazard: (S2, t) => { if (!knocked && S2.race.clock > 20) { knocked = true; S2.knock('wren', 'tessie'); } return null; } });
  assert.equal(S.race.view('me').status, 'finished');
  assert.deepEqual(ev.filter((e) => e.type === 'rounded' && e.id === 'me').map((e) => e.mark), ['M1']);
  const k = ev.find((e) => e.type === 'knocked' && e.id === 'wren');
  assert.equal(k.kind, 'hold'); assert.ok(Math.abs(k.until - k.clock - 12) < 1e-9);
  const k2 = S.knock('wren', 'knockdown');
  assert.equal(k2.kind, 'dnf'); assert.equal(S.race.view('wren').status, 'dnf');
  // the lanes: a run start sails the line's square; a square in irons sails close-hauled instead
  const L = S.course.line, sq = Math.atan2(L.up[0], -L.up[1]);
  assert.ok(Math.abs(placeLane(L, sq + Math.PI, 0.8) - sq) < 1e-9);
  assert.ok(Math.abs(Math.abs(placeLane(L, sq + 0.1, 0.8) - (sq + 0.1)) - 0.8) < 1e-9);
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

test('engine: R.racePlace runs Pass the Channel at 20:40 to the finish; the salute is called once (desktop), a phone\'s page shows none', async () => {
  for (const [desk, want] of [[true, true], [false, false]]) {
    const { R, calls, hour } = engine({ dir: 195, salute: () => desk });
    await R.enter({ hub: true, deal: true });
    R.racePlace('pass-the-channel');
    assert.equal(R.hubOpen, false); assert.equal(R.placeRace.id, 'pass-the-channel'); assert.equal(R.course.place, 'pass-the-channel');
    assert.ok(Math.abs((hour() % 24) - (20 + 40 / 60)) < 1e-6, 'the race sets its hour');
    assert.equal(R.session.rivals.length, 3);
    assert.ok(sailTo(R, () => R.state().me?.status === 'finished'), JSON.stringify(R.state().me));
    assert.deepEqual(R.stats.rounds.map((r) => r.mark), ['G1', 'G2', 'G3']);
    assert.equal(calls.salute, 1); assert.equal(R.salute.shown, want);
    R.settle(4); assert.equal(calls.salute, 1, 'once');
    assert.ok(sailTo(R, () => !!R.stats.result, 120)); assert.ok(R.stats.result.place >= 1);
  }
  // the URL's ?course=<id> enters the place race straight in the box
  const u = engine({ flags: { course: 'tessies-deep' } });
  await u.R.enter();
  assert.equal(u.R.placeRace.id, 'tessies-deep'); assert.equal(u.R.hubOpen, false);
});

test('engine: Tessie\'s Deep: she attacks again and again, each warned and breached; her ring holds the player 12 s, a second knock is a DNF', async () => {
  const log = [];
  const st = { visible: false, centre: [0, 0], t: 0, phase: 'idle' };
  const sim = { state: st, riseUnder: (x, z, o) => { log.push(['rise', x, z, o.from, o.breach]); st.visible = true; st.phase = 'swim'; st.centre = [x, z]; }, hunt: (on) => log.push(['hunt', on]), swimTo: (x, z) => log.push(['swim', x, z]),
    play: (n) => { log.push(['play', n]); if (n === 'dive') { st.visible = false; st.phase = 'idle'; } } };
  const { R, B } = engine({ dir: 200, tessie: { sim, raceCue: (l) => log.push(['cue', l]) } });
  await R.enter({ hub: true, deal: true });
  R.racePlace('tessies-deep');
  assert.ok(R.tessieRace, 'Tessie allowed in her race');
  assert.ok(sailTo(R, () => R.deep.state.phase === 'warn', 300), 'her first attack is warned');
  const rise = log.find((e) => e[0] === 'rise');
  assert.equal(rise[3], 3.5 * DEEP.warnS, 'about 5 s of her swim before she breaches'); assert.equal(rise[4], true, 'she breaches: neck and head out');
  assert.ok(log.some((e) => e[0] === 'cue' && e[1] > 0), 'the drone under the warning');
  assert.ok(R.session.hazard, 'the rivals see her ring');
  // put the player into her live ring: knocked down, held 12 s of race time, then sailing again
  sailTo(R, () => R.deep.state.phase === 'strike', 60);
  assert.ok(log.some((e) => e[0] === 'play' && e[1] === 'arc'), 'her neck stays up after the breach');
  const c = R.deep.ring.at; B.place({ x: c[0] + 5, z: c[1], headingDeg: 90, speed: 3 }); R.session.t = B.t;
  R.settle(0.2);
  assert.equal(R.held, true); assert.deepEqual(R.stats.knocks.map((k) => [k.cause, k.kind]), [['tessie', 'hold']]);
  const t0 = R.state().clock;
  sailTo(R, () => !R.held, 40);
  assert.ok(Math.abs(R.state().clock - t0 - 12) < 2.5, `held ${(R.state().clock - t0).toFixed(1)} s`);
  // she comes back: a second warned attack within 20–35 s (× the pace) of her dive
  assert.ok(sailTo(R, () => R.deep.state.n >= 2, 200), `a second attack (${JSON.stringify(R.stats.attacks)})`);
  assert.ok(log.filter((e) => e[0] === 'rise').length >= 2);
  // a second knockdown (the watch, a gust): the place race takes it as the DNF
  assert.equal(R.placeKnock({}), false, 'the second knock is the game end: the page runs it');
  assert.equal(R.state().me.status, 'dnf');
  assert.ok(sailTo(R, () => !!R.stats.result, 30)); assert.match(R.stats.result.title, /DNF/, JSON.stringify(R.stats.result));
});
