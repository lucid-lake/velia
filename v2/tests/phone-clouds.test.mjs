// The phone has no clouds (owner, 2026-11-18; src/core/features.js phoneClouds; render/clouds.js mode 'off'): a phone's tier is off
// (a tablet's and a desktop's: full), ?phoneclouds=full|off wins, and off declares no cloud pipeline and makes 1 x 1 textures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { createClouds } from '../render/clouds.js';
import { createPipelineRegistry } from '../engine/pipelines.js';

const make = (dev, flags = {}, search = '', headless = false) => {
  const win = { ...DEVICES[dev], location: { search } };
  const pr = { get: () => profileOf(readFacts(win), forcedOf(search), { gpu: 1 }), on: () => () => {} };
  return createFeatures({ profile: pr, doc: null }).configure({ headless, flags });
};

test('phoneClouds: off on a phone, full on a tablet and a desktop; ?phoneclouds=full|off wins; a capture keeps them unless a phone is forced', () => {
  const WANT = { ipadTrackpad: 'full', touchLaptop: 'full', smallDesktop: 'full', iphoneTurned: 'off', androidSideways: 'off', desktop: 'full' };
  for (const [dev, want] of Object.entries(WANT)) assert.equal(make(dev).feature('phoneClouds').tier, want, dev);
  assert.equal(make('iphoneTurned', { phoneclouds: 'full' }).feature('phoneClouds').tier, 'full', 'the A/B on a phone');
  assert.equal(make('desktop', { phoneclouds: 'off' }).feature('phoneClouds').tier, 'off', 'off anywhere');
  assert.equal(make('iphoneTurned', {}, '', true).feature('phoneClouds').tier, 'full', 'a capture of a phone-sized page keeps them');
  assert.equal(make('desktop', {}, '?profile=form:phone', true).feature('phoneClouds').tier, 'off', 'a forced phone');
  assert.equal(make('iphoneTurned').feature('phoneClouds').fixed, true);
});

function fakeDevice() {
  const calls = { dispatches: [], sizes: [] };
  const view = () => ({ view: true });
  return {
    calls,
    createTexture: (d) => { calls.sizes.push(d.size); return { ...d, createView: view }; },
    createSampler: () => ({}), createBuffer: (d) => ({ size: d.size }),
    createBindGroupLayout: (d) => ({ entries: d.entries }), createBindGroup: (d) => ({ entries: d.entries }), createPipelineLayout: (d) => d,
    createShaderModule: ({ label, code }) => ({ label, code, getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async (d) => ({ label: d.label }), createRenderPipelineAsync: async (d) => ({ label: d.label }),
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(...a) { calls.dispatches.push(a); }, end() {} }), finish: () => ({}) }),
    queue: { writeBuffer() {}, submit() {} },
    pushErrorScope() {}, popErrorScope: async () => null,
  };
}

test('mode off: no cloud pipeline, no bake, no march, 1 x 1 textures; the readers see T = 1 (on = 0)', async () => {
  const dev = fakeDevice(), reg = createPipelineRegistry(dev, { errors: [] });
  const cl = createClouds({ device: dev, reg, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: 'struct Frame { x: vec4f }', pixels: 1280 * 720, seed: 3, mode: 'off' });
  cl.attach({ textures: { tT: { createView: () => ({}) }, tV: { createView: () => ({}) } }, samplers: { sLin: {}, sView: {} }, lightBuf: {} });
  assert.equal(await reg.buildAll(), 0, 'no pipeline');
  cl.bakeOnce(); assert.deepEqual(dev.calls.dispatches, [], 'no bake');
  const run = []; cl.run({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups(...a) { run.push(a); } }, { dispatches: 0 });
  assert.deepEqual(run, [], 'no dispatch');
  assert.equal(cl.update({ wind: { speedMs: 5, dirDeg: 270 }, t: 2, eye: [0, 1.6, 0], sunElevDeg: 40 }), null, 'no schedule step');
  assert.equal(cl.params[3], 0, 'T = 1 for every reader');
  assert.ok(dev.calls.sizes.every((s) => s.slice(0, 2).every((n) => n === 1)), 'every cloud texture is 1 x 1');
  assert.ok(cl.stats.texBytes < 1024, 'under 1 KB of cloud textures');
});
