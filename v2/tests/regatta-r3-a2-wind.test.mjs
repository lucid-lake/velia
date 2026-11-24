// Refactor round 3, A2 bug 8: the right of way and the rules read the wind at the line, not the course's design wind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, DT } from '../../src/sim/boat.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { createRegattaSession } from '../regatta/session.js';
import { courseToWind } from '../regatta/geometry.js';

const DEG = Math.PI / 180;

test('race.step gets the wind from the line (20 degrees off the design wind), not the design wind', () => {
  const course = courseToWind(courseFor('tahoe-emerald', 'island-sprint'), 200, { loadCourse, snapCourse });
  const dirFrom = course.designWindFrom + 20, from = dirFrom * DEG;   // the wind at the line blows from 20 degrees round
  const windAt = () => ({ vx: -Math.sin(from) * 6, vz: Math.cos(from) * 6 });
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, windAt, seed: 1, tier: 'easy' });
  const seen = [], step = S.race.step.bind(S.race);
  S.race.step = (dt, poses, o) => { seen.push(o?.windFrom); return step(dt, poses, o); };
  S.advanceTo(DT * 5);
  assert.ok(seen.length >= 3);
  for (const w of seen) assert.ok(Math.abs(Math.atan2(Math.sin(w - from), Math.cos(w - from))) < 1e-6, `rules wind ${(w / DEG).toFixed(2)} deg, line wind ${dirFrom.toFixed(2)} deg`);
});
