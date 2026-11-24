// The v2 seams (2026-11-13): src/sim/lake.js (buildLakeOn: v1's lake builder over any sampler), src/sim/terrain-cover.js
// (COVER) and src/sim/props/paddler/look.js (the paddler's look picks) were moved out of three-bound or self-loading
// modules unchanged; the old modules re-export them, so v1 reads the same objects and numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain } from '../src/sim/terrain.js';
import { buildLakeOn } from '../src/sim/lake.js';
import { COVER as COVER_DATA } from '../src/sim/terrain-data.js';
import { COVER } from '../src/sim/terrain-cover.js';
import * as simLook from '../src/sim/props/paddler/look.js';
import * as look from '../classic/src/props/paddler/look.js';

test('buildLakeOn over v1\'s own sampler is the terrain object v1 builds: the island, the mouth, the places, the queries', () => {
  const T = makeTerrain();
  const L = buildLakeOn(T.waters, T.data);
  assert.deepEqual(L.lake, T.lake);
  assert.deepEqual(L.landmarks, T.landmarks);
  assert.deepEqual(L.places(), T.places());
  for (const [x, z] of [[0, 0], [1200, -1050], [-800, -400], [2500, 300]]) {
    assert.equal(L.heightAt(x, z), T.heightAt(x, z)); assert.equal(L.shoreDistance(x, z), T.shoreDistance(x, z));
    assert.deepEqual(L.coverAt(x, z), T.coverAt(x, z));
  }
});

test('the cover classes and the look picks are the same objects through the old modules', () => {
  assert.equal(COVER_DATA, COVER);
  for (const k of ['PFD_COLOURS', 'SKIN', 'skinLook', 'rng', 'pickLook']) assert.equal(look[k], simLook[k], k);
  for (const s of [1, 7, 2112, 5058]) assert.deepEqual(simLook.pickLook(s, { sex: 'male' }), look.pickLook(s, { sex: 'male' }));
});
