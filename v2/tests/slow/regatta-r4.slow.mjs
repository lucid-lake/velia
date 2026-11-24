// The slow half of v2/tests/regatta-r4.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): the rivals start clean and round every mark on seed 1 (the fast suite's pack test checks the same on seed 2).
// Regatta R4 on v2 (BACKLOG-v2 #12, § 8, § 10.5): the fleet. No browser: the 6-boat cap with the full fleet by
// default; the rivals start clean from their boxes and round the marks; the pack is kept by skill (each rival's skill fixed for the
// race, whatever its place: no rubber band, nothing that speeds a boat up when behind) and finishes inside a band; the right of way
// (who keeps clear, and the heading that does it); the friendly entry (sailing at once, off the wind, on her lane); the pace (the
// level's game speed, the shorter course) and the moments (a crossing, a place, the last leg); the ladder's gap words.
// The rendering half: v2/tests/regatta-r4-render.test.mjs; the browser half: v2/tests/pages/regatta.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, steadyWind } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../../src/sim/race/course.js';
import { side } from '../../../src/sim/race/line.js';
import { RACE, fleetSize } from '../../regatta/plan.js';
import { createRegattaSession, FLEET, ENTRY } from '../../regatta/session.js';
import { FleetRival, giveWay, skillFor, FLEET_TIER } from '../../regatta/fleet.js';
import { courseToWind } from '../../regatta/geometry.js';
import { LEVELS, aidsFor } from '../../sim/raceLevels.js';
import { COURSE_SCALE } from '../../regatta/index.js';
import { createMoments } from '../../regatta/moments.js';
import { ladderGap, placeWord } from '../../regatta/ui.js';
import { RACE_TAB_CSS } from '../../ui/raceLevelRow.js';

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

test('the rivals start clean (never over early, all started within 12 s of the gun) and round every mark (Beginner; seed 2 in the pack test below)', () => {
  for (const seed of [1]) {
    const { S, log } = fleetRace({ seed });
    const ocs = log.filter((e) => e.type === 'ocs' && e.id !== 'me');
    assert.equal(ocs.length, 0, `seed ${seed}: over early: ${JSON.stringify(ocs)}`);
    for (const r of S.rivals) {
      const st = log.find((e) => e.type === 'started' && e.id === r.id);
      assert.ok(st && st.delayS >= 0 && st.delayS < 12, `seed ${seed}: ${r.name} started ${st?.delayS?.toFixed(1)} s after the gun`);
      const marks = log.filter((e) => e.type === 'rounded' && e.id === r.id).map((e) => e.mark);
      assert.deepEqual(marks, ['W', 'I'], `seed ${seed}: ${r.name} rounded ${marks.join(', ')}`);
      assert.equal(S.race.view(r.id).status, 'finished', `seed ${seed}: ${r.name} finished`);
    }
  }
});

