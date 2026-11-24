// The slow half of v2/tests/regatta-events.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): the pursuit's offsets on the water: each skill sailed alone, home within a few seconds (the fast suite keeps the offsets' arithmetic); Beginner forgives an early pursuit start (the fast suite keeps Club's penalty).
// Regatta's race types (owner 2026-11-17): the deal by the aids (Beginner: fleet and time trial; Club and Pro
// add match races and pursuits), Custom's Race type row; a match race (the rival covers: ahead upwind she tacks onto the player's tack;
// the chip "Ahead 12 m" / "Behind 8 m"; the 1 v 1 card); a pursuit (the slowest boat first, each boat over her own line at her time,
// offsets that bring boats sailing to their skill home together); a time trial (the best run kept with its splits and path, checked on
// read; the ghost; the splits against the best). No browser: the real BoatPhysics on the real wind field, v1's race rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, Helm } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../../src/sim/race/course.js';
import { side } from '../../../src/sim/race/line.js';
import { courseToWind } from '../../regatta/geometry.js';
import { createRegattaSession } from '../../regatta/session.js';
import { FleetRival, coverCall, COVER } from '../../regatta/fleet.js';
import { dealHand, handSeed, customHand, validHand, describeHand, clampCustom, DEFAULT_SETUP, PRESETS, handKey } from '../../regatta/setup.js';
import { customDials } from '../../regatta/hub.js';
import { resultCard } from '../../regatta/review.js';
import { EVENT_IDS, EVENT_DEAL, rivalsFor, matchChip, matchCard, slowFactor, courseTimeS, pursuitSlots, pursuitOrder, PURSUIT,
  TRIAL_KEY, trialKey, loadTrial, recordTrial, clampTrial, toFrame, fromFrame, ghostAt, thin, splitWord, splitsLine, splitDelta } from '../../regatta/events.js';

const DEG = Math.PI / 180, WATERS = 'tahoe-emerald';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const SETUPS = ['beginner', 'club', 'pro'].map((id) => ({ ...DEFAULT_SETUP, ...PRESETS[id] }));
function world({ id = 'island-sprint', dir = 210, seed = 1, scale = 0.35 } = {}) {
  const course = courseToWind(courseFor(WATERS, id), dir, { loadCourse, snapCourse, scale });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir } });
  return { course, windAt: (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; } };
}

// a match race on the water: the player (the fleet's own mind at a lower skill) starts late, then is made to tack while behind; the
// rival (Hard) answers each early tack within 12 s while she leads within range. A fleet race with the same script: no cover tacks
function duel(event, { seed = 1, lateS = 15 } = {}) {
  const { course, windAt } = world({ seed, scale: 0.6 });
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals: 1, windAt, seed, tier: 'hard', flying: true, pace: 2, gunWaits: true, helper: false, event });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const brain = new FleetRival({ course, tier: 'medium', skill: 0.55, seed: 99, windAt: S.meWind, vessel: phys.vessel });
  const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind }, helm = new Helm(), rv = S.rivals[0];
  let t = 0, force = null, lastForce = -1e9, meSide = null, rvSide = null;
  const meTacks = [], rvTacks = [];
  while (t < 200) {
    const s = phys.state, w = S.meWind(s.x, s.z, t), twd = Math.atan2(-w.vx, w.vz), clock = S.race.clock, vm = S.race.view('me'), vr = S.race.view(rv.id);
    const msd = wrap(twd - s.heading) >= 0 ? 1 : -1, rsd = wrap(twd - rv.phys.state.heading) >= 0 ? 1 : -1;
    if (clock < lateS) ctl.rudder = helm.toHeading(s, clock < 3 ? S.me0.heading : twd - 100 * DEG, DT);
    else {
      if (!force && vm.leg === 0 && clock - lastForce > 30 && clock > lateS + 20 && msd === rsd) { force = { side: -msd, until: clock + 14 }; lastForce = clock; }
      if (force && clock > force.until) force = null;
      if (force) brain.sk.update(DT, s, ctl, { t, waypoint: [s.x, s.z - 100], legKey: 'force', advice: { evade: true, closeHauled: true, side: force.side, chDeg: 45, mode: 'beat' } });
      else brain.update(DT, s, ctl, { t, clock, view: vm, line: course.line });
    }
    env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); S.drain();
    const m2 = wrap(twd - phys.state.heading) >= 0 ? 1 : -1, r2 = wrap(twd - rv.phys.state.heading) >= 0 ? 1 : -1;
    if (meSide != null && m2 !== meSide && vm.status === 'racing') meTacks.push({ c: clock, to: m2, aheadM: (vr.progressM ?? 0) - (vm.progressM ?? 0), d: Math.hypot(rv.phys.state.x - phys.state.x, rv.phys.state.z - phys.state.z), leg: vm.leg });
    if (rvSide != null && r2 !== rvSide) rvTacks.push({ c: clock, to: r2 });
    meSide = m2; rvSide = r2;
  }
  return { meTacks, rvTacks, coverTacks: rv.brain.coverTacks, S };
}

test('the pursuit\'s offsets: the slowest boat first; boats sailing to their skill (each alone, the same lake) home within a few seconds', () => {
  assert.ok(slowFactor(0.45) > slowFactor(0.62) && slowFactor(0.62) > slowFactor(0.95) && Math.abs(slowFactor(1) - 1) < 1e-9);
  const slots = pursuitSlots([{ id: 'me', skill: 0.62 }, { id: 'a', skill: 0.42 }, { id: 'b', skill: 0.82 }], 240);
  assert.equal(slots.a, 0); assert.ok(slots.me > 0 && slots.b > slots.me, JSON.stringify(slots));
  for (const [id, sk] of [['me', 0.62], ['a', 0.42], ['b', 0.82]]) assert.ok(Math.abs(slots[id] + 240 * slowFactor(sk) - 240 * slowFactor(0.42)) <= PURSUIT.round, `${id}: its start + its time is the slowest's time`);
  assert.equal(pursuitOrder({ me: 14, wren: 0, tern: 19 }, { wren: 'Osprey', tern: 'Tern' }).text, 'You start 2nd, 14 s after Osprey');
  assert.equal(pursuitOrder({ me: 0, wren: 9 }, { wren: 'Osprey' }).text, 'You start first. The fleet chases you.');
  assert.equal(pursuitOrder({ me: 27, wren: 0, tern: 13 }, { wren: 'Osprey', tern: 'Tern' }).text, 'You start 3rd, 14 s after Tern');
  // the real race: each skill sails the course alone on the same lake and wind (the fleet's mind, a flying start), its time measured;
  // the pursuit's start for that skill added, they all cross within a few seconds
  const runs = [];
  for (const tier of ['easy', 'medium', 'hard', 'pro']) {
    const { course, windAt } = world({ seed: 1 });
    const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
    const S = createRegattaSession({ course, me: { phys }, windAt, seed: 1, tier, rivals: 1, flying: true, pace: 2 });
    let t = 0; while (t < 700 && S.race.view('wren').status !== 'finished') { t += DT; S.advanceTo(t); S.drain(); }
    const v = S.race.view('wren');
    runs.push({ tier, skill: S.rivals[0].skill, elapsed: v.finishedAt - v.startedAt, T1: courseTimeS(course, S.windFrom, Math.hypot(windAt(course.line.centre[0], course.line.centre[1], 0).vx, windAt(course.line.centre[0], course.line.centre[1], 0).vz), phys.vessel?.polar) });
  }
  const sl = pursuitSlots(runs.map((r) => ({ id: r.tier, skill: r.skill })), runs[0].T1), home = runs.map((r) => sl[r.tier] + r.elapsed);
  const raw = Math.max(...runs.map((r) => r.elapsed)) - Math.min(...runs.map((r) => r.elapsed)), spread = Math.max(...home) - Math.min(...home);
  assert.ok(raw > 15, `the skills differ (${raw.toFixed(1)} s from easy to pro)`);
  assert.ok(spread <= 6, `home within ${spread.toFixed(1)} s (${runs.map((r, i) => `${r.tier} ${r.elapsed.toFixed(1)} + ${sl[r.tier]}`).join(', ')})`);
});


test('a boat over her own pursuit line early owes a penalty turn (Club, Pro); Beginner forgives', () => {
  for (const forgiving of [false, true]) {
    const { course, windAt } = world({ seed: 1 });
    const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
    const S = createRegattaSession({ course, me: { phys }, windAt, seed: 1, tier: 'medium', rivals: 3, pace: 2, gunWaits: false, event: 'pursuit', forgiving, meSkill: 0.95 });
    assert.ok(S.slots.me > 5, `the player starts late (${S.slots.me} s)`);
    // she sails straight in from a pose just below the line
    const p = { x: S.line.centre[0] - S.line.up[0] * 12, z: S.line.centre[1] - S.line.up[1] * 12, heading: S.me0.heading, speed: S.me0.speed };
    Object.assign(phys, new BoatPhysics(p));
    const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind }, helm = new Helm(), log = [];
    let t = 0;
    // held there until the gun (the race's first start), then sailed straight over: a few seconds after the gun, long before her own time
    while (t < S.prestartS + 20) { if (S.race.clock < 0) Object.assign(phys, new BoatPhysics(p)); ctl.rudder = helm.toHeading(phys.state, p.heading, DT); env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); log.push(...S.drain()); }
    const early = log.find((e) => e.type === 'earlyStart' && e.id === 'me'), pen = log.find((e) => e.type === 'penalty' && e.id === 'me');
    assert.ok(early && early.byS > 1, `over early by ${early?.byS} s`);
    assert.equal(!!pen, !forgiving, `a penalty turn: ${forgiving ? 'forgiven' : JSON.stringify(pen)}`);
    if (pen) assert.equal(pen.rule, 'early start');
  }
});
