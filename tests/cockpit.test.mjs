// The hero cockpit and rig: the lines land on the hardware the
// Blender build placed (models/boat/cockpit.json), the traveller car rides its crowned track, the new fittings are
// finite and inside their budgets. Plain JS, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import INFO from '../models/boat/cockpit.json' with { type: 'json' };
import { COCKPIT, trackY, toRig } from '../src/boat/cockpitPoints.js';
import { DECKPTS, lineSet, coil } from '../classic/src/boat/lines.js';
import { solveRig, buildSpars, SPARS } from '../src/boat/spars.js';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
const { HULL } = DEFAULT_DIMS;   // this page's boat (its profile)

const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const STATE = { mainSheet: 30 * DEG, boomAngle: -0.4, jibAngle: -0.3, mainFill: 1, jibFill: 1, apparentWind: { speed: 5, angle: 1 } };

test('cockpit.json carries the points the page reads', () => {
  for (const k of ['winch_primary_S', 'winch_primary_P', 'winch_halyard_S', 'clutches_S', 'organiser_P', 'mastblocks_S', 'engine_throttle', 'engine_panel', 'companion'])
    assert.ok(INFO.points_hull_frame[k], k);
  assert.ok(INFO.traveller_track_hull.length >= 5);
  assert.ok(INFO.triangles.cockpit_far_only < INFO.triangles.cockpit_near_only, 'the far LOD is lighter');
});

test('the traveller car rides the crowned track: highest at the centre, the ends lower, the car node on it', () => {
  const mid = trackY(0), end = trackY(0.58);
  assert.ok(mid > end && mid - end < 0.2, `${mid} ${end}`);
  assert.ok(Math.abs(mid - INFO.traveller_hull_frame[1]) < 0.002, 'the GLB car sits on the track');
  for (let x = -0.6; x < 0.6; x += 0.05) assert.ok(Math.abs(trackY(x) - trackY(-x)) < 1e-6, 'symmetric');
});

test('the lines land on the hardware: the jib sheet on its winch, the halyards through their clutches', () => {
  const set = lineSet(STATE);
  const by = (n) => set.find((l) => l.name === n);
  const work = Math.sign(STATE.jibAngle) || -1;
  const sheet = by('jibsheet-working').points;
  assert.ok(dist(sheet[sheet.length - 1], toRig(COCKPIT.winch(work))) < 0.01, 'the jib sheet ends on the drawn winch');
  const mh = by('main-halyard').points;
  const clutch = toRig(COCKPIT.clutches(1)[0]);
  assert.ok(Math.min(...mh.map((p) => dist(p, clutch))) < 0.01, 'the main halyard passes its clutch');
  for (const l of set) assert.ok(l.points.every((p) => p.every(Number.isFinite)), `${l.name} finite`);
  for (const n of ['reef-1', 'reef-2', 'outhaul', 'furling-line', 'main-halyard-coil', 'lazyjack-S-a']) assert.ok(by(n), n);
  // the furling line stays over the deck (inside the sheer's half-beam, never out over the water)
  for (const p of by('furling-line').points.slice(1)) assert.ok(Math.abs(p[0]) < 1.55, `${p}`);
});

test('the mainsheet meets the boom at its bail and the car at its block', () => {
  const rig = solveRig(SPARS);
  const set = lineSet(STATE);
  const part = set.find((l) => l.name === 'mainsheet-0').points;
  const car = DECKPTS.traveller(0);
  assert.ok(Math.abs(part[part.length - 1][2] - car[2]) < 0.01, 'lower end on the car');
  assert.ok(Math.abs(rig.points.bails.mainsheet - (toRig(COCKPIT.traveller)[2] - SPARS.goosenZ)) < 0.02, 'the bail over the traveller');
});

test('a coil closes on itself and lies in its plane', () => {
  const c = coil([0, 0, 0], 0.1, [0, 1, 0], 3, 20, 0);
  assert.equal(c.length, 61);
  assert.ok(dist(c[0], c[20]) < 0.02 && c.every((p) => Math.abs(p[1]) < 1e-9));
});

test('the rig\'s new parts: the vane, the furler drum and its guide are finite; the guide is near the stem', () => {
  const g = buildSpars(solveRig(SPARS));
  for (const md of [g.vane, g.furler.drum]) {
    const a = md.arrays();
    assert.ok(a.position.every(Number.isFinite) && a.normal.every(Number.isFinite));
  }
  assert.ok(g.furler.guide.every(Number.isFinite));
  assert.ok(Math.abs(g.furler.guide[2] - (HULL.stemZ - HULL.mastStepZ)) < 0.4, `${g.furler.guide}`);
});
