// node --test tests/challenges.test.mjs — Day Sail's unannounced challenges (src/sail/challenges.js)
// on the real map's coordinates (src/terrain.js LAKE): each start and finish from scripted position and state streams,
// positives and negatives; the beat's direction checked against the real 18:45 wind; the sloop on a scripted
// sloop's track; the bests and their labels (the only place a time shows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, LAKE } from '../src/sim/terrain.js';
import { WindField } from '../src/sim/wind.js';
import { SAIL_HOUR } from '../src/sim/timeOfDay.js';
import { coreOptions } from '../classic/src/modes/daysail/index.js';
import { createChallenges, coursesFrom, labelOf, CHALLENGES, CHALLENGE_IDS, COURSE, BEAT } from '../src/sail/challenges.js';
import { parseFlags } from '../src/sim/core/flags.js';

const DEG = Math.PI / 180, KN = 0.514444;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const terrain = makeTerrain({ seed: 1 });
const courses = coursesFrom(LAKE);
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const BASE = { sog: 3, twa: -60 * DEG, windFrom: 199 * DEG, level: 3, surf: 0, roundUp: 0, sloops: [] };
// a stream: f(t) → { x, z, … } every dt (world s); returns the results in order
function run(f, dur, { dt = 0.5, ch = createChallenges({ courses }), t0 = 0 } = {}) {
  const out = [];
  for (let t = t0; t <= t0 + dur; t += dt) for (const r of ch.update({ ...BASE, t, heading: 0, ...f(t) })) out.push({ ...r, t });
  return { out, ch };
}
const isWater = (x, z, depth = 0) => terrain.heightAt(x, z) < -depth;

test('the challenges:\'s six, moor a stub; the courses sit on the real map, in water', () => {
  assert.deepEqual(CHALLENGE_IDS, ['round', 'beat', 'narrows', 'surf', 'sloop', 'moor']);
  assert.ok(CHALLENGES.find((c) => c.id === 'moor').stub);
  assert.deepEqual(courses.island, { x: LAKE.island.x, z: LAKE.island.z });
  assert.ok(Math.hypot(courses.island.x, courses.island.z) < 30, 'Fannette at the origin');
  assert.ok(isWater(BEAT.start.x, BEAT.start.z, 10), 'the beat starts in water off the island\'s east side');
  assert.ok(BEAT.start.x - LAKE.island.x > LAKE.island.a, 'east of the island');
  assert.ok(isWater(BEAT.finish.x, BEAT.finish.z, 10), 'the beat finishes in water off the bay head');
  assert.ok(Math.hypot(BEAT.finish.x + 160, BEAT.finish.z - 280) < 1, 'about (−160, 280)');
  for (let f = 0; f <= 1; f += 0.1) {
    const x = LAKE.mouth.a[0] + (LAKE.mouth.b[0] - LAKE.mouth.a[0]) * f, z = LAKE.mouth.a[1] + (LAKE.mouth.b[1] - LAKE.mouth.a[1]) * f;
    assert.ok(isWater(x, z), `the narrows' axis is water at ${f.toFixed(1)} (the mouth's sill is 0.3–2.5 m deep inside it)`);
  }
});

test('the beat is upwind at 18:45: the finish lies inside the no-go zone of the real breeze at the start', () => {
  // Day Sail's own wind (src/modes/daysail/index.js coreOptions): the day at 18:45, level 3 on the bay, the first gust
  const wind = new WindField({ seed: 1, ...coreOptions(parseFlags()).wind(parseFloat(SAIL_HOUR)) });   // SAIL_HOUR is the URL's string
  wind.setTerrain(terrain.heightAt);   // as src/core/world.js builds it
  const from = (x, z) => { const w = wind.sample(x, z, 0); return Math.atan2(-w.vx, w.vz); };   // the compass direction it blows from
  const brg = Math.atan2(BEAT.finish.x - BEAT.start.x, -(BEAT.finish.z - BEAT.start.z));
  const fStart = from(BEAT.start.x, BEAT.start.z), fMid = from((BEAT.start.x + BEAT.finish.x) / 2, (BEAT.start.z + BEAT.finish.z) / 2);
  const off = Math.abs(wrap(brg - fStart)) / DEG, offMid = Math.abs(wrap(brg - fMid)) / DEG;
  assert.ok(off < 45, `the course is ${off.toFixed(0)}° off the wind at the start (from ${(((fStart / DEG) + 360) % 360).toFixed(0)}°, bearing ${(((brg / DEG) + 360) % 360).toFixed(0)}°): inside the no-go, a beat`);
  assert.ok(offMid < 45, `and ${offMid.toFixed(0)}° halfway`);
  assert.ok(off < COURSE.beat.upwindDeg, 'the start\'s upwind check passes');
});

test('beat to the head: out of the start circle with the finish upwind, into the finish circle; the time in the world\'s clock', () => {
  // three legs: start → a port layline point → a starboard point → the finish, 400 s in all
  const pts = [[BEAT.start.x, BEAT.start.z], [BEAT.start.x + 40, BEAT.start.z + 60], [-20, 160], [-80, 140], [BEAT.finish.x, BEAT.finish.z]];
  const path = (t) => { const u = Math.min(1, Math.max(0, t / 400)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(u)), f = u - i; return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, z: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f }; };
  const r = run(path, 410);
  const b = r.out.filter((o) => o.id === 'beat');
  assert.equal(b.length, 1);
  assert.ok(b[0].value > 120 && b[0].value < 400, `beat in ${b[0].value} s (${b[0].label})`);
  assert.match(b[0].label, /^\d+ min \d+ s$/);
  // downwind (the wind from the finish's opposite side): no beat
  assert.equal(run(path, 410, { ch: createChallenges({ courses }) }).out.length, 1);
  const down = run((t) => ({ ...path(t), windFrom: 20 * DEG }), 410).out.filter((o) => o.id === 'beat');
  assert.equal(down.length, 0, 'the finish downwind: not a beat');
  // never reaching the finish
  assert.equal(run((t) => ({ ...path(Math.min(t, 250)) }), 600).out.filter((o) => o.id === 'beat').length, 0);
});

test('round the island: a full 360° sweep inside 300 m; 300° is not; outside 300 m is not', () => {
  const I = courses.island, R = 180, v = 3;
  const circle = (sweep) => (t) => { const a = Math.min(t * v / R, sweep * DEG); return { x: I.x + R * Math.sin(a), z: I.z - R * Math.cos(a) }; };
  const r = run(circle(370), 500, { dt: 0.25 });
  const rd = r.out.filter((o) => o.id === 'round');
  assert.equal(rd.length, 1);
  const expect = 2 * Math.PI * R / v;
  assert.ok(Math.abs(rd[0].value - expect) < 2, `round in ${rd[0].value.toFixed(1)} s, expected ${expect.toFixed(1)} (${rd[0].label})`);
  assert.equal(run(circle(300), 500, { dt: 0.25 }).out.length, 0, '300°');
  const wide = (t) => { const a = t * v / 400; return { x: I.x + 400 * Math.sin(a), z: I.z - 400 * Math.cos(a) }; };
  assert.equal(run(wide, 1000).out.length, 0, '400 m off');
  // too slow: a full turn over 12 min
  const slow = (t) => { const a = t * 2 * Math.PI / 720; return { x: I.x + R * Math.sin(a), z: I.z - R * Math.cos(a) }; };
  assert.equal(run(slow, 800).out.length, 0, 'inside 10 min');
});

const M = courses.mouth, L = LAKE.mouth.length;
const onAxis = (s, off = 0) => { const ux = (M.b.x - M.a.x) / L, uz = (M.b.z - M.a.z) / L; return { x: M.a.x + ux * s + uz * off, z: M.a.z + uz * s - ux * off }; };
test('thread the narrows: the mouth end to end at level ≥ 3; clean without a round-up; level 2 or out of the channel does not count', () => {
  const thru = (extra = () => ({})) => (t) => ({ ...onAxis(-60 + t * 3), ...extra(t) });
  const c = run(thru(), (L + 120) / 3).out;
  assert.deepEqual(c.map((o) => [o.id, o.label]), [['narrows', 'clean']]);
  const r = run(thru((t) => ({ roundUp: t > 60 && t < 64 ? 1 : 0 })), (L + 120) / 3).out;
  assert.deepEqual(r.map((o) => [o.id, o.label]), [['narrows', 'through']]);
  assert.equal(run(thru(() => ({ level: 2 })), (L + 120) / 3).out.length, 0, 'level 2');
  // in through the open-lake end and out into the bay (the other way) counts too
  const back = run((t) => ({ ...onAxis(L + 60 - t * 3) }), (L + 120) / 3).out;
  assert.deepEqual(back.map((o) => o.id), ['narrows']);
  // out of the channel's side halfway (off > half its width)
  const side = run((t) => { const s = -60 + t * 3; return onAxis(s, s > L / 2 ? 300 : 0); }, (L + 120) / 3).out;
  assert.equal(side.length, 0);
  // a clean best is kept over a later "through"
  const ch = createChallenges({ courses, storage: memStore() });
  run(thru(), (L + 120) / 3, { ch }); run(thru((t) => ({ roundUp: t > 60 && t < 64 ? 1 : 0 })), (L + 120) / 3, { ch, t0: 1000 });
  assert.equal(ch.bests.narrows.label, 'clean');
});

test('surf run: past the mouth, level 4, downwind, a surf burst; the best top speed', () => {
  const lake = (t) => ({ ...onAxis(L + 200 + t * 3.5), level: 4, twa: 160 * DEG, sog: 3.5 + (t > 10 && t < 14 ? 1.4 : 0), surf: t > 10 && t < 14 ? 0.8 : 0 });
  const end = (f, after = 40) => (t) => (t < after ? f(t) : { ...f(t), twa: 60 * DEG });
  const r = run(end(lake), 60).out;
  assert.equal(r.length, 1); assert.equal(r[0].id, 'surf');
  assert.equal(r[0].label, `${(4.9 / KN).toFixed(1)} kn`);
  assert.equal(run(end((t) => ({ ...lake(t), level: 3 })), 60).out.length, 0, 'level 3');
  assert.equal(run(end((t) => ({ ...lake(t), surf: 0 })), 60).out.length, 0, 'no surf');
  assert.equal(run(end((t) => ({ ...lake(t), ...onAxis(200 + t) })), 60).out.length, 0, 'inside the bay');
  const ch = createChallenges({ courses, storage: memStore() });
  run(end(lake), 60, { ch });
  run(end((t) => ({ ...lake(t), sog: 3 })), 60, { ch, t0: 200 });
  assert.equal(ch.bests.surf.value, 4.9, 'the best top speed stays');
});

test('catch the sloop: from astern to ahead of a sloop sailing the same way; the margin a minute on', () => {
  // a sloop close-hauled at 3 m/s on a steady heading (the AI sloops were deleted with the props; the challenge
  // reads any sloop the logbook passes)
  const sloop = { poseAt: (t) => ({ id: 'sail-0', x: 900 + Math.sin(0.8) * 3 * t, z: -700 - Math.cos(0.8) * 3 * t, heading: 0.8 }) };
  const t0 = 600;
  // the player on the sloop's line: 80 m astern, closing at 1.5 m/s relative, 20 m to one side
  const f = (closing) => (t) => {
    const p = sloop.poseAt(t0 + t), fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
    const d = -80 + closing * t;
    return { x: p.x + fx * d + fz * 20, z: p.z + fz * d - fx * 20, heading: p.heading, sloops: [{ id: p.id, x: p.x, z: p.z, heading: p.heading }] };
  };
  const r = run(f(1.5), 160, { dt: 0.5 }).out;
  assert.equal(r.length, 1); assert.equal(r[0].id, 'sloop');
  assert.ok(r[0].value > 100 && r[0].value < 140, `margin ${r[0].value.toFixed(0)} m (${r[0].label})`);
  assert.equal(run(f(0.2), 160).out.length, 0, 'never got past');
  // crossing ahead on a different heading is no pass
  const cross = (t) => ({ ...f(1.5)(t), heading: sloop.poseAt(t0 + t).heading + Math.PI / 2 });
  assert.equal(run(cross, 160).out.length, 0);
  // starting ahead and staying ahead is no catch
  assert.equal(run((t) => ({ ...f(0.5)(t + 200) }), 100).out.length, 0);
});

test('moor under sail is a stub; the labels; the save keeps only bests', () => {
  const r = run(() => ({ x: 900, z: -700, sog: 0 }), 300); assert.equal(r.out.length, 0);
  assert.equal(labelOf('time', 400), '6 min 40 s'); assert.equal(labelOf('time', 42), '42 s');
  assert.equal(labelOf('clean', true), 'clean'); assert.equal(labelOf('clean', false), 'through');
  assert.equal(labelOf('margin', 46.4), '46 m'); assert.equal(labelOf('speed', 4.9), '9.5 kn');
  const store = memStore(), I = courses.island;
  const lap = (R, v) => (t) => { const a = t * v / R; return { x: I.x + R * Math.sin(a), z: I.z - R * Math.cos(a) }; };
  const ch = createChallenges({ courses, storage: store });
  const a = run(lap(200, 2.5), 520, { ch, dt: 0.25 }).out.find((o) => o.id === 'round');
  assert.ok(a.best);
  const b = run(lap(200, 2.2), 600, { ch, dt: 0.25, t0: 2000 }).out.find((o) => o.id === 'round');
  assert.equal(b.best, false, 'a slower lap is no best');
  assert.equal(createChallenges({ courses, storage: store }).bests.round.label, a.label, 'the best is saved');
});
