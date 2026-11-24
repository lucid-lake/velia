// Regatta R4 on v2 (BACKLOG-v2 #12, § 8, § 10.5): the fleet. No browser: the 6-boat cap with the full fleet by
// default; the rivals start clean from their boxes and round the marks; the pack is kept by skill (each rival's skill fixed for the
// race, whatever its place: no rubber band, nothing that speeds a boat up when behind) and finishes inside a band; the right of way
// (who keeps clear, and the heading that does it); the friendly entry (sailing at once, off the wind, on her lane); the pace (the
// level's game speed, the shorter course) and the moments (a crossing, a place, the last leg); the ladder's gap words.
// The rendering half: v2/tests/regatta-r4-render.test.mjs; the browser half: v2/tests/pages/regatta.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { side } from '../../src/sim/race/line.js';
import { RACE, fleetSize } from '../regatta/plan.js';
import { createRegattaSession, FLEET, ENTRY } from '../regatta/session.js';
import { FleetRival, giveWay, skillFor, FLEET_TIER } from '../regatta/fleet.js';
import { courseToWind } from '../regatta/geometry.js';
import { LEVELS, aidsFor } from '../sim/raceLevels.js';
import { COURSE_SCALE } from '../regatta/index.js';
import { createMoments } from '../regatta/moments.js';
import { ladderGap, placeWord } from '../regatta/ui.js';
import { RACE_TAB_CSS } from '../ui/raceLevelRow.js';

const DEG = Math.PI / 180;
const ISLAND = courseFor('tahoe-emerald', 'island-sprint');
const wrap = (a) => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a; };

// a fleet race with the player parked far away (out of the race): the rivals alone, tick by tick, to the last finisher or `maxS`
function fleetRace({ seed = 1, tier = 'easy', dir = 210, maxS = 700, forgiving = true, scale = COURSE_SCALE.race } = {}) {
  const course = courseToWind(ISLAND, dir, { loadCourse, snapCourse, scale });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, windAt, seed, tier, forgiving });
  const log = [], skills = S.rivals.map(() => new Set());
  let t = 0;
  while (t < maxS + 45 && !S.rivals.every((r) => S.race.view(r.id).status === 'finished')) {
    t += DT; S.advanceTo(t); log.push(...S.drain());
    if (Math.round(t / DT) % 30 === 0) S.rivals.forEach((r, i) => skills[i].add(r.brain.sk.skill));
  }
  return { S, log, skills, course };
}

test('the fleet: 5 rivals by default (6 boats, owner 2026-11-14), never more; each with a sail number and a hull colour', () => {
  assert.equal(RACE.rivals, 5); assert.equal(fleetSize(), 6); assert.equal(fleetSize(9), 6);
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course: courseToWind(ISLAND, 210, { loadCourse, snapCourse }), me: { phys }, windAt: () => ({ vx: 2.5, vz: -4.3 }), seed: 1 });
  assert.equal(S.rivals.length, 5); assert.equal(S.race.ids.length, 6);
  assert.equal(new Set(FLEET.map((f) => f.sail)).size, 5); assert.equal(new Set(FLEET.map((f) => f.hull)).size, 5);
  for (const f of FLEET) assert.match(f.hull, /^#[0-9a-f]{6}$/);
  // every box on its own lane: no two boats within 8 m at the entry
  const ps = [S.me0, ...S.rivals.map((r) => r.pose0)];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z) > 8, `boxes ${i} and ${j} apart`);
});

test('the pack is kept by skill: each rival\'s skill is fixed for the race (no rubber band, no catch-up), the finish inside a band', () => {
  const { S, log, skills } = fleetRace({ seed: 2 });
  S.rivals.forEach((r, i) => assert.deepEqual([...skills[i]], [skillFor('easy', r.id)], `${r.name}'s skill never moved with its place`));
  // the same race starts clean (never over early, all started within 12 s of the gun) and rounds every mark (Beginner; seed 1 in
  // v2/tests/slow/regatta-r4.slow.mjs)
  assert.equal(log.filter((e) => e.type === 'ocs' && e.id !== 'me').length, 0, 'no rival over early');
  for (const r of S.rivals) {
    const st = log.find((e) => e.type === 'started' && e.id === r.id);
    assert.ok(st && st.delayS >= 0 && st.delayS < 12, `${r.name} started ${st?.delayS?.toFixed(1)} s after the gun`);
    assert.deepEqual(log.filter((e) => e.type === 'rounded' && e.id === r.id).map((e) => e.mark), ['W', 'I'], `${r.name} rounded both marks`);
  }
  // the band: the spread of the skills is small round the tier (0.10 in all), the fleet finishes within the winner's own time again
  const sk = S.rivals.map((r) => r.brain.base);
  assert.ok(Math.max(...sk) - Math.min(...sk) <= 0.1 + 1e-9 && Math.abs(sk.reduce((a, b) => a + b) / sk.length - FLEET_TIER.easy) < 0.03, JSON.stringify(sk));
  const fin = log.filter((e) => e.type === 'finished' && e.id !== 'me').map((e) => e.t);
  assert.equal(fin.length, 5);
  assert.ok(Math.max(...fin) - Math.min(...fin) < Math.min(...fin), `spread ${(Math.max(...fin) - Math.min(...fin)).toFixed(0)} s vs the winner's ${Math.min(...fin).toFixed(0)} s`);
  // v1's band, called with any gap, leaves the skill alone (behind by 40 lengths, ahead by 40, on the last leg or not)
  const r = new FleetRival({ course: ISLAND, skill: 0.5, windAt: steadyWind(5, 210) });
  for (const g of [-40, -5, 0, 5, 40]) { r.band(60, g); assert.equal(r.sk.skill, 0.5, `gap ${g}`); }
  // the levels' tiers stay in v1's order
  assert.ok(skillFor('easy', 'tern') < skillFor('medium', 'tern') && skillFor('medium', 'tern') < skillFor('hard', 'tern'));
});

test('the right of way: port keeps clear of starboard (a duck under her stern), windward of leeward; the stand-on boat holds on', () => {
  const wf = 210 * DEG, sp = 2.6;
  const at = (h, d) => ({ x: -Math.sin(h * DEG) * d, z: Math.cos(h * DEG) * d, heading: h * DEG, u: sp });
  const port = at(255, 26), stbd = at(165, 26);   // converging on the origin in 10 s
  const g = giveWay(port, [stbd], wf);
  assert.ok(g && !g.standOn && g.rule === 'port and starboard', JSON.stringify(g && { rule: g.rule, standOn: g.standOn }));
  assert.ok(wrap(g.heading - port.heading) > 0, 'the port boat bears away (a duck)');
  assert.ok(Math.abs(wrap(wf - g.heading)) >= 42 * DEG - 1e-9, 'never into the no-go');
  assert.equal(giveWay(stbd, [port], wf), null, 'starboard holds her course');
  // two boats side by side on parallel courses keep their lanes
  const a = { x: 0, z: 0, heading: 165 * DEG, u: sp }, b = { x: 8, z: 3, heading: 165 * DEG, u: sp };
  assert.equal(giveWay(a, [b], wf), null); assert.equal(giveWay(b, [a], wf), null);
});

test('the entry is friendly: in her box, sailing above 1.5 m/s within 1 s, 40° or more off the wind, on her lane (3 seeds × 3 winds)', () => {
  for (const dir of [190, 210, 250]) for (const seed of [1, 2, 3]) {
    const course = courseToWind(ISLAND, dir, { loadCourse, snapCourse, scale: COURSE_SCALE.race });
    const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir } });
    const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
    const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
    const S = createRegattaSession({ course, me: { phys }, windAt, seed });
    Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
    const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind };
    let t = 0, minU = Infinity, minOff = Infinity;
    for (let i = 0; i < 60; i++) {
      S.helperTick(ctl, t); env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t);
      const s = phys.state; minU = Math.min(minU, s.u); minOff = Math.min(minOff, Math.abs(s.trueWind.angle));
    }
    const s = phys.state, lane = S.me0.heading, dx = s.x - S.me0.x, dz = s.z - S.me0.z;
    const cross = Math.abs(dx * Math.cos(lane) + dz * Math.sin(lane));   // off her lane's line, sideways
    assert.ok(minU > 1.5, `dir ${dir} seed ${seed}: ${minU.toFixed(2)} m/s at least`);
    assert.ok(minOff >= 40 * DEG, `dir ${dir} seed ${seed}: ${(minOff / DEG).toFixed(0)}° off the wind`);
    assert.ok(cross < 3 && side(course.line, s.x, s.z) < -20, `dir ${dir} seed ${seed}: ${cross.toFixed(1)} m off her lane, ${(-side(course.line, s.x, s.z)).toFixed(0)} m below the line`);
    for (const r of S.rivals) { const w = windAt(r.pose0.x, r.pose0.z, 0); assert.ok(Math.abs(wrap(Math.atan2(-w.vx, w.vz) - r.pose0.heading)) >= 40 * DEG && r.pose0.speed >= ENTRY.minMs, `${r.name}'s entry`); }
  }
});

test('the pace: 2 × at Beginner and Club, 1.5 × at Pro; the race course at 0.35 of the Island Sprint, still a beat, a rounding, a reach and a run', () => {
  assert.equal(LEVELS.beginner.pace, 2); assert.equal(LEVELS.club.pace, 2); assert.equal(LEVELS.pro.pace, 1.5);
  assert.equal(aidsFor('club').pace, 2);
  assert.equal(COURSE_SCALE.race, 0.35); assert.equal(COURSE_SCALE.full, 1);
  const c = courseToWind(ISLAND, 210, { loadCourse, snapCourse, scale: COURSE_SCALE.race });
  assert.deepEqual(c.legs.map((l) => l.toId), ['W', 'I', 'finish']);
  assert.ok(c.totalM > 350 && c.totalM < 450 && c.legs[0].len > 150, `${c.totalM.toFixed(0)} m, the beat ${c.legs[0].len.toFixed(0)} m`);
});

test('the moments: a crossing with who keeps clear, a place won, the last leg, a quiet board\'s status, each kind quiet for a while', () => {
  const M = createMoments({ names: { tern: 'Tern', wren: 'Osprey' } });
  const wf = 210 * DEG, at = (h, d, u = 2.6) => ({ x: -Math.sin(h * DEG) * d, z: Math.cos(h * DEG) * d, heading: h * DEG, u, trueWind: { angle: 0 } });
  const me = at(255, 26), tern = { id: 'tern', state: at(165, 26) }, wren = { id: 'wren', state: at(165, 140) };
  const view = { status: 'racing' };
  let o = M.update(10, { me, rivals: [tern, wren], order: ['wren', 'tern', 'me'], view, windFrom: wf });
  assert.ok(o.some((m) => m.id === 'cross' && /Tern is on starboard/.test(m.text)), JSON.stringify(o));
  o = M.update(12, { me, rivals: [tern, wren], order: ['wren', 'tern', 'me'], view, windFrom: wf });
  assert.ok(!o.some((m) => m.id === 'cross'), 'quiet after a crossing');
  M.update(20, { me: at(255, 300), rivals: [tern, wren], order: ['wren', 'me', 'tern'], view, windFrom: wf });
  o = M.update(25, { me: at(255, 300), rivals: [tern, wren], order: ['wren', 'me', 'tern'], view, windFrom: wf });
  assert.ok(o.some((m) => m.id === 'place' && /You passed Tern: 2nd of 3/.test(m.text)), JSON.stringify(o));
  o = M.update(40, { me: at(255, 300), rivals: [tern, wren], order: ['wren', 'me', 'tern'], view, windFrom: wf, finishLeg: true });
  assert.ok(o.some((m) => m.id === 'lastLeg' && /Last leg! 2nd of 3, Osprey/.test(m.text)), JSON.stringify(o));
  o = M.update(70, { me: at(255, 300), rivals: [tern, wren], order: ['wren', 'me', 'tern'], view, windFrom: wf, cardIdleS: 30, markM: 120, markName: 'W' });
  assert.ok(o.some((m) => m.id === 'status' && /W in 120 m\. You are 2nd of 3/.test(m.text)), JSON.stringify(o));
});

test('the ladder\'s words: metres on a beat, seconds after a mark; the folded phone line; Setup\'s five tabs fit the title\'s line on a phone', () => {
  assert.equal(ladderGap({ s: 12.4, m: 38.2 }, true), '+38 m'); assert.equal(ladderGap({ s: 12.4, m: 38.2 }, false), '+12 s'); assert.equal(ladderGap({ s: 0, m: 0 }, true), '');
  assert.equal(placeWord(1, 6), '2nd of 6'); assert.equal(placeWord(5, 6), '6th of 6');
  assert.match(RACE_TAB_CSS, /\[data-screen~=narrow\]/, 'a narrow layout (src/core/profile.js LIMITS.narrow: 640 px)'); assert.match(RACE_TAB_CSS, /\.tab\{padding/);
});
