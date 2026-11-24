// The slow half of v2/tests/regatta-flying.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): AUTO straight and the helper cross at the gun on every course and wind (the fast suite keeps the Island Sprint at 210 degrees).
// Regatta's flying start (no long wait in the box before the gun): the fleet laid already sailing at speed toward the line, a short
// countdown with a 2–3 s spare to ease away; the gun waits for the first bow at Beginner and Club (nobody can be over early), Pro judges
// early as OCS; the classic box unchanged; the deal (Beginner and Club always flying, Pro now and then the box); the Custom Start row;
// the coach's words. No browser: the real BoatPhysics on the real wind field, v1's race rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, DT, Helm } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { courseFor, courseIds, loadCourse, snapCourse } from '../../../src/sim/race/course.js';
import { side } from '../../../src/sim/race/line.js';
import { courseToWind } from '../../regatta/geometry.js';
import { createRegattaSession, FLY, sailToLine } from '../../regatta/session.js';
import { dealHand, handSeed, customHand, describeHand, clampCustom, isFlying, STARTS, DEFAULT_CUSTOM, DEFAULT_SETUP, PRESETS, DEAL_CLASSIC } from '../../regatta/setup.js';
import { customDials } from '../../regatta/hub.js';
import { createCoach, STEPS } from '../../regatta/coach.js';
import { raceLine } from '../../../src/ui/phoneQuiet.js';

const DEG = Math.PI / 180;
const WATERS = 'tahoe-emerald';
// the winds of the sweep: the lake's default, a fresh one from the west, a light air from the south-east, a strong northerly
const WINDS = [[210, null], [250, 7], [140, 2.2], [20, 12]];

function setup({ id = 'island-sprint', dir = 210, speedMs = null, seed = 1, rivals = 1, pace = 2, gunWaits = true, helper = false, flying = true, prestartS } = {}) {
  const course = courseToWind(courseFor(WATERS, id, { scale: 0.35 }), dir, { loadCourse, snapCourse });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, ...(speedMs ? { speedMs } : {}) } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: 0, z: 0, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed, flying, pace, gunWaits, helper, ...(prestartS ? { prestartS } : {}) });
  Object.assign(phys, new BoatPhysics({ x: S.me0.x, z: S.me0.z, heading: S.me0.heading, speed: S.me0.speed }));
  return { S, phys, windAt };
}
// sail the player's boat from the start's pose: 'helper' (the start helper's hands), 'straight' (AUTO: her heading held, the crew
// trimming), or a fixed heading offset (deg, + freer) held the same way; until `afterS` past the gun
function sail(o, { how = 'straight', offDeg = 0, afterS = 6 } = {}) {
  const { S, phys } = o, ctl = { ...CONTROLS }, env = { t: 0, windAt: S.meWind }, helm = new Helm(), log = [], hold = S.me0.heading - offDeg * DEG;
  let t = 0;
  for (let i = 0; i < Math.round((S.prestartS + afterS) / DT); i++) {
    // straightThenHelper: AUTO straight on until she is over early, then the start helper's hands take her back below the line
    if (how === 'helper' || (how === 'straightThenHelper' && log.some((e) => e.type === 'ocs' && e.id === 'me'))) S.helperTick(ctl, t); else ctl.rudder = helm.toHeading(phys.state, hold, DT);
    env.t = t; phys.step(DT, ctl, env); t += DT; S.advanceTo(t); log.push(...S.drain());
  }
  const me = (type) => log.filter((e) => e.type === type && e.id === 'me');
  return { log, started: me('started')[0] ?? null, ocs: me('ocs'), gunEarly: log.find((e) => e.type === 'gunEarly') ?? null };
}

test('Beginner and Club: AUTO straight on crosses at the gun (it waits for her), the helper within ±1.5 s; never over early, on every course and wind', () => {
  for (const id of courseIds(WATERS)) for (const [dir, sp] of WINDS) {
    const tag = `${id} ${dir}°${sp ? ` ${sp} m/s` : ''}`;
    const a = sail(setup({ id, dir, speedMs: sp }), { how: 'straight' });
    assert.equal(a.ocs.length, 0, `${tag}: straight, never over early`);
    assert.ok(a.started && Math.abs(a.started.delayS) <= 1.5, `${tag}: straight, started ${a.started?.delayS?.toFixed(2)} s after the gun`);
    assert.ok(a.gunEarly?.id === 'me' && a.gunEarly.earlyS > 0, `${tag}: the gun waited for her bow (${JSON.stringify(a.gunEarly)})`);
    const b = sail(setup({ id, dir, speedMs: sp, helper: true }), { how: 'helper' });
    assert.equal(b.ocs.length, 0, `${tag}: the helper, never over early`);
    assert.ok(b.started && Math.abs(b.started.delayS) <= 1.5, `${tag}: the helper started ${b.started?.delayS?.toFixed(2)} s after the gun`);
  }
});

