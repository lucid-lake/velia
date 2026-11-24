// The shared per-frame uniform ring (v2/engine/uniforms.js): the layout matches the WGSL struct, the ring never
// allocates after construction, one writeBuffer per frame of exactly one slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameUniforms, makeLayout, wgslStruct, FRAME_FIELDS } from '../engine/uniforms.js';

test('layout: fields are packed in order as f32, the stride is aligned to 256', () => {
  const L = makeLayout();
  assert.equal(L.offsets.viewProj, 0);
  assert.equal(L.offsets.invViewProj, 16);
  assert.equal(L.offsets.sun, 32);
  assert.equal(L.offsets.params, 44);
  assert.equal(L.offsets.wind, 48); assert.equal(L.offsets.grid, 60);   // the M1 rows, appended
  assert.equal(L.offsets.moon, 64); assert.equal(L.offsets.bow, 88);   // the M5e rows (the night, the storm), appended after M1's
  assert.equal(L.offsets.under, 104); assert.equal(L.offsets.underK, 108);   // play as Tessie, phase 2a: the eye under the water, appended
  assert.equal(L.floats, 112); assert.equal(L.bytes, 448); assert.equal(L.stride, 512, 'the block still takes a 512 B slot (two 256 B alignments)');
  assert.equal(makeLayout([['a', 'vec4f', 4]]).stride, 256);
  assert.equal(makeLayout([['a', 'mat4x4f', 16], ['b', 'mat4x4f', 16], ['c', 'mat4x4f', 16], ['d', 'mat4x4f', 16], ['e', 'vec4f', 4]]).stride, 512);
});

test('the WGSL struct names every field in the layout order, vec4f / mat4x4f only (no padding rules to break)', () => {
  const w = wgslStruct();
  assert.match(w, /^struct Frame \{/);
  const names = [...w.matchAll(/^\s+(\w+): (vec4f|mat4x4f),$/gm)].map((m) => m[1]);
  assert.deepEqual(names, FRAME_FIELDS.map(([n]) => n));
  for (const [, t] of FRAME_FIELDS) assert.ok(t === 'vec4f' || t === 'mat4x4f', t);
});

test('the ring: begin() rotates slots, set() writes into the current slot only, upload() writes one slot', () => {
  const U = createFrameUniforms({ slots: 3 });
  const writes = [];
  const queue = { writeBuffer: (buf, off, data, dataOff, size) => writes.push([off, dataOff, size, data === U.data.buffer]) };
  const buf = {};
  for (let f = 0; f < 4; f++) {
    const slot = U.begin();
    assert.equal(slot, f % 3);
    assert.equal(U.byteOffset, slot * 512);
    U.set4('sun', f, 1, 2, 3);
    U.mat4('viewProj', new Float32Array(16).fill(f + 10));
    U.upload(queue, buf);
  }
  assert.deepEqual(writes, [[0, 0, 512, true], [512, 512, 512, true], [1024, 1024, 512, true], [0, 0, 512, true]]);
  // slot 1 still holds frame 1's sun (frame 4 overwrote slot 0 only)
  assert.equal(U.data[128 + 32], 1); assert.equal(U.data[0 + 32], 3);
  assert.equal(U.data[128 + 0], 11); assert.equal(U.data[0], 13);
});

test('set() checks the field and the length; the views are subarrays of one buffer (no allocation per frame)', () => {
  const U = createFrameUniforms();
  U.begin();
  assert.throws(() => U.set('nope', [1, 2, 3, 4]), /no field/);
  assert.throws(() => U.set('sun', [1, 2, 3]), /takes 4 floats/);
  assert.equal(U.view.buffer, U.data.buffer);
  const before = U.view; U.set4('cam', 1, 2, 3, 4); assert.equal(U.view, before);
});
