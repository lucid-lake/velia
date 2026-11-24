// The race module's course, line and progress (commit 1). Pure; the snap test reads the real bay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseFor, courseIds, loadCourse, snapCourse, trackerCourse, BOAT_LENGTH_M } from '../src/sim/race/course.js';
import { crossing, side, isOver, bias, makeLine, timeToLine } from '../src/sim/race/line.js';
import { progressM, rank, GapLog, toLengths, fmtGap } from '../src/sim/race/progress.js';
import { makeTerrain } from '../src/sim/terrain.js';

const DEG = Math.PI / 180;

test('the Island Sprint loads and validates; bad JSON is refused with a clear error', () => {
  assert.equal(courseIds('tahoe-emerald')[0], 'island-sprint', 'the Island Sprint is the default (v1 sails it)');
  assert.deepEqual(courseIds('tahoe-emerald'), ['island-sprint', 'harbour-dash', 'twice-round', 'bay-tour']);
  const c = courseFor('tahoe-emerald', 'island-sprint');
  assert.equal(c.name, 'The Island Sprint');
  assert.deepEqual(c.markIds, ['W', 'I']);
  assert.equal(c.legs.length, 3);
  assert.ok(c.totalM > 1100 && c.totalM < 1400, `rhumb length ${c.totalM}`);
  assert.ok(Math.abs(c.line.len - 90) < 1, 'the line is 90 m');
  const j = { id: 'x', waters: 'w', name: 'n', designWindFrom: 0, line: { committee: [0, 0], pin: [10, 0] }, marks: [{ id: 'A', at: [0, 100], rounding: 'port' }], legs: [{ to: 'A' }, { to: 'finish' }] };
  assert.doesNotThrow(() => loadCourse(j));
  assert.throws(() => loadCourse({ ...j, legs: [{ to: 'A' }] }), /finish/);
  assert.throws(() => loadCourse({ ...j, legs: [{ to: 'Z' }, { to: 'finish' }] }), /unknown mark/);
  assert.throws(() => loadCourse({ ...j, marks: [{ id: 'A', at: [0, 100], rounding: 'left' }] }), /rounding/);
  assert.throws(() => loadCourse({ ...j, line: {} }), /line/);
  assert.equal(trackerCourse(c).rounding, 'port');
});

test('every mark snaps to >= 8 m depth and >= 60 m off the shore on the real bay', () => {
  const T = makeTerrain({ seed: 1 });
  const snapped = snapCourse(courseFor('tahoe-emerald', 'island-sprint'), { depthAt: (x, z) => -T.heightAt(x, z), shoreDist: (x, z) => -T.shoreDistance(x, z) });
  for (const m of snapped.marks) {
    assert.ok(-T.heightAt(...m.at) >= 8, `${m.id} depth`);
    assert.ok(-T.shoreDistance(...m.at) >= 60, `${m.id} shore`);
    assert.ok(m.snapped < 150, `${m.id} moved ${m.snapped} m`);
  }
  for (const p of [snapped.line.committee, snapped.line.pin]) assert.ok(-T.heightAt(...p) >= 8, 'the line ends are in deep water');
});

test('line crossing needs the right direction; OCS is the course side', () => {
  const L = makeLine({ committee: [-45, 0], pin: [45, 0] }, 0);   // wind from the north: the course side is z < 0
  assert.ok(Math.abs(L.up[1] + 1) < 1e-9 && L.len === 90);
  assert.ok(side(L, 0, -5) > 0 && isOver(L, 0, -5) && !isOver(L, 0, 5));
  assert.equal(crossing(L, [0, 5], [0, -5]).dir, 'up');
  assert.equal(crossing(L, [0, -5], [0, 5]).dir, 'down');
  assert.equal(crossing(L, [0, 5], [0, 1]), null, 'no crossing');
  assert.equal(crossing(L, [200, 5], [200, -5]), null, 'beside the line');
  assert.ok(Math.abs(crossing(L, [0, 4], [0, -4]).f - 0.5) < 1e-9);
  assert.ok(bias(L, 0).m < 1e-9, 'a square line has no bias');
  const L2 = makeLine({ committee: [-45, 0], pin: [45, 0] }, 20 * DEG);
  assert.equal(bias(L2, 20 * DEG).m < 1e-6, false, 'a line built for another wind');
  assert.ok(Math.abs(timeToLine(L, 0, 30, 0, 3) - 10) < 1e-9 && timeToLine(L, 0, 30, Math.PI, 3) === Infinity);
});

test('progress is monotonic along a scripted track; rank puts finishers first', () => {
  const c = courseFor('tahoe-emerald', 'island-sprint');
  let last = -1;
  for (let leg = 0; leg < 3; leg++) {
    const L = c.legs[leg];
    for (let k = 0; k <= 10; k++) {
      const p = progressM(c, leg, L.from[0] + (L.to[0] - L.from[0]) * k / 10, L.from[1] + (L.to[1] - L.from[1]) * k / 10);
      assert.ok(p >= last - 1e-6, `leg ${leg} step ${k}: ${p} < ${last}`); last = p;
    }
  }
  assert.ok(Math.abs(last - c.totalM) < 1e-6);
  assert.deepEqual(rank([{ id: 'a', progressM: 500 }, { id: 'b', progressM: 700 }, { id: 'c', progressM: 100, finishedAt: 400 }, { id: 'd', progressM: 1, finishedAt: 380 }]), ['d', 'c', 'b', 'a']);
});

test('the gap in seconds from a leader log equals the scripted delay; lengths = metres / 8.6', () => {
  const g = new GapLog();
  for (let t = 0; t <= 300; t += 5) { g.record('lead', t, 3 * t); g.record('tail', t, Math.max(0, 3 * (t - 14))); }
  assert.ok(Math.abs(g.gapS('lead', 3 * (300 - 14), 300) - 14) < 1e-6);
  assert.equal(g.gapS('lead', 99999, 300), 0, 'not reached: no gap');
  assert.ok(Math.abs(toLengths(86) - 10) < 1e-12 && BOAT_LENGTH_M === 8.6);
  assert.equal(fmtGap(14, 77.4), '+0:14 · 9 lengths');
  assert.equal(fmtGap(-3, -8.6), '-0:03 · 1 length');
});
