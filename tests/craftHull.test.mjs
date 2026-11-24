// The hull frame (refactor round 2, Phase C step 6): createHull builds any
// craft's floating frame in node (no GLB, no loader), with the env, the post chain and the dispose the assembly had; the
// sloop's rig refuses a paddle craft. The picture is gated by the goldens; the boat service's keys by
// tests/pages/boatService.page.mjs (retired 2026-11-18).
import './helpers/terrain-small.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createHull } from '../classic/src/craft/hull.js';
import { createRig } from '../classic/src/craft/sloop/rig.js';
import { CRAFTS, vesselFor } from '../src/sim/craft/index.js';
import { KayakPhysics } from '../src/sim/craft/kayak/physics.js';
import { BoatPhysics } from '../src/sim/boat.js';
import { Boat } from '../classic/src/boat/Boat.js';
import { vesselDims } from '../src/sim/boat/dims.js';
import { any } from './helpers/sail-controls.mjs';
import { parseFlags } from '../src/sim/core/flags.js';
import { TEST_BOAT } from './fixtures/profiles/second.mjs';

const START = { x: 400, z: 400, headingDeg: 90, speed: 1.5 };
function stubCore(o = {}) {
  const water = { surface: { heightAt: () => 0 }, waveAt: () => 0, orbitAt: () => null, clarity: null };
  return { flags: parseFlags('air=0'), headless: true, renderer: any('renderer'), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    lum: 1, water, wake: { update() {} }, wind: { sample: () => ({ vx: 3, vz: -4, speed: 5 }) }, audio: any('audio'), SEED: 1,
    terrain: { heightAt: () => -20 }, sun: { hour: 12, elevationDeg: 40 }, ...o };
}

test('createHull: the sloop\'s BoatPhysics at the start pose, the env\'s keys, the wind from the wind module', () => {
  const core = stubCore(), hull = createHull(core, { craft: CRAFTS.sloop, vessel: TEST_BOAT, start: START, dims: vesselDims(TEST_BOAT) });
  assert.ok(hull.phys instanceof BoatPhysics);
  assert.equal(hull.phys.vessel, TEST_BOAT);
  assert.deepEqual([hull.phys.state.x, hull.phys.state.z, hull.phys.state.heading, hull.phys.state.u], [400, 400, Math.PI / 2, 1.5]);
  const e = hull.env(3);
  assert.deepEqual(Object.keys(e).sort(), ['currentAt', 'ext', 'post', 'sea', 't', 'waveAt', 'windAt']);
  assert.equal(e.t, 3);
  assert.deepEqual(e.windAt(0, 0, 3), { vx: 3, vz: -4 });
  assert.equal(e.sea(), hull.ride.wave);
  assert.equal(hull.air, null, '?air=0: no air');
  assert.equal(hull.boatAudio, null, 'captures: no sound');
  const p = hull.pose0();
  assert.deepEqual(core.camera.position.toArray(), p.pos, 'pose0 puts the follow camera\'s first pose on the camera');
});

test('addPost: a hook runs after the bottom\'s, in order, and off() removes it', () => {
  const hull = createHull(stubCore(), { craft: CRAFTS.sloop, vessel: TEST_BOAT, start: START, dims: vesselDims(TEST_BOAT) });
  const calls = [];
  hull.ground.post = (s, dt, t) => calls.push(['ground', t]);
  const off = hull.addPost((s, dt, t) => calls.push(['a', t]));
  hull.addPost((s, dt, t) => calls.push(['b', t]));
  hull.env(1).post(hull.phys.state, 1 / 60, 1);
  off();
  hull.env(2).post(hull.phys.state, 1 / 60, 2);
  assert.deepEqual(calls, [['ground', 1], ['a', 1], ['b', 1], ['ground', 2], ['b', 2]]);
  assert.equal(hull.posts.length, 1);
});

test('dispose: the spray leaves the scene', () => {
  const core = stubCore(), hull = createHull(core, { craft: CRAFTS.sloop, vessel: TEST_BOAT, start: START, dims: vesselDims(TEST_BOAT) });
  assert.ok(core.scene.children.includes(hull.ride.spray.mesh));
  hull.dispose();
  assert.ok(!core.scene.children.includes(hull.ride.spray.mesh));
});

test('the seam bites: the kayak\'s hull frame steps a KayakPhysics, and the sloop\'s rig refuses a paddle craft', () => {
  const kayak = vesselFor('kayak'), dims = vesselDims(TEST_BOAT);
  const hull = createHull(stubCore(), { craft: CRAFTS.kayak, vessel: kayak, start: START, dims });
  assert.ok(hull.phys instanceof KayakPhysics);
  hull.phys.step(1, { throttle: 0.5, turn: 0 }, hull.env(0));
  assert.ok(hull.phys.state.x > 400, 'paddles east on heading 90°');
  assert.throws(() => createRig(stubCore(), new Boat({ dims }), { vessel: kayak, dims, craft: CRAFTS.kayak }), /rig: a sloop's rig needs a sail craft/);
  assert.doesNotThrow(() => createRig(stubCore(), new Boat({ dims }), { vessel: TEST_BOAT, dims, craft: CRAFTS.sloop }));
});
