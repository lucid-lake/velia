// Results, best times, the photo finish and the rematch (commit 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics } from '../src/sim/boat.js';
import { courseFor } from '../src/sim/race/course.js';
import { runRace } from '../src/sim/race/sim.js';
import { buildResult, recordBest, loadBest, bestLine, logLine, KEY } from '../src/sim/race/results.js';
import { createPhoto, etaToLine, PHOTO } from '../src/sim/race/photo.js';
import { createSession } from '../classic/src/modes/regatta/session.js';
import { startPoses } from '../src/sim/race/sim.js';
import { windFn } from './helpers/skipper-sim.mjs';

const course = courseFor('tahoe-emerald', 'island-sprint');
const names = { me: 'Halcyon', wren: 'Osprey' };
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('the card data from a finished race: rows in finish order, the winner first, a log line', () => {
  const r = runRace({ course, windAt: windFn({ kn: 16, fromDeg: 210 }), tiers: { me: 'pro', wren: 'medium' }, seed: 1, maxS: 700 });
  assert.ok(r.race.done);
  const views = { me: r.race.view('me'), wren: r.race.view('wren') };
  const res = buildResult({ course, order: r.order, views, names, tier: 'medium', seed: 1 });
  assert.equal(res.rows[0].place, '1st'); assert.match(res.rows[0].time, /^\d+:\d\d\.\d$/); assert.match(res.rows[1].time, /^\+\d+:\d\d\.\d$/);
  assert.ok(res.marginS > 0 && res.photo === false);
  assert.match(logLine(res, 'me'), /^The Island Sprint: 1st, \d+:\d\d\.\d, Osprey \+?\d/);
  assert.doesNotMatch(JSON.stringify(res), /lose|lost/i);
  const lost = buildResult({ course, order: ['wren', 'me'], views: { me: { ...views.me }, wren: { ...views.wren } }, names });
  assert.equal(lost.rows[0].name, 'Osprey', 'the rival\'s row first when it wins');
});

test('the best time updates only when better; stored under lakeshore.regatta.v1 per course and tier', () => {
  const s = mem();
  assert.equal(loadBest(s, 'island-sprint', 'medium'), null);
  assert.deepEqual(recordBest(s, { course: 'island-sprint', tier: 'medium', t: 470 }), { best: 470, isNew: true, prev: null });
  assert.equal(recordBest(s, { course: 'island-sprint', tier: 'medium', t: 480 }).isNew, false);
  assert.equal(loadBest(s, 'island-sprint', 'medium'), 470);
  const b = recordBest(s, { course: 'island-sprint', tier: 'medium', t: 455.5 });
  assert.equal(b.isNew, true); assert.equal(loadBest(s, 'island-sprint', 'medium'), 455.5);
  assert.equal(loadBest(s, 'island-sprint', 'hard'), null, 'another tier has its own');
  assert.ok(s.m.has(KEY));
  assert.match(bestLine(b), /^New best: 7:35\.5 \(was 7:50\.0\)$/);
  assert.doesNotThrow(() => recordBest({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }, { course: 'c', tier: 't', t: 1 }));
});

test('the photo finish triggers only under 2 s and restores the rate', () => {
  const p = createPhoto();
  assert.equal(p.arm({ gapS: 2.0 }), false); assert.equal(p.arm({ gapS: 5 }), false); assert.equal(p.rate(), 1);
  assert.equal(p.arm({ gapS: 1.4 }), true);
  assert.equal(p.rate(), PHOTO.rate); assert.equal(p.active, true);
  for (let i = 0; i < 29; i++) p.step(0.1);
  assert.equal(p.active, true);
  for (let i = 0; i < 3; i++) p.step(0.1);
  assert.equal(p.active, false); assert.equal(p.rate(), 1); assert.equal(p.done, true);
  assert.equal(p.arm({ gapS: 0.5 }), false, 'once per race');
  p.reset(); assert.equal(p.arm({ gapS: 0.5 }), true);
  // the line ETA: a boat 20 m on the course side heading at the line at 4 m/s is 5 s out
  const L = course.line, ex = L.centre[0] + L.up[0] * 20, ez = L.centre[1] + L.up[1] * 20, h = Math.atan2(-L.up[0], L.up[1]);
  assert.ok(Math.abs(etaToLine(L, { x: ex, z: ez, heading: h, u: 4 }) - 5) < 1e-6);
  assert.equal(etaToLine(L, { x: ex, z: ez, heading: h + Math.PI, u: 4 }), Infinity);
});

test('the rematch keeps tier, seed and course', () => {
  const [a, b] = startPoses(course, 210 * Math.PI / 180, ['me', 'wren']);
  const mk = (p) => { const phys = new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed }); return { phys, step: (dt, ctl, t, w) => phys.step(dt, ctl, { t, windAt: w }) }; };
  const s = createSession({ course, me: mk(a), wren: mk(b), baseWind: windFn({ kn: 14, fromDeg: 210 }), tier: 'hard', seed: 7 });
  s.step(70); const first = s.state().clock;
  s.restart();
  assert.equal(s.race.clock, -60); assert.equal(s.brain.tier, 'hard'); assert.equal(s.race.course.id, 'island-sprint');
  s.step(70); assert.ok(Math.abs(s.state().clock - first) < 0.05, 'the same race again');
});
