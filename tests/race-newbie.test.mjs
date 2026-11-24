// The first-race pass (owner, 2026-10-30): the Easy rules, the briefing flow, the guide line, the rival's visibility, the coach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics } from '../src/sim/boat.js';
import { courseFor } from '../src/sim/race/course.js';
import { createRace } from '../src/sim/race/rules.js';
import { createOfficer } from '../src/sim/race/officer.js';
import { roundingGeometry } from '../src/sim/marks/course.js';
import { startPoses } from '../src/sim/race/sim.js';
import { createSession } from '../classic/src/modes/regatta/session.js';
import { briefModel, createFlow, DIFFICULTY, RULES_TEXT, BRIEF, guideModel, dashSegments, edgeMarker, gapWords, createCoach, finishNote, diffById } from '../src/sim/race/newbie.js';
import { windFn } from './helpers/skipper-sim.mjs';

const C = courseFor('tahoe-emerald', 'island-sprint');
const [cx, cz] = C.line.centre, [ux, uz] = C.line.up;
const at = (d, o = 0) => [cx + ux * d - uz * o, cz + uz * d + ux * o];
const P = (p, h = 0) => ({ x: p[0], z: p[1], heading: h, u: 3 });
const boats = [{ id: 'me', kind: 'player', name: 'Halcyon' }, { id: 'wren', kind: 'ai', name: 'Osprey' }];

test('Easy: over early is no penalty, only a call and a way back; touches and meetings owe no turn', () => {
  const r = createRace({ course: C, boats, forgiving: true }), o = createOfficer({ forgiving: () => r.forgiving });
  const ev = [];
  r.step(59.5, { me: P(at(-30)), wren: P(at(-30, 40)) });
  ev.push(...r.step(1, { me: P(at(6)), wren: P(at(-30, 40)) }));     // over, just after the gun
  assert.ok(ev.some((e) => e.type === 'ocs' && e.id === 'me'));
  assert.equal(r.view('me').owes, false, 'no turn owed for being early');
  o.feed(ev, r.clock);
  assert.equal(o.step(1).id, 'rc_ocs_easy', 'the officer says dip back, not "restart"');
  ev.push(...r.step(1, { me: P(at(-6)), wren: P(at(-30, 40)) }));
  assert.equal(r.view('me').status, 'behind');
  assert.equal(r.touch('me', 'mark'), null, 'a mark touch owes nothing on Easy');
  const ev2 = r.step(1, { me: P([0, 0], 0), wren: P([4, 0], 2) });
  assert.equal(ev2.some((e) => e.type === 'penalty'), false);
  const hard = createRace({ course: C, boats, forgiving: false }); hard.step(61, { me: P(at(-30)), wren: P(at(-30, 40)) });
  assert.ok(hard.touch('me', 'mark'), 'Medium and Hard still owe the turn');
});

test('Easy: a wrong-side rounding is a call and a retry, never a disqualification; the next correct rounding counts', () => {
  const r = createRace({ course: C, boats, forgiving: true }), o = createOfficer({ forgiving: true });
  const W = C.byId.W.at, I = C.byId.I.at, ctr = C.line.centre;
  const g = roundingGeometry({ x: ctr[0], z: ctr[1] }, { x: W[0], z: W[1] }, { x: I[0], z: I[1] }, 'port');
  r.step(61, { me: P(at(-20)), wren: P(at(-20, 40)) });
  const run = (pts) => { const ev = []; let p = at(-20); for (const q of pts) { const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2); for (let i = 1; i <= n; i++) ev.push(...r.step(0.5, { me: P([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]), wren: P(at(-20, 40)) })); p = q; } return { ev, p }; };
  const a = run([at(10), g.exit, g.outside, g.approach]);   // the wrong way round
  assert.ok(a.ev.some((e) => e.type === 'wrongSide'));
  o.feed(a.ev, r.clock); assert.equal(o.step(1).id, 'rc_wrong');
  assert.equal(r.view('me').nextMark, 'W', 'still to round W');
  assert.equal(r.done, false);
  const ev = []; let p = a.p;
  for (const q of [g.approach, g.outside, g.exit]) { const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2); for (let i = 1; i <= n; i++) ev.push(...r.step(0.5, { me: P([p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n]), wren: P(at(-20, 40)) })); p = q; }
  assert.ok(ev.some((e) => e.type === 'rounded' && e.id === 'me' && e.mark === 'W'), 'go back round and it counts');
});

test('the briefing flow: card (auto-starts after 20 s) -> rival intro (4 s, skippable) -> the countdown; difficulty only on the card', () => {
  const f = createFlow();
  assert.equal(f.state, 'brief'); assert.equal(f.difficulty, 'easy'); assert.equal(f.running, false);
  f.choose('hard'); assert.equal(f.difficulty, 'hard');
  assert.equal(f.start(), true); assert.equal(f.state, 'intro');
  f.choose('easy'); assert.equal(f.difficulty, 'hard', 'not after the card');
  f.step(1); assert.equal(f.state, 'intro'); f.skip(); assert.equal(f.state, 'race'); assert.equal(f.running, true);
  const g = createFlow(); g.step(BRIEF.autoS - 0.5); assert.equal(g.state, 'brief'); g.step(1); assert.equal(g.state, 'intro');
  g.step(BRIEF.introS + 0.1); assert.equal(g.state, 'race');
  assert.ok(BRIEF.autoS <= 20, 'the card is at most 20 s');
  assert.equal(createFlow({ show: false }).state, 'race');
  const h = createFlow({ show: false }); assert.equal(h.reopen(), true); assert.equal(h.state, 'help'); assert.equal(h.close(), 'race');
  assert.deepEqual(DIFFICULTY.map((d) => d.id), ['easy', 'medium', 'hard']);
  assert.equal(diffById('easy').forgiving, true); assert.equal(diffById('hard').guide, false); assert.equal(diffById('nope').id, 'easy');
});

test('the briefing: the mini-chart sits inside its box with each mark\'s side in words; three plain rules', () => {
  const m = briefModel(C);
  for (const p of [...m.line, ...m.marks.map((k) => k.at), ...m.route]) assert.ok(p[0] >= 0 && p[0] <= m.w && p[1] >= 0 && p[1] <= m.h, JSON.stringify(p));
  assert.equal(m.marks.length, 2); assert.match(m.marks[0].text, /^Keep the orange mark W on your left$/);
  assert.equal(m.route.length, 4);
  assert.equal(RULES_TEXT.length, 3); assert.match(RULES_TEXT.join(' '), /after the gun[\s\S]*the way the arrow shows[\s\S]*hit the other boat/);
  // north up: the finish (north-east) is above the windward mark (south-west)
  assert.ok(m.finish[1] < m.marks[0].at[1]);
});

test('the guide line: a dashed line from the boat to the first rounding point not yet reached; the label says which side', () => {
  const tgt = { mark: 'W', at: { x: 100, z: 0 }, rounding: 'port', route: [[60, 0], [80, 20], [100, 40]] };
  let g = guideModel({ pose: { x: 0, z: 0 }, target: tgt });
  assert.deepEqual(g.wp, [60, 0]); assert.equal(g.label, 'Round ⟲ — keep it on your left');
  g = guideModel({ pose: { x: 55, z: 0 }, target: tgt, routeIdx: g.routeIdx }); assert.deepEqual(g.wp, [80, 20], 'the next point once the first is reached');
  assert.equal(guideModel({ pose: { x: 0, z: 0 }, target: null }), null);
  assert.match(guideModel({ pose: { x: 0, z: 0 }, target: { ...tgt, rounding: 'starboard' } }).label, /right/);
  const d = dashSegments([0, 0], [30, 0], 3, 3);
  assert.equal(d.length, 5); assert.deepEqual(d[0], [0, 0, 3, 0]); assert.ok(d.every((s) => s[2] <= 30));
  assert.deepEqual(dashSegments([5, 5], [5, 5]), []);
});

test('Osprey starts near, in view: 60-120 m away, on the same side of the line, ahead of the bow', () => {
  const [me, wren] = startPoses(C, 210 * Math.PI / 180, ['me', 'wren'], { a: [0.85, 0.15] });
  const d = Math.hypot(me.x - wren.x, me.z - wren.z);
  assert.ok(d >= 55 && d <= 120, `${d} m`);
  const side = (p) => (p.x - cx) * ux + (p.z - cz) * uz;
  assert.ok(side(me) < -40 && side(wren) < -40, 'both below the line');
  const bearing = Math.atan2(wren.x - me.x, -(wren.z - me.z)), rel = Math.abs(((bearing - me.heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
  assert.ok(rel < 60, `${rel.toFixed(0)} deg off the bow: inside the follow camera's view`);
});

test('the rival\'s marker at the screen edge: none when in view; an arrow on the edge when out of it; behind the camera too', () => {
  assert.equal(edgeMarker({ x: 0.2, y: 0, w: 1 }).offscreen, false);
  const r = edgeMarker({ x: 3, y: 0, w: 1 }, { width: 1280, height: 720, margin: 56 });
  assert.equal(r.offscreen, true); assert.equal(r.x, 1280 - 56); assert.ok(Math.abs(r.y - 360) < 1); assert.ok(Math.abs(r.angleDeg - 90) < 1e-6);
  const l = edgeMarker({ x: -3, y: 0.2, w: 1 }); assert.equal(l.x, 56);
  const b = edgeMarker({ x: 0.1, y: 0, w: -1 });   // behind: it points the way the boat would be if the camera turned
  assert.equal(b.offscreen, true); assert.ok(b.x < 640);
  const up = edgeMarker({ x: 0, y: 5, w: 1 }); assert.equal(up.y, 56); assert.ok(Math.abs(up.angleDeg) < 1e-6);
});

test('plain words for the gap; the coach speaks at the moments, not over itself; the finish always ends well', () => {
  assert.equal(gapWords(40), 'Osprey leads by 40 m'); assert.equal(gapWords(-62), 'You lead Osprey by 60 m'); assert.equal(gapWords(3), 'Level with Osprey');
  const c = createCoach(); const lines = [];
  for (let t = -60; t < 5; t += 0.5) { const l = c.step(0.5, { clock: t, easy: true, lineS: 12 }); if (l) lines.push([t, l]); }
  assert.match(lines[0][1], /Stay below the line/); assert.ok(lines.some(([, l]) => /Line in/.test(l)));
  assert.ok(lines.every((l, i) => i === 0 || l[0] - lines[i - 1][0] >= 8), 'eight seconds apart at least');
  const d = createCoach();
  assert.match(d.step(1, { clock: 100, events: [{ type: 'rounded', id: 'me', mark: 'W' }] }), /island mark/);
  assert.equal(d.step(1, { clock: 101, covered: true }), null, 'too soon after the last');
  assert.match(d.step(9, { clock: 110, covered: true }), /sitting on your wind/);
  assert.match(createCoach().step(1, { clock: 50, gustRatio: 1.4 }), /Gust coming/);
  assert.match(createCoach().step(1, { clock: 50, events: [{ type: 'wrongSide', id: 'me' }] }), /Go back round/);
  assert.match(finishNote({ place: 1, tierId: 'easy' }), /Try Medium next\?/);
  assert.match(finishNote({ place: 2, tierId: 'easy', isNew: true, prev: null }), /first race/);
  assert.doesNotMatch(finishNote({ place: 2, tierId: 'hard', isNew: false }), /lose|lost|fail/i);
});

test('choosing a difficulty on the card sets the rival and the rules; a restart keeps them', () => {
  const [a, b] = startPoses(C, 210 * Math.PI / 180, ['me', 'wren'], { a: [0.85, 0.15] });
  const mk = (p) => { const phys = new BoatPhysics({ x: p.x, z: p.z, heading: p.heading, speed: p.speed }); return { phys, step: (dt, ctl, t, w) => phys.step(dt, ctl, { t, windAt: w }) }; };
  const s = createSession({ course: C, me: mk(a), wren: mk(b), baseWind: windFn({ kn: 14, fromDeg: 210 }), layout: { a: [0.85, 0.15] } });
  s.setDifficulty('easy', true);
  assert.equal(s.brain.skill, 0.2); assert.equal(s.forgiving, true); assert.equal(s.race.forgiving, true); assert.equal(s.race.clock, -60);
  s.paused = true; s.step(30); assert.equal(s.race.clock, -60, 'held while the card is up');
  s.paused = false; s.step(10); s.restart(); assert.equal(s.race.forgiving, true); assert.equal(s.brain.skill, 0.2);
  s.setDifficulty('hard', false); assert.equal(s.brain.skill, 0.8); assert.equal(s.race.forgiving, false);
});
