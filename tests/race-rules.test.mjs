// The race state machine (commit 2): scripted two-boat tracks, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseFor } from '../src/sim/race/course.js';
import { createRace, atFault } from '../src/sim/race/rules.js';
import { roundingGeometry } from '../src/sim/marks/course.js';
import { readFileSync } from 'node:fs';

const C = courseFor('tahoe-emerald', 'island-sprint');
const [cx, cz] = C.line.centre, [ux, uz] = C.line.up;
const at = (d, o = 0) => [cx + ux * d - uz * o, cz + uz * d + ux * o];   // d m toward the course side, o m along the line
const pose = (p, q, u = 4) => ({ x: p[0], z: p[1], heading: Math.atan2(q[0] - p[0], -(q[1] - p[1])), u });

// a boat's waypoints: wait below the line, cross at the gun, round W then I (to port), finish through the line
function route({ off = 0, wrong = false } = {}) {
  const W = C.byId.W.at, I = C.byId.I.at, ctr = C.line.centre;
  const gw = roundingGeometry({ x: ctr[0], z: ctr[1] }, { x: W[0], z: W[1] }, { x: I[0], z: I[1] }, 'port');
  const gi = roundingGeometry({ x: W[0], z: W[1] }, { x: I[0], z: I[1] }, { x: ctr[0], z: ctr[1] }, 'port');
  const wps = [at(-30, off), at(15, off), ...(wrong ? [gw.exit, gw.outside, gw.approach] : [gw.approach, gw.outside, gw.exit]), ...(wrong ? [] : [gi.approach, gi.outside, gi.exit]), at(25, off), at(-25, off)];
  return wps;
}

// move the boats through their waypoints, 0.5 s a tick, holding on the first until `holdUntil`
function run(race, tracks, { until = 3000, hold = {}, dt = 0.5, onTick = null } = {}) {
  const st = Object.fromEntries(Object.entries(tracks).map(([id, w]) => [id, { p: [...w[0]], i: 1 }]));
  const events = [];
  for (let n = 0; n < until / dt && !race.done; n++) {
    const poses = {};
    for (const [id, w] of Object.entries(tracks)) {
      const s = st[id];
      if (!(race.clock >= (hold[id] ?? -1e9)) && s.i === 1) { poses[id] = pose(s.p, w[1], 0.5); continue; }
      const tgt = w[Math.min(s.i, w.length - 1)], d = Math.hypot(tgt[0] - s.p[0], tgt[1] - s.p[1]);
      if (d < 3) { if (s.i < w.length - 1) s.i++; else if (s.i === w.length - 1) s.i++; }
      const k = Math.min(1, 4 * dt / (d || 1)); const q = [s.p[0] + (tgt[0] - s.p[0]) * k, s.p[1] + (tgt[1] - s.p[1]) * k];
      poses[id] = pose(s.p, tgt); s.p = q;
    }
    const ev = race.step(dt, poses); events.push(...ev); onTick?.(race, ev, poses);
  }
  return events;
}

const boats = [{ id: 'me', kind: 'player', name: 'Halcyon' }, { id: 'wren', kind: 'ai', name: 'Osprey', sail: 17 }];
const mk = () => createRace({ course: C, boats });

test('pre-start: -60 s, the horns and flags in order, the gun at 0', () => {
  const r = mk(), ev = [];
  assert.equal(r.clock, -60);
  while (r.clock < 1) ev.push(...r.step(0.5, { me: { x: at(-40)[0], z: at(-40)[1], heading: 0, u: 1 }, wren: { x: at(-40, 20)[0], z: at(-40, 20)[1], heading: 0, u: 1 } }));
  const types = ev.map((e) => e.type + (e.s ? e.s : ''));
  assert.deepEqual(types.filter((t) => /horn|gun|tick/.test(t)), ['horn', 'horn', 'tick5', 'tick4', 'tick3', 'tick2', 'tick1', 'horn', 'gun']);
  assert.deepEqual(ev.filter((e) => e.type === 'flag').map((e) => e.up.join('+')), ['class', 'class+P', '']);
  assert.equal(ev.filter((e) => e.type === 'horn').at(-1).long, true);
  assert.equal(ev.some((e) => e.type === 'ocs'), false);
});

test('an early bow is OCS until it dips back; the start counts from the crossing', () => {
  const P = (d, o = 0) => { const q = at(d, o); return { x: q[0], z: q[1], heading: 0, u: 2 }; };
  // over early, dips back before the gun: flagged, then cleared, no penalty at the gun
  const r = mk(), ev = [];
  r.step(30, { me: P(-30), wren: P(-30, 30) });
  ev.push(...r.step(1, { me: P(8), wren: P(-30, 30) }));
  assert.equal(r.view('me').ocs, true);
  ev.push(...r.step(1, { me: P(-8), wren: P(-30, 30) }));
  assert.equal(r.view('me').ocs, false);
  ev.push(...r.step(40, { me: P(-8), wren: P(-30, 30) }));
  assert.deepEqual(ev.filter((e) => e.type === 'ocs' || e.type === 'ocsClear').map((e) => e.type), ['ocs', 'ocsClear']);
  assert.equal(r.view('me').status, 'behind');
  const st = r.step(2, { me: P(-1), wren: P(-30, 30) }).concat(r.step(1, { me: P(3), wren: P(-30, 30) })).find((e) => e.type === 'started');
  assert.ok(st && st.delayS > 12 && st.delayS < 16, `started ${st?.delayS}`);
  // over at the gun: OCS, does not start while over; dips back, then starts on the next crossing
  const r2 = mk(), ev2 = [];
  for (let i = 0; i < 125; i++) ev2.push(...r2.step(0.5, { me: P(10), wren: P(-20, 30) }));
  assert.equal(r2.view('me').status, 'ocs');
  assert.equal(ev2.some((e) => e.type === 'started' && e.id === 'me'), false);
  r2.step(0.5, { me: P(-8), wren: P(-20, 30) });
  assert.equal(r2.view('me').status, 'behind');
  const e3 = r2.step(1, { me: P(4), wren: P(-20, 30) });
  assert.ok(e3.some((e) => e.type === 'started' && e.id === 'me'));
});

test('legs, roundings, splits, gap at marks, the finish order', () => {
  const r = mk(), ev = run(r, { me: route({ off: 25 }), wren: route() }, { until: 3000, hold: { me: 5, wren: -2 } });
  const rounded = ev.filter((e) => e.type === 'rounded');
  assert.deepEqual(rounded.map((e) => `${e.id}:${e.mark}`), ['wren:W', 'me:W', 'wren:I', 'me:I']);
  assert.equal(rounded.filter((e) => e.mark === 'W').length, 2);
  const fin = ev.filter((e) => e.type === 'finished');
  assert.deepEqual(fin.map((e) => e.id), ['wren', 'me']);
  assert.deepEqual(fin.map((e) => e.place), [1, 2]);
  const gap = ev.find((e) => e.type === 'gap' && e.mark === 'W');
  assert.ok(gap && gap.leader === 'wren' && gap.s > 3 && gap.s < 12, `gap at W ${gap?.s}`);
  assert.ok(r.done && ev.at(-1).type === 'over' && ev.at(-1).order[0] === 'wren');
  assert.equal(r.view('me').splits.length, 2);
  assert.ok(r.view('wren').finishedAt < r.view('me').finishedAt);
});

test('a wrong-side rounding does not advance', () => {
  const r = mk(), ev = run(r, { me: route({ wrong: true, off: 25 }), wren: route() }, { until: 400, hold: { me: -1, wren: 100 } });
  assert.ok(ev.some((e) => e.type === 'wrongSide' && e.id === 'me' && e.mark === 'W'));
  assert.equal(ev.some((e) => e.type === 'rounded' && e.id === 'me'), false);
  assert.equal(r.view('me').nextMark, 'W');
});

test('a touch gives one turn and holds the next rounding until 360 degrees inside 60 s', () => {
  const r = mk(); let touched = false, circled = false, held = 0;
  const ev = run(r, { me: route({ off: 25 }), wren: route() }, { until: 3000, hold: { me: -1, wren: 200 }, onTick: (race, e, poses) => {
    const v = race.view('me');
    if (!touched && v.status === 'racing' && v.progressM > 100) { assert.ok(race.touch('me', 'mark')); touched = true; }
    if (touched && v.owes && !circled) { /* sail on, not turning: the next rounding must be held */ }
    if (e.some((x) => x.type === 'roundingHeld' && x.id === 'me')) held++;
    if (held > 0 && !circled) { circled = true; }
  } });
  assert.ok(touched);
  assert.ok(held >= 1, 'W is held while the turn is owed');
  assert.equal(ev.some((x) => x.type === 'rounded' && x.id === 'me' && x.mark === 'W'), false);
  // a turn done: feed 360° of heading change, then the rounding counts
  const r2 = mk(); r2.step(61, { me: { x: at(-30)[0], z: at(-30)[1], heading: 0, u: 3 } });
  r2.touch('me', 'mark'); let done = false;
  for (let i = 0; i < 40 && !done; i++) done = r2.step(1, { me: { x: at(-30)[0], z: at(-30)[1], heading: (i * 0.2) % 6.283, u: 3 } }).some((e) => e.type === 'turnDone');
  assert.equal(done, true);
  // slower than 360° in 60 s: still owed
  const r3 = mk(); r3.step(61, { me: { x: at(-30)[0], z: at(-30)[1], heading: 0, u: 3 } }); r3.touch('me', 'mark');
  for (let i = 0; i < 100; i++) r3.step(1, { me: { x: at(-30)[0], z: at(-30)[1], heading: (i * 0.05) % 6.283, u: 3 } });
  assert.equal(r3.view('me').owes, true);
});

test('boats meeting: port gives way to starboard; windward to leeward', () => {
  const wf = Math.PI;   // wind from the south: upwind is +z... (up = [sin, -cos] = [0, 1])
  assert.deepEqual(atFault({ x: 0, z: 0, heading: 0.8 }, { x: 5, z: 0, heading: 5.5 }, wf).rule, 'port and starboard');
  const p = atFault({ x: 0, z: 0, heading: 5.5 }, { x: 5, z: 0, heading: 0.8 }, wf);
  assert.equal(p.rule, 'port and starboard');
  const same = atFault({ x: 0, z: 10, heading: 2.5 }, { x: 0, z: 0, heading: 2.5 }, wf);
  assert.equal(same.rule, 'windward and leeward'); assert.equal(same.fault, 0, 'the boat further upwind gives way');
  const r = mk(); r.step(61, { me: { x: 0, z: 0, heading: 0 }, wren: { x: 100, z: 100, heading: 0 } });
  const ev = r.step(0.5, { me: { x: 0, z: 0, heading: 5.5 }, wren: { x: 4, z: 0, heading: 0.8 } });
  assert.equal(ev.filter((e) => e.type === 'penalty').length, 1);
});

test('rules.js is pure: no DOM, no clock, no randomness', () => {
  const src = readFileSync(new URL('../src/sim/race/rules.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.equal(/document|window|Date\.now|performance|localStorage|setTimeout/.test(src), false);
  const a = run(mk(), { me: route({ off: 25 }), wren: route() }, { hold: { me: 3, wren: -1 } }), b = run(mk(), { me: route({ off: 25 }), wren: route() }, { hold: { me: 3, wren: -1 } });
  assert.deepEqual(a, b, 'the same input, the same events');
});
