// Practice courses: the layout for the wind, and mark rounding on the right side (src/marks/course.js).
// Run: node --test tests/marks-course.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layCourse, CourseTracker, NM, LENGTH_RANGE, eventLine } from '../src/sim/marks/course.js';

const DEG = Math.PI / 180;
const byId = (c) => Object.fromEntries(c.marks.map((m) => [m.id, m]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// a point boat that sails through a list of waypoints at 3 m/s and reports each position to the tracker
function sail(tracker, route, { from, speed = 3, dt = 0.5 } = {}) {
  let p = { ...from }, t = 0;
  const events = [];
  for (const w of route) {
    for (let guard = 0; guard < 4000 && Math.hypot(w[0] - p.x, w[1] - p.z) > 2.5; guard++, t += dt) {
      const d = Math.hypot(w[0] - p.x, w[1] - p.z), st = Math.min(d, speed * dt);
      p = { x: p.x + (w[0] - p.x) / d * st, z: p.z + (w[1] - p.z) / d * st };
      events.push(...tracker.update(p, t));
    }
  }
  return events;
}
const routeOf = (tracker, marks, rounding) => {   // the skipper's route through every mark in order: approach, outside, exit
  const route = [];
  for (let i = 0; i < tracker.seq.length; i++) { const tg = tracker.target(); if (!tg) break; route.push(...tg.route); tracker.k++; }
  tracker.k = 0; tracker.prev = null; return route;
};

test('a windward-leeward course is laid for the wind: the windward mark dead upwind, 0.4–0.8 nm', () => {
  for (const from of [0, 90, 215, 330]) for (const nm of [0.3, 0.5, 0.9]) {
    const c = layCourse({ kind: 'windward-leeward', origin: { x: 100, z: -200 }, windFrom: from * DEG, lengthM: nm * NM });
    const m = byId(c), L = dist(c.origin, m.windward);
    assert.ok(L >= LENGTH_RANGE[0] - 1e-6 && L <= LENGTH_RANGE[1] + 1e-6, `length ${(L / NM).toFixed(2)} nm for a request of ${nm}`);
    const brg = (Math.atan2(m.windward.x - c.origin.x, -(m.windward.z - c.origin.z)) / DEG + 360) % 360;
    assert.ok(Math.abs(((brg - from + 540) % 360) - 180) < 0.01, `bearing ${brg.toFixed(1)}° vs wind from ${from}°`);
    // the start line lies across the wind
    const lx = m.committee.x - m.pin.x, lz = m.committee.z - m.pin.z, ux = Math.sin(from * DEG), uz = -Math.cos(from * DEG);
    assert.ok(Math.abs(lx * ux + lz * uz) < 1e-6, 'the line is square to the wind');
    assert.equal(c.sequence.length, 2 * c.laps);
  }
});

test('a triangle is equilateral, with the wing mark on the rounding side', () => {
  for (const rounding of ['port', 'starboard']) {
    const c = layCourse({ kind: 'triangle', origin: { x: 0, z: 0 }, windFrom: 40 * DEG, lengthM: 0.6 * NM, rounding }), m = byId(c);
    const s = [dist(m.m1, m.m2), dist(m.m2, { x: 0, z: 0 }), dist(m.m1, { x: 0, z: 0 })];
    for (const v of s) assert.ok(Math.abs(v - 0.6 * NM) < 1, `side ${v.toFixed(1)} m`);
    // the wing mark is to the left of the beat for port roundings (looking from the start toward the windward mark)
    const ux = m.m1.x, uz = m.m1.z, wx = m.m2.x, wz = m.m2.z, cross = ux * wz - uz * wx;   // z south: positive cross is to the right of travel
    assert.ok(rounding === 'port' ? cross < 0 : cross > 0, `${rounding}: wing mark on the ${cross < 0 ? 'left' : 'right'}`);
  }
});

test('rounding detection: every mark rounded on the right side, in order, then the course is finished', () => {
  for (const kind of ['windward-leeward', 'triangle']) for (const rounding of ['port', 'starboard']) {
    const c = layCourse({ kind, origin: { x: 0, z: 0 }, windFrom: 200 * DEG, lengthM: 0.45 * NM, rounding });
    const pos = Object.fromEntries(c.marks.map((m) => [m.id, { x: m.x, z: m.z }])), events = [];
    const tr = new CourseTracker(c, { positions: () => pos, onEvent: (e) => events.push(e) });
    const evs = sail(tr, routeOf(tr, c.marks, rounding), { from: { x: 0, z: 40 * Math.cos(200 * DEG) * -1 } });
    const rounded = evs.filter((e) => e.type === 'rounded');
    assert.deepEqual(rounded.map((e) => e.mark), c.sequence, `${kind}/${rounding}: the marks in order`);
    assert.ok(rounded.every((e) => e.side === rounding));
    assert.ok(evs.some((e) => e.type === 'finished') && tr.done);
    assert.ok(!evs.some((e) => e.type === 'wrongSide'));
    assert.ok(eventLine(rounded[0], c).startsWith('Rounded'));
  }
});

test('rounding detection: the wrong side is reported and does not count; going round again does', () => {
  const c = layCourse({ kind: 'windward-leeward', origin: { x: 0, z: 0 }, windFrom: 0, lengthM: 0.45 * NM, rounding: 'port', laps: 1 });
  const pos = Object.fromEntries(c.marks.map((m) => [m.id, { x: m.x, z: m.z }]));
  const tr = new CourseTracker(c, { positions: () => pos });
  const W = pos.windward;
  // round the windward mark the wrong way: up its west side (mark on the boat's right), over the top, down the east side
  const wrong = [[W.x - 20, W.z + 60], [W.x - 20, W.z], [W.x, W.z - 22], [W.x + 20, W.z], [W.x + 20, W.z + 60]];
  const e1 = sail(tr, wrong, { from: { x: W.x - 20, z: W.z + 120 } });
  assert.ok(e1.some((e) => e.type === 'wrongSide' && e.mark === 'windward'), 'wrong side reported');
  assert.ok(!e1.some((e) => e.type === 'rounded') && tr.k === 0, 'and not counted');
  // a pass that never turns round the mark is neither
  const tr2 = new CourseTracker(c, { positions: () => pos });
  const e2 = sail(tr2, [[W.x + 25, W.z + 100], [W.x + 25, W.z - 100]], { from: { x: W.x + 25, z: W.z + 200 } });
  assert.equal(e2.length, 0, 'a fly-by is nothing');
  // and the right way (up the east side, over the top, down the west side) counts
  const right = [[W.x + 20, W.z + 60], [W.x + 20, W.z], [W.x, W.z - 22], [W.x - 20, W.z], [W.x - 20, W.z + 60]];
  const e3 = sail(tr, right, { from: { x: W.x + 20, z: W.z + 120 } });
  assert.ok(e3.some((e) => e.type === 'rounded' && e.mark === 'windward'), 'rounded the right way');
  assert.equal(tr.target().mark, 'leeward', 'on to the leeward mark');
});

test('the tracker follows swinging marks (live positions)', () => {
  const c = layCourse({ kind: 'windward-leeward', origin: { x: 0, z: 0 }, windFrom: 0, lengthM: 0.45 * NM, rounding: 'port', laps: 1 });
  const pos = Object.fromEntries(c.marks.map((m) => [m.id, { x: m.x, z: m.z }]));
  const tr = new CourseTracker(c, { positions: () => pos });
  pos.windward.x += 15; pos.windward.z += 12;   // the mark has swung on its rode
  const tg = tr.target();
  assert.ok(Math.hypot(tg.at.x - c.marks.find((m) => m.id === 'windward').x, tg.at.z - c.marks.find((m) => m.id === 'windward').z) > 15, 'the target is where the mark is now');
});

test('the AI skipper hook: roundMark hands the next mark and its route', async () => {
  const { AISkipper } = await import('../src/sim/ai/skipper.js');
  const c = layCourse({ kind: 'triangle', origin: { x: 0, z: 0 }, windFrom: 0, lengthM: 0.45 * NM, rounding: 'port' });
  const pos = Object.fromEntries(c.marks.map((m) => [m.id, { x: m.x, z: m.z }])), tr = new CourseTracker(c, { positions: () => pos });
  const sk = new AISkipper({ skill: 0.5, seed: 1, windAt: () => ({ vx: 0, vz: 5 }) });
  assert.equal(sk.roundMark(), null, 'no course: null, as before');
  const tg = sk.roundMark(tr);
  assert.equal(tg.mark, 'm1'); assert.equal(tg.route.length, 3); assert.equal(tg.rounding, 'port');
});

test('findRoom: a course goes where the water is deep enough, shorter if it must, and null if there is no room', async () => {
  const { findRoom } = await import('../src/sim/marks/course.js');
  const open = () => 40;
  const c0 = findRoom({ depthAt: open, boat: { x: 0, z: 0, heading: 0 }, windFrom: 0, lengthM: 0.8 * NM });
  assert.ok(c0 && Math.abs(c0.lengthM - 0.8 * NM) < 1e-6, 'open water: the length asked for');
  // a channel 600 m wide running east-west: a north-south windward leg cannot fit, so the course turns or shortens... but a wind from the east fits along it
  const channel = (x, z) => (Math.abs(z) < 300 ? 30 : -5);
  const c1 = findRoom({ depthAt: channel, boat: { x: 0, z: 0, heading: 90 * DEG }, windFrom: 90 * DEG, lengthM: 0.8 * NM });
  assert.ok(c1, 'a course along the channel');
  for (const m of c1.marks) assert.ok(channel(m.x, m.z) >= 8, `${m.id} in deep water`);
  assert.equal(findRoom({ depthAt: () => 3, boat: { x: 0, z: 0, heading: 0 }, windFrom: 0 }), null, 'a shoal: no room');
});
