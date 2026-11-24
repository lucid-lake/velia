// Refactor round 3 B6b: a wind texture whose centre moved by whole texels (the 512 m snap) copies the shared texels' roughness and
// bin values from the last centre instead of recomputing them. The texture must be the same, bit for bit, as one built from nothing
// at the new centre (the same points, so the same numbers), with far fewer binAt calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindField } from '../src/sim/wind.js';
import { makeTerrain } from '../src/sim/terrain.js';

const T = makeTerrain({ seed: 1 });
const SIZE = 256, EXT = 4096;
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;
function counted(cache) {
  const w = new WindField({ seed: 1, cache }); w.setTerrain(T.heightAt);
  const bin = w.binAt.bind(w); w.calls = 0; w.binAt = (k, x, z) => { w.calls++; return bin(k, x, z); };
  return w;
}

for (const cache of [null, { tex: 3, f32: true }]) {
  test(`a one-snap move copies the shared texels: the same texture, bit for bit (${cache ? 'phone f32 cache' : 'desktop cache'})`, () => {
    const t = 140;
    const moved = counted(cache), fresh = counted(cache);
    moved.toTexture(SIZE, EXT, t, 1024, -1024);
    fresh.toTexture(SIZE, EXT, t, 1024, -1024); fresh.tex.clear();   // the same history, no donor
    for (const [cx, cz] of [[512, -512], [1024, -512], [512, -512]]) {   // diagonal, one axis, and back to a cached centre
      moved.calls = 0; fresh.calls = 0;
      const a = moved.toTexture(SIZE, EXT, t, cx, cz), b = fresh.toTexture(SIZE, EXT, t, cx, cz);
      fresh.tex.clear();
      assert.ok(same(a, b), `texture at ${cx}, ${cz} differs from a fresh build`);
      if (moved.calls) assert.ok(moved.calls < fresh.calls * 0.5, `binAt calls ${moved.calls} vs fresh ${fresh.calls}`);
    }
    // later frames at the moved centre (new bins as the direction wanders): still equal
    for (const tt of [150, 300]) { const a = moved.toTexture(SIZE, EXT, tt, 512, -512), b = fresh.toTexture(SIZE, EXT, tt, 512, -512); fresh.tex.clear(); assert.ok(same(a, b), `t ${tt}`); }
  });
}
