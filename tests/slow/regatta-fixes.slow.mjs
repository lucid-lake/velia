// The Regatta race fixes' sweeps (2026-11-18; the fast half: v2/tests/regatta-fixes.test.mjs). No browser.
//   the start helper never over early: 6 seeds x 5 wind speeds (1.2-8 m/s) x 2 directions in a full fleet (before the fix 10 starts
//     of 40 at 1.5-4 m/s went over at the gun)
//   no rival in irons: whole fleet races (rivals only, 4 seeds x 2 winds); no racing rival sailing alone sits under 0.5 m/s within
//     40 degrees of the wind for IRONS_MAX_S or more (two boats in contact can still hold each other longer: bounded, reported)
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { createRegattaSession } from '../../v2/regatta/session.js';
import { courseToWind } from '../../v2/regatta/geometry.js';
import { COURSE_SCALE } from '../../v2/regatta/index.js';

const DEG = Math.PI / 180;
const ISLAND = courseFor('tahoe-emerald', 'island-sprint');
const IRONS_MAX_S = 8;

// an untouched start in a full fleet (as v2/tests/regatta-fixes.test.mjs): the helper's hands from −0:45 until she starts (or +15 s)
function helperStart({ seed, dir = 200, speedMs, rivals = 5 }) {
  const course = courseToWind(ISLAND, dir, { loadCourse, snapCourse });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed, tier: 'easy', round: 'beginner' });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  const ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind };
  let t = 0, ocs = 0, started = null;
  while (started == null && S.race.clock < 15) {
    S.helperTick(ctl, t); env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t);
    for (const e of S.drain()) { if (e.type === 'ocs' && e.id === 'me') ocs++; if (e.type === 'started' && e.id === 'me') started = e.delayS; }
  }
  return { ocs, started };
}

test('the start helper is never over early: 6 seeds x 5 winds x 2 directions, a full fleet', () => {
  const bad = [], late = [];
  for (const dir of [200, 230]) for (const speedMs of [1.2, 2, 3, 5, 8]) for (let seed = 1; seed <= 6; seed++) {
    const { ocs, started } = helperStart({ seed, dir, speedMs });
    if (ocs) bad.push(`seed ${seed} ${speedMs} m/s from ${dir}`);
    if (!(started >= 0 && started < 15)) late.push(`seed ${seed} ${speedMs} m/s from ${dir}: ${started}`);
  }
  assert.deepEqual(bad, [], 'never over the line before the gun');
  assert.deepEqual(late, [], 'started within 15 s of the gun');
});

// a whole fleet race, the player parked far away: the longest stall head to wind of a racing rival sailing alone (no boat within
// TANGLE_M of her at any moment of it) and the longest of a tangle (two hulls in contact: the contact's impulses, not her crew, hold her)
const TANGLE_M = 10;
function longestIrons({ seed, dir, speedMs, maxS = 420 }) {
  const course = courseToWind(ISLAND, dir, { loadCourse, snapCourse, scale: COURSE_SCALE.race });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, windAt, seed, tier: 'easy', round: 'beginner' });
  const run = {}, near = {}; const worst = { solo: { s: 0 }, tangle: { s: 0 } };
  let t = 0;
  while (t < maxS + 45 && !S.rivals.every((r) => S.race.view(r.id).status === 'finished')) {
    t += DT; S.advanceTo(t); S.drain();
    for (const r of S.rivals) {
      const s = r.phys.state, st = S.race.view(r.id).status === 'racing' && (s.u ?? 0) < 0.5 && Math.abs(s.trueWind?.angle ?? 3) < 40 * DEG;
      const nd = Math.min(...S.rivals.filter((q) => q !== r).map((q) => Math.hypot(q.phys.state.x - s.x, q.phys.state.z - s.z)));
      if (st) { run[r.id] = (run[r.id] ?? 0) + DT; near[r.id] = Math.min(near[r.id] ?? Infinity, nd); } else { run[r.id] = 0; near[r.id] = Infinity; }
      const k = near[r.id] < TANGLE_M ? 'tangle' : 'solo';
      if (run[r.id] > worst[k].s) worst[k] = { s: run[r.id], id: r.id, clock: S.race.clock };
    }
  }
  return worst;
}

test(`no rival sitting alone sits in irons for ${IRONS_MAX_S} s or more: whole fleet races, 4 seeds x 2 winds`, () => {
  const bad = [], tangles = [];
  for (const [dir, speedMs] of [[210, 3], [230, 7]]) for (let seed = 1; seed <= 4; seed++) {
    const w = longestIrons({ seed, dir, speedMs });
    if (w.solo.s >= IRONS_MAX_S) bad.push(`seed ${seed} ${speedMs} m/s from ${dir}: ${w.solo.id} ${w.solo.s.toFixed(1)} s at ${w.solo.clock.toFixed(0)} s`);
    tangles.push(w.tangle.s);
  }
  assert.deepEqual(bad, []);
  assert.ok(Math.max(...tangles) < 45, `a tangle of two boats lasts under 45 s (${Math.max(...tangles).toFixed(1)} s; 50 s before the fixes)`);
});
