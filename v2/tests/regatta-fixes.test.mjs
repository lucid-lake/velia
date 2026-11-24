// The Regatta race fixes (2026-11-18; the owner: "start fixing race bugs", after the social clips' film found them). No browser.
//   the start helper never over early: a luff drifts a keelboat over the line in light air (filmed: seeds 1 and 6 at wind 2 went over
//     at the gun and restarted 70-90 s late): her luff let the jib drive on; now the jib flies too, and a luff that would still carry
//     her over bears away along the line (helper.js COAST)
//   no rival sits in irons: a stalled rival recovers at once (fleet.js STALL); the multi-seed sweeps: tests/slow/regatta-fixes.slow.mjs
// The level of detail (no swap within 150 m, the colour with the boat): v2/tests/regatta-r4-render.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { createRegattaSession } from '../regatta/session.js';
import { courseToWind } from '../regatta/geometry.js';
import { STALL } from '../regatta/fleet.js';

const DEG = Math.PI / 180;
const ISLAND = courseFor('tahoe-emerald', 'island-sprint');

// an untouched start in a full fleet: the player's boat on the helper's hands from −0:45 until she starts (or +15 s)
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

test('the start helper is never over early in light air in a full fleet (seed 5 at 2 m/s went over at the gun before the fix)', () => {
  const { ocs, started } = helperStart({ seed: 5, speedMs: 2 });
  assert.equal(ocs, 0, 'never over the line before the gun');
  assert.ok(started != null && started >= 0 && started < 8, `started ${started?.toFixed(1)} s after the gun`);
});

// a rival dying head to wind mid-race (as filmed near mark 1: 15 degrees off it at 1.2 m/s, slowing): she bears away while her rudder
// still bites and never sits in irons (under 0.5 m/s within 40 degrees of the wind)
function ironsTime({ seed = 1, dir = 210, speedMs = 5, who = 0, at = 12, maxS = 12, offDeg = 15, v0 = 1.2 } = {}) {
  const course = courseToWind(ISLAND, dir, { loadCourse, snapCourse });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, windAt, seed, tier: 'easy' });
  let t = 0;
  while (S.race.clock < at) { t += DT; S.advanceTo(t); S.drain(); }
  const r = S.rivals[who], q = r.phys.state, w = windAt(q.x, q.z, t), from = Math.atan2(-w.vx, w.vz);
  Object.assign(r.phys, new BoatPhysics({ x: q.x, z: q.z, heading: from + offDeg * DEG, speed: v0, vessel: r.phys.vessel }));   // luffed nearly head to wind, her way going
  let stuck = 0, worst = 0;
  for (let k = 0; k < maxS / DT; k++) {
    t += DT; S.advanceTo(t); S.drain();
    const s = r.phys.state, st = (s.u ?? 0) < 0.5 && Math.abs(s.trueWind?.angle ?? 3) < 40 * DEG;
    stuck = st ? stuck + DT : 0; worst = Math.max(worst, stuck);
  }
  return { worst, status: S.race.view(r.id).status, unstalls: r.brain.unstalls ?? 0 };
}

test('a rival dying head to wind bears away at once (backs the jib, eases the main; never sits in irons), on either tack', () => {
  for (const [seed, speedMs, offDeg] of [[1, 5, -15]]) {   // the other tack: v2/tests/slow/regatta-fixes.slow.mjs
    const { worst, status } = ironsTime({ seed, speedMs, offDeg });
    assert.equal(status, 'racing');
    assert.ok(worst < 3, `seed ${seed} at ${speedMs} m/s, ${offDeg} degrees: in irons ${worst.toFixed(1)} s (the recovery starts after ${STALL.s} s)`);
  }
});
