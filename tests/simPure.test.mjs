// The shared sim stays engine-agnostic (Sprint 0): v1 (three.js) and v2 (raw WebGPU) both
// import src/sim/. Walk the import graph from every file in src/sim/ (static imports, re-exports and literal dynamic
// imports) and fail if three, any three/* subpath or @takram/* (the sky library, built on three) is reachable.
// Every JS module the walk reaches must also live in src/sim/ (JSON data may stay beside its old module), so v2 can take
// the folder as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import { reach, listJs, ROOT, FORBIDDEN } from './helpers/importGraph.mjs';

const SIM = join(ROOT, 'src', 'sim');
const files = listJs(SIM);

test('src/sim/ exists and holds the shared modules', () => {
  assert.ok(files.length > 0, 'src/sim/ has no modules');
});

test('nothing under src/sim/ reaches three or @takram/*', () => {
  const { forbidden, missing } = reach(files);
  assert.deepEqual(missing.map((m) => `${m.from}: ${m.spec}`), [], 'imports that resolve to no file');
  assert.deepEqual(forbidden.map((x) => `${x.spec} via ${x.chain.join(' > ')}`), [], 'src/sim/ must not reach three');
});

// Reached from outside src/sim/ today, all three-free: the sloop's own sound (the craft row's createAudio and the hull
// frame's controls sounds: Web Audio) and the fetch gate it waits on (ui/deferLoad.js: a phone fetches sound only once
// the home card is live), with the device profile (core/profile.js, through ui/device.js) with its feature registry (core/features.js: terrain-data.js's terrainSet). They move with the audio area (a later sprint);
// the list is exact, so a new import from outside fails here and a cut one asks to shrink it.
const PENDING = ['src/audioFormat.js', 'src/boatAudio.js', 'src/core/features.js', 'src/core/profile.js', 'src/sfx.js', 'src/ui/deferLoad.js', 'src/ui/device.js'];

test('every JS module src/sim/ reaches lives in src/sim/ (but the audio area, listed)', () => {
  const outside = reach(files).files.filter((f) => /\.m?js$/.test(f) && !f.startsWith(SIM + '/')).map((f) => relative(ROOT, f)).sort();
  assert.deepEqual(outside.filter((f) => !PENDING.includes(f)), [], 'src/sim/ imports these modules from outside it: move them in or cut the import');
  assert.deepEqual(PENDING.filter((f) => !outside.includes(f)), [], 'no longer reached from src/sim/: take them off PENDING');
});

test('the guard itself: a bare three import, a subpath, @takram and a chain are caught', () => {
  for (const s of ['three', 'three/webgpu', 'three/tsl', '@takram/three-atmosphere']) assert.ok(FORBIDDEN(s), s);
  for (const s of ['astronomy-engine', 'threejs-like', 'node:fs']) assert.ok(!FORBIDDEN(s), s);
  // a chain: src/boat/Boat.js imports three/webgpu directly; anything that reaches it is caught with its path
  const { forbidden } = reach([join(ROOT, 'classic', 'src', 'sail', 'assemble.js')]);
  assert.ok(forbidden.length > 0 && forbidden[0].chain[0] === 'classic/src/sail/assemble.js', 'a chain through an import is caught');
});
