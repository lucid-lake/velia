// Regatta's race types (owner 2026-11-17): the deal by the aids (Beginner: fleet and time trial; Club and Pro
// add match races and pursuits), Custom's Race type row; a match race (the rival covers: ahead upwind she tacks onto the player's tack;
// the chip "Ahead 12 m" / "Behind 8 m"; the 1 v 1 card); a pursuit (the slowest boat first, each boat over her own line at her time,
// offsets that bring boats sailing to their skill home together); a time trial (the best run kept with its splits and path, checked on
// read; the ghost; the splits against the best). No browser: the real BoatPhysics on the real wind field, v1's race rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, Helm } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { side } from '../../src/sim/race/line.js';
import { courseToWind } from '../regatta/geometry.js';
import { createRegattaSession } from '../regatta/session.js';
import { FleetRival, coverCall, COVER } from '../regatta/fleet.js';
import { dealHand, handSeed, customHand, validHand, describeHand, clampCustom, DEFAULT_SETUP, PRESETS, handKey } from '../regatta/setup.js';
import { customDials } from '../regatta/hub.js';
import { resultCard } from '../regatta/review.js';
import { EVENT_IDS, EVENT_DEAL, rivalsFor, matchChip, matchCard, slowFactor, courseTimeS, pursuitSlots, pursuitOrder, PURSUIT,
  TRIAL_KEY, trialKey, loadTrial, recordTrial, clampTrial, toFrame, fromFrame, ghostAt, thin, splitWord, splitsLine, splitDelta } from '../regatta/events.js';

const DEG = Math.PI / 180, WATERS = 'tahoe-emerald';
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const SETUPS = ['beginner', 'club', 'pro'].map((id) => ({ ...DEFAULT_SETUP, ...PRESETS[id] }));
function world({ id = 'island-sprint', dir = 210, seed = 1, scale = 0.35 } = {}) {
  const course = courseToWind(courseFor(WATERS, id), dir, { loadCourse, snapCourse, scale });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir } });
  return { course, windAt: (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; } };
}

test('the deal by the aids: Beginner meets fleet races and time trials only; Club and Pro add the pursuit (the match race retired from the hub); each type its own fleet', () => {
  for (const s of SETUPS) {
    const seen = {};
    for (let n = 0; n < 400; n++) {
      const h = dealHand(handSeed('2026-11-17', n), s);
      seen[h.event] = (seen[h.event] ?? 0) + 1;
      assert.ok(validHand(h), JSON.stringify(h));
      assert.equal(h.rivals, rivalsFor(h.event, h.rivals));
      if (h.event === 'match') assert.equal(h.rivals, 1);
      if (h.event === 'trial') assert.equal(h.rivals, 0);
      if (h.event === 'pursuit') { assert.ok(h.rivals >= 2 && h.rivals <= 5); assert.equal(h.prestartS, 0, 'a pursuit always starts flying'); }
    }
    const want = s.aids === 'beginner' ? ['fleet', 'trial'] : EVENT_IDS.filter((e) => e !== 'match');   //: no match race dealt
    assert.deepEqual(Object.keys(seen).sort(), [...want].sort(), `${s.aids}: ${JSON.stringify(seen)}`);
    assert.ok(seen.fleet > 400 * 0.4, `${s.aids}: the fleet race is still the usual hand (${seen.fleet} of 400)`);
    for (const e of EVENT_IDS) assert.equal((EVENT_DEAL[s.aids][e] ?? 0) > 0, want.includes(e));
  }
  // the race type rides in the hand's key (a match on the same course is a different hand) and in its words
  const m = customHand({ ...DEFAULT_SETUP, custom: { ...clampCustom({}), event: 'match' } }, 3), f = customHand({ ...DEFAULT_SETUP, custom: clampCustom({}) }, 3);
  assert.notEqual(handKey(m), handKey(f));
  assert.equal(describeHand(m).event, 'Match race'); assert.match(describeHand(m).line2, /^1 v 1/);
  assert.match(describeHand(customHand({ ...DEFAULT_SETUP, custom: { ...clampCustom({}), event: 'trial' } }, 3)).line2, /against the clock/);
});

test('Custom\'s Race type row: each type picked reaches the hand; Rivals steps aside for a match and a time trial, Start for a pursuit', () => {
  const rowsFor = (event, extra = {}) => customDials({ setup: { ...DEFAULT_SETUP, custom: clampCustom({ ...extra, event }) } });
  for (const e of EVENT_IDS) {
    const rows = rowsFor(e, { rivals: 0, start: 90 }), ids = rows.map((r) => r.id), ev = rows.find((r) => r.id === 'event');
    assert.ok(ev && ev.pickers[0].options.length === 4 && ev.pickers[0].options.find((o) => o.on).v === e, `${e}: the Race type row`);
    assert.equal(ids.includes('rivals'), e === 'fleet' || e === 'pursuit', `${e}: the Rivals row`);
    assert.equal(ids.includes('start'), e !== 'pursuit', `${e}: the Start row`);
    const h = customHand({ ...DEFAULT_SETUP, custom: clampCustom({ event: e, rivals: 0, start: 90 }) }, 2);
    assert.ok(validHand(h)); assert.equal(h.event, e);
    assert.equal(h.rivals, { fleet: 0, match: 1, trial: 0, pursuit: 2 }[e]);
    assert.equal(h.prestartS, e === 'pursuit' ? 0 : 90);
  }
  assert.deepEqual(rowsFor('pursuit').find((r) => r.id === 'rivals').pickers[0].options.map((o) => o.v), ['2', '3', '4', '5'], 'a pursuit needs a pack: 2 to 5');
  assert.equal(clampCustom({ event: 'regatta' }).event, 'fleet');
});

test('the match race\'s chip and its 1 v 1 card', () => {
  assert.equal(matchChip(12.4), 'Ahead 12 m'); assert.equal(matchChip(-8.2), 'Behind 8 m'); assert.equal(matchChip(0.3), 'Level'); assert.equal(matchChip(null), 'Match · 1 v 1');
  const views = (me, rv) => ({ me: { finishedAt: me, place: me == null ? null : me < (rv ?? 1e9) ? 1 : 2 }, wren: { finishedAt: rv, place: rv == null ? null : rv < (me ?? 1e9) ? 1 : 2 } });
  const won = matchCard(resultCard({ order: ['me', 'wren'], views: views(200, 212.3), names: { wren: 'Osprey' } }), 'Osprey');
  assert.equal(won.title, 'You win the match'); assert.equal(won.medal, 'gold'); assert.equal(won.gap, 'By 12.3 s'); assert.equal(won.mark, '1');
  const lost = matchCard(resultCard({ order: ['wren', 'me'], views: views(208, 200), names: { wren: 'Osprey' } }), 'Osprey');
  assert.equal(lost.title, 'Osprey wins the match'); assert.equal(lost.medal, null); assert.equal(lost.gap, 'By 8.0 s'); assert.equal(lost.mark, '2');
  const early = matchCard(resultCard({ order: ['me', 'wren'], views: views(200, null), names: { wren: 'Osprey' } }), 'Osprey');
  assert.equal(early.gap, 'Osprey still racing');
  const dnf = matchCard(resultCard({ order: ['wren', 'me'], views: views(null, 200), names: { wren: 'Osprey' } }), 'Osprey');
  assert.equal(dnf.title, 'Did not finish'); assert.equal(dnf.medal, null);
});

test('the cover rule: ahead on a beat she tacks onto the opponent\'s tack after a moment and holds it, never on her layline or near the mark', () => {
  const twd = 0, alpha = 42 * DEG, st = {};
  const boat = (x, z, side) => ({ x, z, heading: twd - side * alpha });   // + starboard
  const mark = [20, -400];
  // ahead, both on starboard: hold it
  assert.deepEqual(coverCall({ me: boat(0, -100, 1), opp: boat(-30, -60, 1), mark, twd, alpha, aheadM: 30, skill: 0.8, t: 0, st }), { side: 1, why: 'hold' });
  // the opponent tacks onto port: no answer for the reaction time, then tack onto port
  const call = (t) => coverCall({ me: boat(0, -100, 1), opp: boat(-30, -60, -1), mark, twd, alpha, aheadM: 30, skill: 0.8, t, st });
  assert.equal(call(20), null, 'the moment after her tack');
  assert.equal(call(20.5), null);
  const react = COVER.reactS[1] + (COVER.reactS[0] - COVER.reactS[1]) * 0.8;
  assert.deepEqual(call(20 + react + 0.1), { side: -1, why: 'tack' });
  // behind: no cover; far away: none; inside COVER.markM of the mark: none; the mark not upwind: none
  const st2 = { opT: -100, myT: -100 }, o = (x) => ({ me: boat(0, -100, 1), opp: boat(-30, -60, -1), mark, twd, alpha, aheadM: 30, skill: 1, t: 0, st: { ...st2 }, ...x });
  assert.equal(coverCall(o({ aheadM: -5 })), null);
  assert.equal(coverCall(o({ opp: boat(-300, 100, -1) })), null);
  assert.equal(coverCall(o({ mark: [10, -140] })), null);
  assert.equal(coverCall(o({ mark: [0, 300] })), null);
  // on her layline (the mark lays on her tack): sail for it; a tack that would carry her past the other layline: none
  assert.equal(coverCall(o({ mark: [-200, -250] })), null);
  assert.equal(coverCall(o({ me: boat(0, -100, -1), opp: boat(-30, -60, 1), mark: [400, -200] })), null);
});

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
test('a match race: the rival covers (ahead upwind she tacks onto the player\'s tack within 12 s); a fleet race\'s rival does not', () => {
  const m = duel('match');
  const chances = m.meTacks.filter((x) => x.leg === 0 && x.aheadM > COVER.aheadM && x.d < COVER.rangeM - 20);
  assert.ok(chances.length >= 1, `the player tacked while behind: ${JSON.stringify(m.meTacks.map((x) => [+x.c.toFixed(1), +x.aheadM.toFixed(0), +x.d.toFixed(0)]))}`);
  const answered = chances.filter((x) => m.rvTacks.some((r) => r.to === x.to && r.c > x.c && r.c - x.c < 12));
  assert.ok(answered.length >= 1 && answered.length >= chances.length - 1, `covered ${answered.length} of ${chances.length}: player ${JSON.stringify(chances.map((x) => +x.c.toFixed(1)))}, rival ${JSON.stringify(m.rvTacks.map((r) => +r.c.toFixed(1)))}`);
  assert.ok(m.coverTacks >= 1, `cover tacks ${m.coverTacks}`);
  assert.equal(m.S.event, 'match'); assert.equal(m.S.rivals.length, 1); assert.equal(m.S.rivals[0].brain.cover, true);
  const f = duel('fleet');
  assert.equal(f.coverTacks, 0); assert.equal(f.S.rivals[0].brain.cover, false);
});

test('the pursuit\'s offsets: the slowest boat first, each start plus her time the slowest\'s time', () => {
  assert.ok(slowFactor(0.45) > slowFactor(0.62) && slowFactor(0.62) > slowFactor(0.95) && Math.abs(slowFactor(1) - 1) < 1e-9);
  const slots = pursuitSlots([{ id: 'me', skill: 0.62 }, { id: 'a', skill: 0.42 }, { id: 'b', skill: 0.82 }], 240);
  assert.equal(slots.a, 0); assert.ok(slots.me > 0 && slots.b > slots.me, JSON.stringify(slots));
  for (const [id, sk] of [['me', 0.62], ['a', 0.42], ['b', 0.82]]) assert.ok(Math.abs(slots[id] + 240 * slowFactor(sk) - 240 * slowFactor(0.42)) <= PURSUIT.round, `${id}: its start + its time is the slowest's time`);
  assert.equal(pursuitOrder({ me: 14, wren: 0, tern: 19 }, { wren: 'Osprey', tern: 'Tern' }).text, 'You start 2nd, 14 s after Osprey');
  assert.equal(pursuitOrder({ me: 0, wren: 9 }, { wren: 'Osprey' }).text, 'You start first. The fleet chases you.');
  assert.equal(pursuitOrder({ me: 27, wren: 0, tern: 13 }, { wren: 'Osprey', tern: 'Tern' }).text, 'You start 3rd, 14 s after Tern');
  // the real race (each skill sailed alone, home within a few seconds): v2/tests/slow/regatta-events.slow.mjs
});

test('the pursuit on the water: each boat laid back on her lane, over her own line at her time (none early), the slowest first', () => {
  const { course, windAt } = world({ seed: 2 });
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, windAt, seed: 2, tier: 'medium', rivals: 5, flying: false, pace: 2, gunWaits: true, event: 'pursuit', forgiving: false, meSkill: 0.62 });
  assert.equal(S.flying, true, 'a pursuit always starts flying');
  const order = Object.keys(S.slots).sort((a, b) => S.slots[a] - S.slots[b]);
  assert.equal(S.slots[order[0]], 0); assert.ok(S.slots[order.at(-1)] >= 15, JSON.stringify(S.slots));
  for (const r of S.rivals) assert.ok(Math.abs(S.skills[r.id] - (r.skill)) < 1e-9);
  // the slowest skill starts first: the slots fall as the skill rises
  const bySkill = S.rivals.slice().sort((a, b) => a.skill - b.skill);
  for (let i = 1; i < bySkill.length; i++) assert.ok(S.slots[bySkill[i].id] >= S.slots[bySkill[i - 1].id]);
  // the later her start, the further back on her lane
  const back = (p) => -side(S.line, p.x, p.z);
  for (const r of S.rivals) for (const q of S.rivals) if (S.slots[r.id] > S.slots[q.id] + 4) assert.ok(back(r.pose0) > back(q.pose0), `${r.name} (${S.slots[r.id]} s) behind ${q.name} (${S.slots[q.id]} s)`);
  const log = []; let t = 0;
  while (t < 90) { t += DT; S.advanceTo(t); log.push(...S.drain()); }
  for (const r of S.rivals) {
    const st = log.find((e) => e.type === 'started' && e.id === r.id);
    assert.ok(st && st.delayS >= S.slots[r.id] - PURSUIT.earlyS && st.delayS <= S.slots[r.id] + 6, `${r.name}: over at ${st?.delayS?.toFixed(1)} s, her time ${S.slots[r.id]} s`);
  }
  assert.equal(log.filter((e) => e.type === 'earlyStart').length, 0);
});

test('a boat over her own pursuit line early owes a penalty turn (Club, Pro); Beginner forgives', () => {
  for (const forgiving of [false]) {   // Beginner's forgiving too: v2/tests/slow/regatta-events.slow.mjs
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

test('the time trial: the best run per course and length kept with its splits and path, replaced only by a better one, checked on read', () => {
  const st = memStore(), h = { course: 'harbour-dash', length: 'club', laps: 1 }, key = trialKey(h);
  assert.equal(key, 'harbour-dash|club|1'); assert.notEqual(trialKey({ ...h, length: 'short' }), key);
  assert.equal(loadTrial(st, key), null);
  const path = Array.from({ length: 200 }, (_, i) => [i * 0.5, i * 2, i]);
  let r = recordTrial(st, key, { t: 190.04, splits: [80.2, 140.7], path });
  assert.equal(r.isNew, true); assert.equal(r.prev, null); assert.equal(loadTrial(st, key).t, 190);
  assert.deepEqual(loadTrial(st, key).splits, [80.2, 140.7]); assert.equal(loadTrial(st, key).path.length, 200);
  r = recordTrial(st, key, { t: 195, splits: [79, 150], path });
  assert.equal(r.isNew, false); assert.equal(r.best.t, 190, 'a slower run never replaces the best');
  r = recordTrial(st, key, { t: 185.5, splits: [77, 138], path: path.slice(0, 50) });
  assert.equal(r.isNew, true); assert.equal(r.prev.t, 190); assert.equal(loadTrial(st, key).path.length, 50);
  // clamped on read: a broken best is dropped, a broken split or point ends the list there
  assert.equal(clampTrial({ t: -1 }), null); assert.equal(clampTrial({ t: 'x' }), null); assert.equal(clampTrial(null), null);
  const c = clampTrial({ t: 100, splits: [30, 20, 50], path: [[0, 0, 0], [1, 1, 1], [2, 2, 0.5], [3, 3, 3]] });
  assert.deepEqual(c.splits, [30]); assert.equal(c.path.length, 2);
  st.setItem(TRIAL_KEY, '{'); assert.equal(loadTrial(st, key), null);
  st.setItem(TRIAL_KEY, JSON.stringify({ [key]: { t: 1e9 } })); assert.equal(loadTrial(st, key), null);
  // the course's frame: a run kept on one day's course replays on another's (turned and moved)
  const L1 = { centre: [100, -50], up: [0, -1], dir: [1, 0], pin: [60, -50], committee: [140, -50] }, L2 = { centre: [-300, 200], up: [1, 0], dir: [0, 1], pin: [-300, 160], committee: [-300, 240] };
  const [a, u] = toFrame(L1, 130, -110), back1 = fromFrame(L1, a, u), on2 = fromFrame(L2, a, u);
  assert.ok(Math.abs(back1[0] - 130) < 1e-9 && Math.abs(back1[1] + 110) < 1e-9);
  assert.ok(Math.abs(on2[0] - (-300 + 60)) < 1e-9 && Math.abs(on2[1] - (200 + 30)) < 1e-9, JSON.stringify(on2));
  // the ghost: where the best run was at a clock, between its points; none before or after it
  const pts = [[0, 0, 0], [10, 0, 2], [10, -10, 4]];
  assert.deepEqual(ghostAt(pts, 1), { x: 5, z: 0, heading: Math.PI / 2 }); const g = ghostAt(pts, 3); assert.ok(Math.abs(g.x - 10) < 1e-9 && Math.abs(g.z + 5) < 1e-9 && Math.abs(g.heading) < 1e-9);
  assert.equal(ghostAt(pts, -1), null); assert.equal(ghostAt(pts, 5), null);
  assert.ok(thin(path, 40).length <= 41 && thin(path, 40).at(-1) === path.at(-1));
  // the splits against the best
  assert.equal(splitDelta(78.0, 80.1), -2.1); assert.equal(splitWord(1, 78.0, 80.1), 'Mark 1 · 1:18.0 · 2.1 s faster');
  assert.equal(splitWord(2, 141.2, 140.7), 'Mark 2 · 2:21.2 · 0.5 s slower'); assert.equal(splitWord(1, 62.4, null), 'Mark 1 · 1:02.4');
  assert.equal(splitsLine([{ n: 1, t: 78, d: -2.1 }, { n: 2, t: 141.2, d: 0.5 }]), 'Mark 1 −2.1 s · Mark 2 +0.5 s');
  assert.equal(splitsLine([{ n: 1, t: 62.4, d: null }]), 'Mark 1 1:02.4');
});

test('a time trial sails alone: no rivals in the session, the course to herself', () => {
  const { course, windAt } = world({ seed: 1 });
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const h = customHand({ ...DEFAULT_SETUP, custom: clampCustom({ event: 'trial', rivals: 4 }) }, 1);
  const S = createRegattaSession({ course, me: { phys }, rivals: h.rivals, windAt, seed: 1, flying: true, pace: 2, gunWaits: true, event: h.event });
  assert.equal(S.rivals.length, 0); assert.deepEqual(S.race.ids, ['me']);
});
