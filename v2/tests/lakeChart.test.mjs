// The planner's chart over the whole lake (v2/ui/planChart.js, tools/v2-plan-bake.mjs; BACKLOG "The planner's chart over the whole
// lake"): long routes across Lake Tahoe planned with no land and no shoal under them and a margin off the shore, in a few ms; the
// navigator's checks across the lake (open water taken, land refused as land, past the lake's box "off my chart", the bay's bar
// refused as no safe way); AUTO (v2/sim/autoNav.js) on the whole-lake chart sailing a cross-lake mark for minutes, nearer each
// minute, tacking toward one upwind; Cruise's voyage (v2/cruise/voyage.js) taking a chart target past the old bay chart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { OUT } from '../../tools/v2-plan-bake.mjs';
import { decodePlanGrid, planChart, LAKE } from '../ui/planChart.js';
import { LAKE_BOX } from '../ui/lakeBox.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createAutoNav } from '../sim/autoNav.js';
import { createCruiseVoyage } from '../cruise/voyage.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { findPath, checkDestination, NAV } from '../../src/sim/modes/chill/navigator.js';
import { START } from '../sim/boat.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { Helm } from '../../src/sim/boat.js';
import { pathAhead } from '../sim/autoNav.js';
import { KEEP_RIGHT_M } from '../sim/channelMarks.js';

const WORLD = JSON.parse(readFileSync(new URL('../cruise/chartWorld.json', import.meta.url), 'utf8'));
const chart = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(OUT)))), chartInputs(WORLD));
const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });

// Emerald Bay's mouth, on the open lake side of its bar (crossed by the carved channel: terrain/channel.js)
const MOUTH = [1900, -1900];
const SOUTH = [9000, 200];      // off the south shore, west of the harbour
const EAST = [12600, -12000];   // off the east shore
const NORTH = [4000, -31000];   // off the north shore, 29 km away
const len = (P) => P.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0), 0);
// every 10 m along a path: the least shore distance and the least depth under it
function along(P) {
  let shore = Infinity, depth = Infinity;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
    for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; shore = Math.min(shore, chart.shoreAt(x, z)); depth = Math.min(depth, chart.depthAt(x, z)); }
  }
  return { shore, depth };
}

test('the chart covers the whole lake: its box is the lake\'s, the bay keeps v1\'s 10 m level and the lake has 40 m nodes', () => {
  assert.deepEqual([chart.region.x0, chart.region.x1, chart.region.z0, chart.region.z1], [LAKE_BOX.x0, LAKE_BOX.x1, LAKE_BOX.z0, LAKE_BOX.z1]);
  assert.equal(chart.lake.cell, LAKE.cell); assert.equal(chart.bay.region.cell, 10);
  for (const p of [SOUTH, EAST, NORTH]) assert.ok(chart.marginAt(...p) > 0, `${p} is clear water on the chart`);
  assert.ok(chart.shoreAt(-900, 300) < 0 && chart.shoreAt(14500, -12000) < 0, 'the west and the east shores are land');
});

test('long routes from Emerald Bay\'s mouth to the south, east and north shores: no land, no shoal, a margin off the shore, fast', () => {
  for (const [name, to] of [['south', SOUTH], ['east', EAST], ['north', NORTH]]) {
    const t0 = performance.now(), P = findPath(chart, MOUTH, to), ms = performance.now() - t0;
    assert.ok(P && P.length >= 2, `${name}: a route`);
    assert.deepEqual(P[0], MOUTH); assert.deepEqual(P.at(-1), to);
    const A = along(P), L = len(P), D = Math.hypot(to[0] - MOUTH[0], to[1] - MOUTH[1]);
    assert.ok(A.shore >= NAV.hard.shore, `${name}: ${A.shore.toFixed(0)} m off the shore at the closest (≥ ${NAV.hard.shore})`);
    assert.ok(A.depth >= NAV.hard.depth, `${name}: ${A.depth.toFixed(1)} m of water at the shoalest (≥ ${NAV.hard.depth})`);
    assert.ok(L < 1.35 * D, `${name}: ${(L / 1000).toFixed(1)} km sailed for ${(D / 1000).toFixed(1)} km straight`);
    budget(ms, 250, `${name}: planned`);
  }
});

test('the navigator\'s checks across the lake: open water taken, land refused as land, past the lake\'s box off the chart, the bay\'s inside to the lake by the channel', () => {
  assert.equal(checkDestination(chart, ...EAST, { from: MOUTH }).ok, true, 'the east shore from the mouth');
  assert.equal(checkDestination(chart, ...NORTH, { from: EAST }).ok, true, 'the north shore from the east shore');
  assert.equal(checkDestination(chart, 14500, -12000, { from: MOUTH }).reason, 'land', 'the east shore\'s land is dry land, not off the chart');
  assert.equal(checkDestination(chart, 30000, -12000, { from: MOUTH }).reason, 'off', 'past the lake\'s box: off my chart');
  assert.equal(checkDestination(chart, ...EAST, { from: [600, -400] }).ok, true, 'inside the bay: through the channel');
  // inside the bay the plan is v1's own (its 20 m grid round the island)
  const P = findPath(chart, [300, -300], [900, -800]);
  assert.deepEqual(P, findPath(chart.bay, [300, -300], [900, -800]));
});

function boatAt([x, z], headingDeg = 60) {
  return createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: { x, z, headingDeg, speed: 2.5 } });
}
const run = (B, s, each) => { for (let i = 0; i < 60 * s; i++) { B.step(1 / 60, null, 1 / 60); each?.(B.phys.state); } };

test('AUTO on the whole-lake chart sails a cross-lake mark (the east shore, 14.7 km) from the bay\'s mouth: nearer each minute, in deep water', () => {
  const B = boatAt(MOUTH), A = createAutoNav({ B, chart });
  assert.deepEqual(A.engage({ x: EAST[0], z: EAST[1], name: 'East shore' }), { ok: true });
  let shoal = Infinity;
  const d = [A.distance()];
  for (let m = 0; m < 4; m++) { run(B, 60, (s) => { shoal = Math.min(shoal, -W.terrain.heightAt(s.x, s.z)); }); d.push(A.distance()); }
  assert.ok(A.on && B.driven, 'still sailing to it');
  for (let m = 1; m < d.length; m++) assert.ok(d[m] < d[m - 1] - 60, `minute ${m}: ${d[m - 1].toFixed(0)} → ${d[m].toFixed(0)} m`);
  assert.ok(shoal > 20, `the shoalest water under her ${shoal.toFixed(0)} m`);
});

test('the chart line (autoNav.line): null off; on, from her place through the planner\'s bends to the mark, never over land; it updates as she sails', () => {
  const B = boatAt(MOUTH), A = createAutoNav({ B, chart });
  assert.equal(A.line, null, 'off: no line');
  assert.equal(A.engage({ x: EAST[0], z: EAST[1], name: 'East shore' }).ok, true);
  const L0 = A.line;
  assert.ok(L0 && L0.length >= 2, 'on: a line');
  assert.ok(Math.hypot(L0[0][0] - B.state.x, L0[0][1] - B.state.z) < 1, 'it starts at her place');
  assert.ok(Math.hypot(L0.at(-1)[0] - A.dest.at[0], L0.at(-1)[1] - A.dest.at[1]) < 1, 'it ends at the mark');
  const dry = (L) => { let n = 0; runLine(L, 15, (x, z) => { if (!(-W.terrain.heightAt(x, z) > 0)) n++; }); return n; };
  assert.equal(dry(L0), 0, 'no point of it on land');
  run(B, 60);
  const L1 = A.line;
  assert.ok(Math.hypot(L1[0][0] - B.state.x, L1[0][1] - B.state.z) < 1 && L1[0][0] !== L0[0][0], 'it starts at her new place');
  assert.equal(dry(L1), 0, 'still no land a minute on');
  A.release();
  assert.equal(A.line, null, 'released: no line');
});

test('AUTO to a far mark upwind on the open lake beats: she tacks and makes ground to windward', () => {
  const B = boatAt([8000, -12000]);   // mid-lake (upwind of the mouth is the bay's own east shore)
  run(B, 2);
  const s = B.phys.state, from = s.heading + s.trueWind.angle;
  let tg = null;
  for (const dk of [4000, 3000, 5000]) for (const da of [0, 0.1, -0.1, 0.2, -0.2]) {
    if (tg) break;
    const x = s.x + Math.sin(from + da) * dk, z = s.z - Math.cos(from + da) * dk;
    if (checkDestination(chart, x, z, { from: [s.x, s.z] }).ok) tg = { x, z, name: 'Upwind' };
  }
  assert.ok(tg, 'a mark upwind in clear water');
  const A = createAutoNav({ B, chart });
  assert.equal(A.engage(tg).ok, true);
  const d0 = A.distance();
  run(B, 240);
  assert.ok(A.tacks >= 1, `tacks: ${A.tacks}`);
  assert.ok(A.distance() < d0 - 150, `four minutes beating: ${d0.toFixed(0)} → ${A.distance().toFixed(0)} m`);
});

test('Cruise on the whole-lake chart: a chart target past the old bay chart is taken and sailed to', () => {
  const B = boatAt(MOUTH);
  const V = createCruiseVoyage({ B, lake: W.terrain, wind: W.wind, seed: 1, chart, sun: () => 30 });
  V.place({ x: MOUTH[0], z: MOUTH[1], headingDeg: 60, speed: 2.5 }); V.attach();
  const old = chart.bay.region;
  assert.ok(SOUTH[0] > old.x1, 'the mark lies past the old chart');
  const r = checkDestination(V.chart, ...SOUTH, { from: [B.state.x, B.state.z] });   // Cruise's pickDestination's own check
  assert.equal(r.ok, true, r.say);
  V.nav.setDestination(r.at, { name: 'South shore' });
  const d0 = Math.hypot(SOUTH[0] - B.state.x, SOUTH[1] - B.state.z);
  run(B, 90);
  const d1 = Math.hypot(SOUTH[0] - B.state.x, SOUTH[1] - B.state.z);
  assert.equal(V.nav.target.name, 'South shore');
  assert.ok(d1 < d0 - 120, `90 s on: ${d0.toFixed(0)} → ${d1.toFixed(0)} m`);
});

// ---- the entrance channel (terrain/channel.js, carved by tools/terrain/carve_channel.mjs into the height grids) ----
const runLine = (P, step, f) => { for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k <= n; k++) f(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); } };

test('the channel in the bed: ≥ 3 m along its whole line and across its floor, smooth sides into the bar, the bar itself left as surveyed', () => {
  const h = W.terrain.heightAt;
  let floor = Infinity; runLine(CHANNEL.pts, 4, (x, z) => { floor = Math.min(floor, -h(x, z)); });
  assert.ok(floor >= 3, `the shallowest point on the line ${floor.toFixed(2)} m`);
  // across the bar's shallowest stretch: the floor, then a smooth climb (no step over 0.6 m in 3 m), the bar beyond as it was
  const [ax, az] = CHANNEL.pts[2], [bx, bz] = CHANNEL.pts[3], L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L, nz = (bx - ax) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
  let prev = null, step = 0;
  for (let o = -70; o <= 70; o += 3) { const d = -h(mx + nx * o, mz + nz * o); if (Math.abs(o) <= 15) assert.ok(d >= 3, `${o} m off the line: ${d.toFixed(2)} m`); if (prev != null) step = Math.max(step, Math.abs(d - prev)); prev = d; }
  assert.ok(step <= 0.9, `the steepest 3 m step across ${step.toFixed(2)} m (a 17° slope at most: no cliff)`);
  assert.ok(-h(mx + nx * 65, mz + nz * 65) < 1.6 && -h(mx - nx * 65, mz - nz * 65) < 1.6, 'the bar 65 m either side is the survey\'s (under the keel)');
});

// down the channel by hand (the helm on its line), from the bay's basin to the open lake
function throughChannel({ motor }) {
  const B = boatAt([1300, -950], 42), helm = new Helm({}), P = [...CHANNEL.pts, [1720, -1390]];
  if (motor) { B.phys.engine.start(); B.phys.engine.setLever(0.7); B.ctl.furl = 1; }
  B.drive((t, dt) => { const s = B.phys.state; let k = 0, bd = Infinity; P.forEach((p, i) => { const d = Math.hypot(p[0] - s.x, p[1] - s.z); if (d < bd) { bd = d; k = i; } }); const q = pathAhead([[s.x, s.z], ...P.slice(Math.min(k + 1, P.length - 1))], 40); B.ctl.rudder = helm.toHeading(s, Math.atan2(q[0] - s.x, -(q[1] - s.z)), Math.max(dt, 1e-3)); if (motor) B.ctl.throttle = null; }, { sea: true });
  let shoal = Infinity, under = Infinity, out = null, touched = false;
  for (let i = 0; i < 60 * 330 && out == null; i++) {
    B.step(1 / 60, null, 1 / 60); const s = B.phys.state;
    shoal = Math.min(shoal, -W.terrain.heightAt(s.x, s.z)); under = Math.min(under, B.ground.state.under); touched ||= B.ground.state.mode !== 'afloat';
    if (i % 60 === 0 && chart.channelSide([s.x, s.z]) === 'lake' && channelAt(s.x, s.z).along >= channelAt(...CHANNEL.pts.at(-1)).along) out = i / 60;
  }
  return { out, shoal, under, touched };
}
test('the boat motors out of the bay through the channel (sails down), never touching the bed', () => {
  const r = throughChannel({ motor: true });
  assert.ok(r.out > 60, `a real passage (${r.out} s)`);
  assert.ok(r.out != null && r.out < 300, `out in ${r.out?.toFixed(0)} s`); assert.ok(r.shoal >= 3, `the shoalest water ${r.shoal.toFixed(2)} m`);
  assert.ok(!r.touched && r.under > 0.5, `never touched (the keel's least clearance ${r.under.toFixed(2)} m)`);
});
test('the boat sails out of the bay through the channel in Cruise\'s evening breeze, never touching the bed', () => {
  const r = throughChannel({ motor: false });
  assert.ok(r.out != null && r.out < 320, `out in ${r.out?.toFixed(0)} s`); assert.ok(r.shoal >= 3, `the shoalest water ${r.shoal.toFixed(2)} m`);
  assert.ok(!r.touched && r.under > 0.5, `never touched (the keel's least clearance ${r.under.toFixed(2)} m)`);
});

test('the planner routes from inside the bay (Sail\'s start) to the south and east shores down the channel, ≥ 3 m all the way', () => {
  const mid = CHANNEL.pts[2], from = [START.x, START.z];
  for (const [name, to] of [['south', SOUTH], ['east', EAST]]) {
    const P = findPath(chart, from, to);
    assert.ok(P, `${name}: a route`);
    // channel markers (2026-11-18): laid KEEP_RIGHT_M to starboard of the line (outbound: the green side), so the course passes the
    // line's middle point that far off it
    assert.ok(P.some((p) => Math.abs(Math.hypot(p[0] - mid[0], p[1] - mid[1]) - KEEP_RIGHT_M) < 1 && Math.abs(channelAt(p[0], p[1]).d - KEEP_RIGHT_M) < 1), `${name}: down the channel, ${KEEP_RIGHT_M} m to starboard of its line`);
    let d = Infinity, s = Infinity; runLine(P, 5, (x, z) => { d = Math.min(d, -W.terrain.heightAt(x, z)); s = Math.min(s, -W.terrain.shoreDistance(x, z)); });
    assert.ok(d >= 3, `${name}: the shoalest water ${d.toFixed(2)} m`); assert.ok(s >= NAV.hard.shore, `${name}: ${s.toFixed(0)} m off the shore`);
    assert.equal(checkDestination(chart, ...to, { from }).ok, true);
  }
  assert.equal(chart.channelSide(from), 'bay'); assert.equal(chart.channelSide(EAST), 'lake');
});

test('AUTO from Sail\'s start to a far mark (the east shore, 15.8 km) leaves the bay down the channel, in ≥ 3 m', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: START }), A = createAutoNav({ B, chart });
  assert.deepEqual(A.engage({ x: EAST[0], z: EAST[1], name: 'East shore' }), { ok: true });
  let shoal = Infinity, out = null, laned = false;
  for (let i = 0; i < 60 * 420 && out == null; i++) {
    B.step(1 / 60, null, 1 / 60); const s = B.phys.state;
    shoal = Math.min(shoal, -W.terrain.heightAt(s.x, s.z)); laned ||= A.inChannel;
    if (i % 60 === 0 && chart.channelSide([s.x, s.z]) === 'lake' && channelAt(s.x, s.z).along >= channelAt(...CHANNEL.pts.at(-1)).along) out = i / 60;
  }
  assert.ok(out != null, 'out of the bay within 7 min'); assert.ok(laned, 'down the channel\'s line');
  assert.ok(shoal >= 3, `the shoalest water ${shoal.toFixed(2)} m`); assert.ok(A.on, 'still sailing to the mark');
});
