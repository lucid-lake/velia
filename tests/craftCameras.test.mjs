// Camera settings from the craft (refactor round 2, Phase C step 7): the follow camera's length unit and the helm view's
// eye come from the craft and its profile (craft.cameras(vessel), src/craft/sloop/cameras.js), not from sloop constants
// in the camera modules. Halcyon keeps its numbers (9.1 m; the eye at [0, 2.0, 3.3]): the poses are identical to the
// defaults' to the bit. A shorter boat's camera sits nearer: the seam bites.
import './helpers/terrain-small.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CRAFTS, camerasFor, vesselFor } from '../src/sim/craft/index.js';
import { createHull } from '../classic/src/craft/hull.js';
import { CURRENT_VESSEL } from '../src/sim/vessels/current.js';
import { vesselDims } from '../src/sim/boat/dims.js';
import { FollowCamera, FOLLOW } from '../src/sim/boat/followCamera.js';
import { HelmCamera, HELM_CAM } from '../src/sim/boat/helmCamera.js';
import { Binoculars } from '../src/boat/binoculars.js';
import { any } from './helpers/sail-controls.mjs';
import { parseFlags } from '../src/sim/core/flags.js';
import { TEST_BOAT } from './fixtures/profiles/second.mjs';
import { HELM_AFT, HELM_UP } from '../src/modes/chill/director.js';

const boat = (t) => ({ x: 400 + 3 * t, z: 400 - t, heave: 0.2 * Math.sin(t), heading: 0.3 + 0.1 * Math.sin(0.5 * t), sog: 2 + Math.sin(0.3 * t), surf: t > 4 && t < 6 ? 1 : 0 });
const pose = (t) => ({ x: 400 + 3 * t, z: 400 - t, heading: 0.3 + 0.1 * Math.sin(0.5 * t), heel: 0.15 * Math.sin(t), pitch: 0.04 * Math.sin(1.3 * t), heave: 0.2 * Math.sin(0.8 * t) });

test('Halcyon: the profile\'s numbers are the cameras\' old constants', () => {
  const c = camerasFor(CURRENT_VESSEL);
  assert.equal(c.follow.hull, FOLLOW.hull);
  assert.equal(c.follow.hull, 9.1);
  assert.deepEqual([...c.helm.eye], [...HELM_CAM.eye]);
  assert.equal(camerasFor(null), c, 'null: this page\'s boat');
  assert.equal(CRAFTS.sloop.cameras(CURRENT_VESSEL), c, 'one object per profile');
  assert.deepEqual([HELM_UP, HELM_AFT], [2.0, 3.3], 'Cruise\'s director reads the same eye');
});

test('a profile with no cameras block: its own length for the follow camera, the default eye', () => {
  const { cameras, ...bare } = TEST_BOAT;
  assert.ok(cameras, 'the fixture inherits the block');
  const c = camerasFor(bare);
  assert.equal(c.follow.hull, vesselDims(bare).HULL.loa);
  assert.ok(Math.abs(c.follow.hull - 24 * 0.3048) < 1e-9);
  assert.deepEqual([...c.helm.eye], [...HELM_CAM.eye]);
});

test('a craft with no camera settings yet (the kayak): empty rows, the cameras keep their defaults', () => {
  const c = camerasFor(vesselFor('kayak'));
  assert.deepEqual(c, { follow: {}, helm: {} });
  assert.equal(new FollowCamera({ hull: c.follow.hull }).hull, FOLLOW.hull);
  assert.deepEqual(new HelmCamera(c.helm).cfg.eye, HELM_CAM.eye);
});

test('same numbers for the sloop: the follow and helm poses are bit-identical to the defaults over 10 s', () => {
  const c = camerasFor(CURRENT_VESSEL);
  const a = new FollowCamera({ x: 400, z: 400, heading: 0.3 }), b = new FollowCamera({ x: 400, z: 400, heading: 0.3, hull: c.follow.hull });
  const h1 = new HelmCamera(), h2 = new HelmCamera(c.helm);
  for (let i = 0; i < 600; i++) {
    const t = i / 60, inp = i % 90 < 20 ? { orbit: [0.01, -0.004], zoom: 1.002 } : {};
    assert.deepEqual(b.update(1 / 60, boat(t), inp), a.update(1 / 60, boat(t), inp), `follow, frame ${i}`);
    const look = i % 120 < 30 ? [0.01, 0.005] : null;
    assert.deepEqual(h2.update(1 / 60, pose(t), { look }), h1.update(1 / 60, pose(t), { look }), `helm, frame ${i}`);
  }
});

test('a shorter hull unit brings the follow camera nearer in proportion; another eye moves the helm view and the binoculars', () => {
  const at = (hull) => { const cam = new FollowCamera({ heading: 0, hull }); let p; for (let i = 0; i < 300; i++) p = cam.update(1 / 60, { x: 0, z: 0, heave: 0, heading: 0, sog: 0 }); return Math.hypot(p.pos[0], p.pos[1] - FOLLOW.aimUp, p.pos[2]); };
  const r91 = at(9.1), r45 = at(4.55);
  assert.ok(Math.abs(r91 - FOLLOW.dist * 9.1) < 0.5, `9.1 m: ${r91.toFixed(2)} m`);
  assert.ok(Math.abs(r45 / r91 - 0.5) < 0.01, `half the hull, half the distance: ${r45.toFixed(2)} vs ${r91.toFixed(2)} m`);
  const settle = (cam) => { let r; for (let i = 0; i < 120; i++) r = cam.update(1 / 60, { x: 0, z: 0, heading: 0, heel: 0, pitch: 0, heave: 0 }, {}); return r; };
  assert.deepEqual(settle(new HelmCamera({ eye: [0, 1.4, 1.2] })).pos.map((v) => +v.toFixed(6)), [0, 1.4, 1.2]);
  const bino = (eye) => { const b = new Binoculars(eye ? { eye } : {}); let r; const from = { pos: [0, 5, 10], target: [0, 4, 0], fov: 50, near: 0.5 }; for (let i = 0; i < 12; i++) r = b.update(0.1, { x: 0, z: 0, heading: 0, heel: 0, pitch: 0, heave: 0 }, { held: true, from }); return r.pose.pos; };
  assert.deepEqual(bino(HELM_CAM.eye), bino(null), 'the default eye is the helm\'s');
  assert.ok(Math.abs(bino([0, 1.4, 1.2])[1] - bino(null)[1] + 0.6) < 1e-6, 'a lower eye, a lower pair of glasses');
});

test('createHull: the follow camera takes the craft\'s hull unit from the profile', () => {
  const water = { surface: { heightAt: () => 0 }, waveAt: () => 0, orbitAt: () => null, clarity: null };
  const core = { flags: parseFlags('air=0'), headless: true, renderer: any('renderer'), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    lum: 1, water, wake: { update() {} }, wind: { sample: () => ({ vx: 3, vz: -4, speed: 5 }) }, audio: any('audio'), SEED: 1, terrain: { heightAt: () => -20 } };
  const start = { x: 400, z: 400, headingDeg: 90 };
  const v = { ...TEST_BOAT, cameras: { follow: { hull: 6.2 } } };
  assert.equal(createHull(core, { craft: CRAFTS.sloop, vessel: v, start, dims: vesselDims(v) }).follow.hull, 6.2);
  assert.equal(createHull(core, { craft: CRAFTS.sloop, vessel: CURRENT_VESSEL, start, dims: vesselDims(CURRENT_VESSEL) }).follow.hull, 9.1);
  assert.equal(createHull(core, { craft: CRAFTS.kayak, vessel: vesselFor('kayak'), start, dims: vesselDims(CURRENT_VESSEL) }).follow.hull, FOLLOW.hull, 'no camera settings: the default');
});
