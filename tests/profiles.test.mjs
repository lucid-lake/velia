// Lake and boat profiles (refactor Phase 2 step 6): a second lake and a second
// boat are data. A test-only lake (its own tiny terrain) and a renamed, smaller boat (tests/fixtures/profiles/second.mjs)
// go through the same paths the shipped ones do: the terrain loader and buildLake, the wind's bay box, the start and the
// first gust, the dims, the physics, the skipper's polar, the hull, the ground and the tackle; and, in a child process
// that sails them as the page's choice (?waters= / ?vessel=), every module that reads the chosen lake and boat.
// Run: node --test tests/profiles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MINI_LAKE, TEST_BOAT } from './fixtures/profiles/second.mjs';
import { lakeTerrain, makeTerrain, LAKE } from '../src/sim/terrain.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
import { CURRENT_VESSEL } from '../src/sim/vessels/current.js';
import { WATERS } from '../src/sim/waters/index.js';
import { VESSELS } from '../src/sim/vessels/index.js';
import { WindField } from '../src/sim/wind.js';
import { bayPoints } from '../src/vhf/forecast.js';
import { startPose, sailCoreOptions } from '../classic/src/sail/options.js';
import { makePlace, timeAt } from '../src/sim/place.js';
import { vesselDims, DEFAULT_DIMS } from '../src/sim/boat/dims.js';
import { BoatPhysics, boatParams, BOAT, CONTROLS, KN, DT, steadyWind, Helm } from '../src/sim/boat.js';
import { AISkipper, polarKn } from '../src/sim/ai/skipper.js';
import { Boat } from '../classic/src/boat/Boat.js';
import { createGround, groundFor, groundPoints } from '../src/sim/boat/ground.js';
import { createTackle, anchorFor } from '../src/sim/boat/tackle.js';
import { makeHull } from '../src/sim/marks/hull.js';
import { HullFloat } from '../src/sim/boat/float.js';
import { sparsFor } from '../src/boat/spars.js';
import { shotsFor } from '../classic/src/boat/shots.js';
import { snapshotPhysics } from '../src/sim/sail/simulation.js';
import { parseFlags } from '../src/sim/core/flags.js';

const ROOT = new URL('../', import.meta.url);
const DEG = Math.PI / 180;

test('the test lake and boat are not shipped: no registry lists them, the shipped profiles carry no test text', () => {
  assert.ok(!WATERS.some((w) => w.id === MINI_LAKE.id), 'src/waters/index.json does not list the test lake');
  assert.ok(!VESSELS.some((v) => v.id === TEST_BOAT.id), 'src/vessels/index.json does not list the test boat');
  for (const f of ['src/waters/index.json', 'src/vessels/index.json', 'src/sim/waters/index.js', 'src/sim/vessels/index.js']) {
    assert.doesNotMatch(readFileSync(new URL(f, ROOT), 'utf8'), /test-mini|test-teal|fixtures/, f);
  }
  // the page sails the shipped default here (the child process below sails the test pair)
  assert.equal(CURRENT_WATERS.id, 'tahoe-emerald'); assert.equal(CURRENT_VESSEL.id, 'halcyon');
});

test('a second lake: the loader and buildLake make its terrain, island, mouth, landmarks, place and frame from its profile', async () => {
  const T = await lakeTerrain(MINI_LAKE);
  assert.equal(T.waters, MINI_LAKE);
  assert.notEqual(T, makeTerrain(), 'not the page lake');
  // its own grids: the island knob on the origin, the bowl around it, the bank beyond
  assert.ok(Math.abs(T.heightAt(0, 0) - 12) < 0.05, `island top ${T.heightAt(0, 0)}`);
  assert.ok(T.heightAt(200, 0) < -10 && T.shoreDistance(200, 0) < 0, 'open water at 200 m');
  assert.ok(T.heightAt(600, 0) > 0 && T.shoreDistance(600, 0) > 0, 'land past the shore');
  // the island is fitted from its data, round and on the origin (Tahoe's is a 79 × 40 m ellipse)
  const I = T.lake.island;
  assert.ok(Math.abs(I.x) < 1 && Math.abs(I.z) < 1 && Math.abs(I.a - I.b) < 1 && I.a > 35 && I.a < 45, JSON.stringify(I));
  assert.notDeepEqual(I, LAKE.island);
  // the bay and the mouth from the profile's numbers and points
  assert.deepEqual([T.lake.bay.cx, T.lake.bay.cz, T.lake.bay.lengthM], [0, -200, 900]);
  assert.equal(T.lake.maxDepth, 20);
  assert.ok(Math.abs(T.lake.mouth.halfWidth - 120) < 0.5, `mouth half-width ${T.lake.mouth.halfWidth}`);
  // the landmarks at the profile's points, through its own projection
  assert.ok(Math.hypot(T.landmarks.house.x + 470, T.landmarks.house.z - 40) < 0.5, JSON.stringify(T.landmarks.house));
  assert.equal(T.landmarks.peak.name, 'knoll');
  assert.ok(Math.hypot(T.places().harbour.x - 440, T.places().harbour.z - 120) < 0.5);
  // the frame, the day and the climate
  assert.deepEqual(T.geo.ORIGIN, { lat: 45.5, lon: -111.25 }); assert.equal(T.geo.Y0, 1200);
  const [x, z] = T.geo.lonLatToWorld(-111.25, 45.5); assert.ok(Math.hypot(x, z) < 1e-6, 'the origin is 0, 0');
  assert.deepEqual(T.place, makePlace(MINI_LAKE));
  assert.equal(timeAt(12, T.place), Date.parse('2026-03-20T18:00:00Z'), 'noon at UTC−6 on its date');
  assert.equal(T.climate.treeline, 1600); assert.equal(T.climate.season.snowLine, 1500);
  // the queries run on its data (the waterfall finder, the keep-out, the fetch)
  assert.ok(Number.isFinite(T.waterfall().x));
  assert.equal(T.keepOut(0, 0), true, 'the ruin on the summit keeps the scatter out');
  assert.ok(T.fetchMap(16, 1024, { cx: 0, cz: 0 }).data.some((d) => d > 0));
});

test('a second lake: its wind box, its start and its first gust', async () => {
  const T = await lakeTerrain(MINI_LAKE);
  const w = new WindField({ seed: 1, bay: MINI_LAKE.windBay, day: { hour: 15 }, level: 3 });
  w.setTerrain(T.heightAt);
  assert.equal(w.bay, MINI_LAKE.windBay);
  assert.deepEqual([w.lv.at.x, w.lv.at.z], [0, -150], 'a level change blows in at the profile point');
  const pts = bayPoints(T.heightAt, w.bay);
  assert.ok(pts.length >= 9 && pts.every(([px, pz]) => Math.abs(px) <= 300 && Math.abs(pz) <= 300 && T.heightAt(px, pz) < -5), `${pts.length} points`);
  assert.ok(Number.isFinite(w.refFactor('bay')));
  const S = startPose(parseFlags(''), MINI_LAKE);
  assert.deepEqual(S, { x: 150, z: 200, headingDeg: 300, speed: 2 });
  const o = sailCoreOptions(parseFlags(''), MINI_LAKE), day = o.wind(18);
  assert.deepEqual(day.levelRef, 'bay');
  const g = day.firstGust;
  assert.ok(g && Math.abs(Math.hypot(g.x - 150, g.z - 200) - 80) < 1, `the first gust 80 m ahead of the start: ${JSON.stringify(g)}`);
});

test('a second boat: its dims, physics, engine, polar and helm come from its profile', () => {
  const D = vesselDims(TEST_BOAT), H = DEFAULT_DIMS;
  assert.ok(Math.abs(D.HULL.loa - 24 * 0.3048) < 1e-9 && D.HULL.loa < H.HULL.loa);
  assert.ok(D.RIG.mastTop < H.RIG.mastTop && D.RIG.boom < H.RIG.boom);
  assert.equal(vesselDims(TEST_BOAT), D, 'memoised per profile');
  const P = boatParams(TEST_BOAT);
  assert.ok(Math.abs(P.mass - 5200 * 0.4536) < 1e-9 && P.main.area < BOAT.main.area && P.rudder.maxDeg === 30);
  // the default boat is the shipped one, number for number
  assert.equal(boatParams(CURRENT_VESSEL), BOAT);
  const sail = (vessel) => {
    const b = new BoatPhysics({ heading: -50 * DEG, speed: 2, ...(vessel ? { vessel } : {}) }), h = new Helm({ rudderMaxDeg: b.P.rudder.maxDeg });
    const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
    for (let i = 0; i < 90 / DT; i++) { env.t = i * DT; b.step(DT, { ...CONTROLS, rudder: h.toHeading(b.state, -50 * DEG) }, env); }
    return b;
  };
  const a = sail(null), a2 = sail(CURRENT_VESSEL), t = sail(TEST_BOAT);
  assert.deepEqual(a2.state, a.state, 'the default and the explicit shipped boat sail bit for bit alike');
  assert.equal(t.vessel, TEST_BOAT); assert.equal(t.engine.P.hp, 15);
  assert.ok(Math.abs(t.state.u - a.state.u) > 0.05, `a different boat sails differently: ${t.state.u.toFixed(3)} vs ${a.state.u.toFixed(3)} m/s`);
  assert.equal(snapshotPhysics(t).vesselId, 'test-teal');
  assert.equal(snapshotPhysics(t).vessel, undefined, 'the profile itself is not in a snapshot');
  // the skipper sails its own boat's polar (85 % of the default's) and rudder
  const sk = new AISkipper({ vessel: TEST_BOAT });
  assert.equal(sk.polar, TEST_BOAT.polar); assert.equal(sk.helm.rudderMaxDeg, 30);
  assert.ok(Math.abs(polarKn(10 * KN, 45, sk.polar) / polarKn(10 * KN, 45) - 0.85) < 0.01);
});

test('a second boat: the sockets, spars, shots, hull, float, ground and tackle take its dims', () => {
  const D = vesselDims(TEST_BOAT);
  const boat = new Boat({ dims: D });
  assert.equal(boat.dims, D);
  const mast = boat.sockets.mast.position;
  assert.ok(Math.abs(mast.y - D.HULL.mastStepY) < 1e-6 && Math.abs(mast.z - D.HULL.mastStepZ) < 1e-6);
  assert.ok(Math.abs(boat.sockets.rudder.position.z - 2.8) < 1e-6, 'the profile rudder');
  assert.notDeepEqual(boat.sockets.mast.position.toArray(), new Boat().sockets.mast.position.toArray());
  assert.ok(sparsFor(D).mastTop < sparsFor(DEFAULT_DIMS).mastTop);
  assert.ok(shotsFor(D).masthead.target[1] < shotsFor(DEFAULT_DIMS).masthead.target[1]);
  assert.ok(Math.abs(makeHull({ dims: D }).length - D.HULL.loa) < 1e-9);
  const fl = new HullFloat({ surface: { heightAt: () => 0 }, dims: D });
  assert.ok(Math.abs(fl.length - D.HULL.lwl) < 1e-9 && fl.length < new HullFloat({ surface: { heightAt: () => 0 } }).length, 'the float sized to the boat');
  // the keel's points draw the boat's draft and the rudder sits at its stock
  const G = groundFor(D), pts = groundPoints(G, D);
  assert.ok(G.keel.every((k, i) => i === 2 || Math.abs(k.d - D.HULL.draft) < 1e-9) && Math.abs(G.rudder.x + 2.8) < 1e-9);
  assert.ok(Math.max(...pts.filter((p) => p.kind === 'hull').map((p) => p.x)) <= D.HULL.loa / 2 + 1e-9, 'the hull outline is the boat\'s');
  assert.ok(createGround({ depthAt: () => 10, dims: D }), 'a ground for the boat');
  assert.ok(Math.abs(anchorFor(D).bowX - 3.8) < 1e-9, 'the anchor roller from the profile');
  assert.notEqual(anchorFor(D).bowX, anchorFor(DEFAULT_DIMS).bowX);
  assert.ok(createTackle({ depthAt: () => 8, dims: D }), 'a tackle for the boat');
});

test('the page sails the chosen lake and boat: every module reads the second pair when it is the choice', () => {
  const out = execFileSync(process.execPath, ['--import', './tests/fixtures/profiles/install-second.mjs', 'tests/helpers/profiles-probe.mjs'],
    { cwd: ROOT, encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').at(-1));
  // the lake
  assert.equal(r.watersId, 'test-mini');
  assert.ok(Math.abs(r.hIsland - 12) < 0.05 && r.hLake < -10, 'the terrain exports are the second lake');
  assert.deepEqual(r.origin, { lat: 45.5, lon: -111.25 }); assert.equal(r.y0, 1200);
  assert.deepEqual(r.place, makePlace(MINI_LAKE));
  assert.deepEqual(r.start, MINI_LAKE.start); assert.deepEqual(r.firstGust, MINI_LAKE.firstGust);
  assert.deepEqual(r.goal, { name: 'Pebble Isle', text: 'Sail to Pebble Isle' }); assert.equal(r.arrival, 'That is Pebble Isle.');
  assert.deepEqual(r.stops, Object.keys(MINI_LAKE.stops));
  assert.deepEqual(r.chart, MINI_LAKE.charts.logbook);
  assert.equal(r.root, 1280); assert.deepEqual(r.fine, MINI_LAKE.terrain.fine);
  assert.deepEqual(r.bay, MINI_LAKE.windBay);
  assert.equal(r.regattaWaters, 'test-mini');
  // the boat
  assert.ok(Math.abs(r.dims.loa - 24 * 0.3048) < 1e-9);
  assert.ok(Math.abs(r.boat.mass - 5200 * 0.4536) < 1e-9); assert.equal(r.boat.rudderMax, 30);
  assert.equal(r.phys, 'test-teal'); assert.equal(r.engineHp, 15);
  assert.equal(r.boatLength, 7.3); assert.equal(r.regattaName, 'Teal');
  assert.deepEqual(r.models, Object.values(TEST_BOAT.models));
  assert.ok(Math.abs(r.polar10x45 - polarKn(10 * KN, 45) * 0.85) < 0.01);
});
