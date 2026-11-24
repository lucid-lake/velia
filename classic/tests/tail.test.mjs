// The per-frame tail (src/core/tail.js): bounded memory in the frame loop (src/core/loop.js).
// v1 only (/classic/): trimmed to its representative check(s).
import test from 'node:test';
import assert from 'node:assert/strict';

test('the frame keeps bounded per-frame records (src/core/loop.js): 2,000 frames, the stats read the tail', async () => {
  const { createFrame } = await import('../src/core/loop.js');
  const { createSystems, createEnv } = await import('../src/core/systems.js');
  const info = { autoReset: true, render: { drawCalls: 3, triangles: 9, timestamp: 1.5 }, reset() {} };
  const renderer = { info, domElement: { height: 720 }, resolveTimestampsAsync: async () => {}, backend: { isWebGPUBackend: true, trackTimestamp: true }, getPixelRatio: () => 1 };
  const pc = { post: { render() {} }, hud: { render() {}, present() {} } };
  const D = { inFlight: 0, renders: 0, maxInFlight: 0 };
  const was = globalThis.__gpuAll; delete globalThis.__gpuAll;
  try {
    const f = createFrame({ systems: createSystems(), renderer, pc, water: { update() {}, ultra: null }, trees: { stats: {} }, quality: { name: 'high' }, sun: { hour: 6, exposure: 1, light: 1, elevationDeg: 5 }, env: createEnv(),
      streamFrame: async () => {}, applyDaylight: () => {}, CAM: 'A', SEED: 1, D, time: () => 0, headless: true });
    for (let i = 0; i < 2000; i++) await f.renderOnce();
    const s = f.stats();
    assert.equal(s.frames, 2000, 'frames still counts every frame since the reset');
    assert.ok(s.callsPerFrame.length <= 1200 && s.callsPerFrame.every((c) => c === 3));
    assert.equal(globalThis.__gpuAll.length, 2000, 'the GPU record still counts every frame (the tools\' cursor)');
    assert.ok(globalThis.__gpuAll.kept <= 1200); assert.equal(s.gpuMsMedian, 1.5);
    f.resetCounters(); assert.equal(f.stats().frames, 0); assert.deepEqual(f.stats().callsPerFrame, []);
  } finally { if (was === undefined) delete globalThis.__gpuAll; else globalThis.__gpuAll = was; }
});
