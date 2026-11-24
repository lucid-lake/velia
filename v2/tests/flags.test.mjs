// v2's URL flags (v2/engine/flags.js): the shared rows mean what v1's do; v2's own rows are typed; the scene params
// follow the capture contract (headless freezes the clock and the governor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseV2Flags, sceneParams, V2_ROWS, SHARED } from '../engine/flags.js';
import { FLAG_TABLE } from '../../src/sim/core/flags.js';

test('every shared row exists in v1\'s table; no v2 row shadows one', () => {
  const names = new Set(FLAG_TABLE.map((r) => r.name));
  for (const n of SHARED) assert.ok(names.has(n), `${n} is a row of src/core/flags.js`);
  for (const r of V2_ROWS) { assert.ok(!names.has(r.name), `${r.name} would shadow a v1 row`); assert.ok(r.doc.length > 8, `${r.name}: documented`); assert.deepEqual(r.parse(null), r.default); }
});

test('parse: the contract rows read as in v1, v2 rows typed with defaults', () => {
  const f = parseV2Flags('?hour=6.5&cam=A&seed=1&headless=1&exposure=5&gov=0&maxpx=2e6&msaa=4&t=2.5');
  assert.equal(f.hour, '6.5'); assert.equal(f.cam, 'A'); assert.equal(f.seed, '1'); assert.equal(f.headless, '1');
  assert.equal(f.exposure, 5); assert.equal(f.t, 2.5);
  assert.equal(f.gov, false); assert.equal(f.maxpx, 2e6); assert.equal(f.msaa, 4); assert.equal(f.dpr, 2);
  const d = parseV2Flags('');
  assert.equal(d.hour, null); assert.equal(d.gov, true); assert.equal(d.maxpx, 3.4e6); assert.equal(d.exposure, 6);
  assert.ok(Object.isFrozen(f));
  assert.equal(parseV2Flags(new URLSearchParams('maxpx=junk')).maxpx, 3.4e6, 'a bad number falls back');
});

test('sceneParams: headless freezes the clock and turns the governor off; hour wraps; msaa is 1 or 4', () => {
  const h = sceneParams(parseV2Flags('?hour=25.5&headless=1&timerate=10&camyaw=75'));
  assert.equal(h.hour, 1.5); assert.equal(h.headless, true); assert.equal(h.timerate, 0); assert.equal(h.gov, false);
  assert.equal(h.camYawDeg, 75); assert.equal(h.timing, true); assert.equal(h.exposure, 6); assert.equal(h.msaa, 4, 'MSAA 4 is the default since M1');
  const live = sceneParams(parseV2Flags('?timerate=10&msaa=1&scale=0.3&w=640&h=360'));
  assert.equal(live.hour, 18.75, 'v1 Sail\'s start hour when ?hour is absent'); assert.equal(live.timerate, 10); assert.equal(live.clockMode, 'rate', 'an explicit ?timerate is a constant rate'); assert.equal(live.gov, true); assert.equal(live.msaa, 1);
  assert.equal(live.scale, 0.5, 'the start scale is clamped to 0.5–1'); assert.deepEqual(live.fixed, [640, 360]); assert.equal(live.timing, false);
  assert.equal(sceneParams(parseV2Flags('?msaa=2')).msaa, 4, 'only 1 or 4');
  assert.equal(sceneParams(parseV2Flags('?gov=0')).gov, false);
  assert.equal(sceneParams(parseV2Flags('?hour=-1')).hour, 23);
});
