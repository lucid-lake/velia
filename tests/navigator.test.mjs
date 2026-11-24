// Chill's skipper (src/modes/chill/navigator.js) sails the real BoatPhysics on the real wind field (Tahoe's day, the
// terrain's lee and channel) among the real traffic, headless, for 30 minutes of sim time per voyage, with the light
// running at Chill's pace (20 game s per sim s: 18:00 → 04:00 in 30 min). Asserts the safety rules at the hull's bow,
// middle and stern every tick: ≥ 3 m of water (the keel draws 1.6 m), ≥ 60 m off the shore and the island, ≥ 40 m from
// piers, moorings (their boats' swing circle), breakwaters and docks, ≥ 15 m from buoys, ≥ 50 m from moving boats;
// never in irons for over 30 s while there is a breeze (≥ 1.5 m/s); and progress round the loop.
// The strong-wind and steady-hour voyages are in tests/navigator-wind.test.mjs (they run in parallel with these).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyage, chillWorld } from '../src/modes/chill/sim.js';
import { navigatorVoyage } from './helpers/cases-chill.mjs';
import { scenicRoute, nightRoute, NAV, polarSpeed, findPath, checkRoute, DEST_SAY } from '../src/sim/modes/chill/navigator.js';

test('the polar: close-hauled slower than a reach, nothing inside 20°', () => {
  assert.ok(polarSpeed(44 * Math.PI / 180, 6) < polarSpeed(90 * Math.PI / 180, 6));
  assert.equal(polarSpeed(15 * Math.PI / 180, 6), 0);
  assert.ok(Math.abs(polarSpeed(90 * Math.PI / 180, 8) - 3.43) < 0.01);
});

test('the route: every stop in clear water, a loop that varies by seed and repeats for a seed', () => {
  const W = chillWorld({ seed: 1, hour: 16, rate: 0 });
  const orders = new Set();
  for (let seed = 1; seed <= 6; seed++) {
    const R = scenicRoute(W.chart, { seed });
    assert.equal(R.length, 7);
    for (const s of R) assert.ok(W.chart.marginAt(...s.at) >= 20, `seed ${seed} ${s.key} at ${s.at} margin ${W.chart.marginAt(...s.at).toFixed(0)}`);
    for (const s of nightRoute(W.chart, { seed })) assert.ok(W.chart.marginAt(...s.at) >= 20);
    assert.deepEqual(R, scenicRoute(W.chart, { seed }));
    orders.add(R.map((s) => s.key).join(','));
    // every leg has a path
    for (let i = 0; i < R.length; i++) assert.ok(findPath(W.chart, R[i].at, R[(i + 1) % R.length].at), `seed ${seed} leg ${i}`);
  }
  assert.ok(orders.size >= 4, `only ${orders.size} loop orders`);
});

test('deterministic: the same seed sails the same track', () => {
  const a = voyage({ seed: 2, hour: 16, rate: 0, minutes: 3 }), b = voyage({ seed: 2, hour: 16, rate: 0, minutes: 3 });
  assert.equal(a.state.x, b.state.x); assert.equal(a.state.z, b.state.z); assert.equal(a.state.heading, b.state.heading);
});

// e. the passage plan in Cruise: a route of three on the real bay is sailed waypoint by waypoint, each
// within 40 m and in order, then the scenic round resumes; a route through the sill is refused with the built line
test('e. setRoute: three waypoints reached in order within 40 m, then back to the scenic round; the sill refused', () => {
  const W = chillWorld({ seed: 1, hour: 16, rate: 0 });
  const pts = [[450, -250], [800, -650], [700, -350]];
  const ok = checkRoute(W.chart, pts, { from: [200, 200] });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const min = pts.map(() => Infinity), order = [];
  let set = false, last = null;
  voyage({ seed: 1, hour: 16, rate: 0, minutes: 14, world: W, onTick: (t, s, out, nav) => {
    if (!set) { set = true; nav.setRoute(pts.map((at) => ({ at }))); assert.equal(nav.dest.arriveM, NAV.routeArriveM); }
    pts.forEach((p, i) => { min[i] = Math.min(min[i], Math.hypot(s.x - p[0], s.z - p[1])); });
    if (nav.legReached) { order.push(nav.legReached.i); nav.legReached = null; }
    last = nav;
  } });
  assert.deepEqual(order, [0, 1, 2], `reached in order: ${order}`);
  for (const [i, m] of min.entries()) assert.ok(m < NAV.routeArriveM, `waypoint ${i + 1}: ${m.toFixed(0)} m`);
  assert.equal(last.dest, null, 'the route is done'); assert.equal(last.routePts, null);
  assert.ok(last.target.key !== 'dest' && last.route.includes(last.target), `back on the scenic round (${last.target.key})`);
  // one point is a destination, exactly as before
  last.setRoute([{ at: [450, -250] }]); assert.equal(last.dest.arriveM, NAV.destArriveM); assert.equal(last.routePts, null);
  const bad = checkRoute(W.chart, [[450, -250], [1500, -1800]], { from: [200, 200] });
  assert.equal(bad.ok, false); assert.equal(bad.index, 1); assert.equal(bad.say, DEST_SAY.route);
});

// the voyages (tests/helpers/cases-chill.mjs): one here (18:00 seed 1, golden hour into the night drainage); the other
// eight hours × seeds run in the slow lane (tests/slow/navigator.slow.mjs, npm run test:slow)
navigatorVoyage(18, 1);
