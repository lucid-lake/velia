// The readback ring (v2/engine/readback.js) on a fake device: staging buffers made once, a copy a frame into the free
// slot, a skipped frame when every slot is in flight (never a new buffer), the data delivered with its record; and the
// CPU surface (v2/sim/surface.js): the window layout, its origin formula, bilinear reads, the choppy inversion.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadbackRing } from '../engine/readback.js';
import { createSurface, windowOrigin, WIN, WINS, OFFSETS, N, LENGTHS, WINDOW_FLOATS, warpAt, COARSE_OFFSETS, COARSE_N } from '../sim/surface.js';
import { liveSurface } from '../../src/sim/waterSurface.js';

function fakeDevice() {
  const made = [], maps = [];
  return {
    made, maps,
    createBuffer: ({ label, size, usage }) => {
      const data = new ArrayBuffer(size); let resolveMap = null;
      const b = { label, size, usage, data,
        mapAsync() { return new Promise((ok) => { resolveMap = ok; maps.push(b); }); },
        finishMap() { resolveMap?.(); resolveMap = null; },
        getMappedRange: () => data, unmap() {}, destroy() {} };
      made.push(b); return b;
    },
  };
}
const fakeEncoder = (log) => ({ copyBufferToBuffer: (src, so, dst, d0, n) => log.push([src.label, dst.label, n]) });

test('the ring: 3 buffers at construction, none later; copies rotate; a full ring skips, never allocates', async () => {
  const dev = fakeDevice(), got = [];
  const ring = createReadbackRing({ device: dev, bytes: 1024, slots: 3, onData: (v, meta) => got.push([v.length, meta]) });
  assert.equal(dev.made.length, 3);
  const src = { label: 'src' }, log = [];
  for (let f = 0; f < 5; f++) { ring.copy(fakeEncoder(log), src, { f }); ring.afterSubmit(); }
  assert.equal(dev.made.length, 3, 'no buffer made in the frames');
  assert.equal(log.length, 3, 'three copies landed, then the ring was full');
  assert.equal(ring.skipped, 2); assert.equal(ring.inFlight, 3);
  assert.deepEqual(log.map((l) => l[1]), ['readback-0', 'readback-1', 'readback-2']);
  // the GPU finishes the first map: its slot frees, the data comes with its record, the next copy takes a free slot
  dev.maps[0].finishMap(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(got.length, 1); assert.equal(got[0][0], 256); assert.deepEqual(got[0][1], { f: 0 });
  assert.equal(ring.reads, 1); assert.equal(ring.inFlight, 2);
  dev.maps[1].finishMap(); dev.maps[2].finishMap(); await ring.drain();
  assert.equal(ring.inFlight, 0); assert.equal(ring.reads, 3);
  assert.ok(ring.copy(fakeEncoder(log), src, { f: 9 }));
  assert.equal(ring.slot, 0, 'slot 0 again after three rotations');
});

test('a failed map frees the slot', async () => {
  const dev = fakeDevice();
  dev.createBuffer = (d) => ({ ...d, mapAsync: () => Promise.reject(new Error('lost')), getMappedRange: () => new ArrayBuffer(d.size), unmap() {}, destroy() {} });
  const ring = createReadbackRing({ device: dev, bytes: 64, slots: 2, onData: () => assert.fail('no data on a failed map') });
  ring.copy(fakeEncoder([]), { label: 's' }); ring.afterSubmit();
  await ring.drain(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(ring.inFlight, 0); assert.equal(ring.reads, 0);
});

test('the window layout and its origin formula', () => {
  assert.equal(WIN, 64); assert.deepEqual(WINS, [64, 64, 256]); assert.deepEqual(OFFSETS, [0, 4096, 8192]);
  // the windows, then the whole 600 and 85 m tiles at half resolution (the rivals' float: fix/v2-rival-float)
  assert.deepEqual(COARSE_OFFSETS, [8192 + 65536, 8192 + 65536 + 128 * 128]); assert.equal(COARSE_N, 128);
  assert.equal(WINDOW_FLOATS, (2 * 64 * 64 + 256 * 256 + 2 * 128 * 128) * 4);
  assert.equal(windowOrigin(0, 600), -32);
  assert.equal(windowOrigin(300, 600), 128 - 32);   // the texel of x = 300 m on a 600 m tile is 128
  assert.equal(windowOrigin(-1, 85, N, 64), Math.floor(-1 / 85 * N) - 32);
  assert.equal(windowOrigin(123, 12, N, 256), 0, 'a whole tile has no origin');
});

// a synthetic window: cascade c filled by f(c, wx, wz) → [Dx, Dy, Dz, turb]
function windowOf(f) {
  const v = new Float32Array(WINDOW_FLOATS);
  for (let c = 0; c < 3; c++) { const W = WINS[c]; for (let wz = 0; wz < W; wz++) for (let wx = 0; wx < W; wx++) { const o = (OFFSETS[c] + wz * W + wx) * 4, r = f(c, wx, wz); v[o] = r[0]; v[o + 1] = r[1]; v[o + 2] = r[2]; v[o + 3] = r[3]; } }
  return v;
}

test('heightAt: constant heights per cascade add up inside the window and read 0 outside it', () => {
  const S = createSurface();
  S.adopt(windowOf((c) => [0, [0.5, 0.2, 0.05][c], 0, 1]), { cx: 0, cz: 0, t: 1 });
  assert.equal(S.adopted, 1); assert.equal(S.t, 1);
  // the windows round the origin cover ±32 texels: ±75 m on the 600 m tile, ±10.6 m on 85; the 12 m tile is whole
  assert.ok(Math.abs(S.heightAt(0.3, -0.2) - 0.75) < 1e-5, `all three: ${S.heightAt(0.3, -0.2)}`);
  assert.ok(Math.abs(S.heightAt(5, 5) - 0.75) < 1e-5, 'inside every window');
  assert.ok(Math.abs(S.heightAt(40, 0) - 0.55) < 1e-5, 'past the 85 m window: 600 + the whole 12 m tile');
  // (300, 300): texel 128 of the 600 m tile and texel 135 of the 85 m tile, both outside a window at texels 224..31
  assert.ok(Math.abs(S.heightAt(300, 300) - 0.05) < 1e-5, 'outside the 600 and 85 m windows: the 12 m tile only');
  // a window is the tile's texels, so it repeats with the tile: 510 m is texel 225 of the 85 m tile, inside
  assert.ok(Math.abs(S.heightAt(510, 0) - 0.25) < 1e-5, 'a repeat of the 85 m window');
  // the window moves with the grid's centre
  S.adopt(windowOf((c) => [0, [0.5, 0.2, 0.05][c], 0, 1]), { cx: 300, cz: 300, t: 2 });
  assert.ok(Math.abs(S.heightAt(300, 300) - 0.75) < 1e-5, 'the window followed the centre');
});

test('heightAt: bilinear between texels; the choppy horizontal map is inverted', () => {
  const S = createSurface();
  // cascade 0 only: Dy rises 0.01 m a texel in x from the window's origin; the texel of x on the 600 m tile is x / 600 × 256
  S.adopt(windowOf((c, wx) => (c === 0 ? [0, wx * 0.01, 0, 1] : [0, 0, 0, 1])), { cx: 0, cz: 0, t: 0 });
  const texel = 600 / 256;   // 2.34375 m
  // texel i's centre sits at (i + 0.5) × texel; the window's texel 32 is world texel 0 (origin −32)
  const at = (i) => S.heightAt((i + 0.5) * texel, 0.5 * texel);
  assert.ok(Math.abs(at(0) - 0.32) < 1e-4, `texel 0 → window texel 32: ${at(0)}`);
  assert.ok(Math.abs(at(1) - 0.33) < 1e-4);
  assert.ok(Math.abs(S.heightAt(1.0 * texel, 0.5 * texel) - 0.325) < 1e-4, 'half-way: the mean');
  // a uniform sideways shift of +1 texel in cascade 0: the water over x came from x − texel, so the height read at x is
  // the undisplaced field's at x − texel
  S.adopt(windowOf((c, wx) => (c === 0 ? [texel, wx * 0.01, 0, 1] : [0, 0, 0, 1])), { cx: 0, cz: 0, t: 0 });
  assert.ok(Math.abs(at(5) - 0.36) < 1e-3, `choppy inversion: ${at(5)} (0.37 without it)`);
});

test('the surface plugs into src/sim/waterSurface.js: liveSurface(water).heightAt(x, z, t, opts) reads the drawn water', () => {
  const water = { surface: createSurface() };
  water.surface.adopt(windowOf((c) => [0, [0.3, 0.1, 0.02][c], 0, 1]), { cx: 0, cz: 0, t: 4 });
  const live = liveSurface(water);
  assert.ok(Math.abs(live.heightAt(1, 1, 4, { depthM: 50 }) - 0.42) < 1e-5, 'the sim call shape, extra arguments ignored');
  water.surface = createSurface();   // the water swapped its surface: the live view follows
  assert.equal(live.heightAt(1, 1, 5), 0);
});

test('the warp of cascades 1 and 2 is a few metres with a gentle gradient (the tile break)', () => {
  let maxW = 0, maxG = 0;
  for (let x = -300; x <= 300; x += 7) for (let z = -300; z <= 300; z += 11) {
    const [wx, wz] = warpAt(x, z), [wx2] = warpAt(x + 0.5, z);
    maxW = Math.max(maxW, Math.abs(wx), Math.abs(wz)); maxG = Math.max(maxG, Math.abs(wx2 - wx) / 0.5);
  }
  assert.ok(maxW <= 3.5 && maxW > 2, `warp amplitude ${maxW.toFixed(2)} m`);
  assert.ok(maxG < 0.35, `warp gradient ${maxG.toFixed(3)}`);
  assert.equal(LENGTHS.length, 3);
});
