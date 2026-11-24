// The glass boat (owner, 2026-11-18; v2/sim/tourBoat.js, v2/render/tourBoatMesh.js, src/core/features.js glassBoat):
// her route clear of the channel, the starts, the moorings, the boats at anchor and the Regatta courses, in good water; her timetable
// and the stops' lengths; the natural schedule (the clock and the seed place her, deterministic); she yields to the player and is
// bumped softly; the kayaks (the paddlers cast off, roam near her, tie on before she leaves; never inside her hull); her nav lights;
// the meshes' sizes; the device policy (a desktop or a tablet, full or lite by the GPU level; never a phone). Behaviour only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createTourBoat, routeLoop, pointAt, tourTimetable, tourPhase, yieldTo, segAt, TOUR, TOUR_ROUTE, TOUR_LANE_M, KAYAKS } from '../sim/tourBoat.js';
import { buildPontoon, buildPontoonGlass, buildKayakShell, buildKayakFrame, buildTourMeshes, PONTOON, CLEAR_KAYAK, VF, SLOT } from '../render/tourBoatMesh.js';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { resolveMoorings } from '../sim/moorings.js';
import { createAnchoredBoats, ANCHORED_BOATS } from '../sim/anchoredBoats.js';
import { createMarkBodies } from '../sim/channelMarks.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { courseFor, courseIds } from '../../src/sim/race/course.js';
import { racePoints } from '../regatta/geometry.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { GLOW_FLOATS } from '../sim/night.js';
import { sources, createVesselWake, VESSEL } from '../render/vesselWake.js';
import { createWakeFx } from '../render/wake.js';
import { createPipelineRegistry } from '../engine/pipelines.js';
import { birthplaceRows } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)
const MOORINGS = JSON.parse(readFileSync(resolve(ROOT, 'v2/sim/moorings.json'), 'utf8'));
let chartC = null;
const chart = () => (chartC ??= planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8')))));
const depthAt = (x, z) => chart().depthAt(x, z);
const K = TOUR.clear;
const CHANNEL_LEN = channelAt(CHANNEL.pts.at(-1)[0], CHANNEL.pts.at(-1)[1], CHANNEL).length;
const DT = 1 / 30;

// ---- the route ----
test('her route: through the entrance channel only on its starboard lane (between the buoys), clear of every start, the moorings and the boats at anchor; her stops off the Regatta courses; in good water off the shore', () => {
  const loop = routeLoop();
  const starts = [...BIRTHPLACES.map((r) => ({ id: r.id, x: r.x, z: r.z })), { id: 'start', x: WATERS.start.x, z: WATERS.start.z }];
  const courses = courseIds('tahoe-emerald').map((id) => { const c = courseFor('tahoe-emerald', id), up = [Math.sin(c.designWindFrom * Math.PI / 180), -Math.cos(c.designWindFrom * Math.PI / 180)]; return { id, pts: racePoints(c.lineSpec, c.marks.map((m) => ({ id: m.id, at: m.at })), c.legSpec.map((l) => l.to), up) }; });
  const moor = resolveMoorings(MOORINGS);
  const anch = createAnchoredBoats(ANCHORED_BOATS, { depthAt, balls: createMarkBodies(moor).bodies }).boats;
  const half = TOUR.length / 2;
  // every 4 m of the loop (her hull's half length and her kayaks' tow astern counted as a 20 m reach)
  for (let s = 0; s < loop.length; s += 4) {
    const p = pointAt(loop, s), reach = 20, ch = channelAt(p.x, p.z, CHANNEL);
    // the open lake (owner, 2026-11-19): in and out through the channel, on its starboard side (red right returning), never on its
    // centre line and never out by the buoys (24 m off the line); elsewhere clear of it
    if (ch.d <= CHANNEL.coreHalfM + 2 && ch.along > 20 && ch.along < ch.length - 20) {   // in the trough itself
      assert.ok(ch.d >= TOUR_LANE_M - 2 && ch.d <= 12, `in the channel at s ${s}: ${ch.d.toFixed(1)} m off its line`);
      const P = CHANNEL.pts; let k = 1, kd = Infinity;   // the channel segment nearest her
      for (let j = 1; j < P.length; j++) { const ax = P[j - 1][0], az = P[j - 1][1], bx = P[j][0] - ax, bz = P[j][1] - az, u = Math.max(0, Math.min(1, ((p.x - ax) * bx + (p.z - az) * bz) / (bx * bx + bz * bz))), dd = Math.hypot(p.x - ax - bx * u, p.z - az - bz * u); if (dd < kd) { kd = dd; k = j; } }
      const lx = P[k][0] - P[k - 1][0], lz = P[k][1] - P[k - 1][1], right = (p.x - P[k - 1][0]) * -lz + (p.z - P[k - 1][1]) * lx;   // + : right of the line going out
      const out = p.dx * lx + p.dz * lz > 0;
      assert.ok(out ? right > 0 : right < 0, `the channel at s ${s}: on her starboard side going ${out ? 'out' : 'in'}`);
    }
    for (const st of starts) assert.ok(Math.hypot(st.x - p.x, st.z - p.z) - reach >= K.startLegM, `${st.id} start: ${(Math.hypot(st.x - p.x, st.z - p.z) - reach).toFixed(0)} m at s ${s}`);
    // (the Regatta courses' legs: she crosses the bay on her way out and in; in a race she stands down, so only her stops keep off them)
    for (const m of moor) assert.ok(Math.hypot(m.x - p.x, m.z - p.z) >= K.mooringM, `${m.id} at s ${s}`);
    for (const b of anch) assert.ok(Math.hypot(b.ax - p.x, b.az - p.z) - b.r - half >= K.anchoredM, `${b.id}: ${(Math.hypot(b.ax - p.x, b.az - p.z) - b.r - half).toFixed(0)} m at s ${s}`);
    // her hull's corners in water deeper than depthM, and off the shore
    for (const [f, sd] of [[half, 0], [-half, 2], [-half, -2], [0, 2.5], [0, -2.5]]) {
      const x = p.x + p.dx * f - p.dz * sd, z = p.z + p.dz * f + p.dx * sd;
      assert.ok(depthAt(x, z) >= K.depthM, `${depthAt(x, z).toFixed(1)} m under her at s ${s}`);
    }
    if (ch.d > 40) assert.ok(chart().shoreAt(p.x, p.z) >= K.shoreM, `${chart().shoreAt(p.x, p.z).toFixed(0)} m off the shore at s ${s}`);
  }
  // the stops: over clear shallows (2.5–7 m: the bed seen), the start further off (her kayakers' ring still clear of a start's lane)
  assert.deepEqual(loop.stops.map((s) => s.id), ['head', 'fannette']);
  for (const st of loop.stops) {
    const d = depthAt(st.at[0], st.at[1]);
    assert.ok(d >= 2.5 && d <= 7, `${st.id}: ${d.toFixed(1)} m (clear shallows)`);
    for (const s2 of starts) {
      const dd = Math.hypot(s2.x - st.at[0], s2.z - st.at[1]);
      assert.ok(dd >= K.startStopM, `${st.id} stop ${dd.toFixed(0)} m from the ${s2.id} start`);
      assert.ok(dd - TOUR.kayak.roam[1] >= K.startLegM, `${st.id}: the paddlers' ring ${(dd - TOUR.kayak.roam[1]).toFixed(0)} m from the ${s2.id} start`);
    }
    for (const c of courses) for (const q of c.pts) assert.ok(Math.hypot(q[0] - st.at[0], q[1] - st.at[1]) >= K.courseStopM, `${st.id} stop from ${c.id}`);
  }
  // the paddlers' ring at each stop holds water too (most of it: the goals are picked only where depthM + 0.5 is)
  for (const st of loop.stops) {
    let wet = 0, n = 0;
    for (let a = 0; a < 360; a += 15) for (const r of TOUR.kayak.roam) { n++; if (depthAt(st.at[0] + Math.sin(a * Math.PI / 180) * r, st.at[1] - Math.cos(a * Math.PI / 180) * r) >= K.depthM + 0.5) wet++; }
    assert.ok(wet / n >= 0.5, `${st.id}: ${wet} of ${n} ring points wet`);
  }
});

// ---- the timetable and the natural schedule ----
test('her timetable: two stops of 3–5 minutes, 4 kn in the bay (never over 4.3 kn there, the channel included) and fastKn on the open lake; a sailed loop keeps to it, eased', () => {
  const tt = tourTimetable();
  for (const r of tt.rows) assert.ok(r.stopS >= 180 && r.stopS <= 300, `${r.stop}: ${r.stopS} s`);
  assert.ok(Math.abs(tt.speedMs - 4 * KN) < 1e-9);
  const T = createTourBoat({ depthAt, tauS: 0 });   // at the head of the bay's stop, its start
  let t = 0, prevMode = T.boat.mode, stopT0 = 0, vmax = 0, amax = 0, vPrev = 0, vBay = 0;
  const stops = [];
  for (let i = 0; i < Math.round(1.25 * tt.period / DT); i++) {
    t += DT; T.post(null, DT, t, () => 240);
    vmax = Math.max(vmax, T.boat.v); if (!segAt(T.loop, T.boat.s).fast && channelAt(T.boat.x, T.boat.z, CHANNEL).along < CHANNEL_LEN - 5) vBay = Math.max(vBay, T.boat.v); amax = Math.max(amax, Math.abs(T.boat.v - vPrev) / DT); vPrev = T.boat.v;
    if (T.boat.mode !== prevMode) { if (prevMode === 'stop') stops.push({ id: stops.length ? T.loop.stops[(stops.length) % 2].id : 'head', s: t - stopT0 }); else stopT0 = t; prevMode = T.boat.mode; }
  }
  assert.ok(vBay <= 4.3 * KN + 1e-6, `top speed in the bay ${(vBay / KN).toFixed(2)} kn`);
  assert.ok(vmax > 9 * KN && vmax <= TOUR.fastKn * KN + 1e-6, `top speed on the open lake ${(vmax / KN).toFixed(2)} kn`);
  assert.ok(amax <= TOUR.decel * 2.5 + 0.01, `the hardest change ${amax.toFixed(3)} m/s²`);
  assert.ok(T.stats.stops >= 2, `${T.stats.stops} stops in 1.25 loops`);
  // each full stop: its time, plus the paddlers' return and the lines in (≤ 90 s more)
  for (const s of stops.slice(1)) assert.ok(s.s >= 270 - 1 && s.s <= 270 + 90, `a stop of ${s.s.toFixed(0)} s`);
  assert.ok(T.stats.castOff >= 3 && T.stats.tiedOn >= 3, JSON.stringify(T.stats));
});

test('the natural schedule: the hour and the seed place her (deterministic), often at a stop, never framed for a start', () => {
  const a = tourPhase(13, 1), b = tourPhase(13, 1), c = tourPhase(13, 2);
  assert.deepEqual(a, b);
  assert.notEqual(a.tau, c.tau, 'another seed, another place');
  let atStop = 0, n = 0;
  for (let h = 6; h < 22; h += 0.05) { n++; if (tourPhase(h, 1).mode === 'stop') atStop++; }
  const share = atStop / n, tt = tourTimetable(), want = tt.rows.reduce((s, r) => s + r.stopS, 0) / tt.period;
  assert.ok(Math.abs(share - want) < 0.06, `at a stop ${(share * 100).toFixed(0)} % of the day (timetable ${(want * 100).toFixed(0)} %)`);
  // the sim starts where the phase says, the same twice
  const T1 = createTourBoat({ depthAt, hour: 15.3, seed: 4 }), T2 = createTourBoat({ depthAt, hour: 15.3, seed: 4 });
  for (let i = 0; i < 600; i++) { T1.post(null, DT, i * DT, () => 200); T2.post(null, DT, i * DT, () => 200); }
  assert.deepEqual([T1.boat.x, T1.boat.z, T1.kayaks.map((k) => [k.x, k.z])], [T2.boat.x, T2.boat.z, T2.kayaks.map((k) => [k.x, k.z])]);
  const ph = tourPhase(15.3, 4);
  if (ph.mode === 'run') { const p = pointAt(T1.loop, ph.s); assert.ok(Math.hypot(createTourBoat({ depthAt, hour: 15.3, seed: 4 }).boat.x - p.x, createTourBoat({ depthAt, hour: 15.3, seed: 4 }).boat.z - p.z) < 1); }
});

// ---- the yield and the bump ----
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => steadyWind(ms, fromDeg)(x, z, t) });
test('she yields: a player on her route ahead slows and bends her away (never within her stop distance), and she gets past; abeam or astern she holds on', () => {
  // the run out from the head of the bay: the player sits on her line 110 m ahead
  const T = createTourBoat({ depthAt, tauS: 270 + 30 });
  const loop = T.loop, sP = T.boat.s + 110, p = pointAt(loop, sP), S = { x: p.x, z: p.z, heading: 0 };
  let minD = Infinity, slowed = false, t = 0;
  for (let i = 0; i < Math.round(240 / DT); i++) { t += DT; T.post(S, DT, t, () => 240); minD = Math.min(minD, Math.hypot(T.boat.x - S.x, T.boat.z - S.z)); if (T.boat.v < 1.0 && T.boat.yielding) slowed = true; }
  assert.ok(slowed, 'she slowed for the player');
  assert.ok(minD >= TOUR.yield.stopM - 3, `closest ${minD.toFixed(1)} m`);
  assert.ok(T.stats.yields >= 1);
  assert.ok(T.boat.mode === 'stop' || T.boat.s > sP + 40, `she got past the player (s ${T.boat.s.toFixed(0)} vs ${sP.toFixed(0)}, ${T.boat.mode})`);
  // the read itself: ahead slows; abeam at 40 m or astern holds
  const boat = { x: 0, z: 0, heading: 0 };
  assert.ok(yieldTo(boat, { x: 0, z: -30 }).slow < 1, 'ahead');
  assert.equal(yieldTo(boat, { x: 40, z: 0 }).slow, 1, 'abeam at 40 m');
  assert.equal(yieldTo(boat, { x: 0, z: 40 }).slow, 1, 'astern');
  assert.equal(yieldTo(boat, { x: 0, z: -12 }).slow, 0, 'close ahead: stopped');
  assert.equal(yieldTo(boat, { x: 15, z: -30 }).side, 1, 'the player to starboard');
});

test('the bump: the player\'s boat driven into her at 1.5 m/s bumps softly (an impulse both ways); she gives a little and comes back', () => {
  const flat = waterFor(() => 0);
  const T = createTourBoat({ depthAt, tauS: 600 });   // at the Fannette stop
  const b = T.boat, hd = b.heading + Math.PI / 2;   // the player comes at her beam
  const sim = createBoatSim({ water: flat, heightAt: () => -10, wind: steady(0.02 * KN, 0), start: { x: b.x - Math.sin(hd) * 14, z: b.z + Math.cos(hd) * 14, headingDeg: hd * 180 / Math.PI, speed: 1.5 } });
  let t = 0, maxOff = 0;
  for (let i = 0; i < 60 * 12; i++) { t += 1 / 60; sim.step(1 / 60, { steer: 0, pull: 0 }); T.post(sim.phys.state, 1 / 60, t, () => 240); maxOff = Math.max(maxOff, Math.hypot(b.ox, b.oz)); }
  assert.ok(T.bumps >= 1, 'a bump');
  assert.ok(maxOff > 0.02 && maxOff <= TOUR.rode.maxOff + 1e-6, `she gives ${maxOff.toFixed(2)} m`);
  assert.ok(sim.phys.state.u < 1.2, `the player slowed (${sim.phys.state.u.toFixed(2)} m/s)`);
});

// ---- the kayaks ----
test('the kayaks: two empty, three crewed (one a tandem); at a stop the paddlers roam near her and tie on before she leaves; none inside her hull; towed astern underway', () => {
  assert.deepEqual(KAYAKS.map((k) => k.crew), [0, 0, 2, 1, 1]);
  const T = createTourBoat({ depthAt, tauS: 502 + 5 });   // just arrived at Fannette
  let t = 0, maxRoam = 0, inside = 0, emptyFar = 0, roamed = false;
  const hl = TOUR.length / 2, hw = TOUR.beam / 2;
  for (let i = 0; i < Math.round(420 / DT); i++) {
    t += DT; T.post(null, DT, t, () => 240);
    const b = T.boat, fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
    for (const k of T.kayaks) {
      const dx = k.x - b.x, dz = k.z - b.z, f = dx * fx + dz * fz, s = dx * -fz + dz * fx;
      if (Math.abs(f) < hl - 0.2 && Math.abs(s) < hw - 0.2) inside++;
      if (k.free) { roamed = true; maxRoam = Math.max(maxRoam, Math.hypot(dx, dz)); }
      if (!k.crew && b.mode === 'stop' && T.spread > 0.99 && Math.hypot(dx, dz) > 6) emptyFar++;
    }
  }
  assert.ok(roamed, 'the paddlers cast off');
  assert.ok(maxRoam <= TOUR.kayak.roam[1] + 12, `the farthest ${maxRoam.toFixed(0)} m from her`);
  assert.equal(inside, 0, 'never inside her hull');
  assert.equal(emptyFar, 0, 'the empty ones lie alongside');
  assert.equal(T.boat.mode, 'run', 'she has left');
  assert.ok(T.kayaks.every((k) => !k.free), 'every paddler tied on before she left');
  // underway: every kayak astern of her middle
  for (let i = 0; i < Math.round(30 / DT); i++) { t += DT; T.post(null, DT, t, () => 240); }
  const b = T.boat, fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
  for (const k of T.kayaks) assert.ok((k.x - b.x) * fx + (k.z - b.z) * fz < -TOUR.length / 2, `kayak ${k.i} astern`);
});

test('her nav lights: none by day; at night the all-round white and the sidelights, red seen only from port, green only from starboard', () => {
  const T = createTourBoat({ depthAt, tauS: 600 }), out = new Float32Array(8 * GLOW_FLOATS);
  assert.equal(T.lights(out, 0, { sunElevDeg: 30 }), 0);
  const b = T.boat, fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
  const port = [b.x + fz * 50, 2, b.z - fx * 50], stbd = [b.x - fz * 50, 2, b.z + fx * 50];
  assert.equal(T.lights(out, 0, { sunElevDeg: -15, eye: port }), 3);
  assert.ok(out[7] > 0 && out[15] > 0 && out[23] === 0, 'from port: white and red');
  T.lights(out, 0, { sunElevDeg: -15, eye: stbd });
  assert.ok(out[7] > 0 && out[15] === 0 && out[23] > 0, 'from starboard: white and green');
  T.active = false; assert.equal(T.lights(out, 0, { sunElevDeg: -15 }), 0, 'a race: none');
});

// ---- the meshes ----
const bbox = (a) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < a.length; i += VF) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); } return { lo, hi }; };
test('the meshes: the pontoon at her real size (the 40 ft class: 12.2 m × 3.8 m, the roof 2.8 m over the water; its name in 0.28 m letters), the glass panel in the deck, the clear kayak 3.4 m with its seats under the paddler', () => {
  for (const lod of ['high', 'low']) {
    const m = buildPontoon({ lod }), b = bbox(m);
    assert.ok(b.hi[2] - b.lo[2] <= PONTOON.length + 0.1 && b.hi[2] - b.lo[2] >= PONTOON.length - 0.6, `${lod}: ${(b.hi[2] - b.lo[2]).toFixed(2)} m long`);
    assert.ok(b.hi[0] - b.lo[0] <= PONTOON.beam + 0.45, `${lod}: ${(b.hi[0] - b.lo[0]).toFixed(2)} m wide (the roof's overhang, the fenders)`);
    assert.ok(m.length / VF / 3 <= (lod === 'high' ? 6000 : 700), `${lod}: ${m.length / VF / 3} triangles`);
    for (let i = 0; i < m.length; i++) assert.ok(Number.isFinite(m[i]));
  }
  assert.equal(PONTOON.length, 12.2); assert.equal(PONTOON.beam, 3.8);
  assert.ok(Math.abs(PONTOON.roofY - 2.8) < 0.01 && PONTOON.roofY - PONTOON.deckY >= 2.1 && PONTOON.roofY - PONTOON.deckY <= 2.3, 'a standing roof 2.8 m over the water (about 2.2 m over the deck)');
  assert.ok(PONTOON.text.h >= 0.28 && PONTOON.text.h <= 0.32, 'the name not stretched');
  { const m = buildPontoon(); let top = 0; for (let i = 1; i < m.length; i += VF) top = Math.max(top, m[i]); assert.ok(top > 2.8 && top < 4, `the mesh tops out at ${top.toFixed(2)} m (the roof, the all-round light)`); }
  assert.ok(PONTOON.postR <= 0.03 && PONTOON.railR <= 0.02 && PONTOON.roofT <= 0.08, 'thin members: 2 in posts, 1.5 in rails, a thin roof (detail round 2)');
  const g = buildPontoonGlass(), slots = new Set(); for (let i = 6; i < g.length; i += VF) slots.add(g[i]);
  assert.ok(slots.has(SLOT.floor) && slots.has(SLOT.window), 'the panel and the windows');
  // the lettering fits her band: 12 letters at the advance, a cap 7 units tall
  const w = (11 * PONTOON.text.adv + 4) * PONTOON.text.h / 7;
  assert.ok(Math.abs(PONTOON.text.zc) + w / 2 < PONTOON.length / 2 - 0.5, `the lettering ${w.toFixed(2)} m long fits`);
  assert.ok(PONTOON.text.yc + PONTOON.text.h / 2 < PONTOON.band[1] && PONTOON.text.yc - PONTOON.text.h / 2 > PONTOON.band[0]);
  const sh = bbox(buildKayakShell());
  assert.ok(Math.abs(sh.hi[2] - sh.lo[2] - CLEAR_KAYAK.length) < 0.02 && sh.hi[0] - sh.lo[0] <= CLEAR_KAYAK.beam + 0.01);
  const fr = buildKayakFrame(); let seat = 0; for (let i = 0; i < fr.length; i += VF) if (fr[i + 6] === SLOT.seat) seat = Math.max(seat, fr[i + 1]);
  assert.ok(CLEAR_KAYAK.seatTop < 0.126 && CLEAR_KAYAK.seatTop > 0.08, 'the seat pan just under the paddler\'s hips (the asset\'s seat 0.126 m)');
  assert.ok(CLEAR_KAYAK.seats.includes(0.2), 'a seat at the paddler\'s hips (the asset\'s seatZ 0.2 m)');
  const all = buildTourMeshes(); assert.equal(all.data.length / VF, Object.values(all.runs).reduce((n, r) => n + r.count, 0));
  // the small parts that sell scale (detail round 2): every material slot present; the empty kayaks' paddle; the kayak's LED strip and bungees
  const slotsOf = (a) => { const o = new Set(); for (let i = 6; i < a.length; i += VF) o.add(a[i]); return o; };
  const hiS = slotsOf(buildPontoon({ lod: 'high' }));
  for (const k of ['band', 'tube', 'steel', 'vinyl', 'teak', 'fender', 'cowl', 'lensR', 'lensG', 'lensW', 'cord']) assert.ok(hiS.has(SLOT[k]), `the pontoon has ${k}`);
  const kp = slotsOf(buildKayakFrame({ paddle: true })), k0 = slotsOf(buildKayakFrame());
  assert.ok(kp.has(SLOT.blade) && !k0.has(SLOT.blade), 'a paddle only in the empty kayaks');
  for (const k of ['led', 'cord', 'rim', 'seat']) assert.ok(k0.has(SLOT[k]), `the kayak has ${k}`);
});

// ---- the device policy ----
const fakeProfile = (win, gpu) => { const get = () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu }); return { get, on: () => () => {} }; };
const make = (dev, gpu, ctx = {}, search = '') => createFeatures({ profile: fakeProfile({ ...DEVICES[dev], location: { search } }, gpu), doc: null }).configure({ headless: false, flags: {}, ...ctx });
test('the policy (owner, 2026-11-18): a desktop or a tablet, full at L0–L1 and lite at L2–L3; never a phone; a capture full unless ?profile= forces a phone; ?glassboat=', () => {
  for (const dev of ['desktop', 'smallDesktop', 'touchLaptop', 'ipadTrackpad']) {
    assert.equal(make(dev, 0).feature('glassBoat').tier, 'full', `${dev} L0`);
    assert.equal(make(dev, 1).feature('glassBoat').tier, 'full', `${dev} L1`);
    assert.equal(make(dev, 2).feature('glassBoat').tier, 'lite', `${dev} L2`);
    assert.equal(make(dev, 3).feature('glassBoat').tier, 'lite', `${dev} L3`);
  }
  for (const dev of ['iphoneTurned', 'androidSideways']) for (const g of [0, 1, 2]) assert.equal(make(dev, g).feature('glassBoat').tier, 'off', `${dev} L${g}`);
  assert.equal(make('iphoneTurned', 1, { headless: true }).feature('glassBoat').tier, 'full', 'a capture');
  assert.equal(make('desktop', 0, { headless: true }, '?profile=form:phone').feature('glassBoat').tier, 'off', 'a capture forced to a phone');
  assert.equal(make('desktop', 0, { flags: { glassboat: '0' } }).feature('glassBoat').tier, 'off', '?glassboat=0');
  assert.equal(make('iphoneTurned', 1, { flags: { glassboat: '1' } }).feature('glassBoat').tier, 'full', '?glassboat=1 on a phone');
  assert.equal(make('desktop', 0, { flags: { glassboat: 'lite' } }).feature('glassBoat').tier, 'lite');
  assert.equal(make('desktop', 0).feature('glassBoat').fixed, true, 'fixed at build');
  assert.ok(TOUR_ROUTE.length >= 4 && TOUR.name === 'Velia Travel');
});

// ---- her wake (owner, 2026-11-18) ----
test('her wake: the V, the prop wash and the bows\' foam by her speed; none at a stop once it fades (≤ 40 s); a swirl as she slows into one; the kayaks\' small wakes', () => {
  const T = createTourBoat({ depthAt, tauS: 0 });   // the head of the bay's stop, its start: she leaves after 270 s
  const focus = () => ({ x: T.boat.x, z: T.boat.z, fx: Math.sin(T.boat.heading), fz: -Math.cos(T.boat.heading) });
  let t = 0;
  const run = (s, each) => { for (let i = 0; i < Math.round(s / DT); i++) { t += DT; T.post(null, DT, t, () => 240); each?.(); } };
  // at the stop: nothing (she is at rest; her kayaks drift at under 0.5 m/s)
  run(60);
  const her = () => [T.emitters()[0]];   // her own (the paddlers roam at a stop: their small bow foam is theirs)
  let S = sources(her(), focus());
  assert.equal(S.kelvin.length + S.noses.length, 0, 'at rest: no V, no bow foam');
  assert.ok(S.strips.every((s) => s[7] < 0.2), 'at rest: no prop wash');
  // underway at 4 kn: the V (crests at the bow, troughs at the stern), the wash, the two bows
  run(400, null);
  for (let i = 0; i < 600 && T.boat.mode === 'stop'; i++) run(1);
  run(60);
  assert.ok(T.boat.v > 1.9, `underway: ${T.boat.v.toFixed(2)} m/s`);
  S = sources(T.emitters(), focus());
  assert.ok(S.kelvin.length >= 80, `the V: ${S.kelvin.length} impulses`);
  assert.ok(S.kelvin.some((k) => k[3] > 0) && S.kelvin.some((k) => k[3] < 0));
  assert.ok(S.strips.length > 60 && S.strips.some((s) => s[7] > 0.9), 'the wash, white');
  assert.ok(S.strips.every((s) => s[4] <= VESSEL.washLife + 1), 'none older than its life');
  assert.equal(S.noses.length >= 2, true, 'her two noses');
  // the box: on the texel grid, her ahead of its middle
  const cell = VESSEL.extent / VESSEL.size;
  assert.ok(Math.abs(S.box[0] / cell - Math.round(S.box[0] / cell)) < 1e-6 && S.box[2] === VESSEL.extent);
  assert.ok(T.boat.x > S.box[0] && T.boat.x < S.box[0] + VESSEL.extent && T.boat.z > S.box[1] && T.boat.z < S.box[1] + VESSEL.extent);
  // by speed: the V's impulse at 4 kn against one at 2 kn (∝ U²)
  const amp = (v) => sources([{ trail: [{ age: 0.1, x: 0, z: 0, fx: 1, fz: 0, v, churn: 0 }, { age: 0.6, x: -v / 2, z: 0, fx: 1, fz: 0, v, churn: 0 }], length: 10.7, kelvinAmp: 1 }], { x: 0, z: 0, fx: 1, fz: 0 }).kelvin[0][3];
  assert.ok(Math.abs(amp(2.06) / amp(1.03) - 4) < 0.01);
  // the kayaks towed astern leave their own small foam (their bows and wash), no V of their own
  assert.ok(T.kayaks.some((k) => k.trail.length && k.trail[0].v > 1.5));
  // slowing into the next stop: the churn swirl while she is under 0.6 m/s, then nothing once she is still and the foam has faded
  let swirl = 0;
  for (let i = 0; i < 2000 && T.boat.mode !== 'stop'; i++) run(1, () => { const p = T.trail[0]; if (p && p.v < 0.6 && p.v > 0.05) swirl = Math.max(swirl, p.churn); });
  assert.ok(swirl > 0.2, `the swirl as she slows in: ${swirl.toFixed(2)}`);
  run(45);
  S = sources(her(), focus());
  assert.equal(S.kelvin.length + S.noses.length, 0, 'stopped: no V, no bow foam');
  const strongest = Math.max(0, ...S.strips.map((s) => s[7] * Math.exp(-Math.max(s[4] - VESSEL.whiteS, 0) / VESSEL.foamS)));
  assert.ok(strongest < 0.1, `the foam faded after 45 s at the stop: ${strongest.toFixed(3)}`);
});

test('her wake on the GPU: the vessels\' map after the creature map in the wake\'s buffer, one compute, one dispatch a frame only while she is in it; none without the map (a phone, the lite tier)', async () => {
  const calls = { writes: [], buffers: [] };
  const dev = {
    createBuffer: (d) => { calls.buffers.push(d); return { size: d.size, label: d.label }; }, createTexture: (d) => ({ ...d, createView: () => ({}) }), createSampler: () => ({}),
    createBindGroupLayout: (d) => d, createBindGroup: (d) => d, createPipelineLayout: (d) => d,
    createShaderModule: ({ label, code }) => ({ label, code, getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async (d) => ({ label: d.label }), createRenderPipelineAsync: async (d) => ({ label: d.label }),
    queue: { writeBuffer: (buf, off, data) => calls.writes.push(buf.label) }, pushErrorScope() {}, popErrorScope: async () => null,
  };
  globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 }; globalThis.GPUBufferUsage ??= { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
  const errors = [], reg = createPipelineRegistry(dev, { errors });
  const base = { device: dev, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', sky: { skyBGL: {}, skyBG: {} }, hdrTarget: { format: 'rgba16float' } };
  const wake = createWakeFx({ ...base, creature: 128, vessel: VESSEL.size });
  assert.equal(calls.buffers.find((b) => b.label === 'wake-maps').size, (256 ** 2 + 512 ** 2 + 128 ** 2 + VESSEL.size ** 2) * 8);
  assert.equal(wake.vesselOffset, 256 ** 2 + 512 ** 2 + 128 ** 2);
  const VW = createVesselWake({ device: dev, reg, wake });
  assert.equal(await reg.buildAll(), 4); assert.ok(reg.names().includes('vessel-wake'));
  assert.deepEqual(errors, []);
  const disp = [], c = { dispatches: 0 }, pass = { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups: (...a) => disp.push(a) };
  VW.update(null, null); VW.run(pass, c);
  assert.equal(c.dispatches, 0); assert.equal(wake.vessel.on, 0);
  const T = createTourBoat({ depthAt, tauS: 400 });
  for (let i = 0; i < 30 / DT; i++) T.post(null, DT, i * DT, () => 240);
  VW.update(T.emitters(), { x: T.boat.x, z: T.boat.z, fx: Math.sin(T.boat.heading), fz: -Math.cos(T.boat.heading) }, 30); VW.run(pass, c);
  assert.equal(c.dispatches, 1); assert.deepEqual(disp.at(-1), [VESSEL.size / 8, VESSEL.size / 8]); assert.equal(wake.vessel.on, 1);
  wake.run(pass, { dispatches: 0 });
  assert.equal(wake.uniforms[39], 1); assert.equal(wake.uniforms[38], VESSEL.extent);
  // none: no map on the page (a phone, the lite tier) gives no wake object
  const reg2 = createPipelineRegistry(dev, {}), plain = createWakeFx({ ...base, reg: reg2 });
  assert.equal(createVesselWake({ device: dev, reg: reg2, wake: plain }), null);
  await reg2.buildAll();
  plain.run(pass, { dispatches: 0 }); assert.equal(plain.uniforms[39], 0);
});
