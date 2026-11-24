// The passage plan: a. the per-leg numbers from our polar (legPlan, routePlan, barbGrid). Plain JS.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legPlan, routePlan, barbGrid, clearWidth, windLine, editRoute, makeView, PLAN, NM } from '../src/ui/chartplotterData.js';
import { bestVmg, polarKn } from '../src/sim/boat/groove.js';
import { chillWorld } from '../src/modes/chill/sim.js';
import { findPath } from '../src/sim/modes/chill/navigator.js';
import { ensureCourse, courseLine, markName } from '../src/sail/passagePlan.js';
import { sheetRows } from '../src/sail/passageSheet.js';
import { createPassage } from '../src/ui/passage.js';

const DEG = Math.PI / 180;
// a wind from the north (0 rad) at 12 kn; legs from (0, 0)
const N = { x: 0, z: -NM }, E = { x: NM, z: 0 }, S = { x: 0, z: NM };
const env = { windFrom: 0, twsKn: 12 };

test('a. a 1 nm beat dead upwind in 12 kn: the polar\'s tacking angle, the sailed distance, two tacks in a 900 m corridor, the time by hand', () => {
  const up = bestVmg(12, true).twa;
  const L = legPlan({ x: 0, z: 0 }, N, { ...env, boardM: 900 });
  assert.equal(L.ok, true); assert.equal(L.point, 'beat'); assert.equal(L.words, 'beat');
  assert.ok(Math.abs(L.brg - 0) < 1e-9 || Math.abs(L.brg - 360) < 1e-9, `bearing ${L.brg}`);
  assert.ok(Math.abs(L.sailedNm - 1 / Math.cos(up * DEG)) < 1e-9, `sailed ${L.sailedNm} nm (1 / cos ${up}°)`);
  assert.equal(L.speedKn, polarKn(12, up));
  // 1 / cos(40°) = 1.305 nm = 2417 m over 900 m boards: 3 boards, 2 tacks
  assert.equal(L.tacks, 2); assert.equal(L.gybes, 0);
  const hand = L.sailedNm / polarKn(12, up) * 60 + 2 * PLAN.tackS / 60;
  assert.ok(Math.abs(L.minutes - hand) <= 0.5, `${L.minutes.toFixed(2)} min vs ${hand.toFixed(2)} by hand`);
  // open water: a beat still needs one tack
  assert.equal(legPlan({ x: 0, z: 0 }, N, env).tacks, 1);
});

test('a. a beam reach sails the polar at 90° with no tack; a dead run is a run with one gybe; the reaches split at 60° and 120°', () => {
  const R = legPlan({ x: 0, z: 0 }, E, env);
  assert.equal(R.point, 'beam'); assert.equal(R.speedKn, polarKn(12, 90)); assert.equal(R.tacks, 0); assert.equal(R.gybes, 0);
  assert.ok(Math.abs(R.brg - 90) < 1e-9 && Math.abs(R.twa - 90) < 1e-9);
  assert.ok(Math.abs(R.minutes - 60 / polarKn(12, 90)) < 1e-9);
  const D = legPlan({ x: 0, z: 0 }, S, env);
  assert.equal(D.point, 'run'); assert.equal(D.words, 'run'); assert.equal(D.gybes, 1); assert.equal(D.tacks, 0);
  assert.equal(D.twaSail, Math.min(bestVmg(12, false).twa, PLAN.downMaxDeg));
  const at = (deg) => legPlan({ x: 0, z: 0 }, { x: Math.sin(deg * DEG) * NM, z: -Math.cos(deg * DEG) * NM }, env).point;
  assert.equal(at(50), 'close'); assert.equal(at(-75), 'beam'); assert.equal(at(140), 'broad'); assert.equal(at(-30), 'beat');
  // no wind: no time
  assert.equal(legPlan({ x: 0, z: 0 }, E, { windFrom: 0, twsKn: 0 }).minutes, null);
});

test('a. routePlan sums the legs and lands the ETA on the ship\'s clock at 2x in Sail; the notes name the beat and the run', () => {
  const wps = [{ ...N }, { ...E, name: 'the light' }, { x: NM, z: NM }];
  const P = routePlan({ x: 0, z: 0 }, wps, { ...env, hour: 16, rate: 2 });
  assert.equal(P.ok, true); assert.equal(P.legs.length, 3);
  const mins = P.legs.reduce((s, L) => s + L.minutes, 0), nm = P.legs.reduce((s, L) => s + L.distNm, 0);
  assert.ok(Math.abs(P.minutes - mins) < 1e-9 && Math.abs(P.nm - nm) < 1e-9);
  assert.ok(Math.abs(P.eta - (16 + P.minutes * 60 * 2 / 3600)) < 1e-9, `ETA ${P.eta}`);
  assert.equal(P.legs[1].name, 'the light'); assert.equal(P.about, true);
  assert.ok(P.notes[0].startsWith('Leg 1 is a beat: 1 tack on the laylines'), P.notes[0]);
  assert.ok(P.notes.some((n) => n === 'Leg 3 is dead downwind: 1 gybe.'), P.notes.join(' | '));
  assert.ok(P.notes.length <= PLAN.notesMax);
  // the day clock's own schedule when given (hourAt at t + the passage)
  const Q = routePlan({ x: 0, z: 0 }, wps, { ...env, hourAt: (t) => 10 + t / 3600, t: 7200 });
  assert.ok(Math.abs(Q.eta - (12 + Q.minutes / 60)) < 1e-9);
  assert.equal(windLine(0, 12), 'Wind N 12 kn at the boat.'); assert.equal(windLine(185 * DEG, 9.6), 'Wind S 10 kn at the boat.');
});

test('a. on the real bay: a leg across the sill has no safe way (ok false); a leg round the island bends and says why; the corridor is measured', () => {
  const W = chillWorld({ seed: 1, hour: 16, rate: 0 }), chart = W.chart;
  const real = { ...env, path: (a, b) => findPath(chart, a, b), depthAt: chart.depthAt, widthAt: (x, z, b) => clearWidth(chart.marginAt, x, z, b) };
  const out = legPlan({ x: 300, z: -200 }, { x: 1500, z: -1800 }, real);
  assert.equal(out.ok, false); assert.equal(out.note, 'No safe way');
  const P = routePlan({ x: 300, z: -200 }, [{ x: 1500, z: -1800 }], real);
  assert.equal(P.ok, false); assert.equal(P.eta, null); assert.ok(P.notes[0].includes('no safe way'), P.notes[0]);
  // across the island (the summit near the origin): the straight line runs over it, the path goes round
  const isl = W.terrain.lake.island;
  const a = { x: isl.x - 400, z: isl.z }, b = { x: isl.x + 400, z: isl.z };
  const L = legPlan(a, b, real);
  assert.equal(L.ok, true);
  assert.ok(L.path && L.bend, 'the leg bends');
  assert.ok(L.distNm > L.nm, `the bend is longer: ${L.distNm.toFixed(3)} > ${L.nm.toFixed(3)} nm`);
  assert.ok(['north', 'south'].includes(L.bend.dir), L.bend.dir);
  const R = routePlan(a, [b], real);
  assert.ok(R.notes.some((n) => n === `Leg 1 bends ${L.bend.dir} to keep off the shore.`), R.notes.join(' | '));
  // the clear width across a beat in the open bay is finite and positive, at most a nautical mile a side
  const w = clearWidth(chart.marginAt, 300, -200, 0);
  assert.ok(w > 100 && w <= 2 * NM, `width ${w}`);
});

test('a. route edits: add appends, insert puts a waypoint between, move drops the place name, remove and clear; set is no edit', () => {
  let r = editRoute([], { op: 'add', x: 1, z: 2 });
  r = editRoute(r, { op: 'add', index: 1, x: 5, z: 6, name: 'the light' });
  assert.deepEqual(r, [{ x: 1, z: 2, name: null }, { x: 5, z: 6, name: 'the light' }]);
  r = editRoute(r, { op: 'insert', index: 1, x: 3, z: 4 });
  assert.deepEqual(r.map((p) => p.x), [1, 3, 5]);
  assert.equal(editRoute(r, { op: 'move', index: 2, x: 9, z: 9 })[2].name, null);
  assert.deepEqual(editRoute(r, { op: 'remove', index: 0 }).map((p) => p.x), [3, 5]);
  assert.deepEqual(editRoute(r, { op: 'clear' }), []);
  assert.equal(editRoute(r, { op: 'set' }), null);
  assert.equal(r.length, 3, 'the input is not changed');
});

// c. the course service (src/sail/passagePlan.js) and the passage it feeds (src/ui/passage.js)
function services() {
  const m = new Map(), s = { get: (k) => m.get(k), provide: (k, v) => m.set(k, v), remove: (k) => m.delete(k) };
  s.provide('player', { phys: { state: { x: 0, z: 0, sog: 2, cog: 0 } } });
  s.provide('passage', createPassage({ services: s }));
  return s;
}

test('c. Set course copies the route and points the passage at waypoint 1 from the boat; 40 m advances, from the last waypoint; the last arrival clears', () => {
  const S = services(), course = ensureCourse(S), passage = S.get('passage');
  assert.equal(ensureCourse(S), course, 'one course for the page');
  course.edit({ op: 'add', x: 0, z: -500 }); course.edit({ op: 'add', x: 400, z: -500, name: 'the light' });
  assert.equal(passage.target, null, 'a draft sets nothing');
  assert.equal(course.set({ x: 0, z: 0 }), true);
  assert.equal(course.active, true); assert.equal(course.leg, 0);
  assert.deepEqual([passage.target.x, passage.target.z, passage.target.name], [0, -500, 'WP 1 · 2']);
  assert.deepEqual(passage.from, [0, 0]);
  // the copy: editing the returned route does not move the course
  const r = course.route; r[0].x = 999; assert.equal(course.route[0].x, 0);
  assert.equal(course.arrive({ x: 0, z: -459 }), null, '41 m: not yet');
  const a = course.arrive({ x: 0, z: -470 });
  assert.equal(a.kind, 'advance'); assert.equal(course.leg, 1);
  assert.deepEqual([passage.target.x, passage.target.name], [400, 'the light'], 'the last leg names the place');
  assert.deepEqual(passage.from, [0, -500], 'the leg starts at the previous waypoint');
  const b = course.arrive({ x: 390, z: -505 });
  assert.equal(b.kind, 'arrive'); assert.equal(b.wp.name, 'the light');
  assert.equal(course.active, false); assert.equal(course.route.length, 0); assert.equal(passage.target, null, 'the last arrival clears both');
});

test('c. Clear clears the course and the passage; a mode change (suspend, resume) keeps the course; Regatta\'s suspend gives the passage back', () => {
  const S = services(), course = ensureCourse(S), passage = S.get('passage');
  course.edit({ op: 'add', x: 100, z: -300 }); course.set({ x: 0, z: 0 });
  course.suspend();   // a chart with no plan (Regatta), or the mode's chart disposed
  assert.equal(passage.target, null); assert.equal(course.active, true, 'the course is kept');
  course.resume();    // the next mode's planner
  assert.equal(passage.target.x, 100);
  assert.equal(course.clear(), true);
  assert.equal(course.active, false); assert.equal(course.route.length, 0); assert.equal(passage.target, null);
  // a mark set by hand elsewhere is not cleared by the course
  passage.set({ x: 5, z: 5, name: 'x', kind: 'mark' }); course.clear(); assert.equal(passage.target.name, 'x');
});

test('c. the skipper\'s lines: Set course, the next leg, the arrival, Cruise\'s quiet line', () => {
  const leg = legPlan({ x: 0, z: 0 }, { x: 0, z: -1111 }, { windFrom: 0, twsKn: 12 });
  assert.equal(courseLine('set', { i: 0, leg }), 'Course set. Waypoint 1 bears 000°, 0.6 nm. A beat: tack on the laylines.');
  assert.equal(courseLine('advance', { i: 0, leg: legPlan({ x: 0, z: 0 }, { x: 1667, z: 0 }, env) }), 'Waypoint 1 astern. Next bears 090°, 0.9 nm.');
  assert.equal(courseLine('arrive', { name: 'the stone house' }), 'Arrived: the stone house. Course done.');
  assert.equal(courseLine('cruise', { n: 3, name: 'the stone house', minutes: 37.6 }), 'Aye. Three legs to the stone house, about 38 minutes.');
  assert.equal(courseLine('cruise', { n: 1 }), 'Aye. Setting a course for your mark.');
  assert.equal(courseLine('cruise', { n: 2, minutes: 0.7 }), 'Aye. Two legs to your mark, about 1 minute.');
  assert.equal(markName(2, 3, 'the light'), 'the light'); assert.equal(markName(0, 3, 'the light'), 'WP 1 · 3');
});

test('c. the sheet\'s rows: the title, the totals with about and the ETA, a row a leg, the active one marked', () => {
  const P = routePlan({ x: 0, z: 0 }, [{ ...N }, { ...E, name: 'the light' }], { ...env, hour: 16, rate: 2 });
  const s = sheetRows(P, { active: 0 });
  assert.equal(s.title, 'Passage · 2 legs');
  assert.match(s.total, /^\d+\.\d nm · about \d+ min$/, 'no ETA on the sheet (the owner\'s nav column ruling, 2026-11-12)');
  assert.match(sheetRows(P, { eta: true }).total, / · ETA \d\d:\d\d$/);
  assert.equal(s.rows.length, 2); assert.equal(s.rows[0].on, true); assert.equal(s.rows[1].on, false);
  assert.equal(s.rows[0].brg, '000°'); assert.equal(s.rows[0].words, 'beat · 1 tack');
  assert.match(s.rows[1].words, /reach · the light$/);
});

test('a. the barbs: a 3 x 3 grid (3 x 2 on a phone) over the water only, from the wind\'s 60 s mean, not the gust now', () => {
  const view = makeView({ cx: 0, cz: 0, mPerPx: 4, rot: 0, ox: 300, oy: 300 });
  const rect = { x0: 0, y0: 0, x1: 600, y1: 600 };
  // a wind from the south at 10 kn, with a 20 kn gust only at t = 1000 exactly
  const KN = 0.514444, windAt = (x, z, t) => ({ vx: 0, vz: -(t === 1000 ? 20 : 10) * KN });
  const B = barbGrid(rect, view, windAt, 1000);
  assert.equal(B.length, 9);
  for (const b of B) {
    assert.ok(Math.abs(b.kn - (10 + 10 / PLAN.barbSamples)) < 1e-9, `${b.kn} kn: the mean, not the gust`);
    assert.ok(Math.abs(Math.abs(b.fromRad) - Math.PI) < 1e-9, 'from the south');
  }
  assert.equal(barbGrid(rect, view, windAt, 500, { cols: 3, rows: 2 }).length, 6);
  // land (x < 0) is skipped
  assert.equal(barbGrid(rect, view, windAt, 500, { isWater: (x) => x > 0 }).length, 3);
});
