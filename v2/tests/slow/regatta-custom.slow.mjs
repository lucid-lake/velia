// The slow half of v2/tests/regatta-custom.test.mjs (refactor round 3, the Regatta test diet; npm run test:v2:slow): every course raced to the finish by the fleet (Twice Round, Bay Tour; the fast suite keeps Harbour Dash); the −3:00 box (the fast suite keeps −1:30).
// Regatta's step B: the courses (Harbour Dash, Twice Round, Bay Tour beside the Island Sprint: each valid, laid in
// deep water, raced to the finish by the computer fleet in sim), two laps (the marks rounded twice in order, the results, the lap on
// the watch), the shift patterns (each with its own wind signature on the wind module; the fleet and the coach cope), Custom race
// (the picks reach the session; stored, clamped on read; Deal for me), the baked course cards. The browser half:
// v2/tests/pages/regattaCustom.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoatPhysics, DT, steadyWind } from '../../../src/sim/boat.js';
import { WindField } from '../../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { courseFor, courseIds, loadCourse, snapCourse, trackerCourse } from '../../../src/sim/race/course.js';
import { createRegattaSession } from '../../regatta/session.js';
import { courseToWind } from '../../regatta/geometry.js';
import { createRegatta } from '../../regatta/index.js';
import { makePattern, shiftTo, SHIFTS, OSC, PERSIST } from '../../regatta/shifts.js';
import { loadSetup, saveSetup, clampCustom, customHand, dealHand, handSeed, handKey, validHand, describeHand, minutesFor, COURSES, DEFAULT_SETUP, DEFAULT_CUSTOM, SETUP_KEY, PRESETS, STARTS, PACES, WATERS } from '../../regatta/setup.js';
import { customDials } from '../../regatta/hub.js';
import { resultCard } from '../../regatta/review.js';
import { watchLines } from '../../regatta/ui.js';
import { markNumbers, legLine } from '../../regatta/marks.js';
import { bakeText, OUT } from '../../../tools/v2-regatta-outlines.mjs';

const memStore = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const DEG = Math.PI / 180;

// ---------------- the courses ----------------

// a fleet race with the player parked far away: the rivals alone to the last finisher (the wind field without terrain, a pattern on it)
function fleetRace({ id, scale, laps, rivals = 5, dir = 210, shifts = null, seed = 1, maxS = 2400, prestartS = 45, level = 3 } = {}) {
  const course = courseToWind(courseFor(WATERS, id), dir, { loadCourse, snapCourse, scale, laps });
  const wf = new WindField({ seed, bay: CURRENT_WATERS.windBay, base: { dirDeg: dir, speedMs: [0, 3, 5, 7.5, 10][level] } });
  const tGun = prestartS;
  if (shifts) wf.pattern = makePattern(shifts, { tGun, raceS: 400 });
  const windAt = (x, z, t) => { const w = wf.sample(x, z, t); return { vx: w.vx, vz: w.vz }; };
  const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
  const S = createRegattaSession({ course, me: { phys }, rivals, windAt, seed, tier: 'medium', forgiving: true, prestartS });
  const log = []; let t = 0;
  while (t < maxS + prestartS && !S.rivals.every((r) => S.race.view(r.id).status === 'finished')) { t += DT; S.advanceTo(t); log.push(...S.drain()); }
  return { S, log, course, wf };
}
const roundings = (log, id) => log.filter((e) => e.type === 'rounded' && e.id === id).map((e) => e.mark);

test('every course is raced to the finish by the computer fleet, each rounding its marks in order (each under a shift pattern)', () => {
  const runs = [
    { id: 'harbour-dash', scale: 0.35, rivals: 3, shifts: 'oscillating' },
    { id: 'twice-round', scale: 0.35, rivals: 2, shifts: 'left' },
    { id: 'bay-tour', scale: 0.55, rivals: 1, shifts: 'right', level: 4 },
  ];
  for (const r of runs) {
    const { S, log, course } = fleetRace(r);
    for (const b of S.rivals) {
      assert.equal(S.race.view(b.id).status, 'finished', `${r.id}: ${b.name} finished (${S.race.view(b.id).status}, leg ${S.race.view(b.id).leg})`);
      assert.deepEqual(roundings(log, b.id), course.markIds, `${r.id}: ${b.name} rounded ${roundings(log, b.id).join(', ')}`);
      assert.ok(!log.some((e) => e.type === 'ocs' && e.id === b.id), `${r.id}: ${b.name} never over early`);
    }
    // the results: the rivals placed 1st to last in the order they crossed (the parked player last, unfinished)
    const fin = log.filter((e) => e.type === 'finished'), order = S.race.order();
    assert.deepEqual(fin.map((e) => e.place), S.rivals.map((_, i) => i + 1), `${r.id}: places`);
    assert.deepEqual(order.slice(0, S.rivals.length), fin.map((e) => e.id), `${r.id}: the order is the finish order`); assert.equal(order.at(-1), 'me');
  }
});

// ---------------- the shift patterns ----------------

// ---------------- Custom race on the page's race in node ----------------
// a fake wind that turns with the race's pattern (as the WindField does) and records the level asked for
function raceInNode({ flags = {}, store = memStore() } = {}) {
  const wind = { pattern: null, base: { dirDeg: 210, speedMs: 6 }, levelSet: [], setLevel(n) { this.levelSet.push(n); this.level = n; return 1; },
    sample(x, z, t) { const d = 210 + (this.pattern ? this.pattern.deg(t) : 0), v = steadyWind(6, d)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSimLite(wind);
  let hour = 15; const clock = { t: 0, hourUnwrappedAt: () => hour, setHour: (h) => { hour = h; } };
  const skies = [];
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', handseed: '7', ...flags }, P: { headless: true },
    lines: { stats: {}, setActive() {}, write() {} }, props: { stats: {}, setActive() {}, begin() {}, put() {}, end() {} }, store, persist: true, sky: (id) => skies.push(id) });
  return { R, B, wind, store, skies, hour: () => hour };
}
import { createBoatSim, waterFor } from '../../sim/boat.js';
const createBoatSimLite = (wind) => createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });

const PICK = { event: 'fleet', course: 'harbour-dash', length: 'club', laps: 2, wind: 2, shifts: 'left', sky: 'clear', time: 'golden', rivals: 2, start: 90, pace: 1.5 };

// ---------------- two laps, in node: the order, the watch, the results; the coach on the shifts ----------------

test('a −3:00 and a −1:30 pre-start: the fleet waits in the box and starts clean', () => {
  for (const prestartS of [180, 90]) {
    const course = courseToWind(courseFor(WATERS, 'harbour-dash'), 210, { loadCourse, snapCourse, scale: 0.35 });
    const windAt = (x, z, t) => steadyWind(7, 210)(x, z, t);
    const phys = new BoatPhysics({ x: course.line.centre[0] - course.line.up[0] * 3000, z: course.line.centre[1] - course.line.up[1] * 3000, heading: 0, speed: 0 });
    const S = createRegattaSession({ course, me: { phys }, rivals: 3, windAt, seed: 2, tier: 'medium', prestartS });
    assert.ok(S.race.clock <= -prestartS + 1e-9);
    const log = []; let t = 0;
    while (t < prestartS + 25) { t += DT; S.advanceTo(t); log.push(...S.drain()); }
    for (const b of S.rivals) {
      const st = log.find((e) => e.type === 'started' && e.id === b.id);
      assert.ok(st && st.delayS >= 0 && st.delayS < 15, `−${prestartS} s: ${b.name} started ${st?.delayS?.toFixed(1)} s after the gun`);
      assert.ok(!log.some((e) => e.type === 'ocs' && e.id === b.id && !e.early), `−${prestartS} s: ${b.name} not over at the gun`);
    }
  }
});
