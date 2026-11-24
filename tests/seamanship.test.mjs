// Day Sail's engine and tackle wiring, the pure parts (src/sail/seamanship.js): the engine-off line's rule
// (once, never nagging), the next sunrise for "wait for sunrise", the keys free of collisions. The live wiring:
// tools/probe_engine.mjs. Run: node --test tests/seamanship.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EngineNudge, nextSunrise, SEA } from '../classic/src/sail/seamanship.js';
import { KEYMAP, KEY, collisions } from '../src/sail/keys.js';
import { analyticSun } from '../src/sim/timeOfDay.js';

const sailing = { engineState: 'running', furl: 0, mainFill: 0.95, trueWind: { speed: 5 }, sog: 2.5 };

test('the engine-off line: after 20 s of sailing under engine, once; never for the sails down, a calm or a sailor', () => {
  const n = new EngineNudge();
  let fired = 0;
  for (let i = 0; i < 19 * 10; i++) fired += n.update(0.1, sailing) ? 1 : 0;
  assert.equal(fired, 0);
  for (let i = 0; i < 20 * 10; i++) fired += n.update(0.1, sailing) ? 1 : 0;
  assert.equal(fired, 1, 'once');
  for (let i = 0; i < 600 * 10; i++) fired += n.update(0.1, sailing) ? 1 : 0;
  assert.equal(fired, 1, 'never again this session');
  const calm = new EngineNudge(), down = new EngineNudge(), pro = new EngineNudge(), off = new EngineNudge();
  let c = 0;
  for (let i = 0; i < 600; i++) {
    c += calm.update(0.1, { ...sailing, trueWind: { speed: 1.5 } }) ? 1 : 0;
    c += down.update(0.1, { ...sailing, furl: 1 }) ? 1 : 0;
    c += pro.update(0.1, sailing, { muted: true }) ? 1 : 0;
    c += off.update(0.1, { ...sailing, engineState: 'off' }) ? 1 : 0;
  }
  assert.equal(c, 0);
  assert.ok(SEA.nudge.sailS >= 15);
});

test('wait for sunrise: the next dawn after a June evening is ≈ 05:30 PDT the next day', () => {
  const h = nextSunrise(20.6);
  assert.ok(h > 24 + 5.2 && h < 24 + 5.9, `sunrise at ${h.toFixed(2)} h`);
  const s = analyticSun(h - 24), e = Math.asin(s.y / Math.hypot(s.x, s.y, s.z)) * 180 / Math.PI;
  assert.ok(Math.abs(e + 0.83) < 0.2);
  assert.ok(nextSunrise(3) > 3 && nextSunrise(3) < 6, 'before dawn: the same morning');
});

test('the engine and tackle keys: in the table, no collisions', () => {
  assert.deepEqual(collisions().map(([a, b]) => `${a.code}: ${a.action} / ${b.action}`), []);
  for (const k of ['engine', 'ahead', 'astern', 'neutral', 'anchor', 'lines', 'sails']) assert.ok(KEYMAP.some((m) => m.code === KEY[k]), k);
});
