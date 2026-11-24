// Engagement counts (owner, 2026-11-19): sailed_2min (visible play time, once a session) and race_finished (a finish crossed).
// Pure: the clock is stepped by hand; the events go through the real client and the real server mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSailClock, raceFinished, SAIL_MIN_S } from '../ui/engagement.js';
import { createMetrics, EVENTS } from '../../src/metrics.js';
import { pointOf } from '../../functions/api/e.js';

const rig = (opts = {}) => {
  const got = [];
  let vis = true;
  const c = createSailClock({ track: (n, p) => got.push([n, p]), visible: () => vis, ...opts });
  return { c, got, hide: () => { vis = false; }, show: () => { vis = true; } };
};
const run = (c, s, dt = 0.1) => { for (let t = 0; t < s - 1e-9; t += dt) c.tick(dt); };

test('sailed_2min fires once after 120 s of play, with the mode', () => {
  const { c, got } = rig();
  c.enter('cruise');
  run(c, 119);
  assert.equal(got.length, 0);
  run(c, 2);
  assert.deepEqual(got, [['sailed_2min', { mode: 'cruise' }]]);
  run(c, 600);
  assert.equal(got.length, 1, 'once per session');
  assert.equal(SAIL_MIN_S, 120);
});

test('nothing counts before the card is left', () => {
  const { c, got } = rig();
  run(c, 300);
  assert.equal(got.length, 0);
  assert.equal(c.seconds, 0);
});

test('hidden-tab time is excluded, and a long frame gap on return adds one step, not the time away', () => {
  const { c, got, hide, show } = rig();
  c.enter('sail');
  run(c, 100);
  hide(); run(c, 500); show();
  assert.equal(got.length, 0);
  assert.ok(Math.abs(c.seconds - 100) < 0.5);
  c.tick(300);   // the first frame after a long background stay
  assert.ok(c.seconds < 101, c.seconds);
  run(c, 30);
  assert.equal(got.length, 1);
});

test('the mode at the moment of the 2 minutes is reported', () => {
  const { c, got } = rig();
  c.enter('sail'); run(c, 60); c.mode('regatta'); run(c, 61);
  assert.deepEqual(got[0], ['sailed_2min', { mode: 'regatta' }]);
});

test('race_finished: a crossed line only, with the place race id or the event kind', () => {
  const got = [];
  const t = (n, p) => got.push([n, p]);
  assert.equal(raceFinished(t, { finished: true, place: 'tea-house-run', event: 'fleet' }), true);
  assert.equal(raceFinished(t, { finished: true, place: null, event: 'match' }), true);
  assert.equal(raceFinished(t, { finished: false, place: 'tea-house-run', event: 'fleet' }), false, 'a DNF');
  assert.equal(raceFinished(t, { finished: true, place: '', event: '' }), false);
  assert.deepEqual(got, [['race_finished', { race: 'tea-house-run' }], ['race_finished', { race: 'match' }]]);
});

test('the schema and the server carry both events; no personal field', () => {
  assert.deepEqual(EVENTS.sailed_2min, ['mode']);
  assert.deepEqual(EVENTS.race_finished, ['race']);
  const sent = [];
  const m = createMetrics({ env: { search: '', hostname: 'velia.lucidlakelabs.com' }, send: (u, b) => sent.push(JSON.parse(b)), setTimer: () => 1, clearTimer: () => {} });
  m.track('sailed_2min', { mode: 'sail', secret: 'x' }); m.track('race_finished', { race: 'pass-the-channel', name: 'Zhao' }); m.flush();
  const evs = sent.flatMap((b) => b.e);
  assert.deepEqual(evs, [{ n: 'sailed_2min', p: { mode: 'sail' } }, { n: 'race_finished', p: { race: 'pass-the-channel' } }]);
  assert.equal(pointOf(evs[0]).mode, 'sail');
  assert.equal(pointOf(evs[1]).detail, 'pass-the-channel');
  assert.equal(pointOf({ n: 'race_finished', p: { race: 'Bad Name!' } }).detail, '');
  assert.equal(pointOf({ n: 'sailed_2min', p: { mode: 'nope' } }).mode, '');
});
