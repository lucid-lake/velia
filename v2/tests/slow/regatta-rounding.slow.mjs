// The slow half of v2/tests/regatta-rounding.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): the fleet rounds under the Club rule to the finish (the fast suite keeps the rule's unit cases and the Beginner fleet's roundings in regatta-r4).
// The game's rounding (owner 2026-11-17, after racing: "Our definition of finishing a leg is too strict. I think I crossed leg 1's
// target, but it wasn't clearly counted, and leg 2 didn't light up"). The old rule (v1's CourseTracker, kept for Pro) counts a mark only
// when the boat, within 55 m, sweeps across the bearing outside the turn; reasonable passes did not count. Beginner and Club now count a
// crossing of the mark's rounding line on the side to pass (v2/regatta/rounding.js); Beginner forgives a little on the wrong side, Club
// says "Go round mark 1 — keep it on your left" at once. Each reproduced pass, the cue, the coach, the watch, the lines, the fleet on
// the new rule, and Pro unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CourseTracker } from '../../../src/sim/marks/course.js';
import { BoatPhysics, DT, steadyWind } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { courseFor, loadCourse, snapCourse } from '../../../src/sim/race/course.js';
import { createRace } from '../../../src/sim/race/rules.js';
import { RoundingTracker, roundRule, roundingCue, lineCoords, trackerFor, ROUND } from '../../regatta/rounding.js';
import { createRegattaSession } from '../../regatta/session.js';
import { courseToWind, ZONE_M } from '../../regatta/geometry.js';
import { COURSE_SCALE, createRegatta } from '../../regatta/index.js';
import { createCoach } from '../../regatta/coach.js';
import { watchLines } from '../../regatta/ui.js';
import { createSegmentWriter, buildRaceLines, INK, WIDTH, gateInk } from '../../regatta/lines.js';
import { createBoatSim, waterFor } from '../../sim/boat.js';
import { targetOf, createBeacon } from '../../sim/waymark.js';
import { SEG_FLOATS } from '../../render/raceLines.js';

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

test('the fleet rounds under the same rule (Club): every rival rounds both marks in order and finishes', () => {
  const { S, log, course } = fleetRace({ round: 'club' });
  assert.equal(S.round, 'club');
  for (const r of S.rivals) {
    assert.ok(S.race.view(r.id).guide, `${r.name}: judged by the game's tracker`);
    assert.deepEqual(log.filter((e) => e.type === 'rounded' && e.id === r.id).map((e) => e.mark), course.markIds, `${r.name}: both marks`);
    assert.equal(S.race.view(r.id).status, 'finished', `${r.name} finished`);
  }
});

// ---------------- the moment and the guidance on the page's side ----------------

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

