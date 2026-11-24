// Refactor round 3 B4: Tessie's waterline split keeps its three targets only while it is drawn: freed after SPLIT_IDLE frames without
// the split (she left the band or was given back), made again on the next split frame (no pipeline added), kept through short gaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnderBack, SPLIT_IDLE } from '../render/underBack.js';

globalThis.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
globalThis.GPUTextureUsage ??= { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

function rig() {
  const live = new Set(), made = [], pipes = new Map();
  const device = {
    createTexture: (d) => { const t = { ...d, createView: () => ({ of: t }), destroy() { live.delete(t); } }; live.add(t); made.push(t); return t; },
    createBindGroupLayout: (d) => d, createPipelineLayout: (d) => d, createBindGroup: (d) => d,
  };
  const reg = { shader: (n, code) => ({ n, code }), add: (n, d) => pipes.set(n, d), has: (n) => pipes.has(n), get: (n) => pipes.get(n) };
  const ub = createUnderBack({ device, reg, frameBGL: {}, sky: { skyBGL: {}, skyBG: {} }, frameStruct: 'struct Frame { cam: vec4f }', hdrTarget: { format: 'rgba16float' }, msaa: 4 });
  const pass = () => ({ setBindGroup() {}, setPipeline() {}, draw() {}, end() {} });
  const enc = { beginRenderPass: () => pass() };
  const frame = () => ub.encode(enc, { targets: { w: 2560, h: 1600, resolveView: {} }, msaa: 4, frameBG: {}, offset: 0, draw() {} });
  return { ub, live, made, pipes, frame };
}

test('the split targets are freed after SPLIT_IDLE frames without it, and made again on re-entry', () => {
  const { ub, live, made, pipes, frame } = rig();
  const nPipes = pipes.size;
  assert.equal(made.length, 0, 'nothing before the first split frame');
  for (let i = 0; i < 5; i++) frame();
  assert.equal(live.size, 3, 'colour (4×), its resolve and depth');
  assert.deepEqual(made.map((t) => t.label).sort(), ['under-split', 'under-split-depth', 'under-split-resolve']);
  // a short gap (she bobs out of the band): kept, no re-make
  for (let i = 0; i < SPLIT_IDLE - 1; i++) ub.skip();
  frame();
  assert.equal(made.length, 3, 'a gap under SPLIT_IDLE frames keeps the targets');
  // given back (or deep): freed
  for (let i = 0; i < SPLIT_IDLE; i++) ub.skip();
  assert.equal(live.size, 0, 'all three destroyed');
  assert.equal(ub.held, false);
  for (let i = 0; i < 500; i++) ub.skip();   // idle frames after the release do nothing
  assert.equal(live.size, 0);
  // re-entry: made again at the same size, the same pipelines
  frame();
  assert.equal(live.size, 3);
  assert.equal(made.length, 6);
  assert.deepEqual(made.slice(3).map((t) => [t.label, t.size.join('x'), t.sampleCount ?? 1]), made.slice(0, 3).map((t) => [t.label, t.size.join('x'), t.sampleCount ?? 1]));
  assert.equal(pipes.size, nPipes, 'no pipeline added');
});
