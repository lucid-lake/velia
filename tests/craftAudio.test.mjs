// The audio seam (refactor round 2, Phase C step 10; src/craft/sloop/audio.js): the hull frame asks the craft for its own
// sound (craft.createAudio(core)) on a live page; the sloop's is the boat's sound with today's banks and seed; a craft
// without one (the kayak, so far) is silent; captures make none.
import './helpers/terrain-small.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createHull } from '../classic/src/craft/hull.js';
import { CRAFTS, vesselFor } from '../src/sim/craft/index.js';
import { createAudio } from '../src/sim/craft/sloop/audio.js';
import { vesselDims } from '../src/sim/boat/dims.js';
import { any } from './helpers/sail-controls.mjs';
import { parseFlags } from '../src/sim/core/flags.js';
import { TEST_BOAT } from './fixtures/profiles/second.mjs';

const START = { x: 400, z: 400, headingDeg: 90, speed: 1.5 };
function stubCore(o = {}) {
  const water = { surface: { heightAt: () => 0 }, waveAt: () => 0, orbitAt: () => null, clarity: null };
  return { flags: parseFlags('air=0'), headless: false, renderer: any('renderer'), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    lum: 1, water, wake: { update() {} }, wind: { sample: () => ({ vx: 3, vz: -4, speed: 5 }) }, audio: { attach() {} }, SEED: 7,
    terrain: { heightAt: () => -20 }, sun: { hour: 12, elevationDeg: 40 }, ...o };
}
const hullFor = (core, craft, vessel = TEST_BOAT) => createHull(core, { craft, vessel, start: START, dims: vesselDims(TEST_BOAT) });

test('the sloop\'s createAudio is the boat\'s sound on the page\'s audio', () => {
  assert.equal(CRAFTS.sloop.createAudio, createAudio);
  const attached = [];
  const a = createAudio({ audio: { attach: (fn) => attached.push(fn) }, SEED: 7 });
  assert.equal(typeof a.update, 'function');
  assert.equal(a.stats().started, false, 'silent until audio.start()');
  assert.equal(attached.length, 1, 'it plugs into the page\'s audio context once (audio.attach)');
});

test('the hull frame takes the craft\'s own sound, live only', () => {
  const made = [];
  const sound = { update() {}, dispose() { made.push('disposed'); } };
  const craft = { ...CRAFTS.sloop, createAudio: (core) => { made.push(core.SEED); return sound; } };
  const core = stubCore(), hull = hullFor(core, craft);
  assert.equal(hull.boatAudio, sound, 'the craft\'s sound, not a sloop hard-wired in the hull');
  assert.deepEqual(made, [7], 'called once with the page\'s core');
  hull.dispose();
  assert.deepEqual(made, [7, 'disposed']);
  const captures = hullFor(stubCore({ headless: true }), craft);
  assert.equal(captures.boatAudio, null, 'captures: no sound');
  assert.deepEqual(made, [7, 'disposed'], 'and the craft is not asked');
});

test('the seam bites: a craft with no sound of its own is silent, not the sloop\'s', () => {
  assert.equal(CRAFTS.kayak.createAudio, undefined);
  const hull = hullFor(stubCore(), CRAFTS.kayak, vesselFor('kayak'));
  assert.equal(hull.boatAudio, null);
  assert.doesNotThrow(() => hull.dispose());
});
