// The game's rounding (owner 2026-11-17, after racing: "Our definition of finishing a leg is too strict. I think I crossed leg 1's
// target, but it wasn't clearly counted, and leg 2 didn't light up"). The old rule (v1's CourseTracker, kept for Pro) counts a mark only
// when the boat, within 55 m, sweeps across the bearing outside the turn; reasonable passes did not count. Beginner and Club now count a
// crossing of the mark's rounding line on the side to pass (v2/regatta/rounding.js); Beginner forgives a little on the wrong side, Club
// says "Go round mark 1 — keep it on your left" at once. Each reproduced pass, the cue, the coach, the watch, the lines, the fleet on
// the new rule, and Pro unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CourseTracker } from '../../src/sim/marks/course.js';
import { BoatPhysics, DT, steadyWind } from '../../src/sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { createRace } from '../../src/sim/race/rules.js';
import { RoundingTracker, roundRule, roundingCue, lineCoords, trackerFor, ROUND } from '../regatta/rounding.js';
import { createRegattaSession } from '../regatta/session.js';
import { courseToWind, ZONE_M } from '../regatta/geometry.js';
import { COURSE_SCALE, createRegatta } from '../regatta/index.js';
import { createCoach } from '../regatta/coach.js';
import { watchLines } from '../regatta/ui.js';
import { createSegmentWriter, buildRaceLines, INK, WIDTH, gateInk } from '../regatta/lines.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { targetOf, createBeacon } from '../sim/waymark.js';
import { SEG_FLOATS } from '../render/raceLines.js';

// a plain course: the line's middle at (0, 600), mark 1 at (0, 0) dead ahead (leg 1 sails north), mark 2 back down at (−300, 450)
const P = { committee: { x: -50, z: 600 }, pin: { x: 50, z: 600 }, m1: { x: 0, z: 0 }, m2: { x: -300, z: 450 } };
const COURSE = { kind: 'regatta', rounding: 'port', laps: 1, sequence: ['m1', 'm2'], line: { a: 'committee', b: 'pin' }, origin: { x: 0, z: 600 } };
// the passes (x east, z south; port rounding: the mark on her left, so she should pass on its east side)
const PASS = {
  textbook: [[30, 600], [30, -30], [0, -40], [-300, 450]],
  closeOutsideZone: [[40, 600], [40, -40], [-300, 450]],    // 40 m off: outside the 26 m ring drawn on the water
  turnEarly: [[15, 600], [15, 4], [-300, 450]],             // the turn begun 4 m short of abeam
  pastNoSweep: [[20, 600], [20, -10], [-300, 450]],         // a tight, correct rounding that never sweeps the outside bearing
  overstand: [[80, 600], [80, -40], [-300, 450]],           // past the line 80 m wide, then down past the mark
  wrongLittle: [[-8, 600], [-8, -30], [-300, 450]],         // 8 m on the wrong side
  cutInside: [[15, 600], [15, 30], [-300, 450]],            // turned 30 m short: the mark left on her right
};
// sail a pass through a tracker (1 m steps), mark 1 only: its first event, and whether the cue showed before it counted
function sail(T, pts, { mirror = false } = {}) {
  let t = 0, first = null, cue = false;
  for (let i = 1; i < pts.length && !first; i++) {
    const [a, b] = [pts[i - 1], pts[i]], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let k = 0; k < n && !first; k++) {
      const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
      for (const e of T.update({ x: mirror ? -x : x, z }, t)) if (e.mark === 'm1' && !first) first = e;
      if (!first && T.rule && T.guide && roundingCue(T.guide, T.rule)) cue = true;
      t += 0.5;
    }
  }
  return { type: first?.type ?? null, close: !!first?.close, cue, k: T.k };
}
const strict = () => new CourseTracker(COURSE, { positions: () => P });
const game = (level, course = COURSE, pos = P) => new RoundingTracker(course, { positions: () => pos, rule: roundRule(level) });

test('the old rule (v1, Pro): a close pass outside the zone, an early turn, a tight rounding without the sweep and an overstand do not count', () => {
  assert.equal(sail(strict(), PASS.textbook).type, 'rounded', 'the textbook rounding counts');
  for (const k of ['closeOutsideZone', 'turnEarly', 'pastNoSweep', 'overstand', 'wrongLittle', 'cutInside']) assert.equal(sail(strict(), PASS[k]).type, null, `${k}: not counted by the old rule`);
});

test('Beginner: every reasonable pass counts at once; a little on the wrong side counts too (close); cutting inside does not, and the cue says so', () => {
  for (const k of ['textbook', 'closeOutsideZone', 'turnEarly', 'pastNoSweep', 'overstand']) {
    const r = sail(game('beginner'), PASS[k]);
    assert.deepEqual([r.type, r.close, r.k], ['rounded', false, 1], `${k}: counted`);
  }
  const w = sail(game('beginner'), PASS.wrongLittle);
  assert.deepEqual([w.type, w.close], ['rounded', true], '8 m on the wrong side: counted, close (the gentle note)');
  const c = sail(game('beginner'), PASS.cutInside);
  assert.deepEqual([c.type, c.k, c.cue], [null, 0, true], 'cut inside: not counted, "Round mark 1 →" showed');
  // past the margin (half a zone) on the wrong side: the wrong side, not counted
  const far = sail(game('beginner'), [[-20, 600], [-20, -30], [-300, 450]]);
  assert.deepEqual([far.type, far.k], ['wrongSide', 0]);
});

test('Club: the wrong side does not count, at once (wrongSide, the cue on); dipping back and crossing on the right side counts', () => {
  for (const k of ['textbook', 'closeOutsideZone', 'turnEarly', 'pastNoSweep', 'overstand']) assert.equal(sail(game('club'), PASS[k]).type, 'rounded', k);
  const T = game('club'), w = sail(T, PASS.wrongLittle);
  assert.deepEqual([w.type, w.k], ['wrongSide', 0], 'Club: the wrong side');
  assert.ok(T.guide.wrong && roundingCue(T.guide, T.rule), 'the guide knows: wrong side, the cue on');
  // she comes back below the mark and goes round it
  const back = sail(T, [[-8, -30], [-8, 20], [20, 20], [20, -10], [-300, 450]]);
  assert.deepEqual([back.type, back.k], ['rounded', 1], 'gone round: counted');
});

test('the rounding line: square to the leg from the mark, the side to pass positive; starboard mirrors port', () => {
  const c = lineCoords([0, 600], [0, 0], 'port', 30, -5);
  assert.ok(Math.abs(c.a - 5) < 1e-9 && Math.abs(c.s - 30) < 1e-9 && Math.abs(c.d - Math.hypot(30, 5)) < 1e-9);
  assert.ok(Math.abs(lineCoords([0, 600], [0, 0], 'starboard', 30, -5).s + 30) < 1e-9);
  const rule = roundRule('beginner');
  assert.equal(rule.reachM, ROUND.reachK * ZONE_M); assert.equal(rule.wrongOkM, ROUND.wrongOkK * ZONE_M); assert.equal(roundRule('club').wrongOkM, 0);
  assert.equal(roundRule('pro'), null, 'Pro: the real rule');
  // a starboard course, the passes mirrored: the same verdicts
  const S = { ...COURSE, rounding: 'starboard' }, PM = { ...P, m2: { x: 300, z: 450 } };
  assert.equal(sail(game('club', S, PM), PASS.closeOutsideZone, { mirror: true }).type, 'rounded');
  assert.equal(sail(game('club', S, PM), PASS.wrongLittle, { mirror: true }).type, 'wrongSide');
  assert.deepEqual([sail(game('beginner', S, PM), PASS.wrongLittle, { mirror: true }).close], [true]);
});

test('the race: rules.js passes close through, holds a rounding while a turn is owed and counts it after; Pro keeps the CourseTracker', () => {
  const course = courseToWind(courseFor('tahoe-emerald', 'island-sprint'), 210, { loadCourse, snapCourse, scale: COURSE_SCALE.race });
  const L0 = course.legs[0], u = [(L0.to[0] - L0.from[0]) / L0.len, (L0.to[1] - L0.from[1]) / L0.len], right = [-u[1], u[0]];
  const at = (a, s) => ({ x: L0.to[0] + u[0] * a + right[0] * s, z: L0.to[1] + u[1] * a + right[1] * s, heading: 0, u: 3 });
  const run = (level, s, owe = false) => {
    const race = createRace({ course, boats: [{ id: 'me', kind: 'player' }], prestartS: 1, forgiving: false, tracker: trackerFor(level, course) });
    const out = [];
    const step = (p) => out.push(...race.step(0.1, { me: p }));
    for (let i = 0; i < 12; i++) step(at(-L0.len - 30, 0));   // below the line to the gun
    for (let i = 0; i < 15; i++) step(at(-L0.len - 30 + i * 4, 0));   // then across it
    assert.equal(race.view('me').status, 'racing', 'started');
    if (owe) race.touch('me', 'boat');
    for (let a = -60; a <= 20; a += 2) step(at(a, s));
    return { race, out };
  };
  const b = run('beginner', -8).out.find((e) => e.type === 'rounded');
  assert.ok(b && b.close === true && b.mark === course.markIds[0], 'Beginner: close passes through');
  const h = run('club', 30, true);
  assert.ok(h.out.some((e) => e.type === 'roundingHeld') && !h.out.some((e) => e.type === 'rounded'), 'a turn owed: held');
  // she sails her 360 just past the line, then the rounding counts
  for (let i = 0; i <= 40; i++) h.out.push(...h.race.step(0.1, { me: { ...at(20, 30), heading: i * Math.PI / 18 } }));
  assert.ok(h.out.some((e) => e.type === 'turnDone') && h.out.some((e) => e.type === 'rounded'), 'the turn done: counted');
  const p = run('pro', 30);
  assert.equal(p.race.view('me').guide, null, 'Pro: v1\'s tracker (no guide)');
  assert.equal(p.out.some((e) => e.type === 'rounded'), false, 'Pro: a straight pass 30 m off does not count (the real rule)');
});

// a fleet race with the player parked far away: the rivals alone to the last finisher
function fleetRace({ seed = 1, round = null, maxS = 700 } = {}) {
  const course = courseToWind(courseFor('tahoe-emerald', 'island-sprint'), 210, { loadCourse, snapCourse, scale: COURSE_SCALE.race });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: 210 } });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, windAt, seed, tier: 'medium', forgiving: round !== 'club', rivals: 3, round });
  const log = [];
  let t = 0;
  while (t < maxS + 45 && !S.rivals.every((r) => S.race.view(r.id).status === 'finished')) { t += DT; S.advanceTo(t); log.push(...S.drain()); }
  return { S, log, course };
}

// ---------------- the moment and the guidance on the page's side ----------------
test('the coach (Club, mistakes only): the wrong side at once, over the rounding line, "Go round mark 1 — keep it on your left", the gate lit', () => {
  const C = createCoach({ coach: 'mistakes' });
  const sit = { clock: 80, status: 'racing', ocs: false, legKind: 'beat', leg: 0, finishLeg: false, lay: null, inZone: true, rounding: 'port', next: { id: 'I', num: '2' }, target: { id: 'W', num: '1' }, tacked: false, wrongSide: false };
  C.update(80, sit);
  C.event({ type: 'wrongSide', id: 'me', mark: 'W' });
  const l = C.update(80.1, { ...sit, wrongSide: true });
  assert.equal(l?.id, 'wrongSide'); assert.equal(l.text, 'Go round mark 1 — keep it on your left.'); assert.deepEqual(l.lit, ['gate']);
  C.event({ type: 'rounded', id: 'me', mark: 'W' });
  assert.notEqual(C.update(81, { ...sit, wrongSide: false, inZone: false, leg: 1 })?.id, 'wrongSide', 'gone once it counts');
  // Beginner's full coach takes the line over its own rounding step at once
  const B = createCoach({ coach: 'all' });
  assert.equal(B.update(90, sit)?.id, 'rounding');
  assert.equal(B.update(90.2, { ...sit, wrongSide: true })?.id, 'wrongSide', 'over the rounding line, at once');
});

test('the watch: "Mark 1 ✓" flashing amber on the count, "Round mark 1 →" amber near a mark not counted yet, else the leg line', () => {
  const base = { clock: 80, status: 'racing', line: { distM: -100 }, next: { text: 'Leg 1 of 3 · Mark 1 · round to port' } };
  assert.deepEqual((({ l1, l1amber, l1flash }) => [l1, l1amber, l1flash])(watchLines(base)), ['Leg 1 of 3 · Mark 1 · round to port', false, false]);
  assert.deepEqual((({ l1, l1amber }) => [l1, l1amber])(watchLines({ ...base, cue: 'Round mark 1 →' })), ['Round mark 1 →', true]);
  assert.deepEqual((({ l1, l1amber, l1flash }) => [l1, l1amber, l1flash])(watchLines({ ...base, cue: 'Round mark 2 →', flash: 'Mark 1 ✓' })), ['Mark 1 ✓', true, true]);
});

test('the lines: the gate brightened (wider, glowing, breathing) when hot; the new leg amber and marching after a rounding', () => {
  const C = courseToWind(courseFor('tahoe-emerald', 'island-sprint'), 210, { loadCourse, snapCourse, scale: 0.35 }), M1 = C.legs[0].to;
  const segs = (pic) => { const W = createSegmentWriter(), n = buildRaceLines(W, pic), out = []; for (let i = 0; i < n; i++) { const o = i * SEG_FLOATS; out.push({ w: W.f32[o + 3], glow: W.f32[o + 7], col: W.u32[o + 8], dash: W.f32[o + 9], flag: W.f32[o + 11] }); } return out; };
  const pk = (c) => ((Math.round(c[0] * 255) & 255) | ((Math.round(c[1] * 255) & 255) << 8) | ((Math.round(c[2] * 255) & 255) << 16) | ((Math.round(c[3] * 255) & 255) << 24)) >>> 0;
  const pic = { line: C.line, clock: 80, legs: C.legs, leg: 0, boat: [M1[0] + 60, M1[1] + 60], markM: 30, zone: { at: M1, r: ZONE_M, inside: false, rounding: 'port' } };
  const cold = segs({ ...pic, gate: { at: M1, r: 39, rounding: 'port', a: 0 } }).filter((s) => s.col === pk(gateInk('port')));
  const hot = segs({ ...pic, gate: { at: M1, r: 39, rounding: 'port', a: 0, hot: true } }).filter((s) => s.col === pk(gateInk('port')));
  assert.ok(cold.length && cold.every((s) => s.w === WIDTH.gate && (s.flag & 1) === 0));
  assert.ok(hot.length === cold.length && hot.every((s) => s.w === WIDTH.gateHot && s.glow === WIDTH.gateHotGlow && (s.flag & 1) === 1), 'hot: wider, glowing, pulsing');
  const lit = segs({ ...pic, leg: 1, legLit: true }).filter((s) => s.dash > 0 && s.col === pk(INK.amber) && s.w === WIDTH.legLit);
  assert.equal(lit.length, 1, 'the new leg amber, dashed (marching)'); assert.equal(lit[0].flag & 1, 1);
});

const fakeLines = () => ({ stats: { active: false, count: 0 }, setActive(on) { this.stats.active = on; }, write(f, n) { this.stats.count = n; this.f = f.slice(0, n * SEG_FLOATS); } });
const fakeProps = () => ({ stats: { instances: 0 }, setActive() {}, begin() {}, put() {}, end() {} });
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function raceInNode(flags = {}) {
  const wind = { sample: (x, z, t) => { const v = steadyWind(6, 210)(x, z, t); return { vx: v.vx, vz: v.vz }; }, base: { dirDeg: 210, speedMs: 6 }, setLevel() { return 1; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const clock = { t: 0, hourUnwrappedAt: () => 15, setHour: () => {} };
  const lines = fakeLines();
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', course: 'short', ...flags }, P: { headless: true }, lines, props: fakeProps(), store: memStore(), persist: false });
  return { R, B, lines };
}
const VP = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test('in a race (Beginner): a loose pass 40 m off counts on the crossing; before it the cue and the hot gate; then the beacon, leg 2, the tick', async () => {
  const { R, B, lines } = raceInNode({ flyover: '0', autoplay: '1' });
  await R.enter();
  for (let i = 0; i < 400 && R.session.race.view('me').status !== 'racing'; i++) R.settle(0.25);
  assert.equal(R.session.race.view('me').status, 'racing');
  const C = R.course, L0 = C.legs[0], u = [(L0.to[0] - L0.from[0]) / L0.len, (L0.to[1] - L0.from[1]) / L0.len], right = [-u[1], u[0]], h = Math.atan2(u[0], -u[1]) * 180 / Math.PI;
  const place = (a, s) => B.place({ x: L0.to[0] + u[0] * a + right[0] * s, z: L0.to[1] + u[1] * a + right[1] * s, headingDeg: h, speed: 3 });
  const beacon = createBeacon(), gateCol = ((c) => ((Math.round(c[0] * 255) & 255) | ((Math.round(c[1] * 255) & 255) << 8) | ((Math.round(c[2] * 255) & 255) << 16) | ((Math.round(c[3] * 255) & 255) << 24)) >>> 0)(gateInk('port'));
  let cueBefore = false, hotBefore = false, countedAt = null, arrive = false;
  for (let a = -90; a <= 30 && countedAt == null; a += 0.5) {
    place(a, 40); R.settle(DT); R.frame(VP, 1280, 720, DT);
    beacon.update(targetOf({ race: R.beaconView() }), B.state, DT);
    const v = R.session.race.view('me');
    if (v.leg === 0 && R.stats.cue) cueBefore = true;
    if (v.leg === 0 && lines.f) for (let i = 0; i < lines.stats.count; i++) { const o = i * SEG_FLOATS, u32 = new Uint32Array(lines.f.buffer, lines.f.byteOffset, lines.f.length); if (u32[o + 8] === gateCol && lines.f[o + 3] === WIDTH.gateHot) hotBefore = true; }
    if (v.leg === 1) countedAt = a;
  }
  assert.ok(countedAt != null && countedAt <= 1, `counted on the crossing (a = ${countedAt} m past the mark; the line sits ${ROUND.leadK * ZONE_M} m back)`);
  assert.ok(cueBefore, 'the watch\'s "Round mark 1 →" before it counted'); assert.ok(hotBefore, 'the gate brightened before it counted');
  const st = beacon.update(targetOf({ race: R.beaconView() }), B.state, DT); arrive = st.phase === 'arrive' || st.arrivals > 0;
  assert.ok(arrive, 'the beacon\'s lift and fade on the count');
  assert.equal(R.stats.rounds.length, 1); assert.equal(R.stats.rounds[0].n, 1);
  R.frame(VP, 1280, 720, DT);
  const u32 = new Uint32Array(lines.f.buffer, lines.f.byteOffset, lines.f.length);
  let legLit = false; for (let i = 0; i < lines.stats.count; i++) { const o = i * SEG_FLOATS; if (lines.f[o + 3] === WIDTH.legLit && lines.f[o + 9] > 0) legLit = true; }
  assert.ok(legLit, 'leg 2 lit amber, marching');
  assert.equal(R.stats.cue, false, 'no cue once counted');
});
