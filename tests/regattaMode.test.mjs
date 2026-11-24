// The Regatta mode's session (commit 4): two boats, the course and the race; R resets to -60 s in one call;
// dispose leaves no listeners and no __lakeshore keys. The drawing (src/modes/regatta/index.js) needs the GPU; this runs the
// session on the real BoatPhysics with the dom stub. The mode's own dispose (the R key, __lakeshore.regatta, the rival, the
// boat's wind) runs in a real browser: tests/pages/regattaDispose.page.mjs (retired 2026-11-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics } from '../src/sim/boat.js';
import { courseFor } from '../src/sim/race/course.js';
import { createSession, installRestartKey, BOATS } from '../classic/src/modes/regatta/session.js';
import { startPoses } from '../src/sim/race/sim.js';
import { windFn } from './helpers/skipper-sim.mjs';
import { install, key } from './helpers/dom-stub.mjs';
import { modeId } from '../src/modeNames.js';

const DEG = Math.PI / 180;
const course = courseFor('tahoe-emerald', 'island-sprint');
const wind = windFn({ kn: 14, fromDeg: 210 });
function boats() {
  const [a, b] = startPoses(course, 210 * DEG, ['me', 'wren']);
  const mk = (p) => { const phys = new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed }); return { phys, step: (dt, ctl, t, windAt) => phys.step(dt, ctl, { t, windAt }) }; };
  return { me: mk(a), wren: mk(b) };
}

test('start builds two boats, the course and the race at -60 s; ?mode=regatta is the Regatta mode', () => {
  const { me, wren } = boats();
  const s = createSession({ course, me, wren, baseWind: wind, tier: 'medium', seed: 3 });
  assert.deepEqual(BOATS.map((b) => b.id), ['me', 'wren']);
  assert.equal(s.race.clock, -60);
  assert.deepEqual(s.race.ids, ['me', 'wren']);
  assert.equal(s.race.view('wren').sail, 17);
  assert.equal(s.race.course.name, 'The Island Sprint');
  assert.equal(modeId('regatta'), 'regatta');
  assert.equal(s.brain.skill, 0.5);
});

test('R resets to -60 s in one call: boats, race, the rival\'s mind; the session keeps its tier and seed', () => {
  const { me, wren } = boats();
  const s = createSession({ course, me, wren, baseWind: wind, tier: 'hard', seed: 9, autoplay: true });
  const x0 = me.phys.state.x;
  s.step(90);
  assert.ok(s.race.clock > 25, `clock ${s.race.clock}`);
  assert.ok(Math.hypot(me.phys.state.x - x0, 1) > 20, 'the boat has moved');
  assert.ok(s.log.length > 3, 'events logged');
  install(); const remove = installRestartKey(s);
  key('KeyR');
  remove();
  assert.equal(s.restarts, 1);
  assert.equal(s.race.clock, -60);
  assert.ok(Math.abs(me.phys.state.x - x0) < 1e-6 && me.phys.state.u === 1.54);
  assert.equal(s.log.length, 0);
  assert.equal(s.brain.skill, 0.8, 'the hard tier again');
  assert.equal(s.brain.sk.startCommitted, false);
  // and the same race again from the restart
  s.step(30);
  assert.ok(s.race.clock > -31 && s.race.clock < -29);
});

test('the R key\'s remover leaves no listener (the mode\'s dispose: tests/pages/regattaDispose.page.mjs (retired 2026-11-18))', () => {
  const { me, wren } = boats();
  const s = createSession({ course, me, wren, baseWind: wind });
  install();
  const off = installRestartKey(s);
  key('KeyR'); assert.equal(s.restarts, 1);
  off();
  key('KeyR'); assert.equal(s.restarts, 1, 'the listener is gone');
});
