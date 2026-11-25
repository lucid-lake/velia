// Plan (v2/plan; phase 1): the mode row, the passage laid on the whole-lake chart (off land and shoal), the day clock locked to the sim
// at the player's rate, the auto-slow, the panel's fold, and the handover both ways keeping her heading, place and clock. No browser:
// v2's boat on v1's lake terrain and wind (the world Cruise's tests sail), the planner's chart from the shipped bake, the page's own
// frame loop in miniature (the clock advances at plan.speed(), plan.step, plan.update). The browser half: v2/tests/pages/plan.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { OUT } from '../../tools/v2-plan-bake.mjs';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createBoatSim, waterFor, START } from '../sim/boat.js';
import { createSimClock, sailSchedule } from '../engine/clock.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { modeRow, bootMode, playedIds } from '../engine/modes.js';
import { createPlan } from '../plan/index.js';
import { PLAN, PLAN_RATES, lockClock, stepCap, nextRate, rateWord, createRate, createAutoSlow, createFold, legsOf, pointWord, hm, debounce } from '../plan/plan.js';
import { mapBoatPx, MAP_BOAT, setMapBoat, mountMapBoat } from '../plan/mapBoat.js';

const WORLD = JSON.parse(readFileSync(new URL('../cruise/chartWorld.json', import.meta.url), 'utf8'));
const CHART = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(OUT)))), chartInputs(WORLD));
const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
const FROM = { x: 2300, z: -1400, headingDeg: 60, speed: 2.5 };   // the open lake off the bay's mouth
const CORNERS = [[2750, -1650], [3300, -1300], [3800, -1750]];

function world({ hour = 17.5, frozen = false } = {}) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: START });
  B.place(FROM);
  const clock = createSimClock({ step: 1 / 120, hour0: hour, maxSteps: 20, ...(frozen ? {} : { schedule: sailSchedule() }) });
  const caps = [];
  const p = createPlan({ B, windField: W.wind, clock, flags: {}, P: { speed: 2, seed: 1, headless: true }, chart: async () => CHART, sun: () => 30, live: false,
    setStepCap: (n) => { caps.push(n); clock.setMaxSteps(Math.max(20, n)); } });
  // the page's frame (main.js tick): the clock at the mode's speed, Plan's step or Sail's, then Plan's update
  const frame = (dt = 1 / 30) => { const n = clock.advance(dt * p.speed()); if (!p.step(n * clock.dt, dt)) B.step(n * clock.dt, null, dt); p.update(dt); };
  return { B, clock, p, frame, caps };
}
const along = (P) => {
  let shore = Infinity, depth = Infinity;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
    for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; shore = Math.min(shore, CHART.shoreAt(x, z)); depth = Math.min(depth, CHART.depthAt(x, z)); }
  }
  return { shore, depth };
};

test('the mode row: Plan is a row of the mode table with its own chunk, opened by ?mode=plan, not the default and not on the home card', () => {
  const r = modeRow('plan');
  assert.ok(r && typeof r.chunk === 'function' && typeof r.enter === 'function' && typeof r.leave === 'function');
  assert.equal(r.label, 'Plan'); assert.equal(r.clock, 'own'); assert.equal(r.race, undefined); assert.equal(r.needsBoat, true);
  assert.ok(playedIds().includes('plan'));
  assert.equal(bootMode({ mode: 'plan' }), 'plan'); assert.equal(bootMode({}), 'sail', 'Plan is a mode, not the default');
  assert.equal(r.order, undefined, 'no pill on the home card yet');
});

test('a passage avoids land and shoal: corners on land refused in the navigator\'s words, every leg on the planner\'s path off the shore and over deep water', async () => {
  const { p } = world();
  await p.ready;
  const land = p.addCorner(0, -1500);
  assert.equal(land.ok, false); assert.match(land.say, /land|shore|chart|way/i);
  for (const c of CORNERS) assert.ok(p.addCorner(...c).ok, `${c} is open water`);
  p.relegs();
  assert.equal(p.legs.length, 3);
  for (const L of p.legs) {
    const a = along(L.path);
    assert.ok(a.shore > 60 && a.depth >= 6, `leg ${L.i}: ${a.shore.toFixed(0)} m off the shore, ${a.depth.toFixed(1)} m under it`);
    assert.ok(L.nm > 0 && L.kn > 1 && L.course >= 0 && L.course < 360 && ['beat', 'close reach', 'reach', 'broad reach', 'run'].includes(L.word));
  }
  // a route round the land into the bay: the planner carries it through the channel, never over the bar or the shore
  const into = legsOf([FROM.x, FROM.z], [[1000, -500]], { route: (a, b) => CHART.route(a, b) })[0];
  const a = along(into.path);
  assert.ok(into.path.length > 2 && a.shore > 0 && a.depth >= 2.6, `into the bay: ${into.path.length} points, ${a.shore.toFixed(0)} m off, ${a.depth.toFixed(1)} m deep`);
  assert.ok(into.m > Math.hypot(FROM.x - 1000, FROM.z + 500), 'longer than the straight line over the land');
});

test('the clock: locked to the sim in Plan (1 game s per sim s), the rates ‖ ×1 ×4 ×16 ×60 run the sim, Sail\'s clock again on leaving; a frozen clock stays frozen', async () => {
  assert.deepEqual([...PLAN_RATES], [0, 1, 4, 16, 60]);
  assert.deepEqual(PLAN_RATES.map(nextRate), [1, 4, 16, 60, 0]); assert.equal(rateWord(0), '‖'); assert.equal(rateWord(16), '×16');
  const { p, clock, frame, B } = world();
  const sailRate = clock.rate;
  assert.ok(sailRate > 1, `Sail's day runs faster than the sim (${sailRate})`);
  await p.enter();
  assert.equal(clock.rate, 1, 'locked'); assert.equal(p.speed(), 1);
  for (const r of PLAN_RATES) { p.setRate(r); assert.equal(p.speed(), r, `${rateWord(r)}: what was pressed runs`); }
  p.setRate(16);
  const h0 = clock.hourUnwrapped, t0 = clock.t;
  for (let i = 0; i < 30; i++) frame(1 / 30);
  assert.ok(Math.abs(clock.t - t0 - 16) < 0.05, `×16: 1 real s is 16 sim s (${(clock.t - t0).toFixed(3)})`);
  assert.ok(Math.abs((clock.hourUnwrapped - h0) * 3600 - (clock.t - t0)) < 1e-6, 'and 16 game s: one clock');
  assert.ok(clock.maxSteps >= stepCap(16), `the step cap rises with the rate (${clock.maxSteps})`);
  p.setRate(0); const t1 = clock.t, x1 = B.state.x; frame(); frame();
  assert.equal(clock.t, t1, '‖ holds the clock'); assert.equal(B.state.x, x1, 'and the boat');
  p.leave();
  assert.ok(Math.abs(clock.rate - sailRate) < 1e-9, 'Sail\'s day clock again'); assert.equal(p.speed(), 2, 'Sail\'s game speed');
  const fz = world({ frozen: true });
  assert.equal(lockClock(fz.clock, {}), false, 'a frozen clock (every capture and golden) is never locked');
  assert.equal(lockClock(world().clock, { timerate: '0' }), false, '?timerate holds');
  const R = createRate({ rate: 60 }); R.set(1, { ease: true });
  const seen = []; for (let i = 0; i < 40; i++) seen.push(R.step(1 / 30));
  assert.ok(seen[0] < 60 && seen[0] > 50 && seen[14] > 1 && seen[14] < 60 && seen.at(-1) === 1, 'the ease runs over about 1 s, never a cut from ×60');
});

test('the auto-slow: a corner ahead, the arrival, a shift over 20°, a gust lane, Tessie within 300 m, the golden hour; each once; only above ×1', () => {
  const A = createAutoSlow(), q = (o) => ({ rate: 16, sog: 3, gustAhead: 1, tessieM: null, sunElev: 30, t: 0, ...o });
  assert.equal(A.step(q({ windDir: 200 })), null, 'the first reading is the reference');
  assert.equal(A.step(q({ corner: { i: 0, dist: 2000, last: false } })), null);
  assert.equal(A.step(q({ corner: { i: 0, dist: 150, last: false } })), 'corner', 'within 3 real s at ×16 plus 60 m (204 m)');
  assert.equal(A.step(q({ corner: { i: 0, dist: 100, last: false } })), null, 'once per corner');
  assert.equal(A.step(q({ corner: { i: 2, dist: 100, last: true } })), 'arrival');
  assert.equal(A.step(q({ windDir: 215 })), null); assert.equal(A.step(q({ windDir: 225 })), 'shift', '25° off the reference');
  assert.equal(A.step(q({ windDir: 230 })), null, 'the reference moved with it');
  assert.equal(A.step(q({ gustAhead: 1.2 })), null, 'an ordinary gust is not a lane'); assert.equal(A.step(q({ gustAhead: 1.26 })), 'gust'); assert.equal(A.step(q({ gustAhead: 1.27 })), null, 'one lane once');
  A.step(q({ gustAhead: 1.0 })); assert.equal(A.step(q({ gustAhead: 1.26, t: 300 })), null, 'not within 10 game minutes');
  A.step(q({ gustAhead: 1.0 })); assert.equal(A.step(q({ gustAhead: 1.26, t: 700 })), 'gust', 'a new lane after it cleared');
  assert.equal(A.step(q({ tessieM: 500 })), null); assert.equal(A.step(q({ tessieM: 280 })), 'tessie'); assert.equal(A.step(q({ tessieM: 250 })), null);
  assert.equal(A.step(q({ sunElev: 10.5 })), null); assert.equal(A.step(q({ sunElev: 9.8 })), 'golden'); assert.equal(A.step(q({ sunElev: 9 })), null);
  const B = createAutoSlow();
  assert.equal(B.step(q({ rate: 1, corner: { i: 0, dist: 50, last: false } })), null, 'at ×1 nothing to slow');
  assert.equal(B.step(q({ rate: 16, corner: { i: 0, dist: 40, last: false } })), null, 'and the corner seen at ×1 does not fire later');
});

test('the run: a 3-corner passage at ×16 slows itself to ×1 at the first corner; the pilot sails the legs in order', async () => {
  const { p, frame, B } = world();
  await p.enter();
  for (const c of CORNERS) p.addCorner(...c);
  p.relegs();
  p.setRate(16);
  let slowed = null;
  for (let i = 0; i < 30 * 120 && !slowed; i++) { frame(); if (p.lastSlow) slowed = { ...p.lastSlow, d: Math.hypot(B.state.x - CORNERS[0][0], B.state.z - CORNERS[0][1]), leg: p.leg }; }
  assert.ok(slowed, 'it slowed'); assert.equal(slowed.why, 'corner');
  assert.ok(slowed.d < 300, `near corner 1 (${slowed.d.toFixed(0)} m)`); assert.equal(slowed.leg, 0);
  for (let i = 0; i < 45; i++) frame();
  assert.equal(p.rate.rate, 1, 'eased to ×1'); assert.equal(p.rate.target, 1);
  for (let i = 0; i < 30 * 240 && p.leg < 1; i++) frame();
  assert.equal(p.leg, 1, 'corner 1 reached: leg 2');
});

test('the fold: the panel folds to the rail 6 s after the last press, never while the pointer is in it, never with no passage', () => {
  const F = createFold();
  for (let i = 0; i < 59; i++) F.step(0.1); assert.equal(F.open, true);
  F.step(0.2); assert.equal(F.open, false, 'folded after 6 s');
  F.set(true); for (let i = 0; i < 100; i++) F.step(0.1, { inside: true }); assert.equal(F.open, true, 'the pointer inside holds it');
  for (let i = 0; i < 100; i++) F.step(0.1, { passage: false }); assert.equal(F.open, true, 'no passage: the panel stays to lay one');
  for (let i = 0; i < 40; i++) F.step(0.1); F.press(); for (let i = 0; i < 40; i++) F.step(0.1); assert.equal(F.open, true, 'a press starts the 6 s again');
});

test('the handover both ways keeps her heading, place and clock: Take the helm detaches the pilot where she is, the chart gives her back', async () => {
  const { p, frame, B, clock } = world();
  await p.enter();
  for (const c of CORNERS) p.addCorner(...c);
  p.setRate(4);
  for (let i = 0; i < 90; i++) frame();
  const before = { h: B.state.heading, x: B.state.x, z: B.state.z, t: clock.t, hour: clock.hourUnwrapped, rate: clock.rate };
  assert.ok(p.attached);
  p.takeHelm({ now: true });
  assert.equal(p.helm, 'player'); assert.equal(p.attached, false, 'Sail\'s hands');
  assert.deepEqual({ h: B.state.heading, x: B.state.x, z: B.state.z, t: clock.t, hour: clock.hourUnwrapped, rate: clock.rate }, before, 'no jump of heading, place or clock');
  assert.equal(p.rate.target, 1, 'the rate eases to ×1');
  assert.equal(p.step(0.1, 0.1), false, 'the page steps Sail\'s boat now');
  for (let i = 0; i < 30; i++) frame();
  assert.equal(clock.rate, 1, 'the lock holds at the helm');
  const back = { h: B.state.heading, x: B.state.x, z: B.state.z, t: clock.t };
  p.toChart();
  assert.equal(p.helm, 'pilot'); assert.equal(p.attached, true, 'the pilot has her again');
  assert.deepEqual({ h: B.state.heading, x: B.state.x, z: B.state.z, t: clock.t }, back, 'from where she is');
  assert.equal(p.leg, 0, 'the passage where she left it');
});

test('the legs\' words and times; the map boat\'s size by zoom and its one replaceable drawing; the re-route debounce', () => {
  assert.equal(pointWord(30), 'beat'); assert.equal(pointWord(60), 'close reach'); assert.equal(pointWord(95), 'reach'); assert.equal(pointWord(130), 'broad reach'); assert.equal(pointWord(170), 'run');
  assert.equal(hm(18.4667), '18:28'); assert.equal(hm(24.5), '00:30');
  const L = legsOf([0, 0], [[0, -1852], [1852, -1852]], { windAt: () => ({ speed: 5, dirDeg: 0 }) });
  assert.equal(L[0].word, 'beat'); assert.ok(L[0].beat); assert.equal(L[1].word, 'reach');
  assert.ok(Math.abs(L[0].nm - 1) < 1e-9 && Math.abs(L[1].t0 - L[0].hrs) < 1e-12 && L[1].t1 > L[1].t0);
  assert.equal(mapBoatPx(0.01), MAP_BOAT.minPx); assert.equal(mapBoatPx(5), MAP_BOAT.maxPx); assert.ok(MAP_BOAT.minPx === 70 && MAP_BOAT.maxPx === 130);
  let made = null; setMapBoat((o) => (made = o, { el: null, place() {}, update() {}, destroy() {} }));
  mountMapBoat({ root: 'r', state: () => null }); assert.equal(made.root, 'r', 'the Coach replaces the drawing in one place'); setMapBoat(null);
  const calls = [], timers = []; const d = debounce((v) => calls.push(v), PLAN.debounceMs, { set: (f, ms) => (timers.push({ f, ms }), timers.length), clear: (id) => { timers[id - 1].f = null; } });
  d(1); d(2); d(3); timers.forEach((t) => t.f?.());
  assert.deepEqual(calls, [3]); assert.equal(timers[0].ms, 120);
});
